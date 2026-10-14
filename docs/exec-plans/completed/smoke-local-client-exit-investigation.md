# 定位 SSH 发布门禁的本地后代进程清理失败

本 ExecPlan 按 `docs/PLANS.md` 持续维护。用户本轮要求定位根因；本阶段保留正式首败，运行诊断实验并记录证据，不实施正式修复，不创建单独诊断或文档 PR。

## 目标与全局图景

确认 PR #327 的完整发布门禁为何在 SSH setup ready 后报 `kill ESRCH`，区分测试前提清理、远端 Host 条件与产品恢复验收。交付物是可重试的受控实验和有证据边界的根因结论，后续修复能够直接使用这些材料。

## 进度

- [x] (2026-10-14) fetch 后确认 main 为 `f3bb442526b1f5eb57171a5b24c9a6bca868756f`，保留主工作区未提交的 `docs/WORKFLOW.md` 和发布 PR head。
- [x] (2026-10-14) 检查完整首败日志、调用边界、helper 与现有 18 项回归，确认异常在后代 SIGKILL 调用处。
- [x] (2026-10-14) 从最新 main 创建本地诊断分支 `smoke-local-client-exit-investigation`，worktree 为 `/dev/shm/dsc-local-exit-rca`。
- [x] (2026-10-14) 实际 helper 的9种受控对照按预期通过；读后消失100/100在原114行ESRCH。
- [x] (2026-10-14) 真实内核正常清理与受控回收竞态对照完成；root实际SIGKILL，race后代实际exit0/回收后kill ESRCH，全部自有进程被回收。
- [x] (2026-10-14) 原18项回归通过，确认真实客户端没有后代，缺覆盖；git blame定位#328的9daf7054，#329/#332未改该路径。
- [x] (2026-10-14) 补齐根因文档、索引/core-beliefs/技术债与证据，完成定位；候选修复与完整发布复验待后续授权。

## 意外与发现

`abortLocalClient` 的第 112 行异步读 `/proc/<pid>/stat`，第 114 行发 SIGKILL，两步不是原子操作。检查前消失和 Z/X 状态已有跳过路径，检查后消失的 ESRCH 没有处理。现有真实本地客户端回归只启动没有后代的 Node 进程，不能覆盖这条路径。

当前磁盘剩余约 20MB；诊断 worktree 和小型实验使用 `/dev/shm`，不安装依赖或复制宿主缓存。首败日志保持在原目录，不删除其他工作树或用户资源。

真实实验正常对照root3171645/leaf3171646实际SIGKILL并回收；race后代3182499的真实stat为startTicks259801771/S，waitpid回收exit0后原helper实际kill ESRCH。屏障固定了异步read返回前退出的可达时序，没有模拟kill的返回值。原首败artifact清单没有verify现场，具体CI后代身份无法追补。

## 决策记录

2026-10-14：固定首败输入并在最新 main 诊断。首败预合并 `b0198184496f30fc45532963998a2ae0aab16cb2`、tree `2233605b6e660fd48da8bd3bb7310d579f3e47fc`、head `cfe1ab40e121bc31689f474e2e6f7cbb9bad4f48`；helper 在发布 head 与 main 中应逐字一致。实验通过 VM 加载实际 CommonJS 文件，只替换依赖接口或控制自有进程，避免复制待验证逻辑。

2026-10-14：以限定后代ESRCH复查原身份不再运行、保留最终退出检查作为候选方向；本轮不实施。诊断结束后资料保留本地分支，计划移到completed，不推送或另建诊断PR；未来随独立修复PR集中收口。

## 结果与复盘

定位已完成：后代身份检查与发信号间退出/回收的竞态由实际helper的100/100受控重复和真实内核对照证明，未处理ESRCH使夹具提前失败。原18项测试未覆盖后代时序；根因不是凭旧版本或长期未改产品路径猜测得出。生产helper保持逐字一致，未修复或重跑完整门禁；具体CI后代PID/角色/退出原因仍未知。#327仍被当前完整验证失败阻塞。

## 上下文与定向

`scripts/smoke/run-vscode-smoke.mjs:688` 在 setup ready、旧 Host 和 Supervisor live 后调用 `tests/vscode-smoke/remote-host-control.cjs` 的 `abortLocalClient(handle, userDataDir, report, root)`。它核验本次 spawn 的根身份、UID、私有 userData 和 executable，收集后代身份，先杀根避免正常退出向远端发送 Terminate，再杀后代，最后确认根被 SIGKILL 和后代不再运行。只有返回后才检查远端 Host retain，exit 分支才主动结束旧 Host，再释放终端完成信号并验收恢复与 resize。

