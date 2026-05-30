# 模板市场产品规格

## 1. 用户问题

1. **模板发现困难**：用户只能使用内置模板或自己创建的模板，无法发现其他用户创建的优质工作流配置
2. **分享成本高**：当前分享模板需要手动导出 JSON 文件再通过外部渠道传递，缺少统一的发现和分发机制
3. **缺乏社区沉淀**：成功的多 Agent 协作模式无法在社区层面积累和传播，每个用户都在重复探索
4. **质量信号缺失**：用户无法判断一个模板是否好用，缺少下载量、评价等社会化信号

## 2. 目标用户

- **模板消费者**：希望快速找到适合自己场景的工作流模板，降低配置成本
- **模板贡献者**：愿意将自己的工作流分享给社区，获得认可（下载量、点赞）
- **市场管理员**：负责处理举报、管理违规内容、监控市场健康度

## 3. 核心用户流程

### 3.1 浏览与安装模板

1. 用户通过命令面板或侧边栏入口打开模板市场（独立 Webview Editor 页面）
2. 市场首页展示卡片式模板列表，每张卡片包含：缩略图、名称、描述、标签、下载量、点赞数
3. 用户可通过关键词搜索（匹配名称 + 描述 + 标签）或点击标签筛选
4. 用户可按下载量 / 点赞数 / 最新发布 / 最近更新排序
5. 点击卡片进入模板详情页，查看 README、CHANGELOG、完整描述、版本历史、发布者信息；插件内市场列表行可以预选安装位置，并提供安装 / 更新 / 已安装 split button 和版本菜单；浏览器端主下载入口提供完整 `package.zip`，并保留 `Download template.json` 作为兼容轻量模板导出；VSCode 插件内不提供下载 JSON 控件
6. 在详情页点击"安装/更新"将目标版本的完整模板包下载到本地用户模板目录；安装按钮使用 split button，主按钮安装/更新当前详情页选中的版本，右侧下拉可选择安装某个历史版本
7. 完整模板下载后以 `package.zip` 或解压后的模板包目录管理；`template.json` 只作为包内模板主体和兼容轻量模板导出，不作为市场模板的本地管理事实
8. 安装完成后，模板出现在侧边栏模板列表中，第二行以 `市场 · 本地` 或 `市场 · 工作区` 标记来源与保存位置
9. 浏览和下载无需登录

### 3.2 发布模板

1. 用户先把画布保存为本地自建模板，或在侧边栏选中已有本地自建模板
2. 通过侧边栏、市场 header 或命令面板触发发布时，VSCode 打开插件内发布表单并选择可发布的自建模板；画板右键菜单只负责保存模板，不直接提供发布到市场入口
3. 发布前用户在专门表单中确认公开内容，点击确认发布后才触发 GitHub OAuth 认证流程；浏览器端登录完成后回到发起登录的发布或个人模板页面，VSCode 端复用 VSCode 已有认证能力
4. 发布表单包含：
   - 本地模板选择（VSCode 插件内）
   - 模板内容来源：上传 `template.json` 后手动填写公开字段，或上传完整 `package.zip`（二者互斥）
   - 名称（必填）
   - Slug（可编辑并即时检查唯一性）
   - 描述（必填）
   - 标签（多个，自由填写）
   - README
   - CHANGELOG
   - Template JSON Preview
   - 缩略图（自动生成布局示意图，允许上传自定义截图替代）
5. 提交后自动化检查（格式合法性、节点数据完整性、内容安全、文件大小）
6. 检查通过即上架，无需人工审核
7. 发布者可在个人页面查看已发布模板

### 3.3 点赞与收藏

1. 用户在模板详情页或卡片上点击"点赞"按钮
2. 需要 GitHub OAuth 登录
3. 一个用户对一个模板只能点赞一次，再次点击取消
4. 点赞数作为排序信号之一

### 3.4 版本更新

**发布者视角：**
1. 发布者修改本地模板后，选择"发布新版本"
2. 填写更新说明
3. 新版本上架，历史版本保留

**消费者视角：**
1. 侧边栏模板列表中，已安装的市场模板如有新版本，显示更新徽章
2. 用户点击主按钮更新到最新版本，或打开 split button 下拉选择安装特定历史版本
3. 确认后下载目标版本替换本地文件
4. 用户也可通过同一个版本下拉回滚到历史版本

