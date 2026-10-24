---
title: 插件验证与模板市场服务的依赖安装边界
decision_status: 已选定
validation_status: 验证中
domains: [VSCode 集成域]
architecture_layers: [适配与基础设施层]
related_specs: []
related_plans: [docs/exec-plans/active/smoke-dependency-install-scope.md]
updated_at: 2026-10-23
---

# 插件验证与模板市场服务的依赖安装边界

## 背景与证据边界

PR335 head 0d29481a 的根 package.json 和 apps/template-marketplace/package.json 重复声明 Wrangler。锁定链为 Wrangler4.131.1→Miniflare5.20260911.0-alpha/workerd1.20260911.1→平台 workerd；根 npm ci 无差别安装全部 workspace，使插件验证承担市场后端下载。

本地同预合并9d741c68、Node22.23.3/npm10.9.9、全新缓存的一次安装，在 workerd-linux-64@1.20260911.1 下载期间触及600秒上限，含清理605秒退出。原始日志及摘要见 `docs/references/smoke-dependency-install-scope/original-local-attempt/`。原CI39313391100仅记录14秒 ECONNRESET，没有包名/debug日志，不能认定同因。本变更消除无关依赖耦合，不声称修复原CI网络根因。

## 调用关系

- `scripts/gates/run-stage.mjs` 的 source-host/packaged-host/installed-pair 与 `scripts/build/build.mjs`、notifier构建不导入 Wrangler/Miniflare/workerd。
- 两项 marketplace-host 调用 `run-template-marketplace-vscode-e2e.mjs` 和 `run-template-marketplace-vscode-local-preview-e2e.mjs`，均用 `tests/vscode-smoke/template-marketplace-fixture.cjs` 的 Node HTTP 服务；没有启动 Worker。市场浏览器测试使用 Vite 与 Playwright API 拦截。
- `build-browser-assets.mjs` 构建主 Webview 与市场 SPA。SPA 的依赖由根构建工具、插件的 React/fflate、marketplace-shared 组成，不启动 Worker；实际无服务包构建须验证。
- regression 中实际包含市场 workspace 的 typecheck/API/web测试的 shard 安装市场服务 workspace；仅共享包/静态配置测试的 shard 不需要服务安装。Worker API 在 Node Vitest中调用 Hono app和fake D1/R2；这是已有服务覆盖，不假称真实workerd验收。
- `template-marketplace-production-deploy.yml` 与 app 中 worker:dev/deploy/db命令直接调用 Wrangler，保留完整市场安装。
- `build-release-candidate.mjs` 独立 archive checkout再次安装，仅构建插件双包，必须使用插件范围；`run-local.mjs` 按冻结计划所含任务选择整体安装范围。

## 正式方案

1. Wrangler及workers-types仅由现有市场 app声明；移除根重复声明，单一lockfile保留所有市场依赖及原版本/resolved/integrity，不新增锁文件。
2. `scripts/gates/dependency-install.mjs` 定义两个范围：plugin显式选择主插件、notifier、attention-protocol、marketplace-shared并include-workspace-root；marketplace在此基础上增加apps/template-marketplace。都使用npm ci，不omit optional，不ignore-scripts、不改变安装预算。根保留构建/测试工具。
3. 正式 `ci-validation.yml` 从 `planJobs` 的实际task集合派生dependencyProfile：含市场typecheck/API/web的shard使用marketplace，其余使用plugin；两项市场Host和市场浏览器仍按原任务运行。发布的resolve/prepare/channel/finalize/recovery仅用插件工具。正式任务ID、variant、required、依赖图、smoke预算、断言和发布前后完整验收均保持不变。
4. `run-infrastructure.mjs` 的npm ci显式要求profile，回执记录profile和实际args。npm debug写入本次infrastructure目录，由原有界evidence收集器保存；不复制用户npmrc或凭据。候选构建和本地门禁也通过同一参数函数选择安装范围，日志保留在各自已有证据目录。
5. 完整本地计划含市场regression，仍安装全部所需workspace；仅插件诊断不带入市场服务。默认开发者根npm ci继续安装所有workspace，服务部署保留原全量安装。

## 取舍与非目标

使用成熟workspace选择，避免复制依赖manifest、过滤lockfile或构建新的安装器。保留根通用工具而非逐测试裁剪依赖。root的worker类型重复声明同步移除，其所有者为app。不会升级workerd、改optional策略、延长超时、删除市场测试或改变产品行为。历史独立原生/诊断workflow不在这次正式发布门禁改造范围内。

## 验证方法

检查锁内版本/来源/摘要完全不变；插件冷缓存真实安装无workerd请求/安装目录，构建/notifier/主类型/受影响真实smoke及市场浏览器能执行；市场profile安装后原API/web/共享类型测试通过。回归应拒绝未知scope、漏选市场workspace、根重新引入服务依赖，验证CI/本地/candidate的scope一致，安装失败仍有npm debug且保持失败。任务目录与基准353项逐项比较，不以计数代替内容比较。完整新输入CI独立记账。

## 本地验证结果（2026-10-23）

实际plugin冷缓存安装43.469秒通过，602 packages；日志无服务包请求且安装树无其包，optional平台依赖和根postinstall保留。marketplace安装13.272秒通过，639 packages（复用插件缓存，服务包实际下载）。原锁中所有非根package entry逐项相同。主插件/notifier类型与开发/生产构建、双VSIX打包、两类前端生产构建、六项真实Host和市场浏览器通过；市场API99/Web45/共享28和类型、三配置合同通过。完整合同初次121/121，最终matrix范围细化后的受影响9项和安装3项通过；四正式workflow actionlint通过。完整普通PR及release目录各353项逐项不变。

具体命令、原日志压缩包、实现/输出摘要见[依赖范围证据](../references/smoke-dependency-install-scope/README.md)。原生资产与VSCode/浏览器cache复用有明确边界；不宣称最新完整CI/跨平台候选验收或原ECONNRESET根因修复。
