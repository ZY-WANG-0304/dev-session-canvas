---
title: Fork 定向展开与生成节点避碰设计
decision_status: 已选定
validation_status: 验证中
domains:
  - 画布交互域
  - 协作对象域
  - 项目状态域
architecture_layers:
  - 宿主集成层
  - 画布呈现层
  - 共享模型与编排层
related_specs:
  - docs/product-specs/agent-launch-modes-and-restart.md
  - docs/product-specs/canvas-core-collaboration-mvp.md
related_plans:
  - docs/exec-plans/active/canvas-fork-placement-and-generated-node-collision.md
updated_at: 2026-07-13
---

# Fork 定向展开与生成节点避碰设计

## 1. 背景

本设计启动时，画布已经支持从持有可信 session id 的 Codex / Claude Code Agent 节点执行 Fork。宿主会创建一个新的 Agent 节点、立即启动 provider 原生 fork 命令，并创建一条带 `fork` 标签的普通可编辑连线。实现前的空间行为仍是局部补丁：`CanvasPanelManager.branchAgentSession()` 把新节点锚定在来源节点右侧，再交给通用的“右下优先”搜索器避碰。

这造成两个直接问题。第一，Fork 方向是写死的，用户无法让整张画布按自己习惯向上、向下或向右展开。第二，同一个来源节点连续 Fork 时，通用二维搜索会同时改变横纵坐标，多个子节点容易看起来处于不同深度，而不是同一层级。

实现前代码中已经存在新增节点避碰、模板组级避碰和自动文件节点避碰，但这些路径没有共同表达一条完整的跨功能规则。尤其 `createNextState()` 在创建到普通 group 时只把同组节点传入碰撞检测；这与“系统生成的新节点不应盖住画面上已有节点”的通用产品约束并不完全一致。

## 2. 已确认需求

以下需求来自 2026-07-13 的用户输入，视为本轮已确认约束：

- 当前节点 Fork 应统一向一个配置方向展开。
- 可选方向为向上、向下、向右，默认向上。
- 同一个来源节点的多个 Fork 子节点应在视觉上处于同一层级。
- 作为不限定于 Fork 的通用规则，系统生成的新节点在初始落位时不应与画面上已有节点重叠。
- 先完成设计并确认边界，再进入实现；用户在确认两项边界后以“继续”授权推进实现。

## 3. 问题定义

本轮设计需要回答五个问题：

1. “向上 / 向下 / 向右”具体约束节点的哪条几何轴，怎样在节点尺寸变化时仍有稳定含义。
2. 同源 Fork 子节点怎样保持同层，同时又能避开同层上的其他节点。
3. 通用的“生成节点不重叠”应覆盖哪些生成路径、哪些空间范围，以及和用户手工拖拽的关系是什么。
4. Fork 连线的锚点怎样跟随方向，避免节点向上展开但连线仍从左右两侧绕行。
5. 是否需要为 Fork 新增持久化父子关系或布局 lineage。

## 4. 目标

- 用户可以在 VSCode Settings 中选择 Fork 的默认展开方向，默认值为向上。
- 当前节点每次 Fork 都读取当前设置；修改设置后，下一次 Fork 立即使用新方向。
- 同一来源、同一方向下连续生成的 Fork 节点共享固定“层级轴”，只沿与展开方向垂直的轴分布。
- 所有系统生成节点的初始落位都复用同一矩形碰撞语义，使用已有节点的持久化尺寸和候选阶段宿主可得的新节点 footprint，并保留统一安全间距。动态尺寸生成器若在落位后才确定真实初始尺寸，必须显式记录为精度边界，不能冒充完整无重叠保证。
- 保持 Extension Host 是最终位置权威；Webview 不自行决定或修正持久化坐标。
- 不新增正式 branch tree、不可编辑父子边或业务 lineage。

## 5. 非目标

- 不自动整理用户已经手工摆放或已经重叠的旧节点。
- 不阻止用户在创建完成后把节点拖到彼此重叠的位置。
- 不因设置变化重新排列既有 Fork 节点或改写既有连线锚点。
- 不把历史会话列表中的 Fork 强行解释成相对某个画布节点的方向；历史记录没有画布来源节点。
- 不引入整棵分支树的自动布局、折叠、合并或主分支语义。
- 不改变 provider 原生 Fork 命令、可信 session id、自动启动和运行时恢复语义。
- 不把 group 外框当作普通节点障碍物；分组容纳、同级 group 避碰仍由现有 group 几何法则负责。

