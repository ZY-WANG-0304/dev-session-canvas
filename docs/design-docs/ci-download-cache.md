---
title: CI 下载缓存与浏览器路径统一
decision_status: 已选定
validation_status: 验证中
domains: [VSCode 集成域]
architecture_layers: [适配与基础设施层]
related_specs: []
related_plans: [docs/exec-plans/active/ci-download-cache.md]
updated_at: 2026-10-23
---

# CI 下载缓存与浏览器路径统一

## 背景

PR335 d6646b38 的 CI39920907930 执行265次 locked npm安装、252次 Chromium安装及3次regression浏览器准备。新workflow没有npm持久缓存，工具缓存仅为每个job私有目录。Webview功能job日志显示Chromium1217、FFmpeg1011和Headless Shell1217先下载到RUNNER_TEMP，随后又下载到仓库.playwright-browsers。

用户授权修复路径统一、npm缓存和固定工具缓存三项；VSCode下载异常未被三次恢复流程捕获的问题留待后续，本次不改download-vscode.mjs。

## 正式方案

`scripts/shared/playwright-environment.mjs` 优先解析现有PLAYWRIGHT_BROWSERS_PATH为绝对目录，未配置时保持仓库.playwright-browsers。保留Playwright支持的特殊值0（包内浏览器目录）。私有用户目录、临时目录和测试隔离继续存在，浏览器安装与实际启动共用同一位置。

四个正式workflow的安装job通过actions/setup-node的cache: npm及根package-lock.json恢复npm下载缓存，继续原npm ci、workspace范围、optional依赖与安装钩子；不缓存node_modules，不将缓存当作安装验收。

scripts/gates/setup-environment.mjs将工具目录固定为RUNNER_TEMP/dsc-gate-tools下的两个子目录，避免run-id进入actions/cache的路径版本而导致跨run无法命中；GitHub托管job的文件系统仍相互隔离。ci-validation.yml的regression及七类浏览器/Host job在准备后通过actions/cache恢复Chromium目录。四类Host job另外恢复VSCode目录。键包含资源类型、缓存规则版本、runner OS/架构/镜像标签；Chromium键包含完整锁文件摘要，锁定Playwright及其revision；VSCode键包含锁文件和catalog.mjs摘要，将固定VSCode版本及下载库版本纳入。只允许精确键，不设宽泛restore-keys，不跨平台复用。缓存未命中仍使用现有固定下载路径；命中后也继续Playwright的revision安装检查及VSCode完成标记和版本检查。缓存保存由action在job成功后执行；缓存仅保存工具目录，用户配置、业务回执和候选插件包不纳入。

## 边界与取舍

缓存是GitHub Actions提供的性能优化，受分支可见性、容量和回收规则影响，不保证首次并发job只下载一次。本次不增加集中资源生产job、不调整任务图、不替换工具版本、不扩大超时、不改变验收集合。缓存键和既有工具检查负责版本/平台身份，不声称为工具整个安装树增加了独立字节签名。缓存命中不产生或替代产品验收回执。

## 验证说明

实现后按用户要求，在Node22.23.3执行内存定向检查：四种浏览器路径（默认、绝对、相对、0）在准备和子进程环境中一致；两组run-id/attempt输出相同工具目录；四个workflow的21处npm设置、8类Chromium缓存、4类VSCode缓存均已接线，移除新增缓存设置后与原workflow结构完全一致；下载重试源码未变。首次以/dev/stdout捕获环境文件的探针因ENXIO失败，改为内存捕获后通过，未修改产品代码处理此探针问题。YAML解析及git diff --check通过，未运行真实下载或完整产品测试。后续完整CI须核对：setup-node记录npm缓存命中；工具cache记录精确命中；Webview辅助脚本不再下载至第二个目录；命中缓存时仍执行全部原任务。首次缓存未命中和VSCode下载未处理异常仍可能令CI失败，不能宣称网络根因已修复。
