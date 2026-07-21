# Marketplace 预览媒体录制剧本

录制方法参考：`docs/skills/recording-marketplace-media/SKILL.md`。

本剧本替代此前围绕模板、节点创建、重命名、连线、文件活动和保存模板展开的功能巡礼。当前主片只讲一个故事：四个工程正在并行推进，用户在两种 multi-root 查看方式之间切换，发现 attention、立即聚焦并完成一次真实决策。

## 传播目标

- 第一眼看懂 Dev Session Canvas 能同时承载多个工程和多个执行会话。
- 用同一工作状态左右对比 `rootGroups` 与 `paneGallery`，而不是轮播模式菜单。
- 让四个真实 Agent 同时推进，其中一个等待用户决策、另一个持续执行测试，形成真实而非摆拍的工作现场。
- 用一次“发现 attention -> 聚焦 -> 回复 -> 测试通过”完成因果闭环。
- 主片、GIF 和 PNG 都不展示文件读取、文件写入、文件节点、diff 或跳转编辑器。

## 四 Root 工作现场

四个 workspace folder 的顺序在两条源录制中保持一致，不能为了构图重新排序。

| Root | 节点 | Provider 与初始状态 | 故事中的状态变化 |
|---|---|---|---|
| `payments-api` | Agent `Contract Review` | 真实 Codex CLI 已启动并停在输入提示 | 用户提交任务后进入 `running`，真实回合完成后通过 OSC 9 进入 `waiting-input + attention`；点击 Agent 解除 attention，提交决策后恢复 `running` |
| `storefront` | Agent `UI Builder` | 真实 Claude Code CLI 已启动并停在输入提示 | 用户提交任务后进入 `running`，收尾前完成 |
| `design-system` | Agent `Component Audit` | 真实 Claude Code CLI 已启动并停在输入提示 | 用户提交任务后进入 `running`，收尾前完成 |
| `release-tools` | Agent `Release Validation` | 真实 Codex CLI 已启动并停在输入提示 | 用户提交任务后进入 `running`，Agent 真实执行测试脚本，最终返回 pass summary 与 exit code 0 |

`Contract Review` 首次提交的任务固定为：

> Review this retry-policy decision. Briefly compare equal vs full jitter, then ask me to choose one and the maximum attempts. Do not inspect files, use tools, or modify files.

`UI Builder` 提交的任务固定为：

> Outline the checkout retry states using general knowledge only. Do not inspect files, use tools, or modify files.

`Component Audit` 提交的任务固定为：

> Audit checkout retry states for accessibility using general knowledge only. Return three concise checks. Do not inspect files, use tools, or modify files.

`Release Validation` 提交的任务固定为：

> Run ./run-e2e.sh. Report pass/fail, check count, and exit code in one concise line. Do not modify files.

`Contract Review` 的 attention 问题固定为：

> Choose the retry policy: equal or full jitter, and how many attempts?

用户回复固定为：

> Use full jitter. Cap at 3 attempts.

正式素材只能使用本机已登录的真实 Codex CLI 与 Claude Code CLI，不能通过 PATH wrapper、fixture 或 fake provider 替换。任务保持短小，除 `Release Validation` 运行固定只读测试脚本外不修改文件，以降低真实网络时延与输出漂移；所有 Agent、attention、running、输入和测试结果都必须由真实 Extension Development Host 中的产品 UI 呈现，不能在后期重绘状态或伪造节点。

## 源录制

### 公共环境

- 录制宿主：非测试模式的 VS Code Extension Development Host。
- 原始宽屏：每条 `1440x900`，同一 VS Code 主题、字号、窗口尺寸和 workspace folder 顺序。
- VS Code 主题：Default Dark Modern；Peacock 颜色关闭。
- Surface：底部 Panel 最大化，扩展 activity bar 与 sidebar 保持可见。
- Workspace：只使用上述四个 root；每个 root 只保留一个真实 Agent 节点，不出现 Terminal 节点。
- Workspace 物理路径：正式录制固定使用 `/tmp/dev-session-canvas-marketplace-media/four-root-attention/workspace/` 下的中性 disposable root；公开画面不得出现维护者用户名、home 目录或仓库 worktree 绝对路径。
- 文件活动：关闭展示，不允许文件节点、文件列表节点或编辑器画面进入录制区域。
- Provider 启动：正式录制前可以依次启动四个真实 Codex / Claude Agent 并处理首次信任、登录或升级提示，但不能提前提交剧本任务；正式 clip 从四个输入提示都已就绪的 fit view 开始。
- 彩色 TUI：录制子进程固定声明 `TERM=xterm-256color` 与 `COLORTERM=truecolor`，并移除继承的 `NO_COLOR`；Codex 与 Claude 的原生 ANSI 强调色必须在源画面中可见。
- Attention 信号：`payments-api` 使用 Codex 官方一次性 TUI 配置发送 `osc9`，不修改用户全局配置；`devSessionCanvas.notifications.enabledAttentionSignals` 至少保留 `osc9`。
- Attention 呈现：把 `devSessionCanvas.notifications.attentionSignalBridge` 设为 `none`，避免 workbench/system toast；把 `devSessionCanvas.notifications.strongTerminalAttentionReminder` 设为 `both`，保留产品内标题栏与 MiniMap 提醒。
- 通知：除上述产品内 attention 表达外，不保留 VS Code notification toast。

