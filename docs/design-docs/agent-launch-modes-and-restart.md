---
title: Agent 启动方式与会话恢复交互设计
decision_status: 已选定
validation_status: 验证中
domains:
  - VSCode 集成域
  - 画布交互域
  - 协作对象域
  - 执行编排域
architecture_layers:
  - 宿主集成层
  - 画布呈现层
  - 共享模型与编排层
related_specs:
  - docs/product-specs/agent-launch-modes-and-restart.md
  - docs/product-specs/canvas-navigation-and-workbench-polish.md
related_plans:
  - docs/exec-plans/active/agent-launch-modes-and-restart.md
updated_at: 2026-07-13
---

# Agent 启动方式与会话恢复交互设计

## 1. 背景

当前仓库已经支持创建前选择 provider、停止后继续从节点内重新启动 Agent，以及从侧栏会话历史恢复为新的 Agent 节点。但 `tmp_feature_uiux.md` 与后续 Fork 需求引出的真实问题不是“再多几个按钮”这么简单，而是四条边界还没有正式写清：

1. 创建 Agent 时，如何同时保留“最快的默认创建”和“显式确认完整启动命令”两条路径。
2. 默认启动参数应当落在设置、节点 metadata 和真实执行命令的哪一层，才能既可配置，又不把运行时元数据和用户意图区混在一起。
3. 停止后的主动作到底应该优先恢复原会话，还是优先启动新会话；如果两者都需要，UI 与执行语义怎样分流才不含糊。
4. 当 Codex 原生已经提供 `codex fork`、Claude Code 原生已经提供 `--fork-session` 时，画布如何从当前 Agent 节点一键 Fork 出新节点，而不是让用户退回侧栏历史恢复或错误地把普通 resume 当成 Fork。

## 2. 问题定义

本轮需要回答六个问题：

1. 右键菜单与 VSCode Quick Input 如何共享同一套 Agent 启动预设，而不是各写一份分叉逻辑。
2. 默认启动参数与 provider 命令路径如何同时存在：前者是参数片段，后者是可执行命令解析入口，两者不能互相覆盖。
3. 自定义启动输入该存什么：完整命令、仅参数片段，还是已经解析后的 token 列表。
4. `Resume` 作为创建预设时，怎样和“停止后恢复原会话”的节点内主按钮区分语义。
5. 节点 metadata 应怎样建模，才能让后续“新会话”仍然知道这个节点偏好的启动方式。
6. Codex / Claude Code Fork 如何复用现有可信 session id 与节点创建路径，同时保证新节点启动的是 provider 原生 fork 语义，而不是同一个原 session。

## 3. 目标

- 让 Webview 右键菜单和宿主 Quick Input 都复用同一套 Agent 启动预设与命令校验逻辑。
- 为每个 provider 新增默认启动参数设置，同时保留原有 provider 命令路径设置。
- 默认启动参数设置使用 `window` scope：允许用户按当前窗口 / 工作区覆盖，而不是被限制在 machine-only 配置里。
- 让节点 metadata 能持久化“以后启动新会话时应使用哪种预设/命令”。
- Agent 节点标题下方的副标题应直接显示当前节点最近一次实际启动指令；若尚未真正启动，则显示按当前 metadata + 设置推导出的下一次 fresh-start 指令。
- 让停止后的标题栏按钮明确区分“新建新会话”和“恢复原会话”。
- 让持有可信 Codex / Claude Code session id 的当前 Agent 节点能一键 Fork 出同 provider 新节点，并通过 provider 原生 fork 语义获得新的 thread / session identity。
- 保持现有 provider resolver、自动启动与节点恢复边界不被破坏。

## 4. 非目标

- 不在本轮引入 provider 会话列表浏览器或 session picker。
- 不在本轮改变“自动恢复必须建立在可信显式 session identity 上”的正式恢复规则。
- 不在本轮为缺少已确认原生 fork 语义的 provider 伪造 Fork；普通 resume 不能冒充 Fork。
- 不在本轮维护正式分支树、机器可读 branch lineage 或跨节点合并语义；Fork 后自动生成的连接边只作为普通可编辑画布边。
- 不在本轮把 Agent 执行从 `node-pty` / runtime supervisor 迁到新的 backend。
- 不在本轮改写 Terminal 节点的启动配置模型。

## 5. 候选方案

### 5.1 只在 UI 层拼接命令字符串，不把启动偏好写进节点 metadata

优点：

- 改动范围小。

不选原因：

- 创建时选了 `YOLO` / `沙盒` / `自定义` 后，节点停止再开新会话时会丢失偏好。
- “创建前临时选择”和“节点的长期启动偏好”无法区分，后续标题栏重启/新建动作也没有可信依据。

### 5.2 为每次启动都持久化完整可执行路径和全部参数 token

优点：

- 运行时执行最直接。

不选原因：

- 对默认预设来说，这会把“当前设置值”冻结到节点里，后续用户更新默认启动参数后，新会话仍然沿用旧值。
- 对 `Resume` 创建预设来说，初次创建与后续新会话的语义并不完全相同，直接固化完整 token 会把一次性恢复意图误写成长期 fresh-start 配置。

### 5.3 持久化“新会话启动预设 + 自定义命令”，执行前再解析成实际命令

这是当前选择，用于创建前启动方式与停止后 `新建`。

核心思路：

- 节点 metadata 只持久化两类长期信息：
  - `launchPreset`：`default | resume | yolo | sandbox | custom`
  - `customLaunchCommand`：仅 `custom` 时保存完整命令字符串
- 对 `default / resume / yolo / sandbox`，每次真正启动“新会话”时，实时读取当前 provider 设置中的命令路径 + 默认启动参数，再拼出完整命令。
- 这里的 `Resume` 预设明确指 provider 自己的“进入 resume 选择入口”的 fresh-start 命令：`Codex` 走 `codex resume`，`Claude Code` 走 `claude --resume`。它不是“直接恢复当前节点的最近一次会话”，后者由节点停止后的 `恢复` 按钮单独负责。

选择原因：

- 这同时保住了“设置变更会影响后续默认/预设新会话”与“自定义命令可持久化”两条能力。
- 创建前的 `Resume` 与节点停止后的“恢复原会话”语义被明确拆开，不会互相污染。
- 宿主、Webview 与测试都可以共享同一套纯函数：构造预设命令、校验输入、从输入反推预设/自定义。

### 5.4 用普通显式 resume 复制当前 Agent 节点作为 Fork

优点：

- 可以直接复用侧栏历史恢复的 `restoreAgentSessionFromHistory()` 路径。
- 跨 provider 更容易做出表面一致的 UI。

不选原因：

- `claude --resume <session-id>` 与 `codex resume <session-id>` 都是普通恢复语义，不会创建新的 provider session / thread identity；它们不是用户预期的 Fork。
- 如果把普通 resume 叫作 Fork，会让旧节点和新节点在 provider 层争用同一个会话身份，后续行为难以解释。

### 5.5 用 provider 原生 fork 语义创建分叉新节点

这是当前选择，用于当前节点标题栏的 `分叉`（Fork）动作。

