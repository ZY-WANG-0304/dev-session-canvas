---
title: IntelliJ Platform 插件架构
decision_status: 比较中
validation_status: 验证中
domains:
  - 项目状态域
  - 画布交互域
  - 协作对象域
  - 执行编排域
architecture_layers:
  - 宿主集成层
  - 画布呈现层
  - 共享模型与编排层
  - 适配与基础设施层
related_specs:
  - docs/product-specs/canvas-core-collaboration-mvp.md
  - docs/product-specs/runtime-persistence-modes.md
related_plans:
  - docs/exec-plans/active/intellij-platform-plugin.md
updated_at: 2026-07-01
---

# IntelliJ Platform 插件架构

## 1. 背景

DevSessionCanvas 当前正式运行形态是 VS Code workspace extension。主扩展位于 `extensions/vscode/dev-session-canvas/`，notifier companion 位于 `extensions/vscode/dev-session-canvas-notifier/`。2026-06-30 起，仓库中已经新增 IntelliJ 插件工程 `extensions/intellij/dev-session-canvas/`，用于里程碑 1 的 Tool Window、JCEF 和 React Flow PoC；跨 IDE 协议生成包和共享 Webview 包仍不存在。现有 VS Code 版本已经验证了多会话画布、Note、Terminal、Agent、运行时持久化和 notifier companion 等核心能力，但这些能力都建立在 VS Code Webview、Extension Host、workspace storage 和命令系统之上。

IntelliJ Platform 插件的目标是先把同一产品能力带到 Android Studio、IntelliJ IDEA 和 PyCharm。WebStorm、GoLand、CLion 等其他 JetBrains IDE 只作为后续兼容目标，除非完成对应 smoke 或 Plugin Verifier 证据，否则不能写成第一版已支持。JetBrains IDE 的宿主模型、UI 容器、持久化接口、测试工具和发布渠道都不同于 VS Code，因此不能把 VS Code 实现简单复制过去。本设计文档记录 IntelliJ 插件的初始架构比较和当前结论，供 `docs/exec-plans/active/intellij-platform-plugin.md` 后续实现推进时使用。

## 2. 问题定义

这项设计需要解决五个问题。

第一，IntelliJ 插件应该如何落在当前 monorepo 中。仓库已经把 VS Code 主扩展和 notifier companion 放在 `extensions/vscode/` 下，根目录是 private workspace root。IntelliJ 插件需要使用 Gradle 和 Kotlin，但不能让根 npm workspace 继续承担 JVM 构建细节。

第二，当前 React / React Flow 画布如何在 JCEF 中运行。VS Code 版本的 `extensions/vscode/dev-session-canvas/src/webview/main.tsx` 直接调用 `acquireVsCodeApi()`，并假设 VS Code Webview 的消息、资源、生命周期和 CSP 语义。IntelliJ 版至少需要一个 host bridge adapter，并要证明 JCEF 可以加载 React Flow bundle、处理 pan / zoom 等输入事件。

第三，TypeScript 与 Kotlin 如何共享协议。当前 `extensions/vscode/dev-session-canvas/src/common/protocol.ts` 是 VS Code Host 与 Webview 的事实协议，但它不是跨语言单一真相。直接手写完整 Kotlin 镜像会造成漂移；立刻抽完整 JSON Schema 也可能过重。

第四，执行型节点在 IntelliJ 里如何运行。Terminal 节点需要 PTY 后端，Agent 节点需要 CLI 命令发现、cwd 继承、输入输出回流和停止语义。Runtime Supervisor 是跨 IDE 生命周期持久化的增强，不应成为 Agent 第一版启动的前提，也不能在未验证前承诺 live runtime。

第五，测试、文档和发布如何贯穿实现。测试和设计文档不能集中留到发布前；每个实现里程碑都必须同步验证证据、未验证边界和相关文档。第一版发布范围已确认是内部/手动安装验证，不默认上 JetBrains Marketplace；最终发布准备只应处理可手动安装的插件包、内部安装说明、版本、Plugin Verifier 和 release smoke。

## 3. 目标

