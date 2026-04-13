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
updated_at: 2026-04-11
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

`Open VSX` 保留为后续补充渠道，但不与首发里程碑绑定。原因是它引入了额外的 namespace / token 管理与渠道同步问题，而当前仓库连第一条公开发布主线都还未收口。

## 6. 当前现状

截至 2026-04-11，仓库里已经成立的事实如下：

- `package.json` 具备基础扩展元数据，且仍标记为 `preview: true`。
- README 与 `docs/publish-readiness.md` 正在切换到“公开 Preview 准备”口径。
- 许可证已选定为 `Apache-2.0`。
- `repository`、`homepage` 和 `bugs` 已切换到公开 GitHub 地址。
- 发布工具链已迁移到 `@vscode/vsce`，`scripts/package-vsix.mjs` 也已兼容 `.bin/vsce` 与包内 CLI 脚本两条本地入口。
- 当前工作树已能稳定执行 `npm run package:vsix`，生成约 `7.07 MB`、`82 files` 的 VSIX，并再次通过 `npm run test:vsix-smoke`。
- 仓库已补上 `validate:clean-checkout:vsix` 隔离验证入口，可在 `/tmp` 下准备 clean checkout 验证，不必直接扰动当前工作树。
- 当前对外分发主路径已确定为 `Visual Studio Marketplace Preview`，而不是手动分发 `.vsix`。

## 7. 阻塞项与所需工作

### 7.1 发布包治理是第一 blocker

当前仓库已经完成第一轮发布包治理，但还没有形成“与开发和测试工作树彻底解耦、且在干净环境下重复验证过”的公开发布包。

本地证据：

- 第一轮收口前，仓库内曾出现约 `293 MB` 的 VSIX，并把 `.debug/playwright/`、`.debug/vscode-smoke/` 等调试缓存一起打入包内。
- 当前工作树在补齐 `.vscodeignore` 和打包脚本后，`npm run package:vsix` 已可稳定产出约 `7.07 MB`、`82 files` 的 VSIX。
- 当前 `npm run test:vsix-smoke` 已再次通过，说明收口后的 packaged payload 仍能独立启动并跑通 trusted smoke。
- 但当前 VSIX 里的 `node-pty` 依赖仍包含 `binding.gyp`、`scripts/`、`src/`、`third_party/`、`typings/` 等超出严格最小运行集的内容；这些内容未必全部必须带入公开发布工件。

因此，若要公开发布，必须先补齐以下工作：

- 保持当前 `.debug/`、`.playwright-browsers/`、测试 artifacts、core dump、截图草稿等路径继续留在发布包外，不让后续改动把它们重新带回工件。
- 在干净 checkout 上验证 `npm run package:vsix` 可稳定成功，而不是只在当前 worktree 成立。
- 继续判断 `node-pty` 当前带入的 `scripts/`、`src/`、`third_party/`、`typings/` 等依赖级 payload 是否还能进一步收紧；若要继续收口，应以“不破坏 packaged-payload smoke”为前提。
- 为 VSIX 产物建立尺寸和内容检查，确保发布包不再随着本地调试状态漂移。

### 7.2 公开元数据与法律口径仍需继续收口

当前仓库的部分公开元数据已经落地，但对外发布口径仍未完全收口：

- README、CHANGELOG 与 SECURITY 已完成第一轮公开 Preview 收口，但仍需继续压缩内部协作语境。
- 当前尚未补齐 issue 模板、发布说明和公开支持边界。

若要公开发布，至少需要补齐：

- 重写 README 中的分发定位、支持范围、安装升级说明和已知限制，使其适合外部用户阅读。
- 复核 CHANGELOG、SECURITY、问题反馈入口和支持口径，确保它们与公开发布事实一致。

### 7.3 渠道账号与凭证是必要条件，但不是第一 blocker

若选择 `Visual Studio Marketplace`，还需要：

- 创建或确认 `devsessioncanvas` publisher 身份。
- 准备 Azure DevOps organization 和 Personal Access Token。
- 用发布账号完成一次登录与最小发布演练。

若选择 `Open VSX`，还需要：

- 在 `Open VSX` 上创建或认领 namespace。
- 准备 `ovsx publish` 所需 token。
- 决定是否与 `Visual Studio Marketplace` 保持同版本同步发布。

这些工作是必要条件，但它们只应发生在“发布包治理”和“公开元数据收口”之后。否则即使拿到了 token，也只能把一个当前并不适合公开分发的包推上去。

### 7.4 平台支持矩阵需要从“内部验证”升级到“公开承诺”

当前验证证据最强的路径主要集中在 `Remote SSH` 开发路径、Restricted Mode 和 VSIX smoke；Linux、macOS、Windows 本地路径仍未经过严格验证。若转向公开平台，需要把当前验证证据升级为“公开支持矩阵”：

