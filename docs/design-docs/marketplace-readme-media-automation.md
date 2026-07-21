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
related_specs:
  - docs/product-specs/canvas-multi-root-workspace-support.md
related_plans:
  - docs/exec-plans/completed/marketplace-gif-keyframe-storyboard.md
  - docs/exec-plans/completed/marketplace-real-vscode-media-automation.md
  - docs/exec-plans/completed/marketplace-multi-root-media-storyboard-design.md
  - docs/exec-plans/completed/marketplace-multi-root-media-production.md
  - docs/exec-plans/completed/marketplace-real-provider-media-rerecord.md
  - docs/exec-plans/completed/marketplace-agent-only-smooth-transitions.md
  - docs/exec-plans/completed/marketplace-live-comparison-and-pane-flow-rerecord.md
  - docs/exec-plans/completed/marketplace-comparison-pacing-and-closing-caption-retime.md
  - docs/exec-plans/completed/marketplace-gif-narrative-layout-redesign.md
  - docs/exec-plans/completed/marketplace-png-hero-information-redesign.md
  - docs/exec-plans/completed/marketplace-png-hero-thumbnail-capability-rail.md
  - docs/exec-plans/completed/marketplace-png-hero-footer-simplification.md
  - docs/exec-plans/completed/marketplace-public-path-rerecord-review-followup.md
updated_at: 2026-07-21
---

# Marketplace README 素材自动化

## 1. 背景

主扩展子包维护 `extensions/vscode/dev-session-canvas/README.marketplace.md`，打包脚本会把它作为 Marketplace 页面展示的 README。默认英文 Marketplace README 使用一张 `PNG` 和一段短 `MP4`；仓库根 `README.md` 与 `README.zh-CN.md` 使用短 `GIF` 帮助读者快速理解产品。

仓库已经验证一条基于真实 VS Code Extension Development Host 的双阶段媒体链路：`scripts/media/recording-session.mjs` 负责原生输入、MP4 scene 与成对 checkpoint，`scripts/media/compose-marketplace-media.mjs` 负责校验 manifest、双宽屏后期、中英文字幕和三种正式资产。旧单宽屏导出仍保留为兼容入口，但不再承担当前宣传片生成。

新的传播方向不再强调这些操作。当前正式故事是一个四 root、四 Agent 工作现场：两个 Codex 与两个 Claude Code 同时推进，其中一个 Agent 进入 attention，另一个 Agent 持续执行测试；观众先看到 `rootGroups` 的空间化组合画布，再比较同一状态下的 `paneGallery`，最后在窗格画廊中聚焦 attention、回复决策并看到 Agent 测试收口。

## 2. 问题定义

需要同时解决内容和产物链路两个问题：

- 产品同一时刻只渲染一种顶层 multi-root 呈现模式。`rootGroups` 与 `paneGallery` 的左右同屏比较不能来自一个伪造的产品 split view，必须由两条真实宽屏录制源后期合成。
- 两条录制源必须使用同一组 root、节点、任务与执行状态，否则对比会被误解为两个不同 workspace。
- 四 root 双宽屏缩小后，产品细节不再适合承担全部解释；字幕必须进入画面构图，并在 README 常见宽度和移动端缩放下仍可读。
- GIF 需要展示状态演进，但不能从完整 MP4 均匀抽帧；每一帧都应能追溯到两种模式的真实录制 checkpoint。
- PNG 的传播任务是提供最强静态入口，不应继续机械复制 GIF 最后一张原始帧。当前 `cmdStop()` 的既有行为与新约定冲突。
- 文档必须清楚区分已验证的双宽屏 compositor、真实录制证据与仍保留的旧单宽屏兼容导出，不能把历史 `stop` 行为写成当前正式流程。

## 3. 目标

- 为 `extensions/vscode/dev-session-canvas/README.marketplace.md` 提供基于真实 VS Code 宿主录制、经双宽屏后期合成的英文 `PNG` 与 `MP4`。
- 为根 `README.md` 保留英文合成 `GIF`，并在中文资产生成后让 `README.zh-CN.md` 使用独立中文字幕版本。
- 使用 `payments-api`、`storefront`、`design-system`、`release-tools` 四个固定 root 和四个真实 Agent，稳定呈现 running、attention 与 Agent 执行测试共存的真实工作场景。
- 分别录制 `rootGroups` 与 `paneGallery` 的完整 `1440x900` 源素材，并在主片中只用一次有叙事目的的左右比较。
- 让 MP4 形成“全局 -> 比较 -> 聚焦 -> 决策 -> 验证”的约 54 秒因果链。
- 让 `rootGroups` 开场逐一展示四个 Agent 的“双击放大 -> 真实输入 -> running -> fit view”循环，而不是用预置运行状态或在缩小节点上直接输入代替操作过程。
- 让单 Root Groups 到双视图、双视图到单 Pane Gallery 的位置和尺寸在固定画布中逐帧同步变化，不出现先平移后跳缩放。
- 让 MP4 的双视图比较同时播放两条真实连续录屏，并让 Pane Gallery 从点击 `eye` 到点击 `globe` 回到全览全部来自同一条不中断录屏；MP4 不使用 checkpoint 定帧代替产品动效。
- 让录制宿主明确提供彩色终端能力，保留真实 Codex 与 Claude Code 的原生 ANSI 强调色。
- 正式素材同时使用真实 Codex CLI 与真实 Claude Code CLI，不允许 fake provider 或 PATH wrapper 进入录制宿主。
- 让 GIF 由经审阅的三段式 storyboard frame 组成：Root Groups 单画面、双模式比较、Pane Gallery 单画面；所有 UI 都能追溯到真实 Extension Host checkpoint。
- 让 PNG 从显式选定、经审阅的合成 Hero frame 单独导出，不再要求等于 GIF 最后一帧。
- 把字幕字号、安全区、行数、停留时间与中英文分开导出的规则写成可验收约束。

