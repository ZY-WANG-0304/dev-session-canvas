---
title: 公开平台发布准备
decision_status: 已选定
validation_status: 已验证
domains:
  - VSCode 集成域
  - 项目状态域
architecture_layers:
  - 宿主集成层
  - 适配与基础设施层
related_specs: []
related_plans:
  - docs/exec-plans/completed/public-marketplace-release-readiness-research.md
  - docs/exec-plans/active/publish-tag-release-flow.md
updated_at: 2026-06-10
---

# 公开平台发布准备

> 2026-06-07 补充：本文主体保留公开 Marketplace Preview 首发准备与后续双市场同步机制的历史决策背景；上一轮 `0.13.0` 已完成双市场发布并在 `main` 上打 `v0.13.0` tag。当前新版本发布准备目标为 `0.14.0`，发布输入、release notes、安装/升级、回退、验证记录与 tag 命令以 `docs/public-preview-release-playbook.md` 和 `docs/notifier-preview-release-playbook.md` 为准。`0.14.0` 不改变本文已选定的渠道策略、Preview 定位、README 打包入口、双市场同版本同步和最终 `main` ref 发布 / tag 约束。

> 2026-06-07 验证补充：`release-0-14-0-prep` 已完成版本一致性、manifest / publish / VSIX 脚本测试、目标 Webview 回归、构建、双市场 dry-run、主扩展与 notifier 打包、clean checkout 打包、Open VSX token 复核、生产依赖审计和 VSIX smoke 重跑验证。当前主扩展 VSIX 为 `dev-session-canvas-0.14.0.vsix`（114 files，约 3.41 MB），notifier VSIX 为 `dev-session-canvas-notifier-0.14.0.vsix`（10 files，约 143.9 KB），两者 `VSCE README doc ref` 均为 `af066bae2f006a450578309059ffd7792efab7ae`；最终 publish / tag 前仍需在合并后的最终 `main` ref 上复跑同一组 release gate。

> 2026-06-08 补充：上一轮 `0.14.0` 已完成双市场发布并在 `main` 上打 `v0.14.0` tag。当前发布准备目标为 `0.14.1`，输入范围是 `v0.14.0` 之后合入 `main` 的 shared runtime 验证硬化、分组 body 空白区拖动画板、微信群二维码物料，以及 Explorer Markdown 文件右键创建关联 Note / 创建入口 surface 复用。`0.14.1` 不改变本文已选定的渠道策略、Preview 定位、README 打包入口、双市场同版本同步和最终 `main` ref 发布 / tag 约束；发布输入、release notes、安装/升级、回退、验证记录与 tag 命令以 `docs/public-preview-release-playbook.md` 和 `docs/notifier-preview-release-playbook.md` 为准。


> 2026-06-09 补充：上一轮 `0.14.1` 已完成双市场发布并在 `main` 上打 `v0.14.1` tag。当前发布准备目标为 `0.15.0`，输入范围是 `v0.14.1` 之后合入 `main` 的 Claude Code Agent Fork、文件活动自动对象 owner-derived 分组、workspace-root section 标题缩放对齐、Panel Webview lifecycle 诊断闭环，以及 publish tag 发布输入固定流程。`0.15.0` 不改变本文已选定的渠道策略、Preview 定位、README 打包入口、双市场同版本同步和最终 `main` ref 发布 / tag 约束；发布输入、release notes、安装/升级、回退、验证记录与 tag 命令以 `docs/public-preview-release-playbook.md` 和 `docs/notifier-preview-release-playbook.md` 为准。

> 2026-06-10 补充：上一轮 `0.15.0` 已完成双市场发布并在 `main` 上打 `v0.15.0` tag。当前发布准备目标为 `0.15.1`，输入范围是 `v0.15.0` 之后合入 `main` 的分组标题 tooltip、分组双击聚焦、`Add Folder to Workspace` 新增 root 就近放置与聚焦、多根通知标题 root 标识、执行性能诊断插桩与新 worktree 调试自举依赖。`0.15.1` 仍不改变本文已选定的渠道策略、Preview 定位、README 打包入口、双市场同版本同步和最终 `main` ref 发布 / tag 约束；发布输入、release notes、安装/升级、回退、验证记录与 tag 命令以 `docs/public-preview-release-playbook.md` 和 `docs/notifier-preview-release-playbook.md` 为准。

