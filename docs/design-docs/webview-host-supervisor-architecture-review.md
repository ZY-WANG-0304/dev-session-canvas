---
title: Webview、Host 与 Runtime Supervisor 架构审核
decision_status: 待探索
validation_status: 验证中
domains:
  - VSCode 集成域
  - 画布交互域
  - 执行编排域
  - 项目状态域
architecture_layers:
  - 宿主集成层
  - 画布呈现层
  - 共享模型与编排层
  - 适配与基础设施层
related_specs:
  - docs/product-specs/canvas-core-collaboration-mvp.md
  - docs/product-specs/runtime-persistence-modes.md
  - docs/product-specs/canvas-multi-root-workspace-support.md
related_plans:
  - docs/exec-plans/completed/webview-host-supervisor-architecture-review.md
updated_at: 2026-09-16
---

# Webview、Host 与 Runtime Supervisor 架构审核

## 1. 审核范围与基线

本次审核从 `origin/main@4d7f07e55461f414c570365136cc06ece6f18c64` 创建分支 `architecture-review-webview-host-supervisor`，检查 `extensions/vscode/dev-session-canvas/src/webview/`、`src/panel/`、`src/supervisor/` 以及共享协议层的当前实现。审核关注三条边界：Webview 只负责呈现和用户意图，Host 持有 workspace 画布状态并编排执行会话，Runtime Supervisor 在 `live-runtime` 模式下持有进程、terminal revision 和 journal 权威。

这不是某个待合并 MR 的差异审查，因此下列问题描述的是当前主线基线。严重度表示对当前架构和用户主路径的影响，不等同于仓库 Code Review 流程中的“必须拒绝合并”标签。

## 2. Findings

### F-01 高：Supervisor hello 没有响应超时，5 秒 ready 上限无法覆盖已连接但无响应的 socket

位置：`extensions/vscode/dev-session-canvas/src/panel/runtimeSupervisorClient.ts:223-224`、`:227-242`、`:382-407`。

`requestOnConnectedSocket()` 将请求放入 `pendingRequests` 后直接 `socket.write()`，只有收到 response 或 socket `close` 时才 settle。`connectWithRestart()` 在连接成功后立即等待 `performHelloHandshake()`；`waitForSupervisorReady()` 虽然计算了 5 秒 deadline，但循环体里的 `await this.performHelloHandshake()` 会在 socket 已连接且对端不回复时永久 pending，因此永远到不了 deadline。一个能接受连接但不返回 `hello` 的旧、卡死或错误占用 socket 的进程，就足以让 Host 的 `ensureConnected()` 永不返回，后续 live-runtime 创建、恢复、输入或 resize 调用也会一直等待。

这是从当前调用路径直接成立的可重复行为，不依赖网络抖动。现有 `test-runtime-supervisor-protocol.mjs` 只验证 hello 被延迟后，两个并发 `ensureConnected()` 会共同等待并在响应后成功；没有验证“连接建立但 hello 永不响应”的失败边界。

建议：为内部 request（至少 `hello`，最好所有 RPC）设置有界 deadline；超时应移除 pending entry、销毁当前 socket、触发一次断连处理，并让 `waitForSupervisorReady()` 能继续重试或返回 `clientReadyTimeout`。新增一个本地 socket fixture，接受连接后不回 hello，断言 `ensureConnected()` 在有限时间内 reject 且后续调用不会复用坏连接。

### F-02 中：`common` 共享层违反纯模型边界，存在对 VS Code 和 Host 适配层的直接依赖

位置：`extensions/vscode/dev-session-canvas/src/common/runtimeSupervisorProtocol.ts:13`、`src/common/webviewResourceUri.ts:1-3`、`src/common/testHarness.ts:1`；不变量见 `ARCHITECTURE.md:126-159`。

`runtimeSupervisorProtocol.ts` 从 `../panel/executionSessionBridge` 类型导入 `ExecutionSessionLaunchSpec`，使共享协议层反向依赖 Host 适配目录。`webviewResourceUri.ts` 与 `testHarness.ts` 又直接导入 `vscode`，虽然当前只被宿主或 sidebar 使用，但它们位于被文档定义为跨 Host/Webview/Supervisor 的 `common` 目录。该结构目前不会被 TypeScript 类型检查阻断，也没有观察到 Webview 或 Supervisor 直接加载这两个 helper；问题是依赖方向和目录契约已经不再可信，未来把 `common` 文件用于 Webview 或 Supervisor 时会把 VS Code 运行时、Host 适配甚至潜在循环依赖带入边界。

建议：把 `ExecutionSessionLaunchSpec` 的纯可序列化部分移动到 `common`，由 `executionSessionBridge.ts` 只保留 `ExecutionSessionProcess` 和 node-pty 适配；将 `webviewResourceUri.ts`、`testHarness.ts` 移到明确的 Host/sidebar 基础设施目录，或拆成不依赖 `vscode` 的纯 helper 与 Host adapter。补一条静态依赖守卫，扫描 `src/common` 禁止 `vscode`、`react`、`node-pty` 和 `../panel` 导入。

