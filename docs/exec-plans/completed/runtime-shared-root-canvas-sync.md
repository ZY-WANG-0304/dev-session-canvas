# 实现共享 root 画布与模式切换清理

本 ExecPlan 按 `docs/PLANS.md` 持续维护。用户已授权实现产品规格第 11 节：开启 Runtime Persistence 后共享同 root 画布结构，关闭时隔离 Host 执行与画布，双向切换在页面重启后生效并舍弃当前内容。

## 目标与全局图景

两个同环境/用户的 VS Code 窗口打开相同 root 时，开启模式下创建、删除、位置、卡片尺寸和编辑内容实时收敛；stop 保留节点并同步终态，delete 在各窗口移除节点。关闭模式分别持有执行和画布存储。切换提示方向准确，当前页面继续使用原模式，关闭/重启边界停止旧执行并清空旧内容，新模式不继承此次内容。普通未切换关闭保持既有恢复保证。

## 进度

- [x] (2026-10-11) 从最新 origin/main 创建 runtime-shared-root-canvas-sync，带入独立调查及用户确认规格，保留 image.png。
- [x] (2026-10-11) 选定 root 文件差异合并、OS 持锁和 Host 投影方案，登记正式设计。
- [x] (2026-10-11) 实现共享 root 同步、节点操作串行及关闭模式 slot 隔离，补齐独立进程和 Host 回归。
- [x] (2026-10-11) 实现方向化提示、页面/Host 关闭严格清理、撤回不清理及最终保存失败保留可诊断状态。
- [x] (2026-10-11) 真实双窗口不注入 peer 状态；结构、运行时及双向带内容切换均通过，订阅竞态补丁复验通过。
- [x] (2026-10-11) 同步正式设计、架构、规格、root 归属新旧边界与技术债；全部实现和有限验收完成，计划归档。
- [x] (2026-10-11) 完成可评审实现交付；提交、rebase 和 PR 发布按仓库交付工作流执行。

## 意外与发现

现有 root 画布不受开关隔离，各 Host 写整个 root 快照，缺少结构变化监听。Supervisor 直接删除会取消全部 Host 消费信用订阅；旧 owner 保留 stopped 的测试口径不符合已确认的共享 delete 语义。当前 Reload Window 提示只笼统说明下次加载清空状态，owned 永久关闭路径也需确认显式切换时是否清理共享执行。

## 决策记录

2026-10-11 / Codex：独立实现分支保留用户确认的调查文档，不提升版本、不发布。共享采用 root 存储的串行提交和按字段/对象差异合并，避免仅监听整份快照导致并发覆盖；runtime 进程/终端权威继续在 Supervisor，不新增第二套执行 owner。关闭模式 root 数据使用当前 workspace storage slot，避免写共享 root 文件。

## 结果与复盘

用户可在开启模式的同 root 窗口实时观察节点创建、移动、卡片尺寸和删除，并共享 runtime 输入输出、stop 状态。关闭模式只保存当前 slot 画布；双向切换到页面关闭/重启边界清理当前内容，撤回设置与失败不冒充成功。正式代码与文档已完成，最终保存失败及迟到配置保护回归 617/617 通过，交付分支为 `runtime-shared-root-canvas-sync`，目标 `main`。独立真实场景只覆盖 Linux 单 root；其余新增组合及高频成本登记技术债，不宣称整体跨平台验收。

## 上下文与定向

`extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts` 持有 Host 状态，`persistState` 分解多 root 后调用 `writeRootLocalCanvasSnapshot`。当前共享路径是 globalStorage/root-local-canvas/<root key>/canvas-state.json，读取只在初始化/显式重载，且保存不合并另一窗口。`common/canvasMultiRootComposition.ts` 负责 root 对象加命名空间与拆分。`supervisor/runtimeSupervisorMain.ts` 仍持有执行与终端 journal。新增 `panel/sharedRootCanvasStore.ts` 负责结构差异提交与文件变化订阅，不操控执行。

## 工作计划

第一里程碑实现可独立验证的共享存储：进程间互斥提交、原子落盘、按对象 ID 和字段合并、已删除对象不被 stale 修改复活、事件订阅和关闭。第二里程碑接入 Host：初始化 root 存储、保存写差异、接收远端变化后保留同身份本地终端投影、移除已删节点的订阅并为新 live binding 重连；多 root 复用既有组合逻辑。第三里程碑实现配置切换：在明确边界结算旧执行、清空原模式当前画布并发布共享删除，切换后不迁移内容；对撤回配置不清理，对失败不报告成功。第四里程碑验证双窗口真实结构同步/stop/delete与关闭模式隔离，同步文档。

## 具体步骤

在仓库根运行新增存储测试与现有 Host/Supervisor 回归、npm run typecheck。真实窗口需 Node 22 和当前源码匹配六目标原生资产：

    export PATH=/tmp/dsc-release-node22/node_modules/node/bin:$PATH
    export DEV_SESSION_CANVAS_EXECUTION_ASSETS_SET=/tmp/dsc-release-026-assets
    export DEV_SESSION_CANVAS_VSCODE_EXECUTABLE=/tmp/dsc0261v/.vscode-test/vscode-linux-x64-1.141.0/code
    export DEV_SESSION_CANVAS_SMOKE_DEBUG_ROOT=/tmp/dsc-shared-fresh
    export DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=two-window-shared-runtime
    npm run test:smoke

