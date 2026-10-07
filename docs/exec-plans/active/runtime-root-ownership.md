# 实现 root 稳定的 Runtime 归属

本 ExecPlan 按 `docs/PLANS.md` 维护。用户于 2026-10-08 认可 `docs/design-docs/runtime-root-ownership.md` 并要求开始实施、不要添加不必要设计。实现分支 `runtime-root-ownership` 从 `origin/main@06e9abcf` 建立，带入尚未合并的设计 PR #297 提交；不擅自合并该 PR。

## 目标与全局图景

同一 root 在单根与不同多根窗口中创建 Terminal/Agent 时，应进入同一执行环境、用户存储范围、root 身份及 generation 决定的 Supervisor。不同 root 按需使用不同 owner，旧 live 沿原 backend/storage/session/kind 操作。owner 是逻辑归属，不是永久 PID；OS 重启不承诺恢复进程或历史，VS Code/SSH 重连不改变仍在运行环境的身份。

本计划严格采用设计的 P1、P2、P3 三个包，不另建发现服务、通用锁框架、诊断框架、历史 GC 或画板多写者事务。若现有机制足以满足不变量，则直接复用。尾部消费、最终状态、reader/RPC 责任与 unconfirmed 保护不能因改归属放宽。

## 进度

- [x] (2026-10-08) 核对设计授权、最新 main 和干净工作区，建立实现分支，带入设计。
- [x] (2026-10-08) P1 基础代码：纯身份/路径、执行端环境识别、独立 generation 与 owner 握手已实现；默认创建路由未改。
- [x] (2026-10-08) 三平台原生父进程/双子进程身份一致 probe：`6688c21e` / run `37657913544`，Windows 首败保留、相同预算失败项重试通过。
- [x] (2026-10-08) P1 启动记录：私有 intent/started、claim 前匹配与 claim 后发布、单 token 拒绝重复消费；提取原有底层启动命令供准备流程复用。
- [ ] P1 剩余：启动准备排他事务、systemd manager 范围核对和真实竞争/中断后判定；平台 probe 不代证这些保护。Remote 与睡眠/OS 调时等身份场景在受影响产品验收中补证。
- [ ] P2：接入单根/多根 Agent/Terminal 创建、backend 发现、客户端缓存与退役；保留原绑定与设置语义。
- [ ] P3：完成受影响真实多窗口、Agent/Webview、现代三平台与安装包验收、有限资源样本，整体审查并同步结账。

## 意外与发现

设计阶段已经确认 client key 含 backend/storage、已有 namespace claim 与 reader/RPC 屏障可以复用；全局 preferred backend 和窗口默认 storage 才是路由修改入口。环境 API 在 Remote EH 可呈现 file URI/空 authority，因此不能由 URI 或 Webview 决定执行环境。具体平台识别实现及结果在此追加，不预写通过。

当前本地沙箱限制原生子进程与 Unix socket：环境测试受控部分通过，实际双子进程输出为空而 exit 1；既有 protocol 测试在 `listen EPERM` 失败，namespace 首例未取得 claim。保留失败、不跳过原生断言。两个独立工具调用运行在不同 namespace，不能替代同环境双进程验证。

基础自审发现旧 lexical alias 若指向新 root generation，可能绕过 owner 校验进入旧启动路径；已在 canonical root alias 上于任何 claim/cleanup 前拒绝，并补回归。这不是改写旧 binding 或迁移权限。

独立复核又发现保留的 `runtime-roots-v1` 布局中未知或错放的旧 generation 会被当作 legacy。已将保留布局识别与受支持 generation 精确枚举分开，Client/Supervisor 对 lexical 与 canonical alias 均拒绝；新增六个用例确认无 connect/start/claim/cleanup/listen 副作用，旧 registry/journal 不变。

## 决策记录

2026-10-08：先做不会改变默认新建路由的基础增量，取得环境/握手直接证据后再接生产。理由是已选定设计要求未知身份不得启用，不能为了快速更换路径绕过它。P1 不引入用户设置或长期 feature flag；现有入口只在 P2 完整接线后切换。

