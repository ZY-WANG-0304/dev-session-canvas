# Changelog

## 0.15.2 - Preview Notification Controls and Claude Ctrl-Z Patch

相对 `0.15.1`，`0.15.2` 是同一 `0.15.x` 公开 `Preview` 线内的通知控制与 Agent 可靠性补丁，重点收口执行节点 attention signal allow-list、Codex 最终失败文本提醒、Claude Agent `Ctrl-Z` / `fg` 误导状态处理，以及画布外部链接打开方式配置。它保留 `0.15.1` 的画布导航与 multi-root 可靠性补丁、`0.15.0` 的 Claude Code Agent `Fork`、文件活动自动对象 owner-derived 分组、Panel Webview lifecycle 诊断闭环、publish tag 发布输入固定流程、GitHub Release assets 镜像、双市场发布元数据、安装拓扑和 Preview 支持边界。

### 本版本聚焦

- 版本号从 `0.15.1` bump 到 `0.15.2`，主扩展与 `Dev Session Canvas Notifier` 继续保持同版本发布
- 新增 `devSessionCanvas.notifications.enabledAttentionSignals` allow-list，可分别控制 `BEL`、`OSC 9`、`OSC 777`、已运行 Agent 异常退出和 Codex 文本异常是否生成画布 attention；设置为空数组时不会设置节点提醒、Minimap 闪烁或外部通知桥接
- Codex 文本异常提醒继续保持显式 opt-in：只有 `devSessionCanvas.notifications.agentAbnormalOutputTextNotifications=codex` 且 `codexAbnormalOutputText` 未被 allow-list 禁用时才生效
- 收紧 Codex 最终失败文本识别：方块标记的 `Internal server error` 与尾部 `stream disconnected before completion: stream closed before response.completed` 会触发补充提醒，`Reconnecting... n/m` 下方树形缩进的 stream-disconnected 暂态输出不会误触发
- Claude Agent 节点不再把 Claude Code 的 `Ctrl-Z` / `fg` 文案当成可恢复生命周期；Webview、宿主和 runtime supervisor 写入路径都会阻断 Claude Agent `Ctrl-Z`，并提示使用停止、重启或 Fork
- 旧版本遗留的 `suspended` Agent snapshot 仍可渲染，但不再暴露“恢复 / 恢复中”入口，也不会继续显示旧挂起态 Fork 动作，避免把不可交互状态误写成可恢复状态
- 新增 `devSessionCanvas.canvas.linkOpenMode`，可选择画布内外部链接默认在 VS Code editor 预览打开，或交给系统外部浏览器 / 应用；默认预览模式会先解析 localhost / loopback 开发服务链接，避免远程场景把服务地址误指向客户端本机
- 发布流程继续由 `publish/vX.Y.Z` 固定输入，并把同一批主扩展 / notifier VSIX 与 release manifest 镜像到对应 GitHub Release assets；该入口只是 marketplace 暂时不可用时的手动安装兜底，不替代 Visual Studio Marketplace / Open VSX 发布验证
- 不改变扩展身份、最低 VS Code 版本、companion 自动安装关系、通知桥接默认值、Open VSX 同版本同步策略或 Preview 支持边界

### 安装与升级

- 当前公开 `Preview` 更新，扩展 ID 为 `devsessioncanvas.dev-session-canvas`
- 当前最低 VS Code 版本要求为 `1.80.0` 或更高版本
- 首次安装与从 `0.15.1` 升级到 `0.15.2` 的目标仍是通过当前宿主配置的公开扩展市场获取；Open VSX 侧已可公开查询，官方 VS Code 的 `Visual Studio Marketplace` 路径只有在 release-day visibility check 确认主扩展与 notifier 均公开可见后才对外宣称可用
- 安装主扩展时会继续自动带上 `Dev Session Canvas Notifier`；本轮 notifier 版本号与主扩展对齐到 `0.15.2`，不引入新的通知投递行为变更
- 若此前显式配置过 `devSessionCanvas.notifications.attentionSignalBridge`、`devSessionCanvas.notifications.enabledAttentionSignals`、`devSessionCanvas.notifications.strongTerminalAttentionReminder` 或 `devSessionCanvas.notifications.agentAbnormalOutputTextNotifications`，升级到 `0.15.2` 后会继续沿用该明确选择；未配置 `enabledAttentionSignals` 时使用本轮默认 allow-list
- Preview 阶段不承诺跨版本 workspace 状态完全兼容；如工作区包含重要画布状态，建议升级前备份或在非关键环境验证

### 回退建议

- 若 `0.15.2` 阻塞当前工作流，建议先禁用或卸载扩展
- 优先等待后续更高的 `0.15.x` 修复版本，而非尝试手动降级
- 如需回退，请重新安装目标版本并验证工作区状态；Preview 版本之间不保证回退兼容

## 0.15.1 - Preview Canvas Navigation and Multi-Root Patch

相对 `0.15.0`，`0.15.1` 是同一 `0.15.x` 公开 `Preview` 线内的画布导航与可靠性补丁，重点收口分组标题可读性、分组双击聚焦、`Add Folder to Workspace` 新增 root section 的就近放置与聚焦、多根通知标题 root 标识，以及执行性能诊断插桩。它保留 `0.15.0` 的 Claude Code Agent `Fork`、文件活动自动对象 owner-derived 分组、Panel Webview lifecycle 诊断闭环、publish tag 发布输入固定流程、双市场发布元数据、安装拓扑和 Preview 支持边界。

### 本版本聚焦

- 版本号从 `0.15.0` bump 到 `0.15.1`，主扩展与 `Dev Session Canvas Notifier` 继续保持同版本发布
- 分组标题溢出时补齐 hover tooltip，并保留 workspace-root 系统分组的 root 路径 tooltip，避免压缩标题后丢失 root 识别信息
- 支持双击分组标题 tab 或未被节点覆盖的分组 body 空白区，将已有分组用缩放平移动画聚焦到当前视口；标题输入框、toolbar、resize 控制点等交互控件继续保留原语义
- 修正分组双击聚焦过程中可能提交无意义拖拽 / resize 的问题，避免导航动作被误写成分组布局变更
- 在 VS Code `Add Folder to Workspace` 新增 root 后，系统 root section 会以当前画布可见中心为锚点选择最近的不重叠位置，并通过动画进入视野；连续 Add Folder 会使用动画后的可见中心，Panel Webview frame 刷新后也会重放短窗口内的聚焦意图
- 多根 workspace 的系统通知标题补充 root 标识，让同一窗口内多个 root 的 Agent / Terminal attention 通知更容易区分来源
- 补充执行性能诊断插桩，覆盖 Host / Webview 的 output enqueue、drain、`xterm.write`、postMessage 和 input write 路径；宿主诊断 dump 可用于定位多 Agent 卡顿现场的瓶颈位置
- 开发调试任务在新 worktree 中会先自举依赖，降低新 worktree 直接启动调试配置时的本地环境误报
- 不改变扩展身份、最低 VS Code 版本、companion 自动安装关系、通知桥接默认值、Open VSX 同版本同步策略或 Preview 支持边界

### 安装与升级

- 当前公开 `Preview` 更新，扩展 ID 为 `devsessioncanvas.dev-session-canvas`
- 当前最低 VS Code 版本要求为 `1.80.0` 或更高版本
- 首次安装与从 `0.15.0` 升级到 `0.15.1` 都通过当前宿主配置的公开扩展市场获取；官方 VS Code 使用 `Visual Studio Marketplace`，Open VSX 兼容宿主使用 `Open VSX`
- 安装主扩展时会继续自动带上 `Dev Session Canvas Notifier`；本轮 notifier 版本号与主扩展对齐到 `0.15.1`，不引入新的通知投递行为变更
- 若此前显式配置过 `devSessionCanvas.notifications.attentionSignalBridge`、`devSessionCanvas.notifications.strongTerminalAttentionReminder` 或 `devSessionCanvas.notifications.agentAbnormalOutputTextNotifications`，升级到 `0.15.1` 后会继续沿用该明确选择
- Preview 阶段不承诺跨版本 workspace 状态完全兼容；如工作区包含重要画布状态，建议升级前备份或在非关键环境验证

### 回退建议

- 若 `0.15.1` 阻塞当前工作流，建议先禁用或卸载扩展
- 优先等待后续更高的 `0.15.x` 修复版本，而非尝试手动降级
- 如需回退，请重新安装目标版本并验证工作区状态；Preview 版本之间不保证回退兼容

## 0.15.0 - Preview Agent Fork and Release Automation Update

相对 `0.14.1`，`0.15.0` 是一轮新的公开 `Preview` 里程碑更新，重点补齐 Claude Code Agent `Fork`、文件活动自动对象分组归属、Panel Webview lifecycle 诊断闭环，以及基于临时 `publish/vX.Y.Z` tag 的发布输入固定流程。它保留 `0.14.1` 的 Explorer Markdown 关联 Note、创建入口 surface 复用、分组 body 拖动画板、multi-root / 双窗口 shared live runtime 恢复验证、双市场发布元数据、安装拓扑和 Preview 支持边界。

### 本版本聚焦

- 版本号从 `0.14.1` bump 到 `0.15.0`，主扩展与 `Dev Session Canvas Notifier` 继续保持同版本发布
- 对持有可信 Claude Code session id 的 Agent 节点新增 `Fork` 动作：点击后创建新的 Claude Code Agent 节点，并用 `claude --resume <session-id> --fork-session` 立即启动；来源节点保持不变，新节点通过标题弱提示来源，并自动创建一条普通可编辑 `user` 边
- `Fork` 第一版只面向 Claude Code；`Codex`、非 Claude provider、未持有可信 Claude session id 或未受信任 workspace 不会误触发 fork 启动
- 文件活动自动 `file` / `file-list` 节点现在按 owner Agent 推导分组归属：单 owner 跟随该 Agent 的最内层分组，多 owner 使用最近公共父分组，multi-root 下保持 root 内隔离；用户拖动自动文件对象只改变位置，不改写 owner-derived 分组事实
- 修正文件活动自动对象在多选拖拽后的宿主收口，避免拖拽结果把自动文件对象落到与 owner Agent 不一致的分组
- 对齐 multi-root workspace-root section 与普通分组标题在缩放下的宽度压缩和可读尺寸规则，低倍率概览和放大场景都不再把 root 分组标题异常挤出边界
- 加固 Panel Webview lifecycle 诊断闭环：Host 侧区分当前 surface 对象和实际可用 message target frame，支持同 Webview frame ready 重新绑定；`Dev Session Canvas: 落盘当前宿主诊断` 会写出 lifecycle 聚合摘要，并新增 `npm run diagnose:webview-lifecycle` 离线分析入口
- 发布流程升级为临时 `publish/vX.Y.Z` tag 固定 release input，发布脚本在双市场主扩展 / notifier 验证通过后再创建正式 `vX.Y.Z` tag，并输出 release manifest 作为 Actions artifact / 发布证据
- 不改变扩展身份、最低 VS Code 版本、companion 自动安装关系、通知桥接默认值、Open VSX 同版本同步策略或 Preview 支持边界

### 安装与升级

- 当前公开 `Preview` 更新，扩展 ID 为 `devsessioncanvas.dev-session-canvas`
- 当前最低 VS Code 版本要求为 `1.80.0` 或更高版本
- 首次安装与从 `0.14.1` 升级到 `0.15.0` 都通过当前宿主配置的公开扩展市场获取；官方 VS Code 使用 `Visual Studio Marketplace`，Open VSX 兼容宿主使用 `Open VSX`
- 安装主扩展时会继续自动带上 `Dev Session Canvas Notifier`；本轮 notifier 版本号与主扩展对齐到 `0.15.0`，不引入新的通知投递行为变更
- 若此前显式配置过 `devSessionCanvas.notifications.attentionSignalBridge`、`devSessionCanvas.notifications.strongTerminalAttentionReminder` 或 `devSessionCanvas.notifications.agentAbnormalOutputTextNotifications`，升级到 `0.15.0` 后会继续沿用该明确选择
- Preview 阶段不承诺跨版本 workspace 状态完全兼容；如工作区包含重要画布状态，建议升级前备份或在非关键环境验证

### 回退建议

- 若 `0.15.0` 阻塞当前工作流，建议先禁用或卸载扩展
- 优先等待后续更高的 `0.15.x` 修复版本，而非尝试手动降级
- 如需回退，请重新安装目标版本并验证工作区状态；Preview 版本之间不保证回退兼容

## 0.14.1 - Preview Markdown Note Shortcut and Shared Runtime Patch

相对 `0.14.0`，`0.14.1` 是同一 `0.14.x` 公开 `Preview` 线内的能力与可靠性补丁，重点补齐 File Explorer Markdown 文件右键创建关联 `Note`、创建类入口复用已打开 Canvas surface、分组 body 空白区拖动画板，以及 multi-root / 双窗口 shared live runtime 恢复验证与硬化。它保留 `0.14.0` 的空间级 fit view、初始自动 fit、动态最小缩放、右下角 MiniMap、workspace-root section 可见性、双市场发布元数据、安装拓扑和 Preview 支持边界。

