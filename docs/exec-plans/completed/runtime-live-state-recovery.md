# 从权威当前状态恢复 live 终端

本 ExecPlan 按 `docs/PLANS.md` 维护，于 2026-10-07 完成并归档。它只重新打开本轮 Runtime Persistence 重构的 live 状态恢复，不重开已经完成的容量治理、退出完整性或无 completed 历史实现。以下带日期的失败与阶段状态保留历史，完成结论以进度和结果为准。

2026-10-07 PR #295 review 更正：归档后的 `c9f9e105` 存在合法 OSC8 经 RIS/缩高后无法新建 current-state reader 的 blocker；此前“无新 blocker”和 e38d2f72 同包结论只表示修前时点。仅增加本项有限修复与定向验收，不重新启动容量、原生或诊断阶段。

## 目标与全局图景

Supervisor 仍存活时，重开 VS Code、重建 Webview 或从 PaneGallery 缩略图切回执行节点，应直接得到该执行的当前终端状态和配置内 scrollback，然后接收增量。相同当前状态、尺寸和 scrollback 的恢复工作不能随过去反复重绘、颜色设置等累计交互不断增加。已有读者必须继续收齐原有增量和退出尾部，不能用当前状态覆盖其尚未消费的输出。

## 进度

- [x] (2026-10-07) Review 定位与先红：真实 codec 和实际 Supervisor/tracker 的开读回归均复现 `unowned-link-marker`；缩高还发现空备用 buffer 保留旧容量的合法状态边界。
- [x] (2026-10-07) Review 修复验收：显式保留 detached/afterEnd marker 生命周期，源端不变；补 RIS、normal/alternate 缩高、current/saved 属性、后续同名链接与扩高/trim，以及三次新 reader/未来增量。codec 19/19、tracker、Supervisor 107/107、Host/reader 27/27、浏览器 3/3、typecheck/default build 通过；修前失败保持。新 head 待 PR 复审，不自动合并；旧 VSIX 不能冒充修后安装证据，不重跑未改原生/Agent/容量矩阵。
- [x] (2026-10-07) 非阻塞 reviewer 协议时序信号：`finalizingResizeRejected` 首败、原样复跑通过分别登记技术债，不改原断言，不代称本轮执行或完整 npm test 全绿。

