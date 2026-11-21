import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { buildCacheKey, withServerCache } from "@/lib/cache/store";
import { resolveVideoModel } from "@/lib/env";
import { logServerSpan } from "@/lib/telemetry/logger";
import type { ExtractResponse } from "@/lib/types";
import { extractItemsFromYouTube } from "@/lib/video/extract";
import {
  parseAndNormalizeYouTubeUrl,
  YouTubeUrlError,
} from "@/lib/video/youtube";

export const runtime = "nodejs";
export const maxDuration = 120;

const EXTRACT_CACHE_TTL_MS = 1000 * 60 * 60 * 2; // 2 hours

const ExtractRequestSchema = z.object({
  youtubeUrl: z.string().min(1).max(2048),
  question: z
    .string()
    .trim()
    .min(3, "Please enter a question about the products in the video.")
    .max(500),
  videoModel: z.string().max(80).optional(),
  bypassCache: z.boolean().optional().default(false),
});

export async function POST(request: Request) {
  try {
    const rawJson = await request.json();
    const parsed = ExtractRequestSchema.safeParse(rawJson);
    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0]?.message ?? "Invalid input.";
      return NextResponse.json({ error: firstIssue }, { status: 400 });
    }

    const normalizedVideo = parseAndNormalizeYouTubeUrl(
      parsed.data.youtubeUrl,
    );
    const effectiveModel = resolveVideoModel(parsed.data.videoModel);
    const cacheKey = buildCacheKey("extract_v1", {
      videoId: normalizedVideo.videoId,
      question: parsed.data.question.trim().toLowerCase(),
      model: effectiveModel,
    });

    const reqStartedAt = Date.now();
    const { value: result, cacheHit } = await withServerCache({
      key: cacheKey,
      ttlMs: EXTRACT_CACHE_TTL_MS,
      bypass: parsed.data.bypassCache,
      compute: () =>
        extractItemsFromYouTube({
          canonicalYoutubeUrl: normalizedVideo.canonicalUrl,
          question: parsed.data.question,
          requestedModel: effectiveModel,
        }),
    });

    const traceId = `trace_${crypto.randomUUID()}`;
    logServerSpan({
      traceId,
      span: "video.extract",
      provider: effectiveModel,
      status: "ok",
      durationMs: Date.now() - reqStartedAt,
      cacheHit,
      correlationId: result.diagnostics.interactionId ?? null,
      meta: {
        videoId: normalizedVideo.videoId,
        itemCount: result.items.length,
      },
    });

    const payload: ExtractResponse = {
      traceId,
      videoId: normalizedVideo.videoId,
      canonicalUrl: normalizedVideo.canonicalUrl,
      question: parsed.data.question,
      items: result.items,
      diagnostics: {
        ...result.diagnostics,
        cacheHit,
      },
    };

    return NextResponse.json(payload, {
      status: 200,
      headers: { "x-scenetrace-id": traceId },
    });
  } catch (err) {
    if (err instanceof YouTubeUrlError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    const message =
      err instanceof Error
        ? err.message
        : "Unexpected error during video extraction.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
