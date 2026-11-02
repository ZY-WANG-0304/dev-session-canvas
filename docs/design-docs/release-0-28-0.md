---
title: 0.28.0 画布交互与文件活动退役里程碑发布范围
decision_status: 已选定
validation_status: 验证中
domains: [项目状态域, 画布交互域, 协作对象域, VSCode 集成域]
architecture_layers: [宿主集成层, 画布呈现层, 共享模型与编排层, 适配与基础设施层]
related_specs:
  - docs/product-specs/canvas-core-collaboration-mvp.md
  - docs/product-specs/canvas-node-groups.md
  - docs/product-specs/canvas-graph-links-and-file-activity.md
  - docs/product-specs/agent-terminal-clipboard-shortcuts.md
related_plans:
  - docs/exec-plans/active/release-0-28-0-prep.md
  - docs/exec-plans/active/node-group-title-edit-action.md
  - docs/exec-plans/active/codex-cli-side-shortcut-repair.md
  - docs/exec-plans/completed/canvas-remove-file-nodes.md
updated_at: 2026-11-02
---

# 0.28.0 画布交互与文件活动退役里程碑发布范围

## 背景

公开的 `0.27.0` 已于 2026-10-30 发布。其后 `origin/main` 合入节点和普通分组标题编辑入口（#351）、Codex CLI `Ctrl+/` 输入映射修复（#355），以及退役自动文件活动和文件节点（#356）。同一时期的发布工具与 CI 改造不改变产品行为，不列入用户功能说明。

## 问题定义

需要把 `0.27.0` 之后已合入主线的产品变化形成一致的公开版本输入，并明确旧画布清理会移除哪些派生状态、哪些独立文件能力仍保留，以及哪些交互验证仍受真实宿主或真实 CLI 条件限制。

## 目标与非目标

目标是同步发布主扩展和 notifier `0.28.0`，说明可编辑标题的新入口、执行终端对 `Ctrl+/` 的输入映射，以及自动文件活动功能退役和旧状态清理边界；保持 Preview 身份、扩展身份、安装关系和支持承诺不变。

本版不改变 notifier 的投递后端、通知协议、点击回跳或本地化行为；不改变模板市场服务部署版本线；不把发布工具 / CI 重构写成用户功能；不宣称真实 Codex CLI PTY 或完整真实 VS Code 无障碍矩阵已通过。

## 候选方案与取舍

- `0.27.1` 补丁版：适合只包含同一里程碑内修复、兼容性或打包收口的版本，但会低估新增标题编辑入口和自动文件活动功能退役这组用户可见变化。
- `0.28.0` 新里程碑：符合 `docs/workflows/VERSION.md` 中 `0.x.0` 表示新对外里程碑的规则，也让新增交互与功能退役在升级说明中显式呈现。

## 正式方案

采用 `0.28.0`。从最新 `origin/main` 的产品内容发布，根 `package.json`、主扩展和 notifier manifest、lockfile、两个 CHANGELOG、英中文 README / Marketplace listing、发布手册与 `docs/release-contracts/v0.28.0.md` 必须一致。主扩展和 notifier 继续同版本；notifier 只同步版本和发布说明，不暗示其自身行为变化。

用户可见范围如下：

1. `Agent`、`Terminal`、`Note` 和普通用户分组通过标题文字尾部的编辑图标改名；标题文字保留选择、拖动或聚焦语义。workspace root 与只读投影不提供该入口。
2. 执行终端在当前实际输入字符为 `/` 时，将聚焦 xterm 上的 `Ctrl+/` 映射为 ASCII US（`0x1f`）送入现有 PTY 通路；保留既有 `Ctrl+C` 打断语义。真实 Codex CLI PTY 尚未验证，发布文案和契约不得把该输入映射扩写成已完成的真实 CLI 端到端验收。
3. 退役 Claude 文件活动采集、自动 `file` / `file-list` 节点、过滤设置与专属关系。读取旧画布时清理这些派生记录、相关自动节点 / 边和失效分组成员，同时保留其他节点、普通连线、分组、会话身份及磁盘文件。终端文件链接、Markdown Note 文件关联、Explorer 创建执行节点和普通手工连线继续支持。迁移写回后，旧文件活动数据不保证可降级恢复。

发布输入以本文件和 `docs/release-contracts/v0.28.0.md` 为静态范围；最终门禁、批次与渠道执行遵循 `docs/WORKFLOW.md`，不重打包或改写已验收批次。当前变更的 PR / 单项验证只作为局部证据，正式发布仍要求最新预合并输入及最终产品输入各自满足完整门禁。

## 风险与边界

- 标题图标的 Playwright / CI 覆盖不等于真实 VS Code 中的键盘焦点、高对比主题和宿主持久化人工验收。
- `Ctrl+/` 映射的浏览器输入回归不等于真实 Codex CLI 将 `0x1f` 解释为 `/side`；相关验证缺口继续显式保留。
- 文件活动升级清理是有意的数据兼容行为：旧自动活动状态及其派生画布对象会消失，但磁盘文件和列出的独立文件能力不受影响。
- 现有公开 Preview、平台、运行时恢复和跨版本回退限制继续生效；不因本轮功能或 CI 覆盖扩大支持承诺。

## 验证方法

发布准备 PR 以最新 `origin/main` 为目标，并使用仓库 `Release Preflight` 对真实预合并 SHA 执行静态契约与完整 `release-pr` 任务图；版本合并后的产品 SHA 仍须独立通过 `release-tag` 批次验收，之后才可用固定批次进行渠道发布。所有状态以本次确切输入的 Actions 证据为准，历史门禁和本地 `acceptance: false` 输出不能替代正式验收。
