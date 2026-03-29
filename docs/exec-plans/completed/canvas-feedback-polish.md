# 收口画布反馈中的空状态、面板密度与节点摆放

本 ExecPlan 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘` 这几个章节。

`docs/PLANS.md` 是本计划的约束来源；当前文档必须按 `docs/PLANS.md` 的要求持续维护。

## 目标与全局图景

这次变更完成后，用户重新打开或重置画布时会看到一张真正的空画布；左下角缩放控件不再被说明浮层挡住；右侧选中节点区域只显示补充信息，不再重复节点正文；连续新增 `Agent`、`Terminal`、`Task`、`Note` 时，新节点默认落在当前视口附近且不会一出生就盖住旧节点。用户在 VSCode 里直接打开画布，点击创建按钮，再连续新建几个不同节点，就能肉眼验证这些行为已经生效。

## 进度

- [x] (2026-03-30 08:05Z) 阅读 `docs/WORKFLOW.md`、反馈清单、相关设计文档和当前前端/宿主实现，确认本轮需要正式文档和 `ExecPlan`。
- [x] (2026-03-30 08:20Z) 从最新远端 `main` 切出主题分支 `canvas-feedback-polish`，避免继续在已合并旧分支上交付。
- [x] (2026-03-30 08:40Z) 新增正式设计文档，写清空画布默认态、外层面板密度规则、右侧概况职责和新增节点避碰策略。
- [x] (2026-03-30 09:00Z) 更新产品规格与设计文档索引，使本轮可见行为进入正式文档注册表。
- [x] (2026-03-30 09:20Z) 修改共享协议与宿主逻辑：默认空状态、创建消息携带视口锚点、宿主按节点尺寸避碰放置。
- [x] (2026-03-30 09:35Z) 修改 Webview：去掉遮挡左下角控件的底部浮层，把验证说明收入口头部；压缩右侧选中节点概况，移除重复内容。
- [x] (2026-03-30 09:45Z) 运行 `npm run typecheck` 与 `npm run build`，并记录自动化结果；人工验证说明仍待在 VSCode 图形环境执行。
- [x] (2026-03-30 10:05Z) 完成本计划归档、技术债登记、本地提交、推送分支与 MR 创建；MR：`http://10.79.10.70:1080/ziyang01.wang/opencove_extension/-/merge_requests/6`。

## 意外与发现

- 观察：当前分支 `canvas-node-deletion` 实际已经合入远端 `main`，本地 `main` 只是落后一个 merge commit。
  证据：`git log --oneline origin/main` 显示 `8a3f7c1 Merge branch 'canvas-node-deletion' into 'main'`，且 `HEAD` 是该 merge commit 的祖先。

- 观察：节点新增重叠的根因不是 React Flow 拖拽，而是宿主仍使用 `createNodePosition(sequence)` 的固定 320x220 网格；这与当前 560 宽的会话窗口和 380 宽的编辑窗口已经不匹配。
  证据：`src/panel/CanvasPanelManager.ts` 中 `createNodePosition()` 仅按序号给出固定列宽/行高，不区分节点类型尺寸。

- 观察：`ReactFlowInstance.screenToFlowPosition()` 可以直接把屏幕中心点转换成流坐标，足够支撑“视口锚点由 Webview 提供，位置最终由宿主裁决”的方案，不需要让 Webview 直接改写节点状态。
  证据：`src/webview/main.tsx` 已通过 `onInit` 保存 `ReactFlowInstance`，创建节点时直接使用 `screenToFlowPosition(...)` 生成首选位置，并通过消息桥传给宿主。

## 决策记录

- 决策：本轮新增一份专门的设计文档，而不是把结论散落进实现说明。
  理由：反馈覆盖默认态、外层信息密度和新增布局规则，都是用户可见行为，必须先有正式文档再改实现。
  日期/作者：2026-03-30 / Codex

- 决策：新增节点的位置由宿主最终裁决，但视口锚点从 Webview 提供。
  理由：当前视口上下文只在 Webview 最容易拿到，而宿主仍需要保持对象位置的权威状态与持久化。
  日期/作者：2026-03-30 / Codex

- 决策：右侧选中节点区域不再显示 `Task` / `Note` 正文，也不再重复执行型节点的最近输出；它只保留节点 ID 和补充运行时元信息。
  理由：反馈明确指出右侧概况与节点本体重复，继续把正文和最近输出堆在右侧会重新强化 inspector 心智。
  日期/作者：2026-03-30 / Codex

## 结果与复盘

当前已经完成以下结果：

- 宿主默认状态改为空画布，重置后不再注入示例 `Task` / `Note`。
- `webview/createDemoNode` 消息新增可选首选位置字段，Webview 会把当前视口中心附近的流坐标传给宿主。
- 宿主新增基于节点类型默认窗口尺寸的避碰搜索，避免新建节点与已有节点初始重叠。
- 左下角说明浮层被移除，验证范围说明并入左上角 hero 面板，React Flow 缩放控件区域恢复可用。
- 右侧“选中节点概况”被收敛为补充信息区，不再重复 `Task` / `Note` 正文，也不再重复最近输出。
- 分支 `canvas-feedback-polish` 已推送并创建 MR：`http://10.79.10.70:1080/ziyang01.wang/opencove_extension/-/merge_requests/6`。

