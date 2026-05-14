# DevSessionCanvas

简体中文（默认） | [English](README.en.md)

DevSessionCanvas 是一个面向 VS Code 的多会话协作画布扩展。它通过一张共享画布为 `Agent` 与 `Terminal` 提供全局视角，帮助你在同一个工作区里同时管理多个开发执行会话。

产品已进入公开 `Preview` 阶段，并已完成首个对外版本发布；当前主要工作是围绕后续 `0.10.x` 迭代持续收口能力、发布材料与回归验证。面向愿意接受早期限制、并能自行准备本地 CLI 运行环境的高级用户。

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
- 动态全局概览缩放与可配置低倍率概览，节点分散时仍可通过 fit view 看全完整画布
- 支持 Markdown 语法的 `Note` 节点
- 画布模板能力：内置默认模板、自定义模板保存 / 导入 / 导出、模板侧栏与重置入口
- `Agent` 与嵌入式 `Terminal` 的跨平台 shell 环境继承与可诊断启动路径
- 执行终端复制粘贴快捷键，按本机平台保留复制、粘贴与 `Ctrl+C` 打断语义
- 侧栏与命令面板中的 `Codex` / `Claude Code` CLI 选择和配置文件打开入口
- `Agent` 启动时 CLI 缺失的自动选择 / 安装补救入口
- 桌面通知 companion 的多 section sidebar、平台接入说明与 `Codex` / `Claude Code` 通知配置指引
- `Restricted Mode` 下的有限能力声明
- 以 `Visual Studio Marketplace` 为目标的公开 `Preview` 发布链路
- 侧栏中的 `节点` 与 `会话历史` 列表，可快速定位当前画布节点并从历史恢复新 `Agent` 节点

## Preview 不提供什么

- 稳定版承诺
- `Virtual Workspace` 支持
- 面向所有用户的零配置开箱体验
- 稳定版级别的三平台支持承诺
- 完整的稳定版发布链路

## 运行前提

- VS Code `1.80.0` 或更高版本
- 标准文件系统工作区（本地磁盘或 `Remote SSH` workspace）
- 对应的 CLI 运行环境：
  - `Agent` 节点依赖 `codex` 或 `claude`
  - `Terminal` 节点依赖本机 shell
- 受信任工作区
  - 未信任 workspace 下仍可打开画布，但执行型入口会被禁用

## 项目状态

项目已完成首轮研究、设计与 MVP 验证，处于公开 `Preview` 阶段。当前工作重点是围绕 `0.10.0` 收口 Note 关联 Markdown 文件、冲突恢复、拖拽创建和发布材料，并继续按 Marketplace `Preview` 口径迭代。对外版本口径维持 `Preview`，不提供稳定正式版承诺。

明确结论：

- 版本定位为 `Preview`，尚未达到稳定正式版。
- 支持 `Restricted Mode` 有限能力声明；`Agent` / `Terminal` 等执行型入口在未信任 workspace 下会被禁用。
- 不支持 `Virtual Workspace`；`vscode.dev`、GitHub Repositories 等纯虚拟文件系统窗口不在发布范围内。
- 公开发布主渠道已收口为 `Visual Studio Marketplace`；是否同步 `Open VSX` 延后决策。
- Linux、macOS、Windows 本地工作区以及 `Remote SSH` 主路径已有公开 `Preview` 验证证据；`0.10.0` 的 repo-local 验证重点收口 Note 关联 Markdown 文件、storage-backed 冲突草稿、拖拽创建、路径复制、编辑态行号修正、预览文案和打包材料，但 Windows 下使用 `Codex` 时仍保留“执行节点内历史无法向上翻页”的已知限制。
- 仍依赖本地 CLI 和 workspace extension 运行条件，更适合愿意自行准备 `codex` / `claude` CLI 的高级用户。

相关入口：

- 发布执行手册：[`docs/public-preview-release-playbook.md`](docs/public-preview-release-playbook.md)
- 公开支持边界：[`docs/support.md`](docs/support.md)
- 设计结论与发布判断：[`docs/design-docs/public-marketplace-release-readiness.md`](docs/design-docs/public-marketplace-release-readiness.md)

## Preview 分发

对外分发目标是通过 `Visual Studio Marketplace` 发布。`.vsix` 不再作为面向普通用户的公开分发方式，仅保留为构建工件和发布验证输入。

- 公开 `Preview` 用户应通过 Marketplace 安装，而非手动分发 `.vsix`
- `Visual Studio Marketplace` 已是当前公开安装主路径；后续 `0.10.x` 更新仍需按发布手册锁定最终 git ref、执行发布并完成发布后验证
- `Open VSX` 不是本次 `Preview` 的首发路径

