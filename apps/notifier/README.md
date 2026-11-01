# Notifier 原生客户端

当前处于里程碑一。Tauri + React 骨架通过 Swift 薄适配接入 macOS UserNotifications，提供真实权限查询、测试通知、撤销和点击诊断。尚未连接 IDE，不是可替换旧 notifier 的发布版本。Windows/Linux 通知接口明确返回 unsupported。

## 本机运行

使用仓库 CI 的 Node 22.23.3、Xcode 命令行工具和 Rust 1.90.0。`rust-toolchain.toml` 仅作用于此目录。仓库根执行：

    npm ci
    npm run -w apps/notifier dev
    npm run -w apps/notifier build
    npm run -w apps/notifier test

build 默认输出本地 ad-hoc 签名的 macOS `.app`：`apps/notifier/src-tauri/target/release/bundle/macos/DSCanvas Notifier.app`；不是 Developer ID 签名或公证包。退出开发实例后复制到 `~/Applications/`，启动安装副本并核验权限和真实点击。不要覆盖仍运行的安装副本。正式分发签名在里程碑四配置。

按钮只接受 status/authorize/post/withdraw。post 的提交回调不等于用户看到通知；withdraw 没有完成回调，需随后点查询检查 delivered。所有测试通知使用独立应用身份；撤销仅作用于该应用。诊断记录位于 `~/Library/Logs/io.github.zy-wang-0304.dsc.notifier/`，最多保留两个约 1 MiB 文件；UI 只保留最新 100 条。当前记录不包含通知正文或 IDE 凭据。关闭应用不清理系统保留通知；冷启动回调必须另行验证。

## 独立原生探针

`native-probe/` 用于隔离 Tauri 与操作系统变量；它不是第二套产品实现。运行：

    bash apps/notifier/native-probe/build.sh
    ditto '.debug/notifier-native/DSCanvas Notifier Probe.app' "$HOME/Applications/DSCanvas Notifier Probe.app"
    open "$HOME/Applications/DSCanvas Notifier Probe.app"

依次查询权限、请求权限、发 A、点击系统通知、发 B、查询、撤销、再次查询。最后再发 A 并关闭窗口，点击通知中心残留通知核对冷启动回调。探针日志位于 `~/Library/Application Support/DSCanvas Notifier Probe/events.log`，1 MiB 轮转，最多两个文件。证据和未完成项以执行计划为准。该探针验证完成后收敛为平台回归工具，不接生产来源协议。


图标来自 companion 的 `extensions/vscode/dev-session-canvas-notifier/images/icon.png`。更新图标时用 Tauri icon CLI 重新生成并保留 icons/icon.png 与 icons/notifier.icns；系统通知中心可能继续使用旧图标缓存，包内资源正确不等于横幅已刷新。原始验证日志见 `validation/2026-11-01-macos.log`；详细结果及未通过项见仓库执行计划。