IntelliJ 第一阶段的目标是形成一个可运行、可验证、可继续迭代的插件工程。第一批用户可观察结果是：从 `extensions/intellij/dev-session-canvas/` 执行 `./gradlew runIde`，测试 IDE 显示 `Dev Session Canvas` Tool Window；Tool Window 内的 JCEF 能加载 React Flow 画布；画布能发送一次创建测试 Note 的消息给 Kotlin 宿主，Kotlin 宿主能回传 state update，让页面出现测试 Note。

随后按增量顺序实现 Note 持久化、Terminal 节点、Agent 节点、Runtime Supervisor 和发布准备。Agent 节点在 Runtime Supervisor 之前落地时，只承诺当前 IDE 生命周期内的 execution 通道和 snapshot-only / 历史态表达，不承诺关闭 IDE 后真实进程继续存在。Runtime Supervisor 里程碑再决定并验证 `snapshot-only` 与 `live-runtime` 的正式边界。

架构目标是保持仓库事实和文档事实一致：插件工程在 monorepo 内，但 JVM 构建链路独立；前端复用必须通过明确的 host bridge，而不是把 VS Code API 泄漏到 IntelliJ 代码；协议策略第一版接受 Kotlin 最小 DTO 子集，但必须有清晰边界和漂移防线；未验证的 IDE、build range 或运行时能力不能写成已支持。第一版兼容基线倾向从较新的 IntelliJ Platform 起步；里程碑 1 scaffold 已先选用 2024.3 / branch 243，Android Studio 对应的精确 build range 仍需按真实目标版本复核。

## 4. 非目标

本设计不支持 Fleet。Fleet 的架构不同于 IntelliJ Platform，不能顺带承诺。

本设计不要求第一版与 VS Code 功能完全对等。第一版可以先覆盖 React Flow 画布、Note、Terminal、Agent 和 snapshot-only / 历史态表达，再逐步补齐 live runtime、平台特定集成和后续 Marketplace 发布矩阵。第一版不承诺关闭 IDE 后 Agent 仍继续运行。

本设计不把当前 `packages/attention-protocol/` 提升为跨 IDE 画布协议。该包当前只服务 VS Code 主扩展与 notifier companion 的桌面通知请求。

本设计不在发布前一次性补所有测试和文档。测试和文档是每个实现里程碑的完成条件，发布准备只做最终渠道收口。

## 5. 候选方案

### 5.1 插件仓库位置

方案 A 是把 IntelliJ 插件放在当前 monorepo 的 `extensions/intellij/dev-session-canvas/`，保留 Gradle 构建链路独立。这个方案让产品文档、协议演进、前端复用和发布证据继续 repo-local，符合当前 `extensions/vscode/` 的平台分层结构。

方案 B 是独立仓库。它可以让 Gradle 工程更干净，但会造成文档分裂、协议漂移和共享前端同步成本上升。

当前结论是选择方案 A。里程碑 1 已在 `extensions/intellij/dev-session-canvas/` 创建独立 Gradle / Kotlin 插件工程，根 npm workspace 不直接登记该 JVM 工程；React Flow PoC 的 Node 打包脚本暂时复用根 `npm ci` 后安装在 workspace root 的 `node_modules`。

### 5.2 画布前端复用

方案 A 是先抽出 `packages/webview/` 共享前端包，再让 VS Code 和 IntelliJ 两侧分别注入 host bridge。它长期最干净，但会提前触碰当前 VS Code Webview 的大量路径、测试和打包逻辑。

方案 B 是在 IntelliJ 插件里先构建一个最小 React Flow bundle，验证 JCEF、资源加载、输入事件和 Kotlin bridge，然后再逐步抽离共享包。它能降低第一步风险，但如果不设退出条件，可能形成第二套前端。

方案 C 是复制现有 VS Code `src/webview/` 后直接改。该方案短期看似最快，但会让两套前端快速分叉，当前不推荐。

