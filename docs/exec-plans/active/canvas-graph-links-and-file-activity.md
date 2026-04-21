# 画布关系连线与文件活动视图实现

本 `ExecPlan` 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘` 这几个章节。

本文位于 `docs/exec-plans/active/canvas-graph-links-and-file-activity.md`，必须按 `docs/PLANS.md` 的要求持续维护。

## 目标与全局图景

这次变更完成后，用户会在画布里直接得到两类新增能力。第一类是“关系连线”：任意节点都能从四向锚点拖出一条持久化连线，并继续编辑箭头模式、标签和删除。第二类是“文件活动视图”：当支持结构化文件事件的 Agent 读写文件时，画布会自动出现文件节点或文件列表节点，用户可点击这些文件对象直接回到 VSCode 编辑区。

用户应能亲眼看到三件事同时成立：连线会在 reload 后保留；支持的 Agent provider 会实时生成文件对象；删除 Agent 后，失去引用的文件对象会一起退出画布。

## 进度

- [x] (2026-04-20 14:18 +0800) 重新读取最新“文件节点 / 文件列表节点 UI 简化”需求、`docs/WORKFLOW.md`、`docs/PLANS.md` 与现有实现，确认本轮属于现有文件活动视图的正式迭代，不新建计划，直接在当前 `ExecPlan` 上继续维护“卡片 / 极简”双风格、文件列表 `list/tree` 切换与配置收口。
- [x] (2026-04-20 14:18 +0800) 更新产品规格与设计文档，把 `devSessionCanvas.fileNode.displayStyle`、`card/minimal` 风格语义、文件列表极简 `列表视图 / 树形视图`、以及文件节点极简自适应尺寸规则写成正式口径。
- [x] (2026-04-20 14:18 +0800) 扩展共享协议、扩展设置与宿主配置监听，把文件节点显示风格接入 `CanvasRuntimeContext`，并确保切换风格时只重建文件节点 / 文件列表节点视觉投影，不改变位置与连线关系。
- [x] (2026-04-20 14:18 +0800) 实现 Webview 的极简文件节点与文件列表节点：文件节点收口为贴内容边框；文件列表节点改成接近 VSCode Changes 的单行文件视图，并支持头部 `list/tree` 切换。
- [x] (2026-04-20 14:18 +0800) 补充 Playwright 与 VS Code smoke，覆盖风格切换、极简文件列表 `list/tree` 切换、读写标识显示，以及风格切换后节点位置 / 连线稳定性。
- [x] (2026-04-21 10:20 +0800) 为文件节点 / 文件列表节点补充全局配置 `devSessionCanvas.files.enabled`，关闭时停止投影 `file` / `file-list` 自动对象与自动边，但继续保留 `fileReferences`；同步更新规格、设计文档与 smoke 断言。
- [x] (2026-04-20 15:01 +0800) 排查风格切换后共享文件节点位置漂移，确认根因不是 `src` 逻辑而是 `dist/extension.js` 仍保留旧版“碰撞时重算位置”分支；重新构建扩展产物后，trusted smoke 恢复通过。
- [x] (2026-04-19 10:52 +0800) 读取 `docs/WORKFLOW.md`、`docs/PLANS.md`、`ARCHITECTURE.md`、`docs/product-specs/index.md`、当前需求说明和核心实现，确认这次改动需要独立 `ExecPlan`、产品规格和设计文档；其中需求重点包括通用连线能力、文件节点 / 文件列表节点能力，以及文件活动必须来自 provider 结构化事件而非 PTY 文本推断。
- [x] (2026-04-19 10:56 +0800) 从远端 `origin/main` 切出主题分支 `canvas-links-and-file-nodes`，保留用户工作树中已有未跟踪文件。
- [x] (2026-04-19 11:28 +0800) 明确正式范围：通用连线完整落地；文件活动走 provider 结构化事件；`Claude` / `fake-agent-provider` 提供第一轮自动文件活动，`Codex` 先保留 no-op 适配并写入文档。
- [x] (2026-04-19 11:52 +0800) 新增产品规格、设计文档、执行计划，并同步 `docs/design-docs/index.md`、`docs/product-specs/index.md` 和 `docs/design-docs/core-beliefs.md`。
- [x] (2026-04-19 14:10 +0800) 完成共享协议与宿主持久化：新增 `edges` / `fileReferences` 权威状态、文件视图配置、文件打开消息与自动文件对象重建路径。
- [x] (2026-04-19 14:24 +0800) 完成 provider 文件活动接线：新增 `agentFileActivity` 宿主模块、Claude hook 脚本、fake provider NDJSON 事件流与 Codex no-op 退化路径。
- [x] (2026-04-19 14:48 +0800) 完成 Webview 交互：四向 handles、自定义 edge UI、文件节点 / 文件列表节点渲染、文件打开入口与测试 probe/action 扩展。
- [x] (2026-04-19 15:11 +0800) 完成自动化验证与文档回填：补齐 Playwright / VS Code smoke 覆盖，修正一个既有 smoke 断言对瞬时恢复状态的过度约束，并更新截图基线。
- [x] (2026-04-19 15:23 +0800) 按主题拆分正式设计文档：将原合并设计文档拆成“关系连线”和“文件活动视图”两份文档，并同步索引与关联引用。
- [x] (2026-04-19 16:31 +0800) 根据新增 UI 收口要求，先把关系连线规格与设计文档从“右键菜单”修订为“选中态轻量编辑台 + 双击原位标签编辑”，为后续实现和回归测试提供正式口径。
- [x] (2026-04-19 16:41 +0800) 完成关系连线交互收口：删除旧 edge 右键菜单，改为选中态轻量编辑台、箭头模式子菜单、双击原位标签编辑，并统一使用 Workbench token 与 `codicon`。
- [x] (2026-04-19 16:48 +0800) 根据实际 UI 观察提高连线标签可见性：增强标签背景、边框、字重和选中态对比，并重新通过 `typecheck`、Playwright Webview 与 trusted smoke。
- [x] (2026-04-19 18:40 +0800) 按最新交互要求完成第二轮关系连线收口：默认连线与拖拽预览统一默认 token；选中态改为同色主线 + outline 反馈；引入 Obsidian 风格的 6 色预设、选中态端点重接，以及自动边的宿主持久化覆盖 / 屏蔽路径，并重新通过 `typecheck`、Playwright Webview 与 trusted smoke。
- [x] (2026-04-19 19:05 +0800) 修正第三轮连线交互细节：把端点重接把手改为透明热区，修复“默认颜色”无法恢复的问题，并放开自环连线的创建、渲染与持久化，同时补齐文档与 Playwright 回归。
- [x] (2026-04-19 19:22 +0800) 按 Obsidian 收口标签交互语义：明确“属性编辑走上浮工具条、标签平时贴线轻显示、编辑时在标签原位切输入态”，同步微调标签视觉并补一条位置关系回归断言。
- [x] (2026-04-19 19:36 +0800) 根据手工验收反馈进一步收口为两套独立控件：工具条改成按路径上方区域独立定位，标签显示改为贴线纯文本，标签编辑改为独立轻输入框，并同步规格与设计文档。
- [x] (2026-04-19 19:48 +0800) 继续收口标签观感：编辑态输入框宽度改成按当前文本内容自适应，显示态为文本下方加轻量遮罩，避免出现“线从字上穿过”的观感，并补充相应的 Playwright 断言。
- [x] (2026-04-20 00:40 +0800) 修复文件活动退出竞态：把 agent 文件活动 watcher 的关闭语义从“立即停表并删临时目录”改成“先 drain/settle，再清理”，并补一条 fake provider `readexit` 回归，覆盖“读事件刚落盘就退出”的路径。
- [x] (2026-04-20 03:40 +0800) 按 review 收口文件活动视图：编辑区点击文件改为落到独立 editor group；`include` / `exclude` 从 settings 迁到 sidebar 持久化视图状态，并确保过滤只影响投影、不回写 `fileReferences`；同步修正文档并登记 file icon theme 技术债。
- [x] (2026-04-20 08:36 +0800) 按最新 UX 要求把 sidebar 过滤控件从 TreeView 文本项切到内嵌 Webview 输入框，交互改成贴近 VSCode Search 视图的 include/exclude 编辑体验，并同步规格与设计文档。
- [x] (2026-04-20 09:05 +0800) 重新调研 VSCode 官方 `Sidebars`、`Views`、`Tree View` 与 `Webviews` 文档，并结合用户提供的 Source Control / Run and Debug / Extensions 参考图，确认 sidebar 需要放弃 `WebviewView` 模拟，改回原生 section 化实现。
- [x] (2026-04-20 09:05 +0800) 完成 sidebar 重构与文档回写：把单一 sidebar `WebviewView` 改为 `概览` / `文件过滤` 两个原生 `TreeView` section；过滤入口改为 `包含文件` / `排除文件` 条目 + item action + 宿主输入框。
- [x] (2026-04-20 09:05 +0800) 重新执行 `npm run typecheck` 与 `npm run build`，确认本轮 sidebar redesign 通过基础自动化校验。
- [x] (2026-04-20 10:34 +0800) 根据最新交互要求再次收口 sidebar：概览保留原生 `TreeView`，移除“可创建对象”并补充 `Runtime Persistence` 状态；第二块改为最小 `WebviewView` 的 `常用操作` 区，直接承载打开画布、创建节点、重置画布状态和 `include` / `exclude` 内嵌输入框。
- [x] (2026-04-20 10:54 +0800) 在 `常用操作` 区尾部补一排 VSCode 风格的快捷 icon 按钮，分别复用打开/定位画布、创建节点和重置画布状态，不引入新命令语义；同步回写 sidebar 设计与规格文档。
- [x] (2026-04-20 11:00 +0800) 根据最新位置反馈，把快捷 icon 从 `WebviewView` 内容区移到 `常用操作` view title 行尾部，改用原生 `view/title` action 承载，并同步修正文档口径。
- [x] (2026-04-20 11:07 +0800) 根据最新反馈把 `概览` 中的“画布状态”从承载面信息改回纯状态语义：仅显示“已打开 / 未打开”，不再把 `Panel / Editor` 直接作为状态值暴露；同步修正规格文档中的旧表述。
- [x] (2026-04-20 12:20 +0800) 按最新 review blocker 收窄画布焦点恢复：`openCanvasInEditor` / `revealSurface('editor')` 继续显式把 document focus 交还给 editor-surface webview；文件打开链路改为按消息来源 surface 处理，避免 panel 内点击文件误走 editor route 语义。
- [x] (2026-04-20 13:44 +0800) 按最新产品语义修正 trusted smoke：panel route 点击文件的正确不变量是“文件在编辑区打开 + 画布继续保有 document focus”，而不是把旧 sentinel 文件固定成 `activeTextEditor`；因此删除两处过度约束的断言，并保留对真实交互语义的校验。
- [x] (2026-04-20 18:41 +0800) 按用户澄清回退 panel 文件打开的过度焦点实现：目标语义只是“在编辑区打开文件且不主动把文本光标切进文件”，而不是强制让 `.canvas-shell` 保有焦点；因此移除 Webview 根元素 `tabIndex/.focus()` 路径，并同步修正设计文档、Playwright 回归与 trusted smoke 断言。

## 意外与发现

- 观察：当前权威状态只持有 `nodes`，React Flow 也固定传 `edges={[]}`，所以连线功能必须从共享协议层开始改，而不是只在 Webview 增加局部交互。
  证据：`src/common/protocol.ts` 的 `CanvasPrototypeState` 目前只有 `nodes`；`src/webview/main.tsx` 固定把 `edges={[]}` 传给 React Flow。
- 观察：`Claude Code` 官方 hooks 和 `--settings` 路线可以为单次 CLI 启动注入结构化工具事件，不需要修改用户仓库里的 `.claude` 设置文件。
  证据：官方文档说明 hooks 可监听 `PreToolUse` / `PostToolUse`，CLI 同时支持 `--settings` 参数注入临时配置。
- 观察：VSCode Webview 没有直接给任意 workspace 文件渲染当前 file icon theme 图标的单一 API。
  证据：当前仓库和公开 API 都只有 `TreeItem` / `ThemeIcon` 等宿主控件能力；Webview 侧仍需由宿主先把主题资源解析成可显示描述。
- 观察：当前实现实际只提供少量基于扩展名的固定 `codicon` 映射，并没有完成“复用当前 VSCode File Icon Theme”的宿主解析层。
  证据：`src/panel/CanvasPanelManager.ts` 当前只通过 `createDefaultFileIconDescriptor()` 对少量扩展名返回固定 `codicon`，没有读取 icon theme contribution 或主题 JSON。
- 观察：文件活动 watcher 原先在 agent 退出时会立刻停掉 `fs.watch` / polling 并删除 session 临时目录；若 `Read` 事件刚 append 到 NDJSON 而 host 还未来得及 flush，就会在关闭路径里被直接吃掉，因此表现成“读不稳定、写更稳定”。
  证据：`src/panel/agentFileActivity.ts` 旧实现里 `dispose()` 先停 watcher 再删目录；`src/panel/CanvasPanelManager.ts` 旧实现里本地 agent `onExit` 进入 `finalize()` 后立即调用 `disposeAgentFileActivitySession(nodeId)`。
- 观察：即使在颜色、间距和 token 上尽量贴近 VSCode，整块自绘 sidebar `WebviewView` 仍然会和 Source Control、Run and Debug、Extensions 这些原生 sidebar section 形成明显观感断层。
  证据：2026-04-20 用户提供的参考图直接要求对齐常见 sidebar 风格；同日复查 VSCode 官方 `Sidebars` / `Views` / `Webviews` 指南后，也确认 sidebar 区域应优先使用原生 view / tree，而不是继续模拟宿主控件。
- 观察：在遵循官方 Sidebar / Views 指南的前提下，如果产品要求 `include` / `exclude` 必须直接以内嵌输入框形式出现在 sidebar 中，那么只靠 `TreeView` 无法满足，因为扩展 API 没有提供可在 TreeView 里局部嵌入 textbox 的能力。
  证据：本轮实现检查中，现有扩展 API 仍只有 Tree item、view title actions、context actions 等原生入口；没有可用于 Search 视图那种 inline input 的 TreeView 扩展点。用户也明确拒绝继续使用“点击编辑后弹出菜单”的交互。
- 观察：VS Code smoke 实际加载的是 `package.json#main` 指向的 `dist/extension.js`，而不是 `src/panel/CanvasPanelManager.ts`。当 `src` 已修正“风格切换复用旧位置”但未重新构建时，smoke 仍会执行旧版“碰撞或偏好不满足时重算位置”的逻辑，表现成文件节点在切换 `minimal -> card` 时漂移。
  证据：`package.json` 的 `main` 指向 `./dist/extension.js`；失败时 `dist/extension.js` 的 `resolveAutomaticArtifactPosition()` 仍包含 `!doesPlacementCollide(...) && doesPlacementRespectPreference(...)` 判断，而重新执行 `npm run build` 后该逻辑与 `src` 同步，`DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=trusted node scripts/run-vscode-smoke.mjs` 恢复通过。