### 3.5 举报与治理

1. 用户在模板详情页点击"举报"按钮
2. 选择举报原因（垃圾内容 / 恶意内容 / 侵权 / 其他）
3. 举报进入管理后台队列
4. 管理员审核后决定下架或驳回
5. 被下架模板的发布者收到通知

### 3.6 Web 端体验

1. 用户通过浏览器访问模板市场 Web 页面
2. 可浏览、搜索、查看模板详情
3. 点击"在 VSCode 中安装"唤起 VSCode，先打开插件内模板详情页，再由用户在详情页点击安装
4. 登录后可在 Web 端发布模板、管理已发布模板、查看统计数据

## 4. 在范围内

### 4.1 市场浏览（Phase 1）
- ✅ 独立 Webview Editor 页面（插件内）
- ✅ 全功能 Web 前端（浏览器可访问，模板有独立 URL）
- ✅ 卡片式布局，展示缩略图、名称、描述、标签、下载量、点赞数
- ✅ 关键词搜索（名称 + 描述 + 标签）
- ✅ 自由标签筛选
- ✅ 多种排序方式（下载量 / 点赞数 / 最新 / 最近更新）
- ✅ 模板详情页
- ✅ 下载安装到本地用户模板目录
- ✅ 匿名浏览和下载
- ✅ 官方种子模板预置
- ✅ 浏览器市场页完整支持 `Light 2026` / `Dark 2026` 浅深主题
- ✅ 插件内市场面板完整跟随当前 VSCode Color Theme

### 4.2 发布能力（Phase 2）
- ✅ 插件内保存本地模板后通过发布表单确认发布（侧边栏 / 命令面板 / 市场 header）
- ✅ Web 端发布流程
- ✅ GitHub OAuth 认证
- ✅ 发布表单（本地模板选择、名称、Slug、描述、标签、README、CHANGELOG、Template JSON Preview、缩略图）
- ✅ 缩略图自动生成（客户端根据节点布局渲染 PNG，节点类型颜色对齐插件画布节点主题色）
- ✅ 缩略图自定义上传
- ✅ 自动化质量检查（JSON schema + 内容安全 + 文件大小限制）
- ✅ 发布者个人页面

### 4.3 社区互动与统计（Phase 3）
- ✅ 点赞/收藏（登录用户，每人每模板一次）
- ✅ 下载量统计
- ✅ 综合热度排行（下载量 + 点赞加权）
- ✅ 发布者统计面板（下载趋势、点赞趋势）
- ✅ Web 端发布者 Dashboard

### 4.4 版本管理与治理（Phase 4）
- ✅ 模板版本历史保留
- ✅ 发布新版本 + 更新说明
- ✅ 插件端更新提醒徽章（被动提醒）
- ✅ 用户手动更新 + 版本回滚
- ✅ 举报功能（插件端 + Web 端）
- ✅ 管理后台：举报队列、用户管理/封禁、数据统计面板、模板内容管理

## 5. 不在范围内

- ❌ 付费模板或商业化
- ❌ 模板评论/讨论区
- ❌ 模板 fork（基于他人模板修改后发布为新模板）— 本地可 fork，但市场不追踪 fork 关系
- ❌ 多语言/国际化（用户用什么语言写就是什么语言）
- ❌ 模板协作编辑
- ❌ 模板自动推荐（基于用户行为）
- ❌ 私有模板（团队内部共享）
- ❌ 模板依赖声明（如"需要安装某插件"）
- ❌ Provider 不可用时的额外处理（沿用现有逻辑：节点启动时报错）

## 6. 关键对象与状态

### 6.1 模板来源体系

```
模板来源
├── 内置模板（builtin）         — 随插件发布，不可删除
├── 用户模板（user）            — 本地创建/保存的
│   ├── 工作区模板              — .dev-session-canvas/templates/
│   └── 全局模板                — ~/.vscode/globalStorage/.../templates/
└── 市场模板（market）          — 从市场下载的完整模板 ← 新增
    ├── 工作区模板              — .dev-session-canvas/templates/marketplace/{slug}/
    └── 全局模板                — ~/.vscode/globalStorage/.../templates/marketplace/{slug}/
```

