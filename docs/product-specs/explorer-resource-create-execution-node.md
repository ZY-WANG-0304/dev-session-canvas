# File Explorer 资源右键创建执行节点规格

当前状态：已确认，已实现并通过自动化验证。本文收口从 VSCode File Explorer 的 workspace 内目录或普通文件右键，在 Dev Session Canvas 中创建绑定目标 cwd 的 `Terminal` / `Agent` 节点的产品范围与验收口径。对普通文件，cwd 使用该文件所在父目录；实现方案与技术边界见 `docs/design-docs/explorer-resource-create-execution-node.md`。

## 1. 用户问题

开发者在 VSCode File Explorer 中浏览项目目录或文件时，常常已经明确知道下一条终端或 Agent 会话应该从哪个代码上下文开始工作。当前创建 `Terminal` / `Agent` 的入口默认使用 workspace 根目录，用户需要创建后再手动 `cd` 到目录或文件所在目录，这会带来三类摩擦：

- 资源上下文已经在 Explorer 右键动作中表达，却没有传递到画布节点。
- `Agent` 的启动 cwd 会影响项目配置、工具权限、文件活动和会话恢复，启动后再 `cd` 太晚。
- 多根 workspace 或较深目录结构中，用户难以从画布上看出某个 Agent 实际负责哪个目录上下文。

## 2. 目标用户

目标用户是已经在 VSCode workspace 内使用 Dev Session Canvas 并行管理多个 `Agent` / `Terminal` 的开发者。他们熟悉 VSCode Explorer 的目录和文件右键菜单，并希望从当前关注的代码目录或文件直接发起对应的画布执行节点，而不是先切回画布再手动调整工作目录。

## 3. 核心用户流程

1. 用户在 VSCode File Explorer 中右键点击当前 workspace 内的某个目录或普通文件。
2. 用户在右键菜单中选择“在 Canvas 中创建 Terminal”或“在 Canvas 中创建 Agent”。如果右键目标是文件，系统自动使用该文件的父目录作为 cwd。
3. 若选择 `Terminal`，画布打开或定位后创建一个 Terminal 节点；如果当前窗口已经有打开的主画布 surface，则复用该 surface；该节点首次自动启动时就在解析后的目标目录 cwd 中运行。
4. 若选择 `Agent`，扩展复用现有 Agent 创建 Quick Input，让用户选择 provider、启动方式或自定义启动命令；确认后创建 Agent 节点，并在解析后的目标目录 cwd 中启动。
5. 新节点优先出现在当前画布视口附近；若画布尚未 ready，则使用宿主已有默认落点与避碰规则。
6. Terminal 节点标题栏不额外显示 cwd 标签；用户通过终端 prompt / `pwd` 等终端内容理解当前路径。
7. Agent 节点标题上方显示 `cwdLabel`，标题下方副标题显示启动命令，让用户在画布上直接看到该 Agent 的目录上下文和启动方式。
8. 节点停止后，Terminal 的重启、Agent 的新建会话或恢复原会话都继续使用该节点绑定的 cwd，不回退到 workspace 根目录。
9. 在侧栏节点列表中，Agent 节点第二行显示 `cwdLabel · provider · 状态`，帮助用户不进入画布也能区分多个目录上下文中的 Agent。

## 4. 在范围内

- Explorer 资源右键入口：
  - 在 `explorer/context` 中为 workspace 内目录和普通文件提供创建 `Terminal` 和创建 `Agent` 两个入口。
  - 当右键资源是目录时，cwd 使用该目录。
  - 当右键资源是普通文件时，cwd 自动使用该文件所在父目录；节点不自动关联该文件，也不把文件路径写入 Agent 启动命令。
  - 第一版只支持 `file` scheme 的目录和普通文件资源；不支持虚拟 workspace 或非文件资源。
- 资源与目录校验：
  - 右键资源必须是当前 workspace 内的目录或普通文件。
  - 文件资源会先解析为父目录；最终 cwd 必须是当前 workspace 内存在的目录。
  - 资源不存在、不是目录或普通文件、解析后的 cwd 不存在、cwd 不是目录或不属于当前 workspace 时，不创建节点，并给出明确反馈。
  - 未信任 workspace 下继续遵循现有执行型节点创建和启动限制；不能通过 Explorer 入口绕过 trust 判断。
- Terminal 创建：
  - 新 Terminal 节点的 `metadata.terminal.cwd` 写入目标 cwd。
  - 首次自动启动、后续重启、diagnostic、终端链接解析和 line context 都以该 cwd 为准。
  - Terminal 标题副标题继续只展示 shell path，不额外拼接 `cwdLabel`。
- Agent 创建：
  - 创建前 provider、preset 和 custom command 选择复用现有 Agent Quick Input 与校验规则。
  - 新 Agent 节点的 `metadata.agent.cwd` 写入目标 cwd。
  - 首次自动启动、后续新建会话、恢复原会话、Agent CLI resolver、文件活动和 diagnostic 都以该 cwd 为准。
  - Agent 标题栏把 `cwdLabel` 与启动命令拆成两行：`cwdLabel` 位于标题上方，启动命令仍位于标题下方副标题；完整 cwd 与完整启动命令分别跟随各自文本的 hover title。
  - 侧栏节点列表中的 Agent 第二行显示 `cwdLabel · provider · 状态`；Terminal / Note 等其他节点不增加 cwdLabel。
