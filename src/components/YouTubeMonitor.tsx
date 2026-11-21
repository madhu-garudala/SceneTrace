"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ExternalLink, Film, Maximize2, Play, X } from "lucide-react";
import type { EvidenceFrame, TracedItem } from "@/lib/types";
import { buildYouTubeTimestampUrl, formatTimestamp } from "@/lib/video/youtube";

type YTPlayerInstance = {
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  playVideo: () => void;
  loadVideoById: (videoId: string, startSeconds?: number) => void;
  getDuration?: () => number;
  destroy: () => void;
};

declare global {
  interface Window {
    YT?: {
      Player: new (
        elementId: string,
        options: {
          videoId: string;
          playerVars?: Record<string, string | number>;
          events?: {
            onReady?: (e: { target: YTPlayerInstance }) => void;
            onStateChange?: (e: { target: YTPlayerInstance; data: number }) => void;
            onError?: (e: { data?: number }) => void;
          };
        },
      ) => YTPlayerInstance;
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

let ytApiPromise: Promise<void> | null = null;

function ensureYouTubeIframeApi(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.YT && window.YT.Player) return Promise.resolve();
  if (ytApiPromise) return ytApiPromise;

  ytApiPromise = new Promise<void>((resolve) => {
    const prevCallback = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prevCallback?.();
      resolve();
    };

    if (
      !document.querySelector('script[src="https://www.youtube.com/iframe_api"]')
    ) {
      const tag = document.createElement("script");
      tag.src = "https://www.youtube.com/iframe_api";
      tag.async = true;
      document.head.appendChild(tag);
    }
  });

  return ytApiPromise;
}

export type YouTubeMonitorProps = {
  videoId: string | null;
  seekRequest: { seconds: number; nonce: number } | null;
  items: TracedItem[];
  activeItemId: string | null;
  onSelectItemAndSeek: (itemId: string, seconds: number) => void;
  onDurationDetected?: (durationSec: number) => void;
  framesByItem: Record<string, EvidenceFrame[]>;
  hasCompanionMedia: boolean;
};

export function YouTubeMonitor({
  videoId,
  seekRequest,
  items,
  activeItemId,
  onSelectItemAndSeek,
  onDurationDetected,
  framesByItem,
  hasCompanionMedia,
}: YouTubeMonitorProps) {
  const rawDomId = useId().replace(/:/g, "");
  const playerContainerId = `yt_monitor_${rawDomId}`;
  const playerRef = useRef<YTPlayerInstance | null>(null);
  const readyRef = useRef(false);
  const pendingSeekRef = useRef<number | null>(null);
  const loadedVideoIdRef = useRef<string | null>(null);
  const onDurationRef = useRef(onDurationDetected);
  onDurationRef.current = onDurationDetected;

  const [embedError, setEmbedError] = useState(false);
  const [lastSeekSec, setLastSeekSec] = useState<number>(0);
  const [lightboxFrame, setLightboxFrame] = useState<EvidenceFrame | null>(
    null,
  );

  useEffect(() => {
    if (!videoId) return;
    let cancelled = false;
    setEmbedError(false);

    const reportDuration = (target: YTPlayerInstance | null) => {
      const dur = target?.getDuration?.();
      if (typeof dur === "number" && Number.isFinite(dur) && dur > 0) {
        onDurationRef.current?.(dur);
      }
    };

    ensureYouTubeIframeApi().then(() => {
      if (cancelled || !window.YT?.Player) return;

      if (playerRef.current && readyRef.current) {
        if (loadedVideoIdRef.current !== videoId) {
          loadedVideoIdRef.current = videoId;
          playerRef.current.loadVideoById(videoId, 0);
        }
        return;
      }

      playerRef.current?.destroy();
      readyRef.current = false;
      loadedVideoIdRef.current = videoId;

      playerRef.current = new window.YT.Player(playerContainerId, {
        videoId,
        playerVars: {
          rel: 0,
          modestbranding: 1,
          playsinline: 1,
          origin: window.location.origin,
        },
        events: {
          onReady: (e) => {
            readyRef.current = true;
            reportDuration(e.target);
            if (pendingSeekRef.current !== null) {
              playerRef.current?.seekTo(pendingSeekRef.current, true);
              playerRef.current?.playVideo();
              pendingSeekRef.current = null;
            }
          },
          onStateChange: (e) => {
            reportDuration(e.target);
          },
          onError: () => {
            setEmbedError(true);
          },
        },
      });
    });

    return () => {
      cancelled = true;
    };
  }, [videoId, playerContainerId]);

  useEffect(() => {
    return () => {
      playerRef.current?.destroy();
      playerRef.current = null;
      readyRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!seekRequest || !videoId) return;
    setLastSeekSec(seekRequest.seconds);
    if (playerRef.current && readyRef.current) {
      playerRef.current.seekTo(seekRequest.seconds, true);
      playerRef.current.playVideo();
    } else {
      pendingSeekRef.current = seekRequest.seconds;
    }
  }, [seekRequest, videoId]);

  const activeItem =
    items.find((i) => i.itemId === activeItemId) ?? items[0] ?? null;
  const activeFrames = activeItem ? framesByItem[activeItem.itemId] ?? [] : [];
  const allUploadedStills =
    activeFrames.length > 0 &&
    activeFrames.every((f) => f.kind === "uploaded_still");

  return (
    <div className="space-y-4">
      {/* Monitor Frame */}
      <div className="overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel)]">
        <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-3.5 py-2 text-xs">
          <div className="flex items-center gap-2 font-[family-name:var(--font-mono)] text-[var(--ink-secondary)]">
            <span className="inline-block h-2 w-2 rounded-full bg-amber-500" />
            <span>MONITOR</span>
            {videoId && (
              <span className="text-[var(--ink-muted)]">· ID {videoId}</span>
            )}
          </div>
          {videoId && (
            <a
              href={buildYouTubeTimestampUrl(videoId, lastSeekSec)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-[family-name:var(--font-mono)] text-[11px] text-[var(--ink-secondary)] transition-colors hover:text-amber-500"
            >
              Watch on YouTube @ {formatTimestamp(lastSeekSec)}
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>

        <div className="relative aspect-video w-full bg-black">
          {videoId ? (
            <>
              <div id={playerContainerId} className="h-full w-full" />
              {embedError && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-neutral-950/95 p-6 text-center">
                  <p className="max-w-sm text-sm text-neutral-300">
                    The video uploader disabled embedded playback on external
                    sites. Gemini 4 still analyzed the public URL directly.
                  </p>
                  <a
                    href={buildYouTubeTimestampUrl(videoId, lastSeekSec)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/15 px-3.5 py-2 font-[family-name:var(--font-mono)] text-xs font-medium text-amber-300 hover:bg-amber-500/25"
                  >
                    Open YouTube at {formatTimestamp(lastSeekSec)}
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </div>
              )}
            </>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/5 text-neutral-400">
                <Play className="h-4 w-4 translate-x-0.5" />
              </div>
              <p className="font-[family-name:var(--font-mono)] text-xs uppercase tracking-wider text-neutral-400">
                No Active Feed
              </p>
              <p className="max-w-xs text-xs text-neutral-500">
                Paste any public YouTube URL above and ask about the items worn
                or shown in the clip.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Supporting Scene Frames Filmstrip */}
      {activeItem && activeFrames.length > 0 && (
        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-3.5">
          <div className="mb-2.5 flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-wider text-[var(--ink-secondary)]">
              <Film className="h-3.5 w-3.5 text-amber-500" />
              <span className="truncate">
                {allUploadedStills
                  ? "Uploaded Reference Photo"
                  : `Supporting Scene Frames · ${activeItem.label}`}
              </span>
            </div>
            <span
              className={`shrink-0 rounded border px-1.5 py-0.5 font-[family-name:var(--font-mono)] text-[10px] ${
                allUploadedStills
                  ? "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-300"
                  : "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
              }`}
            >
              {allUploadedStills ? "UPLOADED REFERENCE" : "SOURCE VIDEO EVIDENCE"}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-2.5">
            {activeFrames.map((frame, i) => (
              <div
                key={`${frame.kind}_${frame.atSec ?? "ref"}_${i}`}
                className="group relative overflow-hidden rounded border border-[var(--border-subtle)] bg-black"
              >
                <button
                  type="button"
                  onClick={() => {
                    if (frame.atSec !== null) {
                      onSelectItemAndSeek(activeItem.itemId, frame.atSec);
                    } else {
                      setLightboxFrame(frame);
                    }
                  }}
                  className="block w-full text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={frame.dataUrl}
                    alt={frame.label}
                    className="aspect-video w-full object-cover transition-transform duration-200 group-hover:scale-[1.03]"
                  />
                  <div className="flex items-center justify-between bg-neutral-950/90 px-2 py-1 font-[family-name:var(--font-mono)] text-[10px] text-neutral-300">
                    <span>
                      {frame.atSec !== null
                        ? `@${formatTimestamp(frame.atSec)}`
                        : "UNMAPPED"}
                    </span>
                    <span className="text-amber-400">
                      {frame.kind === "video_crop"
                        ? "CROP"
                        : frame.kind === "uploaded_still"
                          ? "REF"
                          : i === 0
                            ? "BEST"
                            : `SHOT ${i + 1}`}
                    </span>
                  </div>
                </button>
                <button
                  type="button"
                  aria-label="Inspect full frame"
                  onClick={() => setLightboxFrame(frame)}
                  className="absolute right-1.5 top-1.5 rounded bg-black/75 p-1 text-neutral-300 opacity-0 transition-opacity hover:text-white group-hover:opacity-100 focus:opacity-100"
                >
                  <Maximize2 className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Cross-Scene Sighting Index */}
      {items.length > 0 && (
        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-3.5">
          <div className="mb-2.5 flex items-center justify-between">
            <span className="font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-wider text-[var(--ink-secondary)]">
              Cross-Scene Sightings ({items.length}{" "}
              {items.length === 1 ? "item" : "items"})
            </span>
            {!hasCompanionMedia && (
              <span className="font-[family-name:var(--font-mono)] text-[10px] text-[var(--ink-muted)]">
                Click timestamp to jump player
              </span>
            )}
          </div>
          <div className="space-y-2.5">
            {items.map((item) => {
              const isSelected = item.itemId === activeItem?.itemId;
              return (
                <div
                  key={item.itemId}
                  className={`rounded-md border p-2.5 transition-colors ${
                    isSelected
                      ? "border-amber-500/40 bg-[var(--bg-elevated)]"
                      : "border-[var(--border-subtle)] bg-[var(--bg-sunken)]"
                  }`}
                >
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        onSelectItemAndSeek(item.itemId, item.bestEvidenceSec)
                      }
                      className="truncate text-left text-xs font-semibold text-[var(--ink-primary)] hover:text-amber-500"
                    >
                      {item.label}
                    </button>
                    <span className="shrink-0 rounded border border-[var(--border-subtle)] px-1.5 py-0.5 font-[family-name:var(--font-mono)] text-[10px] uppercase text-[var(--ink-muted)]">
                      {item.category}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {item.sightings.map((s, idx) => {
                      const isBest =
                        Math.abs(s.evidenceSec - item.bestEvidenceSec) < 0.8;
                      return (
                        <button
                          key={`${item.itemId}_s_${idx}`}
                          type="button"
                          title={s.observation}
                          onClick={() =>
                            onSelectItemAndSeek(item.itemId, s.evidenceSec)
                          }
                          className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 font-[family-name:var(--font-mono)] text-[11px] transition-colors ${
                            isBest
                              ? "border-amber-500/50 bg-amber-500/15 text-amber-600 hover:bg-amber-500/25 dark:text-amber-300"
                              : "border-[var(--border-subtle)] bg-[var(--bg-panel)] text-[var(--ink-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--ink-primary)]"
                          }`}
                        >
                          <span>{formatTimestamp(s.evidenceSec)}</span>
                          {s.endSec - s.startSec >= 1.5 && (
                            <span className="text-[10px] opacity-65">
                              ({formatTimestamp(s.startSec)}–
                              {formatTimestamp(s.endSec)})
                            </span>
                          )}
                          {isBest && (
                            <span className="text-[9px] font-bold">★</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Fullscreen Frame Lightbox */}
      {lightboxFrame && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-6 backdrop-blur-xs"
          onClick={() => setLightboxFrame(null)}
        >
          <div
            className="max-w-4xl overflow-hidden rounded-lg border border-white/15 bg-neutral-950"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-2.5 font-[family-name:var(--font-mono)] text-xs text-neutral-300">
              <span>
                {lightboxFrame.label} · {lightboxFrame.width}×
                {lightboxFrame.height}px
              </span>
              <button
                type="button"
                onClick={() => setLightboxFrame(null)}
                className="rounded p-1 text-neutral-400 hover:bg-white/10 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={lightboxFrame.dataUrl}
              alt={lightboxFrame.label}
              className="max-h-[78vh] w-auto object-contain"
            />
          </div>
        </div>
      )}
    </div>
  );
}
