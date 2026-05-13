---
version: 2026-05-12
name: Template Marketplace UI
description: 一个矩形、工作台语境优先的模板市场界面系统：浏览器端借鉴 Visual Studio Marketplace 的信息架构，但不继承其玫红品牌色；VSCode Webview 端则放弃固定市场色板，完全从当前 VSCode Color Theme 派生背景、文本、边框、控件、焦点、菜单和状态。两端共同强调 README-first 详情页、紧凑安装上下文、矩形卡片、可见 focus 和非颜色状态文案。

colors:
  market-accent: "#4878f0"
  market-accent-text: "#ffffff"
  market-moss: "#48b0a0"
  market-moss-on-dark: "#56c2b2"
  market-ink: "#1a1a1a"
  market-ink-on-dark: "#e6e6e6"
  market-muted: "#686868"
  market-muted-on-dark: "#aeaeae"
  market-mist: "#f8f8f8"
  market-mist-on-dark: "#1e1e1e"
  market-paper: "#ffffff"
  market-paper-on-dark: "#252526"
  market-line: "#dedede"
  market-line-on-dark: "#3f3f46"
  market-nav: "#000000"
  market-nav-text: "#ffffff"
  market-sand: "#f2f2f2"
  market-sand-on-dark: "#2d2d30"
  vscode-bg: "var(--vscode-editor-background)"
  vscode-fg: "var(--vscode-editor-foreground)"
  vscode-muted: "var(--vscode-descriptionForeground)"
  vscode-surface: "var(--vscode-editorWidget-background, var(--vscode-editor-background))"
  vscode-border: "color-mix(in srgb, var(--vscode-widget-border, var(--vscode-panel-border, var(--vscode-focusBorder))) 70%, transparent)"
  vscode-focus: "var(--vscode-focusBorder)"
  vscode-primary-bg: "var(--vscode-button-background)"
  vscode-primary-fg: "var(--vscode-button-foreground)"
  vscode-secondary-bg: "var(--vscode-button-secondaryBackground, transparent)"
  vscode-secondary-fg: "var(--vscode-button-secondaryForeground, var(--vscode-editor-foreground))"

typography:
  browser-hero:
    fontFamily: "Segoe UI, Aptos, sans-serif"
    fontSize: 48px
    fontWeight: 300
    lineHeight: 1.15
    letterSpacing: 0
  browser-detail-title:
    fontFamily: "Segoe UI, Aptos, sans-serif"
    fontSize: 36px
    fontWeight: 300
    lineHeight: 1.15
    letterSpacing: 0
  browser-section-title:
    fontFamily: "Segoe UI, Aptos, sans-serif"
    fontSize: 24px
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: 0
  browser-card-title:
    fontFamily: "Segoe UI, Aptos, sans-serif"
    fontSize: 18px
    fontWeight: 600
    lineHeight: 1.35
    letterSpacing: 0
  browser-body:
    fontFamily: "Segoe UI, Aptos, sans-serif"
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.75
    letterSpacing: 0
  browser-search:
    fontFamily: "Segoe UI, Aptos, sans-serif"
    fontSize: 20px
    fontWeight: 400
    lineHeight: 1.2
    letterSpacing: 0
  browser-caption:
    fontFamily: "Segoe UI, Aptos, sans-serif"
    fontSize: 12px
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: 0
  vscode-panel-title:
    fontFamily: "var(--vscode-font-family)"
    fontSize: 18px
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: 0
  vscode-card-title:
    fontFamily: "var(--vscode-font-family)"
    fontSize: 14px
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: 0
  vscode-body:
    fontFamily: "var(--vscode-font-family)"
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: 0
  vscode-detail-body:
    fontFamily: "var(--vscode-font-family)"
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.8
    letterSpacing: 0
  vscode-overline:
    fontFamily: "var(--vscode-font-family)"
    fontSize: 11px
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: 0.14em

rounded:
  none: 0px
  xs: 2px
  sm: 4px
  md: 6px
  lg: 8px
  pill: 9999px
  full: 9999px

spacing:
  xxs: 4px
  xs: 6px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 20px
  xxl: 32px
  section: 80px

