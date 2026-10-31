# 恢复未开始渠道交付的空 Release

本 `ExecPlan` 是活文档，必须按照 `docs/PLANS.md` 持续更新进度、意外与发现、决策记录和结果与复盘。

## 目标与全局图景

用户希望完成 `v0.27.0` 发布，同时保留已经公开创建的 `v0.27.0` Release 和两个仍一致的 tag。此前完整验收通过，但初始资产上传失败，渠道 job 没有执行。现有 `channel-retry` 要求 Release 已包含不可变双包、验收文件和状态链，因此不能用来补齐这个空 Release。

本计划增加一个范围严格的 `incomplete-release-recovery` 发布模式。维护者从 `main` 手动触发并指定原失败 run；系统校验 tag、Release 和失败阶段后，在原 SHA 上重新运行完整发布验收。恢复 run 使用 `main` 中的修复版发布脚本，并只上传通过验收的双包。若上传中断且没有生成状态清单，后续 run 还须指定前次恢复 run ID；系统核验前次 run 的原失败来源、完整验收和失败阶段后，复用该次同批验收资产继续上传，避免 run-bound 收据变化导致冲突。渠道流程和最终状态仍由现有发布 workflow 收口。最终 tag 不移动；成功后才按常规流程删除临时 `publish/` tag。

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
- [ ] 为日志修复创建 PR，等待 Release Preflight 和复审后合并；单独重跑 main Preflight `41157272719` 的失败任务，确认 packaged-host 间歇失败状态。
- [ ] 修复合入 main 后，用 `channel-retry` 只处理 Visual Studio 状态；核对已存在的远端版本，得到可验证的 verified 或 deferred 结果后完成 finalize，并确认 trigger tag 状态。

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

## 结果与复盘

恢复 resolver、跨 run 续跑修复和 PR #347 已合入。恢复 run `41157851285` 验收通过，GitHub Release assets 与 Open VSX 已有完整证据；但 Visual Studio job 因日志路径 `EEXIST` 退出，finalize 未完成，临时 trigger tag 保留。下一步需修复单包日志隔离、合并修复，再通过 `channel-retry` 收口。此前的完整串行测试 `159/159` 通过；新增日志路径回归与该 main Preflight 失败项仍待验证。最终成功标准仍是保留原双 tag / release SHA、复用原 VSIX、使 Open VSX 与 GitHub assets 维持 verified，并让 Visual Studio Marketplace 结果以真实证据标记为 verified 或 deferred 后 finalize 成功。

## 上下文与定向

`docs/WORKFLOW.md` 定义外层发布顺序；`.github/workflows/publish-marketplace-release.yml` 编排 resolver、完整验证、prepare、渠道与 finalize；`.github/workflows/release-validation.yml` 根据模式选择完整验收或现有状态恢复。`scripts/release/release-delivery.mjs` 负责固定 tag、消费 CI 工件、上传并校验 Release 资产；`scripts/release/publish-tag-release.mjs` 是阶段入口；`scripts/release/release-completion.mjs` 校验传递给各 job 的上下文；`scripts/release/release-state.mjs` 将状态绑定到真实 workflow artifact producer。

当前恢复输入仍为 `publish/v0.27.0`，源 SHA 为 `034c5a02894dab45fdbde9b877e787fa4f91f242`。正式 `v0.27.0` 与临时 tag 仍指向该 SHA。GitHub Release `v0.27.0` 已包含同批 main/notifier VSIX、验收资料和 manifest；manifest 记录 GitHub assets content-verified、Open VSX 两个包 verified，Visual Studio 两个包 pending-verification。临时 trigger tag 仍保留。合并后 main 为 `d42d6a03c6a7583541c036b4ddfa8afbb0295939`。

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

在 `/tmp/dsc-incomplete-release-recovery` 工作树进行修改。运行 `npm run test:publish-tag-release`、`npm run test:publish-marketplace-workflow` 和 `node --test --test-concurrency=1 scripts/test/test-gate-contracts.mjs scripts/test/test-release-completion.mjs scripts/test/test-release-delivery.mjs scripts/test/test-incomplete-release-recovery.mjs scripts/test/test-dependency-install.mjs`，并做 `git diff --check`。完成后拉取最新 `origin/main`、rebase、推送 `release-incomplete-release-recovery`；更新 PR #347 后等待最新 head 的 Release Preflight 真实预合并输入和 review。

恢复 PR 合并后，在 GitHub Actions 中从 `main` 手动触发 `Publish Marketplace Release`，输入 `trigger_tag=publish/v0.27.0`、`target=all`、`recovery_source_run_id=41041508908`。触发前再核对两个 tag 和空/部分白名单 assets；resolver 不通过不得继续。验收结果必须显示原 SHA `034c5a02894dab45fdbde9b877e787fa4f91f242`，release notes 记录的 release ref 不变；验收、准备、Open VSX、Visual Studio、finalize 五阶段均应按各自契约结束，`publish/v0.27.0` 只在必需目标完成后删除。

