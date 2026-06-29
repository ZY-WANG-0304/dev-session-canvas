# 模板市场 Phase 4 版本管理与治理

本 `ExecPlan` 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘` 这几个章节。

本文位于 `docs/exec-plans/active/template-marketplace-phase4-governance.md`，必须按 `docs/PLANS.md` 的要求持续维护。本文面向一个不熟悉本仓库的新协作者：只靠当前工作树和本计划，应能继续完成模板市场 Phase 4 的治理、版本管理、验证和文档同步。

## 目标与全局图景

这次变更把模板市场从“能发布、安装、点赞和看统计”推进到“能持续运营”。完成后，普通登录用户可以举报模板；管理员可以查看举报队列、处理举报、下架或恢复模板、封禁或解封用户，并且这些管理动作会写入审计日志。发布者的新版本能力已有后端基础，Phase 4 还要把已安装模板更新提醒、手动更新和回滚继续接入 VSCode 安装侧。用户可观察到的结果是：违规模板能被举报并进入后台，管理员处理后模板会从公开列表消失或恢复，被封禁用户不能继续发布、点赞或举报。

Phase 4 不进入付费模板、评论区、私有市场、推荐算法或外部 AI 审核。内容安全仍按现有设计采用确定性上传检查加事后举报治理；如果后续需要第三方审核、通知系统或复杂风控，应新增设计补充，而不是在本计划中临时引入。

## 进度

- [x] (2026-06-07 00:15 +0800) 用户确认 PR #115 已合并且调试环境已验证；从最新 `origin/feature/templates-marketplace` 切出 `feat-template-marketplace-phase4-governance`。
- [x] (2026-06-07 00:20 +0800) 读取 `docs/WORKFLOW.md`、`docs/PLANS.md`、模板市场产品规格、模板市场设计文档、`ARCHITECTURE.md`、`docs/SECURITY.md`、`docs/QUALITY_SCORE.md` 和 `docs/RELIABILITY.md`，确认 Phase 4 需要 ExecPlan 跟踪。
- [x] (2026-06-07 00:25 +0800) 将 Phase 3 ExecPlan 移入 `docs/exec-plans/completed/template-marketplace-phase3.md`，作为上下文 compact 的仓库内收口记录。
- [x] (2026-06-07 01:10 +0800) 实现治理后端最小闭环：用户举报、管理员举报队列、举报处理、模板下架/恢复、用户封禁/解封、封禁用户写接口拒绝和审计日志。
- [x] (2026-06-07 01:35 +0800) 实现 Web 治理最小入口：详情页举报表单、`/templates/admin` 路由、举报队列、处理按钮、模板状态操作和发布者封禁操作。
- [x] (2026-06-07 01:37 +0800) 同步产品规格、设计文档、索引和本计划，记录 Phase 4 第一切片的本地实现范围与剩余缺口。
- [x] (2026-06-07 01:40 +0800) 更新 workers.dev 调试服务成功，当前 URL 为 `https://dscanvas-template-marketplace.wzy0304.workers.dev`，Wrangler 当前版本 ID 为 `822333bb-8c0e-43c2-a180-e72593cc4fd0`。
- [x] (2026-06-07 11:05 +0800) 修复详情页举报原因下拉切换时 React 合成事件被异步 updater 读取导致的空白页，并重新部署 workers.dev，Wrangler 当前版本 ID 为 `62cfd459-054b-478c-9d81-beacf5c04a94`。
- [x] (2026-06-07 19:29 +0800) 从最新 `origin/feature/templates-marketplace` 切出 `feat-template-marketplace-phase4-admin-stats`，实现管理员全站统计面板的共享类型、Worker API、D1 聚合查询、Fake D1、Web API helper、`/templates/admin` 统计区和本地单元测试。
- [x] (2026-06-25 12:00 +0800) 实现 VSCode 安装侧 Phase 4：已安装市场模板侧栏更新徽章、手动更新到 latest、版本菜单历史版本安装/回滚，并用本地 fixture VSCode E2E 验证 sidecar 版本变化。
- [x] (2026-06-25 12:00 +0800) 实现插件内举报入口：插件详情页和模板侧栏只提供跳转 Web 详情页 `#report` 的按钮，不在插件内重复实现举报表单。
- [x] (2026-06-26 11:35 +0800) 实现发布者新版本完整用户入口：Web 作者详情/个人模板页进入 `/templates/publish/version?template=<slug>`；VSCode 详情页进入发布表单 version mode 并提交 `POST /api/v1/templates/:id/versions`。
- [ ] 执行真实 GitHub OAuth smoke：普通用户举报、管理员处理、下架后公开隐藏、封禁后写接口拒绝。

