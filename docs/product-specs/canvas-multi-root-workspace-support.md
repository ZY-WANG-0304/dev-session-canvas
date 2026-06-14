---
title: 画布多根 workspace 组合视图规格
status: 已确认
updated_at: 2026-06-13
related_designs:
  - docs/design-docs/canvas-multi-root-workspace-support.md
related_plans:
  - docs/exec-plans/active/canvas-multi-root-composed-canvas-rewrite.md
  - docs/exec-plans/completed/canvas-spatial-fit-minimap.md
  - docs/exec-plans/completed/canvas-add-folder-root-placement.md
---

# 画布多根 workspace 组合视图规格

## 背景

用户在 VSCode 中既会单独打开一个工程，也会把多个工程作为 multi-root workspace 一起打开。Dev Session Canvas 应保持同一套 root 心智：单根只显示当前 root 自己的画布，多根显示所有当前 root 的画布内容，并用系统 root section 区分不同工程。

## 用户目标

- 单独打开一个 workspace folder 时，只看到这个 root 自己的画布内容。
- 打开 multi-root workspace 时，看到所有当前 workspace folders 的画布内容。
- 每个 root 都有清晰的系统分组区域，避免不同工程的节点混在一起。
- 点击全局 fit view 或查看右下角 MiniMap 时，可以看到所有 root section 的组合布局，即使某个 root 暂时没有节点。
- 通过 VSCode `Add Folder to Workspace` 添加新 root 后，新 root section 出现在当前视野附近，并通过缩放平移动效进入视野。
- 在多根画布中整理某个 root 内的节点后，单独打开该 root 仍能看到这些整理结果。
- 移动 multi-root 中的 root 区域只影响多根布局，不改写单根 root-local 节点坐标。
- root 内对象移动到边界外时，root 区域自动扩张，内容不会静默移出所属 root。
- 多根窗口重启后，已有 `Agent` / `Terminal` live runtime 可以按 root-local runtime 身份重新附着；单根窗口与多根窗口同时打开时共享同一个后端 session。

## 功能范围

1. 每个 workspace folder 拥有一份 root-local 画布状态。
2. 单根 workspace 读取并写入当前 root-local 画布状态。
3. 多根 workspace 读取所有当前 root-local 画布状态，并组合成一张画布显示。
4. 多根组合视图中，每个 root 显示为一个系统 root section。
   root section 的 body 以固定密度平铺同名签名式水印，用于在多根 workspace 中快速确认当前会话所属 root；水印只使用 root 展示名，不替代标题 tooltip 中的完整路径，采用横向文本，字号与 root section title 相同并跟随同一套缩放逻辑，且不可交互。该能力由 `devSessionCanvas.canvas.workspaceRootWatermarks.enabled` 控制，默认开启。
5. 系统 root section 可以移动和 resize；移动后只保存多根 overlay 位置，不改变单根 root-local 节点坐标。
6. 系统 root section 不能被删除、取消分组或重命名。
7. root section 是 root-local 内容的硬容器：root 内节点或用户分组移动到边界外时，root section 扩张并继续包含它们。
8. root section 对外作为整体分组参与避让和包含：root section 之间不能重叠，多个 root section 可以被 multi-root overlay 普通分组包含。
9. 在 root section 内创建节点、用户分组、模板内容或关联 Markdown Note 时，新对象写回该 root-local 状态。
10. 执行节点的 `metadata.cwd` 继续作为执行目录权威；拖拽到其他 root section 不静默改写 cwd。
11. 多根组合视图内部使用命名空间避免不同 root 下的节点 ID、分组 ID 或连线 ID 冲突。
12. 多根组合视图中，用户创建或重连连线时，两个端点必须属于同一个 root section；跨 root 连线被拒绝。
13. 文件活动自动节点、file-activity edge 和 suppression id 在多根组合视图中按 root 命名空间重建，不跨 root 共享；`file` / `file-list` 在各自 root 内按 owner Agent 最近公共父分组归属，没有公共用户分组时归属对应 `workspace-root`。
14. 多根组合视图中的 live 文件活动记录按 owner 节点所属 root 生成 root-namespaced `fileReferences.id`；旧的未命名空间化引用在重建时按 root scope 迁移或补 namespace。
15. 多根组合视图中的 `Agent` / `Terminal` 恢复时，display node id 只服务渲染、选择、连线、布局和拆回 root-local；runtime binding id 以 `runtimeBackend + runtimeStoragePath + runtimeSessionId + executionKind` 为权威，其中 `runtimeStoragePath` 必须保留具体 VS Code `workspaceStorage` slot。
16. 多根窗口不能用当前 multi-root workspace storage path 猜 runtime；同一个 root 的多个 storage slot 也不能互相替代，必须使用 root-local metadata 中保存的完整 `runtimeStoragePath`。旧 snapshot 缺少 `runtimeStoragePath` 时必须迁移或显式降级为历史恢复，并记录诊断。
17. 全局 fit view、初始自动 fit、动态最小缩放和 MiniMap 把所有系统 root section 作为一等空间对象纳入；multi-root 下全局 fit view 默认包含所有 root section。
18. 当 VSCode workspace folder 变化新增 root 时，如果该 root 在 multi-root overlay 中还没有位置，系统应以当前画布可见中心为锚点，选择离该中心最近且不与已有 root section 重叠的可用位置；已有 overlay root 位置不被重新计算。
19. 新增 root section 进入 composed view 后，Host 应请求当前 Webview 聚焦该 workspace-root group；Webview 通过平移与缩放动画把该 root section 移入视野，并在动画结束后持久化 viewport，同时向 Host 上报动画后的 `webview/updateViewportCenter`。

