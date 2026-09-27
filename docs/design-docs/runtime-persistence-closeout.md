---
title: Runtime Persistence 有限收尾与完成定义
decision_status: 比较中
validation_status: 未验证
domains:
  - VSCode 集成域
  - 执行编排域
  - 项目状态域
architecture_layers:
  - 宿主集成层
  - 画布呈现层
  - 共享模型与编排层
  - 适配与基础设施层
related_specs:
  - docs/product-specs/runtime-persistence-modes.md
related_plans:
  - docs/exec-plans/active/runtime-exit-integrity.md
  - docs/exec-plans/completed/runtime-persistence-storage-reevaluation.md
updated_at: 2026-09-28
---

# Runtime Persistence 有限收尾与完成定义

## 1. 状态与目的

2026-09-28，用户要求暂停自动追加阶段，先对齐整体完成定义。本稿以 `ba2c148b` 为代码核对基线，只整理文档，不执行新实验、业务改造、runner 或发布。暂停自动推进、保留既定验收和历史证据是已确认要求；下列有限清单与完成定义是待用户确认的建议，不代表已批准下一步或已完成验收。

原始重点是 F-04 运行期容量与恢复成本、F-05 已结束历史进入画板。退出完整性是后来明确批准的独立正确性交付，必须完成，但不能以无限增加局部阶段替代总体交付。当前产品方向未发生根本变化，推进重心却过度集中于退出诊断与局部接线，F-04 整体收口落后。

本稿作为当前收尾范围的统一入口。旧设计、ExecPlan、技术债中的阶段编号、未勾项和“下一步”保留原时点含义，不自动生成当前任务。用户确认前，不开始 S17 或另一轮工具验证；确认后也只从本清单选定有结束条件的工作。

## 2. 已完成项，不重新立项

| 目标 | 已完成及证据入口 | 不能据此宣称 |
| --- | --- | --- |
| F-04 周期传输 | 独立 checkpoint 刷新，不再为健康 live stream 周期重传完整后缀；见 `runtime-checkpoint-only-refresh.md` | 首次恢复和总回放时间已收口 |
| F-04 常驻缓存与单次读取 | Supervisor 缓存限制为 1 MiB 编码字节/2048 事件；新能力 live Host/Webview 消费驱动分页，Host 不驻留完整后缀；见 `runtime-journal-bounded-cache.md`、`runtime-paged-terminal-projection.md` | 该预算就是整体 RSS 上限、全部队列已受限 |
| F-04 新能力完成路径 | 当前读者从原 Supervisor 分页收尾，避免完整终态聚合；见 `runtime-paged-completion.md` | 旧协议/混合订阅、扫描与总恢复成本已消除 |
| F-05 新路径 | Runtime completed 只保存轻量节点、配置与退出状态；重开不恢复正文或自动执行，明确可识别的旧内联记录已处理；见 `runtime-completed-no-history.md` | 当前页面可以丢尾；可推断并删除来源不明的旧 serialized-only 记录 |
| 退出完整性实现增量 | 两种 owner、内容消费与逐 reader 结算、最终应用屏障、保存与失败责任已有受控模块实现；Linux 正式 provider/PTY 有有限业务证据；见生产接入设计第 17 至 31 节 | 真实 Agent、实际 Webview、macOS/Windows、packaged 产品路径已全部通过 |
| Host 状态保护 | S13/S14 永久退出旧写者屏障、S15 首次退出结果复用、S16 普通 completed 陈旧回滚/清理保护；S16 有先红及 25 次 Host 回归 | template prepare 等于完整 apply；所有等待窗口或状态替换竞态均已解决 |

表内短文件名均位于 `docs/design-docs/`。已归档实施计划证明对应增量交付，不等于整个重构验收；S12 首轮 1/2 与修后单例 1/1、历史短读及其后通过样本继续分别保留。

## 3. 有限直接产品收尾项

以下只有三个收尾项。B1/B2 是尚未完成的产品决策或能力；B3 是必须消除验收不确定性的有限风险组，不把未复现风险写成已证缺陷，也不预先规定必须新增事务框架。

