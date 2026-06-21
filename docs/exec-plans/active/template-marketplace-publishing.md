# 模板市场发布能力

本 `ExecPlan` 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘` 这几个章节。本文按照 `docs/PLANS.md` 的要求维护，目标是让后续任何协作者只靠这份计划和当前工作树，就能继续完成模板市场 Phase 2 的发布能力。

## 目标与全局图景

这次变更让模板市场从“只能浏览和安装官方种子模板”推进到“登录用户可以把本地模板发布到市场”。完成后，开发者可以在本地 Worker 测试环境中用 GitHub OAuth 配置或测试认证身份调用发布 API，Worker 会校验模板 JSON、写入 R2 对象、写入 D1 元数据，并让新模板出现在公开列表和详情接口中。浏览器 Web 端和 VSCode 插件内入口随后接入同一组发布接口，不另起一套模板格式。

本计划不等于对外公布。模板市场仍在 `feature/templates-marketplace` 长期集成分支内推进，只有 `docs/product-specs/template-marketplace.md` 中 Phase 1-4 全部完成后才进入正式发布收口。

## 进度

- [x] (2026-05-14 14:20 +0800) 确认本地 OAuth secret 保存方式：真实 `apps/template-marketplace/.dev.vars` 被 `.gitignore` 忽略，仓库只跟踪 `apps/template-marketplace/.dev.vars.example`。
- [x] (2026-05-14 14:30 +0800) 从最新 `origin/feature/templates-marketplace` 建立 `feat-template-marketplace-publishing` 主题分支，并保留 secret 示例文件改动。
- [x] (2026-05-14 14:55 +0800) 梳理并扩展共享发布请求 schema，覆盖模板 JSON、描述、README、标签、缩略图和大小限制；新增 shared 测试覆盖合法请求、非法边索引和 slug 规范化。
- [x] (2026-05-14 15:10 +0800) Worker 增加 GitHub OAuth / session 基础结构，并提供只在 `MARKETPLACE_ALLOW_TEST_AUTH=true` 时开启的 fake auth header。
- [x] (2026-05-14 15:25 +0800) Worker 增加 `POST /api/v1/templates` 首版：认证后校验请求、写入 R2 `template.json` / `thumbnail.png`、写入 D1 用户 / 模板 / 版本 / 标签 / 发布日统计。
- [x] (2026-05-14 16:05 +0800) Worker 增加 `POST /api/v1/templates/:id/versions`，要求当前 GitHub login 与原发布者一致，写入新版本 R2 对象、插入 `template_versions`、更新 `templates.latest_version_id` 和发布日统计。
- [x] (2026-05-14 15:50 +0800) Web 端增加 `/templates/publish` 发布入口和发布表单，支持 GitHub 登录提示、模板 JSON 文件读取、PNG 缩略图读取、metadata 输入、提交发布和成功后查看详情。
- [x] (2026-05-15 00:30 +0800) VSCode 插件内增加“从自建本地模板发布”入口：命令面板过滤自建模板，模板侧栏自建行显示发布 icon action，发布调用 VSCode GitHub authentication 与市场 token exchange。
- [x] (2026-05-15 00:45 +0800) 增加 `GET /api/v1/me/templates` 和浏览器 `/templates/me` 页面，登录发布者可以查看当前 GitHub 账号发布的模板列表并跳转详情。
- [x] (2026-05-15 01:05 +0800) 增加共享布局 PNG 缩略图生成器，浏览器发布页选择模板 JSON 后自动生成缩略图，VSCode 发布请求也自动携带 `thumbnailPngBase64`。
- [x] (2026-05-15 01:15 +0800) 曾补齐画布右键发布入口：从当前画布保存为自建模板后继续走同一发布命令；该入口已在 2026-05-24 根据手动验收反馈移除，侧边栏、市场 header 和命令面板保留为插件内发布入口。
- [x] (2026-05-15 01:25 +0800) 补齐发布路径自动化测试、构建验证，并同步产品 / 设计 / UI 文档中的新增口径。
- [x] (2026-05-15 02:16 +0800) 在浏览器 Templates 列表和 VSCode 市场面板 header 增加上传/发布自建模板入口，并同步 UI / 产品 / 设计文档与源码断言。
- [x] (2026-05-15 02:29 +0800) 完善浏览器 OAuth 发布体验：发布页和个人模板页登录后回到发起页面；Worker 只接受 `/templates...` 同源 return path，避免开放重定向。
- [x] (2026-05-15 02:40 +0800) 增加浏览器市场退出登录入口和 `POST /api/v1/auth/logout`，便于发布者切换账号或重复执行 OAuth smoke。
- [x] (2026-05-15 07:09 +0800) 对齐自动缩略图节点色板：Agent / Terminal / Note accent 色分别镜像插件画布节点主题色 #22c55e、#38bdf8、#a78bfa，并增加源码漂移断言。
- [x] (2026-05-25 23:58 +0800) 将 `origin/main` 合入 `feature/templates-marketplace` 后补齐市场模板 schema：继续排除主线新增 file / file-list 画布节点，接受关联 Markdown Note 的三种内容模式，并校验 workspace 相对路径。
- [x] (2026-05-15 08:29 +0800) 修复浏览器发布页文本输入白屏：表单输入统一先提取字符串再更新 React state，并补充源码回归断言、本地 Playwright 输入烟测和 preview 部署。
- [x] (2026-05-15 08:49 +0800) 补齐 publish 按钮交互反馈：发布页在缺少模板 JSON 时显示明确错误，提交中展示 loading 状态，提交成功后在按钮附近显示结果；新增 Playwright publish 页端到端烟测并纳入 `npm run test:marketplace`。
- [x] (2026-05-15 19:50 +0800) 扩展完整 UI 操作 E2E：浏览器覆盖 Templates 列表 / 详情 / My Templates / Publish 页面；VSCode 覆盖市场面板列表筛选、详情切换、版本菜单关闭、详情返回、安装写入本地模板库，以及从插件市场面板发布自建模板后打开详情页。
- [x] (2026-05-15 22:46 +0800) 收口发布页手动验收反馈：自动缩略图去掉左上装饰标题条；非法 JSON 上传立即显示错误；单行字段回车不再触发发布；Changelog 改为多行；发布成功跳转成功页；Templates 列表与详情页补充发布者信息。
- [x] (2026-05-15 23:51 +0800) 继续收口发布页验收反馈：模板 JSON 错误提示移动到上传控件附近；新增 slug availability API，编辑 slug 时即时检查唯一性并在字段下方显示冲突 / 可用状态。
- [x] (2026-05-16 06:20 +0800) 拆分 VSCode 模板市场 E2E：保留本地 fixture 回归脚本，并新增直接访问 workers.dev 调试验证环境的 VSCode preview E2E，用真实市场 API 覆盖列表、详情、版本菜单和安装 sidecar。
- [x] (2026-05-16 15:55 +0800) 收口 VSCode 市场列表与详情 UI：插件内移除下载 JSON 控件，列表右侧恢复安装 / 已安装 split button，列表和详情补充发布者信息，详情侧栏只保留安装、统计和版本历史，缩略图改为完整展示。
- [x] (2026-05-16 16:30 +0800) 复核后继续微调 VSCode 列表页：顶部说明不再暗示必须进入详情页安装，已安装 split button 改为弱化 secondary 视觉，只保留版本下拉作为可操作入口。
- [x] (2026-05-18 23:58 +0800) 将 VSCode 发布入口从 QuickInput 直接提交改为插件内发布确认表单：命令面板 / 市场 header / 侧栏 / 画布保存后都只打开表单，用户确认名称、Slug、描述、标签、README、CHANGELOG 和 Template JSON Preview 后才发布。
- [x] (2026-05-24 02:10 +0800) 重新部署 workers.dev 调试环境，当前版本 ID 更新为 `907ea967-9862-43fb-803d-4095727e8fed`；本次仅更新 Worker / Static Assets，不执行 D1 migration 或 R2 seed。
- [x] (2026-05-24 11:43 +0800) 按手动截图反馈修复 VSCode 发布表单 Name / Slug 行错位：字段 grid 预留校验提示行高，input 基线保持对齐；同时移除画板右键“发布到模板市场”入口，发布只从保存后的模板侧栏、市场 header 或命令面板进入。
- [x] (2026-05-24 22:20 +0800) 处理 PR94 review：发布新模板和新版本的 R2 object key 改为包含唯一 `versionId`，避免并发版本发布覆盖同一 `versionNumber` key；Worker CORS 改为仅对公开 GET/OPTIONS 读取路由返回匿名 `*`，写接口不继承公开读取 CORS，并补 API 回归测试。
- [x] (2026-05-27 01:06 +0800) 按模板包落地顺序完成第一步用户教育：浏览器发布页侧栏展示 canonical 模板包结构、package checks、50MB 包 / 5MB 模板主体限制；README 区域提示包内媒体规则，并用 E2E 与 web 单测覆盖 README 媒体 lint。
- [x] (2026-05-28 22:25 +0800) 实现真实 `package.zip` 上传/下载 UI：新增完整包下载端点和浏览器详情页链接，发布页高级 zip 上传可解析包并提交 Worker；Worker 解压校验 canonical 包，写入 R2 `package.zip` / `template.json` / `thumbnail.png` / `manifest.json` 和 D1 派生索引。
- [x] (2026-05-29 10:20 +0800) 明确并实现浏览器发布页 `package.zip` / `template.json` 互斥入口：Package 模式下表单编辑会在发布前重新生成 canonical `package.zip`，再提交 Worker；JSON 模式继续走兼容 JSON API 并由 Worker 组包。
- [x] (2026-05-30 00:00 +0800) 更新产品方案定义：确认“轻量模板”仅指单个 `template.json` 兼容形态，“完整模板”指 `package.zip` 或解压目录；模板市场只管理完整模板，JSON + 表单上传也必须由服务端组包。
- [x] (2026-05-30 00:20 +0800) 修正下载 API 方案：`/download` 应改为下载完整模板包，轻量模板导出另设 `/template.json` 之类的兼容接口；当前 `/package` 只作为过渡接口。
- [x] (2026-05-30 00:35 +0800) 更新 VSCode 安装后的本地管理方案：市场模板不再保存为孤立 JSON，而是保存为 `marketplace/{slug}/` 完整模板目录，目录内保留原始包、解压内容和 `.market.json` sidecar。
- [x] (2026-05-31 00:45 +0800) 开始完整模板主下载 / 安装实现：`/download` 返回完整 `package.zip`，新增 `/template.json` 作为轻量模板导出；浏览器详情页主下载动作切到 `/download`，JSON 导出切到 `/template.json`；VSCode 安装路径下载完整 zip、解压校验并写入 `marketplace/{slug}/` 完整模板目录。
- [x] (2026-05-31 01:30 +0800) 修复完整模板安装回归：VSCode fixture 的版本 hash 改为与包内 `template.json` 字节一致，本地完整模板目录写入后会重写解压出的 `template.json` 为本地模板 id，并通过 canvas templates 与 VSCode fixture E2E 验证。
- [x] (2026-05-31 10:45 +0800) 更新 workers.dev 调试环境：为 4 个 preview seed 版本补传完整 `package.zip` 到 R2，重新部署 Worker / Static Assets 到版本 `d4717aef-7fa9-4067-bb6f-753b939e87da`，随后运行 VSCode preview E2E；当前执行主机访问 workers.dev 超时，E2E 停留在加载态，已记录为环境网络阻塞而非通过。
- [x] (2026-05-31 11:45 +0800) 修复 preview 中历史发布模板点击 `Download full package` 下载成 `download.json` 的问题：Worker 在 `/download` 找不到历史 `package.zip` 时，会基于同版本 `template.json`、D1 README / CHANGELOG 和缩略图即时生成最小完整 zip；同时强制 package 响应 `content-type: application/zip`，避免 R2 旧 metadata 让浏览器按 JSON 处理。
- [x] (2026-05-31 19:20 +0800) 处理 PR107 review：Package 上传路径不再把原始上传 zip 原样保存到 R2；Worker 会在解析后用服务端规范化后的 `template.json`、manifest/checksum、README、CHANGELOG、缩略图和保留下来的 `media/` / `assets/` 资源重新生成 canonical `package.zip`，确保包内 `template.json` hash 与版本 `sha256` 一致。
- [x] (2026-06-22 01:09 +0800) 收口验证环境网络不稳定问题：真实 workers.dev preview E2E 在 preflight 不可达时默认快速 skip，显式设置 `MARKETPLACE_PREVIEW_E2E_REQUIRE_NETWORK=1` 或 `DEV_SESSION_CANVAS_TEMPLATE_MARKETPLACE_PREVIEW_REQUIRE_NETWORK=1` 时才失败；新增本地 preview 等价 E2E，复用 preview 测试脚本但用本地 fixture server 提供 `/templates` 和 `/api/v1/*`，避免当前服务器访问不到 workers.dev 时反复超时。

## 意外与发现

- 观察：当前仓库此前只在 `.vscodeignore` 排除了 `.env`，没有在 `.gitignore` 中忽略本地 Worker secret 文件。
  证据：新增 `.gitignore` 规则后，`git check-ignore -v apps/template-marketplace/.dev.vars` 命中 `apps/template-marketplace/.dev.vars`，而 `.dev.vars.example` 被显式放行。

- 观察：发布 API 可以在不访问真实 GitHub 网络的情况下自动化验证认证与写入边界。
  证据：`npm run test:marketplace-api` 使用 `MARKETPLACE_ALLOW_TEST_AUTH=true` 和 `x-marketplace-test-github-login` 覆盖 201 发布、401 未认证、400 非法模板请求；fake auth 未开启时同一 header 不生效。

- 观察：VSCode token exchange 返回的是认证用户形状（`githubUserId` / `githubLogin`），不是模板详情中的 publisher 形状（`id` / `githubLogin`）。
  证据：插件侧 `parseMarketplaceTokenResponse()` 已单独解析认证用户，避免把 token exchange 响应误走模板详情 publisher parser。

- 观察：自动缩略图可以在不依赖浏览器 Canvas 或服务端渲染的情况下由共享 TypeScript 生成。
  证据：`packages/marketplace-shared/src/thumbnail.test.ts` 覆盖 PNG signature、base64 payload 和小于 1MB 的固定尺寸输出；`npm run test:marketplace-shared` 通过 14 个测试。

- 观察：React 表单事件对象不能在 `setForm((current) => ...)` updater 中延迟读取。
  证据：`/templates/publish` 上传模板 JSON 后编辑 Description 曾触发 `TypeError: Cannot read properties of null (reading 'value')`；修复后 headless Chromium 依次编辑 Name、Slug、Description、Tags、README、Changelog 和 Template JSON preview，无 `pageerror` 且发布按钮仍可见。

- 观察：发布按钮“没有反应”通常是因为缺少显式状态回显，而不是没有触发提交。
  证据：现在在未选择模板 JSON 时点击按钮会在按钮附近直接显示“Choose a template JSON before publishing.”；提交中会显示“Publishing template...”；提交成功后会显示结果和 `View template` 链接。

- 观察：浏览器市场基路径使用 Vite `base: "/templates/"` 时，`/templates` 在本地 dev server 下会显示 base URL 提示页，不能作为可点击返回链接的唯一目标。
  证据：浏览器详情页点击 `Back to all templates` 曾进入 “The server is configured with a public base URL of /templates/ ...”；`getMarketplaceHomeHref()` 改为 `/templates/` 后，详情返回列表 E2E 通过。

- 观察：发布表单的单行输入字段默认会把 Enter 当成 submit，这和用户填写 metadata 的预期不一致。
  证据：浏览器 E2E 现在在 Slug 单行字段按 Enter 后断言 `POST /api/v1/templates` 请求数量不变，随后点击按钮才提交；同一 E2E 还覆盖非法 JSON 错误、Changelog textarea、成功页跳转和作者信息展示。

- 观察：slug 冲突如果只等到提交后由 `POST /api/v1/templates` 返回 409，用户会在填写表单末尾才知道需要改 slug。
  证据：Worker 新增 `GET /api/v1/templates/slug-availability?slug=...`；浏览器 E2E 在发布页把 slug 改成 `review-loop` 时看到“Slug is already used by another template.”，再改成 `codex-smoke-template` 时看到“Slug is available.”。

- 观察：本地 fixture VSCode E2E 只能证明宿主、Webview 和模板库写入的可控回归路径，不能证明调试环境 Worker / D1 / R2 / CORS / CSP 的真实组合。
  证据：新增 `scripts/smoke/run-template-marketplace-vscode-preview-e2e.mjs` 和 `tests/vscode-smoke/template-marketplace-preview-tests.cjs`，通过 `DEV_SESSION_CANVAS_TEMPLATE_MARKETPLACE_SOURCE_URL` 指向 `https://dscanvas-template-marketplace.wzy0304.workers.dev/templates`，不启动本地 fixture server，先执行非阻塞 preview API preflight 诊断，再用真实 VSCode Webview 访问 preview API 执行匿名浏览、详情读取、版本菜单和安装。

- 观察：当前执行环境不能稳定访问 workers.dev 调试市场，因此不能把本机这次 preview E2E 失败解读为插件逻辑失败，也不能让已知不可达的网络继续触发长时间 VSCode 超时。
  证据：`npm run test:marketplace-vscode-preview-e2e` 曾在 VSCode Webview 中停留在“正在加载...”；同一主机上代理访问 `https://dscanvas-template-marketplace.wzy0304.workers.dev/api/v1/templates?sort=newest` 返回 Squid `ERR_CONNECT_FAIL 110`，绕过代理直连则 443 连接超时。2026-06-22 后，真实 preview runner 先执行 10 秒 preflight，失败时默认输出 `Template marketplace VS Code preview E2E skipped` 并退出；只有显式要求网络验收时才把 preflight 失败作为命令失败。

- 观察：真实 workers.dev preview E2E 与本地 fixture E2E覆盖的是不同风险，不能互相替代。
  证据：`npm run test:marketplace-vscode-local-preview-e2e` 新增为本地等价 preview 验证入口，复用 `tests/vscode-smoke/template-marketplace-preview-tests.cjs` 的匿名读取、详情、版本菜单和安装 sidecar 断言，但数据由 `tests/vscode-smoke/template-marketplace-fixture.cjs` 提供；真实 `npm run test:marketplace-vscode-preview-e2e` 继续只覆盖 Cloudflare preview 的真实路由、D1/R2/CORS/CSP 组合。

- 观察：模板包用户教育可以先作为发布表单的非阻塞预览和 lint 落地，不需要等待 zip 上传、schema 或 Worker 组包重构。
  证据：`apps/template-marketplace/src/web/components/TemplatePublishView.tsx` 只新增 package structure / package checks / README media lint UI，不改变 `publishMarketplaceTemplate()` 的 JSON 请求体；`npm run test:marketplace-web`、`npm run typecheck:marketplace`、`npm run test:canvas-templates` 和 `npm run test:marketplace-browser-e2e` 均通过。

- 观察：当前 D1 schema 尚未保存 canonical `package.zip` object key；但已发布版本的 `objectKey` 均采用 `templates/{templateId}/versions/{versionId}/template.json`，可以在不迁移 D1 的前提下从同目录推导 `package.zip` key。
  证据：`apps/template-marketplace/src/worker/repository.ts` 的 `MarketplaceTemplateVersion.objectKey` 只包含兼容 `template.json`；调试环境手动 seed 的包对象也位于同一版本目录下的 `package.zip`。

- 观察：`fflate.zipSync()` 会在嵌套目录中生成目录 entry，例如 `media/`；如果把目录 entry 当普通文件走包路径校验，会被误判为空 path。
  证据：Worker 包上传测试最初返回 `package_path_invalid`，修复为在 unzip filter 和 normalized entries 中跳过 `entryPath.endsWith('/')` 后，`npm run -w @dev-session-canvas/template-marketplace test:api` 的 package upload 用例通过。


- 观察：VSCode 安装完整模板包时，校验用的 hash 仍应对包内 `template.json` 计算，而不是对整个 zip 计算。
  证据：市场版本元数据中的 `sha256` 和 `sizeBytes` 当前来自 D1 `template_versions.object_key` 指向的兼容 `template.json`；`src/panel/TemplateMarketplaceClient.ts` 下载 `/download` 后用 `fflate.unzipSync()` 读取包内 `template.json`，以该文件 hash 与版本 `sha256` 比对，同时把完整 zip 的 `packageSha256` 另写入 `.market.json`。

- 观察：本地模板扫描必须把完整模板目录视为一个市场模板，否则 `template-package.json`、`template.json` 和旧 sidecar 相邻 JSON 会被递归扫描成多个用户模板或错误 issue。
  证据：`src/panel/CanvasTemplateStore.ts` 先扫描 `marketplace/*/.market.json`，再从 sidecar 的 `templatePath` 读取包内 `template.json`；普通 JSON 扫描会跳过这些 package 目录。`npm run test:canvas-templates` 新增包目录 fixture 后通过。

- 观察：VSCode fixture E2E 安装失败的直接原因是测试 fixture 的版本 `sha256` 来自紧凑 JSON，而 `/download` 返回的包内 `template.json` 是 pretty JSON，导致宿主校验失败后不写入本地模板目录。
  证据：日志中能看到 `/api/v1/templates/panel-review-loop/download?version=ver-panel-review-2` 请求，但模板 catalog 始终没有 `panel-review-loop`；将 fixture 的 hash 和 zip 共同使用 `JSON.stringify(document, null, 2) + "\n"` 后，`npm run test:marketplace-vscode-fixture-e2e` 通过。

- 观察：Package 上传即使前端已经按表单编辑重建 zip，Worker 仍会规范化 `template.name`、`template.category`、`updatedAt` 和 JSON 序列化；如果 R2 保存原始上传 zip，包内 `template.json` hash 会与 D1 `template_versions.sha256` 不一致。
  证据：PR107 review 指出 VSCode 安装会用 `/download` 包内 `template.json` 计算 hash 并与版本 `sha256` 比对；新增 API 回归测试会解压发布后 R2 中的 `package.zip`，断言包内 `template.json` hash 等于响应中的 `latestVersion.sha256`，并确认原包媒体资源仍保留。

- 观察：preview R2 seed 脚本当前仍只管理 `template.json` 和 `thumbnail.png`，不管理完整 `package.zip`，因此完整模板主下载上线到调试环境时需要单独补传 package 对象。
  证据：`apps/template-marketplace/scripts/preview-r2-objects.mjs` 的 `previewTemplateObjects` 未列出 `package.zip`；本轮手动补传并用 `wrangler r2 object get` 校验 4 个对象：getting-started v1 `48920 / 9b1be6ed470396e1e92a042ecc8e5409b1b2f819d074e88f508c5f514bc2d4dd`，review-loop v1 `42409 / 8746bdcd7a08fb96ad1ac231b87c4f811335aa0cb3c18abf118eab1644b235d4`，review-loop v2 `52973 / 47809dd7ec4f3880f0cc6e24f37c495cd1edc11cfc494f4fbc5fac0275e62b0a`，release-readiness v1 `42971 / ffae7ae5af6275f12a0487c318311d67cd8c2eb6055ad5ef36f68bffd77f8fa4`。

- 观察：2026-05-31 的 VSCode preview E2E 失败仍由当前 Remote SSH 主机无法访问 workers.dev 引起，不能据此判定完整包下载或 VSCode 安装逻辑失败。
  证据：`npm run test:marketplace-vscode-preview-e2e` 的 Node preflight 报 `ETIMEDOUT 74.86.12.172:443` 和 IPv6 `ENETUNREACH`；VSCode Webview probe 最终仍为 `statusText: "正在加载..."`、`templateCount: 0`；同一主机 `curl -I --max-time 20` 通过代理 20 秒 0 字节超时，`curl --noproxy '*'` 直连 443 约 10 秒后连接超时。失败 artifact 位于 `.debug/template-marketplace-vscode-preview-e2e/artifacts`。

- 观察：用户截图里的 `download.json` 失败是历史调试模板版本缺少 `package.zip` 导致完整下载路径无法得到真实 zip；浏览器收到 JSON 错误响应后按默认文件名保存为 `download.json`。
  证据：远端 D1 中 `release-readiness-jijiji` 和 `release-readiness-jijijij` 的版本 object key 仍是 `versions/1/template.json`，对应 R2 `package.zip` key 不存在；而较新的 `release-readiness-v3` 已存在 `versions/ver-release-readiness-v3-1-0da2d8a5/package.zip`。本轮改为 `/download` 在缺失包但存在同版本 `template.json` 时生成最小 zip，并新增 API 回归测试覆盖历史 JSON-only 版本与 stale content-type。

## 决策记录

- 决策：真实 GitHub OAuth client secret、session secret 和管理员 allowlist 只放在 `apps/template-marketplace/.dev.vars` 或 Cloudflare Worker secrets 中；生产管理员 bootstrap 优先使用 `MARKETPLACE_ADMIN_GITHUB_IDS`，`MARKETPLACE_ADMIN_GITHUB_LOGINS` 只作为本地和临时配置兼容；仓库跟踪 `.dev.vars.example` 作为空值模板。
  理由：发布能力需要真实 OAuth 配置才能做浏览器登录 smoke，但 secret 不能进入 Git、文档或 VSIX 打包产物。示例文件能告诉协作者需要哪些 key，同时避免泄漏真实值。
  日期/作者：2026-05-14 / Codex。

- 决策：发布 API 第一版使用 JSON 请求体，而不是 multipart form-data；请求体中包含市场元数据、模板 JSON 对象和可选 PNG 缩略图 base64。
  理由：当前 Worker、Web 测试和 fake R2 已经以 JSON contract 为主，先用 JSON 能快速获得可自动化验证的 D1/R2 写入闭环；后续 Web 表单仍可把用户选择的文件解析为同一个 JSON contract，再决定是否需要 multipart 优化。
  日期/作者：2026-05-14 / Codex。

- 决策：模板包大小第一版按可配置上限处理，默认值为 5MB。
  理由：产品规格里仍把具体大小列为待确认并建议总包 5MB。实现需要一个安全默认值才能校验上传，本轮把 5MB 作为默认配置而不是不可更改的产品结论；若后续产品调整，只需同步常量、环境变量和文档。
  日期/作者：2026-05-14 / Codex。

- 决策：自动缩略图第一版使用共享客户端布局 PNG renderer，而不是服务端截图或外部图像依赖。
  理由：浏览器发布页和 VSCode 宿主都能拿到同一份 `CanvasTemplateDocument`，共享 renderer 可以在两端生成同样的 640x360 PNG，并保持 R2 缩略图小于当前 1MB 上限；后续若要换成真实画布截图，只需要替换 renderer，不改变发布 API contract。
  日期/作者：2026-05-15 / Codex。

- 决策：自动缩略图中节点类型的 accent 色必须镜像插件画布节点主题色，不能使用独立市场色板。
  理由：缩略图是模板布局的功能性预览，用户应能把市场预览中的 Agent / Terminal / Note 颜色直接映射到插件画布中的节点类型；市场品牌色只负责页面和整体背景，不替代节点类型语义。
  日期/作者：2026-05-15 / Codex。

- 决策：模板包第一步实现只做发布页渐进解释与校验提示，继续保持当前 JSON 发布接口兼容；结构预览固定展示 canonical `template-package.json`、`template.json`、`README.md`、`CHANGELOG.md` 和 `media/thumbnail.png`，不把用户上传文件名作为包内事实。
  理由：产品已拍板普通发布者不应先理解完整包格式；先让现有发布页解释“背后将生成什么包”可以降低学习成本，同时为后续 starter package、schema、zip 上传和 CLI 校验预留一致语言。
  日期/作者：2026-05-27 / Codex。

- 决策：本轮真实包下载先新增公开 `GET /api/v1/templates/:id/package?version=`，继续保留旧 `GET /download` 兼容 JSON；后续正式 API 语义需反转为 `/download` 返回完整 `package.zip`，轻量模板导出另设 `GET /api/v1/templates/:id/template.json?version=`。包 key 暂从版本 `objectKey` 推导，不新增 D1 migration。
  理由：用户需要立刻用临时模板包调试完整包下载 UI；D1 migration 与 listing revision 字段属于后续数据模型收口，不应阻塞已有 R2 `package.zip` 的读取和浏览器入口验证。后续产品方案确认市场只管理完整模板后，`/download` 这个稳定下载语义应服务完整模板，不能长期被轻量 JSON 占用。
  日期/作者：2026-05-28，2026-05-30 修订 / Codex。

- 决策：本轮真实包上传使用 `POST /api/v1/templates/package` 的 `multipart/form-data` zip 文件字段，Worker 用 `fflate` 解压并校验 canonical 结构，再复用现有 D1 派生字段与 R2 `template.json` / `thumbnail.png` 兼容对象写入。
  理由：浏览器没有内建 zip 解析，前端只上传原始 `package.zip` 才能覆盖 README 媒体和归档保真；`fflate` 是 MIT 许可的小型纯 JS 压缩库，适合 Workers runtime，且避免引入 Node-only zip 依赖。
  日期/作者：2026-05-28 / Codex。

- 决策：Package 上传路径的最终 R2 `package.zip` 必须由 Worker 重新生成，而不是保存上传的原始 zip bytes。
  理由：上传包后允许编辑的字段就是用户确认后的发布事实；同时 Worker 会规范化 `template.json` 和 manifest checksum，只有服务端重建包才能让 R2 `package.zip`、兼容 `template.json`、`manifest.json`、D1 `sha256` 与 VSCode 安装校验使用同一份内容。重建时保留原包未被覆盖的 `media/` / `assets/` 资源，避免破坏 README 媒体和高级作者维护的素材。
  日期/作者：2026-05-31 / Codex。

- 决策：产品命名固定为“轻量模板”和“完整模板”。轻量模板只表示单个 `template.json` 的兼容导入 / 导出形态；完整模板表示 `package.zip` 或解压后的模板包目录，是模板市场发布、下载、安装、回滚、审计和长期维护的唯一管理形态。
  理由：用户仍需要通过 `template.json` 快速上传或兼容旧流程，但市场若同时管理两套事实会让 README、CHANGELOG、媒体和包内资源继续退化为二等内容。统一以完整模板为市场事实，可以让 JSON + 表单上传、Package 上传、浏览器下载和 VSCode 安装最终收敛到同一种包语义。
  日期/作者：2026-05-30 / Codex。

- 决策：正式下载 API 语义改为 `GET /api/v1/templates/:id/download?version=` 下载完整模板包；轻量模板导出使用单独接口，例如 `GET /api/v1/templates/:id/template.json?version=`。当前已实现的 `/package` 只作为迁移期兼容别名或隐藏接口，不作为正式 contract。
  理由：`download` 对用户和客户端都表示“下载这个市场模板”，而市场模板的正式内容形态已经是完整模板；继续让 `/download` 返回孤立 JSON 会把轻量模板放在主路径上，和产品定义冲突。
  日期/作者：2026-05-30 / Codex。


- 决策：VSCode 从市场安装模板时不再让 Webview 先 fetch JSON；Webview 只把 template slug、version、source 和安装目标发给宿主，宿主调用 `/download` 下载完整 `package.zip`、解压校验 manifest 和 `template.json`，再写入本地完整模板目录。
  理由：完整模板包含 README、CHANGELOG、缩略图、media 和 assets，必须由宿主以二进制包管理才能保真；让 Webview 传递 JSON 或 base64 zip 都会继续把轻量模板放在安装主路径上，也会放大 Webview 内存和状态复杂度。
  日期/作者：2026-05-31 / Codex。

- 决策：VSCode 本地完整模板目录的 `.market.json` 记录两层校验信息：`checksum` 保留兼容 `template.json` hash，与当前市场版本元数据一致；`packageSha256` / `packageSizeBytes` 记录实际下载的完整 zip，供后续包完整性和 listing revision 判断使用。
  理由：当前 D1 schema 尚未保存 package hash，直接把版本 `sha256` 改成 zip hash 会破坏现有发布和列表接口；双记录可以在不迁移数据库的前提下支持完整包安装，并为后续显式 package key/hash migration 留出位置。
  日期/作者：2026-05-31 / Codex。

- 决策：VSCode 安装完整模板时，保留原始 `package.zip` 不改，但解压目录中的 `template.json` 会重写为本地模板 id、user category 和本地 createdAt。
  理由：侧栏和应用模板读取的是解压目录里的 `template.json`；如果不重写，首次安装返回的是本地 `market-template-*` id，但重启或重新扫描后会退回包内原始 id，导致目录扫描和更新判断不稳定。保留原始 zip 可继续满足完整包审计和重新导出需要。
  日期/作者：2026-05-31 / Codex。

- 决策：真实 workers.dev preview E2E 的网络 preflight 失败时默认 skip，而不是继续启动 VSCode 等待 Webview 超时；需要把网络不可达当成失败时，通过 `MARKETPLACE_PREVIEW_E2E_REQUIRE_NETWORK=1` 或 `DEV_SESSION_CANVAS_TEMPLATE_MARKETPLACE_PREVIEW_REQUIRE_NETWORK=1` 显式启用强制模式。
  理由：当前服务器到 workers.dev 的网络路径不稳定，这是验证环境限制，不是插件逻辑失败。默认快速 skip 可以避免后续反复消耗长 E2E 超时；强制模式保留给发布前或可访问网络环境，确保真实 Cloudflare preview 仍能作为独立验收。
  日期/作者：2026-06-22 / Codex。

- 决策：新增 `npm run test:marketplace-vscode-local-preview-e2e` 作为“本地等价 preview”验证入口，复用 preview 测试脚本，但由本地 fixture server 提供 `/templates` 和 `/api/v1/*`。
  理由：本地 fixture E2E 覆盖发布入口，真实 preview E2E 覆盖 Cloudflare 组合；两者之间缺少一个不依赖外网、但执行 preview 匿名读取 / 详情 / 版本菜单 / 安装 sidecar 同一断言的稳定命令。新增 local preview 后，当前服务器也能验证这条主路径，真实 workers.dev smoke 只在网络可达环境承担部署后确认。
  日期/作者：2026-06-22 / Codex。

## 结果与复盘

当前已完成 Phase 2 发布能力的本地代码闭环：共享发布 schema、浏览器 GitHub OAuth/session helper、测试专用 fake auth、OAuth 发起页回跳、市场 session 退出登录、`POST /api/v1/templates`、`POST /api/v1/templates/:id/versions`、`GET /api/v1/me/templates`、D1/R2 写入 helper、浏览器 `/templates/publish` 与 `/templates/me` 页面、浏览器 Templates 列表上传入口、VSCode 命令面板 / 市场面板 header / 侧边栏发布入口、共享自动缩略图生成、内容安全最小检查、文件大小超限错误和结构化失败提示均已接入。

2026-05-15 继续完成 VSCode 侧发布入口：`devSessionCanvas.publishTemplateToMarketplace` 命令、侧栏自建模板行 `cloud-upload` action、VSCode GitHub session 换取 marketplace token、`context.secrets` token 存储和 `POST /api/v1/templates` 调用已接入。2026-05-18 根据手动验证反馈，发布入口不再用 QuickInput 直接收集公开字段并提交；命令现在只负责选择自建模板并打开插件内发布确认表单，表单确认后才发布。2026-05-24 继续移除画板右键直接发布入口，画板右键只负责“保存为模板”，发布从保存后的模板侧栏、市场 header 或命令面板进入。真实 preview OAuth smoke 与端到端 UI smoke 仍是发布前验证项；Phase 3-4 社区互动、统计、完整版本管理和治理能力不属于本 Phase 2 收口。

同日继续补齐发布者个人页基础能力：Worker 新增 `GET /api/v1/me/templates`，D1 repository 可按当前 GitHub user id 过滤已发布模板，浏览器端新增 `/templates/me` 页面和 `My Templates` 入口。该页面当前只展示当前账号已发布模板列表和详情跳转，不包含 Phase 3 的趋势图或完整 Dashboard。

2026-05-15 晚补齐完整 UI 操作 E2E：`scripts/test/test-template-marketplace-publish-page.mjs` 从单页 publish smoke 扩展为浏览器市场多页面 E2E，使用 Playwright route fixture 覆盖列表搜索 / tag / sort、详情 README 主体与下载链接、登录前后 My Templates、发布表单文件读取和发布成功跳转；新增 `scripts/smoke/run-template-marketplace-vscode-e2e.mjs` 与 `tests/vscode-smoke/template-marketplace-tests.cjs`，用本地 HTTP fixture 驱动 VSCode 市场 Webview 的真实操作，并通过测试命令 probe 验证详情不是嵌在列表下方、版本菜单可关闭、安装会写入本地模板目录、插件内发布会完成 GitHub token exchange 和 `POST /api/v1/templates`。

2026-05-16 补齐 VSCode 调试环境 E2E 入口：`npm run test:marketplace-vscode-e2e` 继续作为默认无网络 fixture 回归；新增 `npm run test:marketplace-vscode-preview-e2e` 直接打 workers.dev 调试验证环境，不拦截 marketplace API。该 preview E2E 当前只覆盖匿名读取、详情、版本菜单和安装写入隔离 VSCode runtime，不执行真实 GitHub 发布，避免污染共享调试环境。runner 还会在启动 VSCode 前请求 preview 列表 API 做非阻塞诊断；真正的验收仍以 VSCode Webview probe 是否读到真实模板为准。

同日下午按 VSCode 面板截图反馈继续收口：浏览器端继续保留 JSON 下载入口，但插件内市场不再显示下载 JSON；列表右侧主操作改回安装 split button，`查看详情` 只保留在标题附近；列表和详情都显示发布者；详情页侧栏去掉默认展示的校验和来源技术信息，让 README 继续作为主内容；VSCode 列表和详情缩略图改为 `object-contain`，避免自动生成预览被裁切。

16:30 继续按列表页复核反馈调整：面板顶部说明改为“选择安装位置后可安装模板；进入详情页可查看 README、CHANGELOG 和版本历史。”，避免与列表安装 split button 冲突；已安装版本的 split button 从强 primary 蓝色降为 secondary surface，保留 `已安装 vN` 文案和右侧版本菜单入口。随后将列表右侧安装位置选择器与安装 split button 收进同一个 action rail，并保持安装位置在上、安装按钮在下、整体顶部对齐，与详情页控件顺序一致。详情页主内容同步改为 README / CHANGELOG tab，Web 与 VSCode 都在主区域展示版本 changelog。

同日晚继续按手动验收反馈收口浏览器市场细节：列表卡片和详情页标题区现在显示发布者；发布页上传非法 JSON 会在文件选择后立即报错；单行字段阻止 Enter 隐式提交；Changelog 改为 textarea；成功发布后进入 `/templates/publish/success` 成功页，再由用户点击跳转到模板详情。自动缩略图保留节点布局和类型色，不再绘制左上角标题 / 子标题装饰条。

23:51 继续优化发布页错误反馈位置和 slug 唯一性提示：模板 JSON 相关错误现在绑定在 Step 1 上传控件附近；slug 字段在编辑时通过公开 availability API 检查 D1 / seed 中是否已有同名模板，并把检查中、可用、冲突、格式错误都显示在字段下方。提交时仍保留 Worker 侧唯一索引和 `POST /api/v1/templates` 409 作为最终保护。

2026-05-27 按模板包设计落地第一阶段用户教育：浏览器发布页在侧栏新增 `Template package structure` 和 `Package checks`，明确当前表单会被组织成 canonical 模板包，并把包体限制更新为 `50MB package / 5MB template JSON`。README 区域新增包内媒体提示，lint 会区分 `./media/...` / `./assets/...` 包内媒体、外部 HTTPS 媒体链接、不允许的相对路径和 raw HTML 媒体 embed。当前只影响发布前解释和提示，不改变 Worker 写入对象仍为兼容 `template.json` / `thumbnail.png` 的事实；后续 schema、package upload、CLI 校验仍按模板包设计文档继续推进。

2026-05-28 进入真实包上传/下载实现。阶段目标是让浏览器详情页能下载 R2 中同版本 `package.zip`，发布页能选择 `package.zip` 并提交到 Worker，Worker 解压出 `template-package.json`、`template.json`、`README.md`、`CHANGELOG.md` 和缩略图后写入 D1/R2。为降低迁移风险，本轮不修改 D1 schema；canonical package key 先由 `template.json` object key 所在目录推导，后续 listing revision / package key 字段再单独迁移。

22:25 已完成上述阶段目标。浏览器详情页新增 `Download full package`，`GET /api/v1/templates/:id/package?version=` 会读取 R2 `package.zip` 并在成功返回后记录下载计数；发布页新增 `Upload package.zip` 高级入口，前端可解析 zip 并填充表单预览，提交时走 `POST /api/v1/templates/package`。JSON 发布路径也会生成 canonical `package.zip`，因此新发布内容具备完整包归档；D1 schema 仍保持现状，package key 由版本目录推导。

2026-05-29 进一步收口 Package 模式产品语义：上传 `package.zip` 后页面仍允许编辑，但这些编辑必须成为最终发布事实；上传 `template.json` 和上传 `package.zip` 必须互斥，避免“后选 JSON 但发布旧 zip”或“slug 检查的是编辑值但服务端用包内旧值”。实现上前端保留原包 `media/` / `assets/` 资源，发布前用当前表单重新生成 zip，再交给 Worker 的同一包校验路径。

2026-05-30 根据产品方案讨论继续收口术语和管理边界：单个 `template.json` 定义为“轻量模板”，只用于兼容导入 / 导出、旧客户端和调试；`package.zip` 或解压后的模板包目录定义为“完整模板”。模板市场只管理完整模板，用户上传 `template.json` 并手动填写表单时，Worker 也必须负责组装完整 `package.zip`；完整模板下载后应直接以 `package.zip` 或解压目录管理，而不是抽出孤立 `template.json` 管理。`Download template.json` 只保留为兼容入口，允许用户下载为轻量模板使用。同日继续修正 API 语义：`/download` 应成为完整模板下载接口，轻量模板导出另设 `/template.json` 之类接口，已实现的 `/package` 仅作为过渡。VSCode 安装后的本地管理也同步收口为完整模板目录：目标模板库下写入 `marketplace/{slug}/package.zip`、解压内容和 `.market.json`，扫描市场模板时从 sidecar 定位包内 `template.json`，而不是扫描孤立 JSON 文件。


2026-05-31 继续收口完整模板主路径：Worker 的 `/download` 已成为完整包下载接口，`/template.json` 成为轻量导出接口，`/package` 仅作为迁移期别名保留；浏览器详情页主按钮下载完整包，列表卡片下载动作也改为 Package。VSCode 插件内安装改为宿主下载完整 zip，并在目标模板库写入 `marketplace/{slug}/package.zip`、解压文件和 `.market.json`。模板侧栏仍展示一个市场模板并从包内 `template.json` 应用到 Canvas；旧的单文件市场安装路径仍保留为兼容方法，供历史安装和潜在内联测试入口读取。

同日上午更新 workers.dev 调试环境以匹配完整模板主路径：preview R2 中 4 个 seed 版本均已补齐 `package.zip`，Worker / Static Assets 已重新部署，最新 deployment 100% 指向版本 `d4717aef-7fa9-4067-bb6f-753b939e87da`。VSCode preview E2E 已执行一次，但当前 Remote SSH 主机无法连通 `https://dscanvas-template-marketplace.wzy0304.workers.dev`，Webview 只能停留在加载态；后续需要从能访问 workers.dev 的网络环境复跑同一命令，或由用户本地手动打开 preview URL 做安装验证。

随后根据用户截图修复历史 preview 模板完整包下载：对于此前通过旧 JSON 路径发布、R2 中没有 `package.zip` 的版本，`/download` 不再返回 JSON 错误，而是用同目录 `template.json` 和 D1 中已有的 README / CHANGELOG / 缩略图生成一个包含 `template-package.json`、`template.json`、`README.md`、`CHANGELOG.md` 和 `media/thumbnail.png` 的最小完整 zip。真实 `package.zip` 存在时仍优先返回 R2 原包；该 fallback 通过 `x-marketplace-package-source: generated-from-template-json` 标记，方便后续数据迁移时清理。

2026-06-22 继续收口验证环境稳定性：真实 workers.dev preview E2E 仍保留为部署后 smoke，但在 preflight 访问不到 preview API 时默认快速 skip，不再继续启动 VSCode 并等待 Webview 超时。新增 `npm run test:marketplace-vscode-local-preview-e2e`，它启动本地 fixture server 后复用 `tests/vscode-smoke/template-marketplace-preview-tests.cjs`，覆盖列表、详情、README/CHANGELOG tab、版本菜单和完整包安装 sidecar。这样当前服务器可以稳定验证 preview 匿名主路径，真实 Cloudflare 路由 / D1 / R2 / CORS 组合则交给网络可达环境或强制模式验证。

## 上下文与定向

模板市场浏览与安装能力已经在 `apps/template-marketplace/` 和 `packages/marketplace-shared/` 中落地。`packages/marketplace-shared/src/index.ts` 定义浏览列表、详情、下载响应和 seed 数据；`packages/marketplace-shared/src/schema.ts` 定义 D1/Drizzle 表，包括 `users`、`templates`、`template_versions`、`template_tags`、`template_daily_stats`、`reports`、`admin_roles` 和 `admin_audit_logs`。`apps/template-marketplace/src/worker/app.ts` 暴露 Hono Worker API，目前只有公开读取接口：健康检查、列表、详情、下载和缩略图。`apps/template-marketplace/src/worker/repository.ts` 通过 `SeedTemplateRepository` 与 `D1TemplateRepository` 封装读取 D1 / seed 的逻辑，后续发布写入也应进入这个边界，不要把 SQL 散落在路由里。

“模板 JSON”指 `src/common/canvasTemplates.ts` 中 `CanvasTemplateDocument` 的序列化结果，格式是 `{ version: 1, template: { id, name, category, nodes, edges, createdAt, updatedAt } }`。产品上它是“轻量模板”的文件形态，只描述可应用到画布的主体内容。市场发布不能定义另一套不兼容模板主体格式，但也不能把单个 `template.json` 当作市场模板管理事实；JSON 上传路径必须由 Worker 组装成完整模板包。

“完整模板”指 R2 中的 `package.zip` 或用户下载后解压出的模板包目录，包内包含 `template-package.json`、`template.json`、`README.md`、`CHANGELOG.md`、`media/thumbnail.png` 以及可选 `media/` / `assets/`。市场浏览、下载、安装、回滚和审计都应以完整模板为准；`GET /api/v1/templates/:id/download` 应返回完整包，`Download template.json` 只作为兼容轻量模板导出。VSCode 中安装的市场模板也必须落成完整模板目录 `marketplace/{slug}/`，目录内保留 `package.zip`、解压内容和 `.market.json` sidecar；侧栏应用模板时读取包内 `template.json`。

主线节点模型自 2026-05 下旬起包含 file / file-list 节点，并把运行时节点 id 调整为带对象身份后缀的格式。模板市场仍以本地模板语义为准：模板节点只允许 Agent / Terminal / Note，保存时忽略 file / file-list，边继续用 `sourceNodeIndex` / `targetNodeIndex` 而不是运行时 node id。关联 Markdown Note 的 `templateContentMode` 和 `relativePath` 属于 `CanvasTemplateDocument` 的正式字段，市场发布 schema、浏览器发布页、VSCode 发布入口和 Worker 内容安全检查都必须接受并校验这些字段。

“R2”是 Cloudflare 对象存储，当前下载路径已经从 `TEMPLATE_BUCKET` 读取 `templates/{templateId}/versions/{versionId}/template.json` 和 `thumbnail.png`。“D1”是 Cloudflare SQLite 数据库，当前 public repository 只读取 `published` 模板和 `published` 版本，发布写入也必须维护这个可见性边界。

## 工作计划

第一步补本地配置保护：根 `.gitignore` 忽略 `.env`、`.env.local`、`.env.*.local`、`apps/template-marketplace/.dev.vars` 和 `apps/template-marketplace/.dev.vars.*`，并跟踪 `apps/template-marketplace/.dev.vars.example`。这一步已经完成。

第二步在 `packages/marketplace-shared/src/index.ts` 增加发布请求和响应 contract。需要定义发布模板请求、发布新版本请求、发布响应、模板文档 schema、标签 / slug / README / changelog / thumbnail 的限制。schema 只描述跨端合同，不导入 VSCode 扩展源码。

第三步在 Worker 中新增认证模块。`apps/template-marketplace/src/worker/auth.ts` 负责解析测试认证 header、校验浏览器 session cookie、生成 GitHub OAuth start URL、处理 callback code exchange、签发 HttpOnly session cookie。测试认证必须由 `MARKETPLACE_ALLOW_TEST_AUTH=true` 显式开启，避免公开部署接受伪造 header。

第四步扩展 `D1TemplateRepository`。新增方法负责 upsert 发布者用户、检查 slug 是否存在、创建模板、创建版本、写 tags、记录 `template_daily_stats.publish_count`。路由层负责把模板 JSON 和缩略图写入 R2，repository 负责 D1 元数据。失败响应使用 `makeMarketplaceApiError()`，不要返回裸错误。

第五步补 Web 端发布表单和 VSCode 发布入口。Web 表单读取本地 JSON 文件，允许填写名称、描述、README、tags、changelog 和可选 PNG 缩略图；VSCode 入口从已有自建本地模板列表中选择模板，宿主通过 VSCode GitHub authentication 换市场 token 后调用同一 API。这一步已经完成。

第六步补自动缩略图和入口一致性。共享 `packages/marketplace-shared/src/thumbnail.ts` 根据节点布局生成 PNG，浏览器发布页在选择模板 JSON 后生成默认缩略图并允许自定义 PNG 覆盖，VSCode 发布请求自动带上生成结果。VSCode 端先把画布保存为用户模板，再从模板侧栏、市场 header 或命令面板打开发布表单；画板右键菜单不直接发布。

## 具体步骤

在仓库根目录执行以下命令查看当前分支和本地改动：

    git status --short --branch

预期当前分支是 `feat-template-marketplace-publishing`，跟踪 `origin/feature/templates-marketplace`，并只包含 `.gitignore`、`.dev.vars.example` 以及用户已有截图等未跟踪素材。

实现和验证时优先运行：

    npm run test:marketplace-shared
    npm run test:marketplace-api
    npm run typecheck:marketplace
    git diff --check

发布能力与 VSCode 面板接入后，再补跑：

    npm run test:canvas-templates
    npm run build:marketplace
    npm run build

模板包发布页教育变更的最小验证命令是：

    npm run test:marketplace-web
    npm run typecheck:marketplace
    npm run test:canvas-templates
    npm run test:marketplace-browser-e2e
    git diff --check

真实 `package.zip` 上传/下载 UI 与 Package 模式重新组包的最小验证命令是：

    npm run test:marketplace-shared
    npm run test:marketplace-api
    npm run test:marketplace-web
    npm run typecheck:marketplace
    npm run test:marketplace-browser-e2e
    git diff --check

## 验证与验收

发布 API 的最小验收是：在测试环境中使用 fake auth 调用 `POST /api/v1/templates`，响应 201，返回新模板 slug、版本号、sha256 和 `storageMode: "d1"`；随后调用 `GET /api/v1/templates/:slug` 能读到该模板，调用 `GET /api/v1/templates/:slug/download` 能从 fake R2 读取刚写入的完整 `package.zip`，调用 `GET /api/v1/templates/:slug/template.json` 能导出包内模板 JSON。未经认证调用发布接口应返回 401；没有 D1 或 R2 binding 时应返回结构化 503；超出大小限制、非法模板 JSON、重复 slug 或非法缩略图应返回结构化 400/409。

浏览器发布表单的验收是：本地打开市场 Web 页面，登录态可见时显示发布入口，选择模板 JSON 并提交后进入发布成功状态；如果模板不合法，应在表单中显示 Worker 返回的错误信息。VSCode 发布入口的验收是：从插件内选择一个用户模板，触发 GitHub 登录后能把该模板发布到同一市场 API。

UI 操作 E2E 的验收是：`npm run test:marketplace-e2e` 同时跑浏览器和 VSCode 两段。浏览器段必须覆盖 Templates 列表、模板详情、My Templates、Publish；VSCode 段必须覆盖插件市场面板的筛选、详情、返回、版本菜单、安装和发布入口。

本地 preview 等价 E2E 的验收是：`npm run test:marketplace-vscode-local-preview-e2e` 启动本地 fixture server，并用同一份 `tests/vscode-smoke/template-marketplace-preview-tests.cjs` 验证 VSCode 内市场列表、真实详情视图、README / CHANGELOG tab、版本菜单和完整包安装 sidecar。这个命令不访问 Cloudflare，适合作为当前服务器上的稳定验证入口。

调试验证环境 E2E 的验收是：`npm run test:marketplace-vscode-preview-e2e` 不启动本地 fixture，直接使用 `https://dscanvas-template-marketplace.wzy0304.workers.dev/templates` 或 `DEV_SESSION_CANVAS_TEMPLATE_MARKETPLACE_PREVIEW_SOURCE_URL` 指定的 `/templates` 来源。该命令先对 `/api/v1/templates?sort=newest` 做 10 秒 preflight；默认情况下 preflight 不可达会输出 skipped 并退出，不把当前服务器网络限制写成产品失败。设置 `MARKETPLACE_PREVIEW_E2E_REQUIRE_NETWORK=1` 或 `DEV_SESSION_CANVAS_TEMPLATE_MARKETPLACE_PREVIEW_REQUIRE_NETWORK=1` 后，preflight 不可达必须失败；在网络可达环境中，它必须能打开 VSCode 内市场列表、读取真实模板详情、打开并关闭版本菜单、安装真实模板，并在 sidecar 中保留 preview `sourceUrl`。

真实模板包上传/下载 UI 的验收是：浏览器模板详情页以 `Download full package` / “下载完整模板” 提供主下载动作，该动作应调用 `GET /api/v1/templates/:slug/download?version=<latestVersionId>` 并返回完整 `package.zip`；迁移期已存在的 `GET /api/v1/templates/:slug/package?version=<latestVersionId>` 可作为隐藏兼容别名。有 R2 binding 且同版本目录存在 `package.zip` 时，Worker 以 `application/zip` 和 `Content-Disposition: attachment` 返回真实 zip，并在对象存在后才记录下载计数。浏览器详情页可继续提供 `Download template.json`，但它应调用单独轻量导出接口，例如 `GET /api/v1/templates/:slug/template.json?version=<latestVersionId>`，只用于把包内模板主体导出为轻量模板，不能作为市场模板主下载或安装路径。VSCode 安装同一版本时必须下载完整包，校验后写入目标模板库的 `marketplace/{slug}/` 目录，目录中保留原始 `package.zip`、解压后的包内容和 `.market.json` sidecar；`listInstalledTemplates` / 侧栏模板扫描通过 sidecar 找到包内 `template.json` 并展示为一个市场模板。发布页提供 `template.json` 轻量输入和高级 `Upload package.zip` 完整输入；选择合法包后自动填充名称、slug、描述、tags、README、CHANGELOG、Template JSON Preview 和缩略图预览；`package.zip` 与 `template.json` 上传入口互斥，后选择的入口清空前一个入口的文件状态，避免表单显示与提交来源不一致。Package 模式下允许继续编辑公开字段、README、CHANGELOG、Template JSON Preview 和缩略图；点击发布时前端基于原包资源重新生成 canonical `package.zip`，把修改写回 manifest / README / CHANGELOG / template JSON / thumbnail 后使用 `multipart/form-data` 提交，Worker 校验包路径、大小、文件数量、manifest、模板 JSON、README 媒体规则和缩略图，并写入 R2 `package.zip`、兼容 `template.json`、`thumbnail.png`、`manifest.json` 与 D1 派生索引。现有 JSON 表单发布仍可用，但提交后必须同时生成 canonical `package.zip`，使市场最终只管理完整模板。

## 幂等性与恢复

`.dev.vars.example` 可以安全重复复制为 `.dev.vars`，真实 `.dev.vars` 已被 Git 忽略。发布 API 测试使用 fake D1 / fake R2，不写远端 Cloudflare 资源。VSCode preview E2E 只读取真实 preview API 并把公开模板安装到隔离 VSCode runtime，不发布新模板；真实 preview OAuth 和 R2/D1 写入只应在用户明确要求部署或 smoke 时执行，并通过 Wrangler secret 配置敏感值。

如果发布 API 写入 R2 成功但 D1 写入失败，当前最小实现可能留下不可见的 R2 orphan object；后续需要在 Worker 支持 delete 或改为更严格的预检查 / 批处理后收口。此风险如果在本轮未解决，必须登记到 `docs/exec-plans/tech-debt-tracker.md`。

`POST /api/v1/templates/package` 使用同一发布前 slug 可用性检查与 D1 唯一约束，可以安全重复上传不同 slug 的包；若上传同一 slug，会返回 409 而不会覆盖已有 D1 记录。由于本轮仍不具备 R2 delete 回滚，R2 写入成功但 D1 写入失败时仍可能留下 orphan object，完成时若未解决需继续保留技术债。

## 证据与备注

本轮初始化阶段的安全检查输出：

    apps/template-marketplace/.dev.vars exists
    .gitignore:23:apps/template-marketplace/.dev.vars apps/template-marketplace/.dev.vars
    GITHUB_CLIENT_ID: set
    GITHUB_CLIENT_SECRET: set
    MARKETPLACE_ADMIN_GITHUB_IDS or MARKETPLACE_ADMIN_GITHUB_LOGINS: set
    MARKETPLACE_SESSION_SECRET: set
    MARKETPLACE_TOKEN_SECRET: set

本轮第一段后端验证输出：

    npm run test:marketplace-shared
    ✓ src/thumbnail.test.ts (2 tests)
    ✓ src/index.test.ts (12 tests)

    npm run test:marketplace-api
    ✓ src/worker/app.test.ts (23 tests)
    ✓ src/worker/repository.test.ts (8 tests)
    Test Files  5 passed (5)
    Tests  41 passed (41)

本轮 Phase 2 收口验证输出：

    npm run test:marketplace-shared
    Test Files  2 passed (2)
    Tests  14 passed (14)

    npm run test:marketplace-api
    Test Files  5 passed (5)
    Tests  43 passed (43)

    npm run test:marketplace
    Test Files  12 passed (12)
    Tests  80 passed (80)

    npm run typecheck:marketplace
    <passed>

    npm run test:canvas-templates
    <passed>

2026-05-27 模板包发布页教育验证输出：

    npm run test:marketplace-web
    Test Files  6 passed (6)
    Tests  26 passed (26)

    npm run typecheck:marketplace
    <passed>

    npm run test:canvas-templates
    <passed>

    npm run test:marketplace-browser-e2e
    marketplace browser page e2e passed

    git diff --check
    <passed>

2026-05-28 真实 `package.zip` 上传/下载 UI 阶段验证输出：

    npm run -w @dev-session-canvas/marketplace-shared test -- --run
    Test Files  2 passed (2)
    Tests  23 passed (23)

    npm run -w @dev-session-canvas/template-marketplace test:api
    Test Files  5 passed (5)
    Tests  59 passed (59)

    npm run -w @dev-session-canvas/template-marketplace test:web
    Test Files  6 passed (6)
    Tests  28 passed (28)

    npm run -w @dev-session-canvas/template-marketplace typecheck
    <passed>

    npm run test:marketplace-browser-e2e
    marketplace browser page e2e passed

    npm run test:canvas-templates
    <passed>

2026-05-28 / Codex：更新计划以覆盖真实 `package.zip` 上传/下载 UI，原因是当前任务已从用户教育进入可运行上传/下载实现，需要把新增端点、Worker 解压、R2 canonical 对象和验证命令纳入可追踪范围。

2026-05-30 / Codex：更新计划以记录轻量模板 / 完整模板的产品定义，原因是模板市场管理边界从“兼容 JSON 与包下载并存”进一步收口为“市场只管理完整模板，JSON 仅为轻量兼容形态”。随后按产品反馈修正 API 语义：`/download` 应成为完整模板下载接口，轻量模板导出另设接口，当前 `/package` 只作为过渡兼容。

    npm run typecheck
    <passed>

    npm run build:marketplace
    ✓ built in 1.78s

    npm run build
    <passed>

    git diff --check
    <no output>


2026-05-31 完整模板主下载 / VSCode 包安装阶段当前验证输出：

    npm run test:marketplace-api -- --runInBand
    Test Files  5 passed (5)
    Tests  61 passed (61)

    npm run test:marketplace-shared
    Test Files  2 passed (2)
    Tests  23 passed (23)

    npm run test:marketplace-web
    Test Files  6 passed (6)
    Tests  30 passed (30)

    npm run test:canvas-templates
    <passed>

    npm run test:marketplace-browser-e2e
    marketplace browser page e2e passed

    npm run test:marketplace-vscode-fixture-e2e
    Template marketplace VS Code UI E2E passed.

    npm run typecheck:marketplace
    <passed>

    npm run build
    <passed>

    npx tsc -p tsconfig.json --noEmit --pretty false
    <passed>

    git diff --check
    <no output>

本轮补充 VSCode preview E2E 入口后的本地验证输出：

    git diff --check
    <no output>

    node --check scripts/smoke/run-template-marketplace-vscode-preview-e2e.mjs
    <passed>

    node --check tests/vscode-smoke/template-marketplace-preview-tests.cjs
    <passed>

    npm run test:canvas-templates
    <passed>

    npm run test:marketplace-vscode-e2e
    Template marketplace VS Code UI E2E passed.

    npm run test:marketplace-vscode-preview-e2e
    <not passed on this host: preflight is now diagnostic-only, but the spawned VSCode Webview probe stayed at 正在加载... with templateCount=0; Node fetch reported ETIMEDOUT / ENETUNREACH, proxy curl reported Squid ERR_CONNECT_FAIL 110>

本轮 JSON 错误位置与 slug 即时唯一性检查验证输出：

    npm run typecheck:marketplace
    <passed>

    npm run test:marketplace-api
    Test Files  5 passed (5)
    Tests  47 passed (47)

    npm run test:marketplace-web
    Test Files  5 passed (5)
    Tests  24 passed (24)

    npm run test:marketplace-browser-e2e
    marketplace browser page e2e passed

    npm run test:marketplace
    Test Files  2 passed (2)   # marketplace-shared
    Tests  16 passed (16)
    Test Files  5 passed (5)   # marketplace-api
    Tests  47 passed (47)
    Test Files  5 passed (5)   # marketplace-web
    Tests  24 passed (24)
    marketplace browser page e2e passed
    Template marketplace VS Code UI E2E passed.

    npm run test:marketplace
    Test Files  11 passed (11)
    Tests  76 passed (76)

    npm run test:canvas-templates
    <passed>

    npm run typecheck
    <passed>

    git diff --check
    <no output>

    npm run build:marketplace
    ✓ built in 1.80s

    npm run build
    <passed>

本轮 Phase 2 OAuth 回跳与 preview 更新验证输出：

    npm run test:marketplace
    Test Files  12 passed (12)
    Tests  82 passed (82)

    npm run build:marketplace
    ✓ built in 1.84s

    git diff --check
    <no output>

    npm run -w @dev-session-canvas/template-marketplace deploy:preview
    https://dscanvas-template-marketplace.wzy0304.workers.dev
    Current Version ID: d85459b6-2b21-45d6-af48-af7ec4628163

本轮 Phase 2 退出登录收口验证输出：

    npm run test:marketplace
    Test Files  12 passed (12)
    Tests  83 passed (83)

    npm run build:marketplace
    ✓ built in 1.78s

    git diff --check
    <no output>

    npm run -w @dev-session-canvas/template-marketplace deploy:preview
    https://dscanvas-template-marketplace.wzy0304.workers.dev
    Current Version ID: ef9f1e8f-875f-46d6-ab0c-2824504805ac

本轮自动缩略图节点色板对齐验证输出：

    npm run test:marketplace-shared
    Test Files  2 passed (2)
    Tests  15 passed (15)

    npm run test:canvas-templates
    <passed>

    npm run typecheck:marketplace
    <passed>

    npm run build:marketplace
    ✓ built in 1.83s

    git diff --check
    <no output>

    npm run -w @dev-session-canvas/template-marketplace deploy:preview
    https://dscanvas-template-marketplace.wzy0304.workers.dev
    Current Version ID: 8242d36b-f162-41d9-ab82-0c19c821c3df

本轮浏览器发布页输入白屏修复验证输出：

    npm run test:marketplace
    Test Files  12 passed (12)
    Tests  84 passed (84)

    npm run build:marketplace
    ✓ built in 1.69s

    npm run test:marketplace-e2e
    marketplace publish page playwright smoke passed

    npm run -w @dev-session-canvas/template-marketplace deploy:preview
    https://dscanvas-template-marketplace.wzy0304.workers.dev
    Current Version ID: 0e4bf965-14f9-4f15-9f06-80a8959d6add

本轮完整 UI 操作 E2E 验证输出：

    npm run test:marketplace-browser-e2e
    marketplace browser page e2e passed

    npm run test:marketplace-vscode-e2e
    Template marketplace VS Code UI E2E passed.

    npm run test:marketplace-e2e
    marketplace browser page e2e passed
    Template marketplace VS Code UI E2E passed.

    npm run test:marketplace
    Test Files  2 passed (2)   # marketplace-shared
    Tests  15 passed (15)
    Test Files  5 passed (5)   # marketplace-api
    Tests  46 passed (46)
    Test Files  5 passed (5)   # marketplace-web
    Tests  23 passed (23)
    marketplace browser page e2e passed
    Template marketplace VS Code UI E2E passed.

    npm run typecheck
    <passed>

    npm run test:canvas-templates
    <passed>

    git diff --check
    <no output>

本轮发布页细节与作者信息修复验证输出：

    npm run typecheck:marketplace
    <passed>

    npm run test:marketplace-shared
    Test Files  2 passed (2)
    Tests  16 passed (16)

    npm run test:marketplace-web
    Test Files  5 passed (5)
    Tests  23 passed (23)

    npm run test:marketplace-browser-e2e
    marketplace browser page e2e passed

    npm run test:marketplace
    Test Files  2 passed (2)   # marketplace-shared
    Tests  16 passed (16)
    Test Files  5 passed (5)   # marketplace-api
    Tests  46 passed (46)
    Test Files  5 passed (5)   # marketplace-web
    Tests  23 passed (23)
    marketplace browser page e2e passed
    Template marketplace VS Code UI E2E passed.

    git diff --check
    <no output>

本轮全量回归验证输出：

    npm test
    <passed>
    typecheck / typecheck:marketplace / marketplace shared-api-web-browser-vscode fixture E2E / canvas-templates / VSCode smoke / Playwright webview 133 tests 均通过；preview workers.dev VSCode E2E 仍保持为独立调试环境验证入口，不串入 npm test。

本轮 VSCode 市场面板 UI 收口验证输出：

    node --check scripts/test-canvas-templates.mjs
    <passed>

    node --check tests/vscode-smoke/template-marketplace-tests.cjs
    <passed>

    node --check tests/vscode-smoke/template-marketplace-preview-tests.cjs
    <passed>

    npm run test:canvas-templates
    <passed>

    npm run test:marketplace-vscode-e2e
    Template marketplace VS Code UI E2E passed.

本轮列表页复核微调验证输出：

    node --check scripts/test-canvas-templates.mjs
    <passed>

    npm run test:canvas-templates
    <passed>

    npm run test:marketplace-vscode-e2e
    Template marketplace VS Code UI E2E passed.

    npm run typecheck
    <passed>

    git diff --check
    <no output>

本轮详情页 README / CHANGELOG tab 验证输出：

    npm run typecheck:marketplace
    <passed>

    npm run test:canvas-templates
    <passed>

    npm run test:marketplace-browser-e2e
    marketplace browser page e2e passed

    npm run test:marketplace-vscode-e2e
    Template marketplace VS Code UI E2E passed.

    git diff --check
    <no output>

本轮 VSCode QuickInput 发布入口回归修复验证输出：

    node --check tests/vscode-smoke/template-marketplace-tests.cjs
    <passed>

    node --check scripts/test-canvas-templates.mjs
    <passed>

    npm run test:canvas-templates
    <passed>

    npm run typecheck
    <passed>

    npm run test:marketplace-vscode-e2e
    Template marketplace VS Code UI E2E passed.

    git diff --check
    <no output>

本轮 VSCode 发布入口表单化验证输出：

    node --check tests/vscode-smoke/template-marketplace-tests.cjs
    <passed>

    node --check scripts/test-canvas-templates.mjs
    <passed>

    TMPDIR=.debug/tmp npm run test:canvas-templates
    <passed>

    TMPDIR=.debug/tmp npm run typecheck
    <passed>

    git diff --check
    <no output>

    npm run test:marketplace-vscode-e2e
    <blocked: 当前机器 /tmp 已满，xvfb-run 无法创建可用 X11 display，VSCode/Electron 以 Missing X server or $DISPLAY / SIGSEGV 退出；本轮改动已补充 VSCode E2E 用例，但需在释放 /tmp 后重跑。>

本轮 VSCode 发布入口表单化复核验证输出（2026-05-24 01:36 +0800）：

    node --check scripts/smoke/run-template-marketplace-vscode-preview-e2e.mjs
    node --check tests/vscode-smoke/template-marketplace-tests.cjs
    node --check scripts/test-canvas-templates.mjs
    <passed>

    TMPDIR=.debug/tmp npm run test:canvas-templates
    <passed>

    TMPDIR=.debug/tmp npm run typecheck
    <passed>

    TMPDIR=.debug/tmp npm run test:marketplace-browser-e2e
    marketplace browser page e2e passed

    TMPDIR=.debug/tmp npm run test:marketplace-vscode-fixture-e2e
    Template marketplace VS Code UI E2E passed.

    git diff --check
    <no output>

本轮调试环境部署输出：

    TMPDIR=.debug/tmp npm run -w @dev-session-canvas/template-marketplace deploy:preview
    <passed>
    https://dscanvas-template-marketplace.wzy0304.workers.dev
    Current Version ID: 907ea967-9862-43fb-803d-4095727e8fed

    TMPDIR=.debug/tmp npm run -w @dev-session-canvas/template-marketplace db:verify:preview
    <passed>
    远端 D1 `template_marketplace_preview` 可读，返回 getting-started-canvas、release-readiness、review-loop 等当前模板版本元数据。

    TMPDIR=.debug/tmp npm exec -w @dev-session-canvas/template-marketplace -- wrangler deployments list
    <passed>
    最新 deployment 为 2026-05-23T17:55:25.752Z，100% 指向版本 `907ea967-9862-43fb-803d-4095727e8fed`。

    curl -I -L https://dscanvas-template-marketplace.wzy0304.workers.dev/templates
    <not passed on this host: 本机代理返回 Squid `ERR_CONNECT_FAIL 110`；Wrangler Cloudflare API 与远端 D1 验证已通过。>

本轮完整模板 preview 调试环境更新输出（2026-05-31 10:45 +0800）：

    npm run -w @dev-session-canvas/template-marketplace deploy:preview
    <passed>
    https://dscanvas-template-marketplace.wzy0304.workers.dev
    Current Version ID: d4717aef-7fa9-4067-bb6f-753b939e87da

    npx wrangler deployments list --json
    <passed>
    最新 deployment 为 2026-05-31T02:29:36.367Z，100% 指向版本 `d4717aef-7fa9-4067-bb6f-753b939e87da`。

    npm run -w @dev-session-canvas/template-marketplace r2:verify:preview
    <passed>
    远端 R2 中既有 `template.json` / `thumbnail.png` seed 对象均与仓库期望 digest 一致。

    wrangler r2 object get template-marketplace-preview/<package-key> --remote
    <passed>
    4 个手动补传的完整模板包对象均已校验：`templates/tmpl-getting-started/versions/1/package.zip`、`templates/tmpl-review-loop/versions/1/package.zip`、`templates/tmpl-review-loop/versions/2/package.zip`、`templates/tmpl-release-readiness/versions/1/package.zip`。

    npm run test:marketplace-vscode-preview-e2e
    <not passed on this host: Node preflight 访问 preview API 报 `ETIMEDOUT` / `ENETUNREACH`，VSCode Webview probe 最终停留在 `statusText: "正在加载..."` 且 `templateCount: 0`；artifact 保存在 `.debug/template-marketplace-vscode-preview-e2e/artifacts`。>

    curl -I --max-time 20 https://dscanvas-template-marketplace.wzy0304.workers.dev/api/v1/templates?sort=newest
    <not passed on this host: 20 秒 0 字节超时>

    curl --noproxy '*' -I --max-time 20 https://dscanvas-template-marketplace.wzy0304.workers.dev/api/v1/templates?sort=newest
    <not passed on this host: 直连 443 连接超时>

本轮历史 preview 模板完整包下载修复验证输出（2026-05-31 11:45 +0800）：

    npm run -w @dev-session-canvas/template-marketplace test:api -- --run
    Test Files  5 passed (5)
    Tests  63 passed (63)

    npm run -w @dev-session-canvas/template-marketplace typecheck
    <passed>

    git diff --check
    <no output>

    npm run -w @dev-session-canvas/template-marketplace deploy:preview
    <passed>
    https://dscanvas-template-marketplace.wzy0304.workers.dev
    Current Version ID: 941efeed-6f13-4310-967a-ab6ac64d82b2

    wrangler r2 object get template-marketplace-preview/templates/tmpl-release-readiness-jijiji-de382d71/versions/1/package.zip --remote
    <not found as expected before fallback: 远端历史模板仍缺少真实包对象，修复依赖 Worker 即时生成 fallback zip。>

本轮 Package 上传服务端 canonical 重建修复验证输出（2026-05-31 19:20 +0800）：

    npm run -w @dev-session-canvas/template-marketplace test:api -- --run src/worker/app.test.ts
    Test Files  1 passed (1)
    Tests  43 passed (43)

    npm run -w @dev-session-canvas/template-marketplace test:api -- --run
    Test Files  5 passed (5)
    Tests  63 passed (63)

    npm run -w @dev-session-canvas/template-marketplace test:web -- --run
    Test Files  6 passed (6)
    Tests  30 passed (30)

    npm run -w @dev-session-canvas/template-marketplace typecheck -- --pretty false
    <passed>

本轮验证环境稳定性收口验证输出（2026-06-22 01:44 +0800）：

    node --check scripts/smoke/run-template-marketplace-vscode-preview-e2e.mjs
    node --check scripts/smoke/run-template-marketplace-vscode-local-preview-e2e.mjs
    node --check tests/vscode-smoke/template-marketplace-tests.cjs
    node --check tests/vscode-smoke/template-marketplace-preview-tests.cjs
    node --check tests/vscode-smoke/template-marketplace-fixture.cjs
    node --check scripts/smoke/vscode-smoke-runner.mjs
    <passed>

    node scripts/test/test-vscode-smoke-runner-env.mjs
    vscode smoke runner env sanitization passed

    npm run test:canvas-templates
    canvas template store tests passed

    npm run test:marketplace-vscode-preview-e2e
    <skipped on this host: preview API preflight 报 `ETIMEDOUT` / `ENETUNREACH`，runner 按默认非强制模式快速退出；强制网络验收需设置 `MARKETPLACE_PREVIEW_E2E_REQUIRE_NETWORK=1`。>

    npm run test:marketplace-vscode-local-preview-e2e
    Template marketplace VS Code local preview E2E passed against http://127.0.0.1:<port>/templates.

    npm run test:marketplace-vscode-fixture-e2e
    Template marketplace VS Code UI E2E passed.

    npm run typecheck:marketplace
    <passed>

    npm run build:marketplace
    <passed>

    git diff --check
    <no output>

## 接口与依赖

需要在 `packages/marketplace-shared/src/index.ts` 导出以下跨端 contract：发布请求 schema、发布新版本请求 schema、发布响应类型、模板包大小默认上限、缩略图大小上限和 canvas template document schema。Worker、Web 和 VSCode 只能依赖这些 contract，而不是复制校验规则。

需要在 `apps/template-marketplace/src/worker/auth.ts` 提供认证 helper：从 request/env 解析当前用户、创建 GitHub OAuth URL、处理 callback、签发和校验 session cookie。需要在 `apps/template-marketplace/src/worker/publish.ts` 或 repository 中提供发布 helper：校验请求、生成 object key、计算 sha256、写 R2、写 D1。

本计划当前修订记录：2026-05-15 / Codex 更新，原因是 Phase 2 发布能力已完成本地代码闭环，并补齐浏览器与 VSCode 插件内完整 UI 操作 E2E 验证证据；同日晚追加发布页手动验收反馈修复、slug 即时唯一性检查与验证证据。

2026-05-31 / Codex：更新计划以记录本轮实现进展，原因是任务已从方案记录进入完整模板主下载和 VSCode 本地包安装落地；计划同步了新的 `/download` / `/template.json` API 事实、Webview 不再下载 JSON 的宿主安装方案，以及当前已执行的验证命令。

2026-05-31 / Codex：补充完整模板安装回归修复记录，原因是 VSCode fixture 发现包内 `template.json` hash 与版本元数据不一致会阻止安装；计划同步了 fixture hash 对齐、本地解压 `template.json` 重写策略和最终验证证据。

2026-05-31 / Codex：补充调试环境更新与 VSCode preview E2E 结果，原因是完整模板主下载已部署到 workers.dev 并补齐 preview R2 package 对象，但当前执行主机无法访问 workers.dev，preview E2E 只能记录网络阻塞证据，不能作为通过结论。

2026-05-31 / Codex：补充历史 JSON-only 版本下载 fallback，原因是 preview 中旧发布模板没有 `package.zip` 导致浏览器点击完整下载时保存 JSON 错误；计划同步了临时生成完整 zip 的兼容策略、验证命令和新的 preview 版本号。

2026-05-31 / Codex：补充 Package 上传 canonical 重建修复记录，原因是 PR review 发现 Worker 原样保存上传 zip 会让包内 `template.json` hash 与 D1 版本 `sha256` 不一致；计划同步了服务端重建包、保留媒体资源和 API 回归测试证据。

2026-06-22 / Codex：补充验证环境稳定性记录，原因是当前服务器访问 workers.dev 不稳定会让真实 preview E2E 反复超时；计划同步了默认 skip、强制网络模式和本地 preview 等价 E2E 的分工。
