# 实现运行时持久化与会话监督器

本 `ExecPlan` 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘` 这几个章节。

本计划位于仓库根目录下的 `docs/PLANS.md` 约束体系内，后续任何继续推进该主题的协作者都必须按 `docs/PLANS.md` 的要求持续维护本文件。

## 目标与全局图景

这项工作要把 `docs/design-docs/runtime-persistence-and-session-supervisor.md` 中已经收口的设计真正落到代码里。完成后，用户在打开 `devSessionCanvas.runtimePersistence.enabled` 时，`Agent` 与 `Terminal` 不再由 extension host 直接拥有，而是交给一个独立的会话监督器进程持有；关闭整个 VSCode 后，这些真实进程仍然可以继续运行，并在下次打开工作区时重新附着到原节点。

用户可直接观察到的结果应包括：

- 开启配置后，`Agent` / `Terminal` 的启动路径改为 live runtime 持久化路径。
- 关闭并重新打开 VSCode 后，带有持久化会话身份的节点先显示 `重连中`。
- 如果监督器仍持有真实会话，节点会恢复为真实生命周期状态并出现关闭期间新增的输出。
- 如果监督器无法重新附着，节点会进入 `历史恢复`，而不是伪装成仍在运行。
- 关闭配置时，系统回到现有的 snapshot-only 路径，不承诺真实进程跨 VSCode 生命周期存活。

## 进度

- [x] (2026-04-08 10:48 +0800) 阅读 `docs/WORKFLOW.md`、`docs/PLANS.md`、`AGENTS.md`、运行时持久化设计文档、当前 `CanvasPanelManager` / PTY bridge / smoke tests，确认这是一条需要独立 `ExecPlan` 的显著实现改造。
- [x] (2026-04-08 11:06 +0800) 新增实现阶段所需的共享协议与配置字段：运行时持久化开关、持久化模式、运行时附着态、监督器会话身份。
- [x] (2026-04-08 11:10 +0800) 新增独立的 runtime supervisor 进程入口、IPC 协议、会话注册表与持久化目录布局。
- [x] (2026-04-08 11:18 +0800) 把 `CanvasPanelManager` 从“直接拥有 live runtime”改为“双路径”执行模型：默认 snapshot-only 保持现状，开启配置后改走 supervisor。
- [x] (2026-04-08 11:24 +0800) 接通 `Agent` / `Terminal` 的 live-runtime 启动、附着、输入、resize、停止、删除与历史恢复回写，并补上“关闭开关后不再重连、停用前清理 supervisor 会话”的语义。
- [x] (2026-04-08 11:24 +0800) 更新 Webview UI，使状态标签优先显示 `重连中` / `历史恢复`，而不是直接沿用旧 lifecycle。
- [x] (2026-04-08 11:28 +0800) 扩展 smoke tests，覆盖 live-runtime 启动、断开后重新附着、离线期间输出可见，以及关闭开关后不再重连。
- [x] (2026-04-08 11:31 +0800) 运行 `npm run typecheck`、`npm run build`、`npm run test:smoke`、`npm run test:webview`，并把残余验证缺口写回计划与设计文档。
- [x] (2026-04-09 08:27 +0800) 将 runtime supervisor 路径模型正式重构为 `storageDir` / `runtimeDir` 分层；client 改为显式传递 `--storage-dir`、`--socket-path`、`--runtime-dir`，并补充路径回归测试。
- [x] (2026-04-09 09:35 +0800) 补上“真实关闭整个 VSCode 窗口再重新打开”的两阶段 smoke；setup 阶段显式 flush 画布快照到 `canvas-state.json`，verify 阶段确认节点恢复、sessionId 不变且能拿到关闭期间新增输出。
- [x] (2026-04-10 15:46 +0800) 将 supervisor 启动链路改为“短命 launcher 拉起真正 supervisor”，避免 `Extension Development Host` 在 Run and Debug / Remote SSH 下把 direct child supervisor 一并终止。
- [x] (2026-04-10 16:58 +0800) 用户完成 Remote SSH + `Run Dev Session Canvas` 的 F5 手动验证，确认 launcher 链路下 `Agent` / `Terminal` 会重新附着到原 live runtime，而不是退化为 `历史恢复`。
- [x] (2026-04-10 17:06 +0800) 调试入口收敛为单一 `Run Dev Session Canvas` configuration，固定 `user-data-dir` 用于 runtime persistence 验证，并将本计划迁入 `docs/exec-plans/completed/`。

## 意外与发现

- 观察：当前所有真实会话都由 `src/panel/CanvasPanelManager.ts` 中的 `agentSessions` / `terminalSessions` 直接持有；`workspaceState` 只存节点快照与少量恢复上下文。
  证据：`startAgentSession()`、`startTerminalSession()` 直接调用 `createExecutionSessionProcess()`，`reconcileRuntimeNodes()` 在 extension reload 后只能把旧 live 状态折成 `resume-ready` 或 `interrupted`。

- 观察：当前 smoke tests 已经具备“扩展重载”“状态持久化”“真实 fake provider CLI”三类验证基建，但还没有“真实 supervisor 继续活着、扩展重新附着”的自动化场景。
  证据：`tests/vscode-smoke/extension-tests.cjs` 里已有 `verifyRuntimeReloadRecovery()` 和 `verifyPersistenceAndRecovery()`，但没有 live-runtime reconnect 专项命令。

- 观察：如果 supervisor 输入仍停留在 fire-and-forget Promise 上，紧接着发生 runtime reload 时，已经在 UI 中提交的输入可能来不及真正写到 live runtime。
  证据：首次 `npm run test:smoke` 在 `verifyLiveRuntimePersistence()` 中超时；节点已重新附着，但 `Terminal` 缺失 `LIVE_RUNTIME_TERMINAL` 输出。给 `CanvasPanelManager` 增加 pending supervisor operation 跟踪并在 host 边界前 flush 后，smoke 恢复通过。

- 观察：Playwright 功能测试全部通过后，仍出现基线截图与当前节点头部状态 pill 的轻微差异。
  证据：`npm run test:webview` 首次失败仅剩 `canvas-shell-baseline.png`，差异集中在 `Agent` / `Terminal` 头部的 `草稿` pill；同步快照基线后，9 个 Playwright 用例全部通过。

- 观察：只把 `socketPath` 从 storage 路径回退到 `/tmp` 还不够清晰；路径模型本身需要显式区分持久化目录和运行时目录，否则 client、supervisor 与文档都仍在共享一个含混的 “rootDir”。
  证据：现有实现里 `registryPath` 明显应归属 storage，而 `socketPath` 明显应归属 runtime，但接口层只有一个 `rootDir`，导致启动参数与目录准备逻辑都需要隐式推断。

- 观察：真实关窗重开场景里，仅依赖 `workspaceState` 和异步 `persistState()` 不足以形成稳定证据；如果第一阶段在 VSCode 进程退出前没有显式等待快照落盘，第二阶段可能会先激活一个空画布状态。
  证据：补测试前，real-reopen phase2 的 failure snapshot 一直是 `nodes: []`，而 supervisor registry 仍然存在；补充显式 flush 后，`canvas-state.json` 会稳定出现在 workspace storage 下，phase2 也能恢复到原节点并重新附着。

- 观察：在“直接安装扩展”链路下，detached supervisor 可以跨真实关窗重开存活；但在 `Extension Development Host` 链路下，Run and Debug 会把 extension host 直接拉起的 supervisor 一并带走，最终只能从 registry 恢复到 `历史恢复`。
  证据：用户在安装版手动验证中已确认真实重连可通过，而 Remote SSH + Development Host 重开后节点统一落入 `history-restored`，并显示“会话监督器未保留原 live runtime，已仅恢复历史结果。”。

- 观察：在 launcher 化之后，Remote SSH + F5 的 `Run Dev Session Canvas` 链路已可稳定重新附着；当前剩余缺口不是功能失效，而是这条调试链路还没有自动化回归。
  证据：用户已确认“手动验证通过”，并要求只保留单一的持久化调试 configuration。

## 决策记录

- 决策：第一版实现采用“双路径”执行模型，而不是一次性把默认 snapshot-only 也强制迁到 supervisor。
  理由：这样能把现有默认行为保持稳定，把风险集中到 `runtimePersistence.enabled = true` 的新路径，同时仍满足“开启配置后提供真实 live-runtime”的产品目标。
  日期/作者：2026-04-08 / Codex

- 决策：用户可见的 `重连中` / `历史恢复` 不并入 `AgentNodeStatus` / `TerminalNodeStatus`，而是作为单独的运行时附着态落在执行 metadata 上。
  理由：生命周期描述“进程做了什么”，附着态描述“当前是否连着 live runtime”；两者混在一起会再次把语义打乱。
  日期/作者：2026-04-08 / Codex

- 决策：supervisor 第一版使用独立 Node 进程 + 本地 socket IPC，而不是 shelling out 到 tmux/screen 或依赖 provider 自带恢复。
  理由：这与当前设计文档一致，也更容易统一 `Agent` / `Terminal` 两类会话。
  日期/作者：2026-04-08 / Codex

- 决策：当 `devSessionCanvas.runtimePersistence.enabled` 被关闭时，已持久化的 live-runtime 节点在下一次恢复中不得继续重连，而要直接降为 `历史恢复`，并 best-effort 清理已知 supervisor 会话。
  理由：产品规格明确要求关闭开关后不再承诺真实进程跨 VSCode 生命周期继续存在；如果继续自动重连，会让开关语义失真。
  日期/作者：2026-04-08 / Codex

- 决策：进入 host 边界（测试模拟 reload 或真实 deactivate）前，必须先 flush 已排队的 supervisor 写入/resize/delete 操作。
  理由：否则“用户已经输入但尚未真正写到 socket”的命令会在 reload 时丢失，违背 live-runtime 对工作连续性的承诺。
  日期/作者：2026-04-08 / Codex

- 决策：runtime supervisor 路径模型显式拆成 `storageDir` 与 `runtimeDir`；client 启动 supervisor 时传递 `--storage-dir`、`--socket-path` 与可选的 `--runtime-dir`，不再只传单一 `--root`。
  理由：这样才能把“持久化数据落 storage、IPC endpoint 落 runtime”落实到接口层，避免 supervisor 子进程再自行猜测目录语义。
  日期/作者：2026-04-09 / Codex

- 决策：client 不再直接把真正的 supervisor 作为 extension host 的 direct child 拉起，而是先拉一个短命 launcher，再由 launcher 以 detached 模式拉起真正 supervisor。
  理由：Run and Debug / Extension Development Host 会干预 direct child 生命周期；通过 launcher 让真正 supervisor 在会话启动后尽快脱离调试宿主的直接进程树，既不影响安装版主链路，也更符合 live-runtime 的独立所有权模型。
  日期/作者：2026-04-10 / Codex

## 结果与复盘

当前已交付以下用户可见行为：

- 开启 `devSessionCanvas.runtimePersistence.enabled` 后，`Agent` / `Terminal` 会改走独立 supervisor 持有的 live-runtime 路径。
- manager reload 后，live-runtime 节点会先显示 `重连中`，随后重新附着到真实会话并补回离线期间新增输出。
- 如果 live runtime 不可附着，节点会进入 `历史恢复`，而不是继续伪装成活动态。
- 关闭运行时持久化开关后，下一次 host 边界不会再重连已知 live-runtime，会直接恢复为历史结果，并 best-effort 清理关联 supervisor 会话。

当前已完成的自动化验证：

- `npm run typecheck`
- `npm run build`
- `npm run test:runtime-supervisor-paths`
- `npm run test:smoke`
- `npm run test:webview`

当前已完成的人工验证：

- 直接安装扩展后的 Remote SSH 真实重连链路。
- Remote SSH + `Run Dev Session Canvas` 的 F5 重开链路。

本计划当前没有剩余实现 blocker。唯一保留的后续事项是：Remote SSH + Run and Debug 的真实重连链路仍缺自动化回归，已登记到 `docs/exec-plans/tech-debt-tracker.md`。

## 上下文与定向

这个任务同时触及宿主运行时、共享协议、Webview 状态投影和自动化测试。

关键文件如下：

- `src/panel/CanvasPanelManager.ts`
  目前的宿主核心。负责节点状态、会话启动、输入输出桥接、`workspaceState` 持久化和测试命令。
- `src/panel/executionSessionBridge.ts`
  当前 PTY 抽象。supervisor 仍可复用它来真正启动 `node-pty` 会话。
- `src/common/protocol.ts`
  Host / Webview 共享状态模型。这里需要新增运行时持久化模式与附着态字段。
- `src/common/extensionIdentity.ts`、`package.json`、`package.nls.json`
  配置项、命令和本地化描述入口。这里需要增加 `devSessionCanvas.runtimePersistence.enabled`。
- `src/webview/main.tsx`
  节点状态 pill、覆盖层文案和自动启动逻辑都在这里。它必须学会优先展示 `重连中` / `历史恢复`。
- `tests/vscode-smoke/extension-tests.cjs`
  当前最有价值的自动化验证入口。live-runtime 第一版必须在这里增加真实 reconnect 流程。

这里的“会话监督器”指一个独立于 extension host 生命周期的 Node 进程。它不负责画布 UI，只负责：

- 启动并持有真实 `Agent` / `Terminal` 进程。
- 维护稳定会话 ID 与节点会话映射。
- 持久化最近输出、退出信息和当前状态。
- 接受扩展发来的 attach / input / resize / stop 等请求。

## 工作计划

第一里程碑是把共享数据模型准备好。先在 `src/common/protocol.ts` 和配置入口中加入运行时持久化模式、运行时附着态和监督器会话身份字段，让宿主和 Webview 都能表达“这是 live-runtime 节点，而且当前正在重连”。

第二里程碑是引入 supervisor 进程本身。新增独立入口文件，使用 `node-pty` 启动真实进程，并通过本地 socket 提供简洁的请求/响应协议。第一版只需要支持当前仓库真正会用到的能力：创建会话、附着会话、写入输入、调整尺寸、停止会话、删除会话、查询状态。

第三里程碑是把 `CanvasPanelManager` 改造成双路径 owner。默认配置关闭时继续走当前直接 PTY 路径；配置开启时改为通过 `RuntimeSupervisorClient` 创建和附着会话，并在扩展启动时扫描 state 中的 live-runtime 节点，先标记 `重连中`，再批量尝试附着。

第四里程碑是完成 UI 与测试收口。`Agent` / `Terminal` 节点需要优先按附着态显示文案和按钮逻辑；smoke tests 需要能模拟“manager 断开但 supervisor 不停”的场景，用自动化证明重新附着、离线期间新增输出、失败后历史恢复确实成立。

## 具体步骤

1. 在仓库根目录新增实现计划文件并登记当前决策。
2. 修改 `src/common/protocol.ts`、`src/common/extensionIdentity.ts`、`package.json`、`package.nls.json`，补配置与协议字段。
3. 新增 `src/common/runtimeSupervisorProtocol.ts`，定义 supervisor 的 socket 消息、会话快照和事件类型。
4. 新增 `src/panel/runtimeSupervisorClient.ts` 与 `src/supervisor/` 下的 supervisor 入口/服务端实现。
5. 修改 `scripts/build.mjs`，把 supervisor 入口一起打进 `dist/`。
6. 修改 `src/panel/CanvasPanelManager.ts`，接入：
   - live-runtime 开关判断
   - supervisor session create / attach / input / resize / stop / delete
   - 节点启动后写入持久化会话身份
   - extension 启动后的重连与失败降级
7. 修改 `src/webview/main.tsx`，更新状态 pill 与 overlay 规则。
8. 修改 `tests/vscode-smoke/extension-tests.cjs`，新增 live-runtime 断开重连场景。
9. 运行完整验证并把计划与结果同步更新。

## 验证与验收

在仓库根目录执行以下命令：

1. `npm run typecheck`
2. `npm run build`
3. `npm run test:smoke`
4. `npm run test:webview`

验收时必须至少观察到以下行为：

- 配置关闭时，现有 snapshot-only 流程不回归。
- 配置开启时，新启动的 `Agent` / `Terminal` 节点会记录 live-runtime 会话身份。
- 重新加载 manager 后，live-runtime 节点先显示 `重连中`，随后要么回到真实 live 状态，要么进入 `历史恢复`。
- `Agent` 在断开期间新增的 fake provider 输出，会在重新附着后出现在节点终端中。
- `Terminal` 在 live-runtime 模式下也能重新附着，而不是一律退化成 `interrupted`。

## 幂等性与恢复

- supervisor registry 与恢复元数据必须放在 extension 的 `storageDir` 下，允许重复启动时重用既有持久化状态。
- supervisor 本地 socket 必须放在显式的 `runtimeDir`；默认优先使用 `XDG_RUNTIME_DIR/<extension-id>`，其次是 temp 私有子目录，只有在 storage 路径足够短时才允许与 `storageDir` 复用。
- 若 socket 路径残留但 supervisor 已不在，新的启动路径必须能清理陈旧 socket 并重新拉起服务。
- 如果实现中途发现 supervisor 路线在当前仓库无法稳定跑通，不得静默回退成“继续靠 provider resume”；必须把 blocker 写回本计划和设计文档。

## 证据与备注

当前最关键的实现前证据：

    src/panel/CanvasPanelManager.ts
    - startAgentSession() / startTerminalSession() 直接 spawn node-pty
    - reconcileRuntimeNodes() 在 reload 后只能把旧 live 状态折成 resume-ready / interrupted

    docs/design-docs/runtime-persistence-and-session-supervisor.md
    - 已正式要求 live-runtime 使用独立 session supervisor
    - 已正式要求 UI 在重连前显示“重连中”，失败后显示“历史恢复”

## 接口与依赖

本计划默认继续复用以下现有接口与依赖：

- `node-pty`
  supervisor 仍用它启动真实 PTY 会话，不新增第二套终端 backend。
- `CanvasPanelManager`
  继续作为宿主权威状态 owner，但不再直接拥有 live-runtime 的真实进程。
- `tests/vscode-smoke/fixtures/fake-agent-provider`
  继续作为 `Agent` 自动化验证的真实 CLI 假实现。

预计新增的稳定接口包括：

- `RuntimeSupervisorClient`
  封装扩展与 supervisor 的 socket 连接、请求/响应与事件回调。
- `RuntimeSupervisorSessionSnapshot`
  表达 supervisor 视角的会话状态、最近输出、尺寸、退出信息和是否仍 live。
- 执行 metadata 上的运行时附着态字段
  至少要能表达 `attached-live`、`reattaching`、`history-restored`。

本次修订说明：2026-04-10 17:06 +0800 补记 Remote SSH + F5 手动验证结果，收敛为单一持久化调试配置，并将本计划迁入 `completed/`。
