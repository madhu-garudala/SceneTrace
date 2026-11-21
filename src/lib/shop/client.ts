import crypto from "node:crypto";
import type { CandidateForScoring } from "@/lib/matching/decisions";
import type {
  AvailableOptionGroup,
  CheckoutLink,
  CheckoutTotalLine,
  EvidenceFrame,
  OfferOption,
  TracedItem,
} from "@/lib/types";

const SHOP_MCP_ENDPOINT = "https://mcp.shop.com/";
const MCP_PROTOCOL_VERSION = "2026-07-28";

export class ShopMcpError extends Error {
  public readonly category: "http" | "jsonrpc" | "tool" | "parse";
  public readonly statusCode?: number;

  constructor(
    message: string,
    category: "http" | "jsonrpc" | "tool" | "parse",
    statusCode?: number,
  ) {
    super(message);
    this.name = "ShopMcpError";
    this.category = category;
    this.statusCode = statusCode;
  }
}

export function parseMaybeSseOrJson(raw: string): Record<string, unknown> {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{")) {
    return JSON.parse(trimmed) as Record<string, unknown>;
  }

  const dataLines = trimmed
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .filter((payload) => payload.startsWith("{"));

  for (let i = dataLines.length - 1; i >= 0; i--) {
    try {
      const parsed = JSON.parse(dataLines[i]) as Record<string, unknown>;
      if ("result" in parsed || "error" in parsed) {
        return parsed;
      }
    } catch {
      // continue scanning SSE frames
    }
  }

  throw new ShopMcpError(
    "Unable to parse Shop MCP response envelope.",
    "parse",
  );
}

function buildCombinedSignal(
  timeoutMs: number,
  parentSignal?: AbortSignal,
): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  if (!parentSignal) return timeoutSignal;
  return AbortSignal.any([parentSignal, timeoutSignal]);
}

export async function callShopMcpTool<T = Record<string, unknown>>(
  toolName: string,
  args: Record<string, unknown>,
  options?: { timeoutMs?: number; signal?: AbortSignal },
): Promise<{
  structuredContent: T;
  isError: boolean;
}> {
  const rpcBody = {
    jsonrpc: "2.0",
    id: crypto.randomUUID(),
    method: "tools/call",
    params: {
      _meta: {
        "io.modelcontextprotocol/protocolVersion": MCP_PROTOCOL_VERSION,
        "io.modelcontextprotocol/clientCapabilities": {},
      },
      name: toolName,
      arguments: args,
    },
  };

  const response = await fetch(SHOP_MCP_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": MCP_PROTOCOL_VERSION,
      "Mcp-Method": "tools/call",
      "Mcp-Name": toolName,
      "User-Agent": "SceneTrace/0.1.0",
    },
    body: JSON.stringify(rpcBody),
    signal: buildCombinedSignal(options?.timeoutMs ?? 20_000, options?.signal),
  });

  const rawText = await response.text();
  if (!response.ok) {
    let detail = rawText.slice(0, 300);
    try {
      const parsedErr = JSON.parse(rawText) as {
        error?: { message?: string };
      };
      if (parsedErr.error?.message) detail = parsedErr.error.message;
    } catch {
      // keep raw detail
    }
    throw new ShopMcpError(
      `Shop MCP ${toolName} HTTP ${response.status}: ${detail}`,
      "http",
      response.status,
    );
  }

  const envelope = parseMaybeSseOrJson(rawText);
  if (envelope.error) {
    const rpcErr = envelope.error as { code?: number; message?: string };
    throw new ShopMcpError(
      `Shop MCP ${toolName} RPC error (${rpcErr.code ?? "unknown"}): ${rpcErr.message ?? "Unknown RPC failure"}`,
      "jsonrpc",
    );
  }

  const result = (envelope.result ?? {}) as {
    isError?: boolean;
    structuredContent?: T;
    content?: Array<{ type?: string; text?: string }>;
  };

  let structured = result.structuredContent;
  if (!structured && Array.isArray(result.content)) {
    const textPart = result.content.find(
      (c) => c.type === "text" && typeof c.text === "string",
    );
    if (textPart?.text) {
      try {
        structured = JSON.parse(textPart.text) as T;
      } catch {
        // non-JSON tool message
      }
    }
  }

  if (result.isError) {
    const fallbackText =
      Array.isArray(result.content) && result.content[0]?.text
        ? result.content[0].text.slice(0, 300)
        : `Tool ${toolName} returned isError=true`;
    throw new ShopMcpError(fallbackText, "tool");
  }

  if (!structured || typeof structured !== "object") {
    throw new ShopMcpError(
      `Shop MCP ${toolName} returned empty structuredContent.`,
      "parse",
    );
  }

  return {
    structuredContent: structured,
    isError: Boolean(result.isError),
  };
}

