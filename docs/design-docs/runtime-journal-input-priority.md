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
updated_at: 2026-10-27
---

# 执行节点通信与分页诊断

## 正式方案：短时诊断采集

2026-10-25 用户确认先实现诊断增强，再据实测选择修复边界。初始选定的是诊断方案，2026-10-26 进一步授权下节的构造内配置复用；Supervisor journal 优先级、Webview 全局应用调度、状态广播合并仍未选定。本 PR #337 承载诊断实现；发布 PR #327 保持未合并。

用户执行“开始执行链路诊断（120 秒）”，随后复现问题，用原有“落盘当前宿主诊断”导出新增 `execution-flow-diagnostics.json`。Host 与各 Webview 独立缓存元数据，在 120 秒后自动冻结；导出时停止并收集快照。再次开始会明确替换上一次采集。未开始时不计算消息 JSON 字节、不发送采样回执、不保留阶段事件。运行中的进程与终端 journal 内容、输入顺序、读页节奏均不改变。

共享实现 `src/common/executionFlowDiagnostics.ts`（路径均相对 `extensions/vscode/dev-session-canvas/`）提供有界记录器：每阶段最多 64 条详细记录，120 个每秒窗口按阶段保存计数、字节数、累计/最大耗时以及固定桶直方图，stateUpdated 单独保留每秒频率、消息字节和同步处理耗时；另按最多 128 个 stage/node/reason/messageType 组合累计。固定采集窗口内的聚合不随详细记录淘汰；导出明确细节淘汰量、分组溢出量和时钟域。字段只允许阶段、固定 messageType/reason 标签、生成的关联 ID、node/session ID、数值计数与耗时，不记录输入、输出、画布正文或错误正文。

`src/panel/CanvasPanelManager.ts` 记录输入处理、写入调用至提交结果、状态构造、消息提交和读页往返。`postState` 标记 live Supervisor snapshot 与普通 execution state sync 的触发原因；导出区分其它原因，不能将其它原因猜成 live output。state-build 覆盖 Webview options 与 payload 构造，不包含随后侧栏通知；采集期间量化实际提交消息的 JSON UTF-8 大小，并单独报告测量这一步的耗时。`postMessage` 的返回与原 `delivered` 字段不是浏览器接收确认。

2026-10-26 用户授权补充状态构造分段计时。保留原 `state-build` 总跨度，增加 `state-options-build`（getWebviewOptions）、`state-options-set`（Webview options setter）、`state-canvas-build`（prepareCanvasStateForWebview）、`state-runtime-build`（getRuntimeContext）与 `state-sidebar-notify`（同步 notifySidebarStateChanged）。同一次 postState 的总计与分段共用生成的 requestId，记录相同 messageType/reason，沿用每秒聚合、直方图和每阶段 64 条详情；侧栏是总构造跨度之外的独立阶段，不能与子阶段一起重复相加。options setter 的计时不包含 VS Code 后续异步应用，侧栏计时不包含异步渲染或 listener 内未等待的任务。

同步测量包装保留返回值和异常，失败阶段记录 success=false 后原样抛出；未开启时直接调用原操作，不额外计时、保留记录或发送消息。开启时原 state-build 总跨度包含分段记录自身的少量开销，不把它当作零成本探针。没有 Webview 时不虚构 options 的零耗时；采集冻结/到期时丢弃未完成跨度，不把缺失当成功。分段计时阶段只补这五段，不合并广播、不改调度或缓存策略，也不改变输入、分页及 ACK 语义。新字段随既有 execution-flow-diagnostics.json 导出，英文调试窗口继续使用 Start Execution Flow Trace (120 seconds)。

每个 surface 最多一个采样消息回执在途、最多每秒一个；Webview 在同步消息处理完成后回复 ID 与自身处理耗时，Host 用自己的单调时钟测提交至回执的往返。该时长包含返回路径和事件循环等待，不能称为单向传输时间。未回执数量和年龄随导出提供。详情本地缓存，采集期间不逐事件上传；正常输入 ACK 与 page request 原有流量不增加。

`src/webview/main.tsx` 记录输入派发与原有 ACK 往返、状态消息同步处理、page 请求至返回、page 等待写入及 xterm callback 完成。页面各阶段使用同一个 requestId、read/session 身份与 revision 边界。同步 state handler 不包含后续 React commit；记录此限制，不能把它解释成全部 UI 绘制成本。`src/webview/terminalPagedProjection.ts` 仅向应用回调透传请求 ID，不改变 busy、retry、revision 或回执语义。失败与取消不作为成功应用。

Host 同时记录 page-host-request 与 input-write-start 起点；只有完成的请求才进入对应时长分布，冻结时未完成的起点不能解释成成功或零耗时。