VSCode 中安装的市场模板以完整模板目录为本地管理单元，而不是单个 `*.json` 文件。每个市场模板目录保存原始 `package.zip`、解压后的 `template-package.json` / `template.json` / `README.md` / `CHANGELOG.md` / `media/` / `assets/`、必要缩略图缓存，以及 `.market.json` sidecar。侧栏和“应用到 Canvas”仍从包内 `template.json` 读取模板主体，但安装、更新、回滚、删除、离线查看 README 和后续 listing revision 判断都以完整模板目录和 sidecar 为准。

### 6.2 模板状态流转

```
[发布者本地模板] → 发布 → [市场待检查] → 自动检查通过 → [已上架]
                                        → 检查失败 → [拒绝，提示原因]

[已上架] → 被举报 → [待审核] → 管理员下架 → [已下架]
                              → 管理员驳回 → [已上架]

[已上架] → 发布者更新 → [新版本待检查] → 通过 → [已上架（新版本）]
```

### 6.3 模板内容形态

模板市场对用户解释两种内容形态，但市场自身只管理完整模板：

- **轻量模板**：单个 `template.json` 文件，只包含可应用到画布的模板主体。它适合快速导入、兼容旧流程或调试导出，不承载 README、CHANGELOG、缩略图、截图、视频或附加资源。轻量模板不是市场的最终管理对象。
- **完整模板**：`package.zip` 或解压后的模板包目录，包含 `template-package.json`、`template.json`、`README.md`、`CHANGELOG.md`、`media/thumbnail.png` 以及可选 `media/` / `assets/` 资源。完整模板是市场发布、下载、安装、回滚、审计和长期维护的标准内容形态。
- **上传语义**：用户上传 `template.json` 并手动填写表单时，服务端负责把这些输入组装成完整模板包；高级作者上传 `package.zip` 时，服务端校验并规范化完整包。两条路径最终都生成同一种完整模板。
- **下载语义**：`Download full package` 是正式下载入口，对应 `GET /api/v1/templates/:id/download` 并返回完整 `package.zip`；`Download template.json` 只是兼容入口，通过单独轻量模板导出接口返回包内模板主体。

## 7. 验收标准

### Phase 1：浏览与安装
当前状态：preview 环境已验证通过的是既有兼容安装路径；完整模板包作为安装和本地管理事实的收口仍按后续包安装改造处理。生产域名与生产 D1/R2 资源分离仍按后续发布收口处理。

- [x] 插件内可打开独立 Webview 市场页面
- [x] Web 端可通过浏览器访问市场，模板有独立 URL
- [x] 市场页面展示卡片列表（缩略图、名称、描述、标签、下载量、点赞数）
- [x] 支持关键词搜索和标签筛选
- [x] 支持多种排序方式
- [x] 可查看模板详情页；插件内市场列表和外部安装链接都先进入 VSCode 内详情页
- [x] 模板详情页以 README 为主内容，不展示首页搜索、筛选、Featured 列表或模板网格，辅助信息收敛到紧凑侧栏和折叠区
- [x] 可下载安装模板到本地（无需登录）
- [ ] VSCode 安装路径改为下载完整 `package.zip`，并在目标模板库中保存为完整模板目录：目录内保留原始包、解压内容和 `.market.json` sidecar，侧栏应用模板时读取包内 `template.json`
- [x] 插件内列表行允许安装位置预选，并在右侧提供安装 / 更新 / 已安装 split button；查看详情作为标题附近的文本动作，VSCode 插件内不提供下载 JSON 控件
- [x] 插件内详情页安装按钮采用 split button：主按钮安装/更新当前详情页选中的版本，下拉可安装特定版本
- [x] 浏览器详情页保留 JSON 下载入口；VSCode 插件内详情页不提供下载 JSON 控件
- [x] 安装后模板出现在侧边栏，标记为 `市场 · 本地` 或 `市场 · 工作区`
- [x] Web 端点击安装可唤起 VSCode，并打开对应模板的插件内详情页继续安装动作
- [x] 预置官方种子模板
- [x] 浏览器市场页使用 `Light 2026` / `Dark 2026` 主题变量，支持 `prefers-color-scheme` 和显式主题属性覆盖
- [x] 浏览器市场页布局对齐 Visual Studio Marketplace 风格：顶部品牌栏、单一 Templates tab、居中标题、大号矩形搜索和矩形卡片
- [x] 浏览器市场页主题色使用 DevSessionCanvas 图标中的蓝色和绿色，不使用 Visual Studio Marketplace 的玫红色
- [x] 插件内市场面板样式从 `--vscode-*` token 派生，不复用浏览器固定色，不使用背景渐变、大 hero、胶囊按钮或大圆角卡片
- [x] 插件内市场面板使用 VSCode 列表式紧凑密度，不使用三列大卡片墙、超大缩略图或大工具卡；列表快捷动作以详情页作为执行上下文
- [x] 插件内安装版本菜单在点击外部、搜索 / 排序变化、切换列表 / 详情或按 Escape 时关闭

