# 结算模式切换期间的原会话回调与保存

本 ExecPlan 按 `docs/PLANS.md` 维护，是 PR336 的后续修复范围。用户于 2026-10-24 授权按推荐的逐会话/root 分阶段方案实施。工作树为 `/tmp/dsc-runtime-restore-subscription-fix`，分支 `runtime-restore-subscription-fix`，开始输入为 `2f219c89`，目标 `origin/main` 为 `22998ff4`。原工作树的未提交 WORKFLOW 不动。

## 目标与全局图景

用户关闭 Runtime Persistence 并在重载、退出或关闭最后画布页面时，原会话删除期间到达的状态消息不能让清理无端失败或留下永久失败缓存。输出、读者、删除和保存按原会话结算后才提交新模式的空画布；其他启用窗口和其他 root 的原会话继续正常运行。删除不可回滚，失败必须保留原请求及已完成事实。

## 进度

- [x] (2026-10-24) 核对 main、PR336、历史复现、原 Host 清理和共享接管实现。
- [x] (2026-10-24) 建立执行计划并记录用户选定方案及验收要求。
- [x] (2026-10-24) 新增直接调用生产回调/保存入口的确定性回归，在修复前保存失败证据。
- [x] (2026-10-24) 实现逐绑定结算、旧保存隔离和可继续的模式切换任务；保留严格删除与永久退出报告语义。
- [x] (2026-10-24) 21 项确定性行为回归、真实 socket/PTY 单次/并发、共享 store、实际 Host 接管与真实 Supervisor 3/3、固定 VS Code 模式切换和完整双窗口场景通过。最终文件摘要与日志在收口时记录。
- [x] (2026-10-24) 同步设计/证据/技术债；result.json 核对最终代码/测试和两个 GUI staged extension.js 与本地构建完全相同。
- [x] (2026-10-24) ae5414c2 已基于最新 origin/main 推送并更新 PR336；正式 CI40103313958 已启动。
- [x] (2026-10-24) 初轮等待错误传播补丁先红后绿；21 项竞态、完整协议、Host 634/634、退出完整性、类型/build 及两个原 GUI 场景重验通过。
- [ ] 将接续提交更新同一 PR，并核对实际最新 head 的正式 CI；初版 CI 不能代替后续 head。

## 意外与发现

历史脚本 runtime-mode-switch-reproduction.mjs 以观察故障为成功，并直接登记受控 Promise；它保留作历史诊断，新验收不能把它退出 0 当修复通过。旧本地组合候选 61dccd09 在删除前封闭回调，不能直接继承为本次选定方案或验收。

真实 socket 夹具最初缺 pending operations 集合，随后仅写 PTY 输出也没有触发状态保存；已补实际 Host 依赖与 Supervisor 的真实状态广播，阶段屏障在 5 秒内失败而不无限悬挂。初次 GUI 命令误用 variant（双连字符），目录要求 case id `runtime-mode/reload-clear`；失败发生在宿主启动前，不作为产品首败。

检查发现无 profile/仅 detach 路径缺总等待边界，现同样使用原 20 秒严格边界。旧模式严格删除的终态保存必须加入原 finalization，不能提前丢失绑定；新增直接调用生产方法回归。

## 决策记录

2026-10-24：在同一未合并 PR336 收口。恢复订阅和模式切换属于同一发布门禁的两个关联卡点，生产修改与证据集中，版本和发布物料仍留 PR327。

2026-10-24：采用 Host 逐原绑定的结算记录，删除期间继续接收必要输出/终态；删除确认后封闭该绑定的新更新，等待已接纳回调及其保存，最后提交清空状态。复用现有严格删除记录与 root departure，不新增 Supervisor 协议或全局事件串行队列。原绑定包括 backend/storage/session/kind/node/owner。已离开的 root 不接收旧写入；旧 Host 保存不能覆盖接管的新状态。

2026-10-24：正在进行的清理共用同一任务；失败记录保留。只有原任务实际结束后，明确的再次调用才能继续未完成阶段；已确认删除不重复派发，未知删除沿原记录观察。永久退出已返回的失败/未确认报告不追改为成功。底层持久化仍失败时继续明确失败，不清掉错误伪造成功。

## 结果与复盘

