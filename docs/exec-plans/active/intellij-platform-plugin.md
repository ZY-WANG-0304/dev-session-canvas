# IntelliJ 平台插件开发计划

## 执行计划元信息

> **⚠️ 重要更新 (2026-05-03)**：本计划需要与 [Monorepo 重构计划](./standard-monorepo-and-doc-knowledge-base.md) 协调。详见 [跨计划协调文档](./cross-plan-coordination.md)。
> 
> **🔴 优先级调整 (2026-05-03)**：本计划延后到第二阶段，等待 notifier 开发完成后再决策是否启动。

- **状态**: 延后启动（等待第一阶段完成）
- **优先级**: 低（第二阶段，可选）
- **预计工作量**: 6-8 周（1-2 名开发者）**[第二阶段独立工作量]**
- **创建时间**: 2026-05-02
- **最后更新**: 2026-05-03（优先级调整）
- **负责人**: 待定
- **前置依赖**: 
  - **硬依赖**: [Monorepo 重构计划](./standard-monorepo-and-doc-knowledge-base.md) 第一阶段完成（VSCode 生态）
  - **硬依赖**: Notifier 开发完成并验证价值
  - **硬依赖**: 跨平台共享层落位（Monorepo 里程碑 5）
  - **决策依赖**: 团队评估是否有资源和业务需求启动 IntelliJ 开发
- **相关文档**: 
  - [ARCHITECTURE.md](../../ARCHITECTURE.md)
  - [技术债务追踪](../tech-debt-tracker.md)
  - [跨计划协调文档](./cross-plan-coordination.md) ⭐ **必读**

## 背景与动机

### 业务需求

团队中有大量 Android 开发者依赖 Android Studio 进行日常开发，他们也需要 DevSessionCanvas 提供的多会话协作画布能力。

### 技术机会

Android Studio 基于 IntelliJ Platform 构建，而 JetBrains 全家桶（PyCharm、WebStorm、GoLand、PhpStorm、Rider、CLion 等）都基于同一平台。这意味着：

- **一次开发，覆盖 10+ IDE**
- **用户基础扩大 10-20 倍**
- **投入产出比远超预期**

### 当前状态

- ✅ VSCode 扩展已完成并发布 Preview 版本
- ✅ 核心架构已验证（画布、Agent、Terminal、Note 节点）
- ✅ Webview 前端代码可复用（React + React Flow）
- ❌ 尚未启动 IntelliJ 平台适配
- ⏳ **等待 Monorepo 重构完成**（2026-05-03 识别依赖）

## 目标与范围

### 核心目标

为 IntelliJ Platform 开发插件，使 DevSessionCanvas 能在以下 IDE 中运行：

| IDE | 主要用户群 | 优先级 |
|-----|----------|--------|
| Android Studio | Android 开发者 | 🔴 高（业务驱动） |
| PyCharm | Python 开发者 | 🔴 高（AI/ML 场景） |
| IntelliJ IDEA | Java/Kotlin 开发者 | 🟡 中 |
| WebStorm | 前端开发者 | 🟡 中 |
| GoLand | Go 开发者 | 🟢 低 |
| 其他 JetBrains IDE | 各语言开发者 | 🟢 低 |

### 功能范围

**阶段 1 - MVP（必须）**：
- ✅ 画布基础交互（缩放、拖拽、选择）
- ✅ Note 节点（纯前端，最简单）
- ✅ Terminal 节点（使用 pty4j）
- ✅ 基础持久化（项目级别状态）

**阶段 2 - 完整功能（应该）**：
- ✅ Agent 节点（codex/claude CLI 集成）
- ✅ Runtime Supervisor 集成
- ✅ 跨 IDE 重启恢复
- ✅ Settings 配置页面

**阶段 3 - 增强特性（可选）**：
- ⭕ 与 IDE 原生工具集成（Run Configuration、Debug）
- ⭕ 平台特定优化（Android Studio 的 Logcat 集成等）
- ⭕ 性能优化与大规模节点支持

### 非目标

- ❌ 不支持 Fleet（新架构，需单独适配）
- ❌ 不重写 VSCode 扩展（保持两个独立实现）
- ❌ 不追求 100% 功能对等（优先核心场景）

