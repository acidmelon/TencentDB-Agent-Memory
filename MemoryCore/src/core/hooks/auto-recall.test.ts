import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseConfig } from "../../config.js";
import type { IMemoryStore } from "../store/types.js";
import { adaptiveScope, getAdaptiveRecallPolicy } from "./adaptive-policy.js";
import { performAutoRecall } from "./auto-recall.js";
import { AdaptivePromotionGate } from "./promotion-gate.js";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function fixture(enabled = true) {
  const root = await mkdtemp(path.join(os.tmpdir(), "tdai-recall-"));
  dirs.push(root);
  const cfg = parseConfig(undefined);
  cfg.recall = {
    ...cfg.recall,
    strategy: "keyword",
    maxResults: 8,
    timeoutMs: 500,
    adaptivePolicy: { enabled, shadow: false, minObservations: 2, minActionObservations: 2 },
  };
  const searchL1Fts = vi.fn().mockResolvedValue(Array.from({ length: 12 }, (_, index) => ({
    record_id: String(index), content: `memory ${index}`, type: "fact", score: 1,
    priority: 1, scene_name: "", timestamp_str: "", timestamp_start: "", timestamp_end: "",
  })));
  const searchL0Fts = vi.fn().mockResolvedValue([{ message_text: "original evidence" }]);
  const isFtsAvailable = vi.fn().mockReturnValue(true);
  // Only the keyword-store boundary is stubbed. Policy, persistence, gate,
  // timeout handling and context assembly all use their real implementations.
  const store = { searchL1Fts, searchL0Fts, isFtsAvailable } as unknown as IMemoryStore;
  const params = {
    userText: "function repair", actorId: "actor", sessionKey: "session",
    cfg, pluginDataDir: root, vectorStore: store,
    profileIsolation: { teamId: "team", agentId: "agent", projectId: "project" },
  };
  const scope = adaptiveScope("team", "agent", "project");
  const policy = getAdaptiveRecallPolicy(root, cfg.recall.adaptivePolicy);
  for (let index = 0; index < 2; index += 1) {
    await policy.update({
      scope, action: "top5-l0", actionQuality: 1, baselineQuality: 0.5,
      actionTokens: 50, baselineTokens: 100,
    });
  }
  const gate = new AdaptivePromotionGate(root);
  const promote = async () => {
    for (let index = 0; index < 24; index += 1) {
      await gate.record({ scope, taskId: `task-${index}`, source: "coding", qualityDelta: 0.5, tokenSavingsRate: 0.5 });
    }
    await gate.promote(scope);
  };
  return { params, searchL1Fts, searchL0Fts, isFtsAvailable, gate, scope, promote };
}

describe("adaptive auto recall", () => {
  it.each([5, 8])("preserves configured K=%i when disabled", async (k) => {
    const f = await fixture(false);
    f.params.cfg.recall.maxResults = k;
    const result = await performAutoRecall(f.params);
    expect(result?.error).toBeUndefined();
    expect(result?.adaptiveDecision).toBeUndefined();
    expect(result?.recalledL1Memories).toHaveLength(k);
    expect(f.searchL1Fts).toHaveBeenCalledWith(expect.any(String), k * 2);
    expect(f.searchL0Fts).not.toHaveBeenCalled();
  });

  it("requires persisted promotion before injecting the learned L0 action", async () => {
    const f = await fixture();
    const before = await performAutoRecall(f.params);
    expect(before?.adaptiveDecision).toMatchObject({ action: "top10", shadow: true });
    expect(f.searchL0Fts).not.toHaveBeenCalled();
    await f.promote();
    const after = await performAutoRecall(f.params);
    expect(after?.adaptiveDecision).toMatchObject({ action: "top5-l0", shadow: false });
    expect(after?.prependContext).toContain("original evidence");
    await f.gate.demote(f.scope, "external regression");
    const demoted = await performAutoRecall(f.params);
    expect(demoted?.adaptiveDecision).toMatchObject({ action: "top10", shadow: true });
    expect(f.searchL0Fts).toHaveBeenCalledTimes(1);
  });

  it("honors an explicit shadow setting even after promotion", async () => {
    const f = await fixture();
    await f.promote();
    f.params.cfg.recall.adaptivePolicy!.shadow = true;
    const result = await performAutoRecall(f.params);
    expect(result?.adaptiveDecision?.shadow).toBe(true);
    expect(result?.recalledL1Memories).toHaveLength(10);
    expect(f.searchL0Fts).not.toHaveBeenCalled();
  });

  it.each(["error", "unavailable", "timeout"])("restores base K after L0 %s", async (failure) => {
    const f = await fixture();
    await f.promote();
    if (failure === "error") f.searchL0Fts.mockRejectedValue(new Error("FTS failed"));
    if (failure === "unavailable") f.isFtsAvailable.mockReturnValueOnce(true).mockReturnValueOnce(false);
    if (failure === "timeout") f.searchL0Fts.mockImplementation(() => new Promise(() => {}));
    const result = await performAutoRecall(f.params);
    expect(result?.error).toBeUndefined();
    expect(result?.adaptiveDecision).toBeUndefined();
    expect(result?.recalledL1Memories).toHaveLength(8);
    expect(f.searchL1Fts).toHaveBeenLastCalledWith(expect.any(String), 16);
  });

  it("surfaces a base retrieval failure instead of claiming a successful fallback", async () => {
    const f = await fixture();
    f.searchL1Fts.mockRejectedValue(new Error("store unavailable"));
    const result = await performAutoRecall(f.params);
    expect(result?.error).toBeDefined();
    expect(f.searchL1Fts).toHaveBeenCalledTimes(2);
  });
});