核心思路：

- 仅当当前 Agent 是 `Codex` provider 且节点持有可信 `codex-session-id`，或当前 Agent 是 `Claude Code` provider 且节点持有可信 `claude-session-id` 时，才允许分叉。
- Webview 只发出“从这个节点分叉”的用户意图；宿主在 `extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts` 中读取当前节点 metadata 并重新校验 session id。
- 宿主创建一个同 provider 的新 Agent 节点，启动预设为 `custom`，完整命令使用当前 provider 命令路径和原生 fork 参数：Codex 使用 `fork <session-id>`，Claude Code 使用 `--resume <session-id> --fork-session`。
- 新节点立即启动；旧节点不停止、不改 metadata、不改变用户对“哪个是主分支”的自由理解。
- 新节点标题只做弱提示，例如从原标题派生 `分叉` 后缀；画布不新增正式分支树。
- 宿主在分叉新节点创建成功后，自动从原 Agent 节点创建一条指向新 Agent 节点的普通 `user` 边，箭头方向为原节点到新节点，边标签默认为 `fork`；这条边只是可编辑/可删除的视觉连接，不作为机器可读 branch lineage。新节点按照 window scope 设置向上、向下或向右展开，默认向上；同一来源的多个新节点保持在同一层级线上，边锚点随方向选择。方向化展开与生成节点统一避碰的详细契约和验证状态见 `docs/design-docs/canvas-fork-placement-and-generated-node-collision.md`。
- 新节点右上角标题栏和普通 Agent 节点一样常驻显示状态胶囊；窄节点下沿用 PR121 的按钮级压缩策略保护标题、状态和用户动作可读性：标题栏 action cluster 保持 inline，只有可压缩按钮自身按内容收缩或内部换行，不通过整组动作区换行或隐藏状态来腾空间。由于标题栏动作多为两个中文字符，单纯设置 `white-space: normal` 会被 `min-content` 宽度保护而不一定可见换行；实现应在 Agent 接近最小宽度时给整组标题栏动作一个统一紧凑密度状态，使右上角所有动作按钮文本都实际在按钮内部两行显示。

选择原因：

- `codex fork <session-id>` 是当前 Codex CLI 已稳定公开的 fork 子命令，用于把历史交互会话 fork 成新 thread；`claude --resume <session-id> --fork-session` 是 Claude Code CLI 帮助中明确描述的 fork 语义，用于恢复上下文并创建新的 session id。
- 它复用现有可信 session id、CLI resolver、节点创建和启动路径，不需要解析或复制 provider 历史 JSONL。
- 当前只覆盖已确认有 provider 原生 fork 能力的 Codex 与 Claude Code，避免把其他 provider 的普通 resume 包装成不真实的 Fork。

### 5.6 深复制 provider 历史并注入新会话

优点：

- 理论上可以为没有原生 fork 参数的 provider 做出更强的跨 provider Fork。

不选原因：

- 需要理解并复制 Claude / Codex 的私有历史文件格式，还要处理摘要、工具调用、文件引用和权限状态。
- 这会绕开 provider 自己的会话生命周期，风险远高于当前需求。
- 当前需求只要求 Codex / Claude Code 当前会话 Fork，不需要泛化成会话历史迁移器。

## 6. 风险与取舍

- 取舍：默认启动参数作为新设置项独立存在，而不是把原有 `codexCommand / claudeCommand` 改成“允许整条命令”。
  原因：现有 resolver 的职责是“解析可执行命令路径”，不是解析任意 shell 命令串；把两者混在一个设置里会让解析、缓存与错误提示都变得模糊。

- 取舍：`Resume` 预设被定义成“启动一条 provider 自带 resume 选择入口的新会话”，并允许节点把这个 fresh-start 偏好持久化。
  原因：创建前的 `Resume` 是在新建节点时请求 CLI 打开 resume 选择器；停止后的“恢复原会话”则是恢复当前节点自己刚才那条会话，两者是不同语义，不能互相冒充。

- 风险：不同 provider 的 `YOLO / 沙盒 / Resume` 官方参数并不完全同构。
  当前缓解：仓库把它们定义为 provider-specific preset mapping，而不是假装它们有完全相同的底层语义；其中 `Claude Code` 当前没有与 `Codex --sandbox` 一一对应的单 flag，因此“沙盒”预设采用更保守的权限模式近似值，并在文档中显式写清。

- 风险：完整命令字符串需要解析与重组，若 parser 太弱会让自定义输入出现边界问题。
  当前缓解：把命令解析限制在单进程 exec 场景需要的最小 shell-like quoting 支持，并让校验与执行共用同一套 parser，避免“UI 判定能用、宿主执行却失败”的双标。

- 风险：Codex 新会话的 resume session id 不是扩展创建时就能直接拿到；启动后只靠扫 `~/.codex/sessions` 做启发式匹配可能 miss 或遇到歧义，而 CLI 自己的 `codex resume <session-id>` 提示又只会在 `Ctrl-C` 结束会话时出现。
  当前缓解：宿主仍保留启动后的文件扫描作为早期发现手段；若节点从 `running` 再次回到 `waiting-input` 时还没有拿到 session id，会再补扫一轮，避免只在首屏 prompt 前后错过文件。用户停止 Codex 会话时，停止路径会发一次 `Ctrl-C` 并等待 CLI 输出 `Token usage` 与 `codex resume <session-id>` 提示，再用这条提示对会话 id 做补充或校验，必要时覆盖启发式扫描结果。

- 风险：Claude Code fresh-start 时即使扩展主动传入 `--session-id <id>`，如果用户启动后没有真正交互，这个 session id 也可能并未生效；仅凭启动时生成的 id 会把“候选 id”误当成“可信可恢复会话”。
  当前缓解：Claude fresh-start 仍会在启动时注入候选 `--session-id`；宿主会主动检查 `~/.claude/projects/.../<session-id>.jsonl` 是否已经落盘，把“文件已存在”视为该 session id 已被 provider 接受的早期确认信号。停止时若又读到 `claude --resume <session-id>`，则把它当作后续校验/更正；只有文件确认与 stop-time 提示都缺失时，才清空恢复上下文。

- 取舍：Fork 只对已确认 provider 原生 fork 语义的 Codex 与 Claude Code 暴露。
  原因：Codex CLI 当前已稳定支持 `codex fork [SESSION_ID]`，可从已有 interactive session 创建新 thread；Claude Code CLI 支持 `--fork-session`，可基于 `--resume <session-id>` 创建新的 provider session id。其他 provider 若只有普通 resume，就不能符合 Fork 心智。

- 风险：不同用户本机安装的 Codex / Claude Code 版本可能还不支持当前 fork 参数。
  当前缓解：Fork 启动命令只在点击时生成并通过现有启动错误路径反馈；实现时把 provider-specific fork 命令构造集中在共享命令层和宿主侧，后续若需要版本能力检测，可以在同一入口上补充 `codex fork --help` / `claude --help` 检测或更明确的错误提示。

## 7. 正式方案

### 7.1 共享模型与宿主权威状态

