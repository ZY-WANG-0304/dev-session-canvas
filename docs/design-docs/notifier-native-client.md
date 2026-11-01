---
title: 跨平台 Notifier 端侧应用
decision_status: 已选定
validation_status: 验证中
domains: [VSCode 集成域, 执行编排域, 项目状态域]
architecture_layers: [宿主集成层, 适配与基础设施层]
related_specs: [docs/product-specs/canvas-node-notifications.md]
related_plans: [docs/exec-plans/active/notifier-native-client.md]
updated_at: 2026-11-01
---

# 跨平台 Notifier 端侧应用

## 背景与目标

用户决定停止当前 IntelliJ 实现路线，改为自研本机通知应用，替代 terminal-notifier / osascript 所承担的通知后端职责。目标是提供独立应用身份、可靠的来源定位、可查阅的待处理提醒，以及多窗口和远端开发场景的一致通知体验。旧工具无法满足需求是本次产品方向输入，不表示已经完成针对它们的技术根因实验。

2026-11-01 用户认可独立应用与 IDE 薄适配器的分工，以及 Tauri + Rust + TypeScript 的实施方向。方案已选定；2026-11-01 已实现 macOS 通知适配与最小 Tauri 界面，完成本地 ad-hoc 安装包的通知点击、撤销和冷启动回调验证，IDE 来源接入仍未实现。macOS 首先完成真实闭环，Windows / Linux 仍属于目标支持平台，不以 Mac 成功代证三平台成功。

## 候选方案与取舍

Swift 主体容易优先满足 macOS 原生需求，但不能复用 Windows / Linux 的主要实现，因此不作为跨平台主体。Tauri 外壳、Rust 核心与 React / TypeScript UI 能分别承载桌面集成、共享业务和界面，选为实施基线；平台通知能力不足时补薄原生适配。Electron 是框架阻塞时的备选，不同时维护两套应用；只有明确记录 Tauri 缺口、补丁成本和同场景对照证据后才调整决定。框架版本、插件能力、最低系统版本和资源消耗尚待实测，不能从选型推导性能结论。

## 正式方案

### 职责与落点

主扩展 `extensions/vscode/dev-session-canvas/` 继续识别 attention 信号并持有节点状态。现有 `extensions/vscode/dev-session-canvas-notifier/src/extension.ts` 逐步收缩为本机连接适配器：注册来源、转发事件、执行白名单定位动作；`src/platformNotification.ts` 的旧后端在迁移验收完成前保留，但不得与新后端同时投递同一事件。

计划新增 `apps/notifier/`，其中 `src/` 放 React 界面，`src-tauri/` 放 Tauri 外壳、Rust 连接管理、持久化、去重与回跳路由。目前已有最小界面与 macOS 适配骨架；收件箱和来源核心未实现。应用平时驻留托盘或菜单栏，提供系统通知、待处理列表、历史记录、设置与诊断。第一版采用单个用户态应用进程，不拆出独立系统服务。

`packages/attention-protocol/src/index.ts` 现有 v1 协议仅服务两扩展。新增端侧协议前保留其兼容边界，以版本化纯数据契约和共享测试向量覆盖 TypeScript / Rust，不把现有任意 command 字段直接开放给本地外部客户端。具体类型在实施计划第一阶段落定。

### 支持范围

首版保留 BEL、OSC 9、OSC 777、Agent 非主动异常退出和用户显式开启的 Codex 最终失败文本提醒，沿用 allow-list、声音配置、画布提示及工作台回退。不能把 BEL 自动解释成任务完成。等待输入、批准请求和完成事件的语义分类，只有接入层有可靠证据后才新增；它们不是本次端侧替换的前置条件。

新应用支持多窗口、多 workspace、本地与 Remote SSH / WSL / Container 经本机 companion 转发的事件；支持去重限流、状态同步、应用重启恢复、权限状态、测试通知、诊断、安装升级和卸载。应用历史需有容量与保留期上限，正文默认不写诊断日志；具体预算在实现前记录。登录启动由用户设置控制。