### 本版本聚焦

- 版本号从 `0.14.0` bump 到 `0.14.1`，主扩展与 `Dev Session Canvas Notifier` 继续保持同版本发布
- 新增 File Explorer Markdown 文件右键入口：对 `.md` / `.markdown` 文件显示 `Dev Session Canvas: 在 Canvas 中创建关联 Note`，并复用现有关联 Markdown Note 的读取、去重确认、创建、聚焦、多根归属和持久化模型
- Host 侧会二次校验 Explorer 资源的 `file` scheme、Markdown 扩展名、文件存在性和普通文件类型；非 Markdown、目录、缺失文件或非本地文件不会被静默创建为关联 Note
- 创建类入口优先复用当前窗口已打开的 Canvas surface：普通创建节点、Explorer 创建 `Terminal` / `Agent`、Explorer Markdown 创建关联 Note、创建分组，以及模板应用 / 重置不再因为 `defaultSurface` 配置而意外打开另一个承载面
- 修复分组 body 空白区左键拖动会移动分组的问题；现在 body 空白区与画布空白区一致用于平移画板，分组移动继续通过标题 tab 与可命中边框完成
- 强化 multi-root 与多 VS Code 窗口共享 live runtime 的恢复路径：runtime binding 继续以 `runtimeBackend + runtimeStoragePath + runtimeSessionId + executionKind` 为权威，双窗口 output 多播、双向 input、Terminal resize last-writer-wins、第二窗口 stop / delete 后第一窗口收到非 live 终态已有真实 VS Code smoke 覆盖
- Marketplace / README 支持入口补充微信交流群二维码；二维码通过 README 资源改写引用，继续排除出 VSIX payload
- 补充 Explorer Markdown Note、surface 复用、分组 body 拖动画板、multi-root / storage slot / two-window shared runtime 的产品规格、设计记录和自动化验证
- 不改变扩展身份、最低 VS Code 版本、companion 自动安装关系、通知桥接默认值、Open VSX 同版本同步策略或 Preview 支持边界

### 安装与升级

- 当前公开 `Preview` 更新，扩展 ID 为 `devsessioncanvas.dev-session-canvas`
- 当前最低 VS Code 版本要求为 `1.80.0` 或更高版本
- 首次安装与从 `0.14.0` 升级到 `0.14.1` 都通过当前宿主配置的公开扩展市场获取；官方 VS Code 使用 `Visual Studio Marketplace`，Open VSX 兼容宿主使用 `Open VSX`
- 安装主扩展时会继续自动带上 `Dev Session Canvas Notifier`；本轮 notifier 版本号与主扩展对齐到 `0.14.1`，不引入新的通知投递行为变更
- 若此前显式配置过 `devSessionCanvas.notifications.attentionSignalBridge`、`devSessionCanvas.notifications.strongTerminalAttentionReminder` 或 `devSessionCanvas.notifications.agentAbnormalOutputTextNotifications`，升级到 `0.14.1` 后会继续沿用该明确选择
- Preview 阶段不承诺跨版本 workspace 状态完全兼容；如工作区包含重要画布状态，建议升级前备份或在非关键环境验证

### 回退建议

- 若 `0.14.1` 阻塞当前工作流，建议先禁用或卸载扩展
- 优先等待后续更高的 `0.14.x` 修复版本，而非尝试手动降级
- 如需回退，请重新安装目标版本并验证工作区状态；Preview 版本之间不保证回退兼容

## 0.14.0 - Preview Spatial Navigation and MiniMap Update

相对 `0.13.0`，`0.14.0` 是一轮新的公开 `Preview` 里程碑更新，重点把画布全局导航从“只理解节点”升级为“理解完整空间对象”：普通用户分组、空分组和 multi-root workspace 的系统 root section 都会参与全局 fit view、初始自动 fit、动态最小缩放与右下角 MiniMap。它保留 `0.13.0` 的 VS Code multi-root workspace 组合画布、root-local 状态共享、跨 root 连线拒绝、文件活动命名空间、双市场发布元数据、安装拓扑和 Preview 支持边界。

### 本版本聚焦

- 版本号从 `0.13.0` bump 到 `0.14.0`，主扩展与 `Dev Session Canvas Notifier` 继续保持同版本发布
- 全局 fit view、初始自动 fit、动态最小缩放和右下角 MiniMap 统一使用画布空间边界，默认纳入节点、普通用户分组和系统 workspace root section
- 在 multi-root workspace 中，即使某个 root section 为空，或 root section 明显大于内部节点，点击 fit view 也会把所有 root section 纳入视口
- 右下角 MiniMap 改为自有 SVG MiniMap，显示 workspace root section、普通用户分组与节点的相对布局；workspace root section 使用更强的虚线系统边界，普通用户分组沿用主画布 panel border token，节点 attention 仍保持最高视觉优先级
- MiniMap 拖拽与滚轮导航会持久化 viewport 和 visible center；滚轮缩放遵循动态 fit view 最小倍率，不再被旧的舒适编辑下限卡住
- 修复停止后的 Agent 节点在紧凑标题栏里显示 `新建` / `恢复` 重启动作时可能挤出 `删除` 按钮的问题；重启动作现在会在紧凑 chrome 内先换行收缩
- 补充空间边界 fit view、MiniMap 分组 / root section 可见性、MiniMap 视口持久化和 Agent 重启动作紧凑布局的 Playwright 回归
- 不改变扩展身份、最低 VS Code 版本、companion 自动安装关系、通知桥接默认值、Open VSX 同版本同步策略或 Preview 支持边界

### 安装与升级

- 当前公开 `Preview` 更新，扩展 ID 为 `devsessioncanvas.dev-session-canvas`
- 当前最低 VS Code 版本要求为 `1.80.0` 或更高版本
- 首次安装与从 `0.13.0` 升级到 `0.14.0` 都通过当前宿主配置的公开扩展市场获取；官方 VS Code 使用 `Visual Studio Marketplace`，Open VSX 兼容宿主使用 `Open VSX`
- 安装主扩展时会继续自动带上 `Dev Session Canvas Notifier`；本轮 notifier 版本号与主扩展对齐到 `0.14.0`，不引入新的通知投递行为变更
- 若此前显式配置过 `devSessionCanvas.notifications.attentionSignalBridge`、`devSessionCanvas.notifications.strongTerminalAttentionReminder` 或 `devSessionCanvas.notifications.agentAbnormalOutputTextNotifications`，升级到 `0.14.0` 后会继续沿用该明确选择
- Preview 阶段不承诺跨版本 workspace 状态完全兼容；如工作区包含重要画布状态，建议升级前备份或在非关键环境验证

### 回退建议

- 若 `0.14.0` 阻塞当前工作流，建议先禁用或卸载扩展
- 优先等待后续更高的 `0.14.x` 修复版本，而非尝试手动降级
- 如需回退，请重新安装目标版本并验证工作区状态；Preview 版本之间不保证回退兼容

## 0.13.0 - Preview Multi-Root Workspace Canvas Update

相对 `0.12.0`，`0.13.0` 是一轮新的公开 `Preview` 里程碑更新，重点把 VS Code multi-root workspace 中的多个 workspace folder 组合到同一张画布中，并让单根与多根打开方式共享同一份 root-local 画布内容。它保留 `0.12.0` 的 File Explorer 绑定 cwd 创建执行节点、Panel Webview lifecycle 串线修复、执行目录可见反馈、画布节点 padding 收口，以及 `0.11.0` 的画布分组、双市场发布元数据、安装拓扑和 Preview 支持边界。

### 本版本聚焦

- 版本号从 `0.12.0` bump 到 `0.13.0`，主扩展与 `Dev Session Canvas Notifier` 继续保持同版本发布
- 在 VS Code multi-root workspace 中为每个 workspace folder 生成系统级 root section，并把各 root 的 root-local 画布状态组合成同一张画布；单独打开某个 root 时仍只显示该 root 自己的画布
- root section 可以移动、resize，并可作为整体被外层普通分组包含；系统 root section 不允许删除、取消分组或重命名，移动 root section 只写入 multi-root overlay，不改写单根 root-local 节点坐标
- 在 multi-root 组合视图中移动 root 内对象、创建 `Note` / `Agent` / `Terminal`、应用模板或拖入关联 Markdown Note，会按目标 root 写回对应 root-local 状态；执行节点真实 cwd 仍由 `metadata.cwd` 决定，不因拖到其他 root section 而静默改写
- 节点、用户分组、连线、文件活动自动节点、file-activity edge 和 suppression id 在组合视图中按 root 命名空间隔离，避免不同 root 下同名对象或自动 file artifact 冲突
- Webview 与 Host 双侧拒绝跨 root 创建或重连连线，避免生成只能在当前会话临时可见、无法拆回 root-local 或 overlay 的状态
- multi-root 组合视图不重新连接 live runtime，只展示历史态；持久化时保留 root-local snapshot 中的 reattach 信号，用户单独打开所属 root 后仍可走 root-local live runtime 恢复路径
- 修复发布前发现的 Panel / Editor Webview dispose 后仍读取已释放 `webview` 对象的问题，surface dispose cleanup 改用 attach 时捕获的 Webview 引用，并允许同 generation 的新 frameId ready 消息提升当前活跃 frame，避免 VS Code smoke 在 surface 切换时命中 `Webview is disposed`
- 补齐关联 Markdown Note 读取期间文件内容变化的 re-stat / retry 保护，降低读取中途内容 revision 改变造成的 stale content 风险
- 补充 multi-root composition、root section 分组策略、跨 root edge 拒绝、文件活动命名空间、suppression 往返、runtime skip 保守持久化、模板、Markdown drop、执行上下文、协议、Panel lifecycle 和 Webview 回归
- 不改变扩展身份、最低 VS Code 版本、companion 自动安装关系、通知桥接默认值、Open VSX 同版本同步策略或 Preview 支持边界

### 安装与升级

- 当前公开 `Preview` 更新，扩展 ID 为 `devsessioncanvas.dev-session-canvas`
- 当前最低 VS Code 版本要求为 `1.80.0` 或更高版本
- 首次安装与从 `0.12.0` 升级到 `0.13.0` 都通过当前宿主配置的公开扩展市场获取；官方 VS Code 使用 `Visual Studio Marketplace`，Open VSX 兼容宿主使用 `Open VSX`
- 安装主扩展时会继续自动带上 `Dev Session Canvas Notifier`；本轮 notifier 版本号与主扩展对齐到 `0.13.0`，不引入新的通知投递行为变更
- 若此前显式配置过 `devSessionCanvas.notifications.attentionSignalBridge`、`devSessionCanvas.notifications.strongTerminalAttentionReminder` 或 `devSessionCanvas.notifications.agentAbnormalOutputTextNotifications`，升级到 `0.13.0` 后会继续沿用该明确选择
- Preview 阶段不承诺跨版本 workspace 状态完全兼容；如工作区包含重要画布状态，建议升级前备份或在非关键环境验证

### 回退建议

- 若 `0.13.0` 阻塞当前工作流，建议先禁用或卸载扩展
- 优先等待后续更高的 `0.13.x` 修复版本，而非尝试手动降级
- 如需回退，请重新安装目标版本并验证工作区状态；Preview 版本之间不保证回退兼容

## 0.12.0 - Preview Explorer Execution Context Update

相对 `0.11.0`，`0.12.0` 是一轮新的公开 `Preview` 里程碑更新，重点把 VS Code File Explorer 中已经选定的目录或文件上下文带入画布执行节点，并修复 Panel Webview 恢复时可能出现的空画布串线问题。它保留 `0.11.0` 的画布分组、分组树侧栏、分组模板保存 / 应用、受限创建入口解释，以及既有生产 Webview Terminal TUI 输入热修复、Agent 异常提醒、Note Markdown 源码定位 / 可恢复草稿、双市场发布元数据、安装拓扑和 Preview 支持边界。

### 本版本聚焦

- 版本号从 `0.11.0` bump 到 `0.12.0`，主扩展与 `Dev Session Canvas Notifier` 继续保持同版本发布
- 新增 File Explorer 资源右键入口：workspace 内目录可直接在 Canvas 中创建 `Terminal` 或 `Agent`，普通文件会使用其父目录作为执行 cwd；非 `file` scheme、workspace 外资源或不可用目录会被拒绝并给出明确反馈
- Explorer 创建的执行节点会把目标 cwd 写入节点 metadata；首次启动、停止后重启 / 新建 / resume、runtime supervisor、Agent CLI resolver、shell 环境探测、执行诊断和终端链接上下文都使用节点 cwd，不静默回退到 workspace 根目录
- Agent 节点标题副标题与侧栏 `Nodes` 第二行会显示执行目录短标签；hover 保留完整 cwd 与启动命令；目录标签追加尾缀并保留 cwd 来源分隔符风格，Terminal 标题仍只展示 shell path
- Panel Webview 引入 lifecycle identity、frameId 与 bootstrap ack，Host 侧把 ready、bootstrap、probe 和 DOM action 绑定到实际完成启动的 Webview frame，避免 VS Code Panel restore 双 attach 后旧 frame ready 串到新 frame、导致画布背景可见但节点不显示
- 统一画布节点正文 padding、执行 runtime frame padding 与分组成员 inset，让 `Agent`、`Terminal`、`File`、`File List`、fallback card 和分组 body 的视觉节奏保持一致
- 补充 Explorer cwd、执行上下文、workspace-relative path、协议、manifest、侧栏、Panel lifecycle、VS Code smoke 和 Playwright Webview 回归，覆盖 cwd 创建、cwd 可见投影、启动诊断、shell path 基准、Webview lifecycle stale 防护和分组 / padding 兼容路径
- 不改变扩展身份、最低 VS Code 版本、companion 自动安装关系、通知桥接默认值、Open VSX 同版本同步策略或 Preview 支持边界