当前结论是采用方案 B 做里程碑 1，并已确认先证明 JCEF 能跑 React Flow，再决定是否抽共享包。2026-06-30 已创建 IntelliJ 专用 React Flow bundle，构建产物会被 Gradle 打进插件资源，并通过 `testWebviewBundle` 验证 host bridge、React Flow、测试 Note 消息和 CSS 标记存在。2026-07-01 用户在 IntelliJ IDEA 与 PyCharm 中补充真实截图，确认 JCEF React Flow 画布和 Note 卡片可见；同一内部包在 Android Studio `AI-253.30387.90` 中只能进入 JCEF unsupported fallback，随后用户确认升级 Android Studio 并安装/启用 JCEF 后也可以打开。里程碑 2 已先在 IntelliJ 插件内新增 `hostAdapter.ts`，把前端业务组件与 JCEF 全局函数隔离；里程碑 3 又在同一 bundle 中补齐可编辑 Note、拖拽位置、resize、删除和视口同步。是否抽共享 Webview 包仍留到三 IDE 差异和复用收益更清楚后再决定，不能仅因 IntelliJ 专用 bundle 已能持久化 Note 就默认形成长期第二套前端。

### 5.3 协议同步

方案 A 是以 JSON Schema 或其他中立 schema 为单一真相，生成 TypeScript 与 Kotlin DTO。它长期最可靠，但需要先把当前 `protocol.ts` 中混合的产品状态、测试 probe、生命周期和 UI 消息拆成可生成模型。

方案 B 是先维护 Kotlin 最小 DTO 子集，只覆盖当前里程碑需要的 bootstrap、state update、create / update / delete Note、execution input / output 等消息，并在每个里程碑扩展。它能让 PoC 更快，但必须有漂移防线。

当前结论是：第一版接受 Kotlin 最小 DTO 子集。里程碑 2 已新增 `CanvasProtocol.kt`，覆盖 `webview/ready`、`webview/createNote`、`host/bootstrap`、`host/stateUpdated` 和 Note 节点状态；里程碑 3 扩展到 `webview/updateNote`、`webview/updateNodePosition`、`webview/updateViewport`、`webview/deleteNode`、Note 尺寸和 viewport；里程碑 4 扩展到 `webview/createTerminal`、`webview/terminalInput`、`webview/terminalResize`、`webview/updateTerminalSize`、`webview/stopTerminal`、`host/terminalOutput` 和 `host/terminalExit`。`CanvasProtocolTest` 覆盖消息识别、未知消息拒绝、扁平 payload 解码和 JSON 转义。当前 DTO 子集仍是阶段性方案；进入 Agent 或 Runtime Supervisor 前，应重新评估是否启动方案 A，避免执行协议长期手写漂移。

### 5.4 执行和运行时持久化

方案 A 是先实现 Agent，再接入 Runtime Supervisor。Agent 先验证 IntelliJ 侧 CLI 命令发现、cwd 继承、输入输出和停止语义；Runtime Supervisor 后续补齐跨 IDE 生命周期能力。

方案 B 是先接 Runtime Supervisor，再实现 Agent。它能先收口运行时持久化，但会延迟用户最关心的 Agent 节点，并让早期 runtime 设计缺少 Agent 真实使用反馈。

当前结论是采用方案 A：里程碑 4 先用 IDE 生命周期内的 Terminal PTY 证明执行通道；里程碑 5 是 Agent 节点，里程碑 6 是 Runtime Supervisor。Terminal 首切片使用 IntelliJ Platform 随 IDE 携带的 `pty4j`，由 `ExecutionSessionManager` 在项目目录启动默认 shell，输出通过 bridge 回流到 xterm.js 节点，并只保存有限最近输出作为项目状态快照。Agent 第一版已确认不承诺关闭 IDE 后继续运行，只能承诺当前 IDE 生命周期内的 execution 通道和 snapshot-only / 历史态表达；Runtime Supervisor 里程碑再正式决定并验证 `snapshot-only` / `live-runtime` 语义，并倾向优先复用现有 Node supervisor。

## 6. 风险与取舍

JCEF 风险是第一风险。最小 HTML 页面不能证明 React Flow 画布可用，因此里程碑 1 必须直接加载 React Flow bundle，记录 JCEF 控制台、资源加载、空画布渲染、pan / zoom 和 create message 往返证据。如果这些证据缺失，不能进入 Note 持久化。