### F-03 中：画板归属与运行时归属不一致（需要修订设计决策）

#### 已核实的实现与影响

相关代码集中在 `extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts`。当前 root-local 画板保存在按 root 身份区分的用户存储中，但新建执行会话的 Supervisor 由创建窗口的 workspace storage 决定。以下位置均针对本报告的代码基线：

| 代码位置 | 已核实事实 |
| --- | --- |
| `CanvasPanelManager.ts:5818`，`getRootLocalCanvasStorageDirectory()` / `getRootLocalCanvasStoragePath()` | 画板内容使用 `globalStorageUri` 下按 root 生成的存储 key。 |
| `CanvasPanelManager.ts:14030`，`startAgentSessionWithSupervisor()` | 调用 `getPreferredRuntimeSupervisorClient()` 时没有传入节点所属 root。 |
| `CanvasPanelManager.ts:14205`，`startTerminalSessionWithSupervisor()` | 与 Agent 一样，创建会话时使用无 root 参数的 preferred client。 |
| `CanvasPanelManager.ts:9880`，`getPreferredRuntimeSupervisorClient()` | 从当前窗口默认 storage 选择 backend/client；解析节点 cwd 不会改变该归属。 |
| `CanvasPanelManager.ts:9615`，`getRuntimeHostBaseStoragePath()` | 无显式路径时，从 `getExtensionStoragePath()` 派生当前 Supervisor generation 的 runtime storage；后者取构造函数 `:1297` 保存的 `context.storageUri`，缺省才回退到 `globalStorageUri`。 |
| `CanvasPanelManager.ts:9933`，`buildRuntimeSessionBindingKey()`；`:16344`，已有会话 attach 路径 | 恢复按 metadata 中的 `runtimeBackend + runtimeStoragePath + runtimeSessionId + executionKind` 继续连接原绑定。 |

因此，在同一多根 workspace 窗口中、backend 和 generation 相同时，不同 root 新建的会话通常共用 Supervisor；同一 root 在不同 workspace storage slot 的窗口中创建的会话，则可能分散到多个 Supervisor。已有会话按完整 metadata 恢复能保留这种绑定，但不能证明新建会话已经按 root 稳定归属。

这让 root 画板与 runtime 的管理边界不一致：排查一个 root 的会话需要追踪多个窗口留下的 storage、control endpoint 与进程；清理、升级和退役还要检查其中是否有其他 root 的会话。不同 root 共用 Supervisor 时，该 Supervisor 进程故障会同时影响这些 root 所托管的会话；这是共享进程的故障影响范围，不表示对单个 session 的正常 stop/delete 会停止其他 root，也不代表本轮已复现跨 root 故障。

#### 审核性质与用户确认方向

`docs/design-docs/canvas-multi-root-workspace-support.md` 第 6.8 节和 `docs/product-specs/canvas-multi-root-workspace-support.md` 功能范围第 16、17 项、对应 slot 验收条目，当前明确保留具体 workspace storage slot。F-03 是用户要求调整的架构设计决策，不能列为已证明违反当前规格的实现 bug。

用户已确认的目标是：多根 workspace 是各 root 画板的组合视图；同一 root 单独打开或作为多根 workspace 的子画板打开时，都访问该 root 自己的 runtime，新建会话归属 root 的稳定 Supervisor，不依赖创建窗口。后续归属应按以下维度共同定义：

| 维度 | 后续设计要求 |
| --- | --- |
| 运行环境 | 区分本地与不同远程执行环境，不能仅凭相同路径字符串合并 runtime。 |
| 用户存储范围 | 在同一用户/扩展存储范围内共享，避免不同用户或隔离存储范围误连。 |
| root 身份 | 以节点所属 root 为准，单根与多根解析结果必须一致；root 显示名、窗口 slot 和可单独配置的执行 cwd 不能替代归属。 |
| Supervisor generation | 新会话进入当前代次，升级期间旧代和新代可以并存。 |

上述维度定义逻辑归属；`runtimeBackend` 与具体 storage/control endpoint 仍需保留在真实会话绑定中。root 身份的路径规范化、symlink/大小写/远程 authority 规则、具体存储布局、同 root 并发发现与启动、backend fallback，以及无 root 窗口的处理均需后续设计，当前尚未选定实现。单根和多根的 Agent / Terminal 创建路径必须一起调整；仅修改多根入口会继续产生同 root 分散归属。

#### 旧会话过渡边界

旧 live session 继续按原 `runtimeBackend + runtimeStoragePath + runtimeSessionId + executionKind` 连接原 Supervisor，保留其进程与 terminal authority。新会话使用新 root 归属。仅改写 metadata 存储地址、复制目录或 checkpoint 都不能证明 PTY 所有权已经迁移；本轮不提出 live PTY 转移方案。

同一 root 在过渡期可以同时有旧 slot 绑定与新的 root 绑定。旧 Supervisor 应随它持有的旧会话结束而退役，必须覆盖其他 root、其他窗口的存活会话及未完成 RPC/订阅；不能因为某个 root 或当前窗口已切换到新归属就整体终止旧 Supervisor。缺失旧 runtime 地址时沿用兼容迁移或显式历史恢复边界，不能猜测新 root 地址并声称已完成迁移。

