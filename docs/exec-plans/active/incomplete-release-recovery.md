# 恢复未开始渠道交付的空 Release

本 `ExecPlan` 是活文档，必须按照 `docs/PLANS.md` 持续更新进度、意外与发现、决策记录和结果与复盘。

## 目标与全局图景

用户希望完成 `v0.27.0` 发布，同时保留已经公开创建的 `v0.27.0` Release 和两个仍一致的 tag。原恢复 run 已在原 SHA 完整验收，GitHub Release 双包和 Open VSX 已验证。用户随后明确要求：在 Visual Studio Marketplace 重新打通前，不再尝试该渠道。发布收尾应只依赖 GitHub Release assets 与 Open VSX，把 VSM 记为本轮未查询、未提交的 deferred 状态，并保留原 release SHA。

本计划此前增加了范围严格的 `incomplete-release-recovery` 模式，并已经用它恢复 Release assets 与 Open VSX。现在还需更新发布 workflow：只有仓库变量 `VISUAL_STUDIO_MARKETPLACE_ENABLED` 精确为 `true` 才运行 VSM job；关闭时必须验证 job 为 skipped 且没有 VSM 结果工件，再将两个包记为 deferred。这样能通过现有 channel-retry 使用原双包完成 GitHub/Open VSX 收尾，而不访问 VSM。最终 tag 不移动；必需渠道完成并写入状态后才按常规流程删除临时 `publish/` tag。

## 进度

- [x] (2026-10-30) 已确认原发布 run `41041508908` 的失败阶段为 `prepare-release`，验收通过、两个渠道 job skipped，GitHub Release 无资产，两个 tag 均指向 `034c5a02894dab45fdbde9b877e787fa4f91f242`。
- [x] (2026-10-30) 已确认修复已在 PR #346 合并至 main，合并后 Release Preflight run `41058697974` 成功。
- [x] (2026-10-30) 已选定保留原 SHA 和 Release/tag 的受控恢复方案，并更新设计、工作流入口与本计划。
- [x] (2026-10-30) 已实现来源 run、job、双 tag、Release 正文与资产范围校验；prepare 阶段再次核对 Release 状态并只接受相同字节的已有资产。
- [x] (2026-10-30) 已调整发布 workflow：恢复模式的验收仍使用原 tag SHA 的完整 `release-tag` 任务图，交付阶段使用 `main` workflow checkout 中的修复脚本。
- [x] (2026-10-30) 已补充恢复模式回归与 workflow 合同测试，并同步工作流和设计文档。
- [x] (2026-10-30) `npm run test:publish-tag-release`、`npm run test:publish-marketplace-workflow` 均通过；显式串行完整 CI gate 命令通过 158 项、0 失败；`git diff --check` 通过。
- [x] (2026-10-30) 拉取并核对最新 `origin/main`（`58a4ec2`），提交 `06998de7`，推送 `release-incomplete-release-recovery` 并创建面向 `main` 的 PR #347。
- [x] (2026-10-30) PR #347 head `950bbd70` 的 Release Preflight / `Verify release contract` 成功；Code Review 指出新的恢复 run 若在 manifest 前中断，run-bound `gate-plan.json` 阻止新 run 续传。
- [x] (2026-10-31) 增加 `recovery_previous_run_id`：只接受同一 main workflow head、同一原失败发布 run、resolve 成功、prepare 失败且渠道/finalize 均 skipped 的前次恢复；从真实 resolve artifact 验证其 context，并固定最初产生 run-bound 文件的验收 run。
- [x] (2026-10-31) 新 prepare 仍须通过本次完整验收门禁，然后独立下载并验证固定验收 run 的 acceptance/candidate artifacts；仅复用其原始回执与双包，保持已有资产字节不变。
- [x] (2026-10-31) 增加双 run ID 回归：首个恢复 run 在上传 `gate-plan.json` 后中断，第二个恢复 run 复用原验收 batch 并完成剩余资产和 manifest；错误前次阶段在写操作前被拒绝。
- [x] (2026-10-31) 显式串行发布 gate suite 通过 `159/159`；workflow 合同、发布 CLI、Node 语法与 `git diff --check` 通过。
- [x] (2026-10-31) PR #347 以 merge commit `d42d6a03` 合并；最新 head 的 277 项检查全通过，review 未发现确定性 blocker。
- [x] (2026-10-31) 恢复 run `41157851285` 的原 SHA 全量验收和 prepare 成功；GitHub 双包资产内容校验通过，Open VSX 主扩展与 notifier 均 verified。
- [x] (2026-10-31) 将 VSCE 日志改为每个 package 独立文件，并新增真实 `runProcess` 回归重现独占创建；`test:publish-marketplaces`、`test:publish-tag-release`、发布 workflow 合同测试和 `git diff --check` 均通过。
- [x] (2026-10-31) 用户明确要求暂停所有 Visual Studio Marketplace 查询与提交，直到发布链重新打通；此前的 `EEXIST` 失败不能当作市场拒绝证据，也不再以重试 VSM 作为收尾条件。
- [ ] 更新 PR #348 的 release workflow：仓库变量缺失/关闭时跳过 VSM job；resolver 固定 deferred 状态；finalize 核实 job skipped、无 VSM artifact 后，将缺少的 VSM 结果记为 deferred，不查询市场。
- [ ] 更新发布设计、工作流和本 ExecPlan；提交 PR head 后等待 Release Preflight 与正式复审。
- [ ] PR 合并后，通过 `channel-retry` 完成原 `v0.27.0` GitHub Release + Open VSX 收尾，确认 VSM 无查询/提交、manifest 为 deferred、临时 tag 按完成门禁收口。

