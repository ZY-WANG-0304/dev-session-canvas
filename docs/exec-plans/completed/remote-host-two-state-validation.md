# 验证 SSH 旧 Host 退出与保留的两种可控场景

本ExecPlan按 `docs/PLANS.md`维护。用户要求新分支先定位、确认后修复，随后询问是否能稳定测试Host退出和不退出。本计划只完成设计实验，正式门禁/产品修复仍等待确认。

## 目标与全局图景

重开窗口时，远端扩展Host可能已退出，也可能因重连保留而仍在运行；产品的独立Supervisor持有原PTY，恢复成功不能从Host寿命推断。本阶段分别建立原Host退出和原身份保留两个前提，再验证原Supervisor、原会话、离开期间输出、后续输入、真实resize和独立终端完成。结果必须具名、可重复、有失败原件，不能碰巧按自然状态任选一个绿色分支。

## 进度

- [x] (2026-10-13) 读取既有调查、工作流、持久化语义、正式resize helper；确认main基线ea0c9b19和调查分支。
- [x] (2026-10-13) 独立runner/staged test及固定VS Code副本，只对setup复制test URI抑制Terminate/Disconnect，保持正式输入/预算不变。
- [x] (2026-10-13) retain-1建立原Host保留，helper路径漏runtime-supervisor，ENOENT未进入verify；修正helper并保留首败。
- [x] (2026-10-13) v1相同四项输入，retain-2、exit-1、retain-3、exit-2各自独立新fixture完整通过，两分支各两次；实际staged test hash相同。
- [x] (2026-10-13) 自有子进程正反例：live只接受retain、已退出只接受exit，四项条件检查通过。
- [x] (2026-10-13) retain-4 v2补查旧注册表尺寸：13次严格实时采样共3213ms不回退，14ms磁盘旧值、323ms追上，原Host全程存活。
- [x] (2026-10-13) 六次fixture cleanup通过、私有进程零残留；原/实验缓存恢复同一stock hash，临时runner执行入口移除，全部正式400项输入hash不变。
- [x] (2026-10-13) 同步设计/索引/核心原则、证据与技术债，完成研究，正式修复和完整发布verify仍待实施。

## 意外与发现

既有R2自然失败只证明部分恢复与Host保留，未走完后续输入/resize；C1受控保留时ready45秒先失败，不是completed35秒同症状负对照。新绿灯不能覆盖这些首败。retain-1为诊断自身路径错误，修正后只使用新fixture，不覆盖日志。

retain-2直接Supervisor与Webview已为新尺寸，紧接着debug registry仍为旧尺寸，不能忽视。源码debug入口读取磁盘，Supervisor在状态更新后120ms安排持久化。retain-4增强观察在成功resize后立即严格采样页面/原Supervisor/磁盘，无实时尺寸偏离后再次收敛的机会：13次共3213ms均为Agent82×27、Terminal85×28，旧Host637760/startTicks249521259全程S；14ms注册表旧值，323ms追上。该补验支持持久化延迟，没有观察到旧Host将尺寸改回；不追溯补造retain-2后续连续采样，也不保证任意时长。

## 决策记录

2026-10-13决定只在独立缓存和 `.debug/remote-host-two-state/`研究，正式源码、tests、scripts和bundle不变。setup只抑制Terminate/Disconnect，正常drain仍执行；本地退出后要求原Host仍活，再明确exit或retain，避免自然状态造成随机分支。该注入只模拟退出消息缺失，正式门禁注入接口尚未选定，不把固定minified修改直接作为产品方案。

同日决定第三终端用独立完成文件，runner在窗口退出及前提确认后释放，并确认Supervisor注册表已有离开期间输出和第三终端结束后才verify。不能沿用等待Host PID消失的循环来验证保留场景；完成与Host寿命独立。输出使用独立完整行，避免setup sleeping标记包含完成子串而误判。

