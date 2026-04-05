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
updated_at: 2026-04-06
---

# DevSessionCanvas 命名空间迁移

## 背景

仓库的正式产品名和扩展显示名已经收口到 `DevSessionCanvas` / `Dev Session Canvas`。此前仓库曾短暂保留旧命名兼容层，但在正式开发阶段继续维持双命名只会放大维护成本，因此当前已进一步收口为单一正式身份。

当前需要解决的问题不是“是否保留旧兼容”，而是把运行时、扩展身份与对外接口统一到同一套正式命名上，避免继续同时维护两套身份。

## 问题定义

如果继续让命令、配置和状态键暴露为旧命名空间，会有两个直接问题：

1. 用户看到的对外接口与正式产品名不一致，README、CONTRIBUTING、命令面板和设置示例都带着旧项目名。
2. 后续继续推进正式开发时，任何围绕命令、配置或自动化脚本的文档都要反复解释“显示名是新的，但键名还是旧的”，成本会越来越高。

但如果直接把所有旧命名接口一次性替换掉，又会破坏兼容性：用户已有的设置键、命令调用和 workspace 状态恢复都会受到影响。

## 目标

- 把命令 ID、配置键、workspace 状态键、view/container/webview panel ID 统一到 `devSessionCanvas.*` 与对应新扩展身份。
- 把扩展 `publisher` 切换到新的正式标识。
- 把当前事实来源文档里的接口示例统一改成当前正式命名。

## 非目标

- 本轮不迁移 OpenCove 作为灵感来源的 README 说明。
- 本轮不改写历史归档文档中的旧命名。
- 本轮不为旧命名保留兼容读取、别名注册或状态迁移。

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

本轮最大的取舍是：不再为了平滑升级而继续保留旧命名兼容层。

这样做的直接代价是，旧命令脚本、旧设置键、旧 workspace 状态以及旧视图恢复不再自动延续；用户会经历一次明确的断点升级。但这也换来了更清晰的正式身份、更低的维护复杂度，以及不再被双命名和双视图 ID 长期拖累的后续迭代空间。

## 当前结论

当前选定路线是方案 A。

具体边界如下：

- 正式命令 ID、配置键和 workspace 状态键统一收口到 `devSessionCanvas.*`。
- 旧命名空间命令、旧配置键和旧状态键不再保留兼容逻辑。
- view/container/webview panel ID 一并迁移到新的 `devSessionCanvas` 扩展身份。
- 扩展 `publisher` 切换为新的正式标识。

## 验证方法

- 运行 `npm run typecheck` 与 `npm run build`，确认命名空间迁移后类型和构建都正常。
- 检查 `package.json`，确认正式命令贡献、正式配置键、view/container/webview panel ID 与 `publisher` 都已切换。
- 检查 `src/extension.ts`、`src/panel/CanvasPanelManager.ts`、`src/sidebar/CanvasSidebarView.ts` 和 `src/panel/getWebviewHtml.ts`，确认不再保留旧命名兼容入口。
- 检查 README、CONTRIBUTING 和当前设计/活计划文档，确认对外示例已切换到当前正式命名。

当前验证结果：

- `npm run typecheck` 已通过。
- `npm run build` 已通过。
- 设计边界与文档示例已同步到当前仓库事实来源。