前端分叉风险很高。PoC 可以临时维护最小 bundle，但必须在里程碑 2 做 host adapter 收口。长期目标是让画布核心 UI 尽量共享，平台差异集中在 host bridge、资源 URI、消息通道和能力开关上。

协议漂移风险很高。Kotlin 最小 DTO 子集只适合早期里程碑，不能在没有测试和生成策略的情况下扩展到完整执行协议。每次新增消息都必须有 TypeScript / Kotlin 对照、测试或 schema 记录。

PTY 平台差异风险需要持续记录。当前 Terminal 切片依赖目标 IDE bundled `pty4j`，避免额外打包外部版本；但真实 shell、ConPTY、登录 shell、编码、特殊键和 resize 行为仍会随 OS、IDE runtime 和 Android Studio JCEF 配置不同而变化，不能只凭 Linux 单元测试写成三平台已验证。2026-07-01 首轮真实 smoke 显示 Terminal 节点可以创建且普通输入可达，但 Backspace 出现空格或乱码；当前修复选择在 JCEF bridge 层把 U+007F 到 U+009F 控制字符转为 ASCII `\u00xx` 后再交给 `JBCefJSQuery`，保留 xterm / PTY 的原始按键语义，不先强行把 DEL 改成 BS，也不先用 `stty erase` 改 shell 行规。

运行时承诺风险很高。Agent 节点先于 Runtime Supervisor 落地时，只能承诺当前 IDE 生命周期内的执行。没有 supervisor 或 provider 显式恢复身份时，重开后的状态必须表达为历史态、中断态或 snapshot-only 恢复入口，不得写成 live runtime。

发布矩阵风险需要持续记录。第一版只承诺验证 Android Studio、IntelliJ IDEA 和 PyCharm；其他 JetBrains IDE 的兼容性只有在对应 build 上通过 smoke 或 Plugin Verifier 后才能写成已支持。第一版范围是内部/手动安装验证，不默认准备 Marketplace 对外发布。

## 7. 当前结论

当前设计整体仍处于比较中，因为 Agent、Runtime Supervisor、完整三 IDE PTY smoke 和完整发布准备还未落地；Note 里程碑已有工程切片，但真实关闭重开项目的恢复 smoke 仍待补；Terminal 里程碑已有工程首切片，但真实 JCEF + PTY 输入输出 smoke 仍待补。里程碑 1 的工程路线已经进入验证中：插件工程使用 IntelliJ Platform Gradle Plugin 2.17.0、Gradle wrapper 9.0.0、IC 2024.3、since-build 243、不设置 until-build 上限和 JVM 21 编译目标；插件 ID 使用 `com.devsessioncanvas.canvas`；Kotlin 包名继续使用 `com.devsessioncanvas.intellij`；插件包不分发 Kotlin stdlib，依赖目标 IDE 捆绑的 Kotlin 2.0.21 stdlib。不设置 `until-build` 是为 Android Studio `AI-253.30387.90` 及后续内部手动 smoke 解除安装门禁，不代表未来 IDE 已完成公开兼容验证。2026-07-01 用户手动 smoke 显示 IntelliJ IDEA 与 PyCharm 可以渲染 JCEF React Flow 画布并创建 Note；Android Studio `AI-253.30387.90` 可以安装但进入 JCEF unsupported fallback；升级 Android Studio 并安装/启用 JCEF 后，Android Studio 也可以打开 Dev Session Canvas。

2026-06-30 已确认以下阶段性决策：目标 IDE 为 Android Studio、IntelliJ IDEA 和 PyCharm；第一版兼容基线倾向从较新的 IntelliJ Platform 起步；前端先证明 JCEF 能跑 React Flow，再决定是否抽共享包；协议第一版接受 Kotlin 最小 DTO 子集；Agent 第一版不承诺关闭 IDE 后继续运行；Runtime Supervisor 倾向复用现有 Node supervisor；第一版发布范围是内部/手动安装验证。

