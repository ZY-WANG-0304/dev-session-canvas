# 补齐后台持久运行引导的配置与重载闭环

本计划遵循 `docs/PLANS.md`，持续维护进度、发现、决策与结果。

## 目标与全局图景

用户指出当前引导只配置 linger，没有开启 Runtime Persistence，因而显示完成并不代表窗口已启用持久运行。交付后用户依次检查主机、按需开启 linger、开启扩展配置、确认重载、重新验证。系统就绪但开关关闭时应进入配置步骤；配置开启但当前窗口未应用时应进入重载步骤；只有三项同时满足才自动完成最终验证。

## 进度

- [x] (2026-11-03) 核对能力控制器与现有配置读取、重载确认、模式清理流程。
- [x] (2026-11-03) 确定原生设置入口和三重完成条件，记录设计。
- [x] (2026-11-03) 接入配置状态、补充双语引导步骤和命令。
- [x] (2026-11-03) 覆盖状态组合、取消/失信与已有模式切换回归，中英文隔离原生宿主 smoke 通过。
- [x] (2026-11-03) 同步验证结果与限制，归档计划。

## 意外与发现

`RuntimePersistenceSetup` 只知道系统能力，原来的所有后续完成事件只要求 `eligible`。`CanvasPanelManager` 同时拥有 requested（配置读取值）和 applied（当前窗口实际启动模式）；它可能因系统前提不足保留旧模式，不能用设置值代替应用状态。现有模式切换有清空画板与会话的语义，必须沿用 `notifyReloadRequiredConfigurationChanged` 的告警、确认和清理，不直接调用 reload 来绕过。

原生 Walkthrough 保存历史进度；最终步骤的语义加强后改用新标识 `verifyApplied`，避免沿用旧版仅检查环境的完成记录。宿主 smoke 的原生设置复选框实际使用 `setting-value-checkbox` 而不是 `monaco-checkbox`，改用可访问 role/name 定位；VS Code 1.140 在此宿主中将 Settings 展示为浮层，检查后按 Esc 返回引导。

宿主原生设置写入有延迟，过快关闭设置浮层可能取消未提交的变更。Smoke 必须等待隔离 user-data 的配置文件确实写入 true，再返回引导，不能把 checkbox 的乐观视觉状态当作生效证据。控制器始终读取真实有效配置，因此未写入时会正确留在配置步骤。

## 决策记录

- 决策：新增“开启 Runtime Persistence”和“重载以应用”两步，继续使用原生 Walkthrough，每步一个主要动作。日期：2026-11-03。
- 决策：开启配置按钮打开精确过滤的原生 Settings，由用户选择 User / Remote / Workspace 范围并勾选；不替用户猜作用域，不静默覆盖 workspace 设置。原生配置事件保留既有重载提醒，引导另提供可重试的重载入口。日期：2026-11-03。
- 决策：检查事件发布系统资格与 requested/applied 的联合结果，背景检查仍不推进；只有 eligible + requested + applied 才发布 ready。重载入口先复查，只在缺应用状态时交给既有模式切换确认流程。日期：2026-11-03。

## 结果与复盘

已交付五步引导、原生设置入口、复用现有确认/清理的重载入口与系统/请求/应用三重完成条件。检查与打开引导不再无条件追加重载提醒；配置变更的原通知保留。Output 区分配置关闭、待重载与已应用。最终验证使用新 id，旧三步的错误完成记录不被复用。

51 项能力、77 项控制器/实际 Manager 方法、7 项服务端检查通过；manifest、本地化、类型检查、构建、配置读取、模式切换竞态/真实 socket/PTY 和两扩展真实 VSIX 打包清单通过。中英文 VS Code 1.140.0 smoke 实际点击临时 Settings 开关，验证关闭时选配置、保存后选重载但最终未完成、注入已应用后才完成，共 28 项宽窄按钮几何检查通过；已查看中文 640px 配置和重载截图。

