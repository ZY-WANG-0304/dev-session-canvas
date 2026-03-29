# 对齐 Agent 节点的会话窗口语义

本 ExecPlan 是活文档。推进过程中必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘`。

## 目标与全局图景

把当前原型中的 `Agent` 节点从“选中后在右侧面板发起一次请求的配置卡片”纠正为“直接放在画布上的 Agent 会话窗口”。用户应能在节点内部输入消息、看到连续转录和运行状态，而不是依赖外部检查器才能与 Agent 交互。

本轮还要同步收口正式文档，避免继续把当前错误语义写进产品规格或设计结论。

## 进度

- [x] 对照 OpenCove 截图与当前实现，定位产品语义偏差。
- [x] 新建本 ExecPlan，明确修正目标与验证口径。
- [x] 更新正式产品/设计文档，收口 Agent 节点的正确产品定义。
- [x] 为 Agent 节点补会话转录状态模型。
- [x] 把 Agent 交互从右侧详情区迁移到节点内部。
- [x] 把 Terminal 节点同步收敛为 runtime window 风格。
- [x] 完成构建与类型检查。
- [x] 记录本轮验证结果与剩余缺口。

## 意外与发现

- 观察：当前原型的主要偏差不在 backend 路线，而在产品表面。
  证据：CLI Agent 代理路线本身已被用户验证通过，但当前 UI 把 Agent 退化成了一次性请求卡片；这和 OpenCove 中“画布上的持续会话窗口”不是一回事。

- 观察：如果只改文档、不改原型，后续实现仍会沿着错误交互模型继续积累。
  证据：当前 Webview 把 Agent 的输入、provider 选择和停止动作都放在右上角选中节点面板中，节点本体只显示摘要。

- 观察：Terminal 和 Agent 都属于执行型对象，应该共享同一类 runtime window 视觉与交互家族。
  证据：参考效果里两者都表现为画布上的独立窗口；当前原型只有 Terminal 的“代理会话”边界较清楚，Agent 则被做成了 inspector 驱动表单。

## 决策记录

- 决策：`Agent` 的主交互面必须在节点内部，而不是右侧选中面板。
  理由：产品目标是让用户在画布上直接管理多个执行单元；如果 Agent 依赖外部面板才能交互，就失去了“空间化会话窗口”的核心语义。
  日期/作者：2026-03-28 / Codex

- 决策：第一版 Agent 节点至少保留连续转录、运行状态和节点内输入框。
  理由：这三者是“会话窗口”与“单次请求卡片”的最小分界线。
  日期/作者：2026-03-28 / Codex

- 决策：当前 backend 仍可沿用 CLI 代理原型，但文档必须显式写清“backend 路线成立”不等于“产品表面已经对齐”。
  理由：用户指出的问题是产品定义偏差，不应被之前的 backend 验证结果掩盖。
  日期/作者：2026-03-28 / Codex

## 上下文与定向

相关文档：

- 产品规格：`docs/product-specs/canvas-core-collaboration-mvp.md`
- 运行时设计：`docs/design-docs/vscode-canvas-runtime-architecture.md`
- Agent backend 原型：`docs/design-docs/agent-runtime-prototype.md`

关键代码路径：

- Webview UI：`src/webview/main.tsx`
- Webview 样式：`src/webview/styles.css`
- 宿主状态与 Agent/Terminal 运行：`src/panel/CanvasPanelManager.ts`
- 共享协议：`src/common/protocol.ts`

本轮不做以下事情：

- 不尝试完整复刻 provider 原生 TUI 的所有控件和像素细节。
- 不把当前 CLI backend 一步升级成真正可恢复的长期 PTY 会话。
- 不引入完整边关系、任务编辑或笔记编辑。

## 工作计划

1. 新增独立设计文档，明确 Agent 节点的会话窗口定义与不选方案。
2. 更新产品规格和运行时设计文档，避免继续把 Agent 写成一次性请求卡片。
3. 扩展共享状态，为 Agent 保存转录条目。
4. 重写 Webview 节点渲染，把 Agent/Terminal 交互搬回节点内部。
5. 完成构建验证，并记录本轮结果与剩余缺口。

## 具体步骤

1. 新建 `docs/design-docs/agent-session-surface.md`，写清问题、候选方案、当前结论和验证方法。
2. 更新 `docs/product-specs/canvas-core-collaboration-mvp.md` 中 Agent 对象的定义、范围和验收标准。
3. 在 `src/common/protocol.ts` 中新增 Agent 转录条目类型。
4. 在 `src/panel/CanvasPanelManager.ts` 中把单次运行结果扩展为节点内连续转录。
5. 在 `src/webview/main.tsx` 和 `src/webview/styles.css` 中把 Agent/Terminal 改成 window-like 节点。
6. 运行 `npm run build` 与 `npm run typecheck`。

## 验证与验收

本轮至少满足以下条件才算完成：

- 新的正式文档明确写出：Agent 是节点内会话窗口，而不是 inspector 驱动卡片。
- Agent 节点本体能直接输入消息、发起运行并显示连续转录。
- Terminal 节点本体能直接执行创建/显示/重连动作。
- `npm run build` 与 `npm run typecheck` 通过。
- 如果仍有与 OpenCove 参考效果的差距，必须在结果中显式写清，不把缺口包装成已完成。

## 幂等性与恢复

- 文档改动可重复应用；若后续产品定义继续调整，应以新设计文档为准并同步规格。
- 节点内草稿仍属于 Webview 局部状态，可随 Webview 状态恢复重复验证。
- Agent 转录是宿主权威状态的一部分；即使 Webview 重建，也不应无声丢失已经完成的转录条目。
- 若运行中发生 reload，仍按现有策略收敛为 `interrupted`，并在转录中留下明确提示。

## 结果与复盘

当前已完成：

- 已定位并收口“Agent 被错误实现为 inspector 驱动卡片”的问题定义
- 已新增产品/设计修正文档，并更新正式规格
- 已把 Agent 节点改为节点内会话窗口原型，加入连续转录和节点内输入
- 已把 Terminal 节点同步改为 runtime window 风格
- 已完成 `npm run build`
- 已完成 `npm run typecheck`

本轮验证结果：

- `npm run build` 通过
- `npm run typecheck` 通过
- 用户已完成手动验证，确认 Agent 节点的主交互已稳定收敛到节点内部，不再依赖右侧详情区
- 用户已完成中文输入法手动验证，确认输入框不会再在首次输入后立刻失焦，候选词上屏正常
- 当前仍未覆盖的验证仅剩长期 CLI 会话模型；现状仍是逐轮 CLI 调用累计到同一节点转录