## 意外与发现

- 观察：失败发生在任何渠道 job 开始前，因此这次失败没有由该 run 向 Open VSX 或 Visual Studio Marketplace 写入。
  证据：Actions run `41041508908` 中 `Release prepare-release` 为 failure，`Release publish-open-vsx` 和 `Release publish-visual-studio` 为 skipped；`v0.27.0` Release assets 列表为空。
- 观察：旧 `publish/v0.27.0` 指向的提交不包含 `Content-Length` 修复，重跑该 tag 会重新使用旧发布代码。
  证据：`publish/v0.27.0` 与 `v0.27.0` 都指向 `034c5a0`；修复合并提交为 `58a4ec2`。
- 观察：普通 `channel-retry` 不适用于空 Release。
  证据：`scripts/release/release-delivery.mjs::verifyRecoveredRelease` 要求所有固定资产唯一存在；`prepareRelease` 在恢复模式下不会替换缺失资产。
- 观察：把 `--test-concurrency=1` 作为 npm script 追加参数放到文件列表后，Node 仍同时启动了多个测试文件。为排除并行时限噪声，完整门禁改为直接调用 `node --test --test-concurrency=1`，并将选项放在测试文件列表前。之前一轮在主动中断时报告了 cancelled/pending promise，不作为通过或代码失败证据。
- 观察：`gate-plan.json` 将当前 `GITHUB_RUN_ID` 和 `GITHUB_RUN_ATTEMPT` 写入 `plan.run`，而恢复资产循环在所有固定资产通过前不会写状态 manifest。新 workflow run 重试时，已上传旧 run `gate-plan.json` 的字节必然不同；resolver 虽允许该白名单资产，prepare 的逐字节检查却会拒绝，且无 manifest 的 `channel-retry` 不能接手。
  证据：`scripts/gates/resolve-plan.mjs` 将 `GITHUB_RUN_ID` / `GITHUB_RUN_ATTEMPT` 写入 plan；`scripts/release/release-delivery.mjs::prepareRelease` 按 `immutableReleaseFiles` 字节核对后才在循环末尾写 manifest；`verifyRecoveredRelease` 和 `recoverReleaseState` 都要求完整资产及可验证状态根。
- 观察：把 `--test-concurrency=1` 作为 npm script 的追加参数放到文件列表后，Node 仍启动了多个测试文件。为避免并行时限噪声，完整门禁必须直接调用 `node --test --test-concurrency=1`，并把选项放在测试文件列表前。上一轮在 152 秒后被主动中断，取消时两个文件报告 pending promise；该轮不能作为通过或代码失败证据。
- 观察：首个受控恢复 run 的完整验收成功，GitHub Release 双包 assets 均与原验收 SHA 匹配，Open VSX 两个包也 verified；Visual Studio job 则因本地日志文件冲突抛出 `EEXIST`，没有产出有效 `channel-partial.json`。finalize 报告 `Missing or invalid channel result`，manifest 将 VSM 两个包保留为 `pending-verification`。该失败证据指向脚本异常，不证明官方市场拒绝了发布。
  证据：run `41157851285` 的 VSM job `124418185218` 与 finalize job `124420199389`；`visualStudioClient` 两次提交都把同一路径传给 `runProcess`，而进程日志以 `flags: 'wx'` 独占创建。
