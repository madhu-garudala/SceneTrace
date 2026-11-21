import { z } from "zod";
import { getGeminiApiKey } from "@/lib/env";
import type {
  EvidenceFrame,
  ManagedAgentReport,
  ManagedAgentStep,
  TracedItem,
} from "@/lib/types";

const AGENTS_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/agents";
const INTERACTIONS_ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/interactions";

export const SCENETRACE_MANAGED_AGENT_ID = "scenetrace-investigator-v1";
export const BASE_MANAGED_AGENT = "antigravity-preview-latest";

const SYSTEM_INSTRUCTION = [
  "You are SceneTrace Investigator, a persistent Gemini Managed Agent running inside an isolated Linux sandbox.",
  "Your mission is to bridge visual video observations and real Shopify commerce:",
  "1. Use `google_search` to cross-reference observed visual/spoken traits, corroborate exact brand/model/SKU codes, release colorways, sizing notes, and typical retail MSRP.",
  "2. Use `code_execution` (Python 3 in your remote Linux sandbox) to normalize SKU candidates, compute clean retail price benchmarks, and synthesize deduplicated, high-recall Shopify catalog search strings.",
  "3. Be strictly honest about uncertainty: only report a resolved brand or SKU when corroborated; never invent serial numbers.",
  "4. Always end your final response with a single fenced ```json ... ``` block matching the requested schema.",
].join("\n");

let agentEnsuredInProcess = false;

/**
 * Ensures the custom Saved Managed Agent (`scenetrace-investigator-v1`) exists
 * on `v1beta/agents`. Idempotent across cold starts and concurrent Vercel invocations.
 */
