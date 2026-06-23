# 模板市场基础实现

本 `ExecPlan` 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘` 这几个章节。

本文位于 `docs/exec-plans/active/template-marketplace-foundation.md`，必须按 `docs/PLANS.md` 的要求持续维护。

## 目标与全局图景

这次变更把已经选定的模板市场方案从文档推进到可运行的基础工程。完成后，开发者可以在本仓库内安装依赖，启动一个 `apps/template-marketplace` 应用，看到 React + Vite 的市场首页，并通过同一个应用的 Hono Worker API 访问 `/api/v1/templates`、`/api/v1/templates/:id` 和 `/api/v1/templates/:id/download`。这些接口最初基于内存种子数据和共享类型实现，用来证明浏览、详情和下载主路径的 API 合约、前端调用、Vite `/templates/` base path、Workers runtime 入口和测试脚本已经连通；当前正式口径是生产环境无 D1 时保持 empty 空目录，3 个 seed/preview 模板只作为开发、测试和调试 fixture，通过显式开关启用。

这不是完整 Phase 1-4 生产实现。本轮的可观察目标是“本地可跑、可测、结构正确，并把 preview D1/R2 只读下载主路径接通”，为后续接入 GitHub OAuth、共享 React Webview bundle、写接口、生产资源分离和治理后台留出明确边界，而不是把尚未完成的 Phase 4 能力伪装成已完成线上产品。

## 进度

- [x] (2026-05-10 03:38 +0800) 读取 `docs/WORKFLOW.md`、`docs/PLANS.md`、模板市场产品规格、技术选型设计文档和当前 `package.json`，确认实现前需要创建新的实现阶段 `ExecPlan`。
- [x] (2026-05-10 03:39 +0800) 从当前文档选型分支切出实现分支 `feat-template-marketplace-foundation`，避免继续把开发提交混在技术选型分支名下。
- [x] (2026-05-10 03:45 +0800) 创建 `packages/marketplace-shared/`，导出市场 API 类型、排序/分页常量、种子数据、搜索/排序/详情/下载纯函数和共享测试。
- [x] (2026-05-10 03:49 +0800) 创建 `apps/template-marketplace/`，包含 React + Vite 浏览器入口、Hono Worker 入口、Wrangler 配置、Vite 配置、Tailwind 基础主题和基础 CSS。
- [x] (2026-05-10 03:50 +0800) 为共享包、Worker API 和 Web API client 补最小自动化测试，覆盖列表、搜索、排序、详情、下载响应、404 和 API 不可用时的 fallback；该 fallback 口径后来在 2026-06-23 收敛为生产 empty、开发/调试 seed。
- [x] (2026-05-10 04:02 +0800) 更新根 `package.json`、`package-lock.json` 和设计索引相关文档，让新增 workspace、脚本和验证方式可被后续协作者直接执行。
- [x] (2026-05-10 04:04 +0800) 运行 `git diff --check`、`npm audit`、`npm run typecheck`、`npm run build`、`npm run typecheck:marketplace`、`npm run test:marketplace-shared`、`npm run test:marketplace-api`、`npm run test:marketplace-web` 和 `npm run build:marketplace`，全部通过。
- [x] (2026-05-10 04:48 +0800) 继续接入 D1 里程碑：为 `packages/marketplace-shared` 安装 `drizzle-orm`，新增 Phase 1-4 核心表的 Drizzle schema，并在 `apps/template-marketplace/migrations/0001_marketplace_core.sql` 写入对应 D1 SQL migration。
- [x] (2026-05-10 04:56 +0800) 新增 `MarketplaceTemplateRepository` 边界、seed repository 和 D1 repository；当时无 `MARKETPLACE_DB` 会回退 seed 数据，该策略后来在 2026-06-23 被“生产 empty 默认、显式 seed 开关”取代。
- [x] (2026-05-10 04:59 +0800) 补齐 D1 repository、migration、Worker D1 binding 和共享 schema 子路径导出测试；修复 Hono 测试中未传 Env 时 `context.env` 为空、`Array.map` 回调签名误用和测试 helper 重复注册测试的问题。
- [x] (2026-05-10 05:02 +0800) 重新运行 `npm run test:marketplace-shared`、`npm run test:marketplace-api`、`npm run test:marketplace-web`、`npm run typecheck:marketplace`、`npm run build:marketplace`、`npm run typecheck`、`npm run build`、`npm audit`、`git diff --check` 和 `/templates/` 构建产物检查，全部通过。
- [x] (2026-05-10 05:08 +0800) schema 子路径导出调整后再次运行完整验证；修复 `git diff --check` 发现的 `packages/marketplace-shared/src/index.ts` EOF 空行后，`npm audit`、`git diff --check`、`/templates/` 资源路径检查和 Web bundle Drizzle 排除检查均通过。
- [x] (2026-05-10 09:43 +0800) 通过 Wrangler 读取 Cloudflare 账号中的 preview 资源，确认 D1 `template_marketplace_preview` 的 `database_id` 为 `0944dc87-a603-4a59-8a59-b75ab3a796c5`，R2 bucket `template-marketplace-preview` 已存在且为空。
- [x] (2026-05-10 09:46 +0800) 将真实 preview D1 binding 写入 `wrangler.toml`，新增可重跑的 preview seed SQL 与 `db:migrate:preview`、`db:seed:preview`、`db:verify:preview` 脚本，并在远端 D1 执行 migration 与 seed。
- [x] (2026-05-10 09:47 +0800) 验证远端 D1 已有 3 个官方模板和 3 个版本，运行 `npm run test:marketplace-api`、`npm run typecheck:marketplace`、`npm run build:marketplace`、`npm audit` 和 `git diff --check`，全部通过。
- [x] (2026-05-10 09:58 +0800) 为 Workers Static Assets 补 `/templates` base path 重写和入口测试，新增 `deploy:preview` 脚本；`/templates/assets/...` 会在 Worker 内转成 `/assets/...`，匹配 Vite 的实际产物目录。
- [x] (2026-05-10 09:59 +0800) 首次执行 `npm run -w @dev-session-canvas/template-marketplace deploy:preview` 时，构建和资源上传成功，但 Cloudflare account 尚未注册 workers.dev subdomain，Wrangler 在非交互模式下拒绝发布公开 workers.dev 路由。
- [x] (2026-05-10 10:11 +0800) 用户确认 workers.dev 子域名为 `wzy0304.workers.dev` 后，重新部署成功，当前预览地址为 `https://dscanvas-template-marketplace.wzy0304.workers.dev`，版本 ID 为 `253f8e7e-66db-4802-9108-7b31ee9cb336`。
- [x] (2026-05-10 11:43 +0800) 为 3 个官方 seed 模板新增 R2 `template.json` fixture，补 `r2:seed:preview` 与 `r2:verify:preview` 脚本，并把共享 seed 与 preview D1 seed SQL 中的 sha256 / size 更新为真实文件摘要。
- [x] (2026-05-10 11:47 +0800) 将 `/api/v1/templates/:id/download` 接到 R2：有 `TEMPLATE_BUCKET` binding 时返回真实 JSON attachment；无 R2 binding 时继续返回显式 metadata JSON 作为本地降级路径，并补 fake R2 测试。
- [x] (2026-05-10 11:53 +0800) 重新执行远端 D1 seed、R2 对象上传与 R2 摘要校验，3 个对象均能通过 Wrangler `r2 object get` 下载并匹配本地 fixture 的 size / sha256。
- [x] (2026-05-10 12:00 +0800) 重新部署 workers.dev 预览，当前版本 ID 为 `02558665-ef5f-445c-8411-1b0fbf0ca1ea`；本机 `curl` 访问 workers.dev 仍因网络/代理超时，HTTP 下载主路径需继续由浏览器或其他网络环境人工确认。
- [x] (2026-05-10 12:01 +0800) 根据用户截图确认浏览器直接访问 `/api/v1/templates/review-loop/download` 时仍显示 SPA 页面，修正 Cloudflare Static Assets 配置，给 `[assets]` 增加 `run_worker_first = ["/api/*"]`，确保 HTML navigation 的 API 请求不会被 SPA fallback 接管。
- [x] (2026-05-10 12:03 +0800) 重新运行 `npm run test:marketplace-api` 和 `npm run -w @dev-session-canvas/template-marketplace deploy:preview`，API 测试 19 个用例通过，workers.dev 当前版本 ID 更新为 `8fa25378-22d8-49e4-84bf-f1c9ffa61a7d`。
- [x] (2026-05-10 12:19 +0800) 用户在浏览器重新访问 `https://dscanvas-template-marketplace.wzy0304.workers.dev/api/v1/templates/review-loop/download`，确认下载列表中出现 `tmpl-review-loop-v1.json`，R2 下载主路径的人工验证通过。
- [x] (2026-05-10 12:33 +0800) 在模板卡片上新增 `Download` 按钮，链接到 `/api/v1/templates/:slug/download?version=:versionId`，并新增 Web download href 单元测试，避免用户继续手动输入 API 地址。
- [x] (2026-05-10 12:35 +0800) 运行 `npm run test:marketplace-web`、`npm run typecheck:marketplace`、`npm run build:marketplace` 和 `npm run -w @dev-session-canvas/template-marketplace deploy:preview`，全部通过；workers.dev 当前版本 ID 更新为 `9bd49952-c5c8-4c0d-9673-b3b591fac3dc`。
- [x] (2026-05-10 12:40 +0800) 用户截图显示根路径预览页面空白；定位为 Static Assets 仍会先处理 `/templates/assets/...`，导致 Vite 资源路径没有进入 Worker 重写。将 `run_worker_first` 扩展为 `["/api/*", "/templates", "/templates/*"]`，让 `/templates` 页面和静态资源都进入 Worker。
- [x] (2026-05-10 12:42 +0800) 运行 `npm run test:marketplace-api`、`npm run build:marketplace` 和 `npm run -w @dev-session-canvas/template-marketplace deploy:preview`，全部通过；workers.dev 当前版本 ID 更新为 `6f5243b6-0408-4039-af73-52b4f9e2c162`。
- [x] (2026-05-10 12:47 +0800) 用户刷新 workers.dev 预览页面，确认市场页面正常渲染，并且 3 张模板卡片均显示 `Download` 按钮。
- [x] (2026-05-10 13:00 +0800) 新增 `/templates/:slug` 前端详情路径、详情 API client、`TemplateDetailView` 和详情/路由单元测试；卡片主视觉现在链接到模板详情页，详情页展示 readme、版本历史、sha256、统计和下载入口。
- [x] (2026-05-10 13:01 +0800) 运行 `npm run test:marketplace-shared`、`npm run test:marketplace-api`、`npm run test:marketplace-web`、`npm run typecheck:marketplace`、`npm run build:marketplace` 和 `npm run -w @dev-session-canvas/template-marketplace deploy:preview`，全部通过；补充详情路径 SPA fallback 测试后再次运行 API/Web 测试和 marketplace typecheck 也通过；workers.dev 当前版本 ID 更新为 `5e9b61aa-1afd-4ba0-bca3-df6dfe98e26e`。
- [x] (2026-05-10 13:09 +0800) 用户打开 `review-loop` 详情页并截图确认：详情页正常渲染 `Worker API / D1`、readme、版本历史、sha256、`Download JSON`，列表卡片仍保留在详情下方。
- [x] (2026-05-10 13:16 +0800) 在 D1 repository 中新增 `recordDownload`，真实 R2 对象存在时先写入 `templates.download_count` 累加和 `template_daily_stats` 日下载 upsert，再返回下载响应；R2 对象缺失时保持 404 且不计数。
- [x] (2026-05-10 13:17 +0800) 运行 `npm run test:marketplace-api`、`npm run typecheck:marketplace`、`npm run build:marketplace` 和 `npm run -w @dev-session-canvas/template-marketplace deploy:preview`，全部通过；workers.dev 当前版本 ID 更新为 `30c27094-fc02-42f3-86a5-f4b89c79ec45`。
- [x] (2026-05-10 13:27 +0800) 用户在预览环境点击下载并观察到下载量确实 +1，确认 D1 累计下载计数的浏览器人工验证通过。
- [x] (2026-05-10 13:32 +0800) 新增 Web 端标签筛选交互：市场首页会从当前结果和已选标签中生成 tag chips，点击 tag 后请求 `/api/v1/templates?tag=...`，支持多标签组合与 Clear。
- [x] (2026-05-10 13:33 +0800) 运行 `npm run test:marketplace-web`、`npm run typecheck:marketplace`、`npm run build:marketplace` 和 `npm run -w @dev-session-canvas/template-marketplace deploy:preview`，全部通过；workers.dev 当前版本 ID 更新为 `8a8b9c70-8254-44b6-99c8-e00b7e07d876`。
- [x] (2026-05-10 13:50 +0800) 新增浏览器 `Install in VSCode` 深链接，链接格式为 `vscode://devsessioncanvas.dev-session-canvas/install-template?...`，卡片和详情页都可以带上模板 slug、版本 id 与当前详情页 source。
- [x] (2026-05-10 13:50 +0800) 在扩展端注册 `onUri` / `vscode.window.registerUriHandler`，新增 `TemplateMarketplaceClient`：校验可信市场来源后读取详情 API、下载指定版本 JSON、校验 sha256，再写入全局用户模板目录的 `marketplace/` 子目录。
- [x] (2026-05-10 13:50 +0800) 为本地模板存储新增 `*.market.json` sidecar 读写与扫描忽略逻辑；侧栏模板列表会把带 sidecar 的用户模板标记为“市场”，并用 cloud download 图标区分来源。
- [x] (2026-05-10 13:50 +0800) 运行 `npm run test:marketplace-web`、`npm run test:canvas-templates` 和 `npm run typecheck`，全部通过。
- [x] (2026-05-10 13:54 +0800) 运行 `npm run test:marketplace-shared`、`npm run test:marketplace-api`、`npm run test:marketplace-web`、`npm run typecheck:marketplace`、`npm run build:marketplace`、`npm run build`、`git diff --check`、`npm audit` 和 `npm run -w @dev-session-canvas/template-marketplace deploy:preview`，全部通过；workers.dev 当前版本 ID 更新为 `996292e4-2183-464b-817c-f04d714e3e57`。
- [x] (2026-05-10 14:10 +0800) 根据用户截图确认 VSCode URI handler 已被唤起，但浏览器不会强制把 VSCode 窗口前置，且 Remote SSH extension host 可能无法直连 workers.dev；新增 Web 点击后的提示文案，并让浏览器对小于 8KB 的模板 JSON 先下载后作为 base64url payload 附到 VSCode URI，扩展端优先校验 payload 并安装。
- [x] (2026-05-10 14:12 +0800) 运行 `npm run test:marketplace-web`、`npm run test:canvas-templates`、`npm run typecheck`、`npm run typecheck:marketplace`、`npm run build:marketplace`、`npm run build`、`git diff --check`、`npm audit` 和 `npm run -w @dev-session-canvas/template-marketplace deploy:preview`，全部通过；workers.dev 当前版本 ID 更新为 `56d7fff5-a3f1-4beb-807a-ba145c762720`。
- [x] (2026-05-10 14:28 +0800) 新增 `Dev Session Canvas: 打开模板市场` 命令和模板侧栏标题栏入口，打开独立 Webview Editor 市场页；Webview 读取 preview Worker API，支持搜索、排序、浏览卡片，并通过 message passing 把模板 payload 交给 Extension Host 写入本地模板目录。
- [x] (2026-05-10 14:28 +0800) 运行 `npm run typecheck` 与 `npm run test:canvas-templates`，通过命令注册、Webview 控制器接线和本地模板安装路径的代码级验证。
- [x] (2026-05-10 14:30 +0800) 补充运行 `npm run test:package-vsix-command`、`npm run build`、`git diff --check` 和 `npm audit`，全部通过；确认新增命令 contribution 不破坏 VSIX 打包前置检查，扩展 bundle 可构建。
- [x] (2026-05-10 14:54 +0800) 根据用户截图确认插件内 Webview 市场页已渲染但 `fetch` 显示 `加载失败：Failed to fetch`；为 Worker `/api/v1/*` 增加公开只读 CORS 中间件，允许 VSCode Webview 和浏览器跨源读取匿名 API，并补充 GET / OPTIONS / 下载响应头测试。
- [x] (2026-05-10 14:54 +0800) 运行 `npm run test:marketplace-api`、`npm run typecheck:marketplace`、`npm run build:marketplace`、`npm run test:canvas-templates`、`npm run typecheck`、`npm run build`、`npm audit` 和 `git diff --check`，全部通过；重新部署 workers.dev preview，当前版本 ID 更新为 `d28208d5-7dc4-44ed-86a1-efd5de9c17a2`。
- [x] (2026-05-10 15:11 +0800) 用户在 VSCode Extension Development Host 中重新打开“模板市场”，确认 Webview 已能加载 3 个模板卡片，并且点击“安装到 VSCode”后模板安装成功。
- [x] (2026-05-10 15:41 +0800) 新增 Webview 已安装状态回显：Extension Host 会从本地模板 catalog / market sidecar 汇总已安装市场模板，面板打开和安装完成后回传给 Webview，卡片显示“本地已安装 vN”并禁用同版本重复安装按钮。
- [x] (2026-05-10 15:43 +0800) 运行 `npm run test:canvas-templates`、`npm run typecheck`、`npm run build`、`npm run test:package-vsix-command`、`npm audit` 和 `git diff --check`，全部通过；本轮仅改扩展端 Webview / 本地状态回显，无需重新部署 Worker。
- [x] (2026-05-10 15:55 +0800) 按用户反馈补充卡片级安装目标选择：每张模板卡片都有“安装位置”下拉框，默认保持本地（当前设备），也可选择当前 workspace；安装 payload 会携带目标 storage location，Extension Host 写入对应模板目录下的 `marketplace/` 子目录；workspace 选项文案从 `Workspace · 当前 workspace · <title>` 收敛为 `当前workspace · <title>`。
- [x] (2026-05-10 15:57 +0800) 重新运行 `npm run test:canvas-templates`、`npm run typecheck`、`npm run build`、`npm run test:package-vsix-command`、`npm audit` 和 `git diff --check`，全部通过；本轮仍只改扩展端安装目标选择，无需重新部署 Worker。
- [x] (2026-05-10 16:30 +0800) 继续完善安装范围可见性：模板侧栏的市场模板现在按真实存储范围显示为 `市场 · 本地` 或 `市场 · 工作区`，并补充 workspace 市场模板 sidecar 写入测试。
- [x] (2026-05-10 16:42 +0800) 插件内市场卡片新增“应用到 Canvas”动作：仅当当前卡片选择的本地 / workspace 安装目标已有对应市场模板时可用，Extension Host 会按 `storageLocationId` 找到本地已安装副本并套用到 Canvas，再聚焦新增节点组。
- [x] (2026-05-10 16:44 +0800) 运行 `npm run test:canvas-templates`、`npm run typecheck`、`npm run build`、`npm run test:package-vsix-command`、`npm audit` 和 `git diff --check`，全部通过；本轮只改扩展端市场面板和本地应用路径，无需重新部署 Worker。
- [x] (2026-05-10 16:55 +0800) 根据用户反馈移除插件内市场卡片的“应用到 Canvas”动作，模板市场继续聚焦浏览、下载、安装和已安装状态回显；已安装模板的应用入口保留在侧栏模板列表。
- [x] (2026-05-10 16:57 +0800) 重新运行 `npm run test:canvas-templates`、`npm run typecheck`、`npm run build`、`npm run test:package-vsix-command`、`npm audit` 和 `git diff --check`，全部通过；本轮只改扩展端市场面板入口边界，无需重新部署 Worker。
- [x] (2026-05-10 17:12 +0800) 继续收口插件内市场 Webview UX：安装成功提示用户去模板侧栏应用，已安装 badge 显示具体安装位置，搜索/排序/卡片级安装位置通过 Webview state 保持稳定，网络不可达时显示清晰错误和已安装模板快照而不是空白列表。
- [x] (2026-05-10 17:16 +0800) 运行 `npm run test:canvas-templates`、`npm run typecheck`、`npm run build`、`npm run test:package-vsix-command`、`npm audit` 和 `git diff --check`，全部通过；本轮只改扩展端 Webview UX，无需重新部署 Worker。
- [x] (2026-05-10 17:50 +0800) 继续完善安装/下载主路径：插件内市场卡片新增 `下载 JSON` 入口；市场模板安装时会按市场模板 id / slug 和安装位置覆盖既有副本，同版本重复安装显示为重新安装，不同版本显示为更新，并保留本地模板 id 和创建时间。
- [x] (2026-05-10 17:54 +0800) 运行 `npm run test:canvas-templates`、`npm run typecheck`、`npm run build`、`npm run test:package-vsix-command`、`npm audit` 和 `git diff --check`，全部通过；本轮只改扩展端下载/安装策略，无需重新部署 Worker。
- [x] (2026-05-10 18:16 +0800) 为 `review-loop` 增加 preview v2：新增本地 R2 fixture、共享 seed、D1 seed 与幂等 patch、R2 对象清单和验证；已把 v2 JSON 上传到 preview R2，并把 preview D1 的 `review-loop` latest version 指到 `ver-review-loop-2`。
- [x] (2026-05-10 18:17 +0800) 运行 `npm run test:marketplace-shared`、`npm run test:marketplace-api`、`npm run test:marketplace-web`、`npm run test:canvas-templates`、`npm run typecheck:marketplace`、`npm run typecheck`、`npm run build:marketplace`、`npm run build`、`npm run test:package-vsix-command`、`npm audit` 和 `git diff --check`，全部通过；本轮未重新部署 Worker 代码，只更新 preview D1/R2 数据。
- [x] (2026-05-10 18:33 +0800) 补齐 preview 缩略图读路径：为 4 个已发布版本生成 PNG 缩略图 fixture，纳入 R2 对象清单和校验脚本；Worker 新增 `GET /api/v1/templates/:id/thumbnail?version=`，有 R2 binding 时返回真实 PNG，无 R2 时返回显式 seed SVG；浏览器卡片、详情页和插件内 Webview 卡片都改为优先展示该缩略图并保留渐变降级。
- [x] (2026-05-10 18:35 +0800) 重新上传并校验 preview R2 的 4 个 `template.json` 与 4 个 `thumbnail.png` 对象；运行 `npm run test:marketplace-api`、`npm run test:marketplace-web`、`npm run test:canvas-templates`、`npm run typecheck:marketplace`、`npm run typecheck`、`npm run build:marketplace`、`npm run build`、`npm run test:package-vsix-command`、`npm audit` 和 `git diff --check`，全部通过；重新部署 workers.dev preview，当前版本 ID 为 `4e08d963-ed0b-4c75-9274-178b63fb7975`。
- [x] (2026-05-10 19:12 +0800) 用户确认预览环境能看到 3 张模板卡片和卡片预览图；由于未先安装 `Review Loop` v1，当前无法仅靠默认按钮验证更新到 v2。
- [x] (2026-05-10 19:20 +0800) 按用户确认的 VSCode 插件市场式交互，插件内市场安装入口改为 split button：主按钮安装/更新最新版本，右侧下拉读取详情 API 的版本列表并允许安装指定版本。
- [x] (2026-05-10 19:30 +0800) 按用户补充，插件内市场下载入口也改为 split button：主按钮下载最新版本，右侧下拉读取同一份版本列表并允许下载指定版本。
- [x] (2026-05-10 19:47 +0800) 用户手动验证 split 安装/下载指定版本路径通过；同步把 `docs/product-specs/template-marketplace.md` 的 Phase 1 浏览与安装验收项标记为 preview 环境已通过。
- [x] (2026-05-10 22:29 +0800) 按 `docs/UI.md` 重定义市场页 UI：浏览器市场支持 `Light 2026` / `Dark 2026` 主题变量，插件内市场面板移除固定白/黑/绿棕色视觉并改为完全由当前 VSCode Color Theme token 派生；同步更新 `docs/design-docs/template-marketplace.md` 的 UI 定义和 `docs/product-specs/template-marketplace.md` 的验收口径。
- [x] (2026-05-10 22:31 +0800) 运行 `npm run test:marketplace-web`、`npm run typecheck:marketplace`、`npm run build:marketplace`、`npm run typecheck`、`npm run build`、`git diff --check`，全部通过；并用 `rg` 确认市场 Web 与插件内市场面板样式中不再残留固定 `white` / hex / `rgba` / `color-mix(... #...)`。
- [x] (2026-05-10 22:34 +0800) 重新执行 `npm run -w @dev-session-canvas/template-marketplace deploy:preview`，workers.dev 预览已更新到版本 `5bcc91d0-871e-4a4d-839d-e10868722b83`。
- [x] (2026-05-10 23:08 +0800) 根据用户截图继续收口市场视觉：浏览器市场改为对齐 Visual Studio Marketplace 的黑色品牌栏、tab、居中标题、矩形搜索和矩形卡片；插件内市场移除背景渐变、超大标题、胶囊按钮和大圆角卡片。重新运行 `npm run test:marketplace-web`、`npm run typecheck:marketplace`、`npm run build:marketplace`、`npm run typecheck`、`npm run build`、`git diff --check` 并重新部署 preview，当前版本 ID 为 `5e5e138e-471e-430b-8479-2c26c9251ea2`。
- [x] (2026-05-10 23:26 +0800) 按用户微调浏览器市场：顶部文案从 Marketplace 改为 Templates，只保留单一 Templates tab，移除 Canvas / Agents / Resources 占位章节，主题主色从 Visual Studio Marketplace 玫红色改为 DevSessionCanvas 图标蓝色 #4878f0 和绿色 #48b0a0。运行 `npm run test:marketplace-web`、`npm run typecheck:marketplace`、`npm run build:marketplace`、`git diff --check` 并重新部署 preview，当前版本 ID 为 `e2273ac0-fd5c-4a76-84bf-0844cb439f27`。
- [x] (2026-05-10 23:52 +0800) 根据用户截图继续收敛模板详情页：`/templates/:slug` 不再展示首页搜索、筛选、Featured 列表和模板网格；详情视图改为 README 主栏 + 紧凑侧栏，缩略图、安装 / 下载、统计、版本历史、sha256 和来源信息都降级为辅助内容，版本历史和完整性校验默认折叠；同步更新 `docs/UI.md`、`docs/design-docs/template-marketplace.md` 和 `docs/product-specs/template-marketplace.md` 的详情页规则。
- [x] (2026-05-10 23:57 +0800) 运行 `npm run test:marketplace-web`、`npm run typecheck:marketplace`、`npm run build:marketplace`、`git diff --check` 和“文档 hex 颜色不加反引号”扫描，全部通过；重新执行 `npm run -w @dev-session-canvas/template-marketplace deploy:preview`，workers.dev 预览已更新到版本 `dfd3f4a0-28e4-4185-8a19-02a1766777bf`。
- [x] (2026-05-11 00:14 +0800) 根据用户截图继续收敛 VSCode 插件内模板市场：Webview 顶部移除大标题 / 双栏说明和大工具卡，模板展示从三列大卡片墙改为单列紧凑行，小缩略图 + 文本摘要 + 右侧安装 / 下载动作；继续使用 `--vscode-*` token 与 `color-mix` 派生 hover、边框、输入框、按钮和菜单颜色，并同步更新 UI / 设计 / 产品规格中的插件内市场密度规则。
- [x] (2026-05-11 00:16 +0800) 运行 `npm run test:canvas-templates`、`npm run typecheck`、`npm run build`、`npm run test:package-vsix-command`、`git diff --check` 和“文档 hex 颜色不加反引号”扫描，全部通过；本轮只改 VSCode 插件内 Webview 和文档，不需要重新部署浏览器市场 Worker。
- [x] (2026-05-11 00:30 +0800) 根据用户截图继续整理插件内市场按钮区：安装和下载 split button 改为右侧控件区两列对齐，浏览器详情降为次级文本动作；安装 / 下载版本菜单现在会在点击外部、搜索 / 排序变化或按 Escape 时关闭，避免未选择时浮层一直停留。
- [x] (2026-05-11 00:36 +0800) 运行 `npm run test:canvas-templates`、`npm run typecheck`、`npm run build`、`npm run test:package-vsix-command`、`git diff --check` 和“文档 hex 颜色不加反引号”扫描，全部通过；本轮只改 VSCode 插件内 Webview 和文档，不需要重新部署浏览器市场 Worker。
- [x] (2026-05-11 00:44 +0800) 根据用户截图继续调整插件内市场信息位置：每个模板的“浏览器详情”从右侧安装 / 下载按钮区移到模板标题旁，作为标题附近的次级文本动作，右侧按钮区只保留安装 / 下载主动作。
- [x] (2026-05-11 00:45 +0800) 运行 `npm run test:canvas-templates`、`npm run typecheck`、`npm run build`、`npm run test:package-vsix-command`、`git diff --check` 和“文档 hex 颜色不加反引号”扫描，全部通过；本轮只改 VSCode 插件内 Webview 和文档，不需要重新部署浏览器市场 Worker。
- [x] (2026-05-12 00:13 +0800) 用户在 Extension Development Host 中人工验证插件内模板市场视觉 UI，确认当前视觉没有问题，可以继续后续收口。
- [x] (2026-05-12 07:05 +0800) 按 review 收口外部模板市场安装链接：浏览器安装入口改为 payload-free 的 `vscode://.../install-template?template=...&version=...&source=...`，外部 URI 统一走详情 + 下载 API；随后重新执行 `npm run -w @dev-session-canvas/template-marketplace deploy:preview`，当前 workers.dev 预览版本 ID 更新为 `2075264f-fee0-4a0c-9111-a82da7e97ad2`。
- [x] (2026-05-12 08:24 +0800) 按用户反馈把外部 `vscode://.../install-template` 与插件内列表安装入口改成“先打开 VSCode 内详情页，再点安装”：URI handler 打开 `CanvasTemplateMarketplacePanel` 的详情视图并预选模板 / 版本，列表快捷入口进入详情页动作上下文，详情页承载 README、安装位置、安装 / 下载 split button、版本历史和校验信息；同步更新 UI / 设计 / 产品规格 / 设计索引，并运行 `git diff --check`、`npm run typecheck`、`npm run test:package-vsix-command`、`npm run test:marketplace-web`、`npm run typecheck:marketplace`、`npm run build`、`npm run build:marketplace`、文档 hex 扫描、Webview JS `node --check`、`npm run test:canvas-templates` 和 `npm run -w @dev-session-canvas/template-marketplace deploy:preview`，全部通过；workers.dev 当前版本 ID 更新为 `ea2fee85-3a1e-465b-bbc0-d1f7b7266cbc`。
- [x] (2026-05-12 13:43 +0800) 按新的 review 意见收口 D1 模板仓库的 latest 指针容错：`latest_version_id` 若指向 rejected 版本，则回退到同模板最新 published 版本，避免在 list/detail/default download 中泄漏 rejected 版本；补充 repository 测试覆盖 list、detail、默认下载和显式 rejected 版本下载的行为。
- [x] (2026-05-12 18:29 +0800) 按最新 review 选择保留插件内列表级安装位置预选和详情快捷入口，并同步更新 `docs/marketplace/UI.md`、`docs/design-docs/template-marketplace.md` 与 `docs/product-specs/template-marketplace.md`：安装 / 更新 / 已安装 / 下载 JSON 等列表快捷动作统一表述为打开模板详情页并执行对应动作，安装位置作为详情页默认目标。
- [x] (2026-05-12 19:41 +0800) 按用户反馈将模板市场详细 UI 从通用 `docs/UI.md` 拆到 `docs/marketplace/UI.md`，并把安装 / 下载 JSON 等列表快捷动作改为正向表述：打开模板详情页并执行对应动作；`docs/UI.md` 只保留跨功能 VSCode design-system 基线，产品规格索引同步指向市场专属 UI 文档。
- [x] (2026-05-12 21:40 +0800) 按最新 review 收口插件内列表下载动作：列表行 `下载 JSON` 主按钮和版本菜单现在先打开模板详情页并预选对应版本，再执行下载；详情页内下载 split button 仍在当前详情上下文直接下载，源码断言同步覆盖该边界；运行 `git diff --check`、`npm run test:canvas-templates`、`npm run typecheck`、`npm run test:package-vsix-file-list`、Webview JS `node --check`、`npm run build`、`npm run test:marketplace-web`、`npm run test:marketplace-api` 和 `npm run typecheck:marketplace`，全部通过。
- [x] (2026-05-12 23:34 +0800) 按最新 review 收口同一市场模板跨安装位置的本地身份：市场模板首次安装到某个目标位置时生成 `market-template-<uuid>` 本地模板 id，同一位置更新 / 重装继续保留既有 id；侧栏模板标签同步改为精简组合：`内置`、`市场 · 本地/工作区`、`自建 · 本地/工作区`；运行 `git diff --check`、`npm run test:canvas-templates`、`npm run typecheck`、`npm run test:package-vsix-file-list`、`npm run build`、`npm run test:package-vsix-command` 和 `npm run test:marketplace-web`，全部通过。
- [x] (2026-05-13 00:41 +0800) 按用户截图继续精简侧栏模板组合标签：内置模板只显示 `内置`，不显示位置；市场模板显示 `市场 · 本地/工作区`；用户保存或导入模板显示 `自建 · 本地/工作区`。运行 `git diff --check`、`npm run test:canvas-templates`、`npm run typecheck`、`npm run build` 和 `npm run test:package-vsix-file-list`，全部通过。