## 决策记录

- 决策：新增全局配置 `devSessionCanvas.fileNode.displayStyle`，同时控制文件节点与文件列表节点使用 `card` 还是 `minimal` 风格，默认值设为 `minimal`。
  理由：这次需求关注的是“文件对象视觉表达”的统一收口，而不是再次拆出两套互相独立的配置；用一个总开关可以让用户在现有卡片风格和新的极简风格之间稳定切换，同时保持宿主的文件活动投影模型不变。
  日期/作者：2026-04-20 / Codex
- 决策：文件列表节点的 `列表视图 / 树形视图` 切换先作为 Webview 本地 UI 状态保存，并按节点 ID 持久化到 webview state，而不写回宿主权威画布状态。
  理由：该切换只影响单个文件列表节点内部的呈现结构，不改变 `fileReferences`、节点位置、边关系或其他宿主绑定真相；把它留在 Webview 本地状态更符合当前架构对“局部 UI 状态 vs workspace 权威状态”的分层。
  日期/作者：2026-04-20 / Codex

- 决策：把文件活动建模成独立 `fileReferences` 权威状态，再由宿主投影成文件节点或文件列表节点。
  理由：这样可以避免展示模式切换时把自动生成节点误当成事实来源，也能让生命周期和持久化围绕统一数据模型收口。
  日期/作者：2026-04-19 / Codex
