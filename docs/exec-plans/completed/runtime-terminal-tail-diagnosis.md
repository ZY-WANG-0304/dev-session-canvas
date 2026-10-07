# 定位 Runtime 大输出退出时的尾部短读

本 ExecPlan 按 `docs/PLANS.md` 维护。承接 `f46fea99`，用户仅要求问题定位，不允许直接修改业务代码。本轮只增加独立诊断工具和调查记录，不修改 `extensions/` 业务源码、运行时依赖、默认超时或 smoke 完整性断言，不推送整体迭代分支。

## 目标与全局图景

解释为何严格 90000 行 Terminal 正常退出后会间歇性少尾部。把子进程已写出的数据、node-pty 的原始回调、bridge 转发、Supervisor journal 最终记录、分页响应和终端消费逐层比较，找到第一个已证明缺失的位置。结果是可复现命令、证据和修复候选边界，不是未经确认的业务修复。正常结束重开不保留历史的需求不变，当前页面仍需收齐已产生的输出。

## 进度

- [x] (2026-09-18) 确认起点干净、HEAD `f46fea99`，复读工作流和既有失败记录，明确只做定位。
- [x] (2026-09-18) 核实历史样本、node-pty 与 libuv 退出路径；自然失败排除 200 ms timer，提出 HUP 加 partial read 过早 EOF 假设。
- [x] (2026-09-18) 建立独立分层采集，裸 PTY 与实际 Supervisor 各三次完整；实际 Supervisor 十轮自然复现三次，原始回调已经短读，下游正文完全一致。
- [x] (2026-09-18) 无延迟实际 Supervisor 十轮 EOF 探测三次复现，残留拼接均恢复完整；裸 PTY syscall 证据定位 HUP/partial read 合成 EOF。
- [x] (2026-09-18) VS Code 内置 Node 22 五次无延迟完整、三次暂停读取均复现，明确区别自然与受控条件。
- [x] (2026-09-18) 同步定位报告、设计契约缺口、索引和开放技术债；仅诊断已完成，归档计划，业务修复另行规划。
- [x] (2026-09-18) 脚本语法/分析器自校验通过，重算 43 份既有 raw，最终脚本另跑一次实际 Supervisor 完整；业务、测试、manifest 与 lockfile diff 为空。
- [x] (2026-09-18) 新增引用、frontmatter/索引与暂存范围核对通过；本批按工作流本地提交，不推送。

## 意外与发现

已知失败：第四阶段某次末页 revision/head 为 11628，正文只到第 89850 行及半个 marker；第五阶段某次实际 xterm 为 89969/90000，末页发送 revision/head 为 12654，但 finally 覆盖了正文。成功复跑不能证明缺失层。旧现场分别位于 `.debug/runtime-completed-90000-first-failure/` 和 `.debug/runtime-paged-completion-short-read-failure/`。

当前依赖 node-pty `1.2.0-beta.12` 的 `lib/unixTerminal.js` 在原生进程退出后等待 socket close，并设置 200 ms 的强制 destroy。这与 `executionSessionBridge.ts` 对“退出前数据全部排空”的注释存在需要验证的边界；静态路径本身不证明本次失败由该 timer 触发。

首轮裸 PTY 三次原始数据均包含第 90000 行。诊断工具最初用行首匹配，readline 在第一行前输出 bracketed-paste 控制序列导致漏计第 1 行；改为匹配完整编号 marker 并校验逐个编号。该 89999 计数是本轮诊断解析问题，不是产品短读。原始数据和初始结果均保留。

十轮实际 Supervisor 的第 1/6/9 轮原始数据分别仅 89825/89976/89926 行，raw、bridge、journal 与 page SHA256 相同，headless xterm 也是相同行数。第 1 轮原生退出后约 29 ms 就出现 socket end，非 200 ms timer destroy；该组未注入延迟，最后命令与 smoke 的输出循环一致。数据在进入业务 journal 前已经缺失，但不能只据此区分内核与 Node 读取行为。

