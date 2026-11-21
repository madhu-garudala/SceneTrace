import crypto from "node:crypto";
import { z } from "zod";
import { getGeminiApiKey, resolveVideoModel } from "@/lib/env";
import type {
  BoundingBox2D,
  ExtractDiagnostics,
  ItemCondition,
  ShopperConstraints,
  TracedItem,
} from "@/lib/types";
import { mapClipTimestampToOriginal } from "@/lib/video/youtube";

const INTERACTIONS_ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/interactions";

const RawObservedFeatureSchema = z.object({
  name: z.string().min(1).max(80),
  value: z.string().min(1).max(240),
  atSec: z.number().finite().min(0),
  source: z.enum(["visible", "spoken", "inferred"]),
});

const RawSightingSchema = z.object({
  startSec: z.number().finite().min(0),
  endSec: z.number().finite().min(0),
  evidenceSec: z.number().finite().min(0),
  observation: z.string().min(1).max(320),
});

const RawItemConditionSchema = z.object({
  damageVisible: z.boolean(),
  signs: z.array(z.string().max(160)).max(8),
});

const RawExtractedItemSchema = z.object({
  category: z.string().min(1).max(80),
  label: z.string().min(1).max(160),
  summary: z.string().min(1).max(360),
  brand: z.string().max(120).optional().default(""),
  modelReference: z.string().max(160).optional().default(""),
  bestEvidenceSec: z.number().finite().min(0),
  bestBox2d: z.array(z.number().finite()).optional().default([]),
  sightings: z.array(RawSightingSchema).min(1).max(8),
  features: z.array(RawObservedFeatureSchema).max(10),
  searchQueries: z.array(z.string().min(1).max(160)).min(1).max(4),
  // Image path only; a malformed condition is dropped, never the whole item.
  condition: RawItemConditionSchema.optional().catch(undefined),
});

const RawShopperConstraintsSchema = z
  .object({
    maxPriceMajor: z.number().finite().nonnegative().optional().default(0),
    currency: z.string().max(8).optional().default(""),
    requestedSize: z.string().max(40).optional().default(""),
    requestedColor: z.string().max(60).optional().default(""),
  })
  .optional();

const EXTRACTION_JSON_SCHEMA = {
  type: "object",
  properties: {
    videoSummary: {
      type: "string",
      description:
        "One concise sentence summarizing the scene and how it relates to the shopper's question.",
    },
    shopperConstraints: {
      type: "object",
      description:
        "Explicit shopping filters stated in the shopper's question (leave 0 / empty string if not explicitly requested by the shopper).",
      properties: {
        maxPriceMajor: {
          type: "number",
          description:
            "Maximum budget in major currency units if explicitly stated (e.g., 80 for 'under $80'), else 0.",
        },
        currency: {
          type: "string",
          description:
            "3-letter currency code if budget was stated (e.g., 'USD'), else empty string.",
        },
        requestedSize: {
          type: "string",
          description:
            "Explicit size requested by the shopper (e.g., '10', 'M'), else empty string.",
        },
        requestedColor: {
          type: "string",
          description:
            "Explicit color constraint requested by the shopper if filtering, else empty string.",
        },
      },
      required: [
        "maxPriceMajor",
        "currency",
        "requestedSize",
        "requestedColor",
      ],
    },
    items: {
      type: "array",
      description:
        "Distinct shoppable products in the video relevant to the shopper's question (up to 6 items). Return an empty array if none appear.",
      items: {
        type: "object",
        properties: {
          category: {
            type: "string",
            description:
              "Concise product category (e.g., sneakers, wristwatch, jacket, backpack, sunglasses, coffee mug, hoodie).",
          },
          label: {
            type: "string",
            description:
              "Clear shopper-facing item title grounded in evidence.",
          },
          summary: {
            type: "string",
            description:
              "One grounded sentence explaining what is confirmed about this item and any remaining visual uncertainty.",
          },
          brand: {
            type: "string",
            description:
              "Confirmed or strongly supported brand name, or empty string if unknown/unreadable.",
          },
          modelReference: {
            type: "string",
            description:
              "Exact model name, colorway name, SKU, or reference code if visible or spoken, or empty string if unknown.",
          },
          bestEvidenceSec: {
            type: "number",
            description:
              "Timestamp in seconds (from 0.0 at video start) with the sharpest close-up or clearest view of the item.",
          },
          bestBox2d: {
            type: "array",
            description:
              "4 integers [ymin, xmin, ymax, xmax] normalized 0..1000 tightly bounding the item at bestEvidenceSec, or empty array [] if uncertain.",
            items: { type: "number" },
          },
          sightings: {
            type: "array",
            description:
              "Every distinct scene/shot interval where this exact item appears (up to 8 sightings).",
            items: {
              type: "object",
              properties: {
                startSec: { type: "number" },
                endSec: { type: "number" },
                evidenceSec: { type: "number" },
                observation: { type: "string" },
              },
              required: ["startSec", "endSec", "evidenceSec", "observation"],
            },
          },
          features: {
            type: "array",
            description:
              "Specific identifying traits (up to 8) such as primary_color, logo_text, material, silhouette, sole_color, hardware, or spoken_name.",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                value: { type: "string" },
                atSec: { type: "number" },
                source: {
                  type: "string",
                  enum: ["visible", "spoken", "inferred"],
                },
              },
              required: ["name", "value", "atSec", "source"],
            },
          },
          searchQueries: {
            type: "array",
            description:
              "2 to 3 clean Shopify catalog search queries ordered from most specific (brand + model + colorway) to broader visual description (color + material + category).",
            items: { type: "string" },
          },
        },
        required: [
          "category",
          "label",
          "summary",
          "brand",
          "modelReference",
          "bestEvidenceSec",
          "bestBox2d",
          "sightings",
          "features",
          "searchQueries",
        ],
      },
    },
  },
  required: ["videoSummary", "shopperConstraints", "items"],
} as const;

