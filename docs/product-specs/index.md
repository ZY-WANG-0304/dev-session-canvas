# 产品规格索引

本文件用于登记具体产品规格文档，并区分模板、草案与已确认规格。

## 支持文件

- `template-product-spec.md`：产品规格模板

## 产品规格列表

| 文档 | 主题 | 状态 | 依据 | 最后更新 |
| --- | --- | --- | --- | --- |
| `docs/product-specs/canvas-core-collaboration-mvp.md` | 画布核心协作 MVP 主路径与验收口径 | 草案 | `docs/PRODUCT_SENSE.md`、`ARCHITECTURE.md`、`docs/design-docs/vscode-canvas-runtime-architecture.md` | 2026-03-28 |
| `docs/product-specs/canvas-sidebar-controls.md` | 画布外层控件极简化与侧栏承载范围 | 草案 | `docs/PRODUCT_SENSE.md`、`ARCHITECTURE.md`、`docs/design-docs/canvas-sidebar-controls.md` | 2026-03-31 |

## 当前状态

当前仓库已开始按主题拆分具体产品规格，而不是把所有需求堆入单一文档。涉及画布外层控件、侧栏承载面和 UI 收口的后续讨论，应优先继续维护对应专项规格。

## 维护约定

- 新增具体产品规格时，应同步更新本索引。
- 如果某份规格仍包含待确认假设，应在规格正文与本索引中显式标注状态。
- 长期产品判断继续维护在 `docs/PRODUCT_SENSE.md`，不要把单份规格反向写成全局产品结论。
