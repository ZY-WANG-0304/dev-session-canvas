# 审核 Webview、Host 与 Supervisor 的当前架构

本 ExecPlan 是设计审核的活文档，按 `docs/PLANS.md` 维护。审核不改变运行时行为，交付可追溯的风险、证据和后续建议。

## 目标与全局图景

确认 `extensions/vscode/dev-session-canvas/` 的三方运行时边界是否与实现一致，找出会影响用户输入、输出、恢复和生命周期的确定性缺陷。完成后，维护者能从审核报告定位问题、复现证据，并区分已确认缺陷、已有技术债和未验证风险。

## 进度

- [x] (2026-09-16) 阅读工作流、架构与审核约束，确认工作树干净。
- [x] (2026-09-16) 执行 `git fetch origin main`，从 `origin/main@4d7f07e55461f414c570365136cc06ece6f18c64` 创建 `architecture-review-webview-host-supervisor`。
- [x] (2026-09-16) 初步定位协议、Host、Webview、Supervisor 与相关测试。
- [x] (2026-09-16) 检查状态权威、消息时序、断连恢复、资源清理与依赖方向。
- [x] (2026-09-16) 执行定向测试，记录现有覆盖与未覆盖的无响应 hello 边界。
- [x] (2026-09-16) 完成设计审核报告、索引和技术债记录。
- [x] (2026-09-16) 按用户补充复核 F-03：画板按 root、Supervisor 新建按窗口 slot 归属；补充待修订设计、旧会话过渡边界及建议验收场景，完成文档一致性检查。

## 意外与发现

当前基线 `CanvasPanelManager.ts` 为 27,623 行，`webview/main.tsx` 为 9,823 行。文件规模本身不构成功能缺陷；审核需要沿实际调用路径检查异步状态是否收敛。现有技术债已登记 Webview 大文件、90000 行终态短读和部分测试夹具漂移，不重复当成新发现。

补充审核确认两个 Supervisor 新建入口都无 root 参数，默认 storage 来自窗口 `context.storageUri`；已有会话则按 backend/storage/session/kind 恢复。多根设计第 6.8 节及产品规格明确保留具体 slot，所以 F-03 是需要修订的设计决策。现有 shared-runtime 恢复测试不足以证明从不同窗口新建会话也会使用同 root 的稳定 Supervisor。

## 决策记录

2026-09-16：本任务按当前架构审核处理，不自动修复实现，也不发布 MR 评论。用户没有指定待审 MR；基线是新拉取的 `origin/main`。报告中的修复方向属于建议，不代表已接受的新架构。

2026-09-16：按状态权威、跨进程协议、生命周期与验证边界组织审核。优先验证用户可观察的问题，不把目录命名或文件长度当作阻塞项。

2026-09-16：用户要求补充 root/runtime 归属问题并确认目标方向。本次将其登记为 F-03，同步设计第 6.8 节、产品规格、索引、核心信念与技术债；保持现行 slot 恢复语义可追溯。具体 root identity/存储/发现方案及单根、多根代码改造另开 ExecPlan，旧 live session 不通过地址改写迁移。

## 结果与复盘

审核及补充完成：确认一项 live-runtime 连接可靠性缺陷（hello 无响应时客户端无限等待）、一项共享层依赖方向漂移，并登记画板/root 与新建 runtime/窗口归属不一致的设计问题 F-03。首次审核的定向测试全部通过；F-03 补充仅复核代码与文档、检查链接及 diff，未重跑运行时测试。报告列出单根/多根双向创建、不同 slot、跨 root 隔离、并发创建、身份边界、新旧归属共存、generation 和重开恢复的待执行验收。运行时改造另行规划。

## 上下文与定向

`extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts` 持有 workspace 画布与节点到会话的映射，称为 Host。`src/webview/main.tsx` 及相邻组件在 VS Code Webview 中渲染画布和 xterm 终端。`src/supervisor/runtimeSupervisorMain.ts` 是独立进程，仅为 live-runtime 模式托管执行会话；terminal journal 是记录输出、尺寸与 scrollback 变更的顺序日志，authority 标识日志所属会话代次，revision 是该日志的连续序号。

