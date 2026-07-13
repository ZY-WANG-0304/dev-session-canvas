# 让新旧 Runtime Supervisor 并行退役

本 `ExecPlan` 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘`。本文必须按照仓库根目录 `docs/PLANS.md` 的要求持续维护。

## 目标与全局图景

升级扩展时，旧版 Runtime Supervisor 可能仍持有正在工作的 Agent 或 Terminal PTY。当前 `0.24.0` 会把这些会话改成只读，并阻止新会话创建，直到所有旧会话结束。完成本计划后，用户可以继续在旧会话中输入和通过节点 resize 触发 TUI 重绘；与此同时，新建 Agent / Terminal 会立即由当前版本 Supervisor 承载，不再等待旧会话退出。旧 Supervisor 只负责自然排空已有会话，最后一个旧会话结束后自行退出。

用户可以通过真实升级 smoke 观察这一结果：旧 Agent 与 Terminal 仍在旧进程中接收 input / resize；旧会话未结束时，新建 Terminal 已连接另一个声明 `terminalSessionStreamV1` 的当前 Supervisor；删除或停止旧会话不会影响新会话。

## 进度

- [x] (2026-07-13 16:00+08:00) 审计当前固定 Supervisor 路径、Host client map、旧会话 attach、input / resize 拦截和真实升级 smoke。
- [x] (2026-07-13 16:20+08:00) 记录并行 drain 与旧会话降级交互的正式设计、产品验收和架构边界。
- [x] (2026-07-13 17:10+08:00) 实现当前 Supervisor generation 的独立 storage / socket / systemd unit 命名空间。
- [x] (2026-07-13 17:25+08:00) 把旧会话从 `legacy-read-only` 收口为 `legacy-interactive`，允许 output / input / resize 并提供非阻塞兼容提示。
- [x] (2026-07-13 18:10+08:00) 改写真实升级 smoke，证明旧、新 Supervisor 同时存在且各自只处理绑定会话。
- [x] (2026-07-13 18:45+08:00) 补齐路径、Host 输出、Webview 与协议回归，并完成定向与相邻 smoke 验证。
- [x] (2026-07-13 19:20+08:00) 同步当前架构、设计、产品规格与验证证据；既有测试基础设施条目已覆盖本轮无关 locale drift，不重复登记产品技术债。
- [x] (2026-07-13 19:30+08:00) 完成本计划并移入 `docs/exec-plans/completed/`。

## 意外与发现

- 观察：`CanvasPanelManager` 已经用 `backend.kind + backend.paths.storageDir` 管理 `runtimeSupervisorClients`，节点和 session binding 也都包含 `runtimeStoragePath`。
  证据：`buildRuntimeSupervisorClientKey()`、`buildRuntimeSessionBindingKey()` 和 `getRuntimeSupervisorClientForKind(..., runtimeStoragePath)` 已经支持同一 Host 连接多个 storage namespace；缺失的只是“新建会话默认选择新 namespace”的策略。
- 观察：旧 Supervisor 的协议已经支持 `writeInput`、`resizeSession`、`stopSession` 和 `deleteSession`；`0.24.0` 的只读行为是新 Host / Webview 主动拦截，不是旧进程失去能力。
  证据：`tests/vscode-smoke/legacy-supervisor-upgrade-tests.cjs` 当前先直接向旧 Supervisor 创建并输入会话，随后专门断言新 Host 拦截 input / resize。
- 观察：改变 current generation 的 base storage path 会自然生成不同的 legacy-detached socket、Windows named pipe digest和 systemd-user unit digest，不需要改旧进程或 IPC 协议。
  证据：`runtimeSupervisorPaths.ts` 的 socket / unit 都由 `storageDir` 的 SHA-1 digest 派生。
- 观察：真实旧 Supervisor 会在 delete RPC 返回之前先广播 session delete 终态；若 Host 在事件处理阶段立即释放最后一个旧 client，尚未 settled 的 delete 请求会失败。
  证据：升级 smoke 保留并验证 `RuntimeSupervisorClient.hasPendingRequests()` 退役保护，strict delete 的 settled 路径会再次检查旧 client 是否可释放。
- 观察：`npm run test:runtime-supervisor-protocol` 首次运行在 final serialized-state 时序断言处失败，未改代码立即原样复跑后通过；这与本轮路径隔离和 legacy 交互修改无直接关联。
  证据：第二次运行完整通过并输出 10-Agent capacity 结果；本计划不把单次通过改写成稳定性结论。
- 观察：`npm run test:smoke-storage-slot` 在 locale 文案断言处提前失败，未执行完 storage-slot 场景。
  证据：测试期待中文 `/root-local live runtime 缺少 runtimeStoragePath/`，真实 Host 返回英文 `Root-local live runtime is missing runtimeStoragePath, so history results were restored to avoid connecting to the wrong supervisor.`；这属于 `docs/exec-plans/tech-debt-tracker.md` 已登记的一键测试与 locale fixture 漂移，不在本功能内顺手改写。

## 决策记录

- 决策：不迁移旧 PTY 所有权；旧 Supervisor 继续拥有旧会话，当前 Supervisor 只创建新会话。
  理由：旧进程已经持有 PTY master，跨进程移交既无现成协议也没有必要；Host 已具备按 storage path 路由多 client 的基础。
  日期/作者：2026-07-13 / Codex（按用户确认的新策略）
- 决策：为当前协议代使用稳定的 generation base storage 目录，而不是复用旧固定 `runtime-supervisor/`。
  理由：storage path 同时决定 registry、socket、named pipe 和 systemd unit 身份；隔离路径即可让新旧进程安全并存，并让节点现有 `runtimeStoragePath` 字段承担精确路由。
  日期/作者：2026-07-13 / Codex
- 决策：旧会话进入 `legacy-interactive`，允许旧协议 output / input / resize，但不生成或宣称新协议 checkpoint / journal。
  理由：用户已验证 resize 可促使 TUI 重绘；“不能证明完整历史”不应被扩大为“禁止继续使用真实 PTY”。
  日期/作者：2026-07-13 / Codex（按用户反馈）
- 决策：旧值 `legacy-read-only` 在状态归一化时升级为 `legacy-interactive`。
  理由：已经安装过 `0.24.0` 的 workspace 可能持久化旧枚举值；修复版本必须恢复这些节点的交互能力，而不是只对新 attach 生效。
  日期/作者：2026-07-13 / Codex

## 结果与复盘

计划已完成。新建 Agent / Terminal 默认使用 `runtime-supervisor-generations/terminal-stream-v1/runtime-supervisor`，而既有节点继续使用持久化的旧 `runtimeStoragePath`。由于 client、session binding、socket / named pipe 和 systemd unit 身份都包含 storage path，两代 Supervisor 可以并行存在而无需 PTY 转移或新增 RPC broker。

旧会话现在归一化为 `legacy-interactive`。Host 与 Webview 不再拦截 input / resize，旧进程的后续 output 继续投影到 xterm；兼容提示不遮挡终端。初始 raw tail 仍明确是不完整、非权威的兼容投影，实现没有为它伪造 checkpoint、journal、authority 或 applied-revision ACK。已经由 `0.24.0` 持久化为 `legacy-read-only` 的节点也会在读取时升级为新模式。

真实 Linux 升级 smoke 使用 `origin/main@5355e6a` 构建的旧 Supervisor 证明：旧 Agent / Terminal 继续接收 Webview 与 Host 输入并响应 resize；旧会话尚未排空时，新 Terminal 已由不同 PID、storage 与 socket 的当前 Supervisor 启动；新 session 不进入旧 registry；旧进程退出后当前会话仍可用。路径测试另外证明 Windows named pipe 和 systemd unit 身份随 generation 隔离，但真实旧二进制迁移尚未形成 macOS / Windows 自动化矩阵，因此设计验证状态继续保持“验证中”。

本轮没有新增产品技术债。`runtime-supervisor-protocol` 的一次时序失败与 `smoke-storage-slot` 的 locale fixture 失败均被如实保留；后者由现有测试基础设施技术债覆盖，且因为在目标场景完成前失败，不能算作 storage-slot 验证通过。

## 上下文与定向

Runtime Supervisor 是独立于 VS Code Extension Host 的进程，持有 Agent / Terminal 的 PTY。`extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts` 是 Host 编排中心：它从节点 metadata 读取 `runtimeBackend`、`runtimeStoragePath` 和 `runtimeSessionId`，创建 `RuntimeSupervisorClient` 并把 socket 事件路由回节点。`extensions/vscode/dev-session-canvas/src/panel/runtimeHostBackend.ts` 根据 base storage path 选择 `systemd-user` 或 `legacy-detached` backend。`extensions/vscode/dev-session-canvas/src/common/runtimeSupervisorPaths.ts` 从 storage path 派生 registry、socket、Windows named pipe 和 systemd unit。

`terminal-stream-v1` 表示当前 Supervisor 提供 authority / revision / checkpoint / journal 的无损终端投影协议。升级前已经运行且没有该 capability 的 Supervisor 不能补造历史 journal，但仍能继续控制自己持有的 PTY。本文把这种会话称为 `legacy-interactive`：它的初始 raw tail 和后续输出按旧协议投影，可能不构成完整终端历史；input、resize、stop 和 delete 仍然作用于真实旧 PTY。

当前 `0.24.0` 使用单一默认 base storage path。`getPreferredRuntimeSupervisorClient()` 因而会先连接旧固定 socket，发现缺少 capability 后拒绝创建新 session。新方案为当前协议代选择稳定的 generation base storage path；旧节点的 `runtimeStoragePath` 继续指向旧位置，新节点保存 generation path。现有 client map 与 binding key 会自动把两类会话路由到不同进程。

主要文件如下：

- `extensions/vscode/dev-session-canvas/src/common/runtimeSupervisorPaths.ts`：定义 current generation 名称和 base storage 路径。
- `extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts`：默认选择 current generation，保留显式旧 storage 路由，并实现 legacy interactive input / resize / output。
- `extensions/vscode/dev-session-canvas/src/common/protocol.ts`：把投影枚举收口为 `terminal-stream-v1 | legacy-interactive`。
- `extensions/vscode/dev-session-canvas/src/webview/executionSessionNodes.tsx`：旧会话保持 xterm 可交互，并显示不遮挡终端的兼容提示。
- `tests/vscode-smoke/legacy-supervisor-upgrade-tests.cjs`：使用真实旧构建验证两个 Supervisor 并行。

## 工作计划

先在 `runtimeSupervisorPaths.ts` 增加纯函数，把 extension storage root 映射到稳定的 current-generation base path，并补路径单测。`CanvasPanelManager.getRuntimeHostBaseStoragePath()` 只在没有显式 `runtimeStoragePath` 时使用该路径；所有恢复、input、resize、stop、delete 和事件 binding 继续使用节点保存的显式路径。测试 registry 收集同时覆盖 legacy root 和 current generation，保持调试可见性。

然后把共享投影模式改成 `legacy-interactive`。attach 旧 Supervisor 时仍不发送它不认识的 stream/checkpoint/ACK RPC；Host 不信任 raw tail 为 serialized terminal state，但允许 raw tail 和后续 `sessionOutput` 进入 xterm output 队列。Webview 不再拦截 input / resize，也不再用全屏 transcript overlay 覆盖终端，而是在节点内显示非阻塞兼容提示。状态归一化把已持久化的 `legacy-read-only` 映射到新值。

最后重写升级 smoke：在旧固定路径启动真实历史 Supervisor 和两个旧 PTY，当前 Host attach 后通过 Webview 与 Host 路径写入 marker、改变尺寸并从旧进程 snapshot 观察结果；旧会话仍存活时创建当前 Terminal，断言其 `runtimeStoragePath` 不同、current hello 声明新 capability、两个进程 PID 不同、旧 registry 没有新增 session。随后分别清理两代会话并确认旧 client 可自然退役。

## 具体步骤

所有命令都在仓库根目录执行：

    npm run test:runtime-supervisor-paths
    npm run test:execution-output-sequence
    npm run test:protocol-webview-messages
    npm run test:ui-copy-localization
    npm run typecheck
    npm run build
    DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=legacy-supervisor-upgrade npm run test:smoke
    git diff --check

如果完整 smoke wrapper 不支持单场景参数，则运行仓库现有 legacy upgrade smoke 入口，或运行 `npm run test:smoke` 完整集合。每次测试失败都先保留失败阶段和关键诊断，再按同一命令重试；不通过删除用户数据或回退无关改动规避失败。

## 验证与验收

验收必须同时证明以下行为：旧 Agent 和 Terminal attach 后的 metadata 为 `legacy-interactive`；Webview input 消息会到 Host 并最终出现在旧 Supervisor output；resize 后旧 Supervisor snapshot 的 cols/rows 更新；旧会话未停止时，新建 Terminal 成功进入 `terminal-stream-v1`；新旧 Supervisor PID、storage、socket/pipe 不同；新 session 不出现在旧 registry；停止或删除任一代会话不误操作另一代。

路径单测应证明 current generation base path 稳定位于 workspace extension storage 内，并且由它派生的 legacy-detached、Windows named pipe 和 systemd unit 身份与旧固定 path 不同。Webview 回归应证明兼容提示可见但 input 不被拦截。类型检查和 build 必须通过。

## 幂等性与恢复

generation path 是纯确定性函数，重复升级或 Reload Window 不会生成无限新目录。旧节点只按已经持久化的 `runtimeStoragePath` 重连；不存在路径猜测或 registry 搬迁。测试创建的旧、新 Supervisor 都必须在 `finally` 中删除 session 并终止 fixture 进程。若实现中途失败，保留旧固定 storage 不动；删除主题分支新增的 current-generation 测试目录即可重试，不得删除用户真实 runtime storage。

## 证据与备注

关键实现与真实迁移证据：

    runtimeSupervisorClients key = backend.kind + backend.paths.storageDir
    runtimeSessionBindings key = backend + runtimeStoragePath + kind + sessionId
    current generation = terminal-stream-v1
    current storage = runtime-supervisor-generations/terminal-stream-v1/runtime-supervisor
    old Supervisor Agent/Terminal input + resize = passed
    old and current Supervisor PID/storage/socket differ = passed
    current session absent from old registry = passed
    current session remains usable after old Supervisor exit = passed

本轮已通过：

    npm run test:runtime-supervisor-paths
    npm run test:execution-output-sequence
    npm run test:ui-copy-localization
    npm run test:protocol-webview-messages
    npm run test:canvas-execution-context
    npm run test:extension-storage-paths
    npm run test:serialized-terminal-state-tracker
    npm run typecheck
    npm run build
    npm run test:webview -- --grep "keeps an old Supervisor session interactive"  # 2 passed
    DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=legacy-supervisor-upgrade npm run test:smoke
    DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=real-reopen,two-window-shared-runtime,systemd-user-real-reopen,systemd-fallback-real-reopen npm run test:smoke
    npm run test:runtime-supervisor-protocol  # 首次时序断言失败，未改代码复跑通过

未计为通过：

    npm run test:smoke-storage-slot
    expected: /root-local live runtime 缺少 runtimeStoragePath/
    actual: Root-local live runtime is missing runtimeStoragePath, so history results were restored to avoid connecting to the wrong supervisor.

## 接口与依赖

不新增外部依赖。在 `runtimeSupervisorPaths.ts` 中必须导出稳定 generation 常量与 base path helper。在 `protocol.ts` 中 `RuntimeTerminalProjectionMode` 必须表达 `terminal-stream-v1 | legacy-interactive`；状态读取必须继续接受历史字符串 `legacy-read-only` 并归一化。`CanvasPanelManager` 的现有 `RuntimeSupervisorClient` map 和 `runtimeSessionBindings` 继续作为多实例路由，不引入第二套 session registry 或全局 broker。

计划修订记录：2026-07-13 创建计划，记录用户确认的并行 drain 与旧会话降级交互策略，并把现有多 client 基础作为实现起点。2026-07-13 完成实现后补入真实旧二进制、路径、Webview、协议与相邻 smoke 证据，明确协议测试的单次时序波动、storage-slot locale fixture 阻断和跨平台真实迁移矩阵边界，并将计划归档。
