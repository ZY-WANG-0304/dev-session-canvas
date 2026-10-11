---
title: 共享 root 画布同步与模式切换
decision_status: 已选定
validation_status: 验证中
domains: [协作对象域, 项目状态域, 执行编排域, VSCode 集成域]
architecture_layers: [共享模型与编排层, 宿主集成层, 适配与基础设施层]
related_specs: [docs/product-specs/runtime-persistence-modes.md]
related_plans: [docs/exec-plans/completed/runtime-shared-root-canvas-sync.md, docs/exec-plans/completed/pr319-review-repairs.md, docs/exec-plans/completed/pr319-takeover-coordination.md]
updated_at: 2026-10-11
---

# 共享 root 画布同步与模式切换

## 目标与边界

开启 Runtime Persistence 后，同执行环境、用户 global storage 范围和 root 的画布结构实时共享；关闭时各 Host 持有执行，画布保存归属当前 workspace storage slot。双向切换只在页面关闭/重启边界生效，设置变化当下保留页面。2026-10-11 用户补充：非最后一个开启窗口切换关闭只退出本窗口的共享模式，保留其他开启窗口使用的共享画布和会话；最后一个开启窗口主动切换关闭才启动共享清理，没有新窗口接管时确认 Supervisor 退出。同日用户进一步确认清理期间允许新开启窗口接管，按清理阶段结算与交接。当前 `e79aa66d` 已有无接管主路径的 Linux 单 root 真实双窗口及 Host/store 证据；接管协调尚未实现和验收，不能把旧增量通过推广为新规则完成。普通未切换关闭遵循原恢复保证，不删除项目文件、用户原始文档或 provider 自身会话文件。多设备、多用户与云同步不在范围内。

调查发现 Supervisor 的直接 delete 会先取消全部 Host 消费信用订阅，导致原窗口收不到后续终态。用户确认共享 delete 应移除各窗口节点，因此本次以结构删除通知收口投影，不要求被删除页面重新显示尾部；stop 仍须保留节点、等待原读者完成自己的终态消费。原受控 8 项诊断脚本保留历史因果，不作为健康产品回归，也不宣称已修改 Supervisor 单独调用 delete 的通知契约。

## 候选方案与取舍

只监听整份快照会覆盖并发编辑。把全部编辑放进 Supervisor 会让 Note/空画布依赖执行进程，并扩大执行协议边界。选用现有 root 文件加短提交互斥与按对象/字段差异合并，各 Host 订阅已提交结果；执行与终端字节权威继续在 Supervisor。

文件锁的过期偷取可能允许两个写者同时提交，故选用操作系统持有的 loopback TCP 独占监听。进程退出时 OS 释放，无 stale 文件锁恢复协议。这个选择增加一个短暂监听和有界端口占用失败，具体边界见后文。

清理期间的新加入原先采用等待全部清理及原 Supervisor 退出后登记的方案。用户现已选择允许接管：尚未派发破坏性操作时保留原会话，已派发操作必须结算，仅等待 idle shutdown 时允许沿用仍接受连接的 Supervisor。该选择避免新窗口合法使用进程与旧窗口坚持等待进程退出互相阻塞；其代价是需要显式协调清理阶段与责任交接。具体跨 Host 协议仍待实现阶段记录和验证，不将现有 socket 连接或长时间持锁视为已经实现接管。

## 正式方案

### 共享结构的提交与观察

`extensions/vscode/dev-session-canvas/src/panel/sharedRootCanvasStore.ts` 的 `SharedRootCanvasStore` 使用 canonical 存储路径标识同 root 文件。`publish` 保存上次本地状态到新状态的差异，在 root 提交锁内读取最新快照、合并差异、写独立临时文件并 atomic rename，生成 `sharedRevision`。待提交差异叠加在新收到的远端结果上，防止尚未落盘的本地编辑被覆盖。自身无远端变化的提交不重建 Host metadata 引用，保护在途执行的身份检查。

节点、分组、边、文件引用及 owner 记录按稳定 ID 合并；不同字段保留，同字段按成功提交顺序决定，位置和尺寸分别整体更新。删除优先于针对旧对象的修改，旧修改不能复活被删节点。冲突的新对象 ID 明确报错。抑制 ID 集合按增减合并，分组计数取最大值，清理悬空边和无效 groupId。没有实现文本字符级协作，同一 Note 正文冲突同样按提交顺序收敛。

