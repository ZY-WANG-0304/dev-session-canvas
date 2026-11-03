# 设计不依赖 SSH 登录存活的 Runtime Persistence

本 ExecPlan 是活文档，遵循仓库根目录下 `docs/PLANS.md`。推进时持续更新进度、意外与发现、决策记录和结果与复盘。

## 目标与全局图景

用户要求开启 Runtime Persistence 后，断开 Remote SSH 不能终止画板中的真实 Agent 和 Terminal 会话。本轮只交付设计研究：核对实现、比较操作系统托管方案、明确保证边界、部署权限、迁移和验收方式，不修改运行代码、不启停真实会话、不修改本机 linger 或 systemd 策略。历史 SSH 关闭延迟不再是本轮需要查清的前置条件。

真实会话继续运行意味着原 Supervisor（拥有会话的后台进程）、原执行进程、PTY（交互式终端设备）以及执行身份都继续存在，断开期间仍可执行和产生输出；重新连上后附着原执行，而不是恢复历史画面或启动新的 CLI。主机重启、管理员强制停止和资源耗尽属于需要单独描述的边界，不能用自动重启进程冒充原会话延续。

## 进度

- [x] (2026-11-02) 读取工作流、计划和设计规范，确认工作树没有 tracked 改动；既有未跟踪用户文件不触碰。
- [x] (2026-11-02) 建立设计阶段 ExecPlan，限定本轮为只读调查和文档交付。
- [x] (2026-11-02) 核验 backend 选择、正式用户 unit、环境 probe、保证字段和旧 hello 的身份关系，确认两处 static strong 与缓存覆盖缺口。
- [x] (2026-11-02) 按用户新增授权，使用两个较小模型 subagent 分别研究 systemd 和成熟会话产品；主代理复核官方来源及现场 v249 语义，不修改生产配置。
- [x] (2026-11-02) 形成推荐方案，覆盖严格新建、独立能力观察、权限和 UID 副作用、旧执行控制保护、资源及双 UID/VM 零登录验收。
- [x] (2026-11-02) 写入设计文档，同步注册表、通用信念与规格边界；选型仍是推荐，不标成已实现。
- [x] (2026-11-02) `git diff --check`、新增文档空白/末尾换行、设计元数据与索引状态及已有测试锚点检查通过，归档本设计阶段计划。
- [x] (2026-11-02) 根据用户后续确认，记录插件只读检测、用户/管理员外部配置 linger 的边界；补充现有侧栏、非模态通知、手动命令和重新检查的交互提案，不启动生产实现。
- [x] (2026-11-02) 核对 Quick Pick 与原生终端 API，补充用户询问的“展示命令并确认后辅助执行”候选；区分可行性、插件权限边界变更与当前主机授权。
- [x] (2026-11-02) 只读核对 v249 自身/其他用户的 linger 授权分流、本机 policy 与非交互 pkcheck；当前账号 self-linger 授权通过，无需 sudo，未执行开启操作。

## 意外与发现

当前产品规格 `docs/product-specs/runtime-persistence-modes.md` 把 `systemd-user` 作为 Linux / Remote SSH 的强保证主路径，并为不可用情况保留 `legacy-detached` 降级。本轮必须核对这里的“能力满足”是否包含用户管理器在最后一个登录会话退出后的存活条件，不能把能够调用用户 D-Bus 或成功启动 unit 当作充分证据。

代码确认 `panel/runtimeHostBackend.ts` 和 `supervisor/runtimeRootPreparation.ts` 都将 systemd-user 静态声明为 strong；`runtimeSystemdEnvironment.ts` 只核对用户和执行环境。正式 Supervisor 使用写入 `.config/systemd/user/` 的持久 unit 并按需 start，transient service 仅用于环境探测，研究输入的初始简化说法已纠正。

旧 hello 把 runtimeGuarantee 作为相等比较项，直接按当前 linger 动态改写它会让仍在运行的旧 owner 无法附着。建议能力观察与历史身份分开；Host 在有破坏性的 replacement 之前先预检，真正 create 再复核。只检测新 unit、忽略缓存/既有 owner/rootless 路径会留下绕过。

官方 logind 文档允许 UserStopDelaySec=infinity，因此不能说无 linger 在所有配置下必然回收；推荐把 linger 作为本应用首先支持的显式部署路径，而不是自动接受未确认的全机策略。实际观察端也必须使用不同 UID，不能给目标用户保留第二个 SSH 会话。

