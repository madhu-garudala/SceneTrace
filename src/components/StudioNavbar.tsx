"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Activity,
  ChevronDown,
  House,
  Moon,
  Plus,
  ShoppingBag,
  Sparkles,
  Sun,
  Terminal,
} from "lucide-react";
import type { AllowedVideoModel } from "@/lib/env";
import type { CheckoutSummary } from "@/lib/types";

const MODEL_META: Record<
  AllowedVideoModel,
  { short: string; name: string; desc: string }
> = {
  "gemini-4-hydrogen": {
    short: "Hydrogen 4",
    name: "Gemini 4 Hydrogen",
    desc: "Ultra-fast ~5s scene inference (default)",
  },
  "gemini-4-neon": {
    short: "Neon 4",
    name: "Gemini 4 Neon",
    desc: "Balanced speed & cross-scene precision",
  },
  "gemini-4-carbon": {
    short: "Carbon 4",
    name: "Gemini 4 Carbon",
    desc: "Maximum multimodal reasoning depth",
  },
  "gemini-4-argon": {
    short: "Argon 4",
    name: "Gemini 4 Argon",
    desc: "Deepest frontier reasoning (slower)",
  },
};

export type StudioNavbarProps = {
  isHomeView: boolean;
  isRunning: boolean;
  onGoHome: () => void;
  videoModel: AllowedVideoModel;
  onChangeVideoModel: (m: AllowedVideoModel) => void;
  managedAgentEnabled: boolean;
  onToggleManagedAgent: () => void;
  savedCheckout: CheckoutSummary | null;
  /** Items added this session; the bag pill shows whenever there are any. */
  bagCount?: number;
  onOpenSavedCheckout: () => void;
  onOpenDiagnostics: () => void;
  promotedTopCount: number;
  hasTraceResults: boolean;
  darkMode: boolean;
  onToggleTheme: () => void;
  country: string;
  currency: string;
  /** Voice control, rendered at the start of the right-hand controls. */
  voiceSlot?: ReactNode;
};

