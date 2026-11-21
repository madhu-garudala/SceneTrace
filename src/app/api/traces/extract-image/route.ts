import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { buildCacheKey, withServerCache } from "@/lib/cache/store";
import { resolveVideoModel } from "@/lib/env";
import { logServerSpan } from "@/lib/telemetry/logger";
import type { ExtractResponse } from "@/lib/types";
import { extractItemsFromImage } from "@/lib/video/extract";
import {
  ExtractImageRequestSchema,
  MAX_IMAGE_BASE64_CHARS,
} from "@/lib/video/image-input";

export const runtime = "nodejs";
export const maxDuration = 120;

const EXTRACT_IMAGE_CACHE_TTL_MS = 1000 * 60 * 60 * 2; // 2 hours
// JSON envelope headroom on top of the base64 image itself
const MAX_REQUEST_BYTES = MAX_IMAGE_BASE64_CHARS + 16_000;

export async function POST(request: Request) {
  try {
    const declaredLength = Number(request.headers.get("content-length") ?? 0);
    if (declaredLength > MAX_REQUEST_BYTES) {
      return NextResponse.json(
        {
          error:
            "Captured image is too large (limit ~3 MB). Retake at a lower resolution.",
        },
        { status: 400 },
      );
    }

    const rawJson = await request.json();
    const parsed = ExtractImageRequestSchema.safeParse(rawJson);
    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0]?.message ?? "Invalid input.";
      return NextResponse.json({ error: firstIssue }, { status: 400 });
    }

    const imageSha256 = crypto
      .createHash("sha256")
      .update(parsed.data.imageBase64)
      .digest("hex");
    const imageId = `camera_${imageSha256.slice(0, 12)}`;
    const effectiveModel = resolveVideoModel(parsed.data.videoModel);
    const cacheKey = buildCacheKey("extract_image_v1", {
      imageSha256,
      question: parsed.data.question.trim().toLowerCase(),
      model: effectiveModel,
    });

    const reqStartedAt = Date.now();
    const { value: result, cacheHit } = await withServerCache({
      key: cacheKey,
      ttlMs: EXTRACT_IMAGE_CACHE_TTL_MS,
      bypass: parsed.data.bypassCache,
      compute: () =>
        extractItemsFromImage({
          imageBase64: parsed.data.imageBase64,
          mimeType: parsed.data.mimeType,
          question: parsed.data.question,
          requestedModel: effectiveModel,
        }),
    });

    const traceId = `trace_${crypto.randomUUID()}`;
    logServerSpan({
      traceId,
      span: "image.extract",
      provider: effectiveModel,
      status: "ok",
      durationMs: Date.now() - reqStartedAt,
      cacheHit,
      correlationId: result.diagnostics.interactionId ?? null,
      meta: {
        imageId,
        mimeType: parsed.data.mimeType,
        imageBytes: Math.floor((parsed.data.imageBase64.length * 3) / 4),
        itemCount: result.items.length,
      },
    });

    const payload: ExtractResponse = {
      traceId,
      videoId: imageId,
      canonicalUrl: "",
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
    if (err instanceof SyntaxError) {
      return NextResponse.json(
        { error: "Request body must be valid JSON." },
        { status: 400 },
      );
    }
    const message =
      err instanceof Error
        ? err.message
        : "Unexpected error during image extraction.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
