# 最新主线发布前验证证据

固定输入为 `origin/main@ea0c9b194fda1f13098cfd7ad4a3e13c4ec5233b`（PR325 合并提交），Linux x64 / Node22.23.3 / VS Code1.141.0。本轮舍弃旧发布 PR313，不修改版本、产品、测试或依赖。正式结论见 [主线验证报告](../../design-docs/main-release-readiness-2026-10-13.md)。

[evidence.json](evidence.json) 记录14条命令的完整环境覆盖、UTC起止、退出码和日志hash。完整 npm test exit0，包括默认源码 smoke 和最后 Webview426/426；root/startup、Host634/634、notifier companion与en/zh-cn也通过。原日志保留在 `/tmp/dmr13`。

默认 clean-checkout 在 npm ci 的 Wrangler/esbuild 二进制自校验发生 ETXTBSY，尚未打包。原stderr见 [clean-vsix-install-first-failure.txt](clean-vsix-install-first-failure.txt)，原npm日志hash及诊断边界见相邻JSON。新独立目录只加 `npm_config_foreground_scripts=true`，不跳过脚本、不改输入，从 npm ci 到140-file VSIX及八组安装smoke完整exit0；标记保存在evidence。该结果不追认原写者或根因已修复，也不替代标准发布PR/tag门禁。

`inputs.json` 固定596个产品/测试/发布文件；`native-build-inputs.json`固定六目标资产及本机build，`vsix-artifact-summary.json`固定当前main版本0.26.0的验证包（非0.26.1发布物）。其他JSON包含通过标记与原工件inventory；不上传原始用户存储或测试SSH私钥。

浏览器为暖revision1217，系统依赖准备0新装/5升级，不代证全新OS冷安装。fake provider、localhost SSH、受控non-native Host与Linux运行不外推其他平台、真实provider、远端长断开或公开市场自动安装。上游资源积压与原单次ready首败仍独立跟踪。