> 2026-06-08 流程更新：后续发布输入改为由临时 tag `publish/vX.Y.Z` 固定。该 tag 只表示 publish intent，发布成功并验证双市场主扩展 / notifier 四个目标后，由发布脚本创建正式 `vX.Y.Z` tag 并删除临时 `publish/` tag。release manifest 记录 VSIX sha256、README doc ref、marketplace 验证结果和 tag 状态，但不写回代码库，只作为 GitHub Actions artifact / GitHub Release asset 保存。

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

`Open VSX` 已从延后决策更新为后续公开发布的补充同步渠道。它不取代 `Visual Studio Marketplace` 作为官方 VS Code 用户的主安装路径，也不自动扩大当前兼容宿主支持矩阵；它的定位是让 VSCodium、Theia、code-server、Gitpod 等使用 Open VSX 的 VS Code 兼容宿主能够获取同版本 VSIX。

截至 2026-05-15，`devsessioncanvas` namespace 已创建并完成 owner/verified 认领。后续 release-day 默认应把主扩展与 notifier companion 的同一组最终 VSIX 同步发布到 `Visual Studio Marketplace` 与 `Open VSX`。

## 6. 当前现状

截至 2026-05-05（以当前 `0.5.0` 候选 release 输入快照对应的工作树为准），仓库里已经成立的事实如下：

- `package.json` 具备基础扩展元数据，且仍标记为 `preview: true`。
- 主扩展当前通过 `extensionPack` 聚合 notifier companion，而 notifier companion 继续单向依赖主扩展；用户从主扩展页面安装时会自动带上 notifier，从 notifier 页面安装时也会自动补齐主扩展。
- `README.md` 已明确写成“产品已处于公开 Preview 阶段”；发布执行与对外口径已收口到 `docs/public-preview-release-playbook.md`。
- notifier companion 的独立发布手册已收口到 `docs/notifier-preview-release-playbook.md`。
- 许可证已选定为 `Apache-2.0`。
- `repository`、`homepage` 和 `bugs` 已切换到公开 GitHub 地址。
- 发布工具链已迁移到 `@vscode/vsce`，`scripts/release/package-vsix.mjs` 也已兼容 `.bin/vsce` 与包内 CLI 脚本两条本地入口。
- `scripts/release/package-vsix.mjs` 当前会在打包阶段显式传入 `--readme-path README.marketplace.md`，确保后续 `publish --packagePath` 上传的现成 VSIX 已内嵌 Marketplace 专用 README，而不是依赖发布时重新替换。
- `scripts/release/package-vsix.mjs` 默认会把 Marketplace README 的相对资源改写到当前 `HEAD` 对应的最终 git ref；若在不含 `.git` 元数据的 clean checkout 或导出目录中打包，则必须显式传入 `DEV_SESSION_CANVAS_VSCE_DOC_BRANCH=<final-ref>`，并在打包前校验这些相对资源能在该 ref 上解析成功。
- 当前工作树已能稳定执行 `npm run package:vsix`，生成 `dev-session-canvas-0.5.0.vsix`（约 `2.17 MB`、`49 files`），并再次通过 `npm run test:vsix-smoke`。
- 当前 `working tree` 快照已再次通过隔离 `clean checkout` 打包验证，可在干净目录内稳定产出 `dev-session-canvas-0.5.0.vsix`（约 `2.17 MB`、`49 files`）；packaged-payload smoke 继续通过单独执行 `npm run test:vsix-smoke` 复核。
- 当前候选 release 输入快照也已再次通过隔离 `clean checkout` 验证，说明这轮瘦身后的最小 Preview 工件已经固定到可追溯提交。
- 仓库已补上 `validate:clean-checkout:vsix` 隔离验证入口，可在 `/tmp` 下准备 clean checkout 验证，不必直接扰动当前工作树。
- 当前对外分发主路径已确定为 `Visual Studio Marketplace Preview`，而不是手动分发 `.vsix`；`Open VSX` 已完成 namespace 认领，后续作为补充公开渠道与官方市场保持同版本发布。
- `node-pty` 依赖包已完成第二轮收口，VSIX 当前只保留运行时 `lib/*.js`、所需 `prebuilds` 原生文件，以及运行时仍会解析的 `package.json` / `LICENSE`。
- `scripts/smoke/run-vscode-vsix-smoke.mjs` 现会在 packaged-payload smoke 前显式校验：VSIX 不再携带 `.github/`，也不再携带 `node-pty` 的 `binding.gyp`、`scripts/`、`src/`、`third_party/`、`typings/`、嵌套 `node_modules/` 或 `.pdb`。
- `remote-ssh-real-reopen` 的 storage 恢复链路已进一步修复多 slot 场景：当前实现会扫描同一 canonical workspace id 下的 sibling slots，按 snapshot 时间戳选择最新 source；若 source 不等于 current slot，只迁回 `canvas-state.json` 并由 current slot 继续写主快照，而 live-runtime 继续绑定 source slot 的 `runtimeStoragePath`。仓库已补 `scripts/test/test-extension-storage-paths.mjs` 与 `npm run test:smoke-storage-slot` 作为自动化回归，验证 slot 选择、主快照写回以及 `stateHash` 一致性。
- 当前首发主路径已完成一轮人工验收，用户反馈为“人工验收没发现问题”。
- 已补齐 GitHub issue 模板与 `docs/support.md`，普通反馈、安全问题和 Preview 支持边界已有固定入口。

