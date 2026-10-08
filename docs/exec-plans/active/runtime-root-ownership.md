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
- [x] (2026-10-08) P1 准备事务实现：短命持锁 launcher、单次提交 IPC、私有 descriptor 发布和 systemd 实际环境探针；受控测试与正常 build 通过，默认路由未改。
- [x] (2026-10-08) P1 原生竞争/中断：macOS、Windows 完整组通过；Linux detached 汇聚、真实 Host helper、intent 前取消、提交后中断及迟到 ready 通过，systemd 单列未完成。
- [x] (2026-10-08) P1 原生协调最终组：`bd4dab3d` / run `37710935919` 三平台通过，Linux 真实 systemd 启动/复用/idle已通过；Remote 与睡眠/OS 调时等未执行身份场景保留于 P3 证据清单。
- [x] (2026-10-08) P2 主接线：两类单根/多根新建显式 root；metadata/原绑定/缓存/设置边界与正常 build、受控回归已接通。
- [x] (2026-10-08) P2 独立审查修复 restore bucket await 期间换绑定竞态，24 个定向组合先红后绿，原失效 owner 拒绝与原 client 退休屏障保留。
- [x] (2026-10-08) P3 首轮正常同版 package 与 Linux/macOS installed Runtime Terminal/Webview 通过；Windows 路径夹具失败及 Linux 双窗未激活失败原样保留。
- [x] (2026-10-08) 修复两项夹具并同包验证Windows；独立审查三项产品缺口修后受控回归通过，正常build/VSIX通过，待修后原生与安装验证。
- [ ] P3：完成受影响真实多窗口、Agent/Webview、现代三平台与安装包验收、有限资源样本，整体审查并同步结账。

## 意外与发现

本轮独立产品审查确认三处受影响缺口：正常completed严格删除漏传owner，被root校验拒绝；默认false窗口恢复失败后，snapshot-only入口可能绕过原binding启动替身；业务socket仍受XDG/TMP环境改变，稳定owner在另一窗口无法被发现（运行锁仍阻止双启）。这些是产品阻塞，不是通用工具增强。分别补完整owner、Host-owned启动保护及新root固定短端点，沿用原尾部/reader/unknown结算。

P3 run `37711694734` 的 Windows installed 日志直接显示规范化 owner 路径与 realpath 仅大小写不同；严格字符串断言不适用 Windows 路径。修正夹具判定，不改产品词法 root 身份。Linux 双窗口 zip 文件列表没有任何 activated/failure/ready driver 回执，只有 window1；当前安装顺序先建立产品 profile inventory、再直接放入 driver 目录，VS Code 的 inventory 扫描不会自动登记该目录。修复明确加载缺口后仍须真实重试，不能只凭静态定位将失败改绿。

run `37709150155` 的 Linux 原始 stderr 明确为 transient manager 拒绝 `JobTimeoutUSec`，此前缺总线地址的分类没有解释或修复此失败。移除两项 job timeout 属性，改服务 `TimeoutStartSec=10s`，保留运行/停止及调用预算；排队可晚启动的只读 probe 不创建 owner，调用超时保持 unknown。不能把这次参数失败写成环境身份不同或不可用，也不能靠失败后重试弱化参数。

P2 独立审查确认：按原 bucket 等 client 期间节点可能改绑，后续成功/失败必须仍比对 await 前原完整 binding，不能 await 后重新捕获新 metadata 却继续用旧 client。该竞态直接影响 root 绑定正确性，本轮定向修复，不扩展通用并发事务。

设计阶段已经确认 client key 含 backend/storage、已有 namespace claim 与 reader/RPC 屏障可以复用；全局 preferred backend 和窗口默认 storage 才是路由修改入口。环境 API 在 Remote EH 可呈现 file URI/空 authority，因此不能由 URI 或 Webview 决定执行环境。具体平台识别实现及结果在此追加，不预写通过。

当前本地沙箱限制原生子进程与 Unix socket：环境测试受控部分通过，实际双子进程输出为空而 exit 1；既有 protocol 测试在 `listen EPERM` 失败，namespace 首例未取得 claim。保留失败、不跳过原生断言。两个独立工具调用运行在不同 namespace，不能替代同环境双进程验证。

