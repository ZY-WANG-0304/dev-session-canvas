---
title: 最新主线发布前遗留验证
decision_status: 待探索
validation_status: 验证失败
domains: [执行编排域, VSCode 集成域]
architecture_layers: [宿主集成层, 画布呈现层, 适配与基础设施层]
related_specs: [docs/product-specs/runtime-persistence-modes.md]
related_plans: [docs/exec-plans/completed/main-validation-2026-10-12.md]
updated_at: 2026-10-12
---

# 最新主线发布前遗留验证

## 当前结论

PR #319 合入后的固定主线仍未通过完整门禁：原 `npm test` 和完整源码 `test:smoke` 均失败。独立补验让遗留范围更清楚，但不能将这些通过结果拼成原完整命令已通过。本轮验证工作已完成，修复方案尚未实施，故文档的验证状态为“验证失败”，决策状态保持“待探索”。

此前 `systemd-user-real-reopen` 的 20 秒 Canvas 就绪超时，以及 Webview 主题跟随超时，本轮均未重现。Webview 全套首次实际执行 424/424 通过，完整 Host wiring 634/634 通过，固定提交 clean-checkout 打包后的八个 VSIX 安装场景全部通过。旧失败的原因仍未确认，不追认历史运行通过。

遗留门禁有五组：关闭模式单元断言过时、checkpoint 尚未收齐分页就断言总长度、fallback 夹具与提交后 unknown 契约冲突、发布 CI 缺少冷缓存浏览器前置准备、旧 Supervisor 升级使用旧 socket resolver。旧升级另外出现过一次 resize 一致性等待超时，原因未明，仍作为独立待定位项保留。

## 范围与固定输入

用户要求基于最新 `origin/main` 再验证 PR #319 后的遗留问题。2026-10-12 拉取并固定主线 `c32437ac008b1d933e9e13975e60c869e7bb33d4`；收口时再次 fetch，主线仍为该提交。隔离工作树为 `/tmp/dscmainv1012`，环境为 Linux x64、Node 22.23.3、VS Code 1.141.0。原工作树的未跟踪 `image.png` 保留原状。

主线版本仍为 0.26.0，该版 `release:verify` 存在单次授权例外。本轮直接执行完整路径的组成命令，未准备 0.26.1 静态发布材料。结果不代替未来发布准备 PR 的预合并 `release:verify`，也不代替 publish tag checkout 的验证。

所有正式产品、测试断言、workflow、版本和发布契约均使用固定主线原输入。`npm ci`、主扩展默认 build 和 notifier build 通过；六目标原生资产经当前 build 核验来源和内容，但本次仅在 Linux x64 执行实际产品验证。

公共环境使用以下资产和缓存；各 smoke 使用独立短日志/存储路径，`umask 0077`：

- Node PATH 前缀：`/tmp/dsc-release-node22/node_modules/node/bin`。
- `DEV_SESSION_CANVAS_EXECUTION_ASSETS_SET=/tmp/dsc-release-026-assets`。
- `DEV_SESSION_CANVAS_VSCODE_TEST_CACHE_PATH=/tmp/dsc0261v/.vscode-test`。
- `DEV_SESSION_CANVAS_TEMPLATE_MARKETPLACE_VSCODE_E2E_HOST_TMP_ROOT=/tmp/dm12m`。
- 各次 `DEV_SESSION_CANVAS_SMOKE_DEBUG_ROOT`、命令、起止时间和退出码见 `docs/references/main-validation-2026-10-12/evidence.json`。

## 已通过范围

| 验证组 | 本轮结果 | 证据边界 |
| --- | --- | --- |
| 发布门禁回归 | `test:release-preflight`、`test:release-preflight-workflow` 通过 | 门禁实现回归，不是 0.26.1 发布契约验收 |
| `npm test` 首败前缀 | typecheck、市场单元/API/Web、浏览器 E2E、真实 VS Code 市场 E2E、workspace-relative-paths 通过 | 原完整命令随后在 execution-context 失败 |
| 首败后的组成测试 | 56 项非完整 UI 组成检查全部独立通过 | 包含真实 socket 协议、分页、终态历史、credit、包布局和 shared-root-store；不覆盖失败脚本中未触达的后续断言 |
| Host 与 Runtime 定向 | 完整 Host wiring 634/634；root ownership/preparation、startup profile/reader 通过 | Host wiring 使用受控 non-native Host，真实 runtime 协议另有具名测试 |
| Webview 全套 | 424/424，12.0 分钟，2 workers，无用例重试 | 原主题用例在全套第 49 项、1.7 秒通过 |
| notifier | typecheck、companion smoke、en/zh-cn locale smoke 通过 | 本机真实 VS Code fixture |
| 固定提交 clean-checkout | 独立 `npm ci`、正式 VSIX 打包、八个安装 smoke 场景全部通过，包括完整 trusted | 安装矩阵与源码恢复矩阵不同；旧升级及 checkpoint 不能由此代证 |
| 源码本地场景 | 完整源码 smoke 的前七个本地场景通过 | 随后在 checkpoint 首败 |
| 源码独立恢复场景 | trusted/restricted、普通重开、多根重开、单根切多根重开、双窗口共享、systemd user 重开、Remote SSH 重开均通过 | 每个实际执行场景的 setup/verify 完整通过；Linux、fake provider；systemd 使用 fake systemctl，Remote SSH 为 localhost SSH fixture |

