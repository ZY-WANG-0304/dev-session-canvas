# 交付跨平台 Notifier 端侧应用

本 ExecPlan 按 `docs/PLANS.md` 维护。它是活文档，必须持续更新进度、意外与发现、决策记录和结果与复盘。设计结论位于 `docs/design-docs/notifier-native-client.md`。

## 目标与全局图景

用户安装独立通知应用后，可以在离开画布时收到原生通知，从收件箱找回遗漏提醒，并准确回到产生事件的 IDE 窗口和节点。应用采用 Tauri 外壳、Rust 核心、React / TypeScript UI，平台差异由薄适配层处理。首先在 Mac 打通正式应用身份到真实点击回跳，再完成 Windows / Linux 验证。不需要 IDE 退出后继续提醒，不实现 supervisor 直连、云推送或 IntelliJ。当前任务只交付文档和远端分支，后续实施从此计划继续。

## 进度

- [x] (2026-11-01) 用户确认职责、跨平台方向及 IDE 退出后的范围边界。
- [x] (2026-11-01) 写入设计、验收与 Mac 接手计划，登记产品与架构入口。
- [ ] 在 Mac 验证平台能力，冻结依赖、身份和通信契约。
- [ ] 实现原生通知到正确 IDE 节点的安装包闭环。
- [ ] 实现共享核心、收件箱、恢复、诊断和完整回退。
- [ ] Windows / Linux 原生安装包验收及 macOS 签名公证验收。
- [ ] 完成默认路径迁移、文档、CI 与发布交付。

## 意外与发现

现有 `packages/attention-protocol/src/index.ts` 只有 execution-attention、dedupeKey 和 focusAction，以及 posted/unsupported/error 回执，缺少来源实例、执行代次和更新撤销接口。不能只把平台命令替换成 socket 调用就宣称生命周期完整。现有回跳语义是居中而非确认提醒，必须保留。

当前工作环境是 Linux，没有进行 macOS 原生验证。已暂停的 IntelliJ 未跟踪文件保存在原机器 worktree 外，不在本分支或远端交付内容中，后续开发不依赖它们。

## 决策记录

2026-11-01，用户与代理：保留独立应用加 IDE 薄适配器，选定 Tauri + Rust + TypeScript 方向，Swift 仅在必要的平台适配中使用。理由是三平台共享业务与 UI；框架能力仍需验证。

2026-11-01，用户：不要求关闭 IDE 后继续提醒。应用只消费在线 IDE 的事件，断线来源显示离线，不建设额外远端事件网络。

2026-11-01，代理：先验证正式应用身份、通知点击和多窗口定位，再扩展界面；协议与生命周期在共享核心实现，不能依赖显示名或任意命令回调。本轮只推送交接文档，不初始化未验证的应用脚手架。

## 结果与复盘

本轮完成设计与执行计划交接；应用代码、平台能力和性能均未实现或验证。Mac 开发首先执行里程碑一。计划保持 active，不把文档交付当作整个应用完成；最终完成时迁入 completed，并将实际遗留技术债写入 `docs/exec-plans/tech-debt-tracker.md`。

## 上下文与定向

主扩展 `extensions/vscode/dev-session-canvas/` 判断节点是否需要 attention（用户关注）。本机 companion `extensions/vscode/dev-session-canvas-notifier/src/extension.ts` 接收请求，`src/platformNotification.ts` 调用系统后端。`packages/attention-protocol/src/index.ts` 是现有两扩展的纯数据协议。Remote SSH 的执行位于远端，但通知必须由 UI 侧本机 companion 转发。

新增应用放 `apps/notifier/`；`src/` 是 React UI，`src-tauri/` 是 Rust 应用。Tauri 是桌面外壳；IPC 是本机进程间通信，此处指 Unix socket 或 Windows named pipe 上的受限消息连接。不要把应用服务放到远端 workspace，也不要直接开放网络端口。先读 `docs/WORKFLOW.md`、`docs/SECURITY.md`、`docs/RELIABILITY.md`；UI 开工前读 `docs/UI.md` 和 `docs/FRONTEND.md`。保持既有产品行为及测试可运行。

