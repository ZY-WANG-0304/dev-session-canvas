---
name: recording-marketplace-media
description: Use when the user asks to record raw Marketplace preview source video or capture recording checkpoints for the Dev Session Canvas VS Code extension. This skill covers real Extension Development Host capture only; it does not cover editing, compositing, subtitles, GIF assembly, PNG Hero selection, or publishing.
---

# Recording Marketplace Media

## Overview

这个 Skill 只负责录制：启动真实 VS Code Extension Development Host，按 `docs/marketplace-media-scenario.md` 准备画面，通过原生输入执行操作，并把每个场景保存为原始 MP4 clip 或观察 checkpoint。

它不负责把原始素材剪成最终宣传片。时间线取舍、双宽屏合成、背景、字幕、转场、GIF 帧顺序与时长、PNG Hero、语言版本和 README 接入均不属于本 Skill。

## 职责边界

本 Skill 包含：

- 启动和停止真实录制宿主。
- 在录制外准备 scenario 要求的 workspace、配置和初始状态。
- 定位 UI，使用原生鼠标、键盘和剪贴板完成用户可见操作。
- 分段录制原始 MP4 clip。
- 抓取用于观察、对齐或审阅的原始 PNG checkpoint。
- 记录每条 take 的宿主、分辨率、模式、场景标签和源文件路径。

本 Skill 不包含：

- 决定最终 MP4 的镜头顺序、裁切点或时长。
- 把多个 take 放入同一画面，或增加背景、窗口框、模式标签和转场。
- 设计、排版或烧录字幕。
- 选择、排序和定时 GIF storyboard frame。
- 选择或导出 PNG Hero。
- 生成中英文等语言版本。
- 修改 README 引用、打包规则或发布资产。

这些结论以录制剧本和正式媒体设计为准；如果后续需要自动剪辑，应建立独立的编辑/compositor 工具与对应 Skill，而不是继续扩张本文件。

## 录制工作流

```text
阅读当前场景
  -> start [--scenario]
  -> 在录制外准备和定位
  -> record-start
  -> 用原生输入完成场景动作
  -> 等待本 clip 要表达的可见结果完整出现
  -> record-stop
  -> 在录制外截图、检查和记录
  -> 重复下一场景或下一条 take
  -> close
```

1. 完整阅读 `docs/marketplace-media-scenario.md`，只从中提取本次要录制的源画面、动作、状态和原始分辨率；不要把其中的后期剪辑说明写回本 Skill。
2. 运行 `node scripts/media/recording-session.mjs start` 启动环境；四 root 剧本使用 `start --scenario four-root-attention`。也可使用兼容入口 `npm run generate:marketplace-media -- start`。
3. 等待 session 文件出现并确认真实画布已加载。场景初始化、Settings 配置、坐标定位和试操作必须发生在录制外。
4. 运行 `record-start`，只录用户实际会看到的操作及必要的短暂状态稳定过程。
5. 通过 `click`、`key`、`paste` 等原生输入完成本场景操作，并继续录到剧本要求的可见结果与必要稳定时间完整结束。确认这个 clip 的叙事单元已经录制完成后，再运行 `record-stop`。
6. 在录制停止后使用 `screenshot`、`state` 或 `checkpoint <frame-id> --take <take>` 检查并记录画面；发现问题时重录当前 clip，不在后期伪造产品状态。
7. 同一剧本需要多条 take 时，分别录制完整分辨率源素材，并记录它们对应的 presentation mode、场景和稳定状态点。
8. 所有 clip 录制完毕后执行 `close`（或 `npm run recording:close`），只关闭宿主并保留源素材。只有明确要运行历史单宽屏导出时才使用 `stop`。

## 命令参考

所有命令以 `node scripts/media/recording-session.mjs` 为前缀；兼容入口为 `npm run generate:marketplace-media -- <command>`。

