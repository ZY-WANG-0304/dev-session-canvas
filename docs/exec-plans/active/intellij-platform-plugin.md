# IntelliJ Platform 插件设计与开发计划

本 `ExecPlan` 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘` 这几个章节。

本文位于 `docs/exec-plans/active/intellij-platform-plugin.md`，必须按 `docs/PLANS.md` 的要求持续维护。当前仓库已结束 MVP 验证阶段；本计划后续按正式 IntelliJ Platform 插件工程推进，不把交付物当成一次性原型。

## 目标与全局图景

这项工作要让 DevSessionCanvas 不只运行在 VS Code 中，也能在 IntelliJ Platform 系列 IDE 中打开一张多会话协作画布。完成后，Android Studio、PyCharm、IntelliJ IDEA 等用户可以从 IDE 的 Tool Window 打开 Dev Session Canvas，看到与当前项目绑定的画布，并逐步使用 Note、Terminal、Agent 三类节点管理开发会话。

第一批可观察成功结果不是“写出一套 Kotlin 代码”，而是：在 `extensions/intellij/dev-session-canvas/` 下存在可运行插件工程；从该目录执行 `./gradlew runIde` 后，测试 IDE 能显示 `Dev Session Canvas` Tool Window；Tool Window 内的 JCEF 能加载 React Flow 画布 bundle；画布能完成一次创建测试 Note 的 Kotlin 往返。后续里程碑再把持久化、终端 PTY、Agent CLI、Runtime Supervisor、设置页和内部手动安装验证补齐；公开 Marketplace 发布留到后续发布计划。

当前计划已经完成 2026-06-30 的文档收口和里程碑 1 工程首切片：`extensions/intellij/dev-session-canvas/` 插件工程已创建，React Flow PoC bundle 可以编译进插件包，Kotlin Tool Window / JCEF bridge 已能通过构建验证。2026-07-01 用户在真实 IDE 中补充手动截图：IntelliJ IDEA 与 PyCharm 能打开 Tool Window、渲染 JCEF React Flow 画布并显示 Note 卡片；Android Studio `AI-253.30387.90` 能安装插件但显示 JCEF unsupported fallback。随后用户确认 Android Studio 升级版本并安装/启用 JCEF 后也可以打开，说明 Android Studio 的 blocker 已从“插件不可安装 / JCEF 一定不可用”收敛为“需记录可用 Android Studio build 与 JCEF 安装路径”。当前执行环境仍没有 `DISPLAY` / `WAYLAND_DISPLAY`，无法本机运行 `runIde` 补充 JCEF 控制台、关闭清理和完整持久化 smoke，因此里程碑 1 记为“三类目标 IDE 基础可见 smoke 有人工证据，完整诊断证据和精确 build 号待补”。

2026-07-01 进入里程碑 4 后，当前工程切片把 Terminal 节点接入同一条 Kotlin bridge 和 React Flow 画布：前端用 xterm.js 呈现终端，Kotlin 侧用 IntelliJ Platform 随 IDE 携带的 `pty4j` 启动项目目录下的默认 shell，并把输入、输出、resize、停止和最近输出快照纳入项目级状态。这个切片仍只承诺当前 IDE 生命周期内的 PTY 会话；Runtime Supervisor 仍在里程碑 6，不能把关闭 IDE 后继续运行写成已支持。

## 进度

- [x] (2026-06-30 07:19 +0800) 已重读 `docs/WORKFLOW.md` 与 `docs/PLANS.md`，确认本任务属于交付性文档更新，且后续正式实现必须使用本 `ExecPlan` 跟踪。
- [x] (2026-06-30 07:24 +0800) 已复核当前仓库拓扑：主 VS Code 扩展位于 `extensions/vscode/dev-session-canvas/`，notifier companion 位于 `extensions/vscode/dev-session-canvas-notifier/`，当前没有 `extensions/intellij/`、`packages/protocol/` 或 `packages/webview/`。
- [x] (2026-06-30 07:30 +0800) 已复核 JetBrains 官方文档当前基线：IntelliJ Platform Gradle Plugin 2.x 是当前主线；JCEF 使用前必须检查运行 IDE 是否支持；build number 范围和 Plugin Verifier 会影响 Marketplace 审核。
- [x] (2026-06-30 07:45 +0800) 已将本计划从“延后启动、等待 notifier”更新为“设计发现可启动、实现尚未开始”，并补齐 `PLANS.md` 要求的活文档章节。
- [x] (2026-06-30 08:25 +0800) 已根据讨论修正里程碑边界：里程碑 1 必须直接加载 React Flow bundle；最小本地 HTML 只作为调试子步骤，不作为独立验收里程碑。
- [x] (2026-06-30 08:37 +0800) 已根据讨论修正后段里程碑：里程碑 5 是 Agent 节点，里程碑 6 是 Runtime Supervisor，原发布准备改为里程碑 7。
- [x] (2026-06-30 08:45 +0800) 已创建正式设计文档 `docs/design-docs/intellij-platform-plugin-architecture.md` 并同步 `docs/design-docs/index.md`，初始状态为“比较中 / 未验证”。
- [x] (2026-06-30 09:00 +0800) 已确认第一版目标 IDE 为 Android Studio、IntelliJ IDEA、PyCharm；兼容基线倾向从较新的 IntelliJ Platform 起步，精确 build range 先在里程碑 1 选用 2024.3 / branch 243，Android Studio 对应版本仍待复核。
- [x] (2026-06-30 09:00 +0800) 已确认前端策略：先证明 JCEF 能跑 React Flow，再决定是否抽共享 Webview 包。
- [x] (2026-06-30 09:00 +0800) 已确认协议策略：第一版接受 Kotlin 最小 DTO 子集。
- [x] (2026-06-30 10:10 +0800) 已在 `intellij-plugin-react-flow-poc` 主题分支上开始里程碑 1，实现范围限定为插件骨架、JCEF Tool Window 和 React Flow PoC，不进入 Note 持久化。
- [x] (2026-06-30 11:35 +0800) 已创建 `extensions/intellij/dev-session-canvas/` Gradle / Kotlin 工程，提交 Gradle 9.0.0 wrapper，使用 IntelliJ Platform Gradle Plugin 2.17.0、IC 2024.3、branch 243 和 Java 21 编译目标。
- [x] (2026-06-30 11:50 +0800) 已实现 `CanvasToolWindowFactory`、`CanvasBrowserBridge`、`CanvasWebviewHtml` 和最小 `CanvasProjectStateService`；JCEF 可用时加载内联 React Flow bundle，JCEF 不可用时显示 Swing fallback 文案。
- [x] (2026-06-30 12:04 +0800) 已实现 IntelliJ 专用 React Flow PoC bundle 和 `testWebviewBundle` 轻量验证，确保 bundle 中包含 host bridge、React Flow、`Create Test Note` 消息、state update 和 CSS 标记。
- [x] (2026-06-30 12:06 +0800) 已通过 `./gradlew test buildPlugin verifyPluginStructure`，生成内部 ZIP `extensions/intellij/dev-session-canvas/build/distributions/dev-session-canvas-intellij-0.1.0-internal.zip`。
- [x] (2026-06-30 12:20 +0800) 已将 `docs/design-docs/intellij-platform-plugin-architecture.md` 与 `docs/design-docs/index.md` 的验证状态同步为“验证中”，表示里程碑 1 工程和包结构已验证但真实 JCEF UI smoke 仍待补。
- [ ] 完成里程碑 1 的真实 UI smoke。（已完成：`extensions/intellij/dev-session-canvas/` 工程、React Flow bundle、Kotlin bridge、构建和包结构验证；用户已在 IntelliJ IDEA 与 PyCharm 中目视确认 Tool Window、JCEF React Flow 画布和 Note 创建可见；Android Studio `AI-253.30387.90` 曾显示 JCEF unsupported fallback，但用户后续确认升级 Android Studio 并安装/启用 JCEF 后也可以打开。剩余：补三类 IDE build 号、Android Studio JCEF 安装路径、JCEF 控制台、pan / zoom、关闭清理和完整持久化 smoke。）
- [x] (2026-06-30 12:58 +0800) 已推进里程碑 2 的工程首切片：新增 TypeScript `hostAdapter.ts`，把前端对全局 JCEF bridge 的直接依赖收口到 adapter；新增 Kotlin `CanvasProtocol` 最小 DTO / 编解码层，并用 Kotlin 单元测试覆盖消息识别和 host state JSON 转义。
- [ ] 完成里程碑 2 的真实 UI smoke。（已完成：稳定 host adapter、`webview/createNote` 规范消息名、Kotlin 最小协议模型和自动化测试；用户已在 IntelliJ IDEA 与 PyCharm 中目视确认 adapter 后的 React Flow 画布与创建 Note 可见，并确认升级后的 Android Studio 安装/启用 JCEF 后也可以打开。剩余：补 bootstrap / state update 诊断证据、关闭清理、Android Studio 精确 build 和 JCEF 安装路径。）
- [x] (2026-06-30 14:15 +0800) 已完成里程碑 3 的工程首切片：`CanvasProjectStateService` 保存 Note 节点、尺寸和视口；前端 Note 支持标题/正文编辑、拖拽位置、resize、删除和视口同步；Kotlin/TypeScript 协议新增 `updateNote`、`updateNodePosition`、`updateViewport` 和 `deleteNode`。
- [ ] 完成里程碑 3 的真实持久化 smoke。（已完成：项目级状态服务、bootstrap 恢复路径、Note mutation 协议、自动化测试和插件包结构验证；用户已在 IntelliJ IDEA 与 PyCharm 中目视确认创建 Note 可见。剩余：在有图形环境的 IDE 中创建/编辑/移动/缩放/删除 Note，关闭并重开同一项目后目视确认 Note 和视口恢复。）
- [x] (2026-07-01 16:49 +0800) 已根据用户在 Android Studio `AI-253.30387.90` 的安装反馈移除内部验证包的 `until-build` 上限，用于覆盖当前和后续 IDE 的手动安装 smoke；这不是公开兼容承诺，仍需真实 UI smoke 和后续 Plugin Verifier 矩阵验证。
- [x] (2026-07-01 17:49 +0800) 已记录用户手动 smoke 结果：IntelliJ IDEA 与 PyCharm 中 React Flow 画布和 Note 节点可见；Android Studio `AI-253.30387.90` 中进入 JCEF unsupported fallback，说明安装门禁已解除但该 Android Studio runtime 的 JCEF 能力不可用。
- [x] (2026-07-01 19:36 +0800) 已记录用户更新后的 Android Studio smoke：升级 Android Studio 并安装/启用 JCEF 后可以打开 Dev Session Canvas；精确 Android Studio build、JCEF 安装方式和完整 Note / 持久化 checklist 仍待补。
- [x] (2026-07-01 20:35 +0800) 已推进里程碑 4 的工程首切片：协议和状态模型支持 `note` / `terminal` 节点；前端新增 xterm.js Terminal 节点、输入 / resize / stop 消息和最近输出恢复；Kotlin 侧新增 `ExecutionSessionManager` 与 `ShellCommandResolver`，通过平台随附 `pty4j` 在项目目录启动默认 shell。
- [x] (2026-07-01 21:01 +0800) 已处理首轮真实 PTY smoke 暴露的特殊键输入问题：用户确认 Terminal 节点可以创建且普通输入可达，但 Backspace 表现为空格或乱码；当前修复在 JCEF bridge 进入 `JBCefJSQuery` 前把 `JSON.stringify` 保留的 U+007F 到 U+009F 控制字符转为 ASCII `\u00xx`，并用 Kotlin 测试覆盖 `\u007f` 解码。
- [ ] 完成里程碑 4 的真实 PTY smoke。（已完成：协议 / 状态 / PTY session manager / shell 解析 / webview bundle marker 自动化测试；用户已确认 Terminal 节点可创建且普通输入可达；已修复 Backspace bridge 转义风险。剩余：安装新 ZIP 后复验 Backspace 不再变成空格或乱码，并在有图形环境的 IntelliJ IDEA、PyCharm、Android Studio 中验证 resize、Stop、Delete 和项目关闭清理。）
- [ ] 完成 Agent 节点，明确第一版不承诺关闭 IDE 后继续运行，只承诺当前 IDE 生命周期内 execution 通道和 snapshot-only / 历史态表达。
- [ ] 完成 Runtime Supervisor 接入方案，倾向复用现有 Node supervisor，并验证 IntelliJ 侧能注册、恢复和清理 runtime 会话。
- [ ] 完成内部/手动安装验证准备，包括 `./gradlew test`、`./gradlew buildPlugin`、`./gradlew verifyPlugin`、三类目标 IDE smoke 和手动安装说明。

## 意外与发现

- 观察：旧计划把 `packages/protocol/kotlin/` 和 `packages/webview/dist/intellij/` 写成已规划依赖，但当前仓库并不存在这些路径。
  证据：`find extensions packages -maxdepth 3 -type d` 只显示 `extensions/vscode/...`、`packages/attention-protocol/` 和 `packages/marketplace-shared/`，没有 `extensions/intellij/`、`packages/protocol/` 或 `packages/webview/`。

- 观察：旧计划的“等待 Monorepo 重构与 notifier”前置条件已经部分过期。monorepo 阶段 1.2 已归档，notifier companion 架构文档也标记为已验证；但跨 IDE 共享层仍未创建。
  证据：`docs/exec-plans/completed/standard-monorepo-and-doc-knowledge-base.md` 明确本轮完成范围不包含 IntelliJ、跨 IDE JSON Schema 协议生成和共享 Webview 包；`docs/design-docs/notifier-companion-architecture.md` 的 `validation_status` 为 `已验证`。

- 观察：当前 VS Code Webview 前端并不能“直接复制到 IntelliJ”。它在 `extensions/vscode/dev-session-canvas/src/webview/main.tsx` 中直接调用 `acquireVsCodeApi()`，并依赖 `window.message`、VS Code Webview lifecycle identity、宿主消息类型和 CSP 资源规则。
  证据：`rg -n "acquireVsCodeApi|postMessage|message" extensions/vscode/dev-session-canvas/src/webview` 显示消息桥和 VS Code API 调用集中在 `main.tsx`，需要先抽象 host bridge 或做适配层。

- 观察：官方 IntelliJ Platform 文档在 2026-06-29 构建的页面中已经把 Gradle 插件 2.x、JCEF 支持检查、build number 合法性和 `verifyPlugin` 任务作为当前实现必须关注的基础约束；旧计划中的“Gradle 8.x / JDK 17+”不能作为 2026-06-30 的直接执行基线。
  证据：本次通过 JetBrains 官方文档复核了 IntelliJ Platform Gradle Plugin 2.x、Embedded Browser JCEF、Testing Overview 和 Build Number Ranges 页面；具体链接保留在 `参考资料`。

- 观察：计划文档初次收口时工作树处于 detached HEAD，正式实现前已切到具名主题分支 `intellij-plugin-react-flow-poc`。
  证据：文档收口时 `git status --short --branch` 输出 `## HEAD (no branch)`；里程碑 1 实现期间输出 `## intellij-plugin-react-flow-poc`。

