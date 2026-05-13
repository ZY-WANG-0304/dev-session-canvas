# 模板市场技术选型收口

本 `ExecPlan` 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘` 这几个章节。

本文位于 `docs/exec-plans/active/template-marketplace-tech-selection.md`，必须按 `docs/PLANS.md` 的要求持续维护。

## 目标与全局图景

这次工作要把 `docs/product-specs/template-marketplace.md` 中的 Web 前端与后端基础设施选型收口为正式设计结论。完成后，后续实现者可以明确知道模板市场以 Phase 1-4 完整目标为边界，正式路线使用 `React + Vite` 而不是 `Next.js`，后端使用 `Cloudflare Workers + Hono + D1 + Drizzle + R2` 而不是自建长期运行后端，并且知道这套方案如何接入当前 VSCode 扩展、本地模板模型、GitHub OAuth、版本治理和后续验证。

用户可观察到的最终能力不在本次文档修改中直接出现；本次交付的可观察结果是仓库中有一份已选定的设计文档 `docs/design-docs/template-marketplace.md`，产品规格同步写明技术栈，索引文档可追溯到本次选型。

## 进度

- [x] (2026-05-10 00:15 +0800) 读取 `docs/WORKFLOW.md`、`docs/PLANS.md`、`docs/product-specs/index.md` 与 `docs/product-specs/template-marketplace.md`，确认这是涉及候选方案比较和设计结论的文档交付，需要设计阶段 `ExecPlan`。
- [x] (2026-05-10 00:18 +0800) 检查工作树并按工作流从最新 `origin/main` 创建主题分支 `docs-template-marketplace-tech-selection`。
- [x] (2026-05-10 00:25 +0800) 读取 `ARCHITECTURE.md`、`docs/DESIGN.md`、`docs/PRODUCT_SENSE.md`、`docs/FRONTEND.md`、`docs/SECURITY.md`、`docs/RELIABILITY.md` 与本地模板规格/设计，确认市场必须复用现有 `CanvasTemplateDocument` 语义。
- [x] (2026-05-10 00:35 +0800) 查阅 Cloudflare、Vite、Hono、VSCode Authentication / Webview / URI Handler、GitHub OAuth 官方文档，确认候选技术的当前官方能力与约束。
- [x] (2026-05-10 01:10 +0800) 新增 `docs/design-docs/template-marketplace.md`，记录 React + Vite、Cloudflare Workers + Hono + D1 + R2、GitHub OAuth 等候选，以及 VSCode Webview 与本地模板安装 sidecar 边界。
- [x] (2026-05-10 01:25 +0800) 发现并纠正口径：在用户确认前不能把推荐候选写成 `已选定`，也不能把产品规格中的 Web 技术栈和后端基础设施移出待确认项。
- [x] (2026-05-10 01:45 +0800) 将设计文档 frontmatter 改为 `decision_status: 比较中`，产品规格恢复待确认项，设计索引同步为比较中。
- [x] (2026-05-10 02:20 +0800) 根据用户确认，正式选择 `React + Vite` 而不是 `Next.js` 作为 Web 前端路线，并保留 Cloudflare Workers + Hono + D1 + Drizzle + R2 后端路线。
- [x] (2026-05-10 02:35 +0800) 更新设计文档正式方案、产品规格技术栈、API 版本前缀和设计索引，明确 Next.js 仅作为后续 SEO/静态详情页需求下的备选 PoC。
- [x] (2026-05-10 02:45 +0800) 执行 `git diff --check` 与 `python3` 文档一致性断言，确认设计文档、产品规格和索引均已同步到 React + Vite 方案。
- [x] (2026-05-10 03:20 +0800) 根据用户纠正，把后端选型依据从 Phase 1 首版口径改为 Phase 4 完整目标口径，补充版本管理、治理后台、审计日志、统计面板和退出条件。
- [x] (2026-05-10 03:35 +0800) 记录用户给出的主域名计划：正式浏览器入口使用 `https://dscanvas.dev/templates`，预览仍先使用 `*.workers.dev`。
- [x] (2026-05-10 03:45 +0800) 确认 GitHub Organization 不是启动前置条件；OAuth App 可先归属个人 GitHub 账号，后续再转移到组织或重建生产 App。

