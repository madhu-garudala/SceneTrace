import { z } from "zod";
import { synthesizeSpeech } from "@/lib/voice/tts";

export const runtime = "nodejs";
export const maxDuration = 30;

const BodySchema = z.object({ text: z.string().min(1).max(1000) });

export async function POST(request: Request) {
  try {
    const parsed = BodySchema.safeParse(await request.json());
    if (!parsed.success) return new Response(null, { status: 204 });
    const wav = await synthesizeSpeech(parsed.data.text);
    if (!wav) return new Response(null, { status: 204 });
    return new Response(new Uint8Array(wav), {
      status: 200,
      headers: { "Content-Type": "audio/wav", "Cache-Control": "no-store" },
    });
  } catch {
    return new Response(null, { status: 204 });
  }
}