### Phase 2：发布
当前状态：Phase 2 发布能力已完成代码实现和本地自动化验证；真实 GitHub OAuth preview smoke 与端到端 UI smoke 作为后续发布前验证项继续执行。

- [x] 插件内可保存本地模板草稿并在专门发布表单中确认后发布到市场
- [x] Web 端可发布模板
- [x] 模板列表中提供上传/发布自建模板入口：浏览器首页可进入发布页，VSCode 市场面板可打开插件内发布表单
- [x] 确认发布时触发 GitHub OAuth 登录，浏览器端登录完成后回到发起登录的发布 / 个人模板页面
- [x] 浏览器端可退出当前市场登录态，便于切换发布账号或重新执行 OAuth smoke
- [x] 发布表单包含本地模板选择、名称、Slug、描述、标签、README、CHANGELOG、Template JSON Preview、缩略图
- [x] 浏览器发布页支持两种互斥内容来源：上传 `template.json` 后手动填写字段，或上传完整 `package.zip` 并从包内 manifest、README、CHANGELOG、template JSON 和缩略图填充发布表单
- [x] 浏览器发布页把 `template.json` 上传视为轻量输入而不是市场最终形态；提交后 Worker 组装 canonical `package.zip`
- [x] 浏览器发布页的 `package.zip` 与 `template.json` 上传入口互斥；上传包后编辑公开字段、README、CHANGELOG、Template JSON Preview 或缩略图，发布时会重新生成 canonical package，而不是提交旧 zip
- [x] 缩略图可自动生成（基于节点布局，节点类型颜色对齐插件画布节点主题色）
- [x] 缩略图可自定义上传
- [x] 自动化检查通过后即上架
- [x] 检查失败时给出明确错误提示
- [x] 发布者可查看自己的模板列表
- [x] 文件大小超限时拒绝上传并提示

### Phase 3：社区互动与统计
- [ ] 登录用户可点赞/取消点赞
- [ ] 下载量正确统计
- [ ] 排行榜按综合热度排序
- [ ] 发布者可查看下载和点赞趋势
- [ ] Web 端 Dashboard 展示发布者统计

### Phase 4：版本管理与治理
- [ ] 发布者可发布新版本并附更新说明
- [ ] 已安装模板有新版本时侧边栏显示更新徽章
- [ ] 用户可手动更新到最新版本
- [ ] 用户可回滚到历史版本
- [ ] 用户可举报模板（选择原因）
- [ ] 管理后台可查看举报队列
- [ ] 管理后台可下架/恢复模板
- [ ] 管理后台可封禁用户
- [ ] 管理后台可查看数据统计

## 8. 开放问题