生产修复与确定性回归已完成，旧输入第一条断言稳定失败，当前四路径及负例通过；真实 socket/PTY、Host 634/634、真实接管 3/3 与原 VS Code 模式切换场景已通过。最终完整协议链、退出完整性与双窗口场景已通过，PR head CI 及文档证据收口继续推进，尚不宣称发布门禁通过。

## 上下文与定向

`extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts` 的 `cleanupRuntimePersistenceModeSwitch` 缓存整个 Promise；`prepareForDeactivation` 在该清理后才关闭全局事件准入。`prepareForHostBoundaryCore` 等一次当时的回调、保存、派发原会话删除，然后立即断言没有新回调。删除期间旧消息可进入 `handleRuntimeSupervisorTerminalBatch` 或 `handleRuntimeSupervisorState`，启动新的异步保存，造成 pending 错误并被永久缓存。

`sharedRootCanvasStore.ts`/`sharedRootCanvasParticipants.ts` 决定每个 root 的最后参与者与 preparing/settling/idle/finished 接管阶段；其资格和原 PID 规则保持。已派发严格删除由 Host 的 `strictRuntimeDeletes` 保留原请求、未知状态与保存责任，后续观察不能换会话或重启 Supervisor。

## 工作计划

里程碑一新增 `scripts/test/test-runtime-mode-switch-races.mjs`，复用实际 Host 加载方法，仅在外部请求、回调写入和文件保存处设置可控暂停点。覆盖共享/非共享的生产退出与 reload，增加最后页面入口；新行为断言应在开始输入上失败。每个暂停点都由实际到达通知控制，不能靠 sleep 猜顺序。

里程碑二在实际 client 回调接线登记绑定及 Promise，记录清理期间的相关失败，按绑定封闭和结算。必要回调能在删除等待中完成，清空后新旧回调不能复活原绑定。模式任务保留完成阶段，继续处理不重做已完成的外部副作用。异步 workspace 保存的输入需在清理代次变化时重新核对，不能把旧快照排在新空画布后面写入。

里程碑三补负例：持续 pending/保存失败必须在原期限失败，未知删除不重新派发，已完成删除而最终保存失败可继续保存，其他窗口/多 root 不受破坏。运行既有退出、Host owner、共享 store 和四阶段接管回归；用真实 Supervisor/socket/PTY 观察输出消费、原进程退出、删除与磁盘状态，固定 VS Code 运行原 runtime-mode--reload-clear。定向结果与完整 Actions 验收分别记录。

## 具体步骤

在工作树执行，固定 Node 22.23.3 的路径 `/dev/shm/dsc-ci-toolchains/node-v22.23.3-linux-x64/bin`。依赖可临时链接 `/tmp/dsc335-deps/node_modules`，运行后移除链接本身。证据放 `/tmp/dsc-mode-switch-evidence`，摘要随代码写入 `docs/references/runtime-mode-switch-settlement/`。复用依赖、原生资产 `/tmp/dsc335-assets` 和 VS Code 缓存 `/dev/shm/dsc-ci-vscode` 时明确说明，不称为冷安装。

依次运行新竞态测试、`node scripts/test/test-runtime-host-deactivation-integrity.mjs`、`node scripts/test/test-shared-root-canvas-store.mjs`、`node scripts/test/test-host-execution-owner-wiring.mjs`、`npm run test:runtime-supervisor-protocol`、`npm run typecheck` 和生产 build。新增测试接入默认回归链。原生场景从当前 smoke runner 的具名目录选用，不延长原断言期限。推送前 fetch/rebase，更新 PR336 标题与说明围绕最终两个竞态，未授权合并或发布。

## 验证与验收

新回归在旧输入失败、新实现通过。暂停原删除，送入真实 Host 状态回调并阻塞保存：清理尚未完成，保存放行后完成；输出批次仍按原消费协议确认。再延迟旧保存到清空或接管之后，磁盘和 Host 均不得出现旧绑定。并发调用只发一次在途删除；未知结果保留、成功删除不重做，持续错误明确失败。模式切换可继续处理不能改变 reset 的 pending 拒绝或永久退出首次报告。

真实验证区分 PTY exit、Supervisor session、读者、磁盘快照、UI 五个观察点。非最后窗口退出保持另一窗口输入输出；多 root 只删除最后参与者所属 root；删除前/删除中/idle/关闭阶段接管分别符合原规则。全量 gate 基于实际 PR head；最终 PR327 预合并验收仍在所需修复合入后执行。

