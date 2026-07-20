# 重设计 GIF 的模式叙事布局

本 `ExecPlan` 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘`。本文按照仓库根目录下的 `docs/PLANS.md` 持续维护。

## 目标与全局图景

当前 10 秒 GIF 的八张 frame 全部使用左右双宽屏构图，因此“发现需要关注的会话，立即聚焦。”虽然描述的是 Pane Gallery 操作，画面却仍把 Root Groups 与 Pane Gallery 同时缩小展示。完成本计划后，GIF 会形成明确的三段叙事：先用大画面展示 Root Groups 全局工作现场，再用两张双宽屏解释两种模式，最后用大画面展示 Pane Gallery 的聚焦、决策、测试通过和四 pane 收尾。字幕只在与其语义一致的构图上出现。

用户已经确认当前 MP4 版本可用，因此英文 MP4 `c43f9c73c82cb22b594aefb7bee68b0805f8e7029b49e0714d27665f10e8e803` 与中文 MP4 `1b398c44de5fa863b0c524180440d443430ff7474c4693c58701407dc8027984` 是锁定输入。重导后两者必须保持逐字节不变。PNG Hero 继续使用 `attention-arrives` 双模式比较帧，因此也不改变传播语义。

## 进度

- [x] (2026-07-17 09:17Z) 读取当前 compositor、测试、GIF 剧本、正式设计与已通过资产 hash，定位字幕和构图语义不一致的原因。
- [x] (2026-07-17 09:21Z) 将当前 54 秒六件套、manifest、validation report 和节奏验证证据归档到 `.debug/marketplace-media/archive/2026-07-17-54s-dual-only-gif-baseline/`，十项 checksum 复核通过。
- [x] (2026-07-17 09:28Z) 把八帧 storyboard 固定为两张 Root 单画面、两张双模式对比和四张 Pane 单画面，并让字幕通过 `captionKey` 显式绑定。
- [x] (2026-07-17 09:31Z) 更新 compositor、定向测试、剧本和正式设计文档；语法、storyboard contract 与 manifest validate 通过，设计状态保持“验证中”。
- [x] (2026-07-17 09:43Z) 重导中英文资产；MP4 与 PNG 锁定 hash 全部不变，GIF 三段式构图、字幕语义及 375px 预览通过人工检查。
- [x] (2026-07-17 09:44Z) 完成六件套解码、GIF 时长/帧数/唯一帧、1180px/375px 预览、本次临时素材检查、build、typecheck、语法、manifest 和 diff 门禁。
- [x] (2026-07-17 09:46Z) 记录最终 hash、机器可读验证与视觉证据，并准备把本计划移入 `docs/exec-plans/completed/`。

## 意外与发现

- 观察：当前 `storyboardDocument()` 无条件渲染左右两个窗口和两个模式标签，frame ID 只影响字幕与产品落版。
  证据：`scripts/media/compose-marketplace-media.mjs` 对每个 frame 固定输出 `.story-window.left`、`.story-window.right`、`.mode-label.left` 与 `.mode-label.right`。
- 观察：`attention-focused` 的字幕明确描述 Pane Gallery 聚焦，但当前 frame 仍以 `1120x700` 双窗呈现，Pane 内容只占母版不到一半。
  证据：现有 GIF storyboard 第五帧写明“左侧保持全景，右侧聚焦”，字幕为“发现需要关注的会话，立即聚焦。”。
- 观察：新单模式布局在 `1440x900` GIF 中把产品截图扩大到 `1080x675`，而双模式窗口保持每侧 `630x394`；聚焦和测试结果的有效面积显著增加。
  证据：`.debug/marketplace-media/review/gif-redesign/en/gif-decoded-contact.png` 与中文对应 contact sheet 显示第 1-2、5-8 帧为单窗，第 3-4 帧为双窗；375px contact sheet 中两句字幕仍完整可读。

## 决策记录

- 决策：八帧布局固定为 `root-single, root-single, compare, compare, pane-single, pane-single, pane-single, pane-single`。
  理由：这让 GIF 自身形成“先看全局组织、再理解两种模式、最后看聚焦工作流”的完整故事，也让 Pane 专属字幕只覆盖 Pane 大画面。
  日期/作者：2026-07-17 / Codex。
- 决策：`attention-arrives` 继续作为双模式比较帧和 PNG Hero，比较字幕不变。
  理由：该帧最适合静态解释同一 attention 在两种模式中的对应关系，PNG 已通过审阅且用户只要求重设计 GIF。
  日期/作者：2026-07-17 / Codex。
- 决策：单模式 frame 使用母版中的 `1920x1200` 大窗口，保留外部字幕带，并只显示当前模式标签。
  理由：大窗口显著提高 Agent 内容和测试结果可读性，同时不改变既有 `2560x1600` 母版、16:10 比例或字幕安全区。
  日期/作者：2026-07-17 / Codex。
- 决策：重导完整语言资产，但把已确认 MP4 hash 与 PNG Hero hash设为发布门禁。
  理由：现有 compositor 按语言原子生成 MP4/GIF/PNG；锁定 hash 可以在不扩张命令接口的前提下证明 GIF 改动没有扰动用户已确认的视频和 Hero。
  日期/作者：2026-07-17 / Codex。

## 结果与复盘

计划已完成。英文 GIF SHA-256 为 `8daa8fe10c23fe4e9376642ca33d3b278f9997c569125fb8b424c082c20ccb1a`，中文 GIF 为 `0c6afcaceb0cb3a80274fa06c166fd5b5e1ec290fafae1a037164f642d6519ff`；两者均为 `1440x900`、8 个唯一帧、10 秒。前两帧只显示 Root Groups 大画面，中间两帧显示双模式，后四帧只显示 Pane Gallery 大画面；比较和聚焦字幕只出现在语义对应的 layout。

用户确认的英文/中文 MP4 与两张 PNG Hero 均和归档逐字节相同。本次临时素材检查、六件套完整解码、两份 validation report、1180px/375px 预览、build、typecheck、脚本语法、manifest validate 和 `git diff --check` 全部通过。机器可读结论位于 `.debug/marketplace-media/review/gif-redesign/gif-redesign-validation.json`，重设计前版本位于 `.debug/marketplace-media/archive/2026-07-17-54s-dual-only-gif-baseline/`。本轮没有残余功能缺口。

## 上下文与定向

正式资产位于 `extensions/vscode/dev-session-canvas/images/marketplace/`。`scripts/media/compose-marketplace-media.mjs` 的 `STORYBOARD` 定义八个 frame ID 与停留时间，`storyboardDocument()` 把 `.debug/marketplace-media/checkpoints/` 中的左右真实宿主截图合成到 `2560x1600` 母版；`renderGif()` 再按显式时长输出 `1440x900` GIF。`attention-arrives` 同时是 GIF 第三帧和 PNG Hero 来源。

这里的“单画面”不是裁切或伪造另一种模式，而是只选择对应 frame 已存在的真实 `rootGroups` 或 `paneGallery` checkpoint，并在母版中按 `1920x1200` 放大。双模式 frame 继续同时使用同状态的左右 checkpoint。MP4 仍消费连续视频源，与 GIF 静态 frame layout 相互独立。

## 工作计划

先归档当前六件套和验证证据，确保用户认可的 54 秒 MP4 可随时按 hash 恢复。随后为 `STORYBOARD` 增加显式 `layout` 与 `captionKey`：`overview-start`、`all-running` 使用 `root-single`；`attention-arrives`、`mode-compare` 使用 `compare`；其余四帧使用 `pane-single`。渲染器按 layout 选择左图、双图或右图，并为单模式 frame 使用单独的窗口和模式标签 CSS。

测试应固定八帧 layout/caption 映射，保证 Hero 仍为 compare，`attention-focused` 必须是 pane-single，并继续验证总时长 10 秒和真实 GIF 帧数。剧本与正式设计文档要删除“GIF 全部使用双宽屏”的旧结论，改为三段式布局，并明确 PNG Hero 仍是双模式帧。

最终通过显式 `DSC_MEDIA_SCREENSHOT_RENDERER=chrome-cli` 使用已验证的 Playwright headless-shell 截图路径重导两种语言。渲染后先比较 MP4 和 PNG hash；任一锁定资产变化都不得发布，必须恢复归档并定位原因。再检查八张合成 frame、GIF contact sheet、1180px 与 375px 预览、完整解码和全部项目门禁。

## 具体步骤

所有命令从仓库根目录执行：

    node scripts/media/compose-marketplace-media.mjs validate --manifest .debug/marketplace-media/pair-manifest.json
    DSC_MEDIA_SCREENSHOT_RENDERER=chrome-cli node scripts/media/compose-marketplace-media.mjs render --manifest .debug/marketplace-media/pair-manifest.json --language en
    DSC_MEDIA_SCREENSHOT_RENDERER=chrome-cli node scripts/media/compose-marketplace-media.mjs render --manifest .debug/marketplace-media/pair-manifest.json --language zh-CN
    npm run build
    npm run typecheck
    git diff --check

## 验证与验收

验收必须满足：GIF 第 1-2 帧只显示放大的 Root Groups，第 3-4 帧显示大小相等的双模式比较，第 5-8 帧只显示放大的 Pane Gallery；比较字幕只出现在双模式帧，聚焦字幕只出现在 Pane Gallery 大画面；`tests-passed` 中 `42 passed / exit code 0` 比旧双窗更易读；中英文 GIF 均为 `1440x900`、8 帧、10 秒且完整解码；PNG Hero 仍为双模式比较；两条 MP4 和两张 PNG 的 SHA-256 与本计划开头记录的锁定值一致；validation report、本次临时素材检查、build、typecheck、语法与 diff 检查全部通过。

## 幂等性与恢复

归档目录创建后不覆盖。compositor 仍先写 staged output，validation report 通过后才替换 canonical 文件。若视觉验收或锁定 hash 失败，立即从本轮归档恢复对应资产，不删除新 frame 证据；修正 layout 后可安全重复渲染。不得修改 checkpoint、真实录屏源或 MP4 时间线。

## 证据与备注

旧双窗 GIF hash 为英文 `442e3737299cca18b5b8b0fdfa56303b9e9cf247602d24b5bb4c2e1636219a91`、中文 `8f7a9737d06400c03c4a8b78609e6b37311cb51b2ddc9f578db7faa86d7cc479`；新版 hash 记录在结果章节。逐帧证据位于 `.debug/marketplace-media/review/gif-redesign/en/gif-decoded-contact.png`、`.debug/marketplace-media/review/gif-redesign/zh-CN/gif-decoded-contact.png` 及各自的 375px contact sheet；`PUBLISHED_SHA256SUMS` 覆盖六件套、manifest、validation report 和机器可读验收结果。

## 接口与依赖

不增加 npm 依赖。继续使用 Playwright、ffmpeg/ffprobe、Noto Sans CJK 和现有 manifest v2。`STORYBOARD` 的每个对象必须新增 `layout: 'root-single' | 'compare' | 'pane-single'`，有字幕的 frame 通过 `captionKey: 'compare' | 'focus'` 显式绑定文案；`storyboardDocument()` 必须只依据这份经过测试的规格选择窗口与标签。

计划修订说明（2026-07-17 09:46Z）：中英文三段式 GIF、锁定资产、视觉证据与全部自动化门禁通过，计划进入 completed。
