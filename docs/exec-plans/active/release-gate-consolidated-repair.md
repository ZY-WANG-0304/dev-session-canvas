# 收口发布门禁修复并补齐 systemd probe 夹具

本计划按 docs/PLANS.md 持续维护。设计结论记录于 docs/design-docs/systemd-smoke-scope-root-cause.md；历史根因调查与原失败证据保留。

## 目标与全局图景

让无用户 systemd bus 的干净测试机稳定验证假 systemd 后端的原窗口重开契约，同时保留生产真实执行环境探测及明确不可用才回退的规则。PR329统一包含剩余关联修复、根因文档、回归及WORKFLOW改动；发布PR327独立。用没有PR的临时组合分支验证0.26.1完整发布输入，不合并、打tag或发布。

## 进度

- [x] (2026-10-13) 获取main22803dd8及PR329/331/327最新head，保留原工作区WORKFLOW修改。
- [x] (2026-10-13) 导入PR331最终文档/证据，选择受限probe执行依赖并同步正式方案。
- [x] (2026-10-13) 实现fake probe转发、场景作用域；84项scope及12项实际launcher/超时/子进程收口/场景回归通过。
- [x] (2026-10-13) 本地回归/typecheck/build通过，PR329已推40364a85，PR331最终内容保留后关闭。
- [ ] (2026-10-13) 临时分支已组合PR327，前两轮分别失败于fallback VSCode IPC路径；最新含全部修复输入44282298/run38417836576进行中，剩余完整结果与证据同步。
- [x] (2026-10-13) 补齐fallback短user-data路径，实际Unix socket/空bus/settings回归通过；原main基线新用例exit1；前两轮失败分别保留。
- [ ] 第三轮44282298/run38417836576完整门禁等待结果。
- [ ] 保留原失败和最新结果，同步文档/证据及PR状态，归档本计划。

## 意外与发现

首轮38412908952已过原fake systemd重开，两阶段exit0；新fallback启动前VSCode使用129字节user-data IPC路径，警告107上限并listen EINVAL。补齐fallback短user-data夹具，真实空bus/no-submit保持；临时脚本隐式errexit漏写exit标记，实际job/log exit1保留。

旧fake-systemctl只覆盖提交阶段；新增scope probe使用绝对systemd-run。原组合38387068827失败，固定输入诊断38401537709确认Connection refused/明确不可用后正确回退legacy。单变量38402006541只替换执行者为原只读launcher后原setup/verify通过。该证据解释夹具缺前置依赖，不证明真实manager通过。原工作区docs/WORKFLOW.md已有用户编辑，复制其准确diff到修复worktree并保留原编辑。

## 决策记录

2026-10-13：按用户要求延续PR329并保留PR327，不新建文档/诊断/验证PR。PR331最终文件导入后关闭；继续将开放PR320/322/326的新增文档/证据（基于各merge-base的三点diff）导入并保留输入时点，现有主线结论不被旧整树覆盖；临时workflow只存在临时组合分支，不进入修复PR。

2026-10-13：沿用现有Node/systemctl shim约定，新增绝对路径的TEST_SYSTEMD_RUN_SHIM，只转发原launcher probe。保留真实默认命令、所有参数、预算及回执校验；fallback显式不启用该替代。相比伪造available，可测试真实子进程环境身份与错误分类。

## 结果与复盘

正式probe依赖及回归已实施；84项scope、12项实际子进程/launcher/场景、26项准备、runner env、typecheck、指定既有资产build通过。完整门禁尚未完成。六平台同输入资产已成功，run38412908952正在运行unfiltered release:verify。自审修正相邻超时/终止测试的旧PID文件误读后，12项实际用例再次通过；该测试修正后的最新完整输入仍需重跑。历史完整失败、诊断失败和控制通过分别保留；不能用单项通过追认发布成功。

## 上下文与定向

