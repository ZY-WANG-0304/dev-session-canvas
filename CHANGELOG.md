# Changelog

## 0.2.1 - Preview Hotfix Update

公开 `Preview` 的一轮收口修复，聚焦升级兼容说明、Marketplace 对外素材一致性，以及打包态文件活动链路补漏。

### 本版本聚焦

- 补充从 `0.1.2` 升级到 `0.2.0` 后可能沿用旧 view layout 缓存、导致侧栏 `概览` 与 `常用操作` 暂时拆成两个图标的兼容说明，并明确恢复方式
- 收口 Marketplace README / 录制素材生成链路，重新生成 Marketplace 概览截图、GIF 与 MP4，确保对外展示中的 Claude 节点真实执行，并稳定投影 `.debug/release-media-demo.md` 文件活动
- 修复 `Agent` 会话已替换、释放或删除后，迟到的文件活动事件仍可能回写旧状态的问题，减少文件投影与相关状态被残留事件覆盖的风险
- 修复 Claude 文件时间 hook 脚本 `scripts/claude-file-event-hook.cjs` 未被打包进 VSIX 的问题，确保公开发布包中的 Claude 文件活动链路与源码运行态一致

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
- 首次安装与从 `0.2.0` 升级到 `0.2.1` 都通过 `Visual Studio Marketplace` 获取；后续 `0.2.x` 更新同样通过 Marketplace 升级获取
- 若此前从 `0.1.2` 升级到 `0.2.0` 后沿用了旧的 view layout 缓存，侧栏里的 `概览` 与 `常用操作` 可能已经被拆成两个独立图标；这不表示重复安装了两个扩展，升级到 `0.2.1` 后仍可手动把两个 view 移回同一 `Dev Session Canvas` 容器，或执行 `View: Reset View Locations` 恢复默认布局
- Preview 阶段不承诺跨版本工作区状态完全兼容；如工作区包含重要画布状态，建议升级前备份或在非关键环境验证

### 回退建议

- 若 `0.2.1` 阻塞当前工作流，建议先禁用或卸载扩展
- 优先等待后续 `0.2.x` 修复版本，而非尝试手动降级
- 如需回退，请重新安装目标版本并验证工作区状态；Preview 版本之间不保证回退兼容

## 0.2.0 - Preview Canvas Collaboration Update

公开 `Preview` 的下一轮能力迭代，聚焦关系连线、文件活动投影，以及执行提醒与侧栏概览收口。

### 本版本聚焦

- 新增用户关系连线与边编辑能力，可在画布中直接表达 `Agent` / `Terminal` / `Note` 之间的分工、依赖与 handoff
- 新增文件活动视图：`Agent` 的读写文件可投影为文件节点或文件列表，支持路径展示、过滤与从画布直接打开文件
- 新增执行提醒体系：节点标题栏、小地图与侧栏概览会同步呈现 attention 状态，并支持从通知快速回到对应节点
- 收口侧栏概览、文件过滤、多根工作区语义与文件节点尺寸恢复，让 `0.2.0` 的主路径体验更完整稳定

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
- 首次安装与从 `0.1.2` 升级到 `0.2.0` 都通过 `Visual Studio Marketplace` 获取
- 后续 `0.2.x` 更新同样通过 Marketplace 升级获取
- 从 `0.1.2` 升级到 `0.2.0` 后，如果 VS Code 沿用旧的 view layout 缓存，侧栏里的 `概览` 与 `常用操作` 可能暂时被拆成两个独立图标；这不表示重复安装了两个扩展，可手动把两个 view 移回同一 `Dev Session Canvas` 容器，或执行 `View: Reset View Locations` 恢复默认布局
- Preview 阶段不承诺跨版本工作区状态完全兼容；如工作区包含重要画布状态，建议升级前备份或在非关键环境验证

### 回退建议

- 若 `0.2.0` 阻塞当前工作流，建议先禁用或卸载扩展
- 优先等待后续 `0.2.x` 修复版本，而非尝试手动降级
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
