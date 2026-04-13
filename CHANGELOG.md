# Changelog

## 0.0.1 - Public Preview

这是 DevSessionCanvas 的首个公开 `Preview` 基线版本，目标是让早期用户在 VS Code 中开始体验“用一张画布管理多个开发执行会话”的主路径。

### 本版本可以做什么

- 在编辑区或面板中打开主画布
- 创建 `Agent`、`Terminal` 与 `Note` 节点
- 通过 `codex` 或 `claude` CLI 体验最小 `Agent` 运行链路
- 通过嵌入式终端体验画布内 `Terminal` 节点
- 在 `Restricted Mode` 下继续打开画布，并看到执行型入口被显式禁用

### 本版本重点收口了什么

- 主画布入口与基础恢复链路
- 基于 React Flow 的画布交互基线
- `Agent` / `Terminal` / `Note` 的核心对象体验
- `Remote SSH` / `VS Code Server Node 22` 环境下 `node-pty` 兼容性问题导致的扩展宿主崩溃风险

### 推荐体验路径

- 推荐在受信任工作区中体验
- 当前较强的验证证据主要集中在 `Remote SSH` 开发路径
- 若要体验 `Agent` 节点，请先准备可用的 `codex` 或 `claude` CLI

### 已知限制

- 当前版本仍是 `Preview`，不应按稳定正式版理解
- 当前不支持 `Virtual Workspace`
- Linux、macOS、Windows 本地路径仍未经过严格验证
- 公开分发主路径以 `Visual Studio Marketplace` 为目标，当前仍在继续收口最终发布链路
