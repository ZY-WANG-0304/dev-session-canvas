# 将 Runtime 终端分页读取接入 Host 与 Webview

本 ExecPlan 是活文档，按仓库根目录的 `docs/PLANS.md` 持续维护。正式设计见 `docs/design-docs/runtime-paged-terminal-projection.md`。

## 目标与全局图景

Supervisor 是现有独立进程，持有 Agent/Terminal 的 PTY、checkpoint 和连续事件日志。前两个增量已拆开周期 checkpoint 查询，将日志缓存限制为 1 MiB / 2048 条，但 Host 仍复制完整后缀，恢复仍是一个大消息。本次让新能力的 live 会话只向 Webview 提供 checkpoint 和按消费进度读取的一页事件，Host 不保存完整后缀。拒绝 checkpoint 时重建画布仍能恢复原进程的连续内容，不要求历史常驻 Host。

用户已确认 Supervisor 崩溃或机器重启后无需恢复原进程或历史。本次不改变 Supervisor 存活时的完整性，不调整正常 completed 保留、root/runtime 归属、磁盘格式或 checkpoint eligibility。分页仍逐事件回放，不声称总恢复时间或进程 RSS 已有界。

## 进度

- [x] (2026-09-17) 核对分支、前两阶段与 Host/Webview 完整后缀、ACK、正常终态持久化边界。
- [x] (2026-09-17) 确定消费驱动分页方向并记录正式协议与兼容边界。
- [x] (2026-09-17) 实现 Supervisor 能力协商、轻量 live 快照、读取游标和保留保护。
- [x] (2026-09-17) Host 接入轻量快照与页面转发，Webview 在 xterm 回调后请求下一页。
- [x] (2026-09-17) 协议/状态机/真实 PTY、慢读者压缩保护、Host 断线方法测试、4 个 Playwright 和 Linux VS Code/旧 Supervisor smoke 通过。
- [x] (2026-09-17) 同步架构、审核、规格与债务，归档计划并随本阶段改动本地提交；整体重构未收口，不推送或创建 MR。

## 意外与发现

普通 `sessionState` 也会生成完整后缀，不能仅替换 attach RPC。完整快照还承担正常 completed 持久化后删除 journal 的所有权交接，此路径必须保留，且分页消费者不能因 journal 删除而缺尾。

只保留 applied revision 不足以构建正常终态：更早 checkpoint 可能还在读者描述符中，但其到 applied revision 之间的日志已被删除。现在读者 pin 住已消费范围之前的安全 checkpoint，只有消费越过更新 checkpoint 才前移；终态使用全部读者中最早的保留基点。实际 Supervisor 压缩测试验证新 checkpoint 已推进而慢读者仍可从 0 读取，关闭慢者后保留下界前移。

异步 open 还可能与正常结束交错。仅分配读 ID 时不能将最终完整 snapshot 改成 available 通知；现以首个合法 page 请求作为 checkpoint 已应用的证明，更早结束继续发送完整终态，并取消未建立的分页投影。relay 的延迟 open 取消及实际 Webview 的首请求前结束均有回归。

最终 smoke 复核的分页场景通过；旧 Supervisor 场景在输入输出 marker 健康时，等待 Agent/Terminal cols/rows 相对初值变化超时。原样隔离重跑通过，与技术债表 2026-07-14 已登记的 legacy resize 时序风险一致。未放宽断言，未将一次重跑通过写成已查明根因。

最终代码复核补齐分页 attach/subscribe 的连接策略：只在首次获取 client 时传 `allowRestart: false` 不足以约束后续方法，重新订阅原本还会走默认允许启动的路径。现将禁止启动贯穿 Host 订阅取 client 与客户端分页 attach/subscribe；实际客户端连接方法和 Host 订阅方法均新增回归，旧协议策略保持不变。

## 决策记录

