# 模板市场 Phase 3 社区互动与统计

本 `ExecPlan` 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘` 这几个章节。

本文位于 `docs/exec-plans/active/template-marketplace-phase3.md`，必须按 `docs/PLANS.md` 的要求持续维护。本文面向一个不熟悉本仓库的新协作者：只靠当前工作树和本计划，应能继续完成模板市场 Phase 3 的实现、验证和文档同步。

## 目标与全局图景

这次变更把模板市场从“可浏览、安装、发布模板”推进到“能积累社区质量信号并反馈给贡献者”。完成后，登录用户可以在模板详情页点赞或取消点赞；市场列表可以继续按下载量、点赞数和综合热度排序；发布者可以在 `My Templates` 页面看到自己模板的下载、点赞和发布趋势。用户可观察到的结果是：点赞按钮会即时改变状态和数字，`/templates/me` 不再只是模板列表，而是带有统计总览和趋势的发布者 Dashboard。

Phase 3 不进入治理后台和版本回滚的 Phase 4 范围。举报、下架、用户封禁、已安装更新徽章、手动回滚和 listing revision 迁移应由后续 Phase 4 ExecPlan 继续推进。

## 进度

- [x] (2026-06-01 10:20 +0800) 读取 `docs/WORKFLOW.md`、`docs/PLANS.md`、模板市场产品规格、设计文档和既有模板市场 active ExecPlans，确认 Phase 3 需要 ExecPlan 跟踪并从 `feature/templates-marketplace` 切出主题分支。
- [x] (2026-06-01 10:23 +0800) 从 `origin/feature/templates-marketplace` 创建 `feat-template-marketplace-phase3`，保留用户已有未跟踪截图、草稿和 package fixture，不删除也不覆盖。
- [x] (2026-06-01 10:35 +0800) 梳理现有共享类型、D1 schema、Worker API、Web API client、详情页和 My Templates 页面；确认 D1 已有 `template_likes` 与 `template_daily_stats` 表，但缺少点赞写接口、用户 likes 查询和发布者统计 API。
- [x] (2026-06-01 10:55 +0800) 实现 Phase 3 API：新增共享响应类型、D1 repository 点赞/取消点赞、我的点赞模板、发布者统计聚合，以及 Worker `POST /api/v1/templates/:id/like`、`GET /api/v1/me/likes`、`GET /api/v1/me/stats`。
- [x] (2026-06-01 11:10 +0800) 实现 Web UI：浏览器详情页增加登录态点赞按钮和数字回显，`My Templates` 页面增加统计总览、近日日趋势和 Top templates 区块。
- [x] (2026-06-01 11:20 +0800) 补充 API/Web 自动化测试，覆盖 like/unlike、me/likes、me/stats 和 Web API client helper；已运行 `npm run test:marketplace-api`、`npm run test:marketplace-web` 与 template-marketplace workspace typecheck。
- [x] (2026-06-01 11:30 +0800) 同步产品规格、设计文档、设计索引和产品规格索引，记录 Phase 3 当前已本地验证，真实 preview OAuth smoke 仍后续执行。
- [x] (2026-06-01 11:45 +0800) 运行最终验证命令并记录证据：`npm run test:marketplace-shared`、`npm run test:marketplace-api`、`npm run test:marketplace-web`、`npm run typecheck:marketplace`、`git diff --check` 均通过。
- [x] (2026-06-01 22:45 +0800) 首次尝试更新 workers.dev 调试环境；本地 marketplace build 已通过，但当时 `wrangler deploy` 被 Cloudflare 认证错误 `Authentication error [code: 10000]` 阻断。
- [x] (2026-06-04 19:35 +0800) 重新更新 workers.dev 调试环境成功；当前 URL 为 `https://dscanvas-template-marketplace.wzy0304.workers.dev`，Wrangler 当前版本 ID 为 `550b893a-3097-4d84-b848-152761ba84a3`。
- [x] (2026-06-06 23:08 +0800) 处理 PR review blocker：详情页改用单模板点赞状态接口，避免用户点赞超过 50 个模板后被 `/me/likes` 首页截断误判；发布者 Dashboard 的 per-template publishCount 改为从 `template_versions` 真实聚合，避免只映射 latest version 导致恒为 1。

## 意外与发现

