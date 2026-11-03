---
title: Runtime Persistence 的登录独立性与成熟托管方案
decision_status: 已选定
validation_status: 验证中
domains:
  - VSCode 集成域
  - 执行编排域
  - 项目状态域
architecture_layers:
  - 宿主集成层
  - 共享模型与编排层
  - 适配与基础设施层
related_specs:
  - docs/product-specs/runtime-persistence-modes.md
related_plans:
  - docs/exec-plans/completed/runtime-persistence-sidebar-routing.md
  - docs/exec-plans/completed/runtime-persistence-automatic-guide-check.md
  - docs/exec-plans/completed/runtime-persistence-disable-guide.md
  - docs/exec-plans/completed/runtime-persistence-setup-completion.md
  - docs/exec-plans/completed/runtime-persistence-walkthrough.md
  - docs/exec-plans/completed/runtime-persistence-linger-implementation.md
  - docs/exec-plans/completed/runtime-persistence-login-independence-design.md
updated_at: 2026-11-03
---

# Runtime Persistence 的登录独立性与成熟托管方案

## 正式方案

侧栏入口方向（2026-11-03 用户确认）：稳定已开启时点击进入关闭引导，稳定已关闭时进入开启引导；配置与当前窗口模式不一致时继续完成原方向。requested/applied 的 true/true、false/true 进入关闭，false/false、true/false 进入开启。实际 Manager 模式而非复选框、系统资格或运行会话数量决定方向；系统异常不代表现存模式已关闭。侧栏通过内部路由命令 `devSessionCanvas.__internal.openRuntimePersistenceGuide` 调用 `CanvasPanelManager.openRuntimePersistenceGuide`，在点击时读取最新模式，避免沿用过期 TreeItem 的方向；明确的配置/关闭命令保持原有语义。`CanvasSidebarView.getRuntimePersistenceSummaryItem` 区分已开启、已关闭、待开启、待关闭与后台保障异常，悬浮提示说明点击动作；右键另有配置后台持久运行入口供修复，不要求用户先关闭才能修复。主点击及次要配置入口均仅进入自动检查引导，不自动切设置、停会话或修改 linger。实施见 `docs/exec-plans/completed/runtime-persistence-sidebar-routing.md`。

侧栏路由验证：72 项模式/能力/会话数量矩阵与旧快照回归通过；151 项控制器/实际 Manager 检查包括复用同一回调后实际模式变更、失信阻止导航、已应用时显式修复仍走开启。manifest、双语、类型和真实打包清单通过；未重新执行宿主侧栏点击/右键 UI，原双语页面几何测试不代证该入口，手动路径与现有真实远程/零登录限制见实施计划。

引导自动检查修正（2026-11-03 用户要求）：开启页面不再列出“检查运行主机”，关闭页面不再列出“检查当前状态”；扩展入口打开原生引导后自动只读检查，发布完成结果并定位下一待办。开启保留“允许服务后台运行”作为第一步，不设置按能力隐藏的 when，环境 eligible 时自动勾选并进入配置/重载/最终验证；只缺 linger 时停在第一步，异常同样停在第一步并显示诊断，不当作成功。关闭为取消勾选、确认重载、验证关闭三步，自动检查只读配置和窗口应用值，不依赖系统资格。正常打开不弹出 Output，结果可由重新检查查看；后续配置/外部命令变更保留显式刷新入口，不引入轮询、自动提权、自动写设置或自动重载。共享退出影响保留在设置/重载步骤。原生勾选仍是历史进度，不是实时授权。下文五步/四步及隐藏步骤描述为本轮修正前的演进记录；当前流程以本段为准。计划见 `docs/exec-plans/completed/runtime-persistence-automatic-guide-check.md`。

自动检查实现复用 `RuntimePersistenceSetup.checkEnable/checkDisable`，show 与 perform 共享一次动作锁，页面打开完成后才检测和发布进度，检查期间销毁/失信/配置或观察过期不得继续推进。135 项控制器/实际 Manager、51 项能力、7 项服务端检查及 manifest、本地化、类型和真实打包清单通过。双语完整流程与两个独立用户目录的首次已就绪场景通过，44 项宽窄几何检查通过；工件 `.debug/runtime-persistence-walkthrough-d56a7033-6cc1-4de2-a5a7-fa64ea0fe8b8/`。系统/应用/翻译仍注入；自动检查承诺对应扩展命令、链接和侧栏入口，不把原生 Welcome 历史页面切回或持续离线状态变化当作已观测事件，手动刷新入口保留。

安全退出补充（2026-11-03 用户确认）：新增独立四步原生关闭引导，检查状态 → 取消勾选配置 → 确认影响并重载 → 验证已关闭，从开启引导、命令面板及侧栏进入。`RuntimePersistenceSetup` 的关闭动作只读取 requested/applied，不依赖系统资格，避免 unknown/blocked/unsupported 阻止退出。requested=true 时定位设置，false/true 时定位重载，仅 false/false 才完成当前窗口关闭；独立 `disableCheckResult` 不污染开启进度。取消重载不撤销已写入的关闭请求，侧栏显示待关闭；后续关闭/重启画板或窗口仍会按既有模式边界应用，用户可在此前重新勾选撤销。

关闭重载继续由 `CanvasPanelManager.notifyReloadRequiredConfigurationChanged` 提示并执行既有清理。告警明确当前窗口退出共享画板、其他启用窗口仍参与时保留共享会话、最后参与窗口明确关闭才清理共享内容和退出 Supervisor；引导不复制窗口计数，实际判定保持在 `leaveSharedCanvasesForModeSwitch` 的受保护退出流程。确认期间模式改变或失信不得沿用旧确认，清理失败不强行重载。部分清理失败仍按原有重试语义处理，不宣称操作无副作用或全部关闭。

关闭扩展不修改 linger。最终关闭步骤提供独立的可选系统撤销说明入口：只有当前窗口配置与应用均关闭后才只读检查系统，目标可核验且 linger 开启时显示实际 host/account/UID 与标准/管理员撤销命令；未知不给可执行命令，已关闭则报告当前检查。此入口仅展示 Output，不创建终端、不提权、不自动执行，用户/管理员仍需评估其他窗口、工作区与该账号用户服务的依赖。它不属于扩展关闭的完成条件。实施见 `docs/exec-plans/completed/runtime-persistence-disable-guide.md`。

安全退出的本地验证：119 项控制器/实际 Manager 检查、51 项能力检查、7 项服务端检查及共享画板 21/21 通过，模式切换、配置复用、侧栏、manifest、本地化、类型检查和打包清单通过。隔离 Linux VS Code 1.140.0 双语开启/关闭全流程通过，真实点击临时 Settings 取消勾选，验证待重载与注入已关闭的区别、未知环境不阻止关闭及可选撤销报告；共 44 项 640px/1280px 按钮几何检查通过，中文窄窗口人工复核无截断。工件 `.debug/runtime-persistence-walkthrough-7a28bdba-1f43-4ffa-8c26-1c606ff43ad9/`；能力、翻译与 applied 状态为注入值，重载确认/取消/失败由实际 Manager 方法受控测试覆盖，不代证真实远端重载或零登录。测试命令改用临时 fixture 快捷键，原命令面板失焦的具体来源仍未定位，原失败随实施计划保留。