## 6. 设计前现状与代码锚点

方案选择时的相关实现主要集中在以下位置；这些名称保留为设计证据，部分 helper 已在正式实现中迁入共享几何模块：

- `extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts` 的 `branchAgentSession()`：按来源节点右侧计算 `preferredPosition`，创建 Fork 节点并连边。
- 同文件的 `createNextState()`、`resolveNewNodePosition()`、`buildPlacementCandidates()`、`doesPlacementCollide()` 和 `fallbackPlacementPosition()`：普通单节点创建的宿主侧避碰。
- 同文件的 `resolveTemplatePlacementTopLeft()`：模板节点簇相对已有节点的组级避碰。
- 同文件的 `resolveAutomaticArtifactPosition()`：自动文件活动节点的初始摆放。
- 同文件的 `createBranchAgentUserEdge()`：目前始终使用水平连线锚点。
- `extensions/vscode/dev-session-canvas/src/common/protocol.ts` 的 `CanvasNodeSummary`、`CanvasNodePosition`、`CanvasNodeFootprint` 和 `CanvasEdgeAnchor`：跨 Host / Webview 的稳定几何模型。
- `extensions/vscode/dev-session-canvas/src/common/extensionIdentity.ts` 与扩展 `package.json` / `package.nls*.json`：配置键、Settings schema 和本地化文案。

实现前通用搜索器有两个限制：它只支持 `left-up | right-down` 的对角偏好，并允许候选同时改变 X / Y；它也会在创建到指定 group 时通过 `filterPlacementCollisionNodesForGroup()` 把碰撞集合缩小到同组节点。这两点都不适合直接承担本轮新规则。

## 7. 候选方案

### 7.1 方案 A：只改变首选锚点，继续使用现有二维搜索

做法是按配置把首选位置放到来源节点上方、下方或右方，然后继续调用 `resolveNewNodePosition()`。

优点是改动最小，也能在第一个候选没有障碍时得到正确方向。

不建议采用。现有搜索器会同时改变 X 和 Y；同一来源连续 Fork 后，避碰可能把第二、第三个节点推向更远的纵深，无法保证“同层级”。它也会在候选耗尽后回退到整个画布右侧或左上角，可能彻底丢失配置方向。

### 7.2 方案 B：每次 Fork 后自动重排来源节点的整个 Fork 子树

做法是识别来源节点的所有 Fork 后代，按树布局算法重新排列整棵子树。

优点是能够得到非常规整的分支图，并可让设置变化重排既有结构。

不建议采用。当前 `fork` 边是普通可编辑、可删除的 `user` 边，仓库明确没有正式 branch lineage。若要可靠重排就必须新增持久化父子事实源，并且每次 Fork 都可能移动用户已经手工调整过的节点，明显扩大产品语义和实现风险。

### 7.3 方案 C：固定层级线 + 单轴中心向外避碰

这是已选定方案。

Fork 先根据来源节点矩形、目标节点预期尺寸和配置方向计算一条固定层级线：

- 向上：新节点位于来源节点上方，所有新节点使用同一个 top 坐标；初始 X 让新节点中心与来源节点中心对齐。
- 向下：新节点位于来源节点下方，所有新节点使用同一个 top 坐标；初始 X 让新节点中心与来源节点中心对齐。
- 向右：新节点位于来源节点右方，所有新节点使用同一个 left 坐标；初始 Y 让新节点中心与来源节点中心对齐。

候选搜索只沿垂直于展开方向的轴进行。向上 / 向下只改变 X，向右只改变 Y。搜索顺序从中心槽位开始，再向正侧、负侧交替扩展；每个候选都与目标 root-local 画布中的全部已有节点做矩形碰撞检测。若近邻槽位均被障碍占用，回退位置仍留在同一层级线上，只移动到该层现有空间边界之外。

优点是无需识别“哪些节点是同源 Fork 子节点”：同一来源和同一方向天然产生同一条层级线，已有节点本身就是占用信息。普通 `fork` 边仍可编辑删除，不承担布局事实源。用户手工移走某个 Fork 节点后，后续 Fork 可以重新利用空出的槽位，也不会把被移走节点拉回。

代价是它只保证“创建时同层”，不会持续约束用户后续移动或 resize 后的对齐；这是尊重手工布局的有意取舍。

## 8. 正式方案