components:
  browser-global-nav:
    backgroundColor: "{colors.market-nav}"
    textColor: "{colors.market-nav-text}"
    typography: "{typography.browser-caption}"
    height: 48px
  browser-tab-nav:
    backgroundColor: "{colors.market-paper} / {colors.market-paper-on-dark}"
    textColor: "{colors.market-accent-text}"
    activeBackgroundColor: "{colors.market-accent}"
    borderColor: "{colors.market-line} / {colors.market-line-on-dark}"
    height: 54px
  browser-search-input:
    backgroundColor: "{colors.market-paper} / {colors.market-paper-on-dark}"
    textColor: "{colors.market-ink} / {colors.market-ink-on-dark}"
    typography: "{typography.browser-search}"
    rounded: "{rounded.none}"
    height: 56px
  browser-search-button:
    backgroundColor: "{colors.market-accent}"
    textColor: "{colors.market-accent-text}"
    rounded: "{rounded.none}"
    size: 56px
  browser-template-card:
    backgroundColor: "{colors.market-paper} / {colors.market-paper-on-dark}"
    borderColor: "{colors.market-line} / {colors.market-line-on-dark}"
    rounded: "{rounded.none}"
    shadow: "var(--market-shadow-card)"
  browser-thumbnail:
    backgroundColor: "{colors.market-sand} / {colors.market-sand-on-dark}"
    textColor: "{colors.market-ink} / {colors.market-ink-on-dark}"
    aspect: "card top preview, object-cover"
  browser-primary-button:
    backgroundColor: "{colors.market-accent}"
    textColor: "{colors.market-accent-text}"
    typography: "{typography.browser-caption}"
    rounded: "{rounded.none}"
    padding: "8px 12px"
  browser-secondary-button:
    backgroundColor: transparent
    textColor: "{colors.market-ink} / {colors.market-ink-on-dark}"
    borderColor: "{colors.market-line} / {colors.market-line-on-dark}"
    typography: "{typography.browser-caption}"
    rounded: "{rounded.none}"
    padding: "8px 12px"
  browser-detail-shell:
    backgroundColor: "{colors.market-paper} / {colors.market-paper-on-dark}"
    borderColor: "{colors.market-line} / {colors.market-line-on-dark}"
    rounded: "{rounded.none}"
    shadow: "var(--market-shadow-card)"
  vscode-panel-shell:
    backgroundColor: "{colors.vscode-bg}"
    textColor: "{colors.vscode-fg}"
    typography: "{typography.vscode-body}"
  vscode-list-row:
    backgroundColor: transparent
    hoverBackgroundColor: "color-mix(in srgb, var(--vscode-list-hoverBackground, var(--vscode-editor-foreground)) 16%, transparent)"
    borderColor: "{colors.vscode-border}"
    rounded: "{rounded.none}"
  vscode-thumbnail:
    backgroundColor: "{colors.vscode-surface}"
    borderColor: "{colors.vscode-border}"
    rounded: "{rounded.xs}"
    size: "112px x 72px list / 96px x 88px detail"
  vscode-primary-button:
    backgroundColor: "{colors.vscode-primary-bg}"
    textColor: "{colors.vscode-primary-fg}"
    typography: "{typography.vscode-body}"
    rounded: "{rounded.xs}"
    minHeight: 26px
  vscode-secondary-button:
    backgroundColor: "{colors.vscode-secondary-bg}"
    textColor: "{colors.vscode-secondary-fg}"
    borderColor: "{colors.vscode-border}"
    typography: "{typography.vscode-body}"
    rounded: "{rounded.xs}"
    minHeight: 26px
  vscode-split-button:
    backgroundColor: "primary or secondary by action"
    textColor: "host button foreground by tone"
    rounded: "{rounded.xs} split into 2px 0 0 2px and 0 2px 2px 0"
    grid: "minmax(0, 1fr) 26px"
  vscode-version-menu:
    backgroundColor: "{colors.vscode-surface}"
    borderColor: "{colors.vscode-border}"
    rounded: "{rounded.sm}"
    shadow: "0 16px 38px color-mix(in srgb, var(--vscode-editor-foreground) 18%, transparent)"
  vscode-detail-shell:
    backgroundColor: "{colors.vscode-surface}"
    borderColor: "{colors.vscode-border}"
    rounded: "{rounded.none}"
    shadow: "0 10px 28px color-mix(in srgb, var(--vscode-editor-foreground) 10%, transparent)"
---

## Overview

Template Marketplace UI 是一个双宿主设计语言：公开浏览器市场位于 `apps/template-marketplace/src/web/`，VSCode 工作台内市场面板位于 `src/panel/CanvasTemplateMarketplacePanel.ts`。两端共享同一套信息架构：搜索、排序、标签、模板摘要行/卡、README-first 详情页、安装/下载动作、版本历史和完整性元数据；但两端不共享同一个 palette。

浏览器市场是一个 **rectangular catalog**。它对齐 Visual Studio Marketplace 的工具型信息布局：黑色品牌栏、单一 active Templates tab、居中标题、大号矩形搜索、Featured 网格、矩形卡片和 README 主导的详情页。品牌强调来自 DevSessionCanvas 蓝色（`{colors.market-accent}`）和绿色（`{colors.market-moss}`），而不是 Visual Studio Marketplace 的玫红色，也不是装饰性 hero 效果。

