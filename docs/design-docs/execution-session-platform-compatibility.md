---
title: 执行会话平台兼容性设计
decision_status: 已选定
validation_status: 验证中
domains:
  - VSCode 集成域
  - 执行编排域
  - 协作对象域
architecture_layers:
  - 宿主集成层
  - 共享模型与编排层
  - 适配与基础设施层
related_specs:
  - docs/product-specs/canvas-core-collaboration-mvp.md
related_plans:
  - docs/exec-plans/completed/execution-session-platform-compatibility.md
  - docs/exec-plans/active/agent-shell-environment-inheritance.md
updated_at: 2026-05-08
---

# 执行会话平台兼容性设计

## 1. 背景

当前仓库已经把 `Terminal` 与 `Agent` 收敛为画布内的嵌入式会话窗口，但现有宿主后端最初是围绕 Linux `script` 原型闭合主路径的。这条路线帮助原型快速落地，却把平台能力和运行中 resize 一起锁死在 Linux / 类 Unix 语义上。

现在的用户目标已经明确收敛为：

- Linux、macOS、Windows 本地都能直接启动嵌入式 `Terminal` / `Agent`，并进入同一条后端主线。
- 桌面三平台的可用性结论必须和验证证据一起升级，而不是继续停留在“代码路径已接通”。
- 即使 Windows 当前轮次已经拿到主路径验证证据，剩余已知限制也必须单独写清楚，不能把它包装成“已经没有差异”。

## 2. 问题定义

本轮需要回答的问题是：

1. 当前执行会话后端应该继续围绕 `script` 分平台扩展，还是直接收敛到统一 PTY 抽象。
2. 在优先支持 Linux / macOS 的前提下，怎样同时为 Windows 预留尽量一致的主路径，而不是继续堆平台特判。
3. 哪些平台结论已经有实现和验证证据，哪些可以升级为“已验证可用”，剩余已知限制应如何记录。
4. 当 Extension Host 的 `PATH` 与用户交互 shell 不一致时，怎样更稳健地定位本地编程 CLI，而不是把命令发现完全外包给手填设置。

## 3. 目标

- 让 `Terminal` 与 `Agent` 的宿主会话后端共享统一抽象，而不是把平台判断散落在 `CanvasPanelManager` 中。
- 让 Linux 与 macOS 进入同一条已实现的嵌入式 PTY 主路径。
- 在不额外分叉运行时模型的前提下，让 Windows 也尽量复用同一后端能力。
- 让运行中 resize 成为后端原生能力，而不是继续依赖“仅首帧 fit”这种临时退化。
- 让 `Agent` 的本地编程 CLI 定位不再只依赖当前 Extension Host 进程 PATH。

## 4. 非目标

- 不在本轮承诺所有远程宿主都已经完成人工验证；`Remote SSH` 可作为已验证主路径，但 Codespaces 等更深远程场景仍不在当前承诺内。
- 不在本轮把 Windows 写成“完全没有已知限制”的稳定支持。
- 不在本轮为不同平台分别维护多套长期共存的后端实现。
- 不在本轮追求浏览器形态或 `vscode.dev` 兼容。

## 5. 候选方案

### 5.1 继续围绕 `script` 扩展类 Unix 路线

特点：

- Linux 继续使用当前 util-linux `script`。
- macOS 再单独适配 BSD `script` 参数差异。
- Windows 仍需要额外引入 ConPTY / winpty 路线。

不选原因：

- 这条路线无法真正收敛平台复杂度，只是把“一个 Linux 原型”变成“两套类 Unix 分支 + 一套 Windows 分支”。
- `Agent` / `Terminal` 的生命周期、resize、kill 和错误处理最终仍会继续堆平台特判。

### 5.2 统一切到 `node-pty`

特点：

- 宿主统一通过 `node-pty` 建立真实 PTY。
- `Terminal` 直接启动 shell；`Agent` 直接启动 provider CLI。
- Webview 继续使用 `xterm.js`，只替换宿主后端。

优点：

- Linux、macOS、Windows 都可复用同一套 `spawn / write / resize / kill / onData / onExit` 模型。
- 运行中 resize 可以直接交给 PTY 后端，而不再污染前台程序输入流。
- `CanvasPanelManager` 可以收敛为状态编排者，把平台细节下沉到单独 bridge。

风险：

- 会引入原生 Node 模块，需要处理扩展打包与运行时加载。
- Windows 下 provider CLI 的 PATH、`.cmd` / `.exe` 解析与剩余交互限制仍需持续补齐证据。

## 6. 正式方案

当前正式方案如下：

