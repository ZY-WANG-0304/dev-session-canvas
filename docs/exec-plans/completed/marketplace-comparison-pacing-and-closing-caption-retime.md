# 收紧双模式节奏并同步收尾字幕

本 `ExecPlan` 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘`。本文按照仓库根目录下的 `docs/PLANS.md` 持续维护。

## 目标与全局图景

当前动态修复版已经让双模式比较和 Pane Gallery 故事全部播放真实连续录屏，但两个剪辑时机仍拖慢叙事：双模式字幕消失后还空等约九秒，收尾字幕又比点击 `globe` 回到全局视角早约三秒。完成本计划后，双模式字幕消失后约 `0.2s` 就开始扩展 Pane Gallery；`See the whole picture. Focus with ease.` 及对应中文字幕与 `globe` 点击同时出现，并在产品自身回全览动画期间保持可读。现有 60 秒动态版先完整归档，新版约为 54 秒。

这次只调整后期时间线和连续源的时间重映射，不重新运行真实 Agent，也不改变 GIF、PNG、剧本文案或产品代码。人可以直接播放新版 MP4 验收：约 `25.8s` 比较字幕消失，约 `26.0s` 开始下一转场；约 `49.2s` 鼠标点击 `globe` 的同时出现收尾字幕，随后至少保留约四秒真实动态全览。

## 进度

- [x] (2026-07-17 06:13Z) 读取仓库工作流、计划规范、录制 Skill、当前剧本、设计文档、manifest、compositor 和测试。
- [x] (2026-07-17 06:18Z) 定位两项节奏问题及其当前时间：比较字幕约 `25.8s` 消失、转场 `35s` 开始；收尾字幕 `55s` 出现、globe 约 `58.2s` 点击。
- [x] (2026-07-17 06:22Z) 将当前 60 秒中英文动态版、manifest、validation report 和验证摘要归档到 `.debug/marketplace-media/archive/2026-07-17-live-motion-60s-baseline/`，十项 SHA-256 复核通过。
- [x] (2026-07-17 06:27Z) 从既有 Pane Gallery 原始连续 take 生成 `live-timeline-retimed-v2.mp4`；probe 为 `44.167s / 1325` 帧，globe 后保留约 4.9 秒真实动态全览。
- [x] (2026-07-17 06:35Z) 把 compositor、测试和 manifest 改为约 54 秒时间线；manifest validate 与定向 source probe 测试通过，完整媒体测试留待最终门禁。
- [x] (2026-07-17 06:38Z) 更新剧本、正式设计文档及设计索引中的时间线，并将设计验证状态暂时降为“验证中”。
- [x] (2026-07-17 07:24Z) 渲染并发布中英文六份资产；两份 validation report、完整解码、blackdetect、动态唯一帧和逐帧时序验收全部通过。
- [x] (2026-07-17 07:31Z) 完成十四项媒体测试、manifest validate、build、typecheck、脚本语法和 diff 检查，并同步正式设计结论。
- [x] (2026-07-17 07:34Z) 将本计划收口并准备移入 `docs/exec-plans/completed/`；最终 hash、验证证据和 renderer 边界均已记录。

## 意外与发现

- 观察：现有比较稳定段长 15 秒，但比较字幕只显示其中前 5.8 秒。
  证据：`scripts/media/compose-marketplace-media.mjs` 中 `COMPARE_STABLE_DURATION_SECONDS = 15`，字幕使用 `enable: 'lte(t,5.8)'`；因此最终时间线从约 `25.8s` 到 `35s` 没有新叙事信息。
- 观察：现有收尾字幕在 Pane stable 相对 `17.0s` 出现，而可见 globe 点击位于相对约 `20.2s`。
  证据：旧成片的字幕从最终 `55s` 开始；`.debug/marketplace-media/review/live-rerecord/live-motion-validation.json` 记录 globe 为 `58.2s`。
- 观察：当前重映射源在 globe 点击后只保留约两秒，不能在字幕后移的同时给文案留下足够阅读时间。
  证据：`.debug/marketplace-media/sources/paneGallery/live-timeline-retimed.mp4` 为 `41.167s`，globe 位于该源约 `39.2s`。
- 观察：新重映射源在 `39.233s` 仍为 release-tools 聚焦画面，`39.267s` 已进入产品自身的 dynamic 回归动画。
  证据：`.debug/marketplace-media/review/pacing-retime/globe-click-sequence.png` 连续覆盖源时间 `38.900-39.600s`；因此 Pane stable 相对 `20.2s` 是收尾字幕与 globe 点击同步的合适帧边界。
- 观察：英文渲染一次通过，但中文渲染连续两次在首张 `2560x1600` 背景截图达到 60 秒超时；失败前没有写出中间帧，也没有替换中文 canonical 资产。
  证据：两次 Playwright 错误均为 `page.screenshot: Timeout 60000ms exceeded`；失败后没有残留 Chromium/ffmpeg 进程，系统仍有约 396 GiB available memory 与 996 GiB 可用磁盘。
- 观察：Playwright 的完整 Chromium CLI 会为 headless window 保留约 87px 非页面高度，直接截图虽满足文件尺寸但底部出现横带；同版本 `chromium_headless_shell` 的 CLI viewport 与请求尺寸精确一致。
  证据：纯红色 `800x600` 页面在完整 Chromium 中需要 `800x687` window 才能覆盖 600px 页面，而缓存中的 `chromium_headless_shell-1217` 直接输出无横带的 `800x600`。

## 决策记录

- 决策：保留 19 秒 Root Groups 开场、1 秒比较进入和 3 秒 Pane Gallery 扩展，只把比较稳定段从 15 秒缩短为 6 秒。
  理由：四次 Agent 输入和两次几何转场已经验收；用户反馈只针对字幕结束后的空等，稳定段 6 秒仍完整覆盖比较字幕到 `5.8s`。
  日期/作者：2026-07-17 / Codex。
- 决策：目标时间线设为 54 秒，Pane Gallery 故事稳定段延长为 25 秒。
  理由：缩短九秒无信息比较段后，把其中三秒用于 globe 后的动态全览，使收尾字幕与点击同步后仍可阅读约四至五秒；总时长净缩短六秒。
  日期/作者：2026-07-17 / Codex。
- 决策：从 85.40 秒的原始连续 Pane take 重新生成时间重映射源，不重新录制 Codex 或 Claude，也不使用定帧补尾。
  理由：原始 take 已包含同一次录制中的完整操作和更长动态全览；连续重映射能保留真实 UI 像素、鼠标轨迹及产品动画。
  日期/作者：2026-07-17 / Codex。
- 决策：GIF 和 PNG 不重新设计，只随 compositor 重新导出并验证 hash/几何。
  理由：本次反馈只涉及 MP4 连续时间线；两类静态资产继续使用既定八帧 storyboard 和显式 Hero。
  日期/作者：2026-07-17 / Codex。
- 决策：曾把 compositor 单张 Playwright 截图超时从 60 秒临时提高到 120 秒用于诊断；确认同一最小页面仍超时后恢复 60 秒默认值。
  理由：延长等待不能修复 `Page.captureScreenshot` 卡死，保留原等待上限并使用显式备选 renderer 能更快失败和恢复。
  日期/作者：2026-07-17 / Codex。
- 决策：增加显式的 `DSC_MEDIA_SCREENSHOT_RENDERER=chrome-cli` 截图路径；它仍先在 Playwright 页面中加载并验证字体，再让同一 Playwright Chromium 可执行文件通过 headless CLI 捕获 HTML。
  理由：最小纯色页面也能稳定复现 `Page.captureScreenshot` 卡死，但同版本 Chromium headless shell 的 `--screenshot` 命令在一秒内成功；显式备选路径不改变默认 renderer，并继续校验 `2560x1600` 输出几何。
  日期/作者：2026-07-17 / Codex。

## 结果与复盘

计划已完成。英文 MP4 SHA-256 为 `c43f9c73c82cb22b594aefb7bee68b0805f8e7029b49e0714d27665f10e8e803`，中文 MP4 为 `1b398c44de5fa863b0c524180440d443430ff7474c4693c58701407dc8027984`；两者均为 `1920x1200`、30 fps、1620 帧、54 秒。英文和中文 GIF/PNG 的 hash 与保留版一致，证明本轮只改变 MP4 节奏，没有改变静态素材像素。

比较字幕最后可见于 `25.800s`，`25.833s` 已消失，Pane Gallery 首个几何运动帧为 `26.033s`，间隔 `0.233s`。globe 点击和收尾字幕首帧同为 `49.200s`，`49.267s` 已进入产品自身的 dynamic 回归动画，字幕在点击后保持约 `4.767s`。中英文比较左右窗口均为 `12/12` 唯一采样帧，Pane 故事均为 `50/50`；六份资产完整解码，blackdetect 为 0 命中。

十四项媒体测试、manifest validate、两个脚本语法检查、`npm run build`、`npm run typecheck` 与 `git diff --check` 全部通过。逐帧证据和机器可读结果位于 `.debug/marketplace-media/review/pacing-retime/`，当前 60 秒动态版保存在 `.debug/marketplace-media/archive/2026-07-17-live-motion-60s-baseline/`。唯一额外发现是维护机上的 Playwright `Page.captureScreenshot` 一度可稳定卡死；新增的显式 `chrome-cli` renderer 使用同版本 headless shell，并以中文 GIF/PNG hash 完全不变证明输出等价，默认 renderer 仍保持 Playwright。

## 上下文与定向

正式资产位于 `extensions/vscode/dev-session-canvas/images/marketplace/`；英文文件不带语言后缀，中文文件使用 `.zh-CN`。`.debug/marketplace-media/pair-manifest.json` 把逻辑片段映射到真实 `1440x900` 连续录屏和 16 张 checkpoint。`scripts/media/compose-marketplace-media.mjs` 校验 manifest、生成五段 MP4 并串接，同时生成 10 秒 GIF 和 Hero PNG；`scripts/media/compose-marketplace-media.test.mjs` 覆盖时间线映射、源边界、窗口布局和动态内容。

Root Groups 连续源为 `.debug/marketplace-media/sources/rootGroups/live-timeline-clean.mp4`，当前为 `42.30s / 1269` 帧。Pane Gallery 原始连续 take 为 `.debug/marketplace-media/sources/paneGallery/live-timeline.mp4`，当前为 `85.40s / 2562` 帧；现有 60 秒版消费的重映射源为 `live-timeline-retimed.mp4`，它把原始绝对约 `25-70s` 映射为约 `41.17s`。这里的“连续”表示相邻成片段消费同一文件的相邻时间戳，而不是用 checkpoint、循环图片或 freeze frame 接缝。

## 工作计划

先把当前 canonical 六份资产、pair manifest、两份 validation report 和动态验证摘要复制到新的只读式归档目录，并生成 checksum。随后从原始 Pane take 的绝对约 `25-73.5s` 生成 `live-timeline-retimed-v2.mp4`：前 16 秒保持 1 倍速，之后约 32.5 秒轻微压缩为约 28.2 秒。这样 eye 仍位于重映射源约 `16s`，globe 仍位于约 `39.2s`，结尾延长到约 `44.2s`，且全程来自同一条真实录屏。

修改 compositor 常量为 19 秒开场、1 秒比较进入、6 秒比较稳定、3 秒 Pane 扩展和 25 秒 Pane 稳定，共 54 秒。manifest 让 Pane 比较消费新源 `9-16s`，Pane 故事从 `16s` 开始连续消费 28 秒；Root 比较从原源 `19s` 开始消费 10 秒。收尾字幕在 Pane stable 相对约 `20.1s` 首次出现，产品名在约 `23.5s` 出现。

同步更新测试中的总时长、合成帧数语义、最小测试源长度、manifest duration 和 source offset。再更新 `docs/marketplace-media-scenario.md` 及 `docs/design-docs/marketplace-readme-media-automation.md`，明确 54 秒分段与本轮验收证据。只有两种语言的 staged 输出和全部门禁都通过后，才让 compositor 替换 canonical 资产并恢复设计文档的“已验证”状态。

## 具体步骤

所有命令均从仓库根目录执行。核心命令为：

    ffmpeg -y -hide_banner -loglevel error -ss 25 -t 48.5 -i .debug/marketplace-media/sources/paneGallery/live-timeline.mp4 -filter_complex "[0:v]trim=start=0:end=16,setpts=PTS-STARTPTS[first];[0:v]trim=start=16:end=48.5,setpts=(PTS-STARTPTS)*28.2/32.5[second];[first][second]concat=n=2:v=1:a=0,fps=30,format=yuv420p[out]" -map "[out]" -an -c:v libx264 -preset veryfast -crf 18 .debug/marketplace-media/sources/paneGallery/live-timeline-retimed-v2.mp4
    node --test scripts/media/*.test.mjs
    node scripts/media/compose-marketplace-media.mjs validate --manifest .debug/marketplace-media/pair-manifest.json
    node scripts/media/compose-marketplace-media.mjs render --manifest .debug/marketplace-media/pair-manifest.json --language en
    node scripts/media/compose-marketplace-media.mjs render --manifest .debug/marketplace-media/pair-manifest.json --language zh-CN

渲染后还要运行两条 MP4 的完整解码、`blackdetect`、时序抽帧和动态唯一帧检查，并运行 `npm run build`、`npm run typecheck`、脚本语法检查及 `git diff --check`。

## 验证与验收

必须同时满足以下条件：两条 MP4 均为 `1920x1200`、30 fps、约 54 秒和 1620 帧；比较字幕最后可见帧到 Pane Gallery 转场首个运动帧的间隔不超过 0.3 秒；收尾字幕首次可见帧与 globe 点击反馈相差不超过 0.3 秒；点击后字幕至少保持约四秒；eye、payments、Agent、决策、release、globe 和动态回全览继续可见；`42 passed` 与 exit code 0 保留；比较左右窗口和 Pane 故事的采样帧均持续变化；六份资产可完整解码且没有 blackdetect 命中；全部媒体测试、manifest 校验、build、typecheck、语法和 diff 检查通过。

## 幂等性与恢复

归档目录使用固定日期与版本语义命名，创建后不覆盖其中内容。新重映射源是从既有原始 take 派生的缓存，可安全重复生成。compositor 先写 staged output，validation report 全部通过后才原子替换 canonical 文件；渲染失败时保留已归档的 60 秒版，并修复源、manifest 或脚本后重试。不得删除旧重映射源、历史归档或真实录制证据。

## 证据与备注

保留基线为英文 MP4 `ebe8789b986d784c778ace7370914e612112996169a49bb59c96d76a3ef65d4c`、中文 MP4 `a5f4f3140e6aeaa056208ceab336316e1de33487dbfd2cc0fe8654cf9df4e0a3`；两者均为 60 秒、1800 帧。新版 probe 为两条 MP4 各 54 秒、1620 帧；`.debug/marketplace-media/review/pacing-retime/PUBLISHED_SHA256SUMS` 覆盖六份正式资产、manifest、两份 validation report、新 Pane 连续源与机器可读时序验证。

## 接口与依赖

不增加 npm 依赖。继续使用仓库已有的 Node.js ESM、Playwright、ffmpeg/ffprobe、Noto Sans CJK 字体和 Linux 媒体检查工具。`validateManifestStructure()` 必须继续强制 Root 与 Pane 相邻逻辑片段使用同一文件和精确相邻 `inMs`；`resolveVideoTimelineSources()` 必须把五个成片段映射到连续视频时间戳；`buildValidationReport()` 的 MP4 时长期望改为 54 秒。

计划修订说明（2026-07-17 07:34Z）：中英文正式资产、时序与完整项目门禁全部通过；补齐最终 hash、逐帧证据和 renderer 发现，计划进入 completed。
