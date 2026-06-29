# 跨计划协调：Monorepo 重构 + IntelliJ 插件开发

## 执行计划元信息

- **状态**: 待启动
- **优先级**: 高（影响两个关键计划）
- **创建时间**: 2026-05-03
- **相关计划**:
  - [standard-monorepo-and-doc-knowledge-base.md](../completed/standard-monorepo-and-doc-knowledge-base.md)
  - [intellij-platform-plugin.md](./intellij-platform-plugin.md)

## 问题陈述

> **⚠️ 优先级决策 (2026-05-03)**：团队决定先完成 notifier 开发，再考虑 IntelliJ 支持。这意味着跨平台共享层可以延后，先聚焦 VSCode 生态的完整性。

当前存在两个独立的执行计划：

1. **Monorepo 重构计划**：将单扩展仓库演进为标准 monorepo，支持主扩展 + notifier companion
2. **IntelliJ 插件开发计划**：为 IntelliJ Platform 开发插件，覆盖 Android Studio、PyCharm 等 10+ IDE

**执行顺序**：
- **第一阶段**：Monorepo 重构 + notifier 开发（VSCode 生态）
- **第二阶段**：IntelliJ 插件开发（跨平台扩展）

这两个计划如果独立执行，会产生以下冲突：

### 冲突 1：目录结构不兼容

**Monorepo 计划**建议的结构：
```
/
  extensions/
    dev-session-canvas/          # VSCode 主扩展
    dev-session-canvas-notifier/ # VSCode notifier
  packages/
    attention-protocol/          # 共享协议
```

**IntelliJ 计划**建议的结构：
```
intellij-plugin/                 # 独立仓库或子目录？
  src/main/kotlin/
  build.gradle.kts
```

**问题**：IntelliJ 插件应该放在哪里？是独立仓库还是 monorepo 的一部分？

### 冲突 2：共享代码复用策略不明确

**Monorepo 计划**：
- 只考虑了 VSCode 扩展之间的共享（`packages/attention-protocol/`）
- 没有考虑跨平台（VSCode ↔ IntelliJ）的共享

**IntelliJ 计划**：
- 提到 60-70% 代码可复用（Webview 前端、协议定义）
- 但没有明确如何在 monorepo 中组织这些共享代码

**问题**：如何组织跨平台共享代码？TypeScript 和 Kotlin 如何共享协议定义？

### 冲突 3：文档体系不完整

**Monorepo 计划**：
- 只考虑了 VSCode 扩展的文档结构
- `docs/README.md` 作为知识库入口

**IntelliJ 计划**：
- 没有明确文档应该放在哪里
- 是否需要独立的 IntelliJ 文档？

**问题**：如何在统一的文档体系中覆盖两个平台？

### 冲突 4：构建工具链不统一

**Monorepo 计划**：
- npm workspaces
- esbuild
- TypeScript

**IntelliJ 计划**：
- Gradle
- Kotlin
- JVM 生态

**问题**：如何在一个 monorepo 中协调两套完全不同的构建工具链？

## 解决方案

### 方案 A：统一 Monorepo（推荐）

将 IntelliJ 插件纳入同一个 monorepo，但保持构建工具链独立。

#### 目录结构

```
/
  package.json                    # npm workspace root
  README.md                       # 项目总入口
  ARCHITECTURE.md                 # 全局架构（覆盖两个平台）
  docs/                           # 统一文档知识库
    README.md                     # 文档入口（覆盖两个平台）
    diagrams/
    design-docs/
    exec-plans/
    product-specs/
  
  # VSCode 生态
  extensions/
    vscode/
      dev-session-canvas/         # VSCode 主扩展
      dev-session-canvas-notifier/# VSCode notifier
  
  # IntelliJ 生态
  extensions/
    intellij/
      dev-session-canvas/         # IntelliJ 插件
        build.gradle.kts
        src/main/kotlin/
        src/main/resources/webview/  # 复用的 React 代码
  
  # 共享代码
  packages/
    protocol/                     # 跨平台协议定义
      typescript/                 # TypeScript 版本（VSCode 用）
      kotlin/                     # Kotlin 版本（IntelliJ 用）
      schema/                     # JSON Schema（单一真相来源）
    webview/                      # 共享的 React 前端
      src/
        canvas/                   # React Flow 画布
        nodes/                    # 节点组件
        terminal/                 # xterm.js 终端
    attention-protocol/           # VSCode 特定的注意力协议
  
  # 构建与工具
  scripts/                        # 跨平台构建脚本
    build-vscode.mjs
    build-intellij.sh
    build-all.sh
  tests/                          # 跨平台集成测试
```

