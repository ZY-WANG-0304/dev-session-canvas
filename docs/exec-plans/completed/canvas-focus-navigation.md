# 修复 Tab 导航导致的画布分层错位

本计划按 `docs/PLANS.md` 持续维护。

## 目标与全局图景

Tab / Shift+Tab 到屏外节点或分组控件时，目标应进入视野，背景、标签、节点保持对齐。画布导航仍由 React Flow（当前画布库）管理；终端和 Note 正文保留内部滚动和输入语义。不改变节点几何、宿主协议或默认缩放。

## 进度

- [x] (2026-11-05 Asia/Shanghai) 核对当前源码、既有复现记录和工作流，确认三层 overflow:hidden 与分层 portal 仍存在。
- [x] (2026-11-05 Asia/Shanghai) 选定不可滚动边界与实例局部焦点导航，登记正式设计。
- [x] (2026-11-05 Asia/Shanghai) 四个原生 Tab 场景修复前全部失败，40% 横向 pane scrollLeft=708，100% 纵向 scrollTop=600。
- [x] (2026-11-05 Asia/Shanghai) 实现裁切边界与实例焦点导航；首轮八项回归通过，包含四个原始红灯、分组、可见焦点、pane 隔离与既有滚动条测试。
- [x] (2026-11-05 Asia/Shanghai) 29 项定向与相邻浏览器回归通过；补充隐藏测量框与过时焦点保护后，新用例两轮 20/20 通过。构建、类型检查、分组脚本和 diff 检查通过，目录核对 432 项真实 ID 一致。
- [x] (2026-11-05 Asia/Shanghai) CI 选测 23/23、浏览器门禁合同 2/2 通过；额外完整 gate-contracts + ci-scope 为 131/132，未改动的 residual process group 断言失败，另行登记而不扩展修复范围。
- [x] (2026-11-06 Asia/Shanghai) 创建 PR 前复核已 rebase 到 origin/main `cdca3297`，无冲突；rebase 后类型检查、构建和十项焦点回归通过。合入主线新增用例后，目录重新核对为 433 项真实 ID 一致。
- [x] (2026-11-06 Asia/Shanghai) PR #369 首轮 CI 只有一个原始失败：旧标题双击用例把进入编辑的焦点导航混入比较；其余 429 个功能用例通过，verify-result 与最终契约检查连带拒绝。原用例在本地同样失败，分阶段观察确认双击自身不移动。
- [x] (2026-11-06 Asia/Shanghai) 修正原用例的阶段边界：独立验证屏外聚焦导航、真实鼠标双击不移动、zoom 与三层 scroll 不变。该用例及十项焦点回归 11/11 通过，完整功能集 430/430 通过，433 项目录身份保持一致；本轮更新同一 PR，远端新轮次待验。

## 意外与发现

11 月 4 日隔离复现没有交付产品修复。当前 `canvasGroupLayers.tsx` 将背景挂在 pane 内的 viewport，前景挂在 renderer；overflow:hidden 可被焦点触发滚动。只改 pane 会将滚动转移到 renderer，只补 preventScroll 无法覆盖原生 Tab。

当前 React Flow 根元素内联写入 overflow:hidden，普通 CSS 无法覆盖，因此仅根元素使用 `overflow:clip !important`。固定依赖的 ZoomPane end handler 跳过无 sourceEvent 的变更，程序化 setViewport 不触发 onMoveEnd；初轮修后测试确实发现视口保存仍为旧值，改为显式调用既有保存函数后八项通过。

可见性测试最初把节点放在 (5,5)，选择后的 resize 控件实际延伸到屏外，导航属于正确行为；将节点放在 (8,8) 保证全部焦点目标真实可见后验证不移动。实现仅在超出实际可视边界时导航，不因进入 12px 留白区就移动。

PR #369 的 run `42060940222` / attempt 1 在 `double-clicking the title input keeps the current viewport unchanged` 失败。旧测试在进入编辑之前保存视口，随后用程序化 focus/click 操作屏外标题，将正常焦点导航误算为双击移动。本地分阶段观察为：编辑前 (-320,-160,0.62)，聚焦后 (-45.040008544921875,-42.27906799316406,0.62)，双击后不变；三层 scroll 始终为零。此前 29 项定向回归漏掉这个节点标题用例，只包含了分组标题用例。

## 决策记录

2026-11-05：三层改用 overflow:clip，不监听 scroll 归零、不做偏移补偿，让 DOM 滚动无法成为第二套画布坐标。

2026-11-05：每个交互 React Flow 实例内挂载焦点桥；焦点改变后读取最终位置，仅屏外时以当前 zoom 做最小平移。不拦截 Tab，避免抢占终端补全、Note 缩进；实例局部处理避免误导航其他 pane。

