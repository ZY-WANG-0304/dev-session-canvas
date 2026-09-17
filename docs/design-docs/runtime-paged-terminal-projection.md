---
title: Runtime live 终端的消费驱动分页投影
decision_status: 已选定
validation_status: 验证中
domains:
  - 执行编排域
  - 画布交互域
architecture_layers:
  - 宿主集成层
  - 画布呈现层
  - 共享模型与编排层
  - 适配与基础设施层
related_specs:
  - docs/product-specs/runtime-persistence-modes.md
related_plans:
  - docs/exec-plans/completed/runtime-paged-terminal-projection.md
updated_at: 2026-09-17
---

# Runtime live 终端的消费驱动分页投影

## 问题与取舍

这是 F-04 第三个增量。Supervisor 有界缓存已落地，但 Host 完整 suffix 和首次恢复单消息仍随历史增长。本次选择 journal 消费驱动读取，不修改 checkpoint 的证明，不引入另一台 server，也不把分页等同于 tmux 式权威屏幕同步。总回放时间、root/runtime 归属与进程总内存仍在后续范围。其后 `runtime-completed-no-history.md` 已取消 completed 内联 F-05；本文终态描述同步为当前轻量保存规则，原阶段验证保留为历史证据。

## 正式方案

### 能力与归属

`common/runtimeSupervisorProtocol.ts` 增加 `terminalPagedReadV1`。Host 在 capability 存在时在 create/attach/subscribe 选择分页。`supervisor/runtimeSupervisorMain.ts` 为该模式 live 会话返回身份、head、几何及有限摘要，不生成完整 `terminalStream`。老客户端继续完整协议。正常终态保留完整 handoff。

`panel/CanvasPanelManager.ts` 保存身份、head 和有限摘要，不复制完整后缀。Supervisor 给 Host 的事件仍用于标题、活动判断；Host 给 Webview 的通知只唤醒读取，不缓存恢复期间 live body。

### 读取与保留

`openTerminalRead` 按 socket/session/surface 返回读取 ID、已验证 checkpoint、head；同 surface 重开替换旧读者。checkpoint 是起点，不证明追上 head。`readTerminalPage` 校验 session、authority、ID、afterRevision，固定本次 head，仅从 `terminalSessionJournal.readEventPagesAfter()` 取一页。预算沿用 256 KiB 事件数组 JSON / 256 条，单个超大事件不拆 revision，可超过字节预算。

读者保留下界参与 `getTerminalJournalRetentionRevision()`。下一页请求只能使用上页末 revision，表示上页 xterm 应用完成；重复相同位置可重试，不推进消费。下界保守地停在该读者已消费位置之前最近的安全 checkpoint，新 checkpoint 尚未被读者越过时不能释放旧基点。这比只 pin applied revision 多保留一段日志，但保证正常 completed 能构建覆盖所有读者的完整来源。仅发送页面不能 compact 未消费事件。close、同 surface 重开、socket 断开释放读者，不终止进程。open/read 与 compact/delete 同属会话操作队列，当前页另由 journal pin 防护；校验错误必须失败，不以空页掩盖缺失。

`panel/runtimeTerminalReadRelay.ts` 每个 surface/node 只记录读取身份、消费/发送位置和 in-flight 标记；健康投影重复 attach 复用同一描述符，不重新 reset 或聚合 pages。只有存在实际 Webview 的交互 surface 才打开读者，避免不可见的后台读者无限保留旧基点。取消中的 open 即使稍后返回也会关闭对应读者。surface generation/frame 变化、socket 断开和 Host dispose 会释放旧读者。

### 客户端消费

Webview 应用 checkpoint 后串行请求页面，一次最多一个读取/写入中的页面，所有 xterm 回调完成才推进游标/ACK。output、resize、scrollback 保持顺序。head 通知只记录最大位置，无 body；同一读取链从恢复持续到实时，没有第二条实时 body 队列。

