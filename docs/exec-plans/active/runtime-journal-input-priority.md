# Runtime journal 分页的输入优先调度

本计划针对一个可见问题：RuntimePersistence 开启后，当前输入 Agent / Terminal 的回显可能与其他节点的 journal 页面争用 Webview 主线程。用户能看到的目标是输入节点的真实回显更快出现，同时其他节点的完整输出仍按顺序显示。

本分支从 `origin/main@37ff8554` 创建。PR #327 保持未合并；本阶段只提交设计，不改运行时代码，不做 PR #327 的合并或 cherry-pick。用户要求先审核设计，因此在用户确认前，计划停在设计门槛。

## 目标与全局图景

RuntimePersistence 的 live terminal history 由 Runtime Supervisor 的 xterm model 和 journal 授权。Webview 通过每 surface/node reader 拉取 journal 页面；每个 reader 一次只允许一个页面在途，完整应用后才推进 revision 并读下一页。用户输入通过另一条消息链路发送，Webview 与 Host 都记录最近输入节点；Host 的普通 output push 和 Webview 普通 output drain 已有优先调度。

当前分页实现使每个 `TerminalPagedProjection` 自行请求下一页，Host 直接 relay，Webview 页面回调直接进入单节点 `queueTerminalWrite()`。这条路径没有使用普通 output scheduler，因此“单 reader 有序”没有带来“最近输入 reader 优先”。设计文档 [`runtime-journal-input-priority.md`](../../design-docs/runtime-journal-input-priority.md) 提出在 Webview 放置共享的 page demand/application scheduler；该设计仍待用户确认，并且输入回显的实际卡顿因果仍未通过现场时间线确定。

计划交付分成先后两个阶段。当前阶段完成源代码路径核对、比较候选、登记正式设计提案并创建只含设计的草稿 PR。只有用户确认提案后，才继续选择全局并发参数、实施 scheduler、补回归并运行相关测试与真实 Webview 验收。

## 进度

- [x] (2026-10-25) 从最新 `origin/main@37ff8554` 创建隔离分支 `docs-journal-input-priority`，保留原工作区的未提交文件。
- [x] (2026-10-25) 对照输入状态记录、Host 普通 output scheduler、journal relay、Webview reader 和 page application 路径，确认跨 reader page request/application 不经过普通优先队列。
- [x] (2026-10-25) 比较只调度页面应用、只调度 Host read、Webview 共享两阶段调度、Host+Webview 双调度，并记录推荐方案、未验证风险和验收办法。
- [x] (2026-10-25) 生成设计提案、更新索引及相关正式记录；本分支限定为设计文档，等待用户确认。
- [ ] 用户确认设计方向和未决参数后，冻结 `runtime-journal-input-priority.md` 的正式方案，再开始代码实现。
- [ ] 实现后更新本计划和设计文档，记录定向测试、性能诊断、真实输入回显与后台公平性证据。

## 定向与代码路径

用户输入身份从 `extensions/vscode/dev-session-canvas/src/webview/main.tsx` 的 `reportExecutionInputDispatch()` 产生。Host 在 `extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts` 收到 `webview/executionInput` 时记下最近输入节点并发 input ACK；该 ACK 不经过 ordinary output scheduler。

Runtime journal reader 的拉取状态由 `extensions/vscode/dev-session-canvas/src/webview/terminalPagedProjection.ts` 的 `TerminalPagedProjection` 持有。`pull()` 看见 head 超过本地 revision 时直接调用回调发 read request；每页应用成功后才增加 revision 并拉下一页。`CanvasPanelManager.readExecutionTerminalPage()` 直接委托 `RuntimeTerminalReadRelay.read()` 并回传 page。Webview 的分页 `events` 回调在 `main.tsx` 中直接将页面事件交给该节点的 `queueTerminalWrite()` 和 `applyTerminalStreamEvents()`。

普通 push 路径使用的 `selectScheduledExecutionOutputPosts()` 与 `selectExecutionTerminalDrainEntries()` 不覆盖前述 page request/application 回调。修复设计须为多个分页 reader 引入一个共享仲裁点，但保留每 reader 的 authority、连续 revision、重试和应用回执。

## 当前设计提案

推荐新增 Webview 共享调度器。每个 reader 仍各自拥有读取身份和 revision，但在需要 page 时提交需求，而不是直接调用 Host；共享调度器先按最近输入节点和后台等待年龄挑选 read request。返回的页面再进入共享 application 队列，由同一输入优先/fairness 规则选择页面；应用须按有界 output batches 让出跨节点调度机会。只有页面的全部 output、resize、scrollback 操作都成功后，才通知原 reader 推进 applied revision 并允许下一页。

每 reader 保持最多一个页面请求/应用责任，不允许为优先级跳过页面。全局并发请求上限不在方案文档中臆定；后续通过同一多 reader 输入负载比较不同有限并发下的回显延迟、后台最大等待和页面缓存峰值，然后选择最小有效上限。单个超过 page 字节预算的 journal event 是现有协议例外，不能将全局 page 个数直接宣传成精确 RSS 保证。

推荐复用 Webview 当前最近输入节点身份和 240ms 短时优先窗口，普通非优先 controller 的 480ms 最大等待作为公平基线；二者目前仅被普通输出 drain 使用，尚未在 RuntimePersistence page 路径验证。定向诊断若显示当前回显超出窗口，应在冻结正式方案前调整输入 priority lease。所有候选和风险均记录于正式提案文档；这段推荐尚非用户已接受结论。

## 阶段与执行步骤

### 阶段一：设计核对