## 4. 非目标

- 不在当前宣传片中展示文件读取、文件写入、文件节点、文件列表、源码、diff 或编辑器跳转。
- 不继续展示右键创建节点、provider picker、启动模式、模板重置、模板保存或关系连线教学。
- 不修改主扩展产品代码来支持原生双视图；左右双宽屏只属于媒体后期。
- 不在画面中录制 Settings 切换过程，也不轮播 `paneGallery` 的四种局部布局。
- 不在正式片中使用 Terminal 节点，也不展示复杂跨 pane 拖拽或跨 root 连线。
- 不把当前一次媒体制作扩展成自动发布、远端上传或 CI gate。
- 不把素材导出接入 CI gate，也不扩展成长视频或全平台运营资产流水线。

## 5. 候选方案

### 5.1 手工录制真实 VS Code 桌面

真实性直观，但窗口尺寸、鼠标轨迹、字体和状态时序都会漂移。四 root、两种模式和语言版本会放大重复录制成本，因此不作为正式可维护链路。

### 5.2 基于 Webview harness 生成

harness 稳定、易测，但它把真实 Webview bundle 放在普通浏览器里，不是用户看到的 VS Code 宿主窗口。既有人工对比已经否决它作为最终素材来源。

### 5.3 继续使用单宽屏关键帧链路

当前 `recording-session.mjs` 已能生成真实宿主 MP4、GIF storyboard 与最后一帧 PNG，技术风险最低。但它只能讲一种顶层模式，无法清楚表达四 root 下“空间组织”和“逐 root 巡检”两种视角；继续复制最后一帧也会让 PNG 的静态传播价值受 GIF 排序约束。

### 5.4 在产品内新增同时渲染两种模式的 split view

这会为了宣传片改变产品架构，让同一 root 同时挂载两份重型画板，还会碰到 viewport、runtime subscriber 与输入归属问题。它不属于用户工作流，也违反“媒体录制不新增产品专用行为”的边界，因此拒绝。

### 5.5 分开录制两种真实模式，再做双宽屏合成

这是当前选定方案。`rootGroups` 与 `paneGallery` 各自以完整 `1440x900` 宽屏录制，使用同一 Extension Host、同一 workspace 和同一组确定性任务；在稳定状态点分别抓取 checkpoint。后期只缩放真实宽屏、添加静态背景、模式标签、字幕、转场和产品落版，不重绘任何产品状态。

主片开头和结尾使用单宽屏主画面，保证交互细节可读；只有中段进入双宽屏比较。单宽屏仍在合成母版内保留 UI 框外字幕带，不把源素材铺满最终画幅。GIF 最初全部使用双宽屏 frame，但人工复审发现 Pane Gallery 聚焦字幕与持续双窗构图语义不一致；正式方案改为前两帧 Root Groups 单画面、中间两帧双宽屏、后四帧 Pane Gallery 单画面。PNG 选择 attention 保留且 Pane Gallery 已进入 `sideThumbnails` 的成对 checkpoint，独立合成 50/50 Hero。

### 5.6 PNG 来源：最后一帧与显式 Hero

继续复制 GIF 最后一帧实现简单，但最后一帧服务于动图收尾，通常是状态已经收敛的全景，不一定能解释产品差异。显式 Hero frame 需要在合成 metadata 中多记录一个 frame ID，却能让静态图选择最有传播力的“同一 workspace、两种视角、attention 可见”画面。本轮选定 `attention-focused`：右侧主任务与缩略图同时可见，能直接证明 Pane Gallery 在单任务聚焦与全局任务掌控之间的关系。PNG 与 GIF 最后一帧不再具有相等不变量。

## 6. 风险与取舍

- 双宽屏缩小后，节点正文不会在所有展示尺寸下都可读。方案用单宽屏主画面承担交互细节，用模式标签和大字号字幕承担双屏段的信息解释，不通过裁掉宿主外框或放大假 UI 解决。
- 两条 take 不是同一时刻录下。真实 provider 的网络时序、Agent 测试时序或 root 排序可能漂移；每个合成 frame 都必须绑定成对 checkpoint，并在合成前人工审阅。
- checkpoint 没有时间维度。它们只用于 GIF storyboard 与 PNG Hero；MP4 的比较段和 Pane Gallery 故事段必须分别消费真实视频输入，并通过跨帧像素变化与可见点击验收。
- 真实 Codex / Claude 的完成时间和输出不完全确定。方案通过录制前启动 CLI、只读短任务、scene 分段和片段外等待控制时序，不允许为了稳定性退回 fake provider。
- `paneGallery` 仍处于“验证中”，复杂跨 pane 拖拽和大量 root 虚拟化尚未全部完成端到端验证。剧本只聚焦已有 Agent，不在这些风险路径上操作。
- ffmpeg 对动态 `scale` 输出尺寸与动态 `overlay` 位置的处理可能不同步。动画段必须改用固定 `1920x1200` 逐帧构图，并用完整 frame sequence 的 rect 连续性测试约束，而不能只验证稳定端点。
- 自动化环境可能继承 `NO_COLOR` 或 `TERM=dumb`，让 provider 主动关闭颜色。正式 recording child 必须覆盖 `TERM` / `COLORTERM` 并移除 `NO_COLOR`，但不能修改用户全局环境。
- 静态背景能让两个缩小宽屏拥有足够留白，但也可能抢夺注意力。背景只使用低噪声四 root 拓扑，不使用照片、粒子、动画噪点或强渐变。
- 中英文分开导出会增加组合次数和资产数量，但避免双语字幕堆叠，也能保持单句字号和阅读时间。
- 真实宿主录制仍依赖 `Xvfb`、窗口管理器、`xwininfo`、`ffmpeg` 与 VS Code stable 缓存；后续实现必须保留环境预检和失败诊断。

