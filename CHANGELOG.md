# Changelog

## 0.1.0 - Public Preview

DevSessionCanvas 首个公开 `Preview` 版本，让早期用户在 VS Code 中体验"用一张画布管理多个开发执行会话"的核心路径。

### 功能概览

- 在编辑区或面板中打开主画布
- 创建 `Agent`、`Terminal` 与 `Note` 节点
- 通过 `codex` 或 `claude` CLI 运行 `Agent` 最小链路
- 通过嵌入式终端运行画布内 `Terminal` 节点
- `Restricted Mode` 下可打开画布，执行型入口显式禁用

### 重点收口

- 主画布入口与基础恢复链路
- 基于 React Flow 的画布交互基线
- `Agent` / `Terminal` / `Note` 核心对象体验
- 修复 `Remote SSH` / `VS Code Server Node 22` 环境下 `node-pty` 兼容性导致的扩展宿主崩溃问题

### 推荐体验路径

- 在受信任工作区中体验
- 验证覆盖最充分的路径为 `Remote SSH`
- 体验 `Agent` 节点前，请先准备可用的 `codex` 或 `claude` CLI

### 已知限制

- 仍为 `Preview`，不应按稳定正式版看待
- 不支持 `Virtual Workspace`
- Linux、macOS、Windows 本地路径尚未经过严格验证
- 公开分发以 `Visual Studio Marketplace` 为目标，发布链路仍在收口中
