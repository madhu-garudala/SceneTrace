/**
 * The contract between the voice server routes and the voice client.
 *
 * Kept in one file so both sides compile against the same shapes: the server
 * routes an utterance to an intent and speaks a reply; the client captures
 * speech, plays the reply, and hands the intent to the studio to act on.
 */

export type VoiceIntent =
  | "switch_to_camera" // "use the camera", "look at my camera"
  | "switch_to_youtube" // "use a YouTube link", "go back to the video"
  | "capture" // "take the picture", "snap it", "capture this"
  | "trace" // "which watch is this", "find this", "what are these headphones" — slot: question
  | "refine" // "under 100 dollars", "in black", "size 10" — slots: maxPrice/color/size
  | "select_offer" // "the second one", "the cheaper one" — slots: index/description
  | "diagnose" // "this is broken", "something's wrong with it", "is it worth fixing" — repair path
  | "checkout" // "buy it", "check out", "I'll take it", "I want to buy a new one"
  | "next_item" // "next one", "scan something else", "start over"
  | "show_evidence" // "why", "how do you know", "show me the proof"
  | "stop" // "stop", "be quiet", "never mind"
  | "unknown"; // noise, fragments, side conversation — never acted on

export const VOICE_INTENTS: readonly VoiceIntent[] = [
  "switch_to_camera",
  "switch_to_youtube",
  "capture",
  "trace",
  "refine",
  "select_offer",
  "diagnose",
  "checkout",
  "next_item",
  "show_evidence",
  "stop",
  "unknown",
] as const;

export type VoiceSlots = {
  /** The whole utterance as heard, for actions that read intent from wording. */
  heard?: string;
  question?: string;
  maxPrice?: number;
  color?: string;
  size?: string;
  index?: number; // 1-based
  description?: string;
};

/** What the studio is doing right now — routing uses it to break ties. */
export type VoiceContext = {
  source: "youtube" | "camera";
  hasCapture: boolean;
  hasItems: boolean;
  hasOffers: boolean;
  busy: boolean;
  /** The app has asked "Add this one?" and is waiting for yes / no. */
  awaitingConfirm?: boolean;
};

/** POST /api/voice/intent  body: { utterance, context } */
export type VoiceIntentRequest = {
  utterance: string;
  context: VoiceContext;
};

export type VoiceIntentResponse = {
  intent: VoiceIntent;
  confidence: number;
  probabilities: Record<string, number>;
  slots: VoiceSlots;
  /** Short spoken reply. Empty string means stay silent. */
  reply: string;
  /** What speech-to-text produced, before normalisation. */
  heard: string;
  /** The normalised text actually routed, or null if unchanged. */
  normalized: string | null;
};

/**
 * POST /api/voice/speak  body: { text }
 * 200 audio/wav, or 204 when no audio is available — the client then falls
 * back to the browser's own speech rather than staying silent.
 */
export type VoiceSpeakRequest = { text: string };
