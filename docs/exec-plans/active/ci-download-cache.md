# 统一并复用 CI 工具下载缓存

按docs/PLANS.md维护。本计划只处理用户明确授权的前三项缓存修复，保持下载重试实现不变。

## 目标与全局图景

使同一个job的Chromium准备与测试共用目录，并让正式CI可以恢复npm、固定VSCode和Chromium下载缓存。观察Actions日志可区分首次下载、精确缓存命中和实际测试结果，缓存不签发验收。

## 进度

- [x] (2026-10-23) 只读确认重复下载日志、缺少持久缓存以及前三项授权范围。
- [x] (2026-10-23) 记录正式方案和缓存边界。
- [x] (2026-10-23) 统一Playwright环境变量路径，接入四个正式workflow的npm缓存与验证job工具缓存。
- [x] (2026-10-23) 静态复核实际差异和本会话文件边界；保留主会话字体改动。
- [ ] 新输入Actions的缓存命中和完整验收。

## 意外与发现

run39920907930的Webview功能日志明确出现两套相同revision浏览器，目录分别为RUNNER_TEMP/dsc-gate下及仓库.playwright-browsers。共享helper覆盖了workflow环境变量。notifier-locale仅记录VSCode下载attempt1后因未处理ECONNRESET退出，此异常恢复问题不在本轮范围。

## 决策记录

2026-10-23选用精确actions/cache键和setup-node缓存，不引入新的资源生产任务，避免本次扩大门禁DAG。完整lock摘要较保守但可阻止版本漂移；VSCode额外包含catalog摘要。缓存首次缺失仍会下载，不能描述成完全离线CI。

## 上下文与定向

工作区/tmp/dsc335-deps已有主会话字体修复，禁止覆盖或整批暂存。共享helper在scripts/shared/playwright-environment.mjs。scripts/gates/setup-environment.mjs负责runner私有工具目录；去掉路径中的run-id使actions/cache路径版本稳定，托管runner仍相互隔离；ci-validation.yml在目录设置后恢复工具缓存。release-preflight.yml、release-validation.yml、publish-marketplace-release.yml只需恢复npm缓存。

## 工作计划与里程碑

第一里程碑让helper尊重已有PLAYWRIGHT_BROWSERS_PATH，默认行为及特殊值0保留。第二里程碑接入npm缓存和八类浏览器job/四类Host job的精确工具缓存，不改变task配置。第三里程碑先静态复核差异，随后按用户验证请求运行内存定向检查，实际缓存命中及完整验收仍需正式CI。

## 具体步骤与验证

在/tmp/dsc335-deps检查git diff，确保缓存改动不混入字体文件。使用git diff --check检查空白；人工核对缓存步骤在setup-environment之后、安装/启动之前，锁文件/OS/架构/版本输入都进入键。未来CI完整运行应保留全部任务，命中时无第二目录下载；未命中仍能走既有安装路径。

## 幂等性与恢复

精确缓存可重复恢复到各job私有目录。使用缓存规则版本v1，资源格式变化时递增。撤销本次workflow和helper差异即可回到原准备方式，不更改锁文件或生产源码。

## 结果与复盘

前三项本地实现完成，YAML解析及git diff --check通过。Node22.23.3的内存定向检查通过四种浏览器路径、跨run/attempt路径稳定性、21处npm/8类Chromium/4类VSCode缓存接线及原workflow结构保持，下载重试源码未变。环境输出探针首次用/dev/stdout遇到ENXIO，改为内存捕获后通过；没有执行实际工具下载或完整产品测试。用户随后明确要求先提交，因此仅提交本轮缓存修复及文档，保留字体改动未暂存；不推送，新输入Actions仍待执行。缓存不能保证消除外部服务故障；下载重试异常属于用户明确留待后续的问题。

## 接口与依赖

沿用actions/setup-node@v4、actions/cache@v4、PLAYWRIGHT_BROWSERS_PATH和DEV_SESSION_CANVAS_VSCODE_TEST_CACHE_PATH。不增加npm依赖，不修改scripts/smoke/download-vscode.mjs。

修订记录：2026-10-23按侧会话授权启动前三项修复，主会话字体工作单独保留。

修订记录：2026-10-23完成路径和四workflow缓存接线，保持任务目录与下载重试源码不变，实际缓存命中仍待CI。

修订记录：2026-10-23补记用户请求的定向检查及其探针失败/修正边界，按授权准备独立本地提交。
