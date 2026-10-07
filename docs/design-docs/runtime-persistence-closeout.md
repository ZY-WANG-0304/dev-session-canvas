---
title: Runtime Persistence 有限收尾与完成定义
decision_status: 已选定
validation_status: 已验证
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
  - docs/exec-plans/completed/runtime-live-state-recovery.md
  - docs/exec-plans/completed/detached-restored-history-cleanup.md
  - docs/exec-plans/completed/native-runtime-history-cleanup.md
  - docs/exec-plans/completed/legacy-runtime-history-cleanup.md
  - docs/exec-plans/completed/runtime-persistence-capacity-closeout.md
  - docs/exec-plans/completed/runtime-exit-integrity.md
  - docs/exec-plans/completed/runtime-persistence-storage-reevaluation.md
updated_at: 2026-10-07
---

# Runtime Persistence 有限收尾与完成定义

## 1. 状态与目的

2026-10-07 当前结账：B4 权威当前模型恢复与 F-04 新增责任已完成，最终产品源码 `e38d2f72` 的正常默认 build/package、本地安装和新包 run `37613549564` 的受影响三平台工件均独立核对通过；产品有限整体审查未发现新的确定性 blocker。§13给出最终同包证据和复用边界，B4计划已归档。当前进入PR文档审查与合并许可，不追加容量阶梯、profiler或通用工具阶段。历史失败、约2.99GB资源观察、xterm私有接口和旧节点现场验证限制保留，不泛称已全部修复。

2026-10-06 当前完成定义修订：live 会话状态恢复重新列为本轮未完成交付 B4。B1 容量/准入、B2 退出完整性和 B3 生命周期成果保留，但分页与旧重连通过不证明恢复成本独立于累计交互。B4 必须让新 Host/Webview 和 PaneGallery 重建从当前权威终端状态接入；相同状态和 scrollback 的恢复不能重放不断增长的历史。计划为 `docs/exec-plans/completed/runtime-live-state-recovery.md`，设计为 `runtime-live-state-recovery.md`。本决定覆盖下列历史整体结账及 S2 延期表述，仅重新开放受影响验收。

同日早期实施记录：固定 xterm 当前状态 codec、分块传输、Host/Webview 能力协商及新 owned generation 已接通。受控生产类链路的 1/400 次等状态重绘均传输 4329 字符，R 前 journal 读取为零，旧 reader、尾部实际应用与结算责任保留。三个受影响 Playwright 页面重建用例已 3/3 通过；当时真实 Linux Electron candidate 在 sandbox 启动阶段被 `sandbox_host_linux.cc:41` / `SIGTRAP` 拒绝。该首败保留，后续环境恢复及真实验收以本节最新状态为准，不再把旧环境限制作为当前阻塞。

2026-10-06第四现场：两个native目标已在用户Host以native-owner-absent清理成功；剩余旧detached terminal-stream-v1纯历史记录按第12节增加独立资格。legacy116/native39/Host95+36定向及正常build/debug staging通过，实际旧detached节点仍须用户Host执行fresh观察；不把recoveredHistoryOnly误写成进程退出，不重开历史矩阵。

2026-10-06第三现场：前轮五个旧systemd目标已清理；两个native detached历史目标另按第12节补Linux原owner缺席资格与重启前置观察。helper39项、Host117项定向及构建通过，原窗口未操作、原生socket受sandbox限制；两次全量旧大快照超时保留。不将空registry或历史sessionNotFound当授权，也不重开原已完成矩阵。前两轮systemd证据见 `docs/exec-plans/completed/legacy-runtime-history-cleanup.md`。

2026-10-05 激活回归补充：用户实际 Remote 调试 Host 的 `process.report.getReport` 被同进程扩展替换为空函数，触发 Linux glibc 准入误拒绝。按第 11 节单独修复与回归，不用旧安装矩阵代证扩展共存兼容，也不重开已经结账的容量、尾部或 Agent 矩阵。

当前完成定义（2026-10-02，覆盖下列历史“下一项”）：B1/F-04容量、资源边界与生产准入，B2退出完整性/有限页面责任及正常默认分发，B3有限生命周期保护均按§8证据表结账。最终产品代码为63847969，普通构建新VSIX为run36979378644；仅复验受影响安装/状态保存，复用既有多会话、重连、compact和未改的真实Agent自然退出证据。文档同步和最新head整体审查后进入PR，不自动合并。旧64/128观察不再驱动优化，root稳定归属单列，旧OS和工具通用健壮性不作前置。

最终版本事实（同日，§53）：63847969的新VSIX为5861603 bytes、SHA256 `53874020710281f611d2ace9d266692e92bf866f0ff0e5871a355530237d176d`，六native复用36966903790/92b3aa4a。相对71b41035旧包，Host/Supervisor/Webview三个bundle已变化，provider/native未变，不能继续使用“Host/Webview/snapshot未改”的旧复用理由。固定SGR22补丁有原stock失败对照，最终三平台两模式installed与六snapshot-stop用于受影响结账；Windows Codex24个实际非空prefix无语义差异和unknown，Claude三平台非空1947B保存/新Host通过。旧756B终态的精确控制序列仍未知，不追认旧失败或声称已证明完全同因。原始run、输入及当前证据详见§53末尾。

### 历史实施记录

下列日期入口保留各自时点，不覆盖§3正式方案和§8最终证据表；历史“未完成”“下一步”及旧未提交状态不是当前执行队列。

当前有限增量（2026-10-02，r23）：固定现代 Linux Electron 候选执行 `--capacity-attach-compact` 的两 Terminal 实际 Webview attach/compact 场景通过。该运行覆盖动态 scrollback、两次 resize、首个 checkpoint、同一分页 reader 持续消费、约 18 MiB 后置输出跨过实际 16 MiB journal compaction 阈值、current/previous recovery candidate 以及 compact 后 reader 交互；页面输出、尺寸、scrollback、reader identity、自然结束无 completed 历史和本方资源清理均通过，未出现 `runtime/terminalPagedReadFailed` 或 Host page error。最终 manifest 的 `currentCheckpoint.revision=6579`、`previousCheckpoint.revision=6502`、`retainedStartRevision=6503`、`lastRevision=11185` 与 previous candidate 的连续事件可读性均按 manifest/候选工件核对；不强行把最新 checkpoint RPC 返回值等同于 durable manifest generation。证据保存在 `.debug/a1-attach-compact-20261002-r23/compact/artifacts/`。该结果只关闭现代 Linux Electron 的固定 attach/compact 组合，不关闭 F-04/A1 总体，不替代真实 Agent、其余 Webview/页面责任、跨平台/packaged、退出完整性或最终生产准入；不改变 64/128 MiB 合并进程观察阈值及其历史 `exit 1`。

最新状态（2026-10-01，覆盖本节后续历史入口）：A1 的固定 `10/1` schema2 Linux Electron 候选已完成 `color` 与 `size` 两个场景，内容/交互/来源 hash/自然无历史/产品 cleanup 均通过；峰值总 RSS 分别为 3,876,724,736 与 3,954,757,632 bytes，仍仅是该声明工作负载的观察结果，不构成 `N=10` 产品上限或通用 SLA。随后同候选 `2/1` 的真实 Host detach/reconnect `color` 组合通过：旧 Host 消失后原 Supervisor、主体和 session/reader 身份保持，B 在 A 尚未追平时 53.4ms 实际应用，Host ready 后 15,538.456ms 追平，reconnect/outer cleanup 均通过。两项均不关闭 F-04、跨平台/packaged、A2/A3 未填页面格或默认准入；不再重复成功矩阵，不把工具边界追加为前置。

同一最新范围内，六架构 schema2 分发候选的 Windows x64/ARM64 attempt2 已完成并与已核对四格合并，固定聚合/VSIX SHA 通过；这只关闭构建、加载与归档链，不代证最低旧 OS、各目标完整产品支持或默认准入。A6 snapshot-only Host 离开和 A3 双 Host 共享 root 的既有真实证据也已对齐为已覆盖，旧失败与未观察字段继续保留。

验收环境决策（2026-10-02）：本次重构采用现代 GitHub-hosted runner 作为支持与验收基线。`.github/workflows/runtime-execution-assets.yml` 的固定六格为 `ubuntu-24.04`、`ubuntu-24.04-arm`、`macos-15-intel`、`macos-15`、`windows-2025`、`windows-11-arm`；已取得的宿主记录为 Ubuntu 24.04、macOS 15.7.9、Windows Server 2025（10.0.26100）和 Windows 11 ARM64。六格资产结果只证明对应构建/加载/归档，产品 workflow 的 `macos-latest`/`windows-latest` 仍是浮动标签（近期 macOS 产品 job 曾解析到 macOS 26.6.2），不能写成同一固定版本。macOS 10.13/10.14、Windows 10 1809 及其他低版本不再是本次重构前置；现代 runner 通过不反向证明旧系统，低版本问题留待实际报告后单独修复。

现有直接回归（2026-10-01）保持绿色：`test-runtime-host-output-credit.mjs` 的真实 socket 背压/控制/尾部/compact 生命周期、`test-execution-output-sequence.mjs` 的 output/resize/scrollback 顺序，以及 `test-terminal-paged-projection.mjs` 的 39/39 Webview settlement、Host batch 10/10、分页 compaction/取消/重试均通过；这些是必要结构回归，不替代真实跨平台页面或最终容量准入。

2026-10-02 的 r24 复核沿同一固定入口再次通过 `.debug/a1-attach-compact-20261002-r24/compact/`：现代 Linux Electron 两 Terminal 完成动态 scrollback、resize、checkpoint promotion、约 18 MiB 后置输出触发 compaction、current/previous candidate 连续读取、compact 后 reader 交互和本方 cleanup。durable manifest 的 current/previous 为 revision 6572/6503，retained start 6504，journal head 11184；同一 reader identity 和页面交互保持。该复核不扩大 r23 的证明范围，也不把资源峰值转成产品预算。

本轮唯一未提交代码是 `scripts/smoke/run-vscode-execution-candidate.mjs` 的 schema2 资产兼容：允许 Node/Electron runtime provenance、允许 `profile=platform` 聚合选择，并仅在 Windows Electron 资产上检查 Electron 版本字段。该变更已由候选构建、installed-candidate 13 项测试和上述真实运行覆盖，待与本轮证据一并提交；历史失败与原阈值保持不变。

当前有限增量（2026-10-01，以本段优先）：Windows36854266396 attempt2真实Codex/Claude原八场、36852373473原Terminal两模式六结果/四环境已独立核对；原前置失败与整包下载124不改。A3第38节两例、A6第39节真实Runtime reload及第47节新固定包实际多根保存失败/B交互均有限通过，不重复排队；第47节A真实EISDIR仍保来源/binding、原reader applied4，B原执行nonce24.9ms，空registry落盘后独立清理通过，旧首败保持。Remote固定Node VSIX原四阶段和macOS新helper产品/真实Agent原矩阵已收口各自固定格；Claude snapshot-only stop非空保存未重开，第48节局部尺寸修复不代证其实际页面/重开。A6仍保留snapshot-only实际Host离开。六资产/兼容/默认分发/准入及F-04、其余A1至A6未完成，当前沿第49节实施兼容要求，按第8节有限剩余映射推进，不增加通用工具门槛；历史不是追加队列。

