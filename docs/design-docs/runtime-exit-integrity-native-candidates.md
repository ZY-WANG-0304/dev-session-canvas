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

远端候选尚未执行。PR #294 的最小基线不是本阶段通过记录。生产 reader、wire API、取消期限和资源预算均未选定。
