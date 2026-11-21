import { NextResponse } from "next/server";
import {
  CheckoutTokenValidationError,
  resolveCheckoutStatusSummary,
} from "@/lib/shop/checkout-status";
import { logServerSpan } from "@/lib/telemetry/logger";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(
  request: Request,
  context: { params: Promise<{ checkoutRef: string }> },
) {
  const startedAt = Date.now();
  const traceId = request.headers.get("x-scenetrace-id") ?? "chk_status";
  try {
    const { checkoutRef } = await context.params;
    const summary = await resolveCheckoutStatusSummary(
      decodeURIComponent(checkoutRef),
    );
    logServerSpan({
      traceId,
      span: "shop.get_checkout",
      provider: "mcp.shop.com",
      status: "ok",
      durationMs: Date.now() - startedAt,
      meta: {
        sellerDomain: summary.sellerDomain,
        checkoutStatus: summary.status,
        orderPlaced: summary.orderPlaced,
      },
    });
    return NextResponse.json(
      { checkout: summary },
      {
        status: 200,
        headers: { "x-scenetrace-id": traceId },
      },
    );
  } catch (err) {
    if (err instanceof CheckoutTokenValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    const message =
      err instanceof Error
        ? err.message
        : "Unable to read Shopify checkout status.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
