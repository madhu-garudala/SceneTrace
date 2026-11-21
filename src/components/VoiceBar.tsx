"use client";

import { useCallback, useRef, useState } from "react";
import { AlertTriangle, AudioLines, Mic, MicOff, Volume2 } from "lucide-react";
import type { VoiceContext, VoiceIntent, VoiceIntentResponse, VoiceSlots } from "@/lib/voice/types";
import { useSpeak, useSpeechRecognition } from "@/lib/voice/useSpeech";
import { createEchoGuard } from "@/lib/voice/echo";

export type VoiceBarProps = {
  context: VoiceContext;
  onIntent: (intent: VoiceIntent, slots: VoiceSlots) => void | Promise<void>;
  disabled?: boolean;
};

const INTENT_LABELS: Record<VoiceIntent, string> = {
  switch_to_camera: "Camera",
  switch_to_youtube: "YouTube",
  capture: "Capture",
  trace: "Trace",
  refine: "Refine",
  select_offer: "Select offer",
  checkout: "Checkout",
  next_item: "Next item",
  show_evidence: "Evidence",
  stop: "Stop",
  diagnose: "Diagnose",
  unknown: "Unknown",
};

const LOOP_COUNT = 3;
const LOOP_WINDOW_MS = 10_000;

export function VoiceBar({ context, onIntent, disabled }: VoiceBarProps) {
  const [enabled, setEnabled] = useState(false);
  const [last, setLast] = useState<{ intent: VoiceIntent; confidence: number } | null>(null);
  const { speak, stop, speaking } = useSpeak();
  const echo = useRef(createEchoGuard());
  const history = useRef<Record<string, number[]>>({});
  const contextRef = useRef(context);
  contextRef.current = context;
  const onIntentRef = useRef(onIntent);
  onIntentRef.current = onIntent;

  const handleResult = useCallback(
    async (utterance: string) => {
      if (echo.current.isEcho(utterance)) return;
      stop(); // barge-in: anything the user says interrupts the app
      let data: VoiceIntentResponse;
      try {
        const res = await fetch("/api/voice/intent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ utterance, context: contextRef.current }),
        });
        if (!res.ok) return;
        data = (await res.json()) as VoiceIntentResponse;
      } catch {
        return;
      }
      setLast({ intent: data.intent, confidence: data.confidence });

      const now = Date.now();
      const recent = (history.current[data.intent] ?? []).filter((t) => now - t <= LOOP_WINDOW_MS);
      recent.push(now);
      history.current[data.intent] = recent;
      const looping = recent.length >= LOOP_COUNT;

      if (data.reply && !looping) {
        echo.current.remember(data.reply);
        void speak(data.reply);
      }
      await onIntentRef.current(data.intent, data.slots ?? {});
    },
    [speak, stop],
  );

  const { supported, listening, interim, error } = useSpeechRecognition({
    onResult: handleResult,
    enabled: enabled && !disabled,
  });

  if (supported === false) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-[var(--ink-muted)]">
        <MicOff className="h-3.5 w-3.5" />
        Voice needs Chrome
      </span>
    );
  }

  const state = error
    ? "error"
    : speaking
      ? "speaking"
      : interim
        ? "hearing"
        : enabled && listening
          ? "listening"
          : "off";

  const STATE_UI = {
    off: {
      cls: "border-[var(--border-subtle)] bg-[var(--bg-panel)] text-[var(--ink-muted)] hover:text-[var(--ink-secondary)]",
      icon: <MicOff className="h-3.5 w-3.5" />,
      label: "Voice off",
    },
    listening: {
      cls: "border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
      icon: <Mic className="h-3.5 w-3.5" />,
      label: "Listening",
    },
    hearing: {
      cls: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
      icon: <AudioLines className="h-3.5 w-3.5 animate-pulse" />,
      label: "Hearing you",
    },
    speaking: {
      cls: "border-[var(--border-strong)] bg-[var(--bg-elevated)] text-[var(--ink-primary)]",
      icon: <Volume2 className="h-3.5 w-3.5 text-amber-500 animate-pulse" />,
      label: "Speaking",
    },
    error: {
      cls: "border-red-500/35 bg-red-500/10 text-red-700 dark:text-red-300",
      icon: <AlertTriangle className="h-3.5 w-3.5" />,
      label: error === "not-allowed" ? "Mic blocked" : "Voice error",
    },
  }[state];

  return (
    <div className="flex min-w-0 items-center gap-2">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setEnabled((v) => !v)}
        aria-pressed={enabled}
        title={error ? `Speech recognition error: ${error}` : enabled ? "Turn voice off" : "Turn voice on"}
        className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-all disabled:opacity-50 ${STATE_UI.cls}`}
      >
        {STATE_UI.icon}
        <span>{STATE_UI.label}</span>
        <span
          className={`h-1.5 w-1.5 rounded-full ${
            state === "off" ? "bg-[var(--ink-muted)]" : state === "error" ? "bg-red-500" : state === "listening" ? "bg-emerald-500" : "bg-amber-500"
          }`}
        />
      </button>

      {interim && (
        <span className="hidden max-w-[16rem] truncate text-xs italic text-[var(--ink-secondary)] md:inline">
          “{interim}”
        </span>
      )}

      {last && (
        <span
          className="hidden shrink-0 items-center gap-1 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-panel)] px-2.5 py-1 font-[family-name:var(--font-mono)] text-[10px] font-semibold text-[var(--ink-secondary)] lg:inline-flex"
          title="Intent routed by the Decisions API"
        >
          {INTENT_LABELS[last.intent] ?? last.intent}
          <span className="text-emerald-500">{Math.round(last.confidence * 100)}%</span>
        </span>
      )}
    </div>
  );
}
