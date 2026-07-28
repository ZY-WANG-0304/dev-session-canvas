# Supervisor 重启恢复可用性与错误归因

本 `ExecPlan` 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘` 这几个章节。

本文遵循 `docs/PLANS.md`。它覆盖一次跨 Extension Host、Runtime Supervisor、Webview 和 VS Code smoke 的可靠性改造；所有实现和验证结论都必须回写本文。

## 目标与全局图景

用户在远端 Linux 或本地 Linux 会话重启后重新打开画布时，旧 Supervisor 的 Unix socket 可能随 `XDG_RUNTIME_DIR` 消失。完成本计划后，系统不会把该连接错误误报成“找不到 Codex”或“找不到 bash”。Supervisor 必须先接受连接并报告“正在恢复历史”，再异步恢复旧 journal；用户在这段时间创建新的 Agent 或 Terminal 仍然可以启动。用户能在画布看到非阻塞的恢复中状态，旧会话则继续按实际结果显示重连或历史恢复。

可观察验证是：在隔离的 VS Code smoke runtime 中突然杀死 Supervisor 并删除其临时 socket、模拟 Host reload 后，在旧 journal 恢复尚未完成时创建一个 fake Codex Agent 和一个 Terminal。两者都进入 live 并输出 marker；诊断记录恢复开始和结束，且没有 command/shell-not-found 文案。

## 进度

- [x] (2026-07-28 09:53 UTC) 确认现场根因：`systemd-user` unit 的 `WorkingDirectory` 被错误加引号；legacy fallback 在 5 秒 readiness 窗口内未监听 socket；用户可见的 `ENOENT` 被错误映射为 command/shell 缺失。
- [x] (2026-07-28 09:53 UTC) 从最新 `origin/main` 建立 `runtime-supervisor-reboot-recovery` 主题分支，并建立本 ExecPlan 与正式设计记录。
- [x] (2026-07-28 10:28 UTC) 建立“Supervisor 崩溃 + 易失 socket 消失 + Host reload”的隔离 smoke fixture，并写出恢复中创建新会话的验收断言。
- [x] (2026-07-28 10:28 UTC) 将 Supervisor transport、readiness timeout 与 PTY spawn 的错误来源拆分；Agent/Terminal 不再把 transport `ENOENT` 显示为外部可执行文件缺失。
- [x] (2026-07-28 10:28 UTC) 修复 systemd unit 的 `WorkingDirectory` 序列化，并扩展 fake systemd fixture 检查真实 systemd 的目录 directive 语义。
- [x] (2026-07-28 10:28 UTC) 让 Supervisor 先监听并返回 recovery phase，再异步恢复 registry/journal；恢复任务不会覆盖恢复期间创建的新 session。
- [x] (2026-07-28 10:28 UTC) 将 recovery phase 投影到 Host/Webview 的非阻塞状态，完成分层自动化验证，并同步本计划与设计文档。现有“真实 Linux / Remote SSH 长断开”技术债保持原有登记，不因本轮模拟回归被误写为已验证。
- [x] (2026-07-28 12:07 UTC) 处理 PR #272 的 P1：恢复中 `sessionNotFound` 不得提前把 `reattaching` 节点降级；收到同 namespace 的 `ready` 后必须受 operation token 保护地重试 attach，并用旧 live Terminal 的 recovery-gate smoke 覆盖。

## 意外与发现

- 观察：现场所有新建 Agent/Terminal 从 start request 到错误约为 5.2--5.8 秒。
  证据：`RuntimeSupervisorClient.waitForSupervisorReady()` 的 deadline 固定为 5 秒，见 `extensions/vscode/dev-session-canvas/src/panel/runtimeSupervisorClient.ts`。

- 观察：现场当前 generation registry 仅有 7 个会话，但对应 1,135 个 journal 文件、约 4.4 GB 数据；Supervisor 当前在 `loadRegistry()` 后才 `listen()`，并逐个 await 恢复 session。
  证据：`runtimeSupervisorMain.ts` 的 `start()` 先 `await this.loadRegistry()` 再 `await this.listen()`；现场主机诊断目录记录了上述容量。

- 观察：`systemd --user` 明确拒绝生成的 unit：`WorkingDirectory= path is not absolute: \"/...\"`。
  证据：生成器把 `quoteSystemdExecArg()` 复用于 `WorkingDirectory=`；该 helper 只适用于 `ExecStart=` 的参数列表。