双窗口场景验证了结构共享、双向 I/O、PTY resize、stop/delete、非最后窗口退出后保留共享执行、最后窗口清理和退出，以及关闭模式的私有隔离。范围仍限定 Linux 单 root，不代证真实多 root 双窗口或完整 UI 分阶段接管矩阵。

Webview 最初的命令停在 Chromium revision 1217 下载 0%，尚未开始测试。只终止本任务的 installer 及下载子进程，复制本机已有同 revision 缓存后，首次实际全套执行通过。这次准备中断独立记录为 `environment-setup-interrupted-before-tests`，不计为用例失败。暖缓存执行通过也不证明发布 CI 冷缓存就绪。

## 遗留门禁

### 1. 关闭模式的旧单元断言阻断 npm test

原 `npm test` 首次 exit 1，停在 `scripts/test/test-canvas-execution-context.mjs:708`。`makePreferenceHost` 默认 `enabled=false`，夹具仍期待 root 会话重连返回 `undefined`；实际为 `runtime-persistence-disabled`，符合 PR #319 后关闭模式不接管共享 root 绑定的正式规则。

相邻后续断言也仍采用旧期待，首败后的脚本段落本轮未执行。后续修复应按当前关闭模式契约校准该测试，并重新执行完整脚本和 `npm test`，不能以独立 56 项检查代替。

首次日志：`/tmp/dmv12/npm-test.log`。

### 2. Checkpoint 首分页到达时提前断言完整长度

完整源码 `npm run test:smoke` 首次 exit 1，停在 `tests/vscode-smoke/extension-tests.cjs:390`。快照声明 current-state 长度 104842，但等待条件刚收到 8192 字符的首分页就断言总长度，没有等待后续页到齐。

等待收齐再断言的修正在已关闭 PR #317 / `origin/release-0-26-1-latest-main`，未进入本轮主线。当前停点不能直接认定为产品数据丢失；checkpoint 的后续内容、读者与刷新断言尚未获得本轮通过证据。应在修正等待条件后保持连续页与精确长度断言，再复验完整场景。

首次日志：`/tmp/dmv12/source-smoke-full.log`。首败工件：`/tmp/dmv12/s57/runtime-checkpoint-refresh/artifacts`。

### 3. Systemd fallback 夹具与提交后 unknown 规则冲突

`systemd-fallback-real-reopen` setup exit 1。fake systemctl 的 `fail-start` 已实际提交，保留 startup-intent，却没有 started receipt；后续三个节点为 error，报告 `The previous root runtime launch is unconfirmed.`。

`extensions/vscode/dev-session-canvas/src/supervisor/runtimeRootPreparation.ts` 在提交后保留 unknown，禁止再次提交或切换 backend；这符合 `docs/design-docs/runtime-root-ownership.md` 的提交边界。旧夹具仍要求提交失败后自动 fallback，与正式契约冲突，不能通过放宽产品 unknown 保护使测试变绿。

提交前明确 unavailable 的允许 fallback 分支已有纯回归通过；该语义的真实宿主 fallback 重开场景仍需对齐 fixture 后取得证据。当前原 fallback 场景没有完整通过结果。

首次日志：`/tmp/dmv12/systemd-fallback.log`。首败工件：`/tmp/dmv12/systemd-fallback/systemd-fallback-real-reopen/artifacts`。

### 4. 发布 CI 缺少 Chromium 冷缓存准备

`.github/workflows/release-preflight.yml` 和 `.github/workflows/publish-marketplace-release.yml` 在 `npm ci` 后均没有为完整验证预装 Chromium。`npm test` 的早期市场浏览器入口 `scripts/test/test-template-marketplace-publish-page.mjs:71` 直接调用 `chromium.launch()`。

使用空 `PLAYWRIGHT_BROWSERS_PATH=/tmp/dmv12/cold-browser` 执行原 `test:marketplace-browser-e2e`，实际 exit 1，缺少 `chromium_headless_shell-1217/.../chrome-headless-shell`。暖缓存同一入口此前通过。这证明当前入口依赖外部浏览器准备，主线 workflow 没有闭合该前置条件。

