---
title: restricted Canvas 首次 ready 超时根因调查
decision_status: 已选定
validation_status: 验证中
domains: [VSCode 集成域]
architecture_layers: [宿主集成层, 画布呈现层, 适配与基础设施层]
related_specs: []
related_plans: [docs/exec-plans/completed/smoke-restricted-ready-investigation.md, docs/exec-plans/active/smoke-lifecycle-diagnostic-isolation.md]
updated_at: 2026-10-15
---

# restricted Canvas 首次 ready 超时根因调查

## 问题与结论

确认了测试诊断与真实页面启动交错的竞态：`CanvasPanelManager.runWebviewLifecycleRaceDiagnosticsForTest()`临时切换到fake panel，跨await保存和恢复两个承载面的状态；真实editor在期间发出的唯一ready被接受，但随后被finally恢复的旧ready=false覆盖，bootstrap也未发出。后续open复用原页面，ready不会再发，20秒超时。已在固定发布输入自然复现并以真实消息投递时序对照验证机制；正式方案已选择独立诊断对象，隔离实现与两真实面三时序回归已完成，原生与完整组合门禁仍待执行。

原正式门禁为PR327预合并9198cacbee91fc170b82578e353c16a27f3574b8（base6e708c6b/head8313fc72），run38665513172 attempt2。源码checkpoint与trusted通过，restricted在`runRestrictedSmoke`第一次ready等待20000ms超时，尚未进入restricted模板和后续完整门禁。原workflow未上传Host现场，因此不能逐事件追认原CI一定只有这一原因；本轮已确认同输入、同错误入口的真实可触发缺陷。

## 责任链路与时序

`tests/vscode-smoke/extension-tests.cjs:runSmoke`先打开editor、验证默认指南模板、reset并清日志，然后执行`verifyWebviewLifecycleRaceDiagnostics()`，最后进入trusted/restricted。前面的模板检查只读Host状态，不保证页面ready。该诊断调用测试命令，在`extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts:runWebviewLifecycleRaceDiagnosticsForTest`保存`activeSurface`、两个面的mode/ready/lifecycle/messageWebview及消息/诊断数组；把活动面改为fake panel后，通过多个await检查fake frame行为。

自然采样run38677150708 sample1第一轮的现场如下，时间为UTC：

| 时间 | 真实行为 | Host状态 |
| --- | --- | --- |
| 03:37:11.493 | reset完成 | editor generation2，ready=false，visible |
| 03:37:11.499 | fake panel诊断开始 | 保存旧editor状态，activeSurface=panel |
| 03:37:11.513 | 真实editor唯一ready到达并被接受 | editor ready=true、有真实frameId；活动面仍panel |
| 03:37:11.603 | 诊断finally恢复旧快照及诊断数组 | editor ready=false、frameId被清除；ready证据也从数组消失 |
| 03:37:11.610 | restricted再次打开，开始等待 | 同editor、mode=active，未重写HTML |
| 03:37:31.637 | 20027ms后超时 | editor一直active/visible，ready=false、ack=false |

`handleWebviewMessage`正常接受了editor ready，但`isInteractiveSurface`要求当前活动面匹配，故没有调用`bootstrapInteractiveSurface`。`restoreSurfaceLifecycleStateForTest`随后无条件写回旧ready/lifecycle；这不是新页面身份失配，而是旧状态回滚真实进展。`revealSurface → ensureActiveSurfaceRendered`看到mode=active后直接复用HTML，前端`main.tsx:App`的空依赖useEffect只发一次ready；它不会因Host回滚重复发送。延长ready预算不能恢复丢失事件，单独保留ready字段也不足以补回bootstrap及确认。

该保存/恢复代码和smoke调用从2026年6月就已存在，`git blame`定位到9dc8ebac及533b09ff，#334没有修改它们。新旧代码长期未改动不排除调度触发旧竞态；本轮未证明VS Code1.142.0引入了新的上游缺陷。

## 验证证据

所有实验checkout固定9198cacb，复用正式run38665513172同输入六资产，Ubuntu22.04/Node22.23.3/default npmci/VS Code1.142.0。源码restricted单项过滤只服务定位，外部180秒限时不改变原内部20秒ready条件，原业务断言不变。

原版单项run38676791045完整restricted exit0，排除必现失败。只读阶段采样run38677150708共执行19个新profile：sample1首次同入口失败后停止，另3个runner各6次通过。此频率只是本批观察，不是总体概率；日志增加会改变调度，不能当成原样复跑。失败zip314164577bytes的完整本地副本、hash和failure snapshot保留；其他3份大工件保留远端来源/hash，本地只读取并完整核验其开头的日志和exit条目，不声称完整下载。

