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
updated_at: 2026-10-26
---

# 执行节点通信与分页诊断

## 正式方案：短时诊断采集

2026-10-25 用户确认先实现诊断增强，再据实测选择修复边界。此处选定的仅是诊断方案，Supervisor journal 优先级、Webview 全局应用调度、状态广播合并仍未选定。本 PR #337 承载诊断实现；发布 PR #327 保持未合并。

用户执行“开始执行链路诊断（120 秒）”，随后复现问题，用原有“落盘当前宿主诊断”导出新增 `execution-flow-diagnostics.json`。Host 与各 Webview 独立缓存元数据，在 120 秒后自动冻结；导出时停止并收集快照。再次开始会明确替换上一次采集。未开始时不计算消息 JSON 字节、不发送采样回执、不保留阶段事件。运行中的进程与终端 journal 内容、输入顺序、读页节奏均不改变。

共享实现 `src/common/executionFlowDiagnostics.ts`（路径均相对 `extensions/vscode/dev-session-canvas/`）提供有界记录器：每阶段最多 64 条详细记录，120 个每秒窗口按阶段保存计数、字节数、累计/最大耗时以及固定桶直方图，stateUpdated 单独保留每秒频率、消息字节和同步处理耗时；另按最多 128 个 stage/node/reason/messageType 组合累计。固定采集窗口内的聚合不随详细记录淘汰；导出明确细节淘汰量、分组溢出量和时钟域。字段只允许阶段、固定 messageType/reason 标签、生成的关联 ID、node/session ID、数值计数与耗时，不记录输入、输出、画布正文或错误正文。

`src/panel/CanvasPanelManager.ts` 记录输入处理、写入调用至提交结果、状态构造、消息提交和读页往返。`postState` 标记 live Supervisor snapshot 与普通 execution state sync 的触发原因；导出区分其它原因，不能将其它原因猜成 live output。state-build 覆盖 Webview options 与 payload 构造，不包含随后侧栏通知；采集期间量化实际提交消息的 JSON UTF-8 大小，并单独报告测量这一步的耗时。`postMessage` 的返回与原 `delivered` 字段不是浏览器接收确认。

2026-10-26 用户授权补充状态构造分段计时。保留原 `state-build` 总跨度，增加 `state-options-build`（getWebviewOptions）、`state-options-set`（Webview options setter）、`state-canvas-build`（prepareCanvasStateForWebview）、`state-runtime-build`（getRuntimeContext）与 `state-sidebar-notify`（同步 notifySidebarStateChanged）。同一次 postState 的总计与分段共用生成的 requestId，记录相同 messageType/reason，沿用每秒聚合、直方图和每阶段 64 条详情；侧栏是总构造跨度之外的独立阶段，不能与子阶段一起重复相加。options setter 的计时不包含 VS Code 后续异步应用，侧栏计时不包含异步渲染或 listener 内未等待的任务。

同步测量包装保留返回值和异常，失败阶段记录 success=false 后原样抛出；未开启时直接调用原操作，不额外计时、保留记录或发送消息。开启时原 state-build 总跨度包含分段记录自身的少量开销，不把它当作零成本探针。没有 Webview 时不虚构 options 的零耗时；采集冻结/到期时丢弃未完成跨度，不把缺失当成功。本次只补这五段，不合并广播、不改调度或缓存策略，也不改变输入、分页及 ACK 语义。新字段随既有 execution-flow-diagnostics.json 导出，英文调试窗口继续使用 Start Execution Flow Trace (120 seconds)。

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


## 2026-10-26 首次链路采集结论

输入为 `/home/users/ziyang01.wang-al/projects/dsc-test-01/.debug/current-host-diagnostics/2026-10-25T16-26-03-114Z`。Host 的本机采集起点为 `2026-10-25T16:24:47.238Z`，覆盖 75.865 秒；Webview 覆盖 75.867 秒，同一 traceId，panel 成功收集，frame 替换次数为 0。两个 Agent、RuntimePersistence 开启、开发模式、SSH 场景；捕获结束时节点尺寸均为 67×21。没有把本次不同阶段直接标成固定负载的单/双节点对照实验。

以下总体数据来自 `execution-flow-diagnostics.json` 的完整窗口 `seconds/groups` 聚合。Host/Webview 分别淘汰了 1586/1148 条详情，但分组没有溢出；不能只用最后 64 条详情重算整体最大值或分位数。原始 host-messages 只保留末段约 22 秒，diagnostic-events 约 15 秒，不替代本窗口。