不实现 IntelliJ 适配、直接回复 Agent、批准工具执行、云端推送或跨设备同步。用户明确不需要关闭 IDE 后继续提醒，因此不建设 supervisor 直连或远端常驻推送。IDE 离线后保留有限历史并标注来源离线；点击时说明不可用，不默认重新启动 IDE。

### 身份、通信与状态

本机应用接收 IDE 适配器的连接，不对远端执行主机暴露监听端口。Unix 平台优先采用受当前用户权限保护的 Unix socket；Windows 采用用户权限限制的 named pipe，二者是相同帧协议的传输适配。增加本机凭据校验、帧大小限制、超时和版本握手；凭据不得进入通知正文、回调 URI 或日志。实现前在三平台验证工具链及传输可用性。

事件身份包含 eventId、来源实例、workspace、canvas、node、executionGeneration、发生时间、有效期及合并键。显示名不参与身份判断。来源实例用于当前连接路由，稳定对象身份用于重连核对；不能把旧实例 token 自动绑定到同名新窗口。每次回跳都验证连接、节点及执行代次。通知的外部回调仅携带不透明 token，内部动作只允许已登记的打开来源或测试动作。

IDE 是 attention 权威，应用保存派生记录。事件支持发布、更新、撤销、来源状态同步及定位请求/结果。应用区分已持久化接单、系统提交结果、用户操作和定位结果；OS 接单不等于用户看见。应用先持久化再确认接单；同 eventId 重试应返回已有结果。回执丢失时先查同事件状态，未知结果不得冒充明确失败。实施时明确回退仲裁：确定未接单才投工作台；不能先回退再允许迟到的新通道请求弹出。该边界必须有断线/超时反例测试，不能声称跨两个外部系统实现无条件 exactly-once。

点击通知只居中来源节点，不自动选中、不清除 attentionPending。节点处理由 IDE 同步；收件箱关闭记录与画布确认是不同动作。删除节点、换代执行及迟到旧事件不得影响新执行。重连先核对权威状态再恢复展示，不把历史通知重新当新事件弹出。

### 迁移与交付

先通过显式开发配置启用新后端，未完成能力不作为 main 的默认路径。应用缺失或明确拒绝接单时保持工作台回退；系统权限拒绝时显示权限诊断，并按明确失败策略回退。安装包交付与 VSIX 分开管理，应用身份、签名、公证、升级兼容及卸载需真实验证。切默认路径与删除旧后端必须在正式安装包闭环通过后单独收口。

## 验证方法与未决项

验收分共享核心自动化、IDE 集成、原生桌面交互和正式安装包四层。Mac 上用本地与 Remote SSH 两窗口完成通知、点击、正确节点定位、重复请求、节点确认/删除/换代、应用重启、IDE 退出、权限拒绝、断线回执丢失和工作台回退。Windows / Linux 用同样场景单独记账，Linux 同时注明桌面环境和通知服务。

每条证据记录 commit、安装包摘要、OS/架构、IDE 版本、原生动作、预期与实际结果、日志位置。开发态或模拟回调不能代证安装包原生点击。已核对插件缺口并验证本机应用窗口激活；Developer ID 签名公证、最低系统版本、完整资源预算、存储保留期与升级通道仍未验证，按 ExecPlan 推进。当前只通过下述 macOS 原生能力验证，产品端到端仍未通过。

## Mac 平台验证决策（2026-11-01）