在 `extensions/vscode/dev-session-canvas/src/common/protocol.ts` 中为 Agent metadata 增加长期启动偏好字段：

- `launchPreset`：`default | resume | yolo | sandbox | custom`
- `customLaunchCommand`：仅 `custom` 时保留完整命令字符串

在 `CanvasRuntimeContext` 中补充每个 provider 的启动默认值：

- provider 当前命令路径设置
- provider 当前默认启动参数设置

这样 Webview 的右键菜单与宿主 Quick Input 都可以直接拿到同一份“当前 provider 默认启动命令模板”。

### 7.2 纯函数命令层

新增一个共享的纯逻辑模块，用来承载：

- 将 `provider + 命令路径 + 默认启动参数 + 预设` 组装为完整命令字符串
- 将完整命令字符串解析成 `requestedCommand + argv`
- 校验“首个 token 是否仍属于当前 provider 的允许命令集合”
- 复用同一套校验逻辑给 Webview 与宿主，避免“前端禁止、宿主仍可执行”的分叉
- 根据输入内容反推它属于 `default / resume / yolo / sandbox / custom` 中哪一种

这里还要额外收口一个默认参数冲突规则：对 `YOLO / 沙盒` 这类执行策略预设，命令层不能简单把预设参数盲目 append 到默认启动参数后面；它必须先剥离当前 provider 下由这些执行策略接管的那一小组、仓库已经显式文档化支持的 owned mode flags，再回填本次显式选择的预设结果。这里不是一套“对所有参数做通用归一化”的框架，而是一份有限白名单：`Codex` 当前只覆盖 `--yolo`、`--full-auto`、`--dangerously-bypass-approvals-and-sandbox`、`--sandbox` / `-s`、`--ask-for-approval` / `-a` 及其 `--flag=value` 形式；`Claude Code` 当前只覆盖 `--dangerously-skip-permissions` 与 `--permission-mode`。除此以外的潜在冲突组合，产品语义明确收口为“不要自动改写，用户改走自定义启动”。

同时，模式参数的插入位置也继续收口：当 `Resume / YOLO / 沙盒` 需要把本次显式选择写回完整命令时，应尽量把对应 argv 前置到命令前部，而不是继续堆在默认参数尾部。这样右键菜单、Quick Input 与节点副标题里展示出来的最终命令能更快暴露“这次到底是默认 / Resume / YOLO / 沙盒哪一种模式”，而不会把关键模式信息埋在超长命令尾部。

之所以要把边界收得这么窄，是因为右键菜单的启动方式层和 Quick Input 第二层的目标只是提供一组仓库内定义、可预测的快捷预设，而不是替不同 provider 的全部 CLI 语义兜底。否则一旦把未知参数也纳入“同类模式参数”的模糊概念里，后续实现者和 reviewer 很容易误以为这里应该继续扩展成通用参数重写器。

Default args 的配置边界也在同一层收口：它只能承载稳定的 runtime/configuration 参数，不能承载一次性的会话目标、picker 范围、Fork 标记，或 Codex 里会与 `resume` / `fork` 目标位置混淆的裸 positional prompt/session。Default args 继续喂给快速启动、预设展示、自定义启动预填、fresh-start 与历史恢复 / 历史分叉；当前画布节点的 `恢复` 与 `分叉` 则只继承当前节点自己的启动意图，不再合并当前 Default args。即便如此，如果把 `resume`、`fork`、`--last`、`--resume <id>` 或 `--fork-session` 这类目标选择写成全局默认值，历史入口和 fresh-start 仍只能在启动时“猜测并清理”用户真正想表达的目标，既不可见也不可维护。因此共享命令层应在读取默认启动参数时就 fail closed：`Codex` 默认启动参数中禁止 `resume`、`fork`、`--last`、`--all`、`--include-non-interactive`、`--` 和不属于 option value 的裸 positional token；`Claude Code` 默认启动参数中禁止 `--resume` / `-r`、`--continue` / `-c`、`--session-id` 与 `--fork-session`，包括 `--flag=value` 与空格分隔形式。用户如果确实需要这些一次性目标，应走创建前 `Resume`、当前节点 `恢复` / `分叉`、历史恢复入口，或把它们写入本次自定义启动命令，而不是写入 Default args。

同一个共享层里，`Resume` 预设本身还要单独走另一套构造：它不是“保留默认参数里已有的定向 resume 目标”，而是强制收口到 provider 自己的 resume 入口。由于 Default args 已经禁止会话目标类参数，应用 `Resume` 预设时不再静默清理这类冲突配置；如果默认启动参数已经含有它们，菜单、Quick Input 与宿主 fresh-start 都必须显式报错并要求用户改配置。

这里还要继续细分三类场景：一类是“没有显式目标 session-id 的 Resume 预设”，它进入 provider 自己的 picker / resume 入口；第二类是“侧栏历史会话恢复 / 历史分叉”，它只有历史 session id / cwd，没有可靠原始 argv，因此继续使用当前 provider 命令和当前 Default args；第三类是“当前画布节点恢复 / 分叉”，它已经有节点自己的启动意图，因此只从当前节点最近一次实际启动命令或长期启动偏好中继承运行参数，不再合并 Default args。

显式 `Resume / Fork` 的冲突与非冲突配置清单固定如下：

- Provider 命令路径不冲突：`devSessionCanvas.agent.codexCommand` / `devSessionCanvas.agent.claudeCommand` 继续决定首个命令 token；宿主仍通过 resolver 找到实际可执行文件。
- Agent 工作目录不冲突：当前节点 `metadata.agent.cwd` 或历史记录里的 `cwd` 继续作为 PTY `cwd`，不会因 resume/fork 被替换成 provider home 或扩展 storage。
- 历史 Codex 显式目标 `resume` / `fork` 的 Default args 不冲突项包括 `--model` / `-m`、`--sandbox` / `-s`、`--ask-for-approval` / `-a`、`--profile` / `-p`、`--config` / `-c`、`--cd` / `-C`、`--add-dir`、`--image` / `-i`、`--local-provider`、`--enable`、`--disable`、`--remote`、`--remote-auth-token-env`，以及不需要额外 value 的单 token option；`resume` / `fork` 目标片段、旧 positional session/prompt、`--last`、`--all`、`--include-non-interactive` 不适合进入 Default args，若出现应在默认参数解析阶段报错。
- 历史 Claude Code 显式目标 `resume` / `fork` 的 Default args 不冲突项包括 `--model`、`--permission-mode`、`--dangerously-skip-permissions`、MCP / tool / output 等其他非 session-target 参数；`--resume` / `-r`、`--continue` / `-c`、`--session-id`、`--fork-session` 不适合进入 Default args，若出现应在默认参数解析阶段报错。
- 当前节点 `恢复` / `分叉` 不使用 Default args 不冲突清单；它们只继承当前节点启动意图。最终命令只能由本次动作写入一个新的显式目标：Codex 为 `resume|fork <session-id>`，Claude Code 为 `--resume <session-id>` 或 `--resume <session-id> --fork-session`。

