---
title: Agent 节点创建前 provider 选择设计
decision_status: 已选定
validation_status: 已验证
domains:
  - VSCode 集成域
  - 画布交互域
  - 协作对象域
architecture_layers:
  - 宿主集成层
  - 画布呈现层
  - 共享模型与编排层
related_specs:
  - docs/product-specs/canvas-core-collaboration-mvp.md
  - docs/product-specs/canvas-navigation-and-workbench-polish.md
related_plans:
  - docs/exec-plans/completed/agent-node-creation-provider-selection-implementation.md
updated_at: 2026-04-13
---

# Agent 节点创建前 provider 选择设计

## 1. 背景

当前画布里已经有两条正式的创建入口：

- 画布空白区右键快捷菜单，直接创建 `Agent`、`Terminal`、`Note`
- 侧栏“创建对象”命令，对应一个 VSCode `QuickPick`

但这两条入口当前都只让用户先选“节点种类”，不会在创建前选择 `Agent` 的具体 provider。结果是：用户如果想创建 `Claude Code` 节点，当前只能先创建一个按默认 provider 初始化的 `Agent`，再回到节点标题栏里切换 provider。

这在旧的“创建后先停留未运行态”模型里只是多一步操作，但在当前正式文档里，`Agent` 创建已经以 [docs/design-docs/execution-lifecycle-and-recovery.md](./execution-lifecycle-and-recovery.md) 的自动启动边界为准。也就是说，“先创建默认 provider，再切换”不再只是低效，而会把第一次启动意图绑到错误的 provider 上。

因此，这个问题本质上不是“标题栏里 provider 下拉够不够方便”，而是“创建动作本身是否能一次完成正确的对象定义”。

## 2. 问题定义

本轮需要回答四个问题：

1. 这里的“Agent 类型”到底指什么，避免和“节点类型”“运行时后端”等概念混淆。
2. 用户应该在什么时机、以什么交互成本，选择创建时的 provider。
3. 如何在增加显式选择能力的同时，不把当前最快的默认创建路径拖慢。
4. 如何让创建动作一开始就把正确的 provider 写进节点 metadata，并驱动第一次自动启动，而不是先创建一个默认节点再补一次变更。

当前本文把“Agent 类型”明确限定为“创建时要绑定的 provider kind”，也就是当前已支持的 `Codex` / `Claude Code`，以及后续可能新增的 provider。

## 3. 目标

- 用户在创建 `Agent` 节点前，就能显式选择具体 provider。
- 默认 provider 仍保留一条低摩擦的快速创建路径。
- 让 VSCode `QuickPick` 入口能在一屏内同时覆盖“最快创建默认 Agent”与“按具体 provider 创建 Agent”。
- 新节点第一次进入自动启动或恢复流程时，使用的就是创建时选定的 provider，而不是事后切换值。
- 未来新增更多 provider 时，不需要把“节点种类”和“provider 列表”彻底摊平成一长串菜单项。

## 4. 非目标

- 不在本轮新增 provider 安装检测、认证引导或命令可用性预检查。
- 不在本轮移除节点创建后的 provider 切换能力；空闲节点仍保留现有标题栏切换入口。
- 不在本轮讨论更多 provider 的接入顺序、配置项设计或 app-server 路线。
- 不在本轮修改 `Agent` 节点标题、状态机或运行时恢复语义。

## 5. 候选方案

### 5.1 保持现状：先创建默认 Agent，再在节点内切换

优点：

- 实现最省。

不选原因：

- 它把“对象定义”拆成两步，用户必须先承担一个错误初始值。
- 在当前自动启动模型下，第一次启动意图可能已经按默认 provider 发出，之后再切换只是在修复错误状态。
- 对外也无法说清“创建 Agent”到底什么时候才算真正完成。

### 5.2 每次创建 Agent 都强制进入第二步 provider 选择

优点：

- 行为最一致，不存在“默认创建”和“显式创建”两条路径。
- provider 数量增加时也容易扩展。

不选原因：

