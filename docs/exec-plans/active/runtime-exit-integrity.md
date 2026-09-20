# 交付跨平台执行会话退出完整性

本 ExecPlan 按 `docs/PLANS.md` 持续维护，覆盖设计、实施和验收。2026-09-20 用户确认“退出完整性”属于本次 Runtime Persistence 重构的独立交付项。立项基线为 `388ec2b3`，方案阶段基线为 `a5112fb5`；PR #294 合并后，13 个重构提交已 rebase 至 `origin/main@5965adb8`，当前阶段基线为 `28055e13`。本阶段只做设计与隔离诊断，不直接修改业务代码，不推送运行时分支。后续实施开始前必须先选定方案并更新正式设计，不把本计划视为私有 fd 补读或某种新 API 的授权。

## 目标与全局图景

用户在 Agent/Terminal 自然结束时，当前有效终端页面收到完整、按序的最后输出，即使程序返回非零退出码。保证从成功写入终端的数据开始，不包含程序自身尚未 flush 的应用缓冲，也不补造生产者未写出的 UTF-8/控制序列内容。进程退出、输出源结束和页面完成应用需要分别证明；不能把固定等待、socket close 或最终 revision 当作全部输出已交付。取消、强制中断与完整排空必须能被辨认，不用把正常结束全部降级为中断来掩盖缺失。

范围包含 Linux/macOS/Windows、Agent/Terminal，以及由 Supervisor 托管的 live-runtime 和直接由 Host 托管的 snapshot-only。结束后 Runtime 重开仍不恢复进程或历史，Supervisor/机器故障后仍无需恢复；F-03 root 归属、F-04 容量整体模型和 F-05 已取消的历史归档不在此项顺手改造。不必等待其他重构完成，但本项未通过验收前不得宣称本次重构的退出完整性已经完成。

## 进度

- [x] (2026-09-20) 用户确认独立交付范围，建立设计/规格入口并明确不在本次立项中修改业务代码。
- [x] (2026-09-20) 承接两轮诊断，记录 Linux 实证、Windows 条件性反例、macOS/Windows 原生证据缺口和公共契约依赖。
- [x] (2026-09-20) 同步产品规格第 10 节、架构审核、容量重评、技术债和索引；完成文档元数据、本地引用及业务零改动检查。
- [x] (2026-09-20) 第一轮方案验证：运行前冻结 Linux 两 reader、两运行时共 84 个样本；完整保留原 reader 反例，候选为 36 次完整读取和 6 次明确取消，不接入业务。
- [x] (2026-09-20) 补齐候选比较与共享收尾契约提案，核实 closeTerminalRead 缺少应用完成/取消区分，以及宿主 `^1.80.0` 支持范围约束；这些接口仍待实现验证。
- [x] (2026-09-20) 诊断工具加固后以相同参数完整回归 84 个样本，候选仍为 36 次完整读取和 6 次明确取消；共 168 个实际样本全部保留，增强验证器复核及实际 PGID 清理检查通过。
- [x] (2026-09-20) 独立 runner PR #294 已合并；保留 `backup/runtime-persistence-before-runner-rebase-7202298c` 并 rebase 正式重构分支，合并文档冲突时保留双方记录，业务代码与 rebase 前一致。
- [x] (2026-09-20) 承接三平台最小原生基线并完成 rebase 回归；Node 25/Electron-as-Node 39 各 39 项隔离契约、17 项实际 Supervisor 注入用例通过，不代替原生 reader 选型。
- [x] (2026-09-20) 独立 main-based 诊断分支完成三平台 147 样本首轮候选：Linux 门槛通过，macOS/Windows 各 6 个后代样本未达标，保留 run 35498026812 首次失败；未接入业务。
- [x] (2026-09-20) 修正 Windows 父 Node Job 自动杀子进程的夹具前提并加严存活/TTY 断言；run 35498732353 再执行 147 项，Windows 候选 18 次完整、3 次明确取消，macOS 六项失败保留。
- [ ] 冻结完成/取消/中断契约、旧版本能力边界、候选对照及原生平台矩阵，登记固定重复轮次和等待/资源预算。
- [ ] 补 macOS leader 存活控制组、原始 write errno/EOF 后观测，以及跨平台长驻资源证据，再选定实现与接口；Windows 候选已满足本轮门槛，不计为完整产品生命周期已验收。
- [ ] 实施源读取/排空边界及 Host/Supervisor 共用生命周期契约，保留旧 live 绑定与明确降级。
- [ ] 补自动化回归、真实 provider/VS Code、packaged 和资源回收验收；保留失败证据并收敛开放项。
- [ ] 同步最终文档与技术债，符合完整完成定义后归档计划；不能因 Linux 或局部夹具通过就勾选全平台完成。

