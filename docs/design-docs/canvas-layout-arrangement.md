---
title: 画布布局整理设计
decision_status: 已选定
validation_status: 验证中
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
  - docs/exec-plans/completed/canvas-layout-arrangement-edge-polish.md
updated_at: 2026-07-02
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
- 在 multi-root `rootGroups` 中从 root 分组内触发整理时，默认只整理当前 root；整理整个 workspace 需要进入右侧 `>` 二级菜单。
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

空分组在整理语义中只表示“当前没有直接成员的可见分组对象”。它不是垃圾区域，不能在整理时被删除、折叠或重命名；它也不被额外解释为用户预留规划空间，整理命令可以规范化其几何尺寸。风险主要是显式整理会改变可见对象尺寸；当前取舍是把这视为“整理画布布局”的合理几何副作用，并通过保持父级归属、标题和 workspace root 专属最小尺寸来限制影响范围。

## 7. 正式方案

主要落点：`extensions/vscode/dev-session-canvas/src/common/canvasLayoutArrangement.ts` 提供纯函数 `arrangeCanvasLayout(state, now, options)`；`extensions/vscode/dev-session-canvas/src/common/protocol.ts` 提供 `webview/arrangeCanvasLayout` 消息，并允许携带可选 `targetGroupId`；`extensions/vscode/dev-session-canvas/src/webview/main.tsx` 在画布右键菜单发送该消息；`extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts` 在 Host 侧解析整理范围、调用整理函数、执行现有文件活动 reconciliation、持久化并广播 `host/stateUpdated`。

布局按容器递归处理。容器可以是整张画布、workspace root section 或普通分组。每个容器只排列直接成员：直接节点和直接子分组。普通分组先整理内部，再作为父容器中的一个 block 参与排列；root section 内部独立整理，root section 本身只在外层参与 root-root 避让。所有节点和分组保持原有 `groupId` / `parentGroupId`，所以整理不会把对象搬入或搬出任何普通分组或 root。

关系图只在当前容器的直接成员之间构造。用户 edge 是强关系，file activity edge 和文件 owner 是强关系，同 cwd 的 Agent / Terminal 是弱关系。若关系发生在子分组内部，父容器只看到对应子分组 block；若关系跨不同 root 或不同普通分组，布局不会跨边界搬移节点，只会在共同父容器中让直接 block 尽量靠近。

排列策略是确定性的：先按关系图拆 connected components；component 之间按原始位置顺序进行行列 packing。component 内部若没有明确方向关系，则继续按 Agent、Terminal、文件、分组、Note 的稳定优先级和关系权重排成小型网格。若存在用户 edge、file activity edge 或文件 owner 关系，则把关系保留为有方向的布局证据：用户 edge 使用既有 source / target 和 anchor 推导左右或上下层级，文件 owner 使用 owner -> file 方向；若约束成环，则优先保留权重高的约束并丢弃会形成环的低优先级约束。水平或垂直层级排列时，直接相连对象进入相邻层，同一 source 的多个 target 尽量同层排列，层间距按连线标签估算宽度放大，让连线文案有可读通道，不再只把“有关系”理解为同一网格组件。

整理后分组尺寸按直接成员 bounds 收缩或扩展到最小尺寸与成员内边距；root 使用 root section 最小尺寸与 root 内容 inset，普通分组使用现有普通分组标题 / padding inset。普通分组即使只有一个直接成员也会执行内部整理，因此单成员分组会把成员移动到内容内边距附近，而不是保留整理前的大块空白。普通空分组没有内容 bounds 可参考，整理时先把尺寸规范化为创建空分组的默认尺寸 `360 x 240`，再作为普通 `group` block 参与父容器排列；嵌套空分组同样适用该规则，并会触发外层分组按规范化后的空子分组 bounds 收口。workspace root section 不适用普通空分组默认尺寸；空 root section 仍规范化到 workspace root 最小尺寸，不因内容少而收缩到普通分组大小。