- 观察：加载一个最小本地 HTML 页面和加载当前 React Flow 画布之间存在显著风险差距，不能放在同一个“JCEF 已验证”结论里。
  证据：最小 HTML 只覆盖 Swing/JCEF 容器、资源 URL 和一条消息往返；React Flow 画布还会引入 Vite/esbuild bundle、CSS 和字体资源、`@xyflow/react` 事件系统、wheel / pointer / keyboard 输入、VS Code host bridge 替换、base URL / CSP 差异、source map 调试、高频消息和真实空画布渲染。

- 观察：IntelliJ Platform 2024.3 属于 branch 243，官方 build number 表显示 2024.3 的 Java version 是 21；本机默认 Java 11 和 `/opt/jdk-17.0.2` 都不足以编译当前目标平台。
  证据：`./gradlew test` 在 JDK 17 下失败并提示找不到 languageVersion=21 的 Java toolchain；使用临时 Temurin JDK 21 后 `./gradlew test buildPlugin verifyPluginStructure` 通过。

- 观察：当前环境的 Java / Gradle 网络访问没有自动沿用 shell 的 `HTTP_PROXY` / `HTTPS_PROXY`，而 `curl` 能通过代理访问同一 URL。
  证据：未传 `GRADLE_OPTS` 时 Gradle 解析 Kotlin / IntelliJ Gradle plugin 多次出现 `Connection reset`；传入 `-Dhttps.proxyHost=10.79.2.115 -Dhttps.proxyPort=3128 -Dhttp.proxyHost=10.79.2.115 -Dhttp.proxyPort=3128` 后依赖解析和 wrapper 下载成功。该代理地址是本机验证环境事实，不应写成项目通用要求。

- 观察：JetBrains `verifyPluginStructure` 会提示插件 ID 不应包含 `intellij` 字样。
  证据：`verifyPluginStructure` 对 `com.devsessioncanvas.intellij` 输出 `The plugin ID 'com.devsessioncanvas.intellij' should not include the word 'intellij'.`；插件 ID 已改为 `com.devsessioncanvas.canvas` 后该检查通过。

- 观察：`runIde` 当前无法在本执行环境完成真实 UI smoke，因为这里没有图形环境。
  证据：`DISPLAY=`、`WAYLAND_DISPLAY=`、`XDG_SESSION_TYPE=tty`；`timeout 45s ./gradlew runIde` 失败，堆栈包含 `HeadlessException` 和 `No X11 DISPLAY variable was set`，因此 JCEF 控制台、画布可见渲染、pan / zoom 和测试 Note 往返仍需在有图形环境的 IDE 中补验。

- 观察：`verifyPlugin` 当前失败点不是插件编译或包结构，而是 Plugin Verifier 运行期访问 JetBrains 网络资源和 Marketplace 依赖解析。
  证据：`./gradlew verifyPlugin` 已进入 IntelliJ Plugin Verifier 1.407，并读取本地插件 ZIP 与 IC 2024.3.7.1；随后因 `https://jb.gg/ij-api-changes-raw?flush_cache=true` 和 `Resolve dependency XPathView` 多次 `Connection reset` 失败。当前里程碑先使用 `verifyPluginStructure` 覆盖包结构，完整 `verifyPlugin` 留到网络稳定或配置离线依赖后重跑。

- 观察：引入 Kotlin 单元测试后，IntelliJ Platform Gradle Plugin 会初始化 IntelliJ test environment，单独引入 JUnit 5 不足以启动测试进程。
  证据：只添加 `kotlin("test-junit5")` 时，`:test` 失败并提示 `Could not start Gradle Test Executor 1: org/junit/rules/TestRule`；补充 `testImplementation("junit:junit:4.13.2")` 后 `./gradlew test buildPlugin verifyPluginStructure` 通过。该 JUnit 4 依赖只在 `testImplementation`，不进入插件运行包。

- 观察：里程碑 3 的项目级持久化可以先用 IntelliJ `PersistentStateComponent` 的简单 JavaBean 形态验证，不必为了平面 Note payload 立即引入 JSON 库或完整协议生成。
  证据：`CanvasProjectStateServiceTest` 能直接构造服务、`loadState()` 旧状态、创建新 Note，并验证 `nextNoteNumber` 归一化、标题/正文/位置/尺寸/视口更新和删除；`javap` 显示 `CanvasProjectState`、`CanvasPersistedNoteNode` 与 `CanvasPersistedViewport` 都保留无参构造和 getter/setter，可被 IntelliJ 状态序列化机制识别。

- 观察：移除 `until-build` 后，IntelliJ IDEA 与 PyCharm 的手动安装和 JCEF React Flow 画布 smoke 已通过；Android Studio `AI-253.30387.90` 能进入 Tool Window，但 `JBCefApp.isSupported()` 返回不可用并显示 fallback。用户升级 Android Studio 并安装/启用 JCEF 后，Android Studio 也可以打开 Dev Session Canvas。
  证据：用户提供的 2026-07-01 截图中，IntelliJ IDEA / PyCharm 的 `Dev Session Canvas` Tool Window 显示 React Flow 背景、toolbar、viewport 和 Note 卡片；此前 Android Studio 截图显示 `Dev Session Canvas needs JCEF, but this IDE runtime does not support it.`；随后用户确认更新版本并安装 JCEF 后 Android Studio 也可以打开。

- 观察：IntelliJ Platform 2024.3 的平台库已经包含 `com.pty4j`，Terminal 里程碑不需要额外引入外部 pty4j Maven 依赖。
  证据：`javap -classpath /tmp/devsession-gradle-home/caches/9.0.0/transforms/.../ideaIC-2024.3/lib/util.jar com.pty4j.PtyProcess com.pty4j.PtyProcessBuilder com.pty4j.WinSize` 显示 `PtyProcessBuilder.setInitialColumns()`、`setInitialRows()`、`setRedirectErrorStream()`、`start()` 和 `PtyProcess.setWinSize(WinSize)` 可用。