当前B2/A5与B3/A6（2026-10-01）：macOS 新 helper 的产品 Terminal/Webview 与真实 Agent 原八场已按生产接入第46节回收；旧 helper 首败和历史诊断未知保持。Windows36830583121绿灯缺五报告已确认code.cmd转交误作宿主完成，34.12窄修后36834158313真实exit1，后续36854266396 attempt2 的新固定矩阵已独立通过；snapshot-only stop 保存非空状态时不要求重开，不能倒推空态重开。A6永久退出后旧reset写盘先红已修，50次Host回归及独立复核通过；真实reload/多根UI不代证。旧失败、EOF/尾部、真实Agent及既定矩阵不削减，F-04、其余A1至A6、packaged/Remote和默认准入仍开放；当前只处理有限收尾清单，不追加通用工具阶段。

当前 A1 结果与下一项（2026-10-01）：容量设计10.15的 `.debug/a1-host-reconnect-20261001-overlap/` 固定一次运行完整exit0；B回复51ms实际应用，同一Webview动作中A的块号12到18均未追平2560，随后ready后13137.248ms完整恢复。原1500ms/不重置30秒、原执行及新reader、完整后缀/独立journal/hash/自然no-history与两份cleanup均通过，outer forcedSignals/failures为空。声明输入下的真实离线追赶交互组合已覆盖；10.14的overlap=false和全部旧失败保持。下一推进原B2/A5的macOS/Windows产品provider、namespace、匹配Node/Electron及packaged接入，不追加此组合或工具阶段；F-04总体和其他A项继续开放。

当前 CI 有限结果（2026-10-01）：run `36812745671`/`736f9ddd` 的 Linux 真实 Codex/Claude + DeepSeek 两模式 natural/stop 八场景全部 passed，四 natural 真实 nonce/EOF 及原 Webview/持久化断言通过，八份 cleanup 的 bindings/failures/forcedSignals/active 均0。专用 CI 凭据和临时配置已由这些实际响应证明可用，不再是待用户处理的认证阻塞；stop 的 eof/interrupted 仍按主动处置记录。第三轮 `36811935908` 的 Codex snapshot-only stop failure 本轮未复现，且只有报告/文档变化，业务与断言未变；根因未知，保留为具名间歇失败，不能宣称已修复或追认通过。详细证据见生产接入32.20，不自动增加CI捕获循环，F-04/完整A5/macOS/Windows边界不变。

当前 A1/A2 状态（2026-09-30）：有界索引顺序读取已实施，`.debug/a1-host-reconnect-20260930-indexed-pages/` 在同一 2/1 Electron candidate 上完整 exit 0，新 Host ready 1422.291ms、完整应用 14431.416ms、追平 13009.125ms；B32.6ms、独立 journal/hash、原执行及新 reader、完整保留后缀、自然 closed/no-history 与两份 cleanup 通过，outer `forcedSignals=[]`。原 30 秒界限与完整冻结段/尾部篡改检测保持，四轮旧 exit 1 不追认。该固定冷恢复阻塞已解除，但追赶交互重叠为 false，不关闭整个 F-04/其他 A 项。同一新 2/1 构建 A4 `indexed-pages` 八场景完整 exit 0：natural 四项响应/实际 source EOF 通过，stop 保留主动停止，八份 cleanup 均无 binding/process failure/forcedSignals。Claude stop 为 startup/auth 等待界面，不代表模型任务完成；详见生产接入 32.19。跨平台/分发及外部认证边界不变。

当前 A5 边界（2026-10-01）：产品candidate已在Linux x64/glibc、Darwin arm64取得各自固定Node/Electron及Terminal页面证据；Windows x64原Node四例、Electron构建及两模式Terminal六报告/四环境收据于36852373473核对通过；macOS新 helper 的产品 artifact 也已按第46节独立核对，不仅依赖workflow绿灯。其余架构、运行时兼容、其他平台packaged与Remote SSH仍需原清单验收。用户选定的真实Codex/Claude + DeepSeek及仓库级 `DEEPSEEK_API_KEY` 已在Linux八场景和macOS新 helper八场景取得有限实际通过；macOS Claude snapshot-only stop 的非空保存未执行重开，Windows两snapshot stop同样只完成保存/终态对账，不能扩大为所有 stop 重开。仍不绑定Environment/分支、不上传本机登录，secret仅交给最终验收step，raw不上传；Windows临时配置须在写key前验证私有DACL，进程退出用原SafeHandle事实而非对象消失。普通构建仍stock，F-04和完整A5未关闭。

同日新增结果以生产接入33.10/35为准：macOS真实Agent两次均前三Codex场passed、snapshot stop原非空断言失败、Claude未跑；新取证确认实际saved空串但geometry/visible不符和execution-changed未知，不按空串预判正文丢失或合法清屏。Linux固定production VSIX 604494fd在 `.debug/a5-installed-candidate-20261001-first/` 四次真实安装路径Host验证首次通过，四份路径/摘要收据与六份完成/重开/清理报告齐全，原90002行/最终光标/EOF及两模式保存语义保持。该Linux installed子项不再排队，但其他平台packaged、Remote、运行时兼容与默认准入仍开放；第36节两类文件系统失败组合直接服务A1/A2，不扩通用工具。

第36节两类文件系统失败组合已完成：Terminal/Agent各自通过实际journal异步ENOSPC错误传播与真实root临时文件EISDIR保存失败，原消费信用/错误和唯一来源/binding/managed责任保留，另一个已有会话仍可消费。Supervisor94/Host147及root独立复跑、只读审查通过，未修改业务；该组合不重复排队，不代证实际OS满盘或页面告警/控制。

2026-09-28，用户先要求暂停自动追加阶段，随后明确不承担清单确认，要求代理依据重构目标作出判断。本文件据此收口为已选定的工程完成定义与有限工作顺序，不再等待用户批准工程清单或选择技术预算。最初核对基线为 `ba2c148b`，草案保存在 `2d375606`，工程裁决保存在 `8dd82629`。其后已按既定顺序启动 B1，过程见 `runtime-persistence-capacity-closeout` active 计划；局部修复不代表整体容量通过，2026-09-29 最新实际链同预算样本 2x/4x 的 heap/RSS 仍超限，状态保持验证中。没有新增 runner 或发布动作。

当前决定（2026-09-30，预算口径与推进顺序）：按用户要求，合并进程样本的额外 heap/RSS 64/128 MiB 只作为该拓扑的观察信号，不作为真实分进程产品预算，也不再作为进入 B2 的前置门槛。原阈值、数值、断言、exit 1 与全部历史证据保持，不追认为通过。F-04/B1/A1 仍未完成；B2 已补齐启动 profile、隔离 generation、Linux candidate namespace 排他、实际 extension 两模式入口与匹配 Linux Electron 资产，当前进入既定真实验收，真实分进程、多会话资源/交互预算由 A1 在实际生产候选上评估。普通构建仍 stock，profiler 可用于具体归因但不默认前置。本决定取代旧记录中“先对同一合并进程采样归因并达到原门槛，再接 B2”的工作顺序，具体边界见第 3.1、8 节。

32.15 时点的实施进展（后续准入与十会话结果以本节首段和容量重评 10.12 为准）：构建期显式候选已接通实际 extension 两模式入口，匹配 VS Code 1.117.0/Electron 39.8.7 的 Linux 资产已实际运行。退出提示覆写修后，Runtime/editor 的 90002 条前缀行、光标 `(6,2)`、661 B completed 节点及真实重开空内容已有有限通过证据。snapshot-only 的 live 投影和大快照读取丢弃也已修；32.10 新目录 `.debug/execution-candidate-a2-a3-20260930-snapshot-normalization-fixed` 单选 complete/reopen exit 0，逐行恢复 90002 行、工件光标 `(6,2)`、保存 5580063 字符、applied 1396 与清理通过，输入及独立写入凭证已核对。此前整轮、`snapshot-live-fixed` 夹具字段及 `snapshot-receipt-fixed` 重开失败均保留 exit 1；当前通过不等于 OS 全程无新进程追踪或全部 A2/A3。Host wiring 110/110、tracker、journal、checkpoint、typecheck 及补齐候选退出翻译后的 localization 通过；source-eof 复验后的主线 Host wiring 144/144、Supervisor wiring 90/90、protocol/localization 与 typecheck 也通过。B3 三项先红已修，Host 生命周期 38 次回归通过，其余 A6 未关闭。A4 v18 及 `.debug/a4-real-agent-20260930-source-eof-rerun` 已在实际 Linux VS Code/Electron Host 中完成八场景有限复验；natural 四场取得实际 `sourceDisposition=eof`，stop 四场保留 `sourceEofClaim:false`，observer/cleanup 无 failure、无 forcedSignals 且 Runtime bindings=0。v18、首轮失败和 source-eof 复验均保留；该有限结果不代证 A3 大尾部、A5 容量、A1 正式预算、跨平台/分发或默认准入。普通构建仍 stock；A1 分进程多会话预算、候选共享两槽的生产策略、其他 A1 至 A6 和跨平台/分发继续开放，不将两槽变成产品上限。

原始重点是 F-04 运行期容量与恢复成本、F-05 已结束历史进入画板。退出完整性是后来明确批准的独立正确性交付，必须完成，但不能以无限增加局部阶段替代总体交付。当前产品方向未发生根本变化，推进重心却过度集中于退出诊断与局部接线，F-04 整体收口落后。

本文是当前收尾范围的统一入口。旧设计、ExecPlan、技术债中的阶段编号、未勾项和“下一步”保留原时点含义，不自动生成当前任务。停止的是无边界地追加阶段，不是将工程判断挂起给用户；后续按第 8 节既定顺序收尾，不开始新的 S17 工具链。改变既定产品保证或削减支持范围仍不属于普通工程决策。

## 2. 已完成项，不重新立项

| 目标 | 已完成及证据入口 | 不能据此宣称 |
| --- | --- | --- |
| F-04 周期传输 | 独立 checkpoint 刷新，不再为健康 live stream 周期重传完整后缀；见 `runtime-checkpoint-only-refresh.md` | 首次恢复和总回放时间已收口 |
| F-04 常驻缓存与单次读取 | Supervisor 缓存限制为 1 MiB 编码字节/2048 事件；新能力 live Host/Webview 消费驱动分页，Host 不驻留完整后缀；见 `runtime-journal-bounded-cache.md`、`runtime-paged-terminal-projection.md` | 该预算就是整体 RSS 上限、全部队列已受限 |
| F-04 新能力完成路径 | 当前读者从原 Supervisor 分页收尾，避免完整终态聚合；见 `runtime-paged-completion.md` | 旧协议/混合订阅、扫描与总恢复成本已消除 |
| F-04 局部修复 | live checkpoint 校验摘要、owned journal 写入信用、64 KiB 分页扫描；新协商 Supervisor/Host 单页信用及实际 line-context flush；Host/Webview 通知合并；owned 消费不再逐批序列化，行上下文取消登记不再累计；见 `runtime-persistence-storage-reevaluation.md` 第 10 节 | 旧生产者/旧订阅/旧页面全部有界；整体 heap/RSS 已达标；退出候选已经生产启用 |
| F-05 新路径 | Runtime completed 只保存轻量节点、配置与退出状态；重开不恢复正文或自动执行，明确可识别的旧内联记录已处理；见 `runtime-completed-no-history.md` | 当前页面可以丢尾；可推断并删除来源不明的旧 serialized-only 记录 |
| 退出完整性实现增量 | 两种 owner、内容消费与逐 reader 结算、最终应用屏障、保存与失败责任已有受控模块实现；Linux 正式 provider/PTY 有有限业务证据；见生产接入设计第 17 至 31 节 | 真实 Agent、实际 Webview、macOS/Windows、packaged 产品路径已全部通过 |
| Host 状态保护 | S13/S14 永久退出旧写者屏障、S15 首次退出结果复用、S16 普通 completed 陈旧回滚/清理保护；S16 有先红及 25 次 Host 回归 | template prepare 等于完整 apply；所有等待窗口或状态替换竞态均已解决 |

