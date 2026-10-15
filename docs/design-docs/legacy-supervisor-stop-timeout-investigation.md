---
title: 旧代 Supervisor Terminal 停止超时调查
decision_status: 待探索
validation_status: 验证中
domains: [执行编排域, VSCode 集成域]
architecture_layers: [宿主集成层, 适配与基础设施层]
related_specs: [docs/product-specs/runtime-persistence-modes.md]
related_plans: [docs/exec-plans/active/smoke-lifecycle-diagnostic-isolation.md]
updated_at: 2026-10-15
---

# 旧代 Supervisor Terminal 停止超时调查

## 问题与证据范围

固定组合 `55c619ad70dbec74a7f9ffab17bf3dc547bd6913`（PR335 修复 `6613d1dc` 与 PR327 发布材料），run38696319881 原样执行 `npm run release:verify -- --version 0.26.1`。源码 trusted/restricted 完整通过，首败在 `tests/vscode-smoke/legacy-supervisor-upgrade-tests.cjs:334 → waitForSnapshot`：点击真实 Stop 后，`previous-generation-stream-terminal` 的原 session `dd00a348-d787-4cdb-a206-4fec1f587f80` 在原 30000ms 内没有得到结束投影。

Host 在 07:22:10.649Z 记录 stopRequested，末次节点仍 `stopping/liveSession=true`、outputSequence=5、无 lastRuntimeError；停止后的保留诊断没有该 session 的 terminalBatchReceived/Consumed/handlerFailed。旧 Agent/Terminal 与当前 root Terminal 尚未停止，仍 live 是预期。原完整 ZIP CRC、tar 与 337 文件清单已核验；旧代场景 54 文件只有 Host/VS Code 日志和失败快照，没有 Supervisor registry、内部订阅或 PTY 进程现场。不能用 cleanup 后的退出反推失败时的进程状态。

该场景未由 PR335 修改。原版本 VS Code 1.142.0，commit `6d62b1d5dace93a33b3a6d3eca1317bd5e15bcb1`。原工件及来源见 `docs/references/smoke-lifecycle-diagnostic-isolation/retirement-source-full-result.json`；后续实验见 `legacy-stop-investigation-result.json`。本调查已确认并原生复现一条会产生相同超时的恢复协议竞态；历史首败仍缺现场，尚不能唯一归因。本轮没有实施新生产修复。

## 实际停止链与候选分界

夹具用历史 ref5355e6a 的 bundle 提供两个无 capabilities 的旧 session；previous-generation-stream 则用当前 `dist/runtime-supervisor.js`。`startLegacyRuntimeSupervisor` 只传 storage/backend/guarantee，不传 execution-profile。`supervisor/runtimeSupervisorMain.ts:main` 只有显式 profile 才创建 ExecutionOwner，所以本例使用无 owner 的 stock node-pty 兼容路径，不能按新 owner 的读者结算定因。

以下源码落点相对于 `extensions/vscode/dev-session-canvas/src/`。`panel/CanvasPanelManager.ts:stopExecutionSession` 先投影 stopping，再向原 storage 的 client 发 stopSession。Supervisor 的 `stopSession` 对普通 Terminal 调用 `session.process.kill()`；`panel/executionSessionBridge.ts` 转发 node-pty 的默认 kill，Unix 实现向原 shell PID 发送 SIGHUP。PTY onExit 经 `bindSessionProcess → finalizeSession` 进入该 session 的 terminalOperationChain，设置 live=false、生成终态，然后广播。

订阅若协商 `terminal-host-credit`，广播通过 journal batch 传递状态；上一批须经 Host 消费及 ACK 才能发送下一批。`runtimeSupervisorClient.ts:consumeTerminalBatch` 校验 subscription/session/authority/revision，调用 Host 消费方法；`CanvasPanelManager.handleRuntimeSupervisorTerminalBatch` 验证原 session 和 binding 引用、应用事件、等待实际行消费、应用 snapshot，再返回 consumed。任何层的停滞或静默取消都可能表现为旧 Host 投影不结束，原停止后的诊断缺失不足以选择其中一层。