- 决策：自动 Agent-文件关系线不开放人工编辑。
  理由：这类边的事实来源是 provider 文件活动事件；若允许用户手改，会和宿主重建逻辑冲突。
  日期/作者：2026-04-19 / Codex
  状态：已被 2026-04-19 后续“自动边转覆盖 / 屏蔽状态”的决策取代，保留仅作历史记录。
- 决策：第一轮自动文件活动正式支持 `Claude` 与 `fake-agent-provider`，`Codex` 保留 no-op adapter。
  理由：当前只有 Claude hooks 路线具备已确认的 provider 原生结构化工具事件；Codex 在本仓库里尚无同等证据。
  日期/作者：2026-04-19 / Codex
- 决策：`include` / `exclude` 过滤迁到 sidebar 持久化视图状态，并且只影响文件对象投影，不写回 `fileReferences`。
  理由：`fileReferences` 是文件活动权威状态；如果把过滤后的结果回写进去，就会把纯视图控制误当成事实来源，和本轮状态分层目标冲突。
  日期/作者：2026-04-20 / Codex
- 决策：sidebar 从单一 `WebviewView` 收口为两个原生 `TreeView` section：`概览` 负责动作与状态摘要，`文件过滤` 负责展示和编辑 `包含文件` / `排除文件`。
  理由：VSCode 官方 `Sidebars` / `Views` / `Tree View` 指南与用户提供的原生参考图都表明，sidebar 区域应优先使用原生 section 化视图；继续在这里自绘整块 webview，只会放大和宿主 Sidebar 的 UI/UX 偏差。
  日期/作者：2026-04-20 / Codex