## 意外与发现

- 观察：Phase 4 的部分版本发布后端能力已在 Phase 2/3 前置实现。
  证据：`apps/template-marketplace/src/worker/app.ts` 已有 `POST /api/v1/templates/:id/versions`；`repository.ts` 已有 `publishTemplateVersion()`；测试覆盖作者发布新版本和非作者拒绝。

- 观察：治理数据表已经存在，不需要为最小治理闭环新增 D1 migration。
  证据：`apps/template-marketplace/migrations/0001_marketplace_core.sql` 已包含 `reports`、`admin_roles`、`admin_audit_logs`，`users` 已有 `banned_at`，`templates.status` 已支持 `published` / `delisted`。

- 观察：现有写接口尚未统一检查 `users.banned_at`。
  证据：`POST /api/v1/templates`、`POST /api/v1/templates/:id/versions` 和 `POST /api/v1/templates/:id/like` 当前只检查登录、作者或 D1/R2 binding，没有检查封禁状态；Phase 4 需要补上。

- 观察：Phase 4 第一切片可以不修改历史 migration。
  证据：新增代码只使用既有 `reports`、`admin_roles`、`admin_audit_logs`、`users.banned_at` 和 `templates.status` 字段；`npm run test:marketplace-api`、`npm run test:marketplace-shared`、`npm run test:marketplace-web` 与 `npm run typecheck:marketplace` 已在本地通过。

- 观察：React 18 生产构建下不能在函数式 `setState` updater 内读取 `event.currentTarget.value`。
  证据：调试环境详情页切换举报原因时浏览器报 `Cannot read properties of null (reading 'value')` 并空白；修复为在进入 updater 前同步保存 `const reason = event.currentTarget.value` 后，本地 `npm run test:marketplace-web`、`npm run typecheck:marketplace` 和重新部署均通过。
- 观察：`POST /api/v1/templates/package` 需要在读取 multipart zip 前完成封禁检查。
  证据：PR review 指出旧顺序会让 banned user 触发大包读取/解析；本轮把 repository 初始化和 `isUserBanned()` 前移到 `readPackageZipUpload()` 之前，并补充 banned package publisher 测试，断言 403 返回时不会调用 `request.formData()`。

- 观察：管理员全站统计中的单模板发布次数不能复用 `templateSelectSql` 映射出的 `template.versions.length`。
  证据：`templateSelectSql` 只选择当前可公开的 latest published version；本轮为全站统计新增 `fetchAllPublishedVersionCounts()`，直接从 `template_versions` 按 `template_id` 聚合 `COUNT(*)`，并用测试断言 `d1-review-loop` 的 `publishCount` 为 2。

- 观察：VSCode 插件市场详情页已有 split button 和版本列表基础，但旧实现只把所有非当前安装版本标为“安装/更新”，不能让用户明确区分回滚。
  证据：本轮把历史低版本目标标记为“回滚到 vN”，并在 `tests/vscode-smoke/template-marketplace-tests.cjs` 中先安装 v1、更新到 v2、再回滚到 v1 验证 `.market.json` 的 `marketVersionId` 与 `installedVersionNumber`。

- 观察：侧栏更新提醒需要访问远端详情接口，但不能让离线或网络慢阻塞本地模板使用。
  证据：`TemplateMarketplaceClient.listInstalledTemplateUpdateStatuses()` 对每个已安装市场模板做 best-effort 详情读取，更新检查使用短超时并把失败收敛为 `updateCheckError`；侧栏仍渲染本地模板列表。

