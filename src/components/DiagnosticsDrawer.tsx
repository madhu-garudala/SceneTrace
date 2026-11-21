"use client";

import {
  Activity,
  ArrowUpRight,
  Check,
  Terminal,
  TriangleAlert,
  X,
} from "lucide-react";
import type {
  ExtractDiagnostics,
  ItemMatchDiagnostics,
  ManagedAgentReport,
  TracedItem,
} from "@/lib/types";

export type DiagnosticsDrawerProps = {
  open: boolean;
  onClose: () => void;
  traceId: string | null;
  extractDiagnostics: ExtractDiagnostics | null;
  items: TracedItem[];
  agentReportsByItem: Record<string, ManagedAgentReport>;
  matchDiagnosticsByItem: Record<string, ItemMatchDiagnostics>;
};

export function DiagnosticsDrawer({
  open,
  onClose,
  traceId,
  extractDiagnostics,
  items,
  agentReportsByItem,
  matchDiagnosticsByItem,
}: DiagnosticsDrawerProps) {
  if (!open) return null;

  const allItemDiags = Object.values(matchDiagnosticsByItem);
  const allAgentReports = Object.values(agentReportsByItem);
  const shopAnyLive = allItemDiags.some((d) => d.shopLive);
  const decisionsAnyLive = allItemDiags.some((d) => d.decisionsLive);
  const agentAnyLive = allAgentReports.length > 0;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Judge Diagnostics & Ranking Proof"
      className="fixed inset-0 z-50 flex justify-end bg-black/70 backdrop-blur-xs"
      onClick={onClose}
    >
      <div
        className="flex h-full w-full max-w-2xl flex-col border-l border-[var(--border-strong)] bg-[var(--bg-panel)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-5 py-3.5">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-amber-500" />
            <h2 className="font-[family-name:var(--font-mono)] text-xs font-semibold uppercase tracking-wider text-[var(--ink-primary)]">
              Judge Diagnostics · Managed Agent & Decisions Proof
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-[var(--ink-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--ink-primary)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto p-5 text-xs">
          {!extractDiagnostics ? (
            <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-sunken)] p-6 text-center text-[var(--ink-muted)]">
              Run a trace first to inspect live Gemini 4, Managed Agents, Shop
              MCP, and Decisions API telemetry.
            </div>
          ) : (
            <>
              {/* 4-Pillar Provider Live Matrix */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-sunken)] p-3">
                  <div className="flex items-center justify-between font-[family-name:var(--font-mono)] text-[10px] uppercase text-[var(--ink-muted)]">
                    <span>1. Video Extraction</span>
                    <span className="inline-flex items-center gap-1 text-emerald-500">
                      <Check className="h-3 w-3" />{" "}
                      {extractDiagnostics.cacheHit ? "CACHED" : "LIVE"}
                    </span>
                  </div>
                  <div className="mt-1 font-[family-name:var(--font-mono)] text-sm font-semibold text-[var(--ink-primary)]">
                    {extractDiagnostics.videoModel}
                  </div>
                  <div className="mt-0.5 font-[family-name:var(--font-mono)] text-[11px] text-[var(--ink-secondary)]">
                    {(extractDiagnostics.durationMs / 1000).toFixed(2)}s
                    {extractDiagnostics.totalTokens
                      ? ` · ${extractDiagnostics.totalTokens.toLocaleString()} tok`
                      : ""}
                    {extractDiagnostics.droppedItemCount > 0
                      ? ` · ${extractDiagnostics.droppedItemCount} dropped`
                      : ""}
                  </div>
                </div>

                <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-sunken)] p-3">
                  <div className="flex items-center justify-between font-[family-name:var(--font-mono)] text-[10px] uppercase text-[var(--ink-muted)]">
                    <span>2. Managed Agents</span>
                    <span
                      className={
                        agentAnyLive
                          ? "text-emerald-500"
                          : "text-[var(--ink-muted)]"
                      }
                    >
                      {agentAnyLive
                        ? allAgentReports.every((r) => r.cacheHit)
                          ? "CACHED · SANDBOX"
                          : "LIVE · REMOTE SANDBOX"
                        : "STANDBY"}
                    </span>
                  </div>
                  <div className="mt-1 font-[family-name:var(--font-mono)] text-sm font-semibold text-[var(--ink-primary)]">
                    {allAgentReports[0]?.agentId ??
                      "scenetrace-investigator-v1"}
                  </div>
                  <div className="mt-0.5 font-[family-name:var(--font-mono)] text-[11px] text-[var(--ink-secondary)]">
                    {agentAnyLive
                      ? `${allAgentReports.reduce((acc, r) => acc + r.steps.length, 0)} sandbox tool calls`
                      : "v1beta/agents · antigravity"}
                  </div>
                </div>

                <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-sunken)] p-3">
                  <div className="flex items-center justify-between font-[family-name:var(--font-mono)] text-[10px] uppercase text-[var(--ink-muted)]">
                    <span>3. Shop MCP</span>
                    <span
                      className={
                        shopAnyLive ? "text-emerald-500" : "text-amber-500"
                      }
                    >
                      {shopAnyLive ? "LIVE · 2026-07-28" : "IDLE / ERR"}
                    </span>
                  </div>
                  <div className="mt-1 font-[family-name:var(--font-mono)] text-sm font-semibold text-[var(--ink-primary)]">
                    mcp.shop.com
                  </div>
                  <div className="mt-0.5 font-[family-name:var(--font-mono)] text-[11px] text-[var(--ink-secondary)]">
                    {allItemDiags.reduce((acc, d) => acc + d.candidateCount, 0)}{" "}
                    verified variants
                  </div>
                </div>

                <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-sunken)] p-3">
                  <div className="flex items-center justify-between font-[family-name:var(--font-mono)] text-[10px] uppercase text-[var(--ink-muted)]">
                    <span>4. Decisions API</span>
                    <span
                      className={
                        decisionsAnyLive ? "text-emerald-500" : "text-amber-500"
                      }
                    >
                      {decisionsAnyLive ? "LIVE · v1beta" : "FALLBACK / IDLE"}
                    </span>
                  </div>
                  <div className="mt-1 font-[family-name:var(--font-mono)] text-sm font-semibold text-[var(--ink-primary)]">
                    {allItemDiags[0]?.decisionModel ?? "gemini-decision-1"}
                  </div>
                  <div className="mt-0.5 font-[family-name:var(--font-mono)] text-[11px] text-[var(--ink-secondary)]">
                    0 output tokens · calibrated noul
                  </div>
                </div>
              </div>

              {traceId && (
                <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-sunken)] px-3 py-2 font-[family-name:var(--font-mono)] text-[11px] text-[var(--ink-secondary)]">
                  Trace Session: {traceId}
                </div>
              )}

              {/* Per-Item Agent Trace & Rank Comparison Tables */}
              {items.map((item) => {
                const diag = matchDiagnosticsByItem[item.itemId];
                const agentReport = agentReportsByItem[item.itemId];

                return (
                  <div
                    key={item.itemId}
                    className="space-y-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-sunken)] p-4"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="text-sm font-semibold text-[var(--ink-primary)]">
                          {item.label}
                        </div>
                        <div className="mt-0.5 font-[family-name:var(--font-mono)] text-[11px] text-[var(--ink-muted)]">
                          Queries:{" "}
                          {diag?.queriesRun.length
                            ? diag.queriesRun.join(" → ")
                            : item.searchQueries.join(" → ")}
                        </div>
                      </div>
                      {diag && (
                        <div className="flex flex-wrap items-center gap-1.5 font-[family-name:var(--font-mono)] text-[10px]">
                          <span className="rounded border border-[var(--border-strong)] bg-[var(--bg-panel)] px-2 py-0.5 text-[var(--ink-secondary)]">
                            mode: {diag.evidenceMode}
                          </span>
                          <span className="rounded border border-[var(--border-subtle)] bg-[var(--bg-panel)] px-2 py-0.5 text-[var(--ink-muted)]">
                            shop {(diag.shopDurationMs / 1000).toFixed(2)}s ·
                            decisions{" "}
                            {(diag.decisionsDurationMs / 1000).toFixed(2)}s
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Managed Agent Sandbox Execution Trace */}
                    {agentReport && (
                      <div className="rounded border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2 font-[family-name:var(--font-mono)] text-[10px]">
                          <span className="inline-flex items-center gap-1 text-amber-500">
                            <Terminal className="h-3 w-3" />
                            MANAGED AGENT: {agentReport.agentId}
                          </span>
                          <span className="text-[var(--ink-muted)]">
                            env:{" "}
                            {agentReport.environmentId
                              ? agentReport.environmentId.slice(0, 12)
                              : "remote"}{" "}
                            · {(agentReport.durationMs / 1000).toFixed(2)}s
                          </span>
                        </div>
                        {agentReport.steps.length > 0 && (
                          <div className="mt-2 space-y-1.5 border-t border-[var(--border-subtle)] pt-2 font-[family-name:var(--font-mono)] text-[10px] text-[var(--ink-secondary)]">
                            {agentReport.steps.map((st) => (
                              <div key={st.stepIndex}>
                                <span className="text-emerald-500">
                                  [{st.stepIndex}] {st.summary}
                                </span>
                                {st.detail && (
                                  <pre className="mt-0.5 overflow-x-auto whitespace-pre-wrap text-[10px] text-[var(--ink-muted)]">
                                    {st.detail}
                                  </pre>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {diag?.shopError && (
                      <div className="flex items-center gap-2 rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-red-400">
                        <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
                        <span>Shop MCP error: {diag.shopError}</span>
                      </div>
                    )}

                    {diag?.photoSearchError && (
                      <div className="flex items-center gap-2 rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-amber-400">
                        <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
                        <span>
                          Visual search fallback ({diag.photoSearchError})
                        </span>
                      </div>
                    )}

                    {diag?.rankingError && (
                      <div className="flex items-center gap-2 rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-amber-400">
                        <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
                        <span>
                          Decisions API fallback ({diag.rankingError})
                        </span>
                      </div>
                    )}

                    {diag && diag.rankComparison.length > 0 ? (
                      <div className="overflow-x-auto rounded border border-[var(--border-subtle)] bg-[var(--bg-panel)]">
                        <table className="w-full border-collapse text-left font-[family-name:var(--font-mono)] text-[11px]">
                          <thead>
                            <tr className="border-b border-[var(--border-subtle)] text-[10px] uppercase text-[var(--ink-muted)]">
                              <th className="px-2.5 py-2">Final</th>
                              <th className="px-2.5 py-2">Shop</th>
                              <th className="px-2.5 py-2">Candidate</th>
                              <th className="px-2.5 py-2">P(Yes / noul)</th>
                              <th className="px-2.5 py-2">Conf</th>
                              <th className="px-2.5 py-2">Gate / Label</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[var(--border-subtle)]">
                            {diag.rankComparison.map((row) => {
                              const delta = row.originalRank - row.finalRank;
                              return (
                                <tr key={row.offerId}>
                                  <td className="px-2.5 py-2 font-semibold text-[var(--ink-primary)]">
                                    #{row.finalRank}
                                    {delta > 0 && (
                                      <span className="ml-1 inline-flex items-center text-[10px] text-emerald-500">
                                        <ArrowUpRight className="h-3 w-3" />+
                                        {delta}
                                      </span>
                                    )}
                                  </td>
                                  <td className="px-2.5 py-2 text-[var(--ink-muted)]">
                                    #{row.originalRank}
                                  </td>
                                  <td className="max-w-[200px] truncate px-2.5 py-2 font-[family-name:var(--font-sans)] text-[var(--ink-primary)]">
                                    <div>{row.title}</div>
                                    <div className="text-[10px] text-[var(--ink-muted)]">
                                      {row.sellerName}
                                    </div>
                                  </td>
                                  <td className="px-2.5 py-2 font-semibold text-amber-500">
                                    {row.exactMatchYes !== null
                                      ? row.exactMatchYes.toFixed(3)
                                      : "—"}
                                  </td>
                                  <td className="px-2.5 py-2 text-[var(--ink-secondary)]">
                                    {row.confidence !== null
                                      ? row.confidence.toFixed(3)
                                      : "—"}
                                  </td>
                                  <td className="px-2.5 py-2">
                                    <span className="text-[10px] uppercase">
                                      {row.matchLabel}
                                    </span>
                                    {row.hardConflict && (
                                      <div className="mt-0.5 font-[family-name:var(--font-sans)] text-[10px] text-red-400">
                                        Conflict: {row.hardConflict}
                                      </div>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div className="text-[var(--ink-muted)]">
                        {diag
                          ? "Zero catalog candidates returned."
                          : "Matching in progress…"}
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
