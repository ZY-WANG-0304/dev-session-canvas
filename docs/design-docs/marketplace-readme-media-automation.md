---
title: Marketplace README 素材自动化
decision_status: 已选定
validation_status: 验证中
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
updated_at: 2026-07-14
---

# Marketplace README 素材自动化

## 1. 背景

主扩展子包维护 `extensions/vscode/dev-session-canvas/README.marketplace.md`，打包脚本会把它作为 Marketplace 页面展示的 README。默认英文 Marketplace README 使用一张 `PNG` 和一段短 `MP4`；仓库根 `README.md` 与 `README.zh-CN.md` 使用短 `GIF` 帮助读者快速理解产品。

仓库已经验证过一条基于真实 VS Code Extension Development Host 的自动录制链路：`scripts/media/recording-session.mjs` 可以启动真实宿主、通过原生输入录制 MP4 clip、在录制期抓取 GIF storyboard frame，并把最后一张原始 storyboard PNG 复制为主截图。这条链路解决了普通浏览器 harness 与真实 VS Code 宿主观感不同的问题，但旧宣传片仍是模板、节点创建、重命名、连线、文件活动和模板保存组成的功能巡礼。

新的传播方向不再强调这些操作。当前正式故事是一个四 root 工作现场：多个 Agent 与一个 Terminal 同时推进，其中一个 Agent 进入 attention；观众先看到 `rootGroups` 的空间化组合画布，再比较同一状态下的 `paneGallery`，最后在窗格画廊中聚焦 attention、回复决策并看到测试收口。

## 2. 问题定义

需要同时解决内容和产物链路两个问题：

- 产品同一时刻只渲染一种顶层 multi-root 呈现模式。`rootGroups` 与 `paneGallery` 的左右同屏比较不能来自一个伪造的产品 split view，必须由两条真实宽屏录制源后期合成。
- 两条录制源必须使用同一组 root、节点、任务与执行状态，否则对比会被误解为两个不同 workspace。
- 四 root 双宽屏缩小后，产品细节不再适合承担全部解释；字幕必须进入画面构图，并在 README 常见宽度和移动端缩放下仍可读。
- GIF 需要展示状态演进，但不能从完整 MP4 均匀抽帧；每一帧都应能追溯到两种模式的真实录制 checkpoint。
- PNG 的传播任务是提供最强静态入口，不应继续机械复制 GIF 最后一张原始帧。当前 `cmdStop()` 的既有行为与新约定冲突。
- 文档必须清楚区分已验证的旧单宽屏导出能力与尚待实现、尚待真实录制验收的双宽屏 compositor，不能把设计结论写成现成功能。

## 3. 目标

- 为 `extensions/vscode/dev-session-canvas/README.marketplace.md` 提供基于真实 VS Code 宿主录制、经双宽屏后期合成的英文 `PNG` 与 `MP4`。
- 为根 `README.md` 保留英文合成 `GIF`，并在中文资产生成后让 `README.zh-CN.md` 使用独立中文字幕版本。
- 使用 `payments-api`、`storefront`、`design-system`、`release-tools` 四个固定 root，稳定呈现 Agent running、attention 与正在执行测试的 `live` Terminal 共存的真实工作场景。
- 分别录制 `rootGroups` 与 `paneGallery` 的完整 `1440x900` 源素材，并在主片中只用一次有叙事目的的左右比较。
- 让 MP4 形成“全局 -> 比较 -> 聚焦 -> 决策 -> 验证”的约 60 秒因果链。
- 让 GIF 由经审阅的双宽屏合成 storyboard frame 组成；两侧 UI 都能追溯到真实 Extension Host checkpoint。
- 让 PNG 从显式选定、经审阅的合成 Hero frame 单独导出，不再要求等于 GIF 最后一帧。
- 把字幕字号、安全区、行数、停留时间与中英文分开导出的规则写成可验收约束。

## 4. 非目标

