---
title: 最新主线的 0.26.1 发布前验证
decision_status: 已选定
validation_status: 验证失败
domains: [执行编排域, VSCode 集成域, 项目状态域]
architecture_layers: [宿主集成层, 适配与基础设施层]
related_specs: [docs/product-specs/runtime-persistence-modes.md]
related_plans: [docs/exec-plans/completed/main-release-readiness-2026-10-13.md]
updated_at: 2026-10-13
---

# 最新主线的 0.26.1 发布前验证

## 背景与范围

用户舍弃旧发布准备 PR #313，要求从最新 `origin/main` 判断发布 0.26.1 前的剩余卡点。本轮 fetch 后固定主线 `ea0c9b194fda1f13098cfd7ad4a3e13c4ec5233b`，即 PR #325 的合并提交。旧发布准备的静态输入和旧失败清单不作为本轮当前结论；原始失败和具名修复证据继续保留。

## 正式方案

主线仍为 0.26.0；`scripts/release/release-preflight.mjs::runFullVerification` 对这个精确版本有用户授权的历史例外。本轮直接执行标准门禁的组成命令：两组 release 脚本回归、完整 `npm test`、固定主线的 clean-checkout VSIX 打包和安装 smoke。后者由 `scripts/release/run-clean-checkout-vsix-validation.mjs` 从 git ref 导出源码并独立 npm ci。不能以 0.26.0 例外、定向通过或跨次拼接代证 0.26.1 完整验证。

隔离工作树 `/tmp/dscmainv1013` 使用 Node 22.23.3、Linux x64、VS Code 1.141.0、fake Agent 和正常原生执行分发。六目标资产 `/tmp/dsc-release-026-assets` 由默认 build 校验原生源码、依赖和二进制 hash；当前执行只覆盖 Linux x64。串行运行前安装锁定依赖并执行 workflow 相同的 Chromium 系统依赖准备命令，使用暖 revision 1217 cache；真实市场安装、真实 provider、远端长断开和其他平台不由本机 fixture 代证。

每条命令记录 UTC 起止时间、真实退出码和原日志 SHA256，聚合命令失败后保留原结果与未到达范围。额外独立验证另记，不拼接成原聚合命令通过。原 resize 20 秒、当前真实重开 smoke ready 最大45秒、身份/正文/输入/清理断言和产品权限边界全部保持。

## 当前结果

独立 npm ci、浏览器前置及两组发布门禁脚本回归通过。完整 `npm test` 从 02:09:43Z 至 02:38:11Z，exit 0；全部默认源码场景通过，包括 checkpoint、旧升级 resize 和新旧会话退役、普通/多根/单根切多根、双窗口共享、systemd/fallback 与 localhost SSH。fallback 没有提交 systemctl。最终 Webview 426/426 通过（11.8 分钟），没有重试用例、改快照或放宽断言。首次固定 ref clean-checkout 在独立 npm ci 的 Wrangler/esbuild 安装自校验中发生 `spawnSync .../bin/esbuild ETXTBSY`，exit 1，尚未打包或运行安装 smoke。stderr 和 npm 日志保留；npm 回滚已移除该依赖目录，具体并发写者没有证据，不能声称 esbuild 或产品根因已定位。新的独立 clean-checkout 只增加 `npm_config_foreground_scripts=true`，按 npm 前台生命周期脚本并发 1 执行；不跳过脚本、不改源码/依赖/断言。该次 02:42:07Z 至 02:48:29Z exit 0，独立 npm ci、140-file 主 VSIX 打包及八组安装 smoke 全部通过（含完整 trusted）。默认安装首败依然成立，受控通过不能追认具体写者或根因已修复。

独立补充的 root ownership/preparation、startup profile/reader、Host wiring 634/634 和 notifier typecheck 已通过；Host wiring 明确为受控 non-native 接线，不代证完整原生跨平台矩阵。notifier source 在完整 npm test 中通过；独立 companion、en/zh-cn locale smoke 均 exit 0。

