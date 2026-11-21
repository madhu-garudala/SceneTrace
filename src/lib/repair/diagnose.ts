import { z } from "zod";
import { getDecisionsModel, getGeminiApiKey } from "@/lib/env";
import {
  buildFaults,
  damageLevel,
  decide,
  isOnTopic,
  median,
  rankFaults,
  templatedSummary,
  validReplacement,
} from "@/lib/repair/logic";
import type {
  BankQuestion,
  RepairOffer,
  RepairVerdict,
} from "@/lib/repair/types";
import { retrieveShopifyCandidatesForItem } from "@/lib/shop/client";
import type { CandidateForScoring } from "@/lib/matching/decisions";
import type { TracedItem } from "@/lib/types";
import { getShopLocaleDefaults } from "@/lib/env";

const GENERATE_ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/models";
const DECISIONS_ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/decisions";

const BANK_MODEL = "gemini-4-hydrogen";
const TEXT_MODEL = "gemini-4-carbon";
const MIN_HEALTHY_CONTROLS = 4;

const BankSchema = z.object({
  questions: z
    .array(
      z.object({
        text: z.string().min(5).max(240),
        weight: z.number().finite(),
        polarity: z.enum(["fault", "healthy"]),
      }),
    )
    .min(6)
    .max(40),
});

const BANK_JSON_SCHEMA = {
  type: "object",
  properties: {
    questions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          text: { type: "string" },
          weight: { type: "number" },
          polarity: { type: "string", enum: ["fault", "healthy"] },
        },
        required: ["text", "weight", "polarity"],
      },
    },
  },
  required: ["questions"],
} as const;

const QUERY_SCHEMA = {
  type: "object",
  properties: {
    partQuery: { type: "string" },
    replacementQuery: { type: "string" },
  },
  required: ["partQuery", "replacementQuery"],
} as const;

const SUMMARY_SCHEMA = {
  type: "object",
  properties: { summary: { type: "string" } },
  required: ["summary"],
} as const;

type ImageInput = { imageBase64: string; mimeType: string };

function extractText(raw: Record<string, unknown>): string {
  const candidates = Array.isArray(raw.candidates) ? raw.candidates : [];
  const parts = (
    (candidates[0] as { content?: { parts?: Record<string, unknown>[] } })
      ?.content?.parts ?? []
  ).filter((p) => typeof p.text === "string" && !p.thought);
  const text = parts.map((p) => p.text as string).join("").trim();
  if (!text) throw new Error("Gemini returned no text output.");
  return text;
}

/**
 * Uses generateContent rather than the Interactions endpoint: Interactions
 * rejects `thinking_budget`, and Gemini 4 returns empty text without it.
 */
