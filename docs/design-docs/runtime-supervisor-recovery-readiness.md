---
title: Supervisor 重启恢复可用性与错误归因
decision_status: 已选定
validation_status: 已验证
domains:
  - VSCode 集成域
  - 执行编排域
  - 协作对象域
  - 项目状态域
architecture_layers:
  - 宿主集成层
  - 共享模型与编排层
  - 适配与基础设施层
  - 画布呈现层
related_specs:
  - docs/product-specs/runtime-persistence-modes.md
related_plans:
  - docs/exec-plans/completed/runtime-supervisor-reboot-recovery.md
  - docs/exec-plans/completed/runtime-supervisor-dead-pty-bounded-recovery.md
updated_at: 2026-07-30
---

# Supervisor 重启恢复可用性与错误归因

## 背景

`live-runtime` 的 Supervisor 运行在 Extension Host 之外。远端 Linux 主机、远端用户会话或设备重启会清除 legacy backend 的 Unix socket；重开 VS Code 后，旧进程是否仍存在是需要恢复和解释的事实。此前实现将 registry/journal 全部 hydrate 完成后才开始监听 socket，同时 client 只等待五秒。大 journal 恢复时，新建 Agent/Terminal 因此拿到 socket `ENOENT`，但 UI 又把所有 `ENOENT` 解释为 Codex 或 shell 缺失。

先监听、异步恢复解决了控制面不可用问题，但现场又确认了第二个边界：新 Supervisor 不能持有重启前的 PTY。一个 V1 Journal 的 625 万 event 在异步 worker 中被完整读取、解析和复制，令 Node V8 在约 4 GB heap abort；systemd 再启动时按默认 control group 清理该 unit 的 PTY 子进程。因此“已死亡 PTY 的完整 Journal 回放”既不能恢复 live runtime，也会危及恢复期间新建的会话。

## 问题定义

恢复旧历史、接受新会话和解释错误曾被错误地串在一起：旧历史恢复慢会让 runtime namespace 不可连接；底层 transport 错误会被伪装成用户配置错误。现有异步恢复已拆开前两者，但仍错误地把“从 Journal 重建历史画面”当成 Supervisor restart 的默认动作，造成无界内存占用，且会在 PTY 确认死亡后把 Agent resume 作为无用户动作的新进程启动。

## 目标

- Supervisor 重启后先提供可连接、可查询的控制面，再恢复旧 journal。
- 恢复旧历史期间仍可创建新的 Agent 和 Terminal。
- 用户能看到非阻塞的“正在恢复历史”状态；旧进程已经消失时只显示历史恢复。
- socket、readiness 和 PTY spawn 三种错误保持可区分且本地化准确。
- `systemd-user` 主路径生成可被真实 systemd 启动的 unit。
- PTY 已死亡时，用有界画面快照恢复 Window reload 的可见内容，不回放任意大小的 Journal。
- Agent 的 provider resume 只能由用户点击明确触发，不能作为 Supervisor restart 的后台副作用。

## 非目标

- 复活设备重启前已终止的 legacy PTY 进程。
- 通过删除旧 Journal 或只保留文字摘要来换取启动速度。
- 本轮交付无上限的完整 Journal 浏览器；完整历史的读取必须另行以分页和预算设计。
- 将 recovery phase 持久化为画布对象事实，或把它变成阻止新建节点的全局锁。

## 候选方案

同步恢复后监听会让旧状态最早可用，但会把全部新工作阻塞在最慢的 Journal 上，已被现场故障否决。增加固定或按容量扩大的连接超时只能延后失败，不能提供用户状态，也无法保证任意存储速度。先监听后后台全量回放同样不可接受：它让控制面可用，却仍让无界历史读入耗尽 Supervisor heap。

已选方案是先监听、公开 recovery phase、异步恢复，并把恢复对象明确拆分为 live attach、死亡 PTY 的有界画面快照和用户发起的 Agent Resume。它把“控制面可用”“旧 PTY 是否存活”“画板可显示的最后状态”“可选的新 provider 进程”分开，同时用 sessionId 合并规则防止异步 worker 覆盖新建会话。

## 正式方案

