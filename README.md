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
  - React Flow 画布原型
  - 原生终端代理节点
  - 基于 `codex` / `claude` CLI 的最小 Agent 运行原型

## 本地运行与调试

### 1. 准备依赖

在仓库根目录执行：

```bash
npm install
npm run build
```

如果只想做静态检查，可以额外运行：

```bash
npm run typecheck
```

如果要验证 `Agent` 节点的真实运行链路，还需要满足：

- `codex` 或 `claude` 至少有一个可从 Extension Host 解析到
- 如果 Extension Host 的 `PATH` 无法直接解析命令，可在 VSCode 设置中配置：
  - `opencove.agent.codexCommand`
  - `opencove.agent.claudeCommand`

### 2. 启动扩展开发宿主

`Run OpenCove Extension` 是仓库自带的 VSCode 调试配置，不是命令面板里的普通命令。

推荐启动方式：

1. 打开 VSCode 的 `Run and Debug` 视图
2. 在顶部调试配置下拉框中选择 `Run OpenCove Extension`
3. 点击启动按钮，或直接按 `F5`

也可以通过命令面板执行：

1. `Debug: Select and Start Debugging`
2. 选择 `Run OpenCove Extension`

启动后，VSCode 会打开一个新的 `Extension Development Host` 窗口。后续所有插件交互都在这个新窗口中进行，不是在当前仓库窗口里完成。

### 3. 打开画布

在新的 `Extension Development Host` 窗口中：

1. 打开命令面板
2. 执行命令 `OpenCove: 打开画布`

这条命令会打开当前原型里的主画布 `WebviewPanel`。

### 4. 验证当前主路径

在新的 `Extension Development Host` 窗口中，当前建议至少验证以下两条链路：

1. `Terminal` 节点：
   - 创建一个 `Terminal` 节点
   - 点击“创建并显示终端”
   - 关闭真实终端后，确认节点状态回流为关闭态
   - 重新打开画布后，点击“尝试连接现有终端”不会错误新建终端

2. `Agent` 节点：
   - 创建一个 `Agent` 节点
   - 选择 `Codex` 或 `Claude Code`
   - 输入简短目标并点击“运行 Agent”
   - 观察节点进入运行态，并在完成后回流结果摘要
   - 如需验证中断链路，可在运行中点击“停止 Agent”

### 5. 常见误区

- `Run OpenCove Extension` 不是命令面板命令，而是调试配置名称。
- `OpenCove: 打开画布` 才是插件注册到命令面板里的命令。
- 如果你只在当前仓库窗口里搜索 `Run OpenCove Extension`，通常找不到正确入口，因为它应从调试配置启动。

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
