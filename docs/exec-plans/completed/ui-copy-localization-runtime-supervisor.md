# Runtime Supervisor 文案迁移

本 `ExecPlan` 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘` 这几个章节。

本计划遵循 `docs/PLANS.md`。当前文件已归档到 `docs/exec-plans/completed/ui-copy-localization-runtime-supervisor.md`，设计文档与技术债记录已同步。

## 目标与全局图景

这次变更把 Runtime Supervisor 相关的产品自有文案纳入 UI 文案本地化边界。Runtime Supervisor 是独立的 Node 子进程，负责在 VS Code Extension Host 之外持有 Agent / Terminal 运行时，并通过 socket 把 session 状态发回 Host。完成后，supervisor 子进程、launcher、runtime host backend 和 runtime supervisor client 不再输出中文默认错误；会话退出摘要由稳定 descriptor 表示，Host 在展示给 Webview 或通知前用 `vscode.l10n.t(...)` 转成英文或简体中文。

用户可观察到的行为是：英文环境中 Runtime Supervisor 的停止、删除、退出、恢复历史结果、缺参数和连接错误显示英文；简体中文环境中由 Host 展示的会话结束摘要和受控错误显示中文；协议层仍保留必要的原始事实，例如 session id、exit code、signal、shell path 和终端最后一行输出。

## 进度

- [x] (2026-07-03 00:00Z) 已读取 `docs/WORKFLOW.md` 与 `docs/PLANS.md`，确认本批次是多文件、多边界迁移，需要 ExecPlan。
- [x] (2026-07-03 00:05Z) 已扫描 runtime supervisor 相关硬编码中文，范围包括 `runtimeSupervisorMain.ts`、`runtimeSupervisorLauncher.ts`、`runtimeSupervisorPaths.ts`、`runtimeSupervisorClient.ts` 和 `runtimeHostBackend.ts`。
- [x] (2026-07-03 00:15Z) 已梳理协议字段与 Host 展示边界，确认 `lastExitMessage` 是用户可见字段，受控错误和退出摘要需要结构化 descriptor。
- [x] (2026-07-03 00:35Z) 已实现 Runtime Supervisor message descriptor、英文 fallback formatter、Host 本地化 helper，并接入 `CanvasPanelManager.ts`。
- [x] (2026-07-03 00:55Z) 已更新测试、中文 bundle、设计文档和技术债记录，并运行目标验证命令。
- [x] (2026-07-03 01:05Z) 已移动 ExecPlan 到 completed；提交将在最终验证后完成。

## 意外与发现

- 观察：`runtimeSupervisorMain.ts` 的 `lastExitMessage` 会进入 `RuntimeSupervisorSessionSnapshot`，随后被 `CanvasPanelManager.ts` 写入节点 `summary`、`metadata.lastExitMessage`、`host/error` 和 Webview overlay，因此它不是单纯诊断文本。
  证据：`CanvasPanelManager.ts` 的 `handleRuntimeSupervisorState()`、`applyCompletedRuntimeSupervisorSnapshot()` 和 `markExecutionNodeAsHistoryRestored()` 会直接使用 `snapshot.lastExitMessage`。
- 观察：Runtime Supervisor 子进程不能直接依赖 VS Code API，因此不能在 `runtimeSupervisorMain.ts` 中调用 `vscode.l10n.t(...)`。
  证据：该文件位于 `src/supervisor/`，通过 `runtimeHostBackend.ts` 以 `process.execPath` 启动 dist 脚本，运行在独立进程中。

## 决策记录

- 决策：Runtime Supervisor 子进程只生成稳定 descriptor 和英文 fallback，不直接做 locale 判断。
  理由：子进程不在 Extension Host 环境内，无法使用 VS Code 官方 `vscode.l10n.t(...)`；在协议中传自然语言句子会让 Webview 继续依赖子进程默认语言。稳定 descriptor 可以保持协议可测试，同时让 Host 负责用户可见本地化。
  日期/作者：2026-07-03 / Codex。
- 决策：本批次不迁移 `protocol.ts` 主协议模型字段，只在 `runtimeSupervisorProtocol.ts` 给 Runtime Supervisor snapshot 增加可选 descriptor 字段，并保持 `lastExitMessage` 作为兼容英文 fallback。
  理由：`protocol.ts` 是 Host 到 Webview 的稳定模型，已有大量历史状态只保存 `lastExitMessage`。本批次先在 supervisor 边界完成结构化来源，Host 继续把本地化后的字符串写回现有字段，避免一次性迁移持久化模型。
  日期/作者：2026-07-03 / Codex。

## 结果与复盘

本批次已完成 Runtime Supervisor 文案迁移。`runtimeSupervisorProtocol.ts` 现在提供稳定 message descriptor、typed error code 和英文 fallback formatter；`runtimeSupervisorMain.ts` 生成 `lastExitMessageDescriptor` 并保留英文 `lastExitMessage` 兼容旧消费方；`runtimeSupervisorLocalization.ts` 是唯一调用 `vscode.l10n.t(...)` 的 Host 翻译边界；`CanvasPanelManager.ts` 在展示 snapshot exit message、恢复历史结果和受控 runtime 错误前先做本地化。

剩余缺口是不在本批次内的模板解析/存储错误、`main.tsx` test DOM helper 错误和旧中文 label 兼容映射，以及真实 VS Code 英文/中文 locale 手动验证。

## 上下文与定向

`extensions/vscode/dev-session-canvas/src/supervisor/runtimeSupervisorMain.ts` 是 Runtime Supervisor 服务端。它监听 socket 请求，创建或附着 Agent / Terminal session，写入 registry，并在 session 状态变化时发出 `RuntimeSupervisorSessionSnapshot`。

`extensions/vscode/dev-session-canvas/src/common/runtimeSupervisorProtocol.ts` 定义 Host 与 Runtime Supervisor 之间的消息、snapshot 和错误 payload。这里可以放稳定 descriptor 类型，因为 supervisor 和 Host 都会 import 它；但不能 import `vscode`。

`extensions/vscode/dev-session-canvas/src/panel/runtimeSupervisorClient.ts` 是 Extension Host 里的 socket client。它把 supervisor 的错误 payload 还原成 Error，并把 session snapshot 回调给 `CanvasPanelManager.ts`。

`extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts` 是用户可见 UI 边界。它可以使用 `vscode.l10n.t(...)`，并负责把 Runtime Supervisor snapshot 转成节点 summary、metadata、Webview 消息和 Host error。

`extensions/vscode/dev-session-canvas/src/common/runtimeSupervisorPaths.ts` 和 `extensions/vscode/dev-session-canvas/src/panel/runtimeHostBackend.ts` 是启动 supervisor 前的路径和 backend 选择逻辑。这里的错误主要是诊断/连接失败原因，应至少改为英文默认；如果它们最终展示给用户，Host 已经会把外层文案本地化，原始原因保留为事实细节。

## 工作计划

先在 `runtimeSupervisorProtocol.ts` 增加 `RuntimeSupervisorMessageDescriptor` 类型、英文 formatter、typed error helper 和 descriptor serialization 支持。Descriptor 覆盖 session 已存在、session 未找到、session 非 live、Claude Ctrl-Z 不支持、Claude suspended、session 删除、agent/terminal 停止或结束、agent/terminal signal/code 退出、resume signal/code 失败、历史结果恢复和缺 CLI 参数。

再改 `runtimeSupervisorMain.ts`，让受控错误抛出 typed Runtime Supervisor error；让 `lastExitMessage` 继续填英文 fallback，同时新增 `lastExitMessageDescriptor`。恢复旧 registry 时，如果没有 descriptor，只保留旧字符串；如果连旧字符串也没有，则使用 recovery descriptor 和英文 fallback。

随后改 `CanvasPanelManager.ts`，在处理 snapshot 时优先把 `lastExitMessageDescriptor` 本地化成展示字符串，再写入 summary、metadata、postExecutionExit 和 host/error。`isMissingRuntimeSupervisorSessionError()` 改为优先判断 error code，避免依赖中文 message。

最后把 `runtimeSupervisorClient.ts`、`runtimeHostBackend.ts`、`runtimeSupervisorLauncher.ts`、`runtimeSupervisorPaths.ts` 中的中文默认错误改为英文，更新 l10n bundle、UI 文案扫描测试、设计文档和技术债记录。

## 具体步骤

在仓库根目录执行以下命令完成探索和验证：

    rg -n "[\p{Han}]|zh-CN" extensions/vscode/dev-session-canvas/src/supervisor/runtimeSupervisorMain.ts extensions/vscode/dev-session-canvas/src/supervisor/runtimeSupervisorLauncher.ts extensions/vscode/dev-session-canvas/src/common/runtimeSupervisorPaths.ts extensions/vscode/dev-session-canvas/src/common/runtimeSupervisorProtocol.ts extensions/vscode/dev-session-canvas/src/panel/runtimeSupervisorClient.ts extensions/vscode/dev-session-canvas/src/panel/runtimeHostBackend.ts extensions/vscode/dev-session-canvas/src/panel/runtimeSupervisorLocalization.ts
    npm run test:runtime-supervisor-paths
    npm run test:runtime-supervisor-protocol
    npm run test:ui-copy-localization
    npm run test:protocol-webview-messages
    npm run test:execution-session-bridge
    npm run test:canvas-execution-context
    npm run test:execution-output-sequence
    npm run typecheck
    git diff --check

## 验证与验收

验收标准是：目标 runtime supervisor 源文件不再有未豁免中文；Host runtime bundle 包含新增 `vscode.l10n.t(...)` 源字符串的简体中文翻译；Runtime Supervisor protocol 测试证明 error code/descriptor 能序列化和还原；路径解析测试证明英文默认错误没有破坏路径行为；TypeScript 类型检查通过。

人工验证说明写入最终汇报：本批次未启动真实 VS Code 双 locale 手动验证，但自动验证覆盖了 descriptor serialization、本地化 key 完整性、runtime supervisor 源文件扫描、protocol/webview 消息契约和 execution session 相关静态回归。

## 幂等性与恢复

本计划只编辑源码、测试和文档，不执行数据库迁移或破坏性 git 操作。测试命令可重复运行。若中途失败，先查看 `git diff` 保留当前补丁，再按失败测试定位；不要使用 `git reset --hard` 或 checkout 恢复用户改动。

## 证据与备注

初始扫描发现 runtime supervisor 相关中文如下：

    runtimeSupervisorMain.ts: session 已存在、未找到、Ctrl-Z 不支持、Claude suspended、删除、停止、结束、exit summary、缺 --storage-dir
    runtimeSupervisorLauncher.ts: 缺 --supervisor-script / --storage-dir
    runtimeSupervisorPaths.ts: Unix socket 路径、Windows systemd-user、用户目录解析错误
    runtimeSupervisorClient.ts / runtimeHostBackend.ts: client disposed/disconnected、连接关闭、等待超时、systemd command 失败

## 接口与依赖

在 `extensions/vscode/dev-session-canvas/src/common/runtimeSupervisorProtocol.ts` 中新增并导出：

    export type RuntimeSupervisorMessageId = ...;
    export interface RuntimeSupervisorMessageDescriptor { id: RuntimeSupervisorMessageId; params?: Record<string, string>; }
    export function formatRuntimeSupervisorMessageDescriptor(descriptor: RuntimeSupervisorMessageDescriptor): string;
    export class RuntimeSupervisorProtocolError extends Error { ... }
    export function createRuntimeSupervisorProtocolError(descriptor, code?): RuntimeSupervisorProtocolError;
    export function getRuntimeSupervisorErrorDescriptor(error: unknown): RuntimeSupervisorMessageDescriptor | undefined;

扩展现有接口：

    RuntimeSupervisorSessionSnapshot.lastExitMessageDescriptor?: RuntimeSupervisorMessageDescriptor;
    RuntimeSupervisorErrorPayload.descriptor?: RuntimeSupervisorMessageDescriptor;

在 `extensions/vscode/dev-session-canvas/src/panel/runtimeSupervisorLocalization.ts` 中新增 Host helper：

    export function localizeRuntimeSupervisorMessageDescriptor(descriptor, fallback?): string;
    export function localizeRuntimeSupervisorSnapshotExitMessage(snapshot, fallback?): string;
    export function localizeRuntimeSupervisorError(error, fallback?): string | undefined;

这些 helper 是唯一可调用 `vscode.l10n.t(...)` 的 Runtime Supervisor 文案翻译边界。

验证证据：

    rg -n "[\p{Han}]|zh-CN" extensions/vscode/dev-session-canvas/src/supervisor/runtimeSupervisorMain.ts extensions/vscode/dev-session-canvas/src/supervisor/runtimeSupervisorLauncher.ts extensions/vscode/dev-session-canvas/src/common/runtimeSupervisorPaths.ts extensions/vscode/dev-session-canvas/src/common/runtimeSupervisorProtocol.ts extensions/vscode/dev-session-canvas/src/panel/runtimeSupervisorClient.ts extensions/vscode/dev-session-canvas/src/panel/runtimeHostBackend.ts extensions/vscode/dev-session-canvas/src/panel/runtimeSupervisorLocalization.ts
    # 无输出
    npm run test:runtime-supervisor-paths
    # runtimeSupervisorPaths tests passed
    npm run test:runtime-supervisor-protocol
    # runtimeSupervisorProtocol tests passed
    npm run test:ui-copy-localization
    # ui copy localization tests passed
    npm run test:protocol-webview-messages
    # protocol webview message tests passed
    npm run test:execution-session-bridge
    # executionSessionBridge tests passed
    npm run test:canvas-execution-context
    # canvas execution context tests passed
    npm run test:execution-output-sequence
    # execution output sequence tests passed
    npm run typecheck
    # tsc -p ./tsconfig.json --noEmit
    git diff --check
    # 无输出

变更记录：2026-07-03 创建计划，记录 Runtime Supervisor 文案迁移的范围、边界和验证方式。
变更记录：2026-07-03 完成实现与验证，补充结果复盘和验证证据，准备归档。

变更记录：2026-07-03 归档计划到 completed，标记所有计划步骤完成。