本轮先构建独立的 AppKit 能力探针，验证 UserNotifications 的真实授权、提交、点击、撤销和重启回调，再将薄适配接入 Tauri。探针位于 `apps/notifier/native-probe/`，不是最终应用，也不连接生产 companion；仅用于里程碑一降风险，验证后保留为平台回归工具或收敛到正式适配。探针使用独立 bundle identity `io.github.zy-wang-0304.dsc.notifier.probe`，不复用其他应用签名身份，不申请登录启动，不改变旧通知路径。仅将请求标识和操作类别写入本地证据日志，不写通知正文。最低部署版本暂定 macOS 11.0，只有当前机器实际验证，不宣称最低版本已测。

依据固定发布版 `tauri-plugin-notification 2.8.0` 的 `src/desktop.rs`：permission_state/request_permission 恒为 Granted，remove_active 在 macOS 为空操作；因此不能将这些返回值作为真实权限或撤销证据。官方文档：https://v2.tauri.app/plugin/notification/ ，固定源码：https://crates.io/crates/tauri-plugin-notification/2.8.0 。薄适配采用 Apple UserNotifications；Tauri 保持选定方向，未作 Electron 对照。正式协议、IDE 多窗口回跳及持久化仍待实现；探针按钮不得代证真实 attention 链路。

下一步正式骨架固定 Tauri Rust 2.12.5、tauri-build 2.7.4、JS API/CLI 2.12.4，Rust 1.90.0 使用项目局部 toolchain，不改变全局默认。macOS 适配通过 Swift 静态库和窄 C ABI 提供查询/授权/投递/撤销及 JSON 回调，Rust 接管有界诊断，React 仅调用白名单测试命令。暂不引入已确认缺口的通知插件。应用身份定为 `io.github.zy-wang-0304.dsc.notifier`，探针身份与产品身份隔离。最低 macOS 11；跨平台通知适配未完成的平台明确报 unsupported。

初始界面只提供权限状态、测试通知、撤销与诊断，不显示未实现收件箱。独立应用无 VS Code theme token，使用系统 Canvas/CanvasText/ButtonFace 颜色及原生字体，支持系统明暗模式、键盘焦点和换行。此界面是平台验收入口，不接收任意命令或回调 URL。原生回调仅记录事实；未实现来源路由前，不宣称回到 IDE。

应用图标沿用 `extensions/vscode/dev-session-canvas-notifier/images/icon.png` 的 Notifier 专属设计，通过 Tauri icon CLI 生成 PNG/ICNS，不使用主扩展图标。


### macOS 安装包实测

2026-11-01，Mac14,7 / arm64 / macOS 26.6.2，Xcode SDK 26.2、Swift 6.2.4。Tauri 0.0.1 的图标修正版已安装到 `~/Applications/DSCanvas Notifier.app`，本地 ad-hoc 签名校验通过。ZIP SHA256 为 `68bdcfc0fdc406dba4a5837b39a029ab805928c42aa3f1157e0d782a29477a32`；原始日志保存在 `apps/notifier/validation/2026-11-01-macos.log`。

系统查询 authorization=2；通知 `9384F979-F4FE-4A87-850B-06C29EC9556D` 先 submitted/will-present，再经真实横幅点击收到 native-response。撤销用例中 `E5339C50-2DB8-4E03-B893-134DCDF449B6` 先出现在 delivered，withdraw-requested 后再次查询 ids=[]。冷启动用例中 `E45BD519-2A83-4131-A331-A37D76E97D94` 提交后通过 Cmd+Q 退出，点击横幅后产生新 launch，并收到同 ID 的 native-response。用户还提供了系统允许通知和横幅截图。首次请求曾回报 error=true/granted=false；经系统设置开启后查询成功，不能把首次授权记录追认为通过。已增加 NSError domain/code 诊断，首次授权失败根因仍待复现。

运行中主进程 RSS 单次采样约 93 MiB（95040 KiB），不包含 WebKit 子进程，不是完整空闲内存预算；启动耗时未测。包内图标 ICNS 与安装副本 SHA256 一致，均为 `2bd416680a0ea19ea79249a88d0826ffa09b29f356ec428f07bcacf4b9f4869b`；系统横幅仍曾显示旧图标，重新注册应用后显示效果待复核，不以资源 hash 代证系统缓存刷新。

