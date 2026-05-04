# Changelog

## Unreleased

- 初始化 UI-side notifier companion 骨架。
- 新增测试桌面通知命令与诊断输出，用于真实桌面通知的人工验收。
- 为各平台返回结构化 `activationMode`，显式区分“可点击回到 VS Code”和“仅展示通知”的退化路径。
- 新增 notifier sidebar，用于展示当前本机 UI 环境下的通知方式、点击回跳能力、预安装依赖与最近一次投递结果。
