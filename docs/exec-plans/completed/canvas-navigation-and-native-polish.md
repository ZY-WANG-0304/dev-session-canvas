# 画布导航与原生工作台收口

本 `ExecPlan` 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘` 这几个章节。

当前文档必须按照仓库根目录下的 `docs/PLANS.md` 持续维护。

## 目标与全局图景

这项工作把当前排在最前面的几项画布 UI / 交互需求收口为一组可交付变更：用户可以双击节点标题栏，让节点自动居中并缩放到合适阅读尺寸；`Dev Session Canvas: 打开画布` 默认走 `panel` 路线；节点标题栏里的按钮和状态显示更接近 VSCode 原生工作台；用户在画布空白处右键时可以直接创建节点；`Agent` / `Terminal` 内嵌 `xterm` 会跟随 VSCode 主题切换。

用户能直接看到的效果是：打开画布后，主画布默认不再和文件编辑抢同一个编辑区；在大地图里定位某个节点更快；节点标题栏不再像自定义胶囊卡片；在空白画布上新增对象不必回到侧栏或命令面板。

## 进度

- [x] (2026-04-13 08:49 +0800) 复核 `AGENTS.md`、`docs/WORKFLOW.md`、`docs/PLANS.md` 与当前需求清单，确认本任务属于“先补产品/设计，再实现”的交付型工作。
- [x] (2026-04-13 08:49 +0800) 复核 `ARCHITECTURE.md`、`docs/FRONTEND.md`、现有产品规格与设计文档，确认本轮会同时触达画布交互、宿主承载面和节点 chrome。
- [x] (2026-04-13 08:49 +0800) 确认当前工作树起始于 `main` 且存在用户未提交改动，已切出主题分支 `canvas-navigation-and-native-polish` 以承接本次工作。
- [x] (2026-04-13 08:49 +0800) 复核 `src/webview/main.tsx`、`src/webview/styles.css`、`package.json`、`src/panel/CanvasPanelManager.ts` 与 `src/sidebar/CanvasSidebarView.ts`，定位四项功能的现有入口。
- [x] (2026-04-13 08:49 +0800) 起草新的产品规格、设计文档和本计划，把“默认 Secondary Sidebar”受 VSCode 平台约束的边界显式写入正式文档。
- [x] (2026-04-13 09:13 +0800) 完成双击标题栏聚焦、默认 `panel`、节点标题栏原生样式、空白区右键新建菜单，并同步更新正式规格、设计与计划文档。
- [x] (2026-04-13 11:44 +0800) 追加完成 `Agent` / `Terminal` 内嵌 `xterm` 跟随 VSCode 主题切换；覆盖背景、前景、光标、选区与 ANSI 16 色的热更新，并同步刷新相关 Playwright 截图基线。
- [x] (2026-04-13 09:13 +0800) 运行 `npm run typecheck`、`npm run test:webview`、`npm run test:smoke`；记录自动化结果，并把仍未单独脚本化的 Secondary Sidebar 手动拖拽路径显式保留为验证说明而非已确认结论。
- [x] (2026-04-13 13:08 +0800) 追加完成 `xterm` 主题跟随健壮性修复：主题 token 改为读取 Webview `body` 的真实 CSS vars，同类主题切换改为监听实际样式落地，缺失 `terminal.background` / ANSI token 时分别回退到当前 surface 背景与 VSCode 官方默认终端调色板，并补齐 Playwright 与 trusted smoke 回归。

## 意外与发现

- 观察：当前仓库里“`panel` surface”已经不是普通底部 Panel 的硬编码窗口，而是一条基于 `WebviewView` 的可移动 view container 路线。
  证据：`package.json` 通过 `contributes.viewsContainers.panel` 注册了 `devSessionCanvasPanel`；`src/panel/CanvasPanelManager.ts` 通过 `registerWebviewViewProvider()` 和 `${panelViewType}.open` / `.focus` 命令来 reveal 这一 surface。

- 观察：VSCode 官方 UX 指南明确写了扩展 view container 只能直接贡献到 Activity Bar 或 Panel，不能把默认贡献位置直接设成 Secondary Sidebar。
  证据：官方文档 `https://code.visualstudio.com/api/ux-guidelines/sidebars` 写明“View Containers can be contributed by extensions to the Activity Bar or Panel”，并把 Secondary Sidebar 描述为用户可移动后的工作台区域。

- 观察：节点标题栏现在把标题输入框、provider 下拉、状态胶囊和动作按钮都挤在同一行里；如果不先规定“双击只在非交互标题栏区域生效”，就会和标题编辑或 provider 选择冲突。
  证据：`src/webview/main.tsx` 中 `AgentSessionNode`、`TerminalSessionNode`、`NoteEditableNode` 都把 `ChromeTitleEditor`、`select`、`status-pill` 和 `ActionButton` 放在 `.window-chrome` 内。

