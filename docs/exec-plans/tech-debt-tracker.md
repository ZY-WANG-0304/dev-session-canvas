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
| 2026-03-30 | 新建节点避碰当前依赖默认窗口尺寸估算 | 为先修复“新增节点初始重叠”的真实反馈，本轮宿主使用 `Agent` / `Terminal` / `Task` / `Note` 的默认窗口尺寸估算做矩形碰撞判断，而不是读取节点渲染后的真实边界。 | 新建节点默认摆放的精确性，尤其在后续调整节点样式、高度或字段密度后 | 当前让 Webview 提供当前视口锚点，宿主再基于统一尺寸估算做避碰；足以解决当前反馈中的初始遮挡，但不把它写成完整自动布局系统。 | 下一轮画布布局或节点尺寸模型收口时 | `src/common/protocol.ts`、`src/panel/CanvasPanelManager.ts`、`src/webview/main.tsx`、`docs/design-docs/canvas-feedback-polish.md`、`docs/exec-plans/completed/canvas-feedback-polish.md` |
| 2026-03-30 | 节点删除当前不支持确认或撤销 | 为先闭合四类节点的最小删除主路径，本轮直接提供节点头部删除按钮和键盘删除，但没有确认弹窗、撤销栈或回收站。 | 误删节点后的恢复体验，尤其影响包含正文的 `Task` / `Note` 和运行中的执行型节点 | 当前通过显式选中态、输入焦点保护、危险态按钮样式和单节点删除范围降低误触风险，不把确认/撤销写成已支持。 | 下一轮画布交互增强或对象历史能力设计时 | `src/webview/main.tsx`、`src/webview/styles.css`、`docs/design-docs/canvas-node-deletion.md` |
| 2026-03-30 | `node-pty` 后端仍缺 macOS / Windows / Remote 场景人工验证 | 为了把执行会话从 Linux 原型收口到统一 PTY 路线，本轮已把宿主切到 `node-pty`，并去掉了 Linux 平台硬拦截。代码路径已接通，但当前只有 Linux 构建与 PTY smoke test 证据。 | macOS、Windows、Remote SSH / Codespaces 下的 `Terminal` / `Agent` 可用性声明 | 当前只把 Linux smoke test 与构建结果写成已完成，其余平台继续标记为“验证中”。 | 下一轮平台验证与发布前人工验收时 | `src/panel/CanvasPanelManager.ts`、`src/panel/executionSessionBridge.ts`、`src/webview/main.tsx`、`docs/design-docs/execution-session-platform-compatibility.md` |
| 2026-03-30 | Windows 下 provider CLI 命令解析仍依赖显式命令路径验证 | `Agent` 节点当前直接以配置项中的命令路径启动 `codex` / `claude`；在 Windows 上，这可能涉及 `.cmd` / `.exe` 包装与 PATH 差异。 | Windows 下 `Agent` 节点的启动成功率与默认配置体验 | 当前继续保留设置项覆盖命令路径，并在缺命令时给出更明确的提示，不把默认 PATH 解析写成已验证。 | 下一轮 Windows 人工 smoke test 或命令解析增强时 | `src/panel/CanvasPanelManager.ts`、`docs/design-docs/execution-session-platform-compatibility.md` |
| 2026-03-30 | VSIX 当前会打入超出运行时必需范围的 `node-pty` 文件 | 为了先保证扩展可打包并带上原生 PTY 运行时，本轮通过 `.vscodeignore` 允许 `node-pty` 进入 VSIX；但当前产物仍包含 `deps/`、`build/` 元数据和部分非运行时文件。 | 扩展包体积、发布工件可审查性，以及后续发布时的冗余依赖面 | 当前优先保证 VSIX 可成功生成和运行时文件可用，把“进一步收紧到最小必需集”留作后续收口。 | 下一轮发布前瘦身或引入专门打包 staging 流程时 | `.vscodeignore`、`package.json`、`scripts/build.mjs`、`docs/exec-plans/completed/execution-session-platform-compatibility.md` |
