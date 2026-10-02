# 将 Runtime 退出收尾改为 Supervisor 分页读取

本 ExecPlan 按 `docs/PLANS.md` 维护。承接 `021ddd80` 的已结束无历史决策，在既有分支 `runtime-persistence-session-state-refactor` 完成下一批可独立验证的改造，不推送仍在迭代的整体分支。

## 目标与全局图景

Runtime 正常退出时，新协议不再从 Supervisor 聚合全部日志发送给 Host。已打开页面仍按原读取身份收齐最后输出，读完或关闭后删除临时来源；重新打开只见退出节点，无历史、无自动执行。Supervisor 就是现有 PTY 服务，不新建归档或第二个 server。旧客户端/旧 Supervisor 保留完整协议兼容。

## 进度

- [x] (2026-09-18) 核对当前规格、完成路径、分页游标与客户端退役逻辑；确认最终 snapshot 与 delete 都会生成完整 stream。
- [x] (2026-09-18) 记录局部协议与资源生命周期设计，不把它当作权威终端状态模型的整体替换。
- [x] (2026-09-18) 实现新 capability、退出轻量通知、读者保留及最终释放；新模式协议与实际 journal 回收定向测试通过。
- [x] (2026-09-18) 实现 Host 当前生命周期分页收尾、在途 open 处理和旧 generation 客户端保留；新旧路径及 6 项浏览器回归通过。
- [x] (2026-09-18) 协议/Host/浏览器及容量验证通过，真实宿主两轮 5 项通过，同时保留中间一轮 89969/90000 失败及观测缺口；补清理前现场。
- [x] (2026-09-18) 修复无 journal 旧记录的分页误报，实际恢复方法回归、typecheck/build、最终协议聚合与 6 项浏览器复测通过。
- [x] (2026-09-18) 同步正式文档与技术债，归档计划；仅本地提交，不推送仍在迭代的整体分支。

## 意外与发现

`finalizeSession()` 和 `deleteSession()` 均调用完整 `createFreshSnapshot()`，仅删 Host 聚合不能消除 Supervisor 分配。旧 `terminalPagedReadV1` 只承诺 live 分页，不能悄悄改变已连接旧 Host 的完成语义。Host 原来删除 session 后可以断开旧 generation 客户端，远程收尾后必须把尚存读者也算作使用者。

首次 read 是 Webview 已应用 checkpoint 的证明，但退出可以早于该请求，甚至早于 open 响应。新路径必须保留已经发起的当前生命周期 open，不能因未 ACK 就切回完整聚合；页面重建仍取消该身份。上一阶段 90000 行尾部短读尚无根因，不能因本轮修改完成传输就宣称修复。

初轮单测发现旧 Host fixture 未提供新增 capability/客户端退役 callback 所需方法，补齐 mock；新增中断状态机用例复用了先前已取消的 write callback，改为显式清理该测试队列。随后协议聚合通过，尚无这些失败指向生产行为的证据。

真实宿主首轮 5 项通过，但第二轮在第一项严格 90000 行用例失败，实际 xterm 只有 89969 行。诊断记录最后一页 `revision=headRevision=12654`，不能仅据此确认 Webview 已应用完整源正文。测试 finally 重置清理使消息环只剩无关 Agent 数据，现场保存在 `.debug/runtime-paged-completion-short-read-failure/`。补充清理前独立失败目录及首末行错误信息后，第三轮同样 5 项通过；既不弱化断言，也不将后续通过覆盖该失败。第二轮与协议测试有运行时间重叠，但没有证据证明负载就是原因。

收尾复核发现旧 registry 可包含没有 journal 的已结束记录。新模式 attach 只有具备 journal/checkpoint 且无读取错误时才承诺分页，否则保留旧 snapshot 回退；定向回归使用实际 `normalizeRecoveredSession()`，避免仅凭服务 capability 错报单个记录的读取能力。

## 决策记录