- 不在当前宣传片中展示文件读取、文件写入、文件节点、文件列表、源码、diff 或编辑器跳转。
- 不继续展示右键创建节点、provider picker、启动模式、模板重置、模板保存或关系连线教学。
- 不修改主扩展产品代码来支持原生双视图；左右双宽屏只属于媒体后期。
- 不在画面中录制 Settings 切换过程，也不轮播 `paneGallery` 的四种局部布局。
- 不在多 pane 或 thumbnail 中输入 Terminal，不展示复杂跨 pane 拖拽或跨 root 连线。
- 本次设计收口不等于 compositor、语言资产和正式媒体已经实现或验收。
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

主片开头和结尾使用单宽屏主画面，保证交互细节可读；只有中段进入双宽屏比较。单宽屏仍在合成母版内保留 UI 框外字幕带，不把源素材铺满最终画幅。GIF 可以全部使用双宽屏合成 frame，因为它依靠少量经审阅的状态帧讲故事；PNG 选择 attention 对比最清楚的 Hero frame。

### 5.6 PNG 来源：最后一帧与显式 Hero

继续复制 GIF 最后一帧实现简单，但最后一帧服务于动图收尾，通常是状态已经收敛的全景，不一定能解释产品差异。显式 Hero frame 需要在合成 metadata 中多记录一个 frame ID，却能让静态图选择最有传播力的“同一 workspace、两种视角、attention 可见”画面。本轮选定显式 Hero；PNG 与 GIF 最后一帧不再具有相等不变量。

## 6. 风险与取舍

- 双宽屏缩小后，节点正文不会在所有展示尺寸下都可读。方案用单宽屏主画面承担交互细节，用模式标签和大字号字幕承担双屏段的信息解释，不通过裁掉宿主外框或放大假 UI 解决。
- 两条 take 不是同一时刻录下。若 deterministic provider、Terminal 时序或 root 排序漂移，左右状态可能不一致；每个合成 frame 都必须绑定成对 checkpoint，并在合成前人工审阅。
- `paneGallery` 仍处于“验证中”，真实宿主 Terminal input、复杂跨 pane 拖拽和大量 root 虚拟化尚未全部完成端到端验证。剧本只查看已经运行的 Terminal 输出，不在这些风险路径上操作。
- 静态背景能让两个缩小宽屏拥有足够留白，但也可能抢夺注意力。背景只使用低噪声四 root 拓扑，不使用照片、粒子、动画噪点或强渐变。
- 中英文分开导出会增加组合次数和资产数量，但避免双语字幕堆叠，也能保持单句字号和阅读时间。
- 真实宿主录制仍依赖 `Xvfb`、窗口管理器、`xwininfo`、`ffmpeg` 与 VS Code stable 缓存；后续实现必须保留环境预检和失败诊断。

## 7. 正式方案

### 7.1 故事与产品边界

唯一录制剧本是 `docs/marketplace-media-scenario.md`。四个 root 与执行节点固定为：

- `payments-api / Contract Review`：`running -> waiting-input + attention -> 点击节点解除 attention -> 提交决策后 running`。
- `storefront / UI Builder`：用户提交任务后进入 `running`。
- `design-system / Component Audit`：持续 `running`，收尾前完成。
- `release-tools / E2E Tests`：Terminal 状态为 `live`，真实测试命令正在执行，随后以 exit code 0 收口。

主片时长目标为 60 秒：`0-19s` 使用 `rootGroups` 单宽屏主画面建立四 root 并行和 attention；`19-35s` 使用后期双宽屏比较同一状态下的两种顶层模式；`35-60s` 使用 `paneGallery` 单宽屏主画面进入 `sideThumbnails`、聚焦 attention、点击 Agent 认领 attention、回复 `Use full jitter. Cap at 3 attempts.`、查看测试通过并回到 `dynamic` 四 pane。

