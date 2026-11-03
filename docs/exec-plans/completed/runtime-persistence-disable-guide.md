# 补齐 Runtime Persistence 的安全退出引导

本计划遵循 `docs/PLANS.md`，持续维护进度、发现、决策与结果。

## 目标与全局图景

用户已接受独立的关闭路径：检查当前状态、取消勾选配置、确认影响并重载、验证已关闭。关闭扩展持久运行不连带关闭账号级 linger。用户可从开启引导、命令面板和侧栏进入，不需要把开启步骤倒着操作，也不会因为系统资格异常而无法退出。

## 进度

- [x] (2026-11-03) 核对现有配置请求/窗口应用状态、共享画板退出与重载确认边界。
- [x] (2026-11-03) 记录独立四步关闭引导与可选只读系统撤销说明的设计。
- [x] (2026-11-03) 接入关闭动作、双语原生页面、命令/链接/侧栏入口和待关闭状态。
- [x] (2026-11-03) 覆盖关闭组合、取消/竞态/清理失败及共享退出回归；119 项控制器/实际 Manager 检查和 21 项共享画板回归通过。
- [x] (2026-11-03) 隔离 VS Code 双语开启/关闭全流程通过，44 项宽窄按钮几何检查通过，人工查看中文窄窗口关闭步骤。
- [x] (2026-11-03) 同步设计、规格、README、索引与验证限制，归档计划。

## 意外与发现

当前开启控制器只在系统 eligible、配置 true、窗口 false 时返回重载请求，不能复用于关闭。关闭仅需配置请求和应用状态，不应调用或等待系统资格检测。侧栏目前在请求 false 时直接显示 Disabled，即使窗口仍运行开启模式；这会误导取消重载的用户，需显示待关闭。

既有 `leaveSharedCanvasesForModeSwitch` 在持有 root 退出保护时判断最后参与者并清理，不应在引导里复制一套不可靠的窗口计数。重载告警应说明两种共享结果，实际执行继续交给现有流程。用户在告警期间可能重新勾选配置，确认后必须再次核对目标模式，不能用关闭确认去执行开启。

模式切换不仅在 Reload Window 时应用，最后一个画板页面关闭/重启及窗口退出也会达到既有边界。取消文案因此明确这些边界，避免用户误认为关闭窗口会撤销请求。

扩展 smoke 的命令面板驱动失败，早期会执行旧标题，等待匹配行或改为逐字键入仍会超时。工件 `22917c53-0169-498d-ad78-d416de8dd7df/en/failure-input.json` 记录输入值退回 `>` 且已失焦，截图显示命令面板已关闭；尚未确证具体切焦来源，不能写成产品关闭检查失败或命令面板缺陷已修。最终只修改隔离测试驱动：用 fixture 专用快捷键调用已注册的精确 command ID，并等待该命令完成工件，避免依赖与本功能无关的搜索框时序。真实页面按钮、设置复选框、结果驱动导航和完成断言保留，不手动选择下一步冒充自动推进；公共关闭命令通过实际注册入口执行，命令面板展示契约由 manifest 测试覆盖。

## 决策记录

- 决策：使用独立原生 Walkthrough 与独立 `disableCheckResult` 进度，不把关闭步骤接到开启流程后。日期：2026-11-03。
- 决策：只读检查关闭状态，无需 linger 或用户管理器正常。原生设置由用户选择作用域并取消勾选；未重载不表示已关闭。日期：2026-11-03。
- 决策：重载复用既有共享退出、清理、错误处理。取消保留已写入的请求，不自动恢复勾选；明确可以重新勾选撤销请求。日期：2026-11-03。
- 决策：可选 linger 撤销仅提供独立只读报告和精确命令，不增加自动执行、sudo 或复制后执行。只有当前窗口已关闭且系统目标可核验时显示命令；无法判断其他服务依赖，因此由用户/管理员评估，绝不声称账号全部会话已结束。日期：2026-11-03。
- 决策：宿主 smoke 的状态注入与公开关闭命令采用仅存在于临时 fixture 扩展的快捷键；核验实际完成的命令 ID，不增加生产快捷键或私有 API。理由：把测试环境准备与原生页面交互分开，避免未定位的命令面板失焦掩盖本功能断言。日期：2026-11-03。

## 结果与复盘

独立四步关闭引导、命令/链接/侧栏入口、待关闭状态、重载期间的配置/信任复核和可选只读系统撤销报告已完成。用户无需先修好系统资格即可退出；关闭扩展不撤销 linger，取消重载也不撤销已保存的配置。清理沿用已有共享退出协议，不另造窗口计数或强杀路径。

控制器/实际 Manager 119 项、能力模块 51 项、服务端 7 项检查通过；共享画板 21/21、模式切换竞态、配置复用、侧栏、manifest、本地化、类型检查和真实打包清单通过。宿主 smoke 中英文开启/关闭均通过，44 项宽窄几何检查通过；实际修改的仅是隔离用户目录的原生设置。未安装或发布扩展，未修改开发账号 linger、生产会话或真实用户设置。

系统观察和 applied 状态仍由 fixture 注入，没有进行真实重载、最后登录退出或系统撤销；真实 Remote SSH、零登录、最低版本、真实语言包与跨平台 UI 仍按技术债跟踪。命令面板失焦的旧失败工件保留，最终通过只证明改后的测试驱动和本轮原生页面路径，不声称该失焦机制已定位修复。

