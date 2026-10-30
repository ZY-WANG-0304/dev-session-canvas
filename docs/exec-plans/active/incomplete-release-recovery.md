# 恢复未开始渠道交付的空 Release

本 `ExecPlan` 是活文档，必须按照 `docs/PLANS.md` 持续更新进度、意外与发现、决策记录和结果与复盘。

## 目标与全局图景

用户希望完成 `v0.27.0` 发布，同时保留已经公开创建的 `v0.27.0` Release 和两个仍一致的 tag。此前完整验收通过，但初始资产上传失败，渠道 job 没有执行。现有 `channel-retry` 要求 Release 已包含不可变双包、验收文件和状态链，因此不能用来补齐这个空 Release。

本计划增加一个范围严格的 `incomplete-release-recovery` 发布模式。维护者从 `main` 手动触发并指定原失败 run；系统校验 tag、Release 和失败阶段后，在原 SHA 上重新运行完整发布验收。恢复 run 使用 `main` 中的修复版发布脚本，并只上传该 run 的通过验收双包。渠道流程和最终状态仍由现有发布 workflow 收口。最终 tag 不移动；成功后才按常规流程删除临时 `publish/` tag。

## 进度

- [x] (2026-10-30) 已确认原发布 run `41041508908` 的失败阶段为 `prepare-release`，验收通过、两个渠道 job skipped，GitHub Release 无资产，两个 tag 均指向 `034c5a02894dab45fdbde9b877e787fa4f91f242`。
- [x] (2026-10-30) 已确认修复已在 PR #346 合并至 main，合并后 Release Preflight run `41058697974` 成功。
- [x] (2026-10-30) 已选定保留原 SHA 和 Release/tag 的受控恢复方案，并更新设计、工作流入口与本计划。
- [x] (2026-10-30) 已实现来源 run、job、双 tag、Release 正文与资产范围校验；prepare 阶段再次核对 Release 状态并只接受相同字节的已有资产。
- [x] (2026-10-30) 已调整发布 workflow：恢复模式的验收仍使用原 tag SHA 的完整 `release-tag` 任务图，交付阶段使用 `main` workflow checkout 中的修复脚本。
- [x] (2026-10-30) 已补充恢复模式回归与 workflow 合同测试，并同步工作流和设计文档。
- [x] (2026-10-30) `npm run test:publish-tag-release`、`npm run test:publish-marketplace-workflow` 均通过；显式串行完整 CI gate 命令通过 158 项、0 失败；`git diff --check` 通过。
- [ ] 拉取最新 `origin/main` 并 rebase；提交、推送恢复修复分支并创建面向 `main` 的 PR。
- [ ] 等待 PR Release Preflight 和 review；合并后在原 tag 身份上执行一次恢复发布并核实结果。

## 意外与发现

- 观察：失败发生在任何渠道 job 开始前，因此这次失败没有由该 run 向 Open VSX 或 Visual Studio Marketplace 写入。
  证据：Actions run `41041508908` 中 `Release prepare-release` 为 failure，`Release publish-open-vsx` 和 `Release publish-visual-studio` 为 skipped；`v0.27.0` Release assets 列表为空。
- 观察：旧 `publish/v0.27.0` 指向的提交不包含 `Content-Length` 修复，重跑该 tag 会重新使用旧发布代码。
  证据：`publish/v0.27.0` 与 `v0.27.0` 都指向 `034c5a0`；修复合并提交为 `58a4ec2`。
- 观察：普通 `channel-retry` 不适用于空 Release。
  证据：`scripts/release/release-delivery.mjs::verifyRecoveredRelease` 要求所有固定资产唯一存在；`prepareRelease` 在恢复模式下不会替换缺失资产。
- 观察：把 `--test-concurrency=1` 作为 npm script 追加参数放到文件列表后，Node 仍同时启动了多个测试文件。为排除并行时限噪声，完整门禁改为直接调用 `node --test --test-concurrency=1`，并将选项放在测试文件列表前。之前一轮在主动中断时报告了 cancelled/pending promise，不作为通过或代码失败证据。
- 观察：把 `--test-concurrency=1` 作为 npm script 的追加参数放到文件列表后，Node 仍启动了多个测试文件。为避免并行时限噪声，完整门禁必须直接调用 `node --test --test-concurrency=1`，并把选项放在测试文件列表前。上一轮在 152 秒后被主动中断，取消时两个文件报告 pending promise；该轮不能作为通过或代码失败证据。

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

