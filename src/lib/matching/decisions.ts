import { getDecisionsModel, getGeminiApiKey } from "@/lib/env";
import type {
  AvailableOptionGroup,
  EvidenceFrame,
  EvidenceMode,
  MatchLabel,
  OfferOption,
  RankComparisonEntry,
  TracedItem,
} from "@/lib/types";

const DECISIONS_ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/decisions";

export const EXACT_MATCH_THRESHOLD = 0.85;
export const POSSIBLE_MATCH_THRESHOLD = 0.52;

export type CandidateForScoring = {
  offerId: string;
  productId: string;
  variantId: string;
  sellerDomain: string;
  sellerName: string;
  title: string;
  descriptionSnippet?: string;
  options: OfferOption[];
  availableOptions?: AvailableOptionGroup[];
  amountMinor: number | null;
  currency: string | null;
  availability: "available" | "unavailable" | "unknown";
  condition: string | null;
  productUrl: string;
  imageUrl: string | null;
  warnings: string[];
  originalSearchRank: number;
};

export type ScoredCandidate = CandidateForScoring & {
  exactMatchYes: number | null;
  confidence: number | null;
  matchLabel: MatchLabel;
  hardConflict: string | null;
  rationale: string;
};

class DecisionsHttpError extends Error {
  public readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "DecisionsHttpError";
    this.status = status;
  }
}

const COLOR_FAMILIES: { id: string; terms: string[] }[] = [
  { id: "black", terms: ["black", "obsidian", "onyx", "jet"] },
  {
    id: "grey",
    terms: [
      "grey",
      "gray",
      "silver",
      "slate",
      "charcoal",
      "heather",
      "ash",
      "graphite",
    ],
  },
  {
    id: "white",
    terms: [
      "white",
      "ivory",
      "cream",
      "off-white",
      "ecru",
      "chalk",
      "cloud white",
    ],
  },
  {
    id: "red",
    terms: ["red", "crimson", "burgundy", "maroon", "scarlet", "wine"],
  },
  {
    id: "blue",
    terms: ["blue", "navy", "cobalt", "indigo", "denim", "sky", "teal"],
  },
  {
    id: "green",
    terms: ["green", "olive", "forest", "sage", "emerald", "khaki", "moss"],
  },
  {
    id: "yellow_gold",
    terms: ["yellow", "mustard", "gold", "rose gold", "champagne"],
  },
  { id: "orange", terms: ["orange", "rust", "terracotta", "coral", "amber"] },
  { id: "pink", terms: ["pink", "magenta", "blush", "fuchsia"] },
  { id: "purple", terms: ["purple", "violet", "lavender", "plum", "lilac"] },
  {
    id: "brown",
    terms: [
      "brown",
      "tan",
      "camel",
      "cognac",
      "chocolate",
      "espresso",
      "beige",
      "taupe",
    ],
  },
];

const GENERIC_REF_MODIFIERS = new Set([
  "og",
  "pro",
  "max",
  "plus",
  "lite",
  "mini",
  "mens",
  "womens",
  "unisex",
  "classic",
  "core",
  "collection",
  "edition",
  "watch",
  "shoe",
  "shoes",
  "sneaker",
  "sneakers",
  "jacket",
]);

export function normalizeCodeToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function extractColorFamilies(text: string): Set<string> {
  let working = text.toLowerCase();
  const found = new Set<string>();

  if (/\brose[\s-]?gold\b/.test(working)) {
    found.add("yellow_gold");
    working = working.replace(/\brose[\s-]?gold\b/g, " ");
  }

  for (const family of COLOR_FAMILIES) {
    for (const term of family.terms) {
      const pattern = term.replace(/[-\s]+/g, "[-\\s]+");
      const re = new RegExp(`\\b${pattern}\\b`, "i");
      if (re.test(working)) {
        found.add(family.id);
        break;
      }
    }
  }
  return found;
}

