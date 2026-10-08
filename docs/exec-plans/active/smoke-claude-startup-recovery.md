# 修复 Claude 启动验收与 setup 早退清理

按 `docs/PLANS.md` 维护本计划。目标是在不放宽真实原身份 Reload 验收的条件下，修复 PR #306 已定位的 Claude 启动选择回退问题。

## 目标与全局图景

原 run 37821133377 使用 Claude 2.1.280，在唯一一次 Down 后源输出短暂 Yes 再回到 No；driver 的 100ms 轮询和一次性导航因此等待到期。setup 尚未保存资源基线又使 cleanup 无法证明退出。本轮从已合并 PR #306 的 origin/main f111041a 新建 smoke-claude-startup-recovery 分支，只调整验收适配和相关验证，保留原失败。

## 进度

- [x] 2026-10-09：确认合并提交、从最新 main 建独立 worktree，读取诊断及现有测试。
- [x] 2026-10-09：固定 CLI 实测 End 选择末项、重复 End 保持 Yes；选定最多三次 End、连续两次 Yes 后唯一 Enter，设计已同步。
- [x] 2026-10-09：实现最多三次 End、唯一确认及启动原基线；45/45 回归、修前后对照与修后实际 driver 连接真实 CLI 的回退恢复通过。
- [ ] 用固定 Claude 版本和原 VSIX 验证；同步证据、技术债并创建新 PR。

## 意外与发现

observer.result() 返回可被原位更新的条目。补充 executable 原位变化对照后捕获基线随观察变化的问题；保存深拷贝固定原身份，保留修前失败。首个 CI 输入 a0399864 不包含该补充，后续最终验收使用修后 head，不能互相代证。

原包产生后 PR #306 又添加了纯观察脚本 scripts/diagnostics/diagnose-claude-trust-startup.mjs，现有 package 复用白名单不含该路径。复核其不参与产品构建后，给该单一文件添加复用例外；不泛化放行所有 diagnostics，也不重打未变产品。

当前 Webview probe 只有最终屏幕，不能保证看到两次采样之间的 Yes；因此不能把重复读到 No 当成前一次导航已经消费。原始 setup.resources 仅在模型应答后生成。Windows observer 持有原进程 handle，不能用新的 PID 扫描替代。

## 决策记录

2026-10-09：采用精确页面下有界 End 导航，保留交互而不预置信任。End 重复保持末项已由两组 PTY 对照证明；不恢复 Down 循环切换，不引入源输出解析或新产品协议。启动基线与完整 setup 分开保存，完整应答后再次核对原身份。

2026-10-09：先比较固定 CLI 是否提供幂等的末选项导航、有证据的回退恢复以及隔离工作区配置。固定 sleep 不能充当 CLI 已稳定证明，普通输入 RPC 失败也不能授权重发。实际方案在受控输入验证后明确落盘。

## 结果与复盘

本地实现和定向验证完成。真实 CLI 中已观察到原样回退，第二次 End 恢复后进入 composer；早退基线受控验证通过。真实安装态应答 / Reload / 清理仍待 CI。

## 上下文与定向

tests/vscode-smoke/agent-runtime-reload-driver.cjs 管理真实 Agent setup、Reload、verify、cleanup；scripts/test/test-agent-runtime-reload-driver.mjs 提取实际函数在受控时间和进程状态下测试。scripts/diagnostics/diagnose-claude-trust-startup.mjs 可以在临时 HOME/配置/workspace 用假认证观察真实 Claude，不访问个人配置。scripts/smoke/run-vscode-agent-runtime-reload-candidate.mjs 准备 VSIX 及隔离环境，.github/workflows/runtime-production-acceptance.yml 支持 root_checks=claude 与原包/已通过 installed 证据复用。

## 工作计划

先完成一个有限键盘语义对照，明确选择恢复方案，不循环运行到通过。随后在 driver 内保存启动后已经核验的原资源身份，交互或模型应答失败仍可清理；成功路径继续核验相同身份后再 Reload。测试覆盖选择回退、旧输入延迟、未知页面、超时及早退，之后仅运行受影响 Linux Claude 真实场景。

## 具体步骤

在本 worktree 使用现有 node_modules 依赖。先运行固定 CLI 隔离 PTY 诊断，把输出放 .debug 新目录；执行 `node --test scripts/test/test-agent-runtime-reload-driver.mjs`。CI 按原包 run 37821133377、Linux、root_checks=claude、skip_installed=true 与 installed_evidence_run=37821133377 收窄，保留产品 VSIX hash。推送前 fetch/rebase，所有失败按独立输入保留。

## 验证与验收

应证明实际 driver 在选择回退时能够完成信任页到 composer 的转换，且未知输入结果不触发副作用请求重试；setup 早退时 cleanup 使用停止前记录的原资源身份。真实 Linux Claude 应取得 BEFORE/AFTER 模型应答、原 owner/session/reader 身份、退出及 cleanup 证据；若发现新失败，按其首次证据定位，不覆盖旧失败。

## 幂等性与恢复

诊断和真实验收均使用独立临时目录，禁止修改个人 Claude 配置或用户会话。仅清理本轮已记录身份的进程。旧 worktree 与用户无关修改保留。

## 证据与备注

原诊断见 docs/design-docs/linux-claude-trust-startup-diagnosis.md，原产品 VSIX SHA256 为 e17228f434c4cd0017f1a7bdb84e7e6cac895a89a7de9e93bb7c38467ac38e7b。

## 接口与依赖

复用现有 driver、observer、node-pty 和 headless xterm；不引入产品 wire 协议或输入重试机制。新判断仅属于固定 CLI 验收适配。

2026-10-09：按用户继续修复 CI 的要求建立计划，明确验收与原包复用边界。
