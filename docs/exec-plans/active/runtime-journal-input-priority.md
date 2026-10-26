# 执行节点通信与分页诊断

本 ExecPlan 按 `docs/PLANS.md` 持续维护。目标是让用户在 SSH VS Code 中复现 Agent/Terminal 回显卡顿后，导出能区分消息桥等待、状态广播、journal 读取和 xterm 应用耗时的证据；本阶段不宣称卡顿已修复。

## 进度

- [x] 2026-10-25：从 origin/main@37ff8554 创建 PR #337 的独立工作区，完成初始调度候选分析。
- [x] 2026-10-25：分析用户提供的四组 Agent 样本，修正“revision 落后即 xterm 饱和”的过早归因。
- [x] 2026-10-25：用户同意补充定向诊断；更新设计为 120 秒手动采集、本地有界缓存和阶段关联。
- [x] 2026-10-25：实现采集命令、共享记录器、Host/Webview 消息与分页阶段计时、可选 Supervisor 读取耗时和导出。
- [x] 2026-10-25：定向自动化测试、RuntimeSupervisor 整链、类型检查与 VSIX 构建通过。
- [x] 2026-10-25：收口验证记录；随本次提交更新 PR #337 标题与描述。
- [x] 2026-10-26：用户通过 F5 导出首份约 76 秒链路诊断；核验窗口、聚合和 requestId 关联，确认秒级等待主要位于本地处理跨度外。
- [x] 2026-10-26：补充 options 构造/设置、画布状态、runtime context、侧栏通知五段计时；异常、未开启、冻结与原执行顺序测试通过，重新构建并准备 F5 调试包。
- [x] 2026-10-26：分析第二份分段采集，runtime 占 state-build 99.55%；同 Host 只读微基准复现重复配置获取成本，记录 17 秒停顿未归因。
- [x] 2026-10-26：用户批准构造内复用及代理自行执行自动化验证；记录方案和验收边界。
- [x] 2026-10-26：冻结基线和 runtime-only/full 两个构建副本；实际方法配置测试、shell 配置与诊断回归及类型检查通过。
- [x] 2026-10-26：完成真实本机 VS Code A/B/C/A 的四种自然负载与额外 10 Hz 状态压力，800 次回复均观察到；同 Host 配对确认 runtime/sidebar 降耗及 payload 一致。
- [x] 2026-10-26：修正机器级测试 CLI 配置及折行观察器后，1.126.0 回环 Remote SSH 候选五场景 120 次回复全部通过，CLI/夹具清理通过。
- [x] 2026-10-26：完成 1.140.0 远程 A/C 共 240 次回显；完整方法降耗、状态压力次数相同，回显 P95 未稳定改善；记录第二节点一列尺寸差异及覆盖限制。
- [x] 2026-10-26：同步实测结果、回归与 PR #337 更新内容；17 秒原始停顿仍需独立归因。

- [x] 2026-10-27：分析配置复用后的 27 秒现场采集，记录用户改善反馈、runtime 2.856 ms、侧栏 3.378 ms、85 次 ACK 及仍有每秒约 20 次全量广播；建议先侧栏消费去重、再展示变化筛选，尚未实施。

## 上下文与定向

工作区 `/tmp/dsc-journal-input-priority-design`，分支 `docs-journal-input-priority` 基于最新 origin/main，继续现有 PR #337；发布 PR #327 暂停合并。当前主工作区有用户未提交修改，保持隔离。运行时代码在 `extensions/vscode/dev-session-canvas/src/`。common/protocol.ts 定义 Webview 消息，panel/CanvasPanelManager.ts 收发消息、消费 batch、relay 分页并导出诊断，webview/main.tsx 接收 page 并交给 xterm，webview/terminalPagedProjection.ts 管理每 reader 单页在途，supervisor/runtimeSupervisorMain.ts 在 session 操作队列中读取 journal。诊断只观察这些边界。

## 里程碑与工作计划

第一阶段在 common/executionFlowDiagnostics.ts 实现固定阶段、120 个每秒窗口、每阶段 64 详情与 128 个 node/reason/messageType/stage 总计的记录器，使用可注入单调时钟测试冻结和有界行为。严格白名单字段防止终端正文进入 trace。

第二阶段接入新命令 startExecutionFlowTrace 和既有 dumpHostDiagnostics。Host 发 120 秒启动配置，Webview 本地记录；导出请求一次性收集快照，3 秒超时与未参与必须显式记录。采样消息每 surface 同时最多一个、每秒最多一次，失败或迟到回执不影响业务。既有生命周期身份检查须覆盖新增消息。