## 非目标

- 不实现 root 切换器或独立 workspace 管理器。
- 不实现多根专属的独立画布分支。
- 不实现跨 root Note、跨 root 连线或跨 root 模板捕获。
- 不把包含多个 root 的 multi-root overlay 普通分组写入任一单根 root-local 状态。
- 不支持把 multi-root 组合视图整体保存为模板。
- 不承诺同一个 Host 内多个 display node 同时呈现同一个 runtime；当前绑定仍是一条 runtime key 对应一个 display node，未来如需支持需升级为 subscribers/list。
- 不把 display node id 当成 runtime session 身份；multi-root namespaced id 不能直接替代 root-local runtime metadata。
- 不在拖拽时自动把执行节点迁移到另一个 root 或改写 cwd。

## 验收标准

- 在单根 `frontend` workspace 中创建一个 Note，关闭后打开包含 `frontend` 与 `backend` 的 multi-root workspace，能在 `frontend` root section 中看到该 Note。
- 在 multi-root workspace 中，每个 workspace folder 都显示一个系统 root section，标题对应 folder 名称。
- 在 multi-root workspace 中，系统 root section 的 body 区域以固定密度平铺对应 folder 名称的低透明签名式水印；普通用户分组不显示自己的水印，也不会用分组背景遮掉所在 root 的水印；稳定节点仍覆盖水印。水印使用与 root section title 一致的字号和缩放逻辑，不拦截 root body 选择、聚焦或右键创建。
- `devSessionCanvas.canvas.workspaceRootWatermarks.enabled` 默认为 `true`；设为 `false` 后，系统 root section 不再渲染 body 水印，但保留 root section 标题和完整路径 tooltip。
- 在 multi-root workspace 中移动某个 root section 后重新加载，多根布局保持；单独打开该 root 时，节点仍保持 root-local 相对位置。
- 在 multi-root workspace 中把某个 root 内 Note 拖到 root 边界外后，root section 自动扩张；单独打开该 root 可以看到 Note 的 root-local 位置变化。
- 在 multi-root workspace 中两个同父 root section 不会重叠；选中多个同父 root section 创建普通分组后，外层分组可以包含这些 root。
- 在 multi-root workspace 的某个 root section 内创建 Note / Agent / Terminal / 模板内容 / 关联 Markdown Note 后，单独打开该 root 可以看到对应对象。
- 两个 root 中都存在 `note-1` 或 `agent-1` 时，多根组合视图不会发生节点 ID 冲突。
- 在 multi-root workspace 中，跨 root 画线或把既有连线重连到另一个 root 的节点不会创建或更新连线。
- 两个 root 都有文件活动时，自动 `file` / `file-list` 节点和 file-activity edge 均保留在各自 root section 内，按各自 root 内 owner Agent 最近公共父分组归属，且 ID 不冲突；当前版本不把跨 root owner 合并成同一个自动文件 artifact。
- 在 multi-root workspace 中运行 Agent 产生新的文件活动时，新写入的 `fileReferences.id` 带所属 root namespace；删除该自动文件节点后的 suppression 在重载后仍生效。
- 一个 root-local live runtime 节点在 multi-root 重启后按原 `runtimeBackend + runtimeStoragePath + runtimeSessionId + executionKind` 重新附着，离线期间输出可见。
- 同一个 root 被多个 VS Code slot 打开时，runtime 仍按完整 `runtimeStoragePath` 区分；没有 `runtimeStoragePath` 的旧 live-runtime root-local snapshot 不会被同 root 当前 slot 隐式接管。
- 单根窗口与 multi-root 窗口同时打开同一 root-local live runtime 时，output 在两个窗口可见；input、stop、delete 作用于同一 backend session；resize 第一版按 last-writer-wins 处理。
- 旧 snapshot 缺少 `runtimeStoragePath` 时，不会隐式 attach 到当前 multi-root workspace storage；系统必须迁移或明确降级为历史恢复。
- 在 multi-root workspace 中，空 root section 没有节点时也会被全局 fit view 纳入；右下角 MiniMap 能看出多个 root section 的相对布局。
- 在 multi-root workspace 中添加第三个 folder 后，新 root section 不使用远离当前视口的默认 index 网格位置，而是落在当前可见中心附近的最近可用空位，且不与已有 root section 重叠；重载后该位置保持。
- 添加 folder 后当前画布通过短暂缩放平移动画移动到新增 root section，新增 root section 可见并被选中。
- 连续添加 folder 且用户不手动平移时，第二个新增 root 的落点应锚定在上一次程序化聚焦后的可见中心附近，而不是聚焦前的旧视口中心。
- 如果添加 folder 后 Panel Webview 发生同 generation frame refresh，新增 root section 的聚焦请求仍会在当前 frame 上 replay 并完成动画。
- 创建 `Agent` / `Terminal` 时，节点 `metadata.cwd` 等于目标 root 路径或显式 Explorer cwd。

