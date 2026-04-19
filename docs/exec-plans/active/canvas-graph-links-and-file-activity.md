# 画布关系连线与文件活动视图实现

本 `ExecPlan` 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘` 这几个章节。

本文位于 `docs/exec-plans/active/canvas-graph-links-and-file-activity.md`，必须按 `docs/PLANS.md` 的要求持续维护。

## 目标与全局图景

这次变更完成后，用户会在画布里直接得到两类新增能力。第一类是“关系连线”：任意节点都能从四向锚点拖出一条持久化连线，并继续编辑箭头模式、标签和删除。第二类是“文件活动视图”：当支持结构化文件事件的 Agent 读写文件时，画布会自动出现文件节点或文件列表节点，用户可点击这些文件对象直接回到 VSCode 编辑区。

用户应能亲眼看到三件事同时成立：连线会在 reload 后保留；支持的 Agent provider 会实时生成文件对象；删除 Agent 后，失去引用的文件对象会一起退出画布。

## 进度

- [x] (2026-04-19 10:52 +0800) 读取 `docs/WORKFLOW.md`、`docs/PLANS.md`、`ARCHITECTURE.md`、`docs/product-specs/index.md`、`tmp.md` 和核心实现，确认这次改动需要独立 `ExecPlan`、产品规格和设计文档。
- [x] (2026-04-19 10:56 +0800) 从远端 `origin/main` 切出主题分支 `canvas-links-and-file-nodes`，保留用户工作树中已有未跟踪文件。
- [x] (2026-04-19 11:28 +0800) 明确正式范围：通用连线完整落地；文件活动走 provider 结构化事件；`Claude` / `fake-agent-provider` 提供第一轮自动文件活动，`Codex` 先保留 no-op 适配并写入文档。
- [x] (2026-04-19 11:52 +0800) 新增产品规格、设计文档、执行计划，并同步 `docs/design-docs/index.md`、`docs/product-specs/index.md` 和 `docs/design-docs/core-beliefs.md`。
- [x] (2026-04-19 14:10 +0800) 完成共享协议与宿主持久化：新增 `edges` / `fileReferences` 权威状态、文件视图配置、文件打开消息与自动文件对象重建路径。
- [x] (2026-04-19 14:24 +0800) 完成 provider 文件活动接线：新增 `agentFileActivity` 宿主模块、Claude hook 脚本、fake provider NDJSON 事件流与 Codex no-op 退化路径。
- [x] (2026-04-19 14:48 +0800) 完成 Webview 交互：四向 handles、自定义 edge UI、文件节点 / 文件列表节点渲染、文件打开入口与测试 probe/action 扩展。
- [x] (2026-04-19 15:11 +0800) 完成自动化验证与文档回填：补齐 Playwright / VS Code smoke 覆盖，修正一个既有 smoke 断言对瞬时恢复状态的过度约束，并更新截图基线。
- [x] (2026-04-19 15:23 +0800) 按主题拆分正式设计文档：将原合并设计文档拆成“关系连线”和“文件活动视图”两份文档，并同步索引与关联引用。
- [x] (2026-04-19 16:31 +0800) 根据新增 UI 收口要求，先把关系连线规格与设计文档从“右键菜单”修订为“选中态轻量编辑台 + 双击原位标签编辑”，为后续实现和回归测试提供正式口径。

## 意外与发现

- 观察：当前权威状态只持有 `nodes`，React Flow 也固定传 `edges={[]}`，所以连线功能必须从共享协议层开始改，而不是只在 Webview 增加局部交互。
  证据：`src/common/protocol.ts` 的 `CanvasPrototypeState` 目前只有 `nodes`；`src/webview/main.tsx` 固定把 `edges={[]}` 传给 React Flow。
- 观察：`Claude Code` 官方 hooks 和 `--settings` 路线可以为单次 CLI 启动注入结构化工具事件，不需要修改用户仓库里的 `.claude` 设置文件。
  证据：官方文档说明 hooks 可监听 `PreToolUse` / `PostToolUse`，CLI 同时支持 `--settings` 参数注入临时配置。
- 观察：VSCode Webview 没有直接给任意 workspace 文件渲染当前 file icon theme 图标的单一 API。
  证据：当前仓库和公开 API 都只有 `TreeItem` / `ThemeIcon` 等宿主控件能力；Webview 侧仍需由宿主先把主题资源解析成可显示描述。

## 决策记录

- 决策：把文件活动建模成独立 `fileReferences` 权威状态，再由宿主投影成文件节点或文件列表节点。
  理由：这样可以避免展示模式切换时把自动生成节点误当成事实来源，也能让生命周期和持久化围绕统一数据模型收口。
  日期/作者：2026-04-19 / Codex
- 决策：自动 Agent-文件关系线不开放人工编辑。
  理由：这类边的事实来源是 provider 文件活动事件；若允许用户手改，会和宿主重建逻辑冲突。
  日期/作者：2026-04-19 / Codex
- 决策：第一轮自动文件活动正式支持 `Claude` 与 `fake-agent-provider`，`Codex` 保留 no-op adapter。
  理由：当前只有 Claude hooks 路线具备已确认的 provider 原生结构化工具事件；Codex 在本仓库里尚无同等证据。
  日期/作者：2026-04-19 / Codex
- 决策：文件图标优先解析当前 file icon theme，失败时回退到通用文件图标，而不是阻塞整个功能。
  理由：用户需求明确要求复用 VSCode Icon Theme，但 Webview 无单一现成 API；采用“尽量复用 + 明确回退”比发明一套固定私有图标更符合 VSCode 语境。
  日期/作者：2026-04-19 / Codex
- 决策：连线编辑主路径从右键菜单收口为“选中态轻量编辑台 + 双击原位标签编辑”，并保持 VSCode Workbench 风格。
  理由：右键菜单与胶囊占位会制造“可见但不可直接编辑”的错觉，也偏离当前仓库整体的 Workbench 原生化方向；选中态轻量编辑台更贴近画布中对象级操作的主路径。
  日期/作者：2026-04-19 / Codex

## 结果与复盘

本轮按计划落地了两层能力。第一层是用户可编辑的手工连线：宿主持久化 `CanvasEdgeSummary`，Webview 支持创建、选中、右键编辑箭头模式、双击改标签与删除。第二层是 provider 结构化文件活动：宿主持久化 `fileReferences`，再按当前配置投影成文件节点或文件列表节点，并把“点击文件”统一交还 VSCode 宿主打开编辑器。

随着实现收口，正式设计文档也已按主题拆分为 `docs/design-docs/canvas-graph-links.md` 与 `docs/design-docs/canvas-file-activity-view.md`。这样可以把“手工/自动连线模型”和“provider 文件活动投影”分别维护，减少后续继续迭代时的文档耦合。

验证上，Webview 现在有针对手工 edge、文件节点和文件列表节点的独立 Playwright 覆盖；宿主 smoke 覆盖了手工 edge 生命周期、fake provider 文件活动、展示模式切换、点击打开文件，以及删除 Agent 后的文件对象清理。过程中发现一条既有 smoke 断言把“可恢复”错误地绑定到了单一瞬时 status 文案；改成检查真正的不变量后，整条 trusted smoke 恢复通过。

## 上下文与定向

本轮会同时触达四个代码区域。

第一处是 `src/common/protocol.ts`。这里定义跨宿主 / Webview 的共享状态和消息协议。连线、文件活动引用、文件节点 metadata、打开文件消息和展示模式配置都需要先在这里落类型。

第二处是 `src/panel/CanvasPanelManager.ts`。它是 workspace 绑定画布状态的唯一权威入口。本轮所有 edge 持久化、自动文件对象重建、provider 文件活动接线和“点击文件后打开编辑器”都必须经过这里。

第三处是 `src/webview/main.tsx` 与 `src/webview/styles.css`。这里要补四向 handles、自定义 edge UI、文件节点 / 文件列表节点渲染、文件点击回传以及针对自动边与手工边的交互边界。

第四处是测试与辅助 provider。`tests/playwright/webview-harness.spec.mjs` 负责 Webview 图交互；`tests/vscode-smoke/extension-tests.cjs` 负责真实宿主与打开文件路径；`tests/vscode-smoke/fixtures/fake-agent-provider` 需要补结构化文件事件输出。

## 工作计划

先改共享模型和宿主状态，让连线与文件活动都有正式可持久化的数据结构。然后实现 provider 文件活动 adapter 和宿主重建逻辑，把自动文件对象完整接进权威状态。接着再改 Webview，把四向 handles、edge 编辑和两种文件视图渲染补上。最后用 Playwright 和 smoke 共同验证“UI 可交互”和“宿主真能打开文件”这两层结果。

## 具体步骤

1. 更新文档与索引：

    - `docs/product-specs/canvas-graph-links-and-file-activity.md`
    - `docs/design-docs/canvas-graph-links.md`
    - `docs/design-docs/canvas-file-activity-view.md`
    - `docs/design-docs/index.md`
    - `docs/product-specs/index.md`
    - `docs/design-docs/core-beliefs.md`

2. 扩展共享协议与配置：

    - `src/common/protocol.ts`
    - `src/common/extensionIdentity.ts`
    - `package.json`
    - `package.nls.json`

3. 实现宿主状态与 provider 文件活动：

    - `src/panel/CanvasPanelManager.ts`
    - 新增 provider 文件活动模块
    - 如需独立 runtime 脚本，同步进入构建产物

4. 实现 Webview 交互与样式：

    - `src/webview/main.tsx`
    - `src/webview/styles.css`

5. 更新测试与 fixture：

    - `tests/playwright/webview-harness.spec.mjs`
    - `tests/vscode-smoke/extension-tests.cjs`
    - `tests/vscode-smoke/fixtures/fake-agent-provider`

6. 运行验证：

    - `npm run typecheck`
    - `npm run test:webview`
    - `DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=trusted node scripts/run-vscode-smoke.mjs`

## 验证与验收

至少要完成以下验证：

- Webview 层：创建一条手工 edge，编辑其标签与箭头模式，再删除它，确认 UI 与持久化都正确。
- 宿主层：模拟支持文件事件的 Agent 上报读写文件，确认自动文件对象和自动边进入权威状态。
- VSCode 打开链路：点击文件节点或文件列表条目后，真实编辑器打开对应文件。
- 生命周期：删除 Agent 节点后，不再被任何 Agent 引用的文件对象被清理；仍有引用的文件对象保留。

## 幂等性与恢复

自动文件对象必须可以根据 `fileReferences` 重建，因此在 reload、host-boundary restore 和配置切换后都要得到同一结果。若某 provider 没有文件活动支持，宿主应安全退化成“没有自动文件对象”，而不是抛错或生成假数据。

## 证据与备注

- `npm run typecheck`：通过。
- `npm run test:webview`：58/58 通过；同步更新了 `canvas-shell-baseline-linux.png` 基线。
- `DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=trusted node scripts/run-vscode-smoke.mjs`：通过。
- 关键新增验证：
  - Playwright：手工 edge 创建 / 选中 / 更新 / 删除；文件节点渲染与 `webview/openCanvasFile`；文件列表节点渲染与条目打开。
  - VS Code smoke：宿主手工 edge 持久化；fake provider 文件活动生成 `fileReferences` / `file` / `file-list`；点击文件节点 / 列表条目打开编辑器；删除 Agent 清理孤立文件对象。

## 接口与依赖

本轮预期新增或修改以下接口：

- `src/common/protocol.ts`
  - `CanvasEdgeSummary`
  - `CanvasFileReferenceSummary`
  - `CanvasFilePresentationMode`
  - 与 edge / file open 对应的新消息类型

- `src/panel/CanvasPanelManager.ts`
  - state normalize / persist / reconcile 路径
  - webview message handler
  - provider session 启动路径

- Webview
  - React Flow `edges`
  - 自定义 node / edge types
  - 文件点击与 edge 编辑消息

---

本次创建说明：2026-04-19 新增本计划，用于覆盖 `tmp.md` 中的通用连线、文件节点和文件列表节点功能；之所以独立起计划，是因为改动同时涉及正式规格、设计决策、共享协议、provider 结构化事件接线、宿主持久化、Webview UI 与自动化验证。