当前节点的显式 `Resume / Fork` 必须继承节点自己的启动意图，而不是继承或合并当前 Default args。宿主在 `extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts` 中把当前 `AgentNodeMetadata.lastLaunchCommandLine`、`launchPreset`、`customLaunchCommand` 与模板落地的 `templateArgv` 组装为 `AgentLaunchIntentOptions`，并传给 `extensions/vscode/dev-session-canvas/src/common/agentLaunchPresets.ts` 的 `buildAgentHistoryResumeCommandLine(...)` / `buildAgentBranchCommandLine(...)`。共享命令层优先解析当前节点最近一次实际启动命令；这一步只提取 argv 启动意图，不要求旧命令 token 等于当前 provider 命令设置，最终命令首个 token 仍由当前 `defaults.command` 决定。如果节点尚未真正启动，再退回 `YOLO / 沙盒` 预设、自定义命令或模板 argv。随后剥离这些 argv 中已有的 `resume` / `fork` / `--resume` / `--session-id` 等目标选择，再由本次动作写入唯一的显式 `session-id` 目标。当前节点 `恢复` 生成显式 resume 命令后，只用 command-only defaults 做命令校验；当前节点 `分叉` 创建出的 custom fork 节点也记录 command-only 校验策略，避免后续自动启动时再被当前 Default args 拦截。这样从 `--yolo -c sandbox_workspace_write.network_access=true --search` Codex 节点点击 `恢复` 会生成带 `resume --yolo -c sandbox_workspace_write.network_access=true --search <session-id>` 的命令，从同一节点点击 `分叉` 会生成带 `fork --yolo -c sandbox_workspace_write.network_access=true --search <session-id>` 的命令；即使当前 Default args 后来变化，也不会改写这个已有节点的 `恢复` / `分叉` 行为。

历史会话入口故意不走这条节点启动意图继承。`extensions/vscode/dev-session-canvas/src/common/agentSessionHistory.ts` 从 Codex `~/.codex/sessions/.../rollout-*.jsonl` 和 Claude `~/.claude/projects/**/*.jsonl` 能可靠提取的是 provider、session id、cwd、时间和首条真实用户指令；provider 历史文件没有稳定暴露原始 argv / command line。因此 `restoreAgentSessionFromHistory(...)` 与 `forkAgentSessionFromHistory(...)` 只把历史项的显式 session id / cwd 与当前 provider 命令、当前 Default args 组合，不伪造“继承历史启动参数”的能力。

这里的“允许命令集合”不是只看裸字符串 `codex / claude`，也不是接受“任意 basename 一样的可执行文件”；它只接受当前设置值本身，以及 provider 的标准别名。这样当测试环境或用户设置把 provider 命令指向绝对路径脚本时，自定义输入仍然可以使用该精确路径，同时不会把 `/tmp/evil/claude` 这类同 basename 的其他二进制误判成合法命令。

同一层 parser 还要显式承担两条约束：

- 反斜杠不能再被当成“通用 escape”。在 Windows 路径 `C:\tools\codex.exe`、`"C:\Program Files\Codex\codex.exe"` 这类输入里，`\` 默认按字面值保留；即使是用户自然输入的 `"C:\Users\me\My Dir\"`、`"My Dir\"`、`"C:My Dir\"` 这种“带空格且以反斜杠结尾”的 quoted path，也必须被当成合法路径而不是未闭合引号。只有对引号本身或未加引号的空白分隔才做最小限度转义。
- `agent.codexDefaultArgs` / `agent.claudeDefaultArgs` 若存在未闭合引号等 parse error，或包含上文定义的 Resume / Fork 冲突项，必须把错误显式抛给 Webview、Quick Input 和宿主启动链路，而不是偷偷把默认参数整段丢掉或清理后继续执行。

命令层的正式收口方式也要明确：

- 实际执行路径继续保持 `node-pty.spawn(file, args)` 这类结构化 `file + args[]`，不把用户输入整段交给 shell；命令字符串只存在于 Settings / Quick Input / 右键菜单这些“人输入文本”的边界。
- 共享 parser 的核心语义以 Windows 文档化的“反斜杠 run + 双引号”规则为基线，但只把它作为双引号内的标准行为；单引号仍保留“全文字面值”的简洁语义，未加引号时的 `\` 也继续按当前仓库约定默认为字面值，避免把 `C:\tools\codex.exe` 这类输入吃坏。
- 共享 formatter 的 canonical 输出优先选择单引号包裹“包含空白、反斜杠或双引号，但本身不含单引号”的 token，把复杂 escaping 限制在少数确实需要双引号的场景。这样 `\" a`、`C:\Users\me\My Dir\`、`\\server\share\My Dir\` 这类值都会被序列化成更稳定、可读且可 round-trip 的字符串，而不是继续生成容易和 Windows path 兼容层打架的 `"...\\\""` 形式。
- 同时保留两层兼容：一是继续接受旧 formatter 产出的“每个 `\` 都被重复一次”的历史命令文本，避免升级后旧 metadata / 默认参数失效；二是继续接受用户自然输入的 Windows 路径（包括尾部 `\"` 的单段 relative path、drive-relative path 与 UNC path），但这条兼容只在“整个 token 真的长得像 Windows path”时触发，不再对纯 `\\` 前缀或任意字面量 `\"` 做前缀猜测。

### 7.3 右键菜单

`extensions/vscode/dev-session-canvas/src/webview/main.tsx` 中的空白区右键菜单当前收口为两层：

1. 根层：`Note / Terminal / provider 列表`
2. 启动方式层：`快速启动 / Resume / YOLO / 沙盒 / 自定义启动`

正式规则：

- 根层不再保留单独的泛化 `Agent` 项；provider 选择直接并入根层，默认 provider 排在第一位，仅通过 `（默认）` 文案标识。
- provider 行继续采用 split button：主按钮直接创建该 provider 的默认 Agent，次按钮进入启动方式层。
- 即使当前 workspace 未受信任，根层与启动方式层也继续保持可见；受限时不隐藏 provider / preset，而是在用户点击创建时改走宿主 modal 解释原因。
- 自定义启动输入框是菜单旁的就地浮层，不进入新的全屏对话框。
- `Escape` 优先从启动方式层返回根层；只有在根层时才关闭整个菜单。
- 自定义启动输入打开后，第一次 `Escape` 必须优先收起输入区；这条规则独立于当前焦点是否还停留在输入框里。
- 启动方式层每条说明文案都应被限制在固定可读高度内；超长内容改为省略号截断，并在 hover 时通过原生 title 暴露完整指令。
- 创建动作统一发 `webview/createDemoNode`，并把 provider、launchPreset、customLaunchCommand 一次性带回宿主；不允许先创建默认 Agent 再补一次 metadata 更新。
- 但当当前 workspace 未受信任且点击的是 `Agent` / `Terminal` 这类 execution node 创建入口时，Webview 不再发 `webview/createDemoNode`，而是发一个专门的“解释当前不可创建原因”消息；宿主在该路径上弹 modal，并且不产生新节点。

### 7.4 VSCode Quick Input

