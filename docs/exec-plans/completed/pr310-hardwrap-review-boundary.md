# 修复 PR #310 review 的软折行终止边界

本 ExecPlan 按 `docs/PLANS.md` 维护。2026-10-09 用户要求处理更新后的 review，工作树 `/tmp/dsci`、分支 `docs-release-blockers-investigation`，起点 d747a126，目标 origin/main f57b11f9。原工作树不改动，不恢复发布或合并。

## 目标与全局图景

带样式路径的最后一个硬续段恰好填满终端行时，默认样式右括号或空格引出的说明可能软折到下一行；路径仍应整体可点击，行列后缀与每行 hover 范围保持。路径真正延续却丢失样式、内容或超过四物理行时继续拒绝截断候选。

## 进度

- [x] (2026-10-09) 读取 review 5463038114 / 行内评论 4224295004，核对 head 和 main；检查 reviewer 的真实 xterm 及 Webview 证据。
- [x] (2026-10-09) 增加 26 项 Agent/Terminal 回归；原两行括号/说明失败，最终四物理行夹具修前无后缀 2/2、带括号 0/2。
- [x] (2026-10-09) 两处边界复用默认分隔符判据，新增 26 项连同既有相关用例 68/68（1.7 分钟），typecheck/build、路径解析测试与 diff 检查通过。
- [x] (2026-10-09) 同步正式设计、核心原则与技术债，归档计划，交付沿 PR #310 原分支。

## 意外与发现

`collectHardWrappedStyledFileLinkCandidates` 找不到同样式的 soft continuation 时直接设置 incompleteSoftWrap；到四行窗口末尾则只凭下一行 isWrapped 拒绝。这两处把“物理行连续”当成“路径文本连续”。Reviewer 在实际 40 列 xterm 及按节点实际列数构造的 Agent/Terminal 用例上证明：带右括号 head 失败、main 通过，无右括号对照两者通过。原证据保留在 `/tmp/dev-session-canvas-pr310-review/.debug/review-hardwrap.cjs`、`/tmp/pr310-review-edge-{head,base}.log`。

## 决策记录

2026-10-09 / Codex：仅在下一软折行首个真实 cell 已恢复默认样式，且包含明确终止字符（空白或闭合标点）时认可路径已结束；不能把任意找不到 nextSpan 当成正常终止。默认样式的路径字符、不同显式样式的续段、空 cell 和同样式窗口外续段仍保守拒绝。循环内与窗口末尾复用同一判据；完整候选仍经过原路径解析与 Host 解析，不提高四行上限。

2026-10-09 / Codex：初版四物理行夹具使用四个硬行，点击完整目标成功，但控制组的真实鼠标 hover 只显示两段；后续硬行还可组成重叠候选，这个计数不能唯一表达本 review 的终止边界。最终改用一个硬续段自然软折为三行，仍覆盖四物理行上限和四段 hover，保留原失败而不调整产品候选优先级。最终夹具在旧构建上复核，两个无后缀控制均通过、两个右括号均失败。测试名称使用有含义的后缀名，避免空串/括号在 Playwright 工件路径规范化后碰撞。

原修前批次 16 passed / 10 failed（其中 8 项为本 review 的检测失败、2 项为上述四硬行 hover 控制）；最终四行夹具的独立修前对照 2 passed / 2 failed。日志 `/tmp/dsc310-review-boundary-before.log`、`/tmp/dsc310-review-boundary-window-before.log`，对应工件 `.debug/pr310-review-boundary-{before,window-before}`。未将初版控制组失败计作修复产品缺陷。

## 结果与复盘

本次 review 的唯一确定性 blocker 已修复：路径结束后的分隔符软折行不再使完整候选消失，两处判断保持一致；默认路径续写、样式变化、空 cell 与真正超出窗口仍拒绝。新增 26 项及既有相关回归共 68/68（1.7 分钟），类型检查、构建与路径解析测试通过。修后日志 `/tmp/dsc310-review-boundary-{after,typecheck,build,links}.log`，Playwright 工件 `.debug/pr310-review-boundary-after`。没有重跑完整 npm/Webview/VSIX 或跨平台宿主，既有 Runtime 启动类完整门禁阻塞继续单独登记。此前 398/398 未覆盖该边界，不替代本轮先失败后通过的证据。

## 上下文与实现计划

生产入口是 `extensions/vscode/dev-session-canvas/src/webview/executionTerminalNativeInteractions.ts` 的 `collectHardWrappedStyledFileLinkCandidates`；`readHardWrappedLineContext(..., true)` 只收集四物理行，`readHardWrappedContinuationStyledSpan` 要求同样式及正确列起点。新增有限 cell 终止判据并用于两处 soft-wrap 拒绝。回归放在 `tests/playwright/webview-harness.spec.mjs` 的 Agent/Terminal hardwrap 用例组，按 ready.terminalCols 构造两行及四行满行路径，验证无后缀、默认括号、默认空格说明及真正续段的区别。

先添加回归并运行修前失败；再实现最小修复，运行新增边界、原 hardwrap/混合折行与选区/持续输出悬停测试，以及类型检查和默认构建。仅修改链接边界，不扩修已登记的 npm/VSIX Runtime 启动问题；本轮结果不外推完整门禁。

## 具体步骤与验收

工作目录 `/tmp/dsci`；Node 22 PATH 为 `/tmp/dsc-release-node22/node_modules/node/bin`，构建资产 `DEV_SESSION_CANVAS_EXECUTION_ASSETS_SET=/tmp/dsc-release-026-assets`。浏览器软链接从 `.debug/release-blockers-repair/playwright-browsers` 临时恢复，日志前缀 `/tmp/dsc310-review-boundary-`，失败工件保留独立目录。

    node scripts/test/run-playwright-webview.mjs --grep 'hard-wrapped styled path boundary'
    npm run typecheck
    npm run build
    node scripts/test/run-playwright-webview.mjs --grep 'hard-wrapped|keeps hovered links active|reuses file link resolution|selection draw|selection redraw|selection link rendering'

正例必须打开完整 file/path/line/column，hover 仅覆盖路径的两/四行。负例不能发送被截断的 hardwrap 候选；保留原样式、缩进、prose 和窗口限制测试。修前已通过的负例不能算先红后绿。

## 幂等性、接口与证据

不增加公开协议或依赖；仅使用已有 IBufferCell/IBufferLine。原始失败不覆盖，探针不提交。完成后归档到 completed，登记 review 修复及仍保留的独立门禁失败，fetch/rebase origin/main 后推送 PR #310 分支。具体结果追加到 `docs/design-docs/release-blockers-investigation.md`。

修订记录：2026-10-09，按最新 review 创建，明确两处相同误判与正反例边界。

修订记录：2026-10-09，记录最终四行夹具的修前 2 过/2 败及修后 68/68，保留初版夹具的 hover 歧义和门禁边界，归档交付。