- 观察：合并后 main push Preflight `41157272719` 也未通过：`packaged-host/canvas-notes--markdown-association` 的一个真实任务失败，`verify-result` 与稳定检查随后失败；PR head 上该检查曾通过，恢复 run 对原 tag 的完整验收也通过。需单独重跑失败任务确认是否为环境抖动，不能把该次 main run 报成通过。
- 观察：release finalize 目前把任意缺少的渠道结果都判为失败；即使 VSM 是 optional，缺少其 result artifact 仍会留下失败 manifest 和 kept trigger tag。
  证据：`calculateReleaseCompletion` 对没有 partial 的每个渠道都加入 missing-result error；`finalizeRelease` 把缺少的 VSM artifact 当作 evidence error。
- 观察：恢复 run `41157851285` 的 VSM job 因第二个包打开共用日志文件时报 `EEXIST`，未产出可验证渠道结果；用户随后明确要求停止任何 VSM 尝试。
  证据：Release manifest asset `694161536` 的状态为 `failed`，VSM 错误为 `Missing channel result or producer evidence`；Open VSX 两包与 GitHub 双包有独立 verified 证据。

## 决策记录

- 决策：保留已有正式 tag、临时 trigger tag 和 GitHub Release，不删除、不移动，也不创建同版本替代 tag。
  理由：版本身份已对外创建；改写它会破坏原发布 SHA 的审计链。恢复应针对原 SHA 完成。
  日期/作者：2026-10-30 / Codex
- 决策：用独立 `incomplete-release-recovery` 模式处理“prepare 失败、所有渠道 job 均 skipped、无 manifest/state”的初始发布失败；部分渠道写入仍只走 `channel-retry`。
  理由：初始资产缺失与部分交付后的恢复具有不同证据来源。不能把成功验收、候选 VSIX 和渠道状态拼接，也不能让 retry 任意重打包。
  日期/作者：2026-10-30 / Codex
- 决策：恢复 run 在原 release SHA 上重新完整验收，恢复的 prepare/channel/finalize orchestration 则运行于该 workflow 的当前 `main` SHA。
  理由：产品输入和 VSIX 必须来自正式 tag SHA；发布脚本必须包含已经合并的上传修复。所有步骤仍由同一个 Actions run 与回执链绑定。
  日期/作者：2026-10-30 / Codex
- 决策：重试时允许已有固定名称资产继续存在，但只接受与本次新验收同批文件逐字节相同的资产；遇到不同内容或非白名单资产必须拒绝。
  理由：确认过的远端资产不应被覆盖或静默换包。网络中断后只能验证同内容并继续。
  日期/作者：2026-10-30 / Codex
- 决策：恢复再次中断且尚未写入状态根时，后续 run 使用可选的 `recovery_previous_run_id` 指向前次恢复 run；resolver 必须证明它来自同一 main SHA、绑定同一原始失败 run、resolve 成功、prepare 失败且渠道/finalize 均 skipped，再从该 run 的真实 `resolve-release` artifact 中读取原 recovery context。prepare 还要独立验证该 run 的完整 acceptance/candidate artifacts，并继续消费首次生成远端资产的固定 artifact run，因此已有 run-bound Release assets 保持逐字节一致。
  理由：`gate-plan.json` 等验收证据包含 workflow run 身份，新 dispatch 必然生成不同字节。复用已验证的前次产物可以保持不可变资产与真实 producer 绑定，不需要覆盖或删除远端资产。若前次 run 已生成 manifest/state，普通 `channel-retry` 仍为唯一恢复方式。
  日期/作者：2026-10-31 / Codex
- 决策：连续续跑时，`recovery_previous_run_id` 可指向最近一次 prepare 失败的恢复 run，但上下文始终传播首次生成远端 run-bound 文件的 `recoveryArtifactRun`。
  理由：每次 workflow dispatch 都会生成不同的 run-bound acceptance 文件。最近 run 用于核对失败形状；首次 recovery artifact run 用于保持 Release 已上传证据的 producer 与原字节不变。
  日期/作者：2026-10-31 / Codex