- 决策：新客户端在 live 投影期间持续按游标拉取，不另设恢复后的原始 output 推送队列。理由：单条顺序链避免恢复期间积累实时 body；revision 通知只唤醒读取，不代表消费。日期/作者：2026-09-17 / Codex。
- 决策：游标属于 socket/session/surface，每个 surface 最多一个；请求下一页确认上一页写入后才推进保留下界，断开/替换/关闭释放。理由：发送不是消费。日期/作者：2026-09-17 / Codex。
- 决策：正常 completed 继续完整持久化，再从已保存的同一 authority 历史提供未消费尾部。理由：不悄悄取消保留，也不能把删除后的读取失败变成丢输出。日期/作者：2026-09-17 / Codex。
- 决策：读者保留下界为已消费位置之前最近的安全 checkpoint，而非裸 applied revision；终态取最早读者基点。理由：同时证明续读与正常 handoff 可构造性。日期/作者：2026-09-17 / Codex。
- 决策：分页模式 socket 断开保留绑定并重连原 endpoint，open/read/close 不触发 Supervisor 重启。理由：新增 page 失败路径不能沿用把连接失败直接当成进程死亡或重新启动 Agent 的行为。F-01 无响应期限仍单独跟踪。日期/作者：2026-09-17 / Codex。

## 结果与复盘

本阶段已完成并归档。三层已接线，live Host 不再保存完整事件数组；真实 Supervisor 能力测试和 VS Code 诊断均覆盖零缓存与多页恢复。输入启发式仍接收 Supervisor 的 live 原始事件，本次不宣称全部 socket/write 队列有界。正常 completed 仍保存完整历史，F-05 未收口。状态同步替代全历史 replay、在途队列、公平性长期压力与平台矩阵仍是后续范围，已登记到技术债表。root/runtime 稳定归属和旧 live 绑定迁移仍单独规划。

## 上下文与定向

代码位于 `extensions/vscode/dev-session-canvas/src/`。`supervisor/terminalSessionJournal.ts` 已提供异步 `readEventPagesAfter()`，每页默认 256 KiB 事件数组 JSON / 256 条，单个大事件例外。迭代期间 pin 防止 compact/delete，本轮需在多次 RPC 间保留读取下界。`supervisor/runtimeSupervisorMain.ts` 的 `terminalOperationChain` 串行化会话操作，`getTerminalJournalRetentionRevision()` 汇总 deferred subscription 和应用 ACK 的保留下界。

`common/runtimeSupervisorProtocol.ts` 定义 RPC；`panel/runtimeSupervisorClient.ts` 是 socket 客户端。`panel/CanvasPanelManager.ts` 处理会话与正常 completed handoff；`applyCompletedRuntimeSupervisorSnapshot()` 等待 root-local/窗口保存后才删除来源。`common/protocol.ts` 校验 Webview 消息。`webview/main.tsx` controller 串行调用 xterm.write，回调完成才报告消费。恢复开始、页面与进度通知须校验 session、authority、读取身份和连续 revision。

## 工作计划

### 里程碑一：轻量协议

新增 capability，让 create/attach/subscribe 可选择分页投影，live 状态仅发身份、revision 和有限摘要。新增 open/read/close RPC：open 返回验证通过的 checkpoint 和读取 ID，read 固定本次 head 并返回一页，close 幂等。读取错误不返回空成功或声明会话死亡。旧能力不变，老客户端仍获得完整快照。真实 PTY 协议测试覆盖 Agent/Terminal、双消费者、socket 隔离、重开、错误 revision、压缩与释放。

### 里程碑二：消费驱动客户端

Host 为新协议仅保留身份、head、有限摘要；原 live 事件服务 Host 启发式，但不追加完整 stream 或转发无界 body。Webview attach 打开读游标，应用 checkpoint 后请求下一页，整页写入后才推进 revision。head 通知唤醒读取，静默时不忙轮询。取消、session/surface 代际变化不能提交旧页，错误保留投影并重试，不用 raw tail 冒充历史。

正常 completed 保持 durable handoff；已开读者可从 metadata stream 读取剩余页，消费 final revision 后显示退出。旧 Supervisor、snapshot-only 行为不变。

### 里程碑三：验证与收口

增加协议/消费状态机测试，运行类型检查、构建、相关回归与 Linux VS Code smoke。证据区分 Host live 缓存、最大页、总量和 completed 大小，总回放与 F-05 仍开放。同步正式文档、归档计划并本地提交，不推送未整体收口的重构。

## 具体步骤

仓库根执行 `npm run typecheck`、`npm run build`、`npm run test:terminal-session-journal`、`npm run test:runtime-supervisor-protocol`、`npm run test:execution-output-sequence`、`npm run test:protocol-webview-messages`、`npm run test:serialized-terminal-state-tracker`。新增测试按 package.json 现有模式登记。

