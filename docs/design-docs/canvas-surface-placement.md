---
title: 画布宿主承载面设计
decision_status: 已选定
validation_status: 已验证
domains:
  - VSCode 集成域
  - 画布交互域
  - 项目状态域
architecture_layers:
  - 宿主集成层
  - 画布呈现层
  - 共享模型与编排层
related_specs:
  - docs/product-specs/canvas-core-collaboration-mvp.md
  - docs/product-specs/canvas-navigation-and-workbench-polish.md
related_plans:
  - docs/exec-plans/completed/canvas-surface-configurable-host.md
  - docs/exec-plans/active/canvas-config-reload-semantics.md
  - docs/exec-plans/completed/canvas-panel-webview-lifecycle-identity.md
updated_at: 2026-06-09
---

# 画布宿主承载面设计

## 1. 背景

当前仓库已经完成了“画布主界面进入编辑区 `WebviewPanel`”“侧栏承担极简全局控件”“四类节点进入无限画布”的第一轮收口。这个收口解决了“画布不该被顶部固定 chrome 占满”的问题，但还没有解决另一个更直接的使用痛点：主画布仍然和普通文件编辑共享同一块编辑区。

这会带来一个很具体的回路成本：用户一旦点开其他文件，主画布 tab 就会被切走；即便画布没有关闭，回到主画布也要额外定位。对于一个承担“全局协作状态主视图”的工作面来说，这个返回路径仍然太脆弱。

## 2. 问题定义

本轮需要明确以下问题：

1. 主画布是否必须固定在编辑区，还是应该允许用户选择更稳定的宿主承载面。
2. 如果允许选择，哪些 VS Code 宿主区域是真正可行的。
3. 多个宿主 surface 之间的状态、恢复和执行会话应该如何划边界。
4. 如何在不引入双活同步复杂度的前提下，让 `editor` 与 `panel` 两种承载面都可用。

## 3. 目标

- 让主画布支持 `editor` 与 `panel` 两种宿主承载面。
- 保持对象图、执行会话和恢复链路继续由 Extension Host 持有权威状态。
- 让用户可以通过设置或显式命令决定主画布出现在哪个宿主区域。
- 在 `panel` 承载面下解决“打开文件会挤走主画布”的直接问题。

## 4. 非目标

- 不在本轮支持 `sidebar` 作为完整主画布承载面。
- 不在本轮支持 `editor` 与 `panel` 双活同步。
- 不在本轮把主画布改造成 `CustomEditor` 或资源型文档模型。
- 不在本轮改变四类节点的字段与执行会话后端。

## 5. 候选方案

### 5.1 继续把主画布固定在编辑区

优点：

- 当前实现已经成立。
- `WebviewPanelSerializer` 恢复链路清晰。
- 画布宽度和高度最宽松。

问题：

- 用户点开其他文件时，主画布会和编辑器主路径竞争同一宿主区域。
- 这让“回到全局工作面”的路径持续依赖标签页管理，而不是稳定入口。

### 5.2 把主画布固定切到 Panel

优点：

- 主画布不再和文件编辑直接互斥。
- 对“始终留一个全局工作面在屏幕上”更友好。

问题：

- 直接把编辑区路线整体替换成 Panel，会失去当前已验证的 `WebviewPanel` 恢复路径。
- 对习惯把 Panel 保持较小高度的用户，完整画布的第一感受可能过窄。
- 一刀切切换到 Panel，会让已有用户失去编辑区画布这条已被验证的工作流。

### 5.3 支持 `editor/panel` 可配置承载面

优点：

- 同时覆盖“需要最大可见面积”和“需要不与编辑区打架”两类使用场景。
- 可以保留现有 `WebviewPanel` 路线，不必推翻已成立的对象图与恢复链路。
- 用户可以按 workspace、习惯或当前任务决定主画布出现在哪里。

风险：

- 宿主层要同时管理 `WebviewPanel` 与 `WebviewView` 两种 surface 生命周期。
- 如果让两个 surface 双活，会立刻抬高执行会话与终端附着复杂度。

### 5.4 支持 `editor/panel` 同时双活

优点：

- 用户可以在两个宿主区域同时看到同一张画布。

不选原因：

- 这会把 Agent / Terminal 节点的会话附着、PTY resize、局部 UI 状态同步和冲突处理都升级到高复杂度问题。
- 当前用户已经明确表示“不需要同时显示两个画板”。

