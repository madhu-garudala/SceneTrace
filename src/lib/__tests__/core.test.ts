import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildCacheKey,
  clearServerCacheForTests,
  withServerCache,
} from "@/lib/cache/store";
import {
  applyScoresAndSortCandidates,
  detectHardConflict,
  extractColorFamilies,
  type CandidateForScoring,
} from "@/lib/matching/decisions";
import {
  decryptCheckoutRef,
  encryptCheckoutRef,
  signOfferToken,
  verifyOfferToken,
} from "@/lib/security/tokens";
import {
  buildCatalogFilters,
  interleaveCandidateMaps,
  parseMaybeSseOrJson,
  parseProviderCheckoutDocument,
} from "@/lib/shop/client";
import {
  evaluateVariantFreshness,
  formatMoneyMinor,
} from "@/lib/shop/freshness";
import type { TracedItem } from "@/lib/types";
import { normalizeRawExtractionPayload } from "@/lib/video/extract";
import {
  formatTimestamp,
  mapClipTimestampToOriginal,
  parseAndNormalizeYouTubeUrl,
} from "@/lib/video/youtube";

describe("YouTube URL normalization, timestamp mapping & extraction isolation", () => {
  it("normalizes watch, short, embed, and youtu.be URLs to one canonical ID", () => {
    const expectedId = "dQw4w9WgXcQ";
    const urls = [
      `https://www.youtube.com/watch?v=${expectedId}&list=PL123&t=42s`,
      `https://youtu.be/${expectedId}?si=tracking123`,
      `https://youtube.com/shorts/${expectedId}?feature=share`,
      `https://m.youtube.com/embed/${expectedId}`,
    ];

    for (const url of urls) {
      const res = parseAndNormalizeYouTubeUrl(url);
      expect(res.videoId).toBe(expectedId);
      expect(res.canonicalUrl).toBe(
        `https://www.youtube.com/watch?v=${expectedId}`,
      );
    }
  });

  it("rejects non-YouTube hosts and playlist-only URLs", () => {
    expect(() =>
      parseAndNormalizeYouTubeUrl("https://vimeo.com/123456789"),
    ).toThrow(/Unsupported video host/);
    expect(() =>
      parseAndNormalizeYouTubeUrl(
        "https://www.youtube.com/playlist?list=PL123456",
      ),
    ).toThrow(/Playlist/);
    expect(() =>
      parseAndNormalizeYouTubeUrl("https://www.youtube.com/watch?list=PL123456"),
    ).toThrow(/Playlist-only/);
  });

  it("maps clip timestamps with offset and duration clamping accurately", () => {
    expect(mapClipTimestampToOriginal(12.34, 30)).toBe(42.3);
    expect(mapClipTimestampToOriginal(55, 20, 60)).toBe(60);
    expect(mapClipTimestampToOriginal(-4, 0)).toBe(0);
    expect(formatTimestamp(83.9)).toBe("1:23");
  });

  it("isolates malformed items in normalizeRawExtractionPayload and clamps bestEvidenceSec", () => {
    const raw = {
      videoSummary: "Host shows sneakers and a broken entry.",
      shopperConstraints: {
        maxPriceMajor: 120,
        currency: "usd",
        requestedSize: "10",
        requestedColor: "",
      },
      items: [
        {
          category: "sneakers",
          label: "White Leather Low-Top",
          summary: "Seen clearly at 14s.",
          brand: "Adidas",
          modelReference: "Samba OG",
          bestEvidenceSec: 99, // out of sighting bounds [10, 18] -> should clamp to 18
          bestBox2d: [200, 300, 750, 820],
          sightings: [
            {
              startSec: 10,
              endSec: 18,
              evidenceSec: 14,
              observation: "Close-up of shoe",
            },
          ],
          features: [
            {
              name: "primary_color",
              value: "white",
              atSec: 14,
              source: "visible",
            },
          ],
          searchQueries: ["Adidas Samba OG white"],
        },
        {
          // Invalid: empty sightings array
          category: "jacket",
          label: "Broken Item",
          summary: "Malformed",
          bestEvidenceSec: 5,
          sightings: [],
          features: [],
          searchQueries: ["jacket"],
        },
      ],
    };

    const normalized = normalizeRawExtractionPayload(raw);
    expect(normalized.items).toHaveLength(1);
    expect(normalized.droppedItemCount).toBe(1);
    expect(normalized.items[0].bestEvidenceSec).toBe(18);
    expect(normalized.items[0].bestBox2d).toEqual([200, 300, 750, 820]);
    expect(normalized.items[0].constraints?.maxPriceMajor).toBe(120);
    expect(normalized.items[0].constraints?.requestedSize).toBe("10");
  });
});