## 技术方案

### 架构设计

#### 整体架构

```
IntelliJ Plugin 架构
┌─────────────────────────────────────────────────────┐
│  IntelliJ Platform (Java/Kotlin)                    │
│  ┌───────────────────────────────────────────────┐  │
│  │  Plugin Entry (plugin.xml + CanvasPlugin.kt) │  │
│  └───────────────────────────────────────────────┘  │
│                        │                             │
│  ┌─────────────────────┴─────────────────────────┐  │
│  │  ToolWindow (CanvasToolWindowFactory)         │  │
│  │  ┌─────────────────────────────────────────┐  │  │
│  │  │  JBCefBrowser (Chromium)                │  │  │
│  │  │  ┌───────────────────────────────────┐  │  │  │
│  │  │  │  React App (复用 VSCode webview) │  │  │  │
│  │  │  │  - Canvas (React Flow)           │  │  │  │
│  │  │  │  - Node Components               │  │  │  │
│  │  │  │  - Terminal Frontend (xterm.js)  │  │  │  │
│  │  │  └───────────────────────────────────┘  │  │  │
│  │  └─────────────────────────────────────────┘  │  │
│  └─────────────────────────────────────────────────┘  │
│                        │                             │
│  ┌─────────────────────┴─────────────────────────┐  │
│  │  JavaScript Bridge (CefMessageRouter)         │  │
│  └─────────────────────────────────────────────────┘  │
│                        │                             │
│  ┌─────────────────────┴─────────────────────────┐  │
│  │  Canvas State Manager (Kotlin)                │  │
│  │  - Node lifecycle                             │  │
│  │  - Persistence (PersistentStateComponent)     │  │
│  │  - Message routing                            │  │
│  └─────────────────────────────────────────────────┘  │
│                        │                             │
│  ┌─────────────────────┴─────────────────────────┐  │
│  │  Execution Manager (Kotlin)                   │  │
│  │  - ProcessBuilder / pty4j                     │  │
│  │  - Output capture & forwarding                │  │
│  │  - Session lifecycle                          │  │
│  └─────────────────────────────────────────────────┘  │
│                        │                             │
│  ┌─────────────────────┴─────────────────────────┐  │
│  │  Runtime Supervisor Client (Kotlin)           │  │
│  │  - Socket communication                       │  │
│  │  - Session persistence                        │  │
│  └─────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────┐
│  Runtime Supervisor (Node.js or Kotlin)             │
│  - 独立进程，跨 IDE 生命周期                          │
│  - 会话注册表与持久化                                │
└─────────────────────────────────────────────────────┘
```

#### 代码复用策略

**可直接复用（60-70%）**：

1. **Webview 前端** (`src/webview/`)
   - React 组件
   - React Flow 画布
   - xterm.js 终端前端
   - 样式与交互逻辑

2. **协议定义** (`src/common/protocol.ts`)
   - 消息类型
   - 节点模型
   - 状态结构

3. **业务逻辑**
   - Agent CLI 解析
   - 终端状态管理
   - 注意力信号检测

**需要重写（30-40%）**：

1. **宿主集成层**
   - Plugin 入口与生命周期
   - ToolWindow 管理
   - Settings 配置

2. **执行层**
   - 进程启动（ProcessBuilder/pty4j）
   - 输出捕获
   - 会话管理

3. **持久化层**
   - PersistentStateComponent
   - 项目级别存储

### 技术栈选型

| 组件 | VSCode 实现 | IntelliJ 实现 | 说明 |
|------|------------|--------------|------|
| 插件语言 | TypeScript | **Kotlin** | JetBrains 官方推荐 |
| UI 容器 | Webview | **JBCefBrowser** | 内嵌 Chromium |
| 前端框架 | React | **React（复用）** | 无需改动 |
| 画布库 | React Flow | **React Flow（复用）** | 无需改动 |
| 终端前端 | xterm.js | **xterm.js（复用）** | 无需改动 |
| 终端后端 | node-pty | **pty4j** | JetBrains 官方库 |
| 进程管理 | child_process | **ProcessBuilder** | Java 标准库 |
| 持久化 | WorkspaceState | **PersistentStateComponent** | IntelliJ 标准 API |
| 构建工具 | esbuild | **Gradle** | IntelliJ 标准构建 |