### 8.1 已确认
- ✅ 市场形态：社区驱动公开市场 + 官方精选
- ✅ 浏览界面：独立 Webview Editor + 全功能 Web 端
- ✅ 发布方式：插件内保存本地模板后表单确认发布 + Web 端发布
- ✅ 身份认证：匿名浏览下载，发布/点赞需 GitHub OAuth
- ✅ 质量控制：自动化检查即上架，事后举报治理
- ✅ 缩略图：自动生成 + 允许自定义上传
- ✅ 版本管理：保留历史，默认最新，可回滚
- ✅ 更新提醒：侧边栏徽章被动提醒，用户手动更新
- ✅ 排名机制：下载量 + 点赞/收藏
- ✅ 分类体系：自由标签（发布者自定义）
- ✅ 安装语义：下载到本地模板库，与本地模板并列管理
- ✅ 国际化：不做多语言
- ✅ 大小限制：模板主体 `template.json` 保持 5MB hard limit；完整模板包提升为 50MB 压缩包 hard limit / 100MB 解压后 hard limit，并对 README、CHANGELOG、缩略图、单媒体、媒体总量和文件数量分别设限
- ✅ Provider 依赖：浏览时标注，安装时警告但允许，不可用时节点启动报错
- ✅ 举报流程：完整管理后台（举报队列、用户管理、统计面板、内容管理）
- ✅ 自动化内容安全策略：确定性字段检查 + 危险链接 / 控制字符过滤 + 事后举报，不把外部 AI 审核作为 Phase 1-4 硬依赖
- ✅ Web 端技术栈选择：React + TypeScript + Vite，浏览器 SPA 与 VSCode Webview 共享组件层
- ✅ 市场 UI 主题口径：详见 `docs/marketplace/UI.md`；浏览器端浅色对应 `Light 2026`、深色对应 `Dark 2026`，插件内市场面板完整适配用户当前 VSCode Color Theme
- ✅ 后端基础设施选型：Cloudflare Workers + Hono + D1 + Drizzle + R2，静态资产走 Cloudflare Workers Static Assets
- ✅ 技术选型目标口径：以 Phase 4 完整目标为边界，版本管理、治理后台、审计日志和统计面板不另起自建后端
- ✅ 主域名与浏览器入口计划：`https://dscanvas.dev/templates`，预览仍先使用 `*.workers.dev`
- ✅ GitHub OAuth App 归属：先用个人 GitHub 账号创建，不要求先建 GitHub Organization；后续如需团队交接再转移到组织
- ✅ 模板内容命名：单个 `template.json` 定义为“轻量模板”，只作为兼容导入 / 导出格式；`package.zip` 或模板包目录定义为“完整模板”，是市场标准内容形态
- ✅ 模板市场管理口径：市场只管理完整模板；用户通过 `template.json` + 表单上传时，由 Worker 负责组装完整模板包；用户上传 `package.zip` 时，Worker 校验并规范化完整包
- ✅ 完整模板下载与安装：正式下载 / 安装 / 回滚应以 `package.zip` 或解压后的模板包目录为管理事实；VSCode 本地市场模板目录保留原始包、解压内容和 sidecar，只在应用到 Canvas 时读取包内 `template.json`；`Download template.json` 只作为兼容轻量模板入口
- ✅ 模板发布单元：后续按“完整模板包”管理，包内包含 `template-package.json`、`template.json`、`README.md`、`CHANGELOG.md` 和 `media/thumbnail.png`；README 可引用包内图片 / 视频媒体，当前表单字段作为兼容输入，由 Worker 组装成同一包模型
- ✅ README 媒体策略：只内嵌渲染包内相对资源；外部图片 / 视频默认作为普通链接；视频不 autoplay 并延迟加载；浏览器和 VSCode Webview 使用同一 sanitizer
- ✅ 版本语义：区分 `template version` 与 `listing revision`；模板主体或行为变化才触发安装更新，README / 描述 / 标签 / 截图 / 视频等展示变更不触发已安装模板更新
- ✅ 模板包用户教育：普通发布者不需要先理解包格式，发布页通过包结构预览、lint 结果和媒体规则提示渐进解释；高级作者再使用 starter package、schema、包上传、校验和作者文档

### 8.2 待确认
- ⏳ 市场品牌展示名 / 页面标题
- ⏳ 是否需要 `templates.dscanvas.dev` 作为跳转别名
- ⏳ 综合热度排序的具体加权算法

## 9. 后端架构概要

