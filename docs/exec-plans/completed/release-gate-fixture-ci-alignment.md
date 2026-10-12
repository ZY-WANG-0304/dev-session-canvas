# 对齐发布门禁夹具与 CI 前置条件

本 ExecPlan 按 `docs/PLANS.md` 维护。用户授权修复上一轮主线复验确认的夹具和 CI 前置条件问题。完成后，正式门禁能够验证当前 Runtime 契约，并能在无浏览器缓存的环境启动测试；通过与遗留失败仍分别报告。

## 目标与全局图景

从最新 `origin/main` 的 `c32437ac008b1d933e9e13975e60c869e7bb33d4` 创建独立工作树 `/tmp/dscgate1012`，分支 `release-gate-fixture-ci-alignment`。原工作树的未跟踪 `image.png` 保留原状。只修复测试夹具、断言和 workflow 准备，不改变正式产品的关闭模式、root ownership、启动提交规则、等待预算或版本。上一轮原 `npm test`、checkpoint、fallback 与旧升级失败，以及冷浏览器缓存前提缺失均保留；旧 resize 超时根因不在本轮预设。

## 进度

- [x] (2026-10-12) fetch 最新主线，固定基线并建立隔离工作树；核对旧 PR #317 的未合入修正及正式 Runtime 契约。
- [x] 编写正式设计与本计划，明确提交前 unavailable 的 fallback 故障注入方式。
- [x] 修正关闭/开启模式、重连和加载单元夹具，补原连接请求屏障与当前模式加载源码断言；完整 execution-context 回归通过，原普通关闭矩阵保留并通过。
- [x] 修正 checkpoint 分页等待与旧升级新 root socket 定位；两个原生场景首次完整通过，内容和资源退役断言保持。
- [x] 对齐 fallback 为提交前 user bus 明确不可用；首次 setup 通过、verify ready 超时，一次有限独立复验两阶段完整通过并确认无 systemctl 提交，首败原因仍未知。提交后 unknown 的纯回归26项、systemd判定40项通过。
- [x] 为 PR/tag 门禁统一浏览器 cache 与短宿主 TMP，预装 Chromium 和系统依赖，两个 workflow 回归通过。
- [x] 冷缓存执行 workflow 同一预装命令成功，Chrome/Headless Shell 147.0.7727.15 和 FFmpeg 安装完成；使用该新 cache 的市场浏览器 E2E 通过。
- [x] 完整 npm test 首次因本机并行安装缓存锁退出；按串行准备后的一次完整验证通过全部前缀与 trusted/restricted 源码 smoke，仍在旧升级 Agent resize 一致性等待超时。后续七组重开矩阵与 Webview 未触达，完整门禁仍失败。
- [x] 独立 Webview 使用本轮新 cache，424/424 通过；一次 fallback 复验两阶段通过。保留首败，不拼接为完整门禁通过。
- [x] 同步验证证据与遗留债务，归档计划；形成独立修复 PR 的代码、文档和验证材料。

## 意外与发现

关闭模式的旧测试不只第 708 行过时，还期待 root 继续 attach、从共享 snapshot 加载、普通关闭时删除共享 root；须按当前私有 slot 和实际应用模式分别修正，不能只改一个返回值。

`runtimeSystemdEnvironment.ts` 使用绝对路径 `/usr/bin/systemd-run`，仅更换 PATH 或令 fake systemctl start 返回错误都不能证明提交前 unavailable。原参数探测在 `DBUS_SESSION_BUS_ADDRESS=`、`XDG_RUNTIME_DIR=` 时实际返回 `Failed to connect to bus: Connection refused`，属于产品已有的明确 unavailable 判据。本轮使用这两个环境变量隔离 user bus，不增加产品测试绕过。

恢复函数先等待共享root协调器ready，再读取当前state。原异步替换fixture在调用restore后立即改state，实际上改变的是捕获前输入；新增connectionRequested屏障后才替换绑定，使该矩阵验证真正的原连接在途结果。完整execution-context还触达过时的单根加载源码字符串断言，已按当前模式guard对齐；完整脚本最终通过。

2026-10-12定向checkpoint与legacy upgrade首次完整通过。fallback首次setup完成并保留legacy-detached started receipt，未创建systemctl日志，verify遇Canvas ready20秒超时，surface generation5、ready/ack均false，原Agent/Terminal仍存活；原因未确认，不覆盖或放宽该首次结果。冷缓存安装成功退出，匹配的 Chrome、Headless Shell 与 FFmpeg 实际下载完成；系统依赖已具备，本机核验为 0 新装/升级，不能声称本轮在全新 OS 安装了缺失系统库。