export async function ensureSceneTraceManagedAgent(
  apiKey: string,
): Promise<string> {
  if (agentEnsuredInProcess) {
    return SCENETRACE_MANAGED_AGENT_ID;
  }

  try {
    const getRes = await fetch(
      `${AGENTS_ENDPOINT}/${encodeURIComponent(SCENETRACE_MANAGED_AGENT_ID)}`,
      {
        method: "GET",
        headers: { "x-goog-api-key": apiKey },
        signal: AbortSignal.timeout(10_000),
      },
    );

    if (getRes.ok) {
      agentEnsuredInProcess = true;
      return SCENETRACE_MANAGED_AGENT_ID;
    }

    const createRes = await fetch(AGENTS_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        id: SCENETRACE_MANAGED_AGENT_ID,
        base_agent: BASE_MANAGED_AGENT,
        system_instruction: SYSTEM_INSTRUCTION,
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (createRes.ok || createRes.status === 409) {
      agentEnsuredInProcess = true;
      return SCENETRACE_MANAGED_AGENT_ID;
    }
  } catch {
    // Fall back to base managed agent if control-plane registration hiccups
  }

  return BASE_MANAGED_AGENT;
}

const AgentJsonPayloadSchema = z.object({
  resolvedBrand: z.string().max(120).nullable().optional().default(null),
  resolvedReference: z.string().max(160).nullable().optional().default(null),
  msrpEstimate: z.string().max(120).nullable().optional().default(null),
  buyingBrief: z.string().min(1).max(600),
  refinedSearchQueries: z.array(z.string().min(2).max(160)).min(1).max(4),
});

function parseAgentSteps(rawSteps: unknown): {
  steps: ManagedAgentStep[];
  finalModelText: string;
} {
  if (!Array.isArray(rawSteps)) {
    return { steps: [], finalModelText: "" };
  }

  const steps: ManagedAgentStep[] = [];
  const callOutputByCallId = new Map<string, string>();

  for (const raw of rawSteps) {
    const s = raw as Record<string, unknown>;
    if (
      s.type === "code_execution_result" &&
      typeof s.call_id === "string" &&
      typeof s.result === "string"
    ) {
      callOutputByCallId.set(s.call_id, s.result.trim().slice(0, 360));
    }
  }

  let finalModelText = "";
  let stepCounter = 1;

  for (const raw of rawSteps) {
    const s = raw as Record<string, unknown>;
    const type = typeof s.type === "string" ? s.type : "";

    if (type === "google_search_call") {
      const args = (s.arguments ?? {}) as { queries?: string[] };
      const queries = Array.isArray(args.queries)
        ? args.queries.filter((q) => typeof q === "string")
        : [];
      steps.push({
        stepIndex: stepCounter++,
        kind: "google_search",
        summary: `Web search (${queries.length || 1} ${queries.length === 1 ? "query" : "queries"})`,
        detail: queries.join(" · ").slice(0, 280),
      });
    } else if (type === "code_execution_call") {
      const callId = typeof s.id === "string" ? s.id : "";
      const args = (s.arguments ?? {}) as { language?: string; code?: string };
      const codeSnippet = typeof args.code === "string" ? args.code.trim() : "";
      const stdout = callId ? callOutputByCallId.get(callId) : undefined;
      steps.push({
        stepIndex: stepCounter++,
        kind: "code_execution",
        summary: `Remote sandbox (${args.language || "python/bash"})`,
        detail: [
          codeSnippet ? `$ ${codeSnippet.slice(0, 200)}` : null,
          stdout ? `→ ${stdout.replace(/\s+/g, " ").slice(0, 180)}` : null,
        ]
          .filter(Boolean)
          .join("\n"),
      });
    } else if (type === "model_output" && Array.isArray(s.content)) {
      for (const part of s.content) {
        const p = part as Record<string, unknown>;
        if (p.type === "text" && typeof p.text === "string" && p.text.trim()) {
          finalModelText = p.text.trim();
        }
      }
    }
  }

  return { steps, finalModelText };
}

function extractJsonObjectFromText(
  text: string,
  fallbackItem: TracedItem,
): z.infer<typeof AgentJsonPayloadSchema> {
  const fencedMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidateStrings: string[] = [];
  if (fencedMatch?.[1]) {
    candidateStrings.push(fencedMatch[1].trim());
  }

  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    candidateStrings.push(text.slice(firstBrace, lastBrace + 1));
  }

  for (const candidate of candidateStrings) {
    try {
      const parsed = JSON.parse(candidate);
      const validated = AgentJsonPayloadSchema.safeParse(parsed);
      if (validated.success) {
        return validated.data;
      }
    } catch {
      // try next candidate
    }
  }

  return {
    resolvedBrand: fallbackItem.brand,
    resolvedReference: fallbackItem.modelReference,
    msrpEstimate: null,
    buyingBrief:
      text.replace(/```[\s\S]*?```/g, "").trim().slice(0, 420) ||
      `Investigated ${fallbackItem.label} in remote sandbox.`,
    refinedSearchQueries: fallbackItem.searchQueries,
  };
}

