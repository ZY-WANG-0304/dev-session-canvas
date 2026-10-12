# 定位旧升级 resize 与 fallback 页面就绪超时

本 ExecPlan 是活文档，按 `docs/PLANS.md` 持续维护。任务是定位原因，形成可复跑证据及正式结论；不以延长等待、放宽断言或偶然通过代替因果验证。

## 目标与全局图景

PR #321 已合入主线 `a213b89b8c1dcaaec291e896042acc8627a05668`，五组测试与 CI 前置对齐完成，但完整 npm test 在旧 Supervisor 升级的 Agent 尺寸一致性等待中失败，fallback 的首次真实重开也出现页面 ready 超时。先补全页面、扩展宿主（Host）与独立执行进程（Supervisor）的时间线，优先区分页面捕获了过渡尺寸、Host 漏发或乱序、Supervisor 未应用等候选原因。对 fallback 单独核对页面加载与 ready/bootstrap 握手，不能从原会话存活推断页面已就绪。

## 进度

- [x] (2026-10-12) 阅读工作流、计划和设计规范，检查原失败工件，创建最新 origin/main 的主题分支 `runtime-timeout-root-cause`。
- [x] 保存原输入 hash，补充不改变断言的定向诊断。
- [x] 三轮原生基线通过；C8 同类20秒超时，固定67×21而原session/最新页面82×27；浏览器两项移除产品探针后通过。
- [x] 原失败定位到插件ready前；两轮两阶段通过，原首败具体原因证据不足，保留待定位。
- [x] 同步正式设计、索引、core beliefs、技术债和验证记录，移入 completed；移除全部产品/测试临时改动，最终原生旧升级通过。
- [x] 完成JSON、原输入/日志/reference hash、5份patch可应用、文档链接及产品/测试原字节一致性校验。
- [x] 定位交付资料形成可独立说明的一组改动，按主题分支流程交付；合并和后续修复不属本定位范围。

## 意外与发现

原生定向R1/R2/R4完整通过，页面初始fit与在途旧snapshot交错；C8原测试固定67×21，189次实际session和最新页面都为82×27，20秒超时。C6/C7则卡在更早的probe变化谓词。R3复制依赖时ENOSPC，清理本轮复制依赖后继续；最终无探针R-final又在共享commit lease端口36758占用首败，失败后查询端口已无listener，不终止未知主体。所有结果分别保留。

原 resize 工件仅保留 Supervisor 最后尺寸 82×27，未保存期望 probe（页面终端观察）的尺寸；无法据此确认 PTY 丢失 resize。后续定向三场景通过也不关闭这个问题。fallback 首败保留 editor generation 5、ready/ack=false 和存活的 legacy 会话，仍需读取原 Host 与 VS Code 日志。

## 决策记录

2026-10-12 / Codex：C8的单一被测因果是固定过渡尺寸，而非漏发；受控改变只扩展正常布局/观察时序，保留原20秒与几何断言。将其结论限制为可证的测试前提缺口，不追认历史未知期望。后续修复应核对有效当前目标，单纯sleep或提高预算不足以解决契约。fallback两轮正常通过后保留首败具体原因未知，不再重复试跑求根因。

2026-10-12 / Codex：以诊断和因果对照为当前交付范围。保持原 20 秒等待及尺寸、内容、身份断言；临时产品探针只用于本地实验并以 patch 保存，交付前移除。新结论只覆盖实测输入，不追认历史失败的未采集瞬态。

## 结果与复盘

最终无产品探针旧升级R-final2完整通过，产品源码和正式测试恢复HEAD原字节。发布完整门禁与fallback具体根因/测试修复由后续任务继续，当前有限定位任务按明确边界结束。

已确认resize测试以首次变化probe作为固定目标的前提缺口，受控原生同类超时及浏览器对照成立。历史首败期望缺失，不能逐次追认根因。fallback定位到插件ready前，原工件无法细分资源加载/JS/消息过滤；两轮正常握手通过，首败仍未知。未完成发布门禁。

## 上下文与定向

`tests/vscode-smoke/legacy-supervisor-upgrade-tests.cjs` 启动 `5355e6a` 的历史 Supervisor、创建 Agent/Terminal，以当前插件重连，改变卡片尺寸，捕获 xterm 页面列行数，再要求原 session 与捕获值相等。`extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts:resizeExecutionSession` 接收页面尺寸并调用 client；页面 fit（按照 DOM 尺寸计算终端列行）可能产生多个尺寸。`tests/vscode-smoke/real-reopen-tests.cjs` 在独立 setup/verify 两个 VS Code 进程中验证 fallback；`waitForCanvasReady` 等 editor active/visible 与 ready；bootstrapAck是后续独立阶段。原证据位于 `docs/references/release-gate-fixture-ci-alignment/`，原日志与工件 `/tmp/dga12`，不覆盖它们。