/**
 * Extracts distinguishing model/SKU tokens from `modelReference` after stripping
 * any leading brand prefix and generic edition words (so "Sony WH-1000XM5" -> ["wh1000xm5"],
 * "Samba OG" -> ["samba"], "F-91W" -> ["f91w"]).
 */
export function extractDistinguishingModelTokens(
  modelReference: string | null,
  brand: string | null,
): string[] {
  if (!modelReference || !modelReference.trim()) return [];
  const normBrand = brand ? normalizeCodeToken(brand) : "";

  const parts = modelReference
    .trim()
    .split(/\s+/)
    .map((tok) => normalizeCodeToken(tok))
    .filter((tok) => tok.length >= 2);

  const filtered = parts.filter((tok) => {
    if (normBrand && tok === normBrand) return false;
    if (GENERIC_REF_MODIFIERS.has(tok) && parts.length > 1) return false;
    return tok.length >= 3 || /\d/.test(tok);
  });

  if (filtered.length > 0) return filtered;
  const whole = normalizeCodeToken(modelReference);
  return whole.length >= 3 ? [whole] : [];
}

function isBrandDirectlyObserved(item: TracedItem): boolean {
  if (!item.brand || item.brand.trim().length < 2) return false;
  const normBrand = normalizeCodeToken(item.brand);
  return item.features.some(
    (f) =>
      (f.source === "visible" || f.source === "spoken") &&
      (normalizeCodeToken(f.value).includes(normBrand) ||
        /^(brand|brand_logo|logo_text)$/i.test(f.name.trim())),
  );
}

function isReferenceDirectlyObserved(item: TracedItem): boolean {
  const refTokens = extractDistinguishingModelTokens(
    item.modelReference,
    item.brand,
  );
  if (refTokens.length === 0) return false;
  return item.features.some(
    (f) =>
      (f.source === "visible" || f.source === "spoken") &&
      refTokens.some((tok) => normalizeCodeToken(f.value).includes(tok)),
  );
}

/**
 * Checks whether a candidate listing has a hard contradiction against
 * directly observed (`visible` or `spoken`) scene evidence.
 * Missing brand info is treated as unknown (blocking `exact_supported` via agreement checks)
 * rather than a false contradiction, while explicit model/SKU mismatches and selected variant
 * color mismatches trigger hard conflicts.
 */
export function detectHardConflict(
  item: TracedItem,
  candidate: Pick<
    CandidateForScoring,
    "title" | "options" | "sellerName" | "sellerDomain" | "descriptionSnippet"
  >,
): string | null {
  const fullCandidateContext = [
    candidate.title,
    candidate.sellerName,
    candidate.sellerDomain,
    candidate.descriptionSnippet ?? "",
    ...candidate.options.map((o) => `${o.name} ${o.label}`),
  ].join(" ");
  const normalizedSpace = normalizeCodeToken(fullCandidateContext);

  // 1. Complete distinguishing model/SKU reference gate:
  // Every distinguishing token (e.g. "wh1000xm5" in "Sony WH-1000XM5", "f91w" in "F-91W") must match!
  if (isReferenceDirectlyObserved(item)) {
    const requiredTokens = extractDistinguishingModelTokens(
      item.modelReference,
      item.brand,
    );
    const missingToken = requiredTokens.find(
      (tok) => !normalizedSpace.includes(tok),
    );
    if (missingToken) {
      return `Listing does not match observed model reference "${item.modelReference}".`;
    }
  }

  // 2. Selected variant Color precedence gate:
  // If the candidate has an explicit selected Color option with recognizable color term(s),
  // evaluate ONLY that selected variant's color (never let generic colors in the product title mask a wrong selected variant!).
  const visiblePrimaryColor = item.features.find(
    (f) =>
      f.source === "visible" &&
      /^(primary_color|color|main_color|colorway)$/i.test(f.name.trim()),
  );

  if (visiblePrimaryColor) {
    const itemColors = extractColorFamilies(visiblePrimaryColor.value);
    if (itemColors.size > 0) {
      const candidateColorOption = candidate.options.find((o) =>
        /^(color|colour|colorway|shade|finish)$/i.test(o.name.trim()),
      );
      const selectedOptionColors = candidateColorOption
        ? extractColorFamilies(candidateColorOption.label)
        : new Set<string>();

      const candColors =
        selectedOptionColors.size > 0
          ? selectedOptionColors
          : extractColorFamilies(candidate.title);

      if (candColors.size > 0) {
        const anyOverlap = Array.from(itemColors).some((c) =>
          candColors.has(c),
        );
        if (!anyOverlap) {
          const shownLabel =
            selectedOptionColors.size > 0 && candidateColorOption
              ? candidateColorOption.label
              : "listed colorway";
          return `Selected variant color (${shownLabel}) conflicts with visible color "${visiblePrimaryColor.value}".`;
        }
      }
    }
  }

  return null;
}