## 7. 正式方案

### 7.1 故事与产品边界

唯一录制剧本是 `docs/marketplace-media-scenario.md`。四个 root 与执行节点固定为：

- `payments-api / Contract Review`：真实 Codex CLI；用户双击放大并提交任务，`running -> waiting-input + attention -> 点击节点解除 attention -> 提交决策后 running`。
- `storefront / UI Builder`：真实 Claude Code CLI；用户双击放大并提交任务后进入 `running`。
- `design-system / Component Audit`：真实 Claude Code CLI；用户双击放大并提交任务后进入 `running`。
- `release-tools / Release Validation`：真实 Codex CLI；用户双击放大并提交只读测试任务，Agent 真实执行 `./run-e2e.sh`，随后返回 pass summary 与 exit code 0。

主片时长目标为 54 秒：`0-19s` 使用 `rootGroups` 单宽屏主画面，按固定顺序为四个节点各完成一次“双击放大、真实输入、看到执行、fit view”循环并建立 attention；`19-26s` 使用后期双宽屏比较同一状态下的两种顶层模式，比较字幕约在 `25.8s` 消失并于 `26s` 立即转场；`26-54s` 使用 `paneGallery` 单宽屏主画面进入 `sideThumbnails`、聚焦 attention、点击 Agent 认领 attention、回复 `Use full jitter. Cap at 3 attempts.`、查看测试通过并回到 `dynamic` 四 pane。收尾字幕在约 `49.2s` 点击 `globe` 时出现，而不是在点击前预告结果。

左右双宽屏必须被描述为后期比较画面。产品内的 `devSessionCanvas.canvas.multiRootPresentationMode` 仍是 `rootGroups | paneGallery` 二选一；本方案不新增同时渲染两种顶层模式的产品能力。

### 7.2 真实源录制

两条源素材都来自非测试模式的真实 VS Code Extension Development Host，分辨率均为 `1440x900`，使用同一主题、窗口、workspace folder 顺序、节点标题和任务文本。正式 Agent 会话由本机已登录的真实 Codex CLI 与 Claude Code CLI 提供；不允许 fake provider、fixture 输出或 PATH wrapper 进入正式宿主。Take A / Take B 是逻辑源素材，可以分别由多个同尺寸 scene clip 组成；为了等待真实 provider 或获取成对 checkpoint 而在录制片段外切换模式，不得进入最终 clip。

`payments-api` 的 Codex 节点使用一次性 custom launch command 启用官方 `tui.notifications=["agent-turn-complete"]`、`tui.notification_method="osc9"` 与 `tui.notification_condition="always"`；这组 `-c` 覆盖不修改用户全局配置。录制 profile 确保 `devSessionCanvas.notifications.enabledAttentionSignals` 包含 `osc9`，把 `devSessionCanvas.notifications.attentionSignalBridge` 设为 `none`，避免 system bridge 在缺少 companion 时回退成 workbench notification；同时把 `devSessionCanvas.notifications.strongTerminalAttentionReminder` 设为 `both`，让 attention 继续通过产品内标题栏与 MiniMap 呈现。

Take A 在开始前把 `devSessionCanvas.canvas.multiRootPresentationMode` 设为 `rootGroups`，并只在片段外完成四套真实 Agent CLI 的启动、登录/信任提示清理；剧本任务不能预先提交。正式镜头从 fit view 开始，依次双击 `payments-api`、`storefront`、`design-system`、`release-tools` 的节点放大，在真实输入区提交任务，看到 `running` 后点击 fit view，再处理下一个节点。它负责建立真实并行状态、attention，以及 GIF 所需的组合画布 checkpoint。

Take B 在同一 Extension Host 和同一 root-local 状态上热切到 `paneGallery`，不录 Settings。它以 `dynamic` 开始，当前 active root 固定为 `storefront`；点击 `eye` 后进入首次默认的 `sideThumbnails`，再双击 `payments-api` 缩略图聚焦 root，此时 attention 仍保留。随后点击主画板中的 `Contract Review` 节点，按真实产品语义认领并清除 attention，再提交决策让 Agent 从 waiting-input 恢复 running。处理完成后双击 `release-tools` 查看 `Release Validation` Agent 的真实测试收口，最后点击 `globe` 回到 `dynamic`。这条从 `dynamic` 到再次回到 `dynamic` 的故事必须在一次 `record-start` / `record-stop` 中连续录制；MP4 不得在任意动作之间插入 checkpoint、循环单帧或 freeze frame。

MP4 的左右比较分别消费 `rootGroups` 与 `paneGallery / dynamic` 的连续视频。比较进入和稳定段必须同时推进两条视频的时间戳；Root 源还要连续覆盖随后 3 秒退出转场，Pane 源还要从比较边界连续覆盖完整故事。checkpoint 只负责八帧 GIF 和 PNG Hero，不能作为 MP4 比较窗口的输入。

至少要为 `overview-start`、`all-running`、`attention-arrives`、`mode-compare`、`attention-focused`、`decision-submitted`、`tests-passed` 和 `all-in-view` 留下可追溯 checkpoint。任何左右状态不一致的 pair 都必须重录，不能在后期替换 root 标题、节点内容或状态视觉。

### 7.3 合成构图与字幕

合成母版使用 `2560x1600`。主片所有阶段都在该母版中构图：单宽屏阶段只显示一个在内容区内尽可能放大的真实 `16:10` 宽屏，双宽屏阶段的两个源宽屏各占 `1120x700`，左右外边距各 `120px`，间距 `80px`。两种构图都保留 UI 框外字幕带；无字幕时也不改变内容区尺寸，避免画面跳动。不裁宿主外框，不使用透视倾斜或 3D 旋转。背景是静态石墨色四 root 拓扑图，模式标签位于宽屏上方，主字幕位于 UI 框之外的独立安全区。