describe("Stateless HMAC offerToken & AES-256-GCM checkoutRef", () => {
  const secret = crypto.createHash("sha256").update("unit-test-secret").digest();

  it("signs and verifies offerToken and rejects tampering", () => {
    const token = signOfferToken(
      {
        offerId: "offer_1",
        itemId: "item_1",
        productId: "gid://shopify/p/abc",
        variantId: "gid://shopify/ProductVariant/123",
        sellerDomain: "demo-merchant.myshopify.com",
        sellerName: "Demo Merchant",
        title: "Canvas Low Sneaker",
        options: [
          { name: "Color", label: "Black" },
          { name: "Size", label: "10" },
        ],
        amountMinor: 6500,
        currency: "USD",
        availability: "available",
        productUrl: "https://demo-merchant.myshopify.com/products/sneaker",
        imageUrl: "https://cdn.shopify.com/s/files/sneaker.jpg",
      },
      secret,
    );

    const verified = verifyOfferToken(token, secret);
    expect(verified.variantId).toBe("gid://shopify/ProductVariant/123");
    expect(verified.amountMinor).toBe(6500);

    const [, sig] = token.split(".");
    const tamperedBody = Buffer.from(
      JSON.stringify({ ...verified, amountMinor: 100 }),
    ).toString("base64url");
    expect(() => verifyOfferToken(`${tamperedBody}.${sig}`, secret)).toThrow(
      /signature verification failed/,
    );
  });

  it("encrypts checkoutRef without leaking raw IDs and rejects GCM auth-tag tampering", () => {
    const rawCheckoutId = "gid://shopify/Checkout/secret-998877";
    const continueUrl = "https://shop.example.com/checkouts/cn/secret-998877";
    const ref = encryptCheckoutRef(
      {
        checkoutId: rawCheckoutId,
        shop: "shop.example.com",
        continueUrl,
        sellerName: "Example Shop",
        variantId: "gid://shopify/ProductVariant/123",
        title: "Ceramic Mug",
        options: [{ name: "Color", label: "Matte Black" }],
        subtotalMinor: 1400,
        totalMinor: 1400,
        currency: "USD",
        warnings: [],
      },
      secret,
    );

    expect(ref).not.toContain("secret-998877");
    const recovered = decryptCheckoutRef(ref, secret);
    expect(recovered.checkoutId).toBe(rawCheckoutId);

    const [iv, ct, tag] = ref.split(".");
    const flippedTag = Buffer.from(tag, "base64url");
    flippedTag[0] ^= 0xff;
    expect(() =>
      decryptCheckoutRef(
        `${iv}.${ct}.${flippedTag.toString("base64url")}`,
        secret,
      ),
    ).toThrow();
  });
});

