---
title: 公开平台发布准备
decision_status: 已选定
validation_status: 验证中
domains:
  - VSCode 集成域
  - 项目状态域
architecture_layers:
  - 宿主集成层
  - 适配与基础设施层
related_specs: []
related_plans:
  - docs/exec-plans/completed/public-marketplace-release-readiness-research.md
updated_at: 2026-05-03
---

# 公开平台发布准备

## 1. 背景

当前仓库已经具备基于 VSIX 工件的打包基线，但这次 `Preview` 的对外分发目标已经明确切到公开 `Marketplace` 发布，不再把 `.vsix` 作为普通用户分发方式。

这意味着“能在本地打一个 VSIX 工件”与“已经适合通过 Marketplace 对外公开发布”不是一回事。若要把当前扩展发布到公开平台，必须先明确哪些是工程 blocker，哪些是渠道账号问题，哪些是产品与支持承诺。

## 2. 问题定义

需要回答的问题不是“如何执行一次 `vsce publish`”，而是“把当前 Preview 仓库转成一个可对外公开安装、可追踪支持、可重复发布的扩展，需要补齐哪些工作”。

本次研究以 2026-04-11 的仓库状态为准，重点覆盖以下范围：

- 当前发布包是否已经收口到公开分发可接受的最小运行集。
- 当前 manifest、README、许可证和链接是否已经适合公开渠道。
- 若选择公开平台，先发 `Visual Studio Marketplace` 还是同时发 `Open VSX`。
- 后续应如何把这项工作拆成可执行的工程与发布步骤。

## 3. 目标

- 明确当前仓库距离公开平台发布还缺哪些工作。
- 区分硬 blocker、推荐补齐项和可后移项。
- 给出一个保守、可执行的渠道策略，而不是同时承诺多个公开平台。
- 把研究结论落成正式文档，避免后续协作者只凭零散讨论推进发布。

## 4. 非目标

- 本轮不直接把扩展发布到任何公开平台。
- 本轮不把“是否要公开发布”写成已确认产品结论。
- 本轮不承诺已经具备面对外部用户的稳定性、支持 SLA 或兼容矩阵。

## 5. 候选发布渠道

### 5.1 `Visual Studio Marketplace`

这是当前已选定的首发渠道。原因有三点：

- 当前产品是标准 VS Code workspace extension，主宿主和目标用户路径都围绕 VS Code 本体。
- 官方发布文档直接覆盖 publisher 创建、PAT 登录、`@vscode/vsce` 打包与发布链路。
- 当前仓库已有可复用的打包脚本与 VSIX smoke，离该渠道最近。

### 5.2 `Open VSX`

`Open VSX` 保留为后续补充渠道，但不与当前首个公开 `Marketplace Preview` 绑定。原因是它引入了额外的 namespace / token 管理与渠道同步问题，而当前仓库虽然已经完成首条公开发布主线的仓库内收口，但尚未实际执行首发发布。

## 6. 当前现状

截至 2026-05-03（以 PR35 当前最新 head 对应的工作树快照为准），仓库里已经成立的事实如下：