#### 关键设计决策

1. **双平台目录分离**
   - `extensions/vscode/` 和 `extensions/intellij/` 明确分离
   - 避免混淆，清晰表达双平台支持

2. **协议定义三层结构**
   ```
   packages/protocol/
     schema/protocol.json         # JSON Schema（单一真相来源）
     typescript/protocol.ts       # 从 schema 生成
     kotlin/Protocol.kt           # 从 schema 生成
   ```
   - 使用 JSON Schema 作为单一真相来源
   - 自动生成 TypeScript 和 Kotlin 类型定义
   - 避免手工同步导致的不一致

3. **Webview 前端完全共享**
   ```
   packages/webview/
     src/                         # React 源码
     dist/vscode/                 # 为 VSCode 构建
     dist/intellij/               # 为 IntelliJ 构建
   ```
   - 单一 React 代码库
   - 通过构建时注入适配不同平台的 Bridge

4. **构建工具链隔离但协调**
   ```bash
   # 根目录统一入口
   npm run build              # 构建所有平台
   npm run build:vscode       # 只构建 VSCode
   npm run build:intellij     # 只构建 IntelliJ（内部调用 Gradle）
   
   # IntelliJ 子目录保持 Gradle
   cd extensions/intellij/dev-session-canvas
   ./gradlew build
   ```

### 方案 B：独立仓库

保持 VSCode 和 IntelliJ 为两个独立仓库，通过 Git submodule 或 npm package 共享代码。

#### 优点
- 构建工具链完全独立
- 发布流程独立
- 团队可以独立工作

#### 缺点
- 共享代码同步困难
- 文档容易分裂
- 协议定义容易不一致
- 增加维护成本

**不推荐**，因为与 Monorepo 计划的初衷冲突。

## 两个计划的调整建议

### Monorepo 计划需要调整的内容

#### 1. 扩展目录结构调整

**原计划**：
```
extensions/
  dev-session-canvas/
  dev-session-canvas-notifier/
```

**调整后**：
```
extensions/
  vscode/
    dev-session-canvas/
    dev-session-canvas-notifier/
  intellij/
    dev-session-canvas/
```

**理由**：明确平台边界，为未来可能的其他平台（如 Vim、Emacs）预留空间。

#### 2. 共享包结构调整

**原计划**：
```
packages/
  attention-protocol/
```

**调整后**：
```
packages/
  protocol/                    # 跨平台协议（新增）
    schema/
    typescript/
    kotlin/
  webview/                     # 跨平台前端（新增）
    src/
    dist/
  attention-protocol/          # VSCode 特定（保留）
```

**理由**：支持跨平台代码复用。

#### 3. 文档体系调整

**原计划**：
- `docs/README.md` 作为知识库入口
- 只考虑 VSCode 扩展

**调整后**：
- `docs/README.md` 覆盖两个平台
- 新增 `docs/platforms/` 目录：
  ```
  docs/
    platforms/
      vscode.md              # VSCode 特定文档
      intellij.md            # IntelliJ 特定文档
      comparison.md          # 平台对比
  ```

#### 4. 构建脚本调整

**原计划**：
```json
{
  "scripts": {
    "build": "...",
    "test": "..."
  }
}
```

**调整后**：
```json
{
  "scripts": {
    "build": "npm run build:vscode && npm run build:intellij",
    "build:vscode": "npm run -w extensions/vscode/dev-session-canvas build",
    "build:intellij": "cd extensions/intellij/dev-session-canvas && ./gradlew build",
    "test": "npm run test:vscode && npm run test:intellij",
    "test:vscode": "...",
    "test:intellij": "cd extensions/intellij/dev-session-canvas && ./gradlew test"
  }
}
```

#### 5. 里程碑调整

**原计划的 4 个里程碑**：
1. 结构定稿
2. 仓库根目录与主扩展迁移
3. companion 与共享协议落位
4. 文档知识库收口

**调整后增加第 5 个里程碑**：
5. **跨平台共享层落位**
   - 建立 `packages/protocol/` 三层结构
   - 建立 `packages/webview/` 共享前端
   - 验证 IntelliJ 插件可以复用共享代码

### IntelliJ 计划需要调整的内容

#### 1. 前置依赖调整

**原计划**：
- **前置依赖**: 无

**调整后**：
- **前置依赖**: Monorepo 重构完成（至少到里程碑 2）
- **软依赖**: 跨平台共享层落位（里程碑 5）

