---
title: Agent 启动方式与重启交互设计
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
updated_at: 2026-04-25
---

# Agent 启动方式与重启交互设计

## 1. 背景

当前仓库已经支持创建前选择 provider，以及停止后继续从节点内重新启动 Agent。但 `tmp_feature_uiux.md` 引出的真实问题不是“再多几个按钮”这么简单，而是三条边界还没有正式写清：

1. 创建 Agent 时，如何同时保留“最快的默认创建”和“显式确认完整启动命令”两条路径。
2. 默认启动参数应当落在设置、节点 metadata 和真实执行命令的哪一层，才能既可配置，又不把运行时元数据和用户意图区混在一起。
3. 停止后的主动作到底应该优先恢复原会话，还是优先启动新会话；如果两者都需要，UI 与执行语义怎样分流才不含糊。

## 2. 问题定义

本轮需要回答五个问题：

1. 右键菜单与 VSCode Quick Input 如何共享同一套 Agent 启动预设，而不是各写一份分叉逻辑。
2. 默认启动参数与 provider 命令路径如何同时存在：前者是参数片段，后者是可执行命令解析入口，两者不能互相覆盖。
3. 自定义启动输入该存什么：完整命令、仅参数片段，还是已经解析后的 token 列表。
4. `Resume` 作为创建预设时，怎样和“停止后恢复原会话”的节点内主按钮区分语义。
5. 节点 metadata 应怎样建模，才能让后续“新会话”仍然知道这个节点偏好的启动方式。

## 3. 目标

- 让 Webview 右键菜单和宿主 Quick Input 都复用同一套 Agent 启动预设与命令校验逻辑。
- 为每个 provider 新增默认启动参数设置，同时保留原有 provider 命令路径设置。
- 让节点 metadata 能持久化“以后启动新会话时应使用哪种预设/命令”。
- 让停止后的 split restart 明确区分“恢复原会话”和“新会话”。
- 保持现有 provider resolver、自动启动与节点恢复边界不被破坏。

## 4. 非目标

- 不在本轮引入 provider 会话列表浏览器或 session picker。
- 不在本轮改变“自动恢复必须建立在可信显式 session identity 上”的正式恢复规则。
- 不在本轮把 Agent 执行从 `node-pty` / runtime supervisor 迁到新的 backend。
- 不在本轮改写 Terminal 节点的启动配置模型。

## 5. 候选方案

### 5.1 只在 UI 层拼接命令字符串，不把启动偏好写进节点 metadata

优点：

- 改动范围小。

不选原因：

- 创建时选了 `YOLO` / `沙盒` / `自定义` 后，节点停止再开新会话时会丢失偏好。
- “创建前临时选择”和“节点的长期启动偏好”无法区分，后续 split restart 也没有可信依据。

### 5.2 为每次启动都持久化完整可执行路径和全部参数 token

优点：

- 运行时执行最直接。

不选原因：

- 对默认预设来说，这会把“当前设置值”冻结到节点里，后续用户更新默认启动参数后，新会话仍然沿用旧值。
- 对 `Resume` 创建预设来说，初次创建与后续新会话的语义并不完全相同，直接固化完整 token 会把一次性恢复意图误写成长期 fresh-start 配置。

### 5.3 持久化“新会话启动预设 + 自定义命令”，执行前再解析成实际命令

这是当前选择。

核心思路：

- 节点 metadata 只持久化两类长期信息：
  - `launchPreset`：`default | resume | yolo | sandbox | custom`
  - `customLaunchCommand`：仅 `custom` 时保存完整命令字符串
- 对 `default / resume / yolo / sandbox`，每次真正启动“新会话”时，实时读取当前 provider 设置中的命令路径 + 默认启动参数，再拼出完整命令。
- 这里的 `Resume` 预设明确指 provider 自己的“进入 resume 选择入口”的 fresh-start 命令：`Codex` 走 `codex resume`，`Claude Code` 走 `claude --resume`。它不是“直接恢复当前节点的最近一次会话”，后者由节点停止后的 split restart 单独负责。

