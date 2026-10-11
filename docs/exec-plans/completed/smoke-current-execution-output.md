# 按当前执行的终端输出修正 smoke 断言

本计划按 `docs/PLANS.md` 维护，承接 PR #314 的画布身份修复。用户于 2026-10-10 授权继续修正 burst 及同类测试。

## 目标与全局图景

Agent 收到 burst 等命令并已向页面交付输出时，smoke 应核对该执行的真实正文和生命周期，不能轮询历史 metadata 而超时。旧执行、其他节点或断开的输出片段不能拼成成功证据。在 PR #314 原分支完成修复和验证，不修改原发布工作树或执行发布。

## 进度

- [x] 复核已推送 head、工作流和完整 smoke 原失败证据；最新 origin/main 未变化。
- [x] 增加绑定执行身份的测试正文读取方法，14 项正反例通过。
- [x] 四条 Agent 命令输出和状态在真实 VSIX 中通过；同步 Terminal 的同类正文来源、当前退出结果及原执行退休检查。
- [x] 独立默认 local-execution-flow 在真实 VSIX 中通过全部 Agent/Terminal 断言；owned-canvas-reconciliation 同样通过。
- [x] 完整 trusted 两次捕获独立的原生 resize 准入错误，保留首次工件和空 toast 断言；精确触发时序另列技术债。
- [x] 同步正式设计、精简证据与技术债，形成同一 PR #314 的更新。

## 意外与发现

`verifyAgentExecutionFlow` 的 burst、hello、sleep、slowspin 四处都轮询 metadata.recentOutput；当前原生执行只在最终保存时更新该历史正文。失败工件里同 executionId 的 `host/executionSnapshot` 已有 burst marker，节点仍 live/waiting-input，没有绑定拒绝。其他 smoke 也有此类字段读取，但最终保存/恢复测试仍需要验证真实 metadata，不能全局改写 snapshot 掩盖区别。

同组首次后续失败是退出摘要从旧后端的 Codex session ended 改为原生的 Session ended with exit code 0；测试改为校验真实退出码、无输出不完整错误、summary/lastExitMessage 一致。重复启动同时验证原身份不变、无新 started 及明确占用拒绝。第二次完整运行在更早的 verifyRealWebviewProbe 遇到页面残留 resize 准入错误，首次工件保留；增加默认 local-execution-flow 独立场景验证本次受影响完整执行流，默认入口仍执行 trusted，不用过滤结果覆盖完整失败。

独立执行流还复现重复启动没有 host/error：Agent/Terminal 入口只查旧 session map，原生 map 的同 key 拒绝以未处理 Promise 抛出。为保留原测试的正常拒绝要求，窄修运行中原生执行的前置检查，并补 Agent/Terminal 原身份不变、无新 provider/started、不抛未处理异常的回归；不将失败/未知/最终保存待确认记录认作可以重新启动。

本地完整执行流随后到达停止后 resize：旧断言要求把最终 metadata 尺寸改成 100×30，但现有 completed-snapshot 契约要求保存原始序列化尺寸，页面独立 reflow。改为验证原保存尺寸及正文均不变，既有 `test-completed-snapshot-resize-integrity.mjs` 是对应受控验证。

## 决策记录

从当前 debug snapshot 捕获本地 executionId/generation，正文只接受同 kind/nodeId/executionSessionId 的 `host/executionOutput` 或 `host/executionSnapshot`。输出片段只按连续序号拼接；每个快照独立检查，不与之前片段拼接。等待前后检查原执行仍然对应当前节点，保留状态和退出断言。测试 helper 不请求重新执行命令，不修改产品正文投影或 debug state。后续出现独立产品行为失败时保留首次证据，不放宽断言追绿。

## 结果与复盘

已完成四条 Agent 命令和 Terminal 当前输出校验，修复正常原生执行的重复启动拒绝，保留退出/最终保存与不可变快照尺寸断言。14/14 正反例、356/356 Host 和 16/16 completed-snapshot resize 回归通过。真实 VSIX 的 local-execution-flow 与原 owned reconciliation 场景通过；完整 trusted 因页面残留原生 resize 准入错误失败，精确发生于启动/停止/源关闭的时序尚待定位；不得将最终停止状态反推为 stop 根因。

## 上下文与定向

`tests/vscode-smoke/extension-tests.cjs` 包含真实 VS Code smoke。`tests/vscode-smoke/execution-output.cjs` 将承载正文证据匹配，`scripts/test/test-smoke-execution-output.mjs` 用确定性消息验证正反例。`scripts/smoke/run-vscode-vsix-smoke.mjs` 打包实际产品并运行 owned reconciliation、local execution flow 和 trusted 场景。记录结果到现有正式设计 `docs/design-docs/smoke-reload-autostart-investigation.md` 与技术债。

## 工作计划与里程碑

第一里程碑用真实协议消息样例证明正文读取能够匹配快照和分段正文，拒绝缺身份、旧身份、其他节点、序号缺口。第二里程碑替换四处 Agent 实时正文断言，并保持输入后 running、等待输入及退出状态验证。第三里程碑运行完整 VSIX，按第一现场处理已授权的同类测试适配；独立产品失败单独记录，不改用户要求为泛化产品修复。

## 具体步骤

工作目录 `/tmp/dscr`，复用 Node 22.23.3、Linux 原生资产、VS Code 1.141.0 和独立测试 profile。日志放 `.debug/pr314-output/`。

    export PATH=/tmp/dsc-release-node22/node_modules/node/bin:$PATH
    export DEV_SESSION_CANVAS_EXECUTION_ASSETS_SET=/tmp/dsc-release-026-assets
    export DEV_SESSION_CANVAS_VSCODE_EXECUTABLE=/tmp/dsc0261v/.vscode-test/vscode-linux-x64-1.141.0/code
    node scripts/test/test-smoke-execution-output.mjs
    npm run test:vsix-smoke

## 验证与验收

四条命令的输出和 lifecycle 都按同执行验收；正反例验证不能借用历史 metadata 或其他执行。完整 VSIX 明确报告首个真实失败或完整成功，过滤执行结果不能替代完整门禁。每次仅因代码变化或新失败重跑受影响验证。

## 幂等性与恢复

保持专用 worktree，原失败工件不覆盖入库证据；运行独立 profile。禁止修改生产输出字段来迎合旧测试，禁止在 debug snapshot 注入伪实时正文。命令只发送一次，等待只读已交付消息。

## 证据与备注

上一轮失败见 `docs/references/smoke-reload-autostart/repair-evidence.json`；本轮实际验证完成后同步后续结果，不追改历史失败事实。

## 接口与依赖

只使用现有消息协议、Node assert 与现有 smoke 命令，不添加产品依赖。正文匹配方法接收消息数组、明确执行身份及期望字符串；测试调用方负责捕获原执行和验证生命周期。

修订记录：2026-10-10，用户明确授权修正测试，建立当前正文匹配和完整 smoke 验证计划。

修订记录：最终回收默认 VSIX 各阶段、356 项 Host 与 16 项快照尺寸验证，明确旧 burst 已修正、独立 resize 首次错误仍保留且时序待定位；按证据将正常重复启动入口缺口窄修，不放宽测试。
