import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import type { ExtractResponse } from "@/lib/types";
import { extractItemsFromYouTube } from "@/lib/video/extract";
import {
  parseAndNormalizeYouTubeUrl,
  YouTubeUrlError,
} from "@/lib/video/youtube";

export const runtime = "nodejs";
export const maxDuration = 120;

const ExtractRequestSchema = z.object({
  youtubeUrl: z.string().min(1).max(2048),
  question: z
    .string()
    .trim()
    .min(3, "Please enter a question about the products in the video.")
    .max(500),
  videoModel: z.string().max(80).optional(),
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

    const { items, diagnostics } = await extractItemsFromYouTube({
      canonicalYoutubeUrl: normalizedVideo.canonicalUrl,
      question: parsed.data.question,
      requestedModel: parsed.data.videoModel,
    });

    const payload: ExtractResponse = {
      traceId: `trace_${crypto.randomUUID()}`,
      videoId: normalizedVideo.videoId,
      canonicalUrl: normalizedVideo.canonicalUrl,
      question: parsed.data.question,
      items,
      diagnostics,
    };

    return NextResponse.json(payload, { status: 200 });
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
