import { NextResponse } from "next/server";
import { z } from "zod";
import { getShopLocaleDefaults } from "@/lib/env";
import {
  encryptCheckoutRef,
  signOfferToken,
  verifyOfferToken,
} from "@/lib/security/tokens";
import {
  createShopifyHostedCheckout,
  refreshVariantWithGetProduct,
} from "@/lib/shop/client";
import { evaluateVariantFreshness } from "@/lib/shop/freshness";
import { logServerSpan } from "@/lib/telemetry/logger";
import type { CheckoutPriceChange, CheckoutSummary } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const CreateCheckoutRequestSchema = z.object({
  traceId: z.string().max(120).optional(),
  offerToken: z.string().min(20).max(8192),
  idempotencyKey: z.string().uuid(),
  country: z.string().length(2).optional(),
});

export async function POST(request: Request) {
  try {
    const rawJson = await request.json();
    const parsed = CreateCheckoutRequestSchema.safeParse(rawJson);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error:
            parsed.error.issues[0]?.message ?? "Invalid checkout request.",
        },
        { status: 400 },
      );
    }

    let approvedOffer: ReturnType<typeof verifyOfferToken>;
    try {
      approvedOffer = verifyOfferToken(parsed.data.offerToken);
    } catch (err) {
      return NextResponse.json(
        {
          code: "invalid_token",
          error: err instanceof Error ? err.message : "Invalid offer token.",
        },
        { status: 401 },
      );
    }

    const defaults = getShopLocaleDefaults();
    const country = (parsed.data.country ?? defaults.country).toUpperCase();
    const currency = approvedOffer.currency ?? defaults.currency;

    // Freshness check via `get_product` before creating hosted checkout
    const freshVariant = await refreshVariantWithGetProduct({
      productId: approvedOffer.productId,
      variantId: approvedOffer.variantId,
      sellerDomain: approvedOffer.sellerDomain,
      selectedOptions: approvedOffer.options,
      country,
      currency,
    });

    if (!freshVariant) {
      return NextResponse.json(
        {
          code: "variant_missing",
          error:
            "This exact variant could not be confirmed on a fresh catalog check (it may have been removed or changed by the merchant). Please select another offer.",
        },
        { status: 409 },
      );
    }

    const verdict = evaluateVariantFreshness(approvedOffer, freshVariant);

    if (verdict.status === "unavailable") {
      return NextResponse.json(
        { code: "unavailable", error: verdict.message },
        { status: 409 },
      );
    }

    if (verdict.status === "options_changed") {
      return NextResponse.json(
        { code: "options_changed", error: verdict.message },
        { status: 409 },
      );
    }

    // Never bypass price comparison with a boolean flag: `updatedOfferToken` signs the
    // newly observed price, so resubmitting it passes only if the price hasn't shifted a second time!
    if (verdict.status === "price_changed") {
      const updatedOfferToken = signOfferToken({
        offerId: approvedOffer.offerId,
        itemId: approvedOffer.itemId,
        productId: freshVariant.productId,
        variantId: freshVariant.variantId,
        sellerDomain: freshVariant.sellerDomain,
        sellerName: freshVariant.sellerName,
        title: freshVariant.title,
        options: freshVariant.options,
        amountMinor: freshVariant.amountMinor,
        currency: freshVariant.currency,
        availability: freshVariant.availability,
        productUrl: freshVariant.productUrl,
        imageUrl: freshVariant.imageUrl,
      });

      const priceChange: CheckoutPriceChange = {
        previousAmountMinor: approvedOffer.amountMinor,
        previousCurrency: approvedOffer.currency,
        currentAmountMinor: freshVariant.amountMinor,
        currentCurrency: freshVariant.currency,
        updatedOfferToken,
      };

      return NextResponse.json(
        {
          code: "price_changed",
          error: verdict.message,
          priceChange,
        },
        { status: 409 },
      );
    }

    const chkStartedAt = Date.now();
    const providerCheckout = await createShopifyHostedCheckout({
      sellerDomain: freshVariant.sellerDomain,
      variantId: freshVariant.variantId,
      country,
      idempotencyKey: parsed.data.idempotencyKey,
    });

    logServerSpan({
      traceId: parsed.data.traceId ?? "trace_checkout",
      span: "shop.create_checkout",
      provider: "mcp.shop.com",
      status: "ok",
      durationMs: Date.now() - chkStartedAt,
      cacheHit: false,
      meta: {
        sellerDomain: freshVariant.sellerDomain,
        checkoutStatus: providerCheckout.status,
      },
    });

    const combinedWarnings = Array.from(
      new Set([...freshVariant.warnings, ...providerCheckout.warnings]),
    );

    const checkoutRef = encryptCheckoutRef({
      checkoutId: providerCheckout.checkoutId,
      shop: freshVariant.sellerDomain,
      continueUrl: providerCheckout.continueUrl,
      sellerName: freshVariant.sellerName,
      variantId: freshVariant.variantId,
      title: freshVariant.title,
      options: freshVariant.options,
      subtotalMinor:
        providerCheckout.subtotalMinor ?? freshVariant.amountMinor,
      totalMinor: providerCheckout.totalMinor ?? freshVariant.amountMinor,
      currency: providerCheckout.currency ?? freshVariant.currency,
      warnings: combinedWarnings.slice(0, 6),
      links: providerCheckout.links.slice(0, 6),
    });

    const summary: CheckoutSummary = {
      checkoutRef,
      continueUrl: providerCheckout.continueUrl,
      status: providerCheckout.status,
      orderPlaced: providerCheckout.orderPlaced,
      sellerDomain: freshVariant.sellerDomain,
      sellerName: freshVariant.sellerName,
      variantId: freshVariant.variantId,
      title: freshVariant.title,
      options: freshVariant.options,
      subtotalMinor:
        providerCheckout.subtotalMinor ?? freshVariant.amountMinor,
      totalMinor: providerCheckout.totalMinor ?? freshVariant.amountMinor,
      totalsBreakdown: providerCheckout.totalsBreakdown,
      currency: providerCheckout.currency ?? freshVariant.currency,
      warnings: combinedWarnings,
      links: providerCheckout.links,
      orderId: providerCheckout.orderId,
      orderPermalink: providerCheckout.orderPermalink,
      updatedAt: new Date().toISOString(),
    };

    return NextResponse.json({ checkout: summary }, { status: 200 });
  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : "Could not initialize Shopify checkout.";
    return NextResponse.json(
      { code: "provider_error", error: message },
      { status: 502 },
    );
  }
}
