# 创建节点入口常显与受限原因提示

本 `ExecPlan` 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘` 这几个章节。

当前文档必须按 `docs/PLANS.md` 的要求持续维护。

## 目标与全局图景

完成后，用户无论在右键空白区菜单，还是通过 VS Code 命令/Quick Input 走“创建节点”，都始终能看到 `Agent`、`Terminal`、`Note` 三类入口；不再因为 workspace untrusted 而把执行型节点入口直接隐藏。若当前场景下某类节点不能创建，用户点击后会看到宿主 modal，明确解释“为什么不可用”，而不是只剩下 `Note`、或只收到一条模糊 toast。

本次变更的可见结果应当能直接观察到：在 restricted / untrusted smoke 中，侧栏状态与 Quick Input 仍列出三类入口；在 webview harness 中，把 runtime 切到 `workspaceTrusted: false` 后，右键菜单仍显示 `Terminal` 与 provider 入口，但点击不会发 `webview/createDemoNode`，而是发出“显示不可用原因”的宿主请求。

## 进度

- [x] (2026-05-29T15:53Z) 读取 `docs/WORKFLOW.md`、`docs/PLANS.md`、`docs/DESIGN.md` 与相关产品/设计文档，确认本任务需要先补 `ExecPlan` 再实现。
- [x] (2026-05-29T15:53Z) 确认分支 `canvas-create-entry-untrusted-modal` 已存在，且当前 worktree 里的用户未跟踪文件不会被本任务触碰。
- [x] (2026-05-29T16:10Z) 新增正式 `ExecPlan`，并把“入口常显 + 点击解释原因”的产品/设计口径同步回正式文档。
- [x] (2026-05-29T16:18Z) 修改宿主、webview 与命令入口：始终暴露三类创建入口，并把“不可创建原因”从“隐藏入口”改成“点击后弹 modal”。
- [ ] 更新 smoke / Playwright 回归，验证 trusted 与 restricted 两条路径。（已补回归用例；当前受本机 Playwright 启动权限与 smoke host SIGABRT 影响，尚未拿到完整通过证据）

## 意外与发现

- 观察：当前 restricted 语义并不是“入口可见但不可用”，而是直接把 `creatableKinds` 收窄为 `['note']`；因此 Quick Input、侧栏和右键菜单都共用了一条“隐藏执行型入口”的老策略。
  证据：`extensions/vscode/dev-session-canvas/src/extension.ts` 的 `createNode` 命令直接读 `panelManager.getSidebarState().creatableKinds`；`extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts` 与 `extensions/vscode/dev-session-canvas/src/webview/main.tsx` 都在 untrusted 时只返回/渲染 `['note']`。

- 观察：宿主已经保留了“直接拒绝 untrusted execution create”的硬兜底，但目前只通过 `host/error` 返回 toast 文本，不会弹 modal。
  证据：`extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts` 的 `applyCreateNode()` 在 untrusted 且 `kind` 为 `agent/terminal` 时直接 post `host/error`，文案为 `当前 workspace 未受信任，已禁止创建 Agent / Terminal 节点。`

- 观察：如果把 modal 直接塞进 `applyCreateNode()` 的所有拒绝路径，会污染现有“伪造消息/测试直发 createDemoNode”的 smoke，因为这些路径目前依赖同步拒绝 + host error，而不是等待 UI 交互。
  证据：`tests/vscode-smoke/extension-tests.cjs` 的 restricted smoke 直接 `dispatchWebviewMessage({ type: 'webview/createDemoNode', ... })`，并断言 host error；这条路径不应因为新增 modal 而阻塞。

- 观察：现有 `CanvasSidebarState.creatableKinds` 在代码里没有其他复杂语义消费，主要只服务 Quick Input 与状态快照，因此把它改成固定全集不会破坏其他子系统。
  证据：仓库内 `rg "creatableKinds"` 仅命中 `extensions/vscode/dev-session-canvas/src/extension.ts`、`extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts`、`extensions/vscode/dev-session-canvas/src/webview/main.tsx` 与 restricted smoke 断言。

- 观察：本地验证环境本身有两个与本次改动无关的外部阻塞。其一是依赖初始缺失，需要先用临时 npm cache 执行一次 `npm ci`；其二是 Playwright Chromium 在当前 macOS 环境里因 `bootstrap_check_in ... Permission denied (1100)` 直接崩溃，restricted smoke 进程也在当前机器上以 `SIGABRT` 结束，因此暂时无法在本机拿到完整 UI 自动化绿灯。
  证据：`npm run typecheck` 在安装依赖前报 `Cannot find module ...`；安装后 `typecheck` 通过。`npm run test:webview -- --grep ...` 输出 Chromium `mach_port_rendezvous` fatal；`DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=restricted node scripts/smoke/run-vscode-smoke.mjs` 返回 `SIGABRT`。

## 决策记录

- 决策：把“是否展示该创建入口”和“当前是否允许真正创建”拆成两层；三类入口始终展示，真正的可用性由宿主判断。
  理由：用户要的是“不要藏入口，要解释原因”；隐藏入口会让侧栏、右键与 Quick Input 三条主路径都产生不一致的缺失感。
  日期/作者：2026-05-29 / Codex

- 决策：右键菜单点击受限项时，不再沿用 `webview/createDemoNode -> host/error` 这条创建链路，而是改为发送一个专门的“显示不可用原因”消息给宿主。
  理由：这样可以避免“先尝试创建，再弹 modal，再吐 toast”的重复反馈，同时保留 `createDemoNode` 作为真正创建/伪造消息测试的硬兜底入口。
  日期/作者：2026-05-29 / Codex

- 决策：VS Code `Dev Session Canvas: 创建节点` 命令在 reveal/创建前，先向宿主查询该类型当前是否允许创建；若不允许，直接由扩展侧 `await` 宿主 modal，然后停止，不再为 restricted 场景额外打开画布。
  理由：Quick Input 是宿主交互，不需要绕回 webview 才知道当前不可用；提前拦截也让 smoke 更稳定。
  日期/作者：2026-05-29 / Codex

- 决策：保留 `applyCreateNode()` 对 forged `webview/createDemoNode` 的 host error 拒绝，不把它升级成 modal。
  理由：这是 defense-in-depth 路径，不是用户点击后的正常 UX；继续保持轻量拒绝，便于 smoke 明确断言。
  日期/作者：2026-05-29 / Codex

## 结果与复盘

- 当前已完成文档与主实现收口：`creatableKinds` 改为三类常显；Quick Input 会在 reveal 前检查 block reason；Webview 右键菜单在 untrusted execution create 时改发“解释原因”消息；宿主新增统一 modal 解释路径。
- 已补两类回归断言：`tests/playwright/webview-harness.spec.mjs` 覆盖 untrusted 右键菜单仍显示 execution entries 且改发解释消息；`tests/vscode-smoke/extension-tests.cjs` 覆盖 restricted Quick Input 仍显示入口但点击后弹 modal。
- 当前剩余缺口不是代码层 blocker，而是本机自动化环境阻塞：需要在可启动 Playwright Chromium、且 restricted smoke 不会因宿主 `SIGABRT` 中断的环境里复跑。

## 上下文与定向

这项工作会同时触达三个入口面：

1. `extensions/vscode/dev-session-canvas/src/webview/main.tsx`：空白区右键菜单的创建入口与点击行为。
2. `extensions/vscode/dev-session-canvas/src/extension.ts`：命令 `Dev Session Canvas: 创建节点` 的两层 Quick Input。
3. `extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts`：宿主权威状态、`CanvasSidebarState`、受限原因判定、以及所有创建请求的最后兜底。

当前仓库里“可创建类型”由 `CanvasSidebarState.creatableKinds` 承担，但它同时被拿来表达“显示哪些入口”和“当前允许哪些类型真正创建”，导致 untrusted 时整条链路都只剩 `Note`。本次要把这个共享状态改成“展示全集”，并新增一条显式的“为什么当前不能创建 execution node”的宿主解释路径。

这里的“execution node”指 `Agent` 与 `Terminal`，也就是会启动 CLI / shell、写入输入或承载 live session 的节点。`Note` 不属于 execution node，因此在 untrusted 下仍允许正常创建。

## 工作计划

先更新正式文档，把 restricted 语义从“隐藏/禁用执行型入口”改成“入口常显，点击后解释原因”。对应产品规格至少需要覆盖：

- `docs/product-specs/canvas-sidebar-controls.md`：侧栏与 `创建节点` 命令的 restricted 口径。
- `docs/product-specs/canvas-navigation-and-workbench-polish.md`：右键空白区快捷创建在 restricted 下的正式行为。
- `docs/product-specs/agent-launch-modes-and-restart.md`：Quick Input 与 provider drill-in 在 restricted 下仍可见，但最终创建会被解释性阻止。

随后更新设计文档：

- `docs/design-docs/canvas-sidebar-controls.md`
- `docs/design-docs/canvas-navigation-and-workbench-polish.md`
- `docs/design-docs/agent-launch-modes-and-restart.md`
- `docs/design-docs/index.md`

实现阶段按以下顺序收口：

1. 在宿主里抽出统一的“创建节点是否被阻止”判断与 modal 展示函数。这个逻辑至少先覆盖 `workspaceTrusted === false` 且 `kind` 为 `agent/terminal` 的场景。
2. 把 `CanvasSidebarState.creatableKinds` 改成始终返回 `['agent', 'terminal', 'note']`，让 Quick Input 与侧栏入口恢复全集展示。
3. 在 `extensions/vscode/dev-session-canvas/src/extension.ts` 的 `createNode` 命令里，在 reveal/create 前检查 block reason；若存在则直接 `await` modal 并结束。
4. 在 `extensions/vscode/dev-session-canvas/src/common/protocol.ts` 新增一个 webview -> host 消息，用于“用户点了当前不可用的创建项，请宿主解释原因”。
5. 在 `extensions/vscode/dev-session-canvas/src/webview/main.tsx` 的 `createNode()` 里，当 `runtimeContext.workspaceTrusted === false` 且 `kind` 为 `agent/terminal` 时，不再 post `webview/createDemoNode`，改发新的解释消息；右键菜单仍照常展示这些入口。
6. 保持 `applyCreateNode()` 对原始 `webview/createDemoNode` 的 untrusted 拒绝逻辑不变，继续作为 forged-message 兜底。

测试分两层：

- `tests/playwright/webview-harness.spec.mjs`：验证 untrusted runtime 下右键菜单仍显示三类入口，点击 `Terminal` / `Agent` 会发“解释原因”消息而不是 `webview/createDemoNode`。
- `tests/vscode-smoke/extension-tests.cjs`：restricted smoke 从“只剩 Note”改为“侧栏 creatableKinds 仍含三类”；并新增 Quick Input 选择 `Agent` / `Terminal` 后会触发 modal、不会创建节点的断言；同时保留 forged `createDemoNode` 仍只收到 host error 的断言。

## 具体步骤

在仓库根目录执行以下命令进行验证：

    npm run typecheck
    npm run test:webview -- --grep "untrusted create menu|right-clicking the empty pane opens a quick-create menu near the pointer"
    DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=restricted node scripts/smoke/run-vscode-smoke.mjs

若 restricted smoke 仍依赖旧口径，需要先同步更新断言，再重新执行第三条命令。

## 验证与验收

验收以以下可观察行为为准：

1. restricted / untrusted 时，侧栏状态里的 `creatableKinds` 仍为 `['agent', 'terminal', 'note']`。
2. 执行 `Dev Session Canvas: 创建节点` 时，第一层 Quick Input 仍显示 `Agent`、`Terminal`、`Note`；选择 `Terminal` 或完成 `Agent` 第二步后，不创建节点，而是弹出 modal 解释当前为何不可用。
3. webview harness 把 runtime 设成 `workspaceTrusted: false` 后，空白区右键菜单仍显示 `Terminal` 与 provider 入口；点击受限项不会发 `webview/createDemoNode`。
4. 直接伪造 `webview/createDemoNode(kind: 'agent'|'terminal')` 仍会被宿主拒绝，并继续产生 `host/error`，证明 defense-in-depth 没被绕过。

## 幂等性与恢复

- 文档修改是幂等的；若后续实现改变了具体 modal 文案，必须同步回产品规格与设计文档，而不是只改代码。
- 代码实现若中途失败，可重复运行 `typecheck` 与 targeted tests；没有 schema migration 或需要清理的持久化副作用。
- 不要删除用户当前 worktree 里的未跟踪诊断文件；它们与本任务无关。

## 证据与备注

当前已确认的旧行为基线：

    extensions/vscode/dev-session-canvas/src/extension.ts
      createNode 命令直接读取 panelManager.getSidebarState().creatableKinds

    extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts
      getSidebarState(): untrusted => creatableKinds: ['note']
      applyCreateNode(): untrusted execution node => host/error

    extensions/vscode/dev-session-canvas/src/webview/main.tsx
      runtimeContext.workspaceTrusted 为 false 时，右键菜单 creatableKinds 只剩 ['note']

    tests/vscode-smoke/extension-tests.cjs
      restricted smoke 断言 snapshot.sidebar.creatableKinds === ['note']

## 接口与依赖

本次实现会直接修改以下稳定接口：

- `extensions/vscode/dev-session-canvas/src/common/protocol.ts`
  - 扩展 `WebviewToHostMessage`，新增一个“解释创建不可用原因”的消息类型。
- `extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts`
  - 新增 `getCreateNodeBlockReason(kind)` 与宿主 modal 展示函数。
  - `CanvasSidebarState.creatableKinds` 改为固定全集。
- `extensions/vscode/dev-session-canvas/src/extension.ts`
  - `COMMAND_IDS.createNode` 的执行路径新增 blocked preflight。
- `extensions/vscode/dev-session-canvas/src/webview/main.tsx`
  - `createNode()` 在受限 execution kind 下不再 post `webview/createDemoNode`，而是 post 新的解释消息。

本次计划新增文件：`docs/exec-plans/active/create-node-entry-availability-and-block-reasons.md`。新增原因：当前需求跨越产品语义、设计收口、宿主实现与测试回归，已经超出简单 bugfix 范围，必须有单独的执行计划承载过程和决策。