- 观察：当前沙箱下 Kotlin daemon 和 IntelliJ test environment 会尝试写用户 home，导致测试在只读 home 上失败；需要把 Kotlin 编译切到 in-process，并把 Java Preferences 写入 build 目录。
  证据：未配置前 `./gradlew test` 报 `Could not connect to Kotlin compile daemon`，原因包含 `/home/users/ziyang01.wang-al/.local/share/kotlin/... Read-only file system`；测试进程还因 `java.util.prefs.BackingStoreException: Couldn't get file lock` 初始化 `ThreadLeakTracker` 失败。加入 `kotlin.compiler.execution.strategy=in-process` 和测试 JVM `java.util.prefs.userRoot=build/test-prefs` 后，`./gradlew test` 通过。

- 观察：Terminal 输出同时走即时 `host/terminalOutput` 和状态快照 `recentOutput`，前端必须避免重复写入或因状态刷新重建 xterm 实例。
  证据：`main.tsx` 中 `TerminalNode` 的创建 effect 只依赖节点 ID，使用 `lastRecentOutput` 对比状态快照增量；即时输出会先写入 xterm 并更新同一 recent-output 游标，避免后续 `stateUpdated` 再追加相同文本。

- 观察：真实 IntelliJ 环境中 Terminal 节点已经能创建并接收普通输入，但 Backspace 这类特殊键会在 JCEF bridge 传输时表现为空格或乱码；当前问题更像是 bridge query 传输了 raw DEL 控制字符，而不是 PTY shell 本身一定需要把 DEL 改成 BS。
  证据：用户 2026-07-01 手动 smoke 反馈“能够创建 Terminal，也能输入，但是部分输入是乱码，比如 backspace 键变成了空格”；代码链路中 xterm `onData` 直接把输入放入 JSON 消息，`JBCefJSQuery.inject("payload")` 再把 `payload` 作为 query request 传给 Kotlin。`CanvasWebviewHtml` 已在进入 query 前把 U+007F 到 U+009F 转义成 ASCII `\u00xx`，`CanvasProtocolTest` 覆盖 `"\u007f"` 能解回 DEL。

## 决策记录

- 决策：把本计划状态从“延后启动（等待第一阶段完成）”改为“设计发现可启动，正式实现未启动”。
  理由：monorepo 与 notifier 的主要前置已经落地，继续写成等待 notifier 会误导后续协作者；但共享 Webview、跨语言协议和 IntelliJ 架构设计仍未确认，不能直接进入实现。
  日期/作者：2026-06-30 / Codex

- 决策：正式实现前先创建 `docs/design-docs/intellij-platform-plugin-architecture.md`，并在设计索引登记；本 `ExecPlan` 负责推进，不能替代正式设计结论。
  理由：IntelliJ 插件会影响平台边界、共享前端、协议生成、运行时持久化和发布矩阵，属于需要设计文档收口的复杂跨平台能力。
  日期/作者：2026-06-30 / Codex

- 决策：IntelliJ 插件仍放在当前 monorepo 的 `extensions/intellij/dev-session-canvas/`，而不是另起仓库。
  理由：DevSessionCanvas 的产品、协议、文档和发布证据需要保持 repo-local；独立仓库会放大协议漂移、共享前端同步和文档分裂风险。当前这是执行默认方向，正式方案仍需写入设计文档后确认。
  日期/作者：2026-06-30 / Codex

- 决策：第一轮工程 PoC 必须证明 Tool Window 中的 JCEF 能加载 React Flow 画布 bundle，而不是停在最小 HTML。
  理由：最小 HTML 只是一条排障子步骤，不能覆盖当前画布真正依赖的 React / React Flow bundle、CSS 资源、host bridge 替换和输入事件。把 React Flow 加载放进里程碑 1，可以防止后续把过弱 smoke 误判成画布风险已解除。
  日期/作者：2026-06-30 / Codex

- 决策：不设置中间里程碑，把 React Flow bundle 加载 PoC 直接作为里程碑 1 的完成条件。
  理由：插件骨架如果只到静态 HTML，交付价值和风险消减都太弱。里程碑 1 应当以“JCEF 承载真实或等价 React Flow 画布并完成一次创建消息往返”为验收边界；最小 HTML 只允许作为实现过程中的临时调试页面。
  日期/作者：2026-06-30 / Codex

- 决策：当前不手写完整 Kotlin 版 `protocol.ts` 镜像；正式实现前必须先决定“生成 Kotlin DTO”还是“维护最小 Kotlin 消息子集”。
  理由：现有协议已经覆盖多 root、文件活动、执行性能诊断、生命周期和测试 probe，手写镜像容易漂移；但一开始就抽完整 JSON Schema 也可能过重，需要在设计阶段比较。
  日期/作者：2026-06-30 / Codex

- 决策：IntelliJ 构建链路以 JetBrains 官方 IntelliJ Platform Gradle Plugin 2.x 为默认研究方向，并在 scaffold 前再次复核官方文档。
  理由：官方文档显示 1.x 插件已不是当前主线；Marketplace 兼容性、`patchPluginXml`、`verifyPlugin` 和 `runIde` 都围绕 2.x 工具链维护。
  日期/作者：2026-06-30 / Codex

- 决策：后段顺序调整为 Agent 节点先落地，Runtime Supervisor 后接入，发布准备作为里程碑 7。
  理由：当前功能分层应先证明 IntelliJ 版能启动和交互 Agent，再把跨 IDE 生命周期的 runtime 持久化作为后续增强；因此 Agent 里程碑只能承诺当前 IDE 生命周期内的 execution 通道，不能提前承诺 live runtime。
  日期/作者：2026-06-30 / Codex

- 决策：第一版目标 IDE 确认为 Android Studio、IntelliJ IDEA 和 PyCharm；其他 JetBrains IDE 不写成已支持。
  理由：这三类 IDE 覆盖 Android、JVM/Kotlin 和 Python 用户主路径，验证范围足够明确；其他 IDE 只有完成对应 smoke 或 Plugin Verifier 后才能扩展支持口径。
  日期/作者：2026-06-30 / 用户、Codex

- 决策：第一版兼容基线倾向从较新的 IntelliJ Platform 起步；里程碑 1 scaffold 先使用 2024.3 / branch 243，Android Studio 对应精确 build range 后续单独复核。
  理由：较新平台能降低 JCEF、Gradle 插件、Kotlin runtime 和 Plugin Verifier 兼容成本；branch 243 是当前 PoC 的可构建边界，但 Android Studio 的版本映射必须使用真实 build number，不能用 IC 2024.3 结果替代。
  日期/作者：2026-06-30 / 用户、Codex

- 决策：前端先证明 JCEF 能跑 React Flow，再决定是否抽共享 Webview 包。
  理由：React Flow 在 JCEF 中的资源加载、输入事件和 bridge 行为是最大未知项；先验证真实风险，再决定长期抽包，避免提前大规模重构。
  日期/作者：2026-06-30 / 用户、Codex

- 决策：第一版协议接受 Kotlin 最小 DTO 子集。
  理由：早期里程碑只需要 bootstrap、state update 和少量节点消息；完整 JSON Schema / 代码生成可在协议面扩大前再评估，但 DTO 子集必须有漂移防线。
  日期/作者：2026-06-30 / 用户、Codex

- 决策：Agent 第一版明确不承诺关闭 IDE 后继续运行。
  理由：Runtime Supervisor 排在 Agent 之后，Agent 第一版只能承诺当前 IDE 生命周期内的 execution 通道和 snapshot-only / 历史态表达，不能伪装成 live runtime。
  日期/作者：2026-06-30 / 用户、Codex

- 决策：Runtime Supervisor 倾向复用现有 Node supervisor。
  理由：现有 supervisor 已承载 VS Code live runtime 语义，复用能减少双实现漂移；IntelliJ 侧需要验证 JVM client、进程发现、socket 路径和打包分发方式。
  日期/作者：2026-06-30 / 用户、Codex

- 决策：第一版发布范围是内部/手动安装验证，不默认 JetBrains Marketplace 发布。
  理由：IntelliJ 插件第一版仍需验证 JCEF、IDE 矩阵、Agent 和 runtime 语义；内部安装包和手动验证能先降低风险，公开 Marketplace 发布留到后续发布计划。
  日期/作者：2026-06-30 / 用户、Codex

- 决策：里程碑 1 的 scaffold 固定到 IntelliJ Platform Gradle Plugin 2.17.0、Gradle wrapper 9.0.0、IC 2024.3、since-build 243 和 JVM 21 编译目标；2026-07-01 起内部验证包不设置 `until-build`。
  理由：JetBrains 当前 2.x Gradle 插件文档要求 Gradle 9.0.0 和 Java runtime 17；build number 表显示 2024.3 branch 243 的平台 Java version 为 21。用户倾向从较新平台起步，branch 243 能覆盖较新的 IntelliJ IDEA / PyCharm；JetBrains 文档也说明 `until-build` 是可选项且建议不设置。用户当前 Android Studio build 是 `AI-253.30387.90`，原 `until-build 243.*` 会直接阻断手动安装 smoke，因此内部验证包先移除上限，但这只解除安装门禁，不等同于已验证未来 API 兼容或公开支持。
  日期/作者：2026-06-30 / Codex；2026-07-01 / 用户、Codex 更新

- 决策：里程碑 1 使用 IntelliJ 插件内的最小 React Flow bundle，不改造 VS Code Webview，也暂不新增 `packages/webview/`。
  理由：当前目标是证明 JCEF 能承载 React Flow 和 Kotlin bridge；提前抽共享包会扩大改动面并混入 VS Code 回归风险。退出条件保持不变：PoC 经构建验证和至少一类目标 IDE 的真实 UI smoke 后，先收敛 host adapter；是否抽共享包必须等 IntelliJ IDEA / PyCharm / Android Studio 的 JCEF 差异和前端复用收益更清楚后再定。
  日期/作者：2026-06-30 / Codex

- 决策：里程碑 1 插件 ID 使用 `com.devsessioncanvas.canvas`，Kotlin 包名继续使用 `com.devsessioncanvas.intellij`。
  理由：JetBrains 结构检查提示插件 ID 不应包含 `intellij`；包名表达平台实现位置，不参与 Marketplace ID 约束，保持现状能减少重命名噪音。
  日期/作者：2026-06-30 / Codex

