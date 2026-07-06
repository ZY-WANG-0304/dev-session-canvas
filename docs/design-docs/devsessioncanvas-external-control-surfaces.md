---
title: DevSessionCanvas 外部控制面：MCP、SKILL 与 CLI 边界
decision_status: 比较中
validation_status: 未验证
domains:
  - VSCode 集成域
  - 画布交互域
  - 协作对象域
  - 执行编排域
  - 项目状态域
architecture_layers:
  - 宿主集成层
  - 共享模型与编排层
  - 适配与基础设施层
related_specs:
  - docs/product-specs/canvas-core-collaboration-mvp.md
  - docs/product-specs/canvas-template-feature.md
  - docs/product-specs/template-marketplace.md
  - docs/product-specs/runtime-persistence-modes.md
related_plans: []
updated_at: 2026-07-05
---

# DevSessionCanvas 外部控制面：MCP、SKILL 与 CLI 边界

## 1. 背景

DevSessionCanvas 当前主形态是 VSCode workspace extension。画布状态、节点生命周期、模板应用和执行会话启动都以 Extension Host 侧的 `CanvasPanelManager` 为权威入口；Webview 负责呈现与交互，runtime supervisor 只负责 `live-runtime` 模式下的进程所有权和重连。这个边界已经支撑了本地模板、模板市场、Agent / Terminal 节点、会话历史和多根 workspace 主路径。

下一阶段外部控制面有两类需求正在汇合：

1. 面向模板分享的能力。外部 Agent 需要能生成、校验、打包、预览和发布 DevSessionCanvas 模板，并理解轻量 `template.json` 与完整模板包的差异。
2. 面向协作编排的能力。外部 Agent 需要能“看见”当前画布、节点、模板和会话摘要，并在受控前提下操作画布，例如创建 Note、追加模板、查看执行节点尾部输出，甚至在用户明确授权后创建 Agent / Terminal。

这两类需求都不应该通过让 Agent 直接改 VSCode 私有状态、读取 Webview 内存或绕过 `CanvasPanelManager` 来实现。它们需要按能力面分层：模板校验、打包、doctor 和发布预检采用 CLI-first；live workspace 的“看见并操作画布”采用 MCP-first；Skill 负责把用户意图路由到 CLI 或 MCP，并沉淀模板作者与画布协作工作流。本文先记录边界和候选方案，不把接口名、包名或完整实现写成已验证结论。

## 2. 问题定义

本轮设计需要回答以下问题：

1. `SKILL`、`MCP` 和 `CLI` 分别负责什么，避免三者重复实现同一套逻辑。
2. 模板生成、校验、打包和发布流程中，哪些步骤应是离线确定性的，哪些必须连接模板市场或 VSCode 宿主。
3. 模板能力是否需要 MCP，还是只把 MCP 当成 MCP-only client 的可选 adapter。
4. live workspace 如果采用 MCP-first，CLI 还应保留哪些启动、诊断、只读 smoke 和兜底能力。
5. 外部 Agent 读取画布时应看到哪一层状态：模板文件、宿主权威画布快照、节点摘要、会话 tail，还是 runtime supervisor registry。
6. 外部 Agent 写入画布时如何回到 `CanvasPanelManager`，并继续遵守 workspace trust、多根 root、provider CLI 解析、运行时持久化和用户确认边界。
7. MCP 暴露的 `resources`、`tools` 和 `prompts` 如何分级，避免把高风险执行动作包装成普通函数。
8. Skill 是否做成一个覆盖模板和画布控制的综合 Skill，还是拆成多个更窄的 Skill。
9. Remote SSH、多根 workspace、Restricted Mode 和模板市场 OAuth 等边界条件是否会改变首版能力范围。

## 3. 目标

- 建立一份 repo-local 设计记录，说明外部控制面如何与当前 VSCode extension 架构相容。
- 明确当前阶段的倾向：模板面 CLI-first、MCP optional；live workspace 面 MCP-first、CLI diagnostic；Skill 作为工作流与领域知识层。
- 把模板分享能力和 live 画布操作能力放在同一个分层框架下讨论，但区分离线模板文件操作和需要 VSCode 宿主参与的 live 操作。
- 为后续实现留下可执行锚点：共享纯逻辑包、CLI 包、MCP server、Extension Host bridge、Skill 文件结构和测试入口。
- 先把安全边界写清楚：任何会启动真实进程、写入 workspace、发送终端输入或发布到远端市场的动作，都必须有明确授权路径和审计依据。