## 上下文与定向

`extensions/vscode/dev-session-canvas/src/panel/runtimePersistenceSetup.ts` 负责现有五步开启引导，getter 返回 requested（有效设置值）和 applied（当前窗口实际模式）。`CanvasPanelManager.ts` 持有真实模式并负责确认、清理与重载；`CanvasSidebarView.ts` 展示状态。扩展 `package.json`、`package.nls*.json`、`l10n/` 和 `walkthroughs/` 定义双语贡献；`extension.ts` 与 `extensionIdentity.ts` 注册动作。系统命令格式由 `runtimePersistenceCapability.ts` 的 UID 验证函数生成。

## 工作计划与里程碑

第一里程碑补控制器与 Manager：关闭检查只读取配置，requested=true 进入取消勾选，false/true 进入重载，false/false 才完成。动作返回区分开启/关闭的重载信号，Manager 在告警前和确认后复核目标，并沿用清理失败不重载。可选系统撤销报告先检查窗口已关闭，再只读检查实际目标和 linger。

第二里程碑加入独立四步贡献、双语媒体和三个入口。侧栏请求 false/应用 true 显示待关闭并点击进入关闭引导；右键提供明确关闭入口。开启页用次要文字链接进入，关闭页也能返回开启。每步保持一个主要按钮，危险影响在窄窗口也可读。

第三里程碑覆盖配置四组合、未知/不支持系统、取消、失信、并发与配置变更；复用既有共享模式退出测试。真实隔离 VS Code smoke 实际取消勾选临时用户配置，验证仍待重载，只有注入窗口关闭后才完成；测试不执行真实系统命令或重载生产窗口。

## 具体步骤

仓库根执行 `npm run test:runtime-persistence-setup`、`npm run test:extension-manifest`、`npm run test:ui-copy-localization`、`node scripts/test/test-sidebar-state-updates.mjs`、`npm run test:runtime-mode-switch-races`、`npm run typecheck`、`npm run test:package-vsix-file-list`。宿主操作用 `xvfb-run -a npm run test:runtime-persistence-walkthrough -- .vscode-test/vscode-linux-x64-1.140.0/code`。

## 验证与验收

系统 unknown/blocked/unsupported 都不能阻止关闭配置检查。请求关闭但仍应用开启时，最终步骤不能自动完成，侧栏必须显示待重载；取消重载不得清理或谎称已关闭。确认前目标改回开启、失去信任、清理失败时不能重载。其他启用窗口仍在使用的共享会话不因本窗口退出被强杀。已关闭验证不代表 linger 已关闭，也不代表其他窗口或服务已退出。撤销说明只在用户单独请求时读取系统，默认关闭动作没有系统命令副作用。

## 幂等性与恢复

打开与检查可重复，取消不修改 applied；重新勾选可撤销未应用的关闭请求。清理失败沿用现有可重试流程，不强制终止服务。测试仅修改隔离 user-data，保留工作树原有改动，不提交、不发布、不变更生产账号。

## 证据与备注

本轮基于已完成的 `runtime-persistence-setup-completion.md` 开启流程继续迭代，既有开启验证不能代证关闭。最终工件目录为 `.debug/runtime-persistence-walkthrough-7a28bdba-1f43-4ffa-8c26-1c606ff43ad9/`，包含双语 640px/1280px 截图、`geometry.json`、精确命令完成记录和 Output；`zh-cn/disable-apply-640.png` 已人工核对，主要按钮和取消边界文字完整可见。系统能力/翻译通过注入提供；没有创建真实配置终端。

```text
npm run test:runtime-persistence-setup
  capability: 51 checks passed
  setup: 119 checks passed
  server: 7 admission checks passed
npm run test:shared-root-canvas
  21/21 passed
xvfb-run -a npm run test:runtime-persistence-walkthrough -- .vscode-test/vscode-linux-x64-1.140.0/code
  PASS en: enable/disable navigation, native setting toggle, pending reload, injected applied modes, manual rollback reports, confirmations and unknown states.
  PASS zh-cn: enable/disable navigation, native setting toggle, pending reload, injected applied modes, manual rollback reports, confirmations and unknown states.
  geometry.json: 44 cases
```

同时通过 `npm run test:extension-manifest`、`npm run test:ui-copy-localization`、`node scripts/test/test-sidebar-state-updates.mjs`、`npm run test:runtime-mode-switch-races`、`node scripts/test/test-state-configuration-reuse.mjs`、`npm run typecheck`、`npm run test:package-vsix-file-list` 和 `git diff --check`。打包清单覆盖主扩展/通知器真实 staging，新增关闭媒体在包内。模式切换测试的既有 esbuild `node-pty require.resolve` 警告未处理，不影响本轮通过。

## 接口与依赖

控制器增加关闭引导、检查、重载以及可选 linger 撤销报告动作；复用只读配置 getter，不增加可变的全局“当前方向”或私有 VS Code API。系统命令生成只接受固定 enable/disable 操作与已校验 UID，不接受外部传入命令。沿用现有依赖和原生 Settings/Walkthrough/Output。

修订：2026-11-03 根据用户批准的安全退出路径建立计划，限定 linger 撤销为可选只读人工操作说明。

修订：2026-11-03 完成实现和双语隔离宿主验收，补明取消后关闭画板/窗口也会应用请求；保留命令面板驱动的首败与未定位边界，归档到 completed。
