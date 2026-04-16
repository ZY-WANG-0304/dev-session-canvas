# DevSessionCanvas

简体中文（默认） | [English](README.en.md)

DevSessionCanvas 是一个面向 VS Code 的多会话协作画布扩展。它通过一张共享画布为 `Agent` 与 `Terminal` 提供全局视角，帮助你在同一个工作区里同时管理多个开发执行会话。

产品已进入公开 `Preview` 阶段，仓库内的发布资产与对外口径已基本收口；当前待执行的是 release-day 发布与发布后复核。面向愿意接受早期限制、并能自行准备本地 CLI 运行环境的高级用户。

![DevSessionCanvas 动态演示](images/marketplace/canvas-overview.gif)

## 适合谁

- 需要在同一个 VS Code 工作区里并行运行多个 `Agent` 或终端会话的开发者
- 希望通过画布获得全局上下文，而非在终端标签之间来回切换的用户
- 愿意使用 `Preview` 版本，并能自行准备 `codex` 或 `claude` CLI 的高级用户

## Preview 提供什么

- 一张默认走 `panel` route、也可切回编辑区的主画布
- `Agent` 与 `Terminal` 节点的最小可运行链路
- `Note` 轻量辅助协作对象
- 基于 React Flow 的基础画布交互与布局
- `Restricted Mode` 下的有限能力声明
- 以 `Visual Studio Marketplace` 为目标的公开 `Preview` 发布链路

## Preview 不提供什么

- 稳定版承诺
- `Virtual Workspace` 支持
- 面向所有用户的零配置开箱体验
- 完整的三平台公开支持矩阵
- 完整的稳定版发布链路

## 运行前提

- VS Code `1.85.0` 或更高版本
- 标准文件系统工作区（本地磁盘或 `Remote SSH` workspace）
- 对应的 CLI 运行环境：
  - `Agent` 节点依赖 `codex` 或 `claude`
  - `Terminal` 节点依赖本机 shell
- 受信任工作区
  - 未信任 workspace 下仍可打开画布，但执行型入口会被禁用

## 项目状态

项目已完成首轮研究、设计与 MVP 验证，处于公开 `Preview` 阶段。当前工作重点是平台兼容性收口、恢复链路验证，以及按 Marketplace `Preview` 口径继续迭代，而不是继续补齐一套新的发布准备方案。对外版本口径维持 `Preview`，不提供稳定正式版承诺。

明确结论：

- 版本定位为 `Preview`，尚未达到稳定正式版。
- 支持 `Restricted Mode` 有限能力声明；`Agent` / `Terminal` 等执行型入口在未信任 workspace 下会被禁用。
- 不支持 `Virtual Workspace`；`vscode.dev`、GitHub Repositories 等纯虚拟文件系统窗口不在发布范围内。
- 公开发布主渠道已收口为 `Visual Studio Marketplace`；是否同步 `Open VSX` 延后决策。
- 仍依赖本地 CLI 和 workspace extension 运行条件，更适合愿意自行准备 `codex` / `claude` CLI 的高级用户。

相关入口：

- 发布执行手册：[`docs/public-preview-release-playbook.md`](docs/public-preview-release-playbook.md)
- 公开支持边界：[`docs/support.md`](docs/support.md)
- 设计结论与发布判断：[`docs/design-docs/public-marketplace-release-readiness.md`](docs/design-docs/public-marketplace-release-readiness.md)

## Preview 分发

对外分发目标是通过 `Visual Studio Marketplace` 发布。`.vsix` 不再作为面向普通用户的公开分发方式，仅保留为构建工件和发布验证输入。

- 公开 `Preview` 用户应通过 Marketplace 安装，而非手动分发 `.vsix`
- 当前仓库内的发布资产已收口；真正上架前仍需按发布手册锁定最终 git ref、执行发布并完成发布后验证
- `Open VSX` 不是本次 `Preview` 的首发路径

## 源码编译与开发安装

开发者推荐通过源码编译与 Development Host 方式安装和调试，而非手动安装 `.vsix`。