### 5.5 支持 `sidebar` 作为完整主画布

优点：

- 也能避免与编辑区直接互斥。

不选原因：

- `sidebar` 宽度约束和完整无限画布主工作面冲突更大。
- 当前问题并不要求把主画布塞进更窄的宿主区域，只要求避开编辑区竞争。

## 6. 风险与取舍

- 取舍：第一版采用“单主 surface”。
  原因：当前真正需要共享的是对象图和执行状态，而不是两个宿主 surface 上的局部相机、选中态和终端网格。把双活排除后，复杂度大幅下降。

- 取舍：`editor` 继续用 `WebviewPanel`，`panel` 使用 `WebviewView`。
  原因：前者已经有序列化恢复链路；后者更适合嵌入 VS Code Panel 容器，且不会和文件编辑路径抢同一标签组。

- 风险：旧版 VS Code 对自定义 view 的 reveal 命令支持可能不完全一致。
  当前缓解：显式命令优先尝试 reveal；如果宿主无法自动打开 panel view，至少要给出清晰降级提示，而不是静默无效。

- 取舍：`devSessionCanvas.canvas.defaultSurface` 采用两段式生效语义，而不是单纯的实时配置或单纯的 reload 后生效。
  原因：扩展/画布尚未激活前，`package.json` 的原生 `when` 表达式可以读取 Settings 当前值，让默认 `panel` 在 VS Code 启动后先显示 Panel 入口；画布一旦在当前窗口激活，真正的主画布承载面由 `CanvasPanelManager` 的已应用启动配置快照决定，运行中改设置不热重建当前画布，需要 `Window Reload` 才完整切换默认承载面。

- 取舍：Panel tab 的显隐使用 `contributes.views[*].when` 中的启动前配置判断 + 自定义 workbench context key，而不是通过 `onStartupFinished` 自动激活扩展或 reveal Webview。
  原因：`config.devSessionCanvas.canvas.defaultSurface == 'panel' && !devSessionCanvas.canvas.panelVisibilityManaged` 可以让 VS Code 在扩展尚未激活时就把 `Dev Session Canvas` view 放进原生 Panel 区域，满足默认 `panel` 的承载位置预期；扩展激活后设置 `panelVisibilityManaged=true`，再由 `panelViewVisible` 表达“本 window 已应用的默认承载面 + 当前是否显式切到 panel”，避免运行中设置变更绕过 reload 语义。这条路径只解决 Panel tab 可发现性，不自动把画布拉到前台，也不在每个窗口启动时渲染 Webview 内容。

- 取舍：startup / reload 恢复不仅记录上次 `activeSurface`，还要同时记录当时已应用的 `defaultSurface`；如果两次启动的 `defaultSurface` 不一致，旧 opposite surface 不得继续在恢复阶段抢回主画布。
  原因：用户把 `defaultSurface` 从 `panel` 切到 `editor`（或反向）后，重启窗口的首要预期是“新配置接管启动位置”，而不是继续被上次 session 的旧 surface 覆盖。

- 风险：如果两个 surface 被用户同时打开，执行型节点容易出现重复附着。
  当前缓解：非活动 surface 只显示静态切换提示，不渲染真正的画布应用。

- 风险：Panel 的几何空间和编辑区不同，用户可能担心终端 PTY 网格重新计算。
  当前缓解：画布缩放不等价于 PTY resize；第一版不把“terminal cols/rows 重新计算”作为 surface 切换主复杂点。

## 7. 正式方案

### 7.1 主画布支持两种宿主承载面

- 主画布允许出现在：
  - 编辑区 `WebviewPanel`
  - Panel 容器中的 `WebviewView`
- `sidebar` 不作为本轮完整主画布承载面。

### 7.2 默认按配置打开主画布

