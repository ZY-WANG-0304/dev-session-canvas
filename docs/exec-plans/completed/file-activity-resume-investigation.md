# 确认文件活动 read 与手动 resume 失败的根因

本计划按 `docs/PLANS.md` 维护，覆盖 PR #314 上 `5f0d360e` 的两项失败调查，不混入正式产品修复。

## 目标与全局图景

解释两个已观察的停点，并区分产品接线遗漏、测试适配问题与生命周期问题：文件活动两项 Agent 已启动后，首 read 未出现文件引用；snapshot-only 模拟 reload 后手动 resume 提示缺失 Codex session ID。结论必须同时具有源码因果链和受控验证，不把重跑偶然通过当成根因证据。

## 进度

- [x] (2026-10-11) 确认 PR 工作树干净、基线为 5f0d360e，读取既有失败工件和调用链。
- [x] (2026-10-11) 文件原身份输出包含 read 回执；只读探针无 fileActivity 参数/env/绑定，控制实验接通正式 collector 后原 read 引用断言通过。
- [x] (2026-10-11) 停止提示把 fake-provider+storagePath 替换为 codex-session-id；resolver 因缺 storagePath 返回 none，builder 报缺 ID。真实 Codex 命令同 metadata 对照仍可生成 resume 参数。
- [x] (2026-10-11) 四组原生对照完成；file control 首 read 通过，resume control 原函数全部通过；既有命令选择测试2/2通过。
- [x] (2026-10-11) 同步设计、技术债和精简证据，随本次调查提交推进 PR314。

## 意外与发现

当前源码的 owned Agent 启动分支提前返回，尚未经过旧路径的 fileActivitySession 创建和绑定。fake provider 的恢复上下文要求 sessionId 和 storagePath 同时存在；原错误 snapshot 有 sessionId，但未见 storagePath。文件活动接线遗漏已由原生探针与控制验证；恢复探针已捕获字段丢失及 resolver/builder 完整链路，保留 fake 上下文的控制完整通过原恢复函数。

## 决策记录

2026-10-11：保留产品源码与正式 smoke，使用隔离 packaged 副本进行只读探针和单变量对照。只对调查脚本、证据和文档提交；控制补丁如需应用到隔离包，必须标为实验并记录 hash 差异，不能声称正式修复验收。

## 结果与复盘

已确认文件活动是 owned 产品接线遗漏，resume 是 fake 恢复适配信息覆盖。正式实现未改；控制补丁不是正式修复，后续修复责任边界已登记。现有工件见 `docs/references/smoke-reload-autostart/file-activity-start-fix-evidence.json`。既有 gate 七项通过而 trusted 失败，文件活动专项也失败，不重复声明完整门禁通过。

## 上下文与定向

工作树 `/tmp/dscr`，分支 investigate-smoke-reload-autostart；用户原工作区有其他工作，不修改。`CanvasPanelManager.ts::startAgentSession` 负责启动参数，`startNonNativeHostExecution` 负责 owned 本地执行。`agentFileActivity.ts` 为 fake provider 注入 NDJSON 事件文件环境变量，为 Claude 注入 PostToolUse settings 和事件文件；监听结果经 bindAgentFileActivitySession 进入引用状态。恢复上下文由 resolveAgentResumeContext 构造，停止输出可能经 readAgentResumeContextFromOutput 更新。

`tests/vscode-smoke/extension-tests.cjs` 的 verifyFileActivityViewsAndOpenFiles 首次 read 等待位于 3812，verifyRuntimeReloadRecovery 手动 resume 等待位于 8938。前一轮原工件位于 `.debug/file-activity-start-fix/file-activity-1791652134021/runtime/artifacts/result.json` 与 `.debug/file-activity-start-fix/trusted-artifacts/`。前者 result.failure.message 内含 finally 清理之前的超时 snapshot；不能用 finally 恢复后的 after.state 推断失败现场。

## 工作计划

第一里程碑从既有诊断和原身份 Host 输出证实 read 是否到达 provider，核查启动环境与 fileActivitySession 的创建/绑定分支。第二里程碑比较启动、停止尾部、reload 后与 resume 参数的恢复上下文，判定字段丢失位置。第三里程碑在相同产品包上做原生复现和可回退对照，保留失败、只读探针与实验控制结果，给出正式修复应覆盖的责任边界。

## 具体步骤

恢复 `.debug/rca/node_modules` 与 `.debug/rca/playwright-browsers` 至根链接，使用 `/tmp/dsc-release-node22/node_modules/node/bin` 的 Node22、VS Code `/tmp/dsc0261n/.vscode-test/vscode-linux-x64-1.141.0/code` 和资产 `/tmp/dsc-release-026-assets`。隔离入口基于 `file-activity-start-verification.mjs`，输出到 `.debug/file-activity-resume-investigation/`。执行 `xvfb-run -a node docs/references/smoke-reload-autostart/file-activity-resume-investigation.mjs <mode>`，由脚本明示每种场景和预期。收口前恢复依赖停放、运行语法/diff 检查并 fetch/rebase origin/main 后推送。

## 验证与验收

文件活动需展示同一原执行已确认 read 输出、事件注入或绑定缺口，并以仅接通缺失通道的控制实验验证原 read 引用谓词。恢复需展示停止前后 sessionId/storagePath/strategy 的变化、实际 resolveAgentResumeContext 结果以及为何触发 buildAgentLaunchSpec 的缺 sessionId 异常；若仅 fake harness 可达，明确不泛化到真实 Codex。各实验结束清理自己的执行并记录退出结果。

## 幂等性与恢复

所有运行使用独立 user-data 和隔离包，不覆盖正式产品 bundle。临时补丁仅在独立副本，清理本轮执行，不操作其他工作树的 provider/Supervisor。正式源码保持不变。

## 证据与备注

精简证据提交 references，原大工件留在 .debug。调查 exit0 表示完成捕获，不等于失败用例通过。完整 gate 本轮无必要重复运行。

## 接口与依赖

复用已有原执行 started/output helper、debug snapshot、实际 file activity collector 和 resume 解析函数；不新增产品 API、依赖或公开协议。

修订：2026-10-11，建立两项根因确认计划及验证边界。

修订：2026-10-11，文件活动双对照 exit0（probe 的原场景失败、control 的 read 前缀通过），均清理至零执行。resume 两组同样增加原 burst 输出屏障，确保 fake provider 已安装 INT trap，再比较恢复上下文，避免仅靠时间等待。

修订：2026-10-11，四轮调查和2项既有回归完成，归档根因与正式修复边界。
