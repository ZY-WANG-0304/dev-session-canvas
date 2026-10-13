---
title: localhost SSH 真实重开的旧远端 Host 退出调查
decision_status: 已选定
validation_status: 已验证
domains: [VSCode 集成域, 执行编排域]
architecture_layers: [宿主集成层, 适配与基础设施层]
related_specs: [docs/product-specs/runtime-persistence-modes.md]
related_plans: [docs/exec-plans/completed/remote-host-exit-investigation.md, docs/exec-plans/completed/remote-host-two-state-validation.md, docs/exec-plans/active/remote-host-two-state-fix.md]
updated_at: 2026-10-13
---

# localhost SSH 真实重开的旧远端 Host 退出调查

## 问题与授权范围

0.26.1 发布验证首败中，Canvas 已 ready，Agent 与普通 Terminal 恢复；等待旧远端扩展 Host PID 消失的第三终端仍 live，导致“离线期间完成且丢弃历史”的联合断言失败。用户先要求建独立分支定位根因，随后批准按双状态方案修复。本文保留调查证据，并记录正式门禁设计和验证范围。

## 已确认的直接根因

`tests/vscode-smoke/real-reopen-tests.cjs:148` 的第三终端执行 `while kill -0 <setup Host PID>; do sleep 0.1; done`。`scripts/smoke/run-vscode-smoke.mjs` 的 SSH orchestration 在本地 Electron 返回后固定等待三秒就启动 verify，没有证明旧远端 Host 已消失。因此本地退出但远端仍保留时，第三终端不会结束，verify 的35秒联合断言必然等不到预期的 completed 状态。

发布原首败与 R2 自然复现均为 Canvas generation5 ready/ack=true、Agent 与普通 Terminal 原会话已 attached-live，第三终端原会话仍 live、outputSequence=2、只有 sleeping 标记。R2 在原断言与预算下失败，清理前 `/proc` 证明 setup PID1305563 的 startTicks=248872585 一直相同，状态有 S/R，排除该次由 PID重用或僵尸引发；它直到 fixture 清理才消失。R2 仅增加日志，不注入退出失败。R1 原版、R3 日志对照正常收到 terminate 并通过。原首败缺进程采样，不能将 R2 的进程身份结论追写为原首败已实测事实。

## 上游责任与尚未确认的环节

固定 VS Code1.141.0 commit `2a59476c9bfcb90b3ddc372c36762471b7dfad1c` 的 `nativeExtensionService._onExtensionHostExit` 等待 `stopAllInReverse()`，它逐个等待 `RemoteExtensionHost.disconnect()`，随后 dispose 本地 Host/管理连接并要求 native exit。不是简单遗漏 await。远端 disconnect 排入 Terminate 与 Disconnect，再等待协议 drain。

Remote SSH0.128.0 返回 `Managed(1)` 连接。drain 经 `MainThreadManagedSocket → ExtHostManagedSockets → Remote SSH Stream.drains.wait()`，只等待本地 tunnel.write 回调；没有远端接收或原 Host 退出确认。R3 直接记录 terminate 排队、writer pending=0、paused=false、reconnecting=false，drain 返回仍 unacked=3；但 R3 收到了 terminate 并通过。这证明 drain 返回不是远端确认，**不能单凭 unacked=3 证明它导致丢消息**。R2 本地 stream queue=1→0，却没有远端 terminate/exit，旧 Host 后续继续运行；R2 renderer 的 console 阶段没有落盘，不能追补其当时 unacked 数。

上游远端 `extensionHostProcess` 在 socket 异常关闭后安排三小时重连保留，而接收 Terminate/Disconnect 会正常终止。成功与失败都配置三小时，故延长35秒不会建立“Host 已离线”的条件。已收窄到测试结束的退出消息递送与隧道关闭边界；具体是压缩/SSH隧道/远端CLI转发的哪一层丢失，仍未证明。当前证据不够把某条 VS Code 或 Remote SSH 源码宣告为已确认唯一缺陷，也不表明产品应强制退出所有远端 Host。

## 因果验证

