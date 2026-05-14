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
  - docs/exec-plans/completed/marketplace-gif-keyframe-storyboard.md
  - docs/exec-plans/completed/marketplace-real-vscode-media-automation.md
updated_at: 2026-05-11
---

# Marketplace README 素材自动化

## 1. 背景

仓库已经单独维护 `README.marketplace.md`，并通过打包脚本把它作为 Marketplace 页面展示的 README。当前素材边界已经收口为：Marketplace README 使用一张主截图和一段短 `MP4`，仓库 `README.md` / `README.zh-CN.md` 保留短 `GIF`，帮助用户快速理解”在 VS Code 里用一张画布并行管理多个开发会话”这件事。

本轮一开始尝试过基于现有 Webview harness 自动导出素材。那条路线可以稳定加载真实 `dist/webview.js`，也便于脚本化生成 GIF；但在人工对比里，harness 画面与真实 VS Code 宿主容器仍然存在明显观感差异。

## 2. 问题定义

需要解决的问题不是“临时录一段演示视频”，而是“如何在仓库中留下一个可重复执行、可追溯、不会依赖人工录屏的 Marketplace 素材生成流程”，同时满足以下要求：

- 最终 `PNG`、`MP4` 和仓库 README 使用的 `GIF` 都必须来自真实 VS Code 宿主窗口，而不是普通浏览器容器。
- 素材内容仍要稳定可重跑，不能依赖一次性的真实 CLI 输出或人工鼠标轨迹。
- README 引用路径、VSIX 打包边界与导出脚本入口都要保持简单明确。
- 上一轮 `GIF` 方案曾采用“完整 `MP4` 成片结束后再统一抽帧压出”的后处理方式；它生成速度偏慢，而且均匀抽帧会稀释真正想强调的动作阶段，导致 `GIF` 不够聚焦。

## 3. 目标

- 为 `README.marketplace.md` 提供一张真实 VS Code 宿主里的主截图和一段短 `MP4`。
- 为仓库 `README.md` / `README.zh-CN.md` 保留来自同一次真实录制会话、但按关键动作单独采集并拼装的短 `GIF`。
- 让素材生成成为仓库内可重复执行的脚本，而不是手工录屏。
- 让 README 继续通过仓库内稳定路径引用这些资产。
- 在动态素材里展示真实 VS Code 宿主、真实画布 UI 和真实 shell / 文件活动链路；Claude provider 输出允许使用录制专用 deterministic wrapper，避免 README 素材受登录态、联网和模型输出漂移影响。
- 在 `0.2.0` 版本素材里显式覆盖新的主路径能力，而不继续停留在 `0.1.2` 的旧场景。

## 4. 非目标

- 本轮不做人工桌面录屏。
- 本轮不引入面向正式产品的媒体专用行为，也不为录制新增 `src/` 侧专用逻辑。
- 本轮不把素材导出接入 CI gate，也不扩展为长视频、多分辨率运营资产流水线。

## 5. 候选方案

### 5.1 手工录制真实 VS Code 桌面

优点是“真实性”最直观，但缺点同样明显：窗口尺寸、光标位置、系统字体和时序都会漂移，后续 UI 变化后也必须重新录制。这不适合仓库内长期维护的 README 素材链路。

### 5.2 基于 Webview harness 自动生成

优点是最稳定，能够直接复用已有 Playwright harness 和测试消息桥接。但它只是真实 Webview bundle 跑在普通浏览器里，最终产物不是用户真正会看到的 VS Code 宿主窗口。用户已经明确指出观感差异不能接受，因此这条路线不再适合作为最终正式素材来源。

### 5.3 基于真实 VS Code smoke 场景自动录制，再从完整 MP4 后处理 GIF

这条路线已经解决“素材必须来自真实 VS Code 宿主”的问题，但它把 `GIF` 的时间轴完全交给完整 `MP4` 成片。结果是：完整录屏中的等待、切换和收尾也会进入 `GIF` 的抽帧池，用户真正想强调的右键创建、重命名、关系连线和文件节点出现等关键动作反而会被稀释。

### 5.4 基于真实 VS Code smoke 场景自动录制，并在录制期并行采集 GIF 关键片段

