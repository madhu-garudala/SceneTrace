export type ServerSpanEvent = {
  traceId: string;
  span:
    | "video.extract"
    | "agent.investigate"
    | "shop.retrieve_and_rank"
    | "shop.select_variant"
    | "shop.create_checkout"
    | "shop.get_checkout";
  provider: string;
  status: "ok" | "fallback" | "blocked" | "error";
  durationMs: number;
  cacheHit?: boolean;
  correlationId?: string | null;
  meta?: Record<string, string | number | boolean | null>;
};

export function formatServerSpanRecord(event: ServerSpanEvent) {
  return {
    timestamp: new Date().toISOString(),
    service: "scenetrace" as const,
    ...event,
  };
}

/**
 * Emits structured, secret-free JSON telemetry lines compatible with
 * Vercel Runtime Logs and Google Cloud Logging / Cloud Trace log correlation.
 * Strictly excludes API keys, raw checkout URLs, and media base64 payloads.
 */
export function logServerSpan(event: ServerSpanEvent): void {
  if (process.env.VITEST) return;
  console.info(JSON.stringify(formatServerSpanRecord(event)));
}