- [x] (2026-05-13 07:20 +0800) 处理最新 review：D1 public repository 对 `latest_version_id` 指向的 published 版本增加同模板约束，并硬化最终版本 join；新增跨模板 pointer 回归测试；插件内详情页统一用当前选中版本驱动安装、下载、版本状态和 sha256；同步 `CanvasTemplateStore` 的本地 / workspace 安装目录文档口径。
- [x] (2026-05-13 07:21 +0800) 运行 `npm run test:marketplace-api`、`npm run test:canvas-templates`、`npm run test:marketplace-shared`、`npm run test:marketplace-web`、`npm run typecheck`、`npm run typecheck:marketplace`、`npm run build`、`npm run build:marketplace`、`npm run test:package-vsix-file-list`、Webview JS `node --check`、`npm audit --audit-level=none` 和 `git diff --check`，全部通过。

- [x] (2026-05-13 07:58 +0800) 继续处理 review follow-up：新增 `npm run test:marketplace` 聚合 `typecheck:marketplace`、`test:marketplace-shared`、`test:marketplace-api` 和 `test:marketplace-web`，并把该聚合串入根 `npm test` 默认回归入口；`test:canvas-templates` 增加源码断言防止 marketplace 回归入口再次脱链。
- [x] (2026-05-13 08:00 +0800) 运行 `npm run test:marketplace`、`npm run test:canvas-templates`、`npm run typecheck` 和 `git diff --check`，全部通过。