### 安装与升级

- 当前公开 `Preview` 更新，扩展 ID 为 `devsessioncanvas.dev-session-canvas`
- 当前最低 VS Code 版本要求为 `1.80.0` 或更高版本
- 首次安装与从 `0.11.0` 升级到 `0.12.0` 都通过当前宿主配置的公开扩展市场获取；官方 VS Code 使用 `Visual Studio Marketplace`，Open VSX 兼容宿主使用 `Open VSX`
- 安装主扩展时会继续自动带上 `Dev Session Canvas Notifier`；本轮 notifier 版本号与主扩展对齐到 `0.12.0`，不引入新的通知投递行为变更
- 若此前显式配置过 `devSessionCanvas.notifications.attentionSignalBridge`、`devSessionCanvas.notifications.strongTerminalAttentionReminder` 或 `devSessionCanvas.notifications.agentAbnormalOutputTextNotifications`，升级到 `0.12.0` 后会继续沿用该明确选择
- Preview 阶段不承诺跨版本 workspace 状态完全兼容；如工作区包含重要画布状态，建议升级前备份或在非关键环境验证

### 回退建议

- 若 `0.12.0` 阻塞当前工作流，建议先禁用或卸载扩展
- 优先等待后续更高的 `0.12.x` 修复版本，而非尝试手动降级
- 如需回退，请重新安装目标版本并验证工作区状态；Preview 版本之间不保证回退兼容

## 0.11.0 - Preview Canvas Groups Update

相对 `0.10.7`，`0.11.0` 是一轮新的公开 `Preview` 里程碑更新，重点把画布从单纯摆放 `Agent` / `Terminal` / `Note` 节点，推进到可用分组组织多会话工作区。它保留 `0.10.7` 的生产 Webview Terminal TUI 输入热修复、`0.10.6` 的 Agent 异常提醒、`0.10.5` 的 Note Markdown 源码定位 / 可恢复草稿修复、`0.10.4` 的执行终端链接刷新性能修复、双市场发布元数据、安装拓扑和 Preview 支持边界。

### 本版本聚焦

- 版本号从 `0.10.7` bump 到 `0.11.0`，主扩展与 `Dev Session Canvas Notifier` 继续保持同版本发布
- 新增画布分组对象，可通过空白区右键或命令面板创建空分组，也可按住 Ctrl / Cmd 多选同一父级下的节点或分组后从选中项创建分组
- 分组支持命名、移动、取消分组、删除空分组、删除非空分组确认、嵌套分组、成员随组移动、拖入 / 拖出、8 向 resize 和靠近画布边缘时的自动平移
- 分组采用 VS Code Panel 风格视觉，body 背景位于普通节点下方，foreground 交互 chrome 保持在 React Flow renderer 内，避免放大画布时触发外层 Webview 滚动条
- 侧栏 `Nodes` 列表默认按分组树展示，并通过原生 view title `...` 菜单在分组视图和平铺视图之间切换
- 右键创建入口在受限状态下保持可见，并通过宿主返回具体不可用原因，避免用户误以为 `Terminal` / `Agent` 类型丢失
- 模板保存与应用会保留兼容节点的分组结构，并在应用时重新映射节点与分组身份；外部模板的越界或循环分组引用会被拒绝或兜底切断
- 补充分组协议、宿主几何收口、模板、manifest、VS Code smoke 和 Playwright Webview 回归，覆盖分组创建、选择、嵌套、resize、拖动、侧栏视图和创建入口受限解释
- 不改变扩展身份、最低 VS Code 版本、companion 自动安装关系、通知桥接默认值、Open VSX 同版本同步策略或 Preview 支持边界

### 安装与升级

- 当前公开 `Preview` 更新，扩展 ID 为 `devsessioncanvas.dev-session-canvas`
- 当前最低 VS Code 版本要求为 `1.80.0` 或更高版本
- 首次安装与从 `0.10.7` 升级到 `0.11.0` 都通过当前宿主配置的公开扩展市场获取；官方 VS Code 使用 `Visual Studio Marketplace`，Open VSX 兼容宿主使用 `Open VSX`
- 安装主扩展时会继续自动带上 `Dev Session Canvas Notifier`；本轮 notifier 版本号与主扩展对齐到 `0.11.0`，不引入新的通知投递行为变更
- 若此前显式配置过 `devSessionCanvas.notifications.attentionSignalBridge`、`devSessionCanvas.notifications.strongTerminalAttentionReminder` 或 `devSessionCanvas.notifications.agentAbnormalOutputTextNotifications`，升级到 `0.11.0` 后会继续沿用该明确选择
- Preview 阶段不承诺跨版本 workspace 状态完全兼容；如工作区包含重要画布状态，建议升级前备份或在非关键环境验证

### 回退建议

- 若 `0.11.0` 阻塞当前工作流，建议先禁用或卸载扩展
- 优先等待后续更高的 `0.11.x` 修复版本，而非尝试手动降级
- 如需回退，请重新安装目标版本并验证工作区状态；Preview 版本之间不保证回退兼容

## 0.10.7 - Preview Terminal TUI Input Hotfix

相对 `0.10.6`，`0.10.7` 是同一 `0.10.x` 公开 `Preview` 线内的 Terminal TUI 输入热修复。它保留 `0.10.6` 已验证的 Agent 异常提醒、`0.10.5` 的 Note Markdown 预览源码定位与可恢复草稿模型、`0.10.4` 的执行终端链接刷新性能修复、双市场发布元数据、安装拓扑和支持边界，重点修复正常安装后的生产 Webview bundle 中，画布 `Terminal` 节点进入 Vim / `glab auth login` 等 TUI 后输入卡死的问题。

### 本版本聚焦

- 版本号从 `0.10.6` bump 到 `0.10.7`，主扩展与 `Dev Session Canvas Notifier` 继续保持同版本发布
- Webview 生产构建将裸导入 `@xterm/xterm` 显式重定向到浏览器 CommonJS 入口 `@xterm/xterm/lib/xterm.js`，避开 xterm ESM 入口在 esbuild production minify 下的 DECRQM / `requestMode` 运行时错误
- 修复正常安装的主扩展中，`Terminal` 节点进入 vi 风格 alternate screen 或交互式鉴权 TUI 后，Host 侧仍写入 PTY 但 Webview 侧控制序列解析中断、导致用户输入看似卡死的问题
- 新增 `test:webview-build-xterm-entry`，直接在 minified Webview bundle 上发送 `CSI ? 12 $ p` 探针，确保 xterm 能返回合法模式响应，避免调试构建可用但发布构建损坏的回归
- 补充 Playwright 回归，覆盖 `Agent` / `Terminal` 节点进入 vi 风格 alternate screen 后仍能接收输入，并确认节点控制按钮不被 TUI 状态阻塞
- 同步终端运行时设计文档，记录 `0.10.6` 生产诊断结论、xterm 入口选择约束与验证口径
- 不改变扩展身份、最低 VS Code 版本、companion 自动安装关系、通知桥接默认值、Open VSX 同版本同步策略或 Preview 支持边界

### 安装与升级

- 当前公开 `Preview` 更新，扩展 ID 为 `devsessioncanvas.dev-session-canvas`
- 当前最低 VS Code 版本要求为 `1.80.0` 或更高版本
- 首次安装与从 `0.10.6` 升级到 `0.10.7` 都通过当前宿主配置的公开扩展市场获取；官方 VS Code 使用 `Visual Studio Marketplace`，Open VSX 兼容宿主使用 `Open VSX`
- 安装主扩展时会继续自动带上 `Dev Session Canvas Notifier`；本轮 notifier 版本号与主扩展对齐到 `0.10.7`，不引入新的通知投递行为变更
- 若此前显式配置过 `devSessionCanvas.notifications.attentionSignalBridge`、`devSessionCanvas.notifications.strongTerminalAttentionReminder` 或 `devSessionCanvas.notifications.agentAbnormalOutputTextNotifications`，升级到 `0.10.7` 后会继续沿用该明确选择
- Preview 阶段不承诺跨版本 workspace 状态完全兼容；如工作区包含重要画布状态，建议升级前备份或在非关键环境验证

### 回退建议

- 若 `0.10.7` 阻塞当前工作流，建议先禁用或卸载扩展
- 优先等待后续更高的 `0.10.x` 修复版本，而非尝试手动降级
- 如需回退，请重新安装目标版本并验证工作区状态；Preview 版本之间不保证回退兼容

## 0.10.6 - Preview Agent Abnormal Interruption Notification Patch

相对 `0.10.5`，`0.10.6` 是同一 `0.10.x` 公开 `Preview` 线内的 Agent 异常提醒补丁。它保留 `0.10.5` 已验证的 Note Markdown 预览源码定位与可恢复草稿模型、`0.10.4` 的执行终端链接刷新性能修复、双市场发布元数据、安装拓扑和支持边界，重点补齐 Codex / Claude Code Agent 已运行会话异常中断时的节点内提醒与可选外部通知。

### 本版本聚焦

- 版本号从 `0.10.5` bump 到 `0.10.6`，主扩展与 `Dev Session Canvas Notifier` 继续保持同版本发布
- Codex / Claude Code Agent 已进入运行态后，如果在非用户主动停止的情况下以非 `0` 退出并进入 `error`，现在会补充触发节点 `attentionPending`、节点内提醒 icon、Minimap 闪烁和按配置的外部通知
- 启动前校验失败、命令解析或 spawn 失败、`resume-failed`、用户主动停止、删除节点清理、正常 `0` 退出和 `Terminal` 节点退出都不会触发这条额外提醒，避免把用户仍在画布前处理的路径变成噪音
- 新增 `devSessionCanvas.notifications.agentAbnormalOutputTextNotifications` 配置，默认 `off`；显式设为 `codex` 时，Codex 输出中的高置信 `stream disconnected before completion: stream closed before response.completed` 文案会在进程退出前补充触发输出流异常提醒
- Codex 异常输出文本匹配只扫描新增输出；用户下一轮输入、配置切换和 live-runtime attach 已有历史输出都会被标记为已扫描，避免旧 buffer 中的同一条 stream error 被重复通知
- Claude Code 当前不启用输出文本匹配；在缺少真实 Claude 输出样本或结构化 `StopFailure` 证据前，Claude 只使用“已运行后非用户主动非 `0` 退出”的终态兜底提醒
- 异常提醒复用既有 `attentionSignalBridge`：`none` 只保留节点内提醒，`workbench` 弹 VS Code 工作台消息，`system` 优先交给本机 UI 侧 notifier companion 并在失败时回退工作台消息
- 不改变扩展身份、最低 VS Code 版本、companion 自动安装关系、通知桥接默认值、Open VSX 同版本同步策略或 Preview 支持边界

### 安装与升级

- 当前公开 `Preview` 更新，扩展 ID 为 `devsessioncanvas.dev-session-canvas`
- 当前最低 VS Code 版本要求为 `1.80.0` 或更高版本
- 首次安装与从 `0.10.5` 升级到 `0.10.6` 都通过当前宿主配置的公开扩展市场获取；官方 VS Code 使用 `Visual Studio Marketplace`，Open VSX 兼容宿主使用 `Open VSX`
- 安装主扩展时会继续自动带上 `Dev Session Canvas Notifier`；本轮 notifier 版本号与主扩展对齐到 `0.10.6`，不引入新的通知投递行为变更
- 若此前显式配置过 `devSessionCanvas.notifications.attentionSignalBridge` 或 `devSessionCanvas.notifications.strongTerminalAttentionReminder`，升级到 `0.10.6` 后会继续沿用该明确选择；新增异常输出文本匹配配置默认关闭
- Preview 阶段不承诺跨版本 workspace 状态完全兼容；如工作区包含重要画布状态，建议升级前备份或在非关键环境验证

### 回退建议

- 若 `0.10.6` 阻塞当前工作流，建议先禁用或卸载扩展
- 优先等待后续更高的 `0.10.x` 修复版本，而非尝试手动降级
- 如需回退，请重新安装目标版本并验证工作区状态；Preview 版本之间不保证回退兼容

## 0.10.5 - Preview Note Markdown Recovery Patch