describe("Shop MCP SSE parsing, freshness gates, and ISO-4217 money formatting", () => {
  it("parses Streamable HTTP / SSE data frames cleanly", () => {
    const sse = [
      "event: message",
      'data: {"jsonrpc":"2.0","method":"notifications/progress"}',
      "",
      'data: {"jsonrpc":"2.0","id":"1","result":{"structuredContent":{"ok":true}}}',
      "",
    ].join("\n");
    const parsed = parseMaybeSseOrJson(sse) as {
      result?: { structuredContent?: { ok?: boolean } };
    };
    expect(parsed.result?.structuredContent?.ok).toBe(true);
  });

  it("sets orderPlaced=true ONLY when checkout status is completed AND an order object exists", () => {
    const incomplete = parseProviderCheckoutDocument({
      id: "gid://shopify/Checkout/1",
      continue_url: "https://shop.example.com/c/1",
      status: "ready_for_complete",
      currency: "USD",
    });
    expect(incomplete.orderPlaced).toBe(false);

    const completedWithoutOrder = parseProviderCheckoutDocument({
      id: "gid://shopify/Checkout/1",
      continue_url: "https://shop.example.com/c/1",
      status: "completed",
      currency: "USD",
    });
    expect(completedWithoutOrder.orderPlaced).toBe(false);

    const completedWithOrder = parseProviderCheckoutDocument({
      id: "gid://shopify/Checkout/1",
      continue_url: "https://shop.example.com/c/1",
      status: "completed",
      currency: "USD",
      order: {
        id: "gid://shopify/Order/999",
        permalink_url: "https://shop.example.com/orders/999",
      },
    });
    expect(completedWithOrder.orderPlaced).toBe(true);
    expect(completedWithOrder.orderId).toBe("gid://shopify/Order/999");
  });

  it("detects disappearing options, null price transitions, and currency changes in evaluateVariantFreshness", () => {
    const baseApproved = {
      title: "Trail Jacket",
      sellerName: "Gear Co",
      options: [{ name: "Size", label: "M" }],
      amountMinor: 9500,
      currency: "USD",
    };

    // Disappearing options must NOT silently pass!
    expect(
      evaluateVariantFreshness(baseApproved, {
        ...baseApproved,
        availability: "available",
        options: [],
      }).status,
    ).toBe("options_changed");

    // Price becoming null must trigger price_changed
    expect(
      evaluateVariantFreshness(baseApproved, {
        ...baseApproved,
        availability: "available",
        amountMinor: null,
      }).status,
    ).toBe("price_changed");

    // Currency changing must trigger price_changed
    expect(
      evaluateVariantFreshness(baseApproved, {
        ...baseApproved,
        availability: "available",
        currency: "CAD",
      }).status,
    ).toBe("price_changed");

    // Exact match passes, and enriching empty [] options on identical variantId passes
    expect(
      evaluateVariantFreshness(baseApproved, {
        ...baseApproved,
        availability: "available",
      }).status,
    ).toBe("ok");

    expect(
      evaluateVariantFreshness(
        { ...baseApproved, options: [] },
        { ...baseApproved, availability: "available" },
      ).status,
    ).toBe("ok");
  });

  it("interleaves photo hits with text hits and preserves shopper CAD budget/size filters", () => {
    const mk = (id: string) => ({
      productId: id,
      variantId: `${id}_v`,
      sellerDomain: "s.myshopify.com",
      sellerName: "S",
      title: id,
      options: [],
      amountMinor: 1000,
      currency: "CAD",
      availability: "available" as const,
      condition: "new",
      productUrl: "https://s.myshopify.com/p",
      imageUrl: null,
      warnings: [],
    });

    const textMap = new Map(
      ["t1", "t2", "t3", "t4", "t5", "t6", "t7"].map((k) => [k, mk(k)]),
    );
    const photoMap = new Map([
      ["p1", mk("p1")],
      ["p2", mk("p2")],
    ]);
    const interleaved = interleaveCandidateMaps(
      textMap,
      photoMap,
      new Map(),
      6,
    );
    expect(interleaved.map((c) => c.productId)).toEqual([
      "t1",
      "p1",
      "t2",
      "p2",
      "t3",
      "t4",
    ]);

    const { effectiveCurrency, filters } = buildCatalogFilters(
      {
        itemId: "i1",
        category: "jacket",
        label: "Rain Jacket",
        summary: "Jacket",
        sightings: [{ startSec: 1, endSec: 2, evidenceSec: 1, observation: "x" }],
        bestEvidenceSec: 1,
        features: [],
        brand: null,
        modelReference: null,
        searchQueries: ["rain jacket"],
        constraints: {
          maxPriceMajor: 80,
          currency: "CAD",
          requestedSize: "M",
          requestedColor: null,
        },
      },
      "CA",
      "USD",
    );
    expect(effectiveCurrency).toBe("CAD");
    expect(filters).toEqual({
      ships_to: { country: "CA" },
      price: { max: 8000 },
      attributes: [{ name: "Size", values: ["M"] }],
    });
  });

  it("formats zero-decimal (JPY), two-decimal (USD), and three-decimal (BHD) minor units accurately", () => {
    expect(formatMoneyMinor(1900, "USD")).toBe("$19.00");
    expect(formatMoneyMinor(2500, "JPY")).toBe("¥2,500");
    expect(formatMoneyMinor(15000, "BHD")).toContain("15.000");
  });
});

