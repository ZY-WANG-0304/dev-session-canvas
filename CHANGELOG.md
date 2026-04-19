# Changelog

## 0.1.2 - Preview Interaction And Restore Update

公开 `Preview` 的第二轮修复更新，聚焦执行节点交互、标题编辑稳定性，以及画布 reload / runtime restore 收口。

### 本版本聚焦

- 为 `Terminal` / `Agent` 节点补齐更接近原生终端的交互：支持文件拖拽插入路径、终端链接识别打开，并收口帮助提示与路径 quoting
- 修复节点标题 Enter 提交后旧值回灌，以及中文输入法确认 Enter 导致重复显示的问题
- 收口 `defaultSurface` 与 `runtimePersistence.enabled` 的 reload 语义，避免切换 `panel` / `editor` 或持久化模式后仍恢复旧 surface
- 修复 runtime restore reattach 期间 viewport 被覆盖的问题，提升 trusted / restricted 路径下的恢复一致性

### 推荐体验路径

- 在受信任工作区中使用
- 当前验证最充分的环境仍为 `Remote SSH`
- 使用 `Agent` 节点前，请确保 `codex` 或 `claude` CLI 已安装且可用

### 已知限制

- 当前仍为 `Preview`，尚非稳定正式版
- 不支持 `Virtual Workspace`
- Linux、macOS、Windows 本地环境尚未经过严格验证

### 安装与升级

- 当前公开 `Preview` 更新，扩展 ID 为 `devsessioncanvas.dev-session-canvas`
- 首次安装与从 `0.1.1` 升级到 `0.1.2` 都通过 `Visual Studio Marketplace` 获取
- Preview 阶段不承诺跨版本工作区状态完全兼容；如工作区包含重要画布状态，建议升级前备份或在非关键环境验证

### 回退建议

- 若 `0.1.2` 阻塞当前工作流，建议先禁用或卸载扩展
- 优先等待后续 `0.1.x` 修复版本，而非尝试手动降级
- 如需回退，请重新安装目标版本并验证工作区状态；Preview 版本之间不保证回退兼容

## 0.1.1 - Preview Update

公开 `Preview` 的第一轮修复更新，聚焦终端恢复、`Remote SSH` 持久化一致性和发布资产收口。

### 本版本聚焦

- 修复 Panel / Editor 标签切换与 Webview 重建后的终端画面恢复
- 修复 `Remote SSH` 多 storage slot 场景下画布恢复到旧快照的问题
- 修复 `Terminal` 高频输出期间输入和画布交互被阻塞的问题
- 收口 Marketplace 中英 README 与真实 VS Code 截图 / GIF 素材

### 推荐体验路径

- 在受信任工作区中使用
- 当前验证最充分的环境仍为 `Remote SSH`
- 使用 `Agent` 节点前，请确保 `codex` 或 `claude` CLI 已安装且可用

### 已知限制

- 当前仍为 `Preview`，尚非稳定正式版
- 不支持 `Virtual Workspace`
- Linux、macOS、Windows 本地环境尚未经过严格验证

### 安装与升级

- 当前公开 `Preview` 更新，扩展 ID 为 `devsessioncanvas.dev-session-canvas`
- 首次安装与从 `0.1.0` 升级到 `0.1.1` 都通过 `Visual Studio Marketplace` 获取
- Preview 阶段不承诺跨版本工作区状态完全兼容；如工作区包含重要画布状态，建议升级前备份或在非关键环境验证

### 回退建议

- 若 `0.1.1` 阻塞当前工作流，建议先禁用或卸载扩展
- 优先等待后续 `0.1.x` 修复版本，而非尝试手动降级
- 如需回退，请重新安装目标版本并验证工作区状态；Preview 版本之间不保证回退兼容

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
