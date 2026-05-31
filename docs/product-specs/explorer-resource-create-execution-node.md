# File Explorer 资源右键创建执行节点规格

当前状态：草案。本文收口从 VSCode File Explorer 的 workspace 内目录或普通文件右键，在 Dev Session Canvas 中创建绑定目标 cwd 的 `Terminal` / `Agent` 节点的产品范围与验收口径，并记录多根 workspace 下普通“创建节点”入口的 root 确认语义。对普通文件，cwd 使用该文件所在父目录；实现方案与技术边界见 `docs/design-docs/explorer-resource-create-execution-node.md`。

## 1. 用户问题

开发者在 VSCode File Explorer 中浏览项目目录或文件时，常常已经明确知道下一条终端或 Agent 会话应该从哪个代码上下文开始工作。当前创建 `Terminal` / `Agent` 的入口默认使用 workspace 根目录，用户需要创建后再手动 `cd` 到目录或文件所在目录，这会带来三类摩擦：

- 资源上下文已经在 Explorer 右键动作中表达，却没有传递到画布节点。
- `Agent` 的启动 cwd 会影响项目配置、工具权限、文件活动和会话恢复，启动后再 `cd` 太晚。
- 多根 workspace 或较深目录结构中，用户难以从画布上看出某个 Agent 实际负责哪个目录上下文。
- 多根 workspace 下，普通“创建节点”入口如果继续静默使用第一个 root，容易让用户把执行会话启动到错误项目。

## 2. 目标用户

目标用户是已经在 VSCode workspace 内使用 Dev Session Canvas 并行管理多个 `Agent` / `Terminal` 的开发者。他们熟悉 VSCode Explorer 的目录和文件右键菜单，并希望从当前关注的代码目录或文件直接发起对应的画布执行节点，而不是先切回画布再手动调整工作目录。

## 3. 核心用户流程

1. 用户在 VSCode File Explorer 中右键点击当前 workspace 内的某个目录或普通文件。
2. 用户在右键菜单中选择“在 Canvas 中创建 Terminal”或“在 Canvas 中创建 Agent”。如果右键目标是文件，系统自动使用该文件的父目录作为 cwd。
3. 若选择 `Terminal`，画布打开或定位后创建一个 Terminal 节点；该节点首次自动启动时就在解析后的目标目录 cwd 中运行。
4. 若选择 `Agent`，扩展复用现有 Agent 创建 Quick Input，让用户选择 provider、启动方式或自定义启动命令；确认后创建 Agent 节点，并在解析后的目标目录 cwd 中启动。
5. 新节点优先出现在当前画布视口附近；若画布尚未 ready，则使用宿主已有默认落点与避碰规则。
6. Terminal 节点标题栏不额外显示 cwd 标签；用户通过终端 prompt / `pwd` 等终端内容理解当前路径。
7. Agent 节点标题副标题显示 `cwdLabel · 启动命令`，让用户在画布上直接看到该 Agent 的目录上下文和启动方式。
8. 节点停止后，Terminal 的重启、Agent 的新建会话或恢复原会话都继续使用该节点绑定的 cwd，不回退到 workspace 根目录。
9. 在侧栏节点列表中，Agent 节点第二行显示 `cwdLabel · provider · 状态`，帮助用户不进入画布也能区分多个目录上下文中的 Agent。
10. 在多根 workspace 中，如果用户通过普通“创建节点”入口创建 `Terminal` 或 `Agent`，系统让用户确认要使用哪个 workspace root，并把所选 root 作为节点 cwd；单根 workspace 不额外打断现有创建流程。

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
  - 未信任 workspace 下继续遵循现有执行型节点限制；不能通过 Explorer 入口绕过 trust 判断。
- Terminal 创建：
  - 新 Terminal 节点的 `metadata.terminal.cwd` 写入目标 cwd。
  - 首次自动启动、后续重启、diagnostic、终端链接解析和 line context 都以该 cwd 为准。
  - Terminal 标题副标题继续只展示 shell path，不额外拼接 `cwdLabel`。
- Agent 创建：
  - 创建前 provider、preset 和 custom command 选择复用现有 Agent Quick Input 与校验规则。
  - 新 Agent 节点的 `metadata.agent.cwd` 写入目标 cwd。
  - 首次自动启动、后续新建会话、恢复原会话、Agent CLI resolver、文件活动和 diagnostic 都以该 cwd 为准。
  - Agent 标题副标题显示 `cwdLabel · 启动命令`；完整 cwd 与完整启动命令在 hover title 中可见。
  - 侧栏节点列表中的 Agent 第二行显示 `cwdLabel · provider · 状态`；Terminal / Note 等其他节点不增加 cwdLabel。