- 这会把最常见的默认创建路径也强制变成两步。
- 当前仓库已经提供 `devSessionCanvas.agent.defaultProvider` 作为用户长期偏好；如果每次都必须重新确认，默认设置的价值会被削弱。
- 对 `Terminal` / `Note` 一步完成、`Agent` 两步完成，整体节奏会显得偏重。

### 5.3 把 provider 直接摊平成顶层创建项

例如把菜单和 `QuickPick` 改成：

- `Agent / Codex`
- `Agent / Claude Code`
- `Terminal`
- `Note`

优点：

- 单步完成显式创建。
- 不需要额外子流程。

不选原因：

- 它把“节点种类”和“provider 变体”混成同一层级，语义不够干净。
- provider 增多后会快速拉长菜单，压缩 `Terminal` / `Note` 的可读性。
- 未来如果 `Agent` 还要区分 provider capability，这种平铺方式会继续膨胀。

### 5.4 保留默认快速创建，同时提供创建前显式选 provider 的分流

这是当前推荐方案。

核心思路：

- 创建 `Agent` 时拆成两个意图，而不是两个对象：
  - “按当前默认 provider 快速创建”
  - “先选 provider，再创建”
- 真正落地时仍只创建一次节点；不存在“先落一个默认节点，再把 provider 改掉”的中间态。

优点：

- 兼顾默认体验和显式控制。
- 与当前默认 provider 配置的角色一致：它应该影响最快路径，但不应堵死显式选择。
- provider 数量增加时，仍可把“节点种类”作为第一层语义保留住。

风险：

- 交互会从原来的单一“创建对象”变成“默认创建 / 显式选型”两条分流，需要把默认值表达得足够清楚，避免用户不知道自己创建的是哪一种 `Agent`。

### 5.5 `QuickPick` 顶层分区，同时直接列出完整 Agent 类型列表

这是当前对 VSCode 宿主入口的最终推荐方案。

核心思路：

- 顶层 `QuickPick` 不再进入第二层。
- 同一层里同时保留：
  - 面向高频路径的“创建对象”分组
  - 面向显式 provider 选择的“按类型创建 Agent”分组
- 所有项都直接创建，不再要求用户额外再确认一次。

选择原因：

- 这更接近 VSCode 常见的“单个 QuickPick 内按语义分组展示动作”的设计。
- 它把默认路径保持为一步，同时让非默认 provider 也是一步。
- 与“先选 Agent 再进第二层”相比，它更快，也避免同一个 `Agent` 入口承担两种不同语义。

## 6. 风险与取舍

- 取舍：保留默认快速创建，而不是强制每次二次确认。
  原因：`Agent` 是当前高频对象；如果默认路径被普遍拖慢，用户会把“显式性”感知成“创建更麻烦”，而不是“创建更准确”。

- 风险：用户继续直接点默认创建，仍可能创建出自己不想要的 provider。
  当前缓解：在所有入口显式展示“当前默认是哪个 provider”，让默认值可见而不是隐式。

- 风险：Webview 右键菜单与 VSCode `QuickPick` 不再完全同构。
  当前缓解：宿主 `QuickPick` 优先遵循 VSCode 的常见分区式动作列表；Webview 右键菜单仍保留更偏“快速创建”的结构，两者共享同一创建语义即可，不强求控件层级一致。

- 取舍：创建协议需要新增 `agentProvider` 初始值，而不是继续沿用“create 后再 update provider”。
  原因：这能避免错误的首次自动启动，也避免宿主权威状态出现一个短暂但错误的默认 provider 节点。

## 7. 当前结论

### 7.1 正式语义

- “新增 `Agent` 节点时选择具体 Agent 类型”在当前产品里，正式等价于“在创建动作里选择 provider kind”。
- `devSessionCanvas.agent.defaultProvider` 继续作为默认 provider 的唯一来源。
- 创建交互必须同时支持：
  - 直接使用默认 provider 创建
  - 在创建前显式选择某个 provider 创建

### 7.2 画布空白区右键菜单

