# 隔离生命周期 smoke 诊断并恢复 0.26.1 门禁

## 目的与上下文


PR327 的发布输入 9198cacbee91fc170b82578e353c16a27f3574b8 在源码 restricted 首开 editor 等待 ready 20000ms 失败。已确认测试命令 `CanvasPanelManager.runWebviewLifecycleRaceDiagnosticsForTest()` 的 fake panel 与真实 editor 交错：诊断把活动面改为 panel，真实 editor 唯一 ready 被接受但没有 bootstrap，finally 又恢复旧快照将 ready/frameId 清除。再次打开复用同 HTML，不再发送 ready。普通安装不注册这个测试命令。本计划隔离诊断，使真实页面在诊断前、期间和结束后收到 ready 都能完成 bootstrap 与确认，保持旧帧拒绝和原 20 秒门槛。

实现目录是 `extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts`；smoke 入口位于 `tests/vscode-smoke/extension-tests.cjs`。新增 `scripts/test/test-smoke-lifecycle-isolation.mjs` 直接加载真实类，替换 VS Code 外部边界，调度原协议方法；加入 `package.json` 默认测试链。根因、设计、回归和本次证据随一个修复 PR 交付，保留发布 PR327，不创建诊断或文档 PR。

## 进度


- [x] (2026-10-18 13:43Z) 分层CI现有覆盖迁移有限阶段完成：PR335 ed9257bd/run39128423778与未改PR327最新临时组合39128957644各247 jobs全成功、324/330必跑全通过；原acceptance/同批双包、六安装及434浏览器报告独立验真。CI实施计划归档，临时远端分支按原head pinned lease退役，产品两竞态与最终PR327/tag验收仍由本active主计划承接。
- [x] (2026-10-16) 按用户要求展开smoke现有流程设计：核对源码19/packaged8场景、单Host、trusted/restricted、两阶段重开、双窗口、旧代Stop及原resize；六套SVG/PNG、16源码hash、109/38直接调用点与链接核对通过，逐图视觉检查完成；仅交付流程资料。

- [x] (2026-10-15) 用户确认六平台原生CI并追加发布workflow六job；补逐步说明、九张SVG/PNG及原YAML48步/六平台代码映射，严格布局与视觉检查通过；纠正仅Windows ARM64最小宿主为Electron。
- [x] (2026-10-15) 完成发布门禁完整流程审查：7项问题/边界、原脚本过滤传递受控核对、GitHub策略核准、4项现有门禁回归通过；三张SVG/PNG校验和视觉检查完成，仅交付审查不改门禁行为。
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
- [x] (2026-10-15) 确认并原生复现晚到恢复撤销订阅的生产竞态，历史首败唯一归因仍缺现场。
- [ ] 实施旧代恢复撤销订阅竞态及生产Runtime mode-switch删除期间迟到callback/缓存失败修复；修复合入后最终PR327真实预合并完整门禁，两项不由CI改造绿色解除。
- [x] (2026-10-15) 核对原工件清单：旧代场景54份文件只有Host/VS Code日志与失败快照，没有原Supervisor registry、PTY进程或内部队列现场。
- [x] (2026-10-15) 固定55c619ad与原run六资产诊断已完成并取回，真实Stop/30秒保持；活动入口移除。
- [x] (2026-10-15) 四份原生诊断样本完成：独立旧代三份、默认源码前置顺序一份全部通过；PTY退出2–5ms、Host终态10–22ms；不追认原首败已修复。
- [x] (2026-10-15) 完整诊断三次前置失败分别核准缺Chromium、漏原短TMP配置、插桩辅助函数未被方法抽取夹具带入；恢复原环境并移至类外包装，原50项Webview/10项Host batch及typecheck通过。
- [x] (2026-10-15) 完整诊断run38711507240原样release:verify exit0，727份清单/hash核验；复用旧run资产与类外包装，不代证最终PR327正式门禁。
- [x] (2026-10-15) 真实socket、原Host batch/bind与restore/attach方法的单变量对照确认订阅撤销后可丢终态；显式重订阅恢复，历史首败仍缺现场。
- [x] (2026-10-15) 第一轮原生late/natural均通过；late确认撤销与operationIgnored，但随后原reload重新subscribe，未留下停止时缺订阅。
- [x] (2026-10-15) 最后reload原生late在原334行/30秒确定失败、natural全旧代通过；原PTY退出12ms/Supervisorclosed而Hoststopping，61/31文件清单全部核验。
- [x] (2026-10-15) params/当前metadata复核late再次原30秒失败、natural通过；8ms/4ms真实PTY退出，两轮61/31清单hash全部核验，active诊断及依赖链接移除，修复方案尚未实施。
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


