# 交付跨平台 Notifier 端侧应用

本 ExecPlan 按 `docs/PLANS.md` 维护。它是活文档，必须持续更新进度、意外与发现、决策记录和结果与复盘。设计结论位于 `docs/design-docs/notifier-native-client.md`。

## 目标与全局图景

用户安装独立通知应用后，可以在离开画布时收到原生通知，从收件箱找回遗漏提醒，并准确回到产生事件的 IDE 窗口和节点。应用采用 Tauri 外壳、Rust 核心、React / TypeScript UI，平台差异由薄适配层处理。首先在 Mac 打通正式应用身份到真实点击回跳，再完成 Windows / Linux 验证。不需要 IDE 退出后继续提醒，不实现 supervisor 直连、云推送或 IntelliJ。当前从 Mac 里程碑一继续实施；先核验原生能力，再接入正式端侧协议。

## 进度

- [x] (2026-11-01) 用户确认职责、跨平台方向及 IDE 退出后的范围边界。
- [x] (2026-11-01) 写入设计、验收与 Mac 接手计划，登记产品与架构入口。
- [x] (2026-11-01) 检查 Mac 工具链及固定版插件源码，发现权限查询和撤销缺口。
- [x] (2026-11-01) 固定 Tauri/Swift 骨架、锁文件和应用身份；Mac 本地安装包通过查询、真实点击、撤销和退出后点击恢复。
- [x] (2026-11-01) 新端侧 v2 契约与 63 个 TypeScript/Rust 请求及响应共享向量通过。
- [ ] 里程碑一剩余：首次授权失败复现、图标缓存复核、冷启动耗时与跨会话资源预算。
- [x] (2026-11-01) 接入默认关闭的 Mac socket、持久化回执、来源路由、companion 与主扩展身份复核。
- [ ] 实现原生通知到正确 IDE 节点的安装包闭环；两本地测试窗口真实 OSC 9 信号、安装版通知和点击回跳均通过；Remote SSH 仍待验收。
- [ ] 实现共享核心、收件箱、恢复、诊断和完整回退。
- [ ] Windows / Linux 原生安装包验收及 macOS 签名公证验收。
- [ ] 完成默认路径迁移、文档、CI 与发布交付。

## 意外与发现

现有 `packages/attention-protocol/src/index.ts` 只有 execution-attention、dedupeKey 和 focusAction，以及 posted/unsupported/error 回执，缺少来源实例、执行代次和更新撤销接口。不能只把平台命令替换成 socket 调用就宣称生命周期完整。现有回跳语义是居中而非确认提醒，必须保留。

初始交接环境为 Linux；现已切换到 macOS 并完成下述原生能力验证。已暂停的 IntelliJ 未跟踪文件保存在原机器 worktree 外，不在本分支或远端交付内容中，后续开发不依赖它们。

## 决策记录

2026-11-01，代理：固定发布版插件无法满足 macOS 权限查询和撤销，先以隔离 AppKit 探针验证 UserNotifications 薄适配，再接入 Tauri。探针不替代产品应用和 IDE 真实链验收。

2026-11-01，用户与代理：保留独立应用加 IDE 薄适配器，选定 Tauri + Rust + TypeScript 方向，Swift 仅在必要的平台适配中使用。理由是三平台共享业务与 UI；框架能力仍需验证。

2026-11-01，用户：不要求关闭 IDE 后继续提醒。应用只消费在线 IDE 的事件，断线来源显示离线，不建设额外远端事件网络。

2026-11-01，代理：先验证正式应用身份、通知点击和多窗口定位，再扩展界面；协议与生命周期在共享核心实现，不能依赖显示名或任意命令回调。初始交接轮只推送文档，不初始化未验证的应用脚手架；后续 Mac 验证批次按上方新决策创建骨架。

## 结果与复盘

Mac 已交付 Tauri + Rust + React 骨架、Swift 适配以及默认关闭的 v2 本机桥接。原有安装包的权限查询、点击、撤销与冷启动验证已记录；本轮协议、持久化、来源路由和 IDE 回跳防护通过自动测试。双本地窗口的真实 OSC 9、安装版通知点击和正确节点居中均已通过；Remote SSH、图标缓存复核、首次授权失败复现、重复资源采样与启动耗时仍未完成。当前仍是开发入口，默认路径未迁移，不声明里程碑一或二整体完成。

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