- 决策：通过新 capability 和显式 `paged-until-exit` 模式升级，旧 `paged` 保持既有终态。理由：同一服务可能同时有不同版本客户端。日期/作者：2026-09-18 / Codex。
- 决策：轻量状态保存成功后，以 `deleteSession` 的显式保留读者选项封闭新 attach/open，现有 socket/readId 继续读取；最后读者关闭或断连后物理删除。理由：无需转移完整日志，也不形成可重开的 completed 历史。日期/作者：2026-09-18 / Codex。
- 决策：本轮不改 PTY exit drain、journal 文件格式、root 归属或运行期权威状态模型。理由：尾部短读未定位，其余为独立决策；本轮直接消除新路径确定的全量终态分配。日期/作者：2026-09-18 / Codex。
- 决策：实现增量归档，但设计验证状态继续为“验证中”，尾部短读与 F-04 残余成本继续登记。理由：全量聚合消除有实际方法、协议和容量证据，不能据此宣称所有输出无损或全局内存有界。日期/作者：2026-09-18 / Codex。

## 结果与复盘

完成新协议退出分页、当前读者退役、Host 无全量临时来源和读者中断处理。无历史重开及运行中原进程重连语义不变；没有新增服务、归档或迁移 live 地址。实际方法故障注入证明新完成路径不调用完整聚合，双 socket 读完后 journal 文件实际删除。旧无 journal 记录保持 snapshot 回退。

协议、Host、6 项浏览器与容量定向验证通过。Linux 宿主首轮和补强观测后第三轮均为 5 项通过，中间第二轮失败为 89969/90000，未定位具体缺失层。归档的是本批实现，不是极端完整性或整个 F-04 的验收。完整旧协议、checkpoint 后总回放、在途队列、registry/open/compact 扫描与总 RSS 仍须另行验证；下一轮应优先补 PTY/bridge/journal/finalization 分层尾部证据。完整 npm 套件、packaged smoke、非 Linux、Remote SSH 和长期压力未跑。

## 上下文与定向

以下源码均在 `extensions/vscode/dev-session-canvas/src/`：`common/runtimeSupervisorProtocol.ts` 声明能力和 RPC，`supervisor/runtimeSupervisorMain.ts` 持有进程、journal、每 socket 的读取游标，`panel/runtimeSupervisorClient.ts` 协商能力。`panel/CanvasPanelManager.ts` 的 `applyCompletedRuntimeSupervisorSnapshot()` 先保存轻量节点，再退役 Supervisor 会话；`panel/runtimeTerminalReadRelay.ts` 只为旧协议临时保存完整 stream，新模式仅记录身份和 final revision。`webview/terminalPagedProjection.ts` 在 final revision 应用后关闭读取，正常路径不需要第二套状态机。退出读取中断须明确结束临时投影，不能静默当作完整或无限重试已失效身份。

## 工作计划

### 里程碑一：Supervisor 完成协议

增加退出分页能力，并在 create/attach/subscribe 选择新模式。仅旧订阅者要求完整终态时才构建完整来源；新模式的离线完成 attach 同样轻量。保存成功后的删除请求封闭发现和新读取，不删除现有读者依赖的 journal；最后读者 close、socket 断开或显式强制删除收敛物理清理。验证双读者、不读者、首个 read 前退出、慢读与旧订阅混用。

### 里程碑二：Host 当前视图收尾

relay 新模式只保存 final identity/revision，不复制日志。完成前已发起的 open 应先收敛，再提交保留读者的清理；只有原 Webview 生命周期可以收到其 descriptor 和终态通知。保存失败不删来源。旧 generation 客户端在读者及其 close RPC 收敛前不得退役。旧 capability 仍走上一阶段的完整临时来源。

### 里程碑三：验证与收口

在实际 Supervisor 协议验证自然退出、停止、两种执行节点、删除/关闭竞争和实际 journal 文件清理。Host 方法测试覆盖保存失败、在途 open、换代、无读者、无需全量来源；浏览器验证末页应用先于退出和失效读者终止。复跑真实 Linux VS Code 的无历史完成、live reload、旧 Supervisor 与真实窗口重开，记录容量样本和未跑矩阵。

## 具体步骤

仓库根已运行并通过 `npm run typecheck`、`npm run build`、`npm run test:runtime-supervisor-protocol`、`npm run test:protocol-webview-messages`、`npm run test:execution-output-sequence`、`npm run test:webview-lifecycle-diagnostics`，以及 `node --check tests/vscode-smoke/extension-tests.cjs`。协议聚合包含 `test-runtime-paged-completion.mjs`、Host completion、checkpoint 与分页状态机回归。最终无 journal 回退修正后的聚合日志为 `.debug/runtime-paged-completion-guard-protocol.log`。

