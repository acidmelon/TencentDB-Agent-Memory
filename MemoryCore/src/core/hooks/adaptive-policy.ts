import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

/** A deliberately small action space keeps online adaptation bounded and auditable. */
export type AdaptiveRecallAction = "top10" | "top8" | "top5" | "top5-l0";
export type AdaptiveLearner = "mean" | "linucb";

export interface AdaptiveRecallConfig {
  enabled: boolean;
  /** Start in shadow mode until this many delayed labels exist for the scope. */
  shadow: boolean;
  /** Learner used after warmup. The default preserves the original mean policy. */
  learner: AdaptiveLearner;
  /** Exploration coefficient for the contextual LinUCB learner. */
  ucbAlpha: number;
  minObservations: number;
  /** Reward = normalized quality delta + tokenSavingsWeight * relative token savings. */
  tokenSavingsWeight: number;
  /** Minimum predicted quality delta against Top-10. */
  qualityTolerance: number;
  /** Optional independent recall lower bound against Top-10. */
  recallTolerance: number;
  /** Require paired recall feedback before a non-baseline action can be selected. */
  requireRecallFeedback: boolean;
  /** Minimum predicted combined gain before switching from Top-10. */
  decisionMargin: number;
  /** Each non-baseline action must have this many labels before selection. */
  minActionObservations: number;
  /** Shrink sparse context estimates toward the scope-wide estimate. */
  priorObservations: number;
  /** Enforce the cost objective: selected actions must save tokens vs Top-10. */
  requireTokenSavings: boolean;
  /** Do not let an adaptive action exceed this many results. */
  maxK: number;
  stateTtlDays: number;
  maxScopes: number;
}

export interface AdaptiveFeatures {
  queryLength: number;
  hasTemporalCue?: boolean;
  hasCodeCue?: boolean;
  sourceCount?: number;
  fileCount?: number;
  functionCount?: number;
  dependencyChange?: boolean;
  stackTracePresent?: boolean;
  staleEvidenceRisk?: number;
}

export interface AdaptiveDecision {
  action: AdaptiveRecallAction;
  effectiveK: number;
  scope: string;
  policyVersion: number;
  shadow: boolean;
  observationCount: number;
  features: AdaptiveFeatures;
  /** Contextual estimate recorded for observability; absent for the legacy path. */
  predictedReward?: number;
  /** LinUCB uncertainty for the selected candidate. */
  uncertainty?: number;
  /** Why Top-10 or a candidate was selected. */
  decisionReason?: string;
}

export interface AdaptiveFeedback {
  scope: string;
  action: AdaptiveRecallAction;
  /** Generic quality for coding or other task feedback, normalized to [0, 1]. */
  actionQuality?: number;
  baselineQuality?: number;
  /** Optional retrieval recall pair, kept separate from answer/coding quality. */
  actionRecall?: number;
  baselineRecall?: number;
  /** Legacy answer-level LoCoMo fields. Prefer actionQuality/baselineQuality. */
  actionF1?: number;
  baselineF1?: number;
  /** Input tokens for the selected action and Top-10 counterfactual. */
  actionTokens: number;
  baselineTokens: number;
  source?: "locomo" | "coding" | "compile" | "tests" | "user" | "shadow";
  features?: AdaptiveFeatures;
  timestamp?: number;
}

/** f1Mean is retained in persisted v2 state as the legacy name for generic quality delta. */
interface ActionStats { count: number; rewardMean: number; rewardM2: number; f1Mean: number; savingsMean: number; recallMean?: number; recallM2?: number; recallCount?: number; }
interface BanditStats { count: number; a: number[][]; b: number[]; }
interface PolicyState {
  version: number;
  updatedAt: number;
  observations: number;
  actions: Record<AdaptiveRecallAction, ActionStats>;
  /** Context buckets let one scope learn different K for code/time/short queries. */
  contexts: Record<string, Record<AdaptiveRecallAction, ActionStats>>;
  bandit: Record<AdaptiveRecallAction, BanditStats>;
}

