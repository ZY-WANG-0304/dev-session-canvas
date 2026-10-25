---
title: 执行节点通信与分页诊断
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
  - docs/exec-plans/active/runtime-journal-input-priority.md
updated_at: 2026-10-25
---

# 执行节点通信与分页诊断

## 正式方案：短时诊断采集

2026-10-25 用户确认先实现诊断增强，再据实测选择修复边界。此处选定的仅是诊断方案，Supervisor journal 优先级、Webview 全局应用调度、状态广播合并仍未选定。本 PR #337 承载诊断实现；发布 PR #327 保持未合并。

用户执行“开始执行链路诊断（120 秒）”，随后复现问题，用原有“落盘当前宿主诊断”导出新增 `execution-flow-diagnostics.json`。Host 与各 Webview 独立缓存元数据，在 120 秒后自动冻结；导出时停止并收集快照。再次开始会明确替换上一次采集。未开始时不计算消息 JSON 字节、不发送采样回执、不保留阶段事件。运行中的进程与终端 journal 内容、输入顺序、读页节奏均不改变。

共享实现 `src/common/executionFlowDiagnostics.ts`（路径均相对 `extensions/vscode/dev-session-canvas/`）提供有界记录器：每阶段最多 64 条详细记录，120 个每秒窗口按阶段保存计数、字节数、累计/最大耗时以及固定桶直方图，stateUpdated 单独保留每秒频率、消息字节和同步处理耗时；另按最多 128 个 stage/node/reason/messageType 组合累计。固定采集窗口内的聚合不随详细记录淘汰；导出明确细节淘汰量、分组溢出量和时钟域。字段只允许阶段、固定 messageType/reason 标签、生成的关联 ID、node/session ID、数值计数与耗时，不记录输入、输出、画布正文或错误正文。

`src/panel/CanvasPanelManager.ts` 记录输入处理、写入调用至提交结果、状态构造、消息提交和读页往返。`postState` 标记 live Supervisor snapshot 与普通 execution state sync 的触发原因；导出区分其它原因，不能将其它原因猜成 live output。state-build 覆盖 Webview options 与 payload 构造，不包含随后侧栏通知；采集期间量化实际提交消息的 JSON UTF-8 大小，并单独报告测量这一步的耗时。`postMessage` 的返回与原 `delivered` 字段不是浏览器接收确认。

每个 surface 最多一个采样消息回执在途、最多每秒一个；Webview 在同步消息处理完成后回复 ID 与自身处理耗时，Host 用自己的单调时钟测提交至回执的往返。该时长包含返回路径和事件循环等待，不能称为单向传输时间。未回执数量和年龄随导出提供。详情本地缓存，采集期间不逐事件上传；正常输入 ACK 与 page request 原有流量不增加。

`src/webview/main.tsx` 记录输入派发与原有 ACK 往返、状态消息同步处理、page 请求至返回、page 等待写入及 xterm callback 完成。页面各阶段使用同一个 requestId、read/session 身份与 revision 边界。同步 state handler 不包含后续 React commit；记录此限制，不能把它解释成全部 UI 绘制成本。`src/webview/terminalPagedProjection.ts` 仅向应用回调透传请求 ID，不改变 busy、retry、revision 或回执语义。失败与取消不作为成功应用。

Host 同时记录 page-host-request 与 input-write-start 起点；只有完成的请求才进入对应时长分布，冻结时未完成的起点不能解释成成功或零耗时。

Host 在采集期间对 `RuntimeSupervisorReadTerminalPageParams` 加可选诊断标志；`src/supervisor/runtimeSupervisorMain.ts` 用自己的单调时钟在原 session 操作队列入口、读取开始、journal 读取完成处测耗时，将可选数值放入 page diagnostics。沿原对象返回，保留 owned reader 身份与结算。旧 Supervisor 不返回该字段时导出明确缺失，不重启旧会话，也不伪造零时长。

进程内部使用 `performance.now()`；快照中的 epoch 只供人工关联。跨本机 Webview 和 SSH Host 不直接相减 Date.now。输入 ACK 早于 PTY write，page applied callback 不保证像素已绘制，Host 收到的 revision ACK 可能迟到。诊断开关、可选 page 字段与详情采集失败不能阻止业务消息或推动 revision。

## 日志依据与未决根因

有效双输出样本为 `2026-10-25T12-18-41-687Z`，单路持续输出对照为 `12-11-35-027Z`。双输出的 164 个 input ACK 样本有 77 个超过 1 秒，最大约 13.9 秒；Host 接收输入至提交 ACK 为 0–1 ms。12:18:26–32 的 retained host messages 有 116 次 stateUpdated、没有新的 terminal page 提交；后续约 818 KB page 数据包含追赶积压。不能把恢复时的 page 字节率当作卡顿成因或可持续容量。

lagRevisions 是 Host 观察到的回执落后，包含回执传输/合并等待；旧 webview-terminal-write 强制保留小页而非完整大页分布。既有 2000 条事件与 500 条性能样本窗口长度不同，不能混用作同一统计时间窗。日志未证明 xterm 渲染饱和、journal 读竞争或状态广播拥塞中的任何一个是唯一根因。

## 验证方法与修复选择

自动化验证记录器开关、固定窗口、细节淘汰后聚合完整性、严格字段校验、旧 page 无诊断的兼容性、分页应用 requestId 关联、取消不推进游标。运行 typecheck、相关 protocol / paged projection 测试及 build。真实 SSH 场景仍需安装新包后复现，不把单元测试通过写成性能改善。

同一包、相同终端尺寸与输出内容，分别测单节点、双节点相同总字节率、双节点相同单节点字节率；记录是否输入、是否后台/重建、开始/停止时刻。先比较 input/message RTT、Host page 总耗时、Supervisor queue/read 耗时、Webview page queue/apply 耗时，以及 stateUpdated 频率/字节/同步处理耗时。若状态广播相关等待占主导，再设计去重/合并对照；若 page 应用排队占主导，再考虑共享时间预算与公平调度；若 journal queue/read 占主导，再调整相应服务。年龄、DRR/WFQ 等算法与具体预算均待这些证据决定。

导出包含每个 surface 收集成功、未参与、超时、生命周期已替换、发送失败或并发收集繁忙的状态；最多两个收集请求在途。3 秒收集超时不清空 Webview 本地数据，可在恢复后再次导出。浏览器重建会丢失旧实例内存，导出记录每个 surface 初始/当前 frameId 与替换次数；出现替换时不得把新实例当作旧实例的完整采集；120 秒之外事件不进入聚合。通用 Host postMessage 路径覆盖状态广播和分页回复，绕过它的专用直发路径不计入 message-post 总量（输入 ACK 另有原始往返计时）。Webview page-roundtrip 只证明响应到达，page-apply 才记录实际应用；初始 current-state 导入不计入普通 journal events 的 page-queue/page-apply。

诊断自身 JSON 测量、少量回执及导出可能扰动，需保留开/关对照并报告 measurementMs。
