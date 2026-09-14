---
title: Agent Provider 能力对照表
decision_status: 已选定
validation_status: 验证中
domains:
  - VSCode 集成域
  - 协作对象域
  - 执行编排域
  - 项目状态域
architecture_layers:
  - 宿主集成层
  - 画布呈现层
  - 共享模型与编排层
  - 适配与基础设施层
related_specs:
  - docs/product-specs/canvas-core-collaboration-mvp.md
  - docs/product-specs/agent-launch-modes-and-restart.md
  - docs/product-specs/canvas-sidebar-node-and-session-lists.md
  - docs/product-specs/canvas-graph-links-and-file-activity.md
  - docs/product-specs/canvas-node-notifications.md
  - docs/product-specs/agent-terminal-clipboard-shortcuts.md
related_plans:
  - docs/exec-plans/active/agent-screenshot-paste-input.md
updated_at: 2026-07-11
---

# Agent Provider 能力对照表

## 1. 背景

当前仓库已经把 `Agent` provider 正式收口为 `Codex` 与 `Claude Code` 两条主路径，并在创建、启动、恢复、分叉、历史会话、通知、文件活动等位置形成了 provider-specific 分支。后续若继续扩展其他 provider，仅把 `AgentProviderKind` 加一个枚举值并不足够；新 provider 必须逐项回答自己能不能满足现有产品语义。

本文把当前已支持 provider 的能力整理成一张清单，并把它提升为后续接入 provider 的 check 表。它不是替代 `agent-launch-modes-and-restart.md`、`agent-cli-launch-context-and-resume.md`、`canvas-sidebar-node-and-session-lists.md` 或 `canvas-file-activity-view.md`，而是把这些文档中的 provider 差异集中索引出来。

## 2. 问题定义

后续新增 provider 时，至少需要明确以下问题：

1. 它是否能作为画布 `Agent` 节点运行，并能否被宿主稳定解析 CLI。
2. 它是否有明确的新会话、resume、fork、停止和恢复语义。
3. 它是否能提供可信任的 session identity，供节点重启、历史恢复和分叉使用。
4. 它是否能进入侧栏会话历史、通知 attention、文件活动等 provider-aware 能力。
5. 如果某项只能靠私有文件、启发式或尚未验证的输出文本实现，应如何标记，避免被误写成正式 provider capability。

## 3. 目标

- 给出当前 `Codex` / `Claude Code` 的支持能力对照表。
- 定义新增 provider 的最小接入门槛、推荐能力和必须显式记录的缺口。
- 让 review 能按同一张表检查 provider 接入是否覆盖现有关键路径。
- 把“已实现”“技术债 fallback”“不支持”“未验证”区分清楚。

## 4. 非目标

- 不在本文新增第三个真实 provider。
- 不把 provider 私有 session 文件格式声明为稳定公开 API。
- 不承诺所有 provider 都必须支持历史会话、fork、文件活动或结构化通知；缺口可以存在，但必须显式降级。
- 不把测试夹具 `fake-agent-provider`、`fake-codex-provider`、`fake-claude-provider` 当作面向用户的 provider。

## 5. 候选方案

### 5.1 继续把 provider 差异散落在各设计文档里

优点：

- 不新增文档维护面。

不选原因：

- 新增 provider 时很难知道需要改哪些模块和补哪些验证。
- Review 容易只看到局部启动命令，漏掉历史、恢复、通知、文件活动、设置文件等边界。

### 5.2 用独立能力对照表作为 provider 接入 checklist

这是当前选择。

核心思路：

- 横向列出现有 provider 的真实支持状态。
- 纵向列出 provider 接入必须逐项回答的能力域。
- 对每项标明实现状态、主要代码落点和验证状态。

选择原因：

- 后续 provider 扩展可以直接复制表格新增列，并在 MR 中逐项说明支持、降级或不支持。
- 表格能把“产品可见能力”和“实现依赖私有文件 / 启发式”的风险放在同一个位置，避免把 fallback 误认为稳定能力。

## 6. 风险与取舍

- 取舍：本文记录能力事实，不重新展开每个能力的完整设计。
  原因：详细语义仍应留在对应专项设计文档；本文只做 provider 维度的索引和检查。

