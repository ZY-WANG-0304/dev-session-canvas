# 修复本地客户端后代退出与发信号的竞态

本 ExecPlan 按 `docs/PLANS.md` 持续维护。2026-10-14 用户已批准修复已确认的 ESRCH 夹具缺口；代码、确定性回归、根因和证据集中到一个独立修复 PR，发布准备保留 #327。

## 目标与全局图景

SSH exit/retain 门禁清理本地 VS Code 时，后代在身份检查后自行退出不应让测试提前失败；权限错误、根进程异常和仍在运行的原后代仍须失败。原会话恢复、输入和 resize 验收继续执行，不改变产品行为、版本或等待预算。

## 进度

- [x] (2026-10-14) fetch 确认最新 main `f3bb4425`，从 main 创建 `/tmp/lcfix`、分支 `smoke-local-client-exit-race-fix`，转入诊断记录，不创建诊断 PR。
- [x] (2026-10-14) 确认正式修复边界：只在后代 SIGKILL 的 ESRCH 后复查原身份不再运行；保留根SIGKILL、作用域和退出后置条件。
- [x] (2026-10-14) 默认控制套件新增21项，旧helper读后消失在114行ESRCH失败，新helper39/39通过。
- [x] (2026-10-14) 实施后代ESRCH复查/错误记录，隔离3/3、resize9/9、runner环境和真实内核回收竞态通过。
- [x] (2026-10-14) 主扩展/notifier构建通过，VS Code1.141.1原生exit/retain分别完成原会话/输入/resize/清理验收。
- [x] (2026-10-14) 同步正式设计/索引/信念/技术债与研究/修复证据，保留聚合ENOSPC首轮和独立retain结果，计划移completed。
- [x] (2026-10-14) 提交/rebase最新main，创建PR #333；初始head e0482d89 的run38564849589 Resolve release input/Verify release contract成功、native-assets明确跳过（无发布契约，不是完整发布验证）。

## 意外与发现

根因研究证明原helper100/100受控读后消失抛ESRCH，真实Linux内核回收对照同栈失败；旧18项通过未覆盖有后代的客户端。首败run38539427680与本机受控PID分别登记，CI具体后代身份未记录，不可补造角色或上游缺陷。

诊断曾磁盘近满而使用`/dev/shm`。修复开始时磁盘释放到约2.8GB，正式原生测试在短路径`/tmp/lcfix`进行；复用相同lock的node_modules软链接和原版VS Code缓存，不执行穿软链接的npm ci，也不复制多份1GB宿主。

聚合npm run test:smoke在exit完整通过后，准备retain复制workerd因ENOSPC退出1，未启动retain。确认exit cleanup.pass=true及载荷无进程使用后，保存工件/hash并回收本次结束复制依赖/server与未启动的部分依赖；用新debug根单独retain完整exit0。首轮失败不追写为通过，所有原预算/断言保持。

## 决策记录

2026-10-14：新增默认回归执行实际CommonJS helper，用node:vm隔离/proc和process.kill控制依赖；不为测试给生产夹具新增配置接口。ESRCH后复查时原身份absent、Z/X或已被新身份取代可继续；同一原身份仍live抛原错误。所有错误记录目标身份/code；原成功信号列表只记录成功，不把ESRCH计为SIGKILL成功。

2026-10-14：原生两条SSH场景验证是本修复验收，完整发布门禁在修复合入后由#327最新预合并结果另跑；本次定向通过不能替代正式发布闭环。未获合并/tag/发布授权。

2026-10-14：actual=null显式记录原身份已不存在，避免JSON省略undefined使下次首败缺复查状态；ESRCH后Z/X/replacement也各有默认回归。真实内核实验添加fixed期待模式，只写新修复证据目录，原研究JSON与基准SHA保持。

## 结果与复盘

正式修复已完成并定向验收通过：默认39项、隔离3项、resize9项、runner环境和真实内核竞态、原版VSCode1.141.1原生exit/retain均通过。原根因记录保持，首轮聚合ENOSPC与补验分别登记。PR #333 已创建：https://github.com/ZY-WANG-0304/dev-session-canvas/pull/333 ，等待review/合并授权；修复合入后仍须#327最新完整发布门禁，不能以定向通过放行发布。

## 上下文与定向

`tests/vscode-smoke/remote-host-control.cjs`的`abortLocalClient`核验本次spawn根PID/startTicks、UID、私有userData和executable，扫描后代树，先杀根再倒序杀后代；随后确认根signalCode为SIGKILL、原根身份消失、后代无同身份live。原第114行发后代SIGKILL没有catch，异步读取/proc返回live后目标可退出，kill找不到目标返回ESRCH。startTicks是内核启动时间计数，用于区分同PID的新进程；Z/X代表不再运行状态，EPERM代表无权发信号。