这条路线比“完整 `MP4` 后处理 GIF”更进一步，因为它已经把 GIF 从完整成片时间轴里解耦出来；但如果 GIF 仍然以短视频 clip 的形式保留每个阶段，就还会带入等待 provider 响应、焦点切换和布局稳定的过程。用户明确要求的并不是“更短的视频”，而是“关键操作前后各一张说明性截图”。

### 5.5 基于真实 VS Code Extension Development Host 动态录制，并在录制期抓取 GIF 关键帧

这是当前最终选定方案。脚本启动非测试模式的真实 VS Code `Extension Development Host`（只使用 `--extensionDevelopmentPath`，不使用 `--extensionTestsPath`），按默认 surface 打开画布，在同一次真实会话里先展示仅含 Note 的正常尺寸开场，再由 `scripts/recording-session.mjs` 配合原生 X11 鼠标键盘事件，依次完成模板重置、右键菜单、Quick Input、modal 确认、节点创建、重命名、关系连线和文件节点出现等真实 UI 过程。除录制开始前的场景初始化外，录制片段内不通过测试消息、命令直调或 Webview state mutation 伪装用户操作；为了让素材可重复，Claude CLI 进程默认由录制专用 deterministic wrapper 提供稳定输出。

与旧方案不同的是：完整 `MP4` 仍然保留，但 `GIF` 不再由视频 clip 组成，而是在同一次真实录制过程中只抓取关键操作前后的静态截图，再在录制结束后按既定顺序和停留时长拼成最终 `GIF`。这样既能保留真实宿主的一致性，也能把中间等待时间完全排除在 GIF 之外。

## 6. 风险与取舍

- 真实宿主导出比 harness 更重，依赖 `Xvfb`、`xwininfo`、`ffmpeg` 和 VS Code stable 下载缓存。
- 真实 provider 比 deterministic wrapper 更接近用户现场，但时序、认证、联网和模型输出都更不稳定；本轮正式素材优先保证 UI 流程、文件活动链路和媒体资产可重复。
- Claude provider 的 deterministic wrapper 是录制边界，不是产品行为；后续若要切回真实 provider，需要补回隔离 runtime 中的最小认证配置透传，并重新生成素材。
- 真实窗口抓图在 Linux/X11 环境下最容易自动化；如果未来要做跨平台素材导出，还需要补充平台适配。
- 录制期并行采集 `GIF` 会多一条 `ffmpeg` 关键帧抓取链路，但它只在 checkpoint 时刻抓单帧截图；相比录 clip，更贴近“说明性 GIF”的诉求，也能彻底去掉等待过程。

## 7. 正式方案

### 7.1 适用范围与边界