## 意外与发现

原 bridge 对 node-pty onExit 的完整排空假设早于本次重构，bridge 和锁文件未由本轮容量改造改变。裸 PTY 不经兼容协议也能短读，故删除旧协议不会自动解决。Linux 的 HUP/partial read 可提前 EOF；另有 Unix 200 ms timer 和 Windows 默认 ConPTY 1000 ms 无 data destroy，不能合并为一个平台 bug。固定 libuv v1.52.1 包含一个相关修正，但未覆盖已核查的后续修正及 node-pty 强制关闭路径。

公共实际 Supervisor 夹具证明 exit 前已接受操作会收敛，exit 后新回调会被拒绝；它只刻画契约依赖，不证明每个平台自然发出 late data。macOS kqueue 映射与 slave close 顺序不同，源码共享不等于同因实测。原先本地原生运行环境只有 Linux；PR #294 已补托管三平台公共接口基线，但并未提供其他平台的候选 reader 或完整源结束证明。

首轮 Linux 候选实验把两类后果区分开：暂停消费时，原 reader 六轮在 writer 成功后缺尾；后代延迟写入时，原 reader 六轮提前关闭令写入失败。候选分别完整交付；保持 slave 的六轮明确取消，并不计为完整排空。自然零/非零退出本轮均完整，没有取得新的自然 HUP 旧失败/候选通过对照。现有 reader close 还将页面应用完成和取消合并，不能把释放来源当成已完成消费的证据。详见设计第 8–11 节。

runner 首轮 macOS 是 CRCRLF oracle 误报而非短读；Windows 是内容通过但进程资源 guard 失败，显式事后 fixture 清理后的成功不证明自然退出会自动释放资源。隔离契约对照进一步通过实际 `TerminalPagedProjection` 确认完成/取消发出相同旧 close；模型 final 注入实际 Supervisor 后可以保留 process-exit 之后的尾部，但没有实现可信 native EOF 或 local Host 接入。详见设计第 12–14 节。

新候选原生 run 35498026812 中，macOS 直接 read 0 仍不能实现当前后代保留假设；Windows builtin 暂停后文字完整但末尾光标少一行，DLL 原 worker 仍不自然退出。Windows 首轮后代属于父 Node 的 kill-on-close Job，不能将其门槛失败归为 reader 丢弃存活后代；Unix bash receipt 还混入失败输出。详见设计第 16 节，第二轮先修 Windows 夹具并加强存活/TTY 断言，macOS 仍需受控写入和 leader 控制组。

## 决策记录

- 决策：保留两个失败的原生 job，不扩大期限或改 held 断言使其变绿；下一阶段先缩小终端所有者边界，再决定 reader/launcher 方案。理由：单纯换 reader 没有满足跨平台后代契约，且“创建后代”和“后代实际持有可写终端”不是同一事实。日期/作者：2026-09-20 / Codex。
- 决策：下一阶段使用基于 `origin/main@5965adb8` 的独立 `runtime-exit-integrity-native-candidates` 工作树推送诊断输入，不推送尚未完成的运行时历史。Unix 沿用固定 7 案例各 3 轮，对 macOS 只扩展平台和终端换行 oracle；Windows 对照 builtin/DLL 公共 reader 与 DLL 独立 worker，在运行前冻结案例和预算。诊断分支自带设计/计划，业务代码不改。日期/作者：2026-09-20 / Codex。

- 决策：runner 合并后先回归原重构并验证隔离收尾模型，生产接口仍不变。理由：三平台小样本内容通过不等于可信 EOF；Windows 首轮资源失败进一步表明源完成、读者结算与 provider 资源回收应分别证明。日期/作者：2026-09-20 / Codex。

