---
title: Marketplace README 素材自动化
decision_status: 已选定
validation_status: 已验证
domains:
  - VSCode 集成域
  - 画布交互域
  - 项目状态域
architecture_layers:
  - 宿主集成层
  - 画布呈现层
  - 适配与基础设施层
related_specs: []
related_plans:
  - docs/exec-plans/completed/marketplace-real-vscode-media-automation.md
updated_at: 2026-04-16
---

# Marketplace README 素材自动化

## 1. 背景

仓库已经单独维护 `README.marketplace.md`，并通过打包脚本把它作为 Marketplace 页面展示的 README。当前素材边界已经收口为：Marketplace README 使用一张主截图和一段短 `MP4`，仓库 `README.md` / `README.en.md` 保留短 `GIF`，帮助用户快速理解“在 VS Code 里用一张画布并行管理多个开发会话”这件事。

本轮一开始尝试过基于现有 Webview harness 自动导出素材。那条路线可以稳定加载真实 `dist/webview.js`，也便于脚本化生成 GIF；但在人工对比里，harness 画面与真实 VS Code 宿主容器仍然存在明显观感差异。

## 2. 问题定义

需要解决的问题不是“临时录一段演示视频”，而是“如何在仓库中留下一个可重复执行、可追溯、不会依赖人工录屏的 Marketplace 素材生成流程”，同时满足以下要求：

- 最终 `PNG`、`MP4` 和仓库 README 使用的 `GIF` 都必须来自真实 VS Code 宿主窗口，而不是普通浏览器容器。
- 素材内容仍要稳定可重跑，不能依赖一次性的真实 CLI 输出或人工鼠标轨迹。
- README 引用路径、VSIX 打包边界与导出脚本入口都要保持简单明确。

## 3. 目标

- 为 `README.marketplace.md` 提供一张真实 VS Code 宿主里的主截图和一段短 `MP4`。
- 为仓库 `README.md` / `README.en.md` 保留同一段录屏导出的短 `GIF`。
- 让素材生成成为仓库内可重复执行的脚本，而不是手工录屏。
- 让 README 继续通过仓库内稳定路径引用这些资产。
- 在动态素材里展示真实 `Codex` / `Claude Code` / shell 会话，而不是 fake provider。

## 4. 非目标

- 本轮不做人工桌面录屏。
- 本轮不引入面向正式产品的媒体专用行为，也不为录制新增 `src/` 侧专用逻辑。
- 本轮不把素材导出接入 CI gate，也不扩展为长视频、多分辨率运营资产流水线。

## 5. 候选方案

### 5.1 手工录制真实 VS Code 桌面

优点是“真实性”最直观，但缺点同样明显：窗口尺寸、光标位置、系统字体和时序都会漂移，后续 UI 变化后也必须重新录制。这不适合仓库内长期维护的 README 素材链路。

### 5.2 基于 Webview harness 自动生成

优点是最稳定，能够直接复用已有 Playwright harness 和测试消息桥接。但它只是真实 Webview bundle 跑在普通浏览器里，最终产物不是用户真正会看到的 VS Code 宿主窗口。用户已经明确指出观感差异不能接受，因此这条路线不再适合作为最终正式素材来源。

### 5.3 基于真实 VS Code smoke 场景自动录制

这是本轮最终选定方案。脚本通过 `@vscode/test-electron` 启动真实 VS Code `Extension Development Host`，按默认 surface 打开画布，在同一次真实会话里先展示仅含 Note 的正常尺寸开场，再由 `scripts/` / `tests/` 中的录制编排配合原生 X11 鼠标键盘事件，依次右键创建并启动真实 `Codex` / `Claude Code` / shell，会在录制里显式展示上下文菜单、后续阶段的 `fit view`、重命名，以及双击节点标题栏触发的聚焦缩放，最后从同一段真实录屏里导出 Marketplace 用 `PNG` / `MP4` 与仓库 README 用 `GIF`。

## 6. 风险与取舍

- 真实宿主导出比 harness 更重，依赖 `Xvfb`、`xwininfo`、`ffmpeg` 和 VS Code stable 下载缓存。
- 真实 provider 比 fake fixture 更接近用户现场，但时序和可用性也更不稳定；特别是 `Claude Code` 启动会依赖认证与联网。
- 为了让真实 CLI 在隔离 smoke runtime 里复用用户已有登录态，脚本需要把 `~/.codex/auth.json`、`~/.codex/config.toml`、`~/.claude.json` 等最小认证配置复制进每帧的临时 home。
- 真实窗口抓图在 Linux/X11 环境下最容易自动化；如果未来要做跨平台素材导出，还需要补充平台适配。

