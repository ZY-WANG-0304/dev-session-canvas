# 定位 PR #362 当前 CI 失败

本 ExecPlan 按 `docs/PLANS.md` 持续维护，交付目标是可复核的失败因果链，不包含产品修复、远端重跑、推送或合并。

## 目标与全局图景

区分 PR #362 的原始失败、仅重跑失败任务导致的工件问题，以及最新完整运行的产品失败。将日志、代码路径和受控验证结合，让维护者知道应修哪里、哪些结论仍缺证据。

## 进度

- [x] (2026-11-04) 从最新 `origin/main`（`23418301`）创建 `ci-pr362-failure-investigation` 分支与独立 worktree，保留原工作区未提交内容。
- [x] (2026-11-04) 核对 PR head `545036a38fa9468943bbde037a6d0e1a23536f99`，最新运行 `41775499320` attempt 3 已失败。
- [x] (2026-11-04) 下载各轮关键失败日志与三个对照工件，确认 attempt 3 为 361 通过、1 失败，两个下游红灯；attempt 2 为工件身份问题；attempt 1 为 remount 前 snapshot 超时。
- [x] (2026-11-04) 实际 Host 受控测试复现静默 fallback 与 prompt/spinner 两条提前等待路径，以及后续 Working 不恢复运行；5/5 定向用例通过，临时测试改动已撤回。
- [x] (2026-11-04) 新增调查设计文档，同步索引、核心信念及技术债；完成调查范围，产品修复与自然触发时序留待后续。
- [x] (2026-11-04) 五份文档通过 `checkDocumentation`，`git diff --check` 通过；确认临时测试已恢复、依赖链接已删除，原工作区改动保留。

## 意外与发现

原工作区存在未提交的先前调查摘要，只作为线索，不能替代本轮原始证据。最新 attempt 3 的三个失败检查是 packaged-host `agent-tui--tool-network-silence`、`verify-result` 和 `Verify release contract`，后二者是下游拒绝验收。首个样本在工具开始后 89ms 即失败，并没有观察满 3 秒；tool-end 文件是失败后 finally 释放工具产生。prompt 分支不检查 spinner，因此 1600ms fallback 不是唯一候选。

GitHub attempt 2 jobs API 使用每页 100 条时多次返回 HTTP 502，改每页 30 条后取得所需任务身份。下载失败与原 CI 产品故障分别记录，未重跑远端任务。

## 决策记录

2026-11-04：在相邻独立 worktree 调查而非 stash 或带走原工作区改动，确保不干扰既有工作。调查分支从最新 main 创建，分析 PR 特有行为时使用精确 PR head 的文件；两者不可混称。

2026-11-04：用原有实际 Host fixture 做两项临时故障特征测试，不把“确认现有错误行为”的测试加入正式目录；完整复现代码收录在设计文档。状态模块在 main 与 PR 完全一致，局部测试可验证机制，但不代证原 CI 的自然触发分支。只记录候选修复，不选择未经验证的产品方案。

## 结果与复盘

调查交付为 [PR362 CI 失败分层与 Agent 工具等待误判调查](../../design-docs/pr362-ci-failure-investigation.md)。已定位当前产品状态断言、其下游验收链和旧轮次 workflow 问题，并证明两条实际 Host 误判机制。仍未确定原 CI 的转换分支、早期容量拒绝的输入身份和历史 snapshot 消息丢失位置；这些已登记技术债。未修改产品、workflow 或正式测试，没有完成真实 CLI 的本地全链路复现，也没有推送或触发新的 CI。

## 上下文与定向

`.github/workflows/release-preflight.yml` 控制合并验收，`.github/workflows/ci-validation.yml` 产生并消费固定输入计划。一个 workflow run 可以有多个 attempt，即同一运行的不同重试轮次。`tests/vscode-smoke/agent-tui-tests.cjs` 用真实 CLI 的独立工具记录核对产品 Agent 状态；`extensions/vscode/dev-session-canvas/src/` 是待追踪的状态实现。测试期望工具尚未完成时保持 `running`，不能提前变成 `waiting-input`。

## 工作计划

第一里程碑固定远端输入，保存每轮失败日志并对照工件身份。第二里程碑从失败断言追踪状态来源，对比 PR 与 main，用现有测试入口构建不改变产品的最小验证。第三里程碑在设计文档记录已确认事实、候选原因、证据局限，并归档计划。

## 具体步骤

工作目录为相邻 `ci-pr362-failure-investigation` worktree。使用 `gh api repos/ZY-WANG-0304/dev-session-canvas/pulls/362` 核对 head/base；使用 `gh api repos/ZY-WANG-0304/dev-session-canvas/actions/runs/41775499320/attempts/3/jobs --paginate` 定位失败 job，`gh api repos/ZY-WANG-0304/dev-session-canvas/actions/jobs/<job-id>/logs` 获取原始日志。下载工件到 `/tmp/pr362-ci-investigation/`，不写入版本库。失败工件 ID 为 `13330985493`，对照为 `13297965231`（attempt 1 packaged）和 `13330313711`（attempt 3 source）。

按设计文档完整代码临时扩展 `scripts/test/test-host-execution-owner-wiring.mjs`，运行 `node scripts/test/test-host-execution-owner-wiring.mjs --name-pattern 'PR362 diagnostic|owned Agent title-only|S10 Host Agent input commits'`，结果 5/5。结束后删除临时插入内容；本机 patch 与输出保存在临时证据目录。最终使用 `scripts/gates/check-documentation.mjs` 的 `checkDocumentation` 函数检查五份改动文档，再 `git diff --check`。

## 验证与验收

必须能从原始日志指出独立失败断言、预期与实际状态、下游失败关系；代码级复现与原 CI 触发原因应分开陈述。记录测试命令、结果、运行输入与不能复现的限制。调查不要求修复 CI 为绿色。

## 幂等性与恢复

所有 GitHub 操作为只读，工件下载到独立临时目录。测试未改变全局 CLI 版本或用户配置。两边锁文件一致，本轮仅临时链接既有 node_modules，结束删除链接。保留原工作区的分支和未提交文件，不提交、不推送、不重跑 CI。

## 证据与备注

远端运行：<https://github.com/ZY-WANG-0304/dev-session-canvas/actions/runs/41775499320/attempts/3>。验证输入 `0cc921f200fa2c9463dc795b300a9d6a041667f4`，不能以 head 替代。关键输出：

    verify-result: passed=361, failed=1, notRun=[], errors=[]
    Product state differs from independent running evidence
    actual: waiting-input; expected: running
    Host execution owner wiring: 5/5 passed (non-native only)

## 接口与依赖

使用现有 GitHub CLI、Node.js 与仓库测试工具，不新增产品接口或依赖。若完整真实 CLI smoke 依赖不可用，退回隔离的现有模块测试，并明确不能替代完整 CI。

更新记录：2026-11-04 创建调查计划，固定输入与非破坏性操作边界；随后补充三轮远端证据、原始时间线与实际 Host 受控验证，明确机制复现不代证首败分支，归档调查并登记后续；最终补记五份文档检查通过与临时改动恢复结果。