const ACTIONS: AdaptiveRecallAction[] = ["top10", "top8", "top5", "top5-l0"];
const K: Record<AdaptiveRecallAction, number> = { top10: 10, top8: 8, top5: 5, "top5-l0": 5 };
const DEFAULT_CONFIG: AdaptiveRecallConfig = {
  enabled: false, shadow: true, learner: "mean", ucbAlpha: 0.35, minObservations: 20, tokenSavingsWeight: 0.15,
  qualityTolerance: 0, recallTolerance: 0, requireRecallFeedback: false, decisionMargin: 0.01, minActionObservations: 8, priorObservations: 5,
  requireTokenSavings: true,
  maxK: 10, stateTtlDays: 30, maxScopes: 256,
};

/** Stable, bounded features shared by the online policy and offline replays. */
export const adaptiveFeatureNames = [
  "bias", "query_length", "temporal_cue", "code_cue", "source_count", "file_count",
  "function_count", "dependency_change", "stack_trace", "stale_risk",
] as const;

export function adaptiveFeatureVector(features: AdaptiveFeatures): number[] {
  const bounded = (value: number | undefined, scale: number) => Math.max(0, Math.min(1, Number(value ?? 0) / scale));
  return [
    1,
    bounded(features.queryLength, 320),
    features.hasTemporalCue ? 1 : 0,
    features.hasCodeCue ? 1 : 0,
    bounded(features.sourceCount, 12),
    bounded(features.fileCount, 8),
    bounded(features.functionCount, 12),
    features.dependencyChange ? 1 : 0,
    features.stackTracePresent ? 1 : 0,
    Math.max(0, Math.min(1, Number(features.staleEvidenceRisk ?? 0))),
  ];
}

const FEATURE_DIM = adaptiveFeatureNames.length;

function newBanditStats(): BanditStats {
  return {
    count: 0,
    a: Array.from({ length: FEATURE_DIM }, (_, i) => Array.from({ length: FEATURE_DIM }, (__, j) => i === j ? 1 : 0)),
    b: Array(FEATURE_DIM).fill(0) as number[],
  };
}

function emptyBandit(): Record<AdaptiveRecallAction, BanditStats> {
  return Object.fromEntries(ACTIONS.map((action) => [action, newBanditStats()])) as Record<AdaptiveRecallAction, BanditStats>;
}

const emptyState = (): PolicyState => ({
  version: 3,
  updatedAt: Date.now(),
  observations: 0,
  actions: Object.fromEntries(ACTIONS.map((a) => [a, { count: 0, rewardMean: 0, rewardM2: 0, f1Mean: 0, savingsMean: 0 }])) as PolicyState["actions"],
  contexts: {},
  bandit: emptyBandit(),
});

function safeConfig(input?: Partial<AdaptiveRecallConfig>): AdaptiveRecallConfig {
  const c = { ...DEFAULT_CONFIG, ...(input ?? {}) };
  return {
    enabled: c.enabled === true,
    shadow: c.shadow !== false,
    learner: c.learner === "linucb" ? "linucb" : "mean",
    ucbAlpha: Math.max(0, Number.isFinite(Number(c.ucbAlpha)) ? Number(c.ucbAlpha) : DEFAULT_CONFIG.ucbAlpha),
    minObservations: Math.max(1, Math.floor(Number(c.minObservations) || DEFAULT_CONFIG.minObservations)),
    tokenSavingsWeight: Math.max(0, Number(c.tokenSavingsWeight) || 0),
    qualityTolerance: Math.min(0, Number.isFinite(Number(c.qualityTolerance)) ? Number(c.qualityTolerance) : 0),
    recallTolerance: Math.min(0, Number.isFinite(Number(c.recallTolerance)) ? Number(c.recallTolerance) : 0),
    requireRecallFeedback: c.requireRecallFeedback === true,
    decisionMargin: Math.max(0, Number(c.decisionMargin) || DEFAULT_CONFIG.decisionMargin),
    minActionObservations: Math.max(1, Math.floor(Number(c.minActionObservations) || DEFAULT_CONFIG.minActionObservations)),
    priorObservations: Math.max(0, Math.floor(Number(c.priorObservations) || DEFAULT_CONFIG.priorObservations)),
    requireTokenSavings: c.requireTokenSavings !== false,
    maxK: Math.max(5, Math.min(10, Math.floor(Number(c.maxK) || 10))),
    stateTtlDays: Math.max(1, Math.floor(Number(c.stateTtlDays) || 30)),
    maxScopes: Math.max(1, Math.floor(Number(c.maxScopes) || 256)),
  };
}