尚未实现来源注册、IPC 凭据与帧协议、TypeScript/Rust 向量、持久化收件箱和 IDE 多窗口回跳。签名公证、最低系统版本、Windows/Linux 也均未验收；本批不能切换生产默认后端。


图标缓存复测：改用独立资源名 `notifier.icns`，退出应用后以完整新 bundle 替换安装副本并执行 lsregister -f。最终 ZIP `.debug/notifier-native/notifier-macos-arm64-final.zip` SHA256 为 `880191699dfbe4d22bfcc73739fec25d047df75ebed7c61e6f6e54b0c7895034`；签名校验通过，Info.plist 指向 notifier.icns，直接解码安装资源确认带铃铛专属图标。但系统新横幅仍显示旧主图标，不能宣称系统显示修复完成；保留为本机缓存问题待进一步定位，不重置用户通知数据库或重启系统服务。最终包与上一验证包的变更仅为图标资源文件名及对应配置；新通知提交与展示已观察，上一包的点击/撤销/冷启动证据不冒充对最终包的完整重跑。

### 端侧协议 v2（2026-11-01 实施契约）

旧扩展间 v1 不改为端侧协议。新增 `packages/attention-protocol/src/native.ts` 与 Rust `protocol.rs`，共享 JSON 向量验证结构和时间约束。传输为 UTF-8 JSON 行，每帧含换行最多 65536 字节，必须在解析前限长；字符串限制以 UTF-8 字节为单位，防止两端 Unicode 长度口径不同。版本必须为整数 2，未知字段/动作拒绝，不透传 command、URI、文件路径动作。所有时间是非负安全整数毫秒；eventId/sourceInstanceId/workspaceId/canvasId/nodeId/executionGeneration/mergeKey 都是非空、无控制字符的有界字符串，显示名不参与身份。

客户端请求固定 envelope：version、requestId、credential、sourceInstanceId、operation。register 携带 workspaceId 和 capabilities（只接受 focus-node）；publish 携带事件；update 仅允许修改事件展示正文；withdraw/query 按 eventId；sync 携带最多 256 个当前有效事件 ID（分批状态同步尚未实现时不得默默截断）；focusResult 包含 focusRequestId 和 focused/stale/offline 三态。事件必含 eventId、workspaceId、canvasId、nodeId、executionGeneration、occurredAt、expiresAt、mergeKey、title、body、playSound。有效期最长 24 小时，允许最多 60 秒未来时钟偏差，过期请求拒绝。

服务端回执固定 accepted/rejected/unknown；accepted 只表示事件已持久化接单，不能由 native submitted 推导。query 的 absent 仅表示查询时未找到，不授权回退：此前 publish 可能仍在途；客户端只有连接发送前失败或收到明确 rejected 才能回退，发送后的断线/超时保持 unknown，查询不能将其降格为未发送。后续取消屏障未实现前，不承诺 unknown 自动回退。定位命令固定 focus-node，携带不透明 focusRequestId 和完整稳定目标；来源连接必须先校验自己的 workspace、canvas、node、executionGeneration 后再居中，不接受显示名或任意 command。

连接身份与事件身份分离：每次 extension activation 生成新的 sourceInstanceId；事件键为 (sourceInstanceId,eventId)。同一 ID 的重复 publish 必须与原事件逐字段一致，否则 rejected；异来源同 eventId 不合并。客户端重连不能仅凭 workspace 同名继承旧实例。来源离线后路由拒绝；收到撤销/过期后旧 token 不可定位。首版历史预算定为 7 天、总计 2000 条，先按过期/历史清理；活动事件满额时拒绝新接单，不能为了容量悄悄丢弃待处理记录。正文只在受当前用户权限保护的事件存储中保留，不进入诊断日志；持久化实现前仍不回 accepted。