共享状态滤除 `pendingLaunch`、终端正文、序号、序列化状态、摘要和本地错误等消费投影；runtime binding 与生命周期仍共享。`fs.watchFile` 以 100ms 间隔观察 revision，避免 rename 更换 inode 导致监听失效。构造后再投影一次已读取快照，覆盖页面读取与订阅建立之间的提交竞态。关闭停止观察，损坏快照拒绝覆盖，提交失败向 Host 报告，后续 publish/flush 保留失败。

root 提交锁端口为 SHA256(canonical filename) 映射到 20000–39999；节点操作锁端口为 SHA256(filename + nodeId) 映射到 40000–59999，两段分离避免节点操作等待内部 root 保存时自锁。监听仅接受并销毁连接，不交换状态，真正数据仍来自受用户存储权限保护的文件。占用每 10ms 重试，5 秒未取得锁明确失败；哈希碰撞保守串行，外部程序长期占用可能导致失败。只承诺 atomic rename 的一致可读快照，不宣称断电后 fsync 持久性或实时延迟硬上限。

### Host 投影与执行身份

`extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts` 的 `writeRootLocalCanvasSnapshot` 在开启模式接入 store；`persistState` 等待共享提交后再保存 workspace 投影，严格保存不把共享失败当成功。`applySharedRootCanvasState` 复用现有 multi-root 分解/组合，保留本地终端瞬态，不通过监听回写制造广播循环；新 live binding 按原 backend/storage/session/kind 重新附着。

远端删除或替换身份只释放本 Host 投影和 reader，不重复 stop/delete 共享执行。stop 后共享轻量节点到达时，现有 reader 保留原绑定直到自身尾部完成；延迟投影保存不能将已清除的 runtime ID 写回共享文件。原 reader 收尾期间以新共享 metadata 为基础，仅保留原身份、临时生命周期与消费字段；启动配置继续采用最新共享值。deferred 保存在排队时即登记 shared delta，定时器只保存 workspace 投影；peer 更新同时重整待保存 workspace 状态，不能在定时器阶段以新 base 重新解释旧整图。`withSharedExecutionMutation` 对 start/delete 持有节点操作锁，锁内重新核对原身份，拒绝已删除或替换目标；工作失败也先刷完已排队保存再释放锁。移除 workspace root 时等待旧组合保存后释放该 root 监听；Host 退出在最终保存后释放所有 store。

开启模式使用 global `root-local-canvas/<key>/canvas-state.json`；关闭模式使用当前 slot 的 `private-root-canvases-v1/<key>/canvas-state.json`，不订阅共享文件。关闭模式不重新附着 live Runtime；旧/copied root owner 绑定只在本地解除，保留可解释中断节点，不能停止共享原执行。同一个 storage slot 的历史数据仍属于该 slot，不宣称任意两窗口始终获得不同 slot。

### 模式切换边界

`CanvasPanelManager.notifyReloadRequiredConfigurationChanged` 应按方向提示，区分本窗口不继承共享内容与共享会话实际结束，继续提供 Reload Window。`cleanupRuntimePersistenceModeSwitch` 比较期望配置与已应用配置；重启前撤回则不切换。关闭到开启仍须停止原私有执行、清空原私有画布，再读取目标共享范围。

开启到关闭在本窗口最后一个活动 editor/panel 页面关闭、模拟 Runtime reload 或 Extension Host deactivation 边界生效。切换 surface、隐藏页面和普通 Webview 重建不应用设置。若同一共享 root 还有其他已应用开启模式的窗口，本窗口只 detach 自身投影、读者和订阅，不调用共享 session 的 stop/delete、不发布共享空画布、不退出 Supervisor；切换后的私有画布不继承共享内容。多 root 应分别判断，不把其中一个 root 的最后窗口结论推广到其他 root。非最后窗口退出期间 peer 新建的会话仍由共享 owner 持有。

