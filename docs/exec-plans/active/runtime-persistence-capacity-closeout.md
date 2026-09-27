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
- [ ] 收敛 journal、socket、Host 在途责任并对直接阻塞作必要修正及验证；未实施或未覆盖部分保留为 B1 未完成，不另开退出阶段。
- [x] (2026-09-28) 本轮结果/残余债务已同步，独立 review 的字节校验问题已复现并修复、复核无新阻塞，以本地提交交付该增量；F-04 未整体通过，计划保持 active，不 push/PR。

## 意外与发现

输入版本 `terminalSessionJournal.ts` 的 `commitCheckpointOnWriteChain()` 调用全量 verifier，而它收集所有 events/checksums/recordByteEnds；这是正常 live 操作，并非仅崩溃恢复。`pendingWrites` 和 `writeChain` 的字符串闭包不受 1 MiB 事件缓存限制。原新 provider 的 `consumeOwnedOutput()` 等 tracker，但不等 journal 写入；普通 socket 写也没有统一等待背压。前两处已按本计划修复，代码事实不等于已测 OOM。

`audit-runtime-persistence-capacity.mjs` 当前为新旧对照而主动生成完整 snapshot/retained 数组，不能直接将其 RSS 算成新分页路径峰值；十会话基准注入 Host 消息和 ACK，不能代证实际 Supervisor/PTY。

新增 `--paged-capacity` 唯一完成负载的校准 1x/2x/4x 正文和终态正确，但所有档额外 heap/RSS 均超 64/128 MiB。实际分页会每页重新读/解析并物化整个相关段，是确定分配热点，不足以证明所有峰值归因或内存泄漏。脚本启动入口漂移和重复导出导致的两次前置失败、原 Host reconnect harness 缺 admission 方法的失败分别保留，未改变产品/历史断言求绿。

## 决策记录

2026-09-28 / Codex：先修可以直接证明的正常 checkpoint 全量物化；仍执行完整 checksum 验证，不放宽资格或删除坏记录。只保留本次提交需要的校验锚点与分段元数据，不改变外部完整 verifier/旧恢复接口。待写/传输约束不能通过丢 chunk、将慢的有效 reader 判为 lost 或停止其他 session 达成。

固定校准基线采用旧颜色拒绝样本的 640 个 10 KiB 输出块为 1x，测 1x/2x/4x；缓存及页沿既有限额。校准进程额外 heap/RSS 初始观察预算分别 64/128 MiB，每档分页读取目标 30 秒；这些是本轮受控回归工程界限，不是实测结果、产品最大历史或对外 SLA。必须实际应用/校验数据，测量不得保留完整后缀污染结果；若超预算先保留失败并定位，不循环改阈值。十会话原门槛保持原样。

owned 信用等待 tracker 和 journal 完整 flush，后者包括已搬入 writeChain 的正文；失败请求停止并保留实际进程责任，不能提前 live=false。预算按整个校准进程计算（一个生产和一个回放 tracker），不扣除脚本或第二模型成本。后续针对实际分页分配与传输修产品，不因校准失败另扩工具；先保留段级完整校验与旧 reader 生命周期，不添加无预算跨页缓存。

## 结果与复盘

本轮完成两处可复现局部修复与原模块回归；F-04 仍未整体通过。固定校准额外 heap 为 74.70/89.20/93.92 MiB，RSS 为 147.66/181.57/196.78 MiB，全部超原预算；回放 1.334/2.715/5.903 秒，内容/revision/终态一致。结果与覆盖边界详见容量重评第 10.1 节。下一步仍属本计划第二/三个里程碑：减少实际分页整段分配、闭合普通 socket/Host 及旧生产者在途并验收，不先回到退出工具或宣布 B1 完成。

## 上下文与定向

