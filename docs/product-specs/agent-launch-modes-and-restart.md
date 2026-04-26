# Agent 启动方式与重启交互规格

当前状态：已确认。本文收口 Agent 节点在创建前选择 provider、启动方式、默认启动参数，以及停止后“恢复原会话 / 新会话”分流的正式产品语义。`docs/product-specs/canvas-navigation-and-workbench-polish.md` 继续负责空白区右键入口与节点落点规则，但 Agent 相关的多级创建与重启交互以本文为准。

## 1. 用户问题

当前仓库已经支持：

- 右键空白区或侧栏命令面板创建 `Agent`
- 创建前选择 provider
- Agent 停止后继续通过单按钮重新启动或恢复

但这条主路径仍有三个明显摩擦：

- 用户想在创建前指定更明确的启动方式，例如 `Resume`、更激进的自动执行模式，或更保守的受限模式时，当前入口仍然只能先创建，再依赖默认 CLI 行为。
- VSCode 命令面板 / 侧栏“创建节点”当前只能一步选到 provider，无法在同一条创建链路里确认“本次真正要执行的完整启动命令”。
- 已停止的 Agent 目前只有单一“重启/恢复”动作，无法清楚区分“恢复原会话”和“启动新会话”。

## 2. 目标用户

目标用户是已经把 Dev Session Canvas 当作 VSCode 内多会话工作台使用的开发者。他们通常已经在本机安装并使用 `Codex` 或 `Claude Code`，希望在不离开画布的前提下，用更低摩擦的方式创建带启动偏好的 Agent，并在会话结束后明确选择“继续原上下文”还是“开一条新会话”。

## 3. 核心用户流程

1. 用户在画布空白区右键，进入 `新建节点` 菜单。
2. 若直接点击 `Agent` 主按钮，则按默认 provider 和默认启动参数快速创建 Agent。
3. 若展开 `Agent`，先选 provider，再选 `快速启动 / Resume / YOLO / 沙盒 / 自定义启动`。
4. 若选择 `自定义启动`，用户在菜单旁输入完整启动命令；创建动作以当前输入框内容为准。
5. 无论来自右键菜单还是命令面板，创建前的 `Resume` 都表示“让 CLI 进入自己的 resume 会话选择入口”：`Codex` 对应 `codex resume`，`Claude Code` 对应 `claude --resume`；它不是直接替用户恢复最近一条会话。
6. 若通过命令面板或侧栏“创建节点”入口创建 Agent，先选对象/provider，再进入带输入框的第二步 Quick Input；输入框展示完整命令，下方 `默认 / Resume / YOLO / 沙盒` 列表只负责快捷替换，不直接创建。
7. Agent 停止后，只有在节点仍持有可信的原会话恢复上下文时，标题栏才显示 `重启 | ▼` split button；否则直接退化成单个 `启动` 按钮。这里的“恢复原会话”始终指当前节点前面停止的那条会话，而不是 provider 最近一次全局会话。

## 4. 在范围内

- 画布空白区右键菜单中的 Agent 多级创建：
  - 顶层仍保持 `Agent / Terminal / Note` 三类对象。
  - `Agent` 顶层项采用 split button：主按钮直接创建默认 Agent，次按钮进入 provider 选择。
  - provider 选择层对 `Codex` / `Claude Code` 同样采用 split button：主按钮直接按该 provider 的默认启动方式创建，次按钮进入启动方式选择。
  - 启动方式层至少提供 `快速启动`、`Resume`、`YOLO`、`沙盒`、`自定义启动`。
- VSCode Quick Input 创建链路：
  - 第一层仍保持“创建对象 + 按类型创建 Agent”的现有语义分组。
  - 只要用户在第一层选中任意 `Agent` 入口，第二层必须进入“完整启动命令编辑”界面。
  - 第二层顶部输入框始终代表本次真正要执行的完整命令；按 Enter 直接创建，不额外增加“创建”按钮。
  - `默认 / Resume / YOLO / 沙盒` 项只替换输入框内容，不直接创建。
- 默认启动参数设置：
  - 新增按 provider 分开的默认启动参数设置；它们只负责参数片段，不取代原有 provider 命令路径设置。
  - 这组默认启动参数设置使用 `window` scope；用户应能在窗口 / 工作区范围覆盖它们。
  - 默认启动参数同时用于“快速启动”与“自定义启动”的预填充。
  - 若某个 provider 的默认启动参数本身无法被命令行 parser 正常解析，右键菜单、Quick Input 与宿主 fresh-start 都必须显式报错，不能静默清空这段参数后继续启动。
- Agent 停止后的 split restart：
  - 主按钮文案为 `重启`，语义是“优先恢复原会话”。
  - 下拉菜单至少提供 `Resume 恢复原会话` 与 `新会话`。
  - 这里的“恢复原会话”始终指当前节点自己刚停止的会话；如果没有这条会话，就不能把它退化成 provider 的“最近一次会话”。
  - 若当前节点没有可恢复的原会话，标题栏不再显示 disabled 的 split restart，而是直接显示单个 `启动` 按钮。