- 执行会话后端从 Linux `script` 原型迁移到统一 `node-pty` 路线。
- Linux、macOS、Windows 本地 workspace 现在都走统一 `node-pty` 主路径，并已完成功能可用性验证。
- Windows 仍保留一条显式已知限制：使用 `Codex` 时，执行节点内历史当前无法向上翻页；这条差异必须继续写在对外文案与技术债中。
- `Terminal` 与 `Agent` 共用同一个宿主会话 bridge；差别只在于启动命令和节点语义。
- `src/panel/CanvasPanelManager.ts` 需要通过统一 execution env 入口为 `Agent` 与 `Terminal` 组装启动环境，而不是让 resolver、local PTY 与 runtime supervisor 各自直接读取 `process.env`；其中 `Agent` 继续复用 shell-derived execution env，Windows `Terminal` 则保留 base env 让真实 shell 自己执行 profile / AutoRun 一次。
- `src/panel/shellEnvironmentResolver.ts` 当前已经为桌面三平台提供受控 shell env 继承：
  - macOS / Linux：在 `VSCODE_CLI=1` 之外的 GUI 场景读取 shell 环境；POSIX family shell 走登录 shell probe，`pwsh` / `powershell` 走 PowerShell 专用 probe，避免把 PowerShell 误送入 POSIX `-i -l -c` 命令串。
  - Windows：以当前配置/默认 Terminal shell 为准；`powershell.exe` / `cmd.exe` 走各自环境快照解析，名称可判定为 `bash` / `zsh` / `sh` / `fish` 的 Windows shell 复用登录 shell 解析。这份 patch 供 `Agent` resolver / spawn 使用，同时保留给 host diagnostics 与排障。
- 这份 shell env patch 不直接 wholesale 替换 Extension Host 环境；它只在保留宿主基线、`TERM`/`COLORTERM` 约束和少量显式注入目录的前提下，同步 `PATH`、`PATHEXT` 与工具链相关变量，并排除 `HOME`、`USERPROFILE`、`HOMEDRIVE`、`HOMEPATH`、`PWD`、`PROMPT`、`TERM`、`ELECTRON_*`、`VSCODE_*` 等不应被执行节点接管的键。`PATH` 合并需要保持 shell 导出的主体顺序优先：普通 host-only 目录追加在 shell `PATH` 之后，只有宿主显式注入且要求保优先级的目录（例如 test harness CLI 目录）可以继续排在前面。
- shell env patch 的缓存与当前 Terminal shell 和 workspace root 绑定；当 `devSessionCanvas.terminal.shell`、`devSessionCanvas.terminal.shellPath`、`vscode.env.shell` 或 workspace root 变化时，宿主必须刷新缓存，不能继续沿用旧 shell / 旧 repo 的环境快照。
- 如果 `terminal.shellPath` 是相对路径，则 `terminalShellConfiguration` 的配置检查与 `shellEnvironmentResolver` 的 env probe 必须共享同一套 workspace `cwd` 解析基准，不能一边判定可用、一边在 `spawn` 时稳定 `ENOENT`。
- 与此同时，宿主诊断必须至少记录 shell env patch 的 `source`、`shellFamily`、`shellPath` 与 `appliedKeys`/失败摘要；非 Windows PowerShell 使用 `source=powershell`，Windows 使用 `source=windows-shell` 并通过 `shellFamily` 区分当前对齐的是 PowerShell、`cmd.exe`、Git Bash、MSYS2，还是其它 POSIX family shell。
- `Agent` provider CLI 的命令发现采用宿主侧 resolver，而不是把裸命令名直接交给 PTY：
  - 显式设置优先
  - 最近成功解析的绝对路径缓存次之，但这层缓存只存在于当前 Extension Host 生命周期内，并必须同时绑定当前 shell authority 与规范化 workspace `cwd`；切换 shell、切换 repo 或重载窗口后，不能继续命中旧 shell / 旧 workspace 解析出的 CLI 路径
  - 当前宿主 `PATH` 再次之
  - POSIX 登录 shell 探测、Windows `where.exe` / `Get-Command` 与常见包装后缀作为最后自动回退
- 这层缓存只服务一次 Extension Host 生命周期内的重复解析；显式配置路径是用户决策，自动解析出的绝对路径只是当前环境观测值。用户通过安装工具链、修改 shell profile、启用 direnv / Nix 后，Reload Window 或重启 VS Code 应触发重新 probe 当前可见环境，而不是继续使用旧持久化路径。
- 宿主当前通过最小 PTY bridge 暴露：
  - 创建会话
  - 写入输入
  - 运行中 resize
  - 停止会话
  - 订阅输出
  - 订阅退出事件

## 7. 风险与取舍

- 取舍：接受原生 PTY 依赖，换取平台收敛和真实 resize。
  原因：用户已经不再满足于“Linux 原型可跑”，而是明确要求 Linux / macOS 为主、Windows 尽量兼容。

- 风险：Windows 下 `codex` / `claude` 这类命令若通过 npm 全局安装，常见入口可能是 `.cmd` / `.exe` 包装；同时，Windows 上使用 `Codex` 时执行节点内历史仍存在无法向上翻页的已知限制。macOS / Linux 从 GUI 启动 VSCode 时，Extension Host 的环境也可能和交互 shell 不一致。
  当前缓解：桌面三平台现在都要求 `Agent` 的 resolver 与 spawn 共用同一份 execution env。macOS / Linux 通过登录 shell patch 对齐 GUI 启动环境；Windows 则通过当前 Terminal shell 的 PowerShell / cmd / POSIX shell 快照对齐 `.cmd` / shebang / shim 所需的解释器路径，但只把这份 patch 预应用到 `Agent`，`Terminal` launch 保留 base env 以避免 profile / AutoRun 双重应用；相对 `terminal.shellPath` 的 probe 也已与配置检查对齐到同一 workspace `cwd`。当前剩余技术债已收窄为 Windows `Codex` 历史翻页问题，以及少量更少见的 Windows POSIX family shell 名称仍缺真实 smoke 证据。

