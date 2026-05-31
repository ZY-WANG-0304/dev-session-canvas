# 实现 File Explorer 资源右键创建执行节点

本 `ExecPlan` 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘`。本计划遵循 `docs/PLANS.md` 的要求，目标是让一个不了解前序讨论的协作者也能从当前工作树继续完成实现。

## 目标与全局图景

本次变更让用户可以在 VSCode File Explorer 中右键 workspace 内目录或普通文件，直接在 Dev Session Canvas 中创建绑定该目录上下文的 `Terminal` 或 `Agent` 节点。对文件资源，系统使用文件父目录作为 cwd。完成后，节点的 `metadata.terminal.cwd` 或 `metadata.agent.cwd` 会保存目标目录，首次启动、后续重启、live-runtime supervisor、Agent CLI 解析、shell env patch、诊断事件和侧栏展示都会使用该节点自己的 cwd。

用户可观察的结果是：在 Explorer 里对 `src/` 选择“在 Canvas 中创建 Terminal”后，新 Terminal 的启动诊断 cwd 是 `src/`；对 `src/index.ts` 选择“在 Canvas 中创建 Agent”后，新 Agent 的 metadata cwd 是 `src/`，画布副标题和侧栏第二行显示类似 `src · Codex · idle` 的目录上下文。

## 进度

- [x] (2026-05-31 12:30 +0800) 从 `origin/main` 新建干净分支 `canvas-explorer-resource-execution-nodes`，并确认旧 `docs-canvas-node-grouping-design` 分支实际内容是 Explorer 资源创建执行节点而非画布分组实现。
- [x] (2026-05-31 12:45 +0800) 重新收口产品规格、设计文档和本实现计划，明确本轮不纳入普通创建入口多根 root picker 或单根扩容多根 storage fork。
- [x] (2026-05-31 13:00 +0800) 扩展 manifest、命令 ID 与 package nls，注册 Explorer 资源创建 Terminal / Agent 入口。
- [x] (2026-05-31 13:10 +0800) 扩展 Host/Webview 创建协议，携带可选 cwd，并在创建 fallback 路径中保留 cwd。
- [x] (2026-05-31 13:25 +0800) 修改宿主创建与启动管线，使执行节点创建和后续启动都使用节点 metadata.cwd。
- [x] (2026-05-31 13:35 +0800) 增加 cwdLabel 派生 helper，并同步 Agent 画布副标题与侧栏第二行展示。
- [x] (2026-05-31 13:45 +0800) 补充协议、manifest、路径 helper、Playwright 与 VSCode smoke 覆盖。
- [x] (2026-05-31 13:55 +0800) 运行验证命令并记录结果。
- [x] (2026-06-01 00:11 +0800) 处理 PR review：相对 `terminal.shellPath` 改按 workspace/configuration cwd 解析，默认执行 metadata cwd 改为 canonical workspace cwd，workspace folder 变化强制刷新 Webview/侧栏上下文，并补 execution context 与 smoke 回归。

## 意外与发现

- 观察：旧分支名为 `docs-canvas-node-grouping-design`，但相对 `origin/main` 的 10 个提交全部围绕 Explorer 资源右键创建执行节点、节点 cwd 和多根 workspace storage fork。
  证据：`git log --oneline origin/main..docs-canvas-node-grouping-design` 显示提交主题包括 `支持 Explorer 资源创建执行节点`、`保留单根扩容多根时的当前画布`、`通过 cwd 线索恢复 Untitled 多根画布`。
- 观察：VSCode `FileType` 是 bitmask，symlinked file / directory 可能同时包含 `SymbolicLink` 和 `File` / `Directory`。
  证据：Explorer 资源解析与 cwd 校验使用 `(stat.type & vscode.FileType.Directory) !== 0` / `(stat.type & vscode.FileType.File) !== 0`，避免 equality 判断误拒绝 symlinked 资源。
- 观察：`vscode.workspace.getWorkspaceFolder(vscode.Uri.file(cwd))` 在某些文件 URI 比较场景下可能偏保守。
  证据：宿主侧 Explorer 解析和执行 cwd 校验都增加了 path containment fallback，仍以 workspace 文件夹列表为边界，不扩大到 workspace 外路径。
- 观察：live-runtime supervisor 分支原本可以拿到 snapshot cwd，但没有向诊断流补齐 `execution/started.cwd`。
  证据：Agent / Terminal supervisor start 成功后现在显式记录 `execution/started`，内容包含 `cwd`、runtime backend 与 guarantee。
- 观察：Webview 的 `OverflowAwareText` 会在布局后异步设置 `title`，Playwright 不能立即断言副标题 title。
  证据：新增的 Agent 副标题测试使用 `expect.poll(() => subtitle.getAttribute('title'))` 等待包含完整 cwd 与启动命令的 title。
- 观察：Explorer 创建 Terminal 后，进程 cwd 和 shell executable 的解析基准不能共用同一个 cwd。
  证据：review 指出 `devSessionCanvas.terminal.shellPath=./tooling/dev-shell` 这类 workspace-relative wrapper 会在 Explorer cwd 为 `packages/app` 时错误寻找 `packages/app/tooling/dev-shell`；本轮新增 `scripts/test/test-canvas-execution-context.mjs` 与 VSCode smoke 断言 shell path 为 `<workspace>/.debug/vscode-smoke/relative-shell/dev-shell`，而 `execution/started.cwd` 仍为 Explorer 目标目录。
- 观察：默认 metadata cwd 与启动时 legacy fallback 不一致会先污染显示，再在启动时被纠偏。
  证据：review 指出 `createAgentMetadata()` / `createTerminalMetadata()` 仍写 HOME；本轮将默认 metadata cwd 改为 workspace root，并在 `normalizeState()` / workspace folder 变化时迁移旧 HOME 默认 cwd。

## 决策记录

- 决策：本轮只重新实现 Explorer 资源右键创建执行节点的主功能，不照搬旧分支中的多根 workspace storage fork / canonical slot 纠偏系列提交。
  理由：用户明确认为旧分支中间走了很多弯路；storage fork 问题显著扩大范围，且不是 Explorer 右键创建节点成立的最小必要条件。按 AGENTS.md 要求，未确认内容不能写成已确认结论，因此先交付可验证的资源入口、cwd 持久化和启动语义。
  日期/作者：2026-05-31 / Codex

- 决策：采用宿主解析 Explorer URI 并通过 `cwdOverride` 进入统一创建管线，而不是让 Webview 自行决定 cwd。
  理由：cwd 是执行安全、启动、诊断和持久化权威的一部分，必须留在 Extension Host；Webview 只负责视口落点，且 Webview 未 ready 时不能丢失资源上下文。
  日期/作者：2026-05-31 / Codex

- 决策：第一版 Explorer 入口只接受 `file` scheme，并要求最终 cwd 位于当前 workspace 内。
  理由：该入口来自 VSCode Explorer 的明确文件资源上下文；虚拟文件系统和 workspace 外路径会引入执行信任、PTY cwd 与 provider 配置边界，不属于本轮已确认范围。
  日期/作者：2026-05-31 / Codex

- 决策：创建时校验 cwd，启动或重启时再次校验 metadata cwd；后续 cwd 不可用时进入错误态，不静默回退 workspace 根目录。
  理由：节点 cwd 是执行上下文承诺，静默回退会让 Agent / Terminal 在错误目录执行。唯一兼容例外是旧持久化节点中历史默认 HOME cwd：若它不在当前 workspace 内，则映射到当前 workspace root，避免旧状态全部启动失败。
  日期/作者：2026-05-31 / Codex

- 决策：新增独立 `src/common/executionCwdLabel.ts` 生成 Agent 副标题和侧栏 cwdLabel，而不是复用文件节点相对路径 helper。
  理由：执行 cwd 标签需要同时覆盖单根、多根、workspace root、workspace 外 fallback、Windows drive / backslash 与 tooltip 完整路径展示，语义与文件节点路径展示不完全相同。
  日期/作者：2026-05-31 / Codex

- 决策：Terminal shell executable 使用 workspace/configuration cwd 解析，执行进程 cwd 使用节点 metadata cwd。
  理由：`terminal.shellPath` 是用户配置项，显式相对路径代表 repo-local wrapper；Explorer cwd 只应影响启动进程所在目录，不应改变 shell wrapper 本身的查找位置。shell env probe、local PTY 和 runtime supervisor 必须接收同一个已解析 shell path。
  日期/作者：2026-06-01 / Codex

- 决策：默认执行 metadata cwd 的 canonical source 是第一个 workspace folder；历史 HOME 默认 cwd 仅在不属于当前 workspace 时迁移。
  理由：新节点和预启动 cwdLabel 应与后续启动路径一致；但若用户的 workspace 本身就是 HOME，不能把合法 HOME cwd 误判成遗留值。
  日期/作者：2026-06-01 / Codex

## 结果与复盘

已完成从 `origin/main` 重新实现 Explorer 资源右键创建执行节点的最小闭环。新分支只包含资源入口、cwd 持久化、启动 / supervisor / 诊断 cwd 传递、Agent 可见标签和测试覆盖；未搬运旧分支里的多根 workspace storage fork / canonical slot 纠偏路线。PR review 后又补齐执行 cwd、shell executable 解析、metadata 默认值和 workspace folder runtime context 刷新的同源约束。

复盘要点：本轮把资源解析、workspace containment、cwd 校验和启动拒绝都留在 Extension Host，避免 Webview 成为执行上下文权威；Webview 只负责当前视口落点并原样回传 cwd。实现中额外发现 `FileType` bitmask、`getWorkspaceFolder` 保守匹配、supervisor started diagnostics、相对 shell path 基准和旧默认 cwd 显示五个边界，均已补齐。剩余风险是非 `file` scheme、workspace 外路径和普通创建入口 root 选择仍刻意不支持，需要后续单独立项。

## 上下文与定向

本仓库是 VSCode workspace extension。`src/extension.ts` 注册命令和 Quick Input，`src/panel/CanvasPanelManager.ts` 是宿主权威状态中心，`src/common/protocol.ts` 定义 Host 与 Webview 消息，`src/webview/main.tsx` 负责画布渲染和当前视口落点，`src/sidebar/CanvasSidebarNodeListView.ts` 负责侧栏节点列表投影。

当前节点已有 `metadata.agent.cwd` 与 `metadata.terminal.cwd` 字段。Explorer 资源入口把 cwd 写入 metadata，并让后续启动从 metadata 读取。`cwdLabel` 是显示投影，不进入持久化；实现使用 `src/common/executionCwdLabel.ts` 从节点 cwd 和 runtime context 中的 workspace folder 列表派生。

## 工作计划

先新增文档、命令 ID 和 manifest 入口，确保功能入口可追踪。然后扩展协议，让 `host/requestCreateNode` 和 `webview/createDemoNode` 都能携带可选 `cwd`。接着修改 `CanvasPanelManager.createNode()`、`applyCreateNode()` 和 `createNextState()`，在创建 Agent / Terminal 时写入 metadata.cwd，并在 Webview 未 ready fallback 时同样生效。随后改 `startAgentSession()`、`startTerminalSession()` 及 supervisor 分支，让它们读取节点 metadata.cwd，并把 cwd 传入 Agent CLI 解析、shell env patch 和 execution launch spec。最后补 cwdLabel helper 与前端/侧栏展示，再补测试和验证记录。

## 具体步骤

已按以下顺序完成。所有命令都在仓库根目录 `/home/users/ziyang01.wang-al/projects/dev-session-canvas.worktrees/dev-session-canvas2` 执行。

1. 新增产品规格、设计文档和本 ExecPlan，并同步索引。
2. 新增 Explorer context menu 命令、nls 标题和命令 ID。
3. 在 `src/extension.ts` 解析 Explorer `file` URI：目录直接作为 cwd，普通文件解析为父目录；资源和最终 cwd 均校验存在、目录类型和 workspace containment。
4. 扩展 Host/Webview 协议，让 `host/requestCreateNode` 与 `webview/createDemoNode` 携带可选 `cwd`。
5. 扩展 `CanvasPanelManager` 创建、fallback、测试命令、启动、重启、runtime supervisor、Agent CLI resolver、shell env patch 和 diagnostics，使执行节点使用 metadata cwd。
6. 新增 `src/common/executionCwdLabel.ts` 并接入 Agent 画布副标题、tooltip 与侧栏节点列表第二行。
7. 补充协议、manifest、路径 helper、Playwright 与 VSCode trusted smoke 覆盖。

## 验证与验收

自动化验收覆盖：

- manifest 中存在两个 Explorer context menu 项，且 `when` 包含 `resourceScheme == file`。
- `parseWebviewMessage` 接受 `webview/createDemoNode.payload.cwd`，拒绝非字符串 cwd。
- `executionCwdLabel` helper 能在单根 workspace 显示 `src`，在多根 workspace 显示 `root/src`。
- 通过测试命令或 smoke 创建带 cwdOverride 的 Agent / Terminal 后，metadata.cwd 等于目标目录，启动 diagnostic 中 cwd 也等于目标目录。
- Agent Webview 副标题和侧栏第二行包含 cwdLabel；Terminal 副标题不包含 cwdLabel。

手动验收可按以下路径：打开一个 trusted workspace，在 Explorer 中右键目录创建 Terminal，确认新节点启动后 `pwd` 为该目录；右键文件创建 Agent，完成 Quick Input 后确认 Agent 节点副标题显示文件父目录的短标签。

已运行验证：

- `npm run typecheck`：通过。
- `npm run test:protocol-webview-messages`：通过。
- `npm run test:workspace-relative-paths`：通过。
- `npm run test:canvas-execution-context`：通过。
- `npm run test:extension-manifest`：通过。
- `node --check tests/vscode-smoke/extension-tests.cjs && node --check tests/playwright/webview-harness.spec.mjs`：通过。
- `npm run build`：通过。
- `node scripts/test/run-playwright-webview.mjs -g "agent subtitle shows cwd label|host-triggered execution node creation echoes cwd"`：2 项通过。
- `npm run build:notifier && DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=trusted npm run test:smoke`：通过，输出 `Trusted workspace smoke passed.` / `VS Code smoke test passed.`。
- `git diff --check`：通过。

Review 修复后重新运行：

- `npm run typecheck`：通过。
- `npm run test:canvas-execution-context`：通过。
- `npm run test:workspace-relative-paths`：通过。
- `npm run test:protocol-webview-messages`：通过。
- `npm run test:extension-manifest`：通过。
- `npm run build`：通过。
- `node --check tests/vscode-smoke/extension-tests.cjs`：通过。
- `git diff --check`：通过。
- `npm run build:notifier && DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=trusted npm run test:smoke`：通过，输出 `Trusted workspace smoke passed.` / `VS Code smoke test passed.`。

## 幂等性与恢复

新增命令和协议字段是向后兼容的：旧 Webview 不发送 cwd 时仍使用默认 workspace root；旧持久化状态已有 metadata.cwd 字段，normalize 会保留。Explorer 资源解析失败只显示 warning，不修改画布状态。若实现中断，重新运行测试不会修改持久化业务数据；VSCode smoke 使用测试 workspace。

## 证据与备注

当前已确认旧分支差异：

    $ git log --oneline origin/main..docs-canvas-node-grouping-design
    997712c fix(canvas): 避免 workspaceState 阻断 canonical 纠偏
    ...
    c557c6d feat(canvas): 支持 Explorer 资源创建执行节点
    80d9748 docs(canvas): 记录 Explorer 资源创建执行节点方案

## 接口与依赖

`src/common/protocol.ts` 中创建消息需要支持：

    webview/createDemoNode.payload.cwd?: string
    host/requestCreateNode.payload.cwd?: string

`src/panel/CanvasPanelManager.ts` 中创建选项需要支持：

    cwdOverride?: string

启动相关 helper 需要显式接收 cwd：

    resolveExecutionEnvironment(target, cwd)
    resolveAgentCli(provider, requestedCommand, cwd)
    startAgentSessionWithSupervisor(..., cwd)
    startTerminalSessionWithSupervisor(..., cwd)

本次修订说明：2026-05-31 从旧分支差异中剥离出 Explorer 资源创建执行节点的最小功能范围，并创建实现计划以替代旧分支中混入的多根 storage fork 路线。2026-05-31 完成实现、测试覆盖与验证记录，保留后续非 `file` scheme / 普通创建 root picker / storage fork 为独立议题。2026-06-01 按 PR review 收口 execution cwd、shell path 和 workspace runtime context 同源问题。
