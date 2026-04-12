---
title: Agent CLI 启动上下文与显式恢复设计
decision_status: 已选定
validation_status: 未验证
domains:
  - VSCode 集成域
  - 协作对象域
  - 执行编排域
  - 项目状态域
architecture_layers:
  - 宿主集成层
  - 共享模型与编排层
  - 适配与基础设施层
related_specs:
  - docs/product-specs/canvas-core-collaboration-mvp.md
  - docs/product-specs/runtime-persistence-modes.md
related_plans:
  - docs/exec-plans/active/agent-cli-launch-context-and-resume.md
updated_at: 2026-04-12
---

# Agent CLI 启动上下文与显式恢复设计

## 1. 背景

当前插件已经支持在画布中创建并自动启动 `Agent` 节点，但真实使用场景是“开发者在一个 repo 里添加 Agent，让它直接在这个 repo 中工作”，而不是“在扩展自己管理的一块私有状态目录里启动一个看起来像 Agent 的会话”。

这个差异一旦落到真实编程 CLI 上，就不再只是实现细节：

- `Codex` / `Claude Code` 这类 CLI 往往已经带有用户自己的登录态、模型偏好、项目级配置和工具权限。
- 开发者希望 Agent 继承这些已有上下文，而不是每创建一个节点就重新配置一遍。
- 节点恢复时，用户真正关心的是“这个节点恢复的是不是它上次那条会话”，而不是“当前环境里最近一次会话是什么”。

当前实现的问题正是把这三件事混在了一起：`cwd` 仍在 repo，但 `Codex` 的配置根被切到了扩展私有目录，恢复时再通过 `resume --last` 取“最近会话”。这既破坏了用户已有 CLI 配置，也让节点身份和会话身份脱钩。

## 2. 问题定义

本设计需要回答四个问题：

1. 在 repo 里创建 `Agent` 节点时，CLI 应该在什么目录下启动，才能符合用户的实际开发上下文。
2. provider 自己的配置、认证和项目规则应该由谁拥有；扩展可不可以默认改写它们的根目录。
3. 节点在扩展重载或窗口重开后，什么条件下才有资格进入 `resume-ready` 并自动恢复。
4. 当未来接入更多编程 CLI 时，怎样避免再次把 provider 差异硬压成一条依赖环境猜测的伪统一路径。

## 3. 目标

- `Agent` 节点启动时，CLI 运行在 repo/workspace 工作目录中，而不是扩展私有目录。
- 插件默认继承用户已有 CLI 配置、认证与项目级规则；设置项只负责选择命令路径。
- 支持更健壮的宿主侧编程 CLI 定位，不把“当前进程 PATH 里刚好有命令名”当成唯一前提。
- 自动恢复只能建立在 provider 原生显式 session identity 之上。
- 如果某个 provider 还没有可验证的显式恢复身份，就不要把它写成“支持自动恢复”。

## 4. 非目标

- 不在本轮把所有第三方编程 CLI 都纳入正式 provider 支持范围。
- 不在本轮重写 `Agent` 的 PTY backend 或自建 provider SDK。
- 不在本轮把多 workspace / 多 repo 的工作目录选择策略完全展开；当前先沿用现有 workspace root 语义。
- 不在本轮由扩展接管 provider 的认证、配置编辑或 session 浏览 UI。

## 5. 候选方案

### 5.1 每节点隔离 provider home，并用最近会话恢复

特点：

- 为每个节点单独创建 provider 状态目录。
- 启动时把 `CODEX_HOME` 或类似环境变量指向该目录。
- 恢复时使用 `resume --last`、交互式 picker 或其他“最近会话”语义。

不选原因：

- 这会直接破坏用户已有 provider 配置、认证和项目规则。
- “最近一次会话”只描述环境中的最后记录，不描述当前节点自己的身份。
- 节点删除、重命名、跨窗口恢复后，都无法可靠回答“恢复的是不是同一条会话”。

### 5.2 在 repo cwd 启动，并使用 provider 原生显式 session identity 恢复

特点：

- `Agent` 与 `Terminal` 共享 repo/workspace 工作目录语义。
- 插件默认继承用户现有 CLI 配置和环境变量。
- 节点 metadata 持久化 provider 显式 session identity；恢复时调用 provider 的显式 resume 入口。

当前选择原因：

- 这是最符合真实 repo 开发路径的语义。
- 它同时满足“在 repo 中工作”和“恢复到确定的同一条会话”两个核心诉求。
- 它把 provider 配置所有权还给 provider 自己，减少扩展擅自定义语义的空间。

### 5.3 由扩展维护一套 provider 影子运行时和影子配置层

特点：

- 扩展自己生成 session identity、配置目录和恢复映射。
- provider CLI 只是被动消费扩展翻译后的环境。

当前不选原因：

- 这会把当前问题从“尊重 provider 既有边界”升级成“扩展重做 provider runtime 管理层”。
- 一旦 provider CLI 的配置或恢复行为变化，这层影子兼容层会非常脆弱。
- 当前仓库没有证据表明这种额外复杂度是必要的。

