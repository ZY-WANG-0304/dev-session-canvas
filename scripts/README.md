# scripts

本目录按职责分层；对外稳定入口优先使用 `package.json` 里的 `npm run ...` 命令，物理路径只作为维护实现细节。

- `build/`：主扩展构建入口，例如 `npm run build` / `npm run watch` 背后的实现。
- `release/`：VSIX 打包、双市场发布、Open VSX API helper 与 clean-checkout 发布校验。
- `runtime/`：随主扩展 VSIX 打包的运行时辅助脚本，目前只放 Claude 文件事件 hook。
- `media/`：Marketplace 预览素材录制与 X11 原生输入辅助。
- `smoke/`：真实 VS Code / VSIX / notifier / Windows Codex smoke 运行器和夹具。
- `test/`：纯脚本测试、Playwright runner 入口，以及通过 npm test 串联的轻量回归。
- `shared/`：被多个入口复用但不随 VSIX 打包的 helper。
