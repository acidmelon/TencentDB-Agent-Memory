import { readFile } from "node:fs/promises";
import path from "node:path";
import { updateAdaptiveRecallPolicy, type AdaptiveFeedback } from "../../src/core/hooks/adaptive-policy.js";

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] ?? fallback : fallback;
}

const input = arg("--input");
if (!input) throw new Error("Usage: tsx update-adaptive-policy.ts --input feedback.jsonl --root <data-dir>");
const root = path.resolve(arg("--root", ".")!);
const enabled = arg("--enabled", "true") === "true";
const shadow = arg("--shadow", "false") === "true";
const minObservations = Number(arg("--min-observations", "20"));
const tokenSavingsWeight = Number(arg("--token-savings-weight", "0.25"));
const rows = (await readFile(path.resolve(input), "utf8"))
  .split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as AdaptiveFeedback);

for (const feedback of rows) {
  const result = await updateAdaptiveRecallPolicy(root, { enabled, shadow, minObservations, tokenSavingsWeight }, feedback);
  console.log(JSON.stringify({ scope: feedback.scope, action: feedback.action, reward: result.reward, observations: (result.state as { observations?: number }).observations }));
}
