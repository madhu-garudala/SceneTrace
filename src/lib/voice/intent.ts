import { getDecisionsModel, getGeminiApiKey } from "@/lib/env";
import { applyGates } from "./gate";
import { journalTurn } from "./journal";
import { normalizeUtterance } from "./normalize";
import { replyFor } from "./replies";
import type {
  VoiceContext,
  VoiceIntent,
  VoiceIntentResponse,
  VoiceSlots,
} from "./types";
import { VOICE_INTENTS } from "./types";

const DECISIONS_ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/decisions";
const GENERATE_ENDPOINT = (model: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
const SLOT_MODEL = "gemini-4-hydrogen";

export const INTENT_CRITERIA: Record<VoiceIntent, string> = {
  switch_to_camera:
    "The user wants to change the input source to the live camera: 'use the camera', 'switch to camera', 'look at my camera', 'point it at something'. It is about choosing the camera as the source, not about taking a photo.",
  switch_to_youtube:
    "The user wants to go back to a YouTube link or video as the source: 'use a YouTube link', 'go back to the video', 'switch to the video'.",
  capture:
    "The user wants the camera to take a still photo right now: 'take the picture', 'snap it', 'capture this', 'take a photo'. A shutter command, not a product question and not a source switch.",
  trace:
    "The user asks the app to identify or find a product they are looking at: 'which watch is this', 'what are these headphones', 'find this', 'look at this', 'where can I get these shoes'. A question about what an item is or where to buy it. Includes mangled speech like 'little bit my watch'.",
  refine:
    "The user narrows existing results with a constraint: a price cap, a color or a size: 'under 100 dollars', 'in black', 'size 10', 'something cheaper than fifty'. It adds a filter and does not pick a specific offer.",
  select_offer:
    "The user picks one of the listed offers by position or description: 'the second one', 'the cheaper one', 'the first', 'the one from Amazon'. It chooses an offer but does not complete the purchase.",
  checkout:
    "The user wants to purchase the chosen item now: 'buy it', 'check out', 'I'll take it', 'add it to my cart', 'order that', 'I want to buy a new one', 'just buy it'. Buying is the default: if the user says buy, even for something broken, it is checkout. Only when offers exist; with no offers yet it is not checkout. Includes mishearings like 'added to my card'.",
  next_item:
    "The user wants to move on to a different item or restart the search: 'next one', 'scan something else', 'start over', 'another item'. Abandons the current item for a new one.",
  diagnose:
    "The user says the item is damaged or asks about repairing it: 'this is broken', 'something's wrong with it', 'is it worth fixing', 'check it for damage', 'can this be repaired'. Triggers a repair diagnosis. It never includes a wish to buy; 'buy a new one' is checkout.",
  show_evidence:
    "The user asks why this product was matched or for proof: 'why', 'how do you know', 'show me the proof', 'what makes you think that', 'show the evidence'.",
  stop:
    "The user wants the assistant to stop talking or cancel the current action: 'stop', 'be quiet', 'never mind', 'cancel', 'shut up'. Not a request to move to a new item.",
  unknown:
    "Noise, a lone filler word, a fragment, a misheard word, or side conversation not addressed to the assistant: 'then', 'laundrom', 'can you', 'hmm', talking to someone else.",
};

function contextBlurb(ctx: VoiceContext): string {
  return [
    `source=${ctx.source}`,
    ctx.hasCapture ? "a photo is captured" : "no photo captured yet",
    ctx.hasItems ? "products have been identified" : "no products identified yet",
    ctx.hasOffers
      ? "shopping offers are on screen"
      : "no offers on screen yet (so 'buy it' cannot be checkout)",
    ctx.busy ? "the app is busy working" : "the app is idle",
  ].join("; ");
}

type DecisionAnswer = {
  choice?: string;
  confidence?: number;
  probabilities?: Record<string, number>;
};

async function routeWithDecisions(
  text: string,
  ctx: VoiceContext,
): Promise<{ choice: VoiceIntent; confidence: number; probabilities: Record<string, number> }> {
  const body = {
    model: getDecisionsModel(),
    input: [
      {
        type: "text",
        text: `Session state: ${contextBlurb(ctx)}.\nThe user said (speech-to-text, may be misheard): "${text}"`,
      },
    ],
    questions: {
      intent: {
        type: "choice",
        instructions:
          "Which command did the user give a voice shopping assistant? Pick 'unknown' for noise, fragments or side conversation.",
        criteria: INTENT_CRITERIA,
      },
    },
  };
  const res = await fetch(DECISIONS_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": getGeminiApiKey(),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(`Decisions API HTTP ${res.status}: ${raw.slice(0, 200)}`);
  const answer = (JSON.parse(raw) as { answers?: { intent?: DecisionAnswer } })
    .answers?.intent;
  if (!answer?.choice) throw new Error("Decisions API returned no choice.");
  const choice = (VOICE_INTENTS as readonly string[]).includes(answer.choice)
    ? (answer.choice as VoiceIntent)
    : "unknown";
  return {
    choice,
    confidence: answer.confidence ?? 0,
    probabilities: answer.probabilities ?? {},
  };
}

const SLOT_SCHEMA = {
  type: "object",
  properties: {
    question: { type: "string", description: "The shopper's product question, cleaned up. Empty if none." },
    maxPrice: { type: "number", description: "Price cap in dollars, 0 if none." },
    color: { type: "string", description: "Requested color, empty if none." },
    size: { type: "string", description: "Requested size, empty if none." },
    index: { type: "integer", description: "1-based position of the chosen offer (first=1), 0 if none." },
    description: { type: "string", description: "Description of the chosen offer such as 'cheaper', empty if none." },
  },
  required: ["question", "maxPrice", "color", "size", "index", "description"],
};

export async function extractSlots(
  intent: VoiceIntent,
  text: string,
): Promise<VoiceSlots> {
  if (intent !== "trace" && intent !== "refine" && intent !== "select_offer") {
    return {};
  }
  try {
    const res = await fetch(GENERATE_ENDPOINT(SLOT_MODEL), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": getGeminiApiKey(),
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: `Extract slots from a spoken shopping command (intent: ${intent}). The text may be misheard speech-to-text; for 'question' keep the user's own words, only fixing clear mishearings; never invent a brand or product that was not said. Use empty string / 0 for anything not stated.\nCommand: "${text}"`,
              },
            ],
          },
        ],
        generationConfig: {
          // thinking budget 0 is mandatory; max tokens must stay >=512 because
          // hidden thoughts still consume ~250 tokens and truncate the JSON.
          thinkingConfig: { thinkingBudget: 0 },
          maxOutputTokens: 512,
          responseMimeType: "application/json",
          responseSchema: toGeminiSchema(SLOT_SCHEMA),
        },
      }),
      signal: AbortSignal.timeout(6_000),
    });
    if (!res.ok) return withFallback(intent, text, {});
    const json = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const t = json.candidates?.[0]?.content?.parts?.find((p) => p.text)?.text;
    if (!t) return withFallback(intent, text, {});
    return withFallback(intent, text, pickSlots(intent, JSON.parse(t)));
  } catch {
    return withFallback(intent, text, {});
  }
}