R1 原版通过，R2 日志自然复现原35秒断言失败，R3 可落盘日志正常通过。C1 在独立 VS Code副本仅 setup 阶段抑制 Terminate/Disconnect，确认旧 Host 保留；verify 却先在 Canvas ready45秒超时，没有进入 completed 联合断言，故不把 C1 计为原失败的同症状负对照。C2/C3 保持同样受控消息缺失，只在本地 setup 退出后核对旧 Host 的 UID、私有 server 路径、extensionHost 类型与 startTicks，再只结束该 Host，等待原进程消失后重开。C2在身份核验后已只向旧 Host1843101发 SIGKILL，Supervisor1849519保留；其后诊断读 cmdline时遇到退出瞬间的 zombie空命令行，错误报告 PID scope mismatch，因此没有启动 verify。C2属于诊断自身失败，不计为产品失败或有效正对照。C3改用发送前严核身份、发送后按原 startTicks观察消失，不再将 zombie空命令行当作新进程身份。C3完整两阶段通过：本地setup退出后只对Host2006731/startTicks248934378发SIGKILL，等待原进程消失，然后原verify全部通过。完成第三终端已closed、snapshot-only、historyDiscarded，Agent/普通Terminal仍按原sessionId恢复并接受重开后输入；这些是未改动的正式断言。最后清理前仍保留Supervisor2012368（startTicks248934998），没有以清理Supervisor换取通过。

## 正式方案

正式实现限定 `scripts/smoke/run-vscode-smoke.mjs`、Linux localhost fixture 和 `tests/vscode-smoke/real-reopen-tests.cjs`。聚合场景依次运行具名 exit/retain 两分支。setup 写入原 Host/Supervisor 身份后保持测试未返回；runner 核验本次 spawn 的本地 Electron 私有 user-data 根、UID 和后代启动身份，只终止这个客户端进程树制造异常断连。确认本地退出及原远端 Host 仍同身份运行后，exit 仅结束已核验旧 Host 并等待原身份消失，retain 保留到业务完成。不修改上游源码缓存，也不改变产品行为。

两分支第三终端等待私有完成文件；runner 确认前提后释放并观察离开期间输出/完成，然后启动 verify。verify 共同核验原 Supervisor/session/storage、原恢复/输入/完成历史断言及正式 resize helper 的 Host、Webview、原 Supervisor attachSession 尺寸。既有非 SSH 两阶段路径保持原语义，ready45秒/恢复35秒/resize20秒不放宽。身份错误、失败或未知均有界失败，信号发出前严格核验；最终清理只回收本次私有资源，不能代替业务通过。执行过程见 `docs/exec-plans/active/remote-host-two-state-fix.md`。

本地客户端作用域使用本次真实 spawnargs 的私有 user-data-dir、/proc/exe、UID 和启动时记录的 PID/startTicks。Electron 会在启动后重写 argv，不能从运行中的 cmdline 缺少原启动参数推断进程越界。终止客户端后既等待根进程回收，也核验记录的同身份后代不再运行。远端信号单独核验 UID、私有 server 路径、extensionHost 角色和前后两次 startTicks；身份不符拒绝发送。retain 在重开前、verify ready 和业务完成均检查原身份仍非 Z/X；exit 必须证明原身份消失，僵尸也不算已消失。重开实际使用的新 Host 身份另行记录。

第三终端的完成文件只由 runner 在本地退出、Host 前提和原 Supervisor 确认后创建。原 Agent/普通 Terminal 的离开期间输出仍按既有独立命令产生，setup 另断言输出尚未到达；runner 等待原两会话存活、独立输出到达和第三终端结束，再启动 verify。第三终端 snapshot-only/historyDiscarded 与原 session 恢复、后续输入断言保留。Supervisor 请求使用总预算计时，连接保持却无响应也须按期失败。

具名分支分别可定向执行，但聚合入口和默认全量必须串行运行两个全新 fixture，不能按自然退出结果任选断言。业务完成后核对原 Supervisor/session 数量及真实 resize，最后才回收私有资源。会话数与绑定保持不变不等于已验证显式重复 start 拒绝；本轮没有单独派发该命令。短暂断连时保留等待重连是上游允许的行为，本固定版本三小时配置不代表永久保留保证。

## 证据与限制

