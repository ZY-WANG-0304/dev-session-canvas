# 修复同一会话并发恢复导致的订阅丢失

本 ExecPlan 按仓库 `docs/PLANS.md` 持续维护。进度、意外与发现、决策记录和结果与复盘必须反映实际输入和验证结果。

## 目标与全局图景

开启 Runtime Persistence 后，窗口重新附着已有 Agent/Terminal 时，多个恢复入口不能互相撤销输出订阅。用户应继续看到原会话输出，点击 Stop 后应在原有期限内看到原进程的结束状态。恢复失败仍保留原绑定与错误，不启动替身进程。

本次从 `origin/main 22998ff4f7e540f1b0780890b9ea686fcf493906` 建立 `runtime-restore-subscription-fix`，工作树 `/tmp/dsc-runtime-restore-subscription-fix`。仅修复恢复任务与订阅责任；模式切换删除期间接纳回调是另一项已确认缺陷，保持原记录及发布阻塞。本地 `61dccd09` 混合了两项修复，只作为可复用的实现和测试候选，不能整项搬入或继承其验收结果。

## 进度

- [x] (2026-10-24) fetch 最新 main，创建独立分支及工作树，核对原生根因与本地候选。
- [x] (2026-10-24) 记录方案比较、范围与验收要求。
- [x] (2026-10-24) 原基线新增并发恢复回归失败 `2 !== 1`；真实 socket/PTY 单恢复通过、并发恢复在 client 次数 `3 !== 2` 失败。
- [x] (2026-10-24) 实现完整恢复任务共享及派发前资格检查，覆盖普通恢复、页面恢复与断连恢复；补齐首次断连的原错误反馈。
- [x] (2026-10-24) 真实订阅原main先红/修复后绿；完整协议链、Host634/634、执行上下文、类型/build及固定VSCode1.142.0旧升级场景通过。
- [x] (2026-10-24) 同步设计、索引、技术债与文件hash/原日志证据，形成独立可提交修复；远端PR和检查状态按实际head记录。
- [ ] 正式CI及review复审、修复合入后的PR327完整验收；本轮未授权合并/发布。
- [x] (2026-10-24) PR336 首轮 CI regression shard-2 暴露两条旧源码正则与准入/清理判断写法不匹配；改为 13 项实际 Host 行为回归，定向 reconnect（含真实 socket/PTY）和 output-sequence 通过，移除关键保护的两个内存变体均失败。生产代码不变；新 head 正式 CI 仍待完成。

## 意外与发现

原调查已经在真实 VS Code/PTY 对照中证明：迟到 deferred attach 取消有效订阅，Host 丢弃过时结果，原 PTY 正常退出但界面保持 stopping。历史首次 CI 失败缺少订阅现场，不能将其唯一原因追认为本竞态。最新 main 的相关 Host/client 文件与旧候选修复前一致。

首次候选把初始连接断开只处理为任务失效，但尚无managed session负责后续反馈；新增回归复现节点永久reattaching。当前实现保留原错误并共同拒绝，既有分页会话仍走恢复流程。Host首轮原PID测试3秒超时，单项与串行634/634通过，未改预算且未确认根因。

2026-10-24 复核：PR336 初始 head d7496a99 的 CI40094803396 首败是旧源码正则；本地继续执行还暴露第二条同类断言。两条要求均改为行为回归保留，实际结束态准入与 client 退役未退化。补充证据 followup.json 绑定初始 head 与本次测试文件摘要，不能将原 CI 失败改记成功。

## 决策记录

2026-10-24：采用完整执行身份与当前恢复代次共用一个完整任务，并在实际 RPC 派发前核资格。理由是副作用在返回结果前发生，结果令牌无法单独保护现有订阅；任务必须一直覆盖到订阅建立。只加前置判断不解决半完成状态下等待者提前成功，服务端原子订阅交接会扩展协议范围，因此本次保持 Supervisor 协议和 Stop 期限。

2026-10-24：按用户指定新建恢复专用分支，选择性移植旧候选；既有模式清理、最终保存及回调准入行为不作本轮交付承诺。恢复仍遵守当前节点删除/身份替换、已关闭 Host 准入与已离开共享 root 的限制。

## 结果与复盘

本轮本地修复及具名验收完成，准备通过独立PR复审。原main的真实订阅在迟到恢复后消失，新实现保持订阅并完成原进程I/O/Stop/终态ACK；完整协议、Host634、类型/build及原生旧升级均通过。正式CI/复审与合入状态按远端head确认；模式切换删除回调和最终PR327完整验收仍未收口。

## 上下文与定向

`extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts` 在 Extension Host 中管理节点与原会话的绑定。`restoreLiveRuntimeSessions` 从共享状态读取待恢复节点；`attachPersistedRuntimeSession` 请求原会话快照并建立输出订阅；`reconnectPagedRuntimeSession` 在实际断连后从已消费位置继续接收输出。完整绑定包括 node/kind/session、backend/storage 和 owner/root，不能只按节点名称判断。