- 正式 README 素材使用真实 VS Code 宿主窗口自动导出，不再使用 harness 作为最终来源。
- 动态录制入口以 `docs/skills/recording-marketplace-media/SKILL.md` 为准：先运行 `node scripts/recording-session.mjs start`，再按剧本用 `record-start` / `click` / `key` / `paste` / `gif-frame` / `record-stop` / `stop` 分段录制；历史兼容入口 `npm run generate:marketplace-media` 只输出/转发该交互式工作流，不再承诺一次性无头生成完整素材。
- `README.marketplace.md` 继续使用 `images/marketplace/canvas-overview.png` 与 `images/marketplace/canvas-overview.mp4`，仓库 `README.md` / `README.zh-CN.md` 继续使用 `images/marketplace/canvas-overview.gif`。
- 脚本通过真实 Extension Development Host 按默认 surface 打开画布；录制开始前允许做可解释的场景初始化，但 `record-start` 与 `record-stop` 之间只允许通过原生鼠标、键盘和剪贴板完成用户可见操作。
- 录制脚本里的节点创建、模板选择、provider 选择和 modal 确认都来自真实 VS Code UI，不再预摆节点，也不再通过“多次启动 VS Code + 每一帧抓图”伪装成连续流程。
- 当前正式媒体资产的 Claude 节点由 `scripts/recording-session.mjs` 在 `PATH` 前置录制专用 `claude` wrapper 驱动；wrapper 复用 smoke fixture 的确定性输出，并把文件活动事件写回录制 runtime，确保最终画面稳定包含单文件节点。
- 若剧本需要准备示例文件、固定初始布局或切换到另一条故事线，初始化必须发生在对应片段开始前，并在剧本或录制说明中显式说明；不能把初始化通道产生的状态变化剪进视频并当作用户操作。
- 录制 runtime 会显式把 `devSessionCanvas.files.presentationMode` 设为 `nodes`、`devSessionCanvas.fileNode.displayStyle` 设为 `minimal`、`devSessionCanvas.files.nodeDisplayMode` 设为 `icon-path`，确保 `0.2.0` 的文件活动视图以单文件节点形态稳定进入最终素材，而不是继续沿用 `0.1.2` 的旧录制口径。
- 最终概览画面需要同时保留一个用户手工关系连线和一个围绕 `.debug/release-media-demo.md` 展开的自动单文件节点，用来覆盖 `0.2.0` 的两条核心新能力。
- 当前默认配置下，正式截图、`MP4` 与 `GIF` 都应显示 panel route 中的主画布，同时让左侧 activity bar 选中扩展图标，并展开扩展自己的 sidebar 内容。
- 媒体导出使用全新 profile 时，仍按当前产品真实默认语义把 `panel` route 放在底部 Panel；不额外伪装成 Secondary Sidebar。
- 为了让主画布在 README 素材里更清晰，媒体导出会显式把底部 Panel 设为默认位置并在打开时最大化；这是素材拍摄布局，不是产品新增默认行为。
- 媒体编排与原生输入都收口在 `scripts/recording-session.mjs` 与 `scripts/x11-native-input.py`；当前录制方案不需要再修改 `src/`。
- 正式素材继续输出到 `images/marketplace/`，并通过 `.vscodeignore` 排除出 VSIX。
- `scripts/package-vsix.mjs` 在打包 Marketplace README 时，默认把相对资源改写到当前 `HEAD` 对应的最终 git ref；若在不含 `.git` 元数据的目录中打包，必须显式传入 `DEV_SESSION_CANVAS_VSCE_DOC_BRANCH=<final-ref>`，并在打包前校验所有 README 相对媒体路径能在该 ref 上解析成功。
- VS Code stable 下载缓存应落到共享仓库根目录的 `.debug/vscode-test-cache/`，避免 worktree 自身的缓存目录成为脆弱点。

### 7.2 产物链路与代码锚点

- `scripts/generate-marketplace-media.mjs` 保留历史 npm 入口：无参数时输出交互式录制流程，有参数时把子命令转发给 `scripts/recording-session.mjs`。
- `scripts/recording-session.mjs start` 负责构建扩展、准备 main-only extension 目录、启动 `Xvfb` + `xfwm4`、启动真实 VS Code Extension Development Host、通过 activity bar / sidebar 打开 panel 画布，并写入 `.debug/marketplace-media/recording-session.json`。
- `scripts/recording-session.mjs click` / `key` / `paste` 负责录制片段内的真实用户输入；它们通过 `scripts/x11-native-input.py` 和 X11 clipboard 发送原生事件，不通过 Playwright synthetic click 或 Webview message 替代用户操作。
- `scripts/recording-session.mjs record-start` / `record-stop` / `gif-frame` / `stop` 负责把真实窗口区域录成 MP4 clip、抓取 GIF storyboard frame，并在收尾时拼出 `images/marketplace/canvas-overview.mp4`、`images/marketplace/canvas-overview.gif` 与 `images/marketplace/canvas-overview.png`。
- `scripts/recording-session.mjs state` 在真实宿主中读取 workspaceStorage 下的 `canvas-state.json` 作为观察辅助；它只用于确认当前画布状态，不替代 UI 操作。
- `command` / `dispatch` 是旧测试宿主能力；在 `real-extension-host` 模式下会被拒绝，避免录制路径重新滑回测试控制通道。

### 7.3 核心规则与不变量

- `GIF` 与 `MP4` 来自同一次真实 VS Code 会话，但它们不是同一条时间轴的两个转码视图：`MP4` 保留完整过程，`GIF` 只保留脚本显式选择的关键帧截图。
- 正式 `GIF` 的输入来源必须是录制期实时采到的 storyboard frame，不能再回退成“完整 `MP4` 完成后统一抽帧”，也不能继续回退成“关键阶段短 clip”。
- `PNG` 仍从最后一个稳定概览 storyboard frame 导出；抓取最终全景前必须等待或关闭 VS Code notification，避免 toast 遮挡画布或小地图。
- 无论 `GIF` 如何收口，README 中展示的节点内容、布局与文件活动效果都必须来自真实 VS Code 宿主中的画布运行时；provider 输出的 deterministic wrapper 必须在设计文档和 PR 描述中显式标注，不能误写成真实 Claude CLI 输出。
- GIF 中间产物只允许落在 `.debug/marketplace-media/` 下，最终对外资产仍只保留 `images/marketplace/` 中的 `PNG` / `MP4` / `GIF`。
- 录制宿主必须是非测试模式的 Extension Development Host；VS Code 原生 modal、Quick Input 与右键菜单都应进入真实录制路径，不允许为了媒体录制在产品代码里增加自动确认或绕过逻辑。
- 录制片段内只允许 `click` / `key` / `paste` 这类真实输入命令驱动画面；`locate`、`screenshot`、`state` 只能用于观察和定位。