相对 `0.10.4`，`0.10.5` 是同一 `0.10.x` 公开 `Preview` 线内的 Note Markdown 体验与草稿恢复修复版本。它保留 `0.10.4` 已验证的执行终端链接刷新性能修复、双市场发布元数据、安装拓扑和支持边界，重点收口 Markdown 预览双击进入编辑时的源码定位，以及关联 Markdown Note 的可恢复草稿模型。

### 本版本聚焦

- 版本号从 `0.10.4` bump 到 `0.10.5`，主扩展与 `Dev Session Canvas Notifier` 继续保持同版本发布
- Note Markdown 预览双击源码定位改为 parser-position source map：普通文本、列表续行、blockquote 列表、强调文本、代码块、entity 和 task item 文本会定位到对应 Markdown 源码 offset
- 图片、空白区域、display math、malformed math 等无法稳定映射到单个字符的预览块，双击后回退到对应 Markdown 块源码末尾，而不是整篇 Note 文末
- 预览态与编辑态切换继续保持源码附近上下文，降低从 Markdown 预览定位回 textarea 时的跳转成本
- 关联 Markdown Note 的草稿模型从 `conflictDraft` 收敛为 `recoverableDraft`；旧状态仍会迁移，新状态只把草稿引用持久化到画布状态，草稿正文继续放在 `note-markdown-drafts/` storage 文件中
- 可恢复草稿不再被误判为一定处于冲突状态；非冲突活跃草稿、文件不可用场景下的草稿，以及同内容强制覆盖后的清理路径都保留明确恢复语义
- 新增 `test:note-markdown-source-map`，并补齐关联 Markdown 草稿模型、模板、Playwright Webview、真实 VS Code smoke 与 packaged-payload smoke 回归
- 不改变扩展身份、最低 VS Code 版本、companion 自动安装关系、通知桥接默认值、Open VSX 同版本同步策略或 Preview 支持边界

### 安装与升级

- 当前公开 `Preview` 更新，扩展 ID 为 `devsessioncanvas.dev-session-canvas`
- 当前最低 VS Code 版本要求为 `1.80.0` 或更高版本
- 首次安装与从 `0.10.4` 升级到 `0.10.5` 都通过当前宿主配置的公开扩展市场获取；官方 VS Code 使用 `Visual Studio Marketplace`，Open VSX 兼容宿主使用 `Open VSX`
- 安装主扩展时会继续自动带上 `Dev Session Canvas Notifier`；本轮 notifier 版本号与主扩展对齐到 `0.10.5`，不引入新的通知投递行为变更
- 若此前显式配置过 `devSessionCanvas.notifications.attentionSignalBridge`，升级到 `0.10.5` 后会继续沿用该明确选择；默认安装路径仍优先使用 `system` 桥接并在必要时回退到工作台消息
- Preview 阶段不承诺跨版本 workspace 状态完全兼容；如工作区包含重要画布状态，建议升级前备份或在非关键环境验证

### 回退建议

- 若 `0.10.5` 阻塞当前工作流，建议先禁用或卸载扩展
- 优先等待后续更高的 `0.10.x` 修复版本，而非尝试手动降级
- 如需回退，请重新安装目标版本并验证工作区状态；Preview 版本之间不保证回退兼容

## 0.10.4 - Preview Terminal Link Refresh Performance Patch

相对 `0.10.3`，`0.10.4` 是同一 `0.10.x` 公开 `Preview` 线内的执行终端链接性能修复版本。它保留 `0.10.3` 已验证的双市场发布元数据与 Open VSX 图标 asset metadata 修复，重点收口运行中终端输出持续刷新时，普通文本 fallback 负缓存被反复送到 Host 侧解析的问题；同时保留高置信文件链接在文件创建后自动恢复为可点击 file link 的能力。

### 本版本聚焦

- 版本号从 `0.10.3` bump 到 `0.10.4`，主扩展与 `Dev Session Canvas Notifier` 继续保持同版本发布
- 运行中输出的后台负缓存刷新只处理高置信候选，例如 `detected` 与 `hardwrap`；纯 `fallback` 普通文本负缓存不再随 live output 反复发起文件解析请求
- 对 output throttle 窗口内的高置信负缓存失效补充 trailing refresh，避免第二次输出才创建文件时丢失恢复信号
- Host 侧新增 execution file-link resolve 诊断，记录候选数、resolved 数、source 分布与耗时，并写入诊断 dump，便于真实环境对比请求量与慢请求
- 新增 fallback-only live-output 性能回归与 throttle trailing refresh Playwright 用例，覆盖 `Agent` 与 `Terminal` 两类执行节点
- 不改变扩展身份、最低 VS Code 版本、companion 自动安装关系、通知桥接默认值、Open VSX 同版本同步策略或 Preview 支持边界

### 安装与升级

- 当前公开 `Preview` 更新，扩展 ID 为 `devsessioncanvas.dev-session-canvas`
- 当前最低 VS Code 版本要求为 `1.80.0` 或更高版本
- 首次安装与从 `0.10.3` 升级到 `0.10.4` 都通过当前宿主配置的公开扩展市场获取；官方 VS Code 使用 `Visual Studio Marketplace`，Open VSX 兼容宿主使用 `Open VSX`
- 安装主扩展时会继续自动带上 `Dev Session Canvas Notifier`；本轮 notifier 版本号与主扩展对齐到 `0.10.4`，不引入新的通知投递行为变更
- 若此前显式配置过 `devSessionCanvas.notifications.attentionSignalBridge`，升级到 `0.10.4` 后会继续沿用该明确选择；默认安装路径仍优先使用 `system` 桥接并在必要时回退到工作台消息
- Preview 阶段不承诺跨版本 workspace 状态完全兼容；如工作区包含重要画布状态，建议升级前备份或在非关键环境验证

### 回退建议

- 若 `0.10.4` 阻塞当前工作流，建议先禁用或卸载扩展
- 优先等待后续更高的 `0.10.x` 修复版本，而非尝试手动降级
- 如需回退，请重新安装目标版本并验证工作区状态；Preview 版本之间不保证回退兼容

## 0.10.3 - Preview Open VSX Icon Metadata Reissue

相对 `0.10.2`，`0.10.3` 是同一 `0.10.x` 公开 `Preview` 线内的发布元数据修复版本。主扩展运行时代码、执行终端链接行为、安装拓扑和支持矩阵不引入新的产品行为变更；本轮重点是重新发布主扩展与 notifier 的同版本 VSIX，并验证 Open VSX 侧为主扩展正确生成 `icon`、`license`、`vsixmanifest` 与 `sha256` asset metadata，修复 `0.10.2` 在 Open VSX / Cursor 中主插件图标缺失的问题。

### 本版本聚焦

- 版本号从 `0.10.2` bump 到 `0.10.3`，避免删除 Open VSX 既有版本后同版本重发造成 latest 短暂回退
- 保留 `0.10.2` 的执行终端 hard-wrap URL、带样式文件路径重组、分组 hover、live-output 文件链接缓存刷新与协议 source 校验能力
- 重新生成主扩展与 notifier VSIX，并在发布后直接复核 Open VSX API 的 `files.icon`、`files.license`、`files.vsixmanifest` 与 `files.sha256` 元数据
- 不改变扩展身份、最低 VS Code 版本、companion 自动安装关系、通知桥接默认值或 Preview 支持边界

### 安装与升级

- 当前公开 `Preview` 更新，扩展 ID 为 `devsessioncanvas.dev-session-canvas`
- 当前最低 VS Code 版本要求为 `1.80.0` 或更高版本
- 首次安装与从 `0.10.2` 升级到 `0.10.3` 都通过当前宿主配置的公开扩展市场获取；官方 VS Code 使用 `Visual Studio Marketplace`，Open VSX 兼容宿主使用 `Open VSX`
- 安装主扩展时会继续自动带上 `Dev Session Canvas Notifier`；本轮 notifier 版本号与主扩展对齐到 `0.10.3`，不引入新的通知投递行为变更
- 若此前显式配置过 `devSessionCanvas.notifications.attentionSignalBridge`，升级到 `0.10.3` 后会继续沿用该明确选择；默认安装路径仍优先使用 `system` 桥接并在必要时回退到工作台消息
- Preview 阶段不承诺跨版本 workspace 状态完全兼容；如工作区包含重要画布状态，建议升级前备份或在非关键环境验证

### 回退建议

- 若 `0.10.3` 阻塞当前工作流，建议先禁用或卸载扩展
- 优先等待后续更高的 `0.10.x` 修复版本，而非尝试手动降级
- 如需回退，请重新安装目标版本并验证工作区状态；Preview 版本之间不保证回退兼容

## 0.10.2 - Preview Terminal Hard-Wrapped Links Patch

相对 `0.10.1`，`0.10.2` 是同一 `0.10.x` 公开 `Preview` 里程碑下的执行终端链接体验修复，重点补齐 Codex / Claude 等 TUI 把长 URL 或带样式文件路径按固定缩进硬换行后不可点击的问题，并修复运行中终端输出持续刷新时文件链接解析缓存可能滞后或误用旧结果的问题。它不改变当前产品主叙事、安装路径或支持矩阵；当前仍保持 `Preview` 口径。真实 Codex / Claude TUI 输出的手动验证尚未完成，Windows 下使用 `Codex` 时执行节点内历史暂时无法向上翻页，仍是本版本显式保留的已知限制。

### 本版本聚焦

- 执行节点新增 TUI 硬换行 URL 识别：首片段必须包含明确 scheme，续行必须满足受控 continuation 规则，点击任一可见片段都会打开同一个完整 URL
- 对同一非默认 ANSI 样式锚定的硬换行文件路径新增高置信重组，保留 `:line:column` 后缀，并继续由 Host 侧按执行节点 cwd 或 workspace exact fallback 验证真实文件
- hover 反馈新增 hard-wrap 分组下划线：悬停任一片段时同组真实链接片段一起高亮，但不会把 TUI 缩进、边框或 gutter 纳入可点击区域
- 收紧硬换行拼接边界：不合并相邻完整 URL、缩进说明文字、普通 Markdown 列表、代码块、中文说明、首片段后仍带 prose 的样式片段或无样式文件路径
- Webview 与 Host 协议补齐 `hardwrap` 链接来源校验，避免真实 VS Code Host 因未知 source 拒绝候选解析或打开请求
- 运行中的终端文件链接解析会在输出继续到达后复用有效结果、刷新负缓存并在打开前重新解析，降低 live output 下 stale cache 或 delayed refresh 造成的误点风险
- 终端链接缓存覆盖参与重组的 buffer 行，减少 snapshot redraw、TUI 重绘或运行中输出续写后复用旧目标的风险
- 新增 `test:protocol-webview-messages`、`test:execution-terminal-links` 与 Agent / Terminal 两类 Playwright hard-wrap / live cache link 回归用例

### 推荐体验路径

- 在受信任工作区中使用
- `Remote SSH` 主路径已验证可用，且当前验证证据最充分
- 在 Codex / Claude 等 TUI 中遇到被固定缩进拆开的长 URL 时，可直接点击任一可见 URL 片段打开完整目标
- 需要让跨行文件路径可点击时，优先让 TUI / CLI 输出同一非默认 ANSI 样式的连续路径片段；无样式跨行 path 仍不会被猜测为同一个文件链接
- 若某个链接只在复制后可见但无法点击，优先检查它是否缺少明确 URL scheme、是否在续行混入自然语言说明，或文件路径是否缺少稳定样式锚点
- 若文件链接指向的是刚刚由运行中命令创建的文件，等待输出落盘和链接刷新后再点击；Host 打开前仍会重新解析目标，避免沿用过期候选

### 已知限制

- 当前仍为 `Preview`，尚非稳定正式版
- 不支持 `Virtual Workspace`
- Windows 本地 workspace 下使用 `Codex` 时，执行节点内当前仍存在终端历史无法向上翻页的已知问题
- 真实 Codex / Claude TUI 输出的手动验证尚未完成；当前验证证据以自动化 fixture 与 Playwright harness 为主
- TUI 硬换行重组只覆盖明确 scheme URL 和同一非默认 ANSI 样式锚定的文件路径；无样式文件路径、任意自然语言段落跨行 URL 和任意 Markdown 硬换行仍不会被猜测拼接
- 运行中终端的文件链接仍以 Host 侧文件系统验证为准；文件创建、删除或重命名与输出刷新之间仍可能存在短暂的不可点击或降级为搜索链接窗口
- 点击可打开重组后的完整目标，但终端文本复制 / 选择仍保留 TUI 输出中的原始换行、缩进或边框字符
- 文件活动仍依赖 provider 提供结构化事件；`Codex` 当前没有已确认的 provider 原生文件事件接口，因此不会凭空生成自动文件对象
- 模板仍只覆盖 `Agent`、`Terminal` 与 `Note` 的静态布局和配置，不保存运行中会话、终端输出、文件节点、文件活动边、模板标签、缩略图、云同步或模板历史
- `runtimePersistence.enabled = true` 的 guarantee 仍取决于 backend 与平台组合；Linux 本地与 `Remote SSH` 在 `systemd --user` 可用时具备最强验证证据

### 安装与升级