- 观察：已退出的旧 Terminal 仍可提供 durable journal，但不会触发 Host 的 reattach，从而也不会自行启动替换 Supervisor。
  证据：首轮 smoke 在 `simulateRuntimeReload` 后等待 socket 的 `recovering` phase 超时；将第一个新 Agent 的真实启动作为 Host 侧重连触发后，复跑在 gate 持有期间观察到 `recovering`，并通过全部 marker 与 registry 断言。

- 观察：过长的 smoke `XDG_RUNTIME_DIR` 会使 Unix socket 解析回退到共享 `/tmp` 路径。
  证据：新增删除范围断言首次拒绝 `/tmp/<digest>.sock`；将该场景的 runtime 目录改为带 runner PID 的短路径后，socket 回到隔离 `XDG_RUNTIME_DIR`，断言与 smoke 均通过。

- 观察：Host 在 Supervisor 已监听但 journal 尚未 hydrate 时，仍会立即对 `reattaching` 节点执行 attach；该请求得到 `sessionNotFound` 后会直接落入历史恢复，且 `ready` 事件未安排二次 attach。
  证据：PR #272 review 在 `restoreLiveRuntimeSessions()`、`attachPersistedRuntimeSession()` 与 `handleRuntimeSupervisorRecoveryState()` 的直接控制流中确认此路径；原 smoke 让旧 Terminal 在故障注入前退出，未覆盖该状态窗口。

## 决策记录

- 决策：按用户指定的 `4 -> 3 -> 1 -> 2` 顺序推进，即先建立重启等价 smoke 契约与故障注入，再做错误归因、systemd 修复、最后做异步恢复。
  理由：先固定用户可见回归和错误边界，避免后台恢复重构只在单元测试中自洽。
  日期/作者：2026-07-28 / Codex 与用户

- 决策：不用真实设备重启；用 `SIGKILL`、删除测试专属 runtime socket、Host 测试态 reload 共同模拟它。
  理由：这三件事覆盖本故障的实际边界，同时能在 CI 无权限、无物理设备重启的环境重复执行。
  日期/作者：2026-07-28 / Codex 与用户

- 决策：Supervisor 先 listen/hello，再异步恢复历史 journal；`hello` 公开 `recovering | ready` phase 与待恢复数量。
  理由：新的会话创建不依赖旧历史 hydrate；将可用性与历史恢复拆开可避免大 journal 让整个 runtime namespace 不可用。
  日期/作者：2026-07-28 / Codex 与用户

- 决策：恢复中的旧 session 只能被查询为恢复中或历史恢复，不能伪造仍在运行；恢复期间新建 session 可以正常创建并成为 live。
  理由：设备重启已经终止 legacy Supervisor 原有 PTY。正确目标是解释旧状态、保持新工作可用，而非伪造旧进程连续性。
  日期/作者：2026-07-28 / Codex 与用户

- 决策：当 attach 因 `sessionNotFound` 失败且已连接 Supervisor 明确处于 `recovering` 时，Host 保持节点 `reattaching`，不执行 Agent resume 或历史降级；同 namespace 收到 `ready` 后重新调度 attach。若恢复后的 snapshot 明确 `live: false`，才按历史恢复语义收口。
  理由：该错误在恢复窗口表示“尚未 hydrate”，而不是“永远不存在”。同时不把 Supervisor 已被杀死后的历史 snapshot 伪装成真实 live PTY。
  日期/作者：2026-07-28 / Codex 与 PR #272 review

## 结果与复盘

PR #272 的 P1 已完成。旧结论中的“故障注入前已退出 Terminal”不能证明 Host 在 recovery gate 期间对原本 live 的 `reattaching` 节点不会提前降级；smoke 现保留旧 Terminal live，恢复 gate 持有时断言它保持 `reattaching`，释放 gate 后断言它消费 recovered snapshot 并收口为 `snapshot-only` 的历史态。该 follow-up 只处理这个状态机时序，不改变“被杀 Supervisor 的旧 PTY 不能伪造为 live”的正式边界。

Host 仅在已连接 Supervisor 明确报告 `recovering` 时延迟 `sessionNotFound` 的失败处理。`ready` 事件会重新调度 attach；每次 attach 都使用既有 operation token，因此先前的异步结果不会覆盖新调度的结果。Runtime Supervisor client 也只会在 socket `close` 清理旧引用后通知 Host 重连，避免对仍持有失效 socket 的 client 提前请求 attach。

