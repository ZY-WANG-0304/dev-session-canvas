# Marketplace 预览媒体录制剧本

录制方法参考：`docs/skills/recording-marketplace-media/SKILL.md`。

本剧本替代此前围绕模板、节点创建、重命名、连线、文件活动和保存模板展开的功能巡礼。当前主片只讲一个故事：四个工程正在并行推进，用户在两种 multi-root 查看方式之间切换，发现 attention、立即聚焦并完成一次真实决策。

## 传播目标

- 第一眼看懂 Dev Session Canvas 能同时承载多个工程和多个执行会话。
- 用同一工作状态左右对比 `rootGroups` 与 `paneGallery`，而不是轮播模式菜单。
- 让 Agent running、attention 和正在执行测试的 `live` Terminal 同时存在，形成真实而非摆拍的工作现场。
- 用一次“发现 attention -> 聚焦 -> 回复 -> 测试通过”完成因果闭环。
- 主片、GIF 和 PNG 都不展示文件读取、文件写入、文件节点、diff 或跳转编辑器。

## 四 Root 工作现场

四个 workspace folder 的顺序在两条源录制中保持一致，不能为了构图重新排序。

| Root | 节点 | 初始状态 | 故事中的状态变化 |
|---|---|---|---|
| `payments-api` | Agent `Contract Review` | `running` | 进入 `waiting-input + attention`；点击 Agent 解除 attention，提交决策后恢复 `running` |
| `storefront` | Agent `UI Builder` | 输入已准备、尚未提交 | 用户提交任务后进入 `running`，收尾前完成 |
| `design-system` | Agent `Component Audit` | `running` | 持续执行，收尾前完成 |
| `release-tools` | Terminal `E2E Tests` | `live`，测试命令正在执行 | 预先启动的真实测试命令最终以 exit code 0 收口 |

`UI Builder` 提交的任务固定为：

> Implement the checkout retry states. Reuse the existing design-system components.

`Contract Review` 的 attention 问题固定为：

> Choose the retry policy: equal or full jitter, and how many attempts?

用户回复固定为：

> Use full jitter. Cap at 3 attempts.

录制可以使用 deterministic provider 保证状态和文案可重复，但所有 Agent、Terminal、attention、running 和输入结果都必须由真实 Extension Development Host 中的产品 UI 呈现，不能在后期重绘状态或伪造节点。

## 源录制

### 公共环境

- 录制宿主：非测试模式的 VS Code Extension Development Host。
- 原始宽屏：每条 `1440x900`，同一 VS Code 主题、字号、窗口尺寸和 workspace folder 顺序。
- VS Code 主题：Default Dark Modern；Peacock 颜色关闭。
- Surface：底部 Panel 最大化，扩展 activity bar 与 sidebar 保持可见。
- Workspace：只使用上述四个 root；每个 root 只保留一个主执行节点。
- 文件活动：关闭展示，不允许文件节点、文件列表节点或编辑器画面进入录制区域。
- Attention 信号：录制 fixture 固定发送 `osc9`；`devSessionCanvas.notifications.enabledAttentionSignals` 至少保留 `osc9`。
- Attention 呈现：把 `devSessionCanvas.notifications.attentionSignalBridge` 设为 `none`，避免 workbench/system toast；把 `devSessionCanvas.notifications.strongTerminalAttentionReminder` 设为 `both`，保留产品内标题栏与 MiniMap 提醒。
- 通知：除上述产品内 attention 表达外，不保留 VS Code notification toast。

### Take A：组合画布

把 `devSessionCanvas.canvas.multiRootPresentationMode` 设为 `rootGroups`，录制一条完整的 `1440x900` 宽屏源素材。四个系统 root 分组同时可见，开场执行 fit view；随后聚焦 `storefront` 提交任务，再回到四 root 全景等待 `payments-api` 出现 attention。

源素材中不展示 Settings。模式配置在录制开始前完成。

### Take B：窗格画廊

在同一个 Extension Host 和同一组 root-local/live 状态上，把 `devSessionCanvas.canvas.multiRootPresentationMode` 热切到 `paneGallery`，录制第二条完整的 `1440x900` 宽屏源素材。先使用 `dynamic` 四 pane 全览，并把当前 active root 固定为 `storefront`；需要聚焦时，通过左下角 `eye` 进入上次记忆的 thumbnail 形态，首次固定为 `sideThumbnails`。

`payments-api` 缩略图必须双击才成为主画板。处理完 attention 后，再双击 `release-tools` 缩略图查看已经运行的真实测试命令收口；不要在 thumbnail 或多 pane 画面里输入 Terminal 命令。最后点击 `globe` 返回 `dynamic` 四 pane 全览。

### 两条 Take 的对齐规则