- 新增配置项 `devSessionCanvas.canvas.defaultSurface`，枚举值为 `editor | panel`。
- `Dev Session Canvas: 打开画布` 按当前 window 已应用的默认承载面打开；画布激活后，运行中的 window 改设置不会即时重建当前画布，需要 `Window Reload` 才会完整切到新的默认承载面。
- Settings 描述必须明确注明两段式语义：扩展/画布尚未激活前，原生 Panel 入口可先按 Settings 当前值显示或隐藏；画布激活后，本窗口实际承载面按已应用配置运行，默认承载面变更需要重新加载窗口后才完整生效。
- 如果上次持久化时记录的 `defaultSurface` 与当前 window 启动配置不同，则 restart / reload 时不恢复旧 opposite surface；启动 surface 直接收口到当前 `defaultSurface`，避免旧 panel / editor 容器在恢复链路里继续占住主画布。
- 同时保留显式命令，使用户可以直接在编辑区或 Panel 中打开主画布，而不必每次先改设置。
- 创建类入口采用“已打开 surface 优先”：普通创建节点、Explorer 创建 Terminal / Agent、Explorer Markdown 创建关联 Note、创建分组、应用 / 重置模板以及内部安装命令 Terminal 都先复用当前窗口已经打开的主画布 surface；只有当前没有打开的主画布 surface 时，才按 `defaultSurface` 创建默认承载面。
- 该规则只影响“把对象创建到画板中”的入口，不改变 `Dev Session Canvas: 打开画布` 的默认打开语义，也不改变“在编辑区打开画布 / 在面板打开画布”两个显式切换命令。

### 7.3 Panel tab 的可见性跟随已应用的承载面

- Panel 中的 `Dev Session Canvas` view 使用原生 `when` 条件控制可见性，而不是改动 DOM 或注入样式。
- 启动前的可见性先由 `config.devSessionCanvas.canvas.defaultSurface == 'panel' && !devSessionCanvas.canvas.panelVisibilityManaged` 兜底，使默认 `panel` 配置在 VS Code 打开后即可看到原生 Panel view 入口；扩展激活后设置 `panelVisibilityManaged=true`，再由 `devSessionCanvas.canvas.panelViewVisible` context key 表达当前 window 实际应用的承载面与显式切换状态。
- 当当前 window 已应用的默认承载面是 `editor`，且用户没有显式切到 panel 时，Panel 中不显示冗余的 `Dev Session Canvas` tab。
- 当默认承载面是 `panel`，或用户显式执行“在面板打开画布”并切到 panel 时，Panel view 会重新显示并承载画布。
- 这里不新增 `onStartupFinished`，也不在启动时自动执行 reveal；用户如果上次没有把 Panel 打到前台，扩展不强行改变 VS Code 当前焦点或直接显示画布内容。

### 7.4 采用单主 surface 模型

- 任一时刻只允许一个主画布 surface 处于可交互状态。
- 非活动 surface 如果被用户展开，只显示静态提示和切换入口，不承载真正的画布应用，也不附着执行会话。
- 这样可以继续复用“Host 持有权威状态，Webview 负责投影”的现有总图。

### 7.5 状态边界保持不变

- 对象图、执行会话、运行状态和持久化仍由 Extension Host 持有。
- `editor` 与 `panel` surface 的局部 UI 状态不强制共享，例如相机、滚动和临时选中态。
- Surface 切换时，新的主画布通过 bootstrap 重新从宿主获取当前权威状态。

### 7.6 终端尺寸不是本轮主复杂点

- 画布缩放不应直接触发终端 PTY `cols/rows` 重算。
- 当前嵌入式终端尺寸更新依赖实际终端容器尺寸，而不是 React Flow 视图缩放。
- 因此 `editor/panel` 方案的主复杂点应收口在 surface 生命周期、入口和会话重新附着，而不是终端网格算法。

### 7.7 Webview 生命周期身份是 active surface 的消息边界

