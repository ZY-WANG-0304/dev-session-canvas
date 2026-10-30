# 准备 0.27.0 公开 Preview 发布

本 `ExecPlan` 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘`。本计划按仓库根目录的 `docs/PLANS.md` 编写和维护。

## 目标与全局图景

用户将获得公开 Preview `0.27.0`：多窗口可共享同 root 画布，执行生命周期和持久化模式切换更可靠，删除与失联运行时处理更清楚。工作完成后，根 package、两个扩展、锁文件、用户更新说明、支持限制和发布契约须对齐，并有针对最新预合并输入通过的 Release Preflight。此计划只准备并审查发布 PR；合并、tag 与市场发布需要分别遵循后续授权边界。

## 进度

- [x] (2026-10-30) 从 `origin/main`（46c91e82）建立隔离的 `release-0-27-0` 工作树，保留用户主工作树及未跟踪文件不动。
- [x] (2026-10-30) 复核 v0.26.0 之后 main 的产品变更、版本规则与既有 v0.26.1 发布材料；确定采用 0.27.0 里程碑，取代 #327 的 0.26.1 补丁提案。
- [x] (2026-10-30) 统一根、双扩展和 lockfile 版本，更新双 CHANGELOG、Marketplace / README、发布手册、支持文档、发布决策和 v0.27.0 契约；描述保留用户可见边界。
- [x] (2026-10-30) `npm run release:preflight -- --version 0.27.0` 通过；`git diff HEAD --check` 通过；lockfile 由本地 offline `npm install --package-lock-only --ignore-scripts` 按 main package manifests 同步，只改四处 workspace 版本。
- [x] (2026-10-30) 提交 `66c2a02c`，推送 `release-0-27-0`，创建草稿 PR #345。
- [x] (2026-10-30) 用户授权后关闭旧 PR #327，并评论说明它由 #345 取代。
- [ ] 将 PR #345 标记 ready；检查最新 main 的预合并完整 Release Preflight 和 required contract check。
- [ ] 汇总 PR URL、静态检查、完整 CI 与尚未合并/发布的状态。

## 意外与发现

- 用户报告最近两天试用未发现明显问题，但未指定 build、操作系统或场景。它只作为定性手动反馈记入契约，不替代预合并任务图。
- #327 虽有旧输入的大规模验收记录，但其主线基线停在 10 月 25 日，当前 PR 为 DIRTY 且需 review；不能把旧验收当作新版本预合并 SHA 的证明。

## 决策记录

- 决策：版本从已发布的 0.26.0 提升至 0.27.0，而不是延续 0.26.1。理由：新里程碑同时覆盖同 root 画布共享、持久化模式切换和多处执行生命周期重构；这符合仓库 `0.x.0` 语义，并且用户明确要求另开 0.27.0。
  日期/作者：2026-10-30，用户决定；Codex 记录。
- 决策：先做完新 PR 的可审阅输入，再关闭 #327。理由：避免先关闭已有准备工作、却没有替代发布输入可追踪。
  日期/作者：2026-10-30，Codex。
- 决策：不合并、不创建发布 tag、不发布外部渠道。理由：当前授权是准备并另开版本 PR；正式合并与发布仍有独立门槛。
  日期/作者：2026-10-30，Codex。

## 结果与复盘

尚未完成。新 PR 的完整跨平台门禁和 review 是发布准备是否可进入合并阶段的最终证据。用户两日试用的精确范围未知，因此不能写成矩阵覆盖结论。

## 上下文与定向

已发布基线为 `v0.26.0`。`docs/workflows/VERSION.md` 将 `0.x.0` 定义为新对外里程碑；`0.x.y` 用于同一里程碑内的修复。主扩展与 notifier 必须使用同版本。新分支基于最新 `origin/main`，不直接修改主工作树；主工作树有三个未跟踪用户文件，应保持不动。

产品变更主要由 `docs/design-docs/runtime-shared-root-canvas-sync.md`、`docs/design-docs/runtime-socket-recovery.md`、`docs/design-docs/canvas-node-deletion.md` 和 `docs/product-specs/runtime-persistence-modes.md` 定义。`docs/release-contracts/v0.27.0.md` 是发布范围、用户说明、限制和验证计划的静态权威输入。CI 与 release contract 验收方法见 `docs/WORKFLOW.md` 与 `docs/design-docs/release-gate-redesign.md`。

## 工作计划

将主扩展、notifier 与 root `package.json` 版本统一为 0.27.0，并同步 lockfile。把 v0.26.0 之后已合入 main 的用户可见变化整理进两个 CHANGELOG 和双语 listing；内部门禁重构留在设计 / CI 文档，不写成产品功能。更新 README、公开 Preview 与 notifier 发布手册、支持边界、发布判断设计、v0.27.0 设计决策和契约。

验证时先运行静态 `release:preflight`，再确认版本一致、链接有效、diff 没有发布后证据或与已发布历史冲突。提交并推送后创建非草稿 PR，让正式 Release Preflight 以真实最新预合并 SHA 执行 `release-pr` 完整任务图。PR 的验证结果只适用于其确切 head 与 base；任一更新都需等新结果。不要以历史 #327、局部本地验证或用户试用替代 required check。

## 具体步骤

工作目录为隔离 worktree `/tmp/dsc-release-0-27-0`。

1. 检查三个 package manifest、lockfile、双 CHANGELOG、双语 README / listing 与发布契约均使用版本 0.27.0，保留 `0.26.0` 作为上一版历史。
2. 在仓库根运行 `npm run release:preflight -- --version 0.27.0`，预期静态检查通过；若失败，按具体错误修复静态输入后重跑。
3. 运行 `git diff --check`，审阅 `git diff --stat` 和逐文件差异；通过后按仓库 commit 规范提交 `chore(release): prepare 0.27.0 milestone`。
4. 推送 `release-0-27-0` 并创建以 main 为目标的非草稿 PR。等待该 PR 当前 head 的 Release Preflight required check 和 review；main 前进或 PR head 更新时，依工作流刷新预合并验证。
5. 旧 PR #327 已关闭并留言指向替代 PR #345；新 PR 转为 ready 后，检查它自己的真实预合并发布门禁。

## 验证与验收

静态验收包括三处 package 版本一致、package-lock 对应一致、两个 CHANGELOG 标题与契约同为 0.27.0、listing 和 README 升级基线从 0.26.0 指向 0.27.0、中文文案和限制边界与英文一致、`release:preflight` 与 `git diff --check` 成功。

发布准备 PR 验收必须观察真实预合并 SHA 的 `Release Preflight / Verify release contract` 成功，并核对其正式验收记录确实包含本轮输入、完整必跑集合和同批 VSIX。发布 tag 尚未创建，外部发布也尚未执行。若 required check 未通过或为 skipped，验收未完成。

## 幂等性与恢复

版本和文档更新只作用于隔离分支，可重复运行静态 preflight。若 PR checks 失败，修复输入并推送新 head，等待新 head 完整验证；不得沿用旧 run 的绿色。关闭 #327 只在替代 PR 已创建并可审阅后进行，可通过新的 PR 继续发布准备。

不得清理或覆盖主工作树中的未跟踪文件。此计划不创建正式 `v0.27.0` 或临时 `publish/v0.27.0` tag，也不写 Marketplace / Open VSX。

## 证据与备注

起始基线：`origin/main` = `46c91e82a90400094a46008f1ea1903e7131763f`，日期 2026-10-30。
用户试用反馈：两天未发现明显 bug；准确版本、平台和场景未提供。

## 接口与依赖

本任务不增加代码接口、依赖或运行时服务。使用现有 `scripts/release/release-preflight.mjs` 校验发布静态输入；正式 PR workflow 使用 `.github/workflows/release-preflight.yml` 和 `.github/workflows/ci-validation.yml` 生成预合并输入并运行完整 gate。发布契约中的固定 `0.27.0` 版本、双 package、lockfile 和 release notes 必须相互一致。
