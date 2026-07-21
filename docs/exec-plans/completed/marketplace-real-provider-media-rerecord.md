# 使用真实 Codex / Claude 返工 Marketplace 宣传片

本 `ExecPlan` 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘`。

本文件完成后位于 `docs/exec-plans/completed/marketplace-real-provider-media-rerecord.md`，执行期间必须持续遵守仓库根目录 `docs/PLANS.md`。仍需跟踪的风险登记到 `docs/exec-plans/tech-debt-tracker.md`。

## 目标与全局图景

返工后的宣传片必须让观众看到真实的操作节奏，而不是一开始就得到已经运行的静态全景。Take A 在 `rootGroups` 中从 fit view 开始，用户依次双击节点放大、通过真实 Agent / Terminal 输入区提交任务、再执行 fit view 回到全览，然后处理下一个节点。至少一个 Agent 使用本机已登录的 Codex CLI，至少一个 Agent 使用本机已登录的 Claude Code CLI；不再把 fake provider 的输出放入正式录制。

后期也必须修正两项已确认的构图缺陷。19–35 秒左右并排时，Root Groups 与 Pane Gallery 都要严格收敛到同样的 `1120x700` 逻辑窗口；35 秒后只展示 Pane Gallery 时，它必须扩展到 `1920x1200` 输出中的 `1440x900` 等比单宽屏，而不是继续作为小窗停留。中英文字幕使用 2026-07-15 最新剧本中的新文案。

用户可以通过打开 `extensions/vscode/dev-session-canvas/images/marketplace/canvas-overview.mp4` 与 `.zh-CN.mp4` 直接验收。录制证据、真实 provider 版本/登录状态、scene clips、checkpoint pairs、合成关键帧和 validation report 保留在 `.debug/marketplace-media/`。

## 进度

- [x] (2026-07-15 02:20 +0800) 阅读最新剧本、录制 Skill、工作流和 ExecPlan 规则，确认用户修改了四组字幕，但“逐节点双击放大、输入、fit view”尚未写入正式剧本。
- [x] (2026-07-15 02:21 +0800) 检查真实 provider：Codex CLI `0.144.1` 与 Claude Code `2.1.209` 均存在并已通过 API key 登录；预检没有发现阻止真实录制的认证问题。
- [x] (2026-07-15 14:33 +0800) 把四个节点逐一“双击放大、真实输入、执行、fit view”的节奏、Codex / Claude / Bash 分工与禁止 fake provider 的验收口径写入剧本和设计文档。
- [x] (2026-07-15 15:15 +0800) 修正录制 scenario：正式 PATH 不再注入 fake provider，节点显式分配真实 Codex / Claude / Bash；直接 CLI 与 Extension Host 冒烟均成功，Codex / Claude 返回预期文本，Codex 官方 OSC 9 让节点进入 `waiting-input + attention`。
- [x] (2026-07-15 15:28 +0800) 把 60 秒 MP4 拆为五个低内存 segment；稳定比较段固定两侧 `840x525`，稳定 Pane Gallery 段固定 `1440x900`。synthetic RGB frame 像素边界测试、归档素材完整试渲染、关键帧目检和 blackdetect 均通过。
- [x] (2026-07-15 17:12 +0800) 归档上一版源素材后完成真实 Extension Development Host 录制；十个 scene 合成为 `19s / 570` 帧 Take A 与 `25s / 750` 帧 Take B，八组左右 checkpoint 和同场景 metadata 齐全。
- [x] (2026-07-15 17:42 +0800) 使用最新中英文字幕重新生成六份正式资产；完整解码、关键时间点、黑帧、`1180px / 375px`、Hero / GIF 尾帧与英文两行字幕安全区验收通过。
- [x] (2026-07-15 17:49 +0800) README 双语引用、录制 Skill、设计文档、索引、技术债与本计划已同步；本次临时素材检查、脚本检查、构建、类型检查和 `git diff --check` 通过，准备归档。

## 意外与发现

- 观察：上一版使用 fake provider 不是因为环境缺少真实 CLI，而是沿用了当时剧本明确允许的 deterministic provider 路径。
  证据：本机 `codex login status` 返回 API key 登录，`claude auth status` 返回 `loggedIn: true`；两套真实 CLI 当前都可执行。

- 观察：最新剧本 diff 只修改字幕，没有把用户要求的逐节点双击与 fit view 节奏写入 Take A。
  证据：`docs/marketplace-media-scenario.md` 的 `5-13s` 仍只描述聚焦 `storefront` 并提交一次任务，四 Root 表仍把另外两个 Agent 写成初始 running。

- 观察：上一版 compositor 的 19 秒比较段错误地把 Take A 动态 scale 表达式写成基于输出时间 `t`，但静态背景/图片输入与 segment 时间基准组合后没有得到预期收敛；35 秒后 Take B 的放大也只在逻辑母版的单窗尺寸内动画，实际关键帧显示仍明显偏小。
  证据：用户目检指出问题；上一版 20–34 秒 contact sheet 中左侧 Root Groups 占用远大于右侧，36–59 秒 Pane Gallery 主画面只占最终输出约四分之一到三分之一。

- 观察：通用 `prepareRuntime()` 会清空传入的整个 debug root，并把 `HOME` / XDG 目录改到隔离目录；若继续把 `.debug/marketplace-media` 直接传入，既会删除同目录 archive，也会让真实 CLI 看不到用户登录状态。
  证据：`scripts/smoke/vscode-smoke-runner.mjs` 的 `prepareRuntime()` 先执行 `fs.rm(debugRoot)`，随后把 `HOME`、`XDG_CONFIG_HOME` 等全部指向新目录。录制器必须改用 `.debug/marketplace-media/runtime` 作为临时 runtime root，并只通过 `CODEX_HOME` / `CLAUDE_CONFIG_DIR` 引用现有认证目录。

- 观察：Extension Host 的 Agent 环境原先会用登录 shell 的 PATH 覆盖启动 PATH，使真实 npm Codex 被系统 Node 12 执行并因顶层 `await` 失败；设置精确的 `VSCODE_CLI=1` 后，产品跳过 shell PATH patch，Codex 使用随安装路径提供的 Node 25 正常启动。
  证据：首次 Host spike 的 `Contract Review` 记录 `SyntaxError: Unexpected reserved word`，堆栈来自 `/usr/bin/node` 12 语义；修正后同一真实 `codex` 命令进入 TUI 并成功返回 `CODEX_HOST_OK`。

- 观察：Codex 首次显示更新提示，Claude 首次显示主题、workspace trust、外部指令和自定义 API key 确认；这些都是可在录制外处理的真实 CLI onboarding，不是认证阻塞。
  证据：加入 Codex 官方 `check_for_update_on_startup=false` 一次性覆盖，并为两套 CLI 建立 disposable config shell 后，三套 Agent 均能稳定停在输入提示；认证文件只用 symlink 引用，不复制到仓库或 archive。

- 观察：把动画与稳定画面分段后，旧源素材的完整 60 秒试渲染在 `20/26/34s` 显示等大双窗，在 `38/41/57s` 显示真正的大 Pane Gallery；转场中的 `36s` 保留预期中间尺寸。
  证据：synthetic frame 实测双窗为 `840x525 +/- 2px`、单窗为 `1440x900 +/- 2px`；试渲染为 `1920x1200`、30 fps、1800 帧、60 秒，blackdetect 没有发现黑帧，validation report 为 `passed: true`。

- 观察：Electron CDP 能定位 workbench 元素，但当前 VS Code webview DOM 不能稳定通过同一通道读取；如果 checkpoint 强依赖 DOM probe，会让真实录制证据在宿主升级后无故失败。
  证据：正式 checkpoint 命令在无法进入 webview DOM 时改用持久化画布状态生成 state summary，同时继续保存原始宿主 PNG、窗口几何、take 与 Frame ID；八组 pair manifest 校验通过。

- 观察：正式源录制没有真实 provider 阻塞。最终 Take A 中可辨认 `OpenAI Codex v0.144.1`、`Claude Code v2.1.209` 与 `./run-e2e.sh`，Take B 中可见 Codex 决策回复和 `42 passed | exit code 0`。
  证据：`.debug/marketplace-media/review/take-a-real-contact.png`、`take-b-real-contact.png` 与最终 `3/7/14/47/52s` 关键帧完成逐帧目检；当前 session metadata 不包含 fake 标识或 `provider-bin`。

- 观察：英文开场和收尾的两行字幕最初使用中文单行的纵坐标，第二行在 `1200px` 输出底边被裁切；自动尺寸 probe 不会发现这种排版缺陷。
  证据：首次 `3s` 与 `57s` 原分辨率抽帧直接显示第二行截断；把英文专用 y 坐标统一到 attention 字幕已经验证的 `972` 后重新渲染，两帧均完整可读，`375px` 预览也通过。

- 观察：Root Groups 源宿主仍显示右侧 Chat auxiliary，而 Pane Gallery 源宿主已经关闭 Chat；两侧完整 16:10 宿主外框与后期窗口矩形仍严格等大，Chat 没有覆盖画布、状态或字幕。
  证据：`20/26/34s` 抽帧的左右窗口均为 `840x525 +/- 2px`。该内部宿主差异不等于用户指出的窗口尺寸回归，也不影响本轮四项验收。

## 决策记录

- 决策：新建返工 ExecPlan，不修改已经完成的上一版制作计划。
  理由：上一版计划如实记录了当时的输入、fake provider 选择与验收结果；本轮是用户基于成片提出的新验收口径，应保留前一轮证据并单独追踪修正。
  日期/作者：2026-07-15 / Codex

- 决策：本轮正式录制不允许 fake provider 出现在 PATH 前缀中；Codex 与 Claude 的任务内容可以保持可控、短小，但输出必须来自真实 CLI。
  理由：用户明确要求真实 provider。稳定时序不能再通过替换 provider 达成，只能通过短任务、真实 provider 自带事件/通知、录制外等待和 scene 分段控制。
  日期/作者：2026-07-15 / Codex

- 决策：先做每套真实 CLI 的最小 Extension Host spike，再开始正式录制。
  理由：认证通过只证明 CLI 可用，不证明 TUI 启动参数、权限提示、attention 信号与产品状态机在当前录制 profile 中都适合成片；先验证可以避免录完整场景后才发现状态不可控。
  日期/作者：2026-07-15 / Codex

- 决策：Codex attention 使用官方一次性 `-c` TUI 配置，Claude Code 使用默认真实启动命令；两者都从系统 PATH 解析。
  理由：Codex 官方支持 `tui.notifications=["agent-turn-complete"]`、`tui.notification_method="osc9"` 和 `tui.notification_condition="always"`，可以让真实回合完成触发产品 attention，同时不修改用户全局配置或伪造输出。
  日期/作者：2026-07-15 / Codex

- 决策：新增受限 `record-sequence`，只允许 `wait/click/paste/key/move` 原生输入动作，不开放任意命令或 Webview dispatch。
  理由：逐个 CLI 调用原生输入会在片段中产生数秒空白；把动作序列放进同一个录制进程可以压缩节奏，同时继续满足“正式镜头只由用户可见原生输入驱动”的边界。
  日期/作者：2026-07-15 / Codex

- 决策：MP4 从历史三段拆为五段，稳定比较和稳定单窗使用固定 rect，只有进入/扩展段保留时间动画。
  理由：把稳定几何与动画表达式分离后，最终帧尺寸不再依赖 ffmpeg 输入时间基准；synthetic RGB frame 可以直接测量真实输出边界。
  日期/作者：2026-07-15 / Codex

- 决策：英文两行开场、attention 和收尾统一使用 `y=972`，中文单行继续保留原坐标。
  理由：英文两行在中文单行基线下会越过底边；按语言设置安全区能修复排版而不改变中文构图或重录真实产品像素。
  日期/作者：2026-07-15 / Codex

- 决策：保留 Root Groups 源中的真实 Chat auxiliary，不为内部宿主栏位差异重录或在后期裁切产品像素。
  理由：本轮用户反馈与验收口径针对左右完整窗口尺寸，现有两侧外框已经严格相等；Chat 不遮挡叙事内容，而重录会重新引入真实 provider 时序风险，后期移除又违反不重绘产品 UI 的边界。
  日期/作者：2026-07-15 / Codex

## 结果与复盘

本轮返工已经逐项闭合用户的四个反馈。Take A 在 19 秒内按 `payments-api -> storefront -> design-system -> release-tools` 完成四轮“fit view 全览、双击放大、真实输入、running/live、fit view”；正式 metadata 与画面分别证明使用 Codex CLI `0.144.1`、Claude Code `2.1.209` 和真实 Bash，没有 fake provider；稳定比较段左右窗口均为 `840x525 +/- 2px`；38 秒后的 Pane Gallery 稳定保持 `1440x900 +/- 2px`。

英文字幕底边问题在最终验收中被发现并修复，六份双语资产随后全部重渲染。两条 MP4 均为 `1920x1200`、1800 帧、60 秒且无黑帧；两条 GIF 均为 `1440x900`、8 帧、10 秒；两张 PNG 均为 `1920x1200`，Hero 明确来自 `attention-arrives` 而不是 GIF 尾帧。本次临时素材检查、脚本语法检查、构建、类型检查和 diff 门禁通过。

本轮没有遗留功能缺口。录制器旧 `stop` 仍可能覆盖新正式资产，以及 Linux X11 工具链的跨平台限制，继续由 `docs/exec-plans/tech-debt-tracker.md` 跟踪；当前正式维护路径只使用无导出副作用的 `close` 与独立 compositor。

## 上下文与定向

`docs/marketplace-media-scenario.md` 是内容剧本，用户已在当前工作树把开场、双形态、attention 和收尾字幕改成新版本。当前正式实现位于 `scripts/media/recording-session.mjs` 与 `scripts/media/compose-marketplace-media.mjs`。前者启动真实 Extension Development Host、准备四 root workspace、通过 X11 原生输入录制 scene；后者把两条 take 与八组 checkpoint 合成为中英文 MP4/GIF/PNG。

上一版录制器的 `prepareRecordingProviderBin()` 会在 `.debug/marketplace-media/provider-bin` 创建名为 `codex` / `claude` 的 wrapper，并把该目录放到 VS Code 子进程 PATH 最前面。因此即使系统安装了真实 CLI，正式 Agent 也会命中 fake fixture。本轮必须让 `four-root-attention` 正式 scenario 不再注入这一路径，同时保留旧无 scenario 录制或 smoke 所需的兼容行为。

上一版 compositor 的 60 秒视频分为 19 秒 Take A、16 秒比较、25 秒 Take B 三个 MP4 segment。逻辑坐标基于 `2560x1600`，最终直接在 `1920x1200` 合成。双窗目标矩形应各为 `840x525`（逻辑 `1120x700` 乘 0.75）；单窗目标矩形应为 `1440x900`（逻辑 `1920x1200` 乘 0.75）。验收必须直接从最终 MP4 抽帧测量非背景窗口边界，不能只检查源尺寸。

`.debug/marketplace-media/` 中保留上一版所有源素材和 report。开始新录制前应把上一版 `sources/`、`checkpoints/`、`pair-manifest.json` 与 `composite/` 复制到带时间戳的 archive 子目录，避免覆盖后失去对照证据。正式资产只有新版本全部通过后才能被替换。

## 工作计划

先同步正式文档。修改剧本的 Take A 和 60 秒时间线，明确多个节点都采用“fit view 全览、双击节点放大、点击输入区、粘贴任务、提交、等待 running、fit view”的可见节奏；明确节点 provider 分配与真实 CLI 边界。设计文档把上一版 deterministic provider 验收降回返工中，并记录本轮真实 provider 要求。

随后做真实 provider spike。修改 `recording-session.mjs` 的 scenario 定义，为 Contract Review、UI Builder、Component Audit 指定 Codex / Claude；正式 scenario 不调用或不注入 `prepareRecordingProviderBin()`。在 disposable 四 root workspace 内启动宿主，通过真实 UI 启动一个 Codex 和一个 Claude，处理可能的首次信任/权限提示，发送极短任务，确认输出、状态与输入可见。若真实 CLI 不自然发出 attention，优先使用 provider 官方 notification / hook 配置让真实回合完成触发 OSC 9；不能回退到 fake 输出或直接写 Webview state。

并行修正 compositor 的几何，但本计划不使用子代理。把比较段拆成明确的进入动画和稳定双窗阶段，必要时使用预渲染的固定目标 rect 而不是让同一 filter expression跨整个 segment。Take B 段在前三秒从右侧双窗 rect 动画到单窗 rect，之后必须稳定保持 `1440x900`。新增测试或 frame probe，至少验证比较稳定帧左右窗口宽高相等、Take B 稳定帧窗口为 `1440x900`、没有黑帧。

正式录制按 scene 分段。Take A 至少包含开场全览、逐节点输入循环、attention 到达；Take B 包含 dynamic 全览、thumbnail 聚焦、attention 认领/回复、真实 Terminal 收口和 dynamic 收尾。每个 scene 停止后生成 contact sheet 并目检，只有动作、鼠标、权限提示和状态都干净才进入下一个 scene。八组 checkpoint 必须在同一真实运行状态下切换模式分别捕获。

最后更新 compositor 文案，生成两种语言到 staged output。先查看 1/4/8/12/18/20/26/34/36/38/41/47/52/57/59 秒关键帧，再发布正式资产。所有技术与视觉检查通过后同步文档并归档本计划。

## 具体步骤

所有命令从仓库根目录运行。预检和最小验证至少包括：

    codex --version
    codex login status
    claude --version
    claude auth status
    node --check scripts/media/recording-session.mjs
    node --check scripts/media/compose-marketplace-media.mjs

正式录制仍使用：

    node scripts/media/recording-session.mjs start --scenario four-root-attention
    node scripts/media/recording-session.mjs record-start --take rootGroups --scene <scene>
    node scripts/media/recording-session.mjs record-stop
    node scripts/media/recording-session.mjs checkpoint <frame-id> --take <take>
    node scripts/media/recording-session.mjs close

合成与最终门禁使用：

    node scripts/media/compose-marketplace-media.mjs validate --manifest .debug/marketplace-media/pair-manifest.json
    node scripts/media/compose-marketplace-media.mjs render --manifest .debug/marketplace-media/pair-manifest.json --language en
    node scripts/media/compose-marketplace-media.mjs render --manifest .debug/marketplace-media/pair-manifest.json --language zh-CN
    npm run build
    npm run typecheck
    git diff --check

## 验证与验收

Take A 必须在最终 MP4 中可见四次完整循环：从全览双击节点放大、在节点输入区提交真实任务、看到 running / live、执行 fit view 回到四 root；下一节点重复相同节奏。不能以录制开始前预置 running 状态替代这些输入。

正式 Agent 输出中必须同时能辨认真实 Codex 与 Claude Code；session metadata 和录制说明记录真实 CLI 版本与节点 provider。不得出现 `[fake-agent]`、`[fake-claude]`、fake session id 或 provider-bin wrapper 路径。

最终 MP4 的稳定比较帧中，两侧源窗口都应为约 `840x525`，误差不超过 2 像素；进入 Pane Gallery 单视角后，源窗口应稳定为约 `1440x900`，误差不超过 2 像素。两段都保留完整 16:10 宿主外框，不裁切、不拉伸。

字幕使用最新中英文文案，并在 1180px 与 375px 可读。六份资产的尺寸、帧数、时长、Hero ID、GIF 尾帧、字体与来源 hash 继续满足上一版约束。

## 幂等性与恢复

真实 provider spike 和正式录制都只使用 `.debug/marketplace-media/scenario/` 下的 disposable workspace，不修改用户真实项目。开始新 session 会清理 scenario trigger，因此每次运行不会继承旧完成信号。旧源素材先 archive，再允许同名 scene 覆盖当前工作目录。

如果任一真实 CLI 出现登录失效、权限提示或网络错误，停止当前 scene，保留日志并在录制外修复；不把错误窗口录入正式素材，也不退回 fake provider。若某个 scene 失败，只重录该 scene和受影响 checkpoint。`close` 可重复执行且不覆盖正式资产。

合成器继续先写 staged output，validation report 全部通过后才替换正式资产。任何一项失败都保留上一版正式资产，修复后可以从已有真实源重新合成，不必重录。

## 证据与备注

真实 provider 预检：

    codex-cli 0.144.1
    Logged in using an API key
    Claude Code 2.1.209
    loggedIn=true, authMethod=api_key, apiProvider=firstParty

用户指出的上一版构图证据：比较段 Root Groups 明显大于 Pane Gallery；Pane Gallery 单视角仍为小窗。新版本的 `20/26/34/36/38/41/57s` 抽帧保留在 `.debug/marketplace-media/review/final/`，证明比较稳定段等大、扩展中间态连续、单窗稳定段真正放大。

最终门禁的聚焦输出：

    Manifest valid: 8 paired frames, 10s GIF.
    tests 9; pass 9; fail 0
    canvas-overview.mp4: 1920x1200, 1800 frames, 60.000000s
    canvas-overview.gif: 1440x900, 8 frames, 10.000000s
    blackdetect-en: no matches
    blackdetect-zh-CN: no matches
    npm run build: exit 0
    npm run typecheck: exit 0

## 接口与依赖

本轮继续使用仓库已有 Playwright、ffmpeg、X11 原生输入和 `@vscode/test-electron`，不新增 npm 运行时依赖。真实 CLI 由系统 PATH 提供：`codex` 位于当前 Node 安装目录，`claude` 位于用户本地 bin；录制子进程必须继承它们，但不得把完整 API key 或认证内容写入 session metadata、日志或文档。

`recording-session.mjs` 的四 root 定义必须显式包含 provider，并据此写入 root-local Agent metadata 的 `provider`、`shellPath` 与 `lastBackendLabel`。真实认证文件只能从 disposable runtime 通过 symlink 引用；onboarding、会话和临时状态写入隔离目录。Codex attention 与更新检查只能使用一次性 `-c` 覆盖，不能修改用户全局 Codex / Claude 配置。

`compose-marketplace-media.mjs` 必须保留固定 `1920x1200` 输出和五段低内存渲染，rect 动画结束后保持稳定目标尺寸。测试接口导出只读布局常量与稳定 filter builder，synthetic RGB frame 测试据此测量最终像素边界。

最后更新说明：2026-07-15 17:49 +0800，真实 provider 源录制、五段 compositor、双语资产、完整技术与视觉验收均已完成；同步正式设计结论后归档本计划。
