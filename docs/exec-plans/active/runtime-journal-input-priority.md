# 执行节点通信与分页诊断

本 ExecPlan 按 `docs/PLANS.md` 持续维护。目标是让用户在 SSH VS Code 中复现 Agent/Terminal 回显卡顿后，导出能区分消息桥等待、状态广播、journal 读取和 xterm 应用耗时的证据；本阶段不宣称卡顿已修复。

## 进度

- [x] 2026-10-25：从 origin/main@37ff8554 创建 PR #337 的独立工作区，完成初始调度候选分析。
- [x] 2026-10-25：分析用户提供的四组 Agent 样本，修正“revision 落后即 xterm 饱和”的过早归因。
- [x] 2026-10-25：用户同意补充定向诊断；更新设计为 120 秒手动采集、本地有界缓存和阶段关联。
- [x] 2026-10-25：实现采集命令、共享记录器、Host/Webview 消息与分页阶段计时、可选 Supervisor 读取耗时和导出。
- [x] 2026-10-25：定向自动化测试、RuntimeSupervisor 整链、类型检查与 VSIX 构建通过。
- [x] 2026-10-25：收口验证记录；随本次提交更新 PR #337 标题与描述。
- [ ] 用户安装新包，在同负载条件下复现并导出新诊断；据数据决定修复方案。

## 上下文与定向

工作区 `/tmp/dsc-journal-input-priority-design`，分支 `docs-journal-input-priority` 基于最新 origin/main，继续现有 PR #337；发布 PR #327 暂停合并。当前主工作区有用户未提交修改，保持隔离。运行时代码在 `extensions/vscode/dev-session-canvas/src/`。common/protocol.ts 定义 Webview 消息，panel/CanvasPanelManager.ts 收发消息、消费 batch、relay 分页并导出诊断，webview/main.tsx 接收 page 并交给 xterm，webview/terminalPagedProjection.ts 管理每 reader 单页在途，supervisor/runtimeSupervisorMain.ts 在 session 操作队列中读取 journal。诊断只观察这些边界。

## 里程碑与工作计划

第一阶段在 common/executionFlowDiagnostics.ts 实现固定阶段、120 个每秒窗口、每阶段 64 详情与 128 个 node/reason/messageType/stage 总计的记录器，使用可注入单调时钟测试冻结和有界行为。严格白名单字段防止终端正文进入 trace。

第二阶段接入新命令 startExecutionFlowTrace 和既有 dumpHostDiagnostics。Host 发 120 秒启动配置，Webview 本地记录；导出请求一次性收集快照，3 秒超时与未参与必须显式记录。采样消息每 surface 同时最多一个、每秒最多一次，失败或迟到回执不影响业务。既有生命周期身份检查须覆盖新增消息。

第三阶段沿输入、状态广播、page 请求/读取/应用增加阶段记录；read requestId 透传至 page 应用回调。Supervisor 可选 page diagnostics 只返回自身 queue/read/total 时长，旧进程返回缺失字段合法。不得更改 session 队列、journal 顺序、读页触发、revision 或应用 ACK。

第四阶段运行仓库根的 `npm run typecheck`、`node scripts/test/test-execution-flow-diagnostics.mjs`、`node scripts/test/test-terminal-paged-projection.mjs`、协议定向脚本和 `npm run build`。补能发现阶段关联丢失、越界、正文泄露、旧协议兼容或取消推进的回归。实际脚本与结果在本文件记录。

## 验证与验收

未启动时无新增 page 诊断字段、JSON 字节测量和采样回执。启动后不需要每条事件往返即可保留完整窗口聚合，详细环形记录淘汰不删除计数与耗时分布。导出 execution-flow-diagnostics.json 能按 requestId 连接 Webview request/receive/queue/apply 与 Host relay，同时看到 Supervisor queue/read 可用或缺失。输入 ACK 与 PTY write 明确分开；跨进程不相减 epoch。真实 SSH 验收由用户安装包后以单节点/双节点固定输出场景采集，当前不将自动化结果外推到现场卡顿消失。