export function findCandidateSupportingAgreements(
  item: TracedItem,
  candidate: Pick<
    CandidateForScoring,
    "title" | "options" | "sellerName" | "sellerDomain" | "descriptionSnippet"
  >,
): {
  agreements: string[];
  brandMatched: boolean;
  referenceMatched: boolean;
} {
  const directFeatures = item.features.filter(
    (f) => f.source === "visible" || f.source === "spoken",
  );

  const candidateText = [
    candidate.title,
    candidate.sellerName,
    candidate.sellerDomain,
    candidate.descriptionSnippet ?? "",
    ...candidate.options.map((o) => o.label),
  ].join(" ");
  const normCandidate = normalizeCodeToken(candidateText);

  const candidateColorOption = candidate.options.find((o) =>
    /^(color|colour|colorway|shade|finish)$/i.test(o.name.trim()),
  );
  const selectedOptColors = candidateColorOption
    ? extractColorFamilies(candidateColorOption.label)
    : new Set<string>();
  const candColors =
    selectedOptColors.size > 0
      ? selectedOptColors
      : extractColorFamilies(candidateText);

  const matchedTraits: string[] = [];
  let brandMatched = false;
  let referenceMatched = false;

  if (item.brand && normCandidate.includes(normalizeCodeToken(item.brand))) {
    brandMatched = true;
    if (isBrandDirectlyObserved(item)) {
      matchedTraits.push(item.brand);
    }
  }

  const refTokens = extractDistinguishingModelTokens(
    item.modelReference,
    item.brand,
  );
  if (
    refTokens.length > 0 &&
    refTokens.every((tok) => normCandidate.includes(tok))
  ) {
    referenceMatched = true;
    if (item.modelReference) {
      matchedTraits.push(item.modelReference);
    }
  }

  for (const feat of directFeatures) {
    const featColors = extractColorFamilies(feat.value);
    if (
      featColors.size > 0 &&
      Array.from(featColors).some((c) => candColors.has(c))
    ) {
      matchedTraits.push(feat.value);
      continue;
    }

    const words = feat.value
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 4);
    if (words.some((w) => candidateText.toLowerCase().includes(w))) {
      matchedTraits.push(feat.value);
    }
  }

  return {
    agreements: Array.from(new Set(matchedTraits)).slice(0, 4),
    brandMatched,
    referenceMatched,
  };
}

