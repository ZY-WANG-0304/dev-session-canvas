# 定位 Linux Claude 信任选择页启动失败

本计划按 `docs/PLANS.md` 维护；本轮交付是可复查的定位结果，不包含行为修复。

## 目标与全局图景

定位 PR #306 的真实安装态验收 run 37821133377 中 Linux Claude 未进入 Reload 的原因。输入固定为 head 4b2cf71e、VSIX e17228f434c4cd0017f1a7bdb84e7e6cac895a89a7de9e93bb7c38467ac38e7b、Claude 2.1.280、VS Code 1.117.0。任务是定位，保留原失败，不通过重复跑到绿色或更改信任断言冒充修复。

## 进度

- [x] 2026-10-09：读取 PR 评论、运行与实体 artifacts，确认首错为 Claude 信任选择页等待超时，cleanup 缺原始 setup 资源。
- [x] 2026-10-09：原日志显示 Host 只记录一次 Down、没有信任页 Enter；源输出先 Yes 后 No，两个 revision 相隔约 37ms。
- [x] 2026-10-09：还原七次输入及源端 No→Yes→No，核查 driver 和产品链路，完成原增量与本地输出逐字节比对。
- [x] 2026-10-09：四组直接 PTY 对照、一次归档脚本验证及实际 driver 受控回放完成；strace 证明本地单次 Down 后仍回退。
- [x] 2026-10-09：结论、证据与未修问题同步到设计、技术债、可复用脚本；随本次 PR 更新提交。

## 意外与发现

原 Host inputWritten 七项包括两个启动 Enter、两组焦点/终端能力回复及一次 Down；没有 RPC 超时报错。最终 CLI/provider/supervisor 都仍存活。源输出含 Yes→No，不能仅凭最终 Webview 截图推断输入丢失或渲染失真。

## 决策记录

2026-10-09：归档诊断脚本只参数化同版入口与证据目录，增加退出观察；不将延迟对照变成修复或盲目重试导航。

2026-10-09：优先使用原 artifacts 与本地同版本 Claude，在隔离目录、固定输入和无模型请求的条件下做有限 PTY 对照。必要时对原输入链路插桩；不改产品行为，不输出真实密钥，不发送模型请求，也不自动重跑整轮多平台验收。

## 结果与复盘

定位完成：同版 CLI 在单次 Down 后自行输出选择回退，driver 只导航一次并按 100ms 采样，未看到短暂 Yes 后持续等待到期。原输出与受控回退增量相同，实际 driver 回放得到 900 次 probe、90 秒预算、只一次 Down、无 Enter；保持 Yes 的对照可进入模拟 composer。cleanup 报错是 setup 未保存 resources 后对缺失事实的拒绝。CLI 内部触发原因和旧两条 CLI 仍未知；本轮不改 driver/产品，不重跑远端验收，行为修复及早退清理证据补全已登记技术债。

## 上下文与定向

tests/vscode-smoke/agent-runtime-reload-driver.cjs 的 waitForAgentReady 在看到 No 时只发一次 Down，观察到 Yes 后才发 Enter；轮询间隔 100ms。setup 只有完成真实第一轮应答才写 control.setup.resources；cleanup 要求该原身份集合。原证据位于 /tmp/pr306-multi-smoke-evidence/linux-agent/dsc-root-agent-claude/runtime/artifacts，包含诊断、最终 Webview、registry 输出与进程身份。

产品输入由 Webview terminal.input 进入 CanvasPanelManager.writeExecutionInput，经 RuntimeSupervisorClient / Supervisor / native execution provider 送到 CLI。inputWritten 表示 Host 写入调用完成，不自动证明底层字节只写一次。旧技术债还涉及历史两条 CLI 的不同现象，本轮不合并归因。

## 工作计划

里程碑一把原七次输入、revision 9/10 输出和 setup/cleanup 调用顺序整理成可检查时间线。里程碑二用同版本 Claude 和真实 PTY，以一个明确 Down 输入与受控终端回复验证选择变化，必要时逐层记录提交与底层写入。里程碑三把确证机制、反向控制和适用范围落盘；不足部分显式保留未知。

## 具体步骤

在 runtime-rpc-request-timeout worktree 工作。先解析原 artifacts，不读取或输出个人 Claude 配置。执行 claude --version 已确认本地为 2.1.280；诊断使用新的临时 HOME/CLAUDE_CONFIG_DIR、假 API 配置和现有 node-pty/xterm。原始诊断输出放 .debug 独立目录；可复用入口已归档为 scripts/diagnostics/diagnose-claude-trust-startup.mjs，接受 --cli 绝对路径、--mode 和新的 --output 目录。若需要复用原 VSIX，必须核对哈希；不把另包或开发态通过记为原安装态通过。

## 验证与验收

必须区分一次 Host 调用、一次 PTY 写入、CLI 选择状态变化三个事实。受控对照须明确输入字节和输出状态；如无法获得原运行底层证据，只报告受控机制与原事实的关系。cleanup 必须分别说明绑定清空和原身份退出证据，保留 pass=false。

验证结果：`node --test scripts/test/test-agent-runtime-reload-driver.mjs` 38/38；归档脚本 `node --check` 通过，实际 `plain-trace` 入口在唯一一次 Down 后再次观察到 Yes→No。三个原始复现的两个 VT 增量分别与 CI 相等（107 UTF-16 / 109 UTF-8），真实 xterm 重建首末 No 画面一致。原始临时进程均已退出、隔离目录已删除。

## 幂等性与恢复

每个诊断只有有限步骤和总时限，清理自己创建的进程与临时目录，不操作个人 Claude 会话。原用户工作树不改；无产品补丁、无模型副作用请求。

## 证据与备注

原运行 https://github.com/ZY-WANG-0304/dev-session-canvas/actions/runs/37821133377 ，PR 评论 https://github.com/ZY-WANG-0304/dev-session-canvas/pull/306#issuecomment-6066202227 。本轮初步证据：18:05:51.794 Host Down，18:05:51.803/840 源输出 revision 9/10，90 秒后仍在 No。这些时间来自原诊断而非重跑估计。

## 接口与依赖

复用 node-pty、headless xterm、Node fs/process 与同版本 Claude CLI；必要诊断只观测相关字节，不改 wire 协议或输入重试策略。

2026-10-09：根据原运行记录建立诊断计划，记录已知事实与待确认机制。

2026-10-09：完成有限实验和 driver 机制验证，归档诊断并同步设计、旧债和 F-03 结论；仅完成定位，保留所有原失败和未修边界。详细毫秒记录、syscall、hash 与复查命令见 `docs/design-docs/linux-claude-trust-startup-diagnosis.md`。