async function generateJson(params: {
  model: string;
  prompt: string;
  schema: object;
  image?: ImageInput;
  signal?: AbortSignal;
}): Promise<unknown> {
  const parts: Record<string, unknown>[] = [];
  if (params.image) {
    parts.push({
      inlineData: {
        mimeType: params.image.mimeType,
        data: params.image.imageBase64,
      },
    });
  }
  parts.push({ text: params.prompt });

  const timeout = AbortSignal.timeout(40_000);
  const response = await fetch(`${GENERATE_ENDPOINT}/${params.model}:generateContent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": getGeminiApiKey(),
    },
    body: JSON.stringify({
      contents: [{ role: "user", parts }],
      generationConfig: {
        responseMimeType: "application/json",
        responseJsonSchema: params.schema,
        temperature: 0.2,
        // thinkingBudget 0 is mandatory on Gemini 4. Even so it spends ~250
        // hidden tokens, so the ceiling must leave room for the answer.
        maxOutputTokens: 2048,
        thinkingConfig: { thinkingBudget: 0 },
      },
    }),
    signal: params.signal ? AbortSignal.any([params.signal, timeout]) : timeout,
  });
  const rawText = await response.text();
  if (!response.ok) {
    throw new Error(
      `Gemini ${params.model} failed (${response.status}): ${rawText.slice(0, 300)}`,
    );
  }
  return JSON.parse(extractText(JSON.parse(rawText) as Record<string, unknown>));
}

function describeItem(item: TracedItem): string {
  return [
    `Item: ${item.label} (${item.category})`,
    item.brand ? `Brand: ${item.brand}` : null,
    item.modelReference ? `Model: ${item.modelReference}` : null,
    item.features.length
      ? `Observed: ${item.features.map((f) => `${f.name}=${f.value}`).join("; ")}`
      : null,
  ]
    .filter(Boolean)
    .join("\n");
}

export async function writeQuestionBank(params: {
  item: TracedItem;
  image: ImageInput;
  note?: string;
  signal?: AbortSignal;
}): Promise<BankQuestion[]> {
  const prompt = [
    "You are a repair technician inspecting the object in the photo.",
    describeItem(params.item),
    params.note ? `The owner says: "${params.note}"` : null,
    "",
    "Write about 18 closed yes/no diagnostic statements specific to THIS item, each answerable by looking at the photo (no generic filler like 'is it damaged').",
    "Each has a `weight` from 0 to 1 (how much a failure here matters for usability) and a `polarity`:",
    '- "fault": a TRUE answer means something is wrong (e.g. "The ear cushion is cracked or peeling").',
    '- "healthy": a TRUE answer means it is fine (e.g. "Both hinges are intact").',
    `At least ${MIN_HEALTHY_CONTROLS} questions MUST be "healthy" polarity negative controls about parts that could plausibly be fine. Phrase every question as a statement about the object.`,
  ]
    .filter((l) => l !== null)
    .join("\n");

  const raw = await generateJson({
    model: BANK_MODEL,
    prompt,
    schema: BANK_JSON_SCHEMA,
    image: params.image,
    signal: params.signal,
  });
  const parsed = BankSchema.parse(raw);
  const bank = parsed.questions.map((q) => ({
    text: q.text.trim(),
    weight: Math.max(0, Math.min(1, q.weight)),
    polarity: q.polarity,
  }));
  const healthy = bank.filter((q) => q.polarity === "healthy").length;
  if (healthy < MIN_HEALTHY_CONTROLS) {
    throw new Error(
      `Question bank had only ${healthy} healthy-polarity controls (need ${MIN_HEALTHY_CONTROLS}).`,
    );
  }
  return bank;
}

/** One Decisions call, one `noul` question per bank item. */
export async function scoreBank(params: {
  bank: BankQuestion[];
  image: ImageInput;
  signal?: AbortSignal;
}): Promise<(number | null)[]> {
  const questions: Record<string, unknown> = {};
  params.bank.forEach((q, i) => {
    questions[`q_${i}`] = {
      type: "noul",
      instructions: `Looking only at the photo, is this statement true? "${q.text}"`,
      criteria: {
        true_description: "The photo clearly shows the statement to be true.",
        false_description:
          "The photo shows the statement to be false, or the relevant part cannot be seen.",
      },
    };
  });
  const timeout = AbortSignal.timeout(40_000);
  const response = await fetch(DECISIONS_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": getGeminiApiKey(),
    },
    body: JSON.stringify({
      model: getDecisionsModel(),
      input: [
        {
          type: "image",
          data: params.image.imageBase64,
          mime_type: params.image.mimeType,
          resolution: "high",
        },
        { type: "text", text: "Inspect the object in the photo." },
      ],
      questions,
    }),
    signal: params.signal ? AbortSignal.any([params.signal, timeout]) : timeout,
  });
  const rawText = await response.text();
  if (!response.ok) {
    throw new Error(`Decisions API HTTP ${response.status}: ${rawText.slice(0, 300)}`);
  }
  const answers = (JSON.parse(rawText) as {
    answers?: Record<string, { noul?: number }>;
  }).answers;
  if (!answers) throw new Error("Decisions API returned no answers object.");
  return params.bank.map((_, i) => {
    const v = answers[`q_${i}`]?.noul;
    return typeof v === "number" && v >= 0 && v <= 1 ? v : null;
  });
}

async function writeQueries(params: {
  item: TracedItem;
  topFault: string | null;
  note?: string;
  signal?: AbortSignal;
}): Promise<{ partQuery: string; replacementQuery: string }> {
  const known = Boolean(params.item.modelReference?.trim());
  const prompt = [
    "Write two shopping-catalog search strings.",
    describeItem(params.item),
    params.topFault ? `Most likely fault: ${params.topFault}` : null,
    params.note ? `The owner says: "${params.note}"` : null,
    "",
    known
      ? "partQuery: the specific replacement component that fixes the fault, model-specific (include brand and model)."
      : "partQuery: the specific replacement component that fixes the fault, described by brand (if known) and physical characteristics (size, shape, material, fit). The exact model is UNKNOWN: do not guess or invent a model number.",
    "replacementQuery: the whole item, brand new (brand and model only if given above; never guess a model).",
    "Each string is at most 6 words, no filler words.",
  ]
    .filter((l) => l !== null)
    .join("\n");
  const raw = (await generateJson({
    model: TEXT_MODEL,
    prompt,
    schema: QUERY_SCHEMA,
    signal: params.signal,
  })) as { partQuery?: string; replacementQuery?: string };
  const partQuery = String(raw.partQuery ?? "").trim();
  const replacementQuery = String(raw.replacementQuery ?? "").trim();
  if (!partQuery || !replacementQuery) throw new Error("Empty repair queries.");
  return { partQuery, replacementQuery };
}

function toRepairOffer(c: CandidateForScoring): RepairOffer | null {
  if (c.amountMinor === null || c.amountMinor <= 0 || !c.currency) return null;
  if (c.availability === "unavailable") return null;
  return {
    offerId: c.offerId,
    productId: c.productId,
    variantId: c.variantId,
    sellerDomain: c.sellerDomain,
    sellerName: c.sellerName,
    title: c.title,
    amountMinor: c.amountMinor,
    currency: c.currency,
    productUrl: c.productUrl,
    imageUrl: c.imageUrl,
  };
}

async function searchOffers(
  query: string,
  item: TracedItem,
  signal?: AbortSignal,
): Promise<RepairOffer[]> {
  const { country, currency } = getShopLocaleDefaults();
  // Synthetic item: only the query matters. No constraints (a buy-flow budget
  // must not filter parts) and no brand/category fallbacks.
  const probe: TracedItem = {
    ...item,
    itemId: `${item.itemId}_repair`,
    searchQueries: [query],
    brand: null,
    modelReference: null,
    constraints: undefined,
  };
  const { candidates } = await retrieveShopifyCandidatesForItem({
    item: probe,
    primaryFrame: null,
    country,
    currency,
    signal,
  });
  return candidates
    .map(toRepairOffer)
    .filter((o): o is RepairOffer => o !== null)
    .filter((o) => isOnTopic(query, o.title));
}

async function writeSummary(params: {
  decision: string;
  item: TracedItem;
  topFaults: string[];
  part: RepairOffer | null;
  replacement: RepairOffer | null;
  genericMatch: boolean;
  signal?: AbortSignal;
}): Promise<string> {
  const data = {
    decision: params.decision,
    item: params.item.label,
    topFaults: params.topFaults,
    part: params.part && {
      title: params.part.title,
      price: `${params.part.amountMinor / 100} ${params.part.currency}`,
    },
    newReplacement: params.replacement && {
      price: `${params.replacement.amountMinor / 100} ${params.replacement.currency}`,
    },
    partIsGenericEquivalent: params.genericMatch,
  };
  const prompt = [
    "Explain this repair decision to the owner in 1-2 plain sentences.",
    "The decision is already made; do not change or second-guess it. Do not mention any price that is not in the data, and do not describe damage that is not listed in topFaults.",
    "Decision meanings: repair = buy the part; replace = buy a new one; no_action = nothing needs fixing; abstain = no part could be sourced.",
    JSON.stringify(data),
  ].join("\n");
  const raw = (await generateJson({
    model: TEXT_MODEL,
    prompt,
    schema: SUMMARY_SCHEMA,
    signal: params.signal,
  })) as { summary?: string };
  const s = String(raw.summary ?? "").trim();
  if (!s) throw new Error("Empty summary.");
  return s;
}

export async function diagnoseRepair(params: {
  imageBase64: string;
  mimeType: string;
  item: TracedItem;
  note?: string;
  signal?: AbortSignal;
}): Promise<RepairVerdict> {
  const t0 = Date.now();
  const image = { imageBase64: params.imageBase64, mimeType: params.mimeType };
  const { item, note, signal } = params;

  const bank = await timed(() => writeQuestionBank({ item, image, note, signal }));
  const scores = await timed(() => scoreBank({ bank: bank.value, image, signal }));
  const faults = buildFaults(bank.value, scores.value);
  const damage = damageLevel(faults);
  const ranked = rankFaults(faults);
  const topFault = ranked[0]?.question ?? null;

  let partQuery = "";
  let replacementQuery = "";
  let part: RepairOffer | null = null;
  let replacement: RepairOffer | null = null;
  let replacementDropped = false;
  let queryMs = 0;
  let searchMs = 0;

  // Nothing meaningfully wrong: skip part search entirely.
  if (damage >= 0.35) {
    try {
      const q = await timed(() => writeQueries({ item, topFault, note, signal }));
      queryMs = q.ms;
      partQuery = q.value.partQuery;
      replacementQuery = q.value.replacementQuery;
      const s = await timed(() =>
        Promise.all([
          searchOffers(partQuery, item, signal).catch(() => [] as RepairOffer[]),
          searchOffers(replacementQuery, item, signal).catch(() => [] as RepairOffer[]),
        ]),
      );
      searchMs = s.ms;
      const [partOffers, replOffers] = s.value;
      part = [...partOffers].sort((a, b) => a.amountMinor - b.amountMinor)[0] ?? null;
      const med = median(replOffers.map((o) => o.amountMinor));
      if (med !== null) {
        // Report the listing nearest the median so the price shown is a real one.
        const nearest = [...replOffers].sort(
          (a, b) => Math.abs(a.amountMinor - med) - Math.abs(b.amountMinor - med),
        )[0];
        replacement = nearest;
      }
      const kept = validReplacement(replacement, part);
      replacementDropped = replacement !== null && kept === null;
      replacement = kept;
    } catch {
      // query writing failed: leave part null -> abstain
    }
  }

  const decision = decide({ damage, part, replacement, replacementDropped });
  const genericMatch = !item.modelReference?.trim();

  // On no_action the faults are below threshold: don't hand the writer damage to narrate.
  const topFaultTexts =
    decision === "no_action" ? [] : ranked.slice(0, 3).map((f) => f.question);
  let summaryFallback = false;
  const s = await timed(async () => {
    try {
      return await writeSummary({
        decision,
        item,
        topFaults: topFaultTexts,
        part,
        replacement,
        genericMatch,
        signal,
      });
    } catch {
      summaryFallback = true;
      return templatedSummary({
        decision,
        itemLabel: item.label,
        part,
        replacement,
        topFault,
      });
    }
  });
  const summary = s.value;

  return {
    decision,
    summary,
    damageLevel: damage,
    faults,
    part,
    replacement,
    partQuery,
    replacementQuery,
    genericMatch,
    diagnostics: {
      questionBankMs: bank.ms,
      scoringMs: scores.ms,
      queryMs,
      searchMs,
      summaryMs: s.ms,
      totalMs: Date.now() - t0,
      questionCount: bank.value.length,
      summaryFallback,
    },
  };
}

async function timed<T>(fn: () => Promise<T>): Promise<{ value: T; ms: number }> {
  const t = Date.now();
  const value = await fn();
  return { value, ms: Date.now() - t };
}