function extractImageUrl(
  variant: Record<string, unknown>,
  product: Record<string, unknown>,
): string | null {
  const tryMediaList = (mediaVal: unknown): string | null => {
    if (!Array.isArray(mediaVal)) return null;
    for (const entry of mediaVal) {
      const m = entry as Record<string, unknown>;
      if (typeof m.url === "string" && m.url.startsWith("https://")) {
        return m.url;
      }
      const preview = m.preview as Record<string, unknown> | undefined;
      if (
        preview &&
        typeof preview.url === "string" &&
        preview.url.startsWith("https://")
      ) {
        return preview.url;
      }
    }
    return null;
  };

  const vImg = variant.image as Record<string, unknown> | undefined;
  if (vImg && typeof vImg.url === "string" && vImg.url.startsWith("https://")) {
    return vImg.url;
  }

  return tryMediaList(variant.media) ?? tryMediaList(product.media) ?? null;
}

function extractOptions(variant: Record<string, unknown>): OfferOption[] {
  const rawList =
    (Array.isArray(variant.options) ? variant.options : null) ??
    (Array.isArray(variant.selected_options)
      ? variant.selected_options
      : null) ??
    [];

  const normalized: OfferOption[] = [];
  for (const raw of rawList) {
    const o = raw as Record<string, unknown>;
    const name = typeof o.name === "string" ? o.name.trim() : "";
    const label =
      typeof o.label === "string"
        ? o.label.trim()
        : typeof o.value === "string"
          ? o.value.trim()
          : "";
    if (
      name &&
      label &&
      !(
        name.toLowerCase() === "title" &&
        label.toLowerCase() === "default title"
      )
    ) {
      normalized.push({ name, label });
    }
  }
  return normalized;
}

function extractAvailableOptionGroups(
  product: Record<string, unknown>,
): AvailableOptionGroup[] {
  const groups = new Map<string, Set<string>>();

  if (Array.isArray(product.options)) {
    for (const rawOpt of product.options) {
      const o = rawOpt as Record<string, unknown>;
      const name = typeof o.name === "string" ? o.name.trim() : "";
      if (!name || name.toLowerCase() === "title") continue;
      const vals = Array.isArray(o.values) ? o.values : [];
      for (const v of vals) {
        const label =
          typeof v === "string"
            ? v.trim()
            : v && typeof v === "object"
              ? String(
                  (v as Record<string, unknown>).label ??
                    (v as Record<string, unknown>).name ??
                    "",
                ).trim()
              : "";
        if (label && label.toLowerCase() !== "default title") {
          if (!groups.has(name)) groups.set(name, new Set());
          groups.get(name)!.add(label);
        }
      }
    }
  }

  if (Array.isArray(product.variants)) {
    for (const rv of product.variants) {
      for (const opt of extractOptions(rv as Record<string, unknown>)) {
        if (!groups.has(opt.name)) groups.set(opt.name, new Set());
        groups.get(opt.name)!.add(opt.label);
      }
    }
  }

  return Array.from(groups.entries())
    .map(([name, set]) => ({ name, values: Array.from(set) }))
    .filter((g) => g.values.length > 1);
}

