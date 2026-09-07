import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AdaptiveFeatures, AdaptiveRecallAction } from "../../src/core/hooks/adaptive-policy.js";
import type { CodingTaskOutcome, PairedCodingFeedback } from "../../src/core/hooks/coding-feedback.js";

type JsonObject = Record<string, unknown>;

interface ReplayIndexEntry {
  scope: string;
  features: AdaptiveFeatures;
}

interface TraceEntry {
  tokens: number;
  action?: AdaptiveRecallAction;
  retries?: number;
  staleEvidenceUsed?: boolean;
  conflictRisk?: number;
  userCorrected?: boolean;
}

function arg(name: string, fallback = ""): string {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1]! : fallback;
}

function isObject(value: unknown): value is JsonObject {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function idOf(row: JsonObject): string | null {
  const value = row.instance_id ?? row.task_id ?? row.taskId;
  return typeof value === "string" && value.trim() ? value : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function expandAggregateReport(report: JsonObject): JsonObject[] | null {
  const resolved = new Set(stringArray(report.resolved_ids));
  const unresolved = new Set(stringArray(report.unresolved_ids));
  const completed = new Set(stringArray(report.completed_ids));
  const errors = new Set(stringArray(report.error_ids));
  if (!resolved.size && !unresolved.size && !completed.size && !errors.size) return null;
  const ids = new Set([...resolved, ...unresolved, ...completed]);
  return [...ids].filter((id) => !errors.has(id)).map((instance_id) => ({ instance_id, resolved: resolved.has(instance_id) }));
}

function expandJson(value: unknown): JsonObject[] {
  if (Array.isArray(value)) return value.filter(isObject);
  if (!isObject(value)) throw new Error("Expected a JSON object, array, or JSONL records");
  const aggregate = expandAggregateReport(value);
  if (aggregate) return aggregate;
  if (idOf(value)) return [value];
  for (const key of ["results", "instances", "records"]) {
    if (Array.isArray(value[key])) return value[key].filter(isObject);
  }
  const mapped = Object.entries(value).filter(([, item]) => isObject(item));
  if (mapped.length) return mapped.map(([instance_id, item]) => ({ instance_id, ...(item as JsonObject) }));
  return [];
}

async function readRecords(file: string): Promise<JsonObject[]> {
  const text = await readFile(file, "utf8");
  try {
    return expandJson(JSON.parse(text) as unknown);
  } catch (error) {
    const rows: JsonObject[] = [];
    for (const [index, line] of text.split(/\r?\n/).entries()) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line) as unknown;
        if (!isObject(parsed)) throw new Error("row is not an object");
        rows.push(parsed);
      } catch (lineError) {
        throw new Error(`Invalid JSONL at ${file}:${index + 1}: ${String(lineError)}`, { cause: error });
      }
    }
    return rows;
  }
}

function bool(row: JsonObject, ...keys: string[]): boolean | undefined {
  for (const key of keys) if (typeof row[key] === "boolean") return row[key] as boolean;
  return undefined;
}

function number(row: JsonObject, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const value = Number(row[key]);
    if (Number.isFinite(value)) return value;
  }
  return undefined;
}

function statusObject(row: JsonObject): JsonObject | null {
  const value = row.tests_status ?? row.testsStatus;
  return isObject(value) ? value : null;
}

function testCounts(row: JsonObject): { passed?: number; total?: number; regression?: boolean } {
  const directPassed = number(row, "tests_passed", "testsPassed");
  const directTotal = number(row, "tests_total", "testsTotal");
  if (directPassed != null && directTotal != null) return { passed: directPassed, total: directTotal, regression: bool(row, "regression") };
  const status = statusObject(row);
  if (!status) return { regression: bool(row, "regression") };
  let passed = 0;
  let total = 0;
  let regression = false;
  for (const groupName of ["FAIL_TO_PASS", "PASS_TO_PASS"]) {
    const group = status[groupName];
    if (!isObject(group)) continue;
    const success = stringArray(group.success);
    const failure = stringArray(group.failure);
    passed += success.length;
    total += success.length + failure.length;
    if (groupName === "PASS_TO_PASS" && failure.length > 0) regression = true;
  }
  return total > 0 ? { passed, total, regression } : { regression: bool(row, "regression") };
}

