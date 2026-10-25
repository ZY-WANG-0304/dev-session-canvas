# Runtime journal 分页的输入优先调度

本计划针对一个可见问题：RuntimePersistence 开启后，当前输入 Agent / Terminal 的回显可能延迟。输入与输出是两条不同链路；本计划要定位的是按键已进入 PTY 后，输出通过 Supervisor journal、page read、Host/Webview 消息传递和 xterm 绘制的具体等待，再基于数据选修复方案。用户能看到的目标是输入节点的真实回显更快出现，同时其他节点的完整输出仍按顺序显示。

本分支从 `origin/main@37ff8554` 创建。PR #327 保持未合并；本阶段只提交设计，不改运行时代码，不做 PR #327 的合并或 cherry-pick。用户要求先审核设计，因此在用户确认前，计划停在设计门槛。

## 目标与全局图景

RuntimePersistence 的 live terminal history 由 Runtime Supervisor 的 xterm model 和 journal 授权。Webview 通过每 surface/node reader 拉取 journal 页面；每个 reader 一次只允许一个页面在途，完整应用后才推进 revision 并读下一页。用户输入通过另一条消息链路发送，Webview 与 Host 都记录最近输入节点；Host 的普通 output push 和 Webview 普通 output drain 已有优先调度。

当前分页实现使每个 `TerminalPagedProjection` 自行请求下一页，Host 直接 relay，Webview 页面回调直接进入单节点 `queueTerminalWrite()`。各 session page RPC 独立异步发起，目前没有证据表明它们排进了同一条全局 FIFO；因此不能仅凭缺少 read scheduler 断定当前节点的读请求会被后台节点挡住。明确缺少的是多个已返回页面之间的 Webview/xterm 应用优先级。设计文档 [`runtime-journal-input-priority.md`](../../design-docs/runtime-journal-input-priority.md) 提出先给页面应用增加共享调度器，保留现有 reader demand flow；读阶段只有在现场诊断证明有共享排队后再设计调度。回显卡顿的具体因果仍未通过现场时间线确定。

计划交付先定位再修复：已核对源码并梳理现有诊断；下一步先从真实复现场景导出现有 Host 诊断，确认输入、Host→PTY、page read/回传和 Webview 应用各阶段能解释到什么程度。现有记录缺少 page RPC 时长、请求/回执的完整关联和页面排队至 xterm write start 的等待；若初筛不能定位，先提出 bounded trace 的字段和采样设计，再经设计确认后采集。取得瓶颈证据后才选择年龄、WRR、DRR/WFQ 或其它调度策略；任何运行时修复均需用户确认设计后才开始。

## 进度

- [x] (2026-10-25) 从最新 `origin/main@37ff8554` 创建隔离分支 `docs-journal-input-priority`，保留原工作区的未提交文件。
- [x] (2026-10-25) 对照输入状态记录、Host 普通 output scheduler、journal relay、Webview reader 和 page application 路径，确认跨 reader page request/application 不经过普通优先队列。
- [x] (2026-10-25) 盘点现有 performance diagnostics：输入派发 / Host 接收与 ACK / Host PTY write、事件循环 lag、普通 push output、journal page request/receive 与 Webview xterm write 样本及落盘入口。
- [x] (2026-10-25) 比较 page 应用、Host read、Webview demand/application、双层调度，以及 RR、WRR、年龄公平、DRR、WFQ、EDF；将调度算法选择暂缓到现场数据之后。
- [x] (2026-10-25) 更新设计提案、索引及 ExecPlan；PR 限定为诊断优先的设计文档，不含运行时代码。
- [ ] 用户在目标 VS Code 宿主复现问题并导出现有诊断，提供 `execution-performance-diagnostics.json`、`diagnostic-events.json` 与 `summary.json` 供阶段归因；性能样本不含终端正文，其它 dump 字段分享前需检查并脱敏。
- [ ] 若现有采样不足，先确认 bounded trace 设计，再实现仅用于短时复现的诊断采集；据该 trace 选择显示链路调度方案。
- [ ] 基于现场证据更新设计并等用户确认；确认后才实现修复、补回归并运行相关测试与真实 Webview 验收。
- [ ] 实现后更新本计划和设计文档，记录定向测试、性能诊断、真实输入回显与后台公平性证据。

## 定向与代码路径

用户输入身份从 `extensions/vscode/dev-session-canvas/src/webview/main.tsx` 的 `reportExecutionInputDispatch()` 产生。Host 在 `extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts` 收到 `webview/executionInput` 时记下最近输入节点并发 input ACK；该 ACK 不经过 ordinary output scheduler。

Runtime journal reader 的拉取状态由 `extensions/vscode/dev-session-canvas/src/webview/terminalPagedProjection.ts` 的 `TerminalPagedProjection` 持有。`pull()` 看见 head 超过本地 revision 时直接调用回调发 read request；每页应用成功后才增加 revision 并拉下一页。`CanvasPanelManager.readExecutionTerminalPage()` 直接委托 `RuntimeTerminalReadRelay.read()` 并回传 page。Webview 的分页 `events` 回调在 `main.tsx` 中直接将页面事件交给该节点的 `queueTerminalWrite()` 和 `applyTerminalStreamEvents()`。