- 决策：`VISUAL_STUDIO_MARKETPLACE_ENABLED` 只有精确为 `true` 才启用 VSM job；缺失或关闭时，resolver 将 `visual-studio` 固定为 deferred，finalize 必须检查该 job 为 skipped 且没有渠道结果工件后，才能接受无 VSM partial 的 completion。
  理由：用户要求在发布链重新打通前不再尝试 VSM。把停用状态纳入冻结 release context，并核对真实 Actions job/artifacts，能证明本轮没有访问该市场，同时保留 GitHub/Open VSX 的既定必需门禁。
  日期/作者：2026-10-31 / 用户决定，由 Codex 落地

## 结果与复盘

恢复 resolver、跨 run 续跑修复和 PR #347 已合入。恢复 run `41157851285` 的 GitHub Release assets 与 Open VSX 已有完整证据；VSM job 因日志路径 `EEXIST` 退出，finalize 未完成，临时 trigger tag 保留。用户决定不再尝试 VSM，直到账号/发布链重新打通。本计划现在收口为：发布 workflow 默认跳过 VSM、以经核实的 skipped job 记 deferred，并用原 VSIX 完成 GitHub/Open VSX 收尾。最终成功标准是原 tag 身份不变、双包与 Open VSX 均 verified、VSM 明确显示本轮未查询/未提交的 deferred，且临时 trigger tag 按完成门禁收口。

## 上下文与定向

`docs/WORKFLOW.md` 定义外层发布顺序；`.github/workflows/publish-marketplace-release.yml` 编排 resolver、完整验证、prepare、渠道与 finalize；`.github/workflows/release-validation.yml` 根据模式选择完整验收或现有状态恢复。`scripts/release/release-delivery.mjs` 负责固定 tag、消费 CI 工件、上传并校验 Release 资产；`scripts/release/publish-tag-release.mjs` 是阶段入口；`scripts/release/release-completion.mjs` 校验传递给各 job 的上下文；`scripts/release/release-state.mjs` 将状态绑定到真实 workflow artifact producer。

当前恢复输入仍为 `publish/v0.27.0`，源 SHA 为 `034c5a02894dab45fdbde9b877e787fa4f91f242`。正式 `v0.27.0` 与临时 tag 仍指向该 SHA。GitHub Release `v0.27.0` 已包含同批 main/notifier VSIX、验收资料和 manifest；manifest 记录 GitHub assets content-verified、Open VSX 两包 verified，但整体 `releaseCompletion.status` 为 `failed`，原因是缺少 VSM job/result producer。临时 trigger tag 仍保留。合并后 main 为 `d42d6a03c6a7583541c036b4ddfa8afbb0295939`。

“恢复 source run”指由调用者提供的原发布 workflow run ID；resolver 必须从 GitHub API 独立读取 run 与 jobs，不能信任人工输入的 SHA 或口头描述。“恢复 run”则是正在执行受控恢复的新 `workflow_dispatch` run。续跑时 `recovery_previous_run_id` 指向前次失败的恢复 workflow；`recoveryArtifactRun` 固定首次生成远端 run-bound 文件的验收 run。恢复 context 同时保留原发布 run、前次恢复 run 与验收 artifact run 三种身份。

## 工作计划

- 固定 VSM 证据：用 per-extension 日志路径重现此前 `EEXIST`，不以市场拒绝解释本地写文件异常；确认已有 Release 和双包不重新创建。
- 修复后以真实 `runProcess` 写入两个独立临时日志文件做回归，并运行发布 CLI、发布 workflow 合同测试和代码检查。
- 通过短生命周期修复 PR 将路径隔离合入 main，再用 `channel-retry` 消费原 GitHub Release 的 VSIX 与状态链。查询已有市场版本后才提交缺失包；若市场仍拒绝，应产生有具体原因、可被 finalize 验证的 deferred channel result。