## 意外与发现

- 观察：当前本地模板模型已经把模板文件和运行态状态分开，`src/common/canvasTemplates.ts` 的 `CanvasTemplateDocument` 不包含远端统计、发布者或市场版本字段。
  证据：`CanvasTemplate` 当前只包含 `id`、`name`、`category`、`nodes`、`edges`、`createdAt`、`updatedAt`，节点只允许 `agent`、`terminal`、`note`。

- 观察：VSCode Webview 市场页不能直接依赖远程 SSR app 或 localhost 服务；Remote/Codespaces 场景下，官方文档要求使用 Webview 资源 URI 和 message passing 规避本地/远程边界。
  证据：VSCode Remote Extensions 文档说明 Webview 应使用 `asWebviewUri` 管理资源，并建议通过 message passing 更新动态内容。

- 观察：Cloudflare 官方文档已经有 Hono + React SPA + Workers Static Assets 的完整路径，能覆盖“静态市场页 + API Worker”的一体部署形态。
  证据：Cloudflare Hono 指南展示 `src/worker/` + `src/react-app/` 的 full-stack 项目结构，并说明 Workers Assets 可以把 Hono API 和 SPA 组合为全栈 app。

- 观察：Next.js 的主要收益在浏览器 Web 端的 SSR/SSG、SEO 和分享卡片；但模板市场 Phase 1-4 都有 VSCode Webview 主入口，直接采用 Next.js 会增加 Web 与 Webview 两套运行模型或 static export 兼容验证成本。
  证据：设计讨论中已确认 Phase 1-4 更看重浏览器和 VSCode Webview 共享同一套组件与本地 bundle，而不是搜索引擎级 SEO。

- 观察：用户明确纠正技术选型应以 Phase 4 为目标，而不是只按 Phase 1 的浏览安装能力判断。
  证据：Phase 4 的版本历史、发布新版本、更新提醒、手动更新/回滚、举报队列、用户封禁、模板下架/恢复、统计面板和治理审计，都已在产品规格中列为范围内能力。

- 观察：GitHub OAuth App 可以创建在个人账号或有管理权限的组织下，也可以后续转移给其他用户或组织；但 OAuth App 不能配置多个 callback URL。
  证据：GitHub 官方 OAuth App 创建文档说明个人账号和组织都可注册 OAuth App，并说明 OAuth App 不支持多个 callback URL；OAuth App 转移文档说明所有权可转移给用户或组织。

## 决策记录

- 决策：Phase 1-4 Web 前端路线选择 `React 18 + TypeScript + Vite`，不选择 `Next.js`。
  理由：模板市场需要同时服务浏览器 SPA 和 VSCode Webview Editor。Vite 更容易产出浏览器 bundle 与 Webview 本地 bundle，避免 Next.js 在 SSR/SSG 能力与 Webview CSP、本地资源、message passing 之间制造额外适配层。
  日期/作者：2026-05-10 / Codex

- 决策：后端基础设施选择 `Cloudflare Workers + Hono + D1 + Drizzle + R2`，静态市场页使用 Cloudflare Workers Static Assets。
  理由：Phase 1-4 的市场能力仍是公开读、认证写、版本化对象下载、轻量统计、举报队列、管理员治理和审计日志。Cloudflare 单栈能同时覆盖 API、静态资产、SQL 元数据、对象存储和边缘缓存；Hono 适合 Workers JSON API，Drizzle 让 D1 schema、migration 和查询保持类型化；`template_versions`、`reports`、`admin_roles`、`admin_audit_logs`、`template_daily_stats` 与 R2 不可变版本对象能覆盖 Phase 4 的版本管理和治理后台。
  日期/作者：2026-05-10 / Codex

