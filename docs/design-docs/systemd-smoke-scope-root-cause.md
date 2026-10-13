---
title: fake systemd 重开门禁后端不匹配根因调查
decision_status: 待探索
validation_status: 验证中
domains: [VSCode 集成域, 执行编排域]
architecture_layers: [宿主集成层, 适配与基础设施层]
related_specs: [docs/product-specs/runtime-persistence-modes.md]
related_plans: [docs/exec-plans/active/systemd-smoke-scope-root-cause.md]
updated_at: 2026-10-13
---

# fake systemd 重开门禁后端不匹配根因调查

## 问题与范围

组合PR330固定08f7b0a5的Release Preflight run38387068827/job115263574447，在systemd-user-real-reopen setup断言agent runtime backend失败：实际legacy-detached，预期systemd-user。完整门禁失败，后续fallback/SSH/Webview/VSIX未触达。PR329的links/checkpoint两处修复已通过，不能将后续失败视为旧根因仍未解决。

## 当前判断

scripts/smoke/run-vscode-smoke.mjs以fake-systemd/systemctl.cjs替代提交命令，提供systemd-user override与success模式；runtimeRootPreparation.ts却在提交前调用runtimeSystemdEnvironment.ts的真实/usr/bin/systemd-run核对执行环境。该probe不会读取systemctl shim。原VSCode日志显示场景继承DBUS_SESSION_BUS_ADDRESS=disabled:和自有XDG_RUNTIME_DIR。具体scope返回reason、是否复用已有owner、preferredBackends与选择结果尚未记录，当前仅为候选原因。

候选分别为真实user bus不可用、manager执行环境与Host摘要不一致、backend override未进入新请求，或之前存量owner提前发现。先固定输入观察真实scope与选择链路，不能把缺失历史观测补造成历史事实。该任务不改生产fallback规则或测试backend断言，也不进行正式修复。

## 验证方法

docs/exec-plans/active/systemd-smoke-scope-root-cause.md覆盖源码跟踪、干净runner原场景有限trace、真实函数正反对照和证据归档。诊断固定08f7b0a5及原run同输入六平台native资产；只跑原systemd-user场景，仍保留预算与断言，注入后返回原值。结果另记，不替原完整失败或PR327最新正式发布门禁。
