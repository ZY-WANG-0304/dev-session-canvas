# 将 SSH 重开双状态验收接入正式门禁

本 ExecPlan 按 docs/PLANS.md 持续维护。2026-10-13 用户明确批准已验证的双状态方案；本阶段可修改正式测试与 runner，但不改变产品恢复行为、版本或超时。

## 目标与全局图景

SSH 重开门禁必须独立建立旧远端扩展 Host 已退出和原身份仍运行两个前提，验证独立 Supervisor 持有的原会话恢复、输出、输入和真实 resize。终端完成由私有文件信号控制，与 Host 寿命解耦。任一前提、原身份或业务验收不成立，门禁有界失败并保留现场。

## 进度

- [x] (2026-10-13) fetch origin，main 仍 ea0c9b19；从 main 新建 smoke-remote-host-two-state-fix，接入已确认调查文档。
- [x] (2026-10-13) 选择正式断连方式：setup 记录身份后保持测试未返回，runner 终止本次本地 Electron 进程树，旧远端 Host 实际保留；不修改上游缓存。
- [x] (2026-10-13) 实现 Linux PID/startTicks/UID/私有作用域控制，17项正反例通过。
- [x] (2026-10-13) 原版缓存 native-2双分支全部通过：exit Host2078814退出、retain Host2189996持续原身份，原Supervisor/session及输入/resize/终态/cleanup通过；首轮客户端argv误拒绝保留。
- [x] (2026-10-13) 最终原生 SSH 双分支与全部source smoke通过；共享单root/多root/切换、双窗口、systemd与fallback两阶段回归通过。
- [x] (2026-10-13) 临时预合并7d33f664完整preflight/verify通过：全部npm test、426项Webview和clean-checkout VSIX安装后八场景通过，exitCode=0。
- [x] (2026-10-13) 同步正式设计、证据和技术债，提交并rebase最新main，推送创建PR #328；未合并或发布。

## 意外与发现

完整发布验证先遇到工作目录依赖复用缺少 Drizzle、长路径 Unix socket EINVAL 和移动目录后的 Vite 缓存旧路径。独立短路径 checkout 实际 npm ci、使用既有 Marketplace host 临时根覆盖后进入完整测试；浏览器重复下载改为复制相同 Chromium v1217/ffmpeg v1011 缓存。所有失败日志独立保存，不修改门禁断言或跳过场景。

先前实验用固定版本 minified 退出消息注入，只能作为研究证据。正式门禁选择实际本地客户端丢失，仍必须核验旧远端 Host 保留，不能假设 SIGKILL 自动建立这个状态。磁盘 registry 延迟写入，resize 实时验收必须读原 Supervisor attachSession，不能用旧注册表尺寸推断 PTY 状态。

## 决策记录

2026-10-13 选择实际客户端异常断连，setup 完成后保持未返回；runner 等待已落盘 ready 工件，以本次 spawn 的 Electron 原 PID 为根，核验 UID、本次 spawnargs 私有 user-data-dir、/proc/exe 和进程树身份后 SIGKILL，确认本地已结束，再检查远端 Host 同身份仍运行。exit 再只结束核实 UID、私有 server 根、extensionHost 角色/startTicks 的旧 Host；retain 保留到业务完成。无需上游注入或产品新接口。

SSH 原 filter remote-ssh-real-reopen 保留为两分支的聚合入口，默认全量也执行两分支；分支可具名定向执行。两分支使用独立 fixture，串行，不随机选断言。独立完成信号仅用于 SSH，两阶段本地测试仍按既有路径运行。正式 ready45秒、恢复35秒、resize20秒预算不放宽，前提等待有独立有界预算。

## 结果与复盘

正式修复及验证已完成。原版缓存native-2与最终source smoke两分支均通过，17项控制回归与9项resize回归通过，共享本地重开矩阵通过；临时预合并7d33f664完整0.26.1 release:verify通过。具体上游消息丢失层、其他平台/真实网络、原Host复用和显式重复start拒绝保持未验证。修复合入后PR327按最新输入重验，不合并、打tag或发布。PR #328已创建：https://github.com/ZY-WANG-0304/dev-session-canvas/pull/328。