`src/common/protocol.ts` 定义 Webview/Host 消息；`src/common/runtimeSupervisorProtocol.ts` 定义 Host/Supervisor 消息。`src/panel/runtimeSupervisorClient.ts` 通过 socket 发送请求。`src/supervisor/terminalSessionJournal.ts` 管理日志与 checkpoint，checkpoint 是用于加速恢复的终端状态缓存。

## 工作计划

第一阶段沿 Webview ready、Host bootstrap、会话 create/attach/subscribe、输出投影与 ACK、停止/删除和断连路径阅读代码，并对照 `ARCHITECTURE.md`、`docs/design-docs/agent-terminal-lossless-io-and-recovery.md` 与现有测试。

第二阶段运行相关协议、journal、输出调度与生命周期测试。对可疑异步路径用临时 fixture 或独立脚本进行受控验证。若只具备静态证据，则明确触发前提和调用顺序；不把环境依赖风险写成稳定复现。

第三阶段在 `docs/design-docs/webview-host-supervisor-architecture-review.md` 写出基线、发现、风险、建议及验证记录，并登记到设计索引。保留现有正式架构，只有确认的文档事实错误才同步修订；未选择的重构方案保持待探索。需要后续处理的问题登记到技术债表，注明本轮只是审核。本轮未修改运行时代码。

补充阶段将用户提供的 root/runtime 归属事实对照 `CanvasPanelManager.ts` 的新建、storage 派生和旧会话 attach 路径，再在多根设计与产品规格新增明确标为待修订的边界说明。报告 F-03 集中保存证据、确认方向与待执行验收矩阵，避免在当前 slot 正式契约中混入尚未实现的新归属规则。

## 具体步骤

所有命令从仓库根目录执行。

    git fetch origin main
    git switch -c architecture-review-webview-host-supervisor origin/main
    npm run typecheck
    npm run test:protocol-webview-messages
    npm run test:runtime-supervisor-protocol
    npm run test:terminal-session-journal
    npm run test:execution-output-scheduler
    npm run test:webview-lifecycle-diagnostics
    git diff --check

后续若需要额外复现，在报告中记录完整命令、输入与观察。上述分支创建已完成，恢复审核时不要重复切分支。

## 验证与验收

每条确认发现至少提供代码位置、触发条件、确定性因果链及修复方向。定向测试必须如实记录通过、失败或环境阻断，不能用静态字符串断言代替生命周期行为的证据。最终报告明确覆盖范围以及未运行的真实 VS Code、平台和远程场景。

F-03 本次文档验收要求：报告区分当前实现、待修订决策与用户确认方向；设计和规格保留旧 slot 绑定语义并链接后续问题；单根和多根新建都进入建议验收；旧 session 继续原绑定、旧 Supervisor 的跨 root 退役边界写明。检查文档路径有效、索引状态与日期一致并执行 `git diff --check`。建议运行时验收只登记，留待改造分支执行。

## 幂等性与恢复

阅读和定向测试可重复执行。临时复现必须使用临时目录和独立 socket，不操作用户会话或正式存储。结束时关闭复现进程并删除自身临时产物，不回滚其他工作树的修改。本任务不改动运行时代码。

## 证据与备注

基线确认：`git status --short --branch` 仅输出新分支及其 `origin/main` 跟踪关系；创建分支时没有用户未提交改动。

## 接口与依赖

复用仓库已有 Node.js、esbuild 与测试脚本。必要的故障注入使用本地 socket 假服务或现有 fake execution backend，不引入新的生产依赖或协议。

修订记录：2026-09-16 创建审核计划，显式记录基线、范围与证据标准；完成代码路径检查、定向测试和审核文档收口。同日按用户要求追加 F-03，补齐设计问题、迁移约束与待执行验收，并修正审核相关文档中指向本计划旧 active 路径的链接。
