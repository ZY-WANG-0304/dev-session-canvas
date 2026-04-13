# 修复执行节点缩放后的鼠标命中对齐

本 `ExecPlan` 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘` 这几个章节。

本计划位于仓库根目录下的 `docs/PLANS.md` 约束体系内，后续任何继续推进该主题的协作者都必须按 `docs/PLANS.md` 的要求持续维护本文件。

## 目标与全局图景

当前画布里的 `Terminal` 与 `Agent` 节点会跟随 React Flow 一起缩放，这是明确的产品定义。用户在缩放后的节点里拖选终端文本时，命中的字符区域和视觉区域会错位。完成这次变更后，用户应能继续在被缩放的节点里直接拖选、点击和右键使用嵌入式终端，而不需要切到 overlay、drawer 或外部面板。

这次工作不会改变 PTY 后端、节点内主交互语义或 `cols/rows` 计算路线；它只修复“鼠标进入 `xterm.js` 时的逻辑坐标”和“少量仍绕过统一入口的交互路径”。

## 进度

- [x] (2026-04-12 06:52 +0800) 读取 `docs/WORKFLOW.md`、`docs/PLANS.md`、`docs/DESIGN.md` 和分支命名规则，确认本轮属于需要文档同步与实现验证的交付性修复。
- [x] (2026-04-12 06:52 +0800) 检查当前工作树、切出主题分支 `webview-xterm-zoom-coordinate-alignment`，并复核先前研究阶段的 overlay 倾向已被新的产品约束取代，不再作为当前实现路线。
- [x] (2026-04-12 06:52 +0800) 复核 `src/webview/main.tsx` 与 `@xterm/xterm` 依赖源码，确认必须同时覆盖 `getCoords`、`getMouseReportCoords`、拖选越界滚动和右键 textarea 定位。
- [x] (2026-04-12 06:52 +0800) 更新正式设计文档，把“节点内缩放 + 鼠标坐标补偿”写成当前选定路线，并登记到设计索引。
- [x] (2026-04-12 07:07 +0800) 在 `src/webview/main.tsx` 中为 `Terminal` 与 `Agent` 节点补齐缩放坐标补偿，并覆盖统一鼠标入口、拖选越界滚动与 textarea 定位。
- [x] (2026-04-12 07:09 +0800) 运行 `npm run typecheck` 与 `npm run build`，确认当前补丁没有打断 Webview 类型与构建链路。
- [x] (2026-04-12 08:03 +0800) 在 `tests/playwright/webview-harness.spec.mjs` 中新增缩放拖选回归，使用持久化 viewport `zoom=1.6` 驱动真实鼠标拖选，并同时覆盖 `Agent` 与 `Terminal` 两类执行节点。
- [x] (2026-04-12 08:04 +0800) 运行定向 Playwright 用例和完整 `npm run test:webview`，确认新增缩放回归与原有 Webview harness 用例全部通过。
- [x] (2026-04-12 09:42 +0800) 在 `Extension Development Host` 中完成手工验证；用户确认缩放拖选、越界滚动与右键 textarea 定位都已通过真实宿主验证。
- [x] (2026-04-12 09:42 +0800) 为 `SelectionService._getMouseEventScrollAmount(...)` 与右键 textarea 定位新增 Playwright 回归，并再次运行 `npm run typecheck` 与 `npm run test:webview`，确认 15 条 Webview harness 用例全部通过。

## 意外与发现

- 观察：先前研究文档把 overlay 视为长期标准路线，但用户随后明确了新的产品约束：`Terminal` 必须跟随 React Flow 一起缩放。
  证据：当前回合的实现要求明确排除了 overlay 与 drawer 作为默认修复路线。

- 观察：`xterm.js` 的大多数鼠标命中逻辑都经过 `MouseService`，但仍有两条关键路径直接使用元素相对坐标。
  证据：`SelectionService._getMouseEventScrollAmount(...)` 直接调用 `getCoordsRelativeToElement(...)`；`Clipboard.moveTextAreaUnderMouseCursor(...)` 直接用 `clientX/clientY` 与 `getBoundingClientRect()` 计算 textarea 位置。

- 观察：拖选越界滚动在缩放后的主要风险不只是“离开边界后滚动快慢不对”，而是未补偿坐标时会在视觉上仍处于终端内部的下半区提前触发。
  证据：`SelectionService._getMouseEventScrollAmount(...)` 把相对 `.xterm-screen` 的像素偏移和未缩放的 `css.canvas.height` 直接比较；在 `zoom > 1` 时，视觉高度会比逻辑高度更大。

## 决策记录

- 决策：这次修复保持执行节点继续跟随 React Flow 缩放，不引入 overlay 或默认 drawer。
  理由：用户已经把“终端随画布缩放”定义为产品要求；修复目标应收敛到命中语义，而不是改产品表面。
  日期/作者：2026-04-12 / Codex

- 决策：修复点选在 `xterm.js` 的统一鼠标坐标入口，并补齐拖选越界滚动与右键 textarea 定位这两条绕过入口的路径。
  理由：这样可以在不改 PTY 尺寸语义的前提下，同时覆盖拖选、点击、链接命中、应用侧鼠标上报和右键交互。
  日期/作者：2026-04-12 / Codex

- 决策：本轮不提前抽出新的共享 `xterm` 适配层，而是在 `AgentSessionNode` 与 `TerminalSessionNode` 的现有接入点分别落补丁。
  理由：用户明确要求先避免为这个 bug 做结构性抽象；当前目标是修复，而不是重构执行节点接入层。
  日期/作者：2026-04-12 / Codex

## 结果与复盘

当前已完成：

- 设计结论已从“默认 overlay”收口为“节点内缩放 + 鼠标坐标补偿”。
- `src/webview/main.tsx` 已为 `Agent` 与 `Terminal` 两类节点补上同类缩放坐标补偿。
- 自动化检查 `npm run typecheck` 与 `npm run build` 均通过。
- `tests/playwright/webview-harness.spec.mjs` 已新增缩放拖选回归，并通过真实鼠标拖选 + probe 回读选择文本的方式覆盖 `Agent` 与 `Terminal` 两类节点。
- `tests/playwright/webview-harness.spec.mjs` 已继续覆盖两条旁路路径：缩放下的拖选越界滚动边界，以及右键后的 textarea 定位。
- 自动化验证已补充到 `npm run test:webview`，当前 15 条 Webview harness 用例全部通过。
- `Extension Development Host` 中的手工验证已经完成，真实宿主下的缩放拖选、越界滚动与右键 textarea 定位均已通过。

当前仍未完成：

- 当前没有新的功能性缺口；后续仅剩按正常工作流提交、推送和创建 MR。

## 上下文与定向

与本次修复直接相关的区域如下：

- `src/webview/main.tsx`：`AgentSessionNode` 和 `TerminalSessionNode` 都在这里直接创建 `xterm.js`，并通过 `FitAddon` 计算尺寸。
- `node_modules/@xterm/xterm/src/browser/services/MouseService.ts`：`getCoords(...)` 与 `getMouseReportCoords(...)` 是大多数鼠标命中的统一入口。
- `node_modules/@xterm/xterm/src/browser/services/SelectionService.ts`：拖选超出终端边界后的自动滚动不经过 `MouseService`，需要额外补偿。
- `node_modules/@xterm/xterm/src/browser/Clipboard.ts`：右键和 Linux middle-click 会把隐藏 textarea 移到鼠标下方；缩放下这个定位也会错位。

这里的“统一鼠标坐标入口”指 `xterm.js` 内部把浏览器鼠标事件换算成终端列行的入口。这里的“坐标补偿”指把 React Flow 缩放后的屏幕偏移量按 `1 / zoom` 还原成 `xterm.js` 逻辑坐标，再交给原有逻辑继续处理。

## 工作计划

第一步，更新设计文档，显式记录用户对产品定义的进一步澄清：执行节点仍跟随 React Flow 缩放，本轮修复不改变运行时表面边界。设计文档必须写清楚先前 overlay 研究为什么不再是默认路线，以及本轮为什么改选坐标补偿。

第二步，在 `src/webview/main.tsx` 的 `AgentSessionNode` 与 `TerminalSessionNode` 中都引入当前 viewport `zoom`。`xterm.js` 创建完成后，在每个节点自己的接入点上补齐三类行为：`MouseService` 的列行换算、`SelectionService` 的越界拖选滚动、textarea 的右键/中键定位。所有补偿都必须只影响鼠标逻辑坐标，不触碰 `fit()`、`resizeExecutionSession` 或 PTY `cols/rows` 路线。

第三步，运行构建和自动化回归，并补充可人工复现的验证口径。自动化层优先通过 Playwright harness 在非 `1.0` 缩放下执行真实鼠标拖选、拖选越界滚动和右键定位；人工验证继续保留给真实 `Extension Development Host`。

## 具体步骤

1. 更新 `docs/design-docs/execution-node-zoom-interaction-surface.md` 与 `docs/design-docs/index.md`，把当前路线从 overlay 收口为“节点内缩放 + 坐标补偿”。
2. 修改 `src/webview/main.tsx`：
   - 在执行节点组件中读取当前 viewport `zoom`。
   - 在 `xterm` 初始化完成后补齐鼠标坐标补偿。
   - 保持 `fitAddon.fit()` 与 `data.onResizeExecution(...)` 现有行为不变。
3. 运行 `npm run typecheck`、`npm run build` 与 `npm run test:webview`。
4. 记录人工验证步骤：在 `0.4`、`1.0`、`1.8` 三档缩放下分别验证 `Terminal` 与 `Agent` 的拖选、点击、右键和链接命中。

## 验证与验收

本轮至少满足以下条件才算完成：

- 在 `0.4`、`1.0`、`1.8` 三档缩放下，执行节点内拖选文本时，起点和终点都与视觉字符区域一致。
- 点击、双击、链接 hover/click 与应用侧鼠标上报不再因为缩放而偏移。
- 右键与 Linux middle-click 的 textarea 定位不会因缩放落到明显错误的位置。
- `Terminal` 与 `Agent` 两类节点都完成同类修复。
- `npm run typecheck` 与 `npm run build` 通过。
- Playwright harness 在非 `1.0` 缩放下可以稳定复现并断言 `Terminal` 与 `Agent` 的拖选选择结果、拖选越界滚动边界，以及右键 textarea 定位结果。

## 幂等性与恢复

- 文档修改与代码补丁都应可重复应用；如果后续要抽共享适配层，应在新一轮设计/实现中显式记录，而不是在本轮内静默扩张范围。
- 这次修复不改变宿主状态、协议字段或 PTY 生命周期；若补丁无效，回退只需恢复 `src/webview/main.tsx` 的本轮变更和相关文档即可。
- 若某个浏览器特有路径在 VSCode Chromium 中无法复现，不应凭推测扩大修改面；应先记录残余风险，再决定是否补更深的兼容补丁。

## 证据与备注

当前确认的关键证据如下：

    React Flow viewport 会对节点树施加 scale(...)。
    xterm MouseService 的 getCoords(...) / getMouseReportCoords(...) 负责大多数鼠标命中。
    SelectionService._getMouseEventScrollAmount(...) 与 Clipboard.moveTextAreaUnderMouseCursor(...) 会绕过 MouseService。

这些证据说明：如果只修拖选选择框，而不处理统一坐标入口和两条旁路路径，就会留下新的缩放交互残缺。

## 接口与依赖

本轮继续使用现有依赖，不引入新的终端或画布库：

- `reactflow`：继续提供 viewport `zoom`。
- `@xterm/xterm` 与 `@xterm/addon-fit`：继续作为节点内嵌终端前端与尺寸计算来源。

当前代码层需要维持以下接口不变：

- `data.onResizeExecution(...)` 仍上报当前逻辑 `cols/rows`。
- `webview/startExecutionSession`、`webview/resizeExecutionSession` 和 `webview/executionInput` 协议不新增字段。
- `AgentSessionNode` 与 `TerminalSessionNode` 仍各自持有自己的 `xterm` 实例；本轮不抽出新的共享适配层。

本次修订说明：2026-04-12 新增实现型 ExecPlan，用于把“节点内缩放 + 鼠标坐标补偿”从设计结论推进到代码与验证。
本次修订说明：2026-04-12 09:42 +0800，补记人工验证已完成，并把自动化覆盖从“基础拖选”扩展到“越界滚动边界 + 右键 textarea 定位”。
本次修订说明：2026-04-12 10:00 +0800，当前计划已完成并迁入 `docs/exec-plans/completed/`，后续只剩提交与 MR 流程。
