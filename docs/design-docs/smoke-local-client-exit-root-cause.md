---
title: SSH 发布门禁的本地后代进程 ESRCH 根因
decision_status: 比较中
validation_status: 已验证
domains: [VSCode 集成域, 执行编排域]
architecture_layers: [宿主集成层, 适配与基础设施层]
related_specs: [docs/product-specs/runtime-persistence-modes.md]
related_plans: [docs/exec-plans/completed/smoke-local-client-exit-investigation.md]
updated_at: 2026-10-14
---

# SSH 发布门禁的本地后代进程 ESRCH 根因

## 问题与范围

PR #332 合并后，发布 PR #327 基于最新 main 重跑完整门禁，在 `remote-ssh-real-reopen-exit` 的本地客户端清理处失败。用户本轮要求定位；本文记录根因和候选修复边界，尚未实施正式修复。`已验证` 只指因果实验已完成，不表示发布门禁已通过；`比较中` 表示修复方案尚未实施与验收。

正式首败 run 为 [38539427680](https://github.com/ZY-WANG-0304/dev-session-canvas/actions/runs/38539427680)，job `115772638697`，输入为 main `f3bb442526b1f5eb57171a5b24c9a6bca868756f` 与发布 head `cfe1ab40e121bc31689f474e2e6f7cbb9bad4f48` 的预合并 `b0198184496f30fc45532963998a2ae0aab16cb2`，tree `2233605b6e660fd48da8bd3bb7310d579f3e47fc`。Node22、Ubuntu22.04、VS Code1.141.1。

## 已确认的根因

`tests/vscode-smoke/remote-host-control.cjs` 的 `abortLocalClient` 先核验根进程和后代身份，第 109 行向根发送 SIGKILL，随后第 112 行异步读取后代 `/proc/<pid>/stat`，第 113 行检查 PID/startTicks 和非 Z/X 状态，第 114 行发送 SIGKILL。检查与发信号之间，后代仍能退出并被回收。此时真实内核 `kill` 返回 ESRCH（找不到目标），函数没有处理这个已消失状态，直接抛错，未执行后续退出确认。

首败日志为 09:26:36.916Z setup ready，09:26:37.123Z 本地 spawn 返回 SIGKILL，09:26:37.299Z 报 `kill ESRCH`，栈准确落在第 114 行的后代信号。异常不是第 109 行根信号，也不是 `terminatePrivateHost` 的旧远端 Host 信号。代码只有身份相同、快照为非 Z/X 才会到达第 114 行，因此可以确认快照检查通过后发信号已找不到目标；原 CI 未记录失败后代 PID/startTicks/角色，具体哪一个后代及其退出触发原因未知。

这是测试夹具把正常可发生的清理竞争当作异常的缺口。先杀根后后代可能自行退出，与这个窗口吻合，但不能由此补造本次 CI 的具体角色或退出因果。当前证据不归因于 VS Code/Remote SSH 的产品缺陷。延长 ready、恢复、resize 或清理预算不能处理即时抛出的 ESRCH。

## 受控验证

实验逐字加载当前实际 helper，没有复制 `abortLocalClient`，没有修改正式源码或上游缓存。main、失败发布 head 与实验 helper 的 SHA256 都是 `656a9e734f9feb6d14d601a018aead91349d706ea32ea207d7c065bef439792f`。脚本、结果与首败摘录在 [诊断证据](../references/smoke-local-client-exit-investigation/README.md)。

内存 `/proc` 对照覆盖正常后代、读前消失、Z/X、PID 已替换、读后消失、EPERM、根 ESRCH，以及信号返回后后代仍运行。正常/读前消失/Z/X/新身份完成清理；读后消失稳定在原第 114 行 ESRCH，100/100；EPERM 与根 ESRCH 保持失败；仍运行保持退出后置条件失败。它证明状态读取成功并不保证接下来的信号成功。

真实 Linux 对照由 Python 收养并回收本实验孤儿后代，执行真实 fs/stat 和 process.kill：正常场景 root/leaf 均实际 SIGKILL，原 helper 完成且孤儿被回收。竞态场景 root 实际 SIGKILL；leaf 的实际 stat 读取为同 startTicks 的 S，屏障允许它 exit0 并等待 waitpid 完成，确认 `/proc` 已消失后将刚读到的 live 内容交回原 helper；原第 114 行实际内核 kill 返回 ESRCH。该屏障固定可达时序，证明机制，不代表复现了原 CI 的自然角色或触发概率。

既有 `scripts/test/test-smoke-remote-host.mjs` 的 18 项回归原样通过。唯一真实本地客户端用例启动没有后代的 Node 进程，不进入第 114 行，因此历史绿色未覆盖该竞争。git blame 确认这段完整进程树逻辑由 #328 的 `9daf705412506775dfe7543e55e0d7eb575498c7` 引入；#329/#332 未修改这里。此前固定输入通过的记录保持为历史证据。

## 与业务验收的边界

`scripts/smoke/run-vscode-smoke.mjs:688` 只有在 `abortLocalClient` 返回后才检查旧远端 Host retain；exit 分支随后才主动结束旧 Host，再释放独立终端完成信号、启动 verify 和验收原会话恢复/输入/resize。本次失败在建立本地异常断连前提的清理阶段，未触达这条业务验收链。

本次正式 run 已通过六平台原生资产组装、静态/发布回归、Marketplace 及其20项回归、本地 smoke、旧升级含 resize、普通/多 root/共享双窗口重开、fake systemd 和提交前 unavailable fallback。SSH exit/retain 业务验收、完整 Webview、clean-checkout VSIX 与 packaged smoke 尚未完成。定位测试问题不能宣称剩余功能已通过，也不能拼接旧 run 为本轮完整成功。

## 候选修复与取舍

建议只处理本地后代 SIGKILL 的 ESRCH：记录原目标身份与错误，复查原身份是否已不再运行，继续原有退出后置检查；复查仍为原 live 身份则失败。根进程必须保持本次真实 spawn 和实际 SIGKILL 的要求，EPERM 等其他异常继续抛出，UID、私有作用域、PID/startTicks 核验和清理总预算保持。不能宽泛吞掉所有 kill 异常或仅凭错误就跳过最终确认。

回归应覆盖后代身份检查后消失的时序，以及检查前消失、僵尸、新身份、正常信号、权限异常、根异常和信号后仍运行；正式修复还需原生 SSH exit/retain 两分支，并在最新 main 与 #327 预合并结果上重跑完整发布门禁。本轮未实施该候选方案，未修改 helper、发布 PR 或创建新 PR。

## 证据保留

原完整日志 13,552,518 bytes，SHA256 `5518ea6b22c6aaa7ae7924f51566ecf6c36cfe1f6945bb4e85f241c580cce5e8`，本地位于 `/tmp/pr327-after332-gate-38539427680/verify-full.log`。run artifact 清单只有原生资产及其构建证据，没有 verify 阶段的后代身份现场；未从日志猜测失败 PID。诊断只保存小段错误栈和隔离实验结果，不复制完整环境信息。
