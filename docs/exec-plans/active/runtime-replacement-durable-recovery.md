# 历史态 Runtime 替换的持久恢复闭环

本 `ExecPlan` 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘` 这几个章节。

本计划遵循仓库根目录的 `docs/PLANS.md`。所有文件路径都相对于仓库根目录。实现者应在 `runtime-resume-unreachable-replacement` 分支上继续工作，不清理用户的未跟踪文件 `Note5.md`、`communication.md`、`img_v3_0216r_1084c22d-5868-4740-93a0-3fa099f6ce8g.jpg` 和 `tmp.md`。

## 目标与全局图景

用户在现场遇到的情况是：画布在人工清理 `/tmp` 后仍显示历史态 Claude Agent；点击 Resume 时，扩展尝试严格删除旧 Runtime 会话，连接因 `/tmp/dsc-root-*` 不存在而返回 `ENOENT`，旧实现把这种“无法连接”当成普通失败永久阻断，于是界面反复显示 `Runtime deletion is unconfirmed`。已有 P0 修改能在严格确认“节点是历史态、没有本 Host 的活动执行/读者/共享责任、原绑定和 owner 未变化”时，先写一份停止未确认回执，再替换旧绑定。

本计划不把 P0 当作成熟闭环。完成后用户应该看到以下行为：只有删除请求确实尚未提交、连接不可用且尝试已经结束时才允许替换；删除已经提交但结果未知时继续阻断；替换新执行前先落盘持久操作记录，并在 Host 崩溃后按预留 session identity 查询和恢复，不生成第二个身份；对删除前的端点缺失只做一次受同一次操作截止时间约束的复探，不靠重启旧 Supervisor 或伪造目录来“修复”。用户仍会收到明确风险提示，知道原后台进程可能继续运行。

可观察验收包括：隔离测试夹具中模拟 `ENOENT` 后 Resume 不再永久卡死；删除 RPC 已提交后断连不会走替换例外；创建栅栏、RPC 发送、响应和最终保存四个故障点都不会静默丢失原执行；Host 重载后若预留 session 存在则接回同一身份，若查询无法证明不存在则进入 quarantine；全程不清理真实 `/tmp/dsc-root-*`。

## 进度

- [x] (2026-11-04) 保留并核对已有 P0 修改：历史态断连替换、`runtime-replacement` 回执和定向 Host 回归。
- [x] (2026-11-04) 完成 HORIZON-OG-Astra 对 P0 方向的审核，记录创建结果未知、删除提交阶段未分类、共享责任不可全局证明等缺口。
- [x] (2026-11-04) 实现 PR1：strict delete 增加 `preparing`、`socket-directory`、`connecting`、`handshake`、`dispatching`、`submitted` 阶段；替换资格只接受删除未提交、尝试已结算且错误码为 `ENOENT`/`ECONNREFUSED` 的端点缺失组合；Resume 文案明确为新的 Runtime 执行。
- [x] (2026-11-04) 实现 PR2：新增版本化 journal、Agent/Terminal 创建前双阶段栅栏、预留 session identity、启动 metadata 保存等待、重载 recovery/quarantine、prepared 回滚、bound-missing 回退、`not-acquired` 已结算阶段和 rootless 稳定键。
- [x] (2026-11-04) 实现 PR3：删除提交前失败使用同一 deadline 做一次有界复探，不重启 Supervisor、不重建 socket 目录；补真实 Unix socket 恢复与隔离删除夹具。
- [x] (2026-11-04) 将未知替换责任接入单节点删除、组删除、组清空、root 清空和 reset；只有节点状态成功持久化后才清理 journal。
- [x] (2026-11-04) 同步设计、产品规格、中文本地化、技术债跟踪和验证证据。
- [x] (2026-11-04) 运行类型检查、journal 单测、Host 定向回归、协议、root ownership、startup profile、真实 socket 恢复及静态检查。
- [x] (2026-11-05) 修复 HORIZON-OG-Astra 复审指出的五个缺口：恢复成功后结算内存创建栅栏、strict-delete 共享连接阶段广播、`not-acquired` 独立已结算阶段、confirmed bound 与瞬时查询失败分离、批量删除按 operationId 条件清理 journal。
- [x] (2026-11-05) 修复第二轮 HORIZON-OG-Astra 复审指出的两个 P1：journal 锁不再按年龄抢占仍存活的 owner，malformed 锁失败关闭，stale 回收用 generation 作用域标记串行化且标记不自动清理；批量删除除 operationId 外还核对 phase/updatedAt，阶段推进后先写停止未确认回执并保留记录。同时修复同进程 in-flight creation 的重复 Start 被误送入 journal 恢复的回归，并区分“调用仍在执行”与“调用已结束但结果未知”，后者允许受控 reconcile。

## 意外与发现

- 观察：HORIZON-OG-Astra 只读审核确认 journal 不能只用 Host 当前 `nodeId` 作键，因为单 root 与多 root 窗口可能对同一 root-local 节点使用不同 namespace ID。
  证据：`common/canvasMultiRootComposition.ts` 的 `namespaceCanvasObjectId()` 会改变跨窗口可见 ID；计划必须使用 canonical root + root-local node ID + kind 定位同一操作。

- 观察：查询 snapshot 与应用恢复结果之间如果没有共享 lease 和提交前复核，另一窗口可能在间隙完成新替换，旧 snapshot 会覆盖新绑定。
  证据：`sharedRootCanvasStore.ts` 的 `mutate()` 已提供跨进程 lease；恢复路径必须在该 lease 内完成查询后的身份/operation/phase 复核、状态应用和 journal 更新。

- 观察：只检查 `submitted` 和 `attemptSettled` 仍会放行 handshake 阶段断连。
  证据：`isRuntimeConnectionUnavailable()` 接受 `ECONNRESET`、`EPIPE`、`ETIMEDOUT`；这些可能发生在 hello 阶段。只有 `socket-directory`/`connecting` 加 `ENOENT`/`ECONNREFUSED` 才是本例外允许的端点缺失组合。

- 观察：现有 P0 只看 `isRuntimeConnectionUnavailable(error)`，没有检查 strict delete 是否已提交。
  证据：`panel/runtimeSupervisorClient.ts` 的 `StrictRuntimeDeleteObservation` 已有 `submitted`、`attemptSettled` 和 `current()`，但 `CanvasPanelManager.ts` 的 `DisconnectedRuntimeNodeDeletionError` 只携带 `binding` 和 `connectionError`。

- 观察：Agent 和 Terminal 在更新新 session metadata 后调用 `persistState()` 但未等待完成，随后就提交 `createSession`。
  证据：`startAgentSessionWithSupervisorCore()` 的 `agent-supervisor-launching` 保存和 `startTerminalSessionWithSupervisorCore()` 的 `terminal-supervisor-launching` 保存均未 `await`。

- 观察：Supervisor 的重复 session 返回 `sessionAlreadyExists`，不是幂等创建结果。
  证据：`supervisor/runtimeSupervisorMain.ts` 的 `createSession()` 在 `this.sessions.has(sessionId)` 时抛错。

- 观察：`strictRuntimeDeletes` 和 `candidateRuntimeStarts` 只解决单 Host 内存中的重试与保护，不是跨 Host 崩溃后的持久事务日志。
  证据：两者都是 `CanvasPanelManager` 的内存 Map，Host 重建后不会恢复。

- 观察：当前共享 mutation identity 只比较 `kind`、`runtimeSessionId`、`runtimeBackend` 和 `runtimeStoragePath`，不能证明 owner、attachmentState 与生命周期也未变化。
  证据：`withSharedExecutionMutation()` 的 `identity()` 只序列化这四个字段。

- 观察：只在连接目标 Supervisor 之后恢复 journal，会使“目标 namespace 不可达”成为无法解除的死锁。
  证据：截图中的 Resume 需要先连接原 Supervisor 才能执行删除；若原 socket 目录已删，连接阶段先返回 `ENOENT`，reconcile 永远没有机会运行。

- 观察：socket 写入抛错不能被当作“明确未提交”并按普通失败清理观察。
  证据：`runtime-supervisor-reader-client` 的写入异常回归要求原 strict-delete observation 保留；现实现将“已尝试 dispatch”保守视为提交未知，但仍不满足选择 `ENOENT`/`ECONNREFUSED` 端点缺失白名单，因此不会放行替换。

- 观察：只保存 target binding 不足以回滚 `prepared`。
  证据：启动 metadata 可能在创建 RPC 前落盘；journal 必须额外保存原始节点 status、summary 和 metadata，才能恢复历史节点而不是留下 target 投影。

- 观察：`create-may-have-been-submitted` 的目标会话明确不存在时，生成新 UUID 仍不安全。
  证据：当前恢复只在记录已经进入 `bound` 且查询返回 session-not-found 时回到可重试历史；创建结果未知阶段继续 quarantine，避免把“从未创建”和“创建后消失”混为一谈。

- 观察：删除或清空节点时只删 journal 会丢失未知创建责任。
  证据：删除、组清空和 reset 现在先为 `create-may-have-been-submitted`/`quarantined` 写 stop-unconfirmed 回执，再允许状态删除。

- 观察：批量删除在“检查 journal”和“删除 journal”之间仍可能遇到另一窗口写入的新 operation。
  证据：组删除、组清空、root 清空和 reset 都不是一个持续到清理阶段的 root lease；仅按稳定键无条件删除会误删新责任。现改为记录准备时的 `{operationId, phase, updatedAt}`，journal 写入/删除共享 per-record lock，并在最终清理时按完整责任指纹条件删除；新 operation 或同 operation 阶段推进都保留并补写回执。

- 观察：恢复成功接回同一预留 session 后，内存中的 `candidateRuntimeStarts` 仍可能是 `submitted:true, settled:false`，随后删除/reset 会被自身栅栏阻断。
  证据：现有回归曾在恢复前手工清空 `candidateRuntimeStarts` 绕过问题；现在恢复只在 sessionId/kind 精确匹配时结算并移除同一 reservation，回归不再手工重置。

- 观察：多个 strict-delete observation 共享连接时，后加入者可能只看到自己的初始 `connecting` 阶段，导致 hello 失败被错误归入 endpoint-missing 白名单。
  证据：连接阶段现在由共享 attempt 广播给所有观察者；hello 失败的两个观察者都记录 `handshake`，不会进入历史态替换例外。

- 观察：把 `not-acquired` 写回 `prepared` 与外层节点回滚不一致。
  证据：外层收到 typed `not-acquired` 后会清空 target binding，而 `prepared` reconcile 要求原 binding，下一次启动会错误 quarantine。现在 `not-acquired` 是独立已结算阶段，允许缺失/原始/target binding，并走同一安全回滚后普通重试。

- 观察：`bound` 查询短暂失败后直接 quarantine 会永久丢失 bound-missing 资格。
  证据：`bound`（或 `boundConfirmed`）查询遇到非 session-not-found 错误只保留 blocked 与诊断，不改 phase；连接恢复后明确 session-not-found 仍可清理 target binding 并回到可重试历史。

- 观察：按锁文件年龄判定 stale 会抢占仍在提交的 owner；两个回收者基于同一旧观察也可能移走后继锁。
  证据：Astra 从源码提取锁函数后，在受控内存文件系统与时钟中同时复现“活跃锁超过 30 秒被抢占”和“第二个 stale 回收者移走新 owner 的锁”。锁年龄不能证明 owner 已停止。

- 观察：同一 operationId 从 `prepared` 推进到 `create-may-have-been-submitted` 后，仅按 operationId 清理仍会删除未知创建责任。
  证据：批量删除在准备阶段只保存 operationId；等待其他节点期间原启动推进 phase 但不改 operationId，最终条件删除仍匹配。Astra 在内存中执行当前准备/清理方法确认 journal 被删除且回执数量为零。

- 观察：`admitRuntimeReplacementRecoveryBeforeStart()` 会把同一 Host 尚未结算的创建栅栏当作待恢复 journal 查询。
  证据：重复 Start 命中 `candidateRuntimeStarts` 时，旧顺序先进入 journal recovery；测试客户端没有 `getSessionSnapshot`，节点被改为 `history-restored` 并写入 quarantine error。该失败在按名字选择 S9 提交中创建用例时复现。

- 观察：只按“reservation 是否存在”拒绝重复 Start 会误伤已经结束但结果未知的创建。
  证据：create 响应丢失后调用结束，reservation 仍是 `submitted:true, settled:false`；若不区分调用生命周期，同 Host 的显式恢复入口会被直接拒绝，无法查询预留 session。现在 reservation 带 `inFlight`，只有真正执行中的调用拒绝重复启动，结束后保留的记录进入受控 reconcile。

- 观察：malformed 锁按年龄回收和自动清理 abandoned reclaim marker 都会重新引入“依据旧观察操作新路径”的竞争。
  证据：Astra 用受控内存文件系统复现：活 owner 在 `open(wx)` 后暂停超过 60 秒会被当作 malformed stale 回收；两个清理者可基于旧观察删除后来取得的 live marker，随后原回收者删除后继锁。现在 malformed 锁不回收集，标记只在持有者 `finally` 中按自身路径删除，残留标记失败关闭。

## 决策记录

- 决策：保留 P0 的“先写停止未确认回执再替换”方向，但把它改成更窄的 pre-submit 例外。
  理由：回执能保留人工清理责任，但原先没有证明删除 RPC 尚未提交；若删除已提交而响应丢失，替换可能制造并发执行。
  日期/作者：2026-11-04，HORIZON-OG-Astra 审核与本地代码核对。

- 决策：不引入第二套所有权系统，不实现通用分布式事务；复用 `candidateRuntimeStarts`、`strictRuntimeDeletes`、共享 root store lease 和现有 runtime owner 校验。
  理由：缺口是创建/删除边界没有持久证据，不是需要重新设计整个 Runtime。
  日期/作者：2026-11-04，本计划。

- 决策：新增独立的 `runtime-replacements-v1` 操作记录，而不是把创建栅栏塞进停止未确认回执。
  理由：停止回执只表达“原进程停止未确认”，不能表达“新 session 是否已提交、预留身份是什么、是否已绑定”。两类责任必须分开。
  日期/作者：2026-11-04，本计划。

- 决策：一旦记录进入 `create-may-have-been-submitted`，Host 崩溃后不得重新生成 session UUID；只能查询该预留身份、接回或保留 quarantine。
  理由：`sessionAlreadyExists` 不是幂等创建结果，重新生成 UUID 会产生无法关联的第二个执行。
  日期/作者：2026-11-04，本计划。

- 决策：有界复探只覆盖删除提交前的端点缺失/拒绝连接，并复用第一次操作建立的截止时间；用户再次点击不能刷新本轮边界。
  理由：重复点击不应当变成无限后台重试，也不能在删除已提交时增加并发风险。
  日期/作者：2026-11-04，本计划。

- 决策：journal 的稳定键改为 canonical runtime root + root-local node ID + kind；operation 中保留当前窗口 node ID 作为调试信息，但文件定位不依赖它。
  理由：同一共享 root 的节点可能在不同窗口拥有不同 namespace ID，单靠 Host 当前 ID 会绕过创建栅栏。
  日期/作者：2026-11-04，HORIZON-OG-Astra 审核。

- 决策：所有 journal reconcile、状态提交和 journal 更新都在 `withSharedExecutionMutation()` 的 root lease 内执行，并在查询返回后重新核对节点完整 binding、operationId、记录的 node identity 和 phase。
  理由：原子文件写入只保证单次替换，不提供跨窗口条件提交；必须让查询与提交共享同一互斥边界。
  日期/作者：2026-11-04，HORIZON-OG-Astra 审核。

- 决策：PR1 的删除例外使用 phase 与错误码白名单，且 observation 缺失时拒绝。只允许 `socket-directory`/`connecting` 阶段的 `ENOENT`/`ECONNREFUSED`。
  理由：handshake 断连、已提交 RPC 和权限/owner 错误都不能证明删除未发生。
  日期/作者：2026-11-04，HORIZON-OG-Astra 审核。

- 决策：`prepared` 记录可安全移除并普通重试；`create-may-have-been-submitted` 和 `quarantined` 保留；`bound` 在节点状态和绑定成功提交后归档，删除节点时保留停止回执而不是删除未知创建责任。
  理由：只有 `prepared` 能证明 RPC 尚未提交；其他阶段必须保守处理，避免重复执行。
  日期/作者：2026-11-04，HORIZON-OG-Astra 审核。

- 决策：Resume 文案明确为“启动新的 Runtime 执行并尝试继续原 provider 对话”，不说“恢复原 PTY”或“复活原执行”。
  理由：Claude Resume 会启动新的 CLI/Runtime 执行；旧进程可能仍在运行，并发访问同一 provider 会话的风险需要保留。
  日期/作者：2026-11-04，本计划。

- 决策：Agent/Terminal 的显式 Start/Resume 在任何 Supervisor 连接之前，先按 journal 的 target owner/backend 执行一次无重启 reconcile。
  理由：目标 namespace 不可达时不能把连接失败当成“没有待恢复记录”；prepared 可以本地回滚，其他阶段可以在连接可用时查询预留身份，连接不可用则进入 quarantine。
  日期/作者：2026-11-04，本计划。

- 决策：严格删除的“已尝试 write”按提交未知处理，即使 `socket.write()` 同步抛错也不重新生成删除观察。
  理由：Node socket 写入异常不能证明内核没有接收任何字节；保留唯一 observation 可以避免下一次点击重放删除或误用 pre-submit 例外。
  日期/作者：2026-11-04，本计划。

- 决策：rootless journal 键优先使用 `context.storageUri`，而不是共享的 global storage。
  理由：多个 rootless workspace 可以在同一 global storage 下拥有同名本地节点，必须按 workspace-scoped storage 隔离责任。
  日期/作者：2026-11-04，本计划。

- 决策：把 Supervisor 明确返回的 `not-acquired` 记录为独立 `not-acquired` 阶段，而不是降级为 `prepared`。
  理由：资源明确未取得，但外层节点 rollback 可能已经清空 target binding；`prepared` 要求原 binding 会把已结算结果误判为不匹配。`not-acquired` 明确表示“无 target 资源、可安全回滚/重试”，并允许缺失、原始或 target binding。
  日期/作者：2026-11-04，HORIZON-OG-Astra 复审。

- 决策：恢复成功或 bound session 明确消失并回到历史态时，按同一 reserved sessionId 结算本地 `candidateRuntimeStarts`；不匹配的 reservation 不改写。
  理由：持久恢复与进程内 reservation 是同一创建责任的两个视图，成功接回/确认缺失后任一视图遗留都会错误阻断删除或 reset。
  日期/作者：2026-11-04，HORIZON-OG-Astra 复审。

- 决策：strict-delete 共享连接保存共享 phase，并向所有等待同一连接的 observation 广播。
  理由：后加入观察者不能把已开始的 hello 误报成 `connecting`；否则 `ENOENT` 会错误满足替换白名单。
  日期/作者：2026-11-04，HORIZON-OG-Astra 复审。

- 决策：journal 写入与删除使用同一 per-record 跨进程锁；stale 回收只接受可证明已退出的 PID，绝不按锁年龄抢占；malformed 锁一律失败关闭；写入 owner 后、进入临界区前重新核对 generation。回收使用 generation 作用域 `wx` 标记，让同一旧观察只有一个回收者；标记本身不自动清理，回收者在标记内重新读取并核对 generation 后再删除锁。
  理由：锁年龄和 malformed 内容都不能证明 owner 已停止；自动清理标记会把同一旧观察竞争移到标记路径。保留进程崩溃后的锁回收能力，同时把“活跃 owner 被抢占”和“旧观察删除后继锁”从正常路径移除；标记残留选择失败关闭。
  日期/作者：2026-11-05，第二轮 HORIZON-OG-Astra 复审。

- 决策：批量删除记录准备阶段观察到的 `{operationId, phase, updatedAt}`，`removeRuntimeReplacementIfCurrent()` 三者全部匹配才删除。任何字段变化都视为新责任：若当前 phase 可能已取得预留执行（`create-may-have-been-submitted`、`quarantined`、`bound`），先写 stop-unconfirmed 回执，再保留 journal 并记录诊断。
  理由：operationId 只能识别“另一个 operation”，不能识别同一 operation 从准备到提交的阶段推进；责任必须按观察到的完整责任状态结算，而不是按身份键删除。
  日期/作者：2026-11-05，第二轮 HORIZON-OG-Astra 复审。

- 决策：start 准入先检查本进程 `candidateRuntimeStarts` 中该节点 reservation 是否仍 `inFlight`；是则沿用既有“创建仍 pending/unconfirmed”拒绝，不读取或查询 journal。调用结束后的未知 reservation 保留并允许受控 reconcile。
  理由：本进程仍在执行的 journal 是创建栅栏，不是可恢复的旧操作；把它送入 recovery 会把正常重复 Start 变成 quarantine 状态修改。但已经结束的调用必须能通过预留 session 查询收口，否则同 Host 显式恢复被永久阻断。
  日期/作者：2026-11-05，定向 Host 回归。

- 决策：bound 确认使用 `phase: 'bound'` 和持久 `boundConfirmed: true` 双重表达；查询连接失败只阻断，不 downgrade/quarantine，明确 session-not-found 才回到可重试历史。
  理由：当前查询是否可达与历史创建/绑定是否已确认是不同事实；短期断连不能抹掉后续 session-not-found 的合法处理资格。
  日期/作者：2026-11-04，HORIZON-OG-Astra 复审。

## 结果与复盘

本轮保留了 P0 的停止未确认回执和明确提示，同时把“不可达即可替换”收紧为可证明的 pre-submit 例外。PR1 交付了 strict-delete 阶段和错误码白名单；PR2 交付了跨 Host 重建仍可追踪的 journal、创建栅栏、预留身份、恢复/quarantine 和删除责任留存；PR3 交付了一次同 deadline 的有界复探。现场截图中的 Resume 路径现在会先读取 journal，再决定回滚、接回、quarantine 或继续普通启动，不会因为目标 `/tmp/dsc-root-*` 不可达而跳过恢复逻辑。复审补齐了恢复后内存 reservation 结算、共享 handshake 阶段传播、`not-acquired` 已结算阶段、bound 瞬时断连与 confirmed bound 分离，以及批量删除的条件 journal 清理。第二轮复审又把锁回收限制为死 PID + generation 作用域标记，并把条件删除提升为 `operationId + phase + updatedAt` 责任指纹；阶段推进先写回执并保留记录。

受控验证证明：

- `npm run typecheck` 通过。
- `npm run test:runtime-replacement-journal` 通过 `1/1`，覆盖原子替换、损坏记录拒绝、稳定键、`not-acquired`/`boundConfirmed`、责任指纹条件删除、活跃/malformed 锁不按年龄抢占、死 PID 回收、generation 标记互斥和残留标记失败关闭。
- `npm run test:ui-copy-localization` 通过。
- Runtime replacement 相关的 Host 定向用例通过 `71/71`（`--name-pattern "S9 |group clear|disconnected|creation fence|runtime replacement|Host reconciliation"`），覆盖恢复后删除、`not-acquired` 栅栏删除失败、bound 瞬时断连、批量删除交错、同一 operation 阶段推进后的回执保留、同进程 in-flight creation 的重复 Start 拒绝，以及调用结束后的未知 reservation 通过预留身份 reconcile（不再手工清空 `candidateRuntimeStarts`）。
- `test:runtime-root-ownership` 中 Host 定向通过 `19/19`；真实 socket recovery native 通过两种 socket 删除场景及实际 Host 删除。
- `test:runtime-supervisor-startup-profile` 通过，reader client 为 `39/39`。
- `npm run test:runtime-supervisor-protocol` 全套通过，包含真实 socket timeout 和 10-Agent 容量基准。
- `git diff --check`、修改脚本的 `node --check` 通过。

未完成或未验证：

- 完整 `test-host-execution-owner-wiring.mjs` 仍在既有 `detached restored ... restart uses target evidence` 用例失败（`creates` 实际 `0`、期望 `1`），该失败已在未修改的 `origin/main@23418301` 独立 worktree 复现；本次没有把它归因于替换修复。完整文件因此未全绿，后续同类基线用例未在本轮重新执行。
- 同类基线失败 `detached restored ... retires confirmed history before rejecting an incompatible replacement`（`inspections` 实际 `0`、期望 `1`）也已在本轮用干净 `23418301` worktree 复现，未归因于替换修复。
- journal 锁的 generation 标记若在写入/`sync`/`close` 失败或回收者崩溃时残留，会保守阻断该记录直到人工移除；本轮没有增加自动回收，因为再次回收没有可靠的原子比较删除原语。malformed 锁同样失败关闭。人工删除 `.lock`/`.reclaim-*` 前必须先停止或隔离所有可能访问该记录的 Host/回收者，不能仅凭文件年龄判断安全。跨进程同记录并发也不是产品承诺的常规路径。
- 没有启动真实 VS Code UI 重放截图中的 Resume，也没有使用真实 Claude/Codex 登录并发访问同一 provider 会话。
- 真实 Unix socket 验收只覆盖 Linux 当前环境；macOS、Windows、Remote SSH、机器重启和 Supervisor 自身崩溃后的恢复仍未验证。
- 共享责任只能证明本 Host 和本地共享 store 中可见的引用，无法证明其他机器或不可达 peer 的全局责任；该风险继续以警告和回执表达，不写成已消除。
- 若 journal 目录出现无法解析的记录，当前恢复会记录诊断并停止本轮批量 reconcile；损坏文件的人工处置、节点已远端删除后的 orphan journal 清理和目录级 `fsync` 仍列入技术债。

## 上下文与定向

本仓库是 VS Code 扩展 Dev Session Canvas。`extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts` 是扩展 Host 侧的画布和 Runtime 会话管理器；`extensions/vscode/dev-session-canvas/src/panel/runtimeSupervisorClient.ts` 是 Host 与独立 Supervisor 进程之间的 Unix socket RPC client；`extensions/vscode/dev-session-canvas/src/supervisor/runtimeSupervisorMain.ts` 是 Supervisor 主进程。

Runtime Persistence 开启时，Agent/Terminal 的执行由 Supervisor 托管。节点 metadata 保存 `runtimeSessionId`、`runtimeBackend`、`runtimeStoragePath`、`runtimeOwner` 等绑定。`history-restored` 表示当前 Host 只有历史结果，不能据此推断原 PTY 已停止。严格删除（strict delete）是指带截止时间、只按原 backend/storage/session/kind/owner 执行，并保留迟到观察的删除路径。

本计划用“创建栅栏”表示在调用 `createSession` 前先持久化操作意图，并用预留 session identity 约束重试。用“quarantine”表示 Host 无法证明新执行未创建或无法接回时，保留责任并阻止用户继续生成新执行，而不是把未知状态伪装成可普通重试的失败。

用户现场的 `/tmp/dsc-root-*` 是 root runtime socket 目录。人工删除后，旧 Supervisor 可能仍运行但已不可达；修复不能删除或重建用户的真实临时目录来伪造恢复，也不能按 PID 清理旧进程。

## 工作计划

PR1 先修改 `runtimeSupervisorClient.ts`：给 `StrictRuntimeDeleteObservation` 增加只读阶段，例如 `preparing`、`connecting`、`handshake`、`dispatching`、`submitted`、`settled`。在 `deleteSessionStrict()` 内只在真正写入请求后才设置 `submitted`。给 `CanvasPanelManager.ts` 的 `DisconnectedRuntimeNodeDeletionError` 增加 observation 快照，并让 `deleteRuntimeSupervisorSessionsWithCandidate()` 从当前 strict delete 记录带上 `submitted` 和 `attemptSettled`。`prepareExecutionCandidateReplacement()` 只有在连接不可用、`submitted === false`、`attemptSettled === true`、节点为历史态、绑定/owner/token 当前且无共享责任时才允许回执替换；其他服务端失败、权限错误、handshake/owner 冲突、已提交未知都继续保留原 observation 并阻断。同步修正警告和 Resume 相关文案。

PR2 新增 `extensions/vscode/dev-session-canvas/src/panel/runtimeReplacementJournal.ts`。它提供版本化记录、原子 JSON 写入、按 node/kind 读取、更新、删除和 quarantine。记录至少包含 `operationId`、node identity、原完整 binding（含 owner、attachmentState、lifecycle/status 所需字段）、目标 backend/storage/owner、预留 sessionId、launch mode、provider resume 引用、停止结果、证据来源、phase 和时间。写入使用同目录临时文件、`sync`、`rename`，失败时不得继续提交创建。

Agent/Terminal 创建路径在 `getPreferredRuntimeSupervisorClient()` 与旧 binding 处理之后、`createSession()` 之前创建 operation：先写 `prepared` 并等待完成；再写 `create-may-have-been-submitted` 并等待完成；只有两步都成功才提交 RPC。创建前还要等待节点 metadata 的 `persistState()` 完成。成功返回 snapshot 后应用 snapshot、保存节点状态并等待完成，最后把记录标记为 `bound`。显式 `not-acquired` 且在 Supervisor 尚未获取资源时删除记录，保留现有普通重试；`sessionAlreadyExists`、连接未知、响应丢失或最终保存失败不能被当作普通可重试失败。

Host 恢复时新增 `reconcilePendingRuntimeReplacements()`：扫描记录，按预留 target binding 与 sessionId 查询 `getSessionSnapshot()`。匹配同一 kind/sessionId 的 snapshot 可以接回、应用并标记 `bound`；查询明确不存在或连接失败时保留责任并设置 quarantine，既不自动 start/resume，也不生成第二个 UUID。`restoreLiveRuntimeSessions()` 在普通历史恢复前调用该 reconcile；显式 Start/Resume 也先检查记录，避免把待恢复的新执行当作旧 predecessor 删除。

PR3 在 `prepareExecutionCandidateReplacement()` 捕获 pre-submit 连接失败后，用同一次 `candidateRuntimeStarts` reservation、同一节点操作 token、同一截止时间再调用一次 strict delete。该复探不启动 Supervisor、不创建 socket 目录、不重新连接用户真实 `/tmp`，且只对删除提交前失败生效。复探成功则正常继续；仍不可用则按 PR1 的回执路径继续，超时仍表达“不可达”，不是“已停止”。

文档同步 `docs/design-docs/runtime-socket-recovery.md`、`docs/design-docs/runtime-legacy-reconnect-retirement.md`、`docs/design-docs/runtime-root-ownership.md`、`docs/design-docs/core-beliefs.md`、`docs/design-docs/index.md`、`docs/product-specs/runtime-persistence-modes.md` 和 `docs/product-specs/canvas-core-collaboration-mvp.md`，并在完成后登记仍未覆盖的真实生命周期/跨平台/并发 provider 风险。

## 具体步骤

1. 在仓库根目录运行 `git status --short`，确认仍在 `runtime-resume-unreachable-replacement` 分支且用户未跟踪文件未被修改。
2. 实现 PR1 的 strict-delete observation 阶段和 Host 资格判定。运行定向 Host 测试，先证明“删除已提交后断连仍阻断”与“删除未提交的 ENOENT 允许替换”。
3. 新增 journal 模块和单测，覆盖原子写、读取、更新、损坏记录、写入失败和 quarantine。
4. 把 journal 接入 Agent/Terminal 创建路径，await 启动 metadata 保存，补故障注入：栅栏写失败、预提交记录写失败、RPC 发送前、RPC 返回时、最终节点保存失败。
5. 接入 Host 恢复：有预留 session 且可查询时接回，不明确时 quarantine；连续点击 Resume 不产生第二个 session。
6. 加入一次 bounded re-probe，验证同一 deadline、不重启 Supervisor、不创建目录。
7. 运行 `npm run typecheck`、`npm run test:ui-copy-localization`、定向 Host 回归、`npm run test:runtime-supervisor-protocol`、`npm run test:runtime-root-ownership`、`npm run test:runtime-supervisor-startup-profile` 和 `git diff --check`。
8. 更新活文档章节、设计文档、产品规格和技术债跟踪，记录实际通过项与未覆盖项。

以上步骤已按 PR1、PR2、PR3 的顺序完成。实现中发现的关键调整是：恢复必须在连接前读取 journal；删除写入异常按提交未知保留；`prepared` 必须保存原始节点快照；rootless 键必须绑定 workspace storage；删除路径必须先保留未知创建回执。

## 验证与验收

受控 Host 验收应证明：历史态 Agent Resume 和 Terminal Start 在 strict delete 返回 pre-submit `ENOENT` 时，先写回执再创建一个新 session；strict delete 已提交后断连、权限失败、owner/handshake 冲突和 live/共享责任仍不创建新 session。创建栅栏在每一步落盘失败时不提交 RPC，也不显示“已经替换”的成功提示。Host 重载模拟中，预留 session 可查询时接回同一 identity；查询不到或连接未知时节点进入 quarantine 且不会因再次点击生成新 UUID。

安全验收应证明：测试只操作 `mkdtemp()` 创建的隔离 global storage 和 socket 目录；没有调用真实 `/tmp/dsc-root-*` 清理；没有按 PID 结束进程；没有把连接失败写成进程已停止。

如果环境允许，补真实 Unix socket + 独立 Supervisor + fake CLI 的生命周期测试，覆盖删除提交前端点消失、Supervisor 仍存活、socket 恢复后会话身份不变。真实 VS Code UI 点击和真实 Claude 登录/并发 provider 会话若未执行，必须在结果中明确列为未验证，不能由 Host 夹具代证。

## 幂等性与恢复

journal 写入和读取应可重复执行；相同 operationId 的更新覆盖同一 node/kind 文件，不改变记录语义。记录进入 `create-may-have-been-submitted` 后，恢复只能查询预留身份，不能生成新 UUID。普通 `not-acquired` 拒绝只有在当前进程收到明确结果时才删除记录；Host 崩溃导致的未知结果保留记录。quarantine 不自动清理，允许用户在明确知道风险后通过已有节点删除路径处理，但不能自动 start/resume。

## 证据与备注

本轮短证据：

    Runtime replacement journal: 1/1 passed
    ui copy localization tests passed
    Host execution owner wiring: 42/42 passed (selected 42/684; non-native only).
    Host execution owner wiring: 9/9 passed (selected 9/684; HORIZON-OG-Astra follow-up).
    Host execution owner wiring: 19/19 passed (selected 19/684; non-native only).
    Runtime supervisor reader client: 39/39 non-native cases passed
    runtimeSupervisorProtocol tests passed
    runtime socket recovery native: file/directory removal, reattach and isolated Host delete passed

完整 Host 的失败不是本轮新增断言，也不能用定向通过替代全文件结论。真实 socket 测试只操作 `mkdtemp()` 创建的目录；没有清理用户的真实 `/tmp/dsc-root-*`，没有按 PID 结束 Supervisor。

## 接口与依赖

新增模块 `extensions/vscode/dev-session-canvas/src/panel/runtimeReplacementJournal.ts`，导出以下稳定接口：

    type RuntimeReplacementPhase = 'prepared' | 'create-may-have-been-submitted'
      | 'not-acquired' | 'bound' | 'quarantined';

    interface RuntimeReplacementNodeIdentity {
      rootPath: string;
      nodeId: string;
      kind: ExecutionNodeKind;
    }

    interface RuntimeReplacementOperationV1 {
      version: 1;
      operationId: string;
      rootPath: string;
      localNodeId: string;
      nodeId: string;
      kind: ExecutionNodeKind;
      originalNode?: {
        status?: string;
        summary?: string;
        metadata?: Record<string, unknown>;
      };
      originalBinding?: RuntimeReplacementBindingV1;
      targetBinding: RuntimeReplacementBindingV1;
      reservedSessionId: string;
      launchMode: PendingExecutionLaunch;
      stop: 'confirmed' | 'unconfirmed';
      evidence: string;
      phase: RuntimeReplacementPhase;
      boundConfirmed?: boolean;
      createdAt: string;
      updatedAt: string;
      reason?: string;
    }

    function readRuntimeReplacement(globalStoragePath: string, identity: RuntimeReplacementNodeIdentity):
      Promise<RuntimeReplacementOperationV1 | undefined>;
    function writeRuntimeReplacement(globalStoragePath: string, operation: RuntimeReplacementOperationV1):
      Promise<string>;
    function removeRuntimeReplacement(globalStoragePath: string, identity: RuntimeReplacementNodeIdentity):
      Promise<void>;
    function removeRuntimeReplacementIfCurrent(globalStoragePath: string,
      identity: RuntimeReplacementNodeIdentity, expectation: RuntimeReplacementExpectation | string):
      Promise<'removed' | 'absent' | 'changed'>;
    interface RuntimeReplacementExpectation {
      operationId: string; phase?: RuntimeReplacementPhase; updatedAt?: string;
    }
    function listRuntimeReplacements(globalStoragePath: string):
      Promise<RuntimeReplacementOperationV1[]>;

journal 文件名为 canonical root + root-local node ID + kind 的 SHA-256；写入使用同目录 `wx` 临时文件、文件 `sync`、原子 `rename` 和清理 staging 文件。写入、删除和条件删除共享 per-record 跨进程锁。锁 owner 写入 `pid/token/createdAtMs`；年龄不参与 stale 判定，只有 owner PID 不可证明存活时才回收，且回收由 `generation` 作用域 `wx` 标记串行化。删除节点的最终清理必须携带准备阶段观察到的 `{operationId, phase, updatedAt}`；任一字段变化都不得按键删除。依赖只使用 Node 内置 `fs/promises`、`path`、`crypto`，并复用现有 `RuntimeOwnerDescriptorV1`、`ExecutionNodeKind` 和 `PendingExecutionLaunch` 类型。不得新增第三方运行时依赖。

## 修订记录

- 2026-11-04：实现 PR1/PR2/PR3 后更新进度、发现、决策、结果、验证命令、未验证边界和当前接口签名；将旧 `globalStoragePath,nodeId,kind` 接口说明改为 `RuntimeReplacementNodeIdentity`。
- 2026-11-05：根据 HORIZON-OG-Astra 复审补齐五项缺口，更新 `not-acquired`、`boundConfirmed`、共享 strict handshake 阶段、operationId 条件清理、恢复后 reservation 结算及对应验证计数。
- 2026-11-05：根据第二轮 HORIZON-OG-Astra 复审修复锁回收互斥和责任指纹清理；第三轮复核后把 malformed 锁改为失败关闭、取消回收标记自动清理、区分 in-flight 与已结束未知 reservation，补同 operation 阶段推进与重复 Start 回归，更新 Host 定向计数为 `71/71` 及锁回收残留边界。