function toOutcome(row: JsonObject, trace: TraceEntry): CodingTaskOutcome {
  const tests = testCounts(row);
  return {
    passAt1: bool(row, "resolved", "pass_at_1", "passAt1", "task_passed", "taskPassed"),
    patchApplied: bool(row, "patch_successfully_applied", "patch_applied", "patchApplied"),
    compileOk: bool(row, "compile_ok", "compileOk"),
    testsPassed: tests.passed,
    testsTotal: tests.total,
    regression: tests.regression,
    retries: trace.retries,
    staleEvidenceUsed: trace.staleEvidenceUsed,
    conflictRisk: trace.conflictRisk,
    userCorrected: trace.userCorrected,
  };
}

function hasQualitySignal(outcome: CodingTaskOutcome): boolean {
  return typeof (outcome.passAt1 ?? outcome.taskPassed) === "boolean"
    || typeof outcome.patchApplied === "boolean"
    || typeof outcome.compileOk === "boolean"
    || (Number.isFinite(outcome.testsPassed) && Number.isFinite(outcome.testsTotal) && Number(outcome.testsTotal) > 0);
}

function traceFrom(row: JsonObject): TraceEntry | null {
  const tokens = number(row, "injected_tokens", "memory_tokens", "context_tokens", "input_tokens");
  if (tokens == null || tokens < 0) return null;
  const action = row.action;
  return {
    tokens,
    action: action === "top10" || action === "top8" || action === "top5" || action === "top5-l0" ? action : undefined,
    retries: number(row, "retries"),
    staleEvidenceUsed: bool(row, "stale_evidence_used", "staleEvidenceUsed"),
    conflictRisk: number(row, "conflict_risk", "conflictRisk"),
    userCorrected: bool(row, "user_corrected", "userCorrected"),
  };
}

async function keyed(file: string): Promise<Map<string, JsonObject>> {
  const map = new Map<string, JsonObject>();
  for (const row of await readRecords(file)) {
    const id = idOf(row);
    if (!id) throw new Error(`Record in ${file} is missing instance_id`);
    if (map.has(id)) throw new Error(`Duplicate instance_id ${id} in ${file}`);
    map.set(id, row);
  }
  return map;
}

async function traceIndex(file: string): Promise<Map<string, TraceEntry>> {
  const map = new Map<string, TraceEntry>();
  for (const row of await readRecords(file)) {
    const id = idOf(row);
    if (!id) throw new Error(`Trace record in ${file} is missing instance_id`);
    const trace = traceFrom(row);
    if (!trace) throw new Error(`Trace ${id} in ${file} is missing a finite token count`);
    if (map.has(id)) throw new Error(`Duplicate trace instance_id ${id} in ${file}`);
    map.set(id, trace);
  }
  return map;
}

async function replayIndex(file: string): Promise<Map<string, ReplayIndexEntry>> {
  const map = new Map<string, ReplayIndexEntry>();
  for (const row of await readRecords(file)) {
    const id = idOf(row);
    if (!id || typeof row.scope !== "string" || !isObject(row.query_features)) throw new Error(`Invalid replay record in ${file}`);
    map.set(id, { scope: row.scope, features: row.query_features as unknown as AdaptiveFeatures });
  }
  return map;
}

