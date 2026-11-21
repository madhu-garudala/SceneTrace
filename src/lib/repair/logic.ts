import type {
  BankQuestion,
  RepairDecision,
  RepairFault,
  RepairOffer,
} from "@/lib/repair/types";

export const NO_ACTION_DAMAGE_THRESHOLD = 0.35;
export const REPAIR_PRICE_RATIO = 0.6;

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/** Healthy-polarity questions read inverted: P(true)=0.9 means 0.1 chance of a fault. */
export function faultProbability(
  polarity: "fault" | "healthy",
  p: number,
): number {
  const c = clamp01(p);
  return polarity === "healthy" ? 1 - c : c;
}

export function buildFaults(
  bank: BankQuestion[],
  scores: (number | null)[],
): RepairFault[] {
  const faults: RepairFault[] = [];
  bank.forEach((q, i) => {
    const p = scores[i];
    if (typeof p !== "number" || !Number.isFinite(p)) return;
    faults.push({
      question: q.text,
      faultProbability: faultProbability(q.polarity, p),
      polarity: q.polarity,
      weight: clamp01(q.weight),
    });
  });
  return faults;
}

/** Weight-averaged fault probability over the whole bank. */
export function damageLevel(faults: RepairFault[]): number {
  const totalWeight = faults.reduce((s, f) => s + f.weight, 0);
  if (totalWeight <= 0) return 0;
  return clamp01(
    faults.reduce((s, f) => s + f.faultProbability * f.weight, 0) /
      totalWeight,
  );
}

/** Strongest fault-polarity findings first (weight x probability). */
export function rankFaults(faults: RepairFault[]): RepairFault[] {
  return [...faults]
    .filter((f) => f.polarity === "fault")
    .sort(
      (a, b) =>
        b.faultProbability * b.weight - a.faultProbability * a.weight,
    );
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

export function decide(params: {
  damage: number;
  part: Pick<RepairOffer, "amountMinor"> | null;
  replacement: Pick<RepairOffer, "amountMinor"> | null;
}): RepairDecision {
  if (params.damage < NO_ACTION_DAMAGE_THRESHOLD) return "no_action";
  if (!params.part) return "abstain";
  // No trustworthy replacement (none found, or dropped as cheaper than the
  // part): a real part for a real fault is still a defensible repair call.
  if (!params.replacement) return "repair"; // dropped/missing replacement: nothing cheaper to compare against
  return params.part.amountMinor < REPAIR_PRICE_RATIO * params.replacement.amountMinor
    ? "repair"
    : "replace";
}

/** A "replacement" priced at or below the part is not a replacement. */
export function validReplacement<T extends { amountMinor: number }>(
  replacement: T | null,
  part: { amountMinor: number } | null,
): T | null {
  if (!replacement) return null;
  if (part && replacement.amountMinor <= part.amountMinor) return null;
  return replacement;
}

const STOP = new Set([
  "the", "and", "for", "with", "new", "replacement", "part", "kit", "set",
]);

function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2 && !STOP.has(t));
}

/** True when enough of the query's tokens appear in the listing title. */
export function isOnTopic(query: string, title: string): boolean {
  const q = Array.from(new Set(tokens(query)));
  if (q.length === 0) return false;
  const t = new Set(tokens(title));
  const hits = q.filter(
    (tok) => t.has(tok) || Array.from(t).some((x) => x.startsWith(tok) || (tok.startsWith(x) && x.length >= 4)),
  ).length;
  return hits / q.length >= 0.4;
}

export function formatMoney(amountMinor: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(
      amountMinor / 100,
    );
  } catch {
    return `${(amountMinor / 100).toFixed(2)} ${currency}`;
  }
}

export function templatedSummary(params: {
  decision: RepairDecision;
  itemLabel: string;
  part: RepairOffer | null;
  replacement: RepairOffer | null;
  topFault: string | null;
}): string {
  const { decision, itemLabel, part, replacement, topFault } = params;
  const p = part ? formatMoney(part.amountMinor, part.currency) : null;
  const r = replacement ? formatMoney(replacement.amountMinor, replacement.currency) : null;
  switch (decision) {
    case "no_action":
      return `Your ${itemLabel} looks fine; nothing needs fixing.`;
    case "abstain":
      return `Your ${itemLabel} shows signs of wear, but we could not source a matching part, so we will not guess at a price.`;
    case "repair":
      return `A ${p} part is likely cheaper than replacing your ${itemLabel}${r ? ` at ${r}` : ""}${topFault ? `; the main issue looks like: ${topFault.toLowerCase()}` : ""}.`;
    default:
      return `The ${p} part is not much cheaper than a new one${r ? ` at ${r}` : ""}, so replacing your ${itemLabel} makes more sense.`;
  }
}

export const FIT_THRESHOLD = 0.5;

/**
 * Keep listings the Decisions rerank judged a genuine fit (p >= 0.5). When the
 * rerank failed (scores === null), fall back to the word-overlap filter.
 */
export function filterByFit<T extends { title: string }>(
  offers: T[],
  scores: (number | null)[] | null,
  query: string,
): T[] {
  if (scores === null) return offers.filter((o) => isOnTopic(query, o.title));
  return offers.filter((_, i) => (scores[i] ?? 0) >= FIT_THRESHOLD);
}
