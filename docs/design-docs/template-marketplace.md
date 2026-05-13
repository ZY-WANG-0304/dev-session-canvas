---
title: 模板市场技术选型
decision_status: 已选定
validation_status: 验证中
domains:
  - VSCode 集成域
  - 画布交互域
  - 协作对象域
  - 项目状态域
architecture_layers:
  - 宿主集成层
  - 画布呈现层
  - 共享模型与编排层
  - 适配与基础设施层
related_specs:
  - docs/product-specs/template-marketplace.md
  - docs/product-specs/canvas-template-feature.md
related_plans:
  - docs/exec-plans/active/template-marketplace-tech-selection.md
  - docs/exec-plans/active/template-marketplace-foundation.md
updated_at: 2026-05-12
---

# 模板市场技术选型

## 1. 背景

`docs/product-specs/template-marketplace.md` 已把模板市场定义为社区驱动的公开发现、发布、安装平台，并明确需要插件内独立 Webview Editor、浏览器 Web 端、GitHub OAuth、统计排行、版本管理与治理后台。这个能力已经超出本地模板文件管理范围：它需要一个可公开访问的 Web 应用、一组市场 API、可下载的模板包与缩略图存储、用户身份和治理数据。

当前仓库已经有本地模板模型，核心落点是 `src/common/canvasTemplates.ts`、`src/panel/CanvasTemplateStore.ts`、`src/panel/CanvasPanelManager.ts` 和 `src/sidebar/CanvasSidebarTemplateView.ts`。模板市场必须复用这套模板文件语义，而不是重新定义另一个不兼容的模板格式。技术选型工作的目的，是把 Web 前端、后端、存储、认证和 VSCode 集成边界写成可执行的正式方案，并记录为什么在 Phase 1-4 的完整目标下选择 React + Vite 而不是 Next.js、选择 Cloudflare Workers/D1/R2 而不是自建后端。

## 2. 问题定义

本次选型需要回答六个问题。

第一，Web 端和插件内市场页是否使用同一套前端实现。市场需要在浏览器里有独立 URL，也需要在 VSCode Webview Editor 中打开；二者视觉和交互应一致，但 VSCode Webview 有 CSP、资源 URI、离线打包和 Remote/Codespaces 兼容要求，不能简单把远程站点 iframe 进插件。

第二，API 和数据层放在哪里。模板市场从 Phase 1 浏览安装到 Phase 4 版本治理，本质仍是公开读、多用户写、版本化对象下载、统计聚合和治理审计，不需要自建 Kubernetes、长连接服务或复杂后端集群，但需要稳定的 SQL 元数据、对象存储、CDN 分发和低运维成本。

第三，认证如何同时服务浏览器和 VSCode。产品规格已确认匿名浏览下载，发布和点赞需要 GitHub OAuth；插件内发布还要求复用 VSCode 已有认证能力，因此后端要能把浏览器 OAuth session 与 VSCode `github` authentication session 映射到同一个市场用户。

第四，市场包如何与本地模板兼容。公开市场需要名称、描述、标签、发布者、版本、下载量、点赞数、缩略图、举报状态等元数据；本地模板文件只应继续表达画布节点、连线和静态配置，不应被远端统计字段污染。

第五，统计、排行和治理怎样从一开始支撑 Phase 4。下载量、点赞、举报、版本发布、用户封禁、模板下架/恢复和后台操作必须可追踪；但当前 Phase 1-4 范围不能为了范围外的超大规模排行榜或复杂风控而引入明显重运维的数据系统。

第六，后续实现应落到哪些仓库路径与验证命令。选型文档不直接创建生产服务，但必须给后续实现者明确的新增模块边界、测试层次和退出条件。

## 3. 目标

- 用一套 TypeScript 合约贯穿 Extension Host、Webview、浏览器前端与 Worker API，避免模板包格式和市场 API 互相漂移。
- 让浏览器 Web 端和 VSCode Webview Editor 共享前端组件与交互状态机，但通过不同 host adapter 处理路由、资源、认证触发和安装回流。
- 选择低运维、边界清楚、可从 Phase 1 平滑扩展到 Phase 4 的 serverless 基础设施。
- 保持本地模板 `CanvasTemplateDocument` 的兼容性，市场元数据通过远端表和本地安装 sidecar 追踪，不把远端事实写进模板主体。
- 明确认证、上传校验、内容治理和管理员操作的安全边界，避免把 GitHub access token 或管理员权限当作普通前端状态保存。

## 4. 非目标