- 观察：Phase 3 的数据库基础表已经在首版 migration 中存在。
  证据：`apps/template-marketplace/migrations/0001_marketplace_core.sql` 已包含 `template_likes`、`template_collections` 和 `template_daily_stats`；`packages/marketplace-shared/src/schema.ts` 也已导出对应 Drizzle schema。

- 观察：下载计数和综合热度排序已经有基础实现，但点赞写入尚未接入。
  证据：`apps/template-marketplace/src/worker/repository.ts` 已有 `recordDownload()` 写 `templates.download_count` 和 `template_daily_stats.download_count`；`packages/marketplace-shared/src/index.ts` 已有 `calculateHotScore()` 和 `sort === 'likes'` / `sort === 'hot'` 排序。

- 观察：`/templates/me` 当前只展示发布者模板列表，不满足 Phase 3 的 Dashboard 验收。
  证据：`apps/template-marketplace/src/web/components/TemplateMyTemplatesView.tsx` 调用 `loadMyMarketplaceTemplates()` 后只显示卡片网格，没有趋势或总览数据。

- 观察：当前本机 Wrangler OAuth 凭据不能部署 workers.dev 调试环境。
  证据：`npm run -w @dev-session-canvas/template-marketplace deploy:preview` 已完成 `vite build`，但 Cloudflare API `/accounts/dcc75df8bad4f7ffa4227b682362df48/workers/services/dscanvas-template-marketplace` 返回 `Authentication error [code: 10000]`；即使显式设置 `CLOUDFLARE_ACCOUNT_ID=dcc75df8bad4f7ffa4227b682362df48` 仍失败。

- 观察：2026-06-04 重新部署已不再被 Cloudflare 认证阻断。
  证据：`npm run -w @dev-session-canvas/template-marketplace deploy:preview` 成功上传 Worker 与静态资源，输出当前版本 ID `550b893a-3097-4d84-b848-152761ba84a3` 和 workers.dev URL。

- 观察：本机对 workers.dev URL 的直接 HTTP smoke 当前不可用，但 Cloudflare API 侧 D1 预览库验证可用。
  证据：`npm run -w @dev-session-canvas/template-marketplace db:verify:preview` 成功返回 7 条模板版本记录；`curl -I --max-time 20 https://dscanvas-template-marketplace.wzy0304.workers.dev/templates` 和带 `--noproxy '*'` 的重试都在本机连接阶段超时。

- 观察：详情页不能用 `GET /api/v1/me/likes` 的第一页判断当前模板点赞状态。
  证据：`listLikedTemplates()` 固定 `pageSize: 50`，用户点赞超过 50 个模板后，第一页之外的已点赞模板会显示为未点赞；已改为 `GET /api/v1/templates/:id/like` 查询单模板状态。

- 观察：发布者 Dashboard 的 per-template publishCount 不能使用 `template.versions.length`。
  证据：`templateSelectSql` 的列表映射只包含 latest version，导致每个模板的 per-template publishCount 恒为 1；已改为按发布者从 `template_versions` 聚合每个模板的 published version 数。

## 决策记录

- 决策：Phase 3 本轮先实现“点赞/取消点赞”和“发布者统计 Dashboard”，暂不实现独立收藏 UI。
  理由：产品规格的 3.3 标题写“点赞与收藏”，但 Phase 3 验收项明确是“登录用户可点赞/取消点赞”，现有市场卡片和排序也以 likes 作为社会化信号。`template_collections` 表保留给后续收藏/书签体验，避免在本轮引入两个相似动作造成 UI 和指标解释混乱。
  日期/作者：2026-06-01 / Codex

- 决策：`POST /api/v1/templates/:id/like` 使用可重复的目标状态语义，request body 可选 `{ "liked": true | false }`；没有 body 时执行 toggle。
  理由：详情页按钮适合直接发目标状态，避免网络重试导致重复 toggle；同时保留无 body toggle，兼容命令行或简单客户端的“点一下切换”心智。无论哪种方式，响应都返回最终 `liked` 和 `likeCount`。
  日期/作者：2026-06-01 / Codex

