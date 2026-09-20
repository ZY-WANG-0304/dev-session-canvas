---
title: 退出完整性原生候选对照
decision_status: 比较中
validation_status: 验证中
domains:
  - 执行编排域
  - VSCode 集成域
architecture_layers:
  - 适配与基础设施层
related_specs:
  - docs/product-specs/runtime-persistence-modes.md
related_plans:
  - docs/exec-plans/active/runtime-exit-integrity-native-candidates.md
updated_at: 2026-09-20
---

# 退出完整性原生候选对照

## 1. 范围

承接 PR #294 的三平台公共接口基线，验证独立读取与资源生命周期候选。只运行新建 fixture，不修改业务、用户会话、依赖或旧基线。进程退出、输出 EOF、消费者应用和资源释放分别证明；静默时间、固定等待和 socket destroy 不算可信 EOF。当前为隔离可行性研究，不是生产方案或修复验收。

## 2. 运行前冻结

Unix 对照 `stock` 与 `owned-async`，直接使用同一 node-pty native fork，后者独占 master fd，单个异步 read 64 KiB，EAGAIN 等 2 ms，每批让步。每案例 3 轮、串行，90000 行自然 exit 0/7、89800 行附近暂停 350 ms、UTF-8/ANSI/OSC 分片、后代延迟 350 ms、后代保持 1500 ms、TERM 后尾部 exit 7。源结束以 read 0/EIO 观察，主进程后 1000 ms 无结束则显式取消；30 s 单轮、32 s 硬截止。Linux 与 macOS 各 42 样本。只归一 LF 前重复 CR，其他内容必须精确；这是终端换行语义而非忽略缺失行。原始字节哈希和换行变换数均保留。macOS read 0/EIO 仅按原生观测记录，不由 Linux 结果推断。

Windows 比较 `stock-builtin`、`stock-dll`、`owned-dll`。候选直接使用锁定 node-pty 内部 native 启动，独立 worker 读取 conout pipe，通过有序消息交付原始 Buffer 和 end，不使用原转发 server 或静默销毁 timer。DLL 的 `ConptyReleasePseudoConsole` 行为需要验证，不能把开关本身视为修复。每案例 3 轮、串行，共 63 样本：90000 行自然 exit 0/7、89800 行附近暂停 1500 ms、合法 UTF-8/ANSI 分片、父退出后后代 1500 ms 写尾部、后代保持 5000 ms、输入请求合作停止后尾部 exit 7。Windows 源取消期限为主进程退出后 2500 ms；单轮采集 30 s，独立子进程在 35 s 硬终止。期限只用来报告中断，不能将其当成成功排空。

每个 Windows 样本放在独立子进程，结算内容后给 2 s 自然资源退出 guard；超时保存资源并退出非零，不 public kill 掩盖自然回收缺失。父进程保存子进程退出结果，回收明确记录的 fixture PID。所有强制清理都与源结果分开，不能因 OS 在诊断进程退出后回收句柄而宣称 provider 已释放。候选需要内容/光标全量匹配、writer receipt 成功、进程真实结果、native pipe end、worker 自然 exit；保持输出案例只要求明确中断和清理，不能标成排空。公共 reader 的 EOF 只作为 legacy 未证明观察。

窗口 120×40，scrollback 100000，以 headless xterm 对比完整文本和光标；ConPTY 允许 VT 转换，不要求原始字符串与 POSIX 完全相同。文件保存 raw、writer 脚本/receipt、进程与源事件、cleanup、环境和源码/二进制哈希。测试数据包含受控全量缓冲，仅作取证，不是生产内存方案。线程消息背压、公平性、并发输入、句柄增长、Host/Webview、Electron/最低支持宿主和 packaged 均为后续门槛。

## 3. 源码依据与局限

固定 `node-pty@1.2.0-beta.12` 的 `src/win/conpty.cc::SetupExitCallback()` 在调用 JS 之前关闭 shell handle 并移除 native baton；`PtyKill()` 则通过 baton 查找 HPCON。builtin 自然退出之后的 kill 不证明实际调用 `ClosePseudoConsole`。DLL connect 调用 `ConptyReleasePseudoConsole`，但原 JS worker 的转发 server 没有自然关闭路径。候选独占输出 worker，不直接修改 node_modules；测试真实 end/close/worker exit，不据源码预测成功。

## 4. 运行与失败处理

独立分支 `runtime-exit-integrity-native-candidates` 基于 main，不含未完成的运行时重构。新增专用 workflow，只在该分支 push 或手动触发，权限只读、无 secrets、三平台 Node 22、npm ci、fail-fast false，工件保留 14 天。每次运行固定全 schedule，新 output 目录拒绝覆盖；保留首次运行的所有失败。oracle/fixture/基础设施失败应单独分类，修订须另存新 run，不增加等待或降低内容门槛筛选绿色。

## 5. 当前结果

本地 Linux Node 25.6.0 / libuv 1.51.0 完整执行 42 样本，候选 18 次精确 read EIO、3 次明确取消；stock 三次暂停缺尾（writer 成功）、三次后代写失败分别保存。自然零/非零退出本轮无缺失，不声称已取得自然 HUP 的新对照。工件 `.debug/native-candidate-v1-local/` 已复核完整 schedule、内容哈希和候选门槛。两个入口自校验和三个脚本语法通过；Windows 的 TCP worker 自校验不是原生 ConPTY。