完整 npm test 首次退出 1：早期市场与纯测试前缀通过，activitybar-badges 的 Playwright 安装入口等待本轮并行冷安装的缓存锁后失败，尚未执行 badge 用例、后续源码 smoke 或 Webview。日志保留为 `/tmp/dga12/npm-test.log`；这是本机验证顺序冲突，不能外推为 CI 串行预装后的结果。

按串行准备执行的完整 npm test 通过全部前缀及 trusted/restricted smoke，随后旧升级在 `legacy-supervisor-upgrade-tests.cjs:250` 的 Agent resize 一致性等待超时。原输入 marker 已到达，最后 session 为 waiting-input、82×27；期望 probe 尺寸未存入工件，原因未知。定向旧升级首次通过未收口这一风险。后续七组重开/共享/systemd/远端矩阵与最终 Webview 没有被该完整命令触达。独立 Webview 424/424 与一次 fallback 两阶段通过均单独记账。

## 决策记录

2026-10-12：关闭模式断言明确拒绝任何 shared root attach，不删除原共享会话；开启模式保留原 backend/storage/owner/session 的恢复与异步身份检查。root snapshot 夹具按实际模式分辨共享和私有目录。普通关闭的预期按应用模式和下一模式表达，不替代主动模式切换的协调测试。

2026-10-12：checkpoint 等待回调在已收到内容少于声明长度时继续等待，仍严格验证连续 offset、精确总长度和后续 revision。新 root socket 使用 root namespace，仅更换新会话路径，历史会话仍用旧 resolver。

2026-10-12：fallback 重开场景清空 user bus 两个环境变量，fake systemctl 使用成功配置但应完全不被调用；真实 root 后端和两次 VS Code 重开断言保留。启动已经提交后的失败不得触发 fallback，现有 root preparation 负面回归继续执行。

2026-10-12：PR/tag 在固定 ref 的 npm ci 后、完整 verify 前执行本地 Playwright CLI `install --with-deps chromium`，浏览器 cache 设为 checkout 的 `.playwright-browsers`，市场 VS Code E2E 临时目录使用 `/tmp/tm-${{ github.run_id }}`。历史 tag 没有 release verifier 时仍保留既有路径，普通非发布 PR 不下载浏览器。

2026-10-12：保留fallback定向运行的setup通过与verify首败，完整npm test继续按原入口执行，结果分别记账；旧upgrade首次完整通过也不追认上一轮resize原因已解决。

2026-10-12：Chromium冷缓存实际下载持续推进但较慢，完整npm test的早期市场浏览器使用本机同revision已有cache，独立冷安装与冷准备后的浏览器入口另记结果；Webview入口仍采用本工作树cache。重开失败工件补存已有Host诊断事件，不改变ready条件、等待预算或原失败传播。

2026-10-12：保留首次完整命令的缓存锁失败。冷安装成功退出后，使用本工作树同一 cache 原样执行一次完整 npm test，采用新日志 `/tmp/dga12/npm-test-prepared.log` 和新 debug root；这验证 workflow 的先安装后测试顺序，不覆盖首次结果，也不修改或手动删除安装锁。

2026-10-12：完整命令在旧升级 Agent resize 一致性等待退出后，仅补验未触达的完整 Webview 及一次 fallback 两阶段。fallback 直接复用已有当前构建、采用新隔离目录，与 Webview 的浏览器目录不共享；避免并行重建。两者通过，完整门禁失败、resize/ready 首败和未触达范围仍保留，不扩成本轮产品修改。

## 结果与复盘

五组确定的测试/CI 对齐已完成，并有冷浏览器、checkpoint、定向旧升级、fallback 两阶段与纯回归证据；完整门禁仍失败。按串行准备的一次完整命令通过全部前缀和 trusted/restricted 源码 smoke，后续旧升级在原 Agent resize 与捕获 probe 一致性等待20秒超时。独立 Webview 使用新 cache，424/424 通过。首次缓存锁退出与 fallback ready 首败保留；不从有限通过追认根因已修复，也不以独立结果拼接为完整命令通过。

本轮只交付夹具与 CI 准备修复，旧升级 resize 与首次 Canvas ready 原因需要后续专项调查；不提高等待预算、不修改产品保护、不准备 0.26.1 发布材料。前轮 VSIX 安装矩阵未在本轮重跑，不能当成本轮验收。

## 上下文与定向

