# 隔离升级后的 Supervisor 新会话归属

本 ExecPlan 遵守 `docs/PLANS.md`，持续维护进度、意外与发现、决策记录、结果与复盘。

## 目标与全局图景

升级扩展后，原来运行的 Agent/Terminal 保持原进程与终端身份，新启动执行进入当前发行版本的 Supervisor。Supervisor 是在 VS Code 窗口之外托管 PTY 会话的后台进程。协议兼容允许管理旧会话，不再决定新建是否复用旧实例。必须实际验证旧安装目录删除后的交互，不能只看界面状态。

工作目录为 `/home/users/ziyang01.wang-al/projects/dev-session-canvas.worktrees/runtime-supervisor-release-isolation`，同名分支基于 `origin/main@da207a9f36fbefb7a318c90d67f6d75b6b77b094`。原 worktree 的未提交文件不动。正式方案记录在 `docs/design-docs/runtime-supervisor-release-isolation.md`。

## 进度

- [x] 2026-11-03：fetch origin、创建独立主题 worktree、核对 #360 及已删除文件活动功能。
- [x] 2026-11-03：记录设计、实施步骤和验收范围。
- [x] 2026-11-03：实现发行 generation、旧格式兼容、Host 路由和启动自身份校验。
- [x] 2026-11-03：增加纯函数、Host/握手和真实原生回归，保留修前 namespace 碰撞与旧端 ENOENT。
- [x] 2026-11-03：typecheck、native 构建、common 边界、协议/路径/准备回归通过；Node 22/25 的删旧树真实 PTY 验证通过。
- [x] 2026-11-03：当前发行 native 准备、并发、实际 systemd 启动/复用和自然退役通过。
- [x] 2026-11-03：升级场景接入 source-build 门禁；具名 Host 换版回归接入基础 owner 测试。
- [x] 2026-11-03：最终 owner 基础回归（含 19 项具名 Host 分流/重启用例）、204 项 CI 契约、路径/上下文/重载驱动回归通过；文档链接与索引检查、`git diff --check` 通过。
- [ ] 实际安装 VSIX、真实 Agent/Fork 和 macOS/Windows 升级验收；本轮不安装到用户窗口。
- [x] 2026-11-03 Review 跟进：保存三代 Supervisor 的原始进程清单，退役与清理逐项核对；Node 22/25 均确认 3 个 Supervisor、4 个 provider、4 个 PTY 全部自然消失。
- [x] 2026-11-03 Review 跟进：正式门禁显式固定修前 SHA，导出并构建旧 Supervisor/launcher/provider；Node 22/25 均用固定旧端通过四场景和 schema 2 验真，7 项定向反例通过。
- [x] 2026-11-03 Review 跟进：Node 22 完整 CI 契约 210/210 通过（209.9 秒），文档索引/链接和 diff 空白检查通过。
- [x] 2026-11-03 Review 跟进：HORIZON-OG-Luna 只读复审确认两条 P2 已闭合、无新的确定性 blocker；数字 PID 清理的理论性检查/发送竞态登记为非阻塞后续风险。

## 意外与发现

现场 Host 0.28.0 连接仍运行的 0.26.1 Supervisor，旧目录删除后新 provider 的资源校验失败。原工作分支是 0.27.0，仍有最新主线已删除的文件活动 hook，不能据此扩大范围。

现有 schema 1 owner 严格校验字段，路径消费者约定固定目录层级。采用 generation 同层后缀保留原 descriptor 与目录层级，旧 generation 的解释不变。

首次把 manifest 版本模块放在 common 时，`test:common-dependencies` 正确阻止跨层读取 package.json；已移到 panel 集成层，重新构建/typecheck/边界测试通过，没有放宽边界。

最初原生升级夹具调用了不存在的 `listSessions`，测试失败后改为读取真实 registry 并观察自然退役；最终通过不是强制 kill 后的假成功。随后补齐真实 reader 打开/取消结算、截止时间及 Node 22 执行。

