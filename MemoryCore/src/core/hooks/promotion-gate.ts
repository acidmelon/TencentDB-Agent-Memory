import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AdaptiveDecision, AdaptiveFeatures, AdaptiveRecallPolicy } from "./adaptive-policy.js";

export type PromotionStage = "onboarding" | "shadow" | "eligible" | "promoted" | "demoted";
export type PromotionFeedbackSource = "locomo" | "coding" | "compile" | "tests" | "user" | "shadow";

export interface PromotionGateConfig {
  minObservations: number;
  minCodingObservations: number;
  minCodingCoverage: number;
  minTokenSavingsRate: number;
  qualityTolerance: number;
  confidenceZ: number;
  maxFallbackRate: number;
  windowSize: number;
  autoPromote: boolean;
}

export interface PromotionObservation {
  scope: string;
  taskId: string;
  qualityDelta: number;
  tokenSavingsRate: number;
  source: PromotionFeedbackSource;
  fallback?: boolean;
  hardFailure?: boolean;
  timestamp?: number;
}

interface StoredGateState {
  version: 1;
  mode: "shadow" | "promoted" | "demoted";
  updatedAt: number;
  reason: string;
  observations: PromotionObservation[];
}

export interface PromotionSnapshot {
  scope: string;
  stage: PromotionStage;
  reason: string;
  observationCount: number;
  codingObservationCount: number;
  codingCoverage: number;
  qualityMean: number;
  qualityLowerBound: number;
  tokenSavingsMean: number;
  tokenSavingsLowerBound: number;
  fallbackRate: number;
  hardFailureCount: number;
  canActivate: boolean;
}

export interface PromotionGatedDecision {
  activeDecision: AdaptiveDecision;
  candidateDecision: AdaptiveDecision;
  promotion: PromotionSnapshot;
}

const DEFAULT_CONFIG: PromotionGateConfig = {
  minObservations: 24,
  minCodingObservations: 20,
  minCodingCoverage: 0.8,
  minTokenSavingsRate: 0.1,
  qualityTolerance: 0.005,
  confidenceZ: 1.645,
  maxFallbackRate: 0.1,
  windowSize: 100,
  autoPromote: false,
};

function safeConfig(input?: Partial<PromotionGateConfig>): PromotionGateConfig {
  const config = { ...DEFAULT_CONFIG, ...(input ?? {}) };
  return {
    minObservations: Math.max(2, Math.floor(config.minObservations)),
    minCodingObservations: Math.max(0, Math.floor(config.minCodingObservations)),
    minCodingCoverage: Math.max(0, Math.min(1, config.minCodingCoverage)),
    minTokenSavingsRate: Math.max(0, Math.min(1, config.minTokenSavingsRate)),
    qualityTolerance: Math.max(0, config.qualityTolerance),
    confidenceZ: Math.max(0, config.confidenceZ),
    maxFallbackRate: Math.max(0, Math.min(1, config.maxFallbackRate)),
    windowSize: Math.max(2, Math.floor(config.windowSize)),
    autoPromote: config.autoPromote === true,
  };
}

function gateFile(root: string, scope: string): string {
  const encoded = Buffer.from(scope, "utf8").toString("base64url").slice(0, 160);
  return path.join(root, "adaptive-policy", `${encoded}.promotion.json`);
}

const emptyState = (): StoredGateState => ({ version: 1, mode: "shadow", updatedAt: Date.now(), reason: "new scope", observations: [] });

async function loadState(file: string): Promise<StoredGateState> {
  try {
    const state = JSON.parse(await readFile(file, "utf8")) as StoredGateState;
    if (state.version !== 1 || !Array.isArray(state.observations) || !["shadow", "promoted", "demoted"].includes(state.mode)) return emptyState();
    return state;
  } catch {
    return emptyState();
  }
}

async function saveState(file: string, state: StoredGateState): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temp, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await rename(temp, file);
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}

function lowerBound(values: number[], z: number): number {
  if (values.length < 2) return Number.NEGATIVE_INFINITY;
  const average = mean(values);
  const variance = values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1);
  return average - z * Math.sqrt(variance / values.length);
}

function isCoding(source: PromotionFeedbackSource): boolean {
  return source === "coding" || source === "compile" || source === "tests";
}

function validateObservation(observation: PromotionObservation): void {
  if (!observation.scope.trim() || !observation.taskId.trim()) throw new Error("Promotion observation requires scope and taskId");
  if (!Number.isFinite(observation.qualityDelta) || observation.qualityDelta < -1 || observation.qualityDelta > 1) throw new Error("qualityDelta must be within [-1, 1]");
  if (!Number.isFinite(observation.tokenSavingsRate) || observation.tokenSavingsRate > 1) throw new Error("tokenSavingsRate must be finite and no greater than 1");
}

export class AdaptivePromotionGate {
  private readonly config: PromotionGateConfig;
  private readonly states = new Map<string, StoredGateState>();
  private readonly locks = new Map<string, Promise<void>>();

  constructor(private readonly root: string, config?: Partial<PromotionGateConfig>) {
    this.config = safeConfig(config);
  }

  private async state(scope: string): Promise<StoredGateState> {
    const cached = this.states.get(scope);
    if (cached) return cached;
    const loaded = await loadState(gateFile(this.root, scope));
    this.states.set(scope, loaded);
    return loaded;
  }