MP4 与 PNG 目标导出为 `1920x1200`，GIF 目标导出为 `1440x900`。MP4/GIF 中文字幕在前者中不小于 `80px`、后者中不小于 `60px`；每屏一句、单行不超过 16 个全角字符，视频完整停留至少 2.6 秒，GIF 完整句至少停留 2.2 秒。attention 英文句固定断为 `Spot the session that needs you.` 与 `Focus instantly.` 两行。PNG 使用独立静态信息层级，不套用视频单句字幕限制；其品牌、主标题与模式说明必须在 UI 框外排版，并按 `1920px`、`1180px` 与 `375px` 检查。中英文分开导出，不在同一画面堆叠双语。具体文案、模式标签和移动端预览规则以剧本为准。

后期只允许添加背景、窗口框、模式标签、字幕、转场和产品落版。Agent、root、attention、running 及其内容必须来自源录制像素。

两个动态转场段使用固定 `1920x1200` 输出 frame sequence。一个共享 rect 插值函数按 frame index 同时计算 x、y、width、height，生产 renderer 与连续性测试必须消费同一结果。比较进入持续 30 帧，Pane Gallery 扩展持续 90 帧；段首和段尾与相邻稳定段 rect 连续，中间帧沿同一 easing 单调逼近目标。

### 7.4 MP4、GIF 与 PNG 规则

- MP4 使用一条约 54 秒的编辑时间线。单宽屏主画面保留真实交互细节与外部字幕带；中段双宽屏来自 Take A / Take B 的同状态录制源。顶部横向项目落版在 `19-26s` 双窗对比中保持可见，进入 Pane Gallery 单窗时随模式标签平滑淡出，并在最后 1.5 秒重新淡入；落版包含正式 icon、产品名和 GitHub 地址，始终与底部字幕错开。
- GIF 不从完整 MP4 均匀抽帧，也不直接拼未经审阅的原始 checkpoint。它由剧本列出的八张三段式 storyboard frame 组成：前两张只选择 Root Groups checkpoint，中间两张合成左右 checkpoint，后四张只选择 Pane Gallery checkpoint；每张 frame 都记录左右 checkpoint 来源、layout、语言、字幕和停留时间。八帧左上 UI 框外固定显示同一紧凑品牌角标，最后一帧不重复第二套大号落版。
- PNG 从合成母版单独导出，不能从 GIF 解码回取，也不能直接缩放任一 GIF storyboard frame。默认 Hero frame ID 是 `attention-focused`，只复用该 ID 下同一状态的成对真实 checkpoint；Hero HTML/CSS 与 GIF frame 分开渲染。
- PNG 的两个产品窗口严格 50/50，在母版中分别为 `1200x750`，模式说明 top 为 `400px`，窗口 top 为 `550px`，底部只保留 `300px` 低对比背景；左右显示组合画布与窗格画廊，右侧使用真实 `sideThumbnails` 状态。Hero 左上品牌组使用真实 SVG icon、产品名和 GitHub 地址，右上保留产品说明，下方保持价值主标题和两种模式说明；不再增加底部能力条、图标或箭头，这些后期元素只能放在 UI 框外。
- Hero 文案必须使用 root / 根目录，不能把一个 folder 等同于 VS Code workspace，也不能假设它是 Git repository。组合画布表达各 root 会话在一张平铺画布中；窗格画廊表达单任务聚焦与全局任务掌控之间的平衡，不使用“质检”。精确中英文以剧本为准。
- PNG 不再要求等于 GIF 最后一帧。GIF 最后一帧为 `all-in-view`；只有人工评审显式变更 Hero frame ID 后，PNG 才能选择其他成对 checkpoint。
- GIF 每个 storyboard frame 的固定品牌角标都必须直接嵌入仓库 `extensions/vscode/dev-session-canvas/images/dev-session-canvas-icon.svg`，同时显示 `DevSessionCanvas` 与 `github.com/ZY-WANG-0304/dev-session-canvas`；不使用临时 `DSC` 文字方框、后期重画近似 icon 或最后一帧重复落版。
- MP4、GIF 与 PNG 的地址统一显示为 `github.com/ZY-WANG-0304/dev-session-canvas`，metadata 同时记录完整 `https://` URL；地址不本地化，不作为主字幕，也不通过全程水印遮挡产品像素。
- 导出日志或 metadata 必须记录 PNG 使用的 Hero frame ID、50/50 窗口规格、精确双语 presentation、产品名与 GitHub 地址，不能只依赖帧排序推断。
- 正式素材中不出现文件活动、文件节点、源码、diff、模板操作或节点创建教学。

### 7.5 资产路径与语言版本

英文默认资产继续使用现有稳定路径：

- `extensions/vscode/dev-session-canvas/images/marketplace/canvas-overview.mp4`
- `extensions/vscode/dev-session-canvas/images/marketplace/canvas-overview.gif`
- `extensions/vscode/dev-session-canvas/images/marketplace/canvas-overview.png`

中文资产使用 `canvas-overview.zh-CN.mp4`、`canvas-overview.zh-CN.gif` 与 `canvas-overview.zh-CN.png`。`README.zh-CN.md` 与 `README.marketplace.zh-CN.md` 分别引用中文字幕 GIF，以及中文 PNG / MP4；英文 README 继续引用默认无后缀资产。

中间源录制、checkpoint、frame pair metadata、背景与调色板只落在 `.debug/marketplace-media/`，最终对外资产只进入主扩展的 `images/marketplace/`。主扩展 `.vscodeignore` 和 README final-ref 校验继续沿用既有发布边界。

### 7.6 当前代码锚点与迁移状态