function toGeminiSchema(s: unknown): unknown {
  // generateContent uses OpenAPI-style uppercase types.
  const conv = (n: any): any => {
    if (Array.isArray(n)) return n.map(conv);
    if (n && typeof n === "object") {
      return Object.fromEntries(
        Object.entries(n).map(([k, v]) => [
          k,
          k === "type" && typeof v === "string" ? v.toUpperCase() : conv(v),
        ]),
      );
    }
    return n;
  };
  return conv(s);
}

function withFallback(intent: VoiceIntent, text: string, slots: VoiceSlots): VoiceSlots {
  return intent === "trace" && !slots.question ? { ...slots, question: text } : slots;
}

export function pickSlots(intent: VoiceIntent, raw: Record<string, unknown>): VoiceSlots {
  const slots: VoiceSlots = {};
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : undefined);
  if (intent === "trace") {
    const q = str(raw.question);
    if (q) slots.question = q;
  } else if (intent === "refine") {
    const p = num(raw.maxPrice);
    const c = str(raw.color);
    const s = str(raw.size);
    if (p) slots.maxPrice = p;
    if (c) slots.color = c;
    if (s) slots.size = s;
  } else if (intent === "select_offer") {
    const i = num(raw.index);
    const d = str(raw.description);
    if (i) slots.index = Math.round(i);
    if (d) slots.description = d;
  }
  return slots;
}

export async function routeUtterance(
  utterance: string,
  context: VoiceContext,
): Promise<VoiceIntentResponse> {
  const started = Date.now();
  const { heard, normalized } = normalizeUtterance(utterance);
  const text = normalized ?? heard;

  let intent: VoiceIntent = "unknown";
  let confidence = 0;
  let probabilities: Record<string, number> = {};
  let error: string | null = null;

  try {
    const r = await routeWithDecisions(text, context);
    confidence = r.confidence;
    probabilities = r.probabilities;
    const runnerUp = Math.max(
      0,
      ...Object.entries(r.probabilities)
        .filter(([k]) => k !== r.choice)
        .map(([, v]) => v),
    );
    intent = applyGates({ text, intent: r.choice, confidence, runnerUp });
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  const slots = intent === "unknown" ? {} : await extractSlots(intent, text);
  const reply = replyFor(intent, slots, context);
  const response: VoiceIntentResponse = {
    intent,
    confidence,
    probabilities,
    slots,
    reply,
    heard,
    normalized,
  };
  journalTurn({
    utterance: heard,
    heard,
    normalized,
    intent,
    confidence,
    probabilities,
    slots,
    reply,
    latencyMs: Date.now() - started,
    context,
    ...(error ? { error } : {}),
  });
  return response;
}
