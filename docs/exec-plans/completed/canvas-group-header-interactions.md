# 实现分组等宽标题栏与统一删除入口

本 ExecPlan 按 `docs/PLANS.md` 持续维护。

## 目标与全局图景

分组顶部覆盖整个分组宽度，右侧只有与节点同风格的删除按钮。点击后使用 VS Code modal 选择取消分组保留内容或递归删除内容。标题文字和空白可从首次按下开始拖动。workspace-root 保留只读标题和不可删除约束。

## 进度

- [x] (2026-11-06) 核对现有标题布局、指针捕获、宿主删除确认与回归。
- [x] (2026-11-06) 记录正式方案、交互假设与验证边界。
- [x] (2026-11-06) 实现等宽布局、单按钮、首次拖动与统一 modal。
- [x] (2026-11-06) 浏览器相关回归 56/56、宿主删除分支 9/9、分组几何、主题、类型检查与 stock 构建通过。
- [x] (2026-11-06) 同步实际结果、登记真实宿主验证边界并归档计划。

## 意外与发现

`CanvasPanelManager.deleteGroup` 已有原生 modal 和递归删除/保留两种行为，但空分组绕过确认。标题栏拖动要求已选中且目标为文字，空白不能启动拖动。已有研究文档、索引修改与图片是用户未提交工作，必须保留。

第一轮浏览器 44/47 通过，发现原透明 frame border 使标题内宽比外框小 1–2 屏幕像素；移除该布局占位，由标题栏与背景承担可见边框，其余失败为旧 tab 宽度断言。新增重命名测试曾使用错误的 host 消息夹具，补齐 `{ state, runtime }` 后通过。最后扩大回归为 56/56。

默认 `npm run build` 因本地缺少 `generated/execution-assets` 失败。本轮用显式 `--execution-profile=stock` 构建验证前端，不声称原生发行构建完成。宿主 mock 打包有现存 node-pty require.resolve 警告，但测试通过。smoke helper 更名后重新生成预算清单，核对所有 timeout 与非位置字段不变，仅 helper 名称、来源 hash 和一个证据行号更新。

## 决策记录

- 决策：在用户指定目录和当前分支实现，不切分支、不提交、不推送。理由：保留当前工作，本次只授权实现。日期/作者：2026-11-06 / Codex。
- 决策：“参考节点拖动”解释为标题栏非控件区域首次按下即允许拖动，保留 3px 阈值、双击聚焦、Ctrl/Cmd 选择、边缘自动平移和取消回滚。理由：消除额外点击，不改宿主几何或正文平移。日期/作者：2026-11-06 / Codex。
- 决策：沿用原生 modal，空组也确认；保留内容为首项，含系统 root 的外层组只提供保留。理由：一致反馈且默认不递归删除执行节点。日期/作者：2026-11-06 / Codex。
- 决策：反向缩放以固定最小可用宽度限制，不取决于标题字符数或选中状态。理由：重命名和选中不能改变标题栏几何。日期/作者：2026-11-06 / Codex。

## 结果与复盘

实现已完成，正文几何、8 向 resize、自动平移、系统 root 限制及标题编辑回归保持。删除前不提前清理选择，取消 modal 后可继续操作；宿主回传移除组后由现有状态校验清理失效选择。清理了不再使用的 onUngroup 前端透传、空组免确认 helper 和双段按钮样式。未提交、推送或变更版本号，未触碰用户已有研究内容。

真实 VS Code 原生 modal、真实运行会话递归删除、远程及高对比主题未执行，已登记 `docs/exec-plans/tech-debt-tracker.md`；保留正式设计“验证中”，不从 mock 或浏览器测试外推安装验收。

## 上下文与定向

`extensions/vscode/dev-session-canvas/src/webview/canvasGroupFrameStyles.ts` 生成缩放变量，`styles.css` 绘制前后两层分组，`canvasGroupLayers.tsx` 管理独立于 React Flow 节点的分组拖动。`main.tsx` 和 `paneGallerySurface.tsx` 传递动作。宿主 `extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts` 是状态和运行时删除权威；前端只发送 `webview/deleteGroup`。