2026-10-08：身份、环境识别与握手分文件并行实现，主代理负责集成与启动/Host 路由。采用现有 node 脚本测试、VS Code smoke 和 GitHub runner，不另建诊断设施。未改原生资产时不触发重建；若必要修改则只补受影响产物。

2026-10-08：启动准备复用短命 launcher 和独立 namespace，不在 EH 持 macOS one-shot native claim、不改 native 资产。采用每 token 唯一提交、持运行锁的主体发布 started 回执、后继正面探运行锁的结算方式，避免引入 PID 追踪。缺回执的 pending 保留 unknown；started 不代替 ready/终态/尾部结算。完整约束见设计 §4.3，实施与真实竞争验证尚未完成。

## 结果与复盘

P1 身份与握手基础、三平台基础 probe、启动记录与 Main 消费顺序已实现，默认创建及原 slot 路由保持。本地沙箱限制原样记录；三平台基础 CI 已取得结果，Windows 首次 probe 失败不追认。后续受控启动记录/握手与原启动回归通过，但它们不验证真实准备锁竞争。P1 启动准备事务与 P2/P3 未完成，F-03 保持开放。

## 上下文与定向

`extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts` 负责创建、恢复和 Host 生命周期；`common/runtimeSupervisorPaths.ts` 定义 generation/端点派生，`runtimeSupervisorProtocol.ts` 定义握手；`panel/runtimeSupervisorClient.ts` 负责连接/启动，`runtimeHostBackend.ts` 负责 detached/systemd；`supervisor/runtimeSupervisorMain.ts` 持有会话与终端资源，`runtimeSupervisorNamespace.ts` 提供运行期排他。新增纯模块 `common/runtimeRootOwnership.ts` 与执行端 `panel/runtimeExecutionEnvironment.ts` 只承接所需身份逻辑。

## 工作计划

P1 先固化版本化 descriptor、词法 root 和用户存储 hash，再实现有界环境读取，新增独立 generation 而不修改旧路径含义。握手和 Supervisor 启动核对 owner，不能仅相信 Host 传入的 hash。测试必须包含稳定/不同 root、Windows path/UNC、环境未知、旧 hello 拒绝及旧路径兼容。启动准备的排他与运行期 claim 分开，但优先借现有原语，不做可扩展通用协调器。

P2 将两类 start 方法改为传明确 node root，缓存按 owner 分桶；旧绑定 API 保持显式 path，已有 live 重连不启动替身。发现先探现有 backend，不因连接超时生成第二 owner。Host/root 移除只结算本窗口责任，明确 clear/delete 仍按精确绑定。只修接线中可证明的配置/退休问题，不顺手重构整个 Manager。

P3 复用设计 §7 的 R1-01 至 R1-08，按具体改动执行最小受影响集合。真实双窗口需要各自新建而非只 attach；旧 slot 中 A/B 与新 root 并存，隔离夹具故障 A 不影响 B。最终同版 VSIX 跑现代三平台创建/恢复，真实 Codex/Claude 只补路由与重连；未改变 PTY/序列化则复用原证据。三 root/双窗口记录新增进程成本，不压旧 64/128 MiB 观察阈值。

## 具体步骤

所有命令从仓库根执行。P1 用现有 `scripts/test/` 风格新增定向 Node 测试，并运行 `npm run test:runtime-supervisor-paths`、`npm run test:runtime-supervisor-protocol`、`npm run typecheck`；新增测试命令在实现时登记。平台 probe 在临时私有目录/隔离进程中运行，不读取用户节点或修改真实服务。P2 补既有 Host/Supervisor wiring 回归并正常构建；P3 使用已有 smoke/CI 入口，记录确切 ref 与产物，不把受控测试报告成真实页面通过。

## 验证与验收