## 8. 验证方法

验证分五层：

1. 运行 `npm run build` 与 `npm run typecheck`，确认媒体脚本与录制编排改动没有破坏主线。
2. 运行 `node scripts/recording-session.mjs start`，确认 session file 写入、真实 VS Code Extension Development Host 打开，且 `node scripts/recording-session.mjs screenshot` 能抓到完整宿主窗口。
3. 人工打开生成的 `PNG` / `MP4` / `GIF`，确认画面带有真实 VS Code 宿主外框和编辑区容器，而不是普通浏览器页面。
4. 人工检查动态素材，确认录制过程真实展示了 Note 正常尺寸开场、右键创建节点、中后段的 `fit view`、`Code Worker` / `Reviewer` 重命名、标题栏双击聚焦、用户手工关系连线、`Reviewer` 收到写文件指令后生成的 `.debug/release-media-demo.md` 单文件节点，以及不给 `Reviewer` 结果让路、直接继续输入 `写一首打油诗` 的并行节奏；同时确认 `GIF` 已经变成关键操作前后截图的切换，不再包含连续等待视频段。
5. 检查 `README.marketplace.md` 继续引用 `PNG` + `MP4`、`README.md` / `README.zh-CN.md` 继续引用 `GIF`，并确认打包脚本对 README 相对资源的 final-ref 校验与 `.vscodeignore` 排除规则仍然成立。

截至 2026-04-24，本设计已经完成一轮真实验证：`node --check scripts/generate-marketplace-media.mjs`、`npm run build`、`npm run typecheck` 与 `git diff --check` 全部通过；随后通过批准过的 `/bin/bash -lc "npm run generate:marketplace-media >/tmp/marketplace-media.log 2>&1"` 生成了新的素材，日志明确输出 `Composing GIF from 17 storyboard frames.`，并产出 `images/marketplace/canvas-overview.png`、`images/marketplace/canvas-overview.gif` 与 `images/marketplace/canvas-overview.mp4`。最终 `GIF` 经 `ffprobe` 验证为 `1180x738`、`11.320000s`、`18` 帧，对应的 storyboard metadata 记录了 17 张关键帧截图。

截至 2026-05-10，本设计完成动态录制路径修订验证：`node scripts/recording-session.mjs start` 能启动真实 Extension Development Host；通过原生 `click` 触发“示例模板”的重置按钮后，VS Code 原生确认框正常居中显示并可通过鼠标确认；确认后 `node scripts/recording-session.mjs state` 从真实 workspaceStorage 读取到 3 个节点和 1 条连线。同步执行 `node --check scripts/recording-session.mjs`、`python3 -c "import py_compile; py_compile.compile('scripts/x11-native-input.py', cfile='/tmp/x11-native-input.pyc', doraise=True)"`、`git diff --check`、`npm run typecheck` 与 `npm run test:canvas-templates`，均通过。

截至 2026-05-11，本设计针对复审意见补齐兼容入口、单文件节点配置和 deterministic provider 边界说明；重新导出最终 `PNG`、`GIF` 最后一帧与 `MP4` 尾帧，确认不再包含 VS Code notification toast。同步执行 `npm run generate:marketplace-media`、`node --check scripts/generate-marketplace-media.mjs`、`node --check scripts/recording-session.mjs`、`python3 -c "import py_compile; py_compile.compile('scripts/x11-native-input.py', cfile='/tmp/x11-native-input.pyc', doraise=True)"`、`git diff --check`、`npm run typecheck`、`npm run test:canvas-templates`、`file images/marketplace/canvas-overview.*` 与 `ffprobe`，均通过。
