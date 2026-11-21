import type {
  ExtractDiagnostics,
  ItemMatchDiagnostics,
  ManagedAgentReport,
  TracedItem,
} from "@/lib/types";

const HISTORY_STORAGE_KEY = "scenetrace-trace-ledger-v1";
const MAX_STORED_TRACES = 12;

export type TraceWaterfallSpan = {
  spanId: string;
  name: string;
  service: string;
  startOffsetMs: number;
  durationMs: number;
  status: "ok" | "cached" | "warning" | "error";
  detail: string;
  correlationId?: string | null;
};

export type StoredTraceRecord = {
  traceId: string;
  createdAt: string;
  videoId: string;
  canonicalUrl: string;
  question: string;
  totalDurationMs: number;
  extractDiagnostics: ExtractDiagnostics;
  items: TracedItem[];
  agentReportsByItem: Record<string, ManagedAgentReport>;
  matchDiagnosticsByItem: Record<string, ItemMatchDiagnostics>;
  spans: TraceWaterfallSpan[];
  checkoutEvents: Array<{
    at: string;
    sellerName: string;
    title: string;
    status: string;
    orderPlaced: boolean;
  }>;
};

export function readStoredTraceHistory(): StoredTraceRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as StoredTraceRecord[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function upsertStoredTraceRecord(record: StoredTraceRecord): void {
  if (typeof window === "undefined") return;
  try {
    const existing = readStoredTraceHistory().filter(
      (r) => r.traceId !== record.traceId,
    );
    const next = [record, ...existing].slice(0, MAX_STORED_TRACES);
    localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Ignore localStorage quota issues
  }
}

export function appendCheckoutEventToTrace(
  traceId: string,
  event: StoredTraceRecord["checkoutEvents"][number],
): StoredTraceRecord[] {
  if (typeof window === "undefined") return [];
  const list = readStoredTraceHistory();
  const updated = list.map((rec) => {
    if (rec.traceId !== traceId) return rec;
    const checkoutSpan: TraceWaterfallSpan = {
      spanId: `span_chk_${rec.checkoutEvents.length + 1}`,
      name: event.orderPlaced ? "Order Confirmed" : "Shopify Checkout Handoff",
      service: "Shop MCP · Checkout",
      startOffsetMs: rec.totalDurationMs,
      durationMs: 650,
      status: "ok",
      detail: `${event.sellerName} · ${event.title} (${event.status})`,
    };
    return {
      ...rec,
      checkoutEvents: [...rec.checkoutEvents, event],
      spans: [...rec.spans, checkoutSpan],
    };
  });
  try {
    localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(updated));
  } catch {
    // ignore
  }
  return updated;
}
