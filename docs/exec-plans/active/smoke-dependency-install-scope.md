# 分离插件 smoke 与模板市场服务的依赖安装

本 ExecPlan 按 `docs/PLANS.md` 持续维护。

## 目标与全局图景

在 PR335 保留全部验证任务，令插件源码/打包/原样安装 smoke 和候选双包构建只安装插件、notifier、共享包及根构建测试工具；Wrangler/Miniflare/workerd 由市场 workspace 拥有。安装范围不能通过省略 optional 平台依赖实现。用户可从冷缓存 npm HTTP 日志确认插件安装未请求 workerd，同时受影响插件与市场测试通过。

## 进度

- [x] (2026-10-23) 核对远端 head 0d29481a、main 6e708c6b，在 `/tmp/dsc335-deps` 建立隔离分支，保留其他工作区。
- [x] (2026-10-23) 核对根及 app 重复 Wrangler 声明、Miniflare/workerd 锁定链、两个 Node HTTP Host 夹具、市场浏览器 API 拦截、候选双包嵌套 npm ci。
- [x] (2026-10-23) workspace选择实际闭包成立；正式设计、共享安装参数及CI/local/candidate接线完成。
- [x] (2026-10-23) 原npm debug原字节压缩留存；plugin冷安装43.469秒无服务请求，marketplace13.272秒通过；构建/双包/六Host/浏览器及市场99/45/28、类型和配置合同通过。
- [x] (2026-10-23) 同步设计与原始日志、验证摘要，核对最终差异及远端未变化。
- [ ] 最新输入完整 Actions 验收；提交、推送及运行终态记录在 PR335，避免仅为记账产生新验收输入。

## 意外与发现

本地原预合并 9d741c68、Node22.23.3/npm10.9.9、全新缓存的一次 npm ci 在 600 秒下载 workerd-linux-64@1.20260911.1 未完成，605 秒含清理后失败；timedOut=true，未出现 ECONNRESET。原 CI39313391100 则14秒 read ECONNRESET，缺包名/debug 日志，不能认定同因。原证据目录 `/tmp/pr335-npm-retry-dh_gey74/evidence` 保留。本任务消除无关依赖耦合，不修复或追认网络根因。

## 决策记录

- 决策：先采用现有 npm workspace 的显式选择与 include-workspace-root，不另建锁文件、不 omit optional、不升级 workerd、不增加期限。
  理由：插件运行依赖已归属插件 workspace，根工具仍供构建/测试使用；市场包本来已声明 Wrangler，只需移除根重复声明并核选择闭包。
  日期/作者：2026-10-23 / Codex。
- 决策：任务清单、source/packaged 场景、市场 service/API/web/Host 验证及 release 模式范围保持，安装范围和验证范围分开。
  理由：缩小下载集合不能变成减少覆盖。
  日期/作者：2026-10-23 / Codex。

## 结果与复盘

实现与本地验收已完成，原锁中非根package entry完全相同；plugin安装树和请求没有服务包，市场测试仍覆盖。完整合同初次121/121，最后matrix范围按实际task派生后的9项/3项定向合同及四workflow actionlint通过。完整353项逐项不变。最新远端CI验收独立记录，原网络根因仍未确认。

## 上下文与定向

修改前 `package.json` 与 `apps/template-marketplace/package.json` 均声明 Wrangler；`package-lock.json` 固定 Wrangler→Miniflare/workerd 及平台包。`scripts/gates/catalog.mjs` 定义完整必跑集合，regression shard 按实际市场类型/API/web调用派生安装范围。`ci-validation.yml` 对各 job 使用根 npm ci，`scripts/gates/run-local.mjs` 的独立 checkout 及 `scripts/release/build-release-candidate.mjs` 的嵌套 checkout 也必须核对。`scripts/gates/evidence.mjs` 已收 infrastructure 目录，可供当前安装 npm debug 日志有界留存。

## 工作计划与里程碑

第一里程碑在现有 manifest/单一 lockfile 中消除根 Wrangler 所有权，验证 workspace 安装闭包，不改变固定版本。第二里程碑在实际 CI、本地门禁、候选双包安装入口使用同一范围定义，并补防回退测试；保留原任务和期限。第三里程碑保存历史原日志，运行插件冷缓存安装，检查 HTTP 请求/实际安装树，进行插件构建、定向真实 smoke、市场 API/web/共享/浏览器测试；发布完整输入由最终 CI 单独验收。

## 具体步骤

工作目录 `/tmp/dsc335-deps`，Node 使用 `/tmp/pr335-npm-retry-dh_gey74/node-v22.23.3-linux-x64/bin`。修改后 `npm install --package-lock-only --ignore-scripts --no-audit --no-fund`，检查锁中版本/resolved/integrity未漂移。执行插件范围 cold npm ci；执行 `npm run test:ci-gates`、typecheck/build/notifier、受影响真实 smoke 和 `npm run test:marketplace` 的受影响组成项。准确命令、结果与局限随进展更新。

## 验证与验收

新插件安装树无 Wrangler/Miniflare/workerd，HTTP 日志无其下载请求，esbuild/rollup 等必要 optional 平台包仍可用。根工具、xterm patch、原生 helper 安装钩子与插件/notifier/shared import 可工作。市场任务仍安装 app 及其服务依赖，原所有任务 ID/variant/required 与预算不变，缺任务继续拒绝验收。定向结果不代替最新完整发布门禁。

## 幂等性与恢复

隔离分支安全承接 PR335，禁止改写其他 worktree 或用户修改。每次冷安装使用新 cache/日志目录，原失败不覆盖；更新 PR 前 fetch/rebase 并核对原远端 head，发生并发更新先整合。

## 证据与备注

原 npm debug 与过程回执已留存在 `docs/references/smoke-dependency-install-scope/`，保存原字节摘要和本地输入边界；完整日志不包含 npm 用户配置或凭据。新的验证摘要不能覆盖历史故障。

## 接口与依赖

沿用 npm workspace、单一 package-lock、现有 runProcess 绝对期限与清理合同，不新增产品运行时 API。scope 定义应被 CI、本地门禁及嵌套构建共用并有实际安装验证。

修订记录：2026-10-23 启动依赖安装范围调整，明确历史证据及完整验证不变。

追加决策（2026-10-23）：`planJobs`按每个shard的实际typecheck:marketplace/test:marketplace-api/test:marketplace-web调用派生dependencyProfile；仅共享包/配置检查的shard使用plugin。这样不更改任务分组、预算或覆盖，也不让共享测试承担服务下载。两项外层verifier的always工件补收infrastructure日志。

验证详见 `docs/references/smoke-dependency-install-scope/README.md`；正式方案 `docs/design-docs/smoke-dependency-install-scope.md`。本地六native资产复用旧dist、VSCode1.142.0与Chromium1217复用cache，不能代替新输入原生及完整发布验收。

修订记录：2026-10-23 完成实现、冷安装和受影响验收，保留原始失败、工作树输入摘要及最新CI独立边界。