- 两条 take 分开录制，不能用一条录屏复制、裁切或后期重绘出另一种产品形态。
- Take A / Take B 是两条逻辑源素材，可以由多个同尺寸 scene clip 组成；为捕获成对 checkpoint 而在片段外切换模式，不进入任何最终 clip。
- 两条 take 使用同一套 deterministic 任务、root 顺序、节点标题和状态转换。
- 剧本列出的八个 Frame ID 都必须能映射到两种模式的真实 checkpoint；`attention-arrives` 与 `mode-compare` 可以复用同一对源 checkpoint，但必须分别审阅合成后的字幕与停留画面。
- 左右同屏是后期比较镜头，不是产品原生同时打开两种 multi-root 形态；任何文案都不能暗示这是同一 Webview 的双视图功能。

## 60 秒主片

| 时间 | 画面与操作 | 字幕 | 录制来源 |
|---|---|---|---|
| `0-5s` | `rootGroups` fit view 全景。四个 root 一次看全；`Contract Review`、`Component Audit` 正在运行，`E2E Tests` 为 `live` 且测试正在执行，`UI Builder` 输入已准备。 | `四个工程，同时在推进。` | Take A，单宽屏主画面 |
| `5-13s` | 平滑聚焦 `storefront`，提交预置任务。`UI Builder` 明确进入 running；不打开文件、不展示 diff。 | 无 | Take A，单宽屏主画面 |
| `13-19s` | 回到四 root 全景。`payments-api / Contract Review` 进入 `waiting-input + attention`，其他执行继续推进。镜头暂不处理 attention，让观众先看到真实并行状态。 | 无 | Take A，单宽屏主画面 |
| `19-26s` | Take A 缩到左侧；同一状态的 Take B 从右侧进入。背景切换为静态四 root 拓扑图，两个模式标签出现。 | `同一个工作区，两种查看方式。` | 后期双宽屏合成 |
| `26-35s` | 左侧保持 `rootGroups` 全景，右侧保持 `paneGallery / dynamic` 四 pane。两侧 root 顺序、标题和状态严格对应；attention 在两种视角里都真实可见。 | 无；保留模式标签 | 后期双宽屏合成 |
| `35-38s` | 左侧宽屏退出，右侧 `paneGallery` 无透视变形地扩展为单宽屏主画面。模式标签退场；低噪声背景与外部字幕带继续保留。 | 无 | 后期转场到 Take B |
| `38-44s` | 点击左下角 `eye` 进入 `sideThumbnails`。双击带 attention 的 `payments-api` 缩略图，使 `Contract Review` 成为主画板；此时只切换 active root，attention 仍保留。 | `发现需要关注的会话，立即聚焦。` | Take B，单宽屏主画面 |
| `44-50s` | 点击主画板中的 `Contract Review`，真实认领并解除 attention；输入并提交 `Use full jitter. Cap at 3 attempts.`，Agent 随后从 waiting-input 恢复 running。 | 无 | Take B，单宽屏主画面 |
| `50-55s` | 双击 `release-tools` 缩略图。主画板中的 `E2E Tests` 显示真实命令结束与简短 pass summary；输出必须来自 Terminal 进程，不能后期贴字。 | 无 | Take B，单宽屏主画面 |
| `55-60s` | 点击 `globe` 返回 `dynamic` 四 pane 全览。四个 root 仍在视野中，状态已收敛；最后 1.5 秒淡入产品名。 | `每个 Agent，都在视野里。` | Take B，单宽屏主画面 + 产品落版 |

## 字幕与模式标签

### 固定文案

中文与英文分别导出，不能在同一画面上下堆叠双语字幕。

| 用途 | 中文版 | 英文版 |
|---|---|---|
| 开场 | `四个工程，同时在推进。` | `Four projects, moving in parallel.` |
| 双形态比较 | `同一个工作区，两种查看方式。` | `One workspace. Two working views.` |
| attention 聚焦 | `发现需要关注的会话，立即聚焦。` | `Spot the session that needs you.`<br>`Focus instantly.` |
| 收尾 | `每个 Agent，都在视野里。` | `Every agent stays in view.` |
| 左侧模式标签 | `组合画布` | `Root Groups` |
| 右侧模式标签 | `窗格画廊` | `Pane Gallery` |

### 可读性硬约束

- 字幕是画面构图的一部分，固定放在 UI 宽屏框之外的背景留白区；不得压在 Terminal 输出、Agent 输入区、attention 或 root 标签上。
- “单宽屏主画面”不是源素材铺满最终画幅：一个真实 `16:10` 宽屏在内容区内尽可能放大，但始终保留外部字幕带。没有字幕的镜头也保留同一带宽，避免画面尺寸跳动。
- 中文每屏只显示一句、只占一行，含标点不超过 16 个全角字符；英文最多两行，每行不超过 34 个字符。
- `1920x1200` MP4/PNG 的字幕字号不小于 `80px`；`1440x900` GIF 的字幕字号不小于 `60px`。字重为 600，行高为 1.2-1.3。
- 模式标签不是字幕：`1920x1200` 不小于 `40px`，`1440x900` 不小于 `30px`，只显示模式名，不追加节点数、running 数或 attention 数。
- attention 英文字幕固定断成两行：第一行 `Spot the session that needs you.`，第二行 `Focus instantly.`，不能交给导出器自动换行。
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
- 后期只允许增加背景、窗口框、模式标签、字幕、产品落版和转场；Agent、Terminal、root、attention、running 及其内容必须来自真实录制像素。
- 两个宽屏的状态不一致时不能合成。必须回到对应 checkpoint 重录，而不是在后期替换状态 pill 或节点标题。

