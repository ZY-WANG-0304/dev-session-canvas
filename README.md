# OpenCove Extension

一个 VSCode 插件项目，目标是在 VSCode 内复刻 OpenCove 的核心产品体验：把 AI Agents、终端、任务和笔记放到同一张无限 2D 画布上，让多 Agent 协作时的全局状态保持可见。

## 当前范围

- 复刻核心协作体验
- 宿主为 VSCode
- 不复刻独立 app 的 workspace 管理能力

## 当前状态

项目已完成第一轮研究与设计收口，并具备最小可构建的 VSCode 扩展原型骨架。

下一阶段重点：

- 在当前 `WebviewPanel` 原型上继续打通真实对象模型与终端主路径
- 引入下一阶段画布实现与交互原型
- 继续验证 Remote / Restricted Mode / 恢复链路

当前已落地的内容：

- 顶层架构与技术路线研究文档
- 第一份 MVP 产品规格
- 一个可构建的 VSCode 扩展原型，包含：
  - `opencove.openCanvas` 命令
  - `WebviewPanel` 主画布入口
  - typed message bridge
  - `WebviewPanelSerializer`
  - 最小宿主状态投影与 Webview 本地 UI 状态

## 本地运行

1. 运行 `npm install`
2. 运行 `npm run build`
3. 在 VSCode 中使用仓库自带的 `Run OpenCove Extension` 启动配置启动扩展开发宿主
4. 在扩展开发宿主中执行命令 `OpenCove: 打开画布`

## 对开发者的说明

- 这个 `README.md` 只保留开发者需要的项目级说明。
- 开始继续开发前，先阅读 [ARCHITECTURE.md](./ARCHITECTURE.md) 和 [docs/PRODUCT_SENSE.md](./docs/PRODUCT_SENSE.md)，先理解当前项目的产品目标和架构边界。
- 在理解产品和架构后，优先通过 AI 继续推进开发工作，而不是直接脱离现有文档体系单独扩写实现。
- `AGENTS.md` 和 `docs/` 主要用于 Agent 驱动开发时的约束、设计记录和执行计划。

## 相关文档

- [ARCHITECTURE.md](./ARCHITECTURE.md)
- [AGENTS.md](./AGENTS.md)
- [docs/PRODUCT_SENSE.md](./docs/PRODUCT_SENSE.md)
- [docs/PLANS.md](./docs/PLANS.md)
- [docs/product-specs/canvas-core-collaboration-mvp.md](./docs/product-specs/canvas-core-collaboration-mvp.md)
- [docs/design-docs/vscode-canvas-runtime-architecture.md](./docs/design-docs/vscode-canvas-runtime-architecture.md)
