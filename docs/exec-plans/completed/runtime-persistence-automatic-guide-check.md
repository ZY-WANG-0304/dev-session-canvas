# 自动检查持久运行引导并保留已满足的步骤

本计划遵循 `docs/PLANS.md`，记录本轮交互修正、验证和剩余边界。

## 目标与上下文

用户要求“允许服务后台运行”在环境已就绪时保留并打钩，而不是消失；检查环境/状态应在打开引导时自动完成，不再占一个页面步骤。当前 `runtimePersistenceSetup.ts` 的 show 只检测系统，显式 check 才发布完成与导航；manifest 中 enable 步骤有 when，关闭引导的 disableReview 也要求手动检查。本轮把开启改为四步、关闭改为三步，保留原生 Walkthrough/Settings/Output 和系统执行确认。

## 进度

- [x] (2026-11-03) 核对当前控制器、贡献、受控回归与原生宿主 smoke。
- [x] (2026-11-03) 明确打开后自动检查、保留第一步及失败不伪装成功的设计。
- [x] (2026-11-03) 修改控制器、双语文案和贡献，删除独立检查步骤及四个不再使用的媒体文件。
- [x] (2026-11-03) 135 项控制器/Manager 检查、51 项能力检查、7 项服务端检查通过，双语完整流程及首次已就绪的自动勾选验证通过。
- [x] (2026-11-03) 同步正式文档、README、索引与验证限制并归档。

## 决策记录

- 打开引导先等待原生页面加载，再自动读取并发布结果，避免贡献未注册时吞掉完成事件。开启环境就绪时保留第一步并打钩，定位下一待办；关闭只读取 requested/applied，不查询系统资格。日期：2026-11-03。
- 删除独立环境/状态检查步骤，而不是隐藏全部检查反馈。正常自动检查只更新报告，不弹出 Output；异常打开诊断，未满足第一步仍可重新检查。保留后续步骤的继续/重新检查作为外部设置和系统命令变更后的明确刷新，不自动执行、不自动修改设置或重载。日期：2026-11-03。
- 完成标记仍为 VS Code 原生历史进度，不作为执行准入。用户从扩展入口重新打开时必做检查，未知不得发布成功。关闭共享会话影响移入设置和重载步骤，不因删除检查步骤而丢失风险提示。日期：2026-11-03。

## 意外与发现

既有宿主 smoke 的命令面板驱动已改为临时 fixture 快捷键，仍实际点击原生步骤和设置；本轮继续使用，不改生产快捷键。自动打开必须与 perform 的 acting 锁配合，避免 disable-guide 内递归 perform 丢弃检查，且重复打开不能绕过正在进行的执行确认。

原生完成事件需要在页面可用后发布；本轮先 await 打开引导，再检查和发布结果，在新建的隔离用户目录中验证已就绪首开自动勾选成功。正常自动检查只写 Output 内容，不调用 show；失败才自动展开诊断，手动重新检查仍可展开报告。检查不改变原生历史勾选的存储语义，重复检查与实际准入仍以最新状态为准。

## 工作计划

第一里程碑在 `extensions/vscode/dev-session-canvas/src/panel/runtimePersistenceSetup.ts` 抽出共同开启检查逻辑，show 在页面打开后调用只读检查，支持报告不抢占界面。保留信任、销毁、过期配置/观察保护和一次动作锁。

第二里程碑调整扩展 `package.json`、`package.nls*.json`、`walkthroughs/`：开启为 enable/configuration/apply/verifyApplied，关闭为 disableConfiguration/disableApply/verifyDisabled；enable 无 when。首步说明自动检查、已满足会打钩和手动操作的授权边界；后续仍保留可重试动作。同步打包媒体清单。

