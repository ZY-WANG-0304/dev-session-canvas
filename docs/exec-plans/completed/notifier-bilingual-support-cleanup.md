# Notifier 中英文支持技术债收口

本 `ExecPlan` 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘` 这几个章节。

本仓库的执行计划规范位于 `docs/PLANS.md`。当前计划按该规范维护，目标是让一位没有历史上下文的新协作者也能从这份文档和当前工作树继续完成 notifier companion 的中英文支持技术债收口。

## 目标与全局图景

这次变更要修复 `docs/exec-plans/tech-debt-tracker.md` 中 2026-07-05 记录的 notifier 文案技术债。完成后，英文 VS Code 用户在 `Dev Session Canvas Notifier` 的命令、视图、设置、侧栏、手动测试通知和 Marketplace 默认 listing 中看到英文默认文案；简体中文用户通过 VS Code locale 看到对应中文文案。用户内容、系统平台名、命令、路径、配置片段和后端诊断事实不被翻译。

用户可观察的验收方式是：在英文 locale 下打开 notifier sidebar，`Overview`、`Notes`、`macOS`、`Linux`、`Windows`、`Codex`、`Claude Code` 等 view title 和内容为英文；在简体中文 locale 下同一入口显示中文；执行 `Dev Session Canvas Notifier: Send Test Desktop Notification` 后，工作台提示和输出中的受控人工验收文案跟随 locale。自动化方面，本计划要补齐 manifest NLS parity、runtime l10n bundle key 完整性、notifier source 测试、打包文件列表检查，以及真实 VS Code Extension Development Host 中英文 locale smoke。

## 进度

- [x] (2026-07-06 17:00 +0800) 从最新 `origin/main` 切出 `notifier-bilingual-support-cleanup` 分支，并读取 `docs/WORKFLOW.md`、`docs/workflows/BRANCH.md`、`docs/DESIGN.md`、`ARCHITECTURE.md` 与现有 notifier 架构/本地化设计文档。
- [x] (2026-07-06 17:00 +0800) 定位技术债：notifier `package.json`、`README.marketplace.md`、`src/extension.ts`、`src/sidebarEnvironment.ts` 和 `src/sidebarView.ts` 仍以中文作为默认 UI 文案，且缺少 `package.nls*` 与 `l10n/` runtime bundle。
- [x] (2026-07-06 17:35 +0800) 为 notifier manifest 增加英文默认 `package.nls.json`、简体中文 `package.nls.zh-cn.json`，把 `package.json` 静态 contribution 改为 `%key%` 引用，并声明 `l10n` bundle 目录。
- [x] (2026-07-06 18:10 +0800) 为 notifier runtime 增加轻量本地化边界，使 Extension Host 文案、侧栏 HTML lang、侧栏 Markdown、按钮、测试通知、工作台提示和平台说明按 VS Code locale 切换。
- [x] (2026-07-06 18:20 +0800) 增加英文默认 Marketplace README，并保留仓库内简体中文对应版；确保打包默认入口继续面向英文 Marketplace 搜索索引。
- [x] (2026-07-06 18:35 +0800) 更新正式设计文档、技术债追踪和发布/验证相关文档，使 notifier 中英文边界可追溯。
- [x] (2026-07-06 18:50 +0800) 运行 `npm run typecheck:notifier`、`npm run test:notifier-source`、`npm run test:extension-manifest`、`npm run test:package-vsix-file-list` 和 `git diff --check`，全部通过；另执行 `npm run -w extensions/vscode/dev-session-canvas-notifier package:vsix`，确认 notifier VSIX file list 包含本地化资源。
- [x] (2026-07-06 19:10 +0800) 复核最终 diff，移除 `src/extension.ts` 中不必要的 `logPlatformSnapshot` export，并把 platform section 的当前平台判断改为稳定的 `platformLabel === snapshot.platformLabel`，避免依赖已本地化 label 做逻辑判断；重新运行定向验证全部通过。
- [x] (2026-07-07 00:20 +0800) 复现 `npm run test:notifier-smoke` 在 VS Code 1.117 下的 `Protocol handler already registered for extension [object Object]`，确认旧 wrapper 把主扩展和 notifier 手动激活在同一个 extension context 中，导致 URI handler 重复注册。
- [x] (2026-07-07 00:35 +0800) 把 notifier companion smoke 改成主扩展与 notifier 两条真实 `extensionDevelopmentPath`，分别 staging 两个扩展并显式激活 notifier，移除手写 wrapper，`npm run test:notifier-smoke` 通过。
- [x] (2026-07-07 00:45 +0800) 新增 `npm run test:notifier-locale-smoke`，分别以 `--locale=en` 与 `--locale=zh-cn` 启动真实 VS Code Extension Development Host；zh-cn 场景复用最小 language-pack fixture，打开 notifier sidebar，断言 manifest view/command/setting、sidebar HTML 和手动测试通知/工作台提示/通知 action label 跟随 locale。
- [x] (2026-07-07 01:02 +0800) 最终补跑 `npm run typecheck:notifier`、`npm run test:attention-protocol`、`npm run test:notifier-source`、`npm run test:notifier-smoke`、`npm run test:notifier-locale-smoke`、`npm run test:extension-manifest`、`npm run test:package-vsix-file-list` 与 `git diff --check`，全部通过；后续只做文档日期与发布手册措辞修正，并再次确认 `git diff --check` 通过。

## 意外与发现

- 观察：主扩展已有完整三层本地化边界，但 notifier companion 未纳入同一轮 `0.22.0` 主扩展本地化范围。
  证据：`docs/exec-plans/tech-debt-tracker.md` 在 2026-07-05 明确记录 notifier manifest、sidebar、README 静态文案尚未英文化 / 本地化。

- 观察：`npm run test:notifier-smoke` 在 VS Code 1.117 下失败于 `Protocol handler already registered for extension [object Object]`，不是本地化文案回归。
  证据：旧 smoke host 用 wrapper 手动调用主扩展和 notifier 的 `activate(context)`，两者共用同一个 `context.extension`，notifier 注册 URI handler 时触发 VS Code 1.117 的重复 handler 防护；改成两条真实 development extension 后同一命令通过。

- 观察：测试模式下真实 `vscode.window.showInformationMessage()` 会等待工作台提示关闭，不能作为 locale smoke 的同步断言点直接 await。
  证据：首版 locale smoke 在发送测试通知后卡住；notifier 现在只在测试模式下先记录 `lastWorkbenchPrompt` 并异步触发提示，使 smoke 能断言工作台提示文案与 action，同时不等待 UI 消息生命周期。

## 决策记录

- 决策：notifier 使用 VS Code 原生 `package.nls*` 和 `vscode.l10n.t(...)`，不引入 i18next 或自定义 Webview 字典框架。
  理由：notifier sidebar HTML 由 Extension Host 生成，不是 React 浏览器 bundle；所有产品自有文案都可以在 Host 边界先本地化后注入 HTML，复杂度低于主扩展 Webview 字典。
  日期/作者：2026-07-06 / Codex

- 决策：Marketplace 默认 listing 改为英文 `README.marketplace.md`，新增 `README.marketplace.zh-CN.md` 作为仓库内中文对应版，而不是在默认 listing 中做双语长文。
  理由：仓库根规则要求根 `README.md` 面向 Marketplace 搜索索引使用英文主文件；主扩展 Marketplace README 也已采用英文默认 + 中文对应版。notifier 应与该发布口径一致，避免英文商店页继续以中文为默认。
  日期/作者：2026-07-06 / Codex


- 决策：notifier sidebar 不额外引入 Webview dictionary，而是让 `sidebarEnvironment.ts` 接收本地化函数并生成已本地化 snapshot，`sidebarView.ts` 只负责渲染和设置 HTML lang。
  理由：notifier sidebar 的 HTML 由 Extension Host 生成，运行时可直接调用 `vscode.l10n.t(...)`，比主扩展 active Webview 的浏览器字典边界更简单。
  日期/作者：2026-07-06 / Codex

- 决策：notifier companion smoke 不再使用 wrapper 手动激活两个扩展，而是用两条真实 `extensionDevelopmentPath` 加载主扩展和 notifier。
  理由：真实 development extension 更接近 VS Code 宿主行为，避免把两个扩展塞进同一个 `ExtensionContext` 后重复注册 URI handler，也让 notifier 的 manifest NLS 与 `l10n` 资源由 VS Code 原生解析。
  日期/作者：2026-07-07 / Codex

- 决策：新增 notifier 专用 locale smoke，而不是把它混入现有 `test:notifier-smoke`。
  理由：`test:notifier-smoke` 验证主扩展 attention bridge 到 notifier callback 的端到端链路；locale smoke 的目标是分别启动英文 / 简体中文宿主，打开 notifier sidebar，并验证 view title、sidebar copy、手动测试通知、工作台提示与 action label。拆分命令可避免两个目标互相稀释。
  日期/作者：2026-07-07 / Codex

## 结果与复盘

已完成 notifier 英文默认与简体中文本地化实现、打包资源纳入、测试覆盖和正式文档同步。最终复核已去掉不需要导出的内部 helper，并避免在 sidebar 当前平台判断中依赖本地化后的 `statusLabel`。在用户反馈后，本计划又补齐真实 VS Code 英文 / 简体中文 locale smoke，并修复既有 notifier companion smoke 在 VS Code 1.117 下的 wrapper 重复 URI handler 问题。当前自动化已经覆盖真实宿主中打开 notifier sidebar、manifest view/command/setting 本地化、sidebar HTML 文案、手动测试通知、工作台提示与系统通知 action label 的 locale 切换；剩余只有真实 OS 通知弹出与点击这类平台集成仍需发布前人工抽查，不再把 notifier locale smoke 记录为技术债。

## 上下文与定向

notifier companion 是 UI 侧 VS Code extension，目录为 `extensions/vscode/dev-session-canvas-notifier/`。它和主扩展不同：主扩展 `extensions/vscode/dev-session-canvas/` 持有画布状态和执行节点 attention 判定，notifier 只负责在本机 UI 侧接收结构化通知请求、投递桌面系统通知、处理点击回跳和提供诊断侧栏。

相关代码路径如下。

`extensions/vscode/dev-session-canvas-notifier/package.json` 是 notifier manifest。当前静态 contribution 包括 display name、description、七个 view name、三个命令 title 和 `devSessionCanvasNotifier.notifications.playSound` 设置说明。

`extensions/vscode/dev-session-canvas-notifier/src/extension.ts` 是 notifier Extension Host 入口。它注册通知命令、测试通知命令、URI handler、输出通道、配置打开命令和 sidebar provider。当前手动测试通知、工作台提示和部分诊断文案为中文硬编码。

`extensions/vscode/dev-session-canvas-notifier/src/sidebarEnvironment.ts` 构造 sidebar 所需的平台、后端、安装要求、Agent 配置和注意事项数据。当前这些产品自有说明全部是中文默认。

`extensions/vscode/dev-session-canvas-notifier/src/sidebarView.ts` 把 snapshot 渲染为 Webview HTML。因为 HTML 是 Host 生成的，不需要 Webview 自带 i18n 框架；但渲染前必须传入本地化后的 copy，并把 `<html lang>` 切到 `en` 或 `zh-CN`。

`extensions/vscode/dev-session-canvas-notifier/scripts/package-vsix.mjs` 负责 staging notifier VSIX。新增本地化资源后，它必须复制 `package.nls.json`、`package.nls.zh-cn.json` 和 `l10n/`，并把这些路径纳入必需输入。

正式文档锚点包括 `docs/design-docs/notifier-companion-architecture.md` 和 `docs/design-docs/ui-copy-localization.md`。前者记录 notifier 架构边界，后者记录产品 UI 文案本地化方案。完成本计划时，应把 notifier 纳入已选定本地化边界，同时从 `docs/exec-plans/tech-debt-tracker.md` 移除或更新 2026-07-05 的技术债条目，避免已修复问题继续误导协作者。

## 工作计划

第一步修改 manifest 与打包资源。把 notifier `package.json` 的用户可见静态文案改为 `%key%` 引用，新增英文默认 `package.nls.json` 和中文 `package.nls.zh-cn.json`，并声明 `l10n` 目录。更新 `scripts/package-vsix.mjs`，确保 staging 复制这些资源，发布包不会丢本地化文件。

第二步修改 runtime copy。新增 notifier 专用本地化 helper，例如 `src/notifierLocalization.ts`。helper 使用 `vscode.l10n.t(...)` 构造所有 Host 与 sidebar 所需 copy，并导出 locale 归一化函数。`extension.ts` 调用 helper 构造手动测试通知、工作台提示、动作按钮和诊断引导；`sidebarEnvironment.ts` 或其调用链接收 copy 后构造 snapshot；`sidebarView.ts` 用本地化后的 snapshot 和固定 copy 渲染 HTML。

第三步修改 README。默认 `README.marketplace.md` 改成英文；新增 `README.marketplace.zh-CN.md` 保存中文对应内容。必要时更新 notifier 本地 README，说明 Marketplace 默认英文，中文对应版只作为仓库内文案。

第四步补测试。扩展 `scripts/test/test-extension-manifest.mjs` 或新增 notifier manifest 测试，检查 notifier `package.nls` key parity、manifest `%key%` 引用完整、`l10n` 声明存在。扩展 `test-package-vsix-file-list` 或新增 notifier file-list 检查，确保 notifier VSIX staging 包含本地化资源。更新 notifier source 测试，使它在英文默认和中文 l10n 模拟下断言 sidebar snapshot 与按钮文案。新增 `scripts/smoke/run-vscode-notifier-locale-smoke.mjs` 和 `tests/vscode-smoke/notifier-locale-tests.cjs`，用真实 VS Code Extension Development Host 分别跑 `--locale=en` 与 `--locale=zh-cn`，并打开 notifier sidebar / 发送测试通知来验证真实宿主文案。

第五步更新文档并验证。同步 `docs/design-docs/ui-copy-localization.md`、`docs/design-docs/notifier-companion-architecture.md`、`docs/design-docs/index.md` 和技术债追踪；运行定向验证并把结果写入计划的证据章节。

## 具体步骤

所有命令都从仓库根目录执行：`/home/users/ziyang01.wang-al/projects/dev-session-canvas.worktrees/dev-session-canvas2`。

先运行定向测试确认当前测试基线：

    npm run typecheck:notifier
    npm run test:notifier-source

实现 manifest / runtime / README / 测试 / 文档更新后，至少运行：

    npm run typecheck:notifier
    npm run test:notifier-source
    npm run test:extension-manifest
    npm run test:package-vsix-file-list

若 `test:package-vsix-file-list` 只覆盖主扩展，则扩展它或新增同等 notifier file-list 测试，然后运行对应命令。若 package file-list 需要构建产物，先运行：

    npm run build:notifier

用户反馈指出真实宿主 locale smoke 仍缺口后，额外运行：

    npm run test:notifier-smoke
    npm run test:notifier-locale-smoke

## 验证与验收

验收必须覆盖三类结果。第一，静态 manifest 验收：notifier package manifest 的 command title、view title、description 和 setting description 都通过 NLS key 间接引用；英文默认 `package.nls.json` 与中文 `package.nls.zh-cn.json` key 完全一致；默认英文 command title 包含 `Send Test Desktop Notification`，中文文件包含 `发送测试桌面通知`。

第二，runtime copy 验收：notifier source 测试可以在英文默认和简体中文模拟下构造 sidebar snapshot，英文看到 `Current environment`、`Send Test Notification`、`View Diagnostic Log`，中文看到 `当前环境`、`发送测试通知`、`查看诊断日志`。手动测试通知的工作台提示同样由 `vscode.l10n.t(...)` 控制，并在 zh-cn bundle 中有翻译。

第三，打包验收：notifier staged VSIX file list 包含 `package.nls.json`、`package.nls.zh-cn.json` 和 `l10n/bundle.l10n.zh-cn.json`；默认 `README.marketplace.md` 为英文，不再以中文作为 Marketplace 默认 listing。

第四，真实宿主 locale smoke 验收：`npm run test:notifier-locale-smoke` 应分别启动英文和简体中文 VS Code Development Host。英文场景应看到 `vscode.env.language=en`、manifest command title `Dev Session Canvas Notifier: Send Test Desktop Notification`、view title `Overview` / `Notes`、sidebar HTML lang `en`、sidebar `Current environment` / `Send Test Notification`、手动测试通知工作台提示 `Test desktop notification was sent...` 和系统通知 action label `View Node`；简体中文场景应看到 `vscode.env.language=zh-cn`、command title `Dev Session Canvas Notifier: 发送测试桌面通知`、view title `概览` / `注意事项`、HTML lang `zh-CN`、sidebar `当前环境` / `发送测试通知`、工作台提示 `测试桌面通知已发出...` 和 action label `查看节点`。

## 幂等性与恢复

本计划不需要破坏性命令。所有新增 JSON 与 Markdown 文件可以重复编辑；测试命令可以重复运行。`build:notifier` 会重建 `extensions/vscode/dev-session-canvas-notifier/dist/`，这是已有构建产物路径；如果只想查看源码改动，使用 `git diff --stat` 和 `git diff -- <path>`。不要删除用户未授权的其它工作区改动，也不要执行 `git reset --hard` 或 `git checkout --`。

如果实现中发现某个测试需要较大范围重构，不要临时放宽断言来绕过；应先在 `意外与发现` 记录原因，再调整工作计划。真实 VS Code locale smoke 已覆盖 notifier，因此后续不要再把“缺 notifier locale smoke”登记为残余债；但真实 OS 通知弹出、系统 shell action 和点击回跳仍取决于平台通知服务，发布前仍需要人工抽查并记录 backend / activationMode。

## 证据与备注

当前收口验证证据：

    npm run typecheck:notifier
    # tsc -p ./tsconfig.json --noEmit 通过

    npm run test:notifier-source
    # notifier platform notification / rich text / status / localization / source tests passed

    npm run test:extension-manifest
    # extension manifest tests passed

    npm run test:package-vsix-file-list
    # package-vsix file-list tests passed

    git diff --check
    # 无输出，表示 whitespace 检查通过

    npm run -w extensions/vscode/dev-session-canvas-notifier package:vsix
    # 生成 dev-session-canvas-notifier-0.22.0.vsix，file list 包含 package.nls.json、package.nls.zh-cn.json 和 l10n/bundle.l10n.zh-cn.json。当前工作树非 clean，因此脚本仅做文件系统级 README 相对资源校验；最终发布仍需传入最终 ref。

最终复核后再次运行：

    npm run typecheck:notifier
    npm run test:notifier-source
    npm run test:extension-manifest
    npm run test:package-vsix-file-list
    git diff --check
    # 全部通过。

用户反馈后的真实宿主 smoke 补充验证：

    npm run test:notifier-smoke
    # 修复 wrapper 后通过；验证主扩展 -> notifier companion -> callback -> 画布居中链路。

    npm run test:notifier-locale-smoke
    # 通过；英文和 zh-cn 两个 VS Code Development Host 均打开 notifier sidebar，验证 manifest、sidebar、手动测试通知、工作台提示和 action label 随 locale 切换。

最终补跑：

    npm run typecheck:notifier
    npm run test:attention-protocol
    npm run test:notifier-source
    npm run test:notifier-smoke
    npm run test:notifier-locale-smoke
    npm run test:extension-manifest
    npm run test:package-vsix-file-list
    git diff --check
    # 全部通过。随后仅调整文档日期与发布手册措辞，并再次运行 git diff --check 通过。

## 接口与依赖

新增 helper 应保持在 notifier 子包内部，不让 `packages/attention-protocol/` 或主扩展 common 层依赖 `vscode`。建议接口如下：

    export type NotifierLocale = 'en' | 'zh-CN';
    export interface NotifierRuntimeCopy { ... }
    export function resolveNotifierLocale(language: string): NotifierLocale;
    export function createNotifierRuntimeCopy(l10n: Pick<typeof vscode.l10n, 't'>): NotifierRuntimeCopy;

`sidebarEnvironment.ts` 不应直接调用 `vscode.l10n.t`，而是通过参数接收 copy，便于 source tests 注入英文和中文假 l10n。`sidebarView.ts` 不应把自然语言硬编码到 HTML 渲染函数里，除产品名、平台名、命令名、配置 key、路径、代码片段等事实文本外，新增用户可见文案必须来自 copy 或已本地化 snapshot。

变更记录：2026-07-06 创建计划，原因是 notifier 中英文支持技术债涉及 manifest、runtime、README、打包和文档同步，属于多步交付性工作，需要可追踪执行计划。

变更记录：2026-07-06 更新计划进度和决策记录，原因是 notifier manifest、runtime、README、测试与文档更新已经落地，进入验证收口阶段。

变更记录：2026-07-06 记录验证结果和剩余真实宿主抽查边界，原因是代码、文档与打包资源已完成并通过定向自动化。

变更记录：2026-07-07 补充真实宿主 locale smoke 与 notifier smoke harness 修复，原因是用户反馈 source / manifest / VSIX file-list 不能替代真实 VS Code 英文 / 简体中文宿主覆盖，且既有 `test:notifier-smoke` 在 VS Code 1.117 下因 wrapper 重复 URI handler 失效。

变更记录：2026-07-07 根据 PR review 将计划从 `docs/exec-plans/active/` 归档到 `docs/exec-plans/completed/`，原因是实现、文档同步与真实宿主 locale smoke 验证均已完成，继续留在 active 目录会误导后续协作者。