最后一个开启窗口主动切换关闭时，才启动对应共享范围的会话、读者和存储清理；没有新开启窗口接管时，清空原模式画布并确认 Supervisor 退出。实际退出与 registry 为空是不同事实，须分别验证。不能将正常关闭窗口、Reload、断连、Webview 重建或没有 reader 解释为显式关闭持久化；未切换的普通离开保持原进程延续。两个窗口并发切换及清理期间新窗口开启必须协调，不能凭过时的窗口数量继续删除仍被使用的共享执行。无法确认清理资格、接管或完成事实时保留可诊断责任，不伪报成功。

跨 Host 的参与由 `panel/sharedRootCanvasParticipants.ts` 负责：每个已应用开启模式的 Host/root 持有随机 token 的独立 loopback listener（60000–64999），并在 canonical root 文件旁的 `.participants/<token>.json` 原子登记 token/端口；登记不依赖任何 Supervisor socket 或 reader。登记目录/文件权限分别为 0700/0600。探测应答必须与原 token 完全一致，只有 ECONNREFUSED 可以证明失效并移除 stale 登记；超时、响应不符、损坏记录明确失败。普通 dispose 仅释放自身登记，不执行共享清理。

root 准入锁 SHA256(canonical filename) 映射到 10000–19999，覆盖登记、执行 mutation 与主动离开。普通锁竞争每 10ms 重试，登记竞争每 50ms 通过独立参与 listener 请求交接，90 秒上限覆盖既有 Supervisor 30 秒 idle shutdown。多 root 按端口再 canonical path 排序持锁，碰撞端口复用已持 lease。本 Host 已准入的执行 mutation 在离开持锁前排空，新的本地启动拒绝；非最后 root 只 detach。最后 root 的锁保护清理阶段、共享写入及责任交接，允许持锁的旧 Host 通过参与 listener 验证并登记新 Host，不需要提前释放锁或让自动恢复绕过参与资格。最后资格和接管判定均来自已应用开启 Host 的有效参与事实。

无接管时 Supervisor 退出采用原进程的既有 idle shutdown：清理所有对应 binding、读者及本 Host 连接后，进程在无连接、live、pending 责任时等待 30 秒并完成 shutdown 后自然退出。Host 记录经过 owner/profile 校验的 hello PID，离开时还以 allowRestart=false 探测目标 root 当前后端，覆盖本 Host 没有 live reader 的情形，不启动替身。仅明确不存在的 socket/连接拒绝可作为没有当前可连后端的事实；其他探测错误失败。Host 对观察到的原 PID 每 100ms 使用 signal 0 核对，只有 ESRCH 确认消失，45 秒内未消失明确失败；不会发送终止信号，registry 为空不能代替退出。PID 复用会保守拒绝成功。接管确认后改为验证本窗口结算、detach、保存及交接，不再以被新窗口使用的 PID 消失作为本窗口退出条件。

### 清理期间接管的阶段与不变量

新开启 Host 的接管请求必须被 root 参与与清理协调机制识别，不能因旧窗口等待 PID 消失而无法完成登记，也不能只绕过登记先连接就宣称已接管。`SharedRootCanvasDeparture` 记录 preparing/settling/idle/finished 和本次随机离开 ID。沿用原 token listener：先返回身份行，再接收带 target token、独立 peer token/端口的有界 JSON 请求；身份 probe 在收到完整 token 行时结束。协商消息最多 64KiB、单次 5 秒，身份 probe 1 秒；退出会销毁本 listener 的未完成 socket。旧 Host 重新 probe 新 Host 后，在已持 root admission 下原子登记，stage 检查在 probe 之后执行，防止探测期间越过派发边界。

`SharedRootCanvasStore.ready` 只在正常登记或协商登记完成后成功，此时重新读取最新磁盘并投影；watch 与构造阶段不提前发布旧快照。Host 的 `scheduleRestoreLiveRuntimeSessions` 经实际 `restoreLiveRuntimeSessions` 等全部相关 store ready 后才收集重连 binding。初始保存仍按排队时的 base/next delta 合并，不把过时整图当新 base。

`leaveSharedCanvasesForModeSwitch` 保存逐 root departure。`prepareForHostBoundaryCore` 完成输出和保存前置后，在派发 Host 删除 API 前同步冻结清理集合；已确认 preparing 接管的 root 移出集合并屏蔽旧写入，其余进入 settling。没有删除工作时也在空画布提交前冻结。所有 root 的 破坏性写入及旧 Host 最终 workspace 保存完成后才进入 idle；接管后不会再有旧清空提交。