- 至少明确首发支持哪些操作系统，哪些仍是 `best-effort` 或未支持。
- 明确首发是否支持 Remote SSH、`systemd --user` 缺失场景、Windows、本地无 `codex` / `claude` CLI 的场景。
- 对外写清 `Restricted Mode`、`Virtual Workspace` 的限制，而不是只放在内部文档里。
- 在公开发布前，对首发承诺的平台做一轮人工验收，而不只依赖当前 smoke。

当前建议对外口径先收敛为以下矩阵：

| 场景 / 能力 | 当前状态 | 对外口径 |
| --- | --- | --- |
| `Remote SSH` workspace | `Preview` 主路径 | 当前最强验证证据所在路径，可作为公开 Preview 的主推荐场景 |
| Linux 本地 workspace | 可尝试，但未严格验证 | 可以存在代码与自动化证据，但当前不写成正式支持承诺 |
| macOS 本地 workspace | 可尝试，但未严格验证 | 代码路径已接通，但当前没有严格验证证据 |
| Windows 本地 workspace | 可尝试，但未严格验证 | 代码路径已接通，但当前没有严格验证证据 |
| `Restricted Mode` | 有限支持 | 允许打开画布，但禁用执行型入口 |
| `Virtual Workspace` | 不支持 | 不在当前公开 Preview 范围内 |
| `Agent` 节点 | 依赖外部 CLI | 需要 `codex` 或 `claude` CLI 可被 Extension Host 解析 |
| `Terminal` 节点 | 依赖工作区侧 shell | 需要当前工作区侧可用 shell |
| `runtimePersistence.enabled = false` | 基线支持 | 不承诺真实进程跨 VS Code 生命周期持续存在 |
| `runtimePersistence.enabled = true` | `Preview` 能力，已具备较多验证证据 | 已有 `Remote SSH` real-reopen 自动化、相关 smoke 与人工验证证据；当前用户可见 guarantee 仍取决于 backend 与平台组合。Linux 本地与 `Remote SSH` 在 `systemd --user` 可用时优先尝试更强 guarantee，否则回退到 `best-effort` |

### 7.5 发布流水线需要转成“干净环境 + 可重复”

当前仓库已经有本地打包脚本和 VSIX smoke，但还没形成 Marketplace 公开发布所需的收口流水线。后续应补齐：

- 在干净环境中执行 `npm ci`、`npm run package:vsix`、VSIX 内容校验和 Marketplace 发布前 smoke。
- 让 `@vscode/vsce` 成为唯一受支持的打包入口，并把当前脚本 fallback 行为纳入发布前检查。
- 为版本号、预发布标记、release note 和发布 tag 建立固定流程。
- 让发布动作默认从 CI 或最小化的干净工作树触发，而不是从个人调试目录直接执行。

## 8. 风险与取舍

- 若一开始同时承诺 `Visual Studio Marketplace` 和 `Open VSX`，会把首发收口拆成两个渠道问题，增加 namespace、token 和版本同步成本。
- 若在许可证、公开链接和支持口径没收口前就上架，商店页面会把当前内部事实包装成外部承诺，后续回收成本更高。
- 若只解决 publisher / PAT 而不先治理发布包，公开发布过程会被包体污染、内容漂移和不可重复打包持续阻断。

## 9. 当前结论

截至当前研究结论：

- 当前仓库还不具备公开平台发布 readiness。
- 第一优先级不是申请发布账号，而是形成一个干净、稳定、最小化的 Marketplace 发布工件。
- 公开发布方向已经确认：首发渠道先收敛到 `Visual Studio Marketplace`；`Open VSX` 作为后续补充渠道单独决策。
- `Apache-2.0` 和公开 GitHub 仓库链接已经确定，但在公开发布前仍要完成四类收口：发布包治理、公开文档与支持口径、渠道账号与凭证、公开支持矩阵与发布流水线。

## 10. 验证方法

本研究依赖以下证据来源：

- 仓库内 `package.json`、`README.md`、`CHANGELOG.md`、`docs/publish-readiness.md`、`LICENSE` 与打包脚本现状。
- 本地执行 `npm run package:vsix` 与 `npm run test:vsix-smoke` 的实际结果，确认当前工作树已能稳定产出约 `7.07 MB` / `82 files` 的 VSIX，且收口后的 packaged payload 仍可启动。
- `Visual Studio Code` 官方发布文档：<https://code.visualstudio.com/api/working-with-extensions/publishing-extension>
- `Open VSX` 发布文档：<https://github.com/eclipse/openvsx/wiki/Publishing-Extensions>

后续若真的进入公开发布实施阶段，应以“在干净 checkout 中成功产出最小 VSIX，并完成首发平台安装验收”作为新的验证门槛。