- 观察：发布新版本成功后需要使 VSCode Webview 内详情缓存失效，否则版本菜单可能继续展示发布前的旧版本列表。
  证据：本轮在 `marketplace/templatePublishResult` 成功分支删除对应 slug 的 `templateDetailsBySlug`、详情错误和版本菜单错误缓存，并在 fixture E2E 中发布 v3 后重新打开详情和版本菜单，断言出现 `更新到 v3`。

## 决策记录

- 决策：Phase 4 第一切片先交付治理后端闭环，再做 Web 管理后台和 VSCode 更新/回滚 UI。
  理由：举报、下架、封禁和审计是治理后台和安全边界的基础；先用 API 和测试固定权限与数据语义，能避免前端按钮成为权限边界。VSCode 更新/回滚依赖安装 sidecar 和模板版本 API，可以作为后续独立里程碑验证。
  日期/作者：2026-06-07 / Codex

- 决策：管理员身份由 `admin_roles` 强制判断，`MARKETPLACE_ADMIN_GITHUB_IDS` 作为推荐 bootstrap，`MARKETPLACE_ADMIN_GITHUB_LOGINS` 只作为本地开发和临时配置的兼容 bootstrap；已落库的管理员权限不应每次动态依赖 allowlist。
  理由：正式权限边界必须落在 D1 的稳定 user id 上，不能只靠前端隐藏入口或每次用 GitHub login 字符串临时判断。GitHub login 可被改名或释放复用，数字 user id 更适合作为生产 bootstrap 输入；保留 login 环境变量能降低本地调试成本。
  日期/作者：2026-06-07 / Codex

- 决策：第一切片不新增 D1 migration，也不删除 R2 对象或模板版本。
  理由：首版 schema 已经预留治理表和状态字段；下架只需要把 `templates.status` 设为 `delisted`，恢复设回 `published`，封禁只写 `users.banned_at`。保持对象和版本不可变能让审计、恢复与回滚继续成立。
  日期/作者：2026-06-07 / Codex

- 决策：浏览器最小治理后台允许管理员封禁模板发布者，不提供“一键封禁举报人”作为主动作。
  理由：举报队列的常见治理对象是被举报模板和发布者；误把举报人作为默认封禁对象会鼓励错误操作。若后续需要处理恶意举报，应在管理员用户管理或举报滥用专题中补单独入口和证据展示。
  日期/作者：2026-06-07 / Codex

- 决策：管理员全站统计面板只读取 D1 的累计字段、按天聚合表和治理状态表，不新增原始事件表。
  理由：Phase 4 的目标是让管理员看到市场健康度、举报压力和治理动作数量；当前 `templates.download_count` / `like_count`、`template_daily_stats`、`template_versions`、`reports`、`users` 和 `admin_audit_logs` 已能支撑该面板。把 D1 扩展成原始事件仓库会增加写入压力和运维复杂度，超出本阶段边界。
  日期/作者：2026-06-07 / Codex

- 决策：插件内举报入口只跳转到 Web 详情页 `#report`，不在 VSCode Webview 或侧栏内复制举报表单。
  理由：Worker API 和 Web 详情页已经承载登录态、原因选择和提交反馈；插件侧复用浏览器登录和治理表单可以减少认证状态分叉，同时满足“插件内有举报入口”的用户需求。
  日期/作者：2026-06-25 / Codex

- 决策：侧栏更新提醒采用 best-effort 检查，失败不打断模板侧栏本地使用。
  理由：模板应用的本地事实是完整包目录和 `.market.json` sidecar；远端详情只用于提醒和手动更新，不应让离线用户失去已安装模板。
  日期/作者：2026-06-25 / Codex

- 决策：发布者新版本入口复用现有 `POST /api/v1/templates/:id/versions`，Web 新增 `/templates/publish/version?template=<slug>`，VSCode 复用发布表单并切换为 version mode。
  理由：版本发布的权限边界应继续由 Worker 作者校验强制执行；Web 可先做当前登录用户与发布者 id 的前端提示，VSCode 只做同名本地模板 guard 来降低误发风险。首版 version mode 只提交模板 JSON、CHANGELOG 和缩略图，名称、Slug、README、描述与标签沿用当前市场模板；listing revision / 仅展示信息编辑不在本切片实现。
  日期/作者：2026-06-26 / Codex

