# 定位 localhost SSH 重开时旧远端 Host 未退出的原因

本 ExecPlan 按 `docs/PLANS.md` 持续维护。它覆盖调查与可评审的修复提案，不授权正式修复；用户明确要求“新建分支，先定位根因，让我确认后再进行修复”。

## 目标与全局图景

0.26.1 发布验证在 localhost SSH 真实窗口重开失败。要区分扩展恢复故障与测试没有制造出预期的“旧 Host 已离线”条件，让用户能依据进程与消息证据决定修复范围。交付调查结论、可重现取证步骤和具体提案，确认前保持产品与正式测试不变。

## 进度

- [x] (2026-10-13) 获取最新 origin/main `ea0c9b194fda1f13098cfd7ad4a3e13c4ec5233b`，在 `/tmp/dscsshdiag` 建立 `investigate-remote-host-exit`。
- [x] (2026-10-13) 保留发布首败和同 main 成功对照，确认失败时 Canvas ready，第三终端仍 live。
- [x] (2026-10-13) 对照上游退出实现与两次运行的消息时序，确认原测试结束会等待 disconnect，但该等待不确认远端进程消失。
- [x] (2026-10-13) R1 原版具名 SSH 场景通过；Host 1069217 的 startTicks=248841043，收到 terminate 后在 verify 启动前消失。
- [x] (2026-10-13) R2日志自然复现35秒失败，旧 Host原身份持续S/R；R3落盘退出日志通过，drain 返回尚有3条未确认消息。
- [x] (2026-10-13) C1抑制退出消息确认旧Host保留，但先在ready45秒失败；C2只杀旧Host后诊断误判zombie，未进入verify。
- [x] (2026-10-13) C3在消息缺失条件只结束旧Host2006731/startTicks248934378后，原两阶段完整通过，Supervisor与执行会话保留。
- [x] (2026-10-13) 完成结论边界与修复提案，证据repo-local，正式299份测试/脚本及缓存原件hash未变。
- [x] (2026-10-13) 调查文档与证据收口，停在用户确认边界；正式修复不属于本设计阶段交付。

## 意外与发现

失败运行的本地 Electron 已退出，但远端 setup Host 后续仍有 TreeView 日志。成功对照明确记录 renderer terminate 和远端 Host exit。两者均配置三小时重连保留；保留时间本身不能解释为何只有首败没有 terminate。

原首败没有超时当下的 `/proc` 样本，不能排除 PID 重用或僵尸状态。R2在清理前记录PID1305563、startTicks248872585和S/R状态，确认本次为原Host持续运行。第三终端运行 `while kill -0 <setup Host PID>; do sleep 0.1; done`，只有旧 Host PID 不存在才输出完成标记。

## 决策记录

决定先观察原测试，再按证据选择隔离的上游诊断或控制实验。任何临时改动都限定在实验副本并记录输入哈希，不修改本仓库正式行为、断言或超时。日期：2026-10-13。

决定将直接测试前提缺失与上游消息具体丢失层分开记账。R3在unacked=3时也成功，不能把未确认计数本身说成丢消息根因。C1、C2的其他失败不替代R2原35秒断言证据。日期：2026-10-13。

## 结果与复盘

已完成原版正对照、自然失败取证和上游调用链核对，形成待用户确认的具体测试生命周期修复提案。原版 R1 通过不解释历史首败；测试结束等待发送排空不等于确认远端 Host 已退出。直接根因为未建立旧远端Host已退出这一测试前提。正常消息缺失时只结束原Host能保持所有正式恢复/完成语义。具体上游丢失层仍未确认，不能称为某条VS Code源码已确认唯一缺陷。

## 上下文与定向

`scripts/smoke/run-vscode-smoke.mjs` 的 `runRemoteSSHRealReopenScenario` 用独立 loopback SSH 服务启动 setup 和 verify 两个本地窗口，中间等待三秒，最后清理私有远端服务器。`tests/vscode-smoke/real-reopen-tests.cjs` 在远端扩展 Host 内执行；Host 是运行扩展代码的 Node 进程，不等于本地窗口或独立 Supervisor。Supervisor 是持有 PTY 与执行会话的后台进程。第三终端等待 setup Host PID 消失，再退出；verify 要求它已完成且历史丢弃，而 Agent 和第二终端仍按原会话恢复。

发布首败工件在 `/tmp/d261r/source/remote-ssh-real-reopen`，成功对照在 `/tmp/dmr13/source/remote-ssh-real-reopen`。首败 setup Host 2613433、verify Host 2632892；成功 setup Host 2714632。原首败输入预合并 SHA `eba53a28074cbcc49958f7845ebe5b04411a531a`；产品和测试与 main 相同，仅发布 manifest 版本和物料不同。

