import fs from "node:fs";
import path from "node:path";
import { runManagedAgentInvestigation } from "../src/lib/agent/managed-agent";
import type { TracedItem } from "../src/lib/types";

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

  const item: TracedItem = {
    itemId: "agent_smoke_1",
    category: "wristwatch",
    label: "Compact Black Rectangular Digital Watch with Blue Trim",
    summary:
      "Classic compact black resin digital watch with thin blue border around LCD and alarm/chronograph text.",
    sightings: [
      {
        startSec: 12,
        endSec: 18,
        evidenceSec: 15,
        observation: "Close-up of black resin digital watch on wrist",
      },
    ],
    bestEvidenceSec: 15,
    features: [
      { name: "primary_color", value: "black resin", atSec: 15, source: "visible" },
      { name: "trim", value: "thin blue border on dial", atSec: 15, source: "visible" },
      { name: "display", value: "rectangular digital LCD", atSec: 15, source: "visible" },
    ],
    brand: "Casio",
    modelReference: null,
    searchQueries: ["Casio black rectangular digital watch blue trim"],
  };

  console.log("[smoke:agent] Running Saved Managed Agent in remote sandbox...");
  const { report, updatedItem } = await runManagedAgentInvestigation({
    item,
    question: "Which watch is worn in this video?",
  });

  console.log("[smoke:agent] Report:", JSON.stringify(report, null, 2));
  console.log("[smoke:agent] Enriched searchQueries:", updatedItem.searchQueries);
}

main().catch((err) => {
  console.error("[smoke:agent] FAILED:", err);
  process.exit(1);
});