## 工作计划

先更新设计和规格，再移除字符估算 tab/双段 toolbar，使用等宽 flex 标题栏和共享 `action-button` 样式。移除 UI 的 onUngroup 透传，保留协议。修订 beginDrag 的首次选择短路，保留 pointer capture 与双击记忆。统一确认路径，补齐鼠标回归和宿主 mock 验证。

## 具体步骤

在仓库根目录运行 `npm run typecheck`、`npm run build -- --execution-profile=stock`、`npm run test:canvas-node-groups`、`npm run test:theme-color-tokens`、`node scripts/test/test-host-execution-owner-wiring.mjs --name-pattern '^group deletion modal'`，然后运行 `node scripts/test/run-playwright-webview.mjs --grep 'group|title.*edit|editing node titles|pressing Enter in the title'`。正式原生构建仍需准备 execution assets；不能把 stock 结果视为替代。

运行 `node scripts/gates/build-smoke-budget.mjs` 重新生成预算；调用 `verifySmokeBudgetSources()` 与 `verifySmokeImplementationSources()` 校验冻结来源和 150 个映射目标，均通过。调用 `checkDocumentation()` 对本轮设计、规格、UI 与计划检查链接和 frontmatter，均通过。`git diff --check` 通过。

## 验证与验收

浏览器验证长短标题、不同 zoom、选中前后均与 group 等宽，只有删除按钮且可键盘聚焦。验证首次拖文字/空白、点击、双击、编辑与删除不拖动、取消、正文平移、resize 和 root 无删除按钮。宿主验证取消不变状态，保留不终止执行，递归删除沿用清理，空组也显示 modal。真实 VS Code 创建普通组和多根工作区，确认视觉与原生弹窗；未执行时明确记录。

## 幂等性与恢复

无迁移、依赖变更或部署；测试使用临时目录与 harness，可安全重跑。不回滚用户的索引和研究文件，不使用 reset 清理。

## 证据与备注

    Playwright: 56 passed (1.5m)
    新增等宽/键盘/首次拖动/取消专项: 9 passed (16.1s)
    Host execution owner wiring: 9/9 passed (non-native only)
    theme color token tests passed
    canvas node status presentation tests passed
    Smoke budget and source mapping checks passed: 150
    Changed time budgets: []

本地运行日志：`/tmp/canvas5-group-final.log`、`/tmp/canvas5-group-new-tests.log`。这些是当前机器的执行证据，不是跨平台 CI 或长期发布工件。

## 接口与依赖

保持 `CanvasGroupSummary`、`webview/deleteGroup`、`webview/moveGroup`、`webview/resizeGroup` 不变。复用 React、React Flow、VS Code theme token 和现有 modal，不引入新库或平行删除状态机。

2026-11-06：创建计划，记录授权方向、交互假设与验收。

2026-11-06：实现与定向验证完成，补充原生资产限制和透明边框修正，登记人工验收并归档。

## 截图反馈：增加标题栏上下留白

2026-11-06 用户反馈标题与删除按钮贴近上下边框。将基础标题高度从 28px 增至 36px，按钮仍为 24px，100% 缩放时上下各约 6px 留白（含边框）；正文上沿固定为 28px，避免移动或挤压已有节点。新增 0.4/0.5/1/1.8 缩放下的上下留白及垂直居中断言，保留边框原线宽。该小幅视觉调整沿用原设计，未增加交互或改变宿主几何。

本次 `npm run typecheck`、`npm run build -- --execution-profile=stock`、`npm run test:theme-color-tokens`、文档链接检查及 `git diff --check` 通过。`node scripts/test/run-playwright-webview.mjs --grep 'group'` 为 54/54 通过（1.4m），日志 `/tmp/canvas5-group-header-spacing.log`。真实 VS Code 的目视验收仍需用户确认。

