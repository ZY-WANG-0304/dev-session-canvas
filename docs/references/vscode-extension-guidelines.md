# VS Code 插件规范设计参考

## 文档定位

- 性质：外部参考整理，不代表本仓库已确认的设计结论。
- 用途：为本仓库后续 VS Code 插件相关设计文档、ExecPlan 和实现评审提供官方规范基线。
- 本地正文入口：`docs/references/vscode-official-extension-docs/`
- 整理时间：2026-04-21。
- 术语说明：VS Code 官方文档主要使用“Extension（扩展）”，本文保留“插件”这一习惯说法，但以“扩展”作为正式术语。

## 1. 官方设计对象与最小交付单元

VS Code 扩展的核心由三部分组成：

- `package.json` 扩展清单（Extension Manifest）
- 激活入口与运行时代码，通常导出 `activate` / `deactivate`
- `contributes` 中声明的静态能力，以及运行时通过 VS Code API 注册的动态能力

官方文档把扩展设计拆成三类概念：

- Activation Events：扩展何时被激活
- Contribution Points：扩展向 VS Code 暴露哪些静态能力
- VS Code API：激活后实际执行哪些行为

设计文档至少应显式回答：

- 扩展的唯一标识是什么：`publisher.name`
- 扩展入口跑在哪个宿主：`main`、`browser` 或两者都有
- 哪些能力是静态贡献，哪些能力是运行时注册
- 激活条件是什么，是否会影响启动性能

## 2. Manifest 设计基线

`package.json` 是扩展设计的正式边界面，设计阶段至少应明确以下字段是否需要：

- 基本标识：`name`、`displayName`、`publisher`、`version`
- 兼容性：`engines.vscode`
- 运行入口：`main`、`browser`
- 激活策略：`activationEvents`
- 能力声明：`contributes`
- 运行位置偏好：`extensionKind`
- 受限工作区能力：`capabilities.untrustedWorkspaces`

设计约束：

- 不要把本可静态声明的能力全部塞进运行时代码。
- 不要在设计文档里只写“提供命令/面板/设置”，而不写清具体 contribution point。
- 如果要兼容 Web、Remote、Codespaces，`browser`、`extensionKind`、文件访问方式都要在设计时一次性说清。

## 3. 激活与性能规范

官方建议扩展只在用户真正需要时激活。设计时应优先使用最小激活范围，而不是通配激活。

推荐顺序：

- 由命令、视图、语言、任务类型、Webview 恢复等具体事件驱动激活
- 确有必要时使用 `onStartupFinished`
- 仅在极少数基础设施型扩展中考虑 `*`

当前官方文档的几个重要版本点：

- 自 VS Code 1.74.0 起，`commands`、`views`、`languages`、`customEditors` 等已声明贡献通常不再需要额外重复声明对应 `onCommand`、`onView`、`onLanguage`、`onCustomEditor` 激活事件
- `onStartupFinished` 会在启动主链路之后触发，适合不阻塞启动但仍需预热的逻辑

设计文档应显式记录：

- 每个激活入口服务哪个用户动作
- 激活后会初始化哪些资源
- 哪些初始化可以延迟到首次真正使用时再做

## 4. UI 贡献规范

官方 UX 指南的总原则是：优先复用 VS Code 原生界面模型，只在原生能力不足时引入更重的 UI。

### 4.1 命令与命令面板

- 所有主要能力都应有可发现的命令入口
- 命令名应直观、动作导向
- 命令是用户发现能力、键盘访问、自动化集成的基础面

### 4.2 设置

- 扩展配置应通过 Settings 暴露，而不是自建设置页面或设置型 Webview
- 每个设置都应提供默认值
- 描述应清晰、短、可搜索
- 对复杂设置应链接文档或相关设置项

### 4.3 上下文菜单

- 只在上下文合适时显示动作
- 相似动作应分组
- 大量动作应放入子菜单
- 不要对所有文件、所有节点无差别显示菜单项

### 4.4 状态栏

- 只放少量高价值信息
- 全局性状态放左侧，局部/上下文状态放右侧
- 文案尽量短
- 不要自定义颜色；错误/警告背景色只用于少数高优先级场景
- 背景进度可用状态栏加载项，需用户关注时再升级为通知

### 4.5 Walkthrough

- 仅在确有上手门槛时提供 onboarding
- 步骤数量保持克制
- 每步应有明确动作
- 图片需兼容不同主题，优先可主题化资源

## 5. Webview 使用规范

官方态度很明确：Webview 只应在原生 API 无法满足时使用。

设计上必须先回答：

- 为什么 Tree View、Quick Pick、Custom Editor、Settings、原生命令等不足以覆盖需求
- Webview 是编辑器面板、侧边栏视图，还是自定义编辑器
- 这部分能力是否必须跨平台、跨 Remote/Web 环境可用