## 工作计划

### 里程碑一：在 Mac 固定平台能力与接口

检查已安装 Xcode 命令行工具、Rust、仓库 Node 版本及 VS Code。查询当前 Tauri 官方文档与实际依赖源码，固定版本和锁文件，记录最低系统版本、应用 bundle identity、签名身份可用性、权限查询、通知点击/撤销、应用重启回调及窗口激活能力。没有签名凭据时可做本地开发验证，但签名公证安装包仍留未完成。

在 `apps/notifier/` 创建正式项目骨架与平台适配接口；用最小 UI 验证真实通知。若插件缺能力，记录最小原生补丁；只有证据表明代价不可接受才做 Electron 对照并回写设计。退出条件是安装后的应用能发送通知并捕获真实点击，有原始日志；若只在开发态成功则里程碑未完成。记录空闲内存、启动耗时和测试机器，再制定可复测预算，不预填未测数字。

定义新端侧协议版本及 TypeScript/Rust 一致性向量，保留旧 v1。注册字段包含客户端实例、workspace 和能力；事件包含 eventId、canvasId、nodeId、executionGeneration、时间、有效期、合并键及内容。定义发布/更新/撤销/状态查询/同步/定位接口、凭据、帧限制和持久化回执边界。确定历史保留期、容量和清理策略并写回设计，然后再实现持久化。

### 里程碑二：原生通知到正确节点

修改 companion 注册来源并连接应用，Rust 根据身份存储事件并调用原生通知适配器。用户点击后通过受控 token 找到原来源连接，companion 调用已有内部居中命令。回调不能包含任意命令或完整凭据，重启后必须重验来源身份。以显式开发配置选择新后端，保留旧后端但不双投。

在 Mac 打包并安装应用，打开本地和 Remote SSH 两个 VS Code 窗口，创建同名节点并分别触发真实 attention。通知必须准确回到对应窗口和节点，且不改变 selection/attentionPending。增加测试注入只用于可重复协议用例，不能用注入代替真实信号链验收。退出条件是两来源真实点击闭环均通过，记录包摘要、版本、日志和动作证据。

### 里程碑三：可靠核心与日常界面

在 Rust 核心加入有界持久化、事件去重、合并限流、来源连接状态、重连同步、过期与撤销。应用先持久化再回执；companion 超时先查询同 eventId，明确未接单才回退工作台。记录在未知接单状态下的超时仲裁规则，测试迟到请求不会双投；不承诺无法实现的跨进程绝对一次投递。

React UI 提供待处理、历史、来源状态、设置和诊断；关闭记录不自动确认画布节点。IDE 确认、删除节点及执行换代更新应用派生状态。旧事件不污染新执行，重连不重弹历史。应用退出不停止 IDE 任务；IDE 退出只使来源离线，通知点击不自动启动 IDE。完成权限诊断、声音设置、测试通知及日志脱敏。退出条件是共享测试及下述故障矩阵通过，现有 notifier/source/locale 测试保持有效。

### 里程碑四：三平台交付与迁移

分别用 macOS、Windows 和 Linux 的正式打包产物运行同一验收剧本。Linux 记录桌面环境和通知服务；三平台分别验证 IPC 权限、托盘、权限/设置、真实点击、多窗口、升级和卸载。macOS 必须补签名、公证、干净安装后首次授权。新增跨平台构建与核心测试 CI，原生人工场景保留明确证据入口。

应用分发与 VSIX 分开，明确版本兼容、安装引导、升级回滚和缺失应用回退；正式安装包验收前不切默认后端、不删除旧路径、不宣称跨平台完成。将当前产品规格、架构、发布说明和测试目录同步到最终实现；完成有意义批次时按仓库流程提交/MR。若需要长期集成分支，先按 WORKFLOW 登记范围，不能擅自把当前主题分支当共享集成分支。

## 具体步骤

Mac 上在仓库根执行以下现有命令；若当前工作目录已有同名本地分支，应先检查本地工作与远端差异，不覆盖它。

    git fetch origin
    git switch --track origin/notifier-native-client
    git status --short
    node --version
    rustc --version
    cargo --version
    xcode-select -p
    npm ci
    npm run typecheck:notifier
    npm run test:notifier-source