当前剩余事项只有图形界面的手动验收；它已在计划、MR 描述和技术债记录中显式保留，没有被误写成已完成。

## 上下文与定向

本轮会同时修改文档、Webview 前端和宿主状态逻辑，关键文件如下：

- `docs/design-docs/canvas-feedback-polish.md`：本轮正式设计结论。
- `docs/product-specs/canvas-core-collaboration-mvp.md`：MVP 用户可见行为和验收口径。
- `src/common/protocol.ts`：Host / Webview 消息边界定义；如要把视口锚点传给宿主，这里必须先扩展。
- `src/panel/CanvasPanelManager.ts`：宿主权威状态、默认节点集合、创建节点和节点位置计算逻辑都在这里。
- `src/webview/main.tsx`：React Flow 画布、浮层面板、右侧概况区和“新增节点”按钮都在这里。
- `src/webview/styles.css`：外层面板、右侧区域和节点 UI 的样式都在这里。

这里的“视口锚点”指当前用户屏幕中间附近对应的 React Flow 流坐标；它不是最终位置，只是告诉宿主“用户当前正在看哪里”。这里的“避碰搜索”指宿主在已有节点矩形集合中寻找第一个不重叠的默认位置；它只解决新建瞬间的遮挡，不负责后续自动整理布局。

## 工作计划

先改文档，再改协议和宿主。具体顺序如下：

1. 更新产品规格和设计文档索引，把空画布、非遮挡控件和新建避碰写成正式结论。
2. 扩展 `webview/createDemoNode` 消息，使其可以携带一个可选的首选位置。
3. 在 `CanvasPanelManager` 中把默认状态改为空数组，并新增基于节点类型尺寸的默认窗口矩形估算、碰撞检测和候选位置搜索。
4. 在 Webview 中接入 `ReactFlowInstance`，在点击“新增节点”时把当前视口中心转换为流坐标传给宿主。
5. 调整浮层布局和右侧概况区，让画布导航控件可用，并让右侧只保留补充元信息。
6. 运行构建与类型检查，记录仍需人工验证的剩余项，再归档计划和创建 MR。

## 具体步骤

1. 在仓库根目录更新以下文档：
   `docs/design-docs/index.md`
   `docs/product-specs/canvas-core-collaboration-mvp.md`
   新增 `docs/design-docs/canvas-feedback-polish.md`
   新增本计划文件
2. 修改 `src/common/protocol.ts`，为“创建节点”消息增加可选首选位置字段，并补齐解析逻辑。
3. 修改 `src/panel/CanvasPanelManager.ts`：
   - 把 `createDefaultState()` 改为空节点集合。
   - 让 `createNextState()` 接受可选首选位置。
   - 新增节点尺寸估算、矩形碰撞判断和候选位置搜索。
4. 修改 `src/webview/main.tsx`：
   - 保存 `ReactFlowInstance`。
   - 计算当前视口中心附近的流坐标并放入创建消息。
   - 合并左下角说明到头部。
   - 精简 `SelectedNodeDetails()`。
5. 修改 `src/webview/styles.css`，同步去掉底部面板占位并收口右侧信息密度。
6. 在仓库根目录运行：
   `npm run typecheck`
   `npm run build`
7. 完成后更新本计划的 `进度`、`结果与复盘` 和验证章节，并将其移入 `docs/exec-plans/completed/`。

## 验证与验收

自动化验证：

- 在仓库根目录运行 `npm run typecheck`，预期通过。
- 在仓库根目录运行 `npm run build`，预期通过。

手动验收：

1. 在 VSCode `Extension Development Host` 中打开画布。
2. 点击“重置宿主状态”，预期画布中不再自动出现 `Task` / `Note`。
3. 检查左下角缩放控件，预期没有任何浮层遮挡。
4. 连续新增 `Task`、`Note`、`Terminal`、`Agent`，预期它们默认不重叠。
5. 平移画布到其他区域后再新增节点，预期新节点优先出现在当前视口附近。
6. 选中 `Task` 或 `Note`，预期右侧只显示轻量补充信息，不再重复整段正文。

## 幂等性与恢复

- `npm run typecheck` 和 `npm run build` 都应可重复执行。
- 如果新增位置算法失效，宿主仍应退回到“找到一个合法默认位置”，而不是让消息解析失败或创建动作中断。
- 这次改动不迁移已有节点位置；已有持久化状态只在重置时回到新的空画布默认态。

## 证据与备注

自动化验证记录：

    $ npm run typecheck
    > opencove-extension@0.0.1 typecheck
    > tsc --noEmit

    $ npm run build
    > opencove-extension@0.0.1 build
    > node scripts/build.mjs

备注：

- 当前终端环境无法直接打开 VSCode `Extension Development Host`，因此本计划中的 GUI 手动验收仍需在本地 VSCode 中补跑。

## 接口与依赖

本轮不引入新依赖。需要保持以下接口成立：

- `src/common/protocol.ts` 中 `webview/createDemoNode` 的 payload 应允许包含一个可选 `preferredPosition: CanvasNodePosition`。
- `src/panel/CanvasPanelManager.ts` 中 `createNextState(...)` 应能基于 `preferredPosition` 与已有节点集合生成不重叠的新位置。
- `src/webview/main.tsx` 中创建节点动作必须继续通过消息边界请求宿主创建，不能在 Webview 侧直接改写权威节点状态。
