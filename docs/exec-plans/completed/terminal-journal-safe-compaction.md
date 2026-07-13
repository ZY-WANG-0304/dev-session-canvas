# 实现 Terminal journal 安全 compact 与双代回退

本 `ExecPlan` 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘`。本计划遵循仓库根目录的 `docs/PLANS.md`。

## 目标与全局图景

本计划实现最初六步内容链路方案的第 4、5、6 步。PR #255 已完成 Supervisor 唯一 authority、完整分段 journal 和“不删除旧 journal”的 checkpoint cache；本阶段先证明某个 checkpoint 是否真的能代替 journal prefix，再安全回收已覆盖的完整 segment，并始终保留 current 加 previous 或完整 genesis 的回退路径。

用户可观察结果是：长期运行的 `live-runtime` Agent / Terminal 在产生至少两份合格 checkpoint 后可以减少旧 journal segment；Reload Window、Host 离线输出、窗口重开和 current checkpoint 损坏后仍恢复到相同 terminal revision，内容无缺失、重复或乱序。真实 TUI 状态无法证明等价时只会暂缓 compact并记录原因，不会为了容量删除内容。

## 进度

- [x] (2026-07-12 21:00 +0800) 从 `origin/main@f6bbd304` 创建主题分支 `terminal-journal-safe-compaction`。
- [x] (2026-07-12 21:20 +0800) 从原始会话恢复六步编号，确认本阶段范围是 checkpoint 等价验证、安全 compact 与上一代回退。
- [x] (2026-07-12 21:35 +0800) 建立 split CSI 与 split surrogate 反例，证明 `xterm-serialize-v1` revision 相等不代表可删除 prefix。
- [x] (2026-07-12 23:40 +0800) 用户确认采用保守 eligibility + codec 无关 generation；保留原草案的 fsync/rename、双代回退和故障注入，不先实现完整 xterm 私有状态 codec。
- [x] (2026-07-13 00:20 +0800) 实现 tracker 安全切点、source/restored semantic fingerprint、共同 suffix 回归、operation-error poisoning、OSC 8/color 拒绝和 256 KiB eligibility 上限；unsafe cut 不替换可信 checkpoint。
- [x] (2026-07-13 00:35 +0800) 实现兼容 v1 的 immutable checkpoint envelope、manifest v2 current/previous、checksum anchor、segment fsync、完整链验证、原子晋升和完整 segment compact。
- [x] (2026-07-13 00:50 +0800) 接入 Supervisor snapshot/recovery、deferred attach 与 applied ACK retention floor、metadata-only registry、finalization/delete 顺序和 fail-closed journal cleanup。
- [x] (2026-07-13 01:20 +0800) 修复复核发现的 post-compaction fallback 破坏与 cursor-blink eligibility 假阳性，并新增三代损坏、profile 迁移继续 append 和 DECSET 12 回归。
- [x] (2026-07-13 01:52 +0800) 完成真实验证：底层故障注入、协议、六个 Webview 定向用例、10-Agent 容量、typecheck、build、按 metadata-only registry 契约修正后的 `trusted`，以及两阶段 `real-reopen` 均通过。
- [x] (2026-07-13 01:52 +0800) 同步正式设计、索引和技术债，并把本计划移入 `completed`；本阶段 compact 验收通过，但正式设计的总体状态以后续主线 final-state 风险证据为准。
- [x] (2026-07-13 18:10 +0800) rebase 到 `origin/main@51dd07e`，保留 PR #258 新旧 Supervisor 并行 drain 语义；主线新增的 90000 行间歇性短读继续阻止总体“已验证”，Node 25 final-state 测试则由新的 checkpoint+journal finalization 语义收口并连续三次通过。
- [x] (2026-07-13 22:24 +0800) 创建 PR 前再次 rebase 到 `origin/main@494130b`；六组终端核心测试、typecheck、build、`legacy-supervisor-upgrade`、严格 `trusted` 与两阶段 `real-reopen` 均在最终基线上通过。

## 意外与发现

- 观察：现有 ANSI/OSC/CJK/emoji 回归没有验证 checkpoint 切在分片中间。
  证据：`tests/playwright/webview-harness.spec.mjs` 的 fixture 固定 checkpoint revision 1，split events 全部位于 revision 2–20 的 suffix。

- 观察：`SerializeAddon.serialize()` 完成不代表 parser 已位于可恢复边界。
  证据：revision C 以 `ESC[31` 结束时 checkpoint data 为空；完整重放 C+1 的 `mRED` 得到红色 `RED`，checkpoint+suffix 得到默认色字面量 `mRED`。high/low surrogate 中间切点同样不等价。

- 观察：只比较 candidate 与 hydrate 后再次 serialize 的字符串仍可能产生假阳性。
  证据：有损 projection 可以在第一次 serialize 时已经丢掉 OSC 8 URI、扩展 cell 属性或 hidden mode，第二次 serialize 仍会得到相同的有损字符串。因此 eligibility 必须直接比较 source/restored terminal语义，并把未知结构当作拒绝。

- 观察：v1 journal scanner 固定从 revision 1 和 genesis checksum 开始，checkpoint 又只存在于 registry；直接删除 segment 无法形成可恢复格式。
  证据：`terminalSessionJournal.ts` 的 manifest 没有 retained base revision/checksum或 checkpoint reference，`scanTerminalJournalSegments()` 以 revision 1 初始化。

- 观察：`CSI ? 12 h` 会修改 xterm `rawOptions.cursorBlink`，但 addon-serialize 不保存它；如果 fingerprint 漏掉该字段，空 checkpoint 会被误判 eligible。
  证据：`\u001b[?12h\u001b[0m` 的 source `cursorBlink=true`，hydrate 后为默认 `false`。`fingerprintTerminalOptions()` 已加入精确比较并补回归。

- 观察：genesis prefix 已删除后，旧 current 损坏不能简单执行 generation reset；否则会同时遗失仍可用的 old previous，甚至写出 `previous` 为空但 `retainedStartRevision > 1` 的无效 manifest。
  证据：C4/C8 compact 到 retained start 5，破坏 C8 后晋升 C12；修复前 cleanup 会删除 C4。现在按 old current -> old previous 选 fallback，C12 再损坏时仍可由 C4 + revisions 5..12 恢复。

- 观察：journal-backed registry 不再保存 terminal projection 后，trusted smoke 的旧前置断言永远无法成立，但 artifact 中 authority/revision 与 marker output 完整。
  证据：失败位于 `verifyLiveRuntimeReloadPreservesUpdatedTerminalScrollbackHistory()` 的 reload 前 registry 断言；测试已改为要求 `serializedTerminalState` / `terminalStream` 缺席，再由 reload 后首尾 marker 证明 journal 恢复。

- 观察：空字符串是合法的 revision 0 genesis checkpoint，不能据此判定 checkpoint 缺失。
  证据：`real-reopen` 首次复跑时，离线期间结束的 Terminal 已有空 genesis checkpoint 和四条完整 journal events，但测试 helper 因 `!serializedState.data` 返回空投影而超时；改为检查 data 类型并继续拼接 events 后，两阶段窗口重开 smoke 通过。

- 观察：本分支验证完成后，主线发布准备又第二次观察到 90000 行 completed stream 尾部短读，并记录 Node 25 final-state 协议失败；两者在 rebase 后的结论不同。
  证据：`origin/main@51dd07e` 记录 packaged-payload smoke 停在第 89960 行，这项风险仍未定位。Node 25 的失败则来自 exit 后等待多 MB semantic checkpoint；本分支改为最后 eligible checkpoint 加完整 suffix 后，Node 25.6.0 的协议测试连续三次通过。

## 决策记录

- 决策：本阶段不先实现绑定 xterm 私有对象图的 `xterm-checkpoint-v2`。
  理由：完整字段清单仍可能遗漏未来语义，维护成本接近 xterm snapshot fork；本项目的第一优先级是无法证明时保留内容。
  日期/作者：2026-07-12 / 用户确认，Codex 记录

- 决策：`xterm-serialize-v1` 继续作为现有 wire projection，只有通过 safe-boundary 和 semantic fingerprint 的实例才取得 compact 资格。
  理由：资格属于某份 checkpoint及其 producer profile，不由 format 名称或 revision 数字自动授予。未知 private state、active OSC 8 或版本结构变化都拒绝 compact。
  日期/作者：2026-07-12 / Codex

- 决策：generation 磁盘协议只记录 codec/profile/checksum、current/previous、retention anchor和 segments，不依赖具体 checkpoint codec。
  理由：以后若真实拒绝证据要求小范围 v2 codec，可以在不重写磁盘事务和恢复逻辑的情况下加入。
  日期/作者：2026-07-12 / Codex

- 决策：第一份合格 checkpoint 晋升不删除 prefix；第二份及以后最多删除 previous 已覆盖、且不越过 attach/ACK retention floor 的完整 segment。
  理由：current 损坏时 previous 必须能连续重放到 journal head，首次迁移还需要 genesis full journal兜底。
  日期/作者：2026-07-12 / Codex

- 决策：manifest 原子切换先于文件删除；无法理解新 manifest 的旧 reader自然 fail closed，不额外写 migration marker主动破坏旧版本。
  理由：任意 crash point最多留下 orphan；不需要让迁移本身成为额外恢复状态机。
  日期/作者：2026-07-12 / Codex

- 决策：deferred attach 和已有 applied ACK 只能收紧 retention floor；ACK 不授予 checkpoint 资格，也不推进 authority revision。
  理由：消费者水位可以证明仍需保留更多 replay event，不能证明 terminal state codec完整。
  日期/作者：2026-07-12 / Codex

- 决策：eligibility 绑定精确 producer profile，并把 serialized data 验证上限设为 256 KiB；超过上限、未知结构、OSC 8、palette/default-color side effect 或 operation error 都保留完整 journal。
  理由：source/restored 双实例验证会占用主进程 CPU；本阶段优先保证输入响应和无损，不能用磁盘上限反向强迫一个未经证明的 checkpoint。
  日期/作者：2026-07-13 / Codex

- 决策：journal-backed registry 不持久化 `serializedTerminalState` 或 `terminalStream`，只保存 authority lookup、生命周期、revision、geometry 与有界 advisory output。
  理由：每 120ms 复制完整 suffix 会形成 O(n²) 写放大；registry 和 Host snapshot 也都不能成为跨 Host 恢复权威。
  日期/作者：2026-07-13 / Codex

- 决策：晋升 fallback 按 old current -> old previous 验证。genesis 已删除且两者都不可用时返回 `no-usable-fallback`，保持旧 manifest并继续 append，不把容量问题升级为会话失败。
  理由：generation reset 只有在完整 genesis journal仍存在时才安全；prefix 已删除后，宁可永久停止 compact也不能失去最后一条恢复链。
  日期/作者：2026-07-13 / Codex

- 决策：恢复测试把空 serialized data 视为合法 checkpoint，并独立校验其后的完整 journal events。
  理由：genesis 状态本来就可以为空；测试若要求 checkpoint 非空，会把正确的 checkpoint+journal 恢复误报成失败，也会诱导实现生成没有语义价值的 fresh state。
  日期/作者：2026-07-13 / Codex

- 决策：rebase 后保留主线的 `legacy-interactive` 并行 drain 与总体“验证中”状态，同时叠加安全 compact，不回退成旧会话只读，也不把 compact 定向通过等同于 final stream 全链路已验证。
  理由：PR #258 是本分支基线之后已经合入的产品语义；90000 行短读已出现第二个样本，属于更新且更强的风险证据。
  日期/作者：2026-07-13 / Codex

## 结果与复盘

实现已经覆盖 eligibility、manifest v2、原子 compact、current/previous/genesis 恢复、Supervisor 接入和 metadata-only registry，并在 rebase 后与 PR #258 的新旧 Supervisor 并行 drain 共存。底层故障注入、协议、六个 Webview 定向用例、typecheck、build、10-Agent 容量、`trusted`、两阶段 `real-reopen` 与 legacy Supervisor upgrade smoke 均通过；复核又修复了 cursor-blink 假阳性、post-compaction fallback 破坏和空 genesis checkpoint 的测试误判。无法证明 eligibility、超过 256 KiB 或 producer profile 无兼容 fallback 时，系统按设计停止 compact并继续无损增长 journal。第 4–6 步目标已经完成，Node 25 final-state 时序问题也由 suffix finalization 收口；但 completed stream 的 90000 行间歇性短读仍未定位，因此正式设计总体保持“验证中”，相关风险继续由技术债追踪。

## 上下文与定向

`extensions/vscode/dev-session-canvas/src/supervisor/runtimeSupervisorMain.ts` 中的 Runtime Supervisor 持有跨 Host 生命周期的 PTY，并通过 `terminalOperationChain` 串行 output、resize、scrollback、snapshot、finalize 和 delete。`extensions/vscode/dev-session-canvas/src/supervisor/terminalSessionJournal.ts` 同时读取 v1 完整 journal 和 v2 generation manifest；v2 使用 immutable checkpoint envelope、retained checksum anchor、current/previous reference 与连续 NDJSON suffix。

`extensions/vscode/dev-session-canvas/src/common/serializedTerminalState.ts` 用 `@xterm/headless` 和 `@xterm/addon-serialize` 维护 projection。eligibility probe集中读取同版本 xterm状态；字段不存在或无法比较时返回拒绝，不把 private结构传播到 Host/Webview wire protocol。当前 exact profile 绑定 xterm headless 6.0.0、addon-serialize 0.14.0 和 fingerprint schema。

Host/Webview 仍只消费 `TerminalStreamCheckpoint + events`。磁盘 generation属于 Supervisor内部恢复机制；current checkpoint不可用时，Supervisor选择 previous/genesis并重放到最新 revision，最终仍发布同一 terminal stream协议。

## 里程碑

### 里程碑一：可证明的 checkpoint eligibility

先把 split CSI/surrogate 固定成失败测试，再增加 tracker API。结束时，不安全 revision不会替换 revision 0/上一可信 checkpoint；普通文本、完整 ANSI和可由现有 codec保真的状态可以通过；active OSC 8或未知内部结构保守拒绝。验证比较 cell、cursor、buffer与mode，并在共同 suffix后再次比较。

### 里程碑二：codec 无关双代 generation

升级 journal manifest并持久化 immutable checkpoint文件。通过两次晋升证明第一次不删，第二次只删除安全上界内的完整 segment；current checkpoint损坏时 previous重放到最新。checkpoint write、manifest rename和cleanup各故障点重开后只得到完整旧链或完整新链。

### 里程碑三：完整生命周期接入

让 create、fresh snapshot、registry recovery、finalization和delete使用可信 generation；v1 journal无损打开。trusted、real-reopen、Host离线结束与10-Agent benchmark证明内容、恢复和输入响应不回退，并记录 compact命中/拒绝原因与磁盘变化。

## 工作计划

`serializedTerminalState.ts` 与 tracker测试已经新增 `flushValidatedCheckpoint()`。该 API等待 write chain，检查 parser/decoder clean，并 hydrate独立 headless terminal比较 source/restored fingerprint；验证结果按 terminal version 缓存。现有 `flush()` 保持兼容，Supervisor只有在新 API成功时更新 authority checkpoint，失败时保留旧 checkpoint和完整 suffix。

`terminalSessionJournal.ts` 已继续读取 v1，并新增 v2 manifest/checkpoint reference、非 revision 1 起点 checksum anchor、durable atomic file helper、checkpoint commit、compact和 recovery candidates。所有 mutation串在 journal write chain；checkpoint eligibility由 caller负责，journal不猜测 codec语义。commit 会先 fsync/全链验证，并在 fallback 无法证明时不提交但继续允许 append。

`runtimeSupervisorMain.ts` 已接入安全候选提交；retention floor取 previous checkpoint、deferred pin和同 authority现有 ACK的最小值；recovery按 current、previous、genesis逐候选 hydrate并重放。finalize关闭 admission后不启动新 compact，已入队操作继续严格排序。journal-backed registry不内联 terminal projection，恢复忽略 registry checkpoint/raw tail。

## 具体步骤

在仓库根目录运行：

    npm run test:serialized-terminal-state-tracker
    npm run test:terminal-session-journal
    npm run test:runtime-supervisor-protocol
    npm run typecheck
    npm run build

真实生命周期运行：

    DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=trusted node scripts/smoke/run-vscode-smoke.mjs
    DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=real-reopen node scripts/smoke/run-vscode-smoke.mjs
    npm run benchmark:agent-terminal-io

Webview定向覆盖 checkpoint+journal hydrate、split controls、gap fail closed和批量 replay。完整 `npm test` 与 `npm run test:webview` 当前仍受仓库既有 Marketplace socket/locale、截图和 timeout 基线阻断，已由 `docs/exec-plans/tech-debt-tracker.md` 独立追踪；本计划不把这些与终端改动无关且可在 `origin/main` 复现的失败写成未完成验收，也不在本分支顺手修改对应 fixture。

## 验证与验收

完成必须同时满足：unsafe cut不晋升且旧 checkpoint+suffix完整；安全候选在切点和共同 suffix后与 full replay fingerprint一致；两代晋升后磁盘 prefix确实减少；current损坏时 previous恢复到 latest；两代不可用但 full genesis在时仍可重建，否则 fail closed；deferred/ACK水位不越界删除；v1重开不丢事件；Reload/real-reopen/Host离线输出逐 revision无缺失重复乱序；10-Agent输入门槛不回退。

## 幂等性与恢复

测试只在临时 storageDir损坏文件。checkpoint与manifest临时文件名唯一；manifest提交前的候选和提交后的旧文件都可作为 orphan清理。任何失败都保留旧 manifest引用的数据，不手工删除真实用户 journal。实现命令可重复运行。

## 证据与备注

最小 split CSI 反例：

    revision C:      "\x1b[31"
    checkpoint v1:  ""
    revision C+1:   "mRED\x1b[0m"
    full replay:    text=RED, fg=red
    v1 + suffix:    text=mRED, fg=default

第二个反例是 `\u001b[?12h\u001b[0m`：source 的 `cursorBlink=true`，addon-serialize hydrate 后为 `false`。把 `cursorBlink` 纳入 options fingerprint 后，该 checkpoint 返回 `state-mismatch`。

当前验证记录：

    npm run test:serialized-terminal-state-tracker  # passed
    npm run test:terminal-session-journal           # passed
    npm run test:runtime-supervisor-protocol        # passed
    npm run typecheck                               # passed
    npm run build                                   # passed
    npm run benchmark:agent-terminal-io             # passed

rebase 后最近一次 Supervisor 10-Agent 样本：input RPC 10.18ms，echo 20.46ms，registry 65,295 bytes。最近一次 Webview 样本：ACK 46.8ms，priority echo 159.3ms，main-thread lag 0ms。六个定向 Webview checkpoint/journal 用例通过。

首次 `trusted` 运行退出码为 1；artifact 定位为 reload 前仍要求 registry 内联 serialized state 的旧断言，不是内容缺失。失败状态包含 authority/revision 和 `DSC_LRSP-001..220`，Webview 为 healthy/attached-live。断言同步为 metadata-only registry 契约后，`trusted` 完整通过。

独立 `real-reopen` 首次 verify 因测试 helper 拒绝空 genesis checkpoint 而超时；最终 snapshot 中 live Agent/Terminal 已 attached-live 且包含离线 marker，completed Terminal 的完整 events 也包含 final marker。helper 改为接受空 checkpoint data 后，setup/verify 两阶段退出码均为 0，真实窗口重开 smoke 通过。

rebase 到 `origin/main@51dd07e` 后，Node 25.6.0 的 Supervisor 协议连续三次通过，`trusted`、`real-reopen` 与 `legacy-supervisor-upgrade` smoke 均以 code 0 完成；创建 PR 前又 rebase 到 `origin/main@494130b`，并重新通过六组核心测试、typecheck、build 与上述三组 smoke。其中 `trusted` 继续保留严格 90000 行断言。单次严格通过不能关闭主线已经记录的两次间歇性短读，因此该风险仍留在正式设计和技术债中。

## 接口与依赖

计划结束时至少提供同等职责的接口：

    SerializedTerminalStateTracker.flushValidatedCheckpoint()
    TerminalSessionJournal.commitCheckpoint(checkpoint, options)
    TerminalSessionJournal.getRecoveryCandidates()
    TerminalSessionJournal.getRetainedStartRevision()

`flushValidatedCheckpoint()` 返回 state或明确拒绝 reason；journal只持久化 caller已验证的 checkpoint。generation manifest保存 `serializedState.format` 作为当前 codec id，并为未来 codec保留 profile字段，但本阶段不新增网络、原生依赖或完整 xterm私有快照格式。

计划变更说明：2026-07-12 创建；同日根据用户判断从“先实现完整 xterm-checkpoint-v2”收敛为“保守 eligibility + codec 无关 generation”，因为无法证明时保留 journal比维护一套可能遗漏状态的私有 snapshot codec更符合无损目标。2026-07-13 根据实现与复核更新全部活文档章节，补入 exact profile、256 KiB上限、metadata-only registry、segment fsync/full verify、old previous保留、`no-usable-fallback`继续 append、cursor-blink反例和当前验证证据；同日修正 `trusted` 的旧 registry 契约与 `real-reopen` 对空 genesis checkpoint 的误判并归档本计划。随后 rebase 到 `origin/main@51dd07e`，合并 PR #258 的并行 drain 语义与发布阶段新增风险证据；Node 25 final-state 时序问题随 suffix finalization 收口，90000 行间歇性短读继续使正式设计总体保持“验证中”。创建 PR 前再次 rebase 到 `origin/main@494130b` 并复跑核心测试和三组 smoke，未引入新的冲突或验证结论变化。
