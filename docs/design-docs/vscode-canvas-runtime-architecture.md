---
title: VSCode 画布运行时与技术路线初步设计
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
  - 画布呈现层
  - 共享模型与编排层
  - 适配与基础设施层
related_specs: []
related_plans:
  - docs/exec-plans/active/canvas-architecture-research.md
updated_at: 2026-03-28
---

# VSCode 画布运行时与技术路线初步设计

## 1. 背景

仓库当前只完成了文档骨架迁移，还没有进入实现阶段。此前的顶层架构说明已经给出了一组领域边界，但没有把这些边界和 VSCode 扩展能力、远程场景、终端能力、画布技术路线之间的关系写清楚，也没有做方案比较。

本文件的职责是补齐这一层缺口：先把外部约束与候选方案摆清，再给出一组可以继续推进到原型与实现阶段的初步设计结论。

## 2. 问题定义

要在 VSCode 内复刻 OpenCove 的核心协作体验，至少要回答以下问题：

1. 扩展应优先运行在哪种宿主形态中，才能承载 Agent、终端和 workspace 访问能力。
2. 无限画布的主入口应该放在 VSCode 的哪个 UI 面里，才能既符合宿主习惯，又给足空间。
3. 画布底层更适合采用节点图导向、白板导向，还是自研高性能渲染路线。
4. 终端对象如何进入画布，才能在“体验完整度”“实现风险”“远程兼容性”之间取得平衡。
5. 哪些状态应由 Extension Host 持有，哪些状态只留在 Webview，哪些状态需要持久化。
6. Agent 能力应如何被接入，才能不把当前文档过早绑定到某个 provider 或某种执行框架。

## 3. 目标

- 为第一阶段实现建立稳定的运行时边界，而不是继续讨论抽象概念。
- 为无限画布、四类核心对象和状态恢复主路径提供一条实现复杂度可控的路线。
- 让方案默认适配本地 workspace，并对 Remote / Codespaces 场景保持可演进。
- 把安全、可靠性和性能风险明确登记为设计约束，而不是事后补洞。

## 4. 非目标

- 本文不追求一次性锁定长期终态架构。
- 本文不要求第一阶段就完成浏览器形态或 `vscode.dev` 兼容。
- 本文不要求第一阶段就提供完全嵌入式、全功能的 in-canvas shell。
- 本文不锁定 AI provider、MCP server 或具体外部 Agent runtime。
- 本文不展开单个交互细节、视觉规范或完整产品规格。

## 5. 外部约束与研究要点

以下条目分为两类：

- `官方边界`：来自候选技术或 VSCode 官方文档的明确能力约束。
- `设计推论`：基于这些边界和当前产品目标做出的初步推导，仍需后续原型验证。

### 5.1 VSCode 宿主与 UI 约束

- 官方边界：Webview 适用于 VSCode API 无法直接表达的自定义体验，但官方明确要求“只在确有必要时使用”，并要求主题适配、可访问性和与 workspace 相关性。
- 官方边界：`WebviewView` 属于 Sidebar / Panel 内的视图，官方 UX 指南建议限制自定义 `WebviewView` 的使用数量，也不建议把它作为打开编辑器内 Webview 的入口。
- 官方边界：`CustomEditor` 的定位是“某个资源的替代视图”，其文档模型围绕具体资源展开。
- 设计推论：当前产品的主对象是“workspace 内的一张协作画布”，而不是某个文件的另一种编辑器，因此更适合作为 Editor Group 中的 `WebviewPanel`，而不是 `CustomEditor` 或侧边栏 `WebviewView`。

### 5.2 Webview 生命周期、通信与恢复

- 官方边界：Webview 与 Extension Host 之间只能通过消息传递通信。
- 官方边界：Webview 资源需要通过 `asWebviewUri` 和 `localResourceRoots` 管理，并需要设置 CSP。
- 官方边界：`retainContextWhenHidden` 会增加较高内存开销，官方建议优先使用 `setState()` / `getState()` 做状态恢复。
- 官方边界：`registerWebviewPanelSerializer` 可以在编辑器重启后恢复 `WebviewPanel`。
- 设计推论：当前不应让 Webview 成为唯一状态来源。更稳妥的做法是让 Webview 保存相机、选中态等 UI 临时状态，而把对象模型与持久化交给宿主。

