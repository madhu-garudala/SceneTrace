"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertCircle,
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Crosshair,
  ExternalLink,
  Film,
  Loader2,
  Moon,
  Paperclip,
  Play,
  RefreshCw,
  Send,
  ShoppingBag,
  Sun,
  Terminal,
  Upload,
  X,
} from "lucide-react";
import {
  CheckoutModal,
  formatMoneyMinor,
} from "@/components/CheckoutModal";
import { DiagnosticsDrawer } from "@/components/DiagnosticsDrawer";
import { YouTubeMonitor } from "@/components/YouTubeMonitor";
import type { AllowedVideoModel } from "@/lib/env";
import type {
  CheckoutPriceChange,
  CheckoutSummary,
  EvidenceFrame,
  ExtractDiagnostics,
  ExtractResponse,
  ItemMatchDiagnostics,
  ManagedAgentReport,
  MatchItemResponse,
  MatchLabel,
  Offer,
  OfferOption,
  TracedItem,
} from "@/lib/types";
import {
  extractFramesFromCompanionVideo,
  readCompanionStillImage,
} from "@/lib/video/frames-client";
import {
  formatTimestamp,
  parseAndNormalizeYouTubeUrl,
} from "@/lib/video/youtube";

type PipelineStage =
  | "idle"
  | "extracting"
  | "capturing_frames"
  | "agent_investigating"
  | "matching"
  | "complete"
  | "partial"
  | "failed";

const QUESTION_PRESETS = [
  {
    short: "All worn items",
    text: "Which shoes, jacket, shirt, or accessories is the person wearing?",
  },
  {
    short: "Footwear & colorway",
    text: "What sneakers or shoes appear in this clip and what colorway are they?",
  },
  {
    short: "Watches & wristwear",
    text: "Which watches appear across the scenes in this video?",
  },
  {
    short: "Desk & everyday gear",
    text: "Identify the mug, bag, tech accessories, or desk items shown.",
  },
];

const VIDEO_MODEL_OPTIONS: { value: AllowedVideoModel; label: string }[] = [
  { value: "gemini-4-neon", label: "Gemini 4 Neon (Default)" },
  { value: "gemini-4-carbon", label: "Gemini 4 Carbon (Deep)" },
  { value: "gemini-3.8-flash", label: "Gemini 3.8 Flash (Fast)" },
];

function matchBadgeMeta(label: MatchLabel): {
  text: string;
  classes: string;
} {
  switch (label) {
    case "exact_supported":
      return {
        text: "Exact match supported",
        classes:
          "border-emerald-500/45 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
      };
    case "possible":
      return {
        text: "Possible match",
        classes:
          "border-amber-500/45 bg-amber-500/12 text-amber-700 dark:text-amber-300",
      };
    case "similar":
      return {
        text: "Similar item",
        classes:
          "border-[var(--border-strong)] bg-[var(--bg-sunken)] text-[var(--ink-secondary)]",
      };
    case "unscored":
      return {
        text: "Catalog order (unscored)",
        classes:
          "border-dashed border-[var(--border-strong)] bg-[var(--bg-sunken)] text-[var(--ink-muted)]",
      };
  }
}

