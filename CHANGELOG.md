# Changelog

## 0.5.0 - Preview Notifier Companion Update

相对 `0.4.0`，`0.5.0` 在继续收口一轮 UI 修复和交互优化的同时，把 `Dev Session Canvas Notifier` companion 的公开发布、自动安装关系与桌面通知启用口径一并纳入正式版本范围。当前仍保持 `Preview` 口径；Windows 下使用 `Codex` 时执行节点内历史暂时无法向上翻页，仍是本版本显式保留的已知限制。

### 本版本聚焦

- 修复 Agent 启动预设与会话展示细节：统一 `默认 / Resume / YOLO / 沙盒` 与 provider 默认参数之间的冲突归一化，避免预设文案、metadata 持久化与真实启动命令彼此打架；同时把创建菜单与最近一次实际启动命令展示收紧到更可解释的状态
- 优化节点创建与文件活动交互：手动创建的新节点现在会平滑带到用户视野中心；文件活动功能默认保持关闭，显式启用后则提供更稳定的文件列表树形交互、自动文件边锚点与相关 smoke 覆盖
- 优化执行节点 terminal link 交互：补齐 multiline 路径 / 行号解析、目录 / word / search link 行为，以及 low-confidence link 的 hover / 下划线语义，使交互尽量向 VS Code 原生 Terminal 对齐
- 新增 `Dev Session Canvas Notifier` companion 的 Marketplace 发布收口，并通过双向 `extensionDependencies` 建立自动安装关系：安装主扩展会自动带上 notifier，单独安装 notifier 也会自动补齐主扩展
- 收口 `0.5.0` 发布材料：同步更新 Marketplace 文案、release notes、安装升级说明与发布手册，确保当前版本范围、升级路径和回退口径一致

### 推荐体验路径

- 在受信任工作区中使用
- `Remote SSH` 主路径已验证可用，且当前验证证据最充分
- 使用 `Agent` 节点前，请确保 `codex` 或 `claude` CLI 已安装且可用
- 若需要文件活动投影，请显式启用相关功能后再体验文件列表与自动边交互

### 已知限制

- 当前仍为 `Preview`，尚非稳定正式版
- 不支持 `Virtual Workspace`
- Windows 本地 workspace 下使用 `Codex` 时，执行节点内当前仍存在终端历史无法向上翻页的已知问题
- 侧栏 `会话历史` 当前只显示可明确归属到当前 workspace 的记录；缺少工作目录信息的旧会话会被保守跳过
- `runtimePersistence.enabled = true` 的 guarantee 仍取决于 backend 与平台组合；Linux 本地与 `Remote SSH` 在 `systemd --user` 可用时具备最强验证证据

### 安装与升级

- 当前公开 `Preview` 更新，扩展 ID 为 `devsessioncanvas.dev-session-canvas`
- 首次安装与从 `0.4.0` 升级到 `0.5.0` 都通过 `Visual Studio Marketplace` 获取；后续 `0.5.x` 更新同样通过 Marketplace 升级获取
- 安装主扩展时会自动带上 `Dev Session Canvas Notifier`；如果用户从 notifier 页面单独安装，也会自动补齐主扩展
- 若此前从 `0.1.2` 升级到 `0.2.0` 后沿用了旧的 view layout 缓存，侧栏里的 `概览` 与 `常用操作` 可能已经被拆成两个独立图标；这不表示重复安装了两个扩展，升级到 `0.5.0` 后仍可手动把两个 view 移回同一 `Dev Session Canvas` 容器，或执行 `View: Reset View Locations` 恢复默认布局
- Preview 阶段不承诺跨版本 workspace 状态完全兼容；如工作区包含重要画布状态，建议升级前备份或在非关键环境验证

### 回退建议

- 若 `0.5.0` 阻塞当前工作流，建议先禁用或卸载扩展
- 优先等待后续 `0.5.x` 修复版本，而非尝试手动降级
- 如需回退，请重新安装目标版本并验证工作区状态；Preview 版本之间不保证回退兼容

## 0.4.0 - Preview Sidebar Session Update

相对 `0.3.0`，`0.4.0` 重点补齐 VS Code 侧栏中的节点列表与工作区会话历史入口，让当前画布与最近会话都能在宿主侧栏中直接定位、检索和恢复。当前仍保持 `Preview` 口径；Windows 下使用 `Codex` 时执行节点内历史暂时无法向上翻页，仍是本版本显式保留的已知限制。

