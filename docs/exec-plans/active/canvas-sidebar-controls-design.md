# 设计画布外层控件侧栏化规格与方案

本 ExecPlan 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘` 这几个章节。

本计划位于仓库根目录下的 `docs/PLANS.md` 约束体系内，后续任何继续推进该主题的协作者都必须按 `docs/PLANS.md` 的要求持续维护本文件。

## 目标与全局图景

这项工作要把当前画布里占据左上角和右上角的固定说明与操作区，收口成“画布只留空间导航，非空间控件迁到 VSCode 侧栏”的正式设计。完成后，用户进入画布时应主要看到节点本体、左下角导航控件和右下角全局定位控件，而创建对象、打开画布、恢复状态和最小必要的全局状态则转移到 VSCode 侧栏中。

这份计划最初从设计阶段开始，但现在已经推进到第一版实现。当前可见结果不仅包括独立产品规格和设计文档，还包括一个原生侧栏入口、移除顶角 panel 后的画布界面，以及可重复运行的自动化检查结果。

## 进度

- [x] (2026-03-31 10:42 +0800) 读取 `功能体验.md`、`docs/WORKFLOW.md`、`docs/PLANS.md`、`docs/DESIGN.md`、`docs/PRODUCT_SENSE.md`、`docs/product-specs/index.md`、`ARCHITECTURE.md` 和 `docs/FRONTEND.md`，确认这是一个需要正式文档链路支持的设计任务。
- [x] (2026-03-31 10:42 +0800) 审查当前实现与既有设计结论，确认现状仍是“左上角 hero + 右上角操作区”的过渡态，与 `功能体验.md` 第 2 条的侧栏化目标存在明确差异。
- [x] (2026-03-31 10:42 +0800) 新增本计划，并把设计阶段的目标、约束、候选方案与后续验证入口写入正式文档。
- [x] (2026-03-31 10:42 +0800) 新增独立产品规格，定义画布外层控件极简化、侧栏承载范围和验收口径。
- [x] (2026-03-31 10:42 +0800) 新增独立设计文档，对比“继续保留顶角 panel”“原生侧栏 View”“侧栏 WebviewView”等方案，并写明当前推荐路线。
- [x] (2026-03-31 10:42 +0800) 同步更新 `docs/product-specs/index.md`、`docs/design-docs/index.md` 与 `docs/design-docs/core-beliefs.md`。
- [x] (2026-03-31 11:11 +0800) 为侧栏承载面做最小原型实现，确认原生 `TreeView` 足以承载打开、创建、重置和最小状态摘要。
- [x] (2026-03-31 11:11 +0800) 基于原型结果，把 `docs/design-docs/canvas-sidebar-controls.md` 从“比较中 / 未验证”收口为“已选定 / 验证中”。
- [x] (2026-03-31 11:11 +0800) 在实现阶段移除画布顶角 panel，接入原生侧栏容器、`TreeView` 和命令入口。
- [x] (2026-03-31 11:11 +0800) 完成自动化检查：`npm run typecheck` 与 `npm run build` 通过。
- [ ] 在 `Extension Development Host` 中完成人工验证，并据此决定是否把本计划迁入 `docs/exec-plans/completed/`。

## 意外与发现

- 观察：当前正式文档已经把“右侧不再展示选中节点信息”写成已选定结论，但还没有把“创建/恢复入口迁出画布”写成正式规格。
  证据：`docs/design-docs/canvas-feedback-polish.md` 当前仍把右上角固定区域视为过渡期可接受方案。

- 观察：当前代码里的顶角 panel 主要承担说明、对象计数、创建入口与重置入口，这些内容大多不需要和节点的空间关系一起理解。
  证据：`src/webview/main.tsx` 当前在 `Panel position="top-left"` 与 `Panel position="top-right"` 中渲染 hero 和 actions panel。

- 观察：VSCode 官方 UX 指南更支持“侧栏里放真实 view”，而不是把 Activity Bar 仅仅当成打开 `WebviewPanel` 的启动器；同时也建议谨慎使用 `WebviewView`。
  证据：2026-03-31 对 VSCode 官方 Views / Sidebars / Webviews 指南的核查结果已在本轮设计结论中消化为约束。

- 观察：当前最小需求不需要 `WebviewView`；原生 `TreeView + QuickPick + 命令入口` 已足以承载打开、创建、重置和最小状态摘要。
  证据：`src/sidebar/CanvasSidebarView.ts`、`src/extension.ts` 与 `package.json` 已完成对应实现，且 `npm run typecheck`、`npm run build` 通过。

## 决策记录

- 决策：本轮先产出“草案规格 + 比较中的设计文档”，而不是直接把侧栏路线写成已验证结论。
  理由：用户当前要求是“开始设计”，而不是“完成实现”；现有仓库中还没有侧栏原型与验证证据，直接写成已确认结论会造成伪确定性。
  日期/作者：2026-03-31 / Codex

- 决策：把本主题拆成独立产品规格和独立设计文档，而不是继续把内容附着到 `canvas-core-collaboration-mvp.md` 或 `canvas-feedback-polish.md` 里。
  理由：第 2 条讨论的是画布外层控件与宿主侧栏的职责重分配，已经是一个独立主题；继续堆进旧文档会让“当前实现过渡态”和“下一轮目标方案”混在一起。
  日期/作者：2026-03-31 / Codex

- 决策：当前推荐路线优先使用原生侧栏 View，而不是侧栏 `WebviewView`。
  理由：这更符合“极简、VSCode 左侧 SideBar 风格”的目标，也更接近官方 UX 对 Activity Bar / Views 的建议；只有在原生 View 无法承载最小状态与动作密度时，才应升级为 `WebviewView`。
  日期/作者：2026-03-31 / Codex

- 决策：第一版把“创建对象”收口为单一侧栏动作，再通过原生 QuickPick 选择对象类型。
  理由：这比在侧栏平铺四个常驻按钮更符合“极简侧栏”的目标，也能避免重新长出另一块 dashboard。
  日期/作者：2026-03-31 / Codex

## 结果与复盘

当前设计阶段已完成：

- 为 `功能体验.md` 第 2 条建立了可追踪的文档链路。
- 明确记录了现状、目标、候选方案、推荐路线和未验证假设。
- 把“画布顶角过渡态”与“侧栏化目标态”分离为两个层次，避免把实现现状误写成长期结论。

当前实现阶段已完成：

- 新增自定义 Activity Bar 容器和原生 `TreeView` 侧栏入口。
- 新增“打开画布”“创建对象”“重置宿主状态”三个宿主命令。
- 从 Webview 中移除了左上角 hero 和右上角 actions panel。
- 当画布已在前台可见时，侧栏创建动作会通过 Host -> Webview 消息复用当前视口锚点。
- `npm run typecheck` 与 `npm run build` 已通过。

当前仍未完成：

- 还没有完成 `Extension Development Host` 中的人工验证。
- 还没有把本计划迁入 `completed/`，也没有基于人工验证补最终复盘。

如果下一位协作者接手，应先做最小原型，再根据结果更新本计划的 `进度`、`意外与发现` 和 `决策记录`，然后才进入实现阶段。

## 上下文与定向

这个任务围绕“画布外层控件”展开。这里的“外层控件”指不属于节点本体、也不依赖节点空间关系，但当前仍以固定 panel 形式贴在画布角落的说明文字、创建入口、恢复入口和轻量状态提示。

与当前任务直接相关的文件有：

- `功能体验.md`：用户新增的体验目标，其中第 2 条要求“只保留左下角和右下角的画板必要 UI 控件，其余内容迁到 VSCode 左侧 SideBar”。
- `docs/product-specs/canvas-core-collaboration-mvp.md`：当前 MVP 总规格，定义四类对象、恢复边界和基础导航要求。
- `docs/design-docs/canvas-feedback-polish.md`：当前已选定的过渡期结论，解决了“遮挡左下角控件”“右侧重复信息”等问题，但仍保留顶角 panel。
- `src/webview/main.tsx` 与 `src/webview/styles.css`：当前画布 Webview 里真正渲染顶角 panel 的地方。
- `package.json`：未来若实现侧栏，需要在这里增加 `viewsContainers`、`views` 与相关命令入口。

本轮还需要显式记住三条宿主约束，这些约束不应在后续实现时丢失：

1. 画布主工作面仍然是 Editor Group 中的 `WebviewPanel`，不是侧栏本身。
2. VSCode 允许用户移动或折叠侧栏，因此设计应定义“默认入口在左侧”，但不能假设它永远固定在左边。
3. 既然目标是“极简侧栏”，就不应在侧栏重新长出一个 mini inspector、对象详情区或第二块 dashboard。

## 工作计划

第一步，先把问题拆清楚：当前顶角 panel 到底分别承载了什么，以及哪些内容和空间关系无关，因而应该迁出画布。这里的判断标准不是“能不能塞得下”，而是“这项信息是否必须和节点一起被看见才有意义”。

第二步，产出独立产品规格，明确本主题的用户问题、目标用户、核心流程、范围边界、最小必要状态和验收标准。规格层不锁死实现细节，但必须清楚写出：画布里只剩哪些角落控件，侧栏承担哪些动作和最小状态。

第三步，产出独立设计文档，比较至少三条路线：继续把内容留在画布里、用原生侧栏 View 承载、用侧栏 `WebviewView` 承载。设计文档必须把优缺点、风险和当前推荐路线写清楚，并显式标记哪些内容仍待原型验证。

第四步，同步更新文档索引与通用信念。索引负责让下一位协作者能找到新文档；核心信念负责把“空间无关的固定 chrome 应优先离开画布”提升成跨主题通用原则。

第五步，当前已经落地第一版实现；下一阶段应进入人工验证与细节打磨，而不是重新打开“是否需要 `WebviewView`”这类已经收口的问题。只有当人工验证证明原生 View 明显不足时，才回到设计文档改写路线。

## 具体步骤

在仓库根目录执行并记录结果：

1. 阅读设计与工作流入口文档，确认是否需要 `ExecPlan`。
2. 阅读 `功能体验.md`、相关规格、现有设计文档和当前 Webview 实现。
3. 新建以下文档：
   - `docs/exec-plans/active/canvas-sidebar-controls-design.md`
   - `docs/product-specs/canvas-sidebar-controls.md`
   - `docs/design-docs/canvas-sidebar-controls.md`
4. 更新以下索引和通用文档：
   - `docs/product-specs/index.md`
   - `docs/design-docs/index.md`
   - `docs/design-docs/core-beliefs.md`
5. 进行文档自检，确认状态字段、索引登记和设计结论之间没有相互矛盾。

当前阶段应在仓库根目录追加执行：

1. 运行 `npm run typecheck`。
2. 运行 `npm run build`。
3. 在 VSCode `Extension Development Host` 中手动验证侧栏与画布联动。
4. 根据手动验证结果更新本计划、设计文档和必要的实现细节。

## 验证与验收

本轮设计阶段完成的标准是：

- 新增一份独立产品规格，且规格能独立说明“哪些控件留在画布，哪些迁到侧栏”。
- 新增一份独立设计文档，且文档至少比较三条候选路线，并写明当前推荐路线与未验证风险。
- `docs/product-specs/index.md` 与 `docs/design-docs/index.md` 已登记新文档，状态与正文保持一致。
- `docs/design-docs/core-beliefs.md` 已补充可复用的通用原则，而不是只留下零散局部结论。
- 文档中没有把“尚未原型验证的侧栏路线”误写成“已验证”或“已实现”。

当前实现阶段的验收标准应至少包含：

- 打开画布后，左上角和右上角不再出现固定 hero / actions panel。
- 用户可从默认侧栏入口打开或定位画布、创建对象和重置宿主状态。
- 画布内只保留左下角导航控件和右下角全局定位控件作为常驻角落 UI。
- 自动化检查 `npm run typecheck` 与 `npm run build` 通过。

## 幂等性与恢复

- 本轮所有文档编辑都可重复执行；若后续方案调整，应直接修改这些正式文档，而不是新建临时备忘录替代。
- 如果原生侧栏 View 原型证明不成立，应在本计划与设计文档里记录失败原因，再改写推荐路线；不要静默切到 `WebviewView`。
- 如果未来实现阶段需要变更当前过渡期的顶角 panel 结论，应在新结论被验证后再回头更新或收口 `docs/design-docs/canvas-feedback-polish.md`，避免提前抹掉历史上下文。

## 证据与备注

本轮设计输入的最关键证据如下：

    功能体验.md 第 2 条：
    “简化画板区域的内容，只保留左下角和右下角的画板必要UI控件。
    左上角和右上角的控件内容不在画板区域显示。
    只保留最小必要的按钮和信息，以极简的风格作成 VSCode 左侧的 SideBar”

    第一版实现：
    package.json 中新增 Activity Bar 容器与侧栏视图
    src/sidebar/CanvasSidebarView.ts 中新增原生 TreeView
    src/webview/main.tsx 中删除 Panel position="top-left" 与 Panel position="top-right"

    自动化验证：
    npm run typecheck
    npm run build

## 接口与依赖

当前实现已围绕以下宿主接口与 UI 接口落地：

- `package.json` 中的 `contributes.viewsContainers.activitybar` 与 `contributes.views`
- `vscode.window.createTreeView(...)` 或等价的原生 View Provider 路径
- 现有 `devSessionCanvas.openCanvas` 正式命令
- `src/panel/CanvasPanelManager.ts` 暴露给侧栏的宿主权威状态摘要，例如节点数、运行中执行单元数与 workspace trust 状态

当前仍保持“不引入第二个大型 React 前端来复制侧栏”的边界。如果后续人工验证证明原生 View 路线确实不能满足需求，再把 `WebviewView` 作为升级方案写回设计文档。

本次修订说明：2026-03-31 11:11 +0800 将本计划从纯设计阶段推进到第一版实现，新增原生侧栏入口、移除 Webview 顶角 panel，并补充自动化验证结果与剩余人工验证事项。