- 决策：首轮比较同一 native PTY 的原 reader 与独占 fd 的异步候选，固定 3 轮、7 案例和两运行时后再执行。理由：分别验证读取终止和强制关闭机制，避免 npm 升级被误认为能替换宿主 libuv；内部 native 接口只作隔离可行性实验。日期/作者：2026-09-20 / Codex。
- 决策：优先继续验证受控 provider/adapter 与共享最终事件，不在两条业务路径各写一份 native 竞态归并；消费者应用结果单独结算。理由：这能同时覆盖 Supervisor/local Host 的共同假设，并避免把 source complete 和 reader close 混为一谈。它是候选推荐，不是已选定的库、生产轮询实现或 wire API。日期/作者：2026-09-20 / Codex。
- 决策：将退出完整性作为本次重构独立交付项，不再仅作为将来可能顺带解决的技术债。理由：源完整性问题独立于缓存、分页和历史保留，正常结束当前页面的保证仍必须满足。日期/作者：2026-09-20 / 用户确认，Codex 记录。
- 决策：此阶段只选定交付契约，具体实现保持比较中。理由：上游升级、provider/adapter 和事件模型尚需跨平台证据，不把认可目标写成认可某种实现。日期/作者：2026-09-20 / Codex。
- 决策：区分命令失败与输出失败、自然排空与主动取消，旧会话仍保留原绑定。理由：非零退出同样可能有重要错误尾部；兼容不能补造旧 provider 未提供的完整性保证。日期/作者：2026-09-20 / Codex。

## 结果与复盘

当前已完成立项、Linux 隔离 reader 对照、三平台最小基线、rebase 回归和两运行时契约验证。两轮原生候选各 147 样本，共 294 项，保留所有首次失败；Windows 后代夹具修订后候选 18 次完整、3 次明确取消，补到原 builtin 末尾状态与原 worker 资源失败的真实对照。macOS 仍需原始 write、leader 存活/退出与 EOF 后持有 master 控制组。下一步先收敛该边界和原生资源预算，再冻结生产接口。业务未修改，设计比较中/验证中，本计划 active，里程碑一和技术债均未关闭。

## 上下文与定向

`extensions/vscode/dev-session-canvas/src/panel/executionSessionBridge.ts` 是 node-pty 接入边界，输出回调表示已交付的数据，进程退出通知不天然等于输出排空。`src/supervisor/runtimeSupervisorMain.ts` 的 `bindSessionProcess()` 与 `finalizeSession()` 将已接收事件按每会话串行队列执行；admission 表示是否继续接受新事件。`src/panel/CanvasPanelManager.ts` 还直接管理 snapshot-only 的 Agent/Terminal 退出，两条路径都要纳入设计。

`src/common/runtimeSupervisorProtocol.ts` 负责 Supervisor 与 Host 的契约，`src/common/protocol.ts` 是 Host 与 Webview 的共享消息。`src/panel/runtimeTerminalReadRelay.ts` 与 `src/webview/terminalPagedProjection.ts` 管理读者、连续分页和终态呈现。revision 是已接收事件的位置，不是源进程预期输出的字节数。若需要修改这些接口，必须同时验证消费者和旧协议。

平台 provider 的现状见安装的 `node_modules/node-pty/lib/unixTerminal.js`、`windowsPtyAgent.js`、`windowsTerminal.js` 和 native 源码。已有证据位于 `docs/design-docs/runtime-terminal-tail-diagnosis.md`、`docs/design-docs/runtime-terminal-cross-platform-diagnosis.md`；固定版本来源已在文档摘录，不要求接手者依赖本机 `.debug/` 才理解问题。不能直接编辑 node_modules 作为生产修复。

## 工作计划

### 里程碑一：选定可验证的契约与实现

先在 `docs/design-docs/runtime-exit-integrity.md` 明确 native process exit、真正源输出结束、消费者应用完成、结束原因和取消策略，比较 adapter 聚合最终事件与上层显式事件两种路线。列出现有上游修正是否进入实际 VS Code/Electron、是否仍有 Unix/Windows timer，以及自维护实现的 native 打包和平台成本；没有证据前不指定库版本或新增字段。

建立 Linux/macOS/Windows 原生 runner 和版本清单，Remote SSH 按实际执行端平台记录；冻结重复次数、并发负载、退出等待与事件循环预算、失败工件目录及首次失败保留规则。原生环境不足时可以继续局部候选实验，但不能关闭本里程碑或宣称未测平台健康。候选验证应在隔离构建中进行，不接入真实用户会话，不能把故障注入统计当成自然发生率。退出条件是正式设计选定实现、精确模块/API 和各平台失败语义，已复现缺陷路径有旧实现失败/候选通过的直接对照；尚未复现或作为对照的路径按冻结矩阵验证并保留未复现结论，不要求人为制造旧版本失败。

### 里程碑二：实施共享源边界和生命周期