同日决定v1各两次验证相同业务断言与输入hash，随后仅对有疑问的retain resize补充一次v2严格三秒观察。v2不计入v1相同输入四次重复数，不声称v2双场景各两次。业务操作后会话数/绑定保持不变；没有单独派发重复start命令，不把它描述为重复启动拒绝覆盖。

## 结果与复盘

固定Linux localhost / VS Code1.141.0 / Remote SSH0.128.0环境中，两种Host前提均可受控、独立、重复验收，v1两分支各两次完整通过，v2一次补验解释注册表延迟。原Supervisor/session、原恢复/输出/输入/完成历史断言及共同resize通过。不存在通过扩大正式预算或隐藏首败换取绿灯的操作。

正式产品/门禁/超时未修复，PR327完整release:verify失败不因研究通过而豁免。下一阶段经用户确认后选定正式注入入口，将独立Host身份屏障和完成条件接入两分支，补齐身份不符拒绝信号及业务失败负对照，再对最新发布预合并输入完整verify。具体上游缺失层、真实网络异常、复用原Host重连、跨版本与跨平台仍未验证，已登记技术债。

## 上下文与定向

worktree `/tmp/dscsshdiag`，分支 `investigate-remote-host-exit`，main `ea0c9b194fda1f13098cfd7ad4a3e13c4ec5233b`，启动head `bab2490d47a595c837385d4675ac85108e9ed2b0`。Node22.23.3 / Linux x64 / VS Code1.141.0 commit2a59476c9bfcb90b3ddc372c36762471b7dfad1c / RemoteSSH0.128.0 / localhost sshd / 原生PTY / fake Agent。Host运行扩展，Supervisor独立持有PTY，不是同一进程。

正式 `scripts/smoke/run-vscode-smoke.mjs`建立私有SSH fixture、staged smoke host及setup/verify窗口；`tests/vscode-smoke/real-reopen-tests.cjs`第三终端原等待setup Host PID退出。复制test仅改为等待私有 `complete-terminal.flag`，补记录真实Host/Supervisor身份，复用 `tests/vscode-smoke/terminal-resize.cjs`确认原session/storage、Host卡片、容器Fit、页面实际行列数、Supervisor直接 `attachSession`尺寸与输出共同一致。

## 里程碑

第一里程碑建立可控前提：setup完成后记录PID/startTicks和原Supervisor身份，复制VS Code只对setup URI省略退出消息。runner先验证原Host活、UID/私有server路径/角色和身份，exit分支只结束该Host并确认原身份消失，retain不发Host信号；都确认Supervisor仍同身份。错误前提在业务验证前失败。

第二里程碑运行相同业务断言：独立完成信号释放后，最多30秒观察离开输出和第三终端已结束/移除，再启动verify。保留正式ready45秒、恢复35秒、输入及历史断言，增加resize原helper的共同20秒收敛。原session/storage、输出、可见正文、输入及会话数不变必须成立；retain在verify ready和业务末尾继续要求原Host同身份存活，exit要求原身份不存在。

第三里程碑只解决新观察缺口：成功resize后严格每约250ms读实时页面和原Supervisor并观察磁盘，持续三秒，任何实时不一致直接失败，无再次收敛。保留首帧与末帧，确认注册表追上，导出失败或成功原件。最终导出安全证据、恢复缓存、移除实验入口、复核资源和正式hash。

## 具体步骤

全部操作在独立worktree `/tmp/dscsshdiag`。依赖、Node22、sshd/ssh、显示环境、固定VS Code缓存及执行资产集需已具备。若重新构建，运行 `npm ci`、`npm run build -- --execution-assets-set /tmp/dsc-release-026-assets`、`npm run build:notifier`，hash以新实际输入另记，不冒用本轮hash。

