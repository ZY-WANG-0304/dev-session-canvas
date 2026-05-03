# 产品规格索引

本文件用于登记具体产品规格文档，并区分模板、草案与已确认规格。

## 支持文件

- `template-product-spec.md`：产品规格模板

## 产品规格列表

| 文档 | 主题 | 状态 | 依据 | 最后更新 |
| --- | --- | --- | --- | --- |
| `docs/product-specs/agent-launch-modes-and-restart.md` | Agent 创建前启动方式、默认启动参数与停止后重启/新会话分流 | 已确认 | `docs/PRODUCT_SENSE.md`、`ARCHITECTURE.md`、`docs/design-docs/agent-launch-modes-and-restart.md`、`docs/design-docs/execution-lifecycle-and-recovery.md` | 2026-04-24 |
| `docs/product-specs/canvas-graph-links-and-file-activity.md` | 画布通用关系连线、Agent 文件活动投影、文件节点与文件列表节点 | 已确认 | `docs/PRODUCT_SENSE.md`、`ARCHITECTURE.md`、`docs/design-docs/canvas-graph-links.md`、`docs/design-docs/canvas-file-activity-view.md` | 2026-04-21 |
| `docs/product-specs/canvas-navigation-and-workbench-polish.md` | 画布导航、默认 `panel` 主路径、标题栏原生收口与空白区右键创建 | 已确认 | `docs/PRODUCT_SENSE.md`、`ARCHITECTURE.md`、`docs/design-docs/canvas-navigation-and-workbench-polish.md` | 2026-04-13 |
| `docs/product-specs/canvas-node-notifications.md` | 画布节点通知：终端注意力信号桥接、节点视觉提示、强提醒模式与 notifier companion 优先回退链路 | 已确认 | `docs/PRODUCT_SENSE.md`、`ARCHITECTURE.md`、`src/common/executionAttentionSignals.ts`、`src/common/agentActivityHeuristics.ts` | 2026-05-03 |
| `docs/product-specs/canvas-core-collaboration-mvp.md` | 画布核心协作 MVP 主路径与验收口径 | 草案 | `docs/PRODUCT_SENSE.md`、`ARCHITECTURE.md`、`docs/design-docs/vscode-canvas-runtime-architecture.md`、`docs/design-docs/canvas-surface-placement.md` | 2026-04-08 |
| `docs/product-specs/canvas-sidebar-controls.md` | 画布外层控件极简化与侧栏承载范围 | 草案 | `docs/PRODUCT_SENSE.md`、`ARCHITECTURE.md`、`docs/design-docs/canvas-sidebar-controls.md` | 2026-04-20 |
| `docs/product-specs/canvas-sidebar-node-and-session-lists.md` | 画布侧栏节点列表与历史会话列表 | 草案 | `docs/PRODUCT_SENSE.md`、`ARCHITECTURE.md` | 2026-04-28 |
| `docs/product-specs/runtime-persistence-modes.md` | `Agent` / `Terminal` 在关闭画布、关闭 VSCode 与重新打开后的两档运行时持久化模式 | 草案 | `docs/PRODUCT_SENSE.md`、`ARCHITECTURE.md`、`docs/design-docs/runtime-persistence-and-session-supervisor.md` | 2026-04-08 |

## 当前状态

当前仓库已开始按主题拆分具体产品规格，而不是把所有需求堆入单一文档。涉及画布外层控件、侧栏承载面和 UI 收口的后续讨论，应优先继续维护对应专项规格。

## 维护约定

- 新增具体产品规格时，应同步更新本索引。
- 如果某份规格仍包含待确认假设，应在规格正文与本索引中显式标注状态。
- 长期产品判断继续维护在 `docs/PRODUCT_SENSE.md`，不要把单份规格反向写成全局产品结论。
