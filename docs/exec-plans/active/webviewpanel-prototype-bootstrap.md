# 建立 WebviewPanel 原型骨架

本 ExecPlan 是活文档。推进过程中必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘`。

## 目标与全局图景

为 OpenCove Extension 建立第一版可运行的 VSCode 扩展原型骨架，用于验证以下最小链路：

- 命令可以打开一个主画布 `WebviewPanel`
- Webview 与 Extension Host 之间存在 typed message bridge
- `WebviewPanel` 在 reload 或重开窗口后可以通过 serializer 恢复
- 宿主侧可以维护一份最小权威状态，并把它投影到 Webview

本阶段不追求完整画布、终端和 Agent 体验，只追求“运行时边界是否能被代码闭合”。

## 进度

- [x] 根据产品规格与设计文档确定本轮原型只验证 `WebviewPanel + message bridge + serializer`。
- [x] 建立实现计划与最小工程骨架。
- [x] 实现 Extension Host 侧命令、面板管理与 serializer。
- [x] 实现 typed message bridge 与最小共享协议。
- [x] 实现可显示和更新最小状态的 Webview 前端。
- [x] 运行构建或静态检查，验证原型能被打包。
- [x] 完成结果与复盘，并提交本轮实现改动。

## 意外与发现

- 观察：仓库当前仍没有任何扩展实现骨架。
  证据：当前仓库不存在 `package.json`、`src/`、`tsconfig.json` 等实现文件。

- 观察：当前本地命令行环境的 `node` 版本是 `v12.22.9`，低于部分默认现代工具链的最低要求。
  证据：执行 `node -v` 得到 `v12.22.9`；首次 `npm run typecheck` 因 TypeScript 5.x 运行时语法不兼容而失败。

## 决策记录

- 决策：本轮原型不直接引入 React Flow。
  理由：当前用户要求的第 2 步是先验证 `WebviewPanel + typed message bridge + panel serializer`。如果一开始同时引入画布引擎，会把“宿主边界验证”和“交互框架验证”混成一个风险包。
  日期/作者：2026-03-28 / Codex

- 决策：优先建立可构建的最小 VSCode 扩展骨架，而不是写零散 demo 文件。
  理由：用户要求这一步完成后单独提交；提交物应能作为后续原型与正式实现的基础，而不是一次性草稿。
  日期/作者：2026-03-28 / Codex

- 决策：构建工具链优先兼容当前本地 `node 12` 环境，而不是强依赖更新版本的 TypeScript / esbuild。
  理由：当前任务的验收首先要求原型可构建与可验证。如果工具链本身无法在仓库当前环境里运行，原型就不能形成可交付基础。
  日期/作者：2026-03-28 / Codex

## 上下文与定向

相关文档：

- 产品规格：`docs/product-specs/canvas-core-collaboration-mvp.md`
- 顶层架构：`ARCHITECTURE.md`
- 具体设计：`docs/design-docs/vscode-canvas-runtime-architecture.md`

本轮原型要验证的是“宿主集成层 + 共享模型与编排层 + 画布呈现层”之间的最小链路，而不是画布交互细节本身。

## 工作计划

1. 建立 VSCode 扩展最小工程，包括 `package.json`、TypeScript 配置和构建脚本。
2. 增加 Extension Host 入口、命令注册、面板管理和 serializer。
3. 定义 Host/Webview 共享消息协议和最小画布状态模型。
4. 实现一个最小 Webview 前端，用于展示状态并发送一个示例动作。
5. 运行构建验证，并记录下一阶段需要继续打通的能力。

## 具体步骤

1. 创建最小扩展工程结构。
2. 实现 `opencove.openCanvas` 命令。
3. 实现 `CanvasPanelManager` 与 `WebviewPanelSerializer`。
4. 实现 `postMessage` / `onDidReceiveMessage` 的 typed message bridge。
5. 在 Webview 中展示最小状态，并支持一个触发宿主更新的交互。
6. 运行构建与静态检查。

## 验证与验收

本轮至少满足以下条件才算完成：

- 工程可以成功构建。
- 宿主命令可以打开主画布 `WebviewPanel`。
- Webview 能收到宿主初始状态。
- Webview 发出的示例消息能被宿主接收并触发状态更新。
- 面板在 serializer 路径下具备恢复入口。
- 最终说明中明确哪些能力仍是下一阶段待实现项。

## 幂等性与恢复

- 工程骨架创建和构建步骤可重复执行。
- 如果后续更换前端框架，保留共享协议、面板管理和 serializer 这条主线，不回退到无结构的 demo。
- 如果构建方案不合适，应在 `决策记录` 中说明替换原因，再调整脚手架。

## 结果与复盘

本轮已完成以下结果：

- 建立了最小 VSCode 扩展工程骨架，包括 `package.json`、TypeScript 配置、构建脚本与 `.vscode` 启动配置
- 实现了 `opencove.openCanvas` 命令与 `CanvasPanelManager`
- 实现了 `WebviewPanel` 主入口与 `WebviewPanelSerializer`
- 实现了 Host / Webview 共享协议与 typed message bridge
- 实现了一个最小 Webview 前端，可展示宿主状态、发送创建节点消息，并在 Webview 本地保存选中态
- 完成了 `npm run build` 与 `npm run typecheck` 验证

当前原型已验证成立的链路：

- 命令打开主画布
- Webview 收到宿主初始状态
- Webview 发送消息触发宿主更新
- 面板具备 serializer 恢复入口

本轮已完成的自动化或命令行验证：

- `npm run build`
- `npm run typecheck`

本轮已完成的手动验证：

- 在 `Extension Development Host` 中成功打开 `OpenCove Canvas`
- Webview 能正常显示宿主初始状态
- 原型按钮可触发宿主更新并回传到 Webview
- 面板交互未出现明显异常

本轮仍待继续补齐的验证：

- 需要把 `Reload Window`、面板关闭后重新打开、Remote / Restricted Mode 等专项验证补成显式清单

本轮未覆盖的能力：

- 真实无限画布引擎与节点布局
- 真实终端会话映射与跳转
- 真实 Agent backend
- Remote / Restricted Mode 的手动交互验证

下一阶段建议：

1. 用 React Flow 或下一轮确认的画布引擎替换当前占位前端
2. 先打通终端代理节点，再打通最小 Agent backend
3. 增加状态恢复、Remote 和 Restricted Mode 的手动验证清单
