# Changelog

## 0.5.0

- 初始化 UI-side notifier companion 骨架。
- 新增测试桌面通知命令与诊断输出，用于真实桌面通知的人工验收。
- 为各平台返回结构化 `activationMode`，显式区分“可点击回到 VS Code”和“仅展示通知”的退化路径。
- 新增 `devSessionCanvasNotifier.notifications.playSound` 配置开关，默认请求提示音并允许按本机 UI 环境关闭。
- 新增 notifier sidebar，用于展示当前本机 UI 环境下的通知方式、点击回跳能力、预安装依赖与最近一次投递结果。
- 与主扩展建立双向 `extensionDependencies` 自动安装关系：安装主扩展会自动带上 notifier，单独安装 notifier 也会自动补齐主扩展。