- 普通创建入口的多根 root 确认：
  - 命令面板、侧栏和画布空白区等普通“创建节点”入口在多根 workspace 下创建 `Terminal` / `Agent` 时，需要让用户确认使用哪个 workspace root。
  - 用户选择的 root 作为新节点的 cwd 写入 `metadata.terminal.cwd` 或 `metadata.agent.cwd`；取消选择则不创建节点。
  - 单根 workspace 下普通创建入口继续直接使用唯一 workspace root，不增加额外确认。
  - Explorer 资源右键入口已经携带明确资源 cwd，不再重复弹出 root 确认。
- 落点与画布打开：
  - 如果已有可交互画布，节点仍优先落在当前视口附近。
  - 如果画布尚未 ready，不因等待 Webview 坐标而丢失 cwd；宿主直接使用已有避碰逻辑创建。
- 后续启动语义：
  - 节点绑定 cwd 是节点级执行上下文，停止后仍保留。
  - cwd 后续不可访问时，不静默回退 workspace 根目录；节点进入错误态并说明目标目录不可用。
- 多根 workspace 持久化与扩容：
  - 多根 workspace 复用现有 workspace 级持久化设计：一组 workspace folders 对应一张 Canvas 状态，不按 root 拆分持久化。
  - 当用户从单根 workspace `A` 通过拖入或 Add Folder 增加 `B`，把当前窗口视为 workspace 扩容；当前 Canvas 原样进入新的 `A + B` 多根 workspace 持久化范围。
  - 原 `A` 单根 workspace 的 Canvas 快照保留，不删除、不迁移；后续单独打开 `A` 与打开 `A + B` 会形成两份可自然分叉的状态。
  - 如果 VSCode 在单根扩容成 Untitled 多根 workspace 时要求 reload，扩展重启后应在当前多根持久化范围还没有有意义 Canvas 时，从第一个 root `A` 的单根 `canvas-state.json` fork 主快照到当前多根范围；这是对“当前 Canvas 原样进入 A+B”的启动期补救。源识别优先使用 VSCode `meta.json` 中的 root 名称；当历史或 Remote SSH storage slot 缺失 `meta.json` 时，可退回到候选快照中 Agent / Terminal cwd 明确落在第一个 root 下的非空快照。若这些路径线索来自某个 `workspaceStorage/<slot>-N` indexed sibling，并且快照里的 `runtimeStoragePath` / `resumeStoragePath` 指回同一单根 canonical storage slot，则应优先 fork canonical slot 的主快照；只有 canonical slot 缺失或没有可恢复快照时，才使用 indexed sibling 本身。若当前 Untitled 多根槽或其 `workspaceState` 已经有上一次错误 fork 复制进来的有意义快照，也允许先完成 canonical source selection：只要当前槽可作为证据读取 `runtimeStoragePath` / `resumeStoragePath` 并切回对应 canonical slot，`workspaceState` 不能预先阻断这次纠偏；没有这种 canonical 指向时，当前多根槽已有有意义快照仍应保留，不能被其他候选覆盖。
  - 启动期补救不能依赖用户先手动打开 Canvas view；reload 后扩展需要在 VS Code 启动主链路完成后完成必要激活，注册 Panel view provider 并执行 Untitled 多根 fork。这个激活只用于恢复持久化与 provider 注册，不自动把画布 reveal 到前台。
  - 启动期 fork 只复制主 Canvas 快照，不复制旧单根 `agent-runtime`、`runtime-supervisor` 或 Note 草稿目录；运行中的会话因 reload 已结束，后续恢复按当前多根范围重新持久化。fork 后不再沿用旧单根 `workspaceState` 兜底，避免旧兜底状态覆盖新多根快照。
  - 不自动导入 `B` 单独打开时可能存在的 Canvas，也不自动 merge 旧的 `A + B` 历史快照。
  - 如果 `A + B` 持久化范围已有有意义旧快照，优先使用该快照；如果只有空快照且能识别出 `A` 的单根快照，可以保留可恢复备份或诊断记录后执行一次启动期 fork，避免上一版空状态把扩容前 Canvas 永久遮蔽。
- 已有节点的 cwd 不因增加 root 被改写；运行中的 Agent / Terminal 不因 workspace 扩容自动重启。`cwdLabel` 在多根下重新按 workspace folder 前缀展示。

## 5. 不在范围内