## 4. 非目标

- 本文不实现 CLI、MCP server、Skill 或 Extension Host bridge。
- 本文不承诺稳定外部 API、MCP tool schema、CLI 命令名或 npm 包名；这些需要后续 ExecPlan 和实现验证后收口。
- 本文不把 runtime supervisor 扩展成通用画布 API server，也不让 Webview 变成外部控制入口。
- 本文不新增远程多人协作、CRDT、云端画布同步或独立桌面 app。
- 本文不承诺在首版外部控制面里支持任意 shell 命令执行、任意文件系统读写或无确认的 Agent / Terminal 输入。
- 本文不改变现有模板市场产品范围；发布、点赞、举报、治理仍以 `docs/product-specs/template-marketplace.md` 和 `docs/design-docs/template-marketplace.md` 为准。

## 5. 候选方案

### 5.1 只做 Skill，不做 CLI 或 MCP

这个方案把所有能力都写进一个 Codex Skill：模板作者规则、校验说明、发布步骤和画布操作建议都由 Agent 按自然语言执行。

优点是启动成本低，适合先沉淀工作流经验。缺点是 Skill 不能直接提供稳定机器接口；模板校验、打包和 live 状态读取仍然会退化为 Agent 自己搜索文件、猜 schema、调用零散脚本。对于会修改画布或启动执行节点的动作，只靠 Skill 文本也无法提供强边界和审计。

当前判断：Skill 必须存在，但不能成为唯一能力层。它应调用 CLI 或 MCP，而不是重复实现模板 parser 或画布控制协议。

### 5.2 只做 MCP，让 MCP server 直接操作 Extension Host

这个方案让 MCP server 成为唯一外部接口。外部 Agent 通过 MCP resources 读取画布，通过 MCP tools 创建节点、应用模板、发送输入。

优点是 Agent-facing 体验直接，符合外部 Agent “看见并操作画布”的目标。缺点是如果没有底层 CLI 和共享纯逻辑，MCP server 会同时承担模板校验、文件打包、市场 API、VSCode bridge 和安全确认，边界过重。更危险的是，如果 MCP server 直接写宿主存储或读 runtime supervisor registry，就会绕过 `CanvasPanelManager`。

当前判断：MCP 是 live 画布控制面的标准入口，但它应复用 CLI / 共享核心逻辑；所有 live 写操作必须通过 Extension Host bridge 回到 `CanvasPanelManager`。

### 5.3 CLI 作为稳定内核，MCP 和 Skill 站在 CLI / bridge 之上

这个方案拆成三层：

- 纯逻辑层处理模板 schema、模板包、路径规范化、市场共享类型和可序列化 DTO。
- CLI 层提供确定性命令，例如模板校验、打包、doctor、市场发布预检；对 live workspace 只保留 `mcp serve`、bridge 诊断、ping、只读 snapshot / list 这类调试和 smoke 能力。
- MCP 层把 live workspace 能力组织成 resources、tools 和 prompts；模板相关 tools 只作为 MCP-only client 的可选 adapter，不是首版必要能力。
- Skill 层描述用户意图到模板 / 画布操作的工作流：模板工作流优先调用 CLI，live 画布工作流优先调用 MCP。

优点是可测试、可复用、风险分层清楚。离线模板能力不依赖 VSCode 宿主；live 画布能力必须通过宿主 bridge；Skill 保持薄文档，不承担协议职责。它也避免把高风险 live 写操作同时公开成 CLI 命令和 MCP tool 两套入口。缺点是仍需要设计包边界、MCP server entrypoint 和 bridge 机制。

当前判断：这是当前优先候选。后续实现可以分阶段推进：先做离线 CLI，再做 MCP server entrypoint 与 read-only live MCP，再做低风险 MCP 写操作，最后再评估是否需要 CLI 暴露高风险 live 写操作。

### 5.4 模板能力也完整暴露为 MCP tools

这个方案让 MCP server 同时覆盖模板校验、打包、doctor、发布预检和 live workspace 控制。

