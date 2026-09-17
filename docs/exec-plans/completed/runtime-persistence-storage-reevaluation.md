# 重评 Runtime Persistence 的容量与会话归档边界

本 ExecPlan 按 `docs/PLANS.md` 记录已完成的首轮设计研究。本轮只交付架构重评、可重跑证据和后续验收门槛，不修改运行时代码，不把候选方案写成已经接受或实现的正式方案。

## 目标与全局图景

用户确认 Runtime Persistence 下的两个问题比普通画板文件并发问题更严重：checkpoint 无法推进时，完整日志后缀会同时进入 Supervisor 内存、Host 缓存和恢复消息；会话结束后，完整恢复数据又进入画板快照，使轻量画板操作承担历史数据的读写成本。此次重评要让后续协作者能解释这两个成本如何随历史增长、比较替代边界，并知道怎样证明替代方案既不丢内容，又不继续依赖全量加载。

本轮成功的可观察结果是：运行仓库内的独立诊断脚本，可以在临时存储复现有限 scrollback 与持续增长恢复后缀的差异；审核报告和设计文档清楚区分已核实事实、用户确认的优先级、推荐候选及尚未验证的协议和迁移。方案实现与真实长期运行验收不属于本计划。

## 进度

- [x] (2026-09-16) 确认当前审核分支干净，阅读工作流、ExecPlan 与设计文档规范，复核用户要求只重评问题 2、3 的边界。
- [x] (2026-09-16) 固化并运行容量诊断，复核 completed handoff 的持久化来源和删除顺序；约 80 KiB 屏幕对应约 19.35 MiB snapshot，最小内联画板的位置变更仍重写 20509666 字节。
- [x] (2026-09-16) 核对 tmux/tmux-resurrect、VS Code persistent terminal 与 WezTerm 官方文档及固定 commit 源码，在参考材料中区分原进程保活、有限终端状态、重建与归档。
- [x] (2026-09-16) 完成首轮候选比较与迁移/验收边界；根据上游研究把独立存储与终端同步分为两个比较轴，不再把分批 journal 读取当作总恢复耗时的解决方案。
- [x] (2026-09-16) 补充审核 F-04/F-05，同步现行设计、产品规格、架构入口、索引、核心信念和技术债；未修改运行时代码或依赖。
- [x] (2026-09-16) 重跑容量诊断与 tracker/journal/protocol 三组定向测试，全部通过；归档本设计阶段计划。
- [x] (2026-09-16) 完成归档引用、frontmatter/索引与 diff 最后检查；未发布分支或 MR。
- [x] (2026-09-17) 按用户补充收窄故障范围：Supervisor 崩溃/机器重启后不要求进程及终端历史恢复；增加不预设持久归档的 server 生命周期候选，保留正常运行与旧数据边界。
- [x] (2026-09-17) 完成本轮文档语义、索引/frontmatter、引用与 diff 检查；验收矩阵按候选区分磁盘/归档条件，运行时代码及测试保持不变。

## 意外与发现

前一轮临时受控验证使用当前源码的 `RuntimeSupervisorServer`、`TerminalSessionJournal` 与 `SerializedTerminalStateTracker`，禁用 Supervisor 入口启动，只注入合成输出，不启动真实 PTY。在 1000 行 scrollback、一次 OSC 默认颜色修改和三批输出后，终端序列化屏幕为 81840 字节，journal 内存事件的 output 为 19660813 字节，单次 snapshot JSON 为 20290339 字节，checkpoint revision 仍是 0。该样本证明全后缀的结构性增长，不是 OOM、真实 TUI 耗时或多平台验收；本轮已将实验固化为可重跑脚本。

`docs/exec-plans/tech-debt-tracker.md` 已登记保守 compact 的磁盘增长。本次必须扩展到内存、传输和 completed 归档的边界，不能只提高 compact 阈值，也不能把已有 compact 误写成完全不存在。

上游核对带来两条限制：VS Code 也将有限 terminal buffer JSON 保存在 workspace storage，不能把“独立数据库”写成成熟项目共同实践；WezTerm 的客户端虽有 LRU 初始容量，`make_all_stale()` 会替换为 unbounded cache，只能借鉴其按需行读取协议，不能由此推导整个实现严格有界。tmux/WezTerm 的权威终端模型提示应比较状态同步，分页 journal 本身不能解决旧 checkpoint 后的总回放成本。