现有 `sidebar/CanvasSidebarView.ts` 已有 Runtime Persistence 摘要行，但仅显示 Enabled/Disabled；可复用而不增加常驻配置面板。`CanvasPanelManager.ts` 的模式设置提示会进入 reload/cleanup，因此未来资格预检必须同时保护开启模式的破坏性结算，不能只拦截 create。单独启用系统 linger 与切换画板持久化模式不是同一操作。

`extension.ts` 已有 Quick Pick 选择后安装 CLI 的交互，但调用的是 Canvas Terminal，不适合作为 linger 前置配置终端。原生终端 API 可支持独立执行；当前最低 VS Code 为 1.80，不能无条件使用较新 shell integration 的完成事件。Quick Pick 本身不提供系统授权或安全审查豁免。

v249 为自身开启使用 set-self-linger，为其他 UID 开启使用 set-user-linger；二者不是同一权限。本机前者 policy 为 yes，非交互 pkcheck 返回 0；后者要求管理员认证，返回 2。部分本地策略目录不可读，实际主体授权检查比只读默认 policy 更有针对性；检查后 Linger 仍为 no，不构成真实开启测试。

## 决策记录

- 决策：先交付设计，不在当前开发账号上实验真实注销、停止用户管理器、启用 linger 或安装系统级服务。
  理由：这些操作会影响当前账号全部用户服务和会话；本轮用户提出的是方案设计，不是主机策略修改授权。
  日期/作者：2026-11-02 / Codex。
- 决策：将“断开 SSH 后原进程继续运行”与“重连后恢复画面/重启 CLI”分开验收。
  理由：用户要求的是运行连续性，后两者无法履行这个承诺。
  日期/作者：2026-11-02 / Codex。
- 决策：优先推荐现有 user service + 显式授权的 linger，保留 system service 作为管理员部署备选，不改用 tmux/Mosh 或隐藏 SSH。
  理由：成熟应用与官方 systemd 机制均把客户端重连和服务托管分开；本项目已有 Supervisor，先补生命周期前提的变更最小。
  日期/作者：2026-11-02 / Codex（推荐，待用户确认）。
- 决策：推荐 Linux 新建严格检查资格，缺失或未知时不静默 fallback；已有会话继续允许附着和控制。
  理由：避免 UI 宣称持久但实际只得到 best-effort，也避免改变保证字段误伤旧身份或启动副本。
  日期/作者：2026-11-02 / Codex（产品取舍待确认）。
- 决策：user service + linger 方向中的系统配置仅由用户/管理员在插件之外执行；插件只读检测和提供指引，不执行开启/关闭命令或提权。
  理由：用户明确接受这个权限边界，希望插件不承担系统配置操作。确认不扩大到实施授权或具体交互已定稿。
  日期/作者：2026-11-02 / 用户确认，Codex 记录。
- 决策：提出复用侧栏状态、非模态通知、原生只读步骤、复制命令及显式重检；命令使用实际执行环境的数字 UID，不自动重放启动请求。
  理由：及时表达能力缺口而不过度打扰，避免远端/本地账号混淆、点击引导即执行或修复配置后重复启动；交互细节仍待用户确认。
  日期/作者：2026-11-02 / Codex（交互提案）。
- 决策：将 Quick Pick 展示命令、独立确认后在原生终端执行列为新的候选，不把用户的可行性询问当作授权执行。
  理由：官方 API 支持，但它仍是插件触发系统变更，改变之前的只读边界；需说明普通执行、另行 sudo 确认、终端目标与密码隔离，并保留手动配置选项。
  日期/作者：2026-11-02 / Codex（交互候选，待确认）。

## 结果与复盘

设计研究已形成 `docs/design-docs/runtime-persistence-login-independence.md`，包含成熟方案、代码缺口、推荐路线、严格准入、兼容迁移和真实验收矩阵。主机权限与 UID 级影响明确；没有新增运行依赖、没有启用 linger、没有重启真实服务。设计尚未被实现，不能提升现有 strong 字段的可信范围。