### 关键技术点

#### 1. JBCefBrowser 集成

```kotlin
class CanvasToolWindowFactory : ToolWindowFactory {
    override fun createToolWindowContent(
        project: Project,
        toolWindow: ToolWindow
    ) {
        val browser = JBCefBrowser()
        
        // 加载 React 应用
        val htmlContent = loadWebviewHtml(project)
        browser.loadHTML(htmlContent)
        
        // 设置消息桥接
        val bridge = CanvasMessageBridge(project, browser)
        bridge.setupMessageRouter()
        
        // 添加到 ToolWindow
        val content = ContentFactory.getInstance()
            .createContent(browser.component, "", false)
        toolWindow.contentManager.addContent(content)
    }
}
```

#### 2. JavaScript Bridge

> **⚠️ 已更新 (2026-05-03)**：使用从 JSON Schema 生成的 Kotlin 协议定义。

```kotlin
// 使用共享协议定义（从 packages/protocol/kotlin/ 导入）
import com.devsessioncanvas.protocol.WebviewToHostMessage
import com.devsessioncanvas.protocol.HostToWebviewMessage

class CanvasMessageBridge(
    private val project: Project,
    private val browser: JBCefBrowser
) {
    fun setupMessageRouter() {
        val router = CefMessageRouter.create()
        
        router.addHandler(object : CefMessageRouterHandlerAdapter() {
            override fun onQuery(
                browser: CefBrowser,
                frame: CefFrame,
                queryId: Long,
                request: String,
                persistent: Boolean,
                callback: CefQueryCallback
            ): Boolean {
                // 处理来自 Webview 的消息
                handleWebviewMessage(request, callback)
                return true
            }
        }, true)
        
        browser.jbCefClient.cefClient.addMessageRouter(router)
    }
    
    private fun handleWebviewMessage(
        message: String,
        callback: CefQueryCallback
    ) {
        // 使用自动生成的协议定义
        val msg = Json.decodeFromString<WebviewToHostMessage>(message)
        when (msg.type) {
            "createNode" -> handleCreateNode(msg, callback)
            "deleteNode" -> handleDeleteNode(msg, callback)
            // ...
        }
    }
    
    fun sendToWebview(message: HostToWebviewMessage) {
        val json = Json.encodeToString(message)
        browser.cefBrowser.executeJavaScript(
            "window.receiveHostMessage($json)",
            browser.cefBrowser.url,
            0
        )
    }
}
```

#### 3. pty4j 终端集成

```kotlin
class ExecutionSessionManager(private val project: Project) {
    fun startTerminal(
        command: String,
        workingDir: String
    ): ExecutionSession {
        val pty = PtyProcessBuilder()
            .setCommand(arrayOf(getShellPath(), "-c", command))
            .setDirectory(workingDir)
            .setEnvironment(getEnvironment())
            .start()
        
        val session = ExecutionSession(
            id = UUID.randomUUID().toString(),
            process = pty,
            outputBuffer = StringBuilder()
        )
        
        // 启动输出读取线程
        startOutputReader(session)
        
        return session
    }
    
    private fun startOutputReader(session: ExecutionSession) {
        ApplicationManager.getApplication().executeOnPooledThread {
            val reader = BufferedReader(
                InputStreamReader(session.process.inputStream)
            )
            reader.forEachLine { line ->
                session.outputBuffer.append(line).append("\n")
                notifyWebview(session.id, line)
            }
        }
    }
}
```

#### 4. 持久化

```kotlin
@State(
    name = "DevSessionCanvasState",
    storages = [Storage("devSessionCanvas.xml")]
)
class CanvasStateService : PersistentStateComponent<CanvasState> {
    private var state = CanvasState()
    
    override fun getState(): CanvasState = state
    
    override fun loadState(state: CanvasState) {
        this.state = state
    }
    
    companion object {
        fun getInstance(project: Project): CanvasStateService {
            return project.service()
        }
    }
}

data class CanvasState(
    var nodes: List<CanvasNodeSummary> = emptyList(),
    var viewport: ViewportState = ViewportState(),
    var sessions: Map<String, SessionSnapshot> = emptyMap()
)
```

