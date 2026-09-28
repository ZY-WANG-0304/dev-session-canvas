# 收口 Runtime Persistence 的容量与交互成本

本 ExecPlan 按 `docs/PLANS.md` 维护，承接 `docs/design-docs/runtime-persistence-closeout.md` 的 B1/A1，不是新的退出诊断阶段。输入为 `8dd82629`。F-04 目标是长历史不再要求每层常驻/一次性复制完整后缀，实际在途数据有约束，恢复不挤掉交互；F-05 的无 completed 历史与退出尾部保证不变。工程判断由代理承担，不等待用户选择预算。

## 目标与全局图景

沿现有 Supervisor、journal（可校验的分段终端事件文件）、缓存及分页链，直接修正长期会话下的全量物化或无界积压。用户应能在其他节点高输出或重连追赶时继续操作当前节点；已接受内容仍按顺序可读。不能只得到小消息数字就宣布整体 F-04 完成，真实 socket、Host 与页面证据分别登记。

## 进度

- [x] (2026-09-28) 读取有限收尾契约、现有容量脚本与产品链；确认 live checkpoint 完整扫描物化、journal 待写和普通 socket 背压缺口。
- [x] (2026-09-28) 固定本轮输入、初始工程预算与事实分账，设计见容量重评第 10 节；不新增 D 系列工具。
- [x] (2026-09-28) checkpoint 先红 34,508,616 bytes retained heap，修后约 100 KiB；保留全部校验与双代语义，独立 review 所见 raw bytes 漏校验先红再补，原 journal 回归及八类损坏负例通过。
- [x] (2026-09-28) owned 写入先红：实际 append 阻塞而 consumedThrough=4；消费信用改为等待 journal 完整 flush，Terminal/Agent 慢写及失败回归通过，Supervisor wiring 77/77。
- [x] (2026-09-28) 新路径唯一一次完成负载的 1x/2x/4x 校准内存超限，保留失败；原十会话浏览器基准 1/1 通过，输入/ACK/回显 13.2/19.3/170.2ms，不代证真实 Supervisor/Agent。
- [x] (2026-09-28) 从 `4dc42c87` 修分页整段物化，先红单次读取 1,211,319 bytes；修后 64 KiB 块/当前记录/页、完整段校验及原回归通过。一次原预算对照 RSS 达标、heap 仍超限，旧失败保留。
- [ ] 收敛 journal、socket、Host 在途责任并对直接阻塞作必要修正及验证；未实施或未覆盖部分保留为 B1 未完成，不另开退出阶段。
- [x] (2026-09-28) 从 `d432bf89` 接通具名 Host 页消费信用；旧真实 socket 暂停 Host 仍推送 96 条 raw 事件先红，修后单页在途及 97 事件无损、控制/其他会话进展、compact/重连和取消隔离通过，设计见第 10.3 节。
- [x] (2026-09-28) 从 `52ff49bc` 收敛 Host/Webview 水位通知为单在途与最新待发；旧 Host 无回执 1000 条先红，修后单条及最新 revision、标题、生命周期、重附着和投递失败回归通过，浏览器 8/8；不改正文/最终应用契约，设计见第 10.4 节。
- [x] (2026-09-28) 本轮结果/残余债务已同步，独立 review 的字节校验问题已复现并修复、复核无新阻塞，以本地提交交付该增量；F-04 未整体通过，计划保持 active，不 push/PR。

## 意外与发现

输入版本 `terminalSessionJournal.ts` 的 `commitCheckpointOnWriteChain()` 调用全量 verifier，而它收集所有 events/checksums/recordByteEnds；这是正常 live 操作，并非仅崩溃恢复。`pendingWrites` 和 `writeChain` 的字符串闭包不受 1 MiB 事件缓存限制。原新 provider 的 `consumeOwnedOutput()` 等 tracker，但不等 journal 写入；普通 socket 写也没有统一等待背压。前两处已按本计划修复，代码事实不等于已测 OOM。

`audit-runtime-persistence-capacity.mjs` 当前为新旧对照而主动生成完整 snapshot/retained 数组，不能直接将其 RSS 算成新分页路径峰值；十会话基准注入 Host 消息和 ACK，不能代证实际 Supervisor/PTY。

