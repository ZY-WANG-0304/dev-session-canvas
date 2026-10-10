# 修复 owned 启动准备失败后的节点状态

本 ExecPlan 按 `docs/PLANS.md` 持续维护。

## 目标与全局图景

CLI 缺失或执行环境准备失败后，Agent/Terminal 显示 error，手动恢复失败显示 resume-failed，清除待启动标记，保留历史正文及可信恢复身份。错误只反馈一次，取消或替换后的旧请求不能覆盖当前状态。用户可修正配置后手动重试。

## 进度

- [x] 2026-10-10：确认 PR314 分支与 origin/main 同步，读取源码和故障证据。
- [x] 2026-10-10：确认 prepare 拒绝后只清理记录，缺少业务状态投影。
- [x] 2026-10-10：补修前失败回归，实现受原记录与 metadata 绑定保护的状态投影。
- [x] 2026-10-10：运行完整 Host 487/487、类型与 smoke 检查，记录独立缺 CLI 原生通过及两轮 trusted 较早失败。
- [x] 2026-10-10：文档、证据与技术债已同步，PR 描述已准备；提交与推送由 PR314 的提交记录确认。

## 意外与发现

缺失 Claude 的原生诊断同时包含 commandResolutionFailed、startFailed、not-required 与 host/error，但节点仍 starting/pendingLaunch=start。`startNonNativeHostExecution` 的 prepare 在 business 创建前失败；catch 释放未取得资源的记录而未更新节点。

## 决策记录

- 决策：只在 prepare 自身拒绝且原记录和 metadata 仍有效、未停止时回写失败。理由：页面报告器是观察边界，准入关闭/占槽拒绝与取得资源后未知结果不能冒充准备失败。日期：2026-10-10。
- 决策：失败状态使用普通画布保存，原执行保持 not-required；保留历史正文、快照与恢复身份。理由：还没有启动进程，不能伪造退出码、输出或最终保存。日期：2026-10-10。

- 决策：prepare 拒绝同时取消未派发尺寸意图。理由：首轮原生证明重复错误来自自动尺寸同步复用 prepare 错误，尚不存在 resize 效果，不能当作 resize 故障；实际取得资源后的失败维持拒绝。日期：2026-10-10。

## 结果与复盘

修前新增 Terminal 用例确认 launching 不等于 error；修后 9 组 fresh/resume/environment/CLI 场景通过，原有两条 prepare 的不改节点断言由新状态语义替代，完整 Host 485/485 通过。随后新增两条内部原错误拒绝测试及 root remap 状态断言，定向 13/13 通过；类型、UI 本地化、正文 helper 14/14、reset fixture 19/19、runner 环境清理和语法通过。最终完整 Host 487/487 通过。最终代码默认真实 VSIX 的前六个独立阶段通过，包括缺 CLI 场景的 error、pending 清理、单次反馈、not-required 及删除；trusted 原顺序在较早的异常通知 Claude resume 再启动处遇到旧最终保存责任占槽，原工件保留；同代码不改用例复跑 trusted 又在更早的创建预设节点用例遇到 owner admission is closed；两轮均未触达 trusted 缺 CLI，本次独立修复验收完成，完整 gate 的新阻塞已登记，不再盲目复跑。

## 上下文与定向

工作目录 `/tmp/dscr`，分支 `investigate-smoke-reload-autostart` 对应 PR314。不要改原工作区或版本号。`extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts` 的 startNonNativeHostExecution 先预留执行记录，再异步 prepare（解析 CLI 和执行环境），之后才请求启动。record.persistence.metadata 是原节点 metadata 对象身份，异步完成时必须与当前节点一致。页面 reportWebviewExecutionStartFailure 仅负责诊断与提示。`scripts/test/test-host-execution-owner-wiring.mjs` 的 candidateFixture 使用真实 Host 和受控 provider。

## 工作计划

先在 Host 测试新增 Codex/Claude fresh/resume 与 Terminal 准备失败断言，验证修前失败。随后在准备错误处理处调用身份保护的状态投影，测试取消、删除、换绑及旧执行保护。增加复用缺 CLI 校验的默认具名原生场景，继续默认 trusted 流程，保留后续失败断言。

## 具体步骤

在 `/tmp/dscr` 将 `.debug/rca/node_modules` 与 `.debug/rca/playwright-browsers` 分别移回 `node_modules` 和 `.playwright-browsers`。设置 PATH=/tmp/dsc-release-node22/node_modules/node/bin:$PATH。执行：

    DEV_SESSION_CANVAS_HOST_TEST_FILTER='preparation failure|webview start' node scripts/test/test-host-execution-owner-wiring.mjs
    node scripts/test/test-host-execution-owner-wiring.mjs
    npm run typecheck
    npm run test:ui-copy-localization
    npm run test:smoke-execution-output
    DEV_SESSION_CANVAS_EXECUTION_ASSETS_SET=/tmp/dsc-release-026-assets DEV_SESSION_CANVAS_VSCODE_EXECUTABLE=/tmp/dsc0261v/.vscode-test/vscode-linux-x64-1.141.0/code npm run test:vsix-smoke

## 验证与验收

修前新用例因 starting 不等于 error 失败；修后 fresh 为 error、resume 为 resume-failed，无 live/pending，不改变已有历史或恢复身份，无 provider connect 或进程退出事件，未开始记录 not-required 且能重试。已有取消/替换/关闭/unknown 回归继续通过。真实缺 CLI 节点显示 error、页面提示一次且可删除。完整 gate 后续若有新失败，记录首次证据，不放宽断言。

## 幂等性与恢复

使用受控 fixture 与隔离 VS Code smoke 数据；运行前保存已有失败工件。依赖收尾移回停放位置，git diff --check 后提交，fetch/rebase origin/main 再更新 PR 分支。禁止合并或发布。

## 证据与备注

旧证据为 `docs/references/smoke-reload-autostart/pty-output-evidence.json`。新验证保存到 preparation-failure-evidence.json，仅提取原身份、状态与结果，不提交原始环境。

## 接口与依赖

复用 updateExecutionNode、buildExecutionMetadataPatch 与已有持久化 API，不添加协议、依赖或重试机制。页面 promise 继续被即时消费，内部 awaited 调用保持原错误拒绝。

2026-10-10：建立计划，记录源码确认的失败边界与验收要求。

2026-10-10：首轮原生前五阶段通过；新增缺 CLI 场景状态正确但重复 resize 提示，补充未派发尺寸取消方案，工件保留于 .debug/preparation-failure/first-artifacts。

2026-10-10：完成状态及尺寸取消修复；最终 Host/六个默认独立原生阶段通过。保留完整 gate 两轮早期失败及未验证边界，归档计划，推送 PR314。
