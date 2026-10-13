# 复验最新主线的发布前遗留问题

本 ExecPlan 按 `docs/PLANS.md` 维护。用户要求基于最新 origin/main 重新验证，确认 PR #319 合入后仍有哪些遗留问题。

## 目标与全局图景

在隔离工作树验证固定主线输入，交付通过、失败和未执行范围，以及可以复查的首败现场。重点核对此前双窗口删除、systemd 重开和 Webview 就绪超时；本轮不修改产品行为、测试断言、版本、发布契约或等待预算。

## 进度

- [x] (2026-10-12) git fetch origin；固定 origin/main `c32437ac008b1d933e9e13975e60c869e7bb33d4`，创建 `/tmp/dscmainv1012` 和主题分支 `docs-main-validation-2026-10-12`。
- [x] 确认原工作树只有未跟踪 `image.png`，保留原状；核对 #317 的旧失败及 #319 的有限验证范围。
- [x] npm ci、六目标原生资产经当前 build 来源校验、默认主扩展及 notifier 构建通过。
- [x] 门禁两组回归、完整Host634/634及root/startup/reader回归通过；npm test首败后56项非完整UI组成检查全部独立通过，原完整命令仍失败。
- [x] 独立恢复矩阵完成：本地七场景、trusted/restricted、普通/多根/单根切多根重开、双窗口、systemd user及Remote SSH通过；checkpoint、fallback和旧升级未通过，三次旧升级停点分别保留。
- [x] Webview全套首次实际执行424/424通过（12.0分钟）；原主题用例在全套中1.7秒通过，没有重试用例。
- [x] 固定主线ref的clean-checkout npm ci、VSIX打包及八场景安装smoke全部通过；notifier联动和en/zh-cn本地化通过。
- [x] 同步正式结论、技术债和85条执行记录的可复查证据；归档计划，交付范围仅包含文档与证据。

## 意外与发现

主线版本仍为 0.26.0，其 release:verify 有仅限该版的授权测试例外；0.26.1 静态契约尚未准备。直接运行该入口无法回答完整门禁是否通过，因此本轮分别运行完整路径的组成命令，不把结果标成 0.26.1 发布验收。

npm test首次在test-canvas-execution-context.mjs:708失败：关闭模式夹具仍期待root绑定不被阻止，实际返回runtime-persistence-disabled。PR319后的正式关闭模式规则拒绝共享绑定；该旧断言与新规则不一致。首败阻止后续组成命令，本轮已独立补齐56项非完整UI检查、完整源码smoke及全套Webview；失败脚本内部的后续断言仍未执行。

systemd-fallback-real-reopen在setup等待live失败；fake systemctl fail-start已有实际调用、startup-intent保留而未有started receipt，后续请求报告previous root runtime launch unconfirmed。现有runtimeRootPreparation提交后保留unknown且禁止换backend，旧fallback场景仍要求提交失败后自动切换，与正式契约冲突。提交前明确unavailable的允许fallback纯回归通过；真实该语义的重开fixture仍需对齐后验证，不能放宽unknown保护。

Webview首次命令停在Chromium1217下载0%，尚未开始用例。仅终止本任务的installer及下载子进程，复制本机已有同revision缓存到新工作树；随后首次实际全套424/424通过，无用例重试。该exit1属于环境准备中断，不计为Webview用例首败。

完整源码smoke首次通过前七个本地场景，停在Runtime checkpoint：只有8192字符的首分页时即严格要求104842，未等待后续分页。原#317分支已有等待收齐的窄修正，尚未合入main；原输入后续场景按独立场景继续。

检查PR317未合入的workflow准备修正后，以空PLAYWRIGHT_BROWSERS_PATH运行原marketplace-browser-e2e，实际报缺chromium_headless_shell-1217；本机已有缓存的同命令此前通过。main的PR/tag workflow均未预装浏览器，故本机暖缓存通过不证明冷runner就绪。该检查仅复验环境前提，没有启动浏览器或运行完整GitHub CI。

旧升级首轮在共享commit lease的127.0.0.1:24084占用处失败；测试结束后只读ss仍观察到该listener，未停止它。独立新目录lr2原样复验已进入旧Agent/Terminal实际附着与输入，随后在legacy-supervisor-upgrade-tests.cjs:259等待Terminal resize尺寸等于捕获probe20秒超时；原Terminal仍live、85x28、原webview/Host输入marker均在。没有expected probe持久快照，产品/夹具时序原因待定位。