## 6. 当前结论

### 6.1 启动目录与配置所有权

当前正式结论如下：

- `Agent` 会话必须在 repo/workspace 工作目录启动；当前单 workspace 语义下，沿用宿主已有的 workspace root。
- 扩展自己的 storage 目录只用于扩展元数据、日志摘要和运行时监督器控制文件，不属于 provider 的工作目录或配置根。
- `devSessionCanvas.agent.codexCommand`、`devSessionCanvas.agent.claudeCommand` 只负责解析“启动哪个可执行文件”，不负责定义 provider home。
- 默认情况下，扩展不得改写 `HOME`、`CODEX_HOME` 或其他 provider 配置根目录环境变量。

这里还要区分两件事：某个 shell 环境里是否能直接通过命令名解析到 `codex`，属于命令发现问题；插件是否应该改写 provider 的配置根目录，属于产品与架构边界问题。前者可以通过 `PATH`、显式命令路径或 VSCode 设置解决，后者默认不应由扩展擅自接管。

对 `Codex`，这条结论还有一个直接原因：OpenAI 官方文档已经把 `~/.codex/config.toml` 和 `<repo>/.codex/config.toml` 作为正式配置层。也就是说，repo cwd 与用户 home 本来就是 `Codex` 正式配置模型的一部分，扩展不应把它们偷偷替换掉。

### 6.2 命令定位必须是宿主侧 resolver，而不是裸命令名碰运气

这里的“本地 CLI”一律指向真正运行 `Agent` 的那台宿主机器，而不是 VSCode UI 所在机器。对本地 workspace 来说，它通常就是当前机器；对 `Remote SSH` 来说，它是远端 Extension Host / runtime host 所在机器。

当前正式结论如下：

- CLI 定位发生在执行宿主侧，而不是 Webview 或 UI 侧。
- 命令解析优先级为：
  1. provider 对应的显式设置值。
  2. 同一宿主上、同一设置版本下最近一次成功解析出的绝对路径缓存；前提是该路径仍存在且可执行。
  3. 当前执行宿主环境的 `PATH` 解析。
  4. 平台原生命令发现回退：
     - POSIX：登录 shell / 交互 shell 的 `command -v` 或等价探测。
     - Windows：`where.exe`、`Get-Command` 和常见包装后缀 `.exe` / `.cmd` / `.bat` / `.com`。
- 如果设置值本身是绝对路径，则应优先校验并直接使用；如果它只是命令名或相对路径，则仍应交给 resolver 做完整探测，而不是原样 `spawn` 后再等失败。
- 解析成功后，宿主应把本次使用的绝对命令路径记录到诊断和缓存中，方便后续复用与错误排查。
- 所有探测都失败后，才向用户显示“未找到命令”的错误；错误信息应说明已经尝试过哪些来源，并提示用户通过设置固定路径。

这条设计要解决的不是“要不要允许用户手填路径”，而是“当用户机器上已经可用的 CLI 没有恰好出现在当前进程 PATH 中时，插件是否还能尽量自动找到它”。正式答案是：应该。

### 6.3 自动恢复必须使用显式 session identity

`Agent` 自动恢复的正式规则如下：

- 节点只有在持有 provider 原生显式 session identity 时，才可以进入 `resume-ready`。
- 自动恢复必须调用 provider 的显式目标恢复接口，而不是恢复“最近一次会话”。
- `resume --last`、交互式 picker 和类似的“最近会话”入口可以作为人工调试手段存在，但不属于正式产品行为。
- 节点除了要有 session identity，还要有可信的 identity 绑定来源；“有一个字符串”不等于“这个字符串已经可信地绑定到当前节点”。
- 如果 provider 没有显式 session identity，或扩展还不能通过可信来源拿到它，节点必须退化为 `interrupted` 或历史态，而不是伪装成可自动恢复。

这里的“可信来源”当前只包括：

- fresh start 前由扩展显式注入，且 provider 正式接受该 identity。
- provider 在启动或恢复接口中直接回传的 machine-readable identity。
- 用户或 provider 原生 UI 显式给出的 identity，并被扩展按节点持久化。

以下来源当前一律不算正式可信来源：

- 扫描 provider 私有状态目录，再按 `cwd`、时间窗或最新文件推断。
- 读取 provider 私有数据库、日志或 cache，再按候选唯一性猜测。
- 调用 provider 的会话列表接口后，再用“当前目录 + 最近启动时间”做启发式匹配。

这类来源最多只能说明“可能找到了一个候选 identity”，不能自动升级成 `resume-ready`。

### 6.4 provider capability 必须显式建模

后续实现必须为每个 provider 单独回答以下能力问题：

- 能否被宿主侧 resolver 稳定定位。
- 能否在 repo/workspace cwd 中直接运行。
- 是否支持“按显式 identity 恢复会话”。
- 能否在 fresh start 前注入 session identity。
- 如果不能预注入，provider 是否存在正式、稳定、machine-readable 的 session identity 读取接口。
- 如果不存在正式接口，是否只能依赖启发式反查；若是，该路线必须被标记为技术债务，而不是正式 capability。

