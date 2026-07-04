# Agent 启动方式与重启交互规格

当前状态：已确认。本文收口 Agent 节点在创建前选择 provider、启动方式、默认启动参数、停止后“恢复原会话 / 新会话”分流，以及从当前 Codex / Claude Code 会话 Fork 出新 Agent 节点的正式产品语义。`docs/product-specs/canvas-navigation-and-workbench-polish.md` 继续负责空白区右键入口与节点落点规则，但 Agent 相关的多级创建、重启与 Fork 交互以本文为准。

## 1. 用户问题

当前仓库已经支持：

- 右键空白区或侧栏命令面板创建 `Agent`
- 创建前选择 provider
- Agent 停止后继续通过单按钮重新启动或恢复
- 侧栏会话历史恢复为新的 Agent 节点

但这条主路径仍有四个明显摩擦：

- 用户想在创建前指定更明确的启动方式，例如 `Resume`、更激进的自动执行模式，或更保守的受限模式时，当前入口仍然只能先创建，再依赖默认 CLI 行为。
- VSCode 命令面板 / 侧栏“创建节点”当前只能一步选到 provider，无法在同一条创建链路里确认“本次真正要执行的完整启动命令”。
- 已停止的 Agent 目前只有单一“重启/恢复”动作，无法清楚区分“恢复原会话”和“启动新会话”。
- 当用户想像网页对话里的 Fork 一样，从当前 Codex / Claude Code 会话上下文分出一个新窗口继续探索时，只能先去侧栏历史里手动恢复；这既不是当前节点的一键动作，也不会使用 provider 原生 fork 语义创建新的 session / thread。

## 2. 目标用户

目标用户是已经把 Dev Session Canvas 当作 VSCode 内多会话工作台使用的开发者。他们通常已经在本机安装并使用 `Codex` 或 `Claude Code`，希望在不离开画布的前提下，用更低摩擦的方式创建带启动偏好的 Agent，在会话结束后明确选择“继续原上下文”还是“开一条新会话”，并能从当前 Codex / Claude Code Agent 直接 Fork 出一个新节点继续探索不同方向。

## 3. 核心用户流程

1. 用户在画布空白区右键，进入 `新建节点` 菜单。
2. 第一屏直接显示 `Note`、`Terminal`，以及按当前默认 provider 优先排序的 provider 列表；默认 provider 只在名称后追加 `（默认）` 标识，不再单独保留一个泛化的 `Agent` 顶层项。
3. 点击某个 provider 主按钮时，按该 provider 的默认启动方式直接创建 Agent；点击同一行次按钮时，才进入 `快速启动 / Resume / YOLO / 沙盒 / 自定义启动`。
4. 若选择 `自定义启动`，用户在菜单内就地输入完整启动命令；创建动作以当前输入框内容为准。
5. 无论来自右键菜单还是命令面板，创建前的 `Resume` 都表示“让 CLI 进入自己的 resume 会话选择入口”：`Codex` 对应 `codex resume`，`Claude Code` 对应 `claude --resume`；它不是直接替用户恢复最近一条会话。
6. 若通过命令面板或侧栏“创建节点”入口创建 Agent，先选对象/provider，再进入带输入框的第二步 Quick Input；列表第一项是 `使用自定义命令创建`，下方是 `默认 / Resume / YOLO / 沙盒` 模式项。页面打开时默认高亮 `默认`；选择某个模式会替换输入框并保持该模式高亮，用户手动编辑后才切回 `使用自定义命令创建`。
7. 即使当前 workspace 未受信任，右键菜单和命令面板里的 Agent / Terminal 创建入口也仍然保持可见；只有在用户真正尝试创建时，扩展才弹出宿主 modal，解释为什么当前不能创建执行型节点。
8. Agent 停止后，只有在节点仍持有可信的原会话恢复上下文时，标题栏才显示并列的 `新建 | 重启` 按钮；否则直接退化成单个 `启动` 按钮。这里的“重启/恢复原会话”始终指当前节点前面停止的那条会话，而不是 provider 最近一次全局会话；`新建` 则沿用该节点的新会话启动配置。
9. 对已经持有可信 Codex 或 Claude Code session id 的 Agent 节点，用户可以在节点标题栏点击 `分叉`；扩展会创建一个同 provider 的新 Agent 节点并立即用 provider 原生 fork 语义启动：Codex 使用 `codex fork <session-id>`，Claude Code 使用 `claude --resume <session-id> --fork-session`。旧节点保持不变，新节点通过标题弱提示来源，并自动用一条标注为 `fork` 的普通可编辑 `user` 边连接来源；这条边不引入正式父子分支树或机器可读 lineage。