Host 在采集期间对 `RuntimeSupervisorReadTerminalPageParams` 加可选诊断标志；`src/supervisor/runtimeSupervisorMain.ts` 用自己的单调时钟在原 session 操作队列入口、读取开始、journal 读取完成处测耗时，将可选数值放入 page diagnostics。沿原对象返回，保留 owned reader 身份与结算。旧 Supervisor 不返回该字段时导出明确缺失，不重启旧会话，也不伪造零时长。

进程内部使用 `performance.now()`；快照中的 epoch 只供人工关联。跨本机 Webview 和 SSH Host 不直接相减 Date.now。输入 ACK 早于 PTY write，page applied callback 不保证像素已绘制，Host 收到的 revision ACK 可能迟到。诊断开关、可选 page 字段与详情采集失败不能阻止业务消息或推动 revision。

## 正式方案：构造内配置复用与自动化对照

2026-10-26 用户授权实现和自行验证。`panel/configuration.ts` 的读取函数接受可选的本次配置对象，`CanvasPanelManager.getRuntimeContext` 入口获取一次根配置并显式传递到文件、Agent、画布配置读取；Agent CLI 结果只构造一次供默认 provider 与两种启动默认值使用。`getSidebarState` 独立获取一次根配置，供自身文件、Agent 与 shell 配置读取。对象仅存活于当前同步调用，不保存到 manager 字段，不跨状态发布，不改变 editor/terminal section、资源 scope、默认值与正规化语义。shell 的 inspect 覆盖优先级保持原逻辑。非目标调用保留原默认读取路径。

保持 postState 的触发条件、通知顺序、广播节奏策略与输入/分页链路不变。实际单位时间完成的广播数可能随 Host 变快变化，应测量而不是强行固定。分两步冻结 runtime-only 和 runtime+sidebar 候选，与当前 cce236b3 基线比较，不增加产品配置开关。先测试配置等价性、下次调用可见变更与完整函数耗时，再用隔离真实 VS Code/Webview、受控 PTY CLI 和键盘事件验证单节点、双节点静默/单输出/双输出。受控 Agent CLI 不代表真实模型服务耗时。

自然输出 pilot 不产生现场的高频状态广播；因此额外加入独立标注的 10 Hz 状态发布压力场景，在测试副本调用既有 postState，不能将其解释为自然 Agent 行为。自动化对照在相同版本、配置、尺寸和固定负载下交错执行 A/B/C 与返回 A；请求输入标记只能由 PTY 程序接收后生成回复，使用同一 Webview 单调时钟测键盘派发至实际 xterm buffer 更新，ACK 单独报告。渲染事件和截图只验证可见性，不将 buffer 时刻称作像素呈现。遗漏、超时计入失败分母，记录实际负载与广播量、耗时分布及最大值。复用现有 VS Code/Playwright/Remote SSH 基础设施，独立 profile、工作区和 runtime，避免修改用户正在运行的节点。回环 Remote SSH 不外推用户跨机器网络或客户端压力；环境不能执行的部分明确保留失败证据与范围。

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

首采时的结论是：本次复现的主要可见延迟位于消息往返路径，Host 全量状态构造/广播为优先验证的负担；journal 优先级或 Webview xterm 调度器缺少作为首修目标的实测支持。首采时建议先拆清 state-build 内部成本，并对仅由连续输出引起的全量状态发布做单变量合并/去重对照，保留真实生命周期、配置、布局变化和分页通知。需同时观察 ACK RTT、状态构造耗时/频率、页往返、画布状态及时性和终端完整性。尚未证明状态广播是唯一原因，尚未实施性能修复，也不以该日志宣称网络、React 或整个 VS Code UI 已排除。


## 2026-10-26 分段采集与配置读取验证

输入为 `/home/users/ziyang01.wang-al/projects/dsc-test-01/.debug/current-host-diagnostics/2026-10-25T17-58-07-854Z`。Host 与 panel 同一 traceId，分别覆盖 69.270/69.272 秒，panel 收集成功、editor 未参与、frame 替换为 0；Host/Webview 详情分别淘汰 2559/1324 条，分组没有溢出。以下使用完整每秒聚合，不将旧采集与本次不同负载当作改善对照。本地复算及只读实验数值保存在主工作区 `.debug/diagnostic-analyses/2026-10-25T17-58-07-854Z/summary.json`，含原始 JSON 的 SHA-256；不提交原始用户诊断。

六种状态阶段均为 299 个样本，无失败；保留的 64 个 state requestId 均有完整六段关联。

| 阶段 | 平均 ms | 最大 ms | 累计 ms |
| --- | ---: | ---: | ---: |
| options 构造 | 0.039 | 0.129 | 11.618 |
| options 设置 | 0.019 | 0.344 | 5.622 |
| 画布状态构造 | 0.008 | 0.062 | 2.336 |
| runtime context 构造 | 35.333 | 68.461 | 10564.639 |
| state-build 总跨度 | 35.491 | 68.632 | 10611.874 |
| 侧栏同步通知（总跨度之外） | 15.146 | 24.367 | 4528.622 |

