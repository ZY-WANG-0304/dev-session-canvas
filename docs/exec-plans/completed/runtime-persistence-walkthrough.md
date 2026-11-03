# 将后台持久运行配置迁移到原生引导页

本计划遵循 `docs/PLANS.md`，持续维护进度、发现、决策与结果。

## 目标与全局图景

用户反馈两层原生弹窗仍不好用。本次将“配置后台持久运行”改为 VS Code 原生 Walkthrough（编辑器中的入门指南），没有搜索框和多层菜单；只有执行账号级系统变更时保留一次确认。用户从命令面板或侧栏打开，检查主机、了解并启用 linger、重新检查，能在独立测试窗口查看中英文效果。

## 进度

- [x] (2026-11-03) 核对现有实现、公开 Walkthrough contribution 和 VS Code 1.80 源码。
- [x] (2026-11-03) 更新正式方案、贡献原生引导页及安全命令路由。
- [x] (2026-11-03) 更新控制器、manifest、本地化测试与隔离宿主 smoke。
- [x] (2026-11-03) 定向回归、类型检查、构建、真实打包清单及中英文 UI smoke 通过，查看宽窄截图并同步限制。
- [x] (2026-11-03) 用户反馈检查后没有进入下一步：补齐按实际结果选步及第一步完成语义，中英文真实宿主点击后的自动导航通过。

## 意外与发现

Walkthrough 的说明和媒体来自扩展静态贡献，并不是实时状态面板。VS Code 会保存进度勾选，因此不能把进度当作当前主机资格。媒体 Markdown 支持本地化资源。运行时目标和实际命令必须使用检测结果，不将主机信息写入扩展安装目录，也不使用私有页面更新 API。

宿主在窄编辑区隐藏右侧媒体，主动作和步骤仍可访问。因此引导进度不是实时状态的提醒保留在步骤正文，账号级影响在唯一执行确认中再次展示。原生页面在检测中不切换步骤可见性，避免每次点击动作时先移除再插入当前步骤。

后续实测发现，原控制器的检查动作仅输出报告，没有请求选择下一步骤；原 smoke 在点击检查后手动选中开启步骤，因而掩盖了缺失导航。回归需先断言自动展开，再继续后续操作。公开 openWalkthrough 支持 `{ category, step }`，category 使用完整扩展/引导标识，step 使用本地步骤 id，无需调用内部选步命令。首次新 smoke 揭示传完整 step 标识在 VS Code 1.140.0 会被再次拼接 category，实际无法定位；按该版本固定源码修正为短 id。1.80 的已打开引导页也支持短 id，最低宿主的实际 UI 验收仍单独跟踪。

真实宿主还揭示：启动时就发布的资格 context 可能在 Walkthrough 注册前为真，宿主会记录完成事件但不追补进度，之后同值检查也不触发 context 改变。因此进度改用仅在显式检查完成时发布的 `checkResult`，与后台检查维护的可见性 `setupState` 分开；不会通过私有“标记已完成”命令绕过事实校验。

真实打包不是直接打扩展目录：`scripts/release/package-vsix.mjs` 显式复制资源到暂存目录，必须增加 walkthroughs 的复制规则。仅修改 `.vscodeignore` 不足以交付媒体；文件清单测试已覆盖两种语言共六份资源。

## 决策记录

- 决策：使用原生三步引导，实时状态仍在侧栏，详细检查结果在原生 Output 面板。理由：遵循原生控件分工，避免新 Webview 和再次将说明塞回 modal。日期：2026-11-03。
- 决策：只对真实检测通过设置进度事件；文案明确勾选不是实时资格。任何命令都重新检查信任、能力、目标，不信任引导进度和命令参数。日期：2026-11-03。
- 决策：不改当前主机 linger、不执行真实 logout、不安装/发布扩展。使用注入能力的隔离宿主截取效果。日期：2026-11-03。
- 决策：显式检查之后按实际资格导航，缺 linger 去开启，已就绪去验证，其余结果回检查；第一步可在已核对主机但尚缺 linger 时完成，不表示全部就绪。不自动执行下一步。日期：2026-11-03。

## 结果与复盘

已完成原生引导页和一次执行确认，保留独立 sudo、确认后目标/信任复核、真实状态检查与现有模式重载提示。43 项控制器检查、51 项能力检查、7 项服务端准入检查、manifest、本地化、类型检查、构建、模式切换/状态配置回归、主扩展和 notifier 打包清单通过。隔离 Linux VS Code 1.140.0 验证中英文内容、1280/640px 的 20 项按钮几何检查、真实媒体加载、复制/检查、两类执行确认/Esc 取消、就绪与未知状态。已查看宽窄中文开启页和窄窗口执行确认。

检查导航修正后，控制器回归增加到 54 项，覆盖实际结果选步、背景检查不推进、等待 context 发布、销毁/失信/结果过期取消导航；51 项能力与 7 项服务端检查继续通过，manifest、本地化、类型检查与构建通过。宿主 smoke 不再用手动选步掩盖问题，实测检查后自动进入开启、验证仍未通过时返回开启、已就绪进入验证、未知回到环境检查；第一步勾选不误标最终步骤完成。通过截图确认 Output 出现时开启按钮仍可见，未执行真实系统命令。