- 当前公开 `Preview` 更新，扩展 ID 为 `devsessioncanvas.dev-session-canvas`
- 当前最低 VS Code 版本要求为 `1.80.0` 或更高版本
- 首次安装与从 `0.10.1` 升级到 `0.10.2` 都通过当前宿主配置的公开扩展市场获取；官方 VS Code 使用 `Visual Studio Marketplace`，Open VSX 兼容宿主使用 `Open VSX`
- 安装主扩展时会继续自动带上 `Dev Session Canvas Notifier`；本轮 notifier 版本号与主扩展对齐到 `0.10.2`，不引入新的通知投递行为变更
- 若此前显式配置过 `devSessionCanvas.notifications.attentionSignalBridge`，升级到 `0.10.2` 后会继续沿用该明确选择；默认安装路径仍优先使用 `system` 桥接并在必要时回退到工作台消息
- 若此前从 `0.1.2` 升级到 `0.2.0` 后沿用了旧的 view layout 缓存，侧栏里的 `概览` 与 `常用操作` 可能已经被拆成两个独立图标；这不表示重复安装了两个扩展，升级到 `0.10.2` 后仍可手动把两个 view 移回同一 `Dev Session Canvas` 容器，或执行 `View: Reset View Locations` 恢复默认布局
- Preview 阶段不承诺跨版本 workspace 状态完全兼容；如工作区包含重要画布状态，建议升级前备份或在非关键环境验证

### 回退建议

- 若 `0.10.2` 阻塞当前工作流，建议先禁用或卸载扩展
- 优先等待后续更高的 `0.10.x` 修复版本，而非尝试手动降级
- 如需回退，请重新安装目标版本并验证工作区状态；Preview 版本之间不保证回退兼容

## 0.10.1 - Preview Note Markdown Polish Update

相对 `0.10.0`，`0.10.1` 是同一公开 `Preview` 里程碑下的收口更新，重点补齐关联 Markdown Note 在模板、Remote SSH 拖拽、metadata 预览、图片预览和路径展示上的边界，并把停止后 Agent 的新建 / 重启动作、UI 状态颜色、双市场发布入口和 Marketplace 英文默认文案一起收口。当前仍保持 `Preview` 口径；Windows 下使用 `Codex` 时执行节点内历史暂时无法向上翻页，仍是本版本显式保留的已知限制。

### 本版本聚焦

- 关联 Markdown Note 保存为模板时新增逐节点策略：保存为普通 Note 内容快照、仅保留 workspace 相对路径、或保留 workspace 相对路径和文件内容
- 应用含关联 Markdown Note 的模板时，缺失文件会在节点内显示缺失状态；路径加内容策略遇到已有不同内容时进入冲突恢复，不静默覆盖 workspace 文件
- Markdown 阅读态支持 YAML front matter：合法 metadata 默认隐藏正文前置块并通过标题栏浮层展示摘要，解析失败时保留原文并给出 warning
- Markdown 图片预览支持安全 `https:`、受限 `data:image/*;base64`、workspace 相对图片和关联 Markdown 文件相对图片；不支持的 scheme、绝对路径或越界路径 fail closed
- Remote Markdown 拖拽先通过当前 host authority 准入，再进入读写和 watcher 流程；同 host 资源收敛为统一身份，不同设备或无法确认当前 host 时直接拒绝
- 关联 Markdown 路径展示与拖拽标题继续收口：当前 host 下隐藏 raw Remote 前缀，复制路径使用用户可见的人类可读路径，拖拽标题可按配置保留扩展名
- 停止后的 Agent 节点在存在可信恢复上下文时显示并列的 `新建` 与 `重启` 动作，分别对应 fresh start 与恢复当前节点原会话
- UI 与发布链路补齐默认 panel 激活、执行节点状态胶囊、侧栏列表颜色、notifier sidebar 样式、脚本目录重组、打包失败阻断发布，以及 Marketplace README 默认语言改为英文

### 推荐体验路径

- 在受信任工作区中使用
- `Remote SSH` 主路径已验证可用，且当前验证证据最充分
- 需要复用关联 Markdown Note 布局时，优先在保存模板时显式选择每个关联 Note 的保存策略；团队约定文件入口优先使用“仅保留 workspace 相对路径”，初始化文档脚手架才使用“路径 + 内容”
- 使用 Markdown metadata 时，把 YAML front matter 放在文件开头；解析失败会保守保留原文，不会把未确认 metadata 写成已生效状态
- 在 Remote SSH / WSL / Dev Container 中拖拽 Markdown 文件时，只拖入当前 host 可确认的文件；不同 Remote 或无法确认当前 host 的资源会被拒绝，以避免跨设备误关联
- 停止 Agent 后，需要新一轮干净会话时点 `新建`；需要回到当前节点刚停止的会话时点 `重启`

### 已知限制

- 当前仍为 `Preview`，尚非稳定正式版
- 不支持 `Virtual Workspace`
- Windows 本地 workspace 下使用 `Codex` 时，执行节点内当前仍存在终端历史无法向上翻页的已知问题
- Markdown metadata 只识别文件开头的 YAML front matter；解析失败时不隐藏原文，也不把 metadata 当作可靠状态
- Markdown 图片预览只做安全只读展示，不引入图片上传、图片编辑、附件管理或任意本地绝对路径访问
- Remote Markdown 拖拽在无法确认当前完整 host authority 时会 fail closed；这可能拒绝部分理论上可读但身份不清的资源
- 模板仍只覆盖 `Agent`、`Terminal` 与 `Note` 的静态布局和配置，不保存运行中会话、终端输出、文件节点、文件活动边、模板标签、缩略图、云同步或模板历史
- `runtimePersistence.enabled = true` 的 guarantee 仍取决于 backend 与平台组合；Linux 本地与 `Remote SSH` 在 `systemd --user` 可用时具备最强验证证据

### 安装与升级

- 当前公开 `Preview` 更新，扩展 ID 为 `devsessioncanvas.dev-session-canvas`
- 当前最低 VS Code 版本要求为 `1.80.0` 或更高版本
- 首次安装与从 `0.10.0` 升级到 `0.10.1` 都通过当前宿主配置的公开扩展市场获取；官方 VS Code 使用 `Visual Studio Marketplace`，Open VSX 兼容宿主使用 `Open VSX`
- 安装主扩展时会继续自动带上 `Dev Session Canvas Notifier`；本轮 notifier 版本号与主扩展对齐到 `0.10.1`，包含 sidebar 样式 / 文案收口，但不引入新的通知投递行为变更
- 若此前显式配置过 `devSessionCanvas.notifications.attentionSignalBridge`，升级到 `0.10.1` 后会继续沿用该明确选择；默认安装路径仍优先使用 `system` 桥接并在必要时回退到工作台消息
- 若此前从 `0.1.2` 升级到 `0.2.0` 后沿用了旧的 view layout 缓存，侧栏里的 `概览` 与 `常用操作` 可能已经被拆成两个独立图标；这不表示重复安装了两个扩展，升级到 `0.10.1` 后仍可手动把两个 view 移回同一 `Dev Session Canvas` 容器，或执行 `View: Reset View Locations` 恢复默认布局
- Preview 阶段不承诺跨版本 workspace 状态完全兼容；如工作区包含重要画布状态，建议升级前备份或在非关键环境验证

### 回退建议

- 若 `0.10.1` 阻塞当前工作流，建议先禁用或卸载扩展
- 优先等待后续更高的 `0.10.x` 修复版本，而非尝试手动降级
- 如需回退，请重新安装目标版本并验证工作区状态；Preview 版本之间不保证回退兼容

## 0.10.0 - Preview Note Markdown Association Update

相对 `0.9.1`，`0.10.0` 是一轮新的公开 `Preview` 里程碑更新，重点把 `Note` 节点从画布内 Markdown 工作表面扩展到可关联 workspace Markdown 文件：普通 Note 可以保存为 `.md` 文件后继续作为 Note 编辑，`.md` / `.markdown` 文件可以拖入空白画布创建关联 Note，关联 Note 以磁盘文件为权威并支持打开文件、复制路径、外部保存刷新、缺失提示与并发冲突恢复。当前仍保持 `Preview` 口径；Windows 下使用 `Codex` 时执行节点内历史暂时无法向上翻页，仍是本版本显式保留的已知限制。

### 本版本聚焦

- 新增普通 Note 保存为关联 Markdown 文件的入口，节点标题栏操作区与命令面板都可触发，并在已有目标文件时要求用户显式选择覆盖、保留文件内容并关联或取消
- 新增空白画布拖放 `.md` / `.markdown` 文件创建关联 Note；同一次拖拽中的重复资源会去重，已关联文件再次拖入时可选择继续添加新 Note 或定位已有 Note
- 关联 Markdown Note 以磁盘文件内容为权威：未保存的 VS Code editor buffer 不会影响 Note 展示，外部保存或文件系统变化后才刷新到画布
- 关联 Note 显示人类可读完整路径，可直接打开文件或复制 Markdown 路径；删除画布节点不会删除关联文件，也不提供隐式解除关联
- 关联 Markdown 写回加入基于文件 revision 的乐观并发保护；编辑期间或提交时发现文件已变化会进入 `dirty-conflict`，避免静默覆盖外部修改
- 未解决冲突的本地草稿改存到 workspace storage 下的 `note-markdown-drafts/`，持久化画布状态只保存草稿引用，并在重新加载后继续提供重新加载、覆盖文件或复制草稿的恢复路径
- 普通 Note 继续保留 8,000 字符上限与轻量画布内上下文定位；关联 Markdown Note 不复用该上限，避免大文件读取或写回被截断
- 修正 Note 编辑态行号按视觉行对齐，并补齐关联 Markdown 路径复制、缺失/不可读状态、冲突恢复和真实 VS Code smoke 覆盖

### 推荐体验路径

- 在受信任工作区中使用
- `Remote SSH` 主路径已验证可用，且当前验证证据最充分
- 需要把长期上下文保留到仓库文件时，优先把普通 Note 保存为 `.md` 文件，或把已有 `.md` / `.markdown` 文件拖入画布创建关联 Note
- 关联 Markdown Note 的正文以磁盘文件为准；如果你在 VS Code editor 中修改了同一个文件，保存后才会刷新到画布
- 出现关联 Markdown 冲突时，先使用 `复制草稿` 保留本地修改，再根据需要选择重新加载磁盘内容或显式覆盖文件
- 如果旧版 VS Code view layout 缓存导致 sidebar 图标或 view 位置异常，可手动移动 view，或执行 `View: Reset View Locations` 恢复默认布局

### 已知限制

- 当前仍为 `Preview`，尚非稳定正式版
- 不支持 `Virtual Workspace`
- Windows 本地 workspace 下使用 `Codex` 时，执行节点内当前仍存在终端历史无法向上翻页的已知问题
- 关联 Markdown 文件当前只支持 `.md` 与 `.markdown` 文件；不把任意富文本、目录、未落盘 editor buffer 或 workspace 外不安全资源当成 Note 正文来源
- 关联 Markdown Note 删除节点不会删除文件，当前也不提供解除关联后自动回写为普通 Note 的路径
- 关联 Markdown 冲突必须由用户显式重新加载或覆盖解决；未确认前不会把草稿静默写回磁盘
- 文件活动仍依赖 provider 提供结构化事件；`Codex` 当前没有已确认的 provider 原生文件事件接口，因此不会凭空生成自动文件对象
- 模板当前只覆盖 `Agent`、`Terminal` 与 `Note` 的静态布局和配置，不保存运行中会话、终端输出、文件节点、文件活动边、模板标签、缩略图、云同步或模板历史
- `runtimePersistence.enabled = true` 的 guarantee 仍取决于 backend 与平台组合；Linux 本地与 `Remote SSH` 在 `systemd --user` 可用时具备最强验证证据

### 安装与升级

- 当前公开 `Preview` 更新，扩展 ID 为 `devsessioncanvas.dev-session-canvas`
- 当前最低 VS Code 版本要求为 `1.80.0` 或更高版本
- 首次安装与从 `0.9.1` 升级到 `0.10.0` 都通过 `Visual Studio Marketplace` 获取；后续 `0.10.x` 更新同样通过 Marketplace 升级获取
- 安装主扩展时会继续自动带上 `Dev Session Canvas Notifier`；本轮 notifier 版本号与主扩展对齐到 `0.10.0`，不引入新的通知行为变更
- 若此前显式配置过 `devSessionCanvas.notifications.attentionSignalBridge`，升级到 `0.10.0` 后会继续沿用该明确选择；默认安装路径仍优先使用 `system` 桥接并在必要时回退到工作台消息
- 若此前从 `0.1.2` 升级到 `0.2.0` 后沿用了旧的 view layout 缓存，侧栏里的 `概览` 与 `常用操作` 可能已经被拆成两个独立图标；这不表示重复安装了两个扩展，升级到 `0.10.0` 后仍可手动把两个 view 移回同一 `Dev Session Canvas` 容器，或执行 `View: Reset View Locations` 恢复默认布局
- Preview 阶段不承诺跨版本 workspace 状态完全兼容；如工作区包含重要画布状态，建议升级前备份或在非关键环境验证