- 观察：VSCode 扩展 API 的 `ColorTheme` 只暴露主题种类，不提供解析后的颜色值；而 Webview 里的实际主题 token 挂在页面样式层，不能从宿主直接拿到一整套颜色。
  证据：`node_modules/@types/vscode/index.d.ts` 中 `ColorTheme` 只有 `kind`；真实颜色只能通过 Webview 中注入的 CSS vars 读取。

- 观察：之前 `xterm` 主题读取如果只看 `documentElement`，会错过 VSCode Webview 实际写在 `body` 上的大部分主题 token，因此表现成“只有部分主题能跟随”。
  证据：本轮修复前，`src/webview/main.tsx` 从 `getComputedStyle(document.documentElement)` 读取 `--vscode-terminal-*`；修复后改为读取 `body` 的 computed style，并新增基于 `body/html` style 变化的回归测试。

## 决策记录

- 决策：本轮新增一份独立产品规格和一份独立设计文档，而不是只零散改 `canvas-core-collaboration-mvp`。
  理由：这四项功能同时触达导航、宿主承载面、节点 chrome 和空白区交互，跨越了已有多个主题文档；独立文档更容易追踪当前正式结论与平台边界。
  日期/作者：2026-04-13 / Codex

- 决策：默认打开方式改为 `panel`，但不把“直接默认落位 Secondary Sidebar”写成可实现结论。
  理由：VSCode 平台只允许扩展默认贡献到 Activity Bar 或 Panel；直接把 view 默认放到 Secondary Sidebar 不是公开可用能力。当前正式结论应收口为“默认走 `panel` route，并尊重用户把该 view 移到 Secondary Sidebar 或保留在底部 Panel 的原生工作台选择”。
  日期/作者：2026-04-13 / Codex

- 决策：双击聚焦只绑定到标题栏里的非交互区域，不抢占标题输入、下拉选择和按钮的双击行为。
  理由：当前标题栏已经承担命名与执行控制主路径。双击聚焦应该是导航增强，不应破坏输入框选词、按钮或下拉菜单的既有语义。
  日期/作者：2026-04-13 / Codex

- 决策：空白区右键菜单第一版只提供“新建 Agent / Terminal / Note”三项快捷创建，不把重置、打开画布或节点级动作混进来。
  理由：需求明确聚焦“创建效率”；第一版菜单越窄，越不容易和侧栏、命令面板以及节点内右键语义相互打架。
  日期/作者：2026-04-13 / Codex

- 决策：本轮不额外为“用户手动把 `panel` view 移到 Secondary Sidebar 后再 reveal”补一条改工作台布局的 smoke。
  理由：该位置变化属于 VSCode 原生 view container 行为，不是扩展自己的状态模型；当前交付重点是默认 `panel` route、truthful copy 和 reveal 主路径。自动化已覆盖默认命令走 `panel`，文案也已明确写为“位置由 VSCode 原生记住”，因此这里保留为显式验证说明，而不把未实测的工作台布局动作写成仓库结论。
  日期/作者：2026-04-13 / Codex

- 决策：`xterm` 主题同步不再依赖固定深色 fallback；当主题缺失 `terminal.background` 时按当前 surface 回退到 `panel.background` 或 `editor.background`，ANSI 颜色缺失时回退到 VSCode 官方默认终端调色板。
  理由：大量主题不会显式声明完整 `terminal.*` token；如果继续回退到仓库私有固定颜色，会让大多数主题看起来“没有跟随 VSCode”。
  日期/作者：2026-04-13 / Codex

- 决策：Webview 在收到 `host/themeChanged` 后，除了立即调度一次 `xterm` 主题刷新，还要监听 `body/html` 的 class、dataset、style 与 head 样式变化，在真实主题样式落地后再次刷新。
  理由：同类主题切换时 `vscode-dark` / `vscode-light` class 可能不变，宿主消息也可能早于 Webview 的 CSS vars 更新；只靠单次消息刷新不够稳定。
  日期/作者：2026-04-13 / Codex

## 结果与复盘

本轮已经完成并可交付。结果如下：