| 命令 | 录制用途 |
|---|---|
| `start [--scenario four-root-attention]` | 启动 Xvfb、窗口管理器和真实 VS Code Extension Development Host；正式四 root 场景会归档旧证据、在 `/tmp/dev-session-canvas-marketplace-media/four-root-attention/` 准备不含个人标识的 disposable workspace，并从系统 PATH 启动已登录的真实 Codex / Claude Code |
| `screenshot` | 抓取当前宿主截图，用于录制外观察与审阅 |
| `locate <selector>` | 通过 CDP 定位 workbench DOM 元素，返回屏幕坐标 JSON |
| `click <x> <y> [--right] [--double]` | 发送原生鼠标点击 |
| `move <x> <y>` | 发送原生鼠标移动；用于在抓帧前移开鼠标，不产生点击 |
| `key <combo>` | 发送原生按键，例如 Return、Escape、Ctrl+A、Shift+Insert |
| `paste <text>` | 通过 X11 clipboard 粘贴文本 |
| `state` | 读取画布节点/边状态，只用于录制外观察 |
| `set-mode rootGroups\|paneGallery` | 在录制片段外热切 multi-root presentation mode，并同步 session metadata |
| `trigger <name>` | 触发当前 scenario 的外部 deterministic fixture 收口文件；可见结果仍必须经真实进程与产品 UI 进入宿主，不能用于生成 Agent 输出 |
| `record-start [--take <take> --scene <label>]` | 开始原始 MP4 scene clip；带标签时写入 `sources/<take>/<label>.mp4` 和 clip metadata |
| `record-sequence --take <take> --scene <label> --actions <json>` | 在一条 scene 内按受限 JSON 顺序执行 wait/click/paste/key/move 原生输入并自动停止，适合消除多次 CLI 调用之间的空白；仍然只能驱动真实宿主 UI |
| `record-stop` | 在当前场景动作、可见结果和必要稳定时间都录制完成后，停止 scene clip |
| `checkpoint <frame-id> --take <take>` | 抓取带 take、状态、宿主几何和 DOM 摘要的原始 PNG/JSON checkpoint |
| `gif-frame <label>` | 以历史命令名抓取一张原始 PNG checkpoint；本 Skill 不决定它是否进入 GIF |
| `close` | 停止录制宿主，不导出或覆盖正式媒体资产 |
| `stop` | 兼容历史单宽屏流程；停止宿主并触发旧媒体导出副作用 |
| `command <cmd> [json_args]` | 仅限旧测试宿主；真实录制环境拒绝 |
| `dispatch <json>` | 仅限旧测试宿主；真实录制环境拒绝 |

不带子命令运行 `npm run generate:marketplace-media` 时只输出交互式录制提示，不会自动完成剧本。

## 关键技巧

### 真实环境优先

正式 `four-root-attention` 场景不允许把 `provider-bin` 或 fake provider 放到 PATH 前面。录制器保留隔离 VS Code profile，并只引用现有 Codex / Claude 配置位置；不能把认证内容复制进仓库、session metadata 或日志。真实 CLI 的首次登录、信任、升级提示和启动等待都应在 `record-start` 之前处理，剧本任务本身必须在正式 clip 内通过原生输入提交。

- `start` 启动的是非测试模式的 VS Code Extension Development Host，应尽量保持与真实用户环境一致。
- 除场景初始化外，录制过程不要用 `command`、`dispatch` 或直接改状态来绕过 UI。
- VS Code 原生确认框、Quick Input 和右键菜单都应作为真实交互录入视频；使用 `click`、`key`、`paste` 完成。
- `locate`、`screenshot`、`state` 只用于观察和定位，不应替代用户操作。
- deterministic provider wrapper 可以稳定 provider 输出，但这是录制边界；必须在 PR 或验证说明中披露，不能写成真实在线 CLI 输出。
- `trigger` 只能控制外部 deterministic fixture 的完成时机，不能直接写 Webview state；Agent、Terminal、attention 与 running 仍须通过真实 PTY / OSC 信号和产品 UI 呈现。fixture 可以由真实 Agent 启动，但 trigger 不能代替 Agent 提交任务或生成其汇总文本。
- `record-start` 应覆盖当前 clip 的完整叙事单元；完成输入动作后继续录制，直到剧本要求的可见结果和必要稳定时间完整结束，再执行 `record-stop`。

### 定位元素坐标

