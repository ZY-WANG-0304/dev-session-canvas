# 实施 Runtime Persistence 的 linger 检查与显式配置

本 ExecPlan 按 `docs/PLANS.md` 维护，代码实施与本地验证阶段已完成归档。用户于 2026-11-02 确认 Quick Pick 展示命令、明确确认后辅助执行的方式并要求实施；此授权不等于立即修改开发主机的 linger 或退出当前 SSH。真实零登录验收作为未完成的独立门槛登记到 `docs/exec-plans/tech-debt-tracker.md`。

## 目标与全局图景

后续说明（2026-11-03）：本文保留当时两层弹窗的实现与验证记录。用户后续反馈触发原生 Walkthrough 替换，当前 UI、测试命令和媒体打包方式见 [引导页实施计划](runtime-persistence-walkthrough.md)，原 `test:runtime-persistence-dialog` 已由 `test:runtime-persistence-walkthrough` 取代。

Linux 用户开启后台持久运行后，插件检查当前账号的 linger 与服务托管条件。缺失时，用户能从原生通知、侧栏和命令面板进入无输入框的原生操作对话框，看到准确主机、账号、UID 和命令，选择复制或确认执行。执行使用独立 VS Code 原生终端，不依赖画板 Terminal；默认无 sudo，管理员方式单独确认，不收集密码。重新检查以实际系统状态为准。

新建持久执行必须在破坏性替换之前检查；缺失或未知不静默 fallback。既有会话仍可恢复附着、输入及停止，历史 guarantee 身份不改写。原进程跨零登录继续存在须另用隔离 VM 验证，本地模拟测试不代证。

## 进度

- [x] (2026-11-02) 读取工作流和现有实现，确认已有未提交设计与用户文件，继续当前工作树，不提交、不切分支。
- [x] (2026-11-02) 将用户确认记录为实施授权，明确不操作真实主机策略。
- [x] (2026-11-02) 增加 Linux 能力与实际服务归属检查，核对 UID、命名空间、PID/cgroup、InvocationID、绑定及运行时限。
- [x] (2026-11-02) 实现 Quick Pick、独立原生终端、确认/复制/重检、通知去重和侧栏状态，默认不使用 sudo。
- [x] (2026-11-02) 接入启动、开启模式前置检查和重载时原模式保护，增加 hello 能力协商及服务端资源获取前复核；旧恢复控制路径不变。
- [x] (2026-11-02) 补充回归、中文本地化、设置说明、README 和正式设计；类型检查、构建及相关定向套件通过。
- [x] (2026-11-02) 记录本机只读负例、单独 unit 归属核验和测试边界；真实零登录与远端 UI 继续登记为未验证，不在开发账号执行。
- [x] (2026-11-02) 按用户反馈将 Quick Pick 替换为无输入框的原生操作对话框；保留命令预览、复制、重检和独立确认，完成本地回归。
- [x] (2026-11-03) 修复原生弹窗按钮过密：每页至多三个应用按钮、短标题及更多页；补充真实隔离 VS Code 的中英文窄窗口几何与交互验证。

## 意外与发现

现有正式 Supervisor 是持久用户 unit 按需启动，而非 transient service；环境探针才使用 transient。两个 backend 构造处静态 strong 仍参与旧 hello 相等性校验，不能按 linger 动态重写。Host 的原执行替换早于 backend 选择，需前移资格和新 owner 检查。现有 CLI 安装 Quick Pick 使用画板 Terminal，不能复用来解决创建画板 Terminal 自己依赖的前置条件。

本机 systemd 249 的 set-self-linger 授权只读检查通过，set-user-linger 要管理员认证；不能默认 sudo。最低 VS Code 为 1.80，不依赖较新 shell integration API，保留显式重新检查。

