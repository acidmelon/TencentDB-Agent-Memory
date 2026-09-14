# 题目三 C 提交说明

## 交付要求映射

| 题目要求 | 提交内容 |
|---|---|
| 方案介绍 + 测试结论 | `docs/topic3c/FINAL_REPORT.md`、`output/pdf/topic3c-adaptive-memory-final-report-cn.pdf` |
| 补充设计与演化记录 | `docs/topic3c/IMPLEMENTATION.md`、`docs/topic3c/EXPERIMENT_HISTORY.md` |
| 公开长对话 Eval Runner | `MemoryCore/scripts/topic3-c/final-confidence-replay.ts` |
| 结构化结果与 Top-10 基线 | `results/long-dialog-action-table.json`、`results/final-confidence-replay.json`、`results/initial-results.json` |
| 方向 C 实现 | `MemoryCore/src/core/hooks/adaptive-policy.ts`、`coding-feedback.ts`、`promotion-gate.ts` |
| 编程场景验证 | `MemoryCore/scripts/topic3-c/swe-agent-v2.py`、`test_swe_agent_v2.py` |
| 机器可读结果 | `docs/topic3c/RESULTS.md`、`results/initial-results.json`、`results/final-confidence-replay.json` |
| 干净复现记录 | `docs/topic3c/CLEANROOM.md` |

## 最小复现

要求 Node.js `>=22.16.0`。进入 `MemoryCore` 后执行：

```bash
npm ci --ignore-scripts
npm run test:topic3c
npm run smoke:topic3c
npm run eval:topic3c
npm run build
```

Python solver 的无网络测试：

```bash
python scripts/topic3-c/test_swe_agent_v2.py
python -m py_compile scripts/topic3-c/swe-agent-v2.py
```

`npm run eval:topic3c` 不调用 LLM，只对紧凑逐动作指标做冻结回放。预期选择
`selected_confidence_multiplier=0`；296 条验证 query 相对 Top-10 的 F1、recall、token 差值
分别约为 `-0.00520`、`-0.03027`、`-50.59`。这表示方案未通过双质量晋升门，而不是运行失败。

## 验证状态

- Topic 3C TypeScript：31/31 通过；
- Python solver：14/14 通过；
- promotion smoke：通过；
- 自包含长对话回放：通过且数值一致；
- MemoryCore build：通过。
- 最终 ZIP 干净环境结果：以 `docs/topic3c/CLEANROOM.md` 和压缩包旁的验收回执为准。

## 主张边界

- 923 题正向结果是已观察 LoCoMo 对话的历史回放，不是新独立测试；
- LongMemEval ridge 结果只有 30 题，不跨数据集迁移参数；
- 编程任务只主张机制和部分过程改善，不主张稳定提高 SWE-bench `pass@1`；
- 默认关闭 adaptive 并保留用户静态配置；启用后的未晋升路径为 Top-10，离线 KNN24 不直接控制生产策略；
- 生成过程不读取 gold patch、hidden tests、`FAIL_TO_PASS`、`PASS_TO_PASS` 或 evaluator-only 字段。

## 打包

仓库根目录执行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/package-topic3c.ps1
```

脚本读取 clean 当前工作区的已跟踪文件和显式审阅的新文件，默认生成 `submission/topic3c-final-20260914.zip`，并附逐文件 SUBMISSION-MANIFEST.json 与包 SHA256。未经审阅的新文件会阻止打包。

## 交付版本

提交分支为 topic3c-adaptive-memory。此次交付以 ZIP 内文件清单的 SHA256 为精确版本依据；base_commit 只记录工作区基准，不代表未提交修改已经推送。最终报告正文与 PDF 为同一份报告的两种格式。历史探索文档仅为补充证据。

上游 OpenTelemetry 依赖审计仍有告警，详见 CLEANROOM.md；功能验收不等于依赖安全审计通过。MemoryProxy 的 cost-guard gitlink 不属于此次交付的 MemoryCore 验收范围。