function extractMessagesAndLinks(rawMessages: unknown): {
  messages: string[];
  links: CheckoutLink[];
} {
  if (!Array.isArray(rawMessages)) return { messages: [], links: [] };
  const messages: string[] = [];
  const links: CheckoutLink[] = [];

  for (const m of rawMessages) {
    if (typeof m === "string" && m.trim()) {
      messages.push(m.trim());
    } else if (m && typeof m === "object") {
      const obj = m as Record<string, unknown>;
      const severity =
        typeof obj.severity === "string"
          ? obj.severity
          : typeof obj.type === "string"
            ? obj.type
            : "";
      const code = typeof obj.code === "string" ? obj.code : "";
      const text =
        (typeof obj.content === "string" && obj.content) ||
        (typeof obj.message === "string" && obj.message) ||
        (typeof obj.text === "string" && obj.text) ||
        "";
      if (text.trim()) {
        const prefix =
          severity && severity !== "info"
            ? `[${severity}${code ? `:${code}` : ""}] `
            : "";
        messages.push(`${prefix}${text.trim()}`);
      }
      if (typeof obj.url === "string" && obj.url.startsWith("https://")) {
        links.push({
          label:
            (typeof obj.title === "string" && obj.title) ||
            code ||
            "Merchant notice",
          url: obj.url,
        });
      }
    }
  }
  return { messages, links };
}

function extractDocumentLinks(rawLinks: unknown): CheckoutLink[] {
  if (!Array.isArray(rawLinks)) return [];
  const out: CheckoutLink[] = [];
  for (const raw of rawLinks) {
    if (!raw || typeof raw !== "object") continue;
    const l = raw as Record<string, unknown>;
    const url =
      (typeof l.url === "string" && l.url) ||
      (typeof l.href === "string" && l.href) ||
      "";
    if (!url.startsWith("https://")) continue;
    const rawLabel =
      (typeof l.title === "string" && l.title) ||
      (typeof l.label === "string" && l.label) ||
      (typeof l.type === "string" && l.type.replace(/_/g, " ")) ||
      (typeof l.rel === "string" && l.rel.replace(/_/g, " ")) ||
      "Merchant policy";
    out.push({ label: rawLabel.trim(), url });
  }
  return out;
}

function extractDescriptionSnippet(product: Record<string, unknown>): string {
  const metadata = product.metadata as
    | { unique_selling_points?: string[]; top_features?: string[] }
    | undefined;
  const bullets = [
    ...(metadata?.unique_selling_points ?? []),
    ...(metadata?.top_features ?? []).slice(0, 3),
  ].filter((s) => typeof s === "string" && s.trim());

  if (bullets.length > 0) {
    return bullets.join(" • ").slice(0, 320);
  }

  const desc = product.description as { plain?: string } | string | undefined;
  const rawPlain =
    typeof desc === "string"
      ? desc
      : typeof desc?.plain === "string"
        ? desc.plain
        : "";
  return rawPlain
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 280);
}

type ParsedVariantRecord = Omit<
  CandidateForScoring,
  "offerId" | "originalSearchRank"
>;