仅追加一次新目录lr3原参数业务复验，越过旧resize段后，在legacy-supervisor-upgrade-tests.cjs:321连接新root会话报ENOENT：第318行仍使用旧resolver，请求旧dev-session-canvas/*.sock，而root地址应为/tmp/dsc-root-1115017707/d-1927a20608bfb7f73e2e508e.sock。新root owner及started receipt保留，generation为terminal-root-owner-linux-v1、backend为legacy-detached；PR317对应resolver修正尚未进入main。没有完整旧升级通过结果，lr3越过resize不覆盖lr2首败，也不将全部旧升级失败归为纯fixture。

## 决策记录

2026-10-12：固定最新主线提交并隔离日志、存储和测试目录，避免覆盖旧失败现场。使用 Node 22.23.3、VS Code 1.141.0 和经过当前构建来源校验的六目标原生资产。先验证原 systemd 阻塞，再运行完整 npm test；若完整命令首败，继续独立运行未触达的大套件和恢复场景，以形成完整的遗留清单。保留首次结果，只在证据需要区分偶发或确定性失败时有限原样复跑，不修改断言。

2026-10-12 01:12：发现主线发布workflow未包含旧PR317的浏览器准备时，补一次空浏览器缓存的原市场E2E入口，验证该具体CI前提；与业务失败及完整CI结果分账，不扩大成通用环境审计。

2026-10-12 01:23：旧升级首轮遇已有listener占用，因此换独立存储原样复验，不触碰该listener。出现旧Terminal尺寸等待失败后，仅增加一次业务稳定性复验，判断是否重复；任何后续通过均不覆盖首败，未知原因不提前定性。

2026-10-12：最终将遗留问题收口为五组门禁，以及旧升级的一次原因未明resize首败。保留全部85条执行记录和日志hash；以文档PR交付验证结论，产品、测试、workflow及0.26.1发布准备另行处理。

## 结果与复盘

本轮验证范围已执行完毕，原npm test和完整源码smoke仍exit1，完整门禁未通过。关闭模式旧断言、checkpoint分页过早断言、fallback夹具与提交后unknown规则冲突、CI冷缓存浏览器准备以及旧升级新root socket resolver分别登记到正式报告和技术债。旧升级resize首败没有expected probe持久快照，原因仍未知；后续一次越过不改变该记录。

systemd-user-real-reopen首次完整exit0，原20秒Canvas就绪失败未重现。全套Webview首次实际424/424通过，原主题用例1.7秒通过。完整Host634/634、56项独立后续组成检查、补充root/startup/reader、notifier联动及en/zh-cn均通过。固定主线ref的clean-checkout npm ci、正式打包和八场景VSIX安装smoke完整exit0，含trusted。源码前七本地场景及独立trusted/restricted、普通/多根/单根切多根重开、双窗口、systemd user和loopback Remote SSH均通过。

所有通过结论只对应固定提交、Linux本机和各命令实际执行范围；systemd为fake systemctl，Agent为fake provider，Host wiring为受控non-native Host。真实provider、macOS/Windows、真实远端长断开、完整UI分阶段接管、真实多root双窗口和公开市场安装不由本轮代证。独立补验用于确定遗留范围，不能拼成原完整命令通过；旧超时未重现也不证明其根因。未修改产品或测试，未准备发布输入，未运行0.26.1预合并/tag verify。

## 上下文与定向

`scripts/release/release-preflight.mjs::runFullVerification` 的完整路径依次执行 release preflight 两组回归、npm test 和 HEAD clean-checkout VSIX。`package.json::test` 在单元及市场测试之后运行源码 VS Code smoke 与全套 Webview；首败会阻止后续命令。`scripts/smoke/run-vscode-smoke.mjs` 支持场景过滤，可独立验证后续场景。systemd-user-real-reopen 是模拟 systemctl 包装下的两次真实 VS Code 启动，不代替真实 Remote SSH 长断开人工验收。#317 旧现场 setup 成功，verify 等 editor Canvas ready 20 秒超时，后续 fallback/Remote SSH 未跑；Webview 首次423/424、单独原样复跑通过。#319 修复共享画布与最后窗口清理，未重跑完整 npm test。

## 工作计划

第一里程碑准备隔离输入：npm ci、默认 build、核对版本和原生来源摘要。第二里程碑完成完整测试及原 systemd 定向，记录首败；有失败时仅运行原命令和原场景，补齐未触达验证，不把复跑绿色覆盖首败。第三里程碑导出固定提交进行独立 clean-checkout 打包及安装 smoke，补 notifier 验证。第四里程碑把具名失败和覆盖缺口写入设计报告、索引和技术债，归档本计划。

## 具体步骤

工作目录 `/tmp/dscmainv1012`。公共环境为 PATH 的首项 `/tmp/dsc-release-node22/node_modules/node/bin`、DEV_SESSION_CANVAS_EXECUTION_ASSETS_SET=/tmp/dsc-release-026-assets、DEV_SESSION_CANVAS_VSCODE_TEST_CACHE_PATH=/tmp/dsc0261v/.vscode-test、短独立 smoke debugRoot 及 Marketplace TMP 根。各运行使用 umask 0077；日志放在新目录 `/tmp/dmv12`。

    npm ci
    npm run build
    npm run build:notifier
    DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=systemd-user-real-reopen,systemd-fallback-real-reopen npm run test:smoke
    npm run test:release-preflight
    npm run test:release-preflight-workflow
    npm test
    node scripts/test/test-host-execution-owner-wiring.mjs
    npm run test:runtime-root-ownership
    npm run test:runtime-root-preparation
    npm run test:runtime-supervisor-startup-profile
    npm run typecheck:notifier
    npm run test:notifier-smoke
    npm run test:notifier-locale-smoke
    npm run validate:clean-checkout:vsix -- --ref c32437ac008b1d933e9e13975e60c869e7bb33d4 --keep-temp

若 npm test 未执行 Webview，独立运行 npm run test:webview；若源码 smoke 首败，按原场景过滤依次补后续恢复矩阵。执行后的准确命令、环境、退出码、日志摘要与 hash 写入精简 JSON 证据。

## 验证与验收

完成标准是每个计划范围都有首次退出结果或明确的未执行理由，首败保留日志及 artifact，旧失败有本轮对应结果。所有正式产品和测试源码必须与固定主线相同。完整测试存在任一失败时，不能宣布发布门禁通过。

## 幂等性与恢复

每个首次运行使用独立短路径；复验改用新路径保留原场景。测试仅清理自身 runtime，不停止用户运行中的 Supervisor。若诊断需要产品修改，先结束本轮验证并建立独立修复计划。推送文档前再次 fetch/rebase main；若主线产品输入变化，明确报告本轮固定基线，不能把旧结果重标为新主线结果。

## 证据与备注

正式报告为 `docs/design-docs/main-validation-2026-10-12.md`，遗留登记为 `docs/exec-plans/tech-debt-tracker.md` 的2026-10-12条目。`docs/references/main-validation-2026-10-12/evidence.json` 收录85条执行记录、固定源码和原生资产摘要、VSIX hash及关键工件hash；本机日志和工件根为 `/tmp/dmv12`，日志hash逐项核对。JSON绝对路径定位本次现场，不保证其他机器可访问。

原npm首败为 `/tmp/dmv12/npm-test.log`，checkpoint首败为 `/tmp/dmv12/source-smoke-full.log`，fallback为 `/tmp/dmv12/systemd-fallback.log`，CI冷缓存为 `/tmp/dmv12/cold-browser.log`，旧升级三次日志分别为 `/tmp/dmv12/source-legacy-supervisor-upgrade.log`、`/tmp/dmv12/source-legacy-recheck.log`、`/tmp/dmv12/source-legacy-stability.log`。关键观察摘要如下：

    npm test: actual runtime-persistence-disabled, expected undefined
    checkpoint: actual 8192, declared 104842
    fallback: The previous root runtime launch is unconfirmed.
    Webview: 424 passed (12.0m)
    Host execution owner wiring: 634/634 passed (selected 634/634; non-native only).
    legacy lr3: ENOENT on old socket; root startup receipt is started

固定提交clean-checkout最终主VSIX位于 `/tmp/dev-session-canvas-clean-checkout-W5GzG1/repo/dev-session-canvas-0.26.0.vsix`，5998878字节，SHA256为 `5eb89fee1ee9ae1a3564aaad9db8c509571e872aa53d8d2480d652ec604eeb60`。原旧 systemd 日志 `/tmp/dsc261latest-platform-smoke.log` 和工件 `/tmp/d26lplat/systemd-user-real-reopen/artifacts` 保留。

## 接口与依赖

使用现有 npm scripts、Playwright、VS Code smoke 和 clean-checkout packager，不新增产品接口或测试依赖。

修订记录：2026-10-12，建立本轮验证范围、固定输入和首败保留规则。

修订记录：2026-10-12 00:42 +0800，记录环境准备和systemd user首次完整通过，保留旧超时根因未知。

修订记录：2026-10-12 00:47 +0800，记录npm首败、fallback停点及浏览器缓存准备中断，明确剩余独立测试范围。

修订记录：2026-10-12 00:54 +0800，记录固定主线clean-checkout VSIX八场景全部通过及notifier验收，开始补验npm首败后的组成命令。

修订记录：2026-10-12 00:57 +0800，记录56项后续组成检查全部通过；全套Webview实际执行和源码恢复矩阵仍待完成。

修订记录：2026-10-12 01:08 +0800，记录全套Webview424/424首次实际运行通过，开始完整源码smoke；旧主题超时未重现但未追认旧根因。

修订记录：2026-10-12 01:12 +0800，记录源码checkpoint分页过早断言及冷缓存浏览器前提失败，明确旧PR317修正仍未进入主线。

修订记录：2026-10-12 01:23 +0800，回收恢复矩阵通过结果，记录旧升级端口占用与新目录业务resize失败，追加一次有限稳定性核对。

修订记录：2026-10-12，回收最后一次旧升级socket停点，完成报告/索引/原则/技术债/85条证据同步，归档验证计划；完整门禁仍失败，旧resize原因保留未知。
