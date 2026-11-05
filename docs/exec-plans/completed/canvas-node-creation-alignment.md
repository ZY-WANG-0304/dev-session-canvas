# 实现 P 驱动的新建节点对齐

本计划按 `docs/PLANS.md` 维护。分支为 `canvas-node-creation-alignment`，工作目录为 `/home/users/ziyang01.wang-al/projects/dev-session-canvas.worktrees/canvas-node-creation-alignment`。

## 目标与全局图景

用户在已有节点旁右键创建时，只需选择一侧：左右顶部对齐，上下左边对齐，间距 40 画布单位。以 P 到边的距离选择参考关系，B 尺寸不参与选择。障碍只使新节点沿原方向外移。远处或斜角沿用普通避碰，旧节点可自由移动。

## 进度

- [x] 2026-11-04：读取已确认图文方案，核对协议、右键入口及 root-local 转换。
- [x] 2026-11-04：实现纯几何与协议，替换旧矩形吸附。
- [x] 2026-11-04：接通 Webview、宿主及分组位置处理。
- [x] 2026-11-04：完成几何、协议、宿主与浏览器定向回归，更新正式文档；人工 VSCode 手感验收不在自动化结论内。

## 意外与发现

现有消息仅携带减去半尺寸后的 `preferredPosition`；菜单显示位置会受窗口边界限制。原 `flowAnchor` 与活动 surface 的 zoom 必须显式保存，不能从菜单位置或 B 左上角反推。旧分支代码是矩形吸附，并非已确认的新设计。

新窗口边缘浏览器场景首次点击坐标位于 MiniMap，未触发画布右键；调整到 MiniMap 上方仍需菜单移位的空白画布后通过。未因此修改产品逻辑。普通 group 原本就会执行 sibling 修复，目标组及祖先固定仅保证其子树不因扩容平移；其他组仍沿用原修复规则。

## 决策记录

2026-11-04：新增可选 `creationAnchor: { position, zoom }`，仅由右键创建发送；旧消息及非右键创建保留普通定位。这样避免将无鼠标入口误当作点选。屏幕触发深度取 160 CSS px，画布范围为 160 / zoom；有限正 zoom 和有限位置由协议校验。四侧外边界包含，A 内部不匹配；同距离按右、下、左、上及节点 ID 排序。以实际宽高沿选定方向越过碰撞矩形，每一步都增加进度，不用固定搜索半径截断。

## 结果与复盘

已交付 P 分区选择、单轴避碰、可选消息字段、原 P/zoom 保存和 root-local 坐标转换。旧矩形吸附已删除，旧消息仍可用。纯几何、协议、宿主和浏览器定向验证通过；未运行真实 VSCode 人工手感、全平台及发布门禁。设计文档用 `验证中` 保留这些证据边界；仓库仅管理两张已引用 PNG。

## 上下文与定向

`extensions/vscode/dev-session-canvas/src/webview/main.tsx` 保存右键坐标并发消息，`canvasTypes.ts` 保存菜单状态。`common/protocol.ts` 定义和解析消息。`panel/CanvasPanelManager.ts` 是位置权威，将组合画布坐标转换成单 root 坐标后调用 `createNextState()`。共享几何位于 `common/canvasNodePlacement.ts`，这里不依赖 DOM 或 VSCode。

## 工作计划

第一里程碑在共享几何增加点选关系和定向避碰，替换当前矩形吸附函数；补充协议类型和校验。第二里程碑让菜单传入原点和原 zoom，宿主转换 P 并使用新规则，保留 Fork/模板和非右键默认行为。第三里程碑以纯几何、真实宿主函数和 Playwright 菜单交互组合验证。设计文档更新为实际实现口径，仅保存已使用的 PNG。

## 具体步骤

在上述工作目录运行 `npm run test:canvas-node-placement`、`npm run test:protocol-webview-messages`、`node scripts/test/test-canvas-node-groups.mjs`、`node scripts/test/test-canvas-execution-context.mjs`、`npm run typecheck`。浏览器通过 `node scripts/test/run-playwright-webview.mjs --grep <场景>` 定向运行，先检查 harness 构建配置与依赖。临时复用相邻工作区 node_modules；若需新增依赖安装仅使用仓库锁文件。

## 验证与验收

同侧不同 P 和不同 B 类型选择同一参考关系；四向、160px 边界、缩放、斜角、多邻居及障碍均覆盖。宿主回归须证明 root-local 转换后仍按同一方向落位、旧节点不移动、手动拖动不受限制、Fork 与模板不变。浏览器验证平移缩放和窗口边缘菜单仍发送原 P；结合宿主测试确认消息到最终几何的链路。自动化不声称真实 VSCode 人工手感或全平台验收。

## 幂等性与恢复

所有操作在既有功能 worktree 进行，不改原用户工作区，不提交或发布。测试可重复运行；清理仅限本次临时依赖链接及测试产生的文件，不回滚用户文件。

## 证据与备注

`test:canvas-node-placement`、`test:protocol-webview-messages`、`test-canvas-node-groups.mjs`、`test-canvas-execution-context.mjs`、`test:canvas-layout-arrangement`、`typecheck`、`git diff --check` 通过。浏览器 15 项：首轮 14 通过，MiniMap 点击修正后的窗口边缘场景单独通过。多 root 宿主测试从 `handleActiveWebviewMessage()` 进入实际创建，错误的旧 preferredPosition 不影响正确 P 的落位，证明消息接线和坐标转换成立。

浏览器构建通过 `buildBrowserAssets({ output: '.debug/alignment-browser', marketplace: false })` 生成，使用 `DEV_SESSION_CANVAS_BROWSER_ASSETS` 指向该目录的 `main` 子目录；Playwright 以 `right-click|canvas group body context menu` 筛选。Node v25.6.0，使用本地已有 node_modules 和相邻工作区 Chromium 缓存。清理时确认 node_modules 为已有目录，仅删除本轮误建的内层链接，保留依赖目录。图文设计为 `docs/design-docs/canvas-node-creation-alignment.md`。

## 接口与依赖

复用现有矩形碰撞函数与 `CanvasNodePosition`，不增加 npm 依赖。新增 `CanvasNodeCreationAnchor` 协议类型、纯函数 `resolvePointerNodePlacementReference()`；`resolveAlignedNonOverlappingNodePosition()` 接受可选 creationAnchor，无该字段时仅普通避碰。

2026-11-04 初稿：将已确认方案拆成协议、几何、宿主和浏览器三个里程碑，明确旧实现尚待替换。

2026-11-04 收口：同步实际实现、自动化证据及人工验证边界，计划移入 completed。未提交或推送，原用户工作区保持不变。

2026-11-05 补充：用户要求同步 smoke，独立计划见 [创建对齐 smoke 同步](canvas-node-creation-alignment-smoke.md)。浏览器清单、三项 source/packaged case、等待预算及完整任务数已同步，测试 flush 漏 overlay 已修复；17 项浏览器、三项新源码 smoke 与尺寸回归、211 项 CI 回归通过。正式同批 VSIX、跨平台与真实手感仍未验，不能用此补充扩大原验收结论。