## 工作计划

先在 `docs/design-docs/remote-host-exit-investigation.md` 登记未知项。对照本地 renderer/main 和远端 Host/server 的退出日志，读取固定 VS Code 1.141.0 commit `2a59476c9bfcb90b3ddc372c36762471b7dfad1c` 的测试结束与远端 stop 实现。独立观察器只读取进程身份、状态与限定日志，不导出环境或 SSH 密钥。原测试成功时仍记录结果；只有证据指导下才加入临时诊断，不能盲目无限重复。

在 `docs/references/remote-host-exit-investigation/` 保存经过筛选的证据和脚本。设计文档明确直接失败条件、上游调用链、因果实验、未知边界及候选修复。若确认是测试前提不成立，提案必须保留原会话、真实 Host 离线和完成终端语义，不能跳过断言或杀会话换取通过。

## 具体步骤

工作目录为 `/tmp/dscsshdiag`。依赖和原生资源采用同一 Node 22 环境；复现只运行 SSH 具名场景：

    PATH=/tmp/dsc-release-node22/node_modules/node/bin:$PATH npm ci
    PATH=/tmp/dsc-release-node22/node_modules/node/bin:$PATH DEV_SESSION_CANVAS_EXECUTION_ASSETS_SET=/tmp/dsc-release-026-assets npm run build
    PATH=/tmp/dsc-release-node22/node_modules/node/bin:$PATH DEV_SESSION_CANVAS_EXECUTION_ASSETS_SET=/tmp/dsc-release-026-assets npm run build:notifier
    PATH=/tmp/dsc-release-node22/node_modules/node/bin:$PATH DEV_SESSION_CANVAS_VSCODE_TEST_CACHE_PATH=/tmp/dsc0261v/.vscode-test DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=remote-ssh-real-reopen DEV_SESSION_CANVAS_SMOKE_DEBUG_ROOT=/tmp/dscsshdiag-r1 node scripts/smoke/run-vscode-smoke.mjs

运行前验证 debug root 环境变量实际名称并使用新私有路径。外部观察器在命令开始前启动，记录 Host PID 的 `/proc/<pid>/stat` 中 state、ppid、starttime 和存活区间；场景结束后停止观察器。需要诊断上游时复制对应运行文件到独立副本、记录哈希及诊断 diff，恢复后确认正式输入未变。

## 验证与验收

调查验收要求退出时序能关联同一 setup Host 身份，区分 renderer 是否发送 terminate、服务端是否收到及 Host 是否实际退出。至少一个有根据的对照支持因果链；只有日志相关性时明确限制。第三终端仍 live 的失败与已完成状态必须独立记录。最终 `git diff` 只含调查文档和参考证据；修复提案写清未来实现落点与正反例验证。具名场景结果不代表完整发布门禁通过。

## 幂等性与恢复

不覆盖历史运行，每次使用新 debug root 和专属观察器。fixture.dispose 只清理本次私有资源；先采样再清理。临时实验与缓存原件隔离，不触碰旧 worktree；重复运行需要先判断新增证据价值。正式修复须等用户确认。

## 证据与备注

首败：11:21:40 本地退出；11:21:50 旧远端 Host 仍刷新树；11:22:10 服务端进入三小时重连等待；verify 35 秒断言失败。成功对照：10:26:01 收到 renderer terminate，10:26:03 确认退出，10:26:08 新 Host 启动。以上日志为 Asia/Shanghai，转换 UTC 时减八小时。

## 接口与依赖

调查使用现有 SSH fixture、smoke runner、Linux `/proc`、Node 22 和固定 VS Code 缓存。不会新增正式 API、依赖或超时策略。用户确认后的修复另行维护实现与验收计划。

修订记录：2026-10-13 建立调查计划，先记录首败、授权边界与取证步骤。

修订记录：2026-10-13 补充 R1 真实进程正对照；R2 用独立副本采集阶段日志，记录待验证的消息递送边界。

修订记录：2026-10-13 补齐R2自然失败、R3消息排空边界及C1/C2诊断限制；C3已完成Host-only离线动作，结果待收口。

修订记录：2026-10-13 C3原断言完整通过，收口测试前提根因与具体Host-only修复提案；保留上游丢失层、C1 ready与C2诊断失败的未知边界。

修订记录：2026-10-13 完成设计阶段、移入completed并登记发布阻塞及上游未知层；独立缓存恢复，六个私有fixture零进程残留。正式实现等用户确认。