## 验证状态

截至 2026-06-13，本规格已完成主路径自动化验证：`npm run test:canvas-multi-root-composition`、`npm run test:canvas-node-groups`、`npm run test:canvas-execution-context`、`npm run test:protocol-webview-messages`、`npm run test:canvas-templates`、`npm run test:note-markdown-file-association`、`npm run test:extension-storage-paths`、`npm run typecheck`、`npm run build`、`git diff --check` 和针对 workspace root / cross-root edge 的 Playwright 用例均通过。Add Folder root placement 本轮新增 composition 回归覆盖新增 root 以当前可见中心就近避让、写入 overlay；新增 Webview 回归覆盖 `host/focusGroup` 通过缩放平移动画聚焦 workspace root section；root body 平铺签名水印新增 Playwright 回归覆盖 workspace-root 专属渲染、root title 展示、重复铺排、横向样式、字号与 root title 同步缩放、低透明不可交互、配置关闭、body 点击穿透、普通分组背景不遮挡以及节点层仍覆盖水印。review follow-up 追加覆盖 Host 侧多根文件活动自动 artifact 命名空间、live 文件活动 root-namespaced reference、suppression 剪枝，以及旧 multi-root skip 不覆盖 root-local live runtime 重连信号。2026-06-06 已实现 live runtime 验收口径修订：multi-root 按 root-local runtime metadata 共享恢复，不再整体 skip；自动化已覆盖取消 multi-root block、runtime binding key 包含 backend/storage/session/kind、缺失 `runtimeStoragePath` 的显式降级、supervisor output/state 多播与 delete 终态广播。2026-06-07 补充同 root 多 VS Code slot 验证：`node scripts/smoke/run-vscode-storage-slot-smoke.mjs` 已通过，覆盖 root-local snapshot 优先、旧 sibling slot 恢复、root-local live runtime 缺少 `runtimeStoragePath` 时不会被当前同 root slot 隐式接管；`single-to-multi-root-real-reopen` 真实 smoke 在最新 attach kind guard 与降级逻辑后复跑通过，并校验 setup 与 verify 阶段的 workspaceStorage slot name 一致。真实 VSCode smoke 已新增并通过 `multi-root-real-reopen`、`single-to-multi-root-real-reopen` 与 `two-window-shared-runtime`，覆盖 multi-root 窗口重启恢复、单根创建后 multi-root 重启恢复、离线输出可见、重连后输入继续作用同一 session、使用 root-local `runtimeStoragePath` 而不是当前 multi-root workspace storage，以及两个独立 VS Code 窗口同时 attach 同一 Agent/Terminal runtime 的双向 output 多播、双向 input、Terminal resize last-writer-wins、第二窗口 stop Terminal 和 delete Agent 后第一窗口收到非 live 终态。root section 参与全局 fit view 与 MiniMap 的导航增强已在 `docs/exec-plans/completed/canvas-spatial-fit-minimap.md` 中完成并记录定向验证。全量 Webview Playwright 仍有与本功能无直接关系或 lifecycle 断言口径相关的失败，需要后续按 Webview lifecycle / 截图基线测试口径单独收口。