const ITEM_CONDITION_JSON_SCHEMA = {
  type: "object",
  description:
    "Visible physical condition of this exact item in the photo.",
  properties: {
    damageVisible: {
      type: "boolean",
      description:
        "true only if the photo clearly shows damage such as cracks, breaks, tears, missing parts, dents, stains, or heavy wear; false when the item looks fine.",
    },
    signs: {
      type: "array",
      description:
        "Each visible damage sign as a short phrase (e.g., 'cracked left hinge', 'peeling earpad'), or empty array [] when damageVisible is false.",
      items: { type: "string" },
    },
  },
  required: ["damageVisible", "signs"],
} as const;

// Still photos share the video schema and add a per-item `condition` field.
const IMAGE_EXTRACTION_JSON_SCHEMA = {
  ...EXTRACTION_JSON_SCHEMA,
  properties: {
    ...EXTRACTION_JSON_SCHEMA.properties,
    items: {
      ...EXTRACTION_JSON_SCHEMA.properties.items,
      items: {
        ...EXTRACTION_JSON_SCHEMA.properties.items.items,
        properties: {
          ...EXTRACTION_JSON_SCHEMA.properties.items.items.properties,
          condition: ITEM_CONDITION_JSON_SCHEMA,
        },
        required: [
          ...EXTRACTION_JSON_SCHEMA.properties.items.items.required,
          "condition",
        ],
      },
    },
  },
};

export type ExtractionMediaSource = "video" | "image";