表内短文件名均位于 `docs/design-docs/`。已归档实施计划证明对应增量交付，不等于整个重构验收；S12 首轮 1/2 与修后单例 1/1、历史短读及其后通过样本继续分别保留。

## 3. 正式方案

2026-10-02已确认产品缺陷的收口：Windows分类run36976601577确认真实Codex非空prefix中12个有字符cell的Bold不保真；63847969修正固定serializer的SGR22联动，原stock失败对照与未放宽的状态oracle保持。新包的受控四cell保存/重开和真实CLI非空prefix检查承担回归，分类到此停止。旧756B终态具体控制序列保留未知，只有当前版本新非空不保真、当前确定性路径或实际用户报告才重开，不自动追加抓取循环。

本次重构的以下四个产品项已按声明范围收口；B1至B3的有限成果保留，B4及最终新包受影响验收见§13，当前进入整体合并结账，合并本身须用户许可。沿用现有Supervisor、缓存/分页与无completed历史路径，不另建历史server，不替换终端引擎/mux/数据库。后续带日期的实施段落保留原时点。

| 编号 | 当前缺口与产品影响 | 结束条件 |
| --- | --- | --- |
| B4 live 当前状态恢复 | 已完成：新codec与分块初始化不读R前历史，实际Webview/PaneGallery、Linux Terminal与三平台Codex Reload及最终新包已独立验收；旧Supervisor保持原能力 | 同状态/scrollback下恢复不依赖累计交互，权威状态、后续增量、resize与尾部正确交接；证据及配置相关资源边界见§13，不用分页或容量绿色代证 |
| B1 容量与恢复，F-04 | 已完成：正文缓存/分页/信用/索引与取消责任修正，§10.17资源模型和生产准入、默认包及三平台Runtime接线；十会话/重连/compact证据复用 | A1已结账。保留O(N)、O(segment metadata)、慢reader/checkpoint拒绝时磁盘增长、旧协议成本与原64/128失败，不承诺任意会话数固定RSS；后续发现具体回归才重新打开 |
| B2 退出完整性成为可用产品能力 | 已默认启用owned实现、六目标正常分发、现代三平台实际安装/Agent接线；已证页面责任与SGR22缺陷修复，最终受影响证据见A2至A5 | 当前产品阻塞已按严格内容/状态/reader和新Host验收关闭；旧精确因果未知单列风险，不以空态通过替代非空保真，不要求通用工具完备 |
| B3 生命周期不串代 | §32.21完整替换/永久退出受控回归，§38双Host、§39/50两模式实际reload、§47多根真实保存失败隔离及§53旧generation共存均已具名通过 | A6有限范围已覆盖，不要求任意并发排列或全局锁。原snapshot reload未观察的旧reader/EOF与排他写者字段保留，不外推新保证；root稳定归属仍独立 |

A1/F-04 的准入口径已由只读源码核对收敛：固定十会话是声明输入，不是产品 `N=10` 上限；活动会话资源按用户显式需求随 `O(N)` 增长，不承诺任意 N 下固定 RSS。payload 32 KiB、pending 256 KiB/16 帧、page 64 KiB/256 事件、credit 在 tracker 消费并 journal flush 后返还继续作为每会话硬边界。最终保存、未结算 reader 和 unknown/quarantine 责任计入独立有限责任槽，达到pending门槛时在journal/provider获取前拒绝新建，已有会话仍可安全消费。启动并发 `Q=1` 是另一项provider acquire限制，不形成隐藏队列；它在执行启动阶段拒绝，已准备的journal/session由明确 `rejected-before-acquire` 路径清理，不能写成Q=1也先于journal创建。

### 历史接入与预算快照

以下段落及§3.1保留当时的默认开关、缺口和样本结果；当前默认platform、正式准入及有限验收已由§8结账，不将历史未完成表述重复排队。其完整性判据继续有效。

当前发现的 Q=1 直接缺口已完成最窄修复：Supervisor 的 `rejected-before-acquire` 会清理准备中的 journal/session，Host 现在只对这一明确结果清除 `candidateRuntimeStarts`、将未绑定节点置为可重试的 error，并保留连接断开、能力不符或资源释放未知的 sticky unknown/quarantine。Terminal/Agent 同节点拒绝后重试回归已加入 Host wiring，149/149 通过。正式候选默认准入仍需完成 A1 责任槽与跨平台验收，不能用此局部修复或十会话绿色代替。

代码定向：以下代码相对 `extensions/vscode/dev-session-canvas/`。B1 涉及 `src/supervisor/terminalSessionJournal.ts`、`src/supervisor/runtimeSupervisorMain.ts`、Host 的 `src/panel/CanvasPanelManager.ts` 与 Webview 分页消费；B2 沿 `src/panel/executionSessionAdapter.ts`、`src/panel/executionOwnerLifecycle.ts`、`src/panel/linuxExecutionOwnerFactory.ts` 和真实 Host/Supervisor/Webview 接线；B3 聚焦 `CanvasPanelManager.ts` 的原边界与 completed 续体。具体落点由选中条目的直接证据决定，不把这一段作为重构所有模块的授权。

B1 已修正常 live checkpoint 全历史数组持有、owned journal 信用与分页整段物化；具名 Supervisor/Host 消费信用使真实 socket 慢消费不再产生正文/状态推送洪泛，Host 等行上下文真实应用后回执。本轮进一步收敛协商后的 Host/Webview 水位提示，接收回执不代替正文应用，最终 completed 通知不等普通提示。原 node-pty 生产链、旧订阅/旧页面、真实多会话整体预算仍未闭合。stock pause 会与 Unix/当前 Windows 的退出定时 destroy 冲突，故生产者有界化由 B1 依赖 B2 的既定 owned 接入完成，不另造旧生产者生命周期，也不将其延期出本次交付。首次 1x/2x/4x 的 64/128 MiB 内存失败保留；分页扫描修后同探针对照 RSS 最高增量 116.92 MiB 达标、heap 103.72 MiB 仍超限，内容和 30 秒回放门槛通过，不能关闭 A1。探针回放比真实 Webview 多一份逐页序列化，尚未量化，不扣除或追认通过，也不把优化探针先变绿当作传输修正前置；随实际链验证剩余内存来源。正式运行路径的写失败/满盘不能伪报完整或以无限内存暂存掩盖；Supervisor 崩溃后的 open/全量恢复优化不自动成为本轮验收要求。

F-04 的工程判据不只是一轮负载没有超限：当前支持路径的缓存、读取和在途数据必须有明确容量约束、背压或可证明的来源上限，不能依赖消费者永远足够快。若新路径仍要求按完整历史线性物化后缀或无界累计待写正文，即使小样本未 OOM 也不能关闭该项。总回放工作可随所需历史增长，但必须让步、可取消，不阻塞输入控制；终端可交互与完整追赶分别度量，不强加恒定恢复时间。

后续从 `f24a84f0` 分离 owned 解析消费与快照物化，真实 Linux provider/PTY/socket/受控 Host 的同输入 baseline/current 各一次对照完成。累计序列化 1616→4 次，内容、终态、自然退出及清理通过；current 1x 内存达标，2x/4x 仍超原 64/128 MiB，4x 额外 heap/RSS 为 99.14/167.45 MiB，不能宣称整体峰值改善。该受控单 Terminal 链并非实际 VS Code/Agent，旧模块探针失败也不改。分页逐页重新校验整个相关段是源码事实，尚未量化其峰值贡献；当时安排的同链归因由 2026-09-30 当前决定调整，不新增通用工具门槛。

2026-09-29 已修复 Host 行上下文的取消等待累积：独立登记只存当前在途等待，完成/失败后移除，dispose 唤醒且 strict flush 仍拒绝；先红及真实 parser/并发/迟到回调回归通过。原固定入口唯一新样本的内容/终态/清理通过，但 2x/4x 仍超预算，4x 额外 heap/RSS 为 68.22/142.98 MiB，整轮保留 exit 1。单次下降不量化为该修复的全部贡献，也不关闭 B1。当时拟定的 Node/V8 归因不再是 B2 前置；如后续为具体问题使用 profiler，仍须区分存活对象、短命分配与 RSS，其开销下的样本不能替代容量验收。

B2 初始接线缺口中的 Client/backend/launcher profile 传递及 candidate generation 校验已补齐，显式 candidate Manager 的 Terminal/Agent 新建现选独立 generation 并明确允许首次启动，验证见生产接入第 32、32.1 节。旧绑定按原路径解析，candidate bound 恢复不启动替代 Supervisor。第 32.2 节已接通构建期固定候选与实际 extension owner/profile 注入，普通构建不启用；已编译并运行匹配 Linux Electron 资产。真实页面直接失败与有限修后结果见 32.4、32.7、32.9、32.10；A4 的 v18 与 source-eof 复验已在实际 Linux Host 完成八场景有限通过，natural source evidence=eof，stop 保留非 EOF claim，历史前置失败和未覆盖 A3/A5/A1/跨平台边界见 32.11 至 32.15。真实 Agent、其他平台与分发不由页面局部成功代证，不新增研究阶段或混做 R1 归属迁移。

生产接入设计的 L-01 至 L-05、PI-01 至 PI-06 只用于追溯上述责任，不能把历史表中的旧缺口全文重复排队。新拓扑中 provider 失效、owner 消失时的孤儿风险、允许动作和未知结果仍须确认，但不新增机器崩溃后恢复、任意故障全部清零或逐个托管后代的承诺。

### 3.1 历史 B2 有限接入范围

具体契约见 `runtime-exit-integrity-production-integration.md` 第 32 至 32.2 节，实际验收增量见 32.3 至 32.11。`src/panel/runtimeSupervisorClient.ts`、`src/panel/runtimeHostBackend.ts` 的显式启动选项，detached 路径的 `src/supervisor/runtimeSupervisorLauncher.ts`，以及 systemd 直接启动 `runtimeSupervisorMain.ts` 的参数保留同一 profile；`src/common/runtimeSupervisorPaths.ts` 与 Supervisor 入口共同约束候选仅使用独立 `terminal-exit-v1` generation，不把 profile 补到旧 live 的 storage slot。未知 profile 或 profile/generation 不匹配在连接/启动副作用前明确拒绝，连接后仍校验真实 hello 的 profile 与 reader 能力；省略 profile 的旧路径保持兼容。