`extensions/vscode/dev-session-canvas/src/extension.ts` 中的 `Dev Session Canvas: 创建节点` 命令保持两层：

- 第一层：延续当前“创建对象 / 按类型创建 Agent”的分组与 provider 选择。
- 第二层：只对 Agent 打开，输入框显示完整命令，列表第一项是 `使用自定义命令创建`，下方 `默认 / Resume / YOLO / 沙盒` 项是模式快捷替换器。

正式规则：

- 页面打开时默认高亮 `默认` 模式，因为输入框初始值就是默认命令。
- 点击或键盘确认预设项会改写输入框，并保持焦点在对应模式上；当该模式已经与输入框当前值一致时，再确认会按该模式创建。
- 用户手动编辑输入框后，焦点切回第一项 `使用自定义命令创建`，确认后按当前输入框创建自定义 Agent。
- 如果用户显式点击了某个预设，而最终输入框内容在语义上仍等价于该预设生成的完整命令，则节点 metadata 里的 `launchPreset` 保留这次显式选择，而不是仅靠字符串反推后回落成 `default`。
- 第二层允许通过 Back 返回第一层。
- 第二层继续使用 `QuickPick`；首项承载自定义命令创建，预设项承载当前模式选择。原因是 VSCode `QuickPick` 会在输入过滤时自动激活可选项，显式维护“当前输入对应的模式 / 自定义命令”能避免默认高亮第一个预设造成误创建，同时避免标题栏 icon-only 按钮难以理解。
- 如果当前 workspace 未受信任，则第一层和第二层仍保持完整可见；只有当用户最终确认 `Agent` / `Terminal` 创建时，扩展才在宿主侧弹 modal 解释原因，并停止创建。
- 测试环境保留可脚本化 override，避免 smoke 依赖真实 Quick Input 自动化。

### 7.5 宿主执行路径

`extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts` 中的 Agent fresh-start 路径改成：

1. 从节点 metadata 取 `launchPreset/customLaunchCommand`
2. 结合当前 provider 设置，重新校验并解析出“本次新会话要执行的完整命令”；若首个 token 不再属于当前 provider，或 `custom` 预设缺少有效命令，则直接拒绝启动
3. 把首个 token 送入现有 resolver，拿到真正的可执行文件路径
4. 将其余 token 与 provider resume/file-activity 注入逻辑拼接，生成最终 `ExecutionSessionLaunchSpec`

边界如下：

- 当用户点击停止后的 `重启` 按钮，且节点持有可信恢复上下文时，仍走当前显式 session resume 路径；这条路径恢复的是“当前节点前面停止的那条会话”，不依赖 `launchPreset` 决定恢复目标。
- 但这条显式 session resume 路径必须把 `launchPreset/customLaunchCommand/templateArgv` 当作当前节点启动意图继承下来；`launchPreset` 不决定恢复哪条会话，只决定恢复时继续带上哪些非目标选择参数。
- 当用户点击 `新建` 时，才走上面的 fresh-start 路径。
- 若节点 `launchPreset = resume`，fresh-start 路径始终执行 provider 的“进入 resume 选择入口”预设命令，而不是偷偷替用户选择最近一条会话。
- 若 fresh-start 期间 `resolveAgentCliCommand()` 抛出命令解析失败，或最终 `node-pty` / runtime supervisor 启动阶段返回 `ENOENT`，宿主在把节点更新为明确错误态之后，还要触发与侧栏概览 `Codex 命令` / `Claude Code 命令` 行相同的 CLI 选择命令（`devSessionCanvas.selectCodexCli` / `devSessionCanvas.selectClaudeCli`）。这条补救入口只针对真实用户会话启用，测试模式不自动打开 Quick Input，以免 smoke 中的失败路径被交互弹窗阻塞。CLI 选择命令继续复用 `extensions/vscode/dev-session-canvas/src/extension.ts` 中的安装分流：未解析到候选 CLI 时先展示安装入口，再让用户选择命令行安装或 VS Code 插件安装。
- 对 untrusted workspace 的创建限制，宿主同时暴露一条单独的“解释当前不可创建原因”路径，供 Quick Input 与 Webview 点击时复用；`applyCreateNode()` 本身仍保留 host error 兜底，专门拦 forged `webview/createDemoNode` 或其他绕过正常 UI 的请求。
- 对 `Claude Code` 的 fresh-start，会在启动时继续传入候选 `--session-id`，并主动检查 `~/.claude/projects/.../<session-id>.jsonl` 是否已经出现；一旦文件存在，就把该 id 升级为可恢复上下文。停止时若再读到 `claude --resume <session-id>`，宿主会把它当作后续校验/更正信号；若两者都没有，才回退成不可恢复。停止按钮当前对 Claude 已回滚到更早的 provider-specific stop signal：不再发送 `Ctrl-C`，而是直接沿用此前的终止信号路径；Codex 才继续保留单次 `Ctrl-C` + 5 秒兜底的 graceful-stop 语义。
- 若 Claude 的 fresh-start 命令里已经显式给出 `--session-id=<id>`、`--resume=<id>`、`--continue=<id>` 或等价的空格分隔写法，宿主与 runtime supervisor 都要把这条显式 session id 当作后续文件确认的候选值，而不是继续沿用自动生成的随机 UUID。只有显式 flag 不带 session id 时，才保留“等待 stop-time hint 再确认”的语义。
- 对 `Claude Code` 的 fresh-start，只要自定义命令已经显式包含 `--session-id` / `--resume` / `--continue`，宿主就不再补写候选 session 参数；这里既覆盖 `--flag value`，也覆盖 `--flag=value`。
- 对 `Codex` 的 fresh-start，启动后仍先扫 `~/.codex/sessions/.../rollout-*.jsonl`；如果节点后来从 `running` 再次回到 `waiting-input` 且仍未拿到 session id，宿主会再触发一轮扫描，以覆盖首轮 discovery 的时序 miss。
- 标题栏停止按钮按 provider 走不同语义：Codex 先发单次 `Ctrl-C`，若 CLI 未正常退出，再走 5 秒 graceful-stop force-kill；Claude 则沿用更早的直接终止信号路径，不等待 stop-time `Ctrl-C` 收尾。

### 7.6 当前 Codex / Claude Code Agent 的 `分叉` 动作

在 `extensions/vscode/dev-session-canvas/src/common/protocol.ts` 中新增一条 Webview 到宿主的用户意图消息，用于表达“从当前 Agent 节点分叉”。消息 payload 只需要携带当前节点 id；provider、session id、是否可信都必须由宿主在 `extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts` 中重新读取当前权威状态来判断，不能信任 Webview 传入的 session id。

`extensions/vscode/dev-session-canvas/src/webview/executionSessionNodes.tsx` 的 Agent 节点标题栏提供 `分叉` 操作。该操作只对 provider 为 `codex` 且 metadata 已显示当前节点具备可信 `codex-session-id`，或 provider 为 `claude` 且 metadata 已显示当前节点具备可信 `claude-session-id` 的节点可见或可用；如果 UI 侧暂时无法完全判断，也必须让宿主拒绝 provider / resumeStrategy 不匹配、无 session id 或 workspace 未受信任场景，并给出明确提示。`分叉` 不取代 `新建 | 恢复`：`新建` 是当前节点 fresh-start，`恢复` 是当前节点恢复原会话，`分叉` 是创建另一个节点并用 provider 原生 fork 语义启动。