### 回退建议

- 若 `0.10.0` 阻塞当前工作流，建议先禁用或卸载扩展
- 优先等待后续 `0.10.x` 修复版本，而非尝试手动降级
- 如需回退，请重新安装目标版本并验证工作区状态；Preview 版本之间不保证回退兼容

## 0.9.1 - Preview Notifier Guidance Update

相对 `0.9.0`，`0.9.1` 是同一公开 `Preview` 里程碑下的一轮收口更新，重点收口桌面通知 companion 的可理解性与侧栏入口一致性：`Dev Session Canvas Notifier` 侧栏拆成 `概览`、`注意事项`、平台说明和 Agent 配置多个 section，配置片段支持更清晰的代码高亮，Marketplace 文案补齐本机系统环境与远端 Agent 配置边界，同时统一主扩展 / 节点 / 模板 / notifier 的 Activity Bar badge 视觉。当前仍保持 `Preview` 口径；Windows 下使用 `Codex` 时执行节点内历史暂时无法向上翻页，仍是本版本显式保留的已知限制。

### 本版本聚焦

- 收口 `Dev Session Canvas Notifier` sidebar 结构：从单个通知环境视图拆成 `概览`、`注意事项`、`macOS`、`Linux`、`Windows`、`Codex` 与 `Claude Code` 多个 section，并把设置齿轮固定在 `概览` 标题行
- 新增 notifier sidebar 富文本渲染：支持行内代码与 fenced code block 混排，并为 `JSON` / `TOML` 配置片段提供深浅主题下可读的语法高亮
- 补齐 notifier 接入指导：Marketplace 文案明确桌面通知后端应安装在本机 UI 侧，`Codex` / `Claude Code` 通知配置应写在 Agent 实际运行宿主上
- 修正 notifier 状态判断：优先使用最近一次投递结果的 `activationMode` 展示点击回跳能力，并在 sidebar 未打开时跳过无意义的环境探测
- 修正 macOS `osascript` 回退通知行为：不再额外触发 `beep`，改为直接请求 `display notification` 的系统声音，降低通知出现时的闪屏与噪音感
- 统一 Activity Bar badge 图标体系：新增 `节点` sidebar section 专属图标，统一 nodes / templates / notifier badge 构图，并重新生成 notifier 图标与主扩展圆形头像安全区图
- 新增 badge 几何与头像安全区自动化测试，并把 notifier rich text / status 测试纳入 `test:notifier-source`，提高发布前视觉与文案结构回归覆盖

### 推荐体验路径

- 在受信任工作区中使用
- `Remote SSH` 主路径已验证可用，且当前验证证据最充分
- 需要桌面通知时，优先打开 `Dev Session Canvas Notifier` 的 `概览` 与对应平台 section，确认本机 UI 侧通知后端、最近一次投递结果和点击回跳能力
- 如果 Agent 运行在 `Remote SSH`、WSL 或 Dev Container，请把 `Codex` / `Claude Code` 的通知配置写到 Agent 实际运行宿主，而不是只写在本机 UI 侧
- 如果旧版 VS Code view layout 缓存导致 sidebar 图标或 view 位置异常，可手动移动 view，或执行 `View: Reset View Locations` 恢复默认布局

### 已知限制

- 当前仍为 `Preview`，尚非稳定正式版
- 不支持 `Virtual Workspace`
- Windows 本地 workspace 下使用 `Codex` 时，执行节点内当前仍存在终端历史无法向上翻页的已知问题
- notifier companion 只负责把已收到的 attention signal 投递到本机 UI 侧桌面通知；是否产生 attention signal 仍取决于 provider CLI 与运行宿主配置
- notifier 的点击回跳能力取决于平台后端、系统通知服务与当前 VS Code URI 处理能力；不支持点击回跳时仍会尽量保证通知可见
- Activity Bar 图标与 badge 更新不改变已有 workspace 的 view layout 缓存；极少数旧布局仍可能需要手动重置
- 文件活动仍依赖 provider 提供结构化事件；`Codex` 当前没有已确认的 provider 原生文件事件接口，因此不会凭空生成自动文件对象
- 模板当前只覆盖 `Agent`、`Terminal` 与 `Note` 的静态布局和配置，不保存运行中会话、终端输出、文件节点、文件活动边、模板标签、缩略图、云同步或模板历史
- `runtimePersistence.enabled = true` 的 guarantee 仍取决于 backend 与平台组合；Linux 本地与 `Remote SSH` 在 `systemd --user` 可用时具备最强验证证据

### 安装与升级

- 当前公开 `Preview` 更新，扩展 ID 为 `devsessioncanvas.dev-session-canvas`
- 当前最低 VS Code 版本要求为 `1.80.0` 或更高版本
- 首次安装与从 `0.9.0` 升级到 `0.9.1` 都通过 `Visual Studio Marketplace` 获取；后续 `0.9.x` 更新同样通过 Marketplace 升级获取
- 安装主扩展时会继续自动带上 `Dev Session Canvas Notifier`；本轮 notifier 版本号与主扩展对齐到 `0.9.1`，并包含 sidebar 结构、接入指导、代码高亮、状态判断和图标更新
- 若此前显式配置过 `devSessionCanvas.notifications.attentionSignalBridge`，升级到 `0.9.1` 后会继续沿用该明确选择；默认安装路径仍优先使用 `system` 桥接并在必要时回退到工作台消息
- 若此前从 `0.1.2` 升级到 `0.2.0` 后沿用了旧的 view layout 缓存，侧栏里的 `概览` 与 `常用操作` 可能已经被拆成两个独立图标；这不表示重复安装了两个扩展，升级到 `0.9.1` 后仍可手动把两个 view 移回同一 `Dev Session Canvas` 容器，或执行 `View: Reset View Locations` 恢复默认布局
- Preview 阶段不承诺跨版本 workspace 状态完全兼容；如工作区包含重要画布状态，建议升级前备份或在非关键环境验证

### 回退建议

- 若 `0.9.1` 阻塞当前工作流，建议先禁用或卸载扩展
- 优先等待后续 `0.9.x` 修复版本，而非尝试手动降级
- 如需回退，请重新安装目标版本并验证工作区状态；Preview 版本之间不保证回退兼容

## 0.9.0 - Preview Canvas Overview Update

相对 `0.8.0`，`0.9.0` 是一轮新的公开 `Preview` 里程碑更新，重点改善大画布导航、低倍率概览和 Agent CLI 缺失时的补救路径：fit view 可在节点分散时缩到 `0.4` 以下，默认概览态会在节点内容区显示标题，Agent 启动找不到 `Codex` / `Claude Code` 命令时会直接打开 CLI 选择与安装入口，并修正 Quick Input 启动命令预设误选等问题。当前仍保持 `Preview` 口径；Windows 下使用 `Codex` 时执行节点内历史暂时无法向上翻页，仍是本版本显式保留的已知限制。

### 本版本聚焦

- 新增动态全局概览缩放：节点分布很宽时，fit view 与手动缩小不再被固定 `0.4` 下限阻挡，可以一次看全完整画布
- 新增 `devSessionCanvas.canvas.overviewMode` 与 `devSessionCanvas.canvas.overviewZoomThreshold`：默认 `title` 模式会在低倍率节点内容区显示节点标题；需要保留普通节点渲染时可切到 `none`
- 收口概览态视觉：低倍率下弱化节点正文和次级操作，保留节点标题、状态、轮廓、连线和 minimap 作为导航线索
- Agent 启动阶段发现 `Codex` / `Claude Code` CLI 缺失时，节点会进入明确错误态，并自动打开与侧栏命令行配置一致的 CLI 选择 / 安装 Quick Input
- CLI 安装补救入口补齐“命令行安装 / 安装 VS Code 插件”分流；写入 supervisor 输入后再提示成功，并保留 supervisor 错误码用于诊断
- 修正 Agent 创建 Quick Input 中自定义命令被预设自动高亮覆盖、启动模式误选和 Enter 误触的问题，让 `默认` / `Resume` / `YOLO` / `沙盒` / 自定义启动语义更稳定
- 更新 Marketplace 预览媒体录制链路和最终 PNG / GIF / MP4 素材，使用真实 VS Code Extension Development Host 与录制专用 deterministic provider wrapper 生成可重复素材
- 修复侧栏 view manifest 警告，降低 VS Code 扩展清单噪音

### 推荐体验路径

- 在受信任工作区中使用
- `Remote SSH` 主路径已验证可用，且当前验证证据最充分
- 使用大画布时，优先通过 fit view 回到全局视图；如果低倍率概览不符合当前工作方式，可把 `devSessionCanvas.canvas.overviewMode` 改为 `none`
- 使用 `Agent` 节点前，请先通过侧栏或命令面板确认 `codex` / `claude` CLI 命令可解析；如果创建后才发现命令缺失，可直接沿自动弹出的安装 / 选择入口修复
- 录制或复核 Marketplace 素材时，以 `docs/marketplace-media-scenario.md` 和 `docs/skills/recording-marketplace-media/SKILL.md` 为准，避免把旧的一次性录屏流程当成正式路径

### 已知限制

- 当前仍为 `Preview`，尚非稳定正式版
- 不支持 `Virtual Workspace`
- Windows 本地 workspace 下使用 `Codex` 时，执行节点内当前仍存在终端历史无法向上翻页的已知问题
- 概览模式只影响低倍率视觉收口，不改变节点运行状态、终端行列数或画布持久化语义
- CLI 缺失补救入口只负责帮助用户重新选择或安装命令；如果本机 / 远端 Extension Host 本身仍无法解析该 CLI，`Agent` 节点仍无法完整运行
- 文件活动仍依赖 provider 提供结构化事件；`Codex` 当前没有已确认的 provider 原生文件事件接口，因此不会凭空生成自动文件对象
- 模板当前只覆盖 `Agent`、`Terminal` 与 `Note` 的静态布局和配置，不保存运行中会话、终端输出、文件节点、文件活动边、模板标签、缩略图、云同步或模板历史
- `runtimePersistence.enabled = true` 的 guarantee 仍取决于 backend 与平台组合；Linux 本地与 `Remote SSH` 在 `systemd --user` 可用时具备最强验证证据

### 安装与升级

- 当前公开 `Preview` 更新，扩展 ID 为 `devsessioncanvas.dev-session-canvas`
- 当前最低 VS Code 版本要求为 `1.80.0` 或更高版本
- 首次安装与从 `0.8.0` 升级到 `0.9.0` 都通过 `Visual Studio Marketplace` 获取；后续 `0.9.x` 更新同样通过 Marketplace 升级获取
- 安装主扩展时会继续自动带上 `Dev Session Canvas Notifier`；本轮 notifier 版本号与主扩展对齐到 `0.9.0`，不引入新的通知行为变更
- 若此前显式配置过 `devSessionCanvas.notifications.attentionSignalBridge`，升级到 `0.9.0` 后会继续沿用该明确选择；默认安装路径仍优先使用 `system` 桥接并在必要时回退到工作台消息
- 若此前从 `0.1.2` 升级到 `0.2.0` 后沿用了旧的 view layout 缓存，侧栏里的 `概览` 与 `常用操作` 可能已经被拆成两个独立图标；这不表示重复安装了两个扩展，升级到 `0.9.0` 后仍可手动把两个 view 移回同一 `Dev Session Canvas` 容器，或执行 `View: Reset View Locations` 恢复默认布局
- Preview 阶段不承诺跨版本 workspace 状态完全兼容；如工作区包含重要画布状态，建议升级前备份或在非关键环境验证

### 回退建议

- 若 `0.9.0` 阻塞当前工作流，建议先禁用或卸载扩展
- 优先等待后续 `0.9.x` 修复版本，而非尝试手动降级
- 如需回退，请重新安装目标版本并验证工作区状态；Preview 版本之间不保证回退兼容

## 0.8.0 - Preview Agent Usability Update

相对 `0.7.1`，`0.8.0` 是一轮新的公开 `Preview` 里程碑更新，重点改善 `Agent` / `Terminal` 节点的日常可用性：补齐执行终端复制粘贴快捷键、增加 Agent CLI 配置入口、让文件活动默认以列表节点呈现，并修正模板重置、Claude onboarding 与配置文件创建等体验问题。当前仍保持 `Preview` 口径；Windows 下使用 `Codex` 时执行节点内历史暂时无法向上翻页，仍是本版本显式保留的已知限制。

### 本版本聚焦

