"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Clock,
  Loader2,
  RefreshCw,
  SlidersHorizontal,
  Zap,
} from "lucide-react";
import { CheckoutModal } from "@/components/CheckoutModal";
import { DiagnosticsDrawer } from "@/components/DiagnosticsDrawer";
import { HomeStage, type TraceInputSource } from "@/components/HomeStage";
import { ItemDossierCard } from "@/components/ItemDossierCard";
import { RepairPanel } from "@/components/RepairPanel";
import { VoiceBar } from "@/components/VoiceBar";
import { StudioNavbar } from "@/components/StudioNavbar";
import { YouTubeMonitor } from "@/components/YouTubeMonitor";
import {
  makeClientTraceCacheKey,
  readClientTraceCache,
  writeClientTraceCache,
} from "@/lib/cache/client-cache";
import type { AllowedVideoModel } from "@/lib/env";
import {
  appendCheckoutEventToTrace,
  readStoredTraceHistory,
  upsertStoredTraceRecord,
  type StoredTraceRecord,
  type TraceWaterfallSpan,
} from "@/lib/telemetry/trace-history";
import type {
  CheckoutPriceChange,
  CheckoutSummary,
  EvidenceFrame,
  ExtractDiagnostics,
  ExtractResponse,
  ItemMatchDiagnostics,
  ManagedAgentReport,
  MatchItemResponse,
  Offer,
  OfferOption,
  TracedItem,
} from "@/lib/types";
import {
  extractFramesFromCompanionVideo,
  readCompanionStillImage,
  readFileAsBase64,
} from "@/lib/video/frames-client";
import type { RepairVerdict } from "@/lib/repair/types";
import {
  dispatchVoiceIntent,
  refinementPhrase,
  type VoiceActions,
} from "@/lib/voice/actions";
import type { VoiceContext, VoiceIntent, VoiceSlots } from "@/lib/voice/types";
import {
  parseAndNormalizeYouTubeUrl,
  type NormalizedYouTubeVideo,
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
  const [inputSource, setInputSource] = useState<TraceInputSource>("youtube");
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [question, setQuestion] = useState("");
  const [videoModel, setVideoModel] =
    useState<AllowedVideoModel>(defaultVideoModel);
  const [managedAgentEnabled, setManagedAgentEnabled] = useState(true);
  const [companionFile, setCompanionFile] = useState<File | null>(null);
  const [editQueryExpanded, setEditQueryExpanded] = useState(false);
  const [itemFilterId, setItemFilterId] = useState<string>("all");
  const youtubeDurationRef = useRef<number | null>(null);

  const idempotencyByTokenRef = useRef<Map<string, string>>(new Map());

  // Pipeline state
  const [stage, setStage] = useState<PipelineStage>("idle");
  const [stageAnnouncement, setStageAnnouncement] = useState("");
  const [traceError, setTraceError] = useState<string | null>(null);
  const [frameWarning, setFrameWarning] = useState<string | null>(null);
  const [servedFromCache, setServedFromCache] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const activeRunIdRef = useRef(0);

  // Trace data
  const [traceId, setTraceId] = useState<string | null>(null);
  const [activeVideoId, setActiveVideoId] = useState<string | null>(null);
  // Set only for camera traces; stands in for the YouTube player in the results view.
  const [cameraStill, setCameraStill] = useState<EvidenceFrame | null>(null);
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
  const [traceHistory, setTraceHistory] = useState<StoredTraceRecord[]>([]);

  // Modals & Drawers
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
    setTraceHistory(readStoredTraceHistory());
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

  const handleGoHome = useCallback(() => {
    activeRunIdRef.current++;
    setStage("idle");
    setYoutubeUrl("");
    setQuestion("");
    setCompanionFile(null);
    setTraceError(null);
    setFrameWarning(null);
    setServedFromCache(false);
    setItems([]);
    setTraceId(null);
    setActiveVideoId(null);
    setCameraStill(null);
    setActiveItemId(null);
    setItemFilterId("all");
    setEditQueryExpanded(false);
    setFramesByItem({});
    setAgentReportsByItem({});
    setOffersByItem({});
    setMatchDiagnosticsByItem({});
    setExtractDiagnostics(null);
    setElapsedMs(0);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const handleChangeInputSource = (next: TraceInputSource) => {
    if (next === inputSource) return;
    // The companion slot holds the camera still in camera mode; never carry it across.
    setCompanionFile(null);
    setTraceError(null);
    setInputSource(next);
  };

  const liveUrlPreview = useMemo(() => {
    if (!youtubeUrl.trim()) return null;
    try {
      return parseAndNormalizeYouTubeUrl(youtubeUrl);
    } catch {
      return null;
    }
  }, [youtubeUrl]);

  const triggerSeek = useCallback((itemId: string, seconds: number) => {
    setActiveItemId(itemId);
    setSeekRequest({ seconds, nonce: Date.now() + Math.random() });
  }, []);

  const matchSingleItem = useCallback(
    async (params: {
      activeTraceId: string;
      targetItem: TracedItem;
      itemFrames: EvidenceFrame[];
      bypassCache?: boolean;
      runId?: number;
    }): Promise<{
      hadError: boolean;
      offers: Offer[];
      diagnostics: ItemMatchDiagnostics | null;
      cacheHit: boolean;
    }> => {
      const { activeTraceId, targetItem, itemFrames, bypassCache, runId } =
        params;
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
            bypassCache: Boolean(bypassCache),
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
          return {
            hadError: false,
            offers: [],
            diagnostics: null,
            cacheHit: false,
          };
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
          return {
            hadError: Boolean(
              !matchJson.diagnostics.shopLive ||
                matchJson.diagnostics.rankingError,
            ),
            offers: matchJson.offers,
            diagnostics: matchJson.diagnostics,
            cacheHit: Boolean(matchJson.diagnostics.cacheHit),
          };
        } else {
          const fallbackDiag: ItemMatchDiagnostics = {
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
          };
          setOffersByItem((prev) => ({ ...prev, [targetItem.itemId]: [] }));
          setMatchDiagnosticsByItem((prev) => ({
            ...prev,
            [targetItem.itemId]: fallbackDiag,
          }));
          return {
            hadError: true,
            offers: [],
            diagnostics: fallbackDiag,
            cacheHit: false,
          };
        }
      } catch (err) {
        const netDiag: ItemMatchDiagnostics = {
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
        };
        if (runId === undefined || runId === activeRunIdRef.current) {
          setMatchDiagnosticsByItem((prev) => ({
            ...prev,
            [targetItem.itemId]: netDiag,
          }));
        }
        return {
          hadError: true,
          offers: [],
          diagnostics: netDiag,
          cacheHit: false,
        };
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
      bypassCache?: boolean;
      reRunMatchAfter?: boolean;
    }): Promise<{
      updatedItem: TracedItem;
      report: ManagedAgentReport | null;
    }> => {
      const {
        targetItem,
        baseQuestion,
        followUpPrompt,
        previousInteractionId,
        primaryFrame,
        bypassCache,
        reRunMatchAfter,
      } = params;

      setAgentRunningByItem((prev) => ({ ...prev, [targetItem.itemId]: true }));

      try {
        const res = await fetch("/api/traces/agent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            traceId: traceId ?? undefined,
            question: baseQuestion,
            followUpPrompt,
            previousInteractionId,
            bypassCache: Boolean(bypassCache),
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
              bypassCache: Boolean(followUpPrompt) || Boolean(bypassCache),
            });
          }

          return { updatedItem: data.updatedItem, report: data.report };
        }
      } catch {
        // Keep extracted item intact if sandbox times out
      } finally {
        setAgentRunningByItem((prev) => ({
          ...prev,
          [targetItem.itemId]: false,
        }));
      }

      return { updatedItem: targetItem, report: null };
    },
    [framesByItem, matchSingleItem, traceId],
  );

  const handleTrace = async (override?: {
    url?: string;
    question?: string;
    bypassCache?: boolean;
  }) => {
    const targetUrl = override?.url ?? youtubeUrl;
    const targetQuestion = override?.question ?? question;
    const bypassCache = Boolean(override?.bypassCache);
    // Showcase clicks pass their own URL, so they always take the YouTube path.
    const useCamera = inputSource === "camera" && !override?.url;
    const attachedFile =
      inputSource === "camera" && !useCamera ? null : companionFile;

    setTraceError(null);
    setFrameWarning(null);
    setServedFromCache(false);
    setEditQueryExpanded(false);
    setItemFilterId("all");

    let normalized: NormalizedYouTubeVideo | null = null;
    if (useCamera) {
      if (!attachedFile || !attachedFile.type.startsWith("image/")) {
        setTraceError("Capture a photo with your camera before tracing.");
        return;
      }
    } else {
      try {
        normalized = parseAndNormalizeYouTubeUrl(targetUrl);
      } catch (err) {
        setTraceError(
          err instanceof Error ? err.message : "Invalid YouTube URL.",
        );
        return;
      }
    }

    if (targetQuestion.trim().length < 3) {
      setTraceError("Enter a question describing which items to trace.");
      return;
    }

    const companionSig = attachedFile
      ? `${attachedFile.name}:${attachedFile.size}:${attachedFile.lastModified}`
      : "none";
    const clientCacheKey = normalized
      ? makeClientTraceCacheKey({
          videoId: normalized.videoId,
          question: targetQuestion,
          videoModel,
          managedAgentEnabled,
          companionSignature: companionSig,
        })
      : null;

    // Instant client-side cache fast path (<15ms) when repeating an identical URL+question run
    if (normalized && clientCacheKey && !bypassCache && !attachedFile) {
      const hit = readClientTraceCache(clientCacheKey);
      if (hit) {
        activeRunIdRef.current++;
        setActiveVideoId(normalized.videoId);
        setCameraStill(null);
        setTraceId(hit.traceId);
        setItems(hit.items);
        setExtractDiagnostics({ ...hit.extractDiagnostics, cacheHit: true });
        setAgentReportsByItem(hit.agentReportsByItem);
        setOffersByItem(hit.offersByItem);
        setMatchDiagnosticsByItem(hit.matchDiagnosticsByItem);
        setFramesByItem({});
        setServedFromCache(true);
        setElapsedMs(10);
        setStage("complete");
        if (hit.items[0]) {
          setActiveItemId(hit.items[0].itemId);
          setSeekRequest({
            seconds: hit.items[0].bestEvidenceSec,
            nonce: Date.now(),
          });
        }
        setStageAnnouncement("Loaded instant cached trace.");
        return;
      }
    }

    // Camera: decode the still once for display/evidence and read raw bytes for extraction.
    let cameraFrame: EvidenceFrame | null = null;
    let cameraBase64 = "";
    if (useCamera && attachedFile) {
      try {
        const [still, base64] = await Promise.all([
          readCompanionStillImage(attachedFile),
          readFileAsBase64(attachedFile),
        ]);
        cameraFrame = { ...still, label: "Camera capture" };
        cameraBase64 = base64;
      } catch (err) {
        setTraceError(
          err instanceof Error ? err.message : "Could not read camera capture.",
        );
        return;
      }
    }

    const runId = ++activeRunIdRef.current;
    const nextVideoId = normalized?.videoId ?? null;
    if (activeVideoId !== nextVideoId) {
      youtubeDurationRef.current = null;
      setActiveVideoId(nextVideoId);
    }
    setCameraStill(cameraFrame);
    setElapsedMs(0);
    setStage("extracting");
    setStageAnnouncement(
      useCamera
        ? "Analyzing camera still with Gemini 4…"
        : "Analyzing video scenes with Gemini 4…",
    );
    setItems([]);
    setFramesByItem({});
    setAgentReportsByItem({});
    setOffersByItem({});
    setMatchDiagnosticsByItem({});
    setExtractDiagnostics(null);

    let anyStageHitCache = false;

    try {
      const extractRes = await fetch(
        useCamera ? "/api/traces/extract-image" : "/api/traces/extract",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...(useCamera
              ? { imageBase64: cameraBase64, mimeType: attachedFile?.type }
              : { youtubeUrl: normalized?.canonicalUrl }),
            question: targetQuestion.trim(),
            videoModel,
            bypassCache,
          }),
        },
      );

      const extractJson = (await extractRes.json()) as
        | ExtractResponse
        | { error?: string };

      if (runId !== activeRunIdRef.current) return;

      if (!extractRes.ok || !("items" in extractJson)) {
        const msg =
          ("error" in extractJson && extractJson.error) ||
          `${useCamera ? "Photo" : "Video"} analysis failed (${extractRes.status}).`;
        setStage("failed");
        setTraceError(msg);
        setStageAnnouncement(`Analysis failed: ${msg}`);
        return;
      }

      if (extractJson.diagnostics.cacheHit) anyStageHitCache = true;
      setTraceId(extractJson.traceId);
      setItems(extractJson.items);
      setExtractDiagnostics(extractJson.diagnostics);

      if (extractJson.items.length === 0) {
        setServedFromCache(anyStageHitCache);
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

      let capturedFramesMap: Record<string, EvidenceFrame[]> = {};
      if (attachedFile) {
        setStage("capturing_frames");
        setStageAnnouncement("Capturing supporting frames from attached media…");
        try {
          if (cameraFrame) {
            // Every item was found in this one photo, so it is evidence for all of them.
            for (const it of extractJson.items) {
              capturedFramesMap[it.itemId] = [cameraFrame];
            }
          } else if (attachedFile.type.startsWith("image/")) {
            const singleStill = await readCompanionStillImage(attachedFile);
            capturedFramesMap[firstItem.itemId] = [singleStill];
            if (extractJson.items.length > 1) {
              setFrameWarning(
                `Reference photo associated with "${firstItem.label}" (unmapped to video timestamps).`,
              );
            }
          } else {
            const captureResult = await extractFramesFromCompanionVideo(
              attachedFile,
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

      let workingItems = [...extractJson.items];
      const collectedAgentReports: Record<string, ManagedAgentReport> = {};

      if (managedAgentEnabled) {
        setStage("agent_investigating");
        setStageAnnouncement(
          "Researching SKUs and price benchmarks in Managed Agent sandbox…",
        );

        const enriched = await Promise.all(
          workingItems.map((it) =>
            runAgentForItem({
              targetItem: it,
              baseQuestion: targetQuestion.trim(),
              primaryFrame: capturedFramesMap[it.itemId]?.[0] ?? null,
              bypassCache,
              reRunMatchAfter: false,
            }),
          ),
        );
        if (runId !== activeRunIdRef.current) return;
        workingItems = enriched.map((e) => {
          if (e.report) {
            collectedAgentReports[e.updatedItem.itemId] = e.report;
            if (e.report.cacheHit) anyStageHitCache = true;
          }
          return e.updatedItem;
        });
      }

      setStage("matching");
      setStageAnnouncement(
        "Searching Shopify catalog and scoring matches with Gemini Decisions…",
      );

      let hadAnyError = false;
      const collectedOffers: Record<string, Offer[]> = {};
      const collectedDiags: Record<string, ItemMatchDiagnostics> = {};
      const queue = [...workingItems];

      const workers = Array.from({
        length: Math.min(3, queue.length),
      }).map(async () => {
        while (queue.length > 0) {
          const currentItem = queue.shift();
          if (!currentItem) break;
          const matchOut = await matchSingleItem({
            activeTraceId: extractJson.traceId,
            targetItem: currentItem,
            itemFrames: capturedFramesMap[currentItem.itemId] ?? [],
            bypassCache,
            runId,
          });
          if (matchOut.hadError) hadAnyError = true;
          if (matchOut.cacheHit) anyStageHitCache = true;
          collectedOffers[currentItem.itemId] = matchOut.offers;
          if (matchOut.diagnostics) {
            collectedDiags[currentItem.itemId] = matchOut.diagnostics;
          }
        }
      });

      await Promise.all(workers);
      if (runId !== activeRunIdRef.current) return;

      setServedFromCache(anyStageHitCache);
      setStage(hadAnyError ? "partial" : "complete");
      setStageAnnouncement(
        hadAnyError
          ? "Trace finished with partial provider warnings."
          : "Trace complete — offers ranked by Gemini Decisions.",
      );

      const traceTotalMs =
        extractJson.diagnostics.durationMs +
        Math.max(
          0,
          ...Object.values(collectedAgentReports).map((r) => r.durationMs),
        ) +
        Math.max(
          0,
          ...Object.values(collectedDiags).map(
            (d) => d.shopDurationMs + d.decisionsDurationMs,
          ),
        );

      const spans: TraceWaterfallSpan[] = [];
      let cursor = 0;
      const extSpanDur = extractJson.diagnostics.cacheHit
        ? 12
        : extractJson.diagnostics.durationMs;
      spans.push({
        spanId: "sp_extract",
        name: "video.extract",
        service: extractJson.diagnostics.videoModel,
        startOffsetMs: 0,
        durationMs: Math.max(12, extSpanDur),
        status: extractJson.diagnostics.cacheHit ? "cached" : "ok",
        detail: `${workingItems.length} item(s) extracted`,
        correlationId: extractJson.diagnostics.interactionId ?? null,
      });
      cursor += Math.max(12, extSpanDur);

      if (Object.keys(capturedFramesMap).length > 0) {
        spans.push({
          spanId: "sp_frames",
          name: "frames.capture",
          service: "Browser HTML5 Canvas",
          startOffsetMs: cursor,
          durationMs: 180,
          status: "ok",
          detail: `${Object.values(capturedFramesMap).reduce((a, l) => a + l.length, 0)} frame/crop still(s)`,
        });
        cursor += 180;
      }

      const agentList = Object.values(collectedAgentReports);
      if (agentList.length > 0) {
        const agDur = agentList.every((r) => r.cacheHit)
          ? 12
          : Math.max(...agentList.map((r) => r.durationMs), 20);
        spans.push({
          spanId: "sp_agent",
          name: "agent.investigate",
          service: agentList[0].agentId,
          startOffsetMs: cursor,
          durationMs: agDur,
          status: agentList.every((r) => r.cacheHit) ? "cached" : "ok",
          detail: `${agentList.reduce((a, r) => a + r.steps.length, 0)} remote sandbox tool step(s)`,
          correlationId:
            agentList[0].environmentId ?? agentList[0].interactionId,
        });
        cursor += agDur;
      }

      const diagList = Object.values(collectedDiags);
      if (diagList.length > 0) {
        const matchCached = diagList.every((d) => d.cacheHit);
        const shopDur = matchCached
          ? 10
          : Math.max(...diagList.map((d) => d.shopDurationMs), 20);
        const decDur = matchCached
          ? 10
          : Math.max(...diagList.map((d) => d.decisionsDurationMs), 20);

        spans.push({
          spanId: "sp_shop",
          name: "shop.retrieve",
          service: "mcp.shop.com (2026-07-28)",
          startOffsetMs: cursor,
          durationMs: shopDur,
          status: diagList.some((d) => d.shopError)
            ? "error"
            : matchCached
              ? "cached"
              : "ok",
          detail: `${diagList.reduce((a, d) => a + d.candidateCount, 0)} verified variant(s)`,
        });
        cursor += shopDur;

        spans.push({
          spanId: "sp_decisions",
          name: "decisions.rerank",
          service: diagList[0].decisionModel,
          startOffsetMs: cursor,
          durationMs: decDur,
          status: diagList.some((d) => !d.decisionsLive)
            ? "warning"
            : matchCached
              ? "cached"
              : "ok",
          detail: `mode=${diagList[0].evidenceMode}`,
        });
      }

      upsertStoredTraceRecord({
        traceId: extractJson.traceId,
        createdAt: new Date().toISOString(),
        videoId: extractJson.videoId,
        canonicalUrl: extractJson.canonicalUrl,
        question: targetQuestion.trim(),
        totalDurationMs: Math.max(100, traceTotalMs),
        extractDiagnostics: extractJson.diagnostics,
        items: workingItems,
        agentReportsByItem: collectedAgentReports,
        matchDiagnosticsByItem: collectedDiags,
        spans,
        checkoutEvents: [],
      });
      setTraceHistory(readStoredTraceHistory());

      if (!hadAnyError && !attachedFile && normalized && clientCacheKey) {
        writeClientTraceCache({
          cacheKey: clientCacheKey,
          savedAt: Date.now(),
          traceId: extractJson.traceId,
          videoId: normalized.videoId,
          items: workingItems,
          extractDiagnostics: extractJson.diagnostics,
          agentReportsByItem: collectedAgentReports,
          offersByItem: collectedOffers,
          matchDiagnosticsByItem: collectedDiags,
        });
      }
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
          traceId: traceId ?? undefined,
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
          traceId: traceId ?? undefined,
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
      if (traceId) {
        const updatedHist = appendCheckoutEventToTrace(traceId, {
          at: new Date().toISOString(),
          sellerName: data.checkout.sellerName,
          title: data.checkout.title,
          status: data.checkout.status,
          orderPlaced: data.checkout.orderPlaced,
        });
        setTraceHistory(updatedHist);
      }
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
        {
          method: "GET",
          headers: traceId ? { "x-scenetrace-id": traceId } : undefined,
        },
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
      if (traceId) {
        const updatedHist = appendCheckoutEventToTrace(traceId, {
          at: new Date().toISOString(),
          sellerName: data.checkout.sellerName,
          title: data.checkout.title,
          status: data.checkout.status,
          orderPlaced: data.checkout.orderPlaced,
        });
        setTraceHistory(updatedHist);
      }
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

  const isHomeView = stage === "idle" && items.length === 0;

  const promotedTopCount = useMemo(() => {
    let count = 0;
    for (const diag of Object.values(matchDiagnosticsByItem)) {
      const top = diag.rankComparison[0];
      if (top && top.originalRank > 1) count++;
    }
    return count;
  }, [matchDiagnosticsByItem]);


  // ---------------------------------------------------------------------------
  // Voice + repair. Buying is the default path; the repair check runs only when
  // the shopper asks for it (or taps the offer on an item that looks damaged).
  // ---------------------------------------------------------------------------
  const [captureRequested, setCaptureRequested] = useState(false);
  const pendingVoiceTraceRef = useRef<string | null>(null);
  const [selectedOfferIdx, setSelectedOfferIdx] = useState(0);
  const [repairState, setRepairState] = useState<{
    itemId: string;
    label: string;
    loading: boolean;
    verdict: RepairVerdict | null;
    error: string | null;
  } | null>(null);
  const repairRunRef = useRef(0);

  const DEFAULT_VOICE_QUESTION = "What is this product and where can I buy it?";

  const handleCompanionChange = (file: File | null) => {
    setCompanionFile(file);
    if (file) setCaptureRequested(false);
  };

  // A spoken "what is this?" in camera mode captures first, then traces the
  // fresh still once it lands in state.
  useEffect(() => {
    const pending = pendingVoiceTraceRef.current;
    if (pending === null || !companionFile || inputSource !== "camera") return;
    pendingVoiceTraceRef.current = null;
    setQuestion(pending);
    void handleTrace({ question: pending });
    // handleTrace is recreated every render; companionFile is the trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companionFile]);

  const activeItem: TracedItem | null =
    items.find((it) => it.itemId === activeItemId) ?? items[0] ?? null;
  const activeOffers: Offer[] = activeItem
    ? (offersByItem[activeItem.itemId] ?? [])
    : [];

  useEffect(() => {
    setSelectedOfferIdx(0);
  }, [activeItem?.itemId]);

  useEffect(() => {
    if (isHomeView) {
      repairRunRef.current++;
      setRepairState(null);
    }
  }, [isHomeView]);

  const checkoutOffer = (offer: Offer | undefined) => {
    if (!offer) return;
    void executeCheckout({
      offerId: offer.offerId,
      offerToken: offer.offerToken,
      offerTitle: offer.title,
      sellerName: offer.sellerName,
    });
  };

  const repairImageFor = async (
    item: TracedItem,
  ): Promise<{ imageBase64: string; mimeType: string } | null> => {
    const frame = framesByItem[item.itemId]?.[0] ?? cameraStill;
    if (frame?.dataUrl) {
      const m = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(frame.dataUrl);
      if (m) return { mimeType: m[1], imageBase64: m[2] };
    }
    if (companionFile && companionFile.type.startsWith("image/")) {
      return {
        mimeType: companionFile.type,
        imageBase64: await readFileAsBase64(companionFile),
      };
    }
    return null;
  };

  const runRepair = async (item: TracedItem, note?: string) => {
    const runId = ++repairRunRef.current;
    setActiveItemId(item.itemId);
    setRepairState({ itemId: item.itemId, label: item.label, loading: true, verdict: null, error: null });
    try {
      const image = await repairImageFor(item);
      if (!image) throw new Error("No still of this item to inspect. Capture a photo first.");
      const res = await fetch("/api/traces/repair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...image, item, note: note?.slice(0, 500) }),
      });
      const body = (await res.json().catch(() => null)) as
        | (RepairVerdict & { error?: string; message?: string })
        | null;
      if (!res.ok || !body || !body.decision) {
        throw new Error(body?.message ?? body?.error ?? `Repair check failed (${res.status}).`);
      }
      if (runId !== repairRunRef.current) return;
      setRepairState({ itemId: item.itemId, label: item.label, loading: false, verdict: body, error: null });
    } catch (err) {
      if (runId !== repairRunRef.current) return;
      setRepairState({
        itemId: item.itemId,
        label: item.label,
        loading: false,
        verdict: null,
        error: err instanceof Error ? err.message : "Repair check failed.",
      });
    }
  };

  const voiceActions: VoiceActions = {
    switchSource: (source) => {
      if (!isHomeView) handleGoHome();
      handleChangeInputSource(source);
    },
    capture: () => {
      if (inputSource !== "camera") handleChangeInputSource("camera");
      if (!isHomeView) handleGoHome();
      setCompanionFile(null);
      setCaptureRequested(true);
    },
    trace: (spoken) => {
      const q = spoken?.trim() || question.trim() || DEFAULT_VOICE_QUESTION;
      if (inputSource === "camera") {
        // On the home screen with a still already taken, trace that still.
        if (isHomeView && companionFile) {
          setQuestion(q);
          return handleTrace({ question: q });
        }
        // Otherwise this is a new object: back to the live camera, capture, trace.
        if (!isHomeView) handleGoHome();
        setCompanionFile(null);
        pendingVoiceTraceRef.current = q;
        setCaptureRequested(true);
        return;
      }
      setQuestion(q);
      return handleTrace({ question: q });
    },
    refine: (r) => {
      const phrase = refinementPhrase(r);
      if (!phrase) return;
      const base = question.trim() || DEFAULT_VOICE_QUESTION;
      const q = `${base}, ${phrase}`;
      setQuestion(q);
      return handleTrace({ question: q, bypassCache: true });
    },
    selectOffer: ({ index, description }) => {
      if (!activeOffers.length) return;
      if (typeof index === "number" && index >= 1 && index <= activeOffers.length) {
        setSelectedOfferIdx(index - 1);
        return;
      }
      if (description) {
        const words = description.toLowerCase().split(/\W+/).filter((w) => w.length > 2);
        let best = -1;
        let bestScore = 0;
        activeOffers.forEach((o, i) => {
          const hay = `${o.title} ${o.sellerName}`.toLowerCase();
          const score = words.filter((w) => hay.includes(w)).length;
          if (score > bestScore) {
            best = i;
            bestScore = score;
          }
        });
        if (best >= 0) setSelectedOfferIdx(best);
      }
    },
    checkout: () => checkoutOffer(activeOffers[selectedOfferIdx] ?? activeOffers[0]),
    diagnose: (note) => {
      if (!activeItem) return;
      return runRepair(activeItem, note);
    },
    nextItem: () => {
      if (items.length > 1 && activeItem) {
        const i = items.findIndex((it) => it.itemId === activeItem.itemId);
        setActiveItemId(items[(i + 1) % items.length].itemId);
        return;
      }
      // One item (or none): move on to the next object.
      handleGoHome();
      if (inputSource === "camera") setCaptureRequested(false);
    },
    showEvidence: () => setDiagnosticsOpen(true),
    stop: () => {},
  };
  const voiceActionsRef = useRef(voiceActions);
  voiceActionsRef.current = voiceActions;

  const handleVoiceIntent = useCallback(
    (intent: VoiceIntent, slots: VoiceSlots) =>
      dispatchVoiceIntent(intent, slots, voiceActionsRef.current),
    [],
  );

  const voiceContext: VoiceContext = {
    source: inputSource,
    hasCapture: Boolean(companionFile),
    hasItems: items.length > 0,
    hasOffers: activeOffers.length > 0,
    busy: isRunning || Boolean(repairState?.loading),
  };

  const repairOfferItem =
    !isHomeView && activeItem && inputSource === "camera" ? activeItem : null;
  const looksDamaged = Boolean(repairOfferItem?.condition?.damageVisible);

  const visibleItems = useMemo(() => {
    if (itemFilterId === "all") return items;
    return items.filter((it) => it.itemId === itemFilterId);
  }, [items, itemFilterId]);

  return (
    <div className="min-h-screen bg-[var(--bg-canvas)] text-[var(--ink-primary)]">
      <div className="sr-only" aria-live="polite">
        {stageAnnouncement}
      </div>

      {/* Redesigned Studio Navbar with Clickable Brand & Explicit Home / New Trace Button */}
      <StudioNavbar
        isHomeView={isHomeView}
        isRunning={isRunning}
        onGoHome={handleGoHome}
        videoModel={videoModel}
        onChangeVideoModel={setVideoModel}
        managedAgentEnabled={managedAgentEnabled}
        onToggleManagedAgent={() => setManagedAgentEnabled((v) => !v)}
        savedCheckout={savedCheckout}
        onOpenSavedCheckout={() => {
          if (!savedCheckout) return;
          setCheckoutError(null);
          setPriceChangePrompt(null);
          setModalCheckout(savedCheckout);
          setCheckoutModalOpen(true);
        }}
        onOpenDiagnostics={() => setDiagnosticsOpen(true)}
        promotedTopCount={promotedTopCount}
        hasTraceResults={
          Boolean(extractDiagnostics) || traceHistory.length > 0
        }
        darkMode={darkMode}
        onToggleTheme={toggleTheme}
        country={defaultCountry}
        currency={defaultCurrency}
        voiceSlot={
          <VoiceBar context={voiceContext} onIntent={handleVoiceIntent} />
        }
      />

      {isHomeView ? (
        <HomeStage
          inputSource={inputSource}
          onChangeInputSource={handleChangeInputSource}
          youtubeUrl={youtubeUrl}
          onChangeYoutubeUrl={setYoutubeUrl}
          question={question}
          onChangeQuestion={setQuestion}
          liveUrlPreview={liveUrlPreview}
          companionFile={companionFile}
          onChangeCompanionFile={handleCompanionChange}
          captureRequested={captureRequested}
          managedAgentEnabled={managedAgentEnabled}
          onToggleManagedAgent={() => setManagedAgentEnabled((v) => !v)}
          isRunning={isRunning}
          traceError={traceError}
          onSubmitTrace={handleTrace}
        />
      ) : (
        <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6">
          {/* Active Workspace Query & Live Progress Header */}
          <section className="surface-card rounded-3xl p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <button
                  type="button"
                  onClick={handleGoHome}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-sunken)] px-3 py-1.5 text-xs font-medium text-[var(--ink-secondary)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--ink-primary)]"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  <span>Home</span>
                </button>

                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-[var(--ink-primary)]">
                    “{question}”
                  </div>
                  <div className="truncate font-[family-name:var(--font-mono)] text-[11px] text-[var(--ink-muted)]">
                    {cameraStill
                      ? "Camera capture"
                      : liveUrlPreview?.canonicalUrl || youtubeUrl}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {servedFromCache && !isRunning && (
                  <button
                    type="button"
                    onClick={() => handleTrace({ bypassCache: true })}
                    title="Result served from cache — click to force a fresh live run across Gemini, Agent, Shop MCP, and Decisions"
                    className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/35 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-700 transition-colors hover:bg-emerald-500/20 dark:text-emerald-300"
                  >
                    <Zap className="h-3 w-3" />
                    <span>Instant cache · Run live</span>
                    <RefreshCw className="h-3 w-3" />
                  </button>
                )}

                <div className="flex items-center gap-1.5 rounded-full bg-[var(--bg-sunken)] px-3 py-1 font-[family-name:var(--font-mono)] text-xs text-[var(--ink-secondary)]">
                  <Clock className="h-3.5 w-3.5 text-amber-500" />
                  <span>{(elapsedMs / 1000).toFixed(1)}s</span>
                </div>

                <button
                  type="button"
                  onClick={() => setEditQueryExpanded((v) => !v)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-panel)] px-3 py-1.5 text-xs font-medium text-[var(--ink-secondary)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--ink-primary)]"
                >
                  <SlidersHorizontal className="h-3.5 w-3.5" />
                  <span>Edit search</span>
                </button>
              </div>
            </div>

            {/* Inline Expandable Search Editor */}
            {editQueryExpanded && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleTrace();
                }}
                className="mt-4 grid grid-cols-1 gap-2.5 border-t border-[var(--border-subtle)] pt-4 sm:grid-cols-12"
              >
                {!cameraStill && (
                  <input
                    type="url"
                    required
                    value={youtubeUrl}
                    onChange={(e) => setYoutubeUrl(e.target.value)}
                    placeholder="YouTube URL"
                    className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-sunken)] px-3.5 py-2 text-xs text-[var(--ink-primary)] focus:border-[var(--border-strong)] focus:outline-none sm:col-span-5"
                  />
                )}
                <input
                  type="text"
                  required
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  placeholder="What should SceneTrace find?"
                  className={`rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-sunken)] px-3.5 py-2 text-xs text-[var(--ink-primary)] focus:border-[var(--border-strong)] focus:outline-none ${
                    cameraStill ? "sm:col-span-10" : "sm:col-span-5"
                  }`}
                />
                <button
                  type="submit"
                  disabled={isRunning}
                  className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-[var(--cta-bg)] px-4 py-2 text-xs font-semibold text-[var(--cta-ink)] hover:bg-[var(--cta-hover)] disabled:opacity-50 sm:col-span-2"
                >
                  <span>Re-trace</span>
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
              </form>
            )}

            {/* Clean Stepper */}
            <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-[var(--border-subtle)] pt-3.5 text-xs">
              {[
                {
                  id: "extract",
                  label: "Scene analysis",
                  done:
                    items.length > 0 ||
                    stage === "complete" ||
                    stage === "partial",
                  active: stage === "extracting",
                },
                ...(companionFile
                  ? [
                      {
                        id: "frames",
                        label: cameraStill ? "Camera still" : "Frame crops",
                        done:
                          stage === "agent_investigating" ||
                          stage === "matching" ||
                          stage === "complete" ||
                          stage === "partial",
                        active: stage === "capturing_frames",
                      },
                    ]
                  : []),
                ...(managedAgentEnabled
                  ? [
                      {
                        id: "agent",
                        label: "Agent SKU research",
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
                  label: "Shopify & Decisions rank",
                  done: stage === "complete" || stage === "partial",
                  active: stage === "matching",
                },
              ].map((step) => (
                <span
                  key={step.id}
                  className={`inline-flex items-center gap-1.5 ${
                    step.active
                      ? "font-semibold text-amber-600 dark:text-amber-300"
                      : step.done
                        ? "font-medium text-emerald-600 dark:text-emerald-400"
                        : "text-[var(--ink-muted)]"
                  }`}
                >
                  {step.active ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : step.done ? (
                    <CheckCircle2 className="h-3.5 w-3.5" />
                  ) : (
                    <span className="h-1.5 w-1.5 rounded-full bg-current opacity-40" />
                  )}
                  <span>{step.label}</span>
                </span>
              ))}
            </div>

            {traceError && (
              <div className="mt-3.5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-red-500/35 bg-red-500/10 px-4 py-2.5 text-xs text-red-600 dark:text-red-300">
                <div className="flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>{traceError}</span>
                </div>
                <button
                  type="button"
                  onClick={() => handleTrace()}
                  className="inline-flex items-center gap-1 rounded-full border border-red-500/35 px-3 py-1 font-medium hover:bg-red-500/15"
                >
                  <RefreshCw className="h-3 w-3" />
                  Retry
                </button>
              </div>
            )}

            {frameWarning && (
              <div className="mt-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs text-amber-700 dark:text-amber-300">
                {frameWarning}
              </div>
            )}
          </section>

          {/* Split Cinema + Showroom Layout */}
          <section className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            {/* Left Sticky Cinema Column */}
            <div className="lg:col-span-5">
              <div className="lg:sticky lg:top-20">
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
                  cameraStill={cameraStill}
                />
              </div>
            </div>

            {/* Right Showroom Dossiers Column */}
            <div className="space-y-5 lg:col-span-7">
              {extractDiagnostics?.videoSummary && (
                <div className="surface-card rounded-2xl px-5 py-3.5 text-xs leading-relaxed text-[var(--ink-secondary)]">
                  <span className="mr-2 font-semibold text-[var(--ink-primary)]">
                    Scene overview:
                  </span>
                  {extractDiagnostics.videoSummary}
                </div>
              )}

              {/* Multi-item Filter Tabs */}
              {items.length > 1 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setItemFilterId("all")}
                    className={`rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors ${
                      itemFilterId === "all"
                        ? "border-[var(--border-strong)] bg-[var(--cta-bg)] text-[var(--cta-ink)]"
                        : "border-[var(--border-subtle)] bg-[var(--bg-panel)] text-[var(--ink-secondary)] hover:text-[var(--ink-primary)]"
                    }`}
                  >
                    All items ({items.length})
                  </button>
                  {items.map((it, idx) => (
                    <button
                      key={it.itemId}
                      type="button"
                      onClick={() => {
                        setItemFilterId(it.itemId);
                        triggerSeek(it.itemId, it.bestEvidenceSec);
                      }}
                      className={`rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors ${
                        itemFilterId === it.itemId
                          ? "border-[var(--border-strong)] bg-[var(--cta-bg)] text-[var(--cta-ink)]"
                          : "border-[var(--border-subtle)] bg-[var(--bg-panel)] text-[var(--ink-secondary)] hover:text-[var(--ink-primary)]"
                      }`}
                    >
                      {idx + 1}. {it.label}
                    </button>
                  ))}
                </div>
              )}

              {stage === "extracting" && items.length === 0 && (
                <div className="surface-card flex min-h-[300px] flex-col items-center justify-center gap-3 rounded-3xl p-8 text-center">
                  <Loader2 className="h-6 w-6 animate-spin text-amber-500" />
                  <div className="text-base font-semibold text-[var(--ink-primary)]">
                    Watching the scene…
                  </div>
                  <p className="max-w-sm text-xs leading-relaxed text-[var(--ink-muted)]">
                    Gemini is scanning visual frames, close-ups, and audio to
                    pinpoint products and timestamps.
                  </p>
                </div>
              )}

              {stage === "complete" && items.length === 0 && !traceError && (
                <div className="surface-card rounded-3xl p-8 text-center">
                  <p className="text-base font-semibold text-[var(--ink-primary)]">
                    No matching products spotted in this clip
                  </p>
                  <p className="mx-auto mt-1.5 max-w-md text-xs leading-relaxed text-[var(--ink-secondary)]">
                    We didn’t find shoppable items matching “{question}”. Click{" "}
                    <button
                      type="button"
                      onClick={() => setEditQueryExpanded(true)}
                      className="font-medium text-amber-500 underline"
                    >
                      Edit search
                    </button>{" "}
                    or return{" "}
                    <button
                      type="button"
                      onClick={handleGoHome}
                      className="font-medium text-amber-500 underline"
                    >
                      Home
                    </button>{" "}
                    to try another clip.
                  </p>
                </div>
              )}

              {repairOfferItem && !repairState && (
                <div
                  className={`flex flex-wrap items-center justify-between gap-3 rounded-2xl border px-4 py-3 ${
                    looksDamaged
                      ? "border-amber-500/40 bg-amber-500/10"
                      : "border-[var(--border-subtle)] bg-[var(--bg-sunken)]/60"
                  }`}
                >
                  <div className="min-w-0 text-xs">
                    <div className="font-medium text-[var(--ink-primary)]">
                      {looksDamaged
                        ? `${repairOfferItem.label} looks damaged`
                        : `Something wrong with ${repairOfferItem.label}?`}
                    </div>
                    <div className="truncate text-[var(--ink-muted)]">
                      {looksDamaged && repairOfferItem.condition?.signs.length
                        ? repairOfferItem.condition.signs.slice(0, 3).join(" · ")
                        : "Check whether a repair part beats buying new."}
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={isRunning}
                    onClick={() => void runRepair(repairOfferItem)}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/12 px-3.5 py-1.5 text-xs font-medium text-amber-700 transition-colors hover:bg-amber-500/20 disabled:opacity-50 dark:text-amber-300"
                  >
                    Is it worth fixing?
                  </button>
                </div>
              )}

              {repairState && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs text-[var(--ink-muted)]">
                    <span>Repair check · {repairState.label}</span>
                    <button
                      type="button"
                      onClick={() => {
                        repairRunRef.current++;
                        setRepairState(null);
                      }}
                      className="hover:text-[var(--ink-primary)]"
                    >
                      Dismiss
                    </button>
                  </div>
                  <RepairPanel
                    verdict={repairState.verdict}
                    loading={repairState.loading}
                    error={repairState.error}
                    onBuyPart={() => {
                      const url = repairState.verdict?.part?.productUrl;
                      if (url) window.open(url, "_blank", "noopener,noreferrer");
                    }}
                    onBuyNew={() =>
                      checkoutOffer((offersByItem[repairState.itemId] ?? [])[0])
                    }
                  />
                </div>
              )}

              {visibleItems.map((item, idx) => {
                const agentReport = agentReportsByItem[item.itemId];
                const itemFrames = framesByItem[item.itemId] ?? [];
                return (
                  <ItemDossierCard
                    key={item.itemId}
                    item={item}
                    itemIndex={idx}
                    isSelected={activeItemId === item.itemId}
                    onSelect={() => setActiveItemId(item.itemId)}
                    onSeekTo={(sec) => triggerSeek(item.itemId, sec)}
                    hasTimeline={!cameraStill}
                    frames={itemFrames}
                    offers={offersByItem[item.itemId] ?? []}
                    isMatching={Boolean(matchingItemIds[item.itemId])}
                    isAgentInvestigatingStage={stage === "agent_investigating"}
                    itemDiag={matchDiagnosticsByItem[item.itemId]}
                    agentReport={agentReport}
                    isAgentRunning={Boolean(agentRunningByItem[item.itemId])}
                    onRunAgent={(followUpPrompt) =>
                      runAgentForItem({
                        targetItem: item,
                        baseQuestion: question.trim(),
                        followUpPrompt,
                        previousInteractionId:
                          followUpPrompt && agentReport
                            ? agentReport.interactionId
                            : null,
                        primaryFrame: itemFrames[0] ?? null,
                        reRunMatchAfter: true,
                      })
                    }
                    buyingOfferId={buyingOfferId}
                    selectingVariantOfferId={selectingVariantOfferId}
                    variantErrorsByOffer={variantSelectErrorByOffer}
                    onSelectVariantOption={handleSelectVariantOption}
                    onBuyOnShopify={(offer) =>
                      executeCheckout({
                        offerId: offer.offerId,
                        offerToken: offer.offerToken,
                        offerTitle: offer.title,
                        sellerName: offer.sellerName,
                      })
                    }
                    country={defaultCountry}
                  />
                );
              })}
            </div>
          </section>
        </main>
      )}

      <CheckoutModal
        open={checkoutModalOpen}
        onClose={() => setCheckoutModalOpen(false)}
        loading={checkoutLoading}
        error={checkoutError}
        checkout={modalCheckout}
        priceChangePrompt={priceChangePrompt}
        onConfirmPriceChange={() => {
          if (!priceChangePrompt) return;
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

      <DiagnosticsDrawer
        open={diagnosticsOpen}
        onClose={() => setDiagnosticsOpen(false)}
        traceId={traceId}
        extractDiagnostics={extractDiagnostics}
        items={items}
        agentReportsByItem={agentReportsByItem}
        matchDiagnosticsByItem={matchDiagnosticsByItem}
        traceHistory={traceHistory}
      />
    </div>
  );
}
