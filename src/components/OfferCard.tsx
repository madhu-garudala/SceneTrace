"use client";

import { useEffect, useRef, type ReactNode } from "react";
import {
  ArrowUpRight,
  CheckCircle2,
  ExternalLink,
  Loader2,
  ShoppingBag,
} from "lucide-react";
import { formatMoneyMinor } from "@/components/CheckoutModal";
import type { MatchLabel, Offer, TracedItem } from "@/lib/types";

function matchBadgeMeta(
  label: MatchLabel,
  score: number | null,
): {
  text: string;
  classes: string;
  showCheck?: boolean;
} {
  const pct = score !== null ? ` · ${Math.round(score * 100)}%` : "";
  switch (label) {
    case "exact_supported":
      return {
        text: `Exact match${pct}`,
        classes:
          "border-emerald-500/35 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
        showCheck: true,
      };
    case "possible":
      return {
        text: `Possible match${pct}`,
        classes:
          "border-amber-500/35 bg-amber-500/12 text-amber-700 dark:text-amber-300",
      };
    case "similar":
      return {
        text: "Similar style",
        classes:
          "border-[var(--border-subtle)] bg-[var(--bg-sunken)] text-[var(--ink-secondary)]",
      };
    case "unscored":
      return {
        text: "Catalog match",
        classes:
          "border-dashed border-[var(--border-strong)] bg-[var(--bg-sunken)] text-[var(--ink-muted)]",
      };
  }
}

export type OfferCardProps = {
  item: TracedItem;
  offer: Offer;
  rankIndex: number;
  isBuyingThis: boolean;
  anyBuyingInFlight: boolean;
  isSelectingThis: boolean;
  variantError?: string;
  onSelectVariantOption: (params: {
    item: TracedItem;
    offer: Offer;
    optionName: string;
    optionValue: string;
  }) => void;
  onBuyOnShopify: (offer: Offer) => void;
  /** The offer voice is about to add; marked and scrolled into view. */
  highlighted?: boolean;
  /** Rendered under a highlighted offer ("Add this one?" with yes / no). */
  highlightSlot?: ReactNode;
};