- 决策：发布者 Dashboard 使用 `GET /api/v1/me/stats` 返回当前用户发布模板的 totals、按日聚合和 per-template 指标。
  理由：现有 `template_daily_stats` 已按天保存下载、点赞和发布计数，按发布者聚合能满足 Phase 3 趋势图，不需要引入原始事件表或异步分析系统。下载去重、防刷和更复杂统计属于后续治理增强。
  日期/作者：2026-06-01 / Codex

## 结果与复盘

当前已完成 Phase 3 的本地代码闭环并已更新 workers.dev 调试环境：共享 API contract、repository 方法、Worker 路由、Web API client、详情页点赞控件、My Templates Dashboard 和对应测试均已落地。实现复用既有 `template_likes` 和 `template_daily_stats` 表，不需要新增 migration。真实 preview OAuth 登录后的点赞与 Dashboard smoke 尚未执行，因此产品规格将 Phase 3 标记为本地实现完成，但仍保留发布前真实环境验证要求。

## 上下文与定向

模板市场代码分成四层。`packages/marketplace-shared/src/index.ts` 是浏览器、Worker 和测试共享的类型、schema、种子数据和排序逻辑；这里应新增 Phase 3 response 类型，不能依赖 VSCode、React 或 Cloudflare runtime。`apps/template-marketplace/src/worker/app.ts` 是 Hono Worker 路由；这里接收 HTTP 请求、校验登录、调用 repository 并返回 JSON。`apps/template-marketplace/src/worker/repository.ts` 是 D1/seed 数据访问边界；所有 SQL 都应集中在这里，不要散落到路由中。`apps/template-marketplace/src/web/` 是浏览器市场 React UI；详情页在 `components/TemplateDetailView.tsx`，发布者页面在 `components/TemplateMyTemplatesView.tsx`，API client 在 `lib/api.ts`。

“点赞”是登录用户对一个模板的一次正向信号。D1 表 `template_likes` 使用 `(template_id, user_id)` 唯一约束保证每个用户对每个模板最多点赞一次，`templates.like_count` 是列表和详情快速展示的累计数，`template_daily_stats.like_count` 是发布者 Dashboard 的每日趋势。实现必须同时维护关系表、累计数和日聚合，避免列表数字、个人点赞状态和 Dashboard 趋势互相漂移。

“发布者统计”只统计当前登录 GitHub 用户发布的模板。它读取 `templates.publisher_id` 与当前用户 id 的匹配结果，再聚合 `template_daily_stats`。这不是管理员全站统计，也不包含未发布或下架模板的治理视角。

## 工作计划

第一步在共享包中新增 Phase 3 contract。`packages/marketplace-shared/src/index.ts` 需要定义点赞响应、我的点赞列表响应、统计点、统计总览和发布者统计响应。统计响应中的模板使用现有 `MarketplaceTemplateSummary`，趋势点使用 `day`、`downloadCount`、`likeCount` 和 `publishCount`。

第二步扩展 repository。`MarketplaceTemplateRepository` 增加 `setTemplateLike()`、`listLikedTemplates()` 和 `getPublisherStats()`。`D1TemplateRepository.setTemplateLike()` 先解析公开模板，再 upsert 当前用户；当目标状态为 liked 时插入 `template_likes`、增加 `templates.like_count`、增加当日 `template_daily_stats.like_count`；当目标状态为 unliked 时删除关系并减少累计 like count，但不回滚历史日聚合。`listLikedTemplates()` 返回当前用户点赞过且仍 published 的模板。`getPublisherStats()` 返回当前用户 published 模板的总下载、总点赞、发布数、日趋势和每模板指标。

第三步扩展 Worker API。`POST /api/v1/templates/:id/like` 需要认证，没有 D1 时返回 503；body 可选，若包含 `liked` 必须是 boolean。`GET /api/v1/me/likes` 和 `GET /api/v1/me/stats` 需要认证，读取 repository 并返回 JSON。写接口不套用 public read CORS。

第四步扩展浏览器 UI。`lib/api.ts` 增加 `loadMyMarketplaceStats()`、`loadMyMarketplaceLikes()`、`loadMarketplaceTemplateLikeState()` 和 `setMarketplaceTemplateLike()`。详情页加载当前用户和当前模板的单模板 like state，若已登录则显示可点击 Like / Liked 按钮，未登录则显示 Sign in to like。点击后发目标状态并更新本地数字。`TemplateMyTemplatesView` 并行加载 `me/templates` 和 `me/stats`，展示总下载、总点赞、发布模板数、近日日趋势和每模板表现。