runtime context 占 state-build 累计耗时的 99.55%；每次状态构造加侧栏同步通知平均约 50.64 ms，不包含消息提交和后续异步 UI。299 次状态广播中 294 次来自实时 Supervisor snapshot，状态消息共 2636722 字节。这个结果把状态构造成本定位到具体函数，并没有证明它解释全部回显停顿。

本次 178 次输入均收到 ACK，写入观测均成功；ACK 最大 17911.9 ms，62 次超过 1 秒。Host 接收至提交 ACK 最大 1.400 ms，写入调用至结果最大 241.305 ms。Webview 派发 151 个读页请求、收到 150 个响应，其中 2 个失败，冻结时有 1 个尚未返回；不能称全部分页成功。Host 完成 150 个读页跨度，最大 160.038 ms；Webview 最长分页往返 17994.1 ms 对应失败响应。119 个普通 journal 页应用均成功，排队最大 0.700 ms、应用最大 12.400 ms、应用累计 71.000 ms。成功响应数与普通 journal 应用数不同，初始状态导入不计入该阶段，已淘汰的详情不足以逐条补全差额。本次仍缺 Supervisor 内部 queue/read/total 字段。

### 17 秒 Host 停顿保持未归因

Host 的 timer-lag 共 15 次，最大 17179.920 ms，记录于自身第 25.119 秒；第 8–24 秒没有阶段完成记录。Webview 此期间仍派发输入，第 25 秒集中收到 24 次 ACK。没有任何单次 state/runtime/sidebar 测量跨度接近 17 秒，不能把这次停顿归因到已测得的约 35 ms 状态构造。用户对期间是否断点暂停、手动暂停 F5 或休眠回答“不确定”，因此调试干扰、其它同步工作及进程调度等仍未区分，也不能反向确认是调试暂停。

另一个局部观察：Host 自身第 43–53 秒完成 110 次状态构造，累计 3941.77 ms，并有 109 次侧栏通知累计 1662.23 ms（边界使计数不同），无超过阈值的 Host loop-lag；Webview 自身第 43–53 秒收到 63 次输入 ACK，最大 572.2 ms。这不是同步时钟或受控实验，但说明持续状态构造与多秒 ACK 等待不能简单画等号。Webview 全窗口也有 10 次 loop-lag，最大 832.2 ms；不能沿用首采“未见 Webview 长任务”的描述，更不能用 lifecycle Healthy 排除性能停顿。

### 同一 Host 的只读配置获取微基准

代码核对发现 `src/panel/configuration.ts:getConfigurationValue` 每读一个键都调用一次无 section 的 `vscode.workspace.getConfiguration()`。`CanvasPanelManager.getRuntimeContext` 的常见 activeSurface 路径读取文件配置 4 次、Agent CLI 配置 5 次并在两个 provider launch defaults 中再各读 5 次、画布显示配置 4 次，合计 23 次获取根配置对象；其中 Agent CLI 读了三遍。另有 terminal/editor scoped 配置和资源 URI 构造，不在这 23 次内。

在同一活动 Host（PID 1860748、加载当前 worktree 的 main-only F5 包）用 inspector 的只读 Runtime.evaluate 比较这 23 次键读取。对照保留相同顺序与键，唯一改变是每键重新获取根配置对象，或单次获取后复用。四轮按原方式/复用/复用/原方式执行，每轮间 setImmediate 让出事件循环；四轮返回值比较一致，不输出或保存配置值，不修改配置、不暂停调试。

| 顺序 | getConfiguration 次数 | 耗时 ms | 返回值比较 |
| --- | ---: | ---: | --- |
| 1：原方式 | 23 | 38.725 | 一致 |
| 2：单次复用 | 1 | 1.336 | 一致 |
| 3：单次复用 | 1 | 1.604 | 一致 |
| 4：原方式 | 23 | 32.401 | 一致 |

23 个键为 `devSessionCanvas.` 下的 files.presentationMode、fileNode.displayStyle、files.nodeDisplayMode、files.pathDisplayMode；agent.defaultProvider、agent.codexCommand、agent.claudeCommand、agent.codexDefaultArgs、agent.claudeDefaultArgs（此组重复三遍）；canvas.overviewMode、canvas.overviewZoomThreshold、canvas.multiRootPresentationMode、canvas.workspaceRootWatermarks.enabled。该只读实验直接复现了与 runtime context 同量级的耗时，支持“重复获取根配置对象是具体成本来源”。它不等于完整 getRuntimeContext/postState 的替换实验，更不是输入回显的端到端 A/B，也未定位 VS Code 配置 API 内部实现成本。侧栏存在类似配置读取，但其 15.146 ms 包含其它状态构造和同步 listener，不能全部算成配置成本。

### 第二次采集后的修复验证建议

