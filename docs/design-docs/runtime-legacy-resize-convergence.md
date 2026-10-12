---
title: 旧升级 resize 的容器与原会话一致性验收
decision_status: 已选定
validation_status: 已验证
domains: [执行编排域, VSCode 集成域]
architecture_layers: [宿主集成层, 适配与基础设施层]
related_specs: [docs/product-specs/runtime-persistence-modes.md]
related_plans: [docs/exec-plans/completed/runtime-legacy-resize-convergence.md]
updated_at: 2026-10-12
---

# 旧升级 resize 的容器与原会话一致性验收

## 问题与边界

PR #321 后旧升级 smoke 仍可超时。前轮受控 C8 在相同 20 秒等待中固定恢复瞬态 67×21，但 189 次观察的原会话与当前页面都是正确的 82×27。文字可见和原始 xterm 首次尺寸变化都不是容器 fit 完成的证据；精确历史首败缺少 expected probe，不能对其作相同强度的归因。调查输入为 PR #322（d42656f7），其完整文档尚未合并，本修复独立基于 main。

目标是修复这项夹具前提，继续验证原会话输入和真正 resize。未知的 Canvas ready 首败及完整发布门禁保留，不改产品生命周期或后端。

## 候选方案与取舍

追加 sleep 或扩大 20 秒期限不能校验前提。只比较最新页面与进程可能接受旧容器或恢复快照。本方案额外读取容器的 FitAddon.proposeDimensions、投影仍有待应用内容的事实及原会话身份，并核对精确卡片尺寸，以独立布局目标排除瞬态；这些是测试用只读观察，无产品 resize 干预。

## 正式方案

`extensions/vscode/dev-session-canvas/src/common/protocol.ts` 的 WebviewProbeNodeSnapshot 增加可选容器 fit 行列数、terminalProjectionPending（快照/输出尚未应用、写入失败或身份尚未一致）和 terminalExecutionSessionId（原投影会话身份）。`src/webview/main.tsx` 的 readProbeExecutionTerminalState 从已有 FitAddon 和 controller 读取，不触发 fit、snapshot 或消息。无终端/布局不可用时不伪造正数。

`tests/vscode-smoke/terminal-resize.cjs` 在单一期限内逐轮读 Host snapshot、Webview probe 和显式原 socket/session 的 attachSession。成功需 Host 精确卡片尺寸和原绑定、页面原投影且恢复结束、xterm 与容器目标相等、原 Supervisor session/kind/live/输入 marker 及尺寸相等。resize 阶段还要求两节点分别相对已收敛基线改变。等待期间不能靠新 session、旧卡片或随时间变动的任意尺寸满足验收。最后一次读取超出期限仍失败。

`legacy-supervisor-upgrade-tests.cjs` 先在修改前建立一致性基线，再沿用原输入和精确卡片目标，在共同 20 秒预算内验收两原会话。保留后续新 root、旧 registry、旧进程正常退出和新会话继续运行断言。

清理前 best effort 保存目标、基线、采样时间、Host/page/原 session 尺寸及 identity，另存 Host snapshot 和原诊断事件；本夹具另记两次 resizeNode 派发时间及目标。证据失败不覆盖原失败，也不阻止原 finally 清理。

## 验证方法与未确认内容

确定性 helper 测试涵盖瞬态序列、真实漏 resize、旧卡片、恢复、缺 marker、错误身份、期限及诊断回调失败；浏览器在 Agent/Terminal 真实 xterm parser 暂停中观察目标与瞬态区分；原生执行标准场景和受控 fit 延迟。标准原生 N1/N2 和受控 fit 延迟 C3 均完整通过；C3 在新卡片上首次取样仍为 67×21，但容器 Agent 82×27、Terminal 85×28，19 次取样/1925ms 后原会话与目标全部一致。只丢弃目标 Agent resize 的 M1 在 20 秒内按预期失败，191 次样本最后为页面/容器 82×27、原 Agent 67×21，Terminal 正确；四项失败工件成功保存。9 项 helper、协议校验、50 项真实控制器/10 项 Host batch、8 项浏览器恢复/fit 回归、类型和构建均通过。

投影 pending 字段也覆盖未应用输出、写入失败、停止释放和 identity 不一致，避免只凭 queuedWriteCount=0 判定恢复成功。浏览器/控制器开发期间的夹具错误、页面崩溃/probe 首败和 staging ENOSPC 均记录于 `docs/references/runtime-legacy-resize-convergence/evidence.json`，不以重跑通过追认原因。最后只新增 resizeNode 派发时间字段后做语法/diff 校验，未改变验收和产品。未重跑完整 npm test/发布门禁。Canvas ready 根因仍未确认，当前 fallback fixture 已捕获 Host diagnostics，后续重现仍需 iframe 资源与脚本证据。
