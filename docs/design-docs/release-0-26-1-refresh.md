---
title: 从最新主线重新准备 0.26.1
decision_status: 已选定
validation_status: 验证失败
domains: [执行编排域, VSCode 集成域, 项目状态域]
architecture_layers: [宿主集成层, 适配与基础设施层]
related_specs: [docs/product-specs/runtime-persistence-modes.md]
related_plans: [docs/exec-plans/completed/release-0-26-1-refresh.md]
updated_at: 2026-10-13
---

# 从最新主线重新准备 0.26.1

## 背景与取舍

用户舍弃 PR #313 并要求从最新 origin/main 重新准备 0.26.1。2026-10-13 fetch 后基线为 ea0c9b194fda1f13098cfd7ad4a3e13c4ec5233b，包含 PR #314/#316/#319 以及#321/#323/#324/#325。旧候选遗漏后续能力且记录过期失败，不予 rebase 或复用；另开 release-0-26-1-refresh。

主线评估 PR #326 仍未合并，不作为发布基线。本分支只按主线已有证据修正共享设计与产品规格中“接管尚未实现”的旧描述，保留有限验收边界；不合入该 PR 全部报告，也不将它的测试当成本版完整验证。v0.26.0 已于 2026-10-08 发布，README/手册的上一已发布版本同步更正。

## 正式方案

根与双扩展 manifest、lock 同步为 0.26.1；双 CHANGELOG、中英文 listing/README、两份手册、support 和 docs/release-contracts/v0.26.1.md 构成静态发布输入。内容覆盖主线已完成的执行可靠性和共享 root 画布，不新增产品实现、设置、依赖或模板市场生产部署。共享/私有模式、最后窗口清理接管和普通关闭保留语义按 runtime-shared-root-canvas-sync.md 与 runtime-persistence-modes.md 表达；执行修复以 smoke-reload-autostart-investigation.md 和 terminal-mouse-input-diagnostics.md 为依据。

scripts/release/release-preflight.mjs::runFullVerification 对本版运行标准完整 npm test 及 HEAD 的 clean-checkout VSIX 验证，不能继承 0.26.0 授权例外。先提交静态输入，再用最新 head 和 origin/main 构造临时预合并 commit，在独立工作树安装和验证。验证后若只增加过程/证据文档，核对产品、测试、版本与用户发布输入相同，单独记录手册过程链接变化并注明实际 commit；线上最新 PR 预合并结果仍必须完整验证。合并与 publish tag 需另行授权，最终 tag 须再次 verify。

Linux x64 验证使用 Node22.23.3、VS Code1.141.0、fake Agent 与原生 PTY，六目标资产复用须通过默认 build 的源/依赖/二进制 hash 校验。暖 Chromium 缓存先按 workflow 准备，不称为冷 OS。默认 npm 安装、不设场景 filter、不更改原断言、截图或重试。命令保存 UTC 时间、真实 exit 与日志 hash；失败后独立对照不能追认为首轮或聚合通过。

## 验证状态

已提交准备 head `e123d1e73214fc0f79fc0bba508447331d3f7b49`，基准为 `ea0c9b194fda1f13098cfd7ad4a3e13c4ec5233b`；验证的临时预合并 commit 为 `eba53a28074cbcc49958f7845ebe5b04411a531a`。基准是准备 head 的祖先，合并树等于该 head tree；旧 Git 不支持 merge-tree --write-tree，采用 commit-tree 明确指定两个父提交。

默认依赖安装、浏览器前置、预合并 preflight、notifier typecheck 和独立 notifier VSIX 打包均 exit0。完整 `release:verify` 从 03:05:07Z 至 03:22:32Z，exit1，停在完整 npm test 的 localhost SSH real-reopen；后续 Webview 和 clean-checkout 没有由该聚合命令运行。独立补充这些项的结果另记，不能拼接追认为聚合通过。

首败前 Marketplace 浏览器/真实宿主、纯逻辑回归、七项本地 smoke、checkpoint、trusted/restricted、旧 Supervisor 升级（含 resize）、普通/多 root/单转多 root 重开、共享双窗口、受控 systemd/fallback 均通过。失败时 editor generation5 已 ready/bootstrapAck；Agent 与普通 Terminal 用原会话重新附着并收到预期正文，仅第三个用于检查离线完成的 Terminal 仍为 live、原 sessionId 尚在，最终退出条件未满足。`tests/vscode-smoke/real-reopen-tests.cjs:148` 的命令等待 setup Host 的 `process.pid` 不再存在后才输出终态并 exit，本次等待 PID2613433。

