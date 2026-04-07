---
title: 节点窗口表面与通用尺寸设计
decision_status: 已选定
validation_status: 已验证
domains:
  - 画布交互域
  - 协作对象域
  - 项目状态域
architecture_layers:
  - 宿主集成层
  - 画布呈现层
  - 共享模型与编排层
related_specs:
  - docs/product-specs/canvas-core-collaboration-mvp.md
  - docs/design-docs/note-only-auxiliary-node-and-theme-alignment.md
related_plans:
  - docs/exec-plans/completed/canvas-node-surface-and-resize-polish.md
updated_at: 2026-04-07
---

# 节点窗口表面与通用尺寸设计

> 更新（2026-04-07）：本文记录的是 `Task` / `Note` 并存阶段的窗口化表面与 resize 设计。当前正式支持范围已收口为 `Agent` / `Terminal` / `Note`，其中辅助对象表面的现行结论以 `docs/design-docs/note-only-auxiliary-node-and-theme-alignment.md` 为准。

## 1. 背景

当前四类节点已经都能在 React Flow 画布中工作，但体验还有两条明显断层：

1. `Task` / `Note` 虽然具备编辑能力，正文却仍然以“字段标签 + 表单控件”的方式直接暴露，看起来更像设置面板，不像画布中的真实工作对象。
2. `Agent`、`Terminal`、`Task`、`Note` 都被固定宽高锁死。用户面对不同信息密度时，无法像操作窗口一样调整节点大小。

这两点叠加后，会让画布失去“多对象并行窗口”的统一感。执行型节点像窗口，辅助对象像配置卡片；同时所有节点都不能按内容伸缩。

## 2. 问题定义

本轮要回答三个问题：

1. `Task` / `Note` 应如何展示，才能和 `Agent` / `Terminal` 共享同一套窗口化表面语言。
2. 节点尺寸应该放在谁那里保存，才能在 resize 后 reload 仍然恢复。
3. 通用 resize 会不会破坏执行型节点现有的终端与 Agent 会话主路径。

## 3. 目标

- 让 `Task` / `Note` 节点不再呈现为明显的 inspector 表单。
- 让四类节点都支持拉伸调整宽高。
- 让节点尺寸进入宿主权威状态，并在 reload 后恢复。
- 保持执行型节点在 resize 时仍能维持现有嵌入式终端与 Agent 会话体验。

## 4. 非目标

- 不在本轮引入复杂布局系统、自动吸附、网格对齐或成组缩放。
- 不在本轮实现按内容自动增长、自动折叠或多列版式编辑器。
- 不在本轮重做节点创建入口、连接线或空间分组模型。
- 不在本轮把 Task/Note 升级为富文本或块编辑器。

## 5. 候选方案

### 5.1 保持 Task/Note 现状，只增加 resize

优点：

- 实现最便宜。

不选原因：

- 用户当前明确反馈的是“显示各字段内容的方式和 Terminal/Agent 风格不搭”，只加 resize 不能解决视觉与语义断层。

### 5.2 把 Task/Note 再次移回 inspector，节点只保留摘要

优点：

- 节点表面可以更轻。

不选原因：

- 已有设计已经明确 Task/Note 第一版要走节点内编辑。
- 这会把问题从“表面不一致”变成“交互主路径被抽离”。

### 5.3 保持节点内编辑，但把 Task/Note 改成窗口化内容面，并统一加入通用 resize

特点：

- 保留共同的 `window-chrome` 头部语言。
- `Task` / `Note` 的正文区更像工作文档，而不是设置表单。
- 节点尺寸成为宿主状态的一部分。

优点：

- 直接对应用户反馈。
- 四类节点都能收敛到“同一张画布上的可操作窗口”。
- 宿主持久化尺寸后，reload 与新增节点避碰也能继续成立。

风险：

- 需要同时修改协议、宿主和 Webview。
- 执行型节点改成可变尺寸后，要确认终端容器不会失稳。

## 6. 风险与取舍

- 取舍：尺寸只在 resize 结束后持久化，不追求拖动过程中的每一帧都回写宿主。
  原因：拖动过程可以由 React Flow 内部临时状态承担；宿主只需要最终结果，避免高频消息噪音。

- 风险：Task/Note 如果去掉标签后，字段语义可能变得不够清楚。
  当前缓解：保留轻量节标题、语义化 placeholder 和状态/负责人胶囊，而不是完全无标签。

- 风险：执行型节点高度缩小时，终端与浮层可能不可用。
  当前缓解：为不同节点类型设置最小宽高，并让正文区域按剩余空间滚动或裁切。

## 7. 当前结论

当前收敛结论如下：

- 四类节点统一支持 resize，使用 React Flow 内置的 `NodeResizer`。
- 节点尺寸定义为宿主权威状态的一部分，字段为 `size.width` 与 `size.height`。
- Webview 在 resize 结束后通过 `webview/resizeNode` 把新尺寸发回宿主。
- 宿主在加载旧状态时补默认尺寸，在创建新节点和避碰时优先使用节点实际尺寸。
- `Task` / `Note` 继续保留节点内编辑，但改成窗口化内容面：
  - 头部继续使用窗口标题栏。
  - 标题输入作为主要标题区，而不是普通小表单字段。
  - 状态、负责人或内容概况以更轻的胶囊/概览区呈现。
  - 正文输入区改成更接近工作文档的内容面。

## 8. 验证结果

本轮已完成以下验证，并据此将状态收口为“已验证”：

1. 运行 `npm run test:webview`，浏览器 harness 已覆盖拖动 resize 手柄后节点外框变化与 `webview/resizeNode` 写路径，同时更新了窗口化 Task/Note 的截图基线。
2. 运行 `npm run test:smoke`，真实 VS Code smoke 已覆盖四类节点的尺寸写回宿主、持久化和 reload 恢复。
3. 运行 `npm run test:smoke`，确认 `Task` / `Note` 在新窗口化表面下仍可编辑标题、状态、负责人和正文，不回退成只读卡片。
4. 运行 `npm run build` 与 `npm run typecheck`，并通过 `npm run test:smoke` 中已有的 `Agent` / `Terminal` 主路径验证，确认执行型节点在 resize 后不破坏现有会话链路。