基础自审发现旧 lexical alias 若指向新 root generation，可能绕过 owner 校验进入旧启动路径；已在 canonical root alias 上于任何 claim/cleanup 前拒绝，并补回归。这不是改写旧 binding 或迁移权限。

独立复核又发现保留的 `runtime-roots-v1` 布局中未知或错放的旧 generation 会被当作 legacy。已将保留布局识别与受支持 generation 精确枚举分开，Client/Supervisor 对 lexical 与 canonical alias 均拒绝；新增六个用例确认无 connect/start/claim/cleanup/listen 副作用，旧 registry/journal 不变。

## 决策记录

2026-10-08：审查发现产品阻塞后，取消尚未开始的同包Linux run `37713487916`。Windows夹具定向 run `37713396864` 已success，但它只证明既有断言范围，不证明漏测的Supervisor completed记录已删除。接下来产品修复改变bundle，必须重新正常打包，并补受影响安装/Agent/root端点验收；旧成功的尾部事实保留，不把已知缺口藏在Host bindings=0后面。固定端点选用POSIX UID私有短目录，只对新root代生效，复用已有目录校验，不引入端点数据库。

2026-10-08：同包的夹具定向重试使用 production workflow 原有 reuse_package_run、platform、skip_installed 和 installed_evidence_run；仅增加 root_checks 的固定选择。包身份仍要求产品输入无变化，安装证据仍核对平台具名成功步骤及相同 VSIX hash，允许原 run 因后续另一场景失败。这样保留原失败且不重复成功矩阵，不建立新 runner 或通用诊断阶段。

2026-10-08：先做不会改变默认新建路由的基础增量，取得环境/握手直接证据后再接生产。理由是已选定设计要求未知身份不得启用，不能为了快速更换路径绕过它。P1 不引入用户设置或长期 feature flag；现有入口只在 P2 完整接线后切换。

2026-10-08：身份、环境识别与握手分文件并行实现，主代理负责集成与启动/Host 路由。采用现有 node 脚本测试、VS Code smoke 和 GitHub runner，不另建诊断设施。未改原生资产时不触发重建；若必要修改则只补受影响产物。

2026-10-08：启动准备复用短命 launcher 和独立 namespace，不在 EH 持 macOS one-shot native claim、不改 native 资产。采用每 token 唯一提交、持运行锁的主体发布 started 回执、后继正面探运行锁的结算方式，避免引入 PID 追踪。缺回执的 pending 保留 unknown；started 不代替 ready/终态/尾部结算。完整约束见设计 §4.3，实施与真实竞争验证尚未完成。

2026-10-08：systemd 范围验证使用实际 transient launcher probe，不使用 D-Bus PID 对照本地 `/proc` 的推断，避免跨 PID namespace 的坐标混淆。只增加固定的 probe 模式、nonce/摘要核对及有限 job/运行预算，不新增常驻服务。Host 30 秒结算不当作 helper 退出证据；真实测试观察 close 或实际 claim 释放。

## 结果与复盘

P1 身份/握手/准备事务的三平台原生协调已通过，包括 Linux 真实 systemd；P2 已切换两类默认新建并保留旧 binding，正常 build、受控回归及具名 restore 竞态修复通过。P3 同版包及 Linux/macOS installed Terminal/Webview 已通过，多窗口、真实 Agent、Windows 安装与剩余具名场景仍未完成，F-03 保持开放。历史失败和本地沙箱限制原样保留，不追认通过。

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

测试使用本轮私有目录和会话，清理只处理可证明归属的资源；不改用户 registry、旧节点或系统服务。P2 正常新建采用独立 root generation；rootless/显式 stock 及旧 binding 保持原址，未通过的产品格继续开放。版本回退保留实际原绑定，不通过改 metadata 或 kill 旧 owner 恢复工作区。未知启动责任保留并 fresh 观察，不按文件年龄清空。

## 证据与备注

设计 PR #297 当前 OPEN；实现分支包含其已认可文档，不自动 merge。后续将定向命令、结果、原生与受控证明范围写入本节及正式设计，不建立新的证据归档体系。

本地执行：`node scripts/test/test-runtime-root-ownership.mjs`、`node scripts/test/test-runtime-supervisor-paths.mjs`、`node scripts/test/test-runtime-root-owner-handshake.mjs`（25 受控项，Windows 不含三个 POSIX 权限用例）、`npm run test:runtime-supervisor-startup-profile`（16+31）、`npm run typecheck`、`npm run build` 和 `git diff --check` 通过。`test-runtime-execution-environment.mjs` 先报告 synthetic cases passed，再在双原生子进程无输出断言 exit 1；`test-runtime-supervisor-protocol.mjs` 为 socket EPERM；namespace 首例无 claimant，均不计通过。