### 本版本聚焦

- 新增侧栏 `节点` 列表：显示当前画布所有非文件节点的颜色标记、标题、状态与通知提醒；点击后可直接定位到画布中的对应节点
- 新增侧栏 `会话历史` 列表：按最近更新时间展示当前 workspace 下的 `Codex` / `Claude Code` 历史会话，支持搜索并可直接恢复为新 `Agent` 节点
- 收口历史恢复与回退入口：从历史恢复时会沿用当前 provider 命令与默认启动参数，再显式附加 `resume` 参数；侧栏不可见时仍可通过命令面板里的 QuickPick 列表访问同能力
- 收口 `0.4.0` 发布材料：同步更新 Marketplace 文案、release notes、安装升级说明与发布手册，并继续显式保留 Windows 下 `Codex` 无法向上翻页的已知问题

### 推荐体验路径

- 在受信任工作区中使用
- `Remote SSH` 主路径已验证可用，且当前验证证据最充分
- 通过侧栏 `节点` 与 `会话历史` 管理当前画布与最近协作会话
- 使用 `Agent` 节点前，请确保 `codex` 或 `claude` CLI 已安装且可用

### 已知限制

- 当前仍为 `Preview`，尚非稳定正式版
- 不支持 `Virtual Workspace`
- Windows 本地 workspace 下使用 `Codex` 时，执行节点内当前仍存在终端历史无法向上翻页的已知问题
- 侧栏 `会话历史` 当前只显示可明确归属到当前 workspace 的记录；缺少工作目录信息的旧会话会被保守跳过
- `runtimePersistence.enabled = true` 的 guarantee 仍取决于 backend 与平台组合；Linux 本地与 `Remote SSH` 在 `systemd --user` 可用时具备最强验证证据

### 安装与升级

- 当前公开 `Preview` 更新，扩展 ID 为 `devsessioncanvas.dev-session-canvas`
- 首次安装与从 `0.3.0` 升级到 `0.4.0` 都通过 `Visual Studio Marketplace` 获取；后续 `0.4.x` 更新同样通过 Marketplace 升级获取
- 若此前从 `0.1.2` 升级到 `0.2.0` 后沿用了旧的 view layout 缓存，侧栏里的 `概览` 与 `常用操作` 可能已经被拆成两个独立图标；这不表示重复安装了两个扩展，升级到 `0.4.0` 后仍可手动把两个 view 移回同一 `Dev Session Canvas` 容器，或执行 `View: Reset View Locations` 恢复默认布局
- Preview 阶段不承诺跨版本 workspace 状态完全兼容；如工作区包含重要画布状态，建议升级前备份或在非关键环境验证

### 回退建议

- 若 `0.4.0` 阻塞当前工作流，建议先禁用或卸载扩展
- 优先等待后续 `0.4.x` 修复版本，而非尝试手动降级
- 如需回退，请重新安装目标版本并验证工作区状态；Preview 版本之间不保证回退兼容

## 0.3.0 - Preview Desktop Support Update

相对 `0.2.2`，`0.3.0` 重点收口 Windows 平台验证与支持，并同步把 macOS / Linux / Windows 本地主路径以及 `Remote SSH` 主路径的验证口径更新为“已验证功能可用”。当前仍保持 `Preview` 口径；Windows 下使用 `Codex` 时执行节点内历史暂时无法向上翻页，是本版本显式保留的已知限制。

### 本版本聚焦

- 完成 Windows 本地 workspace 的 `Agent`、`Terminal` 与 `Note` 主路径验证，并同步把 macOS / Linux / Windows 本地主路径及 `Remote SSH` 主路径的对外口径更新为“已验证可用”
- 收口 Windows 启动链路与命令解析兼容性：补齐 `cmd.exe` 元字符转义、批处理命令空格参数传递、CLI 自动发现与常见 `codex` 命令入口解析
- 明确 `Remote SSH` 主路径同样已验证可用，且仍是当前验证最充分的推荐环境；同时把该结论与桌面三平台验证结果同步回 README、Marketplace listing、支持矩阵与发布手册
- 收口 `0.3.0` 发布材料：统一 Marketplace 文案、release notes、安装升级说明与回退口径，并显式登记 Windows 下 `Codex` 无法向上翻页的已知问题

### 推荐体验路径

