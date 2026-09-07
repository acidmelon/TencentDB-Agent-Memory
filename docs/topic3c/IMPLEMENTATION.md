# 实现说明

## 研究问题

本实现关注 MemoryCore 基座之上的候选组织和策略学习，不重写 FTS5、embedding 或 RRF。策略根据已完成任务的延迟配对反馈，在 `top10`、`top8`、`top5` 和 `top5-l0` 中选择动作。

## 主要模块

### AdaptiveRecallPolicy

`MemoryCore/src/core/hooks/adaptive-policy.ts` 提供：

- team/agent/project 作用域隔离；
- JSON 状态原子写入和损坏/过期回退；
- 有限动作的经验均值学习；
- 无额外 LLM selector 成本的 LinUCB；
- 最小样本、动作样本、质量容忍和 token 节省约束；
- warmup 与 shadow 状态下强制 Top-10。

### CodingFeedback

`coding-feedback.ts` 不使用答案 token-F1 代表编程质量，而是按可用字段归一化组合：

- pass@1/task passed：0.5；
- patch applied：0.1；
- compile OK：0.2；
- tests passed ratio：0.3；
- regression、用户纠错、过时证据、冲突和重试作为惩罚。

反馈必须同时包含动作与 Top-10 对照，避免只学习绝对难度。

### PromotionGate

`promotion-gate.ts` 将学习与启用分离。只有样本数、编程反馈覆盖率、质量下界、token 节省下界和 fallback 指标同时通过，候选策略才可晋升；任何硬回归可立即降级。

### AutoRecall Integration

`auto-recall.ts` 在调用现有 `searchMemories` 前取得策略决策，只覆盖 `maxResults`。`top5-l0` 复用已有 L0 FTS5 API，失败时保留 L1 结果。功能默认关闭。

## SWE 实验求解器

`swe-agent-v2.py` 是与生产路径隔离的实验 glue，包含：

- issue 符号和函数定义加权的 linked 源码候选；
- search/read/test/edit/finish 动作；
- 必须在 base 上失败的 asserted reproduction gate；
- 源码路径优先的窄回归测试选择；
- 语法、行为、回归和基础设施失败分类；
- 失败后的延迟记忆注入与自动回滚。

它不读取 gold patch、hidden tests、FAIL_TO_PASS 或 PASS_TO_PASS 来生成补丁。