左右双宽屏必须被描述为后期比较画面。产品内的 `devSessionCanvas.canvas.multiRootPresentationMode` 仍是 `rootGroups | paneGallery` 二选一；本方案不新增同时渲染两种顶层模式的产品能力。

### 7.2 真实源录制

两条源素材都来自非测试模式的真实 VS Code Extension Development Host，分辨率均为 `1440x900`，使用同一主题、窗口、workspace folder 顺序、节点标题、任务文本和 deterministic provider 状态机。Take A / Take B 是逻辑源素材，可以分别由多个同尺寸 scene clip 组成；为了获取成对 checkpoint 而在录制片段外切换模式，不得进入最终 clip。

录制 fixture 固定用 `osc9` 触发 attention，并确保 `devSessionCanvas.notifications.enabledAttentionSignals` 包含 `osc9`。录制 profile 把 `devSessionCanvas.notifications.attentionSignalBridge` 设为 `none`，避免 system bridge 在缺少 companion 时回退成 workbench notification；同时把 `devSessionCanvas.notifications.strongTerminalAttentionReminder` 设为 `both`，让 attention 继续通过产品内标题栏与 MiniMap 呈现。

Take A 在开始前把 `devSessionCanvas.canvas.multiRootPresentationMode` 设为 `rootGroups`。它负责开场四 root 全景、`storefront` 任务提交、attention 出现，以及 GIF 所需的组合画布 checkpoint。

Take B 在同一 Extension Host 和同一 root-local/live 状态上热切到 `paneGallery`，不录 Settings。它以 `dynamic` 开始，当前 active root 固定为 `storefront`；点击 `eye` 后进入首次默认的 `sideThumbnails`，再双击 `payments-api` 缩略图聚焦 root，此时 attention 仍保留。随后点击主画板中的 `Contract Review` 节点，按真实产品语义认领并清除 attention，再提交决策让 Agent 从 waiting-input 恢复 running。处理完成后双击 `release-tools` 查看真实 Terminal 收口，最后点击 `globe` 回到 `dynamic`。

至少要为 `overview-start`、`all-running`、`attention-arrives`、`mode-compare`、`attention-focused`、`decision-submitted`、`tests-passed` 和 `all-in-view` 留下可追溯 checkpoint。任何左右状态不一致的 pair 都必须重录，不能在后期替换 root 标题、节点内容或状态视觉。

### 7.3 合成构图与字幕

合成母版使用 `2560x1600`。主片所有阶段都在该母版中构图：单宽屏阶段只显示一个在内容区内尽可能放大的真实 `16:10` 宽屏，双宽屏阶段的两个源宽屏各占 `1120x700`，左右外边距各 `120px`，间距 `80px`。两种构图都保留 UI 框外字幕带；无字幕时也不改变内容区尺寸，避免画面跳动。不裁宿主外框，不使用透视倾斜或 3D 旋转。背景是静态石墨色四 root 拓扑图，模式标签位于宽屏上方，主字幕位于 UI 框之外的独立安全区。

MP4 与 PNG 目标导出为 `1920x1200`，GIF 目标导出为 `1440x900`。中文字幕在前者中不小于 `80px`、后者中不小于 `60px`；每屏一句、单行不超过 16 个全角字符，视频完整停留至少 2.6 秒，GIF 完整句至少停留 2.2 秒。attention 英文句固定断为 `Spot the session that needs you.` 与 `Focus instantly.` 两行。中英文分开导出，不在同一画面堆叠双语。具体文案、模式标签和移动端预览规则以剧本为准。

后期只允许添加背景、窗口框、模式标签、字幕、转场和产品落版。Agent、Terminal、root、attention、running 及其内容必须来自源录制像素。

### 7.4 MP4、GIF 与 PNG 规则