工作树/tmp/r327fix在smoke-release-gate-repair分支，PR329头dfa024ae；main22803dd8；PR327发布分支release-0-26-1-refresh头42d87b3d。runtimeSystemdEnvironment.ts在原短命准备launcher中执行只读环境探测，验证nonce和两个摘要后报告available/unavailable/unknown；runtimeRootPreparation.ts只在unavailable时回退，unknown不提交。scripts/smoke/run-vscode-smoke.mjs的fake成功场景目前只设置systemctl.cjs，缺probe依赖。fake并不代表原生manager，真实manager测试须单独说明。

## 工作计划与里程碑

首先在runtimeSystemdEnvironment.ts增加显式Node脚本依赖，默认真实命令保持相同。新增fake-systemd/systemd-run.cjs仅接受原受限probe参数并执行原launcher，转发stdout/stderr/退出及信号。成功场景启用，fallback显式清空。扩展40项真实源函数受控测试，新增实际子进程转发与环境匹配/不匹配/非法回执用例，接入npm test。

第二阶段在PR329收口文档、回归和用户WORKFLOW改动，相关检查通过后fetch/rebase/push并改写PR描述，确认PR331最终内容被保留后关闭。最后从修复头切临时分支，按顺序cherry-pick PR327的五个发布提交。暂存追加冲突时保留双方记录；无需改PR327。临时push workflow以组合内容提交为不可变input_ref调用runtime-execution-assets.yml六平台构建，然后干净Node22/npm ci/Playwright准备、同输入资产组装、原release:preflight和release:verify。若产生关联新失败，在同一PR修复，保存第一失败并重跑新输入。

## 具体步骤

在/tmp/r327fix，PATH以/tmp/dsc-release-node22/node_modules/node/bin开头；暂时链接/tmp/sf26/node_modules，不能通过链接npm ci。运行node scripts/test/test-runtime-systemd-environment.mjs、新增fixture测试、node scripts/test/test-runtime-root-preparation.mjs、node scripts/test/test-vscode-smoke-runner-env.mjs、npm run typecheck与DEV_SESSION_CANVAS_EXECUTION_ASSETS_SET=/tmp/dsc-release-026-assets npm run build。新probe测试不需要原生asset，实际原launcher以esbuild在私有临时目录构建。

临时分支workflow固定发布组合内容SHA，原生资产和验证checkout使用相同SHA；不用旧asset冒充新输入。完整release:verify不得设置scenario filter，预期包括npm test、systemd成功/真实不可用fallback、SSH退出/保留、Webview以及clean-checkout生产VSIX/安装后smoke。记录run/job/input/tree、各步骤实际结果及日志hash；不会将未触达写成通过。

## 验证与验收

默认真实绝对命令和原15秒/16KiB参数受控断言不变。新执行依赖通过实际只读launcher产生正确nonce/环境/用户摘要才available；环境不匹配为unavailable，非法回执/错误/超时为unknown且不重试。fallback场景没有fake probe且systemctl日志不存在，unknown准备负例零提交。原系统后端、保证等级和进程身份断言保留。最终临时输入完整门禁必须通过；合入修复后PR327仍需最新正式预合并门禁。

## 幂等性与恢复

仅编辑自己的修复和临时worktree，不chmod真实共享socket、不删除未知目录/进程。原工作区编辑保留。fetch最新目标后rebase；如确需强推，force-with-lease固定先验证的远端SHA。临时分支不创建PR，不改正式workflow。CI失败保留输入/日志及有界证据；修复后新run独立记录。

## 接口与依赖

不新增用户设置或库。测试执行依赖名DEV_SESSION_CANVAS_TEST_SYSTEMD_RUN_SHIM，Node选择沿用DEV_SESSION_CANVAS_TEST_NODE_PATH；仅绝对脚本路径可启用，生产默认仍/usr/bin/systemd-run。fixture直接继承受控环境并执行原--probe-root-environment；无数据库、Supervisor或socket副作用。

修订记录：2026-10-13按用户集中PR要求创建计划，明确probe依赖和临时完整验证输入边界。

修订记录：2026-10-13核对仍开放的关联文档PR320/322/326，集中新增证据、修复有效文档引用与接管描述；历史失败状态保留，旧状态明确限定原输入。
