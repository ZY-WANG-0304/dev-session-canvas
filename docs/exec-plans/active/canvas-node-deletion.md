# 为画布节点补齐删除链路

本 `ExecPlan` 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘` 这几个章节。

本文件位于 `docs/exec-plans/active/canvas-node-deletion.md`，必须按照 `docs/PLANS.md` 的要求持续维护。

## 目标与全局图景

当前画布已经支持创建 `Agent`、`Terminal`、`Task` 和 `Note` 四类节点，但用户还不能删除任意节点，导致对象一旦创建就只能依赖“重置整个宿主状态”清空，无法验证真实的对象生命周期。

本次变更完成后，用户应当能在单个节点上直接执行删除，并且对执行型节点成立完整清理闭环：如果被删除的是正在运行的 `Agent` 或 `Terminal`，宿主必须同步终止对应会话、清掉定时同步与监听器、落盘新的对象图，并保证 reload 后被删除的节点不会重新出现。用户还应当能在选中节点后使用键盘删除，不必只能点按钮。

## 进度

- [x] (2026-03-29 17:53Z) 阅读 `docs/WORKFLOW.md`、`docs/PLANS.md`、`ARCHITECTURE.md`、产品规格和现有设计文档，确认本任务属于跨宿主与 Webview 的显著功能补齐，必须先建立 `ExecPlan` 与正式设计文档。
- [x] (2026-03-29 17:53Z) 检查当前代码链路，确认删除功能至少要覆盖消息协议、宿主状态持久化、活跃执行会话清理、Webview 入口与本地 UI 状态回收。
- [x] (2026-03-29 18:02Z) 新建并持续维护删除功能设计文档、产品规格同步和设计索引。
- [x] (2026-03-29 18:02Z) 在宿主侧实现节点删除、执行会话销毁、空画布恢复边界修正和节点 ID 续号修正。
- [x] (2026-03-29 18:02Z) 在 Webview 侧实现统一删除入口、选中态与本地草稿清理、键盘删除和危险态按钮样式。
- [x] (2026-03-29 18:02Z) 运行 `npm run build` 与 `npm run typecheck`，两者均通过。
- [x] (2026-03-29 18:02Z) 补齐计划、设计文档和残余风险说明。
- [ ] 提交当前分支并创建 MR。

## 意外与发现

- 观察：当前节点 ID 由 `state.nodes.length + 1` 推导。只要允许删除中间节点，后续创建同类型节点时就可能复用仍然存在的旧 ID。
  证据：例如当前状态若含 `note-1`、`task-2`、`note-3`，删除 `task-2` 后数组长度变成 2，再次创建 `note` 会重新生成 `note-3`。

- 观察：`normalizeState()` 在当前实现里会把空节点数组重新替换成默认 `note + task`，这会让“删除全部节点后 reload 仍为空画布”无法成立。
  证据：`src/panel/CanvasPanelManager.ts` 当前使用 `nodes.length > 0 ? nodes : createDefaultState(...).nodes` 作为归一化结果。

- 观察：当前 shell 环境中没有 `code`、`cursor` 或 `codium` CLI，因此无法在这个终端会话里直接拉起 `Extension Development Host` 做最终手动交互验证。
  证据：`command -v code`、`command -v cursor`、`command -v codium` 均无输出。

## 决策记录

- 决策：第一版删除能力同时提供“节点头部删除按钮”和“选中节点后的键盘删除”。
  理由：只提供按钮会让键盘流断裂，只提供快捷键又不够显式；两者一起才能闭合最低可用删除路径。
  日期/作者：2026-03-29 / Codex

- 决策：删除执行型节点时，宿主直接销毁会话并移除节点，而不是先把节点状态写成 `closed` 再等待下一轮手动删除。
  理由：用户动作是“删除对象”，不是“停止后保留壳节点”。如果先改状态再删，会让删除链路多出一层瞬时中间态，也更容易把会话退出消息误写回已删除节点。
  日期/作者：2026-03-29 / Codex

- 决策：继续保持“空存储时生成默认节点；显式持久化的空数组保持为空”的恢复边界。
  理由：初次打开画布仍需要默认示例节点帮助验证主路径；但一旦用户明确删除了全部节点，reload 后再自动补回默认节点会破坏用户意图。
  日期/作者：2026-03-29 / Codex

## 结果与复盘

当前已完成以下结果：

- 共享协议新增 `webview/deleteNode`，让 Webview 可以显式请求删除任意节点。
- Extension Host 新增统一节点删除入口，并在删除执行型节点时同步销毁 PTY 会话、输出同步定时器和进程监听器。
- 节点创建序号改为按现有节点最大数字后缀续号，避免删除中间节点后复用仍在使用的 ID。
- 恢复逻辑改为尊重显式持久化的空节点数组，从而支持“删光后 reload 仍为空画布”。
- Webview 为四类节点统一补上删除按钮，并增加选中节点后的键盘删除。
- Webview 删除后会同步清理本地 `selectedNodeId` 与 `agentProviderDrafts`，避免幽灵选中态和陈旧 provider 草稿。

已完成的自动化验证：

- `npm run build`
- `npm run typecheck`

当前仍未完成的验证：

- `Extension Development Host` 中的最终手动交互确认。由于当前 shell 环境没有 `code` / `cursor` / `codium` CLI，本轮无法在此终端里直接启动 VSCode 开发宿主，只能把这一步留给本地 GUI 环境补充确认。

## 上下文与定向

本任务涉及三块核心代码：

- `src/common/protocol.ts`：定义 Webview 与宿主之间的 typed message 协议。删除节点必须先在这里新增消息，并更新解析校验。
- `src/panel/CanvasPanelManager.ts`：运行在 Extension Host 中，持有宿主权威状态、执行会话映射和 `workspaceState` 持久化逻辑。真正删除节点、清理会话和修复恢复边界都在这里发生。
- `src/webview/main.tsx` 与 `src/webview/styles.css`：运行在 Webview 中，负责 React Flow 节点渲染、本地 `selectedNodeId` / `agentProviderDrafts` UI 状态，以及节点内按钮与键盘交互。

这里的“执行型节点”指 `Agent` 和 `Terminal`。它们在宿主侧都映射为嵌入式 PTY 会话；删除这类节点时，不能只把对象图里的节点删掉，还必须把对应的活跃子进程、输出同步定时器和事件监听器一起销毁。

## 工作计划

先补齐正式文档：为“节点删除的产品语义、会话清理规则和恢复边界”建立单独设计文档，并同步产品规格中的用户流程、范围和验收条目。文档明确后，再改共享协议和宿主逻辑，避免实现先行定义行为。

宿主实现分三部分推进。第一，给 `WebviewToHostMessage` 增加删除消息，并在 `CanvasPanelManager` 的消息分发中接入。第二，新增统一的节点删除函数：普通节点直接移除；执行型节点先销毁会话映射、取消同步定时器、卸载进程监听并发送终止信号，再移除节点。第三，修复创建序号和状态恢复边界，确保删除后不会复用旧 ID，也不会在 reload 时重新长出默认节点。

Webview 实现同样分三部分推进。第一，在四类节点的头部统一加入删除按钮，删除前主动选中该节点，以保持用户可感知的上下文。第二，在 `App` 级别新增删除动作，使其不仅向宿主发送消息，还同步清理本地 `selectedNodeId` 和 `agentProviderDrafts`，避免已删除节点残留草稿。第三，增加画布级键盘删除，只在当前有选中节点、且焦点不在输入框、下拉框、按钮等交互控件上时触发。

## 具体步骤

1. 在仓库根目录更新以下文档：
   - `docs/product-specs/canvas-core-collaboration-mvp.md`
   - `docs/design-docs/canvas-node-deletion.md`
   - `docs/design-docs/index.md`
   - `docs/exec-plans/active/canvas-node-deletion.md`

2. 在仓库根目录更新共享协议与宿主：
   - `src/common/protocol.ts`
   - `src/panel/CanvasPanelManager.ts`

3. 在仓库根目录更新 Webview：
   - `src/webview/main.tsx`
   - `src/webview/styles.css`

4. 运行自动化验证：

       npm run build
       npm run typecheck

5. 验证通过后，更新本计划中的 `进度`、`意外与发现`、`结果与复盘`，如仍有残余问题则登记到 `docs/exec-plans/tech-debt-tracker.md`。

6. 按 `docs/workflows/COMMIT.md` 提交，再按 `docs/workflows/MR_CREATE.md` 组织 MR 描述并创建 MR。

## 验证与验收

本次变更至少要满足以下可观察结果：

- 画布中四类节点都能从节点头部直接删除。
- 当某个节点被选中且焦点不在输入控件内时，按删除键能移除该节点。
- 删除 `Agent` 或 `Terminal` 节点时，如果其会话正在运行，不会再继续向已删除节点回写状态，也不会在 reload 后重新出现。
- 删除最后一个节点后，重新打开或 reload 画布，画布保持为空；只有“重置宿主状态”才会重新生成默认示例节点。
- 删除中间节点后继续新建同类型节点，不会复用仍存在节点的 ID。
- `npm run build` 与 `npm run typecheck` 通过。

如果当前环境无法直接启动 `Extension Development Host` 做最终交互验证，必须在结果里明确写出这一点，而不能把未执行的手动验证写成已完成。

## 幂等性与恢复

- 删除动作应当对“不存在的节点”安全失败：宿主返回错误或忽略，但不能破坏现有状态。
- 会话销毁逻辑必须先取消定时器和监听器，再终止进程，避免关闭事件晚到时继续回写已删除节点。
- `normalizeState()` 的恢复逻辑必须区分“首次打开没有存储”与“用户显式保存了空节点数组”。
- 构建与类型检查命令应可重复运行；如果需要重试，只需再次执行命令，无需手工清理中间产物。

## 证据与备注

待实现完成后补充最关键的自动化验证输出和必要说明。

## 接口与依赖

本轮不会引入新依赖。需要新增或调整的接口如下：

- 在 `src/common/protocol.ts` 中新增：

      {
        type: 'webview/deleteNode';
        payload: {
          nodeId: string;
        };
      }

- 在 `src/panel/CanvasPanelManager.ts` 中新增统一删除入口，负责：

      1. 根据 nodeId 查找节点；
      2. 如为 Agent / Terminal，则销毁对应执行会话；
      3. 从宿主权威状态中移除节点；
      4. 持久化并回发 host/stateUpdated。

- 在 `src/webview/main.tsx` 中把删除动作下发到所有节点组件，并在 `App` 级别维护：

      onDeleteNode(nodeId: string): void

  该动作除了发送 `webview/deleteNode` 以外，还要同步回收本地选中态和草稿态。

更新说明：2026-03-29 新建本计划，记录删除功能的范围、关键风险和执行步骤。