- [x] (2026-10-06) 核对 checkpoint + journal 路径，确认分页与容量证据不证明当前状态恢复；重新登记交付项。
- [x] (2026-10-06) M1：固定 xterm 6.0.0 精确状态 codec，覆盖模型、parser carry、palette 和链接；有限独立语义测试通过。
- [x] (2026-10-06) M2：接通 Supervisor、Host 转发、Webview 分块初始化与 revision 交接；保留旧能力、旧 generation 与既有读者结算。
- [x] (2026-10-06) M3 受控验证：等状态短长历史、实际生产类组合链、未来增量/resize/尾部，以及类型检查和默认构建通过。
- [x] (2026-10-07) M3 页面与 Linux Terminal 重开：实际浏览器重建和 PaneGallery 3/3、冻结 VSIX 的真实 current-state Reload Window 通过；原执行身份、未来交互、退出尾部与清理均验证。
- [x] (2026-10-07) M3 已有安装入口的受影响回归：run `37494231281` 的 macOS installed product 和真实 Agent 8 场景通过；Windows 同包定向 run `37507579337` 的 installed live-runtime 及真实 Codex/Claude live 4 场景通过。不把旧 Windows 失败追认成通过，初始订阅偶发停滞原因仍未确认。
- [x] (2026-10-07) M3 Linux/Codex 真实 live Agent 跨 Host 恢复：生产 run `37594259665` 的独立 Reload Window 验收通过；同一 Supervisor/session/authority、新 reader、后续真实输入、`terminalReadSettled=applied` 和原始资源退出均有工件证据。
- [x] (2026-10-07) 定向收口跨平台 Reload 验收器：Windows 使用真实生命周期身份和原 SafeHandle 退出事实，stop 前核对原启动链，正常清理需零绑定/零会话后再结束隔离 Supervisor；macOS 最终退出应用而非仅关闭窗口。就绪判断不再将 Codex 的 loading composer 当作可请求模型的状态。行为回归通过，原生结果待下项回收。
- [x] (2026-10-07) M3 macOS/Codex Reload-only run `37608894493`：同一原 runtime/authority，新 reader；stop 前原 provider/wrapper/CLI 均 live，final revision 71 applied；bindings/pending/registry 清空、零 fallback、应用正常退出。
- [x] (2026-10-07) M3 Windows/Codex Reload-only run `37613057194`：原 Supervisor/provider/cmd/node/CLI 身份不变，Host 与 reader 更新，current-state 7062 字符；新 reader final revision 310 applied/recorded，四个原执行资源均由原 handle 明确确认退出，零 binding/pending/registry 与 fallback。历史 trust/sandbox 失败保持，不将对象仍存续当作进程仍运行。
- [x] (2026-10-07) F-04 current-state 结构与具名资源观察：完整状态长度、分层对象/字符串责任、实际分进程采样、新 reader 准入/超限拒绝及原尾部责任已核对；8192 仅为单页限制，离散 RSS/编码字符账不冒称精确 allocation peak 或总内存硬限。
- [x] (2026-10-07) F-04 有限受影响补证：`.debug/f04-filled-current-state-20261007-staged/` exit 0，固定两会话/color/100000 scrollback/2560 块后切换 panel 到 editor；新 reader 同原执行/authority，10200040 字符、1246 块完整恢复约 5114.9ms，B 18.4ms，新 reader final 6495/5 applied，cleanup 通过。
- [x] (2026-10-07) F-04 直接产品修复：同完整身份共享完整初始化 Promise，每 key 当前与未释放 reader 总责任不超过 2；重复开读、身份替换、取消压力、能力校验与原 client 释放先红后绿，最终 projection/controller 50/Host batch 10 和 settlement 27 通过。
- [x] (2026-10-07) 冻结最终 relay 修正源码 `e38d2f72`，正常默认 build、package:vsix 与本地安装 live-runtime 入口 exit 0；默认 admission 恢复为 executions:null/starting:1/pending:2，不以测试 2:1 作为分发默认值。
- [x] (2026-10-07) 最终生产包 run `37613549564` 整体成功，三平台 installed live/独立 Codex Reload、Linux Terminal Reload 及每平台单个 Codex natural 工件独立核对通过。VSIX 5882375 bytes / SHA256 a9d2a4475f697e8620511533ea585eb77bed0e6fae8df7a52f41b0ac49361752；六目标原生源码/hash 未变，复用 `37577646133` 原生资产，从 e38d2f72 业务源码构建新包。
- [x] (2026-10-07) 最终产品接线与来源/尾部/清理独立审查未发现新的确定性 blocker；当前模型同步成本、固定 xterm 私有 API、旧 Windows 未归因停滞已登记 tech-debt-tracker，计划归档。普通文档审查和 PR 更新不追加产品阶段，合并仍须用户授权。

以下为带日期的原始实施记录，记录当时的待验状态；当前剩余责任以上述进度为准，历史“仍开放”不自动形成新队列。

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

Windows run `37613057194` 的 launcher/driver/observer/contract 工件 hash 与 `31478d07` 源码一致；setup/verify 保存的唯一前后响应 marker 只有在严格 loaded composer 与独立行响应检查通过后才写出。成功工件未保存两轮完整屏幕 probe，不声称离线重放了原始画面。`reload-command-rejection` 的 `Canceled` 与新 Host 已完成 verify 同时保留，不能仅凭该命令返回值否认实际 Reload。仅在零绑定/零 pending/空 registry 后终止本次空闲 Supervisor，不要求其内核对象消失。

填充态首轮 `.debug/f04-filled-current-state-20261007/` 在准备阶段以 exit 1 结束，source receipt 为 1280 块、页面到约 1122 块，未进入 surface 切换；产品 cleanup 通过。新入口误把原三段各 30 秒压成一个 30 秒窗口，故只修正为原有分段发送、每段 receipt 与 suffix 排空后继续，唯一恢复验收仍在最终 2560 块后；恢复 30 秒和 B 输入 1500ms 不变。原失败不追认通过，不据此推定产品根因。最终 relay 的 settlement 回归曾在创建 relay 前的 history=400 prefix 等待超时，保留该次 exit 1；原生容量进程结束后单独复核 27/27 通过，日志 `.debug/f04-relay-final-settlement-20261007.log`，不以该结果解释旧超时。