若首次恢复上传中断，下一次手动触发仍提供原失败 source run ID，并将该恢复 run ID 填入 `recovery_previous_run_id`。resolver 核对恢复 run 的失败阶段和 resolve context artifact；prepare 通过本次完整验收门禁后，再下载并验证固定 `recoveryArtifactRun` 的 acceptance/candidate artifacts，使用该批文件续传。连续续跑时，`recovery_previous_run_id` 指向最近失败 run，固定的 `recoveryArtifactRun` 不变。已有同名资产必须与该 batch 逐字节相同；不得覆盖不同内容。出现 manifest/state 后应转回标准 `channel-retry`；出现渠道 job 后本模式一律拒绝。

## 验证与验收

本地合同测试用 fake GitHub API 记录 GET、POST 和 DELETE 调用。拒绝样例必须证明 Release upload、channel submit 和 tag delete 调用次数均为 0；正常 resolver 只冻结上下文，不执行外部写入。prepare/upload transport 测试证明请求具有准确 `Content-Length` 且 byte 内容相同。workflow 测试证明恢复 verifier 是完整 `release-tag` 任务图，而交付脚本 checkout 当前 workflow SHA。

GitHub PR preflight 必须在真实预合并 SHA 上成功，merge 后 main push preflight 通过。实际恢复时，所有接受、candidate、prepared、channel partial、manifest 与 state chain 必须能从同一新 workflow run 的真实 job/artifact 复查；最终 release assets 的 SHA256 必须与 manifest 和 channel verification 的 original package hashes 一致。

截至 2026-10-31，PR #347 初始 head `950bbd70` 的 Release Preflight run `41079372749` 成功，`Verify release contract` 通过。随后 review 发现跨 run partial-asset resume 缺口。本次双 run ID 回归与定向套件已通过；该修复 head 的完整 Release Preflight 仍待 GitHub Actions 验收。

## 幂等性与恢复

resolver、验证和 API 取证为只读；不符合精确失败形状即在任何发布写入前失败。上传器遇到远端响应未知时只能查询固定文件名并下载核验，内容匹配才视为成功；不同内容绝不覆盖。Release 中已有额外资产、草稿状态、tag 改指或审批期间 state 变化均拒绝。渠道提交仍遵循 query-before-submit 与 unknown 不重复提交规则。只有 completion `complete` 后才删除 trigger tag。

## 证据与备注

已核实的基线：原 run `41041508908` 在任何渠道执行前 prepare 失败，原 Release 当时无 assets；PR #347 的跨 run 修复已随 merge commit `d42d6a03` 进入 main。恢复 run `41157851285` 完成原 SHA 全量验收并上传固定双包，Open VSX 两个包 verified；VSM job 因共享独占日志文件触发 `EEXIST`，finalize 失败并保留 trigger tag。后续修复及 channel-retry 仍待完成。日志路径修复目前已在本地分支通过定向测试，PR、Actions 门禁和复审待完成。

计划更新记录：2026-10-30 至 2026-10-31，针对已发布但没有任何交付资产的 0.27.0 失败状态，增加保留原 SHA 的受控恢复设计与实施步骤；记录 PR #347 及跨 run partial-asset resume 修复；随后记录恢复验收、GitHub/Open VSX 成功、Visual Studio 独占日志冲突和待执行的 channel-retry。

本轮完整串行 gate suite 命令为：

node --test --test-concurrency=1 scripts/test/test-gate-contracts.mjs scripts/test/test-release-completion.mjs scripts/test/test-release-delivery.mjs scripts/test/test-incomplete-release-recovery.mjs scripts/test/test-dependency-install.mjs

结果：159 项通过，0 失败；耗时约 581 秒。测试使用 fake GitHub API，没有对真实 Release 执行写入。`npm run test:publish-marketplace-workflow`、`npm run test:publish-tag-release`、相关 Node `--check` 与 `git diff --check` 均通过。

## 接口与依赖

恢复 resolver 的接口在 `scripts/release/release-delivery.mjs`：

    export async function resolveIncompleteReleaseRecovery({
      triggerTag, recoverySourceRunID, recoveryPreviousRunID, root, client, deadline, run, env
    })

上下文模式名为 `incomplete-release-recovery`。上下文记录 `run`（当前恢复 workflow run）、`recoverySourceRun`（原失败发布 workflow run）、可选的 `recoveryPreviousRun`（前次恢复 run）、`recoveryArtifactRun`（固定验收/双包 producer）、`releaseSHA`、`baseSHA`、`existingReleaseID`、版本、目标和内容策略摘要。GitHub API 仅通过现有 `githubClient` 调用；Actions jobs 与 assets 使用分页查询；产物验收复用 `checkGitHubAcceptance`、`collectGitHubProvenance`、`collectReleaseFacts` 和 `verifyPackageFiles`。