新增 `.github/workflows/runtime-root-ownership.yml` 仅在本实现分支相关 push 或手动入口跑三现代平台的基础测试/typecheck，不含 Agent 凭据或旧原生矩阵。`6688c21e` / run `37657913544`：Ubuntu 24.04/Node 22.23.3、macOS 26.6.2 arm64/Node 22.23.2 的真实父子 probe、25 受控握手及 typecheck 首次通过；Windows Server 2025/Node 22.23.3 首次 probe 约 10 秒失败。仅请求 rerun-failed-jobs 后，attempt 2 的 Windows 双子 probe、22 受控握手和 typecheck 通过，其他平台沿用原成功。预算和代码未变，原失败不改，尚不能定位偶发失败的确切原因。

启动记录增量本地验证：`node scripts/test/test-runtime-root-startup.mjs`（私有临时文件与原子失败）、`node scripts/test/test-runtime-root-owner-handshake.mjs`（36 受控项）、`npm run test:runtime-supervisor-startup-profile`（18+31）、typecheck、普通 build 和 diff check 通过。同 token 第二个新 server 即使取得受控 claim，也不消费第二次、不触碰重新写入的 registry/journal 哨兵。新 root systemd storage 显式创建 0700；旧路径 mkdir/命令/环境参数保持原样。

启动记录提交 `d1fe71e7` / run `37661131732` attempt 1 三平台成功：父子身份 probe、真实临时文件记录测试、Linux/macOS 各 36 及 Windows 32 个受控握手/启动用例、typecheck 均通过。未运行真实 startup-preparation 竞争，因为该入口尚未实施；不把该 CI 当作完整 P1 或产品验收。另跑 `test-legacy-runtime-history.mjs` 为 116 项通过，原有 2 个 Unix socket 用例因环境拒绝访问而按现有脚本跳过，不计原生通过。

准备事务本地增量：`test-runtime-root-owner-storage.mjs`（真实私有文件）、`test-runtime-root-preparation-client.mjs`（19 受控项）、`test-runtime-systemd-environment.mjs`（33 受控项）、`test-runtime-root-preparation.mjs`（24 受控项）、原 startup/reader 18+31、typecheck、普通 build 通过。聚合入口为 `npm run test:runtime-root-preparation`。本机 user bus 为 EPERM，不记录 systemd 原生通过。接下来只增加真实 owner 竞争/复用/退役的有限测试，复用 run `37479044769` / 原资产 SHA `2bdfc311a2fcf4911c09a5bbf86c35579dc12522`；资产源码未变，assembler 继续验证来源，不重跑六架构构建。

`test-runtime-root-preparation-native.mjs` 使用正常 build 的 launcher/Main，覆盖同 root 两准备进程收敛、已有 owner 复用、不同 root 隔离、真实运行锁占用、闲置退出后新 token。Linux 先做实际 systemd probe；可用时验证新建/跨偏好复用，明确 unavailable 则单列 not-verified，unknown 失败。清理仅在 helper close、正面运行锁释放和本轮 systemd unit inactive 后处理具名资源，不 kill 未知进程。pending 场景是磁盘夹具，不能代证真实提交中断。本地执行在 launcher 环境预检得到空 stdout 而失败，尚未提交任何 Supervisor；保留这个结果，由三平台 CI 取得实际协调证据。复用资产的原 run 总结果为 failure，六个 native-assets job 与 package 均为 success，只复用这些原生产物，不追认原 run 整体验收。

提交 `d72b90e2` / run `37706950213`：三平台正常装配/build、受控准备与 typecheck 通过，macOS/Windows 的真实协调全组通过；Linux 已通过同 owner 并发/复用，在 systemd probe 返回 `unknown/environment-probe-failed` 后失败，正常闲置清理完成。该日志没有原 stderr，因此不能把根因预写为总线地址缺失。另行本地定向复现了 systemd 的完整 `$DBUS_SESSION_BUS_ADDRESS and $XDG_RUNTIME_DIR not defined` 固定错误行；新增只匹配这行的 unavailable 分类（独立 reason `user-bus-address-missing`），38 受控测试通过，其他权限/超时/附加诊断继续 unknown。