方案选定后再按设计更改 `executionSessionBridge.ts` 及所需 provider 适配，补可信排空或明确中断信息，处理 Unicode/ANSI 尾片、背压、输出仍由后代持有及取消，不阻塞输入回路。随后分别接入 Supervisor 与 Host local finalize；按需要更新共同协议、relay 和 Webview 收尾，使源完成与消费者完成对齐，不提前销毁仍有效读者来源。具体改动文件以里程碑一批准的设计为准，不预设每个模块都必须改。

新会话获得新的已验证契约，旧会话沿用原 backend/storage/session/generation。设计明确 capability/version 和旧客户端降级，不能强制迁移/重启 live 进程或给旧版本补造能力。每批变更独立回归，避免混入容量模型替换、completed 归档或 root 归属。退出条件是两种模式、两类节点的代码路径都接通且定向自动化覆盖，不是只通过 Linux reader 实验。

### 里程碑三：原生端到端验收与关闭

运行设计第 5 节矩阵：自然零/非零退出、严格 90000 行、慢消费、UTF-8/ANSI 分片、后代持有输出、停止/强制停止、删除、多读者/生命周期变化、新旧版本共存、资源回收和重开无历史。保留程序写入凭证，逐层核对 raw、bridge、journal 或状态、分页与实际 xterm；Windows VT 转换按终端语义对照，不强求 POSIX 原始字节相等。

在原生 Linux/macOS/Windows、实际 Node 与 VS Code/Electron 上分别记录结果，fake-provider 与真实 Agent provider 分开。完整运行相关自动化和 packaged smoke，失败不能靠放宽 90000 行断言、增长等待、重跑到成功或把退出改为“未知”收口。剩余问题需明确修复或经用户确认的范围调整；不能把“环境不具备”写成通过。全部达标后再更新设计状态和技术债、归档本计划。

## 具体步骤

最新原生候选在独立 `runtime-exit-integrity-native-candidates` 工作树执行，不要求把当前运行时历史推到 GitHub。首轮输入 `afb24974`，修订 Windows Job 夹具的第二轮输入 `4ac3ad15`；复核入口为该分支 `compare-runtime-exit-readers.mjs --verify-saved DIR` 和 `compare-windows-exit-readers.mjs --verify-saved DIR`。Unix 验证器遇已保存的候选失败会非零，另对完整 schedule/全部 raw 哈希核对，不能跳过其余工件。第一轮下载目录在独立工作树 `.debug/github-candidates-35498026812-{ubuntu,macos,windows}/`，不要覆盖。后续 macOS 原始 write 与 leader 对照先冻结新实验，不改既有首轮判定；Windows 必须先证明真实后代在主进程回调时存活且 stdout 为 TTY。

runner 合入后的本轮先运行 `npm run typecheck`、`npm run test:execution-session-bridge`、`npm run test:terminal-session-journal` 和 `npm run test:runtime-supervisor-protocol`。新增 `scripts/diagnostics/runtime-exit-contract-model.mjs` 与 `scripts/diagnostics/diagnose-runtime-exit-contract.mjs`，只运行内存模型与实际分页投影类，不创建 PTY 或修改业务模块。运行前固定源事件排列、重复/违约、UTF-8 解码尾片、stop/取消/读取错误/旧能力、读者身份/最终位置/在途 open/双读者结算及实际投影完成/取消对照；每个确定性用例执行一次，不以反复随机运行筛选成功。`--output` 必须是新目录，保存每项结果、断言错误、脚本/实际投影哈希与运行环境。模型不引入生产超时，资源/等待预算仍由平台候选阶段选定。

    node --check scripts/diagnostics/runtime-exit-contract-model.mjs
    node --check scripts/diagnostics/diagnose-runtime-exit-contract.mjs
    node scripts/diagnostics/diagnose-runtime-exit-contract.mjs --output .debug/exit-contract-v1-node25

同组确定性测试也用缓存 VS Code 1.117.0 的 `ELECTRON_RUN_AS_NODE=1` 执行，输出改为 `.debug/exit-contract-v1-electron39`。两个目录均已使用，后续须换新名。`diagnose-runtime-exit-admission.mjs` 保留 11 项旧特征，追加 Agent/Terminal 各 3 个源模型 final 注入实际 Supervisor 的用例，不更改运行时文件。分别运行普通 Node 和 Electron-as-Node，将完整 JSON 输出保存到新的 `.debug/exit-admission-contract-*.json`；本轮两个 v1 文件已存在，不能覆盖。真实 Supervisor 类在隔离内存构建中使用 fake process，仍不是原生 provider 或完整 Host 集成。

