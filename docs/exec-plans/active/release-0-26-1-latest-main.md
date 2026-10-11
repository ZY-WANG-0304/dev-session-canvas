# 从最新主线准备 0.26.1 发布

本 ExecPlan 按 `docs/PLANS.md` 持续维护。任务为发布准备，交付可评审的静态输入与实际验证结果；合并和发布需后续授权。

## 目标与全局图景

将 0.26.0 之后已合入 main 的运行时归属、启动/恢复/删除、通知与终端交互修复整理为 0.26.1 Preview。用户通过英中文 listing 和 CHANGELOG 了解变化、升级风险和原有恢复限制；完整发布验证用于判断是否可合并。

## 进度

- [x] (2026-10-11) fetch origin，从 a39cd8c1 创建 release-0-26-1-latest-main，保留未跟踪 image.png。
- [x] (2026-10-11) 复核历史准备分支和主线新增 #314 至 #316；旧分支只作为静态文案参考。
- [x] (2026-10-11) 同步 manifest、lockfile、双 CHANGELOG、英中文 README/listing、手册、支持文档及契约。
- [x] (2026-10-11) 提交静态输入，preflight、root/旧协议/完整 Host wiring、鼠标诊断、notifier typecheck/source/companion/locale 和独立双包检查通过。
- [x] (2026-10-11) 精确 5c2cc2f7 的独立 clean-checkout VSIX 八场景全部通过。
- [x] (2026-10-11) 已实际运行完整 verify 并逐次修正确定的 fixture/CI 前提缺口；完整命令仍未通过，最新双窗口删除与 systemd Canvas 阻塞未确认根因。
- [x] (2026-10-11) 基于最新 main 推送，创建 PR #317 并启用预合并检查。
- [x] (2026-10-11) 回收最终结果，登记具名阻塞并恢复 PR #317 草稿；Webview 423/424，失败项原样隔离复跑通过。
- [ ] 后续定位宿主阻塞，完整重验最新预合并结果后再解除草稿。

## 意外与发现

release-0-26-1-prep、release-0-26-1-prep-resumed 和 release-0-26-1-from-main 已被其他 worktree 使用，故新建独立分支。旧准备曾因完整门禁失败停留草稿，不能复用通过结论。首轮完整 verify 在 test-runtime-completed-history.mjs:219 失败：旧断言要求 diagnostics 为空，#316 新诊断合法产生 execution/deleteBoundary。实际派发仍保留原 binding；将预期改为精确删除事件，并保留原归属和无正文断言。最新主线已有后续修复，但仍需实际验证。

## 决策记录

2026-10-11 / Codex：按用户指定使用 0.26.1；主扩展和 notifier 同版。历史静态文案可复用，新增生命周期和删除准入修复需补齐用户说明。0.26.0 的一次性豁免不适用；保持完整门禁，不改测试基准或引入通用 skip。

## 结果与复盘

发布静态输入、确定的测试/CI 准备修正和草稿 PR 已交付。精确 5c2cc2f7 的双 VSIX/八场景 clean-checkout 通过，真实重开/多根定向通过；完整门禁仍未取得通过。双窗口删除后 owner 终态与 systemd Canvas 就绪问题已登记正式阻塞文档，Webview 全套首败仍保留。不得合并或发布，不继承旧版本豁免。

## 上下文与定向

根 package.json、package-lock.json 和 extensions/vscode/dev-session-canvas{,-notifier}/package.json 的版本同步。两扩展 CHANGELOG、英中文 README.marketplace.md 与根 README 描述用户行为；docs/release-contracts/v0.26.1.md 是静态契约，docs/public-preview-release-playbook.md 和 docs/notifier-preview-release-playbook.md 提供执行步骤。原生六目标资产是默认 build/VSIX 输入；匹配源码后可复用 /tmp/dsc-release-026-assets。

## 工作计划

第一里程碑完成静态输入，运行 preflight 与 git diff --check，确认用户文案一致且历史 CHANGELOG 不变。第二里程碑提交输入，在 /tmp 短路径隔离检出用 Node 22、npm ci 和匹配原生资产运行完整 verify，并补充 notifier source、companion、locale 和独立打包。第三里程碑记录真实结果，失败时保留具名阻塞并创建草稿 PR；通过时创建可评审 PR。推送前 fetch/rebase main，若产品树变化则重做受影响验证。

## 具体步骤

在仓库根执行静态检查与提交；隔离目录继承原生资产环境变量，并使用私有临时目录避免 runtime 存储权限和 Unix socket 长路径问题。

    export PATH=/tmp/dsc-release-node22/node_modules/node/bin:$PATH
    export DEV_SESSION_CANVAS_EXECUTION_ASSETS_SET=/tmp/dsc-release-026-assets
    npm run release:preflight -- --version 0.26.1
    npm run release:verify -- --version 0.26.1
    npm run typecheck:notifier
    npm run test:notifier-source
    npm run test:notifier-smoke
    npm run test:notifier-locale-smoke
    git diff --check

## 验证与验收