- `package.json` 具备基础扩展元数据，且仍标记为 `preview: true`。
- `README.md` 已明确写成“产品已处于公开 Preview 阶段”；发布执行与对外口径已收口到 `docs/public-preview-release-playbook.md`。
- 许可证已选定为 `Apache-2.0`。
- `repository`、`homepage` 和 `bugs` 已切换到公开 GitHub 地址。
- 发布工具链已迁移到 `@vscode/vsce`，`scripts/package-vsix.mjs` 也已兼容 `.bin/vsce` 与包内 CLI 脚本两条本地入口。
- `scripts/package-vsix.mjs` 当前会在打包阶段显式传入 `--readme-path README.marketplace.md`，确保后续 `publish --packagePath` 上传的现成 VSIX 已内嵌 Marketplace 专用 README，而不是依赖发布时重新替换。
- `scripts/package-vsix.mjs` 默认会把 Marketplace README 的相对资源改写到当前 `HEAD` 对应的最终 git ref；若在不含 `.git` 元数据的 clean checkout 或导出目录中打包，则必须显式传入 `DEV_SESSION_CANVAS_VSCE_DOC_BRANCH=<final-ref>`，并在打包前校验这些相对资源能在该 ref 上解析成功。
- 当前工作树已能稳定执行 `npm run package:vsix`，生成 `dev-session-canvas-0.4.1.vsix`（约 `2.17 MB`、`48 files`），并再次通过 `npm run test:vsix-smoke`。
- 当前 `working tree` 快照已再次通过隔离 `clean checkout` 打包验证，可在干净目录内稳定产出 `dev-session-canvas-0.4.1.vsix`（约 `2.17 MB`、`48 files`）；packaged-payload smoke 继续通过单独执行 `npm run test:vsix-smoke` 复核。
- 当前候选 release 输入快照也已再次通过隔离 `clean checkout` 验证，说明这轮瘦身后的最小 Preview 工件已经固定到可追溯提交。
- 仓库已补上 `validate:clean-checkout:vsix` 隔离验证入口，可在 `/tmp` 下准备 clean checkout 验证，不必直接扰动当前工作树。
- 当前对外分发主路径已确定为 `Visual Studio Marketplace Preview`，而不是手动分发 `.vsix`。
- `node-pty` 依赖包已完成第二轮收口，VSIX 当前只保留运行时 `lib/*.js`、所需 `prebuilds` 原生文件，以及运行时仍会解析的 `package.json` / `LICENSE`。
- `scripts/run-vscode-vsix-smoke.mjs` 现会在 packaged-payload smoke 前显式校验：VSIX 不再携带 `.github/`，也不再携带 `node-pty` 的 `binding.gyp`、`scripts/`、`src/`、`third_party/`、`typings/`、嵌套 `node_modules/` 或 `.pdb`。
- `remote-ssh-real-reopen` 的 storage 恢复链路已进一步修复多 slot 场景：当前实现会扫描同一 canonical workspace id 下的 sibling slots，按 snapshot 时间戳选择最新 source；若 source 不等于 current slot，只迁回 `canvas-state.json` 并由 current slot 继续写主快照，而 live-runtime 继续绑定 source slot 的 `runtimeStoragePath`。仓库已补 `scripts/test-extension-storage-paths.mjs` 与 `npm run test:smoke-storage-slot` 作为自动化回归，验证 slot 选择、主快照写回以及 `stateHash` 一致性。
- 当前首发主路径已完成一轮人工验收，用户反馈为“人工验收没发现问题”。
- 已补齐 GitHub issue 模板与 `docs/support.md`，普通反馈、安全问题和 Preview 支持边界已有固定入口。

## 7. 剩余 release-day 动作与后续跟踪

### 7.1 发布包治理已收口到当前 PR head，但最终发布引用仍需复核

当前仓库已经完成第二轮发布包治理。当前本地工作树与当前候选 release 输入快照的发布包都已显著收紧，并完成了 clean-checkout 复核；剩余问题只在于最终对外发布若不直接使用当前已验证的 git ref，仍需对最终发布引用补最后一轮复核。

本地证据：

- 第一轮收口前，仓库内曾出现约 `293 MB` 的 VSIX，并把 `.debug/playwright/`、`.debug/vscode-smoke/` 等调试缓存一起打入包内。
- 当前工作树在第二轮收紧 `.vscodeignore` 后，`npm run package:vsix` 已可稳定产出 `dev-session-canvas-0.4.1.vsix`（约 `2.17 MB`、`48 files`）。
- 当前 `npm run test:vsix-smoke` 已再次通过，说明第二轮收口后的 packaged payload 仍能独立启动并跑通 trusted smoke。
- 当前 packaged-payload smoke 还会在解包阶段显式校验 VSIX 不再携带 `.github/`，以及 `node-pty` 的 `binding.gyp`、`scripts/`、`src/`、`third_party/`、`typings/`、嵌套 `node_modules/` 与 `.pdb` 等冗余内容。
- 基于当前 `working tree` 快照的 clean-checkout 证据已经更新到 `2.17 MB`、`48 files`；由于当前工作树与候选 release head 已一致，这轮候选发布输入也应以同一组最小工件证据为准。
- 截至 `2026-04-28`，Linux、macOS、Windows 本地 workspace 的 `Agent` / `Terminal` / `Note` 主路径已补齐当前轮功能可用性验证；Windows 下使用 `Codex` 时执行节点内历史仍有无法向上翻页的已知问题。

