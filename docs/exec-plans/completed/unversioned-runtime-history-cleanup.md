# 清理无 generation 的旧 Runtime 历史节点

本 ExecPlan 按 `docs/PLANS.md` 持续维护，覆盖本次有限修复、验证与交付。

## 目标与全局图景

用户诊断包 `2026-10-08T04-09-28-237Z` 的 Agent 会话 `7db0bb3f-7499-401d-a895-be47b507fbc7` 与 `ee2e3793-fa87-4387-812c-c6187944bba9` 无法删除。两者在 Host 中为 history-restored/liveSession:false，原 version1 registry 为 live:false/stopped/recoveredHistoryOnly，但存储路径没有 runtime-supervisor-generations 层，被既有历史检查直接拒绝。修复后，原运行环境重新确认 Supervisor 缺席且无在途责任时，用户可沿原入口删除、清空或重新启动这类节点。

## 进度

- [x] (2026-10-08) 从最新 origin/main 创建 runtime-unversioned-history-cleanup；定位原始路径资格缺口。
- [x] (2026-10-08) 明确有限布局、目标记录和 Host 责任保护，写入正式设计。
- [x] (2026-10-08) 原实现首个新增用例返回 undefined；补普通及 indexed slot 与路径、活跃/未知拒绝用例。
- [x] (2026-10-08) helper 136项、native 40项、Host 定向149/149、typecheck通过；两个原始记录只读核验均取得 detached-recovered-history，registry hash 不变。
- [x] (2026-10-08) 完成类型、默认构建、调试 staging/config 和文档收口，修复已具备提交/MR条件。

## 意外与发现

已安装 0.26.0 和 origin/main 均只允许两个旧 generation。前轮受控对照仅改变目录布局就从 detached-recovered-history 变成 undefined，进程和 socket 检查次数为零。本次之前的只读探测中两个原 socket 分别 ECONNREFUSED、ENOENT；诊断包没有当次删除的内部 reason，不能补写成已捕获的失败原因。

Host 首跑因 node_modules 缺少固定 xterm serialize 补丁而无法装载，运行仓库 ensure-xterm-serialize-patch 脚本后通过；首个默认 build 因本工作树缺少 generated/execution-assets 失败。使用已安装0.26.0的六目标原生资产，先以 readPackagedExecutionAssetSet 校验当前 owner/patch 源码及二进制 hash，再复制到默认 generated 路径。两项环境失败分别保留，未改断言、切 stock 或修改原生源码。

## 决策记录

2026-10-08：只为 Linux legacy-detached 增加已知原始 workspaceStorage/<slot>/devsessioncanvas.dev-session-canvas/runtime-supervisor 布局，slot 不要求固定 hash 或编号；不将任意未知 generation 或 systemd 无 generation 路径放行。复用原精确 registry/结构化标记、canonical 路径、前后进程/socket观察及 Host 身份保护，不增加返回结果类型。用户已同意纯历史本地清理；不要求故障 Supervisor 补 RPC 确认，不据断连推断子进程退出。

## 结果与复盘

路径修复、受控行为验证、默认构建与调试 staging/config 已完成，两个真实旧记录在同机、使用原 Host endpoint 环境的只读核验中均通过，registry SHA256 前后相同。实际 Host 入口的149项为受控依赖的非原生验证；用户窗口实际删除未执行，已登记技术债。未修改用户节点、registry、socket、服务或已安装扩展，未重跑无关全量测试/跨平台原生矩阵。

## 上下文与定向

`extensions/vscode/dev-session-canvas/src/panel/legacyRuntimeHistory.ts` 的 inspectStoppedLegacyRuntimeSession 只读核验原存储，返回 detached-recovered-history 表示可以解除本地历史绑定。`CanvasPanelManager.ts` 的 prepareStoppedLegacyHistoryRetirement 在该检查前后复核节点身份、读者、创建和删除责任，deleteRuntimeSupervisorSessionsWithCandidate 决定历史解绑或严格删除 RPC。RPC 是发给原 Supervisor 的远程请求；结果未知时仍保留原绑定。

## 工作计划

里程碑一：在正式设计第12节说明新布局，扩展 `scripts/test/test-legacy-runtime-history.mjs` 的临时目录夹具，先证明旧实现拒绝合法历史。里程碑二：只修改 helper 路径准入，扩展 `scripts/test/test-host-execution-owner-wiring.mjs` 的 detached 实际 Host 入口用例到两类 slot，并验证未提交失败后重试与原保护。里程碑三：运行定向回归与正常构建，同步结果后归档计划、提交并创建 MR。

## 具体步骤

全部命令在仓库根运行：`node scripts/test/test-legacy-runtime-history.mjs`、`node scripts/test/test-native-runtime-history.mjs`、`DEV_SESSION_CANVAS_HOST_TEST_FILTER='^detached |^native |stopped legacy|stopped history|batch history|ended unsubmitted delete|^B2 |^S9 |^production |^pending final persistence' node scripts/test/test-host-execution-owner-wiring.mjs`。然后执行 `npm run typecheck`、`npm run build`、`npm run prepare:debug-main-only-extension` 和 `node scripts/test/test-debug-launch-config.mjs`。日志放 `.debug/unversioned-history-*.log`；首次失败和后续通过分别保留。

## 验证与验收

普通/indexed slot 的 Agent/Terminal 恢复记录均可通过只读检查；受控 Host 删除/重启/清空成功且不伪造退出信息。live、缺 descriptor、重复目标、原 Supervisor 存在或进程/socket观察未知、路径别名、错误 backend、registry 变化继续拒绝。原 submitted unknown、reader、finalization 保护仍通过。构建成功不代证用户窗口操作或跨平台原生验证。

## 幂等性与恢复

测试只写临时目录，helper 不改变用户共享数据。操作失败保留原绑定，下次显式操作重新检查；已提交未知操作不重发。调试 staging 更新后重新启动 F5 加载；本次不安装发布版或操作用户节点。

## 证据与备注

前轮两项受控对照通过：terminal-stream-v1 返回 detached-recovered-history；无 generation 返回 undefined、scans=0、sockets=0。本轮先红日志为 `.debug/unversioned-history-helper-before.log`，修后136项为 `-helper-after.log`，native40项为 `-native.log`；本环境3项真实socket/claim用例均执行通过，无跳过。Host装载首败为 `-host.log`，补齐依赖后的定向149/149为 `-host-after-setup.log`（选中149/250、非原生边界），typecheck为 `-typecheck.log`。原现场只读结果在 `-field-readonly.log`，没有发 stop/delete 请求或写用户registry。默认build首败在 `-build.log`，环境补齐后通过为 `-build-after-setup.log`，staging/config 为 `-debug-prepare.log`、`-debug-config.log`；以上后缀均以 `.debug/unversioned-history` 开头。最终 diff 检查通过。

## 接口与依赖

保持 inspectStoppedLegacyRuntimeSession(backend, session, signal?) 和现有证据 union，不新增依赖、进程管理或清理 API。正式结论进入 `docs/design-docs/runtime-persistence-closeout.md` 第12节，残余验证边界登记 `docs/exec-plans/tech-debt-tracker.md`。

修订记录（2026-10-08）：基于已定位现场制定无 generation 历史清理计划，先验证再实现，保留旧保护。

收口记录（2026-10-08）：完成有限实现、先红后绿、同机现场只读核验与正常构建，记录依赖/资产缺失的首败和补齐后的通过；归档并保留实际窗口删除验收边界。
