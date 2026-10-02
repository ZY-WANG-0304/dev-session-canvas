# 复核终端退出尾部短读的跨平台根因

本 ExecPlan 按 `docs/PLANS.md` 维护，承接 `dd2fa497`。用户要求重新定位，担心上一轮 Linux 证据遗漏其他平台问题；本轮仍不修改业务源码、依赖或既有验收断言，只交付独立诊断和正式调查记录，不推送。

## 目标与全局图景

上一轮在 Linux 实证 Node/libuv 的 PTY 读取在挂断加短读取时过早报告 EOF，但不能据此认为 macOS/Windows 没有输出尾部丢失。本轮将“已在 Linux 复现的具体机制”与“各平台共同依赖的进程退出/输出完成契约”分开，核查其他平台同类和独立触发路径。结果应让维护者知道哪些根因已证明、哪些只有代码证据、哪些必须在原生平台验证，避免只做 Linux 特判后错误关闭问题。

## 进度

- [x] (2026-09-19) 确认基线 `dd2fa497`、工作区干净，复读工作流、计划规范和既有定位结论。
- [x] (2026-09-20) 核查 Unix/macOS、Windows/ConPTY 及业务公共契约，补上游 issue/fixed commit 和各平台事件映射差异。
- [x] (2026-09-20) Unix 真实 PTY 九轮 timer 受控复现；Windows 七场景及真实 TCP 对照、公共业务十一场景分别在 Node 25 / VS Code Node 22 完成自校验。
- [x] (2026-09-20) 同步跨平台报告、原报告边界、设计/审核与开放技术债；原生 macOS/Windows 缺口转后续 runner 验证，不宣称全部定位完成。
- [x] (2026-09-20) 三份脚本语法、分析器自校验、9 个 PTY 样本及双 Node 契约结果复核通过；4 份设计元数据/索引、27 个本地引用一致，业务 diff 为空，本批按工作流本地提交，不推送。

## 意外与发现

现有脚本 `scripts/diagnostics/diagnose-runtime-terminal-tail.mjs` 明确限制 Linux；该限制是探测器适用范围，不是缺陷平台边界。上一轮已排除 200 ms timer 的结论仅针对捕获样本，不覆盖其他时序或平台。本轮暂停消费 350 ms，九轮真实 PTY 均因 Unix timer destroy 截断，六轮销毁前捕获的 JS buffer 和 fd 残留与 raw 拼接均完整，证明存在独立机制。

macOS kqueue 将 EV_EOF 映射为 POLLRDHUP，而不是触发 Linux 缺陷的 POLLHUP；select fallback 也未生成该信号。Darwin blocking slave close 可能等待内核输出队列，和 Linux child exit 顺序不同。因此共享 stream.c 或共享 timer 都不能当作 macOS 已复现的证据。

Windows 默认 builtin ConPTY 的 native exit 启动 1000 ms 无已解码 data timer，超时无条件 destroy，并将 close 转 onExit(0)，没有完整排空证明。实际安装 JS 七项夹具及真实 TCP buffer 对照均可验证截断条件，不是原生 Windows 复现。普通 UTF-8 分片对照完整，强制关闭时 decoder 残片也可能被丢弃，不能将其混写为普通解码缺陷。

实际 Supervisor/journal 十一项人工 provider 场景证明退出前已接受操作会收敛；exit 后才到达数据被 admission guard 拒绝，stop 自身不封闭输出，delete 是有意取消。未发现公共串行队列额外丢失已接受的数据。snapshot-only Host 同样依赖 onExit，不只是 Runtime Persistence 的边界。

## 决策记录

- 决策：将三条只读审核并行，独立诊断和文档由主代理统一维护。理由：Unix、Windows 和业务公共层可独立核查，有助于发现先前归因偏差，避免共享文件冲突。日期/作者：2026-09-19 / Codex。
- 决策：不假装在 Linux 上运行原生 macOS/ConPTY。理由：平台 syscall 与原生生命周期不能用 process.platform mock 证明；源码夹具仅证明 JS 分支的条件性行为。日期/作者：2026-09-19 / Codex。
- 决策：分别记录 Linux 合成 EOF、Unix timer、Windows 静默 timer，以及公共业务依赖，不强行给所有平台一个 syscall 根因。理由：共享的是未被证明的完整性交付契约，实际 OS 关闭路径不同。日期/作者：2026-09-20 / Codex。
- 决策：新增两份独立夹具并扩展 Linux destroy 前探测，保留原业务和测试。理由：可执行源码反例有助于确定契约缺口，但不能替代真实 macOS/Windows 和后续修复验收。日期/作者：2026-09-20 / Codex。

