import { NextResponse } from "next/server";
import { z } from "zod";
import { routeUtterance } from "@/lib/voice/intent";
import { logServerSpan } from "@/lib/telemetry/logger";

export const runtime = "nodejs";
export const maxDuration = 30;

const BodySchema = z.object({
  utterance: z.string().max(500),
  context: z.object({
    source: z.enum(["youtube", "camera"]),
    hasCapture: z.boolean(),
    hasItems: z.boolean(),
    hasOffers: z.boolean(),
    busy: z.boolean(),
    awaitingConfirm: z.boolean().optional(),
  }),
});

export async function POST(request: Request) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request.", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const started = Date.now();
  const result = await routeUtterance(parsed.data.utterance, parsed.data.context);
  logServerSpan({
    traceId: "voice",
    span: "agent.investigate",
    provider: "decisions",
    status: "ok",
    durationMs: Date.now() - started,
    meta: { intent: result.intent },
  });
  return NextResponse.json(result);
}