2026-10-16 将用户的“看smoke流程设计”解释为解释现有实现及验证责任。继续既有审查分支，以9aaa05b0固定源码为输入，逐层读取runner和测试套件；分开源码19场景、packaged8场景、普通单Host、真实重开和并发双窗口，不把模拟reload称为Host退出。对关键ready/resize/终态/退役等待记录对象身份、证据和时间预算。图用既有fireworks-tech-graph技能并完成SVG/PNG及视觉检查；不新增PR，不执行发布或完整门禁，本轮不实施当前尚未完成的恢复竞态修复。

2026-10-15 用户反馈总览图过粗，要求六个CI内部执行/验证。用户已明确选择runtime-execution-assets.yml六平台matrix，并追加要求publish六job一并列出。对原builder、三平台candidate builder、native load checker、summary/upload逐层读取；把执行动作与校验分开标色，准确展示Linux最小Node容器构建、macOS deployment target、Windows ARM64最小Electron和同binary双加载。交付图/明细文档继续同审查目录，不更改CI或产品，不运行跨平台验收。校验JSON/代码映射及SVG/PNG，保护原总览图与既有修复计划。

2026-10-15 门禁审查采用独立交付边界：以 origin/main6e708c6b、PR327发布材料8313fc72与当前修复dc165186为输入，核对触发、固定SHA、六资产、验证顺序、覆盖、超时、取证、合并约束与渠道恢复。使用只读GitHub API、原脚本受控调用记录及静态调用图，不重跑完整门禁或把模拟子进程成功当验收通过。审查报告写入docs/design-docs/release-gate-flow-audit.md，SVG/PNG及生成输入放docs/references/release-gate-flow-audit/，随既有修复范围保留，不新建PR；生产修复仍待独立继续实施。

审查验收要求每项确定问题具有代码/API证据，明确哪些是当前自动CI、哪些是人工步骤或既有覆盖限制。流程图必须画出draft/普通PR跳过、同ref/run资产、PR/tag双阶段verify和首败中断，不把建议的失败上传或required check画成现有能力。完成JSON/SVG几何及布局校验、PNG导出与视觉检查后交付报告。执行工具为本机Node22、Python和fireworks-tech-graph技能，不增加项目运行依赖；图生成器读取已登记JSON，重复渲染覆盖本次自有文件即可。

2026-10-15 选择独立 prototype 诊断对象，显式提供所有触达的私有状态。真正构造第二 manager 会初始化持久化、监听器和后台维护任务；浅复制 manager 会继续共享 mutable 状态；等真实 ready 再诊断只消除当前窗口。独立对象复用正式协议方法，payload 与目录数据仅是外部边界，保留生产协议规则。任何未初始化依赖应在测试显式失败，不得 fallback 到真实 manager。

2026-10-15 接续packaged启动调查，只在临时组合worktree添加有界诊断，原正式实现与smoke断言不变。优先区分Supervisor容量拒绝和adapter启动拒绝，再验证旧会话责任释放是否晚于停止投影；配置已启用不等于启动时准入开放。原7.2GB工件收集器只包含外层仓库.debug，失败clean-checkout位于/tmp，不能宣称拥有其Host现场。已有trusted单项exit0说明非必现，不覆盖原全顺序首败。