- 自定义启动输入约束：
  - 输入不能为空。
  - 输入的首个命令 token 必须属于当前 provider 的可接受命令（当前设置值本身，或该 provider 的标准命令别名）。
  - “当前设置值本身”按完整 token 判断，不接受仅 basename 相同、但实际路径不同的其他二进制。
  - 命令行解析必须兼容 Windows 常见绝对路径写法，不能把 `C:\tools\codex.exe` 或 `"C:\Program Files\Codex\codex.exe"` 里的 `\` 当作通用 escape 并吞掉。
  - 宿主在接收创建消息与真正执行 fresh-start 前，都必须按同一规则重复校验；不能只依赖 Webview 侧校验。
  - 对 `Claude Code` 而言，只要自定义启动里已经显式写了 `--session-id` / `--resume` / `--continue`，无论是空格分隔还是 `--flag=value` 形式，宿主都不能再追加第二份会话参数。
  - 验证失败时，输入框进入错误态，确认动作禁用。
- 可访问性与键盘语义：
  - 右键菜单和停止节点的下拉菜单都支持 `Escape` 关闭。
  - 在右键菜单的 Agent 分层里，`Escape` 优先返回上一级；只有在根层才关闭整个菜单。
  - 自定义启动输入打开后，第一次 `Escape` 必须先关闭输入框，而不是整个菜单；即使焦点已经移到“确定”按钮或同层其他控件，也仍然遵循这条规则。

## 5. 不在范围内

- 运行中 Agent 的 provider 切换。
- 重新设计 Agent 生命周期状态机或 provider resume 的正式可信绑定规则；这些仍以现有执行生命周期与恢复设计文档为准。
- 为所有 provider 暴露“查询最近可恢复会话列表”的新 UI。
- 让 `Resume / YOLO / 沙盒` 覆盖所有 CLI 的全部语义差异；本轮只提供仓库内定义的 provider 预设。
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
- 当前主按钮是否可执行 `Resume`
- 下拉菜单是否展开
- 用户本次选择的是 `Resume` 还是 `新会话`
- Agent 节点副标题是否显示本节点最近一次实际启动指令；当副标题被截断时，hover 需要显示完整指令

## 7. 验收标准

- 在画布空白区右键后，用户仍先看到 `Agent / Terminal / Note`；其中 `Agent` 可直接快速创建，也可逐级进入 provider 与启动方式选择。
- 在 provider 选择层点击 `Codex` 或 `Claude Code` 主按钮时，会直接创建该 provider 的默认启动 Agent，而不会额外打开第三层。
- 在启动方式层点击 `YOLO` 或 `沙盒` 时，创建出的 Agent 会持久化对应的新会话启动预设，而不是只影响一次性 UI。
- 在启动方式层点击 `Resume` 时，创建出的 Agent 会以 provider 的 resume 选择入口启动；用户随后在 CLI 内自己选择要恢复哪条会话。
- 在启动方式层点击 `自定义启动` 时，会打开就地输入框；输入框预填“provider 命令 + 默认启动参数”，输入非法命令时不能确认创建。
- 即使有人伪造 Webview 消息或手工注入旧 metadata，只要自定义命令的首个 token 不再属于当前 provider，宿主也会在创建或启动前直接拒绝，不会去解析或执行该命令。
- 命令面板 / 侧栏“创建节点”里的 Agent 入口会进入第二步 Quick Input；第二步顶部输入框展示完整命令，点击 `默认 / Resume / YOLO / 沙盒` 只会替换输入框内容，不会直接创建。
- 第二步 Quick Input 不额外增加“创建”按钮；按 Enter 会按当前输入框内容创建 Agent。
- 通过设置修改某个 provider 的默认启动参数后，后续新的“快速启动”和“自定义启动”预填内容会同步变化。
- Agent 节点标题下方的副标题显示该节点最近一次实际启动指令；若节点尚未真正启动，则显示按当前 metadata 与设置推导出的下一次 fresh-start 指令。
- 当副标题中的启动指令超出可见宽度时，鼠标悬停副标题区域会显示完整启动指令；未截断时不额外显示 hover 文案。
- 停止后的 Agent 节点标题栏显示 split button；主按钮默认恢复原会话，下拉菜单允许改成“新会话”。
- 当节点缺少可恢复上下文时，标题栏只显示单个 `启动` 按钮，不再显示 disabled 的 `重启 | ▼` split button；也不会偷偷改成恢复 provider 的最近会话。
- 对 `Claude Code` 的 fresh-start，如果启动后已根据候选 `session-id` 确认 provider 会话文件存在，即使 stop-time 没再额外打印 resume 提示，节点也应继续保留“恢复原会话”入口；只有既没有文件确认也没有 stop-time 提示时，才退化为单个 `启动` 按钮。

## 8. 开放问题

- `Resume` 创建预设在不同 provider 上都依赖各自的“继续最近一次/显式恢复” CLI 语义；若未来需要让用户先选具体 session id，再创建对应节点，应另开规格。
- `YOLO` 与 `沙盒` 目前是仓库内维护的 provider 预设；若未来 CLI 官方语义变化，需同步校正文档、预设映射和验证用例。
