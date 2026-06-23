# 升级模板市场的画布分组模板支持

本 `ExecPlan` 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘` 这几个章节。

本计划遵循 `docs/PLANS.md`。该文件要求计划自包含、持续维护，并且每次停顿都要把当前进度、发现、决策和验证证据写回计划。

## 目标与全局图景

当前分支已经合并了 `origin/main`，主线本地画布模板已经能保存并应用画布分组：用户把一组节点放进画布分组后，保存为本地模板再应用，分组树和节点成员关系会被重建。模板市场仍使用自己的共享 schema、发布解析、包格式规范化和缩略图生成链路；这些链路还不知道 `groups`、`node.groupIndex` 和 `group.parentGroupIndex`，因此分组模板在发布或安装经过市场时会被 Zod 对象解析静默裁掉分组字段。

这次升级完成后，用户可以把包含画布分组的模板发布到市场、从市场包安装回来，并在缩略图中看到分组框。可观察结果是：新增的 marketplace shared 测试会证明 schema 保留分组并拒绝无效分组引用；缩略图测试会证明分组输入参与渲染；发布链路的文本采集会覆盖分组标题，避免治理扫描漏掉分组名称。

## 进度

- [x] (2026-06-23 10:55Z) 已确认当前工作区位于 `template-marketplace-preview-validation-stability`，合并 `origin/main` 后没有新的代码改动，只有既有未跟踪 fixture zip 和 `image.png`。
- [x] (2026-06-23 11:05Z) 已创建本计划，明确升级范围：共享 schema、缩略图、发布治理文本、测试和正式文档。
- [x] (2026-06-23 11:38Z) 已升级 `packages/marketplace-shared/src/index.ts` 的类型与 Zod schema，使 marketplace template document 对齐本地模板分组字段并校验引用。
- [x] (2026-06-23 11:38Z) 已补充 `packages/marketplace-shared/src/index.test.ts`，覆盖分组保留、节点 groupIndex 越界、group 自引用和 parent cycle。
- [x] (2026-06-23 11:42Z) 已升级 `packages/marketplace-shared/src/thumbnail.ts` 及测试，让分组框参与 bounds 和绘制。
- [x] (2026-06-23 11:42Z) 已升级 `apps/template-marketplace/src/worker/publish.ts` 的文本字段采集，把分组标题纳入内容安全扫描，并补充 API 测试。
- [x] (2026-06-23 11:46Z) 已更新 `docs/design-docs/template-marketplace.md` 和 `docs/product-specs/template-marketplace.md`，记录市场模板 schema 承载用户分组树，同时继续排除 file/file-list 成员。
- [x] (2026-06-23 11:49Z) 已运行针对性验证并把结果写入本计划。
- [x] (2026-06-23 18:35Z) 复审评论指出扩展侧 canonical parser/store 仍会在市场安装路径裁掉分组字段，已将本地模板 parser、capture、install apply 和状态持久化补齐到保留 `groups`、`node.groupIndex` 与 `group.parentGroupIndex`。
- [x] (2026-06-23 18:48Z) 已补充 `scripts/test/test-canvas-templates.mjs` 的市场完整包安装、解析 round-trip、capture 分组树和非法分组引用回归，并重新运行完整验证。

## 意外与发现

- 观察：`packages/marketplace-shared/src/index.ts` 当前的 `marketplaceTemplateDocumentSchema` 只声明 `nodes` 和 `edges`，没有 `groups`；Zod 对象默认会剥离未知字段，所以不是“忽略但保留”，而是会在 publish/package canonicalization 时丢失字段。
  证据：`marketplaceTemplateDocumentSchema` 的 `template` 对象只包含 `id/name/category/nodes/edges/createdAt/updatedAt`，`marketplaceTemplateNodeSchema` 没有 `groupIndex`。

- 观察：共享 schema 升级后，现有 marketplace shared 测试仍通过，新增用例把测试数从 23 个提升到 27 个。
  证据：`npm run test:marketplace-shared` 输出 `src/index.test.ts (21 tests)`、`src/thumbnail.test.ts (6 tests)`，总计 `27 passed`。

- 观察：缩略图升级后，marketplace shared 测试总数提升到 28 个；Worker 发布测试增加分组标题内容安全用例后，marketplace API 测试总数提升到 90 个。
  证据：`npm run test:marketplace-shared` 输出 `src/thumbnail.test.ts (7 tests)` 和 `Tests 28 passed`；`npm run test:marketplace-api` 输出 `src/worker/app.test.ts (61 tests)` 和 `Tests 90 passed`。

- 观察：完整针对性验证、根 typecheck 和 build 均清洁通过。
  证据：`npm run test:marketplace-shared && npm run test:marketplace-api && npm run typecheck:marketplace && npm run test:canvas-templates && npm run test:marketplace-web && git diff --check` 退出码为 0；随后 `npm run typecheck` 与 `npm run build` 退出码也为 0。

- 观察：市场共享 schema 支持分组后，扩展侧 `parseCanvasTemplateDocument()` 与 `CanvasTemplateStore.writeMarketplaceTemplatePackage()` 仍会重新解析并写回 `template.json`；如果本地模板模型不保留分组，完整包安装和内联安装都会确定性丢分组。
  证据：PR #194 review 评论指出 `src/common/canvasTemplates.ts`、`src/panel/CanvasTemplateStore.ts` 和 marketplace schema 的不一致；修复后新增 canvas template 回归覆盖完整包安装写回 `template.json` 后仍保留 `groups` 和 `nodes[].groupIndex`。

## 决策记录

- 决策：市场模板 schema 直接支持本地模板 v1 的用户分组树字段：`template.groups`、`node.groupIndex`、`group.parentGroupIndex`。
  理由：发布、浏览器包上传、Worker package canonicalization 和 VS Code 安装都经过 marketplace shared schema；只有共享 schema 支持这些字段，才能避免分组信息在任一入口被静默裁掉。
  日期/作者：2026-06-23 / Codex。

- 决策：本次不把 `file` / `file-list` 节点作为模板市场主体引入，也不把多根 workspace root 分组序列化进 marketplace template document。
  理由：主线设计只要求模板保存用户可复用的画布节点、边和用户分组树；文件/文件列表不是 template member，多根 workspace root 是当前工作区结构，不应成为可分发模板内容。
  日期/作者：2026-06-23 / Codex。

- 决策：`minExtensionVersion` 安装门禁作为后续 P1 技术债处理；本次先修复 P0 的 schema 数据丢失和基础渲染/治理漏扫。
  理由：`minExtensionVersion` 已在包 manifest 设计中存在，但安装门禁需要版本比较和客户端安装路径补充；它不影响分组字段是否被保留，混入本次会扩大回归面。
  日期/作者：2026-06-23 / Codex。

- 决策：保留市场 schema 和文档对“安装解析保留分组”的声明，并在扩展侧补齐本地模板分组解析、capture 与 apply，而不是撤回分组支持声明。
  理由：市场发布、包规范化和安装路径最终都会进入扩展侧 canonical parser/store；只有两侧 schema 对齐，用户从市场安装包含分组的模板时才不会经历字段被接受后又被裁掉的断裂。
  日期/作者：2026-06-23 / Codex。

## 结果与复盘

已完成 schema、缩略图和 Worker 治理文本升级：marketplace template document 现在声明并保留用户分组树，能拒绝越界、自引用和循环父子关系；缩略图会绘制分组框；分组标题会进入内容安全扫描。剩余工作是正式文档和完整验证。

已同步正式设计与产品规格：模板市场 `template.json` 的主体范围明确包含用户创建的画布分组树，但仍排除 `file` / `file-list` 节点和多根 workspace root 分组。

本计划已完成。交付物包括 marketplace shared schema 与类型升级、分组引用校验、缩略图分组框渲染、Worker 发布内容安全分组标题采集、扩展侧本地模板 parser/capture/apply 分组保留、API/shared/canvas template 测试覆盖，以及设计文档和产品规格同步。未新增需要登记到 `docs/exec-plans/tech-debt-tracker.md` 的阻塞技术债；此前已知的 `minExtensionVersion` 安装门禁仍属于模板市场包能力后续 P1，不影响本次分组字段保留。

## 上下文与定向

本仓库的本地画布模板模型在 `src/common/canvasTemplates.ts`。相关结构包括 `CanvasTemplateNodeSnapshot.groupIndex?: number`、`CanvasTemplateGroupSnapshot` 和 `CanvasTemplate.groups?: CanvasTemplateGroupSnapshot[]`。本地解析会检查节点的 `groupIndex` 是否指向已有分组，检查分组的 `parentGroupIndex` 是否指向已有分组且不能自引用，并拒绝父子关系成环。应用模板时，`src/panel/CanvasPanelManager.ts` 会先为模板分组分配新的运行时 group id，再把节点放回对应分组。

模板市场使用独立共享包 `packages/marketplace-shared`。`src/index.ts` 导出 API 类型、Zod schema、种子数据和辅助函数。市场发布客户端 `src/panel/TemplateMarketplaceClient.ts`、网页发布页 `apps/template-marketplace/src/web/components/TemplatePublishView.tsx`、Worker 发布接口 `apps/template-marketplace/src/worker/publish.ts` 都复用 marketplace shared schema 来解析模板文档和包 manifest。因为 Zod 对象默认剥离未声明字段，当前 schema 未声明分组字段会导致分组信息在发布草稿、包上传规范化和安装解析时丢失。

缩略图生成位于 `packages/marketplace-shared/src/thumbnail.ts`。它目前只根据 nodes 和 edges 计算 bounds 并绘制节点/连线。分组升级后，缩略图应该把 group rect 纳入 bounds，并在节点和连线背后绘制轻量分组框，使用户浏览市场时能看出模板包含组织结构。

Worker 发布治理文本采集位于 `apps/template-marketplace/src/worker/publish.ts` 的 `collectTemplateDocumentTextFields()`。它会把模板名称、节点标题、note 内容等加入审核文本。分组有用户可输入的 `title`，也应进入文本采集。

## 工作计划

第一步修改 `packages/marketplace-shared/src/index.ts`。新增 `MarketplaceTemplateGroupSnapshot` 接口，把 `MarketplaceTemplateDocument.template.groups?: MarketplaceTemplateGroupSnapshot[]` 和 `MarketplaceTemplateNodeSnapshot.groupIndex?: number` 加入类型。新增 `marketplaceTemplateGroupSchema`，字段为 `title`、`position`、`size` 和可选 `parentGroupIndex`。在 `marketplaceTemplateDocumentSchema.superRefine()` 中继续校验 edge node index，同时新增 node group index 越界、group parent 越界、自引用和 parent cycle 校验。校验逻辑应保持普通、可读，不引入新依赖。

第二步补充 `packages/marketplace-shared/src/index.test.ts`。在既有 publish request 测试附近新增 grouped template 用例，断言 parse 后仍有 `template.groups`、节点仍有 `groupIndex`。再新增三个拒绝用例：节点指向不存在 group、group 指向自身、两个 group 互相作为 parent 形成 cycle。错误信息应包含可定位字段名，方便用户知道修复哪里。

第三步修改 `packages/marketplace-shared/src/thumbnail.ts`。扩展缩略图输入类型，允许 `groups` 和 node `groupIndex`。`measureBounds()` 应同时纳入 node rect 和 group rect。绘制顺序应为背景、group frame、edge、node。group frame 使用轻量填充、虚线或半透明边框和标题标签，不覆盖节点主体。

第四步修改 `apps/template-marketplace/src/worker/publish.ts`。在 `collectTemplateDocumentTextFields()` 中遍历 `document.template.groups ?? []`，将每个 group title 加入返回字段。这个改动让分组标题参与同一套安全/审核文本流程。

第五步更新正式文档。优先更新 `docs/design-docs/template-marketplace.md`，说明 marketplace template document 对齐本地模板分组字段并校验引用，发布和安装包应保留用户分组树；同时写明 `file` 和 `file-list` 不进入市场模板主体，避免误解为漏做。

第六步运行验证。至少运行 `npm run test:marketplace-shared`、`npm run typecheck:marketplace`、`npm run test:canvas-templates`、`git diff --check`。如果 Worker/Web 类型受影响，再运行 `npm run test:marketplace-api` 或 `npm run test:marketplace-web`。

## 具体步骤

在仓库根目录 `/home/users/ziyang01.wang-al/projects/dev-session-canvas.worktrees/dev-session-canvas3` 执行所有命令。

先修改共享 schema 和测试：

    npm run test:marketplace-shared

预期 marketplace shared 测试全部通过，新增分组测试证明字段被保留且无效引用被拒绝。

再修改缩略图和 Worker 文本采集后运行：

    npm run typecheck:marketplace
    npm run test:canvas-templates
    git diff --check

预期 typecheck 无错误，canvas template 测试仍通过，diff 中没有空白错误。

## 验证与验收

验收标准一：一个包含 `groups`、`node.groupIndex` 和嵌套 `parentGroupIndex` 的 `marketplacePublishTemplateRequestSchema.parse()` 调用返回后仍保留这些字段。

验收标准二：当节点引用不存在的 group、group 自己引用自己、或 group parent 关系成环时，schema parse 抛出错误，错误路径指向对应字段。

验收标准三：缩略图生成器对带 group 的模板会把 group rect 纳入 bounds 并绘制 group frame；测试通过证明该行为没有退化为只看 nodes/edges。

验收标准四：Worker 发布文本采集包含分组标题，保证分组名称和节点标题一样进入治理扫描。

## 幂等性与恢复

所有代码修改都限制在仓库工作区。测试命令可以重复运行。不要删除或重生成当前未跟踪的 `apps/template-marketplace/fixtures/r2/templates/*/package.zip` 和 `image.png`，它们不是本计划产生的文件。若某个测试失败，优先查看新增 schema 错误路径和类型定义，不要回滚用户已有改动；只回滚本计划引入的相关 diff。

## 证据与备注

初始工作区状态显示当前分支没有已跟踪文件改动，只有既有未跟踪文件：

    ## template-marketplace-preview-validation-stability...origin/template-marketplace-preview-validation-stability [gone]
    ?? apps/template-marketplace/fixtures/r2/templates/tmpl-getting-started/versions/1/package.zip
    ?? apps/template-marketplace/fixtures/r2/templates/tmpl-release-readiness/versions/1/package.zip
    ?? apps/template-marketplace/fixtures/r2/templates/tmpl-review-loop/versions/1/package.zip
    ?? apps/template-marketplace/fixtures/r2/templates/tmpl-review-loop/versions/2/package.zip
    ?? image.png

共享 schema 升级后的首轮测试记录：

    npm run test:marketplace-shared
    ✓ src/thumbnail.test.ts (6 tests) 606ms
    ✓ src/index.test.ts (21 tests) 23ms
    Test Files  2 passed (2)
    Tests  27 passed (27)

缩略图和 Worker 治理文本升级后的测试记录：

    npm run test:marketplace-shared
    ✓ src/index.test.ts (21 tests) 39ms
    ✓ src/thumbnail.test.ts (7 tests) 806ms
    Tests  28 passed (28)

    npm run test:marketplace-api
    ✓ src/worker/app.test.ts (61 tests) 123ms
    Test Files  5 passed (5)
    Tests  90 passed (90)

最终验证记录：

    npm run test:marketplace-shared && npm run test:marketplace-api && npm run typecheck:marketplace && npm run test:canvas-templates && npm run test:marketplace-web && git diff --check
    ✓ src/index.test.ts (21 tests)
    ✓ src/thumbnail.test.ts (7 tests)
    ✓ src/worker/app.test.ts (61 tests)
    ✓ src/web/components/TemplatePublishView.test.ts (3 tests)
    Tests  28 passed (28)
    Tests  90 passed (90)
    Tests  41 passed (41)

    npm run typecheck
    tsc --noEmit

    npm run build
    node scripts/build/build.mjs

复审修复后的回归验证记录：

    npm run test:canvas-templates
    npm run typecheck
    npm run test:marketplace-shared
    npm run test:marketplace-api
    npm run typecheck:marketplace
    npm run test:marketplace-web
    git diff --check
    npm run build

这些命令均已通过。验证范围覆盖本地模板解析、市场完整包安装写回、市场 shared/API/Web 回归、根类型检查和扩展构建；未执行真实 VS Code 端到端市场安装。

## 接口与依赖

在 `packages/marketplace-shared/src/index.ts` 中必须存在以下接口字段：`MarketplaceTemplateDocument.template.groups?: MarketplaceTemplateGroupSnapshot[]`、`MarketplaceTemplateNodeSnapshot.groupIndex?: number`、`MarketplaceTemplateGroupSnapshot.parentGroupIndex?: number`。`marketplaceTemplateDocumentSchema` 必须保留这些字段，并在 `superRefine()` 中校验引用关系。

在 `packages/marketplace-shared/src/thumbnail.ts` 中，`ThumbnailTemplateDocument.template.groups` 和 node `groupIndex` 应作为可选输入字段存在。缩略图函数不需要理解运行时 group id，只使用模板内数组下标作为关系引用。

计划更新记录：2026-06-23 创建计划，原因是模板市场分组升级跨越共享 schema、发布链路、缩略图、测试和设计文档，符合 `docs/PLANS.md` 对复杂功能使用 ExecPlan 的要求。

计划更新记录：2026-06-23 完成共享 schema 与 index 测试后更新进度和证据，原因是计划必须持续反映当前真实状态。

计划更新记录：2026-06-23 完成缩略图和 Worker 治理文本升级后更新进度和证据，原因是计划必须记录跨链路行为已经覆盖到测试。

计划更新记录：2026-06-23 完成正式设计文档与产品规格同步后更新进度，原因是仓库要求涉及设计和产品结论的实现必须同步文档。

计划更新记录：2026-06-23 完成最终验证和复盘后更新计划，原因是计划完成时必须记录可证明有效的工作结果和剩余技术债判断。

计划更新记录：2026-06-23 处理 PR #194 复审 blocker 后补充计划，原因是修复范围从 marketplace shared 扩展到扩展侧 canonical parser/store，必须记录新增决策、证据和残余验证边界。
