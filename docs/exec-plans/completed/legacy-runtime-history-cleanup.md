# 修复已停止旧 Runtime 历史节点的删除与重新启动

本 ExecPlan 按 `docs/PLANS.md` 维护。设计结论位于 `docs/design-docs/runtime-persistence-closeout.md` 第 12 节，不重开原容量、Agent 或跨平台验收矩阵。

## 目标与全局图景

旧 Agent/Terminal 节点在重连失败后显示 History restored，但保留原 Runtime 绑定。当前严格删除必须取得原 Supervisor 的回包；原服务已经停止时，删除、清空画板与重新启动都可能永远失败。本次让有明确旧退出证据、且没有当前终端责任的历史节点可以删除或重新启动，同时继续阻止活跃和未知执行被绕过。

## 进度

- [x] (2026-10-06，第二现场) 核对06:23诊断与原registry，确认先前5个目标已走历史退役，剩余systemd目标保存live快照且没有退出码；另两个native detached错误不属同一后端证据。
- [x] (2026-10-06，第二现场) 补强systemd停止事实的Runtime丢失历史分支，核验81项/Host190项/类型检查/普通构建通过；保持原未知保护，独立复核无确定性blocker，刷新Main Only调试目录。
- [x] (2026-10-06) 读取现场给出的事实与目标 registry 的结构，确认 Host 缓存和 Client 未提交/已提交边界，制定有限方案。
- [x] (2026-10-06) 实现已知旧 systemd Runtime 的只读停止/终态核验，模块 56 项通过；两项真实 socket 验证受 sandbox 限制，明确跳过。
- [x] (2026-10-06) 接入 Host 的历史清理及未提交失败重试，Host 184/184 覆盖删除、重启、清空、保护/隔离与批量身份竞争。
- [x] (2026-10-06) 受影响回归、类型检查、普通构建与调试目录刷新通过，独立复审无新增确定性问题；原生 socket/实际现场的验证限制移交技术债记录，不冒称通过。

## 意外与发现

第二现场 `2026-10-06T06-23-48-298Z` 的目标 `4afdc52d-4e97-47e9-94ff-d838a2405a44` 为Terminal，旧registry仍为live:true/lifecycle:live且无lastExitCode；同存储4个Terminal和1个Agent删除失败均属这种陈旧快照。第一修复只覆盖写过退出记录的情况，不能覆盖Supervisor失联前未保存终态。当前sandbox的systemctl被EPERM拒绝，不能声称再次实测了当前服务；新路径必须在用户Host每次执行fresh检查，不能凭这个静态诊断或文件年龄放行。

Client 已在未提交 RPC 的失败后释放自己的观察记录，Host 却无条件复用原记录。不能通过无条件清空两个缓存解决，因为已提交且结果未知的 RPC 必须保留原身份。

第一轮判断：旧 Supervisor 的 registry 恢复会把失联 live 会话降级为 live:false 与 stopped/closed，因此recorded-exit资格另要求明确整数exit code；History restored、socket文件残留、registry旧时间均不是存活判断。第二轮另用更强systemd事实确认Runtime丢失，不因没有exit code永远锁住记录。

独立复核发现批量等待窗口：一个节点的检查先结束，不代表等其他绑定完成时其 reader/metadata 仍未改变。因此当次历史资格保留原身份的无副作用复查函数，所有异步检查结束后再复查；registry 也在两次服务/socket 检查结束后复查文件身份，不只检查读盘期间。

Host 新测试首次装配存在重复 mock 模块及缺少画板文件域字段，导致核验未被替换或删除后的正常重建抛错。修正夹具，不修改产品行为来绕过断言；`.debug/legacy-history-host-tests*.log` 保留这些失败。reader 原回归首次最后一个 headless 尾部用例超出 bounded task turns，新增责任断言均已通过；未改阈值/代码，原样重跑 20/20，不追认首次通过。

## 决策记录

2026-10-06（第二现场）：补独立的 `stopped-runtime` 资格，不再把“会话已有退出码”当所有历史清理的必要条件。原unit前后loaded/inactive/dead、无PID/Job/ControlGroup、无socket监听之外，该分支要求有效配置KillMode=control-group及SendSIGKILL=yes；精确目标记录必须结构合法，registry全程稳定。它只表示原systemd管理的Runtime已经停止，不表示会话正常退出、完整EOF或任意逃逸后代消失。原有明确退出记录走 `recorded-exit`，不额外要求新策略字段；两种依据均在Host诊断中区分，不改写共享registry。