2026-10-15 接续旧代停止调查。夹具用当前bundle启动previous-generation-stream，但没有传--execution-profile，因此使用无ExecutionOwner的兼容PTY路径；不把该场景的stopping归为新owner读者责任。先在临时分支固定原输入，保存stop RPC、PTY pid/退出、finalize队列、终态发布与Host接收，以及cleanup前的只读Supervisor snapshot/registry和进程身份。保留真实按钮、原30秒等待和既有业务断言；不延长超时、不实施产品修复。原始失败缺少Supervisor现场，新的复现必须与历史观察明确区分。

2026-10-15 完整诊断恢复原Chromium缓存及短host TMP，前置方法抽取回归发现辅助函数插桩会改变被抽取方法的依赖，故记录移到类外prototype包装，不放宽正式测试。核对bindRuntimeSession发现同key也替换binding对象，而batch消费将binding引用替换视为取消；先在临时脚本用原方法/真实socket/真实行消费建立单变量对照，不提交产品修改，也不将受控取消追认为历史自然交错。

## 意外与发现


`beginSurfaceRender` 和 `markSurfaceReady` 除了 ready 字段还取消本地读者、关闭终端分页责任、清理通知与待处理请求；旧诊断 finally 没有恢复这些责任。因此验收必须检查两个真实面的请求和读者，不只断言 editor ready。目录在 bootstrapAck 后异步发布，独立数据源保证其晚到回调仍只触达诊断对象。

2026-10-15 确认owner pending=0与authority starting=0也不代表旧Supervisor存储已释放；实际两份retainedRetirements占满pending:2。旧会话删除10ms后完成但原启动不重试，默认15秒等待仍失败。停止助手只补了local退休而未覆盖Supervisor，产品容量检查按既有契约保留。原完整工件没有收集/tmp失败clean-checkout，因此只能用原日志/snapshot与同输入因果对照区分证据范围。

2026-10-15 旧代stream夹具的startLegacyRuntimeSupervisor只传storage/backend/guarantee；runtimeSupervisorMain.main仅在显式--execution-profile时创建ExecutionOwner。原Host记录stopRequested后仍live，未见sessionStateHandlerFailed，不能据此确认PTY退出与否。原工件清单不包含Supervisor registry或journal，需补cleanup前现场取证。

2026-10-15 run38706315883两份样本、run38707714250两份样本均通过旧代完整场景；后两份没有停止前额外只读查询，第四份按默认源码前置顺序运行。原bash在kill前SigBlk=0，SIGHUP后原pid消失，finalize与Host ACK正常；有限通过不能排除原失败中的信号、finalize、订阅或Host消费问题。完整诊断run38710617988提前在test-terminal-paged-projection的consumed断言失败，原因是诊断辅助函数未随真实方法抽取；移除方法内插桩后同回归50/50、10/10通过。

## 可重试步骤与证据


工作分支基于 main6e708c6b，已有调查提交1522579e。每次推送前 fetch/rebase；已推送分支重写使用固定 force-with-lease。临时 CI 证据保存 run/input SHA、六资产 manifest 与第一次失败日志。根磁盘无空余，所有构建、日志和临时 worktree 放 devshm，不清理他人文件。根因原自然时序和前/期间消息对照位于 docs/references/smoke-restricted-ready-root-cause/，旧证据保留历史语义。

## 结果与复盘

2026-10-18 CI实施阶段收口：15 reusable验证job、六发布外层job、固定计划/实际来源严格验收、现有smoke独立目标迁移、clean同批双包/消费式packaged与三x64原样安装已在PR335 ed9257bd和未改PR327最新真实临时组合分别完整验收，各247 jobs成功、324/330必跑全部通过。原acceptance、candidate bytes、六安装报告和434浏览器执行目录独立核；临时远端分支退役，原失败/局限保留。详见[已完成CI实施计划](../completed/release-gate-implementation.md)和正式设计；最终文档head检查另记录PR335，不移植旧回执。两项确定产品竞态、修复合入后的正式PR327/tag和补充范围仍待办，本计划保持active，当前不表示0.26.1可发布。