从固定 tag 下载的 libuv `v1.51.0/src/unix/stream.c` 显示 `POLLHUP + READ_PARTIAL` 可在实际 read 未返回 EOF 时合成 EOF；本机 Node `25.6.0` 使用 libuv `1.51.0`。新增显式诊断开关，在 socket end 回调直接读取尚未关闭的 fd，仅读出证据不转交业务消费者，以验证 EOF 后是否仍有内核缓冲。

后续未注入延迟的 EOF 探测第 1 轮原始仅 89995 行，socket end 发生时从同一 fd 仍读出 313 字节，拼接后编号和内容完整为 90000/90000；writer receipt 为 `90001:0`，表示循环全部结束且没有 printf 错误。探测先于 native-exit，证明该例既非 200 ms timer，也非业务提前 finalize。证据目录 `.debug/terminal-tail-supervisor-eof-probe/run-1/`。继续用裸 PTY 的短暂停读安排退出时仍有待消费数据，以获得更小且稳定的对照和系统调用证据。

完整 EOF 探测十轮第 1/5/7 轮分别 89995/89964/89996 行，残留 313/2235/251 字节；所有轮次 receipt 均为 `90001:0`，raw 加残留均完整。裸 PTY 暂停 50 ms 的 strace 三轮均缺尾，补读 6699/7195/7257 字节后均完整。第 1 轮 syscall 为 HUP 后 read 4095，socket end 后 probe 再读 4095 + 2604，最后 EIO；第一个 read 没有排空 fd。

原 smoke 默认由 VS Code 的 process.execPath 启动 Node，不能直接用本机 shell Node 25 代表。缓存 VS Code 1.117.0 内置 Node 22.22.1 / libuv 1.51.0：实际 Supervisor 五轮无延迟完整，但裸 PTY 暂停 50 ms 三轮为 89932/89881/89876 行，残留 4216/7381/7691 字节，拼接均完整。机制跨这两种二进制成立，不等于已测 macOS/Windows 或全部真实宿主场景。

## 决策记录

- 决策：以独立脚本加载实际类并只在诊断进程包裹观察点，不改业务源码或 node_modules。理由：满足用户边界，避免用修复改变复现条件。日期/作者：2026-09-18 / Codex。
- 决策：先比较原始回调、journal 和分页的字节及逐行结果，再判断是否需要真实 Webview 观测。理由：最终 revision 只能证明序号连续，不能证明源进程全部输出已经入流。日期/作者：2026-09-18 / Codex。
- 决策：在完成无延迟样本后，用显式 EOF probe 和暂停读取的裸 PTY 获取因果证据。理由：源层已经短读，不需要先改 Webview 观测；probe 只留证据、不补给消费者，并以系统调用确认 EOF 时仍有可读数据。日期/作者：2026-09-18 / Codex。
- 决策：不修改退出 timer，不把私有 fd 补读升级成生产修复，诊断计划完成后归档而修复债务保持开放。理由：本轮已排除捕获样本的 timer 原因，修复必须重新评估 EOF、解码、取消、跨平台和事件循环契约。日期/作者：2026-09-18 / Codex。

## 结果与复盘

定位目标已完成：本轮自然失败的第一个缺失层为 Node PTY 原始回调，捕获样本的 HUP/partial read 过早 EOF 由残留字节、独立 writer receipt 和裸 PTY syscall 对照确认；下游内容相等，未见第二处损失。退出 callback 排空与生产者全部字节已入流不是同一保证。详细轮次、固定上游源码与 SHA256 摘录在 `docs/design-docs/runtime-terminal-tail-diagnosis.md`，即使本地大工件不可用也可复核结论。