在 `scripts/release/release-delivery.mjs` 增加恢复 resolver。它解析版本和 tag，查询 source run、job、Release、两个 tag 与 assets，检查 source workflow 是从匹配 `publish/vX.Y.Z` tag push 的失败运行、`resolve-release` 成功、`prepare-release` 失败、渠道 job 与 finalize 均 skipped。续跑时还查询 `recovery_previous_run_id` 指向的 workflow run，验证它来自同一 main head、绑定同一原失败 run、resolve 成功、prepare 失败、渠道/finalize skipped，并从实际 resolve job artifact 读取原 context。它要求两个 tag 同指原 SHA、Release 的公开类别/标题/目标/SHA/初始正文匹配，资产只允许是固定不可变清单的子集且没有 manifest/state。恢复 context 的 `run` 绑定新 run 的 API head SHA，另含原 source run、前次 recovery run、固定 acceptance artifact run 和已有 Release ID。

`scripts/release/release-completion.mjs` 增加新模式和来源 run 字段的强校验。`scripts/release/publish-tag-release.mjs` 接受显式 source run ID，只在指定时走恢复 resolver。`release-validation.yml` 对该模式仍运行 `ci-validation.yml` 的完整 `release-tag` 模式，固定输入是已有 tag 的 SHA。

恢复 workflow 的 prepare、渠道和 finalize jobs checkout `github.sha` 来运行修复版发布逻辑；普通 tag 和 `channel-retry` jobs 保留按 release input SHA checkout。首次 prepare 从该 run 的 full verifier 回执取双包。续跑的 prepare 先受本次 full verifier 成功条件控制，再验证前次 recovery context 所指定 run 的 acceptance/candidate artifacts，并从首次生成远端 run-bound 文件的固定 artifact run 取回执和双包；不会构建 main 上的产品代码，也不会拼接不同 run 的验收文件。`prepareRelease` 重新查询 tag/Release/assets，确保它们与 resolver 冻结状态一致；已有同名资产只通过下载后摘要比对，不得 clobber。状态根写入当前 recovery context，并绑定实际成功的 recovery prepare job 工件，使之后的 `channel-retry` 能验证其 producer。

回归覆盖至少包括：合法 source run 可解析；tag SHA 不一致、Release 内容变动、prepare 非失败、任一渠道非 skipped、source run 非目标 workflow、非白名单/歧义资产、有 manifest/state、已存在同名但字节不同的资产都必须拒绝。跨 run 用不同 run ID 模拟恢复 prepare 在 `gate-plan.json` 上传后中断；错误前次状态和错误原始来源必须只读失败，合法续跑必须复用完全相同的 run-bound 文件与 VSIX，再补齐 manifest。workflow 合同验证模式输入下的 checkout 与 verifier mode 关系。外部副作用测试必须使用 fake GitHub client，不对真实 Release 做写入。

## 具体步骤

在 `/tmp/dsc-vsce-per-package-logs` 工作树继续更新 PR #348。该分支基于最新 `origin/main` 的直接后代，保留每包日志修复，并追加 VSM 默认禁用、deferred manifest 与 release 文档变更。提交前再 fetch/rebase 最新 main；本地只做代码语法、workflow YAML 结构和 `git diff --check` 核对。推送后依靠 PR 的真实 Release Preflight 与 `Verify release contract` 复核最新 head，并等待正式 reviewer approval。

修复 PR 合并后，在 GitHub Actions 中从 `main` 手动触发 `Publish Marketplace Release`，输入 `trigger_tag=publish/v0.27.0` 和 `target=all`。触发前核对两个 tag、Release ID、不可变资产与状态链；resolver 必须把 `visual-studio` 固定为 deferred，VSM job 必须 skipped，不能查询 gallery 或运行 `vsce publish`。验收输入与 release SHA `034c5a02894dab45fdbde9b877e787fa4f91f242` 保持不变；prepare 复用原 VSIX，Open VSX 只查询已有版本并验证原包，finalize 必须记录 VSM deferred 和 Open VSX/GitHub verified，之后才按门禁删除 `publish/v0.27.0`。

如 channel-retry 在完成 manifest/state 更新或 trigger tag cleanup 前失败，后续只能沿现有状态链重试，不得重打包、覆盖资产或执行 VSM 查询/提交。VSM 重新打通后，先通过代码复审恢复 workflow dispatch 的单渠道选项，再将仓库变量精确设为 `true`；此前任何发布 run 都应继续保持 VSM deferred。

## 验证与验收