function parseProductVariants(
  product: Record<string, unknown>,
  topWarnings: string[],
): ParsedVariantRecord[] {
  const productId = typeof product.id === "string" ? product.id : "";
  const productTitle = typeof product.title === "string" ? product.title : "";
  const descriptionSnippet = extractDescriptionSnippet(product);
  const availableOptions = extractAvailableOptionGroups(product);
  const variants = Array.isArray(product.variants) ? product.variants : [];
  const results: ParsedVariantRecord[] = [];

  for (const rawVar of variants) {
    const v = rawVar as Record<string, unknown>;
    const variantId = typeof v.id === "string" ? v.id : "";
    const seller = (v.seller ?? product.seller ?? {}) as Record<
      string,
      unknown
    >;
    const sellerDomain =
      typeof seller.domain === "string" ? seller.domain.trim() : "";
    const sellerName =
      typeof seller.name === "string" && seller.name.trim()
        ? seller.name.trim()
        : sellerDomain;

    const source = typeof v.source === "string" ? v.source.toLowerCase() : "";
    if (source && source !== "shopify") {
      continue;
    }
    if (!productId || !variantId || !sellerDomain) {
      continue;
    }

    const productUrl =
      typeof v.url === "string" && v.url.startsWith("https://")
        ? v.url
        : typeof product.url === "string" && product.url.startsWith("https://")
          ? product.url
          : `https://${sellerDomain}`;

    const priceObj = (v.price ?? {}) as Record<string, unknown>;
    const amountMinor =
      typeof priceObj.amount === "number" && Number.isFinite(priceObj.amount)
        ? Math.round(priceObj.amount)
        : null;
    const currency =
      typeof priceObj.currency === "string"
        ? priceObj.currency.toUpperCase()
        : null;

    const availObj = v.availability as Record<string, unknown> | undefined;
    const availability: "available" | "unavailable" | "unknown" =
      typeof availObj?.available === "boolean"
        ? availObj.available
          ? "available"
          : "unavailable"
        : "unknown";

    const condRaw = v.condition;
    const condition =
      Array.isArray(condRaw) && typeof condRaw[0] === "string"
        ? condRaw[0]
        : typeof condRaw === "string"
          ? condRaw
          : null;

    const vTitle = typeof v.title === "string" ? v.title.trim() : "";
    const combinedTitle =
      vTitle &&
      vTitle.toLowerCase() !== "default title" &&
      !productTitle.toLowerCase().includes(vTitle.toLowerCase())
        ? `${productTitle} — ${vTitle}`
        : productTitle || vTitle;

    const vMsgs = extractMessagesAndLinks(v.messages).messages;

    results.push({
      productId,
      variantId,
      sellerDomain,
      sellerName,
      title: combinedTitle,
      descriptionSnippet,
      options: extractOptions(v),
      availableOptions,
      amountMinor,
      currency,
      availability,
      condition,
      productUrl,
      imageUrl: extractImageUrl(v, product),
      warnings: [...topWarnings, ...vMsgs],
    });
  }

  return results;
}

function buildDedupeGroupKey(v: ParsedVariantRecord): string {
  const colorOpt = v.options.find((o) =>
    /^(color|colour|colorway|shade|finish)$/i.test(o.name.trim()),
  );
  const colorKey = colorOpt ? colorOpt.label.trim().toLowerCase() : "default";
  return `${v.sellerDomain.toLowerCase()}::${v.productId}::${colorKey}`;
}

function extractGroupedSearchHits(
  sc: Record<string, unknown>,
): Map<string, ParsedVariantRecord> {
  const grouped = new Map<string, ParsedVariantRecord>();
  const topWarnings = extractMessagesAndLinks(sc.messages).messages;
  const products = Array.isArray(sc.products) ? sc.products : [];
  for (const p of products) {
    const parsedVariants = parseProductVariants(
      p as Record<string, unknown>,
      topWarnings,
    );
    for (const pv of parsedVariants) {
      const groupKey = buildDedupeGroupKey(pv);
      const existing = grouped.get(groupKey);
      if (
        !existing ||
        (existing.availability !== "available" &&
          pv.availability === "available")
      ) {
        grouped.set(groupKey, pv);
      }
    }
  }
  return grouped;
}

/**
 * Interleaves primary text hits and visual `catalog.like` hits (`text[0], photo[0], text[1], photo[1], ...`)
 * so visual search discoveries are never sliced off when text search returns 6+ products.
 */