**理由**：IntelliJ 插件应该基于 monorepo 结构开发，而不是独立仓库。

#### 2. 项目结构调整

**原计划**：
```
intellij-plugin/
  build.gradle.kts
  src/main/kotlin/
  src/main/resources/webview/
```

**调整后**：
```
extensions/intellij/dev-session-canvas/
  build.gradle.kts
  settings.gradle.kts
  src/main/
    kotlin/
    resources/
      META-INF/plugin.xml
      # webview 资源通过构建时从 packages/webview/dist/ 复制
```

#### 3. 代码复用策略调整

**原计划**：
- "复用 VSCode 的 webview 代码"（没有明确如何复用）

**调整后**：
- 依赖 `packages/webview/` 共享包
- 依赖 `packages/protocol/kotlin/` 协议定义
- 构建时从共享包复制资源：
  ```kotlin
  // build.gradle.kts
  tasks.register<Copy>("copyWebviewAssets") {
      from("../../../packages/webview/dist/intellij")
      into("src/main/resources/webview")
  }
  
  tasks.named("processResources") {
      dependsOn("copyWebviewAssets")
  }
  ```

#### 4. 阶段划分调整

**原计划的阶段 0**：
- 创建 IntelliJ 插件项目骨架
- 验证 JBCefBrowser 加载 React 应用

**调整后的阶段 0**：
- **等待 Monorepo 重构完成**（里程碑 2）
- 在 `extensions/intellij/` 下创建项目骨架
- 验证可以引用 `packages/webview/` 和 `packages/protocol/`
- 验证 JBCefBrowser 加载共享的 React 应用

#### 5. 协议转换策略调整

**原计划**：
- 手工将 TypeScript 类型转换为 Kotlin 数据类

**调整后**：
- 使用 JSON Schema 作为单一真相来源
- 自动生成 Kotlin 数据类
- 工具链：
  ```bash
  # 从 TypeScript 生成 JSON Schema
  npm run generate:schema
  
  # 从 JSON Schema 生成 Kotlin
  ./gradlew generateKotlinFromSchema
  ```

## 实施顺序建议

> **⚠️ 已调整 (2026-05-03)**：根据团队决策，先完成 notifier，再考虑 IntelliJ。跨平台共享层延后到第二阶段。

### 第一阶段：VSCode 生态完善（已完成主体落位）

> **2026-06-29 更新**：阶段 1.1 notifier 验证已完成，阶段 1.2 主扩展迁移已经从“可选”变为已执行事实。当前仓库根目录是 private npm workspace root；主扩展、notifier、共享 attention 协议、模板市场应用和 marketplace shared 包均处于 monorepo 包路径下。后续协调重点转为保持 VSCode 生态可发布，并把跨平台共享层留到第二阶段单独验证。

#### 阶段 1.1：Notifier 开发与验证（已完成）

**目标**：在最终位置开发 notifier，验证技术可行性。

**当前事实**：
```
extensions/vscode/dev-session-canvas-notifier/  # notifier companion extension package
packages/attention-protocol/                    # 主扩展与 notifier 的最小共享协议
```

**已完成任务**：
1. notifier companion 已位于 `extensions/vscode/dev-session-canvas-notifier/`。
2. `packages/attention-protocol/` 已提供主扩展与 notifier 之间的最小 attention notification 协议。
3. 正式安装关系保持为主扩展 `extensionPack` 聚合 notifier，notifier 单向 `extensionDependencies` 回补主扩展。
4. 调试链路保留 main-only debug 副本和 remote window + notifier 验收路径。

**交付物**：
- Notifier companion 完整功能和发布包路径。
- 主扩展到 notifier 的受控通知桥接。
- notifier source tests、debug launch 和 smoke 验证入口。

#### 阶段 1.2：主扩展迁移（已执行）

**前置条件**：阶段 1.1 验证通过，且团队决定完成完整 monorepo 化。

**目标**：将主扩展迁移到 `extensions/vscode/dev-session-canvas/`，并让根目录只承担 workspace 编排、根级脚本和正式文档知识库职责。

**当前事实**：
```
extensions/vscode/dev-session-canvas/           # VSCode 主扩展 package
extensions/vscode/dev-session-canvas-notifier/  # VSCode notifier package
packages/attention-protocol/                    # VSCode attention 协议
apps/template-marketplace/                      # 模板市场 Web / Worker 应用
packages/marketplace-shared/                    # 模板市场共享 schema / 纯逻辑
package.json                                    # private npm workspace root
```