2026-11-02 用户确认 §5.5 的辅助执行方案并要求实施，取代此前“插件永不执行”的配置候选；随后要求移除不必要的搜索输入框。2026-11-03 用户再次反馈两层弹窗体验不好，授权迁移到 VS Code 原生 Walkthrough。采用现有 user service + linger；自动检测只读，引导在编辑器显示，用户针对实际目标与命令确认后，插件才通过专用原生终端辅助执行。默认普通账号命令，sudo 必须另行确认；不读取密码、不自动修改授权策略或撤销 linger。§5.5 保留早期 Quick Pick 交互的演进记录，当前界面以本节为准，外部手动配置仍可使用。

实施落点为 `supervisor/runtimePersistenceCapability.ts` 的系统检查、`panel/runtimePersistenceSetup.ts` 的交互、`extension.ts` 的命令注册及 `sidebar/CanvasSidebarView.ts` 的状态；`panel/CanvasPanelManager.ts` 在新建和开启模式清理前准入，后台创建前复核。已有会话附着/控制不受新准入阻断，旧 guarantee 身份字段不按动态 linger 改写。严格新建、不静默降级与真实零登录验收维持本文边界。本轮实现授权不包括当前开发主机的 linger 变更、真实 logout、提交或发布。

实施进度和证据见 [实施计划](../exec-plans/completed/runtime-persistence-linger-implementation.md)。能力模块通过 loginctl 核对 UID/Linger/Service，通过 systemctl 和 `/proc` 核对用户管理器身份、命名空间、Supervisor unit 的 PID/cgroup/InvocationID、绑定及运行时限。与现场 systemd 249 兼容，loginctl 的多个属性必须分别传递 `--property`，不能使用 systemctl 的逗号列表写法。没有为读取资格启动 probe unit 或修改 linger。

当前实现使用 `loginIndependentPersistenceV1` 的可选 hello 能力，以及 create 的 `requireLoginIndependentPersistence: true` 标记。生产 Linux 本地/Remote SSH Host 在破坏性替换之前校验资格、已连接 peer 能力和实际 unit；服务端在获取执行资源之前重新检查，失败返回 `not-acquired`。旧客户端未发送标记时保留旧行为，不能据此授予新增保证；旧 Supervisor 未声明能力时，新 Host 保留其原会话控制但拒绝在其中创建新的强保证执行。历史 guarantee 不改变，不增设自动重启/迁移。测试模式中的既有 detached/fake-systemd 路径维持兼容，不代证生产准入；新增模块与真实 Host/服务端的准入由独立受控用例验证。

重载时若用户请求开启但前提未满足，保留原关闭模式的画板和执行，不改写用户设置；等待配置/重载期间禁止以 snapshot-only 偷偷启动新执行。新建的操作 token 在异步检查前固定，检查后重新核验，取消或切换 root 的旧请求不能在资格查询返回后重新生效。

`RuntimePersistenceSetup.show` 打开原生 `workbench.action.openWalkthrough`；扩展 manifest 贡献检查环境、允许后台运行、开启 Runtime Persistence、重载以应用、最终验证五个步骤。每步只有一个主要动作，复制和 sudo 是开启步骤内的次要文字链接，不再使用 Quick Pick、两层说明 modal 或自定义 Webview。说明媒体由扩展包内中英文 Markdown 提供，使用宿主主题和原生导航；窄编辑区由宿主隐藏媒体，关键授权信息仍在执行确认中展示。实时状态在现有侧栏，检查动作在原生 Output 面板展示最近一次实际主机、账号、UID、状态及可用命令。静态 Walkthrough 不伪装实时主机面板，也不往扩展安装目录写动态资料。引导进度即使被手动勾选或跨主机保留，也不参与能力准入；步骤正文明确告知用户以重新检查为准。环境不是明确 linger-disabled 时不展示开启步骤，命令入口仍独立复核。无需私有/提案 API 或提高最低 VS Code 版本。初版实施计划见 `docs/exec-plans/completed/runtime-persistence-walkthrough.md`。

引导页的“开启 linger”和“使用 sudo”各打开唯一一次执行确认，展示实际主机、账号、UID、账号级影响及精确命令；确认后再检查信任和目标，创建使用 `/bin/sh -c`、固定命令、数字 UID、严格最小环境和 `/` 工作目录的专用原生终端；不读取输出、密码或注入已有交互 shell。普通命令带 `--no-ask-password`，sudo 是另一条显式选择/确认。最低 VS Code 1.80 保留显式“重新检查”，没有依赖较新的 shell integration 完成事件。未知不显示已就绪，命令派发不更新为成功，不重放任务。

检查后的步骤推进（2026-11-03 用户实测修正）：点击检查后，先更新真实结果与页面上下文，再通过公开 `workbench.action.openWalkthrough` 的 category/step 参数定位步骤。明确仅缺 linger 且目标可确认时展开“允许服务后台运行”；环境已就绪时按配置和应用状态选择后续步骤；未知、不支持、管理器异常等其他结果回到“检查运行主机”，Output 保留具体原因。不把完成勾选当导航指令，也不因进入开启步骤而自动执行命令。第一步完成表示已核对主机（仅缺 linger 或已就绪），不能代替完整配置完成；所有进度均不参与执行授权。

配置闭环修正（2026-11-03）：前述三步仅验证系统资格，不足以表示 Runtime Persistence 已启用。当前完整流程改为检查环境、允许后台运行、开启 Runtime Persistence、重载以应用、最终验证五步（linger 步仍按需展示）。控制器通过 Manager 注入的只读 getter 区分配置请求值 requested 与窗口应用值 applied。系统 eligible 但 requested=false 时定位配置；requested=true/applied=false 时定位重载；只有 eligible + requested + applied 才发布 `ready` 并完成最终验证。系统前提失败优先定位环境/linger，不以配置开启绕过。Output 同时报告系统、配置和应用状态。

配置按钮用公开 `workbench.action.openSettings` 精确定位 `devSessionCanvas.runtimePersistence.enabled`，由用户选择原生设置作用域并勾选，不静默修改 Global/Remote/Workspace。设置页返回引导后可用继续检查定位重载。重载按钮先重新检查，只在 eligible、requested=true、applied=false 时调用既有 `notifyReloadRequiredConfigurationChanged`，保留会话/画板清空警告、确认和清理；取消不变更 applied。不在打开引导或只读检查时额外弹出重载提醒，原生配置变更通知保持不变。实施计划见 `docs/exec-plans/completed/runtime-persistence-setup-completion.md`。

步骤可见性继续使用系统 `setupState`，进度事件使用仅在用户显式检查后发布的联合 `checkResult`（needs-setup / needs-configuration / needs-reload / ready 或系统异常状态）；背景检测不驱动页面跳转或进度，避免贡献尚未加载时就提前发出完成事件。定位时 category 使用完整引导标识、step 使用短 id，并等待上下文发布完成；等待中被销毁、失去信任或系统/配置结果已过期的请求不能再选步。最终验证采用新的 `verifyApplied` 步骤标识，避免沿用旧版仅检查系统就绪的完成记录。进度仍是历史记录而不是实时资格，不影响严格新建准入。