`extensions/vscode/dev-session-canvas/src/supervisor/runtimeSupervisorMain.ts` 中的 Supervisor 启动顺序固定为：创建所需目录和 socket，开始 `listen()`，让 `hello` 返回 `recovering` 与待恢复计数，随后在后台处理 registry。恢复完成时 phase 变成 `ready`；单个旧 session 恢复失败只使该旧 session 进入可解释的历史恢复/错误状态，不关闭 socket，也不拒绝新 session。

恢复工作不得默认调用 `TerminalSessionJournal.open()`、`getRecoveryCandidates()` 或任何读取所有 Journal segment 的 API。`extensions/vscode/dev-session-canvas/src/supervisor/terminalSessionJournal.ts` 必须提供只读 manifest 和文件大小的有界 metadata preflight；Supervisor 只用这些数据判断 Journal 是否存在、版本、revision、segment 数和容量，并记录诊断。原始 Journal segment 不删除、不 truncate；它们不是启动期状态来源。死亡 PTY 的画板显示由持久化 `serializedTerminalState`、最近输出和退出信息提供，这些是 Host/画板的有界显示快照，而不是声称具有后台完整输出权威的 live attach。

`extensions/vscode/dev-session-canvas/src/common/runtimeSupervisorProtocol.ts` 的 `RuntimeSupervisorHelloResult` 增加可选 recovery 字段。旧 Supervisor 不带该字段时，Host 不伪造 ready，而按既有 capability 降级处理。恢复状态仅属于当前 Supervisor namespace，不能写入 `CanvasPrototypeState` 的持久化对象图。

`CanvasPanelManager` 维护 backend + runtime storage path 维度的临时恢复状态，并用短时、非阻塞的 Host-to-Webview 状态投影给画布。旧节点维持 `reattaching` 或 `history-restored` 的真实语义；新建节点不因同 namespace 的旧 journal 恢复被禁用。UI 使用现有 VS Code status token 的紧凑状态呈现，不把全局恢复进度做成画布中心的大卡片。

`CanvasPanelManager` 在确认 Supervisor 已重启并返回 non-live snapshot 时，对 Terminal 使用 `history-restored`，保留已有 `serializedTerminalState`。对带有 provider session identity 的 Agent，使用 `resume-ready` 和现有 Resume 按钮，但绝不设置会被 Webview 自动执行的 `pendingLaunch: 'resume'`；只有用户点击 Resume 才调用 provider CLI 启动新的 resume PTY。没有明确 identity 的 Agent 不得猜测最近会话。正常 Host 或 Window reload 而 Supervisor/PTY 仍存活时，既有 `reattaching -> attached-live` 路径不受该规则影响。

对已持久化的 `reattaching` 节点，若 attach 返回 `sessionNotFound` 且该 client 明确处于 `recovering`，Host 保持 `reattaching`，不触发 Agent resume 或历史降级。相同 backend/storage namespace 发出 `ready` 时，Host 重新调度 attach；既有 operation token 保证早先 attach 的异步结果不能覆盖这次重试。若 `ready` 后 snapshot 已明确 `live: false`，这代表旧 Supervisor/PTY 已死亡，Host 必须按上述有界快照和显式 Resume 规则收口。client 只在 socket `close` 已清理失效引用后通知 Host 断线，避免对仍指向旧 socket 的 client 发起重连。

registry 恢复和新 session 创建必须共享同一提交协调。恢复 worker 在合并旧 session 前检查该 sessionId 是否已经由当前进程创建；不得覆盖新 session，也不得把新 session 的运行状态回写成历史态。Supervisor idle shutdown 只能在 recovery 已结束、没有 live session、没有连接且没有待恢复任务时启动。

错误按来源而非字符串 errno 分类：`RuntimeSupervisorClient` 的 Unix socket missing/refused 和 ready timeout 是 transport/readiness 错误；`runtimeSupervisorMain` 中 `createExecutionSessionProcess()` 的异常是 execution-spawn 错误，附带 file、cwd 与 errno；只有后一类的 `ENOENT` 才能由 Agent/Terminal 显示“命令或 shell 不存在”。其他错误由 `runtimeSupervisorLocalization.ts` 显示 Supervisor 恢复或连接失败说明。