参考实现完整保存在 `docs/references/remote-host-two-state-validation/`：复制正式scripts到 `.debug/remote-host-two-state/`，用 `lab-runner.patch`只改该副本；复制原缓存 `/tmp/dsc0261v/.vscode-test`到 `/tmp/dscsshdiag-two-cache`后运行 `prepare-cache.py`，它只接受精确上游锚点；将helper、v1 stage和observe复制到 `/tmp/dscssh2-evidence/`。精确准备命令在同目录README，脚本保留实验绝对路径，不能对普通用户安装直接运行。

    PATH=/tmp/dsc-release-node22/node_modules/node/bin:$PATH SSH_HOST_SCENARIO=retain DEV_SESSION_CANVAS_VSCODE_TEST_CACHE_PATH=/tmp/dscsshdiag-two-cache DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=remote-ssh-real-reopen DEV_SESSION_CANVAS_SMOKE_DEBUG_ROOT=/tmp/dscssh2-fresh-retain python3 /tmp/dscssh2-evidence/observe.py /tmp/dscssh2-fresh-retain /tmp/dscssh2-evidence/fresh-retain.ndjson node .debug/remote-host-two-state/scripts/smoke/run-vscode-smoke.mjs

exit用 `SSH_HOST_SCENARIO=exit`及新路径，每个分支再换新路径重复一次。各场景串行执行，避免共用临时runtimeDir互相清理。v2用 `stage-test-v2.py`替换实验stage后再跑新retain路径，只计一次新增观察。

## 验证与验收

v1真实staged test四次SHA256均为c68692b1e7fce75cc92542cb71eaf3139832177d7e6bf4ab853f922de0e096db；helper、runner、VS Code副本hash由输入记录核对。retain-2/retain-3原Host3710705/4076480保持原身份，exit-1/exit-2原Host3872871/418760已消失；每次原Supervisor持续存活。Agent67×21→82×27、Terminal64×20→85×28，原恢复、输入、完成终态、历史丢弃及cleanup全部通过。原进程样本含startTicks，不能仅以kill -0或缺退出日志作结论。

四項自有子进程正反例见 `identity-negative-controls.json`；它们只证明状态前提检查，不代证UID/root/signal误发的全部安全回归。每次包含业务完整返回、身份阶段、退出日志、现场与hash；retain-1的ENOENT原件保留。v2额外13次/3213ms严格尺寸样本见 `retain-4-resize-stability.json`，不冒称两分支各两次v2。

## 幂等性与恢复

每次用新私有路径，首次失败先保留定位，不自动重试替换。六次fixture均导出cleanup报告pass=true、remaining/failures空；按私有路径复核零进程。实验缓存已从stock恢复，原件和副本SHA256均631c1d79c4f3af9177ca23a70cfe0cf2586a692678bd897af6c869324160d905；临时runner目录已移除，参考patch保留。没有删除原失败或未知资源，大型本轮server安装原件也保留，结束时磁盘约6.3GB可用。

## 证据与备注

`docs/references/remote-host-two-state-validation/README.md`有具名表、重复数、首败、复跑及边界；summary记录筛选状态/日志/hash，formal-inputs前后核对400项正式输入不变。完整工件在 `/tmp/dscssh2-{retain-1,retain-2,retain-3,exit-1,exit-2,retain-4}`，命令/观察在 `/tmp/dscssh2-evidence/`。不入库密钥、环境或整体minified。设计结论同步 `docs/design-docs/remote-host-exit-investigation.md`，残余正式修复/平台验证登记 `docs/exec-plans/tech-debt-tracker.md`。

## 接口与依赖

复用现有Linux SSH fixture、正式消息API、原Supervisor协议、正式resize helper与固定原生资产，不新增产品接口或依赖。研究修改局限到复制test和上游发送路径；直接attachSession读取原会话，不创建执行。未推送、建修复PR、修改版本/契约或执行完整release:verify。

修订记录：2026-10-13创建双状态验证计划；retain-1诊断错误留档，修正helper路径和Terminal完整行输出检查；v1四次相同输入通过；retain-4补查尺寸持久化延迟，未将新增观察冒作四次原验证；同步证据及遗留债务、恢复隔离缓存与资源，计划完成。
