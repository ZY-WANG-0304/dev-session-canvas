# 定位 Canvas ready 超时的页面启动边界

本 ExecPlan 按 `docs/PLANS.md` 持续维护。此任务为复杂设计调查，目标是提供可证伪的因果结论与复现证据。

## 目标与全局图景

PR #321 后 fallback 的真实窗口重开 verify 曾在 editor Canvas ready 等待20秒超时。原会话存活、generation5 ready=false，但 VS Code 只报告外层容器 ready。用户要求继续定位真实原因。本轮需在原操作与等待预算下捕获页面资源、脚本执行、React ready发送和Host生命周期接收，确定首个断点；若不可复现，准确缩小边界并保存可继续调查的证据，不把重跑通过写成修复。

## 进度

- [x] 从最新main a213b89b切出webview-ready-root-cause；PR #322/#323仍OPEN，保留其分支而不混入当前调查。
- [x] 复核原失败：generation5 editor active、ready/ack=false；原会话存活；原无Host事件/iframe资源执行工件。
- [x] R2原两阶段通过；R3/R4自然40/80次重放捕获第33与65次约16秒启动停顿，取得frame/资源/React/Host时间线。
- [x] R5只读worker记录确认32名额耗尽；C2容量4在第3次触发20秒超时，C3容量128的40次通过但保留积压。C1关闭节奏对照通过，原首败仍未归因。
- [x] 恢复五份源码与副本worker，原cache hash不变；build、N1原短workspace两阶段通过，原workspace状态干净；同步结论、索引、技术债、证据。
- [x] 完成本轮可独立review的调查交付，按工作流推送并创建调查PR；PR编号由GitHub元数据记录，不合并。
- [x] 2026-10-13，PR #323合入main `a6bb190a`后rebase调查PR #324，保留双方索引、核心原则和技术债；历史实验仍使用`a213b89b`输入，不改写历史hash，也不声称重跑实验。

## 意外与发现

前轮fallback F1/F2两次全场景通过，不证明原原因已修复。waitForCanvasReady检查active surface、可见和应用ready；不等待bootstrapAck。VS Code renderer webview ready只是容器通信可用，不能代表bundle已加载或React useEffect已发ready。

## 决策记录

2026-10-13：从原操作复现，加只读Chrome DevTools Protocol（浏览器调试协议，用于观察iframe网络/异常/DOM）与Host生命周期记录，区分资源失败、JS启动失败、React未commit、发送/传递失败、Host身份拒收。调查轮不更改smoke显式20秒ready预算、方法/测试命令默认15秒或其他实际调用点的等待，也不改恢复/resize，不给测试加sleep放行。控制实验仅证明相应机制，不能伪装成原故障再现。

## 结果与复盘

本轮有界调查已完成：确认连续重开上游请求积压→32名额耗尽→新资源排队机制及容量正反例。原单次generation5首败缺关键工件仍未知，保留技术债。没有产品修复，也不解除发布门槛。所有产品probe/控制恢复，留下可复用取证输入，后续按具名失败继续。

## 上下文与定向

调查轮的`tests/vscode-smoke/real-reopen-tests.cjs` activateExtension先打开editor再closeAllEditors，verify再openCanvasEditor并显式等20秒；这是历史smoke预算。后续PR #325的[等待预算设计](../../design-docs/smoke-reopen-ready-timeout.md)调整同fixture为最大45秒，ready提前满足即返回。方法/测试命令默认15秒只在实际调用时生效，普通打开没有这条ready截止或对应的超时反馈。`CanvasPanelManager.ts`负责surface lifecycle generation/frameId、renderedWebviewLifecycle与ready接收。`getWebviewHtml.ts`注入身份并引用dist/webview.js；`webview/main.tsx`在App useEffect中发送应用ready。`scripts/smoke/run-vscode-smoke.mjs`的systemd-fallback-real-reopen以提交前systemd不可用启动，再在同profile下实际关闭并重开VS Code。

## 工作计划

先冻结原日志哈希和待调查代码；在临时probe中输出每次Host surface事件。Native以独立短路径和原fixture运行，通过调试端口观察所有内层frame的请求/响应/失败、执行异常、DOM和ready发出。在正常baseline后批量快速关闭重开，同一等待不延长，捕获具体失败。只有在明确断点后选择针对性受控对照，恢复所有临时代码再复核。