- 不在本次选型中实现生产服务、数据库迁移或云资源创建。
- 不引入付费模板、私有市场、团队租户、模板评论区或实时协作能力。
- 不把浏览器 Web 端做成完整独立工作台；它只负责市场发现、发布、管理与安装跳转。
- 不在 Phase 1-4 范围内承诺高级全文搜索、个性化推荐、风控模型或海量实时榜单。
- 不把市场前端作为远程脚本直接注入 VSCode Webview；插件内页面必须使用扩展打包后的本地资源。

## 5. 候选方案

### 5.1 Cloudflare Workers + D1 + R2 + React/Vite + Hono + Drizzle

这个方案使用 Cloudflare Workers 承载 API，Workers Static Assets 或同一 Worker 资产绑定承载浏览器 SPA，D1 保存 SQL 元数据，R2 保存模板 JSON、缩略图和导出包。API 使用 Hono 作为轻量 TypeScript HTTP 框架，数据库访问层使用 Drizzle ORM，前端使用 React + Vite。

优点是 API、静态站点、SQL 元数据、对象存储和边缘缓存都能落在同一平台，部署和权限模型简单；D1 的 SQLite 语义适合模板、版本、用户、点赞、举报、管理员角色和审计日志这类关系型数据；R2 适合模板包和缩略图这类非结构化对象。对 Phase 4 来说，`template_versions` 能保存版本历史和更新说明，`reports`、`admin_roles`、`admin_audit_logs` 能支撑举报队列、用户封禁、模板下架/恢复与治理审计，`template_daily_stats` 能支撑统计面板，R2 不可变版本对象能支撑手动更新和回滚。Workers 与 Hono / React / Vite 的官方路径也直接覆盖“SPA + API”形态。Drizzle 能让 D1 schema、migration 和查询保持类型化。它与当前仓库已有 TypeScript / React / esbuild 经验接近，不要求把扩展代码迁移到全栈框架。

代价是 D1 不应被误当作无限写入的实时分析库；Phase 4 的下载趋势、治理后台统计和热度排行需要以日聚合、累计计数和审计日志为边界，后续如果写入压力显著增长，再把事件流迁到队列或专用分析存储。另一个代价是 Workers runtime 不等同于 Node.js，需要避免依赖 Node-only API。

当前取舍：采用这条路径作为正式方案。

### 5.2 Next.js + Cloudflare / Vercel 全栈前端

这个方案适合以 Next.js 为中心的 Web 产品，SSR、SSG、路由、部署预览和 SEO 能力成熟，也可以通过 Cloudflare 适配层部署到 Cloudflare 生态。

主要风险是本产品同时有浏览器 Web 端和 VSCode Webview Editor。Next.js 的服务端渲染、路由和运行时能力对浏览器站点有价值，但插件内页面仍然必须以扩展本地资源和 Webview CSP 运行，不能直接复用一个远程 SSR app。若为了浏览器站点采用 Next.js，又为 Webview 再维护一套 SPA bundle，会让 Phase 1-4 正式路线从一开始分裂成两套前端运行模型；若把 Next.js static export 作为 Webview 资源，又需要额外验证动态路由、资源路径、CSP 和打包体积。当前 Phase 1-4 不把 SEO 作为核心成功条件，因此暂不选择 Next.js 作为默认前端框架。

### 5.3 Supabase / Firebase 类一体化 BaaS

这类方案提供数据库、对象存储、认证和后台能力，能快速搭建社区应用。

主要风险是产品规格已经确认 GitHub OAuth 和 VSCode 认证复用，市场核心数据模型也不依赖实时订阅或客户端直连数据库。引入 BaaS 的客户端权限模型、RLS 或自带 Auth 会把认证事实拆成“BaaS 用户”和“GitHub / VSCode 用户”两层，反而增加调试与安全边界。若后续出现团队私有市场、实时协作或复杂管理后台，再重新评估是否需要专门的 BaaS 能力。

## 6. 风险与取舍

