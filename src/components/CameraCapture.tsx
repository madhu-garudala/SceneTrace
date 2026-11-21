"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, CameraOff, Loader2, RefreshCw, RotateCcw } from "lucide-react";

const MAX_CAPTURE_EDGE = 1280;
const CAPTURE_JPEG_QUALITY = 0.88;

function describeCameraError(err: unknown): string {
  const name =
    err instanceof DOMException || err instanceof Error ? err.name : "Error";
  let hint: string;
  if (name === "NotAllowedError" || name === "SecurityError") {
    hint =
      "Camera permission was denied. Allow camera access for this site in your browser settings, then retry.";
  } else if (name === "NotFoundError" || name === "OverconstrainedError") {
    hint = "No camera was found on this device.";
  } else if (name === "NotReadableError" || name === "AbortError") {
    hint = "The camera is busy or unavailable. Close other apps using it, then retry.";
  } else {
    hint =
      err instanceof Error && err.message
        ? err.message
        : "Could not start the camera.";
  }
  return `${name}: ${hint}`;
}

export type CameraCaptureProps = {
  capturedFile: File | null;
  onCapture: (file: File | null) => void;
  disabled?: boolean;
  /** Set by voice ("take a picture"). Captures as soon as the preview has a frame. */
  captureRequested?: boolean;
};

export function CameraCapture({
  capturedFile,
  onCapture,
  disabled,
  captureRequested,
}: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraState, setCameraState] = useState<"starting" | "live" | "error">(
    "starting",
  );
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const [capturing, setCapturing] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const isLive = !capturedFile;

  // Live preview runs only while nothing is captured; tracks stop on capture, unmount, or source switch.
  useEffect(() => {
    if (!isLive) return;
    let cancelled = false;
    setCameraState("starting");
    setCameraError(null);

    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraState("error");
      setCameraError(
        window.isSecureContext
          ? "NotSupportedError: This browser does not expose a camera API."
          : "SecurityError: Camera access needs HTTPS (Chrome also allows localhost).",
      );
      return;
    }

    navigator.mediaDevices
      .getUserMedia({
        video: {
          facingMode: "environment",
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          void video.play().catch(() => {
            // autoplay of a muted inline stream is allowed; ignore interruptions
          });
        }
        setCameraState("live");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setCameraState("error");
        setCameraError(describeCameraError(err));
      });

    const videoEl = videoRef.current;
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      if (videoEl) videoEl.srcObject = null;
    };
  }, [isLive, retryNonce]);

  useEffect(() => {
    if (!capturedFile) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(capturedFile);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [capturedFile]);

  const handleCapture = async () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) return;
    setCapturing(true);
    try {
      const scale = Math.min(
        1,
        MAX_CAPTURE_EDGE / Math.max(video.videoWidth, video.videoHeight),
      );
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
      canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("2D canvas unavailable.");
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", CAPTURE_JPEG_QUALITY),
      );
      if (!blob) throw new Error("Could not encode the captured frame.");

      const now = Date.now();
      onCapture(
        new File([blob], `camera-capture-${now}.jpg`, {
          type: "image/jpeg",
          lastModified: now,
        }),
      );
    } catch (err) {
      setCameraError(
        err instanceof Error ? `${err.name}: ${err.message}` : "Capture failed.",
      );
    } finally {
      setCapturing(false);
    }
  };

  // A spoken capture can arrive before the stream has its first frame (the
  // preview may have only just mounted), so poll briefly for real dimensions.
  const handleCaptureRef = useRef(handleCapture);
  handleCaptureRef.current = handleCapture;
  useEffect(() => {
    if (!captureRequested || cameraState !== "live" || capturedFile) return;
    let tries = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const attempt = () => {
      const v = videoRef.current;
      if (v && v.videoWidth && v.videoHeight) {
        void handleCaptureRef.current();
        return;
      }
      if (++tries < 40) timer = setTimeout(attempt, 100);
    };
    // Give auto-exposure a beat after the stream starts.
    timer = setTimeout(attempt, 350);
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [captureRequested, cameraState, capturedFile]);

  if (capturedFile) {
    return (
      <div className="flex items-center justify-between gap-3 border-b border-[var(--border-subtle)] bg-[var(--bg-sunken)]/65 px-5 py-3">
        <div className="flex min-w-0 items-center gap-3">
          {previewUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={previewUrl}
              alt="Captured camera still"
              className="h-14 w-24 shrink-0 rounded-lg border border-[var(--border-subtle)] object-cover"
            />
          )}
          <div className="min-w-0">
            <div className="truncate text-xs font-medium text-[var(--ink-primary)]">
              Photo ready for scene analysis
            </div>
            <div className="truncate font-[family-name:var(--font-mono)] text-[11px] text-[var(--ink-muted)]">
              Camera capture · {Math.max(1, Math.round(capturedFile.size / 1024))}{" "}
              KB JPEG
            </div>
          </div>
        </div>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onCapture(null)}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-panel)] px-3 py-1.5 text-xs font-medium text-[var(--ink-secondary)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--ink-primary)] disabled:opacity-50"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          <span>Retake</span>
        </button>
      </div>
    );
  }

  return (
    <div className="border-b border-[var(--border-subtle)] px-5 py-4">
      <div className="relative aspect-video w-full overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-black">
        <video
          ref={videoRef}
          muted
          playsInline
          autoPlay
          aria-label="Live camera preview"
          className="h-full w-full object-cover"
        />
        {cameraState === "starting" && (
          <div className="absolute inset-0 flex items-center justify-center gap-2 text-xs text-neutral-400">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            <span>Starting camera…</span>
          </div>
        )}
        {cameraState === "error" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-neutral-950/95 p-6 text-center">
            <CameraOff className="h-5 w-5 text-neutral-500" />
            <p className="max-w-sm text-xs leading-relaxed text-neutral-300">
              {cameraError}
            </p>
            <button
              type="button"
              onClick={() => setRetryNonce((n) => n + 1)}
              className="inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-1.5 text-xs font-semibold text-neutral-950 hover:bg-neutral-200"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Retry camera
            </button>
          </div>
        )}
      </div>

      <div className="mt-3 flex items-center justify-between gap-3">
        <span className="text-xs text-[var(--ink-muted)]">
          {cameraState === "live" && cameraError
            ? cameraError
            : "Frame the product, then capture a still."}
        </span>
        <button
          type="button"
          onClick={handleCapture}
          disabled={disabled || cameraState !== "live" || capturing}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/12 px-3.5 py-1.5 text-xs font-medium text-amber-700 transition-colors hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-50 dark:text-amber-300"
        >
          {capturing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Camera className="h-3.5 w-3.5" />
          )}
          <span>Capture</span>
        </button>
      </div>
    </div>
  );
}