系统现在把 socket 缺失/refused、Supervisor startup timeout、协议错误和 PTY spawn 错误编码为不同来源；只有明确的 `execution-spawn` `ENOENT` 才进入 Codex/shell 缺失文案。systemd unit 的 `WorkingDirectory=` 使用验证后的无引号绝对路径，`ExecStart=`/`Environment=` 仍使用命令参数引号。

验证记录（均在仓库根目录运行）：

    npm run typecheck                                      # 通过
    npm run test:runtime-supervisor-protocol                # 通过（含错误来源、异步恢复与 10-Agent 基准）
    npm run test:runtime-host-backend                       # 通过（含 WorkingDirectory directive 语义）
    npm run test:terminal-session-journal                   # 通过
    npm run test:ui-copy-localization                       # 通过
    DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=runtime-supervisor-reboot-recovery npm run test:smoke
                                                            # 通过
    DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=systemd-user-real-reopen npm run test:smoke
                                                            # 通过
    DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=systemd-fallback-real-reopen npm run test:smoke
                                                            # 通过
    git diff --check                                        # 通过

本计划没有引入新的待跟踪技术债。真实 Linux / Remote SSH 长断开与真实物理设备重启的生命周期覆盖仍受既有技术债条目约束；它们不是这条隔离、可重复的 Host 级回归的替代品。

## 上下文与定向

`extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts` 是 Extension Host 的执行编排中心。它通过 `RuntimeSupervisorClient` 请求由 `RuntimeHostBackend` 启动的独立 Supervisor。`systemd-user` 是 Linux/Remote SSH 的强保证主路径；它失败后才使用 `legacy-detached`，后者的 socket 位于可被重启清空的 runtime 目录。

`extensions/vscode/dev-session-canvas/src/supervisor/runtimeSupervisorMain.ts` 是长于 Host 生命周期的进程入口。它当前先读取并恢复 registry/journal，之后才监听 Unix socket。这使 Host 在恢复慢时只能得到 `connect ENOENT`。`extensions/vscode/dev-session-canvas/src/common/runtimeSupervisorProtocol.ts` 是 Host 与 Supervisor 的 JSON line 协议；它需要增加 recovery phase 和有来源的错误表达。

当前错误文案在 `CanvasPanelManager.ts` 中按原始 `error.code === 'ENOENT'` 直接归因给 Codex 或 shell。该判断无法区分 `net.createConnection()` 的 socket 缺失与 `node-pty.spawn()` 的可执行文件缺失。本计划要求只有明确来自 PTY spawn 的错误才可使用 command/shell 文案。

`tests/vscode-smoke/storage-slot-recovery-tests.cjs` 已经展示如何在 VS Code Extension Host 测试中启动、停止和查询真实 Supervisor。`scripts/smoke/run-vscode-smoke.mjs` 已经为 systemd-user 和 systemd fallback 建立隔离 runtime；`tests/vscode-smoke/fixtures/fake-systemd/systemctl.cjs` 是 CI 的 systemctl substitute。

## 工作计划

第一个里程碑先增加测试基础设施，而不重启机器。新增 smoke 场景必须得到测试专属的 `XDG_RUNTIME_DIR` 和 storage；它启动真实 Supervisor、持久化 Agent/Terminal journal、通过 hello 返回的 pid 发送 `SIGKILL`，并只删除该隔离目录中的 socket。测试随后调用 `devSessionCanvas.__test.simulateRuntimeReload`，使 CanvasPanelManager 从持久化对象图重新建立 client。所有 cleanup 都必须验证目标路径位于 smoke runtime 根目录。

为了稳定证明“恢复中”，Supervisor 增加只在测试环境启用的 recovery gate。它在 socket 已监听、recovery phase 已变为 `recovering` 后暂停历史 journal hydrate，直到测试释放 gate。这个 gate 不以真实 4.4 GB 数据制造慢测；生产实现不读取该变量。Smoke 仍会创建实际 PTY、写入实际 marker 并核对 Host state、Webview state 和诊断。