宿主侧的 `branchAgentSession()` 类似 `restoreAgentSessionFromHistory()`，但语义更窄：它从当前节点读取可信 `codex-session-id` 或 `claude-session-id`，调用共享命令层的 provider-native fork 命令构造逻辑生成完整命令，然后通过 `applyCreateNode('agent', ..., { agentProvider: metadata.provider, agentLaunchPreset: 'custom', agentCustomLaunchCommand, titleOverride })` 创建同 provider 新节点。新节点标题从原节点标题派生弱提示，例如追加 `分叉`；它会创建一条从原 Agent 指向新 Agent 的普通可编辑 `user` 边，边标签默认为 `fork`，但不写入正式父子分支树或机器可读 branch lineage，也不改变原节点状态。新节点标题栏继续显示状态胶囊，和 `启动/停止`、`删除` 等动作共同保持现有 inline 标题栏布局；标题栏动作按钮只在自身维度按 PR121 方式压缩/内部换行，不能让整个 action cluster 换行。实现上以 Agent 节点宽度驱动 `compact-actions` 密度：当节点宽度接近最小宽度时，`启动`、`停止`、`新建`、`恢复`、`分叉`、`删除` 等右上角动作按钮都在按钮内部两行显示，同时保留 action cluster 的 `nowrap`。

分叉命令构造必须使用当前 provider 命令路径与显式 session id，目标命令语义是：

    codex fork <session-id>
    claude --resume <session-id> --fork-session

这里的 `<session-id>` 来自当前节点可信 metadata，而不是 provider 的最近会话。当前节点分叉命令只继承来源节点启动意图，不再继承当前 Default args；即使 Default args 里配置了 `--model`、`--sandbox`、`--profile`、`--config` 或误配置了 `resume` / `fork` 选择目标，也不能影响这次当前节点分叉。历史分叉因为没有节点启动意图，才继续从 Default args 继承对 `codex fork <session-id>` 或 `claude --resume <session-id> --fork-session` 仍有效的运行参数，并在 Default args 含 `resume` / `fork` 目标、`--last`、`--all`、`--include-non-interactive`、旧 session id、旧 `--resume` / `--continue` / `--session-id` 或旧 `--fork-session` 时明确报错。点击后新节点立即启动，用户不需要再点一次 `启动`。

当前节点分叉还会继承来源节点启动意图：`branchAgentSession()` 不只传入 `metadata.provider` 与 `resumeSessionId`，还会把来源节点的 `lastLaunchCommandLine/launchPreset/customLaunchCommand/templateArgv` 传入共享命令层。历史分叉则仍只调用不带启动意图的 `buildAgentBranchCommandLine(params.provider, sessionId)`，因为历史项不是当前节点，没有可读取的节点启动意图。

### 7.7 停止后的 `新建 | 恢复` 动作

在 `extensions/vscode/dev-session-canvas/src/webview/executionSessionNodes.tsx` 的 Agent 节点标题栏中，把停止后的会话动作收口为两个并列按钮：

- 左侧按钮：`新建`，启动新会话。
- 右侧按钮：`恢复`，英文为 `Resume`，恢复当前节点自己的原会话。

正式规则：

- 只有当节点存在可信恢复上下文时，标题栏才显示 `新建 | 恢复` 双按钮，英文对应 `New | Resume`。
- 若节点没有可恢复上下文，标题栏直接退化为单个 `启动` 按钮；不会再显示 disabled 的双按钮。
- `新建` 始终按节点 metadata 的 fresh-start 配置执行。
- `恢复` 始终恢复当前节点自己刚停止的会话，不退化为 provider 的最近一次全局会话。
- `恢复` 同时继承当前节点启动意图；历史恢复入口不继承，因为历史记录没有可靠原始启动参数。
- Terminal 节点退出后仍显示 `重启 / Restart`；Agent 与 Terminal 不共用同一个可见动作语义。
- Webview 只表达用户意图；真正是否能 resume 仍由宿主以当前 metadata 判断。

## 8. 验证方法

至少需要完成以下验证：

1. Playwright harness 覆盖右键菜单的 provider drill-in、启动方式 drill-in、自定义输入校验与创建消息 payload。
2. Playwright harness 覆盖停止后 `新建 | 恢复` 双按钮的新会话与原会话恢复分流、中文标签和可访问名称，并确认不再渲染下拉入口；本地化测试同时锁定英文 `New | Resume`，避免误改 Terminal 的 `Restart`。
3. VSCode smoke 覆盖命令面板 / 侧栏“创建节点”的两层 Quick Input，确认 Agent 选择后会进入完整命令编辑，并能用预设创建出持久化了正确 launchPreset 的节点。
4. 自动化验证 fresh-start 路径会把 `launchPreset/customLaunchCommand` 带入宿主执行，而不是丢失为默认命令。
5. 自动化覆盖 Codex / Claude Code 分叉：持有可信 `codex-session-id` 的 Codex 当前节点点击 `分叉` 后，宿主创建新的 Codex Agent 节点并立即启动，启动命令包含 `fork <session-id>`，来源到新节点的边标签为 `fork`；持有可信 `claude-session-id` 的 Claude Code 当前节点点击 `分叉` 后，宿主创建新的 Claude Code Agent 节点并立即启动，启动命令包含 `--resume <session-id> --fork-session`，来源到新节点的边标签为 `fork`；原节点状态不变。
6. 自动化覆盖分叉拒绝场景：provider 与 resumeStrategy 不匹配、缺少可信 session id、untrusted workspace 不会启动分叉。
7. `npm run typecheck`、`npm run test:webview` 至少通过；若 smoke 未跑全，要在结果中显式写明原因。
8. 手动验证真实 Extension Development Host 中，右键创建缺失 CLI 的 `Codex` / `Claude Code` Agent 会先显示节点错误态，再自动弹出和侧栏概览命令行相同的 CLI 选择/安装 Quick Input；Codex Fork 需要在安装了支持 `codex fork` 的 Codex CLI 环境中手动确认新节点会生成新的 thread，Claude Code Fork 需要在安装了支持 `--fork-session` 的 Claude CLI 环境中手动确认新节点会生成新的 session id。

## 9. 当前验证状态