- 决策：在用户进一步要求 `include` / `exclude` 直接以内嵌输入框出现在 sidebar 后，sidebar 最终收口为“概览 TreeView + 常用操作 WebviewView”的混合结构。
  理由：这是当前同时满足两条约束的最小方案：一方面保留大部分 sidebar 的原生 TreeView 风格；另一方面只把必须由 inline 输入框表达的常用操作区隔离到最小 `WebviewView`，避免重新回到整块 sidebar 自绘应用。
  日期/作者：2026-04-20 / Codex
- 决策：在 `常用操作` 区尾部补一排 icon-only 快捷按钮，并继续保留上方文字按钮。
  理由：文字按钮提供明确可读的主路径，尾部 icon-only 按钮则补足 VSCode 原生 action / toolbar 的高频回点感；两者复用同一动作语义，可以提升效率而不把 sidebar 重新做成 dashboard。
  日期/作者：2026-04-20 / Codex
- 决策：快捷 icon 最终放在 `常用操作` view title 行尾部，而不是 `WebviewView` 内容区。
  理由：用户明确指出按钮位置应属于“常用操作这一行的尾部”；从 VSCode 原生 Sidebar 语义看，这也应由宿主 `view/title` actions 承担，而不是继续在内容区模拟 toolbar。
  日期/作者：2026-04-20 / Codex