### 项目结构

> **⚠️ 已更新 (2026-05-03)**：项目位置调整为 monorepo 结构，协议和 Webview 使用共享包。

```
# 在 monorepo 中的位置
extensions/intellij/dev-session-canvas/
├── build.gradle.kts                    # Gradle 构建配置
├── gradle.properties
├── settings.gradle.kts
├── src/
│   ├── main/
│   │   ├── kotlin/
│   │   │   └── com/devsessioncanvas/intellij/
│   │   │       ├── CanvasPlugin.kt                 # 插件入口
│   │   │       ├── toolwindow/
│   │   │       │   ├── CanvasToolWindowFactory.kt
│   │   │       │   └── CanvasMessageBridge.kt
│   │   │       ├── state/
│   │   │       │   ├── CanvasStateService.kt
│   │   │       │   └── CanvasState.kt
│   │   │       ├── execution/
│   │   │       │   ├── ExecutionSessionManager.kt
│   │   │       │   ├── ExecutionSession.kt
│   │   │       │   └── AgentCliResolver.kt
│   │   │       ├── supervisor/
│   │   │       │   └── RuntimeSupervisorClient.kt
│   │   │       ├── actions/
│   │   │       │   ├── OpenCanvasAction.kt
│   │   │       │   ├── CreateNodeAction.kt
│   │   │       │   └── ResetStateAction.kt
│   │   │       └── settings/
│   │   │           ├── CanvasSettings.kt
│   │   │           └── CanvasConfigurable.kt
│   │   └── resources/
│   │       ├── META-INF/
│   │       │   └── plugin.xml                      # 插件配置
│   │       # webview 资源通过构建时从 packages/webview/dist/intellij/ 复制
│   └── test/
│       └── kotlin/
│           └── com/devsessioncanvas/intellij/
│               ├── ExecutionSessionManagerTest.kt
│               └── CanvasStateServiceTest.kt
├── README.md
└── CHANGELOG.md

# 依赖的共享包（在 monorepo 根目录）
packages/
  protocol/kotlin/                      # 【依赖】Kotlin 协议定义（从 JSON Schema 生成）
  webview/dist/intellij/                # 【依赖】构建好的 React 应用
```

### plugin.xml 配置

```xml
<idea-plugin>
    <id>com.devsessioncanvas.intellij</id>
    <name>Dev Session Canvas</name>
    <vendor email="wzy0304@outlook.com" url="https://github.com/ZY-WANG-0304/dev-session-canvas">
        Dev Session Canvas
    </vendor>
    
    <description><![CDATA[
        多会话协作画布，支持 Agent、Terminal 和 Note 节点的可视化管理。
    ]]></description>
    
    <!-- 兼容所有 IntelliJ 平台产品 -->
    <depends>com.intellij.modules.platform</depends>
    
    <!-- 可选：Android Studio 特定功能 -->
    <depends optional="true" config-file="android-studio.xml">
        com.intellij.modules.androidstudio
    </depends>
    
    <!-- 可选：Python 特定功能 -->
    <depends optional="true" config-file="pycharm.xml">
        com.intellij.modules.python
    </depends>
    
    <extensions defaultExtensionNs="com.intellij">
        <!-- ToolWindow -->
        <toolWindow
            id="Dev Session Canvas"
            anchor="bottom"
            factoryClass="com.devsessioncanvas.intellij.toolwindow.CanvasToolWindowFactory"
            icon="/icons/canvas.svg"/>
        
        <!-- Settings -->
        <projectConfigurable
            instance="com.devsessioncanvas.intellij.settings.CanvasConfigurable"
            displayName="Dev Session Canvas"/>
        
        <!-- State Service -->
        <projectService
            serviceImplementation="com.devsessioncanvas.intellij.state.CanvasStateService"/>
    </extensions>
    
    <actions>
        <action
            id="DevSessionCanvas.OpenCanvas"
            class="com.devsessioncanvas.intellij.actions.OpenCanvasAction"
            text="Open Canvas"
            description="Open Dev Session Canvas"
            icon="AllIcons.Actions.Execute">
            <add-to-group group-id="ToolsMenu" anchor="last"/>
        </action>
        
        <action
            id="DevSessionCanvas.CreateNode"
            class="com.devsessioncanvas.intellij.actions.CreateNodeAction"
            text="Create Node"
            description="Create a new canvas node">
        </action>
    </actions>
</idea-plugin>
```