使用仓库声明的 Node 版本；缺少 Rust/Xcode 工具时按对应官方安装说明准备，再记录版本。现有测试预期 exit 0，不预填用例数量。源码 smoke 需本地 VS Code/桌面环境，按仓库脚本约束执行：

    npm run test:notifier-smoke
    npm run test:notifier-locale-smoke

以下是里程碑一必须创建的脚本契约，目前不能运行：应用 workspace `apps/notifier/package.json` 暴露 dev、build、test；dev 启动 Tauri 开发应用，build 生成本平台安装包，test 运行 UI/协议测试。Rust manifest 创建后提供核心测试：

    npm run -w apps/notifier dev
    npm run -w apps/notifier build
    npm run -w apps/notifier test
    cargo test --manifest-path apps/notifier/src-tauri/Cargo.toml

创建脚本后将实际产物位置、安装命令和验收 runner 命令更新到本节。原生验证必须退出开发实例，安装并启动同批产物；记录 SHA256，不能将开发运行结果记到正式包上。

## 验证与验收

共享核心覆盖合法与非法协议、凭据拒绝、超大帧、同 eventId 重发、不同来源同名节点、过期、更新撤销、执行换代、持久化失败、回执丢失、重连和版本不兼容。预期非法输入不执行动作，未落盘不回接单，旧代不修改新代，同事件不重复生成逻辑提醒。

真实桌面逐项执行：本地及 Remote SSH 两窗口分别发出提醒；点击准确定位且不选择/确认；重复发送不重弹；节点已处理同步更新，删除/换代后旧点击安全拒绝；重启应用恢复历史及在线连接且不重弹；关闭 IDE 显示离线且不要求新通知；拒绝通知权限可诊断，已接收事件仍在收件箱；应用不可用走工作台，恢复后不补投已回退事件；强制丢失接单回执后查询/重试保持一条逻辑事件，迟到路径不造成双渠道提醒。系统不显示横幅不能被标记为用户已看到。

正式包还需验证干净安装、首次授权、升级后数据兼容、升级失败回退、卸载不遗留自动启动项。记录 OS/架构、IDE 版本、commit、包摘要、操作、预期/实际和证据路径。自动测试、开发态、安装包原生交互分别记账。任一平台未测则该平台保持未验证，不以 CI 编译或 Mac 成功替代。

## 幂等性与恢复

测试使用隔离用户数据和临时来源身份，不清空真实收件箱或撤销用户系统权限。重复事件沿同 ID 查询结果，重复安装先备份测试数据。迁移先新增可选后端；有问题时关闭新路径，恢复工作台/旧配置，保留诊断。数据库迁移先备份并验证旧版本处理规则，禁止用低版本覆盖新格式。推送前 fetch/rebase，保护无关本地文件，不强推 main。

## 证据与备注

2026-11-01：从 origin/main 的 e0527132 建立 notifier-native-client，当前只有交接文档。当前 Linux 环境未安装或运行新应用，不能提供平台通过证据。本轮文档检查与远端交付由提交和最终回复记录；后续每个里程碑在此追加真实命令、结果和证据路径。

## 接口与依赖

新增 Rust 的 NotificationBackend 接口，提供 post、withdraw、settings 和用户操作事件；核心通过 SourceRegistry 注册/断开来源，通过 EventStore 持久化并查询事件，通过 Router 定位已验证来源。类型与函数签名在里程碑一按固定依赖落地后记录，不能用空接口冒充实现。TypeScript companion 负责 registerSource、publishEvent、queryEvent、syncState 与处理 focus 请求。所有结果区分 accepted、rejected 和 unknown；系统提交与用户点击另记事实。共享 JSON 测试向量覆盖 Rust/TypeScript 字段、版本、未知动作和过期，UI 不直接执行任意系统命令。

修订记录：2026-11-01，首次将用户确认的跨平台方向、IDE 在线边界和正式包验收写成可接手计划；实现与平台验证明确保持未完成。
