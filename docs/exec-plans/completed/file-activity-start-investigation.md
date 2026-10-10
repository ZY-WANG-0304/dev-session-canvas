# 定位文件活动用例的第二项 Agent 启动等待

本计划按 `docs/PLANS.md` 持续维护。

## 目标与全局图景

定位 PR #314 基线 `051b5adf` 的 `verifyFileActivityViewsAndOpenFiles:3795` 等待第二项 Agent live 超时。区分尺寸未上报、启动准入拒绝、自动重试与 UI 状态残留，明确测试及产品各自的边界。本轮不正式修改产品或 smoke。

## 进度

- [x] 核对原失败工件，第二项已发出带尺寸的 startRequested，随后 rejected-before-acquire。
- [x] 原生隔离复现两项创建，观察实际启动准入；只等待原 started 后再创建作为对照。
- [x] 核对拒绝后 pendingLaunch/starting 保留与页面去重语义，验证手动重试。
- [x] 同步证据、设计和技术债，归档到 PR #314。

## 意外与发现

节点摘要仍写等待尺寸，但实际两项均请求 66×21；第二项在第一项 started 之前被拒绝，保存责任 not-required。不能把 UI 摘要当作启动链停点。

## 决策记录

2026-10-11：使用相同打包产品的独立目录，保留原文件活动用例从配置到两项 live 的前缀；仅调查启动前提，不继续文件读写。原序、只读准入探针、串行 started 三个模式；必要时在失败后做显式重试，单独记录结果。

## 结果与复盘

已确认独立 fixture 并发自动启动触发 starting=1 拒绝；尺寸已上报。原序/探针复现，串行 first-started 对照通过原两项 live，失败后显式重试成功。另确认新建节点拒绝后仍保留 starting/pendingLaunch/等待尺寸的产品状态表达缺口。正式代码未改，修复边界登记技术债。

## 上下文与定向

工作树 `/tmp/dscr`，分支 `investigate-smoke-reload-autostart`。`tests/vscode-smoke/extension-tests.cjs::verifyFileActivityViewsAndOpenFiles` 连续调用两次 testCreateNode，然后等待两项 live。节点创建不是进程启动完成。`extensions/vscode/dev-session-canvas/src/panel/executionSessionAdapter.ts::ExecutionAuthority.beginStart` 限 starting=1。`executionSessionNodes.tsx` 对 pendingLaunch 使用 autoLaunchRef 去重；`CanvasPanelManager.ts::reportWebviewExecutionStartFailure` 报错但不覆盖准入拒绝的既有节点状态。

## 工作计划

第一里程碑关联原请求尺寸、执行身份、准入和 started 时序。第二里程碑比较原序与串行创建，验证同包执行成功是否取决于等待原 started。第三里程碑明确新建节点 pending 状态是否具有用户可达的呈现缺口，不能把合法拒绝等同产品必须排队，也不能把等待摘要当作仍有运行中的请求。

## 具体步骤

在 `/tmp/dscr` 恢复 `.debug/rca/node_modules`，使用 Node22 `/tmp/dsc-release-node22/node_modules/node/bin/node`，VS Code `/tmp/dsc0261n/.vscode-test/vscode-linux-x64-1.141.0/code`，资源集 `/tmp/dsc-release-026-assets`。复制 `.debug/vscode-vsix-smoke/smoke-host`，以 `scripts/smoke/vscode-smoke-runner.mjs` 和 xvfb 运行 `docs/references/smoke-reload-autostart/file-activity-start-investigation.mjs baseline|probe|serial`。工件保存在 `.debug/file-activity-start/`。

## 验证与验收

按原 executionId 说明被拒请求是否取得资源，探针检查 identityMatch、closing、blockedReason、starting 集合。串行对照必须保持产品 hash 和原 live 断言，明确只验证启动前缀。显式重试只能作为独立恢复对照，不追认原场景通过。

## 幂等性与恢复

每轮独立目录，记录后停止自己的 Agent/Terminal，退出 VS Code并归还依赖链接。不操作其它 Supervisor 或原用户工作树。

## 证据与备注

原工件：16:37:11.497 第一项 startRequested，.594 第二项 startRequested，.601 第二项拒绝，.681 第一项 started；第二项没有 started。

## 接口与依赖

不新增正式接口。调查脚本和精简证据入库 `docs/references/smoke-reload-autostart/`。既有准入契约见 `docs/product-specs/runtime-persistence-modes.md`。

初稿：固定启动前缀、准入观察和状态解释范围。

完成修订（2026-10-11）：三轮原生前缀验证与现有 Host overlap 2/2 完成。串行对照实际两项均记录 started；调查脚本 exit0 不代表失败原序通过。证据为 `docs/references/smoke-reload-autostart/file-activity-start-evidence.json`，全流程文件读写、完整 gate 与真实 UI Start 点击未验证。全部本轮进程退出，local execution 清零，依赖链接归还。