第三里程碑更新 `scripts/test/test-runtime-persistence-setup.mjs`、manifest 测试与 `scripts/smoke/run-runtime-persistence-walkthrough.mjs`。覆盖打开即检查及推进、初次已就绪保留勾选、异常不成功、无需系统资格的关闭、检查期间销毁/失信/并发；真实宿主宽窄截图验证。所有系统状态、应用状态受控注入，不改生产账号。

## 验证与验收

仓库根运行 `npm run test:runtime-persistence-setup`、`npm run test:extension-manifest`、`npm run test:ui-copy-localization`、`npm run typecheck`、`npm run test:package-vsix-file-list` 与 `git diff --check`。双语 UI 用 `xvfb-run -a npm run test:runtime-persistence-walkthrough -- .vscode-test/vscode-linux-x64-1.140.0/code`，检查打开后无需点击环境/状态按钮、已就绪第一步仍存在且勾选。最少保留未知状态和关闭待重载反例，截图只能代证本轮隔离 Linux 环境。

## 幂等性与恢复

打开和检查只读，可重复；复制/终端执行、设置更新和重载继续由用户显式动作触发。失败不写设置、不改 linger、不重启 Supervisor。保留已有未提交工作，不安装、不提交、不发布，不影响真实会话。

## 结果与复盘

已实现四步开启与三步关闭，从扩展命令/链接/侧栏打开后自动检查并定位待办；环境已就绪第一步不隐藏，保留并自动勾选。首次已就绪的新用户目录也实际验证通过。只读检查不执行系统命令、写设置或发起重载，关闭检查不依赖系统资格；异常保留诊断。共享退出、确认取消和系统 linger 边界未改变。

测试通过：`npm run test:runtime-persistence-setup`（51 / 135 / 7）、`npm run test:extension-manifest`、`npm run test:ui-copy-localization`、`npm run typecheck`、`npm run test:package-vsix-file-list` 和 `git diff --check`。真实 staging/主扩展与通知器 vsce 清单通过，移除的旧媒体没有生产引用。

最终宿主工件 `.debug/runtime-persistence-walkthrough-d56a7033-6cc1-4de2-a5a7-fa64ea0fe8b8/`：en/zh-cn 各覆盖开启、关闭、原生设置勾选/取消、待重载、未知报告和取消执行；en-ready/zh-cn-ready 使用独立新用户目录，验证一打开即勾选第一步并进入配置。共 44 项 640px/1280px 布局检查（完整流程 36 项、首开已就绪 8 项）；人工查看 `zh-cn-ready/ready-on-open-640.png`，四步与第一步勾选清晰可见，无手动检查前置步骤。终端执行在 fixture 中禁止，真实用户设置未改。

```text
Runtime persistence setup: 135 checks passed; no real terminal or settings changes.
PASS en: automatic opening checks, visible completed background step, native setting toggle, pending reload, injected applied modes, manual rollback reports, confirmations and unknown states.
PASS zh-cn: automatic opening checks, visible completed background step, native setting toggle, pending reload, injected applied modes, manual rollback reports, confirmations and unknown states.
PASS en: fresh ready host opens on configuration, with background services retained and checked automatically.
PASS zh-cn: fresh ready host opens on configuration, with background services retained and checked automatically.
```

使用既有公开 [Walkthrough 贡献](https://code.visualstudio.com/api/references/contribution-points#contributes.walkthroughs)与[命令机制](https://code.visualstudio.com/api/references/commands)，没有引入私有进度重置或新 UI 框架。系统观察、翻译和应用模式为受控注入，不代证真实远端重载、零登录、实际语言包或跨平台 UI。本轮不增加轮询/终端输出监听；外部变更之后可重新打开扩展引导入口或点击重新检查。直接从宿主 Welcome 历史卡片切回已有页面不作为一次新的扩展命令调用，不承诺持续刷新。

修订：2026-11-03 根据用户反馈创建本轮计划，限定自动化为打开引导时的只读检查与导航。

修订：2026-11-03 完成实现、受控回归、双语首开及完整宿主验证，记录注入边界并归档。
