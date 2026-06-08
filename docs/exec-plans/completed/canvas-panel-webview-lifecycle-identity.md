# 修复 Panel Webview 生命周期串线导致画布空白

本 `ExecPlan` 已完成并归档到 `docs/exec-plans/completed/canvas-panel-webview-lifecycle-identity.md`。执行期间已按 `docs/PLANS.md` 持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘`。

本计划遵循 `docs/PLANS.md`。当前仓库中的 `Webview` 指 VS Code 扩展宿主暴露给前端的隔离页面；`surface` 指画布所在的宿主承载面，目前只有编辑区 `editor` 和底部面板 `panel`；`lifecycle identity` 指宿主为一次 HTML 渲染分配的身份信息，用来区分同一个 surface 上先后出现的 Webview 文档。

## 目标与全局图景

用户在 VS Code Panel 区域拖动画布 view、与另一个 panel 组件拼到同一个页面后，重新加载窗口或关闭再打开 VS Code，会稳定看到画布页面存在但节点不显示。宿主诊断显示对象图仍有节点，因此目标不是修复持久化，而是让宿主只把 ready、bootstrap、probe 和 DOM 动作结果绑定到发出消息的那一个 Webview 文档，避免把一个旧 frame 的 ready 当成另一个 frame 的 ready。

完成后，用户重新进入同样的 Panel 布局恢复场景时，实际可见的画布 Webview 会收到宿主权威状态并渲染节点；诊断里可以看到每个 ready/bootstrap/probe 都携带 surface、generation 和 frameId，过期消息被记录为 stale 并忽略。自动验证至少要覆盖共享协议解析、类型检查和 Webview harness；真实 VS Code 场景已经通过用户原风险布局人工复验，并补充了真实宿主原生操作复验。

## 进度

- [x] (2026-06-03 14:10+08:00) 已确认工作区在 `canvas-panel-empty-diagnosis`，且没有修改现有源码。
- [x] (2026-06-03 14:20+08:00) 已读取 `docs/WORKFLOW.md`、`docs/PLANS.md` 与现有 `docs/design-docs/canvas-surface-placement.md`。
- [x] (2026-06-03 14:35+08:00) 已复核 `.debug/current-host-diagnostics/2026-06-03T05-57-36-129Z`，确认状态有 5 个节点、Panel ready 为 true，但 probe 对当前 panel Webview 超时，且 9ms 内出现两次 panel attach/render。
- [x] (2026-06-03 18:30+08:00) 在共享协议中新增 Webview lifecycle identity，并让 parser 能安全提取它。
- [x] (2026-06-03 18:30+08:00) 在 active Webview HTML 中注入宿主 generation，Webview 侧生成 frameId，并在所有 Webview->Host 消息上附带 identity。
- [x] (2026-06-03 18:30+08:00) 在 `CanvasPanelManager` 中按 Webview 实例、generation 和 frameId 绑定 ready/bootstrap/probe/DOM action，忽略 stale 消息。
- [x] (2026-06-03 18:30+08:00) 更新正式设计文档与索引，记录本轮生命周期身份方案。
- [x] (2026-06-03 18:30+08:00) 添加或更新协议、Webview harness 与宿主消息生命周期测试。
- [x] (2026-06-03 18:30+08:00) 运行验证命令并把结果写回本计划。
- [x] (2026-06-03 19:42+08:00) 复核调试宿主新诊断 `current-host-diagnostics/2026-06-03T11-16-15-601Z`，确认新 lifecycle 代码已运行，但双 attach 场景下第一帧 ready 被 `source-webview-mismatch` 误判为 stale。
- [x] (2026-06-03 19:42+08:00) 修复 Host 侧消息目标绑定：记录每次 render 对应的 Webview，并允许已渲染且未有 ready 的 ready frame 在 stale 检查前提升为当前消息目标。
- [x] (2026-06-03 19:42+08:00) 重新运行 `npm run typecheck`、`npm run test:protocol-webview-messages`、`npm run test:canvas-templates` 和 `npm run test:webview -- -g "lifecycle identity"`，均通过。
- [x] (2026-06-08 19:21+08:00) 第二批 debt hardening 已补 Host 侧可重复故障注入：测试命令模拟 panel 双 render / ready 竞争、bootstrap ack gating、stale mutation、probe 和 DOM action 来源串线。
- [x] (2026-06-08 19:26+08:00) 第二批已通过 `npm run typecheck`、`npm run test:protocol-webview-messages`、`npm run test:webview -- --grep "lifecycle identity"`、`DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=trusted npm run test:smoke`、`node --check tests/vscode-smoke/extension-tests.cjs` 和 `git diff --check`。
- [x] (2026-06-08 19:55+08:00) 第三批 debt hardening 已补真实 Panel restore 诊断摘要：`Dev Session Canvas: 落盘当前宿主诊断` 现在额外写出 `webview-lifecycle-summary.json`，并在命令提示里直接显示 lifecycle 状态和 Panel restore 风险。
- [x] (2026-06-08 20:02+08:00) 第三批已通过 `npm run typecheck`、`npm run test:protocol-webview-messages`、`npm run test:webview -- --grep "lifecycle identity"`、`DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=trusted npm run test:smoke`、`node --check tests/vscode-smoke/extension-tests.cjs` 和 `git diff --check`。
- [x] (2026-06-08 21:14+08:00) 第四批 debt hardening 已新增 repo-local 离线诊断入口：`npm run diagnose:webview-lifecycle -- [dump-dir]` 可直接解析已有宿主 dump，并用退出码区分健康、阻塞线索和输入错误。
- [x] (2026-06-08 21:20+08:00) 第四批已通过 `npm run typecheck`、`npm run test:webview-lifecycle-diagnostics`、`npm run test:protocol-webview-messages`、`node --check scripts/diagnostics/analyze-webview-lifecycle-dump.mjs`、`node --check scripts/test/test-webview-lifecycle-diagnostics.mjs` 和 `git diff --check`。
- [x] (2026-06-09 00:20+08:00) 用户按原 Panel restore 风险布局完成真实人工复验，dump `/home/users/ziyang01.wang-al/projects/dsc-test-01/.debug/current-host-diagnostics/2026-06-08T16-15-01-976Z` 诊断为退出码 `0`、`attention`、`Panel restore 风险：否`，且 `probe=OK(nodeCount=16)`。
- [x] (2026-06-09 00:35+08:00) 维护者用真实 VS Code 录制 / Playwright CDP 工具补跑原生操作复验，Panel 打开、`Developer: Reload Window`、再次打开 Panel 与宿主诊断均可用，dump `.debug/current-host-diagnostics/2026-06-08T16-31-24-283Z` 诊断为 `healthy`、退出码 `0`。
- [x] (2026-06-09 00:45+08:00) 已将设计文档验证状态更新为“已验证”，并把本 ExecPlan 归档到 `docs/exec-plans/completed/`。

## 意外与发现

- 观察：诊断里的持久化状态和宿主内存状态都没有丢节点，但 `panel-probe.json` 显示 Panel attached/ready/interactive/visible 均为 true 后仍等待 probe 超时。
  证据：`persisted-canvas-snapshot.json` 与 `debug-snapshot.json` 均含 5 个节点；`panel-probe.json` 错误为“等待 panel Webview probe 返回超时（2500ms）”。
- 观察：故障窗口在 2026-06-03T05:57:31.092Z 和 2026-06-03T05:57:31.101Z 出现两次 `surface/attached`，随后只有一次 `surface/ready`。
  证据：`diagnostic-events.json` 中两组 panel attach/render 相距约 9ms；当前代码只按 `sourceSurface` 处理 ready，没有 Webview 文档身份。
- 观察：Playwright lifecycle 子集能证明 stale `host/bootstrap` 不再覆盖当前画布状态，但同一命令如果同时跑既有 baseline screenshot，会被当前 Linux 快照差异阻塞。
  证据：`npm run test:webview -- -g "lifecycle identity"` 通过；`npm run test:webview -- -g "webview bundle emits ready|lifecycle identity"` 中 lifecycle 用例通过，baseline screenshot 因 7654 像素差异失败，截图显示 Agent subtitle 多出 cwd label、终端 resize handle 形态不同。
- 观察：用户 2026-06-03 19:16+08:00 的调试诊断不是旧构建问题。`summary.json` 中已经包含 `surfaceLifecycle.panel.generation = 4` 和 `webview/staleMessageIgnored`，说明 Debug Host 运行到了本轮新代码。
  证据：`diagnostic-events.json` 显示 11:16:10.070Z、11:16:10.081Z 两次 `surface/attached` / `surface/rendered`，随后 generation 2 的 `webview/ready` 和 `webview/updateViewportCenter` 被记录为 `reason: "source-webview-mismatch"`；`panel-probe.json` 为 `surface-not-ready`，而 `debug-snapshot.json` 仍有 33 个节点。
- 观察：第一轮 lifecycle 防护过严。VS Code Panel restore 会先后给同一个 view provider 提供两个 `WebviewView` 对象，后 attach 的对象覆盖 `this.panelView`，但先 render 的 frame 可能先发 ready；如果 Host 只把“最后 attach 的 Webview 对象”视为当前对象，就会把唯一完成启动的 frame 忽略掉。
  证据：新诊断中 generation 2 frame 已发 `webview/ready`，但当前 lifecycle 已被 generation 4 覆盖且 ready 一直为 false；没有任何 `host/bootstrap` 或 `webview/bootstrapAck` 记录。
- 观察：真实 Panel 布局恢复仍不适合稳定依赖人工复现，但 Host 侧可以用两个 fake `vscode.Webview` 对象复现“后 render 覆盖字段、先 render 先 ready”的核心竞态。
  证据：`devSessionCanvas.__test.runWebviewLifecycleRaceDiagnostics` 返回 `promoted=true`、`bootstrapAck=true`、`staleProbeResultIgnored=true` 和 `staleDomActionResultIgnored=true`；trusted smoke 已执行该命令并通过。
- 观察：第二批自动化能证明状态机不变量，但用户真实 Panel restore 复验时仍需要人工从多份 JSON 里拼接 `surface/attached`、`surface/rendered`、`surface/ready`、`host/bootstrap`、`surface/bootstrapAck`、probe 错误和 stale 事件，排障入口仍然偏专家向。
  证据：已有 `dumpCurrentHostDiagnostics()` 会写出 `summary.json`、`host-messages.json`、`diagnostic-events.json`、`panel-probe.json`，但没有一个面向 lifecycle 的聚合判断字段；第三批新增的 `webview-lifecycle-summary.json` 将这些线索按 surface 汇总为 `status`、`panelRestore.likelyAffected`、attach/render burst、ready promotion、bootstrap ack、queued message 和 probe 状态。
- 观察：第三批诊断摘要解决了 VS Code 内采集问题，但当用户只把 dump 目录发给协作者时，仍缺少一个不用启动 Extension Development Host 的 repo-local 判断入口。
  证据：第四批新增的 `scripts/diagnostics/analyze-webview-lifecycle-dump.mjs` 可以读取 `webview-lifecycle-summary.json`，也能 fallback 到 `summary.json.webviewLifecycle`；`scripts/test/test-webview-lifecycle-diagnostics.mjs` 覆盖 healthy、blocked、fallback 和自动选择最新 dump。
- 观察：用户原风险布局人工复验已经覆盖到真实 Panel restore 的双 attach/render burst，而补充的真实宿主原生操作复验覆盖了可重复的 Panel 打开、窗口 reload 与诊断采集路径。
  证据：用户 dump `/home/users/ziyang01.wang-al/projects/dsc-test-01/.debug/current-host-diagnostics/2026-06-08T16-15-01-976Z` 显示 29ms 内 4 次 attach/render、`surface/readyWebviewPromoted`、`surface/ready`、`host/bootstrap`、`surface/bootstrapAck` 和 `probe=OK(nodeCount=16)`，离线诊断退出码为 `0`；维护者补跑 dump `.debug/current-host-diagnostics/2026-06-08T16-31-24-283Z` 为 `healthy`、退出码 `0`。

## 决策记录

- 决策：本轮不依赖 `retainContextWhenHidden`，也不把 VS Code `webview.postMessage()` 的 boolean 返回值当成状态已被前端处理的证据。
  理由：官方语义只保证消息被投递到一个 live webview，不保证具体 DOM 文档已经安装 listener 或已经消费状态；当前故障正是“宿主认为已投递，但可见文档没有节点”。
  日期/作者：2026-06-03 / Codex。
- 决策：宿主仍保持对象图权威状态，Webview 只是可丢弃投影；修复点放在生命周期身份、ack 和 stale message 防护，而不是让 Panel Webview 自己持久化完整对象图。
  理由：现有架构已将节点、执行会话和持久化放在 Extension Host；改成 Webview 权威会扩大同步范围，并与 `editor/panel` 单主 surface 模型冲突。
  日期/作者：2026-06-03 / Codex。
- 决策：测试命令 `dispatchWebviewMessageForTest()` 对无 lifecycle 的合成消息自动补当前 surface lifecycle；真实 Webview 发来的无 lifecycle 消息则按 stale 忽略。
  理由：已有 VS Code smoke 大量通过测试命令模拟用户消息，继续保留这条测试入口的兼容性；真实故障来自实际 Webview 文档串线，必须要求实际 Webview 消息具备 lifecycle 才能参与 ready、ack 和 active mutation。
  日期/作者：2026-06-03 / Codex。
- 决策：Host 侧不再只用 `this.panelView?.webview` 或 `this.editorPanel?.webview` 判定当前消息目标，而是维护 `surfaceMessageWebview`。每次 render 先把该 Webview 作为候选消息目标；当一个已渲染的 active frame 发送 ready 且当前 surface 尚未 ready 时，允许它在 stale 检查前提升为正式消息目标。
  理由：Panel restore 的双 attach 顺序不能保证“最后 attach 的 Webview 对象”就是最先可用的 DOM frame。新的策略仍要求 ready lifecycle 必须来自 Host 确实渲染过的 Webview，并且只在当前 surface 未 ready 时允许提升，避免 stale 旧 frame 抢走已完成 bootstrap 的当前 frame。
  日期/作者：2026-06-03 / Codex。
- 决策：第二批自动化不再等待真实 VS Code 恢复出偶发双 attach，而是在 test-only command 中直接构造两个 fake `vscode.Webview` 实例，穿过 `CanvasPanelManager` 的真实私有 lifecycle 处理路径。
  理由：真实布局恢复依赖用户窗口布局和 VS Code 内部时序，作为长期 smoke 会不稳定；fake Webview 可以稳定证明 promotion、ack gating、pending request source binding 三个关键不变量，且命令仅在测试模式注册。
  日期/作者：2026-06-08 / Codex。
- 决策：第三批不新增新的用户可见“修复按钮”，而是扩展现有 `dumpHostDiagnostics`，把 Panel restore lifecycle 健康度落成 `webview-lifecycle-summary.json` 并在完成提示里暴露状态。
  理由：真实 restore 场景仍以诊断证据闭环为主，自动修复按钮容易掩盖未确认根因；复用现有诊断命令可以让用户按原流程采集现场，同时降低命令面和文档入口成本。
  日期/作者：2026-06-08 / Codex。
- 决策：第四批把下一层债务收口为离线分析 CLI，而不是继续增加 VS Code 命令或前端 UI。
  理由：第三批已经能在现场生成聚合摘要；真实协作排障中更常见的剩余成本是拿到 dump 后快速判定是否仍为 lifecycle 阻塞。repo-local CLI 可在不启动 VS Code 的情况下给出中文结论和稳定退出码，适合 MR、CI 或人工复验 checklist 复用。
  日期/作者：2026-06-08 / Codex。

## 结果与复盘

本轮实现已经完成代码、测试与设计文档同步。共享协议现在导出 `CanvasSurfaceLocation`、`CanvasSurfaceMode`、`WebviewLifecycleIdentity` 和 `extractWebviewMessageLifecycle()`；`getWebviewHtml()` 会在 active HTML 中注入宿主 lifecycle；Webview 侧统一 `postMessage()` 会附带带 `frameId` 的 lifecycle，并在应用 `host/bootstrap` 后发送 `webview/bootstrapAck`。

`CanvasPanelManager` 现在按 surface 维护 `surfaceLifecycle`，active/standby render 都递增 generation；真实 Webview 消息需要通过来源 Webview、surface、mode、generation 和 frameId 校验后才会改变 ready 或进入 active mutation。Bootstrap、probe、DOM action 和 Host->Webview 消息都会绑定当前 lifecycle；stale 消息只进入诊断事件，不再更新 `surfaceReady` 或 resolve 当前请求。测试命令合成的历史无 lifecycle 消息在测试模式下会补当前 lifecycle，以避免破坏既有 smoke。

已完成自动验证：`npm run typecheck`、`npm run test:protocol-webview-messages`、`npm run test:canvas-templates`、`npm run test:webview -- -g "lifecycle identity"` 均通过。完整 Webview baseline 子集仍有既有截图差异阻塞，需要单独收口或更新快照；真实 VS Code Panel 布局恢复场景仍需人工复验，设计文档已将验证状态临时标为“验证中”。

2026-06-03 19:42+08:00 复核用户新诊断后确认，调试方式本身没有问题，且 Debug Host 已运行新 lifecycle 代码。问题是第一轮 Host 侧 lifecycle 防护把“最后 attach 的 Webview 对象”等同于“当前可用 frame”，在 Panel restore 双 attach 中误杀了 generation 2 的 ready，导致 generation 4 当前对象一直没有 ready、没有 bootstrap。现在 Host 额外维护 `surfaceMessageWebview` 与 `renderedWebviewLifecycle`，并允许未 ready surface 的已渲染 active ready frame 提升为当前消息目标；这样 bootstrap 会发回真正完成启动的 frame，而不是继续等待一个没有 ready 的对象。补充验证已通过 `npm run typecheck`、`npm run test:protocol-webview-messages`、`npm run test:canvas-templates` 和 `npm run test:webview -- -g "lifecycle identity"`。

2026-06-08 第二批 debt hardening 把此前依赖人工诊断的 Host 双 attach/ready 竞态收口成可重复自动化。`CanvasPanelManager.runWebviewLifecycleRaceDiagnosticsForTest()` 在测试模式中构造两个 fake Webview：先 render 的旧 frame 和后 render 的竞争 frame。旧 frame 先发 ready 后必须被提升为当前消息目标，bootstrap 必须发给旧 frame；非 bootstrap 消息在 `webview/bootstrapAck` 前必须排队，ack 后再 flush；竞争 frame 发来的 active mutation、probe result 和 DOM action result 必须被识别为 stale 并不改变状态或 resolve 当前请求。该测试已接入 trusted VS Code smoke；真实用户 Panel restore 场景当时仍保留为人工复验项，并已在 2026-06-09 的最终复验中收口。

2026-06-08 第三批 debt hardening 把真实用户复验入口从“人工拼多份诊断 JSON”收口为面向 lifecycle 的聚合摘要。`CanvasPanelManager.dumpCurrentHostDiagnostics()` 现在在原有 dump 目录中额外写出 `webview-lifecycle-summary.json`，并把同一结构嵌入 `summary.json.webviewLifecycle`。该摘要按 `panel` / `editor` 分别记录 attached、visibility、interactive、ready、lifecycle、bootstrapAck、message target、pending bootstrap 队列、host message 投递计数、attach/render burst、ready promotion、stale/invalid lifecycle 事件、probe 结果、状态分类和建议下一步。用户执行 `Dev Session Canvas: 落盘当前宿主诊断` 后，提示会直接展示 lifecycle 状态；如果 `panelRestore.likelyAffected=true`，说明这份现场仍像 Panel restore lifecycle 阻塞，应优先分享整个 dump 目录继续分析。自动守护已覆盖摘要写出、attach/render burst 判断和 dump 命令提示链路。

2026-06-08 第四批 debt hardening 把第三批生成的摘要变成可离线消费的排障入口。`scripts/diagnostics/analyze-webview-lifecycle-dump.mjs` 可直接分析一个 dump 目录；如果未传目录，则自动选择 `.debug/current-host-diagnostics/` 下最新目录。脚本优先读取 `webview-lifecycle-summary.json`，缺失时 fallback 到 `summary.json.webviewLifecycle`，并关联可选的 `diagnostic-events.json`、`host-messages.json` 和 `panel-probe.json`。输出包含整体状态、Panel restore 风险、关键 flag、surface 摘要、最新事件、结论和建议下一步；退出码 `0` 表示未发现阻塞性 lifecycle 线索，`2` 表示 blocked / initializing 或 Panel restore 高风险，`1` 表示输入或解析错误。新增测试覆盖 healthy、blocked、fallback、缺失摘要和自动选择最新 dump。

2026-06-09 最终复验已收口。用户按原 Panel restore 风险布局采集的真实 dump 覆盖了连续 attach/render 与 ready promotion：`npm run diagnose:webview-lifecycle -- /home/users/ziyang01.wang-al/projects/dsc-test-01/.debug/current-host-diagnostics/2026-06-08T16-15-01-976Z` 输出退出码 `0`、整体状态 `attention`、`Panel restore 风险：否`，Panel surface 已 `attached=true`、`ready=true`、`bootstrapAck=true`，probe 为 `OK(nodeCount=16)`。维护者随后用真实 VS Code 录制 / Playwright CDP 工具启动 Extension Development Host，通过原生键盘路径打开 Panel 画布、执行 `Developer: Reload Window`、再次打开 Panel 并落盘诊断；`.debug/current-host-diagnostics/2026-06-08T16-31-24-283Z` 离线诊断为 `healthy`、`Panel restore 风险：否`、退出码 `0`。因此本计划目标已经完成，正式设计文档可恢复为“已验证”。保留的非阻塞风险是普通浏览器 Playwright baseline screenshot 仍可能因 UI 快照漂移失败，这不是 lifecycle blocker，后续应由截图基线维护单独收口。

## 上下文与定向

当前相关代码分布如下。`src/panel/CanvasPanelManager.ts` 是 Extension Host 里的画布控制器，管理 `editorPanel`、`panelView`、权威 `state`、`surfaceReady`、Host->Webview 消息和测试 probe。`src/panel/getWebviewHtml.ts` 生成 Webview HTML，是注入宿主 lifecycle generation 的入口。`src/webview/main.tsx` 是 React/React Flow 前端入口，负责接收 `host/bootstrap` 与 `host/stateUpdated` 并发送 `webview/ready`、probe 结果和用户操作。`src/common/protocol.ts` 定义 Host/Webview 共享消息类型与 parser。`tests/playwright/harness/webview-harness.html` 与 `tests/playwright/webview-harness.spec.mjs` 提供浏览器级 Webview harness。`scripts/test/test-protocol-webview-messages.mts` 覆盖共享协议解析。

现状里 `CanvasPanelManager.attachPanelView()` 会直接覆盖 `this.panelView`，`handleWebviewMessage(sourceSurface, message)` 只知道 surface，不知道消息来自哪一个 Webview 文档；`webview/ready` 也没有 generation 或 frameId。因此当 VS Code Panel 布局恢复导致同一个 view 短时间内出现两个 Webview 文档时，宿主可能从旧文档收到 ready，却把 bootstrap/probe 发到另一个当前 `panelView`，最终可见文档只有空 React Flow 背景。

## 工作计划

先在 `src/common/protocol.ts` 中定义 `CanvasSurfaceLocation`、`CanvasSurfaceMode` 和 `WebviewLifecycleIdentity`，并新增 `extractWebviewMessageLifecycle()`。这个函数只从未知消息上安全提取可选 lifecycle，不改变既有 parser 对历史消息的兼容性。然后在 `src/panel/getWebviewHtml.ts` 的 active HTML 中注入 `window.__DEV_SESSION_CANVAS_WEBVIEW_IDENTITY__`，内容包括 surface、mode 和宿主 generation。

接着在 `src/webview/main.tsx` 中读取这段注入信息，生成一个每个前端 frame 唯一的 `frameId`，并让本文件底部的统一 `postMessage()` 包装函数把 identity 加到所有 Webview->Host 消息上。处理 `host/bootstrap` 时，前端在应用状态后发送 `webview/bootstrapAck`，用于宿主确认“这一帧确实消费了 bootstrap”。测试 harness 需要接受并保留这些新消息。

最后改造 `src/panel/CanvasPanelManager.ts`。每次 active/standby render 都递增 surface generation，宿主把 generation 传入 HTML 并保存到 Webview 记录。Webview 消息处理函数增加来源上下文，先比较来源 Webview、generation、surface、mode 和 frameId；过期 ready、probe result、DOM action result、bootstrap ack 只记录诊断并忽略。`postState()`、`postMessageToSurface()`、probe 与 DOM action 请求都改为发给当前 lifecycle 绑定的 Webview，而不是仅凭 `this.panelView`。当 ready 来自当前可交互 source 时，宿主对同一个 Webview 发送 bootstrap，并把后续 test probe 绑定到该 frame。

用户新诊断证明还必须处理一个补充场景：Panel restore 双 attach 后，后 attach 的 `panelView` 可能覆盖字段，但先 attach 且已经 render 的 Webview frame 先发出 ready。因此 `CanvasPanelManager` 需要把“VS Code 当前 surface 对象”和“Host 当前消息目标 frame”分开：`surfaceMessageWebview` 负责 Host->Webview 投递和来源校验，`renderedWebviewLifecycle` 记录某个 Webview 是否确实由 Host 渲染过。只有当前 surface 尚未 ready、ready 消息 lifecycle 来自已渲染 active frame 时，才允许该 frame 被提升为消息目标。

## 具体步骤

在仓库根目录运行以下命令确认基线：

    git status --short
    npm run typecheck

编辑并验证的顺序如下：

    $EDITOR src/common/protocol.ts
    $EDITOR src/panel/getWebviewHtml.ts
    $EDITOR src/webview/main.tsx
    $EDITOR src/panel/CanvasPanelManager.ts
    $EDITOR tests/playwright/harness/webview-harness.html
    $EDITOR scripts/test/test-protocol-webview-messages.mts
    $EDITOR tests/playwright/webview-harness.spec.mjs

完成实现后运行：

    npm run typecheck
    npm run test:protocol-webview-messages
    npm run test:canvas-templates
    npm run test:webview

如果 `npm run test:webview` 时间过长或被无关断言阻塞，至少运行覆盖新 lifecycle 行为的 Playwright 子集，并在本计划中记录完整命令与输出。

## 验证与验收

验收标准一：协议 parser 能接受历史无 lifecycle 消息，也能从新消息中提取 surface、mode、generation 和 frameId；非法 surface、mode、generation 或 frameId 被拒绝。验收标准二：Webview harness 打开后第一条 ready 带有 lifecycle，接收 bootstrap 后会发送 `webview/bootstrapAck`，且 stale `host/bootstrap` 不会覆盖当前画布状态。验收标准三：宿主诊断记录中 ready、bootstrap、probe、DOM action 结果都包含 lifecycle 摘要；stale 消息不会把 `surfaceReady.panel` 错误置为 true，也不会 resolve 当前 probe。验收标准四：真实 VS Code Panel 布局恢复场景中，reload/reopen 后节点仍显示。

补充验收标准五：当诊断出现连续 `surface/attached` / `surface/rendered` 且较早 render 的 frame 先发 ready 时，只要该 ready lifecycle 来自 Host 渲染过的 active frame，并且当前 surface 还没有 ready，Host 应记录 `surface/readyWebviewPromoted`，随后出现 `surface/ready`、`host/bootstrap` 和 `surface/bootstrapAck`；不应再停留在 `surfaceReady.panel = false`。

补充验收标准六：Host 级自动化必须通过 `devSessionCanvas.__test.runWebviewLifecycleRaceDiagnostics` 证明双 render / ready 竞争、bootstrap ack gating、stale mutation、stale probe result 和 stale DOM action result 均被稳定覆盖；该命令只在测试模式注册，不进入用户可见命令面。

补充验收标准七：用户执行 `Dev Session Canvas: 落盘当前宿主诊断` 后，dump 目录必须包含 `webview-lifecycle-summary.json`；`summary.json` 必须包含同一份 `webviewLifecycle` 摘要。真实 Panel restore 现场若仍出现连续 attach/render、ready 缺失、bootstrapAck 缺失、ready 后 probe 失败或 stale lifecycle 消息，摘要必须把 `panelRestore.likelyAffected` 标为 true 或至少把 surface 状态标为 `blocked` / `attention`，并给出下一步复验说明。

## 幂等性与恢复

本计划只修改仓库内源码、测试和文档，不需要破坏性 git 操作。重复运行测试是安全的。若某个实现步骤中断，可以用 `git diff` 查看局部改动，并继续从当前文件恢复。不要删除用户预先存在的未跟踪文件，例如 `.debug.zip`、`.tmp-playwright/` 和根目录图片文件。若发现非本轮产生的已跟踪文件变化，应停止并询问用户。

## 证据与备注

当前基线诊断的关键片段如下：

    diagnostic-events.json:
    2026-06-03T05:57:31.092Z surface/attached {"surface":"panel"}
    2026-06-03T05:57:31.093Z surface/rendered {"surface":"panel","mode":"active"}
    2026-06-03T05:57:31.101Z surface/attached {"surface":"panel"}
    2026-06-03T05:57:31.102Z surface/rendered {"surface":"panel","mode":"active"}
    2026-06-03T05:57:31.415Z surface/ready {"surface":"panel","mode":"active","activeSurface":"panel"}

    panel-probe.json:
    attached=true, ready=true, interactive=true, visibility=visible,
    error="等待 panel Webview probe 返回超时（2500ms）。"

本轮验证记录如下：

    npm run typecheck
    > tsc --noEmit
    通过。

    npm run test:protocol-webview-messages
    protocol webview message tests passed

    npm run test:canvas-templates
    通过。

第二批验证记录如下：

    npm run typecheck
    > tsc --noEmit
    通过。

    npm run test:protocol-webview-messages
    protocol webview message tests passed

    npm run test:webview -- --grep "lifecycle identity"
    2 passed；Playwright webview tests passed。

    DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=trusted npm run test:smoke
    Trusted workspace smoke passed.
    VS Code smoke test passed.

    node --check tests/vscode-smoke/extension-tests.cjs
    通过。

    git diff --check
    通过。

第三批验证记录如下：

    npm run typecheck
    > tsc --noEmit
    通过。

    npm run test:protocol-webview-messages
    protocol webview message tests passed

    npm run test:webview -- --grep "lifecycle identity"
    2 passed；Playwright webview tests passed。

    DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=trusted npm run test:smoke
    Trusted workspace smoke passed.
    VS Code smoke test passed.

    node --check tests/vscode-smoke/extension-tests.cjs
    通过。

    git diff --check
    通过。

第四批验证记录如下：

    npm run typecheck
    > tsc --noEmit
    通过。

    npm run test:webview-lifecycle-diagnostics
    webview lifecycle diagnostics tests passed

    npm run test:protocol-webview-messages
    protocol webview message tests passed

    node --check scripts/diagnostics/analyze-webview-lifecycle-dump.mjs
    通过。

    node --check scripts/test/test-webview-lifecycle-diagnostics.mjs
    通过。

    npm run diagnose:webview-lifecycle -- --help
    输出用法与退出码说明。

    git diff --check
    通过。

    npm run test:webview -- -g "lifecycle identity"
    1 passed；Playwright webview tests passed。

    npm run test:webview -- -g "lifecycle identity"
    1 passed；Playwright webview tests passed。

    npm run test:webview -- -g "webview bundle emits ready|lifecycle identity"
    lifecycle identity 用例通过；baseline screenshot 用例失败，差异为 7654 pixels，失败附件位于 `.debug/playwright/results/webview-harness-webview-bu-f97a0-hes-the-baseline-screenshot/`。

用户新诊断关键片段如下：

    summary.json:
    surfaceLifecycle.panel = {"generation":4,"mode":"active","ready":false,"bootstrapAck":false}
    probes.panel.error = "surface-not-ready"

    diagnostic-events.json:
    2026-06-03T11:16:10.070Z surface/attached {"surface":"panel"}
    2026-06-03T11:16:10.071Z surface/rendered {"surface":"panel","mode":"active","lifecycle":{"surface":"panel","mode":"active","generation":2}}
    2026-06-03T11:16:10.081Z surface/attached {"surface":"panel"}
    2026-06-03T11:16:10.081Z surface/rendered {"surface":"panel","mode":"active","lifecycle":{"surface":"panel","mode":"active","generation":4}}
    2026-06-03T11:16:10.248Z webview/staleMessageIgnored {"type":"webview/ready","reason":"source-webview-mismatch","lifecycle":{"generation":2,"frameId":"frame-..."},"currentLifecycle":{"generation":4}}

    debug-snapshot.json:
    state.nodes.length = 33

补充修复验证记录如下：

    npm run typecheck
    > tsc --noEmit
    通过。

    npm run test:protocol-webview-messages
    protocol webview message tests passed

    npm run test:canvas-templates
    通过。

## 接口与依赖

`src/common/protocol.ts` 必须导出以下稳定类型和函数，供 Host、Webview 与测试共用：

    export type CanvasSurfaceLocation = 'editor' | 'panel';
    export type CanvasSurfaceMode = 'active' | 'standby';
    export interface WebviewLifecycleIdentity {
      surface: CanvasSurfaceLocation;
      mode: CanvasSurfaceMode;
      generation: number;
      frameId?: string;
    }
    export function extractWebviewMessageLifecycle(value: unknown): WebviewLifecycleIdentity | undefined;

`src/panel/getWebviewHtml.ts` 的 active HTML 生成函数必须接收宿主分配的 `lifecycle`，并在脚本加载前写入 `window.__DEV_SESSION_CANVAS_WEBVIEW_IDENTITY__`。`src/webview/main.tsx` 必须通过统一 `postMessage()` 附加 lifecycle，避免遗漏某个消息分支。`CanvasPanelManager` 必须用来源 Webview 和 lifecycle 验证 ready、ack、probe result 与 DOM action result，不能再只按 surface 判断当前消息是否可信。

`CanvasPanelManager` 还必须把当前 surface 对象与当前消息目标分开。`surfaceMessageWebview` 是 Host->Webview 消息和 Webview->Host 来源校验使用的目标；`renderedWebviewLifecycle` 是 WeakMap，用来证明某个 Webview 对象确实被 Host render 过。`webview/ready` 的处理顺序必须先尝试 `promoteReadyWebviewMessageIfNeeded()`，再执行 `isCurrentWebviewMessage()`，否则 Panel restore 双 attach 中较早完成启动的 frame 会继续被误判为 stale。

测试模式中还必须存在 `CanvasPanelManager.runWebviewLifecycleRaceDiagnosticsForTest()`，并通过 `devSessionCanvas.__test.runWebviewLifecycleRaceDiagnostics` 注册为测试命令。它不应创建真实 VS Code Webview，而是用 fake `vscode.Webview` 对象捕获 `postMessage()`，从而稳定覆盖 Host 侧 lifecycle 状态机。

用户可见诊断入口继续使用 `devSessionCanvas.dumpHostDiagnostics`。该命令必须调用 `CanvasPanelManager.dumpCurrentHostDiagnostics()`，并在结果里使用 `webviewLifecycleStatus`、`webviewLifecyclePanelRestoreLikelyAffected` 和 `webviewLifecycleSummaryPath`。`webview-lifecycle-summary.json` 的语义是排障摘要，不是正式运行时状态；它只能总结当前 dump 中已有的宿主事件、Host 消息和 Webview probe 结果，不能替代真实前端渲染确认。

离线诊断入口是 `scripts/diagnostics/analyze-webview-lifecycle-dump.mjs`，对外通过 `package.json` 的 `diagnose:webview-lifecycle` 暴露。它不能依赖 VS Code API 或构建产物，只能使用 Node.js 标准库读取 dump JSON。脚本必须优先读取 `webview-lifecycle-summary.json`，再 fallback 到 `summary.json.webviewLifecycle`；必须保留 `analyzeWebviewLifecycleDump()` 和 `formatWebviewLifecycleReport()` 这两个可测试导出；阻塞性发现使用退出码 `2`，输入或 JSON 解析错误使用退出码 `1`。

## 计划修订记录

- 2026-06-03：创建计划，记录基线诊断、目标、实现顺序和验证口径，用于本轮 Panel Webview 生命周期修复。
- 2026-06-03：完成 lifecycle identity 实现、测试与设计文档同步；记录 baseline screenshot 非本轮阻塞和真实 Panel restore 待人工复验。
- 2026-06-03：根据用户新诊断修订计划，记录 Debug Host 已运行新代码、根因变为 ready frame 被 source-webview-mismatch 误杀，并补充 `surfaceMessageWebview` 提升策略、验证记录与新的验收标准。
- 2026-06-08：记录第二批 Host lifecycle race 自动化、test-only 诊断命令、trusted smoke 验证结果，以及真实 Panel restore 仍需人工复验的边界。
- 2026-06-08：记录第三批真实 Panel restore 诊断摘要、用户可见 dump 提示和新增验收标准七。
- 2026-06-08：记录第四批离线诊断 CLI、退出码约定、测试入口和验收标准八。
- 2026-06-09：记录用户原风险布局人工复验、维护者真实宿主原生操作复验、设计文档验证状态恢复为“已验证”，并将本计划归档到 `completed/`。