### Take A：目录分组

把 `devSessionCanvas.canvas.multiRootPresentationMode` 设为 `rootGroups`，录制一条完整的 `1440x900` 宽屏源素材。开场执行 fit view；随后严格按 `payments-api`、`storefront`、`design-system`、`release-tools` 的顺序重复以下动作：双击节点放大、点击真实 Agent 输入区、粘贴并提交固定任务、清楚展示 `running`，再点击 fit view 回到四 root 全景。完成一个完整循环后才能开始下一个节点，不能只通过鼠标选中小节点直接输入，也不能用录制前预置的 running 状态代替可见提交。

这段源素材可以由多个同尺寸 scene clip 无缝组成，以便等待真实 provider；最终 0–19 秒剪辑必须保留四次双击、四次提交和四次 fit view 的因果顺序。最后一次回到全景后，等待 `payments-api` 的真实 Codex 回合完成并出现 attention。

源素材中不展示 Settings。模式配置在录制开始前完成。

### Take B：窗格画廊

在同一个 Extension Host 和同一组 root-local 执行状态上，把 `devSessionCanvas.canvas.multiRootPresentationMode` 热切到 `paneGallery`，录制第二条完整的 `1440x900` 宽屏源素材。先使用 `dynamic` 四 pane 全览，并把当前 active root 固定为 `storefront`；需要聚焦时，通过左下角 `eye` 进入上次记忆的 thumbnail 形态，首次固定为 `sideThumbnails`。

`payments-api` 缩略图必须双击才成为主画板。处理完 attention 后，再双击 `release-tools` 缩略图查看 `Release Validation` Agent 完成真实测试并返回简短 pass summary；不要通过外部 Terminal 节点代替 Agent 结果。最后点击 `globe` 返回 `dynamic` 四 pane 全览。

### 两条 Take 的对齐规则

- 两条 take 分开录制，不能用一条录屏复制、裁切或后期重绘出另一种产品形态。
- Take A / Take B 是两条逻辑源素材，可以由多个同尺寸 scene clip 组成；为捕获成对 checkpoint 而在片段外切换模式，不进入任何最终 clip。
- 两条 take 使用同一套真实 provider 会话、任务、root 顺序、节点标题和状态转换。
- 剧本列出的八个 Frame ID 都必须能映射到两种模式的真实 checkpoint；`attention-arrives` 与 `mode-compare` 可以复用同一对源 checkpoint，但必须分别审阅合成后的字幕与停留画面。
- 左右同屏是后期比较镜头，不是产品原生同时打开两种 multi-root 形态；任何文案都不能暗示这是同一 Webview 的双视图功能。
- MP4 左右比较必须分别消费 `rootGroups` 与 `paneGallery` 的真实连续视频，不能循环 checkpoint、冻结视频帧或用一侧视频复制出另一侧；两侧 Agent TUI、attention 或运行态动效在比较期间必须持续播放。
- Pane Gallery 的 `dynamic -> 点击 eye -> sideThumbnails -> payments-api -> 决策 -> release-tools -> 点击 globe -> dynamic` 必须来自一次不中断的真实录屏。为 GIF/PNG 捕获 checkpoint 可以发生在录制外，但不能插入 MP4 时间线。

## 54 秒主片

