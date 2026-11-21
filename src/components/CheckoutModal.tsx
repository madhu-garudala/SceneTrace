"use client";

import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Loader2,
  RefreshCw,
  ShieldCheck,
  ShoppingBag,
  X,
} from "lucide-react";
import { formatMoneyMinor } from "@/lib/shop/freshness";
import type { CheckoutPriceChange, CheckoutSummary } from "@/lib/types";

export { formatMoneyMinor };

export type CheckoutModalProps = {
  open: boolean;
  onClose: () => void;
  loading: boolean;
  error: string | null;
  checkout: CheckoutSummary | null;
  priceChangePrompt: {
    offerTitle: string;
    sellerName: string;
    change: CheckoutPriceChange;
  } | null;
  onConfirmPriceChange: () => void;
  onRefreshStatus: () => void;
  refreshingStatus: boolean;
};

export function CheckoutModal({
  open,
  onClose,
  loading,
  error,
  checkout,
  priceChangePrompt,
  onConfirmPriceChange,
  onRefreshStatus,
  refreshingStatus,
}: CheckoutModalProps) {
  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="checkout-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-xs"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-xl border border-[var(--border-strong)] bg-[var(--bg-panel)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-5 py-3.5">
          <div className="flex items-center gap-2">
            <ShoppingBag className="h-4 w-4 text-emerald-500" />
            <h2
              id="checkout-dialog-title"
              className="text-sm font-semibold text-[var(--ink-primary)]"
            >
              Shopify Hosted Checkout
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close checkout dialog"
            className="rounded p-1 text-[var(--ink-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--ink-primary)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Strictly mutually exclusive states: loading -> priceChangePrompt -> error -> checkout */}
        <div className="max-h-[82vh] space-y-4 overflow-y-auto p-5">
          {loading ? (
            <div className="flex flex-col items-center justify-center gap-3 py-8 text-center">
              <Loader2 className="h-6 w-6 animate-spin text-amber-500" />
              <p className="text-sm font-medium text-[var(--ink-primary)]">
                Verifying live variant & preparing merchant checkout…
              </p>
              <p className="max-w-xs text-xs text-[var(--ink-muted)]">
                Refreshing stock, options, and current price via Shop MCP{" "}
                <code className="font-[family-name:var(--font-mono)]">
                  get_product
                </code>{" "}
                and{" "}
                <code className="font-[family-name:var(--font-mono)]">
                  create_checkout
                </code>
                .
              </p>
            </div>
          ) : priceChangePrompt ? (
            <div className="space-y-4">
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3.5">
                <div className="flex items-start gap-2.5">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                  <div className="space-y-1 text-xs">
                    <p className="font-semibold text-[var(--ink-primary)]">
                      Price updated on fresh catalog check
                    </p>
                    <p className="text-[var(--ink-secondary)]">
                      {priceChangePrompt.sellerName} updated the price for{" "}
                      <span className="font-medium text-[var(--ink-primary)]">
                        {priceChangePrompt.offerTitle}
                      </span>
                      . Review before continuing to Shopify checkout:
                    </p>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-sunken)] p-3.5 font-[family-name:var(--font-mono)] text-xs">
                <div>
                  <div className="text-[10px] uppercase text-[var(--ink-muted)]">
                    Previous Price
                  </div>
                  <div className="mt-0.5 text-sm line-through opacity-70">
                    {formatMoneyMinor(
                      priceChangePrompt.change.previousAmountMinor,
                      priceChangePrompt.change.previousCurrency,
                    )}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase text-amber-500">
                    Current Live Price
                  </div>
                  <div className="mt-0.5 text-sm font-semibold text-[var(--ink-primary)]">
                    {formatMoneyMinor(
                      priceChangePrompt.change.currentAmountMinor,
                      priceChangePrompt.change.currentCurrency,
                    )}
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-2.5">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-md border border-[var(--border-subtle)] px-3.5 py-2 text-xs font-medium text-[var(--ink-secondary)] hover:bg-[var(--bg-elevated)]"
                >
                  Choose Another Offer
                </button>
                <button
                  type="button"
                  onClick={onConfirmPriceChange}
                  className="rounded-md bg-amber-500 px-4 py-2 text-xs font-semibold text-neutral-950 hover:bg-amber-400"
                >
                  Confirm Price & Create Checkout
                </button>
              </div>
            </div>
          ) : error ? (
            <div className="space-y-3">
              <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3.5 text-xs text-red-600 dark:text-red-300">
                <p className="font-semibold">Checkout could not proceed</p>
                <p className="mt-1 opacity-90">{error}</p>
              </div>
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-md border border-[var(--border-subtle)] px-3.5 py-1.5 text-xs font-medium text-[var(--ink-secondary)] hover:text-[var(--ink-primary)]"
                >
                  Close
                </button>
              </div>
            </div>
          ) : checkout ? (
            <div className="space-y-4">
              {checkout.orderPlaced ? (
                <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/12 p-3.5">
                  <div className="flex items-start gap-2.5">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                    <div className="space-y-1 text-xs">
                      <p className="font-semibold text-emerald-600 dark:text-emerald-300">
                        Order Placed — Confirmed by Shopify
                      </p>
                      <p className="text-[var(--ink-secondary)]">
                        Shop MCP reported{" "}
                        <code className="font-[family-name:var(--font-mono)]">
                          status: completed
                        </code>{" "}
                        with a verified order record.
                      </p>
                      {checkout.orderId && (
                        <p className="font-[family-name:var(--font-mono)] text-[11px] text-[var(--ink-primary)]">
                          Order ID: {checkout.orderId}
                        </p>
                      )}
                      {checkout.orderPermalink && (
                        <a
                          href={checkout.orderPermalink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 font-medium text-emerald-500 underline"
                        >
                          View Shopify order confirmation
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-sunken)] p-3.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-wider text-[var(--ink-muted)]">
                      Provider Status
                    </span>
                    <span className="rounded border border-amber-500/35 bg-amber-500/10 px-2 py-0.5 font-[family-name:var(--font-mono)] text-[11px] text-amber-600 dark:text-amber-300">
                      {checkout.status} · awaiting buyer payment
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-[var(--ink-secondary)]">
                    Complete shipping, tax, and payment directly on{" "}
                    <span className="font-medium text-[var(--ink-primary)]">
                      {checkout.sellerName}
                    </span>
                    ’s hosted Shopify checkout, then click{" "}
                    <span className="font-medium text-[var(--ink-primary)]">
                      Check order status
                    </span>{" "}
                    below.
                  </p>
                </div>
              )}

              {/* Verified Line & Totals Breakdown */}
              <div className="space-y-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3.5 text-xs">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-semibold text-[var(--ink-primary)]">
                      {checkout.title}
                    </div>
                    <div className="mt-0.5 text-[var(--ink-secondary)]">
                      Seller: {checkout.sellerName} (
                      <span className="font-[family-name:var(--font-mono)] text-[11px]">
                        {checkout.sellerDomain}
                      </span>
                      )
                    </div>
                  </div>
                  <div className="shrink-0 text-right font-[family-name:var(--font-mono)]">
                    <div className="text-sm font-semibold text-[var(--ink-primary)]">
                      {formatMoneyMinor(
                        checkout.totalMinor ?? checkout.subtotalMinor,
                        checkout.currency,
                      )}
                    </div>
                    <div className="text-[10px] text-[var(--ink-muted)]">
                      Qty 1 · final shipping/tax on Shopify
                    </div>
                  </div>
                </div>

                {checkout.options.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {checkout.options.map((opt) => (
                      <span
                        key={`${opt.name}_${opt.label}`}
                        className="rounded border border-[var(--border-subtle)] bg-[var(--bg-panel)] px-2 py-0.5 font-[family-name:var(--font-mono)] text-[10px] text-[var(--ink-secondary)]"
                      >
                        {opt.name}: {opt.label}
                      </span>
                    ))}
                  </div>
                )}

                {checkout.totalsBreakdown &&
                  checkout.totalsBreakdown.length > 0 && (
                    <div className="mt-2 space-y-1 border-t border-[var(--border-subtle)] pt-2 font-[family-name:var(--font-mono)] text-[11px] text-[var(--ink-secondary)]">
                      {checkout.totalsBreakdown.map((line, idx) => (
                        <div
                          key={`${line.type}_${idx}`}
                          className="flex items-center justify-between"
                        >
                          <span className="capitalize">{line.label}</span>
                          <span>
                            {formatMoneyMinor(
                              line.amountMinor,
                              checkout.currency,
                            )}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
              </div>

              {/* All Provider Notices, Disclosures & Merchant Links */}
              {(checkout.warnings.length > 0 ||
                (checkout.links && checkout.links.length > 0)) && (
                <div className="space-y-2 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-sunken)] px-3 py-2 text-[11px] text-[var(--ink-muted)]">
                  <div className="font-[family-name:var(--font-mono)] text-[10px] uppercase">
                    Shop MCP Disclosures & Merchant Policies
                  </div>
                  {checkout.warnings.length > 0 && (
                    <ul className="list-disc space-y-0.5 pl-4">
                      {checkout.warnings.map((w, i) => (
                        <li key={i}>{w}</li>
                      ))}
                    </ul>
                  )}
                  {checkout.links && checkout.links.length > 0 && (
                    <div className="flex flex-wrap gap-x-3 gap-y-1 pt-0.5">
                      {checkout.links.map((lnk) => (
                        <a
                          key={lnk.url}
                          href={lnk.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-[var(--ink-secondary)] underline hover:text-amber-500"
                        >
                          <span>{lnk.label}</span>
                          <ExternalLink className="h-2.5 w-2.5" />
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Primary Checkout Link & Status Poll */}
              <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
                <button
                  type="button"
                  onClick={onRefreshStatus}
                  disabled={refreshingStatus}
                  className="inline-flex items-center justify-center gap-1.5 rounded-md border border-[var(--border-strong)] bg-[var(--bg-elevated)] px-3.5 py-2.5 text-xs font-medium text-[var(--ink-primary)] transition-colors hover:border-amber-500/50 disabled:opacity-50"
                >
                  <RefreshCw
                    className={`h-3.5 w-3.5 ${refreshingStatus ? "animate-spin" : ""}`}
                  />
                  {refreshingStatus
                    ? "Checking Shopify…"
                    : "Check order status"}
                </button>

                {!checkout.orderPlaced && (
                  <a
                    href={checkout.continueUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center gap-2 rounded-md bg-emerald-500 px-4 py-2.5 text-xs font-semibold text-neutral-950 transition-colors hover:bg-emerald-400"
                  >
                    <span>Open Merchant Shopify Checkout</span>
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                )}
              </div>

              <div className="flex items-center gap-1.5 pt-1 text-[11px] text-[var(--ink-muted)]">
                <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                <span>
                  Payment happens strictly on the merchant’s hosted Shopify
                  checkout. SceneTrace never touches card details.
                </span>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