优点是 MCP-only client 可以不经过 shell 直接完成模板校验和包预检。缺点是模板能力本质是离线、确定性、文件输入输出明确的任务；对于 Codex / Claude Code 这类能调用 shell 的开发 Agent，Skill 直接调用 CLI 已经足够。若首版把模板能力完整复制成 MCP tools，会增加 schema、错误映射和测试成本，并可能形成“CLI 一套实现、MCP 一套实现”的漂移。

当前判断：不作为首版必要能力。模板面采用 CLI-first；MCP 模板 tools 只作为后续可选 adapter，并且必须复用同一套 CLI / shared core 逻辑。

### 5.5 把 runtime supervisor 暴露为外部 API

这个方案利用已有 supervisor 进程，让外部 Agent 连接 supervisor 查询和控制执行会话。

不选原因是 supervisor 的职责是 `live-runtime` 进程所有权、会话 registry、日志和重连，不拥有画布对象图，也不应该决定节点布局、模板应用、多根 root 或 workspace trust。把它升级为外部 API 会把执行会话事实和画布权威状态拆开，容易产生“外部工具认为会话存在，但画布状态未同步”的分裂。

当前判断：runtime supervisor 可以继续作为 Extension Host 内部依赖，不作为 MCP / CLI 的直接写入口。

### 5.6 只复用 VSCode commands / URI，不设计独立控制面

这个方案把外部入口收敛为已有命令，例如 `devSessionCanvas.openCanvas`、`devSessionCanvas.applyTemplate` 和安装 URI。

优点是改动小。缺点是 VSCode commands 本质是 UI / extension integration 入口，不适合承载可发现的 schema、结构化 JSON 输出、批量校验、MCP resources 或外部 Agent 的上下文读取。URI 入口也不能携带复杂 payload，且安全边界更适合“打开详情页后由用户确认”，不适合自动化控制面。

当前判断：已有 command / URI 可以作为某些动作的宿主侧落点或唤醒入口，但不能替代 CLI / MCP 的结构化接口。

## 6. 风险与取舍

- 风险：外部 Agent 通过 MCP tool 间接启动 Agent / Terminal，用户误以为只是整理画布。
  当前缓解：将 tools 分为 read-only、低风险写入和高风险执行三档；首版只默认开放 read-only 和少量低风险写入，高风险动作必须显式确认、记录目标 root，并继续受 workspace trust 限制。

- 风险：CLI 直接改 `.dev-session-canvas/` 或 VSCode storage，绕过 Extension Host 的迁移、multi-root 和运行时清理逻辑。
  当前缓解：CLI-first 只覆盖离线模板文件、模板包、doctor 和市场预检；live CLI 首版只保留 `mcp serve`、bridge 诊断和只读 smoke，不公开完整 live 写操作。

- 风险：模板能力同时做成 CLI 命令和 MCP tools 后，错误语义、schema 和实现路径发生漂移。
  当前缓解：模板面首版不要求 MCP tools；如果后续补 MCP adapter，必须复用同一套 CLI / shared core 逻辑，不维护第二套 parser、packer 或发布预检。

- 风险：Skill 过厚，复制产品文档、schema 和市场 API 细节，导致上下文膨胀且容易过期。
  当前缓解：Skill 的 `SKILL.md` 只保留触发规则、工作流选择和安全提醒；模板 schema、MCP tool 说明、发布流程细节放到一层 reference，并优先让 Skill 调 CLI / MCP 取得事实。

- 风险：模板发布需要 GitHub OAuth 和远端市场权限，CLI 或 MCP 若自行保存 token 会破坏现有认证边界。
  当前缓解：首版 CLI 可以做打包、校验、发布预检和打开发布入口；真正发布应优先复用现有浏览器 / VSCode 市场认证流程。若后续需要 headless publish，必须另写认证设计并说明 token 存储和撤销机制。

- 风险：MCP resources 暴露会话输出 tail，可能包含秘密、路径或未提交代码片段。
  当前缓解：会话 tail 默认有行数和字节上限；read resource 只返回当前 workspace 绑定的节点摘要，不跨 workspace 扫描；后续实现需要允许用户关闭或裁剪敏感字段。

