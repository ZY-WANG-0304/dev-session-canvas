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
updated_at: 2026-05-18
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

## 7. 当前结论

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

## 9. 当前验证状态

- `editor/panel` 可配置承载面实现已完成，设计结论继续保持为“支持 `editor/panel` 可配置承载面，采用单主 surface 模型”。
- 本轮实现已改为同时持久化 `activeSurface` 与当时已应用的 `defaultSurface`；如果下一次启动发现两次 `defaultSurface` 不一致，就不再恢复旧 opposite surface，而是按当前 `defaultSurface` 收口启动 surface。
- 当 `runtimePersistence.enabled` 在两次启动之间发生切换时，旧的 surface 恢复元数据同样视为宿主状态的一部分被整体丢弃；新窗口直接回到当前 `defaultSurface`，不再恢复上次实际工作的 opposite surface。
- 2026-05-16 补充：Panel view 的 `when` 条件已加入 `config.devSessionCanvas.canvas.defaultSurface == 'panel' && !devSessionCanvas.canvas.panelVisibilityManaged` 启动前兜底，因此默认 `panel` 时 VS Code 打开后即可在原生 Panel 区域发现 `Dev Session Canvas` view；扩展激活后仍由 `panelViewVisible` 接管当前 window 的 reload 语义，且不使用 `onStartupFinished` 自动激活，也不在启动时自动 reveal Webview 内容。
- 2026-05-29 补充：单根 workspace 通过 `Add Folder to Workspace...` reload 成 Untitled 多根 workspace 后，Panel view 入口可见不等于 `WebviewView` 已被解析；实测只依赖 `onView` 时扩展可能保持 inactive，导致 provider 未注册和多根持久化 fork 不运行。因此 manifest 改为增加 `onStartupFinished`，用于启动完成后注册 Panel provider 与执行必要的 workspace storage 恢复；这不改变“不自动 reveal 画布内容、不抢焦点、不使用 `*` eager activation”的 UI 契约。
- 用户已于 2026-04-18 完成手动复验，确认 `panel -> editor` 与 `editor -> panel` 两条 restart 路径都已按新的 `defaultSurface` 收口，不再恢复旧 opposite surface。
- `npm run build` 已通过。
- `npm run typecheck` 已通过；`src/webview/main.tsx` 里原有的 `isComposing` 类型报错已在当前 head 收口。
- trusted smoke 已新增“reload 后旧 surface 不应恢复”的自动化断言；在当前 head 上整套 trusted smoke 仍被无关的 `verifyLegacyTaskFiltering` 阻塞。
- restricted smoke 已补跑；当前仍被无关的 `verifyRestrictedLiveRuntimeReconnectBlocked` 断言阻塞。两条 smoke 阻塞都不影响本设计基于人工复验继续维持 `已验证`。