- [x] (2026-05-13 14:25 +0800) 修复 review 指出的市场来源漂移：浏览器外部安装 URI 的 `source` 现在会传递到插件内详情页；Webview 根据该来源切换 `apiOrigin`、详情/下载/缩略图请求、浏览器回跳和安装 sidecar `sourceUrl`，默认命令入口仍使用 preview 来源。
- [x] (2026-05-13 14:27 +0800) 运行 `npm run test:canvas-templates`、`npm run typecheck`、`npm run test:marketplace-web`、`npm run test:marketplace`、`npm run build`、`npm run build:marketplace`、Webview JS `node --check` 和 `git diff --check`，全部通过。

- [x] (2026-05-13 15:54 +0800) 处理最新 review：把默认命令入口与外部 URI 来源详情入口拆开。`devSessionCanvas.openTemplateMarketplace` 每次复位到默认 index 并向 Webview 发送 `marketplace/openTemplateIndex`；只有 `openTemplateDetailFromUri()` / 显式带 `source` 的详情路径才切换到可信外部 origin，避免默认入口被上一次外部来源粘住。
- [x] (2026-05-13 15:57 +0800) 运行 `npm run test:canvas-templates`、`npm run typecheck`、`npm run test:marketplace`、`npm run test:marketplace-web`、`npm run build`、`npm run build:marketplace`、`npm run test:package-vsix-file-list`、Webview JS `node --check` 和 `git diff --check`，全部通过。

- [x] (2026-05-13 16:44 +0800) 根据用户反馈修正默认来源策略：默认命令入口按当前扩展安装模式选择来源，正式安装使用 `https://dscanvas.dev/templates`，调试 / 测试安装使用 preview / 本地调试来源；外部 `source` 必须与当前安装模式一致，正式安装遇到调试链接、调试安装遇到正式链接时直接报错提示。
- [x] (2026-05-13 16:55 +0800) 运行 `npm run test:canvas-templates`、`npm run typecheck`、`npm run test:marketplace`、`npm run build`、`npm run build:marketplace`、Webview JS `node --check`、`git diff --check` 和 `npm run test:package-vsix-file-list`，全部通过。

- [x] (2026-05-13 17:43 +0800) 处理最新 review：把 IPv6 loopback `http://[::1]:*` / `https://[::1]:*` 纳入 Webview `connect-src`，并把本地调试来源补进 `img-src`，让本地 Worker dev server 的详情、下载和缩略图 CSP 边界与 trusted debug source 一致。
- [x] (2026-05-13 17:43 +0800) 运行 `npm run test:canvas-templates`、`npm run typecheck`、`npm run test:marketplace`、`npm run build`、`npm run build:marketplace`、Webview JS `node --check`、`npm run test:package-vsix-file-list` 和 `git diff --check`，全部通过。
- [x] (2026-06-23 23:08 +0800) 根据 PR #196 review 同步 seed fallback 口径：生产 Worker 在无 `MARKETPLACE_DB` 时默认返回 `storageMode: "empty"` 和空目录；只有 `MARKETPLACE_ENABLE_SEED_TEMPLATES=true` 才启用 Worker seed repository；Web API 不可用时生产默认 empty，只有 Vite dev 或 `VITE_MARKETPLACE_ENABLE_SEED_FALLBACK=true` 才启用 seed fallback。
- [x] (2026-06-23 23:14 +0800) 重新运行 PR #196 review 相关验证：`npm run -w @dev-session-canvas/template-marketplace typecheck`、`test:api`、`test:web`、`npm run -w @dev-session-canvas/marketplace-shared test`、`typecheck`、`npm run build:marketplace`、`npm run test:marketplace-vscode-preview-preflight` 和 `git diff --check`，全部通过。

## 意外与发现

- 观察：当前仓库已有 React 18、React DOM、TypeScript 和 esbuild，但没有 Vite、Hono、Drizzle、Zod、Wrangler、Vitest 或 Cloudflare Workers 类型。
  证据：`node -e "const p=require('./package.json'); console.log(p.dependencies, p.devDependencies)"` 的输出只包含现有 VSCode extension 依赖和测试脚本。

- 观察：本轮暂不需要真实 Cloudflare、R2 或 GitHub OAuth 账号即可开发和验证基础骨架。
  证据：产品规格和设计文档已经确认账号准备不阻塞本地实现；真实账号只阻塞云端预览、生产绑定和真实 OAuth 回调。

- 观察：使用最初安装的 Vite 5 / Vitest 1 / Wrangler 3 组合会带入过期 dev 依赖审计告警。
  证据：`npm audit --json` 报告 Vite、Vitest、Wrangler、Miniflare 和 Undici 相关漏洞；升级到 Vite 7.3.3、Vitest 3.2.4、Wrangler 4.90.0 并重新生成 lockfile 后，`npm audit` 输出 `found 0 vulnerabilities`。