### 5.3 扩展运行位置与远程场景

- 官方边界：VSCode 有本地、远程和 Web 三种 Extension Host 形态；`workspace` 类扩展在远程工作区中会运行在远端。
- 官方边界：即使扩展本身作为 Workspace Extension 运行在远端，Webview 仍总是在用户本机或浏览器侧运行。
- 官方边界：远程场景下，官方建议优先通过消息传递更新 Webview，而不是让 Webview 直接依赖 `localhost` 服务。
- 官方边界：Web extension 无法使用 Node.js API，也不能创建子进程或运行可执行文件。
- 设计推论：由于当前核心范围明确包含终端和 Agent 执行能力，第一阶段不应以纯 web extension 为目标形态，而应以 Node.js 的 workspace extension 为主。

### 5.4 终端能力边界

- 官方边界：VSCode 提供 `Terminal` API，可把终端放在 Panel 或 Editor 区域；同时提供 shell integration 事件与命令执行能力。
- 官方边界：VSCode 提供 `Pseudoterminal`，允许扩展控制终端输入输出，但这本身不等价于“直接获得一个真实 shell 的嵌入式终端组件”。
- 官方边界：官方 API 没有提供“把 VSCode 原生终端直接嵌入 Webview”的能力。
- 官方边界：`node-pty` 可以在 Node 环境里 fork pty，适合与 `xterm.js` 组合构建终端，但它启动的进程和父进程同权限，且 README 明确提醒相关安全风险。
- 设计推论：如果把“完全嵌入式终端”作为第一阶段的硬前提，会立刻把扩展绑定到一条更高风险的 `xterm.js + pty bridge` 路线。当前更稳妥的初始方案是“画布上的终端对象”先以 VSCode 原生终端会话为执行源，画布节点负责表达、定位和控制。

### 5.5 画布技术路线约束

- 官方边界：React Flow 明确支持自定义节点，并建议直接在节点内部嵌入表单、图表等交互内容。
- 官方边界：React Flow 同时明确指出，大量节点或复杂节点会带来重渲染压力，需要额外控制状态订阅与组件稳定性。
- 官方边界：tldraw 的形状是 JSON record，支持自定义 Shape、Tool、Binding 与 UI 覆写，更偏向通用白板/无限画布引擎。
- 官方边界：PixiJS 提供适合大场景的 Container、Render Group、Culler 等优化手段，但它是底层渲染框架，不直接提供我们所需的节点、边、表单和富交互对象语义。
- 设计推论：当前第一阶段的核心对象更像“高交互节点图”，而不是开放式白板。相比 tldraw 和 PixiJS，React Flow 在 MVP 阶段更接近需求重心。

### 5.6 AI 能力接入

- 官方边界：VSCode 当前提供 Language Model Tool、MCP Tool、Chat Participant、Language Model API 等多种 AI 扩展路径，适用场景不同。
- 设计推论：当前产品目标是“在画布上看清多 Agent 协作”，而不是“先绑定某个 VSCode AI 扩展点”。因此文档层应先设计 Agent 适配边界，而不是先选 LM Tool / MCP / 外部 CLI 之一。

## 6. 候选方案

### 6.1 扩展宿主形态

| 方案 | 优点 | 风险 | 初步判断 |
| --- | --- | --- | --- |
| 纯 web extension | 对 `vscode.dev` 友好 | 不能使用 Node API、子进程、真实终端执行；与当前核心范围冲突 | 当前排除 |
| Node.js workspace extension | 最贴近 terminal / workspace / remote 执行需求 | 浏览器形态需要后续额外适配 | 当前首选 |
| Node + browser 双入口 | 长期兼容性最好 | 初期复杂度显著增加，且浏览器侧能力残缺 | 作为后续演进，不作为 P0 前提 |

