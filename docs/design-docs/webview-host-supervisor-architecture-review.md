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
related_plans:
  - docs/exec-plans/active/webview-host-supervisor-architecture-review.md
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

## 3. 其余审查范围

除 F-01 和 F-02 外，本轮没有从当前代码路径证明新的 Webview 生命周期、terminal journal 顺序、authority/revision 或 Supervisor 删除竞态缺陷。已有 lifecycle、协议、journal、输出调度测试均通过；这不等价于真实 VS Code、多平台、Remote SSH 或高负载终态无损行为已经全部验证。

## 4. 验证记录

在新分支上运行并通过：

    npm run typecheck
    npm run test:protocol-webview-messages
    npm run test:runtime-supervisor-protocol
    npm run test:terminal-session-journal
    npm run test:execution-output-scheduler
    npm run test:webview-lifecycle-diagnostics
    git diff --check

`test:runtime-supervisor-protocol` 的 10-agent capacity 样本为 `agentCount=10`、`allOutputCompleteMs=300.16`、`inputEchoMs=30.35`，只能说明现有基准场景通过，不能覆盖无响应 hello。真实 VS Code Webview、Windows、Remote SSH 和长时间 socket 背压未在本轮运行。

## 5. 后续决策与边界

本审核不直接改动运行时代码。F-01 应作为 live-runtime 连接可靠性修复单独设计和实现；F-02 应作为共享层依赖收口任务处理。两项都需要在实现时补充针对性验证，完成前不要把“Supervisor 已能启动”表述成“Supervisor 连接在所有异常情况下都有界”。