核对从 `origin/main` 起点的现有代码，而不是从 PR #327 的未合并 diff 推断。检查 Webview input dispatch、Host input ACK 与最近输入标记、普通 output scheduler、`TerminalPagedProjection` page request/application 完成点、Host `readExecutionTerminalPage()` 与 `RuntimeTerminalReadRelay`。结果应能说明两类路径在哪个函数处分开，并区分输入优先级已存在的路径与尚未接入的路径。

### 阶段二：候选比较与草稿 PR

正式文档比较 Webview application-only、Host read-only、Webview 共享 read/application scheduler，以及 Host+Webview 双调度。为每项写清节点内顺序、读者单页背压、跨节点公平性、页面消息竞争、资源上界和实施复杂度。推荐共享 Webview scheduler，但将 240ms 优先窗口、480ms fairness 和全局 in-flight page limit 标为尚未验证的参数。

只提交设计相关文档：新设计提案、相关旧设计的实现边界补充、`docs/design-docs/index.md` 和本 ExecPlan。PR 使用 draft 状态，标题和描述明确“设计提案 / 暂无运行时代码”。用 `git diff --check` 检查 whitespace；不运行产品测试，因为此阶段没有运行时变更。用户确认后再继续阶段三。

### 阶段三：确认后实现与验证

该阶段尚未授权开始。确认后先根据批准的方案补全正式设计状态，再以最小变更创建 Webview page coordinator，保持 wire protocol、journal 与 Supervisor authority 不变。

单元回归须覆盖输入节点 page request / application 优先、背景 reader 达到最大等待后得到服务、同一 reader revision 严格连续、整页应用完成后才 ACK、retry 同游标、迟到旧 reader response 丢弃、写失败不推进、全局 in-flight cap。Webview 集成回归须并发输出并发送真实 xterm input，不可伪造 Host input 消息绕过竞争点。最终真实 VS Code / packaged 场景记录同一 input sequence 的 input ACK、page request、page response、`paged-events` xterm write 和 applied revision，并逐节点比对完整内容、顺序、重复数及后台等待。

工作目录为仓库根。按仓库默认命令执行 `npm run typecheck`、相关 page / protocol / Webview 定向测试、`npm run build` 和具名真实 smoke；具体脚本名须先根据实现修改范围核实，记录实际运行与未运行项，不把设计 PR 的静态检查写成性能验证。

## 验证与验收

当前设计阶段以人工可读的源代码路径、候选比较及清晰的未决参数为验收。文档必须准确表述：普通 output path 已有优先 scheduler；journal page request/application 未接入该 scheduler；静态缺口未证明为现场卡顿的唯一根因。

实现阶段只有同时满足以下行为才能验收：输入节点 page 先被请求并先获 xterm 应用机会；输出不丢失、不重复、不跨 revision 乱序；reader 在应用完成前不 ACK 或拉取下一页；持续输入时后台节点仍在有界等待内推进；多个活跃 reader 的并发页面保持选定资源上限。性能比较使用同一节点数、输出负载、PTY 输入脚本和包版本，比较优先回显 p50/p95、后台最大等待、page rate、page bytes、在途页面峰值和 Webview main-thread lag。只有用户的原输入场景在同包回归中改善，才可说明产品卡顿已修复。

## 风险、回退与未解问题

优先级只能选择不同 reader 的服务时机，不能取消已开始的单节点 xterm write；因此实现须让较大 page 的 output 分批让出，不得重排同节点的 resize / scrollback 边界。请求和应用要共享清晰的 page ownership，否则取消、节点卸载和迟到响应可能双重 ACK 或卡住 reader。

全局 page concurrency 需由固定负载选取。太小会增加后台 replay 时间；太大会让消息桥、Webview event loop 和单个超大 event 的内存峰值上升。未做容量实测前，不从“最多 4 个待处理输入”等无关配额推导页面并发。

当前优先窗口在普通 Webview drain 为 240ms，后台公平上限为 480ms；这些历史配置不是 paged reader 的服务承诺。`webview-terminal-drain` 的 request/received 以及 `webview-terminal-write` 的 `paged-events` reason 可用于构建阶段时间线，但要确认现场卡顿还需在必要时关联同一 input sequence、nodeId 和 page revision。

实现若要回退，可保留 `TerminalPagedProjection` 现有 per-reader 直连行为并撤销新调度器；该回退不改变 journal 或当前 reader 身份。不得以 timeout 后跳 revision、缩减历史、隐藏节点或本地 echo 当回退方案。

## 意外与发现

2026-10-25 源码核对发现，普通 Webview output drain 的公平期限与 `EXECUTION_TERMINAL_SNAPSHOT_OUTPUT_BATCH_MAX_CHARACTERS` 的 64 KiB 页面输出批次边界是两个机制。后者使输出按批次异步写入；它不会替代 scheduler 在不同 `kind + nodeId` 间根据最近输入选择的逻辑。

## 决策记录

- 2026-10-25：推荐将 journal page 需求选择和返回页应用统一交给一个 Webview scheduler；Host 保持透明 relay。理由是只在 Host 调度无法确保 Webview xterm 写入优先，只在 Webview 应用排序又不能阻止所有后台 read requests 并行进入消息桥。方案为提案，等待用户确认；并发上限和 priority lease 未冻结。
- 2026-10-25：本分支只提交设计提案，不执行运行时实现或测试。理由是用户要求先确认方案；当前静态路径差异还不能证明现场卡顿的因果归属。

## 结果与复盘

设计提案已记录现状、优先级缺口、四个候选方案、推荐的共享 Webview 调度器、保序/公平不变量与实现验证方法。当前结果不包含代码修复，且方案状态为“比较中 / 未验证”；在用户确认前不推进 runtime implementation。