现有原生入口 `scripts/diagnostics/diagnose-native-pty-exit-integrity.mjs` 及托管 workflow 按已合并设计保持不变，不在本轮把基线门槛改成候选验收。

本阶段新增工具从仓库根运行，固定 7 个案例、每 reader 每案例 3 轮，不提供调小轮次的选项。输出目录必须不存在，包含 raw、每轮退出轨迹、writer receipt、总表和环境指纹。候选未达预期则进程返回非零，原 reader 的反例仍保留；候选 held 场景通过表示明确取消，不是排空成功。

    node --check scripts/diagnostics/compare-runtime-exit-readers.mjs
    node scripts/diagnostics/compare-runtime-exit-readers.mjs --self-test
    node scripts/diagnostics/compare-runtime-exit-readers.mjs --output .debug/exit-integrity-reader-v1-node25
    env ELECTRON_RUN_AS_NODE=1 .vscode-test/vscode-linux-x64-1.117.0/code scripts/diagnostics/compare-runtime-exit-readers.mjs --output .debug/exit-integrity-reader-v1-electron39
    node scripts/diagnostics/compare-runtime-exit-readers.mjs --verify-saved .debug/exit-integrity-reader-v1-node25
    node scripts/diagnostics/compare-runtime-exit-readers.mjs --verify-saved .debug/exit-integrity-reader-v1-electron39

上述 v1 目录已用于首轮，重跑应更换目录名。诊断加固后的回归使用相同命令和参数，目录改为 v2；不覆盖或删除 v1 的失败。`--verify-saved` 只重新核对已有内容/哈希和候选门槛，不创建 PTY、不生成新的平台实测证据。样本在 30 s 发起清理，32 s 独立硬截止保存未完成工件并退出；这是测试防挂起，不是产品 drain 期限。工具只允许 Linux，尚不能在其他平台运行并宣称完成原生验收。

当前可从仓库根复核既有特征诊断，依赖已安装，命令如下。它们含预期缺失反例，exit 0 不是产品完整性通过。Linux 工具 output 必须是新目录；Windows JS 脚本在 Linux 执行也不等于原生 ConPTY。

    node scripts/diagnostics/diagnose-runtime-terminal-tail.mjs --self-test
    node scripts/diagnostics/diagnose-runtime-terminal-tail.mjs --mode bare --runs 3 --pause-near-exit-ms 350 --writer-receipt --probe-before-destroy --output .debug/exit-integrity-baseline-unique
    node scripts/diagnostics/diagnose-windows-pty-exit-contract.mjs
    node scripts/diagnostics/diagnose-runtime-exit-admission.mjs

后续 baseline/候选各使用独立目录，记录版本、提交、启动命令、环境和首次失败。在里程碑一将原生启动命令、冻结的轮次和预算回写本节。实施后至少运行以下现有回归入口；新 reader/契约原生测试须随所选实现另行加入，不把这些已有脚本当成充分矩阵。

    npm run typecheck
    npm run test:execution-session-bridge
    npm run test:runtime-supervisor-protocol
    npm run test:terminal-session-journal
    npm run test:smoke
    npm run test:webview
    npm run test:vsix-smoke

全量套件如有已登记的基线阻断，保留首错并解释隔离验证覆盖和残余缺口，不伪称全量通过。任何 native 或发布依赖调整都在方案中明确，不能顺手升级整个工具链。

## 验证与验收

交付以 `docs/design-docs/runtime-exit-integrity.md` 第 5 节和规格第 10 节为准。需要证明正常自然退出内容完整，并证明取消/强制截断不会冒充正常排空。原生平台表每格均有可复核证据和明确结果，未执行即未完成。当前方案阶段验证独立诊断及 YAML/索引/本地引用、git diff 范围和计划状态；相对 `a5112fb5`，只允许诊断和文档变化，不把它们冒充 Host/Webview 或业务修复验收。

## 幂等性与恢复

候选试验不得修改用户 storage 或替换仍承载 live 会话的 Supervisor；仅控制本次创建的 fixture。证据目录唯一，不覆盖初次失败。生产方案需要可回滚的 capability/adapter 选择和旧 session 原绑定保留，回滚不得伪造完整性或强制迁移。取消和回收必须幂等，不因重试重复输出、重复终态或误删其他读者。

## 证据与备注