function buildExtractionPrompt(
  question: string,
  source: ExtractionMediaSource,
  retryHint?: string,
): string {
  const isImage = source === "image";
  return [
    "You are SceneTrace, a forensic multimodal product-identification analyst.",
    isImage
      ? "Analyze the single still photo (visible products, close-up details, printed text, and logos) to answer the shopper's question."
      : "Analyze the full video (visual frames, close-ups, on-screen text/captions, and spoken audio) to answer the shopper's question.",
    "",
    `Shopper question: "${question.trim()}"`,
    "",
    "Strict extraction rules:",
    "1. Return ONLY shoppable physical products relevant to the shopper's question (shoes, clothing, watches, bags, accessories, tech, home/desk items, or any retail product).",
    isImage
      ? "2. Distinct products: Report each distinct product in the photo once. Keep two items SEPARATE if their model, colorway, or distinguishing details conflict."
      : "2. Cross-scene tracking: Merge multiple appearances across cuts into ONE item when visual/spoken evidence corroborates it is the same product. Keep two items SEPARATE if their model, colorway, or distinguishing details conflict.",
    isImage
      ? "3. Still photo timing & box precision: This is a single still image, so set every timestamp (`startSec`, `endSec`, `evidenceSec`, `bestEvidenceSec`, `atSec`) to 0 and return exactly one sighting per item. Provide `bestBox2d` as `[ymin, xmin, ymax, xmax]` (0..1000 scale) tightly around the product in the photo."
      : "3. Timestamp & box precision: All timestamps MUST be seconds from 0.0 at video start. Pick `bestEvidenceSec` inside one of the item's sightings at the sharpest close-up, and provide `bestBox2d` as `[ymin, xmin, ymax, xmax]` (0..1000 scale) around the product at `bestEvidenceSec` when visible.",
    "4. Honest uncertainty: Set `brand` or `modelReference` to \"\" unless directly visible in frame, clearly spoken, or unmistakable from signature markings. Never invent serial numbers.",
    isImage
      ? "5. Provenance: Mark every feature strictly as `visible` or `inferred` (a still photo has no audio, so never `spoken`)."
      : "5. Provenance: Mark every feature strictly as `visible`, `spoken`, or `inferred`.",
    "6. Shopper constraints: Populate `shopperConstraints` ONLY when the shopper explicitly stated a budget (e.g., 'under $50'), size (e.g., 'size 10'), or color filter in their question.",
    "7. Search queries: Provide 2–3 clean Shopify catalog search strings per item (no filler words like 'buy' or 'best').",
    isImage
      ? "8. Condition: Set `condition.damageVisible` to true only when the photo clearly shows damage on the item (cracks, breaks, tears, missing parts, dents, stains, heavy wear) and list each sign in `condition.signs`; otherwise false and []. Condition never changes which product it is or the search queries."
      : "",
    retryHint ? `\nIMPORTANT CORRECTION FOR RETRY: ${retryHint}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function extractModelJsonText(rawBody: Record<string, unknown>): string {
  if (typeof rawBody.output_text === "string" && rawBody.output_text.trim()) {
    return rawBody.output_text.trim();
  }

  const steps = Array.isArray(rawBody.steps) ? rawBody.steps : [];
  for (let i = steps.length - 1; i >= 0; i--) {
    const step = steps[i] as Record<string, unknown> | undefined;
    if (!step) continue;
    if (step.type === "model_output" && Array.isArray(step.content)) {
      for (const part of step.content) {
        const p = part as Record<string, unknown>;
        if (p.type === "text" && typeof p.text === "string" && p.text.trim()) {
          return p.text.trim();
        }
      }
    }
  }

  const outputs = Array.isArray(rawBody.outputs) ? rawBody.outputs : [];
  for (let i = outputs.length - 1; i >= 0; i--) {
    const out = outputs[i] as Record<string, unknown> | undefined;
    if (out && typeof out.text === "string" && out.text.trim()) {
      return out.text.trim();
    }
  }

  throw new Error(
    "Gemini Interactions API returned no structured text output.",
  );
}

function normalizeBox2d(rawBox: number[] | undefined): BoundingBox2D | null {
  if (!Array.isArray(rawBox) || rawBox.length !== 4) return null;
  const [ymin, xmin, ymax, xmax] = rawBox.map((v) =>
    Math.max(0, Math.min(1000, Math.round(v))),
  );
  if (ymax - ymin < 25 || xmax - xmin < 25) return null;
  return [ymin, xmin, ymax, xmax];
}

function normalizeCondition(
  raw: z.infer<typeof RawItemConditionSchema> | undefined,
): ItemCondition | undefined {
  if (!raw) return undefined;
  const signs = Array.from(
    new Set(raw.signs.map((s) => s.trim()).filter(Boolean)),
  );
  const damageVisible = raw.damageVisible && signs.length > 0;
  return { damageVisible, signs: damageVisible ? signs : [] };
}

function parseConstraints(raw: unknown): ShopperConstraints | undefined {
  const parsed = RawShopperConstraintsSchema.safeParse(raw);
  if (!parsed.success || !parsed.data) return undefined;
  const d = parsed.data;
  const maxPriceMajor = d.maxPriceMajor > 0 ? d.maxPriceMajor : null;
  const currency = d.currency.trim() ? d.currency.trim().toUpperCase() : null;
  const requestedSize = d.requestedSize.trim() ? d.requestedSize.trim() : null;
  const requestedColor = d.requestedColor.trim()
    ? d.requestedColor.trim()
    : null;
  if (!maxPriceMajor && !requestedSize && !requestedColor) return undefined;
  return { maxPriceMajor, currency, requestedSize, requestedColor };
}

/**
 * Normalizes raw parsed extraction JSON, isolating per-item validation failures
 * so one malformed item never drops other valid items.
 */
export function normalizeRawExtractionPayload(
  rawPayload: unknown,
  options?: {
    clipStartOffsetSec?: number;
    videoDurationSec?: number;
    /** Single still photo: pin every timestamp to 0 and keep one sighting. */
    stillImage?: boolean;
  },
): {
  videoSummary: string;
  items: TracedItem[];
  droppedItemCount: number;
} {
  if (!rawPayload || typeof rawPayload !== "object") {
    throw new Error("Extraction response is not a JSON object.");
  }
  const obj = rawPayload as Record<string, unknown>;
  const videoSummary =
    typeof obj.videoSummary === "string" ? obj.videoSummary.trim() : "";
  const constraints = parseConstraints(obj.shopperConstraints);
  const rawItems = Array.isArray(obj.items) ? obj.items.slice(0, 6) : null;
  if (!rawItems) {
    throw new Error("Extraction response missing `items` array.");
  }

  const offset = options?.clipStartOffsetSec ?? 0;
  const maxDur = options?.videoDurationSec;
  const stillImage = Boolean(options?.stillImage);
  const toSec = (sec: number) =>
    stillImage ? 0 : mapClipTimestampToOriginal(sec, offset, maxDur);

  const normalizedItems: TracedItem[] = [];
  let droppedItemCount = 0;

  for (let index = 0; index < rawItems.length; index++) {
    const parsedItem = RawExtractedItemSchema.safeParse(rawItems[index]);
    if (!parsedItem.success) {
      droppedItemCount++;
      continue;
    }

    const raw = parsedItem.data;
    const sightings = (stillImage ? raw.sightings.slice(0, 1) : raw.sightings)
      .map((s) => {
        const start = toSec(s.startSec);
        const end = Math.max(start, toSec(s.endSec));
        const evRaw = toSec(s.evidenceSec);
        const evidenceSec = Math.min(Math.max(evRaw, start), end);
        return {
          startSec: start,
          endSec: end,
          evidenceSec,
          observation: s.observation.trim(),
        };
      })
      .sort((a, b) => a.startSec - b.startSec);

    const minSightingStart = sightings[0]?.startSec ?? 0;
    const maxSightingEnd =
      sightings[sightings.length - 1]?.endSec ?? raw.bestEvidenceSec;

    const mappedBest = toSec(raw.bestEvidenceSec);
    const bestEvidenceSec = Math.min(
      Math.max(mappedBest, minSightingStart),
      Math.max(minSightingStart, maxSightingEnd),
    );

    const features = raw.features.map((f) => ({
      name: f.name.trim(),
      value: f.value.trim(),
      atSec: toSec(f.atSec),
      source: f.source,
    }));

    const condition = normalizeCondition(raw.condition);
    const brand = raw.brand.trim() ? raw.brand.trim() : null;
    const modelReference = raw.modelReference.trim()
      ? raw.modelReference.trim()
      : null;

    const cleanQueries = Array.from(
      new Set(
        raw.searchQueries.map((q) => q.trim()).filter((q) => q.length >= 2),
      ),
    );
    if (cleanQueries.length === 0) {
      const fallback = [brand, modelReference, raw.label]
        .filter(Boolean)
        .join(" ")
        .trim();
      cleanQueries.push(fallback || raw.category);
    }

    normalizedItems.push({
      itemId: `item_${normalizedItems.length + 1}_${crypto.randomUUID().slice(0, 8)}`,
      category: raw.category.trim(),
      label: raw.label.trim(),
      summary: raw.summary.trim(),
      sightings,
      bestEvidenceSec,
      bestBox2d: normalizeBox2d(raw.bestBox2d),
      features,
      brand,
      modelReference,
      searchQueries: cleanQueries.slice(0, 3),
      ...(constraints ? { constraints } : {}),
      ...(condition ? { condition } : {}),
    });
  }

  return {
    videoSummary,
    items: normalizedItems,
    droppedItemCount,
  };
}

class ExtractionPayloadParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExtractionPayloadParseError";
  }
}

type ExtractionResult = {
  items: TracedItem[];
  diagnostics: ExtractDiagnostics;
};

/**
 * Shared Gemini Interactions call for every media source: same JSON schema,
 * prompt framing, parse-retry budget, and per-item normalization.
 */
async function runStructuredExtraction(params: {
  source: ExtractionMediaSource;
  mediaPart: Record<string, unknown>;
  question: string;
  requestedModel?: string | null;
  normalizeOptions?: Parameters<typeof normalizeRawExtractionPayload>[1];
}): Promise<ExtractionResult> {
  const apiKey = getGeminiApiKey();
  const model = resolveVideoModel(params.requestedModel);
  const startedAt = Date.now();
  // Single shared 105s ceiling across initial call + any parse retry (inside Vercel's 120s maxDuration)
  const sharedDeadline = AbortSignal.timeout(105_000);

  const invokeOnce = async (retryHint?: string) => {
    const requestBody = {
      model,
      input: [
        params.mediaPart,
        {
          type: "text",
          text: buildExtractionPrompt(params.question, params.source, retryHint),
        },
      ],
      response_format: {
        type: "text",
        mime_type: "application/json",
        schema:
          params.source === "image"
            ? IMAGE_EXTRACTION_JSON_SCHEMA
            : EXTRACTION_JSON_SCHEMA,
      },
    };

    const response = await fetch(INTERACTIONS_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.any([sharedDeadline, AbortSignal.timeout(78_000)]),
    });

    const rawText = await response.text();
    if (!response.ok) {
      let providerMessage = rawText.slice(0, 400);
      try {
        const errJson = JSON.parse(rawText) as {
          error?: { message?: string };
        };
        if (errJson.error?.message) {
          providerMessage = errJson.error.message;
        }
      } catch {
        // keep raw snippet
      }
      throw new Error(
        `Gemini ${params.source} analysis failed (${response.status}): ${providerMessage}`,
      );
    }

    const envelope = JSON.parse(rawText) as Record<string, unknown>;
    let jsonText: string;
    let parsedJson: unknown;
    try {
      jsonText = extractModelJsonText(envelope);
      parsedJson = JSON.parse(jsonText);
    } catch (e) {
      throw new ExtractionPayloadParseError(
        e instanceof Error ? e.message : "Malformed JSON from model.",
      );
    }

    let normalized: ReturnType<typeof normalizeRawExtractionPayload>;
    try {
      normalized = normalizeRawExtractionPayload(
        parsedJson,
        params.normalizeOptions,
      );
    } catch (e) {
      throw new ExtractionPayloadParseError(
        e instanceof Error ? e.message : "Invalid extraction JSON shape.",
      );
    }

    const usage = envelope.usage as { total_tokens?: number } | undefined;
    const interactionId =
      typeof envelope.id === "string" ? envelope.id : null;
    return {
      ...normalized,
      interactionId,
      totalTokens:
        typeof usage?.total_tokens === "number" ? usage.total_tokens : null,
    };
  };

  let result: Awaited<ReturnType<typeof invokeOnce>>;
  try {
    result = await invokeOnce();
  } catch (firstErr) {
    const remainingBudgetMs = 105_000 - (Date.now() - startedAt);
    const canRetryParse =
      firstErr instanceof ExtractionPayloadParseError &&
      !sharedDeadline.aborted &&
      remainingBudgetMs > 35_000;

    if (!canRetryParse) {
      throw firstErr;
    }
    result = await invokeOnce(
      "Your previous output could not be parsed cleanly. Return strictly valid JSON matching the schema.",
    );
  }

  return {
    items: result.items,
    diagnostics: {
      videoModel: model,
      interactionId: result.interactionId,
      geminiLive: true,
      durationMs: Date.now() - startedAt,
      videoSummary: result.videoSummary,
      totalTokens: result.totalTokens,
      droppedItemCount: result.droppedItemCount,
    },
  };
}

export async function extractItemsFromYouTube(params: {
  canonicalYoutubeUrl: string;
  question: string;
  requestedModel?: string | null;
  clipStartOffsetSec?: number;
  videoDurationSec?: number;
}): Promise<ExtractionResult> {
  return runStructuredExtraction({
    source: "video",
    mediaPart: {
      type: "video",
      uri: params.canonicalYoutubeUrl,
      mime_type: "video/mp4",
    },
    question: params.question,
    requestedModel: params.requestedModel,
    normalizeOptions: {
      clipStartOffsetSec: params.clipStartOffsetSec,
      videoDurationSec: params.videoDurationSec,
    },
  });
}

export async function extractItemsFromImage(params: {
  imageBase64: string;
  mimeType: string;
  question: string;
  requestedModel?: string | null;
}): Promise<ExtractionResult> {
  return runStructuredExtraction({
    source: "image",
    mediaPart: {
      type: "image",
      data: params.imageBase64,
      mime_type: params.mimeType,
    },
    question: params.question,
    requestedModel: params.requestedModel,
    normalizeOptions: { stillImage: true },
  });
}