- 风险：表格会随代码变化过期。
  当前缓解：新增 provider、修改 provider 命令语义、恢复策略、历史来源、文件活动 adapter 或通知规则时，必须同步更新本文。

- 风险：`Codex` / `Claude Code` 的部分能力依赖 provider 私有文件格式。
  当前缓解：表格用“启发式 / 私有文件 / 技术债”明确标识，不把这些能力写成 provider 官方稳定接口。

## 7. 正式方案

### 7.1 状态标记

本文使用以下标记：

- `支持`：当前仓库已有代码路径，并有自动化或人工验证记录。
- `支持（技术债）`：当前仓库已有代码路径，但依赖 provider 私有文件、输出提示、启发式匹配或尚不稳定的外部行为。
- `部分支持`：只覆盖该能力的一部分，或需要用户显式开启。
- `不支持`：当前正式口径不提供该能力。
- `不适用`：该能力对该 provider 或当前产品面无意义。
- `待验证`：设计或代码已有方向，但缺少足够验证证据。

### 7.2 Provider 能力总表

| 能力域 | Codex | Claude Code | 新 provider 接入检查 |
| --- | --- | --- | --- |
| Provider 枚举与节点 metadata | 支持：`AgentProviderKind = 'codex'` | 支持：`AgentProviderKind = 'claude'` | 必须新增 provider kind、display label、默认 metadata、协议校验和历史兼容策略 |
| 默认 CLI 命令 | `codex` | `claude` | 必须提供默认命令名，并确认在 local / Remote Extension Host 中运行 |
| CLI 命令设置 | `devSessionCanvas.agent.codexCommand` | `devSessionCanvas.agent.claudeCommand` | 必须提供 machine / machine-overridable 级命令配置，或明确复用通用 provider 配置模型 |
| 默认启动参数设置 | `devSessionCanvas.agent.codexDefaultArgs`，window scope | `devSessionCanvas.agent.claudeDefaultArgs`，window scope | 必须定义 default args 配置、scope、解析错误文案和与预设的冲突处理 |
| CLI 自动发现 / 选择 / 安装补救 | 支持：配置值、PATH、登录 shell、常见目录、VS Code 扩展目录；安装提示为 `npm i -g @openai/codex` / OpenAI 扩展入口 | 支持：配置值、PATH、登录 shell、常见目录、VS Code 扩展目录；安装提示为 `npm install -g @anthropic-ai/claude-code` / Anthropic 扩展入口 | 必须补 `getAgentCliDefaultCommand()`、display name、安装命令、文档 URL、Marketplace URL、extension root 识别 |
| 设置文件打开 / 创建 | 支持：`~/.codex/config.toml`、`~/.codex/auth.json`，尊重 `CODEX_HOME` | 支持：`~/.claude/settings.json` | 若 provider 有本地配置文件，应补 descriptor、默认安全模板、权限模式和打开命令；没有则写明不支持 |
| 创建前 provider 选择 | 支持 | 支持 | 必须进入创建入口和 Quick Input provider 列表；不能先创建默认 provider 再改 metadata |
| 嵌入式 Agent CLI 会话窗口 | 支持：PTY CLI | 支持：PTY CLI | 必须能以 repo/workspace cwd 运行，且输入输出进入统一执行节点桥 |
| Fresh start 自动启动 | 支持 | 支持 | 必须通过节点尺寸 ready 后的 pending launch 启动，不得创建即同步 spawn |
| `default` 启动预设 | `codex <defaultArgs>` | `claude <defaultArgs>` | 必须定义默认 argv 构造和展示命令 |
| `resume` 启动预设 | `codex resume <defaultArgs>`，进入 provider resume 入口，不等同恢复当前节点 | `claude --resume <defaultArgs>`，进入 provider resume 入口，不等同恢复当前节点 | 必须区分“新建节点时打开 provider resume 入口”和“停止后恢复当前节点原会话” |
| `yolo` 启动预设 | `--yolo`，会剥离已知 Codex execution mode 冲突参数后回填 | `--dangerously-skip-permissions`，会剥离已知 Claude execution mode 冲突参数后回填 | 必须明确 provider 的高权限 / 自动批准语义；没有等价能力则不应伪造 |
| `sandbox` 启动预设 | `--sandbox workspace-write` | `--permission-mode plan`，是当前较保守近似值，不是 Codex sandbox 的完全同构 | 必须说明 provider 下的沙盒 / 权限近似语义；没有等价能力则降级或移除该 provider 的预设 |
| 自定义启动命令 | 支持：首 token 必须匹配当前 Codex 设置命令或标准别名 | 支持：首 token 必须匹配当前 Claude 设置命令或标准别名 | 必须接入共享 parser / validator，不允许把整条命令交给 shell 执行 |
| 实际 spawn 方式 | `node-pty.spawn(file, args)`，不经 shell 执行整串命令 | `node-pty.spawn(file, args)`，不经 shell 执行整串命令 | 必须保持结构化 `file + args[]`，避免 shell injection 和 UI/Host 双标 |
| CLI cwd | 支持：使用节点 cwd / workspace cwd，不切到扩展私有目录 | 支持：使用节点 cwd / workspace cwd，不切到扩展私有目录 | 必须确认 provider 能在 repo cwd 直接运行，并继承用户现有认证 / 配置上下文 |
| Shell env / PATH 继承 | 支持：复用 Agent execution env 与 resolver cache | 支持：复用 Agent execution env 与 resolver cache | 必须复用 `shellEnvironmentResolver` / `agentCliResolver` 路线，避免 resolver 找到但 spawn 失败 |
| 图片输入 / Agent 截图粘贴 | 支持：Codex 官方支持 `--image/-i`、交互 composer 图片粘贴和图片文件上下文；当前画布以保存临时图片文件并回填 shell-safe 路径文本的跨 provider bridge 接入，自动化覆盖 Webview/Host 路径注入，不伪造 provider 原生附件 chip | 支持：Claude Code 官方支持拖放图片、图片剪贴板粘贴和图片路径输入；当前画布同样以临时图片路径 bridge 接入，不伪造 `[Image #N]` chip | 必须明确 provider 是否支持本地图片文件路径作为 prompt 上下文；若只支持 GUI 附件、私有 chip 或不可从 PTY 文本引用图片，则不能默认复用截图粘贴，必须新增 provider adapter 或禁用该能力 |
| 运行态 `running` / `waiting-input` | 支持：当前以 PTY / attention signal / quiet period 启发式为主 | 支持：当前以 PTY / attention signal / quiet period 启发式为主 | 若 provider 有结构化事件，应优先接入；没有则只能作为 fallback 启发式 |
| Stop 行为 | 支持：先单次 `Ctrl-C` graceful stop，等待 Codex resume hint / token usage，超时后 force kill | 支持：不发送普通 `Ctrl-C` 收尾，沿用直接终止信号路径 | 必须定义 provider-specific stop，不要假设所有 CLI 都能用同一种 Ctrl-C 语义 |
| `Ctrl-Z` / job control | 普通输入路径，不走 Claude 专属阻断 | 支持阻断：Webview / Host / runtime supervisor 拒绝 Claude Agent `Ctrl-Z`，提示停止、恢复或分叉 | 必须评估 direct-spawn CLI 是否支持 shell job table；不支持时不得承诺 `fg` 恢复 |
| 显式 session resume 命令 | `codex resume <session-id>` | `claude --resume <session-id>` | 必须有 provider 原生显式 session id 恢复入口；否则不能进入正式自动恢复 / 历史恢复主路径 |
| Fresh start session id 获取 | 支持（技术债）：扫描 `~/.codex/sessions/.../rollout-*.jsonl` 首行 `session_meta`，按 cwd + 启动时间窗唯一匹配；停止输出 hint 可补充 | 支持：可注入 / 识别 `--session-id`、`--resume`、`--continue` 候选，并用 `~/.claude/projects/.../<session-id>.jsonl` 文件确认；停止输出 hint 可更正 | 必须明确 session id 来源是否可信。仅扫描私有文件或按时间猜测时，只能标技术债 / fail closed |
| 自动恢复资格 | 支持（技术债）：只有拿到可信 `codex-session-id` 时才可恢复；否则 `interrupted` / history restored | 支持：只有确认 `claude-session-id` 时才可恢复；否则 fail closed | 必须实现 `AgentResumeStrategy`，并定义何时可进入 `resume-ready` |
| 停止后 `新建` | 支持：按节点 `launchPreset/customLaunchCommand` fresh start | 支持：按节点 `launchPreset/customLaunchCommand` fresh start | 必须区分 fresh start 与恢复原会话 |
| 停止后 `恢复` | 支持：持有可信 session id 时恢复当前节点原会话 | 支持：持有可信 session id 时恢复当前节点原会话 | 必须只恢复当前节点绑定 session，不允许退化成 provider 最近会话 |
| 当前节点 Fork | 支持：`codex fork <session-id>`，创建同 provider 新节点并自动连 `fork` 用户边 | 支持：`claude --resume <session-id> --fork-session`，创建同 provider 新节点并自动连 `fork` 用户边 | 必须有 provider 原生 fork 语义；普通 resume 不能包装成 Fork |
| 历史会话 Fork | 支持：从历史 session id 创建新 Agent，执行 `codex fork <session-id>`；无来源节点，不自动连线 | 支持：从历史 session id 创建新 Agent，执行 `claude --resume <session-id> --fork-session`；无来源节点，不自动连线 | 必须复用 provider-native fork；没有原生 fork 时隐藏或禁用历史分叉 |
| 会话历史来源 | 支持（技术债）：扫描 `~/.codex/sessions/<yyyy>/<mm>/<dd>/rollout-*.jsonl` | 支持（技术债）：扫描 `~/.claude/projects/**/*.jsonl`，只接受 transcript 内显式 cwd | 必须提供 workspace 归属依据；无法确认 cwd 时 fail closed，不展示为当前 workspace 会话 |
| 历史标题来源 | 支持：读取第一条真实 user instruction，跳过已知 synthetic 前缀，失败回退 provider + 短 session id | 支持：读取第一条真实 user instruction，跳过已知 synthetic 前缀，失败回退 provider + 短 session id | 必须定义标题提取和 synthetic 输入过滤，不能把注入上下文当用户标题 |
| 侧栏节点列表展示 | 支持：显示 cwdLabel、provider、状态、attention | 支持：显示 cwdLabel、provider、状态、attention | 新 provider 必须提供 display label 和 provider 图标 / fallback 图标 |
| Provider 图标 | 支持：`images/provider-codex-openai.svg`，缺失时 fallback SVG | 支持：`images/provider-claude-code-anthropic.svg`，缺失时 fallback SVG | 必须补图标资产或明确 fallback，保持 sidebar / history 一致 |
| 终端 attention signal | 支持：BEL / OSC 9 / OSC 777 统一解析 | 支持：BEL / OSC 9 / OSC 777 统一解析 | 所有 PTY provider 默认继承；若 provider 有结构化通知，应优先接入但不能破坏通用 signal |
| Agent 异常退出提醒 | 支持：已运行后非用户主动非 0 退出可触发 `agentAbnormalExit` | 支持：已运行后非用户主动非 0 退出可触发 `agentAbnormalExit` | 新 provider 默认可复用，但需确认启动失败、用户停止、正常退出不触发 |
| 输出文本异常提醒 | 部分支持：默认关闭；用户设置 `agentAbnormalOutputTextNotifications=codex` 且启用 `codexAbnormalOutputText` 后识别高置信 Codex 最终失败文本 | 不支持：没有真实输出样本或结构化 StopFailure 前，不做 Claude 文本正则 | 不应复制 Codex 正则；应优先结构化错误事件，没有证据就不支持 |
| Provider 结构化通知事件 | 不支持：当前未直接接入 Codex app-server / protocol 事件 | 不支持：当前未直接接入 Claude hooks notification 事件到 attention | 若 provider 提供结构化 turn complete / approval / input request，应作为新增能力单独设计和验证 |
| 文件活动 | 不支持：adapter 当前 no-op，未确认 Codex 结构化文件事件接口 | 支持：通过临时 `claude --settings <file>` hooks 监听 `Read` / `Edit` / `Write`，写入 session 事件流 | 必须有 provider 原生结构化文件事件；不得从 PTY 文本推断文件活动 |
| Runtime supervisor / live-runtime | 支持：本地 PTY 与 runtime supervisor 两条路径都传递 provider、resumeStrategy、session id | 支持：本地 PTY 与 runtime supervisor 两条路径都传递 provider、resumeStrategy、session id | 必须让 supervisor 创建、输出、停止、resume hint 解析与 snapshot 序列化都认识该 provider |
| Restricted Mode | 支持受限：可浏览历史和画布，不能创建 / 恢复 / 分叉执行节点 | 支持受限：可浏览历史和画布，不能创建 / 恢复 / 分叉执行节点 | 新 provider 不得绕过 `workspace.isTrusted` 执行限制 |
| Virtual Workspace | 不支持 | 不支持 | 除非整体产品边界改变，否则新 provider 也不应声明支持 Virtual Workspace |
| 当前主要技术债 | session id 与历史依赖 `~/.codex/sessions` 私有文件和时间窗匹配；Windows Codex 执行节点内历史不能向上翻页 | 会话历史依赖 `~/.claude/projects` 私有 transcript；文件活动依赖 Claude hooks 临时 settings 注入 | 新 provider 的私有文件、hook、protocol 假设必须登记退出条件 |