- 顶层菜单仍保持 `Agent`、`Terminal`、`Note` 三类对象，避免把 provider 直接摊平成顶层对象类型。
- `Agent` 菜单项右侧显示当前默认 provider，例如 `默认：Codex`。
- 点击 `Agent` 项的主操作区时，直接按当前默认 provider 创建节点。
- `Agent` 项同时提供一个次级展开动作（例如右侧箭头、次级按钮或同一弹层内的 drill-in），进入“选择 Agent 类型”视图。
- “选择 Agent 类型”视图只列 provider 选项，例如 `Codex`、`Claude Code`；默认 provider 需要有明确标记。
- 在 provider 视图中选中某项后，直接创建最终节点并关闭菜单；过程中不允许先出现一个默认 provider 的中间节点。
- `Escape`、点击外部、创建完成都应关闭当前菜单；若使用 drill-in 视图，需支持返回上一级。

### 7.3 侧栏命令与 VSCode `QuickPick`

- 侧栏“创建对象”和命令面板入口继续复用 VSCode `QuickPick`，不在宿主层自造菜单。
- 顶层 `QuickPick` 直接分成两个区域，并在同一层完成创建，不再进入第二层。
- 第一组为 `创建对象`：
  - `Agent（默认：<provider>）`
  - `Terminal`
  - `Note`
- 第二组为 `按类型创建 Agent`：
  - 当前支持的完整 provider 列表，例如 `Codex（默认）`、`Claude Code`
- 第一组 `Agent（默认：<provider>）` 的职责是“最快创建一个默认 Agent”，点击后直接创建。
- 第二组每一项的职责是“明确按 provider 创建 Agent”，点击后也直接创建。
- 第二组不是“其他 Agent 类型”，而是完整的 Agent 类型列表；默认 provider 在这里也要出现，避免“按类型创建”视图里缺失默认项。
- 第一组 `Agent` 不再打开第二层；否则它会和第二组的完整列表形成重复跳转，破坏最高频路径的效率。

这种设计让 `QuickPick` 既保留 VSCode 常见的分区式信息组织，又把默认路径和显式 provider 选择都压缩成一步。

### 7.4 节点创建与状态写入边界

- `webview/createDemoNode`、宿主侧 `createNode` 调用，以及对应的 create-node 帮助函数，都应支持一个可选的 `agentProvider` 初始值。
- 当 `kind !== 'agent'` 时忽略该字段；当 `kind === 'agent'` 且显式给出 provider 时，宿主在第一次落库时就写入该值。
- 创建动作只触发一次正式节点落地；不允许通过“先创建默认 provider 节点，再发送一次 update provider”来拼出最终结果。
- 当前自动启动语义下，节点第一次 fresh start 或 resume 使用的 provider，应直接来自这份初始 metadata。
- 节点创建后的 provider 下拉仍保留，但只承担“空闲节点的后续调整”，不再承担“修复创建时选错 provider”的主要职责。

## 8. 验证方法

至少需要完成以下验证：

1. 在浏览器 harness 中验证右键菜单存在两条 `Agent` 创建路径：默认快速创建与显式 provider 选择。
2. 在浏览器 harness 或 probe 中验证显式选择 `Claude Code` 后，创建出的节点首帧 metadata 已经是 `claude`，而不是先出现 `codex` 再切换。
3. 在真实 VSCode smoke 中验证侧栏/命令入口的分区式 `QuickPick`：第一组可直接创建默认 `Agent`、`Terminal`、`Note`，第二组可直接创建完整 provider 列表中的任一 `Agent`。
4. 在自动启动场景下验证：从 `QuickPick` 第二组显式选择 provider 创建后，第一次启动消息就携带正确 provider。
5. 在 Restricted Mode 下验证：新增 provider 选择能力不会绕过当前对执行型节点创建的禁用或退化逻辑。

## 9. 当前验证状态

- 已运行 `npm run typecheck`，通过。
- 已运行 `npm run test:webview`，新增右键菜单默认创建与 provider drill-in 用例后共 `25 passed`。
- 已运行 `npm run test:smoke`，验证宿主 `QuickPick` 的默认 `Agent`、显式 `Claude Code` 与 `Note` 路径都可直接创建，且创建后首帧 metadata 与第一次启动记录使用正确 provider。
