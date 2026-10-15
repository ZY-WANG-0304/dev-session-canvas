# 隔离生命周期 smoke 诊断并恢复 0.26.1 门禁

## 目的与上下文


PR327 的发布输入 9198cacbee91fc170b82578e353c16a27f3574b8 在源码 restricted 首开 editor 等待 ready 20000ms 失败。已确认测试命令 `CanvasPanelManager.runWebviewLifecycleRaceDiagnosticsForTest()` 的 fake panel 与真实 editor 交错：诊断把活动面改为 panel，真实 editor 唯一 ready 被接受但没有 bootstrap，finally 又恢复旧快照将 ready/frameId 清除。再次打开复用同 HTML，不再发送 ready。普通安装不注册这个测试命令。本计划隔离诊断，使真实页面在诊断前、期间和结束后收到 ready 都能完成 bootstrap 与确认，保持旧帧拒绝和原 20 秒门槛。

实现目录是 `extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts`；smoke 入口位于 `tests/vscode-smoke/extension-tests.cjs`。新增 `scripts/test/test-smoke-lifecycle-isolation.mjs` 直接加载真实类，替换 VS Code 外部边界，调度原协议方法；加入 `package.json` 默认测试链。根因、设计、回归和本次证据随一个修复 PR 交付，保留发布 PR327，不创建诊断或文档 PR。

## 进度


- [x] (2026-10-15) 从最新 origin/main 6e708c6b 核对既有调查提交，创建 smoke-lifecycle-diagnostic-isolation。
- [x] (2026-10-15) 核对 ready、bootstrap、目录发布、焦点重放和读者清理依赖，选择独立诊断对象。
- [x] (2026-10-15) 两真实面三时序及异常/成功责任保护共10项通过；旧 during 稳定缺少真实 bootstrap。
- [x] (2026-10-15) 隔离与异常清理、10项回归、协议/CLI、类型检查及六资产本地构建通过。
- [x] (2026-10-15) 组合f8d9ad53六资产、真实原ready三时序及none20秒负例完成；原样完整release:verify已运行并保留首次failure。
- [x] (2026-10-15) 获取完整job首败与工件来源：packaged trusted执行启动rejected-before-acquire，editor ready/ack=true。
- [x] (2026-10-15) 用户授权后实施关联packaged夹具修复；完整门禁验证单独列下项。
- [x] (2026-10-15) 只读测试RPC包含retiring；原socket/hello/owner/session固定，派发原停止消息和退役查询共用15秒预算。
- [x] (2026-10-15) 原具名调用旧实现稳定抢跑；17/17夹具（含真实socket）及136/136Supervisor、类型检查、原等待36项回归通过。
- [x] (2026-10-15) 新组合六资产通过；原生屏障因果通过（644ms），完整trusted后来文件打开失败；完整门禁源码trusted拒绝smoke查询；后核验首败是源码入口无显式标志（legacy-detached），systemd为另一路接线要求。
- [x] (2026-10-15) systemd仅传显式smoke标志，startup36/36、旧实现先红、typecheck/build通过。
- [x] (2026-10-15) 源码入口补齐后55c619ad/run38696319881无过滤完整门禁exit1；完整trusted/restricted通过，首败为旧代Terminal停止30秒仍stopping/live=true。
- [ ] 定位新的legacy-supervisor-upgrade停止首败；修复合入后最终PR327完整门禁。
- [x] (2026-10-15) 完成拒绝入口审计：容量检查与adapter启动准入均使用相同错误文案；停止助手没有等待Supervisor旧会话退役。
- [x] (2026-10-15) 实际Supervisor134/134；两轮同输入packaged受控拒绝均原15秒exit1，等待两份实际退役与自然trusted均exit0，六份完整工件核验。
- [x] (2026-10-15) 记录根因与产品契约边界，移除活动临时诊断；本阶段未实施新修复。
- [x] (2026-10-15) 同步证据与技术债，创建单一修复PR335；CI通过、最新main为祖先，临时workflow入口已移除。
- [ ] packaged首败与最终发布门禁收口后归档计划。

## 正式实现与里程碑


第一里程碑先在真实类回归中保留全部 fake 竞争检查，覆盖真实 editor 和 panel 的 ready 在诊断前、期间和结束后到达。测试用外部边界提供 bootstrap 内容，调度原生命周期与消息筛选方法；在 fake 等待处暂停而不是依赖随机延迟。验证真实 frame/generation、ready/ack、消息路由、焦点、诊断数组以及待处理请求和读者责任。旧版本至少在 during 时序失败，作为负对照。

