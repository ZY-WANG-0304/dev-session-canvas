# 文件条目 smoke 使用原生点击

本计划按 `docs/PLANS.md` 持续维护。

## 目标与全局图景

修正 PR335 文件活动测试：编辑器拥有焦点时，真实鼠标可以点击可见的 Panel 文件条目并打开文件。测试不能把 Webview 已获焦点作为鼠标输入前提。保留原 10 秒准备和点击期限、几何稳定/命中检查及所有打开文件后的断言。

## 进度

- [x] 2026-10-24：完成原 CI 工件与五组本地对照，确认测试前提过强。
- [x] 2026-10-24：实现原生输入及受控编辑器焦点回归，source 与原双包 packaged 各一次成功。
- [x] 2026-10-24：六类实际浏览器输入正反例通过；134 项预算和任务集合不变。
- [x] 2026-10-24：完整门禁合同 122/122 通过（Node 25.6.0）；Node 22.23.3 定向合同 3/3 通过，文档已同步。

## 意外与发现

原 CI run 39977098326 唯一直接失败为 source-host/execution-file-activity--views。10 秒内有 178 次 probe，请求间隔中位数 53ms，不支持扫描长时间阻塞。原 CI 最终 documentFocus=false，但没有完整焦点时序，不能认定自然触发原因。相同 CI 产品构建的本地受控编辑器夺焦使原 helper 186 次采样全部无焦点并超时；同控制条件原生点击 665ms 完成且整个场景通过。

## 决策记录

2026-10-24 实现修订：连接改为创建 Webview 前完成并复用到场景结束；晚连接在原 10 秒内无法取得已有跨进程 frame 的内层内容，原型轮询不能解决。初始化与首次扩展激活共用原 20 秒预算，单次点击的原 10 秒不变。

2026-10-24：使用已有 Playwright 通过 Chromium 调试协议（CDP）发送浏览器原生左键事件。共用 runner 仅为 execution-file-activity/views 开启本机随机端口，测试从独立 profile 的 DevToolsActivePort 读取端口。Playwright 来自 runner 的开发依赖，避免改产品包。放弃延长超时、直接移除焦点检查后保留合成事件、改变 Panel 产品焦点策略。

## 结果与复盘

已完成定位与修复，source 和 packaged 场景通过，编辑器持焦回归取得可信输入证据；完整合同 122/122、Node 22.23.3 定向合同 3/3 通过；134 项预算和场景集合不变，未遗留本轮 VSCode 测试进程。局部成功不能替代最新 head 完整 Actions 验收。

## 上下文与定向

`tests/vscode-smoke/extension-tests.cjs` 的 performWebviewDomAction 为 clickFileEntry 准备 surface/节点、采样稳定矩形，然后执行旧合成点击。`scripts/smoke/vscode-smoke-runner.mjs` 同时启动 source 与 packaged smoke。新增 `tests/vscode-smoke/native-file-click.cjs` 负责 CDP 连接、唯一 surface/node/file 定位、原生点击和断连；打包测试阶段已有整个测试目录复制规则。

## 工作计划

里程碑一：记录设计并修改共享 runner、测试 helper 和 Panel 焦点受控夹具。检查源文件不涉及产品代码。里程碑二：更新合同测试，覆盖无焦点、移动/遮挡、过期、拒绝和重复目标；重新生成预算清单并比较所有任务预算。里程碑三：在隔离临时目录运行 source 与 packaged 文件活动场景，核对可信事件和原有行为断言，保留日志并完成文档。

## 具体步骤

在 `/tmp/dsc335-deps` 运行 `node scripts/gates/build-smoke-budget.mjs`，然后 `npm run test:ci-gates`。真实 Host 需要现有 Node 22.23.3、缓存 VSCode 1.142.0 和 Xvfb；source 入口为 `node scripts/smoke/run-vscode-smoke.mjs --scenario execution-file-activity/views --diagnostic`。使用独立 DEV_SESSION_CANVAS_GATE_RUN_NONCE 和 DEV_SESSION_CANVAS_SMOKE_DEBUG_ROOT 防止影响其他运行。packaged 入口 `scripts/smoke/run-vscode-vsix-smoke.mjs` 需要原双 VSIX、package receipt 和 diagnostic plan，按冻结身份核验；不能重打包冒充原包。

## 验证与验收

回归强制让编辑器在首次 Panel 文件点击前获得焦点，采样证明 Webview 无焦点。原生 pointerdown/mousedown/click 必须可信，正确文件可见且后续断言全过。source 和 packaged 分别记录输入。合同测试证明过期/不稳定/遮挡/重复目标不能点击，业务点击不重试，连接退出不关闭 VSCode，预算和任务集合不变。

## 幂等性与恢复

测试连接在场景完成或单次点击超时后断开；每轮独立 profile 和日志目录。无需改系统 watcher 限制或产品包。修改保持局部，不推送或合并。

## 证据与备注

前置诊断保存在 `/tmp/dsc-focus-rca-g8w5cl0l/RESULTS.md`。原失败 artifact 12512986530；source 构建 artifact 12511614054，input 9aca2af73a2005f6b1d3926272bfab681ee22214；本地源码基线 40d78cdcccd612d1b3ae541df075bc8adbe263ea。环境有 ENOSPC watcher 警告，通过和失败对照均出现，不能把它写成已排除的所有运行环境风险。

## 接口与依赖

`initializeNativeFileInput(deadline)` 在创建 Webview 前连接，并与首次扩展激活共用原 20 秒预算；`nativeFileClick({ action, surface, deadline, signal, requireUnfocused })` 接收原单次点击绝对期限和取消信号。`closeNativeFileInput()` 在场景 finally 中断连。测试启动器声明 Playwright 的绝对入口，仅由测试加载。定位使用既有 window.__DEV_SESSION_CANVAS_WEBVIEW_IDENTITY__ 与 data-node-id/data-file-entry-path；不增加产品 test API。

2026-10-24：初始计划，记录已完成证据及最小修复边界。

2026-10-24 实现修订：晚连接 Playwright 无法取得 VSCode 已存在的跨进程 Webview 的内层内容 frame，三次定位失败保留在 source.log、source-2.log、source-3.log；source-4.log 记录完整 frame 诊断。改为创建 Webview 前连接，共享原 20 秒激活预算；source-5.log 与 packaged.log 均退出 0。此变更不增加单次点击预算，也不把新的适配器接入失败归因于旧 CI。

本地 packaged 复验使用原 CI artifact 12511718726 的 main/notifier 与 artifact 12511533083 的 plan，保留原 verifyPackageFiles 和 instrumentation 校验。临时入口只移除旧 frozen-plan 对当前源码的验证声明与本地缓存 VSCode override 限制，未改正式 runner；新测试代码与旧 plan 不构成正式冻结验收。双包 main SHA256 087f107b5a5a7c83bdbc023a1d844884af6bd56c90d9e839e1ed59f111e0eacd，notifier 484641d2cc7c3c5ce825ab10db0e3c2fec5e07e2df061ddf42a4e64411218f02。复验目录 `/tmp/dsc-native-fix-dperbt73` 保留日志、原工件、临时入口和包插桩回执。

2026-10-24 收口：证据摘要及所有本地日志 SHA256 见 `docs/references/file-entry-native-smoke/results.json`。未确认的历史自然夺焦及新 head 完整 Actions 待验边界已登记技术债；本地修复完成，不推送或合并。
