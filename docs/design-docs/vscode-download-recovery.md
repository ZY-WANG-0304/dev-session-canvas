---
title: VSCode 下载异常的进程隔离与有界恢复
decision_status: 已选定
validation_status: 验证中
domains: [VSCode 集成域]
architecture_layers: [适配与基础设施层]
related_specs: []
related_plans: [docs/exec-plans/active/vscode-download-recovery.md]
updated_at: 2026-10-23
---

# VSCode 下载异常的进程隔离与有界恢复

## 背景

用户在完成前三项下载缓存修复后，授权处理第四项异常捕获与有界恢复。原CI39920907930的notifier-locale只记录attempt1开始，随后Node因未处理的ECONNRESET拒绝退出，原downloadFixedVSCode的catch未获得失败结果。依赖库unzipVSCode先创建validateStream的Promise，再等待解压，最后才await校验；流异常可使校验Promise在被等待前拒绝。这解释了一条与日志相符的异常逃逸路径，但不证明历史CI具体触发点或底层网络原因。

## 正式方案

scripts/smoke/download-vscode.mjs保留三次上限、250/500ms间隔、固定版本、原绝对期限及错误分类。实际默认下载改由downloadVSCodeAttempt启动scripts/smoke/download-vscode-attempt.mjs；每次尝试都是独立进程组，内部依赖库重试一律拒绝，以免三次外层预算放大。

单次worker以同步JSON文件记录成功或错误。它的uncaughtException和unhandledRejection处理器只负责记录并立即失败退出，不在异常后的进程继续下载。正常Promise失败也走同一个失败结果。主进程通过现有runProcess确认退出和清理，再读取结构化结果；不从stderr猜测是否网络错误，不将未知退出、超期、取消、取证错误或清理失败当成可重试网络错误。错误恢复保留AggregateError的每个原因和TimeoutError类型；网络分类集合不扩大，混合语义错误继续拒绝。

worker继承原版本、cache及绝对deadline；自己的期限看门狗会终止进程组，父CLI收到SIGTERM/SIGINT也通过AbortController取消活动worker，防止嵌套进程组在外层退出后继续下载。每次请求timeout不超过原30秒，父进程强制原总deadline，耗尽后不再尝试。失败回执附带原错误来源和进程退出/清理观察。工具缓存与已完成前三项修复保持；不更新下载库，不修改产品测试或扩大业务重试。

## 验证边界

本轮用户要求实现，未另行要求新增或执行测试。只做源码与语法检查，实际断流、清理及跨平台恢复仍需独立验证；不能把实现完成写成原ECONNRESET网络根因已修复。已有固定下载合同通过依赖注入检查上限与分类，可供后续定向验证；新增进程边界还需要真实worker故障覆盖。

实现后两个脚本的Node语法检查和git diff --check通过；没有运行网络下载或故障注入测试。

补充验证：840b06b2 的真实父/worker进程经受控依赖注入通过未处理断流后成功、持续断流三次失败、非网络校验失败及无回执退出四组验证；清理回执均通过。脚本和原结果见[本地受控证据](../references/vscode-download-recovery/README.md)，不代证外部服务或跨平台CI。