## 4. 在范围内

- 画布空白区右键菜单中的 Agent 多级创建：
  - 顶层改成 `Note / Terminal / provider 列表`；不再保留单独的泛化 `Agent` 顶层项。
  - provider 列表按“默认 provider 在前，其余 provider 按既定顺序排后”显示；默认 provider 只通过 `（默认）` 文案标识。
  - `Codex` / `Claude Code` 行仍采用 split button：主按钮直接按该 provider 的默认启动方式创建，次按钮进入启动方式选择。
  - 启动方式层至少提供 `快速启动`、`Resume`、`YOLO`、`沙盒`、`自定义启动`。
  - 启动方式层的每个说明区都必须有固定上限；默认启动命令过长时以 `...` 截断，且 hover 时显示完整指令。
- VSCode Quick Input 创建链路：
  - 第一层仍保持“创建对象 + 按类型创建 Agent”的现有语义分组。
  - 只要用户在第一层选中任意 `Agent` 入口，第二层必须进入“完整启动命令编辑”界面。
  - 第二层顶部输入框始终代表本次真正要执行的完整命令；打开时默认高亮 `默认` 模式。
  - `默认 / Resume / YOLO / 沙盒` 预设项排在 `使用自定义命令创建` 下方；切换预设时替换输入框并保持对应模式高亮，手动编辑输入框后切回 `使用自定义命令创建`。
  - 如果当前 workspace 未受信任，则这两层入口仍然显示；但在用户真正确认创建时，扩展必须改为弹出解释原因的宿主 modal，而不是静默不显示这些入口。
