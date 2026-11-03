# 精简公开 Release assets 并保留流程证据

本 `ExecPlan` 是活文档；进展、发现、决策与结果必须随实现持续更新，并遵循 `docs/PLANS.md`。

## 目标与全局图景

新批次发布在 GitHub Release 页面只公开两个带版本号的 VSIX 和一份发布 manifest。VSIX 对外命名为 `dev-session-canvas-X.Y.Z.vsix` 与 `dev-session-canvas-notifier-X.Y.Z.vsix`；manifest 继续记录版本、源码身份、包摘要和渠道状态。验收计划/回执、来源证明、产品 CHANGELOG、上下文与状态快照只作为 Actions artifacts 留在发布流程中。这样用户下载区不再混入内部校验文件，重试仍能从原始包和发布 run 独立验证，不会重新构建替换包。

本次只改变之后采用新批次格式的 Release。已有 0.27.0、0.28.0 等旧 Release 的名称和 assets 不改写；旧恢复路径继续可用。Actions 证据目前保留 90 天，过期后如果来源不能独立验证，恢复必须明确拒绝，而不能重打包冒充原包。

## 进度

- [x] (2026-11-03) 核对发布资产、状态链与 workflow artifact 生命周期，确认必须同时调整恢复验证而不能只删附件。
- [x] (2026-11-03) 确认新批次公开资产保持两个版本化 VSIX 和一份 manifest，旧 Release 保持兼容。
- [x] (2026-11-03) 在 `scripts/release/release-delivery.mjs` 分离新批次公开 manifest 与内部 `release-state-X.Y.Z.json`，发布外部版本化 VSIX，并保留原包字节。
- [x] (2026-11-03) 在重试恢复中由 compact manifest 定位实际 Actions producer/artifact，校验整条状态链与原批次，拒绝错误 manifest、过期证据和字节冲突。
- [x] (2026-11-03) 更新 workflow artifact、provenance parser、设计文档及发布流程文档；旧版 Release 合同未改动。
- [x] (2026-11-03) 完成定向发布、workflow、gate、历史恢复回归；复测发现 manifest 替换上传失败时应恢复旧摘要，补上回滚路径与故障注入用例，并检查 `git diff --check`。
- [x] (2026-11-03) 修复 channel-retry 对 finalize artifact 中 prepare/finalize 同名状态文件的误拒绝，并以完整 artifact 目录结构增加回归测试。

## 意外与发现

- 观察：发布过程的 `release-manifest-X.Y.Z.json` 既是最终渠道摘要，也是恢复状态；此外每次状态更新还上传一个按摘要命名的快照，形成越来越多的公开附件。
  证据：`scripts/release/release-state.mjs` 的 `saveReleaseState` 生成快照；`scripts/release/release-delivery.mjs` 的 `prepareRelease` 与 `finalizeRelease` 将 canonical manifest 和快照上传到 Release。
- 观察：完整 gate 与 package provenance 已来自 Actions artifacts，但当前恢复仍要求从 Release 下载大部分 gate 回执和原始上下文。
  证据：`verifyRecoveredRelease` 同时调用 `collectGitHubProvenance` 和 `recoverReleaseState`，并将下载的 Release 文件与原验收 producer 对照。
- 观察：批次与正式交付 workflow 中若干 artifacts 的保留期限为 90 天；超过期限后不能假定仍可独立验证原始 producer。
  证据：`.github/workflows/build-release-batch.yml`、`.github/workflows/publish-marketplace-release.yml`。
- 观察：新的 `release-state-X.Y.Z.json` 起初不会进入 artifact receipt digest 集合，导致 ZIP 内状态无法绑定到 producer receipt。
  证据：补充 `inspectArtifactArchive` 的新格式匹配规则后，新批次状态链集成测试通过。
- 观察：finalize artifact 同时包含准备阶段 artifact 解包目录与 finalize 根目录状态；canonical `release-state-X.Y.Z.json` 因处于不同状态阶段而合法地内容不同。
  证据：完整 `final-result` 测试夹具在 `actual-results/prepared-release-.../` 下保留 prepare 状态，并在根目录保存 finalize 状态；旧恢复逻辑在同名异字节检查处稳定失败。
- 观察：公开 compact manifest 必须原名替换，而 GitHub assets API 只能通过删除再上传完成；若上传失败后不回滚，唯一公开状态入口会消失。
  证据：为替换失败增加故障注入，验证旧 manifest 字节恢复且 Release 仍只有一个 manifest。

## 决策记录

