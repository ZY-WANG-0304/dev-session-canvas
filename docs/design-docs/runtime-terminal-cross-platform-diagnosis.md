---
title: 终端退出完整性契约的跨平台复核
decision_status: 比较中
validation_status: 验证中
domains:
  - 执行编排域
  - VSCode 集成域
architecture_layers:
  - 宿主集成层
  - 适配与基础设施层
related_specs:
  - docs/product-specs/runtime-persistence-modes.md
related_plans:
  - docs/exec-plans/completed/runtime-terminal-cross-platform-diagnosis.md
updated_at: 2026-09-20
---

# 终端退出完整性契约的跨平台复核

## 背景与当前判断

承接 `dd2fa497` 的 Linux 定位，用户要求再次检查其他平台，仍禁止直接修改业务代码。调查在 2026-09-19 开始，2026-09-20 收口。上一轮 `docs/design-docs/runtime-terminal-tail-diagnosis.md` 的自然样本、syscall 和残留字节证据保持成立，但不能由此把整个尾部短读问题收窄为 Linux 特例，更不能据此认为跨平台根因调查已足够。

**共同的架构缺口是：业务把 node-pty 的 `onExit` 当成“生产者输出已完整交付”的证明，而各平台实现并不提供这一无条件保证。** Linux 的 libuv 提前 EOF、Unix 的有限等待强制关闭、Windows 的静默计时强制关闭，是不同的底层机制，不应合并成一个 Linux bug。当前证据也不足以宣称 Windows/macOS 已在真实产品中自然复现。

本轮只新增或完善独立诊断和文档，没有修改 `extensions/`、现有测试、依赖文件或超时。没有选择修复方案。正常结束重开无需历史、Supervisor/机器故障后无需恢复的产品边界不变；它们不能豁免当前页面正常结束时的尾部完整性。

## 平台与证据矩阵

| 路径 | 可确认的机制 | 证据强度 | 尚未证明 |
| --- | --- | --- | --- |
| Linux / libuv 1.51.0 | PTY HUP 加短 read 合成 EOF，fd 仍有输出 | 上一轮真实自然复现、裸 PTY syscall、独立上游确认 | 所有旧失败是否同因、修复后的完整回归 |
| Linux/macOS 共用 node-pty Unix JS | native exit 后最多等 200 ms，之后无条件 destroy，未确认 buffered bytes 或 fd 排空 | Linux 真实 PTY 受控复现；macOS 共用源码与引入背景确认 | macOS 原生触发条件/频率；生产路径不主动 pause，不能把受控条件写成当前自然原因 |
| macOS libuv kqueue / select | 与 Linux 不同的事件映射；不能直接套用同一 HUP 归因 | 固定版本源码核查 | macOS 正常输出/关闭全过程尚无本次原生实测 |
| Windows 默认 builtin ConPTY | native exit 后 1000 ms 无已解码 data 即 destroy；任意 socket close 都可转成 onExit | 已安装 Windows JS 的 7 项受控反例/对照，真实本地 TCP reader 交叉验证 | Windows 原生 ConPTY、worker/pipe 延迟和完整宿主的实际可达性与频率 |
| 公共 bridge / Supervisor | exit 封闭 output admission，只收齐此前已接受操作 | 实际 Supervisor/journal/tracker 的 11 项人工 provider 时序验证 | 不代表任何平台自然产生 exit 后 callback，也不是已确认队列另行丢数据 |

当前环境只有 Linux x64（内核 `5.19.17-saturnv01`）；分别使用 Node `25.6.0` 以及 VS Code `1.117.0` / Electron `39.8.7` 内置 Node `22.22.1`，两者 libuv 都是 `1.51.0`。没有可用的原生 macOS/Windows runner；没有使用平台 mock 冒充这两个操作系统的运行证据。

## Unix：独立于提前 EOF 的强制关闭

