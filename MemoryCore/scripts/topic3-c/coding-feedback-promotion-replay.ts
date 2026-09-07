import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AdaptiveRecallPolicy } from "../../src/core/hooks/adaptive-policy.js";
import { toAdaptiveCodingFeedback, toPromotionObservation, type PairedCodingFeedback } from "../../src/core/hooks/coding-feedback.js";
import { AdaptivePromotionGate, decideWithPromotionGate } from "../../src/core/hooks/promotion-gate.js";

interface ReplayResult {
  task_id: string;
  gate_before: string;
  policy_action: string;
  active_action: string;
  reward: number;
  gate_after: string;
  gate_reason: string;
  quality_lower_bound: number;
  token_savings_lower_bound: number;
}

function arg(name: string, fallback = ""): string {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1]! : fallback;
}

function smokeRows(): PairedCodingFeedback[] {
  const scope = "smoke-team/smoke-agent/smoke-repo";
  const good = Array.from({ length: 24 }, (_, index): PairedCodingFeedback => ({
    scope,
    taskId: `coding-task-${String(index + 1).padStart(2, "0")}`,
    action: "top5-l0",
    actionTokens: 700 + (index % 3) * 10,
    baselineTokens: 1000,
    actionOutcome: { passAt1: true, compileOk: true, testsPassed: 10, testsTotal: 10 },
    baselineOutcome: { passAt1: false, compileOk: true, testsPassed: 8, testsTotal: 10 },
    features: { queryLength: 140, hasCodeCue: true, fileCount: 2, functionCount: 3, stackTracePresent: index % 2 === 0 },
  }));
  return [
    ...good,
    {
      scope,
      taskId: "coding-task-regression",
      action: "top5-l0",
      actionTokens: 720,
      baselineTokens: 1000,
      actionOutcome: { passAt1: false, compileOk: false, testsPassed: 0, testsTotal: 10, regression: true, staleEvidenceUsed: true },
      baselineOutcome: { passAt1: true, compileOk: true, testsPassed: 10, testsTotal: 10 },
      features: { queryLength: 180, hasCodeCue: true, fileCount: 3, dependencyChange: true, staleEvidenceRisk: 1 },
    },
  ];
}

const input = arg("--input");
const output = path.resolve(arg("--output", "artifacts/topic3-c/coding-feedback-promotion-smoke.json"));
const rows = input
  ? (await readFile(path.resolve(input), "utf8")).split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as PairedCodingFeedback)
  : smokeRows();
if (!rows.length) throw new Error("Coding feedback replay requires at least one row");

const stateRoot = await mkdtemp(path.join(os.tmpdir(), "tdai-coding-feedback-"));
try {
  const policy = new AdaptiveRecallPolicy(stateRoot, {
    enabled: true,
    shadow: false,
    minObservations: 24,
    minActionObservations: 8,
    tokenSavingsWeight: 0.15,
    qualityTolerance: -0.005,
    decisionMargin: 0.01,
  });
  const gate = new AdaptivePromotionGate(stateRoot, {
    minObservations: 24,
    minCodingObservations: 24,
    minCodingCoverage: 0.8,
    minTokenSavingsRate: 0.1,
    qualityTolerance: 0.005,
    confidenceZ: 1.645,
    maxFallbackRate: 0.1,
    autoPromote: true,
  });
  const results: ReplayResult[] = [];
  for (const row of rows) {
    const gated = await decideWithPromotionGate(policy, gate, row.scope, row.features ?? { queryLength: 0, hasCodeCue: true });
    const update = await policy.update(toAdaptiveCodingFeedback(row));
    const after = await gate.record(toPromotionObservation(row));
    results.push({
      task_id: row.taskId,
      gate_before: gated.promotion.stage,
      policy_action: gated.candidateDecision.action,
      active_action: gated.activeDecision.action,
      reward: update.reward,
      gate_after: after.stage,
      gate_reason: after.reason,
      quality_lower_bound: after.qualityLowerBound,
      token_savings_lower_bound: after.tokenSavingsLowerBound,
    });
  }
  const final = await gate.status(rows[rows.length - 1]!.scope);
  const report = {
    protocol: "topic3-c-coding-feedback-promotion-replay-v1",
    input: input ? path.resolve(input) : null,
    evidence_level: input ? "external paired coding outcomes" : "synthetic smoke only; mechanism validation, not an effectiveness claim",
    row_count: rows.length,
    promotion_task: results.find((row) => row.gate_after === "promoted")?.task_id ?? null,
    demotion_task: results.find((row) => row.gate_after === "demoted")?.task_id ?? null,
    active_action_counts: Object.fromEntries(["top10", "top5-l0"].map((action) => [action, results.filter((row) => row.active_action === action).length])),
    final,
    results,
  };
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ output, row_count: report.row_count, promotion_task: report.promotion_task, demotion_task: report.demotion_task, final: report.final }, null, 2));
} finally {
  await rm(stateRoot, { recursive: true, force: true });
}