- 风险：Remote SSH 下本地 Agent 想控制远端 workspace 画布，CLI / MCP 的运行位置不清。
  当前缓解：首版 live bridge 只承诺 workspace side。Remote SSH 场景中，能控制画布的 MCP server 和诊断 CLI 应运行在远端 extension host 可达的一侧；本地到远端的自动穿透不作为首版承诺。

## 7. 当前结论

本文 `decision_status` 仍为 `比较中`，因此以下内容是阶段性边界，不是已验证正式方案。

### 7.1 分层边界

当前倾向采用四层结构，但按能力面区分主入口：

```text
共享纯逻辑层
  -> dscanvas CLI（模板/包/doctor 主入口；live 诊断入口）
  -> MCP server（live workspace 主入口；模板可选 adapter）
  -> DevSessionCanvas Skill（工作流路由与使用约束）

模板/包/发布预检：Skill -> CLI -> shared template / marketplace core
live workspace 读写：Skill -> MCP -> Extension Host bridge -> CanvasPanelManager
live workspace 诊断：CLI -> MCP server / Extension Host bridge -> CanvasPanelManager
```

共享纯逻辑层后续可以从现有模块中提取或复用：

- `extensions/vscode/dev-session-canvas/src/common/canvasTemplates.ts`：模板主体模型、解析、摘要和校验语义。
- `packages/marketplace-shared/`：模板市场 API、包 manifest、大小限制、错误码和共享 schema。
- 未来可能新增的 `packages/devsessioncanvas-core/` 或等价包：只放不依赖 `vscode`、React、DOM、Cloudflare binding 或 `node-pty` 的纯函数。

`CanvasPanelManager` 继续是 live workspace 画布状态和执行节点操作的权威入口。任何外部写操作如果会改变当前画布、创建 / 删除节点、启动 / 停止执行会话、写入 terminal input 或应用 root-scoped 模板，都必须最终进入 `CanvasPanelManager` 的受控方法，而不是直接改存储文件。当前阶段不把 CLI 设计成完整 live 写控制面；CLI 只负责启动 MCP server、排障和只读验证。

### 7.2 CLI 能力边界

CLI 的首要职责是提供可脚本化、可测试、稳定 JSON 输出的确定性能力。当前命令名暂记为 `dscanvas`，实现时可以按发布命名再确认。模板能力采用 CLI-first，因为它们是离线、确定性、文件输入输出明确的操作，不需要 VSCode window 或 MCP client 才能成立。

首版优先考虑离线模板、模板包和发布预检命令：

```text
dscanvas doctor --json
dscanvas template validate <template.json> --json
dscanvas template stats <template.json> --json
dscanvas template normalize <template.json> --write
dscanvas template pack <package-dir> --out <package.zip>
dscanvas template unpack <package.zip> --out <dir>
dscanvas marketplace package-validate <package.zip> --json
dscanvas marketplace publish-preflight <package.zip> --json
```

这些命令不得依赖 VSCode window 是否打开，也不得读取 live canvas 私有状态。它们只处理显式传入的模板文件、模板包目录、zip 或当前 repo 中可定位的配置。Skill 在模板分享工作流中应优先调用这些 CLI，而不是要求用户先启动 MCP。

live workspace CLI 不作为完整产品控制面。首版如果需要 live 相关 CLI，只保留启动、诊断、只读 smoke 和人类排障入口：

```text
dscanvas mcp serve --stdio
dscanvas bridge doctor --json
dscanvas bridge ping --json
dscanvas canvas snapshot --json
dscanvas node list --json
dscanvas session tail <node-id> --lines 200 --json
```

这些 live 诊断命令必须依赖 Extension Host bridge，不能直接读写 VSCode storage。它们的主要用途是证明 MCP server 和 Host bridge 是否可达，帮助 CI / smoke / 用户排障，而不是成为自动化操作画布的首选入口。

以下 live 写操作不作为首版 CLI 命令公开；默认由 MCP tools 承载：

```text
dscanvas canvas apply-template <template-id> --root <path> --mode append
dscanvas node create-note --root <path> --title <title> --content-file <file>
dscanvas node create-agent --provider codex --root <path>
dscanvas node create-terminal --root <path>
dscanvas session send <node-id> --text <text>
dscanvas session stop <node-id>
```

这些命令如果未来因为脚本化需求进入 CLI，也必须另行设计确认策略，并要求明确目标 workspace root、Host 侧 trust 检查和审计记录。