最初的三步导航补充通过 54 项控制器检查和中英文 VS Code 1.140.0 smoke，历史工件为 `.debug/runtime-persistence-walkthrough-11a8b3c0-a9a6-4aa0-8b7e-05344c919b42/`。补齐配置闭环后，控制器/实际 Manager 方法检查增至 77 项，51 项能力与 7 项服务端回归、manifest、本地化、类型检查、构建、模式切换/配置读取及真实打包清单继续通过。最终双语宿主工件为 `.debug/runtime-persistence-walkthrough-2a91cd16-27f3-416a-b19a-11586c85c2de/`：实际点击隔离用户设置，验证配置关闭、已开启待重载、注入已应用的三种导航与完成状态，共 28 项宽窄按钮几何检查通过。应用状态为注入值，不冒充真实远端重载；零登录等验证边界维持下文约定。

设置页在 `devSessionCanvas.runtimePersistence.enabled` 的原生 `markdownDescription` 中常驻展示分段提示，不依赖一次性通知：首段加粗强调“Linux / Remote SSH 勾选此项不会自动开启系统 linger”，说明 `Linger=no` 时最后登录结束可能停止会话；下一段突出本地化的完整命令面板入口和“重新检查”，并说明账号级影响与明确确认。保留新建准入、旧会话可访问和其他平台 best-effort 边界，末段加粗原有重载与模式切换清空提示。文案由 `package.nls.json` 和 `package.nls.zh-cn.json` 同步维护；不新增系统配置开关，也不改变通知去重或执行授权行为。

已经完成代码、中文文案、命令入口及本地定向回归；真实远端 UI 和零登录 VM/双 UID 验收尚未执行，状态继续为“验证中”。以下研究阶段和候选演进记录保留追溯，以本节最新确认口径为准。

2026-11-03 的历史两层弹窗 smoke 曾通过 960px/640px 几何检查，但用户仍认为交互不好用，该版本已被引导页取代。当前 `test:runtime-persistence-walkthrough` 在隔离 Linux VS Code 1.140.0 中运行真实控制器和原生页面，注入能力、合成账号及中英文文案并禁止创建终端；1280px/640px 的三个步骤和两类确认共 20 项按钮几何检查通过，媒体加载、检查/复制、Esc 取消、就绪/未知状态切换通过。最终截图与工件在 `.debug/runtime-persistence-walkthrough-957a0757-0dce-4d88-8dba-c6038ec7dcae/`。另外 51/43/7 项能力/控制器/服务端回归、manifest、本地化、类型、构建、模式切换、配置读取及真实打包文件清单通过；打包包含六份中英文媒体。上述不代证实际语言包、最低宿主版本、完整键盘路径、明亮/高对比主题、macOS/Windows、真实远端授权或零登录存活。

## 1. 目标、状态与边界

2026-11-02 用户明确要求：开启 Runtime Persistence 后，不能因为 SSH 断开而停止画板会话；本轮不再追究以前为何未被回收，而是调研成熟方案并设计可靠的后续路径。

这里的“继续”是原 Supervisor、执行进程和 PTY 继续存在，离线期间命令仍可推进，重连附着同一执行身份。PTY 是后台进程持有的交互式终端设备；历史画面、CLI resume、重跑命令和重启服务都不等于原 PTY 延续。

最初设计阶段仅交付比较和推荐，随后用户确认 Quick Pick 辅助执行并授权实施，当前正式口径见本文开头“正式方案”。主机策略修改或真实最后登录退出实验不包含在本轮执行范围；官方机制、代码事实、已确认边界和未执行验收分别记录。

新增保证的目标范围是支持的 Linux 本地与 Remote SSH 环境：关闭全部 VS Code 窗口、Extension Host 退出、SSH 主动断开或网络中断，最终该 UID 的所有登录会话结束，都不能成为停止 live 执行的原因。不能继续把“只要 Supervisor 仍活着”当作逃避最后 logout 的前提；因正常 logout 而丢失 Supervisor 正是本次需要消除的失败路径。

不扩大保证到主机重启/断电、Supervisor 自身崩溃、管理员明确终止服务或账号、策略撤销、资源耗尽、服务依赖的文件系统不可用。主机休眠可以暂停推进，不能保证休眠时持续执行。远程工作所需的凭据和网络仍是外部前提。macOS、Windows、Dev Container 和 Codespaces 不因本轮 Linux 方案获得新的强保证。

## 2. 现有代码事实

代码根为 `extensions/vscode/dev-session-canvas/src/`。现有 Supervisor 与 Host 的分离方向无需推翻，但操作系统托管资格尚不完整。

| 位置 | 已核实的行为 | 对本次设计的影响 |
| --- | --- | --- |
| `panel/runtimeHostBackend.ts` 的 `createRuntimeHostBackend`；`supervisor/runtimeRootPreparation.ts` 的 `backend` | 两处按 `kind === 'systemd-user'` 直接赋 `guarantee: 'strong'` | backend 名称不能证明注销后存活；不能只改其中一处 |
| `panel/runtimeSystemdEnvironment.ts` 的 `inspectRuntimeSystemdEnvironment` | 启动一个有界 transient probe，核对环境和用户身份；没有检查 linger | 有效的环境隔离验证应保留，但不能替代注销资格 |
| `supervisor/runtimeSupervisorStart.ts` 的 `startSystemdUserSupervisor` / `renderSystemdUserUnit` | 写入用户 unit 文件，执行 `daemon-reload` 和 `start`；并非用 transient unit 托管正式 Supervisor，也不执行 `enable` | transient 的只是探测。持久 unit 文件不等于 user manager 持久存活；`enable` 也不等于 linger |
| 同上 | 原生 profile 使用 `Restart=no`，无 profile 的历史路径使用 `Restart=on-failure` | 不需要靠自动重启冒充原执行延续；不自动修改旧 live unit |
| `panel/CanvasPanelManager.ts` 的 `getRootRuntimeSupervisorClient` / `getPreferredRuntimeSupervisorClient` | 有已选 backend 缓存；root 先发现原 owner；新启动在部分明确不可用情况下可降级 detached | 新准入检查必须覆盖缓存命中、已有 owner、新 root 与 rootless 入口，而不破坏只附着路径 |
| `panel/runtimeSupervisorClient.ts` 的 `helloMatchesRuntimeOwner` | 校验 owner、backend、profile、能力以及 `runtimeGuarantee` 的相等关系 | 不能把动态 linger 状态直接塞入现有 identity 比较，否则会把仍活着的旧会话误判为不兼容 |
| `supervisor/runtimeSupervisorMain.ts` 的 `scheduleIdleShutdownIfNeeded` / `runIdleShutdown` | 存在连接、live 会话或 pending 责任时不按 idle 退出 | 已有正确的“无客户端不等于无执行”规则应继续保留 |
| `panel/CanvasPanelManager.ts` 的脚本路径解析；`panel/linuxExecutionOwnerFactory.ts` | 使用扩展 `dist`、`process.execPath`，创建 provider 时重新核验资产 | 存活与安装资产寿命分开；独立于任意编辑器升级/卸载还需要另一个资产保障步骤 |

