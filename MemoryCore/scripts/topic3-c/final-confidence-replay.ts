import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

type Action = "top10" | "top5" | "k5-l0-1" | "k5-l0-2";
type Metric = { token_f1: number; token_recall: number; input_tokens: number };
type Row = {
  dialogId: string;
  queryId: string;
  features: number[];
  actions: Record<Action, Metric>;
};
type Observation = { action: Action; features: number[]; f1: number; recall: number; scope: boolean };
type Estimate = {
  f1: number;
  recall: number;
  f1_se: number;
  recall_se: number;
  effective_neighbors: number;
};
type Result = {
  dialog_id: string;
  query_id: string;
  action: Action;
  reason: "warmup" | "explore" | "learned" | "baseline" | "budget";
  phase: "onboarding" | "evaluation";
  selected: Metric;
  top10: Metric;
  prediction: Estimate;
  lower: { f1: number; recall: number };
};

const ACTIONS: Action[] = ["top10", "top5", "k5-l0-1", "k5-l0-2"];
const COMPACT = ACTIONS.filter((action) => action !== "top10");
const DEV_DIALOGS = new Set(["locomo-8", "locomo-9", "locomo-0"]);
const VALIDATION_DIALOGS = new Set(["locomo-1", "locomo-7"]);
const CONFIDENCE_MULTIPLIERS = [0, 0.5, 1] as const;
const KNN_NEIGHBORS = 32;
const ONBOARDING_QUERIES = 24;
const WARMUP = 6;
const EXPLORATION_EVERY = 24;
const MIN_SAVINGS_RATE = 0.1;
const F1_TOLERANCE = 0.005;
const RECALL_TOLERANCE = 0.005;

const mean = (values: number[]): number => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);

function actionFeatures(row: Row, action: Action): number[] {
  const top10Tokens = Math.max(1, row.actions.top10.input_tokens);
  return [...row.features, (top10Tokens - row.actions[action].input_tokens) / top10Tokens];
}

function observations(rows: Row[], scope = false): Observation[] {
  return rows.flatMap((row) => COMPACT.map((action) => ({
    action,
    features: actionFeatures(row, action),
    f1: row.actions[action].token_f1 - row.actions.top10.token_f1,
    recall: row.actions[action].token_recall - row.actions.top10.token_recall,
    scope,
  })));
}

function estimate(pool: Observation[], row: Row, action: Action): Estimate {
  if (action === "top10") return { f1: 0, recall: 0, f1_se: 0, recall_se: 0, effective_neighbors: Number.POSITIVE_INFINITY };
  const target = actionFeatures(row, action);
  const nearest = pool.filter((item) => item.action === action).map((item) => {
    const squared = target.reduce((sum, value, index) => sum + (value - item.features[index]!) ** 2, 0);
    return { item, distance: Math.sqrt(squared) * (item.scope ? 0.5 : 1) };
  }).sort((left, right) => left.distance - right.distance).slice(0, KNN_NEIGHBORS);
  const weighted = nearest.map((neighbor) => ({ ...neighbor.item, weight: 1 / (0.05 + neighbor.distance) }));
  const total = weighted.reduce((sum, item) => sum + item.weight, 0);
  if (!total) return { f1: 0, recall: 0, f1_se: Number.POSITIVE_INFINITY, recall_se: Number.POSITIVE_INFINITY, effective_neighbors: 0 };
  const f1 = weighted.reduce((sum, item) => sum + item.weight * item.f1, 0) / total;
  const recall = weighted.reduce((sum, item) => sum + item.weight * item.recall, 0) / total;
  const weightSquared = weighted.reduce((sum, item) => sum + item.weight ** 2, 0);
  const effectiveNeighbors = total ** 2 / Math.max(Number.EPSILON, weightSquared);
  const weightedVariance = (key: "f1" | "recall", center: number): number =>
    weighted.reduce((sum, item) => sum + item.weight * (item[key] - center) ** 2, 0) / total;
  return {
    f1,
    recall,
    f1_se: Math.sqrt(weightedVariance("f1", f1) / Math.max(1, effectiveNeighbors)),
    recall_se: Math.sqrt(weightedVariance("recall", recall) / Math.max(1, effectiveNeighbors)),
    effective_neighbors: effectiveNeighbors,
  };
}