### 7.3 最小接入门槛

一个新 provider 如果要进入用户可见 `Agent` 创建入口，至少必须完成以下项目：

1. 在 `extensions/vscode/dev-session-canvas/src/common/protocol.ts` 中扩展 `AgentProviderKind`、provider 校验、launch defaults 与相关消息 payload。
2. 在 `extensions/vscode/dev-session-canvas/src/panel/agentCliSelection.ts` / `extensions/vscode/dev-session-canvas/src/panel/agentCliResolver.ts` 路线上提供默认命令、显示名、安装 / 文档入口和可诊断解析失败路径。
3. 在 `extensions/vscode/dev-session-canvas/src/common/agentLaunchPresets.ts` 中定义 `default`、`resume`、`yolo`、`sandbox`、`custom` 的真实映射；没有等价语义时必须明确降级或不展示，不能借用其他 provider 的参数。
4. 在 `extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts` fresh-start 路径中确认 provider 命令解析、cwd、env、runtime supervisor 参数、状态更新和错误文案。
5. 在 `extensions/vscode/dev-session-canvas/src/webview/main.tsx`、sidebar 与命令入口中补 provider label、图标、创建路径和受限 workspace 行为。
6. 至少通过自动化覆盖：命令构造、协议 payload、Webview 创建消息、Host fresh-start fallback、Restricted Mode 拦截。