- MP4 使用一条 60 秒左右的编辑时间线。单宽屏主画面保留真实交互细节与外部字幕带；中段双宽屏来自 Take A / Take B 的同状态录制源。
- GIF 不从完整 MP4 均匀抽帧，也不直接拼未经审阅的原始 checkpoint。它由剧本列出的八张双宽屏合成 storyboard frame 组成，每张 frame 都记录左右 checkpoint 来源、语言、字幕和停留时间。
- PNG 从合成母版单独导出，不能从 GIF 解码回取。默认 Hero frame ID 是 `attention-arrives`，其左右两侧分别显示同一状态下的组合画布与窗格画廊。
- PNG 不再要求等于 GIF 最后一帧。GIF 最后一帧为 `all-in-view`；只有人工评审显式变更 Hero frame ID 后，PNG 才能选择其他合成帧。
- 导出日志或 metadata 必须记录 PNG 使用的 Hero frame ID，不能只依赖帧排序推断。
- 正式素材中不出现文件活动、文件节点、源码、diff、模板操作或节点创建教学。

### 7.5 资产路径与语言版本

英文默认资产继续使用现有稳定路径：

- `extensions/vscode/dev-session-canvas/images/marketplace/canvas-overview.mp4`
- `extensions/vscode/dev-session-canvas/images/marketplace/canvas-overview.gif`
- `extensions/vscode/dev-session-canvas/images/marketplace/canvas-overview.png`

中文目标资产使用 `canvas-overview.zh-CN.mp4`、`canvas-overview.zh-CN.gif` 与 `canvas-overview.zh-CN.png`。中文资产生成并验收前，不能提前修改 `README.zh-CN.md` 引用或声称语言版本已经可用。

中间源录制、checkpoint、frame pair metadata、背景与调色板只落在 `.debug/marketplace-media/`，最终对外资产只进入主扩展的 `images/marketplace/`。主扩展 `.vscodeignore` 和 README final-ref 校验继续沿用既有发布边界。

### 7.6 当前代码锚点与迁移状态

`scripts/media/recording-session.mjs` 仍是当前真实宿主录制入口：`start` 准备 Extension Development Host，`record-start` / `record-stop` 捕获 MP4 clip，`gif-frame` 捕获原始 checkpoint，`stop` 调用 `concatClips()` 与 `composeGif()` 生成现有资产。

截至 2026-07-14，新合成规则尚未实现：

- `composeGif()` 仍只按文件名顺序读取单张原始 PNG，并固定停留 `0.7s`；它不知道左右 checkpoint pair、背景、语言或逐帧时长。
- `cmdStop()` 仍执行 `Copy last GIF frame as PNG`，再通过 `fs.copyFile(lastFrame, ...)` 输出 `canvas-overview.png`。
- 当前脚本没有双宽屏 compositor、显式 Hero frame ID、中文资产或对应 metadata。

后续实现必须另建 ExecPlan，在 `scripts/media/` 边界内补齐 pair manifest、合成、语言版本、Hero 选择和验证；除非发现真实产品缺陷，不应为媒体导出修改主扩展 `extensions/vscode/dev-session-canvas/src/`。在实现和人工验收完成前，本文保持 `validation_status: 验证中`。

`docs/skills/recording-marketplace-media/SKILL.md` 只负责启动真实宿主、执行原生输入、录制原始 MP4 clip 和捕获原始 checkpoint。它可以提示当前 `stop` 把关闭宿主与旧媒体导出耦合在一起，但不能承载双宽屏构图、字幕、转场、GIF storyboard、PNG Hero、语言版本或 README 发布规则。后续自动剪辑若需要 Skill，应建立独立的 editing/compositor Skill。

### 7.7 核心规则与不变量