- 决策：只对带 `batchFormat: 1` 的新批次使用版本化 VSIX 名称与精简公开文件集合；旧格式按原文件名及历史恢复合同处理。
  理由：历史 Release 是不可变发布记录；不能为统一命名而重写 0.27.0/0.28.0，也不能让新恢复逻辑误读旧格式。
  日期/作者：2026-11-03 / Codex，依用户确认的方案执行。
- 决策：Release 保留一份当前 manifest 作为稳定的产品/渠道摘要；状态快照、门禁、验收、来源及批次材料由 Actions artifacts 保存 90 天。
  理由：Release 页面需要一个可长期访问的机器可读结果；详细证据属于工作流审计材料。回执过期或丢失时拒绝恢复，不静默降低来源验证标准。
  日期/作者：2026-11-03 / Codex，依用户确认的方案执行。
- 决策：以发布 artifact 中状态快照和其真实成功/失败 producer 的 Action run 事实验证状态链；精简公开 manifest 保存可定位前序状态 producer 的必要链摘要。
  理由：移除 Release 上的 `state-*` 快照后仍要验证未完成的状态推进，并保留对重复、分叉、缺失与伪造证据的拒绝能力。
  日期/作者：2026-11-03 / Codex。
- 决策：内部状态文件使用独立的 `release-state-X.Y.Z.json`；公开 `release-manifest-X.Y.Z.json` 只记录产品摘要、渠道聚合状态及状态 artifact 定位信息。
  理由：同一文件不能同时满足“公开内容紧凑”和“恢复需要完整因果状态”，拆分后由摘要中的 digest 将二者绑定。
  日期/作者：2026-11-03 / Codex。
- 决策：恢复 finalize artifact 时，只把与公开 manifest 引用 digest 完全匹配的 canonical 状态副本交给状态链恢复；旧 canonical 副本必须有字节匹配的 digest 快照，且所有快照仍进入状态链验证。
  理由：同一 artifact 内嵌套的 prepare canonical 状态是 finalize 状态的前序版本，不应与当前状态争用同一个资产名；要求旧副本由快照证明，可避免忽略未关联状态，同时保持完整因果链验证。
  日期/作者：2026-11-03 / Codex，依据 channel-retry blocker 复审结论。

## 结果与复盘

新批次 Release 只发布两个版本化 VSIX 与 compact manifest；门禁回执、来源、完整状态链及快照保存在原 producer 对应的 Actions artifacts。重试从公开 manifest 找到最新 producer artifact，再核验状态链与原始字节。历史 Release 继续使用旧资产集合和恢复路径。

本机验证通过：`node scripts/test/test-release-batch.mjs` 23/23（新增完整 finalize artifact 嵌套状态回归）；`node scripts/test/test-release-delivery.mjs` 31/31，含 compact manifest 替换失败回滚；`node scripts/test/test-incomplete-release-recovery.mjs` 15/15；`node scripts/test/test-release-completion.mjs` 8/8；`node scripts/test/test-gate-contracts.mjs` 101/101；`node scripts/test/test-publish-marketplace-workflow.mjs` 通过；`node scripts/test/test-publish-tag-release.mjs` 通过；`git diff --check` 通过。

未发起真实 Marketplace 发布，也未迁移或改写 0.27.0、0.28.0 等历史 Release。Actions 证据超过 90 天或被删除后，不能独立证明原批次时恢复应拒绝；实际新合同仍待合并后首次 dispatch 验证，因此正式设计 `validation_status` 保持“验证中”。DELETE 请求成功但响应丢失时 manifest 暂时缺失的传输边界已登记于 `docs/exec-plans/tech-debt-tracker.md`，不宣称删除与上传具备端到端原子性。

## 上下文与定向

`.github/workflows/build-release-batch.yml` 生成封存批次；`.github/workflows/publish-marketplace-release.yml` 负责发布并将 prepare/finalize 证据作为 Actions artifacts 保存。`scripts/release/release-batch.mjs` 校验批次内容，`scripts/release/release-delivery.mjs` 下载、验收、上传与恢复，`scripts/release/release-state.mjs` 维护因果状态链，`scripts/release/release-github.mjs` 提供 GitHub Releases 与 workflow artifacts API。相关回归测试位于 `scripts/test/test-release-delivery.mjs`、`scripts/test/test-release-batch.mjs`、`scripts/test/test-publish-marketplace-workflow.mjs`。

“公开资产”指 GitHub Release 下载区的附件；“流程证据”指绑定具体 Actions run、job 和 artifact 的门禁、回执、来源与状态快照。新批次的内部输入继续使用 `main.vsix` 和 `notifier.vsix`，只在 prepare 上传时改名；内容字节及其 SHA-256 必须不变。旧格式通过是否带批次格式标记识别，不修改历史 Release。

