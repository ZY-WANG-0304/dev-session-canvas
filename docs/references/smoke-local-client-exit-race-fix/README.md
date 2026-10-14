# 本地后代退出竞态修复验证

本目录记录已批准正式修复的定向验收。原首败与根因研究仍在`../smoke-local-client-exit-investigation/`，不由修后通过覆盖。正式方案见`docs/design-docs/smoke-local-client-exit-root-cause.md`。修复分支`smoke-local-client-exit-race-fix`从main `f3bb442526b1f5eb57171a5b24c9a6bca868756f`创建，worktree `/tmp/lcfix`。

## 输入与回归

修复只改`tests/vscode-smoke/remote-host-control.cjs`的后代SIGKILL错误处理，helper SHA256 `81e4b5f900b38faf56421774b188d35e02486e7a65d9778592064b82b9a26225`。ESRCH后复查同一原身份是否不再运行，actual=null明确记录已不存在；成功信号列表与失败信号列表分别保存。其他错误、原根SIGKILL和后代退出后置条件保持。

`scripts/test/test-smoke-remote-host.mjs`新增21项默认回归，逐字加载实际helper、隔离/proc和signal接口，无正式配置覆盖。旧helper运行新增读后消失用例在原114行ESRCH失败（`/tmp/lcfix-before-regression.log`）；修后39/39通过，原socket目录隔离三个初始状态全部通过，resize9/9与runner环境过滤通过。`validation.json`登记完整日志路径/字节数/SHA，原生包含环境的大日志不复制入库。

实际Linux回收竞态也通过：root2430723实际SIGKILL，leaf2430724/startTicks260426168实际stat为S，Python waitpid回收exit0后真实kill ESRCH，helper记录原身份与actual=null并完成退出确认。`real-race-result.json`保留实际内核操作和新helper SHA。重试命令在仓库根：

    python3 docs/references/smoke-local-client-exit-investigation/real-probe.py /tmp/dsc-release-node22/node_modules/node/bin/node race fixed

`fixed`仅控制实验期待与输出目录，不改helper依赖或真实signal；原研究JSON不被覆盖。

## 原生SSH两状态验收

Node22.23.3、VS Code1.141.1、Remote SSH0.128.0；stock workbench SHA256 `1ca421d08f757de833ddb45c0939daedffcdb2d48204edf04424c49b3ad7a1a0`，缓存`/tmp/mpfix-vscode-cache`未修改。构建资产`/tmp/dsc-release-026-assets`，复用相同lock的`/tmp/dsc261fresh/node_modules`软链接，不执行穿链接npm ci。主扩展/notifier按正式默认构建通过。

首轮使用聚合filter remote-ssh-real-reopen运行`npm run test:smoke`。exit场景完整通过且cleanup.pass=true；随后准备retain时复制workerd遇ENOSPC，尚未启动retain，聚合命令exit1。`aggregate-attempt.json`和原日志hash保留。仅在确认exit零残留、没有载荷使用进程后回收其复制依赖/server和retain未启动的部分依赖，保留所有工件；释放空间后以新debug根单独执行retain，原断言/预算不变。`payload-cleanup.json`明确只回收本次已结束或未启动的重复载荷。

首次命令（在`/tmp/lcfix`，Node22加入PATH）：

    DEV_SESSION_CANVAS_EXECUTION_ASSETS_SET=/tmp/dsc-release-026-assets \
    DEV_SESSION_CANVAS_VSCODE_TEST_CACHE_PATH=/tmp/mpfix-vscode-cache \
    DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=remote-ssh-real-reopen \
    DEV_SESSION_CANVAS_SMOKE_DEBUG_ROOT=/tmp/lcfix-native npm run test:smoke

补验命令（构建相同）：

    DEV_SESSION_CANVAS_EXECUTION_ASSETS_SET=/tmp/dsc-release-026-assets \
    DEV_SESSION_CANVAS_VSCODE_TEST_CACHE_PATH=/tmp/mpfix-vscode-cache \
    DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=remote-ssh-real-reopen-retain \
    DEV_SESSION_CANVAS_SMOKE_DEBUG_ROOT=/tmp/lcfix-native-retain node scripts/smoke/run-vscode-smoke.mjs

exit原Host2398678/startTicks260422004在verify-ready和business-complete均original-absent，原Supervisor2403868/startTicks260422466持续S。retain原Host2648916及原Supervisor2652208在两阶段维持同身份live；详细startTicks与阶段状态见`retain-remote-host-business.json`。两分支原session/storage恢复、离开期间输出、后续输入、第三终态/snapshot-only/historyDiscarded成立，原Supervisor实际尺寸Agent67×21→82×27、Terminal64×20→85×28；业务pass=true、cleanup.pass=true、remaining/failures为空。`{exit,retain}-remote-host-{control,business,cleanup}.json`保留原字段、sourceArtifact和原工件SHA。

## 边界

本修复原生验证覆盖Linux localhost固定版本两状态；受控内核实验确定ESRCH路径修复，原生成功不意味着自然执行每次触发ESRCH。聚合首轮因磁盘失败仍保持exit1，单独retain通过不追认为首轮完整通过。没有执行完整release:verify、全套Webview或packaged smoke；#327在本修复合入后须按最新预合并输入完整重验。CI具体失败后代身份与自行退出触发原因仍未知，未归为产品/上游缺陷，未合并/tag/发布。
