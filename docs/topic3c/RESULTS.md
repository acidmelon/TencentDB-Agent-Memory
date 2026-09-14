# 初步测试结果

## 长对话主结果

冻结 KNN/adaptive 策略在 5 个 LoCoMo 对话上做历史回放。每个对话前 24 条用于 onboarding，之后共评价 923 条 query。这些对话在方法开发中已被观察，不是独立 holdout。

| 指标 | Adaptive | 相对 Top-10 |
|---|---:|---:|
| Token F1 | 0.21458 | +0.02781 |
| 答案词元召回率 | 0.36380 | +0.03952 |
| 平均记忆上下文 token | 209.50 | -63.57 |
| Token 节省率 | - | 23.28% |

paired bootstrap 95% CI：

- query level：F1 `[+0.01427,+0.04153]`，recall `[+0.02046,+0.05896]`，token `[-67.28,-59.89]`；
- dialog cluster：F1 `[+0.01851,+0.03546]`，recall `[+0.00964,+0.05881]`，token `[-73.14,-55.14]`。

限制：数据仍是公开长对话代理任务，且相关对话已参与方法开发，不能替代独立 holdout 或真实团队编程项目反馈。

## 最终冻结切分验证

最后一轮只复用缓存动作指标，不新增 LLM 调用。固定 `locomo-8/9/0` 选择置信系数，
`locomo-1/7` 只作冻结验证；每个对话前 24 条为 shadow onboarding。开发集仍选择系数 0
（原 KNN24）。296 条冻结验证结果：

| 置信系数 | F1 差值 | Recall 差值 | Token 差值/题 |
|---:|---:|---:|---:|
| 0（冻结选择） | -0.00520 | -0.03027 | -50.59 |
| 0.5 | +0.00429 | -0.02293 | -43.23 |
| 1.0 | -0.00481 | -0.02349 | -33.30 |

三个版本都没有同时守住 F1 和 recall，因此置信门控不晋升，Top-10 保留为默认。仓库内可用
`npm run eval:topic3c` 从 0.39 MB 紧凑动作表复现；动作表不含对话正文、答案文本或模型请求。

LongMemEval 30 条缓存答案上的 `ridge-gated-0.01` 得到 F1/recall 差值 0、每题 token
`-22.9`，token bootstrap CI `[-46.37,-3.53]`。由于跨数据集特征漂移，不将其参数直接套用
到 LoCoMo。

## 编程反馈机制

本次从 `v2.0.0-beta.1` 重建的干净仓库验证结果：

- Topic 3C TypeScript：4 个测试文件，31 个测试全部通过；
- SWE solver Python：14 个测试全部通过；
- MemoryCore plugin build：通过；
- promotion smoke：第 24 条正反馈晋升，随后 hard regression 立即降级。

单元和 smoke 验证覆盖：

- warmup/shadow 强制 Top-10；
- mean 与 LinUCB 动作学习；
- 损坏状态安全回退；
- 编程质量适配；
- 编程反馈覆盖率门；
- 达标晋升；
- hard regression 立即降级。

合成 promotion smoke 中，前 24 条正反馈使候选达到 promoted；随后 1 条 regression/stale evidence 硬失败使作用域立即 demoted。该结果只证明机制，不是效果数据。

## SWE 初步结果

| 方案/任务 | Public validation | Official resolved | API token |
|---|---:|---:|---:|
| 5 题 public reproduction | 5/5 脚本生成校验；补丁有效 4/5 | 1/5 | 114,384 |
| public reproduction + repair | 5/5 脚本生成校验；补丁有效 4/5 | 1/5 | 148,010 |
| Astropy 13236 none | 1/1 | 0/1 | 97,268 |
| Astropy 13236 mixed | 0/1 | 0/1 | 140,582 |
| Astropy 13236 gated auto | 0/1 | 0/1 | 135,497 |

此外，Matplotlib 13989 的 linked + 函数定义加权方案生成了通过公开 reproduction 和窄回归的补丁。Astropy 14096 的 adaptive 记忆能在失败后正确注入，但未得到有效补丁。

## 当前结论

可以确认：

- 候选源码组织能改善部分任务的目标定位；
- asserted reproduction、窄测试、失败分类与回滚能减少无效验收；
- 编程反馈可以进入自适应策略并受项目级安全门控制。

尚不能确认：

- 历史 issue 记忆稳定提高 SWE-bench resolved；
- 函数用途卡片优于 linked 源码上下文；
- 当前少量 SWE 开发题可以代表独立泛化。

因此，中期检查将“核心机制实现”和“初步效果”分开报告：长对话有历史回放正向结果和冻结切分负结果；编程场景完成机制迁移和可执行验证，但成功率提升仍是后续研究问题。
