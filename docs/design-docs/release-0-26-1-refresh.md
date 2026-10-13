---
title: 从最新主线重新准备 0.26.1
decision_status: 已选定
validation_status: 验证中
domains: [执行编排域, VSCode 集成域, 项目状态域]
architecture_layers: [宿主集成层, 适配与基础设施层]
related_specs: [docs/product-specs/runtime-persistence-modes.md]
related_plans: [docs/exec-plans/active/release-0-26-1-refresh.md]
updated_at: 2026-10-13
---

# 从最新主线重新准备 0.26.1

## 背景与取舍

用户舍弃 PR #313 并要求从最新 origin/main 重新准备 0.26.1。2026-10-13 fetch 后基线为 ea0c9b194fda1f13098cfd7ad4a3e13c4ec5233b，包含 PR #314/#316/#319 以及#321/#323/#324/#325。旧候选遗漏后续能力且记录过期失败，不予 rebase 或复用；另开 release-0-26-1-refresh。

主线评估 PR #326 仍未合并，不作为发布基线。本分支只按主线已有证据修正共享设计与产品规格中“接管尚未实现”的旧描述，保留有限验收边界；不合入该 PR 全部报告，也不将它的测试当成本版完整验证。v0.26.0 已于 2026-10-08 发布，README/手册的上一已发布版本同步更正。

## 正式方案

根与双扩展 manifest、lock 同步为 0.26.1；双 CHANGELOG、中英文 listing/README、两份手册、support 和 docs/release-contracts/v0.26.1.md 构成静态发布输入。内容覆盖主线已完成的执行可靠性和共享 root 画布，不新增产品实现、设置、依赖或模板市场生产部署。共享/私有模式、最后窗口清理接管和普通关闭保留语义按 runtime-shared-root-canvas-sync.md 与 runtime-persistence-modes.md 表达；执行修复以 smoke-reload-autostart-investigation.md 和 terminal-mouse-input-diagnostics.md 为依据。

scripts/release/release-preflight.mjs::runFullVerification 对本版运行标准完整 npm test 及 HEAD 的 clean-checkout VSIX 验证，不能继承 0.26.0 授权例外。先提交静态输入，再用最新 head 和 origin/main 构造临时预合并 commit，在独立工作树安装和验证。验证后若只增加过程/证据文档，核对产品、测试与静态发布输入完全相同并注明实际 commit；线上最新 PR 预合并结果仍必须完整验证。合并与 publish tag 需另行授权，最终 tag 须再次 verify。

Linux x64 验证使用 Node22.23.3、VS Code1.141.0、fake Agent 与原生 PTY，六目标资产复用须通过默认 build 的源/依赖/二进制 hash 校验。暖 Chromium 缓存先按 workflow 准备，不称为冷 OS。默认 npm 安装、不设场景 filter、不更改原断言、截图或重试。命令保存 UTC 时间、真实 exit 与日志 hash；失败后独立对照不能追认为首轮或聚合通过。

## 验证状态

静态输入正在同步，预合并完整验证尚未执行。待结果取得后在本节与 docs/references/release-0-26-1-refresh/evidence.json 记录实际输入和结果，不向 CHANGELOG/契约写入候选 commit、测试状态或工件事实。

此前主线默认独立 npm ci 曾在 Wrangler/esbuild 自校验报告 ETXTBSY；只加 npm_config_foreground_scripts=true 的新一次验证通过，具体写者未确认。本版先运行默认安装，保留可能复现的首败；不能跳过脚本或将前台对照作为自动豁免。

## 剩余边界与发布门槛

上游连续重开 Webview 资源积压、单次 fallback ready 首败未定因，以及普通 Canvas 持续启动失败缺少超时反馈/自动重建，按 webview-ready-root-cause.md 和 smoke-reopen-ready-timeout.md 保留。45 秒只属于 smoke 预算，既有输入/resize/身份验收不放宽。

共享画布真实 UI 限 Linux 单 root，分阶段接管有受控 Host/store 与独立 Supervisor 证据；其他平台、真实 provider、多 root 接管 UI、公开市场自动安装依赖和桌面点击均不由本机 fixture 通过自动扩展。Supervisor/机器故障及跨版本回退无保证。

完成准备需要静态检查和完整本地 verify 的实际结果、notifier 补充验证、最新主线祖先关系与可 review PR。完整 verify 失败时标为草稿阻塞；required CI/review 仍须成功，发布只能在合并后的 main 另行执行。
