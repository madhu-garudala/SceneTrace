import type { BoundingBox2D, EvidenceFrame, TracedItem } from "@/lib/types";
import { formatTimestamp } from "@/lib/video/youtube";

const MAX_FULL_FRAME_DIM = 840;
const MAX_CROP_DIM = 640;
const MAX_BASE64_PER_FRAME = 550_000; // ~410 KB binary -> 3 frames stay well under 1.5 MB (Vercel 4.5 MB limit)

function encodeCanvasWithinBudget(canvas: HTMLCanvasElement): {
  dataUrl: string;
  dataBase64: string;
} {
  let workingCanvas = canvas;
  for (let pass = 0; pass < 3; pass++) {
    const qualities = [0.82, 0.66, 0.5];
    for (const q of qualities) {
      const dataUrl = workingCanvas.toDataURL("image/jpeg", q);
      const commaIdx = dataUrl.indexOf(",");
      const dataBase64 = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl;
      if (dataBase64.length <= MAX_BASE64_PER_FRAME) {
        return { dataUrl, dataBase64 };
      }
    }
    // Downscale by 0.7x if high-entropy frame still exceeds strict 550K base64 ceiling
    const nextW = Math.max(64, Math.round(workingCanvas.width * 0.7));
    const nextH = Math.max(64, Math.round(workingCanvas.height * 0.7));
    const smaller = document.createElement("canvas");
    smaller.width = nextW;
    smaller.height = nextH;
    const sCtx = smaller.getContext("2d");
    if (!sCtx) break;
    sCtx.drawImage(workingCanvas, 0, 0, nextW, nextH);
    workingCanvas = smaller;
  }

  const fallback = workingCanvas.toDataURL("image/jpeg", 0.45);
  const idx = fallback.indexOf(",");
  return {
    dataUrl: fallback,
    dataBase64: idx >= 0 ? fallback.slice(idx + 1) : fallback,
  };
}

