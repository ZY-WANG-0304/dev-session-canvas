# Dev Session Canvas Notifier

`Dev Session Canvas Notifier` 是 `Dev Session Canvas` 的本机 UI 侧 companion extension，用于把执行节点的 attention event 投递成桌面系统通知。

它不是独立替代品：画布、节点执行与 attention 判定仍由主扩展 `Dev Session Canvas` 负责；notifier 负责在当前本机 UI 环境中接收结构化通知请求，并尽量把它们变成可见、可诊断、在支持平台上可点击回到 VS Code 的桌面通知。

## 适用场景

- 主扩展运行在 `Remote SSH`、WSL、Dev Container 等远端 workspace，需要把提醒带回本机桌面
- 本地 workspace 中希望在切出 VS Code 后仍收到系统通知
- 想区分“VS Code 工作台通知”和“本机桌面通知”，并在支持的平台上点击后回到对应节点

## 当前能力

- 在本机 UI 侧按平台选择合适后端：
  - macOS：`terminal-notifier`，或回退到 `osascript`
  - Linux：`notify-send`
  - Windows：Toast Notification
- 显式区分通知回调能力：支持点击回到 VS Code 的完整路径，与“只保证通知出现”的退化路径不会混写
- 提供独立 sidebar，用于查看当前通知后端、点击回调能力、声音请求状态、前置依赖与最近一次投递结果
- 提供两条人工验收命令：
  - `Dev Session Canvas Notifier: 发送测试桌面通知`
  - `Dev Session Canvas Notifier: 打开通知诊断输出`

## 安装与启用

1. 安装本扩展 `Dev Session Canvas Notifier`
2. 若当前尚未安装主扩展，VS Code 会自动补齐 `Dev Session Canvas`
3. 如果你是从主扩展页面安装，VS Code 也会自动带上本扩展，无需额外单独安装
4. 在主扩展设置中将 `devSessionCanvas.notifications.attentionSignalBridge` 设为 `system`
5. 如需关闭提示音请求，可将 `devSessionCanvasNotifier.notifications.playSound` 设为 `false`

`system` 模式会优先把 attention signal 交给本扩展；若 companion 缺失、当前平台不支持或本次投递失败，主扩展会自动回退到 VS Code 工作台消息。

如果你主要使用 `Codex` provider，请确认你的 `Codex` 环境会输出 attention signal；当前仓库内的常见配置键是 `notification_method` 与 `notification_condition`。不同 `Codex` 版本支持的具体取值可能不同；若默认没有发出提醒，可优先检查这两项配置。

## 平台说明

- macOS：如需点击系统通知后回到 VS Code，建议预装 `terminal-notifier`；否则会退回 `osascript`，只保证通知出现
- Linux：需要 `notify-send`；是否支持点击回跳取决于桌面环境与通知服务实现
- Windows：通常不需要额外 CLI，但系统通知权限或 Focus Assist 可能拦截弹窗

## Preview 边界

- 当前仍为 `Preview` companion extension，不承诺所有平台都具备完全一致的通知点击体验
- 缺少主扩展时，本扩展不会单独提供画布或执行节点能力
- 当前更推荐与 `Dev Session Canvas` 的公开 `Preview` 版本一起使用，而不是与历史实验包混搭

## 反馈与支持

- Issue 反馈：<https://github.com/ZY-WANG-0304/dev-session-canvas/issues>
- 仓库主页：<https://github.com/ZY-WANG-0304/dev-session-canvas>
- 安全问题：<https://github.com/ZY-WANG-0304/dev-session-canvas/blob/main/docs/SECURITY.md>