用户后续确认了插件只读、用户/管理员外部配置 linger 的方向，具体交互已作为提案补入设计 §5.4。遗留工作是严格准入与交互确认、新协议/能力实现、引导实现、专用 VM 的零登录正反例、长离线实际 Agent、高输出无客户端推进及资产清理验证；它们是后续实施内容，不作为本次设计研究已完成的测试。system service B 和独立 runtime bundle 均不在当前推荐最小改动中自动实施。

用户进一步询问的 Quick Pick 辅助执行已确认 API 可行性，并作为设计 §5.5 的待确认替代交互；未修改已接受的权限边界，也未进行真实执行验证。

本机当前 self-linger 授权检查通过，说明为自身配置不需要预先要求 sudo；其他主机仍取决于有效授权。此结论来自只读策略与 pkcheck，未执行 enable-linger，当前配置仍未开启。

## 上下文与定向

代码位于 `extensions/vscode/dev-session-canvas/src/`，而不是仓库根 `src/`。`panel/runtimeHostBackend.ts` 负责选择和启动 Supervisor 的操作系统托管方式；`panel/runtimeSupervisorClient.ts` 负责跨进程连接；`supervisor/runtimeSupervisorMain.ts` 拥有后台会话；`common/runtimeSupervisorProtocol.ts` 和 `common/runtimeSupervisorPaths.ts` 定义跨进程协议与运行目录身份。Host 是 VS Code Extension Host 一侧；它可以消失，不能继续承担持久会话的进程所有权。

`docs/product-specs/runtime-persistence-modes.md` 是用户承诺；`docs/design-docs/runtime-persistence-and-session-supervisor.md`、`docs/design-docs/runtime-persistence-closeout.md` 和 `docs/design-docs/runtime-root-ownership.md` 记录现有设计。`docs/design-docs/runtime-shared-root-canvas-sync.md` 约束多窗口对共享 root（同一工作根目录状态）的参与及主动关闭。`scripts/test/test-runtime-systemd-environment.mjs`、`tests/vscode-smoke/fixtures/fake-systemd/systemd-run.cjs` 与真实 reopen 测试是现有验证入口；模拟的 systemd 不等于实际退出最后一个登录会话。

## 工作计划

里程碑一核查现有保证从哪里产生：逐项追踪 backend 的探测与缓存、启动的 service/scope、Supervisor 的身份和路径、启动资产以及窗口关闭/主动关停的区别。此里程碑已完成，证据写入设计文档第 2 节，不扩大为通用架构重写。

里程碑二比较最小可行托管路线。user service 配合 linger（操作系统允许该用户的后台管理器在无人登录时仍运行）与系统级 systemd service 以普通 UID 执行已完成比较；tmux、Zellij、Mosh、JetBrains Gateway 和 code-server 的官方依据记录在设计文档第 3 节。没有把 client/backend 分离或服务自动重启当作原 PTY 存活证明。

里程碑三已在设计文档第 4 至 11 节写入推荐方案、准入与交互、权限、迁移和验收。注册表、通用信念和规格已同步，仍标记比较中 / 验证中；文档校验通过，计划归档到 completed。不执行产品代码或主机策略变更，设计阶段完成不代表实施验收完成。

归档后补充：根据用户确认细化只读配置引导，设计、规格、索引和通用信念同步；已接受的是系统权限边界，通知文案、入口与严格准入仍为提案。该补充只完善设计记录，不将本计划扩展为已开始的实施计划。

## 具体步骤

全部仓库命令在 `/home/users/ziyang01.wang-al/projects/dev-session-canvas` 运行。使用 `rg -n` 与分段读取追踪上述模块和对应测试；使用 `loginctl show-user "$(id -u)" -p Linger -p State`、`systemctl --version`、`systemctl --user show` 等只读命令核对环境，不运行 logout、terminate-user、stop 或 enable-linger。

从 systemd 官方手册核对 `loginctl enable-linger`、`UserStopDelaySec`、`KillUserProcesses` 与 `systemd-run --user` 的语义。引用具体官方 URL，在设计中完整解释必需前提，不让实施者必须依赖会话历史才能理解方案。

设计文档完成后执行 `git diff --check`，检查新增文档 frontmatter 的状态和索引一致，检查相对路径确实存在。仅文档改动不启动会影响真实 Runtime 的 smoke，也不宣称代码测试覆盖新方案。

## 验证与验收

