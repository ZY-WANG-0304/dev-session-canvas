# 修复旧 Supervisor 升级的 resize 验收

本 ExecPlan 按 `docs/PLANS.md` 持续维护。活文档必须同步进度、发现、决策和结果。

## 目标与全局图景

旧 Supervisor 升级后，Agent 和 Terminal 应继续使用原会话，卡片改变尺寸后原终端应跟随容器行列数。当前 smoke 把恢复期间第一次变化的原始行列数固定为目标，可能在正确 resize 后误报超时。本轮修复观察前提和断言，并在清理前保存可追溯的尺寸及请求证据。用户可运行 legacy-supervisor-upgrade 场景看到原输入、resize、新旧进程隔离和退出全部通过。

## 进度

- [x] 已读取交付、设计、计划和技术债流程；从最新 origin/main 的 a213b89b 切出 runtime-legacy-resize-convergence。
- [x] 确认 PR #322 尚未合并；本分支自包含记录必要根因，不携带其完整调查文档。
- [x] 增加只读 probe，建立恢复后的原会话基线和目标容器一致性等待。
- [x] 验证确定性瞬态、真实遗漏 resize、身份替换、期限及诊断失败保护。
- [x] 标准原生 N1/N2、受控迟到 fit C3 完整通过；漏 resize 原生 M1 在20秒内按预期失败并保存工件。
- [x] 同步正式设计、技术债和19次运行证据；完成计划归档。

## 意外与发现

前轮受控 C8 原生实验：初始 probe 为 92×28，首次变化为 67×21，最终页面和原 Agent 会话均为 82×27；189 次样本均与当前页面相同，均不等于固定的 67×21，原 20 秒断言超时。快照恢复会先 resize xterm，再完成异步 parser，随后 fit 容器并在 150ms 后报告尺寸。文字可见不足以证明恢复和 fit 完成。原证据来自 PR #322 的 d42656f7；逐字节副本现保存在 `docs/references/runtime-legacy-resize-convergence/investigation-native-control-c8.json`，来源和 hash 见相邻 `investigation-native-control-c8-provenance.json`。本轮不把受控根因追认为每次历史失败的完整原因。

Fallback 原 Canvas ready 首败仍缺 iframe 脚本执行证据；两轮真实重开通过不能确认其根因。当前 real-reopen-tests 已保存 Host 生命周期诊断，本轮不重复加入或推测产品修复。

新增浏览器用例首次重复发送同会话健康快照而被既有规则忽略，改为首次恢复；第二次在150ms请求报告前就断言，改等真实 resize 请求。第三轮发生 page crashed 和 terminal ready 超时，同时受控原生 C1 首次 probe 超时，磁盘仅余25MB，根因不追认。C2 staging ENOSPC 未进入场景；串行且空间充足后的 C3 和最终浏览器通过。

真实控制器测试显示 legacy paged checkpoint 完成不设置 projected identity；不改这一产品语义。该用例保留 pending，健康 identity 在当前 current-state 和 local 模式断言。M1 原 Host diagnostics 不含 resize 请求细节，因此 fixture 另记两次 resizeNode 的派发时间及目标。

## 决策记录

选择只读 FitAddon.proposeDimensions() 作为当前容器目标，额外观察原投影会话与待应用状态。先在旧卡片上等待容器、页面、原 Supervisor 收敛，再派发精确的新卡片尺寸，在单个 20 秒期限内等待两节点全部收敛且行列数相对基线改变。每次采样仍核对 Host binding、原输出和原 Supervisor 身份。不得固定瞬态、追加 sleep、重置期限、延长预算或强制 resize。日期：2026-10-12。

不修改 Runtime、fit 或 resize reporter 的产品语义。失败工件保存操作目标、基线、resizeNode 派发时间、每次有限采样、Host 快照和诊断事件；捕获失败不得覆盖原异常或阻止 finally 清理。

## 结果与复盘

实现和定向验证已完成。交付只收口已证实的 resize 夹具缺陷，Canvas ready 继续单独跟踪，完整发布门禁不得据此宣称通过。9项 helper、协议、50项真实控制器和10项Host batch、8项浏览器恢复/fit、类型检查和构建通过。C3基线33次/4961ms，resize19次/1925ms；M1漏Agent报告后191次、最后19968ms仍不等，按期失败。

