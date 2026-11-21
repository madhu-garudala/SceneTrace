"use client";

import { AlertTriangle, ExternalLink, Loader2, ShoppingBag, Wrench } from "lucide-react";
import { formatMoneyMinor } from "@/components/CheckoutModal";
import type { RepairFault, RepairVerdict } from "@/lib/repair/types";

export type RepairPanelProps = {
  verdict: RepairVerdict | null;
  loading: boolean;
  error?: string | null;
  onBuyPart?: () => void;
  onBuyNew?: () => void;
};

function headline(v: RepairVerdict): string {
  const part = v.part ? formatMoneyMinor(v.part.amountMinor, v.part.currency) : null;
  const neu = v.replacement
    ? formatMoneyMinor(v.replacement.amountMinor, v.replacement.currency)
    : null;
  switch (v.decision) {
    case "repair":
      return neu ? `Repair it: ${part} part vs ${neu} new` : `Repair it: ${part} part`;
    case "replace":
      return neu ? `Replace it: ${neu} new, the part is ${part}` : "Replace it";
    case "no_action":
      return "Nothing needs fixing";
    default:
      return "No part could be sourced";
  }
}

const toneClasses: Record<RepairVerdict["decision"], string> = {
  repair: "border-emerald-500/35 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
  replace: "border-amber-500/35 bg-amber-500/12 text-amber-700 dark:text-amber-300",
  no_action:
    "border-[var(--border-subtle)] bg-[var(--bg-sunken)] text-[var(--ink-secondary)]",
  abstain:
    "border-dashed border-[var(--border-strong)] bg-[var(--bg-sunken)] text-[var(--ink-muted)]",
};

const badgeText: Record<RepairVerdict["decision"], string> = {
  repair: "Worth fixing",
  replace: "Not worth fixing",
  no_action: "Looks fine",
  abstain: "Unsure",
};

function FaultBar({ fault }: { fault: RepairFault }) {
  const pct = Math.round(fault.faultProbability * 100);
  return (
    <li className="space-y-1">
      <div className="flex items-baseline justify-between gap-3 text-xs">
        <span className="text-[var(--ink-primary)]">{fault.question}</span>
        <span className="shrink-0 font-[family-name:var(--font-mono)] text-[11px] text-[var(--ink-muted)]">
          {pct}% fault
        </span>
      </div>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-[var(--bg-sunken)]"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-label={fault.question}
      >
        <div
          className={`h-full rounded-full ${pct >= 60 ? "bg-red-500" : pct >= 35 ? "bg-amber-500" : "bg-emerald-500"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </li>
  );
}

export function RepairPanel({
  verdict,
  loading,
  error,
  onBuyPart,
  onBuyNew,
}: RepairPanelProps) {
  if (loading) {
    return (
      <section className="surface-card rounded-3xl p-5 sm:p-6" aria-busy="true">
        <div className="flex items-center gap-2 text-sm text-[var(--ink-secondary)]">
          <Loader2 className="h-4 w-4 animate-spin text-amber-500" />
          <span>Inspecting the item and pricing parts…</span>
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section className="surface-card rounded-3xl p-5 sm:p-6">
        <div className="flex items-start gap-2 text-sm text-amber-700 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>{error}</p>
        </div>
        {onBuyNew && <BuyNewButton onBuyNew={onBuyNew} />}
      </section>
    );
  }

  if (!verdict) return null;

  const topFaults = [...verdict.faults]
    .filter((f) => f.polarity === "fault")
    .sort((a, b) => b.faultProbability * b.weight - a.faultProbability * a.weight)
    .slice(0, 3);
  const showFaults = verdict.decision !== "no_action" && topFaults.length > 0;
  const canBuyPart = verdict.decision !== "no_action" && verdict.part !== null;

  return (
    <section className="surface-card overflow-hidden rounded-3xl">
      <div className="space-y-3 border-b border-[var(--border-subtle)] p-5 sm:p-6">
        <span
          className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${toneClasses[verdict.decision]}`}
        >
          <Wrench className="h-3 w-3" />
          <span>{badgeText[verdict.decision]}</span>
        </span>
        <h2 className="text-lg font-semibold tracking-tight text-[var(--ink-primary)] sm:text-xl">
          {headline(verdict)}
        </h2>
        <p className="text-sm leading-relaxed text-[var(--ink-secondary)]">
          {verdict.summary}
        </p>
        {verdict.decision === "abstain" && (
          <p className="text-xs text-[var(--ink-muted)]">
            We could not find a matching part listing, so there is no repair price to show.
          </p>
        )}
      </div>

      <div className="space-y-5 p-5 sm:p-6">
        {showFaults && (
          <div className="space-y-2.5">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
              What looks wrong
            </h3>
            <ul className="space-y-3">
              {topFaults.map((f) => (
                <FaultBar key={f.question} fault={f} />
              ))}
            </ul>
          </div>
        )}

        {verdict.part && verdict.decision !== "no_action" && (
          <div className="flex flex-col gap-4 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-4 sm:flex-row">
            <a
              href={verdict.part.productUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="relative h-24 w-24 shrink-0 overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-white"
              title="Open merchant product page"
            >
              {verdict.part.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={verdict.part.imageUrl}
                  alt={verdict.part.title}
                  className="h-full w-full object-contain p-1.5"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-[var(--bg-sunken)] text-[11px] text-[var(--ink-muted)]">
                  No image
                </div>
              )}
            </a>
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-[15px] font-semibold leading-snug text-[var(--ink-primary)]">
                  {verdict.part.title}
                </h3>
                <div className="font-[family-name:var(--font-mono)] text-base font-semibold tracking-tight text-[var(--ink-primary)]">
                  {formatMoneyMinor(verdict.part.amountMinor, verdict.part.currency)}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 text-xs text-[var(--ink-secondary)]">
                <span className="font-medium text-[var(--ink-primary)]/90">
                  {verdict.part.sellerName}
                </span>
                <span className="text-[var(--ink-muted)]">·</span>
                <a
                  href={verdict.part.productUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 font-medium transition-colors hover:text-[var(--ink-primary)]"
                >
                  <span>View listing</span>
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
              {verdict.genericMatch && (
                <p className="text-xs text-amber-700 dark:text-amber-300">
                  This is a generic equivalent, not a confirmed match for your exact model.
                  Check fit before you buy.
                </p>
              )}
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-end gap-3">
          {canBuyPart && onBuyPart && (
            <button
              type="button"
              onClick={onBuyPart}
              className="inline-flex items-center gap-1.5 rounded-full bg-emerald-600 px-4 py-2 text-xs font-semibold text-white shadow-xs transition-all hover:bg-emerald-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:bg-emerald-500 dark:text-neutral-950 dark:hover:bg-emerald-400"
            >
              <Wrench className="h-3.5 w-3.5" />
              <span>Buy the part</span>
            </button>
          )}
          {onBuyNew && <BuyNewButton onBuyNew={onBuyNew} inline />}
        </div>
      </div>
    </section>
  );
}

function BuyNewButton({ onBuyNew, inline }: { onBuyNew: () => void; inline?: boolean }) {
  return (
    <div className={inline ? "" : "mt-4 flex justify-end"}>
      <button
        type="button"
        onClick={onBuyNew}
        className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-strong)] bg-[var(--bg-panel)] px-4 py-2 text-xs font-semibold text-[var(--ink-primary)] transition-all hover:bg-[var(--bg-sunken)] focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
      >
        <ShoppingBag className="h-3.5 w-3.5" />
        <span>Buy a new one</span>
      </button>
    </div>
  );
}
