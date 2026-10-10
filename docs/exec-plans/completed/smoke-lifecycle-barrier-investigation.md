# 定位 smoke 的最终保存占槽与关闭准入

本 ExecPlan 按 `docs/PLANS.md` 持续维护。

## 目标与全局图景

用户要求定位两次 trusted 阻塞：Claude 异常退出后 resume 被旧最终保存责任拒绝，以及创建预设 Agent 时 owner admission is closed。交付可复现的首次因果链、测试与产品责任判断及修复边界。本轮不发布，不合并，不直接实施产品修复。

## 进度

- [x] 2026-10-10：核对 c1d7b977 基线和前轮原始失败工件。
- [x] 2026-10-10：读取启动准入、reset、最终保存与原 smoke 顺序，形成待验证假设。
- [x] 2026-10-10：5/5 受控 Host 验证通过：空画布 reset 竞态/等待完成正对照，分别延迟保存、读者确认、资源释放及释放后重试。
- [x] 2026-10-10：原生复现 reset 抢跑和通知同 key 拒绝；等待原退休后通知五次通过；受控 Claude 延迟确认复现并在同 Host 内恢复。
- [x] 2026-10-10：归档证据、四份可应用补丁，恢复临时源码，更新设计和技术债，准备 PR314 调查交付。

## 意外与发现

前轮异常通知用例的 finally 清空诊断；现有失败工件已没有原记录。预设创建用例发出异步 webview/resetDemoState 后仅检查 nodes.length=0，该条件可能在请求之前就成立。最终 error 状态在 persistState promise 完成前同步投影，不能代表旧执行已退休。原生只读探针已复现空画布 reset 的节点集合改变并中止，后续 owner closing=true、active=0。另在通知用例 Codex exit 27 后复现同 key 拒绝，保存及全部资源已完成，readerOutcome=pending；110ms 后的退休是 Host deactivation/lost，不能用作自然确认对照。后续保持 Host 存活等待退休的变体已连续五次通过；另受控 Claude 500ms 页面确认延迟后，等待原 applied/退休再 seed 并重启也通过。受控夹具最初未模拟页面快照交付，导致 final-flush 挂起；改为无页面基线后分别控制 reader/resource/save，这次夹具失败不作为产品证据。

## 决策记录

- 决策：先观测，再用确定性时间屏障区分生命周期泄漏与测试抢跑。理由：重复运行后的清理现场不能代替最早拒绝现场。日期：2026-10-10。
- 决策：临时探针只记录原身份、阶段、责任与错误，不改调度/放宽准入；原始工件本地保留，正式证据精简后入库。日期：2026-10-10。

## 结果与复盘

两项均确认是 smoke 把中间状态当完成：reset 对原空画布的等待立即成立，原异步边界随后因新节点中止；通知后的原执行可能仅剩 reader pending，即使保存/资源已完成仍占同 key。5/5 受控对照、reset 原生复现、同通知用例自然同 key 复现、五次等待原退休的存活对照，以及同 Claude 路径延迟页面确认的正反对照支持该结论。正式同步修复留在技术债；本轮产品源码不变，仅修正上轮 smoke 拆分遗漏的诊断变量。受控原生完整 verifyFailurePaths 通过，运行明确在此结束，不等于完整 gate。

## 上下文与定向

工作目录 `/tmp/dscr`，PR314 分支 investigate-smoke-reload-autostart，基线 c1d7b977。原工作区有无关发布工作，不修改。`extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts` 的 resetState 先关闭 owner（管理本地执行资源的对象），完成清理和保存后才 tryResume 重新开放；startNonNativeHostExecution 在相同 node key 仍被占据时拒绝新启动。最终保存负责先投影退出状态再异步保存，原记录必须保存和资源结算完成后退休。`tests/vscode-smoke/extension-tests.cjs` 的 verifyAgentAbnormalInterruptionNotifications 与 verifyCreateNodeCommandQuickPickPreservesExplicitPresetIntent 分别是两处失败入口。

## 工作计划

