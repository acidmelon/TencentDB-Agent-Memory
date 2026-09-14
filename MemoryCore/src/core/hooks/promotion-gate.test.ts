import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AdaptiveRecallPolicy } from "./adaptive-policy.js";
import { AdaptivePromotionGate, decideWithPromotionGate } from "./promotion-gate.js";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("AdaptivePromotionGate", () => {
  it("does not count repeated feedback for the same task as independent evidence", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "tdai-promotion-"));
    dirs.push(dir);
    const gate = new AdaptivePromotionGate(dir);
    const row = { scope: "scope", taskId: "task", source: "coding" as const, qualityDelta: 0, tokenSavingsRate: 0.2 };
    await gate.record(row);
    await expect(gate.record(row)).rejects.toThrow("Duplicate promotion task");
    expect((await gate.status("scope")).observationCount).toBe(1);
  });

  it("revokes promotion when subsequent quality feedback fails the gate", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "tdai-promotion-"));
    dirs.push(dir);
    const gate = new AdaptivePromotionGate(dir, { minObservations: 2, minCodingObservations: 2, confidenceZ: 0, autoPromote: true });
    for (let index = 0; index < 2; index += 1) {
      await gate.record({ scope: "scope", taskId: `good-${index}`, source: "coding", qualityDelta: 0, tokenSavingsRate: 0.2 });
    }
    expect((await gate.status("scope")).canActivate).toBe(true);
    const result = await gate.record({ scope: "scope", taskId: "quality-loss", source: "coding", qualityDelta: -1, tokenSavingsRate: 0.2 });
    expect(result.stage).toBe("demoted");
    expect(result.canActivate).toBe(false);
  });

  it("keeps scopes with long shared prefixes separate after reloading", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "tdai-promotion-"));
    dirs.push(dir);
    const prefix = "project/".repeat(30);
    const gate = new AdaptivePromotionGate(dir);
    await gate.record({ scope: `${prefix}one`, taskId: "task", source: "coding", qualityDelta: 0, tokenSavingsRate: 0.2 });
    const reloaded = new AdaptivePromotionGate(dir);
    expect((await reloaded.status(`${prefix}two`)).observationCount).toBe(0);
    expect((await reloaded.status(`${prefix}one`)).observationCount).toBe(1);
  });

  it("keeps a new project in shadow until every gate passes", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "tdai-promotion-")); dirs.push(dir);
    const gate = new AdaptivePromotionGate(dir, { minObservations: 4, minCodingObservations: 4, minCodingCoverage: 1, minTokenSavingsRate: 0.1, confidenceZ: 0 });
    for (let index = 0; index < 3; index += 1) {
      const status = await gate.record({ scope: "team/repo", taskId: `task-${index}`, qualityDelta: 0.03, tokenSavingsRate: 0.2, source: "coding" });
      expect(status.stage).toBe("onboarding");
    }
    const eligible = await gate.record({ scope: "team/repo", taskId: "task-3", qualityDelta: 0.03, tokenSavingsRate: 0.2, source: "tests" });
    expect(eligible.stage).toBe("eligible");
    expect(eligible.canActivate).toBe(false);
    const promoted = await gate.promote("team/repo");
    expect(promoted.stage).toBe("promoted");
    expect(promoted.canActivate).toBe(true);
  });

  it("refuses promotion when coding coverage is missing", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "tdai-promotion-")); dirs.push(dir);
    const gate = new AdaptivePromotionGate(dir, { minObservations: 3, minCodingObservations: 2, minCodingCoverage: 0.5, confidenceZ: 0 });
    for (let index = 0; index < 3; index += 1) {
      await gate.record({ scope: "team/repo", taskId: `qa-${index}`, qualityDelta: 0.1, tokenSavingsRate: 0.2, source: "locomo" });
    }
    const status = await gate.status("team/repo");
    expect(status.stage).toBe("shadow");
    expect(status.reason).toContain("coding feedback");
  });

  it("immediately demotes a promoted project on a hard regression", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "tdai-promotion-")); dirs.push(dir);
    const gate = new AdaptivePromotionGate(dir, { minObservations: 2, minCodingObservations: 2, minCodingCoverage: 1, confidenceZ: 0, autoPromote: true });
    await gate.record({ scope: "team/repo", taskId: "good-1", qualityDelta: 0.1, tokenSavingsRate: 0.2, source: "coding" });
    expect((await gate.record({ scope: "team/repo", taskId: "good-2", qualityDelta: 0.1, tokenSavingsRate: 0.2, source: "coding" })).stage).toBe("promoted");
    const demoted = await gate.record({ scope: "team/repo", taskId: "regression", qualityDelta: -1, tokenSavingsRate: 0.2, source: "tests", hardFailure: true });
    expect(demoted.stage).toBe("demoted");
    expect(demoted.canActivate).toBe(false);
  });

  it("forces the active decision to Top-10 until promotion", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "tdai-promotion-")); dirs.push(dir);
    const policy = new AdaptiveRecallPolicy(dir, { enabled: true, shadow: false, minObservations: 1, minActionObservations: 1, tokenSavingsWeight: 0.5 });
    const gate = new AdaptivePromotionGate(dir, { minObservations: 2, minCodingObservations: 2, minCodingCoverage: 1, confidenceZ: 0 });
    const features = { queryLength: 100, hasCodeCue: true };
    await policy.update({ scope: "team/repo", action: "top5", actionQuality: 1, baselineQuality: 0.5, actionTokens: 50, baselineTokens: 100, source: "coding", features });
    const gated = await decideWithPromotionGate(policy, gate, "team/repo", features);
    expect(gated.candidateDecision.action).toBe("top5");
    expect(gated.activeDecision.action).toBe("top10");
    expect(gated.activeDecision.shadow).toBe(true);
  });
});
