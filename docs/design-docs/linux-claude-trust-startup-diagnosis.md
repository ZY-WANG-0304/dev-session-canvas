---
title: Linux Claude 信任选择页启动失败定位
decision_status: 已选定
validation_status: 验证中
domains: [执行编排域, VSCode 集成域]
architecture_layers: [适配与基础设施层, 宿主集成层, 画布呈现层]
related_specs: [docs/product-specs/runtime-persistence-modes.md]
related_plans: [docs/exec-plans/completed/linux-claude-trust-startup-diagnosis.md, docs/exec-plans/active/smoke-claude-startup-recovery.md]
updated_at: 2026-10-09
---

# Linux Claude 信任选择页启动失败定位

## 范围与当前结论

PR #306 完成了 Linux Claude 启动失败定位；合并后本轮按下述正式方案修复验收适配，验证进行中。确认的故障机制是：Claude 2.1.280 启动时收到一次 Down 后先选中 Yes，随后在没有新增输入的受控环境中退回 No；`tests/vscode-smoke/agent-runtime-reload-driver.cjs` 的 `waitForAgentReady()` 只导航一次，100ms 轮询没有观察到短暂 Yes 时，后续一直停在 No，直到交互就绪预算到期。CLI 内部触发回退的实现原因仍未知。修复方案已选定，本文保持“验证中”，不把诊断完成或受控通过等同于真实验收通过。

原运行没有请求超时诊断，也没有信任页 Enter 或模型回合。已有 hello 成功、输入调用完成和输出送达记录，故当前证据不支持把此失败归因为 F-01 的 RPC 等待或 reader 迟到清理。该判断只覆盖本次失败路径，不宣称排除所有产品问题。

## 正式方案

仅修复 `tests/vscode-smoke/agent-runtime-reload-driver.cjs` 的固定 CLI 验收适配，不改插件产品、RPC 重试或 CLI 权限设置。真实创建、模型 BEFORE/AFTER 应答、Reload 原资源与 owner/session/reader 断言保持。

`waitForAgentReady()` 保留精确信任页及选项顺序识别；看到 No 时用 End（`ESC [ F`）选择末项 Yes，最多三次导航。与 Down 的循环切换不同，固定 Claude 2.1.280 的 End 在已经选中 Yes 时仍选中 Yes，故可容忍旧画面和迟到导航。每次动作前都须重新看到原信任页；连续两个相隔 100ms 的采样都为 Yes 后才发送唯一 Enter。任何输入调用拒绝立即终止，不因超时重发请求；发送 Enter 后只等该页消失与 composer 就绪，不再导航或确认。持续 No 达导航上限、未知布局、登录失败或原预算耗尽均失败。连续采样是防止短暂选择被立即确认的策略，不是 CLI 永不回退的证明，也不保证任意输入延迟下成功。

两组隔离 PTY 对照支持键盘语义：立即 End 在 332.377ms 发出，337.423ms 选 Yes 后 477.708ms 回退，证明 End 不消除 CLI 启动回退；另组信任页后延迟输入的 End 在 1361.268ms 发出，随后 1481.119 / 1561.870ms 再次 End，选项一直为 Yes 至 2128ms。后者只证明固定页上重复 End 不切回 No，不把延迟当正式修复。原运行和本地诊断记录均保留。

`setup()` 在 hello/owner 验证完成、observer 已观察到 provider 与 CLI 后，核验并持久化 `control.startup` 与 `startup-ownership.json`，其中保存原 node、binding、supervisor 和完整资源身份。该动作早于 mountedReader、就绪交互和模型请求；成功取得首次应答后再次用该原资源集合验证，才形成完整 `control.setup` 并 Reload。保存失败不继续交互。

`cleanup()` 优先用完整 setup，否则用启动基线验证原资源退出，再按已有存储边界、owner、supervisor 身份、空 registry 条件清理隔离 Supervisor。缺失基线仍拒绝通过；基线形成前的失败和未知观察不得用事后扫描补成成功。早期 startup 基线不是应答/Reload 成功证明，cleanup 成功也不覆盖原 setup 错误。

## 原失败输入与事实