以下里程碑一脚本已创建：应用 workspace `apps/notifier/package.json` 暴露 dev、build、test；dev 启动 Tauri 开发应用，build 生成本平台安装包，test 运行 TypeScript 类型检查、跨语言请求/响应向量以及 Rust 存储、路由、socket 与动作白名单测试。Rust manifest 创建后提供核心测试：

    npm run -w apps/notifier dev
    npm run -w apps/notifier build
    npm run -w apps/notifier test
    cargo +1.90.0 test --manifest-path apps/notifier/src-tauri/Cargo.toml --release --locked

实际产物为 `apps/notifier/src-tauri/target/release/bundle/macos/DSCanvas Notifier.app`；退出旧实例后用 ditto 复制到 `~/Applications/`。详见 `apps/notifier/README.md`。原生验证必须退出开发实例，安装并启动同批产物；记录 SHA256，不能将开发运行结果记到正式包上。

## 验证与验收

共享核心覆盖合法与非法协议、凭据拒绝、超大帧、同 eventId 重发、不同来源同名节点、过期、更新撤销、执行换代、持久化失败、回执丢失、重连和版本不兼容。预期非法输入不执行动作，未落盘不回接单，旧代不修改新代，同事件不重复生成逻辑提醒。

真实桌面逐项执行：本地及 Remote SSH 两窗口分别发出提醒；点击准确定位且不选择/确认；重复发送不重弹；节点已处理同步更新，删除/换代后旧点击安全拒绝；重启应用恢复历史及在线连接且不重弹；关闭 IDE 显示离线且不要求新通知；拒绝通知权限可诊断，已接收事件仍在收件箱；应用不可用走工作台，恢复后不补投已回退事件；强制丢失接单回执后查询/重试保持一条逻辑事件，迟到路径不造成双渠道提醒。系统不显示横幅不能被标记为用户已看到。

正式包还需验证干净安装、首次授权、升级后数据兼容、升级失败回退、卸载不遗留自动启动项。记录 OS/架构、IDE 版本、commit、包摘要、操作、预期/实际和证据路径。自动测试、开发态、安装包原生交互分别记账。任一平台未测则该平台保持未验证，不以 CI 编译或 Mac 成功替代。

## 幂等性与恢复

测试使用隔离用户数据和临时来源身份，不清空真实收件箱或撤销用户系统权限。重复事件沿同 ID 查询结果，重复安装先备份测试数据。迁移先新增可选后端；有问题时关闭新路径，恢复工作台/旧配置，保留诊断。数据库迁移先备份并验证旧版本处理规则，禁止用低版本覆盖新格式。推送前 fetch/rebase，保护无关本地文件，不强推 main。

## 证据与备注

2026-11-01 初始交接：从 origin/main 的 e0527132 建立 notifier-native-client，当时只有交接文档，Linux 环境未安装或运行新应用。本轮文档检查与远端交付由提交和最终回复记录；后续每个里程碑在此追加真实命令、结果和证据路径。

## 接口与依赖

新增 Rust 的 NotificationBackend 接口，提供 post、withdraw、settings 和用户操作事件；核心通过 SourceRegistry 注册/断开来源，通过 EventStore 持久化并查询事件，通过 Router 定位已验证来源。类型与函数签名在里程碑一按固定依赖落地后记录，不能用空接口冒充实现。TypeScript companion 负责 registerSource、publishEvent、queryEvent、syncState 与处理 focus 请求。所有结果区分 accepted、rejected 和 unknown；系统提交与用户点击另记事实。共享 JSON 测试向量覆盖 Rust/TypeScript 字段、版本、未知动作和过期，UI 不直接执行任意系统命令。

修订记录：2026-11-01，首次将用户确认的跨平台方向、IDE 在线边界和正式包验收写成可接手计划；实现与平台验证明确保持未完成。


### 2026-11-01 Mac 实施证据

基线为 `72203a33`，同批源码和日志随本提交保存。机器 Mac14,7、macOS 26.6.2 arm64，VS Code 1.140.0。PATH 的 code 实为 Cursor，测试必须使用 `/Applications/Visual Studio Code.app/Contents/MacOS/Code`。Node 使用与 CI 一致的 22.23.3；全局 Node 26.3.0 未更改。Rust 1.90.0 已并行安装并由 apps/notifier/rust-toolchain.toml 选择，全局默认 1.86 未改。系统仅存在非 Developer ID 的其他项目签名身份，本应用使用 ad-hoc，不挪用它。