普通 push 路径使用的 `selectScheduledExecutionOutputPosts()` 与 `selectExecutionTerminalDrainEntries()` 不覆盖前述 page application 回调。修复设计须为多个分页 reader 的 xterm 应用引入一个共享仲裁点，但保留每 reader 的 authority、连续 revision、重试和应用回执；page RPC 第一阶段仍按当前独立 demand 立即发起。

## 当前设计提案

共享 Webview 页面应用调度器仍是一个结构上合理的候选，但不作为当前已推荐/已选择的修复。用户首先要用现场 span 区分 Host 输入→PTY 写入、Supervisor onData→journal revision、page read/回传、Webview page queue wait、xterm write callback 和 callback 后绘制机会。只有证据显示 page 返回后在 Webview/xterm 争用导致主要等待，才继续采用或修改该候选；其它阶段占主导则设计应转向对应边界。

现有模型为每 reader 最多一个页面请求或待应用页面，不允许为优先级跳过页面。静态调用链未发现共享 read FIFO，因此提案阶段不预设全局 read 并发上限；若 trace 显示 Host/Supervisor read admission 或桥接处形成共享积压，再按实测资源与等待设计限制。每 reader 至多缓存一页意味着正文内存按活跃 reader 数增长；单个超过 page 字节预算的 journal event 是现有协议例外，不能将页数直接宣传成精确 RSS 保证。

240ms 输入窗口、480ms 后台公平阈值及 4/16/32 Ki 字符预算只是现有 ordinary drain 的实现参数，当前均不是 journal path 选型。RR/WRR/DRR/WFQ 直接影响多个 ready output readers 的显示容量分配，应结合输入 echo p50/p95、各节点输出吞吐、后台最长无服务时间及总排空时间比较；年龄策略优先控制最长服务等待，DRR/WFQ 主要按配置分配吞吐。具体组合待现场数据决定。

## 阶段与执行步骤

### 阶段一：设计核对

核对从 `origin/main` 起点的现有代码，而不是从 PR #327 的未合并 diff 推断。检查 Webview input dispatch、Host input ACK 与最近输入标记、普通 output scheduler、`TerminalPagedProjection` page request/application 完成点、Host `readExecutionTerminalPage()` 与 `RuntimeTerminalReadRelay`。结果应能说明两类路径在哪个函数处分开，并区分输入优先级已存在的路径与尚未接入的路径。

### 阶段二：诊断先行设计与草稿 PR

先从目标现场执行 `Dev Session Canvas: 落盘当前宿主诊断`，保留 `execution-performance-diagnostics.json`、`diagnostic-events.json`、`summary.json`。按现有样本先区分 input/ACK、Host PTY write、主线程 lag、page request/receive、xterm write。严格说明 ACK 早于 PTY write 完成，普通 push output 指标不代表 journal page。

若该捕获不能定位，则先提交 bounded trace 的诊断变更设计供审阅：短时 opt-in、固定时长及环形样本上限、目标节点完整采样、后台限速；记录 dispatch 到 applied / render opportunity 的阶段时间、page request/revision 标识、ready queue 等待和 backlog；不记录输入或终端正文。用户确认 trace 设计后再实现并采集。形成 p50/p95/max 与同条件背景输出对照，再基于证据从 page-application-only、Host read、共享 demand/application、双层调度架构，以及 RR、WRR、strict priority + reservation、年龄公平、DRR、WFQ、EDF 中选择合适组合。

目前 PR 只登记数据需求、已有字段与缺口、候选算法的目标差异及选型门槛；不声明已选择 scheduler 或其参数。240ms、480ms、4/16/32 Ki UTF-16 code unit 是现有普通 drain 参考值，64 KiB page cap 是传输限制。

只提交设计相关文档：新设计提案、相关旧设计的实现边界补充、`docs/design-docs/index.md` 和本 ExecPlan。PR 使用 draft 状态，标题和描述明确“设计提案 / 暂无运行时代码”。用 `git diff --check` 检查 whitespace；不运行产品测试，因为此阶段没有运行时变更。用户确认后再继续阶段三。

### 阶段三：基于数据更新设计并确认

取得诊断后更新正式设计：记录实际等待阶段、竞争负载、可复现性与统计范围，确认修复边界和调度算法。只有用户确认数据归因及方案后才能进入运行时实现；若现有采集不足，诊断补充变更也需先审阅具体字段和采样开销。

### 阶段四：确认后实现与验证

此阶段尚未授权开始。确认后才实施对应最小修复；如果证据支持 page application scheduler，再创建 Webview page coordinator，保持 wire protocol、journal 与 Supervisor authority 不变。