IntelliJ 插件已落在 `extensions/intellij/dev-session-canvas/`，使用独立 Gradle / Kotlin 构建链路。根 npm workspace 不直接承担 JVM 构建，但 React Flow PoC 的打包脚本当前依赖根 `npm ci` 后可解析 `esbuild`、`react`、`react-dom` 和 `reactflow`。后续可以增加根级脚本委托到 Gradle，或在抽共享前端包时重新收口 Node 依赖边界。

里程碑 1 不接受“最小 HTML 成功”作为完成标准。完成标准是 JCEF 中加载 React Flow bundle，并完成空画布渲染、pan / zoom、创建测试 Note 消息、Kotlin state update 回传和资源清理。当前已完成工程、bundle、构建和包结构验证；用户已在 IntelliJ IDEA 与 PyCharm 中补充可见 JCEF React Flow 画布和 Note 创建截图，并确认升级后的 Android Studio 安装/启用 JCEF 后也可以打开。旧 Android Studio `AI-253.30387.90` 仍是 JCEF unsupported 反例，应作为 runtime / 配置差异记录。

里程碑 2 负责把 PoC 收敛成正式 host adapter。VS Code 侧的 `acquireVsCodeApi()` 不能泄漏到 IntelliJ 前端；IntelliJ 侧也不应在业务组件里散落 JCEF 条件分支。当前工程切片已经把 IntelliJ 前端访问 JCEF 的位置收口到 `extensions/intellij/dev-session-canvas/src/main/webview/hostAdapter.ts`，业务组件只使用 `host.postMessage()` / `host.onMessage()`；Kotlin 侧把消息分发收口到 `CanvasProtocol.decodeWebviewMessage`，不再用裸字符串 `contains` 分发。

里程碑 3 是 Note 与项目级持久化。当前工程切片使用项目级 `PersistentStateComponent`，在 `CanvasProjectStateService` 中保存 Note 节点 ID、类型、标题、正文、位置、尺寸、视口和 `nextNoteNumber`，Tool Window bootstrap 直接从服务快照恢复；前端通过 `hostAdapter.ts` 发出 Note mutation 和 viewport mutation。自动化测试已经覆盖 helper 行为与插件构建，真实 UI 关闭重开恢复仍待在有图形环境中验证。

里程碑 4 是 Terminal。当前工程切片在 `CanvasProjectStateService` 中保存 Terminal 节点状态、cwd、shellPath、最近输出、节点尺寸和 PTY 行列；`CanvasBrowserBridge` 负责创建 Terminal、发送 state update、转发输入、resize 和停止；`ExecutionSessionManager` 用平台 `pty4j` 启动和管理 PTY；`ShellCommandResolver` 选择默认 shell 和工作目录；`main.tsx` 使用 xterm.js 渲染 Terminal 节点并维护 `recentOutput` 增量同步；`CanvasWebviewHtml` 在 JCEF query 前转义 C1 控制字符，避免 Backspace 等特殊键在 bridge 传输中被错误解释。这个切片不承诺关闭 IDE 后继续运行，只把有限最近输出作为 snapshot-only 状态恢复输入。里程碑 5 是 Agent，里程碑 6 是 Runtime Supervisor，里程碑 7 是发布准备。测试、设计文档和验证证据必须在里程碑 0 到 6 持续迭代，不能作为里程碑 7 的补债内容。

Runtime Supervisor 不是 Agent 第一版的前置条件。Agent 可以先落地当前 IDE 生命周期内的启动、输入、输出、停止和失败语义；跨 IDE 生命周期恢复由 Runtime Supervisor 里程碑单独验证。Runtime Supervisor 的研究方向倾向复用现有 Node supervisor，但具体 JVM client、进程发现、socket 路径和打包分发方式仍需在里程碑 6 验证。

仍待选定的内容包括：升级后可用 Android Studio 的精确 build 与 JCEF 安装方式、旧 Android Studio `AI-253.30387.90` 的 JCEF unsupported 差异边界、Note 关闭重开恢复目视证据、Terminal 在三类目标 IDE / OS 上的真实 PTY 行为、共享 Webview 包抽离时间点、协议生成升级时机、Node supervisor 复用细节、完整 Plugin Verifier 矩阵、内部手动安装包格式和后续 JetBrains Marketplace 发布 / 签名流程。