第五步补测试和文档。Worker API 测试覆盖认证失败、like/unlike SQL、`me/likes`、`me/stats`。Web API client 测试覆盖新增端点。若 Phase 3 验收项完成，同步 `docs/product-specs/template-marketplace.md` 的 Phase 3 当前状态和本 ExecPlan 的结果。

## 具体步骤

所有命令都在仓库根目录执行。

先确认分支和工作树：

    git status --short --branch

预期分支为 `feat-template-marketplace-phase3`。当前工作树存在用户未跟踪文件，包括 `image copy*.png`、`tmp.md` 和若干 package fixture；本计划不删除这些文件。

实现过程中优先运行小范围测试：

    npm run test:marketplace-shared
    npm run test:marketplace-api
    npm run test:marketplace-web
    npm run typecheck:marketplace

完成 UI 和文档后补跑：

    npm run test:marketplace
    git diff --check

如果 `npm run test:marketplace` 因 VSCode fixture 环境耗时或外部运行条件失败，至少要记录已通过的 API/Web/typecheck 命令和失败原因；不能把未执行或失败的 smoke 写成通过。

## 验证与验收

Phase 3 完成时应满足以下可观察行为。未登录用户打开模板详情页能看到登录后点赞的提示；登录用户打开模板详情页能看到当前点赞状态，点击后按钮文案和 like 数字更新，再点一次可以取消。调用 `GET /api/v1/templates/:id/like` 会返回当前登录用户对单个模板的 `liked` 和 `likeCount`，不受 `/me/likes` 列表分页影响。调用 `POST /api/v1/templates/:id/like` 会返回最终 `liked` 和 `likeCount`，并且 D1 写入 `template_likes`、`templates.like_count` 与当日 `template_daily_stats.like_count`。调用 `GET /api/v1/me/likes` 会返回当前用户点赞过的模板列表。调用 `GET /api/v1/me/stats` 会返回当前发布者的 totals、daily trend 和 per-template stats，其中每个模板的 publishCount 来自 published version 数。打开 `/templates/me` 时，登录发布者能看到统计总览、趋势和模板卡片。

自动化验收至少包括 `npm run test:marketplace-api`、`npm run test:marketplace-web`、`npm run typecheck:marketplace` 和 `git diff --check` 通过。若共享类型或排序逻辑变化，还必须运行 `npm run test:marketplace-shared`。

## 幂等性与恢复

本轮不需要数据库 migration，因为 Phase 3 使用的 `template_likes` 和 `template_daily_stats` 已存在。点赞接口必须可重复调用：连续发送 `{ "liked": true }` 不应重复增加 like count，连续发送 `{ "liked": false }` 不应把累计数减到 0 以下。若 R2 或 D1 不可用，写接口返回结构化错误，不应让前端假装成功。

如果实现中发现需要新增表或改变字段，不要直接修改生产迁移；先更新本 ExecPlan 的决策记录，再新增向前兼容 migration 和测试。不要删除用户未跟踪截图或草稿文件；如果它们影响命令输出，只在最终说明中指出。

## 证据与备注