### 6.2 画布主界面承载方式

| 方案 | 优点 | 风险 | 初步判断 |
| --- | --- | --- | --- |
| `WebviewPanel` | 位于 Editor Group，空间足够，天然适合“主工作面” | 需要自行处理生命周期与恢复 | 当前首选 |
| `WebviewView` | 与侧边栏生态一致 | 宽度受限，官方建议限制使用；不适合作为主画布 | 仅适合作为后续辅助视图 |
| `CustomEditor` | 具备文件式生命周期与 undo/redo 语义 | 本问题不是“某个文件的替代编辑器” | 当前排除 |

### 6.3 画布渲染路线

| 方案 | 优点 | 风险 | 初步判断 |
| --- | --- | --- | --- |
| React Flow | 节点图能力成熟，自定义节点适合富交互对象 | 高节点数下要严格控制重渲染 | 当前首选 |
| tldraw | 无限画布能力强，工具/绑定/shape 体系完整 | 更偏白板范式，嵌入复杂业务节点时可能需要“逆着框架建应用” | 作为长期备选 |
| PixiJS / 自研渲染 | 性能和可控性上限高 | 需要自行补大量 UI、命中测试、文本编辑与可访问性能力 | 当前不选 |

### 6.4 终端进入画布的方式

| 方案 | 优点 | 风险 | 初步判断 |
| --- | --- | --- | --- |
| 原生终端代理节点 | 可复用 VSCode 原生终端、shell integration 与远程能力 | 画布内交互沉浸感不如真正嵌入式终端 | 当前首选 |
| `xterm.js + node-pty` 嵌入式终端 | 最接近参考产品体验 | 需要完整 pty 桥、权限控制、远程与恢复方案 | 作为独立原型验证项 |
| `Pseudoterminal` 为主 | 便于扩展控制输入输出 | 更适合日志流 / 虚拟终端，不天然等于真实 shell | 不作为主路线 |

### 6.5 状态权威来源

| 方案 | 优点 | 风险 | 初步判断 |
| --- | --- | --- | --- |
| Webview 为主、宿主只做落盘 | 前端实现直观 | 重载恢复、远程事件、终端/Agent 状态同步更脆弱 | 当前不选 |
| Extension Host 为主、Webview 为投影 | 易于接终端/Agent/持久化，恢复链路更清晰 | 需要设计消息协议与局部乐观更新 | 当前首选 |
| 一开始就上 CRDT / 协作存储 | 为多人协作预埋基础 | 当前范围没有多人实时协作，复杂度过高 | 延后 |

## 7. 当前结论

以下结论是“本轮初步设计的当前收敛点”，不是长期不可变的最终结论。

### 7.1 运行时总图

当前更推荐采用如下结构：

1. 以 `Node.js workspace extension` 作为第一阶段唯一必须落地的宿主形态。
2. 以 `WebviewPanel` 作为主画布入口，位于 Editor Group。
3. 以“宿主权威状态 + Webview 投影”的消息驱动架构作为状态主线。
4. 以 React Flow 为第一阶段画布引擎，但通过自有抽象隔离具体库。
5. 以“原生终端代理节点”闭合第一阶段终端主路径，把嵌入式终端降为实验路线。

### 7.2 分层职责

`宿主集成层`

- 注册命令、打开/恢复 `WebviewPanel`
- 管理 VSCode `Terminal`、workspace、trust、secrets、storage
- 处理远程工作区与本地工作区差异

`共享模型与编排层`

- 定义四类对象的共享数据模型
- 定义 Webview <-> Host 的命令/事件协议
- 定义对象状态流转与运行时会话映射

`适配与基础设施层`

- `CanvasStorage`：负责 `workspaceState` / `storageUri` 下的数据读写
- `TerminalSessionAdapter`：抽象 VSCode 终端会话
- `AgentAdapter`：抽象 Agent 启动、事件和输出流
- `SecretConfigStore`：抽象密钥与 provider 配置