## 结果与复盘

完成当前环境可验证的二次调查，结论写入 `docs/design-docs/runtime-terminal-cross-platform-diagnosis.md`。纠正“仅靠 Linux 定位就足以停止整个问题调查”的范围判断：Linux 自然缺陷成立，但 Unix 与 Windows 各有不同的强制关闭机制，且 Runtime/snapshot-only 都依赖过强的 onExit 完整性假设。当前源码级和受控证据不证明 macOS/Windows 已自然复现，也不关闭所有历史失败。

无业务、依赖或既有断言变更；未选择修复方案。缺少原生 macOS/Windows runner，没有运行完整 UI/packaged smoke 或真实 Agent provider。本轮计划归档的是静态与现有环境诊断，原生矩阵、完整性修复和回归继续登记在 `docs/exec-plans/tech-debt-tracker.md`，整体方案保持验证中。

## 上下文与定向

`extensions/vscode/dev-session-canvas/src/panel/executionSessionBridge.ts` 将 node-pty 封装为 `ExecutionSessionProcess`，`onExit` 注释假定数据已经排空。`src/supervisor/runtimeSupervisorMain.ts` 的 `bindSessionProcess()` 和 `finalizeSession()` 在退出时关闭新 mutation admission，再收敛已接收操作。这里的 admission 是是否还接受新的终端事件；如果 provider 在退出后才交付尾部，该顺序会让有效输出无法入账。

`node_modules/node-pty/lib/unixTerminal.js`、`windowsTerminal.js` 和 `windowsPtyAgent.js` 描述平台 JS 适配，`src/unix/pty.cc` 与 `src/win/` 描述 native 生命周期。Node/libuv Unix stream、kqueue 和 Windows pipe reader 需要分别核对。旧 Linux 证据与命令在 `docs/design-docs/runtime-terminal-tail-diagnosis.md`；新结论写入该文档或独立后续文档，并同步索引与技术债。

## 工作计划

### 里程碑一：平台契约地图

读取各路径如何创建 reader、何时收到进程退出、何时结束输出、如何处理超时与 kill。对每个平台记录一条从 native signal 到业务 finalization 的真实调用链；进程退出、流 EOF、stream close、buffer 排空必须独立描述。固定本地依赖版本及上游 tag，不能凭最新主线推断已安装版本。

### 里程碑二：独立对照验证

沿用现有真实 PTY 诊断捕获其他退出条件，必要时新增独立脚本，以受控 callback/pipe 对安装版本的 JS 分支做确定性验证。新工具写在 `scripts/diagnostics/`，实验输出到新的 `.debug/terminal-tail-cross-platform-*`，不覆盖旧证据。明确受控条件，不用延迟制造的结果计算生产发生率；不改实际业务或依赖文件。

### 里程碑三：收口平台边界

综合独立审核和运行结果，将风险按“真实复现、源码/夹具确认、待原生验证”分层。写清当前可用环境及不能执行的平台，登记验证缺口，而不是以缺平台为理由停止所有可做的分析。只完成调查，不自动实施任何修复候选。

## 具体步骤