- 风险：D1 承担下载事件和趋势统计的高频写入后可能成为瓶颈。当前缓解是 Phase 1-4 只在 `template_versions` / `templates` 上维护累计计数，并写入按天聚合的 `template_daily_stats`；Phase 4 管理后台直接读取日聚合、举报状态和审计日志，原始下载事件默认不长期保存。若 Phase 3 后真实写入压力超过 D1 舒适范围，再引入 Cloudflare Queues 或专用分析存储作为事件缓冲。
- 风险：关键词搜索如果只靠简单 SQL `LIKE`，在多语言、标签权重和排序解释上能力有限。当前缓解是 Phase 1-4 只承诺名称、描述和标签的基础匹配；`templates.search_text` 保存规范化文本，标签单独入表。复杂搜索或推荐算法不进入本次选型。
- 风险：浏览器端 OAuth 和 VSCode 端认证如果共用一套 token 处理，很容易把 GitHub access token 持久化到不该保存的位置。当前缓解是后端只在登录换取市场 session 时临时校验 GitHub token，不把 GitHub token 写入 D1；浏览器使用 HttpOnly session cookie，VSCode 使用短期 marketplace token 并存入 `context.secrets`。
- 风险：远端市场元数据写入模板 JSON 会破坏本地模板的可分享性。当前缓解是市场 canonical metadata 放在 D1，安装到本地时写 sidecar 元数据；`template.json` 仍保持 `CanvasTemplateDocument` 语义。
- 风险：VSCode Webview 直接加载远程站点会破坏 CSP、离线可用性和 Remote/Codespaces 行为。当前缓解是 Webview 市场页只加载扩展打包资源，通过 message passing 和 HTTPS API 与宿主 / 远端通信。
- 风险：自动化内容安全检查策略尚未具体化。当前选型只决定执行位置：上传进入 Worker API 后先做 schema、大小、字段长度、图片类型和危险 URL 检查；是否接入外部审核或模型化内容安全，需要在治理实现前另写设计补充。

## 7. 正式方案

### 7.1 总体技术栈

| 维度 | 选定方案 | 选型理由 |
|------|----------|----------|
| 后端基础设施 | Cloudflare Workers + D1 + R2 | 全栈单平台、低运维，覆盖 Phase 1-4 的公开读、认证写、版本管理、治理审计、对象下载和轻量统计 |
| Web 前端框架 | React 18 + TypeScript + Vite | 同一套组件可同时产出浏览器 SPA 和 VSCode Webview 本地 bundle，避免 Next.js 在浏览器与 Webview 之间制造两套运行模型 |
| API 框架 | Hono | Workers 原生、轻量中间件、TypeScript 友好，适合承载 `/api/v1` JSON API |
| 数据库访问层 | Drizzle ORM | 支持 D1，schema、migration 和查询类型化，避免手写 SQL 散落在 Worker 路由中 |
| UI 组件/样式 | Tailwind CSS + shadcn/ui 源码级组件 | 可快速搭建 Web 市场卡片、表单和后台；VSCode Webview 中必须通过 theme adapter 映射 `--vscode-*` token |
| 静态资产 | Cloudflare Workers Static Assets | 浏览器 SPA 与 Worker API 可在同一 Cloudflare 部署单元中交付，预览先使用 `*.workers.dev`，正式入口计划为 `https://dscanvas.dev/templates` |
| 代码仓库结构 | Monorepo（当前仓库内） | 共享模板类型、API contract 和测试夹具，不引入独立发布流程 |
| 共享策略 | `packages/marketplace-shared` | 模板格式、API 类型、Drizzle schema、Zod schema 和错误码两端复用 |
| 缩略图生成 | 客户端 SVG -> PNG | Webview 已有画布布局语义，无需为缩略图引入服务端渲染基础设施 |
| 测试框架 | Vitest + miniflare + Playwright | ESM 原生、D1/R2 本地模拟、与仓库已有 Playwright UI 回归方向一致 |

技术栈全貌：

- **Web 前端**：React 18 + TypeScript + Vite + Tailwind CSS + shadcn/ui 源码级组件。浏览器端作为 SPA 部署到 Cloudflare Workers Static Assets；VSCode Webview 端由 Vite 产出独立本地 bundle。
- **API 层**：Cloudflare Workers + Hono，全部 API 以 JSON over HTTPS 暴露，并统一使用 `/api/v1` 前缀。
- **数据库**：Cloudflare D1 + Drizzle ORM，schema 定义在 `packages/marketplace-shared` 中；当前基础工程以手写 SQL migration 固化首版表结构，后续需要自动生成 migration 时再接 Drizzle Kit。
- **对象存储**：Cloudflare R2，保存模板 JSON、缩略图 PNG 和导出包。
- **认证**：GitHub OAuth。浏览器走 OAuth authorization code + PKCE；VSCode 插件端优先使用 `vscode.authentication.getSession('github', scopes, { createIfNone: true })` 获取 GitHub session，再向 Worker 换取市场 session。
- **合约与校验**：`packages/marketplace-shared` 导出 API request/response 类型、Drizzle schema、Zod 验证 schema 和模板格式定义；Worker 上传入口使用同一 schema 做服务端校验。
- **Next.js 边界**：Phase 1-4 正式路线不使用 Next.js。若后续 SEO、OpenGraph 或静态详情页成为核心目标，再单独做 PoC 比较 Next.js static export / OpenNext 与 VSCode Webview 本地 bundle 的兼容性。