## GIF Storyboard

GIF 不从 MP4 均匀抽帧，也不使用未经审阅的原始截图。以下每一项都是一张双宽屏合成帧，左右 UI 分别来自同一状态点的真实 Take A / Take B checkpoint。

| 顺序 | Frame ID | 内容 | 字幕 | 停留 |
|---|---|---|---|---|
| 1 | `overview-start` | 四 root 开场；`UI Builder` 输入已准备 | 无 | `0.8s` |
| 2 | `all-running` | `UI Builder` 已提交，三个 Agent running，Terminal `live` 且测试正在执行 | 无 | `0.7s` |
| 3 | `attention-arrives` | `Contract Review` attention 在两种形态中同时可见 | `同一个工作区，两种查看方式。` | `2.2s` |
| 4 | `mode-compare` | 两个模式标签与完整四 root 对比稳定可读 | 无 | `0.7s` |
| 5 | `attention-focused` | 左侧保持全景，右侧 `sideThumbnails` 聚焦 `payments-api`，尚未点击 Agent | `发现需要关注的会话，立即聚焦。` | `2.4s` |
| 6 | `decision-submitted` | Agent 已在点击时清除 attention；决策提交后恢复 running | 无 | `0.8s` |
| 7 | `tests-passed` | 右侧聚焦真实 Terminal pass summary，左侧保留全局状态 | 无 | `0.8s` |
| 8 | `all-in-view` | 四 pane 收尾与产品落版 | 无 | `1.6s` |

目标总时长为 `10.0s`。如果文件体积超限，优先减少颜色或轻量缩短非字幕帧；不能删除 `attention-arrives`、`attention-focused` 或把字幕帧压到最低停留时间以下。

## PNG Hero

- PNG 不再复制 GIF 最后一帧。
- 默认 Hero 为显式审阅通过的 `attention-arrives` 双宽屏合成帧：左侧 `组合画布`、右侧 `窗格画廊`，四个 root 对应一致，`payments-api` attention 明确可见。
- Hero 主句使用“同一个工作区，两种查看方式。”及其英文版本；不叠加“发现需要关注的会话，立即聚焦。”，避免一张静态图同时承担两个叙事动作。
- `all-in-view` 仍是 GIF 最后一帧，但它不是 PNG 的默认来源。只有人工评审明确更换 Hero frame ID 后，PNG 才能切换到另一张合成帧。
- PNG 必须从合成母版单独导出，不能从 GIF 解码回取，以免继承 GIF 调色板和抖动损失。

## 语言版本与目标资产

当前命名是后续 compositor 的目标约定，尚未由录制脚本实现：

- 英文默认资产：`canvas-overview.mp4`、`canvas-overview.gif`、`canvas-overview.png`。
- 中文资产：`canvas-overview.zh-CN.mp4`、`canvas-overview.zh-CN.gif`、`canvas-overview.zh-CN.png`。
- 英文 Marketplace README 继续使用默认 PNG/MP4；根 `README.md` 使用默认 GIF；`README.zh-CN.md` 在中文资产生成并验收后改用 `canvas-overview.zh-CN.gif`。

## 录制验收

- 四个 root 名称、顺序、节点标题和状态转换与本剧本一致。
- 画面中没有文件节点、文件列表、源码、diff、编辑器跳转、模板表单或节点创建菜单。
- Take A 与 Take B 都是完整 `1440x900` 的真实宿主录制；双宽屏画面明确是后期合成。
- `payments-api` attention 在全景中可发现；双击缩略图只聚焦 root 且 attention 仍保留，随后点击 `Contract Review` 节点才真实清除 attention，提交回复后从 waiting-input 恢复 running。
- `release-tools` 的 pass summary 来自真实 Terminal 命令和 exit code 0；不在后期贴字，不在 thumbnail 中输入命令。
- GIF 的八张 frame 均有左右 checkpoint 来源记录；PNG metadata 记录显式 Hero frame ID，而不是“last frame”。
- 中英文分别检查字幕字体、断行、停留时长和安全区；375px 预览下仍能完整读完主字幕。
- 最终素材无 notification toast、鼠标遮挡、调试 overlay、录制工具窗口或未经说明的测试控制 UI。

## 明确不拍

- 文件读取、文件写入、文件活动、文件节点、文件列表、源码、diff 和编辑器跳转。
- 右键创建节点、provider picker、启动模式选择、模板重置、模板保存和关系连线教学。
- Settings 中切换 `rootGroups` / `paneGallery` 的过程。
- 把左右双宽屏伪装成产品内原生 split view。
- `paneGallery` 四种内部布局轮播；主片只使用 `dynamic` 与 `sideThumbnails` 两个有叙事作用的状态。
- 在多 pane 或 thumbnail 中输入 Terminal、跨 pane 拖拽或跨 root 连线。