如果实现阶段临时参考了 OpenCove 那类“先启动，再从 provider 私有文件、DB 或列表 API 里反查 session id”的路线，必须同时满足以下约束：

- 设计文档、`ExecPlan` 和代码注释都要明确登记技术债务。
- 技术债务描述里必须写清楚：因为 provider 当前没有正式接口可直接获取 session identity，才临时选择这种反查方式。
- 必须写清退出条件，例如“provider 后续提供标准接口后移除反查逻辑”。
- 默认不能把这类反查结果直接当成自动恢复凭据；除非另有额外验证闭环，否则它至多用于实验能力、诊断信息或人工恢复辅助。

当前已确认的最小结论：

- `Claude Code`
  - 本机 `claude --help` 已确认存在 `--session-id <uuid>` 与 `--resume [value]`。
  - 这意味着它至少具备“显式 session id 启动”和“显式 session id 恢复”的正式入口。

- `Codex`
  - OpenAI 官方文档已确认存在 `codex resume [SESSION_ID]` 与 `codex resume --last` 两条不同入口。
  - 当前公开证据下，显式 `resume` 入口已经成立，因此 `--last` 不能再被当成正式节点恢复语义。
  - 当前官方命令行参考里没有像 `Claude Code` 那样显式展示 fresh start `--session-id` 参数，也没有已确认的标准接口用于启动后直接读取本次会话的 identity。
  - 因此以当前公开证据，`Codex` 的正式能力应收口为“支持显式 id 恢复，但默认不承诺自动获取 fresh start 的 session identity”；如果未来临时采用日志/状态目录/会话列表反查，只能作为明确登记的技术债务。

### 6.5 状态模型与持久化边界

- `resume-ready` 不再等价于“存在某个 provider 私有目录”。
- `resume-ready` 等价于“存在已知 provider、已知 resume 入口、已持久化的显式 session identity，且该 identity 来自可信绑定来源”。
- 扩展 storage 中可以保存 nodeId 到 provider session identity 的映射、最近失败原因和摘要日志，但不能把 provider 配置目录本身伪装成扩展托管资源。
- 旧的 `resumeStoragePath` 这类概念不应继续作为正式产品语义保留；如果代码层为了兼容历史数据暂时保留，也只能作为迁移输入，而不能继续驱动自动恢复。

## 7. 风险与取舍

- 取舍：默认继承用户已有 provider 配置，会减少“每节点完全隔离”的可控性。
  原因：当前产品目标是让 Agent 在真实 repo 开发路径中工作；默认破坏用户 CLI 上下文，比默认不隔离的代价更高。

- 风险：`Codex` fresh start 后没有已确认的标准 session identity 获取接口，任何基于私有状态反查的方案都可能漂移、歧义或失效。
  当前缓解：在真实标准接口出现前，不把 `Codex` 自动恢复写成已支持；如果实现阶段不得不临时采用反查，只能作为显式登记的技术债务，并默认 fail closed。

- 风险：不同平台和不同启动方式下，执行宿主的 `PATH` 可能与用户交互 shell 可见的 `PATH` 不一致。
  当前缓解：把命令发现从“裸命令名直接 spawn”升级为宿主侧 resolver，并把绝对命令路径缓存和探测诊断纳入正式设计。

- 风险：旧节点 metadata 里可能还保存着 `resumeStoragePath` 或其他旧设计残留。
  当前缓解：迁移时把这些数据降级为不可自动恢复，而不是继续当成恢复凭据。

- 风险：未来接入其他编程 CLI 时，如果没有显式 capability contract，仍会重复今天的问题。
  当前缓解：把“显式 session identity 能力”提升为 provider 接入门槛，而不是接入后再补救。

## 8. 验证方法

至少需要完成以下验证：

1. 新建 `Agent` 节点后，CLI 的 `cwd` 仍是当前 repo/workspace 目录。
2. 默认启动路径不会把 `Codex` 或 `Claude Code` 切到扩展私有配置目录。
3. 当 CLI 已安装但不在当前进程 PATH 直达位置时，宿主侧 resolver 仍能通过登录 shell / 平台原生命令发现或缓存找到它。
4. `Claude Code` 可通过显式 session id 走自动恢复。
5. `Codex` 在没有可信 session identity 绑定来源时不会进入自动恢复；否则退化为 `interrupted`。
6. `resume-ready` 不再由“存在私有状态目录”驱动。

## 9. 当前验证状态

- 2026-04-12 已完成设计收口，并同步到生命周期文档、产品规格和设计索引。
- 本机 `claude --help` 已确认 `--session-id <uuid>` 与 `--resume [value]`。
- OpenAI 官方 `Codex CLI` 文档已确认显式 `codex resume [SESSION_ID]` 入口，以及 `~/.codex/config.toml` / `<repo>/.codex/config.toml` 这两层正式配置。
- 当前设计仍是 `未验证`，因为新的显式 session identity 路线尚未代码落地，而 `Codex` fresh start 的标准 session identity 获取接口在当前环境下也还没有被确认存在。
