import fs from "node:fs";
import path from "node:path";
import {
  rankCandidatesWithDecisions,
  type CandidateForScoring,
} from "../src/lib/matching/decisions";
import type { TracedItem } from "../src/lib/types";

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

async function main() {
  loadDotEnv();

  const item: TracedItem = {
    itemId: "smoke_shoe_1",
    category: "sneakers",
    label: "Adidas Samba OG White Black Gum Low-Top Sneakers",
    summary:
      "Low-top white leather sneaker with black three-stripes, grey suede T-toe overlay, and dark gum rubber sole.",
    sightings: [
      {
        startSec: 5,
        endSec: 11,
        evidenceSec: 8,
        observation: "Side profile showing white leather upper and black stripes",
      },
      {
        startSec: 19,
        endSec: 25,
        evidenceSec: 22,
        observation: "Close-up of suede T-toe and gold SAMBA lettering",
      },
    ],
    bestEvidenceSec: 22,
    features: [
      { name: "brand", value: "Adidas", atSec: 22, source: "visible" },
      { name: "logo_text", value: "SAMBA", atSec: 22, source: "visible" },
      { name: "primary_color", value: "white", atSec: 8, source: "visible" },
      {
        name: "stripes",
        value: "three black serrated stripes",
        atSec: 8,
        source: "visible",
      },
      { name: "sole", value: "gum rubber", atSec: 22, source: "visible" },
    ],
    brand: "Adidas",
    modelReference: "Samba OG",
    searchQueries: ["Adidas Samba OG white black gum"],
  };

  // Deliberately place the wrong colorway/model at Shop rank #1 and the true match at rank #2
  const candidates: CandidateForScoring[] = [
    {
      offerId: "cand_wrong_color",
      productId: "gid://shopify/p/1",
      variantId: "gid://shopify/ProductVariant/1",
      sellerDomain: "sneaker-store-a.myshopify.com",
      sellerName: "Sneaker Store A",
      title: "Adidas Gazelle Indoor Collegiate Green Sneakers",
      descriptionSnippet: "Green suede upper with translucent gum outsole.",
      options: [
        { name: "Color", label: "Green / White" },
        { name: "Size", label: "10" },
      ],
      amountMinor: 12000,
      currency: "USD",
      availability: "available",
      condition: "new",
      productUrl: "https://example.com/gazelle",
      imageUrl: null,
      warnings: [],
      originalSearchRank: 1,
    },
    {
      offerId: "cand_exact_samba",
      productId: "gid://shopify/p/2",
      variantId: "gid://shopify/ProductVariant/2",
      sellerDomain: "sneaker-store-b.myshopify.com",
      sellerName: "Sneaker Store B",
      title: "Adidas Originals Samba OG Cloud White / Core Black / Gum",
      descriptionSnippet:
        "Full-grain white leather upper with gritty suede T-toe, black 3-Stripes, gold foil Samba branding, and gum rubber midsole.",
      options: [
        { name: "Color", label: "White / Black / Gum" },
        { name: "Size", label: "10" },
      ],
      amountMinor: 10000,
      currency: "USD",
      availability: "available",
      condition: "new",
      productUrl: "https://example.com/samba-og",
      imageUrl: null,
      warnings: [],
      originalSearchRank: 2,
    },
  ];

  console.log("[smoke:decisions] Scoring candidates via /v1beta/decisions...");
  const res = await rankCandidatesWithDecisions({ item, candidates });
  console.log("[smoke:decisions] Result:", {
    decisionsLive: res.decisionsLive,
    model: res.decisionModel,
    evidenceMode: res.evidenceMode,
    durationMs: res.durationMs,
    comparison: res.comparison,
  });

  if (res.ranked[0]?.offerId !== "cand_exact_samba") {
    throw new Error(
      "Expected Adidas Samba OG to rank #1 above Adidas Gazelle!",
    );
  }
  console.log("[smoke:decisions] Verified exact candidate ranked #1!");
}

main().catch((err) => {
  console.error("[smoke:decisions] FAILED:", err);
  process.exit(1);
});