VSCode 市场面板是一个 **native-density workbench surface**。它从 `--vscode-*` token 跟随当前 VSCode Color Theme，使用紧凑单列 list row，而不是营销卡片墙；列表动作也只是进入详情上下文的快捷入口。它应该像编辑器里的工具面板，而不是把外部网页原样塞进 Webview。

**Key Characteristics:**
- 两套 theme contract：浏览器端固定 `Light 2026` / `Dark 2026` token；VSCode Webview 端完全由宿主 token 派生。
- 矩形 surface、方正 card geometry 和小 workbench radius；当前系统刻意不使用 pill button 和大圆角面板。
- 浏览器端只用一个 action blue（`{colors.market-accent}`）承载 Templates tab、搜索按钮、安装 CTA 和 focus ring tint。
- 绿色（`{colors.market-moss}` / `{colors.market-moss-on-dark}`）只做 secondary semantic accent，用于 tag、link 和弱强调，不与主操作竞争。
- 浏览器详情页是 README-first，一个主 shell 加一个右侧 sidebar，避免 metric / README / version / integrity 的 card-in-card 堆叠。
- VSCode list row 在工作台密度下同时呈现缩略图、标题、详情动作、描述、标签、统计、安装目标、安装/下载控件和已安装 badge。
- 安装和下载 split button 在详情上下文里暴露版本选择；列表 quick action 先打开详情页，再进入对应安装或下载流程。
- 可访问性依赖可见 focus ring、文本按钮、aria label，以及对已安装、离线、错误、版本等状态的非颜色文案。

## Colors

> **Source surfaces documented:** 浏览器市场首页、浏览器模板详情、VSCode 市场列表、VSCode 模板详情。浏览器 token 来源是 `apps/template-marketplace/src/web/styles.css`；VSCode token 来源是 `src/panel/CanvasTemplateMarketplacePanel.ts` 中的 inline Webview stylesheet。

