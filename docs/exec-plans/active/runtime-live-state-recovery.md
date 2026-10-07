# 从权威当前状态恢复 live 终端

本 ExecPlan 按 `docs/PLANS.md` 持续维护。它只重新打开本轮 Runtime Persistence 重构的 live 状态恢复，不重开已经完成的容量治理、退出完整性或无 completed 历史实现。

## 目标与全局图景

Supervisor 仍存活时，重开 VS Code、重建 Webview 或从 PaneGallery 缩略图切回执行节点，应直接得到该执行的当前终端状态和配置内 scrollback，然后接收增量。相同当前状态、尺寸和 scrollback 的恢复工作不能随过去反复重绘、颜色设置等累计交互不断增加。已有读者必须继续收齐原有增量和退出尾部，不能用当前状态覆盖其尚未消费的输出。

## 进度

- [x] (2026-10-06) 核对 checkpoint + journal 路径，确认分页与容量证据不证明当前状态恢复；重新登记交付项。
- [x] (2026-10-06) M1：固定 xterm 6.0.0 精确状态 codec，覆盖模型、parser carry、palette 和链接；有限独立语义测试通过。
- [x] (2026-10-06) M2：接通 Supervisor、Host 转发、Webview 分块初始化与 revision 交接；保留旧能力、旧 generation 与既有读者结算。
- [x] (2026-10-06) M3 受控验证：等状态短长历史、实际生产类组合链、未来增量/resize/尾部，以及类型检查和默认构建通过。
- [x] (2026-10-07) M3 页面与 Linux Terminal 重开：实际浏览器重建和 PaneGallery 3/3、冻结 VSIX 的真实 current-state Reload Window 通过；原执行身份、未来交互、退出尾部与清理均验证。
- [x] (2026-10-07) M3 已有安装入口的受影响回归：run `37494231281` 的 macOS installed product 和真实 Agent 8 场景通过；Windows 同包定向 run `37507579337` 的 installed live-runtime 及真实 Codex/Claude live 4 场景通过。不把旧 Windows 失败追认成通过，初始订阅偶发停滞原因仍未确认。
- [x] (2026-10-07) M3 Linux/Codex 真实 live Agent 跨 Host 恢复：生产 run `37594259665` 的独立 Reload Window 验收通过；同一 Supervisor/session/authority、新 reader、后续真实输入、`terminalReadSettled=applied` 和原始资源退出均有工件证据。
- [ ] M3 恢复场景剩余：现代 macOS/Windows runner 的真实 live Agent 跨 Host 恢复路径。已有自然结束/主动停止及 completed 重开不能代证 live 重开；早期沙箱启动失败与 fixture 失败保留为历史，不再作为当前环境阻塞。`run-vscode-agent-runtime-reload-candidate.mjs` 已扩展为 Linux/macOS/Windows Codex 入口，待新 workflow 运行后分别登记结果，不改变固定八场。
- [ ] F-04 current-state 资源准入：在真实支持入口记录完整状态长度、Supervisor 捕获峰值、Webview 组装峰值、并发会话和超限处置；8192 字符分块只限定单页，不构成总内存预算。

2026-10-07 F-04 接线增量：既有 Linux `execution-capacity-tests.cjs` 在相同 2/10 会话、100000 scrollback、attach/compact 入口的 setup 收尾阶段优先调用 Host diagnostics，必要时在最终收尾补抓，归档每个会话的 Supervisor current-state descriptor（若诊断事件仍在 ring 中）及 Webview 完整组装长度、offset、chunk 数和保守组装峰值。该台账不设新的总长度/RSS 阈值，不截断状态；缺少完整组装事实会使该受影响 workload 失败并保留独立错误证据，原 workload 失败优先级不被工具取证错误覆盖。

