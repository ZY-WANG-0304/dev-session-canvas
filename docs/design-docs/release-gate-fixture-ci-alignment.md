---
title: 发布门禁夹具与 CI 前置条件对齐
decision_status: 已选定
validation_status: 验证失败
domains: [执行编排域, VSCode 集成域]
architecture_layers: [宿主集成层, 适配与基础设施层]
related_specs: [docs/product-specs/runtime-persistence-modes.md]
related_plans: [docs/exec-plans/completed/release-gate-fixture-ci-alignment.md]
updated_at: 2026-10-13
---

# 发布门禁夹具与 CI 前置条件对齐

## 背景与目标

用户授权修复 PR #319 后主线复验发现的五组夹具/CI 问题。基线为 `c32437ac008b1d933e9e13975e60c869e7bb33d4`，前轮验证报告在 PR #320。原 npm test 首败于关闭模式的旧重连期待，源码 smoke 在 checkpoint 首分页即断言总长度；fallback 在启动已提交后仍期待换后端，新 root upgrade 会话仍使用旧 socket resolver，冷缓存市场浏览器 E2E 缺 Chromium。

本轮目标是使测试真正覆盖现有契约、让完整门禁具备浏览器及短路径前置条件。产品关闭模式、root ownership、启动提交保护、原内容断言和等待预算保持；不准备版本或发布契约。

## 正式方案

### 关闭模式与开启模式分别验证

`scripts/test/test-canvas-execution-context.mjs` 的 preference fixture 按应用模式显式构造。关闭模式对 root、无效 root owner、旧 slot 的 live 重连均返回 `runtime-persistence-disabled`；只清理旧 slot 会话，不 attach、不删除共享 root 会话，不重写原 binding。开启模式仍按原 backend/storage/owner/session 恢复，保持不可信 workspace、绑定替换、迟到连接等保护断言。

root 加载用例区分 `context.globalStorageUri` 下共享 snapshot 和 workspace slot 的 `private-root-canvases-v1`。开启模式加载共享 root 后保持重连态；关闭模式不继承共享内容，误复制的共享 owner 解除为私有历史而不接管原 runtime。原普通关闭的模式组合矩阵保持并完整执行，不借纯测试替代最后开启窗口主动关闭的协调验收。

restore 先等共享 root 协调器 ready，再捕获当前 state；异步替换矩阵必须等待原连接请求已发出，才能修改 binding 验证在途结算。补 `connectionRequested` 屏障，保留 backend/storage/owner/session/删除与连接成功/失败的正反例。单根加载源码 guard 断言同步当前模式规则，完整脚本执行至结束。

### Checkpoint 收齐再断言

`tests/vscode-smoke/extension-tests.cjs` 的等待 predicate 在已收到字符数小于快照声明长度时返回 false，继续原 30 秒等待。连续 offset、精确总长度、current-state 页无事件、post-capture revision、内容与后续刷新断言保持。超出声明长度或不连续仍失败，不改变产品分页和数据保留语义。

### Fallback 发生在提交前

`scripts/smoke/run-vscode-smoke.mjs` 的 `systemd-fallback-real-reopen` 清空 `DBUS_SESSION_BUS_ADDRESS` 与 `XDG_RUNTIME_DIR`，让真实 `/usr/bin/systemd-run --user` 在启动提交前明确报告 user bus 不可用。fake systemctl 配置为正常成功，场景结束后必须证明其没有调用日志；setup/verify 均继续验证 legacy-detached/best-effort 原会话重开。

这复用 `runtimeSystemdEnvironment.ts` 现有 unavailable 分类，不增加产品绕过。`runtimeRootPreparation.ts` 提交后 unknown 禁止二次提交/换后端不变；已有 submit-error/ready-timeout 负面回归继续执行。真实 systemd 服务或实际远端长断开不由该 fixture 代证。

### 旧会话与新 root 使用各自地址

`tests/vscode-smoke/legacy-supervisor-upgrade-tests.cjs` 旧会话仍使用历史 slot resolver，新会话必须带有效 root owner 并按现代 Unix root namespace `/tmp/dsc-root-<uid>/d-<storage digest>.sock` 连接。保留旧 Agent/Terminal 输入与 resize、新会话身份隔离、历史 Supervisor 退役和资源清理断言；不提高20秒等待预算。

旧 upgrade 的 resize 一致性首败原因尚未知。如果本轮再次停在该处，保留具名失败和证据，不将其归为已经解决的 socket 问题，也不扩大本轮为产品 resize 修复。

### PR/tag 准备同一浏览器 cache

`.github/workflows/release-preflight.yml` 的 release verify job 与 `.github/workflows/publish-marketplace-release.yml` 的 prepare job 统一设置 `PLAYWRIGHT_BROWSERS_PATH=${{ github.workspace }}/.playwright-browsers`。固定 ref 的 `npm ci` 后、完整 verify 前，运行 `npx --no-install playwright install --with-deps chromium`，确保用锁定依赖的 CLI 安装匹配版本及系统库。市场浏览器直接入口和 Webview 独立环境使用同一 checkout cache。

PR 只在存在本次发布输入时安装；tag checkout 没有 release verifier 的历史路径不新增该前置。市场 VS Code E2E 的宿主 TMP 设置为 `/tmp/tm-${{ github.run_id }}`，避免 Unix socket 路径预算被 checkout/user-data 长路径耗尽。`scripts/test/test-release-preflight-workflow.mjs` 与 `scripts/test/test-publish-marketplace-workflow.mjs` 校验安装条件、顺序、cache 和短 TMP。

## 验证方法与结果

完整 execution-context、两组 release-preflight 回归及 publish workflow 回归均已通过。root preparation 26 项、systemd 判定 40 项、root preparation client 21 项及 storage 回归通过，覆盖提交前 unavailable/unknown 与提交后失败禁止二次提交。