2026-11-05：按用户要求在当前工作树修复，不切分支、不提交，不操作其他 worktree 或未跟踪文件。

2026-11-06：用户随后要求创建 PR，原 runtime 主题的 PR #366 已合并；从已对齐 main 的当前 HEAD 建立 `canvas-tab-focus-navigation`，仅提交 Tab 修复及其验证文档，未跟踪图片和笔记不进入 PR。

2026-11-05：焦点桥接收 onViewportCommit 回调，rootGroups 接 persistCanvasViewport，paneGallery 接所属 root 与 viewportRole 的 onSavePaneViewport。理由是程序化导航不能依赖只处理真实输入事件的 onMoveEnd；该变更不新增保存状态。

2026-11-06：修正旧用例，不修改产品焦点导航或放宽双击断言。先明确初始标题在屏外，进入编辑后验证焦点可见、已导航且 zoom 不变，再冻结视口与 DOM transform，用真实鼠标双击验证两者完全不变；同时确认画布 DOM 不滚动。用例名称和门禁目录身份保持不变。先复跑该用例与十项焦点回归，再执行完整功能集，避免再次用定向验证替代全集。

## 结果与复盘

已交付不可滚动边界、实例局部焦点导航、显式视口保存与十项新回归。当前源码的四项原生 Tab 故障先红后绿，分组/多窗格/内部滚动/输入/隐藏与过时焦点边界通过；未改用户画布、安装包或其他 worktree。初轮本地交付后，按用户要求提交到 PR #369。

初轮本地验证范围限定于 Linux Chromium harness 与类型/构建/合同检查，没有执行当时全部 432 项浏览器用例。2026-11-06 CI 跟进仅修正旧标题测试，补跑与 CI 同筛选范围的完整功能集 430/430 通过；目录另含三项视觉测试，本地未在本轮重跑。不能据此反推旧截图的唯一原因，也不把本地功能全集通过当作新 head 的远端完整验收。额外完整合同的历史进程清理反例失败仍登记在 `docs/exec-plans/tech-debt-tracker.md`，不被本次结果覆盖。

## 上下文与定向

源码位于 `extensions/vscode/dev-session-canvas/src/webview/`。`styles.css` 定义裁切；`main.tsx` 创建 rootGroups 实例；`paneGallerySurface.tsx` 创建独立 root 实例；`canvasGroupLayers.tsx` 定义前景、背景挂载位置。新增 `canvasFocusNavigation.tsx` 共享焦点处理，显式复用既有视口保存函数。

测试位于 `tests/playwright/webview-harness.spec.mjs`，用 bootstrap 与持久化视口创建屏外 Note / 分组。`scripts/gates/browser-catalog.json` 是门禁固定目录，须同步新增用例的真实 Playwright ID。

## 工作计划

里程碑一：补设计与原生键盘回归，用当前构建证明故障，记录红灯。

里程碑二：修正裁切并接入焦点桥。下一帧测量，让内部内容先完成原生滚动；取消过时或卸载的任务。只处理画布对象，不处理固定工具栏、隐藏测量框或缩略图；可见目标不动，超大目标按最近边界对齐。

里程碑三：验证双向 Tab、横纵屏外、不同缩放、分组前景、pane 隔离、可见焦点稳定，以及正文/终端与既有平移缩放。同步目录和文档，不把 Linux Chromium 通过表述为全部 VS Code 平台完成。

## 具体步骤

在仓库根运行 `npm run build`，再运行 `node scripts/test/run-playwright-webview.mjs --grep 'canvas focus navigation' --repeat-each=2 --workers=1`，预期 20 项通过。运行 `npm run typecheck`、`npm run test:canvas-node-groups`、`git diff --check`。浏览器门禁定向命令为 `node --test --test-name-pattern 'actual browser set|browser dependencies' scripts/test/test-gate-contracts.mjs`，预期 2 项通过；选测合同为 `node --test scripts/test/test-ci-scope.mjs`，预期 23 项通过。

相邻回归命令为 `node scripts/test/run-playwright-webview.mjs --grep 'canvas focus navigation|canvas groups do not create document scrollbars|canvas group (drag|body drag|title and action|border stroke)|canvas zoom keeps group|overview mode keeps hidden|note body editor supports tab|note body edit mode restores|snapshot restore still responds to wheel|terminal handles vi-style|right click keeps xterm|double-clicking group title input|pane gallery (keeps panes scrollable|restores the saved main viewport|overflowing thumbnail rails)' --workers=1`，本轮 29 项通过。