## 结果与复盘

Phase 4 已完成第一切片的本地代码闭环：共享类型、D1 repository、Worker 路由、Fake D1、API/Web 测试、详情页举报表单和 `/templates/admin` 最小后台已落地。第一切片证明治理权限和审计可以由 Worker 强制执行，而不是靠前端隐藏按钮。管理员全站统计面板也已在本地补齐，管理员打开 `/templates/admin` 时可看到模板、下载、点赞、举报、用户、发布者、版本发布数、Top templates、近期日聚合和审计日志计数。2026-06-25 又补齐 VSCode 安装侧更新提醒、手动更新、历史版本回滚和插件内举报跳转入口，并用本地 fixture VSCode E2E 验证。2026-06-26 补齐发布者新版本用户入口：Web 作者详情页和 My Templates 可进入新版本发布页，VSCode 详情页可进入 version mode 发布表单并发布 v3。剩余缺口是真实 preview OAuth smoke。

## 上下文与定向

模板市场代码分成四层。`packages/marketplace-shared/src/index.ts` 是浏览器、Worker、VSCode 宿主和测试共享的类型、常量、Zod schema 和 seed 数据；新增治理 response 类型、举报原因常量和 admin request 类型要放在这里。`apps/template-marketplace/src/worker/app.ts` 是 Hono Worker 路由，负责认证、解析请求、权限判断和 JSON 响应。`apps/template-marketplace/src/worker/repository.ts` 是 D1 数据访问边界，所有 SQL 查询和写入都应集中在这里。`apps/template-marketplace/src/web/` 是浏览器市场 React UI；现有 `App.tsx` 已有 Templates、Publish、My Templates 和 Admin 导航。VSCode 安装路径在 `src/panel/TemplateMarketplaceClient.ts`、`src/panel/CanvasTemplateStore.ts` 和 `src/panel/CanvasTemplateMarketplacePanel.ts`，它们负责远端 API 读取、安装目标选择、版本菜单和 sidecar 写入。

“治理”在本计划中指三件事。第一，普通登录用户提交举报，举报写入 `reports` 表，状态初始为 `open`。第二，管理员读取和处理举报；处理可以驳回举报，也可以解决举报并下架模板。第三，管理员可以直接恢复模板或封禁用户；所有管理员动作写入 `admin_audit_logs`，这样未来能追溯谁在什么时候改了什么。

“下架”指把 `templates.status` 改为 `delisted`。公开列表、详情和下载只读取 `published` 模板，因此下架后普通用户看不到该模板；R2 对象和版本历史不删除，管理员恢复时只把状态改回 `published`。“封禁”指写入 `users.banned_at`；被封禁用户不能发布模板、发布新版本、点赞或举报，但已上架模板是否下架由管理员单独决定。

## 工作计划

第一里程碑是治理后端，已完成。共享包新增 `MarketplaceReportReason`、`MarketplaceReportStatus`、`MarketplaceTemplateReportRequest`、`MarketplaceTemplateReportResponse`、`MarketplaceAdminReportsResponse`、`MarketplaceAdminReportActionRequest`、`MarketplaceAdminTemplateStatusRequest` 和 `MarketplaceAdminUserBanRequest` 等类型。Repository 增加 `createTemplateReport()`、`listAdminReports()`、`resolveAdminReport()`、`setAdminTemplateStatus()`、`setAdminUserBan()`、`isAdminUser()` 和 `isUserBanned()`。Worker 暴露 `POST /api/v1/templates/:id/report`、`GET /api/v1/admin/reports`、`PATCH /api/v1/admin/reports/:id`、`PATCH /api/v1/admin/templates/:id` 和 `PATCH /api/v1/admin/users/:id`。这些端点都需要 D1；管理员端点必须先认证，再用 `MARKETPLACE_ADMIN_GITHUB_IDS` / `MARKETPLACE_ADMIN_GITHUB_LOGINS` bootstrap，最后检查 `admin_roles`。allowlist 只负责 bootstrap，不能替代 D1 管理员角色。