2026-10-15 细化交付：job-details.md补齐六平台的逐步构建、静态校验、真实require、有限归档与always边界，以及发布resolve/native/prepare/两个渠道/finalize的实际条件、原YAML步骤、ref/VSIX验证和deferred/删tag策略。新增九图全部校验通过、中文字体与箭头逐图视觉检查，图宽2400；原YAML48步、六target及源码hash/链接已核对。没有修改CI、生产实现或PR327，没有执行发布或新的完整门禁。当前恢复竞态修复和最终正式门禁仍待后续收口。


2026-10-15 门禁审查交付：报告release-gate-flow-audit.md与references/release-gate-flow-audit三张图/证据已生成。确认main没有protection/ruleset、trusted过滤可缩小19/8为1/1且完整编排正常返回、正式verify失败没有完整上传，notifier补充与普通PR功能回归不在默认链。普通Host无进程deadline与stable宿主漂移按确定控制缺口记录，未宣称新挂死/上游bug。四项门禁编排/分发回归及JSON/SVG/PNG验证通过；未运行新的完整发布门禁，没有修改生产实现、workflow或远端策略。审查范围已完成，原生恢复竞态修复及PR327最终门禁仍未完成，主计划保持active；待办登记tech-debt-tracker。

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

本次修订扩展旧代停止诊断阶段，显式记录无owner兼容路径与原现场缺口。实验在临时worktree从固定55c619ad开始，仅修改取证接线，复用原run六资产并保留30秒门槛；相关结论继续随PR335收口，PR327保持不变。

本次修订记录四份成功样本与完整诊断前置错误，并增加同身份binding替换的受控机制检查。正式根因仍未确认，原30秒等待与业务断言不变；当前完整诊断与最终发布验证分别记账。

本次完整诊断已取回：run38711507240/job116343740971 exit0，727份ZIP/tar清单全部核验，原PTY退出5ms、Host应用终态15ms；不追认历史失败或最终PR327放行。真实restore方法/socket对照已确认晚到getClient→deferred attach撤销原订阅→Host operationIgnored无subscribe的机制。第一轮原生控制实际触达撤销但发生过早，原模拟reload恢复；第二轮将控制限定最后reload，业务等待仍30秒。

2026-10-15 原生因果链已确认：late run38716971680订阅→晚到deferred attach→cancelHostOutput→operationIgnored无subscribe；真实Stop后PTY12ms退出、Supervisorclosed，原Host30秒仍stopping/live=true。natural保持订阅并完整旧代通过。归为已复现生产恢复竞态，历史首败缺订阅/PTY现场仍不唯一归因；本轮不改生产行为。复核仅补请求params及实时节点metadata，修正第一版trace读旧节点对象的reattaching字段，不改变原业务方法。

本轮定位收口：第三轮run38717714670确认晚到恢复释放时当前metadata已attached-live，原deferSubscription:true撤销已建host-credit，Host跳过subscribe；late再现334行/30秒失败，natural正常。两轮晚到原PTY均已退出、Supervisorclosed，确认恢复协议的生产竞态；历史唯一归因仍缺现场。所有参考集中PR335，活动入口移除；本轮没有新生产修复，最终PR327预合并门禁仍待修复合入后重跑。

证据收口方式：新timeline保留原session的attach/subscribe/cancel/control及Stop到终态观察，去除重复返回与proc stat；完整trace的原hash与GitHub artifact来源保留result.json，curated字段显式说明摘录范围。文档/脚本语法、hash、状态索引及关联文件链接核验通过。

2026-10-16 smoke设计资料已收口到docs/references/release-gate-flow-audit/smoke/README.md及六套图。静态verify核对16份源码hash、默认19/ focused3 / packaged8场景及trusted109/restricted38直接await调用点；六图schema/render/check/export全部通过，2400宽PNG逐图视觉检查后记录独立hash。修订双窗口最后参与者退出后再开启的表述，明确验空共享根；正式报告、索引及core-beliefs已链接。没有新的Host运行或发布验收，原生产恢复竞态与PR327最终完整门禁仍未完成。