本节定义契约和预算，落地进度由 ExecPlan 单独记录；结构测试通过不等于 socket、持久化或 IDE 来源链已实现。

IPC 实现采用当前用户家目录下 `~/.dsc-notifier/runtime/`（0700），Unix socket 和 credential/lock/store 文件为 0600，拒绝目录或文件符号链接与非当前 uid 所有权。进程持有排他文件锁后才能清理旧 socket 并创建新凭据；不监听 TCP。凭据每次应用启动重新生成，客户端重连时重读；sourceInstanceId 不随同一 extension activation 的重连变化，但新 activation 必须生成新 ID。单进程最多 16 个连接，每帧受 64 KiB 限制，空闲连接用重复 register 保活。此机制隔离其他系统用户，不声称抵御能读取当前用户文件的恶意进程。

首次桥接仅支持 Mac 开发态环境变量 `DEV_SESSION_CANVAS_NATIVE_NOTIFIER=1`，正式默认仍为旧后端。未建立连接前失败可明确回退；发出 publish 后无明确回执则返回 unknown，主扩展不能再投工作台。原生通知 identifier 使用随机 token；外部通知不携带节点、命令或凭据。点击先查当前已验证来源，发送固定 focus-node；companion 再向主扩展验证目标当前 executionGeneration 后居中。真实来源注册和跨窗口验收完成前，环境变量入口不得当成发布能力。

桥接实现补充：workspaceId 是主扩展 storage URI、workspace 文件 URI 与排序后文件夹 URI 的 SHA-256；不把路径发给通知服务。当前产品为一份组合画布，canvasId 为该 workspace 的固定 canvas 标识。executionGeneration 来自执行 ownership identity 或 managed sessionId，并叠加本窗口 operation token；结束的执行可保留最后身份，但下一次 start/attach/invalidate 后立即失效。每次点击在主扩展检查节点仍存在、attentionPending、workspace/canvas/generation，并在等待 webview ready 后再次检查，发送的仍是 centerNode，不选中、不清 attention。通过来源连接调用本窗口内置 `workbench.action.focusWindow`；该命令在本机 VS Code 1.140.0 安装源码已核实，真实窗口激活仍须安装包验证。

桥接每 10 秒查询主扩展的有效目标，sync 撤销已确认、删除或换代的记录；查询失败不能被当作“全部已处理”。companion 在一次 activation 内保留最多 256 个未过期发送记录（包含已撤销），防止同 eventId 的未知结果被遗忘后重投；超过容量明确拒绝，暂不做截断。服务器 update 持久化独立的展示覆盖，不修改原 publish 去重输入，且不重新弹出通知；已有系统横幅不改写，更新正文待收件箱消费。focusResult 必须匹配原连接的短期待回执 ID，不能凭任意 ID 伪造完成事实。以上属于默认关闭的 Mac 开发入口，不将源码接入或自动测试当成真实多窗口验收。

补充投递边界：主扩展跨 host 执行 companion 命令时，命令不存在才视为明确未发送；命令执行异常或返回格式损坏均保守归为 unknown。明确 error/unsupported 回执仍可回退。每次通过既有 cooldown 的新 attention 生成独立 eventId；同一次发送的重试必须复用完整事件。重连 sync 在异步询问主扩展后比对客户端发送集合版本，若期间新增 publish，则放弃旧快照并等待下一轮，不能误撤销新事件。

同一执行可以在确认后再次请求关注，因此 generation 与 attentionPending 两者不足以判断旧事件有效。主扩展还维护最多 256 条本激活内、未过期的已签发 eventId 集合；确认时立即移除该节点旧事件。随后同代再次 attention 只认可新 eventId，旧通知不能借新的 pending 状态恢复有效。原生事件字段越界时省略可选 nativeEvent，让显式开发入口返回明确未发送；旧 v1 投递不受新协议长度约束影响。