因此，当前只需保持以下约束与 release-day 动作：

- 保持当前 `.debug/`、`.playwright-browsers/`、测试 artifacts、core dump、截图草稿等路径继续留在发布包外，不让后续改动把它们重新带回工件。
- 若真正对外发布使用的是后续 merge commit、tag 或其他最终 release ref，发布前再对该 git ref 重跑一次 `validate:clean-checkout:vsix`，并确保 `package:vsix` 的 README 改写 ref 也锁定到同一个 final ref，避免把当前候选 release 输入快照的证据直接等同于最终发布输入。
- 保持 packaged-payload smoke 的内容守卫，确保 `node-pty` 的源码、脚本、PDB 与重复依赖不会重新随着后续改动回流到 VSIX。

### 7.2 公开元数据与法律口径已收口，当前只需一致性复核

当前仓库的公开元数据和对外发布口径已经完成当前轮次收口：

- README、CHANGELOG、SECURITY、issue 模板与 `docs/support.md` 已完成第一轮公开 Preview 收口，普通反馈、安全问题和 Preview 支持边界已有固定入口。
- 当前已补齐 `README.marketplace.md` 与 `docs/public-preview-release-playbook.md`，把 Marketplace listing 草案、release notes 使用口径、升级说明和回滚口径收口成正式仓库文档。

真正执行发布前，仍需完成以下复核：

- 继续按 `README.marketplace.md`、`CHANGELOG.md` 与 `docs/public-preview-release-playbook.md` 复核商店页面与仓库文档的一致性。
- 继续复核 README、CHANGELOG、SECURITY、issue 模板和支持边界说明，确保它们与最终发布事实一致。

### 7.3 渠道账号与凭证已就绪，发布前只需确认可用性

当前与 `Visual Studio Marketplace` 相关的发布账号链路已经打通：

- `devsessioncanvas` publisher 已创建并确认可用。
- Azure DevOps organization 与 Personal Access Token 已完成准备。
- 本地 `vsce login devsessioncanvas` 已完成，当前只需在真正发布前确认登录仍然有效。

若未来决定同步 `Open VSX`，仍需要单独补齐：

- 在 `Open VSX` 上创建或认领 namespace。
- 准备 `ovsx publish` 所需 token。
- 决定是否与 `Visual Studio Marketplace` 保持同版本同步发布。

因此，当前 release-day 不再把账号创建视为 blocker；真正需要做的是在发布前再次确认这些凭证仍可用。

### 7.4 平台支持矩阵已升级为“四条主路径已验证 + Remote SSH 继续为主推荐路径”

当前验证证据最强的路径仍集中在 `Remote SSH` 开发路径、`Restricted Mode` 和 VSIX smoke；截至 `2026-04-28`，`Remote SSH` 主路径以及 Linux、macOS、Windows 本地 workspace 的 `Agent` / `Terminal` / `Note` 主路径都已补齐当前轮功能可用性验证。当前公开 `Preview` 的支持矩阵因此不再是“本地可尝试但未严格验证”，而是“`Remote SSH` 与桌面三平台主路径都已验证可用，其中 `Remote SSH` 仍是最推荐环境，Windows 仍保留一条显式已知限制”：

- Linux、macOS 本地路径可以按 `Preview` 主路径写成“已验证可用”，但仍不升级成稳定版承诺。
- Windows 本地路径可以写成“已验证可用”，同时必须显式保留“使用 `Codex` 时执行节点内历史当前无法向上翻页”的已知限制。
- `Restricted Mode`、`Virtual Workspace`、CLI 依赖和 runtime guarantee 边界继续保持原有口径，不因为这轮桌面三平台可用性验证而被误写成全量稳定支持。
- 后续技术债不再是“本地三平台是否可用”，而是“Windows 下 `Codex` 历史翻页问题是否收口”“跨平台自动化矩阵是否补齐”以及“更强 runtime guarantee 是否在非 Linux backend 上闭合”。