## 上下文与定向

`tests/vscode-smoke/legacy-supervisor-upgrade-tests.cjs` 创建历史 5355e6a 的 Supervisor（原会话责任进程），再由当前扩展恢复其会话。`src/webview/main.tsx` 的 collectWebviewProbeSnapshot 读取 xterm，`src/common/protocol.ts` 校验跨页面测试消息。FitAddon.proposeDimensions 返回当前终端容器能容纳的整数行列数；原始 xterm.cols/rows 可能暂属于恢复快照。新 helper 放在 tests/vscode-smoke/terminal-resize.cjs，供原生 fixture 和确定性 Node 测试共享，部署 staging 已复制整个目录。

## 工作计划

先扩展 probe 的容器目标、投影身份和投影未完成字段；然后用有界 helper 替换首次变化等待及串行固定目标等待，保留所有正文、原会话、新旧进程隔离断言。增加协议非法字段测试与 Agent/Terminal 的真实 parser 暂停浏览器测试，证明瞬态不会通过。原生在未改产品及受控 fit 延迟两种情况下执行整场景。

## 具体步骤

全部命令在仓库根运行，使用 Node 22.23.3：PATH=/tmp/dsc-release-node22/node_modules/node/bin:$PATH。运行 npm run typecheck、npm run test:protocol-webview-messages、新 helper 测试。构建时设置 DEV_SESSION_CANVAS_EXECUTION_ASSETS_SET=/tmp/dsc-release-026-assets。浏览器缓存 PLAYWRIGHT_BROWSERS_PATH=/tmp/dscgate1012/.playwright-browsers。原生设置 DEV_SESSION_CANVAS_VSCODE_TEST_CACHE_PATH=/tmp/dsc0261v/.vscode-test、DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=legacy-supervisor-upgrade 和独立短 DEV_SESSION_CANVAS_SMOKE_DEBUG_ROOT，再运行 node scripts/smoke/run-vscode-smoke.mjs。完整命令、日志哈希及结果收录本轮 references。

## 验证与验收

瞬态快照和旧容器尺寸都不能成为新卡片目标；恢复仍在进行、页面未 fit、真实 Supervisor 未 resize、缺 marker 或身份变化均不能通过。每次 I/O 和返回必须处于同一期限内，迟到成功不得放行。两节点必须同一轮满足精确卡片尺寸、当前容器目标、页面和原进程一致且相对基线改变。超时证据必须保留所有观察，而非仅最后 session。

## 幂等性与恢复

只删除本任务已完成原生运行中的 smoke-host/node_modules 以释放 staging 空间，保留全部日志及工件。受控 product patch 在测试后恢复；提交前 diff 确保没有控制延迟。失败诊断 best effort，不影响原异常和既有会话清理。

## 证据与备注

前轮 PR：https://github.com/ZY-WANG-0304/dev-session-canvas/pull/322。本次证据入口为 `docs/references/runtime-legacy-resize-convergence/evidence.json`，包含19次运行、失败原因/未确认边界、最终源码哈希和标准/受控 stage 哈希。`native-positive-c3.json` 和 `native-negative-m1.json` 保留各次尺寸采样及原 identity；相邻两个 patch 可重放受控延迟和真实漏 resize。

## 接口与依赖

沿用 xterm、FitAddon、vscode.commands 和原 Unix socket attachSession。helper 接受显式 expectedNodes、getSnapshot/getProbe/getSession、timeoutMs、可注入 now/sleep、onSample；返回同一轮 snapshot/probe/sessions。无新运行时依赖。

修订：2026-10-12 创建，先记录确认根因、验收及未定位边界再实现。

修订：2026-10-12 完成实现与正反例验证，记录首次失败、残余边界并归档；PR交付信息由GitHub记录。

修订：2026-10-13 将 PR #322 的 C8 历史样本逐字节补入本地证据并记录来源 hash，修复主线引用缺口；没有重跑该实验。