`scripts/media/recording-session.mjs` 是真实宿主录制入口。`start --scenario four-root-attention` 准备固定四 root workspace、root-local 静态节点、隔离 VS Code profile，并从系统 PATH 启动真实 Codex / Claude；正式 scenario 不注入 `provider-bin`。`set-mode` 在片段外切换呈现方式；`record-start --take <take> --scene <scene>` / `record-stop` 生成带标签的 scene；`checkpoint <frame-id> --take <take>` 同时写入原始 PNG 与状态 metadata；`close` 只关闭宿主，不触发导出。`stop` 仍为旧单宽屏兼容入口，不能用于当前正式流程。

`scripts/media/compose-marketplace-media.mjs` 是独立后期入口：

- `validate --manifest <path>` 严格校验 manifest v2 的固定八帧顺序、左右 take / state ID、逐帧时长、Hero ID、四个视频角色、源文件存在性、`1440x900` 几何和可用时长；Root Groups 的开场/比较必须引用同一文件的相邻时间戳，Pane Gallery 的比较/故事也必须在同一连续文件上于 16 秒边界衔接。
- `render --manifest <path> --language en|zh-CN` 使用 Playwright 渲染 `2560x1600` 逻辑母版、静态 storyboard frame 与独立 Hero master，再由 ffmpeg 把 Take A、双实时视频比较进入、双实时视频比较稳定、连续 Pane Gallery 扩展和连续 Pane Gallery 故事拆成五段后合成 54 秒 MP4，按显式时长生成 10 秒 GIF，并把 Hero master 单独缩放为 PNG。
- `STORYBOARD` 为每张 GIF frame 显式记录 `root-single | compare | pane-single` layout 与可选 `captionKey`。`attention-arrives` 固定为 compare；`attention-focused` 在 GIF 中固定为 pane-single，同时向独立 PNG Hero 提供同状态成对 checkpoint。Hero 的 50/50 构图不能反向改变 GIF layout。
- 默认截图 renderer 是 Playwright `Page.captureScreenshot`。如果维护机上的该 CDP 调用卡死，可显式设置 `DSC_MEDIA_SCREENSHOT_RENDERER=chrome-cli`；备选路径仍先在 Playwright 页面中加载并验证 Noto 字体，再使用同版本 Playwright Chromium headless shell 捕获同一 HTML，并强制检查 `2560x1600` 几何。不能退回完整 Chromium CLI，因为它会为 headless window 预留非页面高度。
- 每种语言在 `.debug/marketplace-media/composite/<language>/` 保留 validation report、render metadata、来源 hash、字体命中和中间 frame；只有 staged MP4 / GIF / PNG 全部通过检查后，才逐文件原子替换正式资产。

2026-07-17 的动态返工已经完成。当前 scenario metadata 使用 `providerMode: real-system-cli`，记录 Codex CLI `0.144.5` 与 Claude Code `2.1.209` 均已认证。Root Groups 正式源 `.debug/marketplace-media/sources/rootGroups/live-timeline-clean.mp4` 为 `42.30s / 1269` 帧，新时间线连续消费 `0-19s` 开场与 `19-29s` 比较/退出。Pane Gallery 原始单 take 为 `85.40s / 2562` 帧；本轮从同一原片的绝对约 `25-73.5s` 生成 `.debug/marketplace-media/sources/paneGallery/live-timeline-retimed-v2.mp4`，probe 为 `44.167s / 1325` 帧。manifest 连续消费新源 `9-16s` 比较与 `16-44s` 扩展/故事，globe 后仍保留真实动态全览，不使用定帧补尾。GIF/PNG 继续使用上一版已验收的 16 个真实 checkpoint。此前 60 秒动态版完整保存在 `.debug/marketplace-media/archive/2026-07-17-live-motion-60s-baseline/`，更早的静态帧版保存在 `.debug/marketplace-media/archive/2026-07-17-static-frame-baseline/`；两者都有 SHA-256 清单。

同日的 GIF 复审把原先“八帧全部双窗”改为显式三段式 layout。前两帧使用 `root-single`，中间两帧使用 `compare`，后四帧使用 `pane-single`；`attention-focused` 的聚焦字幕只覆盖 Pane Gallery 大画面，后来独立 PNG Hero 复用它的成对 checkpoint，但保持自己的 50/50 构图。重设计前的 54 秒六件套保存在 `.debug/marketplace-media/archive/2026-07-17-54s-dual-only-gif-baseline/`。

`docs/skills/recording-marketplace-media/SKILL.md` 继续只负责真实宿主、原生输入、原始 scene 和 checkpoint。双宽屏构图、字幕、GIF、Hero、语言版本和 README 规则由本文、剧本与 compositor 承担，不能回填到录制 Skill。

### 7.7 核心规则与不变量

