---
title: 模式切换的原会话结算与旧保存隔离
decision_status: 已选定
validation_status: 验证中
domains: [执行编排域, VSCode 集成域]
architecture_layers: [宿主集成层, 适配与基础设施层]
related_specs: [docs/product-specs/runtime-persistence-modes.md]
related_plans: [docs/exec-plans/active/runtime-mode-switch-settlement.md]
updated_at: 2026-10-24
---

# 模式切换的原会话结算与旧保存隔离

## 问题与选定范围

原 Host 在等待首轮状态更新后发出删除，删除期间又接收旧消息并开始保存，随后以 pending 拒绝；modeSwitchCleanup 复用首轮失败导致再次进入仍失败。根因和历史证据见 runtime-shared-root-canvas-sync.md 的 2026-10-18 记录。用户已选择按会话/root 分阶段结算，本次与恢复订阅修复集中 PR336。

## 候选方案与取舍

仅增加等待不能封闭旧写入；全局关闭回调会误伤必要消费及其他 root；全 root 串行队列与 Supervisor 两阶段关闭协议扩大范围。选择在现有 Host 清理、严格删除与共享 departure 上明确原任务阶段和绑定责任，不改变协议。

## 正式方案

`CanvasPanelManager.ts` 在 client 回调接线处按 backend/storage/session/kind/node/owner 登记异步责任。回调在 handler 执行前捕获完整绑定，以 Promise 保存身份直至任务结束，覆盖终态先清掉 live 字段再保存的阶段。模式切换在第一次异步等待前冻结当前节点与 pending 回调中的原绑定，首轮等待后在派发删除前检查原保存失败；删除期间必要的输出、终态、读者和保存仍可结算。原删除确认后封闭相应绑定的新更新，等待已接纳的相关任务及保存完成，再执行清空与模式切换。该等待沿原 20 秒边界，包含无 candidate profile 的旧模式及仅离开共享窗口的路径；超时返回未确认，但保留仍在运行的原任务，迟到完成不得提交空图。失败保留原来源；不把无关 root 的持续输出当作本 root 的清理责任。

旧保存写入与回调完成需受原身份和模式代次约束。共享 root 继续使用 SharedRootCanvasDeparture 的最后参与者和四阶段接管规则；已经离开或已提交清理的 root 不得被旧保存覆盖。新 Host 接管后不受旧清理影响，未派发删除可放弃清理，已派发删除必须先结算。

正在进行的模式切换共享一项任务；失败后保留第一轮证据和已完成阶段。明确再次进入时，仅在上一项实际结束、且原请求可继续观察的条件下继续未完成部分。共享路径每次取得 departure 后重验本轮 root 资格及原删除责任，不用整个任务的 boundarySettled 跳过新取得的最后参与者责任；该阶段缓存只允许非共享路径跳过已完成边界。已确认删除不重做，未知删除复用原 strictRuntimeDeletes，不启动替身或丢弃未知责任。原绑定投影被移除或替换也不得遗失未知删除责任；旧模式的终态保存同样加入原严格删除记录。永久退出的首次报告保持原语义，底层存储错误仍然是失败。

普通 reset 的 pending 拒绝与未切换模式的 preserving reload 规则不扩大。任务完成前不应用新模式；内存保留旧图不被描述为原删除可回滚。

## 验证要求与状态

新测试使用真实 Host 方法和可控外部异步边界，旧输入确定失败、修复后通过。覆盖已知四路径、最后页面、迟到保存、并发与失败继续、多 root 和四阶段接管；真实 Supervisor/socket/PTY 和固定 VS Code 补充资源与用户结果。生产修复已实现。新行为回归在开始输入 `2f219c89` 的第一条确定失败（删除返回后没有等原保存），当前实现通过。覆盖四路径、并发共用、最终保存继续、部分删除/未知结果、不重复派发、投影移除/替换、旧保存代次、批次消费、两种 profile 超时、最后页面双向切换、永久退出首次失败，以及实际 live snapshot 等保存。

真实 socket/PTY 在单次及并发恢复后，暂停实际 Supervisor 删除、发送输出及真实状态消息、挂起 Host 保存；确认删除不能提前完成清理，放行后原进程退出、Supervisor 会话不存在、Host pending=0、画布文件为空，批次 consumed。快照投影/UI 与文件保存位置仍是显式测试边界，不能声称真实页面或全部终态协议覆盖。

Host 全套 634/634、真实 Supervisor 接管 3/3 和固定 VS Code 1.142.0 原 `runtime-mode/reload-clear` 自然场景已通过。最终代码的完整协议链、退出完整性及 `two-window-shared-runtime` 全场景已通过：双向共享与 I/O、Stop/delete、非最后窗口退出保留原会话、最后窗口清理、私有隔离与重新开启均沿原断言；没有注入 GUI 迟到屏障，受控因果来自行为及 socket 回归。正式 PR head CI 另行记录。初版命令、输入、日志和 hash 见 `docs/references/runtime-mode-switch-settlement/result.json`；第一次等待前登记的接续补丁与最终文件摘要见同目录 `followup.json`。旧 head `2f219c89` 的 CI40096144651 在 Remote SSH 重开 editor ready 45 秒失败；本轮局部通过不能追认该首败已修或最终 PR327 已获发布验收。

提交后自查新增先红后绿反例：ae5414c2 在清理开始前已接纳的保存恰好于首轮 drain 失败时丢失错误并清空。登记提前到 cleanup 的第一次 await 前，失败沿原回调保留；先红后绿结果见 followup.json 的 preboundary 记录。


## PR336 review 修正方案（2026-10-24）

共享模式重试必须在本次 departure 的 root 资格下重验原绑定责任。先前的全局 boundarySettled 只表明上一轮 Host 边界完成，不能证明本轮新取得的最后参与者责任已完成；共享路径取消这项跳过条件，每次执行边界检查，复用逐绑定删除确认及未知原请求，已提交空图仍由 clearedRoots 防止重复写入。

回调的原绑定必须在 handler 开始前取得并保存到任务登记。终态投影会先变 snapshot-only 再异步保存，当前节点不是未完成责任的完整索引。模式切换同时捕获 live 绑定与 pending 回调的原绑定及 Promise，即使当前节点已投影为终态也保留失败。首轮等待后、派发删除前检查这些原回调的结果，已知保存失败立即终止；删除期间新进入的回调仍在确认后结算，原 20 秒边界不变。


实现位于 `leaveSharedCanvasesForModeSwitch`、`captureRuntimeSupervisorCallbackBinding`、`pendingRuntimeSupervisorStateCallbackBindings` 和 `waitForModeSwitchRuntimeCallbacks`。前者每次 departure 都重新检查原删除责任；回调接线在处理器执行前取得完整绑定，以 Promise 为索引保存到回调结束，替换原本只有字符串 key 的集合。模式切换从这个登记与当前 live 节点共同获取原责任，既覆盖终态保存，也保留新 root 的严格删除及已有确认。

两条 review 在 `4d455028` 的仓库内回归分别先红：`--baseline-ref=4d455028 --review-case=p1` 缺少原删除请求；`--baseline-ref=4d455028 --review-case=p2` 丢失终态保存错误。当前新增 8 项覆盖单/多 root × 确认/未知删除，以及共享/非共享 × 终态保存成功/失败，总 29 项行为回归与真实 socket/PTY 通过。已知保存失败时删除计数为 0；成功终态只退役一次原会话，任务身份在 Promise 完成时释放。review 原脚本也独立先红后绿。本轮完整验证与最终代码摘要见 `docs/references/runtime-mode-switch-settlement/review-fixes.json`，原 result/followup 文件保留其时点事实。
