import { decryptCheckoutRef } from "@/lib/security/tokens";
import { readShopifyCheckoutStatus } from "@/lib/shop/client";
import type { CheckoutSummary } from "@/lib/types";

export class CheckoutTokenValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CheckoutTokenValidationError";
  }
}

export async function resolveCheckoutStatusSummary(
  rawCheckoutRef: string,
): Promise<CheckoutSummary> {
  let decoded: ReturnType<typeof decryptCheckoutRef>;
  try {
    decoded = decryptCheckoutRef(rawCheckoutRef);
  } catch (err) {
    throw new CheckoutTokenValidationError(
      err instanceof Error
        ? err.message
        : "Invalid or expired checkout reference.",
    );
  }

  const fresh = await readShopifyCheckoutStatus({
    sellerDomain: decoded.shop,
    checkoutId: decoded.checkoutId,
    fallbackContinueUrl: decoded.continueUrl,
  });

  return {
    checkoutRef: rawCheckoutRef,
    continueUrl: fresh.continueUrl,
    status: fresh.status,
    orderPlaced: fresh.orderPlaced,
    sellerDomain: decoded.shop,
    sellerName: decoded.sellerName,
    variantId: decoded.variantId,
    title: decoded.title,
    options: decoded.options,
    subtotalMinor: fresh.subtotalMinor ?? decoded.subtotalMinor,
    totalMinor: fresh.totalMinor ?? decoded.totalMinor,
    totalsBreakdown: fresh.totalsBreakdown,
    currency: fresh.currency ?? decoded.currency,
    warnings: Array.from(new Set([...decoded.warnings, ...fresh.warnings])),
    links: fresh.links.length > 0 ? fresh.links : decoded.links,
    orderId: fresh.orderId,
    orderPermalink: fresh.orderPermalink,
    updatedAt: new Date().toISOString(),
  };
}