`src/supervisor/runtimeSupervisorNamespace.ts` 为 Linux/Node >=20.8 candidate 在 registry 恢复前取得 abstract Unix socket claim，身份为 uid 与 `realpath(storageDir)`，不含 backend；不同 backend 共享 registry 也必须竞争同一 claim。claim 持有到进程退出，不随业务 listener 关闭或关闭失败释放；活动、非 socket 或状态未知的遗留 endpoint 拒绝启动，只清理经复核未变的明确 stale socket。candidate systemd 使用 `Restart=no`，stock 行为不变。保证仅限同 Linux 内核运行环境、本版参与者，不代证跨主机或旧 candidate 并发启动。

`CanvasPanelManager` 仅在显式 candidate 的 Terminal/Agent 新建连接准备中使用 `allowRestart:true`，按实际 backend generation 建立带 profile 的 Client；candidate Client 默认不重启，candidate bound 恢复、reader、strict delete 和未知 create 不获得新建许可。缺省旧绑定先解析为原 workspace slot，旧 raw/stream 路径保留；legacy bound 首次连接默认不重启，但保留其显式选项，stock Client 既有内部请求自动重启未整体改造，不扩大为所有旧路径完全 no-restart 的承诺。实际 `src/extension.ts` 已通过 `executionRuntimeSelection.ts` 注入 snapshot-only owner 与统一 profile；成对构建参数显式选候选，普通构建仍 stock，不新增用户配置或依据残留资产自动启用。

第 32.1 节的 Linux namespace 7/7、启动参数 16/16、Client 28/28、Host 104/104、Supervisor 82/82 及相关回归/typecheck/build 是无 PTY/Agent 的有限接线证据，systemd 仅验 unit 参数。后续实际 Linux VS Code/Webview 的 Runtime/editor 完成与重开通过，snapshot-only 重开失败保留，修后 32.10 单选完成与重开通过；Host wiring 已增至 110/110，生命周期 38 次只覆盖登记顺序。A4 的首轮/第二轮/第三轮失败事实与 v18、source-eof 复验分账见 32.11 至 32.15；最新八场景通过不能写成 A3 大尾部、A5 容量、跨平台或默认准入完成。其他平台、真实 systemd 服务与 packaged 路径没有因此获得新通过。两模式入口和本机匹配资产已接通，但不等于 B2 整体完成，最终验收及准入仍依第 4、5 节完成。

## 4. 必要验收，保留既定强度

以下六组原验收保留，另补 B4 当前态恢复的受影响验收，不建立新工具阶段。新验收要求相同当前状态/scrollback、不同累计历史下不读取捕获点之前的 journal，实际重开与 PaneGallery 切换保持状态和增量交接；旧 A1 的“不要求总回放恒定”只说明当时范围，不能豁免新要求。复用原脚本、runner 和适用证据，不累加测试数量代替用户工作流。

| 编号 | 固定检查范围 | 通过所需证据 |
| --- | --- | --- |
| A1 容量与交互 | 实际分进程生产候选与多会话；checkpoint 持续拒绝的尺寸/颜色两类已知输入；历史增长、持续输出、慢消费/离线后重连、多会话中一个节点交互；attach 中输出/resize/scrollback 与 compact 交接，运行期写失败/满盘 | 分别记录 Supervisor、Host、Webview、provider/主体的资源范围、每层缓存/在途峰值、单消息/页大小、磁盘增长、首次可交互及总恢复耗时、输入响应，并说明多会话总量；既有完整性断言保持，写失败不得伪报完整或静默丢未消费来源。预算在运行前确定并比较相同拓扑/输入的基线，合并夹具的 64/128 MiB 不替代这些预算，不要求无限历史下总回放恒定，也不把页大小当 RSS |
| A2 模式与持久化 | live-runtime 原执行在 Host 离开后继续、新 Host 同绑定重连；completed 当前页收尾、保存/删除失败、重开；snapshot-only 原保存/关闭语义；新旧 generation 共存 | 原身份和输出顺序正确；已结束 Runtime 无正文/无自动执行；轻量保存不随历史体积增长、移动节点/改 Note 不重写正文；保存失败不误删唯一来源，旧 live 不被迁移或补造保证 |
| A3 尾部与真实页面 | 严格 90000 行与既定 100000 scrollback 场景、零/非零退出、UTF-8/ANSI/OSC 尾片、慢消费；实际 VS Code/Electron Webview，editor/panel 双 surface 与多 reader | 独立成功写入凭证、逐层内容对账及实际 xterm 最终屏幕/光标；write callback 后才算页面应用。stop、force、delete、读错、断连/取消分别报告；一方取消不截断另一有效读者。marker/revision/onExit 或 headless 不能单独代证 |
| A4 真实执行主体 | 真实 Terminal，以及当前支持的真实 Agent CLI（Codex、Claude Code）；输入、resize、自然退出和各自停止策略，含实际使用的包装启动链 | 记录 CLI/版本、启动器与真实主体身份及退出时序，确认 wrapper 不提前代表实际 CLI 结束；受控 agent 标签、假 provider 或通用后代实验不代证真实 Agent |
| A5 平台、分发与责任 | Linux/macOS/Windows、live-runtime/snapshot-only；实际 Node、VS Code/Electron 与 packaged 路径，Remote SSH 按执行端平台；Windows builtin/DLL 路径和合法 VT 转换 | 支持格对应真实产物/运行时、协议能力、主体尾部、reader/worker/pipe/本方句柄释放；有界失败/unknown 不伪装成功，同 Supervisor A 收尾时 B 仍可交互。核对正常对象语义，不要求 OS 进程对象因其他合法引用而消失 |
| A6 状态替换与失败 | 一组有限顺序覆盖完整 reset/reload 重叠、首轮 pending 等待后进入的 callback、完整 template apply、旧 delete 等待后同 ID replacement；含 root A 失败/B 继续交互 | 真实入口和最终保存/消息内容证明旧操作不复活节点、不清理新执行或覆盖其他 root；strict delete 失败保留原绑定，不用 root 全局 drain、core-only 锁或吞错替代责任。S16 原回归继续保留 |

A1 的容量/交互预算和 B2 的生产收尾预算由代理负责选定并论证，不是等待用户确认的前置。先利用既有样本与已实现限额、实际队列所有权和支持环境成本，在验收运行前登记具名数值、来源及失败含义；缺测量时只允许一次有固定输入的校准，不循环试数直到绿色。记录会话数、输出量/持续时间、scrollback、慢读/离线时长、缓存/在途和内存预算、可交互时间及到期结果；对比相同输入的基线，架构性判据仍须满足。现有 1 MiB/2048 是缓存实现值，候选自然 8 秒/主动 13 秒/整体 20 秒不自动升格为生产指标；本次未测得的数值不伪造为结论，也不承诺新的对外 SLA。

历史候选预算快照（32.16时点，已由§8及容量§10.17取代）：当时准入分离为同一不可变策略，省略为executions=2、starting=1，十Terminal验收显式选10/1。固定十会话只用于声明输入，不能升格为产品上限；Q=1明确拒绝预约泄漏由 `e2a53372` 窄修并回归。当时尚需活动/未结算分账与分进程预算，现已结账；真实模块默认/非默认、unknown停排和保存占槽回归继续有效，不以两会话代替既定十会话。

历史预算进展：早期仅有fixture编码量，随后形成模块/合并authority的heap/RSS、浏览器与真实Terminal链样本，但当时尚无分进程多会话预算；后续资源模型与证据已收口至容量§10.17。A1仍按实际所有权、共享/逐会话成本及运行前预算解释结果，不沿用合并夹具64/128为产品准入线，不扣除未量化成本造绿。固定负载不是会话上限，不能缩scrollback、静默限并发或减支持范围达标。

运行期存储失败采用现有完整性目标下的 fail-closed 原则：不能继续声明输出可完整恢复，不能丢弃唯一已接受来源或持续无界积压来掩盖失败，必须反馈具名失败。可安全背压时保持可取消消费与控制；不能继续安全接收时走既有显式失败/停止结算，不以正常完成掩盖中断。具体背压阈值及实际入口的修正由 B1 负责，B2 的截止时间只限定观察/处置，不改变内容、页面或资源事实；两者均不另开通用预算研究。

A5 沿用既定平台、架构和运行时支持承诺，逐格标记通过、失败、未验或明确不支持；不能只跑 Linux 再称全部完成。只有存在真实相同的实现/环境与有效来源证明才复用证据，不能用 Node 产物冒充 Electron，也不能因没有方便的 CLI 凭据或 runner 就删除真实 Agent/平台要求。支持范围缩减、发布例外须另获用户确认；不默认要求所有诊断负例与所有环境做无意义笛卡尔积。

A5历史阶段记录（第37节时点，不覆盖§8当前证据）：当时三平台候选两模式Terminal/Webview和Linux installed已有实证，其他packaged/Remote/默认分发仍开放。随后已按§53.1及具名复用结账，不以构建机倒推最低OS，也不以冻结诊断API或stock workflow代证owned产品。2026-10-01第四轮证明固定CLI+DeepSeek的Linux原八场可用；第三轮Codex间歇失败仍保留，不被后轮抹去。独立临时配置、步骤级凭据、Secret过滤和安全摘要继续有效，不冒称官方模型/原中转或未跑平台通过。

主进程成功写入终端的尾部，以及自身已接收、排队、消费中的内容仍必须完整交付和应用；不承诺程序尚未 flush 的应用缓冲。超时、主动截断、socket close 与进程 exit 不能冒充完整 EOF。Terminal/Agent 主体存活时正常接收同终端后代输出；主体退出后的普通后代未来输出不作为产品门槛。启动器下实际 Agent CLI 仍是主体。上述边界不因清单收窄而改变。

## 5. 整体完成定义

以下是有限完成定义。§8 保留 B1 至 B3 的结账证据，B4 仍开放；完成 B4 及受影响验收、文档和整体审查后才进入合并，合并仍须用户许可：

1. F-04 在已登记的支持路径和工程负载预算内通过 A1，并满足第 3 节的容量/背压判据；剩余旧协议成本有准确兼容边界。不得只交分页或以小样本未 OOM 关闭容量问题；仍被正式支持的新路径若达不到要求，应修复，而不是换名延期。
2. F-05 已完成的新路径在 A2 保持无 completed 正文、无自动恢复进程；当前页尾部、保存失败与旧 live 保护不回退，不重新引入归档项目。
3. B2 退出完整性在既定两模式、真实 Agent/Webview、跨平台与分发路径通过必要验收，并形成经过审核的生产启用、预算与能力策略；原型开关一直关闭不算可用产品交付。
4. B3 的有限风险组完成 A6，确定影响产品的缺陷已修，未验证组合不假装通过；不以任意并发/任意故障的完备证明作为终点。
5. 一份最终支持/证据表映射 A1 至 A6，代码、规格、设计、回归和残余债务一致；没有未处置的直接产品阻塞。历史失败与后续修复分账，正式发布例外只能由用户明确接受。
6. B4 的 live 新投影从当前权威状态恢复，同状态/scrollback 下工作不随累计交互增长；真实重开与 PaneGallery、后续增量及尾部正确，只重新验证受影响范围。

不需要把所有设计候选、诊断工具、历史实验都“做完”才能达到此定义。也不允许把真实 Agent/Webview/跨平台、主进程尾部或当前有效消费者移到延期项来缩短清单。

## 6. 可延期增强与不再排队的研究