当前证据：

    git switch -c feat-template-marketplace-phase3 origin/feature/templates-marketplace
    # Switched to a new branch 'feat-template-marketplace-phase3'

    rg "template_likes|template_daily_stats" apps/template-marketplace/migrations/0001_marketplace_core.sql packages/marketplace-shared/src/schema.ts
    # 两个文件均包含 Phase 3 所需表结构。

    npm run test:marketplace-api
    # Test Files 5 passed (5); Tests 73 passed (73)

    npm run test:marketplace-web
    # Test Files 6 passed (6); Tests 33 passed (33)

    npm run -w @dev-session-canvas/template-marketplace typecheck
    # tsc -p tsconfig.web.json --noEmit && tsc -p tsconfig.worker.json --noEmit 通过

    npm run test:marketplace-shared && npm run test:marketplace-api && npm run test:marketplace-web && npm run typecheck:marketplace && git diff --check
    # shared: 23 passed; api: 73 passed; web: 33 passed; marketplace typecheck passed; git diff --check passed

    npm run build:marketplace && git diff --check
    # Vite production build completed; git diff --check passed

    npm run -w @dev-session-canvas/template-marketplace deploy:preview
    # build passed, wrangler deploy failed: Authentication error [code: 10000]

    CLOUDFLARE_ACCOUNT_ID=dcc75df8bad4f7ffa4227b682362df48 npm run -w @dev-session-canvas/template-marketplace deploy:preview
    # build passed, wrangler deploy still failed with Authentication error [code: 10000]

    npm run -w @dev-session-canvas/template-marketplace deploy:preview
    # build passed; uploaded dscanvas-template-marketplace; URL: https://dscanvas-template-marketplace.wzy0304.workers.dev; Current Version ID: 550b893a-3097-4d84-b848-152761ba84a3

    npm run -w @dev-session-canvas/template-marketplace db:verify:preview
    # remote D1 template_marketplace_preview verification passed and returned 7 template version rows

    curl -I --max-time 20 https://dscanvas-template-marketplace.wzy0304.workers.dev/templates
    curl --noproxy '*' --connect-timeout 5 --max-time 20 -I https://dscanvas-template-marketplace.wzy0304.workers.dev/templates
    # both HTTP smoke attempts timed out from this machine before receiving response; not recorded as application failure

    npm run test:marketplace-api
    # Test Files 5 passed (5); Tests 75 passed (75)

    npm run test:marketplace-web && npm run typecheck:marketplace && git diff --check
    # web: 34 passed; marketplace typecheck passed; git diff --check passed

## 接口与依赖

必须在 `packages/marketplace-shared/src/index.ts` 中导出以下类型：`MarketplaceTemplateLikeResponse`、`MarketplacePublisherStatsPoint`、`MarketplacePublisherStatsTemplate`、`MarketplacePublisherStatsResponse`。命名可以在实现时小幅调整，但语义必须覆盖最终点赞状态、like 数、发布者 totals、每日趋势和 per-template 指标。

必须在 `apps/template-marketplace/src/worker/repository.ts` 的 `MarketplaceTemplateRepository` 接口上增加 Phase 3 方法，并由 `D1TemplateRepository` 实现。`SeedTemplateRepository` 可以返回空列表或抛出写入不可用错误，但不能把 seed 数据误写成真实持久化结果。

必须在 `apps/template-marketplace/src/worker/app.ts` 暴露 `GET /api/v1/templates/:id/like`、`POST /api/v1/templates/:id/like`、`GET /api/v1/me/likes` 和 `GET /api/v1/me/stats`。这些端点都需要认证；点赞写接口需要 D1，不能使用 public read CORS。

必须在 `apps/template-marketplace/src/web/lib/api.ts` 增加对应 client helper，并在 `TemplateDetailView.tsx` 和 `TemplateMyTemplatesView.tsx` 中使用。UI 需要保持现有 Marketplace browser 风格，不引入新的全局设计语言。

2026-06-01 / Codex：创建 Phase 3 ExecPlan，原因是用户要求按 AGENTS.md 开展 Phase 3，且该任务涉及多模块实现、设计决策和可追踪验收。


2026-06-01 / Codex：更新 Phase 3 ExecPlan，原因是点赞 API、发布者统计 Dashboard、测试和文档同步已完成，需要把计划从准备状态推进到实现完成状态，并保留最终验证待办。

2026-06-01 / Codex：补充最终验证结果，原因是 Phase 3 小范围测试、marketplace typecheck 和 diff whitespace 检查均已通过。
2026-06-01 / Codex：补充 build 验证结果，原因是 Phase 3 触及浏览器 UI，除 test/typecheck 外还需要确认 marketplace production bundle 可构建。
2026-06-01 / Codex：补充调试环境部署尝试结果，原因是用户要求更新调试环境，但当前 Wrangler 登录态或 token 权限已失效，部署被 Cloudflare 认证阻断。
2026-06-04 / Codex：补充调试环境更新结果，原因是用户已更新 Cloudflare 认证配置后重新部署成功，同时记录本机 workers.dev HTTP smoke 因连接超时未完成。
2026-06-06 / Codex：补充 PR review blocker 修复结果，原因是详情页点赞状态和 per-template publishCount 需要避免分页截断与 latest-only 映射造成确定性漂移。