第三阶段沿输入、状态广播、page 请求/读取/应用增加阶段记录；read requestId 透传至 page 应用回调。Supervisor 可选 page diagnostics 只返回自身 queue/read/total 时长，旧进程返回缺失字段合法。不得更改 session 队列、journal 顺序、读页触发、revision 或应用 ACK。

后续验证先针对 `panel/configuration.ts:getConfigurationValue` 与 `CanvasPanelManager.getRuntimeContext` 的重复根配置获取，比较构造内复用，保持广播频率不变。侧栏同步 listener 成本不能未经测量全算作配置读取；用户已授权此范围的实现与自动化验证。

第四阶段运行仓库根的 `npm run typecheck`、`node scripts/test/test-execution-flow-diagnostics.mjs`、`node scripts/test/test-terminal-paged-projection.mjs`、协议定向脚本和 `npm run build`。补能发现阶段关联丢失、越界、正文泄露、旧协议兼容或取消推进的回归。实际脚本与结果在本文件记录。

## 验证与验收

未启动时无新增 page 诊断字段、JSON 字节测量和采样回执。启动后不需要每条事件往返即可保留完整窗口聚合，详细环形记录淘汰不删除计数与耗时分布。导出 execution-flow-diagnostics.json 能按 requestId 连接 Webview request/receive/queue/apply 与 Host relay，同时看到 Supervisor queue/read 可用或缺失。输入 ACK 与 PTY write 明确分开；跨进程不相减 epoch。由代理运行独立真实 VS Code 与受控 CLI，以键盘输入和终端 buffer 回显做自动化对照，使用现有 Remote SSH 夹具核对远程链路；明确本机回环与用户现场拓扑差异，不将自动化结果外推到现场卡顿消失。

## 意外与发现

远程第三次试跑使观察器暴露自动折行漏报：按 LF 增量估计可见行数会漏掉同一合并输出页较早的回复。已抽出 browser-probe.mjs，改为从 buffer 尾部搜索全部在途标记（找到后停止），并用真实 headless xterm 的 400 行三倍折行页验证；未知回复仍未完成、错误焦点不计入输入。失败 remote-c3 保留，不将其缺失计数当作产品丢输入结论；最终远程基线/候选使用相同修正观察器。

Remote SSH 补验中，首次等待命令面板在远程下载/初始化期间失效，改为测试副本启动激活；第二次完成真实 ssh-remote Host 构造配对，但 CLI 未启动。证据表明 agent.codexCommand 是 machine 作用域，工作区设置被正确忽略；夹具已改为通过远端配置 API 设置并核对测试 CLI。两次 setup 失败保留，不计为回显成功；未修改产品的配置作用域。

2026-10-26 自动化 pilot：真实 VS Code 1.126.0、独立 profile、受控 CLI 的四种负载均完成 8 次键盘输入至 xterm 回复，使用实际 native PTY/Supervisor/journal。自然连续输出没有触发高频状态广播，因此新增独立标注的 10 Hz 状态发布压力场景（只在测试副本驱动既有 postState，所有候选同样触发）；不将其伪称自然 Agent 复现。默认 systemd 启动未确认，保留失败试跑后使用现有 legacy-detached 环境覆盖建立独立 Supervisor；持久化仍开启。宿主已有文件监听配额不足异常，配置 API 更新检查通过，但环境限制仍保留。


双输出样本 ACK 最大约 13.9 秒，但 Host 接收至发 ACK 为 0–1 ms；12:18:26–32 有 116 个 stateUpdated 而无新 page 提交，后续大页是追赶。Host 收到的 applied revision ACK 会受传输影响。旧性能记录偏向小页，不能用其 0.5ms 最大值代替完整 page 写入耗时。以上证据改变诊断优先级，尚不足以确认唯一根因。

实现验证发现原协议测试直接由 Node 加载 TypeScript：新增运行时依赖必须使用显式 .ts 后缀，仓库 noEmit 配置启用 allowImportingTsExtensions；未修改测试的解析路径。部分 Host 测试提取实际方法、绕过构造函数，已补真实记录器初始化。隔离工作区使用主工作区已有 generated/execution-assets 构建，保持默认 platform 执行资源。

首份新采集 `2026-10-25T16-26-03-114Z` 的 183 次输入均收到 ACK，但 96 次往返超过 1 秒、最大 24.603 秒；Host 接收至 ACK 最长 1.153 ms。70 页排队最长 0.400 ms、应用最长 12.400 ms；同一慢页往返 16.741 秒而 Host 处理 6.226 ms。578 次状态广播中 575 次来自实时 Supervisor snapshot，状态构造累计 23.054 秒。详细窗口口径、关联样本和缺失字段均登记到正式设计的新采集章节。

