import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

type CacheEntry<T> = {
  value: T;
  createdAt: number;
  expiresAt: number;
};

const MAX_MEMORY_ENTRIES = 120;
const memoryStore = new Map<string, CacheEntry<unknown>>();
const inFlightMap = new Map<string, Promise<unknown>>();

function getDiskCacheDir(): string {
  return path.join(os.tmpdir(), "scenetrace-cache-v1");
}

export function buildCacheKey(
  namespace: string,
  payload: Record<string, unknown>,
): string {
  const digest = crypto
    .createHash("sha256")
    .update(`${namespace}:${JSON.stringify(payload)}`)
    .digest("hex");
  return `${namespace}_${digest.slice(0, 32)}`;
}

function readFromDisk<T>(key: string): CacheEntry<T> | null {
  try {
    const filePath = path.join(getDiskCacheDir(), `${key}.json`);
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as CacheEntry<T>;
    if (
      typeof parsed?.expiresAt !== "number" ||
      Date.now() > parsed.expiresAt
    ) {
      fs.unlinkSync(filePath);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeToDisk<T>(key: string, entry: CacheEntry<T>): void {
  try {
    const dir = getDiskCacheDir();
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, `${key}.json`);
    fs.writeFileSync(filePath, JSON.stringify(entry), "utf8");
  } catch {
    // Non-fatal if filesystem is read-only
  }
}

function setMemoryEntry<T>(key: string, entry: CacheEntry<T>): void {
  if (memoryStore.has(key)) {
    memoryStore.delete(key);
  } else if (memoryStore.size >= MAX_MEMORY_ENTRIES) {
    const oldestKey = memoryStore.keys().next().value;
    if (oldestKey) memoryStore.delete(oldestKey);
  }
  memoryStore.set(key, entry as CacheEntry<unknown>);
}

/**
 * Two-layer server cache (in-process LRU + OS `/tmp` JSON persistence across local reloads
 * and warm Vercel serverless invocations) with in-flight request deduplication.
 */
export async function withServerCache<T>(params: {
  key: string;
  ttlMs: number;
  bypass?: boolean;
  compute: () => Promise<T>;
}): Promise<{ value: T; cacheHit: boolean }> {
  const { key, ttlMs, bypass = false, compute } = params;
  const now = Date.now();

  if (!bypass) {
    const mem = memoryStore.get(key) as CacheEntry<T> | undefined;
    if (mem && now <= mem.expiresAt) {
      // Refresh LRU position
      setMemoryEntry(key, mem);
      return { value: mem.value, cacheHit: true };
    }

    const disk = readFromDisk<T>(key);
    if (disk && now <= disk.expiresAt) {
      setMemoryEntry(key, disk);
      return { value: disk.value, cacheHit: true };
    }

    const existingPromise = inFlightMap.get(key) as Promise<T> | undefined;
    if (existingPromise) {
      const sharedValue = await existingPromise;
      return { value: sharedValue, cacheHit: true };
    }
  }

  const runPromise = compute();
  inFlightMap.set(key, runPromise);

  try {
    const freshValue = await runPromise;
    const entry: CacheEntry<T> = {
      value: freshValue,
      createdAt: Date.now(),
      expiresAt: Date.now() + ttlMs,
    };
    setMemoryEntry(key, entry);
    writeToDisk(key, entry);
    return { value: freshValue, cacheHit: false };
  } finally {
    if (inFlightMap.get(key) === runPromise) {
      inFlightMap.delete(key);
    }
  }
}

export function clearServerCacheForTests(): void {
  memoryStore.clear();
  inFlightMap.clear();
}
