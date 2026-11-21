"use client";

import { useEffect, useState } from "react";
import {
  Activity,
  ArrowUpRight,
  Check,
  Copy,
  Download,
  ExternalLink,
  History,
  Terminal,
  TriangleAlert,
  X,
} from "lucide-react";
import type {
  StoredTraceRecord,
  TraceWaterfallSpan,
} from "@/lib/telemetry/trace-history";
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
  traceHistory: StoredTraceRecord[];
};

function buildLiveSpans(params: {
  extractDiagnostics: ExtractDiagnostics;
  items: TracedItem[];
  agentReportsByItem: Record<string, ManagedAgentReport>;
  matchDiagnosticsByItem: Record<string, ItemMatchDiagnostics>;
}): TraceWaterfallSpan[] {
  const {
    extractDiagnostics,
    items,
    agentReportsByItem,
    matchDiagnosticsByItem,
  } = params;

  const spans: TraceWaterfallSpan[] = [];
  let cursorMs = 0;

  const extDur = extractDiagnostics.cacheHit
    ? 12
    : Math.max(20, extractDiagnostics.durationMs);

  spans.push({
    spanId: "span_extract",
    name: "video.extract",
    service: extractDiagnostics.videoModel,
    startOffsetMs: 0,
    durationMs: extDur,
    status: extractDiagnostics.cacheHit ? "cached" : "ok",
    detail: `${items.length} item(s) traced${extractDiagnostics.totalTokens ? ` · ${extractDiagnostics.totalTokens.toLocaleString()} tok` : ""}`,
    correlationId: extractDiagnostics.interactionId ?? null,
  });
  cursorMs += extDur;

  const agentReports = Object.values(agentReportsByItem);
  if (agentReports.length > 0) {
    const maxAgentDur = agentReports.every((r) => r.cacheHit)
      ? 10
      : Math.max(...agentReports.map((r) => r.durationMs), 25);
    spans.push({
      spanId: "span_agent",
      name: "agent.investigate",
      service: agentReports[0].agentId,
      startOffsetMs: cursorMs,
      durationMs: maxAgentDur,
      status: agentReports.every((r) => r.cacheHit) ? "cached" : "ok",
      detail: `${agentReports.reduce((acc, r) => acc + r.steps.length, 0)} remote sandbox tool step(s)`,
      correlationId:
        agentReports[0].environmentId ?? agentReports[0].interactionId,
    });
    cursorMs += maxAgentDur;
  }

  const itemDiags = Object.values(matchDiagnosticsByItem);
  if (itemDiags.length > 0) {
    const allCached = itemDiags.every((d) => d.cacheHit);
    const maxShopDur = allCached
      ? 8
      : Math.max(...itemDiags.map((d) => d.shopDurationMs), 20);
    const maxDecDur = allCached
      ? 8
      : Math.max(...itemDiags.map((d) => d.decisionsDurationMs), 20);

    spans.push({
      spanId: "span_shop",
      name: "shop.retrieve",
      service: "mcp.shop.com (2026-07-28)",
      startOffsetMs: cursorMs,
      durationMs: maxShopDur,
      status: itemDiags.some((d) => d.shopError)
        ? "error"
        : allCached
          ? "cached"
          : "ok",
      detail: `${itemDiags.reduce((acc, d) => acc + d.candidateCount, 0)} verified Shopify variant(s)`,
    });
    cursorMs += maxShopDur;

    spans.push({
      spanId: "span_decisions",
      name: "decisions.rerank",
      service: itemDiags[0].decisionModel,
      startOffsetMs: cursorMs,
      durationMs: maxDecDur,
      status: itemDiags.some((d) => !d.decisionsLive)
        ? "warning"
        : allCached
          ? "cached"
          : "ok",
      detail: `mode=${itemDiags[0].evidenceMode} · 0 output tokens`,
    });
  }

  return spans;
}

