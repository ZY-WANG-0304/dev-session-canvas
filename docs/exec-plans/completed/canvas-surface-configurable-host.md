# 支持可配置的主画布承载面

本 ExecPlan 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘` 这几个章节。

本计划位于仓库根目录下的 `docs/PLANS.md` 约束体系内，后续任何继续推进该主题的协作者都必须按 `docs/PLANS.md` 的要求持续维护本文件。

## 目标与全局图景

这项工作要让 OpenCove 的主画布不再被固定绑定到 VS Code 编辑区。完成后，用户可以把主画布配置为出现在 `editor` 或 `panel` 中，并继续在同一张无限画布上使用 Agent、Terminal、Task、Note 四类节点。用户最直接能看到的变化是：当他们点开其他文件时，不必再和主画布抢同一个编辑器区域；只要把画布默认承载面改为 `panel`，再执行“打开画布”，主画布就会出现在不和编辑器互斥的宿主区域里。

本计划同时覆盖设计、实现和验证。最终结果必须包含正式设计文档、更新后的产品规格、可工作的 `editor/panel` 双承载面实现，以及至少一轮自动化检查结果。

## 进度

- [x] (2026-04-04 19:17 +0800) 读取 `docs/WORKFLOW.md`、`docs/PLANS.md`、`docs/DESIGN.md`、`docs/FRONTEND.md`、`ARCHITECTURE.md`、`docs/design-docs/vscode-canvas-runtime-architecture.md` 与 `docs/product-specs/canvas-core-collaboration-mvp.md`，确认这是一个需要正式设计结论和 ExecPlan 支持的宿主层变更。
- [x] (2026-04-04 19:17 +0800) 审查当前实现，确认主画布被单一 `WebviewPanel`、单一 `webviewReady` 和单播消息逻辑写死，不能直接支持 `panel` 承载面。
- [x] (2026-04-04 19:17 +0800) 新增本 ExecPlan，并同步补充正式设计文档与产品规格，记录“editor/panel 单主 surface、默认按配置打开、不支持双活同步”的结论。
- [x] (2026-04-04 19:34 +0800) 将当前宿主层改造成可在 `editor` 与 `panel` 之间切换的单主 surface 实现，并保留现有对象图与执行会话主路径。
- [x] (2026-04-04 19:34 +0800) 更新命令入口、设置项、README 与侧栏摘要，使用户能看见默认承载面并显式打开目标 surface。
- [x] (2026-04-04 19:35 +0800) 运行 `npm run typecheck` 与 `npm run build`；两者通过。
- [x] (2026-04-05 07:30 +0800) 用户在 `Extension Development Host` 中完成人工验证，确认 `editor/panel` 两种承载面都能完成创建、切换与执行会话重新附着。
- [x] (2026-04-05 07:30 +0800) 根据人工验证结果回写正式设计文档，并将本计划迁入 `docs/exec-plans/completed/`。

## 意外与发现

- 观察：当前代码虽然把对象图和执行会话权威状态留在 Extension Host，但宿主表面仍被“只有一个编辑区 Webview”这个假设贯穿。
  证据：`src/panel/CanvasPanelManager.ts` 目前只持有单个 `panel` 字段、单个 `webviewReady` 标志，并把所有 `postMessage` 都发向这一个 surface。

- 观察：用户要解决的核心痛点不是“画布一定要去 Panel”，而是“回到主画布的路径不能总和打开文件这条主路径打架”。
  证据：本轮对话里，用户明确把 `panel` 视为避免与编辑区互斥的候选承载面，并接受“只支持 editor/panel，不支持双画板同时显示”的收口。

- 观察：当前终端尺寸复杂度没有最初担心的那么高，因为画布缩放不会自动等价为 PTY 字符网格变化。
  证据：`src/webview/main.tsx` 中的终端 resize 由 `ResizeObserver + FitAddon.fit()` 驱动，依赖的是终端容器实际尺寸，而不是 React Flow 的视图缩放。

- 观察：当前构建链本身仍会输出 `fs.rmdir(path, { recursive: true })` 的 Node.js 弃用告警，但不影响本轮 `editor/panel` surface 功能接通。
  证据：2026-04-04 运行 `npm run build` 时输出 `(node:14) [DEP0147] DeprecationWarning`。

## 决策记录

- 决策：第一版只支持 `editor` 与 `panel` 两种主画布承载面，不把 `sidebar` 纳入同一期。
  理由：用户当前问题是“编辑区与主画布抢位置”，`panel` 已能直接缓解这一点；而 `sidebar` 的宽度约束与完整无限画布体验冲突更大，会抬高实现与验证成本。
  日期/作者：2026-04-04 / Codex

- 决策：第一版实现采用“单主 surface”模型，而不是让 `editor` 和 `panel` 双活同步。
  理由：双活会立刻把嵌入式终端、Agent 会话附着、终端 resize 和局部 UI 状态冲突升级为高复杂度问题；当前用户已明确不需要这一能力。
  日期/作者：2026-04-04 / Codex

- 决策：`OpenCove: 打开画布` 按配置项决定默认承载面，同时补充显式“在编辑区打开”和“在面板打开”命令。
  理由：只靠设置项不足以支撑切换和验证；显式命令既能降低回路成本，也能作为非活动 surface 的恢复入口。
  日期/作者：2026-04-04 / Codex

- 决策：当非活动宿主 surface 被用户展开时，只渲染静态切换提示，不让它承载真正的画布应用。
  理由：这能在不做双活同步的前提下，明确避免重复附着 Agent / Terminal 会话，同时保留从另一个宿主区域切换回主画布的入口。
  日期/作者：2026-04-04 / Codex

## 结果与复盘

当前已完成：

- 明确了产品改动范围：主画布从“固定在编辑区”改为“支持 `editor/panel` 可配置承载面”。
- 确认了实现边界：不做双活同步，不把 `sidebar` 纳入第一版。
- 确认了当前主要技术改动点在宿主 surface 生命周期与入口控制，而不是对象图或 PTY 后端。
- 已完成第一版实现：
  - `package.json` 中新增 Panel 容器、显式打开命令和默认承载面配置
  - `CanvasPanelManager` 升级为同时管理编辑区 `WebviewPanel` 与 Panel `WebviewView`
  - 非活动 surface 改为静态切换提示，不再附着第二个交互式画布
  - 侧栏状态摘要和 README 已同步承载面概念
- 自动化检查已通过：
  - `npm run typecheck`
  - `npm run build`
- 用户已在 `Extension Development Host` 中完成手动验证：
  - 默认承载面设为 `panel` 时，`OpenCove: 打开画布` 会打开 Panel 中的主画布。
  - 默认承载面切回 `editor` 后，同一命令会回到编辑区主画布。
  - 非活动 surface 只显示静态切换提示，不会出现第二个可交互终端窗口。
- 本计划已迁入 `completed/`；本轮未发现需要单独新增登记的 surface 技术债。

## 上下文与定向

本任务中的“承载面”指 VS Code 工作台中真正放置主画布的宿主区域。当前仓库只有一种承载面：Editor Group 中的 `WebviewPanel`。如果用户打开别的文件，主画布 tab 就会被切走，返回主画布需要重新定位或切回对应 tab。这和 OpenCove 的产品目标有冲突，因为主画布本应是用户理解多对象全局状态的稳定工作面。

与本任务直接相关的文件有：

- `src/panel/CanvasPanelManager.ts`：当前宿主权威状态、`WebviewPanel` 生命周期、执行会话桥接和所有 Host -> Webview 消息都在这里。
- `src/extension.ts`：命令注册与侧栏 `TreeView` 注册入口。
- `src/sidebar/CanvasSidebarView.ts`：当前侧栏只知道“画布在编辑区是否可见”，还不知道默认承载面。
- `src/panel/getWebviewHtml.ts`：当前只会为单一主画布输出一份可交互 HTML。
- `package.json` 与 `package.nls.json`：需要补 `panel` 视图容器、命令和设置项。
- `docs/design-docs/vscode-canvas-runtime-architecture.md`：当前仍把 `WebviewPanel` 写成主画布唯一首选入口。
- `docs/product-specs/canvas-core-collaboration-mvp.md`：当前仍把“运行在 Editor Group 中的主画布入口”写成范围内能力。

本计划里“单主 surface”表示：任一时刻只有一个画布 surface 处于可交互状态并承载执行型节点；如果另一个宿主位置也被用户打开，它只能显示切换提示，不应和主 surface 同时驱动终端或 Agent 会话。

## 工作计划

先更新正式文档，把“主画布固定在编辑区”的旧结论收口为“支持 `editor/panel` 可配置承载面”。这里必须同时更新产品规格、专项设计文档、设计索引和顶层运行时设计文档，避免实现和文档长期分叉。

实现阶段先保留现有对象图、执行会话和消息协议，不在第一版引入第二套前端协议。宿主层要做的不是“让所有 surface 同时活着”，而是拆出“当前主 surface 是谁”“当前主 surface 是否 ready”“另一个 surface 看到什么”这三层概念。`editor` surface 继续使用 `WebviewPanel`；`panel` surface 使用 `WebviewView` 承载于 `viewsContainers.panel`。两者共用同一套画布前端 HTML，但只有活动 surface 渲染真正的画布应用；非活动 surface 只显示静态说明和切换入口。

实现顺序应当是：

1. 先补设置项、命令和 `panel` view contribution，让 VS Code 能看见新的宿主入口。
2. 再重构 `CanvasPanelManager`，把“当前活动 surface”和“具体 surface handle”拆开。
3. 然后补齐 `panel` view 的 reveal / show 路径、侧栏摘要和命令行为。
4. 最后跑自动化检查，并整理人工验证步骤。

## 具体步骤

在仓库根目录按以下顺序推进：

1. 更新文档：
   - 新增 `docs/design-docs/canvas-surface-placement.md`
   - 更新 `docs/design-docs/index.md`
   - 更新 `docs/design-docs/core-beliefs.md`
   - 更新 `docs/design-docs/vscode-canvas-runtime-architecture.md`
   - 更新 `docs/product-specs/canvas-core-collaboration-mvp.md`
   - 更新 `docs/product-specs/index.md`
2. 更新扩展清单与本地化字符串：
   - `package.json`
   - `package.nls.json`
3. 更新宿主层与 surface 注册：
   - `src/extension.ts`
   - `src/panel/CanvasPanelManager.ts`
   - `src/panel/getWebviewHtml.ts`
   - `src/sidebar/CanvasSidebarView.ts`
4. 运行自动化检查：
   - `npm run typecheck`
   - `npm run build`
5. 若当前环境无法启动 GUI，则保留 `Extension Development Host` 手动验证步骤，明确需要验证 `editor` 与 `panel` 两种承载面的打开、切换和会话恢复。

## 验证与验收

本计划完成后，至少应满足以下可观察行为：

- 用户可在设置中把默认主画布承载面改为 `editor` 或 `panel`。
- 执行 `OpenCove: 打开画布` 时，画布会出现在配置的承载面，而不是固定在编辑区。
- 执行显式命令时，用户可以分别在编辑区或面板中打开主画布。
- 当主画布在 `panel` 中时，用户点开其他文件不会把画布从同一宿主区域挤走。
- 当前主 surface 中的节点创建、Task/Note 编辑、Agent/Terminal 运行主路径不应回退。
- `npm run typecheck` 与 `npm run build` 通过。

如果当前环境无法跑 GUI，本计划的手动验收应至少写明：

- 在 `Extension Development Host` 中把 `opencove.canvas.defaultSurface` 设为 `panel`，执行 `OpenCove: 打开画布`，确认主画布出现在 Panel。
- 再把设置改为 `editor`，重新执行同一命令，确认主画布回到 Editor Group。
- 在两种承载面中分别创建 `Task` 和 `Terminal` 节点，确认对象图与会话状态在切换承载面后仍可恢复。

以上手动验收已于 2026-04-05 在 `Extension Development Host` 中完成。

## 幂等性与恢复

- 文档更新可重复执行；若实现阶段发现结论需要改写，必须回写设计文档和本计划，而不是只改代码。
- `editor` -> `panel` 切换时，允许销毁旧的编辑区 `WebviewPanel`；对象图和执行会话都以宿主权威状态为准，因此重新打开 surface 不会丢失真实业务状态。
- `panel` -> `editor` 切换时，如果 `panel` 视图仍保持可见，非活动 surface 只能显示静态提示，不应继续承载交互式终端会话。
- 若 `panel` reveal 命令在旧版 VS Code 上无法直接打开自定义 view，应保留降级提示，而不是静默失败。

## 证据与备注

本次工作的关键前提与完成证据如下：

    当前产品痛点：
    “主画布放在编辑区，如果要点击其他文件的话，编辑区会切换。切回主画布不方便。”

    当前实现耦合点：
    src/panel/CanvasPanelManager.ts 只有单个 panel 与 webviewReady 字段，
    所有 Host -> Webview 消息都通过 this.panel?.webview.postMessage(...) 单播。

    当前复杂度收口：
    用户明确不需要同时显示 editor 和 panel 两个画板；
    本计划因此采用“单主 surface，非活动 surface 只显示切换提示”的实现边界。

    验证结果：
    用户已在 Extension Development Host 中完成 editor/panel 承载面切换与待机行为验收，
    并确认默认命令、显式打开命令和执行会话重新附着路径均按预期工作。

## 接口与依赖

本计划要求最终代码至少定义并使用以下接口边界：

- 一个表示主画布承载面的稳定枚举，例如 `editor | panel`。
- 一个统一的宿主入口，用于：
  - 读取默认承载面配置
  - 打开指定承载面
  - 获取当前主 surface 状态
  - 将 Host -> Webview 消息只发往当前活动 surface
- `package.json` 中的 `viewsContainers.panel` + `views` 贡献，用于承载 `panel` 版主画布。
- `vscode.window.registerWebviewViewProvider(...)`，用于注册 `panel` surface。
- `vscode.window.registerWebviewPanelSerializer(...)`，继续承载 `editor` surface 的恢复链路。

本次修订说明：

- 2026-04-04 19:17 +0800 新建本计划，用于覆盖主画布从“固定编辑区”升级为“editor/panel 可配置承载面”的设计、实现与验证。
- 2026-04-04 19:35 +0800 回填第一版实现、自动化检查结果与“非活动 surface 只显示切换提示”的最终收口。
- 2026-04-05 07:30 +0800 根据用户反馈的人工验证结果，将本计划收口为已完成状态，并迁入 `docs/exec-plans/completed/`。