function replay(train: Row[], rows: Row[], confidenceMultiplier: number): Result[] {
  const pool = observations(train);
  const counts: Record<Action, number> = { top10: 0, top5: 0, "k5-l0-1": 0, "k5-l0-2": 0 };
  let selectedTokens = 0;
  let top10Tokens = 0;
  const results: Result[] = [];
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]!;
    if (index === ONBOARDING_QUERIES) {
      selectedTokens = 0;
      top10Tokens = 0;
    }
    const step = index + 1;
    const projectedTop10 = top10Tokens + row.actions.top10.input_tokens;
    const budget = projectedTop10 * (1 - MIN_SAVINGS_RATE);
    const feasible = ACTIONS.filter((action) => selectedTokens + row.actions[action].input_tokens <= budget);
    const compact = feasible.filter((action) => action !== "top10");
    let action: Action;
    let reason: Result["reason"];
    let prediction: Estimate;
    if (step <= WARMUP && compact.length) {
      action = compact[(step - 1) % compact.length]!;
      reason = "warmup";
      prediction = estimate(pool, row, action);
    } else if (step % EXPLORATION_EVERY === 0 && compact.length) {
      action = [...compact].sort((left, right) => counts[left] - counts[right])[0]!;
      reason = "explore";
      prediction = estimate(pool, row, action);
    } else {
      const scored = feasible.map((candidate) => {
        const candidatePrediction = estimate(pool, row, candidate);
        const lower = {
          f1: candidatePrediction.f1 - confidenceMultiplier * candidatePrediction.f1_se,
          recall: candidatePrediction.recall - confidenceMultiplier * candidatePrediction.recall_se,
        };
        const eligible = candidate === "top10" || (lower.f1 >= -F1_TOLERANCE && lower.recall >= -RECALL_TOLERANCE);
        return { action: candidate, prediction: candidatePrediction, lower, eligible, score: candidatePrediction.f1 + candidatePrediction.recall };
      });
      const best = scored.filter((candidate) => candidate.eligible)
        .sort((left, right) => right.score - left.score || row.actions[left.action].input_tokens - row.actions[right.action].input_tokens)[0];
      const selected = best ?? scored.sort((left, right) => right.score - left.score || row.actions[left.action].input_tokens - row.actions[right.action].input_tokens)[0]!;
      action = selected.action;
      prediction = selected.prediction;
      reason = best ? (action === "top10" ? "baseline" : "learned") : "budget";
    }
    const selected = row.actions[action];
    const top10 = row.actions.top10;
    results.push({
      dialog_id: row.dialogId,
      query_id: row.queryId,
      action,
      reason,
      phase: index < ONBOARDING_QUERIES ? "onboarding" : "evaluation",
      selected,
      top10,
      prediction,
      lower: { f1: prediction.f1 - confidenceMultiplier * prediction.f1_se, recall: prediction.recall - confidenceMultiplier * prediction.recall_se },
    });
    selectedTokens += selected.input_tokens;
    top10Tokens += top10.input_tokens;
    counts[action] += 1;
    if (action !== "top10") {
      pool.push({
        action,
        features: actionFeatures(row, action),
        f1: selected.token_f1 - top10.token_f1,
        recall: selected.token_recall - top10.token_recall,
        scope: true,
      });
    }
  }
  return results;
}

function bootstrap(results: Result[], cluster: boolean, draws = 20_000) {
  const groups = cluster
    ? [...Map.groupBy(results, (row) => row.dialog_id).values()]
    : results.map((row) => [row]);
  let seed = cluster ? 0x55c37a11 : 0x72d347a1;
  const random = (): number => {
    seed = (Math.imul(seed ^ (seed >>> 16), 2246822519) + 3266489917) >>> 0;
    return seed % groups.length;
  };
  const values = { f1: [] as number[], recall: [] as number[], tokens: [] as number[] };
  for (let draw = 0; draw < draws; draw += 1) {
    let count = 0;
    let f1 = 0;
    let recall = 0;
    let tokens = 0;
    for (let index = 0; index < groups.length; index += 1) {
      for (const row of groups[random()]!) {
        count += 1;
        f1 += row.selected.token_f1 - row.top10.token_f1;
        recall += row.selected.token_recall - row.top10.token_recall;
        tokens += row.selected.input_tokens - row.top10.input_tokens;
      }
    }
    values.f1.push(f1 / count);
    values.recall.push(recall / count);
    values.tokens.push(tokens / count);
  }
  const ci = (samples: number[]) => {
    samples.sort((left, right) => left - right);
    return [samples[Math.floor(draws * 0.025)]!, samples[Math.floor(draws * 0.975)]!];
  };
  return { cluster_count: cluster ? groups.length : undefined, token_f1: ci(values.f1), token_recall: ci(values.recall), input_tokens: ci(values.tokens) };
}

