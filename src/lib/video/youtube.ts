const YOUTUBE_ID_REGEX = /^[A-Za-z0-9_-]{11}$/;

const ALLOWED_YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
  "www.youtu.be",
]);

export type NormalizedYouTubeVideo = {
  videoId: string;
  canonicalUrl: string;
  embedUrl: string;
  thumbnailUrl: string;
};

export class YouTubeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "YouTubeUrlError";
  }
}

export function parseAndNormalizeYouTubeUrl(
  rawInput: string,
): NormalizedYouTubeVideo {
  const trimmed = rawInput.trim();
  if (!trimmed) {
    throw new YouTubeUrlError("Please enter a public YouTube URL.");
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new YouTubeUrlError(
      "Invalid URL format. Paste a full https://www.youtube.com/watch?v=... or https://youtu.be/... link.",
    );
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new YouTubeUrlError("YouTube URL must use HTTPS.");
  }

  const host = parsed.hostname.toLowerCase();
  if (!ALLOWED_YOUTUBE_HOSTS.has(host)) {
    throw new YouTubeUrlError(
      `Unsupported video host "${host}". SceneTrace requires a public YouTube link.`,
    );
  }

  let candidateId: string | null = null;
  const pathSegments = parsed.pathname.split("/").filter(Boolean);

  if (host === "youtu.be" || host === "www.youtu.be") {
    candidateId = pathSegments[0] ?? null;
  } else if (parsed.pathname === "/watch") {
    candidateId = parsed.searchParams.get("v");
    if (!candidateId && parsed.searchParams.has("list")) {
      throw new YouTubeUrlError(
        "Playlist-only URLs are not supported. Open a specific video from the playlist and paste its URL.",
      );
    }
  } else if (parsed.pathname === "/playlist") {
    throw new YouTubeUrlError(
      "Playlist URLs are not supported. Please provide a single public YouTube video URL.",
    );
  } else if (
    pathSegments.length >= 2 &&
    (pathSegments[0] === "shorts" ||
      pathSegments[0] === "embed" ||
      pathSegments[0] === "live" ||
      pathSegments[0] === "v")
  ) {
    candidateId = pathSegments[1] ?? null;
  }

  if (!candidateId || !YOUTUBE_ID_REGEX.test(candidateId)) {
    throw new YouTubeUrlError(
      "Could not extract a valid 11-character YouTube video ID from that link.",
    );
  }

  return {
    videoId: candidateId,
    canonicalUrl: `https://www.youtube.com/watch?v=${candidateId}`,
    embedUrl: `https://www.youtube.com/embed/${candidateId}`,
    thumbnailUrl: `https://i.ytimg.com/vi/${candidateId}/hqdefault.jpg`,
  };
}

/**
 * Maps clip-local timestamps back onto the original full video timeline.
 * Clamps negative drift to 0 and optionally caps at `videoDurationSec` if known.
 */
export function mapClipTimestampToOriginal(
  clipRelativeSec: number,
  clipStartOffsetSec = 0,
  videoDurationSec?: number,
): number {
  if (!Number.isFinite(clipRelativeSec)) return Math.max(0, clipStartOffsetSec);
  const offset = Number.isFinite(clipStartOffsetSec) ? clipStartOffsetSec : 0;
  const raw = Math.max(0, Math.round((clipRelativeSec + offset) * 10) / 10);
  if (
    typeof videoDurationSec === "number" &&
    Number.isFinite(videoDurationSec) &&
    videoDurationSec > 0
  ) {
    return Math.min(raw, Math.round(videoDurationSec * 10) / 10);
  }
  return raw;
}

export function formatTimestamp(sec: number): string {
  const safe = Math.max(0, Math.floor(Number.isFinite(sec) ? sec : 0));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function buildYouTubeTimestampUrl(
  videoId: string,
  seconds: number,
): string {
  const wholeSec = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&t=${wholeSec}s`;
}