| 时间 | 画面与操作 | 字幕 | 录制来源 |
|---|---|---|---|
| `0-3s` | `rootGroups` fit view 全景。四个 root 一次看全，四个真实 Agent 都已启动并停在输入提示。 | `一个工作区，同时推进多项任务。` | Take A，单宽屏主画面 |
| `3-7s` | 双击放大 `payments-api / Contract Review`，在真实 Codex 输入区提交固定任务，看到 `running` 后点击 fit view 回到全览。 | 开场字幕延续至约 `4.85s` | Take A，单宽屏主画面 |
| `7-11s` | 双击放大 `storefront / UI Builder`，在真实 Claude Code 输入区提交固定任务，看到 `running` 后点击 fit view 回到全览。 | 无 | Take A，单宽屏主画面 |
| `11-15s` | 双击放大 `design-system / Component Audit`，在真实 Claude Code 输入区提交固定任务，看到 `running` 后点击 fit view 回到全览。 | 无 | Take A，单宽屏主画面 |
| `15-19s` | 双击放大 `release-tools / Release Validation`，在真实 Codex 输入区提交固定任务，看到 `running` 后点击 fit view 回到全览。Agent 在后台执行 `./run-e2e.sh`；`Contract Review` 随后以真实 OSC 9 显示 attention。 | 无 | Take A，单宽屏主画面 |
| `19-20s` | Take A 缩到左侧；同一状态的 Take B 从右侧进入。两侧连续视频同时播放，背景切换为静态四 root 拓扑图，两个模式标签与顶部项目品牌条淡入。 | `两种视图模式，按需选择。` | 两条真实连续视频的后期双宽屏合成 |
| `20-26s` | 左侧保持 `rootGroups` 全景，右侧保持 `paneGallery / dynamic` 四 pane。两侧 root 顺序、标题和状态严格对应，attention 与 TUI 动效持续播放，不得定帧；顶部品牌条保持可见，字幕约在 `25.8s` 消失，`26s` 立即进入下一转场。 | `两种视图模式，按需选择。`，结束后不再空等 | 两条真实连续视频的后期双宽屏合成 |
| `26-29s` | 鼠标清楚点击左下角 `eye` 进入 `sideThumbnails`；左侧宽屏同步退出，右侧 `paneGallery` 无透视变形地扩展为单宽屏主画面，模式标签与顶部品牌条同步退场。 | 无 | 后期转场到连续 Take B |
| `29-35s` | 双击带 attention 的 `payments-api` 缩略图，使 `Contract Review` 成为主画板；此时只切换 active root，attention 仍保留。 | `发现需要关注的会话，立即聚焦。` | Take B，单宽屏主画面 |
| `35-41s` | 点击主画板中的 `Contract Review`，真实认领并解除 attention；输入并提交 `Use full jitter. Cap at 3 attempts.`，Agent 随后从 waiting-input 恢复 running。 | 无 | Take B，单宽屏主画面 |
| `41-49.2s` | 双击 `release-tools` 缩略图。主画板中的 `Release Validation` 显示 Codex 真实执行脚本后的简短 pass summary 与 exit code 0；输出必须来自 Agent TUI，不能后期贴字或换成 Terminal 节点。 | 无 | Take B，单宽屏主画面 |
| `49.2-54s` | 点击 `globe` 返回 `dynamic` 四 pane 全览；收尾字幕与点击同步出现，并在产品自身回全览动画和动态全览期间保持可读。四个 root 仍在视野中，状态已收敛；最后 1.5 秒在顶部安全区淡入项目图标、名称和 GitHub 地址。 | `既能统览全局，也能从容聚焦。` | Take B，单宽屏主画面 + 产品落版 |

## 字幕与模式标签

### 固定文案

中文与英文分别导出，不能在同一画面上下堆叠双语字幕。

| 用途 | 中文版 | 英文版 |
|---|---|---|
| 开场 | `一个工作区，同时推进多项任务。` | `One workspace.`<br>`Multiple tasks moving in parallel.` |
| 双形态比较 | `两种视图模式，按需选择。` | `Two view modes. Choose as needed.` |
| attention 聚焦 | `发现需要关注的会话，立即聚焦。` | `Spot the session that needs you.`<br>`Focus instantly.` |
| 收尾 | `既能统览全局，也能从容聚焦。` | `See the whole picture.`<br>`Focus with ease.` |
| 左侧模式标签 | `目录分组` | `Root Groups` |
| 右侧模式标签 | `窗格画廊` | `Pane Gallery` |