没有安装或发布扩展，没有修改当前账号 linger、当前用户设置或生产会话。UI 测试的 applied 为注入值，真实重载控制由实际 Manager 方法受控测试及既有模式切换回归覆盖，不代证真实 Remote SSH 和零登录存活。远端/最低宿主/语言包/跨平台等既有验收缺口保留在技术债中。

## 上下文与定向

`extensions/vscode/dev-session-canvas/src/panel/runtimePersistenceSetup.ts` 负责检查、进度、导航、Output 和安全执行 linger。`CanvasPanelManager.ts` 持有配置请求和应用状态，负责模式切换确认及清理。`src/extension.ts` 注册命令，`src/common/extensionIdentity.ts` 集中标识。扩展目录的 `package.json`、`package.nls*.json`、`l10n/` 和 `walkthroughs/` 维护原生贡献与双语文案。

## 工作计划

先向控制器注入只读配置状态 getter，以最新系统资格和配置共同计算下一步，并在报告中区分配置关闭、等待重载和已应用。增加设置和重载内部动作，后者由 Manager 调用既有确认流程，不修改 applied。扩展 manifest 和媒体加入两步，更新完成事件，避免开关关闭时验证仍被勾选。然后更新控制器、manifest、打包和隔离宿主测试，并跑模式切换回归。

## 具体步骤

仓库根执行 `npm run test:runtime-persistence-setup`、`npm run test:extension-manifest`、`npm run test:ui-copy-localization`、`npm run typecheck`、`npm run build`，以及 `node scripts/test/test-state-configuration-reuse.mjs`、`npm run test:runtime-mode-switch-races`（已包含 socket 用例）、`npm run test:package-vsix-file-list`。原生宿主使用 `xvfb-run -a npm run test:runtime-persistence-walkthrough -- .vscode-test/vscode-linux-x64-1.140.0/code`。

## 验证与验收

注入系统 eligible 时，requested=false 必须选配置且最终未完成；requested=true/applied=false 必须选重载且最终未完成；两者 true 才选最终验证并完成。检测失败或 linger 缺失优先回到前提步骤。打开设置不写配置、不改变应用状态；重载前保留清空告警与取消路径。真实宿主检查双语、宽窄按钮、配置/重载/验证的选择和完成状态，所有终端执行均被禁止。

## 幂等性与恢复

读取与打开设置可以重复，不写真实设置。取消重载保留当前窗口状态；用户可返回设置撤销请求或再次检查。不要重置工作树既有改动。测试使用独立用户目录，禁止真实终端；任何注入结果不能写成实际系统已配置。

## 证据与备注

本轮修复针对“环境 ready 被误当成配置完成”，既有三步引导的历史证据保留在 `docs/exec-plans/completed/runtime-persistence-walkthrough.md`，不能代证新的完整流程。

最终宿主工件为 `.debug/runtime-persistence-walkthrough-2a91cd16-27f3-416a-b19a-11586c85c2de/`，包含双语宽窄截图、原生设置页、Output、复制命令与仅记录不执行的 reload 请求。上一轮同代码路径的可视检查工件为 `.debug/runtime-persistence-walkthrough-20bc766a-04f5-421c-8c7f-4b3429f6e0e0/`。控制器测试明确证明“eligible + 配置 false”不会发布 ready；真实 Manager 测试验证取消不清理、确认后先清理再重载、清理失败不重载、失信/配置关闭/已应用/过期动作不提示重载。

## 接口与依赖

控制器增加只读 `getConfiguration(): { requested: boolean; applied: boolean }` 注入；新增 `settings` / `reload` 动作。沿用公开 `workbench.action.openSettings`、`workbench.action.openWalkthrough` 和原生告警，不新增依赖或私有 API。

修订：2026-11-03 根据用户指出的缺失配置步骤建立计划，明确系统资格不等于窗口已启用。

修订：2026-11-03 完成实现、联合状态与原生设置操作回归，记录宿主设置延迟写入发现、最终测试证据与真实远端验收边界，归档计划。