[原 PR 记录](https://github.com/ZY-WANG-0304/dev-session-canvas/pull/306#issuecomment-6066202227)、[原运行 37821133377](https://github.com/ZY-WANG-0304/dev-session-canvas/actions/runs/37821133377)，失败 Linux job 为 `113462708606`。产品 head 为 `4b2cf71e4c90892cd72315e5641ce07452ba659c`，VSIX SHA256 为 `e17228f434c4cd0017f1a7bdb84e7e6cac895a89a7de9e93bb7c38467ac38e7b`。VS Code 1.117.0、Node 25.6.0、Claude Code 2.1.280；`root_ownership=true`、`root_checks=all`、`platform=all`、`installed_mode=live-runtime`。原生资产复用 `37479044769`，产品 VSIX 重新构建。

同轮三平台 installed Terminal/Webview、三平台 Codex Reload 与 Linux 双窗口通过；Linux Claude 在首次应答及 Reload 前失败。首错为 `Timed out: claude interactive surface`，不能将整轮描述为通过。

原 artifacts 的 `failure-getDiagnosticEvents.json`、`failure-getRuntimeSupervisorState.json` 和 `failure-webview-probe.json` 给出以下时间线。时间均为 2026-10-08 UTC；源输出时间取 `supervisorEmittedAtMs`，不冒充 CLI 内部写出时刻。

| 时间 | 原始事实 |
| --- | --- |
| 18:05:51.383 | Host 记录焦点 `ESC [ O` 和终端能力回复 `ESC [ ?1;2c` |
| 18:05:51.464 / .641 | 两次 CR，分别推进主题选择和 Security notes |
| 18:05:51.701 / .703 | 再次焦点及终端能力回复 |
| 18:05:51.794 | 唯一一次 Down `ESC [ B` 的 `execution/inputWritten` |
| 18:05:51.803 | revision 9，No→Yes；.813 已在 Webview 应用 |
| 18:05:51.840 | revision 10，Yes→No；.844 已在 Webview 应用 |
| 后续约 90 秒 | 没有后续输入和内容 revision，最终源与 Webview 都选中 No，driver 到期失败 |

全程只有一次 `execution/startRequested` / `execution/started`，七次 `execution/inputWritten`。Host 日志表示调用完成，不是原运行内核只写一次的证明。setup 失败时的白名单进程观察显示 supervisor 5017、provider 5029、CLI 5037 存活，只有一个 active CLI；已退出的后代不等于第二条 active CLI。

## 同版本直接 PTY 对照

本地 Linux / Node 25.6.0 使用真实 Claude 2.1.280、node-pty 和 120×39 headless xterm。绕过 VS Code、Host、Supervisor、RuntimeSupervisorClient 及产品原生 provider；每次使用新 HOME、配置和 workspace，假 token 指向 `127.0.0.1:1`，禁用更新及非必要流量，空 MCP/tools、plan 权限。只推进启动页并发送一次 Down，从不提交信任页 Enter，不发起模型回合。

四组有限实验各执行一次。下表时间为各自开始后的毫秒数，`plain-held` 只是改变输入时机的对照，不是固定 sleep 修复方案。

| 对照 | Down | Yes | 回到 No | 观察结果 |
| --- | ---: | ---: | ---: | --- |
| plain：不转发终端回复 | 493.407 | 498.651 | 638.007 | 无后续输入仍回退 |
| replies：转发 xterm 能力回复 | 369.169 | 374.293 | 499.012 | 同样回退 |
| plain-trace：不转发回复，strace 记录读取 | 556.940 | 563.554 | 699.897 | 内核读取记录只有一次 Down |
| plain-held：信任页出现后等 1 秒再发唯一 Down | 1409.412 | 1428.914 | 未观察到 | 观察至 2162ms 仍为 Yes，未确认信任 |

`plain-trace` 的 CLI PID 3141077 使用终端 FD 7，而非 FD 0。该 FD 此前只读到两次 CR，随后唯一 Down 为：

```text
3141077 1791484082.233748 read(7, "\33[B", 262144) = 3
```

此后直到回退没有新终端输入。它证明在本地受控运行中，产品输入路径、终端能力回复以及重复 Down 均不是回退的必要条件；不能倒推原 CI 已采集内核证据，也不能猜测 CLI 内部定时器或组件重建。

归档为 `scripts/diagnostics/diagnose-claude-trust-startup.mjs` 后，对该入口另做一次有限 `plain-trace` 验证：Down 512.016ms、Yes 518.925ms、No 654.430ms；CLI PID 3235456 同样只有一次 `read(7, "\33[B", 262144) = 3`。脚本退出 0 只表示完成诊断采集，不代表 Claude 接受信任或 Reload 验收通过。

## 原输出与 driver 机制验证

从原 registry 输出末尾分别取两段 107 个 UTF-16 字符的 VT 增量（各 109 UTF-8 字节），与 plain、replies、plain-trace 三组原始输出逐字节相等。两段 SHA256 分别为：

```text
No→Yes  1a8a2c62885d36b57defab253fe9742c5c3f4bd132b6b0a471c671883d030130
Yes→No  eede085aed59b6a8736384ea5c0c4db21bf9100a26b8157ecbe833fca31a95ad
```

把原前缀及这两段依次送入 headless xterm，得到 No、Yes、No；首末画面一致。因此这里不是只看最终截图猜输入丢失或 Webview 渲染出错。

从实际 driver 用 TypeScript AST 提取 `waitForAgentReady()`，以原画面和受控时钟回放：t=0 看到 No 并发 Down，t=9 为 Yes，t=46 回 No，下一次 probe 在 t=100。实际函数最终完成 900 次 probe、虚拟时间 90000ms 后抛原超时；只发一次 Down，没有 Enter。把 Yes 保持可见的正向对照在 t=100 发 Enter，随后进入模拟 composer。后者仅验证 driver 分支，不是真实 CLI/模型成功。原 CI 未记录每次 probe 的准确时间，不能把这个受控调度写成原运行的逐次采样记录。

根本约束在 `claudeTrustMoved`：首次看到 No 后即置为 true，此后再看到 No 只 sleep，不再导航。现有 driver 单测的 `still-visible` / `reverted` 场景本来就期待超时，保证未知页不被盲目确认，但不能证明启动页不会回退。保持当前状态单测 38/38 通过，也不代表此次失败已修复。

## cleanup 的独立原因

`setup()` 先等待 `waitForAgentReady()`、发送首次模型回合并确认应答，之后才构造 `setup.resources` 并写 `control.setup`。本次失败时 `control.json` 仍只有 setup phase、nonce、deadline，没有 setup 资源基线。

`cleanup()` 清空节点和绑定后，调用 `originalResourcesExited(control.setup?.resources)`；该函数拒绝空集合，产生 `Missing original startup resources cannot count as released.`。用实际提取函数传 `undefined` 可复现同一断言。原 `cleanup.json` 的 `pass=false` 保留：这是早退路径没有保存原身份而导致的清理证据缺口，既不能证明进程泄漏，也不能证明原资源全部退出。

## 诊断时的后续边界（PR #306 历史记录）

后续应设计能应对启动页回退的有界交互状态机，保留精确页面/选择核对和页面消失后的就绪验证；还应在 setup 早退前保存已经取得的资源身份，使 cleanup 能按原对象验证退出。PR #306 当时未选定具体恢复规则；本轮方案见前文，仍不能从一次延迟对照承诺“等 1 秒必定稳定”，也不能通过盲发 Enter 或反复跑到绿色消除失败记录。

导航恢复与 RPC 重试是不同问题。任何后续修复都不得因等待超时断言操作未发生，或自动重发创建、模型请求等有副作用的操作。历史 `37721390485` 两条 CLI 缺身份细节，根因仍未知；`37722835410` / `37723822196` 与本次选择回退症状相同，但不追认其内核输入次数、内部触发机制或已被修复。

## 复查入口与证据位置

在仓库根、已有 node-pty/headless xterm 依赖及 Linux strace 的环境，指定本地 Claude 2.1.280 的绝对路径，输出到新的目录：

```sh
node scripts/diagnostics/diagnose-claude-trust-startup.mjs --cli /absolute/path/to/claude --mode plain-trace --output .debug/claude-trust-new-trace
node --test scripts/test/test-agent-runtime-reload-driver.mjs
```

可选模式为 `plain`、`replies`、`plain-trace`、`plain-held`，单次启动最多观察 15 秒，Down 后观察 750ms。保存 summary、逐次输入/输出、最终屏幕和可选 syscall 日志；完成后终止本次子进程并删除临时配置。结果会随调度变化，未回退只记本次未观察到，不循环重试到预期结果。

本轮原 CI 下载证据在 `/tmp/pr306-multi-smoke-evidence/`；本地原始实验在 `.debug/claude-trust-{plain,replies,plain-trace,plain-held}/`，归档脚本验证在 `.debug/claude-trust-packaged-trace/`，输出比对与实际 driver 回放结果在 `.debug/claude-trust-evidence-check.json`。这些本地文件不随 Git 归档；上文保留精确输入、时间、系统调用与内容 hash，远端失败证据以原运行 artifacts 为准。本次未重跑远端 smoke，未修改产品或验收 driver，原失败与 cleanup 失败状态不变。

## 修复验证（进行中）

2026-10-09，`node --test scripts/test/test-agent-runtime-reload-driver.mjs` 45/45 通过，覆盖采样间完整回退、可见回退、迟到导航、不消失页面、导航上限、未知页面、输入错误不重试、reader/ready/model 失败时的持久化原基线、模型应答后身份替换拒绝及基线写失败拒绝继续。

原 driver 与修后函数对同一受控时序（输入后 9ms Yes、46ms No，100ms probe）分别运行：原版一次 Down，2 秒缩短测试预算耗尽；修后 t=0/100ms 两次 End，t=300ms 唯一 Enter，t=700ms 通过模拟 composer 双重确认。测试没有要求旧版支持 End，旧版 Down 也按实际语义产生短暂 Yes。

用修后实际 `waitForAgentReady()` / `hasLoadedAgentComposer()` 连接同版本直接 PTY 的有限验证：580.819ms End，586.365ms Yes，645.673ms No；681.504ms 第二次 End，686.061ms Yes；883.111ms 唯一信任 Enter，891.666ms 信任页消失，1586ms 完成真实 composer 就绪。只使用假认证、没有模型回合，不能替代真实应答 / Reload。原始证据位于本轮 `.debug/trust-actual-driver/`、`.debug/trust-before-after.json`，真实安装态结果待追加。
