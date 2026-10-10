# 定位 trusted 汇总诊断断言失败

本计划按 `docs/PLANS.md` 持续维护。

## 目标与全局图景

定位 PR #314 基线 `6f04e745` 的 `verifyTrustedDiagnostics` 为何找不到 Agent `execution/exited`，区分进程未退出、诊断路径差异和历史事件丢失。本轮只定位，不修改产品或正式 smoke。

## 进度

- [x] 核对失败工件与原始断言，发现集合为最近 2000 条，末轮本地执行已有最终保存与读者结算。
- [x] 追踪旧 PTY、本地 owned 和 Runtime 的退出诊断路径及引入历史。
- [x] 原生隔离验证，确认有界集合未满时的退出事实与诊断事件。
- [x] 同步根因、证据及技术债，归档调查。

## 意外与发现

原始失败集合只覆盖末尾约九秒，不能作为全流程事件全集。`execution/exited` 的两个源码记录点均属于旧 PTY finalize，owned 和 Runtime 完成路径不经过它们。原函数八项谓词中的第 4、6、7 项均不满足；live snapshot 也绕过旧记录点。

## 决策记录

2026-10-11：先复用上一轮保存的原始工件，再使用相同产品 bundle 的隔离测试入口。保持正式断言与产品不变，分别观察进程结果、保存责任及诊断；不以扩大缓存或删断言作为定位手段。

## 结果与复盘

已确认旧 PTY 专属诊断断言与当前 owned 路径不匹配，并且末尾汇总依赖易失的 2000 条缓存。原生 exit27 结果、页面退出、最终保存和读者结算均成立；59 条事件无旧 exited，原边界后 95 条事件时原断言仍失败。正式产品和 smoke 未改，修复登记技术债。

## 上下文与定向

工作树 `/tmp/dscr`，分支 `investigate-smoke-reload-autostart`。`tests/vscode-smoke/extension-tests.cjs::runTrustedSmoke` 在多个 Runtime 用例及 snapshot-only Host boundary 用例后调用 `verifyTrustedDiagnostics`。`extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts` 维护仅保留 2000 条的诊断数组，旧 PTY finalize、本地 owned 结算、Supervisor 回调是不同路径。

## 工作计划

第一里程碑对照失败集合、源码记录点和历史，解释断言数据来源。第二里程碑在未满的独立集合内执行真实退出，并调用原断言捕获失败，排除仅因缓存淘汰的解释。第三里程碑记录修复边界与尚未验证范围。

## 具体步骤

在 `/tmp/dscr` 读取 `.debug/local-host-boundary-start-fix/trusted-artifacts/`。使用 Node22 `/tmp/dsc-release-node22/node_modules/node/bin/node`、VS Code `/tmp/dsc0261n/.vscode-test/vscode-linux-x64-1.141.0/code` 和资源集 `/tmp/dsc-release-026-assets`，复制 `.debug/vscode-vsix-smoke/smoke-host` 为独立目录，通过 `scripts/smoke/vscode-smoke-runner.mjs` 与 xvfb 运行调查入口。依赖链接按需从 `.debug/rca/` 恢复。

## 验证与验收

保留原始断言及运行结果，关联同一 executionSessionId 的退出消息、节点结果与最终保存。记录事件总数、实际种类、产品 hash，明确调查脚本捕获失败不等于 gate 通过。仅凭源码缺少记录点不推导未退出。

## 幂等性与恢复

每次使用独立运行目录，仅清理本轮节点并退出 VS Code；归还依赖链接。不修改原用户工作树或其它运行中的 Supervisor。

## 证据与备注

原始失败集合共 2000 条，无 execution/exited，有四项 execution/localFinalPersistence，末次 reload 后无 live 节点。

## 接口与依赖

不新增正式接口。调查脚本与精简证据放入 `docs/references/smoke-reload-autostart/`，结论更新已有设计文档和技术债。

初稿：固定诊断路径、保留范围与原生验证三项调查边界。

完成修订（2026-10-11）：原生隔离实验 exit0（已捕获预期断言失败），脚本语法及 diff 检查通过。复跑命令为 `xvfb-run -a node docs/references/smoke-reload-autostart/trusted-diagnostics-investigation.mjs`，需设置上述 VS Code 路径和资源集环境变量。证据为 `docs/references/smoke-reload-autostart/trusted-diagnostics-evidence.json`；正式 smoke hash 与前轮相同，三个产品 bundle hash 均与前轮一致。最终 Agent resume-ready、Terminal interrupted，无 live 节点，原生进程退出并归还依赖链接。没有重跑完整 gate，也未验证真实新 Host、跨平台或真实 provider 服务。