## 桌面通知 companion（自动安装）

安装 `Dev Session Canvas` 时，VS Code 会自动安装 companion 扩展 `Dev Session Canvas Notifier`（`devsessioncanvas.dev-session-canvas-notifier`）。如果你是从 notifier 页面单独安装，VS Code 也会自动补齐主扩展 `Dev Session Canvas`。

- 执行节点的 attention signal 默认会通过 `devSessionCanvas.notifications.attentionSignalBridge = system` 优先桥接到本机桌面；如需改回工作台消息或关闭桥接，可在主扩展设置中调整
- `system` 模式下会优先调用本机 UI 侧 notifier companion；若 companion 缺失、当前平台不支持或投递失败，则自动回退到工作台消息
- 该 companion 尤其适合 `Remote SSH`、WSL、Dev Container 等“主扩展运行在远端，而提醒需要回到本机桌面”的场景
- notifier 自己的发布与复核口径见 [`docs/notifier-preview-release-playbook.md`](docs/notifier-preview-release-playbook.md)

## 源码编译与开发安装

开发者推荐通过源码编译与 Development Host 方式安装和调试，而非手动安装 `.vsix`。

最小流程：

```bash
npm install
npm run build
```

然后在仓库窗口中：

1. 打开 `Run and Debug`
2. 选择 `Run Dev Session Canvas (Main Only)`
3. 按 `F5` 启动 `Extension Development Host`

更完整的源码开发、`Remote SSH` 调试和自动化验证说明见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 已知限制

- 仍处于 `Preview`，不应按稳定生产工具看待。
- 不支持 `Virtual Workspace`。
- 公开 `Preview` 的分发主路径已收口到 `Visual Studio Marketplace`，但 release-day 仍需手工执行与复核。
- `Remote SSH` 主路径已验证可用，且仍是验证最充分的推荐路径；Linux、macOS、Windows 本地主路径也已完成功能可用性验证，但 Windows 下使用 `Codex` 时仍存在执行节点内历史无法向上翻页的已知问题。
- `Note` Markdown 预览不支持原始 HTML 透传、任意 scheme 链接、越出 workspace 的文件链接、目录目标或富文本块编辑。
- 模板当前只保存静态布局与配置，不保存运行中会话、终端输出、文件活动、缩略图、云同步或模板历史。
- 执行终端复制粘贴快捷键第一版不读取用户自定义 keybindings，也不覆盖 Linux selection clipboard、右键 copyPaste 或 HTML 富文本复制。
- 侧栏 `会话历史` 当前只显示可明确归属到当前 workspace 的 `Codex` / `Claude Code` 记录；缺少工作目录信息的旧会话会被保守跳过。
- 若本机没有可用的 `codex` 或 `claude` CLI，`Agent` 节点无法提供完整体验。

## 支持矩阵

| 场景 | 状态 | 用户可预期行为 |
| --- | --- | --- |
| `Remote SSH` workspace | `Preview`，主路径已验证且验证最充分 | 可体验画布、`Agent`、`Terminal` 和恢复等主路径；当前是最推荐环境 |
| Linux 本地 workspace | `Preview`，主路径已验证 | 本地工作区的画布、`Agent` 与 `Terminal` 主路径已有 Preview 功能可用性验证证据 |
| macOS 本地 workspace | `Preview`，主路径已验证 | 本地工作区的画布、`Agent` 与 `Terminal` 主路径已有 Preview 功能可用性验证证据 |
| Windows 本地 workspace | `Preview`，主路径已验证（含已知限制） | 本地工作区的画布、`Agent` 与 `Terminal` 主路径已有 Preview 功能可用性验证证据；使用 `Codex` 时执行节点内历史仍无法向上翻页 |
| `Restricted Mode` | 有限支持 | 可打开画布并查看已保存布局；`Agent` / `Terminal` 等执行型入口被禁用 |
| `Virtual Workspace` | 不支持 | 不在 Preview 范围内 |

## 能力边界

- `Agent` 节点：需要本机或远端 Extension Host 可解析的 `codex` 或 `claude` CLI
- `Terminal` 节点：需要工作区侧可用的 shell 环境；macOS / Linux 默认继承受控 shell env patch，Windows 让真实 shell 自己执行 profile / AutoRun，可通过 `devSessionCanvas.terminal.inheritEnv` 与 `devSessionCanvas.terminal.shellArgs` 调整
- `Note` 节点：普通 Note 的正文权威数据仍为画布内原始 Markdown 文本；关联 Markdown Note 以 `.md` / `.markdown` 磁盘文件为权威来源，预览态只允许安全白名单链接与当前 workspace 内文件目标
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