describe("Decisions ranking, noul vs confidence, brand/color gates & candidate agreement", () => {
  const baseItem: TracedItem = {
    itemId: "item_watch",
    category: "wristwatch",
    label: "Casio F-91W Black Digital Watch",
    summary: "Classic rectangular black resin digital watch seen on left wrist.",
    sightings: [
      {
        startSec: 4,
        endSec: 9,
        evidenceSec: 6.5,
        observation: "Blurry medium shot of black digital watch",
      },
      {
        startSec: 22,
        endSec: 27,
        evidenceSec: 24,
        observation: "Close-up showing CASIO F-91W dial text",
      },
    ],
    bestEvidenceSec: 24,
    features: [
      { name: "brand_logo", value: "CASIO", atSec: 24, source: "visible" },
      { name: "reference", value: "F-91W", atSec: 24, source: "visible" },
      { name: "primary_color", value: "black", atSec: 6.5, source: "visible" },
    ],
    brand: "Casio",
    modelReference: "F-91W",
    searchQueries: ["Casio F-91W black watch"],
  };

  const makeCand = (
    idx: number,
    overrides: Partial<CandidateForScoring>,
  ): CandidateForScoring => ({
    offerId: `off_${idx}`,
    productId: `prod_${idx}`,
    variantId: `var_${idx}`,
    sellerDomain: `merchant${idx}.com`,
    sellerName: `Merchant ${idx}`,
    title: "Casio F-91W-1XY Black Resin Digital Watch",
    options: [{ name: "Color", label: "Black" }],
    amountMinor: 1995,
    currency: "USD",
    availability: "available",
    condition: "new",
    productUrl: `https://merchant${idx}.com/p`,
    imageUrl: null,
    warnings: [],
    originalSearchRank: idx,
    ...overrides,
  });

  it("ranks a probable YES above a high-confidence NO and allows two matching merchants to both rank highly", () => {
    const confidentNo = makeCand(1, {
      title: "Casio F-91W-1XY Digital Watch",
      options: [{ name: "Color", label: "Black" }],
    });
    const merchantAExact = makeCand(2, {
      sellerName: "WatchBox",
      sellerDomain: "watchbox.example.com",
    });
    const merchantBExact = makeCand(3, {
      sellerName: "Timekeeper Co",
      sellerDomain: "timekeeper.example.com",
    });

    const scores = new Map([
      [confidentNo.offerId, { exactMatchYes: 0.04, confidence: 0.97 }],
      [merchantAExact.offerId, { exactMatchYes: 0.91, confidence: 0.91 }],
      [merchantBExact.offerId, { exactMatchYes: 0.89, confidence: 0.89 }],
    ]);

    const { ranked } = applyScoresAndSortCandidates({
      item: baseItem,
      candidates: [confidentNo, merchantAExact, merchantBExact],
      scoresByOfferId: scores,
    });

    expect(ranked[0].offerId).toBe(merchantAExact.offerId);
    expect(ranked[0].matchLabel).toBe("exact_supported");
    expect(ranked[1].offerId).toBe(merchantBExact.offerId);
    expect(ranked[1].matchLabel).toBe("exact_supported");
    expect(ranked[2].offerId).toBe(confidentNo.offerId);
    expect(ranked[2].matchLabel).toBe("similar");
  });

  it("does NOT falsely flag brand conflict when title omits brand but sellerName/domain carries the brand", () => {
    const sambaItem: TracedItem = {
      ...baseItem,
      category: "sneakers",
      label: "Adidas Samba OG White Black",
      brand: "Adidas",
      modelReference: "Samba OG",
      features: [
        { name: "brand", value: "Adidas", atSec: 10, source: "visible" },
        { name: "reference", value: "Samba", atSec: 10, source: "visible" },
        {
          name: "primary_color",
          value: "white",
          atSec: 10,
          source: "visible",
        },
      ],
    };

    const brandInSellerListing = makeCand(1, {
      title: "Samba OG Shoes", // omits "Adidas" in title!
      sellerName: "adidas US",
      sellerDomain: "adidas.myshopify.com",
      options: [{ name: "Color", label: "Cloud White / Core Black / Gum" }],
    });

    expect(detectHardConflict(sambaItem, brandInSellerListing)).toBeNull();
  });

  it("handles grey vs navy conflicts (even when title says Grey), multi-color labels, and Sony WH-1000XM5 vs XM4", () => {
    expect(extractColorFamilies("Rose Gold Mesh")).toEqual(
      new Set(["yellow_gold"]),
    );
    expect(extractColorFamilies("Cloud White / Core Black / Gum")).toEqual(
      new Set(["white", "black"]),
    );

    const greyShoeItem: TracedItem = {
      ...baseItem,
      brand: "New Balance",
      modelReference: "574",
      features: [
        { name: "primary_color", value: "grey", atSec: 5, source: "visible" },
      ],
    };

    // Even if product title mentions "Grey Shoe", selected variant `Color: Navy` MUST conflict!
    const navySelectedOnGreyTitle = makeCand(1, {
      title: "New Balance 574 Grey Collection Shoe",
      options: [{ name: "Color", label: "Navy" }],
    });
    expect(detectHardConflict(greyShoeItem, navySelectedOnGreyTitle)).toMatch(
      /Navy/,
    );

    // Sony WH-1000XM5 vs Sony WH-1000XM4 must conflict on distinguishing SKU token!
    const xm5Item: TracedItem = {
      ...baseItem,
      category: "headphones",
      label: "Sony WH-1000XM5 Wireless Headphones",
      brand: "Sony",
      modelReference: "Sony WH-1000XM5",
      features: [
        { name: "brand", value: "Sony", atSec: 4, source: "visible" },
        { name: "reference", value: "WH-1000XM5", atSec: 4, source: "spoken" },
      ],
    };
    const xm4Candidate = makeCand(2, {
      title: "Sony WH-1000XM4 Noise Canceling Headphones",
      options: [{ name: "Color", label: "Black" }],
    });
    expect(detectHardConflict(xm5Item, xm4Candidate)).toMatch(/WH-1000XM5/);
  });

  it("treats missing brand on an unbranded listing as unknown (possible, NOT exact_supported and NOT hard conflict)", () => {
    const brandedJacket: TracedItem = {
      ...baseItem,
      category: "jacket",
      label: "Patagonia Yellow Rain Shell",
      brand: "Patagonia",
      modelReference: null,
      features: [
        { name: "brand", value: "Patagonia", atSec: 8, source: "visible" },
        { name: "primary_color", value: "yellow", atSec: 8, source: "visible" },
      ],
    };

    const boutiqueUnbranded = makeCand(1, {
      title: "Packable Waterproof Rain Shell",
      sellerName: "Boutique Outerwear",
      sellerDomain: "boutique.myshopify.com",
      options: [{ name: "Color", label: "Yellow" }],
    });

    expect(detectHardConflict(brandedJacket, boutiqueUnbranded)).toBeNull();
    const { ranked } = applyScoresAndSortCandidates({
      item: brandedJacket,
      candidates: [boutiqueUnbranded],
      scoresByOfferId: new Map([
        [boutiqueUnbranded.offerId, { exactMatchYes: 0.92, confidence: 0.92 }],
      ]),
    });
    expect(ranked[0].matchLabel).toBe("possible");
  });

  it("refuses exact_supported when item has zero direct visible/spoken features even with high mocked score", () => {
    const inferredOnlyItem: TracedItem = {
      ...baseItem,
      brand: null,
      modelReference: "Samba OG",
      features: [
        {
          name: "silhouette",
          value: "low-top sneaker",
          atSec: 3,
          source: "inferred",
        },
      ],
    };

    const unbrandedCand = makeCand(1, {
      title: "Generic White Trainer",
      options: [{ name: "Size", label: "10" }],
    });

    const { ranked } = applyScoresAndSortCandidates({
      item: inferredOnlyItem,
      candidates: [unbrandedCand],
      scoresByOfferId: new Map([
        [unbrandedCand.offerId, { exactMatchYes: 0.95, confidence: 0.95 }],
      ]),
    });

    expect(ranked[0].matchLabel).not.toBe("exact_supported");
    expect(ranked[0].matchLabel).toBe("possible");
  });
});

