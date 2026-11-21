import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { buildCacheKey, withServerCache } from "@/lib/cache/store";
import { diagnoseRepair } from "@/lib/repair/diagnose";
import { RepairRequestSchema } from "@/lib/repair/request";
import { logServerSpan, type ServerSpanEvent } from "@/lib/telemetry/logger";
import type { TracedItem } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 120;

const REPAIR_CACHE_TTL_MS = 1000 * 60 * 30;

export async function POST(request: Request) {
  let rawJson: unknown;
  try {
    rawJson = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }
  const parsed = RepairRequestSchema.safeParse(rawJson);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    );
  }
  const { imageBase64, mimeType, item, note, ownerReported, bypassCache } = parsed.data;
  const traceId = `trace_${crypto.randomUUID()}`;
  const startedAt = Date.now();

  try {
    const imageHash = crypto
      .createHash("sha256")
      .update(imageBase64)
      .digest("hex");
    const key = buildCacheKey("repair_v1", {
      imageHash,
      label: item.label.trim().toLowerCase(),
      note: (note ?? "").toLowerCase(),
      ownerReported,
    });
    const { value, cacheHit } = await withServerCache({
      key,
      ttlMs: REPAIR_CACHE_TTL_MS,
      bypass: bypassCache,
      compute: () =>
        diagnoseRepair({
          imageBase64,
          mimeType,
          item: item as unknown as TracedItem,
          note,
          ownerReported,
        }),
    });
    logServerSpan({
      traceId,
      // The span union is closed and lives in an existing file; widen here.
      span: "repair.diagnose" as ServerSpanEvent["span"],
      provider: "gemini-4",
      status: "ok",
      durationMs: Date.now() - startedAt,
      cacheHit,
      meta: { decision: value.decision, damageLevel: Number(value.damageLevel.toFixed(3)) },
    });
    return NextResponse.json(
      { ...value, diagnostics: { ...value.diagnostics, cacheHit } },
      { status: 200, headers: { "x-scenetrace-id": traceId } },
    );
  } catch (err) {
    logServerSpan({
      traceId,
      span: "repair.diagnose" as ServerSpanEvent["span"],
      provider: "gemini-4",
      status: "error",
      durationMs: Date.now() - startedAt,
    });
    const message = err instanceof Error ? err.message : "Repair diagnosis failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
