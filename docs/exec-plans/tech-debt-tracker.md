# 技术债追踪

本文件用于记录复杂任务中的未收口问题及阶段性交付后的遗留风险。登记不代表一律不阻塞后续交付；已纳入明确验收门槛的条目按对应计划收口。技术债登记、拆解和修复规则见 `docs/workflows/TECH_DEBT.md`。

## 2026-10-24：文件条目 smoke 原生输入修复的验收边界

文件点击前 documentFocus 的测试门槛已由原生鼠标输入替代，受控编辑器持焦下 source 与原双 VSIX packaged 场景通过。历史 CI 自然夺焦的完整时序缺失，仍不认定上游产品焦点缺陷；后续若再失败，应保存点击前后焦点与可信事件。修改后的 PR head 完整 Actions 验收尚待执行，本地局部诊断不解除发布门禁。方案和证据见 [file-entry-native-smoke.md](../design-docs/file-entry-native-smoke.md)。

## 2026-10-18：CI与发布门禁重设计（现有覆盖迁移已验，产品阻塞与补充范围保留）

最新已验PR335 ed9257bd：正式完整39128423778在真预合并1d9bb54b完成，精确main/head parents已核，247 jobs全部成功、330 actual/passed、324 required/requiredPassed，六native校准操作亦通过。同head与未改PR3278313fc72的最新临时0.26.1组合39128957644也247 jobs全成功、330全部必跑通过；输入63b168e2的main/组合949432c3精确parents及双PR ancestry已核。两批原aggregate/acceptance的actual producer、ZIP与同批双包原bytes独立验真，118 source/104 packaged、六native、两个Marketplace Host及三x64原样安装同批通过。六份安装原报告全部核精确恢复全集/一次创建/fresh同fd几何/原进程Stop/通知/两locale/原Host公开退出与cleanup；PR335原431功能/3视觉按冻结434目录独立核全通过、retry0。

原Actions已执行完整聚合，本地未再次下载这两轮全部task再聚合，二者分开记账。临时远端分支已按63b168e2 pinned lease退役，原历史/失败证据保留；最终文档head另收自己的稳定CI，不套用旧回执。两项生产竞态（旧代恢复撤销当前订阅；生产mode-switch删除期间接纳callback并缓存失败）仍未修，最终修复落地后PR327真实预合并和release-tag完整验收保持阻塞。main合并保护、15新增缺口、真实TUI、最低宿主/arm64安装/真实systemd/渠道及历史间歇机制均分别保留，不由临时组合绿灯放行0.26.1。完整来源与边界见正式设计和local-results.json。

以下保留历史输入与当时待验状态；新输入验收不追认历史首败永久修复。

此前第十轮39124063678终态323/324 required通过、330 actual/329 total passed（含六校准），247 jobs为244成功/3失败，仅Windows中文节点身份绑定业务首败。原报告缺创建前ID，不补造历史基线；同production bundle受控一次创建/迟到bootstrap先红，关闭前精确全集恢复观察、真多新增拒绝及原概览Stop3/3通过。115合同、434目录的431功能/3视觉及原第十轮双包Linux完整公开诊断通过，原20秒/包摘要/一次动作不变。

[release-gate-redesign.md](../design-docs/release-gate-redesign.md)已按用户授权进入实现，[已完成实施计划](completed/release-gate-implementation.md)覆盖15验证job、六发布外层job、保守分类、冻结计划、真实Actions来源、有界证据、clean同批双包、消费式packaged、三x64原样安装和原包渠道恢复。当前完整80regression同批通过，423前端/3视觉/Marketplace浏览器有本地通过；独立source、SSH两态及Marketplace Host新包装器有本地诊断，旧资产不冒充新SHA。真实Actions第三轮39095480885/head924cae96/input612a891c：六load/六有限操作、118源码Host、两个Marketplace Host、423功能/3视觉、三regression分片与source-build同批通过。隔离双包各build一次/checkout清理成功，后置文件清单错读外层dist失败；聚合另拒Windows反斜杠回执。现修candidate原包dist私有消费与producer路径序列化，保真实staging/ZIP双层和严格路径；原失败包仅诊断，无正式transfer，packaged/三安装仍not-run。新提交完整验收继续，不能把映射或独立补验视为通过。

第五轮39101493143及0.26.1组合39101774719已终态：前者330 actual/324 required/318 required passed，六校准项包含于324 total passed；后者330全必跑328通过，source118/packaged104全通过，仅macOS长IPC和Windowscached geometry失败，均无acceptance。当前原包焦点tab红绿、稳定hit-target/完整pointer、短路径设置与日志、安全退役、同fd fresh geometry及有界transport恢复已落实；105合同、429浏览器目录的426功能/3视觉、当前production文件视图诊断通过。123 suite原期限逐项不变；最新三平台原样安装与新组合仍需实跑，旧资产诊断不能补验收。

第六轮39108395021与最新组合39108780795已终态失败：前者324 required/320 required passed（326 total passed含六校准），后者330 required/328 passed。两者Linux安装、六native、104packaged及基础层通过；组合source118全通过。两平台真实resize/Stop通过，新首败均是vscode.open等真实确认框；已补公开确认并保原token/完整URI/不记忆和20秒，原Host受控不存在token诊断通过不代证完整回跳。source file/views原panel缺文档focus，公开view focus对照通过，原10秒及全部file/split/reader断言不变。macOS原附加kill EPERM尚无具体syscall/对象/栈，新增严格阶段取证，不吞错。

第七轮39112933251正确拒绝遗漏更新的helper源码hash，业务任务未运行；已重生成并核123期限/wait/倍数/循环完全一致，只改hash/证据行号，补本地正反例避免完整合同漏报。第六轮全量原task本地下载在原5分钟期限终止，部分证据保留，不称独立全量再聚合完成。新输入及PR327组合仍须各自完整运行，历史失败不能拼接通过。

第八轮39113768051和未改PR327组合39113960317已终态失败，分别321/324与327/330 required通过；packaged104及Linux安装同批通过，source各117/118。新Process原身份/公开Quit/概览中文Stop观察实现已有113合同、430登记的427功能/3视觉与原生产页面/原双包Linux局部诊断通过。两轮全量task本地独立下载原5分钟失败，未完成再聚合；不与正式aggregate混账。source real-reopen原45秒未ready和panel原10秒无documentFocus仍未定因，当前原动作只读CDP通过不能解除；新head完整跨平台和两生产竞态持续待验/阻塞。

六平台有限操作及ed9257bd/最新临时组合三x64原样安装已有真实runner同批验收，固定环境/基础设施预算的持续成本校准仍保留为后续工作。最低VSCode、arm64原样安装、真实systemd manager、Marketplace依赖自动下载、桌面通知呈现与provider TUI依然各自待验。远端main未保护，稳定检查尚未配置required约束；待用户授权配置后用实际红灯验证。渠道模块只用本地HTTP/内存夹具测试，未真实发布或证明重签可忽略的文件；unknown内容保持未完成，不降级成版本可见。

关联范围继续PR335，PR327发布材料不变。生产旧代恢复撤销订阅竞态是已复现发布阻塞，不降为可延期技术债；最终修复落地及最新真实预合并完整门禁仍须按原计划完成。失败证据导出超限、缺失、清理未settle不得绿色，相关新增反例已有本地通过，工件容量仍以真实Actions作最后验证。

## 2026-10-18：Runtime 模式切换删除期间的迟到回调（生产路径已复现，未修）

第六轮source runtime-mode/reload-clear原input a62e5d7e/run39108395021在三delete派发后接纳此前空输出batch3、开始状态保存，84ms内以pending callback拒绝；并非等待到期。直接调用原生产CanvasPanelManager的受控shared/non-shared × simulate reload/prepareForDeactivation四路径确定复现：mode cleanup先于永久准入关闭，首轮集合快照等待不覆盖delete期间的新回调。放行回调归零后再次操作仍取得同一缓存失败；不能据graph保留推断原已删除会话可控制，也不能因最新组合通过解除责任。

未修产品阻塞，与旧代恢复撤销订阅竞态分别记录。CI保原case、原预算、严格失败，不增加sleep/retry或全局drain。后续产品修复须结算原root/session的已派发操作与回调/保存，保其他开启窗口、四阶段接管、严格delete失败和普通reset保存立即拒绝；真实Electron/PTY及不同root仍需相关验收，当前控制脚本仅证明Host方法顺序。见[正式记录](../design-docs/runtime-shared-root-canvas-sync.md#ci-改造时发现的模式切换回调边界2026-10-18)、[复现](../references/release-gate-redesign/implementation/runtime-mode-switch-reproduction.mjs)及其JSON/hash。实现与证据继续PR335，不另建诊断或文档PR。

## 2026-10-17：发布门禁分层与产物证据（审查完成，方案待确认）

用户要求检查smoke之外的环节。设计[release-gate-layering-review.md](../design-docs/release-gate-layering-review.md)基于0100abf0/main6e708c6b，覆盖普通PR、静态输入、70条npm顶层命令、六原生资产、Webview、clean checkout、packaged和渠道汇总。[证据](../references/release-gate-flow-audit/layering-review/README.md)核25源码摘要及8项现有纯逻辑：finalize接受错ref/hash；缺partial而有历史verified仍完成；verifier在历史verified时忽略本轮query=false。不是历史真实错发布的证明。

建议先局部补完整范围守卫、阶段期限/always工件、渠道结果身份与历史复用口径；再实现干净双包构建、消费式packaged和原样安装、测试包与最终发布包的摘要/回执绑定，以及普通PR独立基础回归和稳定聚合检查。落点为release-preflight/publish workflows、clean-checkout/package/VSIX runner、publish-tag与共享完成判定模块。远端保护需管理员实际配置；仅文档不能形成强制约束。

后续按真实依赖拆快速/前端/视觉/Marketplace/Host层，登记notifier与门禁具名回归的所属层，选定有限跨平台真实PTY操作、最低VSCode和latest/provider观察范围。Marketplace重签/远端内容身份与并发耗时未验证，不能用原ZIP摘要或性能假设直接定方案。保持双release ref完整验证、六目标来源核验、已有Release原包复用禁覆盖和VS deferred策略；新增范围不自动扩大0.26.1卡点。现有生产恢复竞态和PR327最终门禁仍按原计划闭环；本轮只更新审查资料，继续当前关联修复范围，不另建诊断/验证/文档PR。

设计研究计划[release-gate-layering-review.md](completed/release-gate-layering-review.md)完成；实现、产品与完整发布验收均未执行。


## 2026-10-18：smoke场景与子场景重划（独立目录已接线，新增缺口仍未实施）

[smoke-scenario-boundaries.md](../design-docs/smoke-scenario-boundaries.md)现落实102独立case、13默认因果suite和3focused诊断。source115加3辅助、packaged104及两个Marketplace Host分别冻结；旧22 routes/137覆盖目的地的helper注册/AST可达与实际步骤边界逐项校验，但不签发验收。source/packaged真实对应输入、特殊拓扑及清理结果须继续从Host回执与实际工件验证，不能以目录数量宣称覆盖通过。

15个proposed-gap保留not-implemented：包括live页面remount、snapshot-only真实新Host恢复、边界后自然/Stop终态、额外Terminal退出/重启、原生崩溃、Stop不响应、完整高输出/resize及真实TUI完成证据。它们是原设计明确的后续范围，不混入当前137项已实现映射，也不自动扩大0.26.1阻塞；固定Node/宿主、真实最低宿主和并发成本待受控验收。发布确定生产竞态和最终完整门禁仍阻塞，不能靠CI命名或延长等待消除。

后续时机：补齐每个缺口的独立fixture、真实身份/权威完成信号与故障反例后，经目录差异review再纳入必跑。兼容case共Host优化也须先实测隔离/成本，当前每case或因果suite独立matrix，保留原业务等待与不可切的setup→verify。实施与证据继续现有PR335，不另拆文档/验证PR。

## 2026-10-17：smoke 的 fake Agent 状态断言不能代证真实 TUI 回合完成（待验证）

背景与触发：用户审阅默认01–07 smoke时指出，真实Agent TUI底部输入区可能在任务处理中持续接收输入，回答结束位置也可能位于输入区或状态栏上方。当前`local-execution-flow`使用fake CLI，`burst`等命令完成后打印`> `；`verifyAgentExecutionFlow`分别等待原执行输出标记与Host节点`waiting-input`。输出helper在原session的连续消息或独立快照中查找标记，不要求屏幕最后一行；该标记也不是provider的回合完成事件。

已核对边界：`waiting-input`来自`agentActivityHeuristics.ts`的prompt/通知/bell、spinner/redraw和静默时间推断，包含无近期spinner且静默约1.6秒的兜底。fake场景通过只证明其输入输出与扩展状态推断成立，不能证明真实TUI的输入可用性、回答呈现和回合完成识别准确。真实provider是否存在误判、涉及哪些版本及触发时序尚未验证，不写成已确认产品缺陷，也不以本条自动增加0.26.1发布阻塞。

影响范围：源码和packaged复用的Agent功能链及其验收解释，尤其是持续输入区、回答后还有footer/重绘、处理中暂时静默等场景。此项延续列表中“Agent运行态判定仍缺provider原生权威事件与来源标注”的既有技术债；本轮保留现有代码、断言和门禁，只澄清证据范围。

后续时机与验证目标：用户要求先记录，继续审阅01–07；后续场景重划设计已将其列为独立`agent-tui`待验目录，尚未实施。分别验证输入可用、回答在真实终端页面正确呈现、当前回合完成三个目标；覆盖任务仍处理但可输入、回答不在最后一行、网络/工具等待暂时静默及完成后的TUI重绘。回合完成需有独立于被测启发式的provider证据，不能用同一个`waiting-input`状态或末行位置自证。具体信号接入方案尚未选定。

关联：[smoke说明中的待验证项](../references/release-gate-flow-audit/smoke/README.md#agent-tui的待验证覆盖边界2026-10-17)、[已有Agent状态设计](../design-docs/agent-running-state-detection.md)；代码为`tests/vscode-smoke/extension-tests.cjs:5211`、`tests/vscode-smoke/execution-output.cjs:3`、`tests/vscode-smoke/fixtures/fake-agent-provider:178`、`extensions/vscode/dev-session-canvas/src/common/agentActivityHeuristics.ts:317`。

## 2026-10-15：restricted ready 诊断隔离已修复，组合门禁阻塞于 packaged，最终发布门禁待验证

PR327正式9198cacb/run38665513172 attempt2在源码restricted首开editor ready20000ms失败。固定输入阶段采样19次中1次同入口自然失败，捕获真实editor ready在fake panel诊断期间被正常接受，然后`runWebviewLifecycleRaceDiagnosticsForTest`的finally恢复两个面旧快照，将editor ready/frameId回滚；诊断数组恢复还抹去ready事件。active面临时为panel使editor未bootstrap，再open复用原HTML不重发ready。原消息期间投递的受控run38678148402按20秒失败、原ready/ack先完成的完整restricted通过，因果已确认；原正式CI无Host工件，不能逐事件追认唯一定因。

该测试模式方法和调用从6月存在，#334未修改；普通安装未注册此测试命令，不因该夹具故障判定用户打开必然失败。已在修复分支把fake诊断放到无共享可变状态的独立对象，实际协议规则保持；两真实面ready前/期间/后三时序、成功/异常责任保护及测试模式守卫回归通过，旧during负对照缺少真实bootstrap；仅延长预算或保留ready字段不能补回bootstrap。修复/回归/根因/证据集中一个修复PR；组合f8d9ad53/run38681093813已通过源码trusted/restricted、systemd、SSHexit/retain和426项Webview，完整命令阻塞于clean-checkout packaged，首败已取得：verifyLiveRuntimePersistence等待Agent启动超时，rejected-before-acquire且editor ready/ack=true；同输入原生对照已确认停止夹具漏等Supervisor旧存储退役、pending:2满而拒绝；原完整CI无逐事件计数。三种真实原ready投递时序完整restricted通过且确认bootstrapAck，none保留20秒失败。合入后再rebase PR327完整门禁；本轮不创建诊断/验证/文档PR，临时workflow完成后移除。历史fallback资源积压与checkpoint首跑停滞保持各自未知范围。

关联：`docs/design-docs/smoke-restricted-ready-root-cause.md`、`docs/exec-plans/completed/smoke-restricted-ready-investigation.md`、`docs/references/smoke-restricted-ready-root-cause/README.md`。

## 2026-10-15：packaged Runtime重启夹具漏等旧会话退役（具名修复已验证，最新完整门禁旧代停止阻塞）

ensureAgentStopped/ensureTerminalStopped只以live=false及localExecutions退休判断；live-runtime旧session仍可能等待读者、Host保存或journal删除，符合正式pending:2责任保护。真实Supervisor134/134通过；同固定f8d9ad53、原六资产、隔离HOME/default npmci/VS Code1.142.0，两轮受控旧删除均复现verifyLiveRuntimePersistence原15秒拒绝，释放后不会补发启动；等待原两份实际退役后完整trusted通过，自然样本亦通过。六份完整工件已核验，精简输入/hash/时序集中PR335，不新增诊断或文档PR。

已按用户授权实现：仅smoke模式的只读RPC直接查原Supervisor sessions含retiring；停止前捕获完整身份并固定原socket连接，原停止/查询/等待共用15秒，两个节点停止且原存储不存在才各启动一次。17项夹具及136项实际Supervisor回归、原等待36项、类型检查与本地六资产build通过，旧具名调用稳定先红。删除失败、断连和错身份保持失败。新组合六资产通过；原生有界延迟删除屏障因果通过（644ms），完整trusted后来文件打开失败；完整组合源码trusted拒绝smoke查询，原snapshot为legacy-detached，更正此前systemd归因；源码入口仅靠ExtensionMode.Test未传显式标志，已补齐并以原main两调用回归先红、18/18及runnerenv通过。systemd独立传递要求也补齐并经startup36/36/旧负对照/typecheck/build验证。第二轮原生完整trustedexit0/645ms通过，最新55c619ad/run38696319881完整源码trusted/restricted通过，具名修复成立；完整命令首败转到旧代停止，详见下节；修复合入后仍需最终PR327预合并完整门禁，原完整CI缺少Supervisor逐事件事实。见docs/design-docs/packaged-runtime-restart-admission-root-cause.md与admission-investigation-result.json。

## 2026-10-15：旧代 Terminal 停止超时（原生恢复竞态已复现，待修复与最终门禁）

固定组合55c619ad/run38696319881的无过滤release:verify已通过新退役18项、源码完整trusted/restricted，随后legacy-supervisor-upgrade-tests.cjs:334等待旧代Terminal停止30秒失败。previous-generation-stream-terminal的原session dd00a348-d787-4cdb-a206-4fec1f587f80收到stopRequested，末次快照仍stopping/live=true、无lastRuntimeError；其他旧Agent/Terminal和新Terminal保持live。该具名夹具在PR335未改，根因未确认；不能凭stopping直接判定测试竞态、产品故障或本次回归。后续重开/systemd/SSH、Webview全套及本完整命令的clean-checkout均未触达。完整工件本地CRC/tar核验，snapshot、stop诊断及固定输入集中PR335的retirement-source-full-result.json和retirement-next-*。这项仍阻塞发布，原生packaged延迟删除完整trustedexit0只收口具名退役修复。

旧代停止调查跟进（2026-10-15）：原场景54文件不含Supervisor/PTY现场，历史唯一归因仍未知。固定原输入四份原生旧代样本通过；完整诊断run38711507240原样release:verify exit0且727文件/hash核验，复用原run资产和类外记录，不代证最终PR327门禁。真实socket/原restore方法及原生最后reload单变量对照已确认生产竞态：第二任务等待client时已收集原node；第一任务attach/subscribed后，第二deferred attach撤销原订阅，Host随后operationIgnored无重新subscribe。run38716971680 late原334行/30秒exit1，PTY12ms退出、Supervisorclosed，但Host仍stopping/live=true；natural完整旧代exit0。run38717714670同控制复核再次失败/通过，实时metadata已attached-live、原请求deferSubscription:true核验；两轮61/31文件全部校验，活动入口已移除。第一轮控制触达过早，后续原reload恢复，成功边界单列。生产修复未实施，不能通过延长等待补建订阅；完整原绑定与过时结果保护须保留。关联修复/证据继续PR335，发布PR327不变。见`docs/design-docs/legacy-supervisor-stop-timeout-investigation.md`与`legacy-stop-investigation-result.json`。

## 记录字段

- 日期
- 主题
- 背景与触发条件
- 影响范围
- 当前临时处理
- 建议修复时机
- 关联文档或代码路径

## 2026-10-14：SSH 本地后代清理 ESRCH 竞态阻塞发布门禁

PR #332 合并后，#327 最新预合并 `b0198184` 的正式 run38539427680 在 SSH exit setup ready 后失败，原 `abortLocalClient` 第114行向后代 SIGKILL 返回 ESRCH；尚未进入旧远端 Host 条件与业务恢复/resize验收。根已实际 SIGKILL，后代身份快照检查与信号之间退出被回收的窗口没有处理。该逻辑由 #328 的9daf7054引入，原18项回归没有真实后代竞态覆盖。

当前仅完成定位：实际 helper 的9种受控对照及100/100读后消失复现、真实内核正常/回收竞态对照确认；原18项仍通过。不修改正式代码、不扩大超时、不重跑或覆盖首败。CI未记录具体失败后代PID和角色，保留未知。建议在独立修复PR集中加入限定后代ESRCH复核、异常边界回归与原生exit/retain验证，再rebase #327重跑完整发布门禁；本条在完整门禁通过前仍是发布阻塞。根SIGKILL、UID/私有作用域/PID身份、EPERM和退出后置检查必须保持。关联：`docs/design-docs/smoke-local-client-exit-root-cause.md`、`docs/exec-plans/completed/smoke-local-client-exit-investigation.md`、`docs/references/smoke-local-client-exit-investigation/README.md`。

2026-10-14修复跟进：用户批准正式修复，后代ESRCH复查原身份absent/Z/X/replacement才能继续，其他错误及仍live保持失败，成功/错误信号分别记录。默认39项、隔离3项、resize9项、runner环境、实际内核回收竞态通过；原版VSCode1.141.1原生exit/retain的原Host条件、Supervisor/session、输入/真实resize与cleanup零残留通过。聚合首轮exit成功后retain准备ENOSPC仍保持exit1，回收本次结束重复载荷后新debug根单独retain通过。证据`docs/references/smoke-local-client-exit-race-fix/`，计划`docs/exec-plans/completed/smoke-local-client-exit-race-fix.md`。代码缺口定向验收已收口；剩余是修复PRreview/合入后#327最新正式预合并完整门禁，具体首败后代身份仍未知。未运行全套Webview/packaged或宣称发布已可放行。

## 2026-10-13：localhost SSH 重开双状态门禁与上游消息边界

0.26.1发布准备PR327的完整verify在SSH重开第三终端completed断言失败，Canvas已ready，原Agent/普通Terminal恢复。调查基于main ea0c9b19。R2自然复现同35秒失败，原setupHost1305563/startTicks248872585清理前持续S/R；runner仅等待本地Electron退出加三秒，不证明远端Host退出，第三终端kill -0循环因此不结束。R1原版、R3诊断正常退出通过，首败单独保留。

用户已批准退出/保留两条确定性场景。正式 runner 用真实客户端异常断连建立原 Host 保留，exit 再仅结束核验身份的旧 Host，retain 观察原身份到业务完成；第三终端按私有独立信号完成，不与 Host 寿命耦合。原 Supervisor/session、恢复/输出/输入、snapshot-only/historyDiscarded 与真实 resize 分别验收。17项控制正反例、9项resize回归及构建通过；原版 native-2 两分支全部通过、cleanup零残留。其后补充的前提保护已在完整0.26.1临时预合并source smoke中通过exit/retain，全部source场景及共享重开回归通过；完整npm test（426项Webview）和clean-checkout生产VSIX/安装后smoke全部通过，临时预合并7d33f664的release:verify退出码0。门禁前提误判已修复；PR328已合入main22803dd8；PR327已rebase并接续最新预合并完整验证，结果以PR327描述/checks关联的真实输入为准，发布准备仍未合并或发布。

研究retain-2/retain-3和exit-1/exit-2各两次通过；retain-4的13次/3213ms连续观察支持磁盘注册表短暂旧尺寸为持久化延迟，实时尺寸不回退。调查C1先在ready45秒失败、C2在旧Host信号后诊断误判zombie、研究retain-1helper路径错误、正式native-1客户端argv误拒绝，均保留边界，不能代证产品失败或业务成功。

遗留范围：上游具体丢失层未知。VS Code1.141.0 disconnect确有await；Remote SSH0.128.0 Managed(1) drain只等本地写回调，不等远端确认/Host退出。R3 drain返回unacked=3仍正常通过，不能把计数本身定因。无需等三小时或扩大completed35秒换取绿色。正式覆盖Linux localhost固定版本；其他平台、真实网络故障、原Host复用与显式重复start拒绝需各自验证，原会话数/绑定保持不变不代证拒绝命令。遇到新的退出消息丢失时继续采集具体传输层证据。

关联：`docs/design-docs/remote-host-exit-investigation.md`、`docs/exec-plans/completed/remote-host-two-state-fix.md`、`docs/references/remote-host-two-state-fix/README.md`；历史调查与双状态研究证据分别保留在`remote-host-exit-investigation/`和`remote-host-two-state-validation/`。
## 2026-10-13：最新主线完整测试通过与 clean-checkout 安装首败
背景与固定输入：用户舍弃旧发布准备 PR #313，按 main `ea0c9b19`（PR325 合并提交）重新判断。完整 npm test 原样 exit0，全部默认源码 smoke 包括 checkpoint、旧升级 resize/新旧身份/退役、窗口/共享/systemd/fallback/localhost SSH 通过，最终 Webview426/426。Host634/634、root/startup、notifier typecheck/source/companion/en/zh-cn通过。历史首败与根因边界不由当前通过覆盖；0.26.0 的版本豁免未用于本轮。
新具名风险：首次固定 ref 的 clean-checkout 在独立 npm ci 执行 Wrangler/esbuild `install.js` 二进制版本校验时返回 spawnSync ETXTBSY，尚未打包或安装 smoke，exit1。原stderr/npm日志保留，npm回滚移除了依赖目录；具体写者未确认，不定性为产品缺陷。新独立目录只增加 npm_config_foreground_scripts=true，使 npm 生命周期脚本并发1，不跳过脚本、不改依赖或断言；独立npm ci、140-file主VSIX及八组安装smoke完整exit0。该受控通过不将默认首轮追认为通过，也不证明精确根因修复。
当前处理与后续时机：本轮交付固定主线报告，未修改PR/tag workflow。发布前仍需从最终main准备0.26.1版本、文案及契约，并实际通过预合并/tag标准verify。正式CI若再次出现ETXTBSY，先采集生命周期并发及文件写者，确认是否应让两条发布链路统一串行安装；不得跳过安装校验或自动豁免。上游请求责任、原单次ready首败、普通打开持续空白缺少启动反馈、其他平台/真实provider/远端长断开和市场自动依赖等仍沿各具名范围表达。本轮不把所有历史债务追加为新发布blocker。
文档收口：共享接管的设计开头和产品规格按PR319已合并证据更新，保留四阶段真实UI及跨平台未覆盖范围；主线引用的PR322 C8样本补为逐字节本地副本及来源hash，无需合并整个旧调查PR。关联：`docs/design-docs/main-release-readiness-2026-10-13.md`、`docs/exec-plans/completed/main-release-readiness-2026-10-13.md`、`docs/references/main-release-readiness-2026-10-13/evidence.json`。

## 2026-10-13：真实窗口重开 ready 预算缓解与上游资源责任

背景与范围：PR #324确认VS Code1.141.0连续重开中未响应资源请求等待30秒、占满32名额后阻塞新CSS/JS；原单次fallback首败仍缺分层证据，不能归因。调查轮20秒是`real-reopen-tests.cjs`显式传入的历史smoke ready预算；PR #325将同fixture改为最大45秒，ready满足后立即返回。`CanvasPanelManager.waitForCanvasReady`未传timeout时默认15秒，测试命令未传有效正数时也默认15秒，仅对实际调用生效；这些时间值均不是所有用户打开Canvas的启动期限。

当前处理：仅容忍上游30秒有限结算加启动余量；不增加固定sleep或重试，不放宽active/visible/ready、原session身份、正文、输入或resize断言。正常ready立即返回，异常最多多等25秒，超过45秒保留失败工件。原版fallback两阶段与容量4对照完整通过，对照第3次ready耗时28.49秒；永久不发送ready在45.02秒按期失败并留存工件。PR #323/#324合入后rebase到main `1fb49b4e`，重新构建及原生fallback两阶段通过；控制实验保留原基线证据，未重复运行。具体验证见`docs/design-docs/smoke-reopen-ready-timeout.md`。

普通打开的现有限制：`extension.ts`的普通打开命令经`revealOrCreate/revealInEditor/revealInPanel → revealSurface`创建/显示Webview，不调用限时`waitForCanvasReady`，没有上述ready截止或对应的启动超时反馈。`getWebviewHtml.ts`的活动HTML以空app容器等待脚本启动；资源恢复后可继续异步加载，持续未启动时可能一直空白。当前没有专门的Canvas启动超时提示、重试按钮或由ready超时触发的自动重建，方法/测试命令默认15秒及smoke最大45秒不会自动提供这些能力。PR #325仅修正预算与文案，不顺带实现新的产品恢复功能。

剩余风险与建议时机：预算缓解没有修复上游销毁client后的请求责任，也不能证明原首败消失；28.49秒对照只验证该测试容忍策略。再次具名失败采集workerReady、inner frame、CSS/JS、worker队列和React/Host消息。普通打开持续空白或需要启动反馈时，另行设计有界反馈、手动重试及自动恢复取舍，并验收既有执行身份和资源生命周期；该现有限制不阻塞本次文案修正。上游修复后重新评估smoke预算。完整发布门禁、其他平台/Remote/VSIX单独验收，下方历史20秒首败与原始工件/hash继续保留。

关联：`docs/design-docs/smoke-reopen-ready-timeout.md`、PR #324与`tests/vscode-smoke/real-reopen-tests.cjs`。

## 2026-10-13：Canvas ready 原首败与连续重开的上游资源积压

背景与触发：PR #321 后原 fallback verify 在 generation5、active、ready/ack=false 时20秒超时，原会话存活。原renderer没有CSS/JS资源读取日志，缺iframe/worker/Host事件，仍不能定因。调查时main a213b89b上的R2以及恢复源码后的原短workspace N1两阶段均通过，不能覆盖首败。PR #323合入main a6bb190a后本调查分支已rebase；历史实验输入和工件保持，不代证新主线复验。

已确认的独立机制：原版VS Code1.141.0连续40/80次重开，在第33、第33/65次出现约16秒ready停顿。独立副本只加阶段记录后捕获已关闭页面的字体请求无人应答，service worker等待30秒并占用32个名额；新CSS/JS在缓存查询后排队，旧超时释放名额才继续。容量4的对照第3次触发20秒相同症状，容量128的40次通过但仍积压40个请求。只确认请求未响应与名额延迟释放，具体丢失环节未逐个证明。

影响范围：Linux Native固定VS Code版本的连续快速关闭重开可能阻塞Canvas资源启动；与PTY存活/resize不构成同一因果结论。原首败只有一次关闭重开，没有名额积累证据，故不能把本机制当作其已确认根因。PR #323的resize夹具修复仍独立。

调查轮处理：保留所有首次失败；五份临时源码与上游副本当时已恢复，真实重开smoke显式20秒预算和身份/正文断言保持；参考诊断patch、阶段记录、负对照快照和hash均repo-local。该轮不以扩大测试预算、调整sleep、容量或重试证明根因已修复，未运行完整发布门禁。后续PR #325采用[同fixture最大45秒的测试容忍策略](../design-docs/smoke-reopen-ready-timeout.md)，ready提前满足即返回；它仍不修复上游请求责任，不给普通打开提供启动超时反馈，也不替换本轮20秒样本或解除原单次ready首败的取证要求。

建议修复时机：下一轮具名ready失败立即采集outer workerReady标记、inner DOM、CSS/JS请求、worker请求与名额、React/Host消息。连续重开积压需在上游取消销毁client的请求或保障结算，再验证stream/cache/body责任；另行立项扩展可控措施，不能提高限额伪装修复。其他平台/版本和Remote单独验收。

关联：`docs/design-docs/webview-ready-root-cause.md`、`docs/exec-plans/completed/webview-ready-root-cause.md`、`docs/references/webview-ready-root-cause/README.md`、PR #322/#323；下方2026-10-12条目保留历史首次事实。

## 2026-10-12：旧升级 resize 夹具已修复，Canvas ready 与完整门禁仍待收口

背景：PR #321 后旧升级仍在首次变化 probe 与原 Agent 的尺寸相等断言超时。受控 C8 证明该夹具会固定恢复瞬态67×21，即使原会话与当前页面已为82×27仍失败；精确历史首败缺期望probe，不能追认为每次历史根因。调查 PR #322 尚未合并，本修复从 main 独立交付。

本轮已收口：probe 只读容器FitAddon目标、投影未完成事实及原会话identity；修改前等待原会话基线，修改后在共同20秒内核对精确卡片、容器、页面、原Supervisor和输入。标准原生N1/N2与受控fit延迟C3全场景通过；丢弃Agent目标resize的M1按期失败，191次样本仍是页面82×27/原session67×21，工件保存成功。9项helper、协议、50项真实controller/10项Host batch和8项浏览器回归、类型/build通过。见 `docs/design-docs/runtime-legacy-resize-convergence.md`、`docs/exec-plans/completed/runtime-legacy-resize-convergence.md` 和 `docs/references/runtime-legacy-resize-convergence/evidence.json`。

保留边界：fallback editor generation5 的 Canvas ready 首败根因未确认；现有Host diagnostics不能替代iframe资源与脚本执行证据，后续重现时继续单独定位。PR #323的resize修复轮当时不改ready条件或真实重开smoke显式20秒预算；后续PR #325的[最大45秒策略](../design-docs/smoke-reopen-ready-timeout.md)只调整测试容忍度，不追认首败原因。本轮未运行完整npm test/发布门禁；定向通过不收口后续窗口、共享、systemd和Remote SSH矩阵。此缺口不阻止已证实的夹具修复交付，但仍阻止宣称整体门禁通过及发布准备完成。
## 2026-10-12：旧升级 resize 超时定位与 fallback ready 证据边界
PR #321 合入后，用户授权优先定位resize。本轮原生基线与页面时间线确认测试“首次不同probe即固定目标”的前提缺口：初始恢复92×28、首次容器fit67×21、卡片fit82×27可以交错；probe未承诺最终目标。受控原生C8保留原20秒与内容/尺寸/身份断言，固定67×21后189次原session及最新页面均为82×27，原等待仍超时；无需产品漏发即可同类失败。浏览器暂停真实parser的Agent/Terminal两项，在移除产品探针后亦通过；最终无探针原生旧升级完整通过。没有产品或正式测试修复。PR #321历史首败未保存期望probe，仍不能逐次追认同因；未知listener/commit lease占用不归为resize问题。
后续独立修复应建立修改前restore/fit已完成的有效前提，并在原总截止核对当前卡片对应的页面目标和同一原session，保持内容与身份保证；不能简单固定sleep、延长等待或忽略resize。本轮当前测试仍可因固定过渡值误报，下一发布准备前须修复并复验完整门禁。
fallback原日志确认新容器内容更新及VS Code webview ready，但Host editor generation5仍ready/ack=false、无frameId；waitForCanvasReady实际等待visible/active/ready，不等待ack。原首败缺Host lifecycle、iframe资源/JS状态，具体根因未确认。F1/F2两轮完整两阶段通过且无systemctl提交，后者移除产品探针；正常close/open与同frame握手不证明首败修复。后续具名失败需在关闭前同时取Host事件与iframe资源/脚本/ready发送证据，原首败保持待定位，不提供0.26.1豁免。
调查过程的ENOSPC、更早probe等待失败及最终首次复验lease36758占用分别保留；只清理本轮复制依赖和原scenario资源，未停止未知listener。正式结论、全部运行hash与可复跑patch见 `docs/design-docs/runtime-timeout-root-cause.md`、`docs/exec-plans/completed/runtime-timeout-root-cause.md` 和 `docs/references/runtime-timeout-root-cause/evidence.json`。本轮未运行全量npm test或VSIX矩阵。

## 2026-10-12：发布门禁夹具与 CI 对齐后的剩余验证边界

背景与触发：PR #319 后固定主线 `c32437ac` 的完整门禁仍失败，用户授权对齐五组确定的测试/CI 问题。修复方案见 `docs/design-docs/release-gate-fixture-ci-alignment.md`。本轮已修正关闭模式、原连接请求屏障、当前模式加载断言、checkpoint 收齐等待、新 root socket 地址和提交前 unavailable fallback；两个 workflow 新增同 cache 的 Chromium/系统依赖预装和短宿主 TMP。完整 execution-context、root preparation/systemd、门禁/workflow 回归通过，checkpoint 与旧升级定向原生场景首次完整通过。

当前未收口：fallback 首次 setup 已选择 legacy-detached/best-effort，started receipt 保留且无 systemctl 提交日志；verify 在 editor Canvas ready 20 秒超时，generation 5、ready/ack 均 false，原会话仍存活。原因尚未知，重开失败工件补存现有 Host 诊断事件，等待预算和条件不变。冷缓存浏览器安装及新 cache 市场浏览器 E2E 已通过；完整 npm test 首次在 wrapper 安装入口因本机并行冷安装缓存锁退出。安装完成后按串行准备原样执行的一次完整命令通过全部纯测试/浏览器前缀及 trusted/restricted 等源码 smoke，仍在旧升级 `legacy-supervisor-upgrade-tests.cjs:250` 等待 Agent resize 与捕获 probe 一致时超时、退出 1；原输入 marker 已到达，最后 session waiting-input、82×27，期望 probe 尺寸没有存入失败工件。根因未知，不延长期限或放宽一致性。后续七组窗口重开/共享/systemd/远端场景与最终 Webview 均未由该完整命令触达。

有限补验：使用已有当前构建及新隔离目录直接运行 fallback 两阶段，完整通过并确认无 systemctl 提交。首个 Canvas ready 失败仍保留，不能以后续通过覆盖或追认根因已修复。独立 `npm run test:webview` 使用本轮新 cache，424/424 通过；结果另记，不拼接为完整 npm test 通过。

历史边界：前一轮旧升级 Terminal resize 一致性等待超时、更早 commit lease 24084 被占用均保留。本轮定向旧升级首次完整通过，完整命令又在 Agent resize 一致性等待失败；不证明旧 resize 原因已修复，没有停止此前未知 listener。提交后 unknown 的产品保护保持，本轮不将 fail-start 场景重新解释为允许 fallback。

建议时机：下一轮发布准备前收口 Canvas ready 首败及旧升级 resize 一致性原因，再验证完整门禁。resize 现场缺少期望 probe 和时间线，后续先补保存实际 Host/Page/原 Supervisor 的尺寸与请求顺序，不能直接归为页面 fit、测试竞态或产品丢 resize。CI 冷 runner/系统依赖及实际路径按发布输入验证；本机系统依赖已齐备，不代证全新 OS 的缺库安装。用户态 fixture 不代证真实 systemd、真实 provider、macOS/Windows、真实远端长断开、多 root 双窗口或完整 UI 接管矩阵；不构成 0.26.1 发布豁免。

关联：`docs/design-docs/release-gate-fixture-ci-alignment.md`、`docs/exec-plans/completed/release-gate-fixture-ci-alignment.md`、前轮报告 PR #320。
## 2026-10-12：PR319 后主线完整门禁仍有遗留失败
背景与触发条件：用户要求在 PR #319 合入后复验最新 `origin/main`。本轮固定 `c32437ac008b1d933e9e13975e60c869e7bb33d4`，Linux x64、Node 22.23.3、VS Code 1.141.0，正式产品、测试、workflow、版本和发布契约保持原输入。原 `npm test` 与完整源码 `test:smoke` 均 exit 1，不能以独立补验通过代替完整门禁。
影响范围与待收口项：
- `scripts/test/test-canvas-execution-context.mjs:708`：关闭模式仍期待 root 绑定允许重连，实际按 PR #319 规则返回 `runtime-persistence-disabled`；相邻后续断言也需按正式契约校准，失败脚本未触达的段落仍待验。
- `tests/vscode-smoke/extension-tests.cjs:390`：checkpoint 首个 8192 字符分页到达时就要求声明的 104842 字符总长度；PR #317 的收齐等待修正未进 main，后续内容断言未通过，不能认定产品丢失内容。
- `systemd-fallback-real-reopen`：fixture 的 fake systemctl `fail-start` 已提交，保留 intent 且无 started receipt，却仍要求切换 backend；与提交后 unknown 禁止二次提交的正式契约冲突。提交前明确 unavailable 的纯回归通过，真实该语义的重开 fixture 尚待对齐验证，不能放宽产品保护。
- `.github/workflows/release-preflight.yml`、`.github/workflows/publish-marketplace-release.yml`：没有为早期市场浏览器 E2E 预装 Chromium，空 `PLAYWRIGHT_BROWSERS_PATH` 的原入口实际报缺 revision 1217 executable。PR #317 的浏览器/cache/短 TMP 准备未合入；完整冷 runner、系统依赖及默认长路径仍待正式 CI 验证。
- `tests/vscode-smoke/legacy-supervisor-upgrade-tests.cjs:318`：新 root 会话使用旧 socket resolver，下一步 ready 连接报 `ENOENT`。新 root owner/started receipt 已保留，正确地址为 root `d-*` socket；PR #317 的 resolver 修正未进 main，旧升级与退役后续断言尚未取得完整通过。
独立待定位项：旧升级换目录业务复验在第 259 行等 Terminal resize 与捕获 probe 一致，20 秒超时。原 Terminal live、85x28，Webview/Host input marker 均到达 PTY，但 expected probe 没有持久快照，不能确定产品 resize 故障或瞬时几何夹具问题。仅追加一次原参数稳定性复验越过该段，随后停在新 root socket 错误；越过不覆盖首败。更早一次运行停在 `127.0.0.1:24084` commit lease 占用，退出后只读观察仍有 listener，未停止该 listener。没有一次完整旧升级通过，不能将全部失败归为纯 fixture。
当前处理与边界：保留三次旧升级停点、全部首次失败日志及 85 条执行记录，未修改测试期待、产品准入或等待预算。完整 Webview 424/424、Host 634/634、56 项后续非完整 UI 组成检查、八场景 clean-checkout VSIX、双窗口共享、systemd user 重开及 localhost Remote SSH 重开均通过。此前 systemd Canvas ready 和主题超时本轮未重现，旧根因仍未知。浏览器下载准备中断发生在用例开始前，单独记账。
建议修复时机：下一轮发布准备前，对齐确定的测试契约、分页等待、新 root resolver 及 CI 浏览器准备，补齐旧 resize 的请求/probe/应用时序证据并定位；之后重新执行完整门禁。登记不构成发布豁免，本轮未准备 0.26.1 发布输入、未执行其预合并/tag verify，macOS/Windows、真实 provider、真实远端长断开、完整 UI 接管矩阵及真实多 root 双窗口不由本轮代证。
关联：`docs/design-docs/main-validation-2026-10-12.md`、`docs/exec-plans/completed/main-validation-2026-10-12.md`、`docs/references/main-validation-2026-10-12/evidence.json`、`docs/design-docs/runtime-root-ownership.md`、`docs/design-docs/runtime-shared-root-canvas-sync.md`。

## 2026-10-09：活动本地执行在画布重读和 workspace root 重组时失去绑定

PR #313 自启动超时已定位：`setPersistedStateForTest` / `reloadPersistedStateForTest` 重建 metadata，`reconcileRuntimeNodes` 只认识旧 session map，遗漏当前 `nonNativeHostExecutions`。原生复现中旧执行仍 running，但节点被恢复成 resume-ready/interrupted；同 ID 恢复因原 key 占用拒绝。真实 VS Code 已保存 workspace 从一个 root 添加到两个 root 时，同 Host 内节点 ID 加 root 前缀，旧执行未迁移或退休，另启动了一条同 resume session 的 Agent。属于正式产品生命周期缺陷，不能仅调整 smoke 顺序后放行发布。

PR #314 已实施具名修复：同 ID 重读保留原 metadata/status；root + local node ID 驱动 owner/Host 原子路由迁移；移除 root 先停止并按旧 root 组合保存尾部；失败、超时与 Host 永久关闭保留责任；模拟 reload 在原有总边界内等待最终保存后恢复准入。smoke 的创建与整图夹具已隔离，新增原生 `owned-canvas-reconciliation` 并纳入默认源码/VSIX 入口。受控测试涵盖准备中迁移、resize 等待、最终读盘及失败保护。关联：`docs/design-docs/smoke-reload-autostart-investigation.md`、`docs/exec-plans/completed/canvas-owned-execution-reconciliation.md`。

2026-10-10 继续修正测试：burst/hello/sleep/slowspin 和 Terminal shell 输出已按原 executionId/generation 的实际快照/连续输出验证，正文正反例 14/14；停止摘要按实际退出结果验证，停止后 resize 保留最终快照原尺寸与正文。额外修复了正常原生 Agent/Terminal 重复启动没有进入 already-running 分支的问题，Host 356/356（新增 2 项）、快照尺寸 16/16 通过。默认 VSIX 的 owned reconciliation 与新增 local-execution-flow 均通过，旧 burst 阻塞已收口。通知用例两处同类正文条件已迁移，但独立 UI 路径尚未原生复验；其他未触达的 Runtime/恢复/压力场景不能由本次结果代证。

剩余发布门禁（2026-10-10 专项定位）：原生 resize 的 `Execution terminal interaction admission is closed or unsupported` 已在两次真实 VSIX 运行中捕获四次 starting 阶段实例。请求来自真实页面自动 fit；Host 在 business 建立后就派发 resize，尚未等 provider ready/started，底层因此拒绝。拒绝时无停止请求、process/source/seal 或 authority 隔离。移除临时产品探针后的 Agent/Terminal × ready 前/started 前四项特征对照均复现，running 后同请求成功；这是插件启动协调缺口，不能靠调整 smoke 等待或清 toast 解决。后续用户授权后已在 PR #314 修复：准备及 starting 保留最新尺寸，原执行就绪后派发，启动期间不阻塞正文消费；5 秒交互期限从就绪起算。准备/启动失败和停止/删除/关闭均结算 pending 意图，已确认 resize 紧邻关闭仍提交原 tracker，未知结果与绑定替换保留错误。Host 376/376（新增 20 项）、类型检查及 VSIX 打包通过，两个默认具名场景通过，trusted 走过原 resize 失败路径且清理诊断前未发现本地 resize 失败。该 resize 缺陷已收口；完整发布门禁仍有下述独立通知阻塞。

旧两次页面 probe 失败没有瞬时状态，不能逐次追认都是启动窗口；新诊断在更晚的重启场景捕获同类错误，并额外发现一次 stopRequested=true 的 Host 层 `Owned terminal mutation admission is closed.`。后者已按正常关闭后取消未派发尺寸意图处理，覆盖出队前停止/源结束；failed/unconfirmed 与绑定错误继续报错。过程与可复跑证据：`docs/exec-plans/completed/resize-admission-investigation.md`、`docs/references/smoke-reload-autostart/resize-admission-evidence.json` 及相邻两个 resize patch；历史失败工件继续保留。

新触达的独立门禁：两次只读诊断运行通过普通 `verifyExecutionAttentionNotificationBridge`，但 `verifyAgentAbnormalInterruptionNotifications` 在退出 27 后等待 `execution/attentionNotificationPosted` 超时；节点为 error、lastExitCode=27、attentionPending=false。resize 修复后的默认真实 VSIX 再次停在相同检查，未放宽断言。2026-10-10 专项定位已确认产品缺口：snapshot-only 的 `persistNonNativeHostFinal` 完成 error/27 最终保存，却未调用现有异常退出通知入口；Codex/Claude 两项非主动退出受控复现均为通知调用 0 次，同配置直接调用原入口则 posted/展示/attention 正常，正常退出和主动停止对照仍不通知，特征验证共 4/4。workbench 事件名与 smoke 一致。定位轮未修改产品；后续用户授权后，PR #314 已接回共享异常退出策略，提醒并入原最终保存，投递异步且失败不改变结算，保留正常退出/主动停止/重复及旧绑定保护。新增 19 项、完整 Host 395/395、类型检查、notifier source 通过。默认真实 VSIX 的 Codex exit 27 和 Claude exit 33 通知事件、提醒、workbench 提示及确认均已通过，原通知缺口已收口。定位证据：`docs/exec-plans/completed/owned-agent-exit-notification-investigation.md`、`docs/references/smoke-reload-autostart/exit-notification-evidence.json` 及相邻 characterization patch。修复结果：`docs/exec-plans/completed/owned-startup-resize.md`、`docs/references/smoke-reload-autostart/resize-repair-evidence.json`。

2026-10-10 新触达的独立发布阻塞：同一默认 VSIX trusted 随后在 Claude 恢复启动失败状态检查（`verifyAgentAbnormalInterruptionNotifications` 的 resume 子场景）超时。原执行以 33 退出并保存/退休，attentionPending=false，但 status=error、lastResumeError 缺失，测试期待 resume-failed。`persistNonNativeHostFinal` 没有旧路径的 resumePhaseActive 分类分支；通知抑制正确，不应把此状态问题归因于通知渠道或放宽断言。当时通知修复未改这一语义。后续用户授权后，PR #314 已按原 resumePhaseActive 补回恢复失败分类，保存恢复原因并清理旧错误；14 项新增回归、完整 Host 409/409 与类型检查通过，默认真实 VSIX 已通过原恢复失败及新增错误字段一致性检查，该分类缺口已收口。证据与计划：`docs/references/smoke-reload-autostart/exit-notification-repair-evidence.json`、`docs/exec-plans/completed/owned-agent-exit-notification-repair.md`。完整门禁仍未通过。

2026-10-10 此前独立阻塞：恢复失败修复后的默认 VSIX trusted 进入 `verifyExecutionTerminalNativeInteractions` 后，拖放文件路径输入失败。原 Terminal live；诊断 `execution/dropResourceRejected` 明确为 missing-session，同 executionId 的真实正文只有 `DEV_SESSION_CANVAS_NATIVE_DROP:` 而没有路径。`handleDroppedExecutionResource` 仅查旧 session map，未认识当前 owned 本地执行，是产品接线遗漏；该 smoke 同时仍从 metadata.recentOutput 等待实时正文，存在旧断言。当时拖放入口和该测试尚未修复，不能仅改测试放行。证据与本轮计划：`docs/references/smoke-reload-autostart/resume-failure-repair-evidence.json`、`docs/exec-plans/completed/owned-agent-resume-failure.md`。

2026-10-10 拖放修复已在 PR #314 收口：复用原输入目标校验，使用 owned 原 launchSpec 的 shell/cwd 准备路径并等待原执行写入确认；停止/旧 metadata/节点删除/隔离/缺少上下文拒绝，等待期间不转投替换执行。保留旧 session 路径，本交互 smoke 的实时正文改从原执行通道读取。新增 17 项回归，完整 Host 426/426、正文 helper 14/14、路径 helper 与类型检查通过；两轮默认 VSIX 均通过构建、两个具名阶段及真实拖放首资源/路径、文件、图片和 cd 相对文件定位。计划与证据：`docs/exec-plans/completed/owned-execution-resource-drop.md`、`docs/references/smoke-reload-autostart/resource-drop-repair-evidence.json`。

此前独立阻塞：两轮 trusted 随后均将多行文件结果 `2:8` 解析为 search/quickOpen，期待 file。第二轮明确等待原执行的两行结果及页面可见相邻两行后仍复现，排除仅由命令回显或未渲染导致提前点击。`getExecutionTerminalPathContext` 尚未接入 owned business 的逐行 cwd tracker；该源码缺口与本次失败的完整因果对照待专项定位，不在拖放修复中顺带改写。完整门禁仍失败；后续缺失文件搜索、URL hover/显式 URL 和 Runtime 场景尚未触达。

2026-10-10 多行文件链接已在 PR #314 收口：owned 原 launchSpec 和原 business.lineContextTracker 接入路径上下文，相对解析缓存加入执行身份；只读解析保留停止后的原正文目录和旧 session/历史回退。新增 8 项、完整 Host 434/434、路径 helper、逐行 tracker、类型检查通过。真实 helper 修前将 subdir 文件解析到初始目录，修后正确；默认真实 VSIX 整个 native interactions 完成，含多行 2:8/file/编辑器位置和后续缺失文件搜索、普通/显式 URL。原多行解析缺口已闭环，本轮未改 smoke。计划与证据：`docs/exec-plans/completed/owned-execution-file-links.md`、`docs/references/smoke-reload-autostart/file-link-repair-evidence.json`。

此前独立阻塞：后续 `verifyRuntimeReloadPreservesConfiguredTerminalScrollbackHistory:8523` 仍等待历史 metadata.recentOutput 出现 SCROLLBACK_PERSIST-220。原节点 live，同执行最终 Host 快照已有 001/220，metadata 却仍是此前 native interactions 历史；超时发生在该函数的 simulateRuntimeReload 之前，不是 reload 后丢失历史的证据。后续需把运行期正文等待改为原执行实际通道，并继续保留停止保存/reload 后首尾行保留检查。本轮未修改该独立用例，完整 trusted 和后续 Runtime/压力矩阵仍未完成。

2026-10-10 滚动历史旧断言已在 PR #314 收口：新 Terminal live 后捕获原 executionId/generation，复用原实际输出等待替代运行期 metadata.recentOutput 条件，20 秒期限与所有保存/reload 首尾行断言保持。语法检查、正文 helper 14/14、旧现场回放通过；默认真实 VSIX 已完成滚动历史的原执行 -220、模拟 reload 后持久化首尾行、重新请求历史快照首尾行检查，以及后续 editor/panel 标签切换和主题跟随。本轮未改产品；证据见 `docs/references/smoke-reload-autostart/scrollback-smoke-repair-evidence.json`。

最新独立阻塞：`verifyRuntimeReloadRecovery` 在首次等待 Codex Agent live 时超时，尚未执行此场景的 simulateRuntimeReload。Agent stopped/liveSession=false，Terminal 已启动；日志出现 `Non-native Host start was rejected-before-acquire` 及未处理 promise 拒绝。2026-10-10 专项调查已确认：smoke 连续派发不等 started，Terminal 在 Agent CLI 解析期间先占唯一 starting 名额；Agent identity 正常、owner 未关闭/隔离，实际命中 starting=1。底层拒绝符合产品契约；snapshot-only owned 启动抛错却未由页面入口消费，没有 host/error，是独立产品反馈缺口。双顺序重叠拒绝、started 后同节点重试均已受控证实（2/2），两者可同时 running。后续在继续 PR #314 修复、恢复完整门禁前，应同步修正该 fixture 启动顺序并补齐用户快速连续启动时的错误反馈/诊断，保留正式准入和身份保护；不得提高上限或只延长等待。本轮只定位，临时探针/测试已恢复，完整 trusted 仍失败。关联：`docs/design-docs/smoke-reload-autostart-investigation.md`、`docs/exec-plans/completed/owned-start-admission-investigation.md`、`docs/references/smoke-reload-autostart/start-admission-evidence.json`。

2026-10-10 启动顺序和拒绝反馈已在 PR #314 收口：页面立即消费启动拒绝，保留原身份/outcome 诊断与本地化提示；只跟踪本请求新建记录，取消/替换/删除的迟到错误只记诊断，旧 stopping 记录阻塞新请求仍提示，不修改原资源责任。smoke 逐个等待原 executionId 的 started。新增 20 项、完整 Host 454/454、类型/本地化和正文 helper 14/14 通过；最终默认真实 VSIX 两个具名阶段、页面 probe、通知/交互/滚动历史等前缀通过，原 Agent/Terminal 起始启动均确认完成。关联 `docs/exec-plans/completed/owned-start-admission-repair.md` 和 `docs/references/smoke-reload-autostart/start-admission-repair-evidence.json`。

新的独立阻塞：`verifyRuntimeReloadRecovery:8826` 在自身模拟 reload 返回后期待 Agent resume-ready，实际 stopped；Terminal 实际 closed 而非后续期待的 interrupted。两条原执行已 saved，Agent 恢复策略和 session ID 保留。需在继续恢复场景/发布准备前定位 Host boundary 的最终停止状态与重读恢复意图的关系，不应直接放宽断言。本轮未修改该终态逻辑，后续恢复/Runtime/压力矩阵未通过。中间另一次默认运行早期 Host boundary 保存仍 pending；最终复跑跨过，但原失败原因未确定，保留 pending-save-artifacts，若再次出现需跟踪原执行保存责任，不能延长期限或把重跑成功追认为当次保存完成。





workspace trust / editor deserialize 已审计共用入口，但独立 UI 路径、真实窗口 Reload、跨版本及 Remote SSH 不在本轮原生验收范围，继续依赖各自验证矩阵。

## 2026-10-08：旧 Supervisor 的创建拒绝仍缺资源结果

0.26.0 现场旧会话 journal 写入 ENOSPC 后 owner 隔离，新建/恢复在获取资源前收到普通准入错误。Host 已设置 `submitted=true`，但只对精确的 `rejected-before-acquire` 文案释放预留，因此新节点残留 Starting/Resuming，删除被原创建待确认保护拒绝。实际两个新 session 均未创建；旧失败会话仍有未消费尾部，二者责任不能混同。

后续独立修复已为新代码的明确拒绝增加 `createSessionOutcome`，覆盖 Agent/Terminal 创建、恢复、重试和删除，保留断连/资源已获取/未知结果保护。已有旧 Supervisor 不会随 Host 热更新，也不会补发原请求的结构化结果；它的普通错误、旧固定文案及更新前残留的未知记录继续保守保护。后续旧 Supervisor 退役或明确历史创建恢复工作如需解除保护，必须从原责任方获取身份匹配的资源证明；不得凭错误字符串、超时或 registry 缺项追认。关联：`docs/design-docs/runtime-admission-rejection-settlement.md`、`CanvasPanelManager.withExecutionCandidateStart`、`RuntimeSupervisorServer.createSession`。

## 2026-10-09：四项原失败及模板/reset/hover 后续修复，完整门禁仍有启动阻塞

发布准备 PR #308 已关闭。PR #310 在 `origin/main@f57b11f9` 上定位并修复四项原失败：清单入口显式构建双扩展、主题断言跟随实际组件、styled 路径支持四物理行内软/硬混合折行、owned local 确认启动后记录同身份诊断。双 dist 移开后的正式清单入口、主题/typecheck/build、原 hardwrap 22/22、新混合折行 12/12、Host 336/336 通过；真实 VSIX 已越过相对 shell 的 started、live 快照和真实 PWD 输出断言。原始引入证据保留，详见 `docs/design-docs/release-blockers-investigation.md` 与 `docs/exec-plans/completed/release-blockers-repair.md`。

本轮继续修复后的结果如下，不能把具名修复写成完整 npm / packaged 门禁通过，也不恢复 0.26.1 发布：

| 触发与影响 | 证据及当前边界 | 后续修复时机与入口 |
| --- | --- | --- |
| 模板源码断言，已修复 | f02dafd3 将缺失关联 Markdown 按钮/文案检查迁到 fileNoteNodes.tsx，保留原断言，完整模板命令通过，npm test 已越过此处。 | 无剩余具名缺口；源码职责再迁移时同步检查。入口 `scripts/test/test-canvas-templates.mjs`。 |
| Terminal 初次 hover，已修复 | 捕获选区直接重绘覆盖下划线、当前链接仍 hovered 的调用栈；a8f057b1 在原绘制后重画当前仍启用的装饰。真实 xterm 正例修前失败，修后 4/4；原 Agent/Terminal URL/file 用例和新回归三轮 24/24。 | 适配依赖当前 xterm 内部接口，升级依赖必须执行真实选区回归与原悬停测试；不依赖 timeout/retry。入口 `executionTerminalSelectionLinkRendering.ts` 与 `execution-terminal-selection-links.spec.mjs`。 |
| 两处 QuickPick 清理，已修复 | f02dafd3 各自清理本例 Agent，保留诊断，helper 19/19；真实 clean-checkout 已通过一次 reset 与 pending→同执行 saved→第二次 reset 两条路径。a8f057b1 的全包运行在更早的 shell 重启失败，未到这两处。 | 原身份、20 秒总预算、至多一次再次 reset 与生产 pending 中止契约保持。入口 `tests/vscode-smoke/reset-canvas.cjs`、两个 QuickPick 用例。 |

前一轮完整 Webview 为 392 passed / 2 failed，失败及基线对照仍在正式设计保留；最终 a8f057b1 全量 Webview 398/398 通过（11.6 分钟）。Windows/macOS、真实 TUI 的更宽范围未在本轮验证，继续保留各原计划边界；本项没有引入版本例外或放宽发布门禁。

新暴露的启动问题按 `docs/workflows/TECH_DEBT.md` 单独登记，不扩写成已确认的 fixture 问题。它们仍阻塞完整门禁；当前定向修复证据成立不等于已有可合并/可发布结论。下一次恢复 npm / packaged 验收前优先定位，不能吞错误或放宽保护：

| 背景与触发 | 影响、当前边界与后续入口 |
| --- | --- |
| Runtime checkpoint：umask 0002 下 globalStorage 为 0775，root 准备失败 | 未修改的真实目录检查明确拒绝组可写目录；0077 独立目录对照中 Agent live，但 Terminal 又 `rejected-before-acquire`。权限和资源准入是两层问题，后者原因待查；未放宽生产权限检查。入口 `runtimeRootOwner.ts`、`runtimeRootPreparation.ts`、`runRuntimeCheckpointRefreshSmoke`；原工件 `/tmp/dsc310fs/runtime-checkpoint-refresh/artifacts`，对照 `/tmp/dsc310cpprivate/runtime-checkpoint-refresh/artifacts`。 |
| 最终包 shell 停止后立即重启，旧 key/容量仍占用 | saved 早于重启，不能归为保存 pending；需捕获原 owner 退役/reader 责任，明确测试时序与产品恢复责任。禁止盲重试和提前释放 key。入口 `verifyTerminalShellPathRefreshesStoppedTerminalNode:3325`、`startNonNativeHostExecution` / `retireNonNativeHostExecution`；工件 `/tmp/dev-session-canvas-clean-checkout-eeYcdR/repo/.debug/vscode-vsix-smoke/smoke-runtime/artifacts`。 |
| 前一包 resize / persisted reload 后自动启动超时 | f02dafd3 已通过修复的 QuickPick，后来出现 creation admission closed、metadata/resize authority binding changed；需检查状态重载是否替换原执行绑定，责任未确认。入口 `verifyNodeResizePersistence` / `verifyAutoStartOnCreate:4909`、`reloadPersistedStateForTest`；工件 `/tmp/dev-session-canvas-clean-checkout-Fi8Bvo/repo/.debug/vscode-vsix-smoke/smoke-runtime/artifacts`。 |

本轮方案、受控验证及上述独立失败的证据边界见 `docs/design-docs/release-blockers-investigation.md`、`docs/exec-plans/completed/release-validation-followups.md`。

## 近期已收口

- 2026-10-09：PR #310 review 的满行路径终止边界已修复。默认样式括号/空格说明软折到下一行时，循环内和四行窗口末尾使用同一真实 cell 终止证据，保留完整链接；真正续段、样式变化、缺失内容和超出窗口继续拒绝。新增 26 项及既有链接/悬停/选区回归 68/68，typecheck/build/路径解析通过；最终四行夹具修前无后缀 2/2、括号 0/2。既有完整 npm/VSIX 启动阻塞仍见上表，本轮未重跑这些门禁，也不声明 review 已批准。见 `docs/design-docs/release-blockers-investigation.md`、`docs/exec-plans/completed/pr310-hardwrap-review-boundary.md`。

- 2026-10-09：PR #306 review 的 openTerminalRead 超时遗失迟到资源清理已修正。调用者 15 秒得到未知结果，原请求保留 ID/socket 并向 relay 交付迟到 descriptor，只沿原 client cancelled close；旧 reader 不关闭新绑定，每 key 两个责任上限不因超时失效。直接调用由 client 清理，错误/断连/close 超时不伪造 applied、不重发。旧 head 两项组合反向对照失败；新增 14 项回归后请求测试 37/37、reader 32/32、Host 333/333、完整协议门禁与类型检查通过，无新增技术债。见 `docs/design-docs/runtime-rpc-request-timeout.md`、`docs/exec-plans/completed/runtime-reader-open-timeout-cleanup.md`。

- 2026-10-09：协议回归两处同步前提已修正。attach gap 在订阅前等待指定 marker，真实 PTY 等完整非 live 终态后验证 resize 拒绝；新增真实串行链路屏障测试，单独覆盖退出已通知而终态尚未发布时的立即拒绝和尾部完整性，保留回放连续/恰好一次及 scrollback/output 顺序断言。完整协议门禁（含请求超时 23/23）通过；取消同步关闭准入、绕过 resize 准入的两项临时变异均被新测试捕获，无新增产品接口或技术债。历史第 548/992 行失败与自然场景 marker 后 27ms resize 成功、639ms 才退出的证据仍保留；不把受控 EBADF 追认为历史返回值。见 `docs/design-docs/runtime-protocol-race-root-cause.md`、`docs/exec-plans/completed/runtime-protocol-race-test-repair.md`。

- 2026-10-08：F-01 普通 hello / RPC 缺请求级超时已专项收口。hello/连接 5 秒、普通 RPC 15 秒、ready 共用剩余预算，清理到期 pending 并返回结果未知的独立错误，不重发副作用请求。严格删除原有 first 到期 unconfirmed 及迟到 current 补证保留；不能误写成此前所有删除无界。新增 23/23 请求级测试（含真实无响应 socket）、reader/严格删除 31/31、Host 接线 296 项及协议/分页/输出信用/类型/本地化回归通过；修前 pending 不释放有对照失败证据。普通请求超时不销毁健康并发连接，hello 超时销毁未握手连接；这是相对旧审核建议的明确取舍。详见 `docs/design-docs/runtime-rpc-request-timeout.md`、`docs/exec-plans/completed/runtime-rpc-request-timeout.md`。backend 启动和文件系统不是 RPC 预算范围，多平台真实宿主未在本轮重跑。

- 2026-10-08：明确未获取资源的准入拒绝已完成启动状态与预留收尾。Host 327/327、Supervisor 116/116、客户端 32/32、现有 Supervisor 协议回归和类型检查通过；旧实现回归先红后绿。新请求可重试/删除，不解除旧故障会话隔离；旧进程及历史未知记录的边界见上。计划：`docs/exec-plans/completed/runtime-admission-rejection-settlement.md`。

- 2026-10-08：PR #296 packaged smoke 的首个启动诊断超时已定位并修复：`simulateRuntimeReloadForTest` 在同一 Host 上关闭 execution owner 后未恢复准入，污染紧随其后的 QuickPick 用例。成功重载现在通过 `tryResume()` 恢复准入，拒绝恢复时显式失败；新增 4 项回归先红后绿，Node 22 完整 Host 接线 236/236、类型检查通过。真实 `test:vsix-smoke` 已越过原第 2619 行启动断言，但完整命令仍失败，后续 reset 缺口另列；不关闭 packaged smoke 总体债务。见 `docs/exec-plans/completed/packaged-smoke-reload-lifecycle.md`。

- 2026-10-08：F-03 root 稳定归属按有限 R1-01 至 R1-08 已收口。两类单根/多根新建共用执行环境、用户存储、root、generation 归属；旧 live 保留原绑定，不迁移。原生三平台/systemd、同包三平台 installed/Codex、Linux 双窗/Remote/Terminal 边界/Codex PaneGallery 和最终 Claude Reload `37725028656` 均有具名通过及独立核对，旧 slot 退役按受控层级复用。最终 VSIX 为 `a37f0c3e5afeba5132b5f5eb88104bb36d0670887572c44adbc05cd91097203f`；故障 A 不计正常 EOF，Claude 仅清理已空闲隔离 Supervisor，不冒称自然 idle。历史失败及下表残余不自动变成新阶段，尾部/unknown/资源断言不变。计划归档 `docs/exec-plans/completed/runtime-root-ownership.md`，正式证据见 `docs/design-docs/runtime-root-ownership.md` §8。

- 2026-10-07：B4、F-04具名当前态增量和最终默认分发已收口。e38d2f72/run37613549564新VSIX的三平台installed live、Codex natural/独立Reload及Linux Terminal Reload均独立核对通过，产品有限审查无新确定性blocker，计划归档；明细见有限收尾§13。同key开读/取消等待无界责任已修，填充态10200040字符/1246块、原身份、尾部及清理通过。Windows按原handle明确确认退出，不要求对象销毁；不以旧包通过代证最终包，不追加容量/工具阶段。以下旧日期中的“待验/受限”是历史状态。

- 2026-10-06：GitHub run `37479044769` 的 package、native assets 和 Windows product 通过；Linux current-state reload 的 `setup.json` 缺失已由工件定位为 fixture 不接受 driver 的 shell `printf` 命令，已改成显式 fixture marker 命令，待重跑验证。macOS Agent 在 `starting` 阶段失败且 sanitized 报告未提供 CLI/Supervisor 第一现场。已补最小脱敏失败 snapshot/events 与 reload names-only artifact inventory，待受影响 runner 重跑后再分类；不把 harness 失败追认为产品通过，也不扩大到跨平台 current-state 实现。

- 2026-10-06：B4 current-state codec、Supervisor/Host/Relay/Webview 分块交接及 controller authority/revision 接续已完成受控验证；三项 Playwright 页面重建 3/3、结算 wiring 27/27、构建/VSIX 通过。`runtime-checkpoint-refresh` smoke 已按 stateChunk/捕获后 revision 更新，但真实 VS Code 重开、真实 Agent/Terminal 和现代三平台当前状态入口仍未执行；current-state 总长度/组装峰值没有硬预算，列入 F-04 生产准入，不以单页 8192 或旧 64/128 MiB 观察阈值代替。Electron/sockets 在本地 sandbox 启动前被 EPERM/SIGTRAP 拒绝，保留原证据。
- 2026-10-06：本地收尾复验重新通过默认构建/打包、codec 15/15、reload 契约 12/12 和 Playwright current-state 3/3；runtime supervisor protocol 仍只受沙箱 Unix socket `listen` EPERM 阻塞。current-state reload harness 已补齐 Darwin `psutil/libproc`、Windows SafeHandle 与平台启动参数，待现代三平台 runner 分别验收；旧系统不属于本轮支持基线。
- 2026-10-06：旧 History restored 节点已加入已知旧Linux systemd generation的只读核验及未提交失败重试；第二现场证明5个原目标已走历史退役，另补未写终态的stopped-runtime强停止资格，不改原unknown或共享registry。第二轮核验81/Host190/启动16/typecheck/build/debug staging通过；首轮Client28、deactivation、reader原样重跑20及首次尾部超时保持。新分支原窗口未操作、两项原生socket受限；两个native detached具名缺口见下表，不冒称所有历史节点均已修复。
- 2026-10-02：A1/r23 在现代 Linux Electron 固定候选上完成一次两 Terminal attach/compact 组合；动态 scrollback、两次 resize、约 18 MiB 后置输出、current/previous checkpoint、retained prefix、同一分页 reader 的 compact 后交互及 cleanup 均通过。该项只关闭具名固定组合，不关闭 F-04/A1 总体、真实 Agent/Webview、跨平台/packaged 或最终准入；manifest generation 按 durable current/previous 事实核对，64/128 MiB 合并进程历史阈值与失败保持。
- 2026-10-02：A1/r24 沿同一现代 Linux Electron 候选入口复核 attach/compact 组合通过，manifest current/previous `6572/6503`、retained start `6504`、journal head `11184`，reader identity、页面交互和本方 cleanup 均成立。该路径仍是显式 candidate、Runtime Persistence 默认关闭的固定输入；复核不形成产品并发或资源预算，也不替代最终默认启用准入。
- 2026-10-01：第49节三平台schema2/实际requirements、旧Node同名namespace和六资产聚合代码已实现，固定分发脚本本地Linux x64整条构建/双宿主加载/归档通过。首次六格远端产物、最低OS原生环境、最终产品版本及默认准入仍在原B2/A5有限队列；加载不等于PTY/页面验收，不增加通用工具债务。
- 2026-10-01：第47节root写失败阻断已有reader最终水位已分离发布与保存，真实root writer先红/Host147回归后，新固定installed包原多根场景唯一复验exit0并独立核对。A真实EISDIR仍保来源/binding且原reader applied4，B原执行nonce24.9ms，reset零责任、真实空registry落盘后外部TERM与资源退出通过；旧包首败和cleanup失败不追认。该多根格收口，不代证自动重试、root稳定归属或snapshot-only实际Host离开。第48节旧banner断言按32.4修正后八项通过，原4/6保留。
- 2026-10-01：A2/A3已结束snapshot被页面resize只改尺寸标签的跨平台结构问题已修；实际Host先红3/12后最小保护16/16、原Host147/147、Runtime completed及typecheck通过，保留原快照内容和原尺寸，新candidate仍独立获得当前viewport。原macOS Claude整轮因果、实际页面/非空stop重开仍未证明；既有浏览器六例4过/2失败原现场保留，具体终态责任继续按生产接入第48节处理，不将局部修复写成总体收口。
- 2026-09-17：F-05 的新 Runtime completed 历史内联已收口。用户明确重开不需要进程或历史后，Host 只保存轻量终态，可明确识别的旧 Supervisor completed stream 加载时清理；当前页面仅临时收齐尾部，保存失败保留来源。实际 completion + writer fixture 为 Terminal 781 / Agent 812 字节，输出体积增大不改变保存体积；Linux 常规完成重开、真实关闭再开、单根转多根与实际 xterm 逐行 90000 行已有通过证据。完整终态临时聚合仍计入 F-04，旧 serialized-only 来源模糊记录保留兼容，不把整个运行时或极端尾部短读写成已修复。设计与证据见 `docs/design-docs/runtime-completed-no-history.md`、`docs/exec-plans/completed/runtime-completed-no-history.md`。
- 2026-09-14：开发依赖 npm audit 告警已收口。root `overrides.qs` 从 `6.15.2` 升至 `6.16.0`，覆盖 `@vscode/vsce -> typed-rest-client` 的两个 `qs` moderate advisory；root、Marketplace 与共享包的 Vitest 从 `3.2.7` 升至 `4.1.11`，覆盖 `@vitest/mocker` 路径穿越 advisory。`npm audit` 与 `npm audit --omit=dev` 均为 `0 vulnerabilities`；Marketplace API `99` 项、Web `45` 项、共享包 `28` 项测试及 Marketplace typecheck 均通过。
- 2026-07-17：Marketplace X11 录制的 ffmpeg 首帧 ready handshake 已收口。`record-start` 现在为每条 clip 创建独立 `-progress` 文件，轮询到 `frame >= 1` 才允许原生输入继续；15 秒无首帧或 ffmpeg 提前退出会停止当前进程并给出 progress 路径，`record-stop` 在 probe 后清理进度文件。纯函数测试覆盖空/部分 progress、首帧、超时和提前退出；本轮两个 Codex、两个 Claude Code 的三条真实 X11 scene 均经过握手并完整捕获首个动作，因此删除原“固定等待 300ms”未收口条目。逐 clip contact sheet 仍是内容完整性门禁，ready 只解决首帧竞争，不替代视觉验收。
- 2026-07-13：Runtime Supervisor final-state 协议门禁的 Node 版本误判已收口。`0.24.1` 发布准备曾在 Node `25.6.0` 连续两次失败、Node `22.23.1` 单次通过，因此临时登记为 Node 25 差异；后续在最终 `v0.24.1` ref 上确认两版 Node 都能原样通过或失败。诊断没有发现缺失终态：2 MiB 样本的完整 final state 在约 3.69 秒 / 8.88 秒后到达，三项 revision 一致且 marker 完整；真正的门禁误报来自测试固定 `delay(3000)`，延迟放大则来自强制 multi-chunk drain 每块都全量 serialize。当前 `SerializedTerminalStateTracker` 只在强制 drain 全部落定后 serialize 一次，96 KiB 回归从旧实现的 5 次收敛为 1 次；协议用例在 15 秒失败上限内等待满足完整 revision 不变量的 final-state 事件，不降低内容或 revision 断言。Node 25 与 Node 22 各连续三次通过 `test:runtime-supervisor-protocol`，因此删除原 Node 25 未收口条目；这不关闭独立的 90000 行 PTY 尾部短读风险。
- 2026-07-07：notifier 真实宿主 locale smoke 缺口已收口。本轮新增 `npm run test:notifier-locale-smoke`，分别用 `--locale=en` 与 `--locale=zh-cn` 启动真实 VS Code Extension Development Host；简体中文场景使用本地最小 language-pack fixture，不依赖网络安装。smoke 会打开 notifier sidebar，验证 manifest command/view/setting、sidebar HTML、手动测试通知、工作台提示、系统通知 action label 与 callback 提示跟随 locale。同时修复既有 `npm run test:notifier-smoke` 在 VS Code 1.117 下因 wrapper 手动激活主扩展和 notifier 触发重复 URI handler 的问题，改为两条真实 `extensionDevelopmentPath`。剩余发布前抽查只针对真实 OS 通知弹出、系统 shell action 和点击回跳平台能力，不再针对 locale 文案 smoke。
- 2026-07-06：`trusted smoke` 的 live-runtime scrollback reload 超时技术债已收口。本轮确认历史 `waitForRuntimeSupervisorState()` 超时未在稳定后的 Linux headless runner 中复现；新增 `--disable-gpu` / `--disable-dev-shm-usage` 后，最小 VS Code extension test、定向 `verifyLiveRuntimeReloadPreservesUpdatedTerminalScrollbackHistory()` 和完整 `DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=trusted npm run test:smoke` 均通过。过程中发现的 `CodeWindow: detected unresponsive` 可由最小 extension test 复现，判定为 VS Code/Electron/Xvfb 启动层问题，并由同一 runner 参数缓解；完整 smoke 另一次失败来自 editor tab-switch 终端提示符换行差异，已把断言收窄到本用例真正关心的 marker viewport 行。该收口不扩大到非 Linux headless / Remote SSH 长断开等独立验证缺口。

## 技术债列表

2026-10-08 packaged smoke 修后复验：原 `verifyCreateNodeCommandQuickPick` 的启动事件超时已消除，完整用例继续到 `extension-tests.cjs:2669` 的 reset 空画布断言后失败。Host 先返回 `Local final snapshot persistence is pending`，随后同一 Agent 的 `execution/localFinalPersistence` 记录 `submitted=true, result.kind=saved`，但 reset 没有完成。另有 `Owned terminal mutation admission is closed` 消息，尚未确认其与 reset 的因果关系。原测试从运行中 Agent 直接 reset，不能通过强制开放准入、吞掉保存错误或延长轮询追认为通过。需单独核对 reset 的执行结算与最终保存完成时序，补齐回归并重新完成 clean-checkout packaged smoke；在此之前总体门禁仍未通过。证据：`.debug/packaged-smoke-reload/vsix-smoke.log`、`.debug/packaged-smoke-reload/artifacts/`；关联 `CanvasPanelManager.closeNonNativeHostExecutions`、`assertNonNativeHostPersistenceComplete`、`docs/exec-plans/completed/packaged-smoke-reload-lifecycle.md`。本轮不将该后续失败归类为已确认的测试问题。

2026-10-08 reset 定位完成（未修订原 smoke）：原 VSIX 栈与新增 6 项受控 Host 测试确认，`owner.close()` 不等待 Host 最终保存；reset 在保存 pending 时依照生产接入 §26.3 已报错中止。原文件写入诊断到同一 Agent 的 saved 诊断约 22ms，晚到保存只释放 record，不续跑原 reset；不能由此推断磁盘故障或死锁。保存成功后显式再次 reset 可清空并恢复准入，保存 failed 时再次操作仍保留节点。另一准入错误已映射到原 bundle 的排队 resize guard，有/无 resize 对照均复现 pending，故它不是本次拒绝的必要原因。产品承担既定的中止/再次操作语义，夹具假定单次派发后必然清空，两者存在契约差异；不把这一结论泛化为产品体验已闭环。下一步须沿已选契约显式验证拒绝、保存与再次 reset，或先设计产品单次操作的有限等待，再补原 packaged / clean-checkout 验证；不得吞错、盲目重试或延长轮询。本轮定位证据与边界见 `docs/design-docs/canvas-reset-final-persistence.md`、`docs/exec-plans/completed/canvas-reset-final-persistence-investigation.md`，原总体门禁仍未通过。

2026-10-08 reset 夹具修复（PR #305）：QuickPick 清理按已有产品契约显式处理一次 pending，保留本用例全程诊断，待原两执行 saved/not-required 后最多再发一次 reset；失败/未知、错误或冲突身份与超时不放行，全程仍 20 秒。完整复验又发现前置 shell 切换用例的同类 reset，已接入同一 helper；对重启节点排除第一次 reset 前已经结算的旧身份，防止旧 saved 冒充当前保存。19 项纯测、脚本语法与 diff 检查通过；最终真实 VSIX 已记录 QuickPick pending → 原 Claude not-required/Codex saved → 第二次 reset 空画布，原 reset 夹具阻塞收口，生产/resize 未改。计划见 `docs/exec-plans/completed/packaged-smoke-reset-fixture.md`。

新的后续待定位项：完整 packaged smoke 的第一次和最终复验均停在 `verifyWorkspaceRelativeTerminalShellPathUsesWorkspaceRoot()` 的 execution/started 诊断等待（最终 `extension-tests.cjs:2768`），exit 1。现场有该相对 shell Terminal 的 startRequested、EOF、localFinalPersistence saved，但缺少用例要求的 started 事件；该历史现场当时未归因；2026-10-09 已确认 owned local 缺 started 诊断，shell/cwd 实际执行正确，见本文四项定位记录；不在 reset 修复中放宽断言。完整 packaged / clean-checkout 门禁仍未通过。日志与工件：`.debug/reset-final-persistence/vsix-fixture-first.log`、`fixture-first-artifacts/`、`vsix-fixture-verified.log`、`fixture-verified-artifacts/`；第二次前置 reset 首败独立保留于 `vsix-fixture-final.log`、`fixture-second-artifacts/`。

2026-10-08 测试过期问题修复（PR #296 的两项后续）：Marketplace fixture E2E 显式使用 `--locale=en` 并在宿主断言 `vscode.env.language`，统一安装、更新、回滚、举报、计数和发布成功文案；`npm run test:marketplace-vscode-e2e` 在 Node 22.23.3 / VS Code 1.118.1 真实宿主完整通过。Webview 先复现旧图 8020 pixels 差异，确认公共 fixture 的 `--timeout 300 --verbose` 触发当前默认参数校验错误，改用合法 `--model gpt-5` 并同步自定义启动用例，再生成 Linux 画布基准。截图复核确认 Agent 显示正常命令、Terminal 显示已有 cwd 行，并增加命令副标题断言，防止更新截图时接受错误状态；不放宽比较阈值。全套还暴露帮助提示中 Canvas → 画布、右键菜单新增 `clear-canvas`、启动模式归一化 fixture 混入已禁止的 Resume 目标参数等过期测试，均已按当前实现及 `docs/design-docs/agent-launch-modes-and-restart.md` 同步；产品代码未改。

验证边界：本轮 `npm run test:webview` 完整执行 382 项，首次为 376 passed / 6 failed（12.2 分钟），没有中止或跳过。上述四项过期断言修复后的 12 项定向回归全部通过（画布基准、明暗 minimap、共享/内联帮助、自定义启动与 IME、右键菜单、启动模式归一化）；`npm run test:agent-launch-presets` 与 `git diff --check` 通过。构建使用现有六目标原生资产集并通过默认构建的源码/hash 校验；宿主测试通过 `DEV_SESSION_CANVAS_TEMPLATE_MARKETPLACE_VSCODE_E2E_DEBUG_ROOT` / `DEV_SESSION_CANVAS_TEMPLATE_MARKETPLACE_VSCODE_E2E_HOST_TMP_ROOT` 设置独立短路径，避开已知 Unix socket 深路径限制。留存日志及原始截图差异位于本地忽略目录 `.debug/test-baseline-refresh/`。这不是完整 Webview 全绿结论；Windows 基准未在 Linux 上伪造，仍需原生 Windows 环境重新生成并验证。notifier companion 与 packaged smoke 两项未在本轮处理，保留原待查状态。

本轮另登记 Webview 折行路径识别缺口：`tests/playwright/webview-harness.spec.mjs` 中 Agent / Terminal 的 `styled hard-wrapped code paths keep line and column suffixes` 均无法识别 `src/webview/executionTerminalNativeInteractions.ts:1600:12`。从 `origin/main` 的 `357266ad` 导出未经修改的原版 spec，在同一未改产品 bundle 上定向复验仍为 2 failed，确认本次 fixture/截图更新未引入该失败；2026-10-09 已以父/子提交与实际 buffer 确认恢复后 fit 暴露混合折行不被识别，见本文四项定位记录。保留原断言和失败证据，不削弱行列号验证，应在下一轮终端链接修复及下一版本完整门禁前定位并通过。该缺口与已解决的 Linux 截图差异分别追踪。

2026-10-08 notifier companion 后续收口：PR #296 的 posted diagnostic 超时已确认是主扩展 owned snapshot-only 输出漏接 attention bridge 的产品缺陷。原输出包含 OSC 9 而 attention=false、companion 无请求，直接调用 companion 成功；去掉测试重复启动后占位异常消失而超时仍复现。本次为 Agent / Terminal 复用原 bridge，并仅对同 metadata 绑定的提醒/确认推进 owned 最终保存引用，保留外部替换与旧执行隔离。新增 7 项回归先红后绿，完整 Host 接线 261/261、attention parser、终端分页回归、typecheck 通过；默认六目标资产双扩展构建及 VS Code 1.126.0 真实 companion smoke 通过，覆盖通知、单次 callback、居中保留提醒、用户确认后继续输出与停止。smoke 去掉重复启动，并从实际输出消息核对 fake agent 文本，不再等待 owned live metadata 不提供的 recentOutput。关闭此项通知联动缺口；不把原发布失败追认为通过，也不代证其他延后门禁、真实 OS 通知或其他平台。依据见 `docs/design-docs/notifier-companion-architecture.md` 第 9 节；本地证据 `/tmp/dsc-notifier-fix-before.log`、`/tmp/dsc-notifier-fix-host-tests.log`、`/tmp/dsc-notifier-fix-smoke-final.log`。

2026-10-08 当前结论覆盖下列 2026-10-07 的“发布阻塞”分类：用户明确授权 0.26.0 先发布、四项测试问题后修。用户已确认 Webview 差异来自基准图；Marketplace locale 矛盾有代码与 probe 证据，notifier posted diagnostic 与 packaged smoke 超时根因仍未确认，不能据“大概率测试问题”宣布产品缺陷已排除。四项仅对 0.26.0 降为接受的发布风险，失败和未执行项仍保持原状态。临时处理是该版 release:verify 的精确版本例外：保留静态、类型、定向回归、构建、同源原生资产与隔离打包，延后完整 npm test/宿主/Webview/packaged smoke。建议在下一发布准备前修复 locale 契约、按确认结果更新视觉基准、分别查明两处超时并重跑完整门禁；0.26.1 不继承例外。关联 PR #296、`docs/release-contracts/v0.26.0.md`、`scripts/release/release-preflight.mjs`、`docs/exec-plans/active/release-0-26-0-prep.md`。其余 audit 与运行时维护债务不受此授权影响。

2026-10-07，同次 0.26.0 验证另有两项阻塞：完整 Webview 首项 `canvas-shell-baseline` 稳定差异 8020 pixels，差异集中于 Agent/Terminal 标签及控制区；未更新期望图，主动中止后的其余测试不算通过。独立 clean-checkout 虽完成 npm ci 和 140-file VSIX 打包，packaged smoke 在 `verifyCreateNodeCommandQuickPick`（`extension-tests.cjs:2619`）等待诊断事件超时，尚未确认根因。发布前需分别复核视觉基准与创建节点实际链路，并重跑完整验证；Markdown 定向渲染、notifier locale 和包结构通过不能代证。追踪入口：`docs/exec-plans/active/release-0-26-0-prep.md`、草稿 PR #296。

2026-10-07，0.26.0 发布验证阻塞（不能据此合并发布准备 PR）：`release:verify` 在 Node 22.23.3 短路径 checkout 的 Marketplace VS Code E2E 失败。实际 list probe 已显示两条模板和英文 Install / Switch install version，`tests/vscode-smoke/template-marketplace-tests.cjs:48` 仍等待中文按钮；需修正测试 locale/文案契约并完整复验，不降低交互断言。原深路径首跑另有 Unix socket listen EINVAL，可用短路径避开，不能混作同一失败。独立 `test:notifier-smoke` 在 `notifier-companion-tests.cjs:103` 等待 companion posted diagnostic 超时，前序出现 `Local final snapshot responsibility still occupies the execution key or Host capacity`；因果尚未确认，需排查测试启动时序与生产 runtime 责任，不能直接判定为无害 fixture。影响发布完整验证与 companion 联动验收，应在发布前解决；locale/source/打包通过不替代该联动路径。证据入口为 `docs/exec-plans/active/release-0-26-0-prep.md`。

2026-10-07 发布审计：`npm audit --omit=dev` 发现公开 KaTeX 公告 `GHSA-238p-pmpm-9mq7`，覆盖当前 `katex@0.16.45` 及 `micromark-extension-math` 依赖链，合计 2 low，npm 当前报告无修复版本。公告以“已经存在原型污染”为前提；`noteMarkdownPreview.ts` 显式传入 `trust: false`，本轮没有证明项目中存在前置污染路径，也不据此宣布完全不可利用。暂保留当前依赖与渲染配置，作为待验证安全风险；上游提供修复或发现前置污染路径时优先处理并重跑 Note 渲染回归。关联 `docs/exec-plans/active/release-0-26-0-prep.md`、主扩展 manifest/lockfile。独立的 markdown-it `GHSA-253c-mchw-3w2r`（linkify 长文本阻塞）本轮升级至 14.3.2；不把 KaTeX 遗留项写成零漏洞。

同日全依赖 audit 为 19 项（2 low / 3 moderate / 14 high）；生产依赖只有上述 2 low，其余位于 @vscode/vsce、Tailwind、Wrangler 等开发/构建链。npm 的部分建议涉及主版本迁移，需独立工具链升级并复核构建、市场服务开发测试与 VSIX，不能直接 `audit fix --force` 混入版本物料。当前不声明全依赖零漏洞，也没有本轮实际利用证据；应在后续工具链维护中优先评估适用条件和可兼容补丁。

2026-10-07 当前范围优先于下列历史结账：B1容量/准入、B2退出完整性、B3生命周期成果保留，B4权威当前态恢复及最终同包受影响验收已完成，计划归档至 `docs/exec-plans/completed/runtime-live-state-recovery.md`。剩余仅合并许可与下表具名维护风险，不自动追加产品阶段。旧sandbox拒绝及未归因间歇失败不追认通过；root稳定归属另列，不混入当前收口。

当前状态 codec 依赖固定 `@xterm/headless` / `@xterm/xterm` 6.0.0 私有模型字段，是明确的维护边界：任何 xterm 升级或生产 parser handler 变化，必须重新核对两端状态格式、未来增量与浏览器服务并补受影响回归，不得只改版本字符串。当前使用 `xterm-current-state-v1`，不承诺任意 addon/异步 paused parser 的状态迁移；不能因已登记此风险而免除 B4 的产品验收。

2026-10-02 当前结账（覆盖以下所有旧“当前/下一步”，历史证据不改）：F-04当前支持路径及F-05无历史路径已完成，退出完整性的有限B2/B3实施与必要验收已结账。最终63847969/run36979378644正常默认包三平台两模式installed及六真实Agent snapshot-stop独立通过，复用未改的十二Runtime Agent/natural、多会话/重连/compact、六native与Remote证据。SGR22已确认产品缺陷修复，Windows24个实际非空prefix无差异/unknown，三平台Claude非空1947B重开通过；旧756B精确因果未确认，作为下表非阻塞风险保留，不追认通过、不自动抓取重跑。普通文档/最新head审查及PR后等待合并许可。root归属、旧OS和通用诊断增强不作前置，原64/128及历史失败保持。

以下日期段为历史实施账，不把当时“待验/阻塞/下一步”全文复制为当前待办；当前未解决风险以下表的触发条件为准。

2026-10-02 最终review增量（覆盖下列旧状态）：Supervisor owner退休但session仍等存储清理的漏计已按容量§10.17修正，99项原wiring/typecheck/protocol通过，尚待新包受影响Runtime链。旧92b3aa4包三平台installed均独立通过，Linux四Claude36969789786、macOS两Claude36970044255补齐各自未跑格；Windows36969509496第四Codex stop旧判据仍失败、后四未跑。六native不变，按§53只重建产品并复验受影响格。

2026-10-02 已确认serializer产品阻塞：headless6.0.0/serialize0.14.0的dim/bold转换存在SGR22共享reset样式损失；唯一真实Windows Codex分类run36976601577又确认seq14的12个有字符cell Bold不保真（586B→580B、空cell0、其余类别相同），不能再只记为假设或忽略Bold放行。按生产接入§53直接做固定源码SGR22联动补丁与原实际页面保存/重开及受影响包验收，不扩全部ANSI/终端库。旧756B终态具体控制序列仍未知，不能倒填相同根因；无损低索引palette编码变化及旧raw/hash结果继续保持。

2026-10-02 当前有限收尾以生产接入§53为准：local实际消费信用、生产准入、candidate冷启动、慢restore/paged-events的fit及viewport、Host单任务/latest resize已有定向通过，缺Host-credit的新建门禁已修复。92b3aa4a/run36966903790六native与普通package全部通过，Linux/macOS installed各四phase通过；Linux Agent前三过、第四完整快照比较false、后四未跑，macOS前六过、第七观察unknown/cleanup failure1、第八未跑。Windows官方versioned CLI布局与driver flat假设冲突，尚未进入产品。仅修入口及固定安全摘要，按同包失败/未跑格复验；不推断已证丢尾，不追认绿色，F-04最终证据仍未齐备。run36965693411的Windows跨宿主权限首败和全部历史失败保留，不变成新队列。旧预算、旧OS与通用工具不作前置。

2026-10-02 有限UI残余：上述Linux/macOS installed自然退出的finalProbe包含 `Runtime session … is not live` 及内部栈toast。完整90002行、最终光标(6,2)、EOF/applied和清理通过；事件环缺对应RPC时间，不能确认具体触发源或本次回归。`CanvasPanelManager.ts`候选Runtime resize catch使用formatUnknownError，退出与迟到viewport resize竞态是可解释路径，但未证明本次因果。本轮不扩大为尾部阻塞或追加矩阵；后续在可复现同类通知时核对session身份/终态并收敛错误呈现，不吞没真正live控制失败。关联生产接入§53、`tests/vscode-smoke/execution-candidate-tests.cjs`与`src/supervisor/runtimeSupervisorMain.ts`的requireLiveSession。

2026-10-02 同包复核边界：Linux36969390582的Codex snapshot stop为空态seq11，原严格比较及新Host重开通过，不能解释36966903790的806-byte/seq12非空比较失败；该间歇结果保留，后续如再次取得具名非空差异则用现有等值/长度字段定位，不为捕获追加循环。macOS原报告三个角色unknown计数受Darwin psutil字符串误用Linux状态集合影响，已只修摘要映射并回归，不能据旧计数认定三个身份失败；原observer一条process-observation-unknown及cleanup failure1仍未解释，不追认原场景通过。

2026-10-02 当前 A2/A3/A4 补充：`1d784d8b` / Linux `36935000098` 原八场通过，四natural实际响应/EOF、Claude1262-byte/seq5非空stop的首页面独立重排/schema2新Host和八场零cleanup成立。Linux旧 `36917661214`/`36918349766` 首场超时根因未定，不能用cleanup后状态倒推失败前CLI已退出，也不由本轮成功追认修复。当前剩余为原慢写/最终fit/保存viewport应用、其他平台新判据、F-04和最终准入，不重跑固定Linux格、不扩诊断工具；`main.tsx` snapshot通知早于write、fit无回调屏障及未显式恢复viewport仅为只读实现差异，未证明本次或历史失败因果。

2026-10-02 现代 runner 生产验收的具名矩阵已补齐：固定六资产 run `36906440380`（Ubuntu 24.04 x64/arm64、macOS 15 x64/arm64、Windows Server 2025 x64、Windows 11 ARM64）、macOS Product Provider `36906440973` 与 Windows Product Provider `36907160402` 均成功；Windows 真实 Agent `36906573764` 的 Codex `0.157.1`、Claude `2.1.280`、DeepSeek 八场全部通过，四个 natural 场景有实际响应/EOF，cleanup bindings/failures/forced/active 全为零。上述只关闭具名现代组合，不关闭 F-04/A1、全部 A5、默认准入或旧系统兼容；Node.js 20 弃用 annotation 与 macOS `ENTRYNOTSUPPORTED` artifact warning 保留且不阻塞。

2026-10-02 macOS 真实 Agent 的两次具名 run 仍未决。`36906574728` 的 Codex 四场及 Claude live natural/stop 通过，但 `claude-snapshot-only-natural` 在 `tests/vscode-smoke/agent-candidate-tests.cjs:50` bounded poll 超时；唯一同输入重跑 `36909378525` 的 Codex 四场通过，但 `claude-live-runtime-natural` 在 `agent-candidate-tests.cjs:153` 未及时取得 execution identity，后续 Claude 场景未运行。静态核对确认第二次位置是 harness 在 xterm probe 后只读取一次 Host 消息的异步竞态，现已改为在原 30 秒窗口轮询带 identity 的 snapshot，未放宽产品断言；首轮 line 50 尺寸超时仍独立未决。两次前置认证/构建/runner 均通过、`failureClasses=[]`，没有凭据、native resource 或 cleanup failure；不把 harness 修正称为业务修复，也不无限重跑。既有成功 `36858502983` 与所有历史失败继续保留。

2026-10-02 该未决项已按窄修回收：`56cec10c` 的 identity bounded poll 在现代 macOS runner run `36911430020` 上使 Codex/Claude 八场全部通过，四个 natural 场景均观察到实际响应/EOF，cleanup bindings/failures/forced/active 全为零。旧失败仍保留为历史证据；非空 snapshot-only stop 按规则不要求重开，页面 projection independence/A2/A3 非空 stop 等价继续单列，不将 harness 通过写成业务或 F-04 收口。

2026-10-01继续更新：A3夹具首跑因独立Host使用不同workspace-storage失败，修正为owner已flush扩展存储快照复制到B对应slot后，`.debug/a3-reader-isolation-20261001-fixed/` live双Host与snapshot-only两例完整通过；跨Host同execution/B原readId、90000行尾部/EOF/applied、无历史和cleanup均通过，首败仍保留。Windows36843457341的storage containment误拒绝已以realpath+平台relative严格子路径窄修并完成纯测，新的Windows原矩阵仍待workflow回收。A6真实reload首轮及macOS新target产品Terminal/Webview/reopen已各自取得有限通过；A4严格空态Agent重开、六资产/Remote/默认准入与F-04仍开放。

2026-10-01当前回收：`36846756417` 的Windows真实Codex四场（含严格空snapshot及新Host重开）通过；Claude首场natural在认证成功后stopped/EOF/applied但无outputSequence，触发timeout/response，后续三场未运行，作为真实Agent生命周期阻塞保留。`36846733819` Windows产品Provider在Electron启动阶段失败且未形成可核对报告，不能归因storage helper；`36846734096` macOS产品Provider成功但不代证Agent。A3 receipt边界与目标冲突纯测已通过7组，但晚于`8515ea25`固定输入，旧A3证据不回填为当前树provenance。下一先定位Windows产品启动第一现场，再触发macOS Agent矩阵；不新增通用诊断门槛。

2026-10-01 macOS Agent回收：`36849214028` 在 `85f08d8e` 上首场Codex live natural完整通过，第二场Codex live stop于 `agent-candidate-tests.cjs:137` 的 `lastRuntimeError` 启动检查失败，认证/构建成功且后六场未运行。此前 `36832581851`、`36836757674` 也在后续Codex场景失败但位置不同，当前只记录为macOS候选场景间启动/收尾稳定性阻塞；下一仅允许一次同输入重跑区分波动与确定性，不追认首场通过为平台通过。

2026-10-01后续回收取代上述当前队列：唯一重跑 `36850339021` 的macOS真实Agent原八场全部通过，cleanup全零及Codex空snapshot新Host重开通过；旧失败保持、根因未知，不追加抓红矩阵。Windows `36846733819` 实际页面完整90000行/尾部/最终光标与Supervisor closed/EOF已确认，但Host仍live，初步宿主启动分类改为最终状态传播/消费阻塞。生产接入第42节独立复现并窄修queued turn背压丢drain唤醒，原生因果仍待复验。Windows Claude `naturalResponseVerified=true/cliObserved=false` 按启动链观察缺口定位，completed缺sequence不是丢输出的独立证据。F-04、A5/Remote/默认准入与既定验收继续开放。

2026-10-01第45节：c851d028原Windows产品36852373473步骤成功、大工件下载超时，尚未独立逐字段复核；Agent36852378637首场通过、第二stop原句柄观察unknown，后六项未跑，不能称Claude修正原生通过。原driver未等CLI取得即停止的时序先红后绿，绝对45秒拒绝迟到ready；安全摘要纠正no-signal action计为forced的歧义，旧报告保持。第44节Remote自主接线中。A5 ABI/OS/libc兼容、Linux arm64/namespace、六资产聚合、默认执行端选择/package与生产admission仍开放，不能泛化为只待验收。

第45节后续事实取代上一段待回收状态：Windows36854266396 attempt2原八场真实Agent全部通过，四natural响应/EOF、完整原生CLI链、八cleanup均独立核对；attempt1原10秒前置超时及所有旧失败不追认。产品36852373473六份Terminal结果/四环境小报告已范围提取对账，90000行/最终光标/EOF/applied和两模式completed重开成立，整包下载124保留；这两个固定组合不再排队。第44节Remote取得真实Server Node22.22.1/ABI127并安装固定Node包，首次产品Runtime在原30秒buffer检查失败、后3阶段未运行，保留为具名验收首败，先定位不重试。A5分发兼容与默认准入、F-04及其余A项继续开放，不新增通用工具债务。

第44节修后Remote同一冻结VSIX已原四阶段exit0：等待原reader applied后只发一次原全文检查，原30秒绝对截止和全部断言保持；旧观察器累计243.8MB期望正文不再干扰6MB产品分页，首败与后通过分别保留，不夸大为旧失败唯一根因。真实Node/安装hash/EOF/applied/两模式重开及清理已核对，Linux x64 loopback子项收口。第37节Windows namespace误限已修、Linux/Darwin原规则不变；新helper在8ae426c9的macOS产品36858038984与真实Agent36858502983原流程已按第46节独立回收通过，仍不代证x64/旧macOS。Claude非空snapshot stop未执行重开，诊断saved/published/replay与页面比较false不冒称已独立相等，留在原A2/A3内有限核对；不由summary pass关闭这一责任。当前仅按有限收尾第8节五包结账，不扩工具门槛或重复已完成回归。

2026-10-01最新有限增量：第39节真实Linux Runtime Reload Window首轮exit0、同UI/新Host/原执行/新reader、completed空重开与清理均独立核对，固定子项不再排队；snapshot-only reload、多根、其余A1至A6不代证。Windows36843457341越过无凭据前置后首败storage路径断言，后七场未跑，保留清理观察未知，先核对路径语义。macOS36841263618已证明连续空终态与独立resize后页面一致，严格空态判据及真实重开待新证据；A5新target产品报告待回收，六资产/兼容/Remote和默认准入仍开放。当前队列以有限收尾及active计划首段为准，以下dated记录均保留原时点含义。

2026-10-01 B2/A5与B3/A6：macOS Terminal36829311235六报告核对通过，真实Agent36832581851前三Codex场passed、第四snapshot stop空快照真值断言首败、Claude未跑，33.10所需终态证据已接入，定向回归与独立复核通过，原断言不改，待一次原矩阵。Windows36830583121绿灯缺报告已确认CLI转交误判，34.12窄修后36834158313真实exit1，原小报告确认mounted早于reader身份返回；共享原30秒poll已先红后绿，待原流水线，Agent未调度。32.21新增永久退出后旧reset写入缺陷已先红后修，原46+真实start2+普通/owner重叠2共50项、Host145/typecheck/localization及独立复核通过，不代证真实reload/多根UI。第35节固定VSIX实际安装接线开始，不把原payload smoke算installed通过。所有旧失败保留；剩余F-04/A1至A6、六资产/运行时、Remote与默认准入按有限清单，不另增通用工具债务。

同日更新：33.10固定一次macOS36836757674仍第四场原断言失败，新saved/reader证据明确但独立回放与页面几何未判定，不盲重跑。第35节Linux fixed VSIX installed首次四次Host/六结果通过，包SHA604494fd、实际安装路径和八文件hash已核对，该子项不重复排队；第36节只补A1/A2实际文件系统失败组合，原高层替身不误算同链验证。其余责任仍依有限收尾清单。

同日增量：Windows36836728391原两模式Terminal六报告/四environment独立核对通过，首次Agent36838248572停在无凭据私有配置测试，后续CLI/构建/secret/Agent未跑，不能称Agent产品失败。第36节两类真实模块写失败组合已通过Supervisor94/Host147、root复跑及只读审查，无业务改动，不冒称OS实际满盘或UI验收。上述已收口子项不重排，剩余具体失败和原有限责任继续。

2026-09-30 当前 Runtime 重构收尾入口：`docs/design-docs/runtime-persistence-closeout.md`。合并测试进程的 Heap 64 MiB / RSS 128 MiB 重列为初始观察预算，不是独立 Supervisor/每会话产品预算；原阈值、结果和 exit 1 保持，不追认通过。暂停仅为压线的优化和自动前置 profiler，当前推进 B2 正式启动接入，真实分进程、多会话资源与交互评估并入 A1，并据资源模型论证正式预算。已证无界积压、重复物化、取消等待累积等结构问题不因口径调整失效。F-04 仍开放，F-05 不重开归档，F-03 另列 R1；B3、真实 Agent/Webview/跨平台、尾部与最终 A1 至 A6 不削减，不等待用户选择工程预算。下列 dated 记录、旧 L/PI 分类及“下一步”保留为历史，不自动执行；尤其旧 profiler 下一步不再作为 B2 前置。

B2 已完成 typed profile/generation、安全首次启动和构建期固定候选的实际 extension 注入；Linux Electron 39.8.7 匹配资产已经用于真实 VS Code/Webview/PTY，普通构建仍 stock。退出提示覆写修后，Runtime/editor 的 90002 条前缀行、终态光标和真实重开有有限通过证据；snapshot-only live 投影与大快照读取丢弃也已修，32.10 的 `.debug/execution-candidate-a2-a3-20260930-snapshot-normalization-fixed` 单选 complete/reopen exit 0，90002 行、工件光标 `(6,2)`、5580063 字符快照、applied 1396 及清理通过。原整轮、夹具字段和重开失败 exit 1 均保留，当前通过不等于 OS 全程无新进程追踪或全部两模式验收。Host 110/110、tracker、journal、checkpoint、typecheck 及补候选退出翻译后的 localization 通过；B3 completed 发布、完整 root template reset 和 reset 在途责任三项先红已修，生命周期 38 次回归通过。其余 A6、A1 分进程多会话预算、真实 Agent 与跨平台/分发仍开放；不扩通用诊断或 R1 归属迁移，也不重复登记已完成启动接线。

当前 A4 保留三轮失败：首轮认证失败经 auth-only 定位为 Node 12，第二轮 `node-runtime-fixed` 认证通过但 custom env 前缀被实际校验拒绝，两轮零模型请求；第三轮 `command-path-fixed` 使用真实原 CLI 与既有测试 PATH 优先机制，通过认证/命令校验且创建首个 Codex 节点，但 live 身份等待超时、候选启动报 superseded，未出现 CLI/provider/输出、未提交执行，后七场景未跑。具体根因待定位，节点存在不证明模型请求；后续结果须分 plannedModelTurns、cliObserved、naturalResponseVerified，实际 modelRequestCount 标记未直接观测，原错误计数与失败工件不改。不使用 fake、不绕过 secret filter、不复制凭据。当前 A1/B2 还须处理 `ExecutionAuthority` 与 owner 的共享两槽/启动并发一候选限制，尚未形成分进程多会话校准，不能将两槽升级为产品上限或削减既定十会话验收。以上是原有限清单的未完成责任，不新建诊断阶段。

以下 2026-09-28 至 2026-09-29 的历史记录保持原时点；紧随其后的“同日”指 2026-09-28，不因当前入口更新而变为新实验或当前执行队列。

同日 B1 已实施局部修复：live checkpoint 不再构建全历史数组；owned 输出消费等待 journal 完整 flush，慢写/失败不提前返信用或伪称进程退出。32 MiB 扫描 retained heap 从 34,508,616 降至约 103,848 bytes，不能替代峰值证明；1x/2x/4x 模块校准内容正确，但额外 heap/RSS 最高 93.92/196.78 MiB，超预设 64/128 MiB。十会话浏览器输入/ACK/回显通过，仅覆盖注入 Host 的真实浏览器层。B1 保持开放：逐页重新物化整段的分配、普通 socket/Host 在途与旧 node-pty 生产链仍需收口，不把旧恢复全量扫描自动升级为前置。记录与计划见 `runtime-persistence-storage-reevaluation.md` 第 10 节及 `docs/exec-plans/completed/runtime-persistence-capacity-closeout.md`。

同日从 `4dc42c87` 继续的分页修正：cache miss 不再物化整段，改 64 KiB 读取块/当前记录/页，全部涉及段校验后才交付，先红及短读/UTF-8/页外损坏/取消回归通过。同探针原门槛一次对照 RSS 增量最高 116.92 MiB 达标，但 heap 103.72 MiB 仍失败，4x 回放 7.699 秒未超 30 秒；历史失败不改。未量化的双 tracker 序列化开销不得直接扣除或写成泄漏修复，也不作为实际传输修正的工具前置。当前 B1 待办为普通 socket/Host/旧生产者在途约束、真实消费路径内存归因及整链验收；见容量重评第 10.2 节，整体仍开放。

同日从 `d432bf89` 继续的实际传输修正：具名协商 Host 单页消费信用，以 journal 游标保留正文，line context 实际 flush 后才确认；状态合并、终态排在尾部后、preserve-reader 退役保护及旧回执隔离同步接入。旧业务真实 socket 基线在暂停 Host 时仍推送 96 条 raw 事件先红；修后 96 个 8 KiB 输出块及 resize 无损，慢 Terminal 不阻塞 Agent 或同会话 input/resize。该证据不是 PTY/实际 VS Code/平台或 RSS 验收；原 heap 失败保留。当前 B1 剩余为当前旧 node-pty 生产路径、旧协议兼容界限、Host/Webview 水位通知在途及真实多会话容量/交互整链；不将一般诊断工具强化列为前置。详见容量重评第 10.3 节与同一 active 计划。

同日从 `52ff49bc` 继续的页面通知修正：新协商 Host/Webview 水位只保留一条在途和最新待发，receipt 与正文/最终应用分账，completed 不等普通提示，重附着刷新当前水位，投递失败不伪报接收。旧 Host 在暂停接收时 1000 次更新发 1000 条先红；修后只发 1 条，回执后合并到 revision 1000，Host 定向及浏览器 8/8 通过。旧生产者仍无界，且 stock node-pty 暂停 socket 会与 Unix 200ms/当前 Windows 非 DLL 1000ms 退出关闭冲突；选定由 B1 依赖原 B2 owned 生产接入，不另造 legacy 生命周期。剩余为生产启用、旧协议/旧页面兼容边界、真实消费链 heap/多会话交互及最终 A1 至 A6；旧 heap 失败不撤销，未新增原生/真实 Agent/实际 VS Code 或平台通过。见容量重评第 10.4 节，同一 capacity 计划保持 active。

同日从 `f24a84f0` 继续的消费成本修正：owned Host/Supervisor 普通消费改为严格 parser drain，不逐批完整序列化；日志 flush、final/attach/checkpoint 保持。实际 consume 先红，Tracker、Supervisor 82/82、Host 97/97 等通过。真实 Linux Terminal/provider/PTY/socket/受控 Host 同输入唯一两次对照累计 serialize 1616→4、耗时 7590.04→39.75ms；内容/终态/自然退出/清理通过，但 current 2x/4x 仍内存失败，4x 额外 heap/RSS 99.14/167.45 MiB 高于 baseline 76.77/152.77 MiB，整轮 exit 1 保留。B1 下一直接项为同链剩余分配归因与必要修正，逐页整段重复校验只列源码事实，不能凭此宣称峰值已归因；不重跑改预算求绿或优化旧模拟探针。B2 的 extension→Host generation→Client/backend/launcher profile→首次启动链仍未接通，不能默认打开不完整资产候选。真实 Agent/VS Code/跨平台与最终 A1 至 A6 未因此关闭，见容量重评第 10.5 节。

同轮只读将下一直接修正定位到 `executionTerminalLineContextTracker.ts`：writeSegment/awaitPendingOperations 对同一只在 dispose 结束的 Promise 反复 race，消费成功不移除未决取消分支 reaction，注册量随消费次数增长。需要完成后解除自身等待且保持 dispose 唤醒/严格信用；尚未量化其对本轮峰值的贡献，不写成全部内存根因或全历史正文泄漏。该文件本轮未改，后续仍沿原 B1，不建立新工具阶段。

2026-09-29 从 `c1de9301` 已修复该取消等待结构：独立登记、finally 注销、dispose 唤醒，原严格 flush/错误/真实 callback 保持；空 flush 1!==0 先红及修后并发/销毁/迟到回调回归通过。未改容量入口和主体，唯一真实 Linux 链样本与前轮 61 份源码仅一文件不同，三档内容/终态/自然退出/清理通过；1x 内存达标，2x/4x 仍 heap/RSS 失败，4x 68.22/142.98 MiB、回放 5.473 秒，整体 exit 1 保留。该已修结构不再排队，下一 B1 是用现成分配采样定位剩余来源并据证据修正，不把单次差值量化为修复收益或继续猜热点；带 profiler 结果不替代容量验收。B2/B3、真实 Agent/Webview/平台、最终 A1 至 A6 仍开放，见容量重评第 10.6 节及原 active 计划。

2026-09-28 S16有限收口：普通completed保存失败复活已清root已在未改业务基线先红；reader/persist窗口补原投影/session身份检查和并发节点级回滚，strict路径保持。Host25次、相关回归/typecheck通过，独立review无阻塞，见生产接入31.15。剩余为完整reset/reload状态替换仲裁、首次pending等待后callback、新业务准入、完整template apply，以及原session同步释放后等待旧Runtime delete再外层发exit的reader/UI身份竞态；本轮仅验证template prepare及较早等待窗口，不承诺所有迟到UI安全。剩余项另按有限输入确认，不自动扩成下一轮矩阵，不恢复全局gate/core锁/root drain，不增工具/native门槛；真实宿主/Agent/跨平台及退出完整性总债务仍开放。

2026-09-27 S15范围收窄：正式最小交付仅普通 `prepareForDeactivation()` 的首次内部Promise与配置缓存，成功/失败都复用，不重复保存/detach/删除；基线并发flush 2!==1先红，修后Host边界13次调用、wiring95/95、checkpoint/typecheck和脚本语法检查通过，独立review无阻塞，reviewer复跑目标测试及diff检查通过。配置同步异常仍在core之前，不视为gate已经关闭。candidate/non-native与reset/reload/root/template实现不变。非永久全流程仍开放：core锁不包含后续state replacement；一次pending集合等待和client epoch不足以覆盖其后callback/operation与新业务准入；root严格delete失败保留不能换成ordinary批量best-effort，全局drain也会不当地等待其他root长操作。部分attach/snapshot跟踪只是待实证源码观察。试作的core锁、临时gate与root全局drain已撤回，不算交付或验证证据；后续须按31.14固定输入围绕原binding、定向责任和完整替换顺序验收，不关闭退出完整性总债务。

2026-09-27 S14工作树增量审阅：普通生产永久 `prepareForDeactivation()` 现需先关闭 Runtime event admission；client dispose、remote detach 和 legacy retire 前递增 client epoch，旧回调即使遇到 replacement 也被拒绝；非永久 reset/reload/template boundary 保持 gate，reconnect timer/重试受同一屏障并在 detach 清理。`allowClosedAdmission` + `requireExistingClient` 只能是 `deleteRuntimeSupervisorSessions()` 的既有 session cleanup 旁路，不能放行创建、attach、reconnect 或普通事件；candidate 非永久删除已收窄为不传该参数。已接受 callback 仅可复用仍在 map 中的原 client，原 client 已释放时保持未确认。该增量没有新的真实宿主、PTY/native、Agent 或跨平台证据，不关闭整体退出完整性债务。

2026-09-27 S12修后有限验证：测试输入54c3bc00、Runtime-only新目录唯一1/1，实际client/socket detach、同执行恢复并计算新nonce、Host自动completed保存/delete、无正文/新执行重开和正常空registry落盘通过；四资源/原transport/4 socket/1 listener释放，原始输出与来源独立复核，旧first30文件及首轮1/2不改。新增具名未确认风险是旧Host关闭报告后syncTimer仍排入1500ms延迟保存：源码路径已定位，fixture清timer使本轮无法证明迟到写盘安全，尚未实测旧状态覆盖。下一只按31.9复用实际Host受控测试定位永久边界的flush/cancel责任，不追加PTY、runner或工具框架；真实Webview非零reader、VSCode/Electron、Agent启动链、跨平台和L-02至L-05仍开放，默认关闭、旧live/root不变。以下历史原样保留。

2026-09-27 S12晚写根因已确认：Runtime持久化实际走`prepareNonNativeDeactivation`，不调用普通Host boundary已有的`flushExecutionStateSyncTimer`/`flushAllExecutionSessionStatesForHostBoundary`；`queueExecutionStateSync`到期只检查session仍在Map，`disposeManagedExecutionSession`不清syncTimer，因此关闭报告后仍可更新live metadata并排队deferred persist。AST只读检查、Host wiring 95/95及checkpoint refresh通过；completed-history现有Harness因缺`surfaceLifecycle.editor`失败，未改写或作为根因证据。当前只确认竞态与未定义关闭契约，未证明磁盘已被旧写覆盖。下一需先决定永久边界最终flush或取消timer后有序保存，不停止/删除远端live执行、不扩原生工具范围。

冻结诊断的旧Host时序没有对应的deferred persistWritten；后续immediate runtime snapshot属于第二Host恢复。因此31.9冻结样本只登记“报告后仍接受deferred请求”，不登记“已发生磁盘覆盖”。另一个独立的受控CanvasPanelManager harness 已证明该写者在第二Host完成后可以覆盖root；两类证据不合并改写。该调用链是跨平台Host逻辑，Linux只提供发生证据，其他平台仍待各自宿主/进程链验证。

2026-09-27 无native stale overwrite harness 已确认实际覆盖：真实CanvasPanelManager方法在 fake owner/client/磁盘适配下，第一Host关闭后旧timer deferred flush 排在第二Host completed immediate 写入之后，并将旧`liveSession=true`/`runtimeSessionId`/live-runtime重新写回 root。该结果是Host逻辑层确定性阻塞，未启动PTY/Supervisor/native，不能外推真实VS Code/Electron或平台执行链。技术债升级为S13身份/代次屏障：先有序保存最后live状态，再拒绝旧timer及未追踪session-state回调覆盖新completed状态；不得停止/删除远端live execution。

该harness同时暴露尺寸投影顺序：resize ACK先更新session，`lastCols/lastRows`直到live flush才进入metadata；修复不能只取消timer，必须先保存已确认的尺寸和终端状态，再封闭旧写者。

2026-09-27 S13 candidate Host 屏障已实现：`CanvasPanelManager` 在 `execution-owner-boundary-v1` 路径关闭 Runtime callback admission，按 client epoch 拒绝迟到 output/terminal/state/disconnect，等待已接受 state callback，对 Supervisor session 做最终 immediate flush，并清理 sync/output/projection timer；旧 live map/binding 保留，remote detach 不发送 stop/delete。新增 `scripts/test/test-runtime-host-deactivation-integrity.mjs` 五项通过，Host wiring 95/95、workspace typecheck 通过。范围仅覆盖显式 non-native/candidate owner；普通生产 Runtime、真实 VS Code/Electron/Webview、Agent 启动链、跨平台及未完成 operation 的 deadline 仍需后续接入和验证，故本项技术债只部分收口，不得标记为全产品退出完整性完成。

2026-09-27 S12部分验证：生产接入31节首次1/2，Node实际Host活跃deactivation、SIGHUP后自身尾部、真实快照保存/无新执行重开通过。Runtime实际client/socket/创建和首次nonce完成后，夹具缺executionPerformanceDiagnostics数组而失败；补字段及8ms阈值纯回归已完成，没有修后原生样本。两个原执行均安全释放，但Runtime是失败清理stop/EOF，不代表detach/恢复/自动completed清理/重开或正常shutdown验收。下一只复验同一Runtime场景一次、新目录/最多一个主体，不重跑本地或扩诊断门槛；默认关闭、旧live/root不变，L-02至L-05、真实UI/Electron/Agent/跨平台总债务继续开放。以下历史原样保留。

2026-09-27 S11有限原生业务验证：生产接入第30节记录Linux x64/glibc2.35/Node25.6.0唯一首次四场景五主体通过，真实正式provider/PTY、两authority交互和尾部、root/workspace快照读回、受控live重附着、暂停flush时stop及同Supervisor隔离均有证据。五个原transport关闭、四资源首报/当前released，无额外停止清理或证据截断。不关闭L-02至L-05：Host活跃退出尚未采样，Runtime无历史只验证显式delete后的拒绝，真实Host完成清理/节点重开、client/socket、Webview/Electron及真实Agent启动链仍需独立验证。三个Runtime registry仍有早期正文/状态，因fixture取消延迟persist未走正式关闭，不能称删除已落盘或重启无历史；保留证据，产品路径另验。下一S12只补实际宿主生命周期及完成节点重开/正式关闭落盘，不增加诊断框架前置；候选默认关闭、旧live/root/generation边界不变。Host首轮screen.rows字段重名只做工作树序列化窄修，原证据/哈希保留，不据此重跑原生。以下历史记录逐字保留。

2026-09-26 S10交互与产物：生产接入第29节完成默认关闭的LaunchSpec尺寸、独立有界input/resize、同token非阻塞mutation、SIGHUP/Ctrl-C停止差异及两authority业务回写；正式worker、严格匹配Linux x64/glibc/Node或Electron的工厂、compile-only构建/显式导入已提供。受控整链确认input全序阻塞resize/消费的环等，修为输入内部保序、resize独立；成功resize的退出竞态和最终resume同步亦直接修正。未知resize不等于尺寸未变，需保留原观察、关闭后续mutation并拒绝完整最终状态，而非丢弃已接收尾部。本轮纯测试/受控模块、JS build及未加载binary的编译/import均不代证实际PTY、OS资源、VS Code/Electron或真实Agent。下一只按27.6固定环境/资产/输入/安全清理开展Linux实际业务验收，不追加通用诊断工具前置。L-02至L-05、生产时限、异常owner消失、用户恢复流程、真实Agent启动链和跨平台总债务继续开放；未改默认generation、旧live、root归属或Runtime completed无进程/无历史边界。以下历史记录逐字保留。

2026-09-26 S9候选准入与原绑定责任：生产接入第28节完成默认关闭profile、完整能力拒绝、同钟固定候选预算、原连接严格删除和批量失败保留；multi-root reset共用整体边界，已提交create阻止同节点重建/删除绕过，delete期间广播的finalization与回包独立保留，截止后不首次写盘，成功无节点cleanup记录及时回收。最终owner39/39、adapter83/83、Supervisor64/64、client20/20、Host86/86，parent-control9/9、reader20/20、main/headless27/27和相关回归/typecheck通过，不据此宣称真实交互或生产验收。一次误跑旧protocol先发生两个临时Unix socket hello（第二个含checkpoint），随后旧源码regex断言失败，基线同样失败；未执行到真实Supervisor/PTY，临时socket已清理，既不能称全程零socket，也不能称该整脚本通过。下一直接按27.5有限实施实际Linux初始尺寸/input/resize、停止策略/业务回写、provider工厂及产物；native采集前固定输入、执行环境与安全清理，不追加诊断工具门槛。未知create/delete及保存失败仍保守保留，没有自动重试/强制遗忘/完整用户恢复流程；profile时长的生产有效性、实际UI/保存整链、Agent启动主体、L-02至L-05、跨平台及退出完整性总债务仍开放。旧live/root/storage/generation和Runtime completed无进程/无历史边界保持，以下阶段记录原样保留。

2026-09-26 生产接入有限设计：生产接入第27节只读收敛单一`linux-owner-v1-candidate`预算、Runtime由Supervisor而snapshot-only由Host持有owner的创建前能力分流，以及旧live原连接严格删除/聚合失败/保留绑定责任。profile数值是未实测候选，不是生产验收；本轮没有业务代码、用例运行或native证据。下一直接实施S9默认关闭、无native的配置/准入与严格错误传播，不增加通用诊断前置；实际初始尺寸和input/resize I/O、`requireLiveSession`对owned主体与legacy process的区分、停止策略/业务回写、真实provider工厂及产物分发仍缺。旧live/root/storage/generation及Runtime已结束节点不恢复进程或历史的边界保持；L-02至L-05、真实UI/Agent启动链、跨平台和退出完整性总债务继续开放。以下S8、测试债与历史记录逐字保留。

2026-09-26 S8本地最终态保存：生产接入第26节完成默认关闭、显式non-native能力下的原tracker最终态到snapshot-only metadata投影、单次真实严格保存及失败来源保留；保存责任与终端应用、reader退役独立，同key和容量继续受限，Host边界首报不因迟到写入改写。owner36/36、Host56/56，Supervisor60/60、adapter81/81、parent-control9/9、reader20/20、client13/13、main/headless27/27等定向回归及workspace typecheck通过。真实文件证据限单root与workspace写入/rename后JSON读回、原load入口及headless状态恢复，不是真实VS Code UI重开、native或跨平台验收；不将旧history整套失败计入通过。执行metadata替换时保守拒绝提交、保存失败默认不自动重试，仍不是完整生产并发编辑或恢复策略。下一有限阶段只收敛L-03生产预算来源、L-04创建前能力分流及旧live批量delete吞错、最小Linux业务接线设计，并明确当前non-native分支尚不支持实际输入/resize；不追加诊断工具或gate矩阵，不立即开启native。Runtime已结束节点不恢复进程或历史、旧live/root/storage/generation保持；L-02总体、L-03/04生产准入、L-05异常owner消失、真实UI/Agent启动链和跨平台及总债务仍开放。以下保留测试债与历史阶段记录。

2026-09-26 旧Runtime无历史回归fixture缺口：`scripts/test/test-runtime-completed-history.mjs`在`c5a0487f`基线及S8工作树均因缺少`surfaceLifecycle` fixture而以TypeError/exit1退出，属于非本轮引入的测试债，不能宣称整套通过或改旧断言获得绿色。此前Terminal/Agent保存JSON为781/812字节的前段断言通过；相关14个提取方法及3个关联文件保持，支持S8没有改动既有Runtime无历史实现，但不能替代失败后未执行场景的覆盖。后续应独立补齐该旧fixture并原样重跑断言，保留本次两侧失败证据；不因此扩大S8范围或重开completed历史归档。

2026-09-25 S7实际宿主正常关闭失败编排：生产接入第25节完成默认关闭、显式non-native gate下的固定边界期限；Host独立记录local、canvasSnapshot及remoteDetach，Supervisor先保留原执行/reader责任、严格保存再确认原server/socket关闭，未知时保持closing和保活。owner35/35、Host49/49、Supervisor60/60及adapter、parent-control、reader/client、main/headless、分页、bridge、tracker回归与workspace typecheck通过，旧断言与先败记录保留。remoteDetach成功只表示原relay关闭已发起及原client.dispose同步返回，不证明远端reader应用或OS socket释放；canvasSnapshot仅本次画布快照，不证明新路径终端最终态落盘。下一有限项只冻结并实现snapshot-only原tracker最终态到原节点metadata的提交和实际保存完成/失败保留顺序，不能追认S7并行保存为最终态，也不增加Runtime completed历史；已结束Runtime节点重开仍不恢复进程或历史。L-02总体、L-03生产profile、L-04能力分流及旧live批量delete吞错、L-05异常owner消失、真实UI/Agent启动链、跨平台和总债务仍开放；旧live/root/generation不变，不自动native/runner/push。以下为历史阶段记录。

2026-09-25 S6原父控制受限接线：生产接入第24节完成显式non-native gate下的固定资源契约、同步未派发/已移交准入和同钟TERM/KILL固定期限。owner33/33、adapter81/81、transport纯测9/9、Host41/41、Supervisor42/42及相关回归/typecheck通过，原断言、legacy父控制方法和全部旧失败保持。只关闭这项受控接线待办；有firstFault、部分创建、主体或输出移交未知不获清理权限，未证明这些异常可安全强停。失效unstarted的pendingDomains可能为空但current仍未确认且隔离保留，不将该诊断摘要当成功，也不为其扩展通用模型。下一按22.5接真实Host离开/reset/delete与Supervisor正常关闭失败编排；本地失败不能跳过独立live detach，内存unknown不能在Host消失后声称继续托管。L-03生产profile、L-02/04/05、真实UI/落盘/Agent与跨平台及总债务仍开放，不改旧live/root/generation，不自动native/runner/push。以下为历史阶段记录。

2026-09-25 S5一次性关闭观察：生产接入第23节完成显式non-native gate下的自然/主动/failure固定期限、迟到first/current和已派发且截止前真实结算的ACK缺失分账。owner26/26、adapter64、Host39/39、Supervisor40/40及相关回归/typecheck通过；未知责任继续隔离，迟到消费/flush不伪造失败或EOF，reader仍独立。仅关闭这项受控实现待办，不关闭L-03生产门槛：下一按22.4接原父控制，仍缺安全移交谓词、同一时钟固定期限追赶、在途start关闭约束及22.5真实Host/Supervisor失败编排。生产profile、L-02/04/05、真实UI/落盘/Agent与跨平台及总债务保持；不扩诊断框架，不改旧live/root/generation，不自动native/runner/push。以下为历史阶段记录。

2026-09-25 L-03有限设计：生产接入第22节只读定位自然退出缺自动预算、过期阶段命令被拒、timer迟触发改变first结果及退役后缺ACK仍可能隔离；选定有限首报/持续结算、固定期限和stop/cancel ACK与真实终态分账，均待S5实际模块验证。父控制仅能证明provider-control，主体/源未知不默认杀唯一provider；Host实际退出无法靠内存unknown继续托管，本地失败也不能跳过独立live detach。下一只实施默认关闭的non-native关闭观察，不扩诊断框架。生产时长、父控制API/安全谓词、Host/Supervisor真实失败编排和在途start关闭约束仍属native准入前缺口；legacy批量删除吞错不能被新契约继承为成功，旧live兼容另按能力分流处理。L-02/03/04/05、真实UI/落盘/Agent/平台及总债务不关闭；本轮没有业务、用例、native/runner/push变更。以下为历史阶段记录。

2026-09-25 本地最终屏障：生产接入第21节完成默认关闭、无native的实际Host/tracker到main写链及逐页面结果；Host35/35、实际main/headless27/27、远端接线20/20及相关回归/typecheck通过，包含一个实际Host到main/headless再回Host的受控整链。冻结后原reader恢复、进程未知拒发退出/保留隔离、并发ACK和在途发送取消均已补验，首轮失败分类保留。只收口本地接线切片，不关闭L-02总项或退出完整性；下一阶段只收敛L-03正常关闭失败处置与预算的接入设计/最小实现输入，L-04生产能力分流、真实UI/socket/落盘、实际Agent启动链及跨平台仍开放。普通snapshot-only语义、旧live绑定、新generation与root归属保持，不新增诊断框架或自动native/runner/push。以下为历史阶段记录。

2026-09-25 远端发送链：生产接入第20节完成默认关闭、无native的四层能力协商、原连接reader绑定、成功终值传递和真实Webview写回调屏障；Supervisor36/36、client13/13、reader接线20/20、实际main/headless13/13及相关回归通过。一个内存整链走实际Supervisor到headless投影并校验最终退役，但不是真实UI/socket/native。两项relay时序回归保留旧断言修复，首败分类见20.3。下一有限项仅本地snapshot-only最终应用屏障，仍不关闭L-02；L-03原生正常关闭失败处置/失联预算、L-04生产能力分流、真实UI/落盘/Agent/跨平台以及总债务开放。旧live/root归属/新generation不顺带调整，不追加诊断框架或runner/push。以下为历史阶段记录。

2026-09-25 逐reader接收端：生产接入第19节完成默认关闭、non-native gate下逐open登记、回包提交范围、各reader结算及128条/60秒幂等窗口，Supervisor33/33（原13项不变）、Host19/19和相关回归通过。初版checkpoint未发送可经page绕过、preserve删除拒绝已准入open及legacy回执能力缺口经复核修正；未知sessionId的首次预期失败按unconfirmed语义保留，不称业务先红后绿。下一步仅远端发送链、真实页面write屏障和跨层能力协商；接收端通过不关闭L-02。本地最终屏障、native失联处置/预算、生产能力分流、真实UI/落盘/Agent/其他平台继续开放；不新增工具门槛，无native/runner/push，不关闭总债务。

2026-09-25 S4接线补验：Host 19/19覆盖真实tracker消费/收尾及单根/多根reset入口，Supervisor 13/13修复checkpoint等待中断连/替换后重登记失效reader；有先红后绿证据，见生产接入第18节。原5/5及11/11不追认新增覆盖。reset验证的是实际Host决策和持久化调用，不是真实UI/落盘；reader最终ACK与各读者登记、native失联处置/预算、生产能力分流、其他平台仍未验收。前轮`test-runtime-supervisor-protocol.mjs`实际启动旧Supervisor/PTY，不能继续统称零PTY，分类勘误见18.2；本轮不重跑该入口。下一步仅默认关闭的远端逐reader结算接收端，不新增通用工具门槛，不关闭退出完整性总债务。

2026-09-25 S4无native接线已完成：实际`RuntimeSupervisorServer`与`CanvasPanelManager`入口接入共享`ExecutionOwnerLifecycle`，默认路径和旧live绑定不变；owner在异步准备前预留，seal尾值消费完成后才执行真实tracker最终flush，unknown、reader取消/失联和旧身份迟到回调保留。owner lifecycle 13/13、adapter 53 cases、Supervisor wiring 11/11、Host wiring 5/5，既有bridge/tracker/paged/protocol回归及workspace typecheck通过。未启动PTY/native/runner；Host宽tracker fixture的未决顶层await被移除而不追认通过。reader最终ACK、native失联处置/预算、生产能力分流和reset/clear完整UI整链继续作为未收口债务，见`docs/design-docs/runtime-exit-integrity-production-integration.md`第17节与`docs/exec-plans/completed/runtime-exit-integrity.md`。

2026-09-25 Linux接入条件收口（S4前置，历史）：生产接入第16节明确L-01正常关闭准入、L-02真实消费/reader结算、L-03原控制对象及正常关闭失败处置、L-04创建前能力分流、L-05异常owner消失风险。前三类当时只有局部实现，尤其父只能终止provider，Host退出后不能靠内存账本证明主体已结束；真实PTY业务接入不批准。随后S4允许默认关闭、无native的真实authority收尾接线及定向测试，不先扩异常矩阵；L-05按实际环境在默认启用前验证。PI-01/02/03及产品总债务保持开放，旧失败/原生证据不改，本轮仅文档。下列S3及更早阶段的下一步按历史保留。

2026-09-25 当前实施进展：生产接入第15.9节S3修后唯一采集3f8ebcae在Linux/Node22.23.2为2/2，normal live终态和flood暂停消费下停止/回收与已读内容移交通过，资源首报/当前均released、无fault。9份源码及原始输出/终态已独立核对，首次0/2的18文件逐项保持。该有限结果不关闭PI-01/02/03、两authority/reader、真实Agent、其他平台或产品退出完整性总债务；下一有限项按第15.10节定位两owner正常关闭入口和Linux外部控制能力，区分接入前必要条件与默认启用前异常失联风险，不扩全矩阵、工具或runner/push。

最新原生证据仍为第27.10节：唯一1a88d0cc/run35963751067 attempt1在macOS26.6.2 arm64/Darwin25.6.0、Node22.23.2完成U1-6三次，runner及可信本地保存复核均3/3；30项纯测、零会话build/load另记。ZIP、21runner源、16采集源及2768build成员已核。真实取得kqueue后合成EIO，未调用注册/等待kevent；abort/ack exit0及唯一wait/kqueue/master收尾取得限定证据，独立raw核查见第27.10节。其余原生/取消、真实Agent及Host/Webview/packaged未验收；业务、旧断言/失败/工件保持。

以下第26阶段及第27阶段初次冻结记录按当时时点保留，不覆盖上述当前状态。

2026-09-24 第26阶段macOS U1-0正常已注册路径取得限定证据：输入32312fe7的唯一push run35900772851 attempt1成功，10组定向纯测试与三次原生3/3分账，build/load零会话；本地增强后同8组与runner同10组复核不累加覆盖。macOS26.6.2 arm64/Darwin25.6.0、Node/headers22.23.2、SDK26.5/clang21下，真实posix_spawn/helper、kqueue/kevent及唯一waitpid成立，各写2102/读2104字节、read0、完整终态/光标和wait1792/exit7，kqueue/master各单次close0。完整ZIP与GitHub digest一致，runner与可信本地保存复核均3/3、exit0；独立raw/来源保持审计25206检查零失败，保持范围为110旧tracked、15旧证据入口和1个installed source，不宣称旧15GB全量审计。无dispatch/rerun，主树未推送，旧失败不改。下一最小项仅建议先冻结macOS U1-6实际取得kqueue后合成注册失败、唯一reaper及逐资源协议，不宣称真实注册失败；其余U1/W1、早退/ESRCH、真实Agent/产品链路与生产API/隔离策略/停止预算仍开放，退出完整性债务不关闭。
2026-09-24 第27阶段已完成macOS U1-6运行前协议冻结但未实施：当前候选注册失败分支不waitpid，roles gate等待kqueueRegistered会死锁，stock Darwin路径也不能作为修复模板。冻结native-substitute合成-1/EIO，区分registerApiEntered与registrationCallInvoked，同一Wait线程唯一waitpid后单次close kqueue；数据gate保持关闭，以token/PID绑定abort/ack有界结束，预期read/parser/raw/state均为空。三域判定分开，任何数据泄漏、owner未知、abort未确认或证据不足停止准入；没有纯测试、构建、runner或业务修改，退出完整性债务不关闭。

2026-09-24 原生第25阶段已取得真实释放与上层回执延迟分离的局部证据：复用冻结6e96a9dc和既有build，无新编译；唯一新U1-0一次/U1-5三次4/4，采集CLI与独立进程离线复核均exit0。本轮19项纯回归为新增8项加前代11项，不计作原生次数。真实close单次返回0/error0，audit在caller的100ms截止前到达但不代替被测receipt；首次observation-unknown保持，observer收到unknown后按自身时钟至少持有100ms，再许可同operation迟到receipt补证current=released，不覆写首报、不重复close。四项仍保留完整2104字节、真实EIO、终态/光标和wait1792/exit7及逐资源结算；这不是实际close失败/挂起、跨平台或产品整链验收。下一最小阶段先冻结macOS U1-0正常基线及平台创建/等待/释放差异，再按已有runner准备有限独立输入，不直接映射Linux U1；本轮不适配、不运行runner或推送、不扩通用工具门槛。真实Agent/Host/Webview/packaged、并发及生产API/隔离策略/停止预算仍开放，退出完整性债务不关闭。当前依据为runtime-native-failure-isolation第25节；以下第24阶段及更早文字、日期和失败按历史时点保留，其U1-5待办已由本阶段取得限定证据，不重判或合算。

2026-09-23 原生第24阶段已取得通知未入队时资源收尾的局部证据：新6e96a9dc候选下，唯一新U1-0一次/U1-4三次4/4，采集CLI与独立进程离线复核均exit0；61项纯回归为旧45项加本轮5项补丁、11项判定，不计作原生次数。U1-4真实wait后跳过实际Push，仅返回合成napi_closing；未入队payload由native先单次释放，再单次Release实际仍持有的TSFN acquisition，完成thread/finalizer收尾，无伪造JS退出通知。四项完整2104字节、真实EIO、终态/光标x6/y4及真实wait1792/exit7均有有限证据；不能把该注入当作真实closing、环境销毁、跨平台或产品整链通过，也不能据此在真实napi_closing后重复Release。旧第20阶段3通过/1失败/2未运行及exit13、第21/22/23阶段各自4/4和原断言均保持，不合算。下一最小项Linux U1-5先冻结真实close成功后扣留回执协议，本轮未实施，不追加工具门槛。真实Agent/Host/Webview/packaged、并发和生产API/停止预算仍开放。当前依据为runtime-native-failure-isolation第24节；以下第23阶段及此前文字按历史时点保留，其U1-4待办已由本阶段取得限定证据。

2026-09-23 原生第23阶段已取得首次合成等待失败与同一reaper真实补证的局部证据：新2a291215候选下，U1-0一次/U1-3三次唯一新切片4/4，采集CLI与独立离线入口均exit0；45项纯回归为旧28项加本轮5项补丁、12项判定，不计作原生次数。U1-3跳过一次waitpid并冻结合成-1/ECHILD的unconfirmed首报，之后同一真实线程独占取得wait1792/exit7；四项均保留完整2104字节、真实EIO、最终状态和原线程/payload/TSFN/master收尾。三个首报快照均currentWaitConfirmed=false，未实测真实ECHILD、EINTR重试或回收后的首次JS观察，不代表这些边界或生产接口已修复。旧第20阶段3通过/1失败/2未运行及exit13、第21/22阶段各自4/4和原断言均保留，不合算。下一项为Linux U1-4真实wait成功后跳过通知并返回合成napi_closing的TSFN/payload归属协议，尚未实施，不等同真实环境销毁；其他U1/W1、平台、真实Agent/Host/Webview/并发及生产API/停止预算仍开放。最新结论见runtime-native-failure-isolation第23节；以下第22阶段及此前待办按历史时点保留，其U1-3安排已由本段取得限定证据，不新增通用工具前置。

2026-09-23 原生第22阶段已取得TSFN后线程启动失败的局部资源证据：新fa6f9ab7候选下，U1-0一次/U1-2三次唯一新切片4/4，采集CLI及独立离线入口均exit0；28项纯回归通过，其中13项为本阶段新增（4项补丁、9项判定），与原生次数分开。三次U1-2在真实nonblock/TSFN后注入合成EAGAIN并跳过thread，close/control/TSFN Release/finalizer及创建者独占WNOHANG回收均成立，实际wait256/exit1；无thread/payload/notification，不伪造其释放。此项不代表真实OS线程创建失败、全部异常路径或生产接口已修复。旧第20阶段3通过/1失败/2未运行和exit13、第21阶段独立4/4及全部原断言保留，不合算。下一项为Linux U1-3一次合成ECHILD等待失败、真实唯一reaper补证的具体协议，尚未实施；其他U1/W1、macOS/Windows、真实Agent/Host/Webview/并发和生产API/停止预算仍开放，不新增工具前置。最新结论见runtime-native-failure-isolation第22节；以下第21阶段U1-2待办按历史时点保留，已由本段取得限定证据。

2026-09-23 原生第21阶段已在新v2中收口退出形式与资源准入耦合、采集入口循环导入两项直接问题：同一aff95d1e候选及冻结v1执行角色、原预算下，新U1-0一次/U1-1三次共4/4通过，采集CLI及独立离线复核均exit0；三次U1-1均为真实wait256/exit1且owner结算，场景、资源、证据分别判定。该4/4只属于新输入，旧第20阶段3通过/1失败/2未运行、原CLI exit13及原断言不改，不能写成旧CLI已修复或资源泄漏已修复。下一项为Linux U1-2：实际取得TSFN后、wait线程启动前注入线程启动失败的协议和原生验证，本轮尚未运行；不新增通用工具前置。具体child启动位置仍未确认，其余U1/W1、macOS/Windows、真实Agent/Host/Webview/并发和生产API/停止预算仍开放。最新结论见runtime-native-failure-isolation第21节；以下第20阶段待办按历史时点保留，其中退出形式/新入口已由本段收口。

2026-09-23 原生第20阶段新增局部事实与直接待办：Linux同binary U1-0三次尾部/EIO/exit7/完整状态及owner收尾通过；U1-1首次原始wait256/exit1、close0/kill0/payload/TSFN/join已结算，却被signal-only额外断言拒绝并停余2项。保留3通过/1失败/2未运行，不将判定失败当资源unknown或系统/Agent缺陷。下一版仅澄清真实终止、场景预期和资源准入，不要求kill0必为signal退出；child的login_tty/chdir/exec具体原因无errno证据，未确认。原CLI最终复核动态import自循环exit13保留，已新增独立只读verify-native-failure-v1入口重放原失败exit1，原driver/verifier/test源码身份不变；后续采集入口须避免同一循环。正式设计见runtime-native-failure-isolation第20节，主树仅文档。其余U1/W1、macOS/Windows、真实Agent/Host/Webview/并发与生产API/停止预算仍开放，不恢复通用工具前置，不补跑旧schedule、不新增runner或push。以下保留历史阶段债务。

2026-09-23 第18阶段已关闭evidence消费顺序和77/80统计这两个实测工具缺口：15/15、既有自测/保存5/5及本轮唯一Linux42/42通过，80phase/156receipt完整，100ms与G1/G2原判据不变。三个08仍详情不完整但证据充分；G2附加核对误要求held唯一的失败单列保留，按观察fact身份完成只读复核，未重跑矩阵或改正式断言。第16/17节旧失败不追认。下一步回到W1/U1实际路径，仅以所用链路的判定/安全问题为前置；不自动扩充通用工具研究。Windows/macOS D3 v3、D4实际资源、PTY与Supervisor/Host/Webview、真实Agent启动链/双会话/packaged及生产退出完整性仍开放，本轮未改业务/core/oracle/D4、无native/runner/push。

历史债务记录（第17阶段）：2026-09-23 ACK等待环已按诊断结算契约第17节因果确认并最小修复，13/13及主自测/保存5/5通过；本轮唯一Linux42项完整执行、场景控制42/42，但可信验收39/42。剩余直接阻塞是三个08的evidence consumer超过100ms；源码先同步出版准备后消费，具体各段耗时未插桩。boundedConsumerDelivery=true仅基于77个已通过phase，不能代替80个完整phase或覆盖总体false。下一步只处理实际交付顺序及聚合解释，不默认增加通用工具前置；旧失败与本轮完整314成员/7源exact证据保留，不重跑筛绿或放宽预算。W1/U1及Terminal/Agent、Host/Webview产品退出完整性仍开放，本轮无PTY/native/runner/push、业务/oracle/D4变更。以下为历史债务记录。

2026-09-22 范围纠偏：契约第16节撤销第15阶段通用工具问题的统一阻塞地位。固定D3不注册late listener，08最多4301帧，不注入800次错误；2MiB任意可达性、无限集合和任意路径/链接组合作为非阻塞增强保留。实际请求拒绝、关键因果/内容/来源、consumer原预算、未知owner准入阻断和本次实际路径归档仍是必要门槛。08预期trace截断的汇总矛盾已修，8项针对性与既有回归通过；首次真实整链180秒截断，24条结算全失败、09-1仅部分工件，完整归档未形成。当前实际阻塞是role声明完成后仍待控制退出，ACK在途读取与父端等exit才end构成候选等待环，尚待最小因果验证；180秒也不足以覆盖固定schedule各阶段388秒的总预算，下一次须事前修正外层保护但不放宽场景预算。原失败、两版源码与最终08 helper约束见第16.4节；不扩工具框架，不宣称PTY/native/产品通过，后续回到真实尾部、终端状态、资源和启动链。以下第15阶段及更早条目按历史时点理解。

2026-09-22 错误保留增量已按 `runtime-diagnostic-settlement-contract.md` 第15节完成：字段128/128/2048 UTF-8 bytes，role/stream/listener各256条/65536 JSON bytes、封前缀及来源摘要，reason插入去重，错误完整性独立认证。helper39/public29及saved29、tamper8正例/20组35变体、主回归119/41/156/15/37与saved5/5、portable46/6/17只关闭该局部诊断缺口。剩余阻塞是新策略下2MiB请求可达性、listeners注册集合/单chunk sequences边界和完整工具复审；旧43项中六个800条错误构造不适用，原断言与证据不改，不直接写成不可达。真实Windows junction/readlink/权限、大小写/Unicode、打包上传解包及原生异平台归档仍待runner。全owner/RSS、W1/U1、生产API/停止预算、实际启动链/双会话/宿主/packaged与总退出完整性均未关闭；以下条目保留历史时点。

2026-09-22 容量与归档增量的设计、实测及剩余门槛见 `docs/design-docs/runtime-diagnostic-settlement-contract.md` 第14节。本轮不调整生产实现或容量策略；listener异常name/code无字节上界、重复错误辅助数组可越过trace边界仍是独立诊断工具风险。修复前先设计有界摘要和缺证标记，保留最小公开API反例，不以43个测试目标满足推论整体内存有界。实际Windows junction/权限/文件系统语义、打包上传解包保真及真实跨OS归档仍需runner；真实D3、W1/U1和产品退出完整性仍未验收。

2026-09-22 确定性覆盖增量：D3新增156项，其中154要求完整重放，2项control reserve耗尽要求明确拒绝；独立100ms消费策略已在运行前冻结，不改原deadline。D4 local-4两次各16项、330命令/68预期拒绝/2092 checks，101语义和4 saved负例及各16/16离线复核补齐create/use unknown迟到结算。三处oracle误判和archive同拒绝类别替换漏洞已定位修正，首次source/失败保留；完整最新证据与源hash见 `docs/design-docs/runtime-diagnostic-settlement-contract.md` 第13节。旧第12节的预算未冻结和覆盖缺口只对应旧输入，不追认旧结果。

本轮最终D3各组119/41/156/15/37判据满足，原目录/同平台迁移目录及根可信重放5/5、96 members，13项重hash负例拒绝；源派生字段LF/CRLF的32组合另计，boundedConsumerDelivery=false、acceptanceReady=false。仍未关闭的具体工具门槛：2MiB input可达性/邻界、helper8帧数量、trace/control各计数与字节精确邻界、late256条独立阈值、capture gate队列容量、listener failures上限，以及Windows绝对路径/junction在跨OS整包归档中的验证。boundary聚合专用128MiB读取不放宽单会话容量。下一步先冻结这些可达性/容量和归档规则并补测；真实D3 36+2+4、三平台采集、W1/U1、原生第二批和生产集成均未启动，退出完整性总债务保持开放。以下条目按历史输入理解。

2026-09-22 新诊断本地实施与审计：D3 v3/D4 v2八个新文件只进入独立诊断树，主运行时仅同步文档；当前不运行D3真实36+2+4、不新增runner、不推送，也不关闭W1/U1或退出完整性交付。D4 local-3的self-test/full及离线各16/16、302命令/58模型拒绝/1924 checks，另有93语义、4 saved与7个独立重hash sidecar负例。unknown拼接key碰撞的初次失败保留并修为JSON tuple；sidecar/子manifest/verification已独立对账，复审无新确定性阻断。仍建议补create/use unknown经seal/end-use迟到清除的独立正例，不能把现有固定16项外推成全部模型边界或原生/真实并发证明。

同阶段D3最终本地self-test-2通过119 oracle、41 core、15文件、25 archive/consumer/binding fixtures；saved复核4/4、88 manifest members及四源原字节匹配，boundedConsumerDelivery=false、acceptanceReady=false，未运行live36+2+4、真实进程或PTY。首轮76 oracle/29 core/15文件、saved3/3保留为当时覆盖；cross-replay-1误把stdin JSON算成有换行而多计1字节，纯正常core样本被误拒，现移除oracle多算字节，core继续用stdin EOF分隔且不加换行。迟到错误回溯首报、owner/unknown/event/scenario与归档绑定已本地修正，保留首次失败。超时首报的独立消费验收预算仍未冻结，明确delivery-budget-unresolved，不改首次deadline或加宽限。最终证据与六组待逐fixture对账覆盖见 `docs/design-docs/runtime-diagnostic-settlement-contract.md` 第12节；symlink负例归档须保留link元数据。完整本地工具门槛、三平台新采集、原生第二批、实际启动链/双会话/宿主/packaged和生产API/停止预算继续开放。旧代码/workflow/工件、正常Windows对象语义及历史失败不改。

2026-09-22 下一版诊断结算设计冻结：新增 `docs/design-docs/runtime-diagnostic-settlement-contract.md`（比较中/未验证），本阶段仅固定源码/协议复审、零新测试和native。D3 v3三独立不可变首报、有界未确认owner、真实EOF捕获、严格writer协议、独立verifier与publisher，以及D4 v2全身份command/return/event/snapshot重放、acquisition/use/单次release/unknown/tombstone尚未实施。每runner36主控、2gate、4publisher和16模型只是冻结计划数，最终文档检查与静态复审已通过。下一步独立诊断树本地新入口/fixture清单/source hash和源码复审，之后唯一一次三平台采集与全工件审计；旧D3 v1/v2、D4 v1/workflow/失败不改，主运行时只同步文档。完整诊断结算与D4身份债务不因设计完成关闭，W1/U1、原生第二批、真实宿主/启动链/packaged及生产退出完整性仍阻塞。

2026-09-22 D3/D4实施与v2窄修正：独立诊断树7141cfa3的首次run35673511893及误触同SHA重复run35673550930均为failure；两次完整D3均Linux/macOS24/24、Windows23/24，D3-01-1暴露跨pipe顺序oracle误判，不是Windows或产品bug。D4每runner实际24项、两run合计144次有限模型，不能写成native或真实并发通过。重复Windows缩放自测另有after-await504.2253/543.014ms及writer554.9569/630.9223/608.3949ms超过原500ms，真实迟到与顺序问题分开；旧报告及缺失的最终self-test/tamper事实保留。D3 v2以source sequence/identity、observer真实通道/时间、4096全帧限界、ACK后bulk和唯一尾部缺口窄修，local-2 oracle78/parser8/positive24/full24及tamper24 attempted/23 verified已复核；local-1 tamper实际24/0的覆盖不足不追认。v2实现b4db41cc唯一run35676427931完整审计已收口，三平台各full24/scaled24/oracle78/parser8、tamper24/23；Windows真实跨pipe倒序仍正确接受，本次raw未超原预算不关闭writer预算核验债务，脚本/workflow/.debug仅在独立诊断树，主树只同步文档。三独立settlement、deadline不可变首次快照、有界unconfirmed、独立evidence结算、writer预算与非法帧可能被sealed掩盖、D4完整独立重放/身份仍为阻塞项；W1/U1未启动、总退出完整性债务不关闭。详见退出完整性设计第41–44节、失败隔离设计第13–17节及active计划。

2026-09-22 原生失败/资源隔离第一批设计（历史冻结记录，后续实施见本节最新条目）：新增 `docs/design-docs/runtime-native-failure-isolation.md`（比较中/未验证），按真实API受控输入、native替身、通知扣留、gate和模型分别分类；owner逐项登记，N=2/Q=1仅冻结有限准入策略，不证明共享进程阻塞/崩溃隔离。D3三平台72个零PTY进程控制、D4三平台24个零native模型先实施验收；之后才运行W1 Windows24、U1 Linux18/macOS24，共66个driver尝试，不是66次成功PTY。设计冻结时尚无新增工具或原生结果，旧D1/D2/G07与全部失败不改。其余通知/环境销毁、正缓冲取消、在途control fd、真正Close挂起、双会话、builtin/其他Windows及真实Agent/Host/Webview/packaged仍未闭合，生产API/容量/停止预算继续开放；after-await与证据封存预算需由新D3实测，旧guarded入口未移交，总退出完整性债务不关闭。详见退出完整性设计第40节及active计划。

2026-09-22 G07收口计时边界：新九项guard的调用方await后事件已补算，最大1012.3385ms、均在2000ms内；原审计1011.7495ms是resolve前的guard-returned事件。外层1112.4939ms同样仅为outer-returned事件，其后尚有同步writeJSON及resolve，九份trace没有外层await后时间。故本轮不能宣布完整外层返回预算已独立证明；下一新诊断需补调用方/结算I/O观察，不改本轮输入、工件或三个新G07正例与六负控判定。补充证据为主树.debug/stdio-close-35631266321/timing-observation-audit-v1.json，详见生命周期契约第16节。

2026-09-22 Windows G07新控制结果：cf359040/run35631266321 attempt1的9个真实child、零PTY完成原verifier与完整离线复核，独立原始审计836项检查无失败。三次close-wait以双EOF/close后fresh challenge及100.8252–101.7934ms实际持有证明主体可执行；三keep-open拒绝前提并保留deadline-exceeded/deadline-incomplete，三close-exit无pong被拒绝但raw自然完成。close-exit-3流通知先于exit通知仍无响应，不能据通知顺序补证。新样本仅补固定Windows环境的夹具前提，原72pass与旧G07三条not-established/全部失败不改，不认定正常Windows对象语义为bug。完整证据在主树.debug/stdio-close-35631266321，见退出完整性设计第39节；下一阶段原生异常及unknown owner有界隔离设计/矩阵冻结，旧guarded移交、builtin/正缓冲/并发/真实宿主与生产预算继续开放，总债务不关闭。

2026-09-22 Windows G07补证冻结：生命周期契约第14节及退出完整性设计第38节另冻Windows-only close-wait/keep-open/close-exit各3次，共9个真实child、零PTY，当前实施中、尚无本轮原生结果。新fixture用真实Win32关闭本身拥有的stdio，在父端双EOF后经独立通道响应两次fresh challenge，中间持有至少100ms；两负控必须按预定轨迹被拒绝，不以任意错误求绿。原样复用guard-v2与1000/2000、外层5000+1000ms门槛，原72条、Windows旧三条not-established及所有失败不改。首次编译/运行和完整离线复核后才评估此缺口；旧guarded移交、原生异常/正缓冲/builtin/并发、unknown有界隔离及实际宿主仍开放，总债务不关闭，主树只同步文档。

2026-09-22 D1/D2首次远端收口：d173c099/run35620967433 attempt1三平台执行、完整ZIP及原verifier复核完成，D1合计111模型通过，D2原72控制pass保留。Windows独立审计确认G07三项未建立stdio真实提前关闭前提，固定Node22.23.2的libuv对标准fd close为no-op；通知先后不能证明主体仍可执行，不是OS或产品bug。原工具/断言/绿色结果及raw失败不改，其他69条控制依据保留，不宣布D2全组或退出完整性完成。下一阶段先另冻真实关闭+独立主体存活控制，之后再推进原生异常/正缓冲/builtin/并发/unknown有界隔离及实际宿主验收。见生命周期契约第12–13节、退出完整性设计第37节和active计划，主树仅文档，总债务不关闭。

2026-09-21 D1/D2本地实施：独立诊断分支已新增模型、guard-v2、两个入口及三平台workflow。本地D1的Node25/Electron39各37项、D2新版Linux24条控制与完整离线复核通过；D1初稿Promise自证和D2首轮deadline后capture仍complete的缺口已分别收口，原工件保留，不追认新证明。新版超时保留deadline-incomplete/truncated及raw失败，旧冻结guarded入口没有追溯替换；三平台结果尚待运行。下一步完整runner矩阵及下载复核，随后才逐平台另冻原生失败、正缓冲、builtin、并发和实际宿主验收，未知owner有界隔离/生产预算继续开放。见生命周期契约第10–11节和退出完整性设计第36节，总债务不关闭。

2026-09-21 生命周期失败契约：新增 `docs/design-docs/runtime-execution-lifecycle-contract.md`，明确进程/源/authority/页面/资源分别结算，unknown迟到补证与单次Close、adapter序号与journal revision分开，opt-in close outcome须全链路保留。静态复核指出Windows CreateProcess后登记owner前可失败、TSFN env-null不进入callback RAII；Unix kqueue自然关闭不覆盖waiter错误。这些尚非新原生异常复现，旧138条及全部失败不改。生产仍缺partial-create、取消/正缓冲、TSFN/线程/Close失败、unknown有界隔离、并发及真实宿主证据，不能原样使用自然诊断fail-closed gate造成常驻资源积累。D1冻结24组37模型子案例、D2三平台72零PTY控制（54真实/18synthetic），尚未实现运行；新guard修订也另用新入口，业务与依赖不改，退出完整性债务继续开放。

2026-09-21 HPCON原生收口：d0f0be88/run35586906307 attempt1完整12 driver/138 PTY与工件复核，四个no-close resource-failure原样保留、无evidenceErrors。同一rebuilt native中retain每测量会话+2，explicit Close两轮191→191，46次Close各193→191且owner归零；138内容/真实EOF/消费者和自然退出均完整。固定bundled DLL自然路径的最终释放责任已有窄因果证据，不将Windows正常Process引用存续当bug，也不要求稳定背景差额4归零；旧具体句柄身份仍inconclusive。下一阶段转provider/adapter生命周期与失败契约设计，builtin、正长度readable-buffer、取消/异常/并发、真实Agent/Host/Webview/packaged及生产API/预算仍开放。主树仅文档，业务/安装依赖/旧实验不改，退出完整性债务不关闭。见设计第34节及active计划。

2026-09-21 诊断工具返回预算债务：独立分支diagnose-windows-hpcon-owner.mjs的guarded()在150s只发child.kill而仍等child.close，不能保证硬返回；自有driver退出但stdio被后代引用时，Linux纯Node控制复现150ms watchdog后再等待884.470223ms。Windows本轮12 driver全部自然返回/timedOut:false，不能据此补造原生超时或否定内容/owner证据。后续另建版本/入口，在只控制自有进程的前提下区分exit、stdio close和最终返回；超时/取消必须显式失败，不冒充自然EOF。旧入口与工件冻结，设计第34节记录控制证据及限制，该工具债务继续开放。

2026-09-21 HPCON 实现前复核：stock 与新增 owner API 隔离、候选共用编译产物和实际 DLL/OpenConsole.exe 输入、单次 connect、原生退出与 TSFN 完成 gate 已列入运行前要求；Release 按同包头文件的真实 HRESULT 签名记录，不将原 void 调用类型当 API 契约。新工具的静态/合成自测不替代 Windows 原生 owner/内容/资源证据，不修改历史失败或关闭退出完整性债务。

2026-09-21 HPCON owner 对照冻结：下一增量固定 `useConptyDll=true`，只比较 stock、owner-retain/no-close 与 owner-retain/explicit-close；保持原 Release 时机，Close 仅在真实 pipe EOF、consumer complete、input/worker 收尾和 shellExited 后由已知 owner 单次调用。不得复用 PtyKill、TerminateProcess、CloseHandle(HPCON) 或关闭陌生句柄；builtin、业务和生产 API/预算另验。旧 +2、普通对象 +5 与全部历史失败不改判，退出完整性债务不关闭。见设计第33节和 active 计划。

2026-09-21正常对象首轮结果：cbbba096/run35560063334 attempt1六driver/92普通child/690快照完整执行与下载复核，两个control通过、四个初始计数失败不改判，非PTY/产品验收。92个child退出后仍可查PID/time/exitCode，368次image31与正常引用存续一致；retain最终关闭23个已知句柄精确减少23。四个child driver预热后另有+5保持不变，尚无类型/创建来源，不确认为lazy初始化、OS bug或owner泄漏。HPCON最终Close契约独立存在，旧File/Process配对归属仍inconclusive；下一步另冻已知owner干预，正缓冲/异常/真实宿主/生产契约继续开放。见当前设计第32节及active计划，债务不关闭。

2026-09-21对象语义控制冻结：已退出Process被引用而存续是Windows正常语义；HPCON Release仍需最终Close是调用方独立职责，不能把旧+2直接叫OS bug。新增六driver/92普通child、零PTY的retain/close/no-child对照，先校准语义再另冻HPCON干预。image错误31、旧资源失败和具体归属inconclusive均保留；assert移除baton的副作用受NDEBUG限制，历史无条件表述不作为binary事实。见当前退出完整性设计与active计划，尚无本轮原生结果，不关闭债务。

2026-09-21资源归因结果：run35527241793首轮与5a7ed5c4/run35527528410均完整下载复核。macOS两轮各138条PTY通过最小close因果对照，原包/重编译基线kqueue6→26、候选kqueue3稳定，基线失败不改判；Windows首次新观察器命名冲突零PTY失败保留，仅重命名后46条内容/生命周期通过，但逐会话+1 PIPE类型File/+1已退出非fixture Process仍积累。NT类型查询全成功，Process映像查询2730次ERROR_GEN_FAILURE31，归属仍inconclusive，不认定OpenConsole/signal pipe已确认。下一步另冻已知HPCON owner生命周期/释放干预，正readable取消、异常路径/真实宿主和生产契约继续开放。业务/依赖及旧实验不改，退出完整性债务不关闭。见 `docs/design-docs/runtime-exit-integrity.md` 第30节和active计划。

2026-09-21资源归因协议已冻结：macOS原包/重编译基线/最小close三arm固定spawn-helper，Windows只读本进程句柄类型与Process身份取证。待执行首次原生矩阵，不把源码候选当因果结论；正长度JS readable-buffer取消控制分列下一增量。原四个资源失败、业务/依赖和所有历史实验保持不变，生产生命周期/API/预算及真实宿主验收仍开放。见退出完整性设计第29节与active计划，债务不关闭。

2026-09-20 同进程native资源实证：输入b031b598 / run35519226627 attempt1完整三平台及离线复核，24个driver/150条真实会话，全部工件有效，四个资源失败保留。Windows12项局部取消/自然对照通过，各平台46条自然会话内容/消费者/单次退出也通过；但macOS两轮每次新增一个kqueue（fd15→35、kqueue6→26），Windows DLL候选两轮每次+2 handles（197→237），无PTY控制均稳定。driver自然exit0、JS关闭、pipe EOF不能消除长驻服务资源积累，单换JS reader不足以完成退出完整性交付。Apple kqueue从源码风险升级为native积累证据，尚待隔离close干预；Windows句柄类型/身份未知，不能唯一归因于HPCON或外推builtin。九次Windows取消readableLength均0，正长度缓冲分支须另验；下一增量先冻结资源归属/回收和该控制，业务/依赖/旧实验不改，真实provider/宿主/packaged及生产政策仍开放。见 `docs/design-docs/runtime-exit-integrity.md` 第28节及active计划，退出完整性债务不关闭。

2026-09-20 原位观察与独立退出放行收口：输入697ee3f0 / run35516170917 attempt1的Linux/macOS各12项及下载复核全部通过。观察全程flags不变，取消candidate64/audit1984分账且candidate仍为interrupted；六个receipt-held控制在真实EAGAIN回调逻辑结果持有期间独立发布gate，最终状态、consumer顺序及每样本自然释放分别达标。新24项只建立这组Unix前提和局部所有权证据，不恢复旧18项非阻塞reader验收资格；本地v1两个不足原100ms持有门槛的失败也不改判。下一阶段先冻结Windows独立worker在途取消与同进程长期native资源计数，不能以单样本进程退出代替无增长证明。业务、依赖、旧实验均未修改；真实provider/Host/Webview/packaged及生产reader/API、取消政策和预算仍开放，退出完整性债务不关闭。见 `docs/design-docs/runtime-exit-integrity.md` 第27节及active计划。

2026-09-20 标志控制收口：输入951724c2 / run35511736807两平台12项均精确复现副作用，下载复核无失败或工件损坏。Linux继承master组三次仅清2048位、macOS三次仅清4位，null组各三次不变；全部自然退出/EBADF，无事后kill。原helper启动的共享O_NONBLOCK干扰已有两平台实证，旧18项及本地同helper样本仍不能作为非阻塞reader验收，原17绿/1红不改；新安静控制没有重演历史回执时序。下一增量先冻结原位readiness与独立gate推进，不静默改flags、不以fd3/dup规避、不选定生产API或预算。Windows主进程TAIL/资源反例及在途取消、长期native资源、真实provider/宿主/packaged债务不关闭；见退出完整性设计第26节。

2026-09-20 可读性握手阶段：输入931e8e22 / run35510798036全18项及离线复核完成，Ubuntu9/9、macOS8/9，总run失败。macOS control-3收齐2048却第4次read不回调、gate未打开，最终父watchdog清理。源码审计进一步发现helper启动链会清共享O_NONBLOCK，风险跨Linux/macOS，整轮及本地同helper样本暂停作为非阻塞reader验收依据，原17绿/1红不改。新增原位F_GETFL与不继承PTY对照先核实副作用；旧样本未记录flags/精确回执时序，不能冒称完整因果已native闭环。此为诊断有效性问题，不是新增业务缺陷；Windows在途取消、长驻资源、真实provider/宿主/packaged及生产选型继续开放。见退出完整性设计第25–26节及active计划。

2026-09-20 写入控制阶段：独立输入7d832d3e / run35508235734完整54项及下载复算完成，Ubuntu27/27、macOS21/27，总run失败。新v2探针的正容量暂停与失败工件完整验证已通过；macOS六个原取消仍失败，写入控制定位先等全量回执才读的夹具循环等待，不是candidate丢弃已写成功数据。下一步冻结无循环等待握手，保留2048负载、独立candidate/audit/最终receipt对账及旧失败；控制组不替代取消验收。Windows在途取消、同进程native资源增长（含Apple kqueue）、真实provider/宿主/packaged与生产API仍开放，不关闭退出完整性债务。见设计第24节及active计划。

2026-09-20 新原生阶段：独立分支 f4600844 的 run 35506150727 完整执行 84 项，总结果失败；Linux 21 项及 Windows 候选 21 项达标，真实 bridge cmd/bat 受控生命周期已有原生证据，但基线三个暂停尾部及 21 次自然资源退出仍失败。macOS 12 项通过、9 失败：3 项是新探针零容量读取冒充 EOF，6 项取消未建立 2048-byte 成功写入前提，需修诊断并做原始写入/受控放行控制组，不能视为产品缺陷或验收通过。Unix 64-byte 在途数据与 1984-byte audit 说明取消不能代替自然排空。Apple kqueue 未见 close 是待长驻计数的源码风险；Windows 在途取消、长驻资源、真实 provider/宿主/packaged 继续开放。业务及旧实验不改，完整证据/下一步见设计第 22–23 节。

2026-09-20 收尾屏障与启动链：新注入模型在 Node25/Electron39 各 25 项通过，实际 tracker/headless 四项在首次和取证加固后均通过；实际 bridge 的 POSIX 四类各三次在两运行时共 24 项达标，含故意不等待主体的六个负对照，非真实 Agent 缺陷。真实本机 Codex npm 入口源码会等待 child，不能继续以泛化后代实验推断其正常提前退出。生产取消仍缺 OS/ConPTY 缓冲尾部和资源证据；Windows `.cmd/.bat` 实际启动链、macOS 产品场景、signal/stop、真实 provider/UI/packaged 均未由本轮验收。新模型的退役布尔值不涵盖轻量终态保存、journal 或旧 RPC，不可直接接入业务。首次预检失败与取证工具加固原因均保留，具体证据/下一步见 `docs/design-docs/runtime-exit-integrity.md` 第 19–21 节；退出完整性债务不关闭。

2026-09-20 职责澄清与阻塞重评：Terminal/Agent 管理会话及终端资源，不默认在实际主进程退出后等待普通后代或接收未来输出；主进程仍运行时收到的后代输出不被忽略。macOS 普通后代六项失败及 Linux/Windows 后代反例保留为 PTY/EOF/挂断/取消诊断，不再独立阻塞产品选型或交付，也不证明真实 Agent 缺陷或 macOS 验收通过。Linux 主进程尾部、Windows 最终光标及自然 reader 资源问题仍须收口，已接收/排队/消费内容仍受保护。`cmd.exe`/启动器下实际 Agent CLI 是执行主体，需单独验证生命周期；具体收尾/取消/预算未定。当前优先级以 `docs/design-docs/runtime-exit-integrity.md` 第 18 节和 active 计划为准；旧实验/断言/失败不改，退出完整性债务未关闭。

2026-09-20 夹具修订后续（历史优先级已由上述职责澄清取代）：第二轮 run 35498732353 再完成全量 147 项，Windows 后代实际存活/TTY 断言成立后候选 18 次完整、3 次明确取消，原 worker 仍 42 次资源失败；macOS 六项后代失败继续开放。当时提出优先补 macOS leader/原始 write/EOF 后持有 master 控制组及跨平台长驻资源预算，不将第二轮成功写成整体生产修复。证据见退出完整性设计第 17 节。

2026-09-20 原生候选补充：独立诊断分支 run 35498026812 完整执行 147 项。Linux 独占 reader 18 次完整、3 次明确取消；macOS 普通场景 15 次完整，但后代两组 6 次不满足原先保留假设，需要 session leader/原始 write/EOF 后持有 master 对照。Windows builtin 三次暂停末尾光标少一行（90000 行文字完整），两条原 worker 路径共 42 次资源 guard 失败；独立 worker 普通 15 项同时内容、pipe EOF 和自然退出通过。Windows 首轮后代夹具受父 Node kill-on-close Job 影响，六项门槛失败不能直接归为 reader 缺陷；修订夹具并新增真实后代存活/TTY 断言另跑，不改 reader 或预算。生产集成、长驻句柄/输入预算、实际宿主/packaged 继续开放，详见 `docs/design-docs/runtime-exit-integrity.md` 第 15–16 节。

2026-09-20 runner 合并后续：PR #294 已提供三平台最小原生基线，运行时分支已 rebase；不能再将“没有 runner”当成未验证原因，但 macOS/Windows 候选 reader、真实宿主与资源生命周期仍未验收。Windows 首次自然退出资源 guard 失败保留，事后 public kill 的诊断成功不关闭该问题。新隔离契约在 Node 25/Electron-as-Node 39 各 39 项通过，实际 Supervisor 注入各 17 项通过；真实分页投影证实旧 close 无法区分已应用与取消，尚未修改生产 wire。下一步按退出完整性 active 计划验证跨平台候选并选定接口/预算；F-03 root 归属、F-04 整体容量模型和本项退出完整性均未因此关闭。证据见 `docs/design-docs/runtime-exit-integrity.md` 第 12–14 节与 `scripts/diagnostics/diagnose-runtime-exit-contract.mjs`。

2026-09-17 终态短读补充：本轮第一次 90000 行用例的最后页已到 `revision=head=11628`，末尾仅第 89850 行和半个 marker，证据保存在 `.debug/runtime-completed-90000-first-failure/`；根因仍未定位。后续改为直接逐行核对实际 xterm 后通过 90000/90000，不能据此关闭原有间歇性风险。测试观测也独立修正：200 条 test-only 消息环不能拼完整历史，保留的 viewport 不能代表 buffer 尾部。取消 completed 归档不改变当前页面的完整性要求。

2026-09-18 退出分页补充：首轮 5 项 Linux 宿主场景通过，第二轮第一项实际 xterm 仅 89969/90000，最后一页发送记录 `revision=headRevision=12654`。失败清理覆盖消息正文，尚不能判定缺失层；保留 `.debug/runtime-paged-completion-short-read-failure/`，新增 `completed-before-cleanup/` 独立现场及首末行诊断。补强观测后的 90000 行逐行校验与空白重开通过，但严格完整性断言不变，短读债务继续开放，不用本批取消终态聚合宣称修复。

2026-09-18 独立定位补充：已捕获 Linux Node/libuv 在 PTY HUP/partial read 时过早 EOF。Node 25 实际 Supervisor 十轮无延迟有三次 raw 已缺尾部，下游逐字节一致；另一十轮 EOF 探测有三次从同一 fd 补读 313/2235/251 字节后得到精确 90000 行。裸 PTY syscall 对照、VS Code 内置 Node 22 受控实验也复现；Node 22 五轮无延迟全部完整。排除的是本轮样本中的下游丢失和 200 ms timer，旧失败不能全部追认为同因。只补诊断和文档，未修复，技术债继续开放；完整证据与候选见 `docs/design-docs/runtime-terminal-tail-diagnosis.md`。

2026-09-20 跨平台复核：不能把该债务收窄为 Linux bug。Unix 200 ms timer 已在 Linux 真实 PTY 暂停消费实验中九次触发截断，六次销毁前捕获的 JS buffer + fd 残留恰好补齐 90000 行；Windows 默认 ConPTY 的 1 秒无 data destroy 由实际安装 JS 的 7 个场景和真实 TCP reader 证明不能保证排空。macOS kqueue 不提供相同 HUP 输入，原生 close 也不同，不能套用 Linux 因果；原生 macOS/Windows 矩阵仍未运行。公共 11 场景夹具证明已接受操作可收敛、exit 后数据被拒绝，未发现队列另行丢数据。修复范围应覆盖跨平台 bridge 契约和 Runtime/snapshot-only，详见 `docs/design-docs/runtime-terminal-cross-platform-diagnosis.md`；本轮只诊断，风险与原生验收缺口继续开放。

2026-09-20 交付范围确认：用户同意将退出完整性作为本次 Runtime Persistence 重构的独立交付项，已建立 `docs/design-docs/runtime-exit-integrity.md` 与 `docs/exec-plans/completed/runtime-exit-integrity.md`。本次仅同步范围、契约目标与验收门槛；具体实现未选定、业务未修改、原生矩阵未完成，债务继续开放，不因立项或其他容量增量完成而关闭。

2026-09-20 方案阶段：首轮 Linux Node 25 与 Electron-as-Node 39 的 84 个隔离样本已完整留存。独占异步 reader 候选 36 次完整读取、6 次明确取消；原 reader 暂停组 6 次成功写入后缺尾，后代延迟组 6 次因提前关闭导致写失败，不能混为同一种丢失。自然 HUP 对照、macOS/Windows 原生和实际 Host/packaged 均未完成，轮询原型不是生产方案。另确认 closeTerminalRead 不能区分页面完成与取消，需要纳入消费者应用契约；这是设计证明缺口，不是新增已复现的页面丢失。候选、版本/资源限制和工具回归见退出完整性设计第 7–11 节；不关闭债务。

| 日期 | 主题 | 背景与触发条件 | 影响范围 | 当前临时处理 | 建议修复时机 | 关联文档或代码路径 |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-10-08 | 无 generation 旧历史节点的实际窗口删除待验收 | 7db0bb3f与ee2e3793绑定原始workspace storage；已补布局支持。 | helper与Host受控验证不代证实际用户窗口删除；共享旧数据回收仍独立。 | helper136/native40/Host149项定向、类型、默认构建和staging/config通过；同机原记录只读检查均取得detached-recovered-history，registry hash不变；原3项socket/claim例本轮无跳过。 | 加载本次调试产物后沿原删除入口验收两个具名节点；本轮未修改用户节点/已安装扩展，不重复无关矩阵。 | `docs/design-docs/runtime-persistence-closeout.md` §12第五现场、`docs/exec-plans/completed/unversioned-runtime-history-cleanup.md` |
| 2026-10-07 | 当前状态 codec 的固定 xterm 私有模型耦合 | xterm 6.0.0 的 buffer/parser/link/palette 内部字段用于精确导入；依赖升级或新增生产 handler 会改变契约。 | live 新投影的恢复保真和未来增量交接，不涉及旧 Supervisor 热迁移。 | 固定版本/格式并先校验后导入，覆盖现有生产 OSC52；PR #295 补充 RIS/缩高的 detached/afterEnd 链接语义，不在捕获时修改源端；保留上游遗留链接元数据行为，不宣称通用 GC 已修复。 | 升级 xterm 或改变生产 handler 前重新核对两端模型和未来后缀，只补受影响回归，不能仅更新版本字符串。 | `docs/design-docs/runtime-live-state-recovery.md`、`extensions/vscode/dev-session-canvas/src/common/terminalCurrentState.ts` |
| 2026-10-07 | final-state/resize 协议测试的固定等待时序 | PR #295 reviewer 在 c9f9e105 首跑 `test-runtime-supervisor-protocol.mjs` 于 `finalizingResizeRejected` 失败；代码不变复跑通过，包括十会话协议样本。基线已在输出 marker 后固定 `delay(25)`，输出出现不证明进程退出观察已到达。 | 测试稳定性及其结果解释；尚未证明本 PR 的产品回归，不作为本次 OSC8 修复 blocker。 | 保留首败和复跑两项事实，不改断言或追认全绿；本条来源为 reviewer 评论 6039924656，不冒称 worker 新执行。 | 下次修改该退出用例或再次出现时，用实际退出观察核对准入点；不因此追加跨平台矩阵或通用诊断阶段。 | `scripts/test/test-runtime-supervisor-protocol.mjs`、PR #295 评论 6039924656 |
| 2026-10-07 | 大当前模型的同步导入与配置相关资源成本 | Linux 两会话填充态10200040字符/1246块恢复约5114.9ms，单次paged-current-state约536.9ms、main-thread lag603ms，总RSS离散峰值约2.99GB；B18.4ms在导入后。 | 大scrollback/geometry与多reader同时初始化的交互和资源成本；不是累计交互无界重放，也不是任意并发已通过。 | 逐页传输、完整身份共享open、每key当前和待释放责任最多2；保留O(当前模型×有效reader)和原内容/尾部，不设旧64/128硬阈值。 | 只有具名支持负载再现不可接受交互/资源问题或产品扩展并发保证时定向优化；不默认追加profiler、精确allocation peak或容量阶梯。 | `docs/design-docs/runtime-live-state-recovery.md`、`.debug/f04-filled-current-state-20261007-staged/`、`extensions/vscode/dev-session-canvas/src/panel/runtimeTerminalReadRelay.ts` |
| 2026-10-07 | 历史 Windows 初始订阅停滞未归因 | run37494231281有closed/sourceEOF/final1382而Host仍live/outputSequence2，旧启动批次已清空；后续原入口通过，但不能还原当次时序。 | 原失败的因果解释和未来同类停滞，不等于已证最终版本仍有产品缺陷。 | 保留原工件与严格尾部断言，后续入口保存启动期消息；不将保留退出进程对象的正常Windows语义当作根因。 | 新版本再次出现或发现当前确定性订阅路径时使用现有具名证据定位，不为抓红自动重跑矩阵或扩展诊断框架。 | `docs/exec-plans/completed/runtime-live-state-recovery.md`、`tests/vscode-smoke/execution-candidate-tests.cjs` |
| 2026-10-06 | 停止旧Runtime历史清理的覆盖与原生验证边界 | 两个旧Linux systemd generation分别支持recorded-exit与强停止stopped-runtime；sandbox拒绝systemctl/真实Unix socket访问，2例跳过，新分支实际用户窗口未操作。 | 未知/其他后端、既无退出记录又缺强停止事实或文件校验不符时仍严格删除；原生组合未被受控测试代证。 | 核验81项和实际Host类接线190项通过，原窗口已有第一分支退役事实；不改共享registry或把其他会话/后代写成已消失。 | 有原生权限时只补已有2例及具名现场动作；旧共享存储垃圾回收另立范围，不追加通用工具或全平台矩阵。 | `docs/design-docs/runtime-persistence-closeout.md` §12、`docs/exec-plans/completed/legacy-runtime-history-cleanup.md`、`extensions/vscode/dev-session-canvas/src/panel/legacyRuntimeHistory.ts` |
| 2026-10-06 | native detached 历史清理的原生测试限制（具名现场已成功） | 第三现场两个Agent 0a71c75b、45a796db属legacy-detached/terminal-exit-v1；第四包记录两者native-owner-absent已清理成功。 | 实际具名节点已验证，不扩大为所有legacy或跨平台通过；更老detached另按下一条。 | helper39、Host117定向/类型/构建/staging及用户具名结果通过；两入口先观察再连接新owner，保留submitted unknown/reader/finalization。同批共享但不跨操作缓存，不写共享数据或重启旧服务。 | sandbox的1新claim周期及2旧socket例仍跳过，现场成功不追认它们通过。两次未改大快照Host全量15秒超时保留，定向不代证全量；只按具体新证据修，不新增工具或无影响矩阵。 | `docs/design-docs/runtime-persistence-closeout.md` §12、`docs/exec-plans/completed/native-runtime-history-cleanup.md`、`extensions/vscode/dev-session-canvas/src/panel/nativeRuntimeHistory.ts` |
| 2026-10-06 | 旧detached纯历史清理的实际Host验证限制（有限实现已完成） | 第四现场6b9de465和6397fe41为旧terminal-stream-v1/recoveredHistoryOnly，没有退出码；同registry含其他backend，不可借用兄弟记录。 | 已按同环境原owner缺席+稳定精确纯历史记录允许本地解绑，不证明原node-pty/后代退出；缺标记、live、未知仍拒绝。 | legacy116/native39、Host95+36定向、类型/构建/staging及独立复核通过；native与旧记录分别路由，旧记录不使用storage许可或启动前沿用，原数据不写。 | 用户加载新调试包后原入口fresh观察；隔离工具/proc不能代证实际owner缺席。共享旧目录回收、其他PID namespace或任意legacy格式不在此修复范围；不重启旧Supervisor、不复跑无影响矩阵。 | `docs/design-docs/runtime-persistence-closeout.md` §12、`docs/exec-plans/completed/detached-restored-history-cleanup.md`、`extensions/vscode/dev-session-canvas/src/panel/legacyRuntimeHistory.ts` |
| 2026-10-02 | 历史Windows非空snapshot精确因果未知，当前SGR22缺陷已修 | 36972376905保存756B/seq66，hydrate后语义不同；36976601577另证实际prefix12个有字符cell丢Bold。63847969修SGR22，未取得旧756B原控制序列，不能证明完全同因。 | 旧失败的因果解释及未来同类终端状态回归；不是已证当前版本仍有损失。 | 保留旧失败/工件，stock红对照、最终新包三平台四cell保存/重开与六Agent严格验收通过，Windows实际24非空prefix无差异/unknown；不以最终清屏证明非空保真。 | 仅在当前版本再现非空不保真、发现当前确定性路径或收到实际报告时定向重开；不自动新增捕获循环或全ANSI工具框架。 | `docs/design-docs/runtime-exit-integrity-production-integration.md` §53.1、`scripts/shared/ensure-xterm-serialize-patch.mjs`、`tests/vscode-smoke/agent-candidate-snapshot-evidence.cjs` |
| 2026-10-02 | 自然退出附近的not-live内部栈toast | Linux/macOS最终installed完整内容、状态和cleanup通过，但finalProbe仍含Runtime session is not live与内部栈；尚无对应RPC时序证明具体来源。 | 已结束节点的错误呈现，可能误导用户；当前不构成已证丢尾或保存失败。 | 保留报告和原失败，不吞没真正live控制错误；独立核对尾部、reader、四cell与新Host，未因此追加矩阵。 | 实际同类通知可复现时，按session身份/终态核对迟到resize等具体入口并收敛提示；不作为通用诊断前置。 | `extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts`、`extensions/vscode/dev-session-canvas/src/supervisor/runtimeSupervisorMain.ts`、生产接入§53.1 |
| 2026-10-09 | legacy Supervisor 默认 restart 与 Agent 自动 resume（有限修复已完成） | 2026-10-02 登记：Host旧绑定ensureConnected(false)成功后，普通request断连可默认启动旧namespace；旧Agent失败可清sessionId并自动CLI resume。 | 本轮统一旧绑定只重连、失败保留身份，不自动创建替代服务/CLI；snapshot-only恢复不变，不提升旧协议尾部保证。 | client35/35、timeout37/37、Host定向127/127及恢复/退役回归通过；Linux真实Host/Webview两场景通过。连接握手/RPC/reader/其他会话保护保留，strict first超时不退役，实际结算及finalization后重检。 | 此项不再自动安排阶段；缺失原ID不猜回绑定，未知结果/旧历史清理沿现有规则，共享目录清理独立。前三轮smoke前置失败保留，不代证历史二进制升级、真实Agent或跨平台矩阵。 | `docs/design-docs/runtime-legacy-reconnect-retirement.md`、`docs/exec-plans/completed/runtime-legacy-reconnect-retirement.md`、`extensions/vscode/dev-session-canvas/src/panel/runtimeSupervisorClient.ts`、`extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts` |
| 2026-10-09 | Claude 历史两条 CLI 原因仍未知（信任页验收适配已修正） | `37721390485` 两条 CLI 缺原身份/父关系明细。`37821133377` 单次 Down 后 Yes→No 已由同版 PTY/strace 定位，本轮用 End 有界选择及不可变启动基线修正 harness；不反推旧回退运行的内核输入次数。 | 历史额外 CLI 的来源仍未知；CLI 内部回退原因及其他版本/平台的交互差异不在本轮证明范围。 | 原失败保留；45/45 driver 测试、真实 CLI 回退恢复及 `ccc5a3ce` / `37828284014` 固定 Linux 原包应答/Reload/原身份退出/cleanup 通过。setup 早退清理由受控测试覆盖，基线形成前仍拒绝通过。 | 出现新的额外 CLI、固定页变更或实际失败时按首次证据定向处理，不循环重跑到绿、不放宽原身份/未知保护，也不重发副作用请求。 | `docs/design-docs/linux-claude-trust-startup-diagnosis.md`、`docs/design-docs/runtime-root-ownership.md` §8、`docs/exec-plans/completed/smoke-claude-startup-recovery.md`、`tests/vscode-smoke/agent-runtime-reload-driver.cjs` |
| 2026-10-08 | Root owner 的额外系统与规模边界未实测 | 现代三平台、实际 Linux systemd/Remote-SSH 与三 owner 分进程样本已验证；睡眠/调时/Fast Startup、Remote live 断网与 Remote systemd、长期多 root 增长没有本次直接证据。 | 额外 OS 行为及大量 root 固定进程开销；既有画板多窗口整图写回也无事务仲裁。 | 有限 R1 验收不冒充全交叉矩阵；三 owner RSS 仅观察样本，双窗明确保存/关闭顺序，不宣称多写者问题已解决。旧 live 仍按原绑定，unknown 不 fallback。 | 有相关产品使用要求或具名回归时补受影响验证；root 数规模变化时按真实进程模型评估资源，不采用旧 64/128 MiB 为硬门槛，不自动新增阶段。画板多写者事务另立范围。 | `docs/design-docs/runtime-root-ownership.md` §8、`docs/exec-plans/completed/runtime-root-ownership.md`、`extensions/vscode/dev-session-canvas/src/panel/runtimeExecutionEnvironment.ts` |
| 2026-09-20 | 原生退出基线覆盖与 Windows 自然退出资源生命周期 | 新增 runner 只覆盖 Node 下 5 个公共 node-pty 场景；首次 run 35491608835 的 Windows 内容/取消 15 项通过但 2 秒资源 guard 失败，源码自然 onExit 不进入 worker dispose，不能把内容匹配等同资源自动释放。 | 源排空保证、正常 stop/主进程运行中后代输出、90000 行压力、候选 reader、Windows DLL/worker、Host/Webview/真实 Agent/packaged 与全部支持 OS/架构均未由最小基线证明；Windows Server 不代表所有客户端。 | run 35492043484 三平台各 15 项及进程 guard 通过，Windows 只在内容结算后用公共 kill 显式回收 fixture；观察和清理资源分别保存，首次失败不覆盖。该通过不证明自然退出自动清理、资源计数为零或产品已修复；不修改生产、不放宽 guard。 | 扩展正式退出完整性矩阵及生产生命周期方案时分别收口；独立 runner 基础设施已验收，不替代这些后续交付。 | `docs/design-docs/runtime-exit-integrity-native-runners.md`、`docs/exec-plans/completed/runtime-exit-integrity-native-runners.md`、`scripts/diagnostics/diagnose-native-pty-exit-integrity.mjs` |
| 2026-09-16 | `src/common` 共享层依赖方向漂移 | `runtimeSupervisorProtocol.ts` 类型导入 `../panel/executionSessionBridge`；主扩展 helper 和 notifier 对主扩展 helper 的直接依赖，都把 VS Code 运行时放在共享目录。与 `ARCHITECTURE.md` 对纯共享层的边界不一致。 | 后续复用共享协议或工具时可能把 VS Code 运行时、Host 适配和潜在循环依赖带入 Webview / Supervisor，增加打包和测试隔离成本。 | 2026-10-09 已在 `common-dependency-boundaries` 分支完成最小收口：纯启动类型移入 `common/executionSessionLaunchSpec.ts`，主扩展 VS Code helper 移入 `panel/`，notifier 使用自身 Host helper，并加入 AST 守卫；待本分支验证和合并。 | `docs/exec-plans/completed/common-dependency-boundaries.md` 完成并合入后，本条可关闭；不搬迁 node-pty adapter 或扩大为 Supervisor 分层重构。 | `extensions/vscode/dev-session-canvas/src/common/runtimeSupervisorProtocol.ts`、`extensions/vscode/dev-session-canvas/src/panel/webviewResourceUri.ts`、`extensions/vscode/dev-session-canvas/src/panel/testHarness.ts`、`extensions/vscode/dev-session-canvas-notifier/src/testHarness.ts`、`ARCHITECTURE.md`、`docs/design-docs/webview-host-supervisor-architecture-review.md` |
| 2026-07-15 | VSIX 打包依赖仍引入已弃用的 `glob@11.1.0` | `0.24.3` 的 clean-checkout 与 Node 22 dry-run 临时 clone 执行 `npm ci` 时均报告 `glob@11.1.0` deprecated warning；`npm ls glob --all` 将来源收敛到 `@vscode/vsce@3.9.1 -> glob@11.1.0`。同轮 `npm audit --omit=dev` 与隔离安装 audit 都是 `0 vulnerabilities`，因此不能把 warning 直接写成已确认漏洞；2026-07-15 registry 只读复核显示 `@vscode/vsce@3.9.2` 已改用 `glob@^13.0.6`。 | 当前不阻断 `0.24.3` 打包、VSIX file-list、clean-checkout 或 package-only dry-run，但每次全新安装都会产生弃用噪音；长期停留在旧依赖会增加未来 npm / Node 支持或真实安全修复升级时的发布基础设施风险。 | 保持当前 lockfile 与已验证候选工件不变，不在发布准备分支顺手升级打包工具；发布证据同时保留 warning 与 `0 vulnerabilities` audit，避免把二者混写。 | 下一轮 VSIX / 发布基础设施 hardening，或 `@vscode/vsce` / Node 版本调整前；至少升级到不再依赖 deprecated glob 的版本，并重跑 VSIX command / file-list 守卫、双 VSIX 打包、clean-checkout packaged-payload smoke 与 publish-tag package-only dry-run。 | `package.json`、`package-lock.json`、`scripts/release/package-vsix.mjs`、`extensions/vscode/dev-session-canvas-notifier/scripts/package-vsix.mjs`、`docs/public-preview-release-playbook.md` |
| 2026-07-15 | 录制器旧 `stop` 仍可能覆盖双宽屏正式媒体 | 新正式流程已把真实宿主录制与双语 compositor 分离，并新增无导出副作用的 `close`；但为了兼容历史维护命令，`recording-session.mjs stop` 仍会拼接旧 clips、生成旧单宽屏 GIF，并把最后一张历史 GIF frame 复制为正式 PNG。误用该入口会绕过 pair manifest、显式 Hero、双语输出和 staged validation。 | 可能把已验收的六份 Marketplace 媒体中的默认英文三件套静默回退为旧格式；不影响 `close`、原始素材或独立 compositor。 | 录制 Skill、设计文档与完成计划统一要求当前流程只用 `close`，正式资产只由 `compose-marketplace-media.mjs render` 生成；compositor 已改成 staged 三件套全部通过 report 后才发布。保留 `stop` 仅为历史兼容，不把它写成当前入口。 | 迁移或确认不再有维护脚本依赖旧 `stop` 后，应删除旧 `concatClips()` / `composeGif()` 导出，或把旧覆盖行为收窄到带显式 `--legacy-export` 的命令；若再次误覆盖正式资产则立即处理。 | `scripts/media/recording-session.mjs`、`scripts/media/compose-marketplace-media.mjs`、`docs/skills/recording-marketplace-media/SKILL.md`、`docs/design-docs/marketplace-readme-media-automation.md`、`docs/exec-plans/completed/marketplace-multi-root-media-production.md`、`docs/exec-plans/completed/marketplace-real-provider-media-rerecord.md` |
| 2026-07-14 | Marketplace publish workflow 使用的官方 Actions 仍以 Node.js 20 为目标 | `0.24.2` 的成功发布 run `29309330723` 在四个 job 中对 `actions/checkout@v4`、`actions/setup-node@v4`、`actions/upload-artifact@v4` 与 `actions/download-artifact@v4` 发出 Node.js 20 deprecated annotation，并由 GitHub runner 强制改用 Node.js 24 执行。所有 job 与整轮 run 仍为 `success`，该 annotation 不是本次发布失败；Visual Studio Marketplace 的 deferred 状态来自独立的 `VSID Concurrency` 与 public gallery 不可见问题。 | 当前不影响 `0.24.2` 工件、Open VSX verified 或最终 manifest，但继续依赖 runner 的兼容强制切换会保留弃用噪音，并可能在 GitHub 后续移除兼容路径时阻断打包、artifact 传递、双市场发布或 finalize。 | 保留成功 run、最终 manifest 和 annotation 作为证据，不通过忽略 annotation 或把 action 内部 runtime 与仓库业务 Node 版本混为一谈；本轮不在发布准备分支顺手改 workflow。 | 下一轮 GitHub Actions / 发布基础设施 hardening，或 GitHub 调整 Node.js 20 兼容策略前；升级到明确支持 Node.js 24 的官方 action 版本后，应完整回归 package、GitHub Release asset 首次上传 / 同版本下载复用、Open VSX / VSM 独立结果合并与 finalize / 临时 tag 删除。 | `.github/workflows/publish-marketplace-release.yml`、`docs/public-preview-release-playbook.md`、`docs/design-docs/public-marketplace-release-readiness.md` |
| 2026-07-14 | Fork Webview click 与旧 Supervisor resize smoke 存在聚合时序 flaky | `0.24.2` 发布准备中，包含 16 项 Fork / journal 定向用例的 Playwright 聚合命令两次都在 `Agent Fork action posts...` 中失败：按钮已经可见、可用且文案正确，但 `locator.click()` 等待 element stable 30 秒超时；该用例隔离运行通过，其余 15 项排除该用例后聚合通过。真实 `legacy-supervisor-upgrade` smoke 首次运行也在 input/output、节点尺寸和 terminal probe 都已可见后，等待 Agent / Terminal cols/rows 相对初值变化 20 秒超时；原样复跑完整场景通过。2026-09-17 分页投影最终 smoke 再次出现相同 resize 等待超时，输入输出 marker 均可见，原样隔离重跑通过；失败 probe 保留在 `.debug/runtime-paged-terminal-projection-final-smoke.log`，重跑在 `.debug/runtime-paged-legacy-resize-recheck.log`。目前没有内容、authority 或版本断言失败证据，resize 时序根因仍未确认。 | 降低发布前 UI / 真实升级门禁的确定性，尤其在同一进程顺序运行多项 Webview 用例或高负载真实宿主下，可能把 action 稳定等待与 xterm fit/resize 收敛抖动误报为产品回归。 | 保留原断言、失败 artifact 和首次失败事实；Fork 用例通过“隔离该项 + 排除该项后的其余聚合”确认覆盖，不使用 `force: true` 绕过可操作性；legacy upgrade 只有在 probe 已证明 input/output 健康时才原样复跑，不降低 resize / client drain 断言。 | 下一轮 Playwright / smoke harness hardening，或任一现象再次影响 release gate 时；应为 Fork action 分层记录可见 / enabled / stable 与动画状态，为 legacy resize 记录 resize message、xterm fit callback、probe cols/rows 和 Supervisor resize 收敛时间，再决定修复动画稳定边界还是等待语义。 | `tests/playwright/webview-harness.spec.mjs`、`tests/vscode-smoke/legacy-supervisor-upgrade-tests.cjs`、`scripts/smoke/run-vscode-smoke.mjs`、`docs/public-preview-release-playbook.md`、`docs/exec-plans/completed/runtime-paged-terminal-projection.md` |
| 2026-07-14 | 真实宿主 smoke 对合法状态推进与 Canvas ready 存在偶发时序误报 | PR #263 review 在 `origin/main@9dff56f` 上的首次 `trusted` 运行中，seeded history-restored Agent 已合法推进到 `resuming`，但用例的瞬时断言只接受 `resume-ready/history-restored`；artifact 同时证明严格 90000 行已全部到达。同轮首次 `real-reopen` verify 在等待 editor Canvas ready 时命中 20 秒超时，但 runtime artifact 中 pending operation 为 0，Agent/Terminal authority、revision 与 output 正常。两条命令原样复跑均通过，目前没有内容丢失或恢复回归证据。 | 降低 `trusted` / `real-reopen` 作为 PR 真实宿主门禁的确定性，容易把状态机正常前进或 Webview ready 抖动误报为产品回归；当前只确认为 smoke harness 稳定性风险，不扩大为运行时缺陷。 | 保留 authority、revision、内容 marker 和 90000 行的严格断言；首次失败时保留 artifact 并核对 runtime/content 证据，只在证据健康时原样复跑，不通过放宽状态或内容断言消除误报。 | 下一轮 smoke harness hardening，或任一现象再次复现时；应让 history-restored 用例等待一组合法可前进状态或更稳定的语义不变量，并为 editor Canvas ready 超时增加分层诊断后再决定是否调整等待策略。 | `tests/vscode-smoke/extension-tests.cjs`、`tests/vscode-smoke/real-reopen-tests.cjs`、`scripts/smoke/run-vscode-smoke.mjs`、`docs/exec-plans/completed/terminal-journal-safe-compaction.md` |
| 2026-07-12 | 终态尾部完整性与跨平台退出契约（有限产品交付已结账，历史保留） | 历史90000行短读、Linux HUP/partial read、Unix timer截断与Windows静默关闭证据保留，不将所有旧失败追认为同因。 | 主进程尾部、消费/页面应用与资源释放仍分别保证，final revision不独立证明完整，无历史重开不豁免当前页面。 | 默认owned provider、Host/Webview结算及六目标分发已实施；63847969最终受影响包和具名未变证据完成A1至A6有限验收，见生产接入§53.1。 | 不再以此历史总条目自动排新阶段；当前非阻塞残余按上列756B精确因果、not-live toast和legacy边界分别触发，root另计划，旧OS/通用工具不前置。 | `docs/design-docs/runtime-persistence-closeout.md` §8、`docs/design-docs/runtime-exit-integrity-production-integration.md` §53.1、`docs/exec-plans/completed/runtime-exit-integrity.md`、`docs/product-specs/runtime-persistence-modes.md` |
| 2026-09-18 | F-04：保守 compact 停止后的全后缀内存与传输增长（当前支持路径已收口） | checkpoint 超过 256 Ki 字符、OSC 颜色副作用或无法证明状态时继续保留 journal；审核基线约 80 KiB 屏幕对应约 19.35 MiB snapshot。 | 新路径正文缓存/在途窗口不随累计历史增长；仍保留用户scrollback/geometry、O(N)活动会话、逐reader单页/索引、O(segment metadata)及checkpoint拒绝或慢reader下磁盘增长的明确边界，legacy完整恢复成本不回填新保证。 | checkpoint刷新、有限缓存、live/退出分页、轻量completed及消费信用已落地；§10.17补齐生产准入、冷启动及退休存储责任。原19.66 MB output诊断终态407字节、最大页253669字节保持为历史字节证据；既有十会话/重连/compact与本轮固定默认包的受影响三平台Runtime验收共同完成容量结账，不视为全局RSS保证。 | 无新增容量阶段；仅发现当前支持路径的具体回归时重开。保留旧64/128阈值/失败、O(N)/O(segment)/磁盘/legacy限制，不重新引入completed归档或Supervisor故障恢复，不丢运行中及当前页面尾部；独立snapshot状态差异由A2/A4承担。 | `docs/design-docs/runtime-paged-completion.md`、`docs/design-docs/runtime-completed-no-history.md`、`docs/design-docs/runtime-paged-terminal-projection.md`、`docs/design-docs/runtime-journal-bounded-cache.md`、`docs/design-docs/runtime-persistence-storage-reevaluation.md`、`scripts/diagnostics/audit-runtime-persistence-capacity.mjs` |
| 2026-07-11 | 一键 `npm test` 仍受 Marketplace 与 Webview 基线夹具漂移阻断 | 本轮原样运行 `npm test` 时，Marketplace VS Code fixture 把临时目录放在深层项目路径，Unix IPC socket 超过长度限制并报 `listen EINVAL`；分支起点 `5355e6a` 的临时 worktree 在同路径复现。改用 `/tmp` 短路径后，fixture 等待中文按钮但实际英文 locale probe 为 `Publish custom template`、`Install`、`View details`。继续逐项审计还确认 theme/template 静态测试仍扫描已拆分的 `main.tsx`，canvas node group mock 缺 `vscode.l10n`；rebase 后完整 Webview 为 331/341 通过，10 项失败已在独立最新 `origin/main@d7baadf` worktree 逐项复现。 | `npm test` 不能作为当前仓库的单一清洁 PR 门禁，协作者需要额外时间区分产品回归、runner 路径限制和陈旧断言，也容易误把与当前分支无关的失败写成本轮回归。 | 当前终端重构以 typecheck/build、协议与 journal 定向测试、10-Agent 基准、定向 Webview 和完整默认 VS Code smoke 作为主证据；一键测试失败保留原始原因并按命令顺序继续审计，不声称 `npm test` 清洁通过，也不在终端 PR 内顺手修改无关 fixture。 | 下一轮测试基础设施 hardening，或准备把 `npm test` 恢复为强制合并门禁时，应先把 Marketplace host/debug tmp root 默认收短并固定 locale，再更新拆分源码后的静态扫描和 `vscode.l10n` mock，最后逐项收敛 Webview 既有失败。 | `package.json`、`scripts/smoke/run-template-marketplace-vscode-e2e.mjs`、`tests/vscode-smoke/template-marketplace-tests.cjs`、`scripts/test/test-theme-color-tokens.mjs`、`scripts/test/test-canvas-templates.mjs`、`scripts/test/test-canvas-node-groups.mjs`、`tests/playwright/webview-harness.spec.mjs`、`docs/exec-plans/completed/agent-terminal-lossless-io-redesign.md` |
| 2026-07-08 | Webview `main.tsx` 仍是大型组合入口 | 本轮确认 `extensions/vscode/dev-session-canvas/src/webview/main.tsx` 曾超过 19k 行，React 应用入口、React Flow 画布、节点组件、Note Markdown 渲染、paneGallery 本地状态、group chrome 样式、内嵌终端前端、测试 bridge 与局部状态曾集中在同一文件；已分七轮行为保持重构，拆出 `paneGalleryLocalState.ts`、`paneGallerySurface.tsx`、`fileNoteNodes.tsx`、`canvasNodeChrome.tsx`、`noteMarkdownPreview.ts`、`canvasGroupFrameStyles.ts`、`canvasTypes.ts`、`canvasEdges.tsx`、`canvasGraphRules.ts`、`canvasDomEvents.ts`、`noteEditingSurface.ts`、`canvasMiniMap.tsx`、`canvasUiSurface.tsx`、`canvasGroupLayers.tsx`、`executionTerminalTypes.ts` 与 `executionSessionNodes.tsx`，不改变功能语义。 | 后续 Webview 改动的 review 成本、冲突概率和误改无关区域风险仍偏高，尤其是 `App()` 状态机、执行终端 controller / output drain、ExecutionHelpTrigger / canvas-level help panel 和 test-only DOM bridge 仍在入口中；Agent/Terminal 执行节点组件、File/Note 节点、通用节点 chrome 与 paneGallery UI 已离开入口，但仍通过依赖注入复用入口持有的 registry、controller factory、runtime context、React Flow node/edge types、本地化和消息函数。 | 当前把 `main.tsx` 从 19,233 行降到 9,179 行，并新增 `canvasNodeChrome.tsx` 承载 530 行共享节点 chrome；本轮已通过 typecheck、build、Webview xterm entry / protocol 定向测试和 diff check；不把“大文件技术债”写成已经完全解决。完整 `npm run test:webview` 在当前 headless 环境下曾因 `requestAnimationFrame` 不触发超时，且同一 probe 在 `origin/main` 也复现，因此不作为本轮重构行为差异证据。 | 下一轮继续大改 Webview、执行终端、节点尺寸/resize、canvas help 或 test bridge 前，应优先继续按模块边界拆分；建议先拆执行终端 controller / output drain、DOM probe bridge 或 ExecutionHelpTrigger / canvas help surface，每批都保持行为不变并单独验证。 | `extensions/vscode/dev-session-canvas/src/webview/main.tsx`、`extensions/vscode/dev-session-canvas/src/webview/canvasNodeChrome.tsx`、`extensions/vscode/dev-session-canvas/src/webview/fileNoteNodes.tsx`、`extensions/vscode/dev-session-canvas/src/webview/paneGalleryLocalState.ts`、`extensions/vscode/dev-session-canvas/src/webview/paneGallerySurface.tsx`、`extensions/vscode/dev-session-canvas/src/webview/noteMarkdownPreview.ts`、`extensions/vscode/dev-session-canvas/src/webview/canvasGroupFrameStyles.ts`、`extensions/vscode/dev-session-canvas/src/webview/canvasTypes.ts`、`extensions/vscode/dev-session-canvas/src/webview/canvasEdges.tsx`、`extensions/vscode/dev-session-canvas/src/webview/canvasGraphRules.ts`、`extensions/vscode/dev-session-canvas/src/webview/canvasDomEvents.ts`、`extensions/vscode/dev-session-canvas/src/webview/noteEditingSurface.ts`、`extensions/vscode/dev-session-canvas/src/webview/canvasMiniMap.tsx`、`extensions/vscode/dev-session-canvas/src/webview/canvasUiSurface.tsx`、`extensions/vscode/dev-session-canvas/src/webview/canvasGroupLayers.tsx`、`extensions/vscode/dev-session-canvas/src/webview/executionTerminalTypes.ts`、`extensions/vscode/dev-session-canvas/src/webview/executionSessionNodes.tsx`、`docs/exec-plans/completed/webview-main-tsx-refactor.md`、`docs/exec-plans/completed/webview-main-tsx-second-module-split.md`、`docs/exec-plans/completed/webview-main-tsx-third-module-split.md`、`docs/exec-plans/completed/webview-main-tsx-fourth-execution-node-split.md`、`docs/exec-plans/completed/webview-main-tsx-fifth-pane-gallery-split.md`、`docs/exec-plans/completed/webview-main-tsx-sixth-file-note-node-split.md`、`docs/exec-plans/completed/webview-main-tsx-seventh-node-chrome-split.md` |
| 2026-07-03 | UI 文案本地化发布前仍需更深人工抽查 | 已完成 manifest 英文默认/简体中文静态文案、VS Code runtime l10n bundle 声明、Webview typed dictionary、standby HTML、Extension Host、主画布 Webview、sidebar、模板保存表单、模板市场 panel/Webview、模板市场客户端、共享状态/cwd helper、Agent 启动/CLI 解析 helper、Runtime Supervisor、模板解析/存储错误与 Webview test DOM 兼容文案收口；本批新增真实 VS Code locale smoke，分别以英文和简体中文宿主验证 manifest、Host runtime、sidebar、内置模板标签、standby HTML 与 active Webview 代表性路径。 | 英文/中文用户在关键入口和代表性运行路径看到本地化文案；但自动化 smoke 仍是代表性覆盖，不等同于发布前人工点击所有菜单、QuickPick、模板市场和错误路径。 | 当前通过 `npm run test:ui-copy-localization` 防止 key 缺失和硬编码中文回归，通过 `npm run test:ui-copy-locale-smoke` 提供真实宿主 locale 证据；不再把“缺真实 locale smoke”作为技术债。 | 准备把本地化支持作为发布亮点、升级 `docs/design-docs/ui-copy-localization.md` 为完全已验证，或新增大面积 UI 文案入口前，应在真实英文 / 简体中文 VS Code 中补充更深人工抽查并把结果回写设计文档。 | `docs/design-docs/ui-copy-localization.md`、`docs/exec-plans/completed/ui-copy-localization-locale-smoke.md`、`docs/exec-plans/completed/ui-copy-localization-webview-test-compat.md`、`scripts/smoke/run-vscode-ui-copy-locale-smoke.mjs`、`tests/vscode-smoke/ui-copy-locale-tests.cjs`、`extensions/vscode/dev-session-canvas/src/webview/i18n/webviewI18n.ts` |
| 2026-06-27 | 模板市场真实 GitHub OAuth preview smoke 仍需发布前补跑 | 模板市场发布、点赞、举报和治理链路已有 fake auth / 本地 D1/R2 / 本地 fixture 覆盖；但真实 workers.dev preview 中使用 GitHub OAuth 登录后的普通用户举报、管理员处理、下架公开隐藏和被封禁用户写拒绝仍未形成端到端 smoke 证据。 | 主要影响把模板市场从 `验证中` 升级为 `已验证` 的发布可信度；不影响本地自动化已覆盖的权限判断、D1/R2 写入和 UI 主路径。 | 当前把真实 OAuth preview smoke 明确作为遗留验证项，不阻塞 v0.19.0 适配分支，也不作为 `feature/templates-marketplace` 合回 `main` 的门禁；设计文档继续保持 `validation_status: 验证中`，不把真实 OAuth 口径写成已验证。 | 发布前、配置 preview/production OAuth App secrets 后，或准备把模板市场验证状态升级为 `已验证` 前，应在网络可达环境补跑真实 preview smoke 并把结果回写设计文档；该项已明确降级为合回 `main` 后的 follow-up。 | `docs/design-docs/template-marketplace.md`、`docs/product-specs/template-marketplace.md`、`docs/exec-plans/active/template-marketplace-phase4-governance.md`、`apps/template-marketplace/src/worker/auth.ts`、`extensions/vscode/dev-session-canvas/src/panel/TemplateMarketplaceClient.ts` |
| 2026-06-27 | 插件内市场 UI 尚未共享 React Webview bundle | 当前浏览器市场使用 `apps/template-marketplace/src/web/` 的 React/Vite 实现，插件内市场仍在 `extensions/vscode/dev-session-canvas/src/panel/CanvasTemplateMarketplacePanel.ts` 中维护本地 Webview HTML、样式和 message bridge；功能已可验证，但长期会增加两套 UI 的一致性成本。 | 主要影响后续 UI 迭代、Dashboard / 管理后台能力复用和 VSCode token adapter 的长期维护成本；不影响当前插件内列表、详情、安装、更新、回滚和发布入口的主路径。 | 当前保留本地 Webview HTML，并在设计文档中要求后续收敛到共享 React bundle 时必须保留 VSCode token adapter，不复用浏览器固定色。 | 下一轮做市场 UI 架构收口、需要在插件内复用更多浏览器组件，或准备降低长期维护成本时，应新开主题分支实现共享 React Webview entry 和 host adapter。 | `extensions/vscode/dev-session-canvas/src/panel/CanvasTemplateMarketplacePanel.ts`、`apps/template-marketplace/src/web/`、`docs/design-docs/template-marketplace.md`、`docs/marketplace/UI.md` |
| 2026-06-25 | 会话历史恢复 / 分叉对失效历史 cwd 仍缺体验策略 | PR #210 将会话历史 item 的原始 `cwd` 从 sidebar Webview、QuickPick 和内部恢复命令一路透传到 `CanvasPanelManager`，并通过 `cwdOverride` 让多根 workspace 创建链路能解析目标 root；但统一创建链路仍要求该 `cwd` 当前存在、是目录且位于 workspace 内。若 provider 历史记录中的子目录已被删除或移动，恢复 / 分叉会被 cwd 校验拒绝。 | 多根 workspace 下历史恢复 / 分叉的容错体验和错误提示可信度；不影响历史 `cwd` 仍存在时的主路径 root 归属。 | 当前保持 fail closed：保留原始 `cwd` 作为执行目录并依赖统一 cwd 校验拒绝无效目录；本轮自动化只覆盖 cwd 透传和创建前 root 解析链路，未跑真实 VS Code multi-root 端到端 smoke，也不把失效目录回退策略写成已完成。 | 下一轮做会话历史恢复体验 polish、真实 VS Code multi-root smoke，或收到历史 `cwd` 失效反馈时，应明确选择直接提示用户、回退到所属 workspace root，还是在列表层标记失效 `cwd`。 | `extensions/vscode/dev-session-canvas/src/sidebar/CanvasSidebarSessionHistoryView.ts`、`extensions/vscode/dev-session-canvas/src/extension.ts`、`extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts`、`scripts/test/test-sidebar-session-history.mjs`、`docs/design-docs/canvas-sidebar-node-and-session-lists.md` |
| 2026-06-18 | 画布布局整理大型复杂连线图仍非全局最优 | 本轮针对真实截图修复了单成员分组留白、连线端点邻近、fanout 同层和长 label 通道，但仍采用确定性轻量层级 / 网格布局，没有引入专业图布局求解器；环状关系会保留高权重约束并丢弃会成环的低优先级约束。 | 大型、稠密或多环画布中仍可能存在局部连线交叉、非最短路径或需要人工微调的布局。 | 当前优先保证 root / 普通分组硬边界、对象归属不变、结果可持久化和可测试；用状态级回归覆盖已反馈的可见问题，不把整理能力包装成全局最优图布局。 | 如果后续继续收到复杂图整理质量反馈，或产品准备承诺“图布局级”排版质量时，应评估 ELK / 约束布局 / 可视化求解器，并通过真实画布样例回归比较收益。 | `extensions/vscode/dev-session-canvas/src/common/canvasLayoutArrangement.ts`、`docs/design-docs/canvas-layout-arrangement.md`、`docs/exec-plans/completed/canvas-layout-arrangement-edge-polish.md` |
| 2026-06-17 | 画布布局整理完整 Webview 回归仍需清洁通过 | 本轮实现“整理画布布局”后，布局纯函数、协议、定向 Playwright、trusted smoke、typecheck 和 diff check 均通过；但完整 `npm run test:webview` 曾出现 4 个与本功能无直接关系或疑似波动的失败，导致新设计文档验证状态保持为“验证中”。 | 布局整理功能的验证状态升级；主要影响是否能把右键菜单入口与无 toast 行为从定向覆盖提升为完整 Webview 回归闭环。 | 当前保留定向 Playwright 覆盖新增入口和消息发送，trusted smoke 覆盖 Host 持久化与 reload 保持；完整 Webview 失败不作为本轮功能 blocker，但已在设计文档和完成计划中记录。 | 下一轮整理 Webview flaky / baseline 失败，或发布前跑完整 UI 回归时，应复跑完整 `npm run test:webview`，清洁通过后把 `docs/design-docs/canvas-layout-arrangement.md` 的 `validation_status` 升级为“已验证”。 | `docs/design-docs/canvas-layout-arrangement.md`、`docs/exec-plans/completed/canvas-layout-arrangement.md`、`tests/playwright/webview-harness.spec.mjs` |
| 2026-06-16 | paneGallery 第一版尚未虚拟化 heavy pane，真实 terminal input 端到端验证仍缺口 | 多根窗格画廊第一版为尽快回应多 root 平铺、聚焦、独立缩放和很多 root 时不无限压缩的需求，先落地滚动 gallery，并复用现有 execution node 渲染来承载 pane 内终端输入；2026-06-17 交互收口后已改成 `dynamic` / `grid` / `topThumbnails` / `sideThumbnails` 四模式，并移除顶部 toolbar 与 filter roots。当前自动化覆盖 pane 渲染、dynamic 右键创建目标 root、缩略图单击无副作用、缩略图双击切换、many-roots 滚动/不额外限制缩放和 Markdown drop 目标 root，但尚未跑真实 VSCode 宿主下 xterm input 端到端，也没有实现按可见区挂载/卸载重型 React Flow/xterm pane。 | root 数量达到几十个且每个 root 内有 live terminal 时的性能与资源占用；`paneGallery` 中 terminal input 的真实宿主可信度仍低于已有 rootGroups 主路径。 | 当前保持 pane 最小可交互尺寸，超出同屏后使用滚动 gallery；`dynamic` / `grid` 和 thumbnail 模式 active root 主画板挂载现有 React Flow/nodeTypes，terminal input 走原 `webview/executionInput` 路径；文档验证状态保持“验证中”，不把虚拟化或真实 terminal input 写成已完全验证。 | 下一轮做 paneGallery 性能收口、真实 VSCode smoke、或收到多 root 大规模 workspace 性能反馈时，应优先补可见区虚拟化和 xterm input 真实端到端回归。 | `extensions/vscode/dev-session-canvas/src/webview/main.tsx`、`extensions/vscode/dev-session-canvas/src/webview/styles.css`、`tests/playwright/webview-harness.spec.mjs`、`docs/exec-plans/completed/canvas-multi-root-pane-gallery-mode.md` |
| 2026-06-16 | Sidebar workspace/worktree 操作仍缺真实宿主端到端人工验证 | 本轮已实现 `节点` sidebar 的添加 folder、新建 git worktree、workspace folder 行移除 folder、workspace folder 行新建 worktree，以及 workspace folder 行移除 worktree；随后又把 worktree 图标改成专用 `worktree` Codicon，并把创建流程扩展为 VS Code 风格 QuickPick ref 选择。manifest / Webview DOM / typecheck / build 覆盖了静态与消息链路；但当前未在 Extension Development Host 中实际点选文件夹 picker，或对 disposable git repo 执行 `git worktree add` / `git worktree remove`。 | 真实 VS Code picker、workspace folder 增删事件、`git` 可执行解析、git ref 列表呈现、git worktree 目录创建和移除、新增 root 聚焦的端到端可信度。 | 当前实现使用 VS Code `workspace.updateWorkspaceFolders(...)`、`git -C <root> worktree add -b <branch> <targetPath> [startPoint]` / `git -C <root> worktree add [--detach] <targetPath> <ref>` 和 `git -C <worktree> worktree remove <worktree>`，并在文档验证状态中明确真实宿主路径仍需人工验证；自动化已覆盖 workspace folder 行 action 只出现在 workspace-root 分组、worktree 专用图标和消息 payload 正确。 | 下一轮做 sidebar/worktree polish、创建 MR 前需要补真实演示证据，或收到 worktree 创建/移除失败反馈时，应在 `/tmp` 或 `.debug/` disposable repo 中跑 Extension Development Host 人工验证并回写设计文档。 | `extensions/vscode/dev-session-canvas/src/extension.ts`、`extensions/vscode/dev-session-canvas/src/sidebar/CanvasSidebarNodeListView.ts`、`scripts/test/test-sidebar-node-list.mjs`、`docs/design-docs/canvas-sidebar-node-and-session-lists.md`、`docs/exec-plans/completed/sidebar-workspace-worktree-actions.md` |
| 2026-06-11 | Claude Agent direct-spawn 架构不支持 shell job-control 恢复 | 用户真实验证推翻了 2026-06-10 的 Claude Code `Ctrl-Z` 挂起恢复假设：Claude 可能输出 suspend / `fg` 文案，但 Canvas 直接 spawn `claude`，没有外层交互 shell job table，因此页面仍可能继续生成、恢复后输入无效，或 UI 状态短暂抖动。 | Claude Agent 中使用 `Ctrl-Z` 的交互体验；如果继续伪装支持，会让用户进入不可解释的半挂起状态。 | 当前不再识别 Claude suspend 文案、不再提供前台 job-control 恢复按钮或协议；Webview、host 与 runtime supervisor 三层阻断 Claude Agent `Ctrl-Z`，并提示使用停止、会话恢复或分叉。`suspended` 只作为旧 snapshot 兼容状态。 | 只有当 Agent runtime 改为真正受 shell job-control 管理，或 provider 提供正式 machine-readable suspend/resume API 并完成真实端到端验证时，才重新设计该能力。 | `extensions/vscode/dev-session-canvas/src/webview/main.tsx`、`extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts`、`extensions/vscode/dev-session-canvas/src/supervisor/runtimeSupervisorMain.ts`、`docs/exec-plans/completed/claude-agent-ctrl-z-containment.md` |
| 2026-06-15 | Visual Studio Marketplace deferred channel 仍未公开可见 | `0.16.0` 已通过 GitHub Release assets + Open VSX verified 完成，GitHub Actions run `27533849564` 也验证了 Release 创建 / PATCH / upload、正式 tag 推送、最终 manifest / Release notes 覆盖、并行 marketplace job 合并以及 `publish/v0.16.0` 临时 tag 删除路径。但 Visual Studio Marketplace public gallery 对 `devsessioncanvas.dev-session-canvas` 与 `devsessioncanvas.dev-session-canvas-notifier` 仍返回 `extensions_len=0`、`TotalCount=0`，最终 manifest 把两个 VSM 目标记录为 `publish-failed` / deferred。 | 官方 VS Code 用户无法通过 VSM 安装或升级；对外文案不能宣称 VSM 路径已可用；同版本后续补发必须保持与 `v0.16.0` GitHub Release assets / manifest 对齐，不能重新打包覆盖已分发 VSIX。 | `0.16.1` 发布准备继续仅把 VSM 写为 deferred；用户安装路径依赖 Open VSX 兼容宿主或 GitHub Release assets 手动安装；workflow 完成门禁保持 GitHub Release assets uploaded + Open VSX main/notifier verified，VSM 不阻塞临时 tag 删除。 | 当 VSM publisher / public gallery 可见性问题解决后，优先对最新发布版本复用对应 GitHub Release assets / manifest，只运行 `--skip-package --target visual-studio --no-create-final-tag`；如果需补发历史 `0.16.0`，则重新创建 `publish/v0.16.0` 指向 `542d90cf6f7ce60e832f2ea1dc17fe0b71d2695c` 或用本地补发命令复用 `v0.16.0` Release assets。确认主扩展与 notifier 均可公开查询后，再更新 Release notes、README 和发布手册解除 deferred 口径。 | `.github/workflows/publish-marketplace-release.yml`、`scripts/release/publish-tag-release.mjs`、`scripts/release/write-github-release-notes.mjs`、`docs/public-preview-release-playbook.md`、`docs/notifier-preview-release-playbook.md`、`docs/exec-plans/completed/github-release-assets-flow.md` |
| 2026-06-07 | 模板市场完整 E2E fixture 与当前 API/UI 状态漂移 | 复审 `feat-template-marketplace-phase4-admin-stats` 时补跑 `npm run test:marketplace`，浏览器段在 `/templates/me` 触发 `GET /api/v1/me/stats`，但 `scripts/test/test-template-marketplace-publish-page.mjs` 只 mock 了 `/api/v1/me/templates`，请求被 Vite proxy 转到本机 `127.0.0.1:8787` 后失败并等待 `Signed in as codex-tester` 超时；补跑 `npm run test:marketplace-vscode-fixture-e2e` 时，VSCode fixture 仍期望列表行直接暴露安装主按钮，但当前 UI 在未选择安装位置时显示“请先选择位置”。当前管理员全站统计分支未改动这两个 E2E 脚本或 VSCode 安装侧代码。 | 完整 `npm run test:marketplace` 作为一键验收命令的可信度，以及后续协作者判断模板市场浏览器/VSCode fixture 是否覆盖当前真实 UI 的成本；不影响本轮 `GET /api/v1/admin/stats`、D1 聚合、Web API helper 与管理后台统计区的已覆盖主路径。 | 本轮以 `npm run test:marketplace-shared`、`npm run test:marketplace-api`、`npm run test:marketplace-web`、`npm run typecheck:marketplace`、`npm run build:marketplace` 和 `git diff --check` 作为管理员统计切片的收口证据；完整 E2E 失败原因单独记录，不写成已通过。 | 下一轮整理模板市场测试夹具、恢复 `npm run test:marketplace` 为合并前稳定命令，或继续实现 VSCode 安装侧更新/回滚时，应优先补齐 `/api/v1/me/stats` mock，并让 VSCode fixture 先选择安装位置或按当前“请先选择位置”状态更新断言。 | `scripts/test/test-template-marketplace-publish-page.mjs`、`tests/vscode-smoke/template-marketplace-tests.cjs`、`extensions/vscode/dev-session-canvas/src/panel/CanvasTemplateMarketplacePanel.ts`、`apps/template-marketplace/src/web/components/TemplateMyTemplatesView.tsx` |
| 2026-05-26 | 执行节点终端 attention 协议仍缺真实终端矩阵人工验收 | `execution-attention-indicator-and-acknowledgement` 已完成并归档，仓库内实现、VS Code 宿主自动化与 notifier companion 路径已闭环；但设计文档要求的 Ghostty / kitty / iTerm2 / tmux 中 `BEL`、`OSC 9`、`OSC 777` 实际透传与焦点策略人工验证仍未执行。 | 主要影响“provider 原生终端通知信号在不同真实终端里是否一定能触发”的支持强度；不影响主扩展对已进入 VS Code 输出流的信号解析、节点内 `attentionPending`、notifier companion 投递与 `0.10.6` Agent 异常中断兜底提醒。 | 当前发布口径继续把真实终端协议支持写成 best-effort，并优先依赖 VS Code 宿主自动化验证、notifier companion 真实桌面通知验收和 Agent 异常终态兜底提醒；设计文档 `validation_status` 保持“验证中”。 | 下一轮若要把终端原生通知兼容性从 best-effort 升级为更强支持承诺，或收到 Ghostty / kitty / iTerm2 / tmux 下通知缺失反馈时，应补真实矩阵人工验收并把结果回写到设计文档和支持边界。 | `docs/design-docs/execution-node-notification-and-attention-signals.md`、`docs/exec-plans/completed/execution-attention-indicator-and-acknowledgement.md`、`docs/product-specs/canvas-node-notifications.md` |
| 2026-05-24 | 模板市场发布写入 R2 成功但 D1 失败时可能留下 orphan object | 当前发布新模板和新版本的顺序是先写 R2 `template.json` / `thumbnail.png`，再写 D1 模板和版本记录；如果 R2 put 成功但 D1 唯一约束、写入失败或后续统计写入失败，R2 中会留下没有 D1 元数据引用的对象。 | 模板市场发布链路的存储清理和对象成本；不会让公开列表直接展示孤儿对象，但会影响长期存储一致性和排查成本。 | 本轮用 `versionId` 隔离版本对象并用 D1 作为公开索引权威；暂不实现失败补偿删除或对象生命周期清理。 | 下一轮收口发布事务可靠性、对象 GC、后台治理任务或引入 R2 conditional put / cleanup 队列时 | `apps/template-marketplace/src/worker/app.ts`、`apps/template-marketplace/src/worker/publish.ts`、`docs/exec-plans/active/template-marketplace-publishing.md` |
| 2026-05-13 | trusted smoke 中 VS Code 文件监听偶发触发 `EMFILE` | 本轮运行 `DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=trusted npm run test:smoke` 时，VS Code main process 日志多次出现 `base/files/file_path_watcher_inotify.cc` 与 `[File Watcher (node.js)] Failed to watch ... EMFILE: too many open files`。现场 `ulimit -n` 为 `1048576`，但 `/proc/sys/fs/inotify/max_user_instances` 只有 `128`，同时同一用户下存在多组 VS Code Server / extensionHost / runtime-supervisor 进程，因此更像是测试宿主 inotify instance / watcher 配额耗尽，而不是本轮 Note Markdown 代码泄漏文件句柄。 | PR 级 smoke 日志噪音、文件监听实时性和后续协作者判断失败根因的成本；极端情况下可能让 VS Code 内部 watcher 退化到 polling 或延迟刷新。 | 当前 trusted smoke 已通过，不把这条日志视为本轮功能 blocker；关联 Markdown 文件监听代码本身保留 `fs.watchFile` / refresh fallback，smoke 中也避免把配置刷新完全绑定到文件 watcher。 | 下一轮整理 smoke 环境稳定性、CI 化 trusted smoke，或再次遇到 watcher 相关 flaky 时，应优先提高 `fs.inotify.max_user_instances`、给 smoke user settings 增加 `.debug/**` / `.vscode-test/**` / `node_modules/**` 的 `files.watcherExclude`，并清理残留 VS Code Server / runtime 进程；如仍影响产品路径，再为扩展侧 watcher fallback 增加诊断计数。 | `scripts/smoke/run-vscode-smoke.mjs`、`tests/vscode-smoke/extension-tests.cjs`、`extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts`、`extensions/vscode/dev-session-canvas/src/panel/agentFileActivity.ts`、`docs/exec-plans/tech-debt-tracker.md` |
| 2026-05-08 | Windows shell env 继承已落地，但少量更少见的 Windows POSIX family shell 仍缺真实 smoke 覆盖 | 本轮已经把 Windows 的 `Agent` execution env 补齐到“Extension Host 基线环境 + 当前 Terminal shell 导出的受控 shell env patch”，并把 Windows `Terminal` launch 收口为保留 base env、让真实 shell 自己执行 profile / AutoRun 一次；同时已在真实 Windows 上跑通 `test:agent-cli-resolver` 与扩充后的 `test:smoke:windows-real-codex`。当前 smoke 已覆盖默认 `codex`、显式 `codex.cmd`、`powershell`、`cmd`、Git Bash、MSYS2 `bash` 与 MSYS2 `sh`；剩余缺口主要是更少见的 Windows POSIX family shell 名称，例如 `zsh`、`fish`，或用户通过显式 `shellPath` 接入的非常规 shell。 | 在 Windows 上把 `zsh`、`fish` 或其他非常规 POSIX family shell 作为默认/配置 Terminal shell 的少量用户；主要影响 shell profile 导出的工具链变量、路径转换与 shim 解释器发现。 | 当前实现已支持 Windows 下名称可判定为 `bash` / `zsh` / `sh` / `fish` 的 shell 复用 POSIX 登录 shell 解析，并在 host diagnostics 中记录 shell path / source / `shellFamily` / applied keys；相对 `terminal.shellPath` 的配置检查与 env probe 也已共享 workspace `cwd` 基准。文档口径只把当前已验证的 PowerShell / `cmd.exe` / Git Bash / MSYS2 / 真实 Codex 路线写成有证据覆盖。 | 下一轮若继续扩充 Windows shell 选择能力、收到 Windows `zsh`/`fish` 或其他非常规 shell 的真实反馈，或准备把这条能力从“验证中”升级为更强承诺时，应优先补齐真实 smoke。 | `extensions/vscode/dev-session-canvas/src/panel/shellEnvironmentResolver.ts`、`extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts`、`tests/vscode-smoke/windows-real-codex-smoke.cjs`、`docs/design-docs/agent-cli-launch-context-and-resume.md`、`docs/design-docs/execution-session-platform-compatibility.md`、`docs/exec-plans/active/agent-shell-environment-inheritance.md` |
| 2026-04-28 | Windows 下 `Codex` 执行节点历史当前仍无法向上翻页 | 本轮 `0.3.0` 已完成 Linux、macOS、Windows 本地主路径的功能可用性验证，但 Windows 本地使用 `Codex` 时，执行节点内终端历史仍存在无法向上翻页的已知问题。因此本轮只把 Windows 升级为“已验证可用（含已知限制）”，不把滚动体验写成已完全收口。 | Windows 本地 `Codex` 会话的长历史浏览体验，尤其影响在 `Agent` 或 `Terminal` 节点里查看更早输出时的可用性。 | 当前在 `CHANGELOG.md`、README、Marketplace listing、发布手册和设计文档中显式把它列为 `0.3.0` 已知限制；本轮继续按“功能可用但留有交互缺口”的口径发布，不以此阻塞版本。 | 下一轮若继续收口 Windows 执行节点滚动 / paging 行为，或拿到更具体的复现与宿主侧根因证据时，应优先定位并修复。 | `CHANGELOG.md`、`README.marketplace.md`、`docs/public-preview-release-playbook.md`、`docs/design-docs/execution-session-platform-compatibility.md`、`docs/design-docs/embedded-terminal-runtime-window.md` |
| 2026-04-28 | 侧栏会话历史当前仍依赖 provider 私有 session 文件格式 | 本轮已实现 `节点` 与 `会话历史` sidebar section，并通过只读扫描 `~/.codex/sessions/.../rollout-*.jsonl` 与 `~/.claude/projects/**/*.jsonl` 闭合当前 workspace 历史恢复主路径；但这两条读取路径都不是扩展可控的正式 API。针对 `Claude Code`，当前已收口为“只信 transcript 内显式 `cwd`，缺失时直接 fail closed”，因此不再泄漏冲突 workspace，会话覆盖面则受 provider 落盘格式约束。 | `会话历史` 列表对未来 provider 本地落盘格式漂移的兼容性，以及缺少 `cwd` 的 Claude transcript 在多子目录 workspace 下的覆盖面。 | 当前实现只做只读扫描，并在无法确认 `cwd` / `sessionId` 时 fail closed；自动化验证只把当前已确认格式与 workspace 过滤逻辑写成已覆盖，不把 provider 私有文件格式稳定性写成已承诺能力。 | 后续如果 Codex / Claude Code 提供正式的 history/session API，或仓库继续增强跨 workspace / 深层目录历史能力时，应优先移除这段私有文件扫描依赖。 | `extensions/vscode/dev-session-canvas/src/common/agentSessionHistory.ts`、`extensions/vscode/dev-session-canvas/src/sidebar/CanvasSidebarSessionHistoryView.ts`、`scripts/test/test-sidebar-session-history.mjs`、`docs/design-docs/canvas-sidebar-node-and-session-lists.md`、`docs/exec-plans/completed/canvas-sidebar-node-and-session-lists.md` |
| 2026-04-28 | Windows PATH 前置裸 `codex` 仍可能遮蔽后置 `codex.cmd` | 本轮 Windows CLI 解析修复后，review 继续指出一个未复现到主路径的边界：如果 `PATH` 前置目录只含无扩展名 `codex`，后置目录才含可直接执行的 `codex.cmd`，`agentCliResolver` 现有遍历顺序仍可能优先命中前一个裸路径。当前常见 npm 全局安装布局、现有回归和 `npm run test:smoke:windows-real-codex` 均未复现该问题，因此不作为当前 MR blocker。 | 少量非常规 Windows `PATH` 布局下的 `Codex` 命令解析稳定性，主要影响 `Agent` 节点自动发现 CLI 时是否会选到不可直接执行的裸路径。 | 当前保留已有修复与回归覆盖，并以常见 npm 全局安装布局、`node scripts/test/test-agent-cli-resolver.mjs`、`node scripts/test/test-execution-session-bridge.mjs`、`node scripts/test/test-package-vsix-command.mjs` 和 `npm run test:smoke:windows-real-codex` 通过作为本轮闭环证据；不把该边界场景写成已解决。 | 下一轮若继续调整 Windows 命令解析优先级、扩充 `agentCliResolver` 边界回归，或收到真实用户环境复现时，应优先收口这条 `PATH` 前置裸命令遮蔽后置 `.cmd` 的解析顺序问题。 | `extensions/vscode/dev-session-canvas/src/panel/agentCliResolver.ts`、`scripts/test/test-agent-cli-resolver.mjs`、`tests/vscode-smoke/windows-real-codex-smoke.cjs`、`docs/exec-plans/tech-debt-tracker.md` |
| 2026-04-21 | VS Code 参考副本的第三方许可说明仍未显式收口 | 本轮为修复 PR #16 的本地坏链，保留了 `docs/references/vscode-official-extension-docs/api/references/generated/vscode.d.ts` 等上游参考文件；review 同时指出该文件头注仍引用上游项目根目录的 `License.txt`，但当前仓库未同步纳入对应许可说明。 | 后续协作者理解 `docs/references/` 第三方参考副本的来源与许可边界时的判断成本，尤其影响继续扩大本地参考副本范围时的合规可追溯性。 | 当前仅在 `docs/references/vscode-official-extension-docs/README.md` 中记录来源仓库与提交哈希，并把这批内容明确标记为外部参考；暂不把更具体的第三方许可收口写成已完成。 | 下一轮如果继续扩充 `docs/references/vscode-official-extension-docs/`，或准备把这批第三方参考作为长期保留资产维护时，应优先补齐明确的来源/许可说明。 | `docs/references/vscode-official-extension-docs/README.md`、`docs/references/vscode-official-extension-docs/api/references/generated/vscode.d.ts`、`docs/exec-plans/tech-debt-tracker.md` |
| 2026-04-20 | 文件活动视图尚未真正复用 VSCode File Icon Theme | review 收口确认当前文件节点 / 文件列表条目只实现了少量常见扩展名到固定 `codicon` 的映射，尚未落地读取当前 icon theme contribution 与主题 JSON 的宿主解析层；如果继续沿用“已复用当前 File Icon Theme”的口径，会和仓库事实冲突。 | 文件活动视图里的文件图标准确性，尤其影响自定义 File Icon Theme、字体图标主题与细粒度文件名 / 扩展名图标映射场景。 | 当前文档已显式改回真实口径：只承诺“有限扩展名 `codicon` 映射 + 通用文件图标回退”，不再把完整 theme parity 写成已实现。 | 后续若继续提升文件活动视图的 VSCode 原生感，或准备把文件图标能力从“验证中”升级为正式承诺时，优先补齐 icon theme 解析层。 | `extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts`、`docs/product-specs/canvas-graph-links-and-file-activity.md`、`docs/design-docs/canvas-file-activity-view.md`、`docs/exec-plans/active/canvas-graph-links-and-file-activity.md` |
| 2026-04-19 | 历史已选定设计文档尚未迁移到 `正式方案` 结构 | 本轮更新了 `docs/DESIGN.md` 与设计文档模板，明确新写或本次改动到的 `decision_status: 已选定` 文档应使用 `正式方案` 章节收口，并在方案说明中按需体现结构化细节；但仓库里已有的历史 `已选定` 文档大多仍沿用 `当前结论` 结构，未在同一轮完成批量迁移。 | `docs/design-docs/` 下历史 `已选定` 文档的结构一致性，以及协作者判断“哪些文档已经按新规范收口、哪些仍处于待迁移状态”的成本。 | 当前采用显式过渡规则：只强制新写或本次改动到的 `已选定` 文档使用 `正式方案` 章节；未改动的历史文档继续保留现状，但统一视为待迁移技术债，而不是已完成规范收口。 | 后续当某份历史 `已选定` 设计文档再次被修改时，优先顺手迁移到新结构；若后续安排专门的文档治理轮，也可集中完成批量迁移。 | `docs/DESIGN.md`、`docs/design-docs/template-design-doc.md`、`docs/design-docs/index.md` |
| 2026-04-18 | 节点标题连续提交仍可能被乱序宿主回写短暂覆盖 | 本轮为修复“Enter 提交后旧值回灌”和“IME 确认 Enter 重复显示”，在 `ChromeTitleEditor` 里引入了单值 `pendingTitleRef`。这已经覆盖单次 in-flight 提交，但如果宿主 `host/stateUpdated` 明显慢于用户连续两次改名，前一次较旧的宿主回写仍可能在后一条提交确认前短暂把输入框显示拉回旧标题。 | `Agent` / `Terminal` / `Note` 标题输入框在高延迟宿主回写下的显示连续性，尤其影响连续两次快速改名时的 UI 稳定感知。 | 当前实现只承诺单次 pending 提交不会被本地 `blur` / Enter 提交流程立刻重置回旧值，并通过 Playwright 回归覆盖普通 Enter 与 IME 确认 Enter；暂不把“多次连续提交下的乱序宿主回写隔离”写成已解决。 | 下一轮如果继续收口标题编辑鲁棒性，或宿主状态回写链路出现更高延迟、需要支持多次并发标题提交时，应把 pending title 从单值 ref 升级为带序号的 in-flight 提交队列或版本戳。 | `extensions/vscode/dev-session-canvas/src/webview/main.tsx`、`tests/playwright/webview-harness.spec.mjs`、`docs/design-docs/note-only-auxiliary-node-and-theme-alignment.md` |
| 2026-04-18 | 执行节点 file-like link refine 仍有少量前后文误并入 | 本轮已经收窄 `search` fallback，避免把普通 token 都注册成 `Search workspace` link，并补了中文前缀与中式标点的裁剪；但人工验证仍确认，少量“说明文字紧贴路径”的终端输出会把前缀或后缀文本一起吞进 file-like candidate，最终以 `search` link 形态暴露出来。 | `Terminal` / `Agent` 节点里少量复杂终端输出的文件路径识别准确率，尤其影响中文 prose、长路径、缺分隔符或路径前后直接粘连自然语言的场景。 | 当前实现已经把误报范围收敛到“少量 file-like candidate refine 误判”，并通过 Webview 回归覆盖“普通词条不再被注册成 link”“中文前缀裁剪”和“不存在路径走 Quick Access search”；仓库明确不把 file detection coverage 写成与原生 Terminal 完全等价。 | 下一轮若继续收口 execution link parity，或需要引入更强的终端上下文/分词线索、对照更多 VSCode Terminal 边界样例时 | `extensions/vscode/dev-session-canvas/src/common/executionTerminalLinks.ts`、`extensions/vscode/dev-session-canvas/src/webview/executionTerminalNativeInteractions.ts`、`tests/playwright/webview-harness.spec.mjs`、`docs/design-docs/execution-node-terminal-native-interactions.md` |
| 2026-04-17 | 沙箱环境下 Node 子进程会污染发布校验链路 | 在当前 Codex 沙箱里，shell 直接执行 `git` 正常，但 Node 侧 `child_process.spawnSync('git', ...)` 会出现“`status = 0` 且命令实际成功，同时附带 `error.code = 'EPERM'`”的返回形态；同类沙箱限制也可能让 `vsce` 内部通过 Node `exec("npm list ...")` 获取依赖清单时返回空输出。 | 沙箱内通过 Node 调 git 或让 `vsce` 递归扫描 npm dependencies 的发布校验脚本；可能把已经成功的 git 校验误判成失败，或让 `vsce` 误报 README 缺失。 | 当前 `scripts/release/package-vsix.mjs` 与 `scripts/release/run-clean-checkout-vsix-validation.mjs` 已对 `status=0` 的 git 结果容忍伴随的 `EPERM`，`scripts/release/package-vsix.mjs` / `scripts/release/publish-marketplaces.mjs` 也会清理 `ELECTRON_RUN_AS_NODE` 与 `VSCODE_*` 子进程环境；但 `vsce` 内部 npm dependency scan 在 Codex 沙箱内仍可能受限。发布前与实际发布仍统一在非沙箱环境执行 `npm run package:vsix` 和 `node scripts/release/run-clean-checkout-vsix-validation.mjs --ref <final-ref>`，并以非沙箱验证结果为准。 | 后续如果要让完整 VSIX 打包在 Codex 沙箱内稳定通过，应优先绕过或替换 `vsce` 内部的 npm dependency scan，或提供受控的沙箱外 release validation runner。 | `scripts/release/package-vsix.mjs`、`scripts/release/publish-marketplaces.mjs`、`scripts/release/run-clean-checkout-vsix-validation.mjs`、`docs/public-preview-release-playbook.md` |
| 2026-04-15 | serialized terminal snapshot 在尺寸漂移下仍缺无损重绘语义 | 本轮已经用 serialized terminal state 取代 raw tail replay，并修复了 Editor / Panel 标签切换与 Webview 重建后的终端空白；但验证中也确认，xterm 对 alternate-buffer snapshot 做 hydrate 后如果立刻按更小容器 destructive `fit()`，会裁掉顶部行。保活切回路径上的无条件 `fit()` 也会把 retain 下的现存 viewport 改写成更少行数，因此当前实现已经把 visibility restore 收口为 non-destructive redraw。 | 当节点尺寸、字体度量或宿主 CSS 变化导致“当前容器尺寸”和“snapshot 记录尺寸”不一致时，Webview 重建后的排版精度与用户手动滚动 viewport 的精确保真。 | 当前把同一宿主标签切换主路径交给 `retainContextWhenHidden` + visibility restore 的 non-destructive redraw，把重建路径交给 serialized terminal state hydrate；不把“任意尺寸漂移下的无损重绘”写成已解决。 | 下一轮如果要继续收口 Webview 重建语义、支持更强的 scrollback / viewport 恢复，或升级 xterm 恢复能力时 | `extensions/vscode/dev-session-canvas/src/common/serializedTerminalState.ts`、`extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts`、`extensions/vscode/dev-session-canvas/src/supervisor/runtimeSupervisorMain.ts`、`extensions/vscode/dev-session-canvas/src/webview/main.tsx`、`tests/playwright/webview-harness.spec.mjs`、`docs/design-docs/embedded-terminal-runtime-window.md`、`docs/exec-plans/active/runtime-terminal-state-restore.md` |
| 2026-04-15 | Marketplace README 真实宿主素材导出当前仍依赖 Linux X11 工具链 | 为了把正式 `PNG` / `MP4` / `GIF` 收口到真实 VS Code 宿主窗口，本轮脚本使用 `@vscode/test-electron` + `Xvfb` + `xwininfo` + `ffmpeg` 在 Linux/X11 环境下自动抓帧。这样可以保证最终画面来自真实宿主，但也把素材导出与特定桌面工具链绑定在一起。 | 跨平台可移植性和未来 CI 化能力，尤其影响 macOS / Windows 环境是否能直接重跑同一条素材导出命令。 | 当前把 `npm run generate:marketplace-media` 定位为维护者脚本，优先保证 Linux 无头环境可重复导出；不把它写成跨平台、零依赖能力。 | 未来如果要把素材导出接入 CI，或要求 macOS / Windows 协作者也能直接生成 Marketplace 物料时 | `scripts/media/generate-marketplace-media.mjs`、`scripts/smoke/vscode-smoke-runner.mjs`、`tests/vscode-smoke/marketplace-media-tests.cjs`、`docs/design-docs/marketplace-readme-media-automation.md`、`docs/exec-plans/completed/marketplace-real-vscode-media-automation.md` |
| 2026-04-14 | Linux / `Remote SSH` 的 `systemd-user` 主路径仍缺真实长断开人工验收 | 本轮已经用 `fake-systemd` reopen smoke、本机 `systemd-user-real-reopen` / `systemd-fallback-real-reopen` 场景与 backend / guarantee 断言闭合主实现，但还没有在真实 Linux + `Remote SSH` 环境中做“断开数分钟后再回来”的人工验收。 | `systemd-user` 路线何时可以从“验证中”升级为“已验证”的发布口径，尤其影响 Preview 阶段对强保证 `live-runtime` 的人工信心。 | 当前继续把设计文档标为 `验证中`，不把 Linux / `Remote SSH` 下的强保证写成已验证；PR 级别仍以本地 reopen smoke 与短链路证据为准。 | 下一轮准备把 Linux / `Remote SSH` 的 `live-runtime` 口径升级为“已验证”，或需要做 Preview 阶段真实长断开验收时 | `scripts/smoke/run-vscode-smoke.mjs`、`tests/vscode-smoke/real-reopen-tests.cjs`、`docs/design-docs/runtime-persistence-and-session-supervisor.md`、`docs/exec-plans/completed/runtime-host-backend-systemd-user.md` |
| 2026-04-14 | macOS `live-runtime` 仍缺 `launchd` 正式 backend | 本轮按设计决策先把 Linux / `Remote SSH` 的正式主路径收口到 `systemd-user`，macOS 仍停留在 `legacy-detached` fallback，没有等价的用户服务层 backend。 | macOS 上关闭 VS Code 后继续持有真实 `Agent` / `Terminal` 会话的可信度，以及后续三平台 runtime persistence 口径的一致性。 | 当前文档明确把 macOS 记为 fallback / `best-effort`，不对其宣称强保证 `live-runtime`。 | 下一轮需要补 macOS 正式 backend，或准备做三平台发布口径收口时 | `extensions/vscode/dev-session-canvas/src/panel/runtimeHostBackend.ts`、`docs/design-docs/runtime-persistence-and-session-supervisor.md`、`docs/exec-plans/completed/runtime-host-backend-systemd-user.md` |
| 2026-04-13 | Agent 运行态判定仍缺 provider 原生权威事件与来源标注 | 本轮已把 CLI PTY 路径上的 `running / waiting-input` 误判从固定静默时间升级为组合启发式，并统一到 local PTY 与 runtime supervisor；但当前仍未接入 `Codex app-server`、`Claude Code` hooks/SDK/headless 等 provider 原生结构化事件，也还没有把节点状态来源和权威性写入 metadata。 | `Agent` 状态对外语义的可解释性与长期稳定性，尤其影响等待审批、provider UI 版本变化、结构化 sidecar 可用后与 PTY fallback 的优先级切换，以及 UI/诊断区分“权威事件”与“best-effort 推断”的能力。 | 当前保留 CLI PTY 为主执行通道，只在真实提交后进入 `running`，并综合 prompt、`OSC 9/777`、bell、行边界、spinner/redraw 与 hard fallback 判断回到 `waiting-input`；设计文档和 ExecPlan 已明确把这条路线标记为 fallback，而不是正式权威状态机。 | 下一轮准备接入 `app-server` / provider 原生结构化事件，或需要在 UI/诊断中展示状态来源与权威性时，应优先落这项技术债。 | `extensions/vscode/dev-session-canvas/src/common/agentActivityHeuristics.ts`、`extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts`、`extensions/vscode/dev-session-canvas/src/supervisor/runtimeSupervisorMain.ts`、`docs/design-docs/agent-running-state-detection.md`、`docs/exec-plans/completed/agent-running-state-detection.md` |
| 2026-04-12 | Codex fresh start session id 当前仍依赖启发式反查 | `Codex` 当前缺少可确认的标准 machine-readable session-id 获取接口；为避免继续使用 `resume --last`，本轮临时参考 OpenCove 的总体思路，在 fresh start 后扫描 `~/.codex/sessions/.../rollout-*.jsonl`，按 `cwd + 启动时间窗 + 候选唯一` 回填 session id。 | `Codex` 自动恢复能力的稳定性与可解释性，尤其影响跨版本兼容、私有状态格式漂移、时间窗歧义和真实节点身份绑定可信度。 | 当前显式把这条路线标记为技术债务 fallback，不当成正式 capability；实现上只要 miss、歧义或超时就 fail closed，不升级成 `resume-ready`，并保留 `codex resume <session-id>` 作为唯一正式恢复入口。 | OpenAI Codex CLI 提供标准 session-id 读取/注入接口后，或准备做真实 provider 恢复能力收口前，应优先移除这段启发式反查并改成正式接口。 | `extensions/vscode/dev-session-canvas/src/common/codexSessionIdLocator.ts`、`extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts`、`extensions/vscode/dev-session-canvas/src/supervisor/runtimeSupervisorMain.ts`、`docs/design-docs/agent-cli-launch-context-and-resume.md`、`docs/exec-plans/completed/agent-cli-launch-context-and-resume.md` |
| 2026-04-12 | 执行节点缩放命中修复当前依赖 `xterm.js` 私有内部接口 | 为在“终端仍随 React Flow 缩放”的产品定义下修复鼠标命中错位，本轮直接补到了 `MouseService`、`SelectionService` 和 textarea 定位相关的内部实现；这些入口不属于稳定公开 API。 | 后续升级 `@xterm/xterm` 时的兼容性，尤其影响拖选、越界滚动、右键定位与可能共用同一内部路径的鼠标上报行为 | 当前通过 Playwright harness 和真实宿主人工验证把缩放拖选、越界滚动边界与右键 textarea 定位都纳入回归，并把依赖路径显式记录在设计文档与完成计划中 | 下一轮升级 `@xterm/xterm`、整理共享适配层，或准备做更深的执行节点交互收口时 | `extensions/vscode/dev-session-canvas/src/webview/main.tsx`、`tests/playwright/webview-harness.spec.mjs`、`docs/design-docs/execution-node-zoom-interaction-surface.md`、`docs/exec-plans/completed/execution-node-zoom-coordinate-alignment.md` |
| 2026-04-11 | Remote SSH 长断开仍缺 nightly / self-hosted 自动化回归 | 当前仓库已经补上 `systemd-user` backend、`fake-systemd` 本地 reopen smoke 和 backend / guarantee 断言，可以稳定覆盖“backend 选择是否正确”和“本地窗口重开后是否仍附着原会话”；但真正的 Remote SSH 长断开仍依赖远端 VS Code Server 生命周期、SSH 断链时长和 `systemd --user` 环境，普通 PR runner 不适合承担这条验证。 | Linux + Remote SSH 下“长时间断开后仍稳定 reattach”的对外可信度，尤其是用户关心的数分钟到更长时长断链场景 | 当前把这条验证明确留在技术债里，不再要求每个 PR 依赖人工断开回归；PR 层先跑本地 `fake-systemd` reopen smoke 与 fallback 验证，真实 Remote SSH 长断开留给后续 nightly / self-hosted。 | 下一轮补自托管 Linux runner 或受控 Remote SSH fixture，并把 `remote-ssh-real-reopen` 扩成可配置长断开时长的 nightly 任务时 | `scripts/smoke/run-vscode-smoke.mjs`、`scripts/smoke/vscode-remote-ssh-fixture.mjs`、`tests/vscode-smoke/real-reopen-tests.cjs`、`docs/design-docs/runtime-persistence-and-session-supervisor.md`、`docs/exec-plans/completed/runtime-host-backend-systemd-user.md` |
| 2026-04-08 | 真实 provider CLI 的 resume 主路径仍缺 end-to-end 本机验证 | 本轮已完成 `Agent` / `Terminal` 差异化生命周期、创建即自动启动和 `Agent` best-effort resume；自动化验证通过 fake-provider、smoke 与 Playwright 覆盖了状态流，但当前环境没有可直接验证的 `codex` 二进制，`Claude Code` 也只确认了 CLI 参数形态，没有在 smoke 里跑真实恢复。 | `Agent` 恢复能力对真实 `Codex` / `Claude Code` provider 的对外可信度，尤其是扩展重载后的恢复声明 | 当前把真实 provider 恢复明确写成 best-effort；自动化验证只把 fake-provider 恢复主路径、协议状态流和缺命令失败提示写成已覆盖，不把真实 provider end-to-end 写成已验证。 | 下一轮拿到真实 `Codex` / `Claude Code` 可执行环境，或准备发布前做 provider 级人工 / 自动化验收时 | `extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts`、`tests/vscode-smoke/fixtures/fake-agent-provider`、`tests/vscode-smoke/extension-tests.cjs`、`docs/design-docs/execution-lifecycle-and-recovery.md`、`docs/exec-plans/completed/execution-lifecycle-recovery-and-autostart.md` |
| 2026-04-06 | Linux `VSIX` smoke 当前只验证“打包内容完整性”，还不是完整安装态 | 为了先把打包产物是否可启动这条验证链落地，本轮的 `test:vsix-smoke` 采用“生成 VSIX -> 解包 -> 用解包产物跑 trusted smoke”的方式；它验证的是打包文件集是否齐全，而不是 `code --install-extension` 后的完整安装态。 | 发布工件验证的覆盖面，尤其是 VS Code 扩展安装流程、升级覆盖与安装后元数据行为 | 当前明确把它写成 packaged-payload smoke，不把这条验证包装成完整安装矩阵。 | 下一轮如果要在发布前收口真实安装态验证时 | `scripts/smoke/run-vscode-vsix-smoke.mjs`、`scripts/release/package-vsix.mjs`、`CONTRIBUTING.md`、`docs/design-docs/development-debug-automation.md` |
| 2026-04-06 | 自动化验证矩阵当前仍主要停留在 Linux，`0.3.0` 只补齐了三平台人工验证 | 本轮 `0.3.0` 已把 Linux、macOS、Windows 本地主路径的功能可用性人工验证补齐，但自动化主矩阵仍主要集中在 Linux 上的 trusted / restricted smoke、Playwright UI 回归和 packaged-payload smoke。 | 后续把三平台“已验证可用”进一步升级成更强可重复证据时的可信度，尤其影响 macOS / Windows 上的 PTY、Webview 容器行为和 VSIX 安装态。 | 当前对外口径把桌面三平台写成“已验证可用”，但自动化层不把 Linux 结果包装成全平台等价结论；macOS / Windows 继续依赖本轮人工验证与已记录的已知限制。 | 准备公开 GitHub 发布前，或需要把三平台支持从“人工验证可用”升级成更强自动化保障时。 | `tests/vscode-smoke/extension-tests.cjs`、`scripts/smoke/run-vscode-smoke.mjs`、`scripts/smoke/run-vscode-vsix-smoke.mjs`、`docs/design-docs/development-debug-automation.md` |
| 2026-04-06 | Remote-SSH 下的 debug profile 首次仍需本机人工准备 | 按 VS Code 官方设计，Remote 扩展调试应使用预装了 Remote Development 扩展的命名 profile；但当前仓库运行在远端，无法直接替用户修改本机 VS Code profile。 | 新机器或新环境第一次做 F5 调试时的初始化成本 | 当前在 `CONTRIBUTING.md` 中明确提供本机 CLI / GUI 的一次性准备步骤，并把 `Dev Session Canvas` 不应安装到 debug profile 写成显式约束。 | 如果后续找到稳定、官方支持的本机 profile 导入或预配链路时 | `CONTRIBUTING.md`、`.vscode/launch.json`、`docs/design-docs/development-debug-automation.md`、`docs/exec-plans/completed/extension-debug-automation.md` |
| 2026-04-06 | Webview UI 回归仍主要运行在浏览器 harness，真实容器覆盖面偏窄 | 为了把第三层先往真实 VS Code Webview 容器下压一格，本轮已经在 `@vscode/test-electron` smoke 中加入 test-only DOM probe；后续又补了真实容器里的 Note 编辑、provider 切换后重启、删除按钮，以及 pending request / stop 竞态 fault injection，但大多数 UI 回归仍由浏览器 harness 承担，而不是真实容器里的端到端交互。 | Webview UI 对真实容器特性的依赖，例如 CSP、容器级样式差异、真实宿主注入环境、指针命中细节与少量可访问性行为 | 当前用真实宿主 smoke 中的 probe 与 DOM action 覆盖节点渲染、Task/Note 写路径、provider 切换、删除按钮和两条生命周期 fault injection，并让 Playwright harness 继续承担截图基线、更多细粒度 UI 交互和页面级失败诊断；不把这套组合写成“已完全等价于真实容器 UI 自动化”。 | 下一轮如果要覆盖更深的 Webview 容器差异、复杂指针交互或发布前做 UI 风险收口时 | `extensions/vscode/dev-session-canvas/src/common/protocol.ts`、`extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts`、`extensions/vscode/dev-session-canvas/src/webview/main.tsx`、`tests/playwright/harness/webview-harness.html`、`tests/playwright/webview-harness.spec.mjs`、`tests/vscode-smoke/extension-tests.cjs`、`docs/design-docs/development-debug-automation.md`、`docs/exec-plans/completed/test-automation-hardening.md` |
| 2026-03-30（2026-07-13 扩充） | 新建节点避碰当前依赖默认窗口尺寸估算 | 为先修复“新增节点初始重叠”的真实反馈，宿主使用各 kind 的默认 footprint 做候选碰撞判断。PR #261 抽取了共享碰撞几何，但 review 进一步确认自动文件节点仍由 `resolveAutomaticArtifactPosition()` 按 `estimatedCanvasNodeFootprint('file')` 的 220 x 84 选位，随后 `resolveAutomaticFileNodeSize()` 才根据 minimal 显示模式和路径文本确定真实初始尺寸；默认 `icon-path` 宽度最高可到 480。 | 新建节点默认摆放的精确性，尤其影响长路径的自动 minimal File 节点：候选按 220 宽度通过后，真实物化外框仍可能覆盖邻近已有节点；后续节点样式、字段密度或默认尺寸变化也有同类风险。 | 当前 Webview 提供视口锚点，宿主统一使用共享 rectangle / padding predicate；已有节点使用持久化 size，普通创建和 Fork 的默认 footprint 与物化尺寸一致。自动文件节点只承诺基于 220 x 84 估算的 best-effort 避碰，不把共享 predicate 写成真实初始外框的完整无重叠保证。 | 下一轮收口自动文件节点尺寸模型、再次修改 minimal File 显示宽度，或准备把生成节点不重叠从 best-effort 升级为完整验收承诺时；优先让选位 API 接受 `estimateAutomaticFileNodeFootprint()` 的显式结果，再物化同一 size 并补长路径 fixture。 | `extensions/vscode/dev-session-canvas/src/common/protocol.ts`、`extensions/vscode/dev-session-canvas/src/common/canvasNodePlacement.ts`、`extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts`、`extensions/vscode/dev-session-canvas/src/webview/fileNoteNodes.tsx`、`docs/design-docs/canvas-feedback-polish.md`、`docs/design-docs/canvas-fork-placement-and-generated-node-collision.md`、`docs/exec-plans/active/canvas-fork-placement-and-generated-node-collision.md`、`docs/exec-plans/completed/canvas-feedback-polish.md` |
| 2026-03-30 | 节点删除当前不支持确认或撤销 | 为先闭合四类节点的最小删除主路径，本轮直接提供节点头部删除按钮和键盘删除，但没有确认弹窗、撤销栈或回收站。 | 误删节点后的恢复体验，尤其影响包含正文的 `Task` / `Note` 和运行中的执行型节点 | 当前通过显式选中态、输入焦点保护、危险态按钮样式和单节点删除范围降低误触风险，不把确认/撤销写成已支持。 | 下一轮画布交互增强或对象历史能力设计时 | `extensions/vscode/dev-session-canvas/src/webview/main.tsx`、`extensions/vscode/dev-session-canvas/src/webview/styles.css`、`docs/design-docs/canvas-node-deletion.md` |

## snapshot-only 手动恢复收口与后续 surface 验收（2026-10-10，PR #314）

Host reload 把活动 Agent 保存成 stopped 的缺陷已修复：原最终保存区分 Host 中断、用户停止和已观测自然退出，有可信身份为 resume-ready，无身份/Terminal 为 interrupted；重读清理自动 resume 意图，等待用户手动恢复。新增 24 项、完整 Host 478/478 与相关检查通过。最终默认真实 VSIX 的独立手动恢复阶段和 trusted 原恢复阶段两处通过，原状态阻塞已闭环；规格、设计及证据见 `docs/product-specs/runtime-persistence-modes.md`、`docs/design-docs/smoke-reload-autostart-investigation.md`、`docs/references/smoke-reload-autostart/manual-reload-recovery-evidence.json`。

下一项发布阻塞为 `verifyLiveSessionCutoverAndReload:8965`：相同 Terminal executionId 的真实输出 sequence 2 与 snapshot sequence 3 已含 `LIVE_CUTOVER_EDITOR`，但断言仍等待历史 metadata.recentOutput；需按原执行输出和页面切换生命周期校准该测试。尚未执行后续 surface/Runtime/压力断言，不能视为这些功能已通过。首轮缺失文件链接 DOM 检测失败工件保留在 `.debug/manual-reload-recovery/first-artifacts`，最终一轮通过该点不追认其原因；此前 early final-save pending 工件和待定位状态也保留。


2026-10-10 继续处理 surface 断言：`verifyLiveSessionCutoverAndReload` 的 editor/panel/同 Host 重读/editor 四处等待已迁移到原 executionId/generation 的实时通道，并校验切换后目标页面当前生命周期快照、既有正文与新输出可见性。前置 Terminal 先停止并结清，最终停止状态/历史输出仍严格检查；新增默认 `local-surface-cutover` 具名阶段。正文 helper 14/14、reset fixture 19/19、runner 环境清理/语法与 VSIX 打包通过；默认独立 surface 阶段和 trusted 原顺序两处通过，surface 旧字段阻塞已收口。证据见 `docs/references/smoke-reload-autostart/surface-cutover-output-evidence.json`。


下一项发布阻塞：`verifyPtyRobustness:9061` 仍从历史 metadata.recentOutput 等待 `[fake-agent] burst 080`。当前 Agent 为 waiting-input/live，原 executionId 的实时输出已包含该行，历史字段仍是此前手动恢复执行的摘要。需继续校准该 PTY 用例；其后续退出/停止及压力、Runtime 检查尚未通过。此前独立文件链接 DOM 与 early final-save pending 工件仍保留，未追认根因。


2026-10-10 PTY 旧字段断言继续修复：稳健性的 burst/并行输出和紧接着双终端 flood 的 Agent/Ctrl-C 输出已按原执行通道校验；补齐 started 和原最终保存/退休等待，保留退出码、主动停止、并行快照、高输出下 Note 选择/新节点/输入/清理要求。独立默认 `local-pty-robustness` 与 trusted 原顺序的稳健性/flood 两部分各通过两处，原 PTY 断言阻塞收口；正文 helper 14/14、reset fixture 19/19、runner 环境/语法与 VSIX 类型/打包通过。证据见 `docs/references/smoke-reload-autostart/pty-output-evidence.json`。


新的发布阻塞为 `verifyFailurePaths:9336`：缺失 Claude CLI 已产生 commandResolutionFailed/startFailed 和页面错误，未启动执行以 not-required 结算，但节点仍 starting、pendingLaunch=start、liveSession=false；测试期待 error。这是尚待定位的失败状态投影问题，不能改为期待 starting 放行。本轮未更改该产品路径或失败状态断言，后续失败路径/恢复/Runtime 检查未完成。原工件在 `.debug/pty-output/trusted-artifacts`，此前独立历史失败继续保留。


## owned 启动准备失败状态收口（2026-10-10，PR #314）

CLI/执行环境准备失败后停留 starting/launching 的产品缺口已修复：原 record 和 metadata 仍有效且未取消时，fresh 为 error、resume 为 resume-failed，清除 pending/live，保留历史正文与恢复身份；未开始记录仍为 not-required。准备失败同时取消未派发的尺寸意图，避免自动同步尺寸额外报 owned-resize-failed。关闭准入、取消/换绑、取得资源后的未知结果保持原保护。完整 Host 487/487、类型、本地化和 smoke helper/runner 检查通过，最终代码默认真实 VSIX 六个独立阶段（含 local-preparation-failure）通过。

同轮 trusted 在更早的 `verifyAgentAbnormalInterruptionNotifications:7788` Claude resume 再启动处被 `Local final snapshot responsibility still occupies the execution key or Host capacity.` 阻断。工件捕获时记录已清理，不据此追认具体时序原因；保留 `.debug/preparation-failure/early-trusted-artifacts`。同代码不修改场景复跑 trusted，在更早的 `verifyCreateNodeCommandQuickPickPreservesExplicitPresetIntent:3257` 等待启动诊断超时，实际 `execution/startFailed` 为 `Execution owner admission is closed`，工件在 `.debug/preparation-failure/repeat-trusted-artifacts`。两轮均未在 trusted 原顺序触达缺 CLI；两处早期生命周期失败仍待定位，完整发布 gate 尚未通过。此次不改版本或发布资料，未复验真实 Agent/跨版本与跨平台矩阵。精简证据见 `docs/references/smoke-reload-autostart/preparation-failure-evidence.json`。


## 两处 smoke 完成等待缺口已定位（2026-10-10，PR #314）

前节“最终保存占槽”和“owner admission is closed”的修复方向已收敛。通知用例在原执行 error/通知后没有等待退休，原生自然复现时保存和资源已经完成，只剩页面 reader pending；需在同 node 再启动及 Claude 恢复 seed 之前按原 executionId/generation 等待 saved/not-required 且原记录退休。预设创建用例在原本为空的画布派发异步 reset 后立即新建，reset 因节点改变中止而保留关闭准入；需等待 reset 命令实际完成，不能只等 nodes.length=0。两处正式 smoke 同步修复仍待落实，保持产品现有同 key/失败边界保护。用户并发创建与 reset 的准入提示/交互协调可单独评估，本轮不将放宽失败边界当成修复方案。

5/5 受控对照、原顺序 reset 复现、原生通知同 key 拒绝、等待退休后的五次正常通知运行及受控 Claude 恢复正反对照均已完成；最终确认可自然 applied，资源不存在已证明的永久泄漏。旧 Claude 原始工件清空后缺少的瞬间状态不追认。证据与复跑补丁见 `docs/references/smoke-reload-autostart/lifecycle-barrier-evidence.json`，计划为 `docs/exec-plans/completed/smoke-lifecycle-barrier-investigation.md`。

同时补回上轮拆分用例遗漏的 `verifyFailurePaths` 局部 diagnosticStartIndex，原生受控运行已完整通过该函数。调查变体在该函数后停止，完整发布门禁仍未通过，其他历史待定位项继续保留。


## smoke 生命周期等待正式修正与剩余门禁（2026-10-10，PR #314）

前节两项正式修正已落实：四处创建流程 await reset 命令，通知用例固定退出前的 executionId/generation，等原退休后再重启、转模拟夹具或写入 Claude 恢复 seed。默认 VSIX 前六阶段通过，trusted 原顺序完整通过上述场景和 `verifyFailurePaths`，同步等待缺口关闭。

原顺序后续 `verifyStopVsQueuedExitRace` 用 recentOutput 等 sleeping，直到自然 exit 9 保存后才发 Stop；本轮追加改为原执行实时输出，并在停止后等待退休。单独运行确认 stopped/0、Token usage、codex resume、received signal INT 已保存；仍被旧摘要 `/Stopped Codex session/` 与实际 `Session ended with exit code 0.` 的差异阻断。后续 legacy stopRequested/exited 诊断断言尚未执行，需核对 owned 契约，不能直接放宽断言或将其推定为停止功能故障。

最终源码 trusted 复跑再次通过创建与通知，随后在 `verifyExecutionTerminalNativeInteractions` 报 `Execution link "link-target.ts:3:1" was not detected.`；第一轮同用例已通过，当前不追认其与历史链接失败的具体共同根因。完整 gate 及后续 Runtime 场景仍未完成。本轮没有产品或版本改动，证据为 `docs/references/smoke-reload-autostart/lifecycle-barrier-fix-evidence.json`，完成计划为 `docs/exec-plans/completed/smoke-lifecycle-barrier-fix.md`。


## 链接扫描与停止用例契约已定位（2026-10-10，PR #314）

前节两项根因在定位轮已收敛，正式修复结果见下一节。链接用例在 Host 发出正文后立即扫描 xterm，未等页面批量 drain/parser 应用。原生只读探针捕获 URL 扫描起止均无正文、随后新 probe 正文可见；同 `link-target.ts:3:1` 页面写入延迟 600ms 的受控对照在应用前复现拒绝，正文可见后保持原 executionId/generation，正确打开第 3 行第 1 列。历史失败 probe 是缓存，不追认其瞬间页面状态。应按原执行真实正文和目标页面实际就绪同步，保持真实链接打开断言。

Stop 用例仍期待旧 session 的固定摘要及 stopRequested/exited 诊断；owned 路径没有经过这些旧发射点。原生已确认 stopped/0、SIGINT 收尾提示、单次 host/executionExit、saved、页面 applied 和退休；定向 Host 2/2 确认单次停止、尾部消费及完整结算。应迁移到原执行事实断言，当前没有停止动作失败证据。

有界三次原生链接交互另外记录两次完整通过、一次 URL 已检测后 tooltip 可见超时；此显示问题未分类，正式修复时应保留并独立复核，不能用扫描等待结论掩盖。完整 gate 与后续 Runtime 仍未完成。证据为 `docs/references/smoke-reload-autostart/link-stop-investigation-evidence.json`，计划为 `docs/exec-plans/completed/smoke-link-stop-investigation.md`；临时产品/测试探针均已恢复。


## 链接与停止 smoke 已修正，Claude 显式 session ID 的恢复策略待定位（2026-10-10，PR #314）

链接扫描现等原执行的新正文与独有标记出现在目标页面，重开画布后复用链接也确认页面就绪；Stop 改查原执行 stopped/实际退出信息、SIGINT 收尾、单次 host/executionExit、saved、原页面 applied。Host 原 owner 测试直接检查 stopRequested。相邻 Claude Stop 的实时正文等待及退休同步一并迁移。正文 helper 14/14、reset fixture 19/19、runner/语法、Host 定向 2/2 通过；600ms 页面应用延迟对照及最终无延迟 local-links-and-stop 均完整通过，临时产品延迟已移除。

最终默认 VSIX 七个独立阶段通过，trusted 原顺序通过完整链接、Codex Stop 和 Claude Stop，本次具名阻塞已收口。旧 URL 已检测后 tooltip 不可见的单次失败未在本轮复现，其精确根因仍未确认，不能因本轮通过而改写旧证据；若复现，应使用清理前的新 probe 独立核对呈现状态。

新的独立阻塞为 `verifyClaudeExplicitSessionIdPreservesResumeContext:9972`：snapshot-only 的 Claude 已 waiting-input/live，显式 ID 已保存，但 resumeSupported=false、resumeStrategy=none，未达到 claude-session-id，尚未进入该用例 Stop。原执行 `b9f70f16-d41f-4d55-829e-27fb1321bc53` 未退休、未提交最终保存，不能把正常活动期的 submitted=false 当作保存失败。此处是恢复能力状态等待，非旧正文断言；根因尚待定位，临时处理为保留失败现场及原断言。继续完整门禁前应核对显式 ID 的发现、支持判定与 owned 状态投影，不能只检查 ID 而放宽策略。后续 RuntimePersistence 开启场景未执行，完整 gate 仍未通过。

证据与计划：`docs/references/smoke-reload-autostart/link-stop-fix-evidence.json`、`docs/exec-plans/completed/smoke-link-stop-fix.md`。原始失败现场保留于 `.debug/link-stop-fix/trusted-final-artifacts`，仓库精简记录包含关键状态和工件摘要。


## Claude 显式 session ID 的 owned 文件确认遗漏已定位（2026-10-10，PR #314）

前节恢复策略阻塞已确认是产品迁移遗漏，正式修复尚未实施。snapshot-only fresh Claude 的候选 ID 本应经 transcript 文件确认；旧路径在 startup/waiting-input 调用 locator，owned 两处均遗漏，business.agentResume 持续 none。旧确认方法仅认 legacy map，因此只补调用也无法升级 owned 记录。

同 Extension Host 实际 locator 立即识别原 smoke 文件，原用例仍超时；Host 有文件/无文件 2/2 对照证实正常 owned 调用数为 0、旧 helper 的 map 限制及原 projection 可用。临时只补原 owned 文件确认后，原生原用例的运行态、停止后策略/ID和删除检查全部通过；无文件对照继续 none。问题不是旧正文断言或测试超时设置，停止后的恢复入口可能因此不可用；本轮原生范围为显式 ID，自动候选走同一遗漏调用路径但未单独原生验证。

继续 PR314/完整门禁前，应接回原 owned startup/waiting-input 文件确认，保护查询期间换绑、候选变化、停止/结束与迟到结果，保留已确认 ID 的停止语义和无文件拒绝；不能阻塞正文消费或伪造最终保存完成。本轮临时产品/测试源码已恢复，完整 gate 仍未通过，Runtime 开启及真实 provider resume 不由对照代证。证据与复跑 patch：`docs/references/smoke-reload-autostart/claude-resume-context-evidence.json`；计划：`docs/exec-plans/completed/claude-resume-context-investigation.md`。


## owned Claude 文件确认已修复，Runtime root 启动准备仍阻塞（2026-10-10，PR #314）

上一节缺口已修复：原 owned Claude 在 started/waiting-input 独立异步扫描原 cwd 的候选文件，合并重复请求并保留一次补查，不阻塞启动、正文或停止。返回时核对原记录、恢复上下文、launchSpec、当前 metadata 绑定与停止/结束/最终保存状态；成功投影并普通保存，已确认 ID 在停止后保留，无文件不升级。新增 17 项、完整 Host 504/504、类型/语法通过；基线产品的新正例失败。最终默认 VSIX 七个独立阶段通过，原 Claude 显式 ID 用例在独立阶段和 trusted 均完整通过，正式修复已收口。

新的独立门禁位于 `verifyLiveRuntimePersistence:10024`：用例开启 RuntimePersistence 后首次等待 Agent live 超时，尚未触达 reload/reattach。Agent starting、Terminal launching，均 pendingLaunch=start/live=false；`execution/candidateStartFailed` 报 `Root runtime preparation or submission did not complete.`，没有本地 owned 执行。节点 metadata 仍 snapshot-only，不代表配置仍关闭。该轮底层原因待查，原工件保留在 `.debug/claude-resume-fix/trusted-artifacts`；现已完成下述独立定位。

本轮没有关闭完整 gate 的技术债，也没有验证真实 provider resume、跨平台或真实窗口 Reload。计划与证据：`docs/exec-plans/completed/owned-claude-file-confirmation.md`、`docs/references/smoke-reload-autostart/claude-file-confirmation-fix-evidence.json`。

## Runtime root 存储创建权限与准备约定不一致（2026-10-10，PR #314）

已确认：扩展构造时普通 root-local 画布保存以默认 mode 递归创建 globalStorage；umask 0002 下为 0775。Runtime 的 mkdir 0700 不会修改已有目录，helper 第一项 globalStorage 不可组写检查立即拒绝，外层 catch 隐去原异常，节点保留待启动表现。新隔离 user-data 即可复现，属于环境触发的插件初始化/兼容缺口，不是 smoke 等待时间或旧 Supervisor 的必要问题。与此前 checkpoint 的 0775 拒绝同因。

本轮仅定位，不改生产检查或目录权限。原目录未修改重放失败；同实验目录 0755/0700 均越过准备；真实 0002/0022 对照捕获首次创建调用栈，0022 下 root intent/started 与 Terminal live 成立。0022 的 Agent 随后 rejected-before-acquire，未捕获资源拒绝瞬间，仍待独立定位，不能仅凭同类文案归为 starting 配额。完整 Runtime/gate 未通过。

后续正式修复需统一可能先创建目录的保存/模板/Runtime 入口，明确已有目录的验证/处理策略，并让安全的具体准备失败反馈与本请求节点状态一致；不得自动接管不安全目录、放宽 owner/canonical path/权限检查或未知提交保护。之后恢复原 Runtime 自启动和后续矩阵；不以只改测试 umask 或延长等待收口。入口为 CanvasPanelManager 的 writePersistedCanvasSnapshotToDisk/resolveRuntimeCreationTarget、supervisor/runtimeRootOwner.ts 和 runtimeRootPreparation.ts。

证据：`docs/references/smoke-reload-autostart/runtime-root-preparation-evidence.json` 及相邻两个复现程序；计划：`docs/exec-plans/completed/runtime-root-preparation-investigation.md`；设计：`docs/design-docs/smoke-reload-autostart-investigation.md`。

## Runtime 存储准备已修复，后续 Agent 准入仍阻塞（2026-10-10，PR #314）

上项目录缺口已收口：普通画布与内部模板目录明确 0700 创建；Runtime 对 ExtensionContext 指定的同 UID、非链接、无特殊位旧 0775/0770 目录经描述符及前后 dev/ino/realpath 检查后仅去组写位。安全目录不改，世界可写/异主/替换拒绝；不递归改权限、不更改 root owner key。helper 给出固定安全阶段信息；原未提交新会话失败投影 error/resume-failed、清 pendingLaunch，保留历史和恢复信息；原 Runtime 绑定及未知已提交保护不变。

目录 21 项、准备 worker 26、client 21、systemd 环境 40、owner storage、完整 Host 529/529、模板、本地化和类型检查通过。最终默认 VSIX 七阶段通过，trusted globalStorage=0700，root/Terminal 启动成功，Agent 在后续 createSession 阶段 rejected-before-acquire。独立旧 0775 升级并串行启动两节点、0777 拒绝并结束两节点待启动状态均原生通过。原始 smoke 未改；checkpoint 原完整场景仍未在本轮重跑，不能由专项代证。

剩余门禁：默认 verifyLiveRuntimePersistence:10024 仍因 Agent 资源拒绝等待 live 超时，尚未到该场景 reload。该轮尚缺拒绝瞬间的占槽/身份/关闭状态；原因现已在下一项通过专项独立确认，后续按其 fixture 修复边界推进，不扩大上限或放宽断言。工件 `.debug/runtime-root-fix/final-trusted-artifacts`；精简证据 `docs/references/smoke-reload-autostart/runtime-root-storage-fix-evidence.json`；计划 `docs/exec-plans/completed/runtime-root-storage-repair.md`。完整 gate、真实 provider、跨平台/跨版本矩阵仍未完成。

## Runtime 共用 fixture 启动屏障遗漏（2026-10-10，PR #314）

上一项 Agent 准入原因已确认：`prepareTrustedBaseNodesForAppliedRuntimePersistenceMode` 连续创建 Agent/Terminal，只等节点存在。原生拒绝点显示准备容量通过、身份匹配、未关闭/隔离，Terminal 持有唯一 starting 槽时 Agent 进入 beginStart 被拒，无 provider 资源。Terminal started 后槽正常释放，原 Agent 节点重试成功；串行 started 对照两者成功；无探针原包连续创建则拒绝 Terminal，随后同节点重试成功。三场景均 exit 0，隔离 Supervisor 已自然退出。属于 fixture 未遵循正式准入前提，未发现此处生命周期泄漏或版本兼容故障。

尚待修复共用 helper 的逐个原身份 started 屏障，覆盖 Runtime 开/关及其独立调用点；保留后续断言，不扩大额度、不固定 sleep、不自动重试。本轮未改正式 smoke/产品，完整 gate 和后续 Runtime reload/checkpoint 仍未验证，不能把专项结束当成发布准入。证据：`docs/references/smoke-reload-autostart/runtime-admission-evidence.json`；复现：相邻 `runtime-admission-investigation.mjs`；计划：`docs/exec-plans/completed/runtime-start-admission-investigation.md`；设计：`docs/design-docs/smoke-reload-autostart-investigation.md`。

## Runtime 启动屏障已修复，后续分页快照断言仍阻塞（2026-10-10，PR #314）

上一项共用 fixture 缺口已收口：Runtime 开/关均逐个确认原 session/execution 的 started；同一持久化用例的显式重新启动也串行确认，等待后复核原绑定。两个原生开/关专项通过，启动次数准确、无拒绝或重试；默认 VSIX 七个独立阶段通过，trusted 完整 `verifyLiveRuntimePersistence` 已通过初始启动、指定尺寸重启、运行、reload/reattach、停止后重读。

剩余门禁为紧邻下一项 `verifyLiveRuntimeReloadPreservesUpdatedTerminalScrollbackHistory:10380`：页面恢复最新行和滚动至最早行已通过，但测试仍等待原 session 的 `host/executionSnapshot.terminalStream` 同时包含首末 marker。超时记录显示实际是 `terminalRead`/`currentState`、无 terminalStream；需要按分页快照契约修正观察并验证首末历史/原身份/修订号，不能删除覆盖或改用任意节点输出。本轮未改该断言，完整 gate 与其后的 Runtime 场景、checkpoint 独立大输出和跨平台矩阵继续未通过/未执行。

证据：`docs/references/smoke-reload-autostart/runtime-admission-fix-evidence.json`；专项复验：相邻 `runtime-admission-fix-verification.mjs`；计划：`docs/exec-plans/completed/runtime-start-admission-repair.md`；正式方案：`docs/design-docs/smoke-reload-autostart-investigation.md`。已清理本轮隔离会话和 Supervisor。

## Runtime 滚动历史旧快照断言已定位（2026-10-10，PR #314）

上一项分页快照超时原因已确认：旧断言只读 terminalStream，但当前分页路径发送 terminalRead/currentState，旧 helper 对 undefined 返回空字符串。重复快照复用同 readId，clearHostMessages 不会使已消费 bootstrap 重发。原生专项保留原用例并复现 10 秒超时；按原 session/authority/readId/页面生命周期重组四块 24874 字符，用正式 codec 还原后 220 行逐行完整有序且唯一。未发现此具名场景的历史丢失；不是前次单启动槽问题。

尚待按分页契约修正正式断言，保留原身份、scrollback、首末行及 checkpoint/后续 revision 覆盖，避免清空唯一 bootstrap 观察后再等待重发。本轮不修改正式测试或产品；完整 gate、后续 Runtime/压力/旧版本与跨平台验证仍未完成。证据：`docs/references/smoke-reload-autostart/runtime-scrollback-snapshot-evidence.json`；脚本：相邻 `runtime-scrollback-snapshot-investigation.mjs`；计划：`docs/exec-plans/completed/runtime-scrollback-snapshot-investigation.md`。

## Runtime 滚动历史分页断言已修复，后续恢复退出摘要阻塞（2026-10-10，PR #314）

上一项旧快照断言已收口。正式 helper 关联原 reader/lifecycle，校验完整 current-state 分块和连续后缀，再用正式 codec 与真实 xterm 验证 220 行。六组回归、runner 环境回归和原生完整专项通过；默认 VSIX 七个独立阶段通过，trusted 本条滚动历史和后续完成态历史排空、重连失败绑定保护、忽略陈旧自动 resume 场景也通过。

完整 gate 在 `verifyLiveRuntimeResumeExitClassification:10666` 失败：Runtime 开启，恢复已进入运行/等待输入，发送 `exit 23` 后 status=error、lastExitCode=23 正确，但 summary 为 `Session ended.`，测试期待摘要含退出码 23。摘要差异根因尚未定位，不预判测试还是产品问题。失败后的 finally 关闭 Runtime，不能用最终 snapshot-only 字段反推场景模式。保留该断言及原配额，后续 Runtime/reload、独立 checkpoint、真实 Agent 和跨版本/跨平台矩阵仍未完成。

证据：`docs/references/smoke-reload-autostart/runtime-scrollback-snapshot-fix-evidence.json`；原生复验脚本：相邻 `runtime-scrollback-snapshot-verification.mjs`；计划：`docs/exec-plans/completed/runtime-scrollback-snapshot-repair.md`；设计：`docs/design-docs/smoke-reload-autostart-investigation.md`。本轮隔离节点与 Supervisor 已清理。

## Runtime 恢复退出摘要缺失已定位为 owned 产品接线遗漏（2026-10-10，PR #314）

上一项摘要阻塞的根因已确认：`runtimeSupervisorMain.finalizeOwnedExecution` 普通 EOF 分支保存 code/signal/lifecycle，却未生成 lastExitMessage/descriptor。Host 因上游消息为空回退 Session ended.。Runtime 开启、恢复已成功的原 session 实际 exit23、source=eof、AuthorityResult=applied，error 分类正确；不是测试正则或清理动作导致。

无探针原包复现、只读发布探针和仅补退出消息的隔离对照均完成；前两者复现原断言失败，后者保持原动作/断言并通过。本轮仅定位，正式产品及 smoke 未改。待在 owned 终态生成处补齐描述符/fallback，保留停止、恢复失败、非 EOF/未知结果的区分并覆盖相关矩阵；完整 gate 及后续 Runtime/reload 验收仍未完成。

引入为 `c1b6bc8b8`，默认构建接入为 `08fa33725`；不指定首个受影响发布版本。证据：`docs/references/smoke-reload-autostart/runtime-resume-exit-summary-evidence.json`；复验脚本：相邻 `runtime-resume-exit-summary-investigation.mjs`；计划：`docs/exec-plans/completed/runtime-resume-exit-summary-investigation.md`；正式结论：`docs/design-docs/smoke-reload-autostart-investigation.md`。实验节点已停止，本轮 Supervisor 已退出。

## owned Runtime 退出描述已修复，后续立即 reload 阻塞（2026-10-10，PR #314）

上一项产品遗漏已收口：新旧 Supervisor 共用已确认退出业务描述，恢复完成后异常退出 error、恢复阶段失败 resume-failed，stop/零码及非 EOF、未知/失败 authority 的保护保留。Supervisor 接线134/134（新增18项）、协议链、typecheck、本地化与原生原恢复23函数通过；trusted 同载荷独立重跑也通过原摘要断言。

完整默认 VSIX 前六个独立阶段通过，local-links-and-stop 的 URL 尾部发生无进展停滞，HTTP listener 已关闭但浏览器TCP连接未断；超过五分钟取证后结束隔离VS Code。该阶段同载荷原测试独立重跑通过，首次停滞未完成根因定位，不追认其成功。trusted 原顺序在下一项 `verifyImmediateReloadAfterLiveRuntimeLaunch:11000` 报 Runtime session updates are still pending.，现场 Agent 启动 rejected-before-acquire、Terminal live；二者与边界回调的因果待定位。保留原断言、准入及未知责任保护，完整 gate、后续 Host/reload/checkpoint 与跨平台验收仍未通过/未执行。

证据：`docs/references/smoke-reload-autostart/runtime-resume-exit-summary-fix-evidence.json`；原生复验：相邻 `runtime-resume-exit-summary-verification.mjs`；计划：`docs/exec-plans/completed/runtime-resume-exit-summary-repair.md`。本轮隔离会话及 Supervisor 已清理。

## 立即模拟 reload 的启动准入及回调时序（2026-10-10，PR #314，已修复；下文记录验收）

已定位上一节阻塞：独立立即 reload 用例仍并发启动，与 starting=1 冲突；即使串行到第一项 started，第二项启动后的首批正文也可能在边界首次回调等待之后进入，触发 pending 安全拒绝。原生对照中回调在拒绝后 17ms 正常 consumed/结束，两个启动均成功，排除两者必然同源及该次回调泄漏。无探针分别等待两项 started 的对照通过，但不保证所有持续输出交错。

正式 smoke 与产品未改。后续须同时处理启动前提和模拟边界语义，保留原 session 身份、pending 保护与有界失败；实际“启动后立即 Reload Window”需新 Host 验收，不能用等待输出安静悄悄代替。真实退出先关闭事件准入，本轮未证明其存在相同故障。完整 gate、历史 URL 清理停滞和后续矩阵仍未收口。证据及复跑脚本：`docs/references/smoke-reload-autostart/runtime-immediate-reload-evidence.json`、相邻 `runtime-immediate-reload-investigation.mjs`；计划：`docs/exec-plans/completed/runtime-immediate-reload-investigation.md`。

## 立即模拟 reload 已修复，后续本地 Host boundary 启动阻塞（2026-10-10，PR #314）

模拟 live-runtime reload 使用 20 秒期限，在清空绑定前结算新回调并按登记修订重新保存；到期保留原责任，普通 reset/template/deactivation 不启用新选项。smoke 只等待 Agent started，Terminal 派发后立即 reload，检查单次启动及原 session 重连。新增 14 个受控场景、完整 Host boundary、Host owner 529/529、类型/本地化/语法通过，基线新回归失败；最终无探针原生专项连续三次通过。

最终默认 VSIX 七个独立阶段通过，trusted 通过立即 reload；随后 `verifyHostBoundaryFlushesRecentLocalState:11210` 在 RuntimePersistence 关闭的 snapshot-only 场景等待 Agent live 超时，Agent stopped/SIGINT、Terminal live。尚未输入本用例正文或执行其 reload/flush；根因待定位，不修改新阻塞断言。完整 gate 仍失败；原 URL 清理停滞、后续 checkpoint/真实新 Host/跨平台等缺口继续保留。证据：`docs/references/smoke-reload-autostart/runtime-immediate-reload-fix-evidence.json`；复验：相邻 `runtime-immediate-reload-verification.mjs`；计划：`docs/exec-plans/completed/runtime-immediate-reload-repair.md`。

## 本地 Host boundary 显式重启遗漏 started 屏障（2026-10-11，PR #314，已修复；下文记录验收）

上一节 Agent live 超时已定位：snapshot-only 具名测试停止并确认旧执行退休后，又连续派发两个启动；Terminal 占唯一 starting 槽，Agent rejected-before-acquire。旧 saved/applied 已完成，关闭/隔离/身份不匹配均被排除。SIGINT 属于旧 Agent 的主动停止，新请求 not-required，原 stopped/历史保留及错误提示符合既定准入规则。

无探针原序、只读 authority 探针均复现；产品 bundle 不变、仅串行等待 Agent 原 started 的对照完整通过原函数正文和 reload 后历史断言；既有 Host 准入/状态保留两项测试通过。正式修复应复用原执行 started 屏障，不改配额、历史状态、停止退休或最终保存断言。本轮正式产品/smoke 未改，完整 gate 未重跑。证据：`docs/references/smoke-reload-autostart/local-host-boundary-start-evidence.json`；复跑：相邻 `local-host-boundary-start-investigation.mjs`；计划：`docs/exec-plans/completed/local-host-boundary-start-investigation.md`。

## 本地 Host boundary 启动已修复，后续退出诊断断言阻塞（2026-10-11，PR #314）

具名测试逐个等待原执行 started，正文按 executionSessionId 匹配，reload 前复核 executionId/generation；原停止退休与历史正文断言保留，产品源码/准入不变。原生原函数完整通过，三个产品 bundle hash 与定位基线一致；已有正文 helper14/14、语法及默认 VSIX 类型/构建打包通过。七个独立阶段与 trusted 原顺序的本用例通过。

完整 gate exit1，后续 `verifyTrustedDiagnostics:13507` 期待 Agent `execution/exited` 诊断的断言失败，根因尚未定位，不将其等同于进程未退出。最后 Agent resume-ready、Terminal interrupted，无 live 节点。本轮不改变此断言；历史 URL 停滞和后续真实新 Host/checkpoint/跨平台等仍未收口。证据：`docs/references/smoke-reload-autostart/local-host-boundary-start-fix-evidence.json`；复跑：相邻 `local-host-boundary-start-verification.mjs`。

2026-10-11 后续定位：已确认汇总断言沿用旧 PTY 专属 `execution/exited` / live `execution/snapshotPosted`，owned 本地与 Runtime 路径绕过这些记录点；长流程末尾的 2000 条可清空数组也不能保证早期失败事件仍存在。原生 owned Agent exit27、页面退出消息、最终保存 saved 和 reader applied 均成立，只有 59 条事件仍无旧 exited；原 Host boundary 后 95 条事件时原汇总断言再次失败。原失败工件八项谓词中第 4、6、7 项不满足，不能只放宽第一项收口。

待修复：在具名退出/失败/live 快照场景内按原执行身份验证并保存结果，末尾不再追溯易失缓存；保留进程结果、最终输出、保存和读者结算覆盖，不补旧事件求绿。正式 smoke 与产品本轮未改，完整 gate 未重跑。证据为 `docs/references/smoke-reload-autostart/trusted-diagnostics-evidence.json`，计划为 `docs/exec-plans/completed/trusted-diagnostics-investigation.md`；其余历史限制保持原状态。

2026-10-11 正式修复已完成：Agent flow、Terminal flow、缺失 CLI 用例按原身份生成已验证证据，末尾汇总不再等待旧 PTY 事件。原生清空诊断后的正对照和缺少任一证据的三项负对照通过；七个独立 VSIX 阶段及 trusted 原序本次汇总通过。完整门禁仍失败，下一处如下；前述“待修复”由本段收口。证据：`docs/references/smoke-reload-autostart/trusted-diagnostics-fix-evidence.json`。

## trusted 文件活动用例等待第二个 Agent live（2026-10-11，PR #314）

`verifyFileActivityViewsAndOpenFiles:3795` 在创建两项专属 Agent 后等待第二项 live 超时。失败现场第一项 waiting-input/live=true，第二项 starting/live=false/pendingLaunch=start，尚未执行文件读写。当前只记录下一处阻塞，未定位为何启动未完成，不直接归为准入、尺寸或产品文件活动故障。

默认命令已通过本次诊断汇总，故此失败不回退为旧诊断阻塞。另保留日志中立即模拟 reload 期间 Runtime client disconnected 的批次消费报告；该用例原断言继续通过，因果尚未研究。后续需分别确认第二项启动链和该报告的范围；历史 URL 清理停滞、真实新 Host/checkpoint/跨平台验收不由本轮代证。工件见 `.debug/trusted-diagnostics-fix/trusted-artifacts/`，精简证据为 `docs/references/smoke-reload-autostart/trusted-diagnostics-fix-evidence.json`。本轮进程已退出，无本轮 fake provider/Supervisor 残留。

2026-10-11 定位完成：第二项已携 66×21 发出启动，但第一项仍占 starting=1，因此 rejected-before-acquire，保存 not-required；无探针原生复现和只读 authority 探针确认，非尺寸缺失或 owner 永久阻塞。只等待第一项原 started 再创建第二项的同包对照通过原两项 live 检查，显式重试被拒节点也成功。现有 Host overlap 接线 2/2 通过。后续修正本独立 fixture 的创建/started 屏障；文件读写等后续内容本轮未覆盖。

另有产品呈现缺口待修复：新建节点被合法准入拒绝后仍保留 starting/pendingLaunch=start/等待尺寸，页面同意图自动启动去重又不重试。应针对未取得资源的新建意图收口状态，保留旧历史/较新请求及不确定资源保护；不放宽额度或增加隐式自动排队。原生恢复对照仅通过 Host 显式启动，未验收真实 Start 点击。证据 `docs/references/smoke-reload-autostart/file-activity-start-evidence.json`，计划 `docs/exec-plans/completed/file-activity-start-investigation.md`。正式产品/smoke 未改，完整 gate 未重跑；Runtime batch 报告等历史限制仍未收口。


2026-10-11 正式修复：文件活动每创建一个 Agent 后等待原身份 started，新节点被 rejected-before-acquire 拒绝后改 error、清除 pendingLaunch；历史字段、较新请求、取消和未知资源保护保留。Host 551/551、类型/本地化通过，同一 VSIX 原生真实 Start 点击重试通过，两个创建的原 started 屏障也通过。前述“呈现缺口待修复”和“创建屏障待修正”由本段收口，文件活动整体与完整 gate 仍未通过。证据 `docs/references/smoke-reload-autostart/file-activity-start-fix-evidence.json`，计划 `docs/exec-plans/completed/file-activity-start-repair.md`。

## 文件活动首条 read 引用与手动 resume 新停点（2026-10-11，PR #314）

修正创建屏障后的无产品探针原生专项通过两项专用 Agent 的原 started、live 和身份检查，派发第一条 read 后，`verifyFileActivityViewsAndOpenFiles:3812` 等待 fileReferences 中对应 Agent 的 read owner 超时。超时时 filesFeatureEnabled=true，两项专用 Agent waiting-input/live=true，fileReferences=[]；尚未验证后续 write、列表或打开文件。不在本轮直接归因为输入、采集器、路径或产品功能；需要独立定位，保留原断言。

本轮完整默认 VSIX 的七个独立阶段通过，但 trusted 在更早的 `verifyRuntimeReloadRecovery:8938` 等待手动 resume 后 live/resuming 超时，节点 resume-failed，提示 Missing resumable Codex session ID。该用例 reload 后 resume-ready、可信 providerSessionId、重新挂载页面不自动 resume 的断言已通过；最新错误为 execution/startFailed 的 preparation exception，尚未确认为何恢复请求未取得会话 ID，不归为本次准入拒绝，也不宣布恢复设计回归已修复。默认流程因此未到文件活动，不能用专项越过启动来声称 trusted 全序通过。

工件分别位于 `.debug/file-activity-start-fix/file-activity-1791652134021/runtime/artifacts/` 与 `.debug/file-activity-start-fix/trusted-artifacts/`；精简证据见 `docs/references/smoke-reload-autostart/file-activity-start-fix-evidence.json`。专项场景 exit1；xvfb-run 清理临时目录又报告 exit5，但最后 snapshot localExecutions=0，无本轮相关进程残留。历史 URL 清理停滞与 Runtime batch disconnected 仍保留，未触达项、真实新 Host、真实 provider 和跨平台验证不由本轮代证。


2026-10-11 两项根因均已确认，正式修复仍待处理。文件活动首 read 已到 provider 并有原 executionSessionId 回执，但 owned 本地启动提前 return，绕过 fileActivitySession 的创建、launch 参数/环境注入与绑定。只读 probe 确认 create/bind=0、无事件文件路径，控制接回正式 collector 后原首 read 引用断言通过。共用分支也遗漏真实 Claude hooks，属于产品功能缺口；正式修复需将 collector 的创建、拒绝清理、末尾 drain、删除、路由迁移和迟到事件纳入原执行责任。不能靠解析 PTY 文本或复制实验预先 bind 收口。

手动 resume 是 fake-provider 测试适配缺陷：停止提示将 fake-provider+storagePath 替换为 codex-session-id，清除了 resumeStoragePath；ID 本身仍在，fake resolver 因缺 storagePath 返回 none，builder 才报缺 ID。probe/control 均等待初始原 burst 回执使 shell trap 就绪；只保护 fake 恢复上下文后，原恢复函数全部断言（含重挂载不自动恢复、手动 resume 和 exit19）通过。同 metadata 使用真实 Codex 命令仍可构造 resume 参数，不据此认定真实 provider 恢复损坏。应修复 fake 恢复契约一致性，保留真实提示校正与产品状态断言。

证据 `docs/references/smoke-reload-autostart/file-activity-resume-root-cause-evidence.json`；调查四轮均完成且清理为零执行，两个 probe 的原场景仍失败，两个 control 仅为隔离实验。正式源码和 smoke 未改，本轮不重跑或宣称完整 gate 通过；历史 URL/Runtime batch 报告等限制不变。


## owned 文件活动与 fake 恢复契约修复；下一停点为删除 Agent（2026-10-11，PR #314）

已在正式产品中将 collector 创建、参数/环境注入、事件回调和释放绑定到原 NonNativeHostExecution。正常最终保存先排空末尾事件；拒绝不接收迟到事件且等待释放；未知资源仍归原执行，失败不能呈现为保存成功。fake-provider 的 sessionId/storagePath 不再被真实停止提示整体覆盖。新增18项 Host 回归，完整569/569、类型、本地化及 smoke 正文 helper14/14通过。

最新默认 VSIX 七个独立阶段通过，trusted 的原手动恢复函数也通过，已越过上轮 Missing resumable Codex session ID。文件活动原函数已通过 read/write、共享引用、节点/列表展示及打开文件，当前停在 `verifyFileActivityViewsAndOpenFiles:4426`：发出删除 Agent B 后，原执行停止并最终 saved/退休，但 Agent B 及其引用仍保留。原生独立 files 复验同样停在此处，清理后零 localExecutions。根因尚未确认，不将其归为 collector drain 失败或断言问题，也不宣称完整 gate 已通过。

删除后文件引用收敛、后续启停 files 配置及 trusted 剩余阶段未通过此次全序验收。历史 URL 清理停滞、Runtime client disconnected 批次报告、真实新 Host/checkpoint 和跨平台边界继续保留。正式证据与专项脚本为 `docs/references/smoke-reload-autostart/owned-file-activity-resume-fix-evidence.json` 及相邻 `owned-file-activity-resume-verification.mjs`；独立 readexit 原函数 exit0，末尾 read owner、文件节点/连线、持久化重读及清理全部通过；两个专项与正式 staging 三个 bundle hash 一致，产品无探针或行为替换。


2026-10-11 删除停点根因已确认：`terminateExecutionNodeForDeletion` 等待 owner 停止后同步检查最终保存，正常异步保存仍 pending 时立即中止；21ms 后 saved 不会恢复原删除请求。原生检查时 collector 已 dispose，故不是文件事件排空失败。该同步拒绝来自已在 main 的 `b235a7bc5`，符合 S8 §26.3 当时“不新增保存等待预算”的保守契约；当前一次删除 smoke 与其行为不一致。延长用例等待无法解决。

受控 Agent/Terminal（files 关闭）probe/control × saved/failed 共8/8捕获预期结果；仅为原 host-delete 增加原保存有界等待的 native control 完整通过原文件活动函数，probe 原场景仍失败，两个调查脚本均清理至零执行。证据 `docs/references/smoke-reload-autostart/owned-delete-persistence-root-cause-evidence.json`。正式修复仍待实施：若采用一次删除完成语义，应显式更新旧入口契约、等待原保存并重验目标身份，失败/未确认/超时继续保留，不放宽状态断言或自动重试。完整 gate 和此前其余边界保持原状态。


## 单节点删除保存等待已修复；下一停点为 Claude Fork（2026-10-11，PR #314）

`deleteNode` 对owned/retained最终保存显式等待既有20秒预算，成功后复核原owner、record路由、metadata和删除token，再移除节点及引用。失败/未确认/超时保留，迟到saved不续删；reset/清组/模板默认契约不变。19项新增回归先红后绿，Host588/588、类型和本地化通过。默认VSIX七个独立阶段通过，trusted原文件活动和readexit全函数通过，包括两项Agent删除、引用收敛、files开关与基线恢复；上一删除阻塞关闭。

完整trusted继续通过RuntimePersistence配置清理、侧栏历史恢复/Fork UI和Codex分支，停在 `verifyClaudeAgentBranchFromCurrentNode:2268` 等待唯一execution/started事件。现场记录Host容量占用startFailed和另一节点的rejected-before-acquire，根因尚未确认；不能把它当作本次保存等待失败或仅因出现准入词就归为fixture并发错误。失败快照localExecutions=0，后续用例仍未触达。证据 `docs/references/smoke-reload-autostart/owned-delete-persistence-fix-evidence.json`，原始工件 `.debug/owned-delete-persistence-fix/trusted-artifacts/`。

本轮正式smoke未修改，实际默认trusted原序列已提供文件及readexit的原生验收，不重复已通过场景。历史URL清理、Runtime disconnected批次报告、新Host/checkpoint/真实provider/跨平台等边界继续保留。

## Claude Fork 根因已确认，正式修复待实施（2026-10-11，PR #314）

基线be574e48。原gate消息证明历史节点已error后被Codex finally恢复旧starting/pendingLaunch=start基线，以新executionId重新启动并挤占Claude子节点的pending容量。侧栏用例仅验节点而未收口原生命周期；应等待自身意图结算及停止/保存/退休，provider用例不得重放过期启动意图。

另有产品缺口：reserve前容量guard抛普通Error，Host仅报告startFailed/host-error，目标无record但保留starting/pendingLaunch。需按原新请求身份安全投影失败/清pending，保留同key旧责任、历史和无自动重试。先前typed rejected-before-acquire修复不覆盖此入口。

收口对照保留原Codex/Claude全部断言并exit0，空画布Claude另行exit0，均零localExecutions。受控原基线回放捕获sameKey=false、两项历史pending及目标20秒后仍starting；回放释放prepare后历史节点另报owned-resize-failed，外层断言exit1，需后续确认这一重叠resize分支，不将其认作原gate根因或通过证据。首轮自然suffix可通过；另一轮在前置Runtime配置启动先超时，未用于Claude归因。

正式产品和smoke未修改，完整gate未重跑且仍失败；后续用例、历史URL/Runtime batch及新Host/真实provider/跨平台边界保持未关闭。证据 `docs/references/smoke-reload-autostart/claude-fork-admission-root-cause-evidence.json`，计划 `docs/exec-plans/completed/claude-fork-admission-investigation.md`。

## Claude Fork 准入阻塞已修复；resize 分支独立待定位（2026-10-11，PR #314）

`tests/vscode-smoke/extension-tests.cjs` 现在在侧栏历史恢复、Fork UI 和 unsupported source 基线交接前等待 pending 意图清除、停止和原执行退休，避免旧 `starting/pendingLaunch=start` 被后续 baseline 回写重放。`CanvasPanelManager.reportWebviewExecutionStartFailure` 对 reserve 前、无 owned record 的容量拒绝做身份保护的 error/resume-failed 投影，清除 pending、持久化并通知页面；同 key 旧 record、替换 metadata、live 或取消请求继续保持原责任。

新增 Host wiring 回归和正式 trusted VSIX packaged-payload smoke 均通过，原 Codex/Claude Fork、unsupported source 及后续侧栏搜索/双击断言通过；生产 pending/starting 配额和无自动重试语义不变。此前 root-cause 调查中的受控 prepare 重叠释放后 `owned-resize-failed` 仍未确认边界，另行跟踪；完整 gate 尚未因本次定向验证而追认通过。修复计划 `docs/exec-plans/completed/claude-fork-admission-repair.md`。

## PR314 最新 head 完整 packaged VSIX gate 已闭环（2026-10-11）

针对上一节“只完成定向验证、完整 gate 未重跑”的记录，已在精确 head `1286b83e778b69bf2214bed15f9a770c8a916f27` 上不设置 scenario filter 重跑 `npm run test:vsix-smoke`。Linux x64、Node 22.23.3、VS Code 1.141.0、已验证 execution asset set、原生 PTY 和 fake provider 环境下，八个阶段（含 trusted 全顺序）全部通过，命令 exit 0。此次运行关闭审计中“最新 head 未闭环”的 P1；Claude Fork 修复后的生命周期、准入拒绝、最终保存和 reload 主路径在该 packaged payload 中均完成原有断言。

证据见 `docs/references/smoke-reload-autostart/full-vsix-gate-1286b83e-evidence.json`。此前章节保留历史失败时点，不再作为当前 head 的门禁结论。GitHub 没有完整 smoke required check，`native-assets` 仍为 skipped，因此真实 provider、真实窗口 Reload、新 Host/checkpoint、Remote SSH、其他平台/跨版本矩阵，以及历史 URL 清理、Runtime disconnected 批次报告和独立 `owned-resize-failed` 调查继续作为明确验证边界；它们不是本次八场景 run 的失败项。

## 2026-10-11 双窗口删除与共享画布（共享结构已有有限证据，底层直接调用诊断保留）

原 main a39cd8c1 的直接 Supervisor deleteSession 非保留路径取消所有 socket 的 Host 信用订阅，受控 8 项 direct-credit 终态为 0；诊断干预保留另一 socket 通道后为 1。原因果记录及脚本继续保留，不能把共享结构修复说成 Supervisor 独立 delete 通知契约已修改。

用户确认共享 delete 在所有窗口移除节点，2026-10-11 已通过共享 root 结构提交/监听实现，并在 Linux 独立双窗口验证；stop 保留节点及原 reader 最终消费。旧 owner 保留 stopped 历史节点断言已按正式产品语义调整。共享结构、关闭模式 slot 隔离及旧定义下的切换测试已有有限证据；方案见 `docs/design-docs/runtime-shared-root-canvas-sync.md`，过程见 `docs/exec-plans/completed/runtime-shared-root-canvas-sync.md`。PR #319 review 后用户补充最后开启窗口切换关闭才清理共享会话并退出 Supervisor，新规则现已通过独立开启 Host/root 登记、准入锁和原 hello PID 的退出检查实现，并有 Linux 单 root 最终双窗口、Host 628/628、store 15/15 和 owner handshake 47 项的有限验证。deferred delete/edit 交错和 reader 收尾配置保护亦有实际 Host/store 磁盘回归；首轮并发 reset 失败、后续保护及最终通过分别保留。接续计划 `docs/exec-plans/completed/pr319-review-repairs.md` 和 `docs/references/shared-root-canvas/pr319-review-repair-evidence.json` 固定输入及证据，不将新规则缺口降级为技术债。

证据边界补充：上述验证对应 `e79aa66d` 在进一步确认接管规则之前的实现。用户现已确认清理期间新开启窗口可以按阶段接管，旧窗口在交接完成后不再等待被新窗口使用的原 PID 消失；已有串行登记测试不代证该规则通过。该时点的接管缺口由 `docs/exec-plans/completed/pr319-takeover-coordination.md` 接续修复：参与 listener 分阶段确认、ready 后最新状态恢复、有效原 PID 交接及失败连接释放已经落地。store 20/20、完整 Host 634/634、真实独立 Supervisor 控制/native 新执行 3/3，以及 Linux 单 root 真实双窗口复验通过，输入证据为 `docs/references/shared-root-canvas/pr319-takeover-evidence.json`。四阶段来自受控 Host/store/独立进程回归，没有把既有双窗口 smoke 描述为新增四阶段 UI 验收。旧 head 的缺口和失败记录保留，不作为当前非阻塞债务代替修复。

### 后续验证与存储成本（未验证）

责任落点 `panel/sharedRootCanvasStore.ts` 与双窗口 smoke。新增真实结构同步/切换场景本轮仅验证 Linux 单 root；macOS/Windows/Remote SSH 和真实多 root 两窗口需后续具名验证，不能借 Node API 或已有 helper 通过宣称这些组合已验。每 root 100ms 轮询和完整 JSON 比较/写入在高频大画布下的成本尚未量化；出现实际规模瓶颈时再以固定负载评估，不先承诺恒定延迟。TCP 锁哈希碰撞保守串行，新增实际碰撞的多 root held-lease 回归通过；参与 probe 超时或身份变化、外部端口长期占用有界失败。root 准入最多等待 90 秒，原 Supervisor 采用 30 秒 idle shutdown，45 秒未确认原 PID 消失拒绝成功；PID 复用同样保守失败。这些机制仍需在对应原生平台验证。直接绕过共享画布调用 Supervisor delete 的其他有效消费者仍按历史诊断范围，不外推产品共享删除已补齐所有通道。

### completed-history 旧诊断断言（2026-10-11 已修正）

`npm run test:runtime-completed-history` 的 `verifyCompletedBindingOwner` 原先将所有诊断数组断言为空；main a39cd8c1 新增正常 `execution/deleteBoundary` 后，本地与独立原 main 工作树均在同一 legacy Terminal 项失败。历史基线日志 `/tmp/dsc-shared-completed-history-baseline.log` 保留。

用户授权修正后，测试精确断言 `execution/deleteBoundary` 的 `runtime-delete-requested` 阶段、kind、sessionId 和 backendKind，不泛化过滤诊断。root 缺失 owner 的拒绝用例单独校验请求诊断及零派发，然后清空收集器再验证正常完成。原完整绑定相等、owner 传递、保存先于删除与无终态历史断言全部保留；额外 completedCleanupFailed 等诊断仍使测试失败。Node 22 下完整 `test:runtime-completed-history` 通过，覆盖 Agent/Terminal、legacy/root 及后续 reader 退役场景；只修改测试与文档，没有修改生产删除行为，也不宣称全量 npm test 通过。

## PR327 发布门禁两个首败：两处修复已验，后续 systemd 场景阻塞（2026-10-13）

原head42d87b3d/main22803dd8，GitHub预合并7e659ce6与本地ec4afba3树相同。本地local-links-and-stop缺失文件搜索9592ms接近10000ms等待；原诊断helper在取回跨deadline时漏检末批精确匹配事件，原Host时序及受控五例确认。建议明确末次观察与deadline契约、覆盖首读/末读/负例，不扩预算。搜索--no-ignore范围已证，但历史文件数/冷缓存/负载贡献未量化。

CI checkpoint基础Agent准备失败已收敛至PR328新增scripts/test/test-smoke-remote-host.mjs静默socket测试污染真实/tmp/dsc-root-<uid>目录：未指定mode创建、未清理父目录。固定输入完整诊断38382436173捕获原生产socket-directory私有权限拒绝且尚未native-assets；原17测试私有目录两组对照与干净CI38384582823直接stat确认absent→当前uid/0755被拒绝、同inode0700接受。本机已有0700掩盖污染。应让测试使用自有socket目录并自行清理，保留正式地址默认值、原deadline/17用例与生产0700要求；不能通过chmod共享目录或放宽生产检查修复门禁。

用户已授权自有socket夹具和末次观察修复，执行计划docs/exec-plans/completed/release-gate-repair.md。修复PR329待review/合入，最新预合并全量门禁仍为发布阻塞，PR327草稿/head不变；临时组合输入验证不能代替修复合入后PR327正式门禁。通用catch与失败工件缺少有界错误阶段是可观测性后续项，错误类别不得泄露敏感路径/环境。调查设计docs/design-docs/release-gate-root-cause.md与完成计划docs/exec-plans/completed/release-gate-root-cause.md记录run、input、摘要/hash和残余限制；两个临时workflow已归档并移除自动入口。受控因果对照通过不等于完整release:verify通过，历史未记录的stat不补造。


组合PR330/run38387068827的原checkpoint和local-links-and-stop场景已退出0，18项Host/三种目录隔离/36项等待/9项resize及trusted/restricted/本地real-reopen通过，两处修复验收关闭。完整npm test继续在systemd-user-real-reopen setup断言失败：agent runtime backend实际legacy-detached，预期systemd-user（real-reopen-tests.cjs:747）。该新发布阻塞未修复，原因尚未由实际探测结果确认；fake-systemctl只覆盖提交，真实systemd-run仍影响前置环境，建议下轮固定输入记录有界probe类别，复核fixture是否建立其宣称的systemd前提，不放宽backend断言或直接跳过。SSH退出/保留、后续Webview及clean-checkout VSIX本轮未触达，不代证通过。结果及首败见docs/references/release-gate-root-cause/repair-combined-input.json；临时组合PR关闭而不合并，正式PR327需PR329合入后rebase重跑。

## fake systemd 重开门禁后端不匹配：根因已确认，正式修复未实施（2026-10-13）

组合run38387068827固定08f7b0a5在原links/checkpoint通过后，systemd-user-real-reopen setup失败actual legacy-detached / expected systemd-user。该失败未修复，阻塞完整0.26.1门禁；后续fallback/SSH/Webview/VSIX未触达。fake-systemctl只替代提交，新增root scope probe仍执行真实systemd-run；原环境DBUS disabled:与私有runtime目录已有日志，该初始待验证问题由后续固定输入诊断收口。调查设计docs/design-docs/systemd-smoke-scope-root-cause.md和completed计划记录边界，不放宽backend断言或据此宣布VSCode/产品缺陷。

固定输入诊断38401537709已收敛：preferredBackends含systemd、选择前absent，真实systemd-run code1/Connection refused、原scope返回unavailable/user-bus-unavailable，继而选legacy。旧fake-systemctl没有替代新增scope前置条件，属于夹具假设失配；生产明确不可用后的fallback符合现有契约。单变量control38402006541已通过：同原输入只将probe执行者换成当前Node/原launcher子进程，原nonce/environment/user摘要校验合法，scope available选systemd-user，原setup/verify两阶段退出0。证明旧fake-systemctl未覆盖新增scope前置；生产fallback规则保持正确，不能归为VSCode缺陷。正式修复未实施，发布阻塞仍未修复。

后续建议正式修复fake成功场景的probe测试依赖边界，并保留原摘要校验、原backend断言和预算；真实bus不可用fallback及unknown/no-submit负例独立验收，不把fake通过视作真实manager已验。新证据见docs/references/systemd-smoke-scope-root-cause/，计划docs/exec-plans/completed/systemd-smoke-scope-root-cause.md。两个临时workflow已归档移除；原完整失败不被诊断control通过覆盖。


## 发布门禁关联修复集中收口（2026-10-14，PR329，组合完整已验证）

上述“正式修复未实施”为诊断结束时的历史状态。用户授权继续修复后，PR329纳入PR331最终根因/控制证据、原两个修复及WORKFLOW约定；新增TEST_SYSTEMD_RUN_SHIM明确覆盖fake成功场景前置probe，转发原只读launcher并保留原回执/摘要校验、预算和后端断言。默认真实systemd-run和fallback/unknown规则不变；fallback显式清空依赖并保留零systemctl提交验收。相关回归及临时组合0.26.1完整验证已通过第四轮38426726365，修复尚未合入，不追认已发布。接续计划docs/exec-plans/completed/release-gate-consolidated-repair.md。


集中修复接续：首轮38412908952已通过原fake systemd两阶段；fallback启动前VSCode因空XDG_RUNTIME_DIR选择129字节user-data IPC路径，超Linux107字节并listen EINVAL。PR329继续补齐fallback短user-data，不改空bus、真实probe、legacy或零提交断言；完整门禁仍失败，SSH/Webview/VSIX未触达。证据与正式方案见systemd-smoke-scope-root-cause.md。

第三轮44282298/run38417836576已过systemd/fallback零提交/SSH退出保留，Webview425/426首败4319像素字体差异；clean-checkout未触达。CI系统Noto对照38424638753仍24像素失败；PR329固定原基线Regular中文字体子集，仅Linux基线用例使用，原PNG/预算/像素断言保持。本地原断言通过，干净CI和最终组合完整结果仍待验，详见systemd-smoke-scope-root-cause.md。

截图单变量结论：固定字体Ubuntu24.04仍24像素；同输入、同Chromium切22.04/run38426201759严格断言通过，正式preflight和tag prepare固定22.04。原失败证据保留，最终同输入六平台+完整release门禁重跑中；不将截图单项通过当完整发布通过。

最终集中修复验证（2026-10-14）：第四轮38426726365固定32ec277b同输入六平台资产与原完整release:verify exit0，SSH退出/保留、systemd/fallback零提交、Webview426/426、clean-checkout生产VSIX及八场景packaged smoke通过。PR329正式夹具修复已验证，原失败限定历史输入；PR327仍独立draft，修复合入后rebase及正式最新预合并门禁仍是发布前要求，不追认已发布。最终证据full-gate-fourth-result-38426726365.json。


## Marketplace 发布提示门禁竞态修复（2026-10-14）

PR327/run38485499547在原版本发布提示断言失败；请求计数不能证明客户端响应解析/Webview消息/用户提示已完成。两处等待从2026-06-26起未变，近期只更新文案，相关四文件与旧成功input相同；响应阻塞对照确认可确定复现的门禁竞态，但原CI具体调度因素/VSCode1.141.1因果未采样确认。

用户授权独立修复PR后，两处场景在同一原20秒预算等待唯一请求和原准确提示，保留认证/请求内容/发布结果与v3 UI验收。实际场景VM回归20/20通过，旧代码两类延迟反例均失败，缺失/错误提示和请求数量负例继续按期失败并恢复拦截器；真实VSCode1.141.1自然与临时300ms延迟响应E2E均通过，正式HTTP夹具未改。设计与证据见docs/design-docs/marketplace-publish-smoke-completion.md；生产逻辑及版本不变。修复仍待review/合入，PR327保持独立发布准备及正式最新预合并完整门禁要求；定向通过不代证全量npm test或最终发布。


## PR327 packaged trusted 最终保存 pending（2026-10-15，正式修复验收通过）

run38579057915原输入9f602fed的npm test/SSH两态/Webview426/七packaged通过，最后trusted最终保存即时检查pending失败。真实Host8项对照证明owner settled不等于save settled，当前reset拒绝符合§26.3；本地1.141.0整套trusted通过，原具名调用及后续保存结果仍需CI观察。未修改产品、未解锁发布。设计local-final-snapshot-boundary-root-cause.md，active计划记录输入和边界。后续修复/根因/回归集中一个修复PR，PR327保留。

接续收口（2026-10-15）：同输入CI38596179995复现模板verifyCanvasTemplatesTrusted:1138，Agent关闭与保存submitted后即时pending，8ms后同执行saved。38605013416同Agent started/保存结果交接gate确定性probe pending、control原saved后二次reset及完整trusted通过；38603542973诊断Terminal started前提失败保留，不当作新产品首败。根因为本例cleanup未接入既有reset最终保存夹具；原S8安全拒绝符合契约，不延长超时。调查已完成；用户后续已授权下述正式修复，PR327最终正式输入的完整门禁仍须重跑。证据docs/references/local-final-snapshot-boundary/，completed计划local-final-snapshot-boundary-investigation.md；后续代码/回归/根因集中一个修复PR，不单建文档或验证PR。

正式修复接续：保存导出后清理接入原reset helper，原Agent/Terminal期望；新增正式调用点回归旧代码pending先红、修后9/9及原19/19通过。产品保护和20秒预算不变；正式代码84d65765的原生run38656199224在VS Code1.142.0触达原Agent/Terminal submitted/pending，同身份saved后第二reset空画布，完整trusted exit0；生产bundle与研究输入一致。完整PR327临时组合031db473/run38656127632的同输入六平台资产、静态preflight、完整npm test、SSH两态、Webview426/426和8个clean-checkout packaged场景含trusted全部通过，release:verify exit0；临时活动workflow已移除。修复尚未合入，PR327正式最新预合并仍须rebase后重跑，未放行合并或发布。completed计划smoke-template-final-persistence-repair.md，证据repair-result.json。

交付状态：修复PR [#334](https://github.com/ZY-WANG-0304/dev-session-canvas/pull/334) 已创建，代码、根因、回归和验收集中；本项实现及组合验收完成。剩余发布责任为该PR合入后rebase PR327，并以最新正式预合并输入重跑完整门禁；临时组合031db473不代替此步骤。最终收口仅文档，PR327草稿及原head保持。

## 0.26.1 发布门禁流程控制与覆盖缺口（2026-10-15）

完整流程审查确认：main 没有有效保护/ruleset；release:verify 继承 smoke filter，trusted 可将默认源码19/packaged8缩为1/1；PR与tag prepare失败未自动上传完整宿主/clean-checkout现场。普通VS Code启动等待进程退出无独立期限，浮动stable/Node patch影响重现。标准链有notifier源码/build但不含独立类型、回跳/locale smoke；普通无契约PR成功skip不证明功能回归通过。影响是强制性、验收范围、首败复盘和补充验收可追溯性，不代表已确认所有未接线named script完全没有覆盖。

当前边界：本次只审查/出图，未修改门禁或远端设置；正式workflow默认无filter，0.26.1仍要求原样完整verify。已有恢复撤销订阅生产竞态仍单独阻塞，诊断通过不替代修复与最终PR327验收。建议在门禁后续修复中先处理过滤保护、有限取证、Host进程期限，并由管理员配置required check；按契约补notifier独立证据。普通PR回归、固定/最新双宿主与重复构建优化可随后推进，不借审查扩张当前产品修复。所有关联文档/回归继续当前PR335范围，发布材料保留PR327；报告与准确代码/API锚点见docs/design-docs/release-gate-flow-audit.md，证据/图见docs/references/release-gate-flow-audit/。


## 分层CI真实验收与覆盖边界（2026-10-18）

现有迁移与新验证图在PR335 ed9257bd/真预合并1d9bb54b的39128423778及未改PR327最新临时组合/真输入63b168e2的39128957644完成整批验收：各247 jobs全成功，分别324/324与330/330必跑通过，actual/passed均330；118 source/104 packaged、六native、两个Marketplace Host及三x64原样安装同批通过。原aggregate/acceptance、同批双包及六安装报告按actual producer/ZIP/bytes分别独立验真；PR335原431功能/3视觉按冻结434目录独立核通过、retry0。原业务期限、一次公开动作、原身份/Stop/保存/reader/退役断言保持。最终文档新head另验，完整原始来源和保留历史见实施目录。

此前第九轮39119709105虽已有118 source/104 packaged、六native操作、两个Marketplace Host与三x64原样安装同批通过，中文Stop二次时钟合同和覆盖快照pending计数仍使原整轮失败，严格拒绝31task（含失败producer连带项），293/324 required，无acceptance。修正有同原production bundle受控先红后绿、114合同及429功能/3视觉证据，后续精确恢复基线再补115合同与434目录；这些历史失败不由当前整批通过重写。

同head与未改PR327的真实临时组合39119845747已330/330、247 jobs全成功；原aggregate/acceptance实际producer、ZIP及精确双parents独立核验，结果仅属于该输入。两项独立已确认产品竞态（旧代恢复迟到撤销当前订阅；生产mode-switch删除期间仍接纳callback并缓存失败）未修，持续阻塞0.26.1；不能靠偶发绿色、增加等待或删断言关闭。历史real-reopen45秒未ready、panel10秒缺焦点、CIM服务阻塞机制和macOS原EPERM继续未定因，当前实跑通过不当作永久修复。

PR335已实现固定输入/实际Actions来源、15验证job、六发布job、一次clean双包、消费式packaged和三x64原样安装；当前整批通过不改变第四轮39097246318的packaged103/104和7个失败job历史。原源码字符串、官方macOS入口、安装CDP观察及合成MouseEvent缺view各保留受控证据与修正回归，不将历史单项通过拼接为新的完整验收。渠道模块仅完成本地HTTP/内存合同，不据CI绿色宣称真实交付验证完成。

main保护API仍404未保护，稳定检查尚不具备强制合并阻断；正式设置需实际负例验证。152设计目的地中15新增范围仍明确not-implemented，真实TUI完成信号尚未选定，其余最低宿主、arm64安装、真实systemd/桌面呈现/Marketplace自动依赖和渠道重签边界不外推。生产旧代恢复撤销订阅竞态已复现未修，仍是0.26.1阻塞；CI迁移不能删除原身份/Stop/保存/reader/退役断言或用新等待抹去故障。已完成实施计划release-gate-implementation.md、正式设计release-gate-redesign.md、原竞态legacy-supervisor-stop-timeout-investigation.md分别可追溯。


## PR335 非真实 TUI 缺口覆盖（2026-10-20）

用户授权先覆盖原十五项中的十一项。source/packaged独立入口、双Host角色回执、原process身份absence、真实几何和全量输出断言已实现，默认regression补登记production owner的Stop故障与sticky unknown合同。152目的地现148 implemented-unverified/4 not-implemented；这不代证完整新输入验收。四个真实TUI场景保留待覆盖，完成信号仍未选定。最低宿主、arm64原样安装、真实systemd/通知/渠道等既有边界继续独立存在，不因本轮关闭。计划见active/smoke-non-tui-gap-coverage.md，结果按实际运行记录。

## 恢复订阅竞态独立修复的验收边界（2026-10-24）

`runtime-restore-subscription-fix` 已实现完整恢复任务共享、实际 RPC 派发前资格及断连代次。原 main 22998ff4 的真实 socket/PTY 对照确认订阅 true→false；修复后同一测试单次/并发订阅、真实 I/O/Stop/终态 ACK 通过。完整协议链、Host 634/634、类型/build 与 VS Code 1.142.0 原旧升级具名场景通过；证据见 `docs/references/runtime-restore-subscription-fix/result.json`，设计与计划同名。正式 CI、复审及合入状态仍需针对新 head 确认，不能称为最终发布验收。

Host 首次全套与协议链并行时，未改的 PR319 原 PID 等待用例超出原 3 秒，单项和随后串行 634/634 均通过；原始失败保留，未确认是否由资源调度引起。若再现，应固定输入核对原子进程与实际等待时间，不延长业务期限来掩盖故障。原生 VS Code 日志还出现 watcher ENOSPC，场景最终通过；本轮未改变系统配置或清理其他工作的进程。两者作为环境/复现 follow-up，不作为本恢复修复的确定性 blocker。

最初恢复修复没有覆盖生产模式切换删除期间迟到回调及失败缓存；用户后续已授权在 PR336 接续实现，见下节及 `runtime-mode-switch-settlement.md`，保留两项证据边界。PR327 必须在所需修复合入后再次 rebase，并对最新正式预合并输入完整验收。本轮 Linux、受控快照/UI、复用依赖/资产和单项自然 GUI 不外推多 root、跨平台或真实 provider 完整验收；历史首败唯一归因缺口保留。


## 模式切换结算修复的验收边界（2026-10-24）

PR336 已接续实现原绑定回调结算、旧 workspace 保存代次和失败阶段继续。旧输入确定失败、当前行为和真实 socket/PTY 回归通过；共享窗口/多 root 及四阶段接管继续沿原保护，定向结果见 `docs/references/runtime-mode-switch-settlement/result.json`。提交后自查补齐首轮 drain 的错误传播：第一次异步等待前登记已接纳回调，旧输入先红、最终第 21 项通过，接续证据为同目录 followup.json。未知删除不得重新派发或清掉责任，真实持久化错误仍明确失败，不能承诺所有存储错误都可自动恢复。

旧 PR336 head 2f219c89 的 CI40096144651 首败为 `source-host(remote-ssh-real-reopen-exit)` editor Canvas ready 45000ms，尚未完成根因归属。新 head 必须取得自己的正式 CI；本轮模式切换局部通过不能证明该 ready 首败已修。Linux 自然 GUI 与受控时序不外推跨平台、真实 provider、多 root GUI 或最终 PR327 预合并门禁。watcher ENOSPC 和历史 Host PID 3 秒等待偶发失败继续按原证据追踪，未通过延长期限或改系统配置绕过。


### PR336 review 两项缺口接续（2026-10-24）

4d455028 的 P1（保存失败后成为最后参与者却跳过删除）与 P2（终态投影清除 live 字段后丢失 pending 保存失败）已在本轮修复：每次共享 departure 重验原绑定删除，Promise 登记保留接纳时的完整身份，首轮已知保存失败在派发删除前传播。新增八项默认行为回归，两个旧输入反例均先红，当前 29 项通过。证据见 `docs/references/runtime-mode-switch-settlement/review-fixes.json`。必须针对更新 head 复审和验 CI；旧 head 的本地/GUI 通过不能替代该复审，也不表示 PR327 已可合并。

## 0.26.1 重新准备的验证与用户边界（2026-10-13）

本次从 ea0c9b19 主线重建发布输入，旧 PR #313 已舍弃；过程和结果见 docs/design-docs/release-0-26-1-refresh.md。标准完整 release:verify 已执行并在 localhost SSH 首败，结果见下节；0.26.0 历史授权不得代用。此前主线独立 npm ci 的 Wrangler/esbuild ETXTBSY 具体写者未确认，前台生命周期脚本对照通过仅是环境证据；下一正式验证若复现，采集写者与生命周期并发，再决定 PR/tag 两条安装链路是否需要同一调整，不跳过脚本或自动豁免。

普通 Canvas 打开没有专门的 ready 截止和启动失败重试/重建，持续启动失败可保持空白；上游快速重开资源积压、单次 fallback 首败未定因继续按 webview-ready-root-cause.md 与 smoke-reopen-ready-timeout.md 跟踪。45 秒是 smoke 容忍预算，不是产品恢复能力。共享画布真实 UI 限 Linux 单 root，接管四阶段由受控 Host/store 和独立 Supervisor 验证；跨平台/Remote SSH/真实多 root、真实 provider、公开市场自动安装依赖与桌面点击需要具名补证。以上不因本地测试通过自动升级为支持承诺。


### 历史聚合首败：localhost SSH 离线完成前提（PR328合入前，2026-10-13）

预合并 eba53a28 的标准 release:verify exit1，完整 npm test 停在 remote-ssh-real-reopen。页面 ready 和原 Agent/普通Terminal附着正常，旧升级resize通过；第三个Terminal等待setup process.pid2613433消失而未完成。窗口关闭后旧remote Host仍有日志，server配置三小时重连宽限并保留旧连接，精简首败及输入见docs/references/release-0-26-1-refresh/remote-first-failure.json。超时瞬间没有进程状态采样，不把推断当成完整根因确认，也不借此修改产品退出语义。

后续先固定原远端Host PID/启动身份，在关闭及超时瞬间核对存活/僵尸/重连责任，再显式设计测试的离线完成触发和关闭边界。修复保持原会话、正文、输入、退出状态和无历史断言，不能通过延长等待、无条件杀远端Host或重跑跳过首败。本发布准备只记录阻塞并补充独立验证，完整verify未通过前不能合并或打发布tag。


本次独立补充验证已完成：Webview426/426、默认干净npm ci/140文件主VSIX/八场景安装、notifier类型/14文件独立包/companion/en与zh-cn locale均exit0。默认安装ETXTBSY未重现，不等于原根因修复；源码聚合SSH首败仍阻断。12条命令证据固定在docs/references/release-0-26-1-refresh/evidence.json。main无branch protection的只读查询结果不撤销仓库完整verify/review要求，草稿不会触发非草稿release workflow。

2026-10-13接续：PR328的双状态正式修复已合入main22803dd8，PR327 rebase后重跑最新预合并完整门禁。上节旧输入的SSH首败不作为新输入状态，原记录保留；当前门禁结果关联PR327真实head/base/预合并SHA及checks。


## PR329合入后的0.26.1正式发布门禁（2026-10-14）

PR329已合入main72338331，PR327由原head42d87b3d rebase到该主线。上述“待合入”“未修复”及失败均为其固定历史输入状态；自有socket、末次诊断观察、fake probe、fallback短IPC和截图依赖已有集中修复与组合完整通过证据。正式发布准备仍必须在最新PR预合并SHA重新生成六平台资产并通过完整release:verify；当前结果以PR327最新head对应的描述/checks为准，不以旧临时组合代证。真实provider、跨平台共享接管、公开市场自动依赖及桌面点击等有限验收边界保留，不因门禁通过扩张支持承诺。


## PR332合入后的发布输入复验（2026-10-14）

Marketplace完成等待修复PR332已合入main f3bb4425。其“待review/合入”为修复交付时的历史状态；PR327由a95b69b0 rebase到最新主线并重跑正式完整发布门禁。原run38485499547首败与未触达范围保留，不以20项回归或真实1.141.1单项通过代证全量；当前输入与结果以PR327最新head/base/预合并SHA/checks为准。