- 落点与画布打开：
  - 如果已有可交互画布，节点仍优先落在当前视口附近，并复用当前已打开的 `editor` 或 `panel` surface。
  - 如果当前没有打开的主画布 surface，才按当前 window 已应用的默认承载面打开画布。
  - 如果画布尚未 ready，不因等待 Webview 坐标而丢失 cwd；宿主直接使用已有避碰逻辑创建。
- 后续启动语义：
  - 节点绑定 cwd 是节点级执行上下文，停止后仍保留。
  - cwd 后续不可访问时，不静默回退 workspace 根目录；节点进入错误态并说明目标目录不可用。

## 5. 不在范围内

- 为每个节点单独选择 shell、provider 配置或 provider home。
- 在普通“创建节点”入口中提供任意目录选择器；本轮只处理 Explorer 已明确携带资源的入口。
- 改变模板应用、恢复已有节点或普通创建入口的 cwd 语义。
- 在 Explorer 中显示节点运行状态、停止按钮或执行输出。
- 支持 workspace 外目录 / 文件、虚拟文件系统、只读虚拟 workspace 或非 `file` scheme 资源。
- 把 Terminal 标题栏改成目录标签；Terminal 当前路径由终端内容本身表达。

## 6. 关键对象与状态

### Explorer 创建请求

- 右键资源 URI
- 右键资源类型：目录或普通文件
- 解析后的目标 cwd
- cwd 是否属于当前 workspace
- 用于展示的 `cwdLabel`
- 目标节点类型：`terminal | agent`

### 执行节点 cwd

- `metadata.terminal.cwd`
- `metadata.agent.cwd`
- 启动时实际传给 PTY / runtime supervisor 的 cwd
- Agent CLI resolver 与 shell env probe 使用的 cwd-sensitive cache key
- diagnostic 中记录的 cwd

### Agent 标题栏 cwd 与副标题

- `cwdLabel`
- 启动命令
- `cwdLabel` hover 中的完整 cwd
- 启动命令 hover 中的完整启动命令

### 侧栏节点列表中的 Agent 第二行

- `cwdLabel`
- provider
- 人类可读状态

### Terminal 标题副标题

- shell path
- 不显示 `cwdLabel`
- cwd 仍保存在 metadata 和执行上下文中

## 7. 验收标准

- 在 workspace 内目录右键选择创建 Terminal 后，画布中出现 Terminal 节点，且 `metadata.terminal.cwd` 等于目标目录。
- 该 Terminal 首次自动启动时，diagnostic 中的 `execution/started.cwd` 等于目标目录；在终端内运行 `pwd` 或平台等价命令时可观察到当前目录为目标目录。
- Terminal 标题副标题不显示 `cwdLabel`，仍只显示 shell path。
- 在 workspace 内普通文件右键选择创建 Terminal 后，画布中出现 Terminal 节点，且 `metadata.terminal.cwd` 等于该文件父目录。
- 在 workspace 内目录或普通文件右键选择创建 Agent 后，仍出现现有 Agent provider / 启动方式 Quick Input，而不是新的一套重复选择 UI。
- 确认 Agent 创建后，画布中出现 Agent 节点；若右键目标是目录，`metadata.agent.cwd` 等于目标目录；若右键目标是普通文件，`metadata.agent.cwd` 等于该文件父目录。
- 该 Agent 首次自动启动时，`execution/startRequested.cwd` 和 `execution/started.cwd` 等于目标目录。
- Agent 标题栏按“标题上方 `cwdLabel`、标题下方启动命令副标题”展示；当内容被截断时，`cwdLabel` hover 能看到完整 cwd，启动命令 hover 能看到完整启动命令。
- Agent 标题栏中的 `cwdLabel` 和 hover 中的执行目录都追加目录尾缀；显示分隔符保留 cwd 来源风格，含反斜杠来源使用 `\`，slash-style 来源使用 `/`。
- 侧栏节点列表中，Agent 节点第二行按 `cwdLabel · provider · 状态` 展示；Terminal / Note 等其他节点仍只显示状态。
- 停止后再次启动 Terminal 或 Agent 时，仍使用节点 metadata 中的 cwd，不回退到 workspace 根目录。
- 如果右键资源不是目录或普通文件、解析后的 cwd 不属于当前 workspace、cwd 不存在或 workspace 未受信任，系统不会创建可运行执行节点，并给出明确反馈。
- 当画布已打开时，新节点优先落在当前视口附近；当画布未 ready 时，节点仍能创建并保留正确 cwd。
- 当画布已在 `editor` 或 `panel` 打开时，Explorer 创建 Terminal / Agent 不应切换到另一种默认承载面。

## 8. 开放问题

暂无。本轮特意不扩大到多根 workspace 普通创建入口 root 选择或单根扩容 fork，避免把 Explorer 资源入口与 workspace storage 恢复问题混在同一功能里。
