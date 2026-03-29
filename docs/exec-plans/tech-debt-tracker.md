# 技术债追踪

本文件用于记录复杂任务完成后遗留、但当前不阻塞交付的问题。

## 记录字段

- 日期
- 主题
- 背景与触发条件
- 影响范围
- 当前临时处理
- 建议修复时机
- 关联文档或代码路径

## 技术债列表

| 日期 | 主题 | 背景与触发条件 | 影响范围 | 当前临时处理 | 建议修复时机 | 关联文档或代码路径 |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-03-29 | Agent 失败后 prompt 被清空 | 当前 Agent 节点在发送消息后立即清空本地草稿；如果宿主随后因未信任 workspace、CLI 不存在或启动失败而拒绝运行，用户需要重新输入 prompt 才能重试。 | Agent 节点失败重试体验 | 当前作为已知体验债务保留；MR 中不再作为 blocker，但需后续保证失败路径可直接重试。 | 下一轮 Agent 交互体验收口时 | `src/webview/main.tsx`、`src/panel/CanvasPanelManager.ts`、MR `!1` review follow-up |
| 2026-03-29 | Agent 未失焦草稿切换后可能丢失 | Agent 草稿当前主要在 `blur` 时写入 Webview state；如果用户在输入中直接切换标签或隐藏 Webview，未失焦内容仍可能丢失。 | Agent 节点局部输入恢复体验 | 当前文档与 MR 风险中已明确这不是已完成能力；后续需补齐更稳健的草稿持久化。 | 下一轮 Agent 会话与恢复模型收口时 | `src/webview/main.tsx`、`docs/design-docs/agent-session-surface.md`、MR `!1` review follow-up |