- 新增 `Agent` / `Terminal` 执行终端复制粘贴快捷键：macOS 使用 `Cmd+C` / `Cmd+V`，Windows 支持有选区 `Ctrl+C` 复制、无选区 `Ctrl+C` 打断以及 `Ctrl+V` / `Ctrl+Shift+V` 粘贴，Linux 保留 `Ctrl+C` 打断并使用 `Ctrl+Shift+C` / `Ctrl+Shift+V`
- 粘贴链路对齐 VS Code 原生 Terminal 的安全口径：单行直接粘贴，bracketed paste mode 下直接粘贴，多行或可能直接执行的尾随换行内容需要确认后才进入当前会话
- 新增 Agent CLI 配置入口：侧栏可查看并选择 `Codex` / `Claude Code` 命令，命令面板也提供选择 CLI、打开 `Codex config.toml`、打开 `Codex auth.json` 与打开 `Claude Code settings.json` 的入口
- 文件活动功能开启时，默认展示方式从独立文件节点调整为文件列表节点，更接近 VS Code Changes 列表的阅读方式；仍可通过 `devSessionCanvas.files.presentationMode` 切回独立节点
- 修正模板重置时复用旧节点身份的问题，避免重置后的节点继续携带不应保留的运行态或交互状态
- 补齐 Claude onboarding 标记、代理地址占位与 Agent 配置文件创建边界，降低首次配置 `Codex` / `Claude Code` 的摩擦

### 推荐体验路径

- 在受信任工作区中使用
- `Remote SSH` 主路径已验证可用，且当前验证证据最充分
- 使用 `Agent` 节点前，请先通过侧栏或命令面板确认 `codex` / `claude` CLI 命令可解析；如需代理或认证配置，可直接从命令面板打开对应配置文件
- 在执行节点内复制输出或粘贴命令时，优先使用本机平台熟悉的 VS Code Terminal 快捷键；多行粘贴出现确认提示时，先复核内容再继续
- 若启用文件活动功能，默认文件列表节点更适合观察单个 Agent 或多个 Agent 共享的文件读写关系

### 已知限制

- 当前仍为 `Preview`，尚非稳定正式版
- 不支持 `Virtual Workspace`
- Windows 本地 workspace 下使用 `Codex` 时，执行节点内当前仍存在终端历史无法向上翻页的已知问题
- 复制粘贴快捷键第一版不读取用户自定义 VS Code keybindings，也不支持 `terminal.integrated.copyOnSelection`、Linux selection clipboard、右键 copyPaste、HTML 富文本复制或文件资源剪贴板 fallback
- 文件活动仍依赖 provider 提供结构化事件；`Codex` 当前没有已确认的 provider 原生文件事件接口，因此不会凭空生成自动文件对象
- 模板当前只覆盖 `Agent`、`Terminal` 与 `Note` 的静态布局和配置，不保存运行中会话、终端输出、文件节点、文件活动边、模板标签、缩略图、云同步或模板历史
- `runtimePersistence.enabled = true` 的 guarantee 仍取决于 backend 与平台组合；Linux 本地与 `Remote SSH` 在 `systemd --user` 可用时具备最强验证证据

### 安装与升级

- 当前公开 `Preview` 更新，扩展 ID 为 `devsessioncanvas.dev-session-canvas`
- 当前最低 VS Code 版本要求为 `1.80.0` 或更高版本
- 首次安装与从 `0.7.1` 升级到 `0.8.0` 都通过 `Visual Studio Marketplace` 获取；后续 `0.8.x` 更新同样通过 Marketplace 升级获取
- 安装主扩展时会继续自动带上 `Dev Session Canvas Notifier`；本轮 notifier 版本号与主扩展对齐到 `0.8.0`，不引入新的通知行为变更
- 若此前显式配置过 `devSessionCanvas.notifications.attentionSignalBridge`，升级到 `0.8.0` 后会继续沿用该明确选择；默认安装路径仍优先使用 `system` 桥接并在必要时回退到工作台消息
- 若此前从 `0.1.2` 升级到 `0.2.0` 后沿用了旧的 view layout 缓存，侧栏里的 `概览` 与 `常用操作` 可能已经被拆成两个独立图标；这不表示重复安装了两个扩展，升级到 `0.8.0` 后仍可手动把两个 view 移回同一 `Dev Session Canvas` 容器，或执行 `View: Reset View Locations` 恢复默认布局
- Preview 阶段不承诺跨版本 workspace 状态完全兼容；如工作区包含重要画布状态，建议升级前备份或在非关键环境验证

### 回退建议

- 若 `0.8.0` 阻塞当前工作流，建议先禁用或卸载扩展
- 优先等待后续 `0.8.x` 修复版本，而非尝试手动降级
- 如需回退，请重新安装目标版本并验证工作区状态；Preview 版本之间不保证回退兼容

## 0.7.1 - Preview Shell Environment Compatibility Update

相对 `0.7.0`，`0.7.1` 是同一公开 `Preview` 里程碑下的一轮兼容性修复更新，重点收口 `Agent` 与嵌入式 `Terminal` 的 shell 环境继承、CLI 解析缓存、Windows 真实 smoke 覆盖和发布验证口径。当前仍保持 `Preview` 口径；Windows 下使用 `Codex` 时执行节点内历史暂时无法向上翻页，仍是本版本显式保留的已知限制。

### 本版本聚焦

- 收口 `Agent` 启动环境：CLI resolver 与真实 spawn 共用同一份受控 shell env patch，避免“命令能找到，但运行时 `PATH` / `node` / 工具链变量不同步”的分叉失败
- macOS / Linux 的 `Agent` 继续从当前 shell 解析受控环境增量；Windows 的 `Agent` 改为基于当前配置或默认 `Terminal` shell，覆盖 PowerShell、`cmd.exe`、Git Bash / MSYS2 等 POSIX family shell 的主路径
- 修正 `PATH` / `PATHEXT` 合并和缓存边界：shell 导出的主体顺序优先，测试或宿主显式注入目录可保留优先级，Agent CLI 缓存绑定 shell authority 与 workspace `cwd`
- 对齐嵌入式 `Terminal` 的跨平台语义：Windows 不预应用 shell env patch，让真实 shell 自己执行 profile / AutoRun；macOS / Linux 默认继承 login-only shell env patch，补齐 GUI 启动时常见的 Homebrew、NVM、PATH 或工具链变量
- 新增 `devSessionCanvas.terminal.inheritEnv` 与 `devSessionCanvas.terminal.shellArgs`，分别控制 `Terminal` 是否继承 shell environment，以及 Terminal shell 启动时附加的 argv 参数
- 扩充 host diagnostics、脚本级回归和 Windows real Codex smoke，覆盖 PowerShell、`cmd.exe`、Git Bash、MSYS2 `bash` / `sh` 等 shell authority 场景

### 推荐体验路径

- 在受信任工作区中使用
- `Remote SSH` 主路径已验证可用，且当前验证证据最充分
- 在 GUI 启动 VS Code 后，如果 `Agent` 或 `Terminal` 看不到 shell profile 中的工具链变量，优先升级到本版本并复核 host diagnostics
- 如果 macOS / Linux 的 `Terminal` profile 存在重复追加 `PATH` 或重复执行 rc/profile 的副作用，可关闭 `devSessionCanvas.terminal.inheritEnv`，或用 `devSessionCanvas.terminal.shellArgs` 显式调整 shell 启动参数
- 使用 `Agent` 节点前，请确保 `codex` 或 `claude` CLI 已安装且可用

### 已知限制

- 当前仍为 `Preview`，尚非稳定正式版
- 不支持 `Virtual Workspace`
- Windows 本地 workspace 下使用 `Codex` 时，执行节点内当前仍存在终端历史无法向上翻页的已知问题
- Windows 下少量更少见的 POSIX family shell 名称或非常规 `terminal.shellPath` 组合仍缺真实 smoke 覆盖；当前自动化和真实 smoke 已覆盖 PowerShell、`cmd.exe`、Git Bash、MSYS2 `bash` 与 MSYS2 `sh`
- shell env patch 只作为受控增量使用，不会 wholesale 覆盖 `HOME`、`USERPROFILE`、`PWD`、`TERM`、`ELECTRON_*`、`VSCODE_*` 等宿主关键变量；如果用户 profile 自身存在副作用，仍可能需要通过配置显式关闭或调整
- 模板当前只覆盖 `Agent`、`Terminal` 与 `Note` 的静态布局和配置，不保存运行中会话、终端输出、文件节点、文件活动边、模板标签、缩略图、云同步或模板历史
- `runtimePersistence.enabled = true` 的 guarantee 仍取决于 backend 与平台组合；Linux 本地与 `Remote SSH` 在 `systemd --user` 可用时具备最强验证证据

### 安装与升级

- 当前公开 `Preview` 更新，扩展 ID 为 `devsessioncanvas.dev-session-canvas`
- 当前最低 VS Code 版本要求为 `1.80.0` 或更高版本
- 首次安装与从 `0.7.0` 升级到 `0.7.1` 都通过 `Visual Studio Marketplace` 获取；后续 `0.7.x` 更新同样通过 Marketplace 升级获取
- 安装主扩展时会继续自动带上 `Dev Session Canvas Notifier`；本轮 notifier 版本号与主扩展对齐到 `0.7.1`，不引入新的通知行为变更
- 若此前显式配置过 `devSessionCanvas.notifications.attentionSignalBridge`，升级到 `0.7.1` 后会继续沿用该明确选择；默认安装路径仍优先使用 `system` 桥接并在必要时回退到工作台消息
- 若此前从 `0.1.2` 升级到 `0.2.0` 后沿用了旧的 view layout 缓存，侧栏里的 `概览` 与 `常用操作` 可能已经被拆成两个独立图标；这不表示重复安装了两个扩展，升级到 `0.7.1` 后仍可手动把两个 view 移回同一 `Dev Session Canvas` 容器，或执行 `View: Reset View Locations` 恢复默认布局
- Preview 阶段不承诺跨版本 workspace 状态完全兼容；如工作区包含重要画布状态，建议升级前备份或在非关键环境验证

### 回退建议

- 若 `0.7.1` 阻塞当前工作流，建议先禁用或卸载扩展
- 优先等待后续 `0.7.x` 修复版本，而非尝试手动降级
- 如需回退，请重新安装目标版本并验证工作区状态；Preview 版本之间不保证回退兼容

## 0.7.0 - Preview Canvas Templates Update

相对 `0.6.0`，`0.7.0` 主要把画布模板纳入公开 `Preview` 主路径：首次打开不再只是空白画布，用户可以通过内置模板、自定义模板和默认模板快速复用一组 `Agent` / `Terminal` / `Note` 工作面。当前仍保持 `Preview` 口径；Windows 下使用 `Codex` 时执行节点内历史暂时无法向上翻页，仍是本版本显式保留的已知限制。

### 本版本聚焦

- 新增画布模板能力：模板可以保存节点标题、相对位置、尺寸、`Note` 内容、连线样式与 `Agent` Provider / 参数；不会保存运行时输出、会话、文件活动或自动启动状态
- 新增 2 个内置模板：`使用说明` 作为默认自举模板，`示例模板` 提供基础 `Agent` + `Terminal` + `Note` 协作布局
- 新增侧栏 `模板` 列表、命令面板入口与画布空白区右键菜单，可应用模板、重置为模板、保存当前画布、导入 / 导出模板、设置默认模板与删除用户模板
- 支持用户模板保存到当前 workspace 或当前设备，并支持递归读取模板子目录；导入模板复用表单式确认流程，导出模板可直接生成可分享 JSON
- 优化模板应用体验：追加模板时会避开现有节点，显式应用或重置后自动追焦到本次新增节点组；重置类入口会复用宿主确认流程
- 收紧模板边界：未信任 workspace 下阻止含 `Agent` / `Terminal` 的模板，固定 Provider 不可用时阻止应用；删除当前默认用户模板后自动回退到 `使用说明`
- 将主扩展与 notifier 的最低 VS Code 版本要求调整为 `1.80.0`，并把 VS Code API 类型校验锁定到 `@types/vscode@1.80.0`
- 补齐侧栏常用操作中的 `重置画板` 与 `清空画板` 语义，并升级打包依赖以完成当前 `npm audit` 修复

### 推荐体验路径

- 在受信任工作区中使用
- `Remote SSH` 主路径已验证可用，且当前验证证据最充分
- 首次打开画布可先阅读默认 `使用说明` 模板，再通过侧栏 `模板` 尝试 `示例模板`
- 对可复用协作布局，优先用 `保存当前画布为模板` 固化静态工作面，再通过 workspace 或当前设备模板库复用
- 使用 `Agent` 节点前，请确保 `codex` 或 `claude` CLI 已安装且可用

### 已知限制

- 当前仍为 `Preview`，尚非稳定正式版
- 不支持 `Virtual Workspace`
- Windows 本地 workspace 下使用 `Codex` 时，执行节点内当前仍存在终端历史无法向上翻页的已知问题
- 模板当前只覆盖 `Agent`、`Terminal` 与 `Note` 的静态布局和配置，不保存运行中会话、终端输出、文件节点、文件活动边、模板标签、缩略图、云同步或模板历史
- 未信任 workspace 下只能应用不含执行型节点的模板；含固定 Provider 的模板会在对应 CLI 不可用时被阻止应用
- `Note` Markdown 预览不支持原始 HTML 透传、任意 scheme 链接、越出 workspace 的文件链接、目录目标或富文本块编辑
- 侧栏 `会话历史` 当前只显示可明确归属到当前 workspace 的记录；缺少工作目录信息的旧会话会被保守跳过
- `runtimePersistence.enabled = true` 的 guarantee 仍取决于 backend 与平台组合；Linux 本地与 `Remote SSH` 在 `systemd --user` 可用时具备最强验证证据