- `src/panel/CanvasPanelManager.ts` 为每个 surface 维护 `surfaceLifecycle`，每次 active 或 standby HTML render 都递增 `generation`，并把 `surface`、`mode`、`generation` 传给 `src/panel/getWebviewHtml.ts`。
- `src/panel/getWebviewHtml.ts` 只在 active HTML 中注入 `window.__DEV_SESSION_CANVAS_WEBVIEW_IDENTITY__`；`src/webview/main.tsx` 启动后再为当前前端 frame 生成唯一 `frameId`。
- `src/common/protocol.ts` 定义 `CanvasSurfaceLocation`、`CanvasSurfaceMode`、`WebviewLifecycleIdentity` 和 `extractWebviewMessageLifecycle()`；共享 parser 仍接受历史无 lifecycle 的消息，但宿主对真实 Webview 发来的 ready、bootstrap ack、probe、DOM action 和 active mutation 会校验 lifecycle。
- Host 接受 `webview/ready` 后只向同一 lifecycle 发送 `host/bootstrap`；Webview 应用 bootstrap 后发送 `webview/bootstrapAck`。Host 只有在 ack 后才向该 active frame 推送模板 catalog，避免旧 frame ready 让新 frame 错过初始化状态。
- Host 会把 VS Code 当前 surface 对象与当前消息目标 frame 分开维护。`surfaceMessageWebview` 负责 Host->Webview 投递和来源校验；如果 Panel restore 双 attach 后较早 render 的 active frame 先发 ready，且当前 surface 尚未 ready，Host 可以把该已渲染 frame 提升为当前消息目标，再对它发送 bootstrap。
- Host->Webview 消息会携带当前 surface lifecycle；Webview 收到带 lifecycle 的 host 消息时，如果 `surface`、`mode`、`generation` 或 `frameId` 与自身不一致，就忽略这条消息。
- 过期或非法 lifecycle 消息不改变 `surfaceReady`，也不能 resolve 当前 probe / DOM action；宿主通过 `webview/staleMessageIgnored`、`webview/staleProbeResultIgnored`、`webview/staleDomActionResultIgnored` 等诊断事件保留证据。
- 用户可见的 `Dev Session Canvas: 落盘当前宿主诊断` 会额外输出 `webview-lifecycle-summary.json`，并在 `summary.json.webviewLifecycle` 中内嵌同一摘要。摘要按 surface 汇总 attached、ready、bootstrapAck、message target、pending bootstrap 队列、host message 投递、attach/render burst、stale lifecycle 事件和 probe 结果，用于判断真实 Panel restore 现场是否仍像 lifecycle 阻塞。
- 协作者可在仓库根目录运行 `npm run diagnose:webview-lifecycle -- <dump-dir>` 离线分析上述 dump；该脚本优先读取 `webview-lifecycle-summary.json`，再 fallback 到 `summary.json.webviewLifecycle`，输出中文结论，并用退出码 `0` / `2` / `1` 表示健康、阻塞或 Panel restore 高风险、输入或解析错误。
- 测试模式暴露 `devSessionCanvas.__test.runWebviewLifecycleRaceDiagnostics`，用两个 fake `vscode.Webview` 对象稳定复现 Panel 双 render / ready 竞争：较早 render 的 frame 先 ready 时应被提升，bootstrap 发回同一 frame；非 bootstrap host 消息必须等 `webview/bootstrapAck` 后 flush；来自竞争 frame 的 active mutation、probe result 和 DOM action result 必须被忽略。
- 该机制不改变对象图权威边界：节点、执行会话和持久化仍由 Extension Host 持有；Webview 仍是可丢弃投影，不依赖 `retainContextWhenHidden` 证明状态已被前端消费。

## 8. 验证方法

至少需要完成以下验证后，才能把本设计重新推进到“已验证”：