`node scripts/test/run-playwright-webview.mjs --grep 'paged recovery|split ANSI OSC|thousands of contiguous journal'` 最终 6 项通过，见 `.debug/runtime-paged-completion-final-playwright.log`。`node scripts/diagnostics/audit-runtime-persistence-capacity.mjs` 通过，见 `.debug/runtime-paged-completion-final-capacity.log`；最小样本结束消息 405/407/407 字节，旧完整响应仍约 6.76/13.53/20.29 MB，不将此比例写成生产 RSS 改善。

Linux 真实宿主使用已构建 notifier，在根目录运行 `DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=runtime-completed-no-history,runtime-checkpoint-refresh,legacy-supervisor-upgrade,real-reopen,single-to-multi-root-real-reopen node scripts/smoke/run-vscode-smoke.mjs`。首轮 `.debug/runtime-paged-completion-smoke.log` 为 5 项通过；第二轮 `.debug/runtime-paged-completion-final-smoke.log` 第一项失败后停止；补清理前观测的第三轮 `.debug/runtime-paged-completion-diagnostic-smoke.log` 为 5 项通过。第三轮使用 `.bind` 修正后的 Host，构建早于最终无 journal 回退判断；该兼容判断随后由实际恢复方法回归、完整协议聚合、typecheck/build 和浏览器复测验证，没有把先前宿主运行冒称为该判断后的重复矩阵。

## 验证与验收

累计输出增长时，新模式终态不含完整 stream/serialized state，Host 不保留终态正文集合，分页内容仍严格连续并完整。旧模式终态完整。两个 socket 持有读者时，一个 Host 保存并释放 session 不会删除另一读者来源；新 attach/open 不得读取已退役正文。close/断连使最后来源实际删除，未 ACK 的现有读者可正常追赶，Host 保存失败来源保持可读。当前生命周期失效后不得发旧 descriptor/exit。重开无历史且不自动执行。

## 幂等性与恢复

沿用 capability 回退，无旧 live 地址迁移，无批量文件删除。显式清理只针对已确认 session/authority 与已存在读者。保存成功前保留原来源；保存失败可重试。测试在临时目录运行，不使用用户 provider 数据。

## 证据与备注

起点工作区干净，HEAD `021ddd80`。本地测试日志使用 `.debug/runtime-paged-completion-*`。已知 90000 行短读和未跑全平台/长期 RSS 风险保留，不以定向通过替代。

提交前 `git diff --check` 通过；YAML 解析校验 6 份设计 frontmatter、索引状态与日期，以及 12 份变更 Markdown 的本地引用通过。索引中既有的 `docs/exec-plans/completed/execution-node-zoom-interaction-research.md` 缺失引用保持不动，不混入本轮修复。

    runtime paged completion: no full aggregation, late first page, two sockets, retirement, disk cleanup and legacy compatibility passed
    terminal completed canvas: 781 bytes independent of output size; no history or automatic launch
    agent completed canvas: 812 bytes independent of output size; no history or automatic launch
    Playwright: 6 passed
    Linux VS Code: 首轮 5 项通过；第二轮 89969/90000 失败；第三轮 5 项通过

## 接口与依赖

不增加依赖或服务。新 capability `terminalPagedCompletionV1`；新模式 `terminalStreamMode: 'paged-until-exit'`；完成快照使用现有身份、revision 与 `terminalStreamPaged`，不携带恢复正文。`deleteSession` 新增 `preserveTerminalReads`，只允许非 live 会话，读者仍按原 socket/session/authority/readId 校验。

修订记录：2026-09-18 创建下一阶段计划，聚焦完成时全量聚合，不恢复已取消的 completed 历史需求。

修订记录：2026-09-18 实现退出分页和读者退役，补原样旧协议、新协议 PTY、双 socket、未 ACK、在途 open 与浏览器中断验证；真实宿主尚在运行。

修订记录：2026-09-18 归档实施与定向验证结果，补无 journal 旧记录回退、失败清理前现场和首末行观测；保留真实短读失败、未跑矩阵及 F-04 技术债，不宣称高负载无损已验证。