`scripts/test/test-canvas-execution-context.mjs` 通过打包真实 Manager 和 mock VS Code 验证模式、root 加载与原会话身份。`tests/vscode-smoke/extension-tests.cjs` 的 checkpoint 场景消费 Host 快照和分页；其等待 predicate 首分页即抛断言。`tests/vscode-smoke/legacy-supervisor-upgrade-tests.cjs` 同时连接历史 slot 和现代 root，旧地址不能用于现代新会话。`scripts/smoke/run-vscode-smoke.mjs` 组织两次真实 VS Code 的重开场景，现有 fallback 在 systemd 提交后失败，违反 root 启动准备契约。

两个 workflow 为 `.github/workflows/release-preflight.yml` 与 `.github/workflows/publish-marketplace-release.yml`；对应回归在 `scripts/test/test-release-preflight-workflow.mjs` 和 `scripts/test/test-publish-marketplace-workflow.mjs`。市场浏览器 E2E 直接调用 Chromium，全套 Webview 另使用 checkout 下 `.playwright-browsers`；预装与两个消费者必须共享该目录。

## 工作计划

第一里程碑对齐上述正式夹具，跑单元与 workflow 回归，确认没有变更产品。第二里程碑安装已锁定 Playwright 所需浏览器，并运行 checkpoint、fallback 和 legacy upgrade 原生场景，保留首败工件。第三里程碑运行完整 npm test；若遇新增独立失败，只有与当前夹具修复成立直接相关的改动才纳入，其余登记，禁止扩大等待预算取绿。第四里程碑回收证据、更新技术债和索引、归档本计划，创建修复 PR。

## 具体步骤

工作目录 `/tmp/dscgate1012`；使用 Node 22.23.3，六目标原生资产 `/tmp/dsc-release-026-assets`，VS Code cache `/tmp/dsc0261v/.vscode-test`。各运行日志和工件使用新的独立短目录 `/tmp/dga12`，市场宿主 TMP 使用 `/tmp/gm12`，umask 0077。各准确命令、环境和退出结果随证据登记。

    npm ci
    npm run test:canvas-execution-context
    npm run test:runtime-root-preparation
    node scripts/test/test-runtime-systemd-environment.mjs
    npm run test:release-preflight-workflow
    npm run test:publish-marketplace-workflow
    npm run build
    PLAYWRIGHT_BROWSERS_PATH=/tmp/dscgate1012/.playwright-browsers npx --no-install playwright install --with-deps chromium
    DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=runtime-checkpoint-refresh,systemd-fallback-real-reopen,legacy-supervisor-upgrade npm run test:smoke
    npm test

该预装命令在具备系统安装权限的 CI 环境执行；本机若系统库已齐备，则记录实际冷缓存下载和浏览器启动，不把暖缓存复制写成冷安装通过。旧 upgrade 若再遇 resize 停点，保留请求/probe/执行工件，不反复重跑取绿。

## 验证与验收

关闭模式和开启模式的正反例、原 binding 异步替换保护均通过；完整 checkpoint 保持精确长度与内容断言；fallback 两阶段确认 backend 为 legacy-detached 且没有 systemctl 调用；新 root 旧升级能够经过正确地址验证后续退役。两个 workflow 回归须覆盖 release/non-release 条件、预装顺序及缓存一致性。最终报告如实列出完整 npm test 是否通过及未知 resize 边界；不准备 0.26.1 发布契约，不以本轮代替预合并或 tag verify。

## 幂等性与恢复

所有运行使用新日志/存储目录，测试只清理自身资源，不停止已存在的用户 listener。旧 failure 保留；未确认提交不重试、不换后端。产品缺口须具名记录并另行设计，不修改 unknown 保护。推送和创建 PR 前 fetch/rebase 最新 main，若产品基线变化，则重新确认受影响验证范围。

## 证据与备注

上一轮报告在 PR #320，固定主线首败为 execution-context:708、checkpoint:390、fallback setup、新 root 旧 socket，以及冷缓存 Chromium 缺失；旧升级还保留一次 resize 一致性 20 秒超时和更早 commit lease 24084 端口占用。正式修复规则见 `docs/design-docs/release-gate-fixture-ci-alignment.md`。本轮证据已回收到 `docs/references/release-gate-fixture-ci-alignment/evidence.json` 及相邻失败摘要，含固定基线、测试输入 hash、准确命令/环境、退出结果和日志 hash；没有捕获准确起止时间的早期检查明确注明。原日志/工件保留在 `/tmp/dga12`。

## 接口与依赖

复用现有 npm scripts、fake systemctl 与 Playwright，不新增产品接口、运行时依赖或用户可见流程。

修订记录：2026-10-12，建立修复范围、正式契约、冷缓存验证和首败保留标准；实施并回收冷安装、定向 smoke、两次完整命令、有限 fallback 与独立 Webview 结果。保留完整门禁失败和未触达范围，将 resize/ready 未知原因登记后续调查。