- 正式新增并落库了本轮的产品规格、设计文档与实现型 `ExecPlan`，把“默认 Secondary Sidebar”收口为真实可交付结论：默认 `panel` route + 用户可按 VSCode 原生能力移动该 view，位置由 VSCode 记住。
- 代码上完成了四项交付：默认 `openCanvas` 改走 `panel`、节点标题栏双击聚焦、标题栏按钮/状态/选择器的 workbench 风格收口，以及空白 pane 右键快捷创建菜单。
- 正式产品规格、设计文档、实现计划与索引已同步更新，不再把 `panel` route 误写成固定底部 Panel。
- 自动化验证完成：`npm run typecheck` 通过；`npm run test:webview` 22 项通过；`node scripts/run-playwright-webview.mjs --update-snapshots` 22 项通过；`npm run test:smoke` 通过，并覆盖 trusted / restricted、real reopen、fake systemd-user / fallback 与 remote-ssh real reopen。
- 后续又补了一轮健壮性收口：`npm run typecheck` 通过；`node scripts/run-playwright-webview.mjs --update-snapshots` 23 项通过；`DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=trusted node scripts/run-vscode-smoke.mjs` 通过，并新增覆盖 `body` 级 theme vars、同类主题切换、稀疏 terminal token、`panel/editor` surface 背景 fallback 与真实 VSCode `Dark Modern` / `Light Modern` 主题切换。

仍保留的边界是：本轮没有单独脚本化“用户手动把 view 拖到 Secondary Sidebar 后再 reveal”的工作台布局动作，因此仓库只把这条行为写成 VSCode 原生能力边界，不把它误写成扩展已直接控制或单独验证的内部状态。

## 上下文与定向

这次工作只涉及当前仓库里已经存在的主画布实现，不引入新的画布库、状态库或宿主运行时。相关区域如下：

- `package.json`：扩展命令、配置、view container 与默认设置定义。
- `src/panel/CanvasPanelManager.ts`：主画布 `editor/panel` surface 的 reveal、状态同步与 sidebar 摘要。
- `src/sidebar/CanvasSidebarView.ts`：侧栏里展示“打开画布 / 创建对象 / 重置状态 / 最小状态摘要”的原生 `TreeView`。
- `src/panel/getWebviewHtml.ts`：非活动 surface 的 standby HTML，用于解释单主 surface 语义。
- `src/webview/main.tsx`：React Flow 画布、节点标题栏、创建逻辑、测试桥和前端交互主入口。
- `src/webview/styles.css`：节点标题栏、按钮、状态标签、底角控件与新增菜单的视觉语言。
- `tests/playwright/webview-harness.spec.mjs`：浏览器 harness 里的 Webview UI 回归。
- `tests/vscode-smoke/extension-tests.cjs`：真实 VSCode 宿主 smoke，用于验证默认承载面与 surface 切换。

这里的“标题栏双击聚焦”指用户双击节点头部的非交互 chrome 区域后，React Flow 把该节点作为单节点目标执行 `fitView`，从而同时完成“居中”和“缩放到适合阅读的尺寸”。这里的“`panel` route”指当前通过 `WebviewView` 承载的可移动 view container 路线，而不是承诺它永远固定在底部 Panel。

## 工作计划

先补文档，再做代码。文档部分包含一份新的产品规格和一份新的设计文档，并同步更新索引；它们要把当前四项功能的正式边界、非目标和验收口径写清楚。实现部分分四块推进。

第一块是宿主默认承载面。把 `package.json` 与 `src/panel/CanvasPanelManager.ts` 中 `canvas.defaultSurface` 的默认值改为 `panel`，并把所有“面板”相关的人类文案改成“`panel` route 是可移动 view”语义，避免在用户把 view 移到 Secondary Sidebar 后仍显示错误位置描述。

第二块是节点聚焦导航。在 `src/webview/main.tsx` 里提炼一个“聚焦节点”动作，接收节点 id，调用 React Flow 的单节点 `fitView`，并在标题栏的非交互区域上绑定双击。实现时要显式屏蔽输入框、按钮、下拉选择等交互控件，避免误触。

第三块是节点标题栏原生收口。更新 `src/webview/styles.css` 与必要的标题栏结构，让 `ActionButton`、`status-pill` 和 provider select 更接近 VSCode 原生工具栏与 badge 语言，降低当前高圆角胶囊风格。保留现有主动作语义，但把默认外观改成更克制的 workbench 风格。

第四块是空白区右键新建。在 `src/webview/main.tsx` 中利用 React Flow 的 pane 级 context menu 事件，只在空白画布上打开一个轻量菜单；菜单项使用当前三类节点类型，并把新节点锚到右键发生处附近，而不是固定生成在视口中心。菜单打开后要支持点击外部、按 `Escape`、移动视图或完成创建后关闭。

## 具体步骤