function scopeFile(root: string, scope: string): string {
  const encoded = Buffer.from(scope, "utf8").toString("base64url").slice(0, 160);
  return path.join(root, "adaptive-policy", `${encoded}.json`);
}

async function loadState(file: string, cfg: AdaptiveRecallConfig): Promise<PolicyState> {
  try {
    const parsed = JSON.parse(await readFile(file, "utf8")) as PolicyState;
    if ((parsed.version !== 2 && parsed.version !== 3) || !parsed.actions || Date.now() - parsed.updatedAt > cfg.stateTtlDays * 86400000) return emptyState();
    for (const action of ACTIONS) {
      const s = parsed.actions[action];
      if (!s || !Number.isFinite(s.count) || !Number.isFinite(s.rewardMean) || !Number.isFinite(s.rewardM2) || !Number.isFinite(s.f1Mean) || !Number.isFinite(s.savingsMean)) return emptyState();
    }
    if (!parsed.contexts || typeof parsed.contexts !== "object") parsed.contexts = {};
    // v2 states remain valid for the legacy learner; initialize the new
    // contextual learner lazily so an upgrade never invalidates prior data.
    if (parsed.version === 2 || !parsed.bandit || typeof parsed.bandit !== "object") {
      parsed.bandit = emptyBandit();
      parsed.version = 3;
    }
    for (const action of ACTIONS) {
      const bandit = parsed.bandit[action];
      if (!bandit || !Number.isFinite(bandit.count) || !Array.isArray(bandit.a) || !Array.isArray(bandit.b)
        || bandit.a.length !== FEATURE_DIM || bandit.b.length !== FEATURE_DIM
        || bandit.a.some((row) => !Array.isArray(row) || row.length !== FEATURE_DIM || row.some((value) => !Number.isFinite(value)))
        || bandit.b.some((value) => !Number.isFinite(value))) return emptyState();
    }
    return parsed;
  } catch { return emptyState(); }
}

function contextKey(features: AdaptiveFeatures): string {
  const length = features.queryLength < 80 ? "short" : features.queryLength < 240 ? "medium" : "long";
  if (!features.hasCodeCue) return `${length}:general:${features.hasTemporalCue ? "temporal" : "atemporal"}`;
  const files = !features.fileCount ? "f0" : features.fileCount === 1 ? "f1" : "fm";
  const dependency = features.dependencyChange ? "dep" : "nodep";
  const failure = features.stackTracePresent ? "stack" : "nostack";
  const risk = Number(features.staleEvidenceRisk ?? 0) >= 0.5 ? "risk" : "norisk";
  return `${length}:code:${files}:${dependency}:${failure}:${risk}`;
}

function feedbackQuality(feedback: AdaptiveFeedback): { action: number; baseline: number } {
  const action = feedback.actionQuality ?? feedback.actionF1;
  const baseline = feedback.baselineQuality ?? feedback.baselineF1;
  if (!Number.isFinite(action) || !Number.isFinite(baseline)) {
    throw new Error("Adaptive feedback requires finite paired quality values");
  }
  if (Number(action) < 0 || Number(action) > 1 || Number(baseline) < 0 || Number(baseline) > 1) {
    throw new Error("Adaptive feedback quality must be within [0, 1]");
  }
  return { action: Number(action), baseline: Number(baseline) };
}

async function saveState(file: string, state: PolicyState): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temp, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await rename(temp, file);
}