证据见[取证说明](../references/remote-host-exit-investigation/README.md)。原失败 `/tmp/d261r/source/remote-ssh-real-reopen` 与 main 正对照 `/tmp/dmr13/source/remote-ssh-real-reopen` 均保留；独立运行在 `/tmp/dscsshdiag-{r1,r2,r3,c1,c2,c3}`，仅导出筛选后的日志、进程身份、关键快照与哈希，避免保存完整环境或密钥。

调查与双状态研究阶段只改隔离副本，正式输入 hash 保持不变；用户批准后的正式实现修改测试及 runner，上游缓存原件仍不改。结论范围为 Linux localhost、固定 VS Code/Remote SSH版本；不能外推真实远端或其他平台。此前 resize瞬态、Webview资源积压、clean-checkout ETXTBSY 属于各自证据范围，不能拼接为本故障根因。

## 双状态可重复验证（2026-10-13，已完成研究）

在独立runner、staged test和固定VS Code副本中完成retained/exited两分支各两次相同输入的独立执行：retain-2/retain-3确认原Host持续存活，exit-1/exit-2仅结束已核实旧Host后确认原身份消失。第三终端等待私有独立完成信号，原恢复、输出、输入、终态/历史丢弃断言全部通过；原Supervisor和原session持续保留，Host/Webview/直接Supervisor resize共同收敛，Agent67×21→82×27、Terminal64×20→85×28。每次cleanup通过，无本轮私有进程残留。retain-1是实验helper路径错误、未运行verify，失败原件保留。

另用retain-4补查resize后稳定性：旧Host保持原身份，13次实时页面/原Supervisor采样共3213ms均保持新尺寸。首帧14ms磁盘注册表仍是旧尺寸，323ms追上，之后未回退。debug registry读取磁盘，Supervisor在状态更新后120ms安排持久化，因此不能将瞬时旧注册表值当作PTY未resize；本轮补验支持观察延迟，不追溯补造retain-2的后续连续状态。

双状态可以在当前Linux localhost固定版本环境中受控并重复验收；受控上游消息缺失不代表所有真实网络故障。研究使用的上游注入只用于取证；正式门禁已选择真实客户端异常断连，不将该注入接入产品。全部正式脚本、测试和bundle的400项hash不变，实验缓存恢复原版，临时runner入口移除。过程见 `docs/exec-plans/completed/remote-host-two-state-validation.md`，实测表、输入hash、参考脚本与限制见[双状态证据](../references/remote-host-two-state-validation/README.md)。以上为研究阶段结果；后续正式实现及完整发布验证独立记录，研究结果不代证正式门禁。

## 正式实现验证（2026-10-13）

已接入双分支 runner、独立完成信号、原身份观察和真实 resize。17 项控制回归、9 项已有 resize helper 回归与主扩展/notifier 构建通过。原版缓存 native-2 两分支完整通过：exit 旧 Host2078814/startTicks249666082消失，Supervisor2084887保留；retain 旧 Host2189996/startTicks249677312持续到业务结束，Supervisor2194887保留。原会话恢复、输出/后续输入、第三终态/历史丢弃以及 Agent82×27/Terminal85×28真实尺寸均成立，两个私有 fixture 清理通过。native-1在 Electron argv作用域检查误拒绝，未发受控信号，错误与修复回归单独保留。

native-2通过后增加本地后代退出确认、setup未提前到达输出断言和ready轮询取消。这些保护已在完整0.26.1临时预合并输入的source smoke全部通过：exit旧Host238831消失、Supervisor244567保留；retain与原会话/resize/cleanup共同通过。共享单root/多root/切换、双窗口和systemd/fallback回归通过。完整npm test（含426项Webview）与clean-checkout生产VSIX打包/安装后八场景smoke全部通过，release:verify退出码0。输入为本地临时预合并7d33f664（修复9daf7054 + 发布准备7b2440d4），后续两提交仅改控制回归，17项在当前修复head独立通过。该结果证明本次修复与发布准备输入在本环境兼容；修复合入后PR327仍须基于最新main和发布head重新验证。正式证据见[修复验证](../references/remote-host-two-state-fix/README.md)。