**已完成任务**：
1. 主扩展 manifest、源码、资源、Marketplace README、CHANGELOG、NLS、运行时 hook 和 `.vscodeignore` 已迁入 `extensions/vscode/dev-session-canvas/`。
2. 根目录 `package.json` 已改为 private workspace root。
3. 构建、typecheck、debug、smoke、media、release 和脚本级测试入口已更新为主扩展子包路径或 staged package。
4. `ARCHITECTURE.md`、`docs/README.md`、`docs/design-docs/repository-monorepo-layout.md` 与本协调文档记录当前 monorepo 事实。

**交付物**：
- 标准 monorepo 结构。
- VSCode 扩展完整功能（含 notifier）。
- 统一文档知识库和 monorepo 拓扑图。

---

### 第二阶段：跨平台扩展（6-8 周，待第一阶段完成后启动）

#### 阶段 2.1：跨平台共享层建设（1-2 周）

**目标**：完成 Monorepo 计划的里程碑 5（延后）

1. 建立 `packages/protocol/` 三层结构
2. 建立 `packages/webview/` 共享前端
3. 实现 JSON Schema → TypeScript/Kotlin 自动生成
4. 验证 VSCode 扩展可以使用共享包（可选重构）

**交付物**：
- `packages/protocol/` 完整实现
- `packages/webview/` 完整实现
- 自动生成工具链

#### 阶段 2.2：IntelliJ 插件 PoC（1 周）

**目标**：完成 IntelliJ 计划的阶段 0

1. 在 `extensions/intellij/` 创建项目骨架
2. 配置 Gradle 依赖共享包
3. 验证 JBCefBrowser 加载共享的 React 应用
4. 验证 Kotlin 可以使用生成的协议定义

**交付物**：
- IntelliJ 插件骨架
- PoC Demo（可加载画布）
- 技术验证报告

#### 阶段 2.3：IntelliJ 插件开发（4-5 周）

**目标**：完成 IntelliJ 计划的阶段 1-3

1. 完成 IntelliJ 插件 MVP
2. 完成 Agent 集成
3. 完成 Settings 和文档
4. 发布到 JetBrains Marketplace

**交付物**：
- IntelliJ 插件完整功能
- 跨平台文档
- 两个平台同步维护

## 总工作量估算

> **⚠️ 已调整 (2026-05-03)**：分为两个独立阶段，第二阶段可选。

### 第一阶段：VSCode 生态（主体已落位）

> **2026-06-29 更新**：notifier 与主扩展迁移已经完成主体落位，剩余只按各主题分支持续维护验证和发布脚本。

| 阶段 | 状态 | 当前事实 |
|------|------|----------|
| 阶段 1.1：Notifier 开发 | 已完成 | notifier 位于 `extensions/vscode/dev-session-canvas-notifier/`，共享协议位于 `packages/attention-protocol/` |
| 阶段 1.2：主扩展迁移 | 已完成主体落位 | 主扩展位于 `extensions/vscode/dev-session-canvas/`，根目录是 private workspace root |
| **第一阶段总计** | **完成主体落位** | 后续只保留验证、发布和文档一致性维护 |

**当前决策点**：不再讨论是否保持混合结构；若要引入 IntelliJ 或跨平台共享层，应在第二阶段新计划中独立验证。

### 第二阶段：跨平台扩展（可选，待第一阶段完成后决策）

| 阶段 | 工作量 | 人力 | 时间 |
|------|--------|------|------|
| 阶段 2.1：共享层建设 | 1-2 周 | 1 人 | 1-2 周 |
| 阶段 2.2：IntelliJ PoC | 1 周 | 1 人 | 1 周 |
| 阶段 2.3：IntelliJ 开发 | 4-5 周 | 1-2 人 | 4-5 周 |
| **第二阶段总计** | **6-8 周** | **1-2 人** | **6-8 周** |

### 总计

| 场景 | 工作量 | 说明 |
|------|--------|------|
| **VSCode monorepo 主体** | 已完成主体落位 | 主扩展与 notifier 均在 `extensions/vscode/` 包路径下 |
| **+ IntelliJ** | 6-8 周（待重新评估） | 第二阶段，可选，需新验证矩阵 |

**对比原计划**：
- Monorepo 计划：未明确工作量
- IntelliJ 计划：5-7 周
- **当前事实**：
  - 阶段 1.1（notifier）：已完成主体落位。
  - 阶段 1.2（迁移）：已完成主体落位，不再保持混合结构。
  - 第二阶段（IntelliJ）：仍为可选后续阶段，需重新确认业务优先级和技术验证范围。