  private snapshotFor(scope: string, state: StoredGateState): PromotionSnapshot {
    const observations = state.observations.slice(-this.config.windowSize);
    const quality = observations.map((row) => row.qualityDelta);
    const savings = observations.map((row) => row.tokenSavingsRate);
    const coding = observations.filter((row) => isCoding(row.source)).length;
    const hardFailures = observations.filter((row) => row.hardFailure).length;
    const fallbackRate = mean(observations.map((row) => row.fallback ? 1 : 0));
    const qualityLower = lowerBound(quality, this.config.confidenceZ);
    const savingsLower = lowerBound(savings, this.config.confidenceZ);
    const coverage = coding / Math.max(1, observations.length);
    const enough = observations.length >= this.config.minObservations;
    const enoughCoding = coding >= this.config.minCodingObservations && coverage >= this.config.minCodingCoverage;
    const statisticalGate = qualityLower >= -this.config.qualityTolerance && savingsLower >= this.config.minTokenSavingsRate;
    const operationalGate = fallbackRate <= this.config.maxFallbackRate && hardFailures === 0;
    const eligible = enough && enoughCoding && statisticalGate && operationalGate;

    let stage: PromotionStage;
    let reason: string;
    if (state.mode === "promoted") {
      stage = "promoted";
      reason = state.reason;
    } else if (state.mode === "demoted") {
      stage = "demoted";
      reason = state.reason;
    } else if (!enough) {
      stage = "onboarding";
      reason = `need ${this.config.minObservations - observations.length} more observations`;
    } else if (eligible) {
      stage = "eligible";
      reason = "quality, coding coverage, token, and fallback gates passed";
    } else {
      stage = "shadow";
      reason = !enoughCoding ? "insufficient coding feedback coverage" : !statisticalGate ? "quality or token confidence bound failed" : "fallback or hard-failure gate failed";
    }
    return {
      scope,
      stage,
      reason,
      observationCount: observations.length,
      codingObservationCount: coding,
      codingCoverage: coverage,
      qualityMean: mean(quality),
      qualityLowerBound: qualityLower,
      tokenSavingsMean: mean(savings),
      tokenSavingsLowerBound: savingsLower,
      fallbackRate,
      hardFailureCount: hardFailures,
      canActivate: stage === "promoted",
    };
  }

  async status(scope: string): Promise<PromotionSnapshot> {
    return this.snapshotFor(scope, await this.state(scope));
  }

  async record(observation: PromotionObservation): Promise<PromotionSnapshot> {
    validateObservation(observation);
    let snapshot: PromotionSnapshot | undefined;
    const run = async () => {
      const state = await this.state(observation.scope);
      state.observations.push({ ...observation, timestamp: observation.timestamp ?? Date.now() });
      state.observations = state.observations.slice(-this.config.windowSize);
      state.updatedAt = Date.now();
      if (observation.hardFailure && state.mode === "promoted") {
        state.mode = "demoted";
        state.reason = `hard failure on ${observation.taskId}`;
      }
      snapshot = this.snapshotFor(observation.scope, state);
      if (this.config.autoPromote && snapshot.stage === "eligible") {
        state.mode = "promoted";
        state.reason = "automatic promotion after all gates passed";
        snapshot = this.snapshotFor(observation.scope, state);
      }
      this.states.set(observation.scope, state);
      await saveState(gateFile(this.root, observation.scope), state);
    };
    const previous = this.locks.get(observation.scope) ?? Promise.resolve();
    const current = previous.then(run, run).then(() => undefined);
    this.locks.set(observation.scope, current);
    await current;
    return snapshot ?? this.status(observation.scope);
  }

  async promote(scope: string): Promise<PromotionSnapshot> {
    const state = await this.state(scope);
    const current = this.snapshotFor(scope, state);
    if (current.stage !== "eligible") throw new Error(`Scope is not eligible for promotion: ${current.reason}`);
    state.mode = "promoted";
    state.reason = "manual promotion after all gates passed";
    state.updatedAt = Date.now();
    await saveState(gateFile(this.root, scope), state);
    return this.snapshotFor(scope, state);
  }

  async demote(scope: string, reason: string): Promise<PromotionSnapshot> {
    const state = await this.state(scope);
    state.mode = "demoted";
    state.reason = reason.trim() || "manual demotion";
    state.updatedAt = Date.now();
    await saveState(gateFile(this.root, scope), state);
    return this.snapshotFor(scope, state);
  }

  async resumeShadow(scope: string): Promise<PromotionSnapshot> {
    const state = await this.state(scope);
    state.mode = "shadow";
    state.reason = "shadow resumed; prior observations retained";
    state.updatedAt = Date.now();
    await saveState(gateFile(this.root, scope), state);
    return this.snapshotFor(scope, state);
  }
}

/**
 * Keeps policy learning separate from activation. The candidate remains
 * observable in shadow, while the active path is forced to Top-10 until the
 * project gate is explicitly promoted.
 */
export async function decideWithPromotionGate(
  policy: AdaptiveRecallPolicy,
  gate: AdaptivePromotionGate,
  scope: string,
  features: AdaptiveFeatures,
): Promise<PromotionGatedDecision> {
  const [candidateDecision, promotion] = await Promise.all([policy.decide(scope, features), gate.status(scope)]);
  const activeDecision = promotion.canActivate
    ? { ...candidateDecision, shadow: false }
    : { ...candidateDecision, action: "top10" as const, effectiveK: 10, shadow: true };
  return { activeDecision, candidateDecision, promotion };
}