需要分别核对停止 RPC 是否到原 Supervisor、原 shell 是否退出、onExit/finalize 是否完成、终态是否排队/发送以及 Host 是否取消消费。Unix node-pty 吞 kill 的信号异常，原输入没有 signal mask/进程状态，因此“信号未生效”仍是候选。finalize 队列阻塞、Host credit 在途或撤销也尚未由历史现场确认。

## 有限原生诊断结果

临时分支固定原源码与 run38696319881 的六资产，经 assembly manifest/hash 核验复用。诊断记录停止、PTY PID/proc 状态、finalize、订阅/ACK 与 Host 应用；失败时在 cleanup 前以两秒限时分别读取 hello、registry、snapshot。保留真实按钮和原 30 秒断言，没有延长预算、自动重试或跳过正式测试。原 assets 复用是诊断输入，不称为新 run 同 ref/run 的正式发布门禁。

四份原生完整旧代样本均 exit0。run38706315883 两份包含停止前额外只读查询；run38707714250 两份去掉该查询，第四份按默认源码前置场景顺序运行到旧代。原 shell 在 kill 前 SigBlk=0、状态 S，onExit 时原 PID 已 ENOENT；PTY onExit 距 Host stop 2–5ms，Host live=false 距 stop 10–22ms。后两份 Host batch 全 consumed，最终 ACK 撤销订阅属于正常终态。四份通过只能说明该输入有正常路径，不能证明原首败已修复。

恢复完整 release:verify 前置时，三次诊断任务在进入旧代前失败：run38709365704 缺 Chromium；run38709406406 遗漏原短 host TMP 导致 VS Code Unix socket 路径过长、listen EINVAL；run38710617988 的方法内诊断辅助函数未随 Host 方法抽取夹具带入，consumed 断言得到 cancelled。这些是诊断准备失败，不能冒充原产品复现。已恢复原 browser/TMP 配置，并把记录移到类外 prototype 包装；保持正式方法体和测试断言，原 50 项 Webview、10 项 Host batch 与 typecheck 通过。完整诊断 run38711507240/job116343740971 已原样无过滤执行 release:verify 并 exit0（09:15:27–09:40:12Z）；ZIP CRC、tar 与727份清单逐文件大小/hash已核验。旧代原session `0abb8889-74e3-45e3-9fca-793f1ae634c7` 的PTY在Stop后5ms退出，15ms时Host开始应用live=false，最终batch consumed。完整诊断虽覆盖后续场景，但复用旧run资产且有类外记录包装，不能代证PR327最终最新预合并输入门禁，也不能抹掉历史首败。

## 同身份重绑的受控机制与归因限制

源码 `CanvasPanelManager.bindRuntimeSession` 即使 key 和所有字段相同，也会创建新的 binding 对象。batch 消费的 current 检查包含引用相等；若发生在异步行消费期间，原 batch 返回 cancelled。客户端 ACK cancelled 后移除本地订阅，Supervisor `cancelHostOutput` 移除状态广播订阅；连接未断，不自动调用断连恢复。

临时 `legacy-stop-binding-control.mjs` 用真实 Supervisor/client/socket/journal、原 Host batch/event/state/bind 方法和实际 headless 行消费，在原写回调处暂停，唯一变量是在消费期间调用原 bind 方法重装相同内容。稳定 binding 对照收到 consumed，随后确认退出且 Host closed；相同内容重绑对照收到 cancelled，错误诊断为空，订阅撤销后受控 process exit 已确认，Supervisor live=false 而 Host 仍 stopping/live=true。显式以同原 session/authority 和已消费 cursor 重新订阅后，Host 收到终态并 closed。