2026-09-20 原生候选阶段：main-based 独立分支两轮各 147 项，本地 Linux 另 42 项。全部六份远端工件下载并核对 schedule/raw 哈希，Windows 两轮各 63 项内容/光标离线复算分别保留 6/0 个候选失败；第二轮 builtin 成功写入但已关闭 reader 的后代反例已确认。文档元数据/索引/related paths、workflow 权限/分支范围与 whitespace 检查通过。主重构分支本阶段只有文档变化，业务与旧 live 绑定不改；未执行全量 UI、真实 provider、packaged 或新增业务集成测试。两份相关计划均保持 active，下一步 macOS 控制实验，不将 run 失败隐藏为全部通过。

已有自然样本在 EOF 后可补读 313/2235/251 字节而恢复全部 90000 行；另一机制在 Unix timer destroy 时同时保有 JS 和 fd 数据。Windows JS/真实 TCP reader 与公共 Supervisor 夹具只说明条件性行为；没有 macOS/Windows 原生修复证据。完整记录在两轮诊断文档，不在本次立项中重复将它们标为验收通过。

2026-09-20 立项检查：本次 8 份文档中的 3 份设计 frontmatter 使用 YAML parser 校验，标题、架构域/层、状态、日期及索引一致；新增本地引用均可解析，计划中的 npm 命令均存在。规格保持草案，独立范围已确认；计划保持 active，5 项选型/实施/验收任务未勾选。`git diff --check` 通过，相对 `388ec2b3` 的 `extensions`、`scripts`、`tests` 和 package 文件无改动。本次未运行运行时测试，不将文档校验视为缺陷修复证据。

2026-09-20 方案阶段检查：新增诊断在 Node 25 与 Electron-as-Node 39 的首轮和加固回归中各执行完整 42 项，共 168 项；候选 72 次完整、12 次明确取消。原 reader 12 次成功写入后缺尾与 12 次后代写入失败分别留存，未重新归因为全部 HUP。脚本语法、自校验、四组保存结果复核及实际 PGID 无残留检查通过。未运行实际 Host/Webview、真实 Agent、packaged 或其他 OS；不声称运行时回归或原生平台矩阵通过。

本阶段 6 个文件仅包含 5 份文档与 1 个独立诊断；设计 YAML/索引、架构标签、本地引用和 `git diff --check` 已校验。相对 `a5112fb5` 的 `extensions`、现有 `tests`、package/lockfile 无变化；计划仍 active，5 项生产选型、原生验证、实施与交付收口任务保持未完成。

2026-09-20 runner 合并后的验证：`typecheck`、`build`、bridge、journal 和 Supervisor 聚合回归全部通过；聚合包含 checkpoint refresh、分页投影、无 completed 历史和退出分页。Node 25.6.0 与 Electron-as-Node 39.8.7 各 39 项契约模型、17 项实际 Supervisor 注入通过，输出目录/哈希及局限见设计第 14 节。没有运行全量 UI、真实 provider、packaged 或新的原生候选矩阵；相对 `28055e13` 不修改业务、既有测试、依赖或 workflow。

## 接口与依赖

本次不新增业务类型、协议字段、依赖或业务模块；独立诊断直接加载现有 native fork，仅用于创建全新 fixture。契约提案要求 provider 分开 process result/source end，共享 adapter 只发一次最终事件，并区分各读者 applied/cancelled/lost。具体命名、扩展 close receipt 还是独立 ACK、native 构建路径与旧版本能力协商仍未选定。里程碑一结束必须把精确类型/签名、文件和失败语义回写本节及正式设计；不能仅凭本轮 Linux 异步 read 通过直接成为生产默认路径。

修订记录：2026-09-20 根据用户确认建立独立交付计划；范围与验收已登记，方案选择、业务实施和原生平台验收仍待推进。

修订记录：2026-09-20 进入方案阶段，新增冻结的候选对照、运行证据、三事实收尾契约提案与平台/宿主缺口；保留所有首轮失败并加固诊断，不将 Linux 可行性扩大为全平台方案已选定。

修订记录：2026-09-20 runner PR #294 合入后回到正式重构分支，记录 rebase 基线、三平台证据承接及隔离契约验证范围；本轮不修改业务 reader、wire API 或运行时归属。

修订记录：2026-09-20 完成 rebase 回归和两种运行时的隔离契约/实际 Supervisor 注入验证，记录旧 close 的实测歧义与候选收尾结果；下一步仍为跨平台 reader/资源候选选型，不把模型成功计为生产集成。