| 类别 | 当前处理 | 何时才升级为本轮阻塞 |
| --- | --- | --- |
| 通用诊断健壮性 | 无限 listener、极端错误洪泛、任意归档路径/迁移、全协议篡改/组合枚举、D4 通用资源模型继续完善，均不默认前置 | 能指明它影响 A1 至 A6 中哪一个固定实验的安全或判定，以及最小修正与结束条件；只阻塞那个实验 |
| 尚未选定的整体替代 | 换成熟 mux、换数据库及通用 checkpoint codec 扩展继续延期；live 权威当前态恢复已进入 B4，不在此列 | 直接证据证明所选方案不能满足产品契约，再有限比较替代 |
| 旧协议与模糊遗留格式 | 旧 live 沿原 backend/storage/session/generation；不回填新保证，不为去兼容强停原进程；来源不明旧记录不强制清理 | 真实共存路径破坏新会话预算、绑定或尾部，则作为 B1/B2 直接问题；不能用此项豁免当前支持的新路径 |
| 既定非目标与诊断 | Supervisor/机器故障后恢复、completed 历史归档、主进程退出后普通后代持续托管，不进入本次交付；OS 全对象清零也非要求 | 产品另行变更；本方资源泄漏、主体尾部丢失或真实 CLI 生命周期错误仍在本轮 |

原审核 F-01 连接超时与 F-02 依赖方向继续各自登记，本次不据旧报告推断它们已解决，也不自动扩成修完全部架构问题。若某项实际阻塞本清单的重连或产品验收，按对应 B 项处理必要部分并保留证据；通用分层重构不作为新前置。

## 7. R1：root 稳定归属独立计划登记

F-03 单列为后续独立计划，尚未启动实施，不是 B1 至 B3 的前置，也不由本次收尾宣称解决。本节登记目的、边界和验收输入；具体 ExecPlan 在启动该项前单独编写，不把归属迁移混进退出计划。

目标是同一运行环境、用户存储范围、root 身份与 Supervisor generation 确定稳定归属；单根和多根 Agent/Terminal 新建必须一起修改，显示名、cwd 和创建窗口 slot 不替代 root 身份。先修订 `canvas-multi-root-workspace-support.md` 设计第 6.8 节及对应产品规格，再实现发现/创建路由与必要隔离。

旧 live 继续连接 metadata 中原 backend/storage/session/kind，不能只改地址声称迁移；新会话用新归属，旧 Supervisor 随原会话及相关责任结束而退役。独立验收包括单根/多根双向新建、不同窗口 slot、并发创建、新旧 generation 共存、不同 root 故障隔离及环境/用户身份边界。当前 B3 只保护现有 root 状态与绑定，不预支这些保证。

## 8. 推进约束与证据归档

2026-10-01第49节工程增量：三平台requirements/schema2与六资产聚合已实现；首轮四格与修后 Windows x64/ARM64 attempt2 均已取得，六目标 import/聚合/固定 VSIX 及本地 Linux x64 build/load/archive 均通过。该结果关闭分发构建链，不代证最低旧 OS、各目标完整产品验收或普通默认启用；不重开已经通过的 Agent 矩阵，也不把分发脚本扩为通用诊断框架。

下表保留最终验收前的工作包映射，状态已由后面的“当前证据表”取代，不是新增待办。各包按有效证据复用，不因旧“剩余”重复编写脚本或重跑全部平台。

| 交付包 | 直接剩余责任 | 可复用且不重复立项 |
| --- | --- | --- |
| B2/A5生产工程 | 现代支持基线下的 ABI/OS/库要求与实际产品支持、正常打包/默认启用/生产准入；六资产聚合与实际执行端选择已完成 | 三平台已有 provider、同 PID 主体与逐资源责任；Windows namespace 窄修、第46节新 helper、六目标 import/聚合/固定 VSIX 均有证据；不另建 server 或下载器。旧系统兼容不属于本次前置，后续仅按实际报告处理 |
| A1/F-04最终收口 | 逐层正文/在途上界、旧协议边界、最终准入；最终生产候选的多会话资源/交互预算与必要慢消费者/重连/输入控制组合 | r23/r24 固定两会话 attach/resize/scrollback/live compact、容量10.12十会话color/size预算、10.15实际Host离线追赶时B交互；不重建compact工具、不压旧64/128门槛 |
| A2/A3未填页面格 | 慢消费者最终write应用、force/delete/读失败的不同结算、新旧generation实际共存；第46节Claude非空stop最终视口/光标诊断差异的有限语义核对；只补现有证据不能承担的真实页面责任 | 第36节journal ENOSPC/root EISDIR、completed轻量writer与旧binding受控回归、第38节surface/双Host reader、既有大尾部与停止证据；不做平台笛卡尔积或新增满盘研究 |
| A6有限用户入口 | 当前冻结 VSIX 的 snapshot-only Host 离开已覆盖；只有在产品另行区分 `closeWindow` 与 `reloadWindow` 语义时才需单列新输入 | 50项真实 Host 方法受控回归含完整 template/replacement/等待窗口、第39节 Runtime reload、第50节 snapshot-only reload 及第47节 Linux installed 多根真实 EISDIR/B 原页面 24.9ms 交互；旧 reader/EOF 未观察字段和旧首败不改，不重复已完成格 |
| A5支持与总体结账 | 其他平台installed/未覆盖架构、现代支持路径的完整 packaged 产品、默认启用与最终同一生产版本A1至A6证据表 | Linux固定VSIX及Remote Node原四阶段已通过；三平台真实Agent各原输入有限通过，改变实际启动链后只复验受影响原流程；旧OS缺环境不伪称新runner已证明，且不阻塞本次重构 |

历史证据表（2026-10-02，§53 版本结账；2026-10-07 最终 B4 增量见§13，未影响部分继续复用，历史段落不形成新队列）：

| 项目 | 当前结论 | 直接剩余 |
| --- | --- | --- |
| A1 / F-04 | 已完成：复用实际 owned 的 `10/1` color/size、`2/1` Host reconnect、r23/r24 attach/resize/scrollback/live compact；§10.17资源模型/准入及Host160、Supervisor99、页面13补齐信用/退休存储/resize/fit；新包三平台Runtime installed及十二Runtime Agent场景独立通过 | 无新增A1矩阵；不压旧64/128，不把独立snapshot状态差异误记为容量缺陷，不代证整体重构完成 |
| A2 | live原身份重连、completed无历史、保存失败保护及generation共存已具名通过；63847969新包三平台两模式installed及六snapshot-stop补齐改变serializer后的原页面/保存/新Host | 无当前直接阻塞；旧756B精确因果保留未知，新Host重开不替代原页面，旧live不升级为全部新保证 |
| A3 | 双Host/surface、多reader/大尾部、controller46/Host10和正常bundle页面13覆盖慢write/fit、viewport、credit、读错及非成功结算；最终新包两模式完整90002行及四cell样式/终态/重开验收 | 不复跑旧reader矩阵；已知not-live内部栈toast作为非阻塞风险保持，不能由此宣称任意页面排列完备 |
| A4 | 复用71b41035三平台十二Runtime Agent及未改natural路径；63847969/run36979378644六个Codex/Claude snapshot-stop独立通过，Windows24非空prefix无差异/unknown，三平台Claude1947B新Host通过 | 无新增Agent矩阵；本轮stop无模型turn，不替代旧natural实际响应/EOF；各报告selectedPass=true、全八场pass=false且六格not-run如实保留 |
| A5 | 63847969/run36979378644正常build/package/default；5861603B/53874020…实体包、140成员、六schema2/native及两mac helper100755独立核对，三平台两模式实际安装与受影响产品验收 | 最终文档整体review/PR；六资产与Remote复用具名证据，六目标build/load不扩大为六架构全部产品矩阵，旧OS不前置 |
| A6 | Runtime reload、snapshot-only reload、双 Host 失败/替换和多根交互固定组合通过 | 仅在产品明确区分 `closeWindow` 与 `reloadWindow` 时另立单项；否则不再重复 Host 离开实验 |

复用理由：十会话与重连/compact已走当前owned provider、journal、Host credit和单段索引核心；默认选择、资产聚合和新建门禁不替换这些核心，cold-start清理不改变健康Supervisor重连。local credit/resize与paged-events gate由实际Host和Chromium测试承担，最终安装包验证受影响集成。63847969只改变serializer、producer profile和受控页面断言，不改变owner/source结算、准入、信用、分页、索引或保留策略，因此不重跑容量/退出核心及natural模型请求；保存与页面保真不能复用旧未改bundle理由，已用新包复验。只有本表剩余项有效，不从历史“未验”全文追加工作。

### 历史推进与归档说明

以下旧顺序、失败和暂时状态保留原时点；最终结论以本节证据表及生产接入§53末尾为准。

当前工程顺序按有限收尾定义推进：保留 B1 修复与未完责任、A1/A2 原期限通过、各自 A4 有限结果及全部旧失败；第47节多根格、A3 双 Host 格、A6 snapshot-only Host 离开格、r23/r24 attach/compact 格及六资产构建格均已移出剩余队列。下一只收口 A1 最终生产候选的容量/交互模型、A2/A3 仍未由现有证据承担的页面语义、实际支持与最终同版本准入，不重开平台诊断或只增加 runner。第三轮 Codex snapshot stop 具名间歇失败不因未复现称已修，也不为抓红追加 CI。汇总 A1 至 A6 才宣布整体交付，F-04 和完整 A5 仍开放。

B2 会改变实际 provider、信用与消费链，最终启用产物必须复核 A1 的关键容量/交互项，不能用 B1 对此前路径的通过替新产物背书；这是最终回归，不另立容量研究或工具项目。

容量修正已确认生产源与退出完整性的直接依赖：stock node-pty 暂停 socket 不保证退出时继续排空，不能为形式上的 B1 先绿而先加有损背压。共用 owned 接入属于原 B2 工作，B1 保留未完并随该接入验收；不等待旧源的第三套实现，也不把原 heap 失败归零。后续工作的终点是实际消费链的资源/交互证据和同一生产候选，不再追加通知工具或一般调度框架。

第 3.1 节已允许显式 candidate Manager 安全准备新建连接，旧绑定不得因此重启或换 generation；普通构建仍 stock。实际候选入口与 Linux Electron 资产已接通，页面三项直接失败和 Agent 启动前提已有各自修后证据，继续有限生命周期及其余验收，不扩大为新的诊断研究。显式准入省略仍为 2/1，unknown 与尾部预算保持；固定十 Terminal 的预算/结果不泛化为无限容量。A1/A2 的10.14证明两次真实Host launch离线产出、原执行/新reader、13.009秒追平、独立完整性与自然no-history，彼时B交互在追平后；10.15另取新证据证明B51ms应用时A12到18未追平，随后13.137秒完整恢复，不能回写10.14为重叠。其他journal待写、socket/Host在途、分页消费与live compact仍按原范围核对；结束产物是实际拓扑证据与必要产品修复，不是profiler框架或把旧合并样本重跑为绿色。