后续仅补 R1-03 已列出的两例真实中断：临时测试 launcher 在明确 barrier 暂停，intent 前断 IPC并等 helper close；detached 已提交、Main 尚未取得运行锁时终止本轮直接跟踪的 helper，核对 pending 不重复提交、迟到 ready 后复用同 token/PID。原磁盘夹具仍独立保留，真实场景不等同完整 EH crash。wrapper 用既有运行锁原语确认退出，没有生产测试 hook 或新诊断框架；本地仍在原预检处失败，两例待 CI，不写成已通过。

提交 `a11020a5` / run `37707854830` 三平台在新增中断验证失败（Linux/macOS 明确为取消后的 aggregate close 等待超时；Windows 原失败待核对日志）。最小真实 fork 复现及 Node 实现核对表明父方主动 disconnect 后，进程 exit、stderr close、IPC disconnect 均可发生而 aggregate close 不再触发。此问题也影响 Host `prepareRootRuntimeSupervisor()` 的成功结算，不只是测试：本轮修为接受标准 close，或明确观察上述三事实全齐，仍按原 30 秒总预算和 1 秒退出预算。少任一事实仍 unconfirmed，不增加时限、不把 exit 单独当释放。新增两项受控测试（总 21），正常 native 测试同时调用真实 Host helper API覆盖此路径，后续 CI 待验证；不追认原失败。

最新增量本地：Host wiring 250 项（含两类18项 root 创建/跨 await/stale/unknown 回归）、Canvas context、Host deactivation、completed 无历史、typecheck、普通 build 通过。默认 false 的新窗口恢复 root live 不触发转换；显式关闭持久化仍严格清理，失败不 dispose。已有 loadState 实测受控路径足够，无新增配置 receipt。未把这些回归计作真实多窗口/Agent/Webview 通过。

原生 `37708504120` 因测试 bundle 未导出 Host helper API失败，修复夹具后 `37708720165` 与 `37709150155` macOS/Windows通过；Linux已走过真实中断组但 systemd 失败。`37709150155` 捕获 manager 拒绝 JobTimeoutUSec 的直接原因，40项受控系统探针和24项协调用例修后通过，仍需新 CI。上述失败独立保留，不追认绿色。

`4be42817` / run `37709897962` Linux scope probe 返回 code 0 并判 available，修复了属性拒绝；随后 systemd owner 启动返回 preparation/submission unconfirmed，未得到具体底层错误。测试保留原私有目录与 unit，没有强制清理未知 Supervisor。下一步只定位该已触发的 startup 错误，不把 probe 成功记作 systemd owner 已通过。

随后本机 systemd 249 `systemd-analyze verify` 对照确认共享 unit renderer 的独立语法错误：`WorkingDirectory="/tmp"` 与带空格的 quoted 路径均 exit 1/fatal，未加引号的 scalar 路径均 exit 0。已窄修该字段，保留 ExecStart 引号及 `%` 转义，CR/LF/NUL 在写 unit/调用 systemctl 前拒绝；参数29项和协调24项回归通过。新原生失败分支仅记录本轮具名 unit 的 LoadError 等状态，不改原断言，尚不把此本机结论冒充旧 CI 根因已最终确认。

P2 提交 `2d3d4f82` 已 rebase 到 `origin/main@357266ad`（0.26.0 发布），无冲突；正常 typecheck、build 与 `npm run package:vsix` 通过。P3 增量仍在准备，当前包不计安装或真实 Agent 验收通过。

`bd4dab3d` / run `37710935919` 三平台原生最终组全绿，Linux日志明确记录 native systemd startup passed、detached preference reused existing systemd owner，以及闲置退出和正面claim释放后替换；不含PTY。此前两次systemd失败保持原结论，不删除或改绿。

P3 第一组固定执行：`gh workflow run runtime-production-acceptance.yml --ref runtime-root-ownership -f reuse_native_run=37479044769 -f platform=all -f installed_mode=live-runtime -f root_ownership=true`。工作流重新产出同版VSIX，不复用旧产品；三平台仅跑已装Runtime Terminal/Webview，Linux跑新双窗口三root及真实Codex/Claude创建重连。`run-vscode-root-owner-candidate.mjs` 六分钟上限、独立安装测试扩展、同一user-data/profile和实际两EH；未选择故障注入、旧slot、设置差异、remove/readd，不将这些遗漏计作通过。每CLI两轮真实nonce、无工具、无自动重试，不重跑八场矩阵。完成后按R1-01至08核对剩余，不自动加新阶段。