现场只读验证发现 loginctl 249 不支持把多个属性写成 systemctl 风格的逗号列表；该写法静默返回空结果，已改成分别传递 --property 并纳入用例。新读取器在本机返回 blocked / linger-disabled；将结果仅用于独立 unit 归属读取时，当前服务验证通过，不能将这次单项验证当作 linger 已开启。

扩大回归发现侧栏原有“同次投影复用配置读取”的约束；新请求模式读取改为复用 getSidebarState 的配置对象，并补齐测试夹具字段。开启模式的新异步检查必须重核设置和进行中的清理；新建检查期间取消/切换 root 的操作仍用原操作 token 拦截。上述问题在本地修复并回归，不作为已知未修复项。

用户截图暴露第一版 modal 的五个应用按钮加 Cancel 过密，之前 mock 只确认操作可达，没有验证真实按钮栏宽度。改为两层并增加按钮数上限，旧实现会在该回归中失败；再通过真实 Electron/VS Code 截图和 DOM 几何检查确认 640px 窗口内按钮不溢出。UI 夹具仅使用所需公开 API，不枚举 vscode.env 的其他属性，以免触发无关提案 API getter。

## 决策记录

- 决策：采用已讨论的 Quick Pick 辅助执行，不继续坚持插件绝不执行的旧候选边界。自动检查仍只读，命令必须在用户逐次确认后执行；sudo 独立确认。
  理由：用户明确接受并要求实现；不把实现授权扩大为修改开发主机。
  日期/作者：2026-11-02 / 用户确认，Codex 记录。
- 决策：保持原 runtimeGuarantee 与绑定不变，以独立能力观察和新建前检查补齐保证，不重新创建旧会话。
  理由：避免破坏存量兼容与运行连续性。
  日期/作者：2026-11-02 / Codex。
- 决策：以可选 hello 的 loginIndependentPersistenceV1 和 create 的 requireLoginIndependentPersistence 明确协商新保证；旧客户端与测试夹具保留旧行为，不冒充已通过新准入。
  理由：避免修改身份导致旧连接失效，也避免新 Host 向不支持服务端复核的旧 Supervisor 创建强保证会话。已有旧会话仍可使用，旧 Supervisor 不自动重启。
  日期/作者：2026-11-02 / Codex。
- 决策：将最初的 Quick Pick 改为公开 API 的原生 modal 操作对话框，不再展示搜索/输入框；影响说明也用独立 modal，关闭后返回操作对话框。
  理由：用户只需要几个固定操作。最低 VS Code 1.80 的 QuickPick 无公开 hideInput 属性，不能通过类型断言或私有 API 假装支持；原生 MessageItem 按钮保留键盘与鼠标操作，取消和选择不会绕过二次确认。
  日期/作者：2026-11-02 / 用户反馈，Codex 实施。
- 决策：首屏保留检查、开启和更多；更多页展示说明并提供复制、sudo 和返回，返回使用 isCloseAffordance，标题只显示功能名，账号和命令进入正文。
  理由：解决实测中的单行按钮拥挤，不只缩短文案，也不引入新的搜索框或自定义 Webview。独立确认和目标重检保持不变。
  日期/作者：2026-11-03 / 用户反馈，Codex 实施。

## 结果与复盘

源码实现及本地验证已完成，未执行任何真实 enable-linger、sudo、logout 或生产服务停止操作。真实零登录、远端 UI、长离线 Agent 和资产清理验证仍未执行，明确登记到技术债，不以受控测试或既有 reopen 代证。未提交、打包安装或发布。

新增三个定向脚本分别覆盖 51 项能力/初始模式保护检查、27 项原生操作对话框/确认/复制/目标变化检查、7 项服务端获取前准入；reader client 增加两项能力协商与旧 attach 保护，Host 模式切换增加原执行保护及异步取消/设置变化。完整 runtime-supervisor-protocol 链路通过，包含真实隔离 socket/PTY 的恢复、模式退出、分页及 Host credit；这些子用例不是 systemd 零登录实验。

## 上下文与定向

