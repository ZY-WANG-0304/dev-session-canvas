# 将发布输入、门禁和发布证据分层

本 `ExecPlan` 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘` 这几个章节。

本计划遵循 `docs/PLANS.md`。它改造公开扩展的发布门禁和证据边界；设计结论同步记录在 `docs/design-docs/public-marketplace-release-readiness.md`。

## 目标与全局图景

下一次 VS Code 扩展发布时，维护者会在发布准备 PR 中提交一个版本化的发布契约。契约列出本版本的用户范围、文档清单、已知限制和验证范围；主扩展与 notifier 的 CHANGELOG 只保留用户可见的 release notes。由最新 PR head 与基准分支生成的预合并结果和最终 `main` release ref 都会运行同一份可执行发布验证，验证未通过时 workflow 不会打包或发布。发布完成后，SHA、渠道状态、VSIX hash 和运行信息只进入 GitHub Release manifest / assets，不再通过后续 PR 回写已发布版本的 CHANGELOG。

完成后，新手可以在仓库根目录运行 `npm run release:preflight -- --version X.Y.Z` 检查发布输入，或运行 `npm run release:verify -- --version X.Y.Z` 执行静态检查、完整测试和 clean-checkout VSIX 验证。发布 workflow 会在发布 tag checkout 的最终 ref 上执行同一条验证命令。

## 进度

- [x] (2026-09-17) 已复核 v0.25.0 发布过程、#291 / #292、现有 tag workflow 和文档边界。
- [x] (2026-09-17) 已从更新后的 `origin/main` 创建 `chore/release-gate-contract` 分支。
- [x] (2026-09-17) 已创建本计划，并确定新规则只约束后续版本，不追溯改写 `v0.25.0` tag 内容。
- [x] (2026-09-17) 已定义发布契约格式、静态 preflight 与完整 verify CLI，并为其补充定向测试。
- [x] (2026-09-17) 已把发布 workflow 的 PR 阶段和最终发布阶段接入相同的 verify 命令，同时为旧 tag 的补发保留兼容路径。
- [x] (2026-09-17) 已更新工作流、发布手册、设计文档、设计索引和核心信念，说明输入与发布后证据的边界。
- [x] (2026-09-17) 已通过发布流程专用测试、现有发布脚本 / workflow 守卫、Node 语法检查与 diff 检查。
- [x] (2026-09-17) 已撤出为消除既有完整回归失败而临时混入的产品源码、既有测试和截图基线改动；这些问题必须在独立修复 PR 中处理。
- [x] (2026-09-17) 已记录完整 `npm test` 的真实阻塞项：trusted VS Code smoke 的 90,000 行 completed terminal 终态短读。`release:verify` 应继续传播此失败，直到独立修复合入。
- [x] (2026-09-17) 已处理 #293 review：两个 CHANGELOG 与发布契约共用发布后事实禁用规则，并为 VSIX SHA、渠道状态补充负例；同步修正 ExecPlan 链接和 PR 阶段的预合并结果表述。

## 意外与发现

- 观察：远端 #292 已在 v0.25.0 发布后合并；其内容包括把 CHANGELOG 中“仍需执行分层 gate”改为“最终 release ref 已完成”。`v0.25.0` tag 仍指向 #291 的 merge commit，不能包含这个后续文字。
  证据：`origin/main` 为 `f2416795`，父提交为 `4d7f07e5` 与 #292 head；`v0.25.0` 指向 `4d7f07e5`。
- 观察：现有 `publish-tag-release.mjs` 已保证版本、CHANGELOG 标题、干净工作树和 tag ref 一致，但不执行完整测试或 clean-checkout 验证。
  证据：`validateReleaseInputs()` 只做元数据与 git 检查；`publish-marketplace-release.yml` 在打包前只执行 `npm ci`。
- 观察：如果只让 release PR workflow 在修改发布契约时运行，GitHub branch protection 将在普通 PR 上等不到同名 status check。
  证据：GitHub required status check 按 check 名称而非 PR 文件类型判断；必须让同一 job 在非 release PR 中明确成功跳过。
- 观察：完整 `npm test` 的最后一个 trusted VS Code smoke 在 completed terminal 已关闭时只保留到 `DSC_COMPLETED_STREAM_89902`，未达到测试要求的 `90000` 行终态 marker。
  证据：`verifyCompletedLiveRuntimeRetainsOversizedTerminalStream()` 在 `tests/vscode-smoke/extension-tests.cjs` 的 snapshot wait 超时；artifact 的 stream projection 长度为 5,574,136 字符，含第 1 与第 45,000 行 marker，缺第 90,000 行 marker。该风险已由 `docs/exec-plans/tech-debt-tracker.md` 的“90000 行 completed terminal 终态间歇性未收齐”条目跟踪。

## 决策记录

- 决策：从下一次版本发布开始，要求 `docs/release-contracts/vX.Y.Z.md` 与该版本一同合入发布准备 PR；不为已经发布的 v0.25.0 补建契约或继续改写其 CHANGELOG。
  理由：契约需要是 tag 中不可变的发布输入。事后添加同版本契约会重复当前“发布后再补记录”的问题。
  日期/作者：2026-09-17 / Codex，依据用户确认
- 决策：`CHANGELOG.md` 只承载用户可见的版本说明；静态 preflight 拒绝已知的内部发布状态短语。发布 run、hash、渠道状态和 gate 结果由 release manifest / GitHub Release 承载。
  理由：GitHub Release notes 由 tag checkout 的 CHANGELOG 生成，无法安全吸收 tag 后的仓库文案修正。
  日期/作者：2026-09-17 / Codex，依据用户确认
- 决策：将检查分成无副作用的 `release:preflight` 和完整的 `release:verify`。前者供开发者和测试快速验证发布输入；后者在 release PR 和最终 tag ref 上运行 `npm test` 与 clean-checkout VSIX 验证。
  理由：版本 / 文档错误需要快速定位，而对外发布必须证明完整门禁在真实发布输入上通过。
  日期/作者：2026-09-17 / Codex
- 决策：旧 tag 的手动补发继续使用当时 tag 内的发布脚本；新 workflow 只有在 checkout 中存在新 verify 脚本时才执行完整 verify。
  理由：新的 workflow 定义存在于默认分支，`workflow_dispatch` 可以针对历史 tag checkout；历史快照不包含新 CLI，强制调用会无关地阻断已有工件的渠道补发。
  日期/作者：2026-09-17 / Codex
- 决策：`Release Preflight / Verify release contract` 在所有非草稿 PR 上创建同一个 job；只有 diff 含一个版本化发布契约时才安装依赖并运行完整 verify，其他 PR 明确成功跳过。
  理由：这样 branch protection 可以要求稳定的同名 check，同时不会把完整 release matrix 加到每一个普通 PR。
  日期/作者：2026-09-17 / Codex
- 决策：不在本次发布流程改造中修改产品 runtime、既有 smoke / Playwright 测试或截图基线来使完整门禁通过；完整门禁发现的问题保持为发布阻塞，后续由独立修复 PR 处理。
  理由：发布门禁的职责是如实阻止存在问题的发布。把产品修复混入门禁改造会掩盖当前质量状态，也会让发布流程 PR 的范围失焦。
  日期/作者：2026-09-17 / 用户确认

## 结果与复盘

已完成发布输入和执行流程的改造。下一次发布准备 PR 必须带入 `docs/release-contracts/vX.Y.Z.md`；由最新 PR head 与基准分支生成的预合并结果和最终 tag checkout 都会在对外写入之前运行相同的 `release:verify`。CHANGELOG 只允许用户 release notes，发布后 evidence 只进入 GitHub Release manifest / assets。

定向发布流程验证已通过：`test:release-preflight`、`test:release-preflight-workflow`、`test:publish-tag-release`、`test:publish-marketplace-workflow`、新旧 release 脚本的 Node 语法检查和 `git diff --check`。历史 `v0.25.0` 的 preflight 按预期失败，原因是其已发布 CHANGELOG 含内部 gate 文字；本方案不追溯改写历史 tag。

完整 `npm test` 仍会被已知的 90,000 行 completed terminal 终态短读风险阻断。该失败不是本次发布流程代码造成，也没有在本分支通过产品或既有测试改动规避；在专门修复 PR 完成之前，`release:verify` 正确地不允许发布。GitHub branch protection 也尚未由管理员在仓库设置中配置；完成后须将 `Release Preflight / Verify release contract` 设为 required status check。

## 上下文与定向

发布准备的通用顺序位于 `docs/WORKFLOW.md`：功能先合入 `main`，再以独立分支准备版本、CHANGELOG、Marketplace 文案和发布手册，PR 合并后才可发布。`.github/workflows/publish-marketplace-release.yml` 在 `publish/vX.Y.Z` tag 创建后运行；它 checkout tag、打包主扩展与 notifier、创建 GitHub Release assets，并发布 Open VSX / Visual Studio Marketplace。`scripts/release/publish-tag-release.mjs` 从 tag 解析版本和 SHA，并生成不会提交回仓库的 `release-artifacts/release-manifest-X.Y.Z.json`。

本计划新增的“发布契约”是 `docs/release-contracts/vX.Y.Z.md`。它是和 package manifests、CHANGELOG、Marketplace README 同级的静态发布输入，必须在 tag 前完成。它不是发布后报告，因此不得加入 Actions run ID、工件 SHA、渠道最终状态或“gate 已通过”事实。release manifest 是 workflow 产生的发布后报告，仍作为 GitHub Release asset 保存。

`scripts/release/release-preflight.mjs` 将是共享校验模块和 CLI。它验证根 workspace、主扩展、notifier 及 lockfile 的版本对齐，验证两个 CHANGELOG 的目标版本段存在且无内部执行语句，并验证同版本发布契约具有必需章节及必列文档。`--verify` 模式在这些静态断言后调用 release gate 自身测试、`npm test` 和 `npm run validate:clean-checkout:vsix -- --ref HEAD`。`scripts/release/publish-tag-release.mjs` 只复用静态断言；workflow 在任何对外写入前调用完整模式。

## 工作计划

先新增 release contract 目录说明和 preflight 模块。模块使用 Node 标准库，避免引入 YAML / Markdown 解析依赖；契约是 Markdown，约定固定标题并由脚本在目标版本路径读取。模块导出静态验证函数，既可作为 CLI 使用，也能由 `publish-tag-release.mjs` 调用，防止两个入口的规则漂移。测试将在临时 fixture 项目中调用 CLI，覆盖有效契约、缺少契约、版本不一致和 CHANGELOG 混入内部 gate 文案。

随后在根 `package.json` 注册 `release:preflight`、`release:verify` 和对应测试。`publish-tag-release.mjs` 在解析 tag version 后调用静态验证，因此新版本即使绕过 workflow 也不能只凭版本标题开始发布。

接着新增 release PR workflow：它在所有非草稿 PR 创建稳定 check，只有 PR 修改 `docs/release-contracts/v*.md` 时才定位唯一的契约版本，并在由最新 PR head 与基准分支生成的预合并结果上运行完整 verify。现有 publish workflow 在 tag checkout 后、打包前运行完整 verify；它检测脚本存在性，从而不影响历史 tag 的补发。完成后更新 workflow tests，确保两个位置均有命令和兼容 guard。

最后更新 `docs/WORKFLOW.md`、两份发布手册、公开发布设计文档、设计索引和核心信念。文档会明确 branch protection 必须把 release PR workflow 设为 required status check；仓库内代码能提供检查，GitHub repository setting 仍需维护者在外部启用。

## 具体步骤

在仓库根目录依次执行：

    npm run test:release-preflight
    npm run test:publish-tag-release
    npm run test:publish-marketplace-workflow
    npm run release:preflight -- --version 0.25.0
    npm test

`release:preflight -- --version 0.25.0` 不应作为当前版本的成功标准，因为 v0.25.0 没有追溯补建的发布契约，且其历史 CHANGELOG 含有本次要禁止的内部 gate 文案；预期会失败并证明不追溯改写原则。完整 `npm run release:verify -- --version <next-version>` 需要一个已创建发布契约、版本同步完成的后续 release branch；本轮不会伪造下一版本或触发真实发布。实现完成后，对脚本与 workflow 执行 `node --check` 和 `git diff --check`。

## 验证与验收

静态测试必须证明：缺少 `docs/release-contracts/vX.Y.Z.md` 会失败；任一 manifest 或 lockfile 版本不一致会失败；两个 CHANGELOG 之一未包含目标版本段、为空或包含“发布准备”“分层 gate”、VSIX SHA 或渠道状态等内部执行内容与发布后事实会失败；有完整契约、必列文档和用户 release notes 的 fixture 会通过。`release:verify` 测试必须断言它按顺序执行 gate 自身测试、完整测试和 clean-checkout 验证。`publish-tag-release` 测试必须继续通过，且增加断言证明它因缺少发布契约而拒绝新式 release input。workflow 测试必须验证 PR workflow 对普通 PR 成功跳过、对 release PR 的预合并结果调用 `release:verify`，publish workflow 在打包前调用同一命令并保留 legacy guard。

人类可观察的验收是：下一次发布准备 PR 新增契约后，PR check 会针对由它的最新 head 与基准分支生成的预合并结果运行完整验证；若 CHANGELOG 写入内部待办、VSIX SHA 或渠道状态，preflight 会显示明确错误并阻止合并。该 PR 合并后，发布 tag job 在相同 final ref 再运行一次完整验证；失败时没有 VSIX、Release asset 或 marketplace publish 动作发生。成功后发布 evidence 只存在于 GitHub Release manifest / notes。

## 幂等性与恢复

静态 preflight 只读取文件，可以安全重复运行。完整 verify 的 clean-checkout 命令在临时目录工作并清理自身；失败后修复输入再重跑即可。workflow 的 verify 发生在创建 Release assets 之前，因此失败不会产生部分新版本 GitHub Release；既有历史 tag 没有新脚本时会走明确的 legacy 路径，继续复用现有 immutable assets。所有新文档和代码修改都留在当前主题分支，可通过放弃该分支恢复，不修改已有 tag 或 Release。

当前完整 verify 因既有 smoke 阻塞失败时，维护者应保留 artifact，并在独立的 runtime / smoke 修复 PR 中解决问题后从发布准备 PR 的最新 head 重新运行；不能降低 90,000 行内容断言或将产品修复回填到已发布 tag。

## 证据与备注

开始实现前的当前事实：

    origin/main: f2416795 docs(release): 回写并归档 v0.25.0 发布事实 (#292)
    v0.25.0:    4d7f07e5 docs(release): 准备 v0.25.0 发布收口 (#291)

现有脚本守卫已通过：

    npm run test:publish-tag-release
    publish-tag-release tests passed

    npm run test:publish-marketplace-workflow
    publish-marketplace workflow tests passed

    npm run test:release-preflight
    release-preflight tests passed

    npm run test:release-preflight-workflow
    release-preflight workflow tests passed

    npm run release:preflight -- --version 0.25.0
    主扩展 CHANGELOG 的 0.25.0 版本段 包含内部发布状态“内部 gate”。

`npm test` 未作为通过证据：它在 trusted VS Code smoke 的 90,000 行 completed terminal 场景中失败，末尾仅达 `DSC_COMPLETED_STREAM_89902`。这应保留为发布阻塞，见本计划的“意外与发现”和技术债追踪条目。

## 接口与依赖

新增 `scripts/release/release-preflight.mjs`，提供以下稳定 CLI 和导出：

    node scripts/release/release-preflight.mjs --version X.Y.Z
    node scripts/release/release-preflight.mjs --version X.Y.Z --verify

    export function validateReleasePreflight({ projectRoot, version })

新增 package scripts：

    "release:preflight": "node scripts/release/release-preflight.mjs"
    "release:verify": "node scripts/release/release-preflight.mjs --verify"
    "test:release-preflight": "node scripts/test/test-release-preflight.mjs"

不新增第三方依赖。`release:verify` 使用 Node `spawnSync` 顺序运行已有 npm commands；失败立即保留底层命令的退出码。发布契约的固定必需章节是“发布范围”“用户 release notes”“文档清单”“已知限制”和“验证范围”。

计划更新记录：2026-09-17，创建计划并记录 v0.25.0 的不追溯原则、双阶段验证方案和历史 tag 兼容边界。
计划更新记录：2026-09-17，已实现发布契约、双阶段 verify、历史 tag 兼容和 branch-protection 可用的 no-op PR check；待运行完整回归并收口证据。
计划更新记录：2026-09-17，完整回归暴露既有 90,000 行 completed terminal 终态短读；依据用户决定，撤出所有为消除该类回归而混入的产品源码、既有测试和截图改动，保持它作为独立修复 PR 的发布阻塞，并完成发布流程专用验证记录。
计划更新记录：2026-09-17，处理 #293 review：将发布后事实禁用规则抽为共享集合，补齐两个 CHANGELOG 的 VSIX SHA / 渠道状态负例，修正已完成计划链接，并明确 PR 验证针对预合并结果。