选择原因：

- 这同时保住了“设置变更会影响后续默认/预设新会话”与“自定义命令可持久化”两条能力。
- 创建前的 `Resume` 与节点停止后的“恢复原会话”语义被明确拆开，不会互相污染。
- 宿主、Webview 与测试都可以共享同一套纯函数：构造预设命令、校验输入、从输入反推预设/自定义。

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

## 7. 正式方案

### 7.1 共享模型与宿主权威状态

在 `src/common/protocol.ts` 中为 Agent metadata 增加长期启动偏好字段：

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
- 根据输入内容反推它属于 `default / resume / yolo / sandbox / custom` 中哪一种

这里的“允许命令集合”不是只看裸字符串 `codex / claude`，还要接受当前设置值本身和该命令的 basename。这样当测试环境或用户设置把 provider 命令指向绝对路径脚本时，自定义输入仍然合法。

### 7.3 右键菜单

`src/webview/main.tsx` 中的空白区右键菜单扩成三层：

1. 根层：`Agent / Terminal / Note`
2. provider 层：`Codex / Claude Code`
3. 启动方式层：`快速启动 / Resume / YOLO / 沙盒 / 自定义启动`

正式规则：

- 根层和 provider 层的 Agent 项都采用 split button。
- 自定义启动输入框是菜单旁的就地浮层，不进入新的全屏对话框。
- `Escape` 优先逐层返回；只有在根层时才关闭整个菜单。
- 创建动作统一发 `webview/createDemoNode`，并把 provider、launchPreset、customLaunchCommand 一次性带回宿主；不允许先创建默认 Agent 再补一次 metadata 更新。

### 7.4 VSCode Quick Input

`src/extension.ts` 中的 `Dev Session Canvas: 创建节点` 命令保持两层：

- 第一层：延续当前“创建对象 / 按类型创建 Agent”的分组与 provider 选择。
- 第二层：只对 Agent 打开，顶部输入框显示完整命令，下方 `Resume / YOLO / 沙盒` 项是快捷替换器。

正式规则：

- Enter 始终按输入框当前值创建，不额外增加“创建”按钮。
- 点击下方预设项只改写输入框，不直接创建。
- 第二层允许通过 Back 返回第一层。
- 测试环境保留可脚本化 override，避免 smoke 依赖真实 Quick Input 自动化。

### 7.5 宿主执行路径

`src/panel/CanvasPanelManager.ts` 中的 Agent fresh-start 路径改成：

1. 从节点 metadata 取 `launchPreset/customLaunchCommand`
2. 结合当前 provider 设置，解析出“本次新会话要执行的完整命令”
3. 把首个 token 送入现有 resolver，拿到真正的可执行文件路径
4. 将其余 token 与 provider resume/file-activity 注入逻辑拼接，生成最终 `ExecutionSessionLaunchSpec`

边界如下：

- 当用户点击停止后 split button 的主按钮或菜单里的 `Resume 恢复原会话`，且节点持有可信恢复上下文时，仍走当前显式 session resume 路径；这条路径恢复的是“当前节点前面停止的那条会话”，不依赖 `launchPreset`。
- 当用户点击 `新会话` 时，才走上面的 fresh-start 路径。
- 若节点 `launchPreset = resume`，fresh-start 路径始终执行 provider 的“进入 resume 选择入口”预设命令，而不是偷偷替用户选择最近一条会话。
- 对 `Claude Code` 的 fresh-start，会在启动时继续传入候选 `--session-id`，并主动检查 `~/.claude/projects/.../<session-id>.jsonl` 是否已经出现；一旦文件存在，就把该 id 升级为可恢复上下文。停止时若再读到 `claude --resume <session-id>`，宿主会把它当作后续校验/更正信号；若两者都没有，才回退成不可恢复。停止按钮当前对 Claude 已回滚到更早的 provider-specific stop signal：不再发送 `Ctrl-C`，而是直接沿用此前的终止信号路径；Codex 才继续保留单次 `Ctrl-C` + 5 秒兜底的 graceful-stop 语义。
- 对 `Codex` 的 fresh-start，启动后仍先扫 `~/.codex/sessions/.../rollout-*.jsonl`；如果节点后来从 `running` 再次回到 `waiting-input` 且仍未拿到 session id，宿主会再触发一轮扫描，以覆盖首轮 discovery 的时序 miss。
- 标题栏停止按钮按 provider 走不同语义：Codex 先发单次 `Ctrl-C`，若 CLI 未正常退出，再走 5 秒 graceful-stop force-kill；Claude 则沿用更早的直接终止信号路径，不等待 stop-time `Ctrl-C` 收尾。

