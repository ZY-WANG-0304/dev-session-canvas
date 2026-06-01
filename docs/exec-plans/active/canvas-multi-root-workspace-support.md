# 实现画布多根 workspace 支持

本 `ExecPlan` 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘`。本计划遵循 `docs/PLANS.md` 的要求；该文件定义了 ExecPlan 必须自包含、持续维护并导向可验证工作结果。

## 目标与全局图景

这次变更完成后，用户在一个 VSCode multi-root workspace 中仍然使用一张 Dev Session Canvas，但创建 `Agent` / `Terminal` 时可以明确选择 root；节点启动、重启、恢复、文件活动、路径链接和会话历史都围绕节点自己的 cwd 工作。用户可以亲眼验证：在包含 `frontend` 与 `backend` 两个 root 的窗口中，从画布右键或侧栏创建执行节点会先选择 root，Explorer 右键创建继续绑定资源目录；侧栏和 Agent 副标题显示 root-aware cwd；重载后 cwd 不丢失。

## 进度

- [x] (2026-06-01) 从最新 `origin/main` 切出 `canvas-multi-root-workspace-support` 分支，并阅读 `docs/WORKFLOW.md`、`docs/workflows/BRANCH.md`、`docs/DESIGN.md` 与 `docs/PLANS.md`。
- [x] (2026-06-01) 梳理现有 cwd / workspace folder 代码：Explorer 创建已写 metadata.cwd，Webview runtime 已有 `workspaceFolders`，执行启动已使用节点 cwd，侧栏历史仍只扫描第一个 workspace root。
- [x] (2026-06-01) 新增正式设计文档 `docs/design-docs/canvas-multi-root-workspace-support.md`、产品规格 `docs/product-specs/canvas-multi-root-workspace-support.md`，并同步索引。
- [x] (2026-06-01) 实现共享 workspace folder label helper、重复 root name 消歧，以及 Webview/Sidebar 共用规则。
- [x] (2026-06-01) 实现多根 workspace 下创建 `Agent` / `Terminal` 的 root picker：Host 命令直接选择，Webview 右键请求 Host 选择后创建，并让自动安装 Terminal 入口也在多根 workspace 下选择 root。
- [x] (2026-06-01) 实现侧栏会话历史多 root 扫描、展示和恢复 cwd 传递；缺少历史 cwd 的 multi-root restore fail closed。
- [x] (2026-06-01) 补充协议、纯函数、源码契约、Playwright harness 与 VSCode smoke 断言更新。
- [x] (2026-06-01) 运行定向验证命令并记录结果。

## 意外与发现

- 观察：Explorer 资源右键创建执行节点已经把 `cwd` 字段贯通到 `host/requestCreateNode` 与 `webview/createDemoNode`，并且 `startAgentSession` / `startTerminalSession` 当前会读取节点 metadata.cwd。
  证据：`src/panel/CanvasPanelManager.ts` 中 `applyCreateNode(...)`、`getExecutionNodeCwd(...)`、`startAgentSession(...)` 与 `startTerminalSession(...)` 已围绕 cwd 工作。
- 观察：侧栏会话历史当前仍只取 `vscode.workspace.workspaceFolders?.[0]`，恢复历史时也没有把 entry.cwd 传给新 Agent 节点。
  证据：`src/sidebar/CanvasSidebarSessionHistoryView.ts` 的 `loadSessionHistoryItems(...)` 使用单个 `workspaceRoot`，`restoreAgentSessionFromHistory(...)` 参数没有 cwd。
- 观察：当前环境根分区已满，直接依赖系统 `/tmp` 的 Node/esbuild 临时输出容易失败。
  证据：`df -h /tmp .debug/tmp` 显示 `/` 100% 使用，仓库所在 `/home` 仍有可用空间；本轮验证统一使用 `TMPDIR=$PWD/.debug/tmp`，并让 `scripts/test/test-workspace-relative-paths.mts` 使用 esbuild 内存输出。
- 观察：除普通创建入口外，安装 Agent CLI 时自动创建 Terminal 的入口也可能在 multi-root 下静默落到第一个 root。
  证据：`CanvasPanelManager.createTerminalAndRunCommand(...)` 原先直接 `applyCreateNode('terminal', ...)`，本轮改为多根 workspace 下复用 `pickExecutionWorkspaceFolder('terminal')`。

## 决策记录

- 决策：多根 workspace 下继续保持单一逻辑画布，不按 root 拆分画布状态。
  理由：产品主张是把多个 `Agent` / `Terminal` 放回同一空间化工作面；拆分画布会破坏跨 root 协作视角，并引入独立 workspace 管理器范畴。
  日期/作者：2026-06-01 / Codex
- 决策：普通创建 execution node 在多根 workspace 下显式选择 root，Explorer 创建不重复选择。
  理由：普通入口没有文件资源上下文，静默使用第一个 root 会稳定误导用户；Explorer 入口已有右键资源提供 cwd。
  日期/作者：2026-06-01 / Codex
- 决策：重复 workspace folder name 由共享 label helper 自动消歧，而不是要求用户重命名 workspace folder。
  理由：VSCode 允许重复 folder name，画布展示必须在当前输入下自洽；消歧只影响显示，不改变持久化 cwd。
  日期/作者：2026-06-01 / Codex
- 决策：历史会话恢复必须使用 transcript 中可信 cwd；multi-root 下如果恢复请求没有 cwd，则拒绝创建 Agent。
  理由：历史会话本身属于某个工程目录，静默改绑到第一个 root 会让 resume 在错误 repo 中执行。
  日期/作者：2026-06-01 / Codex
- 决策：自动安装 CLI 的 Terminal 创建也纳入 multi-root root picker，而不是只处理显式 create node 入口。
  理由：它同样会创建执行节点并运行命令；在 multi-root workspace 中静默使用第一个 root 仍会误导用户。
  日期/作者：2026-06-01 / Codex

## 结果与复盘

本轮已完成当前画布对多根 VSCode workspace 的第一版支持。画布仍保持单一共享状态；`Agent` / `Terminal` 通过持久化 metadata.cwd 绑定执行目录；普通创建、Webview 右键创建、侧栏/命令入口和自动安装 Terminal 入口在多根 workspace 下显式选择 root；Explorer 资源入口继续复用资源 cwd。root-aware label 已抽成共享 helper，并覆盖 Agent 副标题、侧栏节点列表、文件活动路径和会话历史；重复 workspace folder name 会用父级路径片段消歧。会话历史现在扫描所有当前 workspace roots，并在恢复时把历史 cwd 写入新 Agent；缺少可信 cwd 的 multi-root restore fail closed。Note workspace 链接在重复 root name 下也 fail closed，避免打开错误工程。

未执行完整 VSCode smoke 与人工 multi-root 窗口验收；当前证据来自 typecheck、build、脚本测试、协议/源码契约测试和定向 Playwright harness。设计文档因此继续标记为“验证中”，直到后续补真实 VSCode multi-root smoke 或人工记录。

## 上下文与定向

本仓库是 VSCode workspace extension。`src/panel/CanvasPanelManager.ts` 是 Host 侧画布权威状态中心，负责节点创建、持久化、执行启动、runtime supervisor 与诊断。`src/webview/main.tsx` 是 React Flow 画布，负责右键菜单、节点呈现和把创建请求发回 Host。`src/sidebar/CanvasSidebarNodeListView.ts` 与 `src/sidebar/CanvasSidebarSessionHistoryView.ts` 是侧栏投影，不持有画布权威状态。

关键共享类型位于 `src/common/protocol.ts`。`CanvasRuntimeContext.workspaceFolders` 已经把 workspace folder name/path 发给 Webview；`AgentNodeMetadata.cwd` 和 `TerminalNodeMetadata.cwd` 是执行节点 cwd 的持久化权威。`src/common/executionCwdLabel.ts` 当前提供 Agent 副标题和侧栏 Agent 行使用的 cwd label；本轮需要扩展它以支持重复 folder name 消歧，并让 Terminal 侧栏也使用它。

“multi-root workspace”在本文中指 VSCode 一个窗口中有多个 `vscode.workspace.workspaceFolders`。这不是本仓库 monorepo 的 `npm workspaces`，也不是产品层的独立 workspace 管理系统。

## 工作计划

先修改共享 helper。扩展 `src/common/executionCwdLabel.ts`，增加 workspace folder label 消歧逻辑，保持单根行为不变；同时让 `resolveContainedWorkspaceRelativePath(...)` 接受可选 display name 或新增一个 wrapper，用于多根文件活动路径前缀消歧。

然后修改创建链路。`src/common/protocol.ts` 为 `webview/createDemoNode` 增加 `requiresWorkspaceFolderSelection?: boolean`，parse 时校验 boolean。`src/webview/main.tsx` 在多根 workspace 且创建 `agent` / `terminal` 且没有 cwd 时，把该字段设为 true，并提示 Host 做最终选择。`src/extension.ts` 的命令面板创建入口在 reveal 前为 execution node 选择 root；`CanvasPanelManager.handleWebviewMessage(...)` 收到该字段时由 Host 弹 Quick Pick，选择后调用 `applyCreateNode(...)`，不再依赖 Webview 再发第二条消息。

随后修改侧栏。`src/sidebar/CanvasSidebarNodeListView.ts` 对 Terminal 也显示 cwd label。`src/sidebar/CanvasSidebarSessionHistoryView.ts` 把 `workspaceRoot` 改为 `workspaceRoots`，调用 `listWorkspaceAgentSessionHistory(...)` 扫描所有 root，并在 item 中保存 cwd；Webview 和 Quick Pick 恢复时把 cwd 传回 `CanvasPanelManager.restoreAgentSessionFromHistory(...)`。

最后补测试和文档状态。扩充 `scripts/test/test-workspace-relative-paths.mts`、`scripts/test/test-protocol-webview-messages.mts`、`scripts/test/test-sidebar-session-history.mjs`、`scripts/test/test-canvas-execution-context.mjs`、`scripts/test/test-note-markdown-links.mts` 和必要的 Playwright harness 用例。实现完成后运行定向测试、typecheck、build 与 `git diff --check`。

## 具体步骤

在仓库根目录执行以下修改与验证：

    TMPDIR=$PWD/.debug/tmp npm run test:workspace-relative-paths
    TMPDIR=$PWD/.debug/tmp npm run test:protocol-webview-messages
    TMPDIR=$PWD/.debug/tmp npm run test:sidebar-session-history
    TMPDIR=$PWD/.debug/tmp npm run test:canvas-execution-context
    TMPDIR=$PWD/.debug/tmp npm run test:note-markdown-links
    TMPDIR=$PWD/.debug/tmp npm run test:extension-manifest
    TMPDIR=$PWD/.debug/tmp npm run typecheck
    TMPDIR=$PWD/.debug/tmp npm run build
    git diff --check

如果修改 Webview 右键创建交互，补跑定向 Playwright：

    TMPDIR=$PWD/.debug/tmp npm run test:webview -- --grep "multi-root canvas execution creation|multi-root canvas note creation|host-triggered execution"

## 验证与验收

成功标准是：单根 workspace 既有测试保持通过；多根 workspace 下普通创建 execution node 会选择 root 并写入 metadata.cwd；Explorer 创建不重复选择；Agent 副标题和侧栏节点列表显示 root-aware cwd；会话历史覆盖多个 root 并在恢复时保留 cwd；重复 root name 的 label 不重复；workspace folder 变化后 Webview runtime 和 sidebar 刷新。

## 幂等性与恢复

文档和代码修改可重复运行测试验证。root picker 只在用户触发创建时显示，不改变已有节点。若 root picker 或 label 消歧出现问题，优先收敛共享 helper 和创建参数，不回滚 Explorer cwd 基础能力。不要使用 `git reset --hard` 或丢弃未确认用户改动。

## 证据与备注

本轮验证记录如下，命令均在仓库根目录执行。因为系统 `/tmp` 所在根分区已满，所有 Node/Playwright 相关验证都显式使用仓库内 `.debug/tmp` 作为 `TMPDIR`。

    TMPDIR=$PWD/.debug/tmp npm run test:workspace-relative-paths
    TMPDIR=$PWD/.debug/tmp npm run test:protocol-webview-messages
    TMPDIR=$PWD/.debug/tmp npm run test:sidebar-session-history
    TMPDIR=$PWD/.debug/tmp npm run test:canvas-execution-context
    TMPDIR=$PWD/.debug/tmp npm run test:note-markdown-links
    TMPDIR=$PWD/.debug/tmp npm run test:extension-manifest

    protocol webview message tests passed
    canvas execution context tests passed
    note markdown link tests passed
    extension manifest tests passed

    TMPDIR=$PWD/.debug/tmp npm run build
    > node scripts/build/build.mjs

    TMPDIR=$PWD/.debug/tmp npm run test:webview -- --grep "multi-root canvas execution creation|multi-root canvas note creation|host-triggered execution"
    4 passed
    Playwright webview tests passed.

    TMPDIR=$PWD/.debug/tmp npm run typecheck
    > tsc --noEmit

    git diff --check
    # 无输出，表示 whitespace 检查通过。

## 接口与依赖

需要新增或稳定以下接口：

`src/common/protocol.ts`：

    webview/createDemoNode.payload.requiresWorkspaceFolderSelection?: boolean

`src/panel/CanvasPanelManager.ts`：

    createNode(kind, { cwdOverride }) 继续作为 Host 命令入口；Webview 请求 Host root picker 后由 Host 内部调用 applyCreateNode。
    restoreAgentSessionFromHistory({ provider, sessionId, title, cwd }) 使用历史 cwd 创建 Agent。

`src/common/executionCwdLabel.ts`：

    formatExecutionCwdLabel(cwd, workspaceFolders) 在多根与重复 name 下返回稳定可区分 label。

`src/common/agentSessionHistory.ts`：

    listWorkspaceAgentSessionHistory({ workspaceRoots }) 或兼容扩展，扫描多个 root 并只纳入 cwd 属于任一 root 的历史。

本次更新说明：2026-06-01 新建计划，记录从 Explorer cwd 基础能力推进到 multi-root workspace 支持的正式范围、设计决策、实现顺序与验证口径。

本次更新说明：2026-06-01 完成实现后更新计划，把 root picker、cwd 权威、label 消歧、会话历史多 root、Note 链接 fail closed、验证命令和 `/tmp` 空间约束写入活文档。