- 风险：Remote SSH / Codespaces 的 Extension Host 与 Webview 仍然跨端运行，平台兼容并不自动等于所有远程宿主都已收口。
  当前缓解：`Remote SSH` 主路径已按当前轮支持口径升级为“已验证可用”；但 Codespaces 与其他更深远程场景仍继续保留为待补验证，不把它们误写成已完成。

## 8. 验证方法

至少需要完成以下验证：

1. `npm run typecheck` 与 `npm run build` 通过。
2. 在当前 Linux 环境中，用 `node-pty` 启动 shell 后，子进程 `stdin/stdout` 都表现为 TTY。
3. 在本地 VSCode 中，Linux / macOS 至少各完成一次 `Terminal` 与 `Agent` 节点人工 smoke test。
4. Windows 本地至少完成一次真实 `Agent` / `Terminal` 人工 smoke test，并把剩余已知限制显式记录到发布文案与技术债。
5. Webview 尺寸变化后，活跃会话行列能够同步更新，而不是只在启动前生效。
6. 至少完成一次“CLI 已安装但当前 Extension Host PATH 不直达”的命令发现验证，确认宿主侧 resolver 能定位到目标 CLI。
7. 至少完成一条自动化验证，证明 execution env 不再只依赖 Extension Host `process.env`，而是会把 shell 导出的受控 patch 同步到 `Agent` 启动环境；其中 Windows 还要覆盖 `PATHEXT` 或 profile / AutoRun 驱动的环境增量，并证明 `Terminal` launch 不会预应用这份 patch；非 Windows 还要覆盖 `pwsh` / `powershell` 不会落入 POSIX probe。
8. 若 `terminal.shellPath` 支持相对路径，至少完成一条验证证明配置检查与 env probe 共享同一套 workspace `cwd` 基准，不会出现 UI 认定可用、probe 却因 `ENOENT` 静默回退的分叉。Agent CLI cache 还要验证裸命令名按 workspace `cwd` 隔离，不能跨 repo 复用旧绝对路径。
9. 若某类 Windows shell 仍缺真实验证或存在未收口边界，必须把缺口收窄到具体 shell / 具体场景，并在设计文档与技术债中显式标注，不得再笼统写成“Windows 路线未对齐”。

## 9. 当前验证状态

- 已完成 `npm run typecheck` 与 `npm run build`。
- 已完成 Linux 本地 `node-pty` TTY smoke test，确认子进程具备真实 PTY 语义。
- 截至 `2026-04-28`，Linux、macOS、Windows 本地 workspace 的 `Agent` / `Terminal` 主路径已补齐当前轮功能可用性验证。
- 2026-05-07 已补 `node scripts/test-shell-environment-resolver.mjs`，覆盖 macOS / Linux 与 Windows shell env patch 的过滤规则、`PATH` / `PATHEXT` 合并、`VSCODE_CLI=1` 跳过逻辑，以及 PowerShell profile 驱动的 Windows env patch；同日 `npm run typecheck` 与 `npm run build` 通过。
- Windows 下使用 `Codex` 时，执行节点内历史当前仍有无法向上翻页的已知限制；文档状态继续保持为“验证中”，直到这条剩余差异与更深的远程场景验证也完成收口。
- 2026-05-08 已按 review 补齐 Windows `Terminal` target、相对 `terminal.shellPath` probe、非 Windows PowerShell probe 与 Agent CLI cache workspace 隔离回归：`node scripts/test-shell-environment-resolver.mjs` 现已覆盖 Windows `Terminal` launch 跳过预应用 patch、相对 shell 路径复用 workspace `cwd`，以及 fake `pwsh` 走 PowerShell probe；`tests/vscode-smoke/extension-tests.cjs` 也已要求裸命令名 cache key 按 workspace `cwd` 隔离。同轮 `npm run typecheck`、`npm run build`、`npm run test:terminal-shell-configuration`、`npm run test:agent-cli-resolver`、`node -c tests/vscode-smoke/extension-tests.cjs` 与 `git diff --check` 均已通过。
- 2026-05-07/2026-05-08 已在真实 Windows 环境通过 `npm run test:agent-cli-resolver` 与扩充后的 `npm run test:smoke:windows-real-codex`，确认新的 execution env 路线可以覆盖 `Path` 大小写回归，以及默认 `codex`、显式 `codex.cmd`、`powershell`、`cmd`、Git Bash、MSYS2 `bash` 与 MSYS2 `sh` 七类真实 Agent 启动 / shell 对齐场景。
- 截至 `2026-04-28`，`Remote SSH` 主路径已补齐当前轮功能可用性验证。
- Codespaces 与其他更深远程场景的人工验证证据仍需继续补齐，因此这些场景保持为“验证中”。
