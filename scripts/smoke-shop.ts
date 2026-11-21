import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  createShopifyHostedCheckout,
  readShopifyCheckoutStatus,
  refreshVariantWithGetProduct,
  retrieveShopifyCandidatesForItem,
} from "../src/lib/shop/client";
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
  const query = process.argv[2] || "ceramic coffee mug";
  const sampleItem: TracedItem = {
    itemId: "smoke_item_1",
    category: "drinkware",
    label: query,
    summary: "Phase 0 live Shop MCP smoke check",
    sightings: [
      {
        startSec: 2,
        endSec: 8,
        evidenceSec: 4,
        observation: "Item visible on desk",
      },
    ],
    bestEvidenceSec: 4,
    features: [{ name: "category", value: query, atSec: 4, source: "visible" }],
    brand: null,
    modelReference: null,
    searchQueries: [query],
  };

  console.log(`[smoke:shop] 1. Searching Shop MCP for "${query}"...`);
  const searchRes = await retrieveShopifyCandidatesForItem({
    item: sampleItem,
    country: "US",
    currency: "USD",
  });
  console.log(
    `[smoke:shop] Retrieved ${searchRes.candidates.length} verified Shopify variants in ${searchRes.durationMs}ms.`,
  );

  const available = searchRes.candidates.find(
    (c) => c.availability === "available",
  );
  if (!available) {
    throw new Error("No available Shopify variant returned from search.");
  }

  // Save anonymized Shop MCP candidate fixture for offline contract & eval inspection
  const fixturesDir = path.resolve(process.cwd(), "evals/fixtures");
  fs.mkdirSync(fixturesDir, { recursive: true });
  const anonymizedSample = {
    capturedAt: new Date().toISOString(),
    protocolVersion: "2026-07-28",
    query,
    candidateCount: searchRes.candidates.length,
    sampleCandidate: {
      ...available,
      productUrl: available.productUrl.split("?")[0],
    },
  };
  fs.writeFileSync(
    path.join(fixturesDir, "shop-sample.json"),
    JSON.stringify(anonymizedSample, null, 2),
  );

  console.log("[smoke:shop] 2. Re-reading chosen variant with get_product:", {
    title: available.title,
    sellerName: available.sellerName,
    sellerDomain: available.sellerDomain,
    amountMinor: available.amountMinor,
    currency: available.currency,
  });

  const refreshed = await refreshVariantWithGetProduct({
    productId: available.productId,
    variantId: available.variantId,
    sellerDomain: available.sellerDomain,
    selectedOptions: available.options,
    country: "US",
    currency: "USD",
  });
  if (!refreshed) {
    throw new Error("get_product failed to confirm chosen variant.");
  }

  console.log("[smoke:shop] 3. Creating hosted Shopify checkout...");
  const checkout = await createShopifyHostedCheckout({
    sellerDomain: refreshed.sellerDomain,
    variantId: refreshed.variantId,
    country: "US",
    idempotencyKey: crypto.randomUUID(),
  });

  console.log("[smoke:shop] Checkout created successfully:", {
    status: checkout.status,
    orderPlaced: checkout.orderPlaced,
    currency: checkout.currency,
    subtotalMinor: checkout.subtotalMinor,
    hasHttpsContinueUrl: checkout.continueUrl.startsWith("https://"),
  });

  const reread = await readShopifyCheckoutStatus({
    sellerDomain: refreshed.sellerDomain,
    checkoutId: checkout.checkoutId,
    fallbackContinueUrl: checkout.continueUrl,
  });
  console.log("[smoke:shop] 4. get_checkout status verified:", {
    status: reread.status,
    orderPlaced: reread.orderPlaced,
  });
}

main().catch((err) => {
  console.error("[smoke:shop] FAILED:", err);
  process.exit(1);
});