Release Preflight 必须在 PR 最新 head 上完成，并通过稳定 `Verify release contract`。本地只做 JavaScript 语法、workflow YAML 结构和 `git diff --check` 核对，不运行 Visual Studio Marketplace 操作。合并后的 channel-retry 必须显示 `publish-visual-studio` 为 skipped，且 Actions run 没有 VSM result artifact；resolver context 与最终 manifest 必须将 `visual-studio` 列为 deferred，并说明本轮没有查询或提交。Open VSX 与 GitHub Release assets 必须继续 verified。

实际恢复时，接受、candidate、prepared、Open VSX partial、manifest 与 state chain 必须能从同一新 workflow run 的真实 job/artifact 复查；最终 release assets 的 SHA256 必须与 manifest 和 Open VSX verification 的 original package hashes 一致。VSM 被 defer 的条件是 workflow job 确实 skipped，且不存在该 run 的 `marketplace-result-visual-studio-*` artifact；任何一个条件不符都要失败。

截至 2026-10-31，PR #347 与修复跨 run partial-asset resume 的验证均已通过并合入。PR #348 head `c4096df73673665256a14bbdd2867d4b66da8968` 的上一轮 Release Preflight `41162609994` 与 `Verify release contract` 已通过；本次新增 VSM 暂停机制后，必须以更新后的 PR head 重新完成完整门禁和正式复审。

## 幂等性与恢复

resolver、验证和 API 取证为只读；不符合精确失败形状即在任何发布写入前失败。上传器遇到远端响应未知时只能查询固定文件名并下载核验，内容匹配才视为成功；不同内容绝不覆盖。Release 中已有额外资产、草稿状态、tag 改指或审批期间 state 变化均拒绝。Open VSX 继续遵循 query-before-submit 与 unknown 不重复提交规则；VSM 被 defer 时完全不调用其 query/submit client。只有 completion `complete` 后才删除 trigger tag。

## 证据与备注

已核实的基线：原 run `41041508908` 在任何渠道执行前 prepare 失败，原 Release 当时无 assets；PR #347 的跨 run 修复已随 merge commit `d42d6a03` 进入 main。恢复 run `41157851285` 完成原 SHA 全量验收并上传固定双包，Open VSX 两个包 verified；VSM job 因共享独占日志文件触发 `EEXIST`，finalize 失败并保留 trigger tag。Owner 已明确要求在重新打通 VSM 前不再查询或提交。日志路径修复已在 PR #348，现继续修改该 PR 以默认关闭 VSM job，并让 finalizer 只在真实 skipped/no-artifact 证据下将其记录为 deferred。

计划更新记录：2026-10-30 至 2026-10-31，针对 0.27.0 的 prepare 失败增加保留原 SHA 的受控恢复；记录 PR #347 和跨 run partial-asset resume；记录恢复验收、GitHub/Open VSX 成功与 Visual Studio 独占日志冲突；根据 owner 决策，将后续收尾改为不访问 VSM、通过经验证的 deferred 状态 finalize。

本轮完整串行 gate suite 命令为：

node --test --test-concurrency=1 scripts/test/test-gate-contracts.mjs scripts/test/test-release-completion.mjs scripts/test/test-release-delivery.mjs scripts/test/test-incomplete-release-recovery.mjs scripts/test/test-dependency-install.mjs

结果：159 项通过，0 失败；耗时约 581 秒。测试使用 fake GitHub API，没有对真实 Release 执行写入。`npm run test:publish-marketplace-workflow`、`npm run test:publish-tag-release`、相关 Node `--check` 与 `git diff --check` 均通过。

## 接口与依赖

恢复 resolver 的接口在 `scripts/release/release-delivery.mjs`：

    export async function resolveIncompleteReleaseRecovery({
      triggerTag, recoverySourceRunID, recoveryPreviousRunID, root, client, deadline, run, env
    })

上下文模式名为 `incomplete-release-recovery`。上下文记录 `run`（当前恢复 workflow run）、`recoverySourceRun`（原失败发布 workflow run）、可选的 `recoveryPreviousRun`（前次恢复 run）、`recoveryArtifactRun`（固定验收/双包 producer）、`releaseSHA`、`baseSHA`、`existingReleaseID`、版本、目标和内容策略摘要。GitHub API 仅通过现有 `githubClient` 调用；Actions jobs 与 assets 使用分页查询；产物验收复用 `checkGitHubAcceptance`、`collectGitHubProvenance`、`collectReleaseFacts` 和 `verifyPackageFiles`。