export function interleaveCandidateMaps(
  primaryTextMap: Map<string, ParsedVariantRecord>,
  photoMap: Map<string, ParsedVariantRecord>,
  fallbackTextMap: Map<string, ParsedVariantRecord>,
  limit = 6,
): ParsedVariantRecord[] {
  const merged = new Map<string, ParsedVariantRecord>();
  const textEntries = Array.from(primaryTextMap.entries());
  const photoEntries = Array.from(photoMap.entries());
  const maxLen = Math.max(textEntries.length, photoEntries.length);

  for (let i = 0; i < maxLen && merged.size < limit; i++) {
    if (i < textEntries.length) {
      const [k, v] = textEntries[i];
      if (!merged.has(k)) merged.set(k, v);
    }
    if (merged.size < limit && i < photoEntries.length) {
      const [k, v] = photoEntries[i];
      if (!merged.has(k)) merged.set(k, v);
    }
  }

  for (const [k, v] of fallbackTextMap.entries()) {
    if (merged.size >= limit) break;
    if (!merged.has(k)) merged.set(k, v);
  }

  return Array.from(merged.values());
}

export function buildCatalogFilters(
  item: TracedItem,
  country: string,
  currency: string,
): {
  effectiveCurrency: string;
  context: Record<string, unknown>;
  filters: Record<string, unknown>;
} {
  const constraints = item.constraints;
  const effectiveCurrency = (constraints?.currency || currency).toUpperCase();
  const filters: Record<string, unknown> = {
    ships_to: { country },
  };

  if (
    constraints?.maxPriceMajor &&
    Number.isFinite(constraints.maxPriceMajor) &&
    constraints.maxPriceMajor > 0
  ) {
    const digits =
      new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: effectiveCurrency,
      }).resolvedOptions().maximumFractionDigits ?? 2;
    filters.price = {
      max: Math.round(constraints.maxPriceMajor * 10 ** digits),
    };
  }

  const attributes: Array<{ name: string; values: string[] }> = [];
  if (constraints?.requestedSize) {
    attributes.push({ name: "Size", values: [constraints.requestedSize] });
  }
  if (constraints?.requestedColor) {
    attributes.push({ name: "Color", values: [constraints.requestedColor] });
  }
  if (attributes.length > 0) {
    filters.attributes = attributes;
  }

  return {
    effectiveCurrency,
    context: {
      address_country: country,
      currency: effectiveCurrency,
    },
    filters,
  };
}