产品落版固定使用仓库 `dev-session-canvas-icon.svg`、名称 `DevSessionCanvas` 与地址 `github.com/ZY-WANG-0304/dev-session-canvas`；地址不做语言本地化，也不进入主字幕区域。MP4 在双窗对比段与最后 1.5 秒显示横向品牌条；GIF 八帧都在左上安全区显示紧凑品牌角标。

### 可读性硬约束

- 字幕是画面构图的一部分，固定放在 UI 宽屏框之外的背景留白区；不得压在 Agent 输入区、测试结果、attention 或 root 标签上。
- “单宽屏主画面”不是源素材铺满最终画幅：一个真实 `16:10` 宽屏在内容区内尽可能放大，但始终保留外部字幕带。没有字幕的镜头也保留同一带宽，避免画面尺寸跳动。
- 中文每屏只显示一句、只占一行，含标点不超过 16 个全角字符；英文最多两行，每行不超过 34 个字符。
- `1920x1200` MP4/PNG 的字幕字号不小于 `80px`；`1440x900` GIF 的字幕字号不小于 `60px`。字重为 600，行高为 1.2-1.3。
- 模式标签不是字幕：`1920x1200` 不小于 `40px`，`1440x900` 不小于 `30px`，只显示模式名，不追加节点数、running 数或 attention 数。
- 英文开场固定断为 `One workspace.` 与 `Multiple tasks moving in parallel.` 两行；attention 固定断为 `Spot the session that needs you.` 与 `Focus instantly.` 两行；收尾固定断为 `See the whole picture.` 与 `Focus with ease.` 两行。双形态字幕保持单行，不能交给导出器自动换行。
- 每句视频字幕完整停留至少 `2.6s`；淡入淡出各不超过 `180ms`。GIF 中承载完整句子的静态帧至少停留 `2.2s`。
- 不使用逐字打字、全大写英文、状态计数器、滚动字幕或同时出现两句主字幕。
- 字幕与背景的对比度至少达到 `4.5:1`。默认使用 `Noto Sans CJK SC`；导出前必须验证字体已实际加载，不能静默回退到窄字形或缺字字体。
- 人工验收时必须分别按 `1180px` README 常见宽度和 `375px` 移动端宽度预览；两种尺寸下都应先读懂字幕，再看产品细节。

## 双宽屏合成画面

- 合成母版：`2560x1600`；MP4/PNG 目标导出为 `1920x1200`，GIF 目标导出为 `1440x900`。
- 主片所有阶段都在该母版中构图：单宽屏阶段只显示一个放大的真实宽屏，双宽屏阶段显示两个缩小宽屏；两者都保留 UI 框外字幕带。
- 两个源宽屏保持原始 `16:10` 比例，不裁掉 VS Code 宿主外框，不使用透视倾斜、3D 旋转或假景深。
- 在母版中，每个宽屏使用 `1120x700`，左右外边距各 `120px`，中间间距 `80px`。模式标签位于各自宽屏上方，主字幕位于下方独立安全区。
- 背景使用静态、低噪声的四 root 拓扑图：石墨色底，克制的青绿/蓝色连线与四个抽象区域。背景不出现照片、人物、粒子、噪点动画或通用炫光渐变。
- 后期只允许增加背景、窗口框、模式标签、字幕、产品落版和转场；Agent、root、attention、running 及其内容必须来自真实录制像素。
- 两段窗口转场必须在固定输出画布中同时、连续地插值位置与尺寸：单 Root Groups 到双视图为 1 秒，双视图到单 Pane Gallery 为 3 秒；不得先平移后跳变缩放，也不得先缩放后跳变位置。
- 两个宽屏的状态不一致时不能合成。必须回到对应 checkpoint 重录，而不是在后期替换状态 pill 或节点标题。

## GIF Storyboard

GIF 不从 MP4 均匀抽帧，也不使用未经审阅的原始截图。八张 frame 使用三种明确构图：先以 Root Groups 单画面建立全局工作现场，中间用双宽屏解释两种模式，最后以 Pane Gallery 单画面讲聚焦、决策和验证。每张 frame 仍保留同状态的左右 checkpoint 来源，但单模式 frame 只选择与当前叙事对应的一侧，不把另一侧缩小塞入画面。项目图标、名称和 GitHub 地址组成的紧凑品牌角标固定在左上 UI 框外安全区，八帧位置与尺寸保持一致。

