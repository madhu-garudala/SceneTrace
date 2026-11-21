/**
 * Speech-to-text routinely hears "cart" as "card" or "car". Fix the common
 * cases before routing, but leave real card phrases ("card holder") alone.
 */
export function normalizeUtterance(heard: string): {
  heard: string;
  normalized: string | null;
} {
  const text = heard.trim();
  const rewritten = text
    .replace(
      /(my|your|the|to|from|in) card(?!\s*(holder|wallet|case|reader|slot))/gi,
      "$1 cart",
    )
    .replace(/(my|your|the|to|from|in) car(?=\s*$|[.,!?])/gi, "$1 cart");
  return { heard, normalized: rewritten !== text ? rewritten : null };
}
