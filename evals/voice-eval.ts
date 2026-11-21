import fs from "node:fs";
import path from "node:path";
import { routeUtterance } from "../src/lib/voice/intent";
import type { VoiceContext, VoiceIntent } from "../src/lib/voice/types";

const envPath = path.resolve(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#") || !t.includes("=")) continue;
    const [k, ...r] = t.split("=");
    if (!process.env[k.trim()]) process.env[k.trim()] = r.join("=").trim().replace(/^['"]|['"]$/g, "");
  }
}

const base: VoiceContext = { source: "youtube", hasCapture: false, hasItems: false, hasOffers: false, busy: false };
const items: VoiceContext = { ...base, hasItems: true };
const offers: VoiceContext = { ...base, hasItems: true, hasOffers: true };
const cam: VoiceContext = { ...base, source: "camera" };
const camShot: VoiceContext = { ...cam, hasCapture: true };

const rows: [string, VoiceContext, VoiceIntent[]][] = [
  ["use the camera", base, ["switch_to_camera"]],
  ["switch to my camera", base, ["switch_to_camera"]],
  ["go back to the video", cam, ["switch_to_youtube"]],
  ["use a YouTube link", cam, ["switch_to_youtube"]],
  ["take the picture", cam, ["capture"]],
  ["snap it", cam, ["capture"]],
  ["which watch is this", base, ["trace"]],
  ["what are these headphones", camShot, ["trace"]],
  ["little bit my watch", base, ["trace"]],
  ["find this", camShot, ["trace"]],
  ["under 100 dollars", offers, ["refine"]],
  ["in black", offers, ["refine"]],
  ["size 10", offers, ["refine"]],
  ["the second one", offers, ["select_offer"]],
  ["the cheaper one", offers, ["select_offer"]],
  ["buy it", offers, ["checkout"]],
  ["I'll take it", offers, ["checkout"]],
  ["added to my card", offers, ["checkout"]],
  ["add it to the car", offers, ["checkout"]],
  ["I want to buy a new one", offers, ["checkout"]],
  ["just buy it", offers, ["checkout"]],
  ["this is broken", items, ["diagnose"]],
  ["something's wrong with it", items, ["diagnose"]],
  ["is it worth fixing", items, ["diagnose"]],
  ["check it for damage", items, ["diagnose"]],
  ["is it worth fixing or should I buy new", items, ["diagnose", "unknown"]],
  ["next one", offers, ["next_item"]],
  ["scan something else", offers, ["next_item"]],
  ["start over", offers, ["next_item"]],
  ["why", items, ["show_evidence"]],
  ["how do you know", items, ["show_evidence"]],
  ["stop", offers, ["stop"]],
  ["be quiet", offers, ["stop"]],
  ["never mind", offers, ["stop"]],
  ["then", base, ["unknown"]],
  ["laundrom", base, ["unknown"]],
  ["can you", base, ["unknown"]],
  ["look at this card holder", camShot, ["trace"]],
];

async function main() {
  let pass = 0;
  for (const [utt, ctx, want] of rows) {
    const t0 = Date.now();
    const r = await routeUtterance(utt, ctx);
    const ok = want.includes(r.intent);
    if (ok) pass++;
    console.log(
      `${ok ? "PASS" : "FAIL"}  ${utt.padEnd(40)} want=${want.join("|").padEnd(18)} got=${r.intent.padEnd(15)} conf=${r.confidence.toFixed(2)} ${Date.now() - t0}ms${r.normalized ? ` norm="${r.normalized}"` : ""} slots=${JSON.stringify(r.slots)}`,
    );
  }
  console.log(`\nTOTAL ${pass}/${rows.length}`);
}
main();
