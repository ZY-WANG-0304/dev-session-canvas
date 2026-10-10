# 定位 RuntimePersistence 首次 root 准备失败

本 ExecPlan 按 `docs/PLANS.md` 持续维护。本轮是问题定位，不交付生产修复。

## 目标与全局图景

解释 PR314 head `1579d2da` 默认 VSIX smoke 在开启 RuntimePersistence 后，Agent 与 Terminal 首次启动均失败的原因。RuntimePersistence 是让独立进程持有终端、在窗口 reload 后重新连接的模式；当前失败发生在首次启动，尚未进入重连。交付可重复的原始异常与正反对照，明确环境、测试和产品责任。

## 进度

- [x] (2026-10-10) 核对原失败、工作分支及 root helper 调用链。
- [x] (2026-10-10) 原目录重放与真实 VS Code 副本捕获准备第一步的 globalStorage 权限拒绝。
- [x] (2026-10-10) 同目录 0775/0755/0700 对照及原生 0002/0022 对照完成；捕获首次创建调用栈。
- [x] (2026-10-10) 保存精简证据和复现程序，同步设计与技术债并归档；生产源码未改。

## 意外与发现

原失败在 `verifyLiveRuntimePersistence` 等待 Agent live；两个节点均出现 `Root runtime preparation or submission did not complete.`。`runtimeRootPreparation.ts` 的外层 catch 丢弃原异常。日志中的 watcher ENOSPC 仅表示监视器额度不足，目前不能归因到 Runtime 准备。

原生探针发现，扩展激活时 globalStorage 不存在，构造期间普通画布保存的递归 mkdir 首次创建 0775。后续带 mode 0700 的 mkdir 没有改变已有权限。0022 对照创建 0755，root 启动且 Terminal live，Agent 后续资源准入拒绝；该拒绝本轮没有捕获瞬间，不作具体原因推断。

## 决策记录

- 决策：先复用失败工件及原目录，必要时临时插入只读阶段探针，不放宽目录权限检查或提交不确定性保护。
  理由：通用错误不足以证明权限、进程提交或后端选择中哪一步失败。
  日期/作者：2026-10-10 / Codex。

- 决策：在既有 VSIX smoke-host 的独立副本加观测，保持正式源码和原始包不变。
  理由：可以复用原载荷与创建路径，准确观测首次目录创建和被 catch 隐藏的错误。
  日期/作者：2026-10-10 / Codex。

- 决策：以准备第一步异常、同目录权限对照和真实 Terminal live 作为当前根因验收；后续 Agent 资源拒绝单列。
  理由：后续失败属于另一责任阶段，不能把它混成权限问题，也不能用当前对照声称完整测试通过。
  日期/作者：2026-10-10 / Codex。

## 结果与复盘

已确认普通画布保存和新 root Runtime 对共享扩展存储的权限要求不一致，属于环境触发的插件初始化/兼容缺口。新增准备检查及 Host 路由分别来自 e72d7859、34c54561，与历史 checkpoint 权限拒绝同因。当前只交付定位；目录初始化/已有目录处理、具体失败反馈和启动状态收口仍待修复。0022 下另有 Agent rejected-before-acquire，未归因。完整 gate 未通过。

## 上下文与定向

工作目录 `/tmp/dscr`，分支 `investigate-smoke-reload-autostart`。原始工件在 `.debug/claude-resume-fix/trusted-artifacts/`，日志在 `.debug/claude-resume-fix/vsix.log`。原工作区有无关发布工作，不修改。

`tests/vscode-smoke/extension-tests.cjs` 的 `prepareTrustedBaseNodesForAppliedRuntimePersistenceMode(true)` 更新配置、模拟 reload 并创建节点。`CanvasPanelManager.resolveRuntimeCreationTarget` 构造根目录运行时身份和存储路径；`getRootRuntimeSupervisorClient` 通过 IPC 启动短命 helper。`extensions/vscode/dev-session-canvas/src/supervisor/runtimeRootPreparation.ts` 的 `prepareRuntimeRootSupervisor` 依次准备目录、领取启动所有权、发现已有进程、写启动意图和提交进程。`runtimeRootOwner.ts` 检查目录身份及私有权限。

## 工作计划

