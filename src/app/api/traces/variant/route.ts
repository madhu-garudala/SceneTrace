import { NextResponse } from "next/server";
import { z } from "zod";
import { getShopLocaleDefaults } from "@/lib/env";
import {
  applyScoresAndSortCandidates,
  rankCandidatesWithDecisions,
  type CandidateForScoring,
} from "@/lib/matching/decisions";
import { signOfferToken, verifyOfferToken } from "@/lib/security/tokens";
import { selectVariantByOptionsWithGetProduct } from "@/lib/shop/client";
import type { TracedItem } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 45;

const NON_VISUAL_OPTION_REGEX = /^(size|shoe\s*size|waist|length|inseam|width|fit)$/i;

const SelectVariantSchema = z.object({
  offerToken: z.string().min(20).max(8192),
  desiredOptions: z
    .array(
      z.object({
        name: z.string().min(1).max(80),
        label: z.string().min(1).max(120),
      }),
    )
    .min(1)
    .max(6),
  originalSearchRank: z.number().int().positive().optional().default(1),
  previousExactMatchYes: z.number().min(0).max(1).nullable().optional(),
  previousConfidence: z.number().min(0).max(1).nullable().optional(),
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
  }),
  country: z.string().length(2).optional(),
});

export async function POST(request: Request) {
  try {
    const rawJson = await request.json();
    const parsed = SelectVariantSchema.safeParse(rawJson);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error:
            parsed.error.issues[0]?.message ?? "Invalid option selection.",
        },
        { status: 400 },
      );
    }

    const baseOffer = verifyOfferToken(parsed.data.offerToken);
    const defaults = getShopLocaleDefaults();
    const country = (parsed.data.country ?? defaults.country).toUpperCase();
    const currency = baseOffer.currency ?? defaults.currency;

    const resolved = await selectVariantByOptionsWithGetProduct({
      productId: baseOffer.productId,
      sellerDomain: baseOffer.sellerDomain,
      desiredOptions: parsed.data.desiredOptions,
      country,
      currency,
    });

    if (!resolved) {
      return NextResponse.json(
        {
          error:
            "That option combination is currently unavailable from this merchant.",
        },
        { status: 409 },
      );
    }

    // Determine whether any visually relevant option (e.g. Color, Finish, Style, Material) changed
    const visualOptionChanged = resolved.options.some((newOpt) => {
      if (NON_VISUAL_OPTION_REGEX.test(newOpt.name.trim())) return false;
      const oldOpt = baseOffer.options.find(
        (o) => o.name.trim().toLowerCase() === newOpt.name.trim().toLowerCase(),
      );
      return !oldOpt || oldOpt.label.trim().toLowerCase() !== newOpt.label.trim().toLowerCase();
    });

    const item: TracedItem = parsed.data.item;
    const candidateForScoring: CandidateForScoring = {
      ...resolved,
      offerId: baseOffer.offerId,
      originalSearchRank: parsed.data.originalSearchRank,
    };

    let scoredOffer: ReturnType<
      typeof applyScoresAndSortCandidates
    >["ranked"][number];

    if (visualOptionChanged) {
      // Re-score the newly chosen visual variant live with Decisions API + conflict gates
      const rescored = await rankCandidatesWithDecisions({
        item,
        candidates: [candidateForScoring],
      });
      scoredOffer = rescored.ranked[0];
    } else {
      // Pure size change: re-run deterministic gates & rationale with existing visual probability
      const reevaluated = applyScoresAndSortCandidates({
        item,
        candidates: [candidateForScoring],
        scoresByOfferId: new Map([
          [
            baseOffer.offerId,
            {
              exactMatchYes: parsed.data.previousExactMatchYes ?? null,
              confidence: parsed.data.previousConfidence ?? null,
            },
          ],
        ]),
      });
      scoredOffer = reevaluated.ranked[0];
    }

    const newOfferToken = signOfferToken({
      offerId: baseOffer.offerId,
      itemId: baseOffer.itemId,
      productId: resolved.productId,
      variantId: resolved.variantId,
      sellerDomain: resolved.sellerDomain,
      sellerName: resolved.sellerName,
      title: resolved.title,
      options: resolved.options,
      amountMinor: resolved.amountMinor,
      currency: resolved.currency,
      availability: resolved.availability,
      productUrl: resolved.productUrl,
      imageUrl: resolved.imageUrl,
    });

    return NextResponse.json(
      {
        updated: {
          offerId: baseOffer.offerId,
          offerToken: newOfferToken,
          variantId: resolved.variantId,
          title: resolved.title,
          options: resolved.options,
          availableOptions: resolved.availableOptions,
          amountMinor: resolved.amountMinor,
          currency: resolved.currency,
          availability: resolved.availability,
          productUrl: resolved.productUrl,
          imageUrl: resolved.imageUrl,
          exactMatchYes: scoredOffer.exactMatchYes,
          confidence: scoredOffer.confidence,
          matchLabel: scoredOffer.matchLabel,
          hardConflict: scoredOffer.hardConflict,
          rationale: scoredOffer.rationale,
        },
      },
      { status: 200 },
    );
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Could not select variant option.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