本轮通过标准是设计能够明确回答：最后一个 SSH/PAM 登录会话结束后谁持有 Supervisor；主机不允许该能力时如何拒绝虚假的强保证；如何证明同一原进程在零登录会话期间仍运行；如何安全恢复旧绑定而不复制执行；何时允许清理资源。必须具备失败反例，不能把保留另一个 SSH 测试连接、短时关闭窗口或 fake-systemd 通过作为注销独立性的证明。

实施验收应由另一管理员/控制账号观察专用测试 UID，确认目标 UID 的登录 session 数归零、跨过有效回收延迟并等待稳定观察窗口，检查原 Supervisor/执行进程的启动身份和持续输出，再以同一 UID 重连、检查实时输入与原 PTY。测试不能退出真实开发账号，也不能把管理员账号的登录 session 算到目标 UID 上。具体前后置条件及回收步骤由设计文档细化。

引导交互的未来验收还须覆盖 yes/no/unknown、无权限、错误执行环境、复制不执行、稍后不降级、重检不重启、已有会话保护和模式切换前置检查。仅复核文案和代码入口不是 UI 已实现或验收已通过。

## 幂等性与恢复

本轮操作只有只读检查和文档增量，反复执行不改变主机登录策略或现有会话。用户未跟踪文件不移动、不覆盖。未来安装和迁移必须单独授权，不能主动重启已有 live 会话；不可满足新保证的旧绑定保持原身份和明确警告，不能偷偷换 backend。

## 证据与备注

初始工作树：`canvas-remove-file-nodes` 分支，tracked 文件无本地修改。用户已有 `Note5.md`、`communication.md`、`tmp.md` 和图片等未跟踪文件，均不属于本任务。先前事件已观察到用户服务整体停止，但本轮不再追究之前为何延迟关闭 SSH。

只读现场结果：systemd 249，Linger=no；抽查应用 service active/running、Restart=no、RuntimeMaxUSec=infinity、KillMode=control-group，PartOf/BindsTo 为空，位于 user@UID.service/app.slice 而非 session scope，UnitFileState=disabled。这说明“已脱离 SSH scope”和“用户 manager 在注销后继续存在”是两个独立条件。

官方关键来源为 systemd 的 loginctl/logind.conf（同时核对 v249 源文档）、code-server 的系统 service 模板 User=%i，以及 tmux、Zellij、Mosh、JetBrains 的官方功能说明。精确 URL 与各自可支持的结论均就近保存在设计文档，不以 subagent 的初步摘要替代复核。

## 接口与依赖

本轮不新增第三方运行依赖。实际现有类型为 `RuntimeHostBackendDescriptor`，其中 guarantee 还参与连接兼容性判断。建议在 `common/runtimePersistenceCapability.ts` 提供独立的数据契约、在 `supervisor/runtimePersistenceCapability.ts` 实现无 vscode 依赖的资格检查（两者尚未创建），将 host eligible 与实际 runtime verified 分开；blocked / unknown 保留原因。Supervisor create 的准入能力用 additive hello capability 表达，具体签名、字段和 generation 兼容策略由后续实施计划固定，不在研究中声称已兼容。

修订说明：2026-11-02，建立设计研究计划，将用户要求收敛为原执行跨最后 SSH 登录结束继续存活，避免把历史恢复或自动重启当作替代。

修订说明：2026-11-02，完成用户授权的两路小模型调研并复核来源，纠正 transient/持久 unit 混淆，补充双 strong 声明、动态保证与旧 hello 的冲突、严格准入和零登录验收。文档校验通过后归档设计阶段，生产实现与真实注销测试继续明确为未完成。

修订说明：2026-11-02，根据用户接受“插件只读检测、用户/管理员外部开启 linger”的方案，记录确认边界并补充提示流程提案；复用现有 UI 入口，区分系统配置与破坏性的画板模式切换，不修改运行代码或主机设置。

修订说明：2026-11-02，响应 Quick Pick 帮助执行的可行性询问，补充需显式改变权限边界的候选方案、原生终端与 Canvas Terminal 的区别及版本兼容要求；不自动升级为 sudo，不进行真实主机操作。

修订说明：2026-11-02，响应是否必须 sudo 的询问，记录自身/其他 UID 的不同授权动作和本机只读检查结果；避免把给其他用户配置的管理员权限误用于自身配置，保持尚未开启与尚未验收的边界。