首轮远端 run [35498026812](https://github.com/ZY-WANG-0304/dev-session-canvas/actions/runs/35498026812)，输入 `afb2497440d22ee088d8bd3a65766dcec008e322`，attempt 1，执行完整 147 样本。Ubuntu job 成功，macOS/Windows job 失败；未通过放宽断言、增加等待或重跑筛选改成绿色。

| 平台 | 原 reader | 独占 reader 候选 |
| --- | --- | --- |
| Ubuntu，42 样本 | 暂停三轮均只有 89800 行，writer 成功；后代尾部三轮写失败；其余内容匹配 | 18 次内容精确且 read EIO，3 次后代保持时明确取消，21/21 符合冻结门槛 |
| macOS，42 样本 | 自然大输出、暂停、分片、TERM 均完整；后代尾部三轮写失败；保持组很快结束 | 普通五类共 15 次精确 read 0；后代尾部 3 次缺失、保持组 3 次提前 read 0 而非预期取消，15/21 达标 |
| Windows，63 样本 | builtin 暂停三轮内容缺失；DLL 暂停完整；两个 stock 各 21 个样本均未在资源 guard 内自然退出 | 普通五类共 15 次内容/光标匹配、pipe EOF、worker 和诊断进程自然退出；后代两类 6 次未达冻结门槛，15/21 达标 |

三个平台均为 Node 22.23.2 / libuv 1.51.0 / node-pty 1.2.0-beta.12。Linux x64 kernel `6.17.0-1022-azure`，image `20260907.300.1`；macOS arm64 Darwin `25.6.0`，image `20260907.0351.1`。这是托管 runner 的特定原生组合，不代表所有 OS build/架构或实际 VS Code/Electron。Unix 脚本 SHA256 为 `7e258eb3135f4cfe07c621ae2d989e9733139b376f4c78f800d814e1ac87bf45`。

## 6. 结论与下一步

本轮没有选定完整的跨平台生产 reader。Linux 独占 fd 的局部成功不能直接外推 macOS；Windows 单改 DLL 不能解决原 worker 资源生命周期。独立 Windows worker 的普通场景同时给出内容、源 end 和自然资源退出证据，但还不是零 OS 句柄/长驻服务无增长证明。

macOS 后代尾部组只收到 `PARENT`，候选真实 read 0 后关闭 master，writer receipt 为 `CHILD_TAIL\ncomplete:1`。因此不能把它写成“成功写入后丢字节”：旧 bash 的输出/receipt 缓冲行为也需隔离。保持组在约 10 ms 结束，不是 1000 ms 取消。可能涉及 session leader 退出时的终端撤销，但本轮没有 syscall errno、保持 master 打开的对照或 session leader 存活对照，不将该假设写成已证实根因。Windows 后代场景同样需确认子进程实际拥有可用的 console 输出，而非仅创建了进程。

下一轮应先补有/无存活 session leader 的控制组、原始写入返回值及 EOF 后保持 master 的隔离探针，明确每个平台的终端所有者边界。不能简单把这 12 个失败改标为正常完成，也不能将写入失败与已写成功后缺尾合并统计。生产协议和共享 Host/Supervisor 接入须等待源边界选型；资源增长、输入/并发预算、真正停止与强制停止、真实 provider/UI/packaged 和最低宿主矩阵继续开放。

## 7. 首轮工件复核与 Windows 夹具修订（第二轮前冻结）

Windows builtin 暂停三轮的 90000 行可打印文本哈希与预期一致，实际 `cursorLine=89999`，预期为 `90000`；writer receipt 均成功。故准确结论是末尾换行/终端光标状态不完整，不是缺少某行文字。对应原 DLL/候选均为 `90000`，候选在暂停后真实 pipe end 且 worker exit 0。保持光标断言，不因文本哈希相同放宽门槛。

后代首轮 9 个 tail 样本均无 writer receipt，结束后该 PID 已不存在。夹具通过普通 Node `spawn(..., {stdio: 'inherit'})` 创建子进程；固定 [libuv v1.51.0 win/process.c](https://github.com/libuv/libuv/blob/v1.51.0/src/win/process.c) 明确将非 detached 的子进程分配给父进程私有 `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` Job。这违背“父退出后后代仍存活”的夹具前提；六个候选失败不能用来证明 ConPTY reader 截断存活后代。不能只切 detached，因为它同时改变 console 归属。

第二轮仅修订 Windows 后代启动：由 Node 启动 `cmd.exe /d /s /c start "" /b ...` 中间进程；cmd 创建的实际后代不由父 Node 直接加入上述 Job，并继承当前 console。记录实际后代 PID（不是 cmd PID）、`stdout.isTTY` 和主进程回调时的后代存活探测；候选后代门槛额外要求这两项成立。原先 7 案例、3 reader、每项 3 轮、90000 行、所有等待/资源预算均保持不变，完整运行而非只重跑失败项。Unix 脚本和所有 reader 均不变，macOS 的六个失败继续保留，不期待因本次夹具修订而变绿。第二轮运行前已冻结以上差异，结果须另存新 run。