function solveLinear(a: number[][], b: number[]): number[] {
  const n = b.length;
  const left = a.map((row) => [...row]);
  const right = [...b];
  for (let i = 0; i < n; i++) {
    let pivot = i;
    for (let row = i + 1; row < n; row++) {
      if (Math.abs(left[row]![i]!) > Math.abs(left[pivot]![i]!)) pivot = row;
    }
    [left[i], left[pivot]] = [left[pivot]!, left[i]!];
    [right[i], right[pivot]] = [right[pivot]!, right[i]!];
    const divisor = Math.abs(left[i]![i]!) > 1e-10 ? left[i]![i]! : 1e-10;
    for (let col = i; col < n; col++) left[i]![col] /= divisor;
    right[i] /= divisor;
    for (let row = 0; row < n; row++) {
      if (row === i) continue;
      const factor = left[row]![i]!;
      if (factor === 0) continue;
      for (let col = i; col < n; col++) left[row]![col] -= factor * left[i]![col]!;
      right[row] -= factor * right[i]!;
    }
  }
  return right.map((value) => Number.isFinite(value) ? value : 0);
}

function banditEstimate(stats: BanditStats, x: number[]): { mean: number; uncertainty: number } {
  const theta = solveLinear(stats.a, stats.b);
  const mean = theta.reduce((sum, value, index) => sum + value * x[index]!, 0);
  // Solve A z = x instead of explicitly persisting A^-1.
  const z = solveLinear(stats.a, x);
  const variance = Math.max(0, x.reduce((sum, value, index) => sum + value * z[index]!, 0));
  return { mean: Number.isFinite(mean) ? mean : 0, uncertainty: Math.sqrt(Number.isFinite(variance) ? variance : 0) };
}

/**
 * Persistent, per-team/project policy. Decisions never inspect the answer;
 * callers update it later with compile/test/user/benchmark feedback.
 */
export class AdaptiveRecallPolicy {
  private readonly cfg: AdaptiveRecallConfig;
  private readonly root: string;
  private readonly cache = new Map<string, PolicyState>();
  private readonly locks = new Map<string, Promise<void>>();

  constructor(root: string, config?: Partial<AdaptiveRecallConfig>) {
    this.root = root;
    this.cfg = safeConfig(config);
  }

  get config(): AdaptiveRecallConfig { return this.cfg; }

  private async state(scope: string): Promise<PolicyState> {
    const cached = this.cache.get(scope);
    if (cached) return cached;
    const loaded = await loadState(scopeFile(this.root, scope), this.cfg);
    if (this.cache.size >= this.cfg.maxScopes) this.cache.delete(this.cache.keys().next().value as string);
    this.cache.set(scope, loaded);
    return loaded;
  }

