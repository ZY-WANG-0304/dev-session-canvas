# restricted ready 竞态证据

正式分析见[根因文档](../../design-docs/smoke-restricted-ready-root-cause.md)。本目录为调查证据，诊断脚本不是正式修复。

`results.json`绑定原正式输入、自然成功、阶段自然失败与有限19项采样、真实消息时序两组对照及临时workflow清理commit。`natural-failure-timeline.json`保留跨await真实ready接受和回滚时序；`natural-failure-*.json/txt`保留原失败工件。输入hash分别在stage/causal input hashes中。

| 运行 | 输入/范围 | 实际结果 |
| --- | --- | --- |
| [38676791045](https://github.com/ZY-WANG-0304/dev-session-canvas/actions/runs/38676791045) | 原代码restricted单项 | smoke exit0 |
| [38677150708](https://github.com/ZY-WANG-0304/dev-session-canvas/actions/runs/38677150708) | 只读阶段采样，4 runner，每个最多6新profile，首败停本runner | 19次，18通过，1次原ready20秒失败 |
| [38678148402](https://github.com/ZY-WANG-0304/dev-session-canvas/actions/runs/38678148402) | during投递原ready；before等待原ready/ack | during smoke exit1、因果断言通过；before完整restricted exit0 |

原日志及完整关键工件在`/dev/shm/restricted-ready-evidence`。stage sample2/3/4的约1.88GB工件只读取前1MiB zip内容，解压确认日志条目完整后保存日志/exit摘要；完整工件仍在GitHub，不能声称本地完整下载。sample1自然失败及两组causal zip已完整下载并校验hash。

`diagnostic-probe.py`使用唯一源码锚点插入阶段记录；stage input hash保留只读版本，causal `DSC_READY_TIMING=during`仅在Host边界保存和延后投递唯一原editor ready，`before`只在原诊断调用前等待真实ready和ack。原20秒预算、fake竞争拒绝及restricted业务断言不变。

复跑在独立checkout9198cacb内，默认npmci、同输入六资产assemble后，从临时commit7e47fcb7提取probe，按causal-workflow.yml的同名环境和命令执行。source以外的临时文件可影响workspace扫描，阶段日志可影响调度；单项和控制不能代证完整发布门禁。临时workflow已移除，不创建独立PR。