独立未修改主线 worktree `/tmp/dsc-release-isolation-baseline` 同样复现 `test-host-execution-owner-wiring.mjs` 的 `single-root real reset preserves state and owner when preparation cleanup is unknown`：`false !== true`（主线第 534 行）。全文件不是通过状态。该文件既有 root restart 夹具还要求 cleanup 先于 target 解析，但主线早已先解析目标/获取新端，再在提交 create 前结算旧端；本轮将换版测试改为真实已停止节点，保留旧 binding，并验证 create 前必须结算，不改产品顺序。未修改的 root submitted-delete 夹具另有缺少 `pendingNodeDeletionOperations` 的问题；新增门禁只登记与本任务相关的具名测试，不宣称全文件通过，也不删除既有测试。

添加一个 source-build 任务后，CI 数量契约的两处 358 断言如期失败（实际 359）；已随新任务更新，未删测试或放宽完整必跑要求。

Luna 初次 review 无阻塞项，但指出原生测试只验证主进程退出，且正式 CI 用当前二进制的历史 namespace 而非真正旧代码。这两项都不能由旧日志补证；用户授权后新增原始子进程观察与固定修前源码构建，再产生 schema 2 新证据。旧 schema 1 证据不再能通过加强后的门禁。

Luna 跟进复审确认两项闭合，没有复跑测试或发现新的确定性 blocker；其依据是代码审查与本轮实际报告。异常清理的 `signalOriginalProcess` 先读取启动 ticks，再向数字 PID 发信号，两步并非 pidfd 原子操作。受控测试证明已观察到的 PID 复用会被拒绝，但不能证明检查和发送之间绝无复用；正常通过路径不发送信号。本轮不增加新的 native/pidfd 依赖，理论风险保留在技术债中。

## 决策记录

- 决策：按原 PID、启动 ticks 保存三代完整进程清单，退役直接查询原身份而非重新遍历已退出的父进程；僵尸、读取失败和 PID 复用不能冒充确认消失，清理只向再次核对原身份的进程发送信号。理由：Supervisor 退出不能证明 provider/PTY 已退出，错误清理也不得误杀复用 PID。日期/作者：2026-11-03 / 代理，按用户授权修复 Luna review 的两个缺口。
- 决策：原生升级默认从不可变修前提交 `da207a9f36fbefb7a318c90d67f6d75b6b77b094` 导出未修改源码，用当前 lockfile 工具链构建 Supervisor、launcher 和 provider，复用同批已校验 native 资产；正式 gate 显式传入该 SHA 并核对来源与 bundle 摘要，禁止回退当前源码。理由：CI 必须可重建真正修前代码，但不声称复现历史 VSIX 的完整工具链或原发布字节。日期/作者：2026-11-03 / 代理。
- 决策：以 fetch 的 origin/main 开发，不以故障包或原 worktree 开发。理由：用户明确要求，且主线包含新的持久运行资格约束。日期/作者：2026-11-03 / 用户与代理。
- 决策：新执行按发行分配，旧执行完整 binding 不迁移。理由：不中断任务且新执行真正使用新版。日期/作者：2026-11-03 / 用户与代理。
- 决策：generation 使用原协议前缀加发行版本 SHA-256 后缀，不增加 schema/路径层级。理由：复用原存储、端点、锁和路径安全边界。日期/作者：2026-11-03 / 代理。
- 决策：版本随 bundle 打包，启动方验证自身版本。理由：不让旧代码冒认新 owner。日期/作者：2026-11-03 / 代理。
- 决策：不预设缓存旧安装包，不恢复 hook；不扩展 rootless、stock 或同版不同开发构建。理由：只修已证故障并实测剩余磁盘依赖。日期/作者：2026-11-03 / 用户与代理。
- 决策：升级原生测试登记为 source-build 的独立必跑任务，Host 换版用例以具名过滤入口登记到 owner 基础回归。理由：必须消费已构建的真实 native assets；不能让尚未收敛的整个历史 Host 测试文件遮蔽本次回归或假称全绿。日期/作者：2026-11-03 / 代理。

