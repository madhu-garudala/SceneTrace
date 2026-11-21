import type { VoiceContext, VoiceIntent, VoiceSlots } from "./types";

/** Short spoken replies. Unknown is deliberately silent. */
export function replyFor(
  intent: VoiceIntent,
  slots: VoiceSlots,
  ctx: VoiceContext,
): string {
  switch (intent) {
    case "switch_to_camera":
      return "Camera on.";
    case "switch_to_youtube":
      return "Paste a link.";
    case "capture":
      return "Got it.";
    case "trace":
      return ctx.busy ? "Still working." : "On it.";
    case "refine":
      return "Updating.";
    case "select_offer":
      return slots.index ? `Number ${slots.index}.` : "That one.";
    case "checkout":
      return "Opening checkout.";
    case "next_item":
      return "Next one.";
    case "diagnose":
      return "Checking it.";
    case "show_evidence":
      return "Here's why.";
    case "stop":
      return "Okay.";
    default:
      return "";
  }
}

const SKU_RE = /\b[A-Z0-9]+(?:[-–][A-Z0-9]+){2,}\b/g;

/** Make text short enough to say aloud: no SKUs, no parentheticals, <=24 words. */
export function shortenForSpeech(text: string, maxWords = 24): string {
  const cleaned = text
    .replace(/\([^)]*\)/g, " ")
    .replace(SKU_RE, " ")
    .replace(/\s+/g, " ")
    .trim();
  const words = cleaned.split(" ").filter(Boolean);
  if (words.length <= maxWords) return cleaned;
  return words.slice(0, maxWords).join(" ").replace(/[,;:]$/, "") + ".";
}