npm 默认缓存 EACCES，成功改用 `/tmp/dsc-notifier-npm-cache`；rustup 官方下载超时，USTC 完成工具链安装（随后 self-update 报错，但 rustc/cargo +1.90.0 实际执行成功）。Cargo 构建临时使用 `.debug/notifier-native/cargo/config.toml` 的 USTC source replacement，不写用户全局配置。通常使用默认 registry 即可，不将本机镜像设置作为产品依赖。

已通过：npm ci、typecheck:notifier、test:notifier-source、Tauri build、应用 TypeScript 检查和 Rust 动作白名单测试。`test:notifier-smoke` 默认构建因 generated/execution-assets 缺失失败；显式 stock 构建成功，随后 smoke 在 notifier-companion-tests.cjs:70 等待 Agent liveSession 超时；尚未运行 locale smoke。stock 路径只作对照，不替代默认执行后端验收。完整日志在 `.debug/notifier-native/stock-smoke-corrected.log` 和 `.debug/vscode-smoke/notifier-companion/artifacts/`。

图标修正版 ZIP 位于 `.debug/notifier-native/notifier-macos-arm64-icon-fixed.zip`，SHA256 `68bdcfc0fdc406dba4a5837b39a029ab805928c42aa3f1157e0d782a29477a32`，安装副本签名校验通过。可提交的原始原生日志为 `apps/notifier/validation/2026-11-01-macos.log`，逐项说明见设计文档“macOS 安装包实测”。测试包没有 IDE IPC，不可将应用自身窗口激活当作 IDE 多窗口回跳。

下一步先复核首次授权错误与系统图标缓存，然后定义端侧协议及向量、注册来源并接 companion；必须建立两套隔离 IDE 来源才能测试同名节点路由。不要修改用户现有 Remote SSH 中运行的任务作为测试夹具。资源预算需统计 Tauri 与 WebKit 进程合计并测启动耗时；当前只有主进程 RSS 样本。


最终图标资源使用 `notifier.icns`，包摘要 `880191699dfbe4d22bfcc73739fec25d047df75ebed7c61e6f6e54b0c7895034`，产物 `.debug/notifier-native/notifier-macos-arm64-final.zip`。安装资源已解码确认正确；重新注册后系统横幅仍显示旧图标，待定位缓存边界。`test:common-dependencies` 通过（40 文件）；最终 Rust 白名单测试 1 项通过。未完成项仍按进度表推进，不将平台子批次收口等同里程碑一或二完成。

2026-11-01 后续决策：先落地严格 v2 JSON 行契约与共享向量，再接入 IPC；未知接单状态不触发工作台回退，query absent 不是迟到 publish 的取消屏障。正式字段、24 小时事件有效期及 7 天/2000 条历史预算见设计文档“端侧协议 v2”。此项完成前不把现有 v1 focusAction 任意命令直接接入本机服务。


### 2026-11-01 本地桥接与开发环境恢复

实现 Unix socket 0600 / runtime 0700、排他进程锁及每次启动轮换的凭据；事件先原子保存再返回 accepted，存储文件上限 24 MiB/2000 条，单来源活动事件上限 256。记录与路由按来源实例隔离，update 不重弹，sync 撤销已失效事件。Swift identifier 只携带不透明 token。主扩展二次校验 generation、workspace、canvas 与 attentionPending，然后 centerNode 并请求本窗口置前；unknown 不再工作台重投。服务器 focusResult 绑定原连接和短期待回执。单元测试覆盖身份、凭据、分片/超长帧、落盘失败、重试、撤销和异步同步竞争。

本轮实际安装应用 ZIP：`.debug/notifier-native/notifier-macos-arm64-ipc.zip`，SHA256 `cd03e693049b9b4cdd342e3eb927e68a658cb785022a9f6d11df4d3d820e3786`，签名校验通过。旧应用备份 `.debug/notifier-native/DSCanvas Notifier.before-ipc.app`。两套隔离 VS Code 1.144.0（本轮已更新，不改写前轮 1.140.0 记录）使用 `/tmp/dsc-nc-94ugcjlp/{A,B}/user`，workspace 为 `.debug/notifier-native/ide-acceptance/source-{A,B}/same`，同名 Terminal 节点通过真实 shell OSC 9 提交成功，证据在相应 evidence/posted.json。首个夹具错误把 terminal live 状态写成 running，修正后两套均 ready；保留 initial-test-predicate-failure.json，不视为产品故障。

桌面自动化此时只能定位到旧 terminal-notifier 通知，已请用户点击 A/B；未得到 clicked.json 前不记回跳通过。对已存在的 Remote SSH dev_labs 做非交互连接时，跳板机拒绝 publickey/password；未修改已有远端任务，远端验收仍未完成。CPU/内存归属查询 launchctl procinfo 要求 root，不为采样提权，尚无完整进程树资源预算。

