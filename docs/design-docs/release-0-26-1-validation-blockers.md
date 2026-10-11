---
title: 0.26.1 最新主线发布验证阻塞
decision_status: 待探索
validation_status: 验证失败
domains: [执行编排域, VSCode 集成域]
architecture_layers: [宿主集成层, 画布呈现层, 适配与基础设施层]
related_specs: [docs/product-specs/runtime-persistence-modes.md]
related_plans: [docs/exec-plans/completed/release-0-26-1-latest-main.md]
updated_at: 2026-10-11
---

# 0.26.1 最新主线发布验证阻塞

## 背景与范围

PR #317 从 origin/main a39cd8c1 独立准备 0.26.1，已纳入 #314 至 #316。静态材料完成，完整门禁仍未通过，PR 保持草稿。0.26.0 的授权例外不适用。发布契约只写静态范围，本文件与执行计划记录实际失败；不扩大此前有限验收或把测试修正追认为产品通过。

## 已确认事实与未知项

双窗口场景先暴露连续创建的启动前提缺口，修正为先确认原 Agent live 后创建 Terminal；第二轮固定目录复用出现旧 registry session 与新绑定不一致，runner 改为遵循全局独立 debugRoot。新路径 /tmp/d26lrest3 的运行已经通过 owner 创建、第二窗口附着、双向输入、resize 和 Terminal 停止，但附着窗口删除 Agent 后，owner 在原 30 秒预算内仍报告相同 Agent runtimeSessionId 为 live/waiting-input，未到达原 stopped/history-restored 且无 runtimeSessionId 的断言。失败在 two-window-shared-runtime-tests.cjs 的 runOwnerWindow 第 174 行；不能通过移除 owner 断言、重新载入或延长超时收口。实际删除责任、跨窗口观察与终态投影的根因待确认。

systemd-user-real-reopen 的 setup 已成功并退出，verify 在等待 editor Canvas 就绪时 20 秒超时，尚未完成原会话恢复验收。后续 systemd-fallback 与 Remote SSH 没有执行。不能仅因 setup 成功就宣布 systemd 重开通过，后端是否影响 Canvas 就绪仍未知。

Webview 全套 423 passed / 1 failed，失败用例为 embedded xterm theme follows workbench theme changes；实际失败发生在 openHarness 的 5 秒 ready 等待，尚未进入颜色断言。保存首次 trace/截图后，按原参数隔离复跑 1 passed，不改基准或等待预算。根因未确认，完整套件首次失败仍有效；隔离通过不代证完整门禁。

## 已完成的准备修正

completed-history 回归精确检查新增删除边界诊断；旧升级 fixture 新会话按 root socket 地址连接，旧会话仍按旧地址；checkpoint smoke 等全部状态 chunk 到达再断言完整长度。真实重开 fixture 逐次确认原会话启动。这些修改保留原身份、输出、停止、完整性和真实重开断言，不修改产品或准入配额。

PR/tag 双阶段 workflow 在 npm ci 后安装 Chromium 与系统依赖，统一浏览器缓存，并给市场 Host 使用 /tmp/tm-runId 短临时目录。两个 workflow 回归通过；此前 CI 缺浏览器及 Unix socket EINVAL 的失败记录保留。旧 always() job 阻塞新 run 时仅结束已核对的过期运行，不计为通过。解除草稿后仍须对最新预合并结果执行完整 verify，不能用草稿 skipped 结果替代。

## 证据与后续验证

本机日志为 /tmp/dsc261latest-reopen-rest-isolated.log、/tmp/dsc261latest-platform-smoke.log、/tmp/dsc261latest-webview-final.log 和 /tmp/dsc261latest-theme-recheck.log。双窗口工件在 /tmp/d26lrest3/two-window-shared-runtime/owner/artifacts，systemd 工件在 /tmp/d26lplat/systemd-user-real-reopen/artifacts，首次主题 trace/截图在 /tmp/dsc261latest-theme-first-failure。完整执行过程与此前输入 SHA 见关联 ExecPlan。

后续须分别定位两个宿主失败，保护原 runtime/node 身份与跨窗口责任；若需要产品修复，先建立独立调查/实现计划并同步对应正式设计。修复后重跑具名场景、Webview 全套、最新预合并 release:verify 与最终 publish tag verify。真实市场安装、桌面通知点击、标题栏人工复现和既有跨平台/真实 provider 限制不由本机 staged 证据代证。