- 所有产品 UI 像素来自真实 Extension Development Host；harness 不能作为最终素材来源。
- 两种 multi-root 形态分开真实录制；双宽屏只在后期出现，不能伪装成产品原生 split view。
- 两条 take 的 root 顺序、标题、任务和状态转换一致；每个合成 frame 的左右来源可追溯。
- GIF 的输入是经审阅的双宽屏合成 storyboard frame，不是完整 MP4 抽帧，也不是未经合成的原始 checkpoint。
- PNG 的输入是显式选定的合成 Hero frame；`PNG == GIF last frame` 不再是约束。
- PNG 从合成母版单独导出，不从 GIF 回取。
- 字幕位于 UI 框外、可完整阅读，中英文分开导出。
- 录制与剪辑职责分离：录制 Skill 只生成和记录原始素材，本文与剧本定义成片规则，未来 compositor 负责执行后期。
- 当前片不展示文件读写相关画面，也不在多 pane/thumbnail 中做仍缺真实宿主验证的 Terminal input 或跨 pane 拖拽。
- 实现和真实媒体验收完成前，不把新流程写成已验证，也不替换 README 引用。

## 8. 验证方法

### 8.1 本次设计收口

1. 检查 `docs/marketplace-media-scenario.md` 是否只有一条四 root 因果故事，且明确排除文件、diff、编辑器、模板和节点创建画面。
2. 检查剧本与本文对 root 名称、Agent/Terminal 标题、状态转换、60 秒时间线、模式标签、字幕、输出尺寸、八张 GIF frame 和 PNG Hero ID 的描述是否一致。
3. 检查 `docs/skills/recording-marketplace-media/SKILL.md` 是否只覆盖真实宿主原始录制与当前 `stop` 副作用，不重复双宽屏、字幕、GIF、Hero PNG 或语言版本等剪辑规则。
4. 检查 `docs/design-docs/index.md` 与 frontmatter 的状态和日期一致。
5. 运行 `git diff --check`，并确认本次不包含 `scripts/`、主扩展源码或现有媒体资产修改。

### 8.2 后续实现与真实媒体验收

后续 compositor 完成后，至少需要：

1. 对 manifest 解析、checkpoint pair 完整性、逐帧时长、语言变体和 Hero frame ID 选择补自动化测试；旧的“最后一帧复制 PNG”断言应被显式 Hero 断言替代。
2. 运行脚本语法检查、构建、类型检查与 `git diff --check`，并对 `ffprobe` 输出核对 MP4/GIF 分辨率、时长和帧数。
3. 在真实 Extension Development Host 分别录制 Take A / Take B，人工核对四个 root 的顺序、状态和 paired checkpoint。
4. 按 `1920x1200`、`1440x900`、README `1180px` 宽和移动端 `375px` 宽检查字幕、模式标签、UI 安全区和背景噪声。
5. 确认 attention 能在全景中发现；双击 `sideThumbnails` 缩略图只聚焦 root 且 attention 仍保留，点击 `Contract Review` 节点后才清除；提交回复后 Agent 从 waiting-input 恢复 running；Terminal pass summary 来自真实 exit code 0。
6. 检查 PNG metadata 的 Hero frame ID 为 `attention-arrives`，并确认 PNG 像素不是 GIF `all-in-view` 最后一帧的直接副本。
7. 只有上述验证完成后，才生成中文资产、更新 README 引用并把本文恢复为 `validation_status: 已验证`。

### 8.3 历史验证证据

以下证据只证明旧单宽屏真实宿主录制链路曾经可用，不证明本次双宽屏合成、语言版本或独立 Hero PNG 已实现：

- 2026-04-24：真实宿主关键帧 GIF 生成通过，产出 17 张 storyboard frame；GIF 为 `1180x738`、`11.32s`、18 帧。
- 2026-05-10：Extension Development Host、原生确认框、真实 workspaceStorage 状态读取、构建、类型检查和模板定向测试通过。
- 2026-05-11：旧 PNG、GIF 最后一帧与 MP4 尾帧重新导出并确认无 notification toast；相关脚本检查、构建、类型检查和 `ffprobe` 通过。

2026-07-14 的本次变更只完成剧本和正式媒体约定收口，没有修改录制脚本或对外资产。双宽屏 compositor、两条真实 take、字幕缩放与独立 Hero PNG 均待后续实现和验证，因此验证状态从“已验证”调整为“验证中”。
