---
title: 嵌入式 Terminal shell 选择与精确路径锁定
decision_status: 已选定
validation_status: 已验证
domains:
  - VSCode 集成域
  - 执行编排域
  - 项目状态域
architecture_layers:
  - 宿主集成层
  - 共享模型与编排层
  - 适配与基础设施层
related_specs:
  - docs/product-specs/canvas-core-collaboration-mvp.md
related_plans:
  - docs/exec-plans/completed/execution-terminal-shell-selection.md
updated_at: 2026-05-05
---

# 嵌入式 Terminal shell 选择与精确路径锁定

## 1. 背景

嵌入式 `Terminal` 节点已经需要支持三类看起来相似、但产品语义不同的 shell 选择方式：

1. 跟随宿主当前默认 shell。
2. 在设置里按 shell 类型选择，例如 `bash`、`zsh`、`pwsh`。
3. 在当前设备已经探测到的真实可执行路径里，精确选中某一个副本。

最近这一轮功能把第 1、2 类能力接通后，又新增了 `Dev Session Canvas: 选择 Terminal shell` 命令，希望补齐第 3 类“从当前设备真实可用路径中挑一个”的路径。但 review 明确指出，当前实现如果用户在 Quick Pick 里选择的是 `bash` / `zsh` / `pwsh` 这类已识别 shell，扩展会只写回 `devSessionCanvas.terminal.shell=<name>` 并清空 `devSessionCanvas.terminal.shellPath`；下一次启动时又会重新按 `PATH` 或 well-known path 解析，导致机器上存在多个同名 shell 时，实际启动的二进制可能不是用户刚才选中的那个。

因此，本轮需要把“按 shell 类型配置”和“按精确路径锁定某一个 shell 副本”这两层语义正式分开，并写清楚 VS Code 设置 UI 与命令式动态探测之间各自负责什么。

## 2. 问题定义

本轮要解决的问题不是“是否继续补几个 shell 名称”，而是以下三个边界：

1. VS Code 设置项里的下拉选项，能否直接按当前设备环境动态枚举真实 shell 路径。
2. 如果不能，仓库应该怎样同时提供“设置里可选的固定 shell 类型”和“命令里从当前设备真实路径中精确选择”的两条路径。
3. 当用户已经显式挑中了某个具体 shell 路径时，扩展是否允许在下一次启动时退回到同名 shell 的另一个副本。

本轮的正式结论必须让用户可观察行为保持一致：设置项负责“选哪一类 shell”，命令负责“锁定当前设备上的哪一个具体可执行路径”，两者不能互相冒充。

## 3. 目标

- `devSessionCanvas.terminal.shell` 继续作为设置里的固定选项，表达 shell 类型而不是某个具体路径。
- `devSessionCanvas.terminal.shell` 与 `devSessionCanvas.terminal.shellPath` 同时支持设备级默认值和 workspace 级覆盖。
- `Dev Session Canvas: 选择 Terminal shell` 命令必须基于当前设备真实可用的 shell 路径做动态探测。
- 当用户在命令里选中某个具体路径时，扩展必须把该精确路径持久化到 `devSessionCanvas.terminal.shellPath`，不能只保留 shell 名称。
- 如果所选路径对应的 basename 能映射到已支持的 shell 类型，扩展可以同步保留该逻辑类型，但运行时优先级必须仍由 `terminal.shellPath` 决定。
- 当 `terminal.shell` 或 `terminal.shellPath` 在当前设备上不可用时，扩展要直接提示，并提供重新选择或打开设置的路径。

## 4. 非目标

- 不在本轮尝试把 VS Code 设置页里的 `enum` 选项改造成运行时动态枚举；这不是扩展贡献点当前支持的能力。
- 不要求命令自动发现所有系统上可能存在的任意自定义 shell。当前动态探测只覆盖默认 shell、`PATH`、`/etc/shells` 和 Windows 已知路径这几条正式来源；其它非常规命令仍允许用户手动填写 `terminal.shellPath`。
- 不在本轮把显式路径不可用时的行为改成“自动回退到同名 shell 的另一个副本”；显式路径的目标就是提供稳定、可预期的锁定语义。

## 5. 候选方案

### 5.1 只保留设置里的固定 shell 类型

特点：

- 用户只在 `terminal.shell` 里选择 `bash` / `zsh` / `pwsh` 等固定选项。
- 扩展每次启动都重新按设备环境解析对应路径。

不选原因：

- 这条路无法表达“当前设备上有两个 `bash`，我就要第二个”的需求。
- 一旦 `PATH` 顺序变化，实际启动路径就会漂移。
- 它无法满足当前命令文案里“从真实可用路径中挑选”的承诺。

### 5.2 命令仍然只写 shell 名称，不写精确路径