第二里程碑是浏览器 UI，已完成最小切片。`apps/template-marketplace/src/web/lib/api.ts` 增加举报和管理员 API helper；`TemplateDetailView.tsx` 增加登录后举报入口；新增 `TemplateAdminView.tsx` 展示举报队列、处理举报、下架/恢复模板和封禁发布者。`App.tsx` 增加 `/templates/admin` 路由和 Admin 导航入口。前端只负责发请求和显示结果，不作为权限边界；非管理员访问由 Worker 返回 403。

第三里程碑是管理员全站统计面板，已完成本地实现。共享包在 `packages/marketplace-shared/src/index.ts` 导出 `MarketplaceAdminStatsResponse`、`MarketplaceAdminStatsTotals` 和 `MarketplaceAdminStatsTemplate`。Repository 增加 `getAdminStats()`：D1 实现读取 `templates` 累计计数、`users` 总量和封禁数、`reports` 状态分布、`admin_audit_logs` 计数、`template_versions` 发布版本数、`template_daily_stats` 日聚合和 Top templates；seed 实现使用内置 seed catalog 作为只读降级。Worker 暴露 `GET /api/v1/admin/stats`，复用 `requireMarketplaceAdmin()`。Web API helper 和 `TemplateAdminView.tsx` 在加载举报队列时并行加载统计，并展示全站指标、Top templates 和最近 5 天日聚合。

第四里程碑是 VSCode 更新与回滚，已完成本地实现。`src/panel/TemplateMarketplaceClient.ts` 负责读取已安装 sidecar、best-effort 检查远端 latest，并把已安装模板更新到 latest；`src/sidebar/CanvasSidebarTemplateView.ts` 在市场模板行显示 `可更新 vN` badge，并提供更新、打开市场详情/回滚和举报跳转动作；`src/panel/CanvasTemplateMarketplacePanel.ts` 的版本菜单把低于当前安装版本的目标标记为“回滚到 vN”。安装包仍以完整 `package.zip` 和 `.market.json` sidecar 为事实，不能把包内 `template.json` 当成市场管理对象。

发布者新版本入口也已完成本地实现。浏览器端 `apps/template-marketplace/src/web/lib/routing.ts` 新增 `/templates/publish/version?template=<slug>` helper，`TemplatePublishVersionView.tsx` 读取当前登录用户和目标模板、提示非作者权限，并提交更新说明、模板 JSON 和可选缩略图到 `publishMarketplaceTemplateVersion()`。My Templates 和作者本人打开模板详情时显示 `Publish new version` 入口。VSCode 端 `src/panel/CanvasTemplateMarketplacePanel.ts` 在详情 sidebar 显示 `发布新版本`，打开复用发布表单的 version mode；version mode 隐藏名称、Slug、描述、标签、README，仅允许选择同名本地模板、确认 CHANGELOG 与 Template JSON，提交给 `TemplateMarketplaceClient.publishTemplateDraftVersion()`。宿主会使用当前详情 `sourceUrl` 换取同 origin marketplace token，先读取目标详情并做同名 guard，再调用 `POST /api/v1/templates/:id/versions`。首版不实现 listing revision 或仅展示字段更新。

第五里程碑是文档和真实环境验证。同步产品规格 Phase 4 状态、设计文档 API 列表和验证状态、设计索引和产品索引。部署 preview 后做浏览器真实 OAuth smoke：普通用户举报，管理员查看队列和统计并下架，普通用户确认公开列表隐藏，被封禁用户写接口返回 403。

## 具体步骤

所有命令都在仓库根目录执行。

先确认分支和目标基线：

    git status --short --branch
    git log --oneline --decorate --max-count=8

预期短生命周期分支为 `feat-template-marketplace-phase4-admin-stats`，目标基线为 `origin/feature/templates-marketplace`。当前工作树存在用户未跟踪文件，包括 `image.png` 和若干 `apps/template-marketplace/fixtures/r2/**/package.zip` fixture；本计划不删除这些文件。