**关键优势**：
- notifier 与主扩展都处在明确的 `extensions/vscode/` 包路径下。
- 根目录职责收敛为 workspace、脚本和正式文档知识库。
- 跨平台共享层尚未混入 VSCode 发布主路径，避免把未验证能力写成既成事实。

## 风险与缓解

### 风险 1：共享层设计复杂度

**风险**：JSON Schema → TypeScript/Kotlin 自动生成可能遇到类型系统不兼容

**缓解**：
- 阶段 2 优先验证自动生成工具链
- 如果自动生成困难，降级为手工维护但严格测试一致性
- 保留 JSON Schema 作为单一真相来源

### 风险 2：构建工具链冲突

**风险**：npm 和 Gradle 在同一个仓库中可能产生冲突

**缓解**：
- 保持构建工具链隔离
- 根目录脚本只做编排，不强制统一工具
- 各平台保持独立的构建缓存

### 风险 3：团队技能不匹配

**风险**：同时需要 TypeScript 和 Kotlin 技能

**缓解**：
- 阶段 1-2 由熟悉 TypeScript 的人完成
- 阶段 3-4 引入 Kotlin 开发者
- 共享层设计尽量简单，降低跨语言理解成本

### 风险 4：时间线延长

**风险**：协调后总时间从 5-7 周增加到 9-14 周

**缓解**：
- 阶段 4 可以并行开发，实际日历时间不会翻倍
- 避免了未来返工的成本
- 建立了可持续的跨平台架构

## 成功标准

### 技术标准

- ✅ 单一 monorepo 包含 VSCode 和 IntelliJ 两个平台
- ✅ 共享代码复用率 > 60%（Webview 前端 + 协议定义）
- ✅ 协议定义自动生成，无手工同步
- ✅ 两个平台可以独立构建和测试
- ✅ 根目录统一脚本可以编排所有平台

### 文档标准

- ✅ 统一的文档知识库（`docs/`）
- ✅ 平台特定文档清晰分离（`docs/platforms/`）
- ✅ 文档入口页覆盖两个平台
- ✅ 架构文档清晰描述跨平台设计

### 用户标准

- ✅ VSCode 用户体验不受影响
- ✅ IntelliJ 用户获得完整功能
- ✅ 两个平台功能基本对等（核心场景）
- ✅ 两个平台同步发布

## 决策记录

- **决策 1**：采用方案 A（统一 Monorepo）
  - 理由：与 Monorepo 计划初衷一致，便于共享代码和文档
  - 日期：2026-05-03

- **决策 2**：使用 JSON Schema 作为协议定义的单一真相来源
  - 理由：避免 TypeScript 和 Kotlin 手工同步导致的不一致
  - 日期：2026-05-03

- **决策 3**：IntelliJ 计划依赖 Monorepo 重构完成
  - 理由：避免在错误的目录结构上开发，减少返工
  - 日期：2026-05-03

- **决策 4**：保持构建工具链隔离但协调
  - 理由：npm 和 Gradle 各有优势，强制统一会增加复杂度
  - 日期：2026-05-03

## 下一步行动

> **⚠️ 已调整 (2026-05-03)**：聚焦第一阶段（VSCode 生态），第二阶段延后决策。

### 立即行动

1. ✅ **已完成**：更新 Monorepo 计划文档
   - 记录 notifier 与主扩展迁移后的当前事实
   - 里程碑 5（跨平台共享层）继续标记为第二阶段
   - 保持 VSCode 生态发布主路径可验证

2. ✅ **已完成**：更新 IntelliJ 计划文档
   - 标记为低优先级/延后启动
   - 明确前置依赖（第一阶段主体已完成，但跨平台共享层未落地）

3. ✅ **已完成**：更新跨计划协调文档
   - 把旧的混合结构和阶段 1.2 可选口径改为已完成主体落位
   - 明确第二阶段不得默认复用尚未抽离的 VSCode Webview / 协议为跨平台单一真相

### 第二阶段决策点

4. **评估是否启动 IntelliJ 开发**
   - 评估 notifier 的用户反馈
   - 评估团队资源（是否有 Kotlin 开发者）
   - 评估业务优先级（Android 团队需求强度）
   - 决策：启动 or 延后

---

**文档版本**: v2.1
**最后更新**: 2026-06-29（同步 monorepo 阶段 1.2 已执行事实）
**维护者**: 待定
**状态**: ✅ VSCode 生态主体落位；IntelliJ / 跨平台共享层延后决策