里程碑一：在现有 `scripts/test/test-host-execution-owner-wiring.mjs` 的真实 Host/受控 provider 夹具上添加临时 RCA 用例，暂停原保存或 reset 中的异步等待，观察启动拒绝，释放后验证相同请求能否成功。不要把未取得资源或失败保存改为成功。

里程碑二：为 Host 临时增加只读 JSONL 探针，记录 reset 开始/失败/完成、启动拒绝时原 owner、metadata 绑定、执行资源/保存状态与退休，防止原 smoke finally 清空证据。运行原 trusted；必要时用复用原用例的专项路径减少无关前置阻塞，明确标为专项证据。

里程碑三：归档可在基线应用的 probe/characterization patch 和精简证据，恢复正式源码及 smoke，更新设计文档与技术债并解释产品可达性与修复建议。

## 具体步骤

在 `/tmp/dscr` 恢复停放的 node_modules 与 .playwright-browsers（来自 .debug/rca），设置 PATH=/tmp/dsc-release-node22/node_modules/node/bin:$PATH。运行：

    DEV_SESSION_CANVAS_HOST_TEST_FILTER='lifecycle barrier RCA' node scripts/test/test-host-execution-owner-wiring.mjs
    DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=trusted DEV_SESSION_CANVAS_EXECUTION_ASSETS_SET=/tmp/dsc-release-026-assets DEV_SESSION_CANVAS_VSCODE_EXECUTABLE=/tmp/dsc0261v/.vscode-test/vscode-linux-x64-1.141.0/code npm run test:vsix-smoke

原生工件下次会覆盖，及时复制到 .debug/lifecycle-rca。收尾按基线恢复临时改动并核对 hash，依赖移回 .debug/rca。

## 验证与验收

占槽必须记录它是原保存 pending、失败、尚未退休还是全局容量；记录恢复同一节点时的原 identity 及其资源退出/终端/读者状态。关闭准入必须找出首次 close、对应 reset 是否结束、是否报错及创建发生顺序。每项至少有受控反例/正向对照，并说明产品用户操作是否可达。只完成观察时不得宣称完整 smoke 通过。

## 幂等性与恢复

保存基线源文件到 .debug/lifecycle-rca，观察探针与夹具补丁独立保存。不得丢弃无关文件；只还原本轮添加的临时改动。完成后工作区应只含正式调查文档与精简证据。推送前 fetch/rebase origin/main，不修改版本或合并 PR。

## 证据与备注

输入为 `.debug/preparation-failure/early-trusted-artifacts` 与 `repeat-trusted-artifacts`，前者原诊断已被 finally 清空；精简输入见 `docs/references/smoke-reload-autostart/preparation-failure-evidence.json`。

## 接口与依赖

使用现有 candidateFixture、persistenceFixture、deferred 和 execution owner，不加生产依赖。临时只读探针使用 fs.appendFileSync 到任务专用 JSONL；不收集环境变量、正文或用户文件内容。

2026-10-10：建立调查计划，记录两个待验证的异步完成条件缺口。

2026-10-10：完成 reset 原生首次因果链与 5 项受控对照；通知原生捕获到 saved+resources released 但 reader pending 的同 key 拒绝，继续补存活正对照和 Claude 原位置复现。

2026-10-10：完成调查与可复跑 patch 校验。`lifecycle-barrier-probe.patch` 是纯观测；`lifecycle-barrier-characterization.patch` 可独立应用后运行 5 项 Host 用例；`lifecycle-barrier-claude-delay.patch` 在观测 patch 后应用，仅延迟 Claude 原执行读者确认；`lifecycle-barrier-smoke-controls.patch` 加入 awaited reset、Codex 原退休等待、Claude 拒绝后等待/同 seed 重试，并在原 verifyFailurePaths 后结束。各补丁以 c1d7b977 为共同基线，已验证依次应用能够逐字重建最终受控源码。所有补丁位于 docs/references/smoke-reload-autostart/，原生运行日志 hash 与简化事件在 lifecycle-barrier-evidence.json。

2026-10-10：产品源码及 Host 主测试恢复基线 hash；实际交付仅文档/证据和 verifyFailurePaths 的诊断局部变量补回。保持原生观测、受控对照、历史无法回溯的状态与正式门禁边界分开，归档计划。
