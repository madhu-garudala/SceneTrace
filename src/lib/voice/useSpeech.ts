"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/* Minimal Web Speech API types (not in the default TS lib). */
type SRAlternative = { transcript: string };
type SRResult = { isFinal: boolean; length: number; [i: number]: SRAlternative };
type SREvent = { resultIndex: number; results: { length: number; [i: number]: SRResult } };
type SRErrorEvent = { error: string };
interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: SREvent) => void) | null;
  onerror: ((e: SRErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type SRCtor = new () => SpeechRecognitionLike;

function getCtor(): SRCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: SRCtor; webkitSpeechRecognition?: SRCtor };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

export const STABLE_INTERIM_MS = 1100;
const DUPLICATE_WINDOW_MS = 3000;

export function useSpeechRecognition({
  onResult,
  enabled,
}: {
  onResult: (text: string) => void;
  enabled: boolean;
}) {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);

  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;

  useEffect(() => {
    setSupported(getCtor() !== null);
  }, []);

  useEffect(() => {
    const Ctor = getCtor();
    if (!enabled || !Ctor) return;

    let active = true;
    let rec: SpeechRecognitionLike | null = null;
    let restartTimer: ReturnType<typeof setTimeout> | null = null;
    let stableTimer: ReturnType<typeof setTimeout> | null = null;
    let lastInterim = "";
    let lastDelivered = { text: "", at: 0 };

    const clearStable = () => {
      if (stableTimer) clearTimeout(stableTimer);
      stableTimer = null;
    };
    const deliver = (text: string) => {
      const t = text.trim();
      if (!t) return;
      const now = Date.now();
      // A late final for text already delivered via the stable-interim path.
      if (t.toLowerCase() === lastDelivered.text && now - lastDelivered.at < DUPLICATE_WINDOW_MS) return;
      lastDelivered = { text: t.toLowerCase(), at: now };
      onResultRef.current(t);
    };

    const start = () => {
      if (!active) return;
      rec = new Ctor();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = "en-US";
      rec.onresult = (e) => {
        let finalText = "";
        let interimText = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          const t = r[0]?.transcript ?? "";
          if (r.isFinal) finalText += t;
          else interimText += t;
        }
        if (finalText.trim()) {
          clearStable();
          lastInterim = "";
          setInterim("");
          deliver(finalText);
          return;
        }
        const next = interimText.trim();
        setInterim(next);
        if (next && next !== lastInterim) {
          clearStable();
          stableTimer = setTimeout(() => {
            stableTimer = null;
            const t = lastInterim;
            lastInterim = "";
            setInterim("");
            deliver(t);
          }, STABLE_INTERIM_MS);
        }
        lastInterim = next;
      };
      rec.onerror = (ev) => {
        if (ev.error === "not-allowed" || ev.error === "service-not-allowed") {
          active = false; // do not restart-loop against a denied permission
        }
        if (ev.error !== "no-speech" && ev.error !== "aborted") setError(ev.error);
      };
      rec.onend = () => {
        setListening(false);
        if (!active) return;
        restartTimer = setTimeout(start, 250); // Chrome ends sessions after silence
      };
      try {
        rec.start();
        setListening(true);
        setError((prev) => (prev === "not-allowed" ? prev : null));
      } catch {
        // start() throws if already started; onend will retry.
      }
    };

    start();
    return () => {
      active = false;
      clearStable();
      if (restartTimer) clearTimeout(restartTimer);
      if (rec) {
        rec.onresult = rec.onerror = rec.onend = null;
        try { rec.abort(); } catch { /* ignore */ }
      }
      setListening(false);
      setInterim("");
    };
  }, [enabled]);

  return { supported, listening, interim, error };
}

export function useSpeak() {
  const [speaking, setSpeaking] = useState(false);
  const gen = useRef(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const urlRef = useRef<string | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const halt = useCallback(() => {
    gen.current++;
    abortRef.current?.abort();
    abortRef.current = null;
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
    const a = audioRef.current;
    if (a) {
      a.onended = a.onerror = null;
      a.pause();
      audioRef.current = null;
    }
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
  }, []);

  const stop = useCallback(() => {
    halt();
    setSpeaking(false);
  }, [halt]);

  const speak = useCallback(
    async (text: string) => {
      if (!text.trim()) return;
      halt();
      const my = gen.current;
      const current = () => gen.current === my;
      const done = () => {
        if (current()) setSpeaking(false);
      };
      setSpeaking(true);

      const browserSpeak = () => {
        if (!current()) return;
        if (typeof window === "undefined" || !("speechSynthesis" in window)) return done();
        const u = new SpeechSynthesisUtterance(text);
        u.onend = done;
        u.onerror = done;
        // Some browsers fire neither event; never let `speaking` stick.
        timeoutRef.current = setTimeout(done, 3000 + text.length * 100);
        window.speechSynthesis.speak(u);
      };

      const ctrl = new AbortController();
      abortRef.current = ctrl;
      try {
        const res = await fetch("/api/voice/speak", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
          signal: ctrl.signal,
        });
        if (!current()) return;
        if (res.status !== 200) return browserSpeak();
        const blob = await res.blob();
        if (!current()) return;
        const url = URL.createObjectURL(blob);
        urlRef.current = url;
        const audio = new Audio(url);
        audioRef.current = audio;
        audio.onended = () => {
          if (current()) {
            URL.revokeObjectURL(url);
            urlRef.current = null;
          }
          done();
        };
        audio.onerror = () => {
          if (current()) browserSpeak();
        };
        await audio.play();
      } catch {
        if (current()) browserSpeak();
      }
    },
    [halt],
  );

  useEffect(() => halt, [halt]);

  return { speak, stop, speaking };
}