P3 本地受控：Agent reload 21项、安装包输入/收据18项、新双窗口合同39个拒绝场景及staging/真实stdin subject通过；不计实际VS Code。双窗口关闭旧EH后由存续multi保存完整画板再重开，避免把原有跨窗口整图覆盖问题混作本次运行时归属；此顺序显式记入输入/回执，不声称并发保存仲裁已解决。工作流测试的真实Bash子进程在本地沙箱挂起，主动终止exit130；仅以受控stub核对workflow选择/凭据/产物契约通过，不将stub当Bash语法验证，CI package中运行原完整测试。

P3 首轮 `7741de5d` / run `37711694734` package 成功，Linux/macOS installed Runtime Terminal/Webview 成功，Windows路径断言失败、Linux双窗driver未激活失败，真实Agent未运行。本机 VS Code 1.117 的隔离CLI对照确认旧install→stage顺序的profile只登记产品，新stage→install顺序同时登记driver和产品；修正顺序并在原input保存具名driver登记结果，不改变业务扩展或注入metadata。对照目录为 `/tmp/root-owner-profile-old-order-kxBhDO` 和 `/tmp/root-owner-profile-order-EtWHDq`，这是scanner证据而非完整产品验收。

本次补证：安装包夹具19项、双窗口原39个拒绝项及6项登记/顺序拒绝、Canvas context与纯root ownership通过。R1-01新增两类节点共12组root顺序/显示名变化，及两类rootless→folder仍attach旧slot的完整binding断言；均为受控Host，不代证Remote或真实EH。workflow选择/凭据门控受控断言通过，20个生产Bash步骤用直接 `/bin/bash` 原生语法检查通过；原完整Node测试仍在spawnSync Bash处超时124，未记通过。产品输入不变，后续复用首轮原VSIX只重试失败/缺失格。

随后独立审查的产品修复已通过：completed-history两类×新旧binding 4项实际经过生产strict-delete校验，缺owner先红后绿；Host本地入口14项先红后绿，总wiring264项通过；Canvas context、deactivation与typecheck通过。端点paths、握手46项、preparation25项、storage、startup29项、reader/client31项与preparation-client21项通过；握手覆盖只读连接/strict-delete在不安全UID目录无副作用拒绝，Main在socket清理前拒绝。独立复核无新增确定blocker，正常build与package:vsix通过。安装夹具20项加入目标registry删除检查，真实POSIX跨XDG/HOME/TMP helper复用写入已有native脚本，均待修后CI。未更改native资产，禁止将旧包结果当作新字节已验证。

## 接口与依赖

`RuntimeOwnerDescriptorV1` 固定 schema/environmentKey/userStorageScopeKey/root/generation；路径 resolver 接受 canonical global storage 与已解析 root，不接受 Webview 自报 path。环境 helper 返回摘要及本机用户身份，失败抛出明确错误；Windows 可使用系统自带进程调用只读 native API，若能避免修改 PTY 资产则优先采用。hello owner 字段对旧 binding 可缺省，对新 root generation 必须校验。具体导出签名在 P1 实现后补齐。

修订记录：2026-10-08，按用户认可方案开始实施，固定三包与最小改动约束。

修订记录：2026-10-08，基础实施独立复核补保留目录拒绝规则；记录 25 项受控结果，原生身份、启动准备与产品验收仍开放。

修订记录：2026-10-08，登记三平台基础 CI 与 Windows 原失败；推进启动 token/receipt，不将文件与受控 Main 验证冒充真实启动排他已交付。

修订记录：2026-10-08，切换 P2 创建与原绑定接线，记录异步 restore 修复；有限 P3 复用安装包和真实 Agent runner，新增同一存储范围双窗口场景。systemd 保留未确认结果与直接定位待办。

修订记录：2026-10-08，登记P3首轮部分成功与两项夹具失败，修复profile加载/Windows路径断言，补R1-01缺项及同包定向入口；不重新打包、不扩大通用工具验收。