export async function runManagedAgentInvestigation(params: {
  item: TracedItem;
  question: string;
  followUpPrompt?: string | null;
  previousInteractionId?: string | null;
  primaryFrame?: EvidenceFrame | null;
}): Promise<{
  report: ManagedAgentReport;
  updatedItem: TracedItem;
}> {
  const apiKey = getGeminiApiKey();
  const startedAt = Date.now();
  const agentToUse = await ensureSceneTraceManagedAgent(apiKey);

  const { item, question, followUpPrompt, previousInteractionId, primaryFrame } =
    params;

  const featureSummary = item.features
    .map((f) => `[${f.source} @ ${f.atSec}s] ${f.name}: ${f.value}`)
    .join("; ");

  const taskPrompt = followUpPrompt?.trim()
    ? [
        `Shopper follow-up instruction for "${item.label}": "${followUpPrompt.trim()}"`,
        "Use `google_search` and Python in your remote sandbox to answer this refinement, update retail price guidance if relevant, and generate 2–3 updated Shopify catalog search queries tailored to the shopper's follow-up.",
        "End with a single ```json``` block with keys: resolvedBrand (string|null), resolvedReference (string|null), msrpEstimate (string|null, e.g. '$18–$25 USD'), buyingBrief (1–2 concise sentences), refinedSearchQueries (array of 2–3 clean Shopify search strings).",
      ].join("\n")
    : [
        `Investigate this traced video item to maximize Shopify match accuracy.`,
        `Original shopper question: "${question}"`,
        `Extracted category: ${item.category}`,
        `Extracted label: ${item.label}`,
        `Extracted brand: ${item.brand ?? "unconfirmed"}`,
        `Extracted reference: ${item.modelReference ?? "unconfirmed"}`,
        `Observed traits: ${featureSummary || item.summary}`,
        `Initial search queries: ${item.searchQueries.join(" | ")}`,
        "",
        "Required autonomous steps in your remote sandbox:",
        "1. Run `google_search` to verify exact product naming, model/SKU reference (if identifiable from the traits), colorway name, and typical US retail price range (MSRP).",
        "2. Run a short Python script via `code_execution` to normalize and deduplicate candidate SKU tokens and construct 2–3 high-signal Shopify catalog search queries (without filler words).",
        "3. Output a single ```json``` block at the end with keys:",
        '   {"resolvedBrand": string|null, "resolvedReference": string|null, "msrpEstimate": string|null, "buyingBrief": "1-2 sentence shopper brief with MSRP/variant guidance", "refinedSearchQueries": ["query1", "query2"]}',
      ].join("\n");

  const inputBlocks: Array<Record<string, unknown>> = [
    { type: "text", text: taskPrompt },
  ];

  if (
    primaryFrame &&
    primaryFrame.dataBase64 &&
    primaryFrame.dataBase64.length < 3_500_000 &&
    !previousInteractionId
  ) {
    inputBlocks.push({
      type: "image",
      data: primaryFrame.dataBase64,
      mime_type: primaryFrame.mimeType,
    });
  }

  const requestBody: Record<string, unknown> = {
    agent: agentToUse,
    environment: "remote",
    input: inputBlocks,
  };

  if (previousInteractionId?.trim()) {
    requestBody.previous_interaction_id = previousInteractionId.trim();
  }

  const response = await fetch(INTERACTIONS_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify(requestBody),
    signal: AbortSignal.timeout(95_000),
  });

  const rawText = await response.text();
  if (!response.ok) {
    let detail = rawText.slice(0, 350);
    try {
      const parsedErr = JSON.parse(rawText) as { error?: { message?: string } };
      if (parsedErr.error?.message) detail = parsedErr.error.message;
    } catch {
      // keep raw snippet
    }
    throw new Error(
      `Gemini Managed Agent failed (${response.status}): ${detail}`,
    );
  }

  const envelope = JSON.parse(rawText) as Record<string, unknown>;
  const interactionId =
    typeof envelope.id === "string" ? envelope.id : "interaction_unknown";
  const environmentId =
    typeof envelope.environment_id === "string"
      ? envelope.environment_id
      : null;

  const { steps, finalModelText } = parseAgentSteps(envelope.steps);
  const structured = extractJsonObjectFromText(finalModelText, item);

  const cleanQueries = Array.from(
    new Set(
      [...structured.refinedSearchQueries, ...item.searchQueries]
        .map((q) => q.trim())
        .filter((q) => q.length >= 2),
    ),
  ).slice(0, 3);

  const updatedItem: TracedItem = {
    ...item,
    brand: item.brand || structured.resolvedBrand?.trim() || null,
    modelReference:
      item.modelReference || structured.resolvedReference?.trim() || null,
    searchQueries: cleanQueries.length > 0 ? cleanQueries : item.searchQueries,
  };

  const report: ManagedAgentReport = {
    agentId: agentToUse,
    baseAgent: BASE_MANAGED_AGENT,
    interactionId,
    environmentId,
    durationMs: Date.now() - startedAt,
    resolvedBrand: structured.resolvedBrand?.trim() || item.brand,
    resolvedReference:
      structured.resolvedReference?.trim() || item.modelReference,
    msrpEstimate: structured.msrpEstimate?.trim() || null,
    buyingBrief: structured.buyingBrief.trim(),
    refinedSearchQueries: updatedItem.searchQueries,
    steps,
  };

  return { report, updatedItem };
}
