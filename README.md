# DevSessionCanvas

一个 VS Code 插件项目，定位是面向 VSCode 的多 Agent 协作画布。它通过一张画布为 `Agent` 与 `Terminal` 提供全局视角，并与 VSCode 现有插件生态配合，提升 AI 开发时代的开发体验。

## 当前范围

- 提供 `Agent` / `Terminal` 的全局可见主视图
- 宿主为 VSCode
- 与 VSCode 现有插件生态协同
- 不复刻独立 app 的 workspace 管理能力

## 当前状态

项目已完成第一轮研究、设计与 MVP 验证，当前进入正式开发与内部 Preview 持续迭代阶段。

下一阶段重点：

- 在当前主画布与对象模型基线上继续补齐真实主路径、恢复能力与质量收口
- 持续迭代画布交互、对象体验与平台兼容性
- 继续验证并收口 Remote / Restricted Mode / 恢复链路

当前已落地的内容：

- 顶层架构与技术路线研究文档
- 以 MVP 范围为基线的正式产品规格
- 一个可构建并可持续迭代的 VSCode 扩展基线，包含：
  - `devSessionCanvas.openCanvas` / `devSessionCanvas.openCanvasInEditor` / `devSessionCanvas.openCanvasInPanel` 命令
  - `editor/panel` 可配置主画布承载面
  - `WebviewPanel` 主画布入口
  - typed message bridge
  - `WebviewPanelSerializer`
  - 最小宿主状态投影与 Webview 本地 UI 状态
  - React Flow 画布实现基线
- `Agent` 与 `Terminal` 的主画布运行基线
- 基于 `codex` / `claude` CLI 的最小 Agent 真实运行链路
- `Note` 作为当前轻量辅助协作对象的实现
- 跟随 VSCode 主题的极简协作画布基线，而不是固定深色画布

当前命名约定：

- 正式产品名：`DevSessionCanvas`
- VS Code 扩展显示名：`Dev Session Canvas`
- 命令 ID、配置命名空间、持久化键与 view/container ID 已统一到 `devSessionCanvas.*` 及对应新扩展身份。
- 当前不再保留旧命名空间命令、旧配置键、旧状态键或旧视图 ID 的兼容读取。
- 当前扩展 `publisher` 已切换为 `devsessioncanvas`。
- 这次切换不是对旧 `opencove` 预览包的原地升级；内部体验用户需要按一次性断点迁移处理。

## 发布准备状态

当前仓库已经进入“内部体验版分发准备”阶段，但还不应被包装成稳定正式版。

当前明确结论：

- 当前阶段只支持内部体验版分发，首发形态以内部 `Preview` VSIX 为准。
- 当前支持 `Restricted Mode` 的有限能力声明；`Agent` / `Terminal` 等执行型入口在未信任 workspace 下会被禁用。
- 当前不支持 `Virtual Workspace`；例如 `vscode.dev`、GitHub Repositories 一类纯虚拟文件系统窗口不在当前发布范围内。
- 当前不以公开 `Marketplace` 发布为目标，因此开发者账号、`publisher` 身份和 PAT 不是当前阶段阻塞项。
- 在明确公开分发策略前，不应把当前版本包装成面对外部用户的正式公开发布。

具体清单见 `docs/publish-readiness.md`。

## 内部体验版分发

当前阶段推荐的内部体验版交付方式是 `.vsix`。

如果你在本机打包：

```bash
npm run package:vsix
```

注意：

- 仓库已把 VSIX 打包逻辑收口到 `scripts/package-vsix.mjs`，不要求额外全局安装 `vsce`。
- 在干净 checkout 中，先执行一次 `npm install`，再执行 `npm run package:vsix`。

生成 `.vsix` 后，可通过以下任一方式安装：

1. 在 VS Code 命令面板执行 `Extensions: Install from VSIX...`
2. 或在终端执行：

```bash
code --install-extension <your-vsix-file>
```

注意：

- 如果本机此前安装的是旧 `opencove` 预览包，本轮必须先卸载旧扩展，再安装当前 `devsessioncanvas.dev-session-canvas` VSIX；这不是原地覆盖升级。
- 旧扩展下的命令入口、Activity Bar 入口、视图布局和 workspaceState 不会自动迁移到当前扩展身份。
- 如果已经安装的是当前 `devsessioncanvas.dev-session-canvas` 包，同版本重复安装时，如遇到覆盖提示，再按普通覆盖升级处理。

## 开发与贡献

开发环境准备、本地调试、主路径验证和提交收口约定，统一见 [CONTRIBUTING.md](CONTRIBUTING.md)。

如果你要继续推进开发，建议先从 `docs/WORKFLOW.md`、`ARCHITECTURE.md` 和 `docs/PRODUCT_SENSE.md` 开始。

## 背景与动机

本项目最初的直接灵感来自 [OpenCove](https://github.com/DeadWaveWave/opencove)。它“在一张画布中管理多个开发会话”的方式很有启发性，因为这类方式对应的是一个很实际的问题：当同时开启多个终端后，开发者往往需要在不同终端之间频繁切换，才能知道每个会话当前在做什么、已经推进到了哪里。

之所以启动这个项目，是因为日常开发主要在 VS Code 中完成，希望把这种面向多开发会话的全局视角带到熟悉的编辑器工作流中。当时在 VS Code 插件生态里没有找到足够接近的现成项目，因此决定以扩展的形式自行实现。

这个项目的目标不是在 VS Code 中复刻 OpenCove 的全部功能或完整产品体验，而是吸收它带来的产品启发，并围绕 VS Code 的开发场景做收敛：优先解决 `Agent` / `Terminal` 的全局可见性与管理问题，并与现有插件生态配合，补足 AI 开发时代的开发体验。