preflight 必须通过版本、双 CHANGELOG 和契约校验；verify 必须通过门禁回归、完整 npm test、HEAD clean-checkout VSIX 与安装 smoke。PR 还需针对最新 head 与 origin/main 的预合并结果验证；发布 tag 验证属于后续发布。有限三平台历史证据只覆盖原设计声明场景，不替代本次完整门禁或外部市场安装、真实通知点击。

## 幂等性与恢复

检查可重试；每次使用独立日志和短路径目录保留失败现场，不覆盖其他 worktree 或 image.png。失败时保持 PR 未合并，不创建 publish tag。clean-checkout 使用已提交 HEAD，因此先提交静态材料再验证。

## 证据与备注

    origin/main: a39cd8c1
    分支: release-0-26-1-latest-main
    原生资产: /tmp/dsc-release-026-assets（尚待当前输入校验）

## 接口与依赖

使用现有 release-preflight.mjs、run-clean-checkout-vsix-validation.mjs 与发布工作流，不新增依赖、接口或门禁豁免。

修订记录：2026-10-11，依据用户要求从最新 origin/main 独立准备 0.26.1，记录旧分支边界与完整验证要求。

修订记录：2026-10-11，记录首轮完整验证失败与旧诊断断言差异；修正契约中的 Host 接线命令为实际 node 脚本，补充精确诊断预期，不修改产品实现或放宽门禁。

## 2026-10-11 验证记录

Node 22.23.3、VS Code 1.141.0、umask 0077，隔离检出 /tmp/dsc261latest。六目标资产 /tmp/dsc-release-026-assets 已在默认构建/打包中通过当前输入校验。首轮 verify 在 completed-history 旧 diagnostics 空断言失败；root 的预期拒绝也会产生边界事件，修正后分别精确检查拒绝与正常清理，原绑定与无正文断言均保持。第二轮网络下载卡在 0%，主动结束此次安装后连接同版仓库浏览器缓存，第三轮完整命令重新运行，不追认为第二轮成功。日志 /tmp/dsc261latest-verify.log、/tmp/dsc261latest-verify-final.log、/tmp/dsc261latest-verify-cached.log。

root ownership/preparation、legacy reconnect、mouse diagnostics、notifier typecheck/source 均 exit 0；第一次误用不存在的 test:runtime-reader-host-wiring 名称，未执行测试，已改为 node scripts/test/test-host-execution-owner-wiring.mjs 并完整 exit 0。日志 /tmp/dsc261latest-directed.log、/tmp/dsc261latest-host-wiring.log。notifier companion 与 en/zh-cn locale smoke 均 exit 0，见 /tmp/dsc261latest-notifier.json。

在精确 5c2cc2f7 上独立运行 validate:clean-checkout:vsix -- --ref HEAD --keep-temp，完整 npm ci、正式主扩展打包与八场景 packaged smoke 均 exit 0，见 /tmp/dsc261latest-clean-vsix.log，保留检出 /tmp/dev-session-canvas-clean-checkout-M6PgMo/repo。独立 notifier package:vsix exit 0。包内版本均为 0.26.1/Preview，publisher、api:none、英中文资源、listing 及主扩展 extensionPack / notifier 单向依赖均正确，见 /tmp/dsc261latest-vsix-inventory.json；不代证真实市场自动安装和桌面点击。

PR #317 首轮预合并 CI run 38122050123 六目标资产成功，但完整验证在市场浏览器 E2E 启动前因缺少 chromium_headless_shell-1217 失败。PR 与 publish prepare 流程都新增 npm ci 后安装 Chromium 和系统依赖，统一 PLAYWRIGHT_BROWSERS_PATH 至仓库 .playwright-browsers；历史无 release:verify 的 tag 不增加浏览器准备要求。两个 workflow 回归通过；实际修复后的 CI 仍待结果。

修订记录：2026-10-11，回收精确输入的独立 VSIX 与 notifier 验证，记录缓存下载重试、首轮 CI 失败及双阶段浏览器准备修复。

第三轮完整 verify 已通过单元测试及 local-execution-flow、owned-canvas-reconciliation、snapshot-only-manual-recovery、local-surface-cutover、local-preparation-failure、local-pty-robustness、local-links-and-stop、runtime-checkpoint-refresh、trusted 和 restricted，随后 legacy-supervisor-upgrade 在第 321 行查询新 root 会话 socket 时超时。原旧会话已通过前段输入/输出/兼容操作；新会话 metadata 和 registry 证明 root runtime 已启动，但 fixture 继续按旧 XDG socket 规则计算新地址。只将新会话路径改为当前 root 固定 /tmp/dsc-root-uid/d-digest.sock，并要求 runtimeOwner；旧路径 helper、原输入输出/隔离/清理断言保持。实际修复后定向与完整门禁待复核，不能将首败追认为通过。

修订记录：2026-10-11，记录 legacy upgrade 新 root socket 假设差异，修正新会话 fixture 地址，不修改产品或旧会话兼容行为。

