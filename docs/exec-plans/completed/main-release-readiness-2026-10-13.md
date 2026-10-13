# 验证最新主线的 0.26.1 发布前状态

本 ExecPlan 按 `docs/PLANS.md` 持续维护，记录验证推进、决策、首次失败与未覆盖范围。

## 目标与全局图景

用户已舍弃旧发布准备 PR #313，要求从最新 `origin/main` 判断 0.26.1 发布前是否还有卡点。本轮固定 `ea0c9b194fda1f13098cfd7ad4a3e13c4ec5233b`，验证用户打开画布、执行与窗口重开等现有路径，并交付可追踪的主线报告。旧发布分支的失败清单不直接当成当前缺陷；本轮不修改版本或创建发布 tag。

## 进度

- [x] 2026-10-13：fetch 确认最新 main，创建独立工作树 `/tmp/dscmainv1013` 和主题分支 `docs-main-release-readiness-2026-10-13`。
- [x] 2026-10-13：独立 npm ci、匹配资产配置、串行 Chromium 系统依赖准备及两组发布门禁脚本回归通过；完整 npm test 已启动。
- [x] 2026-10-13 02:38Z：完整 npm test exit 0，源码 smoke 全部结束、Webview 426/426；全程未重试或修改断言。
- [x] 2026-10-13：默认 clean-checkout npm ci 的 ETXTBSY 首败保留；新独立目录使用 foreground-scripts 后完整 VSIX 八场景通过，notifier companion/locale、Host634、root/startup 通过。
- [x] 2026-10-13：形成正式报告并回收14条命令证据，补齐C8来源及共享接管文案；相关索引/技术债同步，文档和hash核对后提交。

## 意外与发现

npm ci 安装 639 个包并报告 19 项全依赖 audit 告警，未自动升级依赖。浏览器前置 exit 0，系统包 0 新装/5 升级；部分无关 apt 源 TLS 拉取失败后沿用已有索引。这是具备系统库及暖浏览器缓存的本机验证，不代表全新 OS 冷安装。

首次 clean-checkout 在 npm ci 的 Wrangler/esbuild 安装脚本中执行二进制校验时发生 spawnSync ETXTBSY，尚未打包或安装 smoke。原 stderr/npm 日志保留；npm 回滚删除了安装目录，不能补造失败时写者或 inode 证据。新独立 clean-checkout 只增加 npm_config_foreground_scripts=true，使生命周期脚本按 npm 默认 foreground 并发 1 执行，源码/依赖/断言不改；复验结果另记。

main 当前版本为 0.26.0，`release:verify --version 0.26.0` 有历史版本精确例外，会跳过完整测试。本轮直接执行标准验证的组成命令；这些结果不能称为 0.26.1 预合并或最终发布 ref 的 verify。所有产品、测试、版本和依赖输入与固定 main 相同，仅文档和证据改变。

## 决策记录

2026-10-13：只从当前 main 验证，不复用 #313 的静态输入或失败结论。理由是 #314、#316、#319、#321、#323、#324、#325 已改变相应实现或测试前提，旧记录仅保留为历史证据。

2026-10-13：宿主和浏览器完整验证串行执行，先准备 Chromium，再运行消费者。理由是上一轮并行安装曾干扰浏览器缓存；本轮使用独立存储、短 TMP 和 umask 0077，不修改产品权限保护或测试断言。

2026-10-13：对首次安装 ETXTBSY 使用新的独立 clean-checkout 与 foreground-scripts 环境做一次受控复验。理由是失败发生在安装自校验，先改变 npm 生命周期并发，不绕过脚本或替换二进制；即使通过也不追认具体写者或原失败消失。

## 结果与复盘

环境和前置回归已完成，完整 npm test 的纯测试/浏览器前缀及本地前七场景、checkpoint、trusted 均通过；restricted、旧升级 resize、新旧身份与退役、普通/多根/单根切多根重开、双窗口共享、systemd/fallback 两阶段也通过；localhost SSH 两阶段也已通过，源码 smoke 全部结束，最后 Webview 426/426 通过，完整 npm test 在 02:38Z exit 0；默认 clean-checkout 在 npm ci 的 esbuild 自校验 ETXTBSY 首败；新独立目录只加 foreground-scripts 后从安装到八组 VSIX smoke exit 0。notifier companion、en/zh-cn locale、Host634及root/startup补验均通过。原 resize、ready 首败及上游资源积压边界继续保留；新通过不能追认历史失败已修复。