2026-10-06（第二现场）：同包native `legacy-detached` / terminal-exit-v1 的两个Agent只有旧sessionNotFound文本、当前空registry及业务socket缺失，没有取得原owner缺席证据。现有namespace排他claim可作为后续有限方案基础，但不将systemd条件套用，也不读取metadata错误文字作为删除授权；该具名缺口记录技术债，不为本次问题新增通用进程诊断。
2026-10-06：只为 Linux systemd-user 的已知旧 generation `agent-provider-lifecycle-v1`、`terminal-stream-v1` 增加历史清理资格；其他后端、未知 generation、native generation 保持严格 RPC。只读原 unit/socket/registry，不启动旧服务、不改共享 registry。这样不会覆盖同 registry 其他会话或引入与服务写盘的竞争。

2026-10-06：使用独立的历史清理结果，不把原 unconfirmed 改为 acknowledged/EOF。未提交且已结束的观察允许下一显式操作重试；已提交、在途及最终消费/保存责任仍保持原观察。重启的准备阶段允许尚未提交的新创建意图，但不能允许已提交的新执行被绕过。

2026-10-06：只读系统观察不是跨进程原子锁，不能证明所有后代消失。清理不发送 stop/delete、不改旧 registry，只处理带明确旧退出记录且当前没有执行责任的本地历史；观察期间发现变化则拒绝。未知平台或后端不套用 Linux 结论，留在原严格路径，不增加本轮平台实验。

## 结果与复盘

第二现场增量已完成有限systemd修复。原 `4afdc52d` 及同unit的live快照不再因缺退出码必然失败，而须在操作时满足更强停止证据；不表示这次已在用户原窗口删除。两个native detached具名缺口继续保留，不能把空registry或旧错误字符串替代owner确认。以下第一轮结果保持原时点，第二轮验证另列，不追认未运行的原生检查。

有限代码修复与自动化回归完成，Main Only F5 staging 已更新；无需重启旧 Supervisor，符合只读资格的历史可经现有删除/重启/清空入口继续。没有操作用户现场节点、registry 或服务，不宣称已在其原窗口验收。两个真实 Unix socket 场景因 sandbox 权限被拒绝而跳过，其他 backend/generation 仍按原严格路径，范围与遗留验证见 `docs/exec-plans/tech-debt-tracker.md`。

本环境工作树外只读、网络受限，未提交、推送或更新 PR，不绕过 Git 元数据或现场操作权限。未重跑无改动的 Agent、容量、原生平台矩阵，也未新增工具阶段。

## 上下文与定向

`CanvasPanelManager.ts` 的 `deleteRuntimeSupervisorSessionsWithCandidate` 汇总逐绑定删除，`observeStrictRuntimeDelete` 持有 Host 观察；删除节点和 `prepareExecutionCandidateReplacement` 共用这条路径。`runtimeSupervisorClient.ts` 的 `StrictRuntimeDeleteObservation.submitted` 表示是否向原连接发出删除请求，未发出不等于连接尝试已经结束。旧服务由 `runtimeHostBackend.ts` 派生 unit/socket/registry；新增 `legacyRuntimeHistory.ts` 只读取这些原绑定事实。

## 工作计划

里程碑一：复用既有 systemctl 命令解析，增加有界只读 show。新模块限定旧路径，核对停止状态、socket 无监听及 registry 唯一目标终态；前后状态/文件变化返回未知，不做清理副作用。用临时目录和受控服务状态测试。

里程碑二：Host 在没有当前执行/reader/投影收尾时允许该资格进入当前删除或替换动作，等待后重新检查绑定和截止时间。历史核验不改原 RPC 首次结果，不缓存成永久免检许可。未提交失败在后续操作可重新观察；已提交未知保持原账本。沿现有 Host 测试夹具覆盖外层入口，不构建新诊断框架。

里程碑三：执行有限验证，普通构建与 Main Only 调试 staging 更新；独立复核，不重复未受影响的真实 Agent/PTY/容量/跨平台矩阵。保留全部原失败。

## 具体步骤

仓库根运行 `node scripts/test/test-legacy-runtime-history.mjs`（56通过、2原生socket跳过）、`node scripts/test/test-host-execution-owner-wiring.mjs`（184/184）、`node scripts/test/test-runtime-supervisor-reader-client.mjs`（28/28）、`node scripts/test/test-runtime-supervisor-startup-profile.mjs`（16/16）、`node scripts/test/test-runtime-host-deactivation-integrity.mjs`（通过），均保留原断言。`node scripts/test/test-runtime-reader-settlement-wiring.mjs` 首次最后一例超时、未改代码原样重跑20/20。`npm run typecheck`、无额外资产参数的 `npm run build`、`npm run prepare:debug-main-only-extension` 和 `node scripts/test/test-debug-launch-config.mjs` 均通过。

