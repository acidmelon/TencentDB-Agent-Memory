import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AdaptiveRecallPolicy } from "./adaptive-policy.js";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("AdaptiveRecallPolicy", () => {
  it("keeps the safe Top-10 prior during warmup", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "tdai-adaptive-")); dirs.push(dir);
    const policy = new AdaptiveRecallPolicy(dir, { enabled: true, shadow: false, minObservations: 3 });
    const decision = await policy.decide("team/agent/project", { queryLength: 90, hasCodeCue: true });
    expect(decision.action).toBe("top10");
    expect(decision.effectiveK).toBe(10);
    expect(decision.shadow).toBe(true);
  });

  it("learns an action from F1 gain and token savings over Top-10", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "tdai-adaptive-")); dirs.push(dir);
    const policy = new AdaptiveRecallPolicy(dir, { enabled: true, shadow: false, minObservations: 2, minActionObservations: 2, tokenSavingsWeight: 0.5 });
    const features = { queryLength: 90, hasCodeCue: true };
    await policy.update({ scope: "team/agent/project", action: "top5-l0", actionF1: 0.2, baselineF1: 0.1, actionTokens: 100, baselineTokens: 200, features });
    await policy.update({ scope: "team/agent/project", action: "top5-l0", actionF1: 0.2, baselineF1: 0.1, actionTokens: 100, baselineTokens: 200, features });
    const decision = await policy.decide("team/agent/project", features);
    expect(decision.action).toBe("top5-l0");
    expect(decision.observationCount).toBe(2);
    expect(decision.shadow).toBe(false);
  });

  it("treats corrupt state as a fresh safe state", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "tdai-adaptive-")); dirs.push(dir);
    const policy = new AdaptiveRecallPolicy(dir, { enabled: true, shadow: false, minObservations: 1 });
    const decision = await policy.decide("new-scope", { queryLength: 12 });
    expect(decision.action).toBe("top10");
  });

  it("accepts normalized coding quality without pretending it is answer F1", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "tdai-adaptive-")); dirs.push(dir);
    const policy = new AdaptiveRecallPolicy(dir, { enabled: true, shadow: false, minObservations: 2, minActionObservations: 2, tokenSavingsWeight: 0.2 });
    const feedback = { scope: "team/agent/code", action: "top5-l0" as const, actionQuality: 1, baselineQuality: 0.5, actionTokens: 80, baselineTokens: 160, source: "coding" as const, features: { queryLength: 120, hasCodeCue: true, fileCount: 2, stackTracePresent: true } };
    await policy.update(feedback);
    await policy.update(feedback);
    expect((await policy.decide(feedback.scope, feedback.features)).action).toBe("top5-l0");
  });

  it("uses contextual LinUCB after warmup without spending selector tokens", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "tdai-adaptive-")); dirs.push(dir);
    const policy = new AdaptiveRecallPolicy(dir, {
      enabled: true,
      shadow: false,
      learner: "linucb",
      minObservations: 2,
      minActionObservations: 2,
      tokenSavingsWeight: 0.2,
      ucbAlpha: 0.2,
    });
    const features = { queryLength: 180, hasCodeCue: true, fileCount: 2, functionCount: 3, stackTracePresent: true };
    const feedback = {
      scope: "team/agent/linucb",
      action: "top5-l0" as const,
      actionQuality: 0.8,
      baselineQuality: 0.6,
      actionTokens: 80,
      baselineTokens: 160,
      source: "coding" as const,
      features,
    };
    await policy.update(feedback);
    await policy.update(feedback);
    const decision = await policy.decide(feedback.scope, features);
    expect(decision.action).toBe("top5-l0");
    expect(decision.decisionReason).toBe("linucb-accepted");
    expect(decision.predictedReward).toBeTypeOf("number");
    expect(decision.uncertainty).toBeTypeOf("number");
  });

  it("keeps the Top-10 fallback when a candidate does not save tokens", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "tdai-adaptive-")); dirs.push(dir);
    const policy = new AdaptiveRecallPolicy(dir, {
      enabled: true,
      shadow: false,
      learner: "linucb",
      minObservations: 2,
      minActionObservations: 2,
      tokenSavingsWeight: 0.2,
      ucbAlpha: 0.2,
    });
    const features = { queryLength: 180, hasCodeCue: true };
    const feedback = {
      scope: "team/agent/expensive",
      action: "top5" as const,
      actionQuality: 0.9,
      baselineQuality: 0.6,
      actionTokens: 220,
      baselineTokens: 160,
      source: "coding" as const,
      features,
    };
    await policy.update(feedback);
    await policy.update(feedback);
    const decision = await policy.decide(feedback.scope, features);
    expect(decision.action).toBe("top10");
    expect(decision.decisionReason).toBe("linucb-no-eligible-action");
  });

  it("requires an independent recall signal when the recall gate is enabled", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "tdai-adaptive-")); dirs.push(dir);
    const policy = new AdaptiveRecallPolicy(dir, {
      enabled: true,
      shadow: false,
      learner: "linucb",
      minObservations: 2,
      minActionObservations: 2,
      requireRecallFeedback: true,
      recallTolerance: 0,
    });
    const features = { queryLength: 100, hasCodeCue: true };
    const feedback = {
      scope: "team/agent/recall-gate",
      action: "top5-l0" as const,
      actionQuality: 0.8,
      baselineQuality: 0.6,
      actionRecall: 0.4,
      baselineRecall: 0.5,
      actionTokens: 80,
      baselineTokens: 160,
      source: "locomo" as const,
      features,
    };
    await policy.update(feedback);
    await policy.update(feedback);
    const decision = await policy.decide(feedback.scope, features);
    expect(decision.action).toBe("top10");
    expect(decision.decisionReason).toBe("linucb-no-eligible-action");
  });

  it("rejects malformed delayed feedback before it can corrupt state", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "tdai-adaptive-")); dirs.push(dir);
    const policy = new AdaptiveRecallPolicy(dir, { enabled: true, shadow: false });
    await expect(policy.update({ scope: "scope", action: "top5", actionTokens: 10, baselineTokens: 20 })).rejects.toThrow("paired quality");
    expect((await policy.decide("scope", { queryLength: 10 })).observationCount).toBe(0);
  });
});