## 7. 剩余 release-day 动作与后续跟踪

### 7.1 发布包治理已收口到当前候选 release head，但最终发布引用仍需复核

当前仓库已经完成第二轮发布包治理。当前本地工作树与当前候选 release 输入快照的发布包都已显著收紧，并完成了 clean-checkout 复核；剩余问题只在于最终对外发布若不直接使用当前已验证的 git ref，仍需对最终发布引用补最后一轮复核。

本地证据：

- 第一轮收口前，仓库内曾出现约 `293 MB` 的 VSIX，并把 `.debug/playwright/`、`.debug/vscode-smoke/` 等调试缓存一起打入包内。
- 当前工作树在第二轮收紧 `.vscodeignore` 后，`npm run package:vsix` 已可稳定产出 `dev-session-canvas-0.5.0.vsix`（约 `2.17 MB`、`49 files`）。
- 当前 `npm run test:vsix-smoke` 已再次通过，说明第二轮收口后的 packaged payload 仍能独立启动并跑通 trusted smoke。
- 当前 packaged-payload smoke 还会在解包阶段显式校验 VSIX 不再携带 `.github/`，以及 `node-pty` 的 `binding.gyp`、`scripts/`、`src/`、`third_party/`、`typings/`、嵌套 `node_modules/` 与 `.pdb` 等冗余内容。
- 基于当前 `working tree` 快照的 clean-checkout 证据已经更新到 `2.17 MB`、`49 files`；由于当前工作树与候选 release head 已一致，这轮候选发布输入也应以同一组最小工件证据为准。
- 截至 `2026-04-28`，Linux、macOS、Windows 本地 workspace 的 `Agent` / `Terminal` / `Note` 主路径已补齐当前轮功能可用性验证；Windows 下使用 `Codex` 时执行节点内历史仍有无法向上翻页的已知问题。

因此，当前只需保持以下约束与 release-day 动作：

- 保持当前 `.debug/`、`.playwright-browsers/`、测试 artifacts、core dump、截图草稿等路径继续留在发布包外，不让后续改动把它们重新带回工件。
- 若真正对外发布使用的是后续 merge commit、tag 或其他最终 release ref，发布前再对该 git ref 重跑一次 `validate:clean-checkout:vsix`，并确保 `package:vsix` 的 README 改写 ref 也锁定到同一个 final ref，避免把当前候选 release 输入快照的证据直接等同于最终发布输入。
- 保持 packaged-payload smoke 的内容守卫，确保 `node-pty` 的源码、脚本、PDB 与重复依赖不会重新随着后续改动回流到 VSIX。