命令均在仓库根执行，需现有 npm 依赖以及匹配的 node-pty 原生模块，不安装/升级依赖。已经运行的主要命令如下，重试须为输出目录及重定向文件换新名称，不覆盖证据。

    node scripts/diagnostics/diagnose-runtime-terminal-tail.mjs --mode bare --runs 3 --pause-near-exit-ms 350 --writer-receipt --probe-after-end --output .debug/terminal-tail-cross-platform-timer
    node scripts/diagnostics/diagnose-runtime-terminal-tail.mjs --mode bare --runs 3 --pause-near-exit-ms 350 --writer-receipt --probe-before-destroy --output .debug/terminal-tail-cross-platform-timer-probe
    env ELECTRON_RUN_AS_NODE=1 .vscode-test/vscode-linux-x64-1.117.0/code scripts/diagnostics/diagnose-runtime-terminal-tail.mjs --mode bare --runs 3 --pause-near-exit-ms 350 --writer-receipt --probe-before-destroy --output .debug/terminal-tail-cross-platform-vscode-timer-probe
    node scripts/diagnostics/diagnose-windows-pty-exit-contract.mjs > .debug/terminal-tail-cross-platform-windows-contract.json
    env ELECTRON_RUN_AS_NODE=1 .vscode-test/vscode-linux-x64-1.117.0/code scripts/diagnostics/diagnose-windows-pty-exit-contract.mjs > .debug/terminal-tail-cross-platform-vscode-windows-contract.json
    node scripts/diagnostics/diagnose-runtime-exit-admission.mjs > .debug/terminal-tail-cross-platform-admission.json
    env ELECTRON_RUN_AS_NODE=1 .vscode-test/vscode-linux-x64-1.117.0/code scripts/diagnostics/diagnose-runtime-exit-admission.mjs > .debug/terminal-tail-cross-platform-vscode-admission.json

Windows 脚本运行安装包的实际 Windows JS，但 clock/native/transport 由 fixture 控制，另用真实 TCP socket 对照；公共脚本在内存导出实际 Supervisor 类，注入 provider 时序。脚本 exit 0 表示特征断言正确，包含预期截断反例，不表示产品通过完整性验收。Linux 工具须检查 `raw.complete`、receipt、destroy stack 及 `destroyProbe.rawPlusPending.complete`，不能只看退出码。上游源码及 API 原文只读下载在 `.debug/terminal-tail-cross-platform-unix/`，固定来源、重要行号和指纹摘录于正式报告。

## 验证与验收

所有确认的丢失都应有完整预期、实际内容、退出事件顺序和首次缺失层。mock 只能证明条件性 JS 路径，不证明原生平台可达性；平台共享源码也不等于同条件均可复现。新增工具必须语法检查与有界运行，清理自己创建的进程。`git diff dd2fa497 -- extensions tests package.json package-lock.json` 必须为空，文档状态、引用、ExecPlan 和开放技术债一致。

Node 25 与 VS Code Node 22 分别完成 Windows 7 场景 + 真实 TCP 对照和公共 11 场景，均 exit 0；Linux 工具分析器 `--self-test` 通过。三份脚本 `node --check` 作为语法门禁，新增文档以 YAML 解析检查 frontmatter、索引日期/状态及本地引用。业务根基 SHA 和 dependencies 来源指纹保持不变，不以工具通过宣称跨平台产品已经无损。

## 幂等性与恢复

复跑使用全新目录，不动用户 storage 或运行服务；不修改 node_modules。时间/暂停注入必须显式开关、仅在诊断进程生效。大工件不入库，关键摘要进入人工确认的正式文档。任务结束后只提交文档和诊断脚本。

## 证据与备注

上一轮自然组已证实 raw/onData 缺失且 journal/page 相等；EOF 后补读均补齐全部 90000 行。这一结论保留，但不作为 macOS/Windows 健康的证据。

新 timer 探测 Node 25 三轮 raw 为 89800/89801/89801 行，JS buffer 为 6448/1674/1426 字节，fd 残留为 5958/10670/10918 字节；Node 22 三轮 raw 均89800，buffer 4095/1550/682，fd 8311/10856/11724。六轮拼接均精确90000行，且没有 socket end。Windows 真实 TCP 对照在两 Node 环境均已有5字符buffer，1003 ms后销毁、无end、只收到HEAD；不要将这个TCP结果写成ConPTY真实平台结果。公共业务source SHA256为 `467d9ed7e9bc964aaac2b9b243d129c19ffce047d9dd0d492fa3dcbde7a29270`。

## 接口与依赖

不新增产品接口或依赖。只复用安装的 node-pty、Node 标准 API、esbuild、TypeScript AST 和现有测试导出方式。子审核不改业务，Windows 与公共链路各自新增一份独立诊断脚本；主代理维护 Linux 探测和正式文档，避免共同编辑同一源码。

修订记录：2026-09-19 创建二次定位计划，显式区分平台实测范围与缺陷可能范围，不实施业务修复。

修订记录：2026-09-20 收口现有环境和源码契约调查，新增Unix强制关闭、Windows及公共链路反例；保留原生平台缺口，归档本轮计划而不关闭问题。
