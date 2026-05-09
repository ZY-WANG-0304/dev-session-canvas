# Changelog

## 0.7.0

- 与主扩展 `0.7.0` 对齐：本轮 notifier companion 不引入新的通知行为变更，继续作为主扩展 `system` attention bridge 的本机 UI 侧投递组件。
- 继续沿用 companion 自动安装关系与版本对齐策略，保持 notifier 与主扩展的发布输入一致。

## 0.6.0

- 与主扩展 `0.6.0` 对齐：通知点击回跳只把对应执行节点居中，不再把“查看节点”误处理为用户已经确认并清除提醒。
- `通知环境` sidebar 标题行新增配置齿轮，可直接打开 `Dev Session Canvas Notifier` 自身设置，便于调整 `devSessionCanvasNotifier.notifications.playSound`。
- 优化 sidebar 文案表达，继续显式展示当前通知后端、点击回跳能力、声音请求状态、前置依赖与最近一次投递结果。
- 继续沿用 companion 自动安装关系与版本对齐策略，保持 notifier 与主扩展的发布输入一致。

## 0.5.1

- 与主扩展 `0.5.1` 对齐：主扩展默认把 `devSessionCanvas.notifications.attentionSignalBridge` 收口到 `system`，安装配对扩展后无需再手工开启桌面通知主路径。
- 执行 attention 系统通知标题统一对齐为 `DSCanvas · <workspace> · Agent|Terminal`，在多窗口或远端 workspace 下更容易辨认通知来源。
- 继续沿用 companion 自动安装关系与版本对齐策略，保持 notifier 与主扩展的发布输入一致。

## 0.5.0

- 初始化 UI-side notifier companion 骨架。
- 新增测试桌面通知命令与诊断输出，用于真实桌面通知的人工验收。
- 为各平台返回结构化 `activationMode`，显式区分“可点击回到 VS Code”和“仅展示通知”的退化路径。
- 新增 `devSessionCanvasNotifier.notifications.playSound` 配置开关，默认请求提示音并允许按本机 UI 环境关闭。
- 新增 notifier sidebar，用于展示当前本机 UI 环境下的通知方式、点击回跳能力、预安装依赖与最近一次投递结果。
- 与主扩展建立双向 `extensionDependencies` 自动安装关系：安装主扩展会自动带上 notifier，单独安装 notifier 也会自动补齐主扩展。