- 决策：`Tailwind CSS + shadcn/ui` 只作为源码级 UI 组件与样式基础，VSCode Webview 必须通过 theme adapter 映射 `--vscode-*` token。
  理由：浏览器市场页需要快速形成卡片、表单、Dashboard 和治理后台，但插件内市场页不能照搬默认 SaaS 视觉，必须延续当前产品的 VSCode 原生语境和主题跟随规则。
  日期/作者：2026-05-10 / Codex

- 决策：市场元数据不写入 `CanvasTemplateDocument` 主体，安装到本地时使用 sidecar 记录市场来源、版本和更新检查信息。
  理由：模板 JSON 应继续作为离线可分享的画布布局对象；远端下载量、点赞、发布者、版本 id 等事实属于市场分发层，不应污染本地模板格式。
  日期/作者：2026-05-10 / Codex

- 决策：Next.js 保留为后续备选 PoC，不进入 Phase 1-4 正式方案。
  理由：若后续 SEO、OpenGraph 或静态详情页成为核心目标，可以单独验证 Next.js static export / OpenNext 与 VSCode Webview 本地 bundle 的兼容性；当前 Phase 1-4 不为这些能力提前承担复杂度。
  日期/作者：2026-05-10 / Codex

## 结果与复盘

当前已把模板市场技术选型收口到 `React + Vite` 前端和 `Cloudflare Workers + Hono + D1 + Drizzle + R2` 后端，并明确这是面向 Phase 1-4 完整目标的正式路线，不只是 Phase 1 原型。产品规格中的 Web 技术栈、后端基础设施、Phase 4 承载口径、主域名路径计划和个人 GitHub 账号先行口径已移入已确认项；市场品牌展示名、文件大小具体阈值和综合热度排序具体权重仍保留待确认。本次工作没有实现生产服务，也没有改变运行时代码，因此设计文档仍为 `validation_status: 未验证`。

验证结果：

    git diff --check
    # 通过，无输出

    python3 - <<'PY'
    from pathlib import Path
    design = Path('docs/design-docs/template-marketplace.md').read_text()
    assert 'decision_status: 已选定' in design
    assert 'React 18 + TypeScript + Vite' in design
    assert 'Phase 1-4 正式路线不使用 Next.js' in design
    assert 'Phase 4 承载边界与退出条件' in design
    assert 'admin_audit_logs' in design
    assert 'template_versions' in design
    spec = Path('docs/product-specs/template-marketplace.md').read_text()
    assert 'Web 端技术栈选择：React + TypeScript + Vite' in spec
    assert '后端基础设施选型：Cloudflare Workers + Hono + D1 + Drizzle + R2' in spec
    assert '技术选型目标口径：以 Phase 4 完整目标为边界' in spec
    assert 'https://dscanvas.dev/templates' in spec
    assert 'GitHub OAuth App 归属：先用个人 GitHub 账号创建' in spec
    assert 'Next.js' not in spec
    idx = Path('docs/design-docs/index.md').read_text()
    row = [line for line in idx.splitlines() if '`docs/design-docs/template-marketplace.md`' in line][0]
    assert '| 已选定 | 未验证 |' in row
    print('doc consistency checks passed')
    PY
    # doc consistency checks passed

## 上下文与定向

当前仓库是一款 VSCode workspace extension。顶层架构由 Extension Host、Webview 与可选 Runtime Supervisor 组成，宿主权威状态在 `src/panel/CanvasPanelManager.ts`，跨边界模型在 `src/common/`，Webview 呈现在 `src/webview/`。本地模板功能已经存在，主要路径是 `src/common/canvasTemplates.ts`、`src/panel/CanvasTemplateStore.ts`、`src/panel/CanvasPanelManager.ts` 和 `src/sidebar/CanvasSidebarTemplateView.ts`。

模板市场是本地模板能力的远端分发扩展。它需要新增浏览器 Web 端和插件内市场页，但不能把浏览器站点当作 VSCode Webview 的唯一实现，因为 Webview 有 CSP、本地资源、Remote/Codespaces 和宿主消息边界。它也需要新增后端服务，但在 Phase 1-4 范围内仍不需要自建长期运行进程或复杂集群。