下一步优先验证单次同步状态构造内复用配置对象及 Agent CLI 读取结果，并检查侧栏中的同类读取。保持配置 section、scope、默认值、正规化语义与读取结果不变；每次构造重新获取，先不引入跨事件缓存或失效机制。保持状态广播频率、输入与分页策略不变，以隔离配置获取成本的贡献。该项是这次证据支持的候选修复；初次分析仅更新调查结论，后续授权实现及自动化结果见下节。

验收同时观察 runtime/sidebar/state-build 分布、广播频率、输入 ACK、分页往返、终端完整性及配置修改能否及时反映；构造变快但回显未改善时，不能宣称用户问题解决。后续无主动调试暂停的复现中如仍出现长 Host 停顿，再针对停顿补 CPU profile 或关联 VS Code 进程证据。广播去重、journal 优先级和 Webview 全局调度继续按受控结果决定，不因最初方案而预设顺序。


## 2026-10-26 构造内复用实现与独立自动化验证

实现限制在 `CanvasPanelManager.getRuntimeContext/getSidebarState` 的本次配置对象及 Agent CLI 结果复用。辅助读取函数接受可选对象，不传时保留原默认读取路径；runtime 的 editor/terminal section、侧栏 shell inspect 优先级、配置正规化均保留。postState 及输入/分页实现未修改；没有跨调用缓存和新增产品开关。

原配置构造代码固定于 `cce236b3ec1a6eb776c494f9f8ce971f408f4f16`。本地 `.debug/config-reuse/` 冻结 baseline、runtime-only、full 三个扩展副本，`run-a1/run-b/run-c/run-a2` 按 A/B/C/A 运行；每次使用真实 VS Code 1.126.0、独立 profile/workspace、受控 Python CLI、实际 native PTY、detached Supervisor 与 journal、真实 Webview。该桌面版本不同于现场记录的 1.140.0，不将绝对耗时互换。默认 systemd 启动 pilot 未确认并失败；后续使用现有 backend 环境覆盖隔离 Supervisor，持久化始终开启。文件监听配额不足在环境中存在，未修改机器级配额。

`node scripts/test/test-state-configuration-reuse.mjs` 由既有执行链路测试入口运行，执行真实构造方法和配置 helper，验证根配置获取次数、section/scope、Agent 参数及默认值、shell inspect 优先级、下一次构造读到新配置、旧 payload 不被修改及测试环境覆盖。既有 postState 测试继续核对广播/侧栏顺序、消息对象和异常语义。真实 Host 中另通过配置 API 更新并恢复测试参数，确认新构造可见变更。

独立驱动见 `scripts/diagnostics/diagnose-configuration-reuse.mjs` 和 `scripts/diagnostics/configuration-reuse/README.md`。测试专用观察代码只加在复制的扩展产物，不进入产品构建。Playwright 通过 textarea 键盘事件输入，只有 PTY 收到后才生成回复；同一 Webview 时钟测 keydown 至对应 xterm buffer 被观察到，ACK 单独保留。截图验证可见回复，不宣称像素呈现计时。

### 同一 Host 的完整构造对照

`run-c/benchmark.json` 在真实活动 manager 上对照原配置消费方法与完整复用候选，交替执行顺序，预热 10 组、保留 50 组；每组完整 runtime/sidebar payload 比较一致。原方法使用活动 manager 的继承对象，不修改正在测量的 manager 方法。其余未改依赖来自同一 checkout，configuration helper 无参行为保持原语义。

| 完整方法 | 原版平均 ms | 复用平均 ms | 降幅 |
| --- | ---: | ---: | ---: |
| getRuntimeContext | 1.731 | 0.373 | 约 78.5% |
| getSidebarState | 0.954 | 0.318 | 约 66.7% |

返回基线 `run-a2` 用同样的原版/参考方法检查：runtime 平均 1.405/1.375 ms，sidebar 0.734/0.784 ms，完整返回值一致。该负控没有出现候选中的大幅降耗。A1/B 的初始未配对均值存在窗口间波动，不能据其 sidebar 0.853→1.870 ms 判断 runtime-only 修改拖慢了侧栏。

### 键盘至 PTY 回复对照

每版运行四个自然场景：单节点输出、第二节点静默、仅第二节点输出、双节点输出；另加双输出并由测试驱动按 100 ms 间隔调用原 postState 的压力场景。每场景 40 次输入，合计 800 次，全部观察到对应 PTY 回复，无超时或缺失；A2 的两个测试 CLI 在 reset 后确认 PID 已退出。状态压力场景每轮约 10 秒实际完成 103–104 次构造，策略相同，不强求 wall-clock 内完成数完全一致。完整输入、阶段聚合、配置检查、尺寸及截图留在各 run 目录。

| 双节点场景 | A1 P95 ms | B P95 ms | C P95 ms | A2 P95 ms |
| --- | ---: | ---: | ---: | ---: |
| 自然持续输出 | 21.9 | 27.0 | 31.6 | 39.5 |
| 另加 10 Hz 状态发布压力 | 44.3 | 39.3 | 43.0 | 42.8 |

