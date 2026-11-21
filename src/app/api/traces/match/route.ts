import { NextResponse } from "next/server";
import { z } from "zod";
import { getDecisionsModel, getShopLocaleDefaults } from "@/lib/env";
import { rankCandidatesWithDecisions } from "@/lib/matching/decisions";
import { signOfferToken } from "@/lib/security/tokens";
import { retrieveShopifyCandidatesForItem } from "@/lib/shop/client";
import type {
  EvidenceFrame,
  MatchItemResponse,
  Offer,
  TracedItem,
} from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 120;

// Shared 95s execution ceiling reserves 25s headroom inside Vercel's 120s maxDuration
const ROUTE_DEADLINE_MS = 95_000;

const MatchRequestSchema = z.object({
  traceId: z.string().min(1).max(120),
  item: z.object({
    itemId: z.string().min(1).max(120),
    category: z.string().min(1).max(120),
    label: z.string().min(1).max(240),
    summary: z.string().max(600),
    sightings: z
      .array(
        z.object({
          startSec: z.number().finite().min(0),
          endSec: z.number().finite().min(0),
          evidenceSec: z.number().finite().min(0),
          observation: z.string().max(500),
        }),
      )
      .min(1)
      .max(12),
    bestEvidenceSec: z.number().finite().min(0),
    bestBox2d: z.tuple([z.number(), z.number(), z.number(), z.number()]).nullable().optional(),
    features: z
      .array(
        z.object({
          name: z.string().max(120),
          value: z.string().max(300),
          atSec: z.number().finite().min(0),
          source: z.enum(["visible", "spoken", "inferred"]),
        }),
      )
      .max(16),
    brand: z.string().max(160).nullable(),
    modelReference: z.string().max(160).nullable(),
    searchQueries: z.array(z.string().max(200)).max(6),
    constraints: z
      .object({
        maxPriceMajor: z.number().nullable(),
        currency: z.string().nullable(),
        requestedSize: z.string().nullable(),
        requestedColor: z.string().nullable(),
      })
      .optional(),
  }),
  evidenceFrames: z
    .array(
      z.object({
        kind: z
          .enum(["video_frame", "video_crop", "uploaded_still"])
          .optional()
          .default("video_frame"),
        atSec: z.number().finite().min(0).nullable(),
        mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
        // Enforces < ~710 KB per frame -> max ~2.1 MB across 3 frames (well below Vercel's 4.5 MB cap)
        dataBase64: z.string().min(16).max(950_000),
        dataUrl: z.string().max(2048).optional().default(""),
        width: z.number().int().positive().max(4096),
        height: z.number().int().positive().max(4096),
        label: z.string().max(160),
      }),
    )
    .max(3)
    .optional()
    .default([]),
  country: z.string().length(2).optional(),
  currency: z.string().length(3).optional(),
});

export async function POST(request: Request) {
  const deadlineSignal = AbortSignal.timeout(ROUTE_DEADLINE_MS);

  try {
    const rawJson = await request.json();
    const parsed = MatchRequestSchema.safeParse(rawJson);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error:
            parsed.error.issues[0]?.message ?? "Invalid item match payload.",
        },
        { status: 400 },
      );
    }

    const defaults = getShopLocaleDefaults();
    const country = (parsed.data.country ?? defaults.country).toUpperCase();
    const currency = (parsed.data.currency ?? defaults.currency).toUpperCase();
    const item: TracedItem = parsed.data.item;
    const frames: EvidenceFrame[] = parsed.data.evidenceFrames;

    let candidates: Awaited<
      ReturnType<typeof retrieveShopifyCandidatesForItem>
    >["candidates"] = [];
    let queriesRun: string[] = [];
    let usedVisualSearch = false;
    let photoSearchError: string | null = null;
    let shopDurationMs = 0;
    let shopLive = true;
    let shopError: string | null = null;

    const shopStart = Date.now();
    try {
      const shopResult = await retrieveShopifyCandidatesForItem({
        item,
        primaryFrame: frames[0] ?? null,
        country,
        currency,
        signal: deadlineSignal,
      });
      candidates = shopResult.candidates;
      queriesRun = shopResult.queriesRun;
      usedVisualSearch = shopResult.usedVisualSearch;
      photoSearchError = shopResult.photoSearchError;
      shopDurationMs = shopResult.durationMs;
    } catch (err) {
      shopLive = false;
      shopDurationMs = Date.now() - shopStart;
      shopError =
        err instanceof Error ? err.message : "Shopify catalog search failed.";
    }

    if (!shopLive || candidates.length === 0) {
      const emptyResponse: MatchItemResponse = {
        traceId: parsed.data.traceId,
        itemId: item.itemId,
        offers: [],
        diagnostics: {
          itemId: item.itemId,
          shopLive,
          decisionsLive: false,
          evidenceMode:
            frames.length > 0 ? "frames_and_text" : "text_observations",
          decisionModel: getDecisionsModel(),
          candidateCount: 0,
          queriesRun,
          usedVisualSearch,
          photoSearchError,
          shopDurationMs,
          decisionsDurationMs: 0,
          shopError,
          rankingError: null,
          rankComparison: [],
        },
      };
      return NextResponse.json(emptyResponse, { status: 200 });
    }

    const decisionsResult = await rankCandidatesWithDecisions({
      item,
      candidates,
      evidenceFrames: frames,
      signal: deadlineSignal,
    });

    const signedOffers: Offer[] = decisionsResult.ranked.map((scored) => {
      const offerToken = signOfferToken({
        offerId: scored.offerId,
        itemId: item.itemId,
        productId: scored.productId,
        variantId: scored.variantId,
        sellerDomain: scored.sellerDomain,
        sellerName: scored.sellerName,
        title: scored.title,
        options: scored.options,
        amountMinor: scored.amountMinor,
        currency: scored.currency,
        availability: scored.availability,
        productUrl: scored.productUrl,
        imageUrl: scored.imageUrl,
      });

      return {
        offerId: scored.offerId,
        offerToken,
        itemId: item.itemId,
        productId: scored.productId,
        variantId: scored.variantId,
        sellerDomain: scored.sellerDomain,
        sellerName: scored.sellerName,
        title: scored.title,
        options: scored.options,
        availableOptions: scored.availableOptions,
        amountMinor: scored.amountMinor,
        currency: scored.currency,
        availability: scored.availability,
        condition: scored.condition,
        productUrl: scored.productUrl,
        imageUrl: scored.imageUrl,
        warnings: scored.warnings,
        originalSearchRank: scored.originalSearchRank,
        exactMatchYes: scored.exactMatchYes,
        confidence: scored.confidence,
        matchLabel: scored.matchLabel,
        hardConflict: scored.hardConflict,
        rationale: scored.rationale,
      };
    });

    const responsePayload: MatchItemResponse = {
      traceId: parsed.data.traceId,
      itemId: item.itemId,
      offers: signedOffers,
      diagnostics: {
        itemId: item.itemId,
        shopLive,
        decisionsLive: decisionsResult.decisionsLive,
        evidenceMode: decisionsResult.evidenceMode,
        decisionModel: decisionsResult.decisionModel,
        candidateCount: signedOffers.length,
        queriesRun,
        usedVisualSearch,
        photoSearchError,
        shopDurationMs,
        decisionsDurationMs: decisionsResult.durationMs,
        shopError,
        rankingError: decisionsResult.rankingError,
        rankComparison: decisionsResult.comparison,
      },
    };

    return NextResponse.json(responsePayload, { status: 200 });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed matching Shopify offers.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
