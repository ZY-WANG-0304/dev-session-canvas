# 侧栏 workspace 与 worktree 操作

本 `ExecPlan` 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘` 这几个章节。

本文位于 `docs/exec-plans/completed/sidebar-workspace-worktree-actions.md`，必须按照 `docs/PLANS.md` 的要求持续维护。执行者应假设自己只知道当前工作树和本文内容，不依赖之前的对话记忆。

## 目标与全局图景

这次变更让用户不用离开 Dev Session Canvas sidebar 就能管理当前 VS Code workspace 的 root。完成后，用户可以在 `节点` section 标题栏点击“添加文件夹到 workspace”，也可以点击“新建 worktree”并把新建目录自动加入当前 workspace；在多根 workspace 下，用户既可以通过全局按钮先选择基准 root，也可以直接在某个 root 分组行上点击“新建 worktree”或“从 workspace 移除 root”。这些操作都委托给 VS Code workspace folders API 和本地 `git worktree` 命令，随后复用现有 `onDidChangeWorkspaceFolders` 组合视图逻辑生成或移除系统 root section。

## 进度

- [x] (2026-06-16 01:08 +0800) 已读取 `docs/WORKFLOW.md`、`docs/FRONTEND.md`、`ARCHITECTURE.md`、`docs/DESIGN.md`、`docs/PLANS.md`、`docs/design-docs/canvas-sidebar-node-and-session-lists.md` 与 `docs/design-docs/canvas-multi-root-workspace-support.md`，确认本任务涉及 sidebar、workspace root 与 git worktree，需要同步设计文档并创建本计划。
- [x] (2026-06-16 01:08 +0800) 已从最新 `origin/main` 创建主题分支 `sidebar-workspace-worktree-actions`。
- [x] (2026-06-16 01:35 +0800) 已梳理现有 sidebar 节点列表 Webview、命令注册、manifest 菜单、multi-root root group projection 与测试入口，确认无需修改 multi-root composition。
- [x] (2026-06-16 02:05 +0800) 已实现添加 workspace folder、移除 root、创建 git worktree 并加入 workspace 的命令和 UI 入口；worktree 执行前会检查 workspace trust。
- [x] (2026-06-16 02:18 +0800) 已补充 `scripts/test/test-sidebar-node-list.mjs` 与 `scripts/test/test-extension-manifest.mjs`，并更新产品规格、设计文档、设计索引。
- [x] (2026-06-16 02:27 +0800) 已完成最终验证：`npm run test:extension-manifest`、`npm run test:sidebar-node-list`、`npm run test:sidebar-list-colors`、`npm run typecheck`、`npm run build` 与 `git diff --check` 均通过。
- [x] (2026-06-16 14:05 +0800) 根据用户截图补充二次收口：worktree 操作改用 VS Code 专用 `worktree` Codicon，并将创建 worktree 流程对齐到 VS Code Source Control 的两层 QuickPick ref 选择。
- [x] (2026-06-16 14:20 +0800) 已更新源码、manifest 测试、节点列表 Webview 测试、codicon bundle 测试、产品规格和设计文档；最终验证 `npm run test:extension-manifest`、`npm run test:sidebar-node-list`、`npm run test:sidebar-codicon-bundle`、`npm run test:sidebar-list-colors`、`npm run typecheck`、`npm run build` 与 `git diff --check` 已通过。

## 意外与发现

- 观察：当前节点列表是 WebviewView，root 分组行不是 VS Code TreeItem，因此 root 级按钮必须在 Webview DOM 内渲染并用 `postMessage` 回到 Host。
  证据：`src/sidebar/CanvasSidebarNodeListView.ts` 中 `buildSidebarNodeListHtml(...)` 负责 `renderGroupRow(...)`，manifest 只能提供 view title action。
- 观察：执行 `git worktree add` 属于本地命令执行能力，应继续受 workspace trust 保护。
  证据：实现中 `createWorktreeAndAddToWorkspaceFromCommand(...)` 在 prompt 和 git 命令前检查 `vscode.workspace.isTrusted`。
- 观察：VS Code 自带 Source Control 使用专用 worktree glyph，而不是 `repo-forked`；当前依赖中的 `@vscode/codicons` 已包含 `.codicon-worktree` 和 manifest 可用的 `$(worktree)`。
  证据：用户截图中的 Source Control worktree 图标与 `node_modules/@vscode/codicons/dist/codicon.css` 中 `.codicon-worktree` 对应。
- 观察：VS Code 的 Create Worktree 主路径不是直接输入分支名，而是先展示 `Create new branch...`、`Create new branch from...`、`HEAD` 和分支 refs；从指定 ref 创建新分支时再进入第二层 ref picker。
  证据：用户提供的 QuickPick 截图显示标题 `Create Worktree (...path...) (1/2)` 和第二层 `Create new branch from...`。

## 决策记录

- 决策：把“添加文件夹”“新建 worktree”的全局入口放在 `节点` view title 的 inline `navigation` action，把 root 级“移除 root”“新建 worktree”放在节点列表 Webview 的 workspace-root 分组行尾部。
  理由：用户明确要求这些按钮出现在 sidebar 的节点部分，以及多根 workspace 下新建 worktree 按钮也出现在 root 分组。`TreeView` item inline action 不适用于当前已经 Webview 化的节点列表，因此 root 级动作需要由 Webview 自绘，但保持 VS Code 原生 list action 尺寸和 codicon 视觉。
  日期/作者：2026-06-16 / Codex。
- 决策：新建 worktree 时，若没有从 root 分组上下文提供基准 root 且当前 workspace 有多个 root，就先用 QuickPick 选择“要基于哪个 root 新建 worktree”；单根 workspace 直接使用唯一 root。
  理由：这是需求第 4 条的最小明确解法；它避免猜测当前应该对哪个仓库执行 `git worktree add`，同时 root 分组按钮可跳过该选择。
  日期/作者：2026-06-16 / Codex。
- 决策：worktree 创建目录默认建议为当前 root 同级目录下的 `<root-name>.worktrees/<ref-or-branch>`；创建流程先读取 `HEAD` 与本地分支 refs，并提供 VS Code 风格 QuickPick。`Create new branch...` 使用当前 `HEAD` 创建新分支；`Create new branch from...` 先选择 base ref 再输入分支名；直接选择已有 ref 时执行 `git worktree add [--detach] <path> <ref>`，其中 `HEAD` 或已被其他 worktree checkout 的分支会走 detached HEAD，避免 git 拒绝重复 checkout 同一分支。
  理由：用户截图明确要求参考 VS Code Create Worktree 交互；保留 `.worktrees/<name>` 默认目录能延续本仓库 worktree 组织方式，同时让已有分支、HEAD detached 和从指定 ref 新建分支都进入同一用户心智。
  日期/作者：2026-06-16 / Codex。
- 决策：worktree 相关 command icon 与 root 行 icon 使用 `worktree` Codicon；会话历史里的 provider 分叉继续使用 `repo-forked`，两者不混用。
  理由：worktree 是 git 工作目录语义，不是 Agent session fork 语义；截图显示 VS Code 自身也对 worktree 使用专用图标，区分后能减少用户误读。
  日期/作者：2026-06-16 / Codex。

## 结果与复盘

实现与验证已完成。当前改动让 `节点` section 标题栏出现添加 folder 与新建 worktree 操作，workspace-root 分组行尾出现 root 级新建 worktree 与移除 root 操作；worktree 操作使用专用 `worktree` Codicon，创建流程对齐 VS Code Source Control 的 ref QuickPick；新增 worktree 被自动加入 workspace 后，现有 multi-root compose 流程会创建并聚焦新的 workspace-root section。自动化已补 root 行 DOM / 消息、manifest contribution、sidebar list color token、TypeScript 编译、build 与 diff 检查覆盖；真实 VS Code 文件夹 picker 与 git worktree 创建仍建议在 disposable repo 中人工验证一次。

## 上下文与定向

当前扩展入口是 `src/extension.ts`。它创建 `CanvasPanelManager`，注册 sidebar views，并注册命令。命令 ID 集中在 `src/common/extensionIdentity.ts`，manifest contribution 在 `package.json`，用户可见命令标题在 `package.nls.json`。

`节点` sidebar section 由 `src/sidebar/CanvasSidebarNodeListView.ts` 实现。这个 view 是一个最小 `WebviewView`，不是原生 `TreeView`。宿主将 `CanvasPanelManager.getCanvasSidebarNodeListSnapshot()` 的节点和分组快照投影到 Webview；Webview 内部在 `buildGroupedTree()`、`renderGroupedTree()` 和 `renderFlatRootGroups()` 里渲染分组行。多根 workspace 的系统 root section 是 `CanvasGroupSummary`，`role === 'workspace-root'`，并带有 `workspaceRootPath`。root section 不是用户普通分组，本次 root 级操作必须只出现在这类分组行上。

当前 multi-root 状态响应在 `src/panel/CanvasPanelManager.ts` 的 `vscode.workspace.onDidChangeWorkspaceFolders` 监听器中。只要通过 `vscode.workspace.updateWorkspaceFolders(...)` 添加或移除 folder，Manager 会重新加载组合状态、持久化、向 Webview 发送 `host/stateUpdated`，新增 root 时还会通过 `focusWorkspaceRootInCanvas(...)` 请求画布聚焦新增 root。因此本次无需直接修改组合算法。

本计划中的 “worktree” 指 git worktree：同一个 git repository 的另一个工作目录，可以 checkout 一个独立分支。实现应使用 VS Code extension host 中的 Node.js 子进程调用 `git`，并在成功后调用 `vscode.workspace.updateWorkspaceFolders` 把新目录加入当前窗口。命令执行必须限制在用户选择的 workspace root 上，通过 `git -C <root>` 指定仓库，避免依赖扩展进程当前工作目录。

## 工作计划

第一步补命令 ID、manifest 和 localization。新增 `devSessionCanvas.addFolderToWorkspace`、`devSessionCanvas.createWorktree`、`devSessionCanvas.removeWorkspaceRoot`、`devSessionCanvas.createWorktreeForRoot` 四类命令；其中 root-specific 命令可以隐藏在 command palette 或作为内部 Webview 消息处理实现，但为了可测试和可追踪，命令 ID 应集中登记在 `src/common/extensionIdentity.ts`。`package.json` 的 `view/title` 中，`devSessionCanvas.sidebarNodes` 增加“添加文件夹到 workspace”和“新建 worktree”两个 navigation action，位置应在创建节点之前；root 级动作由 Webview 内容区自绘，不需要 manifest item context。

第二步实现 workspace 操作。`src/extension.ts` 中新增函数：选择文件夹并加入 workspace；从 root path 解析 workspace folder 并从 workspace 移除；创建 worktree 的用户输入、git 命令执行和 workspace 添加。添加 folder 应使用 `vscode.window.showOpenDialog({ canSelectFolders: true, canSelectMany: true })`，过滤掉已在 workspace 中的目录，再调用 `vscode.workspace.updateWorkspaceFolders(currentCount, 0, ...folders)`。移除 root 应弹 modal 确认，只移除 workspace folder，不删除磁盘文件。创建 worktree 应先解析基准 root，读取 `HEAD` 与本地分支 refs，展示 VS Code 风格 QuickPick；创建新分支路径执行 `git worktree add -b <branch> <path> [startPoint]`，已有 ref 路径执行 `git worktree add [--detach] <path> <ref>`；选择 `HEAD` 或已在其他 worktree checkout 的分支时使用 detached HEAD，成功后把目录加入 workspace。

第三步扩展 `CanvasSidebarNodeListView.ts`。宿主侧 outbound item 或 group 不需要新增复杂模型，但 Webview 渲染 group row 时需要识别 `role === 'workspace-root'` 且存在 `workspaceRootPath` 的 group，并在行尾显示两个 icon-only 按钮：`worktree` 表示新建 worktree，`close` 表示从 workspace 移除。按钮点击发送 `sidebarNodeList/createWorktreeForRoot` 或 `sidebarNodeList/removeWorkspaceRoot` 消息，payload 携带 `rootPath` 和 `groupId`。普通用户分组、attention 虚拟分组和未分组分组不显示这些按钮。

第四步补文档。更新 `docs/product-specs/canvas-sidebar-node-and-session-lists.md` 记录节点 section 的 workspace 操作入口；更新 `docs/product-specs/canvas-multi-root-workspace-support.md` 记录 root 分组 remove/worktree 行为；更新 `docs/design-docs/canvas-sidebar-node-and-session-lists.md` 和 `docs/design-docs/canvas-multi-root-workspace-support.md` 的正式方案、验证方法和验证状态；必要时更新 `docs/design-docs/index.md` 的日期。

第五步补自动化验证。扩展 `scripts/test/test-sidebar-node-list.mjs`，渲染包含 workspace-root group 的状态，断言 root 行出现 worktree/remove 按钮，点击后 Webview 向宿主发送对应消息；普通分组不出现 root action。扩展 `scripts/test/test-extension-manifest.mjs`，断言 `节点` view title 包含新增两个全局 action，且 view mode commands 仍留在 secondary menu。可以新增轻量脚本测试命令源码中使用 `git -C` 与 `updateWorkspaceFolders`，如果 TypeScript typecheck 能覆盖大部分即可不额外加脆弱源码断言。

## 具体步骤

在仓库根目录 `/home/users/ziyang01.wang-al/projects/dev-session-canvas.worktrees/dev-session-canvas7` 执行以下命令。实现前已执行：

    git fetch origin main
    git switch -c sidebar-workspace-worktree-actions origin/main

实现期间重复执行定向测试：

    npm run test:extension-manifest
    npm run test:sidebar-node-list
    npm run typecheck
    git diff --check

如果 worktree 命令需要手动验证，使用一个临时 git repo 打开 VS Code Extension Development Host，点击 `节点` view 的“新建 worktree”，确认先出现 `Create Worktree (...path...) (1/2)` QuickPick；分别验证 `Create new branch...`、`Create new branch from...` 和选择 `HEAD` / 本地分支的路径，并确认同级 `.worktrees/<name>` 目录出现并被加入 workspace。这个手动验证不应在真实用户仓库里创建无关 worktree；若必须本地验证，请在 `/tmp` 或 `.debug/` 下建立 disposable repo。

## 验证与验收

自动化验收包括：`npm run test:extension-manifest` 通过，证明 manifest 暴露了新增 sidebar title actions 且未破坏原有 view-mode 菜单；`npm run test:sidebar-node-list` 通过，证明 root 分组行出现 root-specific actions，按钮消息正确，普通分组不出现这些 action；`npm run typecheck` 通过，证明新增 VS Code API、child process 和消息类型在 TypeScript 上成立；`git diff --check` 通过，证明没有空白错误。

用户可观察验收包括：在单根 workspace 中，`节点` section 标题栏可以添加文件夹到 workspace，并可以新建当前 root 的 worktree；在多根 workspace 中，点击全局新建 worktree 会先选择基准 root；worktree 创建 QuickPick 显示 `Create new branch...`、`Create new branch from...`、`HEAD` 与本地分支；每个 root 分组行都有新建 worktree 和移除 root 按钮，且新建 worktree 使用专用 worktree 图标；移除 root 只让它从当前 VS Code workspace 消失，不删除磁盘目录；新建 worktree 成功后，新目录加入 workspace，并由现有多根组合视图显示为新的 root section。

## 幂等性与恢复

文档、manifest 和源码修改可以重复应用。`添加文件夹到 workspace` 对已存在 workspace folder 的路径应过滤或提示，不应重复加入。`移除 root` 只调用 VS Code workspace folder 移除，不删除任何磁盘文件，因此误操作可通过 VS Code `Add Folder to Workspace` 或本扩展新入口重新添加。`新建 worktree` 可能创建磁盘目录和 git 分支；实现必须在执行 git 前提示目标路径和分支名或目标 ref，若 git 失败则不加入 workspace。若 git 已创建目录但加入 workspace 失败，应提示用户手动添加该目录，不自动删除目录，避免误删用户文件。

## 证据与备注

当前分支状态证据：

    ## sidebar-workspace-worktree-actions...origin/main

已完成的定向验证摘要：

    npm run test:sidebar-node-list
    sidebar node list tests passed

    npm run test:extension-manifest
    extension manifest tests passed

最终验证摘要：

    npm run test:extension-manifest
    extension manifest tests passed

    npm run test:sidebar-node-list
    sidebar node list tests passed

    npm run test:sidebar-list-colors
    sidebar list color token tests passed

    npm run typecheck
    tsc --noEmit

    npm run build
    node scripts/build/build.mjs

    git diff --check
    # no output

## 接口与依赖

`src/common/extensionIdentity.ts` 必须新增命令 ID：

    addFolderToWorkspace: 'devSessionCanvas.addFolderToWorkspace'
    createWorktree: 'devSessionCanvas.createWorktree'
    removeWorkspaceRoot: 'devSessionCanvas.removeWorkspaceRoot'
    createWorktreeForRoot: 'devSessionCanvas.createWorktreeForRoot'

`src/sidebar/CanvasSidebarNodeListView.ts` 的 inbound message union 必须支持：

    sidebarNodeList/createWorktreeForRoot { rootPath: string; groupId?: string }
    sidebarNodeList/removeWorkspaceRoot { rootPath: string; groupId?: string }

`src/extension.ts` 应使用 Node.js `child_process.execFile` 的 promise wrapper 调用 `git`，并设置超时与 cwd/root 参数。新建分支核心操作使用 `git -C <rootPath> worktree add -b <branchName> <targetPath> [startPoint]`；已有 ref 核心操作使用 `git -C <rootPath> worktree add [--detach] <targetPath> <ref>`。加入或移除 workspace 时必须使用 `vscode.workspace.updateWorkspaceFolders`，而不是手动编辑 `.code-workspace` 文件。

本次更新说明：2026-06-16 创建计划，明确 sidebar workspace/worktree 操作的范围、主要文件、验证方式和默认交互决策。2026-06-16 实现后更新进度、发现、结果复盘和证据摘要，记录 Webview root 行 action 与 workspace trust 决策。2026-06-16 最终验证通过后归档到 completed。2026-06-16 根据用户截图二次更新，记录专用 worktree Codicon、VS Code 风格 Create Worktree QuickPick 和既有 ref 创建路径。