新增 `--paged-capacity` 唯一完成负载的校准 1x/2x/4x 正文和终态正确，但所有档额外 heap/RSS 均超 64/128 MiB。实际分页会每页重新读/解析并物化整个相关段，是确定分配热点，不足以证明所有峰值归因或内存泄漏。脚本启动入口漂移和重复导出导致的两次前置失败、原 Host reconnect harness 缺 admission 方法的失败分别保留，未改变产品/历史断言求绿。

后续直接扫描修正的单次对照 RSS 增量降至最高 116.92 MiB，heap 却仍最高 103.72 MiB，整轮仍失败。每页重扫换取较低工作缓冲，4x 回放从 5.903 秒增到 7.699 秒，仍在原 30 秒内；不把工具/双 tracker 临时分配或 GC 作为未经测定的超限免责。当前已确认整段物化已消除，其他堆占用尚未归因。

通知合并的独立 review 命中同 readId 重附着：relay 可返回旧 descriptor，页面对此不执行新 reader 的初始强制拉取，清掉较新 pending 会遗失唤醒。最终实现保留同身份通知信用，于 snapshot 后显式合并当前 session revision/title；原 receipt 有效但重复无效，frame/执行身份替换后的旧 receipt 无效。这样重复 attach 也不绕过单在途限额。另保留原通用 postMessage 的 void 契约，只让提示取得原投递 Promise，避免把其他 catch 续体改成等待投递。stock node-pty 的公共 pause 不足以证明退出 drain，故当前生产源有界化不能靠简单暂停补丁关闭。

## 决策记录

2026-09-28 / Codex：普通水位通知采用独立接收回执，不能复用正文应用 ACK，也不能把 VS Code postMessage Promise 当作页面消费。bootstrap 前原地合并，最终 completed 控制消息独立交付并清理普通提示；frame/执行身份隔离由原 lifecycle 与独立 receiptId 共同保证。stock node-pty 的 socket pause 与 Unix 200ms/Windows 当前非 DLL 1000ms 退出 destroy 冲突，故旧生产链有界化随 B2 既定 owned 生产接入完成；B1/A1 仍开放，不为即将替换的路径新造生命周期，也不以候选局部测试冒充默认启用。

同轮直接失败处置只保留最新提示：投递 true 等真实 receipt，false/throw/reject 回 pending，后续输出、可见性恢复或重附着可重投，不增 timer 重试或通知丢弃门槛。错身份或旧 Promise 的迟到结果不能清理新项。协议旧页面仍逐条推送，不把兼容路径改写为已经有界。

2026-09-28 / Codex：先修可以直接证明的正常 checkpoint 全量物化；仍执行完整 checksum 验证，不放宽资格或删除坏记录。只保留本次提交需要的校验锚点与分段元数据，不改变外部完整 verifier/旧恢复接口。待写/传输约束不能通过丢 chunk、将慢的有效 reader 判为 lost 或停止其他 session 达成。

固定校准基线采用旧颜色拒绝样本的 640 个 10 KiB 输出块为 1x，测 1x/2x/4x；缓存及页沿既有限额。校准进程额外 heap/RSS 初始观察预算分别 64/128 MiB，每档分页读取目标 30 秒；这些是本轮受控回归工程界限，不是实测结果、产品最大历史或对外 SLA。必须实际应用/校验数据，测量不得保留完整后缀污染结果；若超预算先保留失败并定位，不循环改阈值。十会话原门槛保持原样。

owned 信用等待 tracker 和 journal 完整 flush，后者包括已搬入 writeChain 的正文；失败请求停止并保留实际进程责任，不能提前 live=false。预算按整个校准进程计算（一个生产和一个回放 tracker），不扣除脚本或第二模型成本。后续针对实际分页分配与传输修产品，不因校准失败另扩工具；先保留段级完整校验与旧 reader 生命周期，不添加无预算跨页缓存。

2026-09-28 / Codex：分页磁盘扫描按 64 KiB 原始块查找 LF 并拼接当前记录，避免跨块 UTF-8 损坏；页满后仍扫描到冻结段尾验证可信锚，下一页可重扫。只推进实际入页 revision，保留超大单事件独页、跨段页及 reader pin。修后复用原探针/输入/预算作一次产品对照，属于当前第二/三个里程碑，不创建新诊断阶段。