- 观察：`@vitejs/plugin-react` 5.2.0 的 package exports 对 TypeScript 5.0 的 `Node` module resolution 不暴露可解析类型。
  证据：把 `vite.config.ts` 纳入 `tsconfig.web.json` 时，`tsc` 报 `Cannot find module '@vitejs/plugin-react'`；Vite 自身能正常加载配置，因此本轮把 Vite 配置从 Web 应用类型检查范围移出，保留 `vite build` 作为配置验证。

- 观察：Hono 的 `app.request(...)` 测试如果不传第三个 Env 参数，`context.env` 可能是 `undefined`，不能直接读取 `context.env.MARKETPLACE_DB`。
  证据：新增 D1 repository 后，旧 seed 路由测试报 `Cannot read properties of undefined (reading 'MARKETPLACE_DB')`；改为 `context.env?.MARKETPLACE_DB` 后，不传 Env 的 empty 默认、显式 seed fallback 与 D1 binding 测试都能通过。

- 观察：把 `mapTemplateRow(row, versions?)` 直接作为 `Array.map` 回调会让 TypeScript 把第二个 `index` 参数误配给 `versions` 参数。
  证据：`npm run typecheck:marketplace` 曾报 `Argument of type '(row: TemplateRow, versions?: MarketplaceTemplateVersion[]) => MarketplaceTemplateDetail' is not assignable to parameter of type ...`；改为 `rows.map((row) => mapTemplateRow(row))` 后类型检查通过。

- 观察：测试文件不能互相 import 作为 helper，否则 Vitest 会在导入方重复注册被导入测试。
  证据：`app.test.ts` 直接 import `repository.test.ts` 时，Vitest 显示 `app.test.ts (9 tests)`，其中包含重复注册的 3 个 repository 测试；抽出 `testD1Database.ts` helper 后 `app.test.ts` 收敛为 6 个测试。

- 观察：如果从 `packages/marketplace-shared/src/index.ts` 直接 re-export Drizzle schema，浏览器市场 bundle 会把 Drizzle SQLite 构造代码一起打进去。
  证据：在 root re-export 方案下，构建产物中能搜到 `drizzle:entityKind`、`SQLiteTable` 和 `template_versions`；改为 `@dev-session-canvas/marketplace-shared/schema` 子路径导出后，`rg "drizzle:entityKind|SQLiteTable|template_versions|admin_audit_logs" apps/template-marketplace/dist/web/assets` 无输出，Web JS 从 240.07 kB 降到 218.81 kB；当前 `moduleResolution: "Node"` 还需要在共享包 `typesVersions` 中声明 `schema`，否则跨 workspace typecheck 找不到子路径类型。

- 观察：`wrangler d1 info template_marketplace_preview` 会优先使用 `wrangler.toml` 中的 D1 binding；如果 `database_id` 仍是占位 UUID，即使传了 database name 也会请求占位 database id 并失败。
  证据：占位配置下 `wrangler d1 info template_marketplace_preview` 请求 `/d1/database/00000000-0000-0000-0000-000000000000` 并返回 `database ... could not be found [code: 7404]`；改用 `wrangler d1 list` 找到真实 UUID 后更新 `wrangler.toml`，远端 migration/seed 均成功。

- 观察：R2 preview bucket 已能写入和读回 3 个 `template.json` 对象，但 `wrangler r2 bucket info` 的 `object_count` / `bucket_size` 在本次写入后仍显示 `0`，不能作为当前最小验收依据。
  证据：`npm run -w @dev-session-canvas/template-marketplace r2:verify:preview` 使用 `wrangler r2 object get` 分别读回 `templates/tmpl-getting-started/versions/1/template.json`、`templates/tmpl-review-loop/versions/1/template.json` 和 `templates/tmpl-release-readiness/versions/1/template.json`，并验证 size / sha256 分别为 `1497 / 031e1f...0a7e`、`1897 / 005e90...4e92`、`2045 / e63a9f...bef0`；随后单独执行 `wrangler r2 bucket info template-marketplace-preview` 仍输出 `object_count: 0`、`bucket_size: 0 B`。

- 观察：浏览器构建使用 `/templates/` base path，但 Workers Static Assets 的文件实际在 `dist/web/assets/`；如果不在 Worker 入口重写，`/templates/assets/...` 在 workers.dev 和未来自定义路径下都可能找不到真实 asset 文件。
  证据：Vite build 输出 `dist/web/assets/index-...js`，`dist/web/index.html` 引用 `/templates/assets/index-...js`；入口测试现在覆盖 `/templates/assets/index.js` 被重写为 `/assets/index.js`。

- 观察：首次部署时 Cloudflare account 还没有 workers.dev subdomain，因此 `wrangler deploy` 不能发布可访问的 `*.workers.dev` URL。
  证据：首次 `deploy:preview` 输出 bindings 和上传成功后提示 `You need to register a workers.dev subdomain before publishing to workers.dev`；用户确认 `wzy0304.workers.dev` 后再次部署成功，Wrangler 输出 `https://dscanvas-template-marketplace.wzy0304.workers.dev`。

- 观察：当前执行环境访问 workers.dev HTTPS 会超时，不能用本机 `curl` 完成 HTTP 端到端验收。
  证据：`curl --max-time 20 https://dscanvas-template-marketplace.wzy0304.workers.dev/api/v1/templates/review-loop/download` 20 秒无响应后退出 code 28；`curl --noproxy '*'` 直连同一地址也在连接阶段超时。用户此前已能在浏览器打开 workers.dev 页面，因此该问题更像当前 shell 网络/代理限制，不作为 Worker 已部署与 R2 对象已写入的反证。

- 观察：Cloudflare Workers Static Assets 的 SPA fallback 会影响浏览器地址栏直接打开 API 路径的 HTML navigation 请求；即使 Web app 内部 fetch `/api/v1/templates` 能命中 Worker，直接访问 `/api/v1/templates/review-loop/download` 仍可能返回 SPA 页面。
  证据：用户截图中地址栏为 `https://dscanvas-template-marketplace.wzy0304.workers.dev/api/v1/templates/review-loop/download`，页面内容却是模板市场 SPA，并且页面内仍显示 `Worker API Storage: D1`。这说明普通 API fetch 可用，但 HTML navigation 请求被 Static Assets 的 single-page fallback 接管。

- 观察：只把 `/api/*` 设为 Worker 优先路由还不够；根路径或 `/templates` 页面加载到 `index.html` 后，Vite 生成的 `/templates/assets/...` 资源请求仍可能被 Static Assets 先处理，而不是进入 Worker 的 `/templates` 路径重写。
  证据：用户刷新 workers.dev 根路径后页面空白，地址栏仍为 preview 根域名；当前 Vite `index.html` 引用 `/templates/assets/...`，而真实上传的资产路径是 `/assets/...`。因此 `/templates` 和 `/templates/*` 也必须加入 `run_worker_first`。

- 观察：`/templates` 资源重写修复部署后，preview 根路径已经能正常加载浏览器市场页面与卡片级下载入口。
  证据：用户截图显示 `https://dscanvas-template-marketplace.wzy0304.workers.dev` 正常渲染 3 张模板卡片，并且每张卡片底部都有 `Download` 按钮。

- 观察：`run_worker_first = ["/api/*"]` 部署后，浏览器地址栏直访下载端点已能触发 attachment 下载。
  证据：用户截图中的浏览器下载列表显示 `tmpl-review-loop-v1.json`，对应地址仍是 `/api/v1/templates/review-loop/download`。

- 观察：VSCode 1.80 扩展宿主不应假设全局 `fetch` 一定可用，因此扩展端市场安装 client 使用 Node `http` / `https` 模块发起详情与下载请求。
  证据：`package.json` 的 `engines.vscode` 仍是 `^1.80.0`；`TemplateMarketplaceClient` 没有依赖浏览器 fetch，而是用 Node 请求模块并保留 5MB 下载上限、30 秒超时和最多 3 次重定向。

- 观察：在 Remote SSH 场景里，浏览器和 VSCode Webview 能打开 workers.dev，但 workspace extension host 所在远端机器不一定能访问同一个 workers.dev 地址。
  证据：用户截图显示点击 Web 安装后 VSCode URI handler 已显示确认弹窗；本机同一远端环境下 `node:https` 直连 `https://dscanvas-template-marketplace.wzy0304.workers.dev/api/v1/templates/review-loop` 报 `ETIMEDOUT`，通过当前 `HTTPS_PROXY` 执行 `curl -v` 时也卡在 HTTP CONNECT 阶段。当前缓解已收敛为外部 URI 打开插件内详情页并预选模板 / 版本，详情页再通过受控 Webview message bridge 把下载到的模板 payload 交给 Extension Host 安装，避免外部 URI 携带 payload。

- 观察：插件内 Webview 的 DOM 可以加载本地 HTML，但从 `vscode-webview://...` origin 直接 `fetch` workers.dev API 会被浏览器安全模型当作跨源请求处理；如果 Worker 没有返回 CORS 响应头，Webview 只会暴露 `Failed to fetch`。
  证据：用户截图显示 Webview 面板标题、搜索框和排序控件都已渲染，状态行显示 `加载失败：Failed to fetch`；本轮在 Hono 测试中增加 `Origin: vscode-webview://dev-session-canvas` 的 OPTIONS preflight，期望 204 且 `access-control-allow-origin: *`，并确认列表和下载响应也带 CORS / exposed headers。

- 观察：CORS 修复部署后，插件内 Webview 匿名浏览和 payload 安装主路径已经通过真实 VSCode 宿主人工 smoke。
  证据：用户截图显示“模板市场”Webview 内 3 张模板卡片正常渲染，状态行显示“已安装模板：Getting Started Canvas v1”；用户同时确认点击安装按钮后模板安装成功。

- 观察：Wrangler 对已声明但远端不可见的新增 R2 key 执行 `object put --force` 后，立即 `object get` 仍可能返回 key 不存在；先执行一次 `object delete` 再 `object put` 后对象可被稳定读回。
  证据：`thumbnail.png` 首次上传后 `r2:verify:preview` 在 `templates/tmpl-getting-started/versions/1/thumbnail.png` 返回 `The specified key does not exist`；将 `seed-preview-r2.mjs` 改为 delete-then-put 后，8 个 manifest 对象均通过 `r2:verify:preview` 的 size / sha256 校验。

- 观察：`npm run test:canvas-templates` 里存在面向源码结构的市场 URI handler 断言，旧断言会把“外部 URI 安装链路返回 `result.operation`”当成必需行为。
  证据：详情确认流改完后第一次运行该脚本报 `AssertionError`，期望 `result.operation === 'updated'`；本轮已把断言改为检查 `templateMarketplacePanel.openTemplateDetailFromUri(uri)`、`marketplace/openTemplateDetail` 和详情页相关 DOM 字符串，测试随后通过。

- 观察：D1 `templates.latest_version_id` 只是版本 id 指针，公开查询不能只校验指针目标是 published，还必须校验该版本属于当前模板。
  证据：最新 review 指出如果 `latest_published_version` join 缺少 `template_id = t.id`，一个模板可以把 latest 指向另一个模板的 published version，列表、详情和默认下载都会混入错误对象；本轮在 `repository.test.ts` 增加跨模板 pointer 假库，只有 SQL 同时包含 `latest_published_version.template_id = t.id`、`v.template_id = t.id` 和 `v.status = 'published'` 时才返回当前模板 v1，`npm run test:marketplace-api` 已覆盖该回归。

- 观察：插件内详情页存在历史版本预选时，详情页右侧所有版本相关 UI 必须共享同一个 resolved version，而不能让操作使用 v1、校验信息仍展示 latest v2。
  证据：review 指出安装/下载历史版本时完整性面板仍显示 `template.latestVersion.sha256`；本轮改为在 `buildDetailShell()` 中解析 `selectedVersion`，安装、下载、版本历史“当前”状态和 sha256 都使用该对象，并通过 `npm run test:canvas-templates` 的源码断言防止回退。

- 观察：模板市场 workspace 已经不再只是独立预览脚本，默认回归入口需要覆盖 shared / Worker / Web 和 marketplace 类型检查，否则 reviewer 单独跑过的市场回归不会被后续 `npm test` 自动覆盖。
  证据：review follow-up 指出根 `npm test` 未包含 `test:marketplace-shared`、`test:marketplace-api`、`test:marketplace-web` 或 `typecheck:marketplace`；本轮新增 `test:marketplace` 聚合并串入根 `test`，同时在 `scripts/test-canvas-templates.mjs` 中断言该聚合和根入口关系。

- 观察：外部安装 URI 的 `source` 不能只在 URI handler 入口被校验，还必须贯穿插件内详情页的 API origin、浏览器回跳和 sidecar 元数据，否则从正式 `https://dscanvas.dev/templates` 进入后仍会漂回 preview workers.dev。
  证据：review 指出 Web 端已写入当前市场详情页 `source`，但 `CanvasTemplateMarketplacePanel` 当时仍硬编码 preview origin；本轮把 `sourceUrl` 加入 `MarketplaceTemplateDetailRequest`，Webview 收到详情请求后用 `setMarketplaceSourceUrl()` 切换 origin，并通过 `buildTemplateSourceUrl()` 写入安装 payload 的 `sourceUrl`。

- 观察：把外部安装 `source` 贯穿到 Webview 后，控制器不能把该 source 作为长期默认来源保存给命令入口。
  证据：review 指出如果 `openTemplateDetailFromUri()` 把控制器级 `marketplaceSourceUrl` 改成正式域名，随后 `devSessionCanvas.openTemplateMarketplace` 只调用 `reveal()` 就会继续打开正式来源；本轮让 `reveal()` 显式复位 `defaultMarketplaceSourceUrl` 并发送 `marketplace/openTemplateIndex`，而外部详情路径改用 `revealPanel()` + `postOpenTemplateDetail()` 保留临时来源。