2026-10-07 F-04 原生验证：显式 Linux candidate `linux-owner-v1-candidate` 分别以 `10:1` 和 `2:1` admission 构建。10-session `color` workload 的第一轮在后续交互阶段失败，但已保存 10/10 会话的完整 current-state 台账（最大状态 3956 字符、单会话保守组装峰值 7912、跨会话聚合 79112）；失败是既有 1500ms 交互观测以 1500.2ms 越界，不是状态取证缺失。独立重跑在第二个 Terminal 启动阶段超时，未覆盖第一轮证据。2-session `attach/compact` workload 也保存了 2/2 会话的完整台账（最大状态 3950 字符、跨会话聚合 15800、Supervisor descriptor 4 条），并完成 live checkpoint promotion/manifest 保留校验；最终 compacted projection 断言超时，现场已看到 nonce 回复和 checkpoint 几何 144x38，而此前动态 resize 观察为 143x38，不能将该轮写成通过或仅靠放宽断言取绿。F-04 的 current-state 资源准入及 attach/compact 产品 workload 仍开放；原始工件保留在 `.debug/f04-capacity-current-state-20261007/`、`.debug/f04-capacity-current-state-20261007-rerun/` 和 `.debug/f04-capacity-attach-compact-current-state-20261007/`。
2026-10-07 F-04 原生验证：显式 Linux candidate `linux-owner-v1-candidate` 分别以 `10:1` 和 `2:1` admission 构建。10-session `color` workload 的第一轮在后续交互阶段失败，但已保存 10/10 会话的完整 current-state 台账（最大状态 3956 字符、单会话保守组装峰值 7912、跨会话聚合 79112）；失败是既有 1500ms 交互观测以 1500.2ms 越界，不是状态取证缺失。另一轮也完成了 10/10 会话的状态台账（最大状态 3956 字符、单会话保守组装峰值 7912、跨会话聚合 79120），但没有形成完整 workload 通过结算。最新重跑 `.debug/f04-capacity-current-state-20261007-rerun4/` 以明确退出码 1 结束于第一个 Terminal 的尺寸协商：节点保持 `launching`，摘要为 `Waiting for node size before starting the embedded Terminal`，没有容量超限或 current-state 取证失败证据；不能把该环境/页面启动失败改写成 F-04 通过。2-session `attach/compact` workload 也保存了 2/2 会话的完整台账（最大状态 3950 字符、跨会话聚合 15800、Supervisor descriptor 4 条），并完成 live checkpoint promotion/manifest 保留校验；最终 compacted projection 断言超时，现场已看到 nonce 回复和 checkpoint 几何 144x38，而此前动态 resize 观察为 143x38，不能将该轮写成通过或仅靠放宽断言取绿。F-04 的 current-state 资源准入及 attach/compact 产品 workload 仍开放；原始工件保留在 `.debug/f04-capacity-current-state-20261007/`、`.debug/f04-capacity-current-state-20261007-rerun/`、`.debug/f04-capacity-current-state-20261007-rerun3/`、`.debug/f04-capacity-current-state-20261007-rerun4/` 和 `.debug/f04-capacity-attach-compact-current-state-20261007/`。