## 实施计划

### 阶段划分

#### 阶段 0：准备与验证（1 周）

> **⚠️ 已更新 (2026-05-03)**：本阶段需要等待 Monorepo 重构完成。

**前置条件**：
- ✅ Monorepo 重构完成至里程碑 2（VSCode 扩展迁移到新结构）
- ✅ 跨平台共享层建设完成（里程碑 5）

**目标**：技术可行性验证

**任务**：
- [ ] 在 `extensions/intellij/` 下创建插件项目骨架
- [ ] 配置 Gradle 依赖共享包（`packages/protocol/kotlin/`、`packages/webview/`）
- [ ] 验证 JBCefBrowser 加载共享的 React 应用
- [ ] 验证 JavaScript Bridge 双向通信（使用生成的协议定义）
- [ ] 验证 pty4j 启动终端进程
- [ ] 评估团队 Kotlin 技能

**交付物**：
- PoC 项目（可运行的最小 Demo，位于 monorepo 中）
- 技术验证报告（包含共享代码复用验证）
- 风险评估文档

#### 阶段 1：MVP 开发（3 周）

**目标**：基础画布 + Note + Terminal 节点

**Week 1：基础框架**
- [ ] 完成项目结构搭建
- [ ] 实现 ToolWindow 与 JBCefBrowser 集成
- [ ] 实现 JavaScript Bridge
- [ ] 复用并适配 Webview 前端代码
- [ ] 实现基础消息协议

**Week 2：节点实现**
- [ ] 实现 Note 节点（纯前端）
- [ ] 实现 Terminal 节点（pty4j 集成）
- [ ] 实现节点 CRUD 操作
- [ ] 实现画布交互（缩放、拖拽、选择）

**Week 3：持久化与测试**
- [ ] 实现 PersistentStateComponent
- [ ] 实现项目级别状态存储
- [ ] 实现跨 IDE 重启恢复
- [ ] 编写单元测试
- [ ] 内部测试与 Bug 修复

**交付物**：
- 可运行的 MVP 插件
- 支持 Note 和 Terminal 节点
- 基础持久化功能

#### 阶段 2：Agent 集成（2 周）

**目标**：Agent 节点 + Runtime Supervisor

**Week 4：Agent 节点**
- [ ] 移植 AgentCliResolver 逻辑
- [ ] 实现 Agent 进程启动
- [ ] 实现输出捕获与转发
- [ ] 实现 Agent 节点 UI

**Week 5：Supervisor 集成**
- [ ] 决策：复用 Node.js 实现 or Kotlin 重写
- [ ] 实现 RuntimeSupervisorClient
- [ ] 实现会话持久化
- [ ] 测试跨生命周期恢复

**交付物**：
- 完整功能的插件
- 支持 Agent、Terminal、Note 三类节点
- Runtime Supervisor 集成

#### 阶段 3：完善与发布（1 周）

**目标**：Settings、文档、发布

**Week 6：完善**
- [ ] 实现 Settings 配置页面
- [ ] 实现 Actions 与快捷键
- [ ] 编写用户文档
- [ ] 编写开发者文档
- [ ] 性能优化

**Week 7：发布准备**
- [ ] 完整测试（Android Studio、PyCharm、IntelliJ IDEA）
- [ ] 准备 Marketplace 发布材料
- [ ] 发布到 JetBrains Marketplace
- [ ] 收集早期用户反馈

**交付物**：
- 发布版本插件
- 完整文档
- Marketplace 页面

### 里程碑

| 里程碑 | 时间 | 标志 |
|--------|------|------|
| M0: PoC 完成 | Week 1 | JBCefBrowser 加载 React 画布 |
| M1: MVP 完成 | Week 3 | Note + Terminal 节点可用 |
| M2: 功能完整 | Week 5 | Agent 节点可用 |
| M3: 发布就绪 | Week 7 | Marketplace 发布 |