原 remoteexthost.log 显示 setup Host 于 03:21:40 完成 flush 后，在 03:21:50 仍处理共享 TreeView refresh；verify 新 Host PID2632892 于 03:21:48 启动。remoteagent.log 设置重连宽限 10800000ms（三小时），setup Host 没有退出记录，旧 management 连接于 03:22:10 断开仍明确保留三小时。现有 fixture 把窗口关闭等同远端 Host PID 消失的前提在此不成立。首败超时瞬间未采集原 PID 的进程状态，不排除 zombie/PID 复用，也不把日志缺少退出单独写为所有时刻存活。原失配与进程/重连证据见 `docs/references/release-0-26-1-refresh/remote-first-failure.json`。此前同主线通过样本 `/tmp/dmr13` 明确收到 renderer terminate，于 02:26:03Z 退出 setup Host，再启动 verify；本次没有同样的关闭消息/退出边界。该对照说明窗口退出结果有差异，不能仅以配置三小时宽限反推所有重开必失败。为什么本次 terminate 未到达仍未确认。

这次失败不能归为 resize、ready 或已结束历史丢失的确定产品根因；普通打开保持空白的既有边界仍独立保留。

独立 Webview 从 03:23:54Z 至 03:35:56Z，exit0，426/426 通过（12.0 分钟），没有重试、改断言或更新截图。独立 clean-checkout 从 03:35:56Z 至 03:42:06Z，exit0：新目录 `/tmp/dev-session-canvas-clean-checkout-bOm8xh/repo` 的默认 npm ci、140 文件主 VSIX 及全部八个安装场景（含完整 trusted）通过，ETXTBSY 未重现；没有设置 foreground_scripts、场景过滤或跳过 smoke。notifier companion 及 en/zh-cn locale 随后均 exit0。

此前主线默认独立 npm ci 曾在 Wrangler/esbuild 自校验报告 ETXTBSY；只加 npm_config_foreground_scripts=true 的新一次验证通过，具体写者未确认。本版两次工作树和一次独立 checkout 的默认安装均通过，不代表原具体写者已确认或原首败被修复；不能跳过脚本或将前台对照作为自动豁免。

## 剩余边界与发布门槛

上游连续重开 Webview 资源积压、单次 fallback ready 首败未定因，以及普通 Canvas 持续启动失败缺少超时反馈/自动重建，按 webview-ready-root-cause.md 和 smoke-reopen-ready-timeout.md 保留。45 秒只属于 smoke 预算，既有输入/resize/身份验收不放宽。

共享画布真实 UI 限 Linux 单 root，分阶段接管有受控 Host/store 与独立 Supervisor 证据；其他平台、真实 provider、多 root 接管 UI、公开市场自动安装依赖和桌面点击均不由本机 fixture 通过自动扩展。Supervisor/机器故障及跨版本回退无保证。

完成准备需要静态检查和完整本地 verify 的实际结果、notifier 补充验证、最新主线祖先关系与可 review PR。完整 verify 失败时标为草稿阻塞；required CI/review 仍须成功，发布只能在合并后的 main 另行执行。

## 证据与交付状态

证据入口 `docs/references/release-0-26-1-refresh/evidence.json` 固定 12 条命令的 UTC 起止、环境、exit 与日志 hash。`inputs.json` 记录 613 个产品/测试/静态发布输入；后续只修改过程与证据文档，逐文件核对产品/版本/CHANGELOG/契约/listing/测试输入相同；public 手册只有计划路径从 active 改为 completed。该单一过程链接差异和其余 612 个输入一致由 post-validation-input-comparison.json 记录，不声称最终新 head 通过完整 verify。`remote-first-failure.json` 保留失配、原身份、日志片段和此前同主线关闭成功的对照。六目标资产、原生输入、打包文件、语言/依赖和手动文案核对另有具名记录。

本地主 VSIX 为 6000207 bytes、140 文件；notifier 为 160414 bytes、14 文件，均保留 0.26.1、Preview、安装依赖和中文资源。它们仅为准备验证包，hash 见相应 artifact JSON，不是正式 Release 资产。完整原日志在/tmp/d261r，首败工件和隔离 checkout 保留；自己创建的浏览器 cache 链接在测试结束后移除，不删除共享缓存。

最终再次 fetch 确认 origin/main 仍为 ea0c9b19，准备分支保留其祖先关系。交付为新草稿发布准备 PR：静态输入已完成，独立 Webview/安装包/notifier 均通过，但完整 verify 的 SSH 首败仍阻断。后续应单独修复或确认远端关闭前提，再在最新 PR 预合并结果重跑完整 release:verify；未通过不得合并/发布。没有操作 PR #326、目标分支或任何 release tag。
