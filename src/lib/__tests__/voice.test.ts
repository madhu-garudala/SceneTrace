import { describe, expect, it } from "vitest";
import { applyGates, passesMarginGate, passesNoiseGate } from "@/lib/voice/gate";
import { normalizeUtterance } from "@/lib/voice/normalize";
import { replyFor, shortenForSpeech } from "@/lib/voice/replies";

const ctx = { source: "youtube", hasCapture: false, hasItems: true, hasOffers: true, busy: false } as const;

describe("normalizeUtterance", () => {
  it("rewrites card to cart", () => {
    expect(normalizeUtterance("added to my card").normalized).toBe("added to my cart");
  });
  it("rewrites trailing car to cart", () => {
    expect(normalizeUtterance("put it in the car.").normalized).toBe("put it in the cart.");
  });
  it("keeps card holder", () => {
    expect(normalizeUtterance("look at this card holder").normalized).toBeNull();
    expect(normalizeUtterance("my card wallet").normalized).toBeNull();
  });
  it("returns the original as heard", () => {
    expect(normalizeUtterance("to my card").heard).toBe("to my card");
  });
});

describe("margin gate", () => {
  it("accepts clear winners", () => {
    expect(passesMarginGate(0.43 + 0.03, 0.2)).toBe(true);
    expect(passesMarginGate(0.32, 0.16)).toBe(true);
  });
  it("rejects coin flips", () => {
    expect(passesMarginGate(0.33, 0.03)).toBe(false);
    expect(passesMarginGate(0.5, 0.02)).toBe(false);
  });
  it("downgrades state-changing intents only", () => {
    expect(applyGates({ text: "buy it now", intent: "checkout", confidence: 0.5, runnerUp: 0.48 })).toBe("unknown");
    expect(applyGates({ text: "check out", intent: "checkout", confidence: 0.7, runnerUp: 0.2 })).toBe("checkout");
    expect(applyGates({ text: "something broken", intent: "diagnose", confidence: 0.5, runnerUp: 0.48 })).toBe("diagnose");
  });
});

describe("noise gate", () => {
  it("passes why at high confidence", () => {
    expect(passesNoiseGate("why", 0.97)).toBe(true);
  });
  it("blocks filler and fragments", () => {
    expect(passesNoiseGate("then", 0.6)).toBe(false);
    expect(passesNoiseGate("can you", 0.7)).toBe(false);
    expect(passesNoiseGate("laundrom", 0.5)).toBe(false);
  });
  it("blocks low confidence", () => {
    expect(passesNoiseGate("which watch is this", 0.39)).toBe(false);
  });
});

describe("replies", () => {
  it("is silent for unknown", () => {
    expect(replyFor("unknown", {}, ctx)).toBe("");
  });
  it("shortens SKUs, parentheticals and length", () => {
    const out = shortenForSpeech("Casio F-91W-1 (black resin) " + "word ".repeat(40));
    expect(out).not.toMatch(/F-91W-1/);
    expect(out).not.toMatch(/\(/);
    expect(out.split(" ").length).toBeLessThanOrEqual(24);
  });
});
