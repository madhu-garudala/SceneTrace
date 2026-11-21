import type { OfferOption } from "@/lib/types";

export function optionsEqual(a: OfferOption[], b: OfferOption[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((optA) =>
    b.some(
      (optB) =>
        optB.name.trim().toLowerCase() === optA.name.trim().toLowerCase() &&
        optB.label.trim().toLowerCase() === optA.label.trim().toLowerCase(),
    ),
  );
}

export type FreshnessVerdict =
  | { status: "ok" }
  | { status: "unavailable"; message: string }
  | { status: "options_changed"; message: string }
  | { status: "price_changed"; message: string };

/**
 * Compares the shopper's signed offer snapshot against a fresh `get_product` read.
 * Catches availability drops, option relaxation/disappearance, and any price or currency transition
 * (including transitions to or from `null`).
 */
export function evaluateVariantFreshness(
  approved: {
    title: string;
    sellerName: string;
    options: OfferOption[];
    amountMinor: number | null;
    currency: string | null;
  },
  fresh: {
    title: string;
    sellerName: string;
    availability: "available" | "unavailable" | "unknown";
    options: OfferOption[];
    amountMinor: number | null;
    currency: string | null;
  },
): FreshnessVerdict {
  if (fresh.availability === "unavailable") {
    return {
      status: "unavailable",
      message: `"${fresh.title}" is currently out of stock at ${fresh.sellerName}. Please choose another offer.`,
    };
  }

  // Enforce option equality whenever the approved snapshot specified variant options
  // (so disappearing or relaxed options fail closed, while enriching an empty [] snapshot on the same variantId succeeds)
  if (
    approved.options.length > 0 &&
    !optionsEqual(approved.options, fresh.options)
  ) {
    return {
      status: "options_changed",
      message:
        "The merchant's variant options changed or relaxed since your search. Please review the updated listing options.",
    };
  }

  const normCurrA = approved.currency?.toUpperCase() ?? null;
  const normCurrB = fresh.currency?.toUpperCase() ?? null;

  const amountDiffers = approved.amountMinor !== fresh.amountMinor;
  const currencyDiffers = normCurrA !== normCurrB;

  if (amountDiffers || currencyDiffers) {
    return {
      status: "price_changed",
      message:
        "The merchant updated this item's price or currency since search. Review and confirm the current price to open Shopify checkout.",
    };
  }

  return { status: "ok" };
}

/**
 * Formats minor integer currency units according to ISO-4217 currency exponent
 * (e.g., JPY -> 0 decimals, USD/EUR -> 2 decimals, KWD/BHD -> 3 decimals).
 */
export function formatMoneyMinor(
  amountMinor: number | null,
  currency: string | null,
): string {
  if (amountMinor === null || !Number.isFinite(amountMinor)) {
    return "See merchant checkout";
  }
  const curr = (currency || "USD").toUpperCase();
  if (curr === "XXX") {
    return (amountMinor / 100).toFixed(2);
  }
  try {
    const probe = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: curr,
    });
    const digits = probe.resolvedOptions().maximumFractionDigits ?? 2;
    const divisor = 10 ** digits;
    return probe.format(amountMinor / divisor);
  } catch {
    return `${(amountMinor / 100).toFixed(2)} ${curr}`;
  }
}
