# 接回 owned Claude 会话文件确认

本 ExecPlan 按 `docs/PLANS.md` 维护。工作目录 `/tmp/dscr`，PR #314 分支 `investigate-smoke-reload-autostart`，基线 `2b700438`。已定位 snapshot-only owned 路径遗漏文件确认，本轮交付正式修复及回归。

## 目标与全局图景

关闭 RuntimePersistence 时，Claude 的候选 session ID 在会话文件存在后成为可恢复上下文，并在停止后保留。文件尚不存在时不伪造恢复能力，查询期间原执行的输出、输入和停止继续工作，迟到结果不能覆盖新执行或已结束状态。

## 进度

- [x] (2026-10-10) 核对当前分支、既有根因及恢复确认契约。
- [x] (2026-10-10) 接回启动和 waiting-input 文件确认，绑定原执行并合并重复查询；扫描失败也保留已排队补查。
- [x] (2026-10-10) 新增 17 项 Host 回归通过，含实际文件、显式/自动候选和迟到保护；原产品源码下新正例失败。
- [x] (2026-10-10) 完整 Host 504/504 与类型检查通过。
- [x] (2026-10-10) 默认 VSIX 七个独立阶段通过；原 Claude 用例在独立阶段与 trusted 均通过，后续 Runtime 开启时的 root 准备/提交失败已单列。
- [x] (2026-10-10) 同步正式文档和精简证据，登记新 Runtime 阻塞后归档；本次 PR314 更新承载提交。

## 意外与发现

旧确认方法只认 legacy session map，不能直接调用。原执行 metadata 会随正常输出投影更新，因此异步查询不能固化旧 metadata 对象；应检查当前 metadata 仍等于原 record.persistence 的有效绑定。启动扫描与等待输入扫描可能重叠，须保持有界且不能丢失后续确认机会；实现在 miss 与 error 后均保留合并补查。最终原生已越过原 Claude 阻塞，下一独立失败为开启 Runtime 后 root 准备/提交未完成，非本轮文件确认等待。

## 决策记录

- 决策：在原 owned business 保存一次进行中的确认任务和一个合并后的再次查询意图。理由：查询脱离启动/正文 promise，不阻塞原执行；等待输入期间的补查不因启动查询未完成而丢失。日期/作者：2026-10-10 / Codex。
- 决策：本轮只修已确认的 Claude 候选文件确认，保留 Codex、旧 session 与 Runtime 路径。理由：已定位入口和验收范围明确，不借此扩展其他恢复策略。日期/作者：2026-10-10 / Codex。

## 结果与复盘

正式异步文件确认与 17 项新增回归已完成，完整 Host 504/504、类型检查通过。默认 VSIX 七阶段与 trusted 原 Claude 运行期/停止后检查均通过；后续 verifyLiveRuntimePersistence 首次启动失败，具体 root 准备/提交原因尚未定位并已登记，完整 gate 仍未通过。

## 上下文与定向

`extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts::startNonNativeHostExecution` 建立原 owned 记录，其 business.agentResume 起初为候选。`scheduleNonNativeAgentActivity` 将提示识别为 waiting-input。新增 owned Claude 确认方法应复用 `common/codexSessionIdLocator.ts::locateClaudeSessionId`，使用原 launchSpec.cwd，通过 `projectNonNativeHostBusiness` 投影并请求普通状态保存；它不改变最终保存责任。

`scripts/test/test-host-execution-owner-wiring.mjs` 可加载真实 Host 类，以受控 transport 和 locator 边界验证并发顺序。`tests/vscode-smoke/extension-tests.cjs::verifyClaudeExplicitSessionIdPreservesResumeContext` 预置真实隔离文件并检查运行期和停止后的策略/ID；加入 local-links-and-stop 具名阶段，同时保留 trusted 原顺序。

## 工作计划

第一里程碑先记录正式方案，增加确认入口与异步原记录校验。第二里程碑通过新 Host 测试证明文件确认、自动/显式候选、无文件、再次等待输入、并发输出/停止、替换/删除、最终保存和查询失败的行为。第三里程碑运行原生默认 VSIX 验证，保存真实剩余阻塞并完成文档交付。

## 具体步骤

从 `.debug/rca` 恢复 node_modules 与 playwright-browsers 到根目录，使用 Node 22：

    export PATH=/tmp/dsc-release-node22/node_modules/node/bin:$PATH
    DEV_SESSION_CANVAS_HOST_TEST_FILTER='owned Claude file' node scripts/test/test-host-execution-owner-wiring.mjs
    node scripts/test/test-host-execution-owner-wiring.mjs
    npm run typecheck
    DEV_SESSION_CANVAS_EXECUTION_ASSETS_SET=/tmp/dsc-release-026-assets DEV_SESSION_CANVAS_VSCODE_EXECUTABLE=/tmp/dsc0261v/.vscode-test/vscode-linux-x64-1.141.0/code npm run test:vsix-smoke

日志写入 `.debug/claude-resume-fix`；运行前保留既有失败现场。反向验证只临时恢复产品文件到本轮基线，再运行新正例，预期失败，随后恢复正式实现。

## 验证与验收

新正例必须在原实现失败，修后能将原 session ID 升级并保存。负例须无文件不升级，停止/进程结束/最终保存、替换、删除、候选变化及 metadata 失配后不投影；确认已成功后停止仍保留。查询等待不阻塞 started、正文消费和停止；重复触发最多一个查询进行且保留一个补查。原生原用例保留全部策略/ID和删除检查。

## 幂等性与恢复

仅使用受控或 smoke 隔离 home，不接触用户会话文件。验证临时改动均精确恢复，结束停放依赖。推送前 fetch/rebase origin/main，保留无关工作，不合并或发布。

## 证据与备注

定位证据为 `docs/references/smoke-reload-autostart/claude-resume-context-evidence.json`。本轮精简证据为 `docs/references/smoke-reload-autostart/claude-file-confirmation-fix-evidence.json`。日志在 `.debug/claude-resume-fix`，原失败保存在 `trusted-artifacts`；证据区分七个独立阶段通过与完整默认命令 exit 1。

## 接口与依赖

不增加产品配置或外部接口。复用现有 locator 与 owned 原记录、状态投影、普通持久化接口；查询失败只记诊断并保留未确认状态。

修订记录：2026-10-10 创建，明确异步确认、原身份保护与正式回归范围。

修订记录：2026-10-10 实现异步确认并完成 17 项新增、完整 Host 504/504、类型检查与修前反例；默认 VSIX 验证进行中。

修订记录：2026-10-10 完成正式修复、原生原用例验证和新 Runtime 阻塞登记后归档；完整 gate 未通过。