- workbench 级元素，例如侧栏按钮和对话框，使用 `locate` 定位。
- canvas 内部元素，例如右键菜单项，优先使用 `screenshot` 观察后判断坐标。
- `locate` 需要连接 CDP，通常耗时 2-3 秒；右键菜单可能在此期间关闭，因此不要依赖它定位短暂菜单。
- 所有示例坐标都受窗口位置、sidebar 宽度和 VS Code 版本影响；每次录制先用当前 session 截图复核，不能把历史坐标当成稳定 API。

### 右键菜单坐标计算

- canvas iframe 在窗口中的位置可通过 CDP 获取，历史典型值为 `x=348, y=65`。
- 屏幕坐标 = 窗口偏移 + iframe 偏移 + iframe 内坐标。历史窗口偏移为 `(140,140)` 时，iframe 左上角约为 `(488,205)`。
- 右键点击位置必须在 iframe 范围内；历史录制常用 `(800,500)` 附近的空白区域。
- 菜单位置由 `resolveContextMenuPosition` 根据 iframe 内 anchor 和边界裁剪决定。
- 历史菜单项相对菜单左上角的参考偏移：
  - `create-note`: `(124,60)`
  - `create-terminal`: `(124,104)`
  - `create-agent-codex`: `(124,148)`
  - `create-agent-claude`: `(124,190)`
  - `show-claude-launch-modes`: `(220,190)`
  - `show-reset-template-picker`: `(230,310)`
- 最终点击坐标仍需按“iframe 屏幕偏移 + 当前菜单位置 + 菜单项偏移”计算，并用截图确认菜单没有被边界翻转或裁剪。

### 状态操作

- `setPersistedState` 只用于录制开始前初始化画布状态，或剧本明确要求在片段外切换到另一条故事线的初始状态。
- 录制片段中的状态变化应优先由 `click`、`key`、`paste` 等真实 UI 操作产生，不能用 `setPersistedState` 制造不自然突变。
- `command`、`dispatch` 不用于真实录制片段；真实 Extension Development Host 当前会拒绝旧测试宿主控制通道。如某个初始化工具只在旧测试宿主可用，不得假装它能驱动正式录制。
- `setPersistedState` 不能安全删除带活跃运行时的节点。
- `file-list` 类型节点由运行时动态创建，不能通过 persisted state 伪造。
- 旧测试消息 `{type: "webview/updateNodeTitle", payload: {nodeId, title}}` 只用于理解历史工具协议，不是正式录制中的重命名路径。

### 其他录制注意事项

- 环境启动后通常需要等待 15-30 秒，直到 session 文件出现并且真实画布完成加载。
- 模态对话框是录制内容的一部分；剧本要求确认时，应使用真实鼠标或键盘完成，不能绕过。
- 鼠标滚轮在 X11 原生输入中的历史映射为 `button 5` 向下滚动；使用前仍需在当前环境验证。
- 剧本要求保存模板时，`saveCanvasAsTemplate` 会打开 Quick Input，可使用 `paste` 输入名称，再用 `key Return` 确认。
- 捕获最终源镜头或 checkpoint 前，应等待或关闭无关 VS Code notification，避免 toast 遮挡画布、状态或 MiniMap。

## 真实录制约束

- `start` 必须启动非测试模式的 Extension Development Host，最终源画面不能来自普通浏览器 harness。
- 录制片段内只用原生输入完成用户可见操作；`locate`、`screenshot` 和 `state` 只能用于录制外观察。
- 模式配置、场景初始化、checkpoint 审阅和推理时间不能进入 `record-start` / `record-stop` 区间。
- scenario 要求的模式切换、attention 认领、输入和节点交互必须走真实 UI，不能用测试消息或直接修改 Webview state 代替。
- deterministic provider 可以用于稳定录制时序，但必须在设计和验证说明中披露，不能写成真实在线模型输出。
- 不得为了录制在产品代码中增加自动确认、伪状态、伪 split view 或其他媒体专用行为。
- Terminal 输出、Agent 状态、attention、running 和 root 内容都必须来自真实运行时像素，不能后期贴图后再冒充录制源。
- 每条 take 必须记录实际窗口尺寸、主题、workspace、presentation mode、开始/结束时间和原始 clip 路径。
- 正式公开媒体的 workspace 必须位于中性 `/tmp` 路径；开始录制前读取 session metadata，确认 `workspaceFile` 和全部 `workspaceFolders[].path` 不包含用户名、home 目录或仓库 worktree 路径。

