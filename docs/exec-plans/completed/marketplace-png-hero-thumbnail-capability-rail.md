# 优化 PNG Hero 的缩略图状态与能力轨道

本 `ExecPlan` 是活文档，必须按照仓库根目录 `docs/PLANS.md` 持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘`。

## 目标与全局图景

当前独立 PNG Hero 已经建立品牌、价值主标题、模式说明和严格 50/50 对比，但右侧 Pane Gallery 仍使用 `dynamic` 四 pane 全览，底部三个编号等宽栏也像普通功能清单，没有表达两种模式不同的能力结构。完成本计划后，Hero 将使用 `attention-focused` 的成对真实 checkpoint：左侧仍是同状态的 Root Groups，右侧明确展示一个主任务加右侧缩略图的 Pane Gallery。底部改为左右各自归属的能力轨道：Root Groups 一侧表达“根目录会话平铺”，Pane Gallery 一侧用视觉连接表达“单任务聚焦”与“全局任务掌控”的平衡。

两条 MP4 和两条 GIF 继续锁定为上一轮 hash，不得改变。当前中英文 PNG 在覆盖前归档。

## 进度

- [x] (2026-07-17 15:52Z) 检查 `attention-focused` 左右 checkpoint，确认右侧为主任务加缩略图、左侧为同一 state ID 的组合画布。
- [x] (2026-07-17 15:57Z) 把 manifest Hero ID 与独立 Hero 渲染切到 `attention-focused`，更新测试确保左右状态配对且 GIF layout 不受影响。
- [x] (2026-07-17 16:05Z) 把底部三个编号等宽栏改成左右 50/50 能力轨道，并完成中英文 `1920px`、`1180px`、`375px` 视觉检查。
- [x] (2026-07-17 16:11Z) 更新剧本、正式设计与机器可读验证，锁定动态资产并完成十五项媒体测试、六件套解码、build、typecheck、manifest、checksum 与 diff 门禁。

## 意外与发现

- 观察：`attention-focused` 的 Pane Gallery checkpoint 已经真实包含放大的 `payments-api / Contract Review` 主任务和右侧 `storefront`、`design-system`、`release-tools` 缩略图，不需要后期拼接或伪造。
  证据：`.debug/marketplace-media/checkpoints/paneGallery/attention-focused.png`。
- 观察：把能力按模式归属后，英文长句 `Stay in control across tasks` 仍能在右侧 `1120px` 轨道中与聚焦端、双向连接和图形标记同排，375px 下没有交叠。
  证据：`.debug/marketplace-media/review/png-hero-thumbnail-rail/en/hero-375.png`。

## 决策记录

- 决策：Hero 左右都切换到 `attention-focused`，不只替换右图。
  理由：成对 checkpoint 必须保持同一 state ID；混用 `attention-arrives` 左图和 `attention-focused` 右图会破坏比较真实性。
  日期/作者：2026-07-17 / Codex。
- 决策：底部按模式拆为两个等宽区域，不再把三项能力平均分成三栏。
  理由：组合画布只有一个核心空间能力；窗格画廊的两个能力是相互平衡的一组，三栏会抹平这层语义。
  日期/作者：2026-07-17 / Codex。

## 结果与复盘

计划已完成。英文 PNG SHA-256 为 `6f29782a746a8144315d4cfb960317a2b3e4fc51abd458764d5ed2d6c3b32079`，中文 PNG 为 `4c733f9e67371e8c71139883929f59d09b000ee1530d5074aa6c1a8e55bbf492`。右侧真实显示 `payments-api` 主任务和三个其他 root 缩略图；底部左侧是平铺能力，右侧以双向轨道连接单任务聚焦和全局任务掌控。中英文 `1920px`、`1180px`、`375px` 均无裁切、重叠或 UI 遮挡。

两条 MP4 与两条 GIF 的 SHA-256 和计划开始时一致。十五项媒体测试、六件套完整解码、两份 validation report、脚本语法、manifest validate、build、typecheck、四份发布 checksum 和 `git diff --check` 全部通过。机器可读证据位于 `.debug/marketplace-media/review/png-hero-thumbnail-rail/png-hero-thumbnail-rail-validation.json`，上一版 Hero 位于 `.debug/marketplace-media/archive/2026-07-17-png-hero-dynamic-gallery-baseline/`。本轮没有残余功能缺口。

## 上下文与定向

`scripts/media/compose-marketplace-media.mjs` 中 `HERO_FRAME_ID` 同时约束 manifest 的显式 Hero source 和独立 Hero master 使用的成对 checkpoint；GIF layout 仍由 `STORYBOARD` 每个 frame 自己的 `layout` 决定。`.debug/marketplace-media/pair-manifest.json` 当前把 Hero 指向 `attention-arrives`，需要与代码同步改为 `attention-focused`。Hero HTML 位于 `heroDocument()`，底部样式位于 `heroCss()`。

## 工作计划

先归档当前两张正式 PNG、validation report 与 checksum。随后修改 Hero ID、manifest 和测试，让独立 Hero 从 `attention-focused` 读取左右真实截图，同时验证 GIF 中同 ID 仍按 `pane-single` 呈现，不把 Hero 的 50/50 构图反向写入 GIF。

底部 HTML 改成两个与窗口等宽的区域。左侧使用一个克制的平铺符号和 `Tile by root` / `根目录会话平铺`；右侧将 `Focus one task` / `单任务聚焦` 与 `Stay in control across tasks` / `全局任务掌控` 放在同一条视觉轴上，用中间连接线表达来回切换和平衡，不使用编号、三张卡片或重复模式标题。

最后重渲染中英文资产，检查 `1920px`、`1180px`、`375px`，更新 validation report、设计文档和发布 checksum，并证明 MP4/GIF hash 不变。

## 具体步骤

    node --test scripts/media/*.test.mjs
    node scripts/media/compose-marketplace-media.mjs validate --manifest .debug/marketplace-media/pair-manifest.json
    DSC_MEDIA_SCREENSHOT_RENDERER=chrome-cli node scripts/media/compose-marketplace-media.mjs render --manifest .debug/marketplace-media/pair-manifest.json --language en
    DSC_MEDIA_SCREENSHOT_RENDERER=chrome-cli node scripts/media/compose-marketplace-media.mjs render --manifest .debug/marketplace-media/pair-manifest.json --language zh-CN
    npm run build
    npm run typecheck
    git diff --check

## 验证与验收

Hero 右侧必须清楚显示 Pane Gallery 主任务和缩略图，左右 source state ID 都是 `attention-focused`。产品窗口保持相等 `1120x700`。底部不再出现 `01/02/03` 三栏，而是左侧一项、右侧两端相连的能力轨道。三档尺寸无裁切、重叠或 UI 遮挡；两条 MP4、两条 GIF 逐字节不变；十五项媒体测试、六件套解码、validation report、build、typecheck、manifest 和 diff 检查通过。

## 幂等性与恢复

旧 Hero 先保存到独立 archive。compositor 继续通过 staged output 原子替换正式资产；失败时从 archive 恢复 PNG。不得修改 checkpoint、录屏源或 MP4/GIF 时间线。

## 证据与备注

本轮中英文 `1180px`、`375px` 预览、机器可读结论和 `PUBLISHED_SHA256SUMS` 位于 `.debug/marketplace-media/review/png-hero-thumbnail-rail/`。

## 接口与依赖

不新增依赖。继续使用 Playwright、ffmpeg、Noto Sans CJK 和仓库 SVG icon。`HERO_COPY` 的已确认文本不变，只调整 Hero source 与底部呈现结构。

计划修订说明（2026-07-17 16:11Z）：缩略图 Hero、能力轨道、双语视觉证据、动态资产锁定和全部工程门禁通过，计划完成并移入 `completed/`。