## 决策记录

2026-09-16 / 用户：问题 2（完整后缀的容量模型）和问题 3（completed 恢复数据内联画板）是本轮优先重评对象，不能仅作为较轻的写文件问题处理。

2026-09-16 / Codex：沿用 `architecture-review-webview-host-supervisor`，运行时代码仍基于 `origin/main@4d7f07e55461f414c570365136cc06ece6f18c64`。当前工作是该架构审核的延续，不另切分支，不自动发布 MR 评论。

2026-09-16 / Codex：新建设计文档 `docs/design-docs/runtime-persistence-storage-reevaluation.md`，状态使用“比较中 / 验证中”。优先评估独立会话存储、有界读取和轻量画板引用，但文件布局、数据库选择、预算及新协议未选定。保留现有 authority/revision、无损日志与旧 live session 原绑定，不用截断历史或改写 runtime 地址替代迁移。

2026-09-16 / 用户：补充 tmux 和其他开源终端持久化方案的参考研究。研究以官方文档和固定源码快照为输入，必须区分原进程保活、屏幕/scrollback 恢复、布局/命令重建与完整历史归档；没有运行上游真实场景时只写源码/文档核对，不声称已验收。

2026-09-16 / Codex：在 `docs/references/terminal-persistence-open-source-survey.md` 保留输入证据，设计文档增加 S1（checkpoint/journal）、S2（权威状态/行同步）、S3（成熟 mux backend）比较。B 的独立会话存储仍推荐验证，但下一阶段需对照 B+S1/B+S2，并核对 S3 的能力矩阵；未选择 tmux，也未允许裁剪未消费内容或降低原进程保证。

2026-09-17 / 用户：Supervisor 自身崩溃或机器重启后，不需要恢复进程，甚至可以不恢复历史。这不是要求删除已保存数据，也没有取消 Supervisor 存活时的 Host/Webview 重建或正常 completed 行为。

2026-09-17 / Codex：据此修订前一日的推荐，不再把 durable journal、独立归档或灾备服务预设为所有候选的必要条件。优先验证现有 Supervisor 内的权威终端状态与受控缓存，磁盘可按慢消费者/正常历史需要使用；B+S1 作为兼容比较，具体实现仍待验证。更新设计、规格、审核、架构、参考输入的产品解读、索引和技术债；本轮只是已完成研究的边界补充，不执行运行时改造。

## 结果与复盘

首轮研究完成：可重跑诊断确认 F-04/F-05 的结构性增长，固定版本开源对照促使候选从“只外置历史并分页”扩展为“存储职责与终端同步分开比较”。审核、现行 lossless 设计、产品规格、架构入口、索引、核心信念和技术债已同步，三个 correctness 回归继续通过。

尚未完成且不属于本轮交付的是历史保留/磁盘策略的产品决定、B+S1/B+S2 受控对照、S3 平台/安全能力矩阵、正式协议与格式选择、迁移/GC 故障注入和真实长期运行验收。这些由后续设计与实现计划推进，技术债 F-04/F-05 保持开放。未运行上游真实产品实验，不声称任何候选已验证。计划完成只代表首轮架构重评交付，不代表新存储方案定稿或生产行为改变。

2026-09-17 补充后的剩余范围以设计第 6.3、8、9 节为准：先验证不要求跨 Supervisor 故障恢复的最小模型，再决定是否需要 B 的落盘/归档。Host 退出但 Supervisor 存活时的连续性仍要验收，Supervisor 崩溃/机器重启后则只检查不伪装原 live 会话，不要求历史恢复。正常 completed 保留、预算、终端语义及旧会话兼容仍未定稿，当前磁盘日志和 handoff 代码不变。

## 上下文与定向

