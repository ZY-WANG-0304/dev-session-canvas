# 修复 Terminal 尺寸收敛与 Windows 交互回执 CI 失败

本 `ExecPlan` 是活文档。随着工作推进，持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘`。
本计划遵循仓库根目录 `docs/PLANS.md`。

## 目标与全局图景

修复 PR #362 中两个分离的问题：Linux `legacy-supervisor-upgrade` 中 Terminal 的 xterm fit 与 PTY 几何相差一列；Windows 原样安装门禁中新 Terminal 未能启动，原 owner 显示因 `Invalid terminal interaction result` 隔离。保留能证明 PTY 与 xterm 同步的严格断言，不以放宽断言或重试成功覆盖首次失败；Windows attempt 3 的确切输入回执仍未知，不把协议缺陷候选写成其已证实触发原因。

完成时，代码、测试、正式设计文档和本计划共同记录：单次 fit 的有界收敛策略、未知 input 写入回执的 fail-closed 语义、两类回归测试及验证结果；CI 后续重跑应使用当前 PR head 的有效冻结计划。

## 进度

- [x] (2026-11-04 Asia/Shanghai) 读取 `docs/WORKFLOW.md`、`docs/PLANS.md`、`docs/DESIGN.md`；确认工作区干净，`origin/main` 是当前主题分支祖先。
- [x] (2026-11-04 Asia/Shanghai) 获取 PR #362 / run `41692157078` attempt 3 的 Linux resize 与 Windows installed-pair 失败回执、日志、截图和运行时源码位置。
- [x] (2026-11-04 Asia/Shanghai) 在 Linux Webview 中临时记录 xterm fit 调用前后尺寸、cell 宽度、观察器与恢复状态；同一 84/85 mismatch 三次复现。
- [x] (2026-11-04 Asia/Shanghai) 做一次临时二次 fit 对照：仅在首轮 fit 后 proposal 与 xterm 实际尺寸仍不同时再 fit 一次，原 `legacy-supervisor-upgrade` smoke 通过；随后撤销所有临时实现和测试改动。
- [x] (2026-11-04 Asia/Shanghai) 核对 attempt 4 的具体 job 与日志：legacy Linux 重跑在冻结计划下载处失败，没有执行产品断言；Windows installed-pair 的 attempt 4 日志与 attempt 3 日志 SHA-256 相同，未获得新的 Windows 产品执行回执。
- [x] (2026-11-04 Asia/Shanghai) 完成 run `41692157078` attempt 5 的有效完整重跑：Linux `source-host/legacy-supervisor-upgrade` 再次以 84/85 列差异失败；Windows `installed-pair/win32-x64` 在相同不可变输入与环境下通过；`verify-result` 与 `Verify release contract` 因 Linux 任务失败而拒绝验收。
- [x] (2026-11-04 Asia/Shanghai) 对 Windows provider → channel → adapter 的回执规则做独立 Code Review；发现可触发同一 fault 的确定契约不一致，但缺少 attempt 3 原始 request/result，尚不能认定它就是本次触发分支。
- [x] (2026-11-04 Asia/Shanghai) 对 Windows provider core harness 临时注入 `pipes.write()` reject，观察到 provider 发出 `kind:'failed'` 且无 `writtenBytes`；临时代码已撤回。该 harness 使用 fake channel，证明 provider 输出但不等价于完整 adapter integration。
- [x] (2026-11-04 Asia/Shanghai) attempt 5 使用有效冻结计划在原 Windows x64 环境、相同 immutable input 上执行完整 installed-pair；第二个 Terminal、首屏 shell 输出、通知链均通过，未复现 owner fault。
- [x] (2026-11-04 Asia/Shanghai) 永久回归注入 Windows provider pipe write rejection，确认发出不带 `writtenBytes` 的 `unconfirmed`，adapter quarantine、结算原 interaction、取消未发送输入且不会重发。
- [x] (2026-11-04 Asia/Shanghai) 永久回归确认已发送 input 的超时/transport fault 不虚报 0 字节，同时保留精确迟到回执及已知部分计数。
- [x] (2026-11-04 Asia/Shanghai) subagent Code Review 指出 chunked input 的已确认前缀会被后续 unknown chunk 遮蔽；已调整 `writtenBytes` 语义为仅累计已确认前缀，并补 provider-unknown、timeout/late-result 与 transport-loss 回归；复审确认 P1 已解除。
- [x] (2026-11-04 Asia/Shanghai) 用显式旧尺寸夹具和单变量 follow-up-fit 对照 Linux；确认这不是新默认尺寸改动导致，也不是可安全删除的一列尺寸断言。
- [x] (2026-11-04 Asia/Shanghai) 通过同一不可变输入和环境的有效 Windows attempt 5 回执完成等价重跑核验；该次 installed-pair 全流程通过，故此次 Windows owner fault 未能稳定复现。
- [x] (2026-11-04 Asia/Shanghai) 汇总 Windows 根因置信度与修复/回归范围；attempt 3 的准确触发原因仍未知，已知协议缺陷作为独立确定缺陷修复。
- [x] (2026-11-04 Asia/Shanghai) 实现最多一次补偿 fit，每次 fit proposal 均保留快照恢复 shrink guard；报告最终 xterm 实际几何。
- [x] (2026-11-04 Asia/Shanghai) 将 Windows `pipes.write()` rejection 表达为不带伪造字节数的 `unconfirmed`；adapter quarantine owner、结算结果、不重发且不伪报 `writtenBytes: 0`。
- [x] (2026-11-04 Asia/Shanghai) 增补 xterm fit 收敛、Windows provider write rejection、adapter 未确认投递及 gate catalog 回归；保留现有 PTY / xterm 几何断言。
- [x] (2026-11-04 Asia/Shanghai) 更新正式设计文档与本计划；定向回归、legacy upgrade smoke、typecheck/build 和 gate contract 定向测试通过。
- [x] (2026-11-04 Asia/Shanghai) 独立 subagent 复审当前修复，未发现新的 blocker；确认 chunk-prefix P1 已解除。adapter 109、provider-channel 19、Windows provider core 7、fit convergence 4 项定向回归，以及 `test-ci-scope` / `test-gate-contracts` 130 项通过；`git diff --check` 通过。
- [ ] 将修复提交前再次核对并 rebase `origin/main`，推送 PR #362；用新 head 检查 Linux smoke、Windows installed-pair 和正式 Verify release contract。

## 意外与发现

- PR head 为 `8dcbbf0e43f69970976433590aa92b71b5433ed6`，基线为 `origin/main` `23418301f4e7496b9db5e4a89e34984b2ddd4b89`。正式 Release Preflight 的 attempt 3 有两个根失败：`Gate source-host (legacy-supervisor-upgrade)` 与 `Gate installed-pair (win32-x64)`；`verify-result` 和 `Verify release contract` 是验收不完整后的结果。较早 attempt 的 macOS runner 取消及选择性重跑缺少 attempt 专属产物属于另一类运行问题。
- Linux 失败快照显示 Agent 已对齐；Terminal 的节点/页面为 `700×540`、fit 为 `85×28`、页面和 Supervisor session 为 `84×28`，持续约 19.9 秒，投影 pending=false。测试在 `tests/vscode-smoke/legacy-supervisor-upgrade-tests.cjs` 的 `waitForGeometry` 阶段失败，精确几何条件在 `tests/vscode-smoke/terminal-resize.cjs`。测试夹具明确写入 `560×430` 初始尺寸并请求 `700×540`，所以当前证据不能把失败直接归因于默认尺寸 fallback 改动。
- Windows installed-pair 的首个 Terminal 已成功接收输入、完成 resize 和 Stop。第二个 Terminal 节点出现但未启动；截图中的诊断为 `Execution owner admission is closed: Invalid terminal interaction result`。`executionSessionAdapter.ts::receiveInteraction` 是唯一生成此 reason 的代码位置，并会 quarantine authority；目前失败工件没有保留触发隔离的原始 request/result 配对，尚不能定位具体错配种类或时序。
- 运行时 smoke 与实际安装包都使用固定 VS Code `1.142.0`；CI 环境 digest 为 `239dd870eb17af4d389554cd30adea65953c8065b3f6847ecda94bc8428f076d`。当前 artifact 位于本机 `/tmp/dsc-ci-review/`，正式记录应通过 CI 重跑新回执补足，而不是只引用本机临时路径。
- 本机命令 `DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=legacy-supervisor-upgrade npm run test:smoke` 失败在同一断言；失败样本仍为页面 84 cols、xterm `proposeDimensions()` 85 cols、Supervisor session 84 cols，28 rows 对齐。VS Code 日志中 runtime reload 结束期间出现的 supervisor disconnect 是本场景显式模拟 Host boundary 的收尾，不是 resize 首败；首败栈在 `terminal-resize.cjs:75` / `legacy-supervisor-upgrade-tests.cjs:252`。
- Linux 首次 fit 证据：节点从显式 `560×430` 调整为显式 `700×540` 后，Terminal parent 的 CSS 尺寸为 `654×420`、可用列宽为 `654-14=640`。首轮 `fitTerminal` 在 cell 宽 `7.5303030303px` 时提议并应用 84 列；`terminal.resize` 重新测量后 cell 宽变为 `7.5238095238px`，同一 640px 可容纳 85 列，probe 稳定报告 85，而 xterm 实际值与 PTY/Supervisor 仍为 84。各 fit guard 均为 false，投影 pending=false，20 秒中没有第二次 ResizeObserver fit。额外一次 fit 收敛后，本机同一场景通过。此为 fit/renderer 的迭代收敛问题，不是默认 footprint 改动。
- Linux 相关断言的必要性：要求原始同一 session 的 Supervisor 几何与 xterm 实际几何一致、要求 resize 后几何变化、要求节点外框达到显式目标，分别保护 PTY 同步、非空操作和节点写回，均应保留。`terminalCols === terminalFitCols` / rows 检查也捕捉了 20 秒稳定存在的一列未用容量；单变量二次 fit 能让同一断言通过，说明应修正 fit 收敛/调度而非删除断言或把容差放宽到一列。
- Windows 源码存在一个可触发相同 fault 的真实协议不一致：`windowsExecutionProvider.ts` 在 input `pipes.write()` 抛错时发 `kind:'failed'`，却省略 `writtenBytes`；`executionProviderChannel.ts` 允许该回执通过，而 `executionSessionAdapter.ts::receiveInteraction` 对所有 input 结果都要求 `writtenBytes` 已定义，并会以 `Invalid terminal interaction result` 隔离 owner。Linux provider 对失败 input 会返回已确认 offset。该 Windows 缺陷是强根因候选，不等于已证明 attempt 3 命中写入异常。
- Windows provider core harness 的临时失败注入复现其实际输出：pipe write reject 后的 provider observation 为 failed 且不带 writtenBytes；当前永久测试没有该场景，且 harness 用 fake channel，所以这只是 producer 侧确认，不是完整 channel/adapter 集成复现。原脚本未保留修改。
- Windows driver 在 `run-installed-pair.mjs:214` 只等待 `.xterm-rows` 非空；owner fault 后它最后报告 `Notification Terminal mounted first output timed out: " "`，没有并行捕获节点 error/owner fault 及 request/result 关联数据。现有截图已显示交互 owner fault，因此不是单纯“shell 慢”或文本断言过严。
- attempt 4 的唯一新 Linux job `126278890358` 在 `Download frozen plan` 找不到 `gate-transfer-plan-41692157078-4`，后续因 `gate-plan/gate-plan.json` 缺失退出，没有重跑 Linux 场景。Windows job `126278865281` 的日志 SHA-256 与 attempt 3 的 `126141149426` 完全相同，仍使用 `gate-transfer-plan-41692157078-3`，故不能算新 Windows 重跑。此前 attempt 4 不应记作“已复现 Windows”。
- attempt 5 是通过完整 `gh run rerun 41692157078` 发起，虽 CLI 请求返回 HTTP 502，Actions 已实际创建 attempt 5。新 resolve job `126288339441` 成功，`merge-control-41692157078-5` 与 `gate-transfer-plan-41692157078-5` 已生成。冻结输入仍为 `f7b3a22d7739bd50870a9765afb9f15c55e0717c`，PR head `8dcbbf0e43f69970976433590aa92b71b5433ed6`，base `23418301f4e7496b9db5e4a89e34984b2ddd4b89`；这次终于具备在同一不可变输入上运行 Windows/Linux 目标任务的有效计划。
- attempt 5 Windows installed-pair job `126291817071` 于 `2026-11-04T00:03:01Z` 开始、`00:05:12Z` 成功，回执 `installed-pair/win32-x64` 及 artifact `gate-installed-pair-win32-x64-41692157078-5` 均标注 attempt 5、输入 SHA 与环境 digest 与 attempt 3 相同。成功任务中首 Terminal 的输出、PTY 从 101×31 到 172×54 的 resize、Stop、第二个 Terminal 的 shell output、真实 notification 路径和清理均完成。故 Windows fault 在 attempt 3 的真实失败不可抹去，但相同输入/环境的有效后续执行通过，当前分类为间歇性、尚未稳定复现；failed-input 回执契约缺陷仍是未验证触发路径的候选。
- attempt 5 Linux source-host job `126292032145` 于 `2026-11-04T00:17:53Z` 失败，artifact `gate-source-host-legacy-supervisor-upgrade-41692157078-5`（ID `13282324829`）已生成。job 日志中 Terminal 为 Host/page/session `700×540`、page/session `84×28`、xterm fit proposal `85×28`、pending=false；Agent `82×26` 全部匹配。日志再次确认首个产品失败与本机 trace 相同，且 fixture 仍使用显式尺寸，不受新默认 footprint 影响。
- attempt 5 的 `Gate verify-result (default)` job `126298511311` 于 `00:22:28Z` 失败；输出有 `passed:355`、唯一 `failed` 项 `source-host/legacy-supervisor-upgrade/smoke/legacy-supervisor-upgrade`，producer job 状态 failure，并连带报告 fixture cleanup / Host exit 未确认。稳定 `Verify release contract` job `126300163383` 于 `00:23:13Z` 失败，直接原因是 `checkGitHubAcceptance` 在 `scripts/gates/check-acceptance.mjs:56` 检查真实 producer job 后得到 `failure` 而非 `success`。因此它是正确拒绝不完整验收的下游结果，不是本次 CI 工件 attempt 错配；当前 attempt 5 的日志确认 verifier 下载的是 `merge-control-41692157078-5`。
- attempt 5 共 270 个 jobs：267 成功、3 失败（Linux source-host、`verify-result`、稳定 `Verify release contract`），无未完成 job。相关入口：Linux [job 126292032145](https://github.com/ZY-WANG-0304/dev-session-canvas/actions/runs/41692157078/job/126292032145)、Windows [job 126291817071](https://github.com/ZY-WANG-0304/dev-session-canvas/actions/runs/41692157078/job/126291817071)、`verify-result` [job 126298511311](https://github.com/ZY-WANG-0304/dev-session-canvas/actions/runs/41692157078/job/126298511311)、稳定门禁 [job 126300163383](https://github.com/ZY-WANG-0304/dev-session-canvas/actions/runs/41692157078/job/126300163383)。

## 决策记录

- 决策：分别追查 Linux 的几何收敛失败与 Windows 的 owner quarantine，不先合并成一个“默认尺寸太大”的根因。
  理由：Linux 夹具请求显式旧尺寸，且只观察到稳定一列差异；Windows 则是交互协议 fault 后拒绝下一次 start。二者失败阶段、平台与直接证据不同。
  日期/作者：2026-11-04 / Codex。
- 决策：保留检查 PTY 实际几何与 xterm fit 一致性的现有断言，直到控制复现证明它本身不符合产品契约。
  理由：本机追踪证明首次 fit 后 cell 宽变化使稳定 proposal 从 84 变为 85，而实际 PTY/xterm 停留在 84；在不改断言的情况下追加一次 fit 即收敛并通过。测试捕获的是未完成 fit 收敛，而不是误判容差。应保留几何一致性门禁并修复收敛。
  日期/作者：2026-11-04 / Codex。
- 决策：诊断阶段不静默编辑产品行为；该阶段的临时观测代码均已撤销。本轮获准进入修复阶段后，在同一 PR 目标分支实现已证实的 Linux 收敛修复和 Windows 回执契约修复。
  理由：用户开始授权实现两个失败的修复方案；修复独立于首次 Windows failure 的未知因果归因，并由永久测试和正式文档覆盖。
  日期/作者：2026-11-04 / Codex。
- 决策：Linux 只在原始 fit 后追加一次“proposal 与实际尺寸仍不同才重试”的本地实验，不将该改动保留为修复。
  理由：它能验证首次尺寸测量变化是否造成一列差异；实验使原场景通过，但还没有覆盖字体加载、缩小尺寸、快照恢复及多次 resize 的完整回归范围。
  日期/作者：2026-11-04 / Codex。
- 决策：每次 `fitTerminal()` 最多调用两次 fit addon（首次 + 至多一次补偿），补偿 proposal 必须重新通过同一 shrink/restore guard；不无限循环追 proposal。
  理由：xterm 首次 resize 会重测 cell metric，受控二次 fit 已让 84/85 mismatch 收敛；有界重试避免 renderer 持续波动导致同步循环，并保留显式恢复期 shrink 抑制。
  日期/作者：2026-11-04 / Codex。
- 决策：Windows pipe input write rejection 是投递量未知，不伪造 `writtenBytes: 0`，以省略当前未知 chunk 字节数的 `unconfirmed` 回执表达；adapter 将其作为 fail-closed 结果，quarantine authority，保持不重发；如果此前 chunk 已被确认，只保留该精确前缀。
  理由：Node pipe write Promise rejection 不证明零字节被 PTY 接收；自动重发可能重复用户命令。`writtenBytes` 对 failed/cancelled/unconfirmed 表示已经确认的累计前缀，未知在途 chunk 不计入；没有已确认前缀时省略字段。
  日期/作者：2026-11-04 / Codex。
- 决策：attempt 3 Windows 首次故障的因果归因保持未定；修复 provider/adapter 间可直接证明的回执契约缺陷，不宣称该缺陷已经解释了那次运行。
  理由：attempt 5 同输入、同环境有效通过，且首次失败 artifact 未保留 interaction request/result；重跑成功不能复原首败细节。
  日期/作者：2026-11-04 / Codex。

## 结果与复盘

Linux 根因定位到 xterm fit 的单次调用不收敛：`terminal.resize(84, 28)` 使 cell 宽度重测，`proposeDimensions()` 随后变为 85×28；由于节点外框未继续变化，ResizeObserver 不再安排 fit。临时第二次 fit 的受控对照令原 smoke 通过。节点默认尺寸并未参与该失败，因为 legacy fixture 使用显式尺寸。attempt 5 在固定 Linux runner、相同冻结输入上再次观察到完全相同的 84/85 mismatch，说明不是本机或单次 runner 偶发现象；`verify-result` 和稳定门禁依设计拒绝此失败回执，没有发现另一个验收编排故障。

Windows 实际 owner fault 已由 attempt 3 截图确认，driver 的首屏输出等待只是报告点。attempt 5 使用同一 frozen input / environment 的完整 Windows installed-pair 通过，故当前只能定性为间歇性，不可把重跑成功当作首次失败不存在。源码中 Windows provider 丢失 failed-input 字节回执的契约不一致可触发同样的 adapter fault，是确定存在的协议缺陷；本地 producer 故障注入确认了缺失字段，但没有 attempt 3 的原始 interactionId/request/result，仍不能确认这次故障就是该分支触发。实现时将未知交付作为无计数的 `unconfirmed` 明确传递；adapter 应 fail closed、quarantine 且不重放，不声称零字节已写。若故障再次有效复现，应在失败现场加关联诊断再下最终根因结论。

## 上下文与定向

`extensions/vscode/dev-session-canvas/src/common/protocol.ts::estimatedCanvasNodeFootprint` 将 Agent 和 Terminal 的默认 footprint 从旧值改为 `760×560`。这会影响新节点模型与页面适配尺寸，不会自动改写已持久化的显式节点尺寸。

Linux 失败的链路是：真实旧代 Agent/Terminal 夹具 → Webview 调整节点 → xterm fit 计算行列 → Host 调整同一 Supervisor session → 测试等待两者一致。`terminal-resize.cjs::terminalMatchesContainer` 还核对渲染尺寸、session 身份及非 pending 状态，不能只看画布上的节点框。

Windows 失败的链路是：原样安装主扩展与 notifier → 公开 Explorer 命令创建 Terminal → Windows ConPTY provider 处理 input/resize → `executionSessionAdapter.ts::receiveInteraction` 校验回执 → `ExecutionAuthority.quarantine` 阻断后续执行。UI 的首屏等待是发现失败的位置，不必然是根因。

已有证据目录：`/tmp/dsc-ci-review/legacy-supervisor-upgrade/` 与 `/tmp/dsc-ci-review/installed-pair/win32-x64/`。本机当前是 Linux，不能直接把本地 Linux 复跑代替 Windows 实机结论。

## 工作计划

Linux 修复集中在 `src/webview/terminalFitConvergence.ts` 与 Agent/Terminal 共用的 `fitTerminal()` 调用点：单次最多两轮 proposal/fit，第二轮重新计算并执行 snapshot restore shrink guard，resize reporter 仍只提交实际 terminal 行列。helper 的受控测试证明补偿、guard、迭代上限和无 proposal 路径；真实旧 Supervisor smoke 验证 Host/PTy 与 xterm 最终几何一致。

Windows 修复集中在 `windowsExecutionProvider.ts`、`executionProviderChannel.ts` 的既有 parse/send 合同和 `executionSessionAdapter.ts::receiveInteraction()`。pipe input write reject 返回不带当前 chunk 字节数的 `unconfirmed`；adapter 将其传给调用者、不合成 0、quarantine authority、取消尚未发送操作、结算原输入观察且不自动重发。此前已经完整确认的 chunk 可以作为累计前缀保留；adapter 超时/transport fault 也不得把没有回执证明的在途 chunk 计入，合法迟到回执仍只更新原始 interaction。

将 regression 脚本登记到 `package.json` 与 `scripts/gates/catalog.mjs`，运行 fit helper、adapter、Windows provider core 定向测试、typecheck/build 和 Linux `legacy-supervisor-upgrade` smoke。基于最新 PR head 执行 Windows `installed-pair/win32-x64` 与完整正式门禁时，必须确认该 attempt 冻结计划与工件输入有效；CI 重跑通过不改变 attempt 3 的未知因果结论。

## 具体步骤

工作目录为仓库根目录。修复后的定向检查依次执行：

    npm run test:terminal-fit-convergence
    npm run test:execution-session-adapter
    npm run test:windows-execution-provider-core
    npm run typecheck
    npm run build
    DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=legacy-supervisor-upgrade npm run test:smoke

新增测试必须同时由 `scripts/gates/catalog.mjs` 纳入回归任务集合，避免只在本地存在。Linux smoke 的几何断言继续比较同一原始 session 的 PTY 行列、xterm 实际行列、最终 fit proposal 与 pending 状态，不改成 ±1 容差。

Windows provider core 测试注入 `pipes.write()` rejection，并检查唯一回执是省略字节数的 `unconfirmed`。adapter 测试检查无计数结果不会造成非法协议 fault、不会合成 `writtenBytes: 0`、会 quarantine authority、取消未发输入且不会再次发送原命令。Windows 产品级验收仍依赖真实 Windows runner，不以 fake channel/core harness 代替。

## 验证与验收

Linux 已在同一窄场景三次稳定复现。fit trace 显示页面 first fit 与 Host/Supervisor 同步到 84×28，之后 xterm 的稳定 proposal 变成 85×28；局部二次 fit 对照通过。这将首个 divergence 定位在 xterm cell metric 重测之后、下一次 fit 调用之前，且 Host 没有收到 85 列 resize。新增 fit helper 4/4 受控测试通过，`DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=legacy-supervisor-upgrade npm run test:smoke` 通过，日志为 `Legacy Supervisor upgrade smoke (5355e6a) passed`；本地 VS Code 为 1.119.0，正式 PR CI 固定版本 1.142.0 仍待验证。

Windows 已有 attempt 5 的同输入有效未复现回执：完整 `installed-pair/win32-x64` 通过。它满足重跑核验，但不能定位 attempt 3 缺失的原始交互回执。永久 provider 与 adapter 测试现在覆盖确定存在的未确认回执契约缺陷；真实 Windows 产品回归必须另由 Windows CI 验证。

最终交付应明确区分已证实根因、支持证据的假设、仍未知事项；保留首次失败，不以重试成功宣告问题不存在。合并前需记录最新 head 上 Linux smoke、Windows installed-pair、source build 与正式验收 contract 的真实结果。

## 幂等性与恢复

窄场景测试会启动 VS Code、Supervisor 和 PTY。复跑前确认前一轮子进程已经结束并为每轮使用独立临时目录；不得对实际用户进程执行 kill。远端重跑只使用更新后的 PR head，确认当前 attempt 下载自身计划与工件，不覆盖既有 artifact。诊断期临时观测代码已撤销；永久修复不得通过测试日志或 driver 特例改变产品语义。

## 证据与备注

Attempt 3 的初始证据位置与摘要见 Actions 工件：`gate-source-host-legacy-supervisor-upgrade-41692157078-3`、`installed-pair/win32-x64`。其 Windows driver 回执中的首败为 `Notification Terminal mounted first output timed out: " "`；同工件截图显示 owner 已以 `Invalid terminal interaction result` fault。Linux 本机三轮 trace 摘要与二次 fit 对照结果已写入本计划；此前诊断用临时观测改动已撤回。attempt 4 的 Windows job artifact/log 仍源于 attempt 3；attempt 4 新起的 Linux job 只在冻结计划缺失处失败。任何后续重跑都必须记录新 attempt 的 plan/candidate digest 与实际 task 回执，不把 attempt 3 证据拼进新回执。

## 接口与依赖

Linux 依赖仓库的 Node 22 工作区、固定 VS Code 下载器、真实 Webview probe 与 Supervisor fixture，入口为 `npm run test:smoke` 及 `tests/vscode-smoke/legacy-supervisor-upgrade-tests.cjs`。

Windows 依赖冻结 plan 中真实安装 pair、固定 VS Code `1.142.0`、Windows x64 runner、ConPTY provider 和 installed driver。使用 `scripts/smoke/run-installed-pair.mjs` 的公开 VS Code 命令/UI；不得启用产品 test command、替换包或改 manifest。

计划更新记录：2026-11-04 创建并补记 Linux 首次 fit 与 cell 宽度变化的 trace、二次 fit 单变量通过、assertion 必要性分析、attempt 4 无效重跑、Windows provider 回执契约候选、producer 侧 pipe-write reject 注入和 attempt 5 全部 CI 结果。随后进入修复阶段，添加有界 fit helper、未知 input 投递隔离、回归脚本与正式设计决策；本地 legacy smoke、adapter/provider/channel/fit 回归、typecheck/build 及定向 gate contracts 均通过。subagent review 中发现的一个确定前缀报告 blocker 已修复，复审确认解除。Windows attempt 3 的原始 request/result 仍缺失，不能写成已归因。

本轮补充：subagent 首轮 review 发现未知后续 chunk 会连已确认输入前缀一起丢弃；现已修复并增加 3 个 chunk-prefix regression（provider unknown、timeout + 原回执迟到、transport loss），adapter 109 cases、provider channel 19 cases 及 Windows core 7 cases 通过；subagent 复审确认 P1 已解除。最初 `npm run test:ci-gates` 中两个 scope-count case 仍期望旧任务数 359；纳入三项回归后将期望更新为 362，`test-ci-scope` 与 `test-gate-contracts` 定向组合 130/130 通过。仍待将修复推到 PR #362 并取得固定 runner 的 Linux/Windows 及最终 Verify release contract 回执。

2026-11-04 补充：重新核对旧 head `8dcbbf0e` 的 attempt 5 验收日志，Windows installed-pair 已成功；最终 `verify-result` 报告唯一业务任务失败为 `legacy-supervisor-upgrade`（进程退出码 1，Host fixture cleanup 未确认），因此 `Verify release contract` 的 assertion 是下游拒绝验收，不是第二个独立产品失败。原始 Linux artifact/快照已将业务失败定位为 resize 后 xterm proposal 85 列而 PTY/session 为 84 列；本地安装包 smoke 在 VS Code 1.119.0 上通过，但仍需新 PR head 的固定 1.142.0 CI 回执验证。
