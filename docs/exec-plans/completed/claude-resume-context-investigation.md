# 定位 Claude 显式会话 ID 未获得恢复能力

本 ExecPlan 按 `docs/PLANS.md` 维护。工作目录 `/tmp/dscr`，PR #314 分支 `investigate-smoke-reload-autostart`，调查基线 `523ee9a5`。本轮交付可复核的根因和修复边界；临时探针/对照补丁不作为正式产品实现。

## 目标与全局图景

确定为什么关闭 RuntimePersistence 时，Claude 自定义命令带显式 session ID，运行节点已保留该 ID，却一直为 resumeSupported=false、resumeStrategy=none。区分测试夹具、会话文件可见性、发现入口遗漏及状态投影覆盖，用原身份对照证明，并说明对用户手动恢复能力的影响。

## 进度

- [x] (2026-10-10) 确认基线、读取原失败工件和现有启动/正文/文件确认代码。
- [x] (2026-10-10) 核对文件确认契约，确认 owned 入口遗漏及旧 helper 的 legacy map 限制；追溯至 ae3c42cf 的 business 接线。
- [x] (2026-10-10) 同环境 locator 成功但原用例失败；Host 有/无文件 2/2，原生最小确认接线后完整原用例通过。
- [x] (2026-10-10) 精确恢复所有临时源码，同步设计、证据与技术债后归档；本次 PR314 更新承载提交。

## 意外与发现

原工件中 Claude 已 started/waiting-input，显式 ID 已传入启动参数；未出现文件确认诊断。新 owned 启动与 waiting-input 路径缺少文件确认调用，旧 session 路径存在该调用。对照已确认该遗漏是本用例根因。实际文件 locator 成功，但旧 helper 仍因 map 无原记录而退出；所以仅调用旧方法不能修复。

## 决策记录

- 决策：复用既有 locator 和 Host fixture 验证文件证据、原执行和确认入口，不修改 smoke 恢复策略断言。理由：ID 候选与可恢复能力有意分开，不能把测试期望改成只检查 ID。日期/作者：2026-10-10 / Codex。

## 结果与复盘

已确认功能迁移缺口：候选 ID 解析正确、同环境文件可见，owned 缺少确认入口；旧 helper 身份校验不适用于 owned。最小接线后原生完整原用例通过，无文件负例保持 none。正式修复未实施，完整 VSIX gate 仍阻塞于 `verifyClaudeExplicitSessionIdPreservesResumeContext:9972`，后续 Runtime 开启场景未执行。

## 上下文与定向

`tests/vscode-smoke/extension-tests.cjs::verifyClaudeExplicitSessionIdPreservesResumeContext` 先创建 `.claude/projects` 下会话文件，再创建带 `--session-id=...` 的 Claude Agent，要求运行时确认恢复能力且停止后保留。原失败工件位于 `.debug/link-stop-fix/trusted-final-artifacts`。

`extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts` 的 `resolveAgentResumeContext` 将 fresh Claude ID 作为未确认候选。`maybeConfirmClaudeResumeSessionId` 通过 `locateClaudeSessionId` 验证文件，再检查原旧 session 并更新恢复策略。当前 owned 执行存于 `nonNativeHostExecutions`，运行信息存于 record.business，页面 metadata 由 `projectNonNativeHostBusiness` 投影；本轮已确认入口遗漏及旧方法的身份检查不兼容 owned 记录。

## 工作计划

第一里程碑核对规格、locator、smoke seed 及两条路径，定位引入提交。第二里程碑在相同文件/会话条件下比较正常 owned 启动、显式调用原 locator，以及只补回确认入口的临时对照；保持原 ID、启动、停止与保存约束，区分正常无文件的负例。第三里程碑恢复所有临时源码，将证据和剩余正式修复范围记录到现有设计文档。

## 具体步骤

在 `/tmp/dscr` 恢复 `.debug/rca/node_modules` 与 `.debug/rca/playwright-browsers` 到根目录，使用 Node 22。日志保存在 `.debug/claude-resume-investigation`。可用命令：

    export PATH=/tmp/dsc-release-node22/node_modules/node/bin:$PATH
    DEV_SESSION_CANVAS_HOST_TEST_FILTER='RCA Claude' node scripts/test/test-host-execution-owner-wiring.mjs
    DEV_SESSION_CANVAS_EXECUTION_ASSETS_SET=/tmp/dsc-release-026-assets DEV_SESSION_CANVAS_VSCODE_EXECUTABLE=/tmp/dsc0261v/.vscode-test/vscode-linux-x64-1.141.0/code DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=local-links-and-stop npm run test:vsix-smoke

临时具名入口只调用本次调查场景，不是默认完整 gate。在基于 `523ee9a5` 的临时 checkout 中：先应用 `docs/references/smoke-reload-autostart/claude-resume-original-scenario.patch`，运行上面的 VSIX 命令，预期同环境 locator 得到 ID，但原用例 exit 1、恢复策略等待失败。再应用 `claude-resume-confirmation-control.patch`，运行相同命令，预期原用例运行期与停止后检查通过、exit 0。该同步确认补丁只用于因果对照，不是正式修复。按反向顺序 `git apply -R` 两份 patch 即可恢复。

Host 特征对照独立应用 `claude-resume-characterization.patch` 并运行上述 Host 命令，预期 2/2（临时用例总数 489）。它保留实际 locator，仅提供隔离 home 和调用计数；真实文件存在/缺失均验证，并证明旧方法只接受 legacy map 记录。复跑后反向移除 patch，不把它并入正式测试。

## 验证与验收

必须记录目标文件是否可被同环境 locator 识别、正常路径的调用/结果、原 executionId/generation、候选与已确认策略，以及最小对照后的差异。若发现旧方法检查 legacy map 使 owned 确认失效，需独立证明而非只增加调用。无匹配文件继续 none，不能直接把所有显式 ID 当作可恢复。涉及停止后的额外阻塞应单独报告。

## 幂等性与恢复

不修改真实用户会话文件；使用独有临时目录或既有 smoke 隔离目录，先保留所有旧失败工件。临时补丁应用前备份，结束检查产品与正式测试 diff 已恢复；依赖重新停放 `.debug/rca`。推送前 fetch/rebase origin/main，保持 PR 分支，不合并或发布。

## 证据与备注

已有失败摘要为 `docs/references/smoke-reload-autostart/link-stop-fix-evidence.json`，本次新增 `docs/references/smoke-reload-autostart/claude-resume-context-evidence.json`，原生日志为 `.debug/claude-resume-investigation/native-baseline.log` 与 `native-control.log`，受控日志为 `host-control.log`。原失败仍保留，不重写既有事实。

## 接口与依赖

复用现有 Claude 文件 locator、Host fixture 和 native PTY/fake Claude，不增加正式接口。判断基于 snapshot-only 模式；旧 Runtime/Supervisor 的恢复能力不能由本次结果代证。

修订记录：2026-10-10 建立调查计划，明确候选 ID 与恢复确认的区分及最小对照边界。

修订记录：2026-10-10 完成原生负例/最小接线正例及 Host 2/2 验证，收口根因、历史和正式修复边界，恢复临时源码并归档。