`scripts/smoke/run-vscode-smoke.mjs`等helper返回才核验旧远端Host仍保留；exit主动结束核验私有范围的旧Host，retain保留到业务完成。私有文件释放第三终端完成，verify恢复原Supervisor和原session，检查输入/resize/完成终态与cleanup。此次修改不改这条业务链。

## 工作计划与里程碑

第一里程碑把诊断机制接入默认`test:smoke-remote-host`：实际helper的正常后代、读前消失、读后消失、僵尸/PID替换、ESRCH后仍live、EPERM、根异常、UID/私有作用域错误和仍在运行后置条件。先用原helper运行新增读后消失用例，应在114行ESRCH失败；再实施catch，只允许ESRCH且原身份不再运行继续。report新增错误列表保留原身份及复查结果，便于下次首败定位。

第二里程碑执行完整相关控制套件、共享socket隔离三个初始状态、resize和runner回归；构建主扩展/notifier，用未修改VS Code1.141.1缓存执行remote-ssh-real-reopen聚合入口。必须同时证明exit/retain的旧Host、原Supervisor/session、输入、真实PTY尺寸、完成终态和清理成立。

第三里程碑同步根因正式方案与验收证据，诊断历史结果保持独立。fetch/rebase目标后推送创建一个普通修复PR，等待其required CI；#327仍保留draft，修复合入后再rebase/完整门禁。

## 具体步骤

工作目录`/tmp/lcfix`，Node22为`/tmp/dsc-release-node22/node_modules/node/bin/node`。新增回归通过既有`test:smoke-remote-host`运行，不新增npm依赖。相关命令：

    node scripts/test/test-smoke-remote-host.mjs
    node scripts/test/test-smoke-remote-host-isolation.mjs
    node scripts/test/test-smoke-terminal-resize.mjs
    node scripts/test/test-vscode-smoke-runner-env.mjs

构建复用`/tmp/dsc261fresh/node_modules`同lock依赖，`DEV_SESSION_CANVAS_EXECUTION_ASSETS_SET=/tmp/dsc-release-026-assets`。正式原生命令使用Node22在PATH，`DEV_SESSION_CANVAS_VSCODE_TEST_CACHE_PATH=/tmp/mpfix-vscode-cache`、`DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=remote-ssh-real-reopen`，新debug根`/tmp/lcfix-native`；运行完整`npm run test:smoke`会先build两扩展，再执行两条场景。保持原ready45秒、恢复35秒、resize20秒和10秒清理预算。证据输出写到`docs/references/smoke-local-client-exit-race-fix/`，不收SSH密钥或完整环境。

## 验证与验收

新增读后消失用例在旧源码失败、新源码成功，正常清理/退出前消失/Z/X/新身份继续；原身份仍live的ESRCH、EPERM、根异常、UID/私有范围拒绝与清理后仍live失败。成功发出SIGKILL和ESRCH退出确认在report分别记录，最终退出检查执行。原生exit/retain分别独立建立旧Host条件，原会话输出/输入/真实resize与cleanup全部通过。PR CI只覆盖其真实输入，不把无发布契约跳过写成完整release:verify通过。

## 幂等性与恢复

所有工作在独立worktree，保留主工作区dirty WORKFLOW和发布分支。VM只用虚拟PID，原生fixture仅清理本次自有身份；失败工件保留，不自动重试覆盖首败。node_modules链接结束后删除链接，不删除共享依赖；缓存保持原版。推送前fetch/rebase，未来更新force-with-lease固定旧远端head，绝不force目标main。

## 证据与接口

正式方案和历史首败在`docs/design-docs/smoke-local-client-exit-root-cause.md`，研究资料在`docs/references/smoke-local-client-exit-investigation/`。新增回归不要求新产品接口。`abortLocalClient`签名保持，report的`localSignals`保留成功信号，新`localSignalErrors`记录后代失败信号原身份、错误code及ESRCH后复查身份。剩余CI具体进程身份未知与完整发布验收范围写入tech-debt-tracker。

修订记录：2026-10-14 用户批准修复，创建独立修复分支与计划，接入本地诊断材料，确定有限错误处理与默认回归/原生两状态验收。

修订记录：2026-10-14 完成代码与39项回归、3项隔离/9项resize/runner环境/真实内核；原生exit完整通过后聚合因磁盘失败，安全回收本轮载荷后独立retain通过，结果分别保留；同步正式文档与证据，计划移completed，PR交付状态随后补齐。

修订记录：2026-10-14 完成提交/rebase并创建PR #333，登记初始head真实CI结果；无发布契约的跳过不算完整发布门禁，review/合入和#327最终验证保持后续范围。