## 工作计划

先把技术选型正式写入设计文档，包含候选方案、取舍、正式方案、数据模型、认证、上传校验和验证方法。随后同步产品规格，把 Web 技术栈和后端基础设施移入已确认项，并更新后端架构概要。最后更新 `docs/design-docs/index.md` 和 `docs/product-specs/index.md`，让文档注册表能追溯新设计文档和当前更新时间。

## 具体步骤

在仓库根目录执行以下步骤：

    sed -n '1,260p' docs/WORKFLOW.md
    sed -n '1,240p' docs/PLANS.md
    sed -n '1,260p' docs/product-specs/template-marketplace.md
    sed -n '1,260p' docs/DESIGN.md

创建或更新以下文件：

    docs/exec-plans/active/template-marketplace-tech-selection.md
    docs/design-docs/template-marketplace.md
    docs/product-specs/template-marketplace.md
    docs/product-specs/index.md
    docs/design-docs/index.md

完成后运行：

    git diff --check
    git status --short

预期 `git diff --check` 无输出且退出码为 0；`git status --short` 只显示本次文档修改。

## 验证与验收

本次文档交付的验收标准如下：

- `docs/design-docs/template-marketplace.md` 存在，frontmatter 状态为 `decision_status: 已选定`、`validation_status: 未验证`，并关联模板市场产品规格和本执行计划。
- `docs/product-specs/template-marketplace.md` 明确 Web 前端选择 `React + Vite`，不再写成 `Next.js`。
- `docs/product-specs/template-marketplace.md` 明确后端基础设施选择 `Cloudflare Workers + Hono + D1 + Drizzle + R2`。
- `docs/design-docs/index.md` 注册新设计文档，状态与 frontmatter 一致。
- `git diff --check` 通过。

## 幂等性与恢复

这些文档修改可以重复检查和重新应用。若后续发现 React + Vite 不能满足浏览器市场的 SEO 或分享需求，不要直接覆盖本次结论；应在 `docs/design-docs/template-marketplace.md` 中新增决策记录，说明为何需要重新评估 Next.js 或静态预渲染方案，并同步更新产品规格和本计划。

## 证据与备注

本次查阅的关键依据包括：

    Cloudflare D1: managed serverless database with SQLite semantics, Worker and HTTP API access.
    Cloudflare R2: object storage for unstructured data, suitable for template JSON and thumbnail assets.
    Cloudflare Workers Static Assets: Worker code and static assets can be deployed as one unit.
    VSCode Authentication API: built-in auth providers include `github`, and `getSession` returns an access token with user consent.
    GitHub OAuth Apps: web application flow supports authorization code, state and PKCE. OAuth apps can be registered under a personal account or organization, cannot have multiple callback URLs, and can later be transferred to a user or organization.

## 接口与依赖

后续实现应新增 `packages/marketplace-shared/`，导出市场 API 类型、Drizzle schema、Zod schema、模板包 manifest、安装 sidecar 和错误码。该包必须是纯 TypeScript 合约包，不依赖 `vscode`、React、DOM 或 Cloudflare runtime binding。

后续实现应新增 `apps/template-marketplace/`，使用 React + Vite 构建浏览器和 VSCode Webview 前端 entry，浏览器正式入口计划为 `https://dscanvas.dev/templates`，Vite browser build 需要支持 `/templates/` base path；使用 Hono 编写 Worker API，并通过 Wrangler 配置 D1、R2 和 Static Assets 绑定。Worker API 统一使用 `/api/v1` 前缀，除非后续另行决策把市场 API 收敛到 `/templates/api/v1`。

后续 VSCode 宿主集成应新增 `src/panel/TemplateMarketplaceClient.ts` 和 `src/panel/CanvasTemplateMarketplacePanel.ts`。前者负责认证、API 调用、安装与更新检查；后者负责 Webview Editor HTML、CSP、资源 URI 和消息桥接。