2026-07-13，用户确认本节方案及两项边界：方向设置只作用于从画布当前节点发起的 Fork；历史会话 Fork 继续使用通用视口避碰；设置只影响之后的新 Fork，不自动重排既有节点和连线。方案现已实现并通过纯几何、宿主状态、扩展清单、本地化、构建、真实 VSCode trusted smoke 与 Webview 定向回归；由于 panel / editor 两种承载面的人工视觉验收尚未完成，`validation_status` 为 `验证中`。

### 8.1 配置契约

新增 window scope 设置 `devSessionCanvas.canvas.forkPlacementDirection`，枚举值为：

- `up`：默认值，Fork 向来源节点上方展开。
- `down`：Fork 向来源节点下方展开。
- `right`：Fork 向来源节点右侧展开。

该设置只影响之后从画布当前节点发起的 Fork。宿主在每次 `branchAgentSession()` 执行时读取当前值，因此修改设置后无需 reload；设置变化不移动既有节点、不修改既有边，也不需要发 Webview 状态消息。

历史会话 sidebar / QuickPick 的 Fork 没有画布来源节点，继续使用通用的“视口附近 + 避碰”创建规则，不套用方向设置。若未来历史项可以显式绑定到一个画布来源节点，再进入单独设计。

### 8.2 Fork 层级几何

“同一层级”定义为新节点的外框起始轴一致，而不是建立持续的父子约束：

- `up` / `down`：同一来源的新 Fork 节点 top 坐标一致，并横向排列。
- `right`：同一来源的新 Fork 节点 left 坐标一致，并纵向排列。

层级线与来源节点之间使用独立的 `FORK_LAYER_GAP`，初始取现有通用 `NODE_PLACEMENT_PADDING` 的两倍，即 80 flow units。原因是 Agent 默认高度为 430、宽度为 560，40 units 虽能避免碰撞，但不足以稳定展示带 `fork` 标签的方向连线；80 units 能留下更明确的父层 / 子层间隙。最终值仍应通过小尺寸 panel 与 editor 两种承载面人工验证，若视觉证据表明不合适，可以只调整间距常量并回写验证记录，不改变正式算法边界。

同层槽位步长先按“新节点在排列轴上的尺寸 + 通用碰撞间距”计算，再向上归一到 20 flow units 网格的安全倍数：向上 / 向下使用 `target.width + NODE_PLACEMENT_PADDING`，向右使用 `target.height + NODE_PLACEMENT_PADDING`。例如 Agent 默认高度 430 加 40 padding 得到 470，实际槽距归一为 480；正负候选因此保持对称且都满足安全间距。候选顺序为中心、正向一格、负向一格、正向两格、负向两格，以保持来源节点附近的视觉重心。

若来源 Agent 属于普通 group，新 Fork 节点继承来源节点的直接 `groupId`。`finalizeCanvasGroupState()` 可以扩张 group 外框容纳新节点，但不能移动来源节点来换取合法化；同源连续 Fork 仍必须保持同层。创建完成后这只是普通可编辑分组关系，用户可以沿用既有拖拽语义把 Fork 节点移出 group。

### 8.3 Fork 连线方向

新建 `fork` 边的锚点和创建时使用的方向一致：

- `up`：来源 `top` -> 目标 `bottom`。
- `down`：来源 `bottom` -> 目标 `top`。
- `right`：来源 `right` -> 目标 `left`。

锚点在边创建时写入普通 `CanvasEdgeSummary`。之后设置变化不重写它；用户仍可通过现有连线编辑能力调整端点、标签或删除整条边。

### 8.4 通用生成节点无重叠契约

“生成节点不与已有节点重叠”是创建时不变量，不是画布永久不变量：