2026-09-28 / Codex：选定 Host 独立订阅信用，不借用 editor/panel reader；正文页后等待严格 line-context flush，状态同样受信用约束但不因普通 chunk 触发额外全画板保存。正常退役保留游标来源，而 delete RPC 不等其调用方待发的批次 ACK。断连释放旧责任；可读范围内恢复原消费 revision，已合法 compact 的旧游标具名拒绝并显式重建 checkpoint 基线，不追认缺失业务事件已消费。重连另行重新打开 Webview reader；一般损坏不套用该回退。这些均为本次传输改动的直接正确性要求，不新增工具门槛。

## 结果与复盘

已接通实际 Supervisor/Host 消费信用：协议显式协商，单订阅一页在途，journal 保留未消费后缀，Host 等待 line context drain；状态同样有界合并，终态不得越过正文。新增 `scripts/test/test-runtime-host-output-credit.mjs` 的真实本地 socket 对照通过，但不启动 PTY；旧业务先红、成功路径、compact 游标和 steady output 不额外产生 state 均有证据。Supervisor wiring 80/80、真实 Host 方法 10/10、原 headless writer 27/27、client 24/24 及相关回归通过。原 heap 失败仍开放。

新协商 Host/Webview 提示现也受接收信用约束；1000 次连续水位更新在暂停接收时只发 1 条，回执后合并到 revision 1000。Host 方法/实际 helper 回归、协议解析及浏览器 8/8 通过，最终应用原断言保持，独立 review 的重附着缺口已修并补测。旧 Host 方法的 1000 条先红和新测试夹具的前置错误分别保留。

先前完成 checkpoint 摘要、owned 日志信用、分页整段物化和新协商 Supervisor/Host 正文信用，F-04 仍未整体通过。首次校准失败保留在容量重评第 10.1 节；第 10.2 节同输入/预算对照 heap 为 70.72/84.50/103.72 MiB（仍失败），RSS 为 81.18/95.57/116.92 MiB（达标），本轮未重跑或追认。剩余直接工作限于生产源 owned 接入（B1 依赖原 B2）、旧订阅/旧页面兼容界限和真实消费链 heap/多会话交互验收；不转回退出工具、不为 stock 路径另造生命周期。B1 保持 active，B2（含 B3）和最终 A1 至 A6 不缩减。

## 上下文与定向

业务代码位于 `extensions/vscode/dev-session-canvas/src/`：`supervisor/terminalSessionJournal.ts` 管理缓存/写入/校验，`supervisor/runtimeSupervisorMain.ts` 管理事件串行及 socket 订阅，`panel/CanvasPanelManager.ts` 和 Webview 管理消费。原回归为 `scripts/test/test-terminal-session-journal.mjs`、`scripts/test/test-terminal-paged-projection.mjs`、`scripts/test/test-runtime-paged-completion.mjs`。容量入口为 `scripts/diagnostics/audit-runtime-persistence-capacity.mjs`；浏览器基准位于 `tests/playwright/webview-harness.spec.mjs` 的 `10-agent live output capacity benchmark`。

## 工作计划

本计划只含三个可验证里程碑：真实调用链/预算及先红；直接产品修复与定向验证；相同负载容量和交互结果及总体缺口分账。它们不生成新的子阶段。checkpoint 先红直接禁止其校验构造全历史数组，原正确性回归须继续通过；socket/待写设计只沿已核对链路落实，不引入通用消息框架。

## 具体步骤

命令均在仓库根执行。先扩原 journal 测试并运行 `node scripts/test/test-terminal-session-journal.mjs` 取得基线失败，实施后重跑。容量新路径沿原入口增加明确选择参数，随后用 `node --expose-gc scripts/diagnostics/audit-runtime-persistence-capacity.mjs --paged-capacity` 运行固定负载；GC 仅用于测量隔离，并分别记录实际峰值，不用回收后数字替代峰值。