这个实验确认了“取消订阅后终态无法送达”的机制，**没有证明原自然失败发生过这种交错**。过程退出由受控外部 callback 提供，不是原生 PTY；Host snapshot 应用边界也受控。正常 attach 后还会调用 subscribeSession，能够恢复终态；仅存在重绑不能推出永久丢订阅。进一步需原现场显示最后一次取消、重新订阅的先后顺序和有效 subscription identity。原诊断数组已在停止前清空，不能由停止后无 batch 推断先前取消；真正 session/binding 替换时拒绝旧回调属于必要保护，不得直接删除引用检查。

## 晚到恢复任务的受控对照

`restoreLiveRuntimeSessions` 在等待 client 前收集所有 reattaching 节点，多个入口调用之间没有共用的在途恢复责任。第二个任务可以已经收集同一个原绑定，却在 `getRuntimeSupervisorClientForKind` 等待。第一个任务完成 attach、应用 attached-live 并订阅 host-output 后，第二个任务才继续。`attachPersistedRuntimeSession` 发 RPC 前只核对完整原绑定，未核对是否仍需要普通 reattach；因此仍调用 `requestRuntimeSupervisorSessionAttach` 发 `deferSubscription:true`。Supervisor `attachSession → deferSocketSubscription` 撤销该 socket 的原 host-output 订阅。Host 收到结果后才由 `shouldApplyRuntimeAttachResult` 发现节点已 attached-live，记录 operationIgnored 并返回，不执行重新 subscribe。连接仍然可用，断连恢复不会触发。

临时 `legacy-stop-restore-control.mjs` 从原源码抽取 restore、attach、request、subscribe、完整绑定与操作令牌方法，使用真实 Supervisor/client/socket/journal 和行消费。单任务对照完成停止；双任务对照仅让第二次 getClient 晚于第一轮恢复，确定出现原订阅消失、operationIgnored、Supervisor确认会话已退出而Host仍stopping/live=true。显式同原session/authority/cursor重订阅后Hostclosed。这比仅重装binding更直接：晚到任务的订阅撤销没有自己的补建路径。该脚本的process退出和snapshot应用外部边界受控；随后原生PTY/VSCode对照补齐了真实退出与Host投影证据。

第一轮原生run38715829727的late/natural两份完整旧代场景都通过。late工件确认第二任务在第一轮订阅后发deferred attach并撤销credit，Host随后operationIgnored；但该次控制发生在seed阶段附近，随后夹具原有simulateRuntimeReload再次attach/subscribe，停止时订阅已恢复。因此只能确认原生恢复方法确实触达撤销机制，不能把这个成功认定为反例。第二轮将控制限定到包含原session的最后一次模拟reload，run38716971680/job116361935723 在原 `legacy-supervisor-upgrade-tests.cjs:334` 确定exit1；natural job116361935356完整旧代exit0。没有直接修改订阅、进程、Stop或等待断言。

构造器、root store协调更新、信任授予、目录重组和测试seed/reload均可调用scheduleRestoreLiveRuntimeSessions。原生natural样本已见同原session两次attach与一个operationIgnored，正常时两个attach早于最终subscribe，所以停止闭环通过；存在并发入口不等于历史最后一次订阅已被撤销，必须核对先后顺序。调用是否由夹具入口触发与被调用的恢复协议是否具有生产竞态也分别判断。

## 原生竞态已确认，历史首败仍有归因缺口

第二轮late的原session `ed8b2e85-6f62-4485-88a6-f519abf74163` 在最后一次reload的第一轮恢复后已有host-output订阅。以下均为UTC：10:00:49.373 subscribe；49.393第一任务完成，49.395晚到任务真实attach，49.396 cancelHostOutput，49.403 Host operationIgnored，之后没有subscribe。10:00:50.982真实Stop；50.989原Supervisor收到停止时subscribers/credit均空；50.994原PTY onExit，PID已ENOENT（距Host Stop12ms）；50.997 finalize返回live=false/closed。其后每2秒只读记录均closed，原30秒到期Host仍stopping/live=true、sequence5、无lastRuntimeError，且原ready/ack正常。失败后cleanup前独立hello/registry/snapshot再次确认同原Supervisor仍运行、原sessionclosed、lastExitMessage为Terminal stopped。这里退出的是PTY子进程，不要求长驻Supervisor随会话一起退出。