export function OfferCard({
  item,
  offer,
  rankIndex,
  isBuyingThis,
  anyBuyingInFlight,
  isSelectingThis,
  variantError,
  onSelectVariantOption,
  onBuyOnShopify,
  highlighted = false,
  highlightSlot,
}: OfferCardProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!highlighted || !rootRef.current) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    rootRef.current.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
  }, [highlighted]);
  const badge = matchBadgeMeta(offer.matchLabel, offer.exactMatchYes);
  const isUnavailable = offer.availability === "unavailable";
  const wasPromotedToTop =
    rankIndex === 0 && offer.originalSearchRank > 1 && offer.exactMatchYes !== null;

  return (
    <div
      ref={rootRef}
      className={`group relative rounded-2xl border bg-[var(--bg-panel)] p-4 transition-all ${
        highlighted
          ? "border-amber-400 shadow-[0_0_0_3px_rgba(251,191,36,0.35)]"
          : rankIndex === 0 && offer.matchLabel === "exact_supported"
          ? "border-emerald-500/40 shadow-sm"
          : "border-[var(--border-subtle)] hover:border-[var(--border-strong)]"
      }`}
    >
      <div className="flex flex-col gap-4 sm:flex-row">
        {/* Clean Showroom Product Thumbnail */}
        <a
          href={offer.productUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="relative h-28 w-28 shrink-0 overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-white"
          title="Open merchant product page"
        >
          {/* Spoken handle: "the fifth one" / "number 5" picks this offer. */}
          <span
            aria-label={`Offer ${rankIndex + 1}`}
            className={`absolute left-1.5 top-1.5 z-10 flex h-7 w-7 items-center justify-center rounded-full text-sm font-bold tabular-nums shadow ${
              highlighted ? "bg-amber-400 text-neutral-950" : "bg-neutral-950/85 text-white"
            }`}
          >
            {rankIndex + 1}
          </span>
          {offer.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={offer.imageUrl}
              alt={offer.title}
              className="h-full w-full object-contain p-1.5 transition-transform duration-300 group-hover:scale-105"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-[var(--bg-sunken)] text-[11px] text-[var(--ink-muted)]">
              No image
            </div>
          )}
        </a>

        {/* Offer Content */}
        <div className="min-w-0 flex-1 space-y-2.5">
          {/* Top Metadata + Price Row */}
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <span
                className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${badge.classes}`}
              >
                {badge.showCheck && <CheckCircle2 className="h-3 w-3" />}
                <span>{badge.text}</span>
              </span>

              {wasPromotedToTop && (
                <span className="inline-flex items-center gap-0.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 font-[family-name:var(--font-mono)] text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                  <ArrowUpRight className="h-3 w-3" />
                  Shop #{offer.originalSearchRank} → #1
                </span>
              )}
            </div>

            <div className="text-right font-[family-name:var(--font-mono)] text-base font-semibold tracking-tight text-[var(--ink-primary)]">
              {formatMoneyMinor(offer.amountMinor, offer.currency)}
            </div>
          </div>

          {/* Title & Merchant */}
          <div>
            <h3 className="text-[15px] font-semibold leading-snug text-[var(--ink-primary)]">
              {offer.title}
            </h3>
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-[var(--ink-secondary)]">
              <span className="font-medium text-[var(--ink-primary)]/90">
                {offer.sellerName}
              </span>
              <span className="text-[var(--ink-muted)]">·</span>
              <span
                className={
                  offer.availability === "available"
                    ? "text-emerald-600 dark:text-emerald-400"
                    : offer.availability === "unavailable"
                      ? "text-red-500"
                      : "text-[var(--ink-muted)]"
                }
              >
                {offer.availability === "available"
                  ? "In stock"
                  : offer.availability === "unavailable"
                    ? "Sold out"
                    : "Check stock at checkout"}
              </span>
            </div>
          </div>

          {/* Interactive Variant / Size Selectors */}
          {offer.availableOptions && offer.availableOptions.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2 pt-0.5">
              {offer.availableOptions.map((group) => {
                const currentVal =
                  offer.options.find(
                    (o) => o.name.toLowerCase() === group.name.toLowerCase(),
                  )?.label ??
                  group.values[0] ??
                  "";
                return (
                  <label
                    key={`${offer.offerId}_grp_${group.name}`}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-sunken)] px-2.5 py-1 text-xs text-[var(--ink-secondary)] transition-colors hover:border-[var(--border-strong)]"
                  >
                    <span className="text-[var(--ink-muted)]">
                      {group.name}:
                    </span>
                    <select
                      value={currentVal}
                      disabled={isSelectingThis}
                      onChange={(e) =>
                        onSelectVariantOption({
                          item,
                          offer,
                          optionName: group.name,
                          optionValue: e.target.value,
                        })
                      }
                      className="cursor-pointer bg-transparent font-medium text-[var(--ink-primary)] focus:outline-none"
                    >
                      {group.values.map((val) => (
                        <option
                          key={val}
                          value={val}
                          className="bg-[var(--bg-panel)] text-[var(--ink-primary)]"
                        >
                          {val}
                        </option>
                      ))}
                    </select>
                  </label>
                );
              })}
              {isSelectingThis && (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-500" />
              )}
            </div>
          ) : (
            offer.options.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {offer.options.map((opt) => (
                  <span
                    key={`${offer.offerId}_${opt.name}_${opt.label}`}
                    className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-sunken)] px-2.5 py-0.5 text-[11px] text-[var(--ink-secondary)]"
                  >
                    {opt.name}:{" "}
                    <span className="font-medium text-[var(--ink-primary)]">
                      {opt.label}
                    </span>
                  </span>
                ))}
              </div>
            )
          )}

          {variantError && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              {variantError}
            </p>
          )}

          {/* Grounded 1-Sentence Rationale */}
          <p className="text-xs leading-relaxed text-[var(--ink-secondary)]">
            {offer.rationale}
          </p>

          {/* Bottom Actions */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <a
              href={offer.productUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs font-medium text-[var(--ink-secondary)] transition-colors hover:text-[var(--ink-primary)]"
            >
              <span>View on {offer.sellerName}</span>
              <ExternalLink className="h-3 w-3" />
            </a>

            <button
              type="button"
              disabled={isUnavailable || isSelectingThis || anyBuyingInFlight}
              onClick={() => onBuyOnShopify(offer)}
              className="inline-flex items-center gap-1.5 rounded-full bg-emerald-600 px-4 py-2 text-xs font-semibold text-white shadow-xs transition-all hover:bg-emerald-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:cursor-not-allowed disabled:opacity-45 dark:bg-emerald-500 dark:text-neutral-950 dark:hover:bg-emerald-400"
            >
              {isBuyingThis ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>Preparing checkout…</span>
                </>
              ) : (
                <>
                  <ShoppingBag className="h-3.5 w-3.5" />
                  <span>Buy on Shopify</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
      {highlighted && highlightSlot && (
        <div className="mt-4 rounded-xl border border-amber-400/50 bg-amber-400/10 px-3 py-2.5">
          {highlightSlot}
        </div>
      )}
    </div>
  );
}