第二份采集 `2026-10-25T17-58-07-854Z` 覆盖约 69 秒，299 次 state-build 平均 35.491 ms，runtime 子段平均 35.333 ms、侧栏另加 15.146 ms；options 与画布构造很轻。同一活动 Host 内只读比较 23 次根配置获取与单次复用，耗时分别 32.401–38.725 ms 与 1.336–1.604 ms，四轮返回值相同。23 次包含 Agent CLI 配置重复三遍，微基准未覆盖完整状态构造或端到端延迟。另见 17.180 秒 Host timer-lag，没有相应长状态跨度；用户不确定是否有调试暂停，因此保持未归因。完整统计与请求成功/失败口径见正式设计的第二次采集章节。

## 决策记录

- 2026-10-25：用户批准本阶段诊断实现，取代旧计划的“只写设计”限制；实际性能修复继续待诊断归因和设计确认。
- 2026-10-25：继续 PR #337 而非另建关联 PR；采用手动短时采集与本地聚合，避免逐事件 telemetry 加剧被测消息桥压力。
- 2026-10-25：可选 Supervisor timing 随原 page 返回，兼容旧 Supervisor，保留原 owned reader 对象/结算关系。
- 2026-10-26：依据实际关联数据，下调 journal/xterm 调度作为首修方向的优先级；先研究状态构造与广播，并以单变量对照确认影响。没有把 Host 同步跨度写成 CPU 占用率，也没有把往返差额写成纯网络耗时。

- 2026-10-26：用户授权定向分段计时；五段使用现有有界采集，同次 postState 关联 requestId。保留总跨度与侧栏边界，本轮不实施 A/B 广播策略。

- 2026-10-26：将下一项受控验证优先收窄为构造内配置复用，暂不改变广播频率；依据是 runtime 分段与同 Host 只读微基准相互支持。只读微基准不能代替完整修复 A/B，17 秒停顿不归因于配置获取。此轮仅证据文档更新，没有实施性能修复。

- 2026-10-26：用户要求代理自行验证并授权开始；冻结 cce236b3 基线，按 runtime-only、再加 sidebar 的两步候选推进；不改变广播策略。

## 幂等性与恢复

再次启动替换旧采集；导出不清空本地记录，超时可重试。采集自动停止但保留结果；Webview 重建仅新实例可继续记录，旧实例缺失必须说明。回退该 PR 将移除观测与构造内配置复用，不改变任何终端历史或 reader 状态。

## 接口与依赖

只使用 TypeScript/Node/浏览器既有依赖；记录器接收 now 函数，快照返回白名单数值与 ID。新消息受协议校验和既有 lifecycle 约束，导出有界且不含正文。状态计时仅同步 handler，不能承诺 React commit 或像素 paint 完成。

## 本地验证记录

2026-10-25 在隔离工作区执行 `npm run typecheck`、`npm run test:execution-flow-diagnostics`、`npm run test:protocol-webview-messages`、`npm run test:extension-manifest` 与 `npm run test:ui-copy-localization` 均通过。分页验证包含实际 Webview controller 51/51、Host batch handling 10/10，以及真实 Supervisor socket/PTY 的可选读取耗时校验。首次协议整链运行在历史测试夹具缺少记录器处失败，补齐夹具后重新执行 `npm run test:runtime-supervisor-protocol` 全链通过，包含请求期限、旧会话重连、恢复订阅、模式切换竞争、实际 Supervisor 协议、checkpoint、分页投影、completed history、分页完成及输出 credit。

使用 `DEV_SESSION_CANVAS_EXECUTION_ASSETS_SET=/home/users/ziyang01.wang-al/projects/dev-session-canvas/generated/execution-assets npm run package:vsix` 完成正式 platform 资源的本地诊断包构建，产物为工作区根 `dev-session-canvas-0.26.0.vsix`。该构建阶段没有发布市场或执行真实 SSH UI 性能验收；2026-10-26 的首份用户采集另记于本计划发现章节。这是当前分支诊断包，不是 0.26.1 发布物。

安装此包后，打开原问题画布，执行 `Dev Session Canvas: 开始执行链路诊断（120 秒）`，复现单节点/双节点输出与输入，再执行 `Dev Session Canvas: 落盘当前宿主诊断`。新增文件 `execution-flow-diagnostics.json` 中 Host 与至少一个 surface 应有同一 traceId；surface 若 timeout、not-participating 或 replacements 非零，先按正式设计的缺失语义判断，不把缺失当零耗时。

