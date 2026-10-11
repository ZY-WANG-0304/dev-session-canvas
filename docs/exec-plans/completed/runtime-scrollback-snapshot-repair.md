# 修正 Runtime 滚动历史分页断言

本计划按 `docs/PLANS.md` 持续维护，目标是在 PR314 修复正式 smoke 的旧内联快照断言。

## 目标与全局图景

RuntimePersistence 开启时，Terminal 将 scrollback 从 80 调至 240，输出 220 行后 reload，应该重新附着原会话并保留完整历史。当前页面首末行验证通过，但测试等待已不再发送的 terminalStream 字段而超时。修复后正式测试应从 terminalRead 描述符和 executionTerminalPage 分块还原真实终端，验证所有行、原身份和修订号。

## 进度

- [x] (2026-10-10) 已复核根因和所有 smoke staging 入口。
- [x] (2026-10-10) 实现分页观察 helper、正式断言和六组回归测试；runner 环境回归通过。
- [x] (2026-10-10) 原生专项完整原函数通过：四块 24874 字符、220 行、scrollback 240、checkpoint/head/applied revision 15。
- [x] (2026-10-10) 默认 VSIX 七个独立阶段通过，trusted 本条及后续三个场景通过；恢复退出摘要为 Session ended.，期待含 23，作为新问题登记。
- [x] (2026-10-10) 同步设计、索引、原则、证据及技术债，归档计划。
- [x] (2026-10-10) 完成本轮交付内容及 PR314 描述准备；远端推送结果由最终回执确认。

## 意外与发现

重复请求会复用原 readId；清空测试消息不会使 Webview 重放 bootstrap。currentState 是压缩终端模型 JSON，不能作为 ANSI 文本匹配。

## 决策记录

2026-10-10：保留清空前的消息，与新响应的精确 reader 和生命周期关联。使用正式 codec 和真实 headless xterm，不复制解码器。通过 `stageSmokeTestSuite` 将新 helper 及其依赖打包到独立测试目录，避免依赖开发机绝对路径或改动产品 bundle。所有正式入口共用该 staging。

## 结果与复盘

当前修复已通过原生专项、helper/runner 回归及 trusted 原流程；没有产品代码变化。默认七个独立阶段通过，trusted 继续通过完成态排空、重连失败绑定及陈旧恢复意图保护，在 verifyLiveRuntimeResumeExitClassification:10666 遇到摘要与测试正则不一致，status=error/lastExitCode=23 正确。根因未定位，完整 gate 未通过。隔离节点均非 live，无本轮 Supervisor 残留；后续矩阵登记于技术债。

## 上下文与定向

`tests/vscode-smoke/extension-tests.cjs` 的 `verifyLiveRuntimeReloadPreservesUpdatedTerminalScrollbackHistory` 是原场景。`terminalRead` 描述符标明会话、权威身份、读者、checkpoint 修订和当前态长度；`host/executionTerminalPage` 提供分块及连续事件。`extensions/vscode/dev-session-canvas/src/common/terminalCurrentState.ts` 是正式 codec；`scripts/smoke/vscode-smoke-runner.mjs` 负责复制、打包测试到宿主目录。

## 工作计划

第一里程碑新增分页观察 helper，检查外层 node/kind/session、reader/authority 和页面 lifecycle，连续拼接当前态并校验后缀修订。用正式 codec 导入真实终端，顺序应用 output/resize/scrollback 事件，断言 220 行精确且唯一。缺数据等待，错误数据立即失败。单元回归覆盖污染身份、丢块、乱序和重复/不连续事件。

第二里程碑运行保留原函数的独立 VS Code 场景，再运行默认八阶段 VSIX smoke；不得包装旧超时为成功。记录真实结果及资源清理。最后同步正式结论与 PR 描述。

## 具体步骤

在 `/tmp/dscr`、Node 22 和已安装依赖下运行 `node scripts/test/test-smoke-terminal-history.mjs`、`node scripts/test/test-vscode-smoke-runner-env.mjs` 和 `npm run test:vsix-smoke`。原生测试指定 `DEV_SESSION_CANVAS_VSCODE_EXECUTABLE=/tmp/dsc0261n/.vscode-test/vscode-linux-x64-1.141.0/code`、`DEV_SESSION_CANVAS_EXECUTION_ASSETS_SET=/tmp/dsc-release-026-assets`。专项脚本和精简证据存于 `docs/references/smoke-reload-autostart/`。

## 验证与验收

helper 测试必须证明完整分页正确恢复、错误身份不能贡献正文、缺失/冲突/不连续数据不能成功。原生专项必须完整执行原函数直到正常停止并恢复配置。默认 smoke 若遇后续失败，保存工件及失败断言，不把当前修复等同发布就绪。

## 幂等性与恢复

测试使用隔离宿主和数据目录，可重跑。结束停止本轮原 session 并确认 Supervisor 退出。只修改本分支；推送前 fetch/rebase origin/main，不动原工作区发布材料。

## 证据与备注

基线 HEAD 为 295361701a4ea8a245ef0e6120f7ec60e11cd824。先前定位已证明 220 行完整，见 `runtime-scrollback-snapshot-evidence.json`；该定位的 exit 0 不作为本轮修复验收。

本轮证据：`docs/references/smoke-reload-autostart/runtime-scrollback-snapshot-fix-evidence.json`；原生复验 `xvfb-run -a node docs/references/smoke-reload-autostart/runtime-scrollback-snapshot-verification.mjs`。默认门禁日志与失败工件保存在 `.debug/runtime-scrollback-snapshot-fix/`。
