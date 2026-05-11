---
title: 模板市场长期特性分支策略
decision_status: 已选定
validation_status: 验证中
domains:
  - 项目状态域
  - VSCode 集成域
  - 画布交互域
architecture_layers:
  - 适配与基础设施层
  - 宿主集成层
  - 画布呈现层
related_specs:
  - docs/product-specs/canvas-template-feature.md
related_plans: []
updated_at: 2026-05-11
---

# 模板市场长期特性分支策略

## 1. 背景

模板市场不是一个可以一次性收口的小功能。它会涉及市场浏览、模板安装、远端数据、认证、治理、发布文案、插件入口和 Webview 体验等多条路径。如果把未完成实现直接合入 `main`，主线版本会在市场能力尚未完整验证时暴露半成品入口，影响可发布性和回滚边界。

本文中的“模板市场”不等于画布模板功能本身。普通、非复杂的模板功能更新仍按短生命周期主题分支处理，从最新 `main` 切出并合入 `main`；只有模板市场相关功能或未完成行为需要进入本策略定义的长期特性集成范围。

因此，模板市场需要一个长期集成通道来承载阶段性实现，让相关工作可以持续集成、持续 review，同时不把未完成行为带入主线。

## 2. 问题定义

本策略需要明确以下问题：

- 模板市场开发期间，相关子主题分支应合向哪里。
- 如何区分普通模板功能更新与模板市场特性，避免把两者混成同一个目标分支规则。
- 长期特性分支与 `main` 如何同步，避免共享分支因 rebase 改写历史。
- `feature/templates-marketplace` 远端分支应按什么顺序和基线创建，避免把尚不存在的远端分支写成已可用事实。
- 哪些改动可以提前进入 `main`，哪些必须留在特性分支直到总体验收完成。

## 3. 目标

- 让 `main` 保持稳定、可发布，不默认暴露未完成的模板市场能力。
- 让模板市场相关实现有统一目标分支，避免多个半成品 MR 分散合入主线。
- 明确模板功能本身和模板市场特性的不同分支规则：前者默认合入 `main`，后者在集成分支创建后合入 `feature/templates-marketplace`。
- 保持后续回滚和验收边界清楚：模板市场完成前看 `feature/templates-marketplace`，完成后再整体或分阶段合回 `main`。
- 让协作者能从 `docs/WORKFLOW.md` 和 `docs/workflows/BRANCH.md` 直接判断 MR 目标分支。

## 4. 非目标

- 不改变普通功能、bugfix 或发布准备分支默认合入 `main` 的规则。
- 不要求普通模板功能或所有模板相关基础设施都滞留在特性分支；默认关闭、可独立验证、可回滚的基础设施仍可单独合入 `main`。
- 不把 `feature/templates-marketplace` 当成发布输入；正式发布仍必须来自已经合入 `main` 的内容。

## 5. 候选方案

### 5.1 直接把模板市场子功能持续合入 `main`

这个方案集成成本最低，但会让未完成 UI、安装流程或远端服务依赖提前进入主线。即使通过 feature flag 规避入口暴露，多个尚未验收的改动也会分散在 `main` 历史里，后续延期或回滚成本高。

结论：不采用作为模板市场开发期默认策略。

### 5.2 使用共享长期特性分支

这个方案以 `feature/templates-marketplace` 作为模板市场集成分支。模板市场相关功能或未完成行为子主题分支先合入该分支，普通模板功能更新仍合入 `main`；`main` 还可以接收默认关闭、可独立验证、可回滚的基础设施改动。模板市场达到验收条件后，再由 `feature/templates-marketplace` 通过 MR 合回 `main`。

结论：采用。

### 5.3 所有实现留在个人分支直到最后一次性合并

这个方案能保护 `main`，但会削弱持续集成和 review，最后合并时容易出现巨大冲突、重复设计讨论和难以定位的行为回归。

结论：不采用。

## 6. 风险与取舍

- 风险：长期特性分支如果长期不追赶 `main`，最终合并成本会升高。缓解方式是定期把最新 `main` merge 到 `feature/templates-marketplace`。
- 风险：共享分支 rebase 会影响已经基于它开发的子主题分支。缓解方式是明确禁止对 `feature/templates-marketplace` 做 rebase 或强制推送。
- 风险：过多基础设施留在特性分支会拖慢主线可复用改进。缓解方式是允许默认关闭、可独立验证、可回滚，且即使模板市场延期也仍有价值的基础设施先进入 `main`。
- 风险：模板市场合回 `main` 时范围过大。缓解方式是在 `feature/templates-marketplace` 内持续拆小 MR，并在最终合回前同步产品规格、设计文档、ExecPlan 和验证证据。

## 7. 正式方案

模板市场开发期的共享集成分支登记为 `feature/templates-marketplace`。该集成分支首次创建时，以本分支策略合入后的 `origin/main` 为基线创建远端 `origin/feature/templates-marketplace`；在远端分支实际存在前，不把模板市场子主题 MR 的目标分支设为该分支。

核心规则如下：

- 普通、非复杂的模板功能更新从最新 `main` 切出，并把 MR 目标分支设为 `main`。
- 模板市场相关功能或未完成行为子主题分支，在远端集成分支创建后，从最新 `feature/templates-marketplace` 切出，并把 MR 目标分支设为 `feature/templates-marketplace`。
- `feature/templates-marketplace` 是共享 integration branch，创建基线为本分支策略合入后的 `origin/main`；创建后不执行 rebase，不强制推送；需要追赶主线时，在该分支上 merge 最新 `main`。
- 集成分支创建后，个人或短生命周期子主题分支可以 rebase 到最新 `feature/templates-marketplace`，再发起或更新 MR。
- 对属于模板市场范围的工作，`main` 在模板市场完成前只接收默认关闭、可独立验证、可回滚的基础设施改动；未完成市场入口、安装主流程、远端服务依赖、治理后台和发布口径不得直接暴露到 `main`。
- 模板市场完成后，由 `feature/templates-marketplace` 发起合回 `main` 的 MR；如范围仍过大，应按已验证的子能力分阶段合回，但每个阶段都必须保持 `main` 可发布。

文档落点如下：

- `docs/WORKFLOW.md`：记录交付性工作在长期特性集成分支下的目标分支、同步和合回规则。
- `docs/workflows/BRANCH.md`：登记 `feature/templates-marketplace`，并说明它是共享长期特性集成分支。
- `docs/workflows/MR_CREATE.md`：要求非 `main` 目标分支的 MR 描述写明目标分支和依据。
- `docs/workflows/MR_MERGE.md`：明确 reviewer 合并到当前 MR 目标分支，而不是机械地直接合入 `main`。

## 8. 验证方法

本策略通过文档一致性检查验证：`docs/WORKFLOW.md`、`docs/workflows/BRANCH.md`、`docs/workflows/MR_CREATE.md`、`docs/workflows/MR_MERGE.md` 与本设计文档必须对普通模板功能、模板市场特性、`feature/templates-marketplace` 创建基线、rebase/merge 边界和最终合回 `main` 的规则保持一致。

后续当模板市场子主题 MR 创建时，应在 MR 描述中写明目标分支为 `feature/templates-marketplace`；当模板市场最终合回 `main` 时，应在 MR 描述中列出总体验收证据和仍需跟进的非阻塞风险。
