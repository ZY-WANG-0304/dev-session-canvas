---
title: Runtime Terminal 退出尾部短读定位
decision_status: 比较中
validation_status: 验证中
domains:
  - 执行编排域
architecture_layers:
  - 宿主集成层
  - 适配与基础设施层
related_specs:
  - docs/product-specs/runtime-persistence-modes.md
related_plans:
  - docs/exec-plans/completed/runtime-terminal-tail-diagnosis.md
updated_at: 2026-09-20
---

# Runtime Terminal 退出尾部短读定位

2026-09-20 跨平台复核：本文保留上一轮 Linux 捕获样本的具体根因，不代表问题只发生在 Linux。后续 `docs/design-docs/runtime-terminal-cross-platform-diagnosis.md` 已补充 Unix 200 ms 强制关闭的真实受控复现、Windows 默认 ConPTY 静默超时的实际 JS 反例，以及公共 onExit 契约缺口；macOS/Windows 原生验收仍未执行，不能仅修 Linux EOF 就关闭整个问题。

## 问题与范围

严格 90000 行 Terminal 退出用例间歇性缺少尾部，即使 Webview 已追到 `final revision`。本轮承接 `f46fea99`，按用户要求只做定位：增加独立诊断脚本和文档，不修改业务源码、依赖、默认超时或 smoke 断言，不实施修复。

正常结束后重新打开不需要恢复进程或历史，但原页面仍应收齐进程产生的输出。这里调查的是正常退出的当前页面完整性，不是跨 Supervisor 崩溃或机器重启的数据恢复。Agent 与 Terminal 共享 PTY bridge，但本轮负载是 Bash Terminal，没有执行真实 Agent provider。

## 当前结论

**本轮捕获的失败已定位到 Linux 上 Node/libuv 的 PTY 读取层过早报告 EOF。** `node-pty` 的原始 `onData` 已经缺少尾部；相同样本的 bridge 转发、Supervisor journal 和分页正文与原始回调逐字节一致，headless xterm 呈现相同缺失。在 socket `end` 时，同一 PTY master fd 仍可读出剩余字节，拼接后全部恢复为内容、编号均正确的 90000 行。

固定版本 libuv 源码和系统调用跟踪解释了机制：`POLLHUP` 表示对端挂断，但不保证缓冲为空；libuv 把“小于本次申请 buffer 的成功 read”标记为 `READ_PARTIAL`，随后在 `POLLHUP + READ_PARTIAL` 时合成 EOF。Linux PTY 本次只返回 4095 字节而 fd 仍有数据，满足了错误的提前结束条件。

这不是本轮样本中的 Supervisor 提前关闭 mutation admission、journal/分页丢事件或 xterm 少消费，也不是 node-pty 的 200 ms 退出强制销毁 timer。没有把该结论外推为所有旧失败的唯一根因，未据此关闭完整性技术债。`比较中 / 验证中` 表示修复方案尚未选定、产品无损验收尚未完成，不表示已捕获机制仍只有猜测。

## 采集方式

`scripts/diagnostics/diagnose-runtime-terminal-tail.mjs` 在独立进程中临时包装 `node-pty.spawn`、native exit 和 socket 生命周期，不改写依赖文件。`bare` 模式只运行 node-pty；`supervisor` 模式通过 TypeScript AST 导出并在内存 bundle 实际 `RuntimeSupervisorServer`，使用真实 bridge、journal、tracker 和分页方法。夹具只替换连接为收集终态的 EventEmitter socket，并关闭 fixture 的 idle process exit。

每轮固定 Bash `--noprofile --norc -i`、96x28、100000 scrollback，输出与 smoke 相同的 90000 个编号 marker 后立即 exit。记录原始回调、转发、journal、分页、headless xterm、exit/destroy 时间与栈。分页 reader 在输出前打开，记录 checkpoint revision；本文 Supervisor 样本均为 revision 0，因而可直接比较整段 journal 与分页正文。这不是完整 Extension Host/Webview smoke。

默认不注入延迟。`--writer-receipt` 额外逐次检查 Bash printf 返回值，并在 PTY 外写入 `90001:0`，证明循环完成且没有 printf 报错。`--probe-after-end` 只在 socket `end` 时用 `fs.readSync` 读取仍存活的 fd，最多 256 次、每次 64 KiB；读取结果只保存为证据，不转交业务消费者。它会消费内核缓冲，所以必须与不带 probe 的自然样本对照，不能称为无扰动观测。

`--pause-near-exit-ms 50` 在看见第 89800 行时暂停 node-pty 读取 50 ms，再恢复，让挂断时更容易有积压。这是明确标注的受控条件，不是生产故障频率测量。`--data-delay-ms 1` 是另一独立的回调延迟对照，未在自然组使用。

## 分层证据

环境为 Linux x64、内核 `5.19.17-saturnv01`、node-pty `1.2.0-beta.12`。普通命令使用 Node `25.6.0` / libuv `1.51.0`；另用缓存 VS Code `1.117.0` 的 Electron `39.8.7` 可执行文件验证其内置 Node `22.22.1` / libuv `1.51.0`。二者分开报告，不假设原 smoke 一定使用 shell 的 Node 25。