- 每次由系统物化新节点时，在提交宿主权威状态前，用候选阶段宿主可得的目标 footprint 和已有节点的当前持久化尺寸做矩形检测。普通创建、Fork 与模板在该阶段已经持有最终初始 footprint；动态自动文件节点仍存在下述尺寸估算边界。
- 碰撞检测包含统一安全间距；边界刚好相邻但小于安全间距仍视为冲突。
- 碰撞集合是目标 root-local 画布中的全部已有可见节点，不因普通 groupId 不同而过滤。multi-root 的其他 root 属于独立空间，由 root section / pane composition 保证隔离，不参与本 root 的局部坐标检测。
- 普通 group、workspace root group 的外框不是节点，不进入这个集合。新节点创建后的 group 容纳和同级 group 修复继续由 `finalizeCanvasGroupState()` 负责。
- 用户手工拖拽、resize 不触发强制避碰；已有重叠不会被本规则自动修复。
- 模板应用把模板节点簇作为一个保留内部相对几何的批次：整簇不能与应用前已有节点重叠，但本规则不擅自改写模板内部布局。
- 自动文件活动节点、Explorer 资源创建、普通创建、历史恢复 / 历史 Fork 和当前节点 Fork 都进入同一碰撞 predicate；已存在的自动文件节点在刷新时保留原位置，不因本规则周期性跳动。
- 自动文件节点当前先按 `estimatedCanvasNodeFootprint('file')` 的 220 x 84 footprint 选位，之后才按显示模式和路径文本确定真实初始尺寸；默认 minimal `icon-path` 视图宽度最高可到 480。因此这条路径当前只共享避碰算法，尚不具备对真实初始外框的完整无重叠保证。该边界登记在 `docs/exec-plans/tech-debt-tracker.md` 的“新建节点避碰当前依赖默认窗口尺寸估算”，不在本 PR 中顺带扩大实现范围。

### 8.5 共享几何层

实现已把纯几何从 `CanvasPanelManager.ts` 抽到 `extensions/vscode/dev-session-canvas/src/common/canvasNodePlacement.ts`。该模块不依赖 `vscode`、React、DOM 或运行时服务，只依赖共享的 position / footprint 类型，并提供：

- 由位置与尺寸构造带安全间距的节点矩形。
- 判断候选矩形是否与已有节点集合碰撞。
- 为普通视口锚点构造二维邻近候选。
- 为 Fork 构造固定层级线上的单轴候选与同层 fallback。
- 为模板节点簇判断对已有节点的外部碰撞。

宿主仍负责决定使用哪一种策略、取得当前配置、选择 target root/group、写状态和创建连线。共享模块只返回确定性位置，不成为第二状态源。

### 8.6 无需新增 Fork lineage

本方案不向 `AgentNodeMetadata` 增加 `forkParentNodeId`、`forkDirection` 或类似字段。同层布局只依赖来源节点当前矩形、当前设置和当前占用矩形；普通 `fork` 边仍只是一条可编辑视觉关系。

这样可以保持既有非目标：画布不维护正式分支树。它也避免边被用户改名或删除后，布局算法与业务 metadata 之间出现两套互相矛盾的 Fork 关系。

## 9. 风险与取舍

- 风险：固定层级线上可能有很宽或很高的障碍，中心向外搜索需要跳过多个槽位。
  缓解：候选数量按已有节点数扩展，并保留基于该层投影边界的确定性 fallback；fallback 仍必须经过最终碰撞断言。

- 风险：来源节点靠近普通 group 边缘时，向上 Fork 可能扩张 group，继而触发 group 几何修复。
  缓解：保留现有“创建对象位置优先、group 做最小合法化修复”语义；验证最终状态而不只验证创建前候选。若实测 group 扩张造成大范围位移，再单独比较“限制在 group 内搜索”与“允许扩张”方案，当前不预先改变 group 法则。

- 风险：同层定义使用 top / left 对齐；用户 resize 某个既有 Fork 节点后，底边或中心可能不再齐平。
  缓解：创建时 Agent 使用同一默认尺寸，因此初始视觉层级稳定；用户后续 resize 属于显式手工布局，不触发自动回排。

- 风险：配置热生效后，同一来源可能先向上 Fork，再改成向右 Fork，形成两条方向不同的层级线。
  取舍：这是用户显式修改设置后的可解释结果；既有布局不被破坏比强制“整棵树永远只有一个方向”更重要。

- 风险：自动文件节点的动态 minimal footprint 在选位后才确定，长路径可能让真实初始宽度超过避碰阶段使用的 220 x 84 估算。
  取舍：本轮让该路径复用统一 predicate，但不宣称真实初始外框已完整满足无重叠契约；精确 footprint 接线作为已登记技术债后续收口。

- 风险：只抽纯几何、不一次性重构全部 group 布局算法，会暂时保留两套“节点避碰”和“group 合法化”代码。
  取舍：两者对象和不变量不同。节点创建避碰只决定新节点初始位置；group 合法化负责容纳、同级 group 不交叉和批量位移，不应在本轮被错误合并。

## 10. 验证方法

本方案的完整验收需要覆盖以下自动化与人工验证。

纯几何测试应验证：