- 决策：里程碑 1 的插件包不随包分发 Kotlin stdlib。
  理由：目标平台 2024.3 已按 JetBrains Kotlin 支持文档捆绑 Kotlin 2.0.21 stdlib；`kotlin.stdlib.default.dependency=false` 后 ZIP 只包含插件 jar，避免和平台 bundled library 形成冲突。
  日期/作者：2026-06-30 / Codex

- 决策：里程碑 2 先在 IntelliJ 插件内收口一个最小 host adapter 和 Kotlin 协议模型，不立即抽 `packages/webview/` 或 JSON Schema。
  理由：当前执行环境无法本机打开 `runIde`，但 IntelliJ IDEA / PyCharm 已由用户补充真实截图，Android Studio 又暴露 JCEF unsupported 差异；先把前端对 JCEF 全局函数的依赖隔离到 `hostAdapter.ts`，并用 `CanvasProtocol` 替换 Kotlin `contains` 字符串分发，可以降低后续 Note 持久化前的协议漂移风险，同时避免提前触碰 VS Code Webview 回归面。
  日期/作者：2026-06-30 / Codex

- 决策：里程碑 3 先使用项目级 `PersistentStateComponent` 保存 Note 和视口，协议继续扩展最小 Kotlin DTO 子集，不引入新的 JSON 依赖。
  理由：当前 Note mutation payload 仍是扁平字段，单元测试已经能覆盖字符串转义、数字解析、状态归一化和快照输出；立即引入 JSON 库或跨语言 schema 会扩大改动面。进入 Terminal / Agent 之前仍需重新评估协议生成，避免执行消息长期手写漂移。
  日期/作者：2026-06-30 / Codex

- 决策：Android Studio 仍保留为第一版目标 IDE；`AI-253.30387.90` 的 JCEF unsupported 结果记录为旧 runtime / 配置差异，而升级后的 Android Studio 安装/启用 JCEF 后可作为可用路径继续验证。
  理由：同一插件 ZIP 已能在 IntelliJ IDEA、PyCharm 和升级后的 Android Studio 中打开 JCEF 画布路径；但 Android Studio 需要记录精确 build、JCEF 安装方式和完整 smoke checklist，不能把旧 `AI-253.30387.90` fallback 或升级后的一句确认泛化成所有 Android Studio 版本都支持。
  日期/作者：2026-07-01 / 用户、Codex

- 决策：里程碑 4 的 Terminal PTY 后端先使用 IntelliJ Platform 随 IDE 携带的 `pty4j`，不新增独立 Maven 依赖；前端 xterm.js 依赖暂时复用根 workspace 已安装的 `@xterm/xterm` 和 `@xterm/addon-fit`。
  理由：平台 `util.jar` 已提供当前切片需要的 PTY builder、初始行列、stderr 合流和 resize API，额外声明 pty4j 版本会引入与 IDE bundled library 冲突的风险；xterm 已由现有 VS Code 扩展依赖安装在根 `node_modules`，在抽共享 Webview 包前复用它能避免扩大 npm workspace 结构改动。
  日期/作者：2026-07-01 / Codex

- 决策：里程碑 4 的 Terminal 只承诺当前 IDE 生命周期内运行，最近输出作为项目状态快照保存；关闭 IDE 后继续运行仍留给里程碑 6 Runtime Supervisor。
  理由：用户已确认 Runtime Supervisor 排在 Agent 之后；Terminal PTY 首切片应先证明 IntelliJ 内输入输出、resize 和清理可行，不能提前引入另一套后台进程托管语义或把 snapshot-only 恢复伪装成 live runtime。
  日期/作者：2026-07-01 / Codex

- 决策：Terminal 特殊键优先在 JCEF bridge 层做传输转义，不把 Backspace 的 DEL 强行改写成 BS，也不通过启动 shell 时执行 `stty erase` 来改变 PTY 行规。
  理由：xterm.js 对 Backspace 输出 DEL 是常见终端语义，强行映射成 BS 可能破坏某些 shell、程序或平台的按键期待；本次用户现象发生在 IntelliJ JCEF bridge 首轮 smoke，且当前代码把 raw DEL 直接交给 `JBCefJSQuery`。先把 query request 限制为 ASCII 安全 JSON，可以保留 xterm / PTY 的字节语义，同时降低 JCEF transport 对控制字符的解释风险。真实 IDE 复验后再决定是否还需要平台级 `stty` 兼容策略。
  日期/作者：2026-07-01 / Codex

## 结果与复盘

文档收口阶段完成结果是：旧计划中已过期的“等待 notifier / Gradle 8 / 已存在共享协议和 webview 包”口径被替换为当前仓库事实；计划明确先做设计发现，再做可运行 PoC，最后逐步扩展到 Note、Terminal、Agent、Runtime Supervisor 和发布验证。正式设计文档 `docs/design-docs/intellij-platform-plugin-architecture.md` 已创建，目标 IDE、前端策略、协议策略、Agent / Runtime Supervisor 顺序和第一版发布范围已按用户确认写入计划。

里程碑 1 工程首切片已经落地：`extensions/intellij/dev-session-canvas/` 下存在独立 Gradle / Kotlin 插件工程，`plugin.xml` 声明 `Dev Session Canvas` Tool Window，Kotlin 侧实现 JCEF 支持检查、JCEF 不可用 fallback、内联 HTML 资源加载、JBCefJSQuery bridge、测试 Note 状态回传和 content 生命周期清理；前端侧实现 IntelliJ 专用 React Flow PoC bundle，包含空画布、toolbar、viewport 读数、`Create Test Note` 按钮和 host state update 渲染。`./gradlew test buildPlugin verifyPluginStructure` 已通过，并生成内部 ZIP。

里程碑 2 工程首切片已经落地：前端新增 `extensions/intellij/dev-session-canvas/src/main/webview/hostAdapter.ts`，把 `devSessionCanvasPostMessage` / `devSessionCanvasReceiveHostMessage` 的全局 JCEF 接口隐藏在 adapter 后；Kotlin 侧新增 `extensions/intellij/dev-session-canvas/src/main/kotlin/com/devsessioncanvas/intellij/protocol/CanvasProtocol.kt`，用最小 DTO 子集表达 `webview/ready`、`webview/createNote`、`host/bootstrap`、`host/stateUpdated` 和 Note 节点状态。`CanvasBrowserBridge` 不再依赖裸字符串 `contains` 和内联 JSON 拼装，`testWebviewBundle` 与 `CanvasProtocolTest` 已覆盖 bundle marker、消息名、未知消息拒绝和 JSON 转义。

里程碑 3 工程首切片已经落地：`CanvasProjectStateService` 从占位 `schemaVersion` 扩展为项目级 Note / viewport 状态服务，Tool Window bootstrap 从服务快照恢复，创建、编辑、移动、resize、删除 Note 和视口变化都会通过最小协议写回项目状态。前端仍是 IntelliJ 专用 bundle，但 Note 节点已经从只读测试卡片升级为可编辑、可拖拽、可缩放的持久化节点；`CanvasProtocolTest`、`CanvasProjectStateServiceTest` 和 `testWebviewBundle` 覆盖新增消息与状态 helper。

里程碑 4 工程首切片已经落地：协议模型从单一 Note 扩展为 `CanvasNode`，Terminal 节点拥有 `status`、`cwd`、`shellPath`、最近输出和 PTY 行列；`CanvasProjectStateService` 保存 Terminal 的位置、尺寸、状态、最近输出和行列；`ExecutionSessionManager` 使用平台 `pty4j` 启动项目目录下的默认 shell，支持输入、输出泵、resize、stop 和 dispose 清理；前端在 React Flow 内新增 xterm.js Terminal 节点和 `Create Terminal` 入口。首轮真实 smoke 显示 Terminal 可以创建且普通输入可达，同时暴露 Backspace 控制字符在 JCEF bridge 中可能被错误解释；当前已在 `CanvasWebviewHtml` 对 U+007F 到 U+009F 做 query 前 ASCII 转义，并新增 `CanvasWebviewHtmlTest` / `CanvasProtocolTest` 覆盖这条传输假设。`CanvasProtocolTest`、`CanvasProjectStateServiceTest`、`ShellCommandResolverTest`、`ExecutionSessionManagerTest`、`CanvasWebviewHtmlTest` 和 `testWebviewBundle` 覆盖当前非图形环境可验证的协议、状态、bridge HTML 和 PTY manager 行为。

剩余缺口是精确 IDE/JCEF 矩阵、持久化完整手动验证以及外部网络稳定性：当前执行环境无 `DISPLAY` / `WAYLAND_DISPLAY`，`runIde` 仍无法在本机打开 IDE；用户已在 IntelliJ IDEA、PyCharm 和升级后安装/启用 JCEF 的 Android Studio 中确认 Dev Session Canvas 可打开，但 Android Studio 旧 `AI-253.30387.90` 仍保留为 JCEF unsupported 反例；`verifyPlugin` 因访问 JetBrains 文档页和 Marketplace 依赖时 `Connection reset` 失败。后续仍需补三类目标 IDE 的精确 build 号、Android Studio JCEF 安装方式、Note mutation 往返和关闭重开恢复目视证据、共享前端抽离时机、Node supervisor 复用细节和后续 Marketplace 发布策略。后续每个实现里程碑都必须同步测试证据和相关文档，不应把测试与文档都推迟到发布前。

## 上下文与定向

当前仓库根目录是 private npm workspace root。根 `package.json` 负责编排 VS Code 主扩展、notifier companion、attention protocol、模板市场和 marketplace shared 包。正式文档位于根目录 `docs/`、`ARCHITECTURE.md`、`README.md` 和 `README.zh-CN.md`。

当前与 IntelliJ 插件最相关的代码路径如下：