| 编号 | 当前缺口与产品影响 | 结束条件 |
| --- | --- | --- |
| B1 容量与恢复，F-04 | checkpoint 长期不推进时总回放仍随后缀增长；在途队列、正常 open/compact 的全量临时分配及整体峰值未完成预算验收。分页与缓存增量不能证明多会话长期可交互，也没有已测 OOM 结论 | 固定实际支持的新路径负载和资源/可交互预算，完成 A1；只修会突破该预算的当前产品路径。旧协议成本单列兼容边界，不靠截断未消费数据、放宽 checkpoint 正确性或缩小 scrollback 求通过。若当前模型不能满足预算，再在原候选中作一次有证据的取舍，不预设重写全部终端模型 |
| B2 退出完整性成为可用产品能力 | 候选仍默认关闭；当前正式工厂只覆盖匹配运行时的 Linux x64/glibc。跨平台 provider/宿主产物、生产预算和准入、失败处置、真实 Agent 与页面证据未整体闭合 | 两种模式按既定支持环境接通并通过 A2 至 A5，明确实际启用路径、能力不足处理、新 generation 与旧 live 共存。只有默认关闭候选或 fake/headless 测试不能算交付；开放前须有预算和支持清单，不把正常尾部统一降为取消 |
| B3 生命周期不串代 | S16 只保护 reader/persist 等待窗口；完整 reset/reload 重叠、首次 pending 等待后 callback、新业务准入、完整 template apply 和旧 Runtime delete 返回后发 exit，仍是未验顺序或源码风险 | 用 A6 的有限实际入口顺序判断；危及尾部、节点/绑定、新执行或其他 root 的确定问题修复并回归。没有复现且有覆盖证据的顺序可按证据关闭，不要求证明任意并发排列或引入全局锁 |

代码定向：以下代码相对 `extensions/vscode/dev-session-canvas/`。B1 涉及 `src/supervisor/terminalSessionJournal.ts`、`src/supervisor/runtimeSupervisorMain.ts`、Host 的 `src/panel/CanvasPanelManager.ts` 与 Webview 分页消费；B2 沿 `src/panel/executionSessionAdapter.ts`、`src/panel/executionOwnerLifecycle.ts`、`src/panel/linuxExecutionOwnerFactory.ts` 和真实 Host/Supervisor/Webview 接线；B3 聚焦 `CanvasPanelManager.ts` 的原边界与 completed 续体。具体落点由选中条目的直接证据决定，不把这一段作为重构所有模块的授权。

B1 当前源码仍有 journal 的 `pendingWrites`/`writeChain` 积压、Supervisor 普通 socket 写入未等待背压，以及 live checkpoint 校验扫描累积事件等结构性成本；不据此宣称已复现 OOM。正式运行路径的写失败/满盘必须有可执行且不谎报完整的策略，不能以无限内存暂存掩盖失败。Supervisor 崩溃后重放优化不自动成为验收要求；保留的 open/扫描只有确实进入本轮正式路径时才计入相应预算观察。

生产接入设计的 L-01 至 L-05、PI-01 至 PI-06 只用于追溯上述责任，不能把历史表中的旧缺口全文重复排队。新拓扑中 provider 失效、owner 消失时的孤儿风险、允许动作和未知结果仍须确认，但不新增机器崩溃后恢复、任意故障全部清零或逐个托管后代的承诺。

## 4. 必要验收，保留既定强度

以下是六组产品验收，不是六轮新工具开发。复用现有脚本、runner 和可适用证据；旧输入不同或未覆盖的格子仍标未验，不累加测试数量来代替用户工作流。