2026-10-26 分段计时补充验证：`npm run test:execution-flow-diagnostics`、`npm run typecheck`、`node scripts/test/test-terminal-paged-projection.mjs`（实际 Webview 51/51、Host batch 10/10）及 `npm run test:protocol-webview-messages` 均通过。新增测试执行真实 postState 方法，用可控时钟验证各阶段耗时、总构造不包含侧栏/提交、同次 requestId、原 payload 对象与调用顺序、五个阶段原异常继续抛出、无 Webview 不伪造 options 样本、未开启不读计时器、采集冻结不阻止广播及 bootstrap 行为。`npm run build` 与 `npm run prepare:debug-main-only-extension` 成功；当前源码目录 F5 包包含五段计时。先前分发的 VSIX 为旧诊断版本，本轮采用 F5 复测。

本轮只补计时，未启动广播合并实验。用户应停止原 F5 调试并重新启动，在英文界面运行 `Dev Session Canvas: Start Execution Flow Trace (120 seconds)`，复现后运行 `Dev Session Canvas: Write Host Diagnostics to Disk`；新的 `execution-flow-diagnostics.json` 包含五段的详情和完整窗口聚合。

2026-10-26 构造复用回归：`npm run test:execution-flow-diagnostics`（含新 actual-method 配置复用测试）、`npm run test:terminal-shell-configuration`、`npm run test:agent-launch-presets`、`node scripts/test/test-terminal-paged-projection.mjs`（Webview 51/51、Host 10/10）、`npm run test:protocol-webview-messages`、`npm run typecheck` 通过。runtime-only 与完整候选分别构建；最终 `npm run prepare:debug-main-only-extension` 成功，当前 worktree F5 包为完整复用候选。新诊断脚本语法检查及 Python 编译检查通过。

## 结果与复盘

2026-10-26 构造内复用已实现，配置/API 更新及定向回归通过；真实 Host 配对 runtime 1.731→0.373 ms、sidebar 0.954→0.318 ms，完整 payload 一致。本机 A/B/C/A 共 800 次键盘至 PTY 回复成功；自然打印未产生现场的高频状态广播，人工 10 Hz 场景也未呈现稳定的回显改善。因此局部优化成立，用户现场卡顿及 17 秒停顿仍未闭环；Remote SSH 1.126.0 候选 120 次及 1.140.0 A/C 240 次均完成，配置/回复/清理通过；1.140.0 runtime 1.813→0.347 ms、sidebar 0.927→0.329 ms，但回显 P95 未稳定改善。


诊断实现与定向验证已完成，已生成本地诊断 VSIX；PR #337 更新后供复现使用。首份现场采集已把优先调查范围收敛到消息往返与 Host 状态构造/广播，第二份采集及只读微基准进一步定位重复配置获取的具体成本；构造内配置复用已完成实现与自动化对照；17 秒 Host 停顿和现场回显改善仍待独立确认，因此本调查计划继续保持 active。

修订说明：2026-10-25 根据实际日志和用户授权，将工作从调度器提案调整为定向通信/分页诊断实现。

修订说明：2026-10-26 补入首次真实 SSH 链路采集及聚合/请求关联核验；仅更新证据和下一步验证范围，未修改业务代码。

修订说明：2026-10-26 按用户授权实现状态构造分段诊断，记录本轮定向验证与 F5 复测入口；性能修复仍待新数据和对照验证。

修订说明：2026-10-26 补入第二份分段采集、同 Host 只读配置获取微基准及用户对调试暂停的不确定答复；优先验证构造内配置复用，保持长停顿未归因。本轮仅文档与数值复核，未重复运行业务测试。

修订说明：2026-10-26 用户授权实现及自动化对照，新增基线、候选、键盘至 PTY 回复验证与失败分母要求，独立测试环境不影响用户会话。

修订说明：2026-10-26 记录构造内复用实现、定向验证、本机 A/B/C/A 与同 Host 配对结果；区分局部降耗、自然负载和人工压力，未宣称现场卡顿消失。

修订说明：2026-10-26 完成同现场版本的 Remote SSH A/C，记录 240/240 回复、局部降耗、相同状态次数及未稳定改善的回显；保留端口占用 setup 失败和一列尺寸差异，原问题调查继续。

修订说明：2026-10-27 补入新版现场反馈与完整聚合复算；首次记录 Supervisor 内部读取证据，区分输入 ACK 与真实回显、侧栏构造与同步通知。候选优化顺序仍待设计确认，保留旧长停顿未归因。