export function StudioNavbar({
  isHomeView,
  isRunning,
  onGoHome,
  videoModel,
  onChangeVideoModel,
  managedAgentEnabled,
  onToggleManagedAgent,
  savedCheckout,
  bagCount = 0,
  onOpenSavedCheckout,
  onOpenDiagnostics,
  promotedTopCount,
  hasTraceResults,
  darkMode,
  onToggleTheme,
  country,
  currency,
  voiceSlot,
}: StudioNavbarProps) {
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setModelMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  return (
    <header className="sticky top-0 z-30 border-b border-[var(--border-subtle)] bg-[var(--bg-canvas)]/85 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-3 px-4 sm:px-6">
        {/* Left: Brand Identity + Explicit Home / New Trace Controls */}
        <div className="flex items-center gap-2 sm:gap-3">
          <button
            type="button"
            onClick={onGoHome}
            className="group inline-flex items-center gap-2.5 rounded-xl px-2 py-1.5 text-left transition-colors hover:bg-[var(--bg-elevated)] focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60"
            title="SceneTrace Home"
          >
            {/* Bespoke Cinema Frame SVG Mark */}
            <span className="relative flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--cta-bg)] text-[var(--cta-ink)] shadow-xs transition-transform duration-200 group-hover:scale-[1.03]">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                className="h-4 w-4"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M4 8V6a2 2 0 0 1 2-2h2" />
                <path d="M4 16v2a2 2 0 0 0 2 2h2" />
                <path d="M16 4h2a2 2 0 0 1 2 2v2" />
                <path d="M16 20h2a2 2 0 0 0 2-2v-2" />
                <circle cx="12" cy="12" r="2.5" fill="currentColor" />
              </svg>
            </span>

            <span className="flex flex-col">
              <span className="text-[15px] font-semibold tracking-tight text-[var(--ink-primary)]">
                SceneTrace
              </span>
              <span className="hidden text-[10px] text-[var(--ink-muted)] sm:block">
                Video to Checkout
              </span>
            </span>
          </button>

          <span className="hidden h-5 w-px bg-[var(--border-subtle)] sm:inline-block" />

          {/* Dedicated Home Button + New Trace Action */}
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={onGoHome}
              aria-current={isHomeView ? "page" : undefined}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-all ${
                isHomeView
                  ? "border border-[var(--border-strong)] bg-[var(--bg-elevated)] text-[var(--ink-primary)] shadow-2xs"
                  : "border border-transparent text-[var(--ink-secondary)] hover:border-[var(--border-subtle)] hover:bg-[var(--bg-elevated)] hover:text-[var(--ink-primary)]"
              }`}
            >
              <House className="h-3.5 w-3.5" />
              <span>Home</span>
            </button>

            {!isHomeView && (
              <button
                type="button"
                onClick={onGoHome}
                className="inline-flex items-center gap-1 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-panel)] px-3 py-1.5 text-xs font-medium text-[var(--ink-primary)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--bg-elevated)]"
              >
                <Plus className="h-3.5 w-3.5 text-amber-500" />
                <span className="hidden sm:inline">New trace</span>
              </button>
            )}
          </div>
        </div>

        {/* Right: Clean Studio Controls */}
        <div className="flex items-center gap-2">
          {voiceSlot}
          {/* Managed Agent Toggle Pill */}
          <button
            type="button"
            disabled={isRunning}
            onClick={onToggleManagedAgent}
            title="Toggle Gemini Managed Agent sandbox SKU & MSRP research"
            className={`hidden items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-all md:inline-flex ${
              managedAgentEnabled
                ? "border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                : "border-[var(--border-subtle)] bg-[var(--bg-panel)] text-[var(--ink-muted)] hover:text-[var(--ink-secondary)]"
            } disabled:opacity-50`}
          >
            <Terminal className="h-3.5 w-3.5" />
            <span>Agent</span>
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                managedAgentEnabled ? "bg-emerald-500" : "bg-[var(--ink-muted)]"
              }`}
            />
          </button>

          {/* Custom Model Switcher Popover */}
          <div ref={dropdownRef} className="relative">
            <button
              type="button"
              disabled={isRunning}
              onClick={() => setModelMenuOpen((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-panel)] px-3 py-1.5 text-xs font-medium text-[var(--ink-primary)] transition-colors hover:border-[var(--border-strong)] disabled:opacity-50"
            >
              <Sparkles className="h-3.5 w-3.5 text-amber-500" />
              <span>
                {(MODEL_META[videoModel] ?? MODEL_META["gemini-4-neon"]).short}
              </span>
              <ChevronDown className="h-3 w-3 text-[var(--ink-muted)]" />
            </button>

            {modelMenuOpen && (
              <div className="surface-card absolute right-0 mt-2 w-64 overflow-hidden rounded-2xl p-1.5 z-50">
                <div className="px-2.5 py-1.5 text-[10px] font-medium uppercase tracking-wider text-[var(--ink-muted)]">
                  Video Extraction Model
                </div>
                {(Object.keys(MODEL_META) as AllowedVideoModel[]).map((m) => {
                  const active = m === videoModel;
                  return (
                    <button
                      key={m}
                      type="button"
                      onClick={() => {
                        onChangeVideoModel(m);
                        setModelMenuOpen(false);
                      }}
                      className={`flex w-full flex-col rounded-xl px-3 py-2 text-left transition-colors ${
                        active
                          ? "bg-[var(--bg-elevated)] text-[var(--ink-primary)]"
                          : "text-[var(--ink-secondary)] hover:bg-[var(--bg-sunken)] hover:text-[var(--ink-primary)]"
                      }`}
                    >
                      <span className="flex items-center justify-between text-xs font-semibold">
                        <span>{MODEL_META[m].name}</span>
                        {active && (
                          <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                        )}
                      </span>
                      <span className="mt-0.5 text-[11px] text-[var(--ink-muted)]">
                        {MODEL_META[m].desc}
                      </span>
                    </button>
                  );
                })}
                <div className="mt-1 border-t border-[var(--border-subtle)] px-3 py-1.5 font-[family-name:var(--font-mono)] text-[10px] text-[var(--ink-muted)]">
                  Market: {country} · {currency}
                </div>
              </div>
            )}
          </div>

          {/* Saved Checkout Bag Pill */}
          {(savedCheckout || bagCount > 0) && (
            <button
              type="button"
              onClick={onOpenSavedCheckout}
              className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/35 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-700 transition-colors hover:bg-emerald-500/20 dark:text-emerald-300"
            >
              <ShoppingBag className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">
                {savedCheckout?.orderPlaced && bagCount <= 1 ? "Order Placed" : "Bag"}
              </span>
              {bagCount > 0 && (
                <span className="rounded-full bg-emerald-500/20 px-1.5 font-[family-name:var(--font-mono)] text-[10px] font-semibold">
                  {bagCount}
                </span>
              )}
            </button>
          )}

          {/* Proof / Diagnostics Button */}
          <button
            type="button"
            onClick={onOpenDiagnostics}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
              hasTraceResults
                ? "border-[var(--border-strong)] bg-[var(--bg-panel)] text-[var(--ink-primary)] hover:bg-[var(--bg-elevated)]"
                : "border-[var(--border-subtle)] bg-[var(--bg-panel)] text-[var(--ink-secondary)] hover:text-[var(--ink-primary)]"
            }`}
          >
            <Activity className="h-3.5 w-3.5 text-amber-500" />
            <span className="hidden sm:inline">Proof</span>
            {promotedTopCount > 0 && (
              <span className="rounded-full bg-emerald-500/20 px-1.5 py-0.2 font-[family-name:var(--font-mono)] text-[10px] font-semibold text-emerald-500">
                +{promotedTopCount}
              </span>
            )}
          </button>

          {/* Theme Switch */}
          <button
            type="button"
            onClick={onToggleTheme}
            aria-label={
              darkMode ? "Switch to light mode" : "Switch to dark mode"
            }
            className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-[var(--border-subtle)] bg-[var(--bg-panel)] text-[var(--ink-secondary)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--ink-primary)]"
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
  );
}
