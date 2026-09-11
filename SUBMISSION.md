# 题目三 C 提交说明

## 交付要求映射

| 题目要求 | 提交内容 |
|---|---|
| 调研报告 + 设计说明 | `docs/topic3c/IMPLEMENTATION.md`、`docs/topic3c/EXPERIMENT_HISTORY.md` |
| 公开长对话 Eval Runner | `MemoryCore/scripts/topic3-c/final-confidence-replay.ts` |
| 结构化结果与 Top-10 基线 | `results/long-dialog-action-table.json`、`results/final-confidence-replay.json`、`results/initial-results.json` |
| 方向 C 实现 | `MemoryCore/src/core/hooks/adaptive-policy.ts`、`coding-feedback.ts`、`promotion-gate.ts` |
| 编程场景验证 | `MemoryCore/scripts/topic3-c/swe-agent-v2.py`、`test_swe_agent_v2.py` |
| 实验报告 | `docs/topic3c/RESULTS.md`、`output/pdf/topic3c-adaptive-memory-final-report-cn.pdf` |
| 干净复现记录 | `docs/topic3c/CLEANROOM.md` |

## 最小复现

要求 Node.js `>=22.16.0`。进入 `MemoryCore` 后执行：

```bash
npm install
npm run test:topic3c
npm run smoke:topic3c
npm run eval:topic3c
npm run build
```

Python solver 的无网络测试：

```bash
python -m pytest -q scripts/topic3-c/test_swe_agent_v2.py
python -m py_compile scripts/topic3-c/swe-agent-v2.py
```

`npm run eval:topic3c` 不调用 LLM，只对紧凑逐动作指标做冻结回放。预期选择
`selected_confidence_multiplier=0`；296 条验证 query 相对 Top-10 的 F1、recall、token 差值
分别约为 `-0.00520`、`-0.03027`、`-50.59`。这表示方案未通过双质量晋升门，而不是运行失败。

## 验证状态

- Topic 3C TypeScript：17/17 通过；
- Python solver：14/14 通过；
- promotion smoke：通过；
- 自包含长对话回放：通过且数值一致；
- MemoryCore build：通过。
- 从最终 ZIP 解压后的干净环境复现：通过。

## 主张边界

- 923 题正向结果是已观察 LoCoMo 对话的历史回放，不是新独立测试；
- LongMemEval ridge 结果只有 30 题，不跨数据集迁移参数；
- 编程任务只主张机制和部分过程改善，不主张稳定提高 SWE-bench `pass@1`；
- Top-10 是默认安全路径，KNN24 和编程学习器保持 shadow/onboarding；
- 生成过程不读取 gold patch、hidden tests、`FAIL_TO_PASS`、`PASS_TO_PASS` 或 evaluator-only 字段。

## 打包

仓库根目录执行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/package-topic3c.ps1
```

脚本从当前 Git `HEAD` 导出基线，并叠加本次白名单变更，默认生成 `submission/topic3c-final-20260911-delivery.zip`。