1. 在 `Extension Development Host` 中把默认承载面设为 `panel`，执行 `Dev Session Canvas: 打开画布`，确认主画布出现在 Panel，而不是编辑区。
2. 在 `Extension Development Host` 中把默认承载面设为 `panel` 并重启窗口，确认无需先点击 Activity Bar 容器，原生 Panel 区域已经能发现 `Dev Session Canvas` view；同时确认扩展没有因为启动而强行 reveal 画布内容。
3. 在扩展/画布尚未激活前把默认承载面设为 `panel`，确认原生 Panel 区域可以先显示 `Dev Session Canvas` view 入口；随后打开画布，确认它不会因为入口可见而被自动 reveal 到前台。
4. 在画布已经激活且不 reload 的前提下把默认承载面改为 `editor`，再次执行同一命令，确认当前 window 仍按已应用旧配置打开；执行 `Window Reload` 后，确认旧 `panel` surface 没有在 startup restore 阶段重新占用主画布，再次执行同一命令时主画布应回到编辑区。反向 `editor -> panel` 路径也要做同样检查。
5. 当当前 window 已应用的默认承载面为 `editor` 时，确认 Panel 中不再常驻冗余的 `Dev Session Canvas` tab；显式执行“在面板打开画布”后，确认同一个原生 panel view 可以被再次显示。
6. 在两种承载面中分别创建至少一个执行型节点，确认对象图不丢失，执行会话可重新附着。
7. 当非活动 surface 被用户展开时，确认它只展示静态切换提示，不会出现第二个可交互终端窗口。
8. 运行 `npm run build`；如果 `npm run typecheck` 失败，必须明确区分是否是本任务新引入问题。
9. trusted smoke 至少要覆盖“修改 `defaultSurface` 后 reload 不应恢复旧 surface”这一回归路径；如果整套 smoke 被后续无关断言阻塞，也要明确记录阻塞点。
10. 真实 Panel restore 诊断中如果出现连续两次 `surface/attached` / `surface/rendered`，随后应能看到 `surface/ready`、`host/bootstrap` 和 `surface/bootstrapAck`；若较早 render 的 frame 先 ready，可接受出现 `surface/readyWebviewPromoted`，但不应停留在 `surfaceReady.panel = false`。
11. 当主画布已在 `panel` 打开且默认承载面仍为 `editor` 或相反时，普通创建节点、Explorer 创建 Terminal / Agent 和 Explorer Markdown 创建关联 Note 都应继续复用已打开 surface，不应因为 `defaultSurface` 切换到另一种 surface。
12. Host 侧 lifecycle fault injection 必须通过 `devSessionCanvas.__test.runWebviewLifecycleRaceDiagnostics` 自动覆盖双 render / ready 竞争、bootstrap ack gating、stale mutation、stale probe result 和 stale DOM action result。
13. 用户执行 `Dev Session Canvas: 落盘当前宿主诊断` 后，应能在 dump 目录看到 `webview-lifecycle-summary.json`；若真实 Panel restore 现场仍有连续 attach/render、ready 缺失、bootstrapAck 缺失、ready 后 probe 失败或 stale lifecycle 消息，摘要必须把对应 surface 标成 `blocked` / `attention`，并在 `panelRestore` 中暴露可追踪判断。
14. 协作者拿到 dump 目录后，应能运行 `npm run diagnose:webview-lifecycle -- <dump-dir>` 离线获得整体状态、Panel restore 风险、surface 摘要、最新事件和建议下一步；健康 dump 退出码为 `0`，blocked / initializing 或 Panel restore 高风险 dump 退出码为 `2`，缺失或非法 JSON 退出码为 `1`。

## 9. 当前验证状态

