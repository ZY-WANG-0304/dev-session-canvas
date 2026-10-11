# 定位双窗口删除 Agent 后原窗口终态未收口

本 ExecPlan 按 `docs/PLANS.md` 持续维护。用户已取消 0.26.1 发布准备；本任务只定位原因并交付可复查证据和修复建议，不实现产品修复。

## 目标与全局图景

两个 VS Code 窗口共享同一 live-runtime Agent，一个窗口删除后，原窗口应将其保留节点变为 stopped、snapshot-only、history-restored，清除 runtimeSessionId 和 liveSession。调查需说明 Supervisor（独立托管会话的进程）是否真正删除、其他 Host（窗口中的扩展宿主）是否收到终态，以及何处遗漏收口。成功结果是有受控验证支持的因果定位，而不是弱化终态断言。

## 进度

- [x] (2026-10-11) 终止发布准备、关闭 PR #317，从最新 origin/main 创建独立调查分支，保留 image.png。
- [x] (2026-10-11) 保留既有失败输入；原 Supervisor registry 空、owner Host Agent 绑定仍 live。
- [x] (2026-10-11) 追踪删除、终态通知、reader 和 Host 收口代码，确认非保留式删除取消所有 socket 的 Host 消费信用订阅。
- [x] (2026-10-11) 当前 main 的真实 Supervisor 受控 8 项通过；另一 socket 保留通道的诊断干预恢复终态。
- [x] (2026-10-11) 同步设计文档、索引、核心信念和技术债，归档调查计划。

## 意外与发现

受控实验中 Agent/Terminal direct-credit 均为 0 个终态事件；direct-paged、stopped-preserving-credit 和仅保留另一 socket 通道的干预均为 1 个，删除与移除均完成。代码引入点为 52ff49bc，未做历史版本端到端二分。

旧失败在产品源码与 main 相同的发布准备分支上发生，但夹具含独立修正，不能直接视为新分支验证。owner 工件中的 legacy-detached registry sessions=[]，bindings 仍有 Agent d5267588-5369-445a-b7e0-e6f61001d1ab，pendingRuntimeSupervisorOperationCount=0。

## 决策记录

2026-10-11 / Codex：只调查用户指定问题；不带入版本或发布物料。先沿现有失败证据追踪，再选择最小实验。重新跑真实窗口时必须使用独立短 debug 路径并串行等待 Agent 启动后创建 Terminal，避免固定 namespace 和启动容量混淆。

## 结果与复盘

调查完成：删除先取消其他窗口唯一终态通道，随后会话停止并移除而原窗口保持 live 投影。交付可重复的 8 项诊断脚本和正式结论；产品修复未实施，真实新窗口/跨平台验收待后续修复任务。

## 上下文与定向

`extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts` 持有窗口节点状态并处理删除和终态。`panel/runtimeSupervisorClient.ts` 通过 socket 请求共享 Supervisor；`supervisor/runtimeSupervisorMain.ts` 删除会话、发送事件。`panel/runtimeTerminalReadRelay.ts` 读取按 revision（递增序号）组织的终端页面并结算读者。`tests/vscode-smoke/two-window-shared-runtime-tests.cjs` 的 attacher 删除 Agent，owner 等待完整终态。旧证据在 `.debug/release-0-26-1-latest-main-e6b9f39c/two-window-owner/` 和 `/tmp/d26lrest3/two-window-shared-runtime/owner/artifacts/`；这些未提交文件只作调查输入，关键摘录应写入正式文档。

## 工作计划

第一里程碑比较 attacher 删除成功与 owner 的注册表、节点和通知，定位可能遗漏的分支。第二里程碑在当前 main 产品逻辑上构建最小受控实验，优先利用既有 Supervisor/Host 测试基础设施验证删除后的事件时序；若仍不足，运行隔离双窗口 smoke。第三里程碑在 `docs/design-docs/runtime-two-window-agent-delete-investigation.md` 登记结论与明确未验证范围，并同步索引和技术债。

## 具体步骤

在仓库根运行 `rg -n 'deleteSession|sessionUpdated|sessionExit' extensions/vscode/dev-session-canvas/src` 追踪链路。测试入口由 package.json 和 scripts/test 中现有脚本确定，不改变原断言。真实窗口运行前设置 Node 22、匹配原生资产和 VS Code：

    export PATH=/tmp/dsc-release-node22/node_modules/node/bin:$PATH
    export DEV_SESSION_CANVAS_EXECUTION_ASSETS_SET=/tmp/dsc-release-026-assets
    export DEV_SESSION_CANVAS_VSCODE_EXECUTABLE=/tmp/dsc0261v/.vscode-test/vscode-linux-x64-1.141.0/code
    export DEV_SESSION_CANVAS_SMOKE_DEBUG_ROOT=/tmp/dsc-delete-fresh
    export DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=two-window-shared-runtime
    npm run test:smoke

必须先确认 runner 真正采用独立 debugRoot；main 的固定路径与并发启动前提存在已知干扰，需要在诊断副本中控制。每次运行另用新路径，保留失败日志，不清理仍活跃的其他 Supervisor。

## 验证与验收

证明删除端已经完成会话删除，同时能解释 owner 未收口的具体函数/条件；用实验对照确认该条件足以产生错误，保留原终态要求。文档区分旧真实失败、当前受控实验和未跑场景，不宣称产品已修复。最终运行 git diff --check 和相关文档检查。

## 幂等性与恢复

只读证据和诊断实验可重试；每次真实 smoke 分配新 namespace。产品源文件保持不变；隔离实验脚本如临时创建则不提交实现修复。未跟踪 image.png 保留。

## 证据与备注

    owner registry: sessions=[]
    owner binding: agent / d5267588-5369-445a-b7e0-e6f61001d1ab
    owner expected: stopped + snapshot-only + history-restored + no live runtime binding

## 接口与依赖

使用现有 RuntimeSupervisorClient、Supervisor 协议和 Host wiring 测试，不添加产品协议或依赖。需要区分控制 socket 上的 sessionUpdated 事件与终端 reader 最终页，两者不能假定天然同时到达。

修订说明：建立独立调查范围和初始证据，原因保持未确认。

修订说明：记录当前真实 Supervisor 的 8 项因果实验、根因与修复边界；本次只定位，归档调查，不以诊断干预代替正式修复。

修订说明（2026-10-11）：用户补充开启模式共享 root 画布结构实时同步与双向模式切换清理规则。同步产品规格第 11 节；原 owner 保留 stopped 节点只作为旧测试口径，后续共享 delete 应移除各窗口节点。调查证据保持，完整实现另立设计。

修订说明（2026-10-11，PR #319 review 后）：用户进一步确认非最后开启窗口切换关闭只 detach，最后开启窗口主动切换关闭才清理共享会话并退出 Supervisor。产品规格第 11 节及 `docs/design-docs/runtime-shared-root-canvas-sync.md` 已同步；此前切换清理记录只代表旧定义，不将调查归档或旧测试通过作为新规则已实现的证据。
