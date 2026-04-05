---
title: DevSessionCanvas 命名空间迁移
decision_status: 已选定
validation_status: 已验证
domains:
  - VSCode 集成域
  - 项目状态域
architecture_layers:
  - 宿主集成层
  - 共享模型与编排层
related_specs:
  - docs/product-specs/canvas-core-collaboration-mvp.md
related_plans:
  - docs/exec-plans/completed/dev-session-canvas-namespace-migration.md
updated_at: 2026-04-05
---

# DevSessionCanvas 命名空间迁移

## 背景

仓库的正式产品名和扩展显示名已经收口到 `DevSessionCanvas` / `Dev Session Canvas`，但运行时命名空间里仍保留大量 `opencove`。这些残留并不都属于同一种风险：有些只是资源文件名或内部常量，有些已经成为命令、配置和持久化状态的正式接口，还有一些则绑定在 VS Code 的扩展身份和视图恢复机制上。

当前需要解决的问题不是“把所有字符串全局替换”，而是在不破坏已有使用者配置和 workspace 状态的前提下，逐步把真正面向用户和脚本的接口迁移到新的正式命名上。

## 问题定义

如果继续让命令、配置和状态键暴露为 `opencove.*`，会有两个直接问题：

1. 用户看到的对外接口与正式产品名不一致，README、CONTRIBUTING、命令面板和设置示例都带着旧项目名。
2. 后续继续推进正式开发时，任何围绕命令、配置或自动化脚本的文档都要反复解释“显示名是新的，但键名还是旧的”，成本会越来越高。

但如果直接把所有 `opencove` 一次性替换掉，又会破坏兼容性：用户已有的设置键、命令调用和 workspace 状态恢复都会受到影响。

## 目标

- 把命令 ID、配置键和 workspace 状态键的正式主命名空间迁移到 `devSessionCanvas.*`。
- 保证旧 `opencove.*` 命令、旧配置键和旧状态键在升级后仍然可用。
- 把当前事实来源文档里的接口示例统一改成新键名。

## 非目标

- 本轮不迁移 OpenCove 作为灵感来源的 README 说明。
- 本轮不改写历史归档文档中的旧命名。
- 本轮不迁移 `publisher`、view/container/webview panel 这类扩展身份位。

## 候选方案

### 方案 A：全局替换为新命名

优点：

- 清理最彻底，代码中残留最少。

缺点：

- 会直接破坏现有命令脚本、用户设置和已保存的 workspace 状态。
- 对 VS Code 的 view/container/panel 恢复机制没有安全迁移路径。

### 方案 B：只保留旧命名，不再继续收口

优点：

- 风险最低，不需要兼容迁移逻辑。

缺点：

- 正式产品名和对外接口长期割裂。
- 文档、演示和开发者说明会持续暴露旧名。

### 方案 C：分层迁移，新主键生效，旧接口兼容保留

优点：

- 可以把用户真正接触到的接口收口到正式命名。
- 可以保留已有配置、脚本和状态恢复链路。
- 能把高风险的扩展身份位留到后续单独设计。

缺点：

- 需要临时维护一层兼容逻辑。
- 仓库内部仍会保留少量旧 ID，不能一次做到绝对“零残留”。

## 风险与取舍

最大的取舍在于：不是所有 `opencove` 都值得在本轮追求“完全消失”。

命令、配置和 workspace 状态键可以通过兼容逻辑安全迁移，因此应当本轮完成。相对地，view/container/publisher 这类标识要么直接关系到 VS Code 的视图贡献与恢复，要么关系到扩展身份，不具备低成本别名机制。本轮如果强行推进，只会把“命名统一”问题升级成“状态丢失”或“扩展身份变化”问题。

## 当前结论

当前选定路线是方案 C。

具体边界如下：

- 正式命令 ID 迁移到 `devSessionCanvas.*`，旧 `opencove.*` 命令继续作为兼容别名注册。
- 正式配置键迁移到 `devSessionCanvas.*`，旧 `opencove.*` 配置键继续兼容读取，但不再作为正式文档和设置示例出现。
- workspace 状态新写入统一使用 `devSessionCanvas.*`，读取时继续回退兼容旧 `opencove.*` 键。
- view/container/webview panel ID 与 `publisher` 暂不迁移，并明确登记为后续独立主题。

## 验证方法

- 运行 `npm run typecheck` 与 `npm run build`，确认命名空间迁移后类型和构建都正常。
- 检查 `package.json`，确认正式命令贡献与正式配置键都已切换到 `devSessionCanvas.*`。
- 检查 `src/extension.ts`、`src/panel/CanvasPanelManager.ts`、`src/sidebar/CanvasSidebarView.ts` 和 `src/panel/getWebviewHtml.ts`，确认旧命令和旧状态键仍有兼容入口。
- 检查 README、CONTRIBUTING 和当前设计/活计划文档，确认对外示例已切换到新键名。

当前验证结果：

- `npm run typecheck` 已通过。
- `npm run build` 已通过。
- 设计边界与文档示例已同步到当前仓库事实来源。
