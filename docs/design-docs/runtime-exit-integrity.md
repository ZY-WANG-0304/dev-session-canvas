---
title: 执行会话退出完整性交付
decision_status: 比较中
validation_status: 未验证
domains:
  - 执行编排域
  - VSCode 集成域
architecture_layers:
  - 宿主集成层
  - 画布呈现层
  - 共享模型与编排层
  - 适配与基础设施层
related_specs:
  - docs/product-specs/runtime-persistence-modes.md
related_plans:
  - docs/exec-plans/active/runtime-exit-integrity.md
updated_at: 2026-09-20
---

# 执行会话退出完整性交付

## 1. 已确认范围与决策状态

2026-09-20，用户同意将“退出完整性”作为本次 Runtime Persistence 重构的独立交付项。它与 F-04 容量优化、F-05 取消 completed 内联分别验收；不能等其他重构完成后假定问题自然消失，也不必等待整体终端状态替代或 F-03 root 归属改造才能推进。

已确认的是交付目标、范围和正确性门槛，未选定具体 reader、依赖版本、native adapter 或消息 API。本文保持 `比较中 / 未验证`，其中“未验证”指新交付尚未实现验收，不否定已有诊断证据。本次确认只登记设计与 active ExecPlan，沿用“不直接修改业务代码”的边界；后续业务实施另行推进。

完成重构时若该项仍有未收口缺陷或原生平台验证缺口，就不能把本次重构的退出完整性宣布为完成；允许说明其他独立增量的已完成结果。任何支持范围缩减或发布例外必须显式记录并由用户确认，不能把未实测自动解释为不在范围。

## 2. 问题与证据基础

`docs/design-docs/runtime-terminal-tail-diagnosis.md` 确认 Linux PTY 过早 EOF，原始 onData 已缺字节。`docs/design-docs/runtime-terminal-cross-platform-diagnosis.md` 又区分 Unix 200 ms 强制关闭、Windows 默认 ConPTY 1000 ms 静默关闭及公共业务的退出假设。Linux 有真实自然/受控证据；Windows 有实际 JS/reader 夹具证据，但没有原生 ConPTY 实测；macOS 有源码边界核查但尚无原生证据。不能把三种证据级别混为全平台复现。

`extensions/vscode/dev-session-canvas/src/panel/executionSessionBridge.ts` 直接转发 node-pty onExit，却假定输出已完整排空。`src/supervisor/runtimeSupervisorMain.ts` 的 `bindSessionProcess()` / `finalizeSession()` 在 exit 后封闭新事件，只收敛已接受操作；`src/panel/CanvasPanelManager.ts` 的 local Agent/Terminal finalize 同样取消输出监听。公共队列尚未发现丢失退出前已接受数据，但它无法补回未进入回调的字节。分页与 final revision 也不能证明源完整性。

## 3. 交付契约

以下是已确认目标，不是对当前实现已满足的描述。

| 边界 | 必须满足的结果 |
| --- | --- |
| 自然终止，包括 exit code 0 和非零 | 对于未被用户取消的当前消费者，已成功写入终端的输出必须按序完成交付与显示，不能缺尾、重复或破坏字符/终端控制序列。命令执行成功与输出交付完整是两个独立判断。 |
| 进程退出、源输出终止、消费者应用完成 | 分别证明；不能以 waitpid、exit code、socket close、静默时长或 final revision 单独替代全部证明。源 EOF 自身也必须可信。 |
| 主进程退出但后代仍持有输出 | 不因主进程先退就宣布完整排空；需明确终端会话的输出所有者和结束边界。不得无限挂起，也不得以固定等待后丢弃作为正常成功。具体取消/期限策略待方案阶段选定。 |
| 正常停止与强制停止 | stop 请求不等于输出已结束。可完成正常排空时继续交付；若确实强制切断，必须可辨认地表达取消/中断及完整性未知或截断，不能标成已完整交付。不得仅为通过验收把所有正常退出改标为中断。 |
| 显式删除、页面关闭或读者失效 | 按已有取消语义释放对应消费者和资源，不无限等待被取消者。一个读者取消不得截断其他仍有效的读者；删除语义不能被伪装成自然排空。 |
| Runtime 结束后的重开 | 仍只恢复轻量节点和退出结果，不恢复原进程、不保留终端正文；当前读者的收尾不能重新变成长久归档。 |
| Supervisor 崩溃或机器重启 | 仍不要求恢复进程和历史。本交付不新增灾备服务，也不把这些例外扩大为正常运行可丢尾部。 |

覆盖 Agent 与 Terminal、`live-runtime` 与 `snapshot-only`，以及 Linux、macOS、Windows 的实际受支持执行路径；Remote SSH 按实际执行端平台验收。只扩展 snapshot-only 的退出完整性验收，不改变其既有持久化/关闭产品边界。原始 PTY 内容经 Windows ConPTY 的 VT 转换时应校验终端语义和编号内容，不能误用 POSIX 原始字节完全相同作为跨平台唯一门槛。