2026-10-07 定向修正后复验：attach/compact 断言改为以最终 Supervisor checkpoint 几何作为权威值，保留 nonce、reader、尾部和清理断言；Linux `2:1` candidate 重跑通过。2/2 会话 current-state 台账完整（最大状态 3950 字符、单会话保守组装峰值 7900、跨会话聚合 15800、Supervisor descriptor 4 条），live compaction 保留 current/previous checkpoint，reader identity 不变，交互回执约 5.3/7.3/8.9ms，cleanup 通过。该修正解释并收口了 143x38 中间 ResizeObserver 样本与 144x38 最终 checkpoint 几何的时序差异，不放宽资源或尾部判定；10-session workload 仍需独立通过后才能完成 F-04 准入。
2026-10-07 F-04 rerun5：Linux candidate 的固定 Terminal `10-session`、`100000` scrollback workload 在 `color` 和 `size` 两种场景均完成 10/10 会话的内容/测量结算，workload-specific observation budget 和 run-owned cleanup 均通过；没有生成 `first-failure.json`。两场景的最大 current-state 均为 4705 字符、单会话保守组装峰值 9410、跨会话聚合组装峰值 80618，分别观察到总 RSS 峰值 3825590272/3737235456、Host heap 104945268/104793232 字节，均低于本轮预声明观察预算。原始工件保留在 `.debug/f04-capacity-current-state-20261007-rerun5/`。该结果只收口固定 Terminal workload 的一次 Linux 观察，不是产品 RSS/Heap 上限、最大会话数或跨平台/真实 Agent 证据；`supervisorCaptureObservations` 为空，不能把 Webview 协商长度当作 Supervisor 捕获峰值。F-04 仍需明确正式资源模型、超限处置和真实 Agent/Webview 及现代 macOS/Windows 入口的验收，不能因 rerun5 勾选 checkbox。

2026-10-07 真实 Agent 重开入口：新增 `scripts/smoke/run-vscode-agent-runtime-reload-candidate.mjs` 与 `tests/vscode-smoke/agent-runtime-reload-driver.cjs`。该入口只在 Linux x64、已安装 candidate VSIX、DeepSeek 中转服务和真实 Codex CLI 下运行 setup/verify 两阶段：保存 Host/Supervisor/provider/wrapper/CLI/reader 身份，执行真实 `workbench.action.reloadWindow`，核对同一 runtime binding、同一 Supervisor/session/authority、新 reader、无新执行、重开后输入、stop 的 terminalRead applied、尾部结算和资源退出。当前只完成静态检查，未把未运行写成通过；命令为 `node scripts/smoke/run-vscode-agent-runtime-reload-candidate.mjs --installed-vsix <frozen.vsix> --output <new-dir>`。
2026-10-07 真实 Agent 重开入口：新增 `scripts/smoke/run-vscode-agent-runtime-reload-candidate.mjs` 与 `tests/vscode-smoke/agent-runtime-reload-driver.cjs`。该入口只在 Linux x64、已安装 candidate VSIX、DeepSeek 中转服务和真实 Codex CLI 下运行 setup/verify 两阶段：保存 Host/Supervisor/provider/wrapper/CLI/reader 身份，执行真实 `workbench.action.reloadWindow`，核对同一 runtime binding、同一 Supervisor/session/authority、新 reader、无新执行、重开后输入、stop 的 terminalRead applied、尾部结算和资源退出。初次 run `37590477910` 暴露了 driver 在异步结算到达前立即读取诊断事件的时序问题；提交 `fea31ff2` 后，driver 使用有界等待并严格匹配 reload 后 reader 的 `nodeId/sessionId/readId`，仍要求 `outcome=applied`。

2026-10-07 Linux/Codex 真实验收：生产 workflow run `37594259665`（复用已成功 package run `37577646133`，只选 `codex-live-runtime-natural` 以保持本项信号聚焦）整体通过。其 `runtime-production-agent-reload-linux-37594259665` 工件中的 `verify.json` 为 `pass=true`：同一 `legacy-detached` runtime binding、同一 Supervisor/session/authority、reload 后新 reader、无第二次执行、重开后真实 Codex 回复、停止时原始 CLI/provider 资源退出；`settlement-observation.json` 严格记录当前 reader 与 `runtime/terminalReadSettled` 的 `readId` 相同，`outcome.kind=applied`、`finalRevision=139`、`settlement=recorded`，最终 `bindings=[]`。较早 run `37593044002` 的整体失败只发生在固定 Agent 矩阵的 wrapper 观测时序（其独立 reload 工件仍为 `pass=true`），保留为历史，不覆盖本次成功验收。