只交付独立脚本和文档，不改变业务行为。旧 smoke 缺少 raw/fd 证据，未追认所有历史同因；未跑完整 UI/packaged suite、真实 Agent、非 Linux 或 Remote。修复、跨平台矩阵和产品完整性验收继续登记在 `docs/exec-plans/tech-debt-tracker.md`，既有无损方案保持“验证中”。本地提交是诊断收口，不是完成运行时改造。

## 上下文与定向

`extensions/vscode/dev-session-canvas/src/panel/executionSessionBridge.ts` 封装 node-pty 的 `onData/onExit`。`src/supervisor/runtimeSupervisorMain.ts` 的 `bindSessionProcess()` 将数据加入每会话串行队列，`finalizeSession()` 关闭新增 mutation 并发布终态。`src/supervisor/terminalSessionJournal.ts` 保存带 revision 的事件；revision 是已接收事件的序号，不是子进程预期字节数。`src/webview/terminalPagedProjection.ts` 在每页写入完成后继续读取，收齐 final revision 后展示退出。

实际严格测试为 `tests/vscode-smoke/extension-tests.cjs` 的 `verifyCompletedLiveRuntimeDiscardsHistoryAfterDrain()`：Bash printf 90000 行，每行带编号和固定正文后立即 exit，scrollback 100000；实际 xterm 逐行比较，不依赖小消息环拼完整历史。前一阶段已补清理前失败目录。

## 工作计划

### 里程碑一：整理既有现场与退出语义

读取保存的消息正文、诊断事件及本地 node-pty JavaScript/native 源码，记录能确认的最后 revision、最后完整行、事件顺序和证据缺口。核实测试真实 shell 参数与输出格式，不通过降低行数、增大等待或取消断言制造通过。

### 里程碑二：分层对照诊断

在 `scripts/diagnostics/` 新建有界、可重复工具。沿用仓库 AST 导出实际 Supervisor 方法的测试方式，使用真实 bridge、journal 与 PTY；诊断包装在独立进程记录原生退出、socket destroy/error/close、原始 onData 和业务转发统计。裸 node-pty 与 Supervisor 使用相同 90000 行负载，比较完整文本摘要和字节，按轮次存放到新的 `.debug/` 目录。禁止接触用户会话或覆写已有现场。

### 里程碑三：验证定位与记录边界

若上游先短读，则用不含 Supervisor/Webview 的最小实验验证触发条件，并明确自然复现与故障注入的区别。若原始输出完整而 journal 或分页缺失，则进一步包裹该边界定位；必要时在独立构建工件/测试夹具中增加真实宿主观测，不改源文件。最终记录已证明因果、仍待确认条件和修复候选，不提交业务行为变更。

## 具体步骤

在仓库根、Linux、依赖已安装且 node-pty 原生模块适配运行二进制的环境执行。自然实验使用 Node 25.6.0，已执行的关键命令如下；重试时给 output 和 strace 日志改名，不覆盖已有证据。

    node scripts/diagnostics/diagnose-runtime-terminal-tail.mjs --mode supervisor --runs 10 --output .debug/terminal-tail-supervisor-repeat
    node scripts/diagnostics/diagnose-runtime-terminal-tail.mjs --mode supervisor --runs 10 --writer-receipt --probe-after-end --output .debug/terminal-tail-supervisor-eof-probe
    strace -f -ttt -yy -s 120 -e trace=read,epoll_wait,epoll_pwait -o .debug/terminal-tail-bare-syscalls.log node scripts/diagnostics/diagnose-runtime-terminal-tail.mjs --mode bare --runs 3 --pause-near-exit-ms 50 --writer-receipt --probe-after-end --output .debug/terminal-tail-bare-strace
    env ELECTRON_RUN_AS_NODE=1 .vscode-test/vscode-linux-x64-1.117.0/code scripts/diagnostics/diagnose-runtime-terminal-tail.mjs --mode supervisor --runs 5 --writer-receipt --probe-after-end --output .debug/terminal-tail-vscode-node-eof-probe
    env ELECTRON_RUN_AS_NODE=1 .vscode-test/vscode-linux-x64-1.117.0/code scripts/diagnostics/diagnose-runtime-terminal-tail.mjs --mode bare --runs 3 --pause-near-exit-ms 50 --writer-receipt --probe-after-end --output .debug/terminal-tail-vscode-node-hup

