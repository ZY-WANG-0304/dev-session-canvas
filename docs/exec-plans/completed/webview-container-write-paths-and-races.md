# 压实真实 Webview 写路径与生命周期竞态回归

本 ExecPlan 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘` 这几个章节。

本文件已完成，归档于 `docs/exec-plans/completed/webview-container-write-paths-and-races.md`；执行期间一直按 `docs/PLANS.md` 的要求维护，并把仍未收口的缺口同步登记到 `docs/exec-plans/tech-debt-tracker.md`。

## 目标与全局图景

当前仓库已经能在真实 VS Code Webview 容器里做 probe、做一条 Task 状态变更，并且在失败时保留宿主与页面级诊断；但大多数真实写路径仍停留在浏览器 harness，生命周期竞态也还缺少主动造故障的回归。完成本轮后，协作者应能直接运行 `npm run test:smoke`，看到真实容器里至少再覆盖 Note 编辑、删除按钮、Agent provider 切换与启动，以及 pending probe / DOM action 在 surface dispose 和 stop-vs-exit 竞态下不会留下错误副作用。

## 进度

- [x] (2026-04-06 22:30 +0800) 复读 `docs/PLANS.md`、现有调试自动化设计文档、技术债和 smoke 测试本体，确认本轮范围。
- [x] (2026-04-06 23:32 +0800) 扩展真实 Webview DOM 动作桥，覆盖更多字段编辑、按钮点击和可控延迟。
- [x] (2026-04-06 23:37 +0800) 把更多真实 Webview 写路径接入 `tests/vscode-smoke/extension-tests.cjs`。
- [x] (2026-04-06 23:37 +0800) 增加生命周期竞态 fault injection：覆盖 pending probe / DOM action 在 editor dispose 时的处理，以及 stop-vs-queued-exit 竞态。
- [x] (2026-04-06 23:38 +0800) 运行 `npm run typecheck`、`npm run test:smoke`、`npm run test:webview`，同步设计文档、技术债和本计划。
- [x] (2026-04-06 23:42 +0800) 按 `docs/workflows/COMMIT.md` 提交本轮相关文件，并将本计划移入 `completed/`。

## 意外与发现

- 观察：当前真实容器写路径只覆盖了 Task 状态切换，其余 Note 编辑、删除按钮、Agent provider 切换仍主要依赖浏览器 harness。
  证据：`tests/vscode-smoke/extension-tests.cjs` 当前只调用一次 `performWebviewDomAction({ kind: 'changeTaskStatus' ... })`。

- 观察：宿主已经具备 pending probe / DOM action 的 reject 路径，但现有 smoke 还没有主动制造“请求发出后 surface dispose，再收到迟到结果”的场景。
  证据：`src/panel/CanvasPanelManager.ts` 已有 `rejectPendingWebviewProbeRequests()` 与 `rejectPendingWebviewDomActionRequests()`，但测试里没有覆盖。

- 观察：真实 Agent 节点顶部动作按钮的文案不是固定“启动”，在前面跑过一次会话后会切成“重启”。
  证据：首次 smoke 失败时，`failure-error.txt` 记录 `未找到节点 agent-1 上标签为 启动 的按钮。`；当时节点快照里的 `agent-1` 已经带有 `lastExitMessage`。

## 决策记录

- 决策：本轮优先把真实容器桥扩成通用的字段编辑 / 选择 / 按钮点击能力，而不是为每个测试再增加一组专门命令。
  理由：这样能把测试 API 面控制在 `performWebviewDomAction` 一处，并把真实交互覆盖面做成可复用基础设施。
  日期/作者：2026-04-06 / Codex

- 决策：Agent provider 切换后的真实容器启动链路在 smoke 中点击“重启”而不是“启动”。
  理由：当前可信场景会先跑过 Agent 主路径，Agent 节点在失败路径阶段已经带有 `lastExitMessage`，按钮文案按产品逻辑应为“重启”；测试应适配真实节点生命周期，而不是硬编码初始文案。
  日期/作者：2026-04-06 / Codex

## 结果与复盘

本轮目标已经完成，实际收口如下：

1. `WebviewDomAction` 扩展为通用的文本字段编辑、下拉选择和按钮点击能力，并支持可选 `delayMs`；真实 Webview probe 也增加了可控延迟，用于稳定制造 pending request。
2. trusted smoke 现在在真实 VS Code Webview 容器里新增覆盖了 Note 正文编辑、Agent provider 切换后重启，以及删除按钮点击；原有 Task 状态变更仍保留。
3. trusted smoke 新增两组生命周期 fault injection：pending DOM action / probe 在 editor dispose 时必须 reject，且不污染状态；fake agent 收到“sleep 后 exit”的输入后立刻 stop，只允许收口成一次 exit。
4. 正式文档和技术债已同步，明确写清楚“真实容器覆盖面扩大了，但浏览器 harness 仍承担大量 UI 回归”。

本轮验证记录：

    $ npm run typecheck
    ... exit 0

    $ npm run test:smoke
    Trusted workspace smoke passed.
    Restricted workspace smoke passed.
    VS Code smoke test passed.

    $ npm run test:webview
    7 passed
    Playwright webview tests passed.

复盘：

- 真实容器测试最值钱的地方不只是把按钮点通，还要配合宿主诊断事件断言“竞态只收口一次”。
- 如果产品 UI 文案本来就会随生命周期变化，smoke 应该贴着真实文案状态机写，而不是假定每一步都回到“首次打开”。
- `delayMs` 这种最小 test-only 钩子比随意堆更多 `sleep()` 更稳，也更容易解释失败原因。

## 上下文与定向

本轮会同时改动四类文件。

第一类是协议与测试桥。`src/common/protocol.ts` 定义宿主与 Webview 间的测试消息和 `WebviewDomAction` 类型；`src/extension.ts` 把测试命令暴露给 smoke；`src/panel/CanvasPanelManager.ts` 负责把测试命令转成发往真实 Webview 的请求，并在 surface dispose 时 reject pending request。

第二类是真实 Webview 容器实现。`src/webview/main.tsx` 当前已经支持 probe 和两种 test DOM action；本轮会把它扩到更多真实交互，并允许在测试动作或 probe 前加入可控延迟，以便主动制造生命周期竞态。

第三类是真实宿主 smoke。`tests/vscode-smoke/extension-tests.cjs` 当前已经覆盖 trusted / restricted 主路径、真实 probe、Task 状态 DOM action、live session 切面与 PTY 边界。本轮会把更多真实写路径和竞态断言放进去，并直接使用新增的宿主诊断时间线验证事件顺序。

第四类是正式文档。`docs/design-docs/development-debug-automation.md` 需要同步“真实容器已覆盖的写路径”和“新增 fault injection”；`docs/exec-plans/tech-debt-tracker.md` 需要把仍未完成的真实容器缺口写清楚，不把本轮覆盖夸大成“已完全等价于真实容器端到端 UI 自动化”。

这里的“真实写路径”指真实 VS Code Webview 容器里由 DOM 事件触发、并通过现有宿主消息链回流的交互，而不是直接调用测试命令篡改宿主状态。这里的“生命周期竞态”指请求已发出，但 surface、session 或宿主状态在响应前发生变化，系统仍能安全收口的情况。

## 工作计划

先扩展协议和 Webview 测试桥。做法是把 `WebviewDomAction` 从两种硬编码动作扩到通用的字段编辑、下拉选择和按钮点击，并允许动作附带可选 `delayMs`。对 probe 也加入可选延迟参数，让 smoke 可以稳定制造 pending request。

然后扩展 smoke 本体。可信场景里继续使用 editor 真实容器，但把 Note 正文编辑、Agent provider 切换后启动、以及删除按钮点击接到真实 DOM action，而不是继续只靠 `dispatchWebviewMessage`。这一步需要配合 probe、snapshot 和诊断事件三种证据一起断言，避免只测到宿主状态而没测到容器 UI。

接着补生命周期竞态。第一组竞态是 pending probe / DOM action 发给 editor 后立即关闭 editor，预期测试命令收到明确 reject，迟到结果不会污染状态，也不会让宿主诊断里出现重复完成。第二组竞态是 fake agent 收到“先 sleep 再 exit”的输入后立刻 stop，预期最终只收口成一次 exit，节点状态稳定且不会残留 live session。

最后更新文档、技术债和本计划，运行自动化验证，并按 commit 约定提交。

## 具体步骤

1. 修改 `src/common/protocol.ts`，把 `WebviewDomAction` 扩成通用动作，并给 `host/testProbeRequest` 增加可选延迟参数。
2. 修改 `src/webview/main.tsx`，实现新的真实 DOM 动作和 probe 延迟能力。
3. 修改 `src/panel/CanvasPanelManager.ts`、`src/extension.ts` 与必要的测试命令签名，让 smoke 能传入新的动作和 probe 延迟。
4. 修改 `tests/vscode-smoke/extension-tests.cjs`，增加真实容器写路径覆盖和竞态测试。
5. 更新 `docs/design-docs/development-debug-automation.md`、`docs/exec-plans/tech-debt-tracker.md` 和本计划。
6. 运行验证命令，记录结果，并将计划移到 `docs/exec-plans/completed/`。

## 验证与验收

至少运行以下命令：

- `npm run typecheck`
- `npm run test:smoke`
- `npm run test:webview`

验收口径：

- trusted smoke 在真实 VS Code Webview 容器里新增覆盖 Note 正文编辑、Agent provider 切换后启动，以及删除按钮点击中的至少两类以上写路径。
- trusted smoke 能稳定制造并验证至少两类生命周期竞态，其中一类必须是 pending Webview request 在 editor dispose 时被 reject。
- 竞态断言不仅看最终 snapshot，还要结合宿主诊断事件确认没有重复 exit、没有残留 live session、没有错误的迟到更新。
- 失败诊断仍保持可读；如新增 delay 或 fault injection，不得让普通 smoke 变成随机失败。

## 幂等性与恢复

- 所有自动化产物继续写入仓库内 `.debug/`，重复执行可安全覆盖。
- 新增延迟参数只在测试模式生效，不进入产品命令贡献区，也不影响正常用户路径。
- 如果某条竞态回归不稳定，应优先缩小故障注入窗口或增加明确同步点，而不是靠长时间睡眠硬拖。

## 证据与备注

本轮完成后的关键验证如下，说明真实容器写路径与 fault injection 已经并入默认回归：

    $ npm run typecheck
    ... exit 0

    $ npm run test:smoke
    Trusted workspace smoke passed.
    Restricted workspace smoke passed.
    VS Code smoke test passed.

    $ npm run test:webview
    7 passed
    Playwright webview tests passed.

## 接口与依赖

本轮继续依赖：

- `@vscode/test-electron` 提供真实 VS Code 容器。
- `@playwright/test` 继续承担浏览器 harness 回归，不在本轮替代真实容器 smoke。
- `tests/vscode-smoke/fixtures/fake-agent-provider` 提供可控的 `sleep` / `exit` 行为，用于 stop-vs-exit 竞态。

新增的测试桥必须继续遵守现有边界：只在 `vscode.ExtensionMode.Test` 下可用，不进入 `package.json` 命令贡献，不把测试语义泄漏到产品功能。

最后更新说明：2026-04-06 完成真实容器写路径扩展、生命周期 fault injection、自动化验证和文档同步；待提交后移入 `completed/`。
