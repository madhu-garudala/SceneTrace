"use client";

import { ExternalLink, ShoppingBag, Trash2, X } from "lucide-react";
import { formatMoneyMinor } from "@/lib/shop/freshness";
import type { CheckoutSummary } from "@/lib/types";

export type BagDrawerProps = {
  open: boolean;
  onClose: () => void;
  bag: CheckoutSummary[];
  onOpenCheckout: (checkout: CheckoutSummary) => void;
  onRemove: (checkoutRef: string) => void;
};

/**
 * Everything added this session. Shopify checkouts are per merchant, so each
 * line keeps its own "Check out" link; the bag is the one place to see them all.
 */
export function BagDrawer({ open, onClose, bag, onOpenCheckout, onRemove }: BagDrawerProps) {
  if (!open) return null;

  const totalsByCurrency = new Map<string, number>();
  for (const c of bag) {
    const amount = c.totalMinor ?? c.subtotalMinor;
    if (amount == null || !c.currency) continue;
    totalsByCurrency.set(c.currency, (totalsByCurrency.get(c.currency) ?? 0) + amount);
  }
  const merchants = new Set(bag.map((c) => c.sellerDomain || c.sellerName)).size;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Your bag"
      className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-xs"
      onClick={onClose}
    >
      <aside
        onClick={(e) => e.stopPropagation()}
        className="flex h-full w-full max-w-md flex-col border-l border-[var(--border-subtle)] bg-[var(--bg-panel)] pt-[env(safe-area-inset-top,0px)]"
      >
        <header className="flex items-center justify-between border-b border-[var(--border-subtle)] px-5 py-4">
          <div className="flex items-center gap-2">
            <ShoppingBag className="h-4 w-4 text-emerald-500" />
            <h2 className="text-sm font-semibold text-[var(--ink-primary)]">Your bag</h2>
            <span className="text-xs text-[var(--ink-muted)]">
              {bag.length} item{bag.length === 1 ? "" : "s"}
              {merchants > 1 ? ` · ${merchants} stores` : ""}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close bag"
            className="rounded-full p-1.5 text-[var(--ink-muted)] hover:bg-[var(--bg-sunken)] hover:text-[var(--ink-primary)]"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 space-y-2 overflow-y-auto px-5 py-4">
          {bag.length === 0 && (
            <p className="text-xs text-[var(--ink-muted)]">
              Nothing yet. Say &ldquo;add it to my cart&rdquo; on any offer.
            </p>
          )}
          {bag.map((c) => {
            const amount = c.totalMinor ?? c.subtotalMinor;
            return (
              <div
                key={c.checkoutRef}
                className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-sunken)]/60 p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => onOpenCheckout(c)}
                    className="min-w-0 text-left"
                  >
                    <div className="line-clamp-2 text-xs font-medium text-[var(--ink-primary)] hover:underline">
                      {c.title}
                    </div>
                    <div className="mt-0.5 truncate text-[11px] text-[var(--ink-muted)]">
                      {c.sellerName}
                      {c.options.length > 0
                        ? ` · ${c.options.map((o) => o.label).join(" / ")}`
                        : ""}
                      {c.orderPlaced ? " · Order placed" : ""}
                    </div>
                  </button>
                  <span className="shrink-0 font-[family-name:var(--font-mono)] text-xs text-[var(--ink-primary)]">
                    {amount != null && c.currency ? formatMoneyMinor(amount, c.currency) : "—"}
                  </span>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => onRemove(c.checkoutRef)}
                    className="inline-flex items-center gap-1 text-[11px] text-[var(--ink-muted)] hover:text-red-500"
                  >
                    <Trash2 className="h-3 w-3" />
                    Remove
                  </button>
                  <a
                    href={c.continueUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded-full bg-emerald-600 px-3 py-1 text-[11px] font-semibold text-white hover:bg-emerald-500"
                  >
                    Check out at {c.sellerName}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              </div>
            );
          })}
        </div>

        {totalsByCurrency.size > 0 && (
          <footer className="border-t border-[var(--border-subtle)] px-5 py-4 pb-[calc(env(safe-area-inset-bottom,0px)+16px)]">
            <div className="flex items-center justify-between text-xs">
              <span className="text-[var(--ink-muted)]">Total</span>
              <span className="font-[family-name:var(--font-mono)] font-semibold text-[var(--ink-primary)]">
                {[...totalsByCurrency.entries()]
                  .map(([cur, minor]) => formatMoneyMinor(minor, cur))
                  .join(" + ")}
              </span>
            </div>
          </footer>
        )}
      </aside>
    </div>
  );
}