先 `npm run build:notifier`，再 `DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=runtime-checkpoint-refresh,legacy-supervisor-upgrade node scripts/smoke/run-vscode-smoke.mjs`，日志保存到 `.debug/runtime-paged-terminal-projection-smoke.log`。预期两场景 code 0，实际 Webview 包含首尾 marker。

## 验证与验收

拒绝 checkpoint 且输出超过缓存时，新协议 live create/attach/状态无完整 events，Host events 缓存为零，各页拼接与完整快照相同。上一页 xterm 回调未完成不请求新页；重复/旧代际/跨 authority/跳 revision 不被应用。慢消费者需要的事件不被 compact，关闭只释放对应读者。恢复期间输出、resize/scrollback、正常结束不丢尾、不重复、不提前 ACK。旧 Supervisor 验证原行为，未验证平台显式记录。

## 幂等性与恢复

capability 协商不改持久化地址或格式。失败重试同一位置，不重启 PTY；替换游标从安全 checkpoint 重建。旧会话继续原 Supervisor。测试使用临时目录，不删除用户会话；completed 保存失败保留旧 journal。

## 证据与备注

基线 `e4aaa257`，分支 `runtime-persistence-session-state-refactor`，开始时工作树干净。前一阶段约 19.66 MB output、1.046 MB Supervisor 缓存，但完整 snapshot 约 20.29 MB。

容量脚本的最大页为 253669 字节，三阶段为 27 / 54 / 80 页且完整恢复 641 / 1281 / 1921 条；live 轻量 snapshot 为 425 / 427 / 427 字节。正常 completed 位置修改仍重写 20509666 字节。日志 `.debug/runtime-paged-capacity.log`。

`npm run test:terminal-paged-projection` 覆盖实际 Supervisor 类的 compact/双 socket/取消/终态，实际 Host 断线方法的原地址重试、Host/客户端分页重连不启动 Supervisor，以及纯消费者/relay 的单页背压、重复响应、错误重试和持久化历史接续。它纳入 `test:runtime-supervisor-protocol` 总入口。

真实 PTY 18000 行两种 kind 均读取 7 页，每页小于 256 KiB。最终协议日志 `.debug/runtime-paged-protocol-final.log`。Playwright 命令 `node scripts/test/run-playwright-webview.mjs --grep 'paged recovery|split ANSI OSC|thousands of contiguous journal'` 返回 4 passed，日志 `.debug/runtime-paged-playwright-final.log`。最终 Linux VS Code smoke 的分页场景 code 0，旧 Supervisor 场景首次 resize timeout，日志 `.debug/runtime-paged-terminal-projection-final-smoke.log`；用 `DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=legacy-supervisor-upgrade node scripts/smoke/run-vscode-smoke.mjs` 原样隔离重跑 code 0，日志 `.debug/runtime-paged-legacy-resize-recheck.log`。仍未运行全 npm test、Windows/macOS/Remote SSH 或端到端长期压力。

补齐分页 attach/subscribe 禁止启动约束后，再次通过 typecheck、build、Supervisor 协议总入口、Webview 消息校验和 output sequence；两项真实 VS Code smoke 合并执行均 code 0，最终确认日志 `.debug/runtime-paged-terminal-projection-confirmation-smoke.log`。本轮设计文档 frontmatter/索引状态及新增计划引用检查通过；索引中 `execution-node-zoom-interaction-research` 的 completed 计划引用在 HEAD 已断链，未纳入本轮修改。

## 接口与依赖

复用 xterm、journal 与 socket，不新增服务/依赖。共享类型增加读取描述符和连续页面；RPC 增加 `openTerminalRead`、`readTerminalPage`、`closeTerminalRead`；Webview 增加读取请求、页面响应、head 通知。身份与节点绑定一致，不能提交未消费位置。

修订记录：2026-09-17 创建计划，记录第三阶段边界与待验证结果。
修订记录：2026-09-17 完成三层实现与定向验证，补充终态最早 checkpoint 保留及原 endpoint 重连决策，等待最后文档同步与提交。
修订记录：2026-09-17 完成最终类型检查和 smoke 复核，记录 legacy resize 首次失败与原样重跑结果，同步正式文档、遗留债务并归档本阶段。
修订记录：2026-09-17 补齐分页重连全链路禁止启动 Supervisor 的策略和回归，两项真实宿主 smoke 最终确认均通过。
