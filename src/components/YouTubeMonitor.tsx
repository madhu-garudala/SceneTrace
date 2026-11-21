"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ExternalLink, Film, Maximize2, Pause, Play, X } from "lucide-react";
import type { EvidenceFrame, TracedItem } from "@/lib/types";
import { buildYouTubeTimestampUrl, formatTimestamp } from "@/lib/video/youtube";

// YouTube IFrame Player states: -1 unstarted, 0 ended, 1 playing, 2 paused, 3 buffering, 5 video cued
const YT_STATE_PLAYING = 1;
const YT_STATE_PAUSED = 2;

type YTPlayerInstance = {
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  playVideo: () => void;
  pauseVideo: () => void;
  mute: () => void;
  unMute: () => void;
  isMuted: () => boolean;
  getPlayerState?: () => number;
  cueVideoById: (
    videoIdOrOpts:
      | string
      | { videoId: string; startSeconds?: number },
    startSeconds?: number,
  ) => void;
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
            onStateChange?: (e: {
              target: YTPlayerInstance;
              data: number;
            }) => void;
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

  // Tracks when we programmatically seek to an evidence frame so we freeze (pause) cleanly
  // on the decoded frame without autoplaying video or blaring audio.
  const freezeOnDecodedFrameRef = useRef(false);
  const restoreUnmuteAfterFreezeRef = useRef(false);

  const onDurationRef = useRef(onDurationDetected);
  onDurationRef.current = onDurationDetected;

  const [embedError, setEmbedError] = useState(false);
  const [lastSeekSec, setLastSeekSec] = useState<number>(0);
  const [lightboxFrame, setLightboxFrame] = useState<EvidenceFrame | null>(
    null,
  );

  const seekAndPauseAtFrame = (player: YTPlayerInstance, seconds: number) => {
    const state = player.getPlayerState?.();
    if (state === YT_STATE_PLAYING || state === YT_STATE_PAUSED) {
      // Stream is already decoded: seek directly and hold paused on that frame
      player.seekTo(seconds, true);
      player.pauseVideo();
      freezeOnDecodedFrameRef.current = false;
      return;
    }

    // Stream is unstarted/cued: mute briefly while YouTube decodes the target keyframe,
    // then immediately pause in `onStateChange` the instant the frame renders.
    const wasAlreadyMuted = player.isMuted?.() ?? false;
    restoreUnmuteAfterFreezeRef.current = !wasAlreadyMuted;
    freezeOnDecodedFrameRef.current = true;
    player.mute?.();
    player.seekTo(seconds, true);
  };

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
          // Cue without autoplaying when switching videos
          playerRef.current.cueVideoById({ videoId, startSeconds: 0 });
        }
        return;
      }

      playerRef.current?.destroy();
      readyRef.current = false;
      loadedVideoIdRef.current = videoId;

      playerRef.current = new window.YT.Player(playerContainerId, {
        videoId,
        playerVars: {
          autoplay: 0,
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
              const targetSec = pendingSeekRef.current;
              pendingSeekRef.current = null;
              seekAndPauseAtFrame(e.target, targetSec);
            }
          },
          onStateChange: (e) => {
            reportDuration(e.target);
            if (
              e.data === YT_STATE_PLAYING &&
              freezeOnDecodedFrameRef.current
            ) {
              freezeOnDecodedFrameRef.current = false;
              e.target.pauseVideo();
              if (restoreUnmuteAfterFreezeRef.current) {
                restoreUnmuteAfterFreezeRef.current = false;
                e.target.unMute?.();
              }
            }
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
      seekAndPauseAtFrame(playerRef.current, seekRequest.seconds);
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
      {/* Cinema Player Card */}
      <div className="surface-card overflow-hidden rounded-3xl">
        <div className="relative aspect-video w-full bg-black">
          {videoId ? (
            <>
              <div id={playerContainerId} className="h-full w-full" />
              {embedError && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-neutral-950/95 p-6 text-center">
                  <p className="max-w-sm text-sm text-neutral-300">
                    Embedded playback is disabled by the uploader, though Gemini
                    analyzed the public video directly.
                  </p>
                  <a
                    href={buildYouTubeTimestampUrl(videoId, lastSeekSec)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-2 text-xs font-semibold text-neutral-950 hover:bg-neutral-200"
                  >
                    Open on YouTube at {formatTimestamp(lastSeekSec)}
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </div>
              )}
            </>
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-neutral-500">
              <Play className="mr-1.5 h-3.5 w-3.5" /> Loading clip…
            </div>
          )}
        </div>

        {videoId && (
          <div className="flex items-center justify-between px-4 py-2.5 text-xs">
            <span className="inline-flex items-center gap-1.5 font-[family-name:var(--font-mono)] text-[11px] text-[var(--ink-muted)]">
              <Pause className="h-3 w-3 text-amber-500" />
              <span>Paused at evidence · {formatTimestamp(lastSeekSec)}</span>
            </span>
            <a
              href={buildYouTubeTimestampUrl(videoId, lastSeekSec)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-medium text-[var(--ink-secondary)] transition-colors hover:text-[var(--ink-primary)]"
            >
              <span>Open in YouTube</span>
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        )}
      </div>

      {/* Supporting Scene Frames Card */}
      {activeItem && activeFrames.length > 0 && (
        <div className="surface-card rounded-3xl p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-[var(--ink-primary)]">
              <Film className="h-3.5 w-3.5 text-amber-500" />
              <span className="truncate">
                {allUploadedStills ? "Reference Photo" : "Captured Scene Frames"}
              </span>
            </div>
            <span className="rounded-full bg-[var(--bg-sunken)] px-2.5 py-0.5 text-[10px] font-medium text-[var(--ink-secondary)]">
              {allUploadedStills ? "Uploaded photo" : "From attached video"}
            </span>
          </div>

          <div className="grid grid-cols-3 gap-2.5">
            {activeFrames.map((frame, i) => (
              <div
                key={`${frame.kind}_${frame.atSec ?? "ref"}_${i}`}
                className="group relative overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-black"
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
                  className="block w-full text-left focus:outline-none"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={frame.dataUrl}
                    alt={frame.label}
                    className="aspect-video w-full object-cover transition-transform duration-200 group-hover:scale-105"
                  />
                  <div className="flex items-center justify-between bg-neutral-950/90 px-2.5 py-1 font-[family-name:var(--font-mono)] text-[10px] text-neutral-300">
                    <span>
                      {frame.atSec !== null
                        ? formatTimestamp(frame.atSec)
                        : "Ref"}
                    </span>
                    <span className="text-amber-400">
                      {frame.kind === "video_crop"
                        ? "Crop"
                        : frame.kind === "uploaded_still"
                          ? "Photo"
                          : i === 0
                            ? "Best"
                            : `#${i + 1}`}
                    </span>
                  </div>
                </button>
                <button
                  type="button"
                  aria-label="Inspect full frame"
                  onClick={() => setLightboxFrame(frame)}
                  className="absolute right-1.5 top-1.5 rounded-lg bg-black/75 p-1 text-neutral-300 opacity-0 transition-opacity hover:text-white group-hover:opacity-100 focus:opacity-100"
                >
                  <Maximize2 className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Scene Timeline Sightings */}
      {items.length > 0 && (
        <div className="surface-card rounded-3xl p-4 sm:p-5">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--ink-secondary)]">
              Scene Timeline
            </h3>
            {!hasCompanionMedia && (
              <span className="text-[11px] text-[var(--ink-muted)]">
                Tap timestamp to jump & pause
              </span>
            )}
          </div>

          <div className="space-y-3">
            {items.map((item) => {
              const isSelected = item.itemId === activeItem?.itemId;
              return (
                <div
                  key={item.itemId}
                  className={`rounded-2xl border p-3 transition-colors ${
                    isSelected
                      ? "border-[var(--border-strong)] bg-[var(--bg-elevated)]/70"
                      : "border-[var(--border-subtle)] bg-[var(--bg-sunken)]/50"
                  }`}
                >
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        onSelectItemAndSeek(item.itemId, item.bestEvidenceSec)
                      }
                      className="truncate text-left text-xs font-semibold text-[var(--ink-primary)] hover:text-amber-500"
                    >
                      {item.label}
                    </button>
                    <span className="shrink-0 text-[11px] capitalize text-[var(--ink-muted)]">
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
                          className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 font-[family-name:var(--font-mono)] text-[11px] transition-colors ${
                            isBest
                              ? "border-amber-500/45 bg-amber-500/12 font-medium text-amber-700 hover:bg-amber-500/20 dark:text-amber-300"
                              : "border-[var(--border-subtle)] bg-[var(--bg-panel)] text-[var(--ink-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--ink-primary)]"
                          }`}
                        >
                          <span>{formatTimestamp(s.evidenceSec)}</span>
                          {isBest && <span className="text-[9px]">★</span>}
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
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-6 backdrop-blur-sm"
          onClick={() => setLightboxFrame(null)}
        >
          <div
            className="max-w-4xl overflow-hidden rounded-2xl border border-white/15 bg-neutral-950 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3 text-xs text-neutral-300">
              <span>
                {lightboxFrame.label} · {lightboxFrame.width}×
                {lightboxFrame.height}px
              </span>
              <button
                type="button"
                onClick={() => setLightboxFrame(null)}
                className="rounded-full p-1 text-neutral-400 hover:bg-white/10 hover:text-white"
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