- 决策：本轮不把“完整复用当前 VSCode File Icon Theme”写成已实现；当前只保留有限的扩展名 `codicon` 映射，并把完整 theme parity 记为技术债。
  理由：review 已确认现有代码还没有真正的 theme 解析层；继续沿用“已实现”表述会造成正式文档漂移。
  日期/作者：2026-04-20 / Codex
- 决策：连线编辑主路径从右键菜单收口为“选中态轻量编辑台 + 双击原位标签编辑”，并保持 VSCode Workbench 风格。
  理由：右键菜单与胶囊占位会制造“可见但不可直接编辑”的错觉，也偏离当前仓库整体的 Workbench 原生化方向；选中态轻量编辑台更贴近画布中对象级操作的主路径。
  日期/作者：2026-04-19 / Codex
- 决策：自动边继续保留文件活动事实来源，但用户一旦编辑或删除自动边，宿主会把结果持久化为覆盖 / 屏蔽状态，而不是继续把它暴露成只读投影。
  理由：最新交互要求明确指出自动边和手工边在 UI 与功能上不再区分；若仍直接重建自动边，所有编辑都会变成伪交互。
  日期/作者：2026-04-19 / Codex

## 结果与复盘

本轮按计划落地了两层能力。第一层是用户可编辑的手工连线：宿主持久化 `CanvasEdgeSummary`，Webview 支持创建、选中、通过轻量编辑台修改箭头模式、双击原位改标签与删除。第二层是 provider 结构化文件活动：宿主持久化 `fileReferences`，再按当前配置投影成文件节点或文件列表节点，并把“点击文件”统一交还 VSCode 宿主打开编辑器。

在实现收口阶段，关系连线又进一步对齐到更明确的 Workbench 风格：未命名边不再显示不可编辑的占位胶囊；选中态改为连线上方轻量编辑台；标签输入改回 Webview 原位编辑；默认边与拖拽预览边共用同一默认 token；选中态通过 outline 与端点 handles 提示，而不是主线换色；同时补入 Obsidian 风格的 6 色预设和端点重接。

随着最新一轮需求收口，文件活动派生边也不再在用户侧暴露出“另一种只读边”语义。宿主内部仍保留文件活动事实来源，但一旦用户编辑或删除某条自动边，就把结果沉淀为持久化覆盖 / 屏蔽状态；这样 reload 与文件视图重建后，用户不会再遇到“刚改完就被自动投影打回”的问题。

