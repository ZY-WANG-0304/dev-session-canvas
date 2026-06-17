# 优化画布整理的连线邻近与分组留白

本 `ExecPlan` 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘` 这几个章节。本文遵循 `docs/PLANS.md`。

## 目标与全局图景

用户已经可以通过画布空白右键菜单执行“整理画布布局”，但真实画布截图暴露出两个可见问题：只有一个成员的普通分组仍可能在左侧保留大块空白；带连线的节点只是进入同一个关系组件，没有进一步按连线方向和邻接关系排列，导致连线跨过其他节点，连线文案也容易被节点遮住或看不全。本次变更完成后，单成员分组会把成员贴近分组内容内边距，连线节点会优先按连线约束排成相邻列或相邻行，从而减少跨节点连线，并给连线标签预留更可读的中间空间。

## 进度

- [x] (2026-06-17 16:40Z) 读取 `docs/WORKFLOW.md`、既有设计文档、已完成计划、当前布局实现与布局测试，确认问题集中在单成员容器不执行内部布局，以及组件内部只按优先级网格排列。
- [x] (2026-06-17 17:05Z) 更新布局算法：让非空分组即使只有一个直接成员也执行内部布局；为用户连线和文件关系保留方向、锚点与标签信息；在组件内部优先使用连线约束布局。
- [x] (2026-06-17 17:10Z) 补充状态级回归测试：覆盖单成员普通分组贴边、用户连线端点间不夹无关节点、用户连线链路按 source -> target 展开、同 source fanout target 同层以及带标签连线预留间距。
- [x] (2026-06-17 17:17Z) 同步设计文档与本计划结果，说明本轮真实反馈驱动的算法修正与仍不引入第三方图布局库的取舍。
- [x] (2026-06-17 17:17Z) 运行 `npm run test:canvas-layout-arrangement`、`npm run typecheck` 和 `git diff --check`，均通过。

## 意外与发现

- 观察：当前 `arrangeContainer()` 只有在直接成员数大于 1 时才调用 `applyContainerLayout()`。普通分组只有一个成员时，成员不会被移动到分组内容内边距；随后分组尺寸计算仍以成员右边界为准，因此会保留成员左侧已有空白。
  证据：`src/common/canvasLayoutArrangement.ts` 中 `if (items.length > 1) { this.applyContainerLayout(...) }`，截图中的 `Group 4` 只有一个 `AI Assistant` 成员且左侧留白很大。

- 观察：当前关系数据只保留无方向权重，`layoutComponent()` 把组件内节点按类型优先级和权重排成最多三列的小网格，不能表达“source 应靠近 target 且连线标签需要通道”的约束。
  证据：`RelationAccumulator` 聚合为 `leftId/rightId/weight`，`layoutComponent()` 使用 `rowLimit <= 3` 分行，没有读取 `CanvasEdgeSummary.sourceAnchor`、`targetAnchor` 或 `label`。

- 观察：为连线约束层级排序时，直接把所有有方向关系都作为硬约束可能在双向或环状关系中形成循环。
  证据：实现中的 `buildAcyclicConstraints()` 先按权重和标签宽度排序，再用路径检测丢弃会形成环的低优先级约束；这样既保留用户 edge 的主要方向，又避免拓扑层级无法收敛。

## 决策记录

- 决策：本轮继续在 `src/common/canvasLayoutArrangement.ts` 内增强确定性矩形布局，不引入 ELK、Graphviz 或物理模拟依赖。
  理由：用户反馈是现有功能的 polish；核心约束仍是保持 root / 普通分组边界和状态持久化稳定。轻量约束布局可直接用状态级测试证明，不增加运行时依赖和非确定性。
  日期/作者：2026-06-17 / Codex。

- 决策：连线约束优先尊重已有 anchor，而不是自动修改 edge anchor。
  理由：需求明确不能改变连线对象语义；source / target 端点和用户选择的锚点应保持不变。布局只移动节点或分组，让节点相对位置尽量匹配现有锚点方向。
  日期/作者：2026-06-17 / Codex。

## 结果与复盘

本计划已完成截图反馈对应的 follow-up 修复。`src/common/canvasLayoutArrangement.ts` 现在会对非空分组执行内部布局，即使只有一个直接成员，也会把成员移动到普通分组内容内边距附近，并让分组尺寸按直接成员 bounds 收缩到最小尺寸与内边距。关系模型现在保留有方向证据：用户 edge 和 file activity edge 记录 source / target / anchor / label，文件 owner 记录 owner -> file；component 内优先使用无环层级布局，让连线端点进入相邻层，同 source 的多个 target 尽量同层，并按 label 估算宽度放大层间通道。

本轮没有改变 Webview 协议、右键菜单入口、Host 持久化链路、节点归属、root 归属、cwd、runtime metadata、edge endpoint 或 file reference owner。仍需承认的边界是：大型复杂图仍不是专业图布局库的全局最优解，环状关系会保留权重最高的一组约束并丢弃会造成循环的低优先级约束；这符合本轮“减少真实截图中的明显留白和连线跨节点”目标。

## 上下文与定向

当前功能入口已经存在：`src/webview/main.tsx` 的画布空白右键菜单发送 `webview/arrangeCanvasLayout`；`src/panel/CanvasPanelManager.ts` 收到消息后调用 `arrangeCanvasLayout(this.state)`，再走 `finalizeCanvasGroupState(...)`、文件活动 reconciliation、`persistState()` 和 `host/stateUpdated`。本轮不改协议和入口。

布局核心在 `src/common/canvasLayoutArrangement.ts`。它把整张画布、workspace root section 和普通分组都视为“容器”。容器只排列直接成员：直接节点和直接子分组。子分组先递归整理内部，再作为父容器中的一个整体 block 参与父容器排列。`CanvasPrototypeState` 里的坐标是绝对坐标；移动分组时必须移动该分组的所有后代节点和子分组，不能改 `groupId`、`parentGroupId`、root 归属、cwd、runtime metadata、edge endpoint 或 file reference owner。

本计划中“连线约束布局”指的是：从用户 edge、file activity edge 和文件 owner 关系中保留 source、target、锚点方向和标签宽度；对同一个 connected component 内的直接成员建立“谁应在谁左边 / 上边”的安全约束；再按列或行排列，使有连线的对象尽量相邻。它不是实时布局，也不是专业图布局库。

## 工作计划

首先修改 `arrangeContainer()`，让 `groupId` 存在且直接成员非空时也执行 `applyContainerLayout()`，从而单成员普通分组和 root 内部对象都会移动到内容内边距。随后调整关系模型：`WeightedRelation` 继续用于 connected component 和权重排序，但要附带 `directedRelations` 证据；用户 edge 证据保留 source / target 直接成员、sourceAnchor / targetAnchor、label 与关系类型。文件 owner 关系记录 owner 到 file 的方向；同 cwd 仍是弱无方向关系。

接着替换 `layoutComponent()` 的内部排列。没有强方向关系的组件继续使用原有小网格策略；存在用户 edge 或文件 owner 等方向关系时，先按锚点推导水平或垂直约束，去除会造成环的约束，再计算 layer。每个 layer 是一列；列间距使用固定连线通道间距，并按该列相邻连线标签宽度放大，保证长标签不会被压在节点之间。每列内部按与相邻列的关系和原始位置稳定排序，并使用节点高度加间距堆叠，保证不重叠。

最后补充 `scripts/test/test-canvas-layout-arrangement.mjs` 的回归。测试直接调用纯函数，断言普通分组单成员整理后成员在 `group.position + 普通分组 inset` 附近；断言用户连线端点之间不横向夹入无关节点；断言用户连线链路按 source -> target 展开；断言同一 source fanout 的 target 同层；断言带较长 label 的连线端点间距大于短默认间距。同步更新 `docs/design-docs/canvas-layout-arrangement.md`，并在计划完成后把本文移到 `docs/exec-plans/completed/`。

## 具体步骤

在仓库根目录 `/home/users/ziyang01.wang-al/projects/dev-session-canvas.worktrees/dev-session-canvas7` 执行：

    npm run test:canvas-layout-arrangement
    npm run typecheck
    git diff --check

如果只改共享布局纯函数和文档，协议测试与 Webview 菜单测试不需要每轮重复；若实现过程中触达协议或 Webview，再补跑 `npm run test:protocol-webview-messages` 和定向 Playwright。

## 验证与验收

验收以状态级测试和可观察布局行为为准。`npm run test:canvas-layout-arrangement` 应输出 `canvas layout arrangement tests passed`，并覆盖新增场景：单成员普通分组不再保留大块左侧空白；用户连线链路按连线端点邻近排列；带 label 的连线拥有更宽的端点通道。`npm run typecheck` 应通过，`git diff --check` 应无输出。

用户可通过真实画布再次点击“整理画布布局”观察：只有一个节点的普通分组边界会贴近该节点的内容内边距；有连线关系的节点会优先靠在一起，连线更少跨过无关节点，连线文案更容易完整显示。reload 或重开 VSCode 后保持不变的能力沿用既有 Host 持久化链路，本轮不改变该链路。

## 幂等性与恢复

所有修改都限制在本分支上与布局整理相关的代码、测试和文档。布局函数应保持确定性；重复点击整理不应改变对象归属或运行语义。若测试失败，可以重复运行布局测试并只调整本计划触达文件。不要删除当前工作树中已有的未跟踪图片文件，它们是用户上下文，不属于本次提交。

## 证据与备注

本轮验证记录：

    npm run test:canvas-layout-arrangement
    canvas layout arrangement tests passed

    npm run typecheck
    tsc --noEmit

    git diff --check
    # no output

## 接口与依赖

不新增 npm 依赖，不新增 Webview 协议。继续使用既有导出函数：

    arrangeCanvasLayout(state: CanvasPrototypeState, now?: string): CanvasPrototypeState

`CanvasPrototypeState.edges` 的对象和属性必须原样保留；布局算法只允许更新节点和分组的 `position` / `size` 以及顶层 `updatedAt`。关系模型是 `src/common/canvasLayoutArrangement.ts` 内部实现细节，不作为公开 API 暴露。

本次修订说明：补齐实现结果、验证证据和复盘，准备将计划从 active 归档到 completed。