### 7.2 仓库落点

后续实现新增以下路径：

- `apps/template-marketplace/`：市场 Web 与 Worker 应用。内部按 `src/web/`、`src/worker/`、`src/shared/` 组织，避免浏览器代码直接依赖 Worker binding。
- `apps/template-marketplace/src/web/`：React + Vite Web 前端，包含浏览器端市场页面、VSCode Webview entry、host adapter、卡片、详情、发布表单、Dashboard 和管理后台组件。
- `apps/template-marketplace/src/worker/`：Cloudflare Workers + Hono API 服务，包含路由、中间件、认证、上传校验和 D1/R2 操作。
- `packages/marketplace-shared/`：市场共享包。包含 Drizzle schema 定义、API request/response 类型、Zod 验证 schema、模板包 manifest 类型、错误码和分页类型。该包不能依赖 `vscode`、React、DOM 或 Cloudflare runtime binding；根入口保持浏览器安全，Drizzle schema 通过 `@dev-session-canvas/marketplace-shared/schema` 子路径导出，避免浏览器市场 bundle 引入 Drizzle runtime。
- `src/panel/TemplateMarketplaceClient.ts`：Extension Host 侧市场 API client、安装模板写入、更新检查和认证换取逻辑。它只能通过宿主发起网络请求和写本地模板目录，不能让 Webview 自己写入文件系统。
- `src/panel/CanvasTemplateMarketplacePanel.ts`：插件内独立 Webview Editor 的 HTML、CSP、资源 URI 和 message bridge。当前基础实现先用本地 Webview HTML 读取 preview Worker API，并通过 message passing 把浏览器侧下载到的模板 payload 交给 Extension Host 安装；后续应把它收敛到 `apps/template-marketplace/src/web/` 的共享 React 组件和 VSCode host adapter，避免长期维护两套 UI。
- `src/common/canvasTemplates.ts`：继续作为本地模板语义来源；若需要共享到 `packages/marketplace-shared`，应通过提取纯类型/解析函数完成，不在这里直接引入远端 API 字段。
- `src/panel/CanvasTemplateStore.ts`：安装市场模板时继续写入全局用户模板目录，并额外写入 market sidecar；本地模板 JSON 主体仍保持普通用户模板可离线应用。

### 7.3 前端运行模型

浏览器市场页和 VSCode Webview 市场页共享 `MarketplaceApp`、数据 query hooks、卡片、详情页、发布表单、Dashboard 和管理后台组件，但由 Vite 产出两个 entry，并分别注入 host adapter：

- `BrowserMarketplaceHost` 使用浏览器 History 路由、cookie session、普通文件上传和公开安装深链接。当前浏览器安装链接格式固定为 `vscode://devsessioncanvas.dev-session-canvas/install-template?template=<slug>&version=<versionId>&source=<detailUrl>`；`source` 指向 `/templates/:slug` 详情页。外部 `vscode://` 安装链接不携带内联 payload；扩展端收到链接后打开插件内模板详情页并预选对应版本，安装动作在详情页继续确认。实际安装从受控 Webview message bridge 进入，由详情页从市场 API 下载模板 JSON 后把 inline payload 交给 Extension Host 校验并写入模板库，不能把 payload 放进外部 URI。
- `VSCodeMarketplaceHost` 使用 Webview message passing、hash 或内存路由、扩展打包资源 URI、宿主触发的 GitHub 登录和宿主安装命令；市场列表中的模板行可以预选安装位置、提供“查看详情”文本动作，以及安装、更新、已安装和下载 JSON 等快捷动作；这些快捷动作统一打开模板详情页并执行对应动作。列表安装位置作为详情页默认安装目标，详情页承载最终安装确认、安装 / 下载版本选择和 README 阅读。

浏览器端正式入口计划为 `https://dscanvas.dev/templates`，预览入口继续使用 `*.workers.dev`。因此浏览器构建必须支持 `/templates/` base path，前端详情路径使用 `/templates/:slug`，模板详情分享链接和 Web 端安装入口也以该路径生成。这个决定只确认浏览器页面入口，不改变当前 `/api/v1` API 前缀；若后续希望把市场 API 也收敛到 `/templates/api/v1`，需要在实现前新增设计补充并同步产品规格。

Cloudflare Workers Static Assets 只负责浏览器 SPA 和静态资源 fallback；`/api/*`、`/templates` 和 `/templates/*` 必须通过 `assets.run_worker_first` 先进入 Worker。这样既能避免浏览器直接访问 `/api/v1/...` 且 `Accept: text/html` 时被 SPA fallback 返回 `index.html`，也能让 `/templates/assets/...` 被 Worker 重写到实际 Vite 产物路径 `/assets/...`。