- 在受信任工作区中使用
- `Remote SSH` 主路径已验证可用，且当前验证证据最充分
- macOS、Linux、Windows 本地工作区的画布、`Agent` 与 `Terminal` 主路径已完成当前轮功能可用性验证
- 使用 `Agent` 节点前，请确保 `codex` 或 `claude` CLI 已安装且可用

### 已知限制

- 当前仍为 `Preview`，尚非稳定正式版
- 不支持 `Virtual Workspace`
- Windows 本地 workspace 下使用 `Codex` 时，执行节点内当前仍存在终端历史无法向上翻页的已知问题
- `runtimePersistence.enabled = true` 的 guarantee 仍取决于 backend 与平台组合；Linux 本地与 `Remote SSH` 在 `systemd --user` 可用时具备最强验证证据

### 安装与升级

- 当前公开 `Preview` 更新，扩展 ID 为 `devsessioncanvas.dev-session-canvas`
- 首次安装与从 `0.2.2` 升级到 `0.3.0` 都通过 `Visual Studio Marketplace` 获取；后续 `0.3.x` 更新同样通过 Marketplace 升级获取
- 若此前从 `0.1.2` 升级到 `0.2.0` 后沿用了旧的 view layout 缓存，侧栏里的 `概览` 与 `常用操作` 可能已经被拆成两个独立图标；这不表示重复安装了两个扩展，升级到 `0.3.0` 后仍可手动把两个 view 移回同一 `Dev Session Canvas` 容器，或执行 `View: Reset View Locations` 恢复默认布局
- Preview 阶段不承诺跨版本 workspace 状态完全兼容；如工作区包含重要画布状态，建议升级前备份或在非关键环境验证

### 回退建议

- 若 `0.3.0` 阻塞当前工作流，建议先禁用或卸载扩展
- 优先等待后续 `0.3.x` 修复版本，而非尝试手动降级
- 如需回退，请重新安装目标版本并验证工作区状态；Preview 版本之间不保证回退兼容

## 0.2.2 - Preview Hotfix Update

相对 `0.2.1`，`0.2.2` 主要补齐 Agent 节点的创建前启动方式、停止后恢复分流，以及相关命令解析、运行时恢复与发布链路收口。

### 本版本聚焦

- 新增 Agent 创建前启动方式分流：右键菜单与命令面板现在都支持在创建前选择 `默认 / Resume / YOLO / 沙盒 / 自定义启动`，并可为 `Codex` / `Claude Code` 分别配置默认启动参数
- 新增停止后重启分流与启动命令可见性：已停止的 Agent 会在具备可信恢复上下文时提供“恢复原会话 / 新会话”分流；节点副标题也会展示最近一次实际启动命令，便于确认当前节点的真实运行方式
- 收口 Agent 启动命令解析、Windows 路径兼容与恢复可靠性：补强自定义启动命令校验、默认参数解析、Claude / Codex resume 上下文确认，以及 fallback runtime supervisor socket 路径过长等边界问题
- 收口 `0.2.2` 发布链路：修复生产打包前未可靠清空 `dist/`、导致旧 `.map` sourcemap 可能混入 `VSIX` 的问题，补强 packaged-payload smoke 校验，修复 live runtime scrollback smoke 的换行伪失败，并重新生成 Marketplace 概览截图、GIF 与 MP4

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
- 首次安装与从 `0.2.1` 升级到 `0.2.2` 将继续通过 `Visual Studio Marketplace` 获取；后续 `0.2.x` 更新同样通过 Marketplace 升级获取
- 若此前从 `0.1.2` 升级到 `0.2.0` 后沿用了旧的 view layout 缓存，侧栏里的 `概览` 与 `常用操作` 可能已经被拆成两个独立图标；这不表示重复安装了两个扩展，升级到 `0.2.2` 后仍可手动把两个 view 移回同一 `Dev Session Canvas` 容器，或执行 `View: Reset View Locations` 恢复默认布局
- Preview 阶段不承诺跨版本工作区状态完全兼容；如工作区包含重要画布状态，建议升级前备份或在非关键环境验证

### 回退建议

- 若 `0.2.2` 阻塞当前工作流，建议先禁用或卸载扩展
- 优先等待后续 `0.2.x` 修复版本，而非尝试手动降级
- 如需回退，请重新安装目标版本并验证工作区状态；Preview 版本之间不保证回退兼容

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