### 资源需求

**人力**：
- 1-2 名 Kotlin 开发者（全职）
- 1 名前端开发者（兼职，适配 Webview）
- 1 名测试工程师（兼职）

**技能要求**：
- 必须：Kotlin、IntelliJ Platform SDK
- 优先：React、TypeScript、pty4j
- 加分：VSCode 扩展开发经验

**工具与环境**：
- IntelliJ IDEA Ultimate（开发）
- Android Studio（测试）
- PyCharm（测试）
- Gradle 8.x
- JDK 17+

## 风险与挑战

### 技术风险

| 风险 | 影响 | 概率 | 缓解措施 |
|------|------|------|----------|
| JBCefBrowser 性能问题 | 高 | 中 | 阶段 0 验证，必要时降级到 Swing |
| pty4j 兼容性问题 | 中 | 低 | 参考 IntelliJ Terminal 插件实现 |
| Supervisor 跨平台问题 | 中 | 中 | 优先 Kotlin 重写，避免 Node.js 依赖 |
| 消息协议不兼容 | 低 | 低 | 严格遵循 VSCode 协议定义 |

### 团队风险

| 风险 | 影响 | 概率 | 缓解措施 |
|------|------|------|----------|
| Kotlin 技能不足 | 高 | 中 | 提前培训，参考官方文档 |
| IntelliJ SDK 不熟悉 | 中 | 高 | 学习官方示例，参考开源插件 |
| 人力不足 | 高 | 中 | 调整阶段划分，优先 MVP |

### 业务风险

| 风险 | 影响 | 概率 | 缓解措施 |
|------|------|------|----------|
| 用户接受度低 | 高 | 低 | 早期用户测试，快速迭代 |
| 与 VSCode 版本功能差异 | 中 | 高 | 明确非目标，管理预期 |
| Marketplace 审核不通过 | 中 | 低 | 提前研究审核标准 |

## 成功标准

### 功能标准

- ✅ 支持 Android Studio、PyCharm、IntelliJ IDEA
- ✅ 支持 Agent、Terminal、Note 三类节点
- ✅ 支持画布基础交互（缩放、拖拽、选择）
- ✅ 支持项目级别持久化
- ✅ 支持跨 IDE 重启恢复

### 质量标准

- ✅ 无 P0/P1 Bug
- ✅ 核心功能测试覆盖率 > 80%
- ✅ 启动时间 < 2s
- ✅ 内存占用 < 200MB（空画布）

### 用户标准

- ✅ 早期用户测试通过（10+ 用户）
- ✅ Marketplace 评分 > 4.0
- ✅ 用户文档完整

## 后续计划

### 短期（3 个月）

- 收集用户反馈，快速迭代
- 修复 Bug，优化性能
- 补充平台特定功能（Android Logcat 集成等）

### 中期（6 个月）

- 与 IDE 原生工具深度集成
- 支持更多节点类型（Database、HTTP Client 等）
- 性能优化，支持大规模节点

### 长期（1 年）

- 探索跨 IDE 协作（VSCode ↔ IntelliJ）
- 云端同步与团队协作
- 插件生态（第三方节点类型）

## 参考资料

### 官方文档