最小流程：

```bash
npm install
npm run build
```

然后在仓库窗口中：

1. 打开 `Run and Debug`
2. 选择 `Run Dev Session Canvas`
3. 按 `F5` 启动 `Extension Development Host`

更完整的源码开发、`Remote SSH` 调试和自动化验证说明见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 已知限制

- 仍处于 `Preview`，不应按稳定生产工具看待。
- 不支持 `Virtual Workspace`。
- 公开 `Preview` 的分发主路径已收口到 `Visual Studio Marketplace`，但 release-day 仍需手工执行与复核。
- 验证覆盖主要集中在 `Remote SSH` 路径；Linux、macOS、Windows 本地路径尚未经过严格验证。
- 若本机没有可用的 `codex` 或 `claude` CLI，`Agent` 节点无法提供完整体验。

## 支持矩阵

| 场景 | 状态 | 用户可预期行为 |
| --- | --- | --- |
| `Remote SSH` workspace | `Preview` 主路径 | 验证覆盖最充分；可体验画布、`Agent`、`Terminal` 和恢复等主路径 |
| Linux 本地 workspace | 可尝试，未严格验证 | 具备部分自动化与实现证据，但不作为 Preview 的严格支持承诺 |
| macOS 本地 workspace | 可尝试，未严格验证 | 代码路径已接通，但缺少严格验证证据 |
| Windows 本地 workspace | 可尝试，未严格验证 | 代码路径已接通，但缺少严格验证证据 |
| `Restricted Mode` | 有限支持 | 可打开画布并查看已保存布局；`Agent` / `Terminal` 等执行型入口被禁用 |
| `Virtual Workspace` | 不支持 | 不在 Preview 范围内 |

## 能力边界

- `Agent` 节点：需要本机或远端 Extension Host 可解析的 `codex` 或 `claude` CLI
- `Terminal` 节点：需要工作区侧可用的 shell 环境
- `devSessionCanvas.runtimePersistence.enabled = false`：基线能力，不承诺真实进程跨 VS Code 生命周期持续存在
- `devSessionCanvas.runtimePersistence.enabled = true`：已具备较多自动化与人工验证证据，尤其覆盖 `Remote SSH` real-reopen 主路径；用户可见 guarantee 取决于 backend 与平台组合。Linux 本地与 `Remote SSH` 在 `systemd --user` 可用时优先尝试更强 guarantee，否则自动回退到 `best-effort`

## 反馈与交流

- 提 issue 前的适用范围、所需环境信息和受理边界：[`docs/support.md`](docs/support.md)
- 问题与功能反馈：<https://github.com/ZY-WANG-0304/dev-session-canvas/issues>
- 安全问题：`wzy0304@outlook.com`
- 飞书交流群：

  <img src="images/lark-group-qr.png" alt="Dev Session Canvas 飞书交流群" width="240" />

## 开发与贡献

开发环境准备、本地调试、主路径验证和提交约定，统一见 [CONTRIBUTING.md](CONTRIBUTING.md)。

如需继续推进开发，建议先阅读 `docs/WORKFLOW.md`、`ARCHITECTURE.md` 和 `docs/PRODUCT_SENSE.md`。

## 背景与动机

本项目的直接灵感来自 [OpenCove](https://github.com/DeadWaveWave/opencove)。它"在一张画布中管理多个开发会话"的方式很有启发性——当同时开启多个终端后，开发者往往需要在不同终端之间频繁切换，才能了解每个会话的状态与进度。

启动这个项目，是因为日常开发主要在 VS Code 中完成，希望把面向多开发会话的全局视角带到熟悉的编辑器工作流中。当时在 VS Code 插件生态里没有找到足够接近的现成方案，因此决定以扩展的形式自行实现。

项目目标不是在 VS Code 中复刻 OpenCove 的全部功能，而是吸收其产品启发，围绕 VS Code 场景做收敛：优先解决 `Agent` / `Terminal` 的全局可见性与管理问题，与现有插件生态配合，补足 AI 开发时代的体验。