当前对外口径已经收敛为以下矩阵：

| 场景 / 能力 | 当前状态 | 对外口径 |
| --- | --- | --- |
| `Remote SSH` workspace | `Preview`，主路径已验证且验证最充分 | 当前最强验证证据所在路径，可作为公开 Preview 的主推荐场景 |
| Linux 本地 workspace | `Preview`，主路径已验证 | 当前轮功能可用性验证已完成，但仍维持 `Preview` 口径 |
| macOS 本地 workspace | `Preview`，主路径已验证 | 当前轮功能可用性验证已完成，但仍维持 `Preview` 口径 |
| Windows 本地 workspace | `Preview`，主路径已验证（含已知限制） | 当前轮功能可用性验证已完成；使用 `Codex` 时执行节点内历史仍无法向上翻页 |
| `Restricted Mode` | 有限支持 | 允许打开画布，但禁用执行型入口 |
| `Virtual Workspace` | 不支持 | 不在当前公开 Preview 范围内 |
| `Agent` 节点 | 依赖外部 CLI | 需要 `codex` 或 `claude` CLI 可被 Extension Host 解析 |
| `Terminal` 节点 | 依赖工作区侧 shell | 需要当前工作区侧可用 shell |
| `runtimePersistence.enabled = false` | 基线支持 | 不承诺真实进程跨 VS Code 生命周期持续存在 |
| `runtimePersistence.enabled = true` | `Preview` 能力，已具备较多验证证据 | 已有 `Remote SSH` real-reopen 自动化、相关 smoke 与人工验证证据；当前用户可见 guarantee 仍取决于 backend 与平台组合。Linux 本地与 `Remote SSH` 在 `systemd --user` 可用时优先尝试更强 guarantee，否则回退到 `best-effort` |

补充说明：截至 `2026-04-28`，`Remote SSH` 主路径与 Linux、macOS、Windows 本地路径的当前轮功能可用性验证都已补齐；其中 `Remote SSH` 仍是当前最强验证证据所在路径。仍需显式保留的剩余限制是 Windows 下 `Codex` 历史无法向上翻页，以及三平台自动化矩阵尚未完全补齐。

### 7.5 发布流水线继续后移，不作为当前 blocker

当前仓库已经有本地打包脚本、VSIX smoke 与 clean-checkout 验证入口，但当前决策是不在本轮建设正式发布流水线。当前优先级是先把发布包、支持边界和首发验证收口，再决定是否把这条链路迁入 CI。

当前轮次仍需保留的最小手工 gate 是：

- 在干净环境中执行 `npm ci`、按最终 git ref 锁定 README 改写目标后的 `npm run package:vsix`、VSIX 内容校验和 Marketplace 发布前 smoke。
- 让 `@vscode/vsce` 成为唯一受支持的打包入口，并把当前脚本 fallback 行为纳入发布前检查。
- 在真正点击发布前，整理一份可复核的手工发布步骤，避免临场操作漂移。

若后续要继续降低人为发布风险，再把版本号、预发布标记、release note、发布 tag 与发布动作迁入 CI。

## 8. 风险与取舍

- 若一开始同时承诺 `Visual Studio Marketplace` 和 `Open VSX`，会把首发收口拆成两个渠道问题，增加 namespace、token 和版本同步成本。
- 若后续版本在许可证、公开链接和支持口径失配时贸然上架，商店页面会把仓库内部事实包装成外部承诺，后续回收成本更高。
- 若只解决 publisher / PAT 而不先治理发布包，公开发布过程会被包体污染、内容漂移和不可重复打包持续阻断。

## 9. 正式方案

### 9.1 方案说明