2026-10-11：旧升级 smoke 修复后定向完整通过，见 /tmp/dsc261latest-legacy-upgrade.log；CI run 38122582127 已越过浏览器缺失，随后因 checkout 下市场 Host TMP 路径过长导致 VS Code listen EINVAL，在业务断言前失败。双阶段 workflow 使用既有 HOST_TMP_ROOT 配置指向 /tmp/tm-runId 短路径，调试工件仍在 checkout；与本机已通过市场 E2E 的短路径环境一致。workflow 回归检查该配置，实际后续 CI 仍待结果。

第四轮完整 verify 在 runtime-checkpoint-refresh 捕获首个 16,384 字符 chunk 时立即要求等于 descriptor 声明的 104,842 字符，尚未等到后续分页；前轮同场景通过。waitForHostMessages 的 predicate 在页面逐步到达时直接 assert 总长度，属于检查等待前提缺口。仅在累计长度小于声明长度时继续原 30 秒轮询；不改变连续 offset、超长拒绝、事件分离、revision、可见 marker 或停止/恢复断言。失败证据 /tmp/dsc261latest-verify-all.log 与 /tmp/d26l4s/runtime-checkpoint-refresh/artifacts 保留；修复后需定向与完整重验。

修订记录：2026-10-11，记录 checkpoint smoke 对部分分页过早断言的确切输入，并保持原完整性断言等待全部 chunk。

第五轮 89c49a53 完整 verify 已通过 checkpoint、trusted、restricted 和旧升级，停在 real-reopen setup：Agent 原会话 live，而两个 Terminal 都为 rejected-before-acquire，未进入实际关窗重开。fixture 连续创建三节点（页面自动启动）且连续显式 start，未满足既有单启动槽前提。创建每个节点后先等待其原 runtime live，再创建下一个；保留原三会话、显式启动、输出、PID/session、completed 无正文及两阶段真实重开断言。前述创建等待模式已用于主 smoke，不增加重试或放宽生产配额。实际修复后 real-reopen 验证待执行，首次失败 /tmp/dsc261latest-verify-latest.log 与 /tmp/d26l5s/real-reopen/artifacts 保留。

修订记录：2026-10-11，按真实重开 setup 的已拒绝快照补齐逐次原执行启动前提，保持原恢复场景断言。

真实重开修复后 real-reopen 的 setup/verify 完整通过，见 /tmp/dsc261latest-real-reopen.log。剩余场景独立运行中 multi-root 和 single-to-multi-root 也通过；two-window-shared-runtime 的 owner setup 出现同样的连续创建前提：Terminal live，Agent rejected-before-acquire，尚未进入双窗口观测。仅在创建 Agent 后等待其原 runtime live 再创建 Terminal，保持原共享会话身份、输出和删除断言；日志 /tmp/dsc261latest-reopen-rest.log 保留。Webview 全套正在运行，不能提前宣称完整通过。

修订记录：2026-10-11，回收真实重开与多根通过证据，并补齐双窗口 owner setup 的同一启动前提。

双窗口第二次运行已越过启动拒绝，在 owner registry 断言失败：registry 含第一次失败 Terminal session b9b540d2，而当前节点绑定 bb9b6bc0。该场景固定使用 checkout/.debug 路径并删除 profile，忽略全局 DEV_SESSION_CANVAS_SMOKE_DEBUG_ROOT，因此第二轮实际复用了第一轮持久运行时地址。先修正 runTwoWindowSharedRuntimeScenario 使用统一 smokeDebugRoot，在全新 /tmp/d26lrest3 重验，保留 registry/session 身份断言，不直接追认为产品故障或已确认纯环境问题。

修订记录：2026-10-11，记录两轮双窗口精确 session 证据，统一其场景目录配置以支持真正隔离重验。

## 收口结果与当前阻塞

最新隔离双窗口已通过附着、双向输入、resize 和 Terminal 停止，但 attacher 删除 Agent 后 owner 30 秒内仍保留 live/waiting-input，原 stopped/history-restored/清绑定断言失败；根因待定位。systemd-user-real-reopen setup exit 0，verify 的 editor Canvas ready 20 秒超时，后续 fallback 与 Remote SSH 尚未执行。Webview 全套 423 passed / 1 failed（12.4 分钟），主题用例在 openHarness ready 5 秒超时；首次 trace/截图保存到 /tmp/dsc261latest-theme-first-failure，原参数隔离复跑 1 passed，不追认为全套通过。

正式事实和后续要求见 docs/design-docs/release-0-26-1-validation-blockers.md，技术债已登记。PR #317 恢复草稿，过期 CI 运行已结束；草稿跳过不作为通过。无产品修复、无发布 tag、无渠道写入，原未跟踪 image.png 保留。未来解除草稿时必须基于最新 main rebase，并对最新预合并结果运行 preflight 和完整 verify。现有通过证据只按各自输入与声明范围保留，不外推到当前完整门禁。

修订记录：2026-10-11，完成发布材料和草稿交付，记录独立宿主阻塞与 Webview 首败/原样复跑结果；后续产品调查不混入本次静态发布收口。
