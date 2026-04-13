# DevSessionCanvas

DevSessionCanvas 是一个面向 VS Code 的多会话协作画布扩展。它通过一张共享画布为 `Agent` 与 `Terminal` 提供全局视角，帮助你在同一个工作区里同时管理多个开发执行会话。

当前仓库正在准备公开 `Preview` 发布，定位仍是面向愿意接受早期限制、并愿意自行准备本地 CLI 运行环境的高级用户。

## 适合谁

- 需要在同一个 VS Code 工作区里并行运行多个 `Agent` 或终端会话的开发者
- 希望在画布上获得全局上下文，而不是只在终端标签之间来回切换的用户
- 愿意使用 `Preview` 版本，并能自行准备 `codex` 或 `claude` CLI 的高级用户

## 当前 Preview 提供什么

- 一张默认走 `panel` route、也可显式切回编辑区的主画布
- `Agent` 与 `Terminal` 节点的最小真实运行链路
- `Note` 作为轻量辅助协作对象
- 基于 React Flow 的基础画布交互与对象布局
- `Restricted Mode` 下的有限能力声明
- 以 `Visual Studio Marketplace` 为目标的公开 `Preview` 发布链路

## 当前 Preview 不提供什么

- 稳定版承诺
- `Virtual Workspace` 支持
- 面向所有用户的零配置开箱体验
- 已完全收口的三平台公开支持矩阵
- 已完成的稳定版发布链路

## 运行前提

- VS Code `1.85.0` 或更高版本
- 标准文件系统工作区，包括本地磁盘工作区与 `Remote SSH` workspace
- 对应的本地 CLI 运行环境：
  - `Agent` 节点当前依赖 `codex` 或 `claude`
  - `Terminal` 节点当前依赖本机 shell
- 受信任工作区
  - 未信任 workspace 下仍可打开画布，但执行型入口会被禁用

## 当前状态

项目已完成第一轮研究、设计与 MVP 验证，当前进入正式开发与公开 Preview 准备阶段。当前工作重点仍然是发布包治理、平台兼容性收口、恢复链路验证，以及公开发布所需的支持边界整理。

## 发布准备状态

当前仓库已经进入“公开 Preview 分发准备”阶段，但还不应被包装成稳定正式版。

当前明确结论：

- 当前阶段准备以公开 `Preview` 形态发布，但还未到稳定正式版。
- 当前支持 `Restricted Mode` 的有限能力声明；`Agent` / `Terminal` 等执行型入口在未信任 workspace 下会被禁用。
- 当前不支持 `Virtual Workspace`；例如 `vscode.dev`、GitHub Repositories 一类纯虚拟文件系统窗口不在当前发布范围内。
- 当前公开发布主渠道优先以 `Visual Studio Marketplace` 为目标；是否同步 `Open VSX` 延后决策。
- 当前版本仍依赖本地 CLI 和 workspace extension 运行条件，更适合愿意自行准备 `codex` / `claude` CLI 的高级用户预览使用。

具体清单见 `docs/publish-readiness.md`。

## Preview 分发

这次 `Preview` 的对外分发目标是通过 `Visual Studio Marketplace` 发布。当前仓库不再把 `.vsix` 作为普通用户的公开分发方式；`VSIX` 仅保留为构建工件和发布验证输入。

当前明确结论：

- 公开 `Preview` 用户应通过 Marketplace 安装，而不是通过手动分发 `.vsix`
- Marketplace 上架前，仍需继续补齐发布包治理、发布账号和最终发布验证
- `Open VSX` 不是这次 `Preview` 的首发主路径

## 源码编译与开发安装

如果你是开发者，当前推荐通过源码编译与 Development Host 方式安装和调试，而不是手动安装 `.vsix`。

最小流程：

```bash
npm install
npm run build
```

然后在当前仓库窗口中：