node-pty `1.2.0-beta.12` 的 `node_modules/node-pty/lib/unixTerminal.js:65` 在 native process exit 后等待 socket close；第 79 行的 200 ms timeout 会直接 `destroy()`。该路径不验证 `readableLength`、decoder 或 PTY fd 是否已经排空。它源自 [node-pty #163](https://github.com/microsoft/node-pty/issues/163) / [PR #164](https://github.com/microsoft/node-pty/pull/164) 对 macOS 10.13.2 socket 不关闭的 workaround，不是完整性保证。

独立裸 PTY 在第 89800 行附近显式 `pause()` 350 ms，writer 在 PTY 外写 `90001:0` 证明所有 printf 成功。先运行不带 destroy 探测的三轮，再在 destroy 前只观察 Node readable buffer 并补读 fd，不将捕获字节交给正常消费者。所有失败 destroy 栈均来自安装包第 79 行；native exit 后约 200 ms 销毁，没有 socket end，因而不是上一轮已观察到的合成 EOF 路径。

| 环境 / 工件目录（均在 `.debug/`） | 完整行数，按轮次 | destroy 时 JS 缓冲字节 | destroy 时 fd 可读字节 | raw 加两层待交付字节 |
| --- | --- | --- | --- | --- |
| Node 25 / `terminal-tail-cross-platform-timer` | 89801 / 89800 / 89800 | 4774 / 1860 / 806 | 未探测 | 未拼接 |
| Node 25 / `terminal-tail-cross-platform-timer-probe` | 89800 / 89801 / 89801 | 6448 / 1674 / 1426 | 5958 / 10670 / 10918 | 三轮均精确 90000 行 |
| VS Code Node 22 / `terminal-tail-cross-platform-vscode-timer-probe` | 89800 / 89800 / 89800 | 4095 / 1550 / 682 | 8311 / 10856 / 11724 | 三轮均精确 90000 行 |

九轮 receipt 均为 `90001:0`。JS 缓冲和 fd 内都还有数据，证明等待超时关闭不等于排空。暂停是诊断注入；`ExecutionSessionProcess` 当前没有暴露 pause，也未配置 node-pty flow control，因此不能把这些结果冒充未注入的业务自然复现或估算生产概率。上一轮“不是 200 ms timer”仍只适用于那些具体样本，不适用于整个问题类别。

### 为什么不能直接声称 macOS 同因

[libuv v1.51.0 kqueue.c:386](https://github.com/libuv/libuv/blob/v1.51.0/src/unix/kqueue.c#L386) 将 `EV_EOF` 映射为 `UV__POLLRDHUP` 而不是 `POLLHUP`；`internal.h:145` 的 fallback 值是 `0x2000`。同版 `stream.c:219` 的 select fallback 只生成 `POLLIN/POLLOUT`。共享 `stream.c` 不代表两个 macOS backend 会给旧的 HUP EOF 分支输入相同事件，不能把 Linux 提前 EOF 的因果证据直接外推。

Darwin 原生关闭顺序也不同。固定 [XNU xnu-12377.121.6 tty_dev.c:325](https://github.com/apple-oss-distributions/xnu/blob/xnu-12377.121.6/bsd/kern/tty_dev.c#L325) 在 slave close 调 line discipline close；[tty.c:1989](https://github.com/apple-oss-distributions/xnu/blob/xnu-12377.121.6/bsd/kern/tty.c#L1989) 的 blocking 路径经 `ttywflush -> ttywait` 等待输出，非阻塞或失败才可能 flush/drop。本地 node-pty `src/unix/pty.cc:794` 的 macOS slave 使用 blocking `O_RDWR | O_NOCTTY`，只有 master 非阻塞。相同暂停可能先延迟子进程退出，因此不能把 Linux 350 ms 时序写成 macOS 已复现。这是固定源码核查，不代表所有部署中的 XNU 版本；JS 已缓冲输出、后代持有 slave 等仍需原生验证。

## Windows：静默超时不是输出完成

`extensions/vscode/dev-session-canvas/src/panel/executionSessionBridge.ts:127` 只传 `useConpty: true`；安装包将该选项标为 deprecated/ignored，`useConptyDll` 未传入而默认为 false。因而当前 Windows 新建走 builtin ConPTY 分支，不可拿 DLL 分支行为替代它。

调用链可在安装的依赖直接核实：

1. `node_modules/node-pty/src/win/conpty.cc:101` 等待 shell process，不是等待 output worker/pipe 排空。
2. `node_modules/node-pty/lib/windowsPtyAgent.js:188` 收到 native exit，默认分支启动 1000 ms timer；已解码 `data` 会重置 timer。
3. 同文件第 206 行的 `_cleanUpProcess()` 直接销毁 outSocket，不验证 EOF、buffer 或 decoder 完成。
4. `node_modules/node-pty/lib/windowsTerminal.js:99` 对 socket close 直接 emit exit，未区分正常 EOF 和强制 destroy。exitCode 仍可为 0。

`scripts/diagnostics/diagnose-windows-pty-exit-contract.mjs` 加载实际安装包的 Windows JS，只把 native API、clock 和 transport 注入夹具。7 个确定性场景在 Node 25 与实际 VS Code Node 22 均完成自校验：

- 自然 EOF、999 ms 内 data 重置 timer、正常跨 chunk UTF-8 均完整。
- native exit 后 1001 ms 才交付 tail 时，1000 ms 已销毁 socket 并发出 onExit(0)，尾部无法交付。
- 已缓冲 `TAIL\n` 但暂停消费，仍因超时关闭，只有 `HEAD\n`，没有 end。
- UTF-8 两字节残片未构成字符时不触发已解码 data，不能重置 timer；随后超时会丢弃残片。这不证明普通正常分片解码有 bug。
- `useConptyDll: true` 不走该 native-exit timer；这只区分分支，不证明切换 DLL 就解决所有退出问题。

另用真实 Linux TCP socket 替代 fake stream，直接调用实际 `WindowsPtyAgent.prototype._$onProcessExit`：reader 内已有 5 字符，仍约 1 秒后 destroyed，只有 `HEAD\n`、没有 end。该实验排除了“只是假 stream 的销毁语义”的解释，但它不是 Windows named pipe/ConPTY 或真实 Host 测试。JSON 工件为 `.debug/terminal-tail-cross-platform-windows-contract.json` 与 `.debug/terminal-tail-cross-platform-vscode-windows-contract.json`，包含环境、源文件 SHA256、事件轨迹。

stop/kill 还有独立的 worker 清理边界：`windowsPtyAgent.js:130` 和 `windowsConoutConnection.js:103` 的 dispose 路径用固定 1000 ms 后 `worker.terminate()`，不是等待输出 EOF。本轮只静态核查此路径，不把它混为自然退出样本原因，也不证明其原生行为已经验证。

## 公共链路：契约缺口，而非队列已证明丢数据

`executionSessionBridge.ts:34` 注释声称 exit 时全部 data 已排空，而 `onData()` / `onExit()` 仅直接转发 provider 事件。node-pty 自身 typings 对 `onExit` 只说明 pty exits，没有声明无条件完整交付。Supervisor 在 `runtimeSupervisorMain.ts:1149` 的退出回调同步关闭 `terminalMutationAdmissionOpen`，随后任何新 data 在第 1079 行被拒绝。finalization 仅收敛退出前已接受的操作。

`scripts/diagnostics/diagnose-runtime-exit-admission.mjs` 使用实际 Supervisor/journal/tracker 和人工 provider，在两种 Node 环境各执行 11 个场景：Agent、Terminal 的退出前已入队数据都能收齐；exit 后同步/异步 data 在监听尚存在时被 admission guard 拒绝；finalize 后监听被移除。stop 本身仍接收输出，Terminal kill、Claude kill、Codex graceful input 三种请求都保留 stop 后、exit 前的输出。显式 delete 则取消监听但排空此前已接受操作，是有意取消语义，不列为自然退出缺陷。

这些反例刻画当前业务依赖，不证明实际 node-pty 会自然发出 exit 后 data，也不支持简单删除 admission guard。前两类底层问题是数据根本未交付，即使放开 guard 也不能找回被销毁的数据。当前证据未发现队列另行丢失退出前已接受输出。

相同风险还存在于 snapshot-only Host：`CanvasPanelManager.ts:14990` 的 Agent exit 进入 finalize 后在第 14899 行取消输出监听；Terminal 在第 16165 行进入 finalize，第 16098 行取消监听。因此契约评估不能只覆盖 Runtime Persistence 或仅修 Supervisor。

现有 `scripts/test/test-runtime-paged-completion.mjs:91` 直接 append 后 finalize，没有覆盖 provider 事件时序；协议测试的正常小段 marker 也不能证明跨平台排空。诊断场景是新证据，不改变原测试和完整性要求。

## 上游核实与修复边界

[libuv #4992](https://github.com/libuv/libuv/issues/4992) 及其 [4095 字节复现记录](https://github.com/libuv/libuv/issues/4992#issuecomment-3751876234) 与上一轮本地 Linux 证据独立吻合。已合并 [#4997](https://github.com/libuv/libuv/pull/4997)，commit `2e2114ed8957a0124bc629c61d034c387b8ce42a`，在 v1.52.0 / v1.52.1 将条件改成 `HUP && !POLLIN`。但后续 [#5165](https://github.com/libuv/libuv/pull/5165)，commit `87493602c13c91e48322ea69bd040d29e3fa07f9`，再次修复只有 HUP 仍可能有数据的 TTY 分支；该代码不在已核对的 v1.52.0 / v1.52.1 tag。不能声称升级到 1.52.1 就收口所有机制，且 VS Code/Electron 自带 libuv 不由本项目 npm lockfile 单独控制。

正式修复尚未选定。需要分别验证进程结束、源输出真正结束、正常排空/超时截断/取消/错误的语义，再决定由 adapter 聚合为可信退出事件还是扩展上层协议。仅新增 `output-ended` 通知、加长 timer、移除 admission guard、把 Linux 私有 fd 补读移植到 Windows，都不能凭名称或等待时长证明完整性。上游读取修正也不会自动消除 node-pty 两个平台的强制关闭分支。

## 后续原生验收

Windows 和 macOS 的尾部丢失不能因为未实测就排除，也不能因为夹具失败就宣称自然复现。下一阶段必须在对应原生 runner 运行同一契约矩阵，至少覆盖自然退出、慢消费、Unicode 尾片、stop、delete 与主进程先退出但后代持有输出；同时分别验证 Node 与实际 VS Code/Electron 的 Agent/Terminal、Runtime 和 snapshot-only。Windows 需要记录 builtin/DLL 选择、worker 到主 reader 的交付及关闭原因；macOS 需要记录 child exit 与 slave/master 排空顺序，不预设与 Linux 相同。

每个样本同时保留独立 writer 完成凭证、原始回调、bridge、journal/分页、实际 xterm、native exit、end、destroy 原因和缓冲水位。对 ASCII 编号流逐行核对，对 Windows ConPTY 的 VT 转换还需终端语义对照，不能只要求原始字节等同于 POSIX PTY。不得只凭 final revision、socket close、exit code 0 或一次压力通过升级为“无损已验证”。这些原生验证尚未执行，继续登记为开放技术债。

## 复现与证据保存

在仓库根依赖已安装的 Linux 环境运行。输出目录须不存在；重跑改名，避免覆盖旧现场。前两个脚本的 exit 0 表示当前契约特征与自校验一致，包含预期丢失反例，不是产品完整性通过；Linux 工具也须检查 `raw.complete`、`destroyProbe.rawPlusPending.complete` 和 receipt。

```bash
node scripts/diagnostics/diagnose-windows-pty-exit-contract.mjs
node scripts/diagnostics/diagnose-runtime-exit-admission.mjs
node scripts/diagnostics/diagnose-runtime-terminal-tail.mjs --mode bare --runs 3 --pause-near-exit-ms 350 --writer-receipt --probe-before-destroy --output .debug/cross-platform-timer-recheck
env ELECTRON_RUN_AS_NODE=1 .vscode-test/vscode-linux-x64-1.117.0/code scripts/diagnostics/diagnose-windows-pty-exit-contract.mjs
env ELECTRON_RUN_AS_NODE=1 .vscode-test/vscode-linux-x64-1.117.0/code scripts/diagnostics/diagnose-runtime-exit-admission.mjs
```

`--probe-before-destroy` 只用于固定 ASCII 流的诊断：读取 `readableBuffer` 但不调用会触发业务 data 的 `socket.read()`，再有界读取 fd；记录 `buffered-at-destroy.txt` / `residual-at-destroy.txt`。它不是生产补读方案，不能当作 Unicode decoder 的无损快照。本轮完成脚本语法、自校验、两 Node 版本对照；未运行完整 UI/packaged smoke 或原生其他 OS。

固定源码下载位于 `.debug/terminal-tail-cross-platform-unix/`，关键指纹：kqueue v1.51.0 SHA256 `499e0de21ff7ef39978186ef10af6070ad3e1e8e2dc71532cf6f398f38d7827a`；stream v1.52.0/v1.52.1 `736cd948a28acdb1544dd683becd78fb744e79de55562229da54923b20f41c7c`；#5165 固定 commit stream `5d31bafac87bad822ed853ec98dd1c73dbbb9f8151d1337097e3f2a85c0b26f7`。本地安装版本 UnixTerminal 为 `c3bb8dfceb9f99a5d7003041c0aff243eaa60f062538c88fc452c59ae516e74c`；Windows 夹具 JSON 单独记录已执行 JS 文件的指纹。