PR #317 的浏览器预装、统一 cache 和短 TMP 改动尚未合入。后续应同步准备实际使用的浏览器版本与缓存，再在冷环境验证；本轮没有运行完整 GitHub CI，系统库依赖和默认长 TMP 路径表现仍不能由本机短路径外推。

日志：`/tmp/dmv12/cold-browser.log`；执行记录：`/tmp/dmv12/cold-browser-status.json`。

### 5. 旧 Supervisor 升级仍使用旧 socket resolver

旧升级进行了三次原产品/原夹具运行，停点分别保留：

| 运行 | 实际停点 | 当前判断 |
| --- | --- | --- |
| `/tmp/dmv12/s60` | 共享 Canvas commit lease 的 `127.0.0.1:24084` 被占用，reset 失败 | 退出后只读 `ss` 仍观察到 listener；未停止该 listener，旧升级业务未验收 |
| `/tmp/dmv12/lr2` | 旧 Agent/Terminal 已附着并接收输入，`legacy-supervisor-upgrade-tests.cjs:259` 等 Terminal 尺寸等于捕获的 Webview probe，20 秒超时 | 独立 resize 待定位项，不能直接归因于后续 socket resolver |
| `/tmp/dmv12/lr3` | 越过旧 resize 段；`legacy-supervisor-upgrade-tests.cjs:321` 连接新 root 会话时报 `ENOENT` | 第 318 行仍使用 `resolveLegacyRuntimeSupervisorPathsFromStorageDir`，无法定位 root `d-*` socket |

第三次运行请求了旧 socket：

    /tmp/dsc-vscode-smoke-runtime-legacy-supervisor-upgrade/dev-session-canvas/1927a20608bfb7f73e2e508e.sock

新 root 的正确地址应为：

    /tmp/dsc-root-1115017707/d-1927a20608bfb7f73e2e508e.sock

工件保留新 root owner 和 started receipt，backend 为 `legacy-detached`、generation 为 `terminal-root-owner-linux-v1`、root 为 `/tmp/dscmainv1012`。新 root resolver 修正也留在关闭的 PR #317，未进入 main。应按新会话真实 owner/generation 解析地址，保留旧 session 继续可操作和旧 Supervisor 退役等断言。

没有一次完整旧升级场景通过。第三次越过 resize 并不覆盖第二次首败：第二次原 Terminal 仍 live、尺寸 85x28，Webview/Host input marker 均到达 PTY，但没有持久化 expected probe 快照，无法确定是产品 resize 故障还是瞬时几何夹具问题。后续须补齐原执行身份、请求尺寸、probe 尺寸与应用时序证据，再定位，不应仅扩大超时预算。

对应日志依次为 `/tmp/dmv12/source-legacy-supervisor-upgrade.log`、`/tmp/dmv12/source-legacy-recheck.log`、`/tmp/dmv12/source-legacy-stability.log`。端口观察为 `/tmp/dmv12/legacy-port-observation.log`；三次工件均保留在各 debug root 的 `legacy-supervisor-upgrade/artifacts`。

## 证据、交付与后续

逐项证据登记在 `docs/references/main-validation-2026-10-12/evidence.json`：85 条执行记录包含准确命令、场景环境、时间、退出码、分类与日志 SHA256，并记录固定源码、原生资产、最终 VSIX 及关键工件摘要。原始日志和失败工件保存在本机 `/tmp/dmv12`；JSON 的绝对路径用于定位本次现场，不保证在其他机器可用。正式结论以本报告为准，reference JSON 是可复查输入。

固定提交 clean-checkout 为 `/tmp/dev-session-canvas-clean-checkout-W5GzG1/repo`，最终主 VSIX 为该目录下的 `dev-session-canvas-0.26.0.vsix`，5998878 字节，SHA256：

    5eb89fee1ee9ae1a3564aaad9db8c509571e872aa53d8d2480d652ec604eeb60

本轮只交付验证报告、证据、索引、原则补充和技术债，未修复产品或测试。后续应先对齐确定的断言、分页等待、fallback fixture、socket resolver 与 CI 前置准备，另行定位旧 resize 首败；完成后重新运行完整门禁。技术债登记不构成发布豁免，不能以本报告代替 0.26.1 正式发布输入及其预合并/tag verify。

macOS/Windows、真实 provider、完整 UI 分阶段接管矩阵、真实多 root 双窗口、真实远端长断开和公开市场安装不从本轮 Linux fake-provider 验证外推。


## 集中收口后的历史边界（2026-10-13）

本报告按原固定输入和完成时点保留，不作为最新main或0.26.1当前门禁结果。后续已有独立resize/ready/SSH修复合入，剩余probe及fallback路径夹具、回归、WORKFLOW和全部关联根因证据集中PR329；PR327发布输入独立。当前完整组合结果见systemd-smoke-scope-root-cause.md和repair-combined-input.json，不能由本报告的局部或历史通过代证。