浏览器端使用 SPA fallback 保证模板详情页有独立 URL；Phase 1-4 不承诺搜索引擎级 SSR/SSG。若后续 SEO 成为核心目标，应新增设计补充重新比较 Next.js 或静态预渲染方案。

Webview 不加载远程 JavaScript，也不把远程站点 iframe 进插件。远程 API 的 base URL 由宿主注入，默认指向生产市场域名；开发模式可通过配置指向本地 Worker dev server。Webview 与宿主之间只传递用户动作和 API 结果，不把 GitHub token 或市场 session 暴露给 DOM 可持久化状态。

#### 7.3.1 市场页 UI 定义

模板市场的详细 UI 定义拆分到 `docs/marketplace/UI.md`，该文档分别维护浏览器市场网站的 `Light 2026` / `Dark 2026` 主题、Visual Studio Marketplace 式信息布局，以及 VSCode 插件内市场面板的 `--vscode-*` token adapter、列表密度、详情页结构和可访问性要求。`docs/UI.md` 只保留 DevSessionCanvas 通用 VSCode design-system 基线，不再承载模板市场的 palette、页面结构或业务动作语义。

设计文档只记录运行模型和行为边界：浏览器端 `Install in VSCode` 生成外部 URI，扩展端收到 URI 后打开 VSCode 内模板详情页并预选模板 / 版本；VSCode 插件内列表中的安装、更新、已安装和下载 JSON 等快捷动作，也以“打开模板详情页并执行对应动作”来描述。安装类动作进入详情页安装确认上下文，下载类动作进入详情页下载上下文；实际 payload 下载、宿主 message bridge 校验、模板写入和 sidecar 记录仍由详情页动作链路进入 Extension Host。

shadcn/ui 仍只作为后续共享 React 组件的源码级起点，不直接照搬默认 SaaS dashboard 风格；后续把插件内面板收敛到共享 React Webview bundle 时，必须保留 `docs/marketplace/UI.md` 中定义的 VSCode token adapter，不得把浏览器网站 CSS 变量直接复用为插件内主题。

### 7.4 API 与数据模型

Worker API 按产品规格中的端点分组，以版本前缀组织：

- `GET /api/v1/templates`：列表、关键词、标签、排序和分页。
- `GET /api/v1/templates/:id`：模板详情、版本列表、发布者摘要和当前用户互动状态。
- `GET /api/v1/templates/:id/download?version=`：记录下载并返回模板包内容或短期下载地址。
- `GET /api/v1/templates/:id/thumbnail?version=`：返回指定版本缩略图；preview / production 有 R2 binding 时读取 R2 PNG，本地无 R2 时返回显式 seed SVG 降级图。
- `POST /api/v1/templates`：发布新模板，需要认证。
- `POST /api/v1/templates/:id/versions`：发布新版本，需要作者权限。
- `POST /api/v1/templates/:id/like`：点赞或取消点赞，需要认证。
- `POST /api/v1/templates/:id/report`：举报，需要认证。
- `GET /api/v1/me/templates`、`GET /api/v1/me/likes`、`GET /api/v1/me/stats`：个人页面与 Dashboard。
- `GET /api/v1/admin/reports`、`PATCH /api/v1/admin/templates/:id`、`PATCH /api/v1/admin/users/:id`：治理后台，需要管理员角色。

匿名公开读取端点需要同时服务浏览器页面、workers.dev preview、自定义域名和 VSCode Webview。本方案允许 `/api/v1/*` 中的 GET / OPTIONS 公开 CORS 访问，并暴露下载响应所需的 `content-disposition`、`x-marketplace-storage-mode`、`x-marketplace-catalog-storage-mode`、`x-marketplace-template-id`、`x-marketplace-version-id` 和 `x-marketplace-sha256` 响应头。该策略只适用于不携带 cookie/token 的公开读取与下载；GitHub OAuth、发布、点赞、举报和治理后台写接口需要在实现时单独收紧 origin、credentials 与权限校验，不能默认继承匿名读取 CORS 策略。

下载端点的响应语义分两层固定：正式 Worker 在存在 `TEMPLATE_BUCKET` R2 binding 时，先用 D1 / seed repository 解析模板版本元数据，再从 R2 读取 `template.json` 并以 `Content-Disposition: attachment` 返回真实文件，响应头携带 `x-marketplace-storage-mode: r2`、模板 id、版本 id 和 D1 中记录的 sha256；当本地开发或测试环境没有 R2 binding 时，端点仍返回包含 `objectKey`、`sha256`、`sizeBytes` 和 `downloadUrl` 的显式元数据 JSON，作为 seed / D1 降级路径，不冒充真实对象下载。缩略图端点同样先通过 D1 / seed repository 解析版本，再读取该版本的 `thumbnailKey`；R2 对象存在时返回 `image/png` 和公开缓存头，不记录下载计数；无 R2 binding 时返回 seed SVG，前端仍保留渐变占位防止图片加载失败导致卡片空白。

