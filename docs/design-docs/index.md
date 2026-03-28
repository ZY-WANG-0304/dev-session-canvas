# 设计文档索引

本文件是设计文档注册表，用于编目具体设计方案，并汇总每份设计文档的决策状态与验证状态。

## 支持文件

- `core-beliefs.md`：通用协作信念
- `template-design-doc.md`：设计文档模板

支持文件不属于具体设计方案，不在下方注册表中登记状态。

## 注册字段

- `文档`：具体设计文档路径
- `主题`：该文档要解决的问题
- `关联域/架构层`：对应领域和架构层
- `决策状态`：与文档 frontmatter 中的 `decision_status` 保持一致
- `验证状态`：与文档 frontmatter 中的 `validation_status` 保持一致
- `关联规格/计划`：相关产品规格或执行计划
- `最后更新`：与文档 frontmatter 中的 `updated_at` 保持一致

## 设计方案注册表

| 文档 | 主题 | 关联域/架构层 | 决策状态 | 验证状态 | 关联规格/计划 | 最后更新 |
| --- | --- | --- | --- | --- | --- | --- |
| `docs/design-docs/agent-runtime-prototype.md` | Agent 节点最小真实 backend 的候选路线、取舍与原型边界 | VSCode 集成域、协作对象域、执行编排域 / 宿主集成层、画布呈现层、共享模型与编排层、适配与基础设施层 | 已选定 | 未验证 | `docs/product-specs/canvas-core-collaboration-mvp.md`、`docs/exec-plans/active/agent-runtime-prototype.md` | 2026-03-28 |
| `docs/design-docs/vscode-canvas-runtime-architecture.md` | VSCode 内无限画布的运行时边界、技术路线与初步选型 | VSCode 集成域、画布交互域、协作对象域、执行编排域、项目状态域 / 宿主集成层、画布呈现层、共享模型与编排层、适配与基础设施层 | 比较中 | 未验证 | `docs/exec-plans/active/canvas-architecture-research.md` | 2026-03-28 |

## 维护约定

- 这里只登记具体设计方案文档，不登记模板或通用原则文档。
- 新增设计文档后，应先填写 frontmatter，再同步更新本注册表。
- 如果注册表与具体设计文档状态不一致，以具体设计文档 frontmatter 为准。
