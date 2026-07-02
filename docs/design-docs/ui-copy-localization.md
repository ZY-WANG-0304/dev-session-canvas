---
title: UI 文案本地化方案
decision_status: 已选定
validation_status: 验证中
domains:
  - VSCode 集成域
  - 画布交互域
  - 项目状态域
architecture_layers:
  - 宿主集成层
  - 画布呈现层
  - 适配与基础设施层
related_specs: []
related_plans:
  - docs/exec-plans/completed/ui-copy-localization-foundation.md
  - docs/exec-plans/completed/ui-copy-localization-host-sidebar.md
updated_at: 2026-07-02
---

# UI 文案本地化方案

## 1. 背景

DevSessionCanvas 的公开入口面向英文 Marketplace 搜索索引，仓库根 `README.md` 是英文主文件，同时仓库面向人的协作文档默认使用中文。当前扩展 manifest 已经使用 `package.nls.json` 承载 `package.json` 中的静态文案 key，但默认文件中仍混有大量中文；运行时代码和 Webview 里也有硬编码中文、硬编码英文以及少量中英混合说明。

这会造成两个问题：第一，英文 VS Code 用户在命令面板、设置页、视图标题和 Webview 内看到不一致语言；第二，后续新增 UI 文案时没有明确边界，容易继续把用户数据、产品术语和系统提示混在一起处理。

## 2. 问题定义

本方案要解决的是产品拥有的 UI 文案如何同时提供英文和简体中文版本。这里的“产品拥有的 UI 文案”包括 VS Code 贡献点、Extension Host 通知和选择器、Webview 可见按钮、状态、tooltip、aria-label、placeholder、空状态和错误提示。

用户创建或外部系统产生的数据不属于本地化对象，包括用户编辑的节点标题、Note 正文、模板自定义名称、文件路径、终端输出、Agent 输出和 provider 返回的原始错误文本。这些内容必须保持原样，避免语言切换破坏用户事实。

## 3. 目标

默认英文文案必须成为 VS Code 英文环境和 Marketplace 搜索路径下的主体验；简体中文用户应能通过 VS Code locale 看到中文静态入口和后续逐步迁移的运行时/Webview UI 文案。

实现上应优先使用 VS Code 官方支持的本地化机制，减少自定义基础设施。新增文案必须可以被测试发现缺失 key、缺失翻译或 manifest 引用错误。首批落地应先打通 manifest 与 Webview 注入基础设施，再逐步迁移运行时和大型 Webview 文件中的硬编码文案。

## 4. 非目标

本方案不提供机器翻译流程，不承诺一次性翻译模板内容、README、CHANGELOG、Marketplace 长文案或历史文档。

本方案不拆分中英文两个扩展包，不新增用户级语言设置，也不在协议层传递自然语言句子。

本方案不改变节点模型、持久化数据结构和执行会话行为；语言变化只影响 UI 展示文案，不迁移已保存的用户内容。

## 5. 候选方案

候选方案一是只使用 VS Code 原生 `package.nls.json` 和 `vscode.l10n.t`。这适合 manifest 和 Extension Host 运行时，但无法直接覆盖 Webview React DOM，因为 Webview 脚本在浏览器环境中运行，不能直接调用 `vscode.l10n.t`。

候选方案二是引入完整 i18n 框架，例如 i18next。它可以覆盖复杂插值和复数规则，但会增加运行时依赖、bundle 体积、学习成本和测试面。当前只需要英文与简体中文两种语言，文案形态也以短 UI 字符串为主，收益不足以覆盖成本。

候选方案三是采用 VS Code 原生机制处理扩展侧文案，并为 Webview 建立轻量 typed dictionary，由 Host 按 `vscode.env.language` 注入 locale 与文案包。该方案兼容 VS Code 官方机制，也让 Webview 文案在浏览器边界内保持可测试和可控。

## 6. 风险与取舍

`package.nls.json` 默认改为英文会影响现有中文用户的默认体验，因此必须同时新增 `package.nls.zh-cn.json`，并用测试保证两份 key 完全一致。由于 VS Code locale 文件名匹配使用平台约定，当前统一使用小写 `zh-cn` 文件名，后续如发现实际打包环境要求不同大小写，应记录验证证据后调整。

Webview 当前集中在 `extensions/vscode/dev-session-canvas/src/webview/main.tsx`，硬编码文案数量较多。一次性全部迁移风险高，容易引入行为回归。正式落地采用先打基础设施、再按组件分批迁移的策略；迁移期间允许少量旧硬编码存在，但新增产品文案必须优先进入字典。