全组最大的单次回复延迟为 243 ms，没有复现现场秒级停顿。自然打印场景大多数没有 state-build 样本（C 的仅第二节点输出有 1 次），不具备现场每秒十余次状态发布的负载条件。压力场景为人工控制的调用负载，只能用于控制变量，不能冒充真实 Agent 的自然状态广播。上述 P95 未表现出稳定端到端改善；不能把完整构造下降 78.5% 写成输入回显加速 78.5%。目前确认的是配置构造优化成立且这些受控场景没有发现功能回归，现场卡顿与 17 秒停顿尚未闭环。


远程 setup 过程中另外确认了测试配置的作用域约束：`agent.codexCommand` 为 machine 设置，工作区设置不会覆盖远端机器的 CLI 路径。`remote-c2` 已进入真实 ssh-remote Host，完成 50 组原版/候选方法配对（runtime 1.524→0.300 ms、sidebar 0.785→0.276 ms，payload 一致），但随后因测试 CLI 未在远端机器配置中生效而未完成回显场景。该失败只支持方法配对结论，不能记为远程端到端通过。驱动已补远端配置 API 初始化和显式核对，再独立复测。


远程第三次试跑 `remote-c3` 已启动受控 CLI，但观察器按 LF 增量扫描，遇到自动折行会漏掉合并输出页较早的回复。这个测试缺陷由实际 xterm 的大量折行用例复现；最终 `browser-probe.mjs` 从 buffer 尾部反向搜索在途标记，不截断任意行数，找到全部后即停止。`scripts/test/test-configuration-echo-probe.mjs` 验证大页折行、未返回标记保持未完成及焦点隔离，接入既有执行链路测试。该轮缺失保留为失败证据，不能据其判断产品丢输入；修正后远程 A/C 对照另行记录。


修正后的 `remote-c4` 在 VS Code/Server 1.126.0 的真实 ssh-remote Host 完成五场景各 24 次，共 120 次键盘至 PTY 回复，全部成功，CLI PID 退出与临时 SSH 夹具清理均通过。完整构造配对 runtime 1.630→0.314 ms、sidebar 0.830→0.288 ms，payload 一致；双输出回显 P95 95.4 ms、人工 10 Hz 压力 P95 122.0 ms。它补足远程路径功能覆盖，只有候选没有同版远程基线，不以其单独声称延迟改善。随后取得与现场版本一致的 1.140.0，使用相同观察器、负载和场景完成远程 A/C 对照，见下节。


1.140.0 的首轮基线 `remote-140-a` 在创建测试节点之前遇到 shared Canvas commit lease 端口 22027 被占用；保留失败记录，没有停止占用端口的未知进程或修改产品锁逻辑。换用新隔离工作区的 `remote-140-a2` 完成全部 120 次回复，配置更新、CLI 退出及 SSH 夹具清理通过。此 setup 失败不作为回显性能样本。


### 与现场版本一致的 Remote SSH A/C 对照

VS Code/Server 1.140.0 的 `remote-140-a2`（基线）与 `remote-140-c`（完整复用）完成五场景各 24 次，共 240 次回复，全部观察到，配置更新及完整 payload 比较通过；CLI PID 退出和临时 SSH 夹具清理均通过。输入产物记录确认 Webview、驱动、观察器、CLI 的 SHA-256 一致，Host 产物不同；负载、输入间隔和样本数相同。最终截图可见额外 `REPLY_000121_7a`。统计保存在 `.debug/config-reuse/remote-summary.json`，原始成功/失败试跑保留。

候选 Host 的 50 组完整方法配对：runtime 原版平均 1.813 ms、复用 0.347 ms（降低约 80.9%）；sidebar 原版 0.927 ms、复用 0.329 ms（降低约 64.5%）。基线的实际/参考方法均值 runtime 1.545/1.526 ms、sidebar 0.758/0.744 ms，没有候选的大幅差异。

| 回显场景 | 基线 P95 ms | 复用 P95 ms |
| --- | ---: | ---: |
| 单节点持续输出 | 165.9 | 157.4 |
| 第二节点静默 | 117.7 | 117.4 |
| 仅第二节点持续输出 | 127.6 | 106.9 |
| 双节点持续输出 | 91.9 | 106.9 |
| 双输出另加人工 10 Hz 状态发布 | 130.7 | 140.8 |

自然场景两版均无 state-build 样本；压力场景分别采集 6.301/6.266 秒，都完成 63 次状态构造，累计耗时 306.736/91.207 ms。该场景普通 page-apply 为 196/195 页、250308/249288 字节；窗口边界和批次切分不要求完全相同。输入 ACK 各 24 次，最大 65.2/54.2 ms；已完成 page-roundtrip 各 195 次，最大 130.4/96.9 ms。所有场景已记录阶段均无失败。ACK/page 最大值的小幅下降不能替代回显改善证据。

