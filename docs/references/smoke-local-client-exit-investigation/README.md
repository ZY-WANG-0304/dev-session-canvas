# 本地客户端后代 ESRCH 诊断证据

正式结论见 [根因文档](../../design-docs/smoke-local-client-exit-root-cause.md)。本目录是可重试的诊断实验，不是正式修复或完整门禁通过证据；所有实验执行逐字加载的 `tests/vscode-smoke/remote-host-control.cjs`，SHA256 `656a9e734f9feb6d14d601a018aead91349d706ea32ea207d7c065bef439792f`。

诊断分支 `smoke-local-client-exit-investigation` 从 main `f3bb442526b1f5eb57171a5b24c9a6bca868756f` 创建，worktree `/dev/shm/dsc-local-exit-rca`。失败发布 head 中 helper 与之逐字一致。机器 Linux，自有实验只依赖 Node22 和 `/usr/bin/python3` 标准库，不安装 npm 依赖、不启动 VS Code。磁盘接近满，使用 `/dev/shm` 存小型材料。

## 重试步骤

在仓库根目录执行，每次创建自己的进程并在结束时回收。真实实验通过 Python `PR_SET_CHILD_SUBREAPER` 收养孤儿；信号限定本次创建的 root/leaf，屏障固定 leaf 被回收后再发信号，不依赖概率 sleep。若 helper 已改，脚本可能因为缺陷不再复现而失败，此时应使用基准 ref 核验历史根因。

    /tmp/dsc-release-node22/node_modules/node/bin/node docs/references/smoke-local-client-exit-investigation/controlled-probe.mjs
    python3 docs/references/smoke-local-client-exit-investigation/real-probe.py /tmp/dsc-release-node22/node_modules/node/bin/node normal
    python3 docs/references/smoke-local-client-exit-investigation/real-probe.py /tmp/dsc-release-node22/node_modules/node/bin/node race
    /tmp/dsc-release-node22/node_modules/node/bin/node scripts/test/test-smoke-remote-host.mjs

`controlled-result.json` 保留9种对照的事件/错误和100次竞态计数，预期正常/读前消失/Z/X/新身份完成，读后消失为 ESRCH，EPERM/根 ESRCH/后代仍运行为失败。`real-normal-result.json` 与 `real-race-result.json` 记录实际内核身份、signal 与回收事件；脚本中的 PASS 表示确认预期诊断结果，race 的 helper 自身仍失败。

真实正常对照 root3171645、leaf3171646 均实际 SIGKILL，Python 回收 leaf exitCode=-9；竞态 root3182498 实际 SIGKILL，leaf3182499/startTicks259801771 的 stat 状态为 S，Python 回收 exit0，实际 kill 为 ESRCH，错误栈落在原114行。进程 PID 为本机实验，与 CI 身份无关。原18项控制回归全部通过，说明原测试缺覆盖，不说明缺陷已修复。

## 正式首败

`failure-receipt.json` 登记正式输入、run、范围和完整日志 SHA；`failure-excerpt.log` 只保留 ready/SIGKILL/ESRCH 栈，不复制完整环境。完整日志仍在 `/tmp/pr327-after332-gate-38539427680/verify-full.log`，未覆盖首败或重跑该run。

来源：[run38539427680](https://github.com/ZY-WANG-0304/dev-session-canvas/actions/runs/38539427680)，job115772638697，预合并 `b0198184496f30fc45532963998a2ae0aab16cb2`。没有 verify 现场 artifact，因此具体失败后代 PID/角色/自行退出的原因仍未知。

本轮仅本地记录，不另建诊断、验证或文档 PR；后续授权修复时与代码和回归集中收口。

2026-10-14后续：用户批准修复，研究记录随`smoke-local-client-exit-race-fix`集中提交。原实验结果和helper SHA保持历史输入；在已修helper运行原诊断期待应使用历史ref，不能改写旧JSON为修后结果。`real-probe.py`新增可选`fixed`期待模式，执行当前实际helper并将结果写到`../smoke-local-client-exit-race-fix/`；旧默认模式和历史结果保持。修后验收见该目录README。