如果新 provider 不满足显式 session id 恢复能力，仍可只作为“一次性 fresh-start Agent”接入，但必须同时禁用或隐藏以下能力：

- 停止后 `恢复` 原会话
- 当前节点 `分叉`
- 历史恢复
- 历史分叉
- `resume-ready` 自动恢复

### 7.4 推荐完整接入能力

如果新 provider 要达到与当前 Codex / Claude Code 接近的完整体验，还应补齐：

1. 显式 session id 获取和恢复策略，并在 `AgentResumeStrategy` 中建模。
2. 会话历史扫描或 provider 官方 history API，且能 fail closed 地确认 workspace cwd。
3. Provider 原生 fork 命令；没有原生 fork 时不提供 Fork UI。
4. Provider 原生结构化文件活动事件；没有结构化事件时 `agentFileActivity` adapter 必须 no-op。
5. Provider 原生结构化 notification / error / approval 事件；在接入前只能使用通用 terminal signal 和异常退出 fallback。
6. 与 runtime supervisor snapshot / attach / stop-time hint 的双路径验证。
7. README / 支持边界 / 发布说明中明确 CLI 安装和已知限制。

### 7.5 主要实现落点

新增或修改 provider 时，默认需要检查以下代码和文档：

- `extensions/vscode/dev-session-canvas/src/common/protocol.ts`：provider 枚举、metadata、消息 payload、runtime context。
- `extensions/vscode/dev-session-canvas/src/common/agentLaunchPresets.ts`：启动预设、resume / fork 命令、parser / validator、provider-specific 参数归一化。
- `extensions/vscode/dev-session-canvas/src/common/agentSessionHistory.ts`：历史扫描、workspace cwd 归属、标题提取。
- `extensions/vscode/dev-session-canvas/src/common/codexSessionIdLocator.ts`：当前名称历史遗留，承载 Codex / Claude session id 发现；新增 provider 时应考虑重命名或拆分，而不是继续扩大误导性命名。
- `extensions/vscode/dev-session-canvas/src/panel/agentCliSelection.ts`、`extensions/vscode/dev-session-canvas/src/panel/agentCliResolver.ts`：CLI 发现、安装补救和错误提示。
- `extensions/vscode/dev-session-canvas/src/panel/agentSettingsFiles.ts`：provider 配置文件入口。
- `extensions/vscode/dev-session-canvas/src/panel/agentFileActivity.ts`：文件活动 adapter。
- `extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts`：Host 权威状态、启动 / 停止 / 恢复 / 分叉 / 通知 / runtime supervisor 接线。
- `extensions/vscode/dev-session-canvas/src/supervisor/runtimeSupervisorMain.ts`：live-runtime 创建、输入阻断、resume hint、snapshot。
- `extensions/vscode/dev-session-canvas/src/webview/main.tsx`：创建菜单、节点标题栏动作、provider 图标 / 文案。
- `extensions/vscode/dev-session-canvas/src/sidebar/CanvasSidebarSessionHistoryView.ts`、`extensions/vscode/dev-session-canvas/src/sidebar/CanvasSidebarNodeListView.ts`：侧栏展示与历史操作。
- `package.json`、`package.nls.json`：配置项、命令、文案。
- `README.md`、`README.zh-CN.md`、`docs/support.md`：对外支持边界。
- 本文与相关专项设计文档：同步 provider 能力事实和验证状态。