受控run38678148402包含两组。`during`仅暂存并在fake panel诊断期间投递原editor ready，不伪造或重复消息；确认投递后ready=true、恢复后false，原restricted入口按20秒失败（smoke exit1）。该job的成功只代表预期失败及因果断言成立。`before`在原位置等待真实editor ready和bootstrapAck，然后运行原诊断及完整restricted，原frame/generation/ready/ack均保留、smoke exit0。这验证当前首次启动时序前提，但不是并发状态隔离已完成或正式修复已落地。

原日志与完整工件保存在`/dev/shm/restricted-ready-evidence`。可复核精简结果、原失败快照、自然时序、输入hash及可复跑诊断脚本见[证据入口](../references/smoke-restricted-ready-root-cause/README.md)。没有修改VS Code包、断言、截图或预算。临时workflow已在59397b38ce301755281816a83f8e42d0a44ef1cd移除，未创建诊断/验证/文档PR，PR327输入和draft状态保持。

## 影响与排除边界

本缺陷在测试模式诊断入口：`extension.ts:registerTestCommands`与方法自身均检查`isTestHarnessMode`，仅ExtensionMode.Test或显式smoke环境注册/放行。普通安装打开Canvas不执行该诊断，不能把这个fixture污染归为普通用户必然空白。若明确启用测试模式且在真实页面启动中调用该命令，可受影响；源码trusted也有同一前置诊断，不能因为本轮trusted通过就认为只限restricted。

原正式日志CSS/JS在02:20:02.625/02:20:02.635Z已读取完成；自然失败同时捕获ready被接受，故本机制不需要资源排队、前端崩溃、trust拒绝或reset清ready。历史fallback重开和VS Code连续关闭请求积压仍保留各自范围，不由本轮归因或成功对照替代。checkpoint首跑停滞也属于另一个未确认问题。

## 修复候选与验收建议

优先将fake生命周期诊断放在与真实Canvas状态隔离的测试对象上，避免跨await覆盖真实面的状态、消息、读者及事件责任；产品消息筛选和bootstrap规则保持。当前首开ready/ack完成后再运行诊断可以消除本次时序窗口，但仅作为受控候选，不能证明真实面在任意交错下安全。不能仅延长等待、强写ready=true、重发假ready、只删editor恢复语句或吞超时，因为bootstrap以及其他状态仍可能被污染。

正式修复应覆盖ready在诊断前、期间和结束后到达三种时序，验证原frame/generation、ready、bootstrapAck及消息接收可用，fake旧帧/竞争帧拒绝断言不降低。原生restricted与trusted继续通过，且保留不发送ready仍按原20秒失败的负例。修复、根因、回归与证据集中同一个修复PR；修复合入后再rebase PR327并跑最终正式预合并完整门禁，不能以本轮19次采样或两项控制放行发布。

## 正式方案

`CanvasPanelManager.ts:runWebviewLifecycleRaceDiagnosticsForTest`保留测试模式守卫，创建与真实对象没有可变引用共享的诊断对象后调用独立诊断方法。新对象使用真实类 prototype，显式初始化 lifecycle/mode/ready、消息目标、fake 页面、焦点、可见性、bootstrap 队列、probe/DOM 请求、诊断日志、终端通知与读者容器；不运行生产构造器，不注册 Host 监听器、磁盘持久化或后台定时器。禁止复制 this 或将其作为 prototype；真实 editor/panel 不暂停、不切换、不恢复快照。

bootstrap 内容使用独立空 Canvas 状态和调用前同步复制的 runtime 展示配置；诊断目录为独立空目录，默认模板不应用。替换的是外部数据与序列化边界，`handleWebviewMessage`、帧 promotion/current 校验、`bootstrapInteractiveSurface`、`postState`、消息排队/确认、焦点重放及请求匹配仍执行正式方法。晚到目录回调仍指向独立对象；finally 只清理独立请求定时器、fake 引用与队列，异常也不会清理真实责任。

适用范围仅测试生命周期诊断，普通打开与消息协议保持。回归覆盖两种真实承载面的 ready 前/期间/后交错，真实 bootstrap/ack 和帧身份、读者/请求/焦点/事件保留，所有既有 fake 竞态断言不降低。原生 trusted/restricted 与完整组合发布门禁仍待执行，不能提前宣称修复或发布通过。推进与命令见关联执行计划。