- `0.4.1` 的公开 `Marketplace Preview` 正式发布输入固定为当前候选 release 输入快照（即 PR35 当前最新 head 对应、且已通过 clean-checkout 复核的工作树内容）验证通过的最小 VSIX 工件：`dev-session-canvas-0.4.1.vsix`。当前仓库内证据为 `48 files`、约 `2.17 MB`，生成入口是 `scripts/package-vsix.mjs`，隔离复核入口是 `npm run validate:clean-checkout:vsix -- --source working-tree`。
- 首发渠道正式收敛为 `Visual Studio Marketplace`。`Open VSX` 不与 `0.4.1` 首发绑定，后续若要补发，单独走渠道决策与凭证准备。
- 对外发布口径以 `README.md`、`README.marketplace.md`、`CHANGELOG.md`、`docs/public-preview-release-playbook.md` 与 `docs/support.md` 为唯一仓库内正式来源。`0.4.1` 对外内容聚焦一轮 UI 修复与交互优化，重点覆盖 Agent 启动入口、节点与文件活动操作体验，以及执行节点 terminal link 行为对齐，同时继续保留“`Remote SSH` 与桌面三平台主路径已验证”以及“Windows 下 `Codex` 无法向上翻页”的已知限制。

### 9.2 适用范围与边界

- 本方案只覆盖 `0.4.1` 公开 `Marketplace Preview` 的仓库内准备与 release-day 执行，不把“已经上架”“已经具备稳定版 SLA”或“已经同步 `Open VSX`”写成既成事实。
- 适用的发布输入必须与上述正式文档保持一致；若真正发布使用的不是当前候选 head，而是后续 merge commit、tag 或其他最终 git ref，则必须基于最终 ref 重新执行 clean-checkout 打包验证，并复核 `README.marketplace.md` 的资源改写 ref。
- 支持矩阵继续以 `Remote SSH` 与桌面三平台主路径已验证为基础，但不把 `Restricted Mode`、`Virtual Workspace`、CLI 依赖边界或更强 runtime guarantee 误写成全量稳定支持。

### 9.3 核心规则与不变量

- `scripts/package-vsix.mjs` 必须继续显式传入 `--readme-path README.marketplace.md`，且 README 资源改写 ref 必须与最终发布 ref 一致；不允许依赖发布时临时替换文案来修正文档内容。
- `npm run validate:clean-checkout:vsix` 与 `npm run test:vsix-smoke` 是发布前必须保留的最小证据链；只要工件大小、文件数或 packaged payload 内容发生变化，就必须同步刷新本设计文档与相关发布文档中的证据。
- `.debug/`、`.playwright-browsers/`、`.github/`、`node-pty` 的源码/脚本/PDB/重复依赖等冗余内容必须继续留在 VSIX 之外，避免包体回涨或引入不可追溯内容；相关内容守卫继续由 `scripts/run-vscode-vsix-smoke.mjs` 负责。
- 发布账号、PAT、Marketplace listing 草案、release notes 口径与支持入口只要发生变化，都必须回写到仓库正式文档，而不是只停留在外部聊天或 MR 评论。

## 10. 验证方法

本研究依赖以下证据来源：

- 仓库内 `package.json`、`README.md`、`CHANGELOG.md`、`docs/public-preview-release-playbook.md`、`docs/support.md`、`LICENSE` 与打包脚本现状。
- 本地执行 `npm run package:vsix`、`npm run validate:clean-checkout:vsix -- --source working-tree --skip-vsix-smoke` 与 `npm run test:vsix-smoke` 的实际结果，确认当前工作树（也即当前候选 release 输入快照）已能稳定产出 `dev-session-canvas-0.4.1.vsix`（约 `2.17 MB` / `48 files`），且收口后的 packaged payload 仍可启动。
- `Visual Studio Code` 官方发布文档：<https://code.visualstudio.com/api/working-with-extensions/publishing-extension>
- `Open VSX` 发布文档：<https://github.com/eclipse/openvsx/wiki/Publishing-Extensions>

后续若真的进入公开发布实施阶段，应以“在干净 checkout 中成功产出最小 VSIX，并完成首发平台安装验收”作为新的验证门槛。