这形成完整因果链：晚到恢复RPC撤销已建立订阅，Host因结果过时跳过自己的订阅阶段，真实PTY停止和Supervisorfinalize正常，终态没有有效收件人，Host等待超时。自然顺序对照在停止时仍有订阅，PTY同样正常退出，Host消费终态并通过。原生natural也存在并发attach，但它们发生在最终subscribe之前，所以不能把“重复attach”本身作为失败判据。延长等待不能为丢失订阅补建终态路径。

已确认缺陷落在生产恢复协议，夹具提供了可控入口与时间窗口；没有证据将它归为VS Code缺陷。源码blame显示普通恢复的reattaching收集和操作令牌保护自2026年4月存在；deferred订阅自7月接入，9月进入paged/host-output协作；10月新增完整绑定核验仍只保护结果写回。上述历史信息只说明各机制存在时间，不能单凭blame确定哪个提交引入了自然首败。PR335具名修复没有改该恢复方法。

第三轮run38717714670复核请求params与当前node metadata。late job116364360892再次在原334行/30秒exit1，natural job116364360728完整旧代exit0。第二恢复释放时实时metadata已经attached-live；它向同原session发deferSubscription=true、paged-until-exit，并撤销原terminal-host-credit，随后operationIgnored且Stop前无重订阅。late的PTY8ms退出，Supervisorclosed而Host仍stopping；natural的PTY4ms退出、Host19ms应用终态。两轮late各61文件、natural各31文件的ZIP/tar及大小/hash全部核验，原Supervisor记录数均未到600条上限。第一版控制释放trace取自旧node对象，显示reattaching不能当作当前状态；第三轮改为从this.state取当前节点后确认attached-live。业务方法与测试断言未改。

原run38696319881在停止前清空了Host诊断，也没有Supervisor订阅/PTY现场；因此不能以本次原生同表象控制追认历史唯一原因。当前可确认的是一条可复现生产竞态及其具体修复边界，而非历史调度因素。后续修复候选是按完整原绑定合并在途恢复责任，并在发具有订阅副作用的attach前核对当前恢复资格；仍须保留错绑定、过时结果和旧回调拒绝，不能删除令牌/身份保护，也不能用无限重试替代恢复责任闭环。方案尚未选定，本轮只定位。

## 验证与收口

本轮已确认晚到恢复撤销订阅的原生竞态，历史首败唯一归因仍待定；生产修复及最终发布门禁未完成，发布保持阻塞。调查、参考脚本、timeline/hash 和后续关联回归集中 PR335，PR327 发布 head/draft 保持，不新建诊断、验证或文档 PR。完整诊断通过及原生失败/通过对照分别记账；用户本轮仅要求继续定位，不提前修改生产行为。修复合入后仍需 PR327 最新正式预合并输入的完整发布门禁。

受控脚本在固定输入 worktree 复跑：将参考目录的 `legacy-stop-binding-control.mjs` 复制为 `scripts/test/legacy-stop-binding-investigation-temp.mjs`，以 Node22 执行；恢复对照同样复制 `legacy-stop-restore-control.mjs` 到对应临时test路径执行。脚本只在任务 TMP 创建真实私有 socket/journal，finally 关闭自己的连接并删除该目录；结果写到 `/dev/shm/dsc-lifecycle-fix-evidence`，该目录须提前存在。新timeline为明确标记的阶段摘录，完整trace/hash与工件来源见result.json；原生诊断由存档 workflow/probe 固定源码运行；脚本记录属于临时证据，不进入默认测试链；所有本轮结果已取回，活动workflow/probe及worktree依赖链接已移除。