下表目录均位于 `.debug/`，未缺失轮次均为 90000 行。计数来自实际完整编号和固定正文，不能只以 revision 相等代替。

| 目录 | 模式与条件 | 轮次 / 短读次数 | 短读轮次的完整行数 | EOF 后残留字节 |
| --- | --- | --- | --- | --- |
| `terminal-tail-bare-baseline` | Node 25 裸 PTY，无延迟 | 3 / 0 | 无 | 未探测 |
| `terminal-tail-supervisor-baseline` | Node 25 实际 Supervisor，无延迟 | 3 / 0 | 无 | 未探测 |
| `terminal-tail-bare-slow` | Node 25 裸 PTY，每回调延迟 1 ms、receipt | 3 / 0 | 无 | 未探测 |
| `terminal-tail-supervisor-repeat` | Node 25 实际 Supervisor，无延迟、无 receipt/probe | 10 / 3 | 第 1/6/9 轮：89825 / 89976 / 89926 | 未探测 |
| `terminal-tail-supervisor-eof-probe` | Node 25 实际 Supervisor，无延迟、receipt/probe | 10 / 3 | 第 1/5/7 轮：89995 / 89964 / 89996 | 313 / 2235 / 251 |
| `terminal-tail-bare-hup` | Node 25 裸 PTY，暂停 50 ms、receipt/probe | 3 / 2 | 第 2/3 轮：89892 / 89882 | 6699 / 7319 |
| `terminal-tail-bare-strace` | Node 25 裸 PTY，暂停 50 ms、receipt/probe、strace | 3 / 3 | 89892 / 89884 / 89883 | 6699 / 7195 / 7257 |
| `terminal-tail-vscode-node-eof-probe` | VS Code 内置 Node 22，实际 Supervisor，无延迟、receipt/probe | 5 / 0 | 无 | 0 |
| `terminal-tail-vscode-node-hup` | VS Code 内置 Node 22，裸 PTY，暂停 50 ms、receipt/probe | 3 / 3 | 89932 / 89881 / 89876 | 4216 / 7381 / 7691 |

所有开启 receipt 的轮次均为 `90001:0`；所有探测轮次的 raw 加 residual 均得到精确 90000 行。所有 Supervisor 轮次的 raw、forwarded、journal、page 正文 SHA256 相等，xterm 编号内容与源一致。Node 22 五次无延迟未复现不能证明无问题，其受控组已经证明同类 EOF 后仍有可读数据。

首轮 bare baseline 的旧 summary 报 89999 是诊断器初版以行首匹配漏掉 readline 控制序列后的第 1 行；原始文件保留，用修正后的分析器重算三轮均为 90000。工具新增自校验覆盖控制序列、echo 命令、末行截断、缺行、重复及乱序；不把这三次计数错误混入产品失败样本。

### 自然失败的同源对照

`terminal-tail-supervisor-eof-probe/run-1/` 的 raw、bridge、journal、page 均为 5580034 字节，SHA256 均为 `7c96a6ee70a7d24a02acf552a229aea70fb5f7c7653b99dea9241a9ffc2cb43a`，只包含 89995 行，journal/page 的 revision 均为 12912。事件顺序为相对于创建 PTY 的毫秒数：

```text
2682.928  socket-end
2682.983  diagnostic post-end read = 313 bytes
2683.053  diagnostic next read = EIO
2683.922  socket-destroy, writable finish stack
2684.407  native-exit, code=0
2684.807  socket-close
2685.051  node-pty onExit
```

过早 EOF 发生在 native exit 回调之前，退出 timer 当时尚未开始；补读也不是等待 200 ms 后的补偿。拼接 313 字节后为 5580347 字节、精确 90000 行。原业务消费者仍只收到 89995 行，诊断没有修复运行结果。

不带 probe 的 `terminal-tail-supervisor-repeat/run-1/` 同样在 raw 层仅 89825 行，四层 SHA256 为 `04ad740ec3e1cc2eb844e720a03805037924f2f96ec8b4a29a94f3ed2b2b1d41`。native exit 后约 29 ms 就进入 socket end，destroy 栈来自正常 writable finish，也不是 200 ms timeout。

### 系统调用与依赖路径

`terminal-tail-bare-syscalls.log` 第 91437 行起的关键片段如下。第二、三次 read 由 JS socket end 内的诊断 probe 发出，与该轮 `trace.json` 的 post-end-read 字节对齐；此前没有 read 返回 0/EIO：

```text
epoll_pwait(... EPOLLIN|EPOLLHUP, fd=20 ...) = 1
read(20</dev/ptmx>, ..., 65536) = 4095  # libuv 最后一次正常读取
read(20</dev/ptmx>, ..., 65536) = 4095  # socket end 后的诊断补读
read(20</dev/ptmx>, ..., 65536) = 2604  # socket end 后的诊断补读
read(20</dev/ptmx>, ..., 65536) = -1 EIO
```

与本机版本对应的固定上游源码：