Host 收到整理消息后把结果写回当前权威 `CanvasPrototypeState`，并走现有 `persistState()`。如果消息携带 `targetGroupId`，Host 只接受当前存在的 workspace root 或其内部用户分组，并把内部用户分组提升为所属 workspace root 后再调用目标分组整理；如果目标不存在则忽略该消息，避免 Webview 旧菜单误整理整个画布。在 multi-root `rootGroups` 中，命中 root section 的 title/body/chrome 或其内部用户分组时，主菜单“整理画布布局”默认携带所属 workspace-root group id，因此只整理该 root 内部对象；同一行右侧 `>` 二级菜单中的“整理整个 workspace 的画布”发送不带目标的消息，才按整张组合画布整理 root 分组、外层分组和节点。目标 root 整理后的文件活动 reconciliation 继续重建自动文件节点，但其几何修复使用 scoped repair：非目标 root 与 workspace-level overlay 保持原坐标；若目标 root 因尺寸变化与其他 root 冲突，只平移目标 root 子树到最近非重叠位置，避免后续全局 finalize 泄漏成全 workspace 重排。在 multi-root workspace 下，后续既有 decompose / root-local storage / overlay 持久化继续负责把 root-local 坐标和 root section overlay 写回对应存储，因此 reload 与重开 VSCode 后保持整理结果。

## 8. 验证方法

自动化验证包括：`npm run test:canvas-layout-arrangement` 覆盖节点避让、关系靠近、普通分组内部整理、root hard boundary、指定 root 整理不移动其他 root、语义不变；`npm run test:protocol-webview-messages` 覆盖消息解析；`npm run test:webview` 覆盖右键菜单入口、消息发送和无完成 toast，并覆盖 multi-root rootGroups 下默认 root-scoped 整理与 `>` 二级菜单全 workspace 整理。最终交付前还应运行 `npm run typecheck`、`npm run build` 和 `git diff --check`。

截至 2026-06-17，本设计已完成布局纯函数测试、协议解析测试、右键菜单定向 Playwright 测试、可信工作区 smoke 持久化测试、`typecheck` 和 `git diff --check`。可信工作区 smoke 覆盖整理后写入持久化快照并 reload 保持位置。完整 `test:webview` 在本轮曾出现 4 个既有或波动失败，新增右键菜单用例在完整运行和定向运行中均通过；因此当前验证状态保持为“验证中”，后续若完整 Webview 回归也清洁通过，可再升级为“已验证”。

截至 2026-06-18，针对真实截图反馈补充了单成员普通分组紧凑和连线感知层级排列的状态级回归：`npm run test:canvas-layout-arrangement` 覆盖单成员分组贴近内容内边距、无关节点不横向夹在用户连线端点之间、用户连线链路按 source -> target 展开、同 source fanout target 同层以及长 label 连线通道放大；`npm run typecheck` 通过。该轮未改变协议、菜单入口或 Host 持久化链路。

截至 2026-06-21，补充普通空分组尺寸规范化回归：`npm run test:canvas-layout-arrangement` 覆盖普通空分组归一到 `360 x 240` 后参与同级避让、嵌套空分组归一后驱动父分组收口，以及空 workspace root section 继续使用 root 最小尺寸。

截至 2026-07-02，补充 multi-root rootGroups 右键范围收口：root 分组内主菜单“整理画布布局”默认携带所属 workspace-root group id，Host 只整理当前 root；同一项右侧 `>` 二级菜单保留“整理整个 workspace 的画布”全局路径。随后补齐 root section 标题/边框 chrome 右键的 Webview 命中路径，避免选中 root 后标题栏只出现单项整理入口。新增 `npm run test:canvas-layout-arrangement` 覆盖 target root 不移动其他 root，`npm run test:canvas-node-groups` 覆盖 target root 整理后进入文件活动 reconciliation 与 scoped geometry repair 时只平移目标 root 子树且最终 root 不重叠，`npm run test:protocol-webview-messages` 覆盖 `targetGroupId` 协议，Playwright 定向用例覆盖菜单文案、默认消息 payload、root section chrome 右键和二级菜单全 workspace 消息。