可观察结果是两个窗口为同一 root 分别新建后 owner/storage 相同、session 各自独立，另一 root owner 不同；关闭窗口后另一窗口仍能输入，重新打开沿原会话和当前终端状态恢复。未知身份/启动结果不能创建替身，旧 live 路径不改、尾部结算不提前释放。P1 平台读取须同环境双进程相等、缺值/权限失败拒绝；CI 没运行的格保持未验证，不用合成平台夹具代证。

## 幂等性与恢复

测试使用本轮私有目录和会话，清理只处理可证明归属的资源；不改用户 registry、旧节点或系统服务。实施期间不更换正常默认 generation，直到接线与必要身份验证满足 P2 门槛。版本回退保留实际原绑定，不通过改 metadata 或 kill 旧 owner 恢复工作区。未知启动责任保留并 fresh 观察，不按文件年龄清空。

## 证据与备注

设计 PR #297 当前 OPEN；实现分支包含其已认可文档，不自动 merge。后续将定向命令、结果、原生与受控证明范围写入本节及正式设计，不建立新的证据归档体系。

本地执行：`node scripts/test/test-runtime-root-ownership.mjs`、`node scripts/test/test-runtime-supervisor-paths.mjs`、`node scripts/test/test-runtime-root-owner-handshake.mjs`（25 受控项，Windows 不含三个 POSIX 权限用例）、`npm run test:runtime-supervisor-startup-profile`（16+31）、`npm run typecheck`、`npm run build` 和 `git diff --check` 通过。`test-runtime-execution-environment.mjs` 先报告 synthetic cases passed，再在双原生子进程无输出断言 exit 1；`test-runtime-supervisor-protocol.mjs` 为 socket EPERM；namespace 首例无 claimant，均不计通过。

新增 `.github/workflows/runtime-root-ownership.yml` 仅在本实现分支相关 push 或手动入口跑三现代平台的基础测试/typecheck，不含 Agent 凭据或旧原生矩阵。`6688c21e` / run `37657913544`：Ubuntu 24.04/Node 22.23.3、macOS 26.6.2 arm64/Node 22.23.2 的真实父子 probe、25 受控握手及 typecheck 首次通过；Windows Server 2025/Node 22.23.3 首次 probe 约 10 秒失败。仅请求 rerun-failed-jobs 后，attempt 2 的 Windows 双子 probe、22 受控握手和 typecheck 通过，其他平台沿用原成功。预算和代码未变，原失败不改，尚不能定位偶发失败的确切原因。

启动记录增量本地验证：`node scripts/test/test-runtime-root-startup.mjs`（私有临时文件与原子失败）、`node scripts/test/test-runtime-root-owner-handshake.mjs`（36 受控项）、`npm run test:runtime-supervisor-startup-profile`（18+31）、typecheck、普通 build 和 diff check 通过。同 token 第二个新 server 即使取得受控 claim，也不消费第二次、不触碰重新写入的 registry/journal 哨兵。新 root systemd storage 显式创建 0700；旧路径 mkdir/命令/环境参数保持原样。

## 接口与依赖

`RuntimeOwnerDescriptorV1` 固定 schema/environmentKey/userStorageScopeKey/root/generation；路径 resolver 接受 canonical global storage 与已解析 root，不接受 Webview 自报 path。环境 helper 返回摘要及本机用户身份，失败抛出明确错误；Windows 可使用系统自带进程调用只读 native API，若能避免修改 PTY 资产则优先采用。hello owner 字段对旧 binding 可缺省，对新 root generation 必须校验。具体导出签名在 P1 实现后补齐。

修订记录：2026-10-08，按用户认可方案开始实施，固定三包与最小改动约束。

修订记录：2026-10-08，基础实施独立复核补保留目录拒绝规则；记录 25 项受控结果，原生身份、启动准备与产品验收仍开放。

修订记录：2026-10-08，登记三平台基础 CI 与 Windows 原失败；推进启动 token/receipt，不将文件与受控 Main 验证冒充真实启动排他已交付。
