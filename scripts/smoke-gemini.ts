import fs from "node:fs";
import path from "node:path";
import { extractItemsFromYouTube } from "../src/lib/video/extract";
import { parseAndNormalizeYouTubeUrl } from "../src/lib/video/youtube";

function loadDotEnv() {
  const envPath = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const [k, ...rest] = trimmed.split("=");
    const v = rest.join("=").trim().replace(/^['"]|['"]$/g, "");
    if (!process.env[k.trim()]) process.env[k.trim()] = v;
  }
}

async function main() {
  loadDotEnv();
  const rawUrl =
    process.argv[2] || "https://www.youtube.com/shorts/8nJbKQYEH2M";
  const question =
    process.argv[3] ||
    "Which watch appears in this clip and what are its distinguishing features?";
  const modelArg = process.argv[4] || undefined;

  const normalized = parseAndNormalizeYouTubeUrl(rawUrl);
  console.log(
    `[smoke:gemini] Extracting items from ${normalized.canonicalUrl} (model=${modelArg || "default"}) ...`,
  );

  const result = await extractItemsFromYouTube({
    canonicalYoutubeUrl: normalized.canonicalUrl,
    question,
    requestedModel: modelArg,
  });

  console.log("[smoke:gemini] Diagnostics:", result.diagnostics);
  console.log(
    `[smoke:gemini] Extracted ${result.items.length} item(s):`,
    JSON.stringify(result.items, null, 2),
  );
}

main().catch((err) => {
  console.error("[smoke:gemini] FAILED:", err);
  process.exit(1);
});
