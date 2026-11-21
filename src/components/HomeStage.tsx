"use client";

import { useRef } from "react";
import {
  ArrowRight,
  CheckCircle2,
  Film,
  Link2,
  Loader2,
  Paperclip,
  Play,
  Terminal,
  X,
} from "lucide-react";
import type { NormalizedYouTubeVideo } from "@/lib/video/youtube";

export type ShowcaseScene = {
  id: string;
  title: string;
  category: string;
  videoId: string;
  url: string;
  question: string;
  highlight: string;
};

export const VERIFIED_SHOWCASE_SCENES: ShowcaseScene[] = [
  {
    id: "casio_f91w",
    title: "Casio F-91W Close-Up",
    category: "Wristwatch",
    videoId: "8nJbKQYEH2M",
    url: "https://www.youtube.com/shorts/8nJbKQYEH2M",
    question: "Which wristwatch is shown in this clip?",
    highlight: "Promotes exact F-91W variant from #4 → #1",
  },
  {
    id: "adidas_samba",
    title: "Adidas Samba OG Unboxing",
    category: "Footwear",
    videoId: "t-oFOuz-vFY",
    url: "https://www.youtube.com/watch?v=t-oFOuz-vFY",
    question: "Which sneakers are being unboxed and reviewed in this video?",
    highlight: "Matches Cloud White / Core Black / Gum colorway",
  },
  {
    id: "aeropress",
    title: "Championship Coffee Brew",
    category: "Coffee Gear",
    videoId: "b_jiA2jZjXw",
    url: "https://www.youtube.com/shorts/b_jiA2jZjXw",
    question: "Which coffee brewer is demonstrated in this clip?",
    highlight: "Identifies AeroPress Original across 4 cuts",
  },
];

const QUICK_QUESTIONS = [
  "Which shoes and jacket is the host wearing?",
  "What watch appears on their wrist?",
  "Find the mug or desk gear shown under $40",
  "Identify the sunglasses and colorway",
];

export type HomeStageProps = {
  youtubeUrl: string;
  onChangeYoutubeUrl: (v: string) => void;
  question: string;
  onChangeQuestion: (v: string) => void;
  liveUrlPreview: NormalizedYouTubeVideo | null;
  companionFile: File | null;
  onChangeCompanionFile: (f: File | null) => void;
  managedAgentEnabled: boolean;
  onToggleManagedAgent: () => void;
  isRunning: boolean;
  traceError: string | null;
  onSubmitTrace: (override?: { url: string; question: string }) => void;
};

