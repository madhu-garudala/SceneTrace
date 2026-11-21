import { describe, expect, it } from "vitest";
import {
  buildFaults,
  damageLevel,
  decide,
  faultProbability,
  applyPartPriceFloor,
  filterByFit,
  poolOffers,
  isOnTopic,
  median,
  validReplacement,
} from "@/lib/repair/logic";
import { RepairRequestSchema } from "@/lib/repair/request";
import type { BankQuestion } from "@/lib/repair/types";

const bank: BankQuestion[] = [
  { text: "Hinge is cracked", weight: 0.9, polarity: "fault" },
  { text: "Cushion is torn", weight: 0.7, polarity: "fault" },
  { text: "Both hinges are intact", weight: 0.8, polarity: "healthy" },
  { text: "Headband is straight", weight: 0.6, polarity: "healthy" },
];

describe("polarity", () => {
  it("inverts healthy-polarity answers", () => {
    expect(faultProbability("healthy", 0.9)).toBeCloseTo(0.1);
    expect(faultProbability("fault", 0.9)).toBeCloseTo(0.9);
  });
  it("skips unscored questions", () => {
    expect(buildFaults(bank, [0.5, null, 0.5, 0.5])).toHaveLength(3);
  });
});

describe("damage level", () => {
  it("is low for a healthy-looking score set", () => {
    const f = buildFaults(bank, [0.05, 0.1, 0.95, 0.9]);
    expect(damageLevel(f)).toBeLessThan(0.35);
  });
  it("is high for a damaged-looking score set", () => {
    const f = buildFaults(bank, [0.9, 0.85, 0.1, 0.2]);
    expect(damageLevel(f)).toBeGreaterThan(0.7);
  });
  it("is 0 for an empty bank", () => {
    expect(damageLevel([])).toBe(0);
  });
});

describe("decision rules", () => {
  const part = { amountMinor: 1700 };
  const repl = { amountMinor: 14500 };
  it("no_action below 0.35 regardless of parts", () => {
    expect(decide({ damage: 0.34, part, replacement: repl })).toBe("no_action");
  });
  it("abstains when no part is found", () => {
    expect(decide({ damage: 0.6, part: null, replacement: repl })).toBe("abstain");
  });
  it("repairs when part < 60% of replacement", () => {
    expect(decide({ damage: 0.6, part: { amountMinor: 5999 }, replacement: { amountMinor: 10000 } })).toBe("repair");
  });
  it("replaces at exactly 60% or above", () => {
    expect(decide({ damage: 0.6, part: { amountMinor: 6000 }, replacement: { amountMinor: 10000 } })).toBe("replace");
  });
  it("drops a replacement priced at or below the part", () => {
    expect(validReplacement({ amountMinor: 1000 }, { amountMinor: 1000 })).toBeNull();
    expect(validReplacement({ amountMinor: 900 }, { amountMinor: 1000 })).toBeNull();
    expect(validReplacement({ amountMinor: 1100 }, { amountMinor: 1000 })).not.toBeNull();
  });
  it("still repairs when a part exists but no trustworthy replacement does", () => {
    expect(decide({ damage: 0.6, part, replacement: null })).toBe("repair");
  });
  it("uses the median, so a cheap accessory does not set the price", () => {
    expect(median([1000, 11000, 12000])).toBe(11000);
    expect(median([])).toBeNull();
  });
  it("filters off-topic listings", () => {
    expect(isOnTopic("Sony WH-1000XM4 headphones", "Sony WH-1000XM4 Wireless Headphones")).toBe(true);
    expect(isOnTopic("Sony WH-1000XM4 headphones", "Leather camera strap")).toBe(false);
  });
});

describe("fit filter", () => {
  const offers = [
    { title: "Sony WH-1000XM4 hinge swivel replacement" },
    { title: "Leather camera strap" },
    { title: "Sony headphone ear pad" },
  ];
  it("keeps listings scored >= 0.5 and drops unscored ones", () => {
    expect(filterByFit(offers, [0.9, 0.2, null], "x")).toEqual([offers[0]]);
  });
  it("falls back to the on-topic word filter when the rerank failed", () => {
    const out = filterByFit(offers, null, "Sony hinge swivel replacement");
    expect(out).toContain(offers[0]);
    expect(out).not.toContain(offers[1]);
  });
});

describe("part pooling and price floor", () => {
  it("drops parts under 1.00", () => {
    expect(applyPartPriceFloor([{ amountMinor: 2 }, { amountMinor: 99 }, { amountMinor: 100 }])).toEqual([{ amountMinor: 100 }]);
  });
  it("pools searches and de-duplicates by product and variant", () => {
    const a = { productId: "p1", variantId: "v1", t: "a" };
    const b = { productId: "p1", variantId: "v2", t: "b" };
    const c = { productId: "p2", variantId: "v1", t: "c" };
    expect(poolOffers([[a, b], [{ ...a, t: "dup" }, c], []])).toEqual([a, b, c]);
  });
});

describe("request validation", () => {
  const item = { itemId: "a", category: "headphones", label: "Sony headphones" };
  const ok = { imageBase64: "A".repeat(200), mimeType: "image/jpeg", item };
  it("accepts a minimal valid request", () => {
    expect(RepairRequestSchema.safeParse(ok).success).toBe(true);
  });
  it("rejects a bad mime type, missing item, tiny or oversized image", () => {
    expect(RepairRequestSchema.safeParse({ ...ok, mimeType: "image/gif" }).success).toBe(false);
    expect(RepairRequestSchema.safeParse({ ...ok, item: undefined }).success).toBe(false);
    expect(RepairRequestSchema.safeParse({ ...ok, imageBase64: "x" }).success).toBe(false);
    expect(RepairRequestSchema.safeParse({ ...ok, imageBase64: "A".repeat(8_000_001) }).success).toBe(false);
  });
});