- 观察：默认来源不能固定写死为 preview；它必须跟扩展安装模式绑定，否则正式安装的插件会打开调试市场，调试安装的插件也可能被正式链接带到生产市场。
  证据：本轮把默认来源收口到 `resolveDefaultMarketplaceSourceUrl(extensionMode)`，`ExtensionMode.Production` 使用正式入口，`ExtensionMode.Development` / `ExtensionMode.Test` 使用调试入口；`resolveCompatibleMarketplaceSourceUrl()` 对外部 `source` 做同模式校验，正式 / 调试互相不自动切换。

- 观察：Webview CSP 必须与 trusted debug source 使用同一组本地来源，否则调试来源校验通过后仍会在详情请求或缩略图加载阶段失败。
  证据：review 指出 `[::1]` 已被 source 校验接受但不在 `connect-src`，并且 `img-src https: data:` 会拦截本地 HTTP thumbnail；本轮抽出 `MARKETPLACE_LOCAL_DEVELOPMENT_SOURCES` 同时用于 `connect-src` 和 `img-src`。

## 决策记录

- 决策：本轮先交付模板市场基础工程和只读浏览 API，不在同一轮完成 D1/R2 持久化、OAuth、VSCode 安装落盘和治理后台。
  理由：用户刚开始准备账号和域名，真实云资源尚不可用；先用共享合约和内存种子数据把 app/worker/test/build 骨架打通，可以让后续 D1/R2/OAuth 接入在稳定边界上迭代，避免一次性引入过多未知变量。
  日期/作者：2026-05-10 / Codex

- 决策：浏览器正式路径从第一天就按 `/templates/` base path 配置，API 继续使用设计文档确认的 `/api/v1` 前缀。
  理由：用户已确认正式入口计划为 `https://dscanvas.dev/templates`，因此前端路由和构建产物必须尽早适配子路径；API 前缀暂不移动到 `/templates/api/v1`，避免和已确认设计文档冲突。
  日期/作者：2026-05-10 / Codex

- 决策：本轮使用 seed repository 作为 D1/R2 接入前的开发数据源，并在 API 响应中显式返回 `storageMode: "seed"`；该策略在 2026-06-23 后仅保留为开发/测试/调试 fixture，不再作为生产无 D1 默认内容。
  理由：账号和云资源尚未准备完成，内存种子数据能验证 API 合约和前端集成，同时通过显式 storage mode 避免把模拟数据误认作生产持久化。
  日期/作者：2026-05-10 / Codex

- 决策：市场工具链使用 Vite 7.3.3、Vitest 3.2.4、Wrangler 4.90.0，而不是最初解析到的 Vite 5 / Vitest 1 / Wrangler 3。
  理由：较新组合满足当前 Node 25 环境，能消除 npm audit 中的 dev 依赖漏洞；根 `npm audit` 已验证为 0 个漏洞。
  日期/作者：2026-05-10 / Codex

- 决策：D1 接入先以 Drizzle schema、手写 D1 SQL migration 和只读 repository 边界落地，不在同一轮加入真实 R2 对象读取、OAuth 写入接口或管理后台。
  理由：用户要求以 Phase 4 为目标，因此 schema 必须覆盖版本、互动、统计、举报和审计；但云端账号、OAuth 回调和 R2 对象尚未准备，先把 D1 元数据模型和 public read path 接到 Worker，可以独立验证数据边界且不阻塞后续云资源申请。
  日期/作者：2026-05-10 / Codex

- 决策：Worker 最初通过 `createTemplateRepository(database?)` 选择 D1 或 seed repository，未绑定 `MARKETPLACE_DB` 时返回 `storageMode: "seed"`，绑定存在时返回 `storageMode: "d1"`；该决策已被 2026-06-23 的生产 empty 默认取代。
  理由：这曾让本地开发、CI 和 `*.workers.dev` 预览在 D1 未配置时继续运行，同时真实 D1 binding 一接入就能走同一套 API 合约；但后续确认官方模板必须走正常发布流程，不能把代码内 seed 当成生产市场内容。
  日期/作者：2026-05-10 / Codex；2026-06-23 标记为被取代 / Codex

- 决策：生产 Worker 使用 `createProductionTemplateRepository(database?)` 选择 repository；存在 `MARKETPLACE_DB` 时读取 D1，缺少 D1 时返回 `EmptyTemplateRepository` 和 `storageMode: "empty"`。只有 `MARKETPLACE_ENABLE_SEED_TEMPLATES=true` 时，`createMarketplaceRepository()` 才允许进入 `createTemplateRepository()` 的 seed fallback。Web API client 同步采用生产 empty fallback，只有 Vite dev 或 `VITE_MARKETPLACE_ENABLE_SEED_FALLBACK=true` 才使用共享 seed 数据。
  理由：模板市场正式环境必须是干净目录，官方模板也要通过正常发布流程写入 D1/R2，而不是由代码内置 seed 管理；保留显式 seed 开关可以继续支持本地开发、调试和测试预览，不会把 fixture 冒充生产内容。
  日期/作者：2026-06-23 / Codex

- 决策：D1 public repository 只读取 `published` 模板和 `published` 版本；下架、驳回和管理员治理视角后续通过独立 admin API 实现。
  理由：当前 API 是匿名公开浏览和下载路径，不能因为 D1 中保留治理状态就泄漏下架模板或 rejected 版本；Phase 4 的管理后台需要更强权限边界和审计日志，不能复用公开详情路由绕过权限。
  日期/作者：2026-05-10 / Codex

- 决策：`@dev-session-canvas/marketplace-shared` 根入口保持浏览器安全，只导出 API 类型、Zod schema、seed 数据和纯函数；Drizzle schema 通过 `@dev-session-canvas/marketplace-shared/schema` 子路径导出。
  理由：浏览器市场需要导入共享 API 类型和开发/调试 seed fallback，但不应该携带 Drizzle runtime；子路径导出仍让 Worker、迁移和测试可以复用 schema，同时避免 Web bundle 膨胀。当前 workspace 仍使用 TypeScript `moduleResolution: "Node"`，因此 package 还需要 `typesVersions.schema` 才能被跨包类型检查解析。
  日期/作者：2026-05-10 / Codex

- 决策：preview seed 使用单独的 `apps/template-marketplace/seeds/0001_preview_templates.sql`，通过 upsert 写入官方模板元数据，不把 seed 数据混入 schema migration。
  理由：migration 只负责建表，应该能安全地在空库和已有数据的库上重复执行；seed 是环境初始化数据，后续可按 preview/production 不同策略执行。upsert 让 `db:seed:preview` 可重复运行，便于同步官方 seed 模板的展示字段。
  日期/作者：2026-05-10 / Codex

- 决策：Worker 入口对 `/templates` 和 `/templates/*` 静态资源请求做路径重写，API 继续保持 `/api/v1` 不变。
  理由：浏览器正式入口计划是 `dscanvas.dev/templates`，Vite bundle 必须使用 `/templates/` base path；Cloudflare Assets 仍按构建产物目录保存文件，因此只重写静态 asset 请求可以同时支持 workers.dev 预览和未来自定义域名路径，而不改变已确认的 API 前缀。
  日期/作者：2026-05-10 / Codex

- 决策：在 `wrangler.toml` 显式设置 `workers_dev = true` 和 `preview_urls = true`。
  理由：Wrangler 默认启用这两个选项时会给 warning；显式写入配置让 preview 部署意图可追踪，也避免后续协作者误以为线上 workers.dev 触发器是临时 CLI 默认行为。
  日期/作者：2026-05-10 / Codex

- 决策：`GET /api/v1/templates/:id/download` 在存在 `TEMPLATE_BUCKET` binding 时直接返回 R2 中的 `template.json` attachment；没有 R2 binding 时才返回包含 `objectKey`、`sha256` 和 `sizeBytes` 的 metadata JSON。
  理由：正式产品语义是“下载模板文件”，而不是只暴露内部对象 key；保留 metadata JSON 降级路径可以让本地测试、显式 seed fallback 和未配置 R2 的开发环境继续工作，同时通过 `x-marketplace-storage-mode: r2` 和 `x-marketplace-catalog-storage-mode` 响应头区分真实对象来源与 D1/seed/empty 元数据来源。
  日期/作者：2026-05-10 / Codex

- 决策：Workers Static Assets 保持 `not_found_handling = "single-page-application"`，但同时配置 `run_worker_first = ["/api/*", "/templates", "/templates/*"]`。
  理由：浏览器页面需要 SPA fallback 支持 `/templates` 子路径和未来详情页刷新；API 路径则必须始终由 Worker 处理，否则直接在地址栏打开下载端点时会被资产层当作 HTML fallback 返回 `index.html`。同时 Vite bundle 使用 `/templates/` base path，真实上传的 asset key 仍在 `/assets/...`，因此 `/templates/assets/...` 也必须先进入 Worker 才能被重写。
  日期/作者：2026-05-10 / Codex

- 决策：浏览器安装入口继续使用 VSCode extension URI deep link；外部 URI 打开插件内模板详情页并继续安装动作。
  理由：浏览器没有本地文件系统权限，也不应把 inline payload 放进外部 URI；`vscode://devsessioncanvas.dev-session-canvas/install-template` 现在只把模板 slug、版本 id 和来源带回已安装的扩展，由扩展打开 VSCode Webview 内详情页。用户在详情页再次点击安装后，受控 Webview 才从市场 API 下载模板 JSON 并通过 message bridge 交给 Extension Host 校验和落盘。
  日期/作者：2026-05-10，2026-05-12 更新 / Codex

- 决策：市场安装后的本地来源信息写入相邻 `*.market.json` sidecar，不把市场字段写进 `CanvasTemplateDocument` 主体，也不新增 `market` category。
  理由：模板主体需要保持现有本地模板格式，确保离线可用和可手动分享；sidecar 可支持侧栏来源标记、后续更新检查和回滚，同时模板目录扫描明确忽略 sidecar，避免把元数据文件当作损坏模板。
  日期/作者：2026-05-10 / Codex

- 决策：废弃浏览器把小模板 JSON 内联进外部 VSCode URI 的预览路径，inline payload 只允许从受控插件内 Webview message bridge 进入安装。
  理由：外部 URI 携带 payload 会混淆“浏览器唤起 VSCode”和“确认安装”两个阶段，也会让用户在未看到 VSCode 内详情页前触发本地写入。当前方案用外部 URI 打开插件内详情页，再由详情页下载模板 JSON 并通过 message bridge 交给 Extension Host，可以同时保留 Remote SSH 场景下的 Webview 下载优势和安装确认步骤。
  日期/作者：2026-05-10 初版，2026-05-12 更新 / Codex

- 决策：市场页 UI 按宿主拆分主题来源：浏览器互联网网站使用 `Light 2026` / `Dark 2026` 两套市场 CSS 变量，VSCode 插件内市场面板只使用当前 `--vscode-*` Color Theme token 与 token 派生的 `color-mix`。
  理由：浏览器端需要完整浅色/深色公开站点视觉，但 VSCode Webview 的可读性和一致性必须服从用户当前工作台主题；把两者都收口到角色 token，可以共享信息结构，同时避免把公网主题色误带进插件内面板。
  日期/作者：2026-05-10 / Codex

- 决策：浏览器市场页的视觉参考不再是独立品牌 landing，而是 Visual Studio Marketplace 的产品市场布局；插件内市场页不使用公网市场的 hero 结构，而使用紧凑 VSCode Webview 工具面板结构。
  理由：用户截图显示原网站与 VSCode Marketplace 风格差异过大，插件内市场也因背景渐变、大标题、胶囊按钮和大圆角卡片显得不像 VSCode 原生面板。收敛到矩形搜索、矩形卡片、小圆角控件和主题 token 能同时降低视觉漂移并提升 VSCode Color Theme 适配一致性。
  日期/作者：2026-05-10 / Codex

- 决策：匿名公开 API `/api/v1/*` 对 GET / OPTIONS 启用 CORS `origin: *`，并只暴露下载所需的市场元数据响应头；认证、上传和管理写接口后续不能直接复用这个宽松策略。
  理由：浏览器市场页、未来自定义域名、workers.dev preview 和 VSCode Webview 都需要读取同一组公开列表、详情和下载接口；这些端点本身不依赖 cookie 或 token，允许跨源读取不会扩大当前匿名能力。把方法限定为 GET / OPTIONS、headers 限定为 `accept` / `content-type`，可以避免把后续 GitHub OAuth、发布、点赞、举报或管理员接口误暴露成同一 CORS 策略。
  日期/作者：2026-05-10 / Codex

- 决策：插件内模板市场不提供“应用到 Canvas”动作，只支持浏览、下载、安装、更新提示和已安装状态回显；已安装模板继续通过侧栏模板列表应用到 Canvas。
  理由：侧栏已安装模板本身已经提供应用到 Canvas 的能力；在市场卡片上重复放置应用入口会扩大 UI 概念面，让“发现/安装”和“使用已安装模板”两个任务混在一起。
  日期/作者：2026-05-10 / Codex

