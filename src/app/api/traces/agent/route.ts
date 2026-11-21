import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { runManagedAgentInvestigation } from "@/lib/agent/managed-agent";
import { buildCacheKey, withServerCache } from "@/lib/cache/store";
import { logServerSpan } from "@/lib/telemetry/logger";
import type { EvidenceFrame, TracedItem } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 120;

const AGENT_CACHE_TTL_MS = 1000 * 60 * 60 * 2; // 2 hours

const AgentRequestSchema = z.object({
  traceId: z.string().max(120).optional(),
  question: z.string().min(1).max(500),
  followUpPrompt: z.string().max(400).optional(),
  previousInteractionId: z.string().max(240).nullable().optional(),
  bypassCache: z.boolean().optional().default(false),
  item: z.object({
    itemId: z.string().min(1).max(120),
    category: z.string().min(1).max(120),
    label: z.string().min(1).max(240),
    summary: z.string().max(600),
    sightings: z
      .array(
        z.object({
          startSec: z.number().finite().min(0),
          endSec: z.number().finite().min(0),
          evidenceSec: z.number().finite().min(0),
          observation: z.string().max(500),
        }),
      )
      .min(1)
      .max(12),
    bestEvidenceSec: z.number().finite().min(0),
    bestBox2d: z
      .tuple([z.number(), z.number(), z.number(), z.number()])
      .nullable()
      .optional(),
    features: z
      .array(
        z.object({
          name: z.string().max(120),
          value: z.string().max(300),
          atSec: z.number().finite().min(0),
          source: z.enum(["visible", "spoken", "inferred"]),
        }),
      )
      .max(16),
    brand: z.string().max(160).nullable(),
    modelReference: z.string().max(160).nullable(),
    searchQueries: z.array(z.string().max(200)).max(6),
    constraints: z
      .object({
        maxPriceMajor: z.number().nullable(),
        currency: z.string().nullable(),
        requestedSize: z.string().nullable(),
        requestedColor: z.string().nullable(),
      })
      .optional(),
  }),
  primaryFrame: z
    .object({
      kind: z
        .enum(["video_frame", "video_crop", "uploaded_still"])
        .optional()
        .default("video_frame"),
      atSec: z.number().finite().min(0).nullable(),
      mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
      dataBase64: z.string().min(16).max(950_000),
      dataUrl: z.string().max(2048).optional().default(""),
      width: z.number().int().positive().max(4096),
      height: z.number().int().positive().max(4096),
      label: z.string().max(160),
    })
    .nullable()
    .optional(),
});

export async function POST(request: Request) {
  try {
    const rawJson = await request.json();
    const parsed = AgentRequestSchema.safeParse(rawJson);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error:
            parsed.error.issues[0]?.message ?? "Invalid Managed Agent request.",
        },
        { status: 400 },
      );
    }

    const item: TracedItem = parsed.data.item;
    const primaryFrame: EvidenceFrame | null = parsed.data.primaryFrame ?? null;
    const frameDigest = primaryFrame?.dataBase64
      ? crypto
          .createHash("sha256")
          .update(primaryFrame.dataBase64)
          .digest("hex")
          .slice(0, 16)
      : "no_frame";

    const cacheKey = buildCacheKey("agent_v1", {
      label: item.label.trim().toLowerCase(),
      brand: item.brand?.toLowerCase() ?? null,
      ref: item.modelReference?.toLowerCase() ?? null,
      queries: item.searchQueries,
      question: parsed.data.question.trim().toLowerCase(),
      followUp: parsed.data.followUpPrompt?.trim().toLowerCase() ?? "",
      prevInteraction: parsed.data.previousInteractionId ?? "",
      frameDigest,
    });

    const reqStartedAt = Date.now();
    const { value: cachedOrFresh, cacheHit } = await withServerCache({
      key: cacheKey,
      ttlMs: AGENT_CACHE_TTL_MS,
      bypass: parsed.data.bypassCache,
      compute: () =>
        runManagedAgentInvestigation({
          item,
          question: parsed.data.question,
          followUpPrompt: parsed.data.followUpPrompt,
          previousInteractionId: parsed.data.previousInteractionId,
          primaryFrame,
        }),
    });

    logServerSpan({
      traceId: parsed.data.traceId ?? "trace_standalone",
      span: "agent.investigate",
      provider: cachedOrFresh.report.agentId,
      status: "ok",
      durationMs: Date.now() - reqStartedAt,
      cacheHit,
      correlationId: cachedOrFresh.report.interactionId,
      meta: {
        sandboxEnv: cachedOrFresh.report.environmentId,
        stepCount: cachedOrFresh.report.steps.length,
      },
    });

    return NextResponse.json(
      {
        report: {
          ...cachedOrFresh.report,
          cacheHit,
        },
        updatedItem: {
          ...cachedOrFresh.updatedItem,
          itemId: item.itemId,
        },
      },
      { status: 200 },
    );
  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : "Gemini Managed Agent execution failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