业务代码位于 `extensions/vscode/dev-session-canvas/src/`：`supervisor/terminalSessionJournal.ts` 管理缓存/写入/校验，`supervisor/runtimeSupervisorMain.ts` 管理事件串行及 socket 订阅，`panel/CanvasPanelManager.ts` 和 Webview 管理消费。原回归为 `scripts/test/test-terminal-session-journal.mjs`、`scripts/test/test-terminal-paged-projection.mjs`、`scripts/test/test-runtime-paged-completion.mjs`。容量入口为 `scripts/diagnostics/audit-runtime-persistence-capacity.mjs`；浏览器基准位于 `tests/playwright/webview-harness.spec.mjs` 的 `10-agent live output capacity benchmark`。

## 工作计划

本计划只含三个可验证里程碑：真实调用链/预算及先红；直接产品修复与定向验证；相同负载容量和交互结果及总体缺口分账。它们不生成新的子阶段。checkpoint 先红直接禁止其校验构造全历史数组，原正确性回归须继续通过；socket/待写设计只沿已核对链路落实，不引入通用消息框架。

## 具体步骤

命令均在仓库根执行。先扩原 journal 测试并运行 `node scripts/test/test-terminal-session-journal.mjs` 取得基线失败，实施后重跑。容量新路径沿原入口增加明确选择参数，随后用 `node --expose-gc scripts/diagnostics/audit-runtime-persistence-capacity.mjs --paged-capacity` 运行固定负载；GC 仅用于测量隔离，并分别记录实际峰值，不用回收后数字替代峰值。

相关验证为 `node scripts/test/test-terminal-paged-projection.mjs`、`node scripts/test/test-runtime-checkpoint-refresh.mjs`、`node scripts/test/test-runtime-paged-completion.mjs`、`npm run typecheck`。浏览器使用 `npm run build` 后执行 `node scripts/test/run-playwright-webview.mjs --grep "10-agent live output capacity benchmark"`，不为方便连带重跑默认 native 协议大套件。没有默认授权新平台 runner、用户会话操作或发布。

## 验证与验收

保留原损坏、连续 revision、双代 fallback、读取/删除互斥断言。验证空间改进须有结构性无全量持有证据及固定增长负载，不只观察一次 RSS。校准/新旧基线/修后结果分别保存；输入、ACK、实际终端内容与公平性不能只看末尾 marker。不得把 no-PTY 实际模块测试当作实际 socket/Host/Webview 整链，也不得把浏览器 Agent 标签当真实 CLI。

## 幂等性与恢复

只用脚本创建的临时目录，不读取/迁移用户会话。旧文件格式、旧 live endpoint 和 checkpoint eligibility 不变。失败保留首报与可读来源，不删除原失败工件，不将重跑绿色覆盖首次失败；进程与文件只清理本轮明确拥有的资源。

## 证据与备注

输入 HEAD `8dd82629`，Linux x64 / Node v25.6.0。原始校准及入口失败位于 `.debug/runtime-persistence-capacity-20260928-wZfyUa/`，核心数值/输入/失败已记录在正式设计第 10.1 节。模块校准没有实际 socket/Host/UI/PTY；旧默认对照保持原样并通过，不能代证内存。owned、journal、checkpoint refresh、paged completion 与修正实例依赖后的 paged projection 回归、typecheck/build 通过；浏览器结果单独登记，不抹除原 harness 首次失败。

独立 review 的原始字节数漏洞以 `journal-review-red.log` 复现未拒绝，补 `segment.bytes` 比较后 `journal-review-green.log` 通过，最终 retained heap 为 100,216 bytes。该窄拒绝语义修正后没有重新采集容量以覆盖首次失败；失败仍是当前 B1 未闭合证据。`webview-10-agent.log` 记录原门槛 1/1 通过，纯浏览器注入场景不能代替真实 Agent、原生平台、packaged 或 Remote SSH 的最终 A1 至 A6。

## 接口与依赖

不新增依赖、运行模式、存储 generation、root 归属或用户配置。journal 的公开完整读取/旧恢复保持兼容，正常 checkpoint 内部改为受限摘要验证。生产背压必须落实到原 owner/消费回执，不能添加无限队列来绕过限额。

修订记录（2026-09-28）：从有限收尾 B1 开始，固定调用链、负载和校准界限，先登记设计再实施；保留真实产品整链缺口，不恢复诊断框架扩张。
