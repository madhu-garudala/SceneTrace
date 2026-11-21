import fs from "node:fs";
import path from "node:path";

/** Append one JSON line per routed turn. Never throws. */
export function journalTurn(entry: Record<string, unknown>): void {
  if (process.env.VITEST) return;
  try {
    const now = new Date();
    const dir = path.join(process.cwd(), "transcripts");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${now.toISOString().slice(0, 10)}.jsonl`);
    fs.appendFileSync(
      file,
      JSON.stringify({ at: now.toISOString(), ...entry }) + "\n",
    );
  } catch {
    // journaling must never break a turn
  }
}