### 安装与升级

- 当前公开 `Preview` 更新，扩展 ID 为 `devsessioncanvas.dev-session-canvas`
- 当前最低 VS Code 版本要求为 `1.80.0` 或更高版本
- 首次安装与从 `0.6.0` 升级到 `0.7.0` 都通过 `Visual Studio Marketplace` 获取；后续 `0.7.x` 更新同样通过 Marketplace 升级获取
- 安装主扩展时会继续自动带上 `Dev Session Canvas Notifier`；如果用户从 notifier 页面单独安装，也会自动补齐主扩展
- 若此前显式配置过 `devSessionCanvas.notifications.attentionSignalBridge`，升级到 `0.7.0` 后会继续沿用该明确选择；默认安装路径仍优先使用 `system` 桥接并在必要时回退到工作台消息
- 若此前从 `0.1.2` 升级到 `0.2.0` 后沿用了旧的 view layout 缓存，侧栏里的 `概览` 与 `常用操作` 可能已经被拆成两个独立图标；这不表示重复安装了两个扩展，升级到 `0.7.0` 后仍可手动把两个 view 移回同一 `Dev Session Canvas` 容器，或执行 `View: Reset View Locations` 恢复默认布局
- Preview 阶段不承诺跨版本 workspace 状态完全兼容；如工作区包含重要画布状态，建议升级前备份或在非关键环境验证

### 回退建议

- 若 `0.7.0` 阻塞当前工作流，建议先禁用或卸载扩展
- 优先等待后续 `0.7.x` 修复版本，而非尝试手动降级
- 如需回退，请重新安装目标版本并验证工作区状态；Preview 版本之间不保证回退兼容

## 0.6.0 - Preview Note Markdown Update

相对 `0.5.1`，`0.6.0` 主要把 `Note` 节点从轻量纯文本对象升级为更完整的 Markdown 工作表面，同时收口 Note 链接与公式渲染的安全边界，并修正执行通知“查看节点”的确认语义。当前仍保持 `Preview` 口径；Windows 下使用 `Codex` 时执行节点内历史暂时无法向上翻页，仍是本版本显式保留的已知限制。

### 本版本聚焦

- 新增 `Note` Markdown 预览：阅读态可展示标题、列表、引用、代码块、语法高亮与 KaTeX 公式；正文权威数据仍保持原始 Markdown 文本
- 支持 `Note` 预览态交互式 checklist：点击 checkbox 可直接回写 `[ ]` / `[x]`，覆盖无序、有序、嵌套与引用场景，不需要先进入编辑态
- 支持安全的 `Note` 链接打开链路：允许 `http` / `https` / `mailto` 与当前 workspace 内文件链接，并支持 `#L12`、`#L12C3` 行列定位；不安全 scheme、绝对路径、目录与越界路径会 fail closed
- 优化 `Note` 正文交互：单击预览保留选择与复制，双击进入编辑；编辑态提供行号 gutter，并支持 `Tab` / `Shift+Tab` 对单行或多行按两个空格缩进 / 反缩进
- 收紧 Markdown 安全边界：移除不安全公式插件，改用自有 Markdown math 规则调用 KaTeX，并阻止 malformed math 或 `command:` 链接生成可激活 DOM
- 修正通知回跳语义：点击 VS Code 工作台通知或支持回调的系统通知后，只把对应节点居中，不选中节点，也不清除 `attentionPending`
- 补齐 notifier sidebar 配置入口：`Dev Session Canvas Notifier` 的 `通知环境` 标题行提供齿轮按钮，可直接打开 companion 配置，并同步优化 sidebar 文案

### 推荐体验路径

- 在受信任工作区中使用
- `Remote SSH` 主路径已验证可用，且当前验证证据最充分
- 使用 `Note` 记录结构化上下文、待办清单、workspace 文件链接、代码片段与轻量公式说明
- 安装后默认即可体验本机桌面通知；如需复核当前链路，可直接运行 notifier 的测试通知命令与诊断侧栏
- 使用 `Agent` 节点前，请确保 `codex` 或 `claude` CLI 已安装且可用

### 已知限制

- 当前仍为 `Preview`，尚非稳定正式版
- 不支持 `Virtual Workspace`
- Windows 本地 workspace 下使用 `Codex` 时，执行节点内当前仍存在终端历史无法向上翻页的已知问题
- `Note` Markdown 预览不支持原始 HTML 透传、任意 scheme 链接、越出 workspace 的文件链接、目录目标或富文本块编辑
- 侧栏 `会话历史` 当前只显示可明确归属到当前 workspace 的记录；缺少工作目录信息的旧会话会被保守跳过
- `runtimePersistence.enabled = true` 的 guarantee 仍取决于 backend 与平台组合；Linux 本地与 `Remote SSH` 在 `systemd --user` 可用时具备最强验证证据

### 安装与升级

- 当前公开 `Preview` 更新，扩展 ID 为 `devsessioncanvas.dev-session-canvas`
- 首次安装与从 `0.5.1` 升级到 `0.6.0` 都通过 `Visual Studio Marketplace` 获取；后续 `0.6.x` 更新同样通过 Marketplace 升级获取
- 安装主扩展时会继续自动带上 `Dev Session Canvas Notifier`；如果用户从 notifier 页面单独安装，也会自动补齐主扩展
- 若此前显式配置过 `devSessionCanvas.notifications.attentionSignalBridge`，升级到 `0.6.0` 后会继续沿用该明确选择；默认安装路径仍优先使用 `system` 桥接并在必要时回退到工作台消息
- 若此前从 `0.1.2` 升级到 `0.2.0` 后沿用了旧的 view layout 缓存，侧栏里的 `概览` 与 `常用操作` 可能已经被拆成两个独立图标；这不表示重复安装了两个扩展，升级到 `0.6.0` 后仍可手动把两个 view 移回同一 `Dev Session Canvas` 容器，或执行 `View: Reset View Locations` 恢复默认布局
- Preview 阶段不承诺跨版本 workspace 状态完全兼容；如工作区包含重要画布状态，建议升级前备份或在非关键环境验证

### 回退建议

- 若 `0.6.0` 阻塞当前工作流，建议先禁用或卸载扩展
- 优先等待后续 `0.6.x` 修复版本，而非尝试手动降级
- 如需回退，请重新安装目标版本并验证工作区状态；Preview 版本之间不保证回退兼容

## 0.5.1 - Preview Attention Bridge Default Update

相对 `0.5.0`，`0.5.1` 聚焦把执行节点 attention signal 的默认外部桥接从工作台消息收口到 `system`，同时补齐旧配置升级兼容与系统通知来源辨识。当前仍保持 `Preview` 口径；Windows 下使用 `Codex` 时执行节点内历史暂时无法向上翻页，仍是本版本显式保留的已知限制。

### 本版本聚焦

- 默认将 `devSessionCanvas.notifications.attentionSignalBridge` 收口到 `system`：安装主扩展并自动带上 notifier 后，无需额外改设置即可优先尝试把提醒送回本机桌面
- 兼容 legacy 桥接配置：如果用户此前显式设置过 `devSessionCanvas.notifications.bridgeTerminalAttentionSignals` 或 `devSessionCanvas.notifications.preferNotifierCompanion`，升级到 `0.5.1` 后仍保留既有 `workbench` / `none` / `system` 语义，避免旧设置被静默改成桌面通知
- 收口 `system` 模式通知标题：统一使用 `DSCanvas · <workspace> · Agent|Terminal`，让多窗口、多 workspace 或远端场景里更容易辨认提醒来源
- 保留 `Dev Session Canvas Notifier` 自动安装关系、嵌入式 `Terminal` shell 选择能力与现有 `Preview` 支持边界，并同步收口 `0.5.1` 发布材料

### 推荐体验路径

- 在受信任工作区中使用
- `Remote SSH` 主路径已验证可用，且当前验证证据最充分
- 安装后默认即可体验本机桌面通知；如需复核当前链路，可直接运行 notifier 的测试通知命令与诊断侧栏
- 使用 `Agent` 节点前，请确保 `codex` 或 `claude` CLI 已安装且可用

### 已知限制

- 当前仍为 `Preview`，尚非稳定正式版
- 不支持 `Virtual Workspace`
- Windows 本地 workspace 下使用 `Codex` 时，执行节点内当前仍存在终端历史无法向上翻页的已知问题
- 侧栏 `会话历史` 当前只显示可明确归属到当前 workspace 的记录；缺少工作目录信息的旧会话会被保守跳过
- `runtimePersistence.enabled = true` 的 guarantee 仍取决于 backend 与平台组合；Linux 本地与 `Remote SSH` 在 `systemd --user` 可用时具备最强验证证据

### 安装与升级

- 当前公开 `Preview` 更新，扩展 ID 为 `devsessioncanvas.dev-session-canvas`
- 首次安装与从 `0.5.0` 升级到 `0.5.1` 都通过 `Visual Studio Marketplace` 获取；后续 `0.5.x` 更新同样通过 Marketplace 升级获取
- 若你此前显式使用 legacy 配置键 `devSessionCanvas.notifications.bridgeTerminalAttentionSignals` 或 `devSessionCanvas.notifications.preferNotifierCompanion` 控制提醒路径，升级后会继续沿用旧设置的明确选择；如需切换到新的默认策略，请直接改 `devSessionCanvas.notifications.attentionSignalBridge`
- 若此前从 `0.1.2` 升级到 `0.2.0` 后沿用了旧的 view layout 缓存，侧栏里的 `概览` 与 `常用操作` 可能已经被拆成两个独立图标；这不表示重复安装了两个扩展，升级到 `0.5.1` 后仍可手动把两个 view 移回同一 `Dev Session Canvas` 容器，或执行 `View: Reset View Locations` 恢复默认布局
- Preview 阶段不承诺跨版本 workspace 状态完全兼容；如工作区包含重要画布状态，建议升级前备份或在非关键环境验证

### 回退建议

- 若 `0.5.1` 阻塞当前工作流，建议先禁用或卸载扩展
- 优先等待后续 `0.5.x` 修复版本，而非尝试手动降级
- 如需回退，请重新安装目标版本并验证工作区状态；Preview 版本之间不保证回退兼容

## 0.5.0 - Preview Notifier And Shell Selection Update

相对 `0.4.1`，`0.5.0` 主要把本机 UI 侧桌面通知 companion 与嵌入式 `Terminal` shell 选择能力纳入公开 `Preview` 的正式版本范围，并同步收口这轮发布材料。当前仍保持 `Preview` 口径；Windows 下使用 `Codex` 时执行节点内历史暂时无法向上翻页，仍是本版本显式保留的已知限制。

### 本版本聚焦

- 新增 `Dev Session Canvas Notifier` companion：安装主扩展时会自动带上 notifier；从 notifier 页面单独安装时，也会自动补齐主扩展
- 收口 attention signal 的 `system` 桥接主路径：主扩展会优先把提醒交给本机 UI 侧 notifier，并提供测试通知命令、环境诊断侧栏与静音开关，适合 `Remote SSH`、WSL、Dev Container 等“运行在 workspace 侧、提醒需要回到本机桌面”的场景
- 支持为嵌入式 `Terminal` 选择 shell：动态枚举当前设备可用 shell、记住用户实际挑中的精确路径，并在打开 workspace 时默认支持 workspace 级覆盖
- 收口主扩展与 notifier 的开发 / smoke / VSIX 打包链路，确保 companion、自动安装关系与发布手册在仓库内保持一致
- 收口 `0.5.0` 发布材料：同步更新 Marketplace 文案、release notes、安装升级说明与发布手册，确保版本范围、升级路径和回退口径一致

### 推荐体验路径

- 在受信任工作区中使用
- `Remote SSH` 主路径已验证可用，且当前验证证据最充分
- 使用 `Agent` 节点前，请确保 `codex` 或 `claude` CLI 已安装且可用
- 若需要把提醒桥接到本机桌面，请安装后将 `devSessionCanvas.notifications.attentionSignalBridge` 设为 `system`，并先用 notifier 的测试通知命令确认当前本机链路

### 已知限制

- 当前仍为 `Preview`，尚非稳定正式版
- 不支持 `Virtual Workspace`
- Windows 本地 workspace 下使用 `Codex` 时，执行节点内当前仍存在终端历史无法向上翻页的已知问题
- 侧栏 `会话历史` 当前只显示可明确归属到当前 workspace 的记录；缺少工作目录信息的旧会话会被保守跳过
- `runtimePersistence.enabled = true` 的 guarantee 仍取决于 backend 与平台组合；Linux 本地与 `Remote SSH` 在 `systemd --user` 可用时具备最强验证证据

### 安装与升级

- 当前公开 `Preview` 更新，扩展 ID 为 `devsessioncanvas.dev-session-canvas`
- 首次安装与从 `0.4.1` 升级到 `0.5.0` 都通过 `Visual Studio Marketplace` 获取；后续 `0.5.x` 更新同样通过 Marketplace 升级获取
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