## 意外与发现

双输出样本 ACK 最大约 13.9 秒，但 Host 接收至发 ACK 为 0–1 ms；12:18:26–32 有 116 个 stateUpdated 而无新 page 提交，后续大页是追赶。Host 收到的 applied revision ACK 会受传输影响。旧性能记录偏向小页，不能用其 0.5ms 最大值代替完整 page 写入耗时。以上证据改变诊断优先级，尚不足以确认唯一根因。

实现验证发现原协议测试直接由 Node 加载 TypeScript：新增运行时依赖必须使用显式 .ts 后缀，仓库 noEmit 配置启用 allowImportingTsExtensions；未修改测试的解析路径。部分 Host 测试提取实际方法、绕过构造函数，已补真实记录器初始化。隔离工作区使用主工作区已有 generated/execution-assets 构建，保持默认 platform 执行资源。

## 决策记录

- 2026-10-25：用户批准本阶段诊断实现，取代旧计划的“只写设计”限制；实际性能修复继续待诊断归因和设计确认。
- 2026-10-25：继续 PR #337 而非另建关联 PR；采用手动短时采集与本地聚合，避免逐事件 telemetry 加剧被测消息桥压力。
- 2026-10-25：可选 Supervisor timing 随原 page 返回，兼容旧 Supervisor，保留原 owned reader 对象/结算关系。

## 幂等性与恢复

再次启动替换旧采集；导出不清空本地记录，超时可重试。采集自动停止但保留结果；Webview 重建仅新实例可继续记录，旧实例缺失必须说明。回退该 PR 只移除观测，不改变任何终端历史或 reader 状态。

## 接口与依赖

只使用 TypeScript/Node/浏览器既有依赖；记录器接收 now 函数，快照返回白名单数值与 ID。新消息受协议校验和既有 lifecycle 约束，导出有界且不含正文。状态计时仅同步 handler，不能承诺 React commit 或像素 paint 完成。

## 本地验证记录

2026-10-25 在隔离工作区执行 `npm run typecheck`、`npm run test:execution-flow-diagnostics`、`npm run test:protocol-webview-messages`、`npm run test:extension-manifest` 与 `npm run test:ui-copy-localization` 均通过。分页验证包含实际 Webview controller 51/51、Host batch handling 10/10，以及真实 Supervisor socket/PTY 的可选读取耗时校验。首次协议整链运行在历史测试夹具缺少记录器处失败，补齐夹具后重新执行 `npm run test:runtime-supervisor-protocol` 全链通过，包含请求期限、旧会话重连、恢复订阅、模式切换竞争、实际 Supervisor 协议、checkpoint、分页投影、completed history、分页完成及输出 credit。

使用 `DEV_SESSION_CANVAS_EXECUTION_ASSETS_SET=/home/users/ziyang01.wang-al/projects/dev-session-canvas/generated/execution-assets npm run package:vsix` 完成正式 platform 资源的本地诊断包构建，产物为工作区根 `dev-session-canvas-0.26.0.vsix`。没有发布市场或执行真实 SSH UI 性能验收；这是当前分支诊断包，不是 0.26.1 发布物。

安装此包后，打开原问题画布，执行 `Dev Session Canvas: 开始执行链路诊断（120 秒）`，复现单节点/双节点输出与输入，再执行 `Dev Session Canvas: 落盘当前宿主诊断`。新增文件 `execution-flow-diagnostics.json` 中 Host 与至少一个 surface 应有同一 traceId；surface 若 timeout、not-participating 或 replacements 非零，先按正式设计的缺失语义判断，不把缺失当零耗时。

## 结果与复盘

诊断实现与定向验证已完成，已生成本地诊断 VSIX；PR #337 更新后供复现使用。根因与调度算法未选定，现场性能结论等待新采集，因此本调查计划继续保持 active。

修订说明：2026-10-25 根据实际日志和用户授权，将工作从调度器提案调整为定向通信/分页诊断实现。