## 结果与复盘

发行分流实现和本地原生升级验证已完成，旧、新及下一发行的 Supervisor 互不共用新建 namespace，旧会话原进程和 terminalAuthorityId 保持。没有增加旧目录缓存，也没有恢复文件活动 hook。用户现有会话和原 worktree 未改动；未安装或发布修复。2026-11-03 用户授权创建 PR，提交前再次 fetch 核对 `origin/main` 仍为 `da207a9f`，本地验证输入未因主线推进而变化；远端 CI 与合并状态以 PR 页面为准，不把本地通过写成远端门禁通过。

正式设计保持验证中：本轮不是完整安装包/真实 Agent/三平台验收。后续按下方安装步骤验收后再收口本计划；完整 Host wiring 的既有失败另行跟踪，不能用本轮定向通过覆盖。

本机验证：`test:runtime-root-ownership` 通过（49 项握手、19/642 项具名 Host 用例），`test:runtime-root-preparation` 通过（23 项准备客户端、28 项准备 worker，另含资格与 systemd 受控回归），Review 增强后的 `test:ci-gates` 在 Node 22 通过 210/210（此前为 204 项）。路径、上下文、reload driver 与 root-owner contract 再跑通过；构建、typecheck、common 边界以及 native Node 22/25 证据见本文。两个证据缺口已有新实测结果，不再依靠当前代码伪旧端或仅主进程退出；没有运行完整远端 Release Preflight，不签发发布验收。

## 上下文与定向

`extensions/vscode/dev-session-canvas/src/common/runtimeRootOwnership.ts` 定义环境/用户/root/generation 的 owner 校验和地址。`runtimeSupervisorPaths.ts` 从 generation 识别原生 profile，把 storage path 哈希为短 socket 和 systemd unit。原格式是 `terminal-root-owner-<platform>-v1`，新格式在其后附加 `-release-<64位小写十六进制>`。

`panel/CanvasPanelManager.ts` 的 `resolveRuntimeCreationTarget` 和 `getRootRuntimeSupervisorClient` 是两类新执行共用入口，`getRuntimeSupervisorClientForKind` 则必须沿旧 binding 连接。`panel/runtimeRootSupervisorPreparation.ts` 向短命 launcher 提交准备，`supervisor/runtimeRootPreparation.ts` 负责排他发现/启动，`runtimeRootOwner.ts` 验证磁盘 owner，`runtimeSupervisorMain.ts` 在 claim 和 registry 清理前加载身份。

`scripts/test/` 已有用 esbuild 打包实际 TS 的测试。`tests/vscode-smoke/` 与 `scripts/smoke/` 有原生和安装产品验证，固定 generation 的断言应改为核对实际安装发行，不得放宽成任意字符串。

## 工作计划与里程碑

### M1：发行身份与启动边界

给 `resolveRootRuntimeSupervisorGeneration` 增加可选版本，严格验证后哈希生成后缀。无版本只表示历史格式。profile 反解接受这两种严格格式，配置指纹保持完整 generation。新增 `panel/runtimeRelease.ts` 随 bundle 保存 package.json 版本，导出当前新建 generation 和启动身份断言；读取 manifest 属于集成层，不能越过 common 依赖边界。Host 新建入口使用当前 generation，launcher/server 在副作用前拒绝不匹配版本，附着不限制为当前版本。

先在原平台纯函数测试加入发行隔离并观察修前失败，再实现并运行该组、路径、握手和准备测试。

### M2：Host 接线和回归

验证两类新建/停止重启选当前发行，旧 session/storage/authority 不变。失败不得探测旧 generation；双窗同版共享，不同发行的地址和原生锁独立。模式切换和 #360 资格检查必须回归，发行隔离不能绕过创建许可。

