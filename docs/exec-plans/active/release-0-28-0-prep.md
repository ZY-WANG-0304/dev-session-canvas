# 准备 0.28.0 公开 Preview 发布

本 `ExecPlan` 是活文档，必须持续更新进度、意外与发现、决策记录和结果与复盘；内容遵循仓库根目录 `docs/PLANS.md`。

## 目标与全局图景

从最新 `origin/main` 准备并交付公开 Preview `0.28.0`。主扩展和 notifier、锁文件、双 CHANGELOG、Marketplace / README 文案、发布手册、支持边界、发布设计与静态发布契约对齐。发布准备 PR 的真实预合并输入须通过仓库规定的完整 Release Preflight；最终产品输入另行通过批次验收后，才进入渠道发布。

## 进度

- [x] (2026-11-02) 刷新远端；确认 `origin/main` 为 `efdc6cda`，`v0.27.0` 已正式发布，当前三个 package manifest 为 `0.27.0`。
- [x] (2026-11-02) 核对 `0.27.0` 后的产品变更：#351 标题编辑入口、#355 Codex `Ctrl+/` 映射、#356 自动文件活动和文件节点退役；排除发布工具 / CI 变更作为用户功能。
- [x] (2026-11-02) 建立隔离 worktree `/tmp/dsc-release-0-28-0` 和分支 `release-0-28-0`，基线为 `origin/main@efdc6cda`；未改动原工作树中的未跟踪文件。
- [x] (2026-11-02) 记录 `0.28.0` 新里程碑选择、发布范围和验证边界于 `docs/design-docs/release-0-28-0.md`。
- [x] (2026-11-02) 对齐 package / lockfile 版本、用户 CHANGELOG、双语 README / listing、发布手册、支持材料与 `docs/release-contracts/v0.28.0.md`；同步设计索引、core beliefs 与发布决策记录。
- [x] (2026-11-02) `npm run release:preflight -- --version 0.28.0` 通过；package manifests 与 lockfile 四处 workspace 版本均为 `0.28.0`；`git diff --check` 通过。
- [x] (2026-11-02) 提交并推送发布准备分支，创建 main 目标非草稿 PR #357（https://github.com/ZY-WANG-0304/dev-session-canvas/pull/357）。
- [x] (2026-11-02) 首轮 PR #357 Release Preflight（run `41340087830`，head `90e23845`）因 `agent-tui--input-during-work` 失败；普通 Codex `/theme` 提示被烟测夹具误判为主题菜单，测试重复发送 Enter 并在任务启动前超时。
- [x] (2026-11-02) PR #358 已合入，merge commit 为 `2373a250`；它修正普通主题提示识别并保留 Runtime reload readiness。其 Release Preflight（run `41361910686`，head `d1f2333e`）通过。
- [x] (2026-11-02) 将 #357 从原 head `90e23845` rebase 到 `origin/main@2373a250`；rebase 无冲突，最新 main 已成为 PR 分支祖先，发布范围未改变。
- [x] (2026-11-02) rebase 后重新运行 `npm run release:preflight -- --version 0.28.0` 与 `git diff --check`，均通过。
- [x] (2026-11-02) 按旧远端 head `90e23845` 使用 `--force-with-lease` 推送 rebase 后的 PR 分支；每次更新均须以 GitHub 最新 head 的全新 Release Preflight 与 `Verify release contract` 为准。
- [ ] 等待最新 PR head 的完整 Release Preflight、`Verify release contract` 与必要 review；不复用旧 head 结果。
- [ ] PR 合并后固定最终产品 SHA，按 `docs/WORKFLOW.md` 运行 release batch 与发布渠道流程；如门禁、审批或渠道条件未满足，记录停点而不绕过。

## 意外与发现

- `0.27.0` 的发布准备 PR #345 已合并，GitHub Release `v0.27.0` 已发布；本轮是新的 `0.28.0`，不是重复发布或延续 `0.27.0`。
- #351 的真实 VS Code 键盘焦点 / 高对比主题 / 持久化人工验收仍需明示；#355 的真实 Codex CLI PTY 验证缺失，不得写成已通过。
- #356 的兼容清理会移除旧自动文件活动派生状态，但保留磁盘文件、普通连线和独立文件操作能力。
- PR #357 的首轮失败是烟测夹具误识别普通 `/theme` Tip 提示，不是发布文案或 0.28.0 产品变更导致；修复随 PR #358 合入。#357 rebase 后仍须重新完成自身的正式验收。

## 决策记录

- 决策：基于用户 2026-11-02 的发布授权，以 `origin/main` 最新基线准备 `0.28.0`。
  理由：最新正式版本为 `0.27.0`；之后主线包含标题改名交互和自动文件活动整体退役等用户可见变化，不是单纯修复或打包收口，符合 `docs/workflows/VERSION.md` 的 `0.x.0` 新里程碑语义。
  日期/作者：2026-11-02 / 用户授权；Codex 记录版本判断。
- 决策：准备范围排除 CI / 发布工具重构作为用户功能，notifier 仅同步版本，不宣称 notifier 行为改变。
  理由：这些改动属于内部发布机制；此次主线产品变化没有改变 notifier 的投递契约。
  日期/作者：2026-11-02 / Codex。

## 结果与复盘

