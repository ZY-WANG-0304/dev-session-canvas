# Runtime Persistence 第一阶段：checkpoint 独立刷新

本 ExecPlan 按 `docs/PLANS.md` 维护。它是 Runtime Persistence 改造的第一项可独立交付增量，不代表 F-04/F-05 整体完成。整体研究与故障边界见 `docs/design-docs/runtime-persistence-storage-reevaluation.md`。

## 目标与全局图景

Supervisor 是跨 Host 生命周期拥有终端进程的后台进程；checkpoint 是已验证可重建终端状态的快照，revision 是会话内按顺序增长的事件编号。目前 Host 即使已收到全部 live 事件，仍每 10-12 秒获取包含完整历史后缀的 snapshot。checkpoint 因颜色状态或大小被拒绝时，这些响应不断变大。本阶段让周期刷新只查询新的 checkpoint，不能推进时只返回身份与 revision，不重复传输完整后缀。

用户在 2026-09-17 要求开始改造，并已确认 Supervisor 崩溃或机器重启后不要求恢复进程与终端历史。此次保持 Supervisor 存活期间的内容、事件顺序、旧 live session 原绑定及正常 completed handoff；不通过放宽 checkpoint 校验来减少数据。权威终端状态同步、Host/Supervisor 全后缀内存、分页 attach 和 completed 独立存储仍在后续阶段，不能用本阶段的小响应宣称它们已经解决。

## 进度

- [x] (2026-09-17) 从最新 `origin/main@f2416795` 创建 `runtime-persistence-session-state-refactor`，带入四个审核提交，保留原审核分支。
- [x] (2026-09-17) 核对现有 checkpoint、Host 周期刷新和 completed 路径；确定先以独立协议增量降低 F-04 的反复传输成本。
- [x] (2026-09-17) 补齐正式设计与索引，实现 capability、RPC 和 Host checkpoint 合并；类型检查及 Host/纯合并行为测试通过。
- [x] (2026-09-17) 完成身份/顺序/并发尾部/拒绝 checkpoint 与旧协议回退测试，容量诊断和全部定向回归通过；真实 VS Code 的新查询/渲染/reload/completed 与旧 Supervisor 升级 smoke 通过。
- [x] (2026-09-17) 同步架构、产品和技术债的阶段结果，11 份文档、4 份设计 frontmatter/索引及新增引用检查通过，diff 无空白错误；归档本阶段计划。

## 意外与发现

Host 的周期调度在决定是否刷新前还会 normalize 整个 stream，复制并校验全部事件。本阶段需要一起移除该无条件扫描，保留真正替换 checkpoint 时的完整验证。Supervisor 已支持在生成 snapshot 时不构建 terminal projection，可以复用同一串行操作队列与校验/compact 逻辑，而不增加第二个状态 writer。

completed 外置不能单独更换文件目录：现有 handoff 同时提交窗口和 root-local 快照，跨窗口的引用/回收与失败顺序必须一起成立。因此先完成不改变存储格式的协议增量，再按整体设计规划外置；不新增没有回收契约的永久历史文件。

真实 smoke 的前两次准备过程被 `node_modules/.bin/dscanvas` 的既有失效链接阻断，尚未运行测试。执行 `npm prune --ignore-scripts --offline --no-audit --no-fund` 对齐生成依赖后，该孤立链接仍存在；核对 symlink 目标确实缺失后只删除该链接，未修改 lockfile。之后新查询 smoke、含旧 Supervisor 的组合 smoke，以及重新 build 后的新查询 smoke 全部通过，没有放宽业务断言。

## 决策记录

2026-09-17 / Codex：分批实施，首批交付 `terminalCheckpointRefreshV1`。新 Host 只对声明该 capability 的 Supervisor 发送 `getSessionCheckpoint`；旧 Supervisor 保留现有 snapshot 路线。原有 session、generation 和磁盘格式不迁移。

2026-09-17 / Codex：Host 的已接收连续 stream 是本阶段的尾部来源。收到 checkpoint 后验证 session/authority、revision 不倒退及尾部连续性，保留请求期间收到的事件；不能用响应中的较大 revision 无数据推进 Host。未推进或响应无效时保持当前 stream，不自动退回完整历史周期拉取。

## 结果与复盘

首批协议增量已实现并通过定向验证：拒绝 checkpoint 样本的刷新响应不再随后缀增长，新旧 Supervisor 路由、并发尾部、原会话重连与终端渲染保持。剩余 F-04 内存/首次恢复成本和 F-05 继续开放，已回写原技术债；本计划只覆盖协议增量，不替代新的终端状态模型验证，也不改变用户历史保留、root/runtime 归属或正常 handoff。

## 上下文与定向

`extensions/vscode/dev-session-canvas/src/supervisor/runtimeSupervisorMain.ts` 的 `createFreshSnapshot()` 校验 checkpoint 并在可靠条件下 compact，`buildTerminalStreamAttachPayload()` 收集全部后缀。`src/panel/CanvasPanelManager.ts` 的 `performExecutionTerminalProjectionRefresh()` 获取完整 snapshot 并合并请求期间的事件。`src/common/terminalSessionStream.ts` 定义 stream 和纯合并函数；`src/common/runtimeSupervisorProtocol.ts`、`src/panel/runtimeSupervisorClient.ts` 定义 socket 协议及 capability。

## 工作计划