部分字符串包含产品词和技术词。当前 glossary 规定英文默认使用 `Agent`、`Terminal`、`Note`、`Canvas`、`workspace`、`provider`；中文 UI 保留 `Agent`、`Terminal`、`Note`，将 `Canvas` 翻译为“画布”，`workspace` 在 VS Code 语境中可写作 `workspace` 或 `工作区`，但涉及配置 key、命令名或 VS Code 原生对象时保留英文术语。

## 7. 正式方案

DevSessionCanvas 采用三层本地化边界。

第一层是 VS Code manifest 静态贡献点。`extensions/vscode/dev-session-canvas/package.nls.json` 是英文默认文案，覆盖 `package.json` 中所有 `%key%` 引用；`extensions/vscode/dev-session-canvas/package.nls.zh-cn.json` 是简体中文翻译，必须和默认文件保持相同 key 集。这里承载 command title、view title、configuration description、configuration enum label、workspace trust 和 virtual workspace description。命令文案遵循 VS Code 命令面板语义：默认英文文案以产品名前缀开头以保持可搜索性，短小的内部 view/title 切换命令可以继续使用动词短语和可见勾选符号。后续若引入 `category` 字段缩短 title，应作为单独 UI 方案记录。

第二层是 Extension Host 运行时文案。`extensions/vscode/dev-session-canvas/src/extension.ts`、`extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts` 和 sidebar provider 中由扩展宿主弹出的通知、QuickPick、确认框、错误提示，应逐步迁移到 `vscode.l10n.t(...)`。扩展 manifest 需要声明 `l10n` bundle 目录，运行时简体中文翻译放在 `extensions/vscode/dev-session-canvas/l10n/bundle.l10n.zh-cn.json`。第二批已迁移 Terminal shell、Agent CLI、创建节点、sidebar node-list 和 Explorer Markdown 校验相关的低风险 Host 入口；session history QuickPick、CanvasPanelManager 生命周期与执行状态文案仍保持分批迁移，避免破坏现有 smoke baseline。协议层文件，例如 `extensions/vscode/dev-session-canvas/src/common/protocol.ts`，不得新增自然语言文案；跨边界只传递结构化状态、枚举和必要事实。

第三层是 Webview 文案。Webview 不能直接依赖 `vscode.l10n.t`，因此在 `extensions/vscode/dev-session-canvas/src/webview/i18n/` 下维护 typed dictionary。英文为默认字典，简体中文为覆盖字典，二者在 TypeScript 类型上共享同一 key 集。`extensions/vscode/dev-session-canvas/src/panel/getWebviewHtml.ts` 根据 `vscode.env.language` 选择 `en` 或 `zh-CN`，把 locale 与字典通过 CSP nonce 保护的 bootstrap script 注入为 `window.__DEV_SESSION_CANVAS_I18N__`。`extensions/vscode/dev-session-canvas/src/webview/main.tsx` 通过 `t('key', params)` 读取文案；插值只允许命名参数，避免中英文语序差异被字符串拼接固化。

Webview standby HTML 也归第三层管理，但它由 Host 生成，首批实现可用一个同源 helper 从 Webview 字典取文案，避免这个特殊 HTML 继续硬编码中文。Active Webview 的 `<html lang>` 应跟随选中的 locale 输出；standby 和 active HTML 共用同一 locale 选择结果。

打包路径必须包含新增本地化资源。`scripts/release/package-vsix.mjs` 和 `scripts/shared/prepare-debug-main-only-extension.mjs` 在 staging 主扩展时复制 `package.nls*.json` 与 `l10n/`。测试路径必须补充 manifest nls parity 检查、manifest `%key%` 引用检查、Webview 字典 key parity 检查，以及打包 staging 是否包含本地化资源的检查。

## 8. 验证方法

自动验证包含四类。运行 `npm run test:extension-manifest`，预期所有 `package.json` 中 `%key%` 引用都能在 `package.nls.json` 中找到，且 `package.nls.zh-cn.json` 与默认文件 key 完全一致。运行新增或扩展后的 i18n 测试，预期 Webview 英文和中文字典 key 完全一致，中文覆盖不缺项，并且 `extension.ts` 中已经使用 `vscode.l10n.t` 的 Host 英文源字符串都能在 zh-cn runtime bundle 中找到非空翻译。运行 `npm run typecheck`，预期 Webview 字典与 Host 注入类型可通过 TypeScript 检查。运行 `npm run test:package-vsix-file-list`，预期 staged VSIX 文件包含 `package.nls.zh-cn.json` 和 `l10n/bundle.l10n.zh-cn.json`，且没有额外源码目录泄漏。

手动验证在英文 VS Code 和简体中文 VS Code 环境中分别打开扩展。英文环境应看到英文 command title、设置说明、view title 和已迁移 Webview 文案；简体中文环境应看到中文对应文案。若只完成首批基础设施，未迁移的大型 Webview 组件可以记录为后续工作，但不能把它们描述为已完成本地化。