2026-11-06 CI 跟进先执行 `npm run build` 与 `node scripts/test/run-playwright-webview.mjs --grep 'double-clicking the title input keeps the current viewport unchanged|canvas focus navigation' --workers=1`，11/11 通过。完整功能集使用 `node scripts/test/run-playwright-webview.mjs --grep-invert 'webview bundle emits ready and matches the baseline screenshot|minimap viewport contrast stays readable' --workers=2`，430/430 通过；该筛选与 CI 功能门禁一致，不排除任何功能用例。类型检查、文档检查、目录一致性和 `git diff --check` 均通过。

## 验证与验收

核心回归只用原生 Tab / Shift+Tab 触发，不用 CSS 改写或 scrollLeft=0 修饰结果。核对三层和 document 滚动值为零、图层坐标关系不变、焦点进入本实例边界、zoom 不变、视口保存和节点几何不变。程序化 focus 的额外用例不冒充原生键盘复现。

## 幂等性与恢复

构建和测试可重复；隔离 harness 不改用户画布和安装包。只撤回本任务 diff 即可恢复，无数据迁移；未跟踪笔记与图片不修改。

## 证据与备注

核心四项修前失败：pane 发生非零滚动；加入 clip 与导航后滚动/对齐断言通过，但保存断言发现缺少提交回调；补上显式保存后首轮八项通过。最终新用例两轮 20/20，相邻集合 29/29，类型与构建通过。

    Browser catalogue matches 432 actual tests
    29 passed (51.6s)
    20 passed (36.4s)

额外完整合同记录：`node --test scripts/test/test-gate-contracts.mjs scripts/test/test-ci-scope.mjs` 为 131/132，`test-gate-contracts.mjs:1490` 的 `assert(result.residualGroup)` 返回 false；未修改该测试或其执行器，没有用后续定向绿色覆盖原失败。

CI 跟进记录：原用例在本地修改前同样失败；仅修正测试后：

    11 passed (21.6s)
    430 passed (12.1m)
    Browser catalogue matches 433 actual tests

本地完整功能日志保留于 `.debug/pr369-ci/focus-followup-functional.log`；旧 CI run `42060940222` 的单个原始失败与两级连带拒绝保留，不重写为通过。

2026-11-06 再次追赶主线：将 PR rebase 到 `origin/main` 的 `809f7512`，两个提交均无冲突重放。此前 head `2f38b971` 的 CI run `42072031193` 中，功能浏览器、视觉浏览器及三个 regression 分片均已通过；该轮失败不是标题双击回归。Windows ARM64 job `127408377070` 在 `actions/setup-node@v4` 解压 Node 25.6.0 时，PowerShell 7 报 `Internal CLR error (0x80131506)` 并以 `3221225477` 退出，尚未进入依赖安装或产品构建。`package-clean` 与 `source-build` 随后因缺少同轮 `native-load-win32-arm64` 回执失败，最终验收拒绝是连带结果。

日志仅能确认 runner 的 PowerShell 进程崩溃，尚不能确认其是否稳定复现；不据此修改产品实现、跳过 ARM64 或放宽原样产物验真。先对 rebase 后输入复验并推送，让新 head 执行完整任务图；若需重跑，遵循同一 run/attempt 的完整重跑约束，不混用旧轮次 native 产物。远端结果以新 head 的运行记录为准。

该次 rebase 后构建、类型检查通过；焦点导航、标题双击与右键创建相邻回归 19/19 通过，浏览器门禁合同定向检查 2/2 通过，433 项实际 Playwright 用例的 ID 和包含 describe 层级的标题与冻结目录一致。定向日志位于 `.debug/pr369-ci/rebased-focus.log`，不替代远端完整验收。

## 接口与依赖

沿用 React / React Flow 和 focusin、requestAnimationFrame、getBoundingClientRect。`CanvasFocusNavigation({ onViewportCommit })` 用 useStore 获取实例 DOM，用 useReactFlow 的 getViewport / setViewport 导航，回调显式保存，不新增依赖或跨 Host 消息。

修订：2026-11-05 建立计划，补齐此前仅隔离诊断未交付的焦点可见性边界。

修订：2026-11-05 记录先红后绿，并按实测纠正程序化视口的保存机制。

修订：2026-11-05 完成十项新增用例和相邻回归，登记完整合同的范围外失败，归档计划。

修订：2026-11-06 创建 PR 前追加主线 rebase、复验和 433 项目录一致性记录，保留此前完整合同失败而不改写为通过。

修订：2026-11-06 追加 PR #369 唯一原始 CI 失败及分阶段证据，修正测试比较边界并完成 11 项定向与 430 项完整功能验证；新 head 的远端门禁结果仍待运行。
