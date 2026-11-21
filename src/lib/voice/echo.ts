/**
 * Echo guard. On laptop speakers the mic hears the app and can mistake its own
 * reply for a command. Recognition is deliberately NOT muted while the app
 * speaks (that made it impossible to interrupt), so echo is caught by content:
 * if most of what was heard appears in something the app said recently, drop it.
 */

export const ECHO_WINDOW_MS = 12_000;
export const ECHO_THRESHOLD = 0.7;

const STOPWORDS = new Set([
  "a", "an", "the", "that", "this", "these", "those", "it", "its", "is", "are",
  "was", "were", "be", "to", "of", "in", "on", "at", "for", "from", "with",
  "and", "or", "but", "so", "my", "your", "you", "me", "i", "we", "our", "us",
  "do", "does", "did", "just", "now", "then", "there", "here", "up", "out",
  "ok", "okay", "um", "uh", "will", "can", "have", "has", "had",
]);

const HOMOPHONES: Record<string, string> = { card: "cart", car: "cart", cards: "cart", cars: "cart" };

function stem(w: string): string {
  let s = w;
  if (s.length > 4 && s.endsWith("ing")) s = s.slice(0, -3);
  else if (s.length > 3 && s.endsWith("ed")) s = s.slice(0, -2);
  else if (s.length > 3 && s.endsWith("s") && !s.endsWith("ss")) s = s.slice(0, -1);
  if (s.length > 3 && s.endsWith("e")) s = s.slice(0, -1);
  if (s.length > 3 && s[s.length - 1] === s[s.length - 2]) s = s.slice(0, -1);
  return s;
}

export function tokenize(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/)) {
    if (!raw || STOPWORDS.has(raw)) continue;
    out.push(stem(HOMOPHONES[raw] ?? raw));
  }
  return out;
}

export type EchoGuard = {
  remember(text: string, now?: number): void;
  isEcho(heard: string, now?: number): boolean;
  clear(): void;
};

export function createEchoGuard(windowMs: number = ECHO_WINDOW_MS): EchoGuard {
  let entries: { at: number; tokens: Set<string> }[] = [];
  const prune = (now: number) => {
    entries = entries.filter((e) => now - e.at <= windowMs);
  };
  return {
    remember(text, now = Date.now()) {
      prune(now);
      const tokens = new Set(tokenize(text));
      if (tokens.size) entries.push({ at: now, tokens });
    },
    isEcho(heard, now = Date.now()) {
      prune(now);
      const heardTokens = tokenize(heard);
      if (!heardTokens.length) return false;
      return entries.some((e) => {
        const hits = heardTokens.filter((t) => e.tokens.has(t)).length;
        return hits / heardTokens.length >= ECHO_THRESHOLD;
      });
    },
    clear() {
      entries = [];
    },
  };
}