export function classifyMatchLabel(params: {
  item: TracedItem;
  exactMatchYes: number | null;
  hardConflict: string | null;
  agreementsCount: number;
  brandMatched: boolean;
  referenceMatched: boolean;
  directFeatureCount: number;
}): MatchLabel {
  const {
    item,
    exactMatchYes,
    hardConflict,
    agreementsCount,
    brandMatched,
    referenceMatched,
    directFeatureCount,
  } = params;
  if (exactMatchYes === null || !Number.isFinite(exactMatchYes)) {
    return "unscored";
  }
  if (hardConflict) {
    return "similar";
  }

  // If brand or model reference was directly observed in the scene, the candidate
  // MUST corroborate that brand/reference to qualify for `exact_supported` (missing = unknown -> caps at `possible`).
  const missingConfirmedBrand =
    isBrandDirectlyObserved(item) && !brandMatched && !referenceMatched;
  const missingConfirmedRef =
    isReferenceDirectlyObserved(item) && !referenceMatched;

  if (
    exactMatchYes >= EXACT_MATCH_THRESHOLD &&
    directFeatureCount >= 1 &&
    agreementsCount >= 1 &&
    !missingConfirmedBrand &&
    !missingConfirmedRef
  ) {
    return "exact_supported";
  }
  if (exactMatchYes >= POSSIBLE_MATCH_THRESHOLD) {
    return "possible";
  }
  return "similar";
}

export function buildGroundedRationale(params: {
  item: TracedItem;
  candidate: CandidateForScoring;
  matchLabel: MatchLabel;
  exactMatchYes: number | null;
  hardConflict: string | null;
  agreements: string[];
}): string {
  const {
    item,
    candidate,
    matchLabel,
    exactMatchYes,
    hardConflict,
    agreements,
  } = params;
  if (hardConflict) {
    return `${hardConflict} Shown as a visually related alternative.`;
  }

  const optionSummary =
    candidate.options.length > 0
      ? candidate.options.map((o) => `${o.name}: ${o.label}`).join(", ")
      : "standard variant";

  if (matchLabel === "unscored" || exactMatchYes === null) {
    return `Retrieved from Shopify catalog (${optionSummary}); probabilistic Decisions ranking was unavailable.`;
  }

  const pct = `${Math.round(exactMatchYes * 100)}%`;
  const sharedText =
    agreements.length > 0 ? agreements.join(", ") : item.category;

  if (matchLabel === "exact_supported") {
    return `Corroborated on ${sharedText} (${optionSummary}, ${pct} exact-match probability across ${item.sightings.length} scene sighting${item.sightings.length === 1 ? "" : "s"}).`;
  }

  if (matchLabel === "possible") {
    return `Consistent with ${sharedText} (${optionSummary}, ${pct} match probability), though exact brand or model markings remain unconfirmed on this listing.`;
  }

  return `Related ${item.category} option (${optionSummary}), but visual details do not confirm it is the exact item shown (${pct} match probability).`;
}

type DecisionsInputPart =
  | { type: "text"; text: string }
  | {
      type: "image";
      data?: string;
      uri?: string;
      mime_type?: string;
      resolution?: "low" | "medium" | "high";
    };

