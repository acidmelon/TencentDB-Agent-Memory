# 干净环境复现记录

日期：2026-09-11

## 环境与步骤

从 `submission/topic3c-final-20260911.zip` 解压到独立临时目录。该目录不复用原仓库的
`node_modules`，先执行 `npm ci --ignore-scripts`，随后按提交说明运行测试、smoke、离线回放
和构建。Python 测试使用已配置的隔离虚拟环境，不调用模型或 Docker。

## 结果

| 检查 | 结果 |
|---|---|
| ZIP 必需文件 | 8/8 存在 |
| ZIP 中 `.git` | 0 |
| ZIP 中 `node_modules` | 0 |
| ZIP 中真实 `.env` | 0 |
| `npm ci --ignore-scripts` | 成功，608 packages |
| `npm run test:topic3c` | 17/17 通过 |
| `npm run smoke:topic3c` | 通过；第 24 条晋升，hard regression 后降级 |
| `npm run eval:topic3c` | 通过；冻结选择和指标精确一致 |
| Python solver | 14/14 通过，语法编译通过 |
| `npm run build` | 通过 |

## 回放断言

- `selected_confidence_multiplier == 0`
- validation F1 delta：`-0.005195654493831478`
- validation recall delta：`-0.03026730214230214`
- validation token delta/query：`-50.59121621621622`

这些负质量差值是预期实验结果；Runner 返回成功表示回放可复现，不表示策略通过晋升门。

## 已修复的复现阻断

精简仓库的 `build:scripts` 曾引用不存在的 `scripts/seed-v2/tsconfig.json`。该步骤已从构建链
移除，与完整实验仓库保持一致；修复后从压缩包解压的完整构建通过。