### 7.2 公开元数据与法律口径已收口，当前只需一致性复核

当前仓库的公开元数据和对外发布口径已经完成当前轮次收口：

- README、CHANGELOG、SECURITY、issue 模板与 `docs/support.md` 已完成第一轮公开 Preview 收口，普通反馈、安全问题和 Preview 支持边界已有固定入口。
- 当前已补齐 `README.marketplace.md` 与 `docs/public-preview-release-playbook.md`，把 Marketplace listing 草案、release notes 使用口径、升级说明和回滚口径收口成正式仓库文档；自 `0.10.1` 发布准备起，`README.marketplace.md` 是默认英文 listing，`README.marketplace.zh-CN.md` 仅作为仓库内中文对应版保留。

真正执行发布前，仍需完成以下复核：

- 继续按 `README.marketplace.md`、`CHANGELOG.md` 与 `docs/public-preview-release-playbook.md` 复核商店页面与仓库文档的一致性。
- 继续复核 README、CHANGELOG、SECURITY、issue 模板和支持边界说明，确保它们与最终发布事实一致。

### 7.3 渠道账号与凭证已就绪，发布前只需确认可用性

当前与 `Visual Studio Marketplace` 相关的发布账号链路已经打通：

- `devsessioncanvas` publisher 已创建并确认可用。
- Azure DevOps organization 与 Personal Access Token 已完成准备。
- 本地 `vsce login devsessioncanvas` 已完成，当前只需在真正发布前确认登录仍然有效。

`Open VSX` 的 namespace 与凭证链路已经从“待准备”更新为“可发布前复核”：

- `devsessioncanvas` namespace 已创建并完成 owner/verified 认领。
- 发布 token 应保存在 `OVSX_PAT` 或本地 `~/.ovsx` file store 的 `devsessioncanvas` entry 中，不写入仓库。
- 当前默认发布入口是 `npm run publish:marketplaces -- --yes`；它会使用 `@vscode/vsce` 发布到 `Visual Studio Marketplace`，并使用 `scripts/release/openvsx-api.py` 发布到 `Open VSX`。该 Python API helper 是对本地 headless Linux 环境中 `npx ovsx` 出现 secret-service / TLS reset 问题的工程绕行，不改变最终调用的 Open VSX Registry API。
- 两个市场必须保持同版本同步发布；若某个市场发布失败，后续补发必须用同一个最终 git ref 和同一组 VSIX，并在发布记录中说明临时偏差。

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

### 7.5 发布流水线最小 CI 化

当前仓库已经有本地打包脚本、VSIX smoke 与 clean-checkout 验证入口；自 2026-06-08 起，release-day 的发布动作迁入最小 GitHub Actions wrapper：`publish/vX.Y.Z` tag 固定发布输入，workflow 负责 checkout、`npm ci`、调用本地 `release:publish-tag`、上传 release manifest / VSIX artifact。发布校验、打包、marketplace 发布、正式 tag 创建与临时 tag 删除仍由仓库脚本负责，避免把核心 release 逻辑散落在 CI yaml 中。

当前轮次仍需保留的最小手工 gate 是：

- 在干净环境中执行 `npm ci`、按最终 git ref 锁定 README 改写目标后的 `npm run package:vsix`、VSIX 内容校验和 Marketplace 发布前 smoke；GitHub Actions 发布路径会重新打包，但不替代发布准备 MR 阶段的人工 gate。
- 让 `@vscode/vsce` 成为唯一受支持的打包入口，并把当前脚本 fallback 行为纳入发布前检查。
- 在真正触发发布前，使用 `npm run release:publish-tag -- --trigger-tag publish/vX.Y.Z --dry-run --package-only` 预览 release ref、VSIX 计划与 manifest，避免临场操作漂移。

当前不在本轮把完整 PR 测试矩阵或 VSIX smoke 全量迁入 CI；若后续要继续降低人为发布风险，再把版本号、预发布标记、release note 检查和 GitHub Release asset 上传继续自动化。