## 3. 其余审查范围

F-01 是连接可靠性缺陷，F-02 是共享层依赖漂移，F-03 是需要修订的 runtime 归属设计。其余已检查路径中，本轮没有证明新的 Webview 生命周期、terminal journal 顺序、authority/revision 或 Supervisor 删除竞态缺陷。已有 lifecycle、协议、journal、输出调度测试均通过；这不等价于真实 VS Code、多平台、Remote SSH 或高负载终态无损行为已经全部验证。

## 4. 验证记录

首次审核在新分支上运行并通过：

    npm run typecheck
    npm run test:protocol-webview-messages
    npm run test:runtime-supervisor-protocol
    npm run test:terminal-session-journal
    npm run test:execution-output-scheduler
    npm run test:webview-lifecycle-diagnostics
    git diff --check

`test:runtime-supervisor-protocol` 的 10-agent capacity 样本为 `agentCount=10`、`allOutputCompleteMs=300.16`、`inputEchoMs=30.35`，只能说明现有基准场景通过，不能覆盖无响应 hello。真实 VS Code Webview、Windows、Remote SSH 和长时间 socket 背压未在本轮运行。

F-03 补充审核只复核代码调用、现行第 6.8 节和产品规格，并检查文档链接及 `git diff --check`；没有修改运行时代码，没有重跑首次审核的运行时测试。第 6 节全部是后续改造的建议验收场景，尚未执行，不能作为 root 稳定 runtime 已实现的证据。

## 5. 后续决策与边界

本审核不直接改动运行时代码。F-01 应作为 live-runtime 连接可靠性修复单独设计和实现；F-02 应作为共享层依赖收口任务处理。两项都需要在实现时补充针对性验证，完成前不要把“Supervisor 已能启动”表述成“Supervisor 连接在所有异常情况下都有界”。

F-03 的产品方向已由用户确认；具体设计与运行时改造另开 ExecPlan，覆盖单根和多根新建、稳定 root identity、Supervisor 发现与并发启动、backend 选择、旧 session 原绑定恢复及退役。现有设计第 6.8 节与产品规格已标出待修订边界；改造时再将新建归属正式收口为 root 语义，并保留旧 slot 恢复契约，不能把整份设计直接标成 root 稳定 runtime 已实现或已验证。

## 6. F-03 建议验收场景（待实现、待执行）

以下场景覆盖 Agent 与 Terminal，并记录创建窗口、root identity、backend、runtime storage/control endpoint、generation、Supervisor PID、session id 和 terminal authority。稳定性主要比较逻辑归属和 endpoint；进程重启后的 PID 不必保持不变。不同节点的新会话应有各自的 session id，共享 Supervisor 不等于复用同一 session。

| 场景 | 建议验收结果 |
| --- | --- |
| 同一环境与用户存储范围中，先在单根 A 新建，再在 A+B 多根窗口的 A 新建；反向顺序也执行 | 两条创建路径使用 A 的同一当前代 runtime；不能只 attach 先前节点代替第二次新建。 |
| 在 A+B、A+C 和 A 单根窗口使用不同 workspace storage slot，分别给 A 新建会话 | A 的 runtime 归属保持一致；多根文件名、root 顺序和画板呈现模式不决定归属。 |
| 在同一 A+B 窗口分别给 A、B 新建会话 | 同 generation 下使用不同 root 的 Supervisor；root A 的 scoped 清空/重置或 Supervisor 故障不终止 B 的新会话，故障注入后验证 B 的原 session 仍可输入输出。 |
| 同 root 多窗口并发首次创建，随后关闭创建窗口并从另一窗口继续访问 | 不启动争抢同一 endpoint 的重复 Supervisor；新会话互不覆盖，剩余窗口能按同一 root runtime 继续输入输出。保留 shared session 多播及 resize last-writer-wins 的既有验收。 |
| 不同运行环境或用户存储范围存在相同路径/同名 root；节点 cwd 显式改为另一个目录 | 不同环境/存储范围不能串 runtime；cwd 不改变节点所属 root。身份规范化规则选定后补 symlink、大小写和 root 重命名案例。 |
| 升级前为 A、B 建立共用旧 slot Supervisor 的会话，升级后分别新建 | 旧会话继续连原地址和原 authority，新会话进入各 root 新归属；结束 A 的旧会话后 B 的旧会话仍可用，最后旧会话及相关引用/RPC 收敛后旧 Supervisor 才退役。 |
| root 归属相同但 Supervisor generation 改变 | 新旧代 endpoint 可区分，旧 live session 不被重写地址或重启，新会话使用当前代；已有 generation drain 回归继续成立。 |
| 重载/重开同时存在旧 slot 会话与新 root 会话的画板，另加入缺少 runtimeStoragePath 的旧 snapshot | 完整旧绑定与新绑定都恢复各自会话，离线输出可见；缺字段记录通过明确兼容迁移或历史恢复处理，不猜测当前 root runtime。 |