- `extensions/vscode/dev-session-canvas/src/common/protocol.ts`：VS Code Host 与 Webview 之间的消息、节点模型、运行时上下文和测试 probe 类型。它是跨平台协议设计的输入，但还不是跨语言单一真相。
- `extensions/vscode/dev-session-canvas/src/webview/main.tsx`：React / React Flow 画布前端。它包含真实 UI 能力，也包含大量 VS Code Webview API 和生命周期假设。
- `extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts`：VS Code Extension Host 侧的画布权威状态、消息编排、持久化、节点创建和执行接线入口。
- `extensions/vscode/dev-session-canvas/src/panel/executionSessionBridge.ts`：VS Code 侧执行会话桥，处理 Terminal / Agent 输出、输入和状态回流。
- `extensions/vscode/dev-session-canvas/src/panel/agentCliResolver.ts`：Agent CLI 命令发现逻辑，后续 IntelliJ 版需要复用语义但不能直接依赖 VS Code API。
- `extensions/vscode/dev-session-canvas/src/panel/runtimeSupervisorClient.ts` 与 `extensions/vscode/dev-session-canvas/src/supervisor/runtimeSupervisorMain.ts`：live runtime supervisor 客户端与进程入口，后续要决定 IntelliJ 版复用 Node supervisor 还是另做 JVM 客户端。
- `packages/attention-protocol/`：当前只服务 VS Code 主扩展与 notifier companion 的桌面通知协议，不应误写成 IntelliJ 通用画布协议。

本计划使用几个 IntelliJ Platform 术语：

- IntelliJ Platform 插件：运行在 JetBrains IDE 内的 JVM 插件，通常用 Kotlin 或 Java 写，通过 `plugin.xml` 声明扩展点、Action、Tool Window 和服务。
- Tool Window：JetBrains IDE 侧边或底部工具窗口，类似用户可长期停靠的功能面板。DevSessionCanvas 的第一版主入口应是一个 Tool Window。
- JCEF / `JBCefBrowser`：JetBrains IDE 内嵌 Chromium 浏览器的 Java 包装，用于在 Swing UI 中显示 HTML / React 页面。运行前要检查 `JBCefApp.isSupported()`，因为某些 JDK 或 IDE 组合可能不支持。
- Bridge：浏览器中的 JavaScript 与 Kotlin 宿主之间的消息通道。VS Code 用 `acquireVsCodeApi().postMessage`，IntelliJ 需要用 JCEF 的消息或查询机制适配成同样的 host bridge 语义。
- `PersistentStateComponent`：IntelliJ 平台保存项目级或应用级状态的标准接口。第一版画布状态应先使用项目级持久化。
- `pty4j`：JetBrains 生态常用的伪终端进程库，用于让插件启动可交互 shell。Terminal 节点不应退化为普通 `ProcessBuilder` 文本管道，除非设计文档明确记录降级边界。
- Runtime Supervisor：当前 VS Code 版本中用于在编辑器生命周期之外托管执行会话的独立运行时。IntelliJ 版是否复用它仍待设计。

## 工作计划

里程碑 0 是设计发现与可行性收口。先新增 `docs/design-docs/intellij-platform-plugin-architecture.md`，并登记到 `docs/design-docs/index.md`。这份设计文档必须写清问题定义、目标 IDE 矩阵、目标 build range、JCEF 与 Swing fallback、前端复用方式、协议生成方式、Terminal / Agent 运行时边界、测试矩阵和 Marketplace 发布边界。完成后，读者应能知道哪些内容已经选定，哪些只是待验证假设。

里程碑 1 是插件骨架与 React Flow 画布加载 PoC。创建 `extensions/intellij/dev-session-canvas/`，使用 IntelliJ Platform Gradle Plugin 2.x、Kotlin、Gradle wrapper 和最小 `plugin.xml`。实现 `CanvasToolWindowFactory`，在 Tool Window 中创建 `JBCefBrowser`，并加载真实或足够等价的 React / React Flow bundle。实现过程中可以先用最小本地 HTML 排查 JCEF、资源 URL 和 bridge 注册，但该调试页面不算里程碑完成。里程碑 1 的完成条件是：JCEF 控制台没有 bundle 加载错误；空画布能渲染；pan / zoom 的 wheel 和 pointer 事件能改变 viewport；画布能发出 `createNote` 或等价测试消息；Kotlin 宿主能回传 state update，让页面出现一个测试 Note；关闭 IDE 时 browser 和 bridge 资源能被清理。

里程碑 2 是前端 host adapter 与最小画布交互收口。基于里程碑 0 的设计结论，选择是抽离共享 Webview 包，还是在 IntelliJ 插件中先构建一个最小 canvas bundle。无论哪种方式，都要把 VS Code 专属的 `acquireVsCodeApi()` 包成可替换的 host bridge，而不是在 IntelliJ 版里到处写条件分支。完成后，`runIde` 中的画布不再只是 PoC，而是使用稳定 host adapter 接收 bootstrap state、发送创建 Note 请求、接收 state update，并为后续 Note 持久化使用同一条协议路径。

当前里程碑 2 的工程切片不抽共享包，先在 IntelliJ 插件内新增 `hostAdapter.ts` 和 `CanvasProtocol.kt`。`hostAdapter.ts` 是前端唯一接触 `window.devSessionCanvasPostMessage` / `window.devSessionCanvasReceiveHostMessage` 的位置；业务组件只调用 `host.postMessage()` 和 `host.onMessage()`。`CanvasProtocol.kt` 是 Kotlin 侧最小消息模型和 JSON 编解码边界；`CanvasBrowserBridge` 只根据 `WebviewMessageType` 分发，不再直接搜索原始 JSON 字符串。后续 Note 持久化可以在这两个文件中扩展 `updateNote`、`deleteNode`、viewport 和尺寸字段。

里程碑 3 是 Note 节点与项目级持久化。实现 Kotlin 侧的 `CanvasProjectStateService`，保存节点 ID、类型、标题、正文、位置、尺寸和视口。前端通过 `hostAdapter.ts` 发送 `webview/updateNote`、`webview/updateNodePosition`、`webview/updateViewport` 和 `webview/deleteNode`，Kotlin 侧只接受这些扁平 payload 并更新项目状态快照。用户在 Tool Window 创建 Note、修改标题或正文、移动、缩放或删除节点后，关闭并重开测试项目，应看到同一批 Note 和视口恢复。这个阶段不要求 Terminal、Runtime Supervisor 或 Agent。完成本里程碑时必须同步相关测试证据和设计文档状态。

里程碑 4 是 Terminal 节点。使用 IntelliJ Platform 随 IDE 携带的 `pty4j`，实现 `ExecutionSessionManager`，支持在项目目录启动默认 shell、接收输入、推送输出、resize、停止进程和 Tool Window disposal / 项目关闭清理。Webview 侧继续使用 xterm.js，但 bridge 必须把高频输出和状态快照分开处理，避免即时输出与 `recentOutput` 状态刷新重复写入。当前工程切片的主要落点是 `execution/ExecutionSessionManager.kt`、`execution/ShellCommandResolver.kt`、`CanvasProtocol.kt`、`CanvasProjectStateService.kt`、`CanvasBrowserBridge.kt`、`hostAdapter.ts` 和 `main.tsx`。完成本里程碑时必须同步终端相关测试证据、已知平台差异和设计文档状态；在 Runtime Supervisor 之前，Terminal 只承诺当前 IDE 生命周期内运行和 snapshot-only 最近输出恢复。

里程碑 5 是 Agent 节点。移植 Agent CLI 命令发现语义并接入 Codex / Claude Code。Agent 启动必须优先继承用户现有 CLI 配置和项目目录，不把 provider home 改写到插件私有目录；输出、输入、停止和失败状态先走已经验证过的 execution 通道。这个里程碑不承诺关闭 IDE 后真实进程继续存在；如果还没有 Runtime Supervisor，Agent 重开后的表现只能是历史态、失败态或明确的 snapshot-only 恢复入口。完成本里程碑时必须同步 Agent 相关测试证据和设计文档状态。

里程碑 6 是 Runtime Supervisor 接入。Runtime Supervisor 倾向复用现有 Node supervisor；本里程碑要验证 IntelliJ 侧 JVM client、进程发现、socket 路径、打包分发和会话协议是否可行。插件需要能为 Terminal / Agent 会话注册 runtime identity、在 IDE / Tool Window 重开后重新查询或恢复状态、在项目关闭时按所选模式清理或保留进程，并把 backend 与 guarantee 写入日志或诊断。任何“关闭 IDE 后进程继续存在”的承诺，都必须和 `docs/product-specs/runtime-persistence-modes.md` 的 `snapshot-only` / `live-runtime` 语义对齐。完成本里程碑时必须同步 runtime 相关设计、测试和残余风险。

里程碑 7 只做内部/手动安装验证准备。测试和文档不是发布前的一次性收尾，而是里程碑 0 到 6 的持续完成条件；到里程碑 7 时，只允许补齐可手动安装的插件包、版本号、changelog、内部安装说明、最终 Plugin Verifier 矩阵和 release smoke 记录。JetBrains Marketplace listing、签名和公开发布凭据不属于第一版默认范围，留到后续发布计划。发布准备不得混入功能开发分支；需要按 `docs/WORKFLOW.md` 的发布流程单独收口。

## 具体步骤

当前计划更新已经执行或应复核的命令如下，均从仓库根目录运行：

    sed -n '1,220p' docs/WORKFLOW.md
    sed -n '1,260p' docs/PLANS.md
    find extensions packages -maxdepth 3 -type d | sort
    rg -n "acquireVsCodeApi|postMessage|message" extensions/vscode/dev-session-canvas/src/webview
    git status --short --branch
    git diff --check

进入里程碑 0 时，从仓库根目录执行：

    test -f docs/DESIGN.md
    test -f docs/design-docs/index.md
    test -f docs/product-specs/index.md

然后新增设计文档并同步索引。设计文档至少应包含以下待决策点：

    目标 IDE 为 Android Studio / IntelliJ IDEA / PyCharm，精确 build range 待复核
    JCEF 支持检查与 fallback
    前端复用 / 抽离策略
    TypeScript 与 Kotlin 协议同步策略
    Tool Window 生命周期与项目级状态边界
    Terminal PTY 与进程清理边界
    Runtime Supervisor 主路径与 Agent CLI 边界
    三类目标 IDE 测试矩阵、内部手动安装验证与后续 Marketplace 边界

进入里程碑 1 时，在主题分支上创建插件目录。不要依赖当前机器已安装全局 Gradle；应在插件目录中提交 Gradle wrapper 或明确通过仓库脚本生成 wrapper。目标目录结构先按以下形态收口，后续根据设计文档调整：

    extensions/intellij/dev-session-canvas/
      build.gradle.kts
      settings.gradle.kts
      gradle.properties
      gradlew
      gradlew.bat
      gradle/wrapper/
      src/main/kotlin/com/devsessioncanvas/intellij/
      src/main/resources/META-INF/plugin.xml
      src/test/kotlin/com/devsessioncanvas/intellij/