- `up`、`down`、`right` 的首个 Fork 候选分别位于来源节点对应方向。
- 同一来源连续生成三个 Fork 节点时，`up/down` 三者 top 相同，`right` 三者 left 相同，且两两不重叠。
- 默认 Agent 连续三个 `right` Fork 的 top 顺序精确为中心 `200`、最近正槽 `680`、最近负槽 `-280`，证明网格吸附没有破坏中心向外顺序。
- 来源 Agent 位于普通 group 时，连续 Fork 子节点继承同一 `groupId`，来源位置不变；把任一子节点拖出 group 后仍按既有语义解除分组。
- 层级线中心槽位被普通 Agent、Note、自动 File 节点占据时，新 Fork 仍留在同层并跳到最近空槽位。
- 近邻候选被超大节点阻挡时，同层 fallback 不重叠且结果确定。
- 普通创建到某个 group 时，也不会与目标 root 中其他 groupId 的已有节点重叠。
- 模板簇保持内部相对坐标，同时整体避开应用前的已有节点。

VSCode smoke 应验证：

- 默认配置下当前节点 Fork 出现在上方，边锚点为 `top -> bottom`。
- 分别设置 `down` 和 `right` 后，下一次 Fork 无需 reload 即使用新方向，旧节点位置和旧边锚点不变化。
- Codex 和 Claude Code 都复用相同空间规则，且 provider-native 启动命令、自动启动和可信 session id 断言保持通过。
- multi-root 的 Fork 在来源节点所在 root 内计算，不跨 root，也不与同 root 既有节点重叠。

人工验证应在 `panel` 与 `editor` 两种承载面观察：

- 三种方向的父子层级是否一眼可读，`fork` 标签和连线是否有足够空间。
- 同源三个以上 Fork 是否像同一层，而不是蛇形散开。
- 小尺寸 panel 下 80 units 层间距是否过松或过紧。
- 修改设置后只影响新 Fork 的语义是否容易理解。

## 11. 已确认边界

2026-07-13，用户明确确认以下两项边界：

1. 方向设置只作用于“从画布当前节点 Fork”；历史会话 Fork 因没有画布来源节点，继续按视口附近通用避碰落位。
2. 设置只影响之后的新 Fork；不自动重排既有节点和连线。

方向枚举、默认向上、同层单轴搜索和通用初始避碰也均进入正式方案。后续若要让历史会话 Fork 绑定画布来源，或让设置变化重排既有节点，必须重新进入设计流程，不能在实现中顺带扩大范围。

## 12. 当前验证状态

当前实现已经完成以下自动化验证：

- `npm run test:canvas-node-placement` 覆盖三种方向、同层多子节点、超大障碍 fallback、统一 padding 和连线锚点。
- `npm run test:canvas-node-groups` 覆盖跨 `groupId` 生成避碰、向上同层 Fork 和方向化边锚点；`test:canvas-multi-root-composition` 与 `test:canvas-layout-arrangement` 保持通过。
- `npm run test:extension-manifest`、`npm run test:ui-copy-localization`、`npm run typecheck` 和 `npm run build` 均通过。
- trusted workspace VSCode smoke 完整通过；Codex 场景验证向上落位及 `top -> bottom`，Claude Code 场景在不 reload 的情况下验证向右落位及 `right -> left`，同时保留 provider-native Fork 与自动启动行为。
- `node scripts/test/run-playwright-webview.mjs --grep "Fork|fork|分叉"` 的 3 个定向 Webview 用例通过。

`npm run test:canvas-templates` 仍被仓库当前 `origin/main` 已存在的源码字符串断言阻塞：测试要求 `main.tsx` 包含 `data-node-action-id="create-missing-associated-markdown-file"`，但基线源码本身不包含该字符串；本功能未修改对应 Webview 源码。模板摆放调用已完成共享矩形 / 碰撞 helper 迁移，但该测试命令不能作为本轮通过证据。

PR #261 首轮 review 发现并已用回归锁定两项实现偏差：普通 group 内 Fork 未继承 `groupId`，以及向右 470 units 原始槽距逐候选吸附后破坏正负对称。实现现已分别通过继承来源直接 group 与把槽距预先向上归一到网格倍数修复；相关纯几何和宿主状态测试通过。自动文件节点真实初始尺寸晚于选位确定的问题按上述技术债边界保留，不写成已完成能力。

panel / editor 两种承载面的 80 flow units 层间距与 `fork` 标签视觉检查，以及 multi-root 当前节点 Fork 的专项宿主断言仍待补。因此当前 `validation_status` 为 `验证中`，ExecPlan 继续保留在 active 目录，不把自动化证据扩大表述为完整视觉验证。