2026-10-06 验证增量：默认 `typecheck`、`build`、debug staging、VSIX 打包和 `git diff --check` 通过；current-state codec 15/15、分页/relay 回归、reload 契约 12/12 通过，Playwright 的 Agent、Terminal 页面重建和 PaneGallery remount 3/3 通过。`test:runtime-supervisor-protocol` 在本地仅因沙箱禁止 Unix socket `listen`（`EPERM`）未运行完，不改写为产品失败或通过。此前真实 reload driver 仅依赖 Linux `/proc`、Linux provider/fixture 和 POSIX shell；本轮已补齐 Darwin `psutil/libproc`、Windows SafeHandle 观察与平台启动参数接线，CI 将在现代 Linux/macOS/Windows runner 执行，运行结果仍需各平台原始工件确认。

2026-10-06 GitHub run `37479044769`、`37494231281` 及 Linux 定向重跑 `37500016871` 复核：package 与六个 native assets 通过，macOS installed product 通过。Linux current-state reload 的 Electron 退出码为 0，但 driver 未留下 `setup.json`；前一次工件显示 A 会话被错误声明为 `role=b`，本次工件显示修正 role 后仍误用 `color` 场景，拒绝驱动发送的 `ping`；两者均属于验收驱动参数错误，不涉及产品协议。已将 A 固定为支持交互 ping 与 marker 的 `compact` 场景，待仅 Linux current-state 再重跑确认。Windows installed live-runtime acceptance 另在自然退出结算等待处超时，尚未归因到本次 F-04 观测接线。macOS Agent 失败发生在 live node `starting` 阶段，sanitized 报告没有 CLI、Supervisor 或 failure class，证据不足以归因认证、启动链或产品运行时。为避免下一轮再次丢失第一现场，驱动现在在 Agent 首次失败时保存脱敏 snapshot/events，并在 reload 缺少 phase receipt 时保存 names-only artifact inventory；这些是诊断可见性修复，不改变业务判定或放宽验收。

2026-10-06 F-04 观测接线：Webview current-state 完整组装后新增一次脱敏 performance diagnostic，记录 `currentStateLength`、`currentStateChunkCount`、最终 `currentStateOffset` 和保守的 `currentStateAssemblyPeakCharacters`；Supervisor/Host 原有 `stateLength`/chunk offset 继续保留。该接线只补资源账，不定义新的总长度阈值，也不将单页 8192 或估计峰值写成产品预算；真实 Electron 多会话、超限处置和现代三平台受影响入口仍待运行。

2026-10-07 定向复核：Linux run `37501128715` 已进入真实 Reload Window 的 verify 阶段，current-state 完整组装记录为 4834 字符、1 块、估计峰值 9668 字符，但随后新 nonce 回复的整行断言失败，整轮仍为失败。实际 fixture 的 marker 写成字面量 `\\r\\n`，没有换行；新增回归执行原 fixture 的 compact ping、marker、生产 codec capture/restore、后续 ping，复现回复与 marker 连行。只将 marker 改为真实 CRLF，保留原整行、同一执行身份、最终应用及清理断言；本地 reload 契约与新增回归 13/13 通过，等待真实安装包重跑，不将受控回归代证 Electron 通过。Windows run `37494231281` 的第一现场另显示 Supervisor 会话为 closed、source EOF、final revision 1382，但 Host 节点仍为 live、outputSequence 2；这不是进程对象句柄存续的证据，也不凭超时判定尾部丢失，继续定向检查事件/订阅交接。