里程碑 1 的最小验证命令从插件目录执行：

    cd extensions/intellij/dev-session-canvas
    ./gradlew test
    ./gradlew buildPlugin
    ./gradlew verifyPluginStructure
    ./gradlew runIde

当前工程切片已执行到非图形环境能覆盖的部分。若默认 `java` 不是 JDK 21，需要先把 `JAVA_HOME` 指向 JDK 21；如果 Gradle 在当前网络下无法直连 JetBrains / Maven 资源，可以用当前环境的代理配置写入 `GRADLE_OPTS`，但代理地址只是本机验证前提，不是项目通用要求。本机验证命令是：

    cd extensions/intellij/dev-session-canvas
    JAVA_HOME=/tmp/devsession-jdk-21 GRADLE_OPTS='-Dhttps.proxyHost=10.79.2.115 -Dhttps.proxyPort=3128 -Dhttp.proxyHost=10.79.2.115 -Dhttp.proxyPort=3128' ./gradlew test buildPlugin verifyPluginStructure --no-daemon --stacktrace

当 `runIde` 打开测试 IDE 后，人工验证应记录：Tool Window 是否出现、JCEF 是否支持、React Flow bundle 是否无加载错误、空画布根节点是否存在、pan / zoom 后 viewport 数值是否变化、点击测试入口后 Kotlin 宿主是否收到创建消息、Kotlin 宿主回传 state update 后页面是否出现测试 Note、关闭 IDE 是否清理 browser 和 bridge 资源。若 JCEF 不支持，插件必须显示可解释的降级 UI，而不是空白或崩溃；若只完成最小 HTML bootstrap 而没有 React Flow 画布证据，不能进入 Note 持久化实现。

里程碑 2 之后，每个可观察功能都应有至少一种自动化或可重复手动验证。示例命令如下，具体任务名以实际 Gradle 配置为准：

    cd extensions/intellij/dev-session-canvas
    ./gradlew test
    ./gradlew buildPlugin
    ./gradlew verifyPlugin

如果 `verifyPlugin` 需要下载多个 IDE 或依赖网络，应在计划和 MR 说明中记录环境前提、验证的 IDE build、失败日志位置和可重跑命令。

里程碑 2 工程切片的验证仍从插件目录执行同一条主命令：

    cd extensions/intellij/dev-session-canvas
    JAVA_HOME=/tmp/devsession-jdk-21 GRADLE_OPTS='-Dhttps.proxyHost=10.79.2.115 -Dhttps.proxyPort=3128 -Dhttp.proxyHost=10.79.2.115 -Dhttp.proxyPort=3128' ./gradlew test buildPlugin verifyPluginStructure --no-daemon --stacktrace

预期结果是 `testWebviewBundle` 输出 `Verified IntelliJ webview bundle markers in build/generated/webview`，Kotlin `CanvasProtocolTest` 随 `:test` 通过，`buildPlugin` 和 `verifyPluginStructure` 成功。

若需要生成可安装到 Android Studio `AI-253.30387.90` 的内部验证包，确认 `extensions/intellij/dev-session-canvas/build.gradle.kts` 的 `ideaVersion` 只设置 `sinceBuild`，不设置 `untilBuild`，然后重新运行同一条 `buildPlugin` 命令。安装包仍是 `build/distributions/dev-session-canvas-intellij-0.1.0-internal.zip`，该包只是用于手动 smoke，不应写成公开 Marketplace 兼容结论。

里程碑 3 工程切片继续使用同一条主命令，但 `:test` 还应覆盖 `CanvasProjectStateServiceTest`。预期结果是 bundle marker 包含 `webview/updateNote`、`webview/updateNodePosition`、`webview/updateViewport` 和 `webview/deleteNode`，Kotlin 测试验证 Note 创建、编辑、位置、尺寸、视口、删除和 `loadState()` 后 ID 归一化，`buildPlugin` 和 `verifyPluginStructure` 成功。

里程碑 4 工程切片继续使用同一条主命令，但在当前沙箱中还需要把 `GRADLE_USER_HOME` 指向可写目录。`gradle.properties` 已设置 `kotlin.compiler.execution.strategy=in-process`，`build.gradle.kts` 已把测试用 Java Preferences 写入 `build/test-prefs`，用于避免 Kotlin daemon 和 IntelliJ `ThreadLeakTracker` 写只读 home。预期结果是 `testWebviewBundle` 包含 `webview/createTerminal`、`webview/terminalInput`、`webview/terminalResize`、`webview/updateTerminalSize`、`host/terminalOutput`、`host/terminalExit` 和 xterm 标记；Kotlin 测试覆盖 Terminal 协议、项目状态、shell 解析、JCEF bridge 控制字符转义和 fake PTY session manager。

    cd extensions/intellij/dev-session-canvas
    JAVA_HOME=/tmp/devsession-jdk-21 GRADLE_USER_HOME=/tmp/devsession-gradle-home GRADLE_OPTS='-Dhttps.proxyHost=10.79.2.115 -Dhttps.proxyPort=3128 -Dhttp.proxyHost=10.79.2.115 -Dhttp.proxyPort=3128' ./gradlew test buildPlugin verifyPluginStructure --no-daemon --stacktrace

## 验证与验收

当前里程碑 1 工程切片的验收标准是：`extensions/intellij/dev-session-canvas/` 存在可构建的 Gradle / Kotlin 插件工程；`plugin.xml` 声明 `Dev Session Canvas` Tool Window；JCEF 可用路径加载内联 React Flow bundle，JCEF 不可用路径显示可解释 fallback；前端 bundle 包含 host bridge、React Flow 根元素、测试 Note 消息和 CSS 标记；`./gradlew test buildPlugin verifyPluginStructure` 通过并生成内部安装 ZIP；相关设计文档和本 `ExecPlan` 记录已验证内容和待补 UI smoke。当前变更还必须运行 `git diff --check` 验证没有尾随空白。

当前仍未满足完整里程碑 1 验收的是三类 IDE 的完整诊断型 UI smoke。当前执行环境没有图形会话，`runIde` 会失败并出现 `HeadlessException` / `No X11 DISPLAY variable was set`；用户已在 IntelliJ IDEA 与 PyCharm 中补充 Tool Window、React Flow 可见渲染和 Note 卡片截图，并确认升级后的 Android Studio 安装/启用 JCEF 后也可以打开。但仍需补三类 IDE build 号、Android Studio JCEF 安装路径、JCEF 控制台、pan / zoom 行为和关闭清理。

当前里程碑 2 工程切片的验收标准是：前端业务组件不再直接访问 JCEF 全局 bridge；创建按钮发送规范化的 `webview/createNote` 消息；Kotlin 侧通过 `CanvasProtocol.decodeWebviewMessage` 识别已知消息并拒绝未知消息；host state JSON 由 `CanvasProtocol.encodeHostMessage` 统一生成并有转义测试；`./gradlew test buildPlugin verifyPluginStructure` 通过。用户已在 IntelliJ IDEA、PyCharm 和升级后安装/启用 JCEF 的 Android Studio 中补充真实可见 smoke；仍需补 bootstrap / state update 诊断日志、关闭清理和精确 build 矩阵。

当前里程碑 3 工程切片的验收标准是：`CanvasProjectStateService` 以项目级状态保存 Note、尺寸和视口；bootstrap/stateUpdated 都从服务快照生成；前端 Note 节点可编辑标题和正文、拖拽后发送位置、选中后 resize 并发送尺寸、点击删除后发送删除消息；`CanvasProtocolTest` 覆盖新增 Webview 消息解码和 host state viewport 编码；`CanvasProjectStateServiceTest` 覆盖状态 helper；`./gradlew test buildPlugin verifyPluginStructure` 通过。不设置 `until-build` 只用于解除 Android Studio `AI-253.30387.90` 的安装门禁。用户已在 IntelliJ IDEA、PyCharm 和升级后安装/启用 JCEF 的 Android Studio 中确认基础可见 smoke；完整里程碑 3 仍未满足的是关闭并重开同一项目后的真实恢复 smoke、Android Studio 精确 build 和 JCEF 安装路径。

当前里程碑 4 工程切片的验收标准是：点击 `Create Terminal` 后宿主创建 Terminal 节点并启动项目目录 shell；xterm 节点把输入发送为 `webview/terminalInput`，Kotlin 用 `pty4j` 写入 PTY；JCEF bridge 不把 Backspace 的 DEL 控制字符传输成空格或乱码；PTY 输出通过 `host/terminalOutput` 即时回流，并把有限最近输出写入项目状态；节点 resize 更新像素尺寸和 PTY 行列；Stop / Delete / dispose 会停止当前 session；`ExecutionSessionManagerTest` 用 fake PTY 覆盖启动、输入、resize、输出、自然退出、停止和启动失败；`ShellCommandResolverTest` 覆盖默认 shell / cwd 选择；`CanvasWebviewHtmlTest` 和 `CanvasProtocolTest` 覆盖特殊键控制字符的 bridge 转义与协议解码；`./gradlew test buildPlugin verifyPluginStructure` 通过。当前执行环境仍无法验证真实 JCEF UI 与真实 PTY smoke，剩余验收是在 IntelliJ IDEA、PyCharm 和升级后安装/启用 JCEF 的 Android Studio 中手动创建 Terminal、输入 `pwd` / `echo` 等命令、复验 Backspace、拖拽 resize、Stop、Delete 并关闭项目确认进程清理。

后续整份计划完成时，用户可观察验收标准如下：

