---
title: 画布文件活动功能退役
decision_status: 已选定
validation_status: 已验证
domains: [画布交互域, 协作对象域, VSCode 集成域, 执行编排域]
architecture_layers: [宿主集成层, 画布呈现层, 共享模型与编排层, 适配与基础设施层]
related_specs: [docs/product-specs/canvas-graph-links-and-file-activity.md]
related_plans: [docs/exec-plans/completed/canvas-remove-file-nodes.md]
updated_at: 2026-11-01
---

# 画布文件活动功能退役

## 背景和取舍

用户确认自动文件节点和文件列表的实际体验价值不足，不再为 Claude 维护其文件活动采集。继续保留关闭开关仍需要维护完整功能，故选择移除整个功能域。旧文件活动数据不转换为其他对象；普通连线和其他独立文件功能继续支持。

## 正式方案

`extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts` 的 Agent 启动、恢复及关闭流程不再创建文件活动采集会话，也不向 Claude 注入专用参数或环境；移除 `src/panel/agentFileActivity.ts` 与 `scripts/runtime/claude-file-event-hook.cjs` 的专属功能及打包依赖。用户自己的 Claude hooks 不受影响。画布、侧栏、配置和消息协议不再提供自动文件节点、文件列表、文件过滤、展示设置或文件活动关系。

读取旧画布时，在单根、多根与共享 root 的存储边界清理旧文件节点、活动记录、指向这些节点的边及失效分组成员，保留其他节点、边、位置、分组和会话身份。迁移必须可重复，跨窗口同步不能使旧对象复活。新版本写回后旧活动记录无法通过降级恢复；磁盘文件不删除。保留的兼容逻辑仅负责读取和清理旧格式，不再生成文件活动对象。实现应核查 `src/common/protocol.ts`、`src/common/canvasMultiRootComposition.ts` 与 `src/panel/sharedRootCanvasStore.ts` 的实际数据流，避免依赖单一加载入口。

终端文件链接、Markdown Note 文件关联、Explorer 创建执行节点以及普通手工连线不属于退役范围。

## 验证

自动化覆盖旧画布清理、普通连线和分组保留、单根 / 多根 / 共享 root 恢复、配置及侧栏移除、Claude 启动接线、模板和打包边界。`npm run typecheck`、`npm run test:webview`（418 项）、受影响的迁移 / 多根 / 共享 root / 模板 / 侧栏 / 执行上下文回归、`npm run test:package-vsix-file-list` 和 `npm run test:smoke -- --scenario=canvas-entry/surface-sidebar` 均通过。smoke 场景最初发现侧栏摘要测试仍要求已退役的 Files 项；移除该过期期望后，真实 VS Code 1.140.0 smoke 通过。用户也在本机手动调试并确认未发现问题。

本轮没有另行启动真实 Claude CLI 文件读写专项，因此自动验证不代表重新覆盖真实 provider 的文件操作；用户的整体手动调试确认作为补充验收证据。旧活动记录在升级写回后不会保留，磁盘文件和独立的终端文件链接、Markdown Note 关联、Explorer 创建执行节点不受影响。
