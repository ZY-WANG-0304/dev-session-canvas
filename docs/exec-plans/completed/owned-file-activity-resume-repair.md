# 修复 owned 文件活动采集与 fake 恢复上下文

本计划按 `docs/PLANS.md` 维护。基线 PR #314 / `71788d9e`，工作树 `/tmp/dscr`。

## 目标与全局图景

RuntimePersistence 关闭时，owned 本地 Agent 的结构化文件事件应生成文件引用，read 后立即退出也不丢末尾事件。模拟 provider 停止提示不得破坏其恢复契约，reload 后保持手动 resume-ready 并可显式 resume。保留真实 provider 提示解析与原 smoke 断言。

## 进度

- [x] (2026-10-11) 根因确认完成：owned 提前 return 漏 collector，fake storagePath 被真实提示解析覆盖。
- [x] (2026-10-11) 记录正式方案，新增首项 collector 回归在产品修改前失败（0 !== 1）。
- [x] (2026-10-11) 实现原执行 collector 生命周期与 fake 上下文保护，新增18项回归。
- [x] (2026-10-11) Host569/569、类型、本地化、正文helper14/14通过；原生readexit通过，files及默认trusted在删除Agent B后等待收敛超时。
- [x] (2026-10-11) 同步证据、技术债并归档；提交、rebase/push及PR描述更新由Git/PR记录追踪。

## 意外与发现

collector.dispose 会读末尾事件，必须在原最终保存前 await。准入拒绝可能先触发 owner 退休再返回结果，因此 Host 记录不能在 collector 释放之前删除。根因证据见 `docs/references/smoke-reload-autostart/file-activity-resume-root-cause-evidence.json`。

## 决策记录

2026-10-11：collector 放入 NonNativeHostExecution，不复用旧 nodeId map。准备完成后注入 extraArgs/extraEnv，事件回调按当前 record.nodeId 和原 metadata 引用验证，可随 root 重组移动。无资源启动失败先禁止事件，再释放 collector；正常 flushFinal 先 drain collector 再提交最终快照。未知资源仍归原执行，不提前销毁采集器。失败消费路径也释放 observer，但保留最终失败责任。释放失败不得被写成完整成功。

2026-10-11：readAgentResumeContextFromOutput 对已有 fake-provider 上下文返回 null，维持测试适配器原 sessionId/storagePath 的整体契约。真实 Codex/Claude 输出解析仍按既有规则工作；该保护也覆盖旧 session finalize，不仅修单个 owned 赋值点。

## 结果与复盘

两项正式修复完成。Host569/569、类型、本地化和正文helper14/14通过；默认VSIX七个独立阶段通过，trusted也通过原手动恢复。文件活动已通过原read/write/共享引用/节点和列表/打开文件，随后在删除Agent B后等待收敛超时。原生files复验同一停点；独立readexit原函数全部通过（末尾事件、持久化重读和清理）。完整gate仍exit1，不以专项代证。

## 上下文与定向

`extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts` 的 startNonNativeHostExecution 持有原执行记录、metadata 与最终持久化责任。`agentFileActivity.ts` 创建 provider 事件流，start 安装监听，dispose 关闭监听并排空末尾事件。旧 agentFileActivitySessions 仍用于 Runtime/旧 session；owned 需要执行级别的独立责任。测试在 `scripts/test/test-host-execution-owner-wiring.mjs` 使用实际 Host 类与受控 collector/transport 验证接线。

## 工作计划

第一里程碑补 collector 注入、正常 read/最终 drain、拒绝/准备失败、换绑/删除/root 路由、disposal 失败回归，并补 fake 上下文保持与真实提示校正的对照。基线应先失败。第二里程碑按原记录接线，不修改公开消息或放宽配额。第三里程碑运行原文件活动与手动恢复函数，以及 readexit 末尾事件专项和默认 VSIX，下一处未关联阻塞只登记。

## 具体步骤

工作目录 `/tmp/dscr`。恢复 `.debug/rca/node_modules` 与 `.debug/rca/playwright-browsers` 的根链接。PATH 使用 `/tmp/dsc-release-node22/node_modules/node/bin`，VS Code `/tmp/dsc0261n/.vscode-test/vscode-linux-x64-1.141.0/code`，执行资产 `/tmp/dsc-release-026-assets`。

    DEV_SESSION_CANVAS_HOST_TEST_FILTER='owned file activity|fake resume' node scripts/test/test-host-execution-owner-wiring.mjs
    node scripts/test/test-host-execution-owner-wiring.mjs
    npm run typecheck
    npm run test:ui-copy-localization
    npm run test:vsix-smoke

原生复验仅在隔离测试入口调用正式函数，产品 bundles 不加探针。输出置于 `.debug/owned-file-activity-resume-fix/`。提交前恢复依赖停放，fetch/rebase origin/main 后推送 PR314，不合并或发布。

## 验证与验收

事件必须来自正式 collector，原启动身份不变；最终保存发生在 drain 之后。拒绝不 connect、collector 仅释放一次，旧回调不污染替换节点，原 metadata 随业务投影更新仍能继续接收。fake 停止与最终保存保持 storagePath，真实 provider 仍可发现/校正会话身份。原 native 函数保留断言，完整门禁失败须列准确停点和未触达范围。

## 幂等性与恢复

测试在隔离 user-data 执行，正常结束停止本轮执行；不修改原用户工作区、版本或其他工作树。collector disposal 复用同一个 promise，错误保留原责任。

## 证据与备注

证据 `docs/references/smoke-reload-autostart/owned-file-activity-resume-fix-evidence.json`。两个专项产品bundle与正式VSIX staging hash一致，均清理至零localExecutions。原生readexit exit0；files exit1；默认七个0、trusted1。后续删除阻塞及历史边界已登记tech-debt-tracker。

## 接口与依赖

复用 AgentFileActivitySession 的 extraArgs/extraEnv/start/dispose 和现有状态投影。NonNativeHostExecution 增加私有 collector 状态，不新增依赖或公开协议。

修订：2026-10-11，建立正式修复计划和释放/最终保存边界。

修订：2026-10-11，补齐通用 Host fixture 的 filesFeatureEnabled 配置初始化；正式 reload smoke 等待原 burst 回执，确保已安装停止提示 trap 后才 reload，保留全部原断言。

修订：2026-10-11，正式原生验证与默认 gate 完成；删除阻塞中原执行已最终 saved/退休，节点和引用仍在，根因未确认。归档本轮修复，不扩大到下一停点。