D1 在 Phase 1-4 范围内的核心表（通过 Drizzle ORM 定义在 `packages/marketplace-shared/src/schema.ts`）包括：

- `users`：GitHub user id、login、display name、avatar、创建时间、最后登录时间和封禁状态。
- `templates`：模板 id、slug、当前最新版本、名称、描述、发布者、状态、累计下载、累计点赞、创建和更新时间。
- `template_versions`：版本 id、模板 id、递增版本号、更新说明、R2 object key、缩略图 key、sha256、文件大小、schema version、发布状态。
- `template_tags`：模板与自由标签的多对多关系，标签使用规范化小写存储，显示文本保留原始输入。
- `template_likes` / `template_collections`：用户互动关系，使用唯一约束保证每人每模板一次。
- `template_daily_stats`：按天聚合下载、点赞和发布指标，服务趋势图与排行榜。
- `reports`：举报原因、举报人、模板、版本、状态和处理结果。
- `admin_roles` / `admin_audit_logs`：管理员身份与治理动作审计。

R2 对象按不可变版本组织，示例 key：

- `templates/{templateId}/versions/{versionNumber}/template.json`
- `templates/{templateId}/versions/{versionNumber}/thumbnail.png`
- `templates/{templateId}/versions/{versionNumber}/package.zip`

模板 JSON 上传后先通过 Zod schema 和业务规则校验，再写入 R2；D1 中保存对象 key、大小、hash 和版本状态。版本一旦上架，不原地覆盖对象；发布新版本只创建新的 `template_versions` 记录并更新 `templates.latest_version_id`。

### 7.5 市场模板包与本地安装元数据

市场 canonical package 包含三层内容：

1. `template.json`：仍然是当前本地模板的 `CanvasTemplateDocument`，只描述节点、边和静态配置。
2. `manifest.json`：市场包 manifest，记录市场模板 id、版本 id、版本号、发布者、标签、描述、对象 hash、最小扩展版本、provider 标注和缩略图引用。
3. `thumbnail.png`：卡片和详情页缩略图。

插件安装市场模板时，让用户为目标模板选择“本地（当前设备）”或可用 workspace 模板目录作为安装目标。插件内列表行可以展示同一安装位置下拉作为默认目标预选；安装快捷动作打开详情页并进入安装确认上下文，用户在详情页点击安装 split button 后，本地目标写入 `globalStorageUri/templates/marketplace/`，workspace 目标写入当前 workspace 下 `.dev-session-canvas/templates/marketplace/`，并在相邻位置写入 sidecar，例如 `Review-Loop.market.json`。sidecar 记录 `marketTemplateId`、`marketTemplateSlug`、`marketVersionId`、`installedVersionNumber`、`installedAt`、`sourceUrl`、`publisher`、`thumbnailKey` 和 `checksum`。这样模板即使离线也可以作为普通用户模板应用；当市场 API 可用时，宿主再用 sidecar 检查更新、显示市场来源和执行回滚。模板目录扫描会忽略 `*.market.json`，避免 sidecar 被误解析成模板文件；用户手动保存或导入覆盖同一路径时会移除 sidecar，防止普通本地模板继续被标记为市场来源。市场模板首次安装到某个目标位置时会生成本地唯一模板 id；同一目标位置内更新或重装时保留原本地 id 和创建时间，避免默认模板引用、侧栏选择态与行级操作在版本更新后失效，同时允许同一市场模板在本地和 workspace 各有独立可操作副本。侧栏模板标签统一显示 `来源 · 位置`，市场模板显示为 `市场下载 · 本地` 或 `市场下载 · 工作区`。


本地模板格式不新增 `market` category。UI 可以把“市场来源”作为存储层派生标签展示，但 `CanvasTemplateDocument` 中的 `category` 仍只表达模板主体在本地模板系统中的兼容分类。

### 7.6 认证与权限

浏览器端登录使用 GitHub OAuth web application flow，并启用 `state` 与 PKCE。OAuth App 初期可以归属个人 GitHub 账号，不要求先创建 GitHub Organization；后续如需要团队交接，再把 OAuth App 转移到组织或重新创建生产 OAuth App。Worker 完成 code exchange 后调用 GitHub API 校验用户身份，然后创建或更新 `users` 记录，并写入 HttpOnly、Secure、SameSite 的市场 session cookie。