| 指标 | 本次结果 | 可支持的判断 |
| --- | --- | --- |
| 输入派发、Host 接收、写入完成、Webview ACK | 各 183 次；写入观测无失败 | 采集窗口内没有未完成输入，不能据此承诺业务已处理所有输入 |
| 输入 ACK 往返 | 最大 24603.2 ms；96/183 次超过 1 秒，85 次超过 5 秒 | 明确复现通信确认延迟 |
| Host 接收输入到提交 ACK | 最大 1.153 ms | Host 已进入该处理函数后的同步工作不是秒级延迟所在 |
| Host 写入调用至结果 | 最大 186.691 ms | 与 ACK 独立；不是 24.6 秒延迟的同量级解释 |
| 分页请求、Host 完成、Webview 收到、排队及应用 | 各 70 次，均无失败 | 可按 requestId 对应传输等待与本地处理 |
| Webview 分页往返 / Host 读页完整跨度 | 最大 16740.8 / 125.919 ms | Host relay 包含 Supervisor 等待，已测到的请求没有秒级读页跨度 |
| Webview 分页排队 / 应用 | 最大 0.400 / 12.400 ms；70 页应用累计 95.600 ms | 不支持此次秒级卡顿主要来自 xterm 应用排队 |
| Webview 主线程 timer-lag | 无超过 120 ms 阈值的记录 | 没有观测到大段 JS 线程停顿；不等于完成 React/paint 测量 |
| stateUpdated | 578 次，6284147 字节，575 次由 runtime-supervisor-live-snapshot 触发 | 高频全量状态发布有直接观测依据 |
| state-build | 平均 39.886 ms，最大 110.817 ms，累计 23054.175 ms | Host 同步工作负担明确；不是 CPU profile，不能称为 CPU 利用率 |
| Webview stateUpdated 同步 handler | 最大 0.400 ms | 不覆盖后续 React commit、布局与绘制 |

按同一 requestId 比较两端各自测得的时长，不相减跨进程时间戳：Agent 2 的读页 `c10cd017-cf72-4ec8-8378-537393bb2e11:16` 在 Webview 观测往返 16740.8 ms，Host 完整处理 6.226 ms，Webview 随后排队 0.300 ms、应用 0.400 ms。Agent 1 的读页 `8e292373-efcf-425c-862e-6bb5e8aaf0e5:50` 往返 13355.3 ms，Host 处理 125.919 ms，排队 0.400 ms、应用 3.500 ms。输入 sequence 136 对应 ACK 往返 16262.3 ms，Host 接收至提交 ACK 为 0.261 ms。差额位于 Host 处理函数外的往返路径，尚不能拆成单向 SSH、VS Code 转发、消息排队或浏览器递送的各自时长。

只使用 Webview 自己的时钟，可见第 40–67 秒派发 97 次输入却只收到 18 次 ACK；第 66 秒结束时累计有 80 次已派发输入未收到 ACK，第 68–69 秒收到 79 次 ACK 后追平。这个数量是 Webview 端在途确认数，不是 Supervisor 的有界输入队列长度。Webview 在等待期间仍持续记录输入派发和状态消息处理。

只使用 Host 自己的时钟，第 40–67 秒发布 439 次 stateUpdated（平均 15.68 次/秒，单秒 13–18 次），状态构造累计 17.112 秒，占该段 28 秒的约 61.1%；该段仅完成 3 次读页。全窗口状态消息约 6.28 MB，分页消息约 0.927 MB，前者约为后者 6.78 倍，两者均为完整消息 JSON UTF-8 字节；实际终端 output payload 为 499113 字节。状态广播是被测通用 postMessage 路径中的主要流量，不代表整个 SSH 连接的全部流量或物理带宽饱和。

本次未返回 Supervisor 内部 queue/read/total 字段，不能伪造为 0；但 Host 读页跨度已经覆盖这些阶段，所以对已完成且有关联的慢页，仍可判断秒级差额不在 Host 读页调用内。状态构造包含 Webview options、画布 payload 与 runtime context，尚未细分哪一项占用约 40 ms；采样消息 RTT 最大 20.808 秒亦包含回程。JSON 字节测量在保留详情中最大约 0.435 ms，缺少整个窗口的测量耗时聚合，不能据此断言诊断无扰动。

当前结论是：本次复现的主要可见延迟位于消息往返路径，Host 全量状态构造/广播为优先验证的负担；journal 优先级或 Webview xterm 调度器缺少作为首修目标的实测支持。下一步建议先拆清 state-build 内部成本，并对仅由连续输出引起的全量状态发布做单变量合并/去重对照，保留真实生命周期、配置、布局变化和分页通知。需同时观察 ACK RTT、状态构造耗时/频率、页往返、画布状态及时性和终端完整性。尚未证明状态广播是唯一原因，尚未实施性能修复，也不以该日志宣称网络、React 或整个 VS Code UI 已排除。
