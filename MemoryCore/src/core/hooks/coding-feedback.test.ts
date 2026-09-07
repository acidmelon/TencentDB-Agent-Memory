import { describe, expect, it } from "vitest";
import { scoreCodingOutcome, toAdaptiveCodingFeedback, toPromotionObservation } from "./coding-feedback.js";

describe("coding feedback adapter", () => {
  it("prioritizes pass@1, compilation and tests over token savings", () => {
    const passing = scoreCodingOutcome({ passAt1: true, compileOk: true, testsPassed: 10, testsTotal: 10 });
    const stale = scoreCodingOutcome({ passAt1: true, compileOk: true, testsPassed: 10, testsTotal: 10, staleEvidenceUsed: true, conflictRisk: 1 });
    expect(passing.score).toBe(1);
    expect(stale.score).toBeCloseTo(0.55);
  });

  it("maps paired coding outcomes to policy and promotion feedback", () => {
    const pair = {
      scope: "team/agent/repo",
      taskId: "issue-12",
      action: "top5-l0" as const,
      actionTokens: 700,
      baselineTokens: 1000,
      actionOutcome: { passAt1: true, compileOk: true, testsPassed: 12, testsTotal: 12 },
      baselineOutcome: { passAt1: false, compileOk: true, testsPassed: 8, testsTotal: 12 },
      features: { queryLength: 180, hasCodeCue: true, fileCount: 2, functionCount: 3 },
    };
    const adaptive = toAdaptiveCodingFeedback(pair);
    const promotion = toPromotionObservation(pair);
    expect(adaptive.actionQuality).toBe(1);
    expect(Number(adaptive.baselineQuality)).toBeLessThan(1);
    expect(adaptive.source).toBe("coding");
    expect(promotion.qualityDelta).toBeGreaterThan(0);
    expect(promotion.tokenSavingsRate).toBeCloseTo(0.3);
  });

  it("uses patch application when it is the only available coding signal", () => {
    expect(scoreCodingOutcome({ patchApplied: true }).score).toBe(1);
    expect(scoreCodingOutcome({ patchApplied: false }).score).toBe(0);
  });

  it("rejects outcomes without verifiable programming signals", () => {
    expect(() => scoreCodingOutcome({ retries: 1 })).toThrow("pass@1, compile, or test");
  });
});