代码根为 `extensions/vscode/dev-session-canvas/src/`。`panel/CanvasPanelManager.ts` 编排启动、恢复和设置切换；`panel/runtimeHostBackend.ts` 选择托管方式；`supervisor/runtimeSupervisorMain.ts` 实际创建会话；`sidebar/CanvasSidebarView.ts` 展示状态；`extension.ts` 注册命令。新能力模块在 `supervisor/runtimePersistenceCapability.ts`，独立 UI 控制器在 `panel/runtimePersistenceSetup.ts`；不新增运行依赖。

## 工作计划

里程碑一实现无 vscode 依赖的只读能力检查，使用绝对系统命令、参数数组、有界超时和严格解析，核对实际 UID 和执行环境。纯模块测试模拟系统响应，不从测试中调用真实授权变更。

里程碑二将能力状态和设置意图分开呈现，注册检查/配置命令。操作对话框取消和复制不执行；执行前重检目标和信任，在独立终端运行受控命令，保留明确重新检查入口，避免猜测成功和自动重发。

里程碑三将检查放在新建和开启模式清理之前，并覆盖缓存/既有 owner/rootless；服务端创建前复核。恢复使用原地址、allowRestart:false，不以资格失败清除原绑定。按测试夹具更新 fake，不把模拟资格当成生产验收。

里程碑四运行 `npm run typecheck`、新增定向测试、runtime root/startup/mode-switch、manifest 和 UI 本地化回归。同步正式设计和规格，仅将实际完成的内容记为通过。

四个代码里程碑已收口。生产 Linux 本地/Remote SSH 执行严格新建；其他宿主形态和 Test 模式保留既有测试/尽力行为，不授予新增承诺。配置 UI 实际创建原生终端时使用固定 /bin/sh、受控数字 UID 命令和最小环境；密码/输出不被插件采集。命令完成采用显式重新检查而非派发即成功。

## 具体步骤

所有命令在仓库根执行。用 apply_patch 编辑代码/测试/文档，使用 esbuild 的受控依赖注入测试系统与 vscode 边界。按新增模块先测试，再运行已有相关套件；不运行会停止真实会话的测试操作。

## 验证与验收

模拟 yes/no/unknown、UID 不符、非 Linux、受限工作区、超时/坏输出、权限失败；证明取消/复制零变更、确认后只派发一次、sudo 不自动触发、远端目标不漂移。资格失败发生在替换/模式清理之前，既有恢复控制不进入新建准入。新能力观察不修改旧 hello 身份。

真实零登录验收要求独立 VM 与两个 UID，观察者不保留目标 UID 登录。记录原进程、启动时间、unit InvocationID 与离线持续输出，重连核对同一执行。当前开发账号不做这个实验；若缺少夹具，明确保留未验证而不宣称跨 logout 验收通过。

原生弹窗 UI 可在仓库根执行 `xvfb-run -a npm run test:runtime-persistence-dialog -- <已有 VS Code 可执行文件路径>`。脚本 `scripts/smoke/run-runtime-persistence-dialog.mjs` 使用临时用户数据与独立开发扩展，运行真实控制器和原生对话框；只注入 blocked 能力、合成账号和中英文翻译，阻断真实终端并将复制写入测试工件。分别在 960px/640px 宽度检查首屏、更多页、普通确认和 sudo 确认的边界与按钮文字，覆盖返回、Esc 取消和复制；不会配置 linger 或修改用户当前窗口。

## 幂等性与恢复

检查不修改系统设置。确认后的 enable-linger 本身可重试，但客户端派发结果未知时不自动重发；重检系统事实。关闭功能/卸载不 disable-linger。不触碰用户 Note5.md、communication.md、tmp.md 和图片，不提交或推送。

## 证据与备注

初始工作树包含之前的设计文档改动，尚无本轮代码改动。调研计划位于 `docs/exec-plans/completed/runtime-persistence-login-independence-design.md`。真实主机仍 Linger=no。