### M3：实际进程与收口

隔离构建产物和原生资源，用旧 generation 创建真实 PTY。删除该夹具的旧产物后，旧会话仍能回显 nonce、resize、新 reader 重连；旧实例新建失败作为反例。当前发行创建另一实例，再用第二个发行身份重复，以证明连续升级。记录原 Supervisor/provider/PTY child/session/authority，严格停止和最后读者释放后观察正常退出。异常清理与业务成功分账。

若当前机器无 macOS/Windows 或真实安装测试环境，明确保留未执行项和对应自动化用例，不冒称全平台通过。测试不得操作用户实际 ~/.vscode-server runtime。

### M4：补齐 Review 的两个验真缺口

`scripts/test/runtime-release-processes.mjs` 在 `/proc` 中按保存的 PID/startTicks 观察原身份，退役不再依赖父子树仍存在；`runtime-release-baseline.mjs` 导出固定旧源码，复用当前依赖构建三个旧端 bundle，并保留源码、lockfile、native 与 bundle 摘要。`run-stage.mjs` 显式传入固定 SHA，再用 `runtime-release-evidence.mjs` 验证完整旧端来源、11 项原进程退役和最终清理。定向契约必须拒绝仍存活的孤儿、僵尸、复用 PID、未知观察、缺失历史及伪造/退化来源；Node 22/25 实际旧端升级均须通过，随后重跑完整门禁契约与只读复审。

## 具体步骤

以下命令在本计划工作目录执行，使用本分支 lockfile 的依赖。原生构建需要 `generated/execution-assets`，可通过 `DEV_SESSION_CANVAS_EXECUTION_ASSETS_SET` 指向同输入已校验产物，不以 stock 对照冒充原生构建。

    npm ci --ignore-scripts
    npm run test:runtime-root-ownership
    npm run test:runtime-supervisor-paths
    npm run test:runtime-root-preparation
    npm run test:runtime-supervisor-startup-profile
    npm run test:runtime-legacy-reconnect
    node scripts/test/test-canvas-execution-context.mjs
    npm run typecheck
    DEV_SESSION_CANVAS_EXECUTION_ASSETS_SET=/home/users/ziyang01.wang-al/projects/dev-session-canvas/generated/execution-assets npm run build
    npm run test:common-dependencies
    npm run test:runtime-release-native -- --output /tmp/dsc-runtime-release-result.json
    node scripts/test/test-runtime-root-preparation-native.mjs
    npm run test:ci-gates

Review 后默认入口即构建固定修前源码，正式 gate 另显式传入同一 SHA。需要完整 Git 历史中的该提交（source-build checkout 已配置 `fetch-depth: 0`），缺失时失败，不 fetch 浮动分支或回退当前代码。只复制/删除自己创建的临时安装树，源码导出目录在删除旧安装树时也删除，不能借它继续加载旧资源。实际验证命令如下：

    node --test --test-name-pattern='release upgrade' scripts/test/test-gate-contracts.mjs
    PATH=/home/users/ziyang01.wang-al/.nvm/versions/node/v22.23.3/bin:$PATH node scripts/test/test-runtime-release-native.mjs --baseline-commit da207a9f36fbefb7a318c90d67f6d75b6b77b094 --output /tmp/dsc-runtime-release-reviewed-node22.json
    node scripts/test/test-runtime-release-native.mjs --output /tmp/dsc-runtime-release-reviewed-node25.json

`--baseline-extension` 仍可传本地已构建外部目录进行诊断，但只记录 `external-baseline`，不得用于正式 gate。最初 `/tmp/dsc-release-isolation-baseline` 的手工旧端对照仅为历史证据，不是 CI 依赖，也不是旧完整 VSIX。

定向日志在工作目录 `.debug/release-isolation/`；该目录不提交。回归需与本地修改一起重跑，不把这些本机日志当作远端正式验收回执。

## 验证与验收