## Review 修复：保留首次右侧空白双击的归属

独立 review 在四档缩放下确认：未选中普通组右侧空白首次双击会因第二击命中新挂载删除按钮而发出删除请求，不能聚焦；不是直接删除内容。此次修复在标题栏捕获阶段识别始于标题栏的点击序列，将第二击保留给既有双击/拖动状态机，同时保持普通按钮及键盘激活。不修改宿主删除语义或其他节点交互。新增四档缩放的原始复现、后续正常删除、第二次按下拖动及 Enter/Space 回归。

原四项双击测试在修前全部失败，修后连同第二次按下拖动为 5/5 通过。扩展回归首轮为 77/78，仅新增 Space 激活失败：现有删除按钮未隔离 keydown，React Flow 的 document Space 监听会 preventDefault。按钮补齐与节点 ActionButton 相同的 keydown 传播隔离，不阻止原生 click。独立复审通过 HEAD/修复前/修复后对照确认 Space 属于历史缺口；本轮一并补齐新的单按钮键盘路径。

原审查子代理 Schrodinger 在最新源码隔离构建后确认 P2 已关闭，未发现新的确定性 blocker。四档缩放、后续删除、第二次按下拖动和 Enter/Space 共 7/7 通过，日志 `/tmp/canvas5-independent-rereview-final.log`；独立 capture 专项 10/10 通过，覆盖取消回滚、Ctrl/Cmd、编辑、右键及 root 只读输入。复审为只读，没有远端 MR 操作。

主线程最终 `node scripts/test/run-playwright-webview.mjs --grep 'group|pane gallery|editing node titles|pressing Enter in the title'` 为 78/78 通过（2.4m），日志 `/tmp/canvas5-group-doubleclick-regression-final.log`。typecheck、显式 stock 构建、文档检查与 `git diff --check` 均通过；真实宿主的既有验证边界不变。

同时检查正式浏览器门禁，发现 `scripts/gates/browser-catalog.json` 尚未登记本功能先前 9 项和本轮 7 项测试；依据 Playwright `--list --reporter=json` 的实际 ID、文件与完整标题补齐，438 项与实际集合完全一致，未删除旧项或修改门禁逻辑。该一致性检查只证明测试注册，不冒充全量 438 项执行通过。

## 创建 PR 前同步与复验

2026-11-06 用户授权创建 PR。原节点边界分支已通过 PR #364 合并，本任务单独建立 `canvas-group-header-interactions`，只提交分组相关的 24 个文件；OSC 研究文档、索引条目及本地图片不进入 PR。主题提交 rebase 到 `origin/main@809f75124ca98d24a4a5fca657a128eb51141be3`；文档索引和技术债冲突保留双方内容，smoke budget 按合并后源码重新生成，仅涉及两个 hash、入口重命名及一处行号，不调整等待预算。

rebase 后 `npm run typecheck`、`npm run build -- --execution-profile=stock`、`npm run test:canvas-node-groups`、`npm run test:theme-color-tokens`、宿主删除矩阵 9/9 和原 78 项 Webview 回归再次通过。日志为 `/tmp/canvas5-pr-typecheck.log`、`/tmp/canvas5-pr-build.log`、`/tmp/canvas5-pr-browser.log`。文档检查及 diff check 通过；实际浏览器注册与合并后目录的 439 项 ID、文件和完整标题集合一致，smoke source hash 与 153 个实现映射通过。439 项仅为目录一致性，不代表全量执行。

Schrodinger 针对 `56190a3e51a7f1d422e889c264163586ff68ab2c` 静态复审确认未发现新的确定性 blocker：上游创建锚点、视口尺寸、节点尺寸及递归删除准备/失败处理/replacement journal 路径保留，原双击和 Space 修复保留。本次不替代真实 VS Code 安装或正式跨平台门禁验收，也不包含合并授权。
