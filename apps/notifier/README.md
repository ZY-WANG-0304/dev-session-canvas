# Notifier 原生客户端

当前正在推进 Mac 里程碑二。Tauri + React 骨架通过 Swift 薄适配接入 macOS UserNotifications，提供真实权限查询、测试通知、撤销和点击诊断。已接入默认关闭的 Mac 本机桥接，尚不是可替换旧 notifier 的发布版本。Windows/Linux 通知接口明确返回 unsupported。

## 本机运行

使用仓库 CI 的 Node 22.23.3、Xcode 命令行工具和 Rust 1.90.0。`rust-toolchain.toml` 仅作用于此目录。仓库根执行：

    npm ci
    npm run -w apps/notifier dev
    npm run -w apps/notifier build
    npm run -w apps/notifier test

build 默认输出本地 ad-hoc 签名的 macOS `.app`：`apps/notifier/src-tauri/target/release/bundle/macos/DSCanvas Notifier.app`；不是 Developer ID 签名或公证包。退出开发实例后复制到 `~/Applications/`，启动安装副本并核验权限和真实点击。不要覆盖仍运行的安装副本。正式分发签名在里程碑四配置。

按钮只接受 status/authorize/post/withdraw。post 的提交回调不等于用户看到通知；withdraw 没有完成回调，需随后点查询检查 delivered。所有测试通知使用独立应用身份；撤销按钮仅作用于该应用的 test- 前缀测试通知，不清理 IDE 提醒。诊断记录位于 `~/Library/Logs/io.github.zy-wang-0304.dsc.notifier/`，最多保留两个约 1 MiB 文件；UI 只保留最新 100 条。当前记录不包含通知正文或 IDE 凭据。关闭应用不清理系统保留通知；冷启动回调必须另行验证。

## 独立原生探针

`native-probe/` 用于隔离 Tauri 与操作系统变量；它不是第二套产品实现。运行：

    bash apps/notifier/native-probe/build.sh
    ditto '.debug/notifier-native/DSCanvas Notifier Probe.app' "$HOME/Applications/DSCanvas Notifier Probe.app"
    open "$HOME/Applications/DSCanvas Notifier Probe.app"

依次查询权限、请求权限、发 A、点击系统通知、发 B、查询、撤销、再次查询。最后再发 A 并关闭窗口，点击通知中心残留通知核对冷启动回调。探针日志位于 `~/Library/Application Support/DSCanvas Notifier Probe/events.log`，1 MiB 轮转，最多两个文件。证据和未完成项以执行计划为准。该探针验证完成后收敛为平台回归工具，不接生产来源协议。


图标来自 companion 的 `extensions/vscode/dev-session-canvas-notifier/images/icon.png`。更新图标时用 Tauri icon CLI 重新生成并保留 icons/icon.png 与 icons/notifier.icns；系统通知中心可能继续使用旧图标缓存，包内资源正确不等于横幅已刷新。原始验证日志见 `validation/2026-11-01-macos.log`；详细结果及未通过项见仓库执行计划。

## 本机 IDE 开发桥接

先启动已安装应用，再以 `DEV_SESSION_CANVAS_NATIVE_NOTIFIER=1` 启动隔离的 VS Code 开发宿主，同时加载本分支主扩展和 companion。companion 必须运行在本机 UI host，不能将 socket 服务部署到 Remote SSH 主机。未设置变量时继续使用旧后端；测试通知按钮仍只回到通知应用。

本机端点位于 `~/.dsc-notifier/runtime/`，目录 0700、socket 与 credential/lock/events 文件 0600。不要手动输出或复制 credential。来源每次扩展激活生成新身份，同次激活断线可重连并同步，旧通知不会自动重弹。已接单仅表示落盘；横幅显示、点击、来源聚焦分别取证。丢失回执时禁止工作台重复提醒，来源离线或执行换代后的点击安全拒绝。

`npm run test:notifier-native` 运行共享请求/响应向量和真实 Unix socket 客户端故障测试；应用 workspace 的 test 同时运行 Rust 存储、路由与传输测试。`tests/vscode-smoke/notifier-native-tests.cjs` 是人工点击的隔离桌面验收入口，不加入无人值守默认 smoke。它从真实终端 OSC 9 信号开始，保存 posted/clicked/completed 证据；需要自有 workspace/user-data-dir 和 `DSC_NATIVE_ACCEPTANCE_DIR`、`DSC_NATIVE_ACCEPTANCE_LABEL`，driver 创建 trigger/finish 文件推进。启动命令与本机证据见 ExecPlan。

F5 调试可选 `.vscode/launch.json` 的 `Run Dev Session Canvas + Native Notifier (Local Window)`，该配置设置开发变量并构建两扩展。先启动已安装的 DSCanvas Notifier。默认 `npm run build` 仍要求完整六目标资产集，不能只放本机的一份 manifest；本机已从已安装 0.26.1 扩展提取六目标到 `generated/execution-assets`，通过当前原生源码和文件摘要校验。该目录不入 Git，也不作为正式发布验收来源；换机器后需重新准备匹配资产。