- 决策：同一市场模板在同一安装位置重复安装或更新时覆盖原有本地副本，不创建第二份模板；首次安装到某个位置时生成本地唯一模板 id，覆盖时保留该本地模板 id 和创建时间，只更新模板内容与 sidecar 版本元数据。
  理由：用户把市场模板视为同一个可更新资产，而不是每次下载得到一个新模板；保留同位置本地 id 能避免默认模板引用和侧栏选择状态因版本更新而失效，首次安装生成本地唯一 id 则能让本地和 workspace 的同一市场模板成为两个可被侧栏操作精确命中的独立副本。
  日期/作者：2026-05-10 / Codex

- 决策：插件内市场 Webview 在市场 API 不可达时保留本地已安装模板状态，并只把远端模板列表标记为不可刷新。
  理由：已安装模板来自本地 catalog / sidecar，不依赖 workers.dev；网络异常不应让用户误以为模板库为空，也不应阻断从侧栏继续使用已经安装的模板。
  日期/作者：2026-05-10 / Codex

- 决策：插件内市场卡片的安装入口采用 split button，主按钮只处理最新版本的安装/更新，下拉菜单用于安装任意已发布版本。
  理由：这复用 VSCode 插件市场的更新心智；用户无需先找到旧包手动落盘，就可以先安装历史版本再验证更新，也可以在后续需要时手动回滚到历史版本。
  日期/作者：2026-05-10 / Codex

- 决策：插件内市场卡片的下载入口同样采用 split button，主按钮下载最新版本，下拉菜单用于下载任意已发布版本。
  理由：下载和安装应使用一致的版本选择心智；用户可以获取旧版本 JSON，用于对比、归档或手动排查更新问题。
  日期/作者：2026-05-10 / Codex

## 结果与复盘

本轮已经交付模板市场基础工程：新增 `packages/marketplace-shared/` 共享合约与 seed repository，新增 `apps/template-marketplace/` React + Vite 浏览器应用和 Hono Worker API，并在根 `package.json` 中补齐 `build:marketplace`、`test:marketplace`、`test:marketplace-shared`、`test:marketplace-api`、`test:marketplace-web` 与 `typecheck:marketplace` 脚本；其中 `test:marketplace` 已纳入根 `npm test` 默认回归入口。浏览器构建使用 `/templates/` base path，Worker API 暴露 `/api/v1/health`、`/api/v1/templates`、`/api/v1/templates/:id`、`/api/v1/templates/:id/download` 和 `/api/v1/templates/:id/thumbnail`。2026-06-23 后，seed repository 明确只作为开发、测试和调试 fixture；生产缺少 D1 时应返回 empty repository，不展示代码内置模板。

本轮续做已经把 D1 元数据模型推进到可验证边界：`packages/marketplace-shared/src/schema.ts` 定义 Phase 1-4 核心表并通过 `@dev-session-canvas/marketplace-shared/schema` 子路径导出，`apps/template-marketplace/migrations/0001_marketplace_core.sql` 提供 D1 migration，`apps/template-marketplace/src/worker/repository.ts` 让 public list/detail/download API 可以在 D1 binding 存在时读取 D1 元数据。当前 repository contract 是：`createProductionTemplateRepository(database?)` 在无 D1 时返回 `EmptyTemplateRepository` 和 `storageMode: "empty"`；`createTemplateRepository(database?)` 保留 D1/seed 二选一能力，但只应通过 `MARKETPLACE_ENABLE_SEED_TEMPLATES=true` 等显式开发/调试开关进入。

Cloudflare preview 资源也已经接入：`apps/template-marketplace/wrangler.toml` 绑定真实 D1 database id `0944dc87-a603-4a59-8a59-b75ab3a796c5` 和 R2 bucket `template-marketplace-preview`，远端 D1 已执行 migration 和 preview seed，当前包含 3 个官方模板、4 个已发布版本和对应标签/日统计，其中 `review-loop` 的 latest version 已指向 v2。R2 bucket 已写入 4 个真实 `template.json` 对象和 4 个 `thumbnail.png` 对象，并通过 Wrangler 读回校验 size / sha256。

Workers preview 已部署：`apps/template-marketplace/src/worker/index.ts` 现在能把 `/templates/assets/...` 重写到实际 Vite asset 路径，并且 `apps/template-marketplace/package.json` 提供 `deploy:preview`。当前 workers.dev 预览地址是 `https://dscanvas-template-marketplace.wzy0304.workers.dev`，该地址绑定 preview D1、preview R2 和 Static Assets；`/api/*`、`/templates` 和 `/templates/*` 已配置为 Worker 优先路由，避免 API 直访和 `/templates` asset 请求被 SPA fallback 接管。当前版本 ID 为 `ea2fee85-3a1e-465b-bbc0-d1f7b7266cbc`。

用户已用浏览器人工确认 `review-loop` 下载端点会下载 `tmpl-review-loop-v1.json`。这补齐了当前 shell 环境无法 `curl` workers.dev 的端到端验证缺口。

市场页面现在已经有卡片级安装和下载入口：每张模板卡片底部显示 `Install` 和 `JSON`，详情页显示 `Install in VSCode` 和 `Download JSON`。`Install` 会打开 `vscode://devsessioncanvas.dev-session-canvas/install-template?...`，扩展端 URI handler 会先打开 VSCode 插件内详情页并预选对应版本；只有用户在该详情页点击安装后，Webview 才下载模板 JSON 并交给 Extension Host 写入本地模板目录。`JSON` 仍保留浏览器直接下载文件的匿名路径。

用户已在浏览器人工确认 preview 根路径可正常渲染 3 张模板卡片，且卡片级 `Download` 按钮可见。

前端现在支持模板详情独立路径：`/templates/:slug` 会加载 `GET /api/v1/templates/:slug`；API 不可用时，生产构建回退到 empty detail，Vite dev 或 `VITE_MARKETPLACE_ENABLE_SEED_FALLBACK=true` 才回退到 seed detail。详情页包含返回市场、readme、版本历史、统计、sha256 和 `Download JSON`。这仍是浏览器下载文件入口，不是 VSCode 本地安装落盘。

用户已在浏览器人工确认 `review-loop` 详情页正常渲染，详情数据来自 Worker API / D1，详情页的下载入口可见。

下载 API 现在开始写入 D1 统计：只有 R2 `template.json` 对象存在并准备返回真实文件时，Worker 才调用 repository 记录下载。D1 写入范围是模板累计下载数和 `template_daily_stats` 当日下载数；当前还没有版本级下载数字段，也没有去重、防刷或异步事件队列，这些属于后续统计治理增强。

用户已在预览环境人工验证点击下载后可观察到下载量 +1，说明 D1 累计下载计数已经贯通到浏览器页面可见结果。

Web 端现在支持基础标签筛选：列表结果上方展示 tag chips，选中后会把 tag 作为 Worker API 查询参数传给列表接口；显式启用的 seed fallback 也使用同一组 tags 过滤，生产 empty fallback 则返回空结果。当前 tag chips 只从当前可见结果与已选标签生成，后续如果要在筛选后仍显示全量 tag vocabulary，需要 API 增加 facet/metadata 响应。

浏览器端和插件内 Webview 现在都能展示真实缩略图：卡片和详情页会请求 `GET /api/v1/templates/:slug/thumbnail?version=:versionId`，Worker 在 preview 环境从 R2 返回 PNG 并设置公开缓存头；本地无 R2 binding 时返回显式 seed SVG，前端图片加载失败时继续显示原有渐变占位，避免缩略图对象缺失导致卡片空白。用户已确认预览环境能看到 3 张模板卡片和卡片预览图。

VSCode 本地安装主路径已经有代码落点：扩展注册 `onUri`，外部 `vscode://.../install-template` 现在打开插件内模板详情页并预选版本；插件内详情页通过 Webview fetch 下载模板 JSON，再用 message bridge 把受控 inline payload 交给 `TemplateMarketplaceClient` 校验和落盘。安装会通过 `CanvasTemplateStore` 写入所选目标模板目录的 `marketplace/` 子目录与相邻 `*.market.json` sidecar。插件内列表页保留搜索、排序、标题附近的“查看详情”、安装位置预选、“查看并安装 / 查看更新 / 已安装”详情快捷入口和下载入口；这些列表快捷动作以详情页作为执行上下文，安装位置作为详情页默认安装目标，列表下载主按钮和版本菜单也会先进入详情页并预选下载版本。实际安装 split button、下载 split button、版本历史和随选中版本变化的 sha256 位于详情页右侧。workspace 选项文案显示为 `当前workspace · <title>`，避免出现双重前缀。侧栏模板列表用精简组合标签区分 `内置`、`自建 · 本地/工作区`、`市场 · 本地/工作区`，并继续用 cloud download 图标标识市场来源。市场模板首次安装到某个位置时生成本地唯一 id，安装指定版本仍覆盖同一位置下的既有副本并保留该 id / 更新 sidecar，不创建重复模板。模板市场不提供应用入口；安装成功消息会提示用户到模板侧栏应用到 Canvas，已安装模板继续从侧栏模板列表应用。当前已完成本地单元/类型/构建验证、浏览器深链生成验证、插件内 Webview 匿名浏览/安装的真实 VSCode Development Host smoke，以及本轮详情确认流的源码级回归；侧栏离线应用、更新提醒和完整回滚 smoke 仍需后续覆盖。

插件内独立 Webview Editor 市场页也已经有基础实现：命令面板和模板侧栏标题栏都可以触发 `devSessionCanvas.openTemplateMarketplace`，打开 `src/panel/CanvasTemplateMarketplacePanel.ts` 生成的本地 Webview。默认命令入口每次复位到当前扩展安装模式对应的默认市场来源：正式安装使用正式入口，调试 / 测试安装使用 preview / 本地调试来源；如果从浏览器 `vscode://.../install-template?source=...` 进入，扩展端先校验该 `source` 与当前安装模式一致，再让 Webview 在该详情上下文切到可信 `source` 所在 origin，并用同一 origin 完成详情、下载、缩略图、浏览器回跳和 sidecar `sourceUrl`。正式安装遇到调试来源、调试安装遇到正式来源时会报错提醒，不会自动跨环境切换。Webview 不加载远程脚本，也不 iframe 远程站点；Worker `/api/v1/*` 已允许匿名 GET / OPTIONS CORS，解决 Webview 从 `vscode-webview://...` origin 访问公开 API 的浏览器安全限制。用户已在真实 VSCode Extension Development Host 中人工确认 Webview 可加载 3 个模板并完成安装；后续代码补充了已安装状态回显、详情页安装目标选择、安装成功侧栏引导、Webview 状态持久化、网络错误 fallback 和外部 URI 进入详情页，减少重复安装误操作，并保持市场只负责发现与安装。但 UI 仍是基础 HTML shell，后续应收敛到共享 React Webview bundle。

仍未完成的能力是真实 GitHub OAuth、共享 React Webview bundle、完整 VSCode 宿主 smoke（离线应用、更新提醒、回滚等）、发布/点赞/举报写接口、缩略图上传与自动生成发布路径、治理后台、下载去重/防刷和生产环境资源分离；这些是后续里程碑，不是本轮临时绕过造成的技术债。本轮没有向 `docs/exec-plans/tech-debt-tracker.md` 新增技术债。设计文档状态保持为 `validation_status: 验证中`，因为 Phase 1 浏览与安装已在 preview 环境验证通过，但完整 Phase 1-4 尚未验证完成。

## 上下文与定向

当前仓库是一款 VSCode workspace extension，主包位于仓库根目录，扩展入口是 `src/extension.ts`，Webview 入口是 `src/webview/main.tsx`，本地模板模型位于 `src/common/canvasTemplates.ts` 和 `src/panel/CanvasTemplateStore.ts`。模板市场设计已经确认新增两个主要落点：`packages/marketplace-shared/` 作为纯 TypeScript 合约包，`apps/template-marketplace/` 作为浏览器市场和 Cloudflare Worker API 的应用包。

`packages/marketplace-shared/` 不能依赖 `vscode`、React、DOM 或 Cloudflare runtime binding。它只放共享类型、纯函数、种子数据、浏览器安全的 Zod 合约和通过子路径导出的 Drizzle schema。`apps/template-marketplace/src/web/` 是 React + Vite 浏览器 UI，`apps/template-marketplace/src/worker/` 是 Hono Worker API。浏览器正式入口计划为 `https://dscanvas.dev/templates`，所以 browser build 的 base path 是 `/templates/`。API 仍使用 `/api/v1`。

## 工作计划

先更新 workspace 和依赖，让根包识别 `apps/template-marketplace` 与 `packages/marketplace-shared`。随后创建共享包，定义模板摘要、模板详情、版本、发布者、分页、排序、下载响应和错误响应类型，并提供少量内存种子数据。共享包要有独立测试，证明排序、搜索和详情查找是纯函数、可在 Node 测试里重复执行。

接着创建市场应用包。Worker 入口使用 Hono，暴露健康检查、模板列表、模板详情和下载接口。最初没有 D1/R2 binding 时，Worker 通过共享包的 repository 函数读取种子数据，并在响应中明确 `storageMode: "seed"`，避免把模拟数据误写成生产持久化。2026-06-23 后，这一路径收敛为显式开发/调试开关：生产 Worker 无 D1 时必须通过 `createProductionTemplateRepository()` 返回 `EmptyTemplateRepository` 与空目录；只有 `MARKETPLACE_ENABLE_SEED_TEMPLATES=true` 时才允许读取 seed。续做里程碑已经让 Worker 在存在 D1 binding 时读取 D1 公开元数据，在存在 R2 binding 时从 R2 返回真实 `template.json` attachment。Web 入口使用 React + Vite，渲染市场标题、搜索框、排序选择、模板卡片、详情占位和安装按钮；生产 API 不可用时展示 empty fallback，Vite dev 或 `VITE_MARKETPLACE_ENABLE_SEED_FALLBACK=true` 才展示 seed fallback。UI 不接入 VSCode 文件系统，只展示浏览器主路径和 `/templates/` base path 是否生效。

