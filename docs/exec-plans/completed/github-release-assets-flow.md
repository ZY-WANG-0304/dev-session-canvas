# GitHub Release Assets Publishing Flow

本 `ExecPlan` 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘` 这几个章节。

本计划遵循 `docs/PLANS.md` 的要求。当前任务会改变正式发布流水线和用户下载安装入口，因此必须把设计决策、实现步骤、验证证据和残余风险集中记录在本计划中。

## 目标与全局图景

本次变更完成后，维护者在发布准备 MR 合入 `main` 后，仍然通过临时 tag `publish/vX.Y.Z` 固定发布输入。GitHub Actions 会先检查 `vX.Y.Z` 对应的 GitHub Release 是否已经存在完整的 manifest 与两份 VSIX assets：如果不存在 Release，则在同一个 release ref 上打包主扩展和 notifier 的 `.vsix`，生成 `release-artifacts/release-manifest-X.Y.Z.json`，创建正式 tag `vX.Y.Z`，再创建或更新绑定到该 tag 的 GitHub Release，并把两个 `.vsix` 和 manifest 上传为 Release assets；如果完整 assets 已存在，则下载并校验这批既有 assets，拒绝重新打包或覆盖 VSIX。随后 workflow 继续复用同一批 VSIX 发布并验证 Visual Studio Marketplace 与 Open VSX。用户可观察到的结果是：正常情况下 marketplace 与 Open VSX 都有同版本扩展；如果 marketplace 访问或审核暂时不可用，GitHub Release 的 Assets 区也已经有可手动安装的 VSIX 包。

这里的“Release assets”是 GitHub Release 附件，不是 tag 本身的附件；GitHub tag 只能指向 git 对象，不能直接挂二进制文件。因此本计划明确把文档口径写成“上传到 `vX.Y.Z` 对应 GitHub Release 的 assets”，避免误写成“tag assets”。

## 进度

- [x] (2026-06-13T12:08Z) 已按仓库要求读取 `docs/WORKFLOW.md`、`docs/PLANS.md`，确认当前工作从最新 `main` 的 `ci/release-tag-assets` 分支推进。
- [x] (2026-06-13T12:08Z) 已删除本地与远端 `release-0-15-2` 准备分支，保留用户已有未跟踪文件不做处理。
- [x] (2026-06-13T12:08Z) 已确认现有发布 workflow 以 `publish/vX.Y.Z` 临时 tag 触发，并调用 `release:publish-tag` 发布 Visual Studio Marketplace 与 Open VSX 后再创建正式 tag。
- [x] (2026-06-13T12:40Z) 已确认不应跳过 Visual Studio Marketplace / Open VSX；本轮改为保留 marketplace 发布与验证，并把 GitHub Release assets 作为同一批 VSIX 的镜像与兜底下载入口。
- [x] (2026-06-13T12:40Z) 已恢复发布脚本，不新增 `--github-release-only`；workflow 使用既有 `--package-only` 先生成 VSIX / manifest，再使用 `--skip-package` 继续发布并验证 marketplace。
- [x] (2026-06-13T12:40Z) 已修改 GitHub Actions workflow：校验 `VSCE_PAT` / `OVSX_PAT`，先打包并上传 GitHub Release assets，再发布并验证 Visual Studio Marketplace / Open VSX，成功后删除临时 tag。
- [x] (2026-06-13T13:05Z) 已同步正式设计文档、发布手册和技术债记录，明确 GitHub Release assets 是额外镜像 / 兜底，不替代 marketplace 发布与验证。
- [x] (2026-06-13T13:18Z) 已运行目标测试和语法检查：`npm run test:publish-tag-release`、`node --check scripts/release/publish-tag-release.mjs`、`node --check scripts/test/test-publish-tag-release.mjs`、`git diff --check`、`js-yaml` 解析 workflow 均通过。
- [x] (2026-06-13T15:25Z) 已处理 PR review blocker：正式 tag 不存在时改用 `git rev-parse --verify --quiet` 静默解析，并新增 `test:publish-marketplace-workflow` 覆盖缺失正式 tag 的 workflow 回归。
- [x] (2026-06-14T01:45Z) 已处理 PR review blocker：workflow 重跑时先复用并校验既有 GitHub Release manifest / VSIX assets；若已有 Release 缺少任一必需 asset，则拒绝重新打包或 clobber，避免同一版本的 marketplace 与 Release assets 指向不同 VSIX 批次。
- [x] (2026-06-14T04:50Z) 已根据 `0.15.2` 发布实际失败模式收口：Open VSX 与 Visual Studio Marketplace 在 workflow 中拆成独立步骤，任一 marketplace 失败不再阻断另一 marketplace 尝试发布；最终 manifest 与 GitHub Release notes 无论成功失败都会上传 / 更新，Release notes 从 `CHANGELOG.md` 与 manifest 生成，包含版本亮点、渠道状态、残余风险和发布证据。
- [x] (2026-06-14T05:33Z) 已完成解耦 workflow 的本地验证：`npm run test:publish-tag-release`、`npm run test:publish-marketplace-workflow`、脚本 `node --check`、workflow YAML 解析与 `git diff --check` 均通过；当时新 workflow 仍待下一次真实 `publish/vX.Y.Z` tag 首跑验证。
- [x] (2026-06-14T15:19Z) 已处理 PR review blocker：确认同一个 workflow run 重新运行时 `upload-artifact@v4` 同名 artifact 会冲突，并在 `test:publish-marketplace-workflow` 中补回归断言；后续 2026-06-15 评审进一步要求兼容 failed-only rerun，因此最终方案改为稳定 artifact 名称 + 显式 overwrite。
- [x] (2026-06-15T00:55Z) 已处理 PR review blocker：marketplace job 在上传自身 result manifest 后按发布退出码标红；Actions artifact 名称改回同一 run 内稳定的 `github.run_id` 并显式 `overwrite: true`，让 GitHub Actions 的 Re-run failed jobs 能复用 prepare 产物并实际重试失败 marketplace job。

- [x] (2026-06-15T08:20Z) 用户明确允许 `0.16.0` 在 Visual Studio Marketplace 仍不可公开查询时，仅依赖 GitHub Release assets 与 Open VSX 兜底完成；已把 release completion gate 从“两市场均 verified”调整为“GitHub Release assets uploaded + Open VSX main/notifier verified”，并将 Visual Studio Marketplace 记录为 deferred channel。
- [x] (2026-06-15T08:37Z) 已用真实 `publish/v0.16.0` tag 完成 GitHub Actions 首跑：run `27533849564` 成功上传 GitHub Release assets、验证 Open VSX 主扩展 / notifier、把 Visual Studio Marketplace 记录为 deferred、更新最终 manifest / Release notes，并删除远端临时 tag。
- [x] (2026-06-15T09:20Z) 已将本计划归档到 `docs/exec-plans/completed/github-release-assets-flow.md`，并把剩余非阻塞问题收敛为 Visual Studio Marketplace deferred channel 技术债。

## 意外与发现

- 观察：当前 GitHub workflow 原本只上传 Actions artifact；设计文档已有“后续再视情况补 GitHub Release asset 上传步骤”的技术债，正好对应本次需求。
  证据：`docs/exec-plans/tech-debt-tracker.md` 中 2026-06-08 行记录了“release manifest 长期归档是否进入 GitHub Release”。
- 观察：GitHub tag 本身没有 assets，二进制附件必须挂到绑定 tag 的 GitHub Release 上。
  证据：GitHub 官方 Releases 文档把二进制文件称为 Release assets，REST API 也在 Releases 命名空间下管理 assets。
- 观察：当前 0.15.2 准备工作位于被删除的 `release-0-15-2` 分支；当前主题分支基线是 `origin/main` 的 `52899a7`。
  证据：执行 `git push origin --delete release-0-15-2` 和 `git branch -D release-0-15-2` 后，`git status --short --branch` 显示当前分支为 `ci/release-tag-assets`。
- 观察：当前环境安装的 `gh` CLI 没有 `gh release edit` 子命令，因此 workflow 不能依赖该命令更新已有 Release。
  证据：本地执行 `gh release edit --help` 返回 `unknown command "edit" for "gh release"`，可用命令只有 `create`、`delete`、`download`、`list`、`upload`、`view`。
- 观察：如果先等 marketplace 全部验证成功再创建 GitHub Release assets，则 Visual Studio Marketplace 临时不可用时仍拿不到 GitHub 下载入口；如果先上传或复用 assets 再跑 marketplace，则 job 可以失败但用户仍有 VSIX 兜底包。
  证据：workflow 在 Release 不存在时运行 `release:publish-tag -- --package-only`，创建 `vX.Y.Z` tag 并上传 Release assets；在 Release assets 已完整存在时下载并校验既有 assets；随后统一运行 `release:publish-tag -- --skip-package` 发布并验证 marketplaces，marketplace 失败时保留 `publish/vX.Y.Z` 供重跑。
- 观察：GitHub Actions 的 `continue-on-error` 容易让后续条件判断依赖 `outcome` / `conclusion` 语义，发布流程中更安全的做法是由 marketplace step 自己捕获退出码并写入 output。
  证据：workflow 的 `Publish and verify marketplaces` step 现在执行命令后写出 `status=$status` 到 `$GITHUB_OUTPUT`，后续删除临时 tag 和显式失败都只判断 `steps.marketplaces.outputs.status`。
- 观察：`gh api -F body=@file` 会按 CLI 规则把文件内容作为字段值读取，但为避免不同版本或 PATCH 语义下误解，workflow 先把 notes 文件读入 shell 变量，再用 `-f body=...` 提交纯字符串。
  证据：本地 `gh api --help` 说明 `-F` 遇到 `@` 会读文件；当前 workflow 已改为 `body="$(cat "$notes_file")"` 后调用 `gh api --method PATCH ... -f body="$body"`。
- 观察：`git rev-parse "$final_tag^{}"` 在 tag 缺失时即使退出非零，也会把未解析的 rev token 写到 stdout；如果命令替换后接 `|| true`，变量会变成非空字符串，导致 workflow 把缺失 tag 误判为指向错误 ref。
  证据：review 复现了 `local_ref="$(git rev-parse "$final_tag^{}" 2>/dev/null || true)"` 会得到 `v9.9.9^{}`；当前 workflow 改为 `git rev-parse --verify --quiet "$final_tag^{}"`，并由 `npm run test:publish-marketplace-workflow` 验证缺失 tag 时 `local_ref` 为空。
- 观察：同一 checkout 上重复执行 VSIX 打包并不保证 byte-for-byte 可复现；若 workflow 在 marketplace 部分失败后重跑并重新打包，再用 `gh release upload --clobber` 覆盖 Release assets，而发布脚本又把已存在的 marketplace 版本标记为 `already-published`，就会破坏“同一版本的 GitHub Release / Visual Studio Marketplace / Open VSX 使用同一批 VSIX 与 checksum manifest”的不变量。
  证据：PR review 在同一 checkout 上两次执行 `npm run package:vsix`，主扩展 VSIX sha256 从 `b00c2843aaa3434beb18c019df176f4fa992fc251e8922ce0755bd4f277c7d00` 变为 `6f620665098c46a6d9401c76daf49cd4d0b610992e403e87a185a1ae354566b2`；当前 workflow 新增既有 Release assets 检测、下载与 `--skip-package --package-only` 校验，重跑 marketplace 前必须复用同一批 VSIX。
- 观察：`0.15.2` 真实发布中 Visual Studio Marketplace 的 `VSID Concurrency` 限流发生在 notifier 的 visual-studio 步骤，导致原先串行 all-target 发布还没进入 Open VSX；但 Open VSX 与 Microsoft Marketplace 是独立渠道，Open VSX 可以复用同一批 GitHub Release assets 单独补发成功。
  证据：`0.15.2` GitHub Actions run `27487404678` 在 `devsessioncanvas.dev-session-canvas-notifier` 的 Visual Studio Marketplace 发布处失败；随后本地复用 `v0.15.2` Release assets 把主扩展与 notifier 都补发到 Open VSX `0.15.2` 并验证 API files metadata 齐全。
- 观察：`actions/upload-artifact@v4` 的同名 artifact 在同一个 workflow run 的 full rerun attempt 中会冲突；但如果 artifact 名称加入 `github.run_attempt`，GitHub Actions 的 Re-run failed jobs 不会重跑已经成功的 prepare job，失败 marketplace / finalize job 又会去下载当前 attempt 的 prepare artifact，导致恢复路径找不到产物。
  证据：workflow 现在把 `prepared-release-*`、两个 `marketplace-result-*` 和最终 `marketplace-release-*` 的 artifact 名称统一保持为 `${{ github.run_id }}`，所有 upload 都显式 `overwrite: true`；marketplace job 在上传 result manifest 后根据自身 publish / secret status 标红，`npm run test:publish-marketplace-workflow` 校验不再出现 `github.run_attempt`，并覆盖 failed-only rerun 可重试失败 marketplace job 的结构。

- 观察：`0.16.0` release-day 前再次复核 Visual Studio Marketplace public gallery，主扩展与 notifier 对应 extension id 仍返回 0 个结果；如果继续把 VSM 作为阻塞门禁，会导致已可用的 GitHub Release assets 与 Open VSX 同版本兜底也无法对外收口。
  证据：2026-06-15 在最终 `main` ref `936f61bc067dd6c5ab0c4f7cced970254bf01e59` 上复核 `devsessioncanvas.dev-session-canvas` 与 `devsessioncanvas.dev-session-canvas-notifier`，VSM public gallery `extensionquery` 均为 `count=0`；用户随后明确允许在 VSM 仍不可见时仅依赖 GitHub Release assets 和 Open VSX 兜底。

- 观察：`0.16.0` 真实 GitHub Actions 首跑验证了新的 GitHub Release assets + Open VSX 完成门禁；workflow 在 VSM 目标失败 / deferred 的情况下仍成功完成最终 manifest / Release notes 更新并删除临时 tag。
  证据：GitHub Actions run `27533849564` 的四个 job 均为 success；GitHub Release `v0.16.0` 有 `dev-session-canvas-0.16.0.vsix`、`dev-session-canvas-notifier-0.16.0.vsix`、`release-manifest-0.16.0.json` 三个 assets；最终 manifest `status` 为 `complete-with-deferred-visual-studio`，`openVsxComplete` 为 `true`，`visualStudioComplete` 为 `false`，`triggerTagStatus` 为 `deleted`。

## 决策记录

- 决策：本次不把安装包描述为 tag assets，而是创建绑定正式 tag 的 GitHub Release，并上传 `.vsix` 与 manifest 为 Release assets。
  理由：GitHub 的可下载二进制附件模型属于 Release，不属于裸 tag；这样用户仍能从版本页按 tag 找到下载入口，同时术语准确。
  日期/作者：2026-06-13 / Codex
- 决策：保留 `publish/vX.Y.Z` 临时 tag 作为发布输入固定机制，正式 `vX.Y.Z` tag 仍由 workflow / 脚本围绕同一 release ref 创建。
  理由：临时 tag 已经解决 release ref 漂移问题，本次只增加 GitHub Release assets 镜像，不重新设计发布输入模型。
  日期/作者：2026-06-13 / Codex
- 决策：GitHub Release assets 不替代 Visual Studio Marketplace / Open VSX 发布与验证；workflow 必须继续执行 marketplace 发布与验证。
  理由：用户明确指出不能跳过 marketplace 分发与验证；Release assets 是额外兜底下载入口，不是新的唯一分发渠道。
  日期/作者：2026-06-13 / Codex
- 决策：workflow 先上传 GitHub Release assets，再继续 marketplace 发布与验证；只有 marketplace 发布与验证成功后才删除 `publish/vX.Y.Z`。
  理由：这样即使 Visual Studio Marketplace 通路临时失败，GitHub Release assets 仍可供手动安装；同时保留临时 tag 能用同一 release input 重跑 marketplace 步骤。
  日期/作者：2026-06-13 / Codex
- 决策：不修改 `scripts/release/publish-tag-release.mjs` 的核心发布语义，不新增 `--github-release-only`。
  理由：现有脚本已经支持 `--package-only` 和 `--skip-package`，足以把“打包 / 上传 assets”和“marketplace 发布 / 验证”拆成两个可重试阶段；避免引入一条绕过 marketplace 的误用路径。
  日期/作者：2026-06-13 / Codex
- 决策：workflow 不依赖 `continue-on-error` 的 step `outcome` 判断 marketplace 是否成功，而是显式记录 marketplace 命令退出码。
  理由：删除临时 tag 是不可逆发布收口动作，应由明确的退出码控制；这样 marketplace 失败时 workflow 仍能上传最终 manifest，再显式失败并保留临时 tag。
  日期/作者：2026-06-13 / Codex
- 决策：Open VSX 与 Visual Studio Marketplace 在 workflow 中拆成两个独立发布 / 验证步骤，且都使用 `--no-create-final-tag` 复用同一批 VSIX。
  理由：两个 marketplace 的 token、限流、审核和可见性相互独立；某一市场失败不应阻断另一市场完成发布。最终 tag / 临时 tag 删除仍由 workflow 在两个步骤都成功后统一处理。
  日期/作者：2026-06-14 / Codex
- 决策：GitHub Release notes 不再使用静态模板，改为由 `CHANGELOG.md` 当前版本段落与 release manifest 生成，并在最终 manifest 上传前重新 PATCH 到 GitHub Release。
  理由：Release 页面是用户可见下载入口，必须包含版本亮点和残余风险；同时 marketplace 部分成功 / 失败时，Release 页面也要反映最终渠道状态，而不是只说有 VSIX assets。
  日期/作者：2026-06-14 / Codex
- 决策：`vX.Y.Z` 对应 GitHub Release 已经存在完整 manifest 与两份 VSIX assets 时，workflow 重跑必须下载并校验这批 assets，然后用 `--skip-package` 继续 marketplace 发布 / 验证；已有 Release 缺少任一必需 asset 时直接失败，不重新打包或 clobber。
  理由：VSIX 打包当前不是 byte-for-byte 可复现；重跑时重新打包并覆盖 Release assets 可能让已发布 marketplace 目标与最终 manifest 记录不同 VSIX。复用既有 assets 能保持同一版本的分发渠道与 checksum manifest 对齐。
  日期/作者：2026-06-14 / Codex
- 决策：workflow 内部 Actions artifact 名称在同一个 workflow run 内保持 `github.run_id` 稳定，并对所有 upload 显式设置 `overwrite: true`。
  理由：GitHub Actions 的 Re-run failed jobs 不会重跑已经成功的 prepare job；稳定 artifact 名称能让失败 marketplace / finalize job 在 failed-only rerun 中继续下载同一批 prepare 产物，而 `overwrite: true` 避免 full rerun 时同名 artifact 冲突。
  日期/作者：2026-06-15 / Codex

- 决策：`0.16.0` release-day 的完成门禁改为 GitHub Release assets 已上传且 Open VSX 主扩展 / notifier 均验证通过；Visual Studio Marketplace 仍尝试发布 / 验证，但若 public gallery 仍不可见，则作为 deferred channel 记录到 manifest / Release notes，不阻塞临时 tag 删除和本轮完成。
  理由：用户已明确允许在 VSM 仍不可见时仅依赖 GitHub Release assets 与 Open VSX 兜底；同时保留 VSM 状态记录，避免把未恢复的官方 VS Code Marketplace 路径误写成已可用。
  日期/作者：2026-06-15 / Codex

- 决策：真实首跑完成后，将本计划从 `active` 归档到 `completed`，并把剩余未闭合项改记为 Visual Studio Marketplace deferred channel 技术债。
  理由：GitHub Release assets 上传、Open VSX 完成门禁、finalize 合并 manifest / notes、临时 tag 删除和 Release asset 校验均已有真实发布证据；剩余问题不是该 workflow 首跑缺口，而是 VSM public gallery / publisher 可见性仍未恢复。
  日期/作者：2026-06-15 / Codex

## 结果与复盘

本计划已完成并归档：workflow 已改为“先上传或复用 GitHub Release assets、再分别发布并验证 Open VSX 与 Visual Studio Marketplace”，并已在 `0.16.0` 真实 GitHub Actions run `27533849564` 中验证首跑。PR review 发现的缺失正式 tag 误判、非确定性 VSIX 重打包 / Release assets clobber 风险、marketplace 串行 fail-fast 风险，以及 GitHub Actions artifact rerun 冲突都已通过测试和真实发布收口。最终 `v0.16.0` Release assets 已上传，Open VSX 主扩展 / notifier 均 verified，Release manifest / notes 已更新，`publish/v0.16.0` 临时 tag 已删除。剩余非阻塞问题是 Visual Studio Marketplace public gallery 仍不可见，本轮已按用户确认记录为 deferred channel，并在 `docs/exec-plans/tech-debt-tracker.md` 继续跟踪后续补发 / 可见性恢复。

## 上下文与定向

当前仓库是 VS Code 扩展项目。根扩展的安装包名形如 `dev-session-canvas-X.Y.Z.vsix`，notifier companion 的安装包名形如 `extensions/vscode/dev-session-canvas-notifier/dev-session-canvas-notifier-X.Y.Z.vsix`。现有发布脚本 `scripts/release/publish-tag-release.mjs` 会从 `publish/vX.Y.Z` 临时 tag 解析版本和 commit，调用 `npm run publish:marketplaces -- --package-only` 打包两份 VSIX，生成 `release-artifacts/release-manifest-X.Y.Z.json`，再发布 marketplace、验证、创建正式 tag、按需删除临时 tag。GitHub Actions 文件是 `.github/workflows/publish-marketplace-release.yml`。

本次要把“安装包上传到 GitHub Release assets”插入现有 release-day 编排中，同时继续发布并验证 Visual Studio Marketplace / Open VSX。`0.15.2` 真实发布后，本计划进一步把两个 marketplace 解耦成独立发布 job，避免 Microsoft Marketplace 限流阻断 Open VSX。workflow 负责调用 GitHub CLI `gh release create`、GitHub REST API PATCH 和 `gh release upload`，因为 Release assets 是 GitHub 平台动作，使用 `GITHUB_TOKEN` 的 `contents: write` 权限即可完成。marketplace 发布仍依赖 `VSCE_PAT` / `OVSX_PAT`。

## 工作计划

第一步恢复脚本层：不新增 `--github-release-only`，继续保留 `--package-only`、`--skip-package`、`--delete-trigger-tag` 等已有入口。`--package-only` 用于生成 VSIX 与初始 manifest；`--skip-package` 用于复用这批 VSIX 并校验 sha256 后继续 marketplace 发布与验证。

第二步修改 `.github/workflows/publish-marketplace-release.yml`。workflow 只监听 `push` 的 `publish/v*` tag 和 `workflow_dispatch`，仍 checkout 临时 tag 指向的 ref，仍 `npm ci`。`prepare` job 先检查 `vX.Y.Z` 对应 GitHub Release：如果 Release 不存在，才运行 `npm run release:publish-tag -- --trigger-tag "$TRIGGER_TAG" --package-only` 生成 VSIX / manifest；如果 Release 已有完整 manifest、主扩展 VSIX 与 notifier VSIX assets，则下载到本地预期路径，并运行 `npm run release:publish-tag -- --trigger-tag "$TRIGGER_TAG" --skip-package --package-only` 校验 checksum；如果 Release 已存在但 assets 不完整，直接失败，要求人工修复，不允许重新打包覆盖。由于 GitHub Release 必须绑定 tag，package 模式下 workflow 接着创建或确认正式 `vX.Y.Z` tag 指向同一 release ref，再创建或更新 GitHub Release，并用 `gh release upload --clobber` 上传 manifest 与两个 VSIX；reuse 模式不覆盖 VSIX assets。prepare 阶段还会从 `CHANGELOG.md` 与 manifest 生成初始 Release notes。

第三步由 `publish-open-vsx` 与 `publish-visual-studio` 两个 job 分别下载 prepare 产物，校验对应 secret 后运行 `npm run release:publish-tag -- --trigger-tag "$TRIGGER_TAG" --skip-package --target <target> --no-create-final-tag`。两个 job 会先记录自身退出码并上传结果 manifest，再在缺 secret、发布失败或验证失败时标红；两者不互相依赖，因此某一 marketplace 失败不会阻断另一 marketplace job。

第四步由 `finalize` job 在 `always() && needs.prepare.result == 'success'` 下下载 prepare 产物和两个 marketplace 结果 manifest。它会合并可用 marketplace 状态，覆盖 GitHub Release manifest，并用最终 manifest 重新生成 Release notes；当前完成门禁是 Open VSX 成功，因此 Visual Studio Marketplace 失败 / 不可见时记录为 deferred channel 而不阻塞删除 `publish/vX.Y.Z`，Open VSX 失败时保留临时 tag 并显式失败。Actions artifact 名称在同一 run 内保持稳定并使用 `overwrite: true`，便于 Re-run failed jobs 复用已成功的 prepare artifact。

第五步同步文档。`docs/design-docs/public-marketplace-release-readiness.md` 要更新发布流水线基线：GitHub Release assets 是安装包镜像 / 兜底，不替代 marketplace 发布与验证；两个 marketplace 的失败域相互独立；Release notes 必须包含版本亮点和残余风险。`docs/public-preview-release-playbook.md` 和 `docs/notifier-preview-release-playbook.md` 要说明 workflow 仍要求 `VSCE_PAT` / `OVSX_PAT`，仍发布并验证 Visual Studio Marketplace / Open VSX。真实首跑完成后，文档还要记录 Actions run、Release assets、Open VSX verification、VSM deferred 状态，并把剩余风险改记为 VSM deferred channel 技术债。

第六步运行验证。目标测试至少包括 `npm run test:publish-tag-release`，证明脚本恢复后原有发布编排测试仍通过；`npm run test:publish-marketplace-workflow` 继续覆盖 workflow YAML 解析、缺失正式 tag 分支、既有 Release assets 检测 / 下载 / 校验、marketplace job 解耦、失败 marketplace job 上传 manifest 后标红、failed-only rerun 可复用稳定 artifact、最终 Release manifest / notes 更新，以及 package 模式才允许打包和上传 VSIX assets。运行 `git diff --check` 检查空白，运行脚本 `node --check` 检查语法，并使用 `js-yaml` 解析 workflow。真实 Release assets 上传与 Open VSX 发布已在 GitHub Actions run `27533849564` 中确认；本地验证仍覆盖脚本和 workflow 静态结构，Visual Studio Marketplace 可见性恢复需后续补发复核。

## 具体步骤

在仓库根目录执行修改和验证。实现完成后预期运行：

    npm run test:publish-tag-release
    npm run test:publish-marketplace-workflow
    git diff --check
    node --check scripts/release/publish-tag-release.mjs
    node --check scripts/release/write-github-release-notes.mjs
    node -e "const fs = require('fs'); const yaml = require('js-yaml'); yaml.load(fs.readFileSync('.github/workflows/publish-marketplace-release.yml', 'utf8')); console.log('workflow yaml parsed');"

真实 Release assets 上传、Open VSX 发布验证、Visual Studio Marketplace deferred 记录、最终 manifest / Release notes 更新与临时 tag 删除已通过 GitHub Actions run `27533849564` 确认；Visual Studio Marketplace public gallery 可见性仍需后续补发 / 复核。

本次已获得的本地验证记录如下：

    npm run test:publish-tag-release
    # publish-tag-release tests passed

    npm run test:publish-marketplace-workflow
    # publish-marketplace workflow tests passed

    node --check scripts/release/publish-tag-release.mjs
    node --check scripts/release/write-github-release-notes.mjs
    node --check scripts/test/test-publish-tag-release.mjs
    node --check scripts/test/test-publish-marketplace-workflow.mjs
    git diff --check
    # 均无输出，退出码 0

    node -e "const fs = require('fs'); const yaml = require('js-yaml'); yaml.load(fs.readFileSync('.github/workflows/publish-marketplace-release.yml', 'utf8')); console.log('workflow yaml parsed');"
    # workflow yaml parsed

## 验证与验收

验收标准是：

workflow 文件中仍要求 `VSCE_PAT` / `OVSX_PAT`，仍运行 `release:publish-tag -- --skip-package --target <target> --no-create-final-tag` 发布并验证 marketplace；同时能从 `publish/vX.Y.Z` 推导 `vX.Y.Z`，创建 / 更新对应 GitHub Release，并上传两个 `.vsix` 与 manifest。Open VSX 与 Visual Studio Marketplace 必须是独立 job，任一失败不阻断另一方；Open VSX 失败 job 必须在上传 result manifest 后标红，让 Re-run failed jobs 能实际重试失败渠道。`0.16.0` 当前完成门禁为 GitHub Release assets uploaded + Open VSX verified，Visual Studio Marketplace 可以 deferred 状态进入 manifest / notes。finalize job 必须在 marketplace 成功、失败或 deferred 后覆盖最终 manifest 和 GitHub Release notes，Release notes 必须包含版本亮点、渠道状态、残余风险和发布证据。重跑同一版本时，如果 GitHub Release 已有完整 assets，workflow 必须下载并校验既有 VSIX / manifest，而不是重新打包或 clobber；如果既有 Release 不完整，必须 fail closed。文档中不再把 GitHub Release assets 写成 marketplace 的替代路径，也不再把“tag assets”写成 GitHub 的真实能力。

## 幂等性与恢复

`publish/vX.Y.Z` 临时 tag 仍是可重跑输入。若 workflow 在创建 GitHub Release 前失败，重跑同一 workflow 可以重新打包并上传。若 `vX.Y.Z` 对应 GitHub Release 已存在且同时包含 `release-manifest-X.Y.Z.json`、`dev-session-canvas-X.Y.Z.vsix` 与 `dev-session-canvas-notifier-X.Y.Z.vsix`，workflow 下载这批 assets 到本地预期路径，使用 `--skip-package --package-only` 校验 manifest 与 VSIX sha256，然后继续 marketplace 发布 / 验证。若 GitHub Release 已存在但任一必需 asset 缺失，workflow 直接失败并要求人工修复或删除不完整 assets，不重新打包、不 clobber VSIX。若任一 marketplace 发布或验证失败，对应 marketplace job 会上传 result manifest 后失败，finalize job 仍上传最终 manifest 和 Release notes 后失败，但保留 `publish/vX.Y.Z`；维护者修复 token / 渠道问题后可使用 Re-run failed jobs 重跑失败 marketplace 与 finalize，或通过 workflow_dispatch 指定同一 trigger tag 重跑全流程。若 Open VSX 成功且 Visual Studio Marketplace 状态已记录为 verified 或 deferred，workflow 删除 `publish/vX.Y.Z`，并上传最终 manifest；后续 VSM 恢复时仍可用同一 release input / assets 进行补发验证。

## 证据与备注

当前已完成的清理证据：

    git push origin --delete release-0-15-2
    git branch -D release-0-15-2
    git checkout -b ci/release-tag-assets

当前分支状态保留用户未跟踪文件，不纳入本次改动：

    ?? dev-session-canvas.code-workspace
    ?? docs/references/vscode-marketplace-feedback-routes-0.15.1.md
    ?? docs/references/vscode-marketplace-feedback-routes-0.15.1.zh-CN.md
    ?? docs/references/vscode-marketplace-support-request-0.15.1.md
    ?? image copy 2.png
    ?? image copy.png
    ?? image.png

## 接口与依赖

不新增脚本参数。workflow 使用现有命令：

    npm run release:publish-tag -- --trigger-tag publish/vX.Y.Z --package-only
    npm run release:publish-tag -- --trigger-tag publish/vX.Y.Z --skip-package --package-only
    npm run release:publish-tag -- --trigger-tag publish/vX.Y.Z --skip-package --target open-vsx --no-create-final-tag
    npm run release:publish-tag -- --trigger-tag publish/vX.Y.Z --skip-package --target visual-studio --no-create-final-tag

workflow 使用 GitHub CLI `gh` 和 GitHub REST API，依赖 GitHub Actions runner 默认提供的 `GITHUB_TOKEN`。`.github/workflows/publish-marketplace-release.yml` 的 `permissions.contents: write` 必须保留，因为创建 tag、删除临时 tag、创建 / 更新 Release 和上传 assets 都需要写权限。marketplace 发布仍依赖 repository secrets `VSCE_PAT` 与 `OVSX_PAT`。
