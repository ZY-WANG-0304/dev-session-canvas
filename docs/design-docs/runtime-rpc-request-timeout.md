---
title: Runtime Supervisor 请求等待超时
decision_status: 已选定
validation_status: 已验证
domains: [执行编排域]
architecture_layers: [适配与基础设施层, 共享模型与编排层]
related_specs: [docs/product-specs/runtime-persistence-modes.md]
related_plans: [docs/exec-plans/completed/runtime-rpc-request-timeout.md, docs/exec-plans/completed/runtime-reader-open-timeout-cleanup.md]
updated_at: 2026-10-09
---

# Runtime Supervisor 请求等待超时

## 背景与范围

架构审核 F-01 指出普通 hello / RPC 在对端保持连接却不回复时没有等待上限。ready 的 5 秒循环不能约束内部悬挂的 hello。严格删除已有独立 deadline，首次返回 `unconfirmed`，并可在原连接上接收迟到证据，不能把它描述成所有删除均无限等待。

## 正式方案

`extensions/vscode/dev-session-canvas/src/panel/runtimeSupervisorClient.ts` 在发送普通请求前登记单调时钟绝对 deadline。普通 RPC 等待 15 秒，hello 与单次连接建立等待 5 秒；启动后的 ready 循环把剩余预算传给连接和 hello，不能每轮重新得到 5 秒。15 秒是客户端观察策略，给快照/终态串行工作留出比 hello 更长的时间，不是服务端执行耗时保证。backend 启动及文件系统调用不在本次请求预算内。

除下述 reader 获取与严格删除的迟到责任外，普通 RPC 到期移除自身 pending 并清理 timer，错误使用独立 `clientRequestTimeout` code / descriptor，文案明确结果未知、操作可能已经发生。成功、错误回包、同步写入失败、替换连接、断连及 dispose 也清理 timer；处理回包时复核 deadline，避免事件循环延迟让到期回包被误认为及时成功。迟到或未知 ID 回包不改变已返回结果。

### 资源获取请求的迟到清理

PR #306 review 确认 `openTerminalRead` 不能套用“超时直接丢弃原 pending”：远端可能已准入 reader 并持有冻结状态，迟到 descriptor 是关闭它所需的唯一 readId。原实现会使 relay 提前返回 unconfirmed 并遗忘释放责任。以下修正已实现，组合回归与既有门禁已通过。

`openTerminalRead()` 仍在 15 秒拒绝调用者等待；其原请求保留独立的迟到响应 Promise，绑定原 request ID / socket，直至回包、断连、替换或 dispose。超时前不重发 open，超时后也不重发；回包在 deadline 到达但 timer 尚未执行时走同一超时与清理路径，不能返回及时成功。

`RuntimeTerminalReadRelay.openBinding()` 通过可选超时回调接管该 Promise；`release()` 先等有界 opening，再等迟到 descriptor，并沿原 client 只发送一次 cancelled close。调用者已经收到的超时保持不变；释放责任及每 key 最多两个 binding 的既有限额保持到 close 回包或连接丢失，不能因为超时绕过限额。迟到的旧 descriptor 只登记自身清理身份，不把同 consumer 新 reader 的本地连接标为关闭。未使用 relay 的直接调用由 client 承担迟到 cancelled close。

迟到错误/断连没有可用 descriptor 时释放结果为 unconfirmed；close 的未知回包或超时也不能变成 applied，不自动重发 close。原 pending 仍计入 `hasPendingRequests()`，防止 Host 提前回收承担清理责任的 client。普通无资源 RPC、hello 和严格删除的原契约不变。

### 其他请求与连接

普通 RPC 超时保留连接和其他请求，不推断 Supervisor 已死，也不取消远端操作、不自动重发请求。hello 超时销毁原未通过握手的连接，释放共享 connectPromise；下一次显式调用可以重新连接。ready 仅重试建立连接/握手，不能重启已经连接但 hello 无响应的 Supervisor。输出消费的 ack 超时关闭原连接，不能再发送同批次 cancellation ack 猜测上次是否生效。

`deleteSessionStrict()` 的已提交删除显式沿用已有观察协议，不套用普通 RPC 的 15 秒清理：首次到期仍为 `unconfirmed`，原 pending 保留至回包或断连，迟到结果只更新 `current()`，不改 `first`、不重新提交。严格删除前的 hello 仍有普通握手上限；原严格 deadline 到期后不得发送删除。

`extensions/vscode/dev-session-canvas/src/common/runtimeSupervisorProtocol.ts` 与 `src/panel/runtimeSupervisorLocalization.ts` 定义错误及中英文呈现。超时不映射为 `sessionNotFound`、`failed` 或执行拒绝事实；现有 Host 的原执行责任仍独立保留。

## 取舍

不采用 socket 空闲超时：其他会话持续输出不能延长某个无响应请求。不对所有超时销毁连接：普通请求迟到不证明连接损坏，销毁会打断其他订阅和严格删除补证。不让严格删除直接丢弃迟到证据，其独立观察本已有限。

## 验证

新增请求级测试使用受控时钟覆盖回包/定时器边界与清理，真实本地 socket 覆盖无响应 hello、ready 预算及普通 RPC；记录请求次数证明没有重发。运行既有 reader/严格删除、Host 输出信用、协议、类型和本地化回归。2026-10-08 在 Linux / Node 25.6.0 完成：新增 23/23、既有 reader/严格删除 31/31、Host 执行接线 296 项、协议、checkpoint refresh、分页投影/完成/历史、输出信用、typecheck、本地化均通过。真实 socket 的 hello/ready/input 分别约 5.01/5.01/15.01 秒返回。修前对照在 origin/main 的 client 上明确失败：15 秒后 pending.size 仍为 1；修后同例通过。分页投影旧夹具缺 backend 的构造错误在基线同样复现，本轮补齐该最小依赖后整段通过。未执行多平台真实 VS Code 验收，不把本地 socket 或受控 Host 证明扩大为该层结论。

2026-10-09 reader 超时清理修正：新增 14 项实际 client + relay / 直接调用回归，覆盖 timer 与到期回包竞态、surface 关闭/替换、旧 reader 与新 reader 隔离、每 key 责任上限、迟到错误/断连/换连接/dispose、close 超时及 legacy 直接调用。旧 head `95965a1c` 的同例对照分别在“原 client 仍承担清理责任”和“迟到 descriptor 触发一次 close”失败；修后请求测试 37/37。完整协议门禁（含分页/终态/输出信用）、reader/严格删除 32/32、Host 接线 333/333、类型检查通过。证据见关联修复计划；原组合缺口与历史测试通过同时保留，未重跑多平台 VS Code。