如果实施 page application scheduler，单元回归须覆盖输入节点已返回 page 的应用优先、后台 reader 公平服务、同一 reader revision 严格连续、整页应用完成后才 ACK、retry 同游标、迟到旧 reader response 丢弃、写失败不推进。Webview 集成回归须并发输出并发送真实 xterm input，不可伪造 Host input 消息绕过竞争点。最终真实 VS Code / packaged 场景按新 trace 记录输入至 PTY、journal revision、page RPC、page queue wait、xterm callback、paint opportunity 与 applied ACK；逐节点比对完整内容、顺序、重复数及后台等待。若归因在别的 stage，则对应的回归和性能指标按实际修复更新。

工作目录为仓库根。按仓库默认命令执行 `npm run typecheck`、相关 page / protocol / Webview 定向测试、`npm run build` 和具名真实 smoke；具体脚本名须先根据实现修改范围核实，记录实际运行与未运行项，不把设计 PR 的静态检查写成性能验证。

## 验证与验收

当前设计阶段以人工可读的源代码路径、候选比较及清晰的未决参数为验收。文档必须准确表述：普通 output path 已有优先 scheduler；journal page 应用未接入它；page RPC 是 per-session 独立异步请求，没有证据表明存在共享先来先服务队列；静态差异未证明为现场卡顿的唯一根因。

实现阶段只有同时满足以下行为才能验收：输入节点已返回的 page 先获 xterm 应用 quantum；输出不丢失、不重复、不跨 revision 乱序；reader 在整页应用完成前不 ACK 或拉取下一页；持续输入时后台节点仍获得轮转 quantum；每 reader 的在途/待应用正文仍最多一页。性能比较使用同一节点数、输出负载、PTY 输入脚本和包版本，比较优先回显 p50/p95、后台最大等待、page rate、page bytes、待应用页面峰值和 Webview main-thread lag。只有用户的原输入场景在同包回归中改善，才可说明产品卡顿已修复。

## 风险、回退与未解问题

优先级只能选择不同 reader 的服务时机，不能取消已开始的单节点 xterm write；因此实现须让较大 page 的 output 分批让出，不得重排同节点的 resize / scrollback 边界。请求和应用要共享清晰的 page ownership，否则取消、节点卸载和迟到响应可能双重 ACK 或卡住 reader。

当前不增加全局 page concurrency cap。每 reader 一页提供 per-reader backpressure，但 aggregate page memory 会随活跃 reader 数增长；若受控诊断发现 Host read/post 或 Webview bridge 上形成共同队列，再为该共享资源单独设计限额与 priority lane，并按相同负载测量。不得从“最多 4 个待处理输入”等无关配额推导页面并发。

当前优先窗口在普通 Webview drain 为 240ms，后台公平上限为 480ms；这些历史配置不是 paged reader 的服务承诺。`webview-terminal-drain` 的 request/received 以及 `webview-terminal-write` 的 `paged-events` reason 可用于构建阶段时间线，但要确认现场卡顿还需在必要时关联同一 input sequence、nodeId 和 page revision。

实现若要回退，可保留 `TerminalPagedProjection` 现有 per-reader 直连行为并撤销新调度器；该回退不改变 journal 或当前 reader 身份。不得以 timeout 后跳 revision、缩减历史、隐藏节点或本地 echo 当回退方案。

## 意外与发现

2026-10-25 源码核对发现，普通 Webview output drain 的跨 controller 公平期限、`EXECUTION_TERMINAL_SNAPSHOT_OUTPUT_BATCH_MAX_CHARACTERS` 的 64 Ki JavaScript UTF-16 code unit snapshot output 批次，以及 journal page 的 64 KiB byte cap 是不同机制。snapshot batch 让输出分批异步写入；它不会替代 scheduler 在不同 `kind + nodeId` 间根据最近输入选择的逻辑，也不能直接作为 page application quantum。

## 决策记录

- 2026-10-25：初始候选从“Webview 同时调度 page demand/application”收窄为“保留 per-reader 独立 demand read，考虑共享 xterm 页面应用调度”。理由是静态调用链没有显示跨 session 共享 read FIFO；此时只识别到页面应用选择点未经过普通 output scheduler，尚未证明它是现场的主要等待阶段，因此仍需现场诊断后决定是否实施。
- 2026-10-25：本分支只提交设计提案，不执行运行时实现或测试。理由是用户要求先确认方案；当前静态路径差异还不能证明现场卡顿的因果归属。
- 2026-10-25：在收集现场输入和输出链路数据前，不选择年龄公平或其它算法，也不把 page application scheduler 当成已确认修复。先使用已有性能诊断；若其采样和关联字段不足，再审阅 bounded trace 方案。显示链路的吞吐分配直接影响输入 echo 页的排队时间，应同时分析回显时延、节点吞吐和总排空时间。

## 结果与复盘

设计提案已记录当前诊断能力及缺口、控制变量采集方法、需要关联的阶段 span，以及调度架构/算法候选。当前未选择算法或根因，不含代码修复；先等待目标宿主导出现实复现场景数据，再据证据更新方案。