## 8. 验证方法

设计阶段的验证首先是文档一致性：`docs/exec-plans/active/intellij-platform-plugin.md`、本文和 `docs/design-docs/index.md` 必须保持状态一致。每次调整里程碑或设计结论，都要同步这三处。

里程碑 1 的技术验证从 `extensions/intellij/dev-session-canvas/` 执行：

    ./gradlew test
    ./gradlew buildPlugin
    ./gradlew verifyPluginStructure
    ./gradlew runIde

2026-06-30 至 2026-07-01 已在本地通过 `./gradlew test buildPlugin verifyPluginStructure`，其中 `test` 会运行 `testWebviewBundle` 检查 React Flow / Terminal bundle 标记，并运行 `CanvasProtocolTest`、`CanvasProjectStateServiceTest`、`ShellCommandResolverTest` 与 `ExecutionSessionManagerTest` 检查 Kotlin 最小协议模型、项目级状态 helper、默认 shell 选择和 fake PTY session manager；`buildPlugin` 生成 `build/distributions/dev-session-canvas-intellij-0.1.0-internal.zip`，`verifyPluginStructure` 验证插件包结构。2026-07-01 用户在 Android Studio `AI-253.30387.90` 安装时发现原 `until-build 243.*` 过窄，因此内部验证包已移除 `until-build` 上限；随后用户截图确认 IntelliJ IDEA 与 PyCharm 中 JCEF React Flow 画布和 Note 创建可见，Android Studio `AI-253.30387.90` 中显示 JCEF unsupported fallback；用户更新 Android Studio 并安装/启用 JCEF 后确认 Android Studio 也可以打开。当前 `runIde` 因无 `DISPLAY` / `WAYLAND_DISPLAY` 失败，堆栈包含 `HeadlessException` 和 `No X11 DISPLAY variable was set`；`verifyPlugin` 已进入 IntelliJ Plugin Verifier，但因访问 JetBrains 文档页和 Marketplace 依赖解析时 `Connection reset` 失败，未作为里程碑 1 / 2 / 3 / 4 完成证据。

人工或自动 smoke 记录必须包含：Tool Window 出现；JCEF 支持检查结果；React Flow bundle 无加载错误；空画布根节点存在；pan / zoom 后 viewport 变化；创建 Note 消息到达 Kotlin 宿主；Kotlin 回传 state update 后页面出现 Note；标题/正文编辑、拖拽、resize、删除和视口变化能写回宿主；关闭并重开同一项目后 Note、尺寸、位置和视口恢复；关闭 IDE 后 browser 和 bridge 被释放。当前已有 IntelliJ IDEA / PyCharm 的画布与 Note 可见截图；Android Studio 旧版本有 fallback 截图，升级并安装/启用 JCEF 后已有可打开确认，但仍需补精确 build、JCEF 安装方式和完整 checklist。

后续里程碑都必须至少提供一种验证证据。Note 里程碑的自动化证据已经覆盖状态 helper 和 bundle marker，但仍要补项目重开后状态恢复的真实 UI smoke。Terminal 里程碑的自动化证据已经覆盖协议、状态、bridge HTML 控制字符转义和 fake PTY manager；用户已确认 Terminal 可创建且普通输入可达，但修复后的 Backspace 仍需安装新 ZIP 复验，并仍要在真实 IDE 中证明 PTY 输入输出、resize、停止和项目关闭清理。Agent 里程碑要证明 Codex / Claude Code CLI 在项目目录启动并输出回流。Runtime Supervisor 里程碑要证明 runtime identity 注册、重新查询或恢复、清理 / 保留语义，以及 `snapshot-only` / `live-runtime` 的用户可见差异。

内部发布准备阶段再运行最终矩阵，包括 `./gradlew verifyPlugin`、目标 IDE build 的 Plugin Verifier、Android Studio / IntelliJ IDEA / PyCharm smoke、手动安装包检查和 release smoke。若某个 IDE 未验证，内部说明或后续发布文案不得写成已支持。JetBrains Marketplace listing、签名和公开发布流程留到后续发布计划。
