---
title: 失联节点删除与 Supervisor 通信入口恢复
decision_status: 已选定
validation_status: 验证中
domains: [执行编排域, 项目状态域]
architecture_layers: [宿主集成层, 适配与基础设施层]
related_specs: [docs/product-specs/runtime-persistence-modes.md]
related_plans: [docs/exec-plans/completed/runtime-socket-recovery.md]
updated_at: 2026-10-28
---

# 失联节点删除与 Supervisor 通信入口恢复

## 背景与目标

人工清理 /tmp 后，Unix socket 目录和文件可能丢失，原 Supervisor 与 Agent 却继续运行。原 Host 将恢复失败显示为 history-restored，删除还依赖原会话 RPC 确认，造成画板上无法移除的节点。用户确认同一个 PR 解决失联节点删除与 Supervisor 自动修复，并要求验收。

## 正式方案

### 失联节点删除

`panel/CanvasPanelManager.ts` 的显式单节点删除允许原 binding 的明确连接失效降级为画板节点移除。正常连接仍先停止会话。pending creation、身份变化、服务端删除失败、权限与持久化错误保持失败；连接失效不等于 EOF 或进程退出。严格 stop、批量边界与模式切换不使用此例外。

移除前向 global storage 持久写入原节点与运行时身份、停止未确认原因和时间，不保存输出正文。写入失败不得继续删除。记录表达清理责任未确认，不是进程已停止或节点已提交的证明，也不授权按 PID 杀进程。旧 Supervisor 无法自修复时，后台可能继续运行，凭据保留供显式处理；本次不新增自动 orphan kill 或无限后台重试。

节点移除沿既有共享 root 提交和 workspace 持久化路径完成，保存成功后才通过 `vscode.window.showWarningMessage` 显示 VS Code 右下角原生非模态警告，说明“节点已移除，但无法确认后台 Agent 或终端进程已停止，可能仍在运行，请手动检查并停止；停止未确认记录已保留，扩展不会自动清理进程或记录”。不再以画布内 `host/error` 承载该结果，避免画布隐藏时漏看或重复提示；不等待用户关闭通知，不增加删除确认步骤。正常确认停止、记录写入失败、节点保存失败或身份变化均不弹此移除成功警告。释放本 Host reader、订阅和映射；共享 peer 按已有结构删除释放自己的投影。已有删除优先规则保证旧编辑与迟到恢复不能复活节点。

### Supervisor 自修复

`supervisor/runtimeSupervisorMain.ts` 在 root owner 已取得运行期独占并开始监听后，为 Unix 平台启用 `runtimeSocketListener.ts`。每秒最多一次检查路径，缺失时按 `runtimeRootOwner.ts` 的稳定地址及私有目录规则重建目录、关闭旧 listener 的接入端并建立新 listener。已有 socket 连接、sessions、PTY、authority、registry 与 journal 均保留；绝不重新调用 start 或派生 Supervisor。

旧 listener 必须在新 listener 建立前 close，避免 Node close 的 unlink 删除新入口；close 等待的是旧连接结束，不能为重新监听而销毁旧客户端。全部旧 listener 纳入关闭等待；停止先禁止修复，再等待正在执行的检查并关闭新旧监听，避免关闭后重新开放准入。修复轮询不重叠且不单独保活进程。

路径被普通文件、符号链接或其他 socket 占用时不覆盖；目录权限、owner 或地址校验失败时记录错误，保留现有会话，下一周期仍可重试。修复只补缺失入口，不迁移地址。Windows 命名管道不属于 /tmp 清理场景，维持原实现。已运行的旧 Supervisor 不会热更新获得自修复能力。

### 关闭期间路径被替换

Review 复现：close 的路径核验抛错后缓存 rejected promise，导致原 listener 与 Supervisor 保活永不释放。不能直接删除核验，因为 Node server.close 会 unlink 同名外部文件。