第一里程碑和第二里程碑实现后运行：

    npm run test:marketplace-shared
    npm run test:marketplace-api
    npm run test:marketplace-web
    npm run typecheck:marketplace
    git diff --check

第二里程碑增加 Web UI 后可补跑完整浏览器构建：

    npm run build:marketplace

如果 preview 部署因 Cloudflare token 或本机网络失败，必须记录失败原因，不能把未执行的真实 smoke 写成通过。

VSCode 更新与回滚里程碑实现时应优先运行：

    npm run build
    npm run test:marketplace-vscode-fixture-e2e

## 验证与验收

治理后端完成时应满足以下行为。未登录用户调用 `POST /api/v1/templates/:id/report` 返回 401；登录用户举报公开模板返回 201 和 `open` report；被封禁用户举报、点赞、发布和发布新版本返回 403。非管理员调用 `GET /api/v1/admin/reports` 返回 403；管理员调用同一接口能看到 open 举报。管理员处理举报为 resolved 且要求下架模板后，`templates.status` 变为 `delisted`，公开 `GET /api/v1/templates/:id` 返回 404；管理员恢复模板后公开详情恢复可见。管理员封禁用户后，该用户后续写接口被拒绝。每个管理员动作都写入 `admin_audit_logs`。

Web 管理后台完成时应满足：管理员打开 `/templates/admin` 能看到举报队列、模板、发布者和举报人摘要；点击驳回或解决后列表状态更新；点击下架/恢复模板后公开列表反映状态；点击封禁发布者后该发布者写接口被拒绝。非管理员打开页面应看到权限错误，不应出现可操作按钮。

管理员全站统计完成时应满足：管理员调用 `GET /api/v1/admin/stats` 返回模板总量、published/delisted 数量、用户与封禁数、发布者数、下载与点赞累计数、已发布版本总数、举报状态分布、管理员审计动作数、Top templates 和按天聚合趋势；非管理员沿用管理员权限检查返回 403。Web 管理后台加载举报队列时应同时显示这些统计，Top templates 中的单模板 `publishCount` 必须来自 `template_versions` 聚合而不是 latest version 映射长度。

VSCode 更新与回滚完成时应满足：安装旧版本市场模板后，如果远端 latest version 更高，侧栏显示更新徽章；点击更新安装 latest；通过版本菜单选择历史版本后，本地 sidecar 的 `marketVersionId` 和 `installedVersionNumber` 改为目标历史版本；应用模板仍读取包内 `template.json`，README、CHANGELOG 和缩略图继续保留。本轮已用本地 fixture VSCode E2E 覆盖这些行为，真实 preview smoke 仍作为发布前验证项。

## 幂等性与恢复

本轮不删除 R2 对象，不删除模板版本，不删除举报和审计日志。下架和恢复只改变 `templates.status`；封禁和解封只改变 `users.banned_at`。这些操作可以重复执行：重复下架仍保持 delisted，重复恢复仍保持 published，重复封禁更新 banned_at，重复解封清空 banned_at。若管理员处理举报时写模板状态成功但写审计失败，应让请求失败并在测试中暴露；不要静默吞掉审计失败。若需要新增 D1 migration，先更新本计划的决策记录，再新增向前兼容迁移，不直接修改已经用于 preview 的历史 migration。

## 证据与备注