同包 Reload-only 的 macOS run `37608894493` 已独立核对 setup、pre-stop-ownership、verify、settlement 与 cleanup：原 provider 4841、wrapper 4844、CLI 4852 在 stop 前存活，原 authority 保持且 reader 改变，当前 reader final revision 71 applied，零绑定、零 pending、空 registry 与零 fallback；最终应用退出不再超时。Windows run `37608896439` 的原生句柄测试通过，真实 CLI 在 trust 确认后停在 `Set up the Codex agent sandbox`，菜单要求 default/admin、non-admin 或 quit，最终未出现 composer；因此不是已证认证失败，也不是需要放宽模型就绪。仅补显式选择 non-admin sandbox 后继续等待完整就绪，保留 read-only/never 与禁用 shell tool 的固定约束。两次 Windows 失败均不追认通过。

对实际 `RuntimeTerminalReadRelay` 执行受控延迟 open，40 次同 key 请求生成 40 次远端 open、39 个 releasing binding 和一个当前 binding。原实现只复用已完成 descriptor，取消时仍等旧 open，故 map 中只有一个当前对象不能证明等待有界；Supervisor 的 128 活动 reader 限额也不计算已替换但仍在操作队列中的请求。这是具名结构性积压，不依赖旧内存观察阈值成立。

rerun5 的状态归档发生在首次大输出前，全部为单块、最大 4705 字符；后续隐藏/恢复均沿用同一个 reader。它是有效的多会话 live 输出证据，但不是大 scrollback 新读者恢复证据。生产 panel 到 editor 切换会关闭旧 panel reader，再创建 editor reader；不能将其描述为双 active surface 并存。Supervisor descriptor 与 Webview `2 * stateLength` 字符估计不分别等于捕获峰值或总内存，缺失前者不是已确认产品缺陷。

run `37605380825` 复用生产包 `37577646133`，三平台 installed live-runtime 和所选 Codex natural 场景通过，Linux 独立 Reload 也通过（当前 reader applied，final revision 129，bindings 为空）。macOS Reload 的 verify/driver 回执均通过（final revision 56），但最后一个窗口关闭后 Code 应用仍在，外层 220805ms 超时；该轮保持失败，不追认为成功。Windows 停在 pre-reload 模型响应等待，失败画面仍是目录信任提示；loading 阶段已有 composer 的代码事实解释了旧宽匹配的准入风险，但该轮缺少 ready probe，不能断言信任提示出现的精确时序。两者属于已确认需要修正的验收入口，不据此宣称产品丢尾部或认证失败。

`SerializedTerminalStateTracker.flushValidatedCheckpoint()` 拒绝颜色、OSC8、非 ground parser、标题栈和大于 256 Ki 字符等状态。`RuntimeSupervisorServer.openTerminalRead()` 仍选择最后一个可接受 checkpoint，因此有限分页没有使恢复摆脱历史。PaneGallery 的 mode key 切换确实卸载执行节点并重新 attach，而非只重绘。

新 Host 行上下文已经从 head 加有限摘要订阅，只有同 Host 短断线才从自身消费位置继续；无需再为行上下文引入第二套状态恢复。当前状态描述符的空 ANSI 正文也不能进入已结束会话的 legacy checkpoint 选择，故 reader 另保留 `currentStateCheckpoint` 标记直到被真正 durable checkpoint 替换。

独立复核发现生产 Webview 注册 OSC52，headless 原先不注册；若 R 落在中间，source 丢失未完成 payload，未来结束符不能触发目标 handler。已定向在 tracker 注册无副作用 observer 并补 codec/tracker/实际 controller 回归。导入不执行，R 后结束符按目标既有焦点策略处理，已完成历史不重放；不将该生产缺口扩成通用 addon 验证阶段。

原始 cell u32 JSON 在固定 80 列、24 行、1000 scrollback 的普通文本样本中为 1383643 bytes。精确逐通道 XOR/变长整数/run 编码后为 143227 bytes，仍保存全部 81920 cells，不以纯文本近似替代属性。状态和接收端组装仍为 O(当前模型)，不是常数内存或全局 RSS 保证。

## 决策记录