function buildDecisionsPayload(params: {
  model: string;
  item: TracedItem;
  candidates: CandidateForScoring[];
  evidenceFrames: EvidenceFrame[];
  includeCatalogImageUris: boolean;
}): {
  body: Record<string, unknown>;
  keyToOfferId: Map<string, string>;
  mode: EvidenceMode;
  sentCatalogImageUris: boolean;
} {
  const {
    model,
    item,
    candidates,
    evidenceFrames,
    includeCatalogImageUris,
  } = params;

  const inputParts: DecisionsInputPart[] = [];

  const featureLines =
    item.features.length > 0
      ? item.features
          .map((f) => `- [${f.source} @ ${f.atSec}s] ${f.name}: ${f.value}`)
          .join("\n")
      : "- No granular features extracted.";

  const sightingLines = item.sightings
    .map(
      (s, i) =>
        `- Sighting ${i + 1} (${s.startSec}s–${s.endSec}s, clearest @ ${s.evidenceSec}s): ${s.observation}`,
    )
    .join("\n");

  inputParts.push({
    type: "text",
    text: [
      "=== VIDEO ITEM DOSSIER ===",
      `Category: ${item.category}`,
      `Item Label: ${item.label}`,
      `Scene Summary: ${item.summary}`,
      `Observed Brand: ${item.brand ?? "unconfirmed"}`,
      `Observed Model / Reference: ${item.modelReference ?? "unconfirmed"}`,
      "Sightings across clip:",
      sightingLines,
      "Observed features:",
      featureLines,
    ].join("\n"),
  });

  const framesToSend = evidenceFrames.slice(0, 3);
  for (let i = 0; i < framesToSend.length; i++) {
    const frame = framesToSend[i];
    const provenanceHeader =
      frame.kind === "uploaded_still"
        ? `Shopper-Uploaded Reference Photo (not extracted from video timeline):`
        : `Supporting Video Evidence ${i + 1} (${frame.label}${frame.atSec !== null ? ` at ${frame.atSec}s` : ""}):`;
    inputParts.push({
      type: "text",
      text: provenanceHeader,
    });
    inputParts.push({
      type: "image",
      data: frame.dataBase64,
      mime_type: frame.mimeType,
      resolution: "high",
    });
  }

  const questions: Record<string, unknown> = {};
  const keyToOfferId = new Map<string, string>();
  let anyCatalogImageAttached = false;

  inputParts.push({
    type: "text",
    text: "\n=== CANDIDATE CATALOG VARIANTS (COMMERCIAL FIELDS EXCLUDED) ===",
  });

  candidates.forEach((cand, idx) => {
    const key = `candidate_${idx}`;
    keyToOfferId.set(key, cand.offerId);

    const optText =
      cand.options.length > 0
        ? cand.options.map((o) => `${o.name}: ${o.label}`).join("; ")
        : "Default / Single Variant";

    inputParts.push({
      type: "text",
      text: [
        `[${key}]`,
        `Title: ${cand.title}`,
        `Selected Variant Options: ${optText}`,
        cand.condition ? `Condition: ${cand.condition}` : null,
        cand.descriptionSnippet
          ? `Product Details: ${cand.descriptionSnippet}`
          : null,
      ]
        .filter(Boolean)
        .join("\n"),
    });

    if (
      includeCatalogImageUris &&
      cand.imageUrl &&
      cand.imageUrl.startsWith("https://")
    ) {
      anyCatalogImageAttached = true;
      inputParts.push({
        type: "text",
        text: `Catalog product photo for ${key}:`,
      });
      inputParts.push({
        type: "image",
        uri: cand.imageUrl,
        resolution: "medium",
      });
    }

    questions[key] = {
      type: "noul",
      instructions: `Does the supplied video evidence support that ${key} ("${cand.title}" — ${optText}) is the exact product model and visible colorway/variant shown in the video?`,
      criteria: {
        true_description:
          "The candidate matches all confirmed brand, model/reference, silhouette, colorway, material, and distinguishing visual traits observed in the scene without contradiction.",
        false_description:
          "The candidate has a different brand, wrong model/silhouette, conflicting colorway/variant, contradicting visual details, or the video evidence is too unclear to confirm it is this exact product.",
      },
    };
  });

  let mode: EvidenceMode = "text_observations";
  if (framesToSend.length > 0 && anyCatalogImageAttached) {
    mode = "multimodal_frames_and_catalog";
  } else if (framesToSend.length > 0) {
    mode = "frames_and_text";
  } else if (anyCatalogImageAttached) {
    mode = "catalog_images_and_text";
  }

  return {
    body: {
      model,
      input: inputParts,
      questions,
    },
    keyToOfferId,
    mode,
    sentCatalogImageUris: anyCatalogImageAttached,
  };
}

