# Publish Tag Release Flow

本 `ExecPlan` 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘` 这几个章节。

本计划遵循 `docs/PLANS.md` 的要求。当前任务会改变对外发布流程和 release-day 自动化边界，属于多步流程与脚本治理工作，必须通过本计划记录设计决策、验证证据和残余风险。

## 目标与全局图景

本次变更完成后，维护者可以在发布准备 MR 合并到 `main` 后创建临时 tag `publish/vX.Y.Z` 来固定发布输入；发布脚本会从这个 tag 解析版本与 commit，打包同一组主扩展和 notifier VSIX，生成不写回仓库的 release manifest，并在后续真实发布与验证完成后创建正式 `vX.Y.Z` tag、删除临时 `publish/` tag。这样能避免本地 `HEAD` 在发布过程中前进导致 README doc ref、VSIX 与 tag 指向不一致，也避免把发布后才知道的 manifest 事实写成新的仓库 commit。

用户可观察的结果是：运行本计划新增的 dry-run 命令时，终端会显示从 `publish/v0.14.2` 解析出的 `releaseRef`、`version`、两个 VSIX 的 sha256 和 README doc ref；如果 tag 版本与 `package.json` 不一致、tag 不在 `origin/main` 历史内，或 `--skip-package` 复用的 VSIX 不匹配 manifest，脚本会拒绝继续。

## 进度

- [x] (2026-06-08 14:27Z) 已从最新 `origin/main` 创建 `chore/publish-tag-release-flow` 分支，并重读 `docs/WORKFLOW.md` 与 `docs/PLANS.md`。
- [x] (2026-06-08 14:27Z) 已确认当前仓库没有 GitHub Actions workflow，现有 release 入口集中在 `scripts/release/package-vsix.mjs`、`scripts/release/publish-marketplaces.mjs`、`scripts/release/run-clean-checkout-vsix-validation.mjs` 和 notifier 子包的 `scripts/package-vsix.mjs`。
- [x] (2026-06-08 15:05Z) 已实现 `scripts/release/publish-tag-release.mjs`，支持从 `publish/vX.Y.Z` 解析 release ref、校验版本与主线祖先、打包、生成 release manifest、发布后验证、创建正式 tag 和删除临时 tag。
- [x] (2026-06-08 15:11Z) 已更新 `package.json` scripts、`.gitignore` / `.vscodeignore`、发布手册、notifier 手册、公开发布设计文档和设计索引。
- [x] (2026-06-08 15:13Z) 已新增 `scripts/test/test-publish-tag-release.mjs`，覆盖 tag 名称、版本不一致、dry-run manifest 和 skip-package 缺 VSIX失败。
- [x] (2026-06-08 15:24Z) 已运行目标测试：`npm run test:publish-tag-release`、`npm run test:publish-marketplaces`、`npm run test:package-vsix-command`、`npm run test:extension-manifest` 与 `git diff --check` 均通过。
- [x] (2026-06-09) 已检查远端 GitHub Actions 配置并补齐 repository secrets：Actions 已启用，`allowed_actions=all`，默认 `GITHUB_TOKEN` 权限为 read，workflow 通过 job-level `contents: write` 申请 tag 推送 / 删除权限；`VSCE_PAT` 与 `OVSX_PAT` 已按本地已验证的 `devsessioncanvas` token 写入 repository secrets。
- [x] (2026-06-09) 已给发布 workflow 增加同一 trigger tag 的 concurrency、60 分钟 timeout 与 secrets fail-fast 检查，避免重复发布任务并在 token 缺失时提前失败。
- [x] (2026-06-09) 已按 review 修复 tag deletion 自触发 blocker：workflow 不再监听 `push.tags`，改为监听 `create` event 并在 job `if` 中限定 `ref_type=tag` 且 `ref` 以 `publish/v` 开头，避免脚本删除临时 tag 后再次触发发布 job。

- [x] (2026-06-13) 已由 `docs/exec-plans/completed/github-release-assets-flow.md` 接续处理 GitHub Release assets 镜像与 marketplace 继续发布验证的组合方案；本计划中的原始 tag-first 机制仍作为输入固定基线保留。

## 意外与发现

- 观察：当前 `origin/main` 在 `v0.14.1` 之后已经前进到 `7579634`，这正好说明“从当前 `HEAD` 自动推断 expected release ref”是不安全的；脚本必须以显式 tag/ref 作为输入。
  证据：`git log --oneline --decorate --max-count=6 --graph --all` 显示 `origin/main` 位于 `7579634`，而 `v0.14.1` 指向 `0330588`。
- 观察：当前仓库在本分支前没有 `.github/workflows`，因此本轮先把发布逻辑保留在本地可测脚本中，再新增最小 GitHub Actions wrapper；workflow 只有在包含该文件的 release commit 合入 `main` 后才会随 `publish/vX.Y.Z` tag 生效。
  证据：本轮新增前 `find .github -maxdepth 3 -type f` 只列出 issue template 文件。
- 观察：远端 repository secrets 已补齐，但还没有真实 `publish/vX.Y.Z` tag 触发的 GitHub Actions 首跑；当前仍只能确认配置前置条件，不把真实发布流水线写成已验证。
  证据：`gh secret list --repo ZY-WANG-0304/dev-session-canvas` 显示 `OVSX_PAT` 与 `VSCE_PAT`；`gh api repos/ZY-WANG-0304/dev-session-canvas/actions/permissions` 显示 Actions enabled；`gh api repos/ZY-WANG-0304/dev-session-canvas/rulesets` 显示当前无 tag ruleset。
- 观察：`push.tags` 触发器会同时覆盖 tag push 事件语义，若发布脚本成功后删除 `publish/vX.Y.Z`，可能产生一次由 tag 删除引起的自触发风险；`create` event 只覆盖 ref 创建，删除 tag 对应 `delete` event。
  证据：GitHub Actions events 文档把 `create` 描述为创建 branch/tag 时触发，把 `delete` 描述为删除 branch/tag 时触发，并把 `push` 描述为 push commit 或 tag 时触发。
- 观察：notifier README 当前没有相对资源链接，因此 VSIX 内 readme 不一定包含 release ref；主扩展 README 包含中文 README 与媒体资源链接，会包含 release ref。
  证据：检查 0.14.1 VSIX 时，主扩展 `extension/readme.md` 包含 `0330588...`，notifier `extension/readme.md` 不包含该 SHA。

## 决策记录

- 决策：正式 release manifest 不写回代码库，而是在脚本运行目录生成到 `release-artifacts/`，后续 CI 或人工可上传为 GitHub Release asset。
  理由：manifest 记录 publish 后事实，若提交回 repo 会产生不属于本次发布输入的新 commit，造成 `vX.Y.Z` 应指向输入 commit 还是结果 commit 的语义混乱。
  日期/作者：2026-06-08 / Codex
- 决策：使用 `publish/vX.Y.Z` 作为临时触发 tag，正式 `vX.Y.Z` 仍表示四个 marketplace 目标已发布并验证完成。
  理由：这样既能固定 release input，允许失败后重跑同一输入，又保留当前仓库“正式 tag 表示发布完成”的语义。
  日期/作者：2026-06-08 / Codex
- 决策：新增最小 GitHub Actions workflow，但所有 release 逻辑仍放在仓库脚本中。
  理由：用户要求“开始”落地 tag-first 流程；workflow 只负责 checkout、npm ci、调用 `release:publish-tag` 和上传 artifact，具体校验、发布、tag 创建与删除都在本地可测脚本中，降低 CI 配置复杂度。
  日期/作者：2026-06-08 / Codex
- 决策：主扩展 VSIX 要求 README 包含 release ref；notifier VSIX 只记录 packaging doc ref，不强制 readme 内容包含 release ref。
  理由：notifier Marketplace README 当前没有相对链接，打包脚本仍会打印并使用 `VSCE README doc ref` 校验打包上下文，但内嵌 readme 内容本身不会出现 SHA。
  日期/作者：2026-06-08 / Codex

- 决策：2026-06-13 起，在继续发布并验证 Visual Studio Marketplace / Open VSX 的基础上，自动化发布增加 GitHub Release assets 镜像；最新方案由 `docs/exec-plans/completed/github-release-assets-flow.md` 跟踪。
  理由：用户需要 marketplace 分发与验证继续执行，同时也需要在 marketplace 访问、审核或同步暂时不可用时能从 GitHub Release 下载同一批 VSIX。
  日期/作者：2026-06-13 / Codex

## 结果与复盘

本计划的 tag-first 脚本、workflow 骨架、文档和测试已经落地，并通过目标验证。2026-06-13 之后，GitHub Release assets 镜像、marketplace 发布验证继续执行、临时 tag 删除顺序和首跑风险由 `docs/exec-plans/completed/github-release-assets-flow.md` 接续跟踪；本计划不再作为 Release assets 方案的最新事实来源。

## 上下文与定向

当前公开 VS Code 扩展发布涉及两个扩展：主扩展 `devsessioncanvas.dev-session-canvas`，manifest 位于 `extensions/vscode/dev-session-canvas/package.json`；notifier companion `devsessioncanvas.dev-session-canvas-notifier`，manifest 位于 `extensions/vscode/dev-session-canvas-notifier/package.json`。仓库根 `package.json` 只是 private workspace root，不再是可发布 extension manifest。两者必须保持同版本发布。

现有主扩展打包入口是 `npm run package:vsix`，其底层 `scripts/release/package-vsix.mjs` 会从 `extensions/vscode/dev-session-canvas/` staging 主扩展发布包、调用 `@vscode/vsce package`，并把主扩展子包内 `README.marketplace.md` 中的相对媒体链接改写到 `DEV_SESSION_CANVAS_VSCE_DOC_BRANCH` 或当前 `HEAD`。notifier 的打包入口是 `npm run -w extensions/vscode/dev-session-canvas-notifier package:vsix`，底层脚本在临时目录 staged 子包后调用同一套 VSCE 命令解析。

现有双市场发布入口是 `npm run publish:marketplaces -- --yes`，底层 `scripts/release/publish-marketplaces.mjs` 默认重新打包两个 VSIX，先发 notifier、再发 main，并把每个扩展发布到 Visual Studio Marketplace 和 Open VSX。Open VSX helper 是 `scripts/release/openvsx-api.py`，当前默认 timeout 为 120 秒，0.14.1 发布时曾遇到 timeout 和 registry throttling，需要后续编排支持重试恢复。

本计划新增的“publish tag 发布流程”不是新的产品功能，而是 release-day 操作治理：`publish/vX.Y.Z` 是临时 tag，用来固定要发布的 commit；`vX.Y.Z` 是正式 release tag，只在发布成功并验证后创建；release manifest 是 JSON 文件，记录版本、release ref、VSIX sha256、README doc ref 和各市场状态，默认生成在 `release-artifacts/` 并被 `.gitignore` 排除。

## 工作计划

首先新增 `scripts/release/publish-tag-release.mjs`。该脚本接受 `--trigger-tag publish/vX.Y.Z`、`--dry-run`、`--skip-package`、`--package-only`、`--target`、`--extension`、`--no-create-final-tag`、`--delete-trigger-tag` 等参数。它从 trigger tag 解析版本 `X.Y.Z`，用 `git rev-parse <tag>^{}` 固定 release ref，校验 package 版本、notifier 版本和 changelog 顶部存在目标版本，校验 release ref 是 `origin/main` 的祖先，并设置 `DEV_SESSION_CANVAS_VSCE_DOC_BRANCH=<releaseRef>` 调用现有打包和发布入口。脚本生成 release manifest 到 `release-artifacts/release-manifest-X.Y.Z.json`。

其次补强 `scripts/release/publish-marketplaces.mjs`，允许调用方通过环境传入 `DEV_SESSION_CANVAS_EXPECTED_RELEASE_REF`，在发布前校验当前 `HEAD` 与该 ref 一致，并在 Open VSX API helper 中传递较长 timeout。该改动服务于新编排脚本，也保留现有入口的向后兼容。

然后新增 `scripts/release/inspect-vsix.mjs` 或在 publish tag 脚本内实现 VSIX 读取逻辑，用 Node 的 `jszip` 读取 `extension/package.json`、`extension/README.marketplace.md` 或 `extension/README.md`，计算 sha256，校验 VSIX 内版本、publisher、name 和 README 链接中的 release ref。`--skip-package` 恢复发布时必须用这组检查证明 VSIX 属于当前 release ref。

最后更新 `docs/public-preview-release-playbook.md`、`docs/notifier-preview-release-playbook.md`、`docs/design-docs/public-marketplace-release-readiness.md` 和 `docs/design-docs/index.md`。发布手册从“publish 成功后手工补 tag”改为“创建 `publish/vX.Y.Z` 固定输入，脚本发布成功后创建正式 tag 并删除临时 tag”。设计文档记录该方案已选定和验证状态。

## 具体步骤

在仓库根目录执行以下命令创建并验证变更：

    git switch -c chore/publish-tag-release-flow origin/main
    node scripts/release/publish-tag-release.mjs --help
    npm run test:publish-marketplaces
    npm run test:publish-tag-release

本地 dry-run 验证可以创建一个临时 tag 指向当前 `HEAD`，不推送远端：

    git tag publish/v0.14.1 HEAD
    npm run release:publish-tag -- --trigger-tag publish/v0.14.1 --dry-run --package-only
    git tag -d publish/v0.14.1

预期输出应显示 release version、release ref、两个扩展的目标 VSIX 路径和 manifest 输出路径；dry-run 不应执行真实 marketplace 发布，也不应创建正式 tag 或删除临时 tag。

## 验证与验收

验收标准是：

新增测试 `npm run test:publish-tag-release` 必须通过，覆盖至少以下行为：tag 名称必须匹配 `publish/vX.Y.Z`；tag 版本必须等于根 manifest 和 notifier manifest；release ref 必须可解析；dry-run 不执行真实 publish；manifest JSON 包含 `version`、`releaseRef`、`triggerTag`、`artifacts`；`--skip-package` 在 VSIX 缺失或版本/ref 不匹配时失败。

现有测试 `npm run test:publish-marketplaces` 必须继续通过，证明已有统一发布入口没有回归。若修改 `package-vsix.mjs` 或 notifier package script，还必须运行 `npm run test:package-vsix-command`。

文档验收是：发布手册明确 `publish/vX.Y.Z` 可在发布成功后删除，release manifest 不写入仓库，正式 `vX.Y.Z` tag 只在 marketplace 验证成功后创建。

## 幂等性与恢复

`publish/vX.Y.Z` tag 可以在发布失败后保留并用于重跑同一 release input。脚本应在发布前查询或校验已有 VSIX；如果使用 `--skip-package`，必须验证当前 VSIX 与 release ref 匹配，避免复用旧包。正式 `vX.Y.Z` 已存在且指向同一 ref 时，脚本可以视为已完成 tag 步骤；如果正式 tag 已存在但指向不同 ref，必须失败。

发布成功后删除远端 `publish/vX.Y.Z` 是安全的，因为正式 `vX.Y.Z` tag 和 release manifest 会成为长期证据。如果删除前失败，可以手工重跑删除命令；如果发布中途失败，不应删除 trigger tag。

## 证据与备注

当前已确认的基线输出：

    ## chore/publish-tag-release-flow...origin/main
    origin/main -> 7579634 Merge pull request #136 from ZY-WANG-0304/canvas-root-group-title-scale
    v0.14.1 -> 0330588 chore(release): 准备 0.14.1 发布 (#135)

当前新增脚本 dry-run 证据：

    npm run release:publish-tag -- --trigger-tag publish/v0.14.1 --dry-run --package-only --skip-origin-main-check --manifest-dir /tmp/dsc-release-artifacts-test
    Release trigger tag: publish/v0.14.1
    Release version: 0.14.1
    Release ref: 75796345bdbc10971539f6850d3ee97501ba4bd2
    planned artifact: extensions/vscode/dev-session-canvas-notifier/dev-session-canvas-notifier-0.14.1.vsix (0.14.1, ref 75796345bdbc10971539f6850d3ee97501ba4bd2)
    planned artifact: dev-session-canvas-0.14.1.vsix (0.14.1, ref 75796345bdbc10971539f6850d3ee97501ba4bd2)

目标测试证据：

    npm run test:publish-tag-release
    publish-tag-release tests passed

    npm run test:publish-marketplaces
    publish-marketplaces tests passed

    npm run test:package-vsix-command
    package-vsix command tests passed

    npm run test:extension-manifest
    extension manifest tests passed

    git diff --check
    # no output

## 接口与依赖

新增 `scripts/release/publish-tag-release.mjs` 需要提供以下 CLI：

    node scripts/release/publish-tag-release.mjs --trigger-tag publish/vX.Y.Z [--dry-run] [--package-only] [--skip-package] [--target all|visual-studio|open-vsx] [--extension all|main|notifier]

新增 `package.json` scripts：

    "release:publish-tag": "node scripts/release/publish-tag-release.mjs",
    "test:publish-tag-release": "node scripts/test/test-publish-tag-release.mjs"

脚本使用 Node.js 标准库和显式 devDependency `jszip` 读取 VSIX zip 内容；`package-lock.json` 已同步该依赖。


计划更新记录：2026-06-08 15:24Z，补充脚本实现、workflow、文档更新和测试通过证据。
计划更新记录：2026-06-09，补充远端 Actions / secrets 检查结果；本计划已满足本轮交付目标，后续若 GitHub Release asset 上传策略变化，或首次真实 GitHub Actions publish tag 首跑完成，应继续更新本计划或迁入 completed 后登记新技术债。

计划更新记录：2026-06-13，GitHub Release assets 镜像与 marketplace 继续发布验证的组合方案已迁入 `docs/exec-plans/completed/github-release-assets-flow.md` 接续；本计划保留 tag-first 输入固定机制的历史上下文，不再作为当前分发渠道的最新方案。