随着实现收口，正式设计文档也已按主题拆分为 `docs/design-docs/canvas-graph-links.md` 与 `docs/design-docs/canvas-file-activity-view.md`。这样可以把“手工/自动连线模型”和“provider 文件活动投影”分别维护，减少后续继续迭代时的文档耦合。

验证上，Webview 现在有针对手工 edge、文件节点和文件列表节点的独立 Playwright 覆盖；宿主 smoke 覆盖了手工 edge 生命周期、fake provider 文件活动、展示模式切换、点击打开文件，以及删除 Agent 后的文件对象清理。过程中发现一条既有 smoke 断言把“可恢复”错误地绑定到了单一瞬时 status 文案；改成检查真正的不变量后，整条 trusted smoke 恢复通过。

本轮补丁没有改变文件活动的权威模型，也没有引入新的 provider 能力；它只收紧了“事件已落盘但 host 尚未消费”这段退出窗口。当前实现会在关闭 session 时额外保留一个短暂 settle 窗口，持续 drain NDJSON，再删除临时目录；trusted smoke 现已覆盖 `readexit` 这种“读事件后立即退出”的主路径。

按 review 收口后，文件活动视图又补上两条宿主边界。第一条是“编辑区点击文件不覆盖画布组”：当画布承载在编辑区时，文件打开统一走相邻 editor group；如果当前没有 split editor，就由宿主隐式创建一列再打开。第二条是“过滤不改真相”：`include` / `exclude` 不再暴露为 settings，而是迁到 sidebar 作为持久化视图状态；宿主现在只用它裁剪文件节点 / 文件列表节点 / 自动边的显示投影，`fileReferences` 继续保留完整权威数据。

在这之后，sidebar 又经历了一次方向修正。最初为了贴近 Search 视图，过滤入口一度被实现成单一 `WebviewView` 内的自绘输入框；随后结合用户提供的 VSCode 原生参考图和官方 `Sidebars` / `Views` / `Tree View` / `Webviews` 指南复查后，这条路线被正式放弃，改成两个原生 TreeView section。最后，用户进一步明确指出 `include` / `exclude` 必须直接以内嵌输入框出现在 sidebar 中，而不是再点编辑按钮。当前实现因此收口为混合结构：`概览` 保留原生 TreeView，只展示状态摘要，并新增 `Runtime Persistence` 状态；`常用操作` 改为最小 `WebviewView`，内容区承载打开画布、创建节点、重置画布状态和 `include` / `exclude` 输入框，而对应的快捷 icon 按钮则由宿主 `view/title` action 放在该 view 标题行尾部。这样既保留“过滤不改真相”的状态分层，也把自定义 UI 限制在确实需要 inline 输入框的最小范围内。

针对本轮最后一条 sidebar 文案反馈，`概览` 里的“画布状态”也进一步从“当前挂在 Panel / Editor 哪个承载面”收口回纯状态语义，只保留“已打开 / 未打开”。承载面仍然作为默认配置或宿主内部行为存在，但不再直接占用“状态”这行的描述位。

同时，本轮把文件图标口径从“尽量复用当前 file icon theme”改回与代码一致的事实描述：当前实现只有少量常见扩展名对应的固定 `codicon`，其余统一回退到通用文件图标。完整 file icon theme parity 已登记为技术债，避免后续协作者被文档误导。

## 上下文与定向

本轮会同时触达四个代码区域。

第一处是 `src/common/protocol.ts`。这里定义跨宿主 / Webview 的共享状态和消息协议。连线、文件活动引用、文件节点 metadata、打开文件消息和展示模式配置都需要先在这里落类型。

第二处是 `src/panel/CanvasPanelManager.ts`。它是 workspace 绑定画布状态的唯一权威入口。本轮所有 edge 持久化、自动文件对象重建、provider 文件活动接线和“点击文件后打开编辑器”都必须经过这里。

第三处是 `src/webview/main.tsx` 与 `src/webview/styles.css`。这里要补四向 handles、自定义 edge UI、文件节点 / 文件列表节点渲染、文件点击回传以及针对自动边与手工边的交互边界。

当前增量收口主要落在这两处文件活动 UI：`card` 风格保留现状；`minimal` 风格需要在不改动宿主文件活动真相的前提下，把文件节点收成贴内容边框，把文件列表节点收成接近 VSCode Source Control Changes 的单行列表，并在节点头部提供 `list/tree` 切换。