第二里程碑把公开方法作为测试模式守卫与独立对象入口。独立对象以真实类 prototype 创建，显式初始化生命周期、消息目标、队列、请求、日志、焦点、可见性和终端读者容器；不能复制 this 或借用其 Map、队列、事件、读者、scheduler 和 context。bootstrap 使用独立空 Canvas 状态及调用前同步复制的 runtime 展示配置，模板目录为空诊断目录。仅替换序列化和外部数据边界，实际 ready/promote/filter、bootstrap、ack 排队、焦点及请求匹配方法保持。独立对象不运行生产构造器，避免磁盘写入、Host 监听器和监控定时器；finally 只清理自己拥有的请求、队列与 fake 引用，异常也不回滚真实对象。移除旧快照恢复及其专属 helper。

在修复 worktree 根执行 Node22 的 `npm run test:smoke-lifecycle-isolation`、`npm run typecheck`、`npm run build`，保存日志到 `/dev/shm/dsc-lifecycle-fix-evidence`。本地依赖先复制任务外已有 npmci 目录到 `/dev/shm/dsc-lifecycle-fix-evidence/node_modules`，修复 workspace 链接并运行 pinned serializer 构建后使用临时链接，只作为定向验证，不称为默认 npmci 发布门禁。主工作区用户的 docs/WORKFLOW.md 改动保持不动。

第三里程碑提交修复到临时组合分支，在固定修复 SHA 上应用 PR327 发布材料，再提交仅临时 workflow。workflow 从不可变组合 SHA checkout，Ubuntu22.04/Node22 默认 npmci，调用现有 runtime-execution-assets reusable workflow 构建同 ref/run 六资产，原样无过滤运行 `npm run release:verify -- --version 0.26.1`。附加真实 Host 的 ready 前/期间/后三时序与不发送 ready 的负例用暂存原消息控制，不降低业务断言。完整门禁失败时保存首败并在同修复范围判断，不把单项成功拼成完整通过。

最后同步设计状态、索引、技术债与证据，移除活动临时 workflow、依赖链接，fetch/rebase 最新 main 后推送并创建修复 PR。PR327 保持原 head/draft；修复合并后再 rebase PR327 跑最终正式预合并门禁。当前没有合并、tag 或发布授权。

## 决策记录


2026-10-15 选择独立 prototype 诊断对象，显式提供所有触达的私有状态。真正构造第二 manager 会初始化持久化、监听器和后台维护任务；浅复制 manager 会继续共享 mutable 状态；等真实 ready 再诊断只消除当前窗口。独立对象复用正式协议方法，payload 与目录数据仅是外部边界，保留生产协议规则。任何未初始化依赖应在测试显式失败，不得 fallback 到真实 manager。

2026-10-15 接续packaged启动调查，只在临时组合worktree添加有界诊断，原正式实现与smoke断言不变。优先区分Supervisor容量拒绝和adapter启动拒绝，再验证旧会话责任释放是否晚于停止投影；配置已启用不等于启动时准入开放。原7.2GB工件收集器只包含外层仓库.debug，失败clean-checkout位于/tmp，不能宣称拥有其Host现场。已有trusted单项exit0说明非必现，不覆盖原全顺序首败。

## 意外与发现


`beginSurfaceRender` 和 `markSurfaceReady` 除了 ready 字段还取消本地读者、关闭终端分页责任、清理通知与待处理请求；旧诊断 finally 没有恢复这些责任。因此验收必须检查两个真实面的请求和读者，不只断言 editor ready。目录在 bootstrapAck 后异步发布，独立数据源保证其晚到回调仍只触达诊断对象。

2026-10-15 确认owner pending=0与authority starting=0也不代表旧Supervisor存储已释放；实际两份retainedRetirements占满pending:2。旧会话删除10ms后完成但原启动不重试，默认15秒等待仍失败。停止助手只补了local退休而未覆盖Supervisor，产品容量检查按既有契约保留。原完整工件没有收集/tmp失败clean-checkout，因此只能用原日志/snapshot与同输入因果对照区分证据范围。

## 可重试步骤与证据


工作分支基于 main6e708c6b，已有调查提交1522579e。每次推送前 fetch/rebase；已推送分支重写使用固定 force-with-lease。临时 CI 证据保存 run/input SHA、六资产 manifest 与第一次失败日志。根磁盘无空余，所有构建、日志和临时 worktree 放 devshm，不清理他人文件。根因原自然时序和前/期间消息对照位于 docs/references/smoke-restricted-ready-root-cause/，旧证据保留历史语义。

## 结果与复盘


隔离实现、旧源码负对照、10项实际类回归、Host owner wiring 全套、协议/CLI、类型检查及本地六资产构建通过。组合f8d9ad53/run38681093813六资产和真实before/during/after原bootstrapAck通过，none按原20秒失败且预期失败断言通过。完整release:verify已完成exit1，首败是packaged trusted Agent启动rejected-before-acquire；源码与Webview阶段通过。修复PR335已创建且CI通过，packaged单项run38685094467 exit0，已确认停止夹具遗漏Supervisor旧存储退役屏障；关联退役屏障已实现并通过本地回归，原生与新完整门禁待验证；原完整CI缺少逐事件计数。最终正式发布门禁须在修复合入后PR327最新预合并输入重新验证。

