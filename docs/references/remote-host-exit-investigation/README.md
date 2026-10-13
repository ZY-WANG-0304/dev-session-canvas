# localhost SSH 重开退出调查取证

本轮设计阶段已收口，正式修复等待用户确认。独立缓存的诊断文件已恢复为原版，SHA256 `631c1d79c4f3af9177ca23a70cfe0cf2586a692678bd897af6c869324160d905`；六次fixture均完成清理，按各私有路径检查没有进程残留。

调查基线 main `ea0c9b194fda1f13098cfd7ad4a3e13c4ec5233b`，分支 `investigate-remote-host-exit`，worktree `/tmp/dscsshdiag`。VS Code1.141.0 commit `2a59476c9bfcb90b3ddc372c36762471b7dfad1c`，Remote SSH0.128.0，Node22.23.3，Linux x64。设计结论见 `docs/design-docs/remote-host-exit-investigation.md`。

`observe.py` 在外部启动具名场景，仅读取远端 Host 日志及 `/proc/<pid>/stat`，输出 PID、状态、ppid、startTicks，不保存进程环境、完整命令行或密钥。R1/R2/R3/C1/C2原观察器每次读完整日志；C3采用增量读取减少观察开销。它是参考工具，不是正式 smoke 门禁。

`*-summary.json` 是筛选后的退出日志和失败节点快照，携带原文件SHA256。`*-process-summary.json` 记录同身份存活、消失及场景退出；`*-protocol-events.json` 保留诊断阶段。`upstream-responsibility.txt` 为固定commit源文件的带行号短摘录；hash文件可核对来源，未保存整个上游项目。

R1运行正式 runner和原版VS Code，无诊断patch。R2/R3在独立缓存和 `.debug/remote-host-lab/scripts` 副本只增加日志，不改变产品、测试断言或预算；R2 console不落盘，所以R3改为logService。C1/C2/C3在独立副本只对setup的复制test URI抑制Terminate/Disconnect，模拟发送丢失，不改测试正文。C2/C3另对同私有fixture且已严格确认身份的旧Host发SIGKILL，Supervisor与原会话保持。正式runner和原版VSCode缓存未修改。

精确运行环境：

    PATH=/tmp/dsc-release-node22/node_modules/node/bin:$PATH
    DEV_SESSION_CANVAS_VSCODE_TEST_CACHE_PATH=/tmp/dsc0261v/.vscode-test
    DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=remote-ssh-real-reopen
    DEV_SESSION_CANVAS_SMOKE_DEBUG_ROOT=/tmp/dscsshdiag-r1
    python3 observe.py /tmp/dscsshdiag-r1 /tmp/dscsshdiag-evidence/r1.ndjson node scripts/smoke/run-vscode-smoke.mjs

R2/R3/C1/C2/C3使用 `/tmp/dscsshdiag-cache` 和 `node .debug/remote-host-lab/scripts/smoke/run-vscode-smoke.mjs`，C2/C3额外 `SSH_DIAG_END_OLD_HOST=1`。每次换新私有debug root。`lab-runner.patch` 是最终实验副本相对正式runner的完整patch；其控制注入在C1开始加入，before-dispose采样在C2加入，退出后的identity观察在C3修正。`upstream-diagnostic-excerpts.txt` 只保存修改函数短片段，避免minified整行多MB输出。`upstream-inputs.json`记录不同缓存版本，R2/R3哈希按最终副本逆转已记录的唯一修改重建，并非声称事前冻结快照。

原发布首败根目录 `/tmp/d261r/source/remote-ssh-real-reopen`；main通过对照 `/tmp/dmr13/source/remote-ssh-real-reopen`。新实验原始日志/工件在 `/tmp/dscsshdiag-{r1,r2,r3,c1,c2,c3}`，命令输出在 `/tmp/dscsshdiag-evidence/*.log`。repo-local仅保存审查所需安全摘录和hash，不复制SSH密钥、initData/baseEnv或完整terminal环境。

用户要求确认前不修复；实验控制不作为正式patch交付，也不构成PR327完整release:verify通过。

具名结果：R1 原版通过；R2 仅日志自然复现 completed35秒失败；R3 落盘协议日志通过；C1 抑制退出消息，旧Host保留，但先在ready45秒失败（不能算completed负对照）；C2已只杀旧Host，诊断误判退出中的zombie，未运行verify；C3修正诊断后完整通过，旧Host2006731/startTicks248934378被确实结束，原Supervisor2012368/startTicks248934998保留到最后清理。C3结果只验证提案动作可保持原断言，不代表正式实现或完整发布门禁通过。