function summarize(results: Result[]) {
  const delta = (key: "token_f1" | "token_recall" | "input_tokens") => mean(results.map((row) => row.selected[key] - row.top10[key]));
  return {
    count: results.length,
    token_f1: mean(results.map((row) => row.selected.token_f1)),
    token_recall: mean(results.map((row) => row.selected.token_recall)),
    input_tokens: mean(results.map((row) => row.selected.input_tokens)),
    vs_top10: { token_f1: delta("token_f1"), token_recall: delta("token_recall"), input_tokens: delta("input_tokens") },
    token_savings_rate: 1 - mean(results.map((row) => row.selected.input_tokens)) / mean(results.map((row) => row.top10.input_tokens)),
    action_counts: Object.fromEntries(ACTIONS.map((action) => [action, results.filter((row) => row.action === action).length])),
    reason_counts: Object.fromEntries(["warmup", "explore", "learned", "baseline", "budget"].map((reason) => [reason, results.filter((row) => row.reason === reason).length])),
    query_paired_bootstrap_ci95: bootstrap(results, false),
    dialog_cluster_bootstrap_ci95: bootstrap(results, true),
  };
}

const input = path.resolve(process.argv[2] ?? "../results/long-dialog-action-table.json");
const output = path.resolve(process.argv[3] ?? "../results/final-confidence-replay.json");
const actionTable = JSON.parse(await readFile(input, "utf8")) as { protocol: string; rows: Row[] };
if (actionTable.protocol !== "topic3c-compact-action-table-v1") throw new Error(`Unsupported action table: ${actionTable.protocol}`);
const dialogIds = [...new Set(actionTable.rows.map((row) => row.dialogId))];
const loaded = new Map(dialogIds.map((id) => [id, actionTable.rows.filter((row) => row.dialogId === id)]));
const devDialogs = dialogIds.filter((id) => DEV_DIALOGS.has(id));
const validationDialogs = dialogIds.filter((id) => VALIDATION_DIALOGS.has(id));

const dev = CONFIDENCE_MULTIPLIERS.map((multiplier) => {
  const results = devDialogs.flatMap((heldOut) => replay(
    devDialogs.filter((id) => id !== heldOut).flatMap((id) => loaded.get(id) ?? []),
    loaded.get(heldOut) ?? [],
    multiplier,
  ).filter((row) => row.phase === "evaluation"));
  return { confidence_multiplier: multiplier, summary: summarize(results) };
});

const eligibleDev = dev.filter((candidate) =>
  candidate.summary.vs_top10.token_f1 >= 0
  && candidate.summary.vs_top10.token_recall >= 0
  && candidate.summary.token_savings_rate >= MIN_SAVINGS_RATE);
const selectedMultiplier = (eligibleDev.sort((left, right) =>
  right.summary.vs_top10.token_f1 - left.summary.vs_top10.token_f1
  || right.summary.vs_top10.token_recall - left.summary.vs_top10.token_recall
  || left.summary.input_tokens - right.summary.input_tokens)[0] ?? dev[0]!).confidence_multiplier;

const validation = CONFIDENCE_MULTIPLIERS.map((multiplier) => {
  const train = devDialogs.flatMap((id) => loaded.get(id) ?? []);
  const results = validationDialogs.flatMap((id) => replay(train, loaded.get(id) ?? [], multiplier)
    .filter((row) => row.phase === "evaluation"));
  return { confidence_multiplier: multiplier, frozen_selected: multiplier === selectedMultiplier, summary: summarize(results) };
});

const report = {
  protocol: "topic3-c-confidence-lower-bound-knn24-v1",
  no_new_llm_calls: true,
  split: { dev_dialogs: [...DEV_DIALOGS], validation_dialogs: [...VALIDATION_DIALOGS], caveat: "All dialogs were observed during earlier method development; this is a frozen split replay, not a new independent benchmark." },
  fixed_parameters: { neighbors: KNN_NEIGHBORS, onboarding_queries_per_dialog: ONBOARDING_QUERIES, min_savings_rate: MIN_SAVINGS_RATE, f1_tolerance: F1_TOLERANCE, recall_tolerance: RECALL_TOLERANCE, confidence_multipliers: CONFIDENCE_MULTIPLIERS },
  selection_rule: "On dev only: non-negative mean F1 and recall deltas, at least 10% token saving; then maximize F1, recall, and saving in that order.",
  selected_confidence_multiplier: selectedMultiplier,
  dev,
  validation,
  conclusion_rule: "Promote the confidence-gated variant only if its frozen validation improves safety or quality without losing the original KNN24 quality/cost advantage; otherwise retain multiplier 0 (original KNN24).",
};

await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ output, selected_confidence_multiplier: selectedMultiplier, validation: validation.find((row) => row.frozen_selected)?.summary }));
