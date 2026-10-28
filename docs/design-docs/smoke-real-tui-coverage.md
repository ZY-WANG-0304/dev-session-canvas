---
title: 真实 Agent TUI 的独立回合判定与 CI 覆盖
decision_status: 已选定
validation_status: 验证中
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

## 正式方案

现有 `.github/workflows/runtime-production-acceptance.yml` 和 `run-vscode-agent-candidate.mjs` 可复用 CLI 供应、凭据隔离与进程观察，但不能直接将既有 natural 用例更名为四项覆盖。普通门禁尚未接入这四项。CLI 信号、默认 CI 平台和运行成本在实证后写入正式方案；不通过放宽状态要求或自动重试使产品误判变绿。


首批默认矩阵为 Linux、snapshot-only、Codex 0.157.1 与 Claude 2.1.280。四项分别注册到 `scripts/smoke/smoke-catalog.mjs`，每项在单 Host 中顺序运行两份互不共享业务状态的私有 provider fixture；source 和 packaged 均通过 `scripts/smoke/agent-tui-suite.mjs` 执行 `tests/vscode-smoke/agent-tui-tests.cjs`。一份 provider 有独立的 240 秒绝对上限，各内部等待仍有自己的较短期限；此上限不是产品 SLA，实际成本仍待测。

`agent-tui-configuration.mjs` 只在私有配置中注册唯一等待工具和只观察的 hook。工具开始与外部释放绑定 callId，返回随机 receipt，不伪造模型输出。`agent-tui-evidence.cjs` 要求一次精确 UserPromptSubmit、同 workspace/session、未继续的 Stop、先工具结果后完成以及包含新 receipt 的实际回答；Codex 还核对真实 turn_id。Claude 通过私有指定 session 和单次用户提交区分回合。Stop hook 返回空 JSON，不阻断或继续回合；凭据仍在临时私有 home，结束后删除。工具等待期间不产生新正文，TUI 可继续绘制 spinner；此受控条件不宣称验证供应商断网重连。

正文比较只归一化空白与终端零宽字符；要求整个本次回答位于真实输入区上方。输入用例检查随机草稿在 composer 行，且没有第二次 UserPromptSubmit。完成后改变节点尺寸，检查 xterm 列数确实变化，再连续采样状态、回答和通知。原 executionId/generation 全程不变；产品 Stop、原持久化/reader 退役与 Host 清理另行记录。清理错误不覆盖先前业务首败。

CI 在 `ci-validation.yml` 的四项 source/packaged job 安装固定 CLI，只有这些 job 的执行步骤获得 `DEEPSEEK_API_KEY`。调用链从 release-preflight / publish release-validation 显式传递该 secret；缺失、认证失败、目标前提未发生都不能被当作通过。初步回合接口探索 workflow 只提供 acceptance=false 的 CLI 证据，不能替代产品 Host 验收。

## 当前验证证据

Actions 40682240862 的 Codex 私有 PTY 探索已完成真实工具调用、处理中草稿、Stop 回答与 resize 后呈现；并未启动产品 Host。Claude 同轮停在默认选中 No 的 workspace trust 菜单，已按私有空 workspace 明确选择 Yes，并防止菜单光标被当成输入框。四项产品 CI 仍待验。
