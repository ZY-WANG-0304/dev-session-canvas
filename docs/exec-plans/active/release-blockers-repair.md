# 修复四项发布验证阻塞

本 ExecPlan 按 `docs/PLANS.md` 维护。用户于 2026-10-09 要求在 PR #310 继续修复；使用 `/tmp/dsci` 的 `docs-release-blockers-investigation` 分支，基线 origin/main@f57b11f9，保留原调查提交。0.26.1 发布仍取消。

## 目标与全局图景

让双扩展清单检查在干净构建中成立，主题断言跟随真实组件，窄节点中的带样式折行路径可准确打开行列目标，本地 owned 执行提供真实 started 诊断，相对 shell smoke 可从实际输出验证 cwd。原调查证据保留，正式方案和实现结果写回 `docs/design-docs/release-blockers-investigation.md`，混合折行规则同步既有终端链接设计。

## 进度

- [x] (2026-10-09) 核对 PR head 与 origin/main，确认原工作树未改，读取调查证据和实现边界。
- [x] (2026-10-09) 移开两份 dist 后原 npm 清单入口自动构建并通过；完整主题命令通过。
- [x] (2026-10-09) 原硬折行 22/22 通过；新增混合折行 12/12 通过，保留三片段 hover、样式/缩进/prose/行数边界。
- [x] (2026-10-09) started 定向用例修前 0/1 失败、修后 3/3 通过，完整 Host 336/336；shell 用例改为同会话快照/真实输出证据。真实包待回收。
- [ ] 回收完整 Webview、相关 Host 接线、干净打包 smoke 与完整 npm test 的实际结果。
- [ ] 同步文档和技术债，提交并更新 PR #310。

## 意外与发现

既有根因已在调查计划中验证：notifier/dist 前置缺失；主题断言错误绑定 main；恢复后 fit 把 120 列输出压到 64 列导致 isWrapped 中断；owned local 确认启动后未发 execution/started。原 shell 实际启动与 PWD 输出均正确，不能通过增加 timeout 修复。

## 决策记录

- 决策：用户已授权修复，在原 PR 追加实现而不重开版本发布。理由：保持诊断与修复可追踪。日期/作者：2026-10-09 / Codex。
- 决策：清单测试入口显式 build 主扩展和 notifier；主题检查实际导入与使用者。理由：独立入口不依赖历史产物，不补无用代码。日期/作者：2026-10-09 / Codex。
- 决策：只扩展 styled 文件链接的混合折行，保持 URL 路径行为及原四个物理行上限。软续行须从首列延续同样式，硬续行须保留原缩进要求；片段保留真实 cell 范围。理由：直接修复原窄节点问题，同时限制误拼接与扫描成本。日期/作者：2026-10-09 / Codex。
- 决策：本地 started 诊断只在 operation.first 确认 started 后记录，携带原执行身份及实际启动参数。shell smoke 同时核对诊断、真实输出和启动快照，不要求任意后续时刻仍 live。理由：诊断契约与短命进程行为均应准确。日期/作者：2026-10-09 / Codex。

## 结果与复盘

四项实现与定向验证已完成；完整 Webview 与真实包验证待回收。调查原失败仍保留。只修复上述四项，不升级版本、不合并或发布。

## 上下文与定向

根 package.json 的 test:package-vsix-file-list 调用 `scripts/test/test-package-vsix-file-list.mjs`，依赖两份 dist；主题脚本在 scripts/test/test-theme-color-tokens.mjs，实际状态呈现组件在 canvasNodeChrome.tsx。Webview `executionTerminalNativeInteractions.ts` 使用 xterm 单元格的样式与物理坐标生成路径候选，硬换行指真实 CRLF，软换行指 xterm 行的 isWrapped 标记。Host `CanvasPanelManager.startNonNativeHostExecution` 是默认 native owner 本地执行共用路径，字段名来自早期测试实现。`tests/vscode-smoke/extension-tests.cjs` 的相对 shell 用例同时验证 workspace 相对可执行文件和独立 cwd。

## 工作计划

第一里程碑修测试编排与主题源码范围，在移开旧 dist 的条件下调用正式清单测试，并完整运行主题命令。第二里程碑扩展 styled 扫描对软续行的读取，保留每个真实片段；运行原两项失败与新混合折行/负例，再完整 Webview。第三里程碑用现有 Host wiring fixture 增加 started 身份/实际参数、无资源拒绝不发事件的回归，再实现事件；shell 用例读取同会话启动快照与输出 marker。最终回收默认 build、typecheck、Host suite 与 clean-checkout VSIX smoke，并按结果更新 PR 描述；若出现其他历史阻塞，保留原失败、明确归因，不能扩大修复范围或标记完整门禁通过。

## 具体步骤

工作目录 `/tmp/dsci`，Node 22：`PATH=/tmp/dsc-release-node22/node_modules/node/bin:$PATH`，默认 build 使用 `DEV_SESSION_CANVAS_EXECUTION_ASSETS_SET=/tmp/dsc-release-026-assets`（同原生输入校验）。浏览器缓存软链接 `.playwright-browsers` 指向 `/tmp/dsc026v/.playwright-browsers`。

    npm run test:package-vsix-file-list
    npm run test:theme-color-tokens
    npm run typecheck
    npm run build
    node scripts/test/run-playwright-webview.mjs --grep 'hard-wrapped'
    node scripts/test/test-host-execution-owner-wiring.mjs
    npm run test:webview
    npm run validate:clean-checkout:vsix -- --keep-temp

完整 npm test 的 Marketplace host/debug tmp root 和 smoke debug root 使用短 `/tmp` 路径以避开已知 socket 长度限制；VS Code 可复用 `/tmp/dsc0261v/.vscode-test/vscode-linux-x64-1.141.0/code`，通过 DEV_SESSION_CANVAS_VSCODE_EXECUTABLE 指定。clean-checkout 默认验证已提交 HEAD，因此实现提交后再执行。日志在 `.debug/release-blockers-repair/` 或 `/tmp/dsc310-*.log` 保留。

## 验证与验收

原构建/主题错误不再发生；原两项行列路径用例在默认窄节点通过，并验证续段软折行、样式改变/prose/缺缩进不误连及行数上限；Host 成功路径恰有一次 started，身份与实际 spec 一致，拒绝不发成功事件；真实包相对 shell 用例检测到 started、live 快照和同会话实际 PWD 输出。完整 suite 结果如实列出，不能把本次修复通过外推未执行路径。

## 幂等性与恢复

只改独立工作树。移开的旧 dist 放忽略调试目录，失败可重建；实验产物不提交。测试只能清理自己的临时工作区与执行。推送前 fetch/rebase，若目标前进则复核影响；需要改写 PR 历史时使用固定旧远端 head 的 force-with-lease。

## 证据与备注

修前证据为已提交调查文档中的父/子原脚本和实际 Host 消息。修后记录补充到本文与正式设计，不重写历史失败为成功。

## 接口与依赖

不加依赖或协议类型。继续使用既有 ExecutionTerminalFileLinkCandidate、每物理片段 IBufferRange、Host 诊断 recorder 与原 smoke 消息查询接口。URL 重建、Host 文件验证、快照恢复后 fit 与扫描总物理行上限保持既有规则。

修订记录：2026-10-09，收到原 PR 修复授权后创建计划，明确四项修复与验证边界。

修订记录：2026-10-09，记录首轮全部定向回归和 Host 全套。新增中文前缀首版实际未触发软折行，hover 为 2 段；延长前缀使其真实跨行后 3 段通过，未改变产品断言目标。