特点：

- Quick Pick 可以显示真实路径。
- 但落盘时只保留 `terminal.shell=<name>`，把路径视为一次性提示信息。

不选原因：

- 这正是当前 review 指出的主路径 bug。
- 它让“选择了 second/bash，下一次却跑到 first/bash”成为真实回归。
- 这种行为和 `terminal.shellPath` 已经存在的产品语义直接冲突。

### 5.3 采用两层配置：逻辑 shell 类型 + 精确路径覆盖

特点：

- 设置中的 `terminal.shell` 继续表达逻辑 shell 类型。
- 命令中的动态选择把精确路径写入 `terminal.shellPath`。
- 运行时始终优先使用 `terminal.shellPath`；为空时才按 `terminal.shell` 动态解析。

当前选择原因：

- 这同时满足了“设置里可以按选项配置”和“命令里从真实路径精确选择”两类诉求。
- 它和仓库现有的 `shellPath` 语义天然一致，不需要额外引入新的配置键。
- 它能稳定解决多个同名 shell 副本时的路径漂移问题。

## 6. 风险与取舍

- 取舍：命令选择具体路径后，运行时不再允许悄悄回退到 `PATH` 里另一个同名 shell。
  原因：一旦用户显式挑中了一个二进制，稳定性比“尽量猜一个还能跑的同名命令”更重要。

- 风险：设置页里 `terminal.shell` 仍是静态固定选项，不能随着设备环境即时增删。
  当前缓解：把动态枚举能力收口到命令，设计上明确“设置负责逻辑类型，命令负责精确路径”。

- 风险：命令选择后如果同时保留 `terminal.shell=<name>`，用户在设置页里只改 `terminal.shell` 而不清空 `terminal.shellPath`，实际生效的仍是路径覆盖。
  当前缓解：产品文案、设置描述和警告文案都明确 `terminal.shellPath` 优先；同步保留 shell 类型只是为了显示与手动回退时仍有上下文，而不是改变优先级。

- 风险：如果直接依赖 VS Code 对 `terminal.shell` 与 `terminal.shellPath` 逐键合并，workspace 级只改了 `terminal.shell` 时，设备级 `terminal.shellPath` 仍会继续生效，导致 workspace 覆盖失真。
  当前缓解：实现上把这两个键当成同一组配置解析；只要 workspace 级对其中任一键显式赋值，就整体切换到 workspace 级的 `terminal.shell` / `terminal.shellPath` 组合，并对未填写的那一半回退到 schema 默认值，而不是混入设备级另一半配置。

- 风险：动态探测来源是“默认 shell + PATH + `/etc/shells` / Windows 已知路径”，因此某些不在这些来源里的自定义 shell 不会自动出现在 Quick Pick 里。
  当前缓解：保留手动填写 `terminal.shellPath` 的路径，并把命令定位为“枚举当前设备上已知可用的正式来源”，而不是“扫描一切可能的二进制”。

## 7. 正式方案

### 7.1 配置分层语义

从本轮开始，嵌入式 Terminal 的 shell 配置采用两层语义：

- `devSessionCanvas.terminal.shell`：逻辑 shell 类型。它只表示“希望使用哪一类 shell”，例如 `bash`、`zsh`、`pwsh`，不承诺某个具体文件路径。
- `devSessionCanvas.terminal.shellPath`：精确命令路径覆盖。只要该值非空，运行时就直接使用这里的路径，而不是重新按 `terminal.shell` 解析。

这两层的优先级是固定的：`terminal.shellPath` > `terminal.shell` > 默认 shell 解析。

这两个设置在 VS Code 配置贡献点中都使用 `machine-overridable` scope。也就是说：

- 用户可以在“当前设备”的用户设置里给出默认值。
- 用户也可以在当前 workspace 里单独覆盖。
- 对于直接打开文件夹的单文件夹 workspace，VS Code 实际会把这类覆盖写到该目录下的 `.vscode/settings.json`；虽然底层表现为 folder settings，本仓库产品语义上仍把它视为“workspace 级覆盖”。

实现上，`extensions/vscode/dev-session-canvas/src/panel/configuration.ts` 不再逐个 `get('terminal.shell')` / `get('terminal.shellPath')` 后让 VS Code 自己按键合并，而是把这两个键作为一个配置组整体解析：只要 workspace 级对其中任意一项显式赋值，就整体采用 workspace 级组合，并把未赋值的另一项回退到 schema 默认值，而不是继续继承设备级的另一半配置。

### 7.2 动态探测来源

`Dev Session Canvas: 选择 Terminal shell` 命令的候选来源收口为当前仓库已经实现并可解释的几条路径：