async function callDecisionsEndpoint(
  apiKey: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<
  Record<string, { noul?: number; confidence?: number; type?: string }>
> {
  const timeoutSig = AbortSignal.timeout(28_000);
  const combinedSignal = signal
    ? AbortSignal.any([signal, timeoutSig])
    : timeoutSig;

  const response = await fetch(DECISIONS_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify(body),
    signal: combinedSignal,
  });

  const rawText = await response.text();
  if (!response.ok) {
    let msg = rawText.slice(0, 350);
    try {
      const parsed = JSON.parse(rawText) as { error?: { message?: string } };
      if (parsed.error?.message) msg = parsed.error.message;
    } catch {
      // keep raw snippet
    }
    throw new DecisionsHttpError(
      response.status,
      `Decisions API HTTP ${response.status}: ${msg}`,
    );
  }

  const parsed = JSON.parse(rawText) as {
    answers?: Record<
      string,
      { noul?: number; confidence?: number; type?: string }
    >;
  };

  if (!parsed.answers || typeof parsed.answers !== "object") {
    throw new Error("Decisions API returned no answers object.");
  }

  return parsed.answers;
}

export function applyScoresAndSortCandidates(params: {
  item: TracedItem;
  candidates: CandidateForScoring[];
  scoresByOfferId: Map<
    string,
    { exactMatchYes: number | null; confidence: number | null }
  >;
}): {
  ranked: ScoredCandidate[];
  comparison: RankComparisonEntry[];
} {
  const { item, candidates, scoresByOfferId } = params;
  const directFeatureCount = item.features.filter(
    (f) => f.source === "visible" || f.source === "spoken",
  ).length;

  const enriched: ScoredCandidate[] = candidates.map((cand) => {
    const score = scoresByOfferId.get(cand.offerId);
    const rawYes = score?.exactMatchYes ?? null;
    const exactMatchYes =
      typeof rawYes === "number" &&
      Number.isFinite(rawYes) &&
      rawYes >= 0 &&
      rawYes <= 1
        ? rawYes
        : null;

    const rawConf = score?.confidence ?? null;
    const confidence =
      typeof rawConf === "number" &&
      Number.isFinite(rawConf) &&
      rawConf >= 0 &&
      rawConf <= 1
        ? rawConf
        : null;

    const hardConflict = detectHardConflict(item, cand);
    const { agreements, brandMatched, referenceMatched } =
      findCandidateSupportingAgreements(item, cand);
    const matchLabel = classifyMatchLabel({
      item,
      exactMatchYes,
      hardConflict,
      agreementsCount: agreements.length,
      brandMatched,
      referenceMatched,
      directFeatureCount,
    });

    const rationale = buildGroundedRationale({
      item,
      candidate: cand,
      matchLabel,
      exactMatchYes,
      hardConflict,
      agreements,
    });

    return {
      ...cand,
      exactMatchYes,
      confidence,
      matchLabel,
      hardConflict,
      rationale,
    };
  });

  const sorted = [...enriched].sort((a, b) => {
    const aScored = a.exactMatchYes !== null;
    const bScored = b.exactMatchYes !== null;
    if (aScored !== bScored) return aScored ? -1 : 1;

    if (a.exactMatchYes !== null && b.exactMatchYes !== null) {
      const aEffective = a.hardConflict
        ? Math.min(a.exactMatchYes, 0.35)
        : a.exactMatchYes;
      const bEffective = b.hardConflict
        ? Math.min(b.exactMatchYes, 0.35)
        : b.exactMatchYes;

      if (Math.abs(bEffective - aEffective) > 1e-6) {
        return bEffective - aEffective;
      }
    }

    return a.originalSearchRank - b.originalSearchRank;
  });

  const comparison: RankComparisonEntry[] = sorted.map((offer, idx) => ({
    offerId: offer.offerId,
    title: offer.title,
    sellerName: offer.sellerName,
    originalRank: offer.originalSearchRank,
    finalRank: idx + 1,
    exactMatchYes: offer.exactMatchYes,
    confidence: offer.confidence,
    matchLabel: offer.matchLabel,
    hardConflict: offer.hardConflict,
  }));

  return { ranked: sorted, comparison };
}

