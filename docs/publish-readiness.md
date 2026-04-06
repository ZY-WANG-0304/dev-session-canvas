# 插件分发准备

本文记录当前仓库的分发准备状态。目标不是“现在立刻公开发布”，而是把仓库推进到一个可打包、可内部试用、风险显式化的体验版准备态。

## 当前结论

- 当前阶段的分发目标是内部体验版 VSIX，不是公开 `Marketplace` 发布。
- 当前版本只适合作为 `Preview` 预览版，不应包装成稳定正式版。
- 当前仓库已于 2026-04-05 完成 MVP 验证，并具备可持续迭代的内部 Preview 基线；后续变更默认按正式开发标准推进。
- 当前最安全的首发方式是形成可重复打包的 VSIX，先服务内部体验与验证；是否进入公开 Marketplace 延后决策。

## 仓库内已落实项

- `package.json` 已补齐 `preview`、`icon`、`galleryBanner`、`extensionKind`、`pricing`、`qna` 等发布元数据。
- manifest 已补齐当前内部仓库可用的 `repository`、`homepage` 与 `bugs` 元数据，保证内部 VSIX 打包不会再因 README 或仓库信息缺失而失败。
- `vscode:prepublish` 会先执行 `npm run package`，确保打包前经过类型检查和生产构建。
- 仓库已把 VSIX 打包逻辑收口到 `scripts/package-vsix.mjs`；脚本直接复用本地依赖中的打包处理器与显式运行时文件清单，不依赖额外全局安装 `vsce`。
- 已显式声明 `Restricted Mode` 为有限支持，并通过 `restrictedConfigurations` 保护执行型设置。
- 已显式声明 `Virtual Workspace` 暂不支持，避免在当前实现尚未适配时误报支持能力。
- `docs/SECURITY.md` 已补齐专用安全邮箱、响应时限与“只支持最新主线 / 预览版”的支持口径。
- 仓库根目录已补齐 `LICENSE` 文件，与当前 `UNLICENSED` 的内部体验版分发口径保持一致。
- `README.md` 与 `CHANGELOG.md` 已补齐发布准备说明与当前限制。

## 若未来公开发布的阻塞项

以下项无法仅靠当前 worktree 自动补齐，但它们只在后续准备公开发布时才会成为阻塞项：

- 公开资源链接：确认对外可访问的 `repository`、`homepage`、`bugs` 链接；在未确认前不要填写假的 URL。
- 许可证策略：当前仓库仍为 `UNLICENSED`，只适合内部或待定状态；若要公开发布，应先明确许可证文件与条款。
- 公开发布渠道：若未来进入公开发布，再确认 `Visual Studio Marketplace` 中 `devsessioncanvas` 这个 `publisher` 是否已注册可用，并准备 Azure DevOps 组织与 Personal Access Token。

## 当前分发流程

仓库内已经收敛出的内部体验版最小流程如下：

1. 在仓库根目录执行 `npm install`。
2. 运行 `npm run package`，确认类型检查和生产构建同时通过。
3. 运行 `npm run package:vsix`，生成内部体验版 VSIX。
4. 如果体验者本机此前安装过旧 `opencove` 预览包，明确告知其先卸载旧扩展，再安装当前 `devsessioncanvas.dev-session-canvas` VSIX。
5. 通过内部渠道分发 VSIX，供体验和验证使用。

## 内部安装方式

收到 `.vsix` 后，可通过以下任一方式安装：

1. 在 VS Code 命令面板执行 `Extensions: Install from VSIX...`。
2. 在终端执行 `code --install-extension <your-vsix-file>`。

注意：

- 如果本机此前安装的是旧 `opencove` 预览包，这一轮不是覆盖升级，必须先卸载旧扩展，再安装当前 `devsessioncanvas.dev-session-canvas` 包。
- 旧扩展下的命令、视图、Activity Bar 入口与 workspaceState 不会自动迁移到当前扩展身份。
- 如果已经安装的是当前 `devsessioncanvas.dev-session-canvas` 包，后续同一产品线的 VSIX 才按普通覆盖升级处理。

## 若未来转向公开发布

只有在明确要做公开发布时，才需要额外补齐以下动作：

1. 确认当前 `publisher` `devsessioncanvas` 已在目标 Marketplace 环境中注册可用。
2. 准备 Azure DevOps 组织与 Personal Access Token。
3. 执行 `vsce login <publisher>` 与 `vsce publish`，或改走 Marketplace 手动上传流程。

## 发布前人工验证

建议至少覆盖以下场景：

- 本地磁盘工作区下，能打开画布并创建四类对象。
- `Restricted Mode` 下，画布可打开，但 `Agent` / `Terminal` 执行入口被禁用且说明清晰。
- Linux 与 macOS 本地环境下，`Agent` 与嵌入式终端主路径可运行或至少能明确报错。
- 重新打开窗口后，关键对象图和画布恢复链路成立。
- 若未来准备对外发布，还应补做 Windows、Remote SSH / Codespaces 的人工验证。

## 暂不承诺项

- 不承诺当前版本已经是稳定版。
- 不承诺当前版本支持 `Virtual Workspace` 或浏览器形态。
- 不承诺当前版本已经具备面向公开外部用户的支持与运营体系。
