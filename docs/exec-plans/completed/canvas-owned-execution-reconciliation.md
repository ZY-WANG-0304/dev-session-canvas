# 修复画布重组与活动执行的身份衔接

本 ExecPlan 按 `docs/PLANS.md` 持续维护，承接 PR #314 已完成的原生调查。

## 目标与全局图景

用户在同一 Host 重读画布、切换 root 组合时，仍能操作原 Agent/Terminal，不因 metadata 或节点 ID 重建而误恢复或额外启动。移除 root 的执行必须先结算并保存尾部。smoke 的创建自启动断言应在创建时执行，整图夹具不污染后续运行测试。继续使用 `/tmp/dscr` 的 PR #314 分支，不修改原工作树、不进行发布或合并。

## 进度

- [x] (2026-10-09) 复核调查证据、最新 main 与 PR head，确认修复范围。
- [x] (2026-10-09) 完成同 ID 重读、root ID 路由迁移和 root 移除结算，实现保留旧组合保存目的地。
- [x] (2026-10-09) 补齐准备中迁移、输入取消、保存失败/超时、永久关闭和模拟 reload 单次保存等待的回归。
- [x] (2026-10-09) 隔离创建与 sidebar/Note/布局夹具；新增真实 workspace 增删场景，纳入默认源码/VSIX smoke。
- [x] (2026-10-09) 真实原生源码场景和 VSIX 场景通过；最终 VSIX 场景从两条活动执行直接模拟 reload，一次完成保存并成功重新启动。
- [x] (2026-10-09) 完整 VSIX 越过原自启动失败段，在后续 burst 正文断言失败；记录同身份终端快照与历史 metadata 差异，完整发布门禁保持未通过。
- [x] (2026-10-09) 最终 Host 354/354、owner 54/54、smoke runner、reset fixture 19/19、composition 和 VSIX 内 typecheck/build 通过；正式设计与剩余技术债已同步。
- [x] (2026-10-09) 形成同一 PR #314 的修复提交与可复核说明；不合并或发布。

## 意外与发现

owner 的 key 是节点路由，provider 的 executionId/generation 才是真实执行身份；原输出回调捕获旧 nodeId，须与 Host/owner 索引一起调整。取消最终 reader 可能立即退休 owner，但 Host 仍等待保存，因此路由迁移必须支持已退休的原记录而不复活执行。

VS Code 的实际 folder 列表先变化，原 root 的最终保存后发生。如果保存直接用最新 folder 列表分解旧画布，会丢掉移除 root 的正文；需要按最后完成的画布组合写盘。新的永久关闭检查也必须放在等待前后，避免迟到保存推进已关闭 Host。

完整 smoke 的早期停止 helper 原先只等待 live=false，会在原保存和 reader 尚未退休时重新启动；现在等待同 executionId/generation 的原记录退休。创建断言前移后，sidebar 自身仍等待 live Agent 的旧前置条件也必须改成已停止夹具。

后续 `verifyAgentExecutionFlow` 的 burst 超时中，原生 Agent 的终端快照已经有 `[fake-agent] burst 001`，而 metadata.recentOutput 仍是上一条执行的最终正文。该字段不由当前原生业务投影实时更新。保留完整失败，不能将过滤场景成功写成发布成功，也不将该后续正文断言并入已修复的身份失配。

## 决策记录

选择保留尚存 root 的原执行与原 metadata 对象；只从明确的旧 root + 本地 node ID 映射新节点，不用 cwd 或标题推断。路由迁移先批量校验再提交，保留 executionId/generation。页面 reader 在 ID 变化时撤销并由新节点重新附着。

移除 root 时保留旧画布用于最终保存，执行结算后才重组；失败不丢弃绑定、不自动重试已拒绝的重组。新的预留在等待期间被阻止，保留 root 中已存在的预留可完成准备。未派发初始输入随路由迁移，派发中的原请求取消，准备失败清除迁移后的输入。

模拟 reload 的保存等待放入现有 Host boundary，不在检查准入前额外停止一次。总时限和每次异步返回后的边界检查继续约束操作；超时后的保存只结算原责任，不开放准入。

修复目标为已定位的画布重读/root 重组及相关测试生命周期。真实窗口 Reload、旧 Supervisor、跨版本/远程矩阵和后续整组正文断言迁移不在本次证明范围；剩余门禁已登记技术债。以上决策均于 2026-10-09 随 PR #314 实现确认。

## 结果与复盘

产品现在从活动 owner 恢复同一执行的画布投影，添加/移除其他 root 不会让原 Agent 被误恢复或多启动。移除 root 必须保存原尾部。原生 VSIX 验证已覆盖真实 folder 事件、新 node ID 的输入输出、恰好三条预期启动、移除执行保存，以及从活动执行单次模拟 reload 后重新启动。创建夹具不再被整图 seed 污染。

完整发布门禁仍未通过：后续 burst 断言使用旧正文来源，已另列技术债。没有修改版本号、tag 或发布契约，不能据本 PR 恢复发布。

## 上下文与定向

`extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts` 的 `loadReconciledState`、`reconcileSeededStateForTest`、`onDidChangeWorkspaceFolders` 重建画布 state；本地原生执行保存在 `nonNativeHostExecutions`，保存责任持有 metadata 引用及最终保存 promise。`executionOwnerLifecycle.ts` 管理每条执行的路由 key 和资源责任，provider 身份不应因画布布局改变。`common/canvasMultiRootComposition.ts` 用 root 路径把 root 内本地 ID 转为多 root ID。`tests/vscode-smoke/extension-tests.cjs` 与 `scripts/test/test-host-execution-owner-wiring.mjs` 分别覆盖真实页面及受控 Host。

## 工作计划与里程碑

第一里程碑通过 `reconcileOwnedCanvasState` 与 `ExecutionOwnerLifecycle.rekey` 保留同 ID 重读及 root ID 往返下的执行身份；运行 Host 回归，验证输出/resize 和最终磁盘正文。第二里程碑由串行 workspace 事件及旧组合保存实现移除 root 的完整结算；以延迟、失败和 deadline 证明状态与责任不丢失。第三里程碑调整 smoke 生命周期，新增默认 `owned-canvas-reconciliation`，在真实 VS Code 和 VSIX 中验收并同步正式设计与剩余门禁。

## 具体步骤

工作目录 `/tmp/dscr`，Node 22.23.3。平台资产和 VS Code 为本机既有路径，其他机器使用相同版本及对应平台构建替换路径；不能用不匹配的资产代证。真实用例运行在独立短路径 profile，设置 `umask 0077`，不修改用户 VS Code profile。

    export PATH=/tmp/dsc-release-node22/node_modules/node/bin:$PATH
    export DEV_SESSION_CANVAS_EXECUTION_ASSETS_SET=/tmp/dsc-release-026-assets
    export DEV_SESSION_CANVAS_VSCODE_EXECUTABLE=/tmp/dsc0261v/.vscode-test/vscode-linux-x64-1.141.0/code
    node scripts/test/test-host-execution-owner-wiring.mjs
    node scripts/test/test-execution-owner-lifecycle.mjs
    node scripts/test/test-vscode-smoke-runner-env.mjs
    node scripts/test/test-smoke-reset-fixture.mjs
    node scripts/test/test-canvas-multi-root-composition.mjs
    npm run typecheck
    npm run build
    DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=owned-canvas-reconciliation node scripts/smoke/run-vscode-smoke.mjs
    npm run test:vsix-smoke
    DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=owned-canvas-reconciliation npm run test:vsix-smoke

最后两个命令分别是完整门禁和过滤的具名场景，不互相替代。默认 VSIX 先运行新增场景再运行 trusted。日志保存在 `.debug/rca/repair-*.log`，只将精简证据入库。

## 验证与验收

同 ID 重读前后执行身份相同，节点仍 live；root 往返变化后 input/输出/resize/final 使用新 node ID，不自动 resume。保存待完成或失败不能释放原责任。单次模拟 reload 在原保存完成后返回，并能再启动；保存超时不自动开放准入。真实场景恰好创建原 Agent、原 Terminal 和额外 root 的 Terminal 三条执行，迁移阶段没有其他启动或绑定拒绝；最终模拟 reload 后再显式启动两条执行。

受控测试新增 18 项，完整 Host 354/354 通过；owner 54/54、Supervisor 116/116 已通过，源码/VSIX 具名场景通过。精确结果与本地日志摘要已记录到证据文件。VSIX 打包包含 typecheck/build。完整 trusted 后续失败及未覆盖矩阵必须保留在正式设计和技术债中。

## 幂等性与恢复

只在专用工作树编辑。原调查 patch/evidence 是基线历史输入，不再次套用到修复源码。可重复运行 smoke 的私有 profile；不覆盖原工作树变更。重组失败保留旧 state 和执行责任，只有后续显式操作重新检查完成条件，原保存迟到本身不重启重组。

## 证据与备注

正式方案见 `docs/design-docs/smoke-reload-autostart-investigation.md`。`docs/references/smoke-reload-autostart/repair-evidence.json` 记录修复测试与完整 smoke 后续失败的精简同身份观测。历史 `evidence.json` 和 `diagnostic.patch` 继续只对应原 main 基线。原生真实 CLI 用的是 fake provider，不外推 Codex/Claude 服务、远程或跨版本场景。

## 接口与依赖

不改变 provider 协议或 execution identity，不增加外部依赖。owner 新增身份校验的 `rekey(moves)`；manager 增加权威状态恢复、workspace 串行重组及最终保存等待方法。`CanvasDebugSnapshot.localExecutions` 仅供测试核对原身份退休和保存结果。执行 key 是可迁移的同 Host 路由，执行身份与持久化责任不可替换。

修订记录：2026-10-09，用户授权在 PR #314 修复，由调查转入实现；随后补入旧组合保存、准备中迁移、永久关闭保护和模拟 reload 的原边界等待，并如实登记完整 smoke 的后续正文断言失败。