相关验证为 `node scripts/test/test-terminal-paged-projection.mjs`、`node scripts/test/test-runtime-checkpoint-refresh.mjs`、`node scripts/test/test-runtime-paged-completion.mjs`、`npm run typecheck`。浏览器使用 `npm run build` 后执行 `node scripts/test/run-playwright-webview.mjs --grep "10-agent live output capacity benchmark"`，不为方便连带重跑默认 native 协议大套件。没有默认授权新平台 runner、用户会话操作或发布。

本轮传输回归执行 `node scripts/test/test-runtime-host-output-credit.mjs`；`--baseline-ref=d432bf89` 只读编译当时三个 transport 文件，旧代码应在暂停消费者的 raw 事件断言失败，不能用于追认新能力。并执行 `node scripts/test/test-runtime-supervisor-reader-client.mjs`、`node scripts/test/test-execution-terminal-line-context-tracker.mjs` 与 `node scripts/test/test-supervisor-execution-owner-wiring.mjs`。实际 socket 不等于实际 PTY，新增 Host AST 测试仍须注明受控持久化/通知替身。

本轮提示回归执行 `npm run test:terminal-available-credit`，同脚本的 `--baseline-ref=52ff49bc` 只读原 Host 方法取得洪泛先红。`npm run test:runtime-host-output-credit` 已串接新回归。浏览器使用 `npm run build` 后执行 `node scripts/test/run-playwright-webview.mjs --grep "availability receipts|terminal paged recovery handles|terminal consumes paged recovery through ANSI|lifecycle identity acks bootstrap"`，预期 8/8；另跑协议解析、原 paged projection、reader wiring、Host owner/deactivation 和 typecheck。该范围是产品通知改动所需回归，不扩容量工具。

## 验证与验收

保留原损坏、连续 revision、双代 fallback、读取/删除互斥断言。验证空间改进须有结构性无全量持有证据及固定增长负载，不只观察一次 RSS。校准/新旧基线/修后结果分别保存；输入、ACK、实际终端内容与公平性不能只看末尾 marker。不得把 no-PTY 实际模块测试当作实际 socket/Host/Webview 整链，也不得把浏览器 Agent 标签当真实 CLI。

## 幂等性与恢复

只用脚本创建的临时目录，不读取/迁移用户会话。旧文件格式、旧 live endpoint 和 checkpoint eligibility 不变。失败保留首报与可读来源，不删除原失败工件，不将重跑绿色覆盖首次失败；进程与文件只清理本轮明确拥有的资源。

## 证据与备注

输入 HEAD `8dd82629`，Linux x64 / Node v25.6.0。原始校准及入口失败位于 `.debug/runtime-persistence-capacity-20260928-wZfyUa/`，核心数值/输入/失败已记录在正式设计第 10.1 节。模块校准没有实际 socket/Host/UI/PTY；旧默认对照保持原样并通过，不能代证内存。owned、journal、checkpoint refresh、paged completion 与修正实例依赖后的 paged projection 回归、typecheck/build 通过；浏览器结果单独登记，不抹除原 harness 首次失败。

独立 review 的原始字节数漏洞以 `journal-review-red.log` 复现未拒绝，补 `segment.bytes` 比较后 `journal-review-green.log` 通过，最终 retained heap 为 100,216 bytes。该窄拒绝语义修正后没有重新采集容量以覆盖首次失败；失败仍是当前 B1 未闭合证据。`webview-10-agent.log` 记录原门槛 1/1 通过，纯浏览器注入场景不能代替真实 Agent、原生平台、packaged 或 Remote SSH 的最终 A1 至 A6。

本轮从 `4dc42c87` 开始，探针未改；结果在 `.debug/runtime-persistence-paged-scan-20260928-N6P27u/`，`paged-capacity.log` 的 exit 1 保留 heap 超限，`legacy-comparison.log` 为原兼容对照通过，`supervisor-wiring.log` 为 77/77。journal、paged projection/completion、checkpoint refresh、typecheck/build 通过，独立源码 review 无阻塞；未重跑不覆盖本次业务改动的浏览器注入基准，也不补造真实 Agent/跨平台通过。

