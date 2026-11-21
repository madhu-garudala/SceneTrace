import type { VoiceIntent, VoiceSlots } from "@/lib/voice/types";

/**
 * What the studio can do when spoken to. The studio supplies these; voice
 * only decides which one to call. Keeping the mapping here means the studio
 * component gains one object, not a switch statement tangled into its state.
 */
export type VoiceActions = {
  switchSource: (source: "camera" | "youtube") => void;
  capture: () => void | Promise<void>;
  /** Run a trace. With no question, re-run on whatever is in view. */
  trace: (question?: string) => void | Promise<void>;
  /** Narrow the search — budget, colour, size. */
  refine: (refinement: { maxPrice?: number; color?: string; size?: string }) => void | Promise<void>;
  /** May return what to say back (e.g. "This one? ..."). */
  selectOffer: (selection: { index?: number; description?: string }) => string | void;
  /** Buy. Buying is the default path; it never waits on a diagnosis. */
  checkout: () => string | void | Promise<string | void>;
  /** The repair check — only ever run when asked for. */
  diagnose: (note?: string) => void | Promise<void>;
  nextItem: () => void;
  showEvidence: () => void;
  stop: () => void;
};

/**
 * Turn "under 100 dollars", "in black", "size 10" into words appended to the
 * shopper's question. The trace already extracts budget, colour and size
 * from the question, so refining is re-asking with more detail rather than a
 * second, parallel filter that could disagree with it.
 */
export function refinementPhrase(r: { maxPrice?: number; color?: string; size?: string }): string {
  const parts: string[] = [];
  if (r.color) parts.push(`in ${r.color}`);
  if (r.size) parts.push(`size ${r.size}`);
  if (typeof r.maxPrice === "number" && r.maxPrice > 0) parts.push(`under $${r.maxPrice}`);
  return parts.join(", ");
}

export async function dispatchVoiceIntent(
  intent: VoiceIntent,
  slots: VoiceSlots,
  actions: VoiceActions,
): Promise<string | void> {
  switch (intent) {
    case "switch_to_camera":
      return actions.switchSource("camera");
    case "switch_to_youtube":
      return actions.switchSource("youtube");
    case "capture":
      return actions.capture();
    case "trace":
      return actions.trace(slots.question);
    case "refine":
      return actions.refine({ maxPrice: slots.maxPrice, color: slots.color, size: slots.size });
    case "select_offer":
      return actions.selectOffer({ index: slots.index, description: slots.description });
    case "checkout":
      return actions.checkout();
    case "diagnose":
      return actions.diagnose(slots.question ?? slots.description);
    case "next_item":
      return actions.nextItem();
    case "show_evidence":
      return actions.showEvidence();
    case "stop":
      return actions.stop();
    case "unknown":
    default:
      // Noise and side conversation land here. Doing nothing is the answer.
      return;
  }
}