输入节点尺寸两版均为 67×21；第二节点基线为 67×21，候选为 66×21，自动布局有一列差异。保留该控制限制，不把单轮小幅差异判定为性能回归或收益。P95 使用成功样本排序的 nearest-rank，此处成功率 240/240，无排除超时。两版本自动化合计 1160 次采样回复均成功，但受控环境未复现现场秒级卡顿、状态构造绝对成本亦显著低于现场。此轮完成配置复用的实现、语义与局部成本验证；仍未证实端到端稳定改善，17 秒原始停顿继续未归因。测试覆盖回环 SSH 与 detached backend，不覆盖跨机器网络、systemd 启动、真实 Agent 服务或精确像素 paint。


## 2026-10-27 配置复用后的现场反馈与下一步候选

用户反馈新版调试“已经没之前那么卡顿了，有一定改善”，提供 `2026-10-26T17-32-40-298Z`。这是现场改善反馈，不能继续概括为“现场改善未观察到”；同时两次采集不是同负载交错 A/B，短窗口亦不能证明旧的 17 秒停顿已消除。此次导出记录 VS Code 1.140.0、ssh-remote Host PID 686315、持久化开启、五个工作区根；未记录构建 commit，不能仅凭扩展版本号认证加载的确切源码 SHA。

本机复算证据写入当前项目 `.debug/diagnostic-analyses/2026-10-26T17-32-40-298Z/summary.json`，含新旧原始输入 SHA-256。Host/panel 窗口为 27.219/27.214 秒、同一 traceId，panel collected、editor 未参与、frame replacements 为 0。Host/panel 详情淘汰 4640/2221 条，分组无溢出；使用完整每秒聚合计算，并核对有维度的分组计数。host-loop/webview-loop 无 node/reason/messageType，不进入 groups，必须检查 seconds；本次没有达到 120 ms 报告阈值的 loop 样本，不代表逐帧无长任务。

| 阶段 | 前次现场平均 ms | 本次平均 ms | 本次最大 ms |
| --- | ---: | ---: | ---: |
| runtime context 构造 | 35.333 | 2.856 | 8.185 |
| state-build 总跨度 | 35.491 | 3.034 | 8.622 |
| 侧栏同步通知（总跨度外） | 15.146 | 3.378 | 9.807 |

本次 85 次输入派发均收到 ACK、写入观测均成功；ACK 平均 88.238 ms、最大 122.2 ms，Host 输入处理最大 0.556 ms、输入写入调用最大 17.654 ms。ACK 是输入确认，不是对应字符显示完成；这份被动诊断没有逐字符回显延迟。未在本窗口复现旧的秒级等待。

Webview 完成 266 次分页往返，平均 101.232 ms、最大 161.4 ms；Host 完成 268 次读页、平均 2.028 ms、最大 16.254 ms。Webview 共收到 268 页、排队 268 次（最大 0.2 ms），普通页完成应用 267 次（平均 1.041 ms、最大 12.5 ms），已记录阶段无失败。请求/响应计数受采集边界影响，开始处差额因详情淘汰不能逐条复原；末尾已有一页排队未记录完成应用，不能把 268 页都写成已应用。最慢保留请求 `7756bdef-fc93-4fed-8a44-d500119907c4:329` 的 Webview 往返 161.4 ms、Host 1.815 ms、Supervisor 0.124 ms，冻结时只有排队尚无完成应用记录；这些各自时钟内的跨度不能用来定位差额属于网络还是桥接排队。

本次首次具有 Supervisor 内部耗时：保留 64 次 Host page 详情，queue 平均 0.267 ms、最大 2.025 ms，read 平均 0.122 ms、最大 0.247 ms，total 平均 0.403 ms、最大 2.143 ms。该范围只代表保留详情，不能当整个窗口的最大值；没有支持先改 journal 优先级的竞争证据。当前 xterm 排队/应用也不支持把全局显示调度列为首修。

### 剩余明确负担

545 次 state-build/state-sidebar-notify 均由 `runtime-supervisor-live-snapshot` 触发，约 20.02 次/秒，各完整秒为 19–21 次。状态消息 6838291 字节，分页消息 586481 字节，前者为后者 11.66 倍；均为通用消息的完整 JSON UTF-8 统计，不等于物理 SSH 流量，更不能据此证明带宽饱和。主画布状态构造和侧栏同步通知分别累计 1653.320/1840.998 ms，合计约 3.494 秒同步跨度，占窗口约 12.8%，不是 CPU 利用率；还未包含全部持久化或异步侧栏/React 工作。

`applyRuntimeSupervisorSnapshot` 的 live 分支每次更新节点 metadata 后都调用 persistState 和 postState；后者通知所有侧栏。代码确认 `notifySidebarStateChanged` 先构造事件状态，Actions 监听器在视图存在时忽略该值，再调用 getSidebarState；摘要树在后续 getChildren 时再次构造。节点列表已有 75 ms 尾沿防抖，不能声称每次通知都造成一次实际渲染。本次侧栏 3.378 ms 是整个同步通知跨度，不是单独 getSidebarState，也不覆盖延后树刷新或节点列表异步计算。