最后补验证脚本。新增 `npm run test:marketplace-shared`、`npm run test:marketplace-api`、`npm run test:marketplace-web`、`npm run typecheck:marketplace` 和 `npm run build:marketplace`；随着 shared / Worker / Web 回归已稳定，本轮又新增 `npm run test:marketplace` 聚合并串入根 `npm test` 默认入口，防止市场 workspace 变更绕过常规回归。preview 云资源脚本单独放在 app workspace 中，D1 用 `db:*:preview`，R2 用 `r2:*:preview`；远端部署、D1/R2 preview 种子和真实 VSCode smoke 仍保留为按需验证，不放进默认 `npm test`。

续做 D1 里程碑时，在共享包中引入 Drizzle schema，并在应用包中新增 D1 SQL migration、repository 接口和 fake D1 测试夹具。Worker 路由不直接散落 SQL，而是只依赖 `MarketplaceTemplateRepository`；R2 里程碑进一步把下载文件响应放在独立 helper 中，让后续下载计数、OAuth 权限和 admin API 可以继续在 repository / service 层扩展，不需要重写已有 public API 路由。

## 具体步骤

在仓库根目录执行以下步骤。第一，修改 `package.json` 的 `workspaces`，加入 `apps/template-marketplace` 和 `packages/marketplace-shared`，并新增市场相关脚本。第二，运行 `npm install` 添加本轮实际使用的 Hono、Zod、Vite、Vitest、Wrangler、Cloudflare Workers 类型、Tailwind、PostCSS、Autoprefixer 和 `drizzle-orm`。Drizzle Kit 暂不引入，因为当前迁移以手写 SQL 固化，后续需要自动生成 migration 时再单独接入并记录验证。第三，创建共享包、市场应用包、D1 schema、migration、repository 边界和 R2 下载 helper。第四，运行目标验证命令。

预期关键命令如下：

    npm install -w @dev-session-canvas/template-marketplace hono
    npm install -w @dev-session-canvas/marketplace-shared zod
    npm install -w @dev-session-canvas/marketplace-shared drizzle-orm
    npm install -D vite@^7.3.3 @vitejs/plugin-react@^5.2.0 vitest@^3.2.4 wrangler@^4.90.0 @cloudflare/workers-types tailwindcss postcss autoprefixer
    npm run test:marketplace-shared
    npm run test:marketplace-api
    npm run test:marketplace-web
    npm run typecheck:marketplace
    npm run build:marketplace
    npm run typecheck
    npm audit
    git diff --check

如果某个新增依赖版本要求更高 Node 或 TypeScript，优先选择与当前仓库 Node 25 / TypeScript 5.0 能工作的版本，并把取舍记录到 `意外与发现`。

D1 schema 里程碑的具体文件是 `packages/marketplace-shared/src/schema.ts`、`apps/template-marketplace/migrations/0001_marketplace_core.sql`、`apps/template-marketplace/src/worker/repository.ts`、`apps/template-marketplace/src/worker/repository.test.ts`、`apps/template-marketplace/src/worker/migration.test.ts` 和 `apps/template-marketplace/src/worker/testD1Database.ts`。`app.ts` 中读取 binding 必须使用 `context.env?.MARKETPLACE_DB`，因为没有 Env 的 Hono 测试仍应稳定进入 production empty 默认；只有测试显式传入 `{ MARKETPLACE_ENABLE_SEED_TEMPLATES: "true" }` 时才应走 seed fallback。

Cloudflare preview 资源准备好后，先用 `wrangler d1 list` 确认真实 UUID，再更新 `apps/template-marketplace/wrangler.toml` 的 `database_id`。随后执行 `npm run -w @dev-session-canvas/template-marketplace db:migrate:preview` 建表，执行 `npm run -w @dev-session-canvas/template-marketplace db:seed:preview` 写入官方 seed 元数据，最后执行 `npm run -w @dev-session-canvas/template-marketplace db:verify:preview` 确认远端 D1 中的模板版本 object key、sha256 和 size。R2 对象通过 `npm run -w @dev-session-canvas/template-marketplace r2:seed:preview` 上传，通过 `npm run -w @dev-session-canvas/template-marketplace r2:verify:preview` 读回并校验摘要。

部署预览时执行 `npm run -w @dev-session-canvas/template-marketplace deploy:preview`。账号已注册 workers.dev 子域名 `wzy0304.workers.dev`，因此预期输出会包含 `https://dscanvas-template-marketplace.wzy0304.workers.dev`。如果未来换账号后再次遇到 onboarding 提示，应先让新账号拥有 workers.dev 子域名，或者在 `wrangler.toml` 配置明确的自定义 route。

## 验证与验收

本轮完成后，以下行为必须可观察：

运行 `npm run test:marketplace-shared`，预期共享包测试通过，证明 seed fixture 的搜索、排序、`empty` storage mode 类型和 `marketplaceSchema` 导出可用。运行 `npm run test:marketplace-api`，预期 Worker API 测试通过，至少覆盖 `GET /api/v1/health`、`GET /api/v1/templates`、`GET /api/v1/templates/:id`、`GET /api/v1/templates/:id/download`、未知模板 404、无 D1 时的 production empty 默认、`MARKETPLACE_ENABLE_SEED_TEMPLATES=true` 显式 seed fallback、D1 repository 映射、D1 binding 路由选择、R2 文件下载、R2 missing object、schema 子路径导出和 migration 核心表。运行 `npm run test:marketplace-web`，预期 Web API client 测试通过，覆盖 Worker API 可用、生产 API 不可用时的 empty fallback，以及 Vite dev 或 `VITE_MARKETPLACE_ENABLE_SEED_FALLBACK=true` 下的 seed fallback。运行 `npm run typecheck:marketplace` 和 `npm run build:marketplace`，预期 Vite browser build、共享包类型检查和 Worker TypeScript 检查通过，并且生成的浏览器 bundle 使用 `/templates/` base path。运行 `npm run typecheck` 和 `npm run build`，预期现有扩展代码和新增 workspace 类型检查/构建不冲突。运行 `npm audit` 和 `git diff --check`，预期无漏洞报告、无空白错误。

## 幂等性与恢复

新增文件和脚本可以重复运行。`npm install` 会更新 `package-lock.json`，如果依赖安装中断，可重新执行同一命令。不要删除现有 `dist/`、`.debug/`、`.vscode-test/` 或用户工作区文件；构建产物应落在 `apps/template-marketplace/dist/` 或包内临时目录，并通过 `.gitignore` 或包配置避免提交生成物。如果实现过程中发现无法在当前依赖版本下稳定运行，不要把半成品标为完成，应在本计划记录阻塞点并保留可回滚的最小变更。

## 证据与备注

当前已确认的环境与分支：

    node -v
    # v25.6.0
    npm -v
    # 11.8.0
    git branch --show-current
    # feat-template-marketplace-foundation

本轮关键验证输出如下：

    npm run test:marketplace-shared
    # Test Files  1 passed (1)
    # Tests  7 passed (7)

    npm run test:marketplace-api
    # Test Files  5 passed (5)
    # Tests  27 passed (27)

    npm run test:marketplace-web
    # Test Files  5 passed (5)
    # Tests  14 passed (14)

    npm run test:canvas-templates
    # 通过，无输出错误

    npm run typecheck:marketplace
    # 通过，无输出错误

    npm run build:marketplace
    # vite v7.3.3 building client environment for production...
    # dist/web/index.html ...
    # built in 2.04s

    grep -n "/templates/assets/" apps/template-marketplace/dist/web/index.html
    # 7: <script ... src="/templates/assets/index-CG19z17j.js"></script>
    # 8: <link ... href="/templates/assets/index-AiUHLA0m.css">

    rg "drizzle:entityKind|SQLiteTable|template_versions|admin_audit_logs" apps/template-marketplace/dist/web/assets
    # 通过，无输出

    npm run typecheck
    # 通过，无输出

    npm run build
    # > dev-session-canvas@0.7.1 build
    # > node scripts/build.mjs

    npm audit
    # found 0 vulnerabilities

    git diff --check
    # 通过，无输出

    npm run -w @dev-session-canvas/template-marketplace db:migrate:preview
    # Processed 23 queries; num_tables: 10

    npm run -w @dev-session-canvas/template-marketplace db:seed:preview
    # Processed 5 queries; rows_written: 35

    npm run -w @dev-session-canvas/template-marketplace db:verify:preview
    # getting-started-canvas => templates/tmpl-getting-started/versions/1/template.json
    # release-readiness => templates/tmpl-release-readiness/versions/1/template.json
    # review-loop => templates/tmpl-review-loop/versions/1/template.json
    # sha256 / size_bytes match the R2 fixture manifest

    npm run -w @dev-session-canvas/template-marketplace r2:seed:preview
    # delete-then-put 完成 4 个 template.json 和 4 个 thumbnail.png 对象

    npm run -w @dev-session-canvas/template-marketplace r2:verify:preview
    # verified templates/tmpl-getting-started/versions/1/template.json 1497 031e1f491c5e7b4b39c3c2a84dcf2d81e9833bad6228e32fa8f710dfccc00a7e
    # verified templates/tmpl-getting-started/versions/1/thumbnail.png 48922 454d6e9225cb01987cbcc0211f54519c359c44adcd42bf1ecb6ae7e6903bccf3
    # verified templates/tmpl-review-loop/versions/1/template.json 1897 005e90644dae8084a612d6a9d2e198508618eaa792648eb19bc56113cbcc4e92
    # verified templates/tmpl-review-loop/versions/1/thumbnail.png 43053 60a83bd7100cbbb8bab14867ce38b837cffddbf57edc42bc5aef34567d8b709c
    # verified templates/tmpl-review-loop/versions/2/template.json 2470 d74f3887ad39c05912629b771635bf8c3e110a498a559ec6b56d8aee390e8ead
    # verified templates/tmpl-review-loop/versions/2/thumbnail.png 53548 3157578492cccc717eb9275fd92ced163acc5ed1c467039d223f0d182329b6fd
    # verified templates/tmpl-release-readiness/versions/1/template.json 2045 e63a9f3666284df207184414a75afb1a86f6536a53668279fe825577a400bef0
    # verified templates/tmpl-release-readiness/versions/1/thumbnail.png 43145 76b80d6197d7847d1cb81db1701e31d9ad7ef3c5cbb9be5f8f5b07f54c920138

    npm run -w @dev-session-canvas/template-marketplace db:seed:preview:v2
    # Processed 2 queries; rows_written: 6

    npm run -w @dev-session-canvas/template-marketplace db:verify:preview
    # review-loop => templates/tmpl-review-loop/versions/2/template.json
    # sha256 d74f3887ad39c05912629b771635bf8c3e110a498a559ec6b56d8aee390e8ead; size_bytes 2470

    npm run -w @dev-session-canvas/template-marketplace deploy:preview
    # Deployed dscanvas-template-marketplace triggers
    # https://dscanvas-template-marketplace.wzy0304.workers.dev
    # Current Version ID: 4e08d963-ed0b-4c75-9274-178b63fb7975

    浏览器人工验证
    # https://dscanvas-template-marketplace.wzy0304.workers.dev/api/v1/templates/review-loop/download
    # 下载列表出现 tmpl-review-loop-v1.json

    VSCode Extension Development Host 人工验证
    # 打开“模板市场”Webview 后 3 个模板卡片正常渲染
    # 点击“安装到 VSCode”后状态行显示“已安装模板：Getting Started Canvas v1”

    npm run test:canvas-templates
    # 通过，无输出错误；包含 Webview 已安装状态回显、本地 / workspace 安装目标选择、安装成功侧栏引导、网络错误 fallback、Webview 状态持久化、workspace 市场 sidecar、同位置市场模板覆盖更新、侧栏市场范围源码断言、插件内下载 JSON 入口，以及市场面板不提供应用到 Canvas 入口的断言

    npm run typecheck
    # 通过，无输出错误

    npm run build
    # > dev-session-canvas@0.7.1 build
    # > node scripts/build.mjs

    npm run test:package-vsix-command
    # package-vsix command tests passed

    wrangler r2 bucket info template-marketplace-preview
    # object_count: 0
    # bucket_size: 0 B
    # 注意：该聚合输出与 object get 校验不一致，当前不作为 R2 seed 验收依据。

    npm audit
    # found 0 vulnerabilities

    git diff --check
    # 通过，无输出

PR #196 review 修复后，重新确认生产 empty / 显式 seed fallback 相关验证：

    npm run -w @dev-session-canvas/template-marketplace typecheck
    # 通过，无输出错误

    npm run -w @dev-session-canvas/template-marketplace test:api
    # Test Files  5 passed (5)
    # Tests  92 passed (92)

    npm run -w @dev-session-canvas/template-marketplace test:web
    # Test Files  6 passed (6)
    # Tests  43 passed (43)

    npm run -w @dev-session-canvas/marketplace-shared test
    # Test Files  2 passed (2)
    # Tests  28 passed (28)

    npm run -w @dev-session-canvas/marketplace-shared typecheck
    # 通过，无输出错误

    npm run build:marketplace
    # vite v7.3.3 building client environment for production...
    # dist/web/assets/index-IH5vbkZv.js 307.30 kB
    # built in 3.17s

    npm run test:marketplace-vscode-preview-preflight
    # template marketplace preview preflight classification passed

    git diff --check
    # 通过，无输出