## 工作计划与里程碑

第一里程碑建立固定输入和新独立运行目录，诊断捕获前后页面尺寸、Host 接收/完成顺序及实际 session；通过当前原生场景获得完整时间线。第二里程碑沿具名候选设置确定性屏障或单变量对照，确认哪一层造成失败，并移除临时产品探针后复验。第三里程碑分析 fallback 原握手和 VS Code renderer 日志，必要时按原条件重开复验。将确认事实、候选解释和无法外推的历史边界分开写入正式设计及技术债。

## 具体步骤

从仓库根执行；使用原 Node 22.23.3（`/tmp/dsc-release-node22/node_modules/node/bin`）、VS Code 1.141.0 缓存（`/tmp/dsc0261v/.vscode-test`）、已核验原生资产（`/tmp/dsc-release-026-assets`）。先 build；再以 `DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=legacy-supervisor-upgrade` 或 `systemd-fallback-real-reopen` 执行 `node scripts/smoke/run-vscode-smoke.mjs`。实际设置独立短 `DEV_SESSION_CANVAS_SMOKE_DEBUG_ROOT=/tmp/dti-<run>`，runner自身用该目录/tmp作为宿主TMP；本轮未使用HOST_TMP_ROOT覆盖。每次运行记录环境、命令、退出码和日志 hash。当前工作树的未跟踪或无关用户文件保持原状。

## 验证与验收

resize 的验收是同一原会话的页面目标、Host 接收/提交及 Supervisor 实际尺寸能够逐事件比对，受控对照能够稳定验证候选因果。诊断预期成立不等于产品修复。fallback 必须根据原日志或可控同类失败定位，不能只以再次通过宣布修复。不要求此次定位执行全量发布门禁；完整 npm test、VSIX、其他平台和真实 provider 的状态保持原有边界。最终diff、JSON、文档链接和证据hash校验通过，5份调查patch均通过git apply --check；正式产品及测试源码与HEAD原字节一致。

## 幂等性与恢复

每轮使用不同 debug 目录并保留首败。只沿原 scenario finally 和明确属于本轮的 socket/session 清理，不终止未知 listener，不删除用户数据。临时探针保留可复跑 patch 后从产品源码移除，原日志不改写。

## 证据与备注

原输入与命令/环境/退出结果/log hash：`docs/references/runtime-timeout-root-cause/evidence.json`。C8原生精简时间线、原始189次采样hash与反事实判据：`native-control-c8.json`；复跑时先在独立checkout执行 `git apply docs/references/runtime-timeout-root-cause/native-transient-control.patch`，再build和过滤legacy-supervisor-upgrade运行。C8有意保留原错误断言，预期20秒失败；它不修产品。浏览器使用 `browser-transient-characterization.patch` 后build，执行 `node node_modules/@playwright/test/cli.js test --config=playwright.config.mjs --grep "diagnosis captures transient" --workers=1`，预期2项通过。最后移除patch。baseline-r4保留实际page snapshot/fit/report与Host/session时间线；F1/F2的握手和原fallback边界分别存放。C1至C7未得到相同失败或卡在不同位置，以及ENOSPC/lease失败均记录在evidence，不覆盖它们。原始日志留存/tmp，参考patch本身不可当作已采用修复。

## 接口与依赖

复用现有 VS Code test commands、Webview probe、Host diagnostic events 和 Supervisor socket 请求，不引入新运行时接口或依赖。证据摘要写入 `docs/references/runtime-timeout-root-cause/`；正式结论写入 `docs/design-docs/runtime-timeout-root-cause.md`，并同步索引与技术债。

修订说明：2026-10-12 创建调查计划，明确诊断与发布验证的边界。

修订说明：2026-10-12 补充三轮基线、C8同类失败、移除探针浏览器对照及fallback两轮通过；明确历史现场证据限制、环境失败和后续修复范围。

修订说明：2026-10-12 完成189次原生样本对照、reference/log/input hash、JSON与文档链接校验；5份patch可在固定基线应用，交付仅保留文档与参考证据。