定向原生 checkpoint 与 legacy upgrade 首次完整通过，既有长度、内容、新旧身份、操作和退役断言保持。按串行浏览器准备执行的完整 npm test 随后在旧升级 Agent resize 一致性等待再次超时，旧问题仍未收口。

Fallback 定向运行首次 setup 通过，保留 legacy-detached started receipt，未产生任何 fake systemctl 日志；verify 在 editor Canvas ready 20 秒超时。首败 snapshot 显示 surface generation 5、ready/ack 均 false，原 Agent/Terminal 仍存活；根因未知，不改 ready 条件或等待预算。`tests/vscode-smoke/real-reopen-tests.cjs` 的失败工件追加已有 Host 诊断事件，以便后续具名定位；不改变业务断言或原失败传播。

完整命令停在旧升级后，一次有限 fallback 复验使用已有当前构建直接运行 `node scripts/smoke/run-vscode-smoke.mjs`，过滤 `systemd-fallback-real-reopen` 并使用独立目录；setup 与 verify 均完整通过，最终确认没有任何 systemctl 命令。该通过证明当前提交前 unavailable 夹具能够完成两阶段，不追认首次 ready 超时根因已修复；两次日志和状态均保留。

冷缓存安装执行 workflow 同一条 `npx --no-install playwright install --with-deps chromium` 并成功退出，Chrome/Headless Shell 147.0.7727.15、FFmpeg 实际下载完成；未复制旧浏览器。系统依赖已具备，安装命令核验为 0 新装/升级，不能将其外推为全新 OS 缺库安装通过。使用该新 cache 的 `npm run test:marketplace-browser-e2e` 已通过。

完整 npm test 首次的早期市场浏览器使用本机同 revision 已有 cache，后续 wrapper 使用本工作树 cache；activitybar-badges 的安装入口等待本轮并行冷安装锁后退出 1，尚未执行 badge 用例、后续源码 smoke 或 Webview。保留 `/tmp/dga12/npm-test.log`。

冷安装成功后按 workflow 的串行准备顺序，使用新 cache 原样执行一次完整 npm test，日志 `/tmp/dga12/npm-test-prepared.log`。全部纯测试/浏览器前缀以及源码 local-execution-flow、owned-canvas-reconciliation、snapshot-only-manual-recovery、local-surface-cutover、local-preparation-failure、local-links-and-stop、local-pty-robustness、runtime-checkpoint-refresh、trusted、restricted 通过；旧升级在 `legacy-supervisor-upgrade-tests.cjs:250` 等待原 Agent resize 与捕获页面 probe 一致时 20 秒超时，命令退出 1。最后 session 为 waiting-input、82×27，原输入 marker 已到达；期望的捕获 probe 尺寸没有存入失败工件，根因仍未知，不能从最后尺寸推断是 PTY、页面 fit 或测试时序问题。

该完整命令没有触达后续 real-reopen、multi-root-real-reopen、single-to-multi-root-real-reopen、two-window-shared-runtime、systemd-user-real-reopen、systemd-fallback-real-reopen、remote-ssh-real-reopen 与最终 Webview。独立 `npm run test:webview` 使用本轮新 cache，424/424 通过；一次 fallback 诊断复验完整通过。两者不能拼接为完整 npm test 通过。本方案状态因此记为“验证失败”：确定的夹具/CI 对齐已实施并有针对证据，完整门禁仍未通过。

本轮环境为 Linux x64、Node 22.23.3、VS Code 1.141.0、fake Agent；原生资产由当前 build 核验。macOS/Windows、真实 provider、多 root 双窗口、真实 systemd 与远端长断开不从本轮外推。

仓库内证据入口为 `docs/references/release-gate-fixture-ci-alignment/evidence.json`：固定基线、9 个测试/workflow 输入 hash、命令、环境、退出状态和原日志 hash。`fallback-first-failure-summary.json` 保留首次 ready 失败的 surface、会话、started receipt 与无 systemctl 日志事实；`legacy-resize-full-run-failure.json` 保留完整命令的 Agent 最后 session、断言位置与未触达范围。原日志/工件保留在 `/tmp/dga12`；早期独立检查没有捕获准确起止时间，不由文件时间捏造运行时间。

## 遗留与交付边界

前轮旧升级有一次 Terminal resize 与捕获 probe 不一致超时、一次 commit lease 24084 端口占用，没有完整场景通过；后一次越过 resize 后停在新 root 旧 socket。本轮定向首次通过，完整命令又在 Agent resize 一致性失败；未知原因保留在技术债，本轮只收口确定的测试/CI 对齐。完整门禁仍失败，0.26.1 还需要先收口未知问题，再按其静态发布输入执行预合并/tag verify。

2026-10-12 后续独立修复：旧升级 resize 的受控根因与修复见 `runtime-legacy-resize-convergence.md`。测试改为先建立容器/页面/原会话基线，再共同核对精确卡片目标；标准和受控延迟原生通过，真正漏 resize 仍在原20秒内失败。此前完整命令失败作为历史事实保留，fallback Canvas ready 仍未定位，完整门禁没有重跑通过，本设计验证失败状态保持。

2026-10-13 后续主线验证：PR325 合入后的 main `ea0c9b19` 原样完整 npm test exit0，旧升级及全部后续源码 smoke 通过，Webview426/426；结果见 [新主线报告](main-release-readiness-2026-10-13.md)。默认 clean-checkout 另有安装 ETXTBSY 首败，独立串行安装对照完成打包和八组 VSIX smoke；不将其拼接为默认首轮通过，不外推0.26.1预合并/tag门禁。本设计的原基线失败和hash保留，状态继续表示该历史验证失败。