每轮保留 raw、trace 和 summary，Supervisor 组另有实际 journal、分页元数据、终态和 headless xterm；探测组保留 residual 与 writer receipt。检查 `raw.complete`、四层 SHA256、`rawPlusResidual.complete` 与具体 EOF/native-exit/destroy 顺序，不能用命令退出 0 声称产品通过。最终脚本还显式记录 `outcome`。每轮 90 秒触发诊断 kill，命中该事件不计为自然退出复现。

## 验证与验收

调查结论必须由同一样本各层的字节/编号对照支持；源写入完成最好有独立文件或退出状态证明，不能把 shell echo 的命令文本当作行 marker。确认 journal 与分页连续并不替代源完整性。只验证了 Linux 时明确平台边界；若只能确认机制而未自然复现，要如实表述。完成时 `git diff -- extensions/` 必须为空，工具语法检查及定向自校验通过，既有失败保留。

实际验证：`node --check scripts/diagnostics/diagnose-runtime-terminal-tail.mjs` 和同脚本 `--self-test` 通过。用 TypeScript AST 提取当前 `inspect()` 重算九组共 43 个原始样本，校验原 SHA256 和所有 residual 拼接；首组三份从错误的 89999 修正为 90000，未覆写原始结果。最终脚本再跑一轮实际 Supervisor，输出目录含单引号以覆盖 Bash receipt 路径引用：90000 行、四层一致、receipt 正常、无 residual，结果在 `.debug/terminal-tail-final-tool-check's/`。总计 44 轮，保留所有失败，不将通过次数当作修复证据。

收口检查：重复指定既有 output 时脚本拒绝运行且原 summary 字节不变；YAML 解析、设计索引状态、8 个新增本地引用和 staged diff check 通过。暂存仅包含 7 份文档及 1 个独立诊断脚本，没有业务、既有测试或依赖变更。

## 幂等性与恢复

每轮使用临时目录和唯一 session，正常/异常均回收本轮创建的进程与文件句柄。不修改用户 storage、运行服务、依赖或 shell 配置。诊断工件只含固定测试文本，保留关键失败数据供复查。任何实验性参数仅在诊断进程生效，不进入默认业务行为。

## 证据与备注

起点：`f46fea99 refactor(runtime): 将退出收尾延续为 Supervisor 分页`，工作区干净。此前严格用例已有多次通过和多次尾部缺失；本轮不能将复跑通过当作问题不存在。

自然探测第 1 轮关键证据：raw/journal/page 均为 5580034 字节、89995 行、revision 12912，SHA256 为 `7c96a6ee70a7d24a02acf552a229aea70fb5f7c7653b99dea9241a9ffc2cb43a`。socket end 在 2682.928 ms，探测读 313 字节在 2682.983 ms，native exit 在 2684.407 ms；拼接为完整 90000 行。固定 libuv v1.51.0、Node v25.6.0/v22.22.1 的 stream.c 三份内容同为 `dac76e73caef1d01c7122f5d42f5e2d0a06b6a60bf4d83d26849d03aec805733`。

## 接口与依赖

不增加依赖。复用 `node-pty`、Node 标准 API、`esbuild`、TypeScript AST 和实际 Supervisor/journal 类；若需终端解析，使用仓库已有 xterm。所有包装只用于观察或显式标注的受控实验，不改变业务接口。

修订记录：2026-09-18 创建定位阶段计划，明确不修改业务代码、先采集分层证据再形成结论。

修订记录：2026-09-18 完成自然与受控诊断、VS Code 内置 Node 对照和 syscall/source 复核；归档诊断计划，保留业务修复为独立开放事项。