- 决策：B4 与最终 relay 受影响交付有限结账，归档计划；真实 Agent 共用跨 Host 当前态恢复由三平台 Codex 独立 Reload 承担，Claude 专属生命周期/快照证据沿用而不冒称同种 Reload。理由：最终同包安装、未来真实应答、身份、reader 最终应用与资源清理均有工件；没有新证据要求重跑未改 provider/native、完整八场或另立容量/诊断阶段。日期：2026-10-07。
- 决策：F-04 当前态的具名结构/资源观察收口，保留最终包与整体审查责任；不把精确 allocation peak、profiler、任意并发阶梯新增为门槛。理由：同 key 无界等待已经修复，当前态来源为用户保留模型而非累计交互；独立审查确认已有十会话与填充态新读者证据足以覆盖原具名输入，但不外推十个满 scrollback 同时导入或导入期间 B 延迟。日期：2026-10-07。
- 决策：Windows Reload 在专用临时 CODEX_HOME 预配置唯一空 workspace trust 与 unelevated sandbox，不继续用启动菜单按键时序阻塞运行时验收。理由：固定上游在绘制后清除待处理输入，配置键已核对官方参考与固定版本源码；实际失败内部时序未证明，保留全部原结果和新增真实 failure probe。交互式 CLI/模型应答/身份/尾部要求不变。日期：2026-10-07。
- 决策：relay 按完整原身份共享完整初始化 Promise，每 key 当前与未释放责任总量不超过 2（当前最多一个，全关闭时可暂有两个 releasing）；超限明确拒绝，不追加等待队列，不取消健康当前 reader。理由：直接修复可复现的取消等待积压，保持迟到 descriptor 的原 client 关闭、completeRemote 与最终应用责任，不为 O(当前模型) 的已选编码方案另造通用流式框架。日期：2026-10-07。
- 决策：在既有 capacity harness 新增显式 `--capacity-current-state`，固定两会话/color/100000 scrollback/2560 块后仅做一次新 reader 恢复；复用原安全与交互预算和 30 秒恢复观察。理由：只补已确认未测的大当前态路径，复用已有十会话 live/资源成果，不通过重复矩阵或扩充通用诊断来代替产品判断；结构性准入仍须独立核对，样本通过不代证任意状态或总 RSS 上限。日期：2026-10-07。
- 决策：新增 `agent_reload_only` 仅执行具名受影响 Reload，必须复用不可变生产包与同包、同平台已通过的 installed step 证据。Windows 同轮仅补身份读取/保留退出对象的原生测试；不重跑容量、六资产和完整 Agent 八场。理由：验收器收尾与就绪修正不改变产品字节，已通过证据不应成为重复矩阵。日期：2026-10-07。
- 决策：增加 B4 未完成交付，保留 B1 至 B3 已取得的有限证据。理由：旧 A1 不包含历史无关恢复保证。日期：2026-10-06。
- 决策：优先实现固定 xterm 6 的精确当前状态传递，不引入 tmux 服务或替换引擎。理由：Supervisor 已有内存终端模型，ANSI serialize 的语义缺口不能靠提高阈值解决。日期：2026-10-06。
- 决策：新读者从捕获时刻状态开始，已有读者不可跳 revision。旧 Supervisor 保持原绑定和能力，不重启或迁移。日期：2026-10-06。
- 决策：复用 page RPC，状态块最多 8192 字符，独立 stateOffset，不推进事件消费位置。理由：复用一次一页、身份和取消链，避免大状态消息。日期：2026-10-06。
- 决策：默认 owned 新建采用 terminal-current-state-平台-v1 generation，原 terminal-exit generation 继续解析原 profile。理由：旧 Supervisor 不会热更新，不应继续成为新会话的默认 owner；不改变旧 live 绑定或 workspace/root 归属。日期：2026-10-06。
- 决策：palette 使用从终端创建起持续维护的有限覆盖表，捕获要求显式传入；导入不调用 `terminal.write`，cell 采用无损 `u32-xor-rle-v1`。理由：headless 不保留颜色状态，ANSI 重放与缺失颜色的静默默认都不等价。日期：2026-10-06。
- 决策：保留未完成 OSC52 的 parser carry，不执行已完成历史或导入时的剪贴板副作用。理由：跨 R 序列仍属于未来增量正确性，不能因两端 handler 差异静默丢弃。日期：2026-10-06。

## 结果与复盘