- [IntelliJ Platform SDK](https://plugins.jetbrains.com/docs/intellij/)
- [JBCefBrowser 文档](https://plugins.jetbrains.com/docs/intellij/jcef.html)
- [pty4j GitHub](https://github.com/JetBrains/pty4j)
- [Kotlin 官方文档](https://kotlinlang.org/docs/)

### 示例插件

- [IntelliJ Terminal 插件](https://github.com/JetBrains/intellij-community/tree/master/plugins/terminal)
- [Database Tools 插件](https://github.com/JetBrains/intellij-community/tree/master/plugins/database)
- [Markdown 插件](https://github.com/JetBrains/intellij-community/tree/master/plugins/markdown)

### 内部文档

- [ARCHITECTURE.md](../../ARCHITECTURE.md) - VSCode 扩展架构
- [protocol.ts](../../src/common/protocol.ts) - 消息协议定义
- [executionSessionBridge.ts](../../src/panel/executionSessionBridge.ts) - 执行会话管理

## 附录

### A. VSCode vs IntelliJ API 对照表

| 功能 | VSCode API | IntelliJ API |
|------|-----------|--------------|
| 插件入口 | `activate(context)` | `plugin.xml` + `Plugin` interface |
| UI 容器 | `vscode.window.createWebviewPanel()` | `ToolWindowFactory` + `JBCefBrowser` |
| 命令注册 | `vscode.commands.registerCommand()` | `<action>` in plugin.xml |
| 配置读取 | `vscode.workspace.getConfiguration()` | `PropertiesComponent` |
| 持久化 | `context.workspaceState` | `PersistentStateComponent` |
| 文件系统 | `vscode.workspace.fs` | `VirtualFileSystem` |
| 进程启动 | `child_process.spawn()` | `ProcessBuilder` / `pty4j` |
| 异步执行 | `Promise` / `async/await` | `ApplicationManager.executeOnPooledThread()` |

### B. 协议转换示例

> **⚠️ 已更新 (2026-05-03)**：使用 JSON Schema 作为单一真相来源，自动生成 TypeScript 和 Kotlin。

**JSON Schema (单一真相来源)**:
```json
// packages/protocol/schema/protocol.json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "definitions": {
    "CanvasNodeSummary": {
      "type": "object",
      "properties": {
        "id": { "type": "string" },
        "kind": { "$ref": "#/definitions/CanvasNodeKind" },
        "position": { "$ref": "#/definitions/Position" },
        "size": { "$ref": "#/definitions/Size" },
        "metadata": { "$ref": "#/definitions/NodeMetadata" }
      },
      "required": ["id", "kind", "position", "size", "metadata"]
    },
    "Position": {
      "type": "object",
      "properties": {
        "x": { "type": "number" },
        "y": { "type": "number" }
      },
      "required": ["x", "y"]
    }
  }
}
```

**TypeScript (自动生成)**:
```typescript
// packages/protocol/typescript/protocol.ts
// 从 JSON Schema 自动生成
interface CanvasNodeSummary {
  id: string;
  kind: CanvasNodeKind;
  position: { x: number; y: number };
  size: { width: number; height: number };
  metadata: AgentMetadata | TerminalMetadata | NoteMetadata;
}
```

**Kotlin (自动生成)**:
```kotlin
// packages/protocol/kotlin/Protocol.kt
// 从 JSON Schema 自动生成
@Serializable
data class CanvasNodeSummary(
    val id: String,
    val kind: CanvasNodeKind,
    val position: Position,
    val size: Size,
    val metadata: NodeMetadata
)

@Serializable
data class Position(val x: Double, val y: Double)

@Serializable
data class Size(val width: Double, val height: Double)

@Serializable
sealed class NodeMetadata {
    @Serializable
    data class Agent(val provider: String, val status: String) : NodeMetadata()
    
    @Serializable
    data class Terminal(val command: String, val exitCode: Int?) : NodeMetadata()
    
    @Serializable
    data class Note(val content: String) : NodeMetadata()
}
```

**生成工具链**:
```bash
# 从 TypeScript 生成 JSON Schema
npm run generate:schema

# 从 JSON Schema 生成 Kotlin
cd extensions/intellij/dev-session-canvas
./gradlew generateKotlinFromSchema
```

### C. 学习资源

**Kotlin 学习**：
- [Kotlin Koans](https://play.kotlinlang.org/koans/)
- [Kotlin for Java Developers](https://www.coursera.org/learn/kotlin-for-java-developers)

**IntelliJ Platform 学习**：
- [IntelliJ Platform Plugin SDK](https://plugins.jetbrains.com/docs/intellij/welcome.html)
- [IntelliJ Platform Explorer](https://plugins.jetbrains.com/intellij-platform-explorer/)
- [Plugin Development Forum](https://intellij-support.jetbrains.com/hc/en-us/community/topics/200366979-IntelliJ-IDEA-Open-API-and-Plugin-Development)

---

**文档版本**: v1.0  
**最后更新**: 2026-05-02  
**维护者**: 待定  
**状态**: 📋 待启动
