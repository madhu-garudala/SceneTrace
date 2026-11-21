import type {
  ExtractDiagnostics,
  ItemMatchDiagnostics,
  ManagedAgentReport,
  Offer,
  TracedItem,
} from "@/lib/types";

const STORAGE_KEY = "scenetrace-client-trace-cache-v1";
const MAX_ENTRIES = 10;
const CLIENT_TTL_MS = 1000 * 60 * 15; // 15 minutes

export type CachedClientTraceSnapshot = {
  cacheKey: string;
  savedAt: number;
  traceId: string;
  videoId: string;
  items: TracedItem[];
  extractDiagnostics: ExtractDiagnostics;
  agentReportsByItem: Record<string, ManagedAgentReport>;
  offersByItem: Record<string, Offer[]>;
  matchDiagnosticsByItem: Record<string, ItemMatchDiagnostics>;
};

export function makeClientTraceCacheKey(params: {
  videoId: string;
  question: string;
  videoModel: string;
  managedAgentEnabled: boolean;
  companionSignature: string;
}): string {
  return [
    params.videoId,
    params.question.trim().toLowerCase(),
    params.videoModel,
    params.managedAgentEnabled ? "agent1" : "agent0",
    params.companionSignature,
  ].join("::");
}

export function readClientTraceCache(
  cacheKey: string,
): CachedClientTraceSnapshot | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const list = JSON.parse(raw) as CachedClientTraceSnapshot[];
    if (!Array.isArray(list)) return null;
    const hit = list.find(
      (entry) =>
        entry.cacheKey === cacheKey &&
        Date.now() - entry.savedAt <= CLIENT_TTL_MS,
    );
    return hit ?? null;
  } catch {
    return null;
  }
}

export function writeClientTraceCache(
  snapshot: CachedClientTraceSnapshot,
): void {
  if (typeof window === "undefined") return;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    const existing = raw ? (JSON.parse(raw) as CachedClientTraceSnapshot[]) : [];
    const filtered = (Array.isArray(existing) ? existing : []).filter(
      (e) =>
        e.cacheKey !== snapshot.cacheKey &&
        Date.now() - e.savedAt <= CLIENT_TTL_MS,
    );
    const next = [snapshot, ...filtered].slice(0, MAX_ENTRIES);
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Ignore storage quota issues
  }
}