### 推荐验证顺序（尚未实施）

1. 先在侧栏消费端复用事件携带的状态，按各视图实际消费的字段判断是否需要刷新；配置、信任、节点增删、运行状态、标题/目录/分组等变化仍按对应视图及时更新。不能只比较 CanvasSidebarState 并据此阻断节点列表事件，因为它不包含全部节点列表内容。侧栏关闭/重开、初始快照与事件顺序必须覆盖。此步保持主画布广播及输入/分页不变，独立量化构造次数与侧栏消息数。
2. 再设计实时快照到画布展示的变化判定，识别只改变终端输出进度而没有相关展示变化的更新。每次 journal revision/outputSequence/updatedAt 变化不应天然要求整份画布广播，但必须核对实际消费者，保留状态、标题、目录、恢复信息和布局等所需更新。持续变化的展示摘要是否允许合并及期限需单独设计，不能先拍定 5 Hz/10 Hz；也不以整对象相等比较代替字段分析。保持 journal 可读通知、分页、ACK 和持久化语义独立，本次没有授权或实施存储节流。
3. 使用原版、仅侧栏、再加画布筛选的受控对照，分别统计构造次数/耗时、侧栏及画布消息字节、真实回显、输入 ACK/page RTT，并验证持续输出期间状态/标题/目录变化、配置更新、侧栏重开、节点终止/删除和重建。仍有明显回显等待时，再用同路径轻量往返基线、进程/客户端证据区分约 100 ms 的传输及调度成本；不把它全部归咎于状态广播，也不预先承诺消除网络时延。

这轮只分析并记录证据及候选方案，未修改业务代码、未变更广播节奏。后续方案须以受控结果确认，用户现场的正向反馈与自动化尚未观察到稳定收益分别保留。


## 正式方案：侧栏消费端复用与展示去重

2026-10-27 用户授权实施侧栏优化及代理独立验证。基线为 d4edaa71（业务代码包含 56b29664 的配置复用）。不改变 CanvasPanelManager 的状态发布、事件产生、持久化、journal 或输入/分页路径；不从全局屏蔽侧栏通知。

CanvasSidebarView 使用事件携带的状态生成摘要快照，getChildren 复用该快照；比较实际摘要项（包括 tooltip 和 command）再通知树刷新，初次查询无快照时读取一次最新状态。CanvasSidebarActionsView 将事件状态投影为该 Webview 消费的 canvasSurface、filesFeatureEnabled、fileFilters；相同投影不再发消息。ready、视图重建和重新显示强制同步当前值；投递失败不能使同一状态永久被去重。

CanvasSidebarNodeListView 独立从节点/分组构造实际展示 items，比较展示 items 与展示分组，避免仅 outputSequence 等无关 metadata 变化发送消息；目录分类继续按刷新执行，工作区顺序及目录类型仍参与最终展示比较。summary 是 tooltip 的一部分，变化时不能丢弃。既有 75 ms 刷新等待改为有界合并：已有待执行 timer 不因持续通知重置，防止连续输出使更新无限延期。异步目录分类期间的新状态需再次处理，旧异步结果不得覆盖较新快照；ready、重开和显式 refresh 不受去重阻断。目录类型检测按实际刷新执行，避免引入无失效机制的长期文件系统缓存。

分阶段冻结 A 当前版本、B 仅事件值复用、C 展示去重产物。实际类回归覆盖字段变化、无关更新、初次查询、隐藏/显示、ready、投递失败及异步刷新顺序；真实 VS Code 1.140.0 运行从未打开/可见/隐藏后重开侧栏，以及双输出和人工 20 Hz 状态压力。统计构造调用、树通知和各侧栏消息/字节；回显使用已有键盘到 PTY 回复观察器。比较完整展示内容，主画布状态次数独立核对；结果及环境限制另记，不预写性能结论。


### 侧栏实现与定向验证结果

三个产品文件为 `sidebar/CanvasSidebarView.ts`、`CanvasSidebarActionsView.ts`、`CanvasSidebarNodeListView.ts`。配置/主画布发布代码不变。筛选面板只发消费字段；节点列表只发分组展示字段，几何变化不触发消息，summary 作为 tooltip 内容保留。已通过 `npm run test:sidebar-state-updates`、`npm run test:sidebar-node-list`（既有浏览器 DOM 用例同时执行新增实际类回归）、`npm run test:execution-flow-diagnostics`、`npm run typecheck` 和 build。实际类覆盖字段变化、首次读取、50 次无关通知、隐藏/重开、投递 false/异常后的重试、输出持续 240 ms 期间仍更新、删除及异步发布次序。`node scripts/test/test-sidebar-state-updates.mjs --baseline` 从 d4edaa71 加载旧三个消费者，在重复配置读取 `51 !== 1` 处如预期失败；当前通过。F5 main-only 包已准备，Host JS SHA-256 与冻结 full 候选一致。

