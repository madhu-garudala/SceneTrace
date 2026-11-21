import { describe, expect, it } from "vitest";
import { createEchoGuard, ECHO_WINDOW_MS } from "@/lib/voice/echo";

describe("echo guard", () => {
  it("catches a homophone echo of a reply", () => {
    const g = createEchoGuard();
    g.remember("Removed that from your cart", 0);
    expect(g.isEcho("remove that from your card", 1000)).toBe(true);
  });

  it("catches a fragment of a longer reply", () => {
    const g = createEchoGuard();
    g.remember("Got it — dropping the repair part and searching again", 0);
    expect(g.isEcho("got it dropping the repair", 1500)).toBe(true);
  });

  it("does not flag genuine commands", () => {
    const g = createEchoGuard();
    g.remember("Removed that from your cart", 0);
    g.remember("Got it — dropping the repair part", 0);
    for (const c of ["add it to my cart", "which watch is this", "take the picture"]) {
      expect(g.isEcho(c, 2000)).toBe(false);
    }
  });

  it("forgets entries after the window", () => {
    const g = createEchoGuard();
    g.remember("Removed that from your cart", 0);
    expect(g.isEcho("remove that from your card", ECHO_WINDOW_MS + 1)).toBe(false);
  });
});

describe("echo guard joins split words", () => {
  it("treats 'opening check out' as an echo of 'Opening checkout.'", async () => {
    const { createEchoGuard } = await import("@/lib/voice/echo");
    const g = createEchoGuard();
    g.remember("Opening checkout.", 1000);
    expect(g.isEcho("opening check out", 2000)).toBe(true);
    expect(g.isEcho("add the charger to my cart", 2000)).toBe(false);
  });
});
