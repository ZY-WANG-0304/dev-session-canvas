# 实现 Fork 定向展开与生成节点统一避碰

本 `ExecPlan` 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘`。

本文位于 `docs/exec-plans/active/canvas-fork-placement-and-generated-node-collision.md`，必须按 `docs/PLANS.md` 的要求持续维护。用户先要求只完成设计，在确认两项边界后以“继续”明确授权实现。共享几何、宿主接线、配置和主要自动化验证现已完成；计划继续保持 active，直到 panel / editor 人工视觉验收和 multi-root 当前节点 Fork 专项验证收口。

## 目标与全局图景

完成实现后，用户从当前 Agent 节点点击 `分叉`，新节点会按 VSCode 设置统一向上、向下或向右展开，默认向上。同一个来源节点连续 Fork 多次时，新节点会在同一条层级线上横向或纵向排列，而不是沿对角线逐步漂移。方向连线也会从对应边缘出发，例如向上时使用来源节点顶部到新节点底部的连线锚点。

与此同时，普通创建、Fork、历史恢复 / 历史 Fork、Explorer 资源创建、模板应用和自动文件活动等系统生成路径共享同一创建时碰撞 predicate。最终 footprint 在候选阶段已知的路径会避开目标 root-local 画布中已有节点；自动文件节点仍先按 220 x 84 默认 footprint 选位，再按 minimal 文本确定最高 480 的真实宽度，因此只获得 best-effort 避碰，精确尺寸接线已登记为技术债。用户仍可在创建后自由拖拽或 resize 节点，本功能不会把画布变成持续自动布局系统。

用户可通过连续 Fork、切换 `devSessionCanvas.canvas.forkPlacementDirection` 和在新节点首选位置预先放置障碍节点，直接观察这项能力。自动化测试还要证明三种方向、同层排列、跨 groupId 避碰、multi-root 作用域和既有 provider-native Fork 行为同时成立。

## 进度

- [x] (2026-07-13 11:52 +0800) 读取 `AGENTS.md`、`docs/WORKFLOW.md`、`docs/PLANS.md`、`docs/DESIGN.md`、`ARCHITECTURE.md`、`docs/UI.md` 与 `docs/FRONTEND.md`，确认本任务需要设计阶段 ExecPlan 和正式设计文档。
- [x] (2026-07-13 11:52 +0800) 从最新 `origin/main` 切出 `docs-canvas-fork-placement-design`，并审计当前 Fork、普通创建、模板、自动文件节点、group 和 multi-root 的摆放代码与测试。
- [x] (2026-07-13 11:52 +0800) 比较“只改锚点”“整棵子树自动布局”“固定层级线 + 单轴避碰”三种方案，形成当前建议并显式记录待确认边界。
- [x] (2026-07-13 11:52 +0800) 新增 `docs/design-docs/canvas-fork-placement-and-generated-node-collision.md`，同步设计索引与跨功能 UI 法则；本轮未修改实现代码。
- [x] (2026-07-13 12:01 +0800) 用户确认两项设计边界：历史会话 Fork 不套用方向；设置只影响之后的新 Fork、不重排既有节点和连线。专项设计状态已收口为 `已选定 / 未验证`。
- [x] (2026-07-13 12:12 +0800) 里程碑 1：抽取 `canvasNodePlacement.ts` 共享纯几何模块，用快速测试锁定通用避碰、三种 Fork 方向、固定层级线和同层 fallback。
- [x] (2026-07-13 12:18 +0800) 里程碑 2：接入 window scope 配置、当前节点 Fork 方向、方向化连线锚点，以及普通创建、模板和自动文件节点共用的碰撞几何；普通创建碰撞集合扩大为目标 root-local state 的全部节点。
- [x] (2026-07-13 12:25 +0800) 里程碑 3 自动化部分：manifest、本地化、纯几何、group、multi-root composition、布局、typecheck、build、完整 trusted VSCode smoke 和 Fork Webview 定向回归通过。
- [x] (2026-07-13 19:24 +0800) PR #261 review 收口：用失败回归复现普通 group 内 Fork 丢失归属和向右槽距网格不对称，分别通过继承来源直接 `groupId` 与预先向上归一槽距修复；同步自动文件动态 footprint 技术债与文档边界。
- [x] (2026-07-13 19:33 +0800) review 修复验证：纯几何、group、multi-root composition、布局、manifest、本地化、typecheck、build、完整 trusted VSCode smoke 与 Fork Webview 3 项定向回归均通过。
- [ ] 里程碑 3 人工与专项部分：在 panel / editor 两种承载面验收 80 units 层间距和边标签，并补 multi-root 当前节点 Fork 的专项宿主断言。
- [ ] 完成后把本计划移入 `docs/exec-plans/completed/`，并检查 `docs/exec-plans/tech-debt-tracker.md` 是否需要登记残余债务。

## 意外与发现

- 观察：当前节点 Fork 并不是“没有避碰”，而是先把首选位置固定在来源节点右侧，再复用普通二维搜索；真正缺口是搜索会同时改变 X / Y，因此无法保证多个子节点同层。
  证据：`CanvasPanelManager.branchAgentSession()` 使用 `source.x + source.width + 48, source.y`，随后 `createNextState()` 调用 `resolveNewNodePosition()`；`buildPlacementCandidates()` 枚举二维 `dx/dy`。

- 观察：当前普通创建已经有 40 flow units 的碰撞安全间距，但创建到指定 group 时只检查同组节点，不满足“画面上所有已有节点”的字面规则。
  证据：`createNextState()` 先调用 `filterPlacementCollisionNodesForGroup(previousState.nodes, targetGroupId)`，该 helper 在存在 `targetGroupId` 时只保留 `node.groupId === targetGroupId` 的节点。

- 观察：不需要为“同源 Fork 子节点”新增持久化 lineage。只要来源矩形和方向相同，固定层级线就相同；所有已有节点参与碰撞后，同源 Fork 会自然占据同层不同槽位。
  证据：新节点的位置搜索只需来源矩形、目标 footprint、当前方向和已有节点矩形；现有普通 `fork` 边被编辑或删除不会影响该计算。

- 观察：当前 `createBranchAgentUserEdge()` 无论节点实际相对位置如何都调用 `resolveHorizontalCanvasEdgeAnchors()`；向上 / 向下摆放若不同时改锚点，会得到明显绕行的水平边。
  证据：该 helper 当前只可能生成 `right -> left` 或 `left -> right`。

- 观察：multi-root 画布在宿主创建前会把 composed 坐标转换成 root-local state，再在创建后重新 namespace / compose；通用避碰应在 root-local state 中处理，而不是拿不同 root 的局部坐标直接比较。
  证据：`applyCreateNode()` 使用 `prepareStateForWorkspaceRootLocalCreate()`、`translateComposedCanvasPositionToRootLocal()` 和 `namespaceWorkspaceRootLocalCreateState()` 包围 `createNextState()`。

- 观察：现有 Agent 默认 footprint 是 560 x 430，当前 Fork 层间距只有 48；方向层级需要给连线和 `fork` 标签更明确的视觉空间。
  证据：`estimatedCanvasNodeFootprint('agent')` 返回 560 x 430，`branchAgentSession()` 当前仅在右侧增加 48 units。

- 观察：`test:canvas-node-groups` 在当前 main 上直接加载 `CanvasPanelManager.ts` 时缺少 `vscode.l10n.t` mock；这不是产品代码缺陷，但会遮蔽新增宿主状态测试。
  证据：为测试桩补入与现有参数替换语义一致的轻量 `l10n.t` 后，原有用例和本轮新增用例一起通过。

- 观察：`npm run test:canvas-templates` 的失败来自当前 `origin/main` 已存在的源码字符串断言，不是本轮共享碰撞迁移。
  证据：`scripts/test/test-canvas-templates.mjs:1188` 要求 `main.tsx` 包含 `data-node-action-id="create-missing-associated-markdown-file"`；`git show origin/main:extensions/vscode/dev-session-canvas/src/webview/main.tsx` 同样不包含该字符串，本轮也未修改 `main.tsx`。

- 观察：Fork 创建若不继承来源普通 group，`finalizeCanvasGroupState()` 会把未分组的新节点当作 group 外障碍并移动整个来源 group，直接扰动来源坐标和后续层级线。
  证据：review fixture 使用 1000 x 1000 group 与 `(220, 400)` 来源 Agent 稳定复现来源移动和三子节点不同层；新增回归在未修复代码上首先失败于子节点 `groupId`，修复后同时证明来源位置不变、三个子节点同层且可手工拖出 group。

- 观察：原始槽距不能在每个正负候选生成后再独立吸附网格，否则非网格倍数会产生不对称的实际间距。
  证据：默认 Agent 向右的原始槽距为 `430 + 40 = 470`；旧实现得到 top `200, 680, -740`。把槽距先向上归一为 480 后，回归得到 `200, 680, -280`。

- 观察：自动文件节点虽然复用共享 predicate，但选位阶段仍传 `estimatedCanvasNodeFootprint('file')` 的 220 x 84；真实 minimal footprint 在随后物化时才根据路径文本计算，`icon-path` 宽度最高 480。
  证据：`resolveAutomaticArtifactPosition()` 仍调用按 kind 估算的 `resolveNewNodePosition()`，而 `resolveAutomaticFileNodeSize()` 在选位之后才调用 `estimateAutomaticFileNodeFootprint()`。这条路径不能写成已经使用最终初始尺寸。

## 决策记录

- 决策：本轮先只交付设计文档与实现计划，不修改 TypeScript、扩展 manifest 或测试代码。
  理由：用户明确要求“现在先进行设计，不要直接开始实现代码”。
  日期/作者：2026-07-13 / Codex

- 决策：当前建议采用“固定层级线 + 单轴中心向外避碰”，不直接复用现有二维 `right-down` 搜索，也不自动重排整棵 Fork 子树。
  理由：单轴搜索是同时满足方向、同层、避碰和尊重手工布局的最小模型；二维搜索不能保证同层，子树重排则需要新的 lineage 事实源并会移动用户布局。
  日期/作者：2026-07-13 / Codex

- 决策：不向 Agent metadata 增加 Fork 父节点或方向字段。
  理由：同层位置可以只从当前动作的来源节点、设置和占用矩形计算；新增 metadata 会把空间优化升级成仓库此前明确不做的正式 branch lineage。
  日期/作者：2026-07-13 / Codex

- 决策：把“生成节点不重叠”定义成创建时不变量，而不是持续布局约束。
  理由：用户要求的是生成结果不要盖住已有节点；持续阻止手工重叠会改变 React Flow 的自由画布心智，并与现有 group 设计中允许普通直接成员重叠的规则冲突。
  日期/作者：2026-07-13 / Codex

- 决策：通用碰撞范围按目标 root-local 画布的全部已有节点计算，不再按普通 groupId 过滤；group 框本身仍由 group 几何法则管理。
  理由：这是“画面上已有节点”的直接实现，同时尊重 multi-root 的独立坐标空间和现有 group containment / sibling repair 边界。
  日期/作者：2026-07-13 / Codex

- 决策：方向设置采用 window scope，并在每次当前节点 Fork 时即时读取，只影响未来动作。
  理由：方向是同一窗口画布的空间偏好，不是设备相关 CLI 路径或节点业务事实；即时读取可以在不重排既有布局的前提下给用户可预测的下一次动作。
  日期/作者：2026-07-13 / Codex

- 决策：历史会话 Fork 不应用方向设置；设置变化无需 reload，只影响之后的新 Fork，既有节点和连线保持不动。
  理由：历史会话没有画布来源节点，无法定义相对方向；保留既有布局可以尊重用户已经完成的空间组织，避免配置变化产生大范围非预期位移。用户于 2026-07-13 明确确认这两项边界。
  日期/作者：2026-07-13 / Codex + 用户确认

- 决策：把普通邻近摆放、Fork 层级摆放和矩形碰撞放入一个无 `vscode` / DOM 依赖的共享模块；模板保持批次内部几何，只复用矩形与候选 helper。
  理由：这样生成路径共享 padding 与碰撞定义，同时不把模板内部布局错误降级成逐节点自动排列。
  日期/作者：2026-07-13 / Codex

- 决策：当前阶段把设计状态更新为 `验证中`，不归档本计划。
  理由：自动化证据已经覆盖核心行为，但 panel / editor 人工视觉验收和 multi-root 当前节点 Fork 专项宿主断言尚未完成，不能写成完整验证。
  日期/作者：2026-07-13 / Codex

- 决策：Fork 节点继承来源节点的直接普通 group；group 外框为容纳新节点扩张时保持来源坐标不动，之后仍允许用户手工拖出。
  理由：普通 group 是当前节点的直接空间上下文；若新节点留在根级，group repair 会移动来源并破坏同层不变量。继承归属既避免扰动，也不引入新的强父子关系。
  日期/作者：2026-07-13 / Codex + PR #261 review

- 决策：槽距先向上归一到 20 units 网格安全倍数，再生成正负候选。
  理由：保证候选吸附后仍对称且至少保留 40 units padding；默认向右 Agent 的 470 原始槽距因此使用 480。
  日期/作者：2026-07-13 / Codex + PR #261 review

- 决策：自动文件节点的动态 footprint 精度不在当前 review 中顺带修复，扩充既有尺寸估算技术债并修正文档完成态。
  理由：review 已把代码问题定为非阻塞；本 PR 保留统一 predicate 的真实成果，但明确 220 x 84 估算与最高 480 minimal 宽度之间的边界。
  日期/作者：2026-07-13 / Codex + PR #261 review

## 结果与复盘

实现已经把同层 Fork 落位收口到共享纯几何模块，不新增父子 metadata：固定层级线提供深度约束，单轴中心向外搜索提供同层分布，目标 root-local state 的已有节点集合提供占用信息。设置在每次当前节点 Fork 时读取，支持 `up | down | right`、默认 `up`；新边分别写入 `top -> bottom`、`bottom -> top`、`right -> left`，历史会话 Fork 保持通用邻近避碰。

普通创建不再按 `groupId` 缩小碰撞集合；模板与自动文件节点复用同一矩形 / padding 语义。PR #261 review 后，普通 group 内 Fork 会继承来源直接 `groupId`，扩张 group 时来源位置保持不变；向右槽距先归一到网格安全倍数，默认三子节点顺序为中心、最近正槽、最近负槽。纯几何、宿主状态、配置、本地化、类型、构建、完整 trusted VSCode smoke 和 Webview Fork 定向回归已经通过。已知 `test:canvas-templates` 失败可在 `origin/main` 复现，来自与本功能无关的 Webview 源码字符串断言。

自动文件节点目前只复用统一 predicate，尚未把随后算出的动态 minimal footprint 回传到选位阶段；长路径下真实宽度可能从估算的 220 增长到 480。该问题已扩充到 `docs/exec-plans/tech-debt-tracker.md`，本计划不再把这条路径写成完整满足真实初始外框无重叠。

剩余工作是人工检查 panel / editor 中 80 units 层间距和 `fork` 标签，以及为 multi-root 当前节点 Fork 增加专项宿主断言。因这两项尚未完成，正式设计状态为 `验证中`，计划不归档。

## 上下文与定向

DevSessionCanvas 是 VSCode workspace extension。Extension Host 中的 `CanvasPanelManager` 持有 workspace 绑定画布状态，Webview 负责 React Flow 渲染和交互；因此最终坐标必须在宿主侧计算并持久化。

当前节点 Fork 的业务主路径位于 `extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts`：

1. `branchAgentSession(nodeId)` 校验 workspace trust、来源 Agent、provider capability 和可信 session id。
2. 它构造 provider-native Fork 命令，当前用来源节点右侧作为 `preferredPosition`。
3. `applyCreateNode()` 进入 `createNextState()`，后者调用 `resolveNewNodePosition()` 避碰并追加节点。
4. `createBranchAgentUserEdge()` 创建一条 `owner: user`、`label: fork` 的普通边。
5. 宿主持久化状态、广播 Webview，并自动聚焦和启动新 Agent。

“root-local 画布”指 multi-root workspace 中某一个 workspace root 自己的节点坐标集合。`rootGroups` 会把多个 root-local 画布组合到一个大画布里，`paneGallery` 会把它们显示成不同 pane；不同 root 的局部坐标不能直接互相做节点碰撞检测。`applyCreateNode()` 已经在调用纯创建逻辑前把状态转换成目标 root-local state，因此新的几何 helper 应沿用这个边界。

“固定层级线”指 Fork 新节点在展开轴上使用固定坐标。例如 `up` 下所有新节点 top 坐标相同，只改变 X；`right` 下所有新节点 left 坐标相同，只改变 Y。“单轴中心向外搜索”指先尝试让新节点中心对齐来源中心，然后依次尝试正向一格、负向一格、正向两格、负向两格。每个候选都必须经过统一矩形碰撞检测。

关键文件：

- `docs/design-docs/canvas-fork-placement-and-generated-node-collision.md`：本轮候选方案、边界和验收事实来源。
- `docs/UI.md`：跨功能“生成节点初始不重叠”规则。
- `docs/product-specs/agent-launch-modes-and-restart.md`：Fork 的 provider、入口、自动启动、方向化空间行为和普通连线产品语义。
- `extensions/vscode/dev-session-canvas/src/common/protocol.ts`：position、footprint、edge anchor 和节点模型。
- `extensions/vscode/dev-session-canvas/src/common/extensionIdentity.ts`：配置键。
- `extensions/vscode/dev-session-canvas/src/common/canvasNodePlacement.ts`：计划新增的纯几何模块。
- `extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts`：配置读取、root/group 作用域、状态提交、Fork 和各生成路径接线。
- `extensions/vscode/dev-session-canvas/package.json`、`package.nls.json`、`package.nls.zh-cn.json`：Settings schema 与中英文文案。
- `scripts/test/test-canvas-node-placement.mts`：计划新增的快速纯几何测试。
- `tests/vscode-smoke/extension-tests.cjs`：真实宿主级 Fork、配置和 multi-root 回归。

## 工作计划

### 里程碑 1：建立共享纯几何契约

新增 `extensions/vscode/dev-session-canvas/src/common/canvasNodePlacement.ts`，把节点矩形、碰撞安全间距、普通二维邻近候选、Fork 固定层级线候选和 fallback 写成无 `vscode` / DOM / React 依赖的纯函数。迁移时先保持普通创建和模板的当前可观察结果，再新增 Fork 单轴策略，避免在同一个改动里同时改变所有候选排序。

新模块接受显式 `CanvasNodeFootprint`，不在纯几何内部按 node kind 重新估算。普通新建传默认且实际物化使用的 footprint，已有节点使用持久化 size，模板使用模板节点 size。`CanvasPanelManager.resolveNewNodePosition()` 仍是按 kind 估算的适配层；自动文件生成器尚未把已经可计算的动态 minimal footprint 传过该边界，按技术债后续修复。

新增 `scripts/test/test-canvas-node-placement.mts` 并注册 `npm run test:canvas-node-placement`。测试直接构造矩形，不启动 VSCode，覆盖三种方向、同层坐标、中心向外顺序、障碍跳过、超大障碍 fallback、统一 padding 和确定性。里程碑完成时，纯测试通过，`CanvasPanelManager` 仍可暂未接入新 Fork 行为。

### 里程碑 2：接入配置和所有生成路径

在 `extensionIdentity.ts` 增加 `canvasForkPlacementDirection`，在扩展 manifest 声明 `devSessionCanvas.canvas.forkPlacementDirection` 的 `up | down | right`、默认 `up`、scope `window`，并同步英文与简体中文 Settings 文案。配置只在动作时读取，不加入 reload-required 提示，也不触发 Webview runtime context 更新。

在 `CanvasPanelManager.branchAgentSession()` 中读取并规范化方向，根据来源节点真实 size 与新 Agent 默认 footprint 调用 Fork 层级规划器。把最终方向传给 `createBranchAgentUserEdge()`，分别写入 `top -> bottom`、`bottom -> top`、`right -> left`。不要改变命令构造、可信 session id、pending launch、自动启动或 focus 流程。

普通单节点创建继续使用视口锚点二维邻近策略，但 `createNextState()` 的 occupied nodes 改成目标 root-local state 的全部已有节点，移除或停用 `filterPlacementCollisionNodesForGroup()`。Explorer Markdown Note、历史恢复 / Fork 本来就通过 `applyCreateNode()`，应自然继承统一规则。自动文件活动节点接入同一个碰撞 predicate；已有自动节点仍保留原位置，但新自动文件节点的动态真实 footprint 仍是已登记精度边界。模板继续保持内部相对坐标，只把外部碰撞判定迁到共享模块。

每条路径完成后都要检查 `finalizeCanvasGroupState()` 之后的最终状态；如果 group 扩张 / 修复会让新节点重新与已有节点重叠，不能只在前置候选阶段宣称不变量成立。优先修正候选作用域或最终化顺序，不要为 Fork 引入 Webview 侧二次挪动。

### 里程碑 3：验证、文档收口和归档

扩充现有 Codex / Claude 当前节点 Fork smoke：默认方向断言节点在上方、三次 Fork 同层且互不重叠、边锚点方向正确。用 VSCode configuration API 切到 `down` / `right`，证明下一次动作即时生效且旧节点不动。添加普通跨 groupId 障碍和 multi-root 来源场景，证明 occupied set 范围正确。

运行快速测试、manifest / 本地化测试、typecheck、build、相关 smoke 和 Webview 回归。人工在 editor / panel 两种 surface 查看层间距与边标签；如果 80 units 不合适，只调整 `FORK_LAYER_GAP` 并在设计文档记录证据，不改变算法边界。

验证通过后，保持设计文档 `decision_status: 已选定`，并把 `validation_status` 按真实证据改为 `验证中` 或 `已验证`。同步正式方案中的实际常量与验证证据、`docs/product-specs/agent-launch-modes-and-restart.md`、`docs/design-docs/index.md` 和本计划四个活文档章节。最后把计划移入 completed，并登记仍需后续跟踪的债务。

## 具体步骤

所有命令都从仓库根目录执行：

    cd /home/users/ziyang01.wang-al/projects/dev-session-canvas.worktrees/dev-session-canvas8

1. 开始实现时，先更新本计划的 `进度`，记录实现启动时间与工作树基线；正式设计已经是 `已选定 / 未验证`，不要再次退回候选状态。

2. 新增共享几何模块和测试脚本，注册 package script：

    npm run test:canvas-node-placement

   预期所有几何用例通过，输出中没有碰撞或方向断言失败。

3. 接入配置 schema、配置读取、Fork 位置和边锚点，然后运行：

    npm run test:extension-manifest
    npm run test:ui-copy-localization
    npm run typecheck
    npm run build

4. 接入普通创建、模板和自动节点的共享碰撞语义，然后运行：

    npm run test:canvas-node-placement
    npm run test:canvas-templates
    npm run test:canvas-node-groups
    npm run test:canvas-multi-root-composition

5. 扩充宿主 smoke 后，先使用场景过滤执行相关 trusted 用例；若当前 runner 不支持按测试名过滤，则运行完整 trusted scenario：

    DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=trusted node scripts/smoke/run-vscode-smoke.mjs

6. 检查 Webview 边渲染和现有 Fork 动作没有回归：

    node scripts/test/run-playwright-webview.mjs --grep "Fork|fork|分叉"

7. 完成人工 editor / panel 验收，把观察记录写入设计文档和本计划，再运行 `git diff --check` 与 `git status --short` 检查交付范围。

## 验证与验收

功能验收以用户可观察行为为准：

- 未配置时，从当前 Agent Fork 的新节点位于来源上方，边从来源顶部连到目标底部。
- 同一来源连续 Fork 三次，三个新节点 top 相同、互不重叠；它们可以分布在来源中心两侧，但不会改变纵深。
- 设置为 `down` 后，下一次 Fork 位于下方且边为 `bottom -> top`；设置为 `right` 后位于右侧且边为 `right -> left`。
- 修改设置无需 reload，且既有节点坐标与边锚点保持不变。
- 当中心槽位有 Agent、Terminal、Note、File 或 File List 时，新 Fork 留在同层并选择最近空槽位。
- 普通创建、历史恢复 / Fork、Explorer Note 和模板簇不覆盖目标 root 中创建前已存在的节点；新生成自动文件节点使用同一 predicate 做 best-effort 避碰，但动态 minimal footprint 可能大于选位估算，不作为完整保证。
- 来源位于普通 group 时，Fork 子节点继承来源直接 `groupId`，group 扩张不移动来源；用户把子节点拖出 group 后仍解除分组。
- 默认 Agent 向右连续 Fork 三次时，网格化 top 顺序保持中心、最近正槽、最近负槽，不因 470 原始槽距的逐候选取整跳过负一槽。
- 创建到普通 group 时，即使障碍节点的 groupId 不同，也不会发生节点矩形重叠；group 最终状态仍合法。
- multi-root 下只在来源所在 root-local 画布避碰，不跨 root 错误比较，也不把节点放到其他 root。
- 用户创建后手工拖动节点到重叠位置仍然允许，后续不会被后台自动拉开。
- Codex / Claude Code 的 Fork 命令、可信 session id、原节点不变、新节点自动启动、`fork` 标签和普通可编辑 user edge 均保持原行为。

测试成功的最低证据包括：新增纯几何测试通过、`typecheck` 与 `build` 通过、相关 manifest / localization / template / group / multi-root 测试通过、trusted smoke 的两个 provider Fork 场景通过、editor / panel 人工观察记录已写入。若完整 suite 存在与本任务无关的失败，必须记录准确测试名、错误和本任务用例是否已经运行，不能笼统写成“测试通过”。

## 幂等性与恢复

设计和实现步骤都应可重复执行。纯函数迁移先通过测试锁定行为，再逐条替换调用点；任何阶段失败都可以修正对应调用点后重跑相同命令，不需要清理持久化数据库或外部服务。

配置项是新增枚举并带默认值，不需要迁移旧设置。旧 workspace 没有该 key 时自然使用 `up`。设置变化不重排旧状态，因此不存在坐标数据迁移或破坏性回滚。

若共享几何迁移导致普通创建回归，可以暂时保留旧普通候选构造器作为薄适配层，但碰撞 predicate 必须只有一份；计划中要记录并安排移除适配层，不能长期保留两套 padding 语义。若 group 最终化引入意外重叠，应保留失败 fixture，修复最终化次序后重跑，不得通过禁用跨 group 碰撞绕过需求。

不要使用 `git reset --hard`、`git checkout --` 或删除用户改动来恢复。实现开始前和每个里程碑结束时检查 `git status --short`；发现不属于当前任务的新增变化时立即停止并与用户确认。

## 证据与备注

设计阶段识别出的旧实现关键源码证据：

    const preferredPosition = {
      x: sourceNode.position.x + sourceSize.width + 48,
      y: sourceNode.position.y
    };

这证明实现前 Fork 方向固定为右侧。普通创建实现前的过滤证据：

    filterPlacementCollisionNodesForGroup(previousState.nodes, targetGroupId)

存在 `targetGroupId` 时只保留同组节点，因此实现已把 occupied set 扩大到目标 root-local state 的全部节点。当前共享常量为：Agent 默认尺寸 560 x 430、通用 padding 40、Fork 层间距 80、网格 20。自动化证据包括：

    npm run test:canvas-node-placement
    npm run test:canvas-node-groups
    npm run test:canvas-multi-root-composition
    npm run test:canvas-layout-arrangement
    npm run test:extension-manifest
    npm run test:ui-copy-localization
    npm run typecheck
    npm run build
    DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=trusted node scripts/smoke/run-vscode-smoke.mjs
    node scripts/test/run-playwright-webview.mjs --grep "Fork|fork|分叉"

上述命令均通过。`npm run test:canvas-templates` 在 `scripts/test/test-canvas-templates.mjs:1188` 失败，因为它要求当前 main 与 `origin/main` 均不存在的 `data-node-action-id="create-missing-associated-markdown-file"` 源码字符串；该失败作为基线缺口记录，不冒充本轮通过项。

PR #261 review 回归先在旧实现稳定失败：向右位置为 `200, 680, -740`，普通 group Fork 子节点未继承 `groupId`。修复后向右顺序为 `200, 680, -280`，group fixture 同时证明子节点继承、来源坐标不变、同层互不重叠和手工移出仍成立；上述完整自动化矩阵再次通过。

本次修订说明（2026-07-13 11:52 +0800）：首次创建计划，原因是用户要求先设计 Fork 定向展开、同层子节点和跨功能生成节点避碰；计划明确停在设计阶段，没有授权实现。

本次修订说明（2026-07-13 12:01 +0800）：用户确认历史会话 Fork 与设置生效两项边界，因此把设计状态收口为 `已选定 / 未验证`，同步产品规格、进度、决策记录和复盘；仍未开始实现。

本次修订说明（2026-07-13 12:27 +0800）：用户以“继续”授权后完成共享几何、配置、宿主接线与主要自动化回归；记录模板测试的 main 基线失败，并把设计状态更新为 `已选定 / 验证中`。计划保留 active，等待人工承载面验收和 multi-root 当前节点 Fork 专项断言。

本次修订说明（2026-07-13 19:26 +0800）：处理 PR #261 首轮 review；增加普通 group 继承/来源稳定/手工移出与向右确切槽序回归，修复两个 blocker，并把自动文件动态 footprint 从“完整满足”修正为 best-effort 及既有技术债边界。

## 接口与依赖

不新增第三方依赖。几何模块使用现有 `CanvasNodePosition`、`CanvasNodeFootprint`、`CanvasNodeSummary` 与 `CanvasEdgeAnchor` 类型。

在 `extensions/vscode/dev-session-canvas/src/common/canvasNodePlacement.ts` 中建议定义以下稳定接口；实现者可微调命名，但不得改变职责边界：

    export type CanvasForkPlacementDirection = 'up' | 'down' | 'right';

    export interface CanvasPlacementRect {
      left: number;
      top: number;
      right: number;
      bottom: number;
    }

    export function canvasPlacementRectsOverlap(
      left: CanvasPlacementRect,
      right: CanvasPlacementRect,
      padding: number
    ): boolean;

    export function resolveNearbyNonOverlappingNodePosition(options: {
      occupiedNodes: readonly Pick<CanvasNodeSummary, 'position' | 'size'>[];
      targetSize: CanvasNodeFootprint;
      anchor: CanvasNodePosition;
      padding: number;
    }): CanvasNodePosition;

    export function resolveForkLayerNodePosition(options: {
      occupiedNodes: readonly Pick<CanvasNodeSummary, 'position' | 'size'>[];
      sourceNode: Pick<CanvasNodeSummary, 'position' | 'size'>;
      targetSize: CanvasNodeFootprint;
      direction: CanvasForkPlacementDirection;
      layerGap: number;
      padding: number;
    }): CanvasNodePosition;

    export function resolveForkEdgeAnchors(
      direction: CanvasForkPlacementDirection
    ): Pick<CanvasEdgeSummary, 'sourceAnchor' | 'targetAnchor'>;

`CanvasPanelManager` 负责把未知配置值规范化为 `up`，然后把显式方向传给几何和边 helper。`resolveForkLayerNodePosition()` 必须保证返回位置不碰撞；搜索近邻失败时的 fallback 仍在固定层级线上，并在返回前做最终断言。模板 helper 可以复用 rectangle / overlap API，但不应把模板内部节点重新逐个排位。