| 顺序 | Frame ID | 构图 | 内容 | 字幕 | 停留 |
|---|---|---|---|---|---|
| 1 | `overview-start` | Root Groups 单画面 | 四 root 开场；`UI Builder` 输入已准备 | 无 | `0.8s` |
| 2 | `all-running` | Root Groups 单画面 | 四个 Agent 均已提交并处于 running，`Release Validation` 正在执行测试 | 无 | `0.7s` |
| 3 | `attention-arrives` | 双模式对比 | `Contract Review` attention 在两种形态中同时可见 | `两种视图模式，按需选择。` | `2.2s` |
| 4 | `mode-compare` | 双模式对比 | 两个模式标签与完整四 root 对比稳定可读 | 无 | `0.7s` |
| 5 | `attention-focused` | Pane Gallery 单画面 | `sideThumbnails` 放大展示并聚焦 `payments-api`，尚未点击 Agent；该帧的成对 checkpoint 同时作为 PNG Hero 的真实产品画面来源 | `发现需要关注的会话，立即聚焦。` | `2.4s` |
| 6 | `decision-submitted` | Pane Gallery 单画面 | Agent 已在点击时清除 attention；决策提交后恢复 running | 无 | `0.8s` |
| 7 | `tests-passed` | Pane Gallery 单画面 | 放大展示真实 `Release Validation` Agent pass summary 与 exit code 0 | 无 | `0.8s` |
| 8 | `all-in-view` | Pane Gallery 单画面 | `dynamic` 四 pane 收尾；左上固定品牌角标继续保留，不额外重复底部大号落版 | 无 | `1.6s` |

目标总时长为 `10.0s`。如果文件体积超限，优先减少颜色或轻量缩短非字幕帧；不能删除 `attention-arrives`、`attention-focused` 或把字幕帧压到最低停留时间以下。

## PNG Hero

- PNG 不复制 GIF 最后一帧，也不直接缩放任一 GIF frame。它使用 `attention-focused` 的同一对真实 checkpoint 独立合成静态 Hero；`all-in-view` 仍只负责 GIF 收尾。
- 左右产品窗口严格保持 50/50：母版中各为 `1200x750`，模式说明 top 为 `400px`，窗口 top 为 `550px`，底部保留 `300px` 背景留白；左侧 `目录分组`、右侧 `窗格画廊`，四个 root 对应一致，`payments-api` attention 明确可见。右侧必须展示 `payments-api` 主任务和其他 root 的 `sideThumbnails`，不能退回 `dynamic` 四 pane 全览。左右同屏仍是后期比较，不暗示产品原生同时打开两种模式。
- Hero 左上品牌组使用仓库 `dev-session-canvas-icon.svg`、`DevSessionCanvas` 产品名与 GitHub 地址，右上保留说明 `VS Code 多 Agent 协作工作台` / `Multi-agent workbench for VS Code`。
- Hero 中文主标题为 `所有 Agent，跨根目录汇聚于一张画布。`，英文为 `Every agent. Every root. One canvas.`。这里必须使用 root / 根目录，不能把一个 folder 写成 workspace 或 repository。
- 目录分组说明为 `各根目录的会话，平铺在同一张画布中。` / `Sessions from every root, tiled together on one canvas.`。
- 窗格画廊说明为 `兼顾单任务聚焦与全局任务掌控。` / `Focus on one task while staying in control of the rest.`；不使用会暗示自动质量检测的“质检”。
- Hero 底部不再重复列出三项能力，也不使用编号、图标、箭头、卡片或流程轨道。平铺、聚焦与全局掌控的含义只由左右模式说明承担，释放的空间用于放大真实产品画面和保留克制留白。
- Hero 品牌、主标题、模式说明和能力标签均位于真实 UI 框之外，不遮挡 Agent、attention、root 标签或输入区；必须分别检查 `1920px`、`1180px` 与 `375px` 缩放结果。
- PNG 必须从合成母版单独导出，不能从 GIF 解码回取，以免继承 GIF 调色板和抖动损失。

## 语言版本与目标资产

当前命名是后续 compositor 的目标约定，尚未由录制脚本实现：

- 英文默认资产：`canvas-overview.mp4`、`canvas-overview.gif`、`canvas-overview.png`。
- 中文资产：`canvas-overview.zh-CN.mp4`、`canvas-overview.zh-CN.gif`、`canvas-overview.zh-CN.png`。
- 英文 Marketplace README 继续使用默认 PNG/MP4；根 `README.md` 使用默认 GIF；`README.zh-CN.md` 在中文资产生成并验收后改用 `canvas-overview.zh-CN.gif`。