`extensions/vscode/dev-session-canvas/src/panel/runtimeSupervisorClient.ts` 的 attach/subscribe 在等待连接后才实际发送 RPC（进程间请求）。Supervisor 接到 deferred attach 会先撤销同连接旧订阅，保证快照与实时事件的顺序。若 Host 在回包后才认为请求过时，就无法撤回这个副作用。

恢复代次由现有执行操作令牌和原绑定共同确定。后来的有效 Stop、删除、身份替换、关闭或断连使旧任务不再有效。附着快照已经显示 attached-live 但订阅仍在等待时，整个任务仍未完成。

## 工作计划

里程碑一：把旧候选的恢复专属回归放到新分支，运行新增并发测试和真实 socket/PTY 订阅对照，保留原基线失败及输入。测试在异步外部边界暂停，不能直接伪造订阅丢失。

里程碑二：在 Host 等待 client 前同步登记任务；相同完整绑定且任务仍有效的调用共用结果。任务覆盖 attach、身份核验、快照应用和所需订阅，所有等待者得到相同失败。实际派发前将 isCurrent 传到 client，连接等待后再核。断连恢复和页面恢复复用相同入口，保留已有消费游标、压缩后重建及有限恢复机制。旧任务收尾只能清理自己的登记。

里程碑三：执行当前输入回归与真实 PTY 输入/输出/Stop 验证，必要时复用固定工具链和已校验资源运行原生宿主场景。记录复用依赖、受控边界与尚未覆盖范围，不把定向通过当作完整发布验收。对照差异确保未混入模式切换回调修复，更新正式设计、索引和技术债后创建 PR。

## 具体步骤

所有命令在新工作树运行。固定 Node 22.23.3 工具链为 `/dev/shm/dsc-ci-toolchains/node-v22.23.3-linux-x64/bin`；先检查版本。依赖可临时复用 `/tmp/dsc335-deps/node_modules`，它只提供定向验证，不能称为本轮全新 npm ci。真实 IPC 测试使用短的 `TMPDIR=/tmp` 或 `/dev/shm`，避免超出 Unix socket 路径限制。

依次运行 `npm run test:runtime-legacy-reconnect`、`node scripts/test/test-runtime-restore-subscription.mjs`、`npm run test:terminal-paged-projection`、`npm run test:runtime-supervisor-protocol`、`npm run test:canvas-execution-context`、`node scripts/test/test-host-execution-owner-wiring.mjs` 与 `npm run typecheck`。先保留原基线失败，再运行修复后的同一回归。详细命令与结果写入 `docs/references/runtime-restore-subscription-fix/`，未运行的项目不能写为通过。

提交前 `git diff --check`；推送/创建 PR 前 `git fetch origin` 并 rebase 最新 main。按 `docs/workflows/COMMIT.md` 使用中文主题，按 `docs/workflows/MR_CREATE.md` 记录问题、变化、验证和限制。用户尚未授权合并或发布。

## 验证与验收

Agent/Terminal 两种节点均验证：client 等待期间并发只有一次恢复；快照已应用但订阅未完成时后来的调用继续等待；attach/快照/订阅失败传给全部等待者；旧任务在删除、完整身份替换、关闭及断连后不派发、不写回或误删新任务；实际断连后新代次仍可恢复；不同会话独立恢复。真实 Supervisor/client/socket/journal/PTY 对照必须分别观察原进程退出、Supervisor 结束、Host 消费与 ACK，不能只统计 attach 次数。

完成标准是新分支自身的失败反例转绿、相关原回归通过、设计/实现/证据一致并形成可复审提交。真实 VS Code、跨平台或完整 Actions 尚未运行时应明确列为待验，不凭本地通过放行 PR327。

## 幂等性与恢复

保留原工作树未提交文件与旧候选，不修改其他分支。测试只关闭自己创建的 socket/进程与目录，首败日志不覆盖。临时依赖链接在不再需要时只删除链接本身。分支失败可继续修复；不更改 main、发布版本、tag 或历史证据。

## 证据与备注

原生调查及对应 run/timeline 见 `docs/design-docs/legacy-supervisor-stop-timeout-investigation.md`。本次独立设计见 `docs/design-docs/runtime-restore-subscription-fix.md`；历史候选 `61dccd09` 的验证范围不会自动转为本分支结论。

## 接口与依赖

不新增外部依赖或 Supervisor wire 字段。Host 增加仅内部的恢复任务记录和恢复资格检查；client 的 attach/subscribe 可接收可选有效性回调，原调用者保持可用。现有完整身份与操作令牌保护必须保留，不能为让测试通过而忽略过时响应。

修订：2026-10-24 建立独立恢复修复计划，说明用户可见结果、候选取舍、范围和逐层验收。

修订：2026-10-24 记录独立实现、订阅丢失的真实socket反例、初始断连补充修复及完整本地验收；保留首次失败和正式验收边界。
