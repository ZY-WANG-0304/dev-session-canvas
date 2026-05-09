# Agent 与 Terminal 的 shell 环境继承收口

本 `ExecPlan` 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘` 这几个章节。

当前文档必须按 `docs/PLANS.md` 的要求持续维护。

## 目标与全局图景

完成后，三端桌面宿主都应有一条明确、可诊断的 execution env 继承路线，并把 `Agent` 与用户可见的嵌入式 `Terminal` 分成不同目标处理。`Agent` 继续使用本仓库更严格的“当前 Terminal shell authority -> 受控 patch -> resolver 与 spawn 共用 env”路线：macOS / Linux 使用 POSIX 登录 shell 或非 Windows PowerShell probe，Windows 使用当前配置/默认 Terminal shell 的 PowerShell、`cmd.exe` 或 POSIX family probe。嵌入式 `Terminal` 则对齐 VS Code 原生 Terminal 的跨平台取舍：Windows 不预应用 shell env patch，让真实 shell 自己执行 profile / AutoRun；macOS / Linux 默认继承受控 shell env patch，避免 GUI 启动 VS Code 时丢失只存在于 login startup 文件里的 Homebrew、NVM、PATH 或工具链变量，同时提供 `devSessionCanvas.terminal.inheritEnv` 作为 opt-out。中期还要补 `devSessionCanvas.terminal.shellArgs`，让 shell 的 `path + args` 由配置表达，而不是把 env 继承和是否 login shell 启动硬绑在一起。后续优化在 POSIX `Terminal` 上使用 login-only probe，尽量只预取 login startup 文件里的环境，让真实交互 shell 自己执行 rc 一次；这个优化不会替代配置开关，因为用户 profile 手动 source rc 时仍可能重复。用户可以直接观察到：`Agent` 和 `Terminal` 节点在 POSIX GUI 启动场景下都能看到 shell 工具链变量，Windows Terminal 不再双重应用 profile / AutoRun，且 host diagnostics 能说明当前使用的 shell env 继承策略与 probe 模式。

## 进度

- [x] (2026-05-07 10:32 +0800) 阅读 `docs/WORKFLOW.md`、`docs/PLANS.md`、`docs/DESIGN.md`、`docs/design-docs/agent-cli-launch-context-and-resume.md` 与 `docs/design-docs/execution-session-platform-compatibility.md`，确认本任务需要同时更新正式设计、技术债和实现。
- [x] (2026-05-07 11:28 +0800) 新增并接线 POSIX shell environment resolver，形成“受控 shell env patch + launch env 复用”的宿主能力。
- [x] (2026-05-07 11:44 +0800) 让 `Agent` / `Terminal` 的 resolver 与真实 spawn 共用同一份 execution env，并补诊断信息。
- [x] (2026-05-07 12:05 +0800) 更新设计文档、设计索引与技术债记录，明确 Windows 环境处理仍待后续实现。
- [x] (2026-05-07 12:12 +0800) 运行自动化验证并在本计划中补齐证据。
- [x] (2026-05-07 19:05 +0800) 复盘 Windows 当前缺口，确认继续沿用本 ExecPlan 收口而不是另起新计划；同时明确 Windows 路线要同时覆盖 shell env 解析、execution env 复用、诊断和正式文档。
- [x] (2026-05-07 19:24 +0800) 为 Windows 新增受控 shell env patch 解析能力，覆盖 `powershell.exe`、`cmd.exe`，并兼容 Windows 下名称可判定为 POSIX 家族的 shell。
- [x] (2026-05-07 19:30 +0800) 让 Windows 路线显式基于当前配置/默认 Terminal shell 解析 patch，并在 shell 变更时刷新缓存与诊断。
- [x] (2026-05-07 19:48 +0800) 补充 Windows 定向回归与真实 smoke 证据，并把技术债从“整条 Windows 路线未实现”收窄为“自定义 shell 仍缺真实 smoke 覆盖”。
- [x] (2026-05-07 20:13 +0800) 扩充 Windows real Codex smoke，新增 `powershell` / `cmd` / Git Bash shell 场景，并把 host diagnostics 补齐 `shellFamily` 维度，进一步把剩余技术债收窄到 MSYS2 等尚未验证的少量自定义 shell。
- [x] (2026-05-08 08:18 +0800) 利用本机已安装的 MSYS2，继续扩充 Windows real Codex smoke，补齐 `msys2-bash` / `msys2-sh` 场景，并把剩余技术债继续收窄到更少见的 Windows POSIX family shell 名称。
- [x] (2026-05-08 10:46 +0800) 根据 review 收口 Windows `Terminal` 启动不再预应用 shell env patch，并让相对 `terminal.shellPath` 的 env probe 与配置检查统一复用 workspace `cwd`。
- [x] (2026-05-08 11:34 +0800) 根据 review 收口 `PATH` 合并顺序：普通 host-only 目录不再整体前置到 shell `PATH` 之前，只保留显式注入测试目录的优先级，并补齐跨平台回归。
- [x] (2026-05-08 12:08 +0800) 根据 review 收口 Agent CLI 解析缓存：把 cache key 绑定到当前 shell authority，并在 shell 配置变化时清空旧 cache，避免 resolver 持续命中旧工具链路径。
- [x] (2026-05-08) 根据 review 收口 Windows real smoke 隔离：让 `testResetState` 清空 Agent CLI 解析缓存，并要求 smoke 场景显式断言 `resolutionSource !== 'cache'`。
- [x] (2026-05-08 23:10 +0800) 根据 review 修复非 Windows PowerShell env probe：`pwsh` / `powershell` 不再落入 POSIX `-i -l -c` 分支，并新增脚本级回归。
- [x] (2026-05-08 23:20 +0800) 根据 review 收口 Agent CLI 缓存 workspace 语义：缓存改为 Extension Host 进程内状态，所有命令的 cache key 都绑定规范化 workspace `cwd`，并在 workspace root 变化时失效。
- [x] (2026-05-09) 根据 review 将 `Terminal` target 的 shell env patch 保护扩展到所有平台，避免 macOS / Linux 的登录/交互 shell probe 与真实 Terminal 启动双重执行 rc/profile。
- [x] (2026-05-09 18:10 +0800) 复盘 VS Code 原生 Terminal 行为，确认应采用混合方案：`Agent` 保留受控 patch 与 Windows-aware 设计，POSIX `Terminal` 默认继承 shell env，Windows `Terminal` 继续跳过。
- [x] (2026-05-09 18:36 +0800) 实现短期修复：`Terminal` env inheritance 改为平台感知，并新增 `devSessionCanvas.terminal.inheritEnv` 作为 POSIX opt-out。
- [x] (2026-05-09 18:42 +0800) 实现中期基础能力：新增 `devSessionCanvas.terminal.shellArgs` 并让本地 PTY 与 runtime supervisor 共用 `path + args + env` launch spec。
- [x] (2026-05-09 18:47 +0800) 实现后续优化的第一步：POSIX `Terminal` 使用独立的 login-only probe cache，尽量降低 rc/profile 双重应用风险，同时保留显式配置开关。
- [x] (2026-05-09 18:55 +0800) 补齐自动化测试、类型检查、构建验证，并把验证证据写回本计划与正式设计文档。

## 意外与发现

- 观察：本轮开始时，仓库虽然已经给 `Agent` 做了“命令发现”层的 POSIX 登录 shell 探测，但真正 spawn 进程时仍然直接使用 Extension Host 的 `process.env`。
  证据：起步时的 `src/panel/agentCliResolver.ts` 会在 POSIX 上运行 `shell -lc 'command -v ...'`；而当时的 `CanvasPanelManager` 仍只基于 `process.env` 组装启动环境。

- 观察：VS Code 原生的 shell env 解析在官方实现里只在 macOS / Linux 上运行，并且会跳过 Windows 与 `VSCODE_CLI=1` 的场景。
  证据：`src/vs/platform/shell/node/shellEnv.ts` 当前主线实现里，`getResolvedShellEnv()` 会对 Windows 和 `isLaunchedFromCli(env)` 直接返回空结果。

- 观察：如果 execution env 直接用 shell 返回值裸覆盖 `PATH`，会把宿主为 test harness 前置的 fake CLI 目录吃掉，导致自动化漂移。
  证据：`CanvasPanelManager.buildBaseExecutionEnvironment()` 在 test harness 模式下会把 `DEV_SESSION_CANVAS_TEST_CODEX_COMMAND` / `DEV_SESSION_CANVAS_TEST_CLAUDE_COMMAND` 所在目录前置到 `PATH`；因此最终实现必须对 `PATH` 做“保留 host 额外目录 + shell 主体顺序优先”的合并。

- 观察：Windows 上即使 `process.env` 只显式带有 `PATH`，真实用户或测试传入的 plain object 仍可能只写 `Path`；如果 resolver 只盯 `PATH`，会把新的 shell env patch 当成不存在。
  证据：本轮新增 `scripts/test-agent-cli-resolver.mjs` 的 `Path` 大小写回归前，`resolveCommandFromPathEnv(...)` 只读取 `env.PATH`，无法证明大小写不敏感场景仍然稳定。

- 观察：PowerShell profile 可以通过重定向 `USERPROFILE` / `HOME` 到临时目录来做无侵入测试，这让“Windows shell env patch 真正读取到了 profile 增量”可以在本机自动化里被直接证明。
  证据：`scripts/test-shell-environment-resolver.mjs` 现在会在临时 `Documents\\WindowsPowerShell\\Microsoft.PowerShell_profile.ps1` 中设置 `CUSTOM_TOOLCHAIN_TOKEN`、`PNPM_HOME`、`PATH`、`PATHEXT`，并断言这些值进入 patch，同时 `USERPROFILE` / `PROMPT` 仍被过滤。

- 观察：在 Windows 上把 shell env patch 一律记成 `windows-shell` 来源，虽然满足平台口径，但不足以区分当前走的是 PowerShell、`cmd.exe` 还是 POSIX family shell；真实 smoke 若只断言 `source`，无法证明 Git Bash 这类路径真的落到预期分支。
  证据：本轮为 `ResolvedShellEnvironmentPatch` 与 host diagnostics 新增 `shellFamily`，随后 `tests/vscode-smoke/windows-real-codex-smoke.cjs` 可以在真实 Windows + Codex 宿主里分别断言 `powershell`、`cmd` 与 Git Bash (`posix`) 三条场景。

- 观察：MSYS2 的 `bash.exe` 与 `sh.exe` 在无 TTY 探针模式下也能稳定接受 `-i -l -c`，虽然会输出 “no job control in this shell” 告警，但不会影响 shell env patch 解析与真实 Agent 渲染；这使它们适合直接接入现有 Windows real smoke。
  证据：2026-05-08 本机执行 `C:\msys64\usr\bin\bash.exe -i -l -c 'printf ok-msys2-bash'` 与 `C:\msys64\usr\bin\sh.exe -i -l -c 'printf ok-msys2-sh'` 均返回 `ok-*`，仅伴随预期的 job-control 提示。

- 观察：Windows `Terminal` 如果先离线 probe 一次 PowerShell profile / `cmd.exe` AutoRun，再把得到的 env patch 注入到真正启动的 shell，会把 profile / AutoRun 的副作用重复应用两次。
  证据：修复前 `CanvasPanelManager.resolveExecutionEnvironment()` 会对 `Agent` 与 `Terminal` 一视同仁地应用 `resolveShellEnvironmentPatch(...)` 结果；而 `src/panel/shellEnvironmentResolver.ts` 的 Windows 分支又明确会读取 PowerShell profile 与 `cmd.exe` AutoRun 导出的环境增量。

- 观察：`terminal.shellPath` 使用相对路径时，配置层与 env probe 的解析基准如果不一致，会出现 UI / 校验认定 shell 可用，但 probe 侧稳定 `ENOENT` 并静默回退到未补丁环境的分叉。
  证据：`src/panel/terminalShellConfiguration.ts` 会按 workspace `cwd` 解析相对 shell 路径；修复前 `shellEnvironmentResolver.spawnAndCapture(...)` 直接拿原始相对路径 `spawn(...)` 且未传 `cwd`，因此与配置检查基准不一致。

- 观察：如果把所有 host-only `PATH` 目录一律整体前置到 shell `PATH` 前面，shell 已经选定的 Node / Codex / pnpm / volta 工具链仍可能被 Extension Host 基线目录抢先命中，导致“受控 shell env patch 已应用但工具链 authority 仍回到 host”的假对齐。
  证据：review 给出的最小复现 `base=/usr/local/bin:/usr/bin`、`shell=/opt/homebrew/bin:/usr/bin` 会把旧实现合成为 `/usr/local/bin:/opt/homebrew/bin:/usr/bin`；修复前 `mergePathEnvironmentValue(...)` 也确实先收集全部 base-only 目录，再整体拼到 shell `PATH` 前面。

- 观察：即使 shell env patch 会在 shell 变化时刷新，如果 Agent CLI 绝对路径缓存仍只按 `platform/provider/requestedCommand/workspaceCwd` 建 key，resolver 仍会持续以 `source: cache` 命中旧 shell 工具链，重新制造“resolver 仍指向旧 shell，spawn env 已切到新 shell”的确定性分叉。
  证据：review 指出的 `CanvasPanelManager` 只在 shell 变化时失效 `resolvedShellEnvironmentPatchPromise`，但 `agentCliResolutionCache` 既没有同步清空，也没有把 shell authority 编进 key。

- 观察：Windows real smoke 虽然会在多个 shell 场景之间循环调用 `testResetState()`，但如果该 helper 只重置画布状态、不清空 Agent CLI 解析缓存，后续场景仍可能通过 `source: cache` 命中第一轮解析出的绝对 `codex` 路径，从而给出假阳性。
  证据：`tests/vscode-smoke/windows-real-codex-smoke.cjs` 会在每轮场景前后调用 `devSessionCanvas.__test.resetState`，而修复前 `CanvasPanelManager.resetState()` 不会触碰 `agentCliResolutionCache`；同一 smoke 断言又只要求 `resolvedCommand` 非空，没有要求 `resolutionSource` 脱离 `cache`。

- 观察：非 Windows 上 `detectShellFamily(...)` 已经能把 `pwsh` / `powershell` 识别为 `powershell` family，但 `resolveShellEnvironment(...)` 先用 `platform !== 'win32'` 把所有非 Windows shell 直接送入 POSIX probe，导致 PowerShell 被传入只适用于 POSIX shell 的 `'<node>' -p ...` 命令串。
  证据：修复前 `src/panel/shellEnvironmentResolver.ts` 中 `resolveShellEnvironment(...)` 的第一分支覆盖所有非 Windows 平台；本轮新增的 `scripts/test-shell-environment-resolver.mjs` 假 `pwsh` 回归会在收到 `-i` / `-l` / `-c` 时直接失败，修复后该测试通过并断言 `source === 'powershell'`。

- 观察：Agent CLI 解析缓存如果既写入 `globalState`，又让裸命令名 key 忽略 workspace `cwd`，那么 repo A 中由 direnv / Nix / repo-local shim 解析出的绝对 `codex` 路径，会在 repo B 或窗口重载后继续被 `source: cache` 命中。
  证据：修复前 `CanvasPanelManager` 构造函数从 `context.globalState` 读取 `agentCliResolutionCache`，`storeAgentCliResolution(...)` 再写回 `globalState`；同一文件的 `getAgentCliResolutionCacheKey(...)` 只在显式相对命令时加入 `workspaceCwd`，而 smoke 回归原本还断言 `requestedCommand: 'codex'` 在 workspace A/B 的 key 相等。

- 观察：非 Windows `Terminal` 如果沿用 shell-derived execution env，POSIX `-i -l -c` probe 或 PowerShell profile probe 会先执行一次 rc/profile；随后真实 `Terminal` 又以 `args: []` 启动同一个交互 shell，常见的 `PATH="$HOME/.local/bin:$PATH"`、工具链 hook 或计数型变量会被稳定应用两次。
  证据：修复前 `shouldResolveShellEnvironmentPatchForExecutionTarget(...)` 只跳过 Windows `Terminal`，因此 macOS / Linux `resolveExecutionEnvironment('terminal')` 会预应用 patch；用 fake shell 复现时，probe 后 `CUSTOM_RC_COUNT=1`，再用 patched env 启动真实 shell 会输出 `CUSTOM_RC_COUNT=2`，`PATH` 中同一个 rc 目录也被重复前置。

- 观察：VS Code 原生 Terminal 没有把“避免 profile/rc 重复执行”放在“POSIX GUI 启动时工具链变量可用”之前；它默认让 Terminal 继承可能来自 login shell 的 shell environment，并用 `terminal.integrated.inheritEnv=false` 或 profile args 调整作为 opt-out。
  证据：2026-05-09 调研 VS Code 主线源码时，`terminal.integrated.inheritEnv` 默认值为 `true`，描述明确写出这份环境可能来自 login shell、用于初始化 `$PATH` 与开发变量，且对 Windows 无效；`TerminalProcessManager._resolveEnvironment(...)` 在 `useShellEnvironment=true` 时使用 backend shell environment 作为 base env。

- 观察：仅把 POSIX `Terminal` 改成真正 login shell 启动并不是 VS Code 的完整方案，也不适合作为本仓库唯一修复；VS Code 把 env inheritance 和 profile args 拆成两层。
  证据：VS Code `terminalProfileResolverService` 会先把 `useShellEnvironment` 绑定到 `terminal.integrated.inheritEnv`，再由 profile 的 `path + args` 决定 shell 启动参数；其 macOS fallback 会给 zsh/bash `--login`，Linux fallback 仍是 `args=[]`。

- 观察：2026-05-08 本机 `npm run test:smoke` 的 `SIGABRT` 不是由这次 shell authority cache 修复直接触发；在同一台 macOS 机器上，哪怕去掉 extension test、只直接启动 VS Code 主进程，也会在创建日志目录前就被 LaunchServices / AppKit 路径上的 `RegisterApplication` 中止。
  证据：同日 `DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=trusted npm run test:smoke` 仍稳定 `SIGABRT` 且 `artifacts/` 为空；随后最小命令 `env -u ELECTRON_RUN_AS_NODE /Applications/Visual Studio Code.app/Contents/MacOS/Code ...` 也独立返回 134，并在 `~/Library/Logs/DiagnosticReports/Code-2026-05-08-164522.ips` 中留下 `EXC_CRASH (SIGABRT)`，主线程栈顶为 `___RegisterApplication_block_invoke` / `NSApplication sharedApplication`。

## 决策记录

- 决策：本轮不把 `Agent` 执行改成“整条命令交给 shell 解释”，而是继续保持 `node-pty.spawn(file, args)` 的结构化执行路径，只把“环境发现”和“环境复用”对齐到更接近 VS Code 原生的模式。
  理由：仓库已有正式设计明确要求执行主路径保持结构化 `file + args[]`，这样才能避免 shell 注入、跨平台 quoting 漂移与 provider 自定义命令再次被 shell 二次解释。
  日期/作者：2026-05-07 / Codex

- 决策：shell env 不直接 wholesale 替换 `process.env`，而是以“diff patch + denylist 过滤 + `PATH` 特殊合并”的方式进入 execution env。
  理由：这样既能同步 `PATH`、`NVM_DIR` 和自定义工具链变量，又不会覆写 `HOME`、`PWD`、`TERM`、`ELECTRON_*`、`VSCODE_*` 等不应被执行节点接管的变量，也能保住 test harness 人为前置的 fake CLI 目录。
  日期/作者：2026-05-07 / Codex

- 决策：Windows 路线不再继续依赖“Extension Host 基线环境 + where/Get-Command 兜底”这条半闭环，而是把当前配置/默认 Terminal shell 当作环境 authority。
  理由：Windows 没有与 POSIX 完全等价的登录 shell 语义；直接基于当前 Terminal shell 解析 PowerShell / cmd / POSIX family shell 的环境快照，更贴近用户真实在插件里选择的执行上下文，也能在 shell 设置变化时给出可诊断的刷新点。
  日期/作者：2026-05-07 / Codex

- 决策：采用混合方案，而不是继续把 `Terminal` shell env patch 全平台关闭。`Agent` 继续使用本仓库的受控 patch、Windows-aware probe、结构化 spawn 与 shell/workspace 绑定 cache；`Terminal` 则对齐 VS Code 原生跨平台语义：Windows 跳过 shell env patch，POSIX 默认继承 shell env，并提供 opt-out。
  理由：`Agent` 不是用户交互 shell，必须避免整份 shell env 无边界覆盖并在 Windows 上主动读取当前 shell authority；但用户可见 `Terminal` 的默认行为应优先保证 macOS / Linux GUI 启动时仍能拿到 login startup 文件中的 PATH、Homebrew、NVM 与工具链变量。重复 PATH / rc 副作用是真实 trade-off，应通过配置与 profile args 管理，而不是牺牲 POSIX Terminal 工具链可用性。
  日期/作者：2026-05-09 / Codex

- 决策：新增 `devSessionCanvas.terminal.inheritEnv` 与 `devSessionCanvas.terminal.shellArgs`，分别表达“Terminal 是否继承 shell environment”和“Terminal shell 以哪些 argv 启动”。
  理由：这复用 VS Code 原生 Terminal 的关键分层：env inheritance 决定 base env，profile args 决定 shell 启动形态。短期用 `inheritEnv` 修复 POSIX login-only env 丢失；中期用 `shellArgs` 支持用户显式 `-l`、`--login` 或清空参数，而不是继续让 `CanvasPanelManager.buildTerminalLaunchSpec(...)` 固定 `args: []`。
  日期/作者：2026-05-09 / Codex

- 决策：POSIX `Terminal` 的 shell env patch 使用独立 login-only probe cache，`Agent` 继续使用 interactive-login probe cache；Windows `Terminal` 不使用这两者。
  理由：`Agent` 需要尽可能贴近用户完整开发 shell environment；`Terminal` 启动后还会运行真实交互 shell 自己的 rc，所以先预应用 login-only patch 可以覆盖 GUI 启动缺失的 login startup 变量，同时减少 `.zshrc` / `.bashrc` 被离线 probe 与真实 shell 双重执行的概率。这个优化不能消除 profile 手动 source rc 的重复风险，因此仍需要 `inheritEnv` opt-out 与 `shellArgs` 显式控制。
  日期/作者：2026-05-09 / Codex

- 决策：相对 `terminal.shellPath` 的 env probe 必须与配置检查共享同一套 workspace `cwd` 解析基准。
  理由：只有让 `terminalShellConfiguration` 的可用性校验和 `shellEnvironmentResolver` 的真实 probe 对齐，才能避免 UI 认定可用、probe 却因 `ENOENT` 静默回退到未补丁环境的分叉。
  日期/作者：2026-05-08 / Codex

- 决策：`PATH` 合并改为“shell 主体顺序优先 + 显式优先目录白名单前置 + 其余 host-only 目录后置”，而不是把所有 host-only 目录整体前置。
  理由：这样既能保住 test harness 等显式注入目录的优先级，又不会让普通 host `PATH` 抢在 shell 选定的工具链前面，避免再次出现 resolver / spawn 已走 shell patch 但最终命中的仍是 host 版本的确定性偏差。
  日期/作者：2026-05-08 / Codex

- 决策：Agent CLI 绝对路径缓存必须显式绑定当前 shell authority，并在 shell 配置变化时清空旧缓存。
  理由：当前分支已经把 Terminal shell 视为 execution env authority；如果 cache 仍跨 shell 复用，就会让 resolver 固定在旧 shell 解析出的 `codex` / `claude` 路径上，直接破坏“resolver 与 spawn 共享同一 authority”的目标。
  日期/作者：2026-05-08 / Codex

- 决策：PowerShell family shell 在所有平台都走 PowerShell 专用环境快照 probe；非 Windows 上的成功来源记为 `powershell`，Windows 上继续保留 `windows-shell` 来源并用 `shellFamily` 区分 PowerShell / cmd / POSIX family。
  理由：`pwsh` 是跨平台 shell，不能因为运行在 macOS / Linux 就套用 POSIX quoting；新增 `powershell` 来源可以让 host diagnostics 明确说明“这是非 Windows PowerShell probe”，而不是误标为 `posix-login-shell`。
  日期/作者：2026-05-08 / Codex

- 决策：Agent CLI cache 改为 Extension Host 生命周期内的进程内缓存，并且所有 requested command 的 key 都包含规范化 workspace `cwd`。
  理由：execution env 已经允许由 workspace `cwd` 驱动 shell patch；即使命令名不是显式相对路径，direnv / Nix / repo-local shim 也会让同一 shell 下不同 repo 解析出不同 CLI 路径。把 workspace 编进 key，同时停止写入 `globalState`，可以避免跨 repo 与跨窗口重载复用旧绝对路径。
  日期/作者：2026-05-08 / Codex

- 决策：把“显式路径”和“自动解析结果”写成不同产品语义：显式路径是用户决策，自动解析出的绝对路径只是当前环境观测值。
  理由：用户安装 CLI、修改 shell profile 或启用 direnv / Nix 后，Reload Window 或重启 VS Code 应重新 probe 当前可见环境；如果把旧解析结果持久化，就会违背“重启后新环境生效”的常见预期。
  日期/作者：2026-05-08 / Codex

## 结果与复盘

- 已完成：`src/panel/shellEnvironmentResolver.ts` 现在已经同时支持桌面 shell env 继承主路径：macOS / Linux 的 POSIX 登录 shell、非 Windows `pwsh` / `powershell` 的 PowerShell probe、Windows PowerShell / cmd，以及 Windows 下名称可判定为 POSIX 家族的 shell。它会统一产出受控 env patch，并在 Windows 上处理 `PATH` / `PATHEXT` 与环境变量大小写不敏感问题。
- 已完成：host diagnostics 现在会显式记录 shell env patch 来源、`shellFamily`、skip reason、shell 路径、应用到的 key 和错误摘要，后续排查 GUI 环境缺工具链时不再只能靠截图倒推。
- 已完成：`CanvasPanelManager` 现在会把 shell env patch 显式绑定到当前配置/默认 Terminal shell，并在 `devSessionCanvas.terminal.shell`、`devSessionCanvas.terminal.shellPath` 或 `vscode.env.shell` 变化时刷新缓存；其中 `Agent` resolver、`Agent` spawn 与 runtime supervisor createSession 继续共用同一份 execution env。`Terminal` env inheritance 已改为平台感知：Windows 保留 base env，POSIX 默认继承 login-only shell env patch，并可通过 `devSessionCanvas.terminal.inheritEnv=false` 关闭。
- 已完成：`resolveShellEnvironmentPatch(...)` 现在会接收并透传 workspace `cwd`；相对 `terminal.shellPath` 的 env probe 与 `terminalShellConfiguration` 的配置检查已共享同一套解析基准，不再因为 `spawn` 端漏传 `cwd` 而稳定 `ENOENT`。
- 已完成：`applyShellEnvironmentPatch(...)` 现在只会把显式声明要保优先级的 base `PATH` 目录继续前置；其余 host-only 目录都会追加在 shell `PATH` 之后。macOS / Linux 与 Windows 回归已同步覆盖“shell 主体顺序优先 + test harness 目录仍可保前置”的组合语义。
- 已完成：Agent CLI 解析缓存现在只存在于当前 Extension Host 生命周期内，并会把当前 Terminal shell authority 与规范化 workspace `cwd` 一起编入 cache key；同一 requested command 在不同 shell authority 或不同 workspace 下不再共享旧绝对路径，workspace root 变化时也会同步清空缓存与 shell env patch。
- 已完成：`devSessionCanvas.__test.resetState` 现在会显式清空 Agent CLI 解析缓存；Windows real smoke 也新增 `resolutionSource` 必须存在且不得为 `cache` 的断言，避免多场景循环时把旧绝对路径命中误当成新的 shell 证据。
- 已完成：正式设计文档和自动化验证已同步更新；本轮 `node scripts/test-shell-environment-resolver.mjs`、`node scripts/test-terminal-shell-configuration.mjs`、`npm run test:agent-cli-resolver`、`npm run typecheck`、`npm run build`、`node -c tests/vscode-smoke/extension-tests.cjs` 与 `git diff --check` 已通过。其中 shell resolver 新增覆盖非 Windows `pwsh` / `powershell` 不再落入 POSIX probe、`Terminal` target 平台感知继承、POSIX login-only probe 与 inheritEnv opt-out；terminal shell 配置回归新增覆盖 `shellArgs` 规范化。上一轮 Windows real smoke 已覆盖默认 `codex`、显式 `codex.cmd`、`powershell`、`cmd`、Git Bash、MSYS2 `bash` 与 MSYS2 `sh` 七类场景。
- 剩余：Windows 自定义 shell 的真实 smoke 缺口已继续收窄到更少见的 Windows POSIX family shell 名称，例如 `zsh`、`fish`，或用户通过显式 `shellPath` 接入的非常规 shell；它们仍共享同一条 POSIX 解析分支，但当前仓库还没有同等级真实 smoke 证据。

## 上下文与定向

本任务同时影响“命令发现”和“命令启动”两条链路。关键文件如下：

- `src/panel/agentCliResolver.ts`：宿主侧 Agent CLI 解析器，当前已经支持 `PATH`、POSIX 登录 shell 和 Windows 原生命令发现。
- `src/panel/CanvasPanelManager.ts`：组装 `Agent` / `Terminal` 启动环境并调用本地 PTY 或 runtime supervisor 的主入口。
- `src/panel/executionSessionBridge.ts`：把 `ExecutionSessionLaunchSpec` 交给 `node-pty.spawn(...)` 的统一桥接层。
- `src/common/runtimeSupervisorProtocol.ts` 与 `src/supervisor/runtimeSupervisorMain.ts`：runtime supervisor 路径会序列化宿主侧 `launchSpec.env`，因此只要 host 构造出的 env 正确，supervisor 链路也会跟着受益。
- `docs/design-docs/agent-cli-launch-context-and-resume.md`：定义 Agent CLI 启动上下文、命令发现与 provider 配置边界。
- `docs/design-docs/execution-session-platform-compatibility.md`：记录 Linux/macOS/Windows 平台差异与 CLI 命令发现路线。
- `docs/exec-plans/tech-debt-tracker.md`：登记本轮不会一起完成的 Windows 路线缺口。

这里的“受控 shell env patch”指：不直接拿登录 shell 输出的整份环境 wholesale 替换 `process.env`，而是提取相对 Extension Host 基线有意义的增量变量，用它补齐 `PATH` 与工具链相关变量，同时排除 `HOME`、`PWD`、`TERM`、`ELECTRON_*`、`VSCODE_*` 这类不该被 provider 启动环境接管的变量。

## 工作计划

现状已经完成 POSIX 与 Windows 的 Agent execution env 路线，本轮继续按混合方案收口 Terminal 侧语义。第一，`src/panel/shellEnvironmentResolver.ts` 必须保留 Agent 的 interactive-login probe，并新增 POSIX Terminal 专用 login-only probe mode，避免把后续真实交互 shell 自己会执行的 rc 尽量重复离线执行。第二，`src/panel/CanvasPanelManager.ts` 的 `resolveExecutionEnvironment(...)` 必须按 target、platform 与 `devSessionCanvas.terminal.inheritEnv` 做平台感知 gating：Agent 始终使用 shell env patch，Windows Terminal 始终跳过，POSIX Terminal 默认继承。第三，`Terminal` launch spec 必须从配置读取 `devSessionCanvas.terminal.shellArgs`，让 shell 启动参数与 env inheritance 分层表达。随后补脚本回归、正式设计文档和本计划记录。

## 具体步骤

1. 扩展 `src/panel/shellEnvironmentResolver.ts`：
   - 保留现有 POSIX 登录 shell 解析；
   - 为 Windows 增加 PowerShell / cmd / Windows 下 POSIX shell 的环境快照读取；
   - 让 patch 过滤、`PATH` 合并和大小写处理兼容 Windows 的大小写不敏感环境变量；
   - 在成功 / 跳过 / 失败时继续产出可诊断元数据。
2. 修改 `src/panel/CanvasPanelManager.ts`：
   - 让 shell env patch 解析显式依赖当前配置/默认 Terminal shell；
   - 在 Terminal shell 配置或 VS Code 默认 shell 变化时使缓存失效；
   - 保持 `resolveAgentCli(...)`、`buildAgentLaunchSpec(...)` 与 runtime supervisor 继续共用同一份 agent execution env，同时让 Windows `Terminal` 跳过预应用 patch、POSIX `Terminal` 默认继承 login-only patch。
3. 必要时调整 `src/panel/agentCliResolver.ts`，确保 Windows 上对 `PATH` / `PATHEXT` 的读取能和新 execution env 对齐，而不是依赖大小写巧合。
4. 新增脚本级回归，至少覆盖：
   - Windows shell env patch 会保留 `PATH` 外的工具链变量；
   - `USERPROFILE` / `HOME` / `PROMPT` / `TERM` 等禁用变量不会被 patch 覆盖；
   - Windows `PATH` 合并不会吃掉 host 额外前置的测试目录；
   - `VSCODE_CLI=1` 会继续跳过 shell env 解析；
   - `Terminal` target 的 shell env patch gating 平台感知：Windows 跳过，POSIX 默认开启，POSIX opt-out 可关闭；
   - POSIX `Terminal` 使用 login-only probe，而 `Agent` 继续使用 interactive-login probe；
   - `devSessionCanvas.terminal.shellArgs` 会进入 Terminal launch spec；
   - 相对 `terminal.shellPath` 的 env probe 与配置检查共享 workspace `cwd`；
   - 非 Windows `pwsh` / `powershell` 会走 PowerShell probe，而不是 POSIX `-i -l -c` 分支；
   - Agent CLI cache key 对裸命令名也按 workspace `cwd` 隔离，且缓存不再跨窗口持久化；
   - 如当前环境可用，再补真实 Windows shell 或真实 Codex smoke 证据。
5. 更新设计文档、索引、技术债和本计划，把 Windows 路线的正式口径与剩余缺口写清楚。

## 验证与验收

- 运行 `npm run typecheck`，预期通过。
- 运行 `npm run build`，预期通过。
- 运行新增的 shell environment resolver 脚本级回归，预期通过。
- 在 Windows 环境运行 `npm run test:agent-cli-resolver`，预期通过。
- 如果当前机器具备真实 `Codex`、VS Code、Git Bash 与 MSYS2，可运行 `npm run test:smoke:windows-real-codex`，预期同时证明默认 `codex` / 显式 `.cmd`、`powershell`、`cmd`、Git Bash、MSYS2 `bash` 与 MSYS2 `sh` 场景下的 `Agent` 路线都能按当前 Terminal shell 对齐环境并渲染出真实终端输出。
- 如实现中新增或调整现有脚本，再补 `git diff --check`，预期无 whitespace / conflict 类问题。
- 验收时至少应能明确说明：所有平台上 `Agent` launch env 与 resolver 共享同一份 shell-derived patch；Windows `Terminal` launch 保留 base env，让真实 shell 自己执行 profile / AutoRun 一次；POSIX `Terminal` 默认继承受控 shell env，并可通过 `devSessionCanvas.terminal.inheritEnv=false` 关闭。若 Windows 仍有剩余边界，必须把它收窄到具体 shell / 具体验证缺口，而不是继续笼统写成“整条路线未实现”。

## 幂等性与恢复

- shell env 解析只读用户环境，不写入用户 shell 配置或 provider 配置目录；失败时必须 fail open，继续回退到当前 `process.env` 基线。
- Agent CLI 解析缓存只存在于当前 Extension Host 生命周期内；重载窗口后重新解析，不写入 `globalState`，也不要求跨窗口持久化。缓存 key 对所有 requested command 都包含规范化 workspace `cwd`，因此重复执行不会把 repo A 的绝对 CLI 路径复用到 repo B。
- 用户显式配置的 Agent CLI 绝对路径仍然是稳定决策，重启后继续优先校验并使用；只有从裸命令名自动解析出的绝对路径会被视为当前环境观测值，不跨窗口保存。
- 文档更新和技术债登记可重复执行，不影响运行时状态。

## 证据与备注

- 2026-05-07：`npm run typecheck` 通过。
- 2026-05-07：`npm run build` 通过。
- 2026-05-07：`node scripts/test-shell-environment-resolver.mjs` 通过，覆盖 POSIX / Windows patch 过滤、`PATH` / `PATHEXT` 合并、`VSCODE_CLI=1` 跳过和 PowerShell profile 驱动的 env patch。
- 2026-05-07：`npm run test:shell-environment-resolver` 通过。
- 2026-05-07：`npm run test:agent-cli-resolver` 在真实 Windows 环境通过，新增覆盖 `Path` 大小写回归。
- 2026-05-07：`npm run test:smoke:windows-real-codex` 通过，证明默认 `codex` 与显式 `.cmd` 路线都能在真实 Windows + VS Code + Codex 环境里渲染出终端输出。
- 2026-05-07：扩充后的 `npm run test:smoke:windows-real-codex` 再次通过，覆盖默认 `codex`、显式 `codex.cmd`、`powershell`、`cmd` 与 Git Bash 场景，并断言 `shellEnvPatchResolved` 的 `shellFamily` 与当前 Terminal shell 绑定关系。
- 2026-05-08：再次扩充后的 `npm run test:smoke:windows-real-codex` 通过，新增覆盖 MSYS2 `bash` / `sh` 场景，并把真实 smoke 缺口继续收窄到更少见的 Windows POSIX family shell 名称。
- 2026-05-08：review 收口后的 `npm run test:shell-environment-resolver`、`npm run test:terminal-shell-configuration`、`npm run test:agent-cli-resolver`、`npm run typecheck`、`npm run build` 与 `npm run test:smoke:windows-real-codex` 通过，新增覆盖 Windows `Terminal` target 跳过预应用 patch 与相对 `terminal.shellPath` probe 复用 workspace `cwd`。
- 2026-05-08：再次根据 review 收口后，`npm run test:shell-environment-resolver`、`npm run typecheck`、`npm run build` 与 `git diff --check` 通过，新增覆盖 “shell `PATH` 主体顺序优先 + 显式注入测试目录仍保前置” 的 POSIX / Windows 回归。
- 2026-05-08：再次根据 review 收口后，`npm run typecheck`、`npm run build`、`node -c tests/vscode-smoke/extension-tests.cjs` 与 `git diff --check` 通过；新增了 Agent CLI cache key 按 shell authority 隔离的 smoke 断言。随后复跑 `npm run test:smoke` 仍在本机以 `SIGABRT` 提前终止；进一步最小化到直接启动 VS Code 主进程也同样崩溃，并在 `~/Library/Logs/DiagnosticReports/Code-2026-05-08-164522.ips` 记录到 `RegisterApplication` 相关 `SIGABRT`，因此当前把 smoke 结果标注为“本机 VS Code/macOS 启动环境问题，待单独处理后复跑”，而不是本轮代码回归。
- 2026-05-08：再次根据 review 收口后，`npm run typecheck`、`npm run build`、`npm run test:smoke:windows-real-codex` 与 `git diff --check` 通过；新增覆盖 `testResetState` 清空 Agent CLI 解析缓存，以及 Windows real smoke 场景显式拒绝 `resolutionSource = cache` 的回归。
- 2026-05-08：`git diff --check` 通过。
- 2026-05-08 23:22 +0800：`npm run test:shell-environment-resolver` 通过；新增非 Windows `pwsh` fake probe，证明 PowerShell family 不再落入 POSIX `-i -l -c` 分支。
- 2026-05-08 23:30 +0800：`npm run typecheck`、`npm run test:terminal-shell-configuration`、`npm run test:agent-cli-resolver`（当前非 Windows 环境跳过 Windows 专项断言）、`node -c tests/vscode-smoke/extension-tests.cjs`、`npm run build` 与 `git diff --check` 通过；`tests/vscode-smoke/extension-tests.cjs` 现已要求裸命令名 cache key 按 workspace `cwd` 隔离。
- 2026-05-09：`npm run test:shell-environment-resolver` 通过；当时新增所有平台 `Terminal` target 跳过 shell env patch 的断言，用于防止 POSIX rc/profile 或非 Windows PowerShell profile 被离线 probe 与真实 Terminal 启动重复应用。随后同日复盘 VS Code 原生 Terminal 后，本计划已改为平台感知混合方案，并由后续证据覆盖新的 POSIX 默认继承口径。
- 2026-05-09：`npm run typecheck`、`npm run test:terminal-shell-configuration`、`npm run test:agent-cli-resolver`（当前非 Windows 环境跳过 Windows 专项断言）、`npm run build`、`node -c tests/vscode-smoke/windows-real-codex-smoke.cjs`、`node -c tests/vscode-smoke/extension-tests.cjs`、`node -c scripts/test-shell-environment-resolver.mjs` 与 `git diff --check` 通过。
- 2026-05-09 18:55 +0800：`node scripts/test-shell-environment-resolver.mjs`、`node scripts/test-terminal-shell-configuration.mjs`、`npm run typecheck`、`npm run build`、`npm run test:agent-cli-resolver`（当前非 Windows 环境跳过 Windows 专项断言）、`node -c tests/vscode-smoke/extension-tests.cjs` 与 `git diff --check` 通过；新增覆盖 POSIX `Terminal` 默认继承、inheritEnv opt-out、login-only probe mode，以及 Terminal shell args 规范化。

## 接口与依赖

新模块会以 Node 内置能力为主，不引入第三方库。至少需要一个返回结构，明确告诉宿主：

- 当前是否解析出了 shell env patch
- patch 来源是 `posix-login-shell`、`powershell`、`windows-shell` 或 `none`
- patch 对应的 shell family 是 `posix`、`powershell`、`cmd`、`unsupported` 或 `undefined`
- patch 中实际生效了哪些 key
- 如果有错误，错误摘要是什么

`CanvasPanelManager` 最终必须持有一条“已解析 execution env”的统一入口，使 `Agent` 的 resolver、`Agent` 的 spawn 与 runtime supervisor createSession 可以共用它，同时让 `Terminal` 按平台和配置选择 base env：Windows 跳过预应用 patch，POSIX 默认继承 login-only shell env patch，`devSessionCanvas.terminal.inheritEnv=false` 时回退 base env。Terminal launch spec 还必须包含 `devSessionCanvas.terminal.shellArgs` 提供的 argv，避免继续固定 `args: []`。

本次更新说明：2026-05-07 新建本计划，先完成 macOS / Linux shell env 继承，再于 2026-05-08 借助本机已安装的 MSYS2 继续收口 Windows 路线，并在 review 轮次中补上“`Terminal` 不预应用 shell env patch”与“相对 `terminal.shellPath` probe 复用 workspace `cwd`”两条收口；当前计划已把技术债从“Windows 整条路线未实现”收窄为“少量更少见的 Windows POSIX family shell 名称仍缺真实 smoke 覆盖”。

本次更新说明：2026-05-08 根据 review 继续收口两条确定性问题：非 Windows PowerShell shell env probe 改走 PowerShell 专用分支，Agent CLI cache 改为进程内且按 workspace `cwd` 隔离，避免跨 repo / 跨窗口复用旧绝对路径。

本次更新说明：2026-05-09 根据 review 曾将 `Terminal` launch 的 target gating 扩展到所有平台，以避免 macOS / Linux POSIX rc/profile 或非 Windows PowerShell profile 在离线 probe 和真实交互 shell 启动中被重复应用；随后复盘 VS Code 原生 Terminal 后，本计划已用平台感知混合方案替代这条过宽结论。

本次更新说明：2026-05-09 复盘 VS Code 原生 Terminal 后改为混合方案；本轮已实现 POSIX Terminal 默认继承 shell env、Windows Terminal 继续跳过、`devSessionCanvas.terminal.inheritEnv` opt-out、`devSessionCanvas.terminal.shellArgs` profile args 基础能力，以及 POSIX Terminal login-only probe cache，避免继续把“所有平台 Terminal raw base env”写成正式结论。