| 组件 | 方案 |
|---|---|
| API 层 | Cloudflare Workers + Hono |
| 存储 | Cloudflare R2 存完整 `package.zip`，并保留派生 `template.json`、缩略图和 manifest 便于兼容读取 |
| 元数据 | Cloudflare D1 + Drizzle ORM 存索引、统计、版本历史 |
| 认证 | GitHub OAuth（仅发布和点赞需要）；VSCode 端复用 VSCode 认证能力；OAuth App 初期归属个人 GitHub 账号 |
| CDN | Cloudflare 全球边缘分发 |
| 验证 | 上传时 Zod schema 校验 + 危险链接 / 控制字符过滤 |
| Web 前端 | React + TypeScript + Vite + Tailwind + shadcn/ui，浏览器端部署到 Cloudflare Workers Static Assets，VSCode Webview 端本地打包 |
| 浏览器正式入口 | `https://dscanvas.dev/templates`，浏览器构建需支持 `/templates/` base path；预览环境仍使用 `*.workers.dev` |
| 模板包 | R2 canonical 对象为 `package.zip`，同时保留兼容 `template.json`、`thumbnail.png` 和 D1 派生索引；市场管理、安装、回滚和审计以完整包或解压目录为准 |
| 包上传/下载 | 浏览器详情页以 `Download full package` 作为完整模板下载入口，背后调用 `/download` 返回 `package.zip`，并保留 `Download template.json` 兼容入口；浏览器发布页提供 `template.json` 轻量输入和 `package.zip` 完整包输入，Worker 最终都写入 canonical R2 package |
| OAuth App 环境 | GitHub OAuth App 只有单一 callback URL，预览 `*.workers.dev` 与生产 `dscanvas.dev` 建议分别创建 OAuth App，共用同一套登录实现 |
| 测试 | Vitest + miniflare + Playwright |
| Phase 4 承载 | D1 管理 `template_versions`、`listing_revisions`、`reports`、`admin_roles`、`admin_audit_logs`、`template_daily_stats`，R2 保存不可变版本对象，Worker 强制执行作者/管理员权限 |

技术选型已确认，并以 Phase 4 的版本管理、治理后台、审计日志和统计面板为目标边界；详见 `docs/design-docs/template-marketplace.md`。

**API 端点概要：**
- `GET /api/v1/templates` — 列表/搜索/筛选
- `GET /api/v1/templates/:id` — 模板详情 + 版本列表
- `GET /api/v1/templates/:id/download` — 下载完整 `package.zip`，支撑“下载完整模板”主动作（计数）
- `GET /api/v1/templates/:id/template.json` — 兼容导出包内 `template.json`，作为轻量模板下载使用
- `GET /api/v1/templates/:id/thumbnail` — 读取指定版本缩略图
- `POST /api/v1/templates` — 发布新模板（需认证）
- `POST /api/v1/templates/:id/versions` — 发布新版本（需认证，仅作者）
- `POST /api/v1/templates/:id/like` — 点赞/取消点赞（需认证）
- `POST /api/v1/templates/:id/report` — 举报（需认证）
- `GET /api/v1/me/templates` — 我发布的模板
- `GET /api/v1/me/likes` — 我点赞的模板
- `GET /api/v1/me/stats` — 我的统计数据
- `GET /api/v1/admin/reports` — 举报队列（管理员）
- `PATCH /api/v1/admin/templates/:id` — 下架/恢复（管理员）
- `PATCH /api/v1/admin/users/:id` — 封禁/解封（管理员）

## 10. 交付阶段

### Phase 1 — 基础设施 + 浏览安装
**目标**：让用户能发现和使用市场模板

### Phase 2 — 发布能力
**目标**：让用户能贡献模板到市场

### Phase 3 — 社区互动 + 统计
**目标**：让市场有活力和发现性

### Phase 4 — 版本管理 + 治理
**目标**：让市场可持续运营

## 11. 与其他文档的关系

- **前置规格**：`docs/product-specs/canvas-template-feature.md` — 本地模板功能（本规格在其基础上扩展）
- **产品方向**：`docs/PRODUCT_SENSE.md` — 核心产品价值和目标用户
- **架构约束**：`ARCHITECTURE.md` — 协议边界、宿主集成方式
- **设计文档**：`docs/design-docs/template-marketplace.md` — 模板市场技术选型正式方案与 Phase 4 承载边界
- **UI 文档**：`docs/marketplace/UI.md` — 模板市场浏览器网站与 VSCode 插件内市场面板专用 UI 定义
- **执行计划**：`docs/exec-plans/active/template-marketplace-tech-selection.md`、`docs/exec-plans/active/template-marketplace-foundation.md`
