---
title: 四项发布验证阻塞定位与修复
decision_status: 已选定
validation_status: 已验证
domains: [执行编排域, VSCode 集成域]
architecture_layers: [宿主集成层, 画布呈现层, 适配与基础设施层]
related_specs: [docs/product-specs/runtime-persistence-modes.md]
related_plans: [docs/exec-plans/completed/release-blockers-investigation.md, docs/exec-plans/completed/release-blockers-repair.md, docs/exec-plans/completed/release-validation-followups.md, docs/exec-plans/completed/pr310-hardwrap-review-boundary.md]
updated_at: 2026-10-09
---

# 四项发布验证阻塞定位与修复

> 2026-10-09 后续状态：PR #310 已合并，用户重新授权 0.26.1 发布准备。本文的取消发布、未恢复发布和旧验证结论均保留各阶段历史含义；本轮发布输入与重新验证见 `docs/exec-plans/active/release-0-26-1-prep.md`。

## 背景与范围

用户于 2026-10-09 取消 0.26.1 发布，准备 PR [#308](https://github.com/ZY-WANG-0304/dev-session-canvas/pull/308) 已关闭，release 分支的计划已归档。没有合并、tag 或发布。调查阶段基于 `origin/main@f57b11f970ce27f28c731d81a2ed3228ba27f67d`，只定位四项失败，交付根因、引入过程、复现证据与修复边界；当时没有修改产品、测试断言、版本或门禁。用户随后要求在 [PR #310](https://github.com/ZY-WANG-0304/dev-session-canvas/pull/310) 继续修复，新增实现提交为 `8d432d41`，不恢复版本发布。

原发布验证中，全量 Webview 为 380 passed / 2 failed；完整 verify 先后暴露 notifier 产物缺失和主题源码断言，独立 clean-checkout VSIX smoke 暴露相对 shell 等待超时。它们不属于同一根因，也不因取消发布而自动解决。

## 正式方案：四项修复

2026-10-09 用户要求在 PR #310 继续修复。下文原调查证据保持历史口径；本节记录新增实现方案，修后结果单列，不恢复 0.26.1 发布。

清单检查由根 test:package-vsix-file-list 入口先构建主扩展及 notifier，再执行原 staging/文件断言。主题检查分别验证 main 的标签 descriptor 和 canvasNodeChrome 等实际呈现模块的共享 tone 使用，保留 CSS/token 与共享映射检查。

styled 文件链接在四个物理行上限内支持软/硬混合折行。首片段仍须贴行尾；软续行从第一列延续相同 ANSI 样式，硬续行仍要求允许的缩进；前片段后的 prose 不可被跨越。必须实际经过硬换行才属于 hardwrap 候选，纯软换行继续由现有 detector 处理。每物理片段独立保留 cell 范围，点击与 hover 使用原映射；URL 检测、Host 路径验证与长度/候选数限制不放宽。不会取消恢复后 fit 或加宽原失败用例。

`extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts` 的 `startNonNativeHostExecution()` 在 operation.first 返回 started 后记录 execution/started，以原 executionId、kind/nodeId 与实际 file/cwd/尺寸关联，失败/拒绝不记录成功。相对 shell smoke 保留 metadata 和 started 校验，改为核对同会话已交付 live 快照与真实 PWD marker，不要求短命进程在后置轮询时仍存活。

## 后续修复方案（2026-10-09）

用户继续授权修复已登记后续项。模板按钮/文案断言改为检查实际 `fileNoteNodes.tsx`，main 的编排断言保持；QuickPick 用例在本例结束时清理自己创建的 Agent，复用 `resetCanvasAfterFinalPersistence` 的原身份保存检查、原 20 秒总预算及最多一次显式再次 reset，保留保存失败与未知结果的拒绝。生产 reset 契约不改。

hover 的只读探针与行 replaceChildren 调用栈确认：链接命中和下划线 show 已成功，随后 `SelectionService._refresh → RenderService.handleSelectionChanged → DomRenderer.renderRows` 重建行并丢失 underline；linkifier 仍保存相同且 hovered/underline=true 的链接。该直接选区绘制没有普通 viewport render 的链接重验证通知。固定尺寸现场没有再次 resize；先前 fit 与鼠标目标假设不作为根因。

正式修复是在终端 open 后为已有 xterm `RenderService.handleSelectionChanged` 安装有限适配，先执行原选区绘制，再读取当时 linkifier 的当前链接；只对仍 hovered 且开启 underline 的链接，通过其现有 decorations setter 重新触发绘制。复用原 range 与状态，不生成新候选、不触发 hover/open 回调、不启用低置信链接默认关闭的装饰；dispose 仅恢复仍由本适配占用的原方法。该适配依赖锁定 xterm 的内部 RenderService/当前链接接口，与已有鼠标坐标适配相同在 open/dispose 生命周期内管理；真实 xterm 的确定性选区重绘、无下划线和离开负例验证此边界。过程见 `docs/exec-plans/completed/release-validation-followups.md`；本轮与前一阶段的验证结果分别记录于下文。

## 后续修复验证与完整门禁边界（2026-10-09）

### Review 补充：路径终止后的软折行

review 5463038114 / 行内评论 4224295004 指出 d747a126 的新增回归：完整路径硬续段满行后，默认样式右括号或空格说明软折到下一行，循环找不到 nextSpan 即拒绝；四行窗口末尾也仅凭下一行 isWrapped 拒绝。Reviewer 的真实 xterm 与 Agent/Terminal 对照确认 main 成功、head 失败，此前全量 398/398 没有覆盖该边界。

正式补充方案：`executionTerminalNativeInteractions.ts::collectHardWrappedStyledFileLinkCandidates` 在循环内和四行窗口末尾共用 `startsWithUnstyledPathTerminator`，只将下一行首 cell 上默认样式的真实分隔符视为路径结束，保留已收集片段并继续原完整路径解析与 Host 校验。分隔符包括空白、闭合括号、引号、逗号和分号；空 cell 不能作为终止证据。显式样式变化、默认样式的路径续写字符、缺失真实内容和真正窗口外续段仍拒绝；不改变四物理行上限，也不将尾随文本并入候选或 hover。

新增 Agent/Terminal 共 26 项回归，覆盖两行/四行路径的无后缀、默认括号、默认空格说明，以及默认样式路径续写、显式样式变化、空软折行和窗口外同样式续段。按实际 terminalCols 构造，不加宽节点；正例校验完整目标/行列后缀和两/四段 hover，负例校验无截断候选送往 Host。最终四行夹具在旧构建上为 2 passed / 2 failed（无后缀通过、括号失败），修后新增用例及既有相关回归 **68/68 通过（1.7 分钟）**，类型检查、默认构建、`test:execution-terminal-links` 和 diff 检查通过。本轮没有重跑完整 npm、全部 Webview、真实 VSIX 或跨平台宿主；不以定向通过覆盖下文完整门禁失败。初版四硬行夹具的 hover 歧义及原始结果保留于计划，不算作本 review 的产品修复。证据见 `docs/exec-plans/completed/pr310-hardwrap-review-boundary.md`，下文为上轮结果。

本文“已验证”限于四项原失败及本轮模板、QuickPick、hover 具名修复，完整门禁的启动阻塞单列。模板与 QuickPick 修复为 `f02dafd3`，hover 修复为 `a8f057b1`。`test:canvas-templates` exit 0，`test:smoke-reset-fixture` 19/19，脚本语法、typecheck 和 build 通过。真实 xterm 的受控选区正例在适配为空实现时稳定失败，修后与三个负例/清理用例共 4/4；它们连同 Agent/Terminal 原 URL/file 悬停用例三轮共 24/24，通过真实鼠标/选区、可见下划线、持续输出和既有目标断言，未加重试或改快照。

`f02dafd3` 的 clean-checkout VSIX 已越过两项 QuickPick 清理：一次直接 reset 成功，另一次先 pending、原 Codex saved 后第二次 reset 成功。后续自动启动测试失败，完整命令 exit 1。`a8f057b1` 的独立 clean-checkout 完成 npm ci 与真实打包，但在更早的 `verifyTerminalShellPathRefreshesStoppedTerminalNode:3325` 重启失败，未到这两项 QuickPick。不同运行的阶段与结果分别保留，不追认最终包全程通过。

最终 `a8f057b1` 全量 Webview **398/398 通过（11.6 分钟）**，包含原悬停、硬折行及新增真实选区回归；没有更新快照或重试失败。完整 npm test 越过原模板断言后，在 Runtime checkpoint 场景启动失败。下面是新的门禁阻塞及已确认边界；它们不影响本轮具名用例修复的证据，但完整门禁尚不能宣称通过或据此恢复发布。

| 后续现场 | 证据与下一步 |
| --- | --- |
| Runtime checkpoint 的 root 准备失败 | 原 `/tmp/dsc310fs/runtime-checkpoint-refresh` 的扩展 globalStorage 为 0775，当前 shell umask 0002；调用未修改的真实 `prepareRuntimeRootOwnerDirectories` 对该目录检查，明确返回不得由其他用户写入的权限拒绝。隔离目录以 umask 0077 重跑，目录为 0700，Agent 已 live 且打开当前态分页读，消除了原准备失败；Terminal 又被 `rejected-before-acquire` 拒绝，尚未定位其资源准入原因。权限对照不是完整 checkpoint 通过。root 准备代码与 origin/main 相同，没有放宽权限保护。 |
| shell 停止后重启被旧执行责任拒绝 | 最终包在 `startNonNativeHostExecution` 的执行 key/容量保护拒绝。原 Terminal 的 saved 为 21:07:55.706Z，重启请求为 21:07:55.834Z，reader 仅在 finally 的 Host boundary 于 21:07:55.839Z cancelled。保存成功不等于 owner 已 retired；尚无原请求时 owner 完整快照，不能将拒绝写成保存 pending 或确定归因于 reader。需按原 executionId/generation 检查退役条件，不能盲重试或提前释放 key。 |
| 前一包后续自动启动等待失败 | f02dafd3 在 resize/persisted-state reload 之后的 `verifyAutoStartOnCreate:4909` 超时；有 creation admission closed、Terminal 原 metadata binding changed 和 resize authority binding changed，失败快照中 Agent resume-ready、Terminal interrupted。需要核对测试内存状态替换与原执行绑定，产品/夹具责任尚未确认。 |

证据：定向日志 `/tmp/dsc310-followup-{templates,selection-before,selection-after,hover-fixed,typecheck,build}.log`；完整命令 `/tmp/dsc310-followup-{npm,clean-vsix,final-vsix,webview}.log`。两次 clean-checkout 为 `/tmp/dev-session-canvas-clean-checkout-{Fi8Bvo,eeYcdR}/repo`，各自 `.debug/vscode-vsix-smoke/smoke-runtime/artifacts` 保留首败。权限原目录只读检查为 `/tmp/dsc310-followup-storage-permission-probe.log`，0077 对照为 `/tmp/dsc310-followup-checkpoint-private.log` 与 `/tmp/dsc310cpprivate/runtime-checkpoint-refresh/artifacts`。这些新失败按 `docs/workflows/TECH_DEBT.md` 登记独立后续项；未发现当前三项修复引入它们的证据，也未做完整基线对照来排除所有影响。跨平台真实宿主未重跑。

## 原四项修复验证与当时剩余阻塞（历史阶段）

本历史阶段验证实现提交 `8d432d41`，Node 22.23.3；当时“已验证”只指原四项修复。以下结果只关闭原四项的具名失败，不表示完整发布门禁通过。

| 验证 | 实际结果 |
| --- | --- |
| 移开主扩展与 notifier 两份 dist 后执行 `npm run test:package-vsix-file-list` | 自动构建两份产物，原文件清单断言通过。 |
| `npm run test:theme-color-tokens` | 源码/token 与共享状态呈现测试均通过。 |
| `npm run typecheck`、默认 `npm run build` | 通过，默认构建校验六目标原生资产输入。 |
| 原 hard-wrapped Playwright 用例 | 22/22 通过，保持原默认节点尺寸及行列目标断言。 |
| 新混合折行 Playwright 用例 | 12/12 通过，覆盖续段软折行、中文宽字符前缀、样式变化、缺缩进、prose 和四物理行上限；正例验证三个 hover 片段，负例检查未送出 hardwrap 候选。 |
| Host 启动诊断与完整接线 | 新用例修前首个正例失败（0 个 started），修后 3/3；完整 336/336 通过。 |
| 全部 Webview | 392 passed / 2 failed（12.0 分钟），失败为另两项初次 hover 下划线用例；原 hardwrap 与新增混合折行均通过。 |
| `npm test` | exit 1，已越过清单与主题，停在 `test:canvas-templates` 第 1188 行旧源码断言。 |
| `npm run validate:clean-checkout:vsix -- --keep-temp` | 隔离 npm ci、真实默认打包完成，相对 shell 用例通过；后续 QuickPick reset 等待超时，完整命令 exit 1。 |

完整 Webview 中另外两项 Terminal 用例在首次 hover 下划线断言失败：`keeps hovered links active while live output continues` 与 `reuses file link resolution while live output continues`（修后第 7010 / 7079 行），尚未注入后面的持续输出；页面无 JavaScript 异常。独立导出 `f57b11f9`、默认 build 后执行同样的原用例：两用例各重复五次为 9 passed / 1 failed（URL 首次下划线），文件用例再重复十次为 5 passed / 5 failed（同一首次下划线，基线第 7033 行）。当前 PR 原样定向复跑为 2/2 通过（`/tmp/dsc310-head-hover-recheck.log`），不覆盖原全量失败。两项修前也可失败；这证明既有波动，不证明其根因或故障率不变，后续需核对合成 hover、真实渲染与 fit 时序，不盲加等待或重试。基线定向运行与剩余全量 Webview 部分并行，不能当作独占负载下的性能测量。日志 `/tmp/dsc310-baseline-hover-matched.log`、`/tmp/dsc310-baseline-hover-file.log`，工件在 `/tmp/dsc310-baseline-bq4og7kr/.debug/{playwright/results,hover-file-repeat}/`；首次筛选误加标题起始锚点未匹配用例，不计为执行。

`test:canvas-templates` 要求 `main.tsx` 包含 `data-node-action-id="create-missing-associated-markdown-file"`，实际组件已在 `fileNoteNodes.tsx`。测试及两个输入文件相对基线均未改变；从 `f57b11f9` 导出树执行原脚本也在同一行失败。因此这是另外一处既有源码断言漂移，后续应对齐真实组件并重跑完整 npm test，本 PR 没有删除或绕过该断言。

真实 VSIX 使用 VS Code 1.141.0，失败位于 `verifyCreateNodeCommandQuickPickPreservesExplicitPresetIntent()` 第 3142 行，尚未进入该用例的 YOLO 创建。上一个用例留下的 custom Agent 已收到 SIGINT、状态 stopped，但单次 `webview/resetDemoState` 后节点仍在。现有消息处理异步调用 reset，错误走 `host/error`；它不是等待清空完成的 API。原用例 finally 清除了首败消息/诊断，因此原次失败的具体拒绝原因不能补写为已捕获。

为核对后续阻塞，在同一导出树仅给该用例增加 catch：调用既有 `writeFailureArtifacts` 保存到独立目录后原样抛错；没有更改产品或断言。独立目录的真实 VSIX 复核仍在第 3142 行失败，抓到 `Local final snapshot persistence is pending: agent:agent-1-35b0f1ee-617b-42ed-a3f6-edebc0def94c`。同一执行 `a21a9363-1b02-45f6-9b10-3dc208ef21b9` 于 20:40:48.904Z 记录 started、20:40:53.868Z 记录 EOF、20:40:53.889Z 记录 `localFinalPersistence: saved`，清理前仍无 state/reset。这与已选定的“pending 时中止原 reset，保存后须另行操作”契约一致，属于后续尚未适配该契约的 smoke 清理路径。另有 `Owned terminal mutation admission is closed`，不将其混为保存失败。该复核证明本次复核的直接拒绝，不追认原次缺失工件，也不声称做过去除新增诊断的因果对照。

后续按 `tests/vscode-smoke/reset-canvas.cjs` 的原执行身份、saved/not-required 和共用时限约束修正该用例清理，再完整复验；禁止盲重试、吞保存错误或将超时记为通过。复核补录代码已还原，不作为本 PR 新修复。
修后日志为 `/tmp/dsc310-{filelist-clean,theme,typecheck,hardwrap-first,mixed-final,started-before,started-after,host,webview-all,npm-test,clean-vsix}.log`；基线模板复现为 `/tmp/dsc310-canvas-templates-baseline.log`。VSIX 原失败保留于 `/tmp/dev-session-canvas-clean-checkout-Mc3X4K/repo/.debug/vscode-vsix-smoke/smoke-runtime/artifacts/`，清理前的最后节点快照包含在 smoke 日志的 AssertionError 中。reset 补录复核日志为 `/tmp/dsc310-reset-probe-with-ref.log`，工件在同一导出树 `.debug/vscode-vsix-smoke-reset-probe/smoke-runtime/artifacts/reset-first-failure/`；首次补录命令因导出树缺 git ref 在打包前停止，显式传入原实现 SHA 的 `DEV_SESSION_CANVAS_VSCE_DOC_BRANCH` 后才完成上述复核。临时文件不是长期事实来源，以上具名输入与结果作为仓库内摘要。剩余完整门禁问题登记于 `docs/exec-plans/tech-debt-tracker.md`。

## 根因与修前证据

### 1. notifier 文件清单测试新增了构建依赖，npm test 未补前置

直接失败是 `scripts/test/test-package-vsix-file-list.mjs:92` 调用 notifier `stagePackageFiles()`，后者在 `extensions/vscode/dev-session-canvas-notifier/scripts/package-vsix.mjs:143` 无条件复制 `dist`。干净 `npm ci` 不生成它。根 `npm test` 在此前经 Marketplace E2E 构建主扩展，notifier 构建却要到更晚的 `test:smoke`；`.github/workflows/release-preflight.yml` 在 npm ci 后直接 verify，继承同一缺口。

引入提交为 `a781334e641a310008fbbffe6473a584a0612f28`（2026-07-06，notifier 中英文本地化，PR #250；当前主线 merge 为 `4af3d1b4`）。该提交给已有的主扩展清单测试增加 notifier staging/import 和本地化文件断言，却没有调整该测试脚本或 npm test 的构建顺序。不是 notifier 打包入口没有构建：正式 package 命令有自己的构建步骤，失败测试直接调用 staging 函数。原本地化计划也明确要求缺产物时先 `npm run build:notifier`，这说明当时验证依赖手动前置；不能据此声称当时干净 npm test 通过。

在本次主线独立工作树，Node 22.23.3 下运行 `npm ci`、默认六目标资产 `npm run build` 后，原清单测试 exit 1：

    ENOENT: no such file or directory, lstat '.../dev-session-canvas-notifier/dist'

仅执行 `npm run build:notifier` 后重跑同一测试，exit 0，输出 `package-vsix file-list tests passed`。此前主扩展 staging 已成功，故缺失对象确实是 notifier。历史独立工作树先在 `a781334e^` npm ci/build 后运行原测试，exit 0；保持 notifier/dist 缺失，切到 `a781334e`（lockfile 未变）运行原测试，exit 1，同一 ENOENT；仅 build:notifier 后再次 exit 0。引入前后与主线控制结果一致。

修复边界：让正式测试入口显式满足双扩展构建依赖，或把需要真实 build 的清单验证放在保证双扩展产物存在的阶段。必须验证干净 checkout 的实际入口，不能以工作树残留 dist、空目录或删除 notifier 文件断言替代。

### 2. 组件拆分后主题测试仍要求 main.tsx 导入状态色函数

`scripts/test/test-theme-color-tokens.mjs:178–181` 使用正则要求 `main.tsx` 依次包含两个 label descriptor 与 `canvasStatusToneClass as statusToneClass`。`26e945adc7696bb804edaca9fb9eb46dfb4586e5`（2026-07-08，拆分通用节点 chrome）把使用该函数的组件迁入 `extensions/vscode/dev-session-canvas/src/webview/canvasNodeChrome.tsx`，导入随组件迁移；测试没有同步。main 留有前两个 descriptor，已不需要 tone helper。

该变更属于 [PR #253](https://github.com/ZY-WANG-0304/dev-session-canvas/pull/253)，当前主线历史 merge 为 `d944523ebfa81f4a8c5313d462eec751206ed11c`。历史 GitHub PR 元数据还保留另一个 merge SHA，本文以当前 Git ancestry 和可导出的树为准。

已有历史原脚本验证复用如下；脚本只依赖 Node 标准库，逐 ref 导出脚本及其全部 `readText()` 输入，未改断言：

| 历史树 | 原脚本结果 |
| --- | --- |
| `26e945ad^` | exit 0 |
| `26e945ad` | exit 1，缺失 main 的 tone import 断言 |
| `d944523e^` | exit 0 |
| `d944523e` | exit 1，同一断言 |

`canvasNodeChrome.tsx`、`fileNoteNodes.tsx`、`paneGallerySurface.tsx` 仍使用共享状态色映射。本次失败证明的是源码位置断言过时，不是状态色行为丢失。拆分计划 `docs/exec-plans/completed/webview-main-tsx-seventh-node-chrome-split.md` 记录了 typecheck、build、xterm entry、protocol 等定向验证，没有 theme 测试或完整 npm test；类型和打包不会执行源码正则，因此未拦住这处漂移。

修复边界：更新断言到实际承担呈现职责的组件或验证共享映射与呈现行为；不往 main 添加无用导入来满足旧正则。

### 3. 快照恢复后的 fit 暴露硬折行检测器不支持混合折行

失败用例是 `tests/playwright/webview-harness.spec.mjs` 的两项 `styled hard-wrapped code paths keep line and column suffixes`。输入仍为：

    TypeError: Cannot read properties of undefined\r\n
        at renderTerminalLink (\x1b[94msrc/webview/executionTerminalNativeInteractions.\x1b[39m\r\n
          \x1b[94mts:1600:12\x1b[39m)\r\n

测试传入 `cols: 120`，但默认节点实际视口只能显示约 64 列。只读探针在 `activateLinkForTest()` 入口读取真实 xterm buffer，Terminal 结果为 `cols=64, rows=22`：

| buffer 行（0 起） | 文本 | isWrapped |
| --- | --- | --- |
| 1 | `    at renderTerminalLink (src/webview/executionTerminalNativeIn` | false |
| 2 | `teractions.` | true |
| 3 | `      ts:1600:12)` | false |

第一段在 buffer 中被自动折行，再接原输出的 CRLF；因此不是测试名称暗示的纯硬折行。`executionTerminalNativeInteractions.ts` 的 `readHardWrappedLineContext()` 遇到 `line.isWrapped` 就停止，对自动折行行本身也直接拒绝。第一段所在上下文只有一行，不足两行即返回 undefined，未到路径解析、Host resolve 或行列号提取。普通软折行 detector 只拼接软折行，又不会跨后面的硬换行，所以两条路径都无法得到完整字符串。

对照一：主线默认构建运行未经修改的两项原用例，2 failed。对照二：只把这两项的节点宽度从默认值改为 1200，保留 ANSI、文本、120 列输入和全部目标断言；实际 fit 到 152 列，两个原目标断言均通过，准确得到 path、line=1600、column=12、source=hardwrap。只读探针确认宽节点没有中间 isWrapped 行。试验修改已撤回，不构成测试修复。

历史存在两层：`c9f1ba32`（2026-05-19）首次实现硬折行检测时就有停止于 isWrapped 的边界；`4412413e` 同日加入当前 code-path 用例，本次在该提交独立 npm ci/build 后运行原两项用例，2 passed。暴露提交为 `7f1e1887c927efbf0aed179ff012d058d75c5b57`（2026-10-02，随 PR #295 合入）：它为 Agent/Terminal 增加 `beginSnapshotRestore()`，在恢复结束时执行 `scheduleDeferredShrinkFit(0)`，使原先停留在输入 120 列的裸输出快照重新适配节点视口。独立工作树在其父提交 `e03a6527` npm ci/build 后运行原两项测试，2 passed；切到 `7f1e1887`（lockfile 未变）重新 build，原两项为 2 failed，失败文本与主线相同。这证明当前失败由恢复后的尺寸适配触发，潜在的混合折行缺口则更早存在。该提交原定向页面回归主要覆盖 restore/fit/viewport 与本地消费信用，没有覆盖这两项链接用例。进一步在该提交仅移除两处恢复结束的 `scheduleDeferredShrinkFit(0)` 调度，保留其余改动和原测试，两项再次通过；该反事实实验已撤回，不建议以取消 fit 作为修复。

修复边界：分别明确纯硬折行夹具需要的实际视口，以及混合软/硬折行是否作为产品支持范围补齐。如果补齐，应以逻辑行合并与真实 cell 坐标映射处理，继续保留同样式、缩进、prose 拒绝、候选长度/行数上限、Host 文件验证和行列号。单纯加宽测试只能消除输入歧义，不能宣称窄节点产品问题已修复；也不能删除恢复后的 fit 来掩盖它。

### 4. 本地 owned 执行已启动，却没有旧 smoke 所需 started 诊断

`verifyWorkspaceRelativeTerminalShellPathUsesWorkspaceRoot()` 关闭 Runtime Persistence，写入相对可执行 shell，设置单独 cwd，先验证节点 metadata 的绝对 shellPath/cwd，再等待同节点 `execution/started`，随后才 `waitForTerminalLive()`。shell 内容为：

    #!/bin/sh
    printf "relative-shell:%s\n" "$PWD"
    sleep 2

默认构建选择 native owner，经 `executionRuntimeSelection.ts`、`CanvasPanelManager.startTerminalSession()` 的 `nonNativeExecutionOwner` 分支进入 `startNonNativeHostExecution()`。字段名是早期非原生测试接线遗留，当前也承载原生 owned 执行。该方法等待 `operation.first`，要求结果为 `started` 后投影状态/快照并返回，但没有调用 `recordDiagnosticEvent('execution/started', ...)`；外层紧接着 return。旧 bridge 分支（约 18365 行）与 Supervisor 分支（约 16017 行）有该事件，owned local 分支没有。因此延长等待不会生成它。

原安装包 VS Code 1.141.0 现场已能证明 shell 与 cwd 正确，且真正进入过 live。以下均对应同一 Terminal、同一 executionSessionId `8752152c-dd76-451e-bb1e-6b8a2f1f582a`，不是其他会话或 shell 环境探测输出：

| UTC 时间，2026-10-08 | 已交付 Host 消息或诊断 |
| --- | --- |
| 19:30:46.425 | `execution/startRequested`，cwd 为目标 packages/app |
| 19:30:48.583 | 环境探针提示自定义脚本没有返回可解析环境快照 |
| 19:30:48.705 | `host/executionSnapshot`，liveSession=true，64×20 |
| 19:30:48.762 | `host/executionOutput`，sequence=1，正文 `relative-shell:.../.debug/vscode-smoke/relative-shell/packages/app` |
| 19:30:50.713 | `runtime/terminalSourceDisposition`，EOF，lastDataSequence=1 |
| 19:30:50.723 | 最终 `host/executionSnapshot`，liveSession=false，序列化正文 122 字符 |
| 19:30:50.738 | `execution/localFinalPersistence`，saved |
| 19:30:50.785 | reader settled，applied，finalOutputSequence=1 |

原元数据断言已通过，真实输出中的 PWD 也匹配目标目录。环境探针失败因脚本只打印标记并 sleep，不处理登录 shell 的环境输出命令；后续实际启动成功，因此它不是本次 started 超时原因。2 秒退出也不是缺事件的原因，但修诊断后仍需检查后置 live 等待的短进程时间窗口。

受控复核使用现有 `scripts/test/test-host-execution-owner-wiring.mjs` 的 `interactiveHostFixture('terminal')`，加载未改写的真实 CanvasPanelManager 和 ExecutionOwnerLifecycle，provider 边界受控返回 started。捕获到真实 start request 的 file=/controlled/shell、cwd=/controlled、113×39，business 存在；诊断只有 surface/ready 和 execution/startRequested，started 数量为 0。这个探针没有 shell 环境失败或短进程退出，仍缺事件，排除了它们作为必要条件。它属于 Host 方法接线证据，真实 PTY 成功证据来自上述原 VSIX 现场。

引入链：`c1b6bc8b`（2026-09-25）建立 owned 本地分支时未迁移 started 诊断，当时只给非原生测试用；`0f969ceb`（2026-09-30）把显式 native candidate 接入同一路径；`08fa3372`（2026-10-02）让普通 build/package 默认选择六目标 native owner，旧 smoke 才普遍走到缺事件分支。这些变更随 PR #295 于 2026-10-07 进入主线。相对路径 smoke 本身由 `f4f1b23c` 更早引入；#305 处理前序 reset 夹具后只是暴露了后面的失败。

修复边界：明确并补齐 owned local 的启动诊断契约，事件须来自真实 started 结果并携带相同会话、shellPath/cwd；或者将该 smoke 改为等待启动快照与真实 marker 来验证原本的 shell/cwd 行为，并单独覆盖诊断契约。不能跳过用例或靠延长 timeout 解决。短命 shell 应以已经捕获的启动/输出事实验收，不应必须在后续任意轮询时仍存活。

## 调查阶段的验证方法与证据入口

所有调查阶段 Node 命令使用 Node 22.23.3，浏览器为 Playwright 锁定的 Chromium 147.0.7727.15。历史工作树使用各自 npm ci；相邻提交的 lockfile 没有变化时复用刚安装的依赖。主线默认 build 通过六目标原生资产源码/依赖/hash 校验；历史 Webview 测试按历史默认 build 执行，不代证历史包或跨平台行为。

修前主线复现（`f57b11f9` 仓库根，修后清单入口行为已改变）：

    npm ci
    DEV_SESSION_CANVAS_EXECUTION_ASSETS_SET=/path/to/validated-assets npm run build
    npm run test:package-vsix-file-list
    npm run build:notifier
    npm run test:package-vsix-file-list
    node scripts/test/test-theme-color-tokens.mjs
    node scripts/test/run-playwright-webview.mjs --grep 'styled hard-wrapped code paths'

Playwright runner 固定使用工作树 `.playwright-browsers`，会覆盖外部同名环境变量；本轮将此目录链接到已有匹配缓存。初次误触发的下载已停止，未把下载中断计为测试失败。历史复查可 `git worktree add --detach /tmp/<short> <ref>`，npm ci/build 后执行上述对应脚本。不要在用户工作树切历史版本。

关键本地日志：`/tmp/dsci-filelist-{before,after}.log`、`/tmp/dsci1-{before,after,after-build}.log`、`/tmp/dsc-theme-introduction/*.log`、`/tmp/dsci-hardwrap-{original,probe,wide}.log`、`/tmp/dscih-hardwrap.log`、`/tmp/dscij-{before,after,counterfactual}-hardwrap.log`、`/tmp/dsci-owned-start.log`。原真实宿主 JSON 位于 `/tmp/dev-session-canvas-clean-checkout-L2msFs/repo/.debug/current-host-diagnostics/2026-10-08T19-31-06-714Z/{host-messages,diagnostic-events}.json`。临时文件不是长期结论来源，上面的输入、输出摘要、提交和方法才是可复查记录。

调查阶段没有重跑完整 npm test、全部 Webview 或全部 VSIX smoke；原完整失败事实保留，定向诊断结果不能外推门禁通过。后续修复阶段的实际执行结果见本文“修后验证与剩余阻塞”。


### 受控 Host 事件探针复现

在基线 `f57b11f9` 的干净调查 worktree 根目录创建临时脚本（不提交），复用原 wiring fixture 的真实类加载与边界注入。Python 只在测试文件尾部插入观察用例，不改写产品方法。下面的零事件断言只用于复现修前缺陷，不适用于修后代码：

```python
from pathlib import Path
source = Path('scripts/test/test-host-execution-owner-wiring.mjs').read_text()
marker = 'const testNameFilter ='
probe = """
test('diagnosis owned started event', async () => {
  const f = await interactiveHostFixture('terminal');
  try {
    console.log(JSON.stringify({
      start: f.provider.messages.find(m => m.type === 'start'),
      events: f.diagnostics,
      business: Boolean(f.record.business)
    }, null, 2));
    assert.equal(f.diagnostics.filter(e => e.name === 'execution/started').length, 0);
  } finally { await f.cleanup(); }
});
"""
assert source.count(marker) == 1
Path('scripts/test/.diagnose-owned-start.mjs').write_text(source.replace(marker, probe + marker))
```

    DEV_SESSION_CANVAS_HOST_TEST_FILTER='diagnosis owned started event' node scripts/test/.diagnose-owned-start.mjs

本次结果为 1/1，证明缺事件，不代表正确行为回归通过。读取确认结果后删除临时脚本。

### 浏览器只读观察与宽度控制

在隔离 worktree 的 `executionTerminalNativeInteractions.ts` 中，`activateLinkForTest()` 开头临时记录 `terminal.cols`、`terminal.rows`、每行 `translateToString(true)` / `isWrapped` 与 `readStyledTextSpans(terminal, index)` 到 window 调试字段；测试捕获该字段到日志。该观察不改变检测或激活返回值。宽度对照仅将两项用例中的 bootstrap 改为：

```js
const state = createLiveExecutionNodeState(executionKind);
state.nodes[0].size.width = 1200;
await bootstrap(page, state);
```

保持输出与全部断言原样，运行相同 grep，观察 152 列与 2 passed。历史反事实对照在 `7f1e1887` 仅移除 `executionSessionNodes.tsx` 两处 `if (!terminalDisposed && snapshotRestoresInProgress === 0) scheduleDeferredShrinkFit(0);`，重新 build 后运行原两项，也是 2 passed。两类实验后都恢复原文件；它们分别证明几何条件与调度触发，不构成正式修复。
