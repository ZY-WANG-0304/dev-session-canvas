# 简化 PNG Hero 底部信息

本 `ExecPlan` 是活文档，必须按照仓库根目录 `docs/PLANS.md` 持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘`。

## 目标与全局图景

当前 Hero 已使用正确的 Pane Gallery 缩略图状态，但底部把“根目录会话平铺、单任务聚焦、全局任务掌控”绘制成一条带图标和双向箭头的能力轨道。人工审阅确认这三项并不是连续步骤，也不是同级操作，轨道让画面显得像流程图并制造错误关系。完成本计划后，底部三项与图标全部移除；能力含义继续由两个模式各自的说明承担。左右真实产品窗口保持严格 50/50，并适度扩大，让静态 Hero 的视觉重点回到产品本身。

两条 MP4、两条 GIF 和 `attention-focused` 成对 checkpoint 均为锁定输入。当前能力轨道版 PNG 已归档。

## 进度

- [x] (2026-07-17 16:16Z) 归档当前中英文能力轨道 PNG、报告、机器可读验证与 checksum。
- [x] (2026-07-17 16:22Z) 删除 Hero 底部三项、图标和连接线，清理不再使用的 copy / metadata / validation，并把两个等宽窗口扩大到 `1200x750`。
- [x] (2026-07-17 16:27Z) 重渲染中英文 PNG，检查 `1920px`、`1180px`、`375px` 的构图和留白。
- [x] (2026-07-17 16:40Z) 同步剧本、正式设计、验证 JSON 与 checksum，锁定动态资产并完成本次临时素材检查、六件套解码、build、typecheck、manifest 和 diff 门禁。

## 意外与发现

- 观察：底部轨道把左侧一个能力和右侧两个能力强行排成三段，双向箭头又像可点击切换或步骤关系；这与实际模式语义不一致。
  证据：用户标注的审阅截图和归档 `.debug/marketplace-media/archive/2026-07-18-png-hero-capability-rail-baseline/`。
- 观察：删除 footer 后，`1180px` 与 `375px` 下主标题、模式说明和产品窗口仍形成完整信息层级；底部留白由低对比拓扑背景承接，没有信息断层。
  证据：`.debug/marketplace-media/review/png-hero-clean-footer/en/hero-1180.png` 与中英文移动端预览。

## 决策记录

- 决策：完全移除底部三项，而不是再设计第三种图标排法。
  理由：两种模式上方的说明已经完整表达平铺、聚焦与全局掌控；底部重复信息没有新增解释价值。
  日期/作者：2026-07-18 / Codex。
- 决策：释放出的注意力用于放大真实截图，不增加新的口号或装饰图形。
  理由：Marketplace Hero 的核心证据是产品状态；新增文案会重新引入信息竞争。
  日期/作者：2026-07-18 / Codex。

## 结果与复盘

计划已完成。英文 PNG SHA-256 为 `26daa2066c76c2133ae2aa21323420705e339ef14e4f808f50cc39589911e9d9`，中文 PNG 为 `c46ae59b5c143fc37513357570f7253a798e2d9c018ea3a5a2e15fb87a2ef41d`。底部三项、编号、图标与箭头全部删除；左右真实产品窗口从 `1120x700` 放大到 `1200x750`，仍然对称、等宽且保持 `16:10`。中英文三档预览均无裁切、重叠或 UI 遮挡。

两条 MP4 与两条 GIF hash 和计划开始时一致。本次临时素材检查、六件套解码、两份 validation report、脚本语法、manifest validate、build、typecheck、五份发布 checksum 与 `git diff --check` 全部通过。机器可读证据位于 `.debug/marketplace-media/review/png-hero-clean-footer/png-hero-clean-footer-validation.json`，上一版位于 `.debug/marketplace-media/archive/2026-07-18-png-hero-capability-rail-baseline/`。本轮没有残余功能缺口。

## 上下文与定向

Hero HTML/CSS 位于 `scripts/media/compose-marketplace-media.mjs` 的 `heroDocument()` 与 `heroCss()`。`HERO_COPY` 当前包含仅供底部轨道使用的 `capabilities`，`resolveHeroPresentation()` 还把 `mode-rail` 写进 validation report；测试固定了这些字段。删除可见轨道时必须同步删除这些失效 metadata，避免报告声称存在未渲染内容。Hero source 继续是 `attention-focused`，右侧继续显示主任务和真实缩略图。

## 工作计划

先移除 footer markup、轨道 CSS、`HERO_COPY.capabilities`、presentation 中的 capability 字段和对应 validation check。将两个窗口扩大为仍然对称且保持 `16:10` 的尺寸，并同步模式标题宽度与位置。测试固定新的窗口规格、Hero source 和不含能力轨道的 presentation。

随后重渲染中英文资产，按三个宽度人工检查，确认没有因为删除 footer 形成不自然的断层，真实界面更清楚且顶部信息层级仍完整。最后更新文档和验证证据，证明 MP4/GIF 未变。

## 具体步骤

    node scripts/media/compose-marketplace-media.mjs validate --manifest .debug/marketplace-media/pair-manifest.json
    DSC_MEDIA_SCREENSHOT_RENDERER=chrome-cli node scripts/media/compose-marketplace-media.mjs render --manifest .debug/marketplace-media/pair-manifest.json --language en
    DSC_MEDIA_SCREENSHOT_RENDERER=chrome-cli node scripts/media/compose-marketplace-media.mjs render --manifest .debug/marketplace-media/pair-manifest.json --language zh-CN
    npm run build
    npm run typecheck
    git diff --check

## 验证与验收

最终 PNG 不出现底部三个能力项、编号、图标或箭头；两个窗口保持尺寸相等、左右对称和 `16:10`，右侧仍为真实 `sideThumbnails`。三档尺寸无裁切或重叠。两条 MP4 与两条 GIF hash 不变；本次临时素材检查、六件套解码、validation report、manifest、build、typecheck 和 diff 检查通过。

## 幂等性与恢复

当前版本已经归档。compositor 继续 staged render，失败时可从 archive 恢复 PNG；不得修改 checkpoint、录屏或动态时间线。

## 证据与备注

本轮中英文预览、机器可读结论与 `PUBLISHED_SHA256SUMS` 位于 `.debug/marketplace-media/review/png-hero-clean-footer/`。

## 接口与依赖

不新增依赖。继续使用 Playwright、ffmpeg、Noto Sans CJK 和仓库 SVG icon。

计划修订说明（2026-07-17 16:40Z）：底部信息简化、放大 50/50 产品窗口、双语视觉证据、动态资产锁定与全部工程门禁通过，计划完成并移入 `completed/`。
