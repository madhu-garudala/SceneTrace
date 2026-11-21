import { NextResponse } from "next/server";
import {
  CheckoutTokenValidationError,
  resolveCheckoutStatusSummary,
} from "@/lib/shop/checkout-status";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(
  _request: Request,
  context: { params: Promise<{ checkoutRef: string }> },
) {
  try {
    const { checkoutRef } = await context.params;
    const summary = await resolveCheckoutStatusSummary(
      decodeURIComponent(checkoutRef),
    );
    return NextResponse.json({ checkout: summary }, { status: 200 });
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
