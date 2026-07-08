# Webview main.tsx 第六阶段 File/Note 节点拆分

本 `ExecPlan` 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘` 这几个章节。本计划遵循 `docs/PLANS.md`。

## 目标与全局图景

第五阶段已经把 paneGallery UI 拆到 `extensions/vscode/dev-session-canvas/src/webview/paneGallerySurface.tsx`，`extensions/vscode/dev-session-canvas/src/webview/main.tsx` 仍有 12,033 行，并继续包含 File / FileList / Note 三类节点 UI。第六阶段目标是在不改变用户功能、DOM selector、React Flow node type、文件打开、Note Markdown 编辑、关联 Markdown 冲突处理、metadata popover、节点 resize / handle 行为或测试 probe 的前提下，把 File/Note 节点渲染从入口文件拆到独立模块。

本轮不拆 `App()` 主状态机，不改 Host/Webview 协议，不改变 `CanvasNodeData` shape，不重写 Note Markdown 渲染器或 Note 编辑 helper。入口继续负责状态、消息发送、selection、viewport、test-only DOM bridge、执行终端 controller 和通用节点 chrome；新模块只承载 File / FileList / Note 节点组件、其局部 UI helper，以及 file minimal footprint 计算。

## 进度

- [x] (2026-07-08 15:18+08:00) 确认当前分支 `webview-main-tsx-refactor` 工作区干净，最近提交为 `fb320c7 refactor(webview): 拆分 paneGallery UI 模块`；用户选择继续拆 File/Note 节点。
- [x] (2026-07-08 15:18+08:00) 建立本 ExecPlan，明确本轮只拆 File/Note 节点 UI 与 file footprint helper，不改变协议、测试 selector 或用户行为。
- [x] (2026-07-08 15:35+08:00) 抽出 File / FileList / Note 节点到 `extensions/vscode/dev-session-canvas/src/webview/fileNoteNodes.tsx`，并让 `main.tsx` 通过 `createFileNoteNodeTypes(...)` 注入通用节点 chrome、resize、handles、action button 和 fallback card。
- [x] (2026-07-08 15:39+08:00) 同步 `ARCHITECTURE.md` 和 `docs/exec-plans/tech-debt-tracker.md`，记录 File/Note 节点已离开入口、`main.tsx` 当前为 9,627 行。
- [x] (2026-07-08 15:39+08:00) 接手后复跑 `npm run typecheck` 通过，确认新模块类型边界与入口调用一致。
- [x] (2026-07-08 15:42+08:00) 最终验证通过：`npm run typecheck`、`npm run build`、`npm run test:webview-build-xterm-entry`、`npm run test:protocol-webview-messages`、`git diff --check`。
- [x] (2026-07-08 15:45+08:00) 归档本计划到 `docs/exec-plans/completed/`；本计划随本阶段提交一并落地。

## 意外与发现

- 观察：`fileNoteNodes.tsx` 抽出后，FileList tree collapse pruning 仍需要入口在接收 host state 时清理 stale branch key。
  证据：`main.tsx` 仍在本地 UI state reconcile 中读取每个 `file-list` 节点的 entries；新模块导出 `collectFileListTreeBranchKeysForEntries(...)` 只暴露 branch key 集合，避免入口重新依赖 tree 渲染内部结构。

- 观察：接手后复查 `displayFilePath(...)` 附近没有重复参数行，且 `npm run typecheck` 返回 exit 0。
  证据：`sed -n '2380,2420p' extensions/vscode/dev-session-canvas/src/webview/fileNoteNodes.tsx` 只显示一个 `mode: CanvasFilePathDisplayMode` 参数；随后 `npm run typecheck` 通过。

## 决策记录

- 决策：第六阶段拆 File/Note 节点 UI，但保留 `CompactCanvasCardNodeContent`、`NodeResizeAffordance`、`NodeHandles`、`NodeOverviewTitle` 和 `ActionButton` 在 `main.tsx`。
  理由：这些通用节点 chrome 仍被执行节点、compact card 和入口共享；本轮只移动 File/Note 专属 UI，避免同时扩大通用节点 surface 的边界。
  日期/作者：2026-07-08 / Codex。

- 决策：新 File/Note 模块不导入 `main.tsx`，而是通过 `createFileNoteNodeTypes(...)` 接收本地化函数和通用组件依赖。
  理由：File/Note 节点需要复用入口已有的 chrome、resize、handles 和 fallback card；直接 import 入口会形成循环依赖。显式依赖与上一阶段 paneGallery / 执行节点拆分一致。
  日期/作者：2026-07-08 / Codex。

- 决策：为 `main.tsx` 需要的 file-list collapsed branch 清理新增 `collectFileListTreeBranchKeysForEntries(...)`，而不是把 file tree branch 类型或渲染 helper 暴露给入口。
  理由：入口只需要知道当前 entries 能产生哪些 folder branch key；保持导出函数为纯数据 helper，可以避免把 `FileListNode` 的 tree UI 内部结构重新泄漏回入口。
  日期/作者：2026-07-08 / Codex。

## 结果与复盘

已新增 `extensions/vscode/dev-session-canvas/src/webview/fileNoteNodes.tsx`，承载 `FileNode`、`FileListNode`、`NoteEditableNode`、Note metadata popover、关联 Markdown 冲突/草稿面板、FileList list/tree UI、File icon/path helper 和 file minimal footprint helper；`main.tsx` 继续持有 `App()` 状态机、Host/Webview 消息边界、通用节点 chrome、execution terminal controller、test-only DOM bridge 与 React Flow 装配。`main.tsx` 当前从 12,033 行降到 9,627 行，新模块为 2,540 行。本轮是行为保持重构，没有改变 `note`、`file`、`file-list` node type key，未改变 File/Note DOM selector、action id、Note Markdown 编辑/预览/checklist/link 行为、关联 Markdown 操作或 FileList tree/list 行为。

剩余技术债没有消失：`App()` 状态机、执行终端 controller / output drain、通用节点 chrome / compact card 和 test-only DOM bridge 仍在入口中。已在 `docs/exec-plans/tech-debt-tracker.md` 更新第六阶段收口范围和后续建议。本轮最终验证通过 `npm run typecheck`、`npm run build`、`npm run test:webview-build-xterm-entry`、`npm run test:protocol-webview-messages` 和 `git diff --check`。

## 上下文与定向

仓库是 VS Code extension monorepo。Webview 入口是 `extensions/vscode/dev-session-canvas/src/webview/main.tsx`。当前 File/Note 相关代码集中在入口中：`FileNode`、`FileListNode`、`FileListEntryButton`、file tree helper、`NoteEditableNode`、`SubtitleCopyButton`、`NoteMarkdownMetadataTrigger`、file path/icon helper 以及 minimal file footprint helper。Note Markdown 渲染与编辑基础 helper 已分别在 `extensions/vscode/dev-session-canvas/src/webview/noteMarkdownPreview.ts` 和 `extensions/vscode/dev-session-canvas/src/webview/noteEditingSurface.ts`，本轮不重写它们，只在新模块中继续调用。

File/Note 节点必须保留所有现有 DOM 标记和测试入口，包括 `data-node-kind="file"`、`data-node-kind="file-list"`、`data-node-kind="note"`、`data-file-entry-path`、`data-file-entry-selected`、`data-file-list-view-mode`、`data-note-conflict-action`、`data-probe-field="body"`、`data-probe-value`、`data-node-action-id` 等。Note preview 的 checklist/link 行为、双击定位、Tab indent、关联 Markdown draft/reload/overwrite/copy 行为都必须保持。

## 工作计划

创建 `extensions/vscode/dev-session-canvas/src/webview/fileNoteNodes.tsx`。该模块导出 `createFileNoteNodeTypes(...)`、`minimumCanvasNodeFootprintForDisplayStyle(...)` 和 `normalizeCanvasNodeFootprintForDisplayStyle(...)`。`createFileNoteNodeTypes(...)` 返回 `note`、`file`、`file-list` 三个 React Flow node component，并通过依赖注入接收 `t`、`CompactCanvasCardNodeContent`、`NodeResizeAffordance`、`NodeHandles`、`NodeOverviewTitle` 和 `ActionButton`。

更新 `main.tsx` 时，移除 File/Note 节点函数和 File/Note 专属 helper，改为从新模块 import。`nodeTypes` 继续使用同样的 `note`、`file`、`file-list` key，不改变 React Flow 识别的节点类型。入口仍保留 `toFlowNodes(...)`、message handler、Note / file callback、test DOM bridge 和通用 compact card。

同步文档时，更新 `ARCHITECTURE.md` Webview code map，说明 `fileNoteNodes.tsx` 是 File / FileList / Note 节点 UI surface。更新 `docs/exec-plans/tech-debt-tracker.md` 中 Webview `main.tsx` 技术债行，把第六阶段已收口和剩余缺口写清楚，不把大文件债务写成完全解决。

## 具体步骤

所有命令从仓库根目录运行：`/home/users/ziyang01.wang-al/projects/dev-session-canvas.worktrees/dev-session-canvas8`。

先确认工作区：

    git status --short --branch
    wc -l extensions/vscode/dev-session-canvas/src/webview/main.tsx

拆 File/Note 后运行：

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

如实际触碰 Note/File Playwright selectors 或 test bridge，再补跑相关 Webview 测试；本轮预期只移动模块，不修改测试 selector 或协议。

## 验证与验收

验收标准是行为保持。TypeScript 类型检查通过，说明 File/Note props、React Flow 类型和 helper import/export 边界一致；build 通过，说明 Webview bundle 仍能打包；Webview xterm entry 和 protocol 定向测试通过，说明拆分没有破坏执行节点 entry 或消息协议；`git diff --check` 通过，说明没有机械格式问题。

代码层面，`fileNoteNodes.tsx` 不应导入 `main.tsx`，不应调用 VS Code API，不应改变 File/Note DOM selector、data attribute、action id、preview markdown 行为、file list view mode、file tree collapse、associated markdown conflict action 或 node resize 行为。

## 幂等性与恢复

本轮是纯移动重构，可以重复运行 typecheck / build 验证。若新模块引入循环依赖或 props 类型不稳定，应调整依赖注入边界，不通过改用户行为来适配。不要使用 `git reset --hard` 或 `git checkout --` 回退整仓；如需撤销单个文件，先确认没有用户未提交改动。

## 证据与备注

初始现状：

    git status --short --branch
    ## webview-main-tsx-refactor...origin/main [ahead 5]

    wc -l extensions/vscode/dev-session-canvas/src/webview/main.tsx
    12033 extensions/vscode/dev-session-canvas/src/webview/main.tsx

上一轮提交：

    git log --oneline -1
    fb320c7 refactor(webview): 拆分 paneGallery UI 模块

当前拆分后行数：

    wc -l extensions/vscode/dev-session-canvas/src/webview/main.tsx extensions/vscode/dev-session-canvas/src/webview/fileNoteNodes.tsx
      9627 extensions/vscode/dev-session-canvas/src/webview/main.tsx
      2540 extensions/vscode/dev-session-canvas/src/webview/fileNoteNodes.tsx
     12167 total

## 接口与依赖

`fileNoteNodes.tsx` 应导出：

    export function createFileNoteNodeTypes(...): { note: ComponentType<NodeProps<CanvasNodeData>>; file: ComponentType<NodeProps<CanvasNodeData>>; 'file-list': ComponentType<NodeProps<CanvasNodeData>> };
    export function collectFileListTreeBranchKeysForEntries(entries: readonly FileListNodeEntrySummary[]): Set<string>;
    export function minimumCanvasNodeFootprintForDisplayStyle(...): CanvasNodeFootprint;
    export function normalizeCanvasNodeFootprintForDisplayStyle(...): CanvasNodeFootprint;

实际 props 可以按实现需要调整，但不得改变字段语义、selector 或回调行为。

本次修订说明：2026-07-08 创建第六阶段 File/Note 节点拆分计划，记录范围、顺序、验证命令和行为保持边界。

本次修订说明：2026-07-08 完成 File/Note 节点模块抽出，补充当前行数、文档同步状态、branch key helper 决策和接手后 typecheck 证据。

本次修订说明：2026-07-08 记录最终 typecheck、build、Webview xterm entry、protocol message 和 diff check 验证通过。

本次修订说明：2026-07-08 将第六阶段 ExecPlan 归档到 completed，并记录归档进度。
