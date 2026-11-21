import crypto from "node:crypto";

/**
 * Only models smoke-verified on this project's API key are exposed.
 */
export const ALLOWED_VIDEO_MODELS = [
  "gemini-4-neon",
  "gemini-4-carbon",
] as const;

export type AllowedVideoModel = (typeof ALLOWED_VIDEO_MODELS)[number];

export function getGeminiApiKey(): string {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) {
    throw new Error(
      "Missing GEMINI_API_KEY in server environment. Set it in .env or Vercel Project Settings.",
    );
  }
  return key;
}

export function getDefaultVideoModel(): AllowedVideoModel {
  const envModel = process.env.GEMINI_VIDEO_MODEL?.trim();
  if (
    envModel &&
    (ALLOWED_VIDEO_MODELS as readonly string[]).includes(envModel)
  ) {
    return envModel as AllowedVideoModel;
  }
  return "gemini-4-neon";
}

export function resolveVideoModel(requested?: string | null): AllowedVideoModel {
  const trimmed = requested?.trim();
  if (
    trimmed &&
    (ALLOWED_VIDEO_MODELS as readonly string[]).includes(trimmed)
  ) {
    return trimmed as AllowedVideoModel;
  }
  return getDefaultVideoModel();
}

export function getDecisionsModel(): string {
  return process.env.GEMINI_DECISIONS_MODEL?.trim() || "gemini-decision-1";
}

export function getShopLocaleDefaults(): { country: string; currency: string } {
  return {
    country: (process.env.SHOP_COUNTRY?.trim() || "US").toUpperCase(),
    currency: (process.env.SHOP_CURRENCY?.trim() || "USD").toUpperCase(),
  };
}

/**
 * Derives a 256-bit server signing/encryption key.
 * Fails closed when no high-entropy secret material is configured (never falls back to a public constant).
 */
export function getServerSecretKey(): Buffer {
  const explicit = process.env.APP_SECRET?.trim();
  const isProd =
    process.env.VERCEL_ENV === "production" ||
    process.env.NODE_ENV === "production";

  if (explicit) {
    if (explicit.length < 32 && isProd) {
      throw new Error(
        "APP_SECRET must be at least 32 characters in production.",
      );
    }
    if (explicit.length >= 16) {
      return crypto
        .createHash("sha256")
        .update(`scenetrace:app-secret:v1:${explicit}`)
        .digest();
    }
  }

  const geminiKey = process.env.GEMINI_API_KEY?.trim();
  if (geminiKey && geminiKey.length >= 20) {
    return crypto
      .createHmac("sha256", "scenetrace-kdf-v1")
      .update(geminiKey)
      .digest();
  }

  throw new Error(
    "Missing cryptographic signing secret: set APP_SECRET (>=32 chars) or GEMINI_API_KEY on the server.",
  );
}

export function resolveAppOrigin(requestUrl?: string): string {
  if (process.env.APP_ORIGIN?.trim()) {
    return process.env.APP_ORIGIN.trim().replace(/\/$/, "");
  }
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim()) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL.trim()}`;
  }
  if (process.env.VERCEL_URL?.trim()) {
    return `https://${process.env.VERCEL_URL.trim()}`;
  }
  if (requestUrl) {
    try {
      return new URL(requestUrl).origin;
    } catch {
      // ignore invalid requestUrl
    }
  }
  return "http://localhost:3000";
}
