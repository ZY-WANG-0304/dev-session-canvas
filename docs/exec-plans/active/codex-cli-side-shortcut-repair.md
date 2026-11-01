# 修复 Codex CLI Ctrl+/ 侧聊快捷键输入

本 `ExecPlan` 是活文档。随着工作推进，必须持续维护 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘`。本文遵循 `docs/PLANS.md`。

## 目标与全局图景

用户在画布 Agent / Terminal 的 xterm 获得焦点时按 `Ctrl+/`，应让 Codex CLI 收到代表该控制组合的输入，从而切换 `/side` 侧聊。修复复用现有 xterm `onData` 到 PTY 路径，且保留无选区 `Ctrl+C` 作为 ETX（`0x03`）打断输入。

## 上下文与定向

执行节点通过 `extensions/vscode/dev-session-canvas/src/webview/executionTerminalNativeInteractions.ts` 安装 `terminal.attachCustomKeyEventHandler`。其余键由 xterm.js 6.0.0 解析；`extensions/vscode/dev-session-canvas/src/webview/executionSessionNodes.tsx` 通过 `terminal.onData` 转成 `webview/executionInput`，Host 再写 PTY。锁定版 xterm 没有 Ctrl+/ 的键盘映射；Playwright 调试也已证明两类节点收到 DOM `keydown`，原流程却不产出 PTY 输入。

`Terminal.input(data, true)` 的 xterm API 会按用户输入方式触发 `onData`。Ctrl+/ 的传统终端控制表示是 ASCII US（`0x1f`），所以修复在 xterm handler 中识别聚焦终端上的 Ctrl+/，阻止原始按键继续传播并注入该字节。该字节尚未在真实 Codex CLI PTY 中确认：尝试启动本机 `codex-cli 0.166.0` 时，CLI 因用户状态目录只读退出。不能把这个缺失验证写成成功。

## 进度

- [x] (2026-11-01 05:15Z) 复核已完成的 CLI `/keymap` 与 Webview 调试证据，确认根因在 xterm 按键转换。
- [x] (2026-11-01 05:15Z) 在共享执行终端 handler 中增加仅对聚焦 xterm 生效的 Ctrl+/ 到 `0x1f` 输入映射。
- [x] (2026-11-01 05:15Z) 更新快捷键设计、产品规格与设计索引，记录输入映射、Ctrl+C 不变量和 PTY 验证边界。
- [x] (2026-11-01 05:15Z) `npm run build -- --execution-profile=stock` 与 `npm run typecheck` 成功；`git diff --check` 无错误，本轮未运行测试。
- [x] (2026-11-01 06:35Z) 处理 PR review：只按 `KeyboardEvent.key === '/'` 识别实际输出斜杠，不再按物理 `code` 兜底；Playwright 覆盖非美式布局下由其他物理键产生 `/`，以及物理 Slash 位置输出 `-` 的反例。
- [x] (2026-11-01 06:37Z) 更新 PR #355 描述，按最新 `origin/main` rebase 后推送 review 修复；新 head 为 `16c26855`。
- [x] (2026-11-01 08:03Z) 按 review 反馈将两条 Ctrl+/ Playwright 用例加入冻结目录 `scripts/gates/browser-catalog.json`；Playwright list 注册集合与目录均为 441 项且 ID 完全一致。
- [x] (2026-11-01 08:08Z) 更新 PR 验证说明，按最新 `origin/main` rebase 并推送目录修复；新 head 已启动 Release Preflight。
- [ ] 在可写且隔离的 Codex 配置下，以实际 Codex PTY 确认 `0x1f` 切换侧聊，并在真实 VS Code Agent 节点确认按键到 PTY 的整条链路。

## 意外与发现

- 观察：本机 `/keymap` 显示 `Global / Toggle Side Conversation` 绑定为 `ctrl-/`；OpenAI 官方命令文档未记录默认快捷键。
  证据：调研计划 `docs/exec-plans/completed/codex-cli-side-shortcut-compatibility-research.md`。
- 观察：浏览器 harness 中 Agent 和 Terminal 的 Ctrl+/ DOM 事件均没有 `webview/executionInput`，Ctrl+C 对照会发 ETX。
  证据：同一调研计划的 Playwright 记录。
- 观察：真实 PTY 候选编码实验未完成。本机 Codex 启动时退出并报用户状态目录只读。
  证据：以 `/tmp` 为 cwd 启动 `codex --no-daemon`，输出 `Error: Read-only file system (os error 30)`。
- 观察：`KeyboardEvent.code` 描述物理键位，不是当前字符。德语布局下物理 Slash 位置可以产生 `-`；按 code 兜底会错误吞掉 Ctrl+-。
  证据：PR #355 review 指出具体事件形状为 `key='-'`, `code='Slash'`；修复通过仅匹配实际 `key='/'` 消除该路径。
- 观察：浏览器事件可在非美式布局中同时有 `key='/'`、`shiftKey=true`，而 `code` 指向其他物理键。适配器现在以实际字符为准并允许此形状。
  证据：`node scripts/test/run-playwright-webview.mjs --grep 'uses the produced slash character'` 两例通过；反例 `key='-'`, `code='Slash'` 不产生 PTY 输入。
- 观察：PR #355 head `677a0992` 的 CI 在执行完 438 个功能用例并全部通过后，因冻结目录少了新增的 Agent / Terminal 两项而失败。
  证据：PR review 评论 `6555195964` 指向 Actions run `41281892842`；本地 Playwright `--list` 重新生成的 441 项 ID 集合与更新后的目录精确一致，缺项和多项均为零。

## 决策记录

- 决策：Ctrl+/ 只在当前 xterm textarea 持有焦点、Ctrl 为必要修饰键、无 Meta / Alt，且浏览器当前字符为 `/` 时拦截。允许 Shift 仅在实际字符仍是 `/` 时生效。
  理由：`event.code` 表示物理位置，会在非美式布局误把 Ctrl+- 当 Ctrl+/；依据 `event.key` 识别当前字符可同时支持需 Shift 才能产生 `/` 的布局。美式布局产生的 `?` 不匹配。
  日期/作者：2026-11-01 / Codex
- 决策：通过 `terminal.input('\x1f', true)` 发送 ASCII US。
  理由：xterm 6 不提供 Ctrl+/ 映射；xterm `input` API 会产生 `onData` 并复用现存 PTY 通路。Ctrl+/ 的实际 Codex 识别仍需真实 PTY 验证。
  日期/作者：2026-11-01 / Codex

## 工作计划

先在 Webview 共用 handler 识别输入。匹配后执行 `preventDefault` 和 `stopPropagation`，再调用 xterm `input`，返回 `false` 阻止 xterm 再次解释同一 DOM 事件。无匹配时继续运行现有剪贴板解析。该快捷键不依赖平台剪贴板策略。

接着复查 Agent 和 Terminal 是否都通过同一 handler，并确认 `Ctrl+C` 分支未经更改。构建扩展确认代码和类型有效。最终可观察验证是在真实 Codex TUI 中按 `/keymap` 复核绑定，再从聚焦 Agent xterm 按 Ctrl+/，观察侧聊打开；无选区 Ctrl+C 应仍发送 `0x03`。真实 Codex PTY 数据确认前，设计验证状态维持“验证中”。

## 验证与验收

代码检查应确认特殊分支先于剪贴板快捷键判定、只匹配焦点 xterm 和未带其他修饰键的 Ctrl+/，并且其余输入、复制粘贴行为保持原路径。构建应成功。真实 TUI 验收应确认 `0x1f` 的输入触发 `Toggle Side Conversation`，真实 Webview 验收应确认该字符出现在原 PTY 输入链，且 Ctrl+C 仍为 `0x03`。

本次 review 更新已运行定向 Playwright，Agent / Terminal 各一例通过；`npm run build -- --execution-profile=stock`、`npm run typecheck` 也通过。真实 TUI/VS Code 验收仍受只读用户 Codex 状态目录限制，必须在后续拥有隔离可写配置的环境完成后才能把设计标为已验证。

## 结果与复盘

修复通过 xterm 的用户输入 API 将实际字符 `/` 对应的 Ctrl 组合映射到传统控制字符 `0x1f`，并保留 Ctrl+C 输入处理。PR review 发现物理 Slash 位置回退会误拦非美式键盘 Ctrl+-；实现已改为按实际字符识别，并允许 Shift 参与产生 `/`。两类执行节点的布局回归通过，构建和类型检查通过。第二轮 review 确认无新代码 blocker；随后 CI 暴露浏览器冻结目录漏登记两条回归，现已补齐且与 441 项实际注册集合一致，PR 描述已同步并推送，Release Preflight 已启动。真实 Codex CLI PTY 仍未证实 `0x1f` 会触发侧聊，本计划保持 active，等待正式门禁和现场证据。