## 录制验收

- 四个 root 名称、顺序、节点标题和状态转换与本剧本一致。
- Take A 中四个 Agent 都必须完整可见“双击放大 -> 点击输入 -> 提交 -> running -> fit view”；每轮从全览开始并回到全览，不能以选中小节点后直接输入或预置运行状态替代。
- 正式 Agent 像素和输出必须同时可辨认 Codex 与 Claude Code；session metadata 记录真实 provider 分工，不得出现 `[fake-agent]`、`[fake-claude]`、fake session id 或 `provider-bin` wrapper 路径。
- 画面中没有文件节点、文件列表、源码、diff、编辑器跳转、模板表单或节点创建菜单。
- Take A 与 Take B 都是完整 `1440x900` 的真实宿主录制；双宽屏画面明确是后期合成。
- MP4 `19-26s` 的左右窗口都来自连续视频，并经跨帧像素检查证明不是固定帧；GIF/PNG 可以继续使用成对真实 checkpoint。
- `payments-api` attention 在全景中可发现；双击缩略图只聚焦 root 且 attention 仍保留，随后点击 `Contract Review` 节点才真实清除 attention，提交回复后从 waiting-input 恢复 running。
- Pane Gallery 故事在同一条连续 clip 中清楚展示鼠标点击 `eye`、聚焦后的持续 TUI、鼠标点击 `globe` 和产品布局动画回到 `dynamic`；任何一次点击或动画只能从前后 checkpoint 推断都不算通过。
- 双形态字幕最后可见帧到 Pane Gallery 转场开始不超过 `0.3s`；收尾字幕首次可见帧与 `globe` 点击相差不超过 `0.3s`，并在点击后保持至少约 `4s`。
- `release-tools` 必须是 Codex Agent；pass summary 来自它真实执行 `./run-e2e.sh` 后的 TUI 输出和 exit code 0，不在后期贴字，也不保留 Terminal 节点。
- Codex 与 Claude 的源画面都能看到 provider 原生 ANSI 强调色；只有节点边框有颜色、TUI 字体全部单色不算通过。
- 两段主窗口转场逐帧连续，位置和尺寸沿同一 easing 同时变化；任一单帧缩放跳变都必须返工。
- GIF 的八张 frame 均有左右 checkpoint 来源记录；PNG metadata 记录显式 Hero frame ID，而不是“last frame”。
- GIF 第 1-2 帧只显示 Root Groups 大画面，第 3-4 帧显示双模式，第 5-8 帧只显示 Pane Gallery 大画面；Pane Gallery 聚焦字幕不得继续覆盖双窗对比构图。
- GIF 八帧左上固定品牌角标使用 `extensions/vscode/dev-session-canvas/images/dev-session-canvas-icon.svg`、`DevSessionCanvas` 与固定 GitHub 地址；禁止另画近似图标、继续使用 `DSC` 占位字标或在最后一帧重复第二套大号落版。
- MP4 顶部品牌条、GIF 左上固定角标与 PNG 左上品牌组都必须同时包含项目图标、名称和 GitHub 地址；三者分别适配各自安全区，不能遮挡真实产品像素。MP4 品牌条在 `19-26s` 双窗对比中保持可见，进入 Pane Gallery 单窗时随模式标签平滑淡出，并在最后 1.5 秒重新淡入。
- 中英文分别检查字幕字体、断行、停留时长和安全区；375px 预览下仍能完整读完主字幕。
- 最终素材无 notification toast、鼠标遮挡、调试 overlay、录制工具窗口或未经说明的测试控制 UI。
- 最终六份公开资产不得出现维护者用户名、`/home/users`、当前仓库绝对路径、认证路径或其他本机环境标识；该项每次制作通过临时帧检查和人工审阅确认，不固化为长期素材测试脚本。

## 明确不拍

- 文件读取、文件写入、文件活动、文件节点、文件列表、源码、diff 和编辑器跳转。
- 右键创建节点、provider picker、启动模式选择、模板重置、模板保存和关系连线教学。
- Settings 中切换 `rootGroups` / `paneGallery` 的过程。
- 把左右双宽屏伪装成产品内原生 split view。
- `paneGallery` 四种内部布局轮播；主片只使用 `dynamic` 与 `sideThumbnails` 两个有叙事作用的状态。
- Terminal 节点、在多 pane 或 thumbnail 中输入命令、跨 pane 拖拽或跨 root 连线。