2026-10-07 后续真实验收：原 CI 工件 `failure-getRuntimeSupervisorState.json` 明确保存了 marker 字面量与正确 nonce 回复连行，且 Webview 已 ack revision 7，确认本次失败源于 fixture 换行。当前环境原生执行已可用，未改测试启动策略；复用 run `37494231281` 的冻结 VSIX（SHA256 `8b0be701ecb29a142a6ebd1bb00e794e151e184bf70f8899a2e948e1e53ae675`），修正 fixture 后在真实 VS Code 1.117.0 完成一次 Reload Window，证据在 `.debug/b4-current-state-reload-crlf-20261007/result.json`。同一 UI、不同 Host/frame/reader、原 Supervisor/provider/subject 身份、恢复后新 nonce 回复、completed B 无历史且不重启、A 正常结束的原 reader applied、资源退出及零 fallback 全部通过。恢复状态 4825 字符、1 块、估计组装峰值 9650 字符，新 nonce 应用约 10.4 ms，整轮约 11.15 秒；这些是单次小状态观察，不代证 F-04 大 scrollback/并发准入。旧失败原样保留，不再重复排队 Linux 此用例或无改动 native 构建。

同日复核 run `37494231281` 的 `runtime-production-agent-macos-37494231281/summary.json`：8 个真实 Codex/Claude 场景均通过，Host/Supervisor/provider/Webview 四个产物 hash 与上述冻结 VSIX 一致。较早 run 的 macOS `starting` 失败保留为历史，不再列为当前阻塞；该矩阵仍不证明 live Agent 跨 Host 重开。Windows 的 `started.json` 原先未保留清空前的 messages/events，因此只补保存已有 initialSnapshot、启动期 messages/events 后定向重跑；不加自动重试，不改变超时、尾部或最终状态断言，不预先修改订阅业务代码。

Windows 定向 run `37507579337`（harness `43c66daa`）复用同一冻结包，native-assets/package 跳过，仅执行 installed live-runtime 与真实 Codex/Claude 的 natural/stop 四个 live 场景。安装用例 90000 行、5580126 写出字节、最终光标 `(6,2)`、原 reader applied final revision 1383、原 writer exit 0、571 字节 completed 节点、重开空历史与清理通过；不声称 ConPTY 输出与源字节逐字相同。Agent 脱敏报告为 `selectedPass=true / partialSelection=true / pass=false`，四个所选场景通过、无未知退出/强制清理/残留，未选的 snapshot-only 四项仍为 not-run，不改写全矩阵状态。原始工件保留于 `.debug/runtime-installed-windows-37494231281/`、`.debug/runtime-installed-windows-37507579337/`、`.debug/runtime-agent-windows-37507579337/`；Linux 原失败保留于 `.debug/runtime-installed-linux-37501128715/`，macOS 脱敏通过报告保留于 `.debug/runtime-agent-macos-37494231281/`。

本轮 Windows 首批 `0 -> 2` 有完整 receive/flush/consumed，而旧运行丢失了清空前记录，因此未确定旧停滞原因，不能宣称业务缺陷已修复，也不能归因 Windows 对象句柄语义。当前记录为未归因的间歇性风险，不仅凭历史失败追加平台矩阵或改动业务逻辑。另一本地 stock protocol 测试的 revision 断言有明确同步风险：等待任意 revision 增长可能只看到 PTY 输入回显，marker 随后作为实时增量到达，却被断言为必须在 subscribe 返回 head 以内；这是代码支持的竞态解释，旧运行无完整时序，保持原失败，不扩大为新工具前置。

## 意外与发现

`SerializedTerminalStateTracker.flushValidatedCheckpoint()` 拒绝颜色、OSC8、非 ground parser、标题栈和大于 256 Ki 字符等状态。`RuntimeSupervisorServer.openTerminalRead()` 仍选择最后一个可接受 checkpoint，因此有限分页没有使恢复摆脱历史。PaneGallery 的 mode key 切换确实卸载执行节点并重新 attach，而非只重绘。

新 Host 行上下文已经从 head 加有限摘要订阅，只有同 Host 短断线才从自身消费位置继续；无需再为行上下文引入第二套状态恢复。当前状态描述符的空 ANSI 正文也不能进入已结束会话的 legacy checkpoint 选择，故 reader 另保留 `currentStateCheckpoint` 标记直到被真正 durable checkpoint 替换。