## 接口与依赖

`packages/marketplace-shared/src/index.ts` 必须导出市场 API 类型和纯函数。核心类型包括 `MarketplaceTemplateSummary`、`MarketplaceTemplateDetail`、`MarketplaceTemplateVersion`、`MarketplacePublisherSummary`、`MarketplaceListTemplatesRequest`、`MarketplaceListTemplatesResponse`、`MarketplaceDownloadResponse` 和 `MarketplaceApiError`。核心函数包括 `listSeedTemplates(query)`、`getSeedTemplateDetail(templateId)`、`buildSeedDownloadResponse(templateId, versionId?)` 和 `calculateHotScore(downloadCount, likeCount, updatedAt)`。`packages/marketplace-shared/src/schema.ts` 必须通过 package export 子路径 `./schema` 暴露 `marketplaceSchema`，并在 `typesVersions.schema` 中暴露同一类型入口；不要从根入口 re-export Drizzle schema。

`apps/template-marketplace/src/worker/app.ts` 必须导出 `createMarketplaceWorkerApp()`，返回一个 Hono app，测试可以直接调用 `app.request(...)`。`apps/template-marketplace/src/worker/index.ts` 必须默认导出 Cloudflare Worker fetch handler。`apps/template-marketplace/src/worker/repository.ts` 必须导出 `MarketplaceTemplateRepository`、`EmptyTemplateRepository`、`SeedTemplateRepository`、`D1TemplateRepository`、`createTemplateRepository(database?)` 和 `createProductionTemplateRepository(database?)`。其中 D1 public repository 只读取 published 模板/版本；`createProductionTemplateRepository()` 无 binding 时必须返回 `storageMode: "empty"`；`createTemplateRepository()` 的无 binding seed fallback 仅供 `MARKETPLACE_ENABLE_SEED_TEMPLATES=true`、本地开发、调试和测试使用，不能作为生产默认行为。

`apps/template-marketplace/src/web/App.tsx` 必须渲染一个无需认证即可使用的浏览页面。它可以先调用 `/api/v1/templates`；API 不可用时，生产构建必须展示 `empty-fallback` 空目录，只有 Vite dev 或 `VITE_MARKETPLACE_ENABLE_SEED_FALLBACK=true` 才展示本地 seed fallback。任何 seed fallback 都必须显式标注为开发/调试模式，不能冒充生产数据。

## 修订记录

- 2026-06-23 23:08 +0800 / Codex：按 PR #196 review 同步 active ExecPlan 的 seed fallback 合同，原因是生产模板市场已改为无 D1 默认 empty，seed/preview 模板只允许开发、测试和调试开关显式启用。
- 2026-05-13 17:43 +0800 / Codex：补充 Webview CSP 本地调试来源收口，原因是 review 指出 `[::1]` 与本地 HTTP thumbnail 已在 trusted debug source 范围内但未被 CSP 放行。
- 2026-05-13 16:44 +0800 / Codex：补充默认来源按扩展安装模式选择、外部 `source` 按模式校验的收口，原因是用户确认正式安装应打开正式入口、调试安装应打开调试入口，并且跨环境链接必须报错。
- 2026-05-13 15:54 +0800 / Codex：补充默认入口 source 复位收口，原因是 review 指出上一次外部来源会粘住命令入口，与固定默认入口语义冲突。
- 2026-05-13 14:25 +0800 / Codex：补充外部安装来源贯穿插件内详情页的收口，原因是 review 指出正式入口进入后仍会漂回 preview origin。
- 2026-05-13 07:58 +0800 / Codex：补充 marketplace 默认回归入口收口，原因是 review follow-up 指出根 `npm test` 未覆盖新增 workspace 的类型检查和单元测试。
- 2026-05-13 07:21 +0800 / Codex：补充最新 review 修复与验证结果，原因是 D1 latest 指针同模板约束、插件内详情页选中版本校验展示和本地 / workspace 安装目录文档口径已完成收口。

- 2026-05-10 04:59 +0800 / Codex：补充 D1/Drizzle schema、migration、repository 边界和相关验证结果，原因是模板市场基础工程已从 seed-only 继续推进到 D1 只读元数据里程碑。
- 2026-05-10 05:02 +0800 / Codex：补充最终验证命令和结果，原因是本轮 D1 里程碑已完成本地测试、类型检查、构建、审计和空白检查。
- 2026-05-10 05:05 +0800 / Codex：补充共享包 schema 子路径导出决策，原因是需要防止 Drizzle runtime 被浏览器市场 bundle 引入。
- 2026-05-10 05:08 +0800 / Codex：刷新最终验证证据，原因是 schema 子路径导出和 EOF 空行修复后已重新完成验证。
- 2026-05-10 09:47 +0800 / Codex：补充 Cloudflare preview D1/R2 初始化、preview seed 脚本和远端验证证据，原因是用户已创建调试资源并提供资源名称。
- 2026-05-10 09:59 +0800 / Codex：补充 workers.dev preview 部署准备和当前 subdomain onboarding 阻塞，原因是代码已能构建和上传但账号还没有 workers.dev 子域名。
- 2026-05-10 10:11 +0800 / Codex：更新 workers.dev 部署结果，原因是用户确认 `wzy0304.workers.dev` 后 preview Worker 已成功部署。
- 2026-05-10 12:00 +0800 / Codex：补充 R2 template object seed、下载接口、远端 R2 摘要校验和最新 preview 部署结果，原因是模板市场下载主路径已从 metadata 推进到真实 R2 文件响应。
- 2026-05-10 12:03 +0800 / Codex：补充 Static Assets `/api/*` Worker 优先路由修复和重新部署结果，原因是用户截图显示 API 下载直访被 SPA fallback 接管。
- 2026-05-10 12:19 +0800 / Codex：补充用户浏览器人工下载验证证据，原因是本机 shell `curl` 受网络/代理限制，而用户已确认真实浏览器下载成功。
- 2026-05-10 12:35 +0800 / Codex：补充页面卡片下载入口和最新 preview 部署结果，原因是下载 API 已验证后需要给用户可点击入口。
- 2026-05-10 12:40 +0800 / Codex：补充 `/templates` 与 `/templates/*` Worker 优先路由修复，原因是用户截图显示根路径页面空白，Vite `/templates/assets/...` 资源仍可能被 Static Assets asset-first 路由接管。
- 2026-05-10 12:47 +0800 / Codex：补充 preview 根路径与卡片下载按钮的用户人工验证证据，原因是最新部署已恢复浏览器页面渲染。
- 2026-05-10 13:01 +0800 / Codex：补充模板详情独立路径、详情视图和最新 preview 部署结果，原因是 Phase 1 浏览安装验收需要可分享的模板详情页。
- 2026-05-10 13:09 +0800 / Codex：补充用户浏览器人工详情页验证证据，原因是 `review-loop` 详情页已在 workers.dev 预览中正常渲染。
- 2026-05-10 13:17 +0800 / Codex：补充下载计数写入和最新 preview 部署结果，原因是真实 R2 下载主路径已开始更新 D1 累计与日统计。
- 2026-05-10 13:27 +0800 / Codex：补充用户浏览器下载计数 +1 人工验证证据，原因是预览环境已确认真实下载会更新页面可见统计。
- 2026-05-10 13:33 +0800 / Codex：补充 Web 标签筛选交互和最新 preview 部署结果，原因是 Phase 1 浏览验收需要支持标签过滤。
- 2026-05-10 13:50 +0800 / Codex：补充 Web 唤起 VSCode 安装、扩展 URI handler、本地 sidecar 和侧栏市场来源标记，原因是 Phase 1 剩余主路径需要从“下载 JSON”推进到“安装到本地模板目录”。
- 2026-05-10 13:54 +0800 / Codex：刷新完整验证命令和 workers.dev 版本 ID，原因是 VSCode 安装入口已构建并重新部署到预览环境。
- 2026-05-10 14:10 +0800 / Codex：补充浏览器安装提示和小模板 payload fallback，原因是用户截图确认 URI handler 已唤起但 Remote SSH extension host 可能卡在 workers.dev 网络访问。
- 2026-05-10 14:12 +0800 / Codex：刷新 payload fallback 后的验证结果和 workers.dev 版本 ID，原因是安装入口已重新构建部署。
- 2026-05-10 14:28 +0800 / Codex：补充插件内独立 Webview Editor 市场页和命令入口，原因是 Phase 1 浏览安装验收需要从插件内打开市场。
- 2026-05-10 14:30 +0800 / Codex：补充扩展命令、打包前置和构建验证，原因是新增 Webview Editor 命令会影响 extension manifest 与 bundle。
- 2026-05-10 14:54 +0800 / Codex：补充 Webview 公开 API CORS 修复、验证命令和最新 workers.dev 版本 ID，原因是用户截图显示插件内市场页本地 UI 已加载但远端 API fetch 失败。
- 2026-05-10 15:11 +0800 / Codex：补充 VSCode Webview 人工 smoke 结果，原因是用户已确认插件内市场页加载和安装主路径成功。
- 2026-05-10 15:41 +0800 / Codex：补充 Webview 已安装状态回显设计和验证证据，原因是插件内安装成功后需要让用户直接看到本地已安装版本。
- 2026-05-10 15:43 +0800 / Codex：刷新 Webview 已安装状态回显后的验证命令，原因是扩展端代码和 VSIX 前置检查均已通过。
- 2026-05-10 15:55 +0800 / Codex：补充卡片级本地 / workspace 安装目标选择，原因是用户确认每个模板安装时都需要明确选择写入范围，并修正 workspace 选项文案。
- 2026-05-10 15:57 +0800 / Codex：刷新安装目标选择后的验证命令，原因是本地 / workspace 安装目标选择已完成类型、构建和脚本验证。
- 2026-05-10 16:30 +0800 / Codex：补充侧栏市场模板安装范围展示和 workspace sidecar 测试，原因是支持本地 / workspace 安装后侧栏也需要区分写入范围。
- 2026-05-10 16:42 +0800 / Codex：补充插件内市场页已安装模板应用动作和 storage location 精确匹配决策，原因是用户已经能安装模板，下一步需要从市场卡片直接套用到 Canvas。
- 2026-05-10 16:44 +0800 / Codex：刷新扩展端验证结果，原因是已安装模板应用动作已通过测试、类型检查、构建、VSIX 前置、审计和空白检查。
- 2026-05-10 16:55 +0800 / Codex：撤回市场卡片应用动作并记录入口边界，原因是用户确认模板市场应支持下载/安装，已安装模板应用应继续走侧栏。
- 2026-05-10 16:57 +0800 / Codex：刷新撤回后的扩展端验证结果，原因是市场面板入口边界已通过测试、类型检查、构建、VSIX 前置、审计和空白检查。
- 2026-05-10 17:12 +0800 / Codex：补充插件内市场 Webview UX 收口和网络错误 fallback，原因是用户确认只需继续完善市场安装体验，不重复测试侧栏已具备的模板应用能力。
- 2026-05-10 17:16 +0800 / Codex：刷新 Webview UX 收口后的扩展端验证结果，原因是安装引导、错误 fallback 和状态持久化已通过测试、类型检查、构建、VSIX 前置、审计和空白检查。
- 2026-05-10 17:50 +0800 / Codex：补充插件内直接下载入口和同位置覆盖更新策略，原因是 v1 preview 需要把下载、重复安装和后续版本更新主路径收口清楚。
- 2026-05-10 17:54 +0800 / Codex：刷新下载/安装策略后的扩展端验证结果，原因是直接下载入口和覆盖更新逻辑已通过测试、类型检查、构建、VSIX 前置、审计和空白检查。
- 2026-05-10 18:16 +0800 / Codex：补充 `review-loop` preview v2 的 D1/R2 数据、脚本和远端验证结果，原因是需要让更新安装路径在 preview 环境中真实可调试。
- 2026-05-10 18:17 +0800 / Codex：刷新 preview v2 后的完整本地验证结果，原因是共享 seed、Worker API、Web fallback、扩展端安装策略和构建均受本轮数据变更影响。
- 2026-05-10 18:33 +0800 / Codex：补充缩略图读取路径、R2 PNG fixture 和 Web/Webview 展示方式，原因是 Phase 1 卡片展示需要真实缩略图而不是长期依赖渐变占位。
- 2026-05-10 18:35 +0800 / Codex：刷新缩略图接入后的 R2 远端校验、完整本地验证和 workers.dev 部署结果，原因是 Worker API、浏览器 bundle、插件 Webview 与 preview R2 对象清单均受本轮变更影响。
- 2026-05-12 08:24 +0800 / Codex：补充外部安装链接与插件内列表的详情确认流、验证命令和最新 preview 版本 ID，原因是用户明确要求先在 VSCode 内打开详情页再点击安装。
- 2026-05-12 18:29 +0800 / Codex：补充插件内列表级安装位置预选与详情确认入口的正式文档口径，原因是 review 指出代码与“安装位置只在详情页”旧验收文案冲突。