- [libuv v1.51.0 stream.c](https://github.com/libuv/libuv/blob/v1.51.0/src/unix/stream.c#L1151)：短 read 标记 `UV_HANDLE_READ_PARTIAL` 后返回；第 1213 行后的 `POLLHUP` 分支调用 `uv__stream_eof`。
- [Node v25.6.0 内置 stream.c](https://github.com/nodejs/node/blob/v25.6.0/deps/uv/src/unix/stream.c#L1213) 与 [Node v22.22.1 内置 stream.c](https://github.com/nodejs/node/blob/v22.22.1/deps/uv/src/unix/stream.c#L1213) 相同；三份下载内容 SHA256 均为 `dac76e73caef1d01c7122f5d42f5e2d0a06b6a60bf4d83d26849d03aec805733`。Electron 行为另由其实际二进制验证，不仅依据上游 Node tag 推测。
- 本地 `node_modules/node-pty/lib/unixTerminal.js:93` 使用 `new tty.ReadStream(term.fd)`；第 65 行的 native exit handler 等待 socket close，并在第 79 行提供 200 ms fallback destroy。`src/unix/pty.cc:209` 的 waitpid 后通知 JS 是进程退出通知，不是 master fd 已排空的证明。
- `extensions/vscode/dev-session-canvas/src/panel/executionSessionBridge.ts:33` 的现有注释把 stream close 和 data events drained 作为退出契约；本轮证明“已经产生的 JS 回调排空”不等于“进程已写入的 PTY 字节全部交付”。本轮保留源码原样，在设计中登记该契约缺口。

## 尚未证明与修复候选

旧 smoke 的 89969/90000 等现场没有同步原始 PTY 和 fd 观测，只能说明症状一致，不能追认全部旧样本同因。没有验证 Windows/ConPTY、macOS、Remote SSH、真实 Agent provider、Unicode 跨 chunk、descendant 持有 slave、stop/delete 并发。本轮没有重新运行完整 VS Code UI 或 packaged smoke，也没有证明 journal/Host/Webview 在其他条件下绝无缺陷。

修复方向仍需单独决策：优先核实上游 Node/libuv 的读取修正或有明确 EOF 契约的 PTY 实现，再比较仓库 Unix adapter 的有限兼容处理。不能未经验证就声称升级某版本能修复，更不能把诊断用私有 `_fd` 和同步 read 循环直接放进生产。生产方案必须处理非阻塞 EAGAIN/EIO、解码尾片、关闭/取消、子进程持有 slave、跨平台及事件循环预算，并避免两个 reader 竞争同一 fd。

仅增加 Supervisor finalization 等待或放宽 node-pty 的 200 ms timer，不能纠正本轮已合成 EOF 并走正常销毁的读取路径；下游追到 final revision 同样不能补回从未进入 journal 的字节。未来修复须保留严格 90000 行断言，在依赖层先证明正确读到真实终止条件，再补共享 Agent/Terminal、真实宿主和 packaged 场景，不能以复跑通过关闭风险。

## 复现与复核

在仓库根、依赖已安装且 node-pty 原生模块适配当前可执行文件的 Linux 环境运行。每次使用不存在的新输出目录，避免覆盖证据；默认每轮 90 秒触发诊断 kill，命中该事件的结果不能当作自然退出证据。exit code 0 仅表示采集完成，须检查 `raw.complete`、`outcome`、各层相等、receipt、residual 和 trace。自然组不保证每次复现；不得只保留成功轮次。

```bash
node --check scripts/diagnostics/diagnose-runtime-terminal-tail.mjs
node scripts/diagnostics/diagnose-runtime-terminal-tail.mjs --self-test
node scripts/diagnostics/diagnose-runtime-terminal-tail.mjs --mode supervisor --runs 10 --output .debug/tail-recheck-natural
node scripts/diagnostics/diagnose-runtime-terminal-tail.mjs --mode supervisor --runs 10 --writer-receipt --probe-after-end --output .debug/tail-recheck-probe
strace -f -ttt -yy -s 120 -e trace=read,epoll_wait,epoll_pwait -o .debug/tail-recheck-syscalls.log node scripts/diagnostics/diagnose-runtime-terminal-tail.mjs --mode bare --runs 3 --pause-near-exit-ms 50 --writer-receipt --probe-after-end --output .debug/tail-recheck-strace
env ELECTRON_RUN_AS_NODE=1 .vscode-test/vscode-linux-x64-1.117.0/code scripts/diagnostics/diagnose-runtime-terminal-tail.mjs --mode bare --runs 3 --pause-near-exit-ms 50 --writer-receipt --probe-after-end --output .debug/tail-recheck-vscode-node
```

工件按轮次保存 `raw.txt`、`trace.json`、`summary.json`、可选 `post-end-residual.txt` / `writer-receipt.txt`；Supervisor 另保存 journal 文件、`journal-output.txt`、`pages.json`、`final.json` 和 `xterm.txt`。它们含固定测试负载而非用户会话，不入库；关键数据和来源指纹已摘录于本文，以免本地 `.debug/` 不存在时结论只剩路径。
