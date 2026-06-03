---
title: 画布多根 workspace 组合视图规格
status: 已确认
updated_at: 2026-06-04
related_designs:
  - docs/design-docs/canvas-multi-root-workspace-support.md
related_plans:
  - docs/exec-plans/active/canvas-multi-root-composed-canvas-rewrite.md
---

# 画布多根 workspace 组合视图规格

## 背景

用户在 VSCode 中既会单独打开一个工程，也会把多个工程作为 multi-root workspace 一起打开。Dev Session Canvas 应保持同一套 root 心智：单根只显示当前 root 自己的画布，多根显示所有当前 root 的画布内容，并用系统 root section 区分不同工程。

## 用户目标

- 单独打开一个 workspace folder 时，只看到这个 root 自己的画布内容。
- 打开 multi-root workspace 时，看到所有当前 workspace folders 的画布内容。
- 每个 root 都有清晰的系统分组区域，避免不同工程的节点混在一起。
- 在多根画布中整理某个 root 内的节点后，单独打开该 root 仍能看到这些整理结果。
- 移动 multi-root 中的 root 区域只影响多根布局，不改写单根 root-local 节点坐标。
- root 内对象移动到边界外时，root 区域自动扩张，内容不会静默移出所属 root。

## 功能范围

1. 每个 workspace folder 拥有一份 root-local 画布状态。
2. 单根 workspace 读取并写入当前 root-local 画布状态。
3. 多根 workspace 读取所有当前 root-local 画布状态，并组合成一张画布显示。
4. 多根组合视图中，每个 root 显示为一个系统 root section。
5. 系统 root section 可以移动和 resize；移动后只保存多根 overlay 位置，不改变单根 root-local 节点坐标。
6. 系统 root section 不能被删除、取消分组或重命名。
7. root section 是 root-local 内容的硬容器：root 内节点或用户分组移动到边界外时，root section 扩张并继续包含它们。
8. root section 对外作为整体分组参与避让和包含：root section 之间不能重叠，多个 root section 可以被 multi-root overlay 普通分组包含。
9. 在 root section 内创建节点、用户分组、模板内容或关联 Markdown Note 时，新对象写回该 root-local 状态。
10. 执行节点的 `metadata.cwd` 继续作为执行目录权威；拖拽到其他 root section 不静默改写 cwd。
11. 多根组合视图内部使用命名空间避免不同 root 下的节点 ID、分组 ID 或连线 ID 冲突。
12. 多根组合视图中，用户创建或重连连线时，两个端点必须属于同一个 root section；跨 root 连线被拒绝。

## 非目标

- 不实现 root 切换器或独立 workspace 管理器。
- 不实现多根专属的独立画布分支。
- 不实现跨 root Note、跨 root 连线或跨 root 模板捕获。
- 不把包含多个 root 的 multi-root overlay 普通分组写入任一单根 root-local 状态。
- 不支持把 multi-root 组合视图整体保存为模板。
- 不承诺跨窗口共享 live runtime。
- 不在拖拽时自动把执行节点迁移到另一个 root 或改写 cwd。

## 验收标准

- 在单根 `frontend` workspace 中创建一个 Note，关闭后打开包含 `frontend` 与 `backend` 的 multi-root workspace，能在 `frontend` root section 中看到该 Note。
- 在 multi-root workspace 中，每个 workspace folder 都显示一个系统 root section，标题对应 folder 名称。
- 在 multi-root workspace 中移动某个 root section 后重新加载，多根布局保持；单独打开该 root 时，节点仍保持 root-local 相对位置。
- 在 multi-root workspace 中把某个 root 内 Note 拖到 root 边界外后，root section 自动扩张；单独打开该 root 可以看到 Note 的 root-local 位置变化。
- 在 multi-root workspace 中两个同父 root section 不会重叠；选中多个同父 root section 创建普通分组后，外层分组可以包含这些 root。
- 在 multi-root workspace 的某个 root section 内创建 Note / Agent / Terminal / 模板内容 / 关联 Markdown Note 后，单独打开该 root 可以看到对应对象。
- 两个 root 中都存在 `note-1` 或 `agent-1` 时，多根组合视图不会发生节点 ID 冲突。
- 在 multi-root workspace 中，跨 root 画线或把既有连线重连到另一个 root 的节点不会创建或更新连线。
- 创建 `Agent` / `Terminal` 时，节点 `metadata.cwd` 等于目标 root 路径或显式 Explorer cwd。

## 验证状态

截至 2026-06-04，本规格已完成主路径自动化验证：`npm run test:canvas-multi-root-composition`、`npm run test:canvas-node-groups`、`npm run test:canvas-execution-context`、`npm run test:protocol-webview-messages`、`npm run test:canvas-templates`、`npm run test:note-markdown-file-association`、`npm run test:extension-storage-paths`、`npm run typecheck`、`npm run build`、`git diff --check` 和 `npm run test:webview -- --grep "workspace root group|cross-root edge"` 均通过。全量 `npm run test:webview` 当前为 224 passed / 29 failed，失败项不来自新增 workspace root group 用例，但需要后续按 Webview lifecycle/截图基线测试口径单独收口；真实 VSCode multi-root 手动 smoke 尚未完成。