独立复核发现生产 Webview 注册 OSC52，headless 原先不注册；若 R 落在中间，source 丢失未完成 payload，未来结束符不能触发目标 handler。已定向在 tracker 注册无副作用 observer 并补 codec/tracker/实际 controller 回归。导入不执行，R 后结束符按目标既有焦点策略处理，已完成历史不重放；不将该生产缺口扩成通用 addon 验证阶段。

原始 cell u32 JSON 在固定 80 列、24 行、1000 scrollback 的普通文本样本中为 1383643 bytes。精确逐通道 XOR/变长整数/run 编码后为 143227 bytes，仍保存全部 81920 cells，不以纯文本近似替代属性。状态和接收端组装仍为 O(当前模型)，不是常数内存或全局 RSS 保证。

## 决策记录

- 决策：增加 B4 未完成交付，保留 B1 至 B3 已取得的有限证据。理由：旧 A1 不包含历史无关恢复保证。日期：2026-10-06。
- 决策：优先实现固定 xterm 6 的精确当前状态传递，不引入 tmux 服务或替换引擎。理由：Supervisor 已有内存终端模型，ANSI serialize 的语义缺口不能靠提高阈值解决。日期：2026-10-06。
- 决策：新读者从捕获时刻状态开始，已有读者不可跳 revision。旧 Supervisor 保持原绑定和能力，不重启或迁移。日期：2026-10-06。
- 决策：复用 page RPC，状态块最多 8192 字符，独立 stateOffset，不推进事件消费位置。理由：复用一次一页、身份和取消链，避免大状态消息。日期：2026-10-06。
- 决策：默认 owned 新建采用 terminal-current-state-平台-v1 generation，原 terminal-exit generation 继续解析原 profile。理由：旧 Supervisor 不会热更新，不应继续成为新会话的默认 owner；不改变旧 live 绑定或 workspace/root 归属。日期：2026-10-06。
- 决策：palette 使用从终端创建起持续维护的有限覆盖表，捕获要求显式传入；导入不调用 `terminal.write`，cell 采用无损 `u32-xor-rle-v1`。理由：headless 不保留颜色状态，ANSI 重放与缺失颜色的静默默认都不等价。日期：2026-10-06。
- 决策：保留未完成 OSC52 的 parser carry，不执行已完成历史或导入时的剪贴板副作用。理由：跨 R 序列仍属于未来增量正确性，不能因两端 handler 差异静默丢弃。日期：2026-10-06。

## 结果与复盘

codec 与生产接线已实现，受控生产类组合验证已证明新读者不读取 R 以前事件，状态应用后才确认 R，并在真实尾部 write callback 后结算。相同模型的 1/400 次重绘样本均传送 4329 字符；codec 的 1/200/1200 次重绘样本均为 2632 字符。它们是结构证据，不是实际 VS Code、浏览器或跨平台性能验收。

整体 B4 尚未完成：受影响的三个 Playwright 浏览器用例、真实 Linux Terminal Reload Window 和真实 Linux/Codex Agent Reload Window 已通过，现代平台安装入口及受影响 Agent 生命周期结果见进度记录；剩余是真实 macOS/Windows live Agent 恢复与 F-04 当前状态资源准入。此前 Linux Electron `sandbox_host_linux.cc:41` EPERM/SIGTRAP 及 Unix socket EPERM 保持原失败，当前环境已可执行原入口；没有通过修改断言、用户现场节点、registry、服务或历史结果取得绿色。Windows 旧停滞保持未归因风险，不因单次通过宣称修复。旧 macOS/Windows 系统不属于本轮验收基线，现代 runner 的结果不外推到旧系统。

## 上下文与定向