1. 从 `extensions/intellij/dev-session-canvas/` 执行 `./gradlew runIde`，测试 IDE 打开后能看到 `Dev Session Canvas` Tool Window。
2. Tool Window 中的页面能和 Kotlin 宿主完成 bootstrap 往返，并在 JCEF 不可用时显示明确降级信息。
3. JCEF 中加载的 React Flow 画布能渲染空画布，pan / zoom 有可观察 viewport 变化，且一次测试创建消息能从画布发到 Kotlin 宿主并回传 state update。
4. 用户能创建、编辑、移动、删除 Note 节点；关闭并重开项目后，Note、位置、尺寸和视口恢复。
5. 用户能创建 Terminal 节点，在节点内输入 shell 命令并看到实时输出；停止节点或关闭项目时，进程被清理或按已记录的持久化模式处理。
6. 用户能创建 Agent 节点，插件能按当前项目目录启动 Codex 或 Claude Code CLI，输出回流到节点，失败时显示可解释错误。
7. Runtime Supervisor 路径已明确并可观察验证：插件能注册 runtime 会话、重新查询或恢复状态，并正确表达 `snapshot-only` / `live-runtime` 的保证差异。
8. IntelliJ 版不会把 snapshot-only 恢复伪装成 live-runtime；如果没有 supervisor 或 provider 原生恢复身份，就明确展示历史态或中断态。
9. `./gradlew test`、`./gradlew buildPlugin` 和 `./gradlew verifyPlugin` 在记录的目标 IDE build 上通过，失败项必须登记为 blocker 或技术债。
10. Android Studio、IntelliJ IDEA 和 PyCharm 至少完成一轮基础 smoke；当前 IntelliJ IDEA 与 PyCharm 已有人工截图证据，Android Studio 也已由用户确认在升级并安装/启用 JCEF 后可以打开，但三类 IDE 的精确 build、诊断日志和完整持久化 smoke 仍待补。
11. 每个实现里程碑的相关正式文档、设计文档、产品规格和本 `ExecPlan` 已持续同步；未确认内容仍标为待定或待验证。
12. 里程碑 7 只包含内部/手动安装准备材料与最终发布验证，不再承接本应在功能实现阶段完成的测试或文档债务。

## 幂等性与恢复

文档阶段的修改可以安全重复执行：重读 `docs/WORKFLOW.md`、`docs/PLANS.md`、`docs/DESIGN.md` 和当前计划不会改变工作树。`git diff --check` 也可重复运行。

创建 IntelliJ 插件工程时，应避免把一次性本机 IDE 缓存提交进仓库。Gradle 下载缓存、IDE sandbox、构建产物和测试日志应由 `.gitignore` 或插件子目录的 ignore 规则排除。`./gradlew clean` 可以重复执行，但不要用 `git reset --hard` 或 `git checkout --` 清理用户改动。

如果里程碑 1 失败，先区分是 JCEF 容器 / bridge 失败，还是 React Flow bundle / 输入事件失败。前者优先检查运行 IDE 是否支持 JCEF、是否使用 JetBrains Runtime、资源 URL 是否可访问、bridge handler 是否注册和 disposal 是否过早；后者优先检查 bundle base URL、CSS 和字体资源、浏览器控制台错误、host bridge adapter、wheel / pointer 事件。不要在这两层证据补齐前进入 Note 持久化或 Terminal 功能。

如果协议生成方案失败，可以退回到“最小 Kotlin DTO 子集”继续 PoC，但必须在 `意外与发现` 和设计文档中记录原因、丢弃条件和后续收口方式，不能让临时 DTO 漂移成长期事实来源。

如果 Runtime Supervisor 接入失败，不要在 Agent 节点上宣称完整恢复能力。可以把第一版明确降级为 `snapshot-only`，但必须先更新设计文档、验收标准和用户可见状态语义，再继续后续发布准备。

## 证据与备注

