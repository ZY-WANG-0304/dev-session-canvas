# SSH 旧 Host 退出与保留的双状态实验

2026-10-13 在 `investigate-remote-host-exit` 分支完成设计验证，正式修复仍待用户确认。基线 `origin/main` 为 `ea0c9b194fda1f13098cfd7ad4a3e13c4ec5233b`；实验启动 head 为 `bab2490d47a595c837385d4675ac85108e9ed2b0`。Linux x64 / Node22.23.3 / VS Code1.141.0（commit `2a59476c9bfcb90b3ddc372c36762471b7dfad1c`）/ Remote SSH0.128.0 / localhost sshd / 原生PTY / fake Agent provider。

## 实测结果

| 运行 | 原 Host PID / startTicks | verify Host PID | 原 Supervisor PID | 结果 |
| --- | --- | --- | --- | --- |
| retain-1 | 3504853 / 249413492 | 未启动 | 见原工件 | 实验helper路径遗漏 `runtime-supervisor`，ENOENT；未进入verify，首败保留 |
| retain-2 | 3710705 / 249430027，持续存活 | 3737053 | 3716575 | 完整通过，cleanup通过 |
| exit-1 | 3872871 / 249443255，已确认消失 | 3902187 | 3880065 | 完整通过，cleanup通过 |
| retain-3 | 4076480 / 249459688，持续存活 | 4105357 | 4083785 | 完整通过，cleanup通过 |
| exit-2 | 418760 / 249502652，已确认消失 | 445176 | 424725 | 完整通过，cleanup通过 |
| retain-4 | 637760 / 249521259，持续存活 | 660332 | 642517 | 加强resize持续观察通过，cleanup通过 |

retain-2、exit-1、retain-3、exit-2使用相同helper、staged test、runner与VS Code副本；只更换场景参数和私有目录，未增加重试或放宽正式ready45秒、恢复35秒预算。两分支各两次通过；四份实际staged test SHA256相同，为 `c68692b1e7fce75cc92542cb71eaf3139832177d7e6bf4ab853f922de0e096db`。`retain-2-inputs.json`、`exit-2-inputs.json`记录实验四项输入，`formal-inputs-before.json`与`formal-inputs-after.json`核对400项正式脚本、测试与bundle未变，正式源码diff为空。

每次业务验收复用完整两阶段的恢复、离开期间输出、后续输入、完成终态与历史丢弃断言；再复用正式 `terminal-resize.cjs`，共同核对原node/session/storage身份、Host尺寸、Webview实际行列数与Fit目标、原Supervisor `attachSession`状态。Agent由67×21改为82×27，Terminal由64×20改为85×28，原Supervisor与原session保留。业务操作后的会话数/绑定保持原值；本轮没有单独派发重复start命令，因此不声称覆盖重复启动拒绝用例。

## 可控前提和实验边界

独立缓存仅对setup复制test URI抑制Terminate/Disconnect发送，模拟退出消息缺失；verify窗口正常退出。两个分支在本地setup窗口退出后均先要求原Host仍为同一PID/startTicks且非Z/X，再明确执行exit或retain，禁止按自然结果任选绿色分支。exit只向已核对UID、私有server根、extensionHost角色及原身份的旧Host发SIGKILL，等待原身份消失后启动verify；retain不结束旧Host，并在verify ready、业务完成及外部 `/proc`采样中确认存活。原Supervisor独立保持，重开均实际启动新Host，未复用原Host。

第三终端只在staged copy中改为等待私有 `complete-terminal.flag`。runner确认本地窗口已退出及指定Host前提成立后释放信号，等待Supervisor注册表中Agent/Terminal的实际离开期间输出，以及第三终端已结束/已移除，然后启动verify。Terminal输出要求独立完整行，避免将setup sleeping标记误当成完成输出。原verify继续检查snapshot-only、historyDiscarded及无第三session，完成条件不再依赖Host退出。

`identity-negative-controls.json`由自有子进程实测：live接受retain、拒绝exit；已退出拒绝retain、接受exit。前提错误不能被绿色业务结果掩盖。原版正常退出的正对照及自然旧Host保留首败见上一轮 `../remote-host-exit-investigation/`；C1保留Host时ready45秒失败仍保留，不能用本轮绿灯追认它通过，也不能称所有异常断连均稳定。

本轮仅证明固定Linux localhost环境中两个状态可以受控、独立并重复验收，不证明真实网络异常、重连复用原Host、其他VS Code/Remote SSH版本或跨平台均通过。上游具体丢失层仍未确认。实验缓存修改是固定版本的研究注入，尚未选定正式门禁的注入接口；不可直接当作产品修复。