诊断 runner 的 `--sidebar` 在复制产物中注入三个真实侧栏实例的计数器，五场景显式记录视图 created/visible。四个人工压力场景调用原 postState 20 Hz，另一个自然双输出场景不注入状态；两者分别报告。隐藏期间通过原 Host 方法改标题和 include 过滤，重新显示时同时核对 Host 期望、侧栏 payload 和实际 Webview DOM。初期本机 full pilot 40 次输入全部回复；最终对照独立使用 VS Code/Server 1.140.0 回环 SSH 与实际 PTY/Supervisor/journal。早期远程 `remote-a` 因连接回执文件写入中被读取而在业务开始前失败，驱动改为原子 rename 后使用新目录重测，不计为成功回显。

`.debug/sidebar-reuse/remote-a2`、`remote-b`、`remote-c` 分别为当前配置复用基线 A、仅事件值复用 B、完整侧栏优化 C。三个版本 Webview、runner、驱动、侧栏探针、CLI、输入观察器 SHA-256 一致，Host 产物不同；各五场景 24 次回复均成功，阶段没有记录失败、CLI 退出与 SSH 夹具清理通过。A/C 两节点均 67×21，B 第二节点为 66×21，保留这一列布局差异。计数器统计段和 execution-flow 段起止有几毫秒差异，广播数允许边界相差一次；不能要求两者各字段逐项相等。

| 可见侧栏、约 6 秒人工 20 Hz 压力 | A | B | C |
| --- | ---: | ---: | ---: |
| getSidebarState 调用次数 | 248 | 124 | 123 |
| 筛选面板状态消息数 | 124 | 124 | 0 |
| 摘要树刷新通知数 | 124 | 124 | 0 |
| 节点列表状态消息数 | 0 | 0 | 4 |
| 主画布 state-build 次数 | 124 | 125 | 123 |
| 侧栏同步通知累计 ms | 222.5 | 111.5 | 108.5 |

节点列表 A/B 的零消息处于原尾沿防抖被连续通知延后的场景，不能作为性能最优目标；C 保留了有界更新。上述侧栏同步跨度不含节点列表异步分类、后续树渲染或像素绘制，不能宣称全部侧栏 CPU 降低同样比例。C 未打开及隐藏侧栏均无 Actions/Nodes 消息；隐藏期间的修改在重新显示后通过真实 DOM 断言。没有引入跨构造配置缓存或全局事件去重。

B 的隐藏场景共 12 次回显超过 300 ms，最长 1692.4 ms，P95 1435.4 ms；无缺失不等于无卡顿。该窗口 Host state-build 最大 2.19 ms、侧栏同步通知最大 11.14 ms，Host page 最大 446.7 ms、Webview page RTT 最大 491.3 ms，未记录达到 120 ms 的 loop-lag；64 条保留 Supervisor total 最大 2.862 ms。不能凭这些跨度认定延迟由侧栏复用或环境造成，保留未归因。C 五场景最长回显 205.6 ms；短受控试跑不证明此类延迟已永久排除。


返回基线 `remote-a3` 也完成 120 次回复、DOM 校验及 CLI/SSH 清理，四轮 A/B/C/A 共 480 次回复，无缺失或已记录阶段失败。返回基线可见场景恢复为 248 次构造、124 条 Actions 消息、124 次树刷新，侧栏同步通知累计 151.6 ms；说明调用次数/消息减少可复现，绝对耗时受运行窗口影响，不用首轮 222.5 ms 独算固定降幅。A/C/返回 A 尺寸相同，两节点均 67×21；B 的一列差异与隐藏场景延迟异常独立保留。

| 回显 P95 ms | A | B | C | 返回 A |
| --- | ---: | ---: | ---: | ---: |
| 从未打开侧栏、人工压力 | 123.5 | 121.5 | 101.7 | 142.1 |
| 可见、人工压力 | 151.6 | 133.9 | 147.1 | 156.5 |
| 隐藏、人工压力 | 140.9 | 1435.4 | 160.0 | 141.0 |
| 重开、人工压力 | 152.5 | 139.3 | 102.6 | 133.0 |
| 可见、自然双输出 | 92.4 | 109.3 | 115.8 | 115.4 |

P95 为 24 个样本的 nearest-rank；无缺失样本排除。已确认的是重复构造/消息减少与侧栏正确更新，未观察到一致的端到端回显改善，也不能据单轮小幅变化断言回归。自然输出场景四轮都没有 state-build，与用户现场不同；人工压力明确为测试驱动。所有产物、输入身份、完整阶段及截图保留于当前工作区 `.debug/sidebar-reuse/`，汇总为 summary.json，复现脚本随 PR 提交。该本机回环验证不覆盖跨机器网络、真实 Agent 服务、systemd 启动或像素呈现；宿主仍有 watcher ENOSPC 警告，未更改系统配额。
