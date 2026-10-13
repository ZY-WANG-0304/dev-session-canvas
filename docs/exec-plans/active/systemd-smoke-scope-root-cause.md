# 定位 fake systemd 重开门禁后端不匹配

本计划按docs/PLANS.md维护；设计结论记录docs/design-docs/systemd-smoke-scope-root-cause.md。调查分支docs-systemd-smoke-scope-root-cause从origin/main22803dd8创建，工作树/tmp/sd330rca。用户本轮请求定位根因，正式修复、合并和发布不在本轮范围。

## 目标与全局图景

解释组合0.26.1门禁run38387068827在systemd-user-real-reopen setup的agent runtime backend mismatch：预期systemd-user，实际legacy-detached。需要把明确的生产选择条件、夹具假设和干净runner实际探测结果对应起来，给出证据支持的修复边界；不更改断言、预算、发布输入或用其他通过替换失败。

## 进度

- [x] (2026-10-13) 固定原预合并08f7b0a5、tree884936f9、失败job115263574447和完整日志hash776333b2。
- [x] (2026-10-13) 从最新main22803dd8创建独立调查worktree，确认PR329未合并、PR327仍独立。
- [ ] 追踪backend override、发现已有owner、环境scope probe和systemctl测试替代链路。
- [ ] 在固定原输入干净runner只加入有限观测，复现原场景并捕获具体scope类别。
- [ ] 用真实函数受控正反条件验证该类别的选择行为，必要时验证候选夹具控制。
- [ ] 同步结论/限制/技术债，归档证据和计划；移除临时workflow入口，提交调查文档。

## 意外与发现

原systemd-user场景提供DEV_SESSION_CANVAS_TEST_SYSTEMCTL_SHIM与success模式，但root准备的inspectRuntimeSystemdEnvironment执行绝对/usr/bin/systemd-run，不读取该shim。原VSCode日志在该场景记录DBUS_SESSION_BUS_ADDRESS=disabled:及自有XDG_RUNTIME_DIR。环境变量与实际fallback的关系待具体结果确认，不能由这两项静态事实直接断言唯一原因。

原完整门禁已越过PR329修复的links/checkpoint，多root和双窗口也通过。当前失败是后续systemd选择不匹配，不扩大为此前两处修复回归或VSCode缺陷。

## 决策记录

2026-10-13：固定08f7b0a52f5af27ced04b00a839f525a92659d63，重用原run38387068827同输入六平台native资产，干净runner只跑systemd-user-real-reopen，有限日志保持原返回/断言/预算。理由是避免全量重复与本机存量状态掩盖根因。

2026-10-13：探测记录只含preferredBackends、发现/选定backend、available/unavailable/unknown及有界错误类别；不上传原环境、凭据、私有路径、全HOME或SSH材料。诊断源码仅存在隔离checkout，后续还原；临时workflow最后归档移除。

## 结果与复盘

当前已发现fake-systemctl替代范围与新增真实环境探测不一致的候选链路。具体实际原因与生产fallback路径尚未验证，不作为正式结论。

## 上下文与定向

scripts/smoke/run-vscode-smoke.mjs的runSystemdUserRealWindowReopenScenario用fake-systemd/systemctl.cjs替代systemctl，并断言systemd-user/strong。runtimeRootPreparation.ts在短命launcher内先发现原owner，再以inspectRuntimeSystemdEnvironment核对manager执行环境，明确unavailable才能尝试legacy，unknown保守停止。runtimeSystemdEnvironment.ts调用真实/usr/bin/systemd-run并校验nonce/environmentKey/userIdentityKey；runtimeSupervisorStart.ts只在提交阶段读取systemctl shim。tests/vscode-smoke/real-reopen-tests.cjs setup启动三个原执行后对metadata backend断言，747行agent失败。

历史输入为已关闭临时组合PR330 headb88e4ac4，base22803dd8，预合并08f7b0a5；PR329修复代码27616f66与后续文档head一致。原六平台资产来自同一run38387068827，已全部构建通过。完整日志/tmp/pr330-release-verify-completed.log有11911437字节，sha256776333b2ae6f71fda7c8a59877b7455cb096e3a7efdcea7e9aa9523a25a4b44e。原失败没有scope结果记录，新的诊断只能说明机制/复现，不声称补回历史未记录事实。

## 工作计划

先追踪override怎样成为request.preferredBackends，并排除发现已有owner提前返回。为两份源码增加只读有限trace：scope真实结果、exec callback固定错误类别、发现结果及启动选定backend，保持原返回。临时workflow checkout固定输入，安装原依赖，下载原同输入native资产，运行原systemd-user场景。always步骤归档有限trace与exit，恢复源码，不上传整个工件目录。

捕获具体类别后，以相同生产函数受控available/unavailable/unknown正反条件确认fallback与no-submit；如需因果控制，只在独立诊断副本替代探测执行边界、运行相同断言，明确不作原生manager或正式修复证明。最后正式中文文档记录原因与适用限制，技术债接续候选修复时机。

## 具体步骤

在/tmp/sd330rca读文件/写文档；使用Node22.23.3和与相同lockfile的/tmp/sf26/node_modules（临时链接，不npm ci）。执行现有node scripts/test/test-runtime-systemd-environment.mjs与node scripts/test/test-runtime-root-preparation.mjs，预期40项scope和26项准备受控用例通过。新增诊断工具置于docs/references/systemd-smoke-scope-root-cause/，Node语法和actionlint核验临时workflow。

CI使用gh workflow run指定调查分支，原测试输入checkout08f7b0a5，资产下载38387068827并assemble --input-sha 08f7b0a5。执行DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=systemd-user-real-reopen node scripts/smoke/run-vscode-smoke.mjs，保留原非零exit；诊断工具记录有限结果artifact。等待期间及时汇报实际状态，不改workflow正式入口，不发消息给第三方。

## 验证与验收

必须明确原preferredBackends含systemd、是否先发现ready、scope具体reason、最终选定legacy及相同断言失败。原函数在确定available时只能选systemd，在确定unavailable时才能选择legacy，在unknown时不提交不fallback。候选夹具验证如有通过，单独标诊断控制，不代证正式发布或真实systemd环境通过。

## 幂等性与恢复

只在自己的worktree和CI隔离checkout做注入，保留原失败和新run。trace文件使用RUNNER_TEMP下独立路径；不chmod共享socket目录或删除未知进程/存量工件。临时workflow不改正式发布工作流，验证完归档移除，正式源码恢复；不会合并/打tag/publish。

## 证据与备注

原成功/首败有限摘要见PR329中的docs/references/release-gate-root-cause/repair-combined-input.json。新证据另存systemd-smoke-scope-root-cause目录，记录诊断head、input/run/job、source/trace/log hash和未捕获的历史scope原因。

## 接口与依赖

不新增产品API、配置或正式依赖。诊断只用Node fs、child_process、vm/esbuild、GitHub现有工具和原资产；源码插入记录函数不改变实际观察返回。候选修复仍需明确测试替代与原生systemd验证边界。

修订记录：2026-10-13创建根因调查计划，固定前轮失败输入，明确真实scope探测与fake提交边界并安排干净runner有限观测。