第二个里程碑定义错误源。transport 连接失败、Supervisor readiness timeout、Supervisor protocol 错误和 execution PTY spawn 失败应成为不同的 `RuntimeSupervisorProtocolError` 或等价结构化错误。Supervisor 需在 createSession 出错时封装 PTY file、cwd 和 errno；Host 仅对这个明确来源且 errno 为 `ENOENT` 的情形提示 command/shell。每种错误都必须记录 machine-readable diagnostic kind 和用户可理解的本地化文案。

第三个里程碑修复 systemd unit。`renderSystemdUserUnit()` 的 `WorkingDirectory=` 使用原始的已验证绝对目录；只 `ExecStart=` 与 `Environment=` 使用 systemd command argument quoting。fake systemd fixture 必须拒绝带双引号的 `WorkingDirectory`，以复现真实 systemd 的 parser，而不是继续把引号悄悄剥掉。

第四个里程碑改变 Supervisor 启动顺序。启动时先创建目录、绑定 socket、开始响应 hello，再后台读取 registry。恢复 worker 对每个旧 session 生成 `recovering`/`history-restored` 结果，并通过事件更新 Host。新的 createSession 在 recovery worker 运行时可立即注册；registry merge 以 sessionId 为键，永不覆盖已经由当前 Supervisor 创建的新 session。恢复结束后 phase 改为 `ready`；失败必须保留可用 socket 和明确的失败诊断，不得让整个 namespace 回到不可连接状态。

Host 保存每个 backend/storage namespace 的临时 recovery phase 并投影给 Webview。它不是画布持久化事实，Host reload 后应由下一次 hello 重建。画布只展示紧凑的恢复中状态；旧节点保持其真实 `reattaching` 或 `history-restored` 语义，新节点不被禁用。

## 具体步骤

1. 在仓库根目录新增/修改文档：本计划、`docs/design-docs/runtime-supervisor-recovery-readiness.md`、设计索引、核心信念和运行时持久化规格。先明确异步恢复、新会话可用性和错误来源边界。

2. 在 `tests/vscode-smoke/` 新增重启等价场景，并在 `scripts/smoke/run-vscode-smoke.mjs` 注册。复用 fake Codex、真实 PTY、runtime control file 和现有 `stopProcess()`；新增 test-only pid/socket/recovery-gate 探针。先运行该场景以记录当前失败。

3. 修改 `runtimeSupervisorProtocol.ts`、`runtimeSupervisorClient.ts`、`runtimeSupervisorMain.ts`、`runtimeSupervisorLocalization.ts` 和 `CanvasPanelManager.ts`，为 recovery phase 和错误来源建立类型、传输、诊断和文案。补充协议/客户端单元测试。

4. 修改 `runtimeHostBackend.ts` 和 fake systemd fixture，修正 `WorkingDirectory`。运行针对 unit 文本和 fake systemd 的测试，确保强保证路径实际启动。

5. 修改 `runtimeSupervisorMain.ts` 的启动、registry 恢复、registry 写入协调和 idle shutdown 逻辑；在 `CanvasPanelManager.ts`、`common/protocol.ts`、Webview 运行节点呈现中投影恢复中状态。保持旧 Supervisor capability 降级兼容。

6. 在仓库根目录运行，并记录结果：

       npm run typecheck
       npm run test:runtime-supervisor-protocol
       npm run test:terminal-session-journal
       DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=runtime-supervisor-reboot-recovery npm run test:smoke
       DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=systemd-user-real-reopen npm run test:smoke
       DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=systemd-fallback-real-reopen npm run test:smoke

   上述定向命令已全部通过。完整测试成本允许时，再运行 `npm test`；本轮没有把未运行的全量套件误写成通过。

## 验证与验收

单元层必须证明：systemd unit 的 `WorkingDirectory` 是无引号绝对路径；client 对 socket missing 和 ready timeout 返回 transport/recovery 错误；Supervisor 对 PTY spawn `ENOENT` 返回 execution-spawn 错误，而不是 socket 错误。

宿主 smoke 必须按顺序观察：旧 runtime 有持久化 marker；Supervisor 被突然杀死且 socket 被移除；Host reload 后 hello 能在恢复工作进行时返回 `recovering`；恢复 gate 未释放时，原本 live 的旧节点仍为 `reattaching`，不得提前进入 Agent resume 或历史恢复；测试同时创建 Agent 与 Terminal，两者均变成 live 并输出 marker；释放 gate 后 phase 变成 `ready`，Host 对仍 pending 的节点重试 attach；恢复后的 snapshot 若明确 `live: false` 才显示历史恢复；诊断没有把 transport 错误显示为 Codex/bash 缺失。