- 所有产品 UI 像素来自真实 Extension Development Host；harness 不能作为最终素材来源。
- 正式 Agent 输出来自真实 Codex / Claude CLI；fake provider 只可用于独立测试，不能出现在正式 scenario 的 PATH、metadata 或源素材中。
- Take A 的四个 Agent 都必须可见完整“双击放大 -> 输入 -> running -> fit view”循环，不能以录制前预置状态代替。
- 两种 multi-root 形态分开真实录制；双宽屏只在后期出现，不能伪装成产品原生 split view。
- 两条 take 的 root 顺序、标题、任务和状态转换一致；每个合成 frame 的左右来源可追溯。
- GIF 的输入是经审阅的 Root 单画面、双宽屏和 Pane 单画面 storyboard frame，不是完整 MP4 抽帧，也不是未经构图的原始 checkpoint。
- PNG 的输入是显式选定的合成 Hero frame；`PNG == GIF last frame` 不再是约束。
- PNG 从合成母版单独导出，不从 GIF 回取。
- 字幕位于 UI 框外、可完整阅读，中英文分开导出。
- 录制与剪辑职责分离：录制 Skill 只生成和记录原始素材，本文与剧本定义成片规则，独立 compositor 执行后期和输出校验。
- 当前片不展示 Terminal 节点、文件读写相关画面或跨 pane 拖拽。
- 正式录制环境必须为 xterm-compatible PTY，移除 `NO_COLOR`；真实宿主像素必须显示 Codex 与 Claude 的原生 ANSI 强调色。持久化 `recentOutput` 可以继续保存去控制序列后的纯文本，不能拿它替代像素验收。
- 正式四 root workspace 固定从 `/tmp/dev-session-canvas-marketplace-media/four-root-attention/` 启动；公开素材不能出现维护者用户名、home 目录、仓库 worktree 或认证配置绝对路径。
- 动态转场的每个中间帧都必须同时改变位置与尺寸，不接受只验证稳定端点。
- MP4 的双视图比较必须同时消费两条真实视频；左右窗口内部都要有可测的跨帧变化，不能用 checkpoint、`-loop 1` 或 freeze frame。
- Pane Gallery 的 `eye -> sideThumbnails -> payments-api -> decision -> release-tools -> globe -> dynamic` 必须来自一条连续视频；鼠标点击和产品布局动画在成片中都必须可见。
- 比较字幕消失后必须在 `0.3s` 内开始 Pane Gallery 转场；收尾字幕首次出现必须与 `globe` 点击相差不超过 `0.3s`，并在点击后至少保留约 `4s`。
- 英文 README 只引用默认资产，中文 README 只引用 `.zh-CN` 资产；引用切换必须晚于对应语言资产生成和验收。

## 8. 验证方法

### 8.1 本次媒体探测

以下结果对应 2026-07-17 完成的“比较节奏收紧 + 收尾字幕同步”、三段式 GIF 与独立 PNG Hero 正式资产：

1. 八帧双语 storyboard、独立 Hero 的 `attention-focused` source、对称 50/50 窗口、manifest v2 连续视频边界、54 秒时间线、动态窗口像素边界、真实 Provider metadata 与受限原生输入动作均在本次制作中通过临时命令、输出级 probe 和人工逐帧检查确认。精确帧序、文案、时长与几何属于当前素材设计，不作为仓库长期自动化接口；PR review 后已删除两份素材专用 test 文件。
2. `node --check scripts/media/recording-session.mjs` 与 `node --check scripts/media/compose-marketplace-media.mjs` 通过；`npm run build`、`npm run typecheck` 与 `git diff --check` 通过。
3. 中英文 validation report 均为 `passed: true`，确认 Noto Sans CJK SC 字体命中、Hero ID 为 `attention-focused`、两个 `1200x750` 窗口对称 50/50、模式区 top `400px`、窗口 top `550px`、footer 为 `none`、精确语言文案与正式 SVG icon，并通过 `gifFramePresentations` 记录每帧 layout/caption，同时记录四个视频角色和 16 个 checkpoint 的 SHA-256。
4. 2026-07-20 中性路径重录后的六份正式资产均可完整解码。两条 MP4 都是 `1920x1200`、H.264、30 fps、1620 帧、54 秒，`blackdetect` 均为 0 命中；两条 GIF 都是 `1440x900`、8 个唯一帧、10 秒；两张 PNG 都是 `1920x1200`。英文 MP4 / GIF / PNG SHA-256 依次为 `a3280c5ac98d4ac0ff8f894a0979fc1780f34e103b5c2082e497cfd8d95c0361`、`4c38e8d21a3ce2153fef02a9f35a11ddfe64385c2113176c24343fae1ff481af`、`9b6486e1d2c73a208e97bb967456d229adf0e97346a2e3da5a764ad396df252c`；中文依次为 `5a1640ebb50015484fd13f7b9519aaccddaf40d3870ec1005536f934b27d6aa2`、`1cd849ae8a3ae7820446c878625dc6c4107faeb1e6277762a2eb6155d3d9da2e`、`f04d390ee3116ce633a62d2bd548617d5793e8d153bba4d39e9d0efaa1790ddc`。
5. 对中英文 MP4 的 `20-26s` 每 500ms 分别裁取左右比较窗口，两侧都是 `12/12` 个唯一解码帧；对 `29-54s` Pane Gallery 主窗口同样采样，结果都是 `50/50` 个唯一帧。该门禁直接证明三块产品内容不是 checkpoint loop 或 freeze frame。
6. 比较字幕最后可见帧为 `25.800s`，`25.833s` 已消失，Pane Gallery 几何首个运动帧为 `26.033s`，间隔 `0.233s`。globe 点击与收尾字幕首帧同为 `49.200s`，`49.267s` 已进入产品自身的 dynamic 回归动画，字幕随后保持到片尾约 `4.767s`。
7. 2026-07-20 PR review 确认旧六件套包含维护者 home 下的 cwd，因此不能继续锁定旧动态资产 hash。本轮从 `/tmp/dev-session-canvas-marketplace-media/four-root-attention/` 重新录制两个 Codex 与两个 Claude Code，并重新生成六件套；旧版、源 take、checkpoint、manifest 与报告均保存在对应 `.debug/marketplace-media/archive/`，不再作为可发布候选。

### 8.2 真实宿主与视觉验收