export async function rankCandidatesWithDecisions(params: {
  item: TracedItem;
  candidates: CandidateForScoring[];
  evidenceFrames?: EvidenceFrame[];
  signal?: AbortSignal;
}): Promise<{
  ranked: ScoredCandidate[];
  comparison: RankComparisonEntry[];
  decisionsLive: boolean;
  decisionModel: string;
  evidenceMode: EvidenceMode;
  durationMs: number;
  rankingError: string | null;
}> {
  const decisionModel = getDecisionsModel();
  const startedAt = Date.now();
  const frames = params.evidenceFrames ?? [];

  if (params.candidates.length === 0) {
    return {
      ranked: [],
      comparison: [],
      decisionsLive: true,
      decisionModel,
      evidenceMode: frames.length > 0 ? "frames_and_text" : "text_observations",
      durationMs: 0,
      rankingError: null,
    };
  }

  const shortlist = params.candidates.slice(0, 6);
  const overflow = params.candidates.slice(6);

  try {
    const apiKey = getGeminiApiKey();

    let built = buildDecisionsPayload({
      model: decisionModel,
      item: params.item,
      candidates: shortlist,
      evidenceFrames: frames,
      includeCatalogImageUris: true,
    });

    let answers: Record<
      string,
      { noul?: number; confidence?: number; type?: string }
    >;

    try {
      answers = await callDecisionsEndpoint(apiKey, built.body, params.signal);
    } catch (firstErr) {
      const shouldRetryWithoutRemoteImages =
        built.sentCatalogImageUris &&
        firstErr instanceof DecisionsHttpError &&
        (firstErr.status === 400 || firstErr.status === 422) &&
        !params.signal?.aborted;

      if (!shouldRetryWithoutRemoteImages) {
        throw firstErr;
      }

      built = buildDecisionsPayload({
        model: decisionModel,
        item: params.item,
        candidates: shortlist,
        evidenceFrames: frames,
        includeCatalogImageUris: false,
      });
      answers = await callDecisionsEndpoint(apiKey, built.body, params.signal);
    }

    const scoresByOfferId = new Map<
      string,
      { exactMatchYes: number | null; confidence: number | null }
    >();

    let validScoreCount = 0;
    for (const [key, offerId] of built.keyToOfferId.entries()) {
      const ans = answers[key];
      const noul =
        typeof ans?.noul === "number" &&
        Number.isFinite(ans.noul) &&
        ans.noul >= 0 &&
        ans.noul <= 1
          ? ans.noul
          : null;
      if (noul !== null) validScoreCount++;
      scoresByOfferId.set(offerId, {
        exactMatchYes: noul,
        confidence:
          typeof ans?.confidence === "number" && Number.isFinite(ans.confidence)
            ? ans.confidence
            : null,
      });
    }

    if (validScoreCount === 0) {
      throw new Error(
        "Decisions API returned zero valid numeric `noul` scores for candidate keys.",
      );
    }

    const { ranked, comparison } = applyScoresAndSortCandidates({
      item: params.item,
      candidates: [...shortlist, ...overflow],
      scoresByOfferId,
    });

    const partialWarning =
      validScoreCount < shortlist.length
        ? `Partial Decisions response (${validScoreCount}/${shortlist.length} candidates scored).`
        : null;

    return {
      ranked,
      comparison,
      decisionsLive: true,
      decisionModel,
      evidenceMode: built.mode,
      durationMs: Date.now() - startedAt,
      rankingError: partialWarning,
    };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Decisions API scoring failed.";
    const { ranked, comparison } = applyScoresAndSortCandidates({
      item: params.item,
      candidates: params.candidates,
      scoresByOfferId: new Map(),
    });

    return {
      ranked,
      comparison,
      decisionsLive: false,
      decisionModel,
      evidenceMode: "catalog_fallback",
      durationMs: Date.now() - startedAt,
      rankingError: message,
    };
  }
}