function sourceBadgeClasses(source: "visible" | "spoken" | "inferred"): string {
  if (source === "visible") {
    return "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  }
  if (source === "spoken") {
    return "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300";
  }
  return "border-[var(--border-subtle)] bg-[var(--bg-sunken)] text-[var(--ink-muted)]";
}

export type SceneTraceStudioProps = {
  defaultVideoModel: AllowedVideoModel;
  defaultCountry: string;
  defaultCurrency: string;
};

export function SceneTraceStudio({
  defaultVideoModel,
  defaultCountry,
  defaultCurrency,
}: SceneTraceStudioProps) {
  const [darkMode, setDarkMode] = useState(true);
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [question, setQuestion] = useState(QUESTION_PRESETS[0].text);
  const [videoModel, setVideoModel] =
    useState<AllowedVideoModel>(defaultVideoModel);
  const [managedAgentEnabled, setManagedAgentEnabled] = useState(true);
  const [companionFile, setCompanionFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const youtubeDurationRef = useRef<number | null>(null);

  // Persists one stable idempotency UUID per distinct `offerToken` across network retries
  const idempotencyByTokenRef = useRef<Map<string, string>>(new Map());

  // Pipeline state
  const [stage, setStage] = useState<PipelineStage>("idle");
  const [stageAnnouncement, setStageAnnouncement] = useState("");
  const [traceError, setTraceError] = useState<string | null>(null);
  const [frameWarning, setFrameWarning] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const activeRunIdRef = useRef(0);

  // Trace data
  const [traceId, setTraceId] = useState<string | null>(null);
  const [activeVideoId, setActiveVideoId] = useState<string | null>(null);
  const [items, setItems] = useState<TracedItem[]>([]);
  const [activeItemId, setActiveItemId] = useState<string | null>(null);
  const [seekRequest, setSeekRequest] = useState<{
    seconds: number;
    nonce: number;
  } | null>(null);
  const [framesByItem, setFramesByItem] = useState<
    Record<string, EvidenceFrame[]>
  >({});
  const [agentReportsByItem, setAgentReportsByItem] = useState<
    Record<string, ManagedAgentReport>
  >({});
  const [agentRunningByItem, setAgentRunningByItem] = useState<
    Record<string, boolean>
  >({});
  const [expandedAgentSteps, setExpandedAgentSteps] = useState<
    Record<string, boolean>
  >({});
  const [agentFollowUpInputs, setAgentFollowUpInputs] = useState<
    Record<string, string>
  >({});
  const [offersByItem, setOffersByItem] = useState<Record<string, Offer[]>>({});
  const [selectingVariantOfferId, setSelectingVariantOfferId] = useState<
    string | null
  >(null);
  const [variantSelectErrorByOffer, setVariantSelectErrorByOffer] = useState<
    Record<string, string>
  >({});
  const [matchingItemIds, setMatchingItemIds] = useState<
    Record<string, boolean>
  >({});
  const [extractDiagnostics, setExtractDiagnostics] =
    useState<ExtractDiagnostics | null>(null);
  const [matchDiagnosticsByItem, setMatchDiagnosticsByItem] = useState<
    Record<string, ItemMatchDiagnostics>
  >({});

  // Diagnostics & Checkout modals (current modal attempt separated from saved checkout history)
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [checkoutModalOpen, setCheckoutModalOpen] = useState(false);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [buyingOfferId, setBuyingOfferId] = useState<string | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [modalCheckout, setModalCheckout] = useState<CheckoutSummary | null>(
    null,
  );
  const [savedCheckout, setSavedCheckout] = useState<CheckoutSummary | null>(
    null,
  );
  const [priceChangePrompt, setPriceChangePrompt] = useState<{
    offerTitle: string;
    sellerName: string;
    change: CheckoutPriceChange;
  } | null>(null);
  const [refreshingCheckoutStatus, setRefreshingCheckoutStatus] =
    useState(false);

  useEffect(() => {
    setDarkMode(document.documentElement.classList.contains("dark"));
    try {
      const stored = sessionStorage.getItem("scenetrace-active-checkout");
      if (stored) {
        const parsed = JSON.parse(stored) as CheckoutSummary;
        if (parsed?.checkoutRef && parsed?.continueUrl) {
          setSavedCheckout(parsed);
        }
      }
    } catch {
      // ignore storage errors
    }
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setDiagnosticsOpen(false);
        setCheckoutModalOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (
      stage !== "extracting" &&
      stage !== "capturing_frames" &&
      stage !== "agent_investigating" &&
      stage !== "matching"
    ) {
      return;
    }
    const start = Date.now() - elapsedMs;
    const id = window.setInterval(() => {
      setElapsedMs(Date.now() - start);
    }, 100);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);

  const toggleTheme = () => {
    const nextDark = !darkMode;
    setDarkMode(nextDark);
    if (nextDark) {
      document.documentElement.classList.add("dark");
      localStorage.setItem("scenetrace-theme", "dark");
    } else {
      document.documentElement.classList.remove("dark");
      localStorage.setItem("scenetrace-theme", "light");
    }
  };

  const liveUrlPreview = useMemo(() => {
    if (!youtubeUrl.trim()) return null;
    try {
      return parseAndNormalizeYouTubeUrl(youtubeUrl);
    } catch {
      return null;
    }
  }, [youtubeUrl]);

  useEffect(() => {
    if (liveUrlPreview && stage === "idle") {
      if (activeVideoId !== liveUrlPreview.videoId) {
        youtubeDurationRef.current = null;
        setActiveVideoId(liveUrlPreview.videoId);
      }
    }
  }, [liveUrlPreview, stage, activeVideoId]);

  const triggerSeek = useCallback((itemId: string, seconds: number) => {
    setActiveItemId(itemId);
    setSeekRequest({ seconds, nonce: Date.now() + Math.random() });
  }, []);

  const matchSingleItem = useCallback(
    async (params: {
      activeTraceId: string;
      targetItem: TracedItem;
      itemFrames: EvidenceFrame[];
      runId?: number;
    }): Promise<boolean> => {
      const { activeTraceId, targetItem, itemFrames, runId } = params;
      setMatchingItemIds((prev) => ({ ...prev, [targetItem.itemId]: true }));

      try {
        const leanFrames = itemFrames.map((f) => ({
          kind: f.kind,
          atSec: f.atSec,
          mimeType: f.mimeType,
          dataBase64: f.dataBase64,
          dataUrl: "",
          width: f.width,
          height: f.height,
          label: f.label,
        }));

        const matchRes = await fetch("/api/traces/match", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            traceId: activeTraceId,
            item: targetItem,
            evidenceFrames: leanFrames,
            country: defaultCountry,
            currency: defaultCurrency,
          }),
        });

        const matchJson = (await matchRes.json()) as
          | MatchItemResponse
          | { error?: string };

        if (runId !== undefined && runId !== activeRunIdRef.current) {
          return false;
        }

        if (matchRes.ok && "offers" in matchJson) {
          setOffersByItem((prev) => ({
            ...prev,
            [targetItem.itemId]: matchJson.offers,
          }));
          setMatchDiagnosticsByItem((prev) => ({
            ...prev,
            [targetItem.itemId]: matchJson.diagnostics,
          }));
          return Boolean(
            !matchJson.diagnostics.shopLive ||
              matchJson.diagnostics.rankingError,
          );
        } else {
          setOffersByItem((prev) => ({ ...prev, [targetItem.itemId]: [] }));
          setMatchDiagnosticsByItem((prev) => ({
            ...prev,
            [targetItem.itemId]: {
              itemId: targetItem.itemId,
              shopLive: false,
              decisionsLive: false,
              evidenceMode: "catalog_fallback",
              decisionModel: "gemini-decision-1",
              candidateCount: 0,
              queriesRun: [],
              usedVisualSearch: false,
              photoSearchError: null,
              shopDurationMs: 0,
              decisionsDurationMs: 0,
              shopError:
                ("error" in matchJson && matchJson.error) ||
                `Match HTTP ${matchRes.status}`,
              rankingError: null,
              rankComparison: [],
            },
          }));
          return true;
        }
      } catch (err) {
        if (runId === undefined || runId === activeRunIdRef.current) {
          setMatchDiagnosticsByItem((prev) => ({
            ...prev,
            [targetItem.itemId]: {
              itemId: targetItem.itemId,
              shopLive: false,
              decisionsLive: false,
              evidenceMode: "catalog_fallback",
              decisionModel: "gemini-decision-1",
              candidateCount: 0,
              queriesRun: [],
              usedVisualSearch: false,
              photoSearchError: null,
              shopDurationMs: 0,
              decisionsDurationMs: 0,
              shopError:
                err instanceof Error
                  ? err.message
                  : "Network error matching item.",
              rankingError: null,
              rankComparison: [],
            },
          }));
        }
        return true;
      } finally {
        if (runId === undefined || runId === activeRunIdRef.current) {
          setMatchingItemIds((prev) => ({
            ...prev,
            [targetItem.itemId]: false,
          }));
        }
      }
    },
    [defaultCountry, defaultCurrency],
  );

  const runAgentForItem = useCallback(
    async (params: {
      targetItem: TracedItem;
      baseQuestion: string;
      followUpPrompt?: string;
      previousInteractionId?: string | null;
      primaryFrame?: EvidenceFrame | null;
      reRunMatchAfter?: boolean;
    }): Promise<TracedItem> => {
      const {
        targetItem,
        baseQuestion,
        followUpPrompt,
        previousInteractionId,
        primaryFrame,
        reRunMatchAfter,
      } = params;

      setAgentRunningByItem((prev) => ({ ...prev, [targetItem.itemId]: true }));

      try {
        const res = await fetch("/api/traces/agent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            question: baseQuestion,
            followUpPrompt,
            previousInteractionId,
            item: targetItem,
            primaryFrame: primaryFrame
              ? {
                  kind: primaryFrame.kind,
                  atSec: primaryFrame.atSec,
                  mimeType: primaryFrame.mimeType,
                  dataBase64: primaryFrame.dataBase64,
                  dataUrl: "",
                  width: primaryFrame.width,
                  height: primaryFrame.height,
                  label: primaryFrame.label,
                }
              : null,
          }),
        });

        const data = (await res.json()) as
          | { report: ManagedAgentReport; updatedItem: TracedItem }
          | { error?: string };

        if (res.ok && "report" in data) {
          setAgentReportsByItem((prev) => ({
            ...prev,
            [targetItem.itemId]: data.report,
          }));
          setItems((prev) =>
            prev.map((it) =>
              it.itemId === targetItem.itemId ? data.updatedItem : it,
            ),
          );

          if (reRunMatchAfter && traceId) {
            await matchSingleItem({
              activeTraceId: traceId,
              targetItem: data.updatedItem,
              itemFrames: framesByItem[targetItem.itemId] ?? [],
            });
          }

          return data.updatedItem;
        }
      } catch {
        // Non-fatal: keep Gemini 4 extracted item intact if sandbox times out
      } finally {
        setAgentRunningByItem((prev) => ({
          ...prev,
          [targetItem.itemId]: false,
        }));
      }

      return targetItem;
    },
    [framesByItem, matchSingleItem, traceId],
  );

  const handleTrace = async (e?: React.FormEvent) => {
    e?.preventDefault();

    setTraceError(null);
    setFrameWarning(null);

    let normalized: ReturnType<typeof parseAndNormalizeYouTubeUrl>;
    try {
      normalized = parseAndNormalizeYouTubeUrl(youtubeUrl);
    } catch (err) {
      setTraceError(
        err instanceof Error ? err.message : "Invalid YouTube URL.",
      );
      return;
    }

    if (question.trim().length < 3) {
      setTraceError("Enter a question describing which items to trace.");
      return;
    }

    const runId = ++activeRunIdRef.current;
    if (activeVideoId !== normalized.videoId) {
      youtubeDurationRef.current = null;
      setActiveVideoId(normalized.videoId);
    }
    setElapsedMs(0);
    setStage("extracting");
    setStageAnnouncement("Extracting scene items and timestamps with Gemini 4…");
    setItems([]);
    setFramesByItem({});
    setAgentReportsByItem({});
    setOffersByItem({});
    setMatchDiagnosticsByItem({});
    setExtractDiagnostics(null);

    try {
      // Stage 1: Gemini 4 YouTube Video Extraction
      const extractRes = await fetch("/api/traces/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          youtubeUrl: normalized.canonicalUrl,
          question: question.trim(),
          videoModel,
        }),
      });

      const extractJson = (await extractRes.json()) as
        | ExtractResponse
        | { error?: string };

      if (runId !== activeRunIdRef.current) return;

      if (!extractRes.ok || !("items" in extractJson)) {
        const msg =
          ("error" in extractJson && extractJson.error) ||
          `Video analysis failed (${extractRes.status}).`;
        setStage("failed");
        setTraceError(msg);
        setStageAnnouncement(`Analysis failed: ${msg}`);
        return;
      }

      setTraceId(extractJson.traceId);
      setItems(extractJson.items);
      setExtractDiagnostics(extractJson.diagnostics);

      if (extractJson.items.length === 0) {
        setStage("complete");
        setStageAnnouncement(
          "Video analyzed — no matching products were detected for this question.",
        );
        return;
      }

      const firstItem = extractJson.items[0];
      setActiveItemId(firstItem.itemId);
      setSeekRequest({
        seconds: firstItem.bestEvidenceSec,
        nonce: Date.now(),
      });

      // Stage 2: Optional Browser <canvas> Frame Extraction with Duration Alignment & Box Cropping
      let capturedFramesMap: Record<string, EvidenceFrame[]> = {};
      if (companionFile) {
        setStage("capturing_frames");
        setStageAnnouncement(
          "Capturing high-resolution scene frames from companion file…",
        );
        try {
          if (companionFile.type.startsWith("image/")) {
            const singleStill = await readCompanionStillImage(companionFile);
            // Attach uploaded reference photo ONLY to the primary item (never mislabeled across unrelated items)
            capturedFramesMap[firstItem.itemId] = [singleStill];
            if (extractJson.items.length > 1) {
              setFrameWarning(
                `Attached reference photo associated with primary item "${firstItem.label}" (unmapped to video timestamps).`,
              );
            }
          } else {
            const captureResult = await extractFramesFromCompanionVideo(
              companionFile,
              extractJson.items,
              youtubeDurationRef.current,
            );
            capturedFramesMap = captureResult.framesByItem;
            if (captureResult.alignmentWarning) {
              setFrameWarning(captureResult.alignmentWarning);
            }
          }
          if (runId !== activeRunIdRef.current) return;
          setFramesByItem(capturedFramesMap);
        } catch (frameErr) {
          setFrameWarning(
            frameErr instanceof Error
              ? `${frameErr.message} Continuing with YouTube timestamp evidence.`
              : "Could not decode companion file; continuing with YouTube timestamp evidence.",
          );
        }
      }

      // Stage 2.5: Gemini Managed Agent Remote Sandbox Investigation
      let workingItems = [...extractJson.items];
      if (managedAgentEnabled) {
        setStage("agent_investigating");
        setStageAnnouncement(
          "Running Gemini Managed Agent in remote Linux sandbox for SKU & MSRP forensics…",
        );

        const enriched = await Promise.all(
          workingItems.map((it) =>
            runAgentForItem({
              targetItem: it,
              baseQuestion: question.trim(),
              primaryFrame: capturedFramesMap[it.itemId]?.[0] ?? null,
              reRunMatchAfter: false,
            }),
          ),
        );
        if (runId !== activeRunIdRef.current) return;
        workingItems = enriched;
      }

      // Stage 3: Per-Item Shop MCP Search + Gemini Decisions Reranking
      setStage("matching");
      setStageAnnouncement(
        "Searching Shopify catalog via Shop MCP and scoring matches with Gemini Decisions…",
      );

      let hadAnyError = false;
      const queue = [...workingItems];
      const workers = Array.from({
        length: Math.min(3, queue.length),
      }).map(async () => {
        while (queue.length > 0) {
          const currentItem = queue.shift();
          if (!currentItem) break;
          const itemHadError = await matchSingleItem({
            activeTraceId: extractJson.traceId,
            targetItem: currentItem,
            itemFrames: capturedFramesMap[currentItem.itemId] ?? [],
            runId,
          });
          if (itemHadError) hadAnyError = true;
        }
      });

      await Promise.all(workers);
      if (runId !== activeRunIdRef.current) return;

      setStage(hadAnyError ? "partial" : "complete");
      setStageAnnouncement(
        hadAnyError
          ? "Trace finished with partial provider warnings."
          : "Trace complete — offers ranked by Gemini Decisions.",
      );
    } catch (err) {
      if (runId !== activeRunIdRef.current) return;
      setStage("failed");
      const msg =
        err instanceof Error ? err.message : "Unexpected trace failure.";
      setTraceError(msg);
      setStageAnnouncement(`Trace failed: ${msg}`);
    }
  };

  const handleSelectVariantOption = async (params: {
    item: TracedItem;
    offer: Offer;
    optionName: string;
    optionValue: string;
  }) => {
    const { item, offer, optionName, optionValue } = params;
    const itemId = item.itemId;
    if (selectingVariantOfferId) return;

    const desiredOptions: OfferOption[] = [
      ...offer.options.filter(
        (o) => o.name.toLowerCase() !== optionName.toLowerCase(),
      ),
      { name: optionName, label: optionValue },
    ];

    setSelectingVariantOfferId(offer.offerId);
    setVariantSelectErrorByOffer((prev) => {
      const next = { ...prev };
      delete next[offer.offerId];
      return next;
    });

    try {
      const res = await fetch("/api/traces/variant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          offerToken: offer.offerToken,
          desiredOptions,
          originalSearchRank: offer.originalSearchRank,
          previousExactMatchYes: offer.exactMatchYes,
          previousConfidence: offer.confidence,
          item,
          country: defaultCountry,
        }),
      });

      const data = (await res.json()) as {
        updated?: Partial<Offer> & { offerToken: string };
        error?: string;
      };

      if (!res.ok || !data.updated) {
        setVariantSelectErrorByOffer((prev) => ({
          ...prev,
          [offer.offerId]:
            data.error || `Option unavailable (${res.status}).`,
        }));
        return;
      }

      const upd = data.updated;
      setOffersByItem((prev) => ({
        ...prev,
        [itemId]: (prev[itemId] ?? []).map((existing) =>
          existing.offerId === offer.offerId
            ? {
                ...existing,
                offerToken: upd.offerToken,
                variantId: upd.variantId ?? existing.variantId,
                title: upd.title ?? existing.title,
                options: upd.options ?? existing.options,
                availableOptions:
                  upd.availableOptions ?? existing.availableOptions,
                amountMinor:
                  upd.amountMinor !== undefined
                    ? upd.amountMinor
                    : existing.amountMinor,
                currency: upd.currency ?? existing.currency,
                availability: upd.availability ?? existing.availability,
                productUrl: upd.productUrl ?? existing.productUrl,
                imageUrl: upd.imageUrl ?? existing.imageUrl,
                exactMatchYes:
                  upd.exactMatchYes !== undefined
                    ? upd.exactMatchYes
                    : existing.exactMatchYes,
                confidence:
                  upd.confidence !== undefined
                    ? upd.confidence
                    : existing.confidence,
                matchLabel: upd.matchLabel ?? existing.matchLabel,
                hardConflict:
                  upd.hardConflict !== undefined
                    ? upd.hardConflict
                    : existing.hardConflict,
                rationale: upd.rationale ?? existing.rationale,
              }
            : existing,
        ),
      }));

      setMatchDiagnosticsByItem((prev) => {
        const currentDiag = prev[itemId];
        if (!currentDiag) return prev;
        return {
          ...prev,
          [itemId]: {
            ...currentDiag,
            rankComparison: currentDiag.rankComparison.map((row) =>
              row.offerId === offer.offerId
                ? {
                    ...row,
                    title: upd.title ?? row.title,
                    exactMatchYes:
                      upd.exactMatchYes !== undefined
                        ? upd.exactMatchYes
                        : row.exactMatchYes,
                    confidence:
                      upd.confidence !== undefined
                        ? upd.confidence
                        : row.confidence,
                    matchLabel: upd.matchLabel ?? row.matchLabel,
                    hardConflict:
                      upd.hardConflict !== undefined
                        ? upd.hardConflict
                        : row.hardConflict,
                  }
                : row,
            ),
          },
        };
      });
    } catch (err) {
      setVariantSelectErrorByOffer((prev) => ({
        ...prev,
        [offer.offerId]:
          err instanceof Error
            ? err.message
            : "Network error updating variant option.",
      }));
    } finally {
      setSelectingVariantOfferId(null);
    }
  };

  const getOrCreateIdempotencyKey = (offerToken: string): string => {
    const existing = idempotencyByTokenRef.current.get(offerToken);
    if (existing) return existing;
    const created = crypto.randomUUID();
    idempotencyByTokenRef.current.set(offerToken, created);
    return created;
  };

  const executeCheckout = async (params: {
    offerId: string;
    offerToken: string;
    offerTitle: string;
    sellerName: string;
  }) => {
    if (buyingOfferId) return;
    setBuyingOfferId(params.offerId);
    setCheckoutLoading(true);
    // Clear modalCheckout so an error or price-change on Offer B never shows Merchant A's stale checkout!
    setModalCheckout(null);
    setCheckoutError(null);
    setPriceChangePrompt(null);
    setCheckoutModalOpen(true);

    const idempotencyKey = getOrCreateIdempotencyKey(params.offerToken);

    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          offerToken: params.offerToken,
          idempotencyKey,
          country: defaultCountry,
        }),
      });

      const data = (await res.json()) as {
        code?: string;
        error?: string;
        checkout?: CheckoutSummary;
        priceChange?: CheckoutPriceChange;
      };

      if (
        res.status === 409 &&
        data.code === "price_changed" &&
        data.priceChange
      ) {
        setPriceChangePrompt({
          offerTitle: params.offerTitle,
          sellerName: params.sellerName,
          change: data.priceChange,
        });
        return;
      }

      if (!res.ok || !data.checkout) {
        setCheckoutError(
          data.error || `Could not create Shopify checkout (${res.status}).`,
        );
        return;
      }

      setModalCheckout(data.checkout);
      setSavedCheckout(data.checkout);
      try {
        sessionStorage.setItem(
          "scenetrace-active-checkout",
          JSON.stringify(data.checkout),
        );
      } catch {
        // ignore storage quota
      }
    } catch (err) {
      setCheckoutError(
        err instanceof Error
          ? err.message
          : "Network error creating Shopify checkout.",
      );
    } finally {
      setCheckoutLoading(false);
      setBuyingOfferId(null);
    }
  };

  const handleRefreshCheckoutStatus = async () => {
    const targetCheckout = modalCheckout ?? savedCheckout;
    if (!targetCheckout || refreshingCheckoutStatus) return;
    setRefreshingCheckoutStatus(true);
    setCheckoutError(null);

    try {
      const res = await fetch(
        `/api/checkout/${encodeURIComponent(targetCheckout.checkoutRef)}`,
        { method: "GET" },
      );

      const data = (await res.json()) as {
        checkout?: CheckoutSummary;
        error?: string;
      };

      if (!res.ok || !data.checkout) {
        setCheckoutError(
          data.error || `Could not refresh checkout status (${res.status}).`,
        );
        return;
      }

      setModalCheckout(data.checkout);
      setSavedCheckout(data.checkout);
      try {
        sessionStorage.setItem(
          "scenetrace-active-checkout",
          JSON.stringify(data.checkout),
        );
      } catch {
        // ignore
      }
    } catch (err) {
      setCheckoutError(
        err instanceof Error
          ? err.message
          : "Network error checking Shopify order status.",
      );
    } finally {
      setRefreshingCheckoutStatus(false);
    }
  };

  const isRunning =
    stage === "extracting" ||
    stage === "capturing_frames" ||
    stage === "agent_investigating" ||
    stage === "matching";

  const promotedTopCount = useMemo(() => {
    let count = 0;
    for (const diag of Object.values(matchDiagnosticsByItem)) {
      const top = diag.rankComparison[0];
      if (top && top.originalRank > 1) count++;
    }
    return count;
  }, [matchDiagnosticsByItem]);

  return (
    <div className="min-h-screen bg-[var(--bg-canvas)] text-[var(--ink-primary)]">
      <div className="sr-only" aria-live="polite">
        {stageAnnouncement}
      </div>

      {/* Top Studio Header */}
      <header className="sticky top-0 z-30 border-b border-[var(--border-subtle)] bg-[var(--bg-canvas)]/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-2.5 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-7 w-7 items-center justify-center rounded border border-amber-500/45 bg-amber-500/12 text-amber-500">
              <Crosshair className="h-4 w-4" />
            </div>
            <div className="flex items-baseline gap-2.5">
              <span className="font-[family-name:var(--font-mono)] text-sm font-bold tracking-tight">
                SCENETRACE
              </span>
              <span className="hidden font-[family-name:var(--font-mono)] text-[10px] uppercase tracking-widest text-[var(--ink-muted)] lg:inline">
                Gemini 4 · Managed Agents · Shop MCP · Decisions
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="hidden rounded border border-[var(--border-subtle)] bg-[var(--bg-panel)] px-2 py-1 font-[family-name:var(--font-mono)] text-[10px] text-[var(--ink-secondary)] sm:inline-block">
              {defaultCountry} · {defaultCurrency}
            </span>

            <label className="sr-only" htmlFor="video-model-select">
              Gemini Video Model
            </label>
            <select
              id="video-model-select"
              value={videoModel}
              onChange={(e) =>
                setVideoModel(e.target.value as AllowedVideoModel)
              }
              disabled={isRunning}
              className="rounded border border-[var(--border-subtle)] bg-[var(--bg-panel)] px-2.5 py-1 font-[family-name:var(--font-mono)] text-[11px] text-[var(--ink-primary)] focus:border-amber-500 focus:outline-none disabled:opacity-50"
            >
              {VIDEO_MODEL_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>

            {savedCheckout && (
              <button
                type="button"
                onClick={() => {
                  setCheckoutError(null);
                  setPriceChangePrompt(null);
                  setModalCheckout(savedCheckout);
                  setCheckoutModalOpen(true);
                }}
                className="inline-flex items-center gap-1.5 rounded border border-emerald-500/40 bg-emerald-500/12 px-2.5 py-1 font-[family-name:var(--font-mono)] text-[11px] font-medium text-emerald-600 hover:bg-emerald-500/20 dark:text-emerald-300"
              >
                <ShoppingBag className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">
                  {savedCheckout.orderPlaced ? "Order Placed" : "Checkout"}
                </span>
              </button>
            )}

            <button
              type="button"
              onClick={() => setDiagnosticsOpen(true)}
              className="inline-flex items-center gap-1.5 rounded border border-[var(--border-subtle)] bg-[var(--bg-panel)] px-2.5 py-1 font-[family-name:var(--font-mono)] text-[11px] text-[var(--ink-secondary)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--ink-primary)]"
            >
              <Activity className="h-3.5 w-3.5 text-amber-500" />
              <span className="hidden sm:inline">Diagnostics</span>
              {promotedTopCount > 0 && (
                <span className="rounded bg-emerald-500/20 px-1.5 py-0.2 text-[10px] font-semibold text-emerald-500">
                  {promotedTopCount}↑
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={toggleTheme}
              aria-label={
                darkMode ? "Switch to light mode" : "Switch to dark mode"
              }
              className="rounded border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-1.5 text-[var(--ink-secondary)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--ink-primary)]"
            >
              {darkMode ? (
                <Sun className="h-3.5 w-3.5" />
              ) : (
                <Moon className="h-3.5 w-3.5" />
              )}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-5 px-4 py-5 sm:px-6">
        {/* Command Console */}
        <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-4 sm:p-5">
          <form onSubmit={handleTrace} className="space-y-3.5">
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
              <div className="lg:col-span-5">
                <div className="mb-1.5 flex items-center justify-between">
                  <label
                    htmlFor="youtube-url-input"
                    className="font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-wider text-[var(--ink-secondary)]"
                  >
                    Public YouTube URL
                  </label>
                  {liveUrlPreview && (
                    <span className="font-[family-name:var(--font-mono)] text-[10px] text-emerald-500">
                      READY · {liveUrlPreview.videoId}
                    </span>
                  )}
                </div>
                <input
                  id="youtube-url-input"
                  type="url"
                  required
                  value={youtubeUrl}
                  onChange={(e) => setYoutubeUrl(e.target.value)}
                  placeholder="https://www.youtube.com/watch?v=... or /shorts/..."
                  className="w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-sunken)] px-3 py-2.5 font-[family-name:var(--font-mono)] text-xs text-[var(--ink-primary)] placeholder:text-[var(--ink-muted)] focus:border-amber-500 focus:outline-none"
                />
              </div>

              <div className="lg:col-span-5">
                <div className="mb-1.5 flex items-center justify-between">
                  <label
                    htmlFor="shopper-question-input"
                    className="font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-wider text-[var(--ink-secondary)]"
                  >
                    What should SceneTrace find?
                  </label>
                  <span className="font-[family-name:var(--font-mono)] text-[10px] text-[var(--ink-muted)]">
                    Supports budget & size filters
                  </span>
                </div>
                <input
                  id="shopper-question-input"
                  type="text"
                  required
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  placeholder="e.g., Which sneakers and jacket is he wearing in size M?"
                  className="w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-sunken)] px-3 py-2.5 text-xs text-[var(--ink-primary)] placeholder:text-[var(--ink-muted)] focus:border-amber-500 focus:outline-none"
                />
              </div>

              <div className="flex items-end lg:col-span-2">
                <button
                  type="submit"
                  disabled={isRunning}
                  className="inline-flex h-[38px] w-full items-center justify-center gap-2 rounded-md bg-amber-500 px-4 text-xs font-semibold text-neutral-950 transition-colors hover:bg-amber-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isRunning ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      <span>Tracing…</span>
                    </>
                  ) : (
                    <>
                      <span>Trace items</span>
                      <ArrowRight className="h-3.5 w-3.5" />
                    </>
                  )}
                </button>
              </div>
            </div>

            <div className="flex flex-col justify-between gap-2.5 border-t border-[var(--border-subtle)] pt-3 lg:flex-row lg:items-center">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="mr-1 font-[family-name:var(--font-mono)] text-[10px] uppercase text-[var(--ink-muted)]">
                  Prompts:
                </span>
                {QUESTION_PRESETS.map((preset) => (
                  <button
                    key={preset.short}
                    type="button"
                    onClick={() => setQuestion(preset.text)}
                    className={`rounded border px-2 py-0.5 text-[11px] transition-colors ${
                      question === preset.text
                        ? "border-amber-500/45 bg-amber-500/12 text-amber-600 dark:text-amber-300"
                        : "border-[var(--border-subtle)] bg-[var(--bg-sunken)] text-[var(--ink-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--ink-primary)]"
                    }`}
                  >
                    {preset.short}
                  </button>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setManagedAgentEnabled((v) => !v)}
                  disabled={isRunning}
                  title="Runs our saved Gemini Managed Agent (v1beta/agents · environment=remote) with Google Search + Python sandbox code execution to verify SKUs, MSRP, and search queries."
                  className={`inline-flex items-center gap-1.5 rounded border px-2.5 py-1 font-[family-name:var(--font-mono)] text-[11px] transition-colors ${
                    managedAgentEnabled
                      ? "border-emerald-500/45 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300"
                      : "border-[var(--border-subtle)] bg-[var(--bg-sunken)] text-[var(--ink-muted)]"
                  }`}
                >
                  <Terminal className="h-3 w-3" />
                  <span>
                    Managed Agent: {managedAgentEnabled ? "ON" : "OFF"}
                  </span>
                </button>

                <input
                  ref={fileInputRef}
                  type="file"
                  accept="video/mp4,video/webm,video/quicktime,image/jpeg,image/png,image/webp"
                  onChange={(e) => {
                    const f = e.target.files?.[0] ?? null;
                    setCompanionFile(f);
                  }}
                  className="hidden"
                />
                {companionFile ? (
                  <div className="inline-flex items-center gap-1.5 rounded border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 font-[family-name:var(--font-mono)] text-[11px] text-amber-600 dark:text-amber-300">
                    <Paperclip className="h-3 w-3 shrink-0" />
                    <span className="max-w-[160px] truncate">
                      {companionFile.name}
                    </span>
                    <button
                      type="button"
                      aria-label="Remove companion file"
                      onClick={() => {
                        setCompanionFile(null);
                        if (fileInputRef.current) {
                          fileInputRef.current.value = "";
                        }
                      }}
                      className="ml-0.5 rounded p-0.5 hover:bg-amber-500/20"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    title="Optional: Attach your local source .mp4 or reference still so SceneTrace extracts crisp supporting frames and bounding-box crops in-browser."
                    className="inline-flex items-center gap-1.5 rounded border border-[var(--border-subtle)] bg-[var(--bg-sunken)] px-2.5 py-1 font-[family-name:var(--font-mono)] text-[11px] text-[var(--ink-secondary)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--ink-primary)]"
                  >
                    <Upload className="h-3 w-3 text-amber-500" />
                    <span>+ Source .mp4 / still</span>
                  </button>
                )}
              </div>
            </div>
          </form>

          {stage !== "idle" && (
            <div className="mt-3.5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-sunken)] px-3.5 py-2 font-[family-name:var(--font-mono)] text-[11px]">
              <div className="flex flex-wrap items-center gap-3">
                {[
                  {
                    id: "extract",
                    label: "01 EXTRACT",
                    done:
                      items.length > 0 ||
                      stage === "complete" ||
                      stage === "partial",
                    active: stage === "extracting",
                  },
                  {
                    id: "frames",
                    label: companionFile ? "02 FRAMES" : "02 SEEK",
                    done:
                      stage === "agent_investigating" ||
                      stage === "matching" ||
                      stage === "complete" ||
                      stage === "partial",
                    active: stage === "capturing_frames",
                  },
                  ...(managedAgentEnabled
                    ? [
                        {
                          id: "agent",
                          label: "03 MANAGED AGENT",
                          done:
                            stage === "matching" ||
                            stage === "complete" ||
                            stage === "partial",
                          active: stage === "agent_investigating",
                        },
                      ]
                    : []),
                  {
                    id: "shop_decisions",
                    label: managedAgentEnabled
                      ? "04 SHOP + DECISIONS"
                      : "03 SHOP + DECISIONS",
                    done: stage === "complete" || stage === "partial",
                    active: stage === "matching",
                  },
                ].map((step) => (
                  <span
                    key={step.id}
                    className={`inline-flex items-center gap-1.5 ${
                      step.active
                        ? "font-semibold text-amber-500"
                        : step.done
                          ? "text-emerald-500"
                          : "text-[var(--ink-muted)]"
                    }`}
                  >
                    {step.active ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : step.done ? (
                      <CheckCircle2 className="h-3 w-3" />
                    ) : (
                      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-45" />
                    )}
                    <span>{step.label}</span>
                  </span>
                ))}
              </div>

              <div className="flex items-center gap-2 text-[var(--ink-secondary)]">
                <Clock className="h-3 w-3" />
                <span>{(elapsedMs / 1000).toFixed(1)}s</span>
              </div>
            </div>
          )}

          {traceError && (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-500/40 bg-red-500/10 px-3.5 py-2.5 text-xs text-red-600 dark:text-red-300">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{traceError}</span>
              </div>
              <button
                type="button"
                onClick={() => handleTrace()}
                className="inline-flex items-center gap-1 rounded border border-red-500/40 bg-red-500/15 px-2.5 py-1 font-[family-name:var(--font-mono)] text-[11px] font-medium hover:bg-red-500/25"
              >
                <RefreshCw className="h-3 w-3" />
                Retry trace
              </button>
            </div>
          )}

          {frameWarning && (
            <div className="mt-2.5 rounded-md border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-300">
              {frameWarning}
            </div>
          )}
        </section>

        {/* Two-Pane Studio Workspace */}
        <section className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div className="lg:col-span-5">
            <div className="lg:sticky lg:top-16">
              <YouTubeMonitor
                videoId={activeVideoId}
                seekRequest={seekRequest}
                items={items}
                activeItemId={activeItemId}
                onSelectItemAndSeek={triggerSeek}
                onDurationDetected={(dur) => {
                  youtubeDurationRef.current = dur;
                }}
                framesByItem={framesByItem}
                hasCompanionMedia={Boolean(companionFile)}
              />
            </div>
          </div>

          <div className="space-y-5 lg:col-span-7">
            {extractDiagnostics?.videoSummary && (
              <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel)] px-4 py-3 text-xs text-[var(--ink-secondary)]">
                <span className="mr-2 font-[family-name:var(--font-mono)] text-[10px] uppercase tracking-wider text-amber-500">
                  Scene Summary
                </span>
                {extractDiagnostics.videoSummary}
              </div>
            )}

            {stage === "idle" && items.length === 0 && (
              <div className="studio-grid-bg flex min-h-[340px] flex-col justify-between rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-6">
                <div className="space-y-2">
                  <div className="font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-widest text-amber-500">
                    Video-to-Checkout Forensics
                  </div>
                  <h1 className="max-w-xl text-xl font-semibold tracking-tight text-[var(--ink-primary)] sm:text-2xl">
                    Trace products across cuts, investigate SKUs in a Managed
                    Agent sandbox, and check out on Shopify.
                  </h1>
                  <p className="max-w-xl text-xs leading-relaxed text-[var(--ink-secondary)]">
                    SceneTrace combines{" "}
                    <span className="font-medium text-[var(--ink-primary)]">
                      Gemini 4
                    </span>{" "}
                    video extraction, a persistent{" "}
                    <span className="font-medium text-[var(--ink-primary)]">
                      Gemini Managed Agent
                    </span>{" "}
                    remote sandbox, live{" "}
                    <span className="font-medium text-[var(--ink-primary)]">
                      Shop MCP
                    </span>{" "}
                    discovery, and calibrated{" "}
                    <span className="font-medium text-[var(--ink-primary)]">
                      Gemini Decisions
                    </span>{" "}
                    probability ranking.
                  </p>
                </div>

                <div className="mt-8 grid grid-cols-1 gap-3 border-t border-[var(--border-subtle)] pt-4 sm:grid-cols-2">
                  <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-sunken)] p-3">
                    <div className="font-[family-name:var(--font-mono)] text-[10px] text-amber-500">
                      01 · GEMINI 4 + CROPS
                    </div>
                    <p className="mt-1 text-xs font-medium text-[var(--ink-primary)]">
                      Cross-scene evidence
                    </p>
                    <p className="mt-0.5 text-[11px] text-[var(--ink-muted)]">
                      Links wide shots to close-ups and extracts bounding-box
                      crops.
                    </p>
                  </div>
                  <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-sunken)] p-3">
                    <div className="font-[family-name:var(--font-mono)] text-[10px] text-emerald-500">
                      02 · MANAGED AGENT SANDBOX
                    </div>
                    <p className="mt-1 text-xs font-medium text-[var(--ink-primary)]">
                      Autonomous SKU & MSRP research
                    </p>
                    <p className="mt-0.5 text-[11px] text-[var(--ink-muted)]">
                      Runs Google Search + Python inside a hosted Linux sandbox
                      with stateful follow-ups.
                    </p>
                  </div>
                  <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-sunken)] p-3">
                    <div className="font-[family-name:var(--font-mono)] text-[10px] text-amber-500">
                      03 · DECISIONS API
                    </div>
                    <p className="mt-1 text-xs font-medium text-[var(--ink-primary)]">
                      Calibrated reranking
                    </p>
                    <p className="mt-0.5 text-[11px] text-[var(--ink-muted)]">
                      Scores candidate variants with{" "}
                      <code className="font-[family-name:var(--font-mono)]">
                        gemini-decision-1
                      </code>{" "}
                      & hard-conflict gates.
                    </p>
                  </div>
                  <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-sunken)] p-3">
                    <div className="font-[family-name:var(--font-mono)] text-[10px] text-emerald-500">
                      04 · SHOP MCP CHECKOUT
                    </div>
                    <p className="mt-1 text-xs font-medium text-[var(--ink-primary)]">
                      End-to-end Shopify purchase
                    </p>
                    <p className="mt-0.5 text-[11px] text-[var(--ink-muted)]">
                      Supports live size selection, freshness checks, and real
                      merchant checkout.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {stage === "extracting" && items.length === 0 && (
              <div className="flex min-h-[280px] flex-col items-center justify-center gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-8 text-center">
                <Loader2 className="h-6 w-6 animate-spin text-amber-500" />
                <div className="text-sm font-medium text-[var(--ink-primary)]">
                  Analyzing video scenes with {videoModel}…
                </div>
                <p className="max-w-sm text-xs text-[var(--ink-muted)]">
                  Scanning visual frames, close-ups, captions, and audio to
                  isolate distinct products and best-evidence timestamps.
                </p>
              </div>
            )}

            {stage === "complete" && items.length === 0 && !traceError && (
              <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-8 text-center">
                <p className="text-sm font-semibold text-[var(--ink-primary)]">
                  No matching items detected in this clip
                </p>
                <p className="mx-auto mt-1 max-w-md text-xs text-[var(--ink-secondary)]">
                  Gemini 4 did not find shoppable objects matching “{question}”.
                  Try broadening your question or pasting another public YouTube
                  clip.
                </p>
              </div>
            )}

            {/* Traced Item Cards */}
            {items.map((item, itemIdx) => {
              const offers = offersByItem[item.itemId] ?? [];
              const isItemMatching = Boolean(matchingItemIds[item.itemId]);
              const isAgentRunning = Boolean(agentRunningByItem[item.itemId]);
              const agentReport = agentReportsByItem[item.itemId];
              const stepsExpanded = Boolean(expandedAgentSteps[item.itemId]);
              const followUpValue = agentFollowUpInputs[item.itemId] ?? "";
              const itemDiag = matchDiagnosticsByItem[item.itemId];
              const itemFrames = framesByItem[item.itemId] ?? [];
              const topRankShift =
                itemDiag?.rankComparison[0] &&
                itemDiag.rankComparison[0].originalRank > 1
                  ? itemDiag.rankComparison[0].originalRank
                  : null;

              return (
                <article
                  key={item.itemId}
                  onClick={() => setActiveItemId(item.itemId)}
                  className={`overflow-hidden rounded-xl border transition-colors ${
                    activeItemId === item.itemId
                      ? "border-[var(--border-strong)] bg-[var(--bg-panel)]"
                      : "border-[var(--border-subtle)] bg-[var(--bg-panel)]"
                  }`}
                >
                  {/* Item Dossier Header */}
                  <div className="border-b border-[var(--border-subtle)] p-4 sm:p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2 font-[family-name:var(--font-mono)] text-[10px] uppercase tracking-wider">
                          <span className="rounded border border-[var(--border-strong)] bg-[var(--bg-sunken)] px-1.5 py-0.5 text-[var(--ink-secondary)]">
                            ITEM {String(itemIdx + 1).padStart(2, "0")} ·{" "}
                            {item.category}
                          </span>
                          {item.brand ? (
                            <span className="rounded border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-emerald-600 dark:text-emerald-300">
                              BRAND · {item.brand}
                            </span>
                          ) : (
                            <span className="rounded border border-[var(--border-subtle)] px-1.5 py-0.5 text-[var(--ink-muted)]">
                              BRAND UNCONFIRMED
                            </span>
                          )}
                          {item.modelReference && (
                            <span className="rounded border border-amber-500/35 bg-amber-500/10 px-1.5 py-0.5 text-amber-600 dark:text-amber-300">
                              REF · {item.modelReference}
                            </span>
                          )}
                        </div>
                        <h2 className="text-base font-semibold text-[var(--ink-primary)] sm:text-lg">
                          {item.label}
                        </h2>
                      </div>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          triggerSeek(item.itemId, item.bestEvidenceSec);
                        }}
                        className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/45 bg-amber-500/12 px-3 py-1.5 font-[family-name:var(--font-mono)] text-xs font-medium text-amber-600 transition-colors hover:bg-amber-500/25 dark:text-amber-300"
                      >
                        <Play className="h-3 w-3 fill-current" />
                        <span>
                          See evidence @ {formatTimestamp(item.bestEvidenceSec)}
                        </span>
                      </button>
                    </div>

                    <p className="mt-2 text-xs leading-relaxed text-[var(--ink-secondary)]">
                      {item.summary}
                    </p>

                    {itemFrames.length > 0 && (
                      <div className="mt-3 flex items-center gap-2 overflow-x-auto pb-1">
                        {itemFrames.map((fr, fIdx) => (
                          <button
                            key={`${item.itemId}_inline_${fIdx}`}
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (fr.atSec !== null) {
                                triggerSeek(item.itemId, fr.atSec);
                              }
                            }}
                            className="group relative shrink-0 overflow-hidden rounded border border-[var(--border-subtle)] bg-black"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={fr.dataUrl}
                              alt={fr.label}
                              className="h-16 w-28 object-cover transition-opacity group-hover:opacity-90"
                            />
                            <span className="absolute bottom-1 left-1 rounded bg-black/80 px-1.5 py-0.5 font-[family-name:var(--font-mono)] text-[9px] text-amber-300">
                              {fr.kind === "uploaded_still"
                                ? "REF PHOTO"
                                : fr.kind === "video_crop"
                                  ? `CROP ${fr.atSec !== null ? formatTimestamp(fr.atSec) : ""}`
                                  : `SCENE ${fr.atSec !== null ? formatTimestamp(fr.atSec) : ""}`}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}

                    {item.features.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {item.features.slice(0, 6).map((feat, fIdx) => (
                          <button
                            key={`${item.itemId}_feat_${fIdx}`}
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              triggerSeek(item.itemId, feat.atSec);
                            }}
                            className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] transition-opacity hover:opacity-85 ${sourceBadgeClasses(feat.source)}`}
                          >
                            <span className="font-[family-name:var(--font-mono)] text-[9px] uppercase opacity-75">
                              {feat.source}
                            </span>
                            <span className="font-medium">{feat.value}</span>
                            <span className="font-[family-name:var(--font-mono)] text-[10px] opacity-70">
                              @{formatTimestamp(feat.atSec)}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}

                    {/* Gemini Managed Agent Remote Sandbox Console */}
                    <div
                      onClick={(e) => e.stopPropagation()}
                      className="mt-4 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-sunken)] p-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2 font-[family-name:var(--font-mono)] text-[10px] uppercase tracking-wider">
                          <Terminal className="h-3.5 w-3.5 text-emerald-500" />
                          <span className="font-semibold text-[var(--ink-primary)]">
                            Gemini Managed Agent
                          </span>
                          {agentReport?.environmentId && (
                            <span className="text-[var(--ink-muted)]">
                              · sandbox {agentReport.environmentId.slice(0, 8)}
                            </span>
                          )}
                          {agentReport?.msrpEstimate && (
                            <span className="rounded border border-amber-500/35 bg-amber-500/10 px-1.5 py-0.5 text-amber-600 dark:text-amber-300">
                              MSRP {agentReport.msrpEstimate}
                            </span>
                          )}
                        </div>

                        {isAgentRunning ? (
                          <span className="inline-flex items-center gap-1.5 font-[family-name:var(--font-mono)] text-[10px] text-amber-500">
                            <Loader2 className="h-3 w-3 animate-spin" />
                            Executing in remote Linux sandbox…
                          </span>
                        ) : agentReport ? (
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedAgentSteps((prev) => ({
                                ...prev,
                                [item.itemId]: !prev[item.itemId],
                              }))
                            }
                            className="inline-flex items-center gap-1 font-[family-name:var(--font-mono)] text-[10px] text-[var(--ink-secondary)] hover:text-[var(--ink-primary)]"
                          >
                            <span>
                              {agentReport.steps.length} sandbox{" "}
                              {agentReport.steps.length === 1
                                ? "step"
                                : "steps"}
                            </span>
                            {stepsExpanded ? (
                              <ChevronUp className="h-3 w-3" />
                            ) : (
                              <ChevronDown className="h-3 w-3" />
                            )}
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() =>
                              runAgentForItem({
                                targetItem: item,
                                baseQuestion: question.trim(),
                                primaryFrame: itemFrames[0] ?? null,
                                reRunMatchAfter: true,
                              })
                            }
                            className="rounded border border-emerald-500/40 bg-emerald-500/12 px-2 py-0.5 font-[family-name:var(--font-mono)] text-[10px] font-medium text-emerald-600 hover:bg-emerald-500/20 dark:text-emerald-300"
                          >
                            Investigate in Sandbox
                          </button>
                        )}
                      </div>

                      {agentReport && (
                        <>
                          <p className="mt-2 text-xs leading-relaxed text-[var(--ink-secondary)]">
                            {agentReport.buyingBrief}
                          </p>

                          {stepsExpanded && agentReport.steps.length > 0 && (
                            <div className="mt-2.5 space-y-1.5 rounded border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-2.5 font-[family-name:var(--font-mono)] text-[10px]">
                              {agentReport.steps.map((st) => (
                                <div key={st.stepIndex}>
                                  <div className="text-emerald-500">
                                    [{st.stepIndex}] {st.summary}
                                  </div>
                                  {st.detail && (
                                    <pre className="mt-0.5 overflow-x-auto whitespace-pre-wrap text-[var(--ink-muted)]">
                                      {st.detail}
                                    </pre>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}

                          <div className="mt-2.5 flex gap-2">
                            <input
                              type="text"
                              value={followUpValue}
                              onChange={(e) =>
                                setAgentFollowUpInputs((prev) => ({
                                  ...prev,
                                  [item.itemId]: e.target.value,
                                }))
                              }
                              onKeyDown={(e) => {
                                if (
                                  e.key === "Enter" &&
                                  followUpValue.trim() &&
                                  !isAgentRunning
                                ) {
                                  e.preventDefault();
                                  const promptToRun = followUpValue.trim();
                                  setAgentFollowUpInputs((prev) => ({
                                    ...prev,
                                    [item.itemId]: "",
                                  }));
                                  runAgentForItem({
                                    targetItem: item,
                                    baseQuestion: question.trim(),
                                    followUpPrompt: promptToRun,
                                    previousInteractionId:
                                      agentReport.interactionId,
                                    reRunMatchAfter: true,
                                  });
                                }
                              }}
                              placeholder="Ask sandbox agent to refine (e.g., 'find similar under $35', 'check sizing')…"
                              className="flex-1 rounded border border-[var(--border-subtle)] bg-[var(--bg-panel)] px-2.5 py-1.5 text-[11px] text-[var(--ink-primary)] placeholder:text-[var(--ink-muted)] focus:border-amber-500 focus:outline-none"
                            />
                            <button
                              type="button"
                              disabled={!followUpValue.trim() || isAgentRunning}
                              onClick={() => {
                                const promptToRun = followUpValue.trim();
                                if (!promptToRun) return;
                                setAgentFollowUpInputs((prev) => ({
                                  ...prev,
                                  [item.itemId]: "",
                                }));
                                runAgentForItem({
                                  targetItem: item,
                                  baseQuestion: question.trim(),
                                  followUpPrompt: promptToRun,
                                  previousInteractionId:
                                    agentReport.interactionId,
                                  reRunMatchAfter: true,
                                });
                              }}
                              className="inline-flex items-center gap-1 rounded border border-[var(--border-strong)] bg-[var(--bg-panel)] px-2.5 py-1.5 font-[family-name:var(--font-mono)] text-[10px] font-medium text-[var(--ink-primary)] hover:border-amber-500/50 disabled:opacity-45"
                            >
                              <Send className="h-3 w-3 text-amber-500" />
                              <span>Refine</span>
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Ranked Shopify Offers Section */}
                  <div className="bg-[var(--bg-sunken)]/60 p-4 sm:p-5">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-wider text-[var(--ink-secondary)]">
                        <span>Ranked Shopify Offers</span>
                        {!isItemMatching && (
                          <span className="text-[var(--ink-muted)]">
                            ({offers.length})
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        {topRankShift && (
                          <span className="inline-flex items-center gap-1 rounded border border-emerald-500/40 bg-emerald-500/12 px-2 py-0.5 font-[family-name:var(--font-mono)] text-[10px] font-semibold text-emerald-600 dark:text-emerald-300">
                            <ArrowUpRight className="h-3 w-3" />
                            Decisions promoted Shop #{topRankShift} → #1
                          </span>
                        )}
                        {itemDiag?.usedVisualSearch && (
                          <span className="inline-flex items-center gap-1 rounded border border-[var(--border-subtle)] bg-[var(--bg-panel)] px-2 py-0.5 font-[family-name:var(--font-mono)] text-[10px] text-[var(--ink-secondary)]">
                            <Film className="h-3 w-3 text-amber-500" />
                            Visual + Text Search
                          </span>
                        )}
                      </div>
                    </div>

                    {(isItemMatching ||
                      (stage === "agent_investigating" &&
                        offers.length === 0)) && (
                      <div className="flex items-center gap-2.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-4 text-xs text-[var(--ink-secondary)]">
                        <Loader2 className="h-4 w-4 animate-spin text-amber-500" />
                        <span>
                          {stage === "agent_investigating"
                            ? "Enriching SKU & retail queries in Managed Agent sandbox before catalog search…"
                            : "Querying Shop MCP catalog & scoring variants with gemini-decision-1…"}
                        </span>
                      </div>
                    )}

                    {!isItemMatching && itemDiag?.shopError && (
                      <div className="rounded-lg border border-red-500/35 bg-red-500/10 p-3.5 text-xs text-red-500 dark:text-red-300">
                        Catalog search failed for this item:{" "}
                        {itemDiag.shopError}
                      </div>
                    )}

                    {!isItemMatching &&
                      stage !== "agent_investigating" &&
                      !itemDiag?.shopError &&
                      offers.length === 0 && (
                        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-4 text-xs text-[var(--ink-muted)]">
                          No in-stock Shopify catalog offers matched this item
                          in {defaultCountry}. Use the Managed Agent bar above
                          to broaden or refine the search.
                        </div>
                      )}

                    {!isItemMatching && offers.length > 0 && (
                      <div className="space-y-3">
                        {offers.map((offer, offerIdx) => {
                          const badge = matchBadgeMeta(offer.matchLabel);
                          const isBuyingThis = buyingOfferId === offer.offerId;
                          const isSelectingThis =
                            selectingVariantOfferId === offer.offerId;
                          const isUnavailable =
                            offer.availability === "unavailable";
                          const variantErr =
                            variantSelectErrorByOffer[offer.offerId];

                          return (
                            <div
                              key={offer.offerId}
                              className={`rounded-lg border bg-[var(--bg-panel)] p-3.5 transition-colors ${
                                offerIdx === 0 &&
                                offer.matchLabel === "exact_supported"
                                  ? "border-emerald-500/45"
                                  : "border-[var(--border-subtle)] hover:border-[var(--border-strong)]"
                              }`}
                            >
                              <div className="flex flex-col gap-3.5 sm:flex-row">
                                <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-md border border-[var(--border-subtle)] bg-[var(--bg-sunken)]">
                                  {offer.imageUrl ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img
                                      src={offer.imageUrl}
                                      alt={offer.title}
                                      className="h-full w-full object-cover"
                                    />
                                  ) : (
                                    <div className="flex h-full w-full items-center justify-center font-[family-name:var(--font-mono)] text-[10px] text-[var(--ink-muted)]">
                                      NO IMG
                                    </div>
                                  )}
                                  <span className="absolute bottom-1 left-1 rounded bg-black/75 px-1 py-0.5 font-[family-name:var(--font-mono)] text-[8px] uppercase tracking-wider text-neutral-200">
                                    LISTING
                                  </span>
                                </div>

                                <div className="min-w-0 flex-1 space-y-2">
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <div className="flex flex-wrap items-center gap-1.5">
                                      <span
                                        className={`rounded border px-2 py-0.5 font-[family-name:var(--font-mono)] text-[10px] font-medium ${badge.classes}`}
                                      >
                                        {badge.text}
                                      </span>
                                      <span className="font-[family-name:var(--font-mono)] text-[10px] text-[var(--ink-muted)]">
                                        #{offerIdx + 1} (Shop #
                                        {offer.originalSearchRank})
                                      </span>
                                    </div>

                                    <div className="font-[family-name:var(--font-mono)] text-sm font-bold text-[var(--ink-primary)]">
                                      {formatMoneyMinor(
                                        offer.amountMinor,
                                        offer.currency,
                                      )}
                                    </div>
                                  </div>

                                  <div>
                                    <h3 className="text-sm font-semibold text-[var(--ink-primary)]">
                                      {offer.title}
                                    </h3>
                                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-[var(--ink-secondary)]">
                                      <span className="font-medium">
                                        {offer.sellerName}
                                      </span>
                                      <span className="font-[family-name:var(--font-mono)] text-[11px] text-[var(--ink-muted)]">
                                        ({offer.sellerDomain})
                                      </span>
                                      <span
                                        className={`font-[family-name:var(--font-mono)] text-[10px] uppercase ${
                                          offer.availability === "available"
                                            ? "text-emerald-500"
                                            : offer.availability ===
                                                "unavailable"
                                              ? "text-red-400"
                                              : "text-[var(--ink-muted)]"
                                        }`}
                                      >
                                        ·{" "}
                                        {offer.availability === "available"
                                          ? "In stock"
                                          : offer.availability === "unavailable"
                                            ? "Sold out"
                                            : "Availability at checkout"}
                                      </span>
                                    </div>
                                  </div>

                                  {/* Interactive Variant / Size Option Selector when multi-option groups exist */}
                                  {offer.availableOptions &&
                                  offer.availableOptions.length > 0 ? (
                                    <div className="flex flex-wrap items-center gap-2">
                                      {offer.availableOptions.map((group) => {
                                        const currentVal =
                                          offer.options.find(
                                            (o) =>
                                              o.name.toLowerCase() ===
                                              group.name.toLowerCase(),
                                          )?.label ??
                                          group.values[0] ??
                                          "";
                                        return (
                                          <label
                                            key={`${offer.offerId}_grp_${group.name}`}
                                            className="inline-flex items-center gap-1.5 rounded border border-[var(--border-subtle)] bg-[var(--bg-sunken)] px-2 py-0.5 font-[family-name:var(--font-mono)] text-[10px] text-[var(--ink-secondary)]"
                                          >
                                            <span>{group.name}:</span>
                                            <select
                                              value={currentVal}
                                              disabled={isSelectingThis}
                                              onChange={(e) =>
                                                handleSelectVariantOption({
                                                  item,
                                                  offer,
                                                  optionName: group.name,
                                                  optionValue: e.target.value,
                                                })
                                              }
                                              className="bg-transparent font-semibold text-[var(--ink-primary)] focus:outline-none"
                                            >
                                              {group.values.map((val) => (
                                                <option key={val} value={val}>
                                                  {val}
                                                </option>
                                              ))}
                                            </select>
                                          </label>
                                        );
                                      })}
                                      {isSelectingThis && (
                                        <Loader2 className="h-3 w-3 animate-spin text-amber-500" />
                                      )}
                                    </div>
                                  ) : (
                                    offer.options.length > 0 && (
                                      <div className="flex flex-wrap gap-1.5">
                                        {offer.options.map((opt) => (
                                          <span
                                            key={`${offer.offerId}_${opt.name}_${opt.label}`}
                                            className="rounded border border-[var(--border-subtle)] bg-[var(--bg-sunken)] px-2 py-0.5 font-[family-name:var(--font-mono)] text-[10px] text-[var(--ink-secondary)]"
                                          >
                                            {opt.name}: {opt.label}
                                          </span>
                                        ))}
                                      </div>
                                    )
                                  )}

                                  {variantErr && (
                                    <p className="text-[11px] text-amber-500">
                                      {variantErr}
                                    </p>
                                  )}

                                  <p className="text-xs leading-relaxed text-[var(--ink-secondary)]">
                                    {offer.rationale}
                                  </p>

                                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                                    <a
                                      href={offer.productUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="inline-flex items-center gap-1 font-[family-name:var(--font-mono)] text-[11px] text-[var(--ink-secondary)] hover:text-amber-500"
                                    >
                                      <span>View merchant listing</span>
                                      <ExternalLink className="h-3 w-3" />
                                    </a>

                                    <button
                                      type="button"
                                      disabled={
                                        isUnavailable ||
                                        isSelectingThis ||
                                        Boolean(buyingOfferId)
                                      }
                                      onClick={() =>
                                        executeCheckout({
                                          offerId: offer.offerId,
                                          offerToken: offer.offerToken,
                                          offerTitle: offer.title,
                                          sellerName: offer.sellerName,
                                        })
                                      }
                                      className="inline-flex items-center gap-1.5 rounded-md bg-emerald-500 px-3.5 py-1.5 text-xs font-semibold text-neutral-950 transition-colors hover:bg-emerald-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:cursor-not-allowed disabled:opacity-45"
                                    >
                                      {isBuyingThis ? (
                                        <>
                                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                          <span>Preparing…</span>
                                        </>
                                      ) : (
                                        <>
                                          <ShoppingBag className="h-3.5 w-3.5" />
                                          <span>Buy on Shopify</span>
                                        </>
                                      )}
                                    </button>
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      </main>

      {/* Checkout Handoff & Order Status Modal */}
      <CheckoutModal
        open={checkoutModalOpen}
        onClose={() => setCheckoutModalOpen(false)}
        loading={checkoutLoading}
        error={checkoutError}
        checkout={modalCheckout}
        priceChangePrompt={priceChangePrompt}
        onConfirmPriceChange={() => {
          if (!priceChangePrompt) return;
          // Submitting `updatedOfferToken` through normal verification compares against the newly
          // approved price — so a second price jump still prompts again rather than bypassing!
          executeCheckout({
            offerId: "price_confirm",
            offerToken: priceChangePrompt.change.updatedOfferToken,
            offerTitle: priceChangePrompt.offerTitle,
            sellerName: priceChangePrompt.sellerName,
          });
        }}
        onRefreshStatus={handleRefreshCheckoutStatus}
        refreshingStatus={refreshingCheckoutStatus}
      />

      {/* Judge Diagnostics & Rerank Proof Drawer */}
      <DiagnosticsDrawer
        open={diagnosticsOpen}
        onClose={() => setDiagnosticsOpen(false)}
        traceId={traceId}
        extractDiagnostics={extractDiagnostics}
        items={items}
        agentReportsByItem={agentReportsByItem}
        matchDiagnosticsByItem={matchDiagnosticsByItem}
      />
    </div>
  );
}