const actionResultsPath = path.resolve(arg("--action-results"));
const baselineResultsPath = path.resolve(arg("--baseline-results"));
const actionTracePath = path.resolve(arg("--action-trace"));
const baselineTracePath = path.resolve(arg("--baseline-trace"));
const replayPath = path.resolve(arg("--replay", "scripts/topic3-c/data/swebench-verified/pilot-v1.jsonl"));
const output = path.resolve(arg("--output", "artifacts/topic3-c/swebench/pilot-v1-paired-feedback.jsonl"));
const auditOutput = path.resolve(arg("--audit-output", "artifacts/topic3-c/swebench/pilot-v1-feedback-audit.json"));
const defaultAction = arg("--action", "top5-l0") as AdaptiveRecallAction;
const evidenceLevel = arg("--evidence-level");
if (!["top10", "top8", "top5", "top5-l0"].includes(defaultAction)) throw new Error(`Unsupported action: ${defaultAction}`);
if (evidenceLevel !== "official" && evidenceLevel !== "synthetic-contract") {
  throw new Error("--evidence-level must be official or synthetic-contract");
}
if ([actionResultsPath, baselineResultsPath, actionTracePath, baselineTracePath].some((file) => !file || file === path.resolve("."))) {
  throw new Error("--action-results, --baseline-results, --action-trace, and --baseline-trace are required");
}

const [actionResults, baselineResults, actionTraces, baselineTraces, replay] = await Promise.all([
  keyed(actionResultsPath), keyed(baselineResultsPath), traceIndex(actionTracePath), traceIndex(baselineTracePath), replayIndex(replayPath),
]);
const included: PairedCodingFeedback[] = [];
const excluded: Array<{ task_id: string; reason: string }> = [];
for (const [taskId, task] of replay) {
  const actionResult = actionResults.get(taskId);
  const baselineResult = baselineResults.get(taskId);
  const actionTrace = actionTraces.get(taskId);
  const baselineTrace = baselineTraces.get(taskId);
  if (!actionResult || !baselineResult) { excluded.push({ task_id: taskId, reason: "missing paired harness result" }); continue; }
  if (!actionTrace || !baselineTrace) { excluded.push({ task_id: taskId, reason: "missing paired token trace" }); continue; }
  if (baselineTrace.tokens <= 0) { excluded.push({ task_id: taskId, reason: "Top-10 baseline token count must be positive" }); continue; }
  const actionOutcome = toOutcome(actionResult, actionTrace);
  const baselineOutcome = toOutcome(baselineResult, baselineTrace);
  if (!hasQualitySignal(actionOutcome) || !hasQualitySignal(baselineOutcome)) {
    excluded.push({ task_id: taskId, reason: "missing patch/pass@1/compile/test quality signal" });
    continue;
  }
  included.push({
    scope: task.scope,
    taskId,
    action: actionTrace.action ?? defaultAction,
    actionTokens: actionTrace.tokens,
    baselineTokens: baselineTrace.tokens,
    actionOutcome,
    baselineOutcome,
    features: task.features,
  });
}

const audit = {
  protocol: "topic3-c-swebench-feedback-adapter-v1",
  evidence_level: evidenceLevel,
  replay: replayPath,
  inputs: { action_results: actionResultsPath, baseline_results: baselineResultsPath, action_trace: actionTracePath, baseline_trace: baselineTracePath },
  replay_tasks: replay.size,
  paired_feedback_rows: included.length,
  excluded_count: excluded.length,
  excluded,
  ready_for_policy_update: evidenceLevel === "official" && included.length > 0,
  note: evidenceLevel === "official"
    ? "Official harness outcomes are joined with paired memory-token traces. Missing observations are not converted to failures."
    : "Synthetic contract validation only. These rows must not update a learned policy or support an effectiveness claim.",
};
await mkdir(path.dirname(output), { recursive: true });
await mkdir(path.dirname(auditOutput), { recursive: true });
await Promise.all([
  writeFile(output, included.length ? `${included.map((row) => JSON.stringify(row)).join("\n")}\n` : "", "utf8"),
  writeFile(auditOutput, `${JSON.stringify(audit, null, 2)}\n`, "utf8"),
]);
console.log(JSON.stringify({ output, auditOutput, replay_tasks: replay.size, paired_feedback_rows: included.length, excluded_count: excluded.length }, null, 2));