## 幂等性与恢复

失败不清除未确认删除记录，不启动替身会话，不 force-push main，不改发布版本。临时测试只释放自己创建的进程和文件；首败证据保留。正式方案见 `docs/design-docs/runtime-mode-switch-settlement.md`，历史调查保持原时点结论。

## 证据与备注

历史输入 a62e5d7e、CI39108395021 和四路径复现位于 `docs/references/release-gate-redesign/implementation/runtime-mode-switch-reproduction.json`。PR336 已有恢复订阅证据不能代证本次模式切换修复。

## 接口与依赖

不新增依赖或 wire 字段。Host 内部回调登记增加原绑定上下文；模式切换状态记录仅负责原任务阶段与错误，不另建通用事务框架。共享 store 原子提交、参与锁和 strict delete 的原身份/期限规则继续使用。

修订：2026-10-24 初始化选定方案、逐层验证及明确失败继续处理边界。

修订：2026-10-24 实现与定向验证完成；补无 profile 超时、原记录续接、真实 socket 夹具修正和当前验收边界。

修订：2026-10-24 最终完整协议链、退出完整性与两真实窗口共享/非最后退出/最后清理/重启开启均通过。旧 completed-history 方法抽取夹具缺完整类方法，严格终态接续已收敛为仅存在原删除记录时执行，未增加无责任路径查询。

修订：2026-10-24 所有本轮局部验收完成，原输入失败和最终 bundle 一致性已记账；剩余提交推送与正式 CI。

修订：2026-10-24 提交后新增先红反例确认首轮等待会丢失切换前已接纳保存的失败。将登记提前到第一次异步等待前，追加第 21 项回归；最终代码和原生场景重新验证，不继承旧 bundle 摘要。

修订：2026-10-24 接续补丁完整局部复验通过；followup.json 保存最终代码与两个 GUI 同字节 bundle，初版 result.json 原样保留。


## PR336 review 接续（2026-10-24）

用户要求修复 [review6385842820](https://github.com/ZY-WANG-0304/dev-session-canvas/pull/336#issuecomment-6385842820) 的两处确定性缺口，输入为 4d455028，main 仍 22998ff4。P1 是保存失败后重试时从非最后参与者变为最后参与者，却被全局 boundarySettled 跳过删除；P2 是原终态投影清掉 live 绑定后保存仍 pending，清理无法从当前节点找回原回调及其错误。

- [x] (2026-10-24) 用真实参与者协调器复现 P1、实际 completed-snapshot 回调复现 P2，保存原输入先红证据。
- [x] (2026-10-24) 每次共享 departure 后重新检查当前 root 和原绑定删除责任，已确认删除仍只复用原记录；保留 clearedRoots 对发布空图的保护。
- [x] (2026-10-24) 从回调接纳时保留原身份直至任务结束，模式切换同时捕获当前绑定与未完成回调的原绑定；不依赖终态投影反查身份。
- [x] (2026-10-24) 新增八项角色变化、多 root、未知删除与终态成功/失败回归；最终完整协议链、Host 634/634、退出完整性、类型/build、原模式切换和双窗口 GUI 均通过。
- [ ] 更新同一 PR 的 review 修复提交、证据与说明，核对新 head CI 并等待复审。

方案：共享路径每次重新取得 departure 后都执行原 Host boundary 的责任检查，删除复用已有逐绑定 deletionConfirmed 与 strictRuntimeDeletes，不再用全局布尔值跳过新取得的 root 责任。非共享路径继续保留原阶段缓存。回调接线在调用实际 handler 前捕获完整绑定，登记 Promise 与该绑定；模式切换从 pending 回调也能登记原身份及错误。具体类型和验证结果在实现后同步正式设计与证据。

修订：2026-10-24 按两条 review 意见重新打开修复阶段，明确先红与跨角色/终态投影验证。

修订：2026-10-24 两条 review 原脚本及默认回归旧输入均确定失败，修复后 29 项竞态通过；首轮保存已知失败在删除前传播，删除计数为 0。最终完整回归与 GUI 正在执行，原测试证据不覆盖新 head。

修订：2026-10-24 review 修复最终完整协议与两个真实窗口场景通过；原输入先红与新输入摘要分别保存，合并前仍需新 head CI 和复审。