Review 跟进另增可注入的 `/proc` 观察测试：父退出但原子进程仍活着必须失败，僵尸和未知读取失败不能判 absent，PID 复用不能收到信号；缺少进程清单、错 baseline SHA、当前代码历史 namespace 或强制清理均不得通过门禁。Node 22 原生场景必须实际构建固定旧端、保存旧/当前 bundle SHA-256，三个 runtime 的 3 个 Supervisor 与 8 个 provider/PTY 在业务结束和最终清理时均有消失证据。全部受原工作/清理截止时间约束；这些结果不代替安装级及跨平台验收。

纯函数证明旧格式、发行 A/B 三套 storage/endpoint/unit 独立，同版重复稳定。错误 profile、非法输入和启动版本不匹配不能引发 namespace 或数据清理。Host 证明旧绑定原路由，新执行只选当前发行，失败没有旧地址回退。

真实进程验证升级/删旧树后旧执行身份不变且交互持续，新会话使用新实例；旧实例结算不得伤及并存新执行。证据不记录凭据、环境全文或用户会话正文。实际 Agent、安装包与各平台结果单独列出。

安装级后续验收使用隔离 VS Code user-data/extensions 与测试 root：旧包先启动真实 Agent 和 Terminal，记录原 Supervisor/provider/PTY PID 与启动时间、session/authority/storage；安装包含本修复的新包并重载 Host，只删除这个隔离夹具的旧扩展树。旧执行输入回显、resize、切换视图与重附着必须延续原身份；新节点 Start、旧停止节点 Start、Resume/Fork 的新进程必须进入新 generation。同版第二窗口复用新端，旧端自然退役不影响新端。重复下一版本、错误启动版本/准备失败、rootless/stock 对照、模式切换及 #360 准入限制；在 macOS/Windows 实机分别核验。不得注销开发账号或终止用户现有任务来做验收。

## 幂等性与恢复

构建仅写本 worktree 的 dist。测试随机私有目录注册 cleanup，只结束自己创建并核对身份的资源。删除旧安装树属于夹具输入，不触碰真实扩展。timeout/unknown 不重试业务或擦除启动意图；生产旧 Supervisor 不迁移、不 kill。

## 接口与依赖

保留 `RuntimeOwnerDescriptorV1`、原 binding 和能力协议，不引入新依赖。发行版本从主扩展 manifest 打包，哈希用 Node crypto。profile 反解用于跨发行附着，自身版本断言只用于新建和启动。

## 证据与备注

2026-11-03 初始修订：记录用户确认的分流、最新 origin 基线、发行后缀策略及 hook 已退役的纠正。

2026-11-03 实施修订：记录代码、测试/门禁落点与实际边界。结束前再次 `git fetch origin` 确认 `origin/main` 仍为 `da207a9f36fbefb7a318c90d67f6d75b6b77b094`。

2026-11-03 验证修订：CI 契约重跑 204/204、定向 Host 19/19 与文档一致性通过；保持安装级验收待办，不把剩余范围写成已通过。

Review 后本机 Node 22.23.3 / 25.6.0 原生对照摘要（两次均通过）：

    schemaVersion: 2; baseline.kind: pinned-pre-fix-source
    baseline.commit: da207a9f36fbefb7a318c90d67f6d75b6b77b094
    realPty: true; realAgentCli: false
    cases: deleted-installation-rejects-historical-create,
           release-isolation-and-live-reader-continuity,
           historical-retirement-preserves-new-executions,
           all-fixtures-retire-naturally
    originalProcesses/retirement/cleanup: old=5, current=3, next=3; all absent
    forcedCleanup: []; cleanupErrors: []; cleanup: passed; passed: true

native preparation 摘要：

    Same-owner concurrent helpers converge and ready reuse preserves authority and token.
    Native systemd startup passed and detached preference reused the existing systemd owner.
    Native root preparation passed on linux/x64: real helpers and native namespace, no PTY.
