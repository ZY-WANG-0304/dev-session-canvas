# UI 文案本地化基础设施

本 `ExecPlan` 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘` 这几个章节。

本计划遵循 `docs/PLANS.md`。计划本身放在 `docs/exec-plans/completed/ui-copy-localization-foundation.md`，完成后应移入 `docs/exec-plans/completed/`，并把遗留技术债登记到 `docs/exec-plans/tech-debt-tracker.md`。

## 目标与全局图景

完成后，DevSessionCanvas 的 VS Code manifest 文案会有英文默认版和简体中文版，Webview 会拥有可注入、可测试的英文/中文文案字典。用户可以在英文 VS Code 中看到英文 command、view 和 setting 文案，在简体中文 VS Code 中看到中文静态贡献点；开发者可以在后续迁移 Webview 组件文案时复用同一套 typed dictionary，而不是继续硬编码字符串。

这次工作不要求一次性翻译所有运行时和 Webview 字符串，但必须建立正确边界、资源打包和防回归测试，让后续迁移可以安全增量推进。

## 进度

- [x] (2026-07-02 00:00Z) 从 `origin/main` 创建主题分支 `ui-copy-localization-foundation`。
- [x] (2026-07-02 00:05Z) 新增设计文档 `docs/design-docs/ui-copy-localization.md` 并登记正式方案。
- [x] (2026-07-02 00:05Z) 创建本 ExecPlan，明确首批实现范围和验证方式。
- [x] (2026-07-02 00:20Z) 将 `package.nls.json` 改为英文默认文案，并新增 key 完全一致的 `package.nls.zh-cn.json`。
- [x] (2026-07-02 00:22Z) 在主扩展 manifest 中声明 VS Code runtime localization bundle，并新增简体中文 bundle 文件。
- [x] (2026-07-02 00:35Z) 新增 Webview typed dictionary、locale 选择和 Host 注入路径，迁移 standby HTML 文案作为首个使用点。
- [x] (2026-07-02 00:45Z) 更新打包、debug staging 和测试脚本，确保本地化资源被复制并被校验。
- [x] (2026-07-02 00:55Z) 运行相关测试并记录证据。

## 意外与发现

- 观察：当前 `package.nls.json` 已存在，但默认内容混有大量中文；这说明 manifest 已接入 nls key 机制，但默认语言尚未对齐英文 Marketplace 主路径。
  证据：`extensions/vscode/dev-session-canvas/package.nls.json` 中 `command.openCanvas.title` 当前是 `Dev Session Canvas: 打开/定位画布`。

- 观察：Webview active HTML 当前硬编码 `<html lang="zh-CN">`，standby HTML 文案也硬编码中文；首批基础设施必须至少修复这条独立 HTML 路径，才能证明 Host 注入和 locale 选择可用。
  证据：`extensions/vscode/dev-session-canvas/src/panel/getWebviewHtml.ts` 的 `getSharedShell` 和 `buildStandbyHtml` 当前含中文 lang 与中文段落。

## 决策记录

- 决策：默认文案使用英文，简体中文使用 `zh-cn` locale 文件和 `zh-CN` Webview locale 标识。
  理由：仓库根 `README.md` 是英文主文件，Marketplace 搜索路径需要英文默认；VS Code manifest locale 文件通常按 locale suffix 查找，文件名采用小写以保持兼容，Webview 内部用常见 BCP 47 展示标识。
  日期/作者：2026-07-02 / Codex

- 决策：Webview 不引入 i18next 等完整框架，先使用 typed dictionary 和命名参数插值。
  理由：当前只需要英文和简体中文两种 UI 语言；typed dictionary 足以覆盖短 UI 文案，能降低 bundle 体积和依赖风险。
  日期/作者：2026-07-02 / Codex

## 结果与复盘

本计划已完成本地化基础设施首批落地。当前默认 manifest 文案已经改为英文，简体中文 manifest 文案保存在 `package.nls.zh-cn.json`；主扩展 manifest 声明了 `./l10n` runtime bundle；Webview 已有 typed dictionary、locale fallback、Host 注入和 standby HTML 迁移；发布 staging、debug staging 与 smoke staging 都会复制本地化资源。

剩余缺口是 Extension Host 运行时提示和大型 Webview 组件中的硬编码文案尚未全量迁移。本轮已把这项作为技术债登记到 `docs/exec-plans/tech-debt-tracker.md`，不把当前状态描述为“全 UI 已本地化”。

## 上下文与定向

主扩展位于 `extensions/vscode/dev-session-canvas/`。VS Code 会读取该目录下的 `package.json` 作为扩展 manifest。manifest 里的 `%key%` 引用由同目录 `package.nls.json` 和 locale-specific nls 文件解析。当前仓库只有 `package.nls.json`，且里面多数值是中文。

Extension Host 代码入口是 `extensions/vscode/dev-session-canvas/src/extension.ts`，Webview HTML 由 `extensions/vscode/dev-session-canvas/src/panel/getWebviewHtml.ts` 生成，Webview React 入口是 `extensions/vscode/dev-session-canvas/src/webview/main.tsx`。构建由 `scripts/build/build.mjs` 使用 esbuild 打包；发布 staging 由 `scripts/release/package-vsix.mjs` 复制运行时文件到临时目录；debug main-only staging 由 `scripts/shared/prepare-debug-main-only-extension.mjs` 复制子集。

“typed dictionary”在本计划中指 TypeScript 对象：英文对象定义所有 key，中文对象必须满足同一类型。这样新增 key 时 TypeScript 会要求中文侧补齐，测试也会检查运行时 key parity。

## 工作计划

先处理文档和 manifest 静态文案。把 `extensions/vscode/dev-session-canvas/package.nls.json` 改为英文默认值，并新增 `extensions/vscode/dev-session-canvas/package.nls.zh-cn.json` 保存当前中文值。更新 `scripts/test/test-extension-manifest.mjs`，让测试检查默认 nls 与中文 nls key 完全一致，并检查 manifest 中所有 `%key%` 引用都存在。

然后接入 runtime localization 声明。修改 `extensions/vscode/dev-session-canvas/package.json`，新增 `l10n` 字段指向 `./l10n`；新增 `extensions/vscode/dev-session-canvas/l10n/bundle.l10n.zh-cn.json`，先放少量用于证明机制和后续迁移的翻译 key。此阶段不强制迁移所有 Host 文案。

接着新增 Webview 字典和注入路径。在 `extensions/vscode/dev-session-canvas/src/webview/i18n/` 下创建字典与 resolver；在 `getWebviewHtml.ts` 中读取 `vscode.env.language`，选择 Webview locale，设置 `<html lang>`，注入 `window.__DEV_SESSION_CANVAS_I18N__`。修改 standby HTML 使用字典文案，修改 `main.tsx` 的 global type 并读取注入对象。首批只迁移少量全局字符串或保留 helper，避免一次性修改大型组件。

最后更新 staging 和测试。发布 staging 和 debug staging 必须复制 `package.nls.zh-cn.json` 与 `l10n/`。测试脚本需确认这些文件被包含。新增 `scripts/test/test-ui-copy-localization.mjs` 或扩展现有 manifest 测试，验证 Webview 字典 key parity 和 locale fallback。

## 具体步骤

所有命令都从仓库根目录 `/home/users/ziyang01.wang-al/projects/dev-session-canvas.worktrees/dev-session-canvas2` 执行。

先确认分支：

    git status --short --branch

预期输出显示当前分支为 `ui-copy-localization-foundation`，且没有非本任务引入的意外改动。

实现后运行：

    npm run test:extension-manifest
    npm run test:package-vsix-file-list
    npm run typecheck

如果新增独立 i18n 测试，还需要运行：

    npm run test:ui-copy-localization

预期所有命令退出码为 0。若 `test:package-vsix-file-list` 因缺少依赖失败，应先确认 `npm install` 是否已在仓库根执行；不要跳过资源复制校验。

## 验证与验收

验收标准一：`package.json` 中所有 `%key%` 引用都能在英文默认 `package.nls.json` 中找到，简体中文 `package.nls.zh-cn.json` 与默认文件 key 完全一致。

验收标准二：`package.json` 声明 `l10n` 目录，`l10n/bundle.l10n.zh-cn.json` 存在且被 staging 复制。

验收标准三：Webview HTML 的 `lang` 属性跟随 locale，active Webview 注入 `window.__DEV_SESSION_CANVAS_I18N__`，standby HTML 不再硬编码中文文案，而是通过字典输出英文或中文。

验收标准四：相关测试通过，且 final response 明确列出已运行的验证命令。未完成迁移的运行时/Webview 文案必须在结果或技术债中说明，不能写成已全量完成。

## 幂等性与恢复

本计划的修改都是文本文件增量修改，可重复运行测试和构建。若英文文案翻译需要调整，直接编辑 nls 文件并重跑 parity 测试即可。若 Webview 字典 key 改名，应同时更新英文、中文和使用点；TypeScript 与 key parity 测试应能暴露遗漏。

不要删除用户未提交的无关改动。若 `git status` 出现非本任务文件变化，必须先确认来源再继续。

## 证据与备注

当前初始证据：

    git switch -c ui-copy-localization-foundation origin/main
    Branch 'ui-copy-localization-foundation' set up to track remote branch 'main' from 'origin'.

完成实现后的测试输出摘要：

    npm run test:ui-copy-localization
    ui copy localization tests passed

    npm run test:extension-manifest
    extension manifest tests passed

    npm run test:package-vsix-file-list
    package-vsix file-list tests passed

    npm run typecheck
    tsc -p ./tsconfig.json --noEmit

2026-07-02 在补充 `canvas.fitView` / `canvas.minimap` Webview key 与中文 manifest displayName/description 后复跑同一组命令，结果仍全部通过。

## 接口与依赖

在 `extensions/vscode/dev-session-canvas/src/webview/i18n/webviewI18n.ts` 中定义：

    export type WebviewLocale = 'en' | 'zh-CN';
    export type WebviewI18nMessages = typeof enWebviewMessages;
    export interface WebviewI18nBootstrap { locale: WebviewLocale; messages: WebviewI18nMessages; }
    export function resolveWebviewI18n(language: string): WebviewI18nBootstrap;
    export function formatWebviewMessage(key: keyof WebviewI18nMessages, params?: Record<string, string | number>): string;

Host 侧 `getWebviewHtml.ts` 使用 `resolveWebviewI18n(vscode.env.language)`，Webview 侧读取 `window.__DEV_SESSION_CANVAS_I18N__`。如果因为 browser bundle 和 Host bundle 共享同一模块产生打包问题，应把纯数据和格式化函数保持无 Node/VS Code 依赖，确保 esbuild 可同时打进 Node 和 browser bundle。

修订记录：2026-07-02 创建计划，原因是本地化基础设施涉及 manifest、Host/Webview 边界、打包和测试，属于复杂功能，需要可追踪 ExecPlan。

修订记录：2026-07-02 完成本地化基础设施首批实现，补充测试证据并将计划移动到 completed。
