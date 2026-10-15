# 生命周期诊断隔离修复证据

根因历史证据见相邻 smoke-restricted-ready-root-cause；本目录记录修复回归与后续组合门禁。当前基于 origin/main6e708c6b 的修复分支，Node22.23.3。实际加载 CanvasPanelManager，VS Code 与 payload I/O 为替换边界。两真实面三种 ready 时序、诊断成功/异常时真实队列/请求/读者/通知/事件保留、无 ready 不伪造及生产守卫通过。旧源码 during 负对照 exit1：真实 ready 没有产生 bootstrap。原 fake 竞态全部 boolean 断言保留。

本地类型检查、CLI 生命周期分析及消息协议测试通过；依赖由已有锁定安装副本移到 devshm，不能作为 default npmci 发布证据。Host owner wiring 全套634/634通过；摘要与完整日志hash见host-owner-wiring-summary.json。完整原生与组合发布门禁已启动，固定输入及run见combo-input.json，三种原ready时序均完整restricted exit0并确认实际bootstrapAck；不投递原ready保持20秒exit1，预期失败断言通过。controlled-results.json及对应源码hash、same-run-assets.json保留固定输入与结果；original-ready-control.py及combination-workflow.yml可复跑。无过滤完整发布门禁尚待完成，记录不得提前称为发布通过。

完整run38681093813日志已确认checkpoint、trusted、restricted、本地重开、多根重开、单根转多根、双窗口及fake systemd-user重开通过；systemd-fallback、SSH退出/保留及426项Webview随后均通过。此前日志停更只是获取延迟，不能归为代码卡点；同输入两份限时阶段诊断也均通过。完整命令于04:54:17Z以failure结束，最新可得日志位于clean-checkout packaged trusted启动；具体首败等待日志/工件，后续证据收集仍运行。未将完整门禁标为通过。

run38685094467在同组合输入与同run六资产、默认npmci下执行原test:vsix-smoke trusted，exit0且VSIX packaged-payload smoke passed (trusted)。完整工件已下载，hash和范围见packaged-trusted-result.json。这只是单项非必现对照，不能替代首次完整clean-checkout门禁failure。
