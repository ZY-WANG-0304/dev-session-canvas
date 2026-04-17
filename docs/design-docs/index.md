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
| `docs/design-docs/marketplace-readme-media-automation.md` | Marketplace README 的 `PNG` / `MP4` 与仓库 README 的 `GIF` 如何基于真实 VS Code 宿主自动生成并稳定接入发布链路 | VSCode 集成域、画布交互域、项目状态域 / 宿主集成层、画布呈现层、适配与基础设施层 | 已选定 | 已验证 | `docs/exec-plans/completed/marketplace-real-vscode-media-automation.md` | 2026-04-16 |
| `docs/design-docs/execution-node-terminal-native-interactions.md` | 执行节点如何补齐与 VSCode 原生 Terminal 对齐的文件拖拽输入路径与文件路径/URL 点击跳转 | VSCode 集成域、画布交互域、协作对象域、执行编排域 / 宿主集成层、画布呈现层、共享模型与编排层 | 已选定 | 验证中 | `docs/product-specs/canvas-core-collaboration-mvp.md`、`docs/exec-plans/completed/execution-node-terminal-native-interactions.md` | 2026-04-17 |
| `docs/design-docs/canvas-navigation-and-workbench-polish.md` | 节点快速聚焦、默认 `panel` 主路径、标题栏 workbench 原生化、空白区右键创建与内嵌 `xterm` 主题同步的正式交互边界 | VSCode 集成域、画布交互域、协作对象域 / 宿主集成层、画布呈现层、共享模型与编排层 | 已选定 | 已验证 | `docs/product-specs/canvas-navigation-and-workbench-polish.md`、`docs/exec-plans/completed/canvas-navigation-and-native-polish.md` | 2026-04-13 |
| `docs/design-docs/agent-running-state-detection.md` | Agent 节点的 `running` / `waiting-input` 应如何基于 provider 原生事件、结构化输出与 fallback 启发式进行判定 | VSCode 集成域、协作对象域、执行编排域、项目状态域 / 宿主集成层、共享模型与编排层、适配与基础设施层 | 已选定 | 验证中 | `docs/product-specs/canvas-core-collaboration-mvp.md`、`docs/exec-plans/completed/agent-running-state-detection.md` | 2026-04-14 |
| `docs/design-docs/agent-cli-launch-context-and-resume.md` | Agent 节点启动时的 repo 上下文、provider 配置继承边界与显式 session resume 规则 | VSCode 集成域、协作对象域、执行编排域、项目状态域 / 宿主集成层、共享模型与编排层、适配与基础设施层 | 已选定 | 未验证 | `docs/product-specs/canvas-core-collaboration-mvp.md`、`docs/product-specs/runtime-persistence-modes.md`、`docs/exec-plans/completed/agent-cli-launch-context-and-resume.md` | 2026-04-14 |
| `docs/design-docs/agent-node-creation-provider-selection.md` | 新增 Agent 节点时，如何在保留默认快速路径的同时提供创建前 provider 选择 | VSCode 集成域、画布交互域、协作对象域 / 宿主集成层、画布呈现层、共享模型与编排层 | 已选定 | 已验证 | `docs/product-specs/canvas-core-collaboration-mvp.md`、`docs/product-specs/canvas-navigation-and-workbench-polish.md`、`docs/exec-plans/completed/agent-node-creation-provider-selection-implementation.md` | 2026-04-13 |
| `docs/design-docs/execution-node-zoom-interaction-surface.md` | 执行节点在继续跟随 React Flow 缩放的前提下，如何修复 `xterm.js` 的鼠标命中、拖选和右键坐标偏移 | 画布交互域、协作对象域、执行编排域 / 画布呈现层、共享模型与编排层 | 已选定 | 已验证 | `docs/exec-plans/completed/execution-node-zoom-coordinate-alignment.md`、`docs/exec-plans/completed/execution-node-zoom-interaction-research.md` | 2026-04-12 |
| `docs/design-docs/public-marketplace-release-readiness.md` | 公开 `Marketplace Preview` 的渠道选择、剩余 release-day 动作与发布边界判断 | VSCode 集成域、项目状态域 / 宿主集成层、适配与基础设施层 | 已选定 | 验证中 | `docs/exec-plans/completed/public-marketplace-release-readiness-research.md` | 2026-04-16 |
| `docs/design-docs/development-debug-automation.md` | 隔离开发宿主、真实扩展 smoke test 与 Webview Playwright UI 回归的三层调试自动化方案 | VSCode 集成域、画布交互域、项目状态域 / 宿主集成层、画布呈现层、共享模型与编排层 | 已选定 | 已验证 | `docs/exec-plans/completed/extension-debug-automation.md`、`docs/exec-plans/completed/remote-ssh-runtime-persistence-automation.md` | 2026-04-10 |
| `docs/design-docs/dev-session-canvas-namespace-migration.md` | 正式产品名落定后，将命令、配置、持久化键与扩展身份统一到 `DevSessionCanvas`，并明确内部 VSIX 断点迁移口径的方案 | VSCode 集成域、项目状态域 / 宿主集成层、共享模型与编排层 | 已选定 | 已验证 | `docs/product-specs/canvas-core-collaboration-mvp.md`、`docs/exec-plans/completed/dev-session-canvas-extension-identity-cutover.md`、`docs/exec-plans/completed/dev-session-canvas-namespace-migration.md` | 2026-04-06 |
| `docs/design-docs/execution-lifecycle-and-recovery.md` | 执行节点的差异化生命周期、创建即打开规则，以及 Agent 自动恢复入口的正式边界 | VSCode 集成域、协作对象域、执行编排域、项目状态域 / 宿主集成层、画布呈现层、共享模型与编排层、适配与基础设施层 | 已选定 | 验证中 | `docs/product-specs/canvas-core-collaboration-mvp.md`、`docs/product-specs/runtime-persistence-modes.md`、`docs/exec-plans/completed/agent-cli-launch-context-and-resume.md`、`docs/exec-plans/completed/agent-running-state-detection.md`、`docs/exec-plans/completed/execution-lifecycle-recovery-and-autostart.md` | 2026-04-14 |
| `docs/design-docs/runtime-persistence-and-session-supervisor.md` | 将运行时持久化正式拆成 `snapshot-only` 与 `live-runtime` 两档，并为真实跨 VSCode 生命周期的进程存活引入会话监督器路线 | VSCode 集成域、协作对象域、执行编排域、项目状态域 / 宿主集成层、共享模型与编排层、适配与基础设施层 | 已选定 | 验证中 | `docs/product-specs/runtime-persistence-modes.md`、`docs/product-specs/canvas-core-collaboration-mvp.md`、`docs/exec-plans/completed/runtime-persistence-and-supervisor-design.md`、`docs/exec-plans/completed/remote-ssh-runtime-persistence-automation.md`、`docs/exec-plans/completed/runtime-host-backend-systemd-user.md`、`docs/exec-plans/active/runtime-terminal-state-restore.md`、`docs/exec-plans/completed/remote-canvas-state-revert-investigation.md`、`docs/exec-plans/completed/canvas-storage-slot-recovery-fix.md` | 2026-04-16 |
| `docs/design-docs/extension-icon-candidates.md` | 主扩展 icon 与 activity bar icon 的最终资产收口、PNG 同步与历史草稿清理 | VSCode 集成域、画布交互域 / 宿主集成层、画布呈现层 | 已选定 | 验证中 | `docs/product-specs/canvas-core-collaboration-mvp.md` | 2026-04-06 |
| `docs/design-docs/canvas-sidebar-controls.md` | 画布外层控件迁出画布并以 VSCode 极简侧栏承载的候选路线与取舍 | VSCode 集成域、画布交互域、项目状态域 / 宿主集成层、画布呈现层、共享模型与编排层 | 已选定 | 已验证 | `docs/product-specs/canvas-core-collaboration-mvp.md`、`docs/product-specs/canvas-sidebar-controls.md`、`docs/exec-plans/completed/canvas-sidebar-controls-design.md` | 2026-04-14 |
| `docs/design-docs/canvas-feedback-polish.md` | 画布空状态、辅助面板密度与新增节点摆放规则 | 画布交互域、协作对象域、项目状态域 / 宿主集成层、画布呈现层、共享模型与编排层 | 已选定 | 验证中 | `docs/product-specs/canvas-core-collaboration-mvp.md`、`docs/exec-plans/completed/canvas-feedback-polish.md` | 2026-03-31 |
| `docs/design-docs/note-only-auxiliary-node-and-theme-alignment.md` | 删除 Task、把辅助对象收口为 Note，并把画布与节点表面收口为主题跟随的 VSCode 原生语境 | 画布交互域、协作对象域、项目状态域 / 宿主集成层、画布呈现层、共享模型与编排层 | 已选定 | 已验证 | `docs/product-specs/canvas-core-collaboration-mvp.md`、`docs/exec-plans/completed/remove-task-node-and-align-note-surface.md`、`docs/exec-plans/completed/inline-node-titles-and-note-chrome-alignment.md` | 2026-04-07 |
| `docs/design-docs/canvas-node-surface-and-resize.md` | Task/Note 的窗口化表面收口，以及四类节点通用 resize 与尺寸持久化方案 | 画布交互域、协作对象域、项目状态域 / 宿主集成层、画布呈现层、共享模型与编排层 | 已选定 | 已验证 | `docs/product-specs/canvas-core-collaboration-mvp.md`、`docs/exec-plans/completed/canvas-node-surface-and-resize-polish.md` | 2026-04-07 |
| `docs/design-docs/canvas-surface-placement.md` | 主画布从固定编辑区升级为 `editor/panel` 可配置宿主承载面的产品语义、宿主边界与单主 surface 取舍 | VSCode 集成域、画布交互域、项目状态域 / 宿主集成层、画布呈现层、共享模型与编排层 | 已选定 | 已验证 | `docs/product-specs/canvas-core-collaboration-mvp.md`、`docs/exec-plans/completed/canvas-surface-configurable-host.md` | 2026-04-05 |
| `docs/design-docs/agent-session-surface.md` | Agent 节点的正确产品语义、交互面位置与最小会话窗口边界 | 画布交互域、协作对象域、执行编排域 / 画布呈现层、共享模型与编排层、适配与基础设施层 | 已选定 | 已验证 | `docs/product-specs/canvas-core-collaboration-mvp.md`、`docs/exec-plans/completed/agent-session-surface-alignment.md`、`docs/exec-plans/completed/agent-special-terminal.md` | 2026-04-13 |
| `docs/design-docs/agent-runtime-prototype.md` | Agent 节点最小真实 backend 的候选路线、取舍与原型边界（已被新的生命周期与恢复设计取代） | VSCode 集成域、协作对象域、执行编排域 / 宿主集成层、画布呈现层、共享模型与编排层、适配与基础设施层 | 已废弃 | 验证中 | `docs/product-specs/canvas-core-collaboration-mvp.md`、`docs/exec-plans/completed/agent-runtime-prototype.md`、`docs/exec-plans/completed/agent-special-terminal.md`、`docs/exec-plans/completed/execution-session-platform-compatibility.md`、`docs/design-docs/execution-lifecycle-and-recovery.md` | 2026-04-08 |
| `docs/design-docs/canvas-node-deletion.md` | 四类画布节点的删除入口、执行会话清理语义与删除后恢复边界 | 画布交互域、协作对象域、执行编排域、项目状态域 / 宿主集成层、画布呈现层、共享模型与编排层 | 已选定 | 验证中 | `docs/product-specs/canvas-core-collaboration-mvp.md`、`docs/exec-plans/completed/canvas-node-deletion.md` | 2026-03-30 |
| `docs/design-docs/embedded-terminal-runtime-window.md` | Terminal 节点从宿主代理卡片升级为嵌入式终端会话窗口的产品语义、宿主后端路线、恢复边界与高频输出下的输入优先级 | VSCode 集成域、画布交互域、协作对象域、执行编排域 / 宿主集成层、画布呈现层、共享模型与编排层 | 已选定 | 验证中 | `docs/product-specs/canvas-core-collaboration-mvp.md`、`docs/exec-plans/completed/embedded-terminal-runtime-window.md`、`docs/exec-plans/completed/execution-session-platform-compatibility.md`、`docs/exec-plans/active/runtime-terminal-state-restore.md`、`docs/exec-plans/completed/terminal-output-flood-input-responsiveness.md` | 2026-04-16 |
| `docs/design-docs/execution-session-platform-compatibility.md` | 执行会话后端从 Linux 原型收口到 Linux/macOS 优先、Windows 尽量兼容的统一 PTY 路线，并补宿主侧 CLI 命令发现策略 | VSCode 集成域、执行编排域、协作对象域 / 宿主集成层、共享模型与编排层、适配与基础设施层 | 已选定 | 验证中 | `docs/product-specs/canvas-core-collaboration-mvp.md`、`docs/exec-plans/completed/execution-session-platform-compatibility.md` | 2026-04-12 |
| `docs/design-docs/task-note-editable-nodes.md` | Task 与 Note 从占位卡片升级为可编辑真实节点的字段与状态分层设计 | 画布交互域、协作对象域、项目状态域 / 画布呈现层、共享模型与编排层 | 已选定 | 已验证 | `docs/product-specs/canvas-core-collaboration-mvp.md`、`docs/exec-plans/completed/task-note-editable-nodes.md` | 2026-03-28 |
| `docs/design-docs/vscode-canvas-runtime-architecture.md` | VSCode 内无限画布的运行时边界、技术路线与初步选型 | VSCode 集成域、画布交互域、协作对象域、执行编排域、项目状态域 / 宿主集成层、画布呈现层、共享模型与编排层、适配与基础设施层 | 比较中 | 验证中 | `docs/exec-plans/completed/canvas-architecture-research.md`、`docs/exec-plans/completed/agent-session-surface-alignment.md`、`docs/exec-plans/completed/agent-special-terminal.md`、`docs/exec-plans/completed/execution-session-platform-compatibility.md`、`docs/exec-plans/completed/canvas-surface-configurable-host.md` | 2026-04-05 |

## 维护约定

- 这里只登记具体设计方案文档，不登记模板或通用原则文档。
- 新增设计文档后，应先填写 frontmatter，再同步更新本注册表。
- 如果注册表与具体设计文档状态不一致，以具体设计文档 frontmatter 为准。