每次工作必须引用 B/A 编号、写明直接产品风险和结束条件；无法映射的增强延期。校准不是验收通过，失败不得事后调宽门槛抹绿；确有环境或方案原因要修改工程阈值时，保留原值/失败和理由重新评审，不改变既定产品保证。只有外部凭据/资源确实缺失、不可逆操作或产品保证需要变更时才向用户提出具体问题，不再泛问是否同意清单。B1 修复、首次失败与未完责任记入容量 active 计划；当前 B2 接入与实际拓扑 A1 的顺序以本节为准，不因历史“下一步”再开工具阶段。

2026-10-01当前门禁：Windows真实Agent的Codex四场已通过，包含snapshot-only空状态严格判据与同Host存储重开；Claude首场natural在认证成功后提前进入stopped/EOF/applied而无output sequence，后续场景未运行，作为真实Agent生命周期直接阻塞保留。Windows产品Provider在Electron启动阶段未形成可核对报告而失败，不能归因storage helper；macOS产品Provider成功但不代证macOS Agent。A3 receipt边界纯测在当前工作树通过，但晚于固定A3 run输入，不回填其provenance。下一只回收Windows产品第一现场并触发一次macOS Agent矩阵；不把通用诊断增强、旧失败或局部Codex通过当作整体完成。

随后 `36849214028` 的macOS Agent首场Codex live natural通过，第二场Codex live stop在既有启动错误检查处失败，后六场未运行；与两次既有macOS后续场景失败的位置不同，当前按场景间候选启动/收尾稳定性阻塞处理，只再安排一次同输入重跑用于区分环境波动与确定性问题。

当前更新取代上两段的待执行状态：唯一重跑 `36850339021` / `4f613e7a` 原八场真实Codex/Claude全部passed，四natural响应/EOF与八场零清理残留通过，Codex空snapshot经新Host重开；旧间歇失败根因未知，不追认已修。Windows `36846733819` 已取得失败第一现场：Webview完整尾部与registry closed/EOF已到，Host节点仍live，升级为最终状态传播/消费产品阻塞。第42节已排队socket turn遇背压丢唤醒独立复现并局部修正，下一仅复验原产品组合，尚不声称该CI因果已闭合。Windows Claude响应已核验但实际CLI未被observer确认，先定位启动链识别；completed无outputSequence符合无历史，不能独立推断输出丢失。其余有限完成定义不变。

第45节最新回收：Windows产品36852373473原步骤成功但大工件尚未独立核对，Agent36852378637第二Codex stop观察unknown而失败，Claude修后未跑；仅修固定主动stop前的原句柄观察同步，45秒绝对截止不变。第44节Remote可用现有loopback资源自主准备实际Server Node包，无需用户SSH秘密。A5不是只缺重跑：最低ABI/OS/libc要求、Linux arm64/旧namespace、六资产聚合/执行端选择、正常package和生产准入仍是工程待办；先实现已有第37节决策，不因诊断局部绿或candidate始终默认关闭宣称交付。旧macOS API实际验证环境单列，不擅自缩支持。

历史证据继续保留原 SHA、原输入、断言、失败、工件与补救动作。D1 至 D4、U1/W1、PTY/EOF/挂断及后代对照作为诊断资料；不追认失败为通过，不为抹红重复采集，也不将旧阶段未勾项全文复制进当前清单。Windows 已退出进程仍被合法句柄引用需按对象语义解释，本方 owner 释放与 OS 对象最终销毁分开，不能盲关其他进程句柄求零。

前版 `2d375606` 只读核对与文档检查通过，容量与退出两路独立复核未发现范围阻塞；该证据不表示用户批准了草案或产品验收通过。本次按用户要求由代理承担工程裁决，变更完成定义状态、预算责任和工作顺序，历史实验/断言不改。原始审核见 `webview-host-supervisor-architecture-review.md`，容量进展见 `runtime-persistence-storage-reevaluation.md` 第 9 节，退出接线与有限证据见 `runtime-exit-integrity-production-integration.md`，契约以 `docs/product-specs/runtime-persistence-modes.md` 第 9、10 节为准。

2026-10-01 回收 macOS 新 helper 结果：`36858038984` 的 Node/provider 四场与 Electron Terminal 两模式 complete/reopen/cleanup 已按中央目录独立核对，`36858502983` 的真实 Codex/Claude 八场安全摘要为通过。Claude snapshot-only stop 保存非空状态，按既定规则未执行重开；本轮replay complete但终态比较false与历史诊断unknown分别保留，旧 helper 首败和所有旧工件保持。Windows固定产品/Agent、Remote Linux x64 loopback及随后第47节实际多根失败隔离已移出当前队列；A5六资产/兼容/默认分发、A1/F-04、A2/A3剩余页面格和A6 snapshot-only实际Host离开仍是直接责任。第48节尺寸结构缺陷局部修复不代证非空stop实际重开，不重排Agent矩阵或追加工具验证。

修订记录（2026-10-02，现代 runner 验收基线）：根据用户决定，将现代 GitHub-hosted runner 固定矩阵作为本次支持与验收输入，移除旧系统作为本轮前置的表述；保留旧系统构建要求、历史失败和未验证事实，不改写为兼容通过，也不修改平台版本声明。浮动 `latest` 产品 job 的实际镜像版本必须随 run 记录，不能用固定资产 runner 版本替代。

## 9. 2026-10-02 现代 runner 实证回收

现代 runner 的具名结果已补入本次收尾账：固定六资产 run `36906440380` 的 Ubuntu 24.04 x64/arm64、macOS 15 x64/arm64、Windows Server 2025 x64 与 Windows 11 ARM64 全部成功；macOS Product Provider `36906440973`、Windows Product Provider `36907160402` 也成功完成对应 Node/Electron candidate、Terminal/Webview、completed reopen 与 cleanup。六资产构建/加载/归档以及两条 Product Provider workflow 的通过只关闭各自固定组合，不代证全部 A1 至 A6、默认生产准入或旧系统兼容。Actions 的 Node.js 20 弃用 annotation 与 macOS artifact 的 `ENTRYNOTSUPPORTED` zip warning 均为非阻塞事实，不能从报告中删除。

Windows 真实 Agent run `36906573764` 在现代 Windows runner 上以固定 Codex `0.157.1`、Claude `2.1.280` 与 DeepSeek 完成八场；四个 natural 场景取得实际响应/EOF，八份 cleanup 的 bindings/failures/forced/active 均为零。该结果关闭的是具名 Windows Agent 矩阵，不外推 macOS、其他旧系统或非空 snapshot stop 的页面/重开等价责任。

macOS 真实 Agent 仍是具名未决。第一次 run `36906574728` 的 Codex 四场及 Claude live natural/stop 通过，但 `claude-snapshot-only-natural` 在 `tests/vscode-smoke/agent-candidate-tests.cjs:50` 的 bounded `poll()` 超时，后续 Claude snapshot stop 未运行；按既定规则仅以同输入重跑一次。第二次 run `36909378525` 的 Codex 四场通过，但 `claude-live-runtime-natural` 在 `agent-candidate-tests.cjs:153` 未及时取得 execution identity，后续 Claude 场景未运行。两次认证、构建与 runner 前置均通过，报告 `failureClasses=[]`，没有凭据、原生资源或 cleanup failure；当前只能定位为 Claude candidate 启动/reader readiness 不稳定，不能宣称 macOS Agent 矩阵通过、不能放宽原断言，也不能继续无限重跑。既有成功 run `36858502983` 及所有旧失败继续保留，不能互相覆盖。

静态核对显示第二次 `line 153` 是验收脚本的异步读取竞态：Webview xterm 的挂载探针先成功，但 Host 还可能在等待 Supervisor 分页 reader 后才把带 `executionSessionId` 的 `host/executionSnapshot` 写入测试消息；脚本原先只读一次消息。现已在 `tests/vscode-smoke/agent-candidate-tests.cjs` 保持原 30 秒上限轮询该 identity，未改弱任何产品断言。首轮 `line 50` 的 xterm 尺寸超时仍保持为独立未决；因此 macOS Agent 尚未重新取得完整矩阵通过，不能把这次 harness 修正写成业务修复。

因此当前整体完成定义不变：A1/F-04、A2/A3 页面责任、非空 snapshot stop 的页面/重开等价及最终生产准入仍开放；现代 runner 只确定本次重构的支持/验收基线，不将缺少 macOS 10.13/10.14 或 Windows 10 1809 环境解释为本轮阻塞，也不由现代结果反推低版本兼容。

随后提交 `56cec10c` 的 harness 窄修已在现代 macOS runner run `36911430020` 得到完整回收：Codex/Claude 的 `live-runtime` 与 `snapshot-only`、`natural` 与 `stop` 八场全部通过，四个 natural 场景都有实际 CLI 响应/EOF，cleanup 的 bindings/failures/forced/active 全为零。该结果关闭现代 macOS Agent 的具名矩阵，旧 run `36906574728`、`36909378525` 及更早失败作为历史保留；非空 `claude-snapshot-only-stop` 未按规则执行重开，页面 projection independence 和 A2/A3 非空 snapshot stop 等价不因此通过。整体仍只剩 A1/F-04、A2/A3 页面责任、最终生产准入等既定责任，低版本不作本轮前置。

## 10. 2026-10-02 非空 snapshot stop 重开收口

当前结果：§52 的 `1d784d8b` / Linux run `36935000098` 原八场全部通过，新增的 Claude 非空 stop 原页面独立重排与 schema2 新 Host 重开也通过，具体数值见本节末。这里只关闭固定 Linux 组合；旧两次超时根因仍未知，不为抓红重跑。慢写/最终 fit/viewport 责任仍留在原 A2/A3，其他平台新判据、F-04 与最终生产准入不由该结果代证。

本轮将 `snapshot-only` 的显式 `stop` 统一纳入两阶段验收：首 Host 必须完成保存、reader settlement、序列一致性和独立 replay；空与非空快照均设置 `reopenRequired=true`，随后由新 Host 读取同一持久化状态。空快照继续使用既有页面 origin 断言；非空快照在新 Host 阶段按保存的 xterm 状态严格核对完整非空 buffer、可见行、尺寸、光标、viewport、buffer 类型、节点序列和无新执行。

测试层改动已完成并通过 `test-agent-candidate-reopen.mjs`、`test-agent-candidate-snapshot-evidence.mjs`、`test-agent-candidate-ci-report.mjs` 及相关 JavaScript 语法检查；fixture 证据覆盖非空保存内容与页面几何。此前 `36911430020` 的非空 stop 结果仍是历史证据，未因 harness 改动追认通过；现代 runner 上的新真实非空 snapshot stop + reopen 尚未运行，A2/A3 该直接验收仍开放。未修改 Canvas/Host/Supervisor 业务代码，也未扩展旧系统矩阵。

同一提交 `30f421b3` 的 Linux runner 尝试 `36917661214` 与仅一次允许的同输入复跑 `36918349766` 均在首场 `codex-live-runtime-natural` 超时：CLI 曾被观察到，节点仍为 `waiting-input`/`liveSession=true`，cleanup 后无残留，后七场未运行。通用 `poll` 行号不能确定等待点，cleanup 后的进程事实不能证明失败前 CLI 已退出，未写出 completed output 也不等于 CLI 无输出。这是根因未定的验收阻塞，不是已证实的 Host 退出传播或服务缺陷；两次失败不改，新的真实非空 snapshot stop + reopen 仍未取得证据。

