# CI 改造的实施与验证输入

此目录属于参考证据，不取代正式设计和逐任务验收。正式决策在[release-gate-redesign.md](../../../design-docs/release-gate-redesign.md)，推进状态在[实施计划](../../../exec-plans/active/release-gate-implementation.md)。实现和证据继续随 PR335，发布 PR327 保留。

[local-results.json](local-results.json)记录当前实际目录、代码摘要、本地回归和旧资产诊断结果。完整80项regression同批通过，83项合同通过；423前端功能、3固定视觉及Marketplace浏览器通过。SSH原Host退出/保留和两个Marketplace Host新包装器均有实际本地诊断。旧dist/native输入明确仅诊断，没有修改inputCommit或将它们算入新SHA验收。

首败现场保持独立：SSH第二轮证实Host缺少继承env，第三轮systemd路径及重复reset cleanup失败；第四轮两态通过。Marketplace第一轮IPC/Xvfb路径失败，第二轮preview语言前提失败，第三轮显式语言包/locale后通过。fixture修正保留原产品等待和断言。真实SSH必要证据导出42文件、461626bytes，原依赖缓存不上传；内容清单复算、结构化文件超限、篡改、取证超时和活动checkout并发清理均有反例。

真实Actions首轮[39093713215](https://github.com/ZY-WANG-0304/dev-session-canvas/actions/runs/39093713215)以预合并354e6129运行后取消；第二轮[39094300198](https://github.com/ZY-WANG-0304/dev-session-canvas/actions/runs/39094300198)以预合并040883c8运行失败。三个regression分片、输入、production前端/视觉、Marketplace浏览器、Linux/macOS四native操作通过，六native-load均通过；完整结果没有拼接成验收。首轮文件名/浏览器依赖修复生效；Windows两架构实际正文被OSC标题前缀干扰raw换行观察，新版gh拒ANSI日志，以及production CSS .82/0.82字符串误判已有证据并修观察，原15秒/实际几何/退出/清理和生产构建保留。新HTTPcollector独立下载首轮六asset并核真实producer/ZIP hash，首轮取消仍不产生acceptance。

本轮gate合同59/59及渠道/恢复合同29/29分开实跑通过；Windows终端标题/回显/wrap和错误几何反例通过，Linux旧asset有限操作仅诊断。production CSS单项变更前稳定失败、数值语义修后通过。真正clean双包、消费式packaged、三个原样安装、Actions来源全量聚合以及PR327最新预合并完整验收尚未触达，继续按真实SHA/run/attempt补证据。设计映射中的152名称只代表目的地；137项implemented-unverified与15项not-implemented不能计为产品通过。main未配置保护检查；已复现生产恢复撤销订阅竞态未修，当前不能发布0.26.1。