- 默认启动参数设置：
  - 新增按 provider 分开的默认启动参数设置；它们只负责参数片段，不取代原有 provider 命令路径设置。
  - 这组默认启动参数设置使用 `window` scope；用户应能在窗口 / 工作区范围覆盖它们。
  - 默认启动参数同时用于“快速启动”与“自定义启动”的预填充。
  - 默认启动参数只适合放稳定的 runtime/configuration 参数，不适合放一次性的会话目标、picker 范围、Fork 标记，或 Codex 里会与 `resume` / `fork` 目标位置混淆的裸 positional prompt/session；这些参数会与后续 `Resume / Fork` 动作争夺目标语义，必须改用对应入口或本次自定义启动命令。
  - `Codex` 默认启动参数中禁止出现 `resume`、`fork`、`--last`、`--all`、`--include-non-interactive`、`--`，以及不属于已知 option value 的裸 positional token；`Claude Code` 默认启动参数中禁止出现 `--resume` / `-r`、`--continue` / `-c`、`--session-id` 与 `--fork-session`，含 `--flag=value` 和空格分隔形式。
  - 当用户显式选择 `YOLO / 沙盒` 这类执行策略预设时，扩展只会覆盖仓库当前已文档化支持的少量已知冲突 flag，而不是尝试对所有 CLI 参数做通用归一化；若用户需要更复杂的参数组合，必须改走 `自定义启动`。
  - 对 `Resume / YOLO / 沙盒` 这类显式模式参数，生成出来的 argv 应尽量前置到命令前部，而不是简单追加到整条命令末尾。
  - 当前已知冲突集合仅包括：`Codex` 的 `--yolo` / `--full-auto` / `--dangerously-bypass-approvals-and-sandbox` / `--sandbox` / `-s` / `--ask-for-approval` / `-a`（以及这些长短选项的 `--flag=value` 形式），以及 `Claude Code` 的 `--dangerously-skip-permissions` / `--permission-mode`。
  - 上述有限覆盖只作用于执行策略本身；“恢复哪条会话”的语义不属于 Default args。若用户需要一次性指定 `resume --last`、`resume <session-id>`、`--resume <session-id>`、`--continue <session-id>`、`--session-id <id>` 或 Fork 标记，应改走 `Resume / 分叉` 入口或本次自定义启动命令，而不是写入默认启动参数。
  - 当用户显式选择创建前的 `Resume` 预设时，本次 fresh-start 仍统一收口为 provider 自己的 resume 选择入口：`Codex` 生成 `codex resume`，`Claude Code` 生成 `claude --resume`；如果默认启动参数已经含上述会话目标类冲突项，扩展必须先报错并拒绝启动，不能静默替换后继续执行。
  - 若恢复路径来自侧栏历史会话且已经持有明确的目标 `session-id`，生成的显式 resume 命令只继承对显式 resume 仍有效的默认参数，例如 `--model`、`--sandbox`、`--ask-for-approval`、`--profile`、`--config`、`--cd`、`--add-dir`。`--last`、`--all`、`--include-non-interactive` 与旧 positional session/prompt 不应出现在 Default args；若出现应显式报错。
  - 当前节点的 `重启` / `分叉` 必须只继承该节点的启动意图，不与当前 Default args 合并。节点启动意图优先采用该节点最近一次实际启动命令；若尚无最近启动命令，再退回 `launchPreset`、`customLaunchCommand` 与模板落地的 `templateArgv`。命令层会剥离其中的旧 session-target / fork-target，再由本次动作写入唯一目标 `session-id`。
  - 侧栏历史恢复 / 历史分叉不能宣称继承历史会话原始启动参数：当前 provider 历史扫描只能可靠拿到 `provider`、`sessionId`、`cwd`、时间和首条用户指令，不能拿到原始 argv / command line；因此历史入口只使用历史项 session id / cwd 与当前 provider 命令、当前 Default args。
  - `Fork` / 显式 `Resume` 的目标选择以本次动作的显式 `session-id` 为准。历史入口可以继续使用当前 Default args 中合法的 runtime/configuration 参数；当前节点入口则只使用节点自己的启动意图，避免用户修改 Default args 后改写已有节点的重启 / 分叉行为。
  - Claude Code 历史显式 `Resume / Fork` 只继承 Default args 中的 `--model`、`--permission-mode`、`--dangerously-skip-permissions`、MCP / tool / output 等非 session-target 参数；当前节点 `重启` / `分叉` 同样只继承节点启动意图，不额外合并 Default args。
  - 若某个 provider 的默认启动参数本身无法被命令行 parser 正常解析，或包含与 `Resume / Fork` 冲突的会话目标类参数，右键菜单、Quick Input 与宿主 fresh-start 都必须显式报错，不能静默清空或清理这段参数后继续启动。
- Agent 停止后的 `新建 | 重启` 动作：
  - `新建` 按钮启动新会话，沿用节点 metadata 中的 fresh-start 配置。
  - `重启` 按钮恢复原会话，语义等同于旧下拉菜单中的 `Resume 恢复原会话`。
  - `重启` 不是裸 resume：若当前节点原本以 `YOLO / 沙盒 / 自定义启动 / 模板 argv` 创建或保存，恢复原会话时应继续带上这些不与显式 session id 冲突的启动意图。
  - 这里的“恢复原会话”始终指当前节点自己刚停止的会话；如果没有这条会话，就不能把它退化成 provider 的“最近一次会话”。
  - 若当前节点没有可恢复的原会话，标题栏不再显示 `新建 | 重启` 双按钮，而是直接显示单个 `启动` 按钮。