## 7. 当前结论

本轮确定如下方案：

- 正式 README 素材使用真实 VS Code 宿主窗口自动导出，不再使用 harness 作为最终来源。
- 统一入口仍为 `npm run generate:marketplace-media`。
- 同一段真实录屏统一导出三份资产：`README.marketplace.md` 使用 `images/marketplace/canvas-overview.png` 与 `images/marketplace/canvas-overview.mp4`，仓库 `README.md` / `README.en.md` 使用 `images/marketplace/canvas-overview.gif`。
- 脚本通过真实 VS Code smoke 测试按默认 surface 打开画布，先恢复只有 `note-1` 的初始状态，并在真正开始录屏前用现有画布缩放控件把首屏从 React Flow 默认自动 `fitView` 收回到正常倍率，再在同一段录制里右键创建两个 Agent 和一个 Terminal；布局交给现有避碰算法，视口通过画布内置 `fit view` 控件在中后段按阶段收口。
- 录制脚本里的节点创建和 provider 选择都来自真实画布上下文菜单，不再预摆节点，也不再通过“多次启动 VS Code + 每一帧抓图”伪装成连续流程。
- `Code Worker` 输入任务前，会先双击节点标题栏空白区域，触发已有的节点聚焦与自动缩放能力；输入展示结束后再执行一次 `fit view` 回到完整概览，作为最终静态画面。
- 当前默认配置下，正式截图、`MP4` 与 `GIF` 都应显示 panel route 中的主画布，同时让左侧 activity bar 选中扩展图标，并展开扩展自己的 sidebar 内容。
- 媒体导出使用全新 profile 时，仍按当前产品真实默认语义把 `panel` route 放在底部 Panel；不额外伪装成 Secondary Sidebar。
- 为了让主画布在 README 素材里更清晰，媒体导出会显式把底部 Panel 设为默认位置并在打开时最大化；这是素材拍摄布局，不是产品新增默认行为。
- 媒体编排与原生输入都收口在 `tests/vscode-smoke/` 与 `scripts/`；当前录制方案不需要再修改 `src/`。
- `MP4`、`GIF` 与主截图都来自同一段真实 VS Code 录屏；`PNG` 从录屏尾部的稳定概览帧导出，不再单独重启 VS Code 抓静态图。
- 正式素材继续输出到 `images/marketplace/`，并通过 `.vscodeignore` 排除出 VSIX。
- `scripts/package-vsix.mjs` 在打包 Marketplace README 时，默认把相对资源改写到当前 `HEAD` 对应的最终 git ref；若在不含 `.git` 元数据的目录中打包，必须显式传入 `DEV_SESSION_CANVAS_VSCE_DOC_BRANCH=<final-ref>`，并在打包前校验所有 README 相对媒体路径能在该 ref 上解析成功。
- VS Code stable 下载缓存应落到共享仓库根目录的 `.debug/vscode-test-cache/`，避免 worktree 自身的缓存目录成为脆弱点。
- 真实 provider 场景已经在当前机器上完成验证：`Code Worker` 节点能显示真实 Codex 交互界面和输入的 `写一首打油诗`，Claude 节点与真实 shell 也能在最终 `PNG` / `MP4` / `GIF` 中出现。

## 8. 验证方法

验证分五层：

1. 运行 `npm run build` 与 `npm run typecheck`，确认媒体脚本与 smoke 编排改动没有破坏主线。
2. 运行 `npm run generate:marketplace-media`，确认 `images/marketplace/` 产出 `PNG`、`MP4` 与 `GIF`；若真实 provider 启动失败，检查 `.debug/marketplace-media/artifacts/` 判断是否为认证、网络或终端环境问题。
3. 人工打开生成的 `PNG` / `MP4` / `GIF`，确认画面带有真实 VS Code 宿主外框和编辑区容器，而不是普通浏览器页面。
4. 人工检查动态素材，确认录制过程真实展示了 Note 正常尺寸开场、右键创建节点、中后段的 `fit view`、`Code Worker` 重命名、标题栏双击聚焦和 `写一首打油诗` 输入。
5. 检查 `README.marketplace.md` 继续引用 `PNG` + `MP4`、`README.md` / `README.en.md` 继续引用 `GIF`，并确认打包脚本对 README 相对资源的 final-ref 校验与 `.vscodeignore` 排除规则仍然成立。