当前证据：

    gh pr view 115 --json state,mergedAt,mergeCommit
    # state: MERGED; mergeCommit: adb66606995d3088629f1ef4faa8d2f59520f8d7

    git checkout -B feat-template-marketplace-phase4-governance origin/feature/templates-marketplace
    # Switched to a new branch 'feat-template-marketplace-phase4-governance'

    git checkout -B feat-template-marketplace-phase4-admin-stats origin/feature/templates-marketplace
    # 2026-06-07 19:29 +0800；从最新集成分支切出管理员全站统计子主题分支

    rg "reports|admin_roles|admin_audit_logs|banned_at|delisted" apps/template-marketplace/migrations/0001_marketplace_core.sql packages/marketplace-shared/src/schema.ts
    # 首版 schema 已包含 Phase 4 最小治理闭环所需字段和表。

    npm run test:marketplace-api
    # Test Files 5 passed; Tests 84 passed

    npm run test:marketplace-shared
    # Test Files 2 passed; Tests 23 passed

    npm run test:marketplace-web
    # Test Files 6 passed; Tests 39 passed

    npm run typecheck:marketplace
    # @dev-session-canvas/marketplace-shared typecheck passed; @dev-session-canvas/template-marketplace web and worker typecheck passed

    git diff --check
    # 通过，无 whitespace error

    npm run build:marketplace
    # vite build completed; dist/web assets emitted

    npm run -w @dev-session-canvas/template-marketplace deploy:preview
    # Uploaded dscanvas-template-marketplace; URL https://dscanvas-template-marketplace.wzy0304.workers.dev; Current Version ID 822333bb-8c0e-43c2-a180-e72593cc4fd0

    npm run -w @dev-session-canvas/template-marketplace deploy:preview
    # 2026-06-07 11:05 +0800 重新部署；Current Version ID 62cfd459-054b-478c-9d81-beacf5c04a94

    npm run -w @dev-session-canvas/template-marketplace deploy:preview
    # 2026-06-07 15:21 +0800 重新部署；URL https://dscanvas-template-marketplace.wzy0304.workers.dev；Current Version ID f499cc1f-716d-45a6-9cf8-aa78e9b0facd

    npm run test:marketplace-api
    # 2026-06-07 15:20 +0800；Test Files 5 passed; Tests 86 passed

    npm run test:marketplace-shared
    # 2026-06-07 15:19 +0800；Test Files 2 passed; Tests 23 passed

    npm run test:marketplace-web
    # 2026-06-07 15:19 +0800；Test Files 6 passed; Tests 39 passed

    npm run typecheck:marketplace
    # 2026-06-07 15:20 +0800；marketplace-shared 与 template-marketplace typecheck 通过

    npm run build:marketplace
    # 2026-06-07 15:19 +0800；Vite production build completed

    git diff --check
    # 2026-06-07 15:20 +0800；通过，无 whitespace error

    npm run test:marketplace-shared
    # 2026-06-07 19:32 +0800；Test Files 2 passed; Tests 23 passed

    npm run test:marketplace-api
    # 2026-06-07 19:34 +0800；Test Files 5 passed; Tests 89 passed

    npm run test:marketplace-web
    # 2026-06-07 19:32 +0800；Test Files 6 passed; Tests 41 passed

    npm run typecheck:marketplace
    # 2026-06-07 19:34 +0800；marketplace-shared 与 template-marketplace typecheck 通过

    npm run build:marketplace
    # 2026-06-07 19:32 +0800；Vite production build completed

    git diff --check
    # 2026-06-07 19:34 +0800；通过，无 whitespace error

    npm run typecheck
    # 2026-06-25 12:00 +0800；tsc --noEmit 通过

    npm run typecheck:marketplace
    # 2026-06-25 12:00 +0800；marketplace-shared 与 template-marketplace typecheck 通过

    npm run test:canvas-templates
    # 2026-06-25 12:00 +0800；源码/模板回归脚本通过

    npm run test:marketplace-web
    # 2026-06-25 12:00 +0800；Test Files 6 passed; Tests 43 passed

    npm run build
    # 2026-06-25 12:00 +0800；扩展构建通过

    npm run test:marketplace-vscode-fixture-e2e
    # 2026-06-25 12:00 +0800；Template marketplace VS Code UI E2E passed；覆盖安装 v1、侧栏更新徽章、更新到 v2、回滚到 v1 和举报跳转

    npm run typecheck:marketplace
    # 2026-06-26 11:45 +0800；marketplace-shared 与 template-marketplace typecheck 通过

    npm run typecheck
    # 2026-06-26 11:45 +0800；tsc --noEmit 通过

    npm run test:marketplace-web
    # 2026-06-26 11:45 +0800；Test Files 6 passed; Tests 44 passed

    npm run test:canvas-templates
    # 2026-06-26 11:45 +0800；源码/模板回归脚本通过，覆盖 publish-version source assertions

    npm run test:marketplace-vscode-fixture-e2e
    # 2026-06-26 11:45 +0800；Template marketplace VS Code UI E2E passed；覆盖 VSCode 发布新版本 v3、token exchange、/versions 请求和详情版本菜单更新

    npm run test:marketplace
    # 2026-06-26 17:39 +0800；marketplace typecheck/shared/api/web/preflight/browser E2E/VSCode fixture E2E 全链路通过；浏览器 E2E 使用本地 mock API 并覆盖 Web publish-version，VSCode preview 真网验证未包含在该命令内

    npm run build:marketplace
    # 2026-06-26 17:39 +0800；template-marketplace typecheck 与 Vite production build 通过

    npm run test:marketplace-vscode-preview-e2e
    # 2026-06-26 17:28 +0800；未执行真实 preview 验证，preflight 因当前网络解析 / 连接超时而按脚本规则 skip：connect ETIMEDOUT 157.240.17.14:443 / ENETUNREACH IPv6

    git diff --check
    # 2026-06-26 17:39 +0800；通过，无 whitespace error