本轮限定修正直接影响 A2/A3/A4 判定的 harness 契约，不扩展工具能力或平台矩阵：新 reopen 报告显式使用 schema2 的状态/页面匹配字段，不把非空、非原点或 alternate buffer 写成 empty/origin/normal；首页面必须独立通过保存/replay/页面比较，重开成功不能替代其尾部与终态责任。合法页面尺寸变化由保存尺寸 hydrate 后独立 resize 的 oracle 对比，不采纳页面内容、光标或 viewport 为期望；在原 30 秒页面等待窗口内等候实际 snapshot 应用，不只等 xterm 挂载。全文 buffer 断言只比较非空行，另比较可见行和几何，不扩大宣称完整逐 cell 等价。

失败诊断只复用现有第一现场：精确白名单映射 timeout label，按角色输出清理前进程观察计数，私有输出复用既有 parser 生成 CLI 事件布尔值/摘要；原始错误、正文和凭据不上传，缺文件仍为 unknown。定向回归与独立审核后，只安排一次带新证据的既定 Linux 原矩阵，不重复同输入碰运气；首败即停止，依据具名事实决定产品修复或外部问题。当前原页面/重开、F-04 和最终生产准入均未关闭。

该单次运行已完成：`36935000098` / `1d784d8b` 在既定 `ubuntu-22.04` Agent workflow、Codex `0.157.1`、Claude `2.1.280`、DeepSeek `deepseek-flash` 和固定 VS Code/Electron candidate 上八场通过，四 natural 均实际响应/EOF，八场 cleanup 的 bindings/failures/forcedSignals/unconfirmedSignals/active 均为零。Codex snapshot stop 为 0 bytes / seq14；Claude snapshot stop 为 1262 bytes / seq5，保存/replay/发布状态及 reader 一致。两者保存 `66x21`、原页面 `96x30`，直接 geometry/visible 比较仍为 false，独立 hydrate→resize 后的 buffer/visible/geometry 全为 true；Claude viewport 由 10 到 8 符合独立重排结果，不通过照抄页面期望消除差异。两场新 Host 均为 schema2，实际重新读盘、同存储/工作区、正文/序列保留、页面匹配、无新执行和 cleanup 全通过；旧 empty/origin 字段为 null，不冒称非空为空。

安全报告位于 `.debug/ci-36935000098-schema2/runtime-real-agent-linux-36935000098-1/summary.json`，固定来源/hash 与独立内容核对另记 ExecPlan。原 `pageProjectionIndependence=not-proven` 不改，逐非空行/可见行/几何相等不扩大为逐 cell 或任意慢写、最终容器 fit 通过。源码只读核对发现 `main.tsx` 的 onSnapshotApplied 早于异步 write 完成，Agent/Terminal 的 fit 可独立触发，且 serialized-state 恢复分支未显式恢复保存 viewport；这些是原 A2/A3 慢写/状态应用需要具体验证的实现差异，不是本次通过或旧超时已经证明的缺陷因果。不得据静态线索猜修或新增通用工具门槛。

## 11. 2026-10-05 共享 Extension Host 的 Linux 激活回归

实际失败不是资产缺失或 glibc 过旧：用户 Remote 调试日志 `20261005T212042/exthost2/remoteexthost.log` 定位至 `resolveLinuxExecutionProviderAssets` 的 runtime glibc 参数；同一 Host 的只读 Inspector 确认 Node 24.18.1、`getReport.toString()` 为 `()=>{}`、返回 `undefined`。该 VS Code Server 自带 `extensions/copilot/dist/extension.js` 在模块入口明确替换此方法，且日志确认其已加载；同一 Server Node 独立运行报告 glibc 2.35，实际资产要求 2.14。旧 factory 在真实资产与受控同样 stub 下得到相同 `Invalid execution asset library version` 和 exit 1，保留此失败，不归类为系统或 native 资产缺陷。

### 正式方案

`panel/linuxExecutionRuntimeCompatibility.ts` 只负责读取当前执行环境的 glibc 版本，`linuxExecutionOwnerFactory.ts` 继续对真实版本与 manifest 下限进行严格数字比较。共享 Host 报告缺失、抛错或不提供该字段时，通过 `process.execPath`、固定内联脚本启动独立元数据子进程，使用 5 秒超时、SIGKILL、1024 字节输出上限、无 shell；不继承 `NODE_OPTIONS`、`NODE_PATH`、`VSCODE_INSPECTOR_OPTIONS` 注入，Electron 使用 `ELECTRON_RUN_AS_NODE=1`。子进程仅输出版本 JSON，不输出完整报告或环境，也不加载 native、启动 PTY、Supervisor 或 Agent。

成功读取的版本按进程缓存，避免每次创建/重验会话重复派生探测；缓存的是 runtime 事实，不是资产准入结论，新的 manifest 下限每次仍校验。已知低版本直接拒绝，非法已有版本不改走其他来源；独立探测失败、超时、非零退出、未知或非法结果继续明确拒绝。不得修改其他扩展或恢复共享 `process.report`，不得跳过最低版本验证或回落 stock。macOS/Windows 的 `os.release()` 路径、native 字节、尾部结算与持久化契约均未改。

本轮验证限定为 helper/factory 回归、正常构建、调试 staging 与 Linux 实际 Extension Host 激活；只复验受影响入口，不增加通用诊断框架，也不重复未受影响的真实 Agent、容量、PTY 或跨平台矩阵。验证结果另记本节，不用此前 63847969 包的通过代替本次激活检查。

验证结果：`npm run typecheck`、`npm run test:execution-native-assets`（新增 helper 37/37、Linux factory 38/38及原三平台结构回归）、`test-installed-execution-candidate.mjs` 18项、`test-debug-launch-config.mjs` 均通过。无资产环境变量的普通 `npm run build` 和 `npm run prepare:debug-main-only-extension` 已通过，F5目录已更新；六份native资产未重编。实际Server Node24.18.1独立进程将report设为同样stub后，真实factory验证现有资产成功，且stub没有被恢复或覆盖。

隔离Linux VS Code1.117.0/Electron窗口的同一 `runtime-compatibility-tests.cjs` 用例，对旧bundle复现相同错误（Host测试exit1），对新bundle实际 `extension.activate()` 返回且 `isActive=true`（exit0），并断言共享report仍为原stub。旧结果保存在 `.debug/activation-glibc-20261005-before/`，成功结果位于 `.debug/activation-glibc-20261005-after-absolute/` 及同名 `.log`。第一次新bundle尝试误传相对debugRoot，因测试模块路径未找到而未执行用例，保留 `.debug/activation-glibc-20261005-after/` 及其exit1，不写成产品失败或成功；修正调用为绝对路径后才取得上述结果。原用户窗口的Inspector端口随后关闭，因此未宣称已在其原窗口重新激活；用户需重新启动调试会话加载新bundle。

可复用入口沿现有runner，不新增框架：`DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=linux-runtime-report-unavailable node scripts/smoke/run-vscode-smoke.mjs`；需要指定独立证据目录时，`DEV_SESSION_CANVAS_SMOKE_DEBUG_ROOT` 使用新的绝对路径。该focused场景仅验证Linux激活，不纳入默认全平台smoke、不启动Terminal/Agent，也不声称新VSIX安装或macOS/Windows原生复验通过。

独立复核后，激活用例补充schema1及原生profile断言，拒绝用stock构建代证本问题；最终同用例在 `.debug/activation-glibc-20261005-profile-checked/` 与同名 `.log` 取得exit0。`test-vscode-smoke-runner-env.mjs`、JS语法及diff检查通过，隔离激活窗口无残留。该追加只验证被修改的用例限定，没有重跑未受影响矩阵。

## 12. 已停止旧 Runtime 的历史节点清理

用户现场确认原 systemd-user 服务 inactive/dead/MainPID0、残留socket没有监听；目标旧 Agent 的 version1 registry 保留 live:false、stopped、lastExitCode:0，而 Host 的 History restored 节点仍绑定原 workspace slot。严格删除连接失败得到 unconfirmed，Host 复用该记录，删除与 `prepareExecutionCandidateReplacement` 均被阻塞。没有取得原删除RPC完整内部reason，不将服务状态与历史字段扩大为所有后代或其他会话已消失。

### 正式方案

新增 `panel/legacyRuntimeHistory.ts` 只读核验原绑定，限定 Linux systemd-user 和已知旧 generation `agent-provider-lifecycle-v1`、`terminal-stream-v1`。使用有界 `systemctl --user show` 前后确认 loaded/inactive/dead、MainPID/ControlPID为0、无ControlGroup/Job，原socket探测仅明确拒绝连接/不存在可接受；未知、活跃、超时、权限不足均拒绝。registry必须是普通有界文件/version1，唯一目标sessionId、kind及backend匹配，live严格false、Agent stopped或Terminal closed、明确整数lastExitCode；只用目标记录，不推断其他会话。前后文件或服务事实变化不能取得资格。

第二现场修订：上一段的 `live:false + stopped/closed + exitCode` 保留为 `recorded-exit` 资格，但不是全部历史清理的必要条件。旧Supervisor异常结束时可能没有来得及写终态，registry.live:true只是最后保存值，不代表当前存活。新增 `stopped-runtime` 资格：仍须全部原服务/socket/文件/目标身份和Host未完责任检查，另要求有效systemd配置 `KillMode=control-group`、`SendSIGKILL=yes`，前后策略与状态一致；目标live及lifecycle须为合法旧记录，不能接受任意损坏内容。该资格确认的是原服务管理的Runtime已停止，仅解除本地历史，不补写正常退出、退出码或EOF，不承诺逃逸后代均消失。Host诊断保存具体资格来源，未知或活跃服务仍拒绝。

Host 还须确认原节点与绑定仍相同、明确历史恢复、没有当前执行、已提交创建、reader（含等待open及正在release）、在途投影或最终状态应用/保存责任。历史资格按每次用户操作重新检查，并在await后及批量结果收齐时重验身份和截止时间；registry在完整服务/socket检查后再次核对文件身份。采用独立结果 `legacy-history-retired`，只授权现有节点删除或重启路径替换该节点绑定；不伪造RPC成功、进程终止、完整EOF或新退出契约通过。

不改写共享registry、不删除旧Runtime目录/socket/其他会话数据，不要求启动旧Supervisor，不迁移会话，不混入root归属。原registry作为旧证据保留，当前节点与其本地明确归属文件继续由原删除/保存入口处理。只解除历史节点与旧记录的绑定不是对旧共享存储进行垃圾回收。

Host 对已结束且未提交的失败观察，允许下一显式操作重新观察；已提交而结果未知、连接仍在途或finalization失败/未知，继续持有原观察，不自动重发。普通活跃删除的尾部消费、最终状态保存和资源释放要求保持。验证限定原现场类型删除/重启/再次操作、活跃与未知保护、同registry隔离及相关原回归，不扩展通用诊断设施。

只读观察不是跨进程原子锁，不承诺所有后代或共享registry中的其他会话消失。当前自动化已覆盖文件原子替换、服务状态变化、socket结果与精确目标隔离；sandbox禁止本机Unix socket访问，两个真实socket场景明确跳过，不能写成实际systemd/socket端到端通过。§11及更早已验证结论保持，当前“验证中”只针对本节新增增量。

