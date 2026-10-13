---
title: localhost SSH 真实重开的旧远端 Host 退出调查
decision_status: 比较中
validation_status: 验证中
domains: [VSCode 集成域, 执行编排域]
architecture_layers: [宿主集成层, 适配与基础设施层]
related_specs: [docs/product-specs/runtime-persistence-modes.md]
related_plans: [docs/exec-plans/completed/remote-host-exit-investigation.md]
updated_at: 2026-10-13
---

# localhost SSH 真实重开的旧远端 Host 退出调查

## 问题与授权范围

0.26.1 发布验证首败中，Canvas 已 ready，Agent 与普通 Terminal 恢复；等待旧远端扩展 Host PID 消失的第三终端仍 live，导致“离线期间完成且丢弃历史”的联合断言失败。用户要求先建独立分支定位根因，确认后修复。本轮只交付调查和提案。

## 已确认的直接根因

`tests/vscode-smoke/real-reopen-tests.cjs:148` 的第三终端执行 `while kill -0 <setup Host PID>; do sleep 0.1; done`。`scripts/smoke/run-vscode-smoke.mjs` 的 SSH orchestration 在本地 Electron 返回后固定等待三秒就启动 verify，没有证明旧远端 Host 已消失。因此本地退出但远端仍保留时，第三终端不会结束，verify 的35秒联合断言必然等不到预期的 completed 状态。

发布原首败与 R2 自然复现均为 Canvas generation5 ready/ack=true、Agent 与普通 Terminal 原会话已 attached-live，第三终端原会话仍 live、outputSequence=2、只有 sleeping 标记。R2 在原断言与预算下失败，清理前 `/proc` 证明 setup PID1305563 的 startTicks=248872585 一直相同，状态有 S/R，排除该次由 PID重用或僵尸引发；它直到 fixture 清理才消失。R2 仅增加日志，不注入退出失败。R1 原版、R3 日志对照正常收到 terminate 并通过。原首败缺进程采样，不能将 R2 的进程身份结论追写为原首败已实测事实。

## 上游责任与尚未确认的环节

固定 VS Code1.141.0 commit `2a59476c9bfcb90b3ddc372c36762471b7dfad1c` 的 `nativeExtensionService._onExtensionHostExit` 等待 `stopAllInReverse()`，它逐个等待 `RemoteExtensionHost.disconnect()`，随后 dispose 本地 Host/管理连接并要求 native exit。不是简单遗漏 await。远端 disconnect 排入 Terminate 与 Disconnect，再等待协议 drain。

Remote SSH0.128.0 返回 `Managed(1)` 连接。drain 经 `MainThreadManagedSocket → ExtHostManagedSockets → Remote SSH Stream.drains.wait()`，只等待本地 tunnel.write 回调；没有远端接收或原 Host 退出确认。R3 直接记录 terminate 排队、writer pending=0、paused=false、reconnecting=false，drain 返回仍 unacked=3；但 R3 收到了 terminate 并通过。这证明 drain 返回不是远端确认，**不能单凭 unacked=3 证明它导致丢消息**。R2 本地 stream queue=1→0，却没有远端 terminate/exit，旧 Host 后续继续运行；R2 renderer 的 console 阶段没有落盘，不能追补其当时 unacked 数。

上游远端 `extensionHostProcess` 在 socket 异常关闭后安排三小时重连保留，而接收 Terminate/Disconnect 会正常终止。成功与失败都配置三小时，故延长35秒不会建立“Host 已离线”的条件。已收窄到测试结束的退出消息递送与隧道关闭边界；具体是压缩/SSH隧道/远端CLI转发的哪一层丢失，仍未证明。当前证据不够把某条 VS Code 或 Remote SSH 源码宣告为已确认唯一缺陷，也不表明产品应强制退出所有远端 Host。

## 因果验证

R1 原版通过，R2 日志自然复现原35秒断言失败，R3 可落盘日志正常通过。C1 在独立 VS Code副本仅 setup 阶段抑制 Terminate/Disconnect，确认旧 Host 保留；verify 却先在 Canvas ready45秒超时，没有进入 completed 联合断言，故不把 C1 计为原失败的同症状负对照。C2/C3 保持同样受控消息缺失，只在本地 setup 退出后核对旧 Host 的 UID、私有 server 路径、extensionHost 类型与 startTicks，再只结束该 Host，等待原进程消失后重开。C2在身份核验后已只向旧 Host1843101发 SIGKILL，Supervisor1849519保留；其后诊断读 cmdline时遇到退出瞬间的 zombie空命令行，错误报告 PID scope mismatch，因此没有启动 verify。C2属于诊断自身失败，不计为产品失败或有效正对照。C3改用发送前严核身份、发送后按原 startTicks观察消失，不再将 zombie空命令行当作新进程身份。C3完整两阶段通过：本地setup退出后只对Host2006731/startTicks248934378发SIGKILL，等待原进程消失，然后原verify全部通过。完成第三终端已closed、snapshot-only、historyDiscarded，Agent/普通Terminal仍按原sessionId恢复并接受重开后输入；这些是未改动的正式断言。最后清理前仍保留Supervisor2012368（startTicks248934998），没有以清理Supervisor换取通过。

## 待确认的修复提案

修复限定在 Linux localhost SSH 的 smoke fixture 与 orchestration，不改变产品恢复、resize、ready45秒或 completed35秒预算。setup 成功时把真实远端 Host PID及 Linux startTicks 写入本次私有工件；本地 Electron 退出后先检查它是否已消失。若仍存活，核对 UID、私有 server 根、extensionHost 角色和启动身份，仅对这个旧 Host 制造真实离线，等待原进程消失，再启动 verify。未知身份或无法确认退出须提前失败并保存证据；PID重用不得向新进程发信号。

必须保留原 Supervisor、Agent/Terminal sessionId、完成第三终端与丢弃历史断言。不能批量杀 server/Supervisor、结束第三终端或重新创建会话。建议在正常退出的有界观察后，仍存活则对已核实的旧Host发SIGKILL，明确模拟旧Host异常离线，并记录退出来源；C3已验证此动作保留原Supervisor与会话。正常收到 terminate 时不额外发信号。`kill -0` 对 zombie/PID重用也可能误判，因此正式实现还应让第三终端等待**原进程身份已退出**，而不是任意同号 PID 不存在；需要与 Linux identity 屏障一起设计，避免独立放宽判据。

验收包括原版两阶段、受控正常退出消息未送达但旧 Host 被确实结束、拒绝结束旧 Host 时仍失败、PID身份不符拒绝信号、原 Supervisor与会话保留及 fixture 最终零残留。完成定向修复后再对最新发布准备预合并输入跑完整 release:verify；本轮结果不豁免 PR327 的失败门禁。

## 证据与限制

证据见[取证说明](../references/remote-host-exit-investigation/README.md)。原失败 `/tmp/d261r/source/remote-ssh-real-reopen` 与 main 正对照 `/tmp/dmr13/source/remote-ssh-real-reopen` 均保留；独立运行在 `/tmp/dscsshdiag-{r1,r2,r3,c1,c2,c3}`，仅导出筛选后的日志、进程身份、关键快照与哈希，避免保存完整环境或密钥。

本轮交付只包含调查文档和参考脚本，正式源码、测试及上游缓存原件不变。用户确认前不实现提案。结论范围为 Linux localhost、固定 VS Code/Remote SSH版本；不能外推真实远端或其他平台。此前 resize瞬态、Webview资源积压、clean-checkout ETXTBSY 属于各自证据范围，不能拼接为本故障根因。
