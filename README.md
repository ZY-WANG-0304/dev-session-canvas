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
  - `opencove.openCanvas` / `opencove.openCanvasInEditor` / `opencove.openCanvasInPanel` 命令
  - `editor/panel` 可配置主画布承载面
  - `WebviewPanel` 主画布入口
  - typed message bridge
  - `WebviewPanelSerializer`
  - 最小宿主状态投影与 Webview 本地 UI 状态
  - React Flow 画布实现基线
- `Agent` 与 `Terminal` 的主画布运行基线
- 基于 `codex` / `claude` CLI 的最小 Agent 真实运行链路
- `Task` / `Note` 作为辅助协作对象的当前实现

当前命名约定：

- 正式产品名：`DevSessionCanvas`
- VS Code 扩展显示名：`Dev Session Canvas`
- 当前内部命令 ID、view ID 与配置命名空间暂仍保留 `opencove.*`，以兼容已有状态与脚本。

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

- 仓库已把 `vsce` 作为本地开发依赖纳入，不要求额外全局安装。
- 在干净 checkout 中，先执行一次 `npm install`，再执行 `npm run package:vsix`。

生成 `.vsix` 后，可通过以下任一方式安装：

1. 在 VS Code 命令面板执行 `Extensions: Install from VSIX...`
2. 或在终端执行：

```bash
code --install-extension <your-vsix-file>
```

同版本重复安装时，如遇到覆盖提示，先卸载旧包或显式升级当前体验版。

## 本地运行与调试

### 1. 准备依赖

在仓库根目录执行：

```bash
npm install
npm run build
```

如果要做发布前打包检查，推荐执行：

```bash
npm run package
```

如果只想做静态检查，可以单独运行：

```bash
npm run typecheck
```

如需生成内部体验版 VSIX，直接执行：

```bash
npm run package:vsix
```

如果要验证 `Agent` 节点的真实运行链路，还需要满足：

- `codex` 或 `claude` 至少有一个可从 Extension Host 解析到
- 如果 Extension Host 的 `PATH` 无法直接解析命令，可在 VSCode 设置中配置：
  - `opencove.agent.codexCommand`
  - `opencove.agent.claudeCommand`
- 如果要让主画布默认出现在 VSCode Panel，而不是编辑区，可在设置中配置：
  - `opencove.canvas.defaultSurface = panel`

### 2. 启动扩展开发宿主

`Run Dev Session Canvas` 是仓库自带的 VSCode 调试配置，不是命令面板里的普通命令。

推荐启动方式：

1. 打开 VSCode 的 `Run and Debug` 视图
2. 在顶部调试配置下拉框中选择 `Run Dev Session Canvas`
3. 点击启动按钮，或直接按 `F5`

也可以通过命令面板执行：

1. `Debug: Select and Start Debugging`
2. 选择 `Run Dev Session Canvas`

启动后，VSCode 会打开一个新的 `Extension Development Host` 窗口。后续所有插件交互都在这个新窗口中进行，不是在当前仓库窗口里完成。

### 3. 打开画布

在新的 `Extension Development Host` 窗口中：

1. 打开命令面板
2. 执行以下任一命令：
   - `Dev Session Canvas: 打开画布`
   - `Dev Session Canvas: 在编辑区打开画布`
   - `Dev Session Canvas: 在面板打开画布`

默认情况下，`Dev Session Canvas: 打开画布` 会按 `opencove.canvas.defaultSurface` 的当前设置打开主画布；显式命令可直接覆盖本次打开位置。

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

- `Run Dev Session Canvas` 不是命令面板命令，而是调试配置名称。
- `Dev Session Canvas: 打开画布` 会按默认承载面打开主画布；如需直接落在某个宿主区域，请使用显式的编辑区 / 面板打开命令。
- 如果你只在当前仓库窗口里搜索 `Run Dev Session Canvas`，通常找不到正确入口，因为它应从调试配置启动。
- 当前不是稳定版发布仓库状态；当前阶段默认只做内部体验版 VSIX 分发。
- 正式开发阶段不等于公开稳定发布；当前仍以内部 Preview 迭代为主。

## 对开发者的说明

- 这个 `README.md` 只保留开发者需要的项目级说明。
- 开始继续开发前，先阅读 `ARCHITECTURE.md` 和 `docs/PRODUCT_SENSE.md`，先理解当前项目的产品目标和架构边界。
- 在理解产品和架构后，优先通过 AI 继续推进开发工作，而不是直接脱离现有文档体系单独扩写实现。
- `AGENTS.md` 和 `docs/` 主要用于 Agent 驱动开发时的约束、设计记录和执行计划。

## 相关文档

- `ARCHITECTURE.md`
- `AGENTS.md`
- `docs/PRODUCT_SENSE.md`
- `docs/PLANS.md`
- `docs/publish-readiness.md`
- `docs/product-specs/canvas-core-collaboration-mvp.md`
- `docs/design-docs/vscode-canvas-runtime-architecture.md`
- `CHANGELOG.md`