Linux 身份由 PID 和 `/proc/<pid>/stat` 的 startTicks 组成，后者是进程启动时间的内核计数，避免把同 PID 的新进程当作旧进程。ESRCH 是 kill 系统调用找不到目标进程的错误；EPERM 是无权发信号。僵尸 Z/X 不再运行，但原远端 Host 的退出条件仍要求原身份消失。

## 工作计划与里程碑

第一里程碑用实际 helper 配合内存中的 `/proc` 接口，控制根退出、后代正常被杀、读前消失、读后消失、僵尸、身份替换和权限异常。每个对照记录读顺序、发信号目标及返回结果；只有读后消失应稳定得到与首败相同的 ESRCH 行号。

第二里程碑用真实自有 root/descendant，在实际内核 stat 读到 live 后通过屏障退出并回收后代，再把刚才的 stat 内容交还原 helper。Python 设置为子进程收养者（Linux subreaper），负责回收孤儿，确保实际 kill 返回 ESRCH，不依赖随机 sleep。所有信号仅针对本实验直接创建并验证身份的进程。

第三里程碑登记证据范围与最小修复建议。修复应局限于后代发信号竞态，保留非 ESRCH 异常和退出后置检查；本轮不提交正式代码变更。

## 具体步骤

工作目录 `/dev/shm/dsc-local-exit-rca`，Node 路径 `/tmp/dsc-release-node22/node_modules/node/bin/node`。诊断脚本放在 `docs/references/smoke-local-client-exit-investigation/`，使用 Node 标准库和 Python 标准库，命令如下：

    /tmp/dsc-release-node22/node_modules/node/bin/node docs/references/smoke-local-client-exit-investigation/controlled-probe.mjs
    python3 docs/references/smoke-local-client-exit-investigation/real-probe.py /tmp/dsc-release-node22/node_modules/node/bin/node normal
    python3 docs/references/smoke-local-client-exit-investigation/real-probe.py /tmp/dsc-release-node22/node_modules/node/bin/node race
    /tmp/dsc-release-node22/node_modules/node/bin/node scripts/test/test-smoke-remote-host.mjs

以上均已执行，退出码0。脚本PASS表示缺陷按预期复现或对照满足条件；不是helper在race场景成功。

首败完整日志在 `/tmp/pr327-after332-gate-38539427680/verify-full.log`，只提取 ready/SIGKILL/错误栈，避免复制包含环境信息的大段日志。

## 验证与验收

受控实验执行原 helper，读后消失稳定抛 ESRCH，读前消失/僵尸/新身份对照跳过该后代，正常后代完成清理，权限异常继续失败。真实实验记录 live snapshot 的 PID/startTicks、Python 回收完成、实际 signal ESRCH；不得把受控实验的身份与角色追写成 CI 的身份。既有 18 项控制回归应原样通过，说明当前用例没有覆盖这条竞态，而非该问题已修复。

## 幂等性与恢复

每次实验创建私有子进程，仅按捕获身份清理；VM 信号替身不接触系统其他进程。失败仍回收自有子进程并退出。首败 run 与发布分支不变。诊断资料保留本地，若后续批准修复，应随代码、回归和设计文档集中到一个独立修复 PR。

## 证据与备注

正式首败 run 为 https://github.com/ZY-WANG-0304/dev-session-canvas/actions/runs/38539427680 ，job `115772638697`，2026-10-14 09:26:37Z 报错。完整日志 13,552,518 bytes，SHA256 `5518ea6b22c6aaa7ae7924f51566ecf6c36cfe1f6945bb4e85f241c580cce5e8`。

    phase=setup ready-for-exit
    Exit code: SIGKILL
    Error: kill ESRCH
      at Object.abortLocalClient (.../remote-host-control.cjs:114:13)

## 接口与依赖

不新增产品接口或 npm 依赖。VM 使用 `node:vm` 与 `createRequire` 加载真实文件；真实实验使用 Node child_process 与 Linux Python ctypes/prctl/waitpid。实验替身和受控屏障只在诊断脚本中存在，不改变正式 helper 或上游 VS Code 缓存。

修订记录：2026-10-14 创建定位计划，显式限制为受控实验与根因记录，保留首败和未知项。

修订记录：2026-10-14 完成9种受控对照/100次竞态、真实内核正常和回收竞态、原18项回归；同步根因、索引/信念/技术债与原首败receipt/hash，定位任务结束，正式修复仍待后续授权。