文档收口阶段依据的仓库证据如下，保留用于解释早期决策背景：

    git status --short --branch
    ## HEAD (no branch)

    find extensions packages -maxdepth 3 -type d | sort
    extensions/vscode
    extensions/vscode/dev-session-canvas
    extensions/vscode/dev-session-canvas-notifier
    packages/attention-protocol
    packages/marketplace-shared

    rg -n "export type WebviewToHostMessage|export type HostToWebviewMessage" extensions/vscode/dev-session-canvas/src/common/protocol.ts
    671:export type WebviewToHostMessage = WebviewLifecycleEnvelope & (
    1106:export type HostToWebviewMessage = WebviewLifecycleEnvelope & (

    rg -n "acquireVsCodeApi" extensions/vscode/dev-session-canvas/src/webview/main.tsx
    159:declare function acquireVsCodeApi<T>(): {
    813:const vscode = acquireVsCodeApi<LocalUiState>();

里程碑 1 工程切片的当前仓库证据如下：

    git status --short --branch
    ## intellij-plugin-react-flow-poc
     M .gitignore
     M docs/design-docs/index.md
     M docs/design-docs/intellij-platform-plugin-architecture.md
     M docs/exec-plans/active/intellij-platform-plugin.md
    ?? extensions/intellij/

    cd extensions/intellij/dev-session-canvas
    JAVA_HOME=/tmp/devsession-jdk-21 GRADLE_OPTS='-Dhttps.proxyHost=10.79.2.115 -Dhttps.proxyPort=3128 -Dhttp.proxyHost=10.79.2.115 -Dhttp.proxyPort=3128' ./gradlew test buildPlugin verifyPluginStructure --no-daemon --stacktrace
    > Task :testWebviewBundle
    Verified IntelliJ webview bundle markers in build/generated/webview
    BUILD SUCCESSFUL

    timeout 45s ./gradlew runIde --no-daemon --stacktrace
    DISPLAY=
    WAYLAND_DISPLAY=
    XDG_SESSION_TYPE=tty
    java.awt.HeadlessException:
    No X11 DISPLAY variable was set,

里程碑 2 工程切片的当前验证证据如下：

    cd extensions/intellij/dev-session-canvas
    JAVA_HOME=/tmp/devsession-jdk-21 GRADLE_OPTS='-Dhttps.proxyHost=10.79.2.115 -Dhttps.proxyPort=3128 -Dhttp.proxyHost=10.79.2.115 -Dhttp.proxyPort=3128' ./gradlew test buildPlugin verifyPluginStructure --no-daemon --stacktrace
    > Task :testWebviewBundle
    Verified IntelliJ webview bundle markers in build/generated/webview
    > Task :test
    BUILD SUCCESSFUL

里程碑 3 工程切片的当前验证证据如下：

    extensions/intellij/dev-session-canvas/build.gradle.kts
    ideaVersion {
        sinceBuild = providers.gradleProperty("pluginSinceBuild")
    }

    cd extensions/intellij/dev-session-canvas
    JAVA_HOME=/tmp/devsession-jdk-21 GRADLE_OPTS='-Dhttps.proxyHost=10.79.2.115 -Dhttps.proxyPort=3128 -Dhttp.proxyHost=10.79.2.115 -Dhttp.proxyPort=3128' ./gradlew test buildPlugin verifyPluginStructure --no-daemon --stacktrace
    > Task :testWebviewBundle
    Verified IntelliJ webview bundle markers in build/generated/webview
    > Task :test
    BUILD SUCCESSFUL

    javap -classpath extensions/intellij/dev-session-canvas/build/classes/kotlin/main com.devsessioncanvas.intellij.state.CanvasProjectState com.devsessioncanvas.intellij.state.CanvasPersistedNoteNode com.devsessioncanvas.intellij.state.CanvasPersistedViewport
    public com.devsessioncanvas.intellij.state.CanvasProjectState();
    public final java.util.List<com.devsessioncanvas.intellij.state.CanvasPersistedNoteNode> getNotes();
    public com.devsessioncanvas.intellij.state.CanvasPersistedNoteNode();
    public com.devsessioncanvas.intellij.state.CanvasPersistedViewport();

    用户手动 smoke 截图，2026-07-01：
    IntelliJ IDEA 与 PyCharm 中 Tool Window 可见，JCEF React Flow 画布、toolbar、viewport readout 和 Note 卡片可见；
    Android Studio AI-253.30387.90 中 Tool Window 可见，但显示 JCEF unsupported fallback；随后用户确认升级 Android Studio 并安装/启用 JCEF 后也可以打开。

里程碑 4 工程切片的当前验证证据如下：

    extensions/intellij/dev-session-canvas/src/main/kotlin/com/devsessioncanvas/intellij/execution/ExecutionSessionManager.kt
    class ExecutionSessionManager(
        private val listener: TerminalSessionListener,
        private val processFactory: PtyProcessFactory = DefaultPtyProcessFactory()
    ) : Disposable

    extensions/intellij/dev-session-canvas/src/main/webview/main.tsx
    <button type="button" onClick={() => host.postMessage({ type: 'webview/createTerminal' })}>
      Create Terminal
    </button>

    cd extensions/intellij/dev-session-canvas
    JAVA_HOME=/tmp/devsession-jdk-21 GRADLE_USER_HOME=/tmp/devsession-gradle-home GRADLE_OPTS='-Dhttps.proxyHost=10.79.2.115 -Dhttps.proxyPort=3128 -Dhttp.proxyHost=10.79.2.115 -Dhttp.proxyPort=3128' ./gradlew test buildPlugin verifyPluginStructure --no-daemon --stacktrace
    > Task :testWebviewBundle
    Verified IntelliJ webview bundle markers in build/generated/webview
    > Task :test
    TEST-com.devsessioncanvas.intellij.toolwindow.CanvasWebviewHtmlTest.xml tests="1" failures="0"
    TEST-com.devsessioncanvas.intellij.protocol.CanvasProtocolTest.xml tests="6" failures="0"
    > Task :buildPlugin
    > Task :verifyPluginStructure
    BUILD SUCCESSFUL

    javap -classpath /tmp/devsession-gradle-home/caches/9.0.0/transforms/.../ideaIC-2024.3/lib/util.jar com.pty4j.PtyProcess com.pty4j.PtyProcessBuilder com.pty4j.WinSize
    public com.pty4j.PtyProcessBuilder setInitialColumns(java.lang.Integer);
    public com.pty4j.PtyProcessBuilder setInitialRows(java.lang.Integer);
    public com.pty4j.PtyProcess start() throws java.io.IOException;
    public abstract void setWinSize(com.pty4j.WinSize);

本次更新依据的官方文档证据如下；这些是移动目标，后续调整 build range 或发布矩阵前必须再次复核：

- JetBrains IntelliJ Platform Gradle Plugin 2.x 文档，页面构建时间为 2026-06-29，说明 2.x 是当前 Gradle 插件主线，并给出插件 ID、最低平台 / Gradle / Java 运行时要求。
- JetBrains Embedded Browser JCEF 文档，页面构建时间为 2026-06-29，说明使用 JCEF 前应检查 `JBCefApp.isSupported()`，并用 `JBCefBrowser` 把浏览器组件加入 Swing UI。
- JetBrains Plugin Configuration File 文档显示 `until-build` 是可选属性，并建议通常不要设置；JetBrains Gradle Plugin Tasks 文档也说明可通过 `provider { null }` 取消 `until-build`，但不设置上限意味着需要靠测试矩阵发现未来 IDE 不兼容。
- JetBrains Gradle Plugin Tasks 文档，页面构建时间为 2026-06-29，列出 `runIde`、`buildPlugin`、`verifyPlugin` 等后续必须纳入验证的任务。

## 接口与依赖

后续实现应优先形成这些稳定路径和类型。名称可在设计文档中调整，但调整后必须同步本计划：

    extensions/intellij/dev-session-canvas/src/main/kotlin/com/devsessioncanvas/intellij/toolwindow/CanvasToolWindowFactory.kt
      class CanvasToolWindowFactory : ToolWindowFactory

    extensions/intellij/dev-session-canvas/src/main/kotlin/com/devsessioncanvas/intellij/toolwindow/CanvasBrowserBridge.kt
      class CanvasBrowserBridge(project: Project, browser: JBCefBrowser) : Disposable

    extensions/intellij/dev-session-canvas/src/main/kotlin/com/devsessioncanvas/intellij/protocol/CanvasProtocol.kt
      object CanvasProtocol
      enum class WebviewMessageType
      enum class HostMessageType
      data class CanvasHostState
      data class CanvasNode
      data class CanvasViewport
      data class TerminalOutputPayload
      data class TerminalExitPayload

    extensions/intellij/dev-session-canvas/src/main/kotlin/com/devsessioncanvas/intellij/state/CanvasProjectStateService.kt
      class CanvasProjectStateService : PersistentStateComponent<CanvasProjectState>
      fun snapshot(): CanvasHostState
      fun createNote(projectName: String): CanvasHostState
      fun createTerminal(cwd: String, shellPath: String): CanvasTerminalCreation
      fun updateNote(payload: WebviewUpdateNotePayload): CanvasHostState
      fun updateNodePosition(payload: WebviewUpdateNodePositionPayload): CanvasHostState
      fun updateViewport(viewport: CanvasViewport): CanvasHostState
      fun appendTerminalOutput(id: String, text: String): CanvasHostState
      fun updateTerminalPtySize(id: String, cols: Int, rows: Int): CanvasHostState
      fun updateTerminalSize(payload: WebviewTerminalSizePayload): CanvasHostState
      fun deleteNode(id: String): CanvasHostState

    extensions/intellij/dev-session-canvas/src/main/webview/hostAdapter.ts
      function createCanvasHostAdapter(): CanvasHostAdapter
      type WebviewMessage = ready/createNote/createTerminal/updateNote/updateNodePosition/updateViewport/deleteNode/terminalInput/terminalResize/updateTerminalSize/stopTerminal

    extensions/intellij/dev-session-canvas/src/main/kotlin/com/devsessioncanvas/intellij/execution/ExecutionSessionManager.kt
      class ExecutionSessionManager(listener: TerminalSessionListener, processFactory: PtyProcessFactory = DefaultPtyProcessFactory()) : Disposable
      interface TerminalSessionListener
      interface PtyProcessFactory

    extensions/intellij/dev-session-canvas/src/main/kotlin/com/devsessioncanvas/intellij/execution/ShellCommandResolver.kt
      object ShellCommandResolver
      fun defaultShellPath(environment: Map<String, String> = System.getenv(), osName: String = System.getProperty("os.name")): String
      fun defaultWorkingDirectory(basePath: String?): String

    extensions/intellij/dev-session-canvas/src/main/kotlin/com/devsessioncanvas/intellij/execution/AgentCliResolver.kt
      class AgentCliResolver(project: Project)

    extensions/intellij/dev-session-canvas/src/main/kotlin/com/devsessioncanvas/intellij/supervisor/RuntimeSupervisorClient.kt
      class RuntimeSupervisorClient(project: Project) : Disposable

    extensions/intellij/dev-session-canvas/src/main/kotlin/com/devsessioncanvas/intellij/agent/AgentNodeManager.kt
      class AgentNodeManager(project: Project) : Disposable

Kotlin 侧消息模型在第一版只能覆盖当前里程碑需要的最小子集，例如 bootstrap、stateUpdated、createNote、updateNote、deleteNode、createTerminal、terminalInput、terminalResize、terminalOutput 和 terminalExit。完整 `WebviewToHostMessage` / `HostToWebviewMessage` 镜像必须等协议生成或 DTO 子集方案明确后再扩展。Agent 节点可以先于 Runtime Supervisor 落地，但只能承诺当前 IDE 生命周期内的 execution 通道；Runtime Supervisor 落地前，Agent 节点和 Terminal 节点都不能私自发明另一套跨 IDE 生命周期恢复或进程托管语义。

构建依赖的默认研究方向如下：

- IntelliJ Platform Gradle Plugin 2.x：插件构建、`runIde`、`buildPlugin`、`verifyPlugin` 和 `patchPluginXml` 主路径。
- Kotlin JVM：插件主要实现语言。Kotlin 标准库和 coroutines 版本必须按目标 IntelliJ Platform 的 bundled library 策略处理，避免无意打包冲突版本。
- JCEF / `JBCefBrowser`：第一版画布 UI 容器，必须提供 unsupported fallback。
- IntelliJ Platform bundled `pty4j`：Terminal 节点 PTY 后端，当前通过目标 IDE 平台库提供，不额外打包外部版本；仍需验证目标 IDE / OS 矩阵。
- `kotlinx.serialization` 或等价 JSON 库：Kotlin 侧消息解析候选，最终选择要和协议生成策略一致。
- 现有 Node Runtime Supervisor：Agent / Terminal live runtime 候选依赖，当前倾向复用；不得在 JVM client、进程发现、socket 路径和打包分发验证前写成 IntelliJ 已支持。
- `esbuild`、`react`、`react-dom`、`reactflow`、`@xterm/xterm`、`@xterm/addon-fit`：IntelliJ 专用 bundle 的前端依赖，当前通过根 `npm ci` 后的 `node_modules` 解析。后续抽共享 Webview 包或独立前端包时，必须重新收口这些依赖的安装边界。

## 参考资料

- IntelliJ Platform SDK: https://plugins.jetbrains.com/docs/intellij/
- IntelliJ Platform Gradle Plugin 2.x: https://plugins.jetbrains.com/docs/intellij/tools-intellij-platform-gradle-plugin.html
- Gradle Plugin Tasks: https://plugins.jetbrains.com/docs/intellij/tools-intellij-platform-gradle-plugin-tasks.html
- Embedded Browser JCEF: https://plugins.jetbrains.com/docs/intellij/embedded-browser-jcef.html
- Testing Overview: https://plugins.jetbrains.com/docs/intellij/testing-plugins.html
- Build Number Ranges: https://plugins.jetbrains.com/docs/intellij/build-number-ranges.html
- Kotlin Support: https://plugins.jetbrains.com/docs/intellij/using-kotlin.html

本次更新说明：2026-06-30，按当前 monorepo 事实和 JetBrains 官方文档复核结果重写本计划，移除已过期的“等待 notifier / 已存在跨 IDE 共享层”口径，补齐 `PLANS.md` 要求的活文档章节，并把下一步收口到正式 IntelliJ 架构设计文档与 React Flow 画布加载 PoC。

补充更新说明：2026-06-30 08:25 +0800，根据讨论把“最小本地 HTML”降级为调试子步骤，把“React Flow 画布加载”直接提升为里程碑 1 的验收边界，避免后续把 JCEF smoke 误判为真实画布风险已解除。

补充更新说明：2026-06-30 08:37 +0800，根据讨论把后段顺序调整为里程碑 5 Agent 节点、里程碑 6 Runtime Supervisor、里程碑 7 发布准备；测试和文档继续作为各实现里程碑的持续完成条件。

补充更新说明：2026-06-30 08:45 +0800，新增 `docs/design-docs/intellij-platform-plugin-architecture.md` 并同步设计索引，把 IntelliJ 插件架构从 ExecPlan 推进内容沉淀到正式设计文档。

补充更新说明：2026-06-30 09:00 +0800，记录用户确认的七项阶段性决策：目标 IDE 为 Android Studio / IntelliJ IDEA / PyCharm；兼容基线倾向较新 IntelliJ Platform；先验证 JCEF + React Flow；协议接受 Kotlin 最小 DTO 子集；Agent 第一版不承诺关闭 IDE 后继续运行；Runtime Supervisor 倾向复用现有 Node supervisor；第一版仅做内部/手动安装验证。

补充更新说明：2026-06-30 12:20 +0800，记录里程碑 1 工程切片落地：新增 IntelliJ Gradle / Kotlin 插件工程、JCEF Tool Window bridge、React Flow PoC bundle 和 bundle marker 测试；同步设计文档验证状态为“验证中”，并明确当前环境无法完成真实 `runIde` UI smoke。

补充更新说明：2026-06-30 12:58 +0800，记录里程碑 2 工程切片落地：新增 IntelliJ 前端 host adapter、Kotlin 最小协议 DTO / 编解码层和 `CanvasProtocolTest`；将创建测试 Note 的消息名收口为 `webview/createNote`，并保留旧 `webview/createTestNote` 的兼容解析。

补充更新说明：2026-07-01 17:49 +0800，记录内部验证包移除 `until-build` 上限后的三 IDE 手动 smoke 结果：IntelliJ IDEA 与 PyCharm 已能显示 JCEF React Flow 画布和 Note 卡片；Android Studio `AI-253.30387.90` 能安装但显示 JCEF unsupported fallback，因此当时不能仅凭 IDEA / PyCharm 结果把 Android Studio 写成已支持。

补充更新说明：2026-07-01 19:36 +0800，记录用户确认升级 Android Studio 并安装/启用 JCEF 后也可以打开 Dev Session Canvas；旧 `AI-253.30387.90` fallback 作为 runtime / 配置差异保留，后续仍需补精确 build、JCEF 安装方式和完整 smoke checklist。

补充更新说明：2026-07-01 20:35 +0800，记录里程碑 4 Terminal PTY 工程首切片：使用平台 bundled `pty4j` 和 xterm.js 实现 Terminal 节点协议、状态、前端呈现与 session manager；当前仅承诺 IDE 生命周期内运行，真实三 IDE PTY smoke 仍待有图形环境验证。

补充更新说明：2026-07-01 21:01 +0800，记录首轮 Terminal 真实 smoke 暴露的 Backspace 特殊键问题，并把修复路线写入计划和设计文档：JCEF bridge 先转义 U+007F 到 U+009F 控制字符，保留 xterm / PTY 原始输入语义，等待新安装包复验。