`runtimeHostBackend.ts` 的 systemd unit 对 `WorkingDirectory=` 使用未加命令行引号的绝对路径；只有 `ExecStart=` 与 `Environment=` 使用相应 argument quoting。`legacy-detached` 仍是 fallback，但其易失 socket 不得被误标为 executable 缺失。

## 核心不变量

1. Supervisor socket 一旦监听，hello 必须在旧 journal 恢复期间可响应并表明 phase。
2. 恢复旧历史不能阻塞新 session create，也不能覆盖新 session。
3. 设备重启前不存在的原 PTY 只能降级为有界历史快照，不能伪造 live，也不能自动创建 replacement Agent 进程。
4. socket `ENOENT`、Supervisor ready timeout 与 PTY `ENOENT` 必须具有不同的结构化代码和用户文案。
5. recovery phase 是 runtime namespace 的临时事实，不进入画布持久化状态。
6. 任何 Journal 恢复失败或超预算都不得通过删除历史、关闭控制 socket、全量读入 event 或静默改写节点状态来掩盖。
7. recovery phase 为 `recovering` 的 `sessionNotFound` 表示尚未 hydrate，不得当作永远不存在；只有在 `ready` 后的实际快照或失败才能收口节点状态。

## 验证方法

新增 VS Code smoke 使用真实 Supervisor、fake Codex 与真实 PTY：持久化仍 live 的旧 Agent/Terminal，并在隔离 storage 合成超过恢复预算的 V1 Journal 后 `SIGKILL` Supervisor，并删除测试专属 runtime socket；Host test reload 后观察 `recovering`，在 gate 未释放时断言旧节点保持 `reattaching`，同时创建新 Agent/Terminal 并验证两者可 live、输出 marker；释放 gate 后验证 `ready`。修复前 smoke 必须以受控的 Journal 全量读取预算失败；修复后必须断言只做 metadata preflight、旧 Agent `resume-ready` 且未启动新 provider、旧节点保留 serialized snapshot。测试必须同时断言没有 command/shell-not-found 文案。

unit/fixture 层验证 systemd unit 的 `WorkingDirectory` 不含引号，并让 fake systemd 以真实 systemd 的目录 directive 规则拒绝引号路径。真实 Linux/Remote SSH 手动验证仍用于证明 production systemd 的 service lifecycle。

## 验证证据

2026-07-28 已完成 scoped 自动化验证：`npm run typecheck`、`npm run test:runtime-supervisor-protocol`、`npm run test:runtime-host-backend`、`npm run test:terminal-session-journal` 与 `npm run test:ui-copy-localization` 均通过；`runtime-supervisor-reboot-recovery` smoke 使用真实 Supervisor、fake Codex 和真实 PTY，验证 `SIGKILL +` 隔离 socket 删除 + Host reload 后，`hello` 在 recovery gate 持有时返回 `recovering`，旧 live Terminal 保持 `reattaching`，新的 Agent 与 Terminal 均可进入 live 并输出 marker；释放 gate 后返回 `ready`，Host 重试 attach 并将 recovered `live: false` snapshot 正确收口为历史态，同时 registry 保留新 live session。`systemd-user-real-reopen` 与 `systemd-fallback-real-reopen` smoke 也均通过。

2026-07-30 的现场 OOM 证明上述验证不足以覆盖死亡 PTY 的超大 V1 Journal：此前 smoke 的 recovery gate 只验证 Host 状态机时序，并没有验证 Supervisor 不会读入全部历史。新增有界恢复 smoke 已先在旧实现上稳定得到 `recovery.failureCount: 1`，随后在修复后通过：`npm run typecheck`、`npm run test:runtime-supervisor-protocol`、`npm run test:terminal-session-journal`、`npm run test:ui-copy-localization`、`runtime-supervisor-reboot-recovery`、`systemd-user-real-reopen` 与 `systemd-fallback-real-reopen` smoke 全部通过。前者还断言旧 Agent 在显式 Resume 前不启动新的 provider、旧节点显示持久化快照且新节点可 live；因此当前自动化范围恢复为“已验证”。

此状态只确认本设计所定义的可重复 Host 级故障模型及定向自动化；真实 Linux / Remote SSH 的长断开人工验收仍沿用既有技术债，不因此被宣称完成。
