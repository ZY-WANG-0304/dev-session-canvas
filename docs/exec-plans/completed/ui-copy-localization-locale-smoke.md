# 收口 UI 文案真实 Locale 验证

本 `ExecPlan` 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘` 这几个章节。

本计划遵循 `docs/PLANS.md`。当前文件位于 `docs/exec-plans/active/ui-copy-localization-locale-smoke.md`；完成后需要移动到 `docs/exec-plans/completed/`，并把仍遗留的本地化技术债同步到 `docs/exec-plans/tech-debt-tracker.md`。

## 目标与全局图景

前面批次已经把产品拥有的 UI 文案迁移到英文默认和简体中文版本，但设计文档仍把“真实 VS Code locale 验证”列为技术债。本批次要给仓库增加一个可重复的 VS Code locale smoke：分别以英文和简体中文启动 Extension Development Host，检查 manifest 静态文案、Extension Host `vscode.l10n.t(...)` 文案、Webview typed dictionary、standby HTML 与侧栏/模板项是否随 locale 切换。完成后，协作者可以运行一条 npm 脚本看到英文和中文两个 locale 都通过；设计文档可以把本地化验证从“缺真实宿主证据”收口到“已有自动化真实宿主 smoke，发布前仍可补人工抽查”。

## 进度

- [x] (2026-07-03 15:59+08:00) 已读取 `docs/WORKFLOW.md` 与 `docs/PLANS.md`，确认本批次需要 ExecPlan。
- [x] (2026-07-03 15:59+08:00) 已确认当前工作树干净，分支 `ui-copy-localization-foundation` 当前 `ahead 14, behind 26`，本批不执行 rebase/sync。
- [x] (2026-07-03 15:59+08:00) 已梳理现有 VS Code smoke runner，可通过 `extraLaunchArgs` 向 VS Code 传入 `--locale=...`，并复用 `prepareMainSmokeHostExtension(...)` staging 已包含 `package.nls*.json` 与 `l10n/`。
- [x] (2026-07-03 22:18+08:00) 已新增 `scripts/smoke/run-vscode-ui-copy-locale-smoke.mjs` 与 `tests/vscode-smoke/ui-copy-locale-tests.cjs`，分别以 `--locale=en` 和 `--locale=zh-cn` 启动真实 VS Code 宿主并检查 manifest、Host runtime、standby HTML 和 active Webview 文案。
- [x] (2026-07-03 22:18+08:00) 已新增 npm script `test:ui-copy-locale-smoke`，并扩展 `scripts/test/test-vscode-smoke-runner-env.mjs` 断言 `extraLaunchArgs` 会保留 `--locale=zh-cn`；同时修复该文件已有的多余右花括号语法错误。
- [x] (2026-07-03 22:51+08:00) 已同步 `docs/design-docs/ui-copy-localization.md`、`docs/design-docs/index.md`、`docs/exec-plans/tech-debt-tracker.md`：真实宿主 locale smoke 已成为自动验证证据，技术债收缩为发布前更深人工抽查。
- [x] (2026-07-03 22:55+08:00) 已运行最终验证：`node --check scripts/smoke/run-vscode-ui-copy-locale-smoke.mjs`、`node --check tests/vscode-smoke/ui-copy-locale-tests.cjs`、`node --check scripts/test/test-vscode-smoke-runner-env.mjs`、`npm run test:ui-copy-localization`、`npm run test:vscode-smoke-runner-env`、`npm run test:ui-copy-locale-smoke`、`npm run typecheck`、`git diff --check` 均通过。
- [ ] 归档计划并提交本批次。

## 意外与发现

- 观察：`scripts/test/test-vscode-smoke-runner-env.mjs` 在本批修改前已有一个多余的右花括号，导致 `node --check` 报 `SyntaxError: Unexpected token '}'`。
  证据：`node --check scripts/test/test-vscode-smoke-runner-env.mjs` 最初失败在第 108 行；本批删除多余花括号后同一命令通过。
- 观察：`scripts/smoke/vscode-smoke-runner.mjs` 的 `prepareMainSmokeHostExtension(...)` 已把 `package.nls.json`、`package.nls.zh-cn.json` 和 `l10n/` 复制到 smoke host extension。
  证据：函数中的复制列表包含 `package.nls.json`、`package.nls.zh-cn.json`、`l10n`、`dist` 等。
- 观察：现有 smoke 测试里仍有大量中文断言，不能直接用完整 `test:smoke` 来证明英文 locale；需要单独写一个小测试文件，避免和旧场景断言耦合。
  证据：`rg -n "当前 workspace 未受信任|Agent 尚未|未启动" tests/vscode-smoke/extension-tests.cjs` 能看到 restricted path 和部分状态断言使用中文字符串。
- 观察：只传 `--locale=zh-cn` 不足以让 VS Code 在首轮启动时把 `vscode.env.language` 解析成 `zh-cn`；VS Code 需要可用语言包，且 NLS 初始化发生在扩展测试运行前。
  证据：最初的 zh-cn smoke 中 `vscode.env.language` 仍为 `en`，断言 `Expected VS Code to start with zh-cn locale.` 失败。
- 观察：通过 `--install-extension MS-CEINTL.vscode-language-pack-zh-hans` 依赖 Marketplace 安装语言包仍不适合作为本 smoke 的首轮启动方案；安装会在启动过程中写入 `languagepacks.json`，但首轮 NLS 配置已经解析完成。
  证据：安装日志显示语言包可安装，但同一次 Extension Development Host 中 `vscode.env.language` 仍保持 `en`。
- 观察：预置一个本地最小 zh-cn language-pack fixture，并在启动前写入隔离 user-data 的 `languagepacks.json`，可以让 VS Code 自己生成 zh-cn NLS 配置并使 `vscode.env.language === 'zh-cn'`。
  证据：`npm run test:ui-copy-locale-smoke` 最终输出 `UI copy locale assertions passed for zh-cn.` 和 `UI copy locale smoke passed for zh-cn.`。
- 观察：在 zh-cn 宿主中，VS Code 暴露的 manifest localized 字段可能不是纯字符串，而是 `{ original, value }` 形态。
  证据：`tests/vscode-smoke/ui-copy-locale-tests.cjs` 增加 `getManifestLocalizedValue(...)` 后，command title 与 view title 断言能同时兼容英文和简体中文宿主。

## 决策记录

- 决策：新增独立 `test:ui-copy-locale-smoke`，不把完整 `test:smoke` 改成 locale 矩阵。
  理由：完整 smoke 覆盖面大、耗时长，且包含与本地化无关的中文断言；本批需要的是稳定、可重复、低成本地验证本地化资源在真实 VS Code 宿主中生效。
  日期/作者：2026-07-03 / Codex
- 决策：zh-cn 场景使用本地最小 language-pack fixture 加预写 `languagepacks.json`，不依赖 Marketplace 安装官方语言包，也不从父进程注入 `VSCODE_NLS_CONFIG`。
  理由：Marketplace 安装会引入网络和首轮启动时序不确定性；父进程伪造 NLS 配置不能证明 VS Code 宿主自身 locale 解析链路。本地 fixture 只提供 zh-cn 语言包元数据和空 VS Code 核心翻译，由隔离 user data 中的 `languagepacks.json` 触发 VS Code 正常 NLS 解析，能稳定覆盖扩展 manifest、`vscode.l10n.t(...)` 和 Webview 注入边界。
  日期/作者：2026-07-03 / Codex

## 结果与复盘

实现与验证已完成。仓库新增 `scripts/smoke/run-vscode-ui-copy-locale-smoke.mjs`、`tests/vscode-smoke/ui-copy-locale-tests.cjs` 和 npm script `test:ui-copy-locale-smoke`；真实 VS Code 宿主可以分别以英文和简体中文 locale 检查 manifest、Host runtime、standby HTML 与 active Webview 代表性文案。设计文档已把真实 locale smoke 纳入自动验证，技术债从“缺真实 locale smoke”收缩为发布前更深人工抽查。剩余风险是 smoke 只覆盖代表性路径，不替代发布前对所有 QuickPick、模板市场和错误路径的人工抽查。

## 上下文与定向

VS Code 有两类本地化边界。第一类是 manifest 静态贡献点，例如 `package.json` 里的 command title、view title 和 configuration description，它们通过 `package.nls.json` 与 `package.nls.zh-cn.json` 由 VS Code 在宿主侧替换。第二类是运行时文案，例如 Extension Host 的通知、QuickPick 和 Webview HTML，它们分别使用 `vscode.l10n.t(...)` 或 Webview typed dictionary。

本仓库已有 VS Code smoke 基础设施：`scripts/smoke/vscode-smoke-runner.mjs` 负责准备隔离 user data、extensions dir、测试 home 和 artifacts；`prepareMainSmokeHostExtension(...)` 会把主扩展打包后的 `dist`、nls 文件、l10n bundle 和测试文件复制到 `.debug/vscode-smoke/.../smoke-host`；`launchPreparedVSCodeScenario(...)` 启动 VS Code 并执行 `--extensionTestsPath=<test file>`。本批次会复用这套 runner，只新增一个更小的 locale smoke，而不是修改已有大型 smoke。

“真实 locale smoke”在本计划里指：启动真正的 VS Code Extension Development Host，传入 `--locale=en` 或 `--locale=zh-cn`，激活扩展后通过 VS Code API 和 test commands 读取可观察文案。它不同于纯 Node 测试，因为 `vscode.env.language`、manifest nls 替换和 `vscode.l10n.t(...)` 都由真实 VS Code 宿主参与。

## 工作计划

第一步新增 `tests/vscode-smoke/ui-copy-locale-tests.cjs`。该测试文件读取环境变量 `DEV_SESSION_CANVAS_EXPECTED_LOCALE`，激活扩展后断言 `vscode.env.language` 符合预期；用 `vscode.extensions.all` 找到当前扩展并检查 localized manifest 中至少一个 command title 和一个 view title，例如英文应是 `Dev Session Canvas: Create Node` / `Overview`，中文应是 `Dev Session Canvas: 创建节点` / `概览`。随后执行 `devSessionCanvas.openCanvasInEditor` 和 `devSessionCanvas.__test.createNode` 创建 Agent / Terminal / Note，等待 Webview probe，断言英文 overlay title 是 `Agent not started yet` / `Terminal not started yet`，中文 overlay title 是 `Agent 尚未启动` / `终端尚未启动`，Note placeholder 或 sidebar/template item 也应匹配对应 locale。

第二步新增 `scripts/smoke/run-vscode-ui-copy-locale-smoke.mjs`。该 runner 使用现有 `shouldReRunInsideXvfb()`、`prepareRuntime(...)`、`prepareMainSmokeHostExtension(...)` 和 `launchPreparedVSCodeScenario(...)`，对 `en` 与 `zh-cn` 两个 scenario 分别启动 VS Code。每个 scenario 的 `extraLaunchArgs` 包含 `--locale=<locale>`，`extensionTestsEnv` 包含 `DEV_SESSION_CANVAS_EXPECTED_LOCALE`、fake agent provider 路径和 PATH。

第三步更新 `package.json` 增加 `test:ui-copy-locale-smoke`，并扩展 `scripts/test/test-vscode-smoke-runner-env.mjs` 或新增轻量测试，确认 `buildVSCodeArgs(...)` 能保留 `--locale=zh-cn` 这类 extra launch arg。若现有 runner 已通过 extraLaunchArgs 保留，无需改生产 runner，只需让测试覆盖该用法。

第四步更新文档。`docs/design-docs/ui-copy-localization.md` 的验证方法要加入 `npm run test:ui-copy-locale-smoke`；手动验证段落要说明本批已补真实宿主自动化 locale smoke，人工验证仍可作为发布前抽查但不再是阻塞技术债。`docs/exec-plans/tech-debt-tracker.md` 需要删除或收缩“UI 文案本地化仍需真实 locale 验证”这一债务，保留发布前人工抽查口径即可。

## 具体步骤

在仓库根目录执行以下命令：

    node --check scripts/smoke/run-vscode-ui-copy-locale-smoke.mjs
    node --check tests/vscode-smoke/ui-copy-locale-tests.cjs
    node --check scripts/test/test-vscode-smoke-runner-env.mjs
    npm run test:ui-copy-localization
    npm run test:vscode-smoke-runner-env
    npm run test:ui-copy-locale-smoke
    npm run typecheck
    git diff --check

`test:ui-copy-locale-smoke` 预期会启动两次 VS Code：一次 `--locale=en`，一次 `--locale=zh-cn`。成功时应打印英文和中文 locale smoke 均通过。若本地没有图形环境，runner 应沿用现有 `xvfb-run` 逻辑；若 `xvfb-run` 不存在导致无法启动 VS Code，需要记录为环境阻塞，但仍应让 Node 层测试和文档清楚说明如何重试。

## 验证与验收

自动验收标准是：`test:ui-copy-locale-smoke` 在真实 VS Code 宿主里验证 `vscode.env.language`、manifest localized title、Host/side bar/template runtime 文案和 Webview active DOM 文案随 locale 切换；`test:ui-copy-localization` 继续验证静态 key parity 和源码硬编码规则；`test:vscode-smoke-runner-env` 证明 smoke runner 参数和环境清洗不破坏 locale；`typecheck` 和 `git diff --check` 通过。

用户可观察验收是：英文 VS Code 看到英文 `Create Node`、`Overview`、`Agent not started yet` 等文案；简体中文 VS Code 看到 `创建节点`、`概览`、`Agent 尚未启动` 等文案。因为本批仍不会人工点击每一个 UI 路径，文档不能宣称所有交互都已人工覆盖，但可以宣称关键三层本地化边界已有真实宿主自动化验证。

## 幂等性与恢复

新增 smoke runner 只写入 `.debug/vscode-smoke/ui-copy-locale-*` 和临时 runtime 目录，可重复运行。若某次 VS Code 启动失败，runner 会复用现有日志 snapshot 到 artifacts 目录。若某条断言因文案迭代变化失败，应先确认英文默认字典、中文字典和 manifest nls 是否同步，再更新 smoke 预期；不要为了通过测试而绕过真实 locale 启动。

## 证据与备注

已完成第一轮静态本地化测试、真实 VS Code locale smoke 可行验证和提交前最终验证。关键输出：

    UI copy locale assertions passed for en.
    UI copy locale smoke passed for en.
    UI copy locale assertions passed for zh-cn.
    UI copy locale smoke passed for zh-cn.
    UI copy locale smoke passed.
    ui copy localization tests passed
    vscode smoke runner env sanitization passed
    tsc -p ./tsconfig.json --noEmit

`git diff --check` 无输出并返回 0，说明当前 diff 没有 whitespace error。

本批新增的 zh-cn language-pack fixture 只写 `.debug/vscode-smoke/ui-copy-locale/zh-cn` 下的隔离 user data 和 extensions dir；它不进入扩展发布包。

## 接口与依赖

新增 `scripts/smoke/run-vscode-ui-copy-locale-smoke.mjs` 必须使用 `launchPreparedVSCodeScenario(...)` 的 `extraLaunchArgs` 传入 `--locale=<locale>`，不能通过父进程 `VSCODE_NLS_CONFIG` 伪造宿主语言。zh-cn 场景必须在 launch 前把本地 language-pack fixture staging 到 runtime extensions dir，并写入 runtime user-data 的 `languagepacks.json`，使 VS Code 自身在首轮启动中解析 `vscode.env.language`。新增 `tests/vscode-smoke/ui-copy-locale-tests.cjs` 必须只依赖公开 VS Code API 和已存在的 `devSessionCanvas.__test.*` 命令，不新增用户可见命令；如果读取 manifest localized 字段，必须兼容纯字符串和 `{ value }` 两种形态。

修订记录：2026-07-03 创建计划，明确本批新增独立真实 VS Code locale smoke，而不是扩大完整 smoke 矩阵。

修订记录：2026-07-03 22:18+08:00 完成 runner、测试文件、test-only standby HTML snapshot 和 runner 参数单测扩展；记录 `test-vscode-smoke-runner-env` 原有语法错误修复。

修订记录：2026-07-03 22:51+08:00 记录真实 zh-cn locale 启动的语言包时序发现、最终 language-pack fixture 方案、文档和技术债收口，以及最终验证命令列表。

修订记录：2026-07-03 22:55+08:00 补充最终验证结果，并准备将计划归档到 completed。