## 具体步骤

工作目录为仓库根；Node固定22.23.3，PATH=/tmp/dsc-release-node22/node_modules/node/bin:$PATH。构建使用DEV_SESSION_CANVAS_EXECUTION_ASSETS_SET=/tmp/dsc-release-026-assets npm run build；Native使用DEV_SESSION_CANVAS_VSCODE_TEST_CACHE_PATH=/tmp/dsc0261v/.vscode-test，DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=systemd-fallback-real-reopen和独立DEV_SESSION_CANVAS_SMOKE_DEBUG_ROOT。运行node scripts/smoke/run-vscode-smoke.mjs。CDP脚本及临时patch保存在/tmp/dsc-ready-investigation，最终有用的工具/证据放docs/references/webview-ready-root-cause，不覆盖历史工件。

## 验证与验收

记录同一次render的surface/generation/frameId，资源请求和bundle执行、React effect发送ready、Host收到和接受/拒收。根因须能解释实际失败且受控移除该因素后通过，或明确只是候选机制。原会话身份、内容和20秒预算保持。至少一次恢复无产品probe的原两阶段通过/失败，记录完整退出状态。

## 幂等性与恢复

所有Native用独立目录；不复用原/tmp/dga12。只清理本任务结束运行的重复依赖，保留logs/artifacts。先检查调试端口空闲，不杀未知进程；临时代码备份并按差异恢复。诊断错误不能取代原失败或阻止清理。

## 证据与备注

原工件：docs/references/release-gate-fixture-ci-alignment/fallback-first-failure-summary.json；前轮PR #322的fallback-original-boundary.json。原renderer日志/tmp/dga12/fallback/systemd-fallback-real-reopen/artifacts/vscode-logs/window1/renderer.log。本次日志哈希/命令/退出结果在docs/references/webview-ready-root-cause/README.md与external-artifact-hashes.json，负对照c2-failure-*保留。

## 接口与依赖

无新产品依赖。使用已有Playwright/Node WebSocket建立CDP连接；临时Host probe仅记录surface/及webview/事件；应用probe仅标记启动和ready发送。正式结论写docs/design-docs/webview-ready-root-cause.md、索引和core-beliefs。

修订：2026-10-13创建，明确原始证据缺口和可证伪的调查顺序。

## 本轮实验与偏差

R1误将构建/启动并行，缺dist导致环境退出1，未进入页面，后续串行。R3第33次CSS等待15,466ms，应用ready15,862ms；R4第33/65次16,602/16,469ms。R4 CDP直接访问上游module binding产生probe自己的ReferenceError；R5在独立VSCode副本暴露只读引用并记录cache/acquire/host阶段。

R5第32次active=32、requests=32、waiters=2，旧已关闭页面字体请求30秒超时后放行。C1以80ms调度关闭40次不积压；C2只把容量改4，第三次20秒超时、原Agent/Terminal存活、pending=0；C3改128，40次最大507ms但仍有40个未完成请求。C2失败前未进入后续正文检查。重复worker attachment事件按run与JSON去重；不将重复行计作新请求。

原renderer没有Webview.loadLocalResource日志，比正常对照更早停在资源派发之前或之中，不能确定workerReady、inner frame、cache与派发哪个断点。原单次操作没有32请求积累证据，已明确否定直接外推。恢复源码后N1在/tmp/dscgate1012原短workspace、新独立profile完整通过。所有probe/控制均恢复，source SHA256与inputs.json一致，原VSCode worker SHA256=338e0c80993456b866ec1a544933117522600bf25c313c7c7efc94d2ca3fa0dd。

修订：2026-10-13完成本轮可复核调查，记录容量对照及原首败无法归因的限制；未运行完整发布门禁。

修订：2026-10-13，PR #325按review意见澄清历史smoke 20秒与后续最大45秒策略、方法默认15秒及普通打开行为。调查轮未扩大预算的事实与全部原始证据保留；本次仅修正文档，不重跑或改写历史实验。
