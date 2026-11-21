import fs from "node:fs";
import path from "node:path";
import {
  normalizeCodeToken,
  rankCandidatesWithDecisions,
  type CandidateForScoring,
} from "../src/lib/matching/decisions";
import { retrieveShopifyCandidatesForItem } from "../src/lib/shop/client";
import type { TracedItem } from "../src/lib/types";
import { extractItemsFromYouTube } from "../src/lib/video/extract";
import { parseAndNormalizeYouTubeUrl } from "../src/lib/video/youtube";

function loadDotEnv() {
  const envPath = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const [k, ...rest] = trimmed.split("=");
    const v = rest.join("=").trim().replace(/^['"]|['"]$/g, "");
    if (!process.env[k.trim()]) process.env[k.trim()] = v;
  }
}

type ControlledCase = {
  id: string;
  name: string;
  expectedTopOfferId: string | null;
  singleFrameItem: TracedItem;
  crossSceneItem: TracedItem;
  candidates: CandidateForScoring[];
};

type ManifestClip = {
  clipId: string;
  youtubeUrl: string;
  question: string;
  groundTruth: {
    category: string;
    expectedBrand: string;
    expectedModelTokens: string[];
  };
};

const CONTROLLED_RANKING_CASES: ControlledCase[] = [
  {
    id: "case_1_cross_scene_watch",
    name: "Cross-scene watch: blurry wrist shot @ 4s -> readable F-91W close-up @ 24s",
    expectedTopOfferId: "watch_f91w",
    singleFrameItem: {
      itemId: "eval_1_single",
      category: "wristwatch",
      label: "Small Black Digital Wristwatch",
      summary: "Distant shot shows a rectangular black resin digital watch.",
      sightings: [
        {
          startSec: 3,
          endSec: 6,
          evidenceSec: 4,
          observation: "Wide shot of black rectangular digital watch on wrist",
        },
      ],
      bestEvidenceSec: 4,
      features: [
        { name: "primary_color", value: "black", atSec: 4, source: "visible" },
        {
          name: "shape",
          value: "rectangular resin case",
          atSec: 4,
          source: "visible",
        },
      ],
      brand: null,
      modelReference: null,
      searchQueries: ["black rectangular digital watch"],
    },
    crossSceneItem: {
      itemId: "eval_1_cross",
      category: "wristwatch",
      label: "Casio F-91W Black Resin Digital Watch",
      summary:
        "Rectangular black resin watch @ 4s confirmed as Casio F-91W with blue border trim in @ 24s close-up.",
      sightings: [
        {
          startSec: 3,
          endSec: 6,
          evidenceSec: 4,
          observation: "Wide shot of black digital watch",
        },
        {
          startSec: 23,
          endSec: 26,
          evidenceSec: 24,
          observation: "Sharp close-up reading CASIO F-91W WATER RESIST",
        },
      ],
      bestEvidenceSec: 24,
      features: [
        { name: "brand", value: "CASIO", atSec: 24, source: "visible" },
        { name: "reference", value: "F-91W", atSec: 24, source: "visible" },
        { name: "primary_color", value: "black", atSec: 4, source: "visible" },
        {
          name: "bezel_trim",
          value: "thin blue line around LCD",
          atSec: 24,
          source: "visible",
        },
      ],
      brand: "Casio",
      modelReference: "F-91W",
      searchQueries: ["Casio F-91W black watch"],
    },
    candidates: [
      {
        offerId: "watch_w217h",
        productId: "p_w217",
        variantId: "v_w217",
        sellerDomain: "shop1.myshopify.com",
        sellerName: "Metro Time",
        title: "Casio W-217H-1AV Larger Classic Digital Watch",
        descriptionSnippet: "Larger 43mm black resin case, 50M water resistant.",
        options: [{ name: "Color", label: "Black / Gold Trim" }],
        amountMinor: 2200,
        currency: "USD",
        availability: "available",
        condition: "new",
        productUrl: "https://example.com/w217h",
        imageUrl: null,
        warnings: [],
        originalSearchRank: 1,
      },
      {
        offerId: "watch_f105w",
        productId: "p_f105",
        variantId: "v_f105",
        sellerDomain: "shop2.myshopify.com",
        sellerName: "Chrono Depot",
        title: "Casio F-105W-1A Electro Luminescence Digital Watch",
        descriptionSnippet:
          "Black resin digital watch with EL backlight label on dial.",
        options: [{ name: "Color", label: "Black" }],
        amountMinor: 2195,
        currency: "USD",
        availability: "available",
        condition: "new",
        productUrl: "https://example.com/f105w",
        imageUrl: null,
        warnings: [],
        originalSearchRank: 2,
      },
      {
        offerId: "watch_f91w",
        productId: "p_f91w",
        variantId: "v_f91w",
        sellerDomain: "shop3.myshopify.com",
        sellerName: "Heritage Watches",
        title: "Casio Collection F-91W-1XY Classic Black Resin Digital Watch",
        descriptionSnippet:
          "35mm black polyurethane case, classic blue border line, WATER RESIST text.",
        options: [{ name: "Color", label: "Black" }],
        amountMinor: 1895,
        currency: "USD",
        availability: "available",
        condition: "new",
        productUrl: "https://example.com/f91w",
        imageUrl: null,
        warnings: [],
        originalSearchRank: 3,
      },
    ],
  },
  {
    id: "case_2_sneaker_rerank",
    name: "Sneakers colorway & model rerank: New Balance 574 Core Grey",
    expectedTopOfferId: "nb_574_grey",
    singleFrameItem: {
      itemId: "eval_2_single",
      category: "sneakers",
      label: "Grey Suede Running Sneakers",
      summary: "Grey suede retro runner seen from distance.",
      sightings: [
        {
          startSec: 10,
          endSec: 12,
          evidenceSec: 11,
          observation: "Medium shot of grey suede sneakers with N logo",
        },
      ],
      bestEvidenceSec: 11,
      features: [
        { name: "primary_color", value: "grey", atSec: 11, source: "visible" },
        { name: "logo", value: "N side logo", atSec: 11, source: "visible" },
      ],
      brand: "New Balance",
      modelReference: null,
      searchQueries: ["New Balance grey suede sneakers"],
    },
    crossSceneItem: {
      itemId: "eval_2_cross",
      category: "sneakers",
      label: "New Balance 574 Core Grey Suede Mesh Sneakers",
      summary:
        "Host mentions 'classic 574s in grey' @ 29s and tongue label reads 574.",
      sightings: [
        {
          startSec: 10,
          endSec: 12,
          evidenceSec: 11,
          observation: "Grey suede & mesh sneaker profile",
        },
        {
          startSec: 28,
          endSec: 31,
          evidenceSec: 29.5,
          observation:
            "Close-up of ENCAP heel & 574 tongue patch + spoken mention",
        },
      ],
      bestEvidenceSec: 29.5,
      features: [
        { name: "brand", value: "New Balance", atSec: 11, source: "visible" },
        { name: "reference", value: "574", atSec: 29.5, source: "visible" },
        {
          name: "spoken_model",
          value: "classic 574 in grey",
          atSec: 29,
          source: "spoken",
        },
        { name: "primary_color", value: "grey", atSec: 11, source: "visible" },
      ],
      brand: "New Balance",
      modelReference: "574",
      searchQueries: ["New Balance 574 Core Grey"],
    },
    candidates: [
      {
        offerId: "nb_990v6_grey",
        productId: "p_990",
        variantId: "v_990",
        sellerDomain: "runnerhub.myshopify.com",
        sellerName: "Runner Hub",
        title: "New Balance Made in USA 990v6 Grey",
        descriptionSnippet: "FuelCell midsole, pigskin suede and mesh upper.",
        options: [{ name: "Color", label: "Castlerock / Grey" }],
        amountMinor: 19999,
        currency: "USD",
        availability: "available",
        condition: "new",
        productUrl: "https://example.com/990v6",
        imageUrl: null,
        warnings: [],
        originalSearchRank: 1,
      },
      {
        offerId: "nb_574_navy",
        productId: "p_574n",
        variantId: "v_574n",
        sellerDomain: "kicks.myshopify.com",
        sellerName: "Kicks Co",
        title: "New Balance 574 Core Navy / White",
        descriptionSnippet: "ENCAP midsole cushioning in navy suede and mesh.",
        options: [{ name: "Color", label: "Navy" }],
        amountMinor: 8999,
        currency: "USD",
        availability: "available",
        condition: "new",
        productUrl: "https://example.com/574-navy",
        imageUrl: null,
        warnings: [],
        originalSearchRank: 2,
      },
      {
        offerId: "nb_574_grey",
        productId: "p_574g",
        variantId: "v_574g",
        sellerDomain: "kicks.myshopify.com",
        sellerName: "Kicks Co",
        title: "New Balance 574 Core Grey / White (ML574EVG)",
        descriptionSnippet:
          "Classic 574 suede/mesh upper in signature grey with ENCAP midsole.",
        options: [{ name: "Color", label: "Grey" }],
        amountMinor: 8999,
        currency: "USD",
        availability: "available",
        condition: "new",
        productUrl: "https://example.com/574-grey",
        imageUrl: null,
        warnings: [],
        originalSearchRank: 3,
      },
    ],
  },
  {
    id: "case_3_non_match_abstention",
    name: "Visually similar non-match: Patagonia Torrentshell Yellow vs wrong colorways/brands",
    expectedTopOfferId: null,
    singleFrameItem: {
      itemId: "eval_3_single",
      category: "jacket",
      label: "Bright Yellow Hooded Rain Shell",
      summary: "Hooded yellow rain jacket in outdoor clip.",
      sightings: [
        {
          startSec: 6,
          endSec: 10,
          evidenceSec: 8,
          observation: "Yellow waterproof shell jacket",
        },
      ],
      bestEvidenceSec: 8,
      features: [
        { name: "primary_color", value: "yellow", atSec: 8, source: "visible" },
      ],
      brand: null,
      modelReference: null,
      searchQueries: ["yellow hooded rain jacket"],
    },
    crossSceneItem: {
      itemId: "eval_3_cross",
      category: "jacket",
      label: "Patagonia Torrentshell 3L Jacket in Bright Yellow",
      summary:
        "Patagonia chest patch visible @ 18s on bright mustard-yellow waterproof shell.",
      sightings: [
        {
          startSec: 6,
          endSec: 10,
          evidenceSec: 8,
          observation: "Wide shot of yellow hooded rain shell",
        },
        {
          startSec: 17,
          endSec: 20,
          evidenceSec: 18,
          observation:
            "Close-up of Patagonia P-6 woven chest label on yellow shell",
        },
      ],
      bestEvidenceSec: 18,
      features: [
        { name: "brand", value: "Patagonia", atSec: 18, source: "visible" },
        { name: "primary_color", value: "yellow", atSec: 8, source: "visible" },
        {
          name: "material",
          value: "matte 3-layer hardshell nylon",
          atSec: 18,
          source: "visible",
        },
      ],
      brand: "Patagonia",
      modelReference: "Torrentshell 3L",
      searchQueries: ["Patagonia Torrentshell 3L yellow"],
    },
    candidates: [
      {
        offerId: "cand_black_torrentshell",
        productId: "p_pat_blk",
        variantId: "v_pat_blk",
        sellerDomain: "outdoor.myshopify.com",
        sellerName: "Alpine Gear",
        title: "Patagonia Men's Torrentshell 3L Rain Jacket",
        descriptionSnippet: "3-layer H2No waterproof shell.",
        options: [{ name: "Color", label: "Black" }],
        amountMinor: 17900,
        currency: "USD",
        availability: "available",
        condition: "new",
        productUrl: "https://example.com/pat-black",
        imageUrl: null,
        warnings: [],
        originalSearchRank: 1,
      },
      {
        offerId: "cand_columbia_yellow",
        productId: "p_col_yel",
        variantId: "v_col_yel",
        sellerDomain: "trail.myshopify.com",
        sellerName: "Trail Supply",
        title: "Columbia Watertight II Hooded Rain Jacket",
        descriptionSnippet: "Lightweight nylon rain shell.",
        options: [{ name: "Color", label: "Yellow" }],
        amountMinor: 7500,
        currency: "USD",
        availability: "available",
        condition: "new",
        productUrl: "https://example.com/columbia-yellow",
        imageUrl: null,
        warnings: [],
        originalSearchRank: 2,
      },
    ],
  },
];

function candidateMatchesGroundTruth(
  cand: Pick<CandidateForScoring, "title" | "sellerName" | "sellerDomain">,
  gt: ManifestClip["groundTruth"],
): boolean {
  const space = normalizeCodeToken(
    `${cand.title} ${cand.sellerName} ${cand.sellerDomain}`,
  );
  const brandOk = space.includes(normalizeCodeToken(gt.expectedBrand));
  const modelOk = gt.expectedModelTokens.every((t) =>
    space.includes(normalizeCodeToken(t)),
  );
  return brandOk && modelOk;
}

async function main() {
  loadDotEnv();
  const startedAtIso = new Date().toISOString();

  console.log(
    "=== Part 1: Decisions Unit Eval (Controlled Single-Frame vs Cross-Scene Fixtures) ===\n",
  );

  let shopBaselineTop1 = 0;
  let singleFrameTop1 = 0;
  let crossSceneTop1 = 0;
  let falseExactSingle = 0;
  let falseExactCross = 0;

  for (const c of CONTROLLED_RANKING_CASES) {
    if (
      c.expectedTopOfferId &&
      c.candidates[0]?.offerId === c.expectedTopOfferId
    ) {
      shopBaselineTop1++;
    }

    const [singleRes, crossRes] = await Promise.all([
      rankCandidatesWithDecisions({
        item: c.singleFrameItem,
        candidates: c.candidates,
      }),
      rankCandidatesWithDecisions({
        item: c.crossSceneItem,
        candidates: c.candidates,
      }),
    ]);

    if (!singleRes.decisionsLive || !crossRes.decisionsLive) {
      throw new Error(
        `Decisions API failed on ${c.id}: ${singleRes.rankingError || crossRes.rankingError}`,
      );
    }

    const singleTop = singleRes.ranked[0];
    const crossTop = crossRes.ranked[0];

    if (c.expectedTopOfferId) {
      if (singleTop?.offerId === c.expectedTopOfferId) singleFrameTop1++;
      if (crossTop?.offerId === c.expectedTopOfferId) crossSceneTop1++;
    }

    for (const r of singleRes.ranked) {
      if (
        r.matchLabel === "exact_supported" &&
        r.offerId !== c.expectedTopOfferId
      ) {
        falseExactSingle++;
      }
    }
    for (const r of crossRes.ranked) {
      if (
        r.matchLabel === "exact_supported" &&
        r.offerId !== c.expectedTopOfferId
      ) {
        falseExactCross++;
      }
    }

    console.log(`Fixture: ${c.name}`);
    console.log(
      `  Baseline #1     : ${c.candidates[0]?.offerId} | Single-Frame #1: ${singleTop?.offerId} (${singleTop?.exactMatchYes?.toFixed(3)}) | Cross-Scene #1: ${crossTop?.offerId} (${crossTop?.exactMatchYes?.toFixed(3)}, ${crossTop?.matchLabel})`,
    );
  }

  const positiveControlled = CONTROLLED_RANKING_CASES.filter(
    (c) => c.expectedTopOfferId !== null,
  ).length;

  console.log(
    "\n=== Part 2: End-to-End Real YouTube Clips Eval (evals/manifest.json) ===\n",
  );

  const manifestPath = path.resolve(process.cwd(), "evals/manifest.json");
  const manifest = JSON.parse(
    fs.readFileSync(manifestPath, "utf8"),
  ) as ManifestClip[];

  let realClipsRetrievalHits = 0;
  let realClipsShopTop1Hits = 0;
  let realClipsDecisionsTop1Hits = 0;
  let realClipsFalseExact = 0;

  const clipRecords: Array<Record<string, unknown>> = [];

  for (const clip of manifest) {
    const normalized = parseAndNormalizeYouTubeUrl(clip.youtubeUrl);
    console.log(`Running clip [${clip.clipId}]: ${normalized.canonicalUrl}`);

    const extraction = await extractItemsFromYouTube({
      canonicalYoutubeUrl: normalized.canonicalUrl,
      question: clip.question,
    });

    if (extraction.items.length === 0) {
      throw new Error(
        `Gemini 4 extracted 0 items for real clip ${clip.clipId}!`,
      );
    }

    const primaryItem = extraction.items[0];
    const shopRes = await retrieveShopifyCandidatesForItem({
      item: primaryItem,
      country: "US",
      currency: "USD",
    });

    if (shopRes.candidates.length === 0) {
      throw new Error(
        `Shop MCP returned 0 candidates for ${clip.clipId} (queries=${shopRes.queriesRun.join(", ")})`,
      );
    }

    const decRes = await rankCandidatesWithDecisions({
      item: primaryItem,
      candidates: shopRes.candidates,
    });

    if (!decRes.decisionsLive) {
      throw new Error(
        `Decisions API was not live on ${clip.clipId}: ${decRes.rankingError}`,
      );
    }

    const poolHit = shopRes.candidates.some((cand) =>
      candidateMatchesGroundTruth(cand, clip.groundTruth),
    );
    const shopTop1Hit = Boolean(
      shopRes.candidates[0] &&
        candidateMatchesGroundTruth(shopRes.candidates[0], clip.groundTruth),
    );
    const decTop1Hit = Boolean(
      decRes.ranked[0] &&
        candidateMatchesGroundTruth(decRes.ranked[0], clip.groundTruth),
    );

    if (poolHit) realClipsRetrievalHits++;
    if (shopTop1Hit) realClipsShopTop1Hits++;
    if (decTop1Hit) realClipsDecisionsTop1Hits++;

    let clipFalseExact = 0;
    for (const r of decRes.ranked) {
      if (
        r.matchLabel === "exact_supported" &&
        !candidateMatchesGroundTruth(r, clip.groundTruth)
      ) {
        clipFalseExact++;
      }
    }
    realClipsFalseExact += clipFalseExact;

    const topRanked = decRes.ranked[0];
    console.log(
      `  Extracted: "${primaryItem.label}" (brand=${primaryItem.brand}, ref=${primaryItem.modelReference}, sightings=${primaryItem.sightings.length}) in ${extraction.diagnostics.durationMs}ms`,
    );
    console.log(
      `  Shop MCP : ${shopRes.candidates.length} variants in ${shopRes.durationMs}ms | Shop #1 match=${shopTop1Hit}`,
    );
    console.log(
      `  Decisions: mode=${decRes.evidenceMode} in ${decRes.durationMs}ms | Top #1="${topRanked?.title}" [noul=${topRanked?.exactMatchYes?.toFixed(3)}, label=${topRanked?.matchLabel}] | Decisions #1 match=${decTop1Hit}\n`,
    );

    clipRecords.push({
      clipId: clip.clipId,
      canonicalUrl: normalized.canonicalUrl,
      videoModel: extraction.diagnostics.videoModel,
      extractedItem: {
        label: primaryItem.label,
        brand: primaryItem.brand,
        modelReference: primaryItem.modelReference,
        sightingCount: primaryItem.sightings.length,
        bestEvidenceSec: primaryItem.bestEvidenceSec,
        queries: primaryItem.searchQueries,
      },
      timingsMs: {
        extractMs: extraction.diagnostics.durationMs,
        shopMs: shopRes.durationMs,
        decisionsMs: decRes.durationMs,
      },
      evidenceMode: decRes.evidenceMode,
      candidateCount: shopRes.candidates.length,
      retrievalHit: poolHit,
      shopOrderTop1Correct: shopTop1Hit,
      decisionsRerankTop1Correct: decTop1Hit,
      falseExactCount: clipFalseExact,
      topOffer: topRanked
        ? {
            title: topRanked.title,
            sellerName: topRanked.sellerName,
            originalSearchRank: topRanked.originalSearchRank,
            exactMatchYes: topRanked.exactMatchYes,
            confidence: topRanked.confidence,
            matchLabel: topRanked.matchLabel,
          }
        : null,
    });
  }

  const summary = {
    executedAt: startedAtIso,
    completedAt: new Date().toISOString(),
    controlledUnitEval: {
      totalCases: CONTROLLED_RANKING_CASES.length,
      positiveCases: positiveControlled,
      baselineTop1: shopBaselineTop1,
      singleFrameTop1,
      crossSceneTop1,
      falseExactSingle,
      falseExactCross,
    },
    realYouTubeClipsEval: {
      totalClips: manifest.length,
      retrievalHits: realClipsRetrievalHits,
      shopOrderTop1Hits: realClipsShopTop1Hits,
      decisionsRerankTop1Hits: realClipsDecisionsTop1Hits,
      falseExactSupportedCount: realClipsFalseExact,
      clips: clipRecords,
    },
  };

  const resultsDir = path.resolve(process.cwd(), "evals/results");
  fs.mkdirSync(resultsDir, { recursive: true });
  fs.writeFileSync(
    path.join(resultsDir, "latest.json"),
    JSON.stringify(summary, null, 2),
  );

  console.log("=== Final Eval Summary ===");
  console.log(JSON.stringify(summary.controlledUnitEval, null, 2));
  console.log(
    JSON.stringify(
      {
        totalClips: summary.realYouTubeClipsEval.totalClips,
        retrievalHits: summary.realYouTubeClipsEval.retrievalHits,
        shopOrderTop1Hits: summary.realYouTubeClipsEval.shopOrderTop1Hits,
        decisionsRerankTop1Hits:
          summary.realYouTubeClipsEval.decisionsRerankTop1Hits,
        falseExactSupportedCount:
          summary.realYouTubeClipsEval.falseExactSupportedCount,
      },
      null,
      2,
    ),
  );

  if (
    crossSceneTop1 < positiveControlled ||
    falseExactCross > 0 ||
    realClipsRetrievalHits === 0
  ) {
    throw new Error("Eval quality gate failed.");
  }
}

main().catch((err) => {
  console.error("Eval failed:", err);
  process.exit(1);
});