1. 同一个真实 Extension Development Host 中存在两个 Codex 与两个 Claude Code Agent；Take A 按固定顺序完成四轮“双击节点上下文行放大、在真实 TUI 输入、提交、看到 running、fit view”，第四轮明确聚焦 `release-tools / Release Validation`，没有 Terminal 节点或 `/usr/bin/bash` backend label。
2. `Release Validation` 的真实 Codex TUI 运行 `./run-e2e.sh`，外部 trigger 只解除脚本等待；全分辨率成片在约 `44-49s` 能辨认 `42 passed`、`PASS - 42 checks passed` 与 `exit code 0`。Agent 输出、running、waiting-input 和 attention 均来自真实运行时像素。
3. `Contract Review` 的 OSC 9 attention 同时进入标题栏、MiniMap 与 sidebar；Pane Gallery 聚焦前 attention 保留，点击主 Agent 后清除，固定回复 `Use full jitter. Cap at 3 attempts.` 经真实 Codex PTY 提交并得到确认。
4. 正式 child 进程实际为 `TERM=xterm-256color`、`COLORTERM=truecolor`，且不存在 `NO_COLOR`。真实 Host 冒烟与成片分别确认 Claude 的橙 / 黄 truecolor，以及 Codex 的青色命令、绿色路径、粗体和代码强调；只有节点边框有颜色不算通过。持久化 `recentOutput` 会归一化为纯文本，因此环境与全分辨率像素是正式颜色证据。
5. `.debug/marketplace-media/review/compare-enter-motion.png` 继续覆盖 `18.8-20.6s` 的比较进入；`.debug/marketplace-media/review/pacing-retime/final-en/pane-expand-motion.png` 覆盖 `25.8-29.4s` 每 `100ms` 一帧。逐格确认 Root Groups 与 Pane Gallery 的 x、y、width、height 沿同一 easing 同步变化，没有平移与缩放分阶段或单帧跳变。
6. `record-start` 的真实 X11 录制通过 `-progress` 等到 `frame >= 1` 后才返回；三条本轮 scene 都成功经过握手，短动作不再先于首帧。停止后 `.progress` 文件被清理，录制 Skill 与本次故障注入检查已同步，该技术债从列表移入“近期已收口”。
7. `.debug/marketplace-media/review/pacing-retime/final-en/story-actions.png` 从 `26.000s` 到 `53.900s` 连续覆盖 eye、payments、Contract Review、决策、Release Validation、globe 与 dynamic；`.debug/marketplace-media/review/pacing-retime/final-en/globe-caption-sequence.png` 和对应中文版逐帧证明收尾字幕在 `49.200s` 点击时出现。聚焦、决策、release result 与回全览之间没有 checkpoint 或静态替换。
8. 中英文 Hero、GIF 与 MP4 分别按 README `1180px` 和移动端 `375px` 抽样目检；Hero 的产品名、主标题、模式说明和放大等宽窗口没有裁切、重叠或遮挡 UI，底部不再出现重复能力项，右侧能看清主任务与缩略图的结构关系。视频/GIF 字幕仍位于 UI 外部安全区，模式标签和背景未抢夺主画面。
9. 中文渲染继续使用显式 headless-shell CLI renderer；中英文 Hero master 都从 `attention-focused` 成对 checkpoint 独立生成，PNG 发生预期变化，MP4/GIF hash 保持不变，证明独立静态渲染没有扰动动态资产。
10. `.debug/marketplace-media/review/gif-redesign/en/gif-decoded-contact.png` 与中文对应 contact sheet 逐帧确认 2 张 Root 单画面、2 张双模式和 4 张 Pane 单画面；`gif-mobile-375-contact.png` 确认比较字幕与聚焦字幕在移动端宽度下完整可读，`tests-passed` 的真实 Agent 结果比旧双窗构图更清楚。`final-icon-frame.png` 及 375px 版本确认最后一帧使用真实双色 `dev-session-canvas-icon.svg`，不再出现 `DSC` 占位字标。
11. `.debug/marketplace-media/review/png-hero-clean-footer/` 保存第十一轮中英文 `1180px` 与 `375px` Hero 预览、当时的机器可读 JSON 与 checksum；这些 hash 在第十二轮真实重录后只作为历史证据，不再校验当前正式资产。
12. `.debug/marketplace-media/review/public-path-rerecord/` 保存当前中英文 MP4 contact sheet、GIF 八帧 contact sheet、Hero `1180px / 375px` 预览与 `PUBLISHED_SHA256SUMS`。人工逐帧确认产品像素只出现中性 `/tmp/dev-session-canvas-marketplace-media...` cwd；六个正式二进制的可读字符串检查也未命中 `/home/users`、维护者用户名或 worktree 路径。该检查是本次素材验收证据，不新增长期跟踪的素材测试脚本。
13. `.debug/marketplace-media/review/github-branding-candidate/` 保存第十三轮的中英文 Hero `1180px / 375px`、GIF 八帧与首尾全分辨率帧、MP4 双窗品牌条 `1180px` 预览及进入/退出关键帧。两个 compositor validation report 均为 `passed: true`，并为八个 GIF presentation 记录 `productLockup: persistent`；六件套完整解码、MP4 blackdetect 0 命中、公开路径扫描、`npm run build`、`npm run typecheck` 与 `git diff --check` 均通过。用户于 2026-07-21 完成视觉确认，因此 `validation_status` 恢复为“已验证”。

### 8.3 维护边界与历史证据

本流程仍是依赖 Linux X11、Xvfb、xfwm4、xwininfo、xsel、ffmpeg 与 VS Code stable 缓存的维护者工作流，不是跨平台或 CI 资产流水线；这一既有可移植性限制继续由 `docs/exec-plans/tech-debt-tracker.md` 跟踪。

以下证据只证明旧单宽屏真实宿主录制链路曾经可用，不替代本次双宽屏验证：

- 2026-04-24：真实宿主关键帧 GIF 生成通过，产出 17 张 storyboard frame；GIF 为 `1180x738`、`11.32s`、18 帧。
- 2026-05-10：Extension Development Host、原生确认框、真实 workspaceStorage 状态读取、构建、类型检查和模板定向测试通过。
- 2026-05-11：旧 PNG、GIF 最后一帧与 MP4 尾帧重新导出并确认无 notification toast；相关脚本检查、构建、类型检查和 `ffprobe` 通过。