`extensions/vscode/dev-session-canvas/src/supervisor/runtimeSupervisorMain.ts` 是跨 VS Code 生命周期持有进程的 Supervisor；`src/panel/CanvasPanelManager.ts` 是持有画板状态的 Host。Agent 和 Terminal 在 live-runtime 模式下都走前者的终端事件链。authority 是一个会话输出权威的身份，revision 是事件顺序号。checkpoint 是在明确 revision 上可恢复的终端状态；journal 是其后按顺序保存的 output、resize、scrollback 事件。保守 compact 只有在 checkpoint 可证明正确且保留条件满足时才删除日志前缀。

`src/common/serializedTerminalState.ts` 的 `flushValidatedCheckpoint()` 会拒绝过大或无法证明正确的状态。`src/supervisor/terminalSessionJournal.ts` 同时维护磁盘分段和内存事件；`runtimeSupervisorMain.ts` 的 `buildTerminalStreamAttachPayload()` 返回完整 checkpoint 后缀。Host 的 `handleRuntimeSupervisorTerminalEvent()` 缓存事件，`performExecutionTerminalProjectionRefresh()` 每 10–12 秒错峰请求完整 snapshot。`applyCompletedRuntimeSupervisorSnapshot()` 将最终 stream 写入节点 metadata，等待 root 与窗口快照成功才解绑并请求删除 Supervisor journal。

正式设计输入是 `docs/design-docs/agent-terminal-lossless-io-and-recovery.md` 的第 10.11、10.13–10.15 节及 `docs/product-specs/runtime-persistence-modes.md`。这些机制已有正确性动机，本轮评价长期资源与归档边界，不把它们误写成已证明违反当前规格的实现回归。root 稳定 Supervisor 归属是原审核 F-03，需兼容但不在本轮实施。

## 工作计划

### 里程碑一：保留可复现基线

新增 `scripts/diagnostics/audit-runtime-persistence-capacity.mjs`，使用已有 TypeScript/esbuild 在内存构建 Supervisor 测试入口，不执行 main、不监听正式 socket、不读取用户运行时目录。用临时 journal、真实 headless xterm 和实际 snapshot 方法记录分阶段的屏幕、内存事件、journal 文件及恢复响应字节数。补充 completed 状态的 snapshot 和内联画板体积观察。脚本断言当前基线的触发条件和数据完整性；它是审核诊断，不是未来实现必须保留当前缺陷的测试。

### 里程碑二：完成边界与候选比较

先核对 tmux/tmux-resurrect、VS Code persistent terminal 与 WezTerm 的官方说明和源码，记录版本或 commit、原始链接及保证边界。不要把参考项目的有限历史或重新启动命令误认为本产品无损保证的替代品；以研究结论修正候选，而不是为预先选定方案寻找背书。

新增设计文档，比较仅改善 checkpoint、独立会话存储加分批读取、只外置 completed 大对象三条存储路径，并独立比较 checkpoint/journal、权威状态同步和成熟 mux backend。明确“磁盘历史允许增长”不等于“所有历史必须常驻内存”；分批读取不能单独保证总回放时间固定。记录会话身份、归档提交与读取、GC（只回收确定无引用数据）、损坏和满盘、慢消费者、旧快照迁移的待验证契约。结论仍是候选，不预设 SQLite、tmux、额外常驻服务或具体预算数字。

### 里程碑三：审核与文档一致性收口

在 `docs/design-docs/webview-host-supervisor-architecture-review.md` 登记高优先级架构重评 F-04/F-05，并将本轮发现与此前 F-01/F-03 区分。原 lossless 设计保留现行规则、追加待重评说明；产品规格追加未实现的容量与归档验收方向。同步 `ARCHITECTURE.md`、设计/产品索引、`core-beliefs.md` 和技术债，避免一处写待定、一处声称已实现。运行验证后将本计划移入 completed，并更新所有指向本计划的引用。

## 具体步骤

以下命令均在仓库根目录执行，依赖已安装的工作区 Node.js/npm 开发依赖：

    node scripts/diagnostics/audit-runtime-persistence-capacity.mjs
    npm run test:serialized-terminal-state-tracker
    npm run test:terminal-session-journal
    npm run test:runtime-supervisor-protocol
    git diff --check