## 接口与依赖

必须继续使用 Cloudflare Workers + Hono + D1 + R2 的既有模板市场栈。治理 API 不引入新的外部服务，不依赖前端隐藏按钮作为权限边界。

必须在 `packages/marketplace-shared/src/index.ts` 导出举报原因、举报状态、治理 API response 类型和管理员统计 response 类型。必须在 `apps/template-marketplace/src/worker/repository.ts` 的 `MarketplaceTemplateRepository` 接口和 `D1TemplateRepository` 实现中增加治理方法与 `getAdminStats()`。必须在 `apps/template-marketplace/src/worker/app.ts` 暴露治理路由和 `GET /api/v1/admin/stats`，并统一使用 `makeMarketplaceApiError()` 返回结构化错误。必须补充 `apps/template-marketplace/src/worker/app.test.ts` 和 `repository.test.ts`，覆盖认证失败、封禁失败、非管理员失败、管理员成功、审计写入和全站统计聚合。Web API helper 位于 `apps/template-marketplace/src/web/lib/api.ts`，浏览器管理后台位于 `apps/template-marketplace/src/web/components/TemplateAdminView.tsx`，详情页举报入口位于 `apps/template-marketplace/src/web/components/TemplateDetailView.tsx`。

2026-06-07 / Codex：创建 Phase 4 ExecPlan，原因是用户要求 compact 后进入 Phase 4，且版本管理与治理涉及权限、审计、Web UI 和 VSCode 安装侧多模块实现。

2026-06-07 / Codex：更新 Phase 4 ExecPlan，原因是第一切片已完成治理后端与浏览器最小治理入口，需要记录本地验证证据和剩余 VSCode / preview 缺口。

2026-06-07 / Codex：处理 PR review 中的两个 Medium 问题：完整包上传先查封禁再读取 multipart body；管理员 bootstrap 新增 `MARKETPLACE_ADMIN_GITHUB_IDS` 并保留 login 兼容。已同步设计/产品/计划文档和 `.dev.vars.example`。

2026-06-07 / Codex：更新 Phase 4 ExecPlan，原因是本轮切到 `feat-template-marketplace-phase4-admin-stats` 后实现管理员全站统计面板，需要记录 API、聚合口径、验证标准和剩余 Phase 4 缺口。

2026-06-25 / Codex：更新 Phase 4 ExecPlan，原因是 VSCode 安装侧更新/回滚和插件内举报跳转入口已完成本地实现并通过 fixture E2E，需要记录代码路径、验证证据和剩余 preview OAuth smoke。

2026-06-26 / Codex：更新 Phase 4 ExecPlan，原因是发布者新版本 Web / VSCode 用户入口已完成本地实现并通过 fixture E2E，需要记录 Web 路由、VSCode version mode、缓存失效、验证证据和剩余真实 preview OAuth smoke。
