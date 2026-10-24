# 生命周期诊断隔离修复证据

根因历史证据见相邻 smoke-restricted-ready-root-cause；本目录记录修复回归与后续组合门禁及packaged根因调查。当前基于 origin/main6e708c6b 的修复分支，Node22.23.3。实际加载 CanvasPanelManager，VS Code 与 payload I/O 为替换边界。两真实面三种 ready 时序、诊断成功/异常时真实队列/请求/读者/通知/事件保留、无 ready 不伪造及生产守卫通过。旧源码 during 负对照 exit1：真实 ready 没有产生 bootstrap。原 fake 竞态全部 boolean 断言保留。

本地类型检查、CLI 生命周期分析及消息协议测试通过；依赖由已有锁定安装副本移到 devshm，不能作为 default npmci 发布证据。Host owner wiring 全套634/634通过；摘要与完整日志hash见host-owner-wiring-summary.json。完整原生与组合发布门禁已完成，固定输入及run见combo-input.json，三种原ready时序均完整restricted exit0并确认实际bootstrapAck；不投递原ready保持20秒exit1，预期失败断言通过。controlled-results.json及对应源码hash、same-run-assets.json保留固定输入与结果；original-ready-control.py及combination-workflow.yml可复跑。无过滤完整发布门禁exit1，记录不得称为发布通过。

完整run38681093813日志已确认checkpoint、trusted、restricted、本地重开、多根重开、单根转多根、双窗口及fake systemd-user重开通过；systemd-fallback、SSH退出/保留及426项Webview随后均通过。此前日志停更只是获取延迟，不能归为代码卡点；同输入两份限时阶段诊断也均通过。完整命令于04:54:17Z以failure结束，最新可得日志位于clean-checkout packaged trusted启动；首败栈和snapshot已核验，原clean-checkout现场没有被外层工件收集器保存。未将完整门禁标为通过。

run38685094467在同组合输入与同run六资产、默认npmci下执行原test:vsix-smoke trusted，exit0且VSIX packaged-payload smoke passed (trusted)。完整工件已下载，hash和范围见packaged-trusted-result.json。这只是单项非必现对照，不能替代首次完整clean-checkout门禁failure。

最终原job已结束failure，7.2GB工件11950986000已上传。完整job尾日志捕获首败：packaged trusted verifyLiveRuntimePersistence→waitForRuntimeExecutionStarted超时，Agent lastRuntimeError为Execution start was rejected-before-acquire；真实editor ready/ack=true。同输入packaged对照已确认旧存储退役与立即启动的夹具竞态，原完整CI具体时序缺少逐事件现场，不能归为ready隔离回归；原snapshot/stack见packaged-first-failure.*。完整工件未下载，不称为完整本地核验。

本轮packaged根因见admission-investigation-result.json：原Supervisor134项通过；run38688776387自然trusted exit0，hold-deletion在retainedRetirements=2且starting=0时原15秒exit1，wait-retirement延迟500ms并等待原两份实际删除后完整trusted exit0。三份完整ZIP均核验CRC/tar内容，入库*-trace.json保留原session身份与事件；admission-probe-input.json记录源码前/后hash，admission-probe.py和admission-workflow.yml为临时诊断输入副本。上一有效run38688569741三份结果一致并完整本地核验，更早语法错误run已取消且不计产品证据。调查活动临时入口在ea62310d移除；上述调查样本未改正式实现或重新宣称完整门禁通过。

用户授权后的正式修复已接入verifyLiveRuntimePersistence：原两会话在独立固定socket上的只读exists=false及节点live=false才允许原重启，停止/查询/等待共用15秒。retirement-local-validation.json记录本地输入及日志hash；17/17夹具、136/136实际Supervisor、36/36原等待边界、类型检查和复用固定六资产build通过。retirement-old-negative.log记录旧具名调用抢跑先红。此时尚未运行新原生及完整组合门禁，不作为发布放行。

新run38692163764六资产完整下载/CRC/manifest核验，完整门禁首败为源码trusted拒绝smoke查询（原snapshot为legacy-detached，后更正systemd归因），已补齐unit显式模式。原生对照首轮在前置图片链接失败，复跑38693259026原helper644ms通过真实500ms延迟删除因果检查，后续文件打开等待失败；retirement-first-validation.json和retirement-native-partial-trace.json保留exit1、局部通过范围与原session时序。新systemd修后全输入验证仍待完成。

run38694282830原生完整trustedexit0/645ms，最终原身份trace、输入与六资产hash已核验入库。完整源码trusted仍失败，已查明run-vscode-smoke.mjs依靠ExtensionMode.Test但未显式置smoke标志；初次systemd定因按原snapshot更正为legacy-detached。源码prepare/launch显式置1、原main两调用VM回归旧入口先红、18/18与env检查通过；新完整输入待验证。

最新55c619ad/run38696319881无过滤完整门禁已结束exit1，六资产与完整源码trusted/restricted通过，新的首败为旧代Terminal停止30秒仍stopping/live=true，根因未确认。完整工件4027382bytes本地CRC/tar核验，原snapshot/诊断/resize及简要stack随retirement-source-full-result.json入库；后续矩阵和本次clean-checkout未触达。具名退役修复已验证，完整发布仍阻塞；三个临时活动入口与依赖链接均已移除。
