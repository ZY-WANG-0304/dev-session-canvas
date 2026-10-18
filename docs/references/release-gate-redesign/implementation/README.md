# CI 改造的实施与验证输入

此目录属于参考证据，不取代正式设计和逐任务验收。正式决策在[release-gate-redesign.md](../../../design-docs/release-gate-redesign.md)，推进状态在[实施计划](../../../exec-plans/active/release-gate-implementation.md)。实现和证据继续随 PR335，发布 PR327 保留。

[local-results.json](local-results.json)记录当前实际目录、代码摘要、本地回归和旧资产诊断结果。完整80项regression同批通过，83项合同通过；423前端功能、3固定视觉及Marketplace浏览器通过。SSH原Host退出/保留和两个Marketplace Host新包装器均有实际本地诊断。旧dist/native输入明确仅诊断，没有修改inputCommit或将它们算入新SHA验收。

首败现场保持独立：SSH第二轮证实Host缺少继承env，第三轮systemd路径及重复reset cleanup失败；第四轮两态通过。Marketplace第一轮IPC/Xvfb路径失败，第二轮preview语言前提失败，第三轮显式语言包/locale后通过。fixture修正保留原产品等待和断言。真实SSH必要证据导出42文件、461626bytes，原依赖缓存不上传；内容清单复算、结构化文件超限、篡改、取证超时和活动checkout并发清理均有反例。