VSCode 端发布、点赞和管理动作不自己实现 OAuth 回调主流程，而是优先调用 VSCode 内置 GitHub authentication provider。宿主拿到 GitHub access token 后调用 `POST /api/v1/auth/vscode/exchange`；Worker 只临时用该 token 调 GitHub API 获取用户身份，然后返回短期 marketplace token。宿主把 marketplace token 放入 `context.secrets`，并在失效后重新通过 VSCode authentication session 换取。

GitHub OAuth App 只有单一 callback URL；因为预览环境使用 `*.workers.dev`，生产浏览器入口计划为 `https://dscanvas.dev/templates`，预览和生产建议分别创建 OAuth App，并在 Worker 环境变量中分别配置 `GITHUB_CLIENT_ID`、`GITHUB_CLIENT_SECRET` 和 callback URL。

权限规则：

- 匿名用户只能浏览、搜索、查看详情和下载。
- 登录用户可以发布、点赞、收藏、举报和管理自己的模板。
- 模板作者可以发布新版本、编辑描述和下架自己的模板，但不能删除审计记录。
- 管理员由 `admin_roles` 判定，初始管理员通过 Worker secret 中的 GitHub login / id allowlist bootstrap；所有管理动作写入 `admin_audit_logs`。
- 被封禁用户不能发布、点赞或举报；已上架模板是否下架由治理动作单独决定。

### 7.7 上传校验、治理与安全边界

上传入口按顺序执行：请求大小限制、MIME / 扩展名检查、JSON parse、`CanvasTemplateDocument` / 市场 manifest Zod schema 校验、节点/边业务规则校验、Provider 标注提取、缩略图类型和尺寸检查、文本字段长度限制、危险 URL / 控制字符检查、hash 计算、写入 R2、写入 D1。任一步失败都返回结构化错误码，并且不产生部分上架状态。

内容安全在 Phase 1-4 范围内只做确定性检查和举报治理，不把外部 AI 审核服务列为硬依赖。若后续需要接入第三方审核，应新增设计文档说明数据出境、误杀处理和人工复核流程。

治理后台与普通 Web 端共享 React 组件和 API client，但路由、权限判断和审计日志必须由 Worker 强制执行；前端隐藏按钮不能作为权限边界。

### 7.8 排序、统计和缓存

排序需求在 Phase 1-4 范围内支持四类：下载量、点赞数、最新发布、最近更新。综合热度的候选公式为：

`hot_score = log10(download_count + 1) * 0.7 + log10(like_count + 1) * 1.3 + freshness_boost`

`freshness_boost` 只按最近 30 天更新时间给小幅加分，避免老模板永久霸榜。这个公式只是初始口径，需在 Phase 3 前用真实数据复核；如果产品侧调整权重，应更新本设计文档和产品规格。

下载接口先确认 R2 对象存在，再记录计数并返回对象或重定向到短期对象 URL。当前 D1 实现会在真实 R2 文件响应前把 `templates.download_count` 累加 1，并对 `template_daily_stats(template_id, day)` 做 upsert 日下载计数；如果 R2 对象缺失并返回 404，不写下载计数。缩略图接口只读取 R2 对象并设置 `public, max-age=3600, s-maxage=86400`，不写下载统计。模板详情、列表和缩略图使用 HTTP cache headers；登录用户互动状态单独请求或短缓存，避免因为全页缓存泄漏个性化状态。

### 7.9 Phase 4 承载边界与退出条件

这次后端选型以 Phase 4 为目标，而不是只服务 Phase 1。Phase 4 的核心工作是版本化内容分发、更新检查、举报队列、管理员治理和可审计状态变更；这些能力仍然是短请求 JSON API、关系型状态、不可变对象和聚合统计的组合，不需要常驻自建应用进程。

Phase 4 在本方案中的承载方式如下：

- 版本历史、发布新版本、手动更新和回滚由 `template_versions`、`templates.latest_version_id`、安装 sidecar 与 R2 不可变版本对象共同承载。
- 举报队列、模板下架/恢复、用户封禁和管理员权限由 `reports`、`users.banned_at`、`admin_roles` 和 Worker 端权限中间件承载。
- 治理审计由 `admin_audit_logs` 记录操作者、动作、目标对象、前后状态摘要和时间戳，前端管理后台只能展示这些 API 结果，不能成为权限边界。
- 数据统计面板优先读取 `template_daily_stats` 与累计字段，避免把 D1 设计成原始事件仓库。

