import type { VoiceIntent } from "./types";

const FILLER = new Set(
  "a an the can could you i me my it this that then so ok okay yeah yes um uh and or please now just is are to of for on in at be do".split(
    " ",
  ),
);

export function contentWordCount(text: string): number {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9'\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !FILLER.has(w)).length;
}

/** Accept a state-changing intent only on a clear winner, not a near tie. */
export function passesMarginGate(confidence: number, margin: number): boolean {
  return (
    (confidence >= 0.45 && margin >= 0.05) ||
    (confidence >= 0.3 && margin >= 0.15)
  );
}

export function passesNoiseGate(text: string, confidence: number): boolean {
  if (confidence < 0.4) return false;
  if (contentWordCount(text) < 2 && confidence < 0.8) return false;
  return true;
}

const STATE_CHANGING: ReadonlySet<VoiceIntent> = new Set([
  "checkout",
  "next_item",
]);

export function applyGates(params: {
  text: string;
  intent: VoiceIntent;
  confidence: number;
  runnerUp: number;
}): VoiceIntent {
  const { text, intent, confidence, runnerUp } = params;
  if (intent === "unknown") return "unknown";
  if (!passesNoiseGate(text, confidence)) return "unknown";
  if (
    STATE_CHANGING.has(intent) &&
    !passesMarginGate(confidence, confidence - runnerUp)
  ) {
    return "unknown";
  }
  return intent;
}
