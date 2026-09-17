# 取消 Runtime 已结束会话的历史持久化

本 ExecPlan 按仓库 `docs/PLANS.md` 维护。用户确认正常结束的节点重开无需进程或终端历史，正式设计为 `docs/design-docs/runtime-completed-no-history.md`。

## 目标与全局图景

Runtime Persistence 的 Agent/Terminal 在进程结束后只保存轻量节点信息，不再把终端 checkpoint 和事件日志内联画板。当前页面仍收齐最后输出；重新打开只看到已结束节点，不恢复旧进程、自动启动或历史。运行中会话的原进程重连、Supervisor 崩溃非目标、root/runtime 归属均不改变。

## 进度

- [x] (2026-09-17) 读取工作流与完成交接、分页 relay、metadata 归一化和既有测试，明确用户的新保留边界。
- [x] (2026-09-17) 记录正式设计、旧数据识别范围与本增量暂存来源的生命周期。
- [x] (2026-09-17) 实现轻量终态、当前页面临时收尾、消费完成释放和旧记录迁移；补保存期间禁止新读者及旧 live 同步覆盖的保护。
- [x] (2026-09-17) 新增实际 Host 方法测试和迁移/容量证据，协议/4 项 Playwright 通过；Linux Agent/Terminal live reload、完成重开、旧 Supervisor、真实关闭再开、单根转多根与逐行 90000 行通过。首次压力短读仍登记为残余风险。
- [x] (2026-09-18) 同步审核、规格、架构与债务，完成文档元数据和关联路径复核，归档本计划；随本轮实现本地提交，不推送或创建 MR。

## 意外与发现

当前 completed 同时承担两件事：给重开提供历史，以及给尚未消费完的 Webview 提供尾部。不能只删除 metadata 字段和 Supervisor journal，否则慢读者会丢最后一页。分页 relay 需要一个仅现有读者可用的临时来源，并在终态消费完成后显式释放。

`simulateRuntimeReloadForTest()` 不重建现有 Webview；第一次 smoke 把仍显示的当前 xterm 误当成恢复历史，修正为先关闭 editor 再重建。真实 reopen fixture 原来的 `sleep 2` 可在 Host 退出前完成并清空 setup marker，现改为等创建它的 Host PID 退出后再结束，确保覆盖离线终态。

第一次 90000 行样本 final page 已到 `revision=head=11628`，但尾部为第 89850 行和半个 marker；这与已登记的间歇性短读形态一致，未定位原因，不归因于缓存。原测试尝试拼接 test-only 200 条消息环会丢早期页；第二次只观察 viewport 又会被保留的滚动位置影响。最终用现有 `assertExecutionTerminalBuffer` 增加前缀过滤，在真实 xterm 中逐行验证全部 90000 行，再滚到底部检查末 marker。严格内容断言通过，不放宽行数。

轻量状态保存期间旧 session map 暂未释放，新页面 open、在途 open 和延迟 live-state flush 都可能仍看见它。现在以结束标记阻止新读者和 live 状态回写，并取消旧同步 timer；保存失败回滚节点且不删除原来源。

## 决策记录

- 决策：取消 Runtime completed 的历史持久化，保存节点和退出结果。理由：用户已明确重开不需要进程或历史，不继续为 F-05 设计独立归档。日期/作者：2026-09-17 / 用户、Codex。
- 决策：保留本次当前页面收尾，使用 relay 临时终态引用，不增加长期 Host 归档缓存。理由：不影响当前阅读完整性，且不能让重新打开复用旧内容。日期/作者：2026-09-17 / Codex。
- 决策：不改变直接 snapshot-only 模式，仅迁移可证明来自 Supervisor 的旧 completed stream。理由：用户讨论范围为 Runtime Persistence，旧 serialized-only 的来源不可推断。日期/作者：2026-09-17 / Codex。

## 结果与复盘

实现、定向验证和正式文档同步已完成。本增量满足 Runtime PTY 结束后只保存配置与退出结果、当前页面临时收齐尾部、重新打开无进程或历史的契约；不改变仍活着的会话重连，也不删除 provider 自身会话文件。已识别的旧 Supervisor completed stream 在加载时迁移，来源模糊的 serialized-only 记录保留兼容。

F-05 的新 completed 画板内联问题收口；完整终态消息及临时聚合仍属于 F-04，不以本次取消归档宣称全部容量问题解决。90000 行既有间歇性短读仍开放，首次失败与后续两次严格通过同时保留。相关残余风险已登记到 `docs/exec-plans/tech-debt-tracker.md`，正式设计保持“验证中”。本轮未运行完整 `npm test`、打包安装 smoke、非 Linux/Remote SSH 矩阵或长期 RSS 峰值压力；不能把本增量定向通过写成整体重构完成。

## 上下文与定向

`extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts` 的 `applyCompletedRuntimeSupervisorSnapshot()` 原先把完整 `terminalStream` 写到 metadata，再在 root-local/窗口保存成功后删除 Supervisor。`postExecutionSnapshot()` 与 `runtimeTerminalReadRelay.ts` 从 metadata 为未读完的页面续读。`webview/terminalPagedProjection.ts` 应用最后一页后显示退出，但原先未主动关闭读取。`common/protocol.ts` 定义节点 metadata；Host `normalizeMetadata()`/`normalizeNode()` 负责旧记录加载和 `reconcileAgentNodesInArray()` 负责自动恢复判定。

## 工作计划

### 里程碑一：轻量终态与兼容