退出条件也需要明确：如果 Phase 4 实测出现高频原始事件写入、复杂全文搜索/推荐、需要异步人工审核流水线、批量通知、实时协作或长时间任务，再在本设计文档新增决策记录，评估 Cloudflare Queues、Durable Objects、专用搜索/分析存储，或重新比较自建后端。只要需求仍停留在当前 Phase 1-4 的版本化市场与治理后台范围内，Workers + D1 + R2 是正式方案而不是临时 Phase 1 原型。

## 8. 验证方法

技术路线已进入基础工程验证，`validation_status` 为 `验证中`。当前已通过 `packages/marketplace-shared`、`apps/template-marketplace` 的 seed repository、D1/Drizzle 核心 schema、D1 SQL migration、只读 D1 repository、Cloudflare preview D1 migration/seed、R2 `template.json` 与 `thumbnail.png` seed 对象写入和摘要校验、workers.dev 预览部署、Hono Worker API、公开读取 API CORS、Static Assets `/api/*` 与 `/templates*` Worker 优先路由、React + Vite 浏览器列表/详情构建、本地测试、下载计数写入、浏览器安装深链接与扩展端 sidecar 落盘、插件内独立 Webview 市场页匿名浏览/安装的真实 VSCode 宿主 smoke、插件内市场直接下载、指定版本安装/下载、重复安装覆盖和缩略图展示的源码/脚本与人工验证，以及本轮 `docs/marketplace/UI.md` 中 `Light 2026` / `Dark 2026` 浏览器主题变量和插件内 VSCode token 化样式的 build / typecheck / 代码扫描验证，证明 Phase 1 浏览与安装已在 preview 环境连通；但 GitHub OAuth、共享 React Webview bundle、完整生产资源分离、发布/点赞/举报写接口和治理后台尚未完成，因此不能标为 `已验证`。后续应继续完成以下验证：

1. 使用 Vitest + miniflare 在本地 Worker / D1 / R2 模拟环境中运行市场 API 集成测试，覆盖匿名列表、详情、下载、GitHub 登录换取、发布、点赞、举报和管理员下架。
2. 对共享 `packages/marketplace-shared/` 执行 Drizzle schema round-trip 测试和 Zod 验证测试，证明现有 `resources/templates/*.json` 能作为合法市场模板包上传，并且损坏模板会被拒绝。
3. 在浏览器运行 Vite dev server，验证搜索、标签、排序、详情、发布表单和登录态切换；使用 Playwright 编写 E2E 测试覆盖核心路径。
4. 扩展 VSCode smoke：已确认独立 Webview Editor 市场页可加载并安装市场模板；后续还需覆盖多种真实 VSCode Color Theme、高对比主题、离线时仍可应用模板、更新提醒与回滚。
5. 验证 VSCode 端发布流程使用 `vscode.authentication.getSession('github', ...)`，且 GitHub access token 不写入 `workspaceState`、`globalState`、模板 JSON 或 Webview local state。
6. 对上传大小、缩略图格式、重复点赞、被封禁用户发布、非作者发布新版本、非管理员访问后台等失败路径执行自动化测试。
7. 执行 `git diff --check`、`npm run typecheck`，并为新增 app / package 补齐对应 `npm run test:marketplace-api` 和 `npm run test:marketplace-web` 脚本。

## 9. 外部依据

本次选型参考的外部官方文档如下：

- Cloudflare Workers 文档：<https://developers.cloudflare.com/workers/>
- Cloudflare D1 文档：<https://developers.cloudflare.com/d1/>
- Cloudflare R2 文档：<https://developers.cloudflare.com/r2/>
- Cloudflare Workers Static Assets 文档：<https://developers.cloudflare.com/workers/static-assets/>
- Hono 文档：<https://hono.dev/>
- Drizzle ORM 文档：<https://orm.drizzle.team/>
- Drizzle + D1 集成：<https://orm.drizzle.team/docs/get-started/d1-new>
- Vite 文档：<https://vite.dev/guide/>
- Tailwind CSS 文档：<https://tailwindcss.com/docs>
- shadcn/ui 文档：<https://ui.shadcn.com/>
- Vitest 文档：<https://vitest.dev/>
- miniflare 文档：<https://miniflare.dev/>
- VSCode Authentication API：<https://code.visualstudio.com/api/references/vscode-api>
- VSCode Remote / Webview / URI Handler 指南：<https://code.visualstudio.com/api/advanced-topics/remote-extensions>
- GitHub OAuth Apps 创建文档：<https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app>
- GitHub OAuth Apps 授权文档：<https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps>
- GitHub OAuth App 转移所有权文档：<https://docs.github.com/en/apps/oauth-apps/maintaining-oauth-apps/transferring-ownership-of-an-oauth-app>
