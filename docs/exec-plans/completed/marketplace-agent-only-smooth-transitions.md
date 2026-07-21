# 把 Marketplace 宣传片收口为四 Agent 与连续几何转场

本 `ExecPlan` 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘`。

本文件完成后位于 `docs/exec-plans/completed/marketplace-agent-only-smooth-transitions.md`，执行期间必须持续遵守仓库根目录 `docs/PLANS.md`。仍需跟踪的风险登记到 `docs/exec-plans/tech-debt-tracker.md`。

## 目标与全局图景

当前双语宣传片已经使用真实 Codex 与 Claude Code，但用户再次验收后确认三项缺口。第四个 `release-tools` 节点仍是 Terminal，而新剧本要求四个节点全部是 Agent；`19-20s` 从单 Root Groups 进入双视图和 `35-38s` 从双视图进入单 Pane Gallery 时，ffmpeg 先改变 overlay 位置、随后才跳变 scale，视觉上不是同一窗口同时平移和缩放；录制宿主还继承了 `NO_COLOR=1`，导致真实 Agent TUI 主动关闭 ANSI 颜色。

完成后，Take A 应逐一操作四个真实 Agent，第四个 `release-tools / Release Validation` 使用真实 Codex 执行 `./run-e2e.sh` 并汇报结果。两段后期转场的每一帧都必须在固定输出画布上沿同一 easing 曲线同步插值 x、y、width、height，不能再出现位置先走、尺寸后跳。正式录制子进程必须使用 `TERM=xterm-256color`、`COLORTERM=truecolor` 且不含 `NO_COLOR`，Codex 与 Claude 的原生 ANSI 强调色应在节点内可见。

用户可直接打开 `extensions/vscode/dev-session-canvas/images/marketplace/canvas-overview.mp4` 与 `.zh-CN.mp4` 验收；原始 take、逐帧转场 contact sheet、ANSI 证据和 validation report 保留在 `.debug/marketplace-media/`。

## 进度

- [x] (2026-07-15 21:20 +0800) 阅读录制 Skill、工作流和现有 compositor；从正式 MP4 生成两段密集 contact sheet，复现“先位移、后跳缩放”。
- [x] (2026-07-15 21:24 +0800) 定位 Agent 单色原因：录制环境继承 `TERM=dumb`、`NO_COLOR=1`；当前持久化 Agent 输出的 SGR 序列计数为 0，而 Webview xterm 已具备完整 ANSI 调色板。
- [x] (2026-07-15 21:44 +0800) 更新剧本、设计文档和录制 scenario，把第四个节点改成真实 Codex Agent，并明确新的任务、状态和收尾镜头。
- [x] (2026-07-15 22:08 +0800) 用固定尺寸 alpha layer + ffmpeg perspective 重写两段动态几何；30/90 帧 rect 连续性与实际 RGB 像素测试通过，隔离英文完整试渲染和 100ms contact sheet 目检通过。
- [x] (2026-07-15 22:47 +0800) 修复正式录制环境的颜色变量并补自动化测试；真实 Extension Host 像素冒烟确认 Claude truecolor 与 Codex 原生强调均可见。
- [x] (2026-07-15 23:28 +0800) 归档旧证据，重新录制四 Agent 的 Take A、Take B 与 16 个 checkpoint；第四个真实 Codex Agent 返回 `42 passed` 与 exit code 0。
- [x] (2026-07-15 23:55 +0800) 重新生成六份双语正式资产；完成 100ms 转场、颜色、`1180px / 375px`、完整解码、黑帧、Hero / GIF 尾帧和关键时间点目检。
- [x] (2026-07-16 00:07 +0800) 本次临时素材检查、脚本检查、构建、类型检查和 diff check 通过；正式文档、技术债与本计划同步并准备归档。

## 意外与发现

- 观察：返工前的 ffmpeg filter 同时给 `scale` 输出动态宽高、给 `overlay` 输出动态 x/y，但当时的最终 MP4 没有同步执行这两组变化。
  证据：`.debug/marketplace-media/review/compare-enter-motion.png` 显示 Root Groups 先向左下移动，随后从大窗跳到双窗尺寸；`pane-expand-motion.png` 显示 Pane Gallery 先向左上移动，最后才跳成大窗。稳定端点尺寸测试无法覆盖中间帧连续性。

- 观察：产品侧不是“只支持单色”。`extensions/vscode/dev-session-canvas/src/webview/main.tsx` 会读取 VS Code 的 16 个 ANSI token 并交给 xterm；Host 也会为执行会话补 `TERM` / `COLORTERM` fallback。
  证据：录制父进程实际为 `TERM=dumb`、`COLORTERM=`、`NO_COLOR=1`。`buildRecordingChildEnv()` 虽覆盖了 `TERM`，却没有删除 `NO_COLOR`；四个 root-local snapshot 中有 Agent 输出，但 SGR 序列总数为 0。

- 观察：第四个节点可以保持真实测试叙事而不需要 Terminal 节点。
  证据：`release-tools` disposable root 已有受 trigger 控制的 `run-e2e.sh`。把它交给真实 Codex Agent 执行，脚本仍经真实进程返回 `42 passed | exit code 0`，外部 trigger 只控制完成时机，不生成 Agent 文本或写 Webview state。

- 观察：移除 `NO_COLOR` 后，Claude 启动输出恢复 truecolor；Codex 普通对话仍主要使用默认前景色，这属于 provider 原生设计而不是 xterm 丢色。
  证据：隔离 PTY 中 Claude 启动输出包含 30 条 SGR，含 `38;2;215;119;87`、`38;2;255;193;7` 等 truecolor；Codex 包含 306 条 SGR，但启动界面主要是 reset、bold 与 italic。官方 Codex manual 说明 `tui.theme` 负责 fenced Markdown 代码块和 diff 的语法高亮，不承诺普通 prose 着色。

- 观察：ffmpeg `perspective` 的 `on` 计数从 1 开始，而纯 JS frame index 从 0 开始。
  证据：首次 actual-pixel test 的中间帧比预期前进一帧；把表达式改成 `max(on-1,0)` 后，全部抽样 rect 与纯函数预期一致。

- 观察：固定 alpha layer 必须让最外 1px 透明，否则 perspective 会把源图边缘颜色扩散到整个输出画布。
  证据：纯红 spike 在没有透明边时输出全红；增加透明 drawbox border 后，五个抽样帧均只在目标 rect 内出现红色，且连续缩放。

- 观察：真实 Host 中 TUI 颜色已经恢复，但持久化 `recentOutput` 仍不含 SGR；这是产品把快照归一化为纯文本，不代表 xterm 丢色。
  证据：四个正式 provider 进程的环境均为 `TERM=xterm-256color`、`COLORTERM=truecolor` 且没有 `NO_COLOR`；全分辨率像素显示 Claude 橙 / 黄 truecolor 与 Codex 青 / 绿强调，而同一时刻 canvas-state 的 `recentOutput` SGR 计数仍为 0。

- 观察：高负载下 `record-start` 返回时，ffmpeg x11grab 可能尚未写出首帧；不足约五秒的 scene 会保留操作前状态，而长录屏能完整捕获同一批原生输入。
  证据：Take A 的 `full-take.mp4` 完整包含四轮原生输入；若干短 Take B scene 的结尾 screenshot 已进入下一状态，但 MP4 仍停留在操作前。最终 Take B 只消费同一真实 Host 的长录屏和真实 checkpoint，不生成伪状态；显式录制 ready handshake 已登记技术债。

## 决策记录

- 决策：新建本轮 ExecPlan，不重开或改写 `marketplace-real-provider-media-rerecord.md`。
  理由：上一份完成计划如实记录了当时四节点中包含 Terminal、五段 compositor 和已通过的验收；本轮是新的用户反馈与验收边界，应保留历史证据。
  日期/作者：2026-07-15 / Codex

- 决策：第四个节点使用 `release-tools / Release Validation`，provider 为真实 Codex；前两个 provider 组合保持 `payments-api=Codex`、`storefront=Claude`、`design-system=Claude`。
  理由：形成两个 Codex、两个 Claude 的对称构图，并让真实 Agent 自己运行测试脚本，满足“不采用 Terminal”的明确要求。
  日期/作者：2026-07-15 / Codex

- 决策：颜色修复只作用于 disposable 正式录制子进程，不修改用户 shell、全局 Codex / Claude 配置或产品默认环境语义。
  理由：单色来自当前自动化执行环境的 `NO_COLOR`，不是产品缺陷；录制宿主本身是 PTY，应明确声明彩色终端能力。
  日期/作者：2026-07-15 / Codex

- 决策：不再依赖 ffmpeg 动态 `scale` 输出尺寸完成转场；使用固定 `1920x1200` 画布的逐帧构图，并让所有几何值来自同一纯函数。
  理由：固定画布避免 filter graph 在帧尺寸重配置时把位移和缩放分阶段应用；同一几何函数既能驱动生产帧，也能被测试逐帧验证。
  日期/作者：2026-07-15 / Codex

- 决策：Codex 录制命令使用官方示例 `tui.theme="catppuccin-mocha"` 的一次性覆盖，但不为普通 prose 伪造颜色。
  理由：官方 manual 只把 theme 定义为代码块与 diff 的语法高亮；成片应忠实呈现 provider 原生视觉，颜色验收区分 Claude truecolor 与 Codex 原生强调样式。
  日期/作者：2026-07-15 / Codex

- 决策：转场使用带 1px 透明边的固定全画布 layer，再由 `perspective` 按四角坐标完成 affine transform。
  理由：这条路线保持每帧视频尺寸不变，实际像素测试可以测量完整运动轨迹；相比 120 张浏览器 screenshot，渲染更直接且不增加新依赖。
  日期/作者：2026-07-15 / Codex

- 决策：颜色的正式验收使用“child 环境 + 全分辨率真实 Host 像素”，不要求持久化 `recentOutput` 保留控制序列。
  理由：`recentOutput` 的职责是可恢复纯文本快照，归一化会移除 SGR；强迫它保留 ANSI 会把媒体验证扩散成产品持久化语义变更，也不能替代用户实际看到的像素。
  日期/作者：2026-07-15 / Codex

- 决策：本轮 Take B 在后期只组织同一真实 Host 的长录屏与 checkpoint，不重绘任何 Agent 或状态；短 scene ready 延迟不在媒体任务中顺手改录制器。
  理由：正式状态、文字、颜色、attention 和测试结果都已有真实像素证据；录制 ready handshake 是独立工具可靠性问题，应在不改变本次成片状态的前提下单独修复和测试。
  日期/作者：2026-07-16 / Codex

## 结果与复盘

本轮已经闭合用户提出的三项返工。四个 root 的唯一执行节点全部是 Agent，`release-tools / Release Validation` 由真实 Codex 运行 `./run-e2e.sh`，成片能辨认 `42 passed` 与 exit code 0；两个动态窗口段的 30 / 90 帧均在固定画布中同步改变 x、y、width、height，100ms contact sheet 没有发现阶段式平移或跳缩放；正式 child 移除 `NO_COLOR` 后，Claude truecolor 与 Codex 原生强调在源 Host 和成片中可见。

英文与中文六份正式资产均通过 staged validation。两条 MP4 为 `1920x1200`、1800 帧、60 秒且无黑帧；两条 GIF 为 `1440x900`、8 帧、10 秒；两张 PNG 为 `1920x1200`，显式 Hero 为 `attention-arrives`。`1180px / 375px` 预览、完整解码、本次临时素材检查、build、typecheck 与 diff check 均通过。

唯一遗留是 x11grab 在高负载短 scene 中缺显式首帧 ready handshake。本次正式 Take B 只使用同一真实 Host 的长录屏和真实 checkpoint 收口，没有 fake provider 或重绘状态；工具可靠性风险已进入技术债，不阻塞当前六份资产。

## 上下文与定向

`docs/marketplace-media-scenario.md` 定义四 root、任务文本、60 秒时间线与验收规则。`scripts/media/recording-session.mjs` 准备 disposable workspace、真实 provider 环境、原生输入和源录制；`FOUR_ROOT_DEFINITIONS` 现在包含两个 Codex 与两个 Claude Agent，`prepareFourRootScenario()` 为 `release-tools` 写入由 Agent 调用的 `run-e2e.sh`。

`scripts/media/compose-marketplace-media.mjs` 把 MP4 拆为 Take A、比较进入、比较稳定、Pane Gallery 扩展、Pane Gallery 稳定五段。返工前两个动画段分别通过动态 `scale` 和动态 `overlay` 表达 rect；当前实现改为固定 `1920x1200` alpha layer，并由 `perspective` 按同一 rect 函数同步映射四角，继续保留五段低内存边界。

`.debug/marketplace-media/` 当前保存本轮四 Agent 源录制、16 个 checkpoint、pair manifest、双语 composite、review 与 validation report；返工前证据位于时间戳 archive。录制器会在新 session 前归档这些目录，不能覆盖 archive，也不能删除用户目录中的认证或 CLI 状态。

## 工作计划

先更新剧本与正式设计状态。将 `release-tools / E2E Tests` Terminal 改为 `release-tools / Release Validation` Codex Agent，固定任务为运行 `./run-e2e.sh`、只汇报测试结果、不修改文件；Take A 第四轮与 Take B 收口镜头都改成操作该 Agent。设计文档的验证状态暂时降回“验证中”，并关联本计划。

随后修录制环境。`buildRecordingChildEnv()` 为 scenario child 显式设置 `TERM=xterm-256color` 与 `COLORTERM=truecolor`，删除 `NO_COLOR`；测试必须证明 legacy fixture 路径不被无意扩大。`prepareFourRootScenario()` 无论节点 kind 都为 `release-tools` 写入受控脚本。用隔离 PTY 先统计 Codex / Claude 启动输出中的 SGR，再在真实 Host screenshot 中确认颜色可见。

转场实现使用一个纯函数按 frame index 返回 eased rect。比较进入为 30 帧：Root Groups 从单窗同步平移缩小到左双窗，Pane Gallery 从画布右侧进入右双窗；Pane Gallery 扩展为 90 帧：Root Groups 平滑退出左侧，Pane Gallery 从右双窗同步平移放大到单窗。浏览器或固定帧合成器必须在固定 `1920x1200` 输出上绘制每一帧，再由 ffmpeg 编码，不允许中间 filter 重新协商可变视频尺寸。

正式录制继续使用真实系统 CLI。Take A 四轮都从全览开始并回到全览；第四个 Codex 提交后保持 running，Take B 聚焦它时触发脚本完成并等待真实 Agent 返回汇总。所有 checkpoint 重新捕获，因为节点 kind、标题与状态都已变化。

最后重渲染中英文六份资产。除既有关键时间点外，按每 `100ms` 生成两段转场 contact sheet，并逐帧检查没有 geometry jump；至少选择 Codex 和 Claude 各一张全分辨率帧验证 ANSI 强调色。所有门禁通过后更新设计证据并归档计划。

## 具体步骤

所有命令从仓库根目录运行。定向开发与预检至少包括：

    node --check scripts/media/recording-session.mjs
    node --check scripts/media/compose-marketplace-media.mjs
    node scripts/media/compose-marketplace-media.mjs validate --manifest .debug/marketplace-media/pair-manifest.json

正式录制使用：

    node scripts/media/recording-session.mjs start --scenario four-root-attention
    node scripts/media/recording-session.mjs record-sequence --take rootGroups --scene <scene> --actions <json>
    node scripts/media/recording-session.mjs checkpoint <frame-id> --take <take>
    node scripts/media/recording-session.mjs trigger e2e-complete
    node scripts/media/recording-session.mjs close

最终合成与仓库门禁使用：

    node scripts/media/compose-marketplace-media.mjs render --manifest .debug/marketplace-media/pair-manifest.json --language en
    node scripts/media/compose-marketplace-media.mjs render --manifest .debug/marketplace-media/pair-manifest.json --language zh-CN
    npm run build
    npm run typecheck
    git diff --check

## 验证与验收

四个 root 的唯一执行节点都必须是 Agent。`release-tools` metadata 必须为 `kind=agent`、`provider=codex`，画面不能出现 Terminal node header 或 `/usr/bin/bash` backend label。它提交任务后由 Codex 真实执行 `./run-e2e.sh`，最终 Agent TUI 内能辨认 `42 passed` 与 exit code 0。

颜色验收同时检查环境和像素。正式 child metadata 或进程环境证明 `TERM=xterm-256color`、`COLORTERM=truecolor`、`NO_COLOR` 不存在；源 screenshot 与最终关键帧能看到 provider 自带强调色，而不是仅节点边框有颜色。持久化 `recentOutput` 可以是去 SGR 的纯文本，不作为颜色失败条件。

比较进入的 30 帧和 Pane Gallery 扩展的 90 帧中，目标窗口 rect 必须单调接近终点。相邻帧不能先只改变位置、随后单帧跳变尺寸；稳定端点的实际像素边界误差不超过 2px，带 1px 透明边与 H.264 抗锯齿的动态帧测量容差不超过 6px，单帧 x/y/width/height 变化不超过按总差值和 easing 导出的上限。段首、段尾分别与相邻稳定段 rect 连续。

其余既有验收继续成立：两条 take 与所有 checkpoint 为 `1440x900`；两条 MP4 为 `1920x1200`、30 fps、1800 帧、60 秒且无黑帧；两条 GIF 为 `1440x900`、8 帧、10 秒；两张 PNG 为 `1920x1200` 且 Hero 为 `attention-arrives`；中英文在 `1180px` 与 `375px` 可读。

## 幂等性与恢复

颜色与 provider spike 只使用 `.debug/marketplace-media/runtime` 和 disposable workspace。若任一真实 CLI 出现认证、权限、网络或工具确认提示，停止当前 scene 并在录制外处理，不退回 fake provider。新 session 自动 archive 当前证据；只重录失败 scene 和受影响 checkpoint。

逐帧转场 frame sequence 是可再生中间产物，render 开始时可以清空对应语言的 composite work dir。正式资产仍只在该语言 MP4/GIF/PNG 全部通过 validation report 后原子替换；失败时保留上一版正式文件。

## 证据与备注

返工前父环境与持久化输出证据：

    TERM=dumb
    COLORTERM=
    NO_COLOR=1
    Agent recentOutput SGR sequences: 0

返工前转场失败证据已保存在时间戳 archive；当前通过证据为：

    .debug/marketplace-media/review/compare-enter-motion.png
    .debug/marketplace-media/review/pane-expand-motion.png
    .debug/marketplace-media/review/colors/codex-window-contact.png
    .debug/marketplace-media/review/colors/claude.png
    .debug/marketplace-media/review/colors/release-agent.png

## 接口与依赖

本轮不增加 npm 运行时依赖，继续使用 Playwright、ffmpeg、X11 原生输入和 `@vscode/test-electron`。`recording-session.mjs` 的 `FOUR_ROOT_DEFINITIONS` 必须包含四个 Agent；正式 child env builder 负责彩色终端能力，不把环境修复扩散到用户进程。

`compose-marketplace-media.mjs` 应提供可测试的 rect 插值接口，例如 `resolveCompareEnterLayout(frameIndex)` 与 `resolvePaneExpandLayout(frameIndex)`，并让生产逐帧 renderer 直接消费这些结果。任何实现名称可以调整，但不能让测试复制另一套几何公式。

最后更新说明：2026-07-16 00:07 +0800，四 Agent 真实宿主录制、彩色 TUI、固定画布连续转场、双语六份资产与完整门禁均已收口；计划已归档到 completed。