- 为每个节点单独选择 shell、provider 配置或 provider home。
- 在普通“创建节点”入口中提供任意目录选择器；多根 workspace 下只确认 workspace root，子目录上下文仍通过 Explorer 资源右键表达。
- 改变模板应用、恢复已有节点或单根 workspace 普通创建入口的 cwd 语义。
- 在 Explorer 中显示节点运行状态、停止按钮或执行输出。
- 支持 workspace 外目录 / 文件、虚拟文件系统、只读虚拟 workspace 或非 `file` scheme 资源。
- 把 Terminal 标题栏改成目录标签；Terminal 当前路径由终端内容本身表达。
- 合并多个 workspace root 各自历史 Canvas，或在 workspace 扩容时自动导入新增 root 的历史节点。

## 6. 关键对象与状态

### Explorer 创建请求

- 右键资源 URI
- 右键资源类型：目录或普通文件
- 解析后的目标 cwd
- cwd 是否属于当前 workspace
- 用于展示的 `cwdLabel`
- 目标节点类型：`terminal | agent`

### 普通创建 root 选择请求

- 当前 workspace folder 列表
- 用户确认的 workspace root
- 目标节点类型：`terminal | agent`
- 取消选择时不产生节点

### 执行节点 cwd

- `metadata.terminal.cwd`
- `metadata.agent.cwd`
- 启动时实际传给 PTY / runtime supervisor 的 cwd
- Agent CLI resolver 与 shell env probe 使用的 cwd-sensitive cache key
- diagnostic 中记录的 cwd

### Agent 标题副标题

- `cwdLabel`
- 启动命令
- hover 中的完整 cwd
- hover 中的完整启动命令

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
- Agent 标题副标题按 `cwdLabel · 启动命令` 展示；当内容被截断时，hover 能看到完整 cwd 和完整启动命令。
- 侧栏节点列表中，Agent 节点第二行按 `cwdLabel · provider · 状态` 展示；Terminal / Note 等其他节点仍只显示状态。
- 停止后再次启动 Terminal 或 Agent 时，仍使用节点 metadata 中的 cwd，不回退到 workspace 根目录。
- 如果右键资源不是目录或普通文件、解析后的 cwd 不属于当前 workspace、cwd 不存在或 workspace 未受信任，系统不会创建可运行执行节点，并给出明确反馈。
- 当画布已打开时，新节点优先落在当前视口附近；当画布未 ready 时，节点仍能创建并保留正确 cwd。
- 在多根 workspace 下通过普通“创建节点”入口创建 Terminal 时，系统先让用户确认 workspace root；确认后新 Terminal 的 `metadata.terminal.cwd` 等于所选 root，取消则不创建节点。
- 在多根 workspace 下通过普通“创建节点”入口创建 Agent 时，系统让用户确认 workspace root，并继续复用现有 Agent provider / 启动方式 Quick Input；确认后 `metadata.agent.cwd`、`execution/startRequested.cwd` 和 `execution/started.cwd` 都等于所选 root。
- 在单根 workspace 下通过普通“创建节点”入口创建 Terminal / Agent 时，不出现 root 选择打断，节点 cwd 继续使用唯一 workspace root。
- Explorer 资源右键创建节点时不重复要求选择 root；目录资源和普通文件父目录仍是 cwd 来源。
- 从单根 workspace `A` 增加 root `B` 后，当前 Canvas 原样保留并写入 `A + B` 的持久化范围；重新单独打开 `A` 时仍能看到 `A` 自己的原状态。
- 如果 VSCode 因 `Add Folder to Workspace...` 要求 reload 并打开 Untitled 多根 workspace，扩展重启后在当前多根范围没有有意义 Canvas 时，会从第一个 root `A` 的单根快照 fork 节点、连线和布局；即使历史或 Remote SSH storage slot 缺少 VSCode `meta.json`，只要候选快照里 Agent / Terminal cwd 能明确指向第一个 root，也应能完成 fork；当路径线索来自陈旧 indexed sibling、已复制到当前 Untitled 多根槽的快照，或同一错误快照已经进入 `workspaceState` 时，应优先使用它指向的单根 canonical storage slot，而不是再次选择陈旧复制源；用户不会看到空画布、内置使用说明模板，或明显早于当前单根画布的历史状态替代原单根画布。
- reload 后即使用户还没有再次执行打开画布命令，扩展也会在启动完成后注册 Panel view provider 并完成上述 fork；如果 Panel view 已在工作台中可见，不应长期停留在原生 Webview “加载中”占位。
- 单根扩容时不会自动导入 `B` 的历史 Canvas，也不会把已有有意义 `A + B` 快照自动 merge 到当前窗口。
- 单根扩容后，已有 Agent 节点在多根下按 `workspaceFolder/cwd` 规则显示 `cwdLabel`；已有 Terminal / Agent 的 cwd 不因扩容被改写；reload 路径不承诺保留扩容前 live runtime 进程。

## 8. 开放问题

暂无。