夹具串行等待 Agent live 后再创建 Terminal，runner 必须采用独立 debugRoot。每次真实场景新 namespace，不删除其他用户/既有 Supervisor。

## 验证与验收

共享测试必须跨独立进程提交，验证并发不同对象/不同字段均保留、删除不复活、监听不回写、重复提交幂等与关闭无泄漏。Host 测试验证移除只 detach 本地 reader、新 binding 不自动新建执行、局部 runtime 输出不覆盖共享编辑、关闭模式不写共享存储。真实窗口验证创建/移动/卡片resize/共享stop/delete可见结果。切换测试验证提示、延迟生效、旧内容不恢复、旧执行结算和失败保留。原未切换模式重开测试保持。

## 幂等性与恢复

原子写不覆盖无法解析的共享文件；操作基于窗口上次已知状态产生差异，已删除对象的 stale 修改不复活。进程间提交锁由操作系统资源自动释放，不能通过超时删除其他进程锁。初始化旧 root 文件保留既有 live binding，关闭模式只读取自己的 slot。切换失败保留可诊断绑定，不伪造成功退出。临时实验与窗口工件放独立 debugRoot。

## 证据与备注

本次共享 store 8/8；Host 初轮及订阅补丁后 615/615；最终保存失败及迟到配置保护新增回归后 617/617，日志 `/tmp/dsc-shared-host-config-final.log`。类型检查、multi-root helper、存储路径、本地化和 smoke runner 环境通过。分页终态、Host 输出信用/available credit 与 legacy reconnect 通过。真实双窗口日志 `/tmp/dsc-shared-window-final.log`、`/tmp/dsc-shared-window-source-final.log`、`/tmp/dsc-shared-window-subscription-final.log` 均通过；对应 `/tmp/dscshare3`、`/tmp/dscshare4`、`/tmp/dscshare5`。最终配置保护补丁后，Host 617/617 和真实双窗口再次通过，日志 `/tmp/dsc-shared-host-config-final.log`、`/tmp/dsc-shared-window-config-final.log`，窗口工件 `/tmp/dscshare6`。

    Shared root Canvas store: 8/8 passed
    Host execution owner wiring: 617/617 passed (selected 617/617; non-native only).
    Two-window shared runtime smoke passed.
    VS Code smoke test passed.

`test:runtime-completed-history` 失败于 `verifyCompletedBindingOwner` 旧的 diagnostics=[] 断言，实际只有 main 新增正常 execution/deleteBoundary。独立 worktree `/tmp/dsc-shared-baseline-PFAvcS` 的 origin/main a39cd8c1 同点同结果失败，日志 `/tmp/dsc-shared-completed-history-baseline.log`。本次未修改该断言，不记录全量 npm test 通过。

## 接口与依赖

新增 SharedRootCanvasStore 提供 publish(state)、mutate(nodeId, work)、接收变化和 flush/dispose。只使用 Node 内置 fs/net/crypto；root 提交锁仅覆盖读合并写；另有独立节点操作锁覆盖 start/delete 及其保存，不持有 root 提交锁等待 Host/Webview。Host 消费使用完整 runtime backend/storage/session/kind 身份保护，不修改 provider、终端协议或原生资产。

修订说明（2026-10-11）：完成实现和有限真实验证，补齐基线失败、订阅启动竞态与关闭释放责任；最终保存失败保持本地结算后状态。有限功能验收和仓库文档已收口。

初始化读取与订阅建立之间可能发生 peer 提交，store 构造后的异步初始投影补齐它，新增启动竞态回归通过。执行 work 抛错仍须 flush 已排队提交，否则节点锁提前释放；新增失败工作回归通过。Host 最终保存可能重新触发 root 写入，因此监听应在 deactivation 尾部释放而非提前关闭。root 移除同样先等旧组合保存，再退订。

决策补充（2026-10-11 / Codex）：root 和节点操作 TCP 端口采用不相交区间；同字段按提交顺序，位置/尺寸整体更新；关闭模式不能附着旧共享 root owner。普通未切换关闭复用既有契约。切换清理不提供多 root 全局事务；部分执行可能已退出或部分 root 已提交清空，失败保留可诊断事实并阻止继续加载，不宣称回滚已完成的共享删除。

修订说明（2026-10-11，收口）：最终 store 8/8、Host 617/617、类型检查通过；root 归属旧默认 false 附着规则显式被新私有模式替代，相关正式文档同步。计划归档，提交与 PR 地址在交付中记录。

修订说明（2026-10-11）：迟到 stop 投影只屏蔽已结束 runtime 身份和生命周期，不覆盖用户新编辑的启动配置；删除/替换节点清除旧投影记录，新增 Host 回归覆盖。

修订说明（2026-10-11，旧断言后续修正）：用户明确授权修正 completed-history 旧诊断断言。`verifyCompletedBindingOwner` 对 root 缺失 owner 拒绝与正常完成分别精确校验正常删除请求诊断，保留完整原绑定、保存前置、派发数量和 owner 传递校验，额外清理失败诊断仍拒绝；Node 22 下 `npm run test:runtime-completed-history` 整套通过。前述失败是修正前的历史证据，不再作为当前测试结论，仍未运行全量 npm test。