### 7.3 MCP 能力边界

按 2026-07-04 查阅的 MCP 官方文档，MCP server 可以提供 resources、tools 和 prompts；tools 是模型可调用动作，通常需要用户批准；本地 server 常见传输是 stdio，调试可使用 MCP Inspector。DevSessionCanvas 的 MCP server 应遵循这个模型，但不能把客户端 approval 当作唯一安全边界，服务端自身也必须分级授权。MCP 的核心价值是 live workspace：让外部 Agent 在标准协议里读取当前画布、节点、模板和会话摘要，并在 Host bridge 授权下操作画布。

首版 MCP server 倾向由 CLI 启动，例如：

```text
dscanvas mcp serve --stdio
```

首版 live workspace resources 只读：

```text
dscanvas://workspace/current/summary
dscanvas://workspace/current/canvas.json
dscanvas://workspace/current/nodes
dscanvas://workspace/current/nodes/{nodeId}
dscanvas://workspace/current/templates
dscanvas://workspace/current/templates/{templateId}
dscanvas://workspace/current/sessions/{nodeId}/tail
```

首版 live workspace tools 分级：

```text
Read-only tools
- devsessioncanvas_get_workspace_summary
- devsessioncanvas_list_nodes
- devsessioncanvas_get_node
- devsessioncanvas_list_templates
- devsessioncanvas_get_session_tail

Low-risk write tools
- devsessioncanvas_create_note
- devsessioncanvas_update_note
- devsessioncanvas_create_group
- devsessioncanvas_apply_template_append

High-risk write tools
- devsessioncanvas_reset_root_to_template
- devsessioncanvas_create_agent
- devsessioncanvas_create_terminal
- devsessioncanvas_send_session_input
- devsessioncanvas_stop_session
```

当前倾向是：read-only tools 与 resources 可以先实现；低风险写入必须先有 Host bridge；高风险写入只在明确确认、审计和测试后再启用。

模板相关 MCP tools 不属于首版必要能力。若后续有 MCP-only client 需要模板校验或打包，可补可选 adapter，例如：

```text
Optional template tools
- devsessioncanvas_validate_template
- devsessioncanvas_pack_template
- devsessioncanvas_package_publish_preflight
```

这些 optional tools 必须调用同一套 CLI / shared core，不能维护第二套模板 parser、packer 或市场预检逻辑。

MCP prompts 用于把常见协作场景显式化，例如：

```text
- plan_feature_on_canvas
- review_mr_with_canvas
- split_work_into_agents
- summarize_canvas_for_handoff
- turn_canvas_into_template
- debug_failed_agent_session
```

这些 prompts 不应直接包含完整产品文档，而应引用可读取 resources 和 tools，让 Agent 基于当前真实画布状态行动。

### 7.4 Skill 能力边界

当前倾向先做一个综合 Skill，暂名 `dev-session-canvas`。它覆盖两条工作流：

1. 模板分享工作流：生成模板草稿、校验 `template.json`、组装完整模板包、生成 README / CHANGELOG / thumbnail 建议、执行发布预检、引导用户走现有发布入口。
2. 画布控制工作流：读取当前画布摘要、总结节点和会话、根据任务拆分 Note / Agent / Terminal / group、追加模板、生成 handoff 摘要。

之所以先做一个 Skill，是因为用户意图常常同时包含模板和画布，例如“把当前协作面整理成可分享模板”既需要读 live canvas，又需要生成模板包。若后续触发噪音过大，或模板市场作者与 live 画布操作者明显成为两类用户，再拆成 `devsessioncanvas-template` 和 `devsessioncanvas-control` 两个 Skill。

Skill 结构应遵循渐进披露：

```text
dev-session-canvas/
  SKILL.md
  references/
    template-authoring.md
    canvas-control.md
    marketplace-publishing.md
    mcp-tools.md
  scripts/
    （可选，只放无法可靠靠自然语言重写的小 wrapper）
```

`SKILL.md` 只写触发条件、优先调用顺序和安全提醒。详细 schema、命令示例和市场发布规则放到 references。Skill 不直接声称知道当前画布状态：模板工作流优先调用 CLI；live 画布工作流优先调用 MCP。若 MCP 不可用，Skill 只能执行离线模板工作或提示用户先启动 / 配置 MCP，不能脑补当前画布状态。

