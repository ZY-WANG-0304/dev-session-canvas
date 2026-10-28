---
title: 真实 Agent TUI 的独立回合判定与 CI 覆盖
decision_status: 比较中
validation_status: 未验证
domains: [执行编排域, VSCode 集成域, 画布交互域]
architecture_layers: [宿主集成层, 画布呈现层, 适配与基础设施层]
related_specs: [docs/product-specs/runtime-persistence-modes.md]
related_plans: [docs/exec-plans/active/smoke-real-tui-coverage.md]
updated_at: 2026-10-28
---

# 真实 Agent TUI 的独立回合判定与 CI 覆盖

## 问题与目标

补齐 `agent-tui/input-during-work`、`answer-with-footer`、`tool-network-silence`、`turn-completion-redraw` 四项缺口，在 CI 中真实执行交互式 Codex/Claude。输入区可用、回答可见和回合完成是不同事实；fake prompt、非交互 exec/-p、末行文本或产品 waiting-input 都不能代证真实回合完成。

## 候选与边界

优先研究只读 CLI 会话记录及明确的当前回合结束事件；候选 hook 必须确认其调用时机、失败和重入语义。响应流结束只证明一次请求结束，可能还需工具和后续请求，不能单独定义整个回合完成。具体信号待固定 CLI 版本实证后选定。

沿用固定 Codex 0.157.1、Claude 2.1.280 及 DeepSeek backend 的私有配置，测试的是这些真实 CLI 配合该 backend 的行为。回答比较使用本次实际生成内容，允许终端折行等呈现差异，不要求跨运行相同文本。随机 marker 用于排除旧内容，不能仅凭用户 prompt 中的 marker 宣告回答成功。

## 验证方法

输入场景先确认工具任务未释放，验证未提交输入出现在真实编辑区且回合仍在运行。footer 场景验证真实回答和其下方的输入区/状态栏同时存在。静默场景用外部握手证明待处理工作未完成，再跨过现有静默阈值观察产品状态。完成重绘场景先确认独立完成事件，随后真实 resize 并核正文、状态和通知无重复。条件未发生是 prepare 失败，不是跳过后通过；四项各自隔离并保留清理结果。

## 当前判断与风险

现有 `.github/workflows/runtime-production-acceptance.yml` 和 `run-vscode-agent-candidate.mjs` 可复用 CLI 供应、凭据隔离与进程观察，但不能直接将既有 natural 用例更名为四项覆盖。普通门禁尚未接入这四项。CLI 信号、默认 CI 平台和运行成本在实证后写入正式方案；不通过放宽状态要求或自动重试使产品误判变绿。
