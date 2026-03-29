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
| 2026-03-29 | 嵌入式会话后端当前只验证 Linux `script` 路线 | 为了先闭合画布内嵌执行窗口主路径，当前宿主后端使用 util-linux `script` 分配 PTY；这条路线已在 Linux 环境验证，但尚未收敛到跨平台统一方案。 | 非 Linux 平台的 `Terminal` / `Agent` 节点可用性，以及长期后端稳定性 | 当前在非 Linux 环境显式报错退化，不把未验证平台写成已支持。 | 下一轮执行会话后端平台兼容性收口时 | `src/panel/CanvasPanelManager.ts`、`docs/design-docs/embedded-terminal-runtime-window.md`、`docs/design-docs/agent-runtime-prototype.md`、`docs/exec-plans/completed/embedded-terminal-runtime-window.md`、`docs/exec-plans/completed/agent-special-terminal.md` |
| 2026-03-29 | 当前 `script` 路线不支持活跃会话运行中 resize | `script` 能在当前 Linux 环境先闭合真实 PTY 主路径，但当前实现没有独立的 PTY resize 控制通道；若把 `stty cols ... rows ...` 注入 stdin，会污染前台程序输入流。 | 活跃 `Terminal` / `Agent` 会话在节点尺寸变化后的行列同步能力 | 当前改为“首帧 fit 后再启动 shell”，并在活跃会话期间禁用运行中 resize 注入；不把未验证的运行中 resize 写成已支持。 | 下一轮执行会话控制通道收口时 | `src/panel/CanvasPanelManager.ts`、`src/webview/main.tsx`、`docs/design-docs/embedded-terminal-runtime-window.md`、`docs/design-docs/agent-runtime-prototype.md`、`docs/exec-plans/completed/agent-special-terminal.md` |
