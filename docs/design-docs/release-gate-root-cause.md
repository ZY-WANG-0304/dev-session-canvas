---
title: PR327 发布门禁准备失败与诊断等待边界调查
decision_status: 已选定
validation_status: 已验证
domains: [VSCode 集成域, 执行编排域]
architecture_layers: [宿主集成层, 适配与基础设施层]
related_specs: [docs/product-specs/runtime-persistence-modes.md]
related_plans: [docs/exec-plans/completed/release-gate-root-cause.md, docs/exec-plans/completed/release-gate-repair.md]
updated_at: 2026-10-13
---

# PR327 发布门禁准备失败与诊断等待边界调查

## 问题与范围

PR328合入后，PR327预合并7e659ce6的GitHub门禁在runtime-checkpoint-refresh基础Agent启动失败；本地相同tree的ec4afba3在local-links-and-stop超时。本文记录分别定位的证据，以及用户于2026-10-13授权的修复。修复分支从最新origin/main22803dd8创建，不包含版本更新；PR327保持独立。

## 当前结论

本地等待helper漏检已确定性复现：原waitForDiagnosticEvents在异步取回结果后，仅在下一轮Date.now小于deadline时检查predicate。读取跨越截止会直接报错，即便末批事件精确匹配。原renderer日志显示首次missing-target.ts搜索耗时9592ms、第二次321ms，QuickOpen在08:35:57.262Z调用，事件在57.295Z到达，57.494Z报错；动作请求ID对应47.328Z。原墙钟没有记录准确helper起点/取回瞬间，不能将事件实际到达时刻自动等同deadline内取回。受控脚本保留原函数和正负场景，不实施修复。

原Host日志进一步记录等待开始附近的getDiagnosticEvents调用47.334Z、末次事件前调用57.241Z，以及后续57.341Z调用；匹配事件在两次调用之间到达。它佐证sleep/读取跨越截止的漏检路径，但仍不是helper入口/返回精确计时。原rg命令使用--no-ignore、--follow，只有.git等默认排除，没有node_modules排除；cmdTime9591ms与renderer耗时一致。可确认搜索扫描范围与时长，不能确认历史文件数量、冷缓存或资源争用的贡献。有限原始摘录和源日志hash见docs/references/release-gate-root-cause/local-search-timeline.json。

CI诊断run38382436173在固定原预合并7e659ce6、原六平台native资产与原预算/断言下再次首败于runtime-checkpoint-refresh。阶段日志确认ensureRuntimeRootSocketDirectory中的assertPrivateStorage抛出“Root runtime owner storage must be private to the current OS user.”，还未进入native-assets。专用catch保留堆栈后仍返回原失败；页面ready、Agent error、没有execution与历史首败一致。末尾磁盘剩余77516996608字节。有限摘要、input/run/job与日志hash见docs/references/release-gate-root-cause/ci-preparation-result-38382436173.json及ci-preparation-summary-38382436173.json。

污染源是PR328新增scripts/test/test-smoke-remote-host.mjs的“Supervisor request has a total deadline even when socket stays silent”：control.runtimePaths把临时storage映射到真实/tmp/dsc-root-<uid>/d-<hash>.sock，测试mkdir父目录未指定mode，且finally仅清理storage，保留共享父目录。npm test先执行该测试再进入test:smoke。干净环境中umask0022使新父目录为0755，后续root准备要求0700而拒绝；本机父目录已为0700，mkdir不改变现存权限，掩盖了问题。原函数受控对照socket-directory-pollution.mjs只将固定socket目录映射到私有夹具：两次原17用例均exit0；absent变0755并被原生产校验拒绝，预置0700保持同inode并通过。

