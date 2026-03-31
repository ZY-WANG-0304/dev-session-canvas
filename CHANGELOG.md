# Changelog

## 0.0.1 - Internal Preview

- 建立了 `WebviewPanel` 主画布入口与 `WebviewPanelSerializer` 恢复链路。
- 提供 React Flow 画布原型，以及 `Agent`、`Terminal`、`Task`、`Note` 四类核心对象。
- 提供基于 `codex` / `claude` CLI 的最小 Agent 运行原型。
- 提供基于 `xterm.js` 与宿主 shell 的嵌入式终端原型。
- 补齐内部体验版分发所需的基础 manifest 元数据、打包脚本和发布准备文档。
- 修复了在 `Remote-SSH` / `VS Code Server Node 22` 环境下点击 `Agent` 或 `Terminal` 启动后，`node-pty` 兼容性问题导致扩展宿主崩溃并重启的问题；同时在真正加载 `node-pty` 前增加兼容性探测，避免类似问题再次直接打挂宿主。

## 已知限制

- 当前版本仍以原型验证为主，不应包装成稳定正式版。
- 当前不支持 `Virtual Workspace`。
- 当前阶段默认只支持内部体验版 VSIX 分发，不以公开 Marketplace 发布为目标。
- 若未来转向公开发布，仍需补齐许可证策略和对外可访问的资源链接。