`extensions/vscode/dev-session-canvas/src/common/serializedTerminalState.ts` 持有 headless xterm。`src/supervisor/runtimeSupervisorMain.ts` 在终端操作队列内处理 output、resize、scrollback；revision 是每次变更的单调位置，`terminalSessionJournal.ts` 保存增量。`src/common/terminalStreamPaging.ts` 和 `src/webview/terminalPagedProjection.ts` 实现逐页读取、应用、最终结算。Host `CanvasPanelManager.ts` 转发页面 reader；已核实新 Host 行上下文从 head 加摘要开始，未回放旧 checkpoint，不必改写。PaneGallery 卸载重建是新投影初始化，不是跳过有效旧读者尾部的理由。

## 工作计划

M1 读取固定 xterm 源码并实现精确状态 codec（只包含数据的导出/导入格式），覆盖正常/备用 buffer、属性、模式、颜色、链接、parser 中间状态、尺寸和 scrollback。以相同未来后缀下状态等价验证其成立，不添加通用诊断框架。取舍记录在 `docs/design-docs/runtime-live-state-recovery.md`。

M2 在原操作队列内捕获状态与 revision，按有界块传送，读者从捕获点后接续 journal。捕获前取得 reader 责任，完整应用前不宣称已消费；保留失败/取消类型。Host 转发与 Webview 协商新能力，行上下文保持既有增量订阅。旧协议兼容不冒充新架构验收。

M3 复用测试与浏览器入口，固定相同最终模型、不同历史，记录传输体积、旧事件读取数、应用次数及耗时。时间是观察，不读取捕获点以前 journal 是结构判据。验证重建、PaneGallery 聚焦/布局切换、输入、宽字符/样式/备用屏幕和尾部，只补受影响 Agent、现代平台及安装入口；同批记录 current-state 总长度、捕获/组装峰值及多会话准入结果，不以旧合并进程阈值代替。

## 具体步骤

在仓库根运行以下已有入口，不需要访问用户 Runtime 存储：

    npm run typecheck
    npm run build
    npm run test:serialized-terminal-state-tracker
    node scripts/test/test-runtime-supervisor-reader-client.mjs
    node scripts/test/test-supervisor-execution-owner-wiring.mjs
    node scripts/test/test-runtime-reader-settlement-wiring.mjs
    node scripts/test/test-terminal-paged-projection.mjs
    node scripts/test/test-runtime-supervisor-paths.mjs
    node scripts/test/test-runtime-supervisor-startup-profile.mjs

有原生执行权限后，先只运行新增浏览器用例：`node scripts/test/run-playwright-webview.mjs --grep 'current-state bootstrap'`，预期三个场景通过实际 DOM、palette、链接、parser 后缀和 reader 取消断言。随后在正常默认包中新建 Terminal 和真实 Codex/Claude live 会话，执行短/长等状态重绘、重开 VS Code 和 PaneGallery 聚焦切换，核对原 session/authority 不变、新 reader 从 R 初始化、旧历史读取为零、未来输入输出及最终尾部完整，再在现代 Linux/macOS/Windows 安装入口补相同受影响恢复路径。未修改 provider/native，六架构原生构建矩阵和未影响的 snapshot-only 用例不重新排队。实际 Agent 的未来输出与退出必须由真实 CLI 产生，不能用受控 caller 替代。

Playwright 当前状态用例已通过后，真实 Electron candidate 仍需独立在可启动原生 UI 的 runner 重跑；浏览器或实际 OS 验证被沙箱阻止时记录原失败和未验证项，不用 headless 单测替代。不得触碰用户 Runtime 文件来取得绿色结果。

## 验证与验收

等状态/scrollback 的短长历史样本恢复体积和解析工作相同或仅有固定协议开销差异，捕获前 output 读取为零。恢复后屏幕、光标、模式、颜色、链接及相同未来后缀一致；部分 ANSI/字符边界不损坏后续内容。取消不报告 applied，结束只在状态及其后直到 final revision 全部实际应用后结算。新页面创建不改变旧读者逐页消费责任。

## 幂等性与恢复