export function HomeStage({
  youtubeUrl,
  onChangeYoutubeUrl,
  question,
  onChangeQuestion,
  liveUrlPreview,
  companionFile,
  onChangeCompanionFile,
  managedAgentEnabled,
  onToggleManagedAgent,
  isRunning,
  traceError,
  onSubmitTrace,
}: HomeStageProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const questionInputRef = useRef<HTMLTextAreaElement | null>(null);

  return (
    <div className="ambient-stage min-h-[calc(100vh-4rem)]">
      <div className="mx-auto max-w-4xl px-4 pb-20 pt-10 sm:px-6 sm:pt-16">
        {/* Editorial Hero Headline */}
        <div className="mx-auto max-w-2xl text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-panel)] px-3.5 py-1 text-[11px] font-medium text-[var(--ink-secondary)] shadow-2xs">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            <span>Scene-level product discovery · Live Shopify checkout</span>
          </div>

          <h1 className="mt-5 text-4xl font-semibold tracking-tight text-[var(--ink-primary)] sm:text-5xl sm:leading-[1.08]">
            Spot it in the scene.{" "}
            <span className="font-[family-name:var(--font-serif)] font-normal italic text-amber-600 dark:text-amber-300">
              Own the exact piece.
            </span>
          </h1>

          <p className="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-[var(--ink-secondary)] sm:text-base">
            Paste any public YouTube video or Short. SceneTrace tracks items
            across cuts, verifies exact SKUs in a sandboxed agent, and ranks
            live Shopify offers you can buy immediately.
          </p>
        </div>

        {/* Unified Luxury Composer */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSubmitTrace();
          }}
          className="surface-card mx-auto mt-9 max-w-3xl overflow-hidden rounded-3xl transition-all"
        >
          {/* Row 1: YouTube URL Input */}
          <div className="flex items-center gap-3 border-b border-[var(--border-subtle)] px-5 py-4">
            <Link2 className="h-4 w-4 shrink-0 text-[var(--ink-muted)]" />
            <input
              type="url"
              required
              value={youtubeUrl}
              onChange={(e) => onChangeYoutubeUrl(e.target.value)}
              placeholder="Paste a YouTube video or Shorts link (https://youtube.com/watch?v=...)"
              aria-label="Public YouTube URL"
              className="w-full bg-transparent text-sm text-[var(--ink-primary)] placeholder:text-[var(--ink-muted)] focus:outline-none"
            />
            {liveUrlPreview && (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/12 px-2.5 py-0.5 font-[family-name:var(--font-mono)] text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="h-3 w-3" />
                {liveUrlPreview.videoId}
              </span>
            )}
          </div>

          {/* Instant Live Video Thumbnail Preview when valid URL is pasted */}
          {liveUrlPreview && (
            <div className="flex items-center justify-between gap-3 border-b border-[var(--border-subtle)] bg-[var(--bg-sunken)]/65 px-5 py-2.5">
              <div className="flex items-center gap-3 min-w-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={liveUrlPreview.thumbnailUrl}
                  alt="YouTube clip preview"
                  className="h-10 w-16 shrink-0 rounded-lg border border-[var(--border-subtle)] object-cover"
                />
                <div className="min-w-0">
                  <div className="truncate text-xs font-medium text-[var(--ink-primary)]">
                    Clip ready for scene analysis
                  </div>
                  <div className="truncate font-[family-name:var(--font-mono)] text-[11px] text-[var(--ink-muted)]">
                    {liveUrlPreview.canonicalUrl}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => onChangeYoutubeUrl("")}
                aria-label="Clear URL"
                className="rounded-full p-1 text-[var(--ink-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--ink-primary)]"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {/* Row 2: Shopper Natural-Language Question */}
          <div className="px-5 pb-3 pt-4">
            <label htmlFor="home-question-input" className="sr-only">
              What products should SceneTrace find?
            </label>
            <textarea
              ref={questionInputRef}
              id="home-question-input"
              rows={2}
              required
              value={question}
              onChange={(e) => onChangeQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  if (youtubeUrl.trim() && question.trim() && !isRunning) {
                    onSubmitTrace();
                  }
                }
              }}
              placeholder="What caught your eye? (e.g., Which sneakers is he wearing in size 10? What watch is on their wrist?)"
              className="w-full resize-none bg-transparent text-base text-[var(--ink-primary)] placeholder:text-[var(--ink-muted)] focus:outline-none"
            />

            {/* Quick Suggestion Chips */}
            <div className="mt-2 flex flex-wrap gap-1.5">
              {QUICK_QUESTIONS.map((q) => {
                const selected = question === q;
                return (
                  <button
                    key={q}
                    type="button"
                    onClick={() => {
                      onChangeQuestion(q);
                      questionInputRef.current?.focus();
                      requestAnimationFrame(() => {
                        const target = questionInputRef.current;
                        if (target) {
                          target.focus();
                          const end = target.value.length;
                          target.setSelectionRange(end, end);
                        }
                      });
                    }}
                    className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                      selected
                        ? "border-amber-500/45 bg-amber-500/12 text-amber-700 dark:text-amber-300"
                        : "border-[var(--border-subtle)] bg-[var(--bg-sunken)]/70 text-[var(--ink-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--ink-primary)]"
                    }`}
                  >
                    {q}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Row 3: Composer Footer Actions */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border-subtle)] bg-[var(--bg-sunken)]/40 px-5 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="video/mp4,video/webm,video/quicktime,image/jpeg,image/png,image/webp"
                onChange={(e) =>
                  onChangeCompanionFile(e.target.files?.[0] ?? null)
                }
                className="hidden"
              />

              {companionFile ? (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/35 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-700 dark:text-amber-300">
                  <Paperclip className="h-3.5 w-3.5" />
                  <span className="max-w-[180px] truncate">
                    {companionFile.name}
                  </span>
                  <button
                    type="button"
                    aria-label="Remove attached file"
                    onClick={() => {
                      onChangeCompanionFile(null);
                      if (fileInputRef.current) fileInputRef.current.value = "";
                    }}
                    className="rounded-full p-0.5 hover:bg-amber-500/20"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  title="Optional: Attach source .mp4 or reference photo to extract high-res frame crops in-browser"
                  className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-panel)] px-3 py-1.5 text-xs font-medium text-[var(--ink-secondary)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--ink-primary)]"
                >
                  <Film className="h-3.5 w-3.5 text-amber-500" />
                  <span>Attach source .mp4 / photo</span>
                </button>
              )}

              <button
                type="button"
                onClick={onToggleManagedAgent}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors md:hidden ${
                  managedAgentEnabled
                    ? "border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                    : "border-[var(--border-subtle)] bg-[var(--bg-panel)] text-[var(--ink-muted)]"
                }`}
              >
                <Terminal className="h-3.5 w-3.5" />
                <span>Agent {managedAgentEnabled ? "On" : "Off"}</span>
              </button>
            </div>

            <button
              type="submit"
              disabled={isRunning}
              className="inline-flex items-center gap-2 rounded-full bg-[var(--cta-bg)] px-5 py-2.5 text-xs font-semibold text-[var(--cta-ink)] shadow-sm transition-all hover:bg-[var(--cta-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isRunning ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>Tracing scene…</span>
                </>
              ) : (
                <>
                  <span>Trace scene</span>
                  <ArrowRight className="h-3.5 w-3.5" />
                </>
              )}
            </button>
          </div>
        </form>

        {traceError && (
          <div className="mx-auto mt-4 max-w-3xl rounded-2xl border border-red-500/35 bg-red-500/10 px-4 py-3 text-xs text-red-600 dark:text-red-300">
            {traceError}
          </div>
        )}

        {/* 1-Click Verified Live Showcase Scenes */}
        <div className="mx-auto mt-14 max-w-4xl">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--ink-secondary)]">
                Or launch a live trace in one click
              </h2>
              <p className="mt-0.5 text-xs text-[var(--ink-muted)]">
                Runs live against Gemini 4, Managed Agents, Shop MCP, and
                Decisions API
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {VERIFIED_SHOWCASE_SCENES.map((scene) => (
              <button
                key={scene.id}
                type="button"
                disabled={isRunning}
                onClick={() => {
                  onChangeYoutubeUrl(scene.url);
                  onChangeQuestion(scene.question);
                  onSubmitTrace({ url: scene.url, question: scene.question });
                }}
                className="surface-card group flex flex-col overflow-hidden rounded-2xl text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-[var(--border-strong)] disabled:opacity-60"
              >
                <div className="relative aspect-video w-full overflow-hidden bg-neutral-900">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`https://i.ytimg.com/vi/${scene.videoId}/hqdefault.jpg`}
                    alt={scene.title}
                    className="h-full w-full object-cover opacity-90 transition-transform duration-300 group-hover:scale-105 group-hover:opacity-100"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/15 to-transparent" />
                  <span className="absolute left-3 top-3 rounded-full bg-black/70 px-2.5 py-0.5 text-[10px] font-medium text-neutral-200 backdrop-blur-md">
                    {scene.category}
                  </span>
                  <span className="absolute bottom-3 right-3 flex h-8 w-8 items-center justify-center rounded-full bg-white/95 text-neutral-950 shadow-md transition-transform group-hover:scale-105">
                    <Play className="h-3.5 w-3.5 translate-x-0.25 fill-current" />
                  </span>
                </div>

                <div className="flex flex-1 flex-col justify-between p-4">
                  <div>
                    <h3 className="text-sm font-semibold text-[var(--ink-primary)]">
                      {scene.title}
                    </h3>
                    <p className="mt-1 line-clamp-2 text-xs text-[var(--ink-secondary)]">
                      “{scene.question}”
                    </p>
                  </div>
                  <div className="mt-3 border-t border-[var(--border-subtle)] pt-2.5 font-[family-name:var(--font-mono)] text-[10px] text-emerald-600 dark:text-emerald-400">
                    {scene.highlight}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