2026-07-15 的第一轮双宽屏证据使用 deterministic provider，且未完整展示四个节点逐一输入；该结果随后被真实 provider 返工取代。第二轮已经使用真实 Codex / Claude、完成四次输入并修正稳定端点几何，但仍保留一个 Terminal 节点，两段动态转场存在位置与尺寸不同步，录制环境的 `NO_COLOR=1` 还让 Agent TUI 退化为单色。

第三轮已经把第四个执行节点改为真实 Codex Agent，移除录制 child 的 `NO_COLOR`，并用固定画布 `perspective` 完成两段同步几何转场。中英文六份二进制资产、16 个 checkpoint、100ms 转场 contact sheet、颜色关键帧与 validation report 均通过当时的门禁，但 2026-07-17 人工复审发现：左右比较是固定帧，第一次 Pane Gallery 聚焦前没有可见 `eye` 点击，聚焦与回全览阶段也被定帧替代。旧版已完整保存在 `.debug/marketplace-media/archive/2026-07-17-static-frame-baseline/`；在新的双实时视频与连续 Pane Gallery take 通过验收前，本文保持 `validation_status: 验证中`。

第四轮在不改变 GIF/PNG 静态设计的前提下，把 MP4 manifest 升级为 v2：比较段只消费两条连续真实视频，Pane Gallery 从 dynamic、eye、聚焦、回复、release result、globe 到 dynamic 只消费一条连续视频。中英文动态采样、可见点击、完整解码、blackdetect、本次临时素材检查、构建与类型检查均通过，六份修复版已替换 canonical 资产，因此本文恢复 `validation_status: 已验证`。

第五轮保留第四轮的连续真实录屏与全部交互，只把双模式稳定段从 15 秒缩短为 6 秒，并从原始 Pane take 延长 globe 后的真实动态全览。此前 60 秒动态版完整保存在 `.debug/marketplace-media/archive/2026-07-17-live-motion-60s-baseline/`。新版比较字幕消失后 `0.233s` 开始转场，收尾字幕与 globe 点击同在 `49.200s`，中英文 54 秒 MP4 与静态资产全部通过门禁，因此验证状态保持“已验证”。

第六轮只重设计 GIF：Root Groups 建立全局、双窗解释模式、Pane Gallery 放大聚焦与验证。中英文 GIF 的八帧 layout、字幕语义、1180px/375px 预览、完整解码和唯一帧均通过；MP4 与 PNG hash 保持第五轮结果不变，因此本文继续为“已验证”。

第七轮只替换 GIF 最后一帧的品牌标识：compositor 直接嵌入仓库 `dev-session-canvas-icon.svg` 并把路径/hash 写入 validation report。中英文 MP4 与 PNG 继续逐字节不变，桌面和 375px 收尾帧通过视觉检查。

第八轮首次把 PNG Hero 从 GIF frame 中解耦，使用 `attention-arrives` 的成对真实 checkpoint 和严格 50/50 产品窗口，增加正式 icon、产品说明、root 语义主标题、两种模式说明与三项能力。旧单句 PNG 已归档，MP4/GIF 逐字节不变；该版随后被第九轮替代并保存在 `.debug/marketplace-media/archive/2026-07-17-png-hero-dynamic-gallery-baseline/`。

第九轮把 PNG Hero source 切到 `attention-focused` 成对 checkpoint，右侧真实显示 `payments-api` 主任务与其他 root 缩略图；底部从三个编号等宽栏改为按模式归属的能力轨道。该版通过当时门禁，随后在人工审阅中被认定仍把不对等能力错误表现成流程，完整保存在 `.debug/marketplace-media/archive/2026-07-18-png-hero-capability-rail-baseline/`。

第十轮完全删除底部三项、图标和箭头，把能力解释收敛到两侧模式说明，并将两个真实产品窗口从 `1120x700` 放大为 `1200x750`。中英文三档视觉检查、本次临时素材检查、完整解码和工程门禁通过，MP4/GIF 继续逐字节不变，因此验证状态保持“已验证”。

第十一轮不增加任何新内容，只重新分配纵向空间：主标题 top 调整为 `190px`，模式区 top 为 `400px`，窗口 top 为 `550px`，两个 `1200x750` 窗口底边落在 `1300px`，母版底部留白从最初无 footer 版本的 `440px` 收到 `300px`。中英文三档预览确认画面不再头重脚轻，MP4/GIF 继续逐字节不变。

第十二轮处理 PR #271 review：正式四 root workspace 从仓库 `.debug` 迁到固定中性 `/tmp` 路径，重新启动两个真实 Codex 与两个真实 Claude Code，重录 Root Groups 四轮输入、双实时比较和完整 Pane Gallery 故事，并重新捕获 16 个 checkpoint。两份素材专用 test 文件及 fake provider 的媒体专用增量从 PR 中移除；本次使用临时 contact sheet、输出级 probe、完整解码与人工目检验收，不把当前八帧、54 秒文案和几何继续固化为长期仓库契约。六件套、validation report、动态唯一帧与公开路径检查通过后，本文恢复“已验证”。

第十三轮按用户要求补充项目 GitHub 地址和统一品牌身份：PNG 在左上品牌组中组合 icon、名称和地址；GIF 八帧都在左上安全区保留固定紧凑角标，最后一帧不重复第二套大号落版；MP4 顶部横向品牌条覆盖 `19-26s` 双窗对比、随 Pane Gallery 扩展平滑淡出，并在最后 1.5 秒重新淡入，避免覆盖底部字幕和真实产品像素。中英文六件套、临时视觉证据和工程门禁通过后由用户确认，本文恢复“已验证”。