function seekVideoElement(
  video: HTMLVideoElement,
  targetSec: number,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const safeTarget = Math.max(
      0,
      Math.min(targetSec, Math.max(0, video.duration - 0.04)),
    );

    if (Math.abs(video.currentTime - safeTarget) < 0.02 && video.readyState >= 2) {
      resolve(Math.round(video.currentTime * 10) / 10);
      return;
    }

    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out seeking local video to ${safeTarget}s`));
    }, 8000);

    const onSeeked = () => {
      cleanup();
      resolve(Math.round(video.currentTime * 10) / 10);
    };
    const onError = () => {
      cleanup();
      reject(new Error("Failed decoding companion video frame."));
    };
    const cleanup = () => {
      window.clearTimeout(timer);
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onError);
    };

    video.addEventListener("seeked", onSeeked, { once: true });
    video.addEventListener("error", onError, { once: true });
    video.currentTime = safeTarget;
  });
}

function captureBoxCrop(
  video: HTMLVideoElement,
  box2d: BoundingBox2D,
  actualSec: number,
): EvidenceFrame | null {
  const srcW = video.videoWidth;
  const srcH = video.videoHeight;
  if (!srcW || !srcH) return null;

  const [ymin, xmin, ymax, xmax] = box2d;
  // Add 12% context padding around Gemini's normalized bounding box
  const padY = (ymax - ymin) * 0.12;
  const padX = (xmax - xmin) * 0.12;

  const top = Math.max(0, ((ymin - padY) / 1000) * srcH);
  const left = Math.max(0, ((xmin - padX) / 1000) * srcW);
  const bottom = Math.min(srcH, ((ymax + padY) / 1000) * srcH);
  const right = Math.min(srcW, ((xmax + padX) / 1000) * srcW);

  const cropW = Math.round(right - left);
  const cropH = Math.round(bottom - top);
  if (cropW < 32 || cropH < 32) return null;

  const scale = Math.min(1, MAX_CROP_DIM / Math.max(cropW, cropH));
  const outW = Math.max(1, Math.round(cropW * scale));
  const outH = Math.max(1, Math.round(cropH * scale));

  const cropCanvas = document.createElement("canvas");
  cropCanvas.width = outW;
  cropCanvas.height = outH;
  const ctx = cropCanvas.getContext("2d");
  if (!ctx) return null;

  ctx.drawImage(video, left, top, cropW, cropH, 0, 0, outW, outH);
  const { dataUrl, dataBase64 } = encodeCanvasWithinBudget(cropCanvas);

  return {
    kind: "video_crop",
    atSec: actualSec,
    mimeType: "image/jpeg",
    dataBase64,
    dataUrl,
    width: outW,
    height: outH,
    label: `Zoomed crop @ ${formatTimestamp(actualSec)}`,
  };
}

/**
 * Extracts crisp JPEG supporting frames & zoomed bounding-box crops in-browser
 * while enforcing duration alignment so mismatched companion files never fabricate timestamp provenance.
 */
export async function extractFramesFromCompanionVideo(
  file: File,
  items: TracedItem[],
  expectedYoutubeDurationSec?: number | null,
): Promise<{
  framesByItem: Record<string, EvidenceFrame[]>;
  alignmentWarning: string | null;
}> {
  const objectUrl = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.preload = "auto";
  video.muted = true;
  video.playsInline = true;
  video.src = objectUrl;

  try {
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(
        () => reject(new Error("Timed out loading companion video metadata.")),
        10_000,
      );
      video.onloadeddata = () => {
        window.clearTimeout(timer);
        resolve();
      };
      video.onerror = () => {
        window.clearTimeout(timer);
        reject(new Error("Browser could not decode the attached video file."));
      };
    });

    const localDuration = video.duration;
    if (!Number.isFinite(localDuration) || localDuration <= 0) {
      return {
        framesByItem: {},
        alignmentWarning:
          "Could not verify attached video duration; skipped frame capture.",
      };
    }

    // Verify companion file matches the YouTube clip duration when available
    if (
      typeof expectedYoutubeDurationSec === "number" &&
      Number.isFinite(expectedYoutubeDurationSec) &&
      expectedYoutubeDurationSec > 0 &&
      Math.abs(localDuration - expectedYoutubeDurationSec) > 2.5
    ) {
      return {
        framesByItem: {},
        alignmentWarning: `Attached video length (${formatTimestamp(localDuration)}) differs from YouTube clip length (${formatTimestamp(expectedYoutubeDurationSec)}). Skipped local frame capture to prevent mismatched evidence.`,
      };
    }

    const srcWidth = video.videoWidth || 1280;
    const srcHeight = video.videoHeight || 720;
    const scale = Math.min(
      1,
      MAX_FULL_FRAME_DIM / Math.max(srcWidth, srcHeight),
    );
    const width = Math.max(1, Math.round(srcWidth * scale));
    const height = Math.max(1, Math.round(srcHeight * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("2D canvas unavailable for frame capture.");
    }

    const framesByItem: Record<string, EvidenceFrame[]> = {};
    let skippedOutOfRangeCount = 0;

    for (const item of items) {
      const candidateSeconds: number[] = [item.bestEvidenceSec];
      for (const s of item.sightings) {
        if (
          candidateSeconds.every(
            (existing) => Math.abs(existing - s.evidenceSec) >= 1.0,
          )
        ) {
          candidateSeconds.push(s.evidenceSec);
        }
        if (candidateSeconds.length >= 2) break;
      }

      const captured: EvidenceFrame[] = [];
      for (let idx = 0; idx < candidateSeconds.length; idx++) {
        const requestedSec = candidateSeconds[idx];
        // Never clamp an out-of-bounds timestamp onto the end of a shorter video!
        if (requestedSec > localDuration + 0.75) {
          skippedOutOfRangeCount++;
          continue;
        }

        const actualSec = await seekVideoElement(video, requestedSec);

        // If Gemini provided a bounding box for bestEvidenceSec, capture a tight crop first
        if (idx === 0 && item.bestBox2d && captured.length < 3) {
          const crop = captureBoxCrop(video, item.bestBox2d, actualSec);
          if (crop) {
            captured.push(crop);
          }
        }

        if (captured.length < 3) {
          ctx.drawImage(video, 0, 0, width, height);
          const { dataUrl, dataBase64 } = encodeCanvasWithinBudget(canvas);
          captured.push({
            kind: "video_frame",
            atSec: actualSec,
            mimeType: "image/jpeg",
            dataBase64,
            dataUrl,
            width,
            height,
            label:
              idx === 0
                ? `Best frame @ ${formatTimestamp(actualSec)}`
                : `Scene sighting @ ${formatTimestamp(actualSec)}`,
          });
        }
      }

      if (captured.length > 0) {
        framesByItem[item.itemId] = captured.slice(0, 3);
      }
    }

    const durationVerified =
      typeof expectedYoutubeDurationSec === "number" &&
      Number.isFinite(expectedYoutubeDurationSec) &&
      expectedYoutubeDurationSec > 0;

    let alignmentWarning: string | null = null;
    if (skippedOutOfRangeCount > 0) {
      alignmentWarning = `Skipped ${skippedOutOfRangeCount} out-of-range timestamp(s) exceeding the attached video's ${formatTimestamp(localDuration)} duration.`;
    } else if (!durationVerified) {
      alignmentWarning =
        "Captured frames from attached video at Gemini timestamps (YouTube player duration was unavailable to cross-check clip length).";
    }

    return { framesByItem, alignmentWarning };
  } finally {
    video.pause();
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(objectUrl);
  }
}

/**
 * Reads a user-uploaded reference image with explicit `uploaded_still` provenance
 * (`atSec: null`), so it is never falsely presented as a timestamped video frame.
 */
export async function readCompanionStillImage(
  file: File,
): Promise<EvidenceFrame> {
  const bitmapUrl = URL.createObjectURL(file);
  const img = new Image();
  img.src = bitmapUrl;

  try {
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () =>
        reject(new Error("Could not decode reference image."));
    });

    const scale = Math.min(
      1,
      MAX_FULL_FRAME_DIM /
        Math.max(img.naturalWidth || 1, img.naturalHeight || 1),
    );
    const width = Math.max(1, Math.round(img.naturalWidth * scale));
    const height = Math.max(1, Math.round(img.naturalHeight * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas unavailable.");
    ctx.drawImage(img, 0, 0, width, height);

    const { dataUrl, dataBase64 } = encodeCanvasWithinBudget(canvas);

    return {
      kind: "uploaded_still",
      atSec: null,
      mimeType: "image/jpeg",
      dataBase64,
      dataUrl,
      width,
      height,
      label: "Uploaded reference photo",
    };
  } finally {
    URL.revokeObjectURL(bitmapUrl);
  }
}