idle offer 来自 owner/profile 校验后的 `{pid, runtimeBackend, runtimeStoragePath, runtimeOwner}`，按后端/存储 slot 保留最新收据，避免旧 PID 与同 slot 新进程混在候选中。新 Host 的 `acceptSharedRuntimeTakeover` 以 allowRestart=false 获取实际 client，检查原 PID、owner 和已有握手规则；确认消息携带 departure ID 及成功连接的候选 PID。旧 Host 再 probe 并登记后确认交接；退出等待只排除仍有效参与者已经确认的 PID，其他 root 和其他原 PID 继续要求 ESRCH。hello/身份失败不伪造交接，本次新获得的 client 在失败时释放；已有无关 client 保留。

原 Supervisor 在 idle 前接受连接会取消 idle timer，进入 shutdownBoundary 后拒绝新 socket。因此无需新增 Supervisor 业务协议。参与协商和 busy discovery 的 ECONNRESET/EPIPE 只重试，不据此移除记录或赋予清理资格；持锁 probe 若原记录仍存在则保守失败。连接关闭/ENOENT/ECONNREFUSED 不等于接管，新 Host 等旧 departure 释放准入后正常登记；其他错误明确失败。已确认接管的控制 client 单独保留，现代 reader 移除后释放没有会话、重连、请求或 relay 责任且未被接管保留的 client。Host 边界或移除 root 释放接管保留。

- 未派发 stop/delete：确认新 Host 的有效接管后取消共享清理，旧 Host 仅 detach，原画布、会话身份和 Supervisor 保留。
- 已派发 stop/delete：这些动作不可回滚，先结算已派发操作及读者、存储责任，再向新 Host 提供一致共享状态；不承诺原执行恢复，旧快照不得复活已删 binding，迟到清理不得覆盖接管后的新状态。
- 共享会话和画布已清空、仅等待 idle shutdown：如果原 Supervisor 仍接受有效连接，确认接管后允许沿用进程，旧 Host 结束退出等待并释放自身责任，新 Host 使用清理后的画布。
- Supervisor 已进入不可取消的关闭阶段：新 Host 等其关闭完成，再按正常流程建立运行时；不能通过一次连接把关闭中的进程认作可接管，也不把新进程认作原会话延续。

接管确认、旧窗口结算与原 PID 消失分别是不同事实。接管不能掩盖未结算或失败的删除与保存；没有接管时仍必须证明退出，有接管时则必须证明旧窗口已完成自身责任。交接须逐 root 协调，旧清理不能删除新 Host 的执行或再次发布过时空画布；接管后的普通离开遵循持久化保证，不恢复已取消的旧清理。新 Host 自动恢复和 reader/control client 生命周期必须纳入协调，不能只保护新建 execution mutation。

当前无 root/显式 stock 对照继续使用原 workspace 边界；root owner 的进程确认范围不能推广成 legacy 任意外部执行的退出保证。存储损坏或端口被外部程序长期占用时有界失败，不能静默降级为单窗口判断。

关闭后重新打开先等待本次退出共享或清理，再应用新模式及恢复 owner 准入。失败/超时保留失败结果及可诊断责任，不伪报完成。清理不是多 root 全局事务，可能已有符合资格的部分 root 完成结算；不能承诺撤销已完成的停止或共享删除，也不能因此清理仍有其他开启窗口的 root。

## 验证与有限结论

以下为用户补充最后窗口规则之前的历史证据，不证明新切换规则成立。Node 22、Linux 与 VS Code 1.141.0 的独立真实双窗口场景通过当时的断言：第二窗口未注入 owner 画布，创建、移动、卡片 resize、删除传播；双向输入输出、PTY resize、stop、Agent delete 正常；带 live Terminal 切换关闭后 registry 为零，两窗口私有 Note 隔离，再开启不继承私有内容。其中“第一个窗口切换后 registry 为零”的断言与新规则冲突，必须改为保留另一个开启窗口的原会话及 Supervisor，最后一个关闭后再验证清理和进程退出。调试证据分别在 `/tmp/dscshare3`、`/tmp/dscshare4`、`/tmp/dscshare5`，日志 `/tmp/dsc-shared-window-final.log` 和 `/tmp/dsc-shared-window-source-final.log`。订阅竞态补丁和最终配置保护补丁的历史复验日志 `/tmp/dsc-shared-window-subscription-final.log`、`/tmp/dsc-shared-window-config-final.log` 同样通过当时的断言，最终窗口工件 `/tmp/dscshare6`。

