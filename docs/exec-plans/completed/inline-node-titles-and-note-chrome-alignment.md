# 收口 Note 头部与节点标题内联编辑，并对齐画布控件风格

本 ExecPlan 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘` 这几个章节。

本计划原始路径是 `docs/exec-plans/active/inline-node-titles-and-note-chrome-alignment.md`，完成后已移至 `docs/exec-plans/completed/inline-node-titles-and-note-chrome-alignment.md`；文档内容仍按 `docs/PLANS.md` 的要求维护。

## 目标与全局图景

这次变更要继续收口当前画布的视觉语言和节点主路径。完成后，`Note` 节点应只保留一个更轻的标题栏和单一正文区域，不再出现冗余的 `Note + Note No.` 双层标题、状态胶囊或额外提示块；`Agent`、`Terminal`、`Note` 的标题都应能直接在标题栏改名；左下角导航控件也应更接近 VSCode 原生工具控件，而不是带强玻璃感的自定义悬浮组件。

用户最直接能看到的变化是：新建一个 `Note` 时，标题栏直接显示并可编辑 `Note 1` 这类标题，右侧只剩删除按钮；正文区只保留一个写作区域；`Agent` 和 `Terminal` 也可以在标题栏内直接改名；左下角缩放控件在浅色与深色主题下都更像 VSCode 自带控件。

## 进度

- [x] (2026-04-07 23:03 +0800) 读取 `docs/WORKFLOW.md`、`docs/FRONTEND.md` 与现有设计文档，确认这轮属于需要正式留痕的交付性 UI 收口。
- [x] (2026-04-07 23:06 +0800) 新建本 ExecPlan，明确 Note chrome 简化、节点标题栏内联编辑与左下角控件风格对齐的范围。
- [x] (2026-04-07 23:10 +0800) 更新设计文档，记录 Note 头部/正文结构、标题编辑位置与 controls 风格的当前结论。
- [x] (2026-04-07 23:18 +0800) 实现协议、宿主与 Webview 的通用标题更新链路，并让 `Agent` / `Terminal` / `Note` 都支持标题栏改名。
- [x] (2026-04-07 23:18 +0800) 收口 `Note` 节点的头部与正文结构，只保留单一正文区域和删除动作。
- [x] (2026-04-07 23:18 +0800) 调整左下角画布控件样式，使其更接近 VSCode 原生工具控件。
- [x] (2026-04-07 23:39 +0800) 更新自动化测试与截图基线，运行 `npm run typecheck`、`npm run build`、`npm run test:webview`、`npm run test:smoke`。
- [x] (2026-04-07 23:39 +0800) 完成结果复盘；本轮无新增必须登记的后续技术债，计划移入 `completed/`。

## 意外与发现

- 观察：当前 `Note` 虽然已经从 `Task` 语义中收口出来，但仍保留了“类型名 + 实际标题 + 状态 + kicker + footer hint”这一组冗余层级，和“单一轻量辅助对象”的目标仍有距离。
  证据：`src/webview/main.tsx` 的 `NoteEditableNode` 仍渲染 `strong Note`、副标题、状态胶囊、`document-kicker` 和 `object-footer-hint`。

- 观察：标题目前只有 `Note` 可以编辑，且编辑位置在正文区；执行型节点的标题仍是静态文本，和“节点本体即主工作面”的路径不一致。
  证据：`src/webview/main.tsx` 中 `AgentSessionNode` 与 `TerminalSessionNode` 的标题区域仍是纯文本 `strong`，协议里也没有通用标题更新消息。

- 观察：左下角 controls 当前仍采用圆角玻璃卡片式样式，和 VSCode 原生工具条的平直、低强调语言不一致。
  证据：`src/webview/styles.css` 中 `.canvas-shell .canvas-controls` 仍有大圆角、伪高光层和显著浮层阴影。

- 观察：标题栏内联编辑在测试环境里会因为 `blur()` 后再次显式派发 `focusout`，把同一个标题更新消息发两次；如果只靠宿主回写去消重，Playwright 与真实 DOM 驱动会继续看到重复记录。
  证据：`npm run test:webview` 首次失败时，`editing node titles posts updateNodeTitle for agent, terminal, and note` 收到 6 条 `webview/updateNodeTitle`，而不是预期的 3 条。

- 观察：这轮视觉收口的行为测试通过后，唯一剩余回归是截图基线差异；差异来自预期中的标题栏、Note chrome 和左下角 controls 更新。
  证据：`npm run test:webview` 第二次执行时仅 `canvas-shell-baseline.png` 失败；更新 `tests/playwright/webview-harness.spec.mjs-snapshots/canvas-shell-baseline-linux.png` 后 9/9 通过。

## 决策记录

- 决策：`Note` 的标题栏直接承担标题显示与编辑，不再保留单独的“Note 类型标签 + 标题副行”双层结构。
  理由：当前 `Note` 已是唯一辅助对象，再保留类型名与标题分层只会制造视觉冗余。
  日期/作者：2026-04-07 / Codex

- 决策：三类节点都允许在标题栏直接改名，并统一走宿主权威状态写回。
  理由：节点标题属于对象身份本身，应和对象表面绑定，而不是只允许某一类节点在正文区改名。
  日期/作者：2026-04-07 / Codex

- 决策：左下角控件优先对齐 VSCode 原生工具控件，而不是延续当前玻璃悬浮块风格。
  理由：导航控件不应成为风格焦点；它的职责是稳定、熟悉、低噪音。
  日期/作者：2026-04-07 / Codex

## 结果与复盘

本轮已经把三类节点的对象身份入口统一到标题栏。`Agent`、`Terminal`、`Note` 现在都支持在 `window-chrome` 内直接改名，并通过新的 `webview/updateNodeTitle` 链路写回宿主权威状态；reload 后标题会继续恢复。`Note` 的 chrome 也进一步收口，只保留标题和删除动作，正文区只剩一个单一文本区域，不再保留状态胶囊、类型标签、kicker 或底部 hint。

视觉上，左下角 controls 已从高圆角玻璃浮层改成更平直、低强调的 VSCode 原生工具控件语言；这项调整在浅色和深色主题下都不会再显得像独立的深色悬浮插件块。为了让标题内联编辑在测试与真实浏览器交互里都稳定，组件侧还补了“同值不重复上报”的提交幂等，避免 `blur/focusout` 双触发造成重复消息。

本轮没有新增必须继续挂账的技术债。后续如果还要继续收口视觉语言，重点应回到更大范围的画布控件与节点系统，而不是再拆分 `Note` 的字段结构。

## 上下文与定向

本轮直接相关的关键文件如下：

- `docs/design-docs/note-only-auxiliary-node-and-theme-alignment.md`：当前辅助对象与主题跟随的正式设计结论，需要补充这轮新的现行 UI 规则。
- `src/common/protocol.ts`：共享消息协议与测试 DOM action 校验，当前没有通用标题更新消息。
- `src/panel/CanvasPanelManager.ts`：宿主权威状态，当前只有 `Note` 的整块内容更新，没有通用标题更新入口。
- `src/webview/main.tsx`：三类节点组件与 test-only DOM action 入口，当前 `Note` 仍保留多余层级，`Agent` / `Terminal` 标题仍不可编辑。
- `src/webview/styles.css`：节点表面与 controls 的视觉实现，当前左下角控件仍偏玻璃卡片，`Note` 正文也仍有额外结构。
- `tests/playwright/webview-harness.spec.mjs` 与 `tests/vscode-smoke/extension-tests.cjs`：需要同步覆盖标题栏编辑与新的 note-only 视觉基线。

这里的“标题栏内联编辑”指的是：用户直接在节点顶部的标题区域编辑对象名称，提交后进入宿主权威状态，并在 reload 后恢复。

这里的“单一正文区域”指的是：`Note` 的正文区不再包含额外的 kicker、二级标题或底部 hint，只保留一个负责写入和显示正文的主要文本区域。

## 工作计划

先补设计文档，把 `Note` 头部和正文的收口、三类节点的标题编辑位置，以及左下角控件的当前方向写成正式结论。

随后改共享协议和宿主状态。为 Webview 增加通用标题更新消息，并在宿主侧提供统一的节点标题写回逻辑，避免每个节点各走一套私有更新路径。

再改 Webview 组件与样式。`Note` 改成标题栏内联标题输入 + 单一正文区域，删除状态胶囊、kicker 与 footer hint；`Agent` / `Terminal` 在标题栏中把静态标题换成可编辑输入，同时保留现有副标题、provider 与运行控制；左下角 controls 改成更平直、更低噪音的 VSCode 原生风格。

最后更新自动化测试和截图基线，覆盖三类标题编辑、Note 正文写路径与新的画面基线，再跑完整验证。

## 具体步骤

1. 更新 `docs/design-docs/note-only-auxiliary-node-and-theme-alignment.md`，补充当前 Note chrome、内联标题编辑和 controls 风格结论。
2. 在 `src/common/protocol.ts` 中新增通用标题更新消息，并同步扩展 parser / validator。
3. 在 `src/panel/CanvasPanelManager.ts` 中实现统一的节点标题更新写回逻辑，并接入新的 `webview/*` 消息。
4. 在 `src/webview/main.tsx` 中把 `Agent`、`Terminal`、`Note` 的标题区改为可编辑标题栏，并精简 `Note` 的正文结构。
5. 在 `src/webview/styles.css` 中调整标题栏输入、Note 正文区域和左下角 controls 的样式。
6. 更新 `tests/playwright/webview-harness.spec.mjs`、`tests/vscode-smoke/extension-tests.cjs` 和截图基线。
7. 运行：
   - `npm run typecheck`
   - `npm run build`
   - `npm run test:webview`
   - `npm run test:smoke`

## 验证与验收

本轮至少满足以下条件才算完成：

- `Note` 标题栏直接显示并可编辑 `Note N` 这类标题，不再出现单独的 `Note` 类型标签行。
- `Note` 标题栏右侧不再显示状态胶囊，只保留删除按钮。
- `Note` 正文区只保留一个主要文本区域，不再保留额外的 kicker 或 footer hint。
- `Agent`、`Terminal`、`Note` 都能在标题栏直接改名，且 reload 后名称仍会恢复。
- 左下角 controls 在视觉上更接近 VSCode 原生工具控件，而不是高强调玻璃浮层。
- `npm run typecheck`、`npm run build`、`npm run test:webview`、`npm run test:smoke` 通过。

## 幂等性与恢复

- 标题更新消息应只改动节点标题与 `updatedAt`，不应意外覆盖运行状态、正文或 metadata。
- 反复编辑标题、切换承载面和 reload 后，宿主状态应保持一致。
- `Note` 的结构收口不应破坏已有正文持久化；旧状态中的 `Note` 仍能正常恢复。

## 证据与备注

关键验证结果如下：

    npm run typecheck
    -> 通过

    npm run build
    -> 通过

    npm run test:webview
    -> 首次失败：标题内联编辑重复上报 + baseline screenshot 差异
    -> 修复标题提交幂等并更新 `tests/playwright/webview-harness.spec.mjs-snapshots/canvas-shell-baseline-linux.png` 后 9/9 通过

    npm run test:smoke
    -> Trusted workspace smoke passed.
    -> Restricted workspace smoke passed.
    -> VS Code smoke test passed.

## 接口与依赖

本轮继续使用现有 React Flow、React 和 VSCode Webview 基线，不新增新的运行时依赖。

需要新增或收口的稳定接口包括：

- `src/common/protocol.ts`

    type WebviewToHostMessage =
      | { type: 'webview/updateNodeTitle'; payload: { nodeId: string; title: string } }
      | ...

- `src/panel/CanvasPanelManager.ts`

    function updateNodeTitle(state: CanvasPrototypeState, nodeId: string, title: string): CanvasPrototypeState

- `src/webview/main.tsx`

    onUpdateNodeTitle?: (nodeId: string, title: string) => void;

更新说明：

- 2026-04-07 23:06 +0800，新建本计划，定义 Note chrome 精简、标题栏内联编辑与左下角控件风格对齐的实现范围。
- 2026-04-07 23:39 +0800，补齐验证结果与复盘，确认本轮完成并准备移入 `completed/`。