必须遵守的设计约束：

- 仅在绝对必要时使用 Webview
- 不要把推广、升级提示、赞助入口做成 Webview
- 不要在每个窗口自动打开 Webview
- 不要用 Webview 重复已有原生能力
- Webview 内所有元素都应支持主题、键盘导航和无障碍

安全基线：

- 最小化能力：不需要脚本就不要启用 `enableScripts`
- 最小化本地资源访问：通过 `localResourceRoots` 限缩，若不需要可设为空
- 配置 CSP：在 `<head>` 中提供 Content Security Policy
- 资源地址应通过官方 Webview URI 机制生成，不要硬编码旧式资源协议

如果设计文档涉及 Webview，至少要写清：

- 状态同步模型：扩展宿主与 Webview 如何通信
- 资源加载策略：脚本、样式、图片来源
- 安全边界：脚本、消息、CSP、本地文件访问
- 恢复策略：窗口刷新、面板恢复、会话恢复时如何处理

## 6. 运行环境与兼容性规范

VS Code 扩展可能运行在三类宿主中：

- `local`：本地 Node.js extension host
- `remote`：远端 Node.js extension host
- `web`：Browser WebWorker extension host

这意味着设计文档不能默认“本机 Node 环境永远可用”。

### 6.1 `extensionKind`

设计时应根据能力边界明确运行位置偏好：

- `["workspace"]`：需要靠近工作区内容运行
- `["ui", "workspace"]`：优先 UI 侧，但可回退到工作区侧
- `["workspace", "ui"]`：优先工作区侧，但可回退到 UI 侧

### 6.2 Web 扩展

若要支持浏览器宿主：

- 使用 `browser` 入口，而不是仅依赖 `main`
- 代码通常要打包成单文件
- 文件访问应通过 `vscode.workspace.fs`
- 不能依赖子进程、可执行文件、Node 原生全局对象
- 网络访问走 Fetch，并满足 CORS

对只含静态贡献点的扩展，官方说明它们天然更容易兼容 Web；对带代码的扩展，则需要显式补齐 Web 入口与打包策略。

### 6.3 Virtual Workspace / Remote / Codespaces

若能力依赖真实本地文件系统、shell、进程、端口转发或系统设备，设计文档必须标明：

- 在 Remote / Codespaces 下是否可用
- 在 virtual workspace 下是否降级
- 不可用时 UI 如何隐藏或提示

## 7. 安全与信任规范

### 7.1 Workspace Trust

官方建议扩展显式声明自己对不受信工作区的支持策略，而不是依赖默认行为。

设计时至少要确定：

- `capabilities.untrustedWorkspaces.supported` 是 `true`、`false` 还是 `limited`
- 受限模式下哪些能力仍可用
- 哪些命令即使在 UI 被隐藏，也必须在代码里继续阻止执行

### 7.2 发布安全

发布到 Marketplace 时，`vsce` 会执行额外约束检查。设计和资产准备时应避免：

- `icon` 使用 SVG
- `README.md`、`CHANGELOG.md` 中使用非 `https` 图片
- 非可信来源的 SVG badge / 图片
- 把密钥、凭据、`.env` 等敏感内容打进发布包

额外注意：

- 官方文档明确提出，使用 Proposed API 的扩展不能发布到 Marketplace
- VS Code 1.97 起，安装第三方发布者扩展时会显示发布者信任确认；这意味着扩展的仓库、License、README、变更记录等元数据需要足够完整，帮助用户建立信任

## 8. 测试、打包与发布规范

### 8.1 测试

设计文档应区分三类验证：

- 单元测试
- 扩展集成测试
- 跨宿主兼容验证（Desktop / Remote / Web）

官方工具基线：

- Electron 环境扩展测试：`@vscode/test-electron`
- Web 扩展测试：`@vscode/test-web`

### 8.2 打包

官方推荐打包扩展，原因有二：

- 提升安装与加载性能
- 支持 VS Code for the Web 等只能加载单文件扩展代码的环境

可选打包工具包括 `esbuild`、`webpack`、`rollup`、`Parcel`。无论选哪一种，设计文档都应记录：

- 入口文件
- 输出文件
- 是否区分 Node 与 Web 两套构建
- 是否保留 sourcemap

### 8.3 发布

发布有两种基本路径：

- 生成 `.vsix` 供手工分发安装
- 使用 `vsce publish` 发布到 Marketplace

发布设计时应同步考虑：

- 是否需要 CI 自动发布
- `VSCE_PAT` 如何安全存储
- `README.md`、`CHANGELOG.md`、License、仓库链接是否完整
- 图标、截图、分类、标签是否满足 Marketplace 可发现性要求

## 9. 设计文档建议模板

如果后续要在本仓库中编写正式设计文档，建议至少包含以下小节：