干净GitHub run38384582823固定同原输入，未修改产品或原测试源码，已直接核验真实目录：初始不存在，原17用例exit0后属主等于当前uid、权限0755、目录为空且被保留；原生产校验报同样错误。仅把该次自己新建且身份确认的空目录chmod0700后，同inode的原校验通过，最终rmdir清理。摘要见ci-socket-evidence-38384582823.json，run/job/log hash见ci-socket-result-38384582823.json。该因果对照通过不等于发布完整gate通过。原历史run没有目录stat，不能声称恢复了历史inode/mode；重现、源码顺序与正反对照已确认污染机制。调查机制已验证；用户已授权下述修复，本轮“已验证”指两处修复的回归及同输入原首败场景通过；完整组合发布gate仍失败，见下述新阻塞。

原模式只请求legacy-detached，禁用D-Bus，排除systemd选择候选。CI原六平台全部构建通过，Linuxmanifest/binary与本机逐字节相同；具体诊断失败早于native-assets，因而资产不是该次首败触发点。原固定输入stock VSCode1.141.0独立checkpoint全场景exit0，不代证CI首败或完整gate通过。

## 验证方法与证据

计划记录docs/exec-plans/completed/release-gate-root-cause.md。diagnostic-wait-boundary.mjs在vm中读取并执行原helper；CI诊断run38382436173固定原预合并和原native资产，运行完整gate，仅临时为准备函数加入阶段和catch错误文件记录，原返回、启动责任、预算和断言保留；它是诊断运行，不是正式最新发布门禁。测试结束恢复临时源码，上传固定摘要，不上传原环境/凭据/SSH私钥或全HOME。源码日志变更发生在隔离checkout；当时正式修复未获授权，后续用户授权方案见正式方案。

在捕获socket-directory异常后，专用workflow切换为ci-socket-directory-evidence.mjs的有限干净runner对照，固定同原输入，不再重跑全量：必须先确认目录不存在，再执行原17用例、读取实际uid/mode/inode与空目录、调用原生产目录校验；仅对自己新建且身份/内容已确认的空目录chmod0700作因果对照，然后rmdir。该实验变更不是正式修复、不作为最新release gate。若目录事先存在则拒绝实验，不接管未知状态。

两个workflow版本与脚本已归档至docs/references/release-gate-root-cause/ci-preparation-trace.workflow.yml及ci-socket-evidence.workflow.yml，调查完成后移除.github/workflows中的临时自动入口。actionlint1.7.12和Node语法检查通过，原helper五个受控边界与原17测试两组目录对照均通过预期判定；正式发布仍需修复后最新预合并全量验证。

## 正式方案

用户已授权修复两处确定问题。tests/vscode-smoke/remote-host-control.cjs的requestSession增加可选第四参数options.socketPath，仅供静默socket夹具连接自己创建的短路径；未传入时继续使用runtimePaths(storageDir).socketPath，attachSession请求、响应校验和总超时保持原行为。scripts/test/test-smoke-remote-host.mjs在mkdtemp目录中监听control.sock，finally先销毁连接、关闭server，再删除自己的临时目录。不得创建、chmod或清理真实/tmp/dsc-root-<uid>，不得放宽生产0700检查。

同文件新增默认地址回归：实际私有server接收并响应attachSession，但测试拦截连接地址，确认默认调用仍选用正式runtimePaths地址，再将连接转到自己的server。独立隔离回归运行完整Remote Host测试，将helper内的真实socket目录映射到私有夹具，核对不存在、已存在0700、已存在0755三种初始状态均完全不变，且保留哨兵文件内容和目录身份。映射只隔离对照路径，不能替产品补目录权限。

tests/vscode-smoke/extension-tests.cjs中的waitForSnapshot和waitForDiagnosticEvents采用一致的末次观察规则：首读后立刻检查predicate；每次不匹配后计算剩余时间，若没有预算则失败，否则只sleep min(100, remaining)再读。任何已经启动的读取都检查结果一次，再判断是否超时；包括首读或末读返回跨越截止的情况。末读不匹配且预算耗尽时立即失败，不再重试。保留原15000/8000默认预算和各调用的10000等显式预算。

