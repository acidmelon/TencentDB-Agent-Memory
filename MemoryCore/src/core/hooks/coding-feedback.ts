import type { AdaptiveFeedback, AdaptiveFeatures, AdaptiveRecallAction } from "./adaptive-policy.js";
import type { PromotionObservation } from "./promotion-gate.js";

export interface CodingTaskOutcome {
  passAt1?: boolean;
  taskPassed?: boolean;
  patchApplied?: boolean;
  compileOk?: boolean;
  testsPassed?: number;
  testsTotal?: number;
  regression?: boolean;
  userCorrected?: boolean;
  staleEvidenceUsed?: boolean;
  conflictRisk?: number;
  retries?: number;
}

export interface PairedCodingFeedback {
  scope: string;
  taskId: string;
  action: AdaptiveRecallAction;
  actionTokens: number;
  baselineTokens: number;
  actionOutcome: CodingTaskOutcome;
  baselineOutcome: CodingTaskOutcome;
  features?: AdaptiveFeatures;
  timestamp?: number;
}

export interface CodingQualityScore {
  score: number;
  positiveWeight: number;
  penalties: {
    regression: number;
    userCorrection: number;
    staleEvidence: number;
    conflict: number;
    retries: number;
  };
}

function clamp(value: number, minimum = 0, maximum = 1): number {
  return Math.max(minimum, Math.min(maximum, value));
}

export function scoreCodingOutcome(outcome: CodingTaskOutcome): CodingQualityScore {
  let weighted = 0;
  let positiveWeight = 0;
  const taskPassed = outcome.passAt1 ?? outcome.taskPassed;
  if (typeof taskPassed === "boolean") {
    weighted += (taskPassed ? 1 : 0) * 0.5;
    positiveWeight += 0.5;
  }
  if (typeof outcome.patchApplied === "boolean") {
    weighted += (outcome.patchApplied ? 1 : 0) * 0.1;
    positiveWeight += 0.1;
  }
  if (typeof outcome.compileOk === "boolean") {
    weighted += (outcome.compileOk ? 1 : 0) * 0.2;
    positiveWeight += 0.2;
  }
  if (Number.isFinite(outcome.testsPassed) && Number.isFinite(outcome.testsTotal) && Number(outcome.testsTotal) > 0) {
    weighted += clamp(Number(outcome.testsPassed) / Number(outcome.testsTotal)) * 0.3;
    positiveWeight += 0.3;
  }
  if (positiveWeight === 0) throw new Error("Coding feedback requires patch application, pass@1, compile, or test results");

  const penalties = {
    regression: outcome.regression ? 0.3 : 0,
    userCorrection: outcome.userCorrected ? 0.15 : 0,
    staleEvidence: outcome.staleEvidenceUsed ? 0.25 : 0,
    conflict: 0.2 * clamp(Number(outcome.conflictRisk ?? 0)),
    retries: 0.02 * clamp(Number(outcome.retries ?? 0), 0, 5),
  };
  const penalty = Object.values(penalties).reduce((sum, value) => sum + value, 0);
  return { score: clamp(weighted / positiveWeight - penalty), positiveWeight, penalties };
}

function validatePair(feedback: PairedCodingFeedback): void {
  if (!feedback.scope.trim() || !feedback.taskId.trim()) throw new Error("Coding feedback requires scope and taskId");
  if (!Number.isFinite(feedback.actionTokens) || feedback.actionTokens < 0 || !Number.isFinite(feedback.baselineTokens) || feedback.baselineTokens <= 0) {
    throw new Error("Coding feedback requires finite token costs and a positive Top-10 baseline");
  }
}

export function toAdaptiveCodingFeedback(feedback: PairedCodingFeedback): AdaptiveFeedback {
  validatePair(feedback);
  const action = scoreCodingOutcome(feedback.actionOutcome);
  const baseline = scoreCodingOutcome(feedback.baselineOutcome);
  return {
    scope: feedback.scope,
    action: feedback.action,
    actionQuality: action.score,
    baselineQuality: baseline.score,
    actionTokens: feedback.actionTokens,
    baselineTokens: feedback.baselineTokens,
    source: "coding",
    features: { queryLength: 0, hasCodeCue: true, ...(feedback.features ?? {}) },
    timestamp: feedback.timestamp,
  };
}

export function toPromotionObservation(feedback: PairedCodingFeedback): PromotionObservation {
  const adaptive = toAdaptiveCodingFeedback(feedback);
  const qualityDelta = Number(adaptive.actionQuality) - Number(adaptive.baselineQuality);
  return {
    scope: feedback.scope,
    taskId: feedback.taskId,
    qualityDelta,
    tokenSavingsRate: (feedback.baselineTokens - feedback.actionTokens) / feedback.baselineTokens,
    source: "coding",
    hardFailure: feedback.actionOutcome.regression === true || feedback.actionOutcome.staleEvidenceUsed === true,
    timestamp: feedback.timestamp,
  };
}
