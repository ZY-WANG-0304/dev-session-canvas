# 真实窗口重开 ready 预算验证证据

本目录是2026-10-13定向验证的输入与工件摘录。正式方案和边界见[设计文档](../../design-docs/smoke-reopen-ready-timeout.md)，前一轮上游机制取证见[PR #324](https://github.com/ZY-WANG-0304/dev-session-canvas/pull/324)。这里没有复跑完整发布门禁。

基线为`a213b89b8c1dcaaec291e896042acc8627a05668`加本次fixture的20→45秒改动，使用Linux x64 / Xvfb、Node22.23.3、VS Code1.141.0。实际运行命令如下；临时目录是本机输入，其他机器需对应替换。

PR #323/#324合入后，分支rebase到main `1fb49b4e`，重新构建并运行原版VS Code fallback两阶段，setup/verify退出0且无systemctl提交。单独记录于[rebase-validation.json](rebase-validation.json)，包含新基线、实现commit、命令、输入和日志hash；原控制实验工件及其输入hash保持历史事实，不改写为新主线实验。

```sh
PATH=/tmp/dsc-release-node22/node_modules/node/bin:$PATH DEV_SESSION_CANVAS_EXECUTION_ASSETS_SET=/tmp/dsc-release-026-assets npm run build
PATH=/tmp/dsc-release-node22/node_modules/node/bin:$PATH DEV_SESSION_CANVAS_VSCODE_TEST_CACHE_PATH=/tmp/dsc0261v/.vscode-test DEV_SESSION_CANVAS_SMOKE_DEBUG_ROOT=/tmp/dwr-budget-n1 DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=systemd-fallback-real-reopen node scripts/smoke/run-vscode-smoke.mjs
PATH=/tmp/dsc-release-node22/node_modules/node/bin:$PATH node /tmp/dsc-ready-investigation/cdp-observe.mjs /tmp/dsc-ready-budget/cdp 38993
PATH=/tmp/dsc-release-node22/node_modules/node/bin:$PATH xvfb-run -a node /tmp/dsc-ready-budget/run-controls.mjs cap4
PATH=/tmp/dsc-release-node22/node_modules/node/bin:$PATH xvfb-run -a node /tmp/dsc-ready-budget/run-controls.mjs no-ready
```

原生N1没有CDP或worker修改。容量4对照先将`service-worker-cap4.js`复制到独立VS Code副本的`resources/app/out/vs/workbench/contrib/webview/browser/pre/service-worker.js`；该文件沿用PR #324诊断版，只降低容量。`run-controls.mjs`使用仓库runner准备干净staging，额外记录ready耗时，并在verify前插入3次快速重开；此临时runner不进入默认smoke流程。负对照使用未改worker的原版VS Code，只在setup结束后替换staged bundle中唯一ready消息。复制runner到其他环境时，需替换其仓库import与临时VS Code路径。CDP观察器使用自动attach且`waitForDebuggerOnStart:false`，不暂停执行。

| 验证 | 结果 | 可追溯文件 |
| --- | --- | --- |
| 原生fallback两阶段 | setup与verify退出0；原身份、正文、输入、离线完成清理断言通过 | `native-n1-log-excerpt.json` |
| 容量4资源排队 | 第3次ready为28493ms；原verify全部通过 | `cap4-log-excerpt.json`、`ready-observations.json`、`cap4-queue-and-release.json` |
| 永久不发送ready | verify在45021ms报45000ms错误，退出1符合预期；保留原失败工件 | `no-ready-log-excerpt.json`、`no-ready-real-reopen-verify-failure-*` |
| 负对照资源层 | CSS/JS响应200，inner app子节点0；不证明React完成渲染 | `no-ready-cdp-excerpt.json` |

`results.json`记录汇总；`input-sha256.json`记录fixture、runner、干净/变更bundle、worker、完整本机日志与CDP原始输入的路径及SHA256。日志摘录只保留phase/退出码/ready观测，worker事件按run与内容去重；CDP run2为容量4 verify，run4为负对照verify。失败snapshot和Supervisor工件是采集时原字节，不能视作负对照失败后又完成了post-ready验收。

清理在工件留存后执行：恢复独立副本worker（与原版SHA256同为`338e0c80993456b866ec1a544933117522600bf25c313c7c7efc94d2ca3fa0dd`），恢复staged负对照bundle；通过socket hello核对仅本次创建的Supervisor PID，使用`deleteSession`删除本次负对照的两个session，再确认其退出。原版VS Code和仓库产品源码没有诊断修改。

主进程日志保留UTC日期，renderer本地时区为Asia/Shanghai。目录日期按本机日期2026-10-13，不改写原始时间戳。原单次fallback ready首败仍未知，上游请求责任仍待解决；本轮没有验证其他平台、Remote、默认VSIX或完整release gate。