- 2026-04-24：已完成正式设计收口，并把 `tmp_feature_uiux.md` 的需求吸收到仓库文档。
- 2026-04-24：已运行 `npm run typecheck`，通过。
- 2026-04-24：已运行 `npm run build`，通过。
- 2026-04-24：已运行 `npm run test:webview`，当前为 `82 passed`，覆盖右键菜单 drill-in、自定义输入校验、IME Enter 防误触、去掉冗余取消按钮后的菜单路径，以及当时的 split restart。
- 2026-04-24：已补充 Claude stop-time `claude --resume <session-id>` 提示校验，并把“无可信恢复上下文”的停止节点 UI 改成单个 `启动` 按钮；当前已完成构建与 targeted 回归，完整 smoke 仍待补跑。
- 2026-04-25：补充 provider 文件确认路径：Codex 在运行态再次回到 `waiting-input` 且尚未记录 session id 时会补扫 `~/.codex/sessions`；Claude fresh-start 则新增 `~/.claude/projects/.../<session-id>.jsonl` 文件存在性确认，并在已有文件确认时保留恢复上下文，不再被“缺少 stop-time hint”误清空。
- 2026-04-25：已修复 VSCode Quick Input 第二步的交互回归：点击 `Resume / YOLO / 沙盒` 现在只会改写顶部完整命令输入，不再直接创建节点；脚本化 QuickPick override 也同步收口为“只有显式 `accept-current` 才创建”。
- 2026-04-25：已给 VSCode Quick Input 第二步补回 `默认` 快捷替换项，使其和节点 metadata 的 `default` 预设一一对应；该项和 `Resume / YOLO / 沙盒` 一样，只改写顶部完整命令输入。
- 2026-04-25：已把 `agent.codexDefaultArgs` / `agent.claudeDefaultArgs` 的 VSCode 配置 scope 改成 `window`，使其可在窗口 / 工作区层直接配置和覆盖。
- 2026-04-25：Agent 节点副标题改为显示最近一次实际启动指令；若文本被截断，hover 时通过原生 title 浮窗显示完整指令。尚未真正启动的节点则回退为显示按当前 metadata 与设置推导出的下一次 fresh-start 指令。
- 2026-05-11：补齐右键创建 Agent 时 CLI 缺失的补救入口，并让 runtime supervisor 错误响应保留 `ENOENT` code；本轮已完成 `npm run test:runtime-supervisor-protocol`、`npm run typecheck`、`npm run build`，真实 Extension Development Host 自动弹出 Quick Input 仍需人工验证。
- 2026-04-24：已重新运行 `npm run test:webview -- --grep "agent restart"`，当前为 `2 passed`，覆盖当时“可恢复时显示 split restart”与“不可恢复时退化为单个启动按钮”两条标题栏路径。
- 2026-04-26：已运行 `npm run test:agent-launch-presets`，通过；新增覆盖 Windows 绝对路径解析、默认启动参数 parse error 显式报错，以及 invalid default args 下 custom 命令的分类回退。
- 2026-04-26：已运行 `npm run typecheck`、`npm run build`、`node --check tests/playwright/webview-harness.spec.mjs`、`git diff --check`，均通过。
- 2026-04-26：继续排查 Playwright harness 超时后，已确认根因并非菜单交互本身，而是共享命令校验逻辑在 Webview bundle 中读取了不存在的 `process.platform`，导致 `CanvasContextMenu` 渲染时抛出 `process is not defined`。修复后 targeted `npm run test:webview -- --grep "right-click custom agent launch input|validates custom agent launch commands before creating"` 与 `npm run test:webview -- --grep "right-click create menu"` 均通过。
- 2026-04-26：已补上 Windows “带空格且以反斜杠结尾”的 quoted token round-trip 回归，确认共享 formatter / parser 不会再把 `C:\\Users\\me\\My Dir\\` 这类参数格式化成无法重新解析的命令；本轮 `npm run test:agent-launch-presets`、`npm run build` 与 targeted `npm run test:webview -- --grep "right-click create menu|right-click custom agent launch input"` 均通过。
- 2026-04-26：本轮继续按“结构化 argv + 文档化 Windows quoting 兼容层”收口：新 formatter 改成更接近原生 Windows 的最小转义，parser 同时接受新 canonical output、旧版“全量双写反斜杠”的历史文本，以及自然输入的 quoted UNC path；已新增绝对路径 / UNC / 尾部反斜杠回归。
- 2026-04-29：本轮继续收口“显式预设 vs 默认模式参数”冲突：共享命令层改成只对白名单里的 provider-owned execution mode flags 做有限覆盖，再回填 `YOLO / 沙盒`；未知组合明确要求用户改走自定义启动。`Codex` 的 `resume` 子命令及其参数继续保留，因为它们和执行策略参数并不互斥。同时 Quick Input 第二步会在显式点击预设且最终命令仍等价时保留该 preset 的 metadata，而不是仅靠字符串反推回落成 `default`。相关回归新增覆盖右键菜单文案、命令层归一化，以及 QuickPick 在“默认命令已含 `--yolo`”场景下仍持久化 `launchPreset: 'yolo'`。
- 2026-04-30：按最新 UI polish 继续收口右键菜单与节点标题栏：根层右键菜单改成 `Note / Terminal / provider 列表`，默认 provider 排在第一位；启动方式说明区新增固定高度与 hover 完整命令；Agent 节点标题/副标题在宽节点上改成固定可读上限；共享命令层把显式 `Resume / YOLO / 沙盒` argv 尽量前置到命令前部。
- 2026-05-11：命令面板 / 侧栏创建 Agent 的第二步 Quick Input 改为 `QuickPick` 首项 `使用自定义命令创建` + 下方预设模式项。页面打开时高亮 `默认`；选择模式后保持在对应模式上，手动编辑输入框后才切回自定义创建项，避免默认高亮第一个预设造成误创建，也避免标题栏 icon-only 预设按钮不易理解。
- 2026-04-24：`npm run test:smoke` 需要在沙箱外运行；补跑时 trusted 场景长时间停留在 VS Code 宿主空转状态，尚未完成，因此当前文档状态仍保持 `验证中`。