## resize后的旧注册表值

retain-2的直接Supervisor读取和页面均已为新尺寸，但紧接着的debug注册表仍显示旧值。源码 `CanvasPanelManager.readRuntimeSupervisorRegistryForTest`读取磁盘文件，`RuntimeSupervisorServer.emitSessionState → schedulePersist`在120ms后安排写入，它不是PTY实时状态。

为排除旧Host尺寸回写，retain-4仅加强staged test：成功resize后立即每约250ms读取页面、原Supervisor和磁盘注册表，持续至少三秒，任何实时尺寸偏离都直接失败，不再次收敛或重试。13次采样共3213ms，旧Host始终原身份存活；第一帧14ms注册表为67×21/64×20，实时尺寸始终82×27/85×28；323ms注册表追上，之后没有回退。证据为 `retain-4-resize-stability.json`。这证明该补验中旧值是持久化观察延迟；不能声称追溯逐帧证明retain-2的后续状态，或保证任意时长不会出现别的竞争。

## 文件与复跑

`*-summary.json`包含筛选后的业务断言、状态前提、关键进程采样、退出日志、cleanup与原工件hash，不包含密钥、进程环境或完整上游minified文件。`stage-test-v1.py`是四次重复的测试修改，v2仅增加上述严格resize观察。`lab-runner.patch`、`prepare-cache.py`、`lab-helpers.cjs`与`observe.py`为研究参考，不接入默认测试或发布。脚本保留实验时的绝对路径，复跑必须有隔离worktree及对应缓存，不能直接对主工作树或普通用户安装执行。

在独立worktree `/tmp/dscsshdiag`，具备Node22、已安装依赖、sshd/ssh、显示环境、固定VS Code缓存与原生执行资产集后，使用 `npm ci`、`npm run build -- --execution-assets-set /tmp/dsc-release-026-assets`、`npm run build:notifier`准备原bundle。保持主缓存 `/tmp/dsc0261v/.vscode-test`不变，只复制到 `/tmp/dscsshdiag-two-cache`。然后：

    mkdir -p /tmp/dscssh2-evidence .debug/remote-host-two-state
    cp -a scripts .debug/remote-host-two-state/
    cp docs/references/remote-host-two-state-validation/lab-helpers.cjs /tmp/dscssh2-evidence/
    cp docs/references/remote-host-two-state-validation/stage-test-v1.py /tmp/dscssh2-evidence/stage-test.py
    cp docs/references/remote-host-two-state-validation/observe.py /tmp/dscssh2-evidence/
    cp docs/references/remote-host-two-state-validation/prepare-cache.py /tmp/dscssh2-evidence/
    python3 /tmp/dscssh2-evidence/prepare-cache.py
    cd .debug/remote-host-two-state
    patch -p0 < ../../docs/references/remote-host-two-state-validation/lab-runner.patch
    cd ../..
    PATH=/tmp/dsc-release-node22/node_modules/node/bin:$PATH SSH_HOST_SCENARIO=retain DEV_SESSION_CANVAS_VSCODE_TEST_CACHE_PATH=/tmp/dscsshdiag-two-cache DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=remote-ssh-real-reopen DEV_SESSION_CANVAS_SMOKE_DEBUG_ROOT=/tmp/dscssh2-fresh-retain python3 /tmp/dscssh2-evidence/observe.py /tmp/dscssh2-fresh-retain /tmp/dscssh2-evidence/fresh-retain.ndjson node .debug/remote-host-two-state/scripts/smoke/run-vscode-smoke.mjs

exit分支将 `SSH_HOST_SCENARIO`设为exit，并换全新私有目录/输出文件。各次串行执行，保留第一次失败，不自动重试覆盖。v2用 `stage-test-v2.py`替换实验stage脚本后再用新目录运行。研究脚本只支持本版本源码锚点，匹配不符须停止，不猜测替换位置。

六次fixture均cleanup通过，按私有路径复核没有进程残留；实验VS Code缓存已恢复原版，原缓存及恢复副本SHA256均为 `631c1d79c4f3af9177ca23a70cfe0cf2586a692678bd897af6c869324160d905`，临时runner执行入口已移除。完整原件保留于 `/tmp/dscssh2-{retain-1,retain-2,retain-3,exit-1,exit-2,retain-4}`和 `/tmp/dscssh2-evidence/`，清理记录见 `restoration-and-cleanup.json`。没有推送、修改正式测试/产品/超时，也未运行完整release:verify；PR327首败与发布卡点仍须正式修复并重验。