## 工作计划

先实现并测试外部文件名与内部包名映射，保证 Release 资产列表严格限于两个版本化 VSIX 和当前 manifest。随后把新批次恢复所需的原始上下文、门禁/验收回执和 package receipt 从已核验的原始 Actions artifacts 还原，不再依赖公开 Release 附件；渠道状态 manifest 仍需与独立 producer run 和 artifact 证据一致。状态更新只替换 canonical manifest，不再逐次附加公开快照；prepare/finalize 的 Actions artifacts 继续包含状态快照。旧版 Release 沿用旧资产集合和旧恢复代码。

同步更新 `docs/design-docs/release-product-decoupling.md`、其索引及 `docs/WORKFLOW.md`，记录公开下载面、流程证据的边界和 90 天到期限制。测试需覆盖新格式发布/续传、字节与名称、严格资产名单、状态链真实 producer、完整证据过期/缺失的拒绝行为及旧格式恢复。

## 具体步骤

在 `/tmp/dev-session-canvas-release-assets` 中执行。定向测试使用 Node v25.6.0。隔离 worktree 复用已存在依赖目录完成测试，结束后删除临时 `node_modules` 符号链接。测试通过情况列于“结果与复盘”；不执行真实 Marketplace 发布，也不改写或上传历史 Release。

若 GitHub fixture 不具备下载 artifact 的生产接口，扩展现有可注入 collector，而不是在测试中绕过 producer/job/receipt 校验。若需要改变状态链格式，必须保留旧格式解析路径，并在发现与决策章节同步记录变更。

## 验证与验收

定向测试必须证明：新批次的 Release assets 恰为两个版本化 VSIX 与一个 manifest；两份外部 VSIX 与批次输入字节完全相同；重复 prepare 不覆盖同名冲突；状态重试能从 Actions producer artifact 校验状态，不要求公开 `state-*` 附件；任一前序 artifact 缺失、过期或 digest 不符都会拒绝恢复；旧格式 fixture 仍能按旧名字/附件恢复。workflow 合同测试应确认 Actions artifacts 仍保留完整证据，并设置 90 天期限。最后确认文档索引/frontmatter 对齐、链接有效且 `git diff --check` 通过。

## 幂等性与恢复

发布脚本必须先检查所有现存 Release assets，再上传任何缺项；相同名称但字节不同立即拒绝，不删除或覆盖旧内容。正式发布出现中断时仍使用同一个已验收批次，新工具从原包恢复。若精简 manifest 缺失，只有原始流程输入仍能独立验证时才允许安全补齐；如果流程证据过期或无法定位，则保留现场并拒绝重新打包。历史 Release 继续走原恢复路径，不作迁移。

## 证据与备注

关键验证记录：`test-release-batch.mjs` 覆盖首次上传中断后续传、三项公开资产精确清单、包字节不变、compact manifest 篡改拒绝、状态 artifact 过期拒绝，以及完整 producer 状态链重试。`test-release-delivery.mjs` 保持旧格式状态恢复及资产替换测试通过。真实 GitHub Actions / Marketplace 执行不在本次验证范围。

追加的 blocker 回归先在变更前以 `Producer artifact has conflicting copies of release-state-1.2.3.json` 失败；修复后同一完整目录 fixture 通过，证明 finalize artifact 中 prepare/finalize canonical 副本并存时可继续验证完整快照状态链。

## 接口与依赖

新批次通过 `packageAssetName` 从内部包角色与版本得到外部 asset name；旧格式继续使用原文件名。`verifyBatchRelease` 先调用 `readReleaseBatch` 独立验证批次，再把已验证批次输入交给 `verifyRecoveredBatchRelease`。后者复用 `collectReleaseFacts` 与 `recoverReleaseState` 定位并核验来源真实 run/job/artifact、回执 digest、状态快照因果链和原包 SHA；不引入旁路下载器。`inspectArtifactArchive` 将新内部状态 JSON 纳入 receipt digest。

每次计划修订后，更新全部相关章节，并在这里补充变更与原因。

计划创建于 2026-11-03：先将用户确认的资产收敛方向、兼容范围与恢复验证要求落为自包含执行规格，避免只删除上传文件而破坏中断续跑。2026-11-03 更新：实现后补入状态文件/compact manifest 分离、Actions artifact proof 行为、完整回归结果与未执行真实发布的边界，并将计划收口归档。