- 2026-05-18：停止后的 Agent 标题栏动作从 `重启 | ▼` 下拉式 split restart 改为 `新建 | 重启` 并列按钮；`新建` 复用原“新会话”功能，`重启` 保持恢复当前节点原会话。已运行 `npm run test:webview -- --grep "agent restart"`（3 passed）与 `npm run typecheck`，均通过。
- 2026-06-06：补充 Claude Code Agent `分叉`（Fork）正式方案：从当前节点可信 `claude-session-id` 创建新 Agent 节点，并立即用 `claude --resume <session-id> --fork-session` 启动；实现与验证状态以后续记录为准。
- 2026-06-13：已确认当前 Codex CLI `0.137.0` 的 `codex fork [SESSION_ID]` 为稳定子命令；据此把 `分叉`（Fork）正式范围从 Claude Code 扩展到 Codex / Claude Code。实现新增 Codex `codex fork <session-id>` 命令构造、Webview 可见性与 Host 创建路径，命令层回归已覆盖 Codex fork 默认参数剥离和 fork 子命令识别。本分支已通过 `npm run test:agent-launch-presets`、`npm run test:protocol-webview-messages`、`npm run test:canvas-execution-context`、`node --check tests/vscode-smoke/extension-tests.cjs`、`node --check tests/playwright/webview-harness.spec.mjs`、`npm run typecheck`、`git diff --check`，以及 focused `npm run test:webview -- --grep "Agent Fork action|forked Agent"`（3 passed）。完整 trusted smoke `DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=trusted npm run test:smoke` 已尝试运行，但在进入新增 Codex Fork helper 前被既有 editor Webview DOM 动作超时阻塞，错误为 `等待 editor Webview DOM 动作返回超时（10000ms）`，artifact 位于 `.debug/vscode-smoke/trusted/artifacts`；真实 provider 级新 thread / session id 仍需在安装对应 CLI 的 Development Host 中人工确认。
- 2026-06-13：按最新 UI 决策恢复分叉节点标题栏状态胶囊，并把用户可见按钮、aria/title、Host 错误提示和新节点标题后缀收口为 `分叉`。窄节点下不再隐藏状态，也不让整个 action cluster 换行；仅 `分叉` 这类可压缩按钮沿用 PR121 的按钮级压缩/内部换行。已重新运行 `npm run test:webview -- --grep "Agent Fork action|forked Agent"`（3 passed）、`npm run test:agent-launch-presets`、`npm run test:canvas-execution-context`、`npm run typecheck`、`node --check tests/playwright/webview-harness.spec.mjs`、`node --check tests/vscode-smoke/extension-tests.cjs` 与 `git diff --check`，均通过。
- 2026-06-14：分叉自动连线继续收口为可见语义：宿主创建来源 Agent 指向新 Agent 的普通 `user` 边时，默认写入 `fork` 标签，让画布上的分叉关系不只依赖连线方向。已运行 `npm run test:canvas-node-groups`、`npm run test:canvas-execution-context`、`npm run typecheck`、`node --check tests/vscode-smoke/extension-tests.cjs`、`node --check tests/playwright/webview-harness.spec.mjs`、focused Webview 连线标签渲染回归与 `git diff --check`，均通过；完整 VSCode smoke 未重新运行，继续沿用既有 Development Host 阻塞记录。
- 2026-06-14：PR159 review 指出的 Codex 分叉参数清理已收口：`buildCodexBranchArgv()` 对默认参数中 `fork` / `resume` 子命令之前和之后的参数都执行 fork selection stripping，新增命令层回归覆盖 leading `--last`、`--all`、`--include-non-interactive` 与旧 positional target。旧 Claude-only ExecPlan 已从 active 移入 completed，当前 Codex / Claude Code 分叉事实统一由 `docs/exec-plans/active/agent-launch-modes-and-restart.md` 与本文维护。
- 2026-06-14：修正标题栏动作按钮内部换行的触发口径：之前仅允许按钮 `white-space: normal`，但两个中文字符在 `min-content` 保护下即使拉到最小节点宽度也不一定会实际换成两行。现在 Agent 节点接近最小宽度时会给 action cluster 标记 `compact-actions` 密度，并把右上角所有动作按钮文案包在按钮内按两行显示；action cluster 仍保持 `nowrap`，不会回到整组换行破坏布局。已运行 focused Webview 回归确认所有动作按钮采用相同内部两行格式，并确认标题栏状态仍可见。
- 2026-07-01：补齐显式 `Resume / Fork` 的参数继承边界：当前节点 `重启` 与历史恢复现在复用共享 history resume 命令构造，保留 `--model`、sandbox / approval、profile / config、cwd 等不冲突配置；Codex 会同时剥离 leading 与子命令尾部的旧 `--last`、`--all`、`--include-non-interactive` 和旧 session/prompt 目标，Claude Code 会剥离旧 session-target 与旧 `--fork-session`。已新增命令层与宿主源检查回归。
- 2026-07-01：继续按反馈把 Default args 的边界前移：会与 `Resume / Fork` 冲突的一次性会话目标不适合进入默认启动参数。共享命令层现在对 `agent.codexDefaultArgs` 中的 `resume`、`fork`、`--last`、`--all`、`--include-non-interactive`、`--` 与裸 positional token，以及 `agent.claudeDefaultArgs` 中的 `--resume` / `-r`、`--continue` / `-c`、`--session-id`、`--fork-session` 显式报错；设置描述、规格与命令层回归已同步更新。
- 2026-07-02：补齐当前节点 `重启` / `分叉` 对节点启动意图的继承：宿主现在只在当前节点动作中传递 `launchPreset/customLaunchCommand/templateArgv`，历史恢复 / 历史分叉仍不传意图；命令层新增启动意图与 Default args 的冲突合并回归，覆盖 Codex / Claude 的 `YOLO`、自定义命令和模板 argv 场景。
- 2026-07-04：按真实 fork 失败诊断修正当前节点启动意图边界：当前画布节点 `重启` / `分叉` 只继承节点最近一次实际启动命令或节点长期启动偏好，不再合并当前 Default args；历史恢复 / 历史分叉继续使用当前 Default args。新增命令层与宿主源检查回归覆盖 fork 出来的 Codex 节点再次分叉时不会把 Default args 中的 `--search` / `-c` 重复拼入，也不会因为当前 Default args 含会话目标或最近启动命令使用旧 provider 命令路径而拦截当前节点 `重启` / `分叉`。
- 2026-07-11：停止后 Agent 原会话动作改为 `New | Resume` / `新建 | 恢复`，Terminal 继续使用 `Restart / 重启`；Agent aria/title 与 Claude `Ctrl-Z` 三层拦截提示同步使用 resume 语义。已运行 `npm run test:ui-copy-localization`、`npm run test:canvas-execution-context`、`npm run test:runtime-supervisor-protocol`、`npm run typecheck`、focused `npm run test:webview -- --grep "agent session actions|agent new and resume actions|terminal restart action|agent resume action|Agent title action buttons|Claude Agent Ctrl-Z"` 与 `git diff --check`，focused Webview 为 `8 passed`。
- 2026-06-07：已补充 Fork 可见时 Agent 标题栏动作区的布局回归，确认 `停止`、`Fork`、`删除` 不再被 flex 收缩挤占；已运行 targeted `npm run test:webview -- --grep "agent restart actions render inline without a dropdown|Claude Agent Fork action posts a branchAgentSession message|Claude Agent Fork action keeps live title actions readable|Agent Fork action is hidden outside resumable Claude sessions|agent restart action falls back to start button when no resumable session exists"`（5 passed）与 `npm run typecheck`，均通过。随后补齐 Webview posted-message `lifecycle` 测试兼容、smoke 短 debug root 与 macOS `--password-store=basic` 启动参数，并修复真实 PTY 行号漂移导致 multiline 执行链接误回退到 Quick Open 的 smoke 阻塞；相关验证 `npm run test:vscode-smoke-runner-env`、`node scripts/test/test-execution-terminal-line-context-tracker.mjs`、`node scripts/test/test-execution-terminal-native-helpers.mjs`、multiline execution-link targeted Webview 测试均通过。当前 `DEV_SESSION_CANVAS_SMOKE_DEBUG_ROOT=/tmp/dsc-smoke DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=trusted npm run test:smoke` 已越过 VS Code socket/keychain 与执行链接阶段，新的剩余阻塞为后续侧栏节点列表测试动作超时；整体验证状态继续保持 `验证中`。
