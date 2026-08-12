# 已死亡 PTY 的有界恢复与显式 Agent Resume

本 `ExecPlan` 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘` 这几个章节。

本文遵循 `docs/PLANS.md`。它覆盖一次跨 Runtime Supervisor、Extension Host、画布持久化状态和 VS Code 宿主 smoke 的恢复语义修正；所有实现与验证证据都必须回写本文。

> 2026-08-11 后续结论：本计划的“Agent只在用户点击后显式Resume”和“dead PTY不回放任意大小Journal”继续有效；“必须恢复有界terminal screen/recent output”和后续必须提供Journal分页浏览的结论已被 `docs/design-docs/runtime-control-and-projection-isolation.md` 取代。可信provider Resume identity才是最低必要数据，画面与recent output仅为可选增强。

## 目标与全局图景

当设备、远端用户会话或 `systemd-user` Supervisor 已经重启时，旧 PTY 已经死亡。用户重新打开画板后，应立即看到最后保存的、有界终端画面；`Agent` 节点提供明确的 `Resume` 按钮，由用户决定是否启动一个新的 provider resume 进程；`Terminal` 节点明确结束。Supervisor 启动不能回放任意大小的旧 Journal，也不能因历史恢复 OOM 杀死用户新建的 Agent 或 Terminal。

可观察验证是一个隔离 VS Code smoke：它先创建一个仍 live 的旧 Agent 和一个合成的、超过恢复预算的 V1 Journal，随后杀死 Supervisor、删除测试专属 socket 并模拟 Host reload。修复前，该场景必须由全量 Journal hydrate 触发受控失败或超出测试时间预算；修复后，新 Supervisor 保持可响应，旧 Agent 进入 `resume-ready` 且没有自动启动，原节点仍显示持久化终端快照，新建 Agent/Terminal 可运行，点击 Resume 前没有新的 provider PTY。

## 进度

- [x] (2026-07-30 02:00Z) 已确认现场根因与产品决策：4.1 GB / 625 万 event 的 V1 Journal 在 Supervisor restart 后被全量读入、解析和复制，造成 Node heap OOM；旧 PTY 已死亡时 Agent 不自动创建 resume 进程。
- [x] (2026-07-29 17:04Z) 建立可重复、修复前可失败的宿主 smoke：真实 fake Agent 写出超过 4 KiB 的 V1 Journal，测试专属扫描预算令旧实现的 registry recovery 收口为 `failureCount: 1`，不依赖真实 OOM。
- [x] (2026-07-29 17:10Z) 改造 Supervisor registry recovery：已死亡 PTY 只读取有界 Journal metadata 与画板快照，不调用 `open()` 或 hydrate 原始 Journal。
- [x] (2026-07-29 17:10Z) 改造 Host 的死亡 PTY 状态收口：Agent 只进入 `resume-ready` 并等待用户点击 Resume，Terminal 进入历史快照状态；旧 `pendingLaunch: 'resume'` 兼容状态会在加载时清除。
- [x] (2026-07-30 01:24 CST) 运行分层测试、更新设计/规格/计划；已登记仍未收口的按需 Journal 浏览容量边界，并将本计划移入 `docs/exec-plans/completed/`。
- [x] (2026-08-01 09:21Z) 处理 review P1：死亡 PTY 的 Journal manifest revision 不再提升显示序列；Host 保持 `serializedTerminalState` 与其原始 `outputSequence` 的原子配对，并将最终历史态收口为 `snapshot-only`。

## 意外与发现

- 观察：现场 registry 仅有少量 session，但其中一个 V1 Journal 具有 `lastRevision: 6251740`、1,046 个 segment，目录约 4.1 GB；V8 在约 4 GB heap 附近 `Ineffective mark-compacts` 后 abort。
  证据：2026-07-29 用户提供的 host diagnostics，以及 `TerminalSessionJournal.open()` 的 `scanTerminalJournalSegments()` 对每个 segment 执行 `readFile()`、UTF-8 转换、`split()` 和逐条 JSON parse。

- 观察：现有 `maybeFallbackAgentLiveRuntimeToResume()` 写入 `pendingLaunch: 'resume'`，Webview 的 effect 收到该字段后会调用 `startAgent(true)`。
  证据：`extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts` 与 `extensions/vscode/dev-session-canvas/src/webview/executionSessionNodes.tsx` 的直接控制流。

- 观察：画板持久化 metadata 已有 `serializedTerminalState`；它是 xterm 的屏幕和配置 scrollback 的有界序列化快照，Window reload 可用它恢复最后可见内容，而无需回放完整 Journal。
  证据：`extensions/vscode/dev-session-canvas/src/common/serializedTerminalState.ts` 的 `serialize({ scrollback })`，以及 `CanvasPanelManager.ts` 的恢复 metadata 路径。

- 观察：以真实 heap OOM 作为回归断言既慢又不稳定；4 KiB 的 test-only Journal scan budget 配合 512 行 fake provider 输出，可稳定按同一条全量读取控制流得到 `recovery.failureCount: 1`。
  证据：修复前运行 `DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=runtime-supervisor-reboot-recovery npm run test:smoke` 退出 1，断言显示 `failureCount: 1`；修复后同命令退出 0。

- 观察：Journal 可以先于 Host 持久化收到一个有效 event；此时 manifest `lastRevision` 大于 Host 最后渲染的屏幕序列，并不表示 Host 已经显示该 event。
  证据：review P1 smoke 在杀死旧 Supervisor 后直接向隔离 V1 Journal 追加一个 checksum 正确的 output record。旧逻辑把 Terminal 的 `outputSequence` 从 Host 保存值抬高到 manifest revision，随后因序列不匹配删除 `serializedTerminalState`；修复后该 smoke 通过并保留完整原屏幕。

## 决策记录

- 决策：先增加宿主 smoke，再修改生产恢复逻辑；测试使用合成 V1 Journal，不复制或删除用户现场的 4.1 GB Journal。
  理由：必须稳定证明无界 hydrate 是回归根因，同时避免测试依赖机器状态或损害用户历史。
  日期/作者：2026-07-30 / Codex 与用户

- 决策：确认 PTY 已死亡后，Agent 不自动 resume；Host 将节点置为 `resume-ready`，保留现有 Resume 按钮，只有点击动作才创建新的 provider resume PTY。
  理由：Resume 是有外部副作用的新进程，可能需要鉴权、分支选择或用户决定；它不能伪装为原进程复活。
  日期/作者：2026-07-30 / Codex 与用户

- 决策：不把“Journal 摘要”作为替换原始内容的存储策略。保留 Journal 原始 segment；启动期只读取 manifest/大小等有界索引，画板显示使用已持久化的 `serializedTerminalState`。完整 Journal 只允许后续显式、分页且受预算限制地读取。
  理由：删除或只保留摘要会破坏 Window reload 的已见内容；启动期全量回放又会造成 OOM。
  日期/作者：2026-07-30 / Codex 与用户

- 决策：将 `serializedTerminalState` 和生成它的 `outputSequence` 作为不可拆分的显示投影对。死亡 PTY 恢复时，Supervisor 继续读取有界 manifest，但绝不使用 `lastRevision` 改写该显示序列；Host 选择任一可信序列化屏幕后，节点序列必须取该屏幕自身的值。
  理由：Journal 有可能包含 Host 尚未渲染或尚未持久化的 event。把它的 revision 与旧屏幕混合，会让 freshness 检查错误地丢弃用户最后已见的完整画面。
  日期/作者：2026-08-01 / Codex 与用户

## 结果与复盘

已完成。修复前，新增的真实 VS Code 宿主 smoke 使用 512 行 fake Agent 输出形成超过 4 KiB 的 V1 Journal；旧实现会在 Supervisor restart 时走 `TerminalSessionJournal.open()` 的全量扫描路径，受控预算稳定收口为 `recovery.failureCount: 1`，而不是等待真实 OOM。修复后，同一场景的 `hello.recovery.failureCount` 为 `0`：Supervisor 只读取 manifest 与 segment `stat` metadata，旧 Agent 保持 `resume-ready`、`pendingLaunch` 为空且点击 Resume 前没有新 provider 输出；旧 Agent/Terminal 都保留 Host 已持久化的 `serializedTerminalState`，同时在 recovery gate 期间创建的新 Agent/Terminal 均保持 live。明确点击 Resume 后才观察到新的 fake provider resume PTY。

本轮实际通过 `npm run typecheck`、`npm run test:terminal-session-journal`、`npm run test:runtime-supervisor-protocol`、`npm run test:ui-copy-localization`、`DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=runtime-supervisor-reboot-recovery npm run test:smoke`、`DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=systemd-user-real-reopen npm run test:smoke` 与 `DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=systemd-fallback-real-reopen npm run test:smoke`。真实设备/Remote SSH 的长期断开人工验收不包含在本轮；完整 Journal 的按需查看、分页与容量预算也没有实现，已更新既有 Journal 容量技术债，不能把原始 segment 留存表述为“已能浏览完整历史”。

2026-08-01 的 P1 补充修复确认了显示投影的另一条边界：死 PTY 的 V1 Journal manifest 可以领先 Host 已保存的屏幕。新的 host-level smoke 在隔离 storage 中制造 `lastRevision > Host outputSequence`，并先验证旧实现会丢弃屏幕快照；修复后旧 Terminal 进入 `snapshot-only`、保持原 `serializedTerminalState` 和其序列，新建 Agent/Terminal 仍 live，旧 Agent 在用户点击 Resume 前不启动并在点击后成功启动。实际通过 `npm run typecheck`、`npm run test:runtime-supervisor-protocol`、`npm run test:terminal-session-journal` 与 `DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=runtime-supervisor-reboot-recovery npm run test:smoke`。

## 上下文与定向

`extensions/vscode/dev-session-canvas/src/supervisor/runtimeSupervisorMain.ts` 是独立 Supervisor。它把运行中的 PTY 和 `TerminalSessionJournal` 写入 registry；修复前 `recoverRegistryInBackground()` 对 registry 的每个 session 调用 `normalizeRecoveredSession()`，后者执行 `TerminalSessionJournal.open()` 和 `getRecoveryCandidates()`。这条路径读取并克隆完整 Journal event，尽管恢复结果必定为 `live: false`，因为重启 Supervisor 后它不再有旧 PTY 的 master 端。

`extensions/vscode/dev-session-canvas/src/supervisor/terminalSessionJournal.ts` 管理原始 Journal。V1 格式无 checkpoint，恢复候选需要 genesis 以来的所有 event；因此任何启动路径都不得把 V1 原始 segment 当作可无界载入的元数据。manifest 是一个小 JSON 文件，包含 session、authority、last revision、segment 数与 checkpoint 引用，适合作为启动前判断。

`extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts` 维护画布节点与 runtime session 的映射。`markExecutionNodeAsHistoryRestored()` 将 Supervisor snapshot 归入静态状态；修复前 `maybeFallbackAgentLiveRuntimeToResume()` 会让 Webview 自动启动 resume。`extensions/vscode/dev-session-canvas/src/webview/executionSessionNodes.tsx` 已显示 New session / Resume 按钮，但其 `pendingLaunch` effect 会自动发起启动，因此死亡 PTY fallback 必须保持该字段为空。

`tests/vscode-smoke/runtime-supervisor-reboot-recovery-tests.cjs` 与 `scripts/smoke/run-vscode-smoke.mjs` 已提供真实 Supervisor、真实 PTY、fake provider、SIGKILL、测试专属 socket 和 Host reload 的隔离模型。新回归应在这条模型中构造自己的 Journal fixture；不得重启真实设备，亦不得触碰 workspace 之外的 runtime 或 Journal 路径。

实现完成后，`normalizeRecoveredSession()` 不再打开或回放 Journal；它只调用 `readTerminalSessionJournalMetadata()` 进行有界 manifest preflight，但 `lastRevision` 只能保留 Journal 审计意义，不能提升已保存显示的 `outputSequence`。死亡 PTY 的恢复 session 标记为 `recoveredFromDeadPty`，其 Supervisor snapshot 不再包含 terminal stream 或 serialized projection，因此不会覆盖 Host 已保存的完整有界画面。`markExecutionNodeAsHistoryRestored()` 选择可信屏幕时必须一并选择它自身的序列；没有屏幕时才可退回多个 metadata 序列的最大值。

## 工作计划

第一个里程碑只增加回归测试和测试专属观测点。测试必须先让一个 live Agent 产生日志与持久化 terminal snapshot，再在它的 Journal 存储位置创建可识别的 V1 大量 event fixture，或使用测试受控预算让现有无界路径确定性拒绝它。杀死 Supervisor 后，Host reload 触发重新启动。旧实现在全量读取前或读取中必须以测试可观察的方式失败；测试不得依赖真实机器 OOM。失败信号可以是显式的 test-only maximum event guard，而不是等待 Node 的 heap abort。

第二个里程碑为 Journal 增加轻量 metadata preflight，至少返回 manifest version、last revision、segment count 和累积 segment bytes，且不会读取 segment 内容。Supervisor recovery 根据 session 是否仍可能拥有 live PTY 决定路径：新进程启动的 registry session 绝不拥有原 PTY，因此只恢复 registry snapshot、terminal authority 和有界持久化 `serializedTerminalState`，不创建 `TerminalSessionJournal`、不读取 recovery candidate、也不把 session 加入后续 journal replay 队列。原始 Journal 不删除、不修改；其未来查看接口必须显式分页并另行定义预算。

第三个里程碑调整 Host 状态机。Supervisor 对死亡 PTY 返回一个明确的 non-live snapshot；Terminal 调用 `markExecutionNodeAsHistoryRestored()`，保持已有的 terminal snapshot。Agent 若带 provider session identity 则调用一个只改变状态的 helper，成为 `resume-ready`，但必须写 `pendingLaunch: undefined`；Webview 将其展示为 Resume 按钮。没有 identity 的 Agent 走历史态或 interrupted，不能猜测“最近会话”。正常 Host/Window reload 而 Supervisor 尚存时，既有 live attach 路径不变。

最后一个里程碑运行测试并记录证据。定向协议、Journal 与 smoke 测试必须通过；smoke 要证明旧 Agent 没有因状态收口被自动 resume、新建节点仍正常、持久化终端 snapshot 可显示、Supervisor 没有读取超预算 Journal。测试完成前不得删除现场 Journal 或把“未实现按需历史浏览”称为已交付。

## 具体步骤

1. 在仓库根目录更新本计划、`docs/design-docs/runtime-supervisor-recovery-readiness.md`、设计索引与 `docs/product-specs/runtime-persistence-modes.md`，把死亡 PTY、显式 Resume、有界 snapshot 与 Journal 保留的语义写成正式结论。

2. 在 `tests/vscode-smoke/runtime-supervisor-reboot-recovery-tests.cjs` 和 `scripts/smoke/run-vscode-smoke.mjs` 增加恢复预算 fixture 与断言。先在未修复实现上运行：

       DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=runtime-supervisor-reboot-recovery npm run test:smoke

   预期第一轮失败的原因必须是旧全量 Journal recovery 命中测试预算，而不是随机超时、真实 OOM 或新 Agent 启动失败。

3. 在 `terminalSessionJournal.ts` 添加不读取 segment 的 Journal metadata API 与纯测试；在 `runtimeSupervisorMain.ts` 让 registry recovery 使用它，并保证 `live: false` 的恢复不会触发 `open()`、`getRecoveryCandidates()` 或将大量 event 保留在内存。

4. 修改 `CanvasPanelManager.ts` 与必要的共享状态类型/测试：死亡 PTY 的 Agent 只进入 `resume-ready` 且 `pendingLaunch` 为空；Terminal 恢复已有序列化快照。确认 `executionSessionNodes.tsx` 的 Resume 点击仍调用 `startAgent(true)`，但自动 effect 不会运行。

5. 在仓库根目录运行：

       npm run typecheck
       npm run test:runtime-supervisor-protocol
       npm run test:terminal-session-journal
       DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=runtime-supervisor-reboot-recovery npm run test:smoke
       git diff --check

   如改动影响 systemd reopen，再补跑两个 reopen smoke；仅记录实际运行且通过的命令。

## 验证与验收

修复前新 smoke 必须稳定暴露旧行为：受控的巨大 V1 Journal 被 recovery 路径要求全量 hydrate，测试以明确的预算错误失败，而非把宿主 OOM 当作测试成功。修复后相同 fixture 必须通过，并同时满足：Supervisor hello 可进入 `ready`；大 Journal 只产生 manifest metadata 读取；旧 PTY 对应 Agent 不存在 live process 且不自动创建 resume process；该 Agent 的 Resume 按钮可用；旧 Terminal/Agent 节点保留 window reload 前保存的 `serializedTerminalState`；同一 Supervisor 启动期间新 Agent 与 Terminal 可创建、输出 marker 并保持 live。

人工验证在 Linux/Remote SSH workspace：运行一个 Agent，记下可见输出后重启用户会话或杀死 Supervisor，再重开画板。预期显示最后已保存的终端画面和明确结束/Resume 状态；没有未经点击的 resume CLI；新建节点可立即运行。手工检查不替代自动 smoke。

## 幂等性与恢复

测试创建的 Journal、socket、gate、fake provider 与 storage 都位于 smoke runner 生成的隔离目录，并由 `finally` 清理。测试生成 large fixture 时应使用小型重复记录配合可配置 event count，不能占用 GB 级磁盘。任何 budget guard 仅允许在测试环境启用，生产恢复不能靠 env flag 跳过历史。

生产修复不得删除或 truncate 任何既存 Journal。若新 metadata preflight 失败，Supervisor 必须保留可用控制 socket、收口该节点到可解释的非 live 状态并记录错误。恢复可以安全重试，因为它不会修改原始 segment；用户仍可通过后续显式历史工具读取历史。

## 证据与备注

初始现场：`0f89e9b8-3347-48ae-a6f6-bd0c08f746b6` 是 V1 Journal，`lastRevision` 为 6,251,740、segmentCount 为 1,046，约 4.1 GB。2026-07-29 的 systemd journal 记录 Node V8 在约 4 GB heap abort；`Restart=on-failure` 随后重启 Supervisor。默认 systemd `KillMode=control-group` 会同时终止 unit cgroup 中的 PTY 子进程，因此旧 PTY 在该事故中确实死亡。

2026-07-30：本计划完成，原因是受控回归已先稳定复现全量 hydrate 失败，并在修复后通过分层单测、协议测试和三条真实 VS Code smoke。计划从 active 归档到 completed；按需、分页且有预算的完整 Journal 浏览保留在既有技术债中，避免将本轮启动期 metadata preflight 误写成历史浏览实现。

2026-08-01 修订：记录 review P1 的“Journal revision 领先 Host 屏幕”场景、原子投影决策与隔离 host-level smoke 证据，避免后续把 Journal 审计 revision 再次当成显示序列。
