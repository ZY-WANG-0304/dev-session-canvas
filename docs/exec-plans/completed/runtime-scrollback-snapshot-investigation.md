# 定位 Runtime 滚动历史快照等待超时

本计划按 `docs/PLANS.md` 维护。用户要求定位，正式产品和 smoke 暂不修改。

## 目标与全局图景

解释 PR314 的 Runtime 滚动历史用例为何在页面首末行通过后仍超时。核对原会话、读者和分页数据，区分测试契约过时与历史丢失，给出保留覆盖范围的后续修复边界。

## 进度

- [x] (2026-10-10) 基线 fa645cfc、工作树干净；确认失败在 `verifyLiveRuntimeReloadPreservesUpdatedTerminalScrollbackHistory:10380`。
- [x] (2026-10-10) 确认 Host 分页分支只发 terminalRead，原断言读取 terminalStream；源码历史可追溯。
- [x] (2026-10-10) 原生复现约 10.17 秒原超时；精确 reader 的四个分块/24874 字符恢复全部 220 行，顺序唯一。当前 reader 无后续增量。
- [x] (2026-10-10) 同步精简证据、设计、索引、原则、技术债，停止原生会话，确认 Supervisor 退出并归档。

## 意外与发现

原失败消息携带 current-state 描述符，output 为空且没有 terminalStream。请求同一个已打开 reader 的快照可能重复描述符而不重复发送已消费页面，不能只在 clearHostMessages 后等待原 bootstrap 页面。

最初两个诊断运行因脚本数字正则转义笔误使用 d{3}，使额外解码检查得到空匹配。第二次保留解码输出后确认 220 行实际完整，修正为 [0-9]{3} 后完整重跑通过；这是定位脚本问题，不是产品数据缺失。旧工件保存在 `.debug/runtime-scrollback-snapshot-first/` 与 `.debug/runtime-scrollback-snapshot-decoder-check/`。

## 决策记录

- 决策：复制当前 VSIX smoke-host，只在测试入口和失败断言旁增加观测，产品载荷保持 hash 不变。
  理由：原失败条件必须真实执行，同时用同一 reader 的实际数据验证是否丢失历史，不靠伪造旧字段通过。
  日期/作者：2026-10-10 / Codex。

## 结果与复盘

已确认是 smoke 的旧内联快照断言未适配分页协议。原用例的页面检查和全部 220 行恢复均通过；旧 predicate 对缺失 terminalStream 恒读空串。重复请求使用原 descriptor，清空前五个页面消息、清空后零页面消息，符合读者复用契约。后续正式修复需要关联原 bootstrap，而不是只换字段名。完整 gate 与后续矩阵不由此专项代证。

## 上下文与定向

目录 `/tmp/dscr`，分支 investigate-smoke-reload-autostart，PR314。原目录含无关发布工作，不修改。原失败工件 `.debug/runtime-admission-fix/trusted-artifacts`；前轮已清理原 Terminal 和 Supervisor。

`tests/vscode-smoke/extension-tests.cjs` 的滚动历史用例把 scrollback 从 80 调到 240，写 220 个 DSC_LRSP 标记，再模拟 Runtime reload，检查新页面首末行，最后请求快照并只读取 terminalStream。`CanvasPanelManager.postExecutionSnapshot/postPagedExecutionSnapshot` 的新能力分支返回 terminalRead，数据由原 readId 的 executionTerminalPage 分块传递；`terminalCurrentState.ts` 是实际 xterm 当前状态 codec，不能将它误当成 ANSI 字符串。

## 工作计划与里程碑

第一里程碑完成源码与历史追溯，证明旧断言何时和新协议分离。第二里程碑调用原滚动历史函数，保存清空消息前的 bootstrap，执行原超时等待，再将新描述符与原 session/authority/readId/页面生命周期关联；连续拼接 current-state 分块，用正式 codec 导入 headless xterm，验证全部 220 行且顺序无缺。第三里程碑记录已验证结论和边界，不执行正式修复或完整发布。

## 具体步骤

在 `/tmp/dscr` 恢复 `.debug/rca/node_modules` 与 `.debug/rca/playwright-browsers`；Node 22 路径 `/tmp/dsc-release-node22/node_modules/node/bin`。设置 DEV_SESSION_CANVAS_VSCODE_EXECUTABLE 为 `/tmp/dsc0261n/.vscode-test/vscode-linux-x64-1.141.0/code`。定位脚本放 `docs/references/smoke-reload-autostart/runtime-scrollback-snapshot-investigation.mjs`，以 `xvfb-run -a node <脚本>` 运行；生成数据在 `.debug/runtime-scrollback-snapshot-rca/`。

## 验证与验收

必须复现原 terminalStream 等待超时，同时收到原 session 的分页快照；当前态分块属于同一 reader、offset 连续、长度与描述符一致；正式 codec 还原后 001–220 每行一次且按序。明确原断言失败不代表 Runtime 整体门禁通过；若读取复用导致未重发分块，须用精确 reader 关联原消费记录，不能混合新旧读者。

## 幂等性与恢复

每次使用独立 user-data。通过原 stop 入口停止实验节点并确认 Supervisor 退出，恢复依赖链接。正式源码和测试保持未修改；只提交定位文档/脚本/精简证据，不提交完整用户环境或终端正文。

## 证据与备注

前轮七独立阶段和完整 verifyLiveRuntimePersistence 已通过，当前问题发生在后续滚动历史测试。基线失败快照有 terminalRead/currentState，首末行页面检查在原等待之前已执行。

最终精简证据 `docs/references/smoke-reload-autostart/runtime-scrollback-snapshot-evidence.json`：session 47db1573、readId 8c73cebc、checkpoint/head 9、四块 24874 字符、220 行独立且有序、重复请求后零页。三个产品 bundle hash 与前轮默认 VSIX 完全相同，正式源码和 smoke 无 diff。原等待原样执行并预期超时，定位脚本最终 exit 0。

## 接口与依赖

复用现有 runner、fake provider、真实 VSIX 载荷、@xterm/headless 和正式 current-state codec，不新增产品接口或依赖。

修订：2026-10-10 建立定位计划，要求关联原 reader 并检查完整历史。

修订：2026-10-10 完成原断言重现及原 reader 全量标记核对，记录定位脚本笔误与已修正结果，确认正式修复边界并归档。
