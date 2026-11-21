"use client";

import { useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  Film,
  Loader2,
  Play,
  Send,
  Sparkles,
  Terminal,
} from "lucide-react";
import { OfferCard } from "@/components/OfferCard";
import type {
  EvidenceFrame,
  ItemMatchDiagnostics,
  ManagedAgentReport,
  Offer,
  TracedItem,
} from "@/lib/types";
import { formatTimestamp } from "@/lib/video/youtube";

function humanizeTraitName(raw: string): string {
  return raw
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

export type ItemDossierCardProps = {
  item: TracedItem;
  itemIndex: number;
  isSelected: boolean;
  onSelect: () => void;
  onSeekTo: (seconds: number) => void;
  /** False for camera stills: there is no video timeline to jump to. */
  hasTimeline?: boolean;
  frames: EvidenceFrame[];
  offers: Offer[];
  isMatching: boolean;
  isAgentInvestigatingStage: boolean;
  itemDiag?: ItemMatchDiagnostics;
  agentReport?: ManagedAgentReport;
  isAgentRunning: boolean;
  onRunAgent: (followUpPrompt?: string) => void;
  buyingOfferId: string | null;
  selectingVariantOfferId: string | null;
  variantErrorsByOffer: Record<string, string>;
  onSelectVariantOption: (params: {
    item: TracedItem;
    offer: Offer;
    optionName: string;
    optionValue: string;
  }) => void;
  onBuyOnShopify: (offer: Offer) => void;
  country: string;
};

export function ItemDossierCard({
  item,
  itemIndex,
  isSelected,
  onSelect,
  onSeekTo,
  hasTimeline = true,
  frames,
  offers,
  isMatching,
  isAgentInvestigatingStage,
  itemDiag,
  agentReport,
  isAgentRunning,
  onRunAgent,
  buyingOfferId,
  selectingVariantOfferId,
  variantErrorsByOffer,
  onSelectVariantOption,
  onBuyOnShopify,
  country,
}: ItemDossierCardProps) {
  const [followUp, setFollowUp] = useState("");
  const [sandboxLogsOpen, setSandboxLogsOpen] = useState(false);

  return (
    <article
      onClick={onSelect}
      className={`surface-card overflow-hidden rounded-3xl transition-all ${
        isSelected ? "border-[var(--border-strong)]" : ""
      }`}
    >
      {/* Product Dossier Top Section */}
      <div className="border-b border-[var(--border-subtle)] p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded-full bg-[var(--bg-sunken)] px-2.5 py-0.5 font-medium capitalize text-[var(--ink-secondary)]">
                {item.category}
              </span>
              {item.brand && (
                <span className="rounded-full border border-[var(--border-subtle)] px-2.5 py-0.5 font-medium text-[var(--ink-primary)]">
                  {item.brand}
                </span>
              )}
              {item.modelReference && (
                <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 font-[family-name:var(--font-mono)] text-[11px] font-medium text-amber-700 dark:text-amber-300">
                  {item.modelReference}
                </span>
              )}
              {!item.brand && !item.modelReference && (
                <span className="text-[11px] text-[var(--ink-muted)]">
                  Item {itemIndex + 1}
                </span>
              )}
            </div>

            <h2 className="text-lg font-semibold tracking-tight text-[var(--ink-primary)] sm:text-xl">
              {item.label}
            </h2>
          </div>

          {hasTimeline && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onSeekTo(item.bestEvidenceSec);
              }}
              className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/12 px-3.5 py-1.5 text-xs font-medium text-amber-700 transition-colors hover:bg-amber-500/20 dark:text-amber-300"
            >
              <Play className="h-3 w-3 fill-current" />
              <span>Best view · {formatTimestamp(item.bestEvidenceSec)}</span>
            </button>
          )}
        </div>

        <p className="mt-2.5 text-sm leading-relaxed text-[var(--ink-secondary)]">
          {item.summary}
        </p>

        {/* Supporting Scene Frames Strip (when companion media was attached) */}
        {frames.length > 0 && (
          <div className="mt-4 flex items-center gap-2.5 overflow-x-auto pb-1">
            {frames.map((fr, fIdx) => (
              <button
                key={`${item.itemId}_fr_${fIdx}`}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (fr.atSec !== null) onSeekTo(fr.atSec);
                }}
                className="group relative shrink-0 overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-black"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={fr.dataUrl}
                  alt={fr.label}
                  className="h-18 w-32 object-cover transition-transform duration-200 group-hover:scale-105"
                />
                <span className="absolute bottom-1.5 left-1.5 rounded-full bg-black/75 px-2 py-0.5 font-[family-name:var(--font-mono)] text-[10px] text-white backdrop-blur-xs">
                  {fr.kind === "uploaded_still"
                    ? "Reference photo"
                    : fr.kind === "video_crop"
                      ? `Crop · ${fr.atSec !== null ? formatTimestamp(fr.atSec) : ""}`
                      : formatTimestamp(fr.atSec ?? 0)}
                </span>
              </button>
            ))}
          </div>
        )}

        {/* Human-Readable Observed Evidence Tags */}
        {item.features.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-1.5">
            {item.features.slice(0, 6).map((feat, fIdx) => (
              <button
                key={`${item.itemId}_feat_${fIdx}`}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onSeekTo(feat.atSec);
                }}
                title={
                  hasTimeline
                    ? `${humanizeTraitName(feat.name)} (${feat.source} at ${formatTimestamp(feat.atSec)})`
                    : `${humanizeTraitName(feat.name)} (${feat.source})`
                }
                className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-sunken)]/80 px-3 py-1 text-xs text-[var(--ink-secondary)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--ink-primary)]"
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    feat.source === "visible"
                      ? "bg-emerald-500"
                      : feat.source === "spoken"
                        ? "bg-sky-500"
                        : "bg-neutral-400"
                  }`}
                />
                <span>{feat.value}</span>
                {hasTimeline && (
                  <span className="font-[family-name:var(--font-mono)] text-[10px] text-[var(--ink-muted)]">
                    {formatTimestamp(feat.atSec)}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}

        {/* Sleek Managed Agent Research & Refinement Panel */}
        <div
          onClick={(e) => e.stopPropagation()}
          className="mt-5 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-sunken)]/60 p-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="inline-flex items-center gap-1.5 font-semibold text-[var(--ink-primary)]">
                <Sparkles className="h-3.5 w-3.5 text-emerald-500" />
                <span>Agent Research</span>
              </span>
              {agentReport?.msrpEstimate && (
                <span className="rounded-full border border-[var(--border-subtle)] bg-[var(--bg-panel)] px-2.5 py-0.5 font-[family-name:var(--font-mono)] text-[11px] text-[var(--ink-secondary)]">
                  Typical retail: {agentReport.msrpEstimate}
                </span>
              )}
            </div>

            {isAgentRunning ? (
              <span className="inline-flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>Researching in remote sandbox…</span>
              </span>
            ) : agentReport ? (
              <button
                type="button"
                onClick={() => setSandboxLogsOpen((v) => !v)}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--ink-muted)] transition-colors hover:text-[var(--ink-primary)]"
              >
                <Terminal className="h-3 w-3" />
                <span>
                  {sandboxLogsOpen ? "Hide" : "View"} sandbox trace (
                  {agentReport.steps.length})
                </span>
                {sandboxLogsOpen ? (
                  <ChevronUp className="h-3 w-3" />
                ) : (
                  <ChevronDown className="h-3 w-3" />
                )}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onRunAgent()}
                className="rounded-full border border-[var(--border-strong)] bg-[var(--bg-panel)] px-3 py-1 text-xs font-medium text-[var(--ink-primary)] transition-colors hover:bg-[var(--bg-elevated)]"
              >
                Run SKU & price research
              </button>
            )}
          </div>

          {agentReport && (
            <>
              <p className="mt-2 text-xs leading-relaxed text-[var(--ink-secondary)]">
                {agentReport.buyingBrief}
              </p>

              {sandboxLogsOpen && agentReport.steps.length > 0 && (
                <div className="mt-3 space-y-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-3 font-[family-name:var(--font-mono)] text-[10px]">
                  <div className="text-[var(--ink-muted)]">
                    Agent: {agentReport.agentId}
                    {agentReport.environmentId
                      ? ` · Sandbox ${agentReport.environmentId.slice(0, 10)}`
                      : ""}
                  </div>
                  {agentReport.steps.map((st) => (
                    <div key={st.stepIndex}>
                      <div className="text-emerald-600 dark:text-emerald-400">
                        [{st.stepIndex}] {st.summary}
                      </div>
                      {st.detail && (
                        <pre className="mt-0.5 overflow-x-auto whitespace-pre-wrap text-[var(--ink-muted)]">
                          {st.detail}
                        </pre>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Conversational Refinement Input */}
              <div className="mt-3 flex items-center gap-2">
                <input
                  type="text"
                  value={followUp}
                  onChange={(e) => setFollowUp(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && followUp.trim() && !isAgentRunning) {
                      e.preventDefault();
                      const nextPrompt = followUp.trim();
                      setFollowUp("");
                      onRunAgent(nextPrompt);
                    }
                  }}
                  placeholder="Refine offers (e.g., find options under $35, check sizing, or try navy)…"
                  className="flex-1 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-panel)] px-3.5 py-1.5 text-xs text-[var(--ink-primary)] placeholder:text-[var(--ink-muted)] focus:border-[var(--border-strong)] focus:outline-none"
                />
                <button
                  type="button"
                  disabled={!followUp.trim() || isAgentRunning}
                  onClick={() => {
                    const nextPrompt = followUp.trim();
                    if (!nextPrompt) return;
                    setFollowUp("");
                    onRunAgent(nextPrompt);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-full bg-[var(--cta-bg)] px-3.5 py-1.5 text-xs font-semibold text-[var(--cta-ink)] transition-opacity hover:opacity-90 disabled:opacity-40"
                >
                  <Send className="h-3 w-3" />
                  <span>Refine</span>
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Showroom Ranked Offers Section */}
      <div className="bg-[var(--bg-sunken)]/35 p-5 sm:p-6">
        <div className="mb-3.5 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--ink-secondary)]">
              Shopify Offers
            </h3>
            {!isMatching && (
              <span className="rounded-full bg-[var(--bg-panel)] px-2 py-0.5 font-[family-name:var(--font-mono)] text-[11px] text-[var(--ink-muted)]">
                {offers.length}
              </span>
            )}
          </div>

          {itemDiag?.usedVisualSearch && (
            <span className="inline-flex items-center gap-1 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-panel)] px-2.5 py-0.5 text-[11px] text-[var(--ink-secondary)]">
              <Film className="h-3 w-3 text-amber-500" />
              <span>Visual + text search</span>
            </span>
          )}
        </div>

        {(isMatching || (isAgentInvestigatingStage && offers.length === 0)) && (
          <div className="flex items-center gap-3 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-5 text-xs text-[var(--ink-secondary)]">
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-amber-500" />
            <span>
              {isAgentInvestigatingStage
                ? "Verifying SKU and price benchmarks before querying Shopify…"
                : "Searching live Shopify catalog and ranking matches with Gemini Decisions…"}
            </span>
          </div>
        )}

        {!isMatching && itemDiag?.shopError && (
          <div className="rounded-2xl border border-red-500/35 bg-red-500/10 p-4 text-xs text-red-600 dark:text-red-300">
            Shopify search encountered an error: {itemDiag.shopError}
          </div>
        )}

        {!isMatching &&
          !isAgentInvestigatingStage &&
          !itemDiag?.shopError &&
          offers.length === 0 && (
            <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-5 text-xs text-[var(--ink-muted)]">
              No in-stock Shopify listings matched this item in {country}. Try
              broadening the search using the Agent bar above.
            </div>
          )}

        {!isMatching && offers.length > 0 && (
          <div className="space-y-3">
            {offers.map((offer, offerIdx) => (
              <OfferCard
                key={offer.offerId}
                item={item}
                offer={offer}
                rankIndex={offerIdx}
                isBuyingThis={buyingOfferId === offer.offerId}
                anyBuyingInFlight={Boolean(buyingOfferId)}
                isSelectingThis={selectingVariantOfferId === offer.offerId}
                variantError={variantErrorsByOffer[offer.offerId]}
                onSelectVariantOption={onSelectVariantOption}
                onBuyOnShopify={onBuyOnShopify}
              />
            ))}
          </div>
        )}
      </div>
    </article>
  );
}