2026-11-02 的本机只读检查：systemd 为 249；目标 UID 的 `Linger=no`；抽查当前 Supervisor 为 active/running、`Restart=no`、`KillMode=control-group`、`RuntimeMaxUSec=infinity`，`PartOf` / `BindsTo` 为空，unit 文件在用户 `.config/systemd/user/`，`UnitFileState=disabled`。实际 cgroup 位于 `user.slice/user-<UID>.slice/user@<UID>.service/app.slice/…`，而不是 SSH 的 `session-*.scope`。这证明它已脱离 SSH scope，但仍依赖 user manager；不证明本轮改动已实现或跨 logout 实验已通过。

同日补充的只读授权检查：v249 `method_set_user_linger` 根据目标 UID 是否等于调用者 EUID，分别检查 `org.freedesktop.login1.set-self-linger` 与 `org.freedesktop.login1.set-user-linger`。本机 self-linger 的 allow_any / allow_inactive / allow_active 均为 yes；对当前进程执行非交互 `pkcheck --action-id org.freedesktop.login1.set-self-linger --process "$$"` 返回 0。给其他账号配置的 set-user-linger 默认是 auth_admin_keep，同样检查返回 2 并提示需要认证。部分本地策略目录无读取权限，因此以当前主体的实际授权查询辅助核验，不能单独凭发行版默认文件推断所有环境。[v249 分流实现](https://github.com/systemd/systemd/blob/v249/src/login/logind-dbus.c)、[v249 默认授权策略](https://github.com/systemd/systemd/blob/v249/src/login/org.freedesktop.login1.policy)

因此当前检查支持“本账号为自身开启无需 sudo”，不能泛化成开启 linger 总需管理员，也不能把检查 set-user-linger 的结果用于同 UID 操作。授权检查没有执行设置变更，随后仍为 `Linger=no`；它不是已开启或已通过零登录验收的证明。其他主机、调用主体或策略变更后需重新确认，Quick Pick 候选默认普通命令、权限不足才另行确认 sudo 的方向不变。

## 3. 成熟方案比较

以下是官方文档或官方源文件的行为，不是安装并实测了这些产品。subagent 分别调研操作系统服务模式和远程会话产品，主代理复核关键来源，并纠正了“正式 Supervisor 是 transient service”的初始假设。

| 成熟方案 | 可以借鉴什么 | 不能据此承诺什么 |
| --- | --- | --- |
| tmux | server 持有终端和会话，client 可以 detach/attach；断开的只是观察和输入端。[官方入门](https://github.com/tmux/tmux/wiki/Getting-Started) | tmux 若仍在会被回收的登录 scope 内，也可能被系统杀死。systemd 文档明确提示 `KillUserProcesses=yes` 对 tmux/screen 的影响；更换 PTY 库或套一层 tmux 不会修复外层托管。[logind 手册](https://www.freedesktop.org/software/systemd/man/latest/logind.conf.html) |
| Zellij | 运行中的 attach 与退出后的 resurrection 是两种能力；后者可保存布局并重新执行命令。[官方说明](https://zellij.dev/documentation/session-resurrection.html) | resurrection 不是原进程继续运行，不能作为本需求的成功条件 |
| Mosh | 用 SSH 引导、后续 UDP 协议改善网络中断及漫游体验。[官方机制](https://mosh.org/) | 传输协议不能保护已被 OS 停止的 Supervisor；本轮不引入另一套网络传输 |
| JetBrains Gateway | 本地窗口关闭和停止远端实例是不同动作，用户能重新连接远端项目。[官方操作说明](https://www.jetbrains.com/help/webstorm/work-inside-remote-project.html) | 页面描述的是前后端分离，不是任意 Linux logout 策略下的原进程保证 |
| code-server | Linux 包安装后以系统级模板 service 运行，模板通过 `User=%i` 使用普通账号；管理员管理 service，不等于服务进程以 root 运行。[安装文档](https://coder.com/docs/code-server/install)、[官方 unit](https://github.com/coder/code-server/blob/main/ci/build/code-server%40.service) | 其 `Restart=always` 只会启动新的服务进程，不会保留已结束的 PTY；本项目不照搬这一恢复语义 |

应用层的成熟共识是“服务端拥有会话，客户端可离开”，本项目已基本具备；缺口主要位于服务端之上的 OS 生命周期。

### 两条可支持的 OS 路线

**A，优先推荐 user service + linger。** 延续现有每 root/generation 的 Supervisor。由有权限的主体显式启用目标 UID 的 linger，允许该 UID 的 user manager 在无人登录时仍运行。systemd 官方明确赋予 linger 这一含义；也核对了与现场版本匹配的 v249 文档。[loginctl 手册](https://www.freedesktop.org/software/systemd/man/latest/loginctl.html)、[v249 原文](https://github.com/systemd/systemd/blob/v249/man/loginctl.xml)

**B，管理员部署的 system service，设置 `User=` 为目标用户。** Supervisor 放在系统 manager 管理的应用 service/cgroup 中，而不是 `user@UID.service` 或登录 scope 内。它不依赖 user manager，适用于管理员不希望开放整个 UID 的 linger、但允许专门部署本应用服务的主机。code-server 是现成实例；用户身份和目录权限仍须受限。[systemd.exec](https://www.freedesktop.org/software/systemd/man/latest/systemd.exec.html)

| 比较项 | A：user service + linger | B：system service + 普通 UID |
| --- | --- | --- |
| 最后一次正常 logout | 满足经核验的 linger、unit 归属和环境条件时可继续 | 正确部署在系统级应用 service 时可继续 |
| 停止并重建 `user@UID.service` | 不承诺原进程继续 | 不依赖这个 manager；仍受自身 unit 和系统管理策略约束 |
| 主机重启 / Supervisor 崩溃 | 不保留原执行 | 不保留原执行 |
| 权限与范围 | linger 是整个 UID 的属性，是否可自行设置由 polkit/管理员决定 | 需要管理员安装和管理受限 system unit；可只为本应用开放 |
| 工程成本 | 在已有 backend 上补资格和部署 UX，改动较小 | 新 backend、受限安装入口、授权与目录管理，成本较高 |

`daemon-reload` 或 manager 的 `daemon-reexec` 不应与“停止并重建服务”混为一谈，验收应记录具体动作和原进程身份。`Restart=` 管的是进程退出后是否再启动，不能恢复死去的进程内存和 PTY。[systemd.service](https://www.freedesktop.org/software/systemd/man/latest/systemd.service.html)

不选择扩大 VS Code grace time、保留隐藏 SSH、增加心跳、nohup/double-fork、tmux 替换现有执行层、全机 `KillUserProcesses=no` 等方式来实现承诺。`UserStopDelaySec=infinity` 在系统层面也可保留已启动 user manager，所以 **`Linger=no` 不等于所有配置下必然回收**；但这不是本应用首版自动认可的资格，不能擅自修改全机策略或用当前尚未停止推断永久保活。[v249 logind 配置](https://github.com/systemd/systemd/blob/v249/man/logind.conf.xml)

若管理员同时不允许 linger 和专门的系统服务，普通应用不能保证逃过管理员的回收策略。应明确说明主机不满足条件，不能通过隐藏进程绕开政策。

## 4. 架构：保留现有 owner，补齐外层托管

用户已接受 A 的配置方向，并进一步确认 Quick Pick 辅助执行：插件自动检测只读；用户可手动配置，也可针对准确命令确认后通过原生终端执行。B 保留为需单独授权和设计的管理员部署选项，不同时引入全机 daemon、跨用户 broker 或新 PTY backend；实施授权不等于本机配置变更授权。

```text
系统 systemd（PID 1）
└─ user@UID.service（该 UID 已启用 linger）
   └─ app.slice / 每 root、generation 的 Supervisor service
      └─ Runtime Supervisor
         └─ 原生 execution provider → PTY → Agent / Terminal

VS Code Host / Webview ──现有私有 IPC──> Supervisor
                         客户端连接可断开，不持有执行寿命
```

一个 user manager 对应一个 OS UID；Supervisor 继续按执行环境实例、用户存储范围、root 和 generation 隔离，不合并为所有用户的 SSH/session 池。`common/runtimeRootOwnership.ts`、root 排他 claim、startup intent 及既有 owner handshake 都保留；已提交未知结果不能换 backend 再启动一个副本。

## 5. 能力准入和故障呈现

### 5.1 将当前能力与历史身份分开

实际实现将纯数据契约与不依赖 `vscode` 的 OS 检查集中在 `supervisor/runtimePersistenceCapability.ts`，未额外拆出 `common` 文件。UI 控制器 `panel/runtimePersistenceSetup.ts` 消费同一份契约。

检查分为两阶段：启动前确认环境资格，Supervisor 存在后确认实际托管。前者可返回 eligible / blocked / unknown，但不能声称某个 unit 已承载原进程；后者才能返回 verified。错误保留结构化原因，例如 linger-disabled、user-manager-unavailable、scope-mismatch、unsupported-host 和 observation-failed，不将超时当成明确不支持。

verified 仅表示本次观察满足已经支持的托管条件，不代表该执行已经实际经历过长断开验收。平台支持结论与逐次运行状态分开记账，不能用新状态名称代替真实测试。

环境资格检查实际 UID、已有 environmentKey、同一 user manager 与 `Linger=yes`。实际托管检查绑定 unit 名、unit InvocationID、Supervisor PID 与启动标识、实际 ControlGroup；原 owner/profile 继续由既有连接握手核验。检查结果是当次观察，不是持续有效的授权票据。基于 `loginctl` / `systemctl` 的机器可读属性、有界超时、非交互查询和严格解析；不通过探测触发提权。命令和属性兼容现场 systemd 249，不依赖最新手册独有的 JSON 或新属性。

`runtimeGuarantee` 目前还参与 hello 的兼容性判断，新检查不得直接改写它来拒绝旧连接。历史 `strong` 值仅是旧实现的声明，不是当前主机资格证明。Host 将最新能力观察单独用于新建准入、诊断和用户提示；旧会话继续按原 backend/storage/session/kind/owner 路由。新 Supervisor 可通过 additive hello capability 声明实现了新的准入检查，具体字段名和 generation 兼容增量在实施计划中冻结；未具备该能力的旧版本只保留原会话控制，不据此授予新建的完整强保证。

### 5.2 新建与恢复是两条路径

Host 在 `startAgentSessionWithSupervisorCore` 和 `startTerminalSessionWithSupervisorCore` 中，**先做不改变旧执行的资格检查，再进入可能停止/退休旧会话的 replacement 操作**。不能先杀掉原会话，再发现新主机资格不足。

在 root 启动准入内、正式启动提交前复核资格，保持现有一次提交与未知结果保护。连接完成后再验证真实 unit/进程归属。Supervisor 在 create 的原有资源获取前复核有效资格，避免只依赖 Host 的旧缓存；`getRootRuntimeSupervisorClient` 的缓存命中、发现既有 owner及 rootless 启动同样受控，不能只有新 unit 路径检查。本轮不新增跨 generation 迁移；连接到缺少新能力的旧 Supervisor 时拒绝新建，保留其原会话控制。

restore / attach / input / resize / stop / delete 不因为 linger 被关闭而拒绝访问已存在的执行。能力变化影响新建承诺，不赋予 Host 清除绑定或停止旧进程的权限。能力只读检查失败时仍尝试原地址的严格附着；不能自动启动替身、换 namespace、provider resume 或将“不可达”解释为“已结束”。

启动前检查和未来管理员改策略之间不存在应用可以锁住的绝对保证。激活、重连和每次新建刷新资格；Host 在线时可监听相关属性变化并提示。不要在每次输入时调用系统命令，也不要用客户端心跳、无客户端时长或属性查询失败触发 kill/restart。长期离线期间策略被撤销属于可报告的外部保证失效，不自动提升权限修回。

### 5.3 无能力时不能静默兑现一个较弱承诺

Linux 本地/Remote SSH 新建采用严格默认：配置 `enabled=true` 但缺少支持资格时，不新建一个被称为“持久运行”的 best-effort 会话，也不自动写回 `enabled=false`。保留节点、设置期望、原执行及错误，显示“后台持久运行尚未就绪：此账号退出登录后服务可能被回收”。提供查看原因、配置指导、重新检查；用户可明确改用现有关闭模式，并遵守既有模式切换结算规则。

已有 detached 或未验证 systemd 会话继续可附着和控制，显示具体风险，不自动终止。若产品未来仍提供新建 best-effort，必须作为明确选择的另一种承诺，不能隐藏在 `enabled=true` 下；是否新增该选择留待用户确认，不在本轮增加第三档设置。

这种处理比当前“自动 fallback，保证仅进日志”更严格，会影响无权限 Linux 主机，必须在实施时同步配置说明、通知文案与回归测试。其他平台维持现有明确的 best-effort 边界，不默认因 Linux 的新资格规则而禁止全部平台使用。

### 5.4 用户手动配置引导（早期提案，演进记录）

本节细化已接受的只读检测边界，具体交互和严格新建准入仍待确认。复用现有 `sidebar/CanvasSidebarView.ts` 的 Runtime Persistence 摘要行，不新建常驻配置 dashboard。现有 `Enabled` 只表示设置意图，不能继续单独代表后台能力。拟议显示为“未开启”“检查中”“已开启 · 待配置”“已开启 · 无法检查”或“已开启 · 环境就绪”；其他不可用原因显示“已开启 · 不可用”并说明原因。环境就绪只是主机前提满足，现有执行的实际托管验证仍单独报告。

在可信且支持的 Linux 环境，用户开启 Runtime Persistence、以开启状态首次打开画板或重新连接，以及准备新建持久执行时，做有界、非交互的只读检查。设置关闭或只浏览普通工作区时，不主动提示用户更改系统。Restricted Mode 保留原有执行限制，不借引导触发执行探测或提权；提示必须区分信任受限、非 systemd 环境、查询失败和已确认的 Linger=no，只有最后一种使用开启 linger 的主文案。

确认缺少 linger 后，使用 VS Code 原生非模态 warning，内容提案为：

> 后台持久运行尚未就绪。远端主机「{host}」的账号「{user}」（UID {uid}）尚未开启 linger；最后一个登录会话结束后，运行中的 Agent / Terminal 可能被系统停止。插件不会修改系统设置。

动作为“查看配置步骤”“重新检查”“稍后”。本地 Linux 场景使用“本机”，不错误提示在远端执行。只读查询失败时显示“暂时无法确认后台持久运行条件”，提供诊断原因与重试，而不是要求用户重新开启 linger。

“查看配置步骤”打开宿主原生只读说明文档，并提供显式“复制开启命令”动作；不写入工作区、不把命令发送到终端、不自动打开授权对话框，也不提供名为“一键修复”的执行按钮。说明包含实际执行环境、主机、账号和 UID，强调在该主机的终端执行，而不是本地电脑。命令使用已核验的实际数字 UID，不从工作区或环境变量 `$USER` 拼接目标账号。引导中的占位符必须替换为该 UID 后才可复制：

```sh
loginctl enable-linger <实际UID>
loginctl show-user <实际UID> -p Linger --value
```

数字 UID 是 loginctl 支持的用户参数，见 [现场版本 v249 手册](https://github.com/systemd/systemd/blob/v249/man/loginctl.xml)。主机策略可能要求授权；无权限时应联系管理员，在同一主机为明确的目标 UID 配置。可展示管理员使用的 `sudo loginctl enable-linger <实际UID>`，但插件从不执行它、不接收密码、不建议放宽 sudo/polkit 策略。无法可靠识别执行环境/UID 时仅给诊断，不生成猜测的命令。

说明须写清：这是整台主机上该 UID 的设置，可能让其他用户服务在无人登录时运行；关闭本插件功能或卸载扩展不会自动撤销。单独开启 linger 不改变画板模式，不要求重启 VS Code、SSH、Supervisor 或原会话；重新检查即可更新能力观察。若用户另行切换 Runtime Persistence 模式，仍遵守既有模式切换规则和可能清空画板的确认，不能把两件事混为一谈。

用户手动配置后点击“重新检查”，插件重新读取当前主机/UID 的 Linger、用户管理器与相关托管条件，不接受“我已执行”作为成功证据。通过后更新侧栏为“环境就绪”，存在旧执行时继续核验原 owner/unit，不重启它；未通过则保留具体原因。不会自动重放此前受阻的启动动作，用户明确再次启动，防止重复执行。不能仅凭 Linger=yes 宣称每个 detached 或旧协议会话已获得保证。

“稍后”只关闭本次提醒，不回写设置、不启动降级副本、不停止已有会话。自动提醒在同一窗口连接周期内按实际执行环境、UID 和原因合并一次，多 root 不逐节点弹窗；重连后仅在复查仍不满足时最多提醒一次。侧栏风险状态持续可见，并拟新增命令面板入口“Dev Session Canvas: 检查后台持久运行”，便于关闭通知后重新进入。主动新建被拒绝时仍给本次操作的明确反馈，不受自动通知去重影响；跨窗口不为通知去重增加全局协调服务。

新建失败保持 §5.3 的严格准入提案：先检查、后进行任何替换/清理，已有执行仍可附着、输入及停止。`CanvasPanelManager.ts` 的 `notifyReloadRequiredConfigurationChanged` 目前会引导 reload 并进行模式切换清理；后续实现也必须在应用开启模式、进入破坏性结算之前检查资格，不能仅新增通知而让旧清理路径提前执行。关闭持久化不以 linger 检查为前置，不把“关闭持久化”作为无说明的快捷修复。

此交互复用 VS Code 原生通知、侧栏和命令面板，以本地化文本而非颜色独立表达状态，保证键盘可达；UI 状态来自 Host 的同一份能力观察。实施验收需覆盖已开启不打扰、缺失提示、unknown 不误报、无权限指引、远端目标正确、复制不执行、重检成功/失败、提示去重、旧执行不被清理以及模式切换前置检查。除专用 VM 的人工授权步骤外，自动测试不得执行 enable-linger/disable-linger 或 sudo。

### 5.5 Quick Pick 辅助执行（历史演进，当前已改为原生 Walkthrough）

用户先询问能否在 Quick Pick 展示指令并帮助执行，随后明确确认并要求实施，边界因此改为“检测只读；用户针对具体主机、UID 和命令确认后，插件可辅助执行”。这不等于授权当前开发主机操作。Quick Pick 是选择界面，不是操作系统授权器；由插件响应选项发送命令，仍属于插件触发系统变更，不能宣称变成 VS Code 官方配置或保证免于安全审查。[Quick Pick API](https://code.visualstudio.com/api/references/vscode-api#window.showQuickPick)、[Terminal API](https://code.visualstudio.com/api/references/vscode-api#Terminal)

从风险通知或侧栏点击“配置后台持久运行”后打开 Quick Pick；激活和自动检测时不抢焦点弹出选择框。标题显示实际主机、账号和 UID，每项 detail 展示完整命令。提供“在远端终端执行开启命令”“仅复制命令”“查看影响说明”“重新检查”四类动作，Esc 取消不执行。执行项进入独立确认步骤，再展示目标、准确命令及整个 UID 的影响；仅确认执行后创建专用的 VS Code 原生终端并显示命令和输出，不复用已有用户终端。目标变更、连接重建或确认失效时重新检查，不沿用旧授权。

建议首先运行 `loginctl --no-ask-password enable-linger <实际UID>`，使用已验证的数字 UID 和受控命令，避免拼接任意工作区文本。该选项不请求交互授权，是否允许操作仍由操作系统决定；见 [v249 loginctl 手册](https://github.com/systemd/systemd/blob/v249/man/loginctl.xml)。若明确需要管理员权限，显示原因并提供另行确认的“使用 sudo 在远端终端执行”，准确展示 `sudo loginctl enable-linger <实际UID>`；不自动升级为 sudo，不把任何失败都解释成权限问题。密码只由用户直接输入系统终端，不通过 Quick Input、插件表单或 `sudo -S` 获取，不订阅或记录该配置终端的输入/输出流，也不修改 sudoers/polkit。无法确认执行结果时保留人工联系入口，不绕过管理员策略。

不得复用 `extension.ts` 的 `promptAgentCliInstallation` 所调用的 `CanvasPanelManager.createTerminalAndRunCommand` 来配置 linger：它创建的是 Canvas Terminal，可能依赖尚未满足的 Runtime Persistence 准入，形成先配置才能创建配置终端的循环。使用独立原生终端，先确认终端与实际执行环境、UID 一致；无法确定本地/远端/容器归属时仅允许复制指引。Restricted Mode 禁止辅助执行，执行前再次核验信任状态；不向已被用户改作其他任务的终端注入命令。

当前扩展最低版本为 VS Code `^1.80.0`；原生 `Terminal.sendText` 可派发命令，但返回不代表完成。较新版本的 shell integration 结束事件只能作为可选的重新检查触发器，不能无条件依赖或据此单独判成功。无可靠完成事件时保留“重新检查”，不通过延时猜测成功，不因未观察到结果自动重发命令。最终仍读取当前 Linger 与托管条件，保留原进程，不自动启动之前受阻的任务。

新增验收应覆盖取消和仅复制零执行、确认前零系统修改、目标/信任变化失效、远端归属验证、执行项单次派发、普通权限不足不自动 sudo、独立 sudo 确认、不采集密码、无 shell integration 的重新检查，以及关闭终端/断连后的未知结果不自动重试。入口已实现并以 stub/mock 验证交互和派发，真实执行仅在另行授权的隔离 VM 进行；本轮未执行任何配置命令。

## 6. 安装、权限与 unit 生命周期

资格检测只读，系统配置可由用户/管理员自行执行，也可通过已确认的 Walkthrough 引导与执行确认在专用终端执行；只有针对具体命令的明确确认才授权派发。“查看步骤”“复制命令”“重新检查”不执行设置变更。需要管理员时给出准确主机、账号、UID 和命令，不给扩展安装密码、不持久化 sudo 凭据，也不自动修改 polkit。完成后重新读取真实 Linger 和 unit 归属，不以确认按钮或命令退出码代替生效证明。本轮没有对开发主机执行配置动作。

确认前必须解释：linger 影响整个 UID 的 user manager，其他已启用 user service 也可能无人登录时运行。关闭 RuntimePersistence、清空画板或卸载扩展不自动 `disable-linger`，否则可能停止其他应用。应用只治理自己的 unit/执行，不调用 `terminate-user` 或停止整个 `user@UID.service`。

沿用 `runtimeSupervisorStart.ts` 写入用户 service 文件和按需 start 的方式。对于新协议 unit 明确无 SSH 标准输入依赖、输出到独立日志/journal、`KillMode=control-group`、无 session target 的 `PartOf` / `BindsTo`、无活动运行时限和 `Restart=no`。有效属性应在真实 manager 上验证，管理员 drop-in 不能被文件模板掩盖。不是要永久启用每个 root 的 unit：linger 让 manager 常驻，执行 unit 仍按需启动；不增加机器重启时自动复活原会话的含义。

不因断开客户端、reader 变为零、Agent 等待输入或离线很久而回收 live 执行。现有 idle 规则仅在无连接、无 live 和 pending 责任结算后生效。自然退出、显式 Stop/Delete、最后开启窗口主动关闭持久化仍沿现有所有权和结算规则；参见 `runtime-shared-root-canvas-sync.md`、`runtime-mode-switch-settlement.md`，不重写这些职责。

离线执行还要求 Supervisor 在没有 Host 消费者时继续读取 PTY、维护权威终端状态，不能永久等待已离线页面的 ACK 而让任务堵在输出上。复用现有 current-state、reader 退休和容量规则；以超过单批输出 credit 的持续流验证真实推进，不能只检查进程 alive。未发现具体缺陷前，不借本轮重写 journal 或改变已确认的 scrollback 保留范围。

资源方面沿用当前准入和 scrollback 约束，暴露本应用后台会话及停止入口。可以由管理员配置 unit/cgroup 资源限制，但不添加会静默杀死活动会话的隐藏 idle TTL 或内存硬上限。数据、IPC 目录和 session 身份保持用户隔离，持久文件不放在 SSH 私有目录；root 的现有私有 socket 及其自恢复机制沿 `runtime-socket-recovery.md` 复用，不为本轮另开公网端口。

若后续实施 B，安装 unit 和允许的执行配置必须由管理员控制，服务从创建起以目标普通 UID 运行，不能让 root daemon 接受任意客户端命令/路径再以 root 执行。授权按实际 UID、允许的存储范围和 root 核验；系统 service 不依赖 user manager，并保留当前跨 backend 排他 claim。B 不作为 A 启动结果未知时的自动 fallback，也不把某个现存 user service 的 PID 强迁到新的 owner。

## 7. 外部依赖与资产寿命

只让进程活着还不够：执行所需的 cwd/home、Agent 程序、运行库、凭据和网络必须在无人登录时可用。SSH agent forwarding 的 `SSH_AUTH_SOCK`、VS Code 临时 IPC、桌面凭据服务或随登录挂载的加密 home 可能失效；不能把这些条件伪装成后台运行的充分保证。诊断应说明依赖风险，建议持久凭据入口但不能擅自复制或保存密钥。仅引用 systemd-homed 的生命周期说明不足以断言当前主机一定会卸载 home，需要目标环境验证。[pam_systemd_home](https://www.freedesktop.org/software/systemd/man/latest/pam_systemd_home.html)

当前 `process.execPath` 与 extension `dist` 依赖是另一个需要显式划界的风险：正常 SSH/logout 不必然删除这些文件，因此不应把迁移整个运行时发行体系作为修复 linger 缺口的前置重构；但若要同时承诺扩展/VS Code Server 升级清理旧安装目录仍可启动 provider，就需要固定版本、校验过的独立 runtime bundle。code-server 的 standalone 分发将 Node 和模块一起打包，可作为参考。[分发说明](https://coder.com/docs/code-server/install#standalone-releases)

推荐先完成“SSH/logout 独立”主线，并核对正常关闭 Remote SSH 不删除仍需资产；随后单独验证原有升级保证。若验证发现关闭客户端就会删除必需资产，则资产寿命修复成为本主线 blocker。独立 bundle 应保持现有运行数据和 owner 身份不迁移，按版本保留资产至原 Supervisor 全部结束，不能简单复制本地 Electron 的 `process.execPath` 当成可独立运行的 Node。具体分发/ABI/GC 设计未在本轮选定，不宣称已解决升级或卸载。

## 8. 存量迁移与回退

第一步只读取现有绑定及能力，展示风险；不重启 unit、不清理 registry、不移动 socket。A 的 linger 可以由授权主体在线启用；复核现有 manager/原 unit/原 PID 没有变化后，该存量 service 可以具备新的主机存活前提，但旧协议缺少新准入能力仍应分开说明。

旧 owner 继续服务原会话直至结束。若它缺少新的准入能力，新建会被明确拒绝，需等旧 Supervisor 结束并由兼容版本承载；本轮不新增自动换代、`systemctl restart` 或批量 kill。无法让 detached 旧执行原地获得服务级保证时，不伪称已迁移；明确保留旧风险，由用户在适当边界主动新建。

回退代码也不应撤销系统 linger 或停止已运行的新 owner；保留旧版本只附着/控制兼容性与未知结果保护。用户若要撤销主机配置，需要先确认该 UID 下所有相关应用的影响，属于独立管理动作。

## 9. 验收设计：必须真的没有该 UID 的登录会话

不在本开发账号实验 logout、`terminate-user` 或 user manager 停止。使用可重置 Linux VM、专用业务 UID，以及**不同 UID 的管理员观察端或 VM 控制台**。同一 UID 的“第二个 SSH 观察窗口”、`sudo -iu`/`su -` 的 PAM session 或后台测试 SSH 会让零登录前提不成立。观察器读取进程、logind 和工件，不给业务 UID 创建新的 PAM session；其自身也不得加入被测 Supervisor 的客户端保活计数。

先记录镜像/systemd 版本、PAM 配置、UID、boot ID、有效 `UserStopDelaySec`、Linger、session 清单、unit 和 cgroup。正常用产品启动持续输出递增序号及 nonce 的 Terminal，以及能长时间保持原 PTY 的 Agent。记录 Supervisor、provider 和 PTY 子进程的 `(boot ID, PID, /proc starttime)`、会话/authority ID 和 unit InvocationID；单独比较 PID 不足以排除复用。

关闭目标 UID 的全部客户端与 SSH，包括 ControlMaster、forward-only 及测试夹具连接；通过 logind 的 session UID/Class/State 以及 sshd/PAM 结束证据确认其登录 session 确实归零，而不是仅看 `who`。较新 systemd 可能暴露 manager 类记录，须与真实登录 session 分开。此时 observer 不 attach 被测服务，靠独立工件与进程信息观察输出持续增长。

等待从零登录成立时开始计时，而不是从关窗口计时。先在 disposable VM 固定有限停止延迟做正反对照，跨过实际延迟和足够稳定窗口；建议短回归离线 10 分钟，另做 30 分钟至隔夜长断开验证。若目标主机延迟更长，观察窗口同步覆盖；若为 infinity，不能把该机器的 linger=no 当作必然失败反例。

| 场景 | 必须看到的结果 |
| --- | --- |
| 修复前 / 有限停止延迟 / Linger=no | 经隔离夹具复现旧路径回收或明确展示缺少资格；保留反例，不作用于用户会话 |
| 新实现 / Linger=no | 在创建或替换旧执行前拒绝新持久执行，不降级、不创建副本，原会话仍可控制 |
| 新实现 / Linger=yes / 正常退出最后 SSH | 目标 UID 零登录时，原进程启动身份和 unit InvocationID 未改变，输出持续增长 |
| 新实现 / Linger=yes / 网络断开 | 观察到旧 SSH/PAM session 最终真正结束；达到零登录后仍保持原执行，不用“sshd 尚未发现断线”充当通过 |
| 重连 | 产品附着相同会话/authority，恢复约定 scrollback，实时输入、resize、输出有效；不是新 start/resume |
| 零客户端持续高输出 | 输出累计超过单批 credit 和初始缓冲，原任务计数仍推进；恢复约定内 scrollback，不以 observer 附着解除阻塞后才判通过 |
| 保证撤销或查询 unknown | 新建受阻、已有绑定和控制保留；不因探测失败杀死或重启原执行 |
| 停止 user manager / Supervisor 故障 / VM 重启 | 单独的越界故障测试；如原执行丢失准确显示，不以新 PID 冒充连续性；不把这类强制操作用作正常 logout 测试 |
| 多 root、多窗口、两 UID | 一个窗口离开不停止共享 live；各 root/generation 和 UID 隔离，不依赖别人的登录保活 |
| 显式停止与空闲回收 | Stop/Delete 仍可完整结算；所有执行结束后按既有 idle 规则退出，不泄漏后台服务 |

若长任务依赖转发凭据，应加有/无该依赖对照，区分“原进程存活”和“外部认证失效导致业务无法推进”。测试输出增长须来自原进程的独立 nonce/序列，不用截图或缓存 registry 单独证明实时执行。

## 10. 实施落点与验证顺序

以下四阶段保留研究阶段的验证顺序；实际代码落点与已执行命令以“正式方案”和实施计划为准。前两阶段的代码与本地定向验证已完成，后两阶段的真实环境验收尚未执行。

实施阶段一先做纯能力解析和 Host/UI 准入的负例，保持生产启动流程未切换；扩展 `scripts/test/test-runtime-systemd-environment.mjs`、`test-runtime-root-preparation.mjs`、`test-runtime-root-owner-handshake.mjs`，覆盖 yes/no/unknown、超时/权限、错误 UID/环境、缓存命中和旧 strong 元数据，检查失败前未停止旧执行。新增模块的测试只能使用隔离 fake，不自动设置真实 linger。

阶段二接入 `runtimeHostBackend.ts`、`runtimeRootPreparation.ts`、`runtimeSupervisorStart.ts`、Supervisor create 和 `CanvasPanelManager.ts` 的所有新建入口；补既有 hello 兼容和只附着保护。更新 `test-runtime-supervisor-startup-profile.mjs`、root startup、恢复和 mode-switch 测试，确保新准入未破坏现有排他性、退出结算和跨代行为。测试用 override/fake 可以注入能力，但不能使生产仅凭 backend 名称宣称已验证。

阶段三加入专用 VM/双 UID 的真实 logout 场景，再接入 `tests/vscode-smoke/real-reopen-tests.cjs` 所在的真实重连链路。已有 fake-systemd、同机窗口重开和原 Host 退出测试继续保留，但不得代证零登录。CI 报告分别展示机制测试、原进程离线证据、产品重附着和清理；缺少相应 VM 能力的 runner 不能标记该项已通过。

阶段四取得 Linux 本地与 Remote SSH 的 Terminal / Agent 真实输入证据，审核正常客户端关闭时的资产可用性、资源和安装授权；再把新承诺写成已实现/已验证。system service B 若被选择，另建受限安装及普通 UID 验证阶段，不能仅给 `systemd-run` 去掉 `--user` 就发布。

已运行的局部命令包括 `npm run test:runtime-persistence-setup`、`npm run test:runtime-root-preparation`、`npm run test:runtime-root-ownership`、`npm run test:runtime-supervisor-startup-profile`、模式切换及完整 Supervisor 协议回归，详见实施计划。本轮还通过类型检查、构建、本地化与侧栏回归，不运行真实注销测试；VM 编排仍待补足。

## 11. 本轮结果与待确认取舍

已确认：成熟实现分离客户端和后台 owner；systemd 官方支持通过 linger 跨 logout；本仓库正式 Supervisor 已用用户 service，但此前未核验这一存活前提；环境探测、持久 unit 文件和历史 strong 标签都不能单独证明目标保证。

用户已确认并授权实施：采用 user service + linger，自动检测只读，Quick Pick 明确确认后可在专用原生终端辅助执行，sudo 另行确认。该授权不是修改当前开发主机的授权。

已实现：资格检查、严格新建、原生通知/侧栏/命令面板、原生 Walkthrough 与 Output 检测结果及单次执行确认/复制/重检、旧会话保护与协议协商。system service 留作管理员部署备选，不重写 Supervisor，不引入 tmux/Mosh 依赖。

尚未完成：真实远端 UI、双 UID/VM 零登录验收、长离线 Agent 以及资产清理验证。源码实现和本地测试不代表当前已安装的扩展已升级，也未修改开发账号 linger、systemd unit 或真实会话。