只读核对发现探针 replay 每页完整序列化，而实际 Webview 页消费不做相同工作；颜色拒绝早于第三个候选模型创建，未找到保存全部历史快照的容器。差异尚未量化，heap 失败不撤销；不将先优化模拟消费者作为传输产品修正前置，归因沿实际产品入口完成。

本轮证据在 `.debug/runtime-host-output-credit-20260928/`：`socket-behavior-baseline.log` 是 96 条 raw 洪泛的旧业务失败；`socket-current-final.log` 与 `compact-steady-current.log` 是修后及独立 review 修正后的同范围 socket 结果，原日志不覆盖；`supervisor-wiring-final.log`、`host-projection-final.log` 和 `typecheck-final.log` 为最终共享树回归。新增 owned 夹具首次在收到 provider accepted 握手前就发 sourceEnd，adapter 正确以 continuous accepted tail 不符拒绝；原 `owned-immediate-exit.log` 保留。正式测试仅等待真实 provider 必需的 accepted 握手，不等 consumed 或 Host ACK，Terminal/Agent 均通过。没有把非法首轮顺序追认为正常退出通过。

本轮提示证据在 `.debug/runtime-terminal-available-credit-20260928/`：`host-notification-baseline-red-2.log` 为旧代码 1000 !== 1 的产品先红，第一份 baseline 是 git show buffer 不足的入口错误；`notification-final.log`、`transport-final.log`、`protocol-final.log` 和 `browser-final.log` 为修后回归，后者 8/8，注入 Host 消息的真实浏览器不代证实际 VS Code。reader wiring 20/20、Host owner 95/95、Host deactivation、原 headless writer 27/27 与 Host batch 10/10 通过。绕过 constructor 的原测试夹具补入真实 helper 实例后通过，首次缺字段报错保留；新增浏览器首轮两例因夹具未响应 checkpoint 初始 read 失败，修正输入顺序后复跑通过，不改原分页断言。`typecheck-final.log` 记录改变通用发送返回类型时的错误，随后保留原 void 包装并通过 `typecheck-wrapper.log`；这些不算新平台或产品尾部失败。build 与 diff 检查通过，没有新原生/真实 Agent/实际 VS Code/跨平台或 heap 通过。

## 接口与依赖

2026-09-28 的传输决策新增 `terminalHostOutputCreditV1` 能力、subscribe 的 `hostOutputCredit: journal-pages-v1` 及独立批次 ACK；旧模式语义不变。`RuntimeSupervisorClient` 只在原 socket 的异步 Host 消费完成后返信用。`ExecutionTerminalLineContextTracker.flush()` 严格等待既有操作并区分错误/取消；Host 身份失效不能记为成功消费。正常退役由未确认订阅游标保护 journal，但不把 Host 信用加入会互等的 owned reader completion。

不新增依赖、运行模式、存储 generation、root 归属或用户配置。journal 的公开完整读取/旧恢复保持兼容，正常 checkpoint 内部改为受限摘要验证。生产背压必须落实到原 owner/消费回执，不能添加无限队列来绕过限额。

修订记录（2026-09-28）：从有限收尾 B1 开始，固定调用链、负载和校准界限，先登记设计再实施；保留真实产品整链缺口，不恢复诊断框架扩张。

修订记录（2026-09-28，分页扫描）：沿已确认热点改实际 journal 分配，补原测试先红/短读/损坏回归；同探针原门槛一次对照仅 RSS 改善，heap 失败和较高回放成本继续登记，计划不关闭。

修订记录（2026-09-28，Host 信用）：同一 B1 直接修普通输出传输，不先重复优化模拟探针；冻结单页信用、独立订阅身份、line context 完成点和退役责任，保留实际整链验收。

修订记录（2026-09-28，页面提示信用）：补齐最后一段持续水位通知的有界责任与重附着/投递失败回归，明确 stock 源安全背压对原 B2 的依赖；保留当前 heap 失败和最终产品验收，不继续扩工具阶段。

最终复核补记：同身份重复 attach 不重置提示信用，`notification-reattach-final.log` 保留该简化后的回归；frame/执行替换仍隔离旧 receipt。`typecheck-closeout.log`、`build-closeout.log` 为最终共享树检查，上一轮中途返回类型失败及原绿色日志不覆盖。