export async function retrieveShopifyCandidatesForItem(params: {
  item: TracedItem;
  primaryFrame?: EvidenceFrame | null;
  country: string;
  currency: string;
  signal?: AbortSignal;
}): Promise<{
  candidates: CandidateForScoring[];
  queriesRun: string[];
  usedVisualSearch: boolean;
  photoSearchError: string | null;
  durationMs: number;
}> {
  const startedAt = Date.now();
  const { item, primaryFrame, country, currency, signal } = params;

  const queriesRun: string[] = [];
  let usedVisualSearch = false;
  let photoSearchError: string | null = null;
  const searchErrors: string[] = [];

  const primaryQuery =
    item.searchQueries[0] ||
    [item.brand, item.modelReference, item.label].filter(Boolean).join(" ") ||
    item.category;

  const { effectiveCurrency, context, filters } = buildCatalogFilters(
    item,
    country,
    currency,
  );

  queriesRun.push(primaryQuery);
  const textPromise = callShopMcpTool(
    "search_catalog",
    {
      catalog: {
        query: primaryQuery,
        context,
        filters,
        pagination: { limit: 8 },
      },
    },
    { timeoutMs: 18_000, signal },
  )
    .then((r) => ({ ok: true as const, sc: r.structuredContent }))
    .catch((err: unknown) => ({
      ok: false as const,
      error: err instanceof Error ? err.message : "Text search failed.",
    }));

  const hasValidPhoto =
    Boolean(primaryFrame?.dataBase64) &&
    (primaryFrame?.dataBase64.length ?? 0) < 3_600_000;

  const photoPromise = hasValidPhoto
    ? (() => {
        queriesRun.push(`[photo+text] ${primaryQuery}`);
        return callShopMcpTool(
          "search_catalog",
          {
            catalog: {
              query: primaryQuery,
              like: [
                {
                  image: {
                    content_type: primaryFrame!.mimeType,
                    data: primaryFrame!.dataBase64,
                  },
                },
              ],
              context,
              filters,
              pagination: { limit: 6 },
            },
          },
          { timeoutMs: 18_000, signal },
        )
          .then((r) => ({ ok: true as const, sc: r.structuredContent }))
          .catch((err: unknown) => ({
            ok: false as const,
            error:
              err instanceof Error ? err.message : "Photo search failed.",
          }));
      })()
    : Promise.resolve(null);

  const [textResult, photoResult] = await Promise.all([
    textPromise,
    photoPromise,
  ]);

  const primaryTextMap = textResult.ok
    ? extractGroupedSearchHits(textResult.sc)
    : new Map<string, ParsedVariantRecord>();
  if (!textResult.ok) {
    searchErrors.push(textResult.error);
  }

  let photoMap = new Map<string, ParsedVariantRecord>();
  if (photoResult) {
    if (photoResult.ok) {
      usedVisualSearch = true;
      photoMap = extractGroupedSearchHits(photoResult.sc);
    } else {
      photoSearchError = photoResult.error;
    }
  }

  let fallbackTextMap = new Map<string, ParsedVariantRecord>();
  const secondaryQuery =
    item.searchQueries[1] ||
    item.searchQueries[2] ||
    `${item.brand ?? ""} ${item.category}`.trim();

  if (
    primaryTextMap.size + photoMap.size < 4 &&
    secondaryQuery &&
    secondaryQuery.toLowerCase() !== primaryQuery.toLowerCase()
  ) {
    try {
      queriesRun.push(secondaryQuery);
      // Broaden ONLY query text; NEVER discard shopper's mandatory `context` & `filters` (budget/size/color/currency)!
      const { structuredContent } = await callShopMcpTool(
        "search_catalog",
        {
          catalog: {
            query: secondaryQuery,
            context,
            filters,
            pagination: { limit: 6 },
          },
        },
        { timeoutMs: 14_000, signal },
      );
      fallbackTextMap = extractGroupedSearchHits(structuredContent);
    } catch (err) {
      searchErrors.push(
        err instanceof Error ? err.message : "Fallback search failed.",
      );
    }
  }

  const initialShortlist = interleaveCandidateMaps(
    primaryTextMap,
    photoMap,
    fallbackTextMap,
    6,
  );

  if (initialShortlist.length === 0 && searchErrors.length > 0 && !textResult.ok) {
    throw new ShopMcpError(searchErrors[0], "tool");
  }

  const verifiedShortlist = await Promise.all(
    initialShortlist.map(async (cand, idx) => {
      try {
        const refreshed = await refreshVariantWithGetProduct({
          productId: cand.productId,
          variantId: cand.variantId,
          sellerDomain: cand.sellerDomain,
          selectedOptions: cand.options,
          country,
          currency: effectiveCurrency,
          timeoutMs: 12_000,
          signal,
        });
        if (refreshed) {
          return {
            ...refreshed,
            offerId: `offer_${idx + 1}_${crypto.randomUUID().slice(0, 8)}`,
            originalSearchRank: idx + 1,
          };
        }
      } catch {
        // Keep search snapshot if individual get_product times out
      }
      return {
        ...cand,
        offerId: `offer_${idx + 1}_${crypto.randomUUID().slice(0, 8)}`,
        originalSearchRank: idx + 1,
      };
    }),
  );

  return {
    candidates: verifiedShortlist,
    queriesRun,
    usedVisualSearch,
    photoSearchError,
    durationMs: Date.now() - startedAt,
  };
}

