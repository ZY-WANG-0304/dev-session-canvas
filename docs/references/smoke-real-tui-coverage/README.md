# 四项真实 TUI 验证记录

本记录区分 CLI 信号探索、自动化反例与产品 Host 验收。目录映射的 152 implemented-unverified / 0 not-implemented 只表示实际入口存在。

## 固定输入与判定

分支基于 PR340 merge `2dc6d17351591a86265f1d69d420b43a23b578ee`。Linux、snapshot-only，Codex 0.157.1 / Claude 2.1.280，模型 deepseek-flash；Codex `https://api.deepseek.com/`（Responses）、Claude `https://api.deepseek.com/anthropic`。CI 使用已有 DEEPSEEK_API_KEY，私有配置清理后仅保留白名单事件和页面事实；记录不含凭据。

当前回合由精确 prompt、workspace、session、工具 callId、新生成 receipt 和正常 Stop 关联，Codex 另核 turn_id。比较整段实际回答及其下方的输入区；不要求跨运行回答相同。等待工具尚未返回时观察运行态；此条件不覆盖供应商断网重连。完成后的真实 resize 检查列数改变、正文、状态和通知计数。

## CLI 探索（acceptance=false）

| Actions run | 实际结果与修复 |
| --- | --- |
| 40681385645 | 请求前因 CommonJS xterm 命名导入失败；修正默认导入，无模型业务证据。 |
| 40681635343 | Codex 当前 prompt/Stop 已取得，但工具授权拒绝；Claude 在 Security notes。仅修正私有授权和初始化。 |
| 40682240862 | Codex 通过；Claude 默认 No 导致退出。 |
| 40682790799 | Codex 通过；Claude trust 首次 Down 可回退，未到业务回合。 |
| 40683639714 | 两 provider 全部通过。复用已验证的 End / 两次稳定 Yes / 唯一 Enter；记录工具等待、未提交草稿、Stop 实际回答和 resize。 |

脱敏事件、工具身份、关键页面和原文件 hash 保存在 [CLI 样本](cli-signals.json)。最终探索工件为 `tui-signals-codex`（12813767623）和 `tui-signals-claude`（12814331583）。Claude 实际 session 为 `fae62f6c-bc2e-41ae-aec2-21bcab1e89ee`，Stop 回答为 `The test received receipt receipt_0ea500e2fb374a6f981c1055cbc15d23.`。两个版本均提供正常 Stop 与当前 UserPromptSubmit；这未启动产品 Host，不能代证四项产品通过。探索 workflow 与脚本完成用途后移除。

## 本地回归

- 完整 test:ci-gates 139/139。此前修改目录与测试并行引起 digest 不一致的失败保留，不追认为通过；冻结输入后完整重跑通过。
- test:agent-tui 7/7，覆盖错误/陈旧回合、tool receipt 因果、页面位置、初始化，以及真实 MCP 子进程的精确释放/重复调用拒绝和 hook 白名单事件。
- 原 smoke-runtime-retirement 18/18、typecheck、DeepSeek 私有配置、release-preflight / publish-tag-release 接线、runner 环境过滤通过。
- 本机无 DEEPSEEK_API_KEY，未进行本地模型请求。固定 Claude 在本地不可连通地址、零请求条件下通过初始化检查；该证据仅限启动。

## 产品验收

PR341 的旧输入 run40682891236 在 regression shard-2 暴露 runner VM 仍仅提供 scenarios，而新入口额外读取 selectedSuites；将路由并入既有 scenarios 后原退役回归通过。旧轮失败保留并取消剩余执行，避免阻塞后续输入。

输入 e4f865da 的 Release Preflight run40683646799 正在执行；四项 source 和四项 packaged、各两 provider 的结果尚待实际 Host 工件确认。所有清理及 Host 退出结果也需通过，不能由上述探索或静态检查代证。