本轮最后一个阻塞点不是设计或宿主状态模型本身，而是构建产物同步。`src` 中用于保持自动文件节点位置稳定的逻辑已经改成优先复用旧位置，但 smoke 仍加载旧版 `dist/extension.js`，导致共享文件节点在风格切换时被误判为需要重新放置。补上 `npm run build` 后，源码与运行产物重新对齐，位置稳定性验证恢复通过。

第四处是测试与辅助 provider。`tests/playwright/webview-harness.spec.mjs` 负责 Webview 图交互；`tests/vscode-smoke/extension-tests.cjs` 负责真实宿主与打开文件路径；`tests/vscode-smoke/fixtures/fake-agent-provider` 需要补结构化文件事件输出。

## 工作计划

先改共享模型和宿主状态，让连线与文件活动都有正式可持久化的数据结构。然后实现 provider 文件活动 adapter 和宿主重建逻辑，把自动文件对象完整接进权威状态。接着再改 Webview，把四向 handles、edge 编辑和两种文件视图渲染补上。最后用 Playwright 和 smoke 共同验证“UI 可交互”和“宿主真能打开文件”这两层结果。

## 具体步骤

1. 更新文档与索引：

    - `docs/product-specs/canvas-graph-links-and-file-activity.md`
    - `docs/design-docs/canvas-graph-links.md`
    - `docs/design-docs/canvas-file-activity-view.md`
    - `docs/design-docs/index.md`
    - `docs/product-specs/index.md`
    - `docs/design-docs/core-beliefs.md`

2. 扩展共享协议与配置：

    - `src/common/protocol.ts`
    - `src/common/extensionIdentity.ts`
    - `package.json`
    - `package.nls.json`

3. 实现宿主状态与 provider 文件活动：

    - `src/panel/CanvasPanelManager.ts`
    - 新增 provider 文件活动模块
    - 如需独立 runtime 脚本，同步进入构建产物

4. 实现 Webview 交互与样式：

    - `src/webview/main.tsx`
    - `src/webview/styles.css`
    - 补 `file list` 极简 `list/tree` 视图切换与本地状态持久化

5. 更新测试与 fixture：

    - `tests/playwright/webview-harness.spec.mjs`
    - `tests/vscode-smoke/extension-tests.cjs`
    - `tests/vscode-smoke/fixtures/fake-agent-provider`

6. 运行验证：

    - `npm run typecheck`
    - `npm run test:webview`
    - `DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=trusted node scripts/run-vscode-smoke.mjs`

## 验证与验收

至少要完成以下验证：

- Webview 层：创建一条手工 edge，编辑其标签与箭头模式，再删除它，确认 UI 与持久化都正确。
- 宿主层：模拟支持文件事件的 Agent 上报读写文件，确认自动文件对象和自动边进入权威状态。
- VSCode 打开链路：点击文件节点或文件列表条目后，真实编辑器打开对应文件。
- 生命周期：删除 Agent 节点后，不再被任何 Agent 引用的文件对象被清理；仍有引用的文件对象保留。
- 文件风格切换：切换 `devSessionCanvas.fileNode.displayStyle` 后，文件节点 / 文件列表节点样式应在不改动位置与边关系的前提下切换为 `card` 或 `minimal`。
- 文件列表极简视图：在 `minimal` 风格下，文件列表节点头部的 `列表视图 / 树形视图` 可切换行式列表与目录树视图，且条目点击打开文件的行为保持不变。

## 幂等性与恢复

自动文件对象必须可以根据 `fileReferences` 重建，因此在 reload、host-boundary restore 和配置切换后都要得到同一结果。若某 provider 没有文件活动支持，宿主应安全退化成“没有自动文件对象”，而不是抛错或生成假数据。

## 证据与备注

- `npm run typecheck`：通过。
- `npm run test:webview`：59/59 通过；同步更新了 `canvas-shell-baseline-linux.png` 基线。
- `DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=trusted node scripts/run-vscode-smoke.mjs`：通过。
- 2026-04-20 增量验证：
  - `npm run typecheck`：通过。
  - `npm run build`：通过。
  - `DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=trusted node scripts/run-vscode-smoke.mjs`：失败；当前卡在文件节点点击打开文件后的 panel 焦点保持断言，失败点位于 `tests/vscode-smoke/extension-tests.cjs` 的 `verifyFileActivityViewsAndOpenFiles()`，与新增 `readexit` drain 路径本身无直接冲突。
- 2026-04-20 sidebar redesign 增量验证：
  - `npm run typecheck`：通过。
  - `npm run build`：通过。
