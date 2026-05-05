# 嵌入式 Terminal shell 选择与精确路径锁定

本 `ExecPlan` 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘` 这几个章节。

本文位于 `docs/exec-plans/completed/execution-terminal-shell-selection.md`，必须按 `docs/PLANS.md` 的要求持续维护。

## 目标与全局图景

这次变更要让嵌入式 `Terminal` 节点同时支持两条看起来相似、但语义不同的 shell 选择路径：一条是在设置里按 shell 类型选择，例如 `bash`、`zsh`、`pwsh`；另一条是在命令里按当前设备真实可用的具体路径选择某一个 shell 副本。完成后，用户既能在设置页里使用固定选项，也能通过 `Dev Session Canvas: 选择 Terminal shell` 从当前设备动态枚举出的真实路径里选中一个精确二进制；即使机器上有多个同名 shell，下一次启动也仍然会使用刚才选中的那个路径，而不是重新按 `PATH` 漂移到另一个副本。

## 进度

- [x] (2026-05-05 17:05 +0800) 阅读当前分支实现、review findings 与相关配置/命令代码，确认主路径 bug 在于 Quick Pick 选择已识别 shell 时只写 `terminal.shell=<name>` 并清空 `terminal.shellPath`。
- [x] (2026-05-05 17:20 +0800) 明确正式语义：设置项 `terminal.shell` 负责逻辑 shell 类型，命令选择具体路径时必须把精确路径写入 `terminal.shellPath`，不能再丢失。
- [x] (2026-05-05 17:35 +0800) 修改 shell 选择持久化逻辑与设置文案，确保同名 shell 副本场景下仍保持稳定路径。
- [x] (2026-05-05 17:50 +0800) 补充自动化回归与 smoke 断言，并新增正式设计文档与索引登记，满足 repo 的可追踪性要求。
- [x] (2026-05-05 18:16 +0800) 运行 `npm run test:terminal-shell-configuration`、`npm run typecheck`、`npm run build` 与 `npm run build:notifier` 成功；首次重跑 trusted smoke 时，流程在既有 `verifyTerminalShellPathRefreshesIdleTerminalNode()` 超时处提前失败。
- [x] (2026-05-05 18:31 +0800) 修复 trusted smoke 中关于自动启动终端与 shell 选择断言的测试假设后，`DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=trusted node scripts/run-vscode-smoke.mjs` 通过；设计文档验证状态已更新为 `已验证`。
- [x] (2026-05-05 18:58 +0800) 按新增需求把 `terminal.shell` / `terminal.shellPath` 从纯设备级扩展为“设备级默认 + workspace 级覆盖”，并补上成组解析逻辑，避免 workspace 级 `terminal.shell` 被设备级 `terminal.shellPath` 反向压住。
- [x] (2026-05-05 19:06 +0800) 将 `Dev Session Canvas: 选择 Terminal shell` 调整为：打开 workspace 时默认写当前 workspace 覆盖；没有 workspace 时才写设备级用户设置。
- [x] (2026-05-05 19:57 +0800) 重新运行 `npm run test:terminal-shell-configuration`、`npm run typecheck`、`npm run build` 与 `DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=trusted node scripts/run-vscode-smoke.mjs` 成功，workspace 覆盖语义已拿到自动化证据。

## 意外与发现

- 观察：当前仓库其实已经有 `devSessionCanvas.terminal.shellPath` 这一条“精确路径覆盖”能力，bug 不是缺少配置键，而是 Quick Pick 在已识别 shell 场景下没有把用户选择写进这个配置。
  证据：`src/extension.ts` 原实现对 `bash` / `zsh` / `pwsh` 等已识别项执行 `configuration.update(CONFIG_KEYS.terminalShell, configuredShell)` 后立刻清空 `CONFIG_KEYS.terminalShellPath`。

- 观察：运行时解析逻辑已经明确声明“只要 `configuredPath` 非空，就优先使用该路径”；因此一旦命令正确写入 `terminal.shellPath`，多个同名 shell 的漂移问题会自然消失。
  证据：`src/panel/terminalShellConfiguration.ts` 中 `resolveConfiguredTerminalShell()` 的第一层分支就是 `if (configuredPath) { ... resolutionSource: 'path' }`。

- 观察：VS Code 设置页的 `enum` 选项来自 `package.json` 配置贡献点，仓库运行时不能按当前设备探测结果去改写这个下拉列表；这说明“固定设置项 + 动态命令”的两层设计不是权宜之计，而是 VS Code 宿主边界决定的正式方案。
  证据：当前 `devSessionCanvas.terminal.shell` 在 `package.json` 中以静态 `enum` 形式声明，候选集合在运行时不可变。

- 观察：当前 trusted smoke 里的 `testCreateNode('terminal')` 会触发终端节点自动启动；旧用例仍把它当成“空闲节点”，因此会在等待 shellPath 刷新时超时。
  证据：失败快照中 `terminal-1` 已是 `liveSession: true`，而 `src/panel/CanvasPanelManager.ts` 的 `refreshConfiguredTerminalShellMetadata()` 明确跳过 `liveSession` 与 `launching` 节点。

- 观察：我新增的 shell 选择 smoke 断言最初又踩到了两个测试层误判：一是把 `WorkspaceConfiguration` 旧快照当成实时配置读取，二是把 Quick Pick 默认项的 `detail` 误当成真实选择项路径。
  证据：第一次失败时断言读到的 `terminal.shellPath` 是旧快照中的空字符串；修正为重新 `getConfiguration()` 并只按 `item.resolvedPath` 匹配后，trusted smoke 通过。

- 观察：如果直接沿用 VS Code 对两个配置键逐个合并的默认行为，workspace 级只设置 `terminal.shell=bash` 时，设备级 `terminal.shellPath=/custom/zsh` 仍会继续生效；这会让“workspace 覆盖”失真。
  证据：在 `getConfiguration('devSessionCanvas.terminal.*')` 的逐键读取模型下，effective pair 会落成 `{ shell: 'bash', shellPath: '/custom/zsh' }`，运行时仍按路径优先级启动设备级 shell。

- 观察：trusted smoke 里看到的 extension 行为一度和源码不一致，是因为 smoke host 继续复用了旧 `dist/extension.js`；在这条仓库里改完 `src/extension.ts` 后，必须先 `npm run build` 再跑 trusted smoke，才能拿到最新命令逻辑。
  证据：失败时 `.debug/vscode-smoke/trusted/smoke-host/dist/extension.js` 里 `promptTerminalShellSelection()` 仍然固定写 `ConfigurationTarget.Global`；重新 build 后该逻辑才切换到最新实现。

## 决策记录

- 决策：保留 `devSessionCanvas.terminal.shell` 作为固定设置项，同时让命令把精确路径写入 `devSessionCanvas.terminal.shellPath`。
  理由：这同时满足了“设置里可选”“命令里动态枚举真实路径”两类需求，并复用仓库现有优先级语义，不需要再引入新的配置键。
  日期/作者：2026-05-05 / Codex

- 决策：当用户在命令里选中了某个具体路径时，即使它的 basename 能识别为 `bash` / `zsh` / `pwsh`，也仍然要把精确路径持久化到 `terminal.shellPath`。
  理由：否则机器上存在多个同名 shell 时，下一次启动仍会按 `PATH` 漂移，违反“从真实路径中精确选择”的产品承诺。
  日期/作者：2026-05-05 / Codex

- 决策：命令在写入 `terminal.shellPath` 的同时，允许保留已识别的逻辑 shell 类型到 `terminal.shell`，但运行时优先级不变。
  理由：这样既保留了用户在设置页和节点元数据里可见的 shell 类型信息，也不会破坏“精确路径优先”的正式语义。
  日期/作者：2026-05-05 / Codex

- 决策：`devSessionCanvas.terminal.shell` 与 `devSessionCanvas.terminal.shellPath` 两个键改为 `machine-overridable`，并把 runtime 解析从“逐键读取后交给 VS Code 合并”改成“作为一组按最高显式作用域整体解析”。
  理由：只有这样才能真正支持“设备级默认 + workspace 级覆盖”，避免 workspace 级 `terminal.shell` 被设备级 `terminal.shellPath` 泄漏覆盖。
  日期/作者：2026-05-05 / Codex

- 决策：`Dev Session Canvas: 选择 Terminal shell` 在打开 workspace 时默认写当前 workspace 覆盖；无 workspace 时才写设备级用户设置。
  理由：命令发生在当前项目语境里，用户更常见的预期是“只影响当前 workspace”；设备级默认值仍保留在 Settings 的用户作用域里可编辑。
  日期/作者：2026-05-05 / Codex

## 结果与复盘

本轮完成后，嵌入式 Terminal 的 shell 选择能力正式分成了两层：设置页里的 `terminal.shell` 负责逻辑 shell 类型，命令式 Quick Pick 负责把当前设备真实探测到的具体路径写入 `terminal.shellPath`。这样，`default` 跟随宿主默认 shell 的语义保留不变；而当用户显式从 Quick Pick 里选择某个 `bash` / `zsh` / `pwsh` 路径时，扩展会稳定记住这一个二进制，不再因为 `PATH` 顺序或 well-known path 重新解析而漂移。

在此基础上，配置作用域也正式收口成“设备级默认 + workspace 级覆盖”：这两个键现在都允许在 Settings 的用户作用域里给默认值，也允许在当前 workspace 里覆盖。实现上不再让 VS Code 分别合并两个键，而是把它们视为一个配置组；只要 workspace 级显式写了其中任意一项，就整体切到 workspace 级组合，避免出现“workspace 里选了 bash，却还偷偷继承设备级 shellPath”这类混合状态。

同时，本轮补齐了此前缺失的文档链路：新增正式设计文档，解释为什么 VS Code 设置项不能动态枚举，以及当前仓库为何要使用“固定设置项 + 动态命令 + 精确路径覆盖”这一组合。后续新增的 scope 规则也已经同步写入：命令在 workspace 打开时默认只改当前 workspace；需要修改设备级默认值时，改用户设置而不是复用命令。若后续还要继续扩大 shell 自动探测来源，应在新计划里基于同一套分层语义推进，而不是再让设置项和命令路径互相混淆。

验证上，本轮已经拿到 `npm run test:terminal-shell-configuration`、`npm run typecheck`、`npm run build`、`npm run build:notifier` 与 `DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=trusted node scripts/run-vscode-smoke.mjs` 通过的证据。trusted smoke 的两处测试假设问题也已同步收口：旧的“空闲终端节点”断言改为先等待自动启动、再停掉会话后验证；新的 shell 选择断言则改为正确读取刷新后的配置并只匹配真正带 `resolvedPath` 的 Quick Pick 项。scope 扩展后又新增了“workspace 打开时命令不会再改写设备级默认值”的 smoke 断言，并在重新 build 主扩展后验证通过。因此设计文档现已从 `验证中` 升级为 `已验证`。

本轮没有新增需要单独登记到 `docs/exec-plans/tech-debt-tracker.md` 的遗留技术债；当前剩余边界，例如“某些非常规自定义 shell 不在自动探测来源里”，已经被正式定义为非目标，并保留手动填写 `terminal.shellPath` 作为受控出口。

## 上下文与定向

本任务主要涉及四个区域。

第一类是配置解析：`src/panel/terminalShellConfiguration.ts` 负责把 `devSessionCanvas.terminal.shell` 与 `devSessionCanvas.terminal.shellPath` 解析成真正启动嵌入式终端所需的命令路径，也负责当前设备可用 shell 的动态探测。

第二类是命令入口：`src/extension.ts` 里的 `promptTerminalShellSelection()` 负责显示 Quick Pick，并把用户选择写回配置。review 指出的主路径 bug 就发生在这里。

第三类是设置文案：`package.nls.json` 里的 `configuration.terminal.shell.description` 与 `configuration.terminal.shellPath.description` 需要准确描述“逻辑 shell 类型”和“精确路径覆盖”各自的职责，不能再把动态命令误写成只会落盘 shell 名称。

第四类是验证：`scripts/test-terminal-shell-configuration.mjs` 负责快速覆盖配置解析回归，`tests/vscode-smoke/extension-tests.cjs` 负责在真实 VS Code 扩展宿主里覆盖命令选择后的持久化结果。

## 工作计划

先在 `src/panel/terminalShellConfiguration.ts` 中补一个纯函数，把“Quick Pick 选择结果应该如何落盘”为可复用、可测试的规则。这个函数的职责很窄：若用户选择默认 shell，就返回 `terminal.shell=default` 与空 `terminal.shellPath`；若用户选择具体路径，就返回该精确路径，并在可识别时保留逻辑 shell 类型。

然后在 `src/extension.ts` 中改写 `promptTerminalShellSelection()` 的持久化逻辑，不再区分“已识别 shell 名称就只写 name、未知路径才写 shellPath”这两条分叉，而是统一通过上面的规则落盘。这样任何具体路径选择都会稳定写入 `terminal.shellPath`。

接着同步更新 `package.nls.json`，把 `terminal.shell` 的描述明确成“逻辑 shell 类型”，把 `terminal.shellPath` 的描述明确成“命令选择后会写入的精确路径覆盖”，并显式说明多个同名 shell 场景下也会优先使用该路径。

最后补回归：在 `scripts/test-terminal-shell-configuration.mjs` 里增加“同名 shell 多副本 + 精确路径优先”的纯逻辑断言；在 `tests/vscode-smoke/extension-tests.cjs` 里拦截 `showQuickPick()`，模拟用户选中第二个 `bash` 副本，再断言命令执行后配置里保留的是第二个路径而不是名字重解析的结果。

## 具体步骤

1. 在仓库根目录修改以下文件：

       src/panel/terminalShellConfiguration.ts
       src/extension.ts
       package.nls.json
       scripts/test-terminal-shell-configuration.mjs
       tests/vscode-smoke/extension-tests.cjs
       docs/design-docs/embedded-terminal-shell-selection.md
       docs/design-docs/index.md
       docs/exec-plans/completed/execution-terminal-shell-selection.md

2. 在仓库根目录运行快速验证：

       npm run test:terminal-shell-configuration
       npm run typecheck

3. 在仓库根目录运行真实宿主 smoke：

       DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=trusted node scripts/run-vscode-smoke.mjs

4. 若 smoke 通过，把设计文档与索引中的验证状态切回已验证；若 smoke 失败，则必须在文档中明确记录失败项，而不能把“命令已经跑过”误写成“已验证”。

## 验证与验收

本轮完成后，至少要满足以下可观察验收标准：

- 在设置页里，`devSessionCanvas.terminal.shell` 仍然是固定选项，并明确表示 shell 类型。
- 运行 `Dev Session Canvas: 选择 Terminal shell` 命令时，Quick Pick 能展示当前设备真实可用的 shell 路径。
- 当当前设备上有两个同名 `bash` 可执行文件，用户选中第二个后，配置里会保留第二个的精确路径；下一次启动不会退回第一个。
- `npm run test:terminal-shell-configuration` 通过，并新增对应回归。
- trusted smoke 通过，并包含命令选择后配置落盘的断言。

## 幂等性与恢复

这次变更只涉及配置落盘语义、文案与测试，不涉及破坏性迁移。重复执行命令式 shell 选择只会覆盖 `terminal.shell` 与 `terminal.shellPath` 两个 machine-scope 设置，不会改写持久化画布状态。

测试里如果需要临时修改 `process.env.PATH` 或用户配置，必须在 `finally` 中恢复原值，并删除临时构造的 fake shell 目录。这样 smoke 即使中途失败，也不会污染后续回归环境。

## 证据与备注

最关键的回归证据是下面两类断言：

    buildPersistedTerminalShellSelection({ shellName: 'bash', resolvedPath: secondBashPath })
    => { configuredShell: 'bash', configuredPath: secondBashPath }

    executeCommand('devSessionCanvas.selectTerminalShell')
    + 选择 second/bash
    => workspace config 中 devSessionCanvas.terminal.shellPath === second/bash

这两条证据分别覆盖了“纯配置语义”和“真实命令持久化语义”。前者保证配置层不会再把精确路径丢掉，后者保证 VS Code 宿主里的 Quick Pick 主路径也已经接通。

## 接口与依赖

本轮直接依赖以下现有接口：

- `src/panel/terminalShellConfiguration.ts`
  - `normalizeConfiguredTerminalShell()`
  - `resolveConfiguredTerminalShell()`
  - `detectAvailableTerminalShells()`
  - 新增的 shell 选择持久化辅助函数

- `src/extension.ts`
  - `promptTerminalShellSelection()`
  - `buildTerminalShellQuickPickItems()`

- `tests/vscode-smoke/extension-tests.cjs`
  - `withInterceptedQuickPicks()`
  - `withInterceptedInformationMessages()`
  - `setTerminalShell()` / `setTerminalShellPath()`

- `package.json` / `package.nls.json`
  - `devSessionCanvas.terminal.shell`
  - `devSessionCanvas.terminal.shellPath`
  - `devSessionCanvas.selectTerminalShell`

这些路径已经足够闭合本轮需求，不需要再引入新的外部依赖或新的配置键。

---

本次更新说明：2026-05-05 为回应 review 中“Quick Pick 丢失精确路径”和“缺少 docs/ExecPlan/设计记录”两条问题，补写本计划并同步收口实现、测试与正式文档。
