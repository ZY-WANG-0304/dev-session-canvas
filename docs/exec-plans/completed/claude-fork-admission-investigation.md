# 定位 Claude Fork smoke 的启动准入超时

本计划按 `docs/PLANS.md` 持续维护。目标是解释 PR314 基线 be574e48 的 Claude Fork 为何没有 execution/started，区分测试残留启动与产品分叉缺陷。本轮交付可复验的原因和修复边界，不修改正式产品或 smoke。

## 进度

- [x] 复核正式失败事件和原测试调用顺序。
- [x] 捕获 Claude 请求时原 Host 记录、准入容量和种子快照。
- [x] 运行原顺序与生命周期收口对照，记录结论、残余边界。

## 意外与发现

正式失败在进程创建前报 Local final snapshot responsibility still occupies the execution key or Host capacity。侧栏恢复和 Fork UI 仅等待节点存在，后续 provider 分叉函数会恢复入口基线；原gate第130/142/175/179条host消息已证明旧pendingLaunch被回放且产生新executionId；最终容量空闲后Claude仍starting。

## 决策记录

隔离复制最终 VSIX smoke-host，增加只读 manager 引用和调用观测。对照仅收口前置测试节点的原执行，保持产品准入限制与原分叉断言。原因是必须先解释容量来自何处，而非放宽限制让测试通过。2026-10-11。

## 结果与复盘

已确认测试旧基线回放和产品reserve前拒绝呈现缺口。原侧栏函数后等待意图结算、停止及退休的对照通过原Codex/Claude全部断言；空画布Claude也通过。正式gate仍失败；本轮不改正式产品和smoke。受控prepare重叠回放另触发历史节点owned-resize-failed，原外层断言exit1，已登记技术债；不称为通过的专项。

## 上下文与定向

`tests/vscode-smoke/extension-tests.cjs` 的 trusted 顺序为 RuntimePersistence 配置切换清空画布、侧栏恢复、侧栏 Fork UI、Codex 当前节点 Fork、Claude 当前节点 Fork。后两项保存并重新写入 baselineSnapshot.state。`extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts::startNonNativeHostExecution` 会在创建新执行前统计正在准入或已退休但保存未完成的记录，pending 上限2；starting 上限1。记录保留代表原执行尚有责任，不等于进程仍运行。

## 工作计划与里程碑

第一里程碑用现有失败 artifacts 和源码定位触发路径。第二里程碑新增 `docs/references/smoke-reload-autostart/claude-fork-admission-investigation.mjs`，复制 `.debug/vscode-vsix-smoke/smoke-host` 并运行前述原函数，包裹原启动方法记录输入、执行身份、容量、保存状态以及失败前快照。第三里程碑比较只运行 Claude 与前置节点按原身份停止/退休后的对照；将证据与结论同步到设计、索引、原则和技术债。

## 具体步骤

工作目录 `/tmp/dscr`。依赖暂存于 `.debug/rca/node_modules`，运行前移回根目录，结束归还。Node22 位于 `/tmp/dsc-release-node22/node_modules/node/bin`，VS Code1.141.0 使用 `DEV_SESSION_CANVAS_VSCODE_EXECUTABLE=/tmp/dsc0261n/.vscode-test/vscode-linux-x64-1.141.0/code`。通过 `xvfb-run -a node docs/references/smoke-reload-autostart/claude-fork-admission-investigation.mjs probe` 运行；`control` 在每个原侧栏函数后收口原生命周期，`clean` 只运行原Claude函数，`replay` 读取相邻baseline.json（原gate第175条state），暂扣两项历史prepare直到Claude到达guard，捕获容量拒绝和20秒待启动态残留。probe自然时序可通过或失败，不能用一次通过排除竞态。每次输出到独立 `.debug/claude-fork-admission-investigation/` 子目录。

## 验证与验收

验收必须能指出拒绝时占用记录的原节点和执行身份，区分同 key 冲突与 pending 容量，并证明仅改变前置生命周期即可影响原断言。记录 probe 的预期失败与 control 的通过，不将调查进程 exit0 写成完整 smoke 通过。结束验证 localExecutions 清零。

## 幂等性与恢复

每次复制隔离 host、独立用户目录，不改正式 bundle；失败保存原快照后停止本轮节点。不得用固定 sleep 或吞掉原断言作为对照通过条件。

## 证据与备注

原失败 `.debug/owned-delete-persistence-fix/trusted-artifacts/failure-diagnostic-events.json`，Claude 子节点请求时间18:31:35.766Z；随后两个历史节点分别 not-required、saved。原消息另证明旧基线回放。replay在19:01:15.478Z捕获sameKey=false、两项历史admissionPending、保存submitted=false；19:01:35.679Z全部record已移除而Claude仍pendingLaunch=start。

## 接口与依赖

使用既有 `runVSCodeScenario`、真实 Linux PTY、fake provider、正式 smoke 函数和 debug snapshot。只读观测允许访问隔离 Host manager，不增加生产 API。

修订说明：2026-10-11 创建调查计划，明确原始证据、假设和对照边界。

## 实验结果与验证记录

五轮基于相同正式bundle的隔离原生运行：首轮probe原函数全部通过，但初版调查脚本要求复现失败而exit1；次轮probe在前置Runtime配置切换启动先超时，未到目标；control与clean均exit0；replay如预期捕获目标拒绝与原断言超时，释放prepare后的resize错误使外层原断言exit1。全部保存清理后零localExecutions。详见 `docs/references/smoke-reload-autostart/claude-fork-admission-root-cause-evidence.json` 的具名目录、hash和片段。未重复完整gate或Host套件，正式源码未改。

阶段决策：增加受控原baseline回放，以扩大已证实的历史请求重叠窗口并捕获guard内部计数；不声称完整重演原gate所有adapter子状态。保留原外层resize断言及失败，不用删除检查获得exit0。2026-10-11。

修订说明：2026-10-11 完成原消息身份对照、原生生命周期对照和受控容量回放，确认两层原因并记录实验未覆盖范围，归档计划。
