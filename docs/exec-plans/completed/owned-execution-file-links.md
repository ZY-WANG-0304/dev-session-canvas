# 接回 owned 执行的逐行文件链接上下文

本计划按 `docs/PLANS.md` 持续维护。目标在 PR #314 修复终端多行文件结果中的 `2:8` 被当作 Quick Open 搜索词的问题，不改变版本与发布材料。

## 目标与全局图景

终端切换目录后输出文件名和下一行位置时，点击位置应打开正文所属目录的文件，并定位至对应行列。正文来自本地 owned 执行（由 owner 管理、记录在 `nonNativeHostExecutions` 中的执行）时，应使用其已有逐行工作目录记录，不再只认识旧 session。

## 进度

- [x] (2026-10-10) 核对上轮两次真实失败；明确实际正文与页面相邻两行已显示，仍解析为 search。
- [x] (2026-10-10) 审计 Host 路径上下文、文件解析缓存及 owned 输入/输出 tracker 接线。
- [x] (2026-10-10) 修前回归将 subdir 下的同名文件错误解析到初始 /controlled；修后 8/8、完整 Host 434/434、路径 helper、逐行 tracker 与类型检查通过。
- [x] (2026-10-10) 默认真实 VSIX 通过两个具名阶段和整个 native interactions，包含多行 2:8/file/编辑器定位、缺失文件搜索与普通/显式 URL。后续 scrollback 仍等待旧 metadata.recentOutput 而超时。
- [x] (2026-10-10) 同步正式方案、索引、原则、证据与技术债，归档本计划，随本次提交更新 PR #314。

## 意外与发现

修后真实 VSIX 已通过原多行链接及整个 native interactions。新触达 `verifyRuntimeReloadPreservesConfiguredTerminalScrollbackHistory:8523` 仍读旧 metadata.recentOutput，最终 Host 快照同 executionId 有 001/220。超时发生在其 simulateRuntimeReload 之前，不能把它写成 reload 丢历史。证据保留在 `.debug/file-link-fix/trusted-artifacts`。

`CanvasPanelManager.getExecutionTerminalPathContext` 仅为旧 session 提供 `resolveCwdForBufferLine`。owned business 已记录 Terminal 确认输入中的 cd 与输出 OSC 7 目录标记，却未提供给链接解析。`createExecutionFileLinkResolveCacheKey` 的相对路径键包含 nodeId/行号但未区分执行，重启后可复用旧目录下同名文件的结果，需随接线回归。

## 决策记录

- 决策：从原 owned record 的 launchSpec 获取 shell/cwd，捕获其 business.lineContextTracker 作为只读解析源；保留旧 session 和历史 metadata 回退。理由：文件链接不是进程写入，停止后但尚未退休的记录仍可提供正文上下文，不能套用输入准入。日期：2026-10-10。
- 决策：相对路径解析缓存包含捕获的执行身份，防止同 nodeId 和行号的另一条执行复用旧结果。理由：新执行可能 cd 到不同目录；绝对路径仍可共享解析缓存。日期：2026-10-10。
- 决策：保留 smoke 的实际两行正文、页面相邻行和文件位置断言，通过真实 VSIX 做根因闭环；不将原搜索断言放宽。日期：2026-10-10。

## 结果与复盘

产品路径上下文与相对缓存身份接线完成，8 项新增回归及完整 Host 434/434 通过。修前将 /controlled/subdir/link-target.ts 解析为 /controlled/link-target.ts；修后按原正文行 cwd 返回目标及选择位置。默认真实 VSIX 已完成整个原 native interactions，包含此前失败的多行 2:8/file/编辑器位置检查和后续 URL 场景，根因闭环；本轮未修改 smoke。完整 trusted 在下一 scrollback 函数等待旧 metadata.recentOutput 的 -220 超时，尚未执行该函数的 reload。最终同执行 Host 快照已有 001/220，旧字段仍是此前 native interactions 的历史；该新触达断言问题单独登记，完整门禁未通过。

## 上下文与定向

`extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts` 负责构造路径上下文并缓存解析结果；`executionTerminalLineContextTracker.ts` 从已确认输入和输出保存正文行所属目录；`executionTerminalNativeHelpers.ts` 的 `resolveExecutionFileLink` 用该目录查文件。Webview 的 `executionTerminalNativeInteractions.ts` 将上一行文件名与位置行组成候选，解析不到时继续走搜索。`tests/vscode-smoke/extension-tests.cjs` 中 `verifyExecutionTerminalNativeInteractions` 是原生验收入口。

## 工作计划

第一里程碑在 `scripts/test/test-host-execution-owner-wiring.mjs` 使用真实 Host/owner/adapter 和已有 tracker，模拟确认的 cd 或 provider 输出 OSC 7，再给出文件与位置正文。验证原目录与后续目录分别对应正确行，调用真实路径 helper 检查最终 URI/行列；明确失败发生于修前。覆盖旧 session、停止后的只读上下文、捕获后替换不会改用新 tracker，以及两执行同名相对路径缓存不串用。

第二里程碑接回路径上下文与执行身份缓存，运行完整 Host、路径 helper、逐行 tracker、类型检查，随后运行默认真实 VSIX。第三里程碑记录原生验证结论和边界，归档本计划并更新 PR #314。

## 具体步骤

使用专用工作树 `/tmp/dscr`，不改原项目树。将 `.debug/rca/node_modules` 移为根目录 `node_modules`，将 `.debug/rca/playwright-browsers` 移为 `.playwright-browsers`；测试后移回。使用 `export PATH=/tmp/dsc-release-node22/node_modules/node/bin:$PATH`。

运行 `DEV_SESSION_CANVAS_HOST_TEST_FILTER='file link context' node scripts/test/test-host-execution-owner-wiring.mjs`，完整 Host 去掉过滤变量；运行 `npm run test:execution-terminal-native-helpers`、`npm run test:execution-terminal-line-context-tracker`、`npm run typecheck`。

真实验证命令为 `DEV_SESSION_CANVAS_EXECUTION_ASSETS_SET=/tmp/dsc-release-026-assets DEV_SESSION_CANVAS_VSCODE_EXECUTABLE=/tmp/dsc0261v/.vscode-test/vscode-linux-x64-1.141.0/code npm run test:vsix-smoke`，日志与工件存 `.debug/file-link-fix/`。推送前 `git fetch origin`、核对 PR 远端 head、`git rebase origin/main`；保持 PR #314，不合并、不发布。

## 验证与验收

受控输入/OSC 7 后，上下文对相同文件名的不同行分别提供当时 cwd，真实 helper 返回对应绝对路径与 2:8 的零基选择位置 1:7。旧 session 保持可用；异步查找捕获原 tracker，不转投新执行；相对缓存不跨执行。真实页面显示 `link-target.ts` 和 `  2:8 ...` 后点击，诊断应为 file，编辑器位置为第二行第八列。

## 幂等性与恢复

测试夹具与 VS Code profile 隔离，可重跑；保留失败工件与修前日志，不覆盖此前修复证据。若变基改写远端提交，只使用固定旧 head 的 force-with-lease。提交前停放依赖 symlink，保持工作树干净。

## 证据与备注

本轮结果及 hash 见 `docs/references/smoke-reload-autostart/file-link-repair-evidence.json`。原失败及输出、工件 hash 见 `docs/references/smoke-reload-autostart/resource-drop-repair-evidence.json`。修前两次实际 `execution/linkOpened` 为 search/quickOpen，cwd 为初始 `/tmp/dscr`，此前输入已 cd 到 scratchDir。

## 接口与依赖

沿用 `getExecutionTerminalPathContext` 和 `resolveCwdForBufferLine`，在内部 `ExecutionTerminalPathContext` 中补充可选执行身份用于相对路径缓存。复用既有 tracker，不增加正文解析器、消息协议或运行时依赖。

修订记录：2026-10-10 建立修复计划，明确 read-only 目录来源、执行身份与原生验收边界。

修订记录：2026-10-10 完成产品与缓存接线，记录真实 helper 修前错误路径及自动化通过结果。

修订记录：2026-10-10 完成原生根因闭环与计划归档；保留后续 scrollback 旧正文断言的独立失败，未改 smoke 放行。