## 多 Take 录制

如果剧本要求同一 workspace 的多种真实呈现方式：

- 每种呈现方式分别录制为完整分辨率源素材，不从另一条 take 裁切或缩放伪造。
- 所有 take 使用同一个 Extension Host、profile、窗口尺寸、主题、workspace folder 顺序和 scenario 状态机。
- presentation mode 或其他配置在录制片段外切换，Settings 不进入源 clip。
- 需要同状态对齐时，分别抓取带清晰 label 的原始 checkpoint，并记录对应 take 和状态；本 Skill 只负责捕获与记录，不负责把 checkpoint 配对合成。
- 发现 root 顺序、节点标题、执行状态或窗口几何不一致时，重录源素材。

## 当前工具限制

`close` 是录制工作的默认终止命令：它关闭 Extension Host、窗口管理器和 Xvfb，但不导出或覆盖正式媒体资产。执行前若仍有活动 clip，会要求先运行 `record-stop`，避免丢失 clip metadata。

`record-start` 会让 ffmpeg 通过独立 `-progress` 文件报告编码进度，只有 `frame >= 1` 后才返回并允许后续原生输入；15 秒内没有首帧或 ffmpeg 提前退出时会停止当前进程并明确失败。`record-stop` 成功 probe 后清理 progress 文件。这个握手消除了“固定等待结束但 x11grab 尚未产出首帧”的竞争，但正式 clip 停止后仍必须抽帧或生成 contact sheet，确认目标点击、完整布局动画和可见结果都实际进入 MP4，不能只依据结尾 screenshot 判断。

`stop` 只为历史单宽屏流程保留。它仍会拼接旧 clips、合成旧 GIF，并把最后一张历史 GIF frame 复制为正式 PNG；这些行为不是本 Skill 的职责，也不代表当前剧本的剪辑方案。除非任务明确授权运行旧导出，否则不要使用 `stop`。

## 原始录制产物

- `.debug/marketplace-media/clips/clip-NNN.mp4`：分段原始视频。
- `.debug/marketplace-media/sources/<take>/<scene>.mp4`：带 take 与 scene 标签的原始视频。
- `.debug/marketplace-media/checkpoints/<take>/<frame-id>.png`：原始宿主 checkpoint。
- `.debug/marketplace-media/checkpoints/<take>/<frame-id>.json`：take、状态、几何与 DOM 摘要 metadata。
- `.debug/marketplace-media/screenshots/`：录制外观察截图。
- `.debug/marketplace-media/gif-storyboard/frames/`：由历史 `gif-frame` 命令抓取的原始 checkpoint；目录名不赋予它最终 GIF 语义。
- `.debug/marketplace-media/recording-session.json`：当前录制 session 与进程信息。
- `.debug/marketplace-media-session-output.log`：录制宿主日志。

最终 MP4/GIF/PNG 不属于本 Skill 的交付物；它们应由独立编辑流程消费这些原始素材后生成。

## 停止并重录的条件

- clip 录入了 Settings、坐标定位、试操作、等待推理或录制工具窗口。
- 画面状态与当前 scenario 不一致。
- 真实 UI 操作被测试消息、直接状态修改或后期贴图替代。
- 多条 take 的窗口尺寸、主题、workspace 顺序或稳定状态无法对应。
- 画面包含不应出现的 notification toast、调试 overlay、鼠标遮挡或系统窗口。
- 原始 MP4 损坏、时长异常、没有目标动作，或 `record-stop` 前后状态不可确认。

## 相关文件

- `docs/marketplace-media-scenario.md`：规定要录什么，以及后续成片如何剪辑；本 Skill 只执行其中的录制部分。
- `docs/design-docs/marketplace-readme-media-automation.md`：正式媒体设计与产物规则。
- `scripts/media/generate-marketplace-media.mjs`：历史 npm 入口兼容 wrapper。
- `scripts/media/recording-session.mjs`：当前真实宿主录制工具。
- `scripts/media/x11-native-input.py`：X11 原生输入。
