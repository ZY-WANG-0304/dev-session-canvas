# GitHub Release Assets Publishing Flow

本 `ExecPlan` 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘` 这几个章节。

本计划遵循 `docs/PLANS.md` 的要求。当前任务会改变正式发布流水线和用户下载安装入口，因此必须把设计决策、实现步骤、验证证据和残余风险集中记录在本计划中。

## 目标与全局图景

本次变更完成后，维护者在发布准备 MR 合入 `main` 后，仍然通过临时 tag `publish/vX.Y.Z` 固定发布输入。GitHub Actions 会在同一个 release ref 上重新打包主扩展和 notifier 的 `.vsix`，生成 `release-artifacts/release-manifest-X.Y.Z.json`，创建正式 tag `vX.Y.Z`，再创建或更新绑定到该 tag 的 GitHub Release，并把两个 `.vsix` 和 manifest 上传为 Release assets。随后 workflow 继续复用同一批 VSIX 发布并验证 Visual Studio Marketplace 与 Open VSX。用户可观察到的结果是：正常情况下 marketplace 与 Open VSX 都有同版本扩展；如果 marketplace 访问或审核暂时不可用，GitHub Release 的 Assets 区也已经有可手动安装的 VSIX 包。

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

## 意外与发现

- 观察：当前 GitHub workflow 原本只上传 Actions artifact；设计文档已有“后续再视情况补 GitHub Release asset 上传步骤”的技术债，正好对应本次需求。
  证据：`docs/exec-plans/tech-debt-tracker.md` 中 2026-06-08 行记录了“release manifest 长期归档是否进入 GitHub Release”。
- 观察：GitHub tag 本身没有 assets，二进制附件必须挂到绑定 tag 的 GitHub Release 上。
  证据：GitHub 官方 Releases 文档把二进制文件称为 Release assets，REST API 也在 Releases 命名空间下管理 assets。
- 观察：当前 0.15.2 准备工作位于被删除的 `release-0-15-2` 分支；当前主题分支基线是 `origin/main` 的 `52899a7`。
  证据：执行 `git push origin --delete release-0-15-2` 和 `git branch -D release-0-15-2` 后，`git status --short --branch` 显示当前分支为 `ci/release-tag-assets`。
- 观察：当前环境安装的 `gh` CLI 没有 `gh release edit` 子命令，因此 workflow 不能依赖该命令更新已有 Release。
  证据：本地执行 `gh release edit --help` 返回 `unknown command "edit" for "gh release"`，可用命令只有 `create`、`delete`、`download`、`list`、`upload`、`view`。
- 观察：如果先等 marketplace 全部验证成功再创建 GitHub Release assets，则 Visual Studio Marketplace 临时不可用时仍拿不到 GitHub 下载入口；如果先上传 assets 再跑 marketplace，则 job 可以失败但用户仍有 VSIX 兜底包。
  证据：workflow 现在先运行 `release:publish-tag -- --package-only`，创建 `vX.Y.Z` tag 并上传 Release assets，再运行 `release:publish-tag -- --skip-package` 发布并验证 marketplaces；marketplace 失败时保留 `publish/vX.Y.Z` 供重跑。
- 观察：GitHub Actions 的 `continue-on-error` 容易让后续条件判断依赖 `outcome` / `conclusion` 语义，发布流程中更安全的做法是由 marketplace step 自己捕获退出码并写入 output。
  证据：workflow 的 `Publish and verify marketplaces` step 现在执行命令后写出 `status=$status` 到 `$GITHUB_OUTPUT`，后续删除临时 tag 和显式失败都只判断 `steps.marketplaces.outputs.status`。
- 观察：`gh api -F body=@file` 会按 CLI 规则把文件内容作为字段值读取，但为避免不同版本或 PATCH 语义下误解，workflow 先把 notes 文件读入 shell 变量，再用 `-f body=...` 提交纯字符串。
  证据：本地 `gh api --help` 说明 `-F` 遇到 `@` 会读文件；当前 workflow 已改为 `body="$(cat "$notes_file")"` 后调用 `gh api --method PATCH ... -f body="$body"`。

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

## 结果与复盘

本计划的本地交付已经完成：0.15.2 准备分支已清理，workflow 已改为“先上传 GitHub Release assets、再继续发布并验证 Visual Studio Marketplace / Open VSX”，正式文档和技术债已同步，目标测试与静态检查均通过。当前剩余风险是尚未用真实 `publish/vX.Y.Z` tag 在 GitHub Actions 中完成首跑，因此设计文档验证状态保持“验证中”，技术债记录继续跟踪真实 Actions 首跑。

## 上下文与定向

当前仓库是 VS Code 扩展项目。根扩展的安装包名形如 `dev-session-canvas-X.Y.Z.vsix`，notifier companion 的安装包名形如 `extensions/vscode/dev-session-canvas-notifier/dev-session-canvas-notifier-X.Y.Z.vsix`。现有发布脚本 `scripts/release/publish-tag-release.mjs` 会从 `publish/vX.Y.Z` 临时 tag 解析版本和 commit，调用 `npm run publish:marketplaces -- --package-only` 打包两份 VSIX，生成 `release-artifacts/release-manifest-X.Y.Z.json`，再发布 marketplace、验证、创建正式 tag、按需删除临时 tag。GitHub Actions 文件是 `.github/workflows/publish-marketplace-release.yml`。

本次要把“安装包上传到 GitHub Release assets”插入现有 release-day 编排中，同时继续发布并验证 Visual Studio Marketplace / Open VSX。workflow 负责调用 GitHub CLI `gh release create`、GitHub REST API PATCH 和 `gh release upload`，因为 Release assets 是 GitHub 平台动作，使用 `GITHUB_TOKEN` 的 `contents: write` 权限即可完成。marketplace 发布仍依赖 `VSCE_PAT` / `OVSX_PAT`。

## 工作计划

第一步恢复脚本层：不新增 `--github-release-only`，继续保留 `--package-only`、`--skip-package`、`--delete-trigger-tag` 等已有入口。`--package-only` 用于生成 VSIX 与初始 manifest；`--skip-package` 用于复用这批 VSIX 并校验 sha256 后继续 marketplace 发布与验证。

第二步修改 `.github/workflows/publish-marketplace-release.yml`。workflow 仍监听 `create` 的 `publish/v*` tag 和 `workflow_dispatch`，仍 checkout 临时 tag 指向的 ref，仍 `npm ci`。然后先运行 `npm run release:publish-tag -- --trigger-tag "$TRIGGER_TAG" --package-only` 生成 VSIX / manifest。由于 GitHub Release 必须绑定 tag，workflow 接着创建或确认正式 `vX.Y.Z` tag 指向同一 release ref，再创建或更新 GitHub Release，并用 `gh release upload --clobber` 上传 manifest 与两个 VSIX。

第三步继续在同一 job 中运行 `npm run release:publish-tag -- --trigger-tag "$TRIGGER_TAG" --skip-package`。这一步会复用 manifest / VSIX，发布并验证 Visual Studio Marketplace 与 Open VSX。若这一步成功，workflow 上传最终 manifest，删除 `publish/vX.Y.Z`，并再次上传 manifest 记录 trigger tag 已删除。若这一步失败，workflow 上传失败状态 manifest 后让 job 失败，并保留 `publish/vX.Y.Z` 供重跑。

第四步同步文档。`docs/design-docs/public-marketplace-release-readiness.md` 要更新发布流水线基线：GitHub Release assets 是安装包镜像 / 兜底，不替代 marketplace 发布与验证。`docs/public-preview-release-playbook.md` 和 `docs/notifier-preview-release-playbook.md` 要说明 workflow 仍要求 `VSCE_PAT` / `OVSX_PAT`，仍发布并验证 Visual Studio Marketplace / Open VSX。`docs/exec-plans/tech-debt-tracker.md` 要把残余风险改成真实 Actions 首跑、assets 上传、marketplace 失败时 tag / manifest 状态是否符合预期。

第五步运行验证。目标测试至少包括 `npm run test:publish-tag-release`，证明脚本恢复后原有发布编排测试仍通过。运行 `git diff --check` 检查空白，运行 `node --check scripts/release/publish-tag-release.mjs` 检查脚本语法，并使用 `js-yaml` 解析 workflow。真实 Release assets 上传与 marketplace 发布只能在 GitHub Actions 中首跑确认，本地验证只覆盖脚本和 workflow 静态结构。

## 具体步骤

在仓库根目录执行修改和验证。实现完成后预期运行：

    npm run test:publish-tag-release
    git diff --check
    node --check scripts/release/publish-tag-release.mjs
    node -e "const fs = require('fs'); const yaml = require('js-yaml'); yaml.load(fs.readFileSync('.github/workflows/publish-marketplace-release.yml', 'utf8')); console.log('workflow yaml parsed');"

真实 Release assets 上传、Visual Studio Marketplace 发布、Open VSX 发布与 post-publish metadata 验证只能通过 GitHub Actions 首跑确认。

本次已获得的本地验证记录如下：

    npm run test:publish-tag-release
    # publish-tag-release tests passed

    node --check scripts/release/publish-tag-release.mjs
    node --check scripts/test/test-publish-tag-release.mjs
    git diff --check
    # 均无输出，退出码 0

    node -e "const fs = require('fs'); const yaml = require('js-yaml'); yaml.load(fs.readFileSync('.github/workflows/publish-marketplace-release.yml', 'utf8')); console.log('workflow yaml parsed');"
    # workflow yaml parsed

## 验证与验收

验收标准是：

workflow 文件中仍要求 `VSCE_PAT` / `OVSX_PAT`，仍运行 `release:publish-tag -- --skip-package` 发布并验证 marketplace；同时能从 `publish/vX.Y.Z` 推导 `vX.Y.Z`，创建 / 更新对应 GitHub Release，并上传两个 `.vsix` 与 manifest。文档中不再把 GitHub Release assets 写成 marketplace 的替代路径，也不再把“tag assets”写成 GitHub 的真实能力。

## 幂等性与恢复

`publish/vX.Y.Z` 临时 tag 仍是可重跑输入。若 workflow 在上传 Release assets 前失败，重跑同一 workflow 会重新打包并上传。若 GitHub Release 已存在，workflow 使用 GitHub REST API PATCH 更新 release body / target / name，并用 `gh release upload --clobber` 覆盖同名 assets。若 marketplace 发布或验证失败，workflow 保留 `publish/vX.Y.Z`，让维护者修复 token / 渠道问题后重跑同一 release input。若 marketplace 全部成功，workflow 删除 `publish/vX.Y.Z`，并上传最终 manifest。

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
    npm run release:publish-tag -- --trigger-tag publish/vX.Y.Z --skip-package

workflow 使用 GitHub CLI `gh` 和 GitHub REST API，依赖 GitHub Actions runner 默认提供的 `GITHUB_TOKEN`。`.github/workflows/publish-marketplace-release.yml` 的 `permissions.contents: write` 必须保留，因为创建 tag、删除临时 tag、创建 / 更新 Release 和上传 assets 都需要写权限。marketplace 发布仍依赖 repository secrets `VSCE_PAT` 与 `OVSX_PAT`。
