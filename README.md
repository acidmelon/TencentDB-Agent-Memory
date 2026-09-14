# MemoryCore Adaptive Memory for Coding Tasks

本仓库是基于 [TencentDB Agent Memory](https://github.com/TencentCloud/TencentDB-Agent-Memory) `v2.0.0-beta.1` 的题目三 C 精炼实现，用于研究：在不改写底层 FTS5、向量检索和 RRF 的前提下，如何利用延迟反馈自适应组织记忆，并将该能力迁移到编程任务。

> 当前状态：长对话场景在历史回放中得到质量与 token 改善，但最终冻结切分没有守住 recall；编程场景已完成反馈适配、影子学习、晋升/回退门和 SWE 求解实验链路，但尚未证明历史记忆能稳定提高 SWE-bench 最终解决率。

## 核心方案

系统在原有 MemoryCore 检索结果之上增加一个可关闭的策略旁路：

```text
MemoryCore Top-10 基线
        |
        v
自适应策略（mean / LinUCB）
        |
        +-- top10
        +-- top8
        +-- top5
        +-- top5 + 最多 2 条 L0 BM25 证据
        |
        v
编程反馈：pass@1 / compile / tests / regression / token
        |
        v
按项目作用域运行的 promotion gate（实验适配/回放层）
        +-- onboarding / shadow
        +-- eligible / promoted
        +-- hard failure -> demoted -> Top-10
```

设计约束：

- 默认关闭并处于 shadow，未达到门槛时不改变线上 Top-10。
- 策略只调整有限动作，不修改底层检索器。
- 反馈必须与同任务 Top-10 对照成对记录。
- 状态损坏、超时、L0 查询失败或编程硬失败时回退 Top-10。
- 编程质量和长对话 F1 分开建模，不把 token 节省当作任务成功。

## 实现内容

- `AdaptiveRecallPolicy`：持久化作用域状态、均值策略、LinUCB、有限动作和成本约束。
- `coding-feedback`：把编译、测试、回归、pass@1 和 token 转为配对反馈。
- `AdaptivePromotionGate`：基于质量/成本置信下界、编程覆盖率和硬失败进行晋升或降级；当前由实验适配/回放层调用，尚未默认串入 `auto-recall`。
- `auto-recall` 接入：按 team/agent/project 作用域决策，可选补充 L0 FTS5 证据。调用方未提供 `projectId` 时使用 `default-project`。
- SWE 实验闭环：linked 源码定位、test-first reproduction、窄回归、错误分类和回滚。

## 初步结果

### 长对话自适应

冻结策略在 5 个 LoCoMo 对话、923 条 onboarding 后 query 的历史回放中，相对 Top-10 的 pooled 结果为：

| 指标 | 差值 |
|---|---:|
| Token F1 | `+0.02781` |
| 答案词元召回率 | `+0.03952` |
| 平均记忆上下文 token | `-63.57` |
| Token 节省率 | `23.28%` |

query-level 与 dialog-cluster bootstrap 区间均不跨 0；但这些对话在方法开发中已被观察，不能作为独立泛化证据。最后再固定 3 个对话选参数、2 个对话验证：KNN24 在 296 条验证 query 上节省 19.35% 上下文，但 F1/recall 分别为 `-0.00520/-0.03027`，所以没有晋升，开启自适应后的默认仍为 Top-10；关闭时保留基座静态配置。

独立 LongMemEval 的 30 条缓存答案上，`ridge-gated-0.01` 只对 4 条 query 使用 Top-5，F1/recall 均不下降，每题节省 22.9 token；该小样本结论不直接迁移到 LoCoMo。

### 编程场景

| 实验 | 结果 | 解释 |
|---|---:|---|
| 5 题 public reproduction | `1/5 resolved`, 114,384 token | 基础公开反馈链路 |
| reproduction + repair | `1/5 resolved`, 148,010 token | 多 33,626 token，未提高解决数 |
| Matplotlib 13989 | `publicly_validated=true` | linked 定位与窄回归恢复了有效补丁 |
| Astropy 14096 adaptive | 记忆成功延迟注入，无有效补丁 | 触发机制有效，成功率收益未证实 |

准确结论：当前实现已经改善代码定位、公开验证、回滚和失败恢复条件；尚无足够独立样本证明“历史记忆稳定提高编程成功率”。完整口径见 [初步测试结果](docs/topic3c/RESULTS.md)，方案筛选过程见 [实验探索与方案演化](docs/topic3c/EXPERIMENT_HISTORY.md)。

## 目录

```text
MemoryCore/
  src/core/hooks/
    adaptive-policy.ts          # 自适应动作与学习器
    coding-feedback.ts          # 编程结果反馈适配
    promotion-gate.ts           # 项目级晋升和硬回退
    *.test.ts                   # 核心单元测试
  scripts/topic3-c/
    update-adaptive-policy.ts   # 离线/延迟反馈更新
    coding-feedback-promotion-replay.ts
    final-confidence-replay.ts  # 自包含长对话冻结回放
    swebench-coding-feedback-adapter.ts
    swe-agent-v2.py             # 实验性 SWE search/read/test/edit 闭环
    test_swe_agent_v2.py
docs/topic3c/
  FINAL_REPORT.md
  IMPLEMENTATION.md
  EXPERIMENT_HISTORY.md
  RESULTS.md
  report/render_report.py
output/pdf/
  topic3c-adaptive-memory-final-report-cn.pdf
results/
  initial-results.json
  long-dialog-action-table.json # 仅含特征和逐动作指标的紧凑输入
  final-confidence-replay.json
```

其余目录来自上游 `v2.0.0-beta.1`，便于审查本方案相对基线的增量。

最终上交报告见 [方案介绍与测试结论报告](docs/topic3c/FINAL_REPORT.md)，排版版见 [最终实验报告 PDF](output/pdf/topic3c-adaptive-memory-final-report-cn.pdf)。二者已替代口径过时的 initial report。

## 快速验证

要求 Node.js `>=22.16.0`。在 `MemoryCore` 目录执行：

```bash
npm install
npm run test:topic3c
npm run smoke:topic3c
npm run eval:topic3c
```

SWE solver 的纯单元测试需要 Python 3.9+（使用标准库 unittest，无需 pytest）：

```bash
python scripts/topic3-c/test_swe_agent_v2.py
python -m py_compile scripts/topic3-c/swe-agent-v2.py
```

真实 SWE 运行还需要 Docker、公开 SWE-bench task bundle 和 OpenAI-compatible 模型端点；凭据不得提交到仓库。

## 安全与研究边界

- 仓库不包含 API key、模型请求缓存、Docker 镜像、完整 benchmark 数据或 evaluator-only gold patch。
- SWE 生成阶段只允许读取公开 issue、base commit 源码和公开基础测试。
- official evaluator 仅在候选补丁冻结后运行。
- `swe-agent-v2.py` 是实验求解器，不替换 MemoryCore 原生 prompt。

## 参考

- [ReProAgent](https://arxiv.org/abs/2607.09123)：定位、根因、测试规划与测试生成的分阶段 reproduction。
- [Self-Evolving Coding Agents](https://arxiv.org/abs/2608.03392)：可执行反馈、仓库上下文、轨迹记忆、可逆性和成本/泛化门禁。
- 上游项目：[TencentDB Agent Memory](https://github.com/TencentCloud/TencentDB-Agent-Memory)

## License

沿用上游项目的 [MIT License](LICENSE)。
