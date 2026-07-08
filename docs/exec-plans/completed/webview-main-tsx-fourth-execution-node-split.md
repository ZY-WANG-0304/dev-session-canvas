# Webview main.tsx 第四阶段执行节点拆分

本 `ExecPlan` 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘` 这几个章节。

本计划遵循 `docs/PLANS.md`。当前任务是在前三阶段行为保持拆分后，按用户选择继续拆 `AgentSessionNode` 和 `TerminalSessionNode`。行为保持的含义是：不新增用户功能，不修改 Host/Webview 消息协议，不修改持久化状态结构，不修改 UI 文案，不改变执行节点启动、恢复、输入、快照、link/paste/drop、attention、标题编辑或删除行为。

## 目标与全局图景

`extensions/vscode/dev-session-canvas/src/webview/main.tsx` 当前约 14.1k 行，仍包含执行节点 React 组件、节点内 xterm mount/resize/restore 逻辑、执行终端 controller、paneGallery、Note、File 和 App 主状态机。第四阶段目标是把 `AgentSessionNode` 与 `TerminalSessionNode` 从入口文件移动到独立 Webview 模块，让入口继续作为组合层持有全局 registry、状态和消息函数。用户不应看到任何 UI 或运行行为差异；协作者应能在更小文件里 review 执行节点组件。

本轮不拆 `createExecutionTerminalController` 的 output drain / snapshot queue，不拆 Host 消息处理，也不重构执行协议。可观察结果是：`main.tsx` 行数继续下降；新增模块位于 `extensions/vscode/dev-session-canvas/src/webview/`；`npm run typecheck`、`npm run build`、Webview xterm entry 和 protocol 定向测试继续通过。

## 进度

- [x] (2026-07-08 12:39+08:00) 确认当前分支 `webview-main-tsx-refactor` 已有三次重构提交，工作区干净，`main.tsx` 为 14,143 行，并按工作流入口确认本轮仍属技术债拆分。
- [x] (2026-07-08 12:40+08:00) 建立本 ExecPlan，明确第四阶段只拆 Agent/Terminal 执行节点组件，不改变执行终端 controller 和协议。
- [x] (2026-07-08 13:14+08:00) 已新增 `executionTerminalTypes.ts`，移出执行 Host event、controller、content change reason 与 xterm 私有 mouse/selection 类型；`main.tsx` 改为 type import，`npm run typecheck` 通过。
- [x] (2026-07-08 13:29+08:00) 已新增 `executionSessionNodes.tsx`，把 `AgentSessionNode` / `TerminalSessionNode` 及节点内 xterm mount、resize、restore、link/drop/paste/native interaction glue 移出入口；`main.tsx` 仅通过 `createExecutionSessionNodeTypes(...)` 注入 controller、registry、runtime context、file link resolver、input reporter 和共享节点 chrome 组件。
- [x] (2026-07-08 13:29+08:00) 已同步 `ARCHITECTURE.md` 的 Webview code map，并更新 `docs/exec-plans/tech-debt-tracker.md` 记录第四阶段已收口内容、12,958 行现状和剩余缺口。
- [x] (2026-07-08 13:32+08:00) 最终验证通过：`npm run typecheck`、`npm run build`、`npm run test:webview-build-xterm-entry`、`npm run test:protocol-webview-messages`、`git diff --check`。

## 意外与发现

- 观察：`executionTerminalTypes.ts` 初次生成时漏掉 `XtermCoreWithMouseInternals` 的闭合大括号，TypeScript 在拆类型里程碑立即报 `TS1005`，补齐后通过。
  证据：`npm run typecheck` 最终通过，说明类型边界没有引入循环依赖或语法错误。

- 观察：`ActionButton`、`NodeResizeAffordance`、`NodeHandles`、`NodeOverviewTitle`、`ExecutionHelpTrigger` 和 `CompactCanvasCardNodeContent` 仍同时被 File/Note/compact/paneGallery 相关路径使用，本轮如果把它们整体移出入口会扩大重构面。
  证据：`executionSessionNodes.tsx` 通过依赖注入接收这些共享组件，`main.tsx` 仍保留共享 chrome helper；`npm run typecheck` 与 `npm run build` 已通过。


## 决策记录

- 决策：第四阶段拆 `AgentSessionNode` 和 `TerminalSessionNode`，但保留 `createExecutionTerminalController` 在 `main.tsx`。
  理由：执行节点组件和节点内 xterm mount 逻辑已经形成清楚 UI 边界；controller 仍深度连接 output drain、snapshot write queue、diagnostics、Host 消息路由和 test DOM bridge，单独拆需要更大验证面。先拆组件能降低入口体积，又不扩大行为风险。
  日期/作者：2026-07-08 / Codex。

- 决策：新执行节点模块通过依赖注入接收 `t`、controller factory、registry、runtime context、file link resolver、input diagnostic reporter 和少量共享节点 chrome 组件。
  理由：执行节点仍需要入口的全局 registry 与消息边界；直接 import `main.tsx` 会形成循环依赖，直接读取全局 runtime context 会模糊边界。依赖注入让模块保持 Webview UI 层职责，同时保留 `main.tsx` 的组合根角色。
  日期/作者：2026-07-08 / Codex。

## 结果与复盘

阶段性结果：已新增 `executionTerminalTypes.ts` 与 `executionSessionNodes.tsx`。`main.tsx` 从本轮开始时的 14,143 行降到 12,958 行，执行节点组件和节点内 xterm mount/resize/restore glue 离开入口；入口继续作为组合层持有 `executionTerminalRegistry`、`createExecutionTerminalController`、runtime context 和 Host/Webview 消息边界。剩余技术债仍包括 `App()` 主状态机、执行终端 controller / output drain、paneGallery UI、File/Note 节点和 test DOM bridge。

最终结果：拆类型后 `npm run typecheck` 通过；拆执行节点后 `npm run typecheck` 与 `npm run build` 通过；最终补跑 `npm run typecheck`、`npm run build`、`npm run test:webview-build-xterm-entry`、`npm run test:protocol-webview-messages` 和 `git diff --check` 均通过。本轮未修改 Note Markdown 路径，未补跑 Note Markdown 三项定向测试。

## 上下文与定向

仓库是 VS Code extension monorepo。主扩展位于 `extensions/vscode/dev-session-canvas/`。Webview 是 React / React Flow 前端，入口是 `extensions/vscode/dev-session-canvas/src/webview/main.tsx`。架构不变量来自 `ARCHITECTURE.md`：Extension Host 持有 workspace 绑定权威状态，Webview 只负责呈现、局部 UI 状态和用户意图；Webview 不直接访问文件系统或 CLI 进程。

前三阶段已经新增 `paneGalleryLocalState.ts`、`noteMarkdownPreview.ts`、`canvasGroupFrameStyles.ts`、`canvasTypes.ts`、`canvasEdges.tsx`、`canvasGraphRules.ts`、`canvasDomEvents.ts`、`noteEditingSurface.ts`、`canvasMiniMap.tsx`、`canvasUiSurface.tsx` 和 `canvasGroupLayers.tsx`。第四阶段必须复用这些模块，不回搬逻辑。

当前执行节点区域从 `AgentSessionNode` 到 `TerminalSessionNode`，包含节点 title chrome、attention 状态、start/stop/restart/branch/delete 按钮、terminal overlay、xterm mount、FitAddon resize、snapshot restore shrink-fit grace、xterm 私有 mouse/selection 缩放修正、drop/link/paste/native interaction 绑定和 auto-launch。`createExecutionTerminalController` 位于更后方，负责 output drain、snapshot queue、persist barrier、exit overlay 和诊断，本轮不移动。

## 工作计划

先创建 `extensions/vscode/dev-session-canvas/src/webview/executionTerminalTypes.ts`，只移动执行终端 controller、host event、content change reason 和 registry entry 的共享类型。这个文件只放 type/interface，不放运行时逻辑。

然后创建 `extensions/vscode/dev-session-canvas/src/webview/executionSessionNodes.tsx`。该模块导出 `createExecutionSessionNodeTypes(deps)`，由 `main.tsx` 在构造 `nodeTypes` 前调用，返回 `{ agent, terminal }`。模块内部保持 `AgentSessionNode` 与 `TerminalSessionNode` 的 JSX、data attribute、className、overlay 条件和 xterm mount cleanup 顺序与原实现一致。需要入口状态或函数时通过 `deps` 接收，例如 `createExecutionTerminalController`、`executionTerminalRegistry`、`getRuntimeContext`、`resolveExecutionTerminalFileLinks`、`reportExecutionInputDispatch`、`createEmbeddedTerminalOptions`、`createZoomAdjustedMouseEvent`、`positionTextareaUnderScaledMouse` 和 `readXtermScreenElement`。

如果为移动执行节点需要共享 `ActionButton`，可把它从 `main.tsx` 移入 `canvasUiSurface.tsx`，因为它是 Webview UI surface helper，已经被多个节点复用。不要在执行节点模块复制按钮实现。

同步文档时，更新 `ARCHITECTURE.md` 的 Webview code map，补充执行节点模块说明。更新 `docs/exec-plans/tech-debt-tracker.md` 时应写“继续收口但未完全解决”，因为 `App()` 主状态机、执行终端 controller、paneGallery UI、File/Note 节点和 test DOM bridge 仍留在入口中。

## 具体步骤

所有命令从仓库根目录运行：`/home/users/ziyang01.wang-al/projects/dev-session-canvas.worktrees/dev-session-canvas8`。

先确认工作区：

    git status --short --branch
    wc -l extensions/vscode/dev-session-canvas/src/webview/main.tsx

拆共享类型后运行：

    npm run typecheck

拆执行节点后运行：

    npm run typecheck
    npm run build

最终运行：

    npm run typecheck
    npm run build
    npm run test:webview-build-xterm-entry
    npm run test:protocol-webview-messages
    git diff --check

如果实际触碰 Note markdown 路径，再补跑 Note Markdown 三项定向测试。完整 `npm run test:webview` 在当前 headless Chromium 环境下已知可能因 `requestAnimationFrame` 不触发而超时；如果复跑仍失败，必须记录它和 `origin/main` baseline 的关系，不把它伪装成通过。

## 验证与验收

验收标准是行为保持。TypeScript 类型检查通过，说明拆分后的 import/export 类型边界一致；build 通过，说明 Webview IIFE 仍能打包；Webview xterm entry 测试通过，说明执行终端相关 bundle entry 未破坏；protocol 测试通过，说明消息协议未被改动；`git diff --check` 通过，说明没有机械格式问题。

代码层面，`executionSessionNodes.tsx` 不应导入 `main.tsx`，不应调用 VS Code API，不应改变执行节点的 DOM selector、data attribute、action id、overlay 文案 key、xterm restore/resize cleanup 顺序或 auto-launch 条件。

## 幂等性与恢复

本轮拆分应按小批次执行，每批后运行 `npm run typecheck` 或至少用 `rg` 确认旧定义不再重复存在。若某一批拆分导致循环依赖或需要改变运行时语义，应撤回该批具体文件改动，而不是修改功能行为来适配。不要使用 `git reset --hard` 或 `git checkout --` 回退整仓；如需撤销单个文件，先确认没有用户未提交改动。

## 证据与备注

初始现状：

    git status --short --branch
    ## webview-main-tsx-refactor...origin/main [ahead 3]

    wc -l extensions/vscode/dev-session-canvas/src/webview/main.tsx
    14143 extensions/vscode/dev-session-canvas/src/webview/main.tsx

上一轮提交：

    git log --oneline -1
    278695b refactor(webview): 拆分 main tsx 第三阶段模块

当前阶段性结果：

    wc -l extensions/vscode/dev-session-canvas/src/webview/main.tsx extensions/vscode/dev-session-canvas/src/webview/executionSessionNodes.tsx extensions/vscode/dev-session-canvas/src/webview/executionTerminalTypes.ts
      12958 extensions/vscode/dev-session-canvas/src/webview/main.tsx
       1253 extensions/vscode/dev-session-canvas/src/webview/executionSessionNodes.tsx
         95 extensions/vscode/dev-session-canvas/src/webview/executionTerminalTypes.ts
      14306 total

    npm run typecheck
    # 通过

    npm run build
    # 通过

最终验证：

    npm run typecheck
    # 通过

    npm run build
    # 通过

    npm run test:webview-build-xterm-entry
    webview xterm entry build tests passed

    npm run test:protocol-webview-messages
    protocol webview message tests passed

    git diff --check
    # 通过

## 接口与依赖

`executionTerminalTypes.ts` 建议导出：

    export type ExecutionHostEvent = ...;
    export interface ExecutionTerminalController { ... }
    export type ExecutionTerminalContentChangeReason = ...;
    export interface ExecutionTerminalRegistryEntry { ... }

`executionSessionNodes.tsx` 建议导出：

    export function createExecutionSessionNodeTypes(deps: ExecutionSessionNodeDependencies): {
      agent: React.ComponentType<NodeProps<CanvasNodeData>>;
      terminal: React.ComponentType<NodeProps<CanvasNodeData>>;
    };

实际导出可以按实现需要增减，但不得改变字段语义、selector 或回调行为。

本次修订说明：2026-07-08 创建第四阶段执行节点拆分计划，记录范围、顺序、验证命令和行为保持边界。

本次修订说明：2026-07-08 13:29+08:00 更新第四阶段实现进度、发现、复盘和阶段性验证证据；执行节点模块已拆出，等待最终验证与提交。

本次修订说明：2026-07-08 13:32+08:00 记录最终验证结果，并将计划准备归档到 completed。