`webview/terminalPagedProjection.ts` 管理单页消费状态，`main.tsx` 用同一事件应用函数处理完整旧协议和新页面；在 xterm parser 回调之外应用后续 resize/options。节点绑定、Webview 生命周期、读取 ID 和请求 ID 隔离旧响应。重建/替换/关闭释放读者，旧代际写入不能 ACK。页错误以 250ms 间隔从相同位置重试，不推进消费；socket 断开时新模式保持原会话身份、进入 reattaching，以 500ms 间隔连接原 endpoint 并重新建立投影，只有明确 session-not-found 才进入历史态，不自动启动新 Agent。分页 open/read/close 与重新 attach/subscribe 的 Host/client 连接步骤均不允许为清理或重试启动 Supervisor，不能只在首次取 client 时禁止启动。已有 RPC 无响应期限问题 F-01 不在本次解决，连接保持但完全不响应时仍可能等待。

### 正常终态与兼容

`applyCompletedRuntimeSupervisorSnapshot()` 保存轻量 root-local/窗口终态，不再内联正文，再释放 Supervisor。Supervisor 构建终态时仍选择活动读者中最早的保留 checkpoint，保证未消费范围包含在完整后缀。relay 仅为已确认的当前读者临时持有同 session/authority 的终态，追到 final revision 后显示退出并关闭读者；关闭、换代或 Host dispose 也释放。保存失败不删 journal，新页面不复用临时来源。这个临时完整对象仍是 F-04 的内存风险，不是独立归档。

仅分配读取 ID 不证明 Webview 收到描述符。只有首个合法 read 请求证明 checkpoint 已应用，Host 才将正常终态通知转换为“继续分页”。若会话更早结束，仅向同一 Webview 生命周期发送一次完整终态，取消尚未确立的分页投影再应用。保存开始后不新建旧会话读者，异步 open 及最终快照均检查生命周期；旧响应不能进入重开的页面，也不能关闭仍在续读的已确认读者。

旧 capability 保持原 checkpoint/完整 stream 路径，旧 live 会话不改地址。Supervisor 崩溃/重启不保证历史，正常存活不得截断未消费内容。`snapshot-only` 不变。

## 验证与边界

协议/消费测试覆盖页顺序、错误身份、双消费者、取消、终态。真实 Agent/Terminal 超缓存并拒绝 checkpoint，页拼接等于完整快照；慢写入最多一页 body，恢复后仍可输入/resize。Linux VS Code 与旧 Supervisor smoke 结果回写 ExecPlan。

预算只约束 live 事件缓存与页，不涵盖 Supervisor 写队列、Host 启发式 tracker、完整终态及临时聚合、旧协议、段索引和全量 open/compact 扫描，也不是 RSS。总回放仍与 checkpoint 后历史成正比，不宣称 F-04 已解决；F-05 的取消历史决策及本批验证见 `runtime-completed-no-history.md`。

以下是分页增量当时的历史证据，completed 内联数值不代表当前 Host 保存行为。

2026-09-17 阶段证据：同一容量负载累计 output 为 6553613 / 13107213 / 19660813 字节时，分页 live snapshot 为 425 / 427 / 427 字节，读取描述符为 431 / 432 / 432 字节，每页事件数组最大 253669 字节；全部事件分别通过 27 / 54 / 80 页读取。这个小描述符来自空 genesis，不是所有 checkpoint 都小于 1 KiB 的保证。正常 completed 内联仍为 20509666 字节。真实 Agent/Terminal 各 18000 行协议测试、慢读者压缩保护、Host 断线重试方法、Linux VS Code 1.117.0 的实际渲染/Host 重建/正常退出/旧 generation 兼容，以及 4 个 Playwright 终端回归通过；未测全平台、长期压力、端到端 RSS 或首次交互延迟上限。

最终 smoke 复核中，分页场景通过；旧 Supervisor 场景首次在等待 resize 相对初值变化时超时，输入输出 marker 均可见，原样隔离重跑通过。这与已登记的 legacy resize smoke 时序风险一致，保留失败事实，不降低断言。补齐分页重连禁止启动约束后，再次合并运行两项 smoke 均通过；日志和后续边界见本阶段 ExecPlan 及技术债跟踪表。