## 8. 风险与取舍

- `Visual Studio Marketplace` 与 `Open VSX` 的发布动作不是事务性的；若其中一个市场成功而另一个市场失败，维护者必须用 `npm run publish:marketplaces -- --yes --skip-package --target <market>` 补发同一组 VSIX，并在发布记录中标注短暂偏差。
- 若后续版本在许可证、公开链接和支持口径失配时贸然上架，商店页面会把仓库内部事实包装成外部承诺，后续回收成本更高。
- 若只解决 publisher / PAT 而不先治理发布包，公开发布过程会被包体污染、内容漂移和不可重复打包持续阻断。

## 9. 正式方案

### 9.1 方案说明

- `0.5.0` 的公开 `Marketplace Preview` 正式发布输入固定为当前候选 release 输入快照（即当前 `release-v0-5-0-prep` 最新 head 对应、且已通过 clean-checkout 复核的工作树内容）验证通过的最小 VSIX 工件：`dev-session-canvas-0.5.0.vsix`。当前仓库内证据为 `49 files`、约 `2.17 MB`，生成入口是 `scripts/release/package-vsix.mjs`，隔离复核入口是 `npm run validate:clean-checkout:vsix -- --source working-tree`。
- 首发渠道正式收敛为 `Visual Studio Marketplace`；该历史决策仍适用于 `0.5.0` 首发复盘。自 2026-05-15 起，后续公开发布默认将 `Open VSX` 作为补充渠道同步发布同版本 VSIX，但不改变官方 VS Code 用户仍以 `Visual Studio Marketplace` 为主路径的安装口径。
- 对外发布口径以 `README.md`、`README.marketplace.md`、`CHANGELOG.md`、`docs/public-preview-release-playbook.md`、`docs/notifier-preview-release-playbook.md` 与 `docs/support.md` 为唯一仓库内正式来源。`README.marketplace.md` 是 Marketplace 打包入口和默认英文 listing，中文对应文案只保留在 `README.marketplace.zh-CN.md`。`0.5.0` 对外内容聚焦 `Dev Session Canvas Notifier` companion 的公开发布与自动安装关系、attention signal 的 `system` 桥接路径，以及嵌入式 `Terminal` shell 的动态探测 / 精确路径持久化 / workspace 级覆盖能力，同时继续保留“`Remote SSH` 与桌面三平台主路径已验证”以及“Windows 下 `Codex` 无法向上翻页”的已知限制。

### 9.2 适用范围与边界

- 本方案原始部分覆盖 `0.5.0` 公开 `Marketplace Preview` 的仓库内准备与 release-day 执行；2026-05-15 的更新只确认后续 release-day 的双市场同步发布机制，不把“已经具备稳定版 SLA”或“所有 Open VSX 兼容宿主均完整支持”写成既成事实。
- 适用的发布输入必须与上述正式文档保持一致；若真正发布使用的不是当前候选 head，而是后续 merge commit、tag 或其他最终 git ref，则必须基于最终 ref 重新执行 clean-checkout 打包验证，并复核 `README.marketplace.md` 的资源改写 ref。
- 支持矩阵继续以 `Remote SSH` 与桌面三平台主路径已验证为基础，但不把 `Restricted Mode`、`Virtual Workspace`、CLI 依赖边界或更强 runtime guarantee 误写成全量稳定支持。

### 9.3 核心规则与不变量

