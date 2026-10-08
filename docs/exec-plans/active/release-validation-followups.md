# 修复 PR #310 后续验证阻塞

本 ExecPlan 按 `docs/PLANS.md` 维护。2026-10-09 用户要求继续修复，沿 `/tmp/dsci` 的 PR #310 分支推进，起点 e497a8e2、origin/main f57b11f9。原工作树的发布文档保持原样，不恢复 0.26.1 发布。

## 目标与全局图景

让模板源码测试检查真实组件，让 QuickPick 用例按最终保存契约清理自己的 Agent，并消除两项初次链接悬停的可复现波动。保留原定向与全量失败，不靠跳过、延长超时或重试获得绿色。正式结论补充到 `docs/design-docs/release-blockers-investigation.md`，reset 契约沿 `docs/design-docs/canvas-reset-final-persistence.md`。

## 进度

- [x] (2026-10-09) 核对远端 main 与 PR head，复用原失败、基线对照和 reset 补录证据。
- [x] (2026-10-09) 模板按钮/文案断言迁到 fileNoteNodes，完整模板命令 exit 0。
- [x] (2026-10-09) 两个 QuickPick 各自清理自己的 Agent，保留保存诊断，既有 reset helper 19/19、语法检查通过。
- [x] (2026-10-09) f02dafd3 真实 clean-checkout VSIX 越过两个 QuickPick 清理及原目标，后续自动启动失败；完整 npm 越过模板后在 runtime-checkpoint-refresh 启动失败，原始工件保留。
- [x] (2026-10-09) 捕获选区绘制覆盖下划线调用栈，真实 xterm 受控用例修前失败、修后 4/4；原悬停与受控回归三轮 24/24、typecheck/build 通过。
- [ ] 完成相关定向与完整门禁，同步文档、技术债和同一 PR。

## 意外与发现

原全量 Webview 392/394，失败都在首次 hover 下划线，未进入后续持续输出。基线原脚本也复现 URL/file 首次下划线波动。reset 复核抓到 pending 后原执行 saved，但原 reset 已中止；测试误把消息派发当成会最终完成的清空操作。

隔离探针初次 10 项中出现失败，追加逐行替换栈后在 file 五轮中 3 败/2 过。失败现场先正常 show，再被 `SelectionService._refresh → RenderService.handleSelectionChanged → DomRenderer.renderRows` 以无下划线内容替换；当时 cols=64/rows=22 未变化，当前 link 仍 hovered/underline=true。原始日志 `/tmp/dsc310-followup-hover-{observation,row2}.log` 与隔离 probe 的 hover-probe.json 保留，探针不提交。

## 决策记录

2026-10-09 / Codex：用户继续授权覆盖已登记的模板、reset 和 hover 三类后续项。模板断言保持按钮及文案要求，仅跟随组件职责。reset 复用已有 `resetCanvasAfterFinalPersistence`，清理原用例自己的执行并保留诊断身份，20 秒总预算及一次再次操作不变。hover 尚无根因，先观察 link range、实际尺寸、事件目标、xterm linkifier 与 fit 顺序，不先猜测改动或增加等待。

2026-10-09 / Codex：按直接原因修复选区重绘后的当前链接装饰，不使用 timeout、合成鼠标重试或加宽夹具。在 open 后安装 RenderService.handleSelectionChanged 适配，原绘制后只重画当前仍 hovered 且 underline=true 的链接，dispose 恢复原方法；用真实 xterm 的受控选区改变先红后绿及关闭装饰/离开负例约束，避免修改整份第三方 bundle 或增加任意观察定时器。

## 结果与复盘

模板、QuickPick 清理和 hover 直接根因均已修复，定向验证通过；完整 Webview 与最终包待回收。f02dafd3 的 npm/clean-checkout 已越过本轮原阻塞，在更晚的 Runtime checkpoint 启动和自动启动用例失败，原因仍在核对，不能把原失败追认为成功。

## 上下文与定向