`画布呈现层`

- React + React Flow 渲染节点、边、选择、导航
- 维护局部 UI 状态，例如相机、拖拽中状态、浮层展开态
- 通过 typed message bridge 向宿主发送用户意图

### 7.3 初步对象模型

建议先抽象一个统一的 `CanvasNode` 基类，再派生四类对象：

`CanvasNode`

- `id`
- `kind`: `agent | terminal | task | note`
- `title`
- `position`
- `size`
- `status`
- `createdAt` / `updatedAt`
- `runtimeRef?`: 指向宿主侧运行时对象
- `metadata`: 各类型共享但可扩展的轻量字段

`AgentNode`

- 任务目标摘要
- 当前状态与最近一步输出摘要
- 关联的 terminal / task / note 引用

`TerminalNode`

- 对应 VSCode terminal 会话 ID
- 当前 cwd / shell / 活跃状态摘要
- 最近输出摘要或状态提示
- `revealMode`: 在 panel / editor 中打开的偏好

`TaskNode`

- 任务描述
- 负责人或所属 Agent
- 状态机：`todo | running | blocked | done`

`NoteNode`

- 富文本或 Markdown 内容
- 与其他节点的引用关系

对象之间的关系建议先用显式 `CanvasEdge` 表达，而不是一开始就把分组、嵌套、约束系统做全。

### 7.4 状态与持久化分层

这里的存储分层是设计推论，基于 VSCode 官方对 `workspaceState`、`storageUri`、`SecretStorage` 的职责描述做出的当前判断：

- `Webview.setState()`：只保存相机位置、局部折叠状态、选中对象等 UI 临时状态。
- `workspaceState`：保存少量可快速读取的索引，例如最近打开的画布文档 ID、最近聚焦节点。
- `storageUri`：保存画布快照、对象图、运行时恢复所需的 workspace 私有文件。
- `SecretStorage`：保存 provider key、token 或需要加密保存的配置。

当前不建议在第一阶段把画布状态直接写入仓库文件：

- 当前产品目标是复刻协作体验，不是先定义协作文件格式。
- 直接写入仓库会立刻引入 merge、review、隐私与 workspace 污染问题。
- 若后续需要导出/分享，再单独设计导入导出格式更稳妥。

### 7.5 终端策略

终端是本轮最容易被“理想体验”拖进高复杂度的部分，因此需要显式分阶段。

`第一阶段`

- 画布上的终端对象代表一个真实的 VSCode `Terminal` 会话。
- 节点展示标题、状态、最近输出摘要、cwd、执行中标记和快捷动作。
- 用户可以从节点执行“创建终端”“聚焦终端”“在编辑器打开终端”“回到画布”等动作。
- 终端实际 I/O 与 shell integration 仍由 VSCode 原生终端负责。

`待验证路线`

- 用 `xterm.js` 作为 Webview 内终端前端。
- 用宿主侧 pty 适配器连接真实 shell。
- 验证重点不是“能不能跑起来”，而是远程工作区、重连恢复、权限边界、复制粘贴、滚动和性能是否可接受。

### 7.6 Agent 策略

当前不把“Agent”直接等同于某个 provider 或某种 VSCode AI API，而是先定义宿主侧适配边界：

- `AgentAdapter.start(runSpec)`
- `AgentAdapter.stop(runId)`
- `AgentAdapter.subscribe(runId, listener)`
- `AgentAdapter.resume(runId)`

这样做的目的不是回避选型，而是避免让画布对象模型被底层执行框架反向绑死。后续无论接 VSCode Language Model Tool、MCP、外部 CLI Agent，还是仓库内自建 orchestrator，都应先对齐这个边界。

### 7.7 安全与信任边界

当前建议在扩展层显式支持 Restricted Mode：

- 未信任 workspace 时，允许打开画布和查看已保存对象布局。
- 禁止创建会执行代码或命令的 Agent / Terminal 动作。
- 对所有可能触发执行的命令同时做 UI 隐藏和运行时拦截。

