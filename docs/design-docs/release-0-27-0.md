---
title: 0.27.0 执行可靠性与共享画布里程碑发布范围
decision_status: 已选定
validation_status: 验证中
domains: [项目状态域, 执行编排域, 画布交互域]
architecture_layers: [宿主集成层, 共享模型与编排层, 适配与基础设施层]
related_specs: [docs/product-specs/runtime-persistence-modes.md, docs/product-specs/canvas-core-collaboration-mvp.md]
related_plans: [docs/exec-plans/active/release-0-27-0-prep.md]
updated_at: 2026-10-30
---

# 0.27.0 执行可靠性与共享画布里程碑发布范围

## 背景

公开的 `0.26.0` 于 2026-10-08 发布。之后 main 累积了执行生命周期、持久化模式切换、同 root 多窗口画布同步、失联节点清理和删除反馈等一组相互关联的改进。已有发布准备 PR #327 将这批变化按 `0.26.1` 补丁版收口，但用户已决定由于整体调整和重构较多，改以 `0.27.0` 新里程碑发布，并关闭旧发布 PR。

用户还报告最近两天试用没有发现明显问题；试用构建、平台与场景没有指定，因此该反馈只提供定性信号，不扩大正式验证范围。

## 问题定义

需要确定此次已合入 main 的变化是否作为同一个公开 Preview 里程碑发布，并让版本、用户文案、支持边界和正式验证输入表达同一范围。发布材料不得把 CI 门禁改造、测试夹具调整或单个平台验收写成用户新功能，也不得把局部试用写成跨平台兼容承诺。

## 目标与非目标

目标是发布主扩展和 notifier 同步版本 `0.27.0`，准确说明 0.26.0 之后的执行可靠性改进、持久化模式切换和同 root 多窗口共享画布，并覆盖用户可见的失联节点和删除过程反馈；明确安装、升级、回退与剩余限制；让正式发布 PR 和最终发布 tag 都执行完整固定输入验收。

本次不改变公开 Preview 定位、扩展身份、用户设置、notifier 投递行为、模板市场服务部署版本线、支持平台承诺或发布渠道完成规则，也不合并、打 tag 或实际发布扩展。

## 候选方案与取舍

继续用 `0.26.1` 补丁可以降低改号范围，但会把同 root 共享画布、持久化模式切换和多项生命周期重构一起压入原补丁语义。采用 `0.27.0` 符合 `docs/workflows/VERSION.md` 对 `0.x.0` 新里程碑的定义，也与用户明确的发布意图一致。`1.0.0` 不合适，因为 Preview 定位和支持承诺没有改变。

## 正式方案

从最新 `origin/main` 创建独立发布准备分支，三个 workspace 版本（根 package、主扩展、notifier）、lockfile、两个 CHANGELOG、英文和中文 README / Marketplace 文案、发布手册、支持边界和 `docs/release-contracts/v0.27.0.md` 一致使用 `0.27.0`。释放范围以该契约为准，用户说明集中于同 root 多窗口共享与模式切换、启动和终端交互可靠性、删除中的交互锁定、失联节点移除、Unix socket 修复及停止未确认提醒。

相关代码已在 main；本分支只更新静态发布输入与本设计和计划记录。notifier 继续跟随主扩展版本，不新增通知后端、协议、点击语义或本地化行为。内部 CI 调整和测试改动仅作为发布门禁的一部分验证，不出现在产品功能列表。

公开 Preview 的原有限制继续生效，包括 Supervisor 或机器故障后的恢复不保证、资源无固定硬配额、共享/私有切换不迁移内容、失联后台可能继续运行、Unix 修复不热更新旧 Supervisor、部分 VS Code 重开加载延迟、现代系统以外与 musl 支持未验证、Windows Codex 历史翻页限制、Restricted Mode 执行禁用及 Virtual Workspace 不支持。

## 验证方法

发布准备 PR 必须基于最新目标分支，在真实预合并 SHA 上由 Release Preflight 执行静态契约检查和完整 `release-pr` 任务图；更新 PR 后必须重新验证新 head。只有 Actions 工件来源、任务集合、原样双包和稳定 required check 全部通过并获 review 后，发布 PR 才可合并。之后最终 main release commit 仍须独立通过 `release-tag`，再由用户单独授权 tag 与外部渠道发布。

手动两天试用只记录为用户反馈；完整范围以 CI 固定任务图和契约声明为准。用户报告未给出准确构建、宿主、平台或操作矩阵，不据此标记额外平台覆盖完成。