## 8. 验证方法

新增 provider 或修改已有 provider capability 时，至少应按能力变更范围补以下验证：

1. `npm run test:agent-launch-presets`：覆盖 provider 命令构造、默认参数 parse error、resume / fork 参数剥离和自定义命令校验。
2. `npm run test:protocol-webview-messages`：覆盖 provider payload schema。
3. `npm run test:canvas-execution-context` 或对应 Host 脚本测试：覆盖节点 metadata、cwd、fresh-start、resume/fork 分流。
4. `npm run test:sidebar-session-history`：若接入历史，覆盖 workspace 过滤、标题提取、恢复和分叉命令。
5. `npm run test:execution-attention-signals`：若接入通知 / 异常文本，覆盖 allow-list、冷却和 stale buffer 抑制。
6. `npm run test:webview` focused provider 入口：覆盖创建菜单、标题栏动作、Fork 可见性和受限工作区提示。
7. `npm run typecheck` 与 `npm run build`。
8. 至少一次真实 Extension Development Host 人工验证：CLI 可解析、能启动、能停止，若声明支持 resume / fork / history / file activity，也要逐项验证真实 provider 行为。

## 9. 当前验证状态

- 2026-06-19：本文首次整理当前 `Codex` / `Claude Code` provider 能力矩阵。能力事实来自当前设计文档与代码路径复核；本次为文档整理，不新增运行时代码。
- 2026-06-25：补充图片输入 / Agent 截图粘贴能力。Codex 与 Claude Code 均有官方图片输入或图片路径入口；当前画布选择保存临时图片并回填路径文本作为跨 provider bridge，验证记录见 `docs/exec-plans/active/agent-screenshot-paste-input.md` 和 `docs/design-docs/execution-terminal-clipboard-shortcuts.md`。
- 当前整体状态保持 `验证中`：`Codex` session id / history 仍依赖私有文件和启发式匹配，`Claude Code` history 仍依赖私有 transcript，provider 级真实 fork 仍建议在安装对应 CLI 的 Development Host 中人工确认。