1. 新增 `docs/product-specs/canvas-navigation-and-workbench-polish.md`，并更新 `docs/product-specs/index.md`。
2. 新增 `docs/design-docs/canvas-navigation-and-workbench-polish.md`，并更新 `docs/design-docs/index.md`。
3. 修改 `package.json`、`package.nls.json`、`src/panel/CanvasPanelManager.ts`、`src/sidebar/CanvasSidebarView.ts`、`src/panel/getWebviewHtml.ts`，把默认 surface 改成 `panel`，并收口相关文案。
4. 修改 `src/webview/main.tsx`，新增节点聚焦逻辑、pane 右键菜单状态、右键创建锚点与对应测试桥。
5. 修改 `src/webview/styles.css`，把标题栏按钮与状态标签改成更接近 VSCode 原生 toolbar / badge 的视觉。
6. 修改 `tests/playwright/webview-harness.spec.mjs`，补双击聚焦和空白区右键新建回归，必要时刷新截图基线。
7. 修改 `tests/vscode-smoke/extension-tests.cjs`，补“默认命令走 panel route”的 smoke 断言。
8. 回写相关规格/设计索引，以及必要的宿主文案说明。
9. 运行 `npm run typecheck`、`npm run test:webview`、`npm run test:smoke`，把结果写回计划与设计文档。

## 验证与验收

完成实现后，至少要满足以下可观察标准：

- 运行 `Dev Session Canvas: 打开画布` 时，在没有用户覆盖配置的前提下，默认使用 `panel` surface；显式 `在编辑区打开画布` 仍可覆盖本次打开位置。
- 用户把 `panel` view 移到 Secondary Sidebar 后，显式 `panel` 打开命令仍能在该 view 的当前工作台位置 reveal；仓库文档不再把这一行为误写成“仍固定在底部 Panel”。
- 双击节点标题栏的非交互区域后，该节点会在当前视口中居中，并缩放到合适阅读尺寸；双击输入框、下拉选择或按钮不会触发聚焦。
- 节点标题栏里的按钮、状态标签和下拉选择在视觉上明显更接近 VSCode 原生 workbench，而不是大圆角胶囊。
- 在画布空白处右键后，会出现快捷菜单；点击菜单项会在右键位置附近创建节点；右键菜单不会在节点内部或终端内部误弹。
- `npm run typecheck`、`npm run test:webview`、`npm run test:smoke` 通过。

## 幂等性与恢复

这次改动全部基于已有 surface、消息协议和 React Flow 实现，不需要迁移持久化格式。`canvas.defaultSurface` 的默认值改为 `panel` 后，已有用户的个人配置与 VSCode 已记住的 view 位置应继续优先，不能被扩展强行覆写。

右键菜单和节点聚焦都属于前端临时 UI 状态，不应写入宿主持久化。只有结果性的 viewport 更新和节点创建消息需要继续走现有写路径。

## 证据与备注

当前实现前已确认的关键证据如下：

    - `package.json` 当前把 `devSessionCanvas.canvas.defaultSurface` 默认值设为 `editor`。
    - `src/webview/main.tsx` 当前没有 `onNodeDoubleClick` 或 `onPaneContextMenu` 逻辑。
    - `src/webview/styles.css` 当前标题栏按钮是 999px 胶囊，状态标签也是高圆角高饱和胶囊。
    - VSCode 官方 sidebars UX 指南只允许扩展默认把 view container 贡献到 Activity Bar 或 Panel。

这些证据足以支持本轮的实现范围和平台边界。

## 接口与依赖

本轮不新增第三方依赖。需要继续使用以下现有接口：

- React Flow 实例的 `fitView()` / `screenToFlowPosition()` 来实现节点聚焦与右键锚点创建。
- 现有 `webview/createDemoNode` 消息来复用宿主已有的新建节点与避碰逻辑。
- 现有 `CanvasSidebarState` 来展示默认 surface 和当前画布状态；必要时只调整其人类可读描述，不扩大状态模型。
- 现有 `WebviewDomAction` / `WebviewProbeSnapshot` 测试桥，如需补新的 probe 字段或 DOM 动作，要保持协议向前兼容。

本次修订说明：2026-04-13 08:49 +0800 新建实现型 `ExecPlan`，先收口产品边界和 VSCode 平台限制，再进入代码实现。
本次修订说明：2026-04-13 09:13 +0800 完成代码、文档与自动化验证后，将本计划归档到 `completed/`，并显式记录 Secondary Sidebar 拖拽路径仍是 VSCode 原生工作台行为边界。
本次修订说明：2026-04-13 13:08 +0800 追加记录 `xterm` 主题跟随健壮性修复，明确 body 级 token 读取、surface 背景 fallback、真实样式落地后二次刷新，以及新增 Playwright / trusted smoke 验证。