自动化共享 store 8/8，包括独立子进程并发创建和节点操作串行、删除不复活、几何原子更新、损坏文件保护、工作失败仍提交和初始化竞态。Host 最终 617/617（含最终保存失败及迟到配置保护回归）；类型检查、multi-root helper、存储路径、本地化、smoke runner 环境检查、分页终态、Host 输出信用与 legacy reconnect 通过。初轮 `test:runtime-completed-history` 在未改动 origin/main a39cd8c1 上同样失败：旧测试将新增正常 `execution/deleteBoundary` 诊断当作失去 owner。用户授权修正后，改为精确校验正常请求诊断，并分别验证缺失 owner 的拒绝与正常清理，原完整绑定等断言保持；整套测试通过。历史失败保留，不宣称全量 npm test 通过。

本轮真实共享场景为 Linux 单 root，未新跑 macOS/Windows/Remote SSH 或真实多 root 两窗口；Node 内置 fs/net 路径与既有 multi-root helper 不替代这些产品证据。大画布高频编辑的完整快照读写/比较与每 root 100ms 轮询成本尚未量化。残余范围登记于 `docs/exec-plans/tech-debt-tracker.md`。

修订说明（2026-10-11）：迟到 stop 投影只屏蔽已结束 runtime 身份和生命周期，不覆盖用户新编辑的启动配置；删除/替换节点清除旧投影记录，新增 Host 回归覆盖。

修订说明（2026-10-11，PR #319 review 后用户确认）：共享清理资格改为最后一个开启窗口主动切换关闭，并要求 Supervisor 退出。产品规格第 11 节新增非最后窗口保留、最后窗口清理、普通离开对照及并发/multi-root 验收。当前仅同步产品和设计定义，不修改运行时代码，不把旧测试通过追认为新规则已验证。


修订说明（PR319 review 修复）：新增参与准入、逐 root 离开与 PID 退出核验方案；deferred 与终态配置交错用实际 Host/store 回归覆盖，新双窗口通过证据和首轮失败分别保留。


### PR319 更新评审修复的新增证据

本节记录 `e79aa66d` 在进一步确认接管规则之前的有限验证，既有“登记等待清理”断言仅证明当时串行方案。2026-10-11 复核在实际 Host/store 受控交错中观察到新 Host 登记未完成却已 attach；清空后节点/session 为零，控制 client 仍在。以真实控制 socket 连接最新源码启动的空 Supervisor，实际 PID 退出等待约 45053 ms 后明确失败。脚本 `/tmp/pr319-rereview-host.mjs`、日志 `/tmp/pr319-rereview-join.log`，评审见 PR #319 评论 `6109671593`；这是受控 attach 响应和实际 idle 行为证据，不是新增真实 VS Code 双窗口或 native PTY 接管验收。用户据此确认允许接管，原评审要求所有新窗口等原 PID 消失的建议被替代，接管协调仍须修复。

最终修复工作树在 Node 22.23.3、Linux x64、VS Code 1.141.0 和既有 native execution assets 下完整 Host 628/628（新增 review 回归 11 项）、共享 store 15/15、owner handshake 47 项通过；typecheck、runtime root ownership、startup profile/reader client、completed-history、localization 和 multi-root composition 均通过。store 覆盖独立进程同时离开仅一个获得最后资格、新加入等待清理、普通 dispose 不清理、crash 后连接拒绝才移除、失败保留参与、损坏登记拒绝，以及实际端口哈希碰撞下多 root lease 复用。Host 回归核对 deferred delete/edit 的内存和正式磁盘、stop 新配置及后续保存、detach 中 peer 新建保留、multi-root 仅删除最后 root、清理失败、在途启动排空、registry 空但 PID 活着仍等待、迟到页面保存不复活，以及设置撤回后 deactivation 仍等待原离开结果。