codec 与生产接线已实现，受控生产类组合验证已证明新读者不读取 R 以前事件，状态应用后才确认 R，并在真实尾部 write callback 后结算。相同模型的 1/400 次重绘样本均传送 4329 字符；codec 的 1/200/1200 次重绘样本均为 2632 字符。它们是结构证据，不是实际 VS Code、浏览器或跨平台性能验收。

整体 B4 已完成声明范围：受影响的三个 Playwright 用例、等状态短长历史生产组合、真实 Linux Terminal、三平台 Codex Reload、填满 scrollback 后的 Linux 两会话新 reader，以及最终 e38d2f72 默认包的受影响验收均通过。run `37613549564` 的 installed 原 reader final revision 按 Linux/macOS/Windows 为 1398/8370/1380；Codex Reload 的新 reader 为 143/60/309，均 applied/recorded，原身份、后续真实应答与清理保持。Linux Terminal Reload 状态4821字符、整轮13.002秒、nonce13.1ms，最终applied7；三平台普通Agent报告仅 selectedPass=true，完整八场pass=false和七项not-run保持。完整来源、证据复用与边界见 `docs/design-docs/runtime-persistence-closeout.md` §13。

F-04 具名结构/资源观察已经收口；填充态109个250ms样本的总RSS最高约2.99GB，不是精确瞬时分配峰值或产品SLA，不要求追加profiler。Linux Codex cleanup中的旧诊断快照仍有stopping记录，最终空registry依据随后重新读盘的独立字段，不能声称整个退出过程均为空。Windows依据原handle确认退出，不要求对象销毁。历史sandbox、订阅停滞和onboarding失败原样保留，没有修改用户节点、registry、服务或历史结果取绿；旧系统不是本轮验收基线。

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

浏览器入口为 `node scripts/test/run-playwright-webview.mjs --grep 'current-state bootstrap'`，三个场景检查实际 DOM、palette、链接、parser 后缀和 reader 取消。真实入口使用正常默认包：Terminal 验证状态/scrollback、重开及尾部，三平台独立 Codex live Reload 验证原 session/authority、跨 Host 新 reader、未来真实模型交互与退出；已取得证据见进度。Claude 的既有真实生命周期、无历史和 snapshot 重开证据另行沿用，不称其独立执行过相同的 live Reload；共用恢复路径由 Codex 覆盖，不追加完整平台笛卡尔积。未修改 provider/native，六架构原生构建矩阵和未影响的 snapshot-only 用例不重新排队。实际 Agent 的未来输出与退出必须由真实 CLI 产生，不能用受控 caller 替代。

早期 Playwright 通过时，真实 Electron candidate 曾因 sandbox 受限而未完成；原失败保留，后续真实入口已按进度独立取得结果，不再重复排队该历史环境项。不用 headless 单测替代实际 OS 验证，不触碰用户 Runtime 文件来取得绿色结果。

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

修订记录：2026-10-07，保留 `37605380825` 原始失败与其独立成功事实，修正 Windows 原执行身份/未知退出判定、Codex loading 就绪和 macOS 应用退出；后续只使用严格同包证据复用的 Reload-only 入口，不增加通用诊断前置。默认 build、package:vsix 与 typecheck 已通过。

修订记录：2026-10-07，区分初始小状态组装与填满 scrollback 后新 reader 恢复，登记唯一具名的 capacity-current-state 补证；descriptor/字符串估计不冒称进程峰值，历史成功与失败原样保留。

修订记录：2026-10-07，登记实际 relay 可复现的在途取消等待积压及有限准入修复，当前态对象成本与无界操作积压分别处理；保持尾部、原绑定和未确认结果边界。

修订记录：2026-10-07，填充态 Linux 新 reader 真实通过，独立核对 1246 块、内容、原身份、两 final applied 与 cleanup；F-04 结构/具名观察收口而最终包保持开放。Windows 新 trust 失败不追认，改用精确临时配置准备，保持真实交互验收。

修订记录：2026-10-07，独立回收 Windows Reload-only 的原身份、原 handle 退出、当前 reader 结算和清理证据；冻结 e38d2f72 新业务包，只补最终受影响链路。将历史时点待办与当前有限队列分开，不追加工具或容量阶段。

收口记录：2026-10-07，最终新包37613549564三平台及Linux Terminal Reload工件独立核对通过；产品有限review无新确定性blocker，登记残余并归档，不重写旧失败、不自动合并。
