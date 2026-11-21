import crypto from "node:crypto";
import { getServerSecretKey } from "@/lib/env";
import type {
  CheckoutLink,
  OfferOption,
  SignedOfferPayload,
} from "@/lib/types";

const OFFER_TTL_MS = 1000 * 60 * 60 * 6; // 6 hours
const CHECKOUT_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

export type EncryptedCheckoutTokenPayload = {
  checkoutId: string;
  shop: string;
  continueUrl: string;
  sellerName: string;
  variantId: string;
  title: string;
  options: OfferOption[];
  subtotalMinor: number | null;
  totalMinor: number | null;
  currency: string | null;
  warnings: string[];
  links?: CheckoutLink[];
  issuedAt: number;
  expiresAt: number;
};

function base64UrlEncode(buf: Buffer): string {
  return buf.toString("base64url");
}

function base64UrlDecode(input: string): Buffer {
  return Buffer.from(input, "base64url");
}

/**
 * Signs an offer payload with HMAC-SHA256 so any Vercel serverless instance can
 * validate the exact server-approved merchant, product, variant, and options
 * without requiring sticky in-memory state or an external database.
 */
export function signOfferToken(
  payload: Omit<SignedOfferPayload, "issuedAt" | "expiresAt">,
  secretOverride?: Buffer,
): string {
  const now = Date.now();
  const fullPayload: SignedOfferPayload = {
    ...payload,
    issuedAt: now,
    expiresAt: now + OFFER_TTL_MS,
  };
  const key = secretOverride ?? getServerSecretKey();
  const body = base64UrlEncode(
    Buffer.from(JSON.stringify(fullPayload), "utf8"),
  );
  const sig = crypto
    .createHmac("sha256", key)
    .update(`offer.v1.${body}`)
    .digest();
  return `${body}.${base64UrlEncode(sig)}`;
}

export function verifyOfferToken(
  token: string,
  secretOverride?: Buffer,
): SignedOfferPayload {
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error("Invalid offer token format.");
  }
  const [body, providedSigB64] = parts;
  const key = secretOverride ?? getServerSecretKey();
  const expectedSig = crypto
    .createHmac("sha256", key)
    .update(`offer.v1.${body}`)
    .digest();
  const providedSig = base64UrlDecode(providedSigB64);

  if (
    providedSig.length !== expectedSig.length ||
    !crypto.timingSafeEqual(providedSig, expectedSig)
  ) {
    throw new Error("Offer token signature verification failed.");
  }

  const parsed = JSON.parse(
    base64UrlDecode(body).toString("utf8"),
  ) as SignedOfferPayload;

  if (
    typeof parsed.expiresAt !== "number" ||
    Date.now() > parsed.expiresAt ||
    !parsed.variantId ||
    !parsed.sellerDomain
  ) {
    throw new Error("Offer session has expired. Please re-run the item match.");
  }

  return parsed;
}

/**
 * Encrypts sensitive provider checkout references (`checkoutId`, `continueUrl`, `shop`)
 * using AES-256-GCM so raw Shopify checkout identifiers are never exposed in client URLs
 * or browser logs, while still allowing stateless recovery on any Vercel serverless node.
 */
export function encryptCheckoutRef(
  payload: Omit<EncryptedCheckoutTokenPayload, "issuedAt" | "expiresAt">,
  secretOverride?: Buffer,
): string {
  const now = Date.now();
  const fullPayload: EncryptedCheckoutTokenPayload = {
    ...payload,
    issuedAt: now,
    expiresAt: now + CHECKOUT_TTL_MS,
  };
  const key = secretOverride ?? getServerSecretKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from("scenetrace.checkout.v1", "utf8"));
  const plaintext = Buffer.from(JSON.stringify(fullPayload), "utf8");
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${base64UrlEncode(iv)}.${base64UrlEncode(encrypted)}.${base64UrlEncode(authTag)}`;
}

export function decryptCheckoutRef(
  checkoutRef: string,
  secretOverride?: Buffer,
): EncryptedCheckoutTokenPayload {
  const parts = checkoutRef.split(".");
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
    throw new Error("Invalid checkout reference.");
  }
  const [ivB64, ctB64, tagB64] = parts;
  const key = secretOverride ?? getServerSecretKey();
  const iv = base64UrlDecode(ivB64);
  const ciphertext = base64UrlDecode(ctB64);
  const authTag = base64UrlDecode(tagB64);

  if (iv.length !== 12 || authTag.length !== 16) {
    throw new Error("Malformed checkout reference envelope.");
  }

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAAD(Buffer.from("scenetrace.checkout.v1", "utf8"));
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);
  const parsed = JSON.parse(
    decrypted.toString("utf8"),
  ) as EncryptedCheckoutTokenPayload;

  if (typeof parsed.expiresAt !== "number" || Date.now() > parsed.expiresAt) {
    throw new Error("Checkout reference has expired.");
  }
  return parsed;
}