- Agent 的 `分叉`（Fork）动作：
  - `分叉` 对持有可信 `codex-session-id` 的 Codex Agent、持有可信 `claude-session-id` 的 Claude Code Agent 生效；其他 provider 或缺少可信 session id 的节点不暴露该能力。
  - Codex 的可信 session id 来源沿用现有 Codex 恢复上下文确认规则；Claude Code 的可信 session id 来源沿用现有 Claude Code 恢复上下文确认规则。
  - 点击 `分叉` 后，宿主创建一个同 provider 的新 Agent 节点并立即启动，不要求用户再点一次 `启动`。
  - 新节点启动命令必须使用对应 provider 原生 fork 语义：Codex 使用 `codex fork <session-id>`，Claude Code 使用 `claude --resume <session-id> --fork-session`；它们都不是普通 resume。
  - 当前节点 `分叉` 和当前节点 `重启` 共享同一条启动意图继承规则；例如从 `YOLO` Codex 节点分叉时，新分叉命令应包含 `fork --yolo ... <session-id>`，而不是只使用或合并当前 Default args。
  - Codex 当前节点分叉命令生成必须只信任当前节点的显式 session id 和节点启动意图；Default args 不参与当前节点分叉。历史分叉仍会使用当前 Default args 中合法的非会话目标配置，并拒绝 `fork` / `resume`、`--last`、`--all`、`--include-non-interactive` 或旧 positional target。
  - 旧节点保持不变，用户仍可继续在旧节点对话；新节点通过标题弱提示来源，并自动创建一条普通可编辑 `user` 边，边标签默认为 `fork`；这条边不表示正式父子边、分支树或强持久化分支关系。
  - 新分叉节点和普通 Agent 节点一样在标题栏显示状态胶囊；窄节点下沿用 PR121 的局部压缩规则：标题栏整体仍保持一行主结构，只有可压缩的动作按钮自身按内容收缩或内部换行，不让整组动作区换行打散布局，也不通过隐藏状态来腾空间。当前 Agent 节点接近最小宽度时，标题栏右上角所有动作按钮统一切换为按钮内部两行显示，避免短中文文案因为浏览器 `min-content` 宽度保护而永远看不到可见换行。