1. 目标与非目标
2. 扩展形态：命令、视图、Webview、Custom Editor、语言能力等
3. Manifest 设计：`contributes`、`activationEvents`、`extensionKind`、`browser/main`
4. 运行环境：Desktop、Remote、Web、Virtual Workspace
5. 安全设计：Workspace Trust、Webview CSP、敏感数据处理
6. UX 设计：设置、上下文菜单、状态栏、onboarding
7. 性能策略：激活时机、懒加载、预热边界
8. 测试与发布：自动化验证、打包、Marketplace 发布约束

## 10. 面向本仓库的使用建议

由于本仓库已经进入正式开发阶段，这份参考更适合作为“设计约束输入”，而不是直接复制到正式设计结论中。后续如果某项功能要落到正式设计文档，建议逐项把下面这些问题写实：

- 我们具体用了哪些 contribution points
- 为什么需要该激活方式，而不是更晚激活
- 是否真的需要 Webview，原生 UI 为什么不够
- 是否支持 Web / Remote / Codespaces
- Restricted Mode 下哪些行为被禁止
- 发布包和文档元数据是否满足 Marketplace 约束

## 本地入口

- 本地副本说明：`docs/references/vscode-official-extension-docs/README.md`
- 扩展文档首页：`docs/references/vscode-official-extension-docs/api/index.md`
- Manifest 参考：`docs/references/vscode-official-extension-docs/api/references/extension-manifest.md`
- Activation Events：`docs/references/vscode-official-extension-docs/api/references/activation-events.md`
- Contribution Points：`docs/references/vscode-official-extension-docs/api/references/contribution-points.md`
- VS Code API 入口：`docs/references/vscode-official-extension-docs/api/references/vscode-api.md`
- Webview 指南：`docs/references/vscode-official-extension-docs/api/extension-guides/webview.md`
- Workspace Trust：`docs/references/vscode-official-extension-docs/api/extension-guides/workspace-trust.md`
- Virtual Workspaces：`docs/references/vscode-official-extension-docs/api/extension-guides/virtual-workspaces.md`
- UX Guidelines 总览：`docs/references/vscode-official-extension-docs/api/ux-guidelines/overview.md`
- Publishing Extensions：`docs/references/vscode-official-extension-docs/api/working-with-extensions/publishing-extension.md`
- Extension Marketplace：`docs/references/vscode-official-extension-docs/docs/configure/extensions/extension-marketplace.md`
- Extension Runtime Security：`docs/references/vscode-official-extension-docs/docs/configure/extensions/extension-runtime-security.md`
- Theming：`docs/references/vscode-official-extension-docs/api/extension-capabilities/theming.md`
- Color Theme：`docs/references/vscode-official-extension-docs/api/extension-guides/color-theme.md`
- File Icon Theme：`docs/references/vscode-official-extension-docs/api/extension-guides/file-icon-theme.md`
- Product Icon Theme：`docs/references/vscode-official-extension-docs/api/extension-guides/product-icon-theme.md`
- Theme Color：`docs/references/vscode-official-extension-docs/api/references/theme-color.md`
- Icons In Labels：`docs/references/vscode-official-extension-docs/api/references/icons-in-labels.md`

补充说明：

- `Web Extensions` 当前未保留本地副本，使用官方来源链接。

## 官方来源

以下为本地副本对应的 VS Code 官方来源，访问时间均为 2026-04-21：

- https://code.visualstudio.com/api/get-started/extension-anatomy
- https://code.visualstudio.com/api/references/activation-events
- https://code.visualstudio.com/api/references/contribution-points
- https://code.visualstudio.com/api/ux-guidelines/overview
- https://code.visualstudio.com/api/ux-guidelines/settings
- https://code.visualstudio.com/api/ux-guidelines/context-menus
- https://code.visualstudio.com/api/ux-guidelines/status-bar
- https://code.visualstudio.com/api/ux-guidelines/walkthroughs
- https://code.visualstudio.com/api/ux-guidelines/webviews
- https://code.visualstudio.com/api/extension-guides/webview
- https://code.visualstudio.com/api/advanced-topics/extension-host
- https://code.visualstudio.com/api/extension-guides/web-extensions
- https://code.visualstudio.com/api/extension-guides/workspace-trust
- https://code.visualstudio.com/api/working-with-extensions/bundling-extension
- https://code.visualstudio.com/api/working-with-extensions/continuous-integration
- https://code.visualstudio.com/api/working-with-extensions/publishing-extension
- https://code.visualstudio.com/docs/editor/extension-marketplace
- https://code.visualstudio.com/docs/configure/extensions/extension-runtime-security

## 验证说明

- 已人工核对文档内容仅总结官方资料，不包含仓库内部未经确认的设计结论。
- 已补充来源链接，便于后续协作者回溯原文。