1. 打开 `Run and Debug`
2. 选择 `Run Dev Session Canvas`
3. 按 `F5` 启动 `Extension Development Host`

更完整的源码开发、`Remote SSH` 调试和自动化验证说明见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 已知限制

- 当前仍是 `Preview`，不应按稳定生产工具理解。
- 当前不支持 `Virtual Workspace`。
- 当前公开发布链路仍在准备中，但目标分发主路径已经确定为 `Visual Studio Marketplace`。
- 当前较强的验证证据主要集中在 `Remote SSH` 开发路径；Linux、macOS、Windows 本地路径仍未经过严格验证。
- 如果本机没有可用的 `codex` 或 `claude` CLI，`Agent` 节点不会提供完整体验。

## 当前支持矩阵

| 场景 | 当前状态 | 用户可预期行为 |
| --- | --- | --- |
| `Remote SSH` workspace | `Preview` 主路径 | 当前最强验证证据所在路径；可体验画布、`Agent`、`Terminal` 和恢复相关主路径 |
| Linux 本地 workspace | 可尝试，但未严格验证 | 具备部分自动化与实现证据，但当前不作为公开 Preview 的严格支持承诺 |
| macOS 本地 workspace | 可尝试，但未严格验证 | 代码路径已接通，但当前没有严格验证证据 |
| Windows 本地 workspace | 可尝试，但未严格验证 | 代码路径已接通，但当前没有严格验证证据 |
| `Restricted Mode` | 有限支持 | 可打开画布并查看已保存布局；`Agent` / `Terminal` 等执行型入口会被禁用 |
| `Virtual Workspace` | 不支持 | 不在当前公开 Preview 范围内 |

## 当前能力边界

- `Agent` 节点：需要本机或远端 Extension Host 可解析的 `codex` 或 `claude` CLI
- `Terminal` 节点：需要当前工作区侧可用的 shell 环境
- `devSessionCanvas.runtimePersistence.enabled = false`：属于当前基线能力，不承诺真实进程跨 VS Code 生命周期持续存在
- `devSessionCanvas.runtimePersistence.enabled = true`：已具备较多自动化与人工验证证据，尤其覆盖 `Remote SSH` real-reopen 主路径；当前用户可见 guarantee 仍取决于 backend 与平台组合。Linux 本地与 `Remote SSH` 在 `systemd --user` 可用时优先尝试更强 guarantee，否则自动回退到 `best-effort`

## 反馈与安全

- 普通问题与功能反馈：<https://github.com/ZY-WANG-0304/dev-session-canvas/issues>
- 安全问题：`wzy0304@outlook.com`

## 开发与贡献

开发环境准备、本地调试、主路径验证和提交收口约定，统一见 [CONTRIBUTING.md](CONTRIBUTING.md)。

如果你要继续推进开发，建议先从 `docs/WORKFLOW.md`、`ARCHITECTURE.md` 和 `docs/PRODUCT_SENSE.md` 开始。

## 背景与动机

本项目最初的直接灵感来自 [OpenCove](https://github.com/DeadWaveWave/opencove)。它“在一张画布中管理多个开发会话”的方式很有启发性，因为这类方式对应的是一个很实际的问题：当同时开启多个终端后，开发者往往需要在不同终端之间频繁切换，才能知道每个会话当前在做什么、已经推进到了哪里。

之所以启动这个项目，是因为日常开发主要在 VS Code 中完成，希望把这种面向多开发会话的全局视角带到熟悉的编辑器工作流中。当时在 VS Code 插件生态里没有找到足够接近的现成项目，因此决定以扩展的形式自行实现。

这个项目的目标不是在 VS Code 中复刻 OpenCove 的全部功能或完整产品体验，而是吸收它带来的产品启发，并围绕 VS Code 的开发场景做收敛：优先解决 `Agent` / `Terminal` 的全局可见性与管理问题，并与现有插件生态配合，补足 AI 开发时代的开发体验。