| 编号 | 固定检查范围 | 通过所需证据 |
| --- | --- | --- |
| A1 容量与交互 | checkpoint 持续拒绝的尺寸/颜色两类已知输入；历史增长、持续输出、慢消费/离线后重连、多会话中一个节点交互；attach 中输出/resize/scrollback 与 compact 交接，运行期写失败/满盘 | 分别记录每层缓存/在途峰值、进程内存、单消息/页大小、磁盘增长、首次可交互及总恢复耗时、输入响应；既有完整性断言保持，写失败不得伪报完整或静默丢未消费来源。预算在运行前确定并比较相同输入的基线，不要求无限历史下总回放恒定，也不把页大小当 RSS |
| A2 模式与持久化 | live-runtime 原执行在 Host 离开后继续、新 Host 同绑定重连；completed 当前页收尾、保存/删除失败、重开；snapshot-only 原保存/关闭语义；新旧 generation 共存 | 原身份和输出顺序正确；已结束 Runtime 无正文/无自动执行；轻量保存不随历史体积增长、移动节点/改 Note 不重写正文；保存失败不误删唯一来源，旧 live 不被迁移或补造保证 |
| A3 尾部与真实页面 | 严格 90000 行与既定 100000 scrollback 场景、零/非零退出、UTF-8/ANSI/OSC 尾片、慢消费；实际 VS Code/Electron Webview，editor/panel 双 surface 与多 reader | 独立成功写入凭证、逐层内容对账及实际 xterm 最终屏幕/光标；write callback 后才算页面应用。stop、force、delete、读错、断连/取消分别报告；一方取消不截断另一有效读者。marker/revision/onExit 或 headless 不能单独代证 |
| A4 真实执行主体 | 真实 Terminal，以及当前支持的真实 Agent CLI（Codex、Claude Code）；输入、resize、自然退出和各自停止策略，含实际使用的包装启动链 | 记录 CLI/版本、启动器与真实主体身份及退出时序，确认 wrapper 不提前代表实际 CLI 结束；受控 agent 标签、假 provider 或通用后代实验不代证真实 Agent |
| A5 平台、分发与责任 | Linux/macOS/Windows、live-runtime/snapshot-only；实际 Node、VS Code/Electron 与 packaged 路径，Remote SSH 按执行端平台；Windows builtin/DLL 路径和合法 VT 转换 | 支持格对应真实产物/运行时、协议能力、主体尾部、reader/worker/pipe/本方句柄释放；有界失败/unknown 不伪装成功，同 Supervisor A 收尾时 B 仍可交互。核对正常对象语义，不要求 OS 进程对象因其他合法引用而消失 |
| A6 状态替换与失败 | 一组有限顺序覆盖完整 reset/reload 重叠、首轮 pending 等待后进入的 callback、完整 template apply、旧 delete 等待后同 ID replacement；含 root A 失败/B 继续交互 | 真实入口和最终保存/消息内容证明旧操作不复活节点、不清理新执行或覆盖其他 root；strict delete 失败保留原绑定，不用 root 全局 drain、core-only 锁或吞错替代责任。S16 原回归继续保留 |

A1 尚缺确认的容量/交互预算及运行期存储失败政策，B2 尚缺确认的生产收尾与失败预算；这是具名决策缺口，不用无限压力试验来发现一个“合适数字”。后续选中条目时须先写明会话数、输出量/持续时间、scrollback、慢读/离线时长、运行环境、缓存/在途和内存预算、可交互时间及到期结果。现有 1 MiB/2048 是缓存实现值，候选自然 8 秒/主动 13 秒/整体 20 秒不是已接受的生产指标。本稿不代用户确认数值。

A5 沿用既定平台、架构和运行时支持承诺，逐格标记通过、失败、未验或明确不支持；不能只跑 Linux 再称全部完成。只有存在真实相同的实现/环境与有效来源证明才复用证据，不能用 Node 产物冒充 Electron，也不能因没有方便的 CLI 凭据或 runner 就删除真实 Agent/平台要求。支持范围缩减、发布例外须另获用户确认；不默认要求所有诊断负例与所有环境做无意义笛卡尔积。

主进程成功写入终端的尾部，以及自身已接收、排队、消费中的内容仍必须完整交付和应用；不承诺程序尚未 flush 的应用缓冲。超时、主动截断、socket close 与进程 exit 不能冒充完整 EOF。Terminal/Agent 主体存活时正常接收同终端后代输出；主体退出后的普通后代未来输出不作为产品门槛。启动器下实际 Agent CLI 仍是主体。上述边界不因清单收窄而改变。

## 5. 建议的整体完成定义

只有以下条件同时成立，才称本次重构完成；目前尚未成立：

1. F-04 在确认的支持路径和负载预算内通过 A1，剩余旧协议成本有准确兼容边界；不得只交分页就关闭容量问题。仍被正式支持的新路径若达不到预算，应修复或重新确认范围，而不是换名延期。
2. F-05 已完成的新路径在 A2 保持无 completed 正文、无自动恢复进程；当前页尾部、保存失败与旧 live 保护不回退，不重新引入归档项目。
3. B2 退出完整性在既定两模式、真实 Agent/Webview、跨平台与分发路径通过必要验收，并形成经过审核的生产启用、预算与能力策略；原型开关一直关闭不算可用产品交付。
4. B3 的有限风险组完成 A6，确定影响产品的缺陷已修，未验证组合不假装通过；不以任意并发/任意故障的完备证明作为终点。
5. 一份最终支持/证据表映射 A1 至 A6，代码、规格、设计、回归和残余债务一致；没有未处置的直接产品阻塞。历史失败与后续修复分账，正式发布例外只能由用户明确接受。

