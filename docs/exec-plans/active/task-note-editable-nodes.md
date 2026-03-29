# 把 Task 与 Note 升级为可编辑真实节点

本 ExecPlan 是活文档。推进过程中必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘`。

## 目标与全局图景

让画布中的 `Task` 和 `Note` 不再只是占位卡片，而是可直接在节点内部编辑并持久化的真实协作对象。用户应能在画布上直接维护任务与笔记内容，并在 reload 后看到已提交内容恢复。

## 进度

- [x] 梳理当前 Task/Note 仅为占位卡片的现状。
- [x] 新建本 ExecPlan，明确范围、风险和验收口径。
- [x] 新增正式设计文档，收口节点内编辑与状态分层边界。
- [x] 更新产品规格与设计索引。
- [x] 扩展共享状态模型，为 Task/Note 增加真实元数据。
- [x] 在宿主侧实现 Task/Note 更新与摘要生成。
- [x] 在 Webview 中实现 Task/Note 节点内编辑。
- [x] 完成构建与类型检查。
- [x] 记录本轮验证结果与剩余缺口。

## 意外与发现

- 观察：当前原型最大的缺口之一不是“节点种类不够”，而是 Task/Note 虽然存在，但还不能承载任何真实内容。
  证据：当前仓库中 Task/Note 只有占位标题和占位 summary，没有独立元数据、编辑动作或恢复语义。

- 观察：Task/Note 的编辑链路如果继续直接受父级状态控制，会重演 Agent 输入区的焦点问题。
  证据：Agent 输入区已经证明，React Flow 节点上的实时输入必须优先由节点本地状态负责。

## 决策记录

- 决策：Task/Note 第一版都采用节点内直接编辑，不再依赖右侧 inspector。
  理由：这更符合当前“在画布上直接操作协作对象”的产品目标，也能避免再次把主要交互抽离出去。
  日期/作者：2026-03-28 / Codex

- 决策：宿主只保存已提交内容，节点本地状态负责输入过程。
  理由：这样可以同时满足输入稳定性与宿主权威持久化边界。
  日期/作者：2026-03-28 / Codex

## 上下文与定向

相关文档：

- 产品规格：`docs/product-specs/canvas-core-collaboration-mvp.md`
- 运行时设计：`docs/design-docs/vscode-canvas-runtime-architecture.md`
- 新增设计：`docs/design-docs/task-note-editable-nodes.md`

关键代码路径：

- 宿主状态与持久化：`src/panel/CanvasPanelManager.ts`
- 共享协议：`src/common/protocol.ts`
- 画布 UI：`src/webview/main.tsx`
- 样式：`src/webview/styles.css`

本轮不做以下事情：

- 不实现富文本、Markdown 渲染或块编辑器
- 不实现 Task 与 Agent 的自动联动
- 不处理 Agent 长期 CLI 会话模型

## 工作计划

1. 更新产品规格和设计索引，明确 Task/Note 已进入“可编辑真实节点”路线。
2. 扩展共享协议和宿主归一化逻辑，为 Task/Note 增加真实元数据。
3. 在宿主侧实现 Task/Note 更新、摘要生成和持久化。
4. 在 Webview 中实现 Task/Note 节点内编辑。
5. 完成构建验证并记录结果。

## 具体步骤

1. 在 `src/common/protocol.ts` 中新增 Task/Note 元数据与更新消息。
2. 在 `src/panel/CanvasPanelManager.ts` 中新增 Task/Note 创建默认值、归一化、更新和 summary 生成。
3. 在 `src/webview/main.tsx` 中把 Task/Note 从占位卡片升级为可编辑节点。
4. 在 `src/webview/styles.css` 中补齐编辑态样式。
5. 运行 `npm run build` 与 `npm run typecheck`。

## 验证与验收

本轮至少满足以下条件才算完成：

- Task 节点可在节点内编辑标题、状态、任务描述和负责人。
- Note 节点可在节点内编辑标题和正文。
- 已提交内容在 reload 后可恢复。
- `npm run build` 与 `npm run typecheck` 通过。
- 若仍存在输入稳定性问题，必须显式记录，不把它包装成已完成。

## 幂等性与恢复

- 状态归一化必须兼容旧的占位节点数据。
- Task/Note 已提交内容必须由宿主持久化，避免仅存在于 Webview 内存。
- 节点本地输入态若在失焦前丢失，属于当前实现允许的临时态；已提交内容不能无声丢失。

## 结果与复盘

当前已完成：

- 已识别 Task/Note 仍是占位节点这一核心缺口
- 已建立本 ExecPlan
- 已新增正式设计文档，明确节点内编辑与状态分层边界
- 已更新产品规格与设计索引，明确 Task/Note 已进入真实可编辑对象路线
- 已扩展共享协议与宿主状态模型，为 Task/Note 增加元数据、摘要生成与持久化更新
- 已在 Webview 中把 Task/Note 从占位卡片升级为可编辑节点
- 已完成 `npm run build`
- 已完成 `npm run typecheck`

当前仍待完成：

- 无；本轮范围内目标已完成

本轮验证结果：

- `npm run build` 通过
- `npm run typecheck` 通过
- 用户已完成手动验证，确认 Task 标题、状态、任务描述、负责人编辑链路通过
- 用户已完成手动验证，确认 Note 标题、正文编辑链路通过
- 用户已完成手动验证，确认点击其他区域后内容不会回退到旧值
- 用户已完成手动验证，确认 reload 后已提交内容可以恢复
