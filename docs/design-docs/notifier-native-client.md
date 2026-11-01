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