诊断预期输出三阶段 JSON 指标、checkpoint 拒绝原因、completed snapshot 和内联画板体积。现行缺陷未改，受控场景应继续表现为屏幕大小稳定而后缀增长。检查本次新增文档的所有仓库路径、frontmatter 与索引枚举/日期一致；用 `git diff --name-only` 确认无运行时文件或依赖清单变更。只暂存本任务文档和诊断脚本，按 `docs/workflows/COMMIT.md` 做本地提交。

## 验证与验收

本轮验收以证据可复跑和文档语义一致为准。必须同时写明现有 correctness 测试通过与容量不足可同时成立；不得把单进程合成输出实验当作真实 Agent、多窗口、Remote SSH、Windows 或长期 OOM 验收。后续方案验收要求完整 revision/内容保留、单次读取/在途缓冲有上限、仅修改画板不重写会话历史，以及归档和引用迁移中断后仍有可读取的旧来源。具体数值预算、总恢复耗时和平台支持在后续设计验证中确定，本轮不承诺已经满足。

## 幂等性与恢复

诊断只使用 `os.tmpdir()` 下自行创建的目录，结束时 flush/dispose 并删除自身产物。任何失败不能清理用户 journal、修改根画板或重启用户 Supervisor。没有生产格式、metadata 或 live session 迁移，也没有新增生产依赖。文档更新前后保留现行契约，方便读者区分现状与候选；不回滚无关工作树变更。

## 证据与备注

2026-09-16 本轮重跑的容量诊断与 `test:serialized-terminal-state-tracker`、`test:terminal-session-journal`、`test:runtime-supervisor-protocol` 均以 code 0 结束。诊断的三阶段 snapshot 分别为 6763684 / 13526849 / 20290369 字节；屏幕始终 81840 字节，checkpoint revision 为 0。completed 最小内联画板首次写及位置变更后写均为 20509666 字节，真实 Host handoff 未在该诊断中执行。

协议测试的本轮 10-Agent 样本为 input RPC 20.29ms、echo 30.35ms、全部输出 294.31ms；该短样本不覆盖长期 checkpoint 拒绝，也不替代真实 VS Code/Remote SSH/Windows 验收。源码研究只核对五个仓库快照（包括独立的 vscode-docs），完整 commit 与官方链接保留在参考材料中。

文档检查首次扫描整个已修改索引时遇到既有失效路径 `docs/exec-plans/completed/execution-node-zoom-interaction-research.md`，与本次行变更无关；最终检查区分既有缺口和本次新增/修改引用，不顺手修复其他研究索引。

最终定向检查通过：12 份本次文档的新增/修改仓库引用、3 份设计 frontmatter 与索引的标题/状态/日期/关联路径一致，参考材料的 29 个上游链接均使用完整 commit 且对应已核对源码；诊断脚本通过 `node --check`，diff 无空白错误，运行时和依赖清单无修改。这不是全仓库链接或全部上游行为的验收。

2026-09-17 边界补充验证通过：用 Node.js 与现有 YAML parser 检查本次 11 份 Markdown 的变更范围、新增/修改仓库引用、3 份设计 frontmatter 与索引的状态/日期/关联路径，以及故障例外和候选验收条件；`git diff --check` 无错误。运行时代码、诊断脚本和依赖未修改，本次未重跑运行时测试或容量诊断；前述测试结果属于 2026-09-16，不作为新候选的实现验证。

## 接口与依赖

复用 Node.js、TypeScript、esbuild、已有 headless xterm 与 Supervisor 实现。诊断脚本允许通过 AST（TypeScript 的语法树）移除唯一入口调用、临时导出未公开测试类，不改源文件。新会话存储/分批读取接口只在设计中列出所需语义，不创建生产接口、不引入 SQLite 或服务依赖。

修订记录：2026-09-16 创建首轮设计重评计划，记录用户优先级、当前基线、受控证据、候选比较与不改运行时的交付边界；同日按用户追加要求补充开源方案对照，新增状态同步比较轴，完成诊断/回归与文档同步后归档，方案保持比较中。

修订记录：2026-09-17 根据用户明确的故障范围修订保证、候选优先级与验收矩阵；不再预设灾难后历史恢复，也不把该例外扩大为正常路径的数据删除许可。