### 7.5 Extension Host bridge 边界

未来需要一个 Host bridge，使 CLI / MCP 能在 VSCode window 已打开时请求 live 画布数据或写操作。桥的具体 transport 待定，候选包括本地 IPC socket、受控 JSON-RPC 子进程、VSCode command 中转或其他 workspace side 机制。无论选哪种 transport，都必须满足以下不变量：

- bridge 只暴露当前 workspace window 的受控能力，不扫描所有 VSCode 窗口。
- bridge 不让外部调用者直接读写 `workspaceState`、`globalState`、`storageUri` 或 Webview state。
- bridge 写操作必须带目标 root；multi-root workspace 中不能用“当前可见 pane”做外部调用的隐式目标。
- Restricted Mode 下，含 `agent` / `terminal` 的写操作必须拒绝；Note / 只读模板能力可以按现有产品语义降级。
- bridge 不改写 Codex / Claude Code 的 provider home、认证或配置根目录；Agent CLI 仍由宿主侧 resolver 在实际执行 host 上解析。
- bridge 不暴露任意 shell 执行。创建 Terminal 与向 session 写入输入是两步高风险动作，不能合并成无确认的“run command”。

### 7.6 模板发布边界

模板发布相关能力采用 CLI-first，分三档：

1. 离线作者能力：生成或编辑 `template.json`、校验 schema、保留 group / edge / note strategy、打包完整模板包、检查大小限制和相对路径。
2. 发布预检能力：对完整模板包执行市场规则检查，生成可读错误；这一层首选 CLI，MCP 只作为后续可选 adapter。
3. 真实发布能力：需要 GitHub OAuth、作者身份、市场 API 和远端写入。首版不要求 headless publish；可以由 Skill / CLI 引导用户打开现有浏览器或 VSCode 发布表单。

若后续要支持 `dscanvas marketplace publish`，必须先补充认证和 secret 存储设计，明确是否使用 VSCode `context.secrets`、浏览器 OAuth device flow、环境变量或其他机制，并说明 token 生命周期、撤销和 CI 使用边界。

## 8. 验证方法

本文当前只完成设计记录，未实现外部控制面，因此 `validation_status` 保持 `未验证`。

本次文档变更的验证方式：

- 检查 `docs/design-docs/devsessioncanvas-external-control-surfaces.md` frontmatter 是否符合 `docs/DESIGN.md`。
- 检查 `docs/design-docs/index.md` 是否登记该文档，且状态、日期与 frontmatter 一致。
- 运行 `git diff --check`，确认 Markdown 改动没有空白错误。

后续实现阶段至少需要以下验证：

- CLI：新增单元测试覆盖模板校验、模板包打包 / 解包、错误码和 JSON 输出；执行 `npm run test:canvas-templates`、`npm run test:marketplace-shared` 和新的 CLI 测试命令；live 相关 CLI 只验证 `mcp serve`、bridge doctor / ping 和只读 snapshot / list。
- MCP：使用 MCP Inspector 连接 `dscanvas mcp serve --stdio`，验证 live workspace resources、prompts、read-only tools 和错误返回；stdio server 不向 stdout 写日志；模板 tools 若未实现，不应阻塞首版验收。
- Host bridge：新增 extension host 层测试和 VSCode smoke，覆盖 read-only snapshot、create note、append template、多根 root 选择、Restricted Mode 拒绝执行节点、Remote SSH workspace side 运行位置。
- Skill：用真实任务 forward-test，至少覆盖“生成并校验模板包时调用 CLI”“读取当前画布并总结 handoff 时调用 MCP”“MCP 不可用时不脑补当前画布状态”三类请求。

## 9. 外部参考

- MCP 概览：`https://modelcontextprotocol.io/docs/getting-started/intro`
- MCP server 构建文档：`https://modelcontextprotocol.io/docs/develop/build-server`
- MCP server 概念：`https://modelcontextprotocol.io/docs/learn/server-concepts`
- MCP Inspector：`https://modelcontextprotocol.io/docs/tools/inspector`
- MCP 调试与 stdio logging 注意事项：`https://modelcontextprotocol.io/docs/tools/debugging`