RuntimeSocketListener 在关闭开始时永久关闭 admission 与重建；路径核验失败时按原检查周期串行重试，重复 close 共用原操作。外部占位仍在时保持 pending 并去重报告，不覆盖文件；路径缺失或仍是原 socket 后关闭原监听，等待全部代际已接受连接。路径核验与 Node close 之间仍存在外部并发替换窗口，不能宣称抵御同 UID 恶意竞争。

RuntimeSupervisorServer 保持首份报告和截止时间不可变；在已发起的各关闭责任实际全部 settled 后释放 keepAlive，允许自然退出并释放 namespace。超时后不新启动 registry 保存、socket.end 或会话停止；如果这些后续阶段在截止前未发起，仍保留未确认责任。本修复不扩大原截止时间授权。

## 取舍

只重建目录不能恢复监听；启动新 Supervisor 不能接管原 PTY。只迁移临时路径仍无法处理外部删除，因此本次不改地址与 generation。节点移除不依赖后台停止确认，同时保留未确认责任，避免把 UI 可操作性和进程结算混成一个结果。

## 验证

验收按 ExecPlan 的隔离夹具执行。必须包含真实 Unix socket、独立 Supervisor/执行进程持续运行及恢复前后身份不变的证据；纯 mock 或编译不能代替这项。Host 回归验证旧无修复 runtime 的删除、保存失败、身份变化与共享删除不复活。平台与受控层按实际运行记录，不外推其他平台已验证。

### 初次本地验收结果（2026-10-28，review 前）

Linux x64、Node 25.6.0、真实 Codex CLI 0.164.0 的独立 Supervisor/原生 Provider/PTY 验收通过。测试只将稳定 socket 目录映射到 mkdtemp 下的私有目录，不改变 owner、namespace、权限验证、RPC、会话或原生 PTY 代码。先删除 socket 文件，再删除整个目录；两次均确认 Supervisor PID、Provider PID、PTY 主体 PID、session ID 和 authority 不变，原控制连接仍可用，新客户端可挂接原 Codex，终端回显继续。

同一真实进程中关闭修复轮询模拟旧 Supervisor 的行为，再删除目录；使用实际 Host deleteNode、严格客户端和 SharedRootCanvasStore，验证节点移除、停止未确认凭据持久化、workspace 文件读回、共享 peer 旧编辑不复活及重新打开 store 后无节点。原 Codex 仍 live，证明未把节点删除误报为后台停止。最后利用测试保留的原连接显式清理两个会话，验证 Supervisor shutdown settled、进程正常退出及 Provider 消失。这一步是夹具清理，与之前节点删除的结果分别记录。

监听器 7 项真实 Unix socket 回归覆盖已有连接、重复修复后释放旧 listener、异物不覆盖、权限失败、关闭等待新旧连接、修复与关闭交错。Host 最终完整 644 项通过，其中失联删除专项 10 项包含写盘期间 replacement 的竞态反例。共享 store 20 项、root ownership/startup/handshake（47 项握手）、namespace 11 项、RPC timeout 37 项、completed history、本地化、typecheck 与正常平台资产构建通过。最终准确结果以 `docs/references/runtime-socket-recovery/local-validation.json` 为准。

初次完整 Host 测试在未修改 main e25ede61 同样因 Object.create 夹具缺失 ExecutionFlowRecorder 而失败；本 PR 仅补齐两处夹具的真实字段初始化，不修改对应业务断言。期间一次全套模式切换用例超过原 3 秒预算，未改 main 和本分支隔离复验均通过，完整重跑通过；保留首次失败，不宣称其间歇原因已修复。

### 验收边界与操作说明

本轮未启动 VS Code UI，也未调用模型推理服务；真实 Codex 验证的是 CLI 进程、PTY 与会话连续性，不是模型请求结果。macOS 实机和 Windows 安装/完整 Actions 证据不由 Linux 测试代证；Windows 原命名管道分支保持。旧 Supervisor 场景通过显式关闭新进程的修复轮询模拟，并非热更新旧二进制。原用户故障环境没有被修改或结束会话。

