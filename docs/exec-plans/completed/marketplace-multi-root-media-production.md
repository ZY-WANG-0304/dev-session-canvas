# 制作四 Root 双形态 Marketplace 宣传片

本 `ExecPlan` 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘`。

本文件完成后位于 `docs/exec-plans/completed/marketplace-multi-root-media-production.md`，并持续遵守仓库根目录 `docs/PLANS.md` 的要求。仍需后续跟踪的技术债登记到 `docs/exec-plans/tech-debt-tracker.md`。

## 目标与全局图景

完成后，维护者可以从两条真实的 VS Code Extension Development Host 录制源生成最新正式方案定义的宣传媒体：约 60 秒的中英文 MP4、八帧中英文 GIF，以及从显式 `attention-arrives` Hero frame 导出的中英文 PNG。成片先用组合画布建立四个工程并行工作的现场，中段比较同一状态下的 `rootGroups` 与 `paneGallery`，随后在窗格画廊中聚焦需要关注的 Agent、提交重试策略决策，并看到真实 Terminal 测试以 exit code 0 收口。

用户可以直接打开 `extensions/vscode/dev-session-canvas/images/marketplace/` 下的六份默认和中文资产观察结果。每一条产品 UI 像素都应来自真实宿主录制；合成器只能添加背景、窗口框、模式标签、字幕、转场和产品落版。中间 checkpoint、成对来源清单、合成日志和技术验收报告保留在 `.debug/marketplace-media/`，让最终资产可以回溯到源 take。

## 进度

- [x] (2026-07-14 22:44 +0800) 阅读 `docs/WORKFLOW.md`、`docs/PLANS.md`、录制 Skill、最新剧本和正式设计文档，确认新双宽屏方案尚未实现，不能复用旧 `stop` 导出的单宽屏资产冒充成片。
- [x] (2026-07-14 22:44 +0800) 盘点现有 `scripts/media/recording-session.mjs`、真实宿主录制依赖、旧关键帧链路和 deterministic provider fixture。
- [x] (2026-07-15 01:12 +0800) 实现独立 compositor：严格 pair manifest、来源 probe、Playwright 合成 frame、分段 MP4、显式时长 GIF、中英文字幕、显式 Hero PNG、来源 hash 与 staged-output 验证报告均落地。
- [x] (2026-07-15 00:48 +0800) 扩展真实录制工具：新增四 root scenario、无导出副作用的 `close`、带 take / scene 的 clip、成对 checkpoint metadata、模式切换、fixture trigger 与原生鼠标移动。
- [x] (2026-07-15 02:13 +0800) compositor 四项自动化、三个脚本语法检查、provider `bash -n`、构建、类型检查、VSIX 命令/文件列表测试和 diff check 通过；真实 session JSON 人工确认 scenario、几何、模式、clips、checkpoints 与关闭状态完整。
- [x] (2026-07-15 00:48 +0800) 在同一个真实 Extension Development Host 完成六个 scene、两条 `1440x900` take 与八组左右 checkpoint；按画面问题重录 paneGallery 收尾 scene 后安全关闭宿主。
- [x] (2026-07-15 01:28 +0800) 生成英文默认和简体中文六份资产；独立 `ffprobe`、完整解码、字体 / metadata、关键时间点、1180px 与 375px 目检全部通过。
- [x] (2026-07-15 02:13 +0800) 同步中文 README、录制 Skill、设计文档与技术债；设计验证状态恢复为“已验证”，计划归档到 `completed/`。

## 意外与发现

- 观察：当前分支 `marketplace-media-multi-root-storyboard` 已在 `main@c1e13b75` 之上提交最新剧本和设计结论，但代码仍保留旧单宽屏导出行为。
  证据：`docs/design-docs/marketplace-readme-media-automation.md` 的 7.6 明确列出 compositor、显式 Hero 和中文资产未实现；`scripts/media/recording-session.mjs::cmdStop()` 仍调用 `concatClips()`、`composeGif()` 并复制最后一张 GIF frame 为 PNG。

- 观察：录制环境已经安装 `Xvfb`、`xfwm4`、`xwininfo`、`xsel`、`ffmpeg`、Playwright 和 `Noto Sans CJK SC`；现有历史 session 证明真实宿主可以稳定得到 `1440x900` 窗口。
  证据：环境预检返回 ffmpeg `overlay`、`drawtext`、`xfade` 和 palette filters 可用，`fc-match 'Noto Sans CJK SC'` 命中 `/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc`，旧 `.debug/marketplace-media/recording-session.json` 记录 `1440x900` 几何。

- 观察：root-local 画布状态保存在 VS Code user data 的 global storage，而不是各 fixture root 内；因此录制 workspace 可以在宿主启动前安全写入四份静态 idle 节点快照，再通过真实 UI 启动 runtime。
  证据：`CanvasPanelManager.getRootLocalCanvasSnapshotPath()` 使用 `globalStorageUri/root-local-canvas/<sha256(rootPath)[0..24]>/canvas-state.json`；`composeMultiRootCanvasState()` 会在载入多根 workspace 时组合这些快照。

- 观察：单个 60 秒 ffmpeg filtergraph 同时消费循环背景、九个透明 overlay、动态缩放和三段 timeline 时会持续积累帧缓存，第一轮烟测的 ffmpeg RSS 超过 14 GB；这不是可接受的正式实现。
  证据：合成进程 `ffmpeg ... split=3 ... concat=n=3` 在输出仍为 48 bytes 时 RSS 达到 `14428704 KB`。改成三段独立渲染、1920x1200 直接构图、drawtext 字幕和 concat copy 后，完整 MP4 为 `1920x1200`、`1800` 帧、`60.0s`，峰值 RSS 约 1.5 GB。

- 观察：ffconcat 无法仅凭最后一张 still 推断尾帧停留时间；补重复图片会让重复项继承前一帧的 1.6 秒，裁到 10 秒又会丢掉最后 0.8 秒。
  证据：两轮烟测分别得到 `11.6s / 9 frames` 和 `9.2s / 8 frames`。最终移除重复项，并用 GIF muxer `-final_delay 160` 显式指定尾帧 160 个厘秒；输出级回归和双语正式资产均为 `10.000s / 8 frames`。

- 观察：按原始 scene 完整顺接时，Take B 的 `all-in-view` 交互发生在 25 秒裁切点之后，形式上合法但收尾故事不完整。
  证据：2 秒间隔 contact sheet 显示 24 秒仍聚焦 E2E Tests、26 秒仍未回到四 pane。最终保留完整聚焦与提交过程，裁掉 tests scene 的无动作前摇，从真实 `all-in-view` 源片 4.8 秒处接入切换并冻结真实尾帧，使 25 秒 take 在 21 秒后稳定显示四 pane。

- 观察：第一版合成器在生成 validation report 前就把 staged 文件 rename 到正式目录，因此一次 GIF 时长失败仍覆盖了旧正式资产。
  证据：英文首轮 report 为 `passed: false` 时正式 MP4/GIF/PNG 的 mtime 与 hash 已变化。发布顺序现改为先对 staged 三件套生成 report，只有 `passed: true` 才 rename；失败产物保留在 work directory 诊断。

## 决策记录

- 决策：继续在当前媒体主题分支上实现和制作，不从 `main` 丢弃已经提交的最新设计结论。
  理由：当前分支仅比当天最新 `main` 多一条与本任务直接相关的正式方案提交，用户要求正是按该方案制作；实现与素材属于同一可追踪目标。
  日期/作者：2026-07-14 / Codex

- 决策：新增独立 compositor 脚本，不继续扩张录制 Skill 或让 `recording-session.mjs stop` 隐式决定成片。
  理由：正式设计明确要求录制与剪辑职责分离；独立入口还可以在不启动 VS Code 的情况下对 manifest 和合成逻辑做自动化测试。
  日期/作者：2026-07-14 / Codex

- 决策：中间母版使用 Playwright 渲染的 HTML/CSS 构图和 ffmpeg 视频合成，正式 UI 区域只嵌入真实录制像素。
  理由：Playwright 已是仓库依赖，适合确定性渲染静态背景、窗口框、标签与中英文排版；ffmpeg 负责视频缩放、叠加、转场、编码和 GIF palette，避免引入新的原生图形依赖。
  日期/作者：2026-07-14 / Codex

- 决策：deterministic provider 和 Terminal fixture 可以使用 `.debug/marketplace-media/` 中的文件触发器控制完成时机，但状态变化必须经过真实 PTY 输出、OSC 9 和产品 UI。
  理由：剧本允许披露 deterministic provider；文件触发器只稳定外部进程时序，不写 Webview state，也不会在后期重绘 attention、running 或 Terminal 输出。
  日期/作者：2026-07-14 / Codex

- 决策：MP4 按 Take A、比较段、Take B 三段分别渲染到最终分辨率，再用一致的 H.264 参数无损 concat；视频字幕使用显式 Noto 字体文件的 drawtext，GIF/PNG 字幕继续由 Playwright 母版渲染。
  理由：分段处理会在每个叙事单元结束后释放循环图片和动态缩放的帧缓存，同时仍保留设计要求的 2560x1600 逻辑坐标、60 秒时间线和无透视窗口动画。
  日期/作者：2026-07-14 / Codex

- 决策：Take B 由四个真实 scene 的受控入出点组成，并允许对最后一张真实宿主帧做静态停留，不要求把每个 scene 的录制前摇完整带入 25 秒成片。
  理由：scene 是可追溯源素材而不是不可剪切的成片；剪掉无动作等待、保留真实 UI 转换并延长真实尾帧，才能同时满足聚焦、决策、测试和四 pane 收尾的固定时间线，且没有重绘产品状态。
  日期/作者：2026-07-15 / Codex

- 决策：GIF 尾帧停留由 muxer `final_delay` 显式指定，正式资产在 staged 三件套全部通过 validation report 后再发布。
  理由：ffconcat 的最后一帧没有后继 PTS，重复帧与输出裁切都无法稳定表达既定 1.6 秒；显式尾帧 delay 有可验证的 10 秒结果。先验证后 rename 则保持失败可诊断且不污染正式目录。
  日期/作者：2026-07-15 / Codex

- 决策：用户重新选定三句字幕后，本会话只同步剧本、compositor 文案常量和自动化断言，不重新生成 MP4、GIF 或 PNG。
  理由：用户明确要求本会话不生成媒体资产；保留现有二进制文件还能避免把未完成视觉复核的新字幕静默发布为正式结果。
  日期/作者：2026-07-15 / 用户与 Codex

## 结果与复盘

最新方案已经形成可重复的“真实录制 -> pair manifest -> 双语合成 -> staged 验证 -> 正式发布”链路。正式目录包含默认英文与简体中文 MP4、GIF、PNG 六份资产；MP4 都是 `1920x1200 / 1800 frames / 60.000s`，GIF 都是 `1440x900 / 8 frames / 10.000s`，PNG 都是 `1920x1200`。两份 validation report 均为 `passed: true`，并记录 Noto 字体、Hero ID、来源 hash 和尺寸/时长检查。

真实宿主侧保留六个 scene、两条 take 和八组左右 checkpoint。人工确认固定四 root 与节点标题、OSC 9 attention、缩略图聚焦不清 attention、主 Agent 点击后清除、回复后恢复 running、Terminal `42 passed | exit code 0` 和 dynamic 四 pane 收尾。deterministic provider 及文件 trigger 已披露；它们只控制外部进程时序，所有用户可见产品状态仍来自真实 PTY、OSC 和 Extension Host UI。

视觉验收覆盖中英文 Hero、GIF 首尾、MP4 15 个关键时间点、README 1180px 和移动端 375px。字幕安全区、英文 attention 两行、中文单句与最后四 pane 均清楚；Hero 与对应 GIF attention frame 的 SSIM 约 `0.98`，与 GIF 尾帧约 `0.92`，证明显式 Hero 不是机械复制尾帧。

实现过程中最有价值的修正不是视觉细节，而是输出协议：单 filtergraph 的 14 GB 内存问题促成三段渲染；两种错误 GIF 时长促成输出级回归和显式 `final_delay`；失败产物提前发布促成 staged-first 校验。仍保留的旧 `stop` 覆盖风险已登记到技术债，当前正式工作流只使用 `close` 与独立 compositor。

2026-07-15 后续字幕调整：用户选定“一个工作区，同时推进多项任务。”、“两种视图模式，按需选择。”和“既能统览全局，也能从容聚焦。”。源代码和文档已经同步，既有六份媒体资产没有在本会话重新生成，仍对应上一版字幕；上述尺寸、时长与流水线验证证据继续有效，但新文案的成片视觉验收必须在后续重新合成后完成。

## 上下文与定向

`docs/marketplace-media-scenario.md` 是唯一内容剧本。它固定四个 workspace root 的顺序为 `payments-api`、`storefront`、`design-system`、`release-tools`，固定执行节点标题为 `Contract Review`、`UI Builder`、`Component Audit` 和 `E2E Tests`，并定义 0-60 秒镜头、四句字幕、八个 GIF Frame ID 和 `attention-arrives` Hero。

`docs/design-docs/marketplace-readme-media-automation.md` 是正式设计结论。这里的 “Take” 是一种完整的真实产品呈现：Take A 使用 `rootGroups`，Take B 使用 `paneGallery`。这里的 “checkpoint pair” 是同一逻辑状态下分别从两种 take 捕获的两张 `1440x900` 真实宿主截图。这里的 “compositor” 是只消费真实录制源、再添加允许的宣传片外层构图的后期脚本；它不能修改产品节点或运行状态。

`scripts/media/recording-session.mjs` 负责启动真实 Extension Development Host、通过 X11 原生输入操作宿主、分段录制 MP4 和抓取 checkpoint。正式录制使用无导出副作用的 `close`；`stop` 仍保留旧资产导出副作用，只作为兼容入口并在 Skill 与技术债中明确标注。

`tests/vscode-smoke/fixtures/fake-agent-provider` 是现有 deterministic provider。录制 wrapper 把 `claude` 指向它，因此 Agent 仍由真实 node-pty 会话驱动。本轮允许为它增加通用、显式命名的媒体 fixture 指令或环境触发器，但不能在主扩展源码中增加媒体专用状态。

`.debug/marketplace-media/` 是可清理的中间目录。计划中的 workspace fixture、触发器、源 clips、checkpoint、pair manifest、合成母版、语言输出日志和验收报告都放在这里。正式进入 git 的资产只放在 `extensions/vscode/dev-session-canvas/images/marketplace/`。

## 工作计划

先新增 compositor 与测试，使它能在合成前拒绝缺帧、错尺寸、错语言、字幕过短、Hero ID 不存在或左右状态标签不一致的 manifest。静态 frame 使用 Playwright 在 `2560x1600` 母版中渲染低噪声石墨色四 root 拓扑背景、两个保持 16:10 的源窗口、模式标签和安全区字幕。视频使用 ffmpeg 把 Take A / Take B clip 缩放叠加到相同母版，按剧本构建约 60 秒时间线，最后导出 `1920x1200` H.264；GIF 使用八张已审阅合成 frame 的显式时长导出 `1440x900` palette GIF；PNG 直接从 `attention-arrives` 合成母版导出。

再扩展录制工具。`start` 接受宣传片 scenario 后，在 `.debug` 创建四个最小 root 和 `.code-workspace`，写入 Default Dark Modern、panel 最大化、文件活动关闭、`osc9` attention、bridge `none`、strong reminder `both` 等设置，并在 global storage 预置每个 root 一个静态节点。新增 session metadata 记录 workspace、模式、主题、窗口、开始时间和源路径；新增 `close` 只停止宿主，不触发旧资产覆盖。节点 runtime 仍通过真实 UI 启动，任务提交、attention 认领、回复、缩略图双击和 overview 切换都用原生输入完成。

随后执行真实录制。录制前先在 rootGroups / paneGallery 间切换并捕获 `overview-start`、`all-running` 等成对 checkpoint；进入最终 clip 后不录 Settings、定位或等待调试。Contract Review 的外部 provider 在触发器出现时通过真实 OSC 9 发出固定问题；UI Builder 由用户提交固定任务后进入 running；Component Audit 保持 running 直到收尾；E2E Tests 在真实 shell 中运行 fixture 并在触发后打印 pass summary 和 exit code 0。两条 take 的窗口、root 顺序和节点标题必须一致。

最后用 pair manifest 合成两种语言资产并验收。自动检查包括文件存在、分辨率、时长、帧数、字体命中、Hero metadata 和来源 hash；人工检查包括无 toast / overlay / 鼠标遮挡、attention 可发现且清除时机正确、字幕安全区、1180px README 与 375px 移动端可读性。验收通过后再更新 README 中文引用和设计文档 `validation_status`。

## 具体步骤

所有命令都在仓库根目录执行。实现阶段的最低验证命令为：

    node --check scripts/media/recording-session.mjs
    node --check scripts/media/compose-marketplace-media.mjs
    node --test scripts/media/*.test.mjs
    npm run build
    npm run typecheck
    git diff --check

真实录制使用以下带显式 scenario / take / scene / frame ID 的接口；`close` 不修改正式资产，compositor 也不会自动修改 README：

    node scripts/media/recording-session.mjs start --scenario four-root-attention
    node scripts/media/recording-session.mjs set-mode rootGroups
    node scripts/media/recording-session.mjs record-start --take rootGroups --scene <scene>
    node scripts/media/recording-session.mjs record-stop
    node scripts/media/recording-session.mjs checkpoint <frame-id> --take rootGroups
    node scripts/media/recording-session.mjs close

    node scripts/media/compose-marketplace-media.mjs validate --manifest <pair-manifest>
    node scripts/media/compose-marketplace-media.mjs render --manifest <pair-manifest> --language en
    node scripts/media/compose-marketplace-media.mjs render --manifest <pair-manifest> --language zh-CN

技术验收使用 `ffprobe` 检查六份资产的尺寸和时长，并由 compositor 写出 `.debug/marketplace-media/composite/<language>/validation-report.json`。正式结果为 MP4 `1920x1200 / 60s`、GIF `1440x900 / 10s`、PNG `1920x1200`，metadata 的 Hero frame ID 为 `attention-arrives`。

## 验证与验收

自动化测试必须证明：缺少任一八帧 pair 会失败；pair 的左右来源不同时会失败；中文与英文固定文案、英文 attention 断行和最小停留时间得到校验；GIF 总时长为 10 秒；PNG 从显式 Hero 生成而非最后一帧；最终文件名与正式设计一致。

真实宿主验收必须证明：四个 root 和节点按固定顺序出现；Take A 与 Take B 都是完整 `1440x900` 录制；提交 UI Builder 后状态进入 running；Contract Review 的 OSC 9 让 attention 在两种形态可见；双击缩略图只聚焦不清 attention；点击 Agent 后才清 attention；提交固定回复后恢复 running；E2E Tests 的 pass summary 来自真实 Terminal 进程；最后回到 dynamic 四 pane。

成片验收必须证明：双宽屏只出现在后期比较段；源窗口不裁宿主外框、不透视倾斜；字幕位于 UI 外部安全区；中文每屏一句，英文 attention 固定两行；四句完整停留满足剧本；默认 PNG 是 `attention-arrives`，不是 GIF 的 `all-in-view` 尾帧；中英文分别在 1180px 和 375px 宽度可读。

## 幂等性与恢复

录制与合成命令必须把当次 session 放到独立目录或在删除旧目录前明确列出范围，不能静默覆盖无法重建的源 take。`close` 可以反复执行，并且不应覆盖正式资产。合成器只读取 manifest 声明的输入；失败时保留源 clip、checkpoint、临时 frame 和 ffmpeg 日志，修复后可以只重跑合成。

如果某个 scene 录错，只删除并重录该 scene 和相关 checkpoint，不需要重录另一种模式；但成对状态 hash 或人工状态核对不一致时，必须重录不一致的一侧。正式资产只有在所有临时输出通过验证后才用原子 rename 覆盖。若中途终止，计划的 `进度`、`意外与发现` 和 session metadata 必须足以让下一位协作者从最近 checkpoint 继续。

## 证据与备注

最终证据摘要：

    git branch --show-current
    marketplace-media-multi-root-storyboard

    fc-match 'Noto Sans CJK SC'
    NotoSansCJK-Regular.ttc: "Noto Sans CJK SC" "Regular"

    source take geometry
    width=1440 height=900

    formal MP4
    width=1920 height=1200 nb_frames=1800 duration=60.000000

    formal GIF
    width=1440 height=900 nb_frames=8 duration=10.000000

    validation reports
    en passed=true, zh-CN passed=true, font-loaded=true, heroFrameId=attention-arrives

    checkpoints
    8 rootGroups + 8 paneGallery PNG/JSON pairs

## 接口与依赖

本轮只使用仓库已有 Node.js、Playwright 和系统 ffmpeg / X11 工具，不新增运行时 npm 依赖。compositor 模块导出可测试的 manifest 校验与 GIF 渲染函数；CLI 提供 `validate` 和 `render` 子命令。manifest schema 包含版本、八个 frame 的左右 checkpoint 路径与状态标签、逐帧时长、Hero frame ID，以及 Take A / Take B clip 段。

录制工具已提供无副作用 `close`，并在 session JSON 中记录 `scenario`、`take`、`presentationMode`、`theme`、`workspaceFile`、`startedAt`、窗口尺寸、clips 和 checkpoints。`command` / `dispatch` 在真实宿主中继续不可用；初始化只写静态 root-local snapshot，最终 clip 内的用户可见变化来自原生输入和真实 runtime。

最后更新说明：2026-07-15，补齐真实录制、Take B 入出点、GIF `final_delay`、staged-first 发布、双语正式资产、视觉/技术验收和归档结果；随后记录用户新选字幕及“本会话不重新生成媒体资产”的明确边界。