  async decide(scope: string, features: AdaptiveFeatures): Promise<AdaptiveDecision> {
    const state = await this.state(scope);
    // Top-10 is the universal prior and remains the only action before warmup.
    let action: AdaptiveRecallAction = "top10";
    let predictedReward: number | undefined;
    let uncertainty: number | undefined;
    let decisionReason = "warmup-top10";
    if (this.cfg.enabled && !this.cfg.shadow && state.observations >= this.cfg.minObservations) {
      const bucket = state.contexts[contextKey(features)];
      const local = bucket ?? state.actions;
      const estimate = (a: AdaptiveRecallAction) => {
        const l = local[a]; const g = state.actions[a];
        if (!l || !g) return { count: 0, f1Mean: -Infinity, savingsMean: 0, recallCount: 0, recallMean: 0 };
        const prior = bucket ? this.cfg.priorObservations : 0;
        const n = l.count + prior;
        return {
          count: n,
          f1Mean: (l.f1Mean * l.count + g.f1Mean * prior) / Math.max(1, n),
          savingsMean: (l.savingsMean * l.count + g.savingsMean * prior) / Math.max(1, n),
          recallCount: (l.recallCount ?? 0) + (bucket ? 0 : (g.recallCount ?? 0)),
          recallMean: (l.recallMean ?? g.recallMean ?? 0),
        };
      };
      const eligible = ACTIONS.filter((a) => a !== "top10" && K[a] <= this.cfg.maxK)
        .filter((a) => estimate(a).count >= this.cfg.minActionObservations && estimate(a).f1Mean >= this.cfg.qualityTolerance)
        .filter((a) => !this.cfg.requireRecallFeedback || (estimate(a).recallCount >= this.cfg.minActionObservations && estimate(a).recallMean >= this.cfg.recallTolerance))
        .filter((a) => !this.cfg.requireTokenSavings || estimate(a).savingsMean > 0);
      if (this.cfg.learner === "linucb") {
        const x = adaptiveFeatureVector(features);
        const scored = eligible.map((candidate) => {
          const bandit = banditEstimate(state.bandit[candidate], x);
          return { action: candidate, ...bandit, score: bandit.mean + this.cfg.ucbAlpha * bandit.uncertainty };
        }).filter((row) => row.score >= this.cfg.decisionMargin)
          .sort((a, b) => b.score - a.score || K[b.action] - K[a.action]);
        const selected = scored[0];
        if (selected) {
          action = selected.action;
          predictedReward = selected.mean;
          uncertainty = selected.uncertainty;
          decisionReason = "linucb-accepted";
        } else {
          decisionReason = eligible.length ? "linucb-rejected-margin" : "linucb-no-eligible-action";
        }
      } else {
        const ranked = eligible
          .filter((a) => estimate(a).f1Mean + this.cfg.tokenSavingsWeight * estimate(a).savingsMean >= this.cfg.decisionMargin)
          .sort((a, b) => (estimate(b).f1Mean + this.cfg.tokenSavingsWeight * estimate(b).savingsMean) - (estimate(a).f1Mean + this.cfg.tokenSavingsWeight * estimate(a).savingsMean) || K[b] - K[a]);
        action = ranked[0] ?? "top10";
        decisionReason = action === "top10" ? "mean-no-eligible-action" : "mean-accepted";
      }
    } else if (this.cfg.enabled && !this.cfg.shadow) {
      decisionReason = "warmup-top10";
    }
    return {
      action,
      effectiveK: K[action],
      scope,
      policyVersion: state.version,
      shadow: this.cfg.shadow || !this.cfg.enabled || state.observations < this.cfg.minObservations,
      observationCount: state.observations,
      features,
      predictedReward,
      uncertainty,
      decisionReason,
    };
  }