已运行并通过：npm run typecheck、npm run build、npm run test:runtime-root-preparation（含新 test:runtime-persistence-setup）、npm run test:runtime-root-ownership、npm run test:runtime-supervisor-startup-profile、npm run test:runtime-mode-switch-races、npm run test:runtime-supervisor-protocol、npm run test:extension-manifest、npm run test:ui-copy-localization、npm run test:sidebar-state-updates。完整协议最后一次日志位于本机临时文件 /tmp/dsc-linger-protocol-qbTeWa.log；日志中的故障注入警告对应通过的超时/断连用例，不代表生产连接被操作。

## 接口与依赖

能力结果应有明确状态和原因、当前目标 UID/环境，UI 与准入消费同一契约。系统调用不接受任意用户命令；操作对话框只能选择固定动作，用户名只展示、命令参数使用核验的数字 UID。UI 使用现有 vscode.l10n 与中文 bundle；测试入口加入仓库 npm scripts 和现有相关回归入口。

修订说明：2026-11-02，用户要求开始实现，建立实施计划并将配置执行权限限制在用户逐次确认的产品操作，不修改开发主机。

修订说明：2026-11-02，完成代码和本地验证，记录 loginctl 249 属性兼容、侧栏配置复用与异步准入竞态修复；明确真实零登录及远端 UI 的未验证边界。

修订说明：2026-11-02，收尾复核补充异步资格检查前固定操作 token，以及请求开启但尚未应用时禁止 snapshot-only 新建；保留原会话与设置期望，并增加真实 Host 方法回归。

修订说明：2026-11-02，最后一次修改后重新通过类型检查、80 项新增能力/交互/服务端检查、模式切换与真实隔离 socket/PTY 回归、本地化、侧栏和构建；同步设计文档中仍停留在候选阶段的实施状态，保留真实零登录验收的未验证边界。

修订说明：2026-11-02，按用户追加要求加强设置页原地提示，中英文均将“勾选不会开启系统 linger”加粗置顶，分段展示配置命令、重新检查与账号级影响，并保留加粗的重载/清空提醒。新增 manifest 回归先在原单段文案上失败，修改后 `npm run test:extension-manifest`、`npm run test:ui-copy-localization` 与 `git diff --check` 通过。未更改通知或系统配置行为；原生设置页的视觉验收尚未执行，手动路径为加载更新后的扩展、搜索 `devSessionCanvas.runtimePersistence.enabled`，分别在中英文界面检查提示层级、完整命令名称与换行，并确认仅查看说明不会打开终端或修改 linger。

修订说明：2026-11-02，用户要求移除配置入口的筛选框，已改为无输入框的原生操作对话框。回归先在旧 showQuickPick 路径失败，修改后 51/25/7 项定向检查、本地化、manifest、类型检查与构建通过。真实宿主视觉/键盘验收仍需加载更新后的扩展，在配置入口检查主机/命令展示、按钮布局、Esc 取消、影响说明返回和二次确认取消；无需执行系统配置即可完成这些 UI 检查。本轮未安装扩展或修改主机 linger。

修订说明：2026-11-03，修正用户实测发现的单行按钮拥挤，新增每页按钮数限制、更多页/返回和 sudo 目标变化回归，定向检查增至 51/27/7 项。本地化、manifest、类型检查与构建通过；`xvfb-run -a npm run test:runtime-persistence-dialog -- .vscode-test/vscode-linux-x64-1.140.0/code` 在真实隔离 Linux VS Code 中完成中英文、960px/640px 的四类弹窗验证，16 张截图与几何数据位于 `.debug/runtime-persistence-dialog-6e504d31-a732-4ac1-bdaf-47488076a558/`，另外人工查看了上一轮同代码截图。此证据只覆盖注入系统观察/翻译的本地 UI，不代证实际远端权限或跨平台原生对话框；未执行系统配置，未安装用户扩展。