测试使用临时数据和受控会话，可重跑；失败只关闭本次 reader，不清空绑定。新接线前保持旧实现可运行，不重启旧 Supervisor、迁移会话或清理历史证据。

## 证据与备注

起始工作树已有三批历史节点清理改动，本计划保留，既不重做也不当成本项成果。既有活动计划 `runtime-terminal-state-restore.md` 是 2026-04 标签保活工作的历史，不将其旧结果当成本项验收。

2026-10-06 已取得的定向证据：codec 15/15、Supervisor 104/104、Client 31/31、Host reader wiring 27/27（包含实际 Supervisor/Client/Host/Projection/headless xterm，仅 OS/provider/socket 边界受控）、Webview controller 50/50 与 Host batch 10/10。tracker、completed resize 16/16、generation 路径、启动 profile 16 项、completed history、available credit、Webview message protocol 和 Host owner 定向 candidate routing 2 项通过。`runtime-checkpoint-refresh` smoke 已改为检查 current-state descriptor、stateChunk 连续覆盖和仅捕获点后的 events；尚未在真实 Electron runner 执行。类型检查和正常默认平台构建通过。时间只作观察，不引入旧 64/128 MiB 阈值；current-state 总长度与组装峰值仍是 F-04 待测项。

最终 `npm run build`、`npm run prepare:debug-main-only-extension` 和 `npm run package:vsix` 均成功，构建输出与 `.debug/vscode-extension-main-only/dist/` 的 extension、runtime-supervisor、webview、execution-candidate-selection 四文件逐字节一致，Supervisor/Webview bundle 均包含新 codec。该 staging 和 VSIX 只证明本地产物已刷新，不冒称 VS Code 加载或真实安装恢复验收通过。

浏览器用例首次启动失败轨迹仍保留在 `.debug/playwright/results/` 的 `webview-harness-agent-curr-65c1a*`、`terminal-c-30822*`、`pane-galle-5d938*`；后续聚焦重跑 3/3 通过。真实 Electron candidate 失败工件留在 `.debug/b4-execution-candidate-live/live-runtime/artifacts`，原始错误为 `sandbox_host_linux.cc:41` / `SIGTRAP`。另一个既有 `test-webview-build-xterm-entry.mjs` 的空 stdout 断言也保留失败：最小 `spawnSync(node, ['-e', 'console.log(42)'])` 返回 `status=0`、空 stdout、`error=EPERM`，属于当前进程启动权限限制，未修改该测试或登记新通用工具前置。

## 接口与依赖

使用已安装的 `@xterm/headless` / `@xterm/xterm` 6.0.0 与现有 serializer 补丁；已核对两端 common 模型源码。`terminalCurrentState.ts` 导出同步 `captureTerminalCurrentState(terminal, colors)` / `restoreTerminalCurrentState(terminal, state)` 及 palette reducer，状态标识为 `xterm-current-state-v1` / `xterm@6.0.0`。升级依赖必须重新核对私有字段，不能只改版本字符串。状态不包含回调、服务对象或可执行代码，不落入 registry、画板 JSON 或 durable checkpoint。

`terminalCurrentStateV1` 在 hello/ready 协商；open 的 `currentState` 为格式字符串，描述符只含格式/长度。page 的 `stateOffset` 请求与 `stateChunk` 响应不推进 revision。8192 字符块受原一次一页限制；只有实际 publication 推进已发送位置，首次普通 R 页请求确认客户端导入并释放冻结字符串。`TerminalPagedProjection` 调用 Webview 同一写队列的 import，再请求增量；final receipt 在这次确认之前不能成功。旧能力保持 checkpoint + journal，不回填新保证。

修订记录：2026-10-06，按最新要求重开 live 恢复；实施 M1/M2 并补齐受控链路证据与环境阻塞，M3 真实验收保持开放；区分资源治理与恢复复杂度，保留尾部契约和历史证据。