本地结果：只读核验56项通过；Host184/184（含Agent/Terminal删除、重启、清空及旧unconfirmed后的再次操作、批量metadata/reader/创建竞争）、Client28/28、启动profile16/16、原Host deactivation及调试配置回归通过。reader新增责任断言通过，首次最后一个既有headless尾部用例超时、原样重跑20/20，未改预算或断言，不追认首次绿色。`typecheck`、普通`build`与Main Only调试staging均成功；独立复核未发现新增确定性问题。详细日志与首次失败分类见归档计划；未操作用户原节点/registry/service，也未重跑无改动的Agent/容量/平台矩阵。

第二现场与修后结果：`2026-10-06T06-23-48-298Z`中目标Terminal `4afdc52d-4e97-47e9-94ff-d838a2405a44`在原registry保留live:true/lifecycle:live且无退出码，直接命中第一轮资格限制；同unit其余4个失败目标同类。旧registry.lastModified不能证明现存进程，原RPC内部完整reason仍未取得。新增强停止资格后，核验81项、Host190/190（两种资格分别覆盖Agent/Terminal删除、重启、清空及旧unknown保持）、启动profile16、typecheck、正常build/debug staging通过，独立复核未发现确定性问题。当前环境systemctl/socket权限受限，2原生socket例仍跳过；不宣称新分支在原窗口已实测。

同包另两个Agent `0a71c75b-7846-4a48-b6ad-55cd2e92f945`、`45a796db-bcc7-41bd-86fd-ac223cc4b983`绑定native `terminal-exit-v1` 的 `legacy-detached`，不属于本节systemd资格。旧sessionNotFound文本、当前空registry及缺少业务socket不足以独立证明原owner退出，继续保护。现有 `supervisor/runtimeSupervisorNamespace.ts` 的进程级排他claim可供后续有限处理复用，但本次未取得缺席证据，也未增加新平台或通用诊断阶段；这两个节点不能写成已修复。

### 第三现场：native detached 历史资格

`2026-10-06T06-47-20-517Z` 确认前轮五个systemd目标已清理，剩余两个上述native目标继续unconfirmed。本轮增加独立 `native-owner-absent` 资格，限定Linux现代Node与精确terminal-exit-v1原路径：短暂取得现有UID/canonical storage排他claim，持有期间只读核对业务endpoint缺席，并有界读取当前Linux进程视图，排除同用户仍以原 `--storage-dir` 运行的Supervisor；自己的claim实际close完成后才返回资格。权限、枚举/内容、路径、期限及释放未知均拒绝，过期晚到仍释放自己的claim。`4578cd34`的早期实验Supervisor没有claim，故不能仅凭目录名或新锁空闲放行；这项进程核对只补该历史缺口，不负责子进程托管，不保证恶意修改argv、其他PID namespace或并发手动启动旧实验版。

同批同存储共享一次观察，各目标独立保持原Host责任检查；资格不跨操作缓存。Agent/Terminal直接重启在preferred client可能启动新owner之前观察原历史，在新client能力检查和原身份重验之后才使用。观察必须在原20秒边界内完成并释放claim；已完成的缺席事实只在同一次未提交、metadata/start记录/token不变且无新增reader/finalization责任的启动操作内有效，不因preferred启动耗时再次失效并去争抢新owner的锁。普通删除/批量操作仍在原共享截止前结算。新Supervisor不恢复旧native会话，创建使用新sessionId；已失效或过期观察不能转成持久授权。

旧活跃删除仍走严格RPC及尾部结算，不被前置历史观察替代。原registry/socket/服务不修改，不补正常退出码或EOF。旧detached terminal-stream-v1不因本次原生generation方案取得资格。实现与验证见 `docs/exec-plans/completed/native-runtime-history-cleanup.md`，原用户窗口实际结果尚未取得。

本轮helper39项通过，1真实claim周期受限跳过；Host最终117/117定向通过（选中117/218），包含native28项、原systemd、严格删除/未知提交/finalization/能力准入。旧systemd helper81项、namespace路由、startup16项、typecheck、普通build及Main Only staging通过；独立复核未发现确定性blocker。两次全量Host均在未改的90,000行大快照恢复用例原15秒预算超时，尚未执行到新增用例，失败日志保留，不改阈值或把定向通过冒充完整218项通过。未重跑无改动的真实Agent、容量或跨平台矩阵。

### 第四现场：旧 detached 的纯历史解绑

`2026-10-06T07-54-50-905Z` 已记录两个native目标以native-owner-absent清理成功，但 `6b9de465-3089-464a-b20d-760384cdbdae` 仍失败。它与 `6397fe41-f010-4f53-b86d-be314005389c` 位于旧detached terminal-stream-v1，registry唯一目标live:false/stopped、无lastExitCode，结构化descriptor为recoveredHistoryOnly；同registry共13条含其他backend，不能借兄弟记录的退出事实授权。

正式新增 `detached-recovered-history` 资格，由 `panel/legacyRuntimeHistory.ts` 逐目标核验：限定Linux已知旧generation、canonical原路径与派生endpoint，version1稳定有界registry中唯一session/kind/backend匹配、live:false、Agent stopped/Terminal closed及精确结构化recoveredHistoryOnly。前后原endpoint明确不存在/拒绝、同UID任意backend的原storage Supervisor/launcher不存在，权限/内容/超时/变化均拒绝。复用 `panel/linuxRuntimeHistoryObservation.ts` 中上轮的只读socket/proc观察，不新建服务或把不被旧版遵守的native锁当证明。

这是按既定Supervisor故障后不恢复进程/历史目标作出的本地纯历史清理决策，不是退出证明。旧normalizeRecoveredSession为该对象设置process:undefined，新建/resume另用新sessionId；原authority缺席时保留节点绑定无法继续托管可能遗留的孤立进程。仅删除/替换本地历史对象，不推导原主体/全部后代消失、不补退出码或EOF、不发kill、不改共享registry/journal，也不将缺descriptor、live快照或未知状态一律放行。

Host原身份、未提交/reader/finalization及共享截止保护不变；该资格逐目标检查，不进入native的storage级共享许可，也不跨preferred startup沿用。native前置观察明确限定terminal-exit-v1，旧恢复记录在新client能力校验后走当次检查。只读观察不是旧版并发启动的原子锁；限定同Linux运行环境/用户可见的进程视图，不支持恶意改argv或跨PID namespace推断。本工具的隔离/proc不包含原Host，因此只读matches为空不能宣称原owner已停止；实际授权必须在用户Host执行fresh观察。实施与结果见 `docs/exec-plans/completed/detached-restored-history-cleanup.md`。

本轮legacy helper116项（含原81）、native39项通过，原3个真实socket/claim例受限跳过；Host新增旧detached14项并与旧history/B2组合95/95通过，另原S9/production/最终保存保护36/36通过，总用例232未全量重跑。typecheck、普通build、Main Only staging、调试配置检查和diff检查通过，独立复核无确定性blocker；未操作实际节点/registry/service，不以受控结果代证本次原窗口成功，旧大快照全量超时保持。

## 13. 2026-10-07 最终当前状态恢复与分发结账

最终产品源码为 `e38d2f72793420eefed4c6f8e2f3de255556c38d`，默认构建的新包来自 GitHub run `37613549564`：5882375 bytes，SHA256 `a9d2a4475f697e8620511533ea585eb77bed0e6fae8df7a52f41b0ac49361752`。选择为platform、executions:null/starting:1/pending:2；用户Runtime Persistence开关默认值未改变。六架构原生输入相对run `37577646133` 未变，只复用其原生资产，从当前业务源码正常打包；实体包、schema2、owner/patch源码及binary/dependency hash、macOS helper执行权限均独立核对，不重跑原生矩阵。

| 最终验收及具名复用证据 | 独立核对结果 | 边界 |
| --- | --- | --- |
| Ubuntu22.04 x64 / macOS15 arm64 / Windows2025 x64 installed live Terminal | 90000行和尾部、最终光标(6,2)、原reader applied/recorded revision1398/8370/1380；新Host重开同节点无正文/无新执行，binding/pending/registry清空 | Windows源receipt与ConPTY页面完整性分账，不声称源字节恒等；macOS仍有已登记not-live栈toast，不据尾部通过宣称该提示已修复 |
| Linux Terminal真实Reload Window | Host3721→3879；原Supervisor3817/provider3829/subject3844身份保持，新frame/reader；4821字符恢复，nonce13.1ms，整轮13.002s/exit0，EOF7/applied7；completed B无历史，无fallback | 单次小状态与真实跨Host路径；大状态由下行独立承担，不外推全平台大状态压力 |
| 三平台真实Codex独立live Reload | 新reader状态6788/8579/7134字符，final applied/recorded143/60/309；原Supervisor及实际CLI启动链保持，重开后真实应答，stop前原主体live、之后明确退出，最终空registry且零fallback | Windows退出依原SafeHandle，不要求对象消失；成功响应证据为匹配源码的严格loaded/唯一行marker检查后receipt，不声称独立重放成功画面 |
| 三平台所选Codex natural | 实际模型响应、sourceDisposition=eof，零binding/failure/forced/unconfirmed/active残留；Windows unknown为0 | 每平台只选一场，selectedPass=true/partialSelection=true/全矩阵pass=false，其余七项not-run保持 |
| F-04新读者填充态与准入 | Linux两会话100000 scrollback/2560块后panel→editor，新reader恢复10200040字符/1246块约5114.9ms，B输入18.4ms；final6495/5 applied、cleanup/exit0；同key完整open Promise共享和最多2项未释放责任回归通过 | 本地显式2:1候选入口，非最终VSIX同包试验，按相同relay实现复用；B输入在导入后，总RSS离散峰值约2.99GB、同步操作536.9ms/lag603ms不是产品硬预算，不代证十个满scrollback同时导入 |

原始工件以run内 `runtime-production-{input,installed,agent,agent-reload}-{linux,macos,windows}-37613549564` 和 `runtime-production-package-37613549564` 为来源。Linux Codex Reload的cleanup.runtime仍是较早stopping诊断，随后重新读盘的cleanup.registry才证明最终空；不得把不同时间字段拼成“始终为空”。最后停止本次隔离空闲Supervisor的动作与产品原执行资源退出分开记录。

本地默认package/installed同样exit0，证据 `.debug/f04-final-default-installed-20261007/`；current-state填充态证据 `.debug/f04-filled-current-state-20261007-staged/`。其余验收复用范围为：三个受影响Playwright页面/PaneGallery用例、等状态1/400重绘的生产组合和固定codec语义、十会话color/size与attach/compact、此前真实Claude生命周期及snapshot非空重开、两模式退出与未改Remote/native。独立Codex Reload覆盖共用恢复路径，不称Claude执行过同一种live Reload，不以这些结果声称任意addon/并发/旧Supervisor/旧OS通过。

有限产品review核对了codec先验证后安装、同队列revision捕获、Host单页/offset/真实导入确认、Webview authority/revision交接和final应用，未发现新的确定性blocker。残余固定xterm私有API、O(当前模型×有效reader)成本、历史Windows订阅停滞与not-live提示均repo-local登记；§12旧detached原窗口fresh清理未由此代证。F-01/F-02与R1/root稳定归属仍独立。本轮没有版本提升、发布或自动合并；历史失败不追认通过，普通文档收尾不再触发产品矩阵。
