# Agent 与 Terminal 的 shell 环境继承收口

本 `ExecPlan` 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘` 这几个章节。

当前文档必须按 `docs/PLANS.md` 的要求持续维护。

## 目标与全局图景

完成后，三端桌面宿主都应有一条明确、可诊断的 execution env 继承路线。macOS / Linux 继续沿用“登录 shell -> 受控 patch -> execution env”的现有收口；Windows 则补上一条等价但不伪装成 POSIX 登录 shell 的路线：宿主基于当前配置/默认 Terminal shell 解析出受控环境增量，再把同一份 patch 同时用于 `Agent` resolver、`Agent` spawn 和嵌入式 `Terminal` spawn。用户可以直接观察到：插件里的 `codex`、`node`、`pnpm`、`volta` 等工具链命令不再出现“resolver 能找到入口脚本，但子进程里解释器缺失”的分叉失败，且 host diagnostics 会明确记录当前实际使用了哪条 shell env 路线。

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

## 结果与复盘

- 已完成：`src/panel/shellEnvironmentResolver.ts` 现在已经同时支持三条桌面路线：macOS / Linux 的登录 shell、Windows PowerShell / cmd，以及 Windows 下名称可判定为 POSIX 家族的 shell。它会统一产出受控 env patch，并在 Windows 上处理 `PATH` / `PATHEXT` 与环境变量大小写不敏感问题。
- 已完成：host diagnostics 现在会显式记录 shell env patch 来源、`shellFamily`、skip reason、shell 路径、应用到的 key 和错误摘要，后续排查 GUI 环境缺工具链时不再只能靠截图倒推。
- 已完成：`CanvasPanelManager` 现在会把 shell env patch 显式绑定到当前配置/默认 Terminal shell，并在 `devSessionCanvas.terminal.shell`、`devSessionCanvas.terminal.shellPath` 或 `vscode.env.shell` 变化时刷新缓存；`Agent` resolver、`Agent` / `Terminal` spawn 与 runtime supervisor createSession 继续共用同一份 execution env。
- 已完成：正式设计文档、技术债和自动化验证已同步更新；`npm run test:shell-environment-resolver`、`npm run test:agent-cli-resolver`、`npm run typecheck`、`npm run build`、`npm run test:smoke:windows-real-codex` 与 `git diff --check` 均已通过。其中 Windows real smoke 现在覆盖默认 `codex`、显式 `codex.cmd`、`powershell`、`cmd`、Git Bash、MSYS2 `bash` 与 MSYS2 `sh` 七类场景。
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

现状已经完成 POSIX 路线，因此本轮重点改 Windows。要在保留现有 POSIX 行为与 `file + args[]` 结构化执行路径的前提下，为 Windows 增加一条“按当前 Terminal shell 解析环境快照 -> 提取受控 patch -> 复用到 execution env”的路线。优先覆盖 `powershell.exe` / `cmd.exe`，并在 shell 名称可判定为 `bash` / `zsh` / `sh` / `fish` 等 POSIX 家族时复用已有登录 shell 解析逻辑。随后把 `CanvasPanelManager` 的 shell env patch 缓存改成会受 Terminal shell 变化影响，再补 Windows 定向测试、设计文档和技术债收口。

## 具体步骤

1. 扩展 `src/panel/shellEnvironmentResolver.ts`：
   - 保留现有 POSIX 登录 shell 解析；
   - 为 Windows 增加 PowerShell / cmd / Windows 下 POSIX shell 的环境快照读取；
   - 让 patch 过滤、`PATH` 合并和大小写处理兼容 Windows 的大小写不敏感环境变量；
   - 在成功 / 跳过 / 失败时继续产出可诊断元数据。
2. 修改 `src/panel/CanvasPanelManager.ts`：
   - 让 shell env patch 解析显式依赖当前配置/默认 Terminal shell；
   - 在 Terminal shell 配置或 VS Code 默认 shell 变化时使缓存失效；
   - 保持 `resolveAgentCli(...)`、`buildAgentLaunchSpec(...)`、`buildTerminalLaunchSpec(...)` 和 runtime supervisor 继续共用同一份 execution env。
3. 必要时调整 `src/panel/agentCliResolver.ts`，确保 Windows 上对 `PATH` / `PATHEXT` 的读取能和新 execution env 对齐，而不是依赖大小写巧合。
4. 新增脚本级回归，至少覆盖：
   - Windows shell env patch 会保留 `PATH` 外的工具链变量；
   - `USERPROFILE` / `HOME` / `PROMPT` / `TERM` 等禁用变量不会被 patch 覆盖；
   - Windows `PATH` 合并不会吃掉 host 额外前置的测试目录；
   - `VSCODE_CLI=1` 会继续跳过 shell env 解析；
   - 如当前环境可用，再补真实 Windows shell 或真实 Codex smoke 证据。
5. 更新设计文档、索引、技术债和本计划，把 Windows 路线的正式口径与剩余缺口写清楚。

## 验证与验收

- 运行 `npm run typecheck`，预期通过。
- 运行 `npm run build`，预期通过。
- 运行新增的 shell environment resolver 脚本级回归，预期通过。
- 在 Windows 环境运行 `npm run test:agent-cli-resolver`，预期通过。
- 如果当前机器具备真实 `Codex`、VS Code、Git Bash 与 MSYS2，可运行 `npm run test:smoke:windows-real-codex`，预期同时证明默认 `codex` / 显式 `.cmd`、`powershell`、`cmd`、Git Bash、MSYS2 `bash` 与 MSYS2 `sh` 场景都会把 shell env patch 绑定到当前 Terminal shell，并渲染出真实终端输出。
- 如实现中新增或调整现有脚本，再补 `git diff --check`，预期无 whitespace / conflict 类问题。
- 验收时至少应能明确说明：macOS / Linux 与 Windows 上的 `Agent` / `Terminal` launch env 都已与 resolver 共享同一份 shell-derived patch；若 Windows 仍有剩余边界，必须把它收窄到具体 shell / 具体验证缺口，而不是继续笼统写成“整条路线未实现”。

## 幂等性与恢复

- shell env 解析只读用户环境，不写入用户 shell 配置或 provider 配置目录；失败时必须 fail open，继续回退到当前 `process.env` 基线。
- 新增缓存只存在于当前 Extension Host 生命周期内；重载窗口后可以重新解析，不要求跨窗口持久化。
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
- 2026-05-07：`git diff --check` 通过。

## 接口与依赖

新模块会以 Node 内置能力为主，不引入第三方库。至少需要一个返回结构，明确告诉宿主：

- 当前是否解析出了 shell env patch
- patch 来源是 `posix-login-shell`、`windows-shell` 或 `none`
- patch 对应的 shell family 是 `posix`、`powershell`、`cmd`、`unsupported` 或 `undefined`
- patch 中实际生效了哪些 key
- 如果有错误，错误摘要是什么

`CanvasPanelManager` 最终必须持有一条“已解析 execution env”的统一入口，使 `Agent` 的 resolver、`Agent` 的 spawn、`Terminal` 的 spawn 与 runtime supervisor createSession 可以共用它，而不是各自再读取一遍 `process.env`。

本次更新说明：2026-05-07 新建本计划，先完成 macOS / Linux shell env 继承，再于 2026-05-08 借助本机已安装的 MSYS2 继续收口 Windows 路线；当前计划已把技术债从“Windows 整条路线未实现”收窄为“少量更少见的 Windows POSIX family shell 名称仍缺真实 smoke 覆盖”。
