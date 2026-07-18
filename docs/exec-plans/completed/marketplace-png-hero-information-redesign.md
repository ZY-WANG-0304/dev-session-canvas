# 重设计 Marketplace PNG Hero 的信息层级

本 `ExecPlan` 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘`。本文按照仓库根目录下的 `docs/PLANS.md` 持续维护。

## 目标与全局图景

当前 Marketplace PNG Hero 直接缩放 GIF 的 `attention-arrives` 比较帧，静态画面只有模式名称和“两种视图模式，按需选择。”一句主字幕。完成本计划后，中英文 Hero 仍以同一对真实 checkpoint 严格 50/50 展示组合画布与窗格画廊，但会增加真实产品 icon、产品名、价值主标题、每种模式的准确说明和三项能力标签。组合画布明确表达“各 root 的会话平铺在同一张画布中”；窗格画廊明确表达“聚焦单个任务，同时保持全局任务掌控”。

用户已经确认当前 MP4 与 GIF，不得因 PNG 重设计发生逐字节变化。英文 MP4 锁定为 `c43f9c73c82cb22b594aefb7bee68b0805f8e7029b49e0714d27665f10e8e803`，中文 MP4 锁定为 `1b398c44de5fa863b0c524180440d443430ff7474c4693c58701407dc8027984`；英文 GIF 锁定为 `d24024fb6ed5d98aa61e9bda3e6db8ce36bc2675ef41c1b6ccbe3784b092c70d`，中文 GIF 锁定为 `03330a5d13715004bf7e10ef8fc2446432f521d6999767463397086ed7b6ed60`。现有 PNG 在覆盖前归档，方便视觉回退。

## 进度

- [x] (2026-07-17 14:42Z) 核对当前 PNG、compositor、测试、剧本、正式设计文档与六件套 hash，确认 Hero 目前直接复用 GIF 比较帧。
- [x] (2026-07-17 14:49Z) 在 compositor 中加入只服务 PNG 的 Hero 文案、50/50 布局与独立渲染路径；GIF storyboard 和 MP4 overlay 未改动。
- [x] (2026-07-17 14:51Z) 为精确双语文案、真实产品 icon、相等窗口和 Hero presentation 补自动化测试，并同步正式剧本和设计文档。
- [x] (2026-07-17 14:56Z) 归档当前中英文 PNG，重新渲染两种语言并检查 1920px、1180px 与 375px；两种语言均无裁切、重叠或 UI 遮挡。
- [x] (2026-07-17 15:05Z) 验证两条 MP4、两条 GIF hash 不变，完成十五项媒体测试、六件套完整解码、manifest、build、typecheck、checksum 与 diff 门禁，准备将计划移入 `completed/`。

## 意外与发现

- 观察：`renderHero()` 目前只把 `frames/attention-arrives.png` 从 `2560x1600` 缩放为 `1920x1200`，因此 PNG 与 GIF 第三帧共享完全相同的信息层级。
  证据：`scripts/media/compose-marketplace-media.mjs` 的 `renderHero({ frameDir, outputPath })` 只读取 `${HERO_FRAME_ID}.png`。
- 观察：现有母版已经为两个真实 `16:10` checkpoint 提供相等的 `1120x700` 窗口，50/50 约束无需改变源素材或制造产品 split view。
  证据：`DUAL_LEFT_WINDOW` 与 `DUAL_RIGHT_WINDOW` 的宽高完全相等，横向位置围绕母版中心对称。
- 观察：在 `375x234` 缩放下，产品 UI 细节自然退居证据层，但主标题、模式名称和三项能力仍保持独立层级且没有相互覆盖。
  证据：`.debug/marketplace-media/review/png-hero-redesign/en/hero-375.png` 与中文对应预览。

## 决策记录

- 决策：Hero 继续使用 `attention-arrives` 的同状态左右 checkpoint，并严格保留 50/50 窗口比例。
  理由：用户明确选择保留等比对比；该 checkpoint 能证明相同工作状态在两种呈现模式中的差异。
  日期/作者：2026-07-17 / Codex。
- 决策：Hero 使用独立 HTML 渲染路径，不修改 `MARKETPLACE_COPY` 中的 MP4/GIF 字幕，也不复用 storyboard 比较字幕。
  理由：PNG 需要更丰富的静态信息层级，而用户已经确认动态资产；隔离渲染路径可以用 hash 门禁证明没有回归。
  日期/作者：2026-07-17 / Codex。
- 决策：英文使用 `root` 而不是 `workspace` 或 `repository`，中文使用“根目录”。
  理由：VS Code workspace 可以是单根或多根，不能与一个 folder/root 等同；root 也不一定是 Git repository。
  日期/作者：2026-07-17 / Codex。
- 决策：窗格画廊使用“全局任务掌控”，不使用“质检”。
  理由：“质检”像工业验收并暗示自动质量检测；“掌控”可以覆盖查看、审阅和介入。
  日期/作者：2026-07-17 / Codex。
- 决策：最终 Hero 保持两个 `1120x700` 产品窗口，并把品牌和主标题放在窗口上方、三项能力放在窗口下方，不在任何真实 UI 像素上叠字。
  理由：该构图在 `1920px`、`1180px` 与 `375px` 下都没有裁切或重叠，同时维持用户指定的严格 50/50 证据关系。
  日期/作者：2026-07-17 / Codex。

## 结果与复盘

计划已完成。英文 PNG SHA-256 为 `293867e2cdae3e58cbba67a74634be22ef55db5eb764754506ca539ab2c8aa7c`，中文 PNG 为 `35457618b96d9946a8bb188f69cd19d44c9304000405dc10cedbfef1dbc14221`，两者均为 `1920x1200`。Hero 使用真实 SVG icon、定稿双语文案和两个对称的 `1120x700` 源窗口；原尺寸、README `1180px` 与移动端 `375px` 预览均无裁切、重叠或 UI 遮挡。

两条 MP4 与两条 GIF 的 SHA-256 和计划开始时完全一致；GIF 仍为每种语言 `8/8` 唯一帧。十五项媒体测试、六件套完整解码、两份 validation report、manifest validate、脚本语法、build、typecheck、三份发布 checksum 清单和 `git diff --check` 全部通过。机器可读结论位于 `.debug/marketplace-media/review/png-hero-redesign/png-hero-validation.json`，旧单句 PNG 位于 `.debug/marketplace-media/archive/2026-07-17-png-simple-caption-baseline/`。本轮没有残余功能缺口。

## 上下文与定向

正式资产位于 `extensions/vscode/dev-session-canvas/images/marketplace/`。`scripts/media/compose-marketplace-media.mjs` 校验 `.debug/marketplace-media/pair-manifest.json`，通过 Playwright 把真实 checkpoint 放入 `2560x1600` 母版，再生成中英文 MP4、GIF 与 PNG。`HERO_FRAME_ID` 固定为 `attention-arrives`。现有 `renderStoryboardFrame()` 生成 GIF frame，`renderHero()` 再把指定 storyboard frame 缩放为 PNG；本次需要在 browser 仍打开时生成一个独立 `hero-master.png`，然后只让 `renderHero()` 消费该文件。

Hero 的定稿文案如下。英文产品说明为 `Multi-agent workbench for VS Code`，主标题为 `Every agent. Every root. One canvas.`；左侧说明为 `Sessions from every root, tiled together on one canvas.`，右侧说明为 `Focus on one task while staying in control of the rest.`，底部能力为 `Tile by root`、`Focus one task`、`Stay in control across tasks`。中文对应为 `VS Code 多 Agent 协作工作台`、`所有 Agent，跨根目录汇聚于一张画布。`、`各根目录的会话，平铺在同一张画布中。`、`兼顾单任务聚焦与全局任务掌控。`，底部能力为 `根目录会话平铺`、`单任务聚焦`、`全局任务掌控`。

## 工作计划

先把 Hero 双语文案定义为与视频字幕分离的不可变常量，并定义可测试的左右等宽窗口规格。新增 Hero HTML/CSS 只消费 `attention-arrives` 的两张真实 checkpoint 与仓库 `dev-session-canvas-icon.svg`，将品牌、主标题、模式名称、模式说明、两个等宽窗口和三项能力标签排入现有石墨色拓扑背景。GIF 的 `storyboardDocument()`、MP4 overlay 与时间线保持不动。

随后让 `renderMarketplaceMedia()` 在生成 storyboard frame 的同一 Playwright 会话中额外输出 `hero-master.png`，再由 ffmpeg 缩放为正式 `1920x1200` PNG。validation report 和 render metadata 记录 Hero presentation 与精确文案，测试固定其语言内容、50/50 几何和独立渲染语义。剧本与正式设计文档同步声明 PNG 不再复制 GIF frame，而是从同一对 checkpoint 独立合成。

覆盖正式 PNG 前，把当前两张 PNG、对应 hash 和验证报告归档到新的日期目录。渲染后生成桌面、README 常见宽度和 375px 预览，人工检查产品 icon、标题、窗口对齐、长英文和中文无裁切。最终用 hash 明确证明 MP4/GIF 未变，并执行全部自动化门禁。

## 具体步骤

所有命令从仓库根目录执行：

    node --test scripts/media/*.test.mjs
    node scripts/media/compose-marketplace-media.mjs validate --manifest .debug/marketplace-media/pair-manifest.json
    DSC_MEDIA_SCREENSHOT_RENDERER=chrome-cli node scripts/media/compose-marketplace-media.mjs render --manifest .debug/marketplace-media/pair-manifest.json --language en
    DSC_MEDIA_SCREENSHOT_RENDERER=chrome-cli node scripts/media/compose-marketplace-media.mjs render --manifest .debug/marketplace-media/pair-manifest.json --language zh-CN
    npm run build
    npm run typecheck
    git diff --check

## 验证与验收

英文和中文 PNG 必须为 `1920x1200`，使用真实 SVG icon 与产品名，两个产品窗口宽高相等并围绕画布中心对称。主标题、两侧模式说明与三项能力在 1920px 和 1180px 下完整可读；375px 下主标题、模式名和能力层级不能相互覆盖或被裁切。Hero 的左右内容来自 `attention-arrives` 成对 checkpoint，不能后期重画 Agent、attention 或状态。

两条 MP4 和两条 GIF 必须与本计划开头的 SHA-256 完全一致。两份 validation report 必须 `passed: true`，媒体测试、PNG/GIF/MP4 完整解码、manifest validate、脚本语法、build、typecheck 与 `git diff --check` 必须通过。

## 幂等性与恢复

compositor 会先写 staged output，validation 通过后才替换正式文件，可以安全重跑。旧 PNG 与验证证据在覆盖前复制到只属于本轮的 archive 目录；视觉验收失败时从该归档恢复两张 PNG。不得修改 checkpoint、真实录屏源、pair manifest 或用户确认的动态资产。

## 证据与备注

Hero 原尺寸正式资产、1180px 与 375px 预览位于 `.debug/marketplace-media/review/png-hero-redesign/`。同目录的 `png-hero-validation.json` 记录六件套 hash、Hero 文案和验证结果，`PUBLISHED_SHA256SUMS` 覆盖六件套、manifest、两份 validation report 与机器可读结论。

## 接口与依赖

不增加 npm 依赖。继续使用 Playwright、ffmpeg/ffprobe、Noto Sans CJK 与现有 SVG icon。`scripts/media/compose-marketplace-media.mjs` 应导出可供测试固定的 `HERO_COPY` 和 Hero 窗口规格或解析函数；`renderMarketplaceMedia()` 必须以 `HERO_FRAME_ID` 找到成对 checkpoint，生成独立 master，再由 `renderHero()` 输出正式 PNG。GIF 与 MP4 的现有公共常量、filter 和 storyboard contract 不得改变。

计划修订说明（2026-07-17 15:05Z）：中英文独立 Hero、视觉证据、旧版归档、动态资产 hash 锁定与全部自动化门禁通过，计划完成并移入 `completed/`。