### 7.6 停止后的 split restart

在 `src/webview/main.tsx` 的 Agent 节点标题栏中，把当前单按钮换成 split button：

- 左侧主按钮：`重启`，默认走“恢复原会话”
- 右侧次按钮：展开菜单，提供 `Resume 恢复原会话` 与 `新会话`

正式规则：

- 只有当节点存在可信恢复上下文时，标题栏才显示 `重启 | ▼` split button。
- 若节点没有可恢复上下文，标题栏直接退化为单个 `启动` 按钮；不会再显示 disabled 的 split restart。
- `新会话` 始终按节点 metadata 的 fresh-start 配置执行。
- Webview 只表达用户意图；真正是否能 resume 仍由宿主以当前 metadata 判断。

## 8. 验证方法

至少需要完成以下验证：

1. Playwright harness 覆盖右键菜单的 provider drill-in、启动方式 drill-in、自定义输入校验与创建消息 payload。
2. Playwright harness 覆盖停止后 split restart 的主按钮恢复与下拉“新会话”分流。
3. VSCode smoke 覆盖命令面板 / 侧栏“创建节点”的两层 Quick Input，确认 Agent 选择后会进入完整命令编辑，并能用预设创建出持久化了正确 launchPreset 的节点。
4. 自动化验证 fresh-start 路径会把 `launchPreset/customLaunchCommand` 带入宿主执行，而不是丢失为默认命令。
5. `npm run typecheck`、`npm run test:webview` 至少通过；若 smoke 未跑全，要在结果中显式写明原因。

## 9. 当前验证状态

- 2026-04-24：已完成正式设计收口，并把 `tmp_feature_uiux.md` 的需求吸收到仓库文档。
- 2026-04-24：已运行 `npm run typecheck`，通过。
- 2026-04-24：已运行 `npm run build`，通过。
- 2026-04-24：已运行 `npm run test:webview`，当前为 `82 passed`，覆盖右键菜单 drill-in、自定义输入校验、IME Enter 防误触、去掉冗余取消按钮后的菜单路径，以及 split restart。
- 2026-04-24：已补充 Claude stop-time `claude --resume <session-id>` 提示校验，并把“无可信恢复上下文”的停止节点 UI 改成单个 `启动` 按钮；当前已完成构建与 targeted 回归，完整 smoke 仍待补跑。
- 2026-04-25：补充 provider 文件确认路径：Codex 在运行态再次回到 `waiting-input` 且尚未记录 session id 时会补扫 `~/.codex/sessions`；Claude fresh-start 则新增 `~/.claude/projects/.../<session-id>.jsonl` 文件存在性确认，并在已有文件确认时保留恢复上下文，不再被“缺少 stop-time hint”误清空。
- 2026-04-24：已重新运行 `npm run test:webview -- --grep "agent restart"`，当前为 `2 passed`，覆盖“可恢复时显示 split restart”与“不可恢复时退化为单个启动按钮”两条标题栏路径。
- 2026-04-24：`npm run test:smoke` 需要在沙箱外运行；补跑时 trusted 场景长时间停留在 VS Code 宿主空转状态，尚未完成，因此当前文档状态仍保持 `验证中`。
