# Changelog

## 0.1.0 - Public Preview

首个公开 Preview 版本。在 VS Code 中用一张画布同时管理多个 Agent、Terminal 与 Note 会话。

### 功能概览

- 在编辑区或面板中打开主画布
- 创建 `Agent`、`Terminal` 与 `Note` 节点
- 通过 `codex` 或 `claude` CLI 驱动 `Agent` 节点执行
- 通过嵌入式终端运行 `Terminal` 节点
- `Restricted Mode` 下仅保留画布浏览，`Agent` / `Terminal` 等执行入口自动禁用

### 本版本聚焦

- 主画布入口与会话恢复
- 基于 React Flow 的画布交互基础
- `Agent` / `Terminal` / `Note` 核心节点体验闭环
- 修复 `Remote SSH` / `VS Code Server Node 22` 下 `node-pty` 导致的 Extension Host 崩溃

### 推荐体验路径

- 在受信任工作区中使用
- 当前验证最充分的环境为 `Remote SSH`
- 使用 `Agent` 节点前，请确保 `codex` 或 `claude` CLI 已安装且可用

### 已知限制

- 当前为 `Preview`，尚非稳定正式版
- 不支持 `Virtual Workspace`
- Linux、macOS、Windows 本地环境尚未经过严格验证

### 安装与升级

- 首个公开 Preview 版本，扩展 ID 为 `devsessioncanvas.dev-session-canvas`
- 通过 `Visual Studio Marketplace` 安装；后续 `0.1.x` 更新同样通过 Marketplace 升级获取
- Preview 阶段不承诺跨版本工作区状态完全兼容；如工作区包含重要画布状态，建议升级前备份或在非关键环境验证

### 回退建议

- 若当前版本阻塞工作流，建议先禁用或卸载扩展
- 优先等待后续 `0.1.x` 修复版本，而非尝试手动降级
- 如需回退，请重新安装目标版本并验证工作区状态；Preview 版本之间不保证回退兼容