第一里程碑读取失败工件的路径、对应目录权限和 helper 入口，验证异常是否发生在准备阶段。第二里程碑在隔离目录重放同一准备入口，增加只读异常观测，用单变量对照确认因果；若必须使用真实 VS Code，则复用原 Runtime 创建入口，明确只覆盖局部 smoke。第三里程碑撤回探针，保存精简复现程序与证据，并更新 `docs/design-docs/smoke-reload-autostart-investigation.md`、索引、core-beliefs 和技术债。

## 具体步骤

所有命令在 `/tmp/dscr` 执行。Node 22 使用 `export PATH=/tmp/dsc-release-node22/node_modules/node/bin:$PATH`。如需依赖，顺序执行 `mv .debug/rca/node_modules node_modules` 与 `mv .debug/rca/playwright-browsers .playwright-browsers`。用 `rg` 检索上述文件；避免输出完整环境变量与巨大 snapshot。运行命令及对照输出在形成结论后补入本计划。

实际仅恢复 node_modules；本轮无需 Playwright 浏览器。可复跑命令如下，原生探针以 0002 首先复制原 head 的 `.debug/vscode-vsix-smoke/smoke-host`，再以 0022 使用同一副本与全新 user-data：

    node docs/references/smoke-reload-autostart/runtime-root-directory-replay.mjs .debug/vscode-vsix-smoke/smoke-runtime/user-data/User/globalStorage/devsessioncanvas.dev-session-canvas
    DEV_SESSION_CANVAS_VSCODE_EXECUTABLE=/tmp/dsc0261v/.vscode-test/vscode-linux-x64-1.141.0/code xvfb-run -a node docs/references/smoke-reload-autostart/runtime-root-native-probe.mjs 0002
    DEV_SESSION_CANVAS_VSCODE_EXECUTABLE=/tmp/dsc0261v/.vscode-test/vscode-linux-x64-1.141.0/code xvfb-run -a node docs/references/smoke-reload-autostart/runtime-root-native-probe.mjs 0022

第一命令四组断言通过、exit 0。两个原生命令均 exit 1：0002 在原 root 准备失败；0022 越过权限与提交，Terminal live、Agent 后续资源拒绝。日志和 artifacts 在 `.debug/runtime-root-investigation/native-0002*`、`native-0022*`。不是两次完整 gate。

## 验证与验收

必须得到原失败路径、原始异常、触发条件及至少一组仅改变该条件的对照。区分“越过当前失败点”和“完整 gate 通过”；不重复宣称前序 smoke 或后续未执行场景通过。

## 幂等性与恢复

实验创建独立临时目录；不改原失败目录权限、不接管现存 runtime。临时源码修改保存为可复跑探针后恢复；依赖 symlink 收尾移回 `.debug/rca`。发布、合并及版本修改均不在范围内。

实际生产源码没有临时修改。原生副本只改入口观测和 catch message；同目录实验自行清理。原 0022 的隔离 Terminal 通过禁止重启的 RuntimeSupervisorClient 正常 stop，日志为 `Original isolated Terminal stop acknowledged.`，随后确认本次 Supervisor PID 1249396 已退出。复跑程序补充采集后自动停止已 live 节点，收尾补充只做语法检查、未重新原生运行。

## 证据与备注

原两条失败时间分别为 `2026-10-10T09:38:57.986Z` 和 `2026-10-10T09:38:58.014Z`。本轮证据将保存到 `docs/references/smoke-reload-autostart/`，仅保留阶段、错误、目录权限与对照结果。

已保存 `runtime-root-preparation-evidence.json`，含原 source hashes、原目录重放、两个 native 配置/节点/异常、首次 mkdir 与后续 mkdir 0700 调用栈、intent/started 数量和清理。具体错误是 `Root runtime global storage must be owned by the current OS user and not writable by others.`。0755/0700 都越过准备，证明 globalStorage 检查不要求精确 0700。

## 接口与依赖

保持 `RootPreparationRequest` / `RootPreparationResult` 与生产代码不变。允许本地构建只读诊断版本，不把诊断版本误当成正式修复。

修订：2026-10-10 创建定位计划，界定证据标准与非修复范围。

修订：2026-10-10 完成原目录及原生因果对照，确认产品初始化/兼容缺口；登记后续资源拒绝，归档定位交付。