2026-11-01 09:46Z 对已安装 Notifier 做无来源连接 RSS 采样：`dsc-notifier` 42,800 KiB、同启动时长的 WebKit GPU 11,328 KiB 与 WebContent 10,640 KiB，合计 64,768 KiB（约 63.3 MiB）；三个进程 elapsed 均约 01:30:06。09:51Z 又取三条相隔 5 秒的样本，进程树 RSS 合计为 69,040、69,344、69,616 KiB。另有运行更久的系统 WebKit 进程未计入。原始读数见 `apps/notifier/validation/2026-11-01-macos-idle-resource-snapshot.json`。这些单会话短间隔观测不构成资源预算；未重启用户当前应用，因此启动耗时未测。`dev_labs` 再次以 BatchMode SSH 连接仍拒绝 publickey/password；本机列有 5 个 identityfile 配置但均不可读，ssh-agent 未列出可用身份。未尝试修改密钥、Keychain 或远端任务；Remote SSH 需要恢复可用凭据后再做隔离窗口验收。

用户截图报告默认 F5 构建缺少 generated/execution-assets。本机已安装扩展 0.26.1 的六目标资产通过 readPackagedExecutionAssetSet（包含当前 owner/shared-owner/patch 源码和原生文件摘要检查），原字节复制到未跟踪的 generated/execution-assets 后再次通过全量资产集校验。来源与摘要记录在 `.debug/notifier-native/local-execution-assets-provenance.json`。此恢复仅用于本机开发，不冒充本分支正式 release acceptance；没有降低默认六目标校验或切成 stock。新增明确的 Native Notifier Local Window F5 入口设置开发变量，原有入口不变。


本轮最终进度：默认 `npm run build`、companion build、两扩展 typecheck、v1 协议、notifier-source、common-dependencies、smoke runner 环境测试均通过。新协议 44 个请求 + 19 个响应共享向量、11 项 Rust 测试通过；socket 客户端覆盖丢回执/absent 查询/异步 sync 竞争/IDE 查询超时；Host 实际方法测试覆盖已签发 eventId、确认后同代重新提醒、等待 webview 期间换代与 unknown 不回退。旧默认 smoke 的历史失败未追认通过。A/B 点击等待未收口，来源已离线；不要再以点击这两条残留通知来验收在线回跳，下一轮需重新启动隔离来源。可提交证据见 `apps/notifier/validation/2026-11-01-ipc.{json,log}`，完整本地失败记录保留在 .debug 下。

2026-11-01 后续原生回跳复验：此前 A3 等待人工点击期间宿主退出，旧 A3 通知不再用于回跳验收。B3 隔离窗口因 terminal 长时间停在 `Waiting for node size before starting the embedded Terminal.` 未能产生通知，失败证据保留在 `/tmp/dsc-native-acceptance-20261101/B3/evidence/failure.json`。使用 VS Code CLI（而非 Electron 主二进制）并传入 Chromium 窗口尺寸参数后，B4 与 A5 两个全新隔离本地窗口均启动真实 Terminal，分别经真实 shell OSC 9 由已安装 Notifier 持久化接单；UI 观察同时显示 2 个在线 IDE 来源。用户分别点击两条新通知后，两份 `clicked.json` 均确认 eventId/nodeId 对应、`windowFocused=true`、`centerOnly=true`、`selectionUnchanged=true`、`attentionPending=true`；随后 `completed.json` 确认节点 acknowledgement 后旧 eventId 被拒绝。VS Code 为 1.144.0，本次实际安装包为 `.debug/notifier-native/notifier-macos-arm64-ipc.zip`，SHA256 `cd03e693049b9b4cdd342e3eb927e68a658cb785022a9f6d11df4d3d820e3786`，来源代码提交 `b28d048bab232306c5cc0f10bf888992409c468b`。可提交摘要与分窗口回执见 `apps/notifier/validation/2026-11-01-macos-native-ide-click/`，原始 runner 在 `/tmp/dsc-native-acceptance-20261101/{B4,A5}/`。两 runner 清理阶段调用 `resetState` 均报告 local final snapshot pending，但各自诊断序列随后出现 `state/persistWritten`；点击和完成断言已独立写入回执，清理异常未抹去该证据，需作为夹具 teardown 问题单独跟进。Remote SSH 仍未验收；本轮两个窗口都是本地隔离来源。