- `vscode.env.shell` 对应的当前默认 shell。
- `PATH` 中可解析到的 `bash`、`zsh`、`fish`、`sh`、`pwsh`、`powershell`、`cmd`。
- Linux/macOS 上 `/etc/shells` 中声明且可执行的 shell。
- Windows 上的 well-known path，例如 `pwsh.exe`、`powershell.exe`、`cmd.exe` 的标准安装位置。

命令只把这些已经确认“当前设备可用”的路径暴露给用户选择。

### 7.3 命令的持久化规则

Quick Pick 的正式规则如下：

- 选择“跟随当前默认 shell”时，扩展把 `terminal.shell` 设为 `default`，并清空 `terminal.shellPath`。
- 选择任意具体 shell 路径时，扩展必须把该精确路径写入 `terminal.shellPath`。
- 如果该路径的 basename 能映射到受支持的逻辑 shell 类型，例如 `bash`、`zsh`、`pwsh`，扩展可以同步保留 `terminal.shell=<name>`；但这只是附带上下文，不能覆盖 `terminal.shellPath` 的优先级。
- 如果路径 basename 不在受支持集合里，例如 `nu`，则 `terminal.shell` 保持为 `default` 或其它兼容值，而 `terminal.shellPath` 仍照常承载真实路径。

这条规则确保“用户在 Quick Pick 里看到并选中的路径”和“下一次真正启动时使用的路径”保持一一对应。

命令的写入目标规则如下：

- 当前存在打开中的 workspace 时，`Dev Session Canvas: 选择 Terminal shell` 默认写入当前 workspace 覆盖。
- 当前没有 workspace 时，命令退回写入设备级用户设置。
- 若用户希望调整设备级默认值，应直接在 Settings 的用户作用域里修改 `terminal.shell` / `terminal.shellPath`。

这样做的原因是：命令发生在具体 workspace 语境里，用户更常见的预期也是“只影响当前项目”；而设备级默认值仍然通过 settings UI 保留。

### 7.4 不可用配置的提示规则

扩展激活后会检查当前配置是否能在本机解析为真实可用的 shell：

- 如果 `terminal.shellPath` 已填写，但该路径当前不可用，则按“显式路径不可用”告警，并优先引导用户重新选择或直接编辑 `terminal.shellPath`。
- 如果 `terminal.shellPath` 填的是显式相对路径，例如 `./tooling/dev-shell`，可用性检查必须按真实终端启动时相同的 workspace `cwd` 解析；只要该相对路径在目标 workspace 下可执行，就不应误报“当前设备上未找到”。
- 如果 `terminal.shellPath` 为空、但 `terminal.shell=<name>` 在当前设备上找不到任何可用路径，则按“逻辑 shell 类型当前不可用”告警。
- 对于“跟随默认 shell”的情况，如果 `vscode.env.shell` 与平台回退路径都不可用，则提示用户检查宿主环境或手动指定 `terminal.shellPath`。

显式路径不可用时不允许静默回退到同名 shell 的另一个副本，因为那会再次破坏“精确选择”的承诺。

### 7.5 为什么 VS Code 设置页不能动态枚举

当前 VS Code 扩展设置页里的下拉选项来自 `package.json` 的配置贡献点。这里的 `enum` 和 `markdownEnumDescriptions` 都是静态声明，扩展运行时不能按“当前这台机器探测到了哪些 shell”去重写设置 UI 的选项集合。

因此，正式方案不是试图让设置页直接变成动态枚举，而是分层处理：

- 设置页提供稳定、可搜索、可同步的逻辑 shell 类型选项。
- 命令提供当前设备环境驱动的动态枚举能力。
- 两者通过 `terminal.shell` / `terminal.shellPath` 这两个配置键收口到同一套运行时语义。

## 8. 验证方法

要把本方案标记为已验证，至少需要具备以下证据：

1. `npm run typecheck` 通过。
2. `npm run build` 通过。
3. `npm run test:terminal-shell-configuration` 通过，并覆盖“多个同名 shell 存在时，显式路径优先于按名称重新解析”“显式相对 shell 路径按 workspace cwd 检查可用性”以及“workspace 级 shell 配置不会再混入设备级 `shellPath`”三类回归。
4. `DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=trusted node scripts/smoke/run-vscode-smoke.mjs` 已于 2026-05-05 通过，且 smoke 中包含“执行 `Dev Session Canvas: 选择 Terminal shell` 后，配置里保留被选中的精确路径”和“workspace 打开时命令生效结果会覆盖当前 workspace 而不是改写设备级默认值”的断言。
5. 设置描述与命令文案不再把“动态探测到的真实路径”误写成“只会落盘 shell 名称”，并明确 settings UI 同时支持设备级默认与 workspace 级覆盖。