使用调试版时重新启动 F5 会话以加载 `.debug/vscode-extension-main-only`；支持范围内的旧节点通过检查后可删除或重新启动，状态不明仍显示删除未确认。此说明不是要求再次采集整套dump，也不是原现场已验证的声明。

## 验证与验收

Agent/Terminal 的已停止旧历史可经实际 Host 类删除/重启/清空入口推进，当前绑定仍精确匹配。未提交unconfirmed后新操作重新核验；已提交未知、服务活跃/未知、没有退出记录且缺少强停止证据、在途reader/finalization、绑定变化及超时仍拒绝。原registry字节保持不变，同存储其他会话不被删除或当作已退出。原活跃尾部、终态保存与资源释放回归保持。

## 幂等性与恢复

只读核验可重试，不迁移旧会话，也不更改现场服务或数据。历史清理资格只用于当次动作，迟到结果不可清除新绑定。测试数据仅放临时目录；不删除用户旧 registry、socket 或 Runtime 目录。

## 证据与备注

用户现场目标 session `b21f4e6c-7075-4715-a17a-3ebbdd4b05f2` 的 registry 为 version1、agent、live:false、stopped、lastExitCode:0；用户已提供 inactive/dead/MainPID0 和原 socket 无监听证据。此次只核对结构，不据此声称同 registry 其他进程或所有后代均消失。

最终日志：`.debug/legacy-history-host-tests-9.log`、`.debug/legacy-history-inspection-tests.log`、`.debug/legacy-history-client-tests.log`、`.debug/legacy-history-startup-tests.log`、`.debug/legacy-history-deactivation-tests-final.log`、`.debug/legacy-history-typecheck.log`、`.debug/legacy-history-build.log`、`.debug/legacy-history-debug-prepare.log`、`.debug/legacy-history-debug-tests.log`。Host前八轮失败日志保留，属于测试装配缺项，不追认为通过。reader两轮没有落盘log，证据仅为子代理会话工具输出chunk `862ad5`（exit1）与 `0291bb`（exit0）；未声称有原始文件归档。

第二轮证据：用户诊断目录 `/home/users/ziyang01.wang-al/projects/dsc-test-01/.debug/current-host-diagnostics/2026-10-06T06-23-48-298Z`，5个不同session具有6次历史退役事件（含原b21f4e6c），新目标4afdc52d四次失败。保留原诊断及registry，不推断缺失的原RPC内部reason。新核验81项及Host190/190见 `.debug/legacy-history-runtime-lost-inspection.log`、`.debug/legacy-history-runtime-lost-host.log`；typecheck/build/debug staging分别见同前缀的 `-typecheck.log`、`-build.log`、`-debug-prepare.log`。启动profile16项由子代理原脚本通过，未修改Client、reader、deactivation或native字节，不重复未受影响矩阵。2项真实socket仍受sandbox权限限制，当前systemctl访问也返回EPERM，不宣称原生现场已验证。

## 接口与依赖

`inspectStoppedLegacyRuntimeSession(backend, { sessionId, kind }): Promise<LegacyRuntimeHistoryEvidence | undefined>` 返回 `recorded-exit` 或 `stopped-runtime`，只表示有资格解除本地历史绑定，不表示新退出契约完成。Host诊断的retirementEvidence区分依据。复用Node文件/网络API与既有systemctl解析，不新增依赖或通用框架。

修订记录（2026-10-06）：记录有限产品缺陷、明确退出证据要求及实现/验证边界。

修订记录（2026-10-06，收口）：完成定向修复、原回归、构建与调试staging，补批量资格复查，归档有限计划；真实socket受限和其他后端覆盖保持未验证，不扩展为新诊断前置。

修订记录（2026-10-06，第二现场）：根据用户实际剩余失败重新激活同一有限计划，补Supervisor丢失但registry保留live快照的清理资格；保留第一轮通过、失败和未覆盖事实。

修订记录（2026-10-06，第二轮收口）：两种资格与定向验证完成，再归档此systemd修复计划；具名native detached清理缺口交技术债，不冒称所有历史节点均可删除。
