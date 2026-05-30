# Explorer 资源创建执行节点实现

本 `ExecPlan` 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘` 这几个章节。

本文遵循 `docs/PLANS.md` 的要求；仓库中的 `ExecPlan` 必须自包含、持续更新，并导向可验证的工作结果。

## 目标与全局图景

这次实现要让用户可以从 VSCode File Explorer 的目录或普通文件右键菜单直接在 Dev Session Canvas 中创建 `Terminal` 或 `Agent` 节点。目录右键时，新节点的工作目录就是该目录；普通文件右键时，新节点的工作目录是该文件父目录。用户完成后可以在 Explorer 对 `packages/api/src` 右键创建 Terminal，打开的嵌入终端会直接在 `packages/api/src` 启动，而不需要再手动 `cd`。

同一轮还要收口多根 workspace 的普通创建入口。用户通过命令面板、侧栏或画布空白区创建 `Terminal` / `Agent` 时，如果当前窗口有多个 workspace root，扩展必须先让用户确认 root；确认后所选 root 写入节点 metadata 并用于启动。单根 workspace 不增加额外步骤。Explorer 资源右键入口不重复询问 root，因为资源 URI 已经明确了 cwd。

用户可观察的成功结果有四类：Explorer 菜单出现两个创建命令；目录和普通文件都能创建带正确 cwd 的执行节点；Agent 标题副标题和侧栏节点列表能显示 cwdLabel；多根 workspace 普通创建入口会让用户确认 root 而不是静默使用第一个 root。

## 进度

- [x] (2026-05-29 00:10 +0800) 提交设计与产品规格文档，提交号 `ac4a614`，为实现阶段留下正式范围。
- [x] (2026-05-29 00:20 +0800) 阅读 `docs/WORKFLOW.md`、`docs/PLANS.md`、正式规格和设计文档，确认这是跨宿主命令、共享协议、Webview 展示、侧栏与 smoke 测试的复杂实现，需要独立 `ExecPlan`。
- [x] (2026-05-29 00:25 +0800) 新建本实现 `ExecPlan`，记录目标、上下文、工作切片、验证与恢复策略。
- [x] (2026-05-29 00:40 +0800) 梳理现有创建节点、Agent Quick Input、Terminal / Agent 启动 cwd、sidebar 投影和测试接口，补充本计划的发现。
- [x] (2026-05-29 01:10 +0800) 实现 Explorer 资源命令、cwd 解析与多根普通入口 root 确认。
- [x] (2026-05-29 01:10 +0800) 扩展共享协议和节点创建管线，让 cwdOverride 写入 `metadata.terminal.cwd` / `metadata.agent.cwd` 并贯穿启动、重启和诊断。
- [x] (2026-05-29 01:10 +0800) 实现 Agent cwdLabel 展示和侧栏 Agent 第二行 `cwdLabel · provider · 状态`。
- [x] (2026-05-29 01:35 +0800) 补充自动化验证，覆盖 cwdLabel 纯函数、协议 cwd 字段、manifest Explorer 菜单、Webview Agent/Terminal 展示，以及 VSCode smoke 中 Explorer 目录/普通文件创建和普通创建默认 root。
- [x] (2026-05-29 01:56 +0800) 运行定向测试、类型检查、diff 检查和 trusted smoke，记录证据；未发现需要登记的新增技术债。
- [x] (2026-05-29 09:29 +0800) 根据用户实测确认：VSCode `Add Folder to Workspace...` 从单根扩容到多根时会提示 reload，扩展宿主重启后不会触发运行期 `onDidChangeWorkspaceFolders` 分支，上一版只保留内存 Canvas 的实现覆盖不足。
- [x] (2026-05-29 10:15 +0800) 补充 startup / reload 路径：Untitled 多根 workspace 的当前持久化槽为空时，从原单根 root 的最新持久化快照 fork `canvas-state.json` 到当前槽；fork 后清理旧 `workspaceState` Canvas 兜底字段，避免兜底状态覆盖新快照。
- [x] (2026-05-29 10:15 +0800) 更新产品规格、设计文档与本计划，区分运行期纯新增 root 和 VSCode reload 两条扩容路径。
- [x] (2026-05-29 10:15 +0800) 增加存储选择单元测试，验证普通 unrelated hash 不被 freshness 恢复，同时 Untitled 多根显式扩容路径可按第一个 root 名称选择单根快照，且空当前快照可覆盖、有节点当前快照不可覆盖。
- [x] (2026-05-29 10:15 +0800) 运行 `npm run test:extension-storage-paths`、`npm run typecheck`、`git diff --check`，三项均通过；本轮未补跑 VSCode smoke，因为核心新增逻辑已抽成无 VSCode 依赖的 storage helper，并用单元测试覆盖选择边界。
- [x] (2026-05-29 18:35 +0800) 回应用户新的实测前复查：上一版没有跑真实 `Add Folder to Workspace...` UI reload 路径；只验证了 storage helper、typecheck、以及 CLI `code rootA rootB` 式 Untitled 多根启动时手动激活后可 fork。
- [x] (2026-05-29 18:38 +0800) 补跑启动激活实验：在 Untitled 多根窗口中不主动打开 Canvas 时，扩展 20 秒内保持 `active:false`，测试命令未注册；因此启动期 fork 没有机会运行，符合“Panel 卡加载 / 画布打不开”的用户现象。
- [x] (2026-05-29 18:42 +0800) 试验只增加 `onView:devSessionCanvas.canvasPanel` 后，Untitled 多根启动仍保持 inactive；说明 VSCode 只有在 WebviewView 真正被解析/展开时才触发 view activation，无法覆盖 reload 后仅有 Panel 入口或 loading 占位的情况。
- [x] (2026-05-29 18:44 +0800) 增加 `onStartupFinished` 后补跑同一启动实验：扩展在启动完成后 active，诊断出现 `storage/untitledMultiRootForkApplied`，Untitled 多根 slot 成功加载单根源节点；同时未自动 reveal Webview，`surfaceReady.panel` 仍为 false。
- [x] (2026-05-29 18:51 +0800) 更新产品规格、Explorer 创建执行节点设计、Canvas surface placement 设计和 manifest 测试，正式记录 `onStartupFinished` 仅用于 provider 注册与 Untitled 多根 fork，不使用 `*`，不自动抢焦点。
- [x] (2026-05-29 20:18 +0800) 针对“点击 Canvas 后仍卡住”的路径补跑验证：Untitled 多根 startup 后先等待 `onStartupFinished` 激活和 fork，再执行 VSCode contributed view 命令 `devSessionCanvas.canvasPanel.open`，Panel Webview 成功 attached / rendered / ready，并能看到 fork 后的节点。
- [x] (2026-05-29 23:58 +0800) 根据用户最新实测确认：Canvas 已能打开，但 fork 没拿到第一目录的旧画布，而是应用内置使用说明模板。复查本机真实 `~/.vscode-server/data/User/workspaceStorage` 发现多个有画布快照的 slot 没有 `meta.json`，现有源选择只看 `meta.name === workspaceFolders[0].name`，因此会返回 `no-source`。
- [x] (2026-05-30 00:08 +0800) 实现受限 fallback：`selectUntitledMultiRootWorkspaceStorageForkSource(...)` 在没有第一个 root 名称匹配时，会从候选快照的 Agent / Terminal `cwd`、`runtimeStoragePath`、`resumeStoragePath` 提取路径线索，选择唯一命中第一个 root 的非内置模板快照；同时让当前 Untitled 多根槽里的内置使用说明模板不阻止 fork。
- [x] (2026-05-30 00:12 +0800) 补跑真实 VSCode 启动 smoke 的缺失 `meta.json` 场景：先写入第一 root 的 Agent cwd 快照，再删除所有相关 `meta.json`，以 Untitled 多根启动并打开 Panel Canvas；验证 fork event 使用 `first-root-path-hint`，打开前后节点标题均为 `Path Hint Fork Source`。
- [x] (2026-05-30 01:16 +0800) 复查用户最新诊断目录 `/home/users/ziyang01.wang-al/projects/dsc-test-02/.debug/current-host-diagnostics/2026-05-29T16-42-47-093Z`，确认上一版确实 fork 了旧状态：`storage/untitledMultiRootForkApplied` 选中 `21dd04231c926988e6dcf73d7f627c40-2`，而同 family 的 canonical slot `21dd04231c926988e6dcf73d7f627c40` 有更新的 3 节点快照。
- [x] (2026-05-30 01:16 +0800) 更新 Untitled 多根 fork 源选择：路径线索只作为证据；若证据来自 `<slot>-N` indexed sibling，或证据快照里的 `runtimeStoragePath` / `resumeStoragePath` 指向某个 canonical workspaceStorage slot，则实际 fork 源优先使用该 canonical slot 的可恢复快照，避免陈旧 indexed sibling 或已复制到当前 Untitled 槽的旧快照继续覆盖第一 root 当前画布。
- [x] (2026-05-30 01:16 +0800) 补充存储 helper 测试，覆盖 canonical slot 优先于陈旧 indexed path-hint sibling、runtime storage slot hint 优先于较新的复制证据、canonical 缺失时仍允许 indexed sibling fallback；并同步产品规格、设计文档和本计划。
- [x] (2026-05-30 22:05 +0800) 根据 PR review 修正“当前 Untitled 多根槽已有错误 fork 快照”路径：有意义的当前槽不再一律短路；若其 cwd 命中第一 root 且 runtime/resume 指向可恢复 canonical 单根 slot，则当前槽只作为证据，实际源切回 canonical slot。同步补充 current-slot copied evidence 单元测试和文档边界。

## 意外与发现

- 观察：普通创建入口在 `src/extension.ts` 的 `COMMAND_IDS.createNode` 中先运行 `promptCreateNodeRequest(...)`，Agent 的 provider / preset / custom command 选择也都在这里完成；因此多根 workspace root 确认应插在创建类型确定之后、进入 Agent 启动命令 Quick Input 之前，而不是放到 `CanvasPanelManager` 深处。
  证据：`src/extension.ts` 中 `promptCreateNodeRequest(...)` 会对 Agent 再调用 `promptAgentLaunchRequest(...)`；测试 QuickPick 队列 `queuedQuickPickSelectionIds` 目前只认识创建类型与 Agent launch 选择。

- 观察：`CanvasPanelManager.createNode(...)` 已经支持“Webview ready 时发 `host/requestCreateNode` 让前端计算落点，否则直接 `applyCreateNode(...)`”的双路径，但消息 payload 当前没有 cwd 字段。
  证据：`src/panel/CanvasPanelManager.ts` 的 `createNode(...)` 只传 `kind` 与 Agent launch 字段，`handleActiveWebviewMessage(...)` 收到 `webview/createDemoNode` 后也只把这些字段传给 `applyCreateNode(...)`。

- 观察：现有 Terminal / Agent 启动路径多处重新调用 `getTerminalWorkingDirectory()`，这会在多根 workspace 下回到第一个 root，覆盖节点 metadata 中已经存在的 cwd。
  证据：`startAgentSessionWithSupervisor(...)`、`startTerminalSessionWithSupervisor(...)`、`startAgentSession(...)`、`startTerminalSession(...)`、`resolveAgentCli(...)`、`resolveExecutionEnvironment(...)` 和 `getResolvedShellEnvironmentPatch(...)` 都有直接或间接使用 `getTerminalWorkingDirectory()` 的路径。

- 观察：Agent CLI cache key 已经包含 `workspaceCwd`，但 `resolveAgentCli(...)` 总是传默认 workspace cwd；shell env patch cache 仍只按 probe mode 分组，需要纳入目标 cwd，避免 direnv、Nix 或 repo-local hook 在不同 cwd 下串用结果。
  证据：`getAgentCliResolutionCacheKey(...)` 注释已经说明 env 可能 cwd-sensitive；`resolvedShellEnvironmentPatchPromises` / `resolvedShellEnvironmentPatches` 当前是 `Map<ShellEnvironmentProbeMode, ...>`。

- 观察：Webview 当前没有 Node `path` polyfill，不能直接复用 `src/common/workspaceRelativePath.ts`；但宿主侧和侧栏可以使用该 helper。前端需要浏览器安全的 cwdLabel 字符串算法，或者使用新增的共享无 Node 依赖 helper。
  证据：`src/webview/main.tsx` 已经是 browser bundle；现有 `workspaceRelativePath.ts` 引入 Node `path`。

- 观察：侧栏节点列表投影目前是纯函数 `getCanvasSidebarNodeListItems(source)`，没有 workspace folder 参数，并且 Agent 第二行只拼 provider；要生成 cwdLabel，函数需要可选 workspace folders 参数，同时保持现有调用在没有参数时可回退到 `vscode.workspace.workspaceFolders`。
  证据：`buildSidebarNodeSubtitlePrefix(node)` 当前直接返回 `humanizeAgentProvider(node.metadata?.agent?.provider)`。

- 观察：`webview/resetDemoState` 是 fire-and-forget，不能保证后续断言开始前已有执行 session 完全终止；带执行节点的 smoke 测试若紧接着断言空状态，可能看到 `state.nodes` 已清空但 `runningExecutionCount` 仍未归零。
  证据：`CanvasPanelManager.handleActiveWebviewMessage(...)` 中 `webview/resetDemoState` 分支使用 `void this.resetState().catch(...)`；本轮 smoke 改用 `COMMAND_IDS.testResetState`，并等待 `state.nodes.length === 0 && sidebar.runningExecutionCount === 0`。

- 观察：VSCode 官方 API 注释明确说明，当第一个 workspace folder 被添加、移除或改变时，`onDidChangeWorkspaceFolders` 不会触发，因为当前扩展会被终止并重启；用户实测 `Add Folder to Workspace...` 正落在这个路径上，出现 `Cannot reconnect. Please reload the window.` 后，新的 Untitled 多根 workspace 获得新的 `context.storageUri`。
  证据：`docs/references/vscode-official-extension-docs/api/references/generated/vscode.d.ts` 中 `workspaceFile` 说明 Untitled workspace 使用 `untitled:` scheme，`onDidChangeWorkspaceFolders` 注释说明第一 folder 变化会导致扩展重启；用户截图显示窗口标题为 `Untitled (Workspace)` 且扩展宿主提示 reload。

- 观察：启动期 fork 如果只写 `canvas-state.json`，仍需要防止旧 `workspaceState` 作为兜底参与后续加载；虽然正常 VSCode 新 storage slot 的 `workspaceState` 应为空，但测试和历史异常状态可能留下节点。
  证据：`CanvasPanelManager.loadState()` 的读取顺序是 `snapshot?.state ?? workspaceState`；本轮实现只在当前 `workspaceState` 没有有意义节点时允许 fork，并在 fork 成功后清理 `canvasState`、`canvasLastSurface` 和 `canvasTemplateInitialized` 兜底键。

- 观察：真实 `Add Folder to Workspace...` 触发的是扩展宿主重启 / Untitled 多根 startup 路径，不等价于运行期 `vscode.workspace.updateWorkspaceFolders(...)`，也不等价于测试里先 `activateVisibleExtension()` 再执行恢复命令。
  证据：`.debug/add-folder-repro/run-add-folder-repro.mjs` 的运行期新增 root 能保留节点，但用户截图和 VSCode API 注释说明“第一个 workspace folder 被添加/移除/改变”会终止并重启扩展宿主；启动后如果扩展未激活，恢复逻辑不会执行。

- 观察：只依赖 Panel view 的 `onView` 激活不足以覆盖 reload 后的用户路径。
  证据：`.debug/multiroot-auto-activation/run.mjs` 在未主动打开 Canvas 的 Untitled 多根窗口中，旧 manifest 和“仅加 `onView:devSessionCanvas.canvasPanel`”两种情况下，20 个 tick 后扩展仍为 `active:false`，`devSessionCanvas.__test.getDebugState` 不存在；加 `onStartupFinished` 后 tick 1 变为 `active:true` 并出现 `storage/untitledMultiRootForkApplied`。

- 观察：在补充 `onStartupFinished` 后，Panel view 的打开 / 解析路径本身可以完成，不再停留在 loading。
  证据：`.debug/multiroot-auto-activation/run-open.mjs` 先用单根窗口写入源节点，再以两个 folder 启动 Untitled 多根窗口；测试执行 `devSessionCanvas.canvasPanel.open` 后，`devSessionCanvas.__test.waitForCanvasReady('panel', 30000)` 成功返回，诊断事件尾部包含 `surface/attached`、`surface/rendered` 和 `surface/ready`。该验证覆盖 VSCode contributed view 命令层级的“打开 Canvas”，但仍不是用鼠标操作原生 `Add Folder to Workspace...` 菜单的端到端 UI 录制。

- 观察：真实 Remote SSH / 历史 storage slot 不能假设一定存在 VSCode `meta.json`。当前用户路径中，打开的 Canvas 变成内置使用说明模板，说明 startup 已激活但 `selectUntitledMultiRootWorkspaceStorageForkSource(...)` 没有找到源；本机真实 `~/.vscode-server/data/User/workspaceStorage` 中多个 `devsessioncanvas.dev-session-canvas/canvas-state.json` 周围没有 `meta.json`，这会让现有 `workspaceName` 为空、`rootMatchIndex` 为 -1。
  证据：本地检查显示 `991aab3873a2779dc34835c600fb9d76` 和 `991aab3873a2779dc34835c600fb9d76-1` 均有 3 个 cwd 为 `.../dev-session-canvas2` 的 Agent 节点，但目录下只有 `devsessioncanvas.dev-session-canvas/canvas-state.json`、`ms-python.python/pythonrc.py` 和锁文件，没有 `meta.json`。

- 观察：受限 cwd fallback 在真实 VSCode Untitled 多根启动路径中可生效，不需要用户先保存 `.code-workspace`，也不需要 `meta.json`。
  证据：`.debug/multiroot-auto-activation/run-path-hint-open.mjs` 先写入第一 root 的 `Path Hint Fork Source` Agent，再删除相关 `meta.json`；Untitled 多根窗口启动后 `before open` 已加载该节点，执行 `devSessionCanvas.canvasPanel.open` 后 `ready.panel` 为 `true`，诊断事件 `storage/untitledMultiRootForkApplied` 的 `selectionBasis` 为 `first-root-path-hint`，`sourceRootPathHintMatchedRootIndexes` 为 `[0]`。

- 观察：用户最新诊断里的错误 fork 不是随机源，而是 Remote SSH 第一个 root 的 canonical storage slot 的陈旧 indexed sibling。`md5("vscode-remote://ssh-remote%2Bdev_labs/home/users/ziyang01.wang-al/projects/dsc-test-02")` 对应 `21dd04231c926988e6dcf73d7f627c40`；上一版选中了 `21dd04231c926988e6dcf73d7f627c40-2`，因为它的旧节点 cwd 命中了第一 root。canonical slot 本身有 `2026-05-29T16:39:33.951Z` 写入的 3 节点快照，而 `-2` 是 `2026-05-26T16:49:45.286Z` 的 27 节点旧快照。
  证据：诊断事件 `storage/untitledMultiRootForkApplied` 记录 `sourceSlotName: "21dd04231c926988e6dcf73d7f627c40-2"`、`selectionBasis: "first-root-path-hint"`、`sourceTimestamp: "2026-05-26T16:49:45.286Z"`；本地扫描 `~/.vscode-server/data/User/workspaceStorage/21dd04231c926988e6dcf73d7f627c40/devsessioncanvas.dev-session-canvas/canvas-state.json` 显示 `writtenAt: "2026-05-29T16:39:33.951Z"`、`nodeCount: 3`。

- 观察：一旦错误 fork 已经复制到当前 Untitled 多根 slot，当前槽本身也会携带第一 root cwd 线索，单靠“最新 path hint”会再次选择当前复制快照而不是原单根 canonical slot。旧快照中的 `runtimeStoragePath` / `resumeStoragePath` 仍指向原 canonical slot，这可以作为“这个复制快照源自哪个单根 slot”的更强线索。
  证据：当前 `3198a6262b0fba686f4c1d9d15774682` 快照已经包含 27 个节点和第一 root cwd 线索，但其 Agent runtime 路径仍包含 `workspaceStorage/21dd04231c926988e6dcf73d7f627c40/devsessioncanvas.dev-session-canvas`；新增 helper 检查用同一诊断目录模拟空当前槽时，选择结果从 copied path-hint 改为 `selectionBasis: "first-root-canonical-slot-family"`、`sourceSlotName: "21dd04231c926988e6dcf73d7f627c40"`。

## 决策记录

- 决策：Explorer 资源入口与普通创建入口共享同一个节点创建管线，只通过 `cwdOverride` 表达目录上下文。
  理由：正式设计要求 cwd 成为节点 metadata 的一等字段，而不是启动后输入 `cd`；复用创建管线可以让落点、trust、pending launch 和持久化保持一致。
  日期/作者：2026-05-29 / Codex。

- 决策：普通创建入口在多根 workspace 下只确认 workspace root，不提供任意目录选择器。
  理由：普通入口需要保持轻量；子目录意图已经由 Explorer 资源右键表达。任意目录选择器会把 Explorer 能力重复做一遍，并增加用户路径选择成本。
  日期/作者：2026-05-29 / Codex。

- 决策：Explorer 资源右键入口不重复弹 root 选择。
  理由：右键资源 URI 已经能通过 `vscode.workspace.getWorkspaceFolder(cwdUri)` 定位所属 root，重复确认会削弱“从当前资源直接创建”的核心体验。
  日期/作者：2026-05-29 / Codex。


- 决策：新增 `src/common/executionCwdLabel.ts` 作为不依赖 Node `path` 的共享 cwdLabel helper，Webview 与 sidebar 都使用它；保留 `workspaceRelativePath.ts` 给宿主侧既有文件路径逻辑。
  理由：Webview browser bundle 不应引入 Node `path`，但 Agent 标题与侧栏需要一致的单根 / 多根 cwdLabel 规则。
  日期/作者：2026-05-29 / Codex。

- 决策：画布空白区等 Webview 发起的 `webview/createDemoNode` 如果没有 cwd，在宿主侧二次执行普通创建 root 确认；命令面板 / 侧栏入口在 `src/extension.ts` 选择节点类型后确认 root。
  理由：Explorer URI 入口已有明确 cwd 不应重复确认；普通入口则必须覆盖宿主命令和 Webview 右键两条路径，避免多根 workspace 下静默使用第一个 root。
  日期/作者：2026-05-29 / Codex。

- 决策：需要断言执行 session 已静止的测试不再使用 `webview/resetDemoState` 作为同步清理点，而使用宿主 test reset 命令并显式等待 running count 归零。
  理由：Webview reset 消息本身异步且不回传完成信号，容易与 Terminal/Agent 启动清理竞争；宿主 test reset 更适合 smoke 中建立确定性前置状态。
  日期/作者：2026-05-29 / Codex。

- 决策：单根扩容到 Untitled 多根 workspace 的 reload 路径只在“当前多根槽没有 `canvas-state.json`”时，从当前 workspace 第一个 root 名称匹配到的单根 slot fork `canvas-state.json`，不复制 `agent-runtime`、`runtime-supervisor` 或 note draft 目录。
  理由：reload 后内存 Canvas 已丢失，只能用原单根最近已写入快照近似“当前 Canvas”；只复制主快照可避免把旧单根 live runtime 或草稿存储误绑定到新的多根 scope，后续当前槽会自然写入自己的状态。
  日期/作者：2026-05-29 / Codex。

- 决策：Untitled 多根 fork 源选择是一个显式、受限的启动恢复路径，不放宽既有 sibling slot recovery 的 hash / freshness 规则。
  理由：上一版已用测试锁定 unrelated workspaceStorage hash 不能仅按新鲜度恢复；新路径必须要求 `workspaceFile.scheme === 'untitled'`、workspace folders 多于一个、当前 slot 为空，并按 root 名称 / VSCode `meta.json` 匹配候选，避免误导入任意旧 workspace。
  日期/作者：2026-05-29 / Codex。

- 决策：当 Untitled 多根 fork 找不到 `meta.name` 精确匹配源时，允许使用快照内容中的第一 root 路径线索作为受限 fallback。
  理由：真实 Remote SSH / 历史 VSCode storage slot 可能缺失 `meta.json`，但单根画布中的执行节点通常会在 `metadata.agent.cwd`、`metadata.terminal.cwd`、`runtimeStoragePath` 或 `resumeStoragePath` 中留下 root 路径。fallback 只在当前多根槽及其 workspaceState 都无有意义节点且没有任何精确 root 名称匹配时启用；只选择非当前、非内置使用说明模板、节点目录线索明确落在第一个 root 下的非空快照，并按最新快照决胜，避免退化成任意新鲜度恢复。
  日期/作者：2026-05-29 / Codex。

- 决策：如果当前 Untitled 多根 slot 的 `workspaceState.canvasState` 已经有非内置使用说明模板节点，即使 `canvas-state.json` 缺失或为空，也不执行启动期 fork。
  理由：有非内置使用说明模板节点的 `workspaceState` 代表当前多根 scope 已有可加载状态，继续 fork 会覆盖用户当前多根画布；空、缺失或只有内置使用说明模板的 `workspaceState` 才符合“没有有意义 Canvas”的补救条件。
  日期/作者：2026-05-29 / Codex。

- 决策：manifest 增加 `onStartupFinished`，并保留 `onView:devSessionCanvas.canvasPanel` 与 `onWebviewPanel:devSessionCanvas.canvas`。
  理由：`onStartupFinished` 可在 VSCode 启动主链路完成后激活扩展，注册 Panel `WebviewViewProvider` 并执行 Untitled 多根 fork；`onView` 只在 view 被解析/展开时触发，不能覆盖 reload 后扩展保持 inactive 的情况。该决策不使用 `*`，不在启动时调用 `revealPanelView()`，因此不会自动把画布拉到前台或抢焦点。
  日期/作者：2026-05-29 / Codex。

- 决策：Untitled 多根 path-hint fallback 中，cwd 命中第一 root 的候选只是“证据候选”，实际 fork 源优先使用同 canonical slot family 的 base slot；如果证据快照来自复制后的当前 Untitled 槽，则通过 `runtimeStoragePath` / `resumeStoragePath` 中的 `workspaceStorage/<slot>` 反向定位 canonical slot。
  理由：VSCode Remote SSH 单根 storage slot 可能有 `slot`、`slot-1`、`slot-2` 等 indexed sibling；indexed sibling 可以保留陈旧历史节点，但仍包含第一 root cwd，导致“按 path-hint 最新/命中”选择旧画布。canonical base slot 才更接近当前单根 workspace storage；runtime 路径在复制后仍指回原 slot，可修复已经误 fork 后再次恢复的情况。canonical 缺失或无可恢复快照时仍回退证据候选，避免破坏只有 indexed 快照可用的历史恢复能力。
  日期/作者：2026-05-30 / Codex。

- 决策：当前 Untitled 多根槽已有非内置节点时，仍允许一种受限纠偏：如果当前槽自身的 cwd 线索唯一命中第一 root，且 `runtimeStoragePath` / `resumeStoragePath` 指向另一个可恢复 canonical 单根 slot，则把当前槽视作上一次错误 fork 的复制证据并切回该 canonical slot。
  理由：上一条决策要求“复制后的当前 Untitled 槽”能通过 runtime/resume 反向定位 canonical，但实现里当前槽有节点时提前返回，导致纠偏逻辑无法运行。新增限制确保只有能证明来源 canonical slot 的复制快照会覆盖当前槽；没有 canonical 指向时继续保留当前多根槽，避免误覆盖用户已在多根 workspace 中形成的真实画布。
  日期/作者：2026-05-30 / Codex。

## 结果与复盘

上一轮实现已完成并通过验证：命令 ID 与 manifest 增加 Explorer 资源菜单，`src/extension.ts` 可把目录或普通文件父目录解析为 cwd；普通创建入口在多根 workspace 下会确认 root；共享协议带 `cwd`；`CanvasPanelManager` 会把 cwdOverride 写入 Agent / Terminal metadata，并在启动、CLI resolver、shell env patch 与 diagnostic 中优先使用节点 cwd；Webview Agent subtitle 与侧栏 Agent 第二行已接入 cwdLabel。测试覆盖已补齐到 manifest、协议、cwdLabel、Webview 展示和 trusted VSCode smoke 的 Explorer 创建主路径。

用户实测暴露一个新增缺口：`Add Folder to Workspace...` 在单根变多根时通常要求 reload，扩展重启后没有内存 Canvas 可保留，也不会执行运行期 workspace folder event 分支。本轮已补充启动恢复：在空的 Untitled 多根 storage scope 中，从当前第一个 root 名称匹配的原单根 slot fork `canvas-state.json`，只复制主快照，不复制 runtime 或草稿目录；如果当前多根 slot 或 `workspaceState` 已经有有意义节点则跳过，避免覆盖现有多根画布。

用户随后继续实测发现当前版本仍会在 `Add Folder to Workspace...` 后卡在加载中。复查确认上一版没有测真实 VSCode UI reload，只测了存储 helper、typecheck，以及 CLI 打开 `rootA rootB` 后再手动激活扩展的近似路径。新增启动实验表明：Untitled 多根窗口启动后，如果扩展没有被激活，`CanvasPanelManager` 构造函数不会运行，Panel provider 不会注册，`recoverUntitledMultiRootWorkspaceStorageForkIfNeeded()` 也不会执行；这正是 fork 逻辑存在但用户看不到恢复节点的原因。最终采用 `onStartupFinished` 让扩展在启动完成后注册 provider 并运行 fork，同时明确不使用 `*`、不自动 reveal 画布内容。

用户最新实测又暴露源识别缺口：Canvas 已经能打开，但因为历史 / Remote SSH storage slot 缺失 `meta.json`，启动期 fork 没能识别第一 root 的旧单根快照，随后首次打开应用了内置使用说明模板。本轮已把源选择扩展为两层：先用 `meta.name` 精确匹配第一个 root；没有精确匹配时，再读取候选快照中的 Agent / Terminal cwd 与 runtime 路径线索，选择明确落在第一个 root 下的非内置模板快照。定向单元测试和真实 VSCode Untitled 多根 smoke 均已覆盖这条 `first-root-path-hint` 路径。

用户随后提供的宿主诊断显示 path-hint fallback 还能选到同一 Remote SSH 单根 slot family 下的陈旧 indexed sibling，从而 fork 了 2026-05-26 的 27 节点历史状态，而不是 canonical 单根 slot 中 2026-05-29 的 3 节点当前状态。本轮修复把 path-hint 候选拆成“证据”和“实际源”：证据可来自 indexed sibling 或复制后的当前 Untitled 槽，但实际源会优先切到同 family / runtime 路径指向的 canonical slot。这样既保留缺失 `meta.json` 时的恢复能力，又避免陈旧 indexed sibling 凭 cwd 命中盖过当前单根画布。

PR review 发现上一段“复制后的当前 Untitled 槽”只写入了文档与候选选择函数，但 `selectUntitledMultiRootWorkspaceStorageForkSource(...)` 在当前槽已有非内置节点时仍会提前返回，导致已经错误 fork 过一次的用户无法被纠偏。本轮修复后，有意义当前槽只有在自身路径线索唯一命中第一 root、且 runtime/resume 指向另一个可恢复 canonical 单根 slot 时，才作为 evidence 触发 `first-root-canonical-slot-family` 选择；否则仍保留当前多根槽，避免覆盖真实多根画布。

复盘上，主要风险来自测试同步而不是产品路径：`webview/resetDemoState` 没有完成回执，容易与仍在启动或停止的执行 session 竞争。本轮已把相关 smoke 前置清理改为宿主 test reset 并等待 `runningExecutionCount === 0`，后续新增会启动执行节点的 smoke 测试也应沿用这个模式。

## 上下文与定向

正式产品范围写在 `docs/product-specs/explorer-resource-create-execution-node.md`，正式设计写在 `docs/design-docs/explorer-resource-create-execution-node.md`。本计划实现这些文档中已经确认的行为，不重新扩大范围。

仓库是 VSCode 扩展。宿主侧入口在 `src/extension.ts`，主要状态和执行编排在 `src/panel/CanvasPanelManager.ts`。共享消息类型在 `src/common/protocol.ts`，命令 ID 在 `src/common/extensionIdentity.ts`，package contribution 在 `package.json` 和 `package.nls.json`。Webview 主界面在 `src/webview/main.tsx`，侧栏节点列表在 `src/sidebar/CanvasSidebarNodeListView.ts`。

“cwd” 指执行会话启动时的工作目录，也就是传给 PTY、runtime supervisor、Agent CLI resolver 和文件活动会话的目录。`metadata.terminal.cwd` 和 `metadata.agent.cwd` 是持久化在 Canvas 节点里的权威 cwd。`cwdLabel` 是 UI 展示用短标签，单根 workspace 下可以是相对路径，多根 workspace 下必须带 workspace folder 前缀来消歧；它不是持久化权威字段。

当前代码里普通创建入口默认使用 `CanvasPanelManager.getTerminalWorkingDirectory()`，该函数返回 `vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? defaultTerminalWorkingDirectory()`。这正是多根 workspace 下需要被普通创建入口 root 确认替代的隐式第一个 root 语义。实现时不能把这个函数直接全局改成弹窗，因为很多非交互路径、恢复路径和测试路径需要稳定默认值；应在用户发起普通创建 `Terminal` / `Agent` 时确认 root，并以 `cwdOverride` 传入创建管线。

## 工作计划

第一阶段先梳理并最小化接口改动。查看 `src/extension.ts` 中命令注册、`promptCreateNodeRequest` 或等价 Agent Quick Input 流程、`CanvasPanelManager.createNode(...)` 与 `applyCreateNode(...)` 的参数类型。确认当前 Webview 如何通过 `host/requestCreateNode` 回传 `webview/createDemoNode`，以及 Terminal / Agent metadata 在哪里构造。这个阶段只读代码和更新本计划，不改行为。

第二阶段实现宿主命令入口。在 `src/common/extensionIdentity.ts` 增加 `devSessionCanvas.createTerminalFromExplorerResource` 和 `devSessionCanvas.createAgentFromExplorerResource`。在 `package.json` 的 `contributes.commands` 和 `contributes.menus.explorer/context` 登记命令，`when` 至少包含 `resourceScheme == file`，不要使用 `explorerResourceIsFolder`。在 `src/extension.ts` 增加资源解析函数：只接受 `file` scheme；用 `vscode.workspace.fs.stat(uri)` 区分目录和普通文件；普通文件转父目录；用 `vscode.workspace.getWorkspaceFolder(cwdUri)` 验证 cwd 属于当前 workspace；失败时 showWarningMessage 并不创建节点。

第三阶段实现普通创建入口多根 root 确认。新增一个宿主侧 helper，例如 `resolveDefaultExecutionCwdForInteractiveCreate(kind)`。当 kind 是 `terminal` 或 `agent` 且 workspace folders 多于一个时，调用 `vscode.window.showQuickPick` 展示 root 名称和路径；用户取消返回 undefined，并让上层停止创建。单根 workspace 直接返回唯一 root。无 workspace 时继续使用当前默认回退。Explorer 入口直接传自己的 cwdOverride，不走 root Quick Pick。

第四阶段扩展创建管线和协议。`src/common/protocol.ts` 的 `host/requestCreateNode` payload 和 `webview/createDemoNode` payload 需要新增可选 `cwd`。`CanvasPanelManager` 的创建 options 需要能携带 `cwdOverride`。当 Webview 已 ready 并负责计算落点时，host 发送 cwd，Webview 回传 cwd；host 最终 apply 时把 cwd 写入 `metadata.terminal.cwd` 或 `metadata.agent.cwd`。如果 Webview 未 ready，host 直接 apply 时也必须保留 cwd。`cwdOverride` 必须通过宿主侧校验：非空、绝对路径、存在、是目录、属于当前 workspace。校验失败不创建节点，不能静默回退。

第五阶段收口启动与恢复语义。检查 `startTerminalSession(...)`、`startAgentSession(...)`、`buildTerminalLaunchSpec(...)`、`buildAgentLaunchSpec(...)`、shell environment resolver、Agent CLI resolver、file activity session、line context tracker 和 runtime supervisor createSession request。凡是用户启动或重启某个已存在执行节点，都应优先读取节点 metadata cwd；只有旧节点没有 cwd 时才回退到 `getTerminalWorkingDirectory()`。启动前 cwd 不可用时，让节点进入错误态或启动失败摘要，保留原 cwd，不静默改用 workspace root。

第六阶段实现展示。Webview 和 sidebar 都需要能从 cwd 与 workspace folder 列表派生 cwdLabel。可在共享纯函数里实现 `formatExecutionCwdLabel(cwd, workspaceFolders)`，或在宿主/前端各自复用现有 workspace-relative 逻辑。多根下 label 必须带 workspace folder name；单根下显示相对路径或 root 名称。Terminal 标题副标题继续不显示 cwdLabel。Agent 标题副标题显示 `cwdLabel · 启动命令`。侧栏 Agent 第二行显示 `cwdLabel · provider · 状态`；Terminal / Note 不新增 cwdLabel。

第七阶段补测试。优先添加纯函数测试覆盖 cwdLabel 和 cwd 校验可抽取部分；添加 VSCode smoke 或现有测试命令覆盖 Explorer 目录、普通文件、workspace 外资源、多根普通创建 root 选择和取消；添加 Webview/侧栏测试覆盖 Agent subtitle 和 sidebar 第二行。若真实 Quick Pick 在 smoke 中难以自动选择，需要使用 test-only 命令或可注入选择器，但正式产品路径仍必须走 VSCode Quick Pick。

## 具体步骤

所有命令都在仓库根目录 `/home/users/ziyang01.wang-al/projects/dev-session-canvas.worktrees/dev-session-canvas2` 执行。

先检查工作树和关键代码位置：

    git status --short
    rg -n "createNode|requestCreateNode|createDemoNode|promptCreate|showQuickPick|startTerminalSession|startAgentSession|getTerminalWorkingDirectory" src package.json tests

实现过程中每完成一个切片都运行轻量检查：

    npm run typecheck

如果新增或修改 Webview 展示测试，运行相关定向 Playwright 测试；具体命令以现有 `package.json` scripts 为准，例如：

    npm run test:webview -- --grep "Agent"

如果新增 VSCode smoke，优先运行定向 smoke；具体脚本以现有 `scripts/smoke/` 和 `package.json` 为准。若 smoke 运行成本过高，至少运行新抽出的纯函数测试和 `npm run typecheck`，并在结果复盘里说明未跑 smoke 的原因。

每次修改正式文档、计划或代码后，运行：

    git diff --check

## 验证与验收

实现完成后，至少需要证明以下行为：

1. 在单根 workspace 内对目录 URI 执行 `devSessionCanvas.createTerminalFromExplorerResource`，新 Terminal 的 `metadata.terminal.cwd` 等于目录路径，`execution/started.cwd` 也等于目录路径。
2. 在单根 workspace 内对普通文件 URI 执行 `devSessionCanvas.createAgentFromExplorerResource`，新 Agent 的 `metadata.agent.cwd` 等于文件父目录，`execution/startRequested.cwd` 和 `execution/started.cwd` 也等于父目录。
3. 在多根 workspace 下通过普通创建入口创建 Terminal / Agent 时出现 root 选择；选择第二个 root 后，新节点 metadata cwd 等于第二个 root；取消选择不会创建节点。
4. Agent 节点标题副标题显示 `cwdLabel · 启动命令`，侧栏 Agent 第二行显示 `cwdLabel · provider · 状态`。Terminal 标题副标题不显示 cwdLabel。
5. workspace 外资源、非普通文件资源或不存在资源不会创建节点，并给出明确 warning 或错误诊断。
6. 停止后再次启动 Terminal / Agent 继续使用节点 metadata cwd，不回退到第一个 workspace root。

预期最终检查至少包括：

    npm run typecheck
    git diff --check

如果新增测试命令，需在 `证据与备注` 中记录通过输出的关键行。

## 幂等性与恢复

本计划的代码修改应保持可重复执行。新增命令 ID、协议字段和 helper 应该是向后兼容的：旧快照中没有 cwd 的节点仍按旧默认 cwd 回退；新节点一旦写入 cwd，就以后续 metadata 为准。Explorer 命令失败时只显示 warning，不创建半成品节点。普通创建 root Quick Pick 取消时不改变状态。

不要删除或迁移用户的现有 `canvas-state.json`。单根扩容到多根 workspace 的 reload 补救只能在当前 Untitled 多根槽还没有主快照时复制一份单根 `canvas-state.json` 到当前槽；原单根快照必须保留，新增 root 的历史 Canvas 不导入，旧多根快照不自动 merge。

当前工作树中存在与本任务无关的未跟踪 `image*.png` 文件；不要暂存、修改或删除它们。

## 证据与备注

设计提交已经完成：

    [docs-canvas-node-grouping-design ac4a614] docs(canvas): 记录 Explorer 资源创建执行节点方案
    6 files changed, 429 insertions(+), 5 deletions(-)

本计划创建时工作树只有未跟踪图片文件与本计划自身待提交；后续实现必须避免把图片文件混入提交。

第一轮实现后已运行类型检查：

    npm run typecheck
    > tsc --noEmit

    exit code 0

补充验证已通过：

    npm run test:workspace-relative-paths && npm run test:protocol-webview-messages && npm run test:extension-manifest
    exit code 0

    npm run test:webview -- --grep "agent subtitle|terminal subtitle"
    exit code 0

    node scripts/test/run-playwright-webview.mjs --grep "right-click create menu validates custom agent launch commands before creating|right-click custom agent launch input ignores IME Enter before composition commits|host-triggered manual node creation snapshots existing nodes before resolving autofocus"
    exit code 0

    git diff --check
    exit code 0

    npm run typecheck
    exit code 0

    DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=trusted npm run test:smoke
    Trusted workspace smoke passed.
    VS Code smoke test passed.
    exit code 0

本轮 smoke 曾暴露一个测试同步问题：`webview/resetDemoState` 异步清理时，执行 session 的 running count 可能晚于节点列表归零；最终实现改用宿主 test reset 并等待 `runningExecutionCount === 0` 后，trusted smoke 通过。

针对 Untitled 多根 reload 补救已补充并通过定向验证：

    npm run test:extension-storage-paths
    extensionStoragePaths tests passed
    exit code 0

    npm run typecheck
    > tsc --noEmit
    exit code 0

    git diff --check
    exit code 0

这些测试覆盖：普通 unrelated workspaceStorage hash 不通过 freshness 恢复；Untitled 多根显式 fork 只选择匹配第一个 root 名称的单根快照；当前多根空快照可被 fork 覆盖；当前多根已有节点快照不可被覆盖。

针对用户复测的卡加载问题已补充验证：

    .debug/multiroot-auto-activation/run.mjs
    旧 manifest / 仅增加 onView:devSessionCanvas.canvasPanel：
    [verify-auto] tick 20 {"active":false}
    [verify-auto] has debug command false

    增加 onStartupFinished 后：
    [verify-auto] tick 1 {"active":true}
    [verify-auto] has debug command true
    [verify-auto] snapshot {"nodes":1,"titles":["Auto Activation Fork Source"],"active":"panel","ready":{"editor":false,"panel":false},"mode":{}}
    [verify-auto] events tail ... "storage/untitledMultiRootForkApplied" ...

`surfaceReady.panel: false` 是预期结果：startup activation 只注册 provider 和恢复存储，不自动 reveal 或解析 Webview；用户打开 Panel view 后才会真正加载画布内容。

针对用户进一步澄清的“点击 Canvas 后仍卡住”，已补跑打开路径验证：

    .debug/multiroot-auto-activation/run-open.mjs
    [verify-open] before open {"nodes":1,"titles":["Auto Activation Fork Source"],"ready":{"editor":false,"panel":false},"activeSurface":"panel"}
    [verify-open] after open {"nodes":1,"titles":["Auto Activation Fork Source"],"ready":{"editor":false,"panel":true},"activeSurface":"panel","mode":{"panel":"active"}}
    [verify-open] events tail ... "surface/attached" ... "surface/rendered" ... "surface/ready" ...
    exit code 0

这次验证说明：在当前实现下，Untitled 多根 startup fork 完成后，再打开 Panel Canvas 可以让 WebviewView 正常 resolve 并 ready。该验证仍是自动化命令级验证，不是手工点击 VSCode `Add Folder to Workspace...` 菜单后的完整 GUI 录制；如果用户本地仍复现，需要继续采集 Extension Host log、manifest 版本和 Canvas diagnostic events。

用户随后实测确认 Canvas 已能正常打开，但没有 fork 第一目录的旧画布，而是初始化出内置使用说明模板。新的修复方向是让 `src/common/extensionStoragePaths.ts` 的 Untitled 多根源选择在 `meta.json` 缺失时读取候选快照内容：如果 Agent / Terminal 的 cwd 或 runtime 相关路径能明确指向第一个 workspace root，则可作为 `first-root-path-hint` 源。这个 fallback 不使用单纯最新快照，不导入新增 root 历史画布，也不把只有内置使用说明模板的空白初始画布当成源。

受限 fallback 已实现并通过定向验证；同时补跑真实 VSCode 启动 smoke，证明缺失 `meta.json` 时也能从第一 root 的 cwd 线索 fork，而不是落到内置使用说明模板：

    npm run test:extension-storage-paths
    extensionStoragePaths tests passed
    exit code 0

    npm run typecheck
    > tsc --noEmit
    exit code 0

新增测试覆盖：缺失 `meta.json` 时按第一个 root 的 cwd 路径线索 fork；已有精确 `meta.name` 匹配时仍优先使用名称匹配；当前多根槽只有内置使用说明模板时允许 fork 覆盖；只有内置使用说明模板的候选不能成为源；候选同时出现多个 root 的路径线索时拒绝 fallback。

    .debug/multiroot-auto-activation/run-path-hint-open.mjs
    [verify-path-hint-open] before open {"nodes":1,"titles":["Path Hint Fork Source"],"ready":{"editor":false,"panel":false},"activeSurface":"panel"}
    [verify-path-hint-open] after open {"nodes":1,"titles":["Path Hint Fork Source"],"ready":{"editor":false,"panel":true},"activeSurface":"panel","mode":{"panel":"active"}}
    [verify-path-hint-open] fork events ... "selectionBasis":"first-root-path-hint" ... "sourceRootPathHintMatchedRootIndexes":[0] ...
    exit code 0

针对用户最新诊断中的“fork 到旧画布状态”，已补充 canonical slot family 选择测试：

    npm run test:extension-storage-paths
    extensionStoragePaths tests passed
    exit code 0

新增断言覆盖：第一 root 路径线索只出现在 `workspaceStorage/<slot>-2` 这类 indexed sibling 时，实际 fork 源优先使用 `<slot>` canonical 快照；如果错误复制后的快照更新、但 `runtimeStoragePath` 仍指向 canonical slot，也优先使用 canonical 快照；只有 canonical slot 缺失或没有可恢复快照时，才继续使用 indexed sibling 作为 fallback。

针对 PR review 的 current-slot copied evidence 缺口，已补充单元测试：

    npm run test:extension-storage-paths
    extensionStoragePaths tests passed
    exit code 0

新增断言覆盖：当前 Untitled 多根槽已有一份错误复制进来的非空快照时，只要该快照 cwd 唯一命中第一 root 且 runtime storage hint 指向可恢复 canonical 单根 slot，选择结果会以当前槽为 evidence、以 canonical slot 为 source，并返回 `first-root-canonical-slot-family`。

## 接口与依赖

在 `src/common/extensionIdentity.ts` 中应存在以下命令 ID：

    createTerminalFromExplorerResource: 'devSessionCanvas.createTerminalFromExplorerResource'
    createAgentFromExplorerResource: 'devSessionCanvas.createAgentFromExplorerResource'

在 `src/common/protocol.ts` 中，创建节点相关 host/webview payload 应支持可选字段：

    cwd?: string

在 `src/panel/CanvasPanelManager.ts` 中，创建节点 options 应支持：

    cwdOverride?: string
    cwdSelectionSource?: 'explorer-resource' | 'workspace-root-picker' | 'default-workspace-root'

宿主侧需要一个解析 Explorer 资源的函数，输入 `vscode.Uri`，输出至少包含：

    cwd: string
    workspaceFolderName: string
    sourceKind: 'directory' | 'file-parent'

宿主侧需要一个普通创建 root 选择 helper。它应在多根 workspace 下用 `vscode.window.showQuickPick` 返回用户确认的 root cwd；取消时返回 undefined，让上层停止创建。

本次更新说明：2026-05-29 01:10 +0800 完成第一轮实现，记录命令、协议、cwd 管线、Agent/Sidebar 展示和 typecheck 证据；后续继续补自动化验证。

本次更新说明：2026-05-29 00:40 +0800 完成实现前代码路径梳理，补充现有创建管线、启动 cwd、cache、Webview 与 sidebar 投影的关键发现，指导后续编码。

本次更新说明：2026-05-29 新建实现阶段 ExecPlan，把已提交的产品/设计结论转化为可执行实现步骤，并记录多根 workspace 普通创建入口 root 确认的实现路径。

本次更新说明：2026-05-29 01:57 +0800 完成验证和复盘记录；Explorer 创建、多根普通创建 cwd、Agent/Sidebar cwdLabel 展示和 trusted smoke 均已覆盖。

本次更新说明：2026-05-29 10:15 +0800 根据用户实测补充 Untitled 多根 reload 恢复路径，实现按第一个 root 名称 fork 单根 `canvas-state.json`，同步产品/设计文档，并记录定向验证证据。
本次更新说明：2026-05-29 23:58 +0800 根据用户实测“Canvas 能打开但未 fork 第一目录画布”补充根因与修复决策：`meta.json` 可能缺失，后续实现需要增加基于快照 cwd 路径线索的受限 fallback，并同步补测试。
本次更新说明：2026-05-30 00:08 +0800 完成 `first-root-path-hint` fallback 实现与定向验证，补充缺失 `meta.json`、内置使用说明模板、精确匹配优先级和多 root 路径歧义测试。
本次更新说明：2026-05-30 00:12 +0800 补充真实 VSCode 启动 smoke 证据，确认缺失 `meta.json` 时能通过第一 root 的 cwd 路径线索完成 fork，并在打开 Panel Canvas 后正常 ready。
本次更新说明：2026-05-30 01:16 +0800 根据用户诊断修正 path-hint fallback：indexed sibling 或复制快照只能作为证据，实际源优先回到 canonical storage slot；同步产品规格、设计文档与单元测试。
本次更新说明：2026-05-30 22:05 +0800 根据 PR review 修复 current-slot copied evidence 短路问题：当前 Untitled 多根槽已有错误复制快照时可凭 runtime/resume hint 切回 canonical slot；同步补测试与文档。
