# scripts

本目录按职责分层；对外稳定入口优先使用 `package.json` 里的 `npm run ...` 命令，物理路径只作为维护实现细节。

- `build/`：主扩展构建入口，例如 `npm run build` / `npm run watch` 背后的实现。
- `release/`：VSIX 打包、双市场发布、Open VSX API helper 与 clean-checkout 发布校验。
- `diagnostics/`：离线诊断入口，例如分析宿主 dump 中的 Webview lifecycle 健康度。
- `runtime/`：随主扩展 VSIX 打包的运行时辅助脚本，目前只放 Claude 文件事件 hook。
- `media/`：Marketplace 预览素材录制与 X11 原生输入辅助。
- `smoke/`：真实 VS Code / VSIX / notifier / Windows Codex smoke 运行器和夹具。
- `test/`：纯脚本测试、Playwright runner 入口，以及通过 npm test 串联的轻量回归。
- `shared/`：被多个入口复用但不随 VSIX 打包的 helper。

SSH 重开门禁的 `DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=remote-ssh-real-reopen` 聚合入口顺序执行 `remote-ssh-real-reopen-exit` 与 `remote-ssh-real-reopen-retain`，也可单独指定子场景。两者在 Linux 私有 localhost fixture 中让 setup 等待受控断连，核验本次本地 spawn PID/startTicks、可执行文件及私有启动参数后终止该客户端；exit 只结束核验 UID/server 路径/角色/身份的旧远端 Host，retain 保留原 Host 到业务验收完成。终端完成信号独立于 Host 寿命，原 Supervisor/session、恢复输入和真实 resize 必须共同通过，最后有可观察的私有资源清理报告。该门禁不修改上游缓存或产品行为，也不代证真实网络异常与跨平台 SSH。`npm run test:smoke-remote-host` 覆盖身份错误拒绝信号、状态正反例和有界失败，Linux 另验证真实自有子进程。
