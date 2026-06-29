# 模板包形态与仓库设计调研

本 `ExecPlan` 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘` 这几个章节。本文位于 `docs/exec-plans/active/template-package-repository-research.md`，必须按 `docs/PLANS.md` 的要求持续维护。

## 目标与全局图景

这次研究要回答一个产品与工程边界问题：当模板发布不再只是上传一份 `template.json`，而是同时包含 slug、一句话描述、README、CHANGELOG、缩略图和后续版本信息时，Dev Session Canvas 是否应该把“模板”升级成“模板包”。完成后，协作者可以在本仓库设计文档中看到外部插件仓库的常见组织方式、它们对清单文件、内容文件、版本资产和索引元数据的取舍，以及本项目下一步应采用的模板包方向。用户可观察结果是：不再只收到口头建议，而是能追溯到正式设计文档中的研究结论和后续实现边界。

本计划只覆盖设计调研和方案建议，不直接改造发布 API、数据库 schema、R2 对象布局或 VSCode 发布表单。若后续进入实现，应另开实现型 `ExecPlan`。

## 进度

- [x] (2026-05-26 00:00 +0800) 读取 `docs/WORKFLOW.md`、`docs/PLANS.md`、`docs/DESIGN.md`、模板市场产品规格、模板市场设计文档、当前 shared schema 与发布实现，确认现状是发布字段分散在表单/API/数据库/R2 对象中。
- [x] (2026-05-26 00:05 +0800) 创建本设计研究 `ExecPlan`，限定为外部插件仓库调研与模板包方向建议，不直接进入实现。
- [x] (2026-05-26 21:30 +0800) 调研外部插件、扩展或包仓库的目录、manifest、文档和索引设计，覆盖 VS Code、Obsidian、Terraform、Helm、GitHub Actions、WordPress、Figma、Chrome、Home Assistant 和 JetBrains 等生态。
- [x] (2026-05-26 21:40 +0800) 对比外部设计与当前 Dev Session Canvas 模板市场发布链路，形成“模板包目录 / 模板包归档 + D1 派生索引 + R2 不可变版本对象”的建议。
- [x] (2026-05-26 21:45 +0800) 将设计结论同步到 `docs/design-docs/template-marketplace.md`，并同步 `docs/product-specs/template-marketplace.md` 与 `docs/design-docs/index.md`。
- [x] (2026-05-26 21:50 +0800) 汇总验证方式、残余风险和后续实现建议；本轮只改文档，验证以 `git diff --check` 为准。
- [x] (2026-05-26 22:05 +0800) 根据产品拍板补充模板包媒体资源策略、50MB 包大小、README 媒体安全规则、轻量安装和 `template version` / `listing revision` 分层。
- [x] (2026-05-27 00:00 +0800) 根据产品拍板补充模板包用户教育和落地顺序：发布页结构预览与 lint 先行，随后示例包 / 作者文档，再做 schema / 包上传，最后做 CLI / 命令面板创建与校验。

## 意外与发现

- 观察：成熟插件仓库几乎都把 manifest、README / 说明、CHANGELOG / 版本记录和媒体资源拆成独立文件，再由市场索引抽取少量字段；它们很少要求作者长期在发布表单里手填所有展示内容。
  证据：VS Code 使用 `package.json` + `README.md`，Obsidian 使用 `manifest.json` + GitHub release assets + 社区索引，Helm 使用 chart 包 + `index.yaml`，WordPress 使用 `readme.txt` + `assets/`。

- 观察：当前 Dev Session Canvas 发布 API 已经有 `template.json`、README、CHANGELOG、description、slug 和 thumbnail 的事实分散问题。
  证据：`MarketplacePublishTemplateRequest` 直接暴露这些字段，`template_versions` 保存 changelog 和 object key，R2 当前 canonical 下载对象仍是 `template.json`。

## 决策记录

- 决策：本轮先做设计研究和文档同步，不直接修改发布 API 或数据库结构。
  理由：用户当前提问是“调研其他工具怎么设计”，而模板包会影响 API contract、R2 对象布局、本地模板扫描和发布 UI，直接实现会跳过必要设计取舍。
  日期/作者：2026-05-26 / Codex

- 决策：后续模板市场以 `template-package.json`、`template.json`、`README.md`、`CHANGELOG.md` 和 `media/thumbnail.png` 组成 canonical 模板包，市场 D1 字段只作为索引和缓存派生。
  理由：这对齐外部插件仓库的常见形态，能让模板贡献者用文件管理包内容，也能继续支持浏览、搜索、详情和版本历史。
  日期/作者：2026-05-26 / Codex

- 决策：普通发布完整模板包采用 50MB 压缩包 hard limit，并将 README / 媒体变更归入 `listing revision`，不触发已安装模板更新。
  理由：图片和视频会显著扩大包体，但应用模板只依赖 `template.json`；轻量安装和版本分层可以避免 README typo 或截图调整打扰已安装用户。
  日期/作者：2026-05-26 / Codex

- 决策：模板包用户教育按“发布页渐进解释 -> 示例包和作者文档 -> schema / `$schema` / package upload -> CLI / 命令面板创建与校验”的顺序落地。
  理由：普通发布者不应被包格式劝退；高级作者需要文件化、可 Git 管理、可校验的工作流。
  日期/作者：2026-05-27 / Codex

## 结果与复盘

当前已完成外部模式调研和设计文档同步。`docs/design-docs/template-marketplace.md` 现在记录了外部插件仓库的包形态、Dev Session Canvas 推荐模板包目录、manifest 字段、R2 对象迁移方式、API 兼容策略、媒体大小限制、README 媒体安全策略、轻量安装、`template version` / `listing revision` 分层、用户教育路径和落地顺序；`docs/product-specs/template-marketplace.md` 补充了模板发布单元已确认升级为模板包；`docs/design-docs/index.md` 同步了设计索引。尚未完成的是代码实现、数据库迁移和端到端验证，后续应另开实现型 `ExecPlan`。

## 上下文与定向

当前模板市场已经有浏览、安装和发布能力。市场共享合约位于 `packages/marketplace-shared/src/index.ts`，其中 `MarketplacePublishTemplateRequest` 直接包含 `slug`、`name`、`description`、`tags`、`readme`、`changelog`、`templateDocument` 和 `thumbnailPngBase64`。Worker 发布准备逻辑位于 `apps/template-marketplace/src/worker/publish.ts`，它把 `templateDocument` 重新序列化为单个 `template.json`，同时把缩略图写成单独 `thumbnail.png`。D1 schema 位于 `packages/marketplace-shared/src/schema.ts`，其中 `templates` 表保存 `slug`、`name`、`description`、`readme` 等模板级元数据，`template_versions` 表保存 `changelog`、`objectKey`、`thumbnailKey`、`sha256` 和 `sizeBytes`。VSCode 端发布草稿位于 `extensions/vscode/dev-session-canvas/src/panel/TemplateMarketplaceClient.ts` 和 `extensions/vscode/dev-session-canvas/src/panel/CanvasTemplateMarketplacePanel.ts`，发布表单目前让用户逐项填写 README、CHANGELOG 和 Template JSON Preview。

“模板包”在本计划中指一个可版本化、可离线校验、可由 CLI/表单/仓库共同编辑的目录或归档单位。它至少包含模板主体、包清单、README、CHANGELOG 和媒体资源，并能由发布 API 转换成现有市场列表、详情、下载和安装行为。

## 工作计划

先基于外部官方文档和公开仓库调查成熟生态的插件/包组织方式，优先关注 VS Code Extension、Open VSX、Obsidian community plugins、Home Assistant custom integrations、Terraform Registry modules、Helm Chart Repository、GitHub Actions Marketplace、WordPress Plugin Directory、Figma Plugins 和 JetBrains Plugin Repository。每个案例只提炼与本项目相关的结构：manifest 放在哪里、README/CHANGELOG 是否是独立文件、版本对象如何发布、中心索引是否存储完整内容还是只存元数据、安装端下载什么。

随后把这些模式归纳成少数设计原型，例如“单 manifest 包”、“目录包 + 市场索引”、“Git 仓库即包”、“包注册表 + 展示页元数据”和“chart/index 聚合仓库”。再把原型映射到当前 Dev Session Canvas 的约束：本地模板仍需离线应用、市场需要版本历史和详情页、R2 适合不可变版本对象、D1 适合索引和统计、VSCode 发布表单不能长期成为唯一编辑器。

最后更新 `docs/design-docs/template-marketplace.md`，补充模板包研究结论和推荐方向；如果结论改变产品发布表单或 API 口径，再同步 `docs/product-specs/template-marketplace.md`。

## 具体步骤

在仓库根目录执行调研和文档修改。外部资料必须来自官方文档或官方仓库，引用时保留链接。完成文档修改后，至少运行 `git diff --check` 验证 Markdown 没有空白错误；如果只改文档且未触碰代码，不需要运行完整构建。

## 验证与验收

验收标准是 `docs/design-docs/template-marketplace.md` 包含可追溯的外部案例摘要、模式归纳、推荐模板包结构、发布链路调整建议、迁移边界和开放问题；最终回复用户时说明调研来源、结论和下一步建议。运行 `git diff --check` 应通过。

## 幂等性与恢复

本计划只新增和修改 Markdown 文档，可重复打开和补写。若后续实现发现模板包方向需要调整，应在本计划的 `决策记录` 和对应设计文档中补充新决策，而不是直接覆盖旧结论。

## 证据与备注

本轮文档修改后需要执行 `git diff --check`。由于只改 Markdown 和设计文档，不运行 `npm run build`。

## 接口与依赖

本研究不新增运行时接口。后续若实现模板包，应优先在 `packages/marketplace-shared/src/index.ts` 定义包 manifest 类型和解析函数，在 `apps/template-marketplace/src/worker/publish.ts` 接入包上传/展开，在 `extensions/vscode/dev-session-canvas/src/panel/TemplateMarketplaceClient.ts` 和 `extensions/vscode/dev-session-canvas/src/panel/CanvasTemplateMarketplacePanel.ts` 改造发布草稿和表单。

- 2026-05-26 / Codex：创建设计研究计划，原因是模板包会影响发布 contract、存储和本地安装语义，需先完成可追溯调研。