- `editor/panel` 可配置承载面实现已完成，设计结论继续保持为“支持 `editor/panel` 可配置承载面，采用单主 surface 模型”。
- 本轮实现已改为同时持久化 `activeSurface` 与当时已应用的 `defaultSurface`；如果下一次启动发现两次 `defaultSurface` 不一致，就不再恢复旧 opposite surface，而是按当前 `defaultSurface` 收口启动 surface。
- 当 `runtimePersistence.enabled` 在两次启动之间发生切换时，旧的 surface 恢复元数据同样视为宿主状态的一部分被整体丢弃；新窗口直接回到当前 `defaultSurface`，不再恢复上次实际工作的 opposite surface。
- 2026-05-16 补充：Panel view 的 `when` 条件已加入 `config.devSessionCanvas.canvas.defaultSurface == 'panel' && !devSessionCanvas.canvas.panelVisibilityManaged` 启动前兜底，因此默认 `panel` 时 VS Code 打开后即可在原生 Panel 区域发现 `Dev Session Canvas` view；扩展激活后仍由 `panelViewVisible` 接管当前 window 的 reload 语义，且不使用 `onStartupFinished` 自动激活，也不在启动时自动 reveal Webview 内容。
- 2026-06-03 补充：Panel Webview 生命周期身份方案已经完成代码与自动化验证的第一轮收口。`npm run typecheck`、`npm run test:protocol-webview-messages`、`npm run test:canvas-templates` 与 `npm run test:webview -- -g "lifecycle identity"` 已通过。
- 2026-06-03 补充：用户调试诊断 `current-host-diagnostics/2026-06-03T11-16-15-601Z` 证明 Debug Host 已运行新 lifecycle 代码；剩余问题不是调试方式错误，而是 Panel restore 双 attach 下 generation 2 的 ready 被 `source-webview-mismatch` 误判为 stale，generation 4 当前对象一直未 ready。Host 侧已补 `surfaceMessageWebview` / `renderedWebviewLifecycle`，允许未 ready surface 的已渲染 active frame 在 stale 检查前提升为消息目标。
- 2026-06-03 补充：补充修复后已重新通过 `npm run typecheck`、`npm run test:protocol-webview-messages`、`npm run test:canvas-templates` 和 `npm run test:webview -- -g "lifecycle identity"`。该补充修复当时仍需用户按原布局再采一份诊断确认出现 ready/bootstrap/ack；该人工复验已在 2026-06-09 的记录中收口。
- 2026-06-03 补充：`npm run test:webview -- -g "webview bundle emits ready|lifecycle identity"` 中 lifecycle 用例通过，但既有 baseline screenshot 用例仍因当前 Linux 快照差异失败；该失败展示为 Agent subtitle 多出 cwd label、终端 resize handle 形态差异，并非 lifecycle stale 防护的断言结果。
- 2026-06-08 补充：第二批 lifecycle debt hardening 已把 Panel 双 render / ready 竞争收口为 Host 级自动化。`devSessionCanvas.__test.runWebviewLifecycleRaceDiagnostics` 会构造两个 fake Webview 验证 ready promotion、bootstrap ack gating、竞争 frame mutation 忽略，以及 probe / DOM action 结果来源绑定；已通过 `DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=trusted npm run test:smoke`。
- 2026-06-08 补充：第三批 lifecycle debt hardening 已把真实 Panel restore 人工复验入口收口到现有宿主诊断命令。`dumpCurrentHostDiagnostics()` 会写出 `webview-lifecycle-summary.json`，并在用户提示里直接显示 lifecycle 状态和 Panel restore 风险；本批已通过 `npm run typecheck`、`npm run test:protocol-webview-messages`、`npm run test:webview -- --grep "lifecycle identity"`、`DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=trusted npm run test:smoke`、`node --check tests/vscode-smoke/extension-tests.cjs` 和 `git diff --check`。
- 2026-06-08 补充：第四批 lifecycle debt hardening 已新增离线诊断入口 `npm run diagnose:webview-lifecycle -- <dump-dir>`，用于在不启动 VS Code 的情况下分析第三批 dump 摘要；本批已通过 `npm run typecheck`、`npm run test:webview-lifecycle-diagnostics`、`npm run test:protocol-webview-messages`、`node --check scripts/diagnostics/analyze-webview-lifecycle-dump.mjs`、`node --check scripts/test/test-webview-lifecycle-diagnostics.mjs` 和 `git diff --check`。
- 用户已于 2026-04-18 完成手动复验，确认 `panel -> editor` 与 `editor -> panel` 两条 restart 路径都已按新的 `defaultSurface` 收口，不再恢复旧 opposite surface。
- 2026-06-09 补充：真实 VS Code Panel 布局恢复人工复验已通过。用户在原风险布局中采集 `/home/users/ziyang01.wang-al/projects/dsc-test-01/.debug/current-host-diagnostics/2026-06-08T16-15-01-976Z`，离线诊断退出码为 `0`，整体状态为 `attention`、`Panel restore 风险：否`，且 `panel` 为 `attached=true`、`ready=true`、`bootstrapAck=true`、`probe=OK(nodeCount=16)`；诊断同时出现 29ms 内 4 次 attach/render 与 `surface/readyWebviewPromoted`，证明高风险双 attach/render 路径已进入 ready/bootstrap/ack 闭环而非白屏阻塞。
- 2026-06-09 补充：维护者又用真实 VS Code 录制 / Playwright CDP 工具启动 `Extension Development Host`，通过原生按键执行 Panel 打开、`Developer: Reload Window` 和宿主诊断命令；生成的 `.debug/current-host-diagnostics/2026-06-08T16-31-24-283Z` 离线诊断为 `healthy`、`Panel restore 风险：否`、退出码 `0`，`panel` 为 `attached=true`、`ready=true`、`bootstrapAck=true`、`probe=OK(nodeCount=1)`。
- trusted smoke 已新增“reload 后旧 surface 不应恢复”的自动化断言；在当前 head 上整套 trusted smoke 仍被无关的 `verifyLegacyTaskFiltering` 阻塞。
- restricted smoke 已补跑；当前仍被无关的 `verifyRestrictedLiveRuntimeReconnectBlocked` 断言阻塞。
- 2026-06-08 补充：创建类入口已收口为“已打开 surface 优先，未打开时才使用默认承载面”。本轮通过 `node --check tests/vscode-smoke/extension-tests.cjs`、`npm run typecheck`、`npm run test:extension-manifest`、`npm run test:note-markdown-file-association` 和 `git diff --check`；`DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=trusted npm run test:smoke` 已执行到后续 `verifyRuntimeReloadPreservesConfiguredTerminalScrollbackHistory` 后命中既有 serialized terminal scrollback 断言，说明本轮新增的普通创建节点、Explorer Terminal / Agent 与 Explorer Markdown Note 已打开 panel surface 复用断言均已通过。