不需要把所有设计候选、诊断工具、历史实验都“做完”才能达到此定义。也不允许把真实 Agent/Webview/跨平台、主进程尾部或当前有效消费者移到延期项来缩短清单。

## 6. 可延期增强与不再排队的研究

| 类别 | 当前处理 | 何时才升级为本轮阻塞 |
| --- | --- | --- |
| 通用诊断健壮性 | 无限 listener、极端错误洪泛、任意归档路径/迁移、全协议篡改/组合枚举、D4 通用资源模型继续完善，均不默认前置 | 能指明它影响 A1 至 A6 中哪一个固定实验的安全或判定，以及最小修正与结束条件；只阻塞那个实验 |
| 尚未选定的整体替代 | S2 权威状态同步、换成熟 mux、换数据库、扩展全部 checkpoint codec，保留候选不各自立项 | B1 证据证明当前方案不能达到确认预算，且选定替代后才实施 |
| 旧协议与模糊遗留格式 | 旧 live 沿原 backend/storage/session/generation；不回填新保证，不为去兼容强停原进程；来源不明旧记录不强制清理 | 真实共存路径破坏新会话预算、绑定或尾部，则作为 B1/B2 直接问题；不能用此项豁免当前支持的新路径 |
| 既定非目标与诊断 | Supervisor/机器故障后恢复、completed 历史归档、主进程退出后普通后代持续托管，不进入本次交付；OS 全对象清零也非要求 | 产品另行变更；本方资源泄漏、主体尾部丢失或真实 CLI 生命周期错误仍在本轮 |

原审核 F-01 连接超时与 F-02 依赖方向继续各自登记，本次不据旧报告推断它们已解决，也不自动扩成修完全部架构问题。若某项实际阻塞本清单的重连或产品验收，按对应 B 项处理必要部分并保留证据；通用分层重构不作为新前置。

## 7. R1：root 稳定归属独立计划登记

F-03 单列为后续独立计划，尚未启动实施，不是 B1 至 B3 的前置，也不由本次收尾宣称解决。本节登记目的、边界和验收输入；具体 ExecPlan 在启动该项前单独编写，不把归属迁移混进退出计划。

目标是同一运行环境、用户存储范围、root 身份与 Supervisor generation 确定稳定归属；单根和多根 Agent/Terminal 新建必须一起修改，显示名、cwd 和创建窗口 slot 不替代 root 身份。先修订 `canvas-multi-root-workspace-support.md` 设计第 6.8 节及对应产品规格，再实现发现/创建路由与必要隔离。

旧 live 继续连接 metadata 中原 backend/storage/session/kind，不能只改地址声称迁移；新会话用新归属，旧 Supervisor 随原会话及相关责任结束而退役。独立验收包括单根/多根双向新建、不同窗口 slot、并发创建、新旧 generation 共存、不同 root 故障隔离及环境/用户身份边界。当前 B3 只保护现有 root 状态与绑定，不预支这些保证。

## 8. 推进约束与证据归档

用户确认本稿前止于对齐，不选下一阶段。确认后每次工作必须引用 B 项/A 项、写明当前直接产品风险和结束条件；若无法映射，仅登记延期，不新增阶段。完成选中项即回到整体表更新，不再自动附接一个更小“下一阶段”。本稿未决定 B1/B2/B3 的实施顺序。

历史证据继续保留原 SHA、原输入、断言、失败、工件与补救动作。D1 至 D4、U1/W1、PTY/EOF/挂断及后代对照作为诊断资料；不追认失败为通过，不为抹红重复采集，也不将旧阶段未勾项全文复制进当前清单。Windows 已退出进程仍被合法句柄引用需按对象语义解释，本方 owner 释放与 OS 对象最终销毁分开，不能盲关其他进程句柄求零。

本次核对只读现有文档与代码，新增清单并同步入口；文档链接、索引/frontmatter 一致性、三个产品项/六组验收、历史正文与 ExecPlan 原行保持及 `git diff --check` 均通过。容量与退出两路独立只读复核未发现范围阻塞；一处工厂文件名已校正，无新增产品通过结论。原始审核见 `webview-host-supervisor-architecture-review.md`，容量进展见 `runtime-persistence-storage-reevaluation.md` 第 9 节，退出接线与有限证据见 `runtime-exit-integrity-production-integration.md`，契约以 `docs/product-specs/runtime-persistence-modes.md` 第 9、10 节为准。