2026-10-15 环境记录：根分区 ENOSPC 使首次构建写共享 serializer 入口失败，已从原 pinned 源码在任务依赖副本重建，恢复共享入口为短 symlink。此后所有依赖写入及 TMPDIR 指向 devshm，借用安装的验证不冒充 default npmci。

2026-10-15 完整组合结果：命令04:30:27–04:54:17Z以failure结束，首败栈与最终snapshot已核验，未取得clean-checkout原Host现场。另run38683788069两份fallback限时阶段均exit0，此前API日志静默属于取数滞后。完整发布门禁保持阻塞，关联问题继续同修复范围审计。

修复交付状态：ready隔离已创建PR335，关联packaged根因已确认、退役屏障已实现并通过本地回归；本计划保留active，因为packaged首次失败及最终PR327门禁尚未收口。发布验证待办登记技术债，不把单项通过写成完整通过。

PR335 headbfd70dff的CI通过（无发布契约，六资产明确skip）；主工作区WORKFLOW.md保持。上一阶段临时workflow及probe在79ba3c0f移除并推送，原运行仍保留。

最终首败确认：verifyLiveRuntimePersistence等待Agent启动超时，状态显示rejected-before-acquire而editor ready/ack=true。不是本次ready回滚；同输入受控对照已确认旧删除责任占满pending的夹具竞态，原完整CI没有Supervisor逐事件现场。原完整工件11950986000为7223340491bytes，远端保留，本地只核验job日志及首败snapshot，不称为全量下载。

本次修订：收敛已结束run的过时运行中描述，新增packaged准入根因调查阶段，区分观察、候选与原现场缺口。调查入口是supervisor/runtimeSupervisorMain.ts:createSession/removeSession、panel/CanvasPanelManager.ts:applyCompletedRuntimeSupervisorSnapshot，以及tests/vscode-smoke/extension-tests.cjs:verifyLiveRuntimePersistence/ensureAgentStopped。已运行实际类原有production retirement回归；固定f8d9ad53临时诊断复用38681093813同输入六资产，两轮均验证旧删除责任保留时原创建被拒绝、实际退役后完整trusted通过。所有临时文件放devshm，活动workflow与probe已在ea62310d移除；结论与候选修复记packaged-runtime-restart-admission-root-cause.md。

本次修订完成packaged调查：两个真实原生受控拒绝、两组等待退役与自然trusted对照，原15秒等待和无自动重试核准。原失败仅保留日志/snapshot范围，新的完整发布门禁仍是阻塞。

2026-10-15 修复阶段决策：现有getSessionSnapshot的sessionNotFound及registry均隐藏retiring对象，不能用于退役证明。增加仅显式smoke环境可调用的getSessionRetirementForTest只读RPC，直接查sessions含retiring，不更改生产delete/准入。既有测试registry入口补socketPath；smoke在停止前以原runtimeStoragePath选择入口并打开独立固定socket，核验hello owner/backend/pid及原session存在，然后停止两执行并等待原查询exists=false。所有操作共享原15秒预算，未知/断连/错身份均失败，finally只关闭观察连接。只在verifyLiveRuntimePersistence显式重启调用接入，普通停止契约保持。新增实际Supervisor含慢/失败删除回归与原具名调用VM回归；旧实现稳定先红；修复/文档集中PR335。

本次完整组合run38692163764首败是本轮新增观察模式显式标志未传递；原snapshot确认legacy-detached，已更正此前systemd归因，并补齐源码入口标志；systemd unit也补齐独立传递要求。原生run38693259026验证原退役屏障通过，后续文件打开失败未确认根因；不以原函数通过替代完整trusted。原样第一次图片链接前置失败保留，未将两次失败拼为成功。

原生run38694282830完整trustedexit0，原两身份有界500ms删除延迟，原helper645ms与因果顺序核验；源码入口显式模式缺口新增原main VM回归，两调用旧入口先红、18/18及runnerenv通过。修复/证据继续集中PR335，第三次完整结果见下段。

最终本轮具名修复已验证：18项夹具、136项Supervisor、36项startup及原等待、类型/build、原生500ms删除延迟完整trustedexit0与最新源码完整trusted/restricted通过。最新无过滤完整门禁exit1，新的旧代停止首败仅记录观察不定因；首败、原session与Host诊断入库retirement-source-full-result.json。后续场景未触达，不放行发布；计划保持active。已结束三个活动临时入口分别5e81cf2a/e287e25a/135334eb移除，依赖链接已删，用户主WORKFLOW未改。