export function DiagnosticsDrawer({
  open,
  onClose,
  traceId,
  extractDiagnostics,
  items,
  agentReportsByItem,
  matchDiagnosticsByItem,
  traceHistory,
}: DiagnosticsDrawerProps) {
  const [selectedHistoryId, setSelectedHistoryId] = useState<string>("active");
  const [copiedId, setCopiedId] = useState(false);

  useEffect(() => {
    if (traceId) {
      setSelectedHistoryId("active");
    } else if (traceHistory.length > 0 && selectedHistoryId === "active") {
      setSelectedHistoryId(traceHistory[0].traceId);
    }
  }, [traceId, traceHistory, selectedHistoryId]);

  if (!open) return null;

  const historicalRecord =
    selectedHistoryId === "active"
      ? traceHistory.find((r) => r.traceId === traceId) ?? null
      : traceHistory.find((r) => r.traceId === selectedHistoryId) ?? null;

  const viewTraceId =
    selectedHistoryId === "active"
      ? traceId ?? historicalRecord?.traceId ?? null
      : historicalRecord?.traceId ?? null;

  const viewExtractDiag =
    selectedHistoryId === "active" && extractDiagnostics
      ? extractDiagnostics
      : historicalRecord?.extractDiagnostics ?? null;

  const viewItems =
    selectedHistoryId === "active" && extractDiagnostics
      ? items
      : historicalRecord?.items ?? [];

  const viewAgentReports =
    selectedHistoryId === "active" && extractDiagnostics
      ? agentReportsByItem
      : historicalRecord?.agentReportsByItem ?? {};

  const viewMatchDiags =
    selectedHistoryId === "active" && extractDiagnostics
      ? matchDiagnosticsByItem
      : historicalRecord?.matchDiagnosticsByItem ?? {};

  const viewSpans =
    historicalRecord?.spans ??
    (viewExtractDiag
      ? buildLiveSpans({
          extractDiagnostics: viewExtractDiag,
          items: viewItems,
          agentReportsByItem: viewAgentReports,
          matchDiagnosticsByItem: viewMatchDiags,
        })
      : []);

  const totalSpanWindowMs = Math.max(
    1,
    ...viewSpans.map((s) => s.startOffsetMs + s.durationMs),
  );

  const allItemDiags = Object.values(viewMatchDiags);
  const allAgentReports = Object.values(viewAgentReports);
  const shopAnyLive = allItemDiags.some((d) => d.shopLive);
  const decisionsAnyLive = allItemDiags.some((d) => d.decisionsLive);
  const agentAnyLive = allAgentReports.length > 0;

  const handleExportJson = () => {
    if (!viewExtractDiag || !viewTraceId) return;
    const exportBundle = {
      exportedAt: new Date().toISOString(),
      traceId: viewTraceId,
      question: historicalRecord?.question ?? null,
      canonicalUrl: historicalRecord?.canonicalUrl ?? null,
      extractDiagnostics: viewExtractDiag,
      spans: viewSpans,
      items: viewItems,
      agentReportsByItem: viewAgentReports,
      matchDiagnosticsByItem: viewMatchDiags,
      checkoutEvents: historicalRecord?.checkoutEvents ?? [],
    };
    const blob = new Blob([JSON.stringify(exportBundle, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `scenetrace-${viewTraceId.slice(0, 14)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Traceability Waterfall & Ranking Proof"
      className="fixed inset-0 z-50 flex justify-end bg-black/70 backdrop-blur-xs"
      onClick={onClose}
    >
      <div
        className="flex h-full w-full max-w-2xl flex-col border-l border-[var(--border-strong)] bg-[var(--bg-panel)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-5 py-4">
          <div className="flex items-center gap-2.5">
            <Activity className="h-4 w-4 text-amber-500" />
            <div>
              <h2 className="text-sm font-semibold text-[var(--ink-primary)]">
                Traceability & Ranking Proof
              </h2>
              <p className="text-[11px] text-[var(--ink-muted)]">
                End-to-end span waterfall · AI Studio correlation · Rerank audit
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {viewExtractDiag && (
              <button
                type="button"
                onClick={handleExportJson}
                className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-sunken)] px-3 py-1 text-xs font-medium text-[var(--ink-secondary)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--ink-primary)]"
              >
                <Download className="h-3 w-3" />
                <span>Export JSON</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="rounded-full p-1.5 text-[var(--ink-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--ink-primary)]"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Trace History Switcher Bar */}
        {traceHistory.length > 0 && (
          <div className="flex items-center justify-between gap-3 border-b border-[var(--border-subtle)] bg-[var(--bg-sunken)]/60 px-5 py-2.5 text-xs">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <History className="h-3.5 w-3.5 shrink-0 text-[var(--ink-muted)]" />
              <select
                aria-label="Select trace run"
                value={selectedHistoryId}
                onChange={(e) => setSelectedHistoryId(e.target.value)}
                className="w-full truncate bg-transparent font-medium text-[var(--ink-primary)] focus:outline-none"
              >
                {extractDiagnostics && traceId && (
                  <option value="active">
                    Current session · {traceId.slice(0, 14)}…
                  </option>
                )}
                {traceHistory
                  .filter((rec) => rec.traceId !== traceId || !extractDiagnostics)
                  .map((rec) => (
                    <option key={rec.traceId} value={rec.traceId}>
                      {new Date(rec.createdAt).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}{" "}
                      · “{rec.question.slice(0, 38)}” ({rec.videoId})
                    </option>
                  ))}
              </select>
            </div>

            <a
              href="https://aistudio.google.com/logs"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex shrink-0 items-center gap-1 text-[11px] font-medium text-[var(--ink-secondary)] hover:text-amber-500"
            >
              <span>AI Studio Logs</span>
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        )}

        <div className="flex-1 space-y-5 overflow-y-auto p-5 text-xs">
          {!viewExtractDiag ? (
            <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-sunken)] p-8 text-center text-[var(--ink-muted)]">
              Run a trace first to inspect the end-to-end span waterfall, Google
              AI Studio interaction IDs, Managed Agent sandbox steps, and
              Decisions reranking audit.
            </div>
          ) : (
            <>
              {/* Correlation Header */}
              {viewTraceId && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-sunken)] px-3.5 py-2.5 font-[family-name:var(--font-mono)] text-[11px]">
                  <span className="truncate text-[var(--ink-secondary)]">
                    traceId:{" "}
                    <span className="text-[var(--ink-primary)]">
                      {viewTraceId}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard?.writeText(viewTraceId);
                      setCopiedId(true);
                      setTimeout(() => setCopiedId(false), 1500);
                    }}
                    className="inline-flex items-center gap-1 text-[10px] text-[var(--ink-muted)] hover:text-[var(--ink-primary)]"
                  >
                    <Copy className="h-3 w-3" />
                    <span>{copiedId ? "Copied" : "Copy ID"}</span>
                  </button>
                </div>
              )}

              {/* Visual Span Waterfall */}
              {viewSpans.length > 0 && (
                <div className="space-y-2.5 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-sunken)] p-4">
                  <div className="flex items-center justify-between">
                    <span className="font-[family-name:var(--font-mono)] text-[10px] font-semibold uppercase tracking-wider text-[var(--ink-secondary)]">
                      Execution Waterfall ({viewSpans.length} spans)
                    </span>
                    <span className="font-[family-name:var(--font-mono)] text-[11px] text-[var(--ink-muted)]">
                      Total {(totalSpanWindowMs / 1000).toFixed(2)}s
                    </span>
                  </div>

                  <div className="space-y-2 pt-1">
                    {viewSpans.map((sp) => {
                      const leftPct = Math.min(
                        92,
                        (sp.startOffsetMs / totalSpanWindowMs) * 100,
                      );
                      const widthPct = Math.max(
                        6,
                        Math.min(
                          100 - leftPct,
                          (sp.durationMs / totalSpanWindowMs) * 100,
                        ),
                      );
                      const barColor =
                        sp.status === "error"
                          ? "bg-red-500"
                          : sp.status === "warning"
                            ? "bg-amber-500"
                            : sp.status === "cached"
                              ? "bg-sky-500"
                              : "bg-emerald-500";

                      return (
                        <div
                          key={sp.spanId}
                          className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-2.5"
                        >
                          <div className="flex items-center justify-between gap-2 font-[family-name:var(--font-mono)] text-[11px]">
                            <div className="flex items-center gap-2 truncate">
                              <span className="font-semibold text-[var(--ink-primary)]">
                                {sp.name}
                              </span>
                              <span className="truncate text-[10px] text-[var(--ink-muted)]">
                                {sp.service}
                              </span>
                            </div>
                            <span className="shrink-0 text-[10px] text-[var(--ink-secondary)]">
                              {sp.status === "cached"
                                ? "cached"
                                : `${(sp.durationMs / 1000).toFixed(2)}s`}
                            </span>
                          </div>

                          {/* Proportional Gantt Bar */}
                          <div className="relative my-1.5 h-2 w-full overflow-hidden rounded-full bg-[var(--bg-sunken)]">
                            <div
                              className={`absolute top-0 h-full rounded-full ${barColor}`}
                              style={{
                                left: `${leftPct}%`,
                                width: `${widthPct}%`,
                              }}
                            />
                          </div>

                          <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-[var(--ink-muted)]">
                            <span>{sp.detail}</span>
                            {sp.correlationId && (
                              <span className="font-[family-name:var(--font-mono)]">
                                id: {sp.correlationId.slice(0, 18)}…
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* 4-Pillar Provider Summary Matrix */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-sunken)] p-3">
                  <div className="flex items-center justify-between font-[family-name:var(--font-mono)] text-[10px] uppercase text-[var(--ink-muted)]">
                    <span>1. Video Extraction</span>
                    <span className="inline-flex items-center gap-1 text-emerald-500">
                      <Check className="h-3 w-3" />{" "}
                      {viewExtractDiag.cacheHit ? "CACHED" : "LIVE"}
                    </span>
                  </div>
                  <div className="mt-1 font-[family-name:var(--font-mono)] text-sm font-semibold text-[var(--ink-primary)]">
                    {viewExtractDiag.videoModel}
                  </div>
                  <div className="mt-0.5 font-[family-name:var(--font-mono)] text-[11px] text-[var(--ink-secondary)]">
                    {(viewExtractDiag.durationMs / 1000).toFixed(2)}s
                    {viewExtractDiag.totalTokens
                      ? ` · ${viewExtractDiag.totalTokens.toLocaleString()} tok`
                      : ""}
                  </div>
                </div>

                <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-sunken)] p-3">
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

                <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-sunken)] p-3">
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

                <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-sunken)] p-3">
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

              {/* Per-Item Agent Trace & Rank Comparison Tables */}
              {viewItems.map((item) => {
                const diag = viewMatchDiags[item.itemId];
                const agentReport = viewAgentReports[item.itemId];

                return (
                  <div
                    key={item.itemId}
                    className="space-y-3 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-sunken)] p-4"
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
                          <span className="rounded-full border border-[var(--border-strong)] bg-[var(--bg-panel)] px-2.5 py-0.5 text-[var(--ink-secondary)]">
                            {diag.evidenceMode}
                          </span>
                        </div>
                      )}
                    </div>

                    {agentReport && (
                      <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2 font-[family-name:var(--font-mono)] text-[10px]">
                          <span className="inline-flex items-center gap-1 text-amber-500">
                            <Terminal className="h-3 w-3" />
                            {agentReport.agentId}
                          </span>
                          <span className="text-[var(--ink-muted)]">
                            sandbox:{" "}
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
                      <div className="flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-red-400">
                        <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
                        <span>Shop MCP error: {diag.shopError}</span>
                      </div>
                    )}

                    {diag?.photoSearchError && (
                      <div className="flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-amber-400">
                        <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
                        <span>
                          Visual search fallback ({diag.photoSearchError})
                        </span>
                      </div>
                    )}

                    {diag?.rankingError && (
                      <div className="flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-amber-400">
                        <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
                        <span>
                          Decisions API fallback ({diag.rankingError})
                        </span>
                      </div>
                    )}

                    {diag && diag.rankComparison.length > 0 ? (
                      <div className="overflow-x-auto rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-panel)]">
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
