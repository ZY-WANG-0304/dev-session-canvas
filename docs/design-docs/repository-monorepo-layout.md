---
title: Repository Monorepo Layout
decision_status: 已选定
validation_status: 已验证
domains:
  - 项目状态域
  - VSCode 集成域
architecture_layers:
  - 宿主集成层
  - 适配与基础设施层
related_specs: []
related_plans:
  - docs/exec-plans/completed/standard-monorepo-and-doc-knowledge-base.md
updated_at: 2026-06-29
---

# Repository Monorepo Layout

## 1. 背景

仓库已经从单一 VS Code 扩展演进到多包结构：主扩展、UI-side notifier companion、共享 attention 协议、模板市场 Web / Worker 应用和 marketplace shared 包需要在同一个仓库内协作。旧结构中，根 `package.json` 同时承担 VS Code extension manifest 和仓库脚本入口；根 `src/`、`images/`、`resources/`、Marketplace README 与 `docs/` 并列。这会让新协作者难以判断“根目录是产品包，还是 workspace 编排层”。

本设计收口阶段 1.2 的正式目录口径：仓库根目录成为 private npm workspace root；主 VS Code 扩展迁入 `extensions/vscode/dev-session-canvas/`；notifier companion 继续位于 `extensions/vscode/dev-session-canvas-notifier/`；正式文档仍集中在根目录。

## 2. 问题定义

本次重构需要解决三个问题：

1. 根目录不能继续既是扩展 manifest 又是 workspace 编排层，否则每新增一个扩展或应用都会让根目录语义更混乱。
2. 主扩展迁入子包后，构建、typecheck、VSIX 打包、smoke、debug 和发布脚本必须明确从主扩展子包读取 manifest、源码、资源和 Marketplace README。
3. 进入 monorepo 后不能让每个子包复制一套设计、架构和产品文档；正式结论仍要回到根目录文档知识库。

## 3. 目标

- 根 `package.json` 只作为 private workspace root，声明 workspaces、根级脚本、根级 devDependencies 和 overrides。
- 主扩展完整迁入 `extensions/vscode/dev-session-canvas/`，该目录持有 VS Code manifest、`src/`、`dist/`、`images/`、`resources/`、`package.nls.json`、`.vscodeignore`、Marketplace README、CHANGELOG 和运行时 hook。
- 根脚本继续提供 `npm run build`、`npm run typecheck`、`npm run package:vsix`、smoke 和 release 入口，外部协作者不需要记住所有子包路径。
- `docs/README.md` 与 `docs/diagrams/` 成为文档知识库入口和图资产位置；图只做导航，正文仍是事实来源。

## 4. 非目标

- 不在本阶段引入 `pnpm`、`yarn`、`turbo` 或 Gradle / IntelliJ 插件构建链路。
- 不把 `packages/attention-protocol/` 扩大成跨 IDE 通用协议单一真相；它仍是 VS Code 主扩展与 notifier companion 的最小 notification bridge 协议。
- 不把根 `docs/` 拆分到各子包；子包 README 只能提供局部说明。
- 不要求本阶段把模板市场 Web 应用或 marketplace shared 包迁移位置；它们已处在 monorepo 包路径下。

## 5. 正式方案

### 5.1 方案总览

当前正式 monorepo 拓扑如下：

- `package.json`：private workspace root，负责 workspace 列表、根级脚本、根级 devDependencies、overrides 和统一命令入口。
- `extensions/vscode/dev-session-canvas/`：主 VS Code extension package；`package.json` 是发布 manifest，`src/` 是主扩展源码，`dist/` 是构建产物，`images/` / `resources/` / `scripts/runtime/` 是打包输入。
- `extensions/vscode/dev-session-canvas-notifier/`：UI-side notifier companion extension package，继续独立构建、打包和发布。
- `packages/attention-protocol/`：主扩展和 notifier companion 的纯协议共享包。
- `packages/marketplace-shared/` 与 `apps/template-marketplace/`：模板市场共享逻辑与 Web / Worker 应用。
- `scripts/` 与 `tests/`：根级构建、测试、smoke、release 和诊断入口。
- `docs/`、`ARCHITECTURE.md`、`README.md` / `README.zh-CN.md`：根目录正式文档知识库和外部入口。

`ARCHITECTURE.md` 引用 `docs/diagrams/monorepo-topology.svg` 展示代码包拓扑；`docs/README.md` 引用 `docs/diagrams/documentation-knowledge-base.svg` 展示文档知识库入口关系。对应 Mermaid 源文件保存在同目录，便于后续维护。

### 5.2 适用范围与边界

- 根命令是稳定入口；脚本实现可以进入子包目录或临时 staging 目录，但对协作者仍应暴露为根 `npm run ...`。
- 主扩展 Marketplace README 和 CHANGELOG 位于 `extensions/vscode/dev-session-canvas/`；根 `README.md` 继续是英文项目入口，`README.zh-CN.md` 是中文入口。
- `npm run package:vsix` 使用 staged package 打包主扩展：它从主扩展子包复制运行时输入，并只把 `node-pty` 运行时文件带入 VSIX，避免把整个仓库或全部 node_modules 作为扩展内容发布。
- 根 `docs/` 是唯一正式文档知识库；子包局部文档不得重新定义产品定位、架构边界或设计结论。

### 5.3 核心规则与不变量

- 根 `package.json` 必须保持 `private: true`，不得再声明 VS Code extension 的 `main`、`contributes`、`activationEvents` 等 manifest 字段。
- 主扩展路径统一使用 `extensions/vscode/dev-session-canvas/`；脚本、测试、debug launch、smoke 和 release 逻辑不得回退假设根 `src/`、根 `images/` 或根 `CHANGELOG.md` 仍是主扩展输入。
- VSIX 文件列表必须继续排除仓库级 `docs/`、`scripts/`、`tests/`、`apps/`、`packages/` 和源码目录，只携带构建产物、运行时资源、Marketplace README / CHANGELOG / LICENSE / NLS 和必要的 `node-pty` runtime。
- README 相对资源改写必须以主扩展子包为 base；打包脚本在 dirty worktree 中只能校验文件系统存在，正式发布必须绑定最终 git ref。
- `docs/README.md`、`ARCHITECTURE.md`、`docs/design-docs/index.md` 与本设计文档共同维护 monorepo 事实；如果目录继续变化，必须同步更新这些入口。

## 6. 验证方法

当前迁移已经通过以下验证：

- `npm run typecheck`
- `npm run build`
- `npm run typecheck:notifier`
- `npm run test:notifier-source`
- `npm run test:extension-manifest`
- `npm run test:debug-launch-config`
- `npm run test:package-vsix-command`
- `npm run test:package-vsix-file-list`
- `npm run test:sidebar-codicon-bundle`
- `npm run test:webview-build-xterm-entry`
- `npm run test:canvas-templates`
- `npm run test:publish-marketplaces`
- `npm run test:publish-tag-release`
- `npm run package:vsix`
- `npm run publish:marketplaces -- --dry-run --extension main --target open-vsx`
- `npm run test:vsix-smoke`
- `git diff --check`

`npm run package:vsix` 在本轮验证中生成 `dev-session-canvas-0.20.0.vsix`，文件数为 115，包体约 3.59 MB；`npm run test:vsix-smoke` 最终输出包含 `VSIX packaged-payload smoke passed.`。由于本轮验证发生在 dirty worktree 上，README 相对资源只做了文件系统存在性校验；正式发布仍必须在 clean final ref 上执行，或显式传入 `DEV_SESSION_CANVAS_VSCE_DOC_BRANCH=<final-ref>`，让 README 资源校验绑定到最终发布引用。