停止未确认凭据位于扩展 global storage 的 `unconfirmed-runtime-deletions-v1/<binding摘要>.json`，保留原 node/session/backend/storage/owner、原因和记录时间；它不证明节点已提交或进程已停止。需要后续处理旧进程时从这里定位原身份，不根据陈旧 PID 直接杀进程。该持久凭据本轮不自动删除、不触发后台无限重试。

### Review 修复后的验收（2026-10-28）

新增真实 socket 回归先在 ceae895b 源码上失败（close 拒绝而非等待路径恢复），修复后 10/10 通过；覆盖零连接、一代与三代连接、占位内容不变、重复 close、移除占位后释放 listener 且不重新监听。Supervisor 全套 136/136 包含迟到回调释放保活、首份报告同一对象、重复 close 只有一次原请求，以及保存未完成时保留责任的反向断言。完整 Host 644/644 再次通过。

扩展原生验收脚本的 `--shutdown-obstruction before|after`，保留生产 20 秒预算，使用真实 Codex CLI、独立 Supervisor、原生 Provider 和 PTY。两种情况均从活会话发起关闭，execution/readers/registry/sockets 先实际 settled，只有外部占位阻挡 server；占位内容保持，registry 中两会话已结束。截止前移除得到 settled；截止后移除保留首份 unconfirmed（pending 仅 server），随后全部原责任完成、保活释放、原监听归零、进程 exit 0。另一独立进程在原 Supervisor 存活时取得 namespace 失败（EADDRINUSE），退出后成功取得并释放同一 namespace。

原有真实会话连续性、失联单节点删除、共享迟到编辑与重开不复活的组合验收再次通过。共享 store 两次宿主网络运行遇到已有 18081 listener；未修改套件在独立 user/network namespace 开启 loopback 后 20/20 通过。构建、类型、本地化、namespace、root ownership、RPC timeout 和 completed history 回归均通过。新证据位于 `docs/references/runtime-socket-recovery/review-repair-validation.json`；旧 local-validation.json 保留原源码摘要，不冒充新修复验收。

复现命令（先正常构建 native 资产）：

    npm run test:runtime-socket-recovery-native -- --agent-command <codex路径>
    npm run test:runtime-socket-recovery-native -- --shutdown-obstruction before --agent-command <codex路径>
    npm run test:runtime-socket-recovery-native -- --shutdown-obstruction after --agent-command <codex路径>

此验收不承诺截止后开始新的保存或关闭阶段，也不证明永久占位无需外部处理；这些情况继续显示未确认并保留责任。

### 删除后的宿主警告（2026-10-28）

补充 VS Code 原生非模态警告，通知未关闭也不阻塞删除或共享 mutation 的完成。中文本地化与英文默认文案均明确后台进程可能继续运行、需手动检查停止，以及记录保留和无自动清理能力。升级边界同步至主扩展 CHANGELOG 的 Unreleased 节，不改写已发布版本说明。

验证：12 项定向 Host 回归通过，覆盖 Agent/Terminal 的 ENOENT/ECONNREFUSED、保存等待期间不提前提醒、通知未关闭时删除仍完成、失败与身份替换不误报、正常确认停止不提醒；完整 Host 回归 646/646 通过。`npm run typecheck`、`npm run test:ui-copy-localization` 与 `git diff --check` 通过。本次未启动 VS Code UI，也未重跑真实 Codex/Supervisor 组合验收；此前运行时证据不变，原生测试夹具已同步通知断言。

手动验证路径（待执行）：在隔离工作区使用无法重连的旧 Supervisor 会话删除单节点，确认节点保存后右下角出现本地化警告；不关闭通知仍可操作画布。对正常可停止会话删除时不应出现该警告。原生通知显示遵循 VS Code 的通知设置。