真实Actions首轮[39093713215](https://github.com/ZY-WANG-0304/dev-session-canvas/actions/runs/39093713215)以预合并354e6129运行后取消；第二轮[39094300198](https://github.com/ZY-WANG-0304/dev-session-canvas/actions/runs/39094300198)以预合并040883c8运行失败。三个regression分片、输入、production前端/视觉、Marketplace浏览器、Linux/macOS四native操作通过，六native-load均通过；完整结果没有拼接成验收。首轮文件名/浏览器依赖修复生效；Windows两架构实际正文被OSC标题前缀干扰raw换行观察，新版gh拒ANSI日志，以及production CSS .82/0.82字符串误判已有证据并修观察，原15秒/实际几何/退出/清理和生产构建保留。新HTTPcollector独立下载首轮六asset并核真实producer/ZIP hash，首轮取消仍不产生acceptance。

第三轮[39095480885](https://github.com/ZY-WANG-0304/dev-session-canvas/actions/runs/39095480885)以预合并612a891c/head924cae96结束失败；API核原parents为main6e708c6b及该head。六native load及实际有限操作、118源码Host、两个Marketplace Host、三regression分片、423功能/3视觉及source-build同批通过。原双包各构建一次且clean checkout退役通过，随后文件清单测试错读外层dist使producer失败；原包仅在always证据artifact12124438854保存，没有正式candidate transfer，104packaged与三安装not-run。聚合又因Windows原回执使用反斜杠而拒绝Unsafe evidence path，稳定检查保持失败。

修复后的candidate模式在外层两dist均不存在的私有源码夹具消费第三轮原包，通过真实production staging、vsce ls及原ZIP检查；没有额外build或原包修改。生产ZIP源码/debug、本地化缺失、路径sanitization和helper权限反例通过；Windows路径修在producer写入，历史原回执仍验证失败，诊断仅核规范化引用可对上原hash。最终完整gate62项同批通过；渠道/恢复29项另批通过。正式修正输入须重跑clean/packaged/三安装/全量聚合及PR327最新预合并完整验收。设计映射152名称只代表目的地；137项implemented-unverified与15项not-implemented不能计为产品通过。main未配置保护检查，已复现生产恢复撤销订阅竞态未修，当前不能发布0.26.1。


第四轮[39097246318](https://github.com/ZY-WANG-0304/dev-session-canvas/actions/runs/39097246318)在真正预合并aa969012/headcdf40738完成：247 jobs为240成功/7失败，六native load/操作、118源码Host、2 Marketplace Host、423功能/3视觉、source-build与一次clean双包通过；packaged103/104。正式candidate artifact12125466855/ZIP86937a58已独立核，原Windows回执无需重写即验真。全量330task已采集，299可验收、31被拒（含失败regression producer连带拒绝），errors/notRun为空；整体失败且无acceptance。

本轮关联修正有真实对照：native回归改验证真实staging行为；macOS官方同包入口解析CFBundleExecutable=Code；独立driver先连接CDP再创建公开canvas、固定nodeID、画布内完整resize，launch环境保receiver，通知按center/preserve/用户ack契约，locale独立重开并核真实button名称。Linux第四轮原包全公开流程exit0，PTY子进程64×20→105×34，Stop后原shell/child absence，两个Host公开退出0，中英文及通知回跳全部通过。诊断目录`/dev/shm/dsc-ci-installed-public-flow-diagnostic-5`，原双包前后hash一致，acceptance=false，不追认第四轮正式安装或其他平台。

packaged文件视图失败的原生产bundle指向d3-drag处理合成mousedown时event.view=null。minimal/card两个真实浏览器回归在原包均复现同一pageError；修后私有production build2/2通过，连续文件打开及后续公开drag正常。原Host可见文件/split group/mounted断言保持，新head仍须实跑。实际Playwright注册426→428只新增这两项，其余426完全保留；3固定视觉通过/基线不变，完整425功能与3视觉回归通过，实际执行集合精确匹配冻结目录。

当前typecheck、native-assets完整链、vscode-runner环境、四workflow actionlint及结构合同通过。93门禁/发布恢复合同同批通过后，新增首败摘要/目录变更的25项针对复验通过；摘要优先指出原失败task，但成功兄弟task仍不能从失败producer获得acceptance。最新完整Actions、新批次104packaged/三安装及PR327真实组合继续待验；生产恢复撤销订阅竞态未修，0.26.1未放行。

第五轮[39101493143](https://github.com/ZY-WANG-0304/dev-session-canvas/actions/runs/39101493143)真实预合并7375f4a1/head2c4a16af已结束失败：247 jobs为239成功/8失败；330 actual、324 required、318 required passed，324 total passed包括六校准操作。source115/118、packaged103/104，六native、三regression分片、425功能/3视觉、Marketplace Host2与Linux原样安装通过。失败为三固定宿主metadata下载网络、源码文件视图、macOS长IPC与Windowscached geometry，errors/notRun为空，无acceptance。

PR3352c4a16af+PR3278313fc72临时0.26.1组合[39101774719](https://github.com/ZY-WANG-0304/dev-session-canvas/actions/runs/39101774719)真实预合并a450a724/组合head56d54377已结束失败。parents核为main6e708c6b及56d54377；247 jobs为243成功/4失败，330全必跑328通过，source118/packaged104、六native和全部基础通过，仅macOS与Windows原样安装仍失败。两轮独立记账，不能互补验收。

本轮原包受控tab焦点切换先红后绿，目标file按URI/ViewColumn唯一公开Tab关闭，原画布保留。新fileEntries probe实际拒视口外/禁用/遮挡输入，补全一次primary pointer。当前production Host两次失败分别证明瞬间probe后动画变化及不合理selection前提；外部DOM trace记录目标已居中/可命中而旧selection保留，改用同原10秒中的焦点/稳定矩形/实际命中后完整文件视图通过。证据`/dev/shm/dsc-ci-current-file-view-host-3/result.json`同时核原Host退出/原执行reader清理/短目录退役；这是当前源码production+旧native诊断，acceptance=false。先失败的两个目录及原包before-2均保留，before-1的proposed API枚举失败不作产品证据。

当前最终105门禁/发布恢复合同同批105通过/0失败/0跳过，typecheck、vscode环境、四workflow actionlint和结构合同通过。真实浏览器428→429只新增命中前提回归，原428完整保留，production426功能/3视觉全通过/基线不变。123 suite预算与上一head逐项相等，文件视图1083000ms；installed新UI/nonce/同fd几何观察共用原20秒。短路径settings显式传原user-data地址，setup/verify日志逐session保留并在原Host退役后安全清理；下载reporter固定缓存路径通过，冷网络恢复尚未实测。最新正式跨平台与更新PR327组合仍待新head执行，生产旧代订阅竞态持续阻塞0.26.1。