## 结果与复盘

恢复模式实现、回归覆盖、正式文档更新和显式串行完整本地门禁已完成；158 项全部通过，但尚未在 GitHub 建立 PR。最终成功标准仍是 recovery mode 对正确的历史失败输入通过真实预合并发布门禁，在不移动两个 tag 的情况下准备并校验 Release 资产、正常完成渠道交付和 finalize；错误来源 run、已开始渠道交付、非空状态链和冲突内容均在外部写入前被拒绝。实际恢复发布必须等修复 PR 合并后执行。

## 上下文与定向

`docs/WORKFLOW.md` 定义外层发布顺序；`.github/workflows/publish-marketplace-release.yml` 编排 resolver、完整验证、prepare、渠道与 finalize；`.github/workflows/release-validation.yml` 根据模式选择完整验收或现有状态恢复。`scripts/release/release-delivery.mjs` 负责固定 tag、消费 CI 工件、上传并校验 Release 资产；`scripts/release/publish-tag-release.mjs` 是阶段入口；`scripts/release/release-completion.mjs` 校验传递给各 job 的上下文；`scripts/release/release-state.mjs` 将状态绑定到真实 workflow artifact producer。

当前失败输入是 `publish/v0.27.0`，源 SHA 为 `034c5a02894dab45fdbde9b877e787fa4f91f242`。正式 `v0.27.0` 与临时 tag 都仍指向这个 SHA。GitHub Release `v0.27.0` 已创建且初始正文未变，assets 为空。修复后的当前 main 包含 commit `58a4ec28614a2d110953e452d4a2e5aced5f5620`。

“恢复 source run”指由调用者提供的原发布 workflow run ID；resolver 必须从 GitHub API 独立读取 run 与 jobs，不能信任人工输入的 SHA 或口头描述。“恢复 run”则是正在执行受控恢复的新 `workflow_dispatch` run。恢复 context 同时保留这两种身份。

## 工作计划

在 `scripts/release/release-delivery.mjs` 增加恢复 resolver。它解析版本和 tag，查询 source run、job、Release、两个 tag 与 assets，检查 source workflow 是从匹配 `publish/vX.Y.Z` tag push 的失败运行、`resolve-release` 成功、`prepare-release` 失败、渠道 job 与 finalize 均 skipped。它要求两个 tag 同指原 SHA、Release 的公开类别/标题/目标/SHA/初始正文匹配，资产只允许是固定不可变清单的子集且没有 manifest/state。恢复 context 的 `run` 绑定新 run 的 API head SHA，另含 source run ID、attempt 与 head SHA，并绑定已有 Release ID。

`scripts/release/release-completion.mjs` 增加新模式和来源 run 字段的强校验。`scripts/release/publish-tag-release.mjs` 接受显式 source run ID，只在指定时走恢复 resolver。`release-validation.yml` 对该模式仍运行 `ci-validation.yml` 的完整 `release-tag` 模式，固定输入是已有 tag 的 SHA。

恢复 workflow 的 prepare、渠道和 finalize jobs checkout `github.sha` 来运行修复版发布逻辑；普通 tag 和 `channel-retry` jobs 保留按 release input SHA checkout。prepare 仍从同一次 Actions run 的 full verifier 回执中取双包，因此不会构建 main 上的产品代码，也不会跨 run 拼接回执。`prepareRelease` 重新查询 tag/Release/assets，确保它们与 resolver 冻结状态一致；已有同名资产只通过下载后摘要比对，不得 clobber。状态根写入 recovery context，并绑定实际成功的 recovery prepare job 工件，使之后的 `channel-retry` 能验证其 producer。

回归覆盖至少包括：合法 source run 可解析；tag SHA 不一致、Release 内容变动、prepare 非失败、任一渠道非 skipped、source run 非目标 workflow、非白名单/歧义资产、有 manifest/state、已存在同名但字节不同的资产都必须拒绝。workflow 合同验证模式输入下的 checkout 与 verifier mode 关系。外部副作用测试必须使用 fake GitHub client，不对真实 Release 做写入。

## 具体步骤