- 自定义启动输入约束：
  - 输入不能为空。
  - 输入的首个命令 token 必须属于当前 provider 的可接受命令（当前设置值本身，或该 provider 的标准命令别名）。
  - “当前设置值本身”按完整 token 判断，不接受仅 basename 相同、但实际路径不同的其他二进制。
  - 命令行解析必须兼容 Windows 常见绝对路径写法，不能把 `C:\tools\codex.exe` 或 `"C:\Program Files\Codex\codex.exe"` 里的 `\` 当作通用 escape 并吞掉。
  - 宿主在接收创建消息与真正执行 fresh-start 前，都必须按同一规则重复校验；不能只依赖 Webview 侧校验。
  - 对 `Claude Code` 而言，只要自定义启动里已经显式写了 `--session-id` / `--resume` / `--continue`，无论是空格分隔还是 `--flag=value` 形式，宿主都不能再追加第二份会话参数。
  - 验证失败时，输入框进入错误态，确认动作禁用。
- 可访问性与键盘语义：
  - 右键菜单支持 `Escape` 关闭；停止节点标题栏不再提供下拉菜单。
  - 在右键菜单的 Agent 分层里，`Escape` 优先返回上一级；只有在根层才关闭整个菜单。
  - 自定义启动输入打开后，第一次 `Escape` 必须先关闭输入框，而不是整个菜单；即使焦点已经移到“确定”按钮或同层其他控件，也仍然遵循这条规则。
- CLI 缺失补救：
  - 右键创建 `Codex` / `Claude Code` Agent 后，如果启动阶段因为当前执行宿主没有找到对应 CLI 命令而失败，宿主必须自动打开与侧栏概览 `Codex 命令` / `Claude Code 命令` 行相同的 CLI 选择 Quick Input；如果仍未发现可用 CLI，该 Quick Input 继续提供 `命令行安装` 与 `安装 VS Code 插件` 两级安装分流。

## 5. 不在范围内

- 运行中 Agent 的 provider 切换。
- 重新设计 Agent 生命周期状态机或 provider resume 的正式可信绑定规则；这些仍以现有执行生命周期与恢复设计文档为准。
- 为所有 provider 暴露“查询最近可恢复会话列表”的新 UI。
- 让 `Resume / YOLO / 沙盒` 覆盖所有 CLI 的全部语义差异；本轮只提供仓库内定义的 provider 预设。
- 为缺少已确认 provider 原生 fork 语义的其他 provider 实现 Fork；普通 resume 不能冒充 Fork。
- 在画布上维护正式分支树、父子边、branch lineage 管理器或跨节点合并语义。
- 重新设计 Terminal 或 Note 的创建交互。

## 6. 关键对象与状态

### 创建前状态

- 当前默认 provider
- 每个 provider 的命令路径设置
- 每个 provider 的默认启动参数设置
- 右键菜单当前层级、当前 provider、当前输入框值与验证状态
- Quick Input 当前 provider、输入框值与快捷替换项

### Agent 持久化配置

- provider kind
- 新会话启动预设：`default | resume | yolo | sandbox | custom`
- 自定义完整启动命令（仅 `custom` 时持久化）

### 停止后重启状态

- 当前节点是否存在可信的原会话恢复上下文
- `Codex` 是否已经通过会话文件扫描或 stop-time `codex resume <session-id>` 提示拿到可信 session id；若运行中还没拿到，会在节点再次回到 `waiting-input` 时补扫一轮
- `Claude Code` 是否已经通过候选 `session-id` 对应的 provider 会话文件落盘，或在结束输出里出现 `claude --resume <session-id>`；两者任一成立，都可以确认当前 fresh-start 会话具备恢复入口
- 若 Claude 启动命令里已经显式给出 session 相关 flag 且带有 session id，则后续文件确认与持久化必须以这条显式 session id 为准，而不是继续使用宿主生成的候选值
- `重启` 按钮是否可执行 `Resume`
- `分叉` 按钮是否可执行 provider 原生 fork；Codex 依赖可信 `codex-session-id` 并执行 `codex fork <session-id>`，Claude Code 依赖可信 `claude-session-id` 并执行 `claude --resume <session-id> --fork-session`
- 用户本次选择的是 `新建`、`重启` 还是 `分叉`
- Agent 节点副标题是否显示本节点最近一次实际启动指令；当副标题被截断时，hover 需要显示完整指令
- Agent 节点标题与副标题在宽节点上是否仍保持固定可读宽度上限，而不是随节点尺寸无限拉长

## 7. 验收标准

- 在画布空白区右键后，用户先看到 `Note / Terminal / provider 列表`；默认 provider 排在 provider 列表第一位，并仅用 `（默认）` 标识。
- 点击根层中的 `Codex` 或 `Claude Code` 主按钮时，会直接创建该 provider 的默认启动 Agent，而不会额外打开启动方式层。
- 在启动方式层点击 `YOLO` 或 `沙盒` 时，创建出的 Agent 会持久化对应的新会话启动预设，而不是只影响一次性 UI。
- 在启动方式层点击 `Resume` 时，创建出的 Agent 会以 provider 的 resume 选择入口启动；用户随后在 CLI 内自己选择要恢复哪条会话。
- 在启动方式层点击 `自定义启动` 时，会打开就地输入框；输入框预填“provider 命令 + 默认启动参数”，输入非法命令时不能确认创建。
- 启动方式层中任何过长的默认命令或说明都不会把菜单撑高到不可控；超长内容以 `...` 截断，并在 hover 时显示完整指令。
- 即使有人伪造 Webview 消息或手工注入旧 metadata，只要自定义命令的首个 token 不再属于当前 provider，宿主也会在创建或启动前直接拒绝，不会去解析或执行该命令。
- 命令面板 / 侧栏“创建节点”里的 Agent 入口会进入第二步 Quick Input；第二步输入框展示完整命令，第一项 `使用自定义命令创建` 使用当前输入框创建自定义 Agent。
- 第二步 Quick Input 打开时默认高亮 `默认`；选择 `默认 / Resume / YOLO / 沙盒` 会替换输入框并保持该模式高亮，手动编辑输入框后才切回 `使用自定义命令创建`。
- 若用户在第二步 Quick Input 里显式点击了某个预设，且最终输入框内容仍等价于该预设对应的完整命令，则节点 metadata 中持久化的 `launchPreset` 以这次显式选择为准；不能因为该命令刚好和 `default` 文本等价，就把显式 `YOLO / 沙盒 / Resume` 降级成 `default`。
- 当 workspace 未受信任时，命令面板 / 侧栏“创建节点”第一层仍显示 `Agent` 与各 provider 入口；如果用户最终确认创建 Agent，扩展会弹出宿主 modal 解释“当前 workspace 未受信任，因此不能创建 Agent”，且不会创建节点。
- 通过设置修改某个 provider 的默认启动参数后，后续新的“快速启动”和“自定义启动”预填内容会同步变化。
- 如果某个 provider 的默认启动参数包含 `resume` / `fork` / `--last` / `--resume` / `--session-id` / `--fork-session` 等会话目标类参数，创建菜单、Quick Input 与宿主启动都会明确报错，不会把这些参数作为 Default args 自动剥离后继续启动。
- Agent 节点标题下方的副标题显示该节点最近一次实际启动指令；若节点尚未真正启动，则显示按当前 metadata 与设置推导出的下一次 fresh-start 指令。
- 当副标题中的启动指令超出可见宽度时，鼠标悬停副标题区域会显示完整启动指令；未截断时不额外显示 hover 文案。
- 即使用户把 Agent 节点拖得更宽，标题与副标题仍维持固定可读宽度上限，不会跟着无限拉长。
- 停止后的 Agent 节点标题栏显示并列的 `新建 | 重启` 按钮；`新建` 直接启动新会话，`重启` 恢复当前节点原会话。
- 如果当前节点的启动意图是 `YOLO / 沙盒 / 自定义启动 / 模板 argv`，点击 `重启` 或 `分叉` 后的实际启动命令仍保留这些非目标选择参数，并且不合并当前 Default args；侧栏历史恢复 / 分叉不做这类继承，因为历史记录没有可靠原始启动参数。
- 当节点缺少可恢复上下文时，标题栏只显示单个 `启动` 按钮，不再显示 disabled 的 `新建 | 重启` 双按钮；也不会偷偷改成恢复 provider 的最近会话。
- 对 `Claude Code` 的 fresh-start，如果启动后已根据候选 `session-id` 确认 provider 会话文件存在，即使 stop-time 没再额外打印 resume 提示，节点也应继续保留“恢复原会话”入口；只有既没有文件确认也没有 stop-time 提示时，才退化为单个 `启动` 按钮。
- 对持有可信 `codex-session-id` 的 Codex Agent 或可信 `claude-session-id` 的 Claude Code Agent，标题栏提供 `分叉` 动作；点击后创建同 provider 的新 Agent 节点并立即启动，Codex 启动命令包含 `fork <session-id>`，Claude Code 启动命令包含 `--resume <session-id> --fork-session`，原节点状态不变化。
- Codex 当前节点 `分叉` 启动命令不会合并 Default args；合法启动时最终命令只以当前节点可信 session id 作为分叉目标，并继承当前节点启动意图。历史分叉若遇到 Default args 中包含 `--last`、`--all`、`--include-non-interactive` 或旧 session id，扩展会先报错要求用户修正 Default args。
- 新分叉节点标题弱提示来源，例如以当前节点标题加 `分叉` 后缀表达；画布自动创建来源 Agent 指向新 Agent 的普通可编辑 `user` 边，并默认显示 `fork` 标签，但不新增正式父子边，也不要求用户区分哪个节点是“主分支”。
- 新分叉节点标题栏继续显示状态胶囊，并在 `启动/停止`、`删除` 等动作旁保持和普通 Agent 节点一致的状态反馈；窄宽度时应采用 PR121 式的按钮级压缩/内部换行，标题栏 action cluster 本身保持 inline，不应整组换行破坏布局，也不应隐藏状态。当前 Agent 节点接近最小宽度时，右上角所有动作按钮都应实际呈现为按钮内部两行，而不是只声明允许换行。
- 缺少可信 session id、provider 与 resume strategy 不匹配，或其他未支持 provider 的 Agent 不会误触发分叉启动。
- 通过右键创建 `Codex` / `Claude Code` Agent 时，若 CLI 未安装或命令无法解析，节点会进入明确错误态，同时自动弹出和侧栏概览命令行相同的 CLI 选择/安装 Quick Input，用户不需要再去侧栏手动寻找修复入口。

## 8. 开放问题

- `Resume` 创建预设在不同 provider 上都依赖各自的“继续最近一次/显式恢复” CLI 语义；若未来需要让用户先选具体 session id，再创建对应节点，应另开规格。
- `YOLO` 与 `沙盒` 目前是仓库内维护的 provider 预设；若未来 CLI 官方语义变化，需同步校正文档、预设映射和验证用例。
- `Fork` 当前只收口 Codex 的 `codex fork <session-id>` 与 Claude Code 的 `--fork-session` 语义；若未来其他 provider 提供等价能力，应另行补充 provider-specific 规则，而不是把普通 resume 当作 Fork。