发布准备进行中。最终是否交付由当前预合并完整门禁、required review、固定产品批次验收及必需渠道结果决定；未完成前不得声称 `0.28.0` 已发布。

## 上下文与定向

已发布基线 `v0.27.0` 对应发布 PR #345。发布范围最初基于 `origin/main@efdc6cda`（含 #351 / #355 / #356）确定；2026-11-02 已将 PR #357 rebase 到 `origin/main@2373a250`（含已合并的 #358），没有改变用户功能范围。主要静态输入为 `package.json`、主扩展 / notifier `package.json`、`package-lock.json`、双 `CHANGELOG.md`、英中文 root README 和 Marketplace README、两个发布手册、`docs/support.md`、`docs/design-docs/public-marketplace-release-readiness.md`、本设计文档及 `docs/release-contracts/v0.28.0.md`。

产品范围锚点为 `docs/design-docs/canvas-node-group-title-editing.md`、`docs/design-docs/execution-terminal-clipboard-shortcuts.md`、`docs/design-docs/canvas-file-activity-retirement.md` 及其规格 / 实施计划。文件活动退役只清理扩展旧派生状态，不删除磁盘文件或独立文件关联能力。真实 Codex CLI PTY 与真实 VS Code 部分宿主行为仍有已记录的验证边界。

## 工作计划

1. 维护本 ExecPlan 与发布设计决策、设计索引和 `core-beliefs`，让版本、范围、非目标和未验证边界显式。
2. 将 root、主扩展、notifier 及 workspace lockfile 同步至 `0.28.0`；在双 CHANGELOG 和英语主 README / Marketplace listing、中文对应材料中准确表达标题编辑、`Ctrl+/` 映射与文件活动退役。
3. 更新 notifier 的版本对齐说明但不捏造通知行为变化；更新安装 / 升级、回退和支持说明，尤其说明旧自动文件活动状态被清理以及磁盘文件保留。
4. 新增静态发布契约，列出范围、用户 release notes、复核文档、已知限制和验证范围；不写 run、SHA、VSIX hash 或发布渠道结果。
5. 执行 `npm run release:preflight -- --version 0.28.0` 和 `git diff --check`，审阅文件清单、版本一致性、链接及文案与源规格的一致性。
6. 按仓库发布流程推送 PR 并等待当前 head 的完整正式门禁与 review。PR merge 后，以最终 main 产品 SHA 独立进行 release batch 验收，再由独立发布 workflow 消费固定原包。

## 具体步骤

工作目录：`/tmp/dsc-release-0-28-0`。分支 `release-0-28-0` 的发布范围基线为 `origin/main@efdc6cda`；当前 PR 分支已 rebase 到 `origin/main@2373a250`。

```sh
npm run release:preflight -- --version 0.28.0
git diff --check
git diff --stat
```

静态 preflight 预期通过并确认三个 manifests、lockfile、CHANGELOG 标题和契约均匹配 `0.28.0`。正式 PR 预合并任务图由 GitHub Actions 执行；本地 `release:verify` 输出 `acceptance: false`，不能代替正式跨平台门禁。PR 每次更新后，旧 head 的绿色结果不复用。

## 验证与验收

- 三个 package manifest、lockfile、两份 CHANGELOG 和契约均统一 `0.28.0`；上版 `0.27.0` 历史原样保留。
- 用户文案精确说明标题编辑对象及只读边界；`Ctrl+/` 映射和真实 Codex TUI 缺口；旧自动活动派生状态清理、磁盘文件与独立文件能力保留。
- `npm run release:preflight -- --version 0.28.0` 与 `git diff --check` 通过。
- 最新真实预合并 SHA 的 Release Preflight 完整任务图及 `Verify release contract` 成功，PR review 满足规则；合并后的最终产品 SHA 另通过完整 `release-tag` 批次验收。
- 只有固定批次对必需渠道交付成功后，才可报告新版本已发布。

## 幂等性与恢复

所有文件改动限定于隔离发布分支。静态 preflight 可重复执行。若 PR 输入改变，重新生成并验证最新预合并 SHA；若发布工具 / 渠道遇错，依 `docs/WORKFLOW.md` 以相同批次恢复，不重打包替换产品字节。不得修改或清理主工作树的用户未跟踪文件。

## 证据与备注

- 发布前主线：`origin/main@efdc6cdae9bba35f4143347e4e97671dad52de57`。
- 已发布基线：GitHub Release `v0.27.0`，其目标为发布准备 PR merge commit `034c5a02894dab45fdbde9b877e787fa4f91f242`。
- PR #351 / #355 / #356 的范围、验证与限制以各自合并记录和仓库设计 / ExecPlan 为准；本计划不把其局部回归结果当成新版本完整验收。

## 接口与依赖

本次不新增代码接口、运行时依赖或生产服务。使用现有 `scripts/release/release-preflight.mjs` 静态校验，正式 PR 由 `.github/workflows/release-preflight.yml` 与 `.github/workflows/ci-validation.yml` 对真实预合并输入执行任务图；合并后的批次与渠道流程按 `docs/WORKFLOW.md` 调度。

2026-11-02 修订：建立 0.28.0 发布范围、版本决策、主线基线和执行顺序；记录产品迁移边界与未完成真实宿主验证，避免把 PR 局部证据误写为新版本发布结论。
