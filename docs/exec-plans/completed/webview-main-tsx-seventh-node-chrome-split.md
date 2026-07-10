# Webview main.tsx 第七阶段通用节点 chrome 拆分

本 `ExecPlan` 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘` 这几个章节。本计划遵循 `docs/PLANS.md`。

## 目标与全局图景

第六阶段已经把 File / FileList / Note 节点拆到 `extensions/vscode/dev-session-canvas/src/webview/fileNoteNodes.tsx`，`extensions/vscode/dev-session-canvas/src/webview/main.tsx` 仍有 9,627 行，并继续承载所有节点共享的 chrome 小组件。第七阶段目标是在不改变用户功能、DOM selector、React Flow node type、节点 resize 行为、连线 handle、action button data attribute、compact fallback card 或执行节点 attention badge 的前提下，把通用节点 chrome 从入口文件拆到独立模块。

本轮不拆 `App()` 主状态机，不改 Host/Webview 协议，不改变 `CanvasNodeData` shape，不改执行终端 controller / output drain，不拆 test-only DOM bridge。入口继续负责状态、消息发送、selection、viewport、paneGallery、执行终端 controller 和测试 bridge；新模块只承载通用节点 UI 原语：`ActionButton`、`NodeHandles`、`NodeResizeAffordance`、`NodeOverviewTitle`、`CompactCanvasCardNode`、`CompactCanvasCardNodeContent` 和 `ExecutionAttentionStatus`。

## 进度

- [x] (2026-07-08 22:05+08:00) 确认当前分支 `webview-main-tsx-refactor` 工作区干净，最近提交为 `8880731 refactor(webview): 拆分 File/Note 节点模块`；用户选择继续拆通用节点 chrome / compact card。
- [x] (2026-07-08 22:05+08:00) 建立本 ExecPlan，明确本轮只拆共享节点 chrome，不改变协议、测试 selector 或用户行为。
- [x] (2026-07-08 22:18+08:00) 抽出通用节点 chrome 到 `extensions/vscode/dev-session-canvas/src/webview/canvasNodeChrome.tsx`，并让 `main.tsx`、`executionSessionNodes.tsx`、`fileNoteNodes.tsx` 继续通过同一组件实例复用这些 UI 原语。
- [x] (2026-07-08 22:19+08:00) 运行 `npm run typecheck` 通过，确认 React Flow handle、resize draft、action button 和 compact card 的类型边界一致。
- [x] (2026-07-08 22:23+08:00) 同步 `ARCHITECTURE.md` 和 `docs/exec-plans/tech-debt-tracker.md`，记录通用节点 chrome 已离开入口、`main.tsx` 当前为 9,179 行。
- [x] (2026-07-08 22:25+08:00) 最终验证通过：`npm run typecheck`、`npm run build`、`npm run test:webview-build-xterm-entry`、`npm run test:protocol-webview-messages`、`git diff --check`。
- [x] (2026-07-08 22:26+08:00) 归档本计划到 `docs/exec-plans/completed/`；本计划随本阶段提交一并落地。

## 意外与发现

- 观察：`canvasNodeChrome.tsx` 需要 `CanvasNodePosition`，但该类型由 common protocol 导出，`canvasTypes.ts` 只是本地引用并未 re-export。
  证据：第一次 `npm run typecheck` 报 `Module './canvasTypes' declares 'CanvasNodePosition' locally, but it is not exported`；改为从 `../common/protocol` 引入后 typecheck 通过。

- 观察：通用节点 chrome 抽出后，`main.tsx` 不再需要直接导入 React Flow `Handle`、`Position`、`useViewport` 或 `NodeProps`。
  证据：拆分后 `rg` 只在 `canvasNodeChrome.tsx`、`fileNoteNodes.tsx`、`executionSessionNodes.tsx` 等节点模块中命中这些符号，`main.tsx` 的 React Flow import 只保留画布装配所需项。

## 决策记录

- 决策：第七阶段拆通用节点 chrome，但保留 `ExecutionHelpTrigger` 和 canvas-level help panel 在 `main.tsx`。
  理由：`ExecutionHelpTrigger` 的 canvas variant 直接服务画布角落帮助面板，inline variant 只被执行节点通过依赖注入复用；它不是所有节点共享的 chrome。先拆所有节点都使用的 resize、handles、overview title、compact fallback 和 action button，可以降低入口体积且避免把执行帮助 tooltip 的状态也迁出。
  日期/作者：2026-07-08 / Codex。

- 决策：新模块不导入 `main.tsx`，而是由 `createCanvasNodeChrome(...)` 接收 `t`、status label formatter、provider label formatter 和 file footprint helper。
  理由：通用 chrome 需要本地化 resize/action 文案、展示状态文案、计算 file minimal footprint；直接 import 入口会形成循环依赖。显式依赖保持入口为组合根，并让 File/Note 与执行节点继续只消费组件依赖。
  日期/作者：2026-07-08 / Codex。

## 结果与复盘

已新增 `extensions/vscode/dev-session-canvas/src/webview/canvasNodeChrome.tsx`，承载 `ActionButton`、`NodeHandles`、`NodeResizeAffordance`、`NodeOverviewTitle`、`CompactCanvasCardNode`、`CompactCanvasCardNodeContent` 和 `ExecutionAttentionStatus`；`main.tsx` 继续持有 `App()` 状态机、Host/Webview 消息边界、execution terminal controller、test-only DOM bridge、canvas-level help panel 与 React Flow 装配。`main.tsx` 当前从 9,627 行降到 9,179 行，新模块为 530 行。本轮是行为保持重构，没有改变节点 action button、resize control、React Flow handle、overview status、execution attention 或 compact fallback DOM 语义。

剩余技术债没有消失：`App()` 状态机、执行终端 controller / output drain、ExecutionHelpTrigger / canvas-level help panel 和 test-only DOM bridge 仍在入口中。已在 `docs/exec-plans/tech-debt-tracker.md` 更新第七阶段收口范围和后续建议。本轮最终验证通过 `npm run typecheck`、`npm run build`、`npm run test:webview-build-xterm-entry`、`npm run test:protocol-webview-messages` 和 `git diff --check`。

## 上下文与定向

仓库是 VS Code extension monorepo。Webview 入口是 `extensions/vscode/dev-session-canvas/src/webview/main.tsx`。当前通用节点 chrome 仍在入口中：`ActionButton` 负责统一按钮 class、`data-node-action-id`、overview disabled 语义和事件阻断；`NodeHandles` 负责四向 React Flow source handle；`NodeResizeAffordance` 负责选中节点的 resize line/control、auto pan 后的 draft layout 和最终 `onResizeNode` 回调；`NodeOverviewTitle` 负责 overview 模式标题和状态 pill；`CompactCanvasCardNode` / `CompactCanvasCardNodeContent` 负责缺 metadata 或未知 card 的 fallback 表面；`ExecutionAttentionStatus` 负责执行节点 titlebar attention icon 与 status pill。

这些组件被 `main.tsx` 的 `nodeTypes.card`、`executionSessionNodes.tsx` 的 Agent/Terminal 节点、`fileNoteNodes.tsx` 的 File/FileList/Note 节点共同使用。本轮必须保留所有现有 DOM 标记和测试入口，包括 `data-node-action-id`、`data-node-interactive`、`data-node-resize-direction`、`data-node-kind`、`data-node-selected`、React Flow handle id `top/right/bottom/left`、`data-overview-status`、`data-attention-indicator` 等。

## 工作计划

创建 `extensions/vscode/dev-session-canvas/src/webview/canvasNodeChrome.tsx`。该模块导出 `createCanvasNodeChrome(...)`，返回 `ActionButton`、`NodeHandles`、`NodeResizeAffordance`、`NodeOverviewTitle`、`CompactCanvasCardNode`、`CompactCanvasCardNodeContent` 和 `ExecutionAttentionStatus`。模块内部移动原有 resize geometry helper、resize direction 常量、overview status helper 和 compact card 渲染。

更新 `main.tsx` 时，移除这些通用节点 chrome 函数，改为从新模块创建 `canvasNodeChrome` 后解构复用。`executionSessionNodes.tsx` 和 `fileNoteNodes.tsx` 的依赖注入形状尽量不改；入口继续把同名组件传给它们，`nodeTypes.card` 继续指向 compact fallback node component。`main.tsx` 继续保留 `ExecutionHelpTrigger`、`CanvasExecutionHelpPanel`、状态格式化、provider label、message handler、test DOM bridge 和执行终端 controller。

同步文档时，更新 `ARCHITECTURE.md` Webview code map，说明 `canvasNodeChrome.tsx` 是共享节点 chrome surface。更新 `docs/exec-plans/tech-debt-tracker.md` 中 Webview `main.tsx` 技术债行，把第七阶段已收口和剩余缺口写清楚，不把大文件债务写成完全解决。

## 具体步骤

所有命令从仓库根目录运行：`/home/users/ziyang01.wang-al/projects/dev-session-canvas.worktrees/dev-session-canvas8`。

先确认工作区：

    git status --short --branch
    wc -l extensions/vscode/dev-session-canvas/src/webview/main.tsx

拆通用节点 chrome 后运行：

    npm run typecheck
    npm run build

当前执行记录：

    npm run typecheck && npm run build && npm run test:webview-build-xterm-entry && npm run test:protocol-webview-messages && git diff --check
    # exit 0

    webview xterm entry build tests passed
    protocol webview message tests passed

最终运行：

    npm run typecheck
    npm run build
    npm run test:webview-build-xterm-entry
    npm run test:protocol-webview-messages
    git diff --check

如实际触碰 Playwright selectors 或 test bridge，再补跑相关 Webview 测试；本轮预期只移动模块，不修改测试 selector 或协议。

## 验证与验收

验收标准是行为保持。TypeScript 类型检查通过，说明通用 chrome props、React Flow handle 类型、resize draft 类型和 helper import/export 边界一致；build 通过，说明 Webview bundle 仍能打包；Webview xterm entry 和 protocol 定向测试通过，说明拆分没有破坏执行节点 entry 或消息协议；`git diff --check` 通过，说明没有机械格式问题。

代码层面，`canvasNodeChrome.tsx` 不应导入 `main.tsx`，不应调用 VS Code API，不应改变节点 DOM selector、data attribute、action id、React Flow handle id、resize geometry、auto-pan resize draft、overview title/status 或 compact fallback card 行为。

## 幂等性与恢复

本轮是纯移动重构，可以重复运行 typecheck / build 验证。若新模块引入循环依赖或 props 类型不稳定，应调整依赖注入边界，不通过改用户行为来适配。不要使用 `git reset --hard` 或 `git checkout --` 回退整仓；如需撤销单个文件，先确认没有用户未提交改动。

## 证据与备注

初始现状：

    git status --short --branch
    ## webview-main-tsx-refactor...origin/main [ahead 6]

    wc -l extensions/vscode/dev-session-canvas/src/webview/main.tsx
    9627 extensions/vscode/dev-session-canvas/src/webview/main.tsx

上一轮提交：

    git log --oneline -1
    8880731 refactor(webview): 拆分 File/Note 节点模块

当前拆分后行数：

    wc -l extensions/vscode/dev-session-canvas/src/webview/main.tsx extensions/vscode/dev-session-canvas/src/webview/canvasNodeChrome.tsx
      9179 extensions/vscode/dev-session-canvas/src/webview/main.tsx
       530 extensions/vscode/dev-session-canvas/src/webview/canvasNodeChrome.tsx
      9709 total

## 接口与依赖

`canvasNodeChrome.tsx` 应导出：

    export function createCanvasNodeChrome(...): {
      ActionButton: ComponentType<...>;
      CompactCanvasCardNode: ComponentType<NodeProps<CanvasNodeData>>;
      CompactCanvasCardNodeContent: ComponentType<...>;
      ExecutionAttentionStatus: ComponentType<{ status: string; attentionPending: boolean }>;
      NodeHandles: ComponentType<{ selected: boolean }>;
      NodeOverviewTitle: ComponentType<{ title: string; status?: string }>;
      NodeResizeAffordance: ComponentType<...>;
    };

实际 props 可以按实现需要调整，但不得改变字段语义、selector 或回调行为。

本次修订说明：2026-07-08 创建第七阶段通用节点 chrome 拆分计划，记录范围、顺序、验证命令和行为保持边界。

本次修订说明：2026-07-08 完成通用节点 chrome 模块抽出，补充当前行数、文档同步状态、类型边界发现和 typecheck 证据。

本次修订说明：2026-07-08 记录最终 typecheck、build、Webview xterm entry、protocol message 和 diff check 验证通过。

本次修订说明：2026-07-08 将第七阶段 ExecPlan 归档到 completed，并记录归档进度。