## 上下文与定向

修复 worktree /tmp/dscsshdiag，分支 smoke-remote-host-two-state-fix，main ea0c9b194fda1f13098cfd7ad4a3e13c4ec5233b。scripts/smoke/run-vscode-smoke.mjs 组织 SSH setup/verify；vscode-smoke-runner.mjs 暴露 spawn handle；vscode-remote-ssh-fixture.mjs 提供私有 server 根和可观察清理。tests/vscode-smoke/real-reopen-tests.cjs 调查基线中第三终端等待 Host PID 消失；修复后 SSH 使用独立信号并记录身份，业务验收后核对原 session resize。新增纯 Node 共用 helper 放 tests/vscode-smoke，runner 用 createRequire 引入，随 staged suite 一同复制。

## 里程碑

先实现纯 Node 身份与控制 helper，使用自有子进程和受控身份替换验证拒绝误发信号、错误退出状态、有界等待与 request 超时。再接入正式 runner 和两阶段 test，保持共享非 SSH 路径语义。最后原生串行运行两分支，保存身份、输出、尺寸与清理证据，在最新发布准备临时预合并 checkout 执行完整 release 验证。

## 具体步骤

在 /tmp/dscsshdiag，Node22.23.3 位于 /tmp/dsc-release-node22/node_modules/node/bin；构建使用 /tmp/dsc-release-026-assets。运行新增 helper 回归、既有 smoke-terminal-resize，再运行 build/build:notifier 后设置 DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=remote-ssh-real-reopen 运行正式 runner。每次用新 debug 根，不覆盖首败。

发布验证将最新 origin/main、已提交修复和 release-0-26-1-refresh 的静态契约在独立临时 checkout 生成预合并输入，不将未合入 main 的分支作为最终发布 ref，不修改 release PR 或打 tag。依 docs/WORKFLOW.md 执行 release:preflight 与 release:verify，只有实际通过才能报告卡点解除。

## 验证与验收

两个分支均有 setupHost、verifyHost、Supervisor PID/startTicks 工件；exit 原 Host 消失，retain 在 verify ready 和业务完成仍非 Z/X。原 session/storage、输出、后续输入及完成终态/历史丢弃断言成立，原 Supervisor 直接尺寸与页面 Fit 目标一致。错误 UID/root/角色/startTicks 不发送信号，PID 复用不误杀。清理发生在业务结果后并有零残留报告。共享本地重开测试需通过，完整发布 verify 结果单独记录。

## 幂等性与恢复

保留原 workspace 和调查分支，所有修复在新主题分支；fixture 使用新路径。不得清理未知资源。必要时仅导出本轮已清理 fixture 的日志/hash后回收重复服务器安装载荷；保留首败关键现场。上游缓存原件不改，失败也执行私有 fixture 清理并保留错误来源。

## 证据与接口

正式设计为 docs/design-docs/remote-host-exit-investigation.md，新证据 docs/references/remote-host-two-state-fix/，遗留项写入 docs/exec-plans/tech-debt-tracker.md。helper 提供 Linux 进程身份、指定旧 Host 条件、客户端异常断连、独立完成观察和原 Supervisor 请求，不创建新会话。不新增依赖、产品入口或版本变更。

修订记录：2026-10-13 用户批准正式实施；新建修复分支及计划，选择实际客户端异常断连以替代研究专用上游注入。

修订记录：2026-10-13 首轮 native 在客户端作用域核验提前失败，未发受控信号；Electron 启动后重写 argv，改为核验本次真实 spawnargs、/proc/exe 与启动时记录的 PID/startTicks，增加真实 argv 重写子进程回归，不放宽远端 Host 检查。

修订记录：2026-10-13 补齐17项回归（包括Supervisor静默连接总预算），修正本地argv作用域文案，记录完整发布验证的环境前提和保留的失败尝试。

修订记录：2026-10-13 最终source smoke双分支和共享回归通过；426项Webview与clean-checkout VSIX八场景全部通过，完整verify退出码0；结果与残余范围已同步。

修订记录：2026-10-13 完成正式设计、测试和证据收口，创建PR #328，将计划移入completed；合并及发布由后续授权流程处理。