最终真实双窗口 /tmp/dsc319r4（/tmp/pr319-smoke-final.log，exit 0）完成共享创建/移动/卡片 resize/删除、双向 I/O、PTY resize、stop 和 Agent delete。普通未切换模拟 reload 保留原 Terminal 身份和 Supervisor PID；owner 切换关闭后 peer 原 Terminal 继续 I/O/resize，原 runtimeSessionId 不变，peer 再新建 Terminal 成功。peer 最后主动关闭后 registry/binding 为零、原 hello PID 消失，双方私有 Note 隔离、再开启加载空共享 root。运行输入 SHA256、原身份、PID 和握手摘要存于 `docs/references/shared-root-canvas/pr319-review-repair-evidence.json`。

首轮新增场景 /tmp/dsc319r1 的最后离开退出事实已观察，但重新开启后的并发 reset 在两条旧绑定删除未确认处失败；不将该轮称为通过。受控 Host 回归确认等待进程退出期间的旧页面保存可重建清空 root，保存屏蔽已前移到边界结算后、直接清空前；第二轮 /tmp/dsc319r2、第三轮 /tmp/dsc319r3 和最终 /tmp/dsc319r4 均完整通过。初轮 /tmp/pr319-smoke-r1.log 和原失败工件保留。该受控验证确定保存保护必要性，不把日志中未逐事件记录的页面调用顺序写成已经证明的首轮唯一原因。

历史文档澄清时提出的接管验收新增四个阶段对照：stop/delete 派发前保留原执行，派发后结算不可撤销动作，idle 等待中接管原进程并让旧窗口切换成功，不可取消关闭后正常建立运行时。还须验证实际 Host 自动恢复、接管失败、接管后的新执行与迟到清理竞争、multi-root 部分接管，以及无接管仍确认原 PID 消失的对照。当时仅同步文档与 review 口径，未实现或验证接管；后续结果见下一节。


### PR319 接管协调的新增证据（2026-10-11）

本轮处理评论 `6109671593`，输入 head `6fd61651`。Node 22/Linux 下共享 store 20/20 与完整 Host 634/634 通过；Host 6 项新增回归经实际自动恢复调度和 store 验证派发前保留、派发后等待结算及旧 binding 不复活、失败 hello 释放连接、现代 reader/control 保留与释放、multi-root 接管只解除对应 PID。独立子进程 store 对照验证有效 preparing 接管、settling 等待、idle 确认及无效 PID 确认不交接。新增两项 reset 回归分别核对协商与 busy discovery 的连接重置只重试、保留参与记录，不把未知身份判成失效；连续三次 store 全套各 20/20。

额外用 `DEV_SESSION_CANVAS_TAKEOVER_NATIVE=1` 运行实际 Host 与最新源码的独立 Supervisor 3/3：实际 owner/profile hello 确认原 PID 的 idle 接管，旧 Host 无需等该 PID 消失即完成模式切换；同一 Supervisor 新建真实 Linux native Terminal，旧保存不删除其 binding，实际 attach 仍 live，测试最后结算该新会话；移除 root 释放接管保留的空进程控制连接。不可取消关闭对照实际执行 Supervisor prepareForShutdown，已关闭 listener 不能作为 PID 退出，joining Host 不保留失败 client、不宣称接管，直到原进程退出后才能正常登记；无接管同样须等待原 PID 消失。后两项测试刻意在真实 shutdown report settled 后保持测试子进程，分别检查监听关闭和 PID 消失，最后只退出测试自身子进程。

真实独立 VS Code 双窗口场景 `/tmp/dsc319takeover3`、`/tmp/pr319-takeover-smoke-final3.log` exit 0，复验共享结构、双向 I/O、PTY resize、stop/delete、非最后切换保留和最后无接管自然退出。该 smoke 未新增四个阶段的 UI 受控暂停；四阶段交错来自实际 Host/store 与独立 Supervisor 的定向回归，不能称为新增真实双窗口四阶段 UX 验收。typecheck、root ownership/owner handshake、startup profile/reader client、completed-history、localization、multi-root composition 通过，未运行全量 npm test。新输入和日志 SHA256 见 `docs/references/shared-root-canvas/pr319-takeover-evidence.json`，保留旧失败复现与上轮证据，不追认旧 head 已实现接管。

修订说明：接管协调从已确认规则落到独立参与 listener、store ready、Host 分阶段退出与原 PID 交接。跨平台/Remote SSH/真实多 root 及高频成本继续保留原验证边界。