## 上下文与定向

根 `package.json` 的 `test` 串行执行类型、纯测试、市场宿主、源码 smoke 和 Webview 全套。`scripts/smoke/run-vscode-smoke.mjs` 使用隔离 VS Code profile 与 fake Agent，包含本地执行、checkpoint、旧升级、窗口/共享/systemd/localhost SSH 重开；不代表真实 provider 或远端长断开。`scripts/release/run-clean-checkout-vsix-validation.mjs` 从固定 git ref 导出干净源码，独立 npm ci、打包和安装 smoke。`scripts/release/release-preflight.mjs::runFullVerification` 对 0.26.1 要求这两条完整组成路径。

## 工作计划与里程碑

第一里程碑准备独立依赖和匹配原生资产，串行核验 Chromium 前置，完成后可原样启动正式测试。第二里程碑运行完整 npm test 和固定 ref 的 clean-checkout，首败立即保留，不通过重试或放宽预算取绿；一个聚合命令失败后，独立验证允许另记，但不能拼成该命令通过。第三里程碑已把命令、时间、退出码、hash 和验证边界写入 `docs/references/main-release-readiness-2026-10-13/`，新增正式设计报告并同步索引、技术债；确实属于已完成工作的过时描述可修正，产品新缺陷先具名登记。

## 具体步骤

工作目录 `/tmp/dscmainv1013`，运行日志 `/tmp/dmr13`。Node 位于 `/tmp/dsc-release-node22/node_modules/node/bin`；资产 `/tmp/dsc-release-026-assets` 由正式 build 核验源码及二进制 hash。VS Code cache `/tmp/dsc0261v/.vscode-test`，版本 1.141.0。浏览器使用现有 revision 1217 cache，明确记为暖缓存，不外推全新 OS 缺库安装。

    npm ci
    npx --no-install playwright install --with-deps chromium
    npm run test:release-preflight
    npm run test:release-preflight-workflow
    npm test
    npm run validate:clean-checkout:vsix -- --ref ea0c9b194fda1f13098cfd7ad4a3e13c4ec5233b --keep-temp

默认clean首败后，新目录以 npm_config_foreground_scripts=true 执行相同 clean 命令；该次独立通过，不覆盖首败。原日志在 /tmp/dmr13，14条命令记录与固定输入、工件hash回收至 docs/references/main-release-readiness-2026-10-13/。

另按实际已覆盖范围执行 root ownership/preparation/旧协议和 notifier typecheck/source/companion/locale；若完整 npm test 未到 Webview，全套 Webview 另记运行。命令通过 Python subprocess 包装保留真实退出码、UTC 起止时间和日志 SHA256，环境只使用隔离 fixture 与上述明确输入。

## 验证与验收

验收结果是每条完整命令有可复核的通过或失败，报告明确失败位置、既有断言与未触达范围；没有把定向通过合成为完整门禁。生成证据 JSON 可解析、日志 hash 与源代码固定输入一致；相关文档链接有效，索引/frontmatter 状态一致，`git diff --check` 通过。最终 main 若在交付前变化，报告仍明确本次固定输入，受影响验证不能外推。

## 幂等性与恢复

运行目录均为新建隔离目录；不停止不属于本轮的进程或 listener，不删除旧首败工件。失败保留现场，不自动重启 Supervisor 或重发未知操作。重做检查需新日志记录；只有新变化或独立定位需要才能重跑。clean-checkout 使用 `--keep-temp` 保留打包与安装证据。

## 接口与依赖

复用正式 npm scripts、已锁定 Playwright、Node 22、VS Code 1.141.0 与匹配的原生分发资产；不新增产品接口、用户设置或依赖。

修订记录：2026-10-13，建立最新 main 验证范围、隔离前置与证据规范，明确不沿用旧发布 PR 的结论。

修订记录：2026-10-13，记录已到达的 checkpoint/trusted 通过范围，保留未结束聚合命令的状态。

修订记录：2026-10-13 完成完整 npm test、默认安装首败与独立串行安装 VSIX 复验、notifier 和受控 Host/root 补验；报告保留验证失败状态及发布前复验要求，计划归档。
