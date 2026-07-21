# 重录动态双视图与连续 Pane Gallery 宣传片

本 `ExecPlan` 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘`。本文按照仓库根目录下的 `docs/PLANS.md` 持续维护。

## 目标与全局图景

当前 60 秒宣传片的窗口几何转场已经连续，但 `19-35s` 左右比较和 `38-60s` Pane Gallery 故事中混入了真实宿主 checkpoint 定帧。用户因此看不到两侧 Agent TUI 与 attention 的持续动效，也看不到点击 `eye` 和 `globe` 的因果过程。完成本计划后，旧版六份资产仍保存在 `.debug/marketplace-media/archive/2026-07-17-static-frame-baseline/`；新 MP4 的比较段同时播放两条真实宿主视频，Pane Gallery 从 `dynamic`、点击 `eye`、聚焦和回复，到点击 `globe` 回到 `dynamic` 全部来自一条不中断的真实录屏。GIF 与 PNG 仍可使用经审阅的真实 checkpoint，因为它们本来就是静态 storyboard 与 Hero。

人可以通过逐帧查看新 MP4 直接验收：左右两侧在比较段都有跨帧像素变化；鼠标明确移动并点击 `eye`；聚焦后的 Agent TUI 连续播放；收尾鼠标明确点击 `globe`，随后四 pane 以产品自身布局动画恢复。正式素材继续使用系统中已登录的真实 Codex CLI 与 Claude Code CLI，不使用 fake provider 或后期重绘 Agent 状态。

## 进度

- [x] (2026-07-17 04:43Z) 读取仓库工作流、计划规范、录制 Skill、当前剧本、设计文档和现有录制/合成代码。
- [x] (2026-07-17 04:45Z) 将当前六份发布资产、两份 validation report 和旧 manifest 归档，并生成九项 SHA-256 校验清单。
- [x] (2026-07-17 04:53Z) 将设计文档降为“验证中”，把 MP4 连续真实视频边界和本轮验收同步到剧本、设计注册表与录制 Skill。
- [x] (2026-07-17 04:53Z) 为 `record-start` 增加 ffmpeg 首帧 ready handshake，并用自动化测试覆盖进度解析、首帧条件和超时错误。
- [x] (2026-07-17 05:22Z) 将 compositor manifest 扩展为两条比较视频与一条连续 Pane Gallery 故事视频，并禁止 MP4 比较段从 checkpoint 循环生成；正式 manifest v2 已通过 source probe。
- [x] (2026-07-17 04:53Z) 补足输出级测试，证明左右比较窗口内部跨帧变化，且 Pane Gallery 单画面继续消费视频帧。
- [x] (2026-07-17 05:22Z) 启动同一个真实 Extension Development Host，使用两个 Codex 与两个 Claude Code Agent 录制新的动态比较素材和连续 Pane Gallery 素材。
- [x] (2026-07-17 05:42Z) 生成中英文修复版，完成解码、尺寸、帧数、黑帧、动态性、可见点击、产品布局动画、字体颜色和 README 尺寸目检。
- [x] (2026-07-17 05:42Z) 更新验证证据、收口技术债并将本文移入 `docs/exec-plans/completed/`。

## 意外与发现

- 观察：上一版为绕过高负载 X11 下短 scene 的首帧延迟，使用真实 checkpoint 组织了部分 MP4 时间线；这保住了状态真实性和窗口几何连续性，却把本应播放的产品动效变成静态画面。
  证据：修复前 `scripts/media/compose-marketplace-media.mjs` 的 `compareEnter` 与 `compareStable` 使用 `loopedImageInput(...)`，当时的设计证据也记录了“从长录屏与真实 checkpoint 组织状态时间线”。
- 观察：修复前 `record-start` 只在 spawn ffmpeg 后固定等待 300ms，高负载时返回不代表 x11grab 已编码首帧。
  证据：旧 `cmdRecordStart()` 末尾只有 `await delay(300)`；修复版的三条真实 X11 scene 都在 progress 报告首帧后才开始动作，该限制已从技术债列表移入“近期已收口”。
- 观察：要让 19 秒与 35 秒两个剪辑点也没有内容跳变，仅仅把 checkpoint 换成三条独立视频仍不够；相邻段必须引用同一个源文件的相邻时间戳。
  证据：manifest v2 现在强制 `takes.rootGroups.clip -> comparisonClips.rootGroups` 在 19000ms 连续，并强制 `comparisonClips.paneGallery -> takes.paneGallery.clip` 在 16000ms 连续；结构测试会拒绝不同路径或相差 1ms 的边界。
- 观察：第一条 Root take 的 Claude 会话在后半段请求读取 workspace；原生点击与录制本身正常，但 permission UI 不符合剧本。
  证据：`.debug/marketplace-media/review/live-rerecord/root-live-contact.png` 显示两条 Bash permission prompt；该 take 未进入 manifest。拒绝提示并重启四个真实会话后，`.debug/marketplace-media/review/live-rerecord/root-live-clean-contact.png` 的 42.30 秒 take 没有权限框。
- 观察：Pane 原始 take 因录制启动后的人工作业准备与逐命令进程开销长达 85.40 秒，但所有动作在同一条 x11grab 视频中连续且完整。
  证据：原片从约 25 秒开始的连续区间包含 dynamic、eye、payments、decision、release result、globe 与 dynamic；连续时间重映射后 `.debug/marketplace-media/sources/paneGallery/live-timeline-retimed.mp4` 为 41.17 秒、1235 帧，没有 checkpoint 或冻结帧。

## 决策记录

- 决策：保留旧 canonical 资产的完整归档，修复版通过 staged 输出验收后再替换 canonical 六份文件。
  理由：用户明确要求保留当前版本；归档同时保留二进制、manifest、validation report 和 checksum，比只改文件名更可追溯，也不让 Marketplace README 同时携带两套正式引用。
  日期/作者：2026-07-17 / Codex。
- 决策：MP4 比较段新增两条独立 `1440x900` 连续视频输入；不再允许用 checkpoint 或单帧 loop 代替任一侧。
  理由：左右形态来自不同的真实产品模式，必须各自有持续像素变化，才能展示 Agent TUI、attention 与运行态动效。
  日期/作者：2026-07-17 / Codex。
- 决策：Pane Gallery 的 `dynamic -> eye -> sideThumbnails -> payments-api -> decision -> release-tools -> globe -> dynamic` 使用一次 `record-start` 和一次 `record-stop` 完成。
  理由：单条连续 take 天然保留鼠标点击、产品布局动画和 TUI 时间连续性，也消除了 scene 拼接造成闪跳或卡帧的空间。
  日期/作者：2026-07-17 / Codex。
- 决策：Root Groups 开场与比较/退出录为一条连续源，Pane Gallery 比较与完整故事也录为一条连续源；manifest 用不同 `inMs` 切出逻辑段。
  理由：这样 19 秒从单 Root Groups 进入比较，以及 35 秒从比较进入 Pane Gallery 扩展时，产品内容与窗口几何都连续，不会用另一个 take 的近似首帧制造细小闪跳。
  日期/作者：2026-07-17 / Codex。
- 决策：GIF/PNG 继续消费真实 checkpoint；本轮禁止定帧的约束只针对 MP4。
  理由：GIF 的既定设计是八张有明确停留时间的 storyboard，PNG 是显式 Hero；把它们改成长视频抽帧不会修复用户反馈，反而削弱可追溯性。
  日期/作者：2026-07-17 / Codex。
- 决策：Pane 原始连续 take 的前 16 秒保持 1×，后 29 秒真实交互轻微加速为 25.2 秒，形成 manifest 消费的 41.17 秒连续视频。
  理由：这让现有 60 秒时间线完整保留每个可见点击和产品动画，同时不通过删帧故事段、定帧或插入 checkpoint 压缩时长；时间重映射边界位于 eye 动作起点，前后来自原片相邻帧。
  日期/作者：2026-07-17 / Codex。

## 结果与复盘

计划已完成。修复版仍使用 canonical 六份路径；英文 MP4 SHA-256 为 `ebe8789b986d784c778ace7370914e612112996169a49bb59c96d76a3ef65d4c`，中文 MP4 为 `a5f4f3140e6aeaa056208ceab336316e1de33487dbfd2cc0fe8654cf9df4e0a3`。GIF/PNG 继续使用上一版已验收的真实 checkpoint，hash 未变化。旧六件套、旧 manifest、两份 validation report 和九项 checksum 保存在 `.debug/marketplace-media/archive/2026-07-17-static-frame-baseline/`。

录制宿主实际使用 Codex CLI `0.144.5` 与 Claude Code `2.1.209`。Root Groups 正式源是 `.debug/marketplace-media/sources/rootGroups/live-timeline-clean.mp4`，`42.30s / 1269` 帧；Pane Gallery 原始 take 是 `.debug/marketplace-media/sources/paneGallery/live-timeline.mp4`，`85.40s / 2562` 帧，连续时间重映射源是 `.debug/marketplace-media/sources/paneGallery/live-timeline-retimed.mp4`，`41.17s / 1235` 帧。manifest v2 确保 Root 的开场/比较和 Pane 的比较/故事分别消费同一文件的相邻时间戳。

用户提出的四个可见问题全部闭合：中英文比较段的左右窗口各为 `30/30` 个唯一采样帧；Pane 故事为 `44/44` 个唯一采样帧；`35.05s` 能看到鼠标位于 eye/focus，随后布局连续展开；`58.2s` 能看到鼠标位于 globe，`58.4s` 已进入回全览动画。`Release Validation` 在主画面中显示真实 `42 passed` 与 exit code 0，Codex/Claude ANSI 字体颜色在全分辨率源和成片中可见。

验证结果为：本次临时素材检查通过；manifest validate、两个脚本语法检查、`npm run build`、`npm run typecheck`、`git diff --check` 通过；六份资产完整解码；两条 MP4 均为 `1920x1200`、30 fps、1800 帧、60 秒且 blackdetect 无命中；GIF 均为 `1440x900`、8 帧、10 秒；PNG 均为 `1920x1200`。唯一保留的相关维护边界是既有旧 `stop` 仍有历史导出副作用，本轮继续只使用 `close`，该独立技术债没有扩大。

## 仓库上下文

`scripts/media/recording-session.mjs` 启动 Xvfb、窗口管理器与真实 VS Code Extension Development Host，并通过 X11 原生鼠标和键盘录制 `1440x900` MP4。`cmdRecordStart()` 负责启动 ffmpeg，`cmdRecordStop()` 负责停止并 probe 文件。`scripts/media/compose-marketplace-media.mjs` 读取 `.debug/marketplace-media/pair-manifest.json`，生成固定 60 秒、`1920x1200` 的中英文 MP4，以及 `1440x900` GIF 和 `1920x1200` PNG。当前时间线是 19 秒 Root Groups、1 秒比较进入、15 秒比较稳定、3 秒 Pane Gallery 扩展和 22 秒 Pane Gallery 故事。

`docs/marketplace-media-scenario.md` 是唯一剧本；`docs/skills/recording-marketplace-media/SKILL.md` 只定义真实宿主录制边界；`docs/design-docs/marketplace-readme-media-automation.md` 记录正式媒体决策与验证证据。修改任何一处规则时必须同步另外两处，不能把录制方法、后期方案和已验证结论混写。

“checkpoint”是录制外抓取的一张真实宿主 PNG，适合 GIF storyboard 和 PNG Hero，但没有时间维度。“连续 take”是一条从真实宿主 x11grab 得到的 MP4；本计划要求 MP4 中所有交互与动效都来自连续 take。“ready handshake”是 ffmpeg 通过 `-progress` 文件报告至少编码一帧后，`record-start` 才允许后续原生输入开始。

## 里程碑一：收口录制与 manifest 契约

先修复录制首帧竞争。给 ffmpeg 增加唯一的 progress 文件，轮询已完整写入的 `frame=<number>` / `progress=continue` 键值，直到 `frame >= 1`。等待过程必须同时检查 ffmpeg 是否提前退出；达到明确超时时间仍无首帧时，停止进程、清理 session 的活动 clip 字段并报出包含 progress 路径的错误。`record-stop` 在成功 probe 后清理 progress 文件。本轮曾用不跟踪的临时故障注入命令检查空内容、部分写入、首帧、超时和进程退出条件；这些场景不作为当前素材的长期仓库测试契约。

然后把 manifest 从只包含 `takes.rootGroups.clip` 与 `takes.paneGallery.clip` 扩展为三个 MP4 角色：Root Groups 的 16 秒比较视频、Pane Gallery 的 16 秒比较视频，以及至少 25 秒的 Pane Gallery 连续故事视频。现有 Root Groups 19 秒开场仍作为 `takes.rootGroups.clip`；Pane Gallery 的单画面阶段改读连续故事视频。所有视频都必须是 `1440x900`，probe 时长必须覆盖各自 `inMs + durationMs`。结构校验必须拒绝缺失、错误模式、时长不足或把图片路径填入视频字段。

这一里程碑完成后运行：

    node --check scripts/media/recording-session.mjs
    node --check scripts/media/compose-marketplace-media.mjs

预期所有测试通过；新增测试明确证明比较段两个输入都是视频，且动态测试素材在成片比较窗口内部产生跨帧 RGB 差异。

## 里程碑二：录制真实连续素材

运行：

    node scripts/media/recording-session.mjs start --scenario four-root-attention

同一个宿主中依次启动 `payments-api` Codex、`storefront` Claude、`design-system` Claude、`release-tools` Codex。启动提示、信任提示、provider 思考等待和 notification 清理发生在正式 clip 外；剧本中的任务提交、focus、缩略图、Agent 和 globe 点击必须发生在正式 clip 内。不得修改用户全局 Codex/Claude 配置，不得把 `provider-bin` 放入 PATH，不得使用 `command` 或 `dispatch` 写产品状态。

在 Contract Review attention 可见、Release Validation 仍有真实 TUI 活动时，分别录制至少 16 秒的 `rootGroups/compare-live.mp4` 与 `paneGallery/compare-live.mp4`。两条视频的 root 顺序、标题和语义状态一致，但不要求逐帧完全同步；至少一侧 TUI 或 attention 动效在每个合理采样窗口内变化。

Pane Gallery 故事只录一条连续 take。开始时为 `dynamic` 四 pane，鼠标从不遮挡内容的位置平滑移动到左下角 `eye` 并点击；等待产品布局动画完整进入 `sideThumbnails`；双击 `payments-api` 缩略图；点击主画板 Agent 清 attention；输入并提交固定决策；双击 `release-tools` 缩略图查看 `42 passed` 与 exit code 0；最后鼠标移动并点击 `globe`，等待布局动画完整回到 `dynamic`，再稳定停留。全程只使用一次开始和停止。

每条 clip 停止后立即用 ffprobe 和 contact sheet 检查。任何目标点击未进入视频、鼠标在点击前不可见、产品布局动画被截断、TUI 卡住、出现 toast 或 provider 权限框，都立即重录当前 clip。在所有源视频通过前不关闭宿主；完成后只运行 `close`，不运行有旧导出副作用的 `stop`。

## 里程碑三：合成、输出与视觉验收

将新 clip 和真实 checkpoint 写入 `.debug/marketplace-media/pair-manifest.json`，先运行 manifest validate，再分别渲染英文和中文到 staging。合成器在 `19-35s` 同时推进两条比较视频的时间戳；窗口 rect 继续沿已有共享 smoothstep 同时插值位置与尺寸。`35-38s` 右侧视频从比较状态连续扩展为单画面；`38-60s` 只播放同一条 Pane Gallery 故事视频，不允许插入 checkpoint、`-loop 1` 或 freeze frame。

自动验证至少包括：所有源文件和六份输出可完整解码；两条正式 MP4 均为 `1920x1200`、30 fps、1800 帧、60 秒；GIF 为 `1440x900`、八帧、10 秒；PNG 为 `1920x1200`；blackdetect 无命中；比较进入 30 帧和 Pane Gallery 扩展 90 帧的窗口 rect 单调连续；`19-35s` 每 500ms 抽帧后左右内容区域均有非零变化；`38-60s` 每 250-500ms contact sheet 清楚看到 `eye`、缩略图、Agent、release-tools 与 `globe` 的鼠标轨迹、点击反馈和布局动画。

人工验收还要在全分辨率确认 Codex/Claude ANSI 字体颜色存在，`42 passed` 与 exit code 0 来自 Agent TUI；在 README `1180px` 与移动端 `375px` 预览中确认字幕没有覆盖交互。全部通过后才将 staging 六份资产原子替换 canonical 路径。旧版留在已生成的 archive，不覆盖。

完整命令组为：

    node --check scripts/media/recording-session.mjs
    node --check scripts/media/compose-marketplace-media.mjs
    node scripts/media/compose-marketplace-media.mjs validate --manifest .debug/marketplace-media/pair-manifest.json
    npm run build
    npm run typecheck
    git diff --check

## 可重试与恢复

`start --scenario four-root-attention` 会自动归档旧 `.debug` 证据，因此开始前必须确认本轮新增归档已经存在且 checksum 通过。单条录制失败时只重录同名 scene；`record-start` 使用 `-y` 覆盖该 scene，但不会修改 canonical 发布资产。若 ffmpeg ready 超时，先检查 progress 文件和 session metadata，再重新执行 `record-start`；不能在 session 仍记录 `currentClipPid` 时再次开始。若 provider 出现权限或升级提示，在录制外用真实 UI 处理后重新录整条连续 take，不能从点击后半段补接。若 compositor 或视觉验收失败，只修 manifest、重录受影响源或重新渲染 staging；canonical 资产和旧版 archive 在最终 gate 前保持不变。

## 验收标准

完成必须同时满足以下用户可见结果：比较镜头两边不是固定帧；第一次进入 Pane Gallery 主画布前能看见鼠标点击 `eye`；进入聚焦后 TUI 和产品动效连续；结尾能看见鼠标点击 `globe`，并看见产品自身从聚焦平滑返回四 pane 全览。任何一项只能从截图推断、在 MP4 中看不到，均视为未完成。