系统依赖准备 0 新装/5 升级，部分无关 apt 源 TLS 请求失败后沿用已有索引，命令最终 exit 0；本机不是全新 OS 冷环境。npm ci 的 19 项全依赖 audit 告警继续保留，未自动修改依赖。

主 VSIX 的版本是当前 main 的 0.26.0，5,999,061 bytes、140 files，保留 Preview、主扩展 extensionPack、中文 NLS/l10n 和正式 platform 配置。它只是本轮验证包，不是 0.26.1 Release asset；包 hash 见本轮证据。notifier 安装关系的静态 manifest 已核对，真实市场自动补齐仍需实际渠道复核。

本报告的验证状态保留“验证失败”，表示未经改动的首次 clean-checkout 命令 exit 1；不因此把后续完整通过写成默认首轮通过，也不将安装自校验失败当成已确认产品缺陷。

## 发布输入与文档边界

本轮只交付主线验证与文档一致性，不创建 0.26.1 静态发布输入。验证结束后，版本、双 CHANGELOG、listing、手册与 `docs/release-contracts/v0.26.1.md` 仍须从最终 main 单独准备，发布准备 PR 预合并和最终 tag ref 的 verify 仍是必要门槛。

PR #319 已实现分阶段接管并有有限证据。本轮已按入库证据修正共享画布设计开头和产品规格中的“尚未实现”旧描述，保留四阶段 UI 暂停和跨平台未覆盖范围。旧升级完成计划引用的 PR #322 C8 样本补为逐字节本地副本及来源 hash；不合入整个调查分支，也不把它当作当前运行。

上游 VS Code 连续重开的资源积压、原单次 fallback ready 首败未定因，以及普通 Canvas 打开没有上述 ready 截止/启动超时反馈，继续按 `webview-ready-root-cause.md` 和 `smoke-reopen-ready-timeout.md` 保留。45 秒只改变 smoke 容忍预算，不是产品恢复机制。

## 验证证据与剩余卡点

证据入口为 [evidence.json](../references/main-release-readiness-2026-10-13/evidence.json)：14 条完整命令的环境、UTC 起止时间、退出码和日志 SHA256。`inputs.json` 固定 596 个产品/测试/发布输入，`native-build-inputs.json` 固定资产与构建 hash；完整 npm test 摘录、首次安装 stderr、原 npm 日志 hash、受控 VSIX/locale/companion 标记与原工件 inventory 均保留。原日志/工件在 `/tmp/dmr13` 和两份具名 clean-checkout 目录，不上传原始用户存储或凭据。

目前没有本轮确认的必须先改产品代码的缺陷。发布前仍须准备 0.26.1 静态输入、完成 release PR 的 review/预合并完整 verify，并在最终 tag ref 再次 verify；这些不能由当前 0.26.0 固定主线样本代证。默认 npm ci 的一次 ETXTBSY 是安装可靠性风险：当前临时处理只用于独立验证，未修改 workflow。下一次正式 CI 若重现，应采集安装生命周期并发与文件写者，明确是否需要在 PR/tag 两条链路同步串行安装；不能跳过 install script 或用受控通过自动豁免门禁。

其他平台、真实 provider、真实多 root 四阶段 UI 接管、公开市场自动安装依赖和桌面点击的有限边界按具名原证据与发布手册表达；它们不由本轮 Linux/fake/localhost 通过自动扩展。上游资源责任和原单次 ready 未定因保持独立跟踪。


## 集中收口后的历史边界（2026-10-13）

本报告按原固定输入和完成时点保留，不作为最新main或0.26.1当前门禁结果。后续已有独立resize/ready/SSH修复合入，剩余probe及fallback路径夹具、回归、WORKFLOW和全部关联根因证据集中PR329；PR327发布输入独立。当前完整组合结果见systemd-smoke-scope-root-cause.md和repair-combined-input.json，不能由本报告的局部或历史通过代证。
