# 最终交付包干净环境验收

日期：2026-09-14。

## 验收来源

本轮从 `submission/topic3c-final-20260914-candidate2.zip` 独立解压，在新临时目录执行安装与验收。未复用 clean 的 node_modules，未调用模型或 Docker。候选包内 816 个文件逐一通过 SUBMISSION-MANIFEST.json 的 SHA256 校验。

首轮候选缺少被忽略的 MemoryCore/package-lock.json，npm ci 失败。已将锁文件纳入 clean 的 Git 跟踪范围及打包清单，第二轮完整通过。此处记录实际执行结果，先前 9 月 11 日包不作为本轮通过证据。

## 结果

| 检查 | 结果 |
|---|---|
| 清单与 ZIP 文件集合一致 | 816 个文件通过；另有清单自身 |
| .git、node_modules、真实 .env、dsapicode.txt | 未进入交付包 |
| npm ci --ignore-scripts | 通过，独立安装 592 个包 |
| npm run test:topic3c | 4 文件、31 测试通过 |
| python scripts/topic3-c/test_swe_agent_v2.py | 14 项通过 |
| npm run smoke:topic3c | 第 24 条晋升，第 25 条硬失败降级 |
| npm run eval:topic3c | 通过，与包内冻结结果逐字节一致 |
| npm run build | 通过 |
| 最终报告 PDF | 4 页，逐页渲染检查 |

环境为 Windows、Node v24.13.0、Python 3.14.7。最小复现命令在 MemoryCore 目录执行。Python 单元测试存在 mock HTTPError 清理警告，不影响通过结果。

## 最终包与回执

最终包为 `submission/topic3c-final-20260914.zip`。其独立安装验收回执位于同名 `.zip.verification.json`，校验值位于 `.zip.sha256`。回执在对实际最终 ZIP 再次验收后写入，以避免报告先宣称通过却没有对应包。Git base_commit 只表示基准提交；包内逐文件 SHA256 定义实际交付内容，不能据此声称远端已同步。

MemoryProxy/packages/cost-guard 是上游 Git gitlink，当前仓库没有其源码，且不属于本次 MemoryCore 验收范围。打包清单明确记录其路径和 commit；本包不承诺复现整个 MemoryProxy 平台。

## 已知限制

- npm audit 报告 24 项告警：22 moderate、2 high。high 涉及 @opentelemetry/propagator-jaeger 和 @opentelemetry/sdk-node，关联 GHSA-45rx-2jwx-cxfr。建议升级方案超出现有 sdk-node 声明范围，本轮未批量升级基座遥测栈；本次验收不是依赖安全审计通过证明。
- 召回集成测试对 keyword store 使用 mock 边界，不替代实际数据库或 Gateway 部署测试。
- L0 超时回退最多执行两次 recall timeout；底层已发出的请求不强制取消。
- 学习状态按单一反馈写入方管理，不保证跨进程多写入方事务隔离。
- 公开长对话回放是缓存决策层复现；没有重新抽取记忆、调用模型或扩大 SWE 官方评测。