保证从程序成功写入终端的数据开始，不包含程序自身尚未 flush、未写入 PTY 的应用缓冲；程序自己输出的不完整 UTF-8 或控制序列按既定解码和终端语义处理，不要求补造或修复生产者内容。分片测试应同时记录实际写入边界与预期终端结果，区分生产者本身的内容与读取截断。

## 4. 实施边界与候选

源读取边界由 `executionSessionBridge.ts` 及其 node-pty/native provider 接入负责。候选包括可验证的上游读取修正、维护受控 adapter 或替换局部 provider；需要比较平台覆盖、VS Code/Electron 实际可用性、native 打包成本、解码和取消行为后选定。现有 Linux 私有 fd 同步补读只用于诊断，不是获批的生产实现；不能因某 libuv tag 有一个修正就宣称 Unix/Windows 的其他关闭机制也被解决。

生命周期契约需贯穿 Supervisor 与 Host local PTY，必要时同步 `common/runtimeSupervisorProtocol.ts`、`common/protocol.ts` 及 Webview 终态投影。可比较由 adapter 聚合可信最终事件和显式分离过程事件两种路线；`drained`、`interrupted` 等仅是本文解释用语，字段、枚举、文案和 API 均未选定。仅重命名 EOF/exit、增加等待或删除 admission guard 不能代替源完整性证明。

旧 live session 继续其原 Supervisor/backend/storage/session/generation 绑定，不改地址冒充迁移，不为修复强制重启旧进程。新 Host 连接旧实现时不能补造“已经可靠排空”的能力；按已知能力降级并可辨认地保留完整性限制。新旧协议和结束原因如何协商需在实现前明确，不能无条件向旧客户端发送它无法解释的新契约，也不因当前诊断自动取消所有兼容路径。

退出完整性不得让容量重构倒退为全量聚合、无限内存/无限等待，或者让当前输入长期阻塞。所选 reader 的批次、退出等待/取消上限、日志与读者保留预算，在方案选定时给出数值和失败语义；本次范围确认不预设数值，更不接受用截断正常输出满足预算。

## 5. 验收门槛

| 场景组 | 必需证据与通过条件 |
| --- | --- |
| 严格大输出自然退出 | 保留 100000 scrollback、90000 行及逐行内容断言，覆盖零/非零退出。写入完成凭证、源回调、bridge、journal/状态、分页及实际终端投影对账，不能只检查末 marker 或 revision。 |
| 各平台已知关闭机制 | Linux HUP/partial read、Unix 有缓冲时关闭、Windows builtin/DLL 与 worker/pipe 关闭分别验证。已复现缺陷路径须提供旧实现缺失/候选消除缺失的对照；尚未复现或作为对照的路径仍按冻结矩阵验证完整性并保留未复现结论，不要求人为制造旧版本失败。未经原生验证的夹具只作为局部证据。 |
| 分片与持续交付 | UTF-8 跨 chunk、ANSI/OSC 尾片、慢消费/背压、大输出、后代持有输出时均不静默缺失；合法的终端转换按语义对照。 |
| 生命周期与多读者 | stop、强制停止、delete、读者取消、退出期间 Host/Webview 生命周期变化及多个既有读者，分别验证排空/中断/取消，不串会话、不重复终态、不误删其他来源。 |
| 新旧版本共存 | 新会话使用所选已验证路径，旧会话原绑定继续可控；旧实现缺少证明时明确限制，不宣称被新 Host 修复，也不覆盖或迁移旧 live 进程。 |
| 原生平台与模式 | Linux/macOS/Windows 各自在实际 Node 和实际 VS Code/Electron 上验证 Agent/Terminal 的两种模式。真实 provider 的最小退出场景与确定性 fake-provider 压力证据分开报告；缺 runner 的格子保持未完成。 |
| 回收与非目标 | 完整交付或显式取消后收敛读者/进程/句柄；Runtime 重开仍无正文、不自动执行；不新增 completed 归档或跨机器故障恢复承诺。 |

重复轮次、并发负载、版本清单和性能/等待预算须在候选实验前登记并冻结，保留所有首次失败，禁止运行到成功后只报告成功样本。单元/契约、真实原生 PTY、真实宿主与 packaged smoke 是不同层级的证据，最终交付需要对应层级齐全。既有诊断脚本的 exit 0 只表示特征断言成立，包含预期失败反例，不可充当修复验收。

## 6. 下一步与状态

执行入口为 `docs/exec-plans/active/runtime-exit-integrity.md`。首先冻结事件/结束原因契约与平台矩阵、补原生 runner 和候选对照，再选定源码落点及接口，随后才实施和回归。当前只完成独立交付项立项，所有实现与平台验收均未勾选；没有因为用户确认范围就把具体技术方案或修复状态标成已选定/已验证。
