# 产品规格索引

本文件用于登记具体产品规格文档，并区分模板、草案与已确认规格。

## 支持文件

- `template-product-spec.md`：产品规格模板

## 产品规格列表

| 文档 | 主题 | 状态 | 依据 | 最后更新 |
| --- | --- | --- | --- | --- |
| `docs/product-specs/agent-launch-modes-and-restart.md` | Agent 创建前启动方式、默认启动参数、停止后重启/新会话分流与 Claude Code Fork | 已确认 | `docs/PRODUCT_SENSE.md`、`ARCHITECTURE.md`、`docs/design-docs/agent-launch-modes-and-restart.md`、`docs/design-docs/execution-lifecycle-and-recovery.md` | 2026-06-08 |
| `docs/product-specs/agent-terminal-clipboard-shortcuts.md` | Agent / Terminal 执行节点的复制、粘贴与 `Ctrl+C` 打断冲突处理 | 已确认 | `ARCHITECTURE.md`、`docs/design-docs/execution-terminal-clipboard-shortcuts.md`、VSCode 原生 Terminal upstream 调研 | 2026-05-09 |
| `docs/product-specs/canvas-graph-links-and-file-activity.md` | 画布通用关系连线、Agent 文件活动投影、文件节点与文件列表节点 | 已确认 | `docs/PRODUCT_SENSE.md`、`ARCHITECTURE.md`、`docs/design-docs/canvas-graph-links.md`、`docs/design-docs/canvas-file-activity-view.md` | 2026-06-08 |
| `docs/product-specs/canvas-node-groups.md` | 画布节点分组：把多个不同稳定节点与 owner Agent 推导的自动文件活动节点组织到同一个可命名分组框中，并支持批量移动、恢复、模板保留和空间导航 | 草案 | `docs/PRODUCT_SENSE.md`、`ARCHITECTURE.md`、`docs/design-docs/canvas-node-groups.md`、行业成熟画布分组方案调研 | 2026-06-08 |
| `docs/product-specs/canvas-multi-root-workspace-support.md` | 多根 workspace 组合视图：单根 root-local 画布、多根系统 root section、空间导航与 shared live runtime 恢复 | 已确认 | `docs/PRODUCT_SENSE.md`、`ARCHITECTURE.md`、`docs/design-docs/canvas-multi-root-workspace-support.md`、`docs/exec-plans/active/canvas-multi-root-composed-canvas-rewrite.md`、`docs/exec-plans/completed/canvas-spatial-fit-minimap.md`、`docs/exec-plans/completed/canvas-add-folder-root-placement.md` | 2026-06-09 |
| `docs/product-specs/explorer-resource-create-execution-node.md` | File Explorer 资源右键创建绑定 cwd 的 Terminal / Agent 执行节点 | 已确认 | `docs/PRODUCT_SENSE.md`、`ARCHITECTURE.md`、`docs/design-docs/explorer-resource-create-execution-node.md`、`docs/exec-plans/completed/explorer-resource-create-execution-node-implementation.md` | 2026-06-03 |
| `docs/product-specs/explorer-markdown-create-note.md` | File Explorer Markdown 文件右键创建关联 Note 节点 | 已确认 | `docs/design-docs/note-markdown-file-association.md`、`docs/product-specs/canvas-core-collaboration-mvp.md` | 2026-06-07 |
| `docs/product-specs/canvas-navigation-and-workbench-polish.md` | 画布导航、默认 `panel` 主路径、标题栏原生收口、空白区右键创建、空间对象级 fit / MiniMap 与低倍率概览 | 已确认 | `docs/PRODUCT_SENSE.md`、`ARCHITECTURE.md`、`docs/design-docs/canvas-navigation-and-workbench-polish.md` | 2026-06-06 |
| `docs/product-specs/canvas-node-notifications.md` | 画布节点通知：终端注意力信号桥接、Agent 异常中断提醒、异常输出文本匹配配置、节点视觉提示、强提醒模式与 notifier companion 优先回退链路 | 已确认 | `docs/PRODUCT_SENSE.md`、`ARCHITECTURE.md`、`docs/design-docs/execution-node-notification-and-attention-signals.md`、`src/common/executionAttentionSignals.ts`、`src/common/agentActivityHeuristics.ts` | 2026-05-26 |
| `docs/product-specs/canvas-core-collaboration-mvp.md` | 画布核心协作 MVP 主路径与验收口径 | 草案 | `docs/PRODUCT_SENSE.md`、`ARCHITECTURE.md`、`docs/design-docs/vscode-canvas-runtime-architecture.md`、`docs/design-docs/canvas-surface-placement.md` | 2026-04-08 |
| `docs/product-specs/canvas-sidebar-controls.md` | 画布外层控件极简化与侧栏承载范围 | 草案 | `docs/PRODUCT_SENSE.md`、`ARCHITECTURE.md`、`docs/design-docs/canvas-sidebar-controls.md` | 2026-05-10 |
| `docs/product-specs/canvas-sidebar-node-and-session-lists.md` | 画布侧栏节点列表与历史会话列表 | 草案 | `docs/PRODUCT_SENSE.md`、`ARCHITECTURE.md`、`docs/design-docs/canvas-sidebar-node-and-session-lists.md` | 2026-06-03 |
| `docs/product-specs/runtime-persistence-modes.md` | `Agent` / `Terminal` 在关闭画布、关闭 VSCode 与重新打开后的两档运行时持久化模式 | 草案 | `docs/PRODUCT_SENSE.md`、`ARCHITECTURE.md`、`docs/design-docs/runtime-persistence-and-session-supervisor.md` | 2026-04-08 |
| `docs/product-specs/canvas-template-feature.md` | Canvas 模板功能：默认模板机制、内置模板、自定义模板保存与分享、模板管理 | 草案 | `docs/PRODUCT_SENSE.md`、`ARCHITECTURE.md`、`docs/design-docs/canvas-template-feature.md` | 2026-05-15 |

## 当前状态

当前仓库已开始按主题拆分具体产品规格，而不是把所有需求堆入单一文档。涉及画布外层控件、侧栏承载面或已立项功能范围的后续讨论，应优先继续维护对应专项规格；跨功能 UI design-system 规则继续维护在 `docs/UI.md`。

## 维护约定

- 新增具体产品规格时，应同步更新本索引。
- 如果某份规格仍包含待确认假设，应在规格正文与本索引中显式标注状态。
- 长期产品判断继续维护在 `docs/PRODUCT_SENSE.md`，不要把单份规格反向写成全局产品结论。