新增结束记录的纯归一化 helper，只对显式标记或可信 Supervisor completed stream 清理历史。修改 Host 完成方法仅保存状态和退出结果。启动或重新附着 live 时清除结束标记。验证旧有运行中绑定和 snapshot-only 不变。

### 里程碑二：当前视图收尾

relay 为已确认读者接管暂时终态，消耗完或取消释放。未确认读者通过当前生命周期的一次最终快照结束，旧生命周期响应不能发给重开的页面。完成后新 attach 得到空白终态，不从暂存来源开新 reader。

### 里程碑三：证据与文档收口

更新已有完成历史测试为新产品契约，同时保留当前消费完整性断言。覆盖真实 PTY Agent/Terminal 的 live 恢复与完成重开、页面慢读、存储体积、旧 completed 迁移及旧 Supervisor。同步设计/规格/审核/债务，不推送仍在迭代中的整体重构。

## 具体步骤

全部命令在仓库根执行。已通过 `npm run typecheck`、`npm run build`、`npm run test:runtime-supervisor-protocol`、`npm run test:execution-output-sequence`、`npm run test:protocol-webview-messages`、`npm run test:webview-lifecycle-diagnostics`、`npm run test:canvas-multi-root-composition` 和 `npm run test:vscode-smoke-runner-env`。Supervisor 协议聚合命令包含 checkpoint、分页投影及新增的 `test:runtime-completed-history`，后者直接提取实际 Host 方法验证完成交接、保存失败、旧记录迁移、生命周期竞争与暂存尾部消费。

浏览器定向命令 `node scripts/test/run-playwright-webview.mjs --grep 'paged recovery|split ANSI OSC|thousands of contiguous journal'` 通过 4 项用例。Linux 真实宿主测试先执行 `npm run build:notifier`，再执行 `DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=runtime-completed-no-history,runtime-checkpoint-refresh,legacy-supervisor-upgrade,real-reopen,single-to-multi-root-real-reopen node scripts/smoke/run-vscode-smoke.mjs`，最终 5 个场景在同一轮通过。专用 `runtime-completed-no-history` 标记为仅定向运行，完整 trusted 场景已包含相同验收，不在默认套件重复执行。

容量命令为 `node scripts/diagnostics/audit-runtime-persistence-capacity.mjs`。文档使用 `yaml` 解析 frontmatter，检查索引状态、日期及关联规格/计划路径，最后执行 `git diff --check`。既有索引引用的完成计划 `execution-node-zoom-interaction-research.md` 在基线即缺失，不属于本任务，未顺带修复。

## 验证与验收

累计超缓存输出后退出，当前 Webview 仍含最终 marker，退出提示不提前；磁盘画板无输出、checkpoint、events，轻量保存不随正文体积增长。重新加载 Host/Webview 后节点仍 ended 且无正文/运行中身份/自动启动意图。失败保存不得删除原 Supervisor。已过时的 open/page/终态消息不能改变新页面，新运行会话不继承已结束标记。

## 幂等性与恢复

旧数据迁移只在读取已结束记录时剥离可确定的 Runtime 历史，不批量删除用户目录。重复加载结果一致，新数据不需要格式版本升级。保存失败回滚节点状态并保留来源。测试均使用临时数据；不修改用户 provider 文件或真实会话。

## 证据与备注

基线 `4983a281`，分支 `runtime-persistence-session-state-refactor`，开始时工作树干净。最终协议日志为 `.debug/runtime-completed-verified-protocol.log`；浏览器日志为 `.debug/runtime-completed-final-playwright.log`；5 场景真实宿主日志为 `.debug/runtime-completed-verified-smoke.log`；容量日志为 `.debug/runtime-completed-capacity.log`。

实际 Host completion + writer 测试的 Terminal 为 781 字节、Agent 为 812 字节，小输出与约 3.8 MB stream 体积相同。上一阶段约 19.66 MB output 的最小内联诊断容器保留为旧行为对照，写入及位置修改均为 20509666 字节；迁移后均为 505 字节。后者不是完整生产画板大小，也不能用于声明完整终态响应或 RSS 已有界。

第一次 90000 行失败日志为 `.debug/runtime-completed-90000-smoke.log`，现场为 `.debug/runtime-completed-90000-first-failure/`；第二次 viewport 观测问题现场为 `.debug/runtime-completed-90000-second-failure/`。修正观测后严格核对真实 xterm 的 90000 行内容，两轮通过，最终一次包括在 5 场景日志中。原 real-reopen 定时等待未保证 Host 已退出的现场保存在 `.debug/runtime-completed-real-reopen-first-failure/`。这些本地诊断文件不进入产品包或提交，用本计划保留结论、数值与重跑方式。

## 接口与依赖

不新增服务和依赖。metadata 增加无历史结束标记；relay 的暂存来源不属于协议或持久化数据。使用原 Supervisor 最终快照、当前页身份和 Webview 生命周期，不建立新归档格式。

修订记录：2026-09-17 根据用户新要求创建计划，显式替换正常 completed 归档决策，保留当前视图消费完整性。

修订记录：2026-09-17 完成实现、生命周期补强与定向回归；保留首次短读和两个测试观测问题，补真实关闭再开与实际 xterm 逐行证据。

修订记录：2026-09-18 补最终 5 场景回归、协议/浏览器与容量日志，同步正式文档后归档；明确 F-05 收口与 F-04、极端尾部短读及未跑矩阵的边界。
