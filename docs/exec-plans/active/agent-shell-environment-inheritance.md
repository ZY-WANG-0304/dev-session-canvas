# Agent 与 Terminal 的 shell 环境继承收口

本 `ExecPlan` 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘` 这几个章节。

当前文档必须按 `docs/PLANS.md` 的要求持续维护。

## 目标与全局图景

完成后，在 macOS / Linux 上从 GUI 启动 VS Code 时，`Agent` 与嵌入式 `Terminal` 会更接近 VS Code 原生 Terminal 的环境继承方式：宿主先用登录 shell 解析用户环境，再把一份受控的 shell env patch 合并到实际启动环境里。用户可以直接观察到：插件里的 `codex`、`node`、`pnpm`、`volta` 等工具链命令不再出现“resolver 能找到入口脚本，但子进程里解释器缺失”的分叉失败；同时 `Windows` 相关差异不会被误写成已解决，而是留在正式文档与技术债中等待后续在 Windows 环境里实现。

## 进度

- [x] (2026-05-07 10:32 +0800) 阅读 `docs/WORKFLOW.md`、`docs/PLANS.md`、`docs/DESIGN.md`、`docs/design-docs/agent-cli-launch-context-and-resume.md` 与 `docs/design-docs/execution-session-platform-compatibility.md`，确认本任务需要同时更新正式设计、技术债和实现。
- [x] (2026-05-07 11:28 +0800) 新增并接线 POSIX shell environment resolver，形成“受控 shell env patch + launch env 复用”的宿主能力。
- [x] (2026-05-07 11:44 +0800) 让 `Agent` / `Terminal` 的 resolver 与真实 spawn 共用同一份 execution env，并补诊断信息。
- [x] (2026-05-07 12:05 +0800) 更新设计文档、设计索引与技术债记录，明确 Windows 环境处理仍待后续实现。
- [x] (2026-05-07 12:12 +0800) 运行自动化验证并在本计划中补齐证据。

## 意外与发现

- 观察：本轮开始时，仓库虽然已经给 `Agent` 做了“命令发现”层的 POSIX 登录 shell 探测，但真正 spawn 进程时仍然直接使用 Extension Host 的 `process.env`。
  证据：起步时的 `src/panel/agentCliResolver.ts` 会在 POSIX 上运行 `shell -lc 'command -v ...'`；而当时的 `CanvasPanelManager` 仍只基于 `process.env` 组装启动环境。

- 观察：VS Code 原生的 shell env 解析在官方实现里只在 macOS / Linux 上运行，并且会跳过 Windows 与 `VSCODE_CLI=1` 的场景。
  证据：`src/vs/platform/shell/node/shellEnv.ts` 当前主线实现里，`getResolvedShellEnv()` 会对 Windows 和 `isLaunchedFromCli(env)` 直接返回空结果。

- 观察：如果 execution env 直接用 shell 返回值裸覆盖 `PATH`，会把宿主为 test harness 前置的 fake CLI 目录吃掉，导致自动化漂移。
  证据：`CanvasPanelManager.buildBaseExecutionEnvironment()` 在 test harness 模式下会把 `DEV_SESSION_CANVAS_TEST_CODEX_COMMAND` / `DEV_SESSION_CANVAS_TEST_CLAUDE_COMMAND` 所在目录前置到 `PATH`；因此最终实现必须对 `PATH` 做“保留 host 额外目录 + shell 主体顺序优先”的合并。

## 决策记录

- 决策：本轮不把 `Agent` 执行改成“整条命令交给 shell 解释”，而是继续保持 `node-pty.spawn(file, args)` 的结构化执行路径，只把“环境发现”和“环境复用”对齐到更接近 VS Code 原生的模式。
  理由：仓库已有正式设计明确要求执行主路径保持结构化 `file + args[]`，这样才能避免 shell 注入、跨平台 quoting 漂移与 provider 自定义命令再次被 shell 二次解释。
  日期/作者：2026-05-07 / Codex

- 决策：shell env 不直接 wholesale 替换 `process.env`，而是以“diff patch + denylist 过滤 + `PATH` 特殊合并”的方式进入 execution env。
  理由：这样既能同步 `PATH`、`NVM_DIR` 和自定义工具链变量，又不会覆写 `HOME`、`PWD`、`TERM`、`ELECTRON_*`、`VSCODE_*` 等不应被执行节点接管的变量，也能保住 test harness 人为前置的 fake CLI 目录。
  日期/作者：2026-05-07 / Codex

## 结果与复盘

- 已完成：macOS / Linux 现在新增 `src/panel/shellEnvironmentResolver.ts`，会按“跳过 Windows、跳过 `VSCODE_CLI=1`、登录 shell 取环境、提取受控 patch、合并到 execution env”的路线工作。`CanvasPanelManager` 已改成统一通过异步 execution env 入口给 `Agent` resolver、`Agent` spawn、`Terminal` spawn 和 runtime supervisor createSession 供环境，避免再次出现 resolver 与实际运行环境分叉。
- 已完成：host diagnostics 现在会显式记录 shell env patch 来源、skip reason、shell 路径、应用到的 key 和错误摘要，后续排查 GUI 环境缺工具链时不再只能靠截图倒推。
- 已完成：正式设计文档与技术债都已同步；Windows 相关环境处理没有被误写成已解决，而是继续登记为后续实现。
- 剩余：Windows 的等价 shell env / shim 处理策略仍待在真实 Windows 环境里实现与验证；本轮只定义了文档边界，没有提前假装它已经完成。

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

先新增一个独立的 POSIX shell environment resolver 模块，参考 VS Code 原生 `shellEnv.ts` 的思路：只在 macOS / Linux 上运行，跳过 `VSCODE_CLI=1`，通过登录 shell 启动 `process.execPath -p 'JSON.stringify(process.env)'` 抓取 shell 解析后的环境。接着把它收口成“受控 patch + merge 规则”的 API，并让 `CanvasPanelManager` 统一通过这份 API 生成 execution env。然后把 `Agent` 的 CLI resolver、`Agent`/`Terminal` 的本地 PTY launch，以及 runtime supervisor createSession 全部改成复用同一份 env。最后更新设计文档和技术债，把 Windows 处理明确记录为 follow-up。

## 具体步骤

1. 新增 `src/panel/` 下的 shell environment resolver 模块，提供：
   - POSIX shell env 解析
   - 受控 patch 过滤
   - `PATH` 合并规则
   - 诊断元数据
2. 修改 `src/panel/CanvasPanelManager.ts`：
   - 把现有同步 `buildExecutionEnvironment()` 拆成“基线 env”和“异步 resolved execution env”。
   - 让 `resolveAgentCli(...)`、`buildAgentLaunchSpec(...)` 与 `buildTerminalLaunchSpec(...)` 都接受同一份 env。
   - 补 shell env 解析结果的缓存与诊断输出。
3. 为 runtime supervisor 路径确认无需单独改协议，只需要继续复用 host 侧已经合并好的 env。
4. 新增脚本级回归，至少覆盖：
   - shell env patch 会保留 `PATH` 外的工具链变量；
   - `HOME` / `TERM` / `PWD` 等禁用变量不会被 patch 覆盖；
   - `PATH` 合并不会吃掉 host 额外前置的测试目录；
   - `VSCODE_CLI=1` 会跳过 POSIX shell env 解析。
5. 更新设计文档、索引和技术债，并把 Windows follow-up 写清楚。

## 验证与验收

- 运行 `npm run typecheck`，预期通过。
- 运行 `npm run build`，预期通过。
- 运行新增的 shell environment resolver 脚本级回归，预期通过。
- 如实现中新增或调整现有脚本，再补 `git diff --check`，预期无 whitespace / conflict 类问题。
- 验收时至少应能明确说明：macOS / Linux 上的 `Agent` / `Terminal` launch env 已与 resolver 共享同一份 shell-derived patch；Windows 仍保持原状并已在文档登记为后续实现。

## 幂等性与恢复

- shell env 解析只读用户环境，不写入用户 shell 配置或 provider 配置目录；失败时必须 fail open，继续回退到当前 `process.env` 基线。
- 新增缓存只存在于当前 Extension Host 生命周期内；重载窗口后可以重新解析，不要求跨窗口持久化。
- 文档更新和技术债登记可重复执行，不影响运行时状态。

## 证据与备注

- 2026-05-07：`npm run typecheck` 通过。
- 2026-05-07：`npm run build` 通过。
- 2026-05-07：`node scripts/test-shell-environment-resolver.mjs` 通过。
- 2026-05-07：`npm run test:shell-environment-resolver` 通过。
- 2026-05-07：`npm run test:agent-cli-resolver` 在非 Windows 平台按预期输出 `agentCliResolver tests skipped on non-Windows platform`。
- 2026-05-07：`git diff --check` 通过。

## 接口与依赖

新模块会以 Node 内置能力为主，不引入第三方库。至少需要一个返回结构，明确告诉宿主：

- 当前是否解析出了 shell env patch
- patch 来源是 `posix-login-shell`、`skipped` 还是 `fallback`
- patch 中实际生效了哪些 key
- 如果有错误，错误摘要是什么

`CanvasPanelManager` 最终必须持有一条“已解析 execution env”的统一入口，使 `Agent` 的 resolver、`Agent` 的 spawn、`Terminal` 的 spawn 与 runtime supervisor createSession 可以共用它，而不是各自再读取一遍 `process.env`。

本次更新说明：2026-05-07 新建本计划，用于收口“macOS/Linux 对齐 VS Code 原生 shell 环境继承；Windows 先登记后续实现”的设计与落地路径。
