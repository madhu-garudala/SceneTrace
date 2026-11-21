import { getGeminiApiKey } from "@/lib/env";
import { shortenForSpeech } from "./replies";

const TTS_ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash-lite-tts:generateContent";

const cache = new Map<string, Buffer>();
const CACHE_CAP = 64;

/** Wrap raw 24kHz 16-bit mono PCM in a WAV header. */
export function pcmToWav(pcm: Buffer, sampleRate = 24000): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/** Returns WAV bytes, or null on any failure (caller answers 204). */
export async function synthesizeSpeech(rawText: string): Promise<Buffer | null> {
  const text = shortenForSpeech(rawText);
  if (!text) return null;
  const hit = cache.get(text);
  if (hit) return hit;
  try {
    const res = await fetch(TTS_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": getGeminiApiKey(),
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text }] }],
        generationConfig: { responseModalities: ["AUDIO"] },
      }),
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      candidates?: {
        content?: { parts?: { inlineData?: { data?: string; mimeType?: string } }[] };
      }[];
    };
    const inline = json.candidates?.[0]?.content?.parts?.[0]?.inlineData;
    if (!inline?.data) return null;
    const bytes = Buffer.from(inline.data, "base64");
    const isWav = bytes.subarray(0, 4).toString("ascii") === "RIFF";
    const wav = isWav ? bytes : pcmToWav(bytes);
    if (cache.size >= CACHE_CAP) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(text, wav);
    return wav;
  } catch {
    return null;
  }
}