### 里程碑一：独立 checkpoint 协议

增加 sessionId、authorityId、afterCheckpointRevision 参数和只含 revision/可选 checkpoint 的结果。服务端验证身份和合法水位，在 session 串行队列中执行原校验流程，但禁止构造完整 stream；只有严格新于请求水位时返回 checkpoint。hello 增加 capability，客户端增加对应查询能力。

### 里程碑二：Host 合并与兼容

健康 stream 的刷新优先走新 RPC；无新 checkpoint 时立即返回，不扫描已有 events。有新 checkpoint 时通过共享纯函数验证并保留从 checkpoint 到 Host 当前水位的连续尾部。session 被替换、authority 不符、checkpoint 超前/倒退或尾部有 gap 时拒绝替换。旧 Supervisor 保持原能力探测与 snapshot 合并，首次 attach 和 completed handoff 暂不改变。

### 里程碑三：容量和正确性验收

复用现有真实 Supervisor 协议测试与合成容量诊断。验证颜色副作用拒绝 checkpoint 后 1x/2x/3x 输出的查询响应不含 events 且大小基本固定；正常 checkpoint 推进后 Host 尾部内容/revision 一致；错 identity、非法水位与请求期间的新事件不会丢失。所有测试使用临时存储，不连接或清理用户会话。

## 具体步骤

从仓库根目录运行：

    npm run typecheck
    npm run test:terminal-session-journal
    npm run test:runtime-supervisor-protocol
    npm run test:execution-output-sequence
    npm run test:serialized-terminal-state-tracker
    node scripts/diagnostics/audit-runtime-persistence-capacity.mjs
    npm run build
    DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=runtime-checkpoint-refresh node scripts/smoke/run-vscode-smoke.mjs
    git diff --check

将新增纯合并测试加入现有定向测试入口或独立脚本，并记录命令。需要按已有 smoke 环境验证实际 Host 使用新查询；无法运行时必须记录缺口，不把纯函数测试称为端到端验收。

## 验证与验收

查询不会调用完整 stream 构建路径；未推进响应只携带身份和 revision，JSON 字节预算 1024 字节（测试使用正常 UUID），与日志累计量无关。推进时只携带现有已验证 checkpoint，仍受现有 256 Ki 字符 eligibility 限制；不声称整个运行时有界。保留错误处理、串行操作和无损交接。旧 capability 缺失时能够继续恢复原会话，不要求升级旧 Supervisor 或改写存储路径。

## 幂等性与恢复

不更改磁盘格式、生产存储位置或清理策略。新 RPC 只推进已有校验允许的 checkpoint；失败保留旧 stream。代码回退后旧 RPC 仍存在。测试创建独立临时目录并在结束后清理，不终止用户 Supervisor。

## 证据与备注

2026-09-17 本阶段实际通过：`npm run typecheck`、`npm run build`、`npm run build:notifier`、`test:runtime-supervisor-protocol`（包含新增 `test:runtime-checkpoint-refresh`）、`test:terminal-session-journal`、`test:serialized-terminal-state-tracker`、`test:execution-output-sequence`、`test:runtime-supervisor-paths`、`test:protocol-webview-messages` 和 `test:webview-build-xterm-entry`。新增 Host 测试提取实际方法执行，检查无变化路径不会访问 events；真实 socket/PTY 测试验证新 RPC 和 deferred subscription 的独立性，非法身份/水位不会破坏后续订阅。

容量诊断三阶段屏幕始终为 81840 字节，checkpoint revision 为 0；完整 snapshot 为 6763684/13526849/20290369 字节，checkpoint-only 为 98/99/99 字节（均为 JSON 结果体，不含 RPC 信封），且以抛错替身确认新查询未调用完整 projection builder。completed 最小画板的位置变更仍重写 20509666 字节，此项尚未修复。

真实 VS Code 验证使用 Linux + VS Code 1.117.0：`DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=runtime-checkpoint-refresh,legacy-supervisor-upgrade node scripts/smoke/run-vscode-smoke.mjs` 返回 code 0。新场景断言 Agent/Terminal 使用新查询、无显式 attach 时仍周期刷新、Host reload 后 session identity 不变、Webview 实际渲染 marker，以及正常 completed 保留 marker；旧 Supervisor baseline `5355e6a` 的升级场景同样通过。重新 build 后单独重跑新场景亦通过。日志位于 `.debug/runtime-checkpoint-refresh-smoke.log` 和 `.debug/runtime-checkpoint-refresh-final-smoke.log`。

未运行全量 `npm test`，未重跑 macOS/Windows/Remote SSH；不声称全平台或长期容量验收完成。文档语义、frontmatter/索引、新增引用及 diff 检查通过；仅本地提交，不推送分支或创建 MR。

## 接口与依赖

复用现有 xterm、journal、RPC 和测试构建工具，无新增生产依赖。新接口 `RuntimeSupervisorGetSessionCheckpointParams` / `RuntimeSupervisorSessionCheckpointResult` 与纯函数 `mergeTerminalStreamCheckpoint` 是 checkpoint 刷新的边界，不改变 Webview 消息和已保存节点格式。

修订记录：2026-09-17 创建并实施首个阶段计划，将用户的开始改造要求转成可回归、兼容旧 Supervisor 的协议增量；补充受控诊断、真实 Host/Webview 与旧 Supervisor 验证，后续存储/状态模型工作仍未完成。
