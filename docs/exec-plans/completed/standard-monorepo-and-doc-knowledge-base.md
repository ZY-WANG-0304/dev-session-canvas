# 标准 monorepo 与文档知识库落位

本 `ExecPlan` 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘` 这几个章节。

本文位于 `docs/exec-plans/completed/standard-monorepo-and-doc-knowledge-base.md`，必须按 `docs/PLANS.md` 的要求持续维护。

## 目标与全局图景

这项工作把 DevSessionCanvas 从“仓库根目录就是主 VS Code 扩展包”的结构，收口为标准 monorepo：仓库根目录负责 npm workspace、根级脚本、跨包测试和唯一正式文档知识库；主 VS Code 扩展位于 `extensions/vscode/dev-session-canvas/`；UI-side notifier companion 位于 `extensions/vscode/dev-session-canvas-notifier/`；两者共享的最小 attention 通知协议位于 `packages/attention-protocol/`。完成后，新协作者可以从根目录运行统一命令构建、测试和打包主扩展，同时能通过 `ARCHITECTURE.md`、`docs/README.md` 与 `docs/design-docs/repository-monorepo-layout.md` 理解代码拓扑和文档职责边界。

本计划的当前完成范围是 VS Code 生态的阶段 1：主扩展、notifier companion、共享 attention 协议、模板市场应用和根文档知识库的 monorepo 落位。IntelliJ 平台插件、跨 IDE JSON Schema 协议生成和共享 Webview 包仍由 `docs/exec-plans/active/intellij-platform-plugin.md`、`docs/exec-plans/active/cross-plan-coordination.md` 或后续新计划承接，不作为本轮完成门槛。

用户可观察的成功结果是：仓库根 `package.json` 不再是 VS Code extension manifest，而是 `private` workspace root；主扩展 manifest、Marketplace README、CHANGELOG、源码、资源和 VSIX 打包输入全部位于 `extensions/vscode/dev-session-canvas/`；`npm run build`、`npm run typecheck`、`npm run package:vsix` 等根命令仍可直接使用；正式文档仍集中在根目录，并新增文档知识库入口和图资产。

## 进度

- [x] (2026-04-30 11:35 +0800) 复核 `docs/WORKFLOW.md`、`docs/PLANS.md`、`ARCHITECTURE.md` 与旧仓库结构，确认本任务属于显著重构，需要使用本 `ExecPlan` 跟踪。
- [x] (2026-05-03 至 2026-05-06) 完成阶段 1.1：notifier companion 落在 `extensions/vscode/dev-session-canvas-notifier/`，共享 attention 协议落在 `packages/attention-protocol/`，主扩展接入 companion 优先、工作台通知兜底的主路径，并完成真实桌面通知人工验收、调试拓扑和 notifier smoke 链路。
- [x] (2026-06-29 20:23 +0800) 从 `origin/main` 创建主题分支 `repo-monorepo-layout-refactor`，并确认该分支以 `origin/main` 为祖先。
- [x] (2026-06-29 21:10 +0800) 完成阶段 1.2 结构迁移：主扩展源码、资源、Marketplace README、CHANGELOG、`.vscodeignore`、NLS 与运行时 hook 已迁入 `extensions/vscode/dev-session-canvas/`；根 `package.json` 已改为 private workspace root。
- [x] (2026-06-29 21:20 +0800) 迁移构建、typecheck、debug、smoke、media、release 和脚本级测试入口，使根命令继续委托到主扩展子包或 staged package。
- [x] (2026-06-29 21:30 +0800) 收口 VSIX staging 打包：`scripts/release/package-vsix.mjs` 从主扩展子包复制发布输入，只保留 `node-pty` 运行时依赖，并继续用主扩展子包内 `README.marketplace.md` 作为 Marketplace README。
- [x] (2026-06-29 21:40 +0800) 新增 `docs/README.md`、`docs/diagrams/monorepo-topology.*`、`docs/diagrams/documentation-knowledge-base.*` 与 `docs/design-docs/repository-monorepo-layout.md`，并在设计索引注册 monorepo 正式方案。
- [x] (2026-06-29 21:58 +0800) 完成最终验证复跑：主扩展 typecheck / build、notifier typecheck / source test、manifest / debug / VSIX / sidebar / webview / template / publish 脚本级测试、VSIX 打包、Open VSX dry-run、packaged-payload smoke 和 `git diff --check` 均通过。
- [x] (2026-06-29 22:06 +0800) 根据最终验证结果更新本计划、`docs/design-docs/repository-monorepo-layout.md` 与设计索引，把 monorepo 方案验证状态收口为 `已验证`，并将本计划移入 `docs/exec-plans/completed/`。
- [x] (2026-06-29 22:06 +0800) 复核遗留技术债：本轮没有新增需要登记的技术债；既有“VSIX 会打入超出运行时必需范围的 `node-pty` 文件”债务在当前 `origin/main` 打包基线中已不符合事实，本轮 staged package 与文件列表测试继续保持 runtime-only 边界，因此从 `docs/exec-plans/tech-debt-tracker.md` 移除。

## 意外与发现

- 观察：根目录旧 `package.json` 同时承担公开扩展 manifest 与仓库脚本入口，导致 monorepo 下“根目录到底是不是一个 extension package”语义不清。
  证据：迁移前根 manifest 同时包含 `main`、`contributes`、`extensionKind`、VS Code 配置贡献和大量根级测试 / 发布脚本；迁移后根 `package.json` 只保留 `private: true`、`workspaces`、根级脚本、devDependencies 与 overrides。

- 观察：VSIX 打包不能直接在仓库根或主扩展源码目录上运行，否则容易把 monorepo 级目录、源码或完整 `node_modules` 带入发布包。
  证据：当前 `scripts/release/package-vsix.mjs` 先创建临时 staged package，只复制主扩展 `dist/`、`images/`、`resources/`、`scripts/runtime/`、NLS、Marketplace README、CHANGELOG、LICENSE、manifest 和必要的 `node-pty` runtime，再从 staged package 运行 `vsce package`。

- 观察：README 相对资源改写在主扩展子包迁移后必须区分 package-relative 路径和 repo-relative git 校验路径。
  证据：Marketplace README 里的 `images/marketplace/canvas-overview.png` 相对主扩展子包存在；打包时的 base URL 应指向仓库内 `extensions/vscode/dev-session-canvas/`，而 `git cat-file` 校验必须检查 `extensions/vscode/dev-session-canvas/images/marketplace/canvas-overview.png` 是否存在于最终 ref。

- 观察：dirty worktree 下无法安全证明当前 `HEAD` 已包含 README 引用资源。
  证据：打包脚本现在只有在显式传入 `DEV_SESSION_CANVAS_VSCE_DOC_BRANCH` 或 git 工作树 clean 时才用 git ref 校验 README 资源；dirty worktree 下仅做文件系统存在性校验，并打印发布打包必须绑定 final ref 的提示。

- 观察：notifier companion 的正式安装关系和 debug-only 单调试关系必须继续分离。
  证据：正式 manifest 保持“主扩展 `extensionPack` 聚合 notifier + notifier 单向 `extensionDependencies` 回补主扩展 + 两侧 `api:none`”；`.vscode/launch.json` 的 `Run Dev Session Canvas (Main Only)` 仍通过 `.debug/vscode-extension-main-only/` 临时副本剥离安装期关系。

## 决策记录

- 决策：继续使用 npm workspaces，不引入 `pnpm`、`yarn`、`turbo` 或新的任务编排器。
  理由：仓库已有 `npm`、`package-lock.json` 和大量 `npm run ...` 脚本；本轮目标是目录与职责收口，不同时切换包管理器。
  日期/作者：2026-04-30 / Codex

- 决策：根目录正式文档仍是唯一真相来源；子包 README / CHANGELOG 只承载局部安装、发布或变更说明。
  理由：主扩展、notifier、attention protocol 和模板市场属于同一产品体系，多包结构不应复制出多套产品、架构或设计结论。
  日期/作者：2026-04-30 / Codex

- 决策：文档知识库入口放在 `docs/README.md`，图源和导出图放在 `docs/diagrams/`。
  理由：根 `README.md` 面向外部用户和源码入口；`docs/README.md` 更适合解释“去哪找哪类正式结论”。图只做导航增强，正式结论仍写在 Markdown 正文。
  日期/作者：2026-04-30 / Codex

- 决策：阶段 1.2 正式将主扩展迁入 `extensions/vscode/dev-session-canvas/`，根 `package.json` 改为 `private` workspace root。
  理由：notifier 和模板市场已经让仓库进入多包状态；继续让根目录兼任主扩展包会让脚本、文档和发布输入边界持续漂移。
  日期/作者：2026-06-29 / Codex

- 决策：主扩展 VSIX 通过 staged package 打包，而不是在主扩展子包目录直接发布整个目录。
  理由：staging 能明确控制发布输入、重写生产依赖到 `node-pty` runtime、阻断 monorepo 级目录和源码误入 VSIX，并让文件列表测试可直接检查 staged package。
  日期/作者：2026-06-29 / Codex

- 决策：当前不把 IntelliJ 平台、`packages/protocol/` JSON Schema 三层结构或 `packages/webview/` 共享前端作为本轮门槛。
  理由：团队此前已决定先完成 VS Code 生态和 notifier；跨 IDE 工作需要新的平台实现、协议生成和验证矩阵，不能被本轮目录迁移伪装成已落地能力。
  日期/作者：2026-06-29 / Codex

## 结果与复盘

阶段 1.2 已完成并归档。当前已确认产出包括：

- 主扩展包：`extensions/vscode/dev-session-canvas/package.json`、`src/`、`dist/`、`images/`、`resources/`、`package.nls.json`、`.vscodeignore`、Marketplace README、CHANGELOG、LICENSE 和 `scripts/runtime/`。
- workspace root：根 `package.json` 改为 `dev-session-canvas-workspace`，`private: true`，workspaces 覆盖主扩展、notifier、attention protocol、模板市场应用和 marketplace shared 包。
- 根脚本：`npm run build`、`npm run typecheck`、`npm run package:vsix`、smoke、release、media 和脚本级测试入口已按新主扩展路径更新。
- 文档入口：`ARCHITECTURE.md` 增加 monorepo 拓扑图，`docs/README.md` 增加文档知识库入口图，`docs/design-docs/repository-monorepo-layout.md` 记录正式 monorepo 方案。
- 发布边界：主扩展 Marketplace README / CHANGELOG 位于主扩展子包；根 README 继续作为英文项目入口，中文入口为 `README.zh-CN.md`。

最终验证已覆盖构建、typecheck、notifier、manifest、debug launch、VSIX staging 文件列表、VSIX 打包、Open VSX dry-run、packaged-payload smoke、模板和发布脚本级回归。`npm run package:vsix` 在当前 dirty worktree 下生成 `dev-session-canvas-0.20.0.vsix`，文件数为 115，包体约 3.59 MB；dirty worktree 下 README 资源只做文件系统存在性校验，这是开发验证的预期行为，不等同于正式发布输入。正式发布仍必须在 clean final ref 上执行，或显式绑定 `DEV_SESSION_CANVAS_VSCE_DOC_BRANCH=<final-ref>`。

本轮没有新增需要后续跟踪的技术债。原先记录的 `node-pty` VSIX 冗余文件债务在当前 `origin/main` 打包基线中已不符合事实：旧 `.vscodeignore` 已经只 allow-list `node-pty` 的运行时文件，不包含 PDB、源码、构建脚本、类型文件或 third-party 构建输入。本轮 staged package 迁移继续保持这条边界，并让 VSIX 文件列表测试显式拒绝 `node-pty` 源码、PDB、嵌套 `node-addon-api` 和 monorepo 级目录进入发布包。IntelliJ 平台插件、跨 IDE JSON Schema 协议生成和共享 Webview 包仍由各自计划承接，不是本轮未完成项。

## 上下文与定向

当前仓库根目录是 workspace root。它负责：

- `package.json` / `package-lock.json`：npm workspaces、根级脚本、根级 devDependencies 和 overrides。
- `scripts/`：构建、测试、smoke、release、media 和诊断入口。
- `tests/`：VS Code smoke 与 Playwright Webview 回归。
- `docs/`、`ARCHITECTURE.md`、`README.md` / `README.zh-CN.md`：正式文档知识库与项目入口。

主扩展位于 `extensions/vscode/dev-session-canvas/`。它是一个可发布 VS Code extension package，`package.json` 是主扩展 manifest，`src/` 是源码，`dist/` 是构建产物，`images/` / `resources/` / `scripts/runtime/` 是运行时或发布输入。

notifier companion 位于 `extensions/vscode/dev-session-canvas-notifier/`。它是 UI-side extension package，负责本机桌面通知投递与点击回跳，不持有画布权威状态。

`packages/attention-protocol/` 是主扩展与 notifier 之间的最小纯数据协议包。`packages/marketplace-shared/` 与 `apps/template-marketplace/` 仍承载模板市场的共享 schema、Web 前端和 Worker API。

## 工作计划

本轮工作按“先固定事实、再搬迁、再收口脚本、最后补文档和验证”的顺序执行。第一步，把主扩展 manifest 和源码从根目录迁入 `extensions/vscode/dev-session-canvas/`，同时保留根目录 `tests/` 与 `scripts/` 作为跨包验证和工具入口。第二步，把根 `package.json` 改为 workspace root，并新增主扩展子包 `package.json`、`tsconfig.json` 和子包 LICENSE。第三步，更新构建、typecheck、debug、smoke、media、release 和测试脚本，让所有根命令继续从仓库根运行。第四步，改造 VSIX 打包为 staged package，显式复制主扩展发布输入和 `node-pty` runtime，并让文件列表测试阻止源码、docs、apps、packages、二维码和 node-pty 非运行时文件进入 VSIX。第五步，更新根 README、架构、设计文档、发布手册和文档知识库入口，保证实质性设计决策有正式文档落点。

## 具体步骤

在仓库根目录执行以下步骤。若重跑本计划，应先确认当前分支不是 `main`，且 `origin/main` 是当前分支祖先。

    git status --short --branch
    git merge-base --is-ancestor origin/main HEAD

主结构迁移完成后，关键路径应满足：

    test -f extensions/vscode/dev-session-canvas/package.json
    test -f extensions/vscode/dev-session-canvas/src/extension.ts
    test -f extensions/vscode/dev-session-canvas/README.marketplace.md
    node -e "const p=require('./package.json'); if (!p.private) process.exit(1)"

根命令和发布入口应从仓库根运行：

    npm run typecheck
    npm run build
    npm run typecheck:notifier
    npm run test:notifier-source
    npm run test:package-vsix-file-list
    npm run package:vsix
    npm run publish:marketplaces -- --dry-run --extension main --target open-vsx
    git diff --check

若需要运行 packaged payload smoke，在 Linux 环境执行：

    npm run test:vsix-smoke

## 验证与验收

本计划完成时必须满足以下可观察条件：

1. 根 `package.json` 是 `private` workspace root，不再包含 VS Code extension manifest 的 `main`、`contributes`、`activationEvents`、`extensionKind` 等字段；主扩展 manifest 位于 `extensions/vscode/dev-session-canvas/package.json`。
2. 根 `npm run typecheck` 与 `npm run build` 能成功构建主扩展，产物写入 `extensions/vscode/dev-session-canvas/dist/`。
3. notifier 仍能独立 typecheck / source test，主扩展和 notifier 之间的相对 import 不再指向旧根 `src/`。
4. `npm run package:vsix` 能生成主扩展 VSIX，且 VSIX 文件列表不包含根 `docs/`、`apps/`、`packages/`、`tests/`、源码目录、二维码或 `node-pty` 的源码 / PDB / 嵌套依赖。
5. `ARCHITECTURE.md`、`docs/README.md`、`docs/design-docs/repository-monorepo-layout.md`、`docs/design-docs/index.md`、根 README 与发布手册都与当前主扩展子包路径一致。
6. 若 `npm run test:vsix-smoke` 因环境限制未运行，最终说明必须明确写出原因；如果运行失败，不能把 packaged-payload smoke 写成已通过。

## 幂等性与恢复

本次迁移采用“先搬迁、保留根命令、再通过 tests 约束路径”的策略。重复运行 `npm run build` 会清空并重建 `extensions/vscode/dev-session-canvas/dist/`；重复运行 `npm run package:vsix` 会重新创建临时 staged package，并把生成的 `dev-session-canvas-0.20.0.vsix` 复制到仓库根目录。生成的 VSIX 受 `.gitignore` 忽略，不应作为源码提交。

如果打包失败，优先检查 `scripts/release/package-vsix.mjs` 的 staged package 输入是否缺失，而不是把根目录重新改回 extension package。如果 debug 主扩展单调试失败，优先检查 `.debug/vscode-extension-main-only/` 是否由 `scripts/shared/prepare-debug-main-only-extension.mjs` 生成并移除了 `extensionPack` / `extensionDependencies`。如果 README 资源改写失败，优先确认当前打包是否处于 dirty worktree；正式发布必须绑定 clean final ref 或显式传入 `DEV_SESSION_CANVAS_VSCE_DOC_BRANCH=<final-ref>`。

## 证据与备注

当前已经获得的最终证据：

    git status --short --branch
    ## repo-monorepo-layout-refactor...origin/main

    git merge-base --is-ancestor origin/main HEAD; echo $?
    0

    npm run typecheck
    npm run build
    npm run typecheck:notifier
    npm run test:notifier-source
    npm run test:extension-manifest
    npm run test:debug-launch-config
    npm run test:package-vsix-command
    npm run test:package-vsix-file-list
    npm run test:sidebar-codicon-bundle
    npm run test:webview-build-xterm-entry
    npm run test:canvas-templates
    npm run test:publish-marketplaces
    npm run test:publish-tag-release
    npm run package:vsix
    npm run publish:marketplaces -- --dry-run --extension main --target open-vsx
    npm run test:vsix-smoke
    git diff --check

上述命令在 2026-06-29 的迁移收口中均已通过。`npm run package:vsix` 的关键输出为 `dev-session-canvas-0.20.0.vsix`、`115 files`、`3.59 MB`；`npm run test:vsix-smoke` 的最终输出包含 `VSIX packaged-payload smoke passed.`。打包期间出现的 dirty-worktree README 资源提示是预期 caveat，正式 release 流程必须把 README 资源校验绑定到最终发布 ref。

## 接口与依赖

本计划的当前正式接口和路径如下：

- workspace root：`package.json`、`package-lock.json`、`tsconfig.json`、`scripts/`、`tests/`。
- 主扩展包：`extensions/vscode/dev-session-canvas/package.json`、`extensions/vscode/dev-session-canvas/tsconfig.json`、`extensions/vscode/dev-session-canvas/src/`、`extensions/vscode/dev-session-canvas/dist/`、`extensions/vscode/dev-session-canvas/images/`、`extensions/vscode/dev-session-canvas/resources/`。
- notifier companion：`extensions/vscode/dev-session-canvas-notifier/package.json`、`extensions/vscode/dev-session-canvas-notifier/src/`、`extensions/vscode/dev-session-canvas-notifier/tests/`。
- shared packages：`packages/attention-protocol/`、`packages/marketplace-shared/`。
- template marketplace app：`apps/template-marketplace/`。
- formal docs：`ARCHITECTURE.md`、`docs/README.md`、`docs/design-docs/repository-monorepo-layout.md`、`docs/design-docs/index.md`、`docs/public-preview-release-playbook.md`。

本次更新说明：2026-06-29 按阶段 1.2 实际执行结果重写本计划，把旧的“主扩展暂不迁移 / 阶段 1.2 待决策”口径更新为“主扩展已迁入 `extensions/vscode/dev-session-canvas/`，根目录为 private workspace root，文档知识库入口已落地”。

归档更新说明：2026-06-29 22:06 +0800，最终验证通过后把本计划移入 `docs/exec-plans/completed/`，同步设计文档验证状态，并记录 dirty worktree 打包 caveat 与技术债复核结果。