此次 UI 验证不替代真实零登录存活验收；未安装或发布扩展，未改变账号 linger。最低宿主版本、完整语言包、明亮/高对比主题、完整键盘路径、真实 Remote SSH 和 macOS/Windows 仍未验收，记录在技术债中。

## 上下文与定向

`extensions/vscode/dev-session-canvas/src/panel/runtimePersistenceSetup.ts` 目前负责两层弹窗、能力复核及独立终端执行。`CanvasPanelManager.ts` 持有控制器，并在环境就绪后处理模式重载提示。`extension.ts` 注册命令。扩展 `package.json` 与两份 `package.nls*.json` 负责原生页面、命令及中英文说明。`src/common/extensionIdentity.ts` 集中命令标识。系统资格检查和 Supervisor 准入不变。

## 工作计划

先更新 `docs/design-docs/runtime-persistence-login-independence.md` 的正式方案。贡献名为 `runtimePersistence` 的 Walkthrough，步骤为检查环境、允许后台运行、验证结果；包内媒体文件放 `walkthroughs/`，显式纳入打包。检查、复制、普通执行与 sudo 用独立内部命令路由至控制器，不接受调用者传入的 host/UID/命令。原生 Output 显示最近一次检查目标、状态和可用的精确命令。普通命令和 sudo 共用已有执行确认与确认后复核，不自动重试或读取密码。

第二阶段更新自动化回归。复用隔离 VS Code smoke 的真实控制器，贡献实际页面和本地化媒体，注入合成目标、禁止创建真实终端。通过页面入口测试检查、复制、两类执行确认与取消，在普通和窄窗口截图，并验证就绪/未知状态不会展示可执行的开启步骤。

## 具体步骤

仓库根执行 `npm run test:runtime-persistence-setup`、`npm run test:extension-manifest`、`npm run test:ui-copy-localization`、`npm run typecheck`、`npm run build`。宿主 smoke 使用 `xvfb-run -a npm run test:runtime-persistence-walkthrough -- .vscode-test/vscode-linux-x64-1.140.0/code`，预期无真实终端，截图位于 `.debug/runtime-persistence-walkthrough-*/`。

## 验证与验收

打开配置命令应出现编辑器引导页，不出现 Quick Pick 或说明 modal。检查结果包含合成 host、账号、UID、状态和准确命令；复制不执行；开启与 sudo 各只需一次明确确认，Esc 无副作用；取消、失去信任、目标变化、状态未知均不执行。就绪只源于复核。验证中英文资源、媒体打包入口与已有模式重载提示不回退。

## 幂等性与恢复

检查和打开可重复执行，Output 只保留最新检查。测试使用独立用户目录和注入状态，不影响当前窗口或账号。保留工作树已有改动，不提交或覆盖无关文件。取消确认即可退出操作；更换 UI 不改变 Supervisor 和系统策略。

## 证据与备注

官方入口为 https://code.visualstudio.com/api/ux-guidelines/walkthroughs 和 https://code.visualstudio.com/api/references/contribution-points#contributes.walkthroughs 。VS Code 1.80 的 gettingStartedService.ts 明确将媒体路径解析到扩展目录并缓存；gettingStartedExtensionPoint.ts 定义 description 链接、when 和 completionEvents。

初版宿主工件为 `.debug/runtime-persistence-walkthrough-957a0757-0dce-4d88-8dba-c6038ec7dcae/`，含 `geometry.json`、中英文步骤/确认截图、输出报告和安全复制记录。检查导航修正后的最终工件为 `.debug/runtime-persistence-walkthrough-11a8b3c0-a9a6-4aa0-8b7e-05344c919b42/`。新增单元回归在旧实现中先以 `A completed check must select enable` 失败；修正后中英文 smoke 输出 `result-driven step navigation` 通过。测试注入能力及翻译，不伪装实际授权结果。实际 VSIX 暂存测试输出 `main: real staging rules and vsce file list passed` 与 `notifier: real staging rules and vsce file list passed`。

## 接口与依赖

仅使用现有 `vscode` API：`workbench.action.openWalkthrough`、`setContext`、`createOutputChannel`、命令注册、原生通知与终端。不增加依赖，不提高最低 VS Code 版本，不依赖内部进度操作。安全确认后的目标和信任复核继续由控制器负责。

修订：2026-11-03 新建计划，响应用户授权做原生引导页并查看效果。

修订：2026-11-03 完成实现、包装资源回归与隔离宿主截图，归档计划；零登录和真实远端边界继续由既有技术债跟踪。

修订：2026-11-03 根据用户实际点击反馈补齐检查后的自动导航，分离显式检查进度与后台资格状态，记录原 smoke 手动选步掩盖问题及宿主参数/事件时序发现，完成回归并重新构建。