`scripts/test/test-canvas-templates.mjs` 在第 1188 行扫描 main.tsx 的按钮，真实 JSX 在 `extensions/vscode/dev-session-canvas/src/webview/fileNoteNodes.tsx`。`tests/vscode-smoke/extension-tests.cjs` 的 `verifyCreateNodeCommandQuickPickKeepsSelectedModeUntilUserEdits` 留下 custom Agent，下一 `verifyCreateNodeCommandQuickPickPreservesExplicitPresetIntent` 初始 reset 超时；其 finally 也直接派发 reset。既有 `tests/vscode-smoke/reset-canvas.cjs` 可取得真实 testResetState Promise，并仅在原身份确认 saved/not-required 后允许一次再次操作。

Webview 的 `executionTerminalNativeInteractions.ts::hoverLinkForTest` 通过查找 link 和合成 mousemove 驱动真实 xterm linkifier；Playwright 在 `.xterm-rows` 检查下划线。`dispatchSyntheticLinkHoverEvent` 使用 buffer range 和 screen rect 计算点，恢复后 fit 可能改变尺寸。需要先区别事件未命中、范围变化和渲染覆盖。

## 里程碑与工作计划

第一里程碑将模板按钮断言迁到实际组件、接入两个 QuickPick 清理点并保留原行为断言；模板命令和 reset helper 19 项通过后提交，隔离运行真实 VSIX。第二里程碑用临时只读探针观察两项 hover 的失效现场，以对照验证直接原因，正式修复前记录方案，再定向运行初次悬停、持续输出及硬折行。第三里程碑回收完整 npm / Webview / VSIX 结果，出现新独立阻塞应先判断与授权目标关系并记录，不能吞失败。

## 具体步骤

工作目录 `/tmp/dsci`，Node 22.23.3 通过 PATH `/tmp/dsc-release-node22/node_modules/node/bin`。默认资产环境变量 `DEV_SESSION_CANVAS_EXECUTION_ASSETS_SET=/tmp/dsc-release-026-assets`；真实 VS Code 通过 `DEV_SESSION_CANVAS_VSCODE_EXECUTABLE=/tmp/dsc0261v/.vscode-test/vscode-linux-x64-1.141.0/code`。浏览器软链接可从 `.debug/release-blockers-repair/playwright-browsers` 恢复。

    npm run test:canvas-templates
    npm run test:smoke-reset-fixture
    node --check tests/vscode-smoke/extension-tests.cjs
    npm run build
    node scripts/test/run-playwright-webview.mjs --grep 'keeps hovered links active|reuses file link resolution'
    npm test
    npm run test:webview
    npm run validate:clean-checkout:vsix -- --keep-temp

完整 npm test 的 Marketplace 和 smoke 目录使用短 `/tmp` 独立路径，避免 socket 路径上限。日志前缀 `/tmp/dsc310-followup-`，失败 artifacts 保留原目录或先移入忽略证据目录，不覆盖上轮原始结果。

## 验证与验收

模板按钮及文案仍受断言；reset 在确认原保存结果前不清空或重试，保存失败直接失败，真实用例应完成自己的清理并进入下一场景。hover 保留真实事件、可见下划线、持续输出和点击目标断言，用受控对照证明修复原因；重复通过只能补稳定性证据，不替代因果定位。完整门禁如实报告。

## 幂等性与恢复

临时探针和失败产物不提交，原工作树不切分支。生产配置、版本、发布例外不改。推送前 fetch/rebase origin/main，必要时固定旧远端 head 使用 force-with-lease。完成后归档计划并更新技术债。

## 证据与备注

原失败及历史引入见 `docs/design-docs/release-blockers-investigation.md`，修前/修后结果追加，不删除旧记录。

## 接口与依赖

优先复用既有测试入口、reset helper 和 xterm 事件，不增加依赖或产品重试接口。若实际 hover 根因涉及产品行为，先将已确认方案写回正式设计，再最小修复。

修订记录：2026-10-09，根据继续修复授权创建计划，明确三类后续问题及先观察后修 hover 的顺序。