该契约是轮询观察预算，不是对VSCode IPC挂起的硬截止保证；已启动的读取返回晚于截止时仍会检查。它消除“报错的Last events已经匹配”的自相矛盾，不证明链接搜索按时完成，也不治理搜索扫描范围或延长等待。terminal-resize helper的严格总deadline和晚到成功拒绝规则不变。scripts/test/test-smoke-wait-boundary.mjs在vm中执行仓库内两份原函数，控制时钟、sleep和读取，覆盖首读、末读、截止相等/跨越、不匹配与错误传播，并核对默认预算。

## 验证与交付边界

先验证确定性回归在原main失败、修复后通过，再运行Remote Host、等待边界、resize、相关smoke辅助测试与构建。完整release:verify需要干净runner和同输入六平台native资产；本机余盘约1GB不足复制完整原生场景依赖，不启动会污染原失败证据的全量本地运行。

正式bugfix PR只包含两处修复、回归与调查证据。另建明确标识“仅验证、禁止合并”的临时组合PR，输入为本修复加PR327发布准备内容，复用未修改的Release Preflight工作流验证0.26.1，记录head/base/预合并SHA、tree、run与结果。该结果不能代替修复合入后PR327最新预合并的正式门禁；不将未合并修复塞进PR327，不合并、打tag或发布。

生产root准备错误的阶段可观测性与失败工件收集是后续诊断改进，需返回有界、无敏感路径的错误类别，不能把通用catch转ready或提交后换backend。历史首次失败与调查脚本/结果保留；原基线诊断脚本只用于原输入，不改写其预期来覆盖首败。

修复本地验证已完成：36项等待边界、18项Host控制、三种目录初始状态隔离、9项resize严格截止、19项reset、14项output、6项history、typecheck和指定既有原生资产build通过。新增回归在原main私有副本两者均exit1，分别报告匹配首读被遗漏与不存在目录被创建为0755。结果和源码hash见repair-local-checks.json、repair-baseline-regression-result.json；未运行本地完整release:verify。

临时组合验证PR330（禁止合并）已创建，head b88e4ac40f6ca7ef0bf6207f290922361c587f8f，base 22803dd890855ffbe7620538b04940def097171b，GitHub预合并08f7b0a52f5af27ced04b00a839f525a92659d63、tree 884936f9668c6a83fe1d5448350278d8649bc8e5。Release Preflight run38387068827使用该固定输入，已结束failure；静态preflight通过，完整组合gate失败。独立bugfix PR329的普通Preflight run38386931434明确跳过发布验证。

## 修复验收与新发布阻塞

run38387068827/job115263574447同预合并08f7b0a5的六平台资产全部成功；干净runner的18项Host、三种完整套件目录隔离、36项等待和9项resize通过。原首败local-links-and-stop于11:11:06Z退出0并记录Rendered terminal links and original owned execution stop completion passed；runtime-checkpoint-refresh于11:11:56Z退出0并记录Runtime paged terminal projection smoke passed。trusted/restricted、legacy upgrade及本地real-reopen也通过，证明原故障在本轮输入中已越过。

完整gate首败变为systemd-user-real-reopen setup：11:20:01Z的assertExecutionRuntimeMetadata（tests/vscode-smoke/real-reopen-tests.cjs:747）预期systemd-user，实际legacy-detached；11:20:03Z npm test和release:verify退出1。新阻塞单独登记，不能借这些通过声明完整npm test/发布验证通过。源码显示fake-systemctl仅替代后端提交，root准备仍通过真实/usr/bin/systemd-run做执行环境探测；本轮未保存探测原因，不能把缺少user bus当作已经验证的唯一根因。

后续systemd-fallback、SSH Host退出/保留、test:webview及clean-checkout生产VSIX/安装后smoke未触达。有限成功记录、首败、准确input/run和日志range/hash见repair-combined-input.json；原首败记录保持。临时PR330结果归档后关闭，不合并。两处修复在PR329供review，PR327仍草稿且正式最新预合并需修复合入后rebase验证。
