---
title: 画布布局整理设计
decision_status: 已选定
validation_status: 已部分验证
domains:
  - 画布交互域
  - 协作对象域
  - 项目状态域
architecture_layers:
  - 宿主集成层
  - 画布呈现层
  - 共享模型与编排层
related_specs: []
related_plans:
  - docs/exec-plans/completed/canvas-layout-arrangement.md
updated_at: 2026-06-17
---

# 画布布局整理设计

## 1. 背景

DevSessionCanvas 已支持节点、连线、普通分组和 multi-root workspace root section。随着 Agent、Terminal、关联文件和 Note 增多，用户手工拖拽后容易出现遮挡、孤立对象散落和 root / group 边界难读的问题。布局整理需要提供一次性空间收口，让用户点击一次后能得到更清晰的画布，同时不改变执行语义或协作对象归属。

## 2. 问题定义

本设计要回答：如何在现有宿主权威状态中整理对象坐标；如何消除节点和分组重叠；如何让关系对象靠近；如何把普通分组和 workspace root section 当作硬边界；以及整理结果如何通过既有持久化链路在 reload 和重开 VSCode 后保持。

## 3. 目标

- 在画布空白处右键菜单提供一次性“整理画布布局”。
- 自动消除同一容器内的直接成员重叠，并保持可读间距。
- 使用用户连线、文件活动 owner 和同 cwd 执行节点关系，让 Agent、Terminal、关联文件和连线对象尽量靠近。
- 普通分组内部先单独整理；普通分组在父容器中作为整体参与排列。
- workspace root section 作为硬边界；只整理 root 内部对象，root 之间只在外层避让重叠。
- 整理后写回 `CanvasPrototypeState`，通过既有 Host 持久化在 reload / 重开后保持。

## 4. 非目标

- 不清理、归档、收起、创建、删除、改名或折叠任何分组或节点。
- 不提供撤销和恢复机制，不弹整理完成提示。
- 不改变节点的 `groupId`、root 归属、`cwd`、runtime metadata、连线端点或文件活动 owner。
- 不做持续自动布局、物理模拟或用户拖拽时的实时吸附。
- 不支持跨普通分组或跨 root 自动搬移节点。

## 5. 候选方案

方案 A 是在 Webview 侧直接读取 React Flow nodes 并调用布局库。它能接近真实渲染尺寸，但会把权威状态变更放到前端，且普通分组 / multi-root 拆分仍需 Host 再解释，容易造成语义漂移。本轮不采用。

方案 B 是引入 ELK / Graphviz / force simulation 做全图布局。它适合大型图自动排版，但会引入依赖、迭代不确定性和跨 root 重排风险；本需求更强调边界稳定、无归属变更和确定性。本轮不采用。

方案 C 是在共享模型层实现确定性矩形布局纯函数，由 Host 调用并持久化。它能复用现有 `CanvasPrototypeState`、分组模型和 multi-root 语义，测试也可直接覆盖状态输入输出。本轮采用。

## 6. 风险与取舍

首版使用持久化 footprint 而不是渲染后 DOM 尺寸，极端情况下可能与真实视觉高度有少量差异；但当前节点尺寸本身已在状态中维护，足以作为整理依据。算法优先确定性和语义边界，不追求专业图布局最优解；大型画布可能不是全局最紧凑，但应明显减少重叠并让相关对象更容易一起看见。文件活动节点归属继续由现有 Host reconciliation 维护，整理函数只移动当前成员，不抢占 owner 推导。

## 7. 正式方案

主要落点：`src/common/canvasLayoutArrangement.ts` 提供纯函数 `arrangeCanvasLayout(state, now)`；`src/common/protocol.ts` 增加 `webview/arrangeCanvasLayout` 消息；`src/webview/main.tsx` 在画布右键菜单发送该消息；`src/panel/CanvasPanelManager.ts` 在 Host 侧调用整理函数、执行现有文件活动 reconciliation、持久化并广播 `host/stateUpdated`。

布局按容器递归处理。容器可以是整张画布、workspace root section 或普通分组。每个容器只排列直接成员：直接节点和直接子分组。普通分组先整理内部，再作为父容器中的一个 block 参与排列；root section 内部独立整理，root section 本身只在外层参与 root-root 避让。所有节点和分组保持原有 `groupId` / `parentGroupId`，所以整理不会把对象搬入或搬出任何普通分组或 root。

关系图只在当前容器的直接成员之间构造。用户 edge 是强关系，file activity edge 和文件 owner 是强关系，同 cwd 的 Agent / Terminal 是弱关系。若关系发生在子分组内部，父容器只看到对应子分组 block；若关系跨不同 root 或不同普通分组，布局不会跨边界搬移节点，只会在共同父容器中让直接 block 尽量靠近。

排列策略是确定性的：先按关系图拆 connected components；component 内按 Agent、Terminal、文件、分组、Note 的稳定优先级和关系权重排序，排成小型网格；component 之间按原始位置顺序进行行列 packing。节点间距和 component 间距使用固定值，坐标取整。整理后分组尺寸按直接成员 bounds 扩展到最小尺寸与成员内边距；root 使用 root section 最小尺寸与 root 内容 inset，普通分组使用现有普通分组标题 / padding inset。

Host 收到整理消息后把结果写回当前权威 `CanvasPrototypeState`，并走现有 `persistState()`。在 multi-root workspace 下，后续既有 decompose / root-local storage / overlay 持久化继续负责把 root-local 坐标和 root section overlay 写回对应存储，因此 reload 与重开 VSCode 后保持整理结果。

## 8. 验证方法

自动化验证包括：`npm run test:canvas-layout-arrangement` 覆盖节点避让、关系靠近、普通分组内部整理、root hard boundary、语义不变；`npm run test:protocol-webview-messages` 覆盖消息解析；`npm run test:webview` 覆盖右键菜单入口、消息发送和无完成 toast。最终交付前还应运行 `npm run typecheck`、`npm run build` 和 `git diff --check`。

截至 2026-06-17，本设计已完成布局纯函数测试、协议解析测试、右键菜单定向 Playwright 测试、可信工作区 smoke 持久化测试、`typecheck` 和 `git diff --check`。可信工作区 smoke 覆盖整理后写入持久化快照并 reload 保持位置。完整 `test:webview` 在本轮曾出现 4 个既有或波动失败，新增右键菜单用例在完整运行和定向运行中均通过；因此当前验证状态标记为“已部分验证”，后续若完整 Webview 回归也清洁通过，可再升级为“已验证”。
