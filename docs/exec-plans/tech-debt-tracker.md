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
| 2026-03-30 | 新建节点避碰当前依赖默认窗口尺寸估算 | 为先修复“新增节点初始重叠”的真实反馈，本轮宿主使用 `Agent` / `Terminal` / `Task` / `Note` 的默认窗口尺寸估算做矩形碰撞判断，而不是读取节点渲染后的真实边界。 | 新建节点默认摆放的精确性，尤其在后续调整节点样式、高度或字段密度后 | 当前让 Webview 提供当前视口锚点，宿主再基于统一尺寸估算做避碰；足以解决当前反馈中的初始遮挡，但不把它写成完整自动布局系统。 | 下一轮画布布局或节点尺寸模型收口时 | `src/common/protocol.ts`、`src/panel/CanvasPanelManager.ts`、`src/webview/main.tsx`、`docs/design-docs/canvas-feedback-polish.md`、`docs/exec-plans/active/canvas-feedback-polish.md` |
| 2026-03-30 | 节点删除当前不支持确认或撤销 | 为先闭合四类节点的最小删除主路径，本轮直接提供节点头部删除按钮和键盘删除，但没有确认弹窗、撤销栈或回收站。 | 误删节点后的恢复体验，尤其影响包含正文的 `Task` / `Note` 和运行中的执行型节点 | 当前通过显式选中态、输入焦点保护、危险态按钮样式和单节点删除范围降低误触风险，不把确认/撤销写成已支持。 | 下一轮画布交互增强或对象历史能力设计时 | `src/webview/main.tsx`、`src/webview/styles.css`、`docs/design-docs/canvas-node-deletion.md` |
| 2026-03-29 | 嵌入式会话后端当前只验证 Linux `script` 路线 | 为了先闭合画布内嵌执行窗口主路径，当前宿主后端使用 util-linux `script` 分配 PTY；这条路线已在 Linux 环境验证，但尚未收敛到跨平台统一方案。 | 非 Linux 平台的 `Terminal` / `Agent` 节点可用性，以及长期后端稳定性 | 当前在非 Linux 环境显式报错退化，不把未验证平台写成已支持。 | 下一轮执行会话后端平台兼容性收口时 | `src/panel/CanvasPanelManager.ts`、`docs/design-docs/embedded-terminal-runtime-window.md`、`docs/design-docs/agent-runtime-prototype.md`、`docs/exec-plans/completed/embedded-terminal-runtime-window.md`、`docs/exec-plans/completed/agent-special-terminal.md` |
| 2026-03-29 | 当前 `script` 路线不支持活跃会话运行中 resize | `script` 能在当前 Linux 环境先闭合真实 PTY 主路径，但当前实现没有独立的 PTY resize 控制通道；若把 `stty cols ... rows ...` 注入 stdin，会污染前台程序输入流。 | 活跃 `Terminal` / `Agent` 会话在节点尺寸变化后的行列同步能力 | 当前改为“首帧 fit 后再启动 shell”，并在活跃会话期间禁用运行中 resize 注入；不把未验证的运行中 resize 写成已支持。 | 下一轮执行会话控制通道收口时 | `src/panel/CanvasPanelManager.ts`、`src/webview/main.tsx`、`docs/design-docs/embedded-terminal-runtime-window.md`、`docs/design-docs/agent-runtime-prototype.md`、`docs/exec-plans/completed/agent-special-terminal.md` |