- 2026-04-20 常用操作区二次收口验证：
  - `npm run typecheck`：通过。
  - `npm run build`：通过。
- 2026-04-20 常用操作区快捷 icon 增量验证：
  - `npm run typecheck`：通过。
  - `npm run build`：通过。
- 2026-04-20 常用操作标题行位置修正验证：
  - `npm run typecheck`：通过。
  - `npm run build`：通过。
- 2026-04-20 概览画布状态语义修正验证：
  - `npm run typecheck`：通过。
  - `npm run build`：通过。
- 2026-04-20 review blocker 焦点修复增量验证：
  - `npm run typecheck`：通过。
  - `npm run build`：通过。
  - `git diff --check`：通过。
  - `DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=trusted node scripts/run-vscode-smoke.mjs`：未完全通过，但失败点已从 `verifyFileActivityViewsAndOpenFiles()` 的 editor / panel 文件打开焦点链路后移到 `verifyHistoryRestoredResumeReadyIgnoresStaleResumeSupported()` 的历史恢复场景（`tests/vscode-smoke/extension-tests.cjs:4595`）。当前 failure artifact 不再出现先前 review blocker 指向的 `editor` focus 超时或 panel sentinel active editor 断言失败。
- 2026-04-20 panel 文件打开语义校正增量验证：
  - `npm run typecheck`：通过。
  - `npm run build`：通过。
  - `git diff --check`：通过。
  - `DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=trusted node scripts/run-vscode-smoke.mjs`：未完全通过，但 `verifyFileActivityViewsAndOpenFiles()` 已不再失败；当前 trusted smoke 失败点后移到 live runtime scrollback 历史恢复场景 `verifyLiveRuntimeReloadPreservesUpdatedTerminalScrollbackHistory()`（`tests/vscode-smoke/extension-tests.cjs:4222`），对应断言为 `waitForRuntimeSupervisorState()` 超时。
- 本轮增量验证：
  - Playwright：补充颜色菜单、端点重接，以及文件活动边与手工边共用同一 toolbar 的回归。
  - VS Code smoke：补充文件活动自动边被用户编辑 / 删除后的 reload 持久化验证。
- 关键新增验证：
  - Playwright：手工 edge 创建 / 选中 / 更新 / 删除；文件节点渲染与 `webview/openCanvasFile`；文件列表节点渲染与条目打开。
  - VS Code smoke：宿主手工 edge 持久化；fake provider 文件活动生成 `fileReferences` / `file` / `file-list`；点击文件节点 / 列表条目打开编辑器；删除 Agent 清理孤立文件对象。
- 2026-04-20 文件活动 UI 极简化增量验证：
  - `npm run typecheck`：通过。
  - `npm run build`：通过。
  - `npm run test:webview`：通过；覆盖 `minimal` 文件节点紧贴内容边框、文件列表节点 `列表视图 / 树形视图` 切换，以及 `R/W` 尾标显示。
  - `DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=trusted node scripts/run-vscode-smoke.mjs`：通过；覆盖 `devSessionCanvas.fileNode.displayStyle` 切换后自动文件节点位置与文件活动边 ID 稳定。

## 接口与依赖

本轮预期新增或修改以下接口：

- `src/common/protocol.ts`
  - `CanvasEdgeSummary`
  - `CanvasFileReferenceSummary`
  - `CanvasFilePresentationMode`
  - 与 edge / file open 对应的新消息类型

- `src/panel/CanvasPanelManager.ts`
  - state normalize / persist / reconcile 路径
  - webview message handler
  - provider session 启动路径

- Webview
  - React Flow `edges`
  - 自定义 node / edge types
  - 文件点击与 edge 编辑消息

---

本次创建说明：2026-04-19 新增本计划，用于覆盖通用连线、文件节点和文件列表节点相关功能；其中包含文件节点 / 文件列表节点显示收口，以及文件活动必须通过 provider 结构化事件接入宿主的要求。之所以独立起计划，是因为改动同时涉及正式规格、设计决策、共享协议、provider 结构化事件接线、宿主持久化、Webview UI 与自动化验证。

本次变更说明：2026-04-20 在原计划上继续追加“文件节点 / 文件列表节点 UI 简化与显示风格配置”范围。之所以不新开计划，是因为这次改动直接建立在既有文件活动视图能力上，仍然共用同一套 `fileReferences`、自动节点重建、配置监听与验证路径；新增的是视觉表达与局部 UI 状态，而不是另一套独立功能面。
