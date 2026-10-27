# 修复失联节点删除与原 Supervisor 通信入口恢复

本 ExecPlan 按 `docs/PLANS.md` 持续维护。

## 目标与全局图景

用户清理临时目录后，后台 Supervisor（管理 Agent 和 PTY 的进程）可能仍存活，但 Host 无法通过 Unix socket 重新连接。本次一个 PR 同时实现已有失联节点可移除及新 Supervisor 自动重新监听。节点移除不冒充进程停止；原会话的身份与未确认原因必须持久留存。修复入口不重新启动 Agent、不清空 registry 或 journal。

## 进度

- [x] (2026-10-27 UTC) 核对故障现场、现有删除门槛、共享合并、运行时独占与启动路径；从 origin/main e25ede61 创建独立工作树。
- [x] 编写范围与验收设计。
- [x] 实现 Unix socket 修复及停止边界，7 项真实 socket 回归通过。
- [x] 实现失联节点删除与持久诊断记录，10 项专项及完整 644 项 Host 回归通过。
- [x] 独立真实 Codex CLI 0.164.0、Supervisor/Provider/PTY、实际 Host 删除和共享存储组合验收通过；正常构建及相关回归通过。
- [ ] 同步证据、提交、推送并创建一个 PR。

## 意外与发现

原现场 Supervisor PID 814144 仍持有内核 socket 与 namespace 独占，路径却已消失；两个 Provider 仍活着。Host 的 history-restored/liveSession=false 不能证明进程结束。当前严格删除保留 error 原因，但上层只显示 unconfirmed。SharedRootCanvasStore 已保证针对旧节点的迟到编辑不能复活删除。

## 决策记录

- 决策：连接失效后的节点移除和后台停止分别记账，不修改 stop、模式切换与启动的严格结算要求。理由：用户明确要求旧 Supervisor 对应节点可删除；它不具备新增自修复代码。日期：2026-10-28。
- 决策：仅已取得独占的 root Supervisor 在 Unix 上定期修复入口，不引入新的进程或协议 generation。理由：后台会话仍在原进程。Windows 命名管道没有临时目录删除情形。日期：2026-10-28。
- 决策：持久记录是待人工处理的停止未确认凭据，不引入任意进程 kill 或无限后台清理重试。理由：旧进程不可联，记录应保存事实而非伪造清理成功。日期：2026-10-28。

## 结果与复盘

本地实现与具名 Linux 验收已完成，证据在 `docs/references/runtime-socket-recovery/local-validation.json`。两处旧 Host 夹具补齐真实 ExecutionFlowRecorder 初始化，未放宽断言；一次完整套件的 3 秒模式切换超时保留，隔离主线和本分支通过，最终全套 644/644。原用户环境只读取证，未终止进程。PR/Actions 状态在提交后更新，不将本地结果称发布门禁通过。

## 上下文与定向

`extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts` 的 deleteNodeCore 在 terminateExecutionNodeForDeletion 失败后退出；deleteRuntimeSupervisorSessionsWithCandidate 持有严格结果。`panel/runtimeSupervisorClient.ts` 的 deleteSessionStrict 区分服务端响应和连接失败。`panel/sharedRootCanvasStore.ts` 将节点删除提交到 root 共享文件。

`supervisor/runtimeSupervisorMain.ts` 在 start 获取 namespace 后调用 listen；新增 `supervisor/runtimeSocketListener.ts` 管理监听路径丢失、重建与关闭。`supervisor/runtimeRootOwner.ts` 的目录检查保持现有 owner/path/权限规则。恢复不能调用 start，因为 start 会清空旧 registry/journal。

## 工作计划

先独立实现并测试 listener：一秒轮询缺失路径，验证/重建私有目录，关闭旧 listener 的接入端但保留已接受连接，然后新建 listener；停止必须等待全部旧连接与正在进行的修复，不得在停止后重新监听。文件占用、权限异常不得覆盖。

随后把严格删除的连接错误以类型化异常送达单节点删除入口，核验原 binding 与操作身份，先写 global storage 下的原会话诊断记录，再释放本 Host 投影并按现有共享路径删除节点；等待保存完成后显示节点移除与后台停止未确认的分别结果。不把其他错误降级为成功。回归同时检验 legacy 旧会话、共享 stale write、重载、存储失败和 replacement。

## 具体步骤

工作目录 `/home/users/ziyang01.wang-al/projects/dev-session-canvas.worktrees/runtime-socket-recovery`。复用原仓库 node_modules，只在独立临时夹具目录执行故障注入。运行新增 listener/删除测试、`node scripts/test/test-host-execution-owner-wiring.mjs`、`npm run test:shared-root-canvas`、相关 runtime 测试、`npm run typecheck` 和本地化检查；真实进程验收命令在实现后补入本节。

## 验证与验收

已存活 Supervisor 遇到仅 socket 删除和整个目录删除均恢复；新连接 hello PID、session ID、原执行 PID 不变；原连接可继续工作，输出继续到达，原会话可正常删除。循环删除不泄漏 listener，关闭与修复交错不会重开，陌生文件与权限错误不被覆盖。旧无修复 Supervisor 失联后节点可删除、诊断凭据可读，重载和共享窗口迟到更新不复活节点。身份、存储、pending creation 失败不得放行。

## 幂等性与恢复

监听重建只在路径不存在时进行，由原独占 owner 操作。节点删除凭据按原 binding 的稳定摘要记录，重试不丢身份。测试只删除自己 mkdtemp 内的 socket，进程由测试直接创建、结束并确认退出。不得清理真实 `/tmp/dsc-root-1115017707`。

## 证据与备注

原始现场位于用户提供的 2026-10-27T18-02-47-058Z diagnostics；不将用户终端正文和私人路径打包上传。PR 只保留经过裁剪的测试结果及机制说明。

## 接口与依赖

使用现有 Node fs/net、crypto 和 VS Code 消息接口，不新增 npm 依赖。监听组件暴露 start/close，与现有 Supervisor shutdown 责任对齐。删除凭据保留 sessionId、backend、runtimeStoragePath、runtimeOwner、nodeId、时间与原因；不保存终端正文或认证数据。

修订记录：2026-10-28 创建计划，限定一个 PR 的两项修复与验收边界。

## 已执行命令与最终结果

    node scripts/test/test-host-execution-owner-wiring.mjs
    Host execution owner wiring: 644/644 passed

    npm run test:runtime-socket-recovery-native -- --agent-command <本机 codex 可执行文件>
    两次路径清理恢复原身份；实际 Host 删除、共享旧更新、重开无节点与后台仍 live 分别确认；最终显式夹具清理后 Supervisor/Provider 退出。

    npm run test:runtime-supervisor-namespace
    namespace 11/11；listener 7/7。

其余命令为 `npm run test:shared-root-canvas`、`npm run test:runtime-root-ownership`、`npm run test:runtime-supervisor-request-timeout`、`npm run test:runtime-completed-history`、`npm run typecheck`、`npm run test:ui-copy-localization` 与 `npm run build -- --execution-assets-set <原仓库 generated/execution-assets>`，均通过。原始日志保留于本工作树 `.debug/socket-recovery/`，不提交私人目录或终端正文。

修订记录：2026-10-28 更新实际实现、首败与修复边界、完整 644 项和真实 CLI 组合验收；跨平台/UI/Actions 及旧进程处理边界已登记技术债。