同时，任何来自 workspace 的文本、Markdown、日志或命令展示，都不应直接在 Webview 中以未净化 HTML 渲染。

## 8. 风险与取舍

- 取舍：选择“原生终端代理节点”会牺牲一部分参考产品的沉浸感。
  原因：当前没有官方能力可直接把 VSCode 原生终端嵌进 Webview；强推嵌入式终端会显著抬高第一阶段风险。

- 取舍：选择 React Flow 而非更自由的白板引擎，会让第一阶段更偏节点图。
  原因：当前四类对象都属于高信息密度、高交互组件，优先解决“对象可读、状态清楚、关系可见”，再考虑白板自由度更合理。

- 风险：如果 Host 成为唯一权威状态源，拖拽等高频交互可能因消息往返带来卡顿。
  当前缓解：允许 Webview 在拖拽过程中本地乐观更新，落点或节流后再提交宿主。

- 风险：如果终端节点只展示摘要，用户可能认为“终端并不真的在画布里”。
  当前缓解：必须把节点状态、最近输出、跳转和回流动作做完整，否则该路线没有成立价值。

- 风险：Agent 适配层如果过度抽象，后续实现时可能发现真正的执行模型差异很大。
  当前缓解：下一阶段应尽快选一个最小 Agent backend 做垂直打通原型。

## 9. 验证方法

本设计在进入正式实现前，至少需要以下验证：

1. `WebviewPanel` 原型
   验证打开、关闭、隐藏、恢复、reload 后的状态保持。

2. React Flow 画布原型
   验证四类节点的自定义渲染、拖拽、缩放、选中和 50 至 100 节点规模下的流畅度。

3. 原生终端代理节点原型
   验证 terminal 创建、状态回传、最近输出摘要、聚焦跳转、editor/panel 两种 reveal 模式。

4. 远程工作区 smoke test
   验证在 Remote / Codespaces 场景下，Webview 通信与 terminal 操作不依赖 Webview 直接访问 `localhost`。

5. Restricted Mode 验证
   验证未信任 workspace 时，执行型动作被正确隐藏或拦截。

若以上任一验证失败，应回到本文件更新“候选方案”“风险与取舍”或“当前结论”，而不是继续把当前方案当作既定事实推进。

## 10. 参考资料

以下资料于 2026-03-28 检索，用于支撑本轮初步设计：

- VSCode Webviews UX 指南
  https://code.visualstudio.com/api/ux-guidelines/webviews
- VSCode Views UX 指南
  https://code.visualstudio.com/api/ux-guidelines/views
- VSCode Custom Editor API
  https://code.visualstudio.com/api/extension-guides/custom-editors
- VSCode Web Extensions
  https://code.visualstudio.com/api/extension-guides/web-extensions
- VSCode Extension Host
  https://code.visualstudio.com/api/advanced-topics/extension-host
- VSCode Remote Development and Codespaces
  https://code.visualstudio.com/api/advanced-topics/remote-extensions
- VSCode API Reference
  https://code.visualstudio.com/api/references/vscode-api
- VSCode Workspace Trust
  https://code.visualstudio.com/api/extension-guides/workspace-trust
- VSCode AI extensibility overview
  https://code.visualstudio.com/api/extension-guides/ai/ai-extensibility-overview
- React Flow API / Custom Nodes / Performance
  https://reactflow.dev/api-reference
  https://reactflow.dev/learn/customization/custom-nodes
  https://reactflow.dev/learn/advanced-use/performance
- tldraw Shapes / Editor / User Interface
  https://tldraw.dev/docs/shapes
  https://tldraw.dev/sdk-features/editor
  https://tldraw.dev/docs/user-interface
- PixiJS Container / Culler Plugin
  https://pixijs.com/8.x/guides/components/scene-objects/container
  https://pixijs.com/8.x/guides/components/application/culler-plugin
- xterm.js 文档
  https://xtermjs.org/docs
- node-pty README
  https://github.com/microsoft/node-pty