describe("Two-layer server cache & in-flight deduplication", () => {
  it("serves cached entries instantly, deduplicates concurrent calls, and honors bypass=true", async () => {
    clearServerCacheForTests();
    const key = buildCacheKey("unit_cache", {
      videoId: "abc",
      nonce: Date.now(),
    });
    let invocations = 0;

    const compute = async () => {
      invocations++;
      await new Promise((r) => setTimeout(r, 15));
      return { count: invocations };
    };

    // Concurrent calls share the single in-flight promise
    const [r1, r2] = await Promise.all([
      withServerCache({ key, ttlMs: 60_000, compute }),
      withServerCache({ key, ttlMs: 60_000, compute }),
    ]);
    expect(invocations).toBe(1);
    expect(r1.value.count).toBe(1);
    expect(r2.value.count).toBe(1);

    // Subsequent call hits cache with zero compute executions
    const r3 = await withServerCache({ key, ttlMs: 60_000, compute });
    expect(r3.cacheHit).toBe(true);
    expect(invocations).toBe(1);

    // bypass=true forces fresh live execution and updates cached value
    const r4 = await withServerCache({
      key,
      ttlMs: 60_000,
      bypass: true,
      compute,
    });
    expect(r4.cacheHit).toBe(false);
    expect(r4.value.count).toBe(2);
    expect(invocations).toBe(2);
  });
});