export async function refreshVariantWithGetProduct(params: {
  productId: string;
  variantId: string;
  sellerDomain: string;
  selectedOptions: OfferOption[];
  country: string;
  currency: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<ParsedVariantRecord | null> {
  const { structuredContent } = await callShopMcpTool(
    "get_product",
    {
      catalog: {
        id: params.productId,
        ...(params.selectedOptions.length > 0
          ? { selected: params.selectedOptions }
          : {}),
        context: {
          address_country: params.country,
          currency: params.currency,
        },
      },
    },
    { timeoutMs: params.timeoutMs ?? 18_000, signal: params.signal },
  );

  const product = structuredContent.product as
    | Record<string, unknown>
    | undefined;
  if (!product) return null;

  const warnings = extractMessagesAndLinks(structuredContent.messages).messages;
  const parsedVariants = parseProductVariants(product, warnings);

  const exact = parsedVariants.find(
    (v) =>
      v.variantId === params.variantId &&
      v.sellerDomain.toLowerCase() === params.sellerDomain.toLowerCase(),
  );

  return exact ?? null;
}

export async function selectVariantByOptionsWithGetProduct(params: {
  productId: string;
  sellerDomain: string;
  desiredOptions: OfferOption[];
  country: string;
  currency: string;
}): Promise<ParsedVariantRecord | null> {
  const { structuredContent } = await callShopMcpTool("get_product", {
    catalog: {
      id: params.productId,
      selected: params.desiredOptions,
      context: {
        address_country: params.country,
        currency: params.currency,
      },
    },
  });

  const product = structuredContent.product as
    | Record<string, unknown>
    | undefined;
  if (!product) return null;

  const warnings = extractMessagesAndLinks(structuredContent.messages).messages;
  const parsedVariants = parseProductVariants(product, warnings).filter(
    (v) => v.sellerDomain.toLowerCase() === params.sellerDomain.toLowerCase(),
  );

  const matchingVariant = parsedVariants.find((v) =>
    params.desiredOptions.every((reqOpt) =>
      v.options.some(
        (vo) =>
          vo.name.trim().toLowerCase() === reqOpt.name.trim().toLowerCase() &&
          vo.label.trim().toLowerCase() === reqOpt.label.trim().toLowerCase(),
      ),
    ),
  );

  return matchingVariant ?? null;
}

function extractTotalsBreakdown(totals: unknown): {
  subtotalMinor: number | null;
  totalMinor: number | null;
  breakdown: CheckoutTotalLine[];
} {
  const breakdown: CheckoutTotalLine[] = [];
  let subtotalMinor: number | null = null;
  let totalMinor: number | null = null;

  if (Array.isArray(totals)) {
    for (const entry of totals) {
      const t = entry as Record<string, unknown>;
      const typeStr = typeof t.type === "string" ? t.type.toLowerCase() : "";
      const label =
        (typeof t.display_text === "string" && t.display_text) ||
        (typeof t.label === "string" && t.label) ||
        typeStr ||
        "Amount";
      const nested = t.money as { amount?: number } | undefined;
      const amt =
        typeof t.amount === "number" && Number.isFinite(t.amount)
          ? Math.round(t.amount)
          : typeof nested?.amount === "number"
            ? Math.round(nested.amount)
            : null;

      if (amt !== null) {
        breakdown.push({ type: typeStr || "line", label, amountMinor: amt });
        if (typeStr === "subtotal") subtotalMinor = amt;
        if (typeStr === "total") totalMinor = amt;
      }
    }
  } else if (totals && typeof totals === "object") {
    const obj = totals as Record<string, unknown>;
    for (const [k, rawVal] of Object.entries(obj)) {
      const keyLower = k.toLowerCase();
      const amt =
        typeof rawVal === "number" && Number.isFinite(rawVal)
          ? Math.round(rawVal)
          : rawVal &&
              typeof rawVal === "object" &&
              typeof (rawVal as { amount?: number }).amount === "number"
            ? Math.round((rawVal as { amount: number }).amount)
            : null;
      if (amt !== null) {
        breakdown.push({ type: keyLower, label: k, amountMinor: amt });
        if (keyLower === "subtotal") subtotalMinor = amt;
        if (keyLower === "total") totalMinor = amt;
      }
    }
  }

  return {
    subtotalMinor,
    totalMinor: totalMinor ?? subtotalMinor,
    breakdown,
  };
}

export type NormalizedProviderCheckout = {
  checkoutId: string;
  continueUrl: string;
  status: string;
  orderPlaced: boolean;
  subtotalMinor: number | null;
  totalMinor: number | null;
  totalsBreakdown: CheckoutTotalLine[];
  currency: string | null;
  warnings: string[];
  links: CheckoutLink[];
  orderId: string | null;
  orderPermalink: string | null;
};

export function parseProviderCheckoutDocument(
  sc: Record<string, unknown>,
  fallbackContinueUrl?: string,
): NormalizedProviderCheckout {
  const doc =
    sc.checkout && typeof sc.checkout === "object"
      ? (sc.checkout as Record<string, unknown>)
      : sc;

  const checkoutId = typeof doc.id === "string" ? doc.id : "";
  const continueUrl =
    typeof doc.continue_url === "string" &&
    doc.continue_url.startsWith("https://")
      ? doc.continue_url
      : fallbackContinueUrl && fallbackContinueUrl.startsWith("https://")
        ? fallbackContinueUrl
        : "";

  const status =
    typeof doc.status === "string" && doc.status.trim()
      ? doc.status.trim()
      : "incomplete";

  const currency =
    typeof doc.currency === "string" ? doc.currency.toUpperCase() : null;

  const { subtotalMinor, totalMinor, breakdown } = extractTotalsBreakdown(
    doc.totals,
  );

  const rootExtracted = extractMessagesAndLinks(sc.messages);
  const docExtracted = extractMessagesAndLinks(doc.messages);
  const warnings = Array.from(
    new Set([...rootExtracted.messages, ...docExtracted.messages]),
  );

  const rawLinks = [
    ...extractDocumentLinks(sc.links),
    ...extractDocumentLinks(doc.links),
    ...rootExtracted.links,
    ...docExtracted.links,
  ];
  const dedupedLinksMap = new Map<string, CheckoutLink>();
  for (const l of rawLinks) {
    if (!dedupedLinksMap.has(l.url)) {
      dedupedLinksMap.set(l.url, l);
    }
  }
  const links = Array.from(dedupedLinksMap.values());

  const order = doc.order as Record<string, unknown> | undefined;
  const orderId = order && typeof order.id === "string" ? order.id : null;
  const orderPermalink =
    order && typeof order.permalink_url === "string"
      ? order.permalink_url
      : order && typeof order.url === "string"
        ? order.url
        : null;

  const orderPlaced = status === "completed" && Boolean(order);

  if (!checkoutId) {
    throw new ShopMcpError(
      "Shop MCP checkout response did not include a checkout ID.",
      "parse",
    );
  }
  if (!continueUrl) {
    throw new ShopMcpError(
      "Shop MCP checkout response did not include an HTTPS continue_url.",
      "parse",
    );
  }

  return {
    checkoutId,
    continueUrl,
    status,
    orderPlaced,
    subtotalMinor,
    totalMinor,
    totalsBreakdown: breakdown,
    currency,
    warnings,
    links,
    orderId,
    orderPermalink,
  };
}

export async function createShopifyHostedCheckout(params: {
  sellerDomain: string;
  variantId: string;
  country: string;
  idempotencyKey: string;
}): Promise<NormalizedProviderCheckout> {
  const { structuredContent } = await callShopMcpTool("create_checkout", {
    meta: {
      "idempotency-key": params.idempotencyKey,
    },
    shop: params.sellerDomain,
    checkout: {
      line_items: [
        {
          item: { id: params.variantId },
          quantity: 1,
        },
      ],
      context: {
        address_country: params.country,
      },
    },
  });

  return parseProviderCheckoutDocument(structuredContent);
}

export async function readShopifyCheckoutStatus(params: {
  sellerDomain: string;
  checkoutId: string;
  fallbackContinueUrl: string;
}): Promise<NormalizedProviderCheckout> {
  const { structuredContent } = await callShopMcpTool("get_checkout", {
    shop: params.sellerDomain,
    id: params.checkoutId,
  });

  return parseProviderCheckoutDocument(
    structuredContent,
    params.fallbackContinueUrl,
  );
}