手动验证可在 Linux 或 Remote SSH workspace 中创建几个执行节点、关闭 VS Code/重启远端用户会话后再打开画布。预期先出现恢复中提示，随后旧节点进入可解释状态；立即新建 Agent/Terminal 能够启动。若 systemd 不可用，应显示实际 fallback/transport 错误，而不是 executable 配置建议。

## 幂等性与恢复

所有 smoke 运行目录都由 runner 创建并在 finally 清理。重启场景为 socket 使用短且带 runner PID 的隔离 `XDG_RUNTIME_DIR` 名称；测试删除 socket 前会验证其绝对路径位于该目录或隔离 runtime storage，禁止删除宿主真实 `XDG_RUNTIME_DIR` 或实际 extension storage。SIGKILL 后即使测试失败，finally 也要尝试结束遗留 child、恢复 `runtimePersistence` 设置并清除测试状态。

生产改动不得删除现有 journal 作为启动加速手段。若恢复失败，保留 registry/journal、继续接受新 session，并记录结构化错误；重新连接或重启 Supervisor 可重试恢复。

## 证据与备注

计划启动前的现场证据：systemd unit 第 9 行为 `WorkingDirectory=\"/home/...\"`，真实 systemd 报“path is not absolute”；诊断中的创建错误固定晚于请求约 5 秒；当前 registry 7 个会话对应 1,135 个 journal 文件和约 4.4 GB 数据。当前机器上 `/usr/bin/bash` 与 NVM `codex` 均可执行，且同一 Extension Host Node 环境下 `node-pty` smoke 成功。

## 接口与依赖

在 `extensions/vscode/dev-session-canvas/src/common/runtimeSupervisorProtocol.ts` 中定义稳定的 `RuntimeSupervisorRecoveryState`，并将其加到 `RuntimeSupervisorHelloResult`。phase 至少为 `recovering` 与 `ready`，携带待恢复 session 数和可选失败数；旧 Supervisor 不含该字段时 Host 按兼容模式处理。

在 `extensions/vscode/dev-session-canvas/src/panel/runtimeSupervisorClient.ts` 中增加只读 `getRecoveryState()`，并通过 hello/event 更新。它必须将 net socket 错误封装为可本地化的 transport 错误，而不是泄漏给 Agent/Terminal 的 executable 分支。

在 `extensions/vscode/dev-session-canvas/src/supervisor/runtimeSupervisorMain.ts` 中，`RuntimeSupervisorServer.start()` 改为“listen 后启动 recovery worker”。worker 和 createSession 共享串行的 registry commit 机制；同名 session 只允许恢复旧 registry session 或创建新 session 之一。

在 `extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts` 中，维护 runtime namespace 的 ephemeral recovery 状态，记录 `runtime/recoveryStarted`、`runtime/recoveryReady`、`runtime/recoveryFailed` 诊断，并将其投影为 Host-to-Webview 的短时状态。`describeAgentSessionSpawnError()` 和 `describeEmbeddedTerminalSpawnError()` 只对结构化 PTY spawn error 使用 executable-not-found 文案。

在 `tests/vscode-smoke/` 中的测试控制接口只在 `ExtensionMode.Test` 可用，且不得出现在 `package.json` 贡献命令中。fake systemd 继续是 runner fixture，不替代真实 Linux 上的手动验证。

---

2026-07-28：创建本计划，记录用户指定的实施顺序、现场根因、无真实设备重启的宿主 smoke 方案，以及先 listen 后异步恢复的正式方向。

2026-07-28：完成四个里程碑并归档。首轮 smoke 发现已退出 journal session 不会自行触发 Host reconnect，随后将第一个新 Agent 创建设为真实 Host 侧启动触发，保留并验证了“hello 在恢复中可用”和“两类新会话均可用”的验收语义。

2026-07-28：PR #272 review 发现 recovery gate 下旧 live 节点首次 attach 的 P1。计划重新激活，增加保留 `reattaching`、`ready` 后重试和旧 live Terminal smoke 验收；不把 killed Supervisor 的历史 snapshot 写成实际仍 live 的 PTY。