### Brand & Accent
- **Market Accent Blue** (`{colors.market-accent}` -- #4878f0): 浏览器市场的 primary interactive color。用于 Templates tab、搜索按钮、浏览器安装 CTA 和 focus-ring tint，也是连接 DevSessionCanvas 图标的视觉锚点。
- **Accent Text** (`{colors.market-accent-text}` -- #ffffff): 浏览器 primary action 上的文字和图标颜色。
- **Market Moss** (`{colors.market-moss}` -- #48b0a0): 浏览器 secondary interactive color，用于 tag、text link、hover emphasis 和轻量发现 affordance。
- **Market Moss On Dark** (`{colors.market-moss-on-dark}` -- #56c2b2): dark theme 下的 link / tag 强调色，保证在 `{colors.market-paper-on-dark}` 和 `{colors.market-mist-on-dark}` 上可读。
- **VSCode Focus** (`{colors.vscode-focus}`): VSCode 内唯一跨主题 focus root；插件面板不得用浏览器 accent blue 取代它。

### Surface
- **Market Mist** (`{colors.market-mist}` -- #f8f8f8): 浏览器 light page canvas 和大面积背景。
- **Market Mist On Dark** (`{colors.market-mist-on-dark}` -- #1e1e1e): 浏览器 dark page canvas。
- **Market Paper** (`{colors.market-paper}` -- #ffffff): 浏览器卡片、nav strip、搜索输入框、详情 shell、README body 和 sidebar。
- **Market Paper On Dark** (`{colors.market-paper-on-dark}` -- #252526): 浏览器 dark card 和 detail shell surface。
- **Market Sand** (`{colors.market-sand}` -- #f2f2f2): 浏览器 light thumbnail fallback 和中性预览底色。
- **Market Sand On Dark** (`{colors.market-sand-on-dark}` -- #2d2d30): 浏览器 dark thumbnail fallback。
- **Market Nav** (`{colors.market-nav}` -- #000000): 浏览器 global brand bar；纯黑只保留给这条顶部 chrome。
- **VSCode Background** (`{colors.vscode-bg}`): VSCode panel page canvas，严格跟随 `--vscode-editor-background`。
- **VSCode Surface** (`{colors.vscode-surface}`): VSCode detail shell、thumbnail fallback、menu 和 offline card surface；`editorWidget` 不可用时回退到 editor background。

### Text
- **Market Ink** (`{colors.market-ink}` -- #1a1a1a): 浏览器 light surface 上的 primary text。
- **Market Ink On Dark** (`{colors.market-ink-on-dark}` -- #e6e6e6): 浏览器 dark surface 上的 primary text。
- **Market Muted** (`{colors.market-muted}` -- #686868): 浏览器描述、统计、状态标签、较弱 sort/filter copy。
- **Market Muted On Dark** (`{colors.market-muted-on-dark}` -- #aeaeae): 浏览器 dark theme 下的 secondary copy。
- **VSCode Foreground** (`{colors.vscode-fg}`): 插件市场面板内的 primary text。
- **VSCode Muted** (`{colors.vscode-muted}`): 面板说明、描述、非交互 tag、统计、label、disabled version menu item 和 source metadata。

### Hairlines & Borders
- **Market Line** (`{colors.market-line}` -- #dedede): 浏览器 card border、search/input border、nav divider、detail header divider、side rail 和 dashed empty state。
- **Market Line On Dark** (`{colors.market-line-on-dark}` -- #3f3f46): 浏览器 dark border counterpart。
- **VSCode Border** (`{colors.vscode-border}`): 插件面板内的 1px list divider、thumbnail border、detail shell border、menu border、input border fallback 和 sidebar separator。
- **High Contrast Border** (`var(--vscode-contrastBorder)`): VSCode High Contrast / High Contrast Light 下的必选 override；存在时优先于 mixed border，非必要 shadow 应关闭。

### Brand Gradient
**No decorative gradients.** 浏览器端的氛围来自固定 mist / paper / nav surface 和 thumbnail imagery；VSCode 端氛围来自当前 Color Theme。背景光斑、渐变 hero、glassmorphism 和装饰 blob 都不属于模板市场 UI system。

## Typography

### Font Family
- **Browser UI**: `Segoe UI, Aptos, sans-serif` -- 公开市场使用 Windows-first 的中性 UI 字体，不加载 web font。
- **VSCode UI**: `var(--vscode-font-family)` -- 插件面板继承用户当前工作台字体 contract。
- **README content**: 浏览器 README 使用 browser UI stack 和更可读的段落尺寸；VSCode README 使用 `var(--vscode-font-family)` 和紧凑 editor-panel 尺寸。
- **Iconography**: 浏览器搜索使用 inline SVG；VSCode menu 可通过 `dist/sidebar-codicon.css` 使用内置 Codicon。

### Hierarchy

| Token | Size | Weight | Line Height | Letter Spacing | Use |
|---|---|---|---|---|---|
| `{typography.browser-hero}` | 48px | 300 | 1.15 | 0 | 浏览器首页标题；窄屏降到 36px |
| `{typography.browser-detail-title}` | 36px | 300 | 1.15 | 0 | 浏览器详情页模板标题 |
| `{typography.browser-section-title}` | 24px | 600 | 1.25 | 0 | 浏览器 Featured 标题和 README 标题 |
| `{typography.browser-card-title}` | 18px | 600 | 1.35 | 0 | 浏览器模板卡片标题 |
| `{typography.browser-body}` | 16px | 400 | 1.75 | 0 | 浏览器 hero 描述、详情描述、README 正文 |
| `{typography.browser-search}` | 20px | 400 | 1.20 | 0 | 浏览器大号搜索输入框 |
| `{typography.browser-caption}` | 12px | 600 | 1.40 | 0 | 浏览器 tag、button、小元数据和状态动作 |
| `{typography.vscode-panel-title}` | 18px | 600 | 1.30 | 0 | VSCode 面板标题 |
| `{typography.vscode-card-title}` | 14px | 600 | 1.25 | 0 | VSCode list row 模板名 |
| `{typography.vscode-body}` | 12px | 400 | 1.50 | 0 | VSCode 描述、统计、label、control |
| `{typography.vscode-detail-body}` | 13px | 400 | 1.80 | 0 | VSCode README body 和详情描述 |
| `{typography.vscode-overline}` | 11px | 700 | 1.30 | 0.14em | VSCode uppercase section label 和 metric label |

### Principles

- **浏览器标题比工作台标题更轻。** 公开市场在大标题处使用 weight 300；插件面板使用 weight 600，因为它处在高密度 VSCode chrome 中。
- **不引入表现型品牌字体。** 产品主要服务 VSCode 和开发者市场；加载营销 display face 只会增加体积，不能提升任务完成效率。
- **密集元数据保持小字号。** tag、版本号、下载量、点赞数、source label 和 install-target label 保持 11-12px；只有作为 control 或 label 时使用强字重。
- **README 可读性优先于卡片齐整。** 详情页允许更大的 line-height（`{typography.browser-body}` 和 `{typography.vscode-detail-body}`），因为阅读 README 是打开模板详情的主理由。
- **Uppercase 只用于结构标签。** Version history、Integrity、Source 和 metric label 可以使用 uppercase / tracking；模板名和操作文案保持自然文本。
- **状态文案必须直给。** 已安装版本、安装位置、离线 fallback、加载、失败和完整性信息必须能被文本读懂，不能只靠颜色推断。

### Note on Font Substitutes

如果浏览器不可用 `Segoe UI` 或 `Aptos`，直接回退到平台默认 sans-serif。若 Webview 在边缘场景下无法读取 `var(--vscode-font-family)`，使用 VSCode Webview 默认字体栈，而不是导入外部字体。任何未来字体资产都必须先记录 license、体积、CSP 影响、离线行为和 fallback metrics。

## Layout

### Spacing System
- **Base unit:** 4px。浏览器布局使用 4 / 8 / 12 / 16 / 20 / 32 / 64 / 80px；VSCode 面板行内为了紧凑对齐允许 5px micro-gap。
- **Tokens:** `{spacing.xxs}` 4px · `{spacing.xs}` 6px · `{spacing.sm}` 8px · `{spacing.md}` 12px · `{spacing.lg}` 16px · `{spacing.xl}` 20px · `{spacing.xxl}` 32px · `{spacing.section}` 80px。
- **Browser page padding:** 窄屏侧边 24px，`sm` 起 32px；首页垂直 padding 为 64px，大屏为 80px。
- **Browser card grid:** 20px gutter（`gap-5`）和 16px card body padding；card thumbnail 高 144px。
- **Browser detail spacing:** header padding 20-24px；README body 使用 28-36px 垂直 padding 和 20-32px 水平 padding。
- **VSCode shell padding:** 顶部 12px、左右 16px、底部 20px；720px 以下收敛为四周 12px。
- **VSCode row spacing:** row 垂直 padding 10px、column gap 12px、action gap 6px、label/tag gap 4-5px。

### Grid & Container
- **Browser max width:** 首页和卡片网格为 1280px（`max-w-7xl`）；详情页为 1152px（`max-w-6xl`）。
- **Browser columns:** Featured grid 从 1 column 过渡到小屏 2 columns、大屏 3 columns、超大屏 4 columns。
- **Browser detail:** header summary 在大尺寸下使用 thumbnail + content；body 使用 README column + 17rem sidebar。
- **VSCode list row:** `112px minmax(0, 1fr) minmax(224px, 284px)`，并用显式 grid area 安排 thumbnail、title、description、tags、meta、badge、install target 和 actions。
- **VSCode detail:** 宽面板下使用 README column + 18rem sidebar；720px 以下折叠成单列。
- **Toolbar:** 浏览器搜索是宽 input + 56px icon button；VSCode toolbar 是紧凑 search input + 148px sort select。

### Whitespace Philosophy

浏览器 whitespace 应帮助用户扫描市场，但不追求奢华留白。居中标题和大搜索可以拥有明显垂直空间；模板卡和详情元数据仍保持工具型密度。VSCode whitespace 更紧：面板必须在不把用户推入营销滚动的前提下展示多个模板、安装状态和目标选择。空白只在提升 README 阅读或帮助找到安装动作时才有价值。

## Elevation & Depth

| Level | Treatment | Use |
|---|---|---|
| Flat | 无 shadow，矩形 surface，必要时 1px border | 浏览器 nav、tab bar、VSCode list row、tag、text link |
| Browser card shadow | `var(--market-shadow-card)` | 浏览器模板卡片和浏览器详情 shell |
| Browser search shadow | `var(--market-shadow-search)` | 浏览器首页搜索控件，帮助它从 `{colors.market-mist}` 中浮出 |
| VSCode menu shadow | `0 16px 38px color-mix(in srgb, var(--vscode-editor-foreground) 18%, transparent)` | 短生命周期 version menu popover |
| VSCode detail shadow | `0 10px 28px color-mix(in srgb, var(--vscode-editor-foreground) 10%, transparent)` | 插件详情 shell；High Contrast 下禁用或弱化 |

**Shadow philosophy.** 浏览器 elevation 只用于把 catalog card 和主搜索从中性页面 canvas 中区分出来。VSCode elevation 只用于 popover 和当前 detail shell；list 层级应依靠 separator、row layout 和 detail context，而不是卡片阴影堆叠。

### Decorative Depth
- **Thumbnail imagery** 可以在固定矩形预览区域内提供视觉质感；系统不向缩略图叠加 gradient overlay。
- **Hover motion** 在浏览器卡片上只允许小幅 `translateY(-0.5)` 和轻微 image scale；这是反馈，不是 depth language。
- **VSCode High Contrast** 应移除非必要 surface depth：含义必须由 border、text、badge 和 button state 承载。

## Shapes

### Border Radius Scale

| Token | Value | Use |
|---|---|---|
| `{rounded.none}` | 0px | 浏览器 card、button、search input/button、tab、detail shell、VSCode list row |
| `{rounded.xs}` | 2px | VSCode input、select、thumbnail、badge、primary/secondary button、split-button segment |
| `{rounded.sm}` | 4px | VSCode version menu 和紧凑临时 popover |
| `{rounded.md}` | 6px | 预留给未来 compact form surface，必须先由设计文档确认需要 |
| `{rounded.lg}` | 8px | 预留；当前 marketplace surface 不使用 |
| `{rounded.pill}` | 9999px | 不属于当前 marketplace grammar；不得用于 action 或 filter |
| `{rounded.full}` | 9999px / 50% | 仅在未来 media control 需要 circular target 时预留 |

### Photography Geometry
- **Template thumbnails** 是功能性预览，不是生活方式摄影。浏览器 card 使用顶部矩形预览，高 144px；VSCode row 使用紧凑 112px x 72px thumbnail。
- **Detail thumbnails** 是辅助身份锚点：浏览器详情页把紧凑矩形预览放在标题旁；VSCode 详情 summary 使用 96px thumbnail。
- **Fallback thumbnails** 在浏览器端必须使用 `{colors.market-sand}` / `{colors.market-sand-on-dark}`，在 VSCode 端使用 `{colors.vscode-surface}`；图片失败时要保留可读前景文本。
- **Cropping** 使用 `object-cover`；缩略图应兼容自动生成的 canvas screenshot 和用户上传的自定义截图，不要求人工定制裁切。
- **No rounded hero imagery.** 当前 marketplace 没有 full-bleed hero image；缩略图保留在矩形 catalog geometry 中。

## Components

### Top Navigation

**`browser-global-nav`** -- 浏览器市场顶部的 persistent black brand bar。背景 `{colors.market-nav}`，文字 `{colors.market-nav-text}`，高度 48px。左侧 cluster 是 DevSessionCanvas brand、separator、Templates label；右侧 cluster 是非小屏显示的 GitHub link。它只属于浏览器端，不出现在 VSCode 面板。

**`browser-tab-nav`** -- 品牌栏下方的单行导航。背景 `{colors.market-paper}` / `{colors.market-paper-on-dark}`，底部边框 `{colors.market-line}` / `{colors.market-line-on-dark}`。当前只展示 `Templates`；active tab 是矩形 `{colors.market-accent}` block，水平 padding 40px、垂直 padding 16px。不要预留 Canvas、Agents、Resources 等尚不存在的 tab。

**`vscode-panel-header`** -- Webview 内的紧凑 workbench header。左侧是 `{typography.vscode-panel-title}` 的 `模板市场`；右侧是 `在浏览器打开` secondary button。下方说明安装需先进入详情页。不要使用浏览器 brand bar、tab 或 hero title。

### Buttons

**`browser-primary-button`** -- 浏览器安装、搜索和主动作按钮。背景 `{colors.market-accent}`，文字 `{colors.market-accent-text}`，矩形 `{rounded.none}`，小号强标签。卡片动作 padding 为 8px x 12px；详情页主动作 padding 为 12px x 16px。Focus state 使用从 `{colors.market-accent}` 派生的可见 4px ring。

**`browser-secondary-button`** -- 浏览器 JSON 下载或中性动作。背景透明或 `{colors.market-paper}`，1px `{colors.market-line}` border，文字 `{colors.market-ink}`，hover 使用 moss，矩形 `{rounded.none}`。它永远不变成 pill。

**`browser-text-link`** -- 浏览器 link 和 tag filter 使用 `{colors.market-moss}`；selected tag filter 切到 `{colors.market-accent}`，带 underline 和 `aria-pressed`。

**`vscode-primary-button`** -- 插件安装/更新动作。背景和文字来自 `--vscode-button-*`，radius `{rounded.xs}`，最小高度 26px，focus outline 来自 `{colors.vscode-focus}`。Disabled installed state 仍显示 `已安装 vN` 等文本，不能只用颜色表达。

**`vscode-secondary-button`** -- 插件下载、打开、详情动作。背景、文字、边框、hover 和 focus 都从 VSCode token 派生。`查看详情`、`返回列表` 等 text-link variant 优先使用 `--vscode-textLink-foreground`。

**`vscode-split-button`** -- 安装/下载的两段式 control。主段是 `minmax(0, 1fr)`，toggle 段是 26px。接缝处 radius 拆成 `2px 0 0 2px` 和 `0 2px 2px 0`。详情页用 split 行为选择安装/下载版本；列表行的 install-like shortcut 只打开详情上下文。

### Cards & Containers

**`browser-template-card`** -- 矩形 catalog card。背景 `{colors.market-paper}` / `{colors.market-paper-on-dark}`，1px line border，无圆角，`var(--market-shadow-card)`，hover 时轻微 lift。结构是顶部 thumbnail -> title/version row -> description -> tag links -> downloads/likes -> Install/JSON actions。卡片是发现摘要，不是安装确认面。

**`browser-detail-shell`** -- 单一矩形详情容器。Header 包含 back link、thumbnail、title、description 和 tags。Body 是 README column + right sidebar。Downloads、likes、latest version、version history、integrity、install 和 download actions 都留在 sidebar。不要拆成多个 floating card。

**`vscode-list-row`** -- 原生密度模板行。Grid area 保持左侧 thumbnail、中间文本、右侧 install target/actions。Row 使用 bottom border 和可选 row hover background，不使用 card box。Installed badge 文案为 `已安装到 ... · vN`。

**`vscode-detail-shell`** -- 工作台详情容器。Header 包含 `返回列表`、thumbnail、title、description 和 tags。Body 使用 README + 18rem sidebar。Sidebar 集中放置 install target select、install split button、download split button、metrics、version history、integrity 和 source。

**`vscode-version-menu`** -- 依附在 split button 上的短生命周期 popover。它使用 `role="menu"`、4px padding、30px item height；当用户点击外部、按 Escape、改变 search/sort、切换 list/detail context 时关闭。

**`vscode-offline-card`** -- 远端模板加载失败但本地已安装市场模板仍可见时的 fallback row/card。它使用 VSCode surface/border token，写明本地安装位置；如果有 source URL，可以提供浏览器详情动作。

### Inputs & Forms

**`browser-search-input`** -- 大号矩形搜索框。高度 56px，`{typography.browser-search}`，paper 背景，line border，水平 padding 20px，无圆角。它与 `{component.browser-search-button}` 成对出现，并受 `MARKETPLACE_QUERY_MAX_LENGTH` 限制。

**`browser-sort-select`** -- 首页 toolbar 中的紧凑 select。高度 40px，paper 背景，line border，水平 padding 12px，label 为 `Sort`，focus ring 使用 accent tint。

**`vscode-search-input`** -- 紧凑 workbench search。最小高度 28px，1px `--vscode-input-border`，回退到 `{colors.vscode-border}`，水平 padding 8px，radius `{rounded.xs}`。它应直接位于 panel header 下方，不包进大 filter card。

**`vscode-sort-select`** -- 插件面板内 148px toolbar select。Surface 和 focus contract 与 `vscode-search-input` 一致。

**`vscode-install-target-select`** -- 单模板安装目标选择器。它出现在 list row 和 detail sidebar 中，最小高度 28px；其值只决定进入详情/安装上下文后的默认安装目标，用户仍可在详情页修改。

包含大量校验的发布表单不属于当前 Phase 1 浏览/安装 UI，本文不定义。

### Footer

当前浏览器市场没有 footer component。若后续为 legal、status、repository 或 documentation link 增加 footer，应使用 `{colors.market-mist}` / `{colors.market-mist-on-dark}` 或 `{colors.market-paper}` / `{colors.market-paper-on-dark}`、小号 muted text、矩形 geometry，且不使用营销 gradient。VSCode 面板不需要 footer。

## Do's and Don'ts

### Do
- 使用 `{colors.market-accent}` 承载浏览器 primary action、active Templates tab、搜索按钮和 focus-ring tint。
- 使用 `{colors.market-moss}` / `{colors.market-moss-on-dark}` 承载浏览器 tag、text link、hover emphasis 和弱发现信号。
- 浏览器 card、button、search box、tab 和 detail shell 保持 `{rounded.none}` 的矩形语言。
- VSCode 面板所有颜色都从 `--vscode-*` token 派生，包括 hover、border、focus、menu、disabled 和 High Contrast 状态。
- 详情页保持 README-first，并把安装、下载、版本、完整性和统计控制集中到一个右侧 sidebar。
- 列表 quick action 应作为进入详情上下文的快捷入口；不要让按钮文案暗示在列表上直接执行文件系统写入。
- 对 icon-only action 提供 visible focus、aria label，并为 installed、offline、loading、error、version 和 integrity 状态提供非颜色文本。
- 点击外部、按 Escape、搜索/排序变化、list/detail 切换时关闭 version menu。

### Don't
- 不要复制 Visual Studio Marketplace 的玫红 accent；模板市场使用 DevSessionCanvas 蓝色和绿色。
- 不要在 VSCode Webview 面板中使用浏览器固定色。
- 不要添加 decorative gradient、background glow、glass panel、大营销 hero 或装饰 blob。
- 不要在当前 marketplace grammar 中引入 pill button、capsule filter 或大圆角 card。
- 不要把 README、metrics、version history、sha256 和 install control 拆成嵌套 card-in-card 布局。
- 不要把安装位置、已安装版本、离线状态、加载或失败隐藏在只靠颜色识别的 badge 后。
- 不要为 Canvas、Agents、Resources 或其他不存在的 section 创建 placeholder tab。
- 不要把 VSCode 面板做成多列 card wall；它是紧凑工作台列表。

## Responsive Behavior

### Breakpoints

| Name | Width | Key Changes |
|---|---|---|
| Small phone | <= 419px | 浏览器标题和搜索收紧；卡片保持单列；动作按钮换行 |
| Phone | 420-640px | 浏览器保持单列；详情 sidebar 下移到 README 后；nav GitHub link 继续隐藏 |
| Large phone | 641-720px | 浏览器在空间允许时可使用双列卡片；VSCode 面板在 720px 触发紧凑行布局阈值 |
| VSCode narrow panel | <= 720px | 插件 toolbar 变成单列；list row 的 target/actions 下移；detail body 变成单列 |
| Tablet / small desktop | 721-1023px | 浏览器 grid 使用两到三列；VSCode list 在宽度允许时保留右侧 action rail |
| Desktop | 1024-1279px | 浏览器 grid 达到三列；浏览器详情使用 README + 17rem sidebar |
| Wide desktop | >= 1280px | 浏览器首页锁定 `max-w-7xl`；Featured grid 可使用四列 |

对协作者最重要的结构断点：1280px 浏览器 content lock、1152px 浏览器 detail lock、1024px 浏览器多列 detail/grid、720px VSCode 面板折叠、640px 浏览器 phone stack，以及 320px 浏览器最小宽度。

### Touch Targets
- 浏览器搜索按钮为 56px x 56px；primary/secondary card action 换行后仍建议不小于 32px 高。
- 浏览器详情主/次动作使用 12px 垂直 padding，且不能依赖 hover 才可读。
- VSCode 控件是 desktop-workbench density：button 最小 26px，input/select 最小 28px；split toggle 宽 26px。
- Version menu item 至少 30px 高，并可键盘聚焦。
- Icon-only control 即使可视目标紧凑，也必须有 accessible name。

### Collapsing Strategy
- **Browser global nav**: 保留 brand 和 Templates label；小屏隐藏 GitHub link。
- **Browser search**: 保持 input + square button，不变成 floating overlay。
- **Browser cards**: 4-col -> 3-col -> 2-col -> 1-col；卡片内部先让 actions 换行，再截断名称。
- **Browser detail**: summary 先保护身份信息；窄屏时 sidebar 移到 README 下方。
- **VSCode toolbar**: 720px 以下 search + sort grid 折叠成单列。
- **VSCode list row**: thumbnail + text 仍在前，install target 和 actions 在 720px 以下下移到内容后。
- **VSCode detail**: README 和 sidebar 变成单列；sidebar sections 保持原顺序。

### Image Behavior
- 浏览器 thumbnail 使用 lazy-load 和 `object-cover`；当前市场不存在 above-fold hero imagery。
- VSCode thumbnail 从 preview API lazy-load；失败时移除失败 image node，保留主题派生 fallback surface。
- 自动生成的 thumbnail screenshot 在插件列表的 112px x 72px 尺寸下仍应可读，才可视为可发布。
- 不要依赖图片颜色解释分类、已安装状态、版本新旧或信任程度。

## Iteration Guide

1. 一次只改一个 component contract，并直接引用它的 YAML key，例如 `{component.vscode-split-button}` 或 `{component.browser-template-card}`。
2. 当 variant 的默认 geometry、state 或 host token contract 不同时，在 `components:` 中新增独立条目。
3. 记录 design-system 值时使用 `{token.refs}`；如果 token 已存在，不要在正文里重复内联 hex 或 pixel。
4. 先记录 default、disabled、focus 和 active/pressed state，再记录 hover。
5. 保持浏览器和 VSCode host contract 分离：浏览器 token 位于 `apps/template-marketplace/src/web/styles.css`；VSCode token 位于 Webview stylesheet，并从 `--vscode-*` 派生。
6. 新增动作时必须写清它是立即执行，还是先进入详情上下文。
7. UI 规则如果改变业务范围，更新 `docs/product-specs/template-marketplace.md`；如果改变 host/runtime/security 边界，更新 `docs/design-docs/template-marketplace.md`。

## Known Gaps

- 发布、OAuth 登录、用户 dashboard、举报和 admin governance UI 属于 Phase 2-4 surface，不在当前 Phase 1 浏览/安装 UI 文档中定义。
- 浏览器 footer、legal links 和生产状态 surface 尚未进入实现。
- VSCode 面板已定义 High Contrast contract，但浏览器端 high-contrast media handling 尚未单独定义。
- Thumbnail fallback copy/graphics 只定义了结构，最终生成缩略图的 art direction 应进入模板发布/设计工作流。
- 浏览器详情当前把 version history 和 integrity 作为紧凑辅助区域；更复杂的版本对比或 changelog 过滤尚未定义。