在 `/tmp/dsc-incomplete-release-recovery` 工作树进行修改。先运行 `npm run test:publish-tag-release`、`npm run test:publish-marketplace-workflow` 和 `node --test --test-concurrency=1 scripts/test/test-gate-contracts.mjs scripts/test/test-release-completion.mjs scripts/test/test-release-delivery.mjs scripts/test/test-incomplete-release-recovery.mjs scripts/test/test-dependency-install.mjs`，并做 `git diff --check`。完成后拉取最新 `origin/main`、rebase、推送 `release-incomplete-release-recovery`，创建面向 `main` 的 PR，等待 Release Preflight 的真实预合并输入和 review 完整通过。

恢复 PR 合并后，在 GitHub Actions 中从 `main` 手动触发 `Publish Marketplace Release`，输入 `trigger_tag=publish/v0.27.0`、`target=all`、`recovery_source_run_id=41041508908`。触发前再核对两个 tag 和空/部分白名单 assets；resolver 不通过不得继续。验收结果必须显示原 SHA `034c5a02894dab45fdbde9b877e787fa4f91f242`，release notes 记录的 release ref 不变；验收、准备、Open VSX、Visual Studio、finalize 五阶段均应按各自契约结束，`publish/v0.27.0` 只在必需目标完成后删除。

若在上传中断，workflow 不得覆盖任何已经存在的不同内容。重新触发时仍提供最初失败的 source run ID；resolver 只接受固定资产名称子集、无 manifest/state 的未完成状态，新的 prepare 只有在每个既有资产与新验收包字节一致时才能继续。出现 manifest/state 后应转回标准 `channel-retry`；出现渠道 job 后本模式一律拒绝。

## 验证与验收

本地合同测试用 fake GitHub API 记录 GET、POST 和 DELETE 调用。拒绝样例必须证明 Release upload、channel submit 和 tag delete 调用次数均为 0；正常 resolver 只冻结上下文，不执行外部写入。prepare/upload transport 测试证明请求具有准确 `Content-Length` 且 byte 内容相同。workflow 测试证明恢复 verifier 是完整 `release-tag` 任务图，而交付脚本 checkout 当前 workflow SHA。

GitHub PR preflight 必须在真实预合并 SHA 上成功，merge 后 main push preflight 通过。实际恢复时，所有接受、candidate、prepared、channel partial、manifest 与 state chain 必须能从同一新 workflow run 的真实 job/artifact 复查；最终 release assets 的 SHA256 必须与 manifest 和 channel verification 的 original package hashes 一致。

截至 2026-10-30，本工作树已完成恢复实现、定向发布测试、workflow 合同检查和显式串行完整 CI gate（158 项通过，0 失败，耗时约 530.8 秒）。推送前最终检查及 PR 门禁仍待完成。

## 幂等性与恢复

resolver、验证和 API 取证为只读；不符合精确失败形状即在任何发布写入前失败。上传器遇到远端响应未知时只能查询固定文件名并下载核验，内容匹配才视为成功；不同内容绝不覆盖。Release 中已有额外资产、草稿状态、tag 改指或审批期间 state 变化均拒绝。渠道提交仍遵循 query-before-submit 与 unknown 不重复提交规则。只有 completion `complete` 后才删除 trigger tag。

## 证据与备注

已核实的基线：run `41041508908` 的 `Release resolve-release=success`、完整 verifier success、`Release prepare-release=failure`、两个渠道 job skipped、`Release finalize-release=skipped`；Release `v0.27.0` assets 数量为 0，临时和正式 tag 均指向 `034c5a0`。合并后的修复提交为 `58a4ec2`，main push Release Preflight run `41058697974` 为 success。

计划更新记录：2026-10-30，针对已发布但没有任何交付资产的 0.27.0 失败状态，增加保留原 SHA 的受控恢复设计与实施步骤；本次继续工作后，将实现和显式串行门禁标记完成，并明确剩余 PR 与恢复发布步骤。

## 接口与依赖

恢复 resolver 的接口在 `scripts/release/release-delivery.mjs`：

    export async function resolveIncompleteReleaseRecovery({
      triggerTag, recoverySourceRunID, root, client, deadline, run, env
    })

上下文模式名为 `incomplete-release-recovery`。上下文记录 `run`（恢复 workflow run）、`recoverySourceRun`（原失败发布 workflow run）、`releaseSHA`、`baseSHA`、`existingReleaseID`、版本、目标和内容策略摘要。GitHub API 仅通过现有 `githubClient` 调用；Actions jobs 与 assets 使用分页查询；产物验收复用 `checkGitHubAcceptance`、`collectGitHubProvenance` 和 `verifyPackageFiles`。