- `scripts/release/package-vsix.mjs` 必须继续显式传入 `--readme-path README.marketplace.md`，且 README 资源改写 ref 必须与最终发布 ref 一致；不允许依赖发布时临时替换文案来修正文档内容。
- `scripts/release/publish-marketplaces.mjs` 是后续 release-day 的统一发布入口；默认重新打包主扩展与 notifier，先发布 notifier 再发布主扩展，并把同一组 VSIX 发布到 `Visual Studio Marketplace` 与 `Open VSX`。
- `npm run validate:clean-checkout:vsix` 与 `npm run test:vsix-smoke` 是发布前必须保留的最小证据链；只要工件大小、文件数或 packaged payload 内容发生变化，就必须同步刷新本设计文档与相关发布文档中的证据。
- 正式安装真相必须继续保持为“主扩展 `extensionPack` 聚合 notifier + notifier 单向 `extensionDependencies` 回补主扩展”，且两侧都保持 `"api": "none"`；这样才能继续兼顾主扩展安装时自动带上 companion、notifier 单独安装时自动补齐主扩展，以及跨 host 场景下只靠 commands 完成协作。
- `.debug/`、`.playwright-browsers/`、`.github/`、`node-pty` 的源码/脚本/PDB/重复依赖等冗余内容必须继续留在 VSIX 之外，避免包体回涨或引入不可追溯内容；相关内容守卫继续由 `scripts/smoke/run-vscode-vsix-smoke.mjs` 负责。
- 发布账号、PAT、Marketplace listing 草案、release notes 口径与支持入口只要发生变化，都必须回写到仓库正式文档，而不是只停留在外部聊天或 MR 评论。

### 9.4 Publish tag 发布输入固定规则

自 2026-06-08 起，后续公开 Preview 发布的正式流程从“在最终 `main` ref 上手工 publish 后补 tag”升级为“临时 publish tag 固定输入，脚本发布成功后创建正式 tag”。维护者仍必须先完成 release prep MR 并合入 `main`，但真正触发发布时不再从当前 shell 的 `HEAD` 推断 release ref，而是在最终 release commit 上创建 `publish/vX.Y.Z`。这个 tag 的 peeled commit 是本次 release input，`scripts/release/publish-tag-release.mjs` 和 `.github/workflows/publish-marketplace-release.yml` 都必须围绕该 commit 进行校验、打包、发布和 tag 收口。

核心不变量如下：

- `publish/vX.Y.Z` 只表示发布意图和固定输入，可以在发布失败时保留并重跑；它不是正式 release tag。
- `vX.Y.Z` 只在 Visual Studio Marketplace 与 Open VSX 上主扩展 / notifier 均发布并通过 metadata 验证后创建，继续表示“该版本已经完整公开发布”。
- `release-artifacts/release-manifest-X.Y.Z.json` 由发布脚本生成，记录 `version`、`releaseRef`、`triggerTag`、`finalTag`、VSIX sha256、README doc ref 和 marketplace 状态；它必须作为 CI artifact 或 GitHub Release asset 保存，不提交回仓库。
- 打包时必须显式把 `DEV_SESSION_CANVAS_VSCE_DOC_BRANCH` 和 `DEV_SESSION_CANVAS_EXPECTED_RELEASE_REF` 绑定到 `publish/vX.Y.Z` 指向的 commit；`--skip-package` 恢复发布必须验证已有 manifest 与 VSIX sha256 匹配，避免复用旧包。
- 发布成功后，脚本可以删除远端和本地 `publish/vX.Y.Z`，前提是正式 `vX.Y.Z` 已存在且指向同一 release ref。

## 10. 验证方法

本研究依赖以下证据来源：

- 仓库内 `package.json`、`README.md`、`CHANGELOG.md`、`docs/public-preview-release-playbook.md`、`docs/support.md`、`LICENSE` 与打包脚本现状。
- 本地执行 `npm run package:vsix`、`npm run validate:clean-checkout:vsix -- --source working-tree --skip-vsix-smoke` 与 `npm run test:vsix-smoke` 的实际结果，确认当前工作树（也即当前候选 release 输入快照）已能稳定产出 `dev-session-canvas-0.5.0.vsix`（约 `2.17 MB` / `49 files`），且收口后的 packaged payload 仍可启动。
- `Visual Studio Code` 官方发布文档：<https://code.visualstudio.com/api/working-with-extensions/publishing-extension>
- `Open VSX` 发布文档：<https://github.com/eclipse/openvsx/wiki/Publishing-Extensions>

后续若真的进入公开发布实施阶段，应以“在干净 checkout 中成功产出最小 VSIX，并完成首发平台安装验收”作为新的验证门槛。
