# 实现画布布局整理

本 `ExecPlan` 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘` 这几个章节。本文遵循 `docs/PLANS.md`。

## 目标与全局图景

用户在画布空白处右键点击“整理画布布局”后，当前画布中的节点、普通分组和 workspace root section 会被一次性整理：重叠减少，相关 Agent / Terminal / 文件 / 连线对象更靠近，普通分组和 root 边界保持清楚。整理结果写入 Host 权威状态，reload 或重开 VSCode 后保持。

## 进度

- [x] (2026-06-17 00:00Z) 从 `origin/main` 创建 `canvas-layout-arrangement` 分支，并确认当前工作树只存在已有未跟踪图片文件。
- [x] (2026-06-17 00:20Z) 新增 `src/common/canvasLayoutArrangement.ts` 纯函数，实现容器递归、关系 component 排列和 root / group 边界保持。
- [x] (2026-06-17 00:35Z) 增加 `webview/arrangeCanvasLayout` 协议和 Host 处理，整理后走现有持久化与 state broadcast。
- [x] (2026-06-17 00:45Z) 在画布空白右键菜单增加“整理画布布局”入口，点击后只发消息且不弹完成提示。
- [x] (2026-06-17 01:05Z) 补充设计文档、ExecPlan、协议测试、布局纯函数测试和 Webview 菜单测试。
- [x] (2026-06-17 03:45Z) 修复 VSCode smoke 中布局持久化用例的收尾清理，避免种子节点影响后续 trusted smoke 主路径。
- [x] (2026-06-17 03:50Z) 重新运行布局、协议、定向 Playwright、trusted smoke、typecheck 和 diff whitespace 检查，当前本计划直接验证项均通过。

## 意外与发现

- 观察：直接用 Node `--experimental-transform-types` 运行 `.mts` 测试无法解析新模块中的无扩展名相对 import。
  证据：`ERR_MODULE_NOT_FOUND ... src/common/canvasMultiRootComposition`。
  处理：布局测试改为与既有分组测试一致的 esbuild bundle `.mjs` 形式。

- 观察：布局持久化 smoke 若不清理 seed state，会让后续 trusted smoke 的 `createBaseNodes()` 断言看到额外 Note。
  证据：`runTrustedSmoke` 期望 `['agent','note','terminal']`，实际包含布局持久化测试留下的额外 Note。
  处理：`verifyCanvasLayoutArrangementPersists()` 末尾执行测试 reset 并等待 editor canvas ready，断言 nodes / groups 为空后再返回。

## 决策记录

- 决策：布局函数放在 `src/common/canvasLayoutArrangement.ts`，不放在 Webview 或 `CanvasPanelManager.ts` 内部。
  理由：整理规则依赖共享 `CanvasPrototypeState`，应可由 Host 权威调用并可纯函数测试。
  日期/作者：2026-06-17 / Codex。

- 决策：入口只放在画布空白右键菜单，不新增 command palette 或 Controls 按钮。
  理由：用户明确选择“画板中右键菜单中提供按钮”。
  日期/作者：2026-06-17 / Codex。

- 决策：首版采用确定性矩形 packing，不引入布局库或物理模拟。
  理由：本功能更重视边界语义、持久化稳定和不跨组移动；复杂布局库会增加依赖和不可控漂移。
  日期/作者：2026-06-17 / Codex。

## 结果与复盘

本计划已交付画布空白右键菜单入口、Host 权威布局整理、持久化写回、纯函数测试、协议测试、Webview 菜单测试与 trusted smoke 持久化验证。实现保持节点归属、root 归属、`cwd`、runtime metadata、edge endpoints 和文件 owner 不变；普通分组与 root 均按容器边界递归整理。

剩余风险是完整 `npm run test:webview` 在本轮曾出现 4 个与本功能无关或疑似波动的失败：baseline screenshot 选择态差异、Claude Ctrl-Z payload 额外 lifecycle 字段、硬换行 file link hover 超时等。新增布局右键菜单用例在完整运行和定向运行中均通过；因此设计文档状态记录为“已部分验证”，等待完整 Webview 回归清洁通过后再升级。

## 上下文与定向

`CanvasPanelManager` 是宿主权威状态入口；Webview 只发用户意图。`CanvasPrototypeState` 中节点和分组都使用绝对坐标，节点通过 `groupId` 归属普通分组或 root，分组通过 `parentGroupId` 嵌套。multi-root workspace 中，workspace root section 是 `role: workspace-root` 的系统分组，root-local 状态与 overlay 的组合 / 拆分由 `src/common/canvasMultiRootComposition.ts` 处理。

## 工作计划

实现顺序是：先新增纯布局函数并覆盖状态级测试，再接协议和 Host 持久化，再补 Webview 右键入口，最后同步设计文档和验证脚本。实现过程中不得改变节点归属、root 归属、`cwd`、runtime metadata、edge endpoints 或 file reference owner。

## 具体步骤

在仓库根目录执行：

    git fetch origin
    git switch -c canvas-layout-arrangement origin/main
    npm run test:canvas-layout-arrangement
    npm run test:protocol-webview-messages
    npm run test:webview
    npm run typecheck
    npm run build
    git diff --check

## 验证与验收

`test:canvas-layout-arrangement` 应输出 `canvas layout arrangement tests passed`。协议测试应接受无 payload 的 `webview/arrangeCanvasLayout`。Webview 测试应确认空白右键菜单显示“整理画布布局”，点击后发送 `webview/arrangeCanvasLayout`，菜单关闭且没有完成 toast。最终 typecheck、build 和 diff check 应通过。

## 幂等性与恢复

布局整理对同一输入应产生确定性状态；重复点击不会改变节点归属或运行语义。若测试失败，可只修改本分支新增或本任务触达的文件；不要删除当前工作树已有未跟踪图片文件。

## 证据与备注

当前已完成的局部验证记录：

    node scripts/test/test-canvas-layout-arrangement.mjs
    canvas layout arrangement tests passed

    npm run test:protocol-webview-messages
    protocol webview message tests passed

    node scripts/test/run-playwright-webview.mjs --grep "canvas context menu can request layout arrangement|right-clicking the empty pane opens"
    2 passed

    DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=trusted npm run test:smoke
    Trusted workspace smoke passed.
    VS Code smoke test passed.

    npm run typecheck
    tsc --noEmit

    git diff --check
    # no output

本次修订说明：根据最终验证结果补齐进度、意外与发现、结果与复盘和证据记录；同时记录 smoke 清理修复，确保后续协作者能直接理解为什么布局持久化用例需要恢复空状态。

## 接口与依赖

新增接口是 `arrangeCanvasLayout(state: CanvasPrototypeState, now?: string): CanvasPrototypeState`，位于 `src/common/canvasLayoutArrangement.ts`。新增 Webview 消息为 `webview/arrangeCanvasLayout`，无 payload。没有新增 npm runtime dependency。