  async update(feedback: AdaptiveFeedback): Promise<{ reward: number; state: PolicyState }> {
    const quality = feedbackQuality(feedback);
    if (!feedback.scope.trim()) throw new Error("Adaptive feedback scope is required");
    if (!Number.isFinite(feedback.actionTokens) || feedback.actionTokens < 0 || !Number.isFinite(feedback.baselineTokens) || feedback.baselineTokens <= 0) {
      throw new Error("Adaptive feedback requires finite non-negative tokens and a positive baseline");
    }
    let observedReward = 0;
    const run = async () => {
      const state = await this.state(feedback.scope);
      const f1Delta = quality.action - quality.baseline;
      const baseTokens = Math.max(1, Number(feedback.baselineTokens));
      const savings = (baseTokens - Number(feedback.actionTokens)) / baseTokens;
      // Positive reward requires better F1 and/or fewer tokens than Top-10.
      const reward = (Number.isFinite(f1Delta) ? f1Delta : 0) + this.cfg.tokenSavingsWeight * (Number.isFinite(savings) ? savings : 0);
      observedReward = reward;
      const stats = state.actions[feedback.action] ?? { count: 0, rewardMean: 0, rewardM2: 0, f1Mean: 0, savingsMean: 0 };
      stats.count += 1;
      const delta = reward - stats.rewardMean;
      stats.rewardMean += delta / stats.count;
      stats.rewardM2 += delta * (reward - stats.rewardMean);
      stats.f1Mean += (f1Delta - stats.f1Mean) / stats.count;
      stats.savingsMean += (savings - stats.savingsMean) / stats.count;
      const actionRecall = feedback.actionRecall;
      const baselineRecall = feedback.baselineRecall;
      if (Number.isFinite(actionRecall) && Number.isFinite(baselineRecall)
        && Number(actionRecall) >= 0 && Number(actionRecall) <= 1
        && Number(baselineRecall) >= 0 && Number(baselineRecall) <= 1) {
        const recallDelta = Number(actionRecall) - Number(baselineRecall);
        const recallCount = (stats.recallCount ?? 0) + 1;
        stats.recallMean = (stats.recallMean ?? 0) + (recallDelta - (stats.recallMean ?? 0)) / recallCount;
        stats.recallM2 = (stats.recallM2 ?? 0) + (recallDelta - (stats.recallMean ?? 0)) * (recallDelta - (stats.recallMean ?? 0));
        stats.recallCount = recallCount;
      }
      state.actions[feedback.action] = stats;
      const featureVector = adaptiveFeatureVector(feedback.features ?? {
        queryLength: 0,
        hasCodeCue: feedback.source === "compile" || feedback.source === "tests",
      });
      const bandit = state.bandit[feedback.action] ?? newBanditStats();
      bandit.count += 1;
      for (let i = 0; i < FEATURE_DIM; i++) {
        bandit.b[i] = (bandit.b[i] ?? 0) + featureVector[i]! * reward;
        for (let j = 0; j < FEATURE_DIM; j++) {
          bandit.a[i]![j] = (bandit.a[i]?.[j] ?? (i === j ? 1 : 0)) + featureVector[i]! * featureVector[j]!;
        }
      }
      state.bandit[feedback.action] = bandit;
      const key = contextKey(feedback.features ?? { queryLength: 0, hasCodeCue: feedback.source === "compile" || feedback.source === "tests" });
      const bucket = state.contexts[key] ?? Object.fromEntries(ACTIONS.map((a) => [a, { count: 0, rewardMean: 0, rewardM2: 0, f1Mean: 0, savingsMean: 0 }])) as PolicyState["actions"];
      const bucketStats = bucket[feedback.action] ?? { count: 0, rewardMean: 0, rewardM2: 0, f1Mean: 0, savingsMean: 0 };
      bucketStats.count += 1;
      const bucketDelta = reward - bucketStats.rewardMean;
      bucketStats.rewardMean += bucketDelta / bucketStats.count;
      bucketStats.rewardM2 += bucketDelta * (reward - bucketStats.rewardMean);
      bucketStats.f1Mean += (f1Delta - bucketStats.f1Mean) / bucketStats.count;
      bucketStats.savingsMean += (savings - bucketStats.savingsMean) / bucketStats.count;
      bucket[feedback.action] = bucketStats;
      state.contexts[key] = bucket;
      state.observations += 1;
      state.updatedAt = Date.now();
      this.cache.set(feedback.scope, state);
      await saveState(scopeFile(this.root, feedback.scope), state);
      return { reward, state };
    };
    const previous = this.locks.get(feedback.scope) ?? Promise.resolve();
    const current = previous.then(run, run).then(() => undefined);
    this.locks.set(feedback.scope, current);
    await current;
    const state = await this.state(feedback.scope);
    return { reward: observedReward, state };
  }
}

const policyRegistry = new Map<string, AdaptiveRecallPolicy>();

export function getAdaptiveRecallPolicy(root: string, config?: Partial<AdaptiveRecallConfig>): AdaptiveRecallPolicy {
  let policy = policyRegistry.get(root);
  if (!policy) {
    policy = new AdaptiveRecallPolicy(root, config);
    policyRegistry.set(root, policy);
  }
  return policy;
}

export function adaptiveScope(teamId?: string, agentId?: string, projectId?: string): string {
  return [teamId || "default-team", agentId || "default-agent", projectId || "default-project"].join("/");
}

/** Entry point for delayed feedback collectors (compile/test/user/benchmark). */
export async function updateAdaptiveRecallPolicy(
  root: string,
  config: Partial<AdaptiveRecallConfig> | undefined,
  feedback: AdaptiveFeedback,
): Promise<{ reward: number; state: unknown }> {
  return getAdaptiveRecallPolicy(root, config).update(feedback);
}
