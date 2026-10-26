# 构造内配置复用对照

这是开发诊断，不是发布门禁。正式决策及现场证据见 `docs/design-docs/runtime-journal-input-priority.md`。输入必须是已经构建并冻结的 main-only 扩展目录；runner 复制到新输出目录，保留输入 JS 的 SHA-256，仅在副本暴露现有 manager/xterm 供驱动与观察，不修改原扩展。脚本只支持当前可识别的构建锚点，不匹配时失败。

从仓库根运行（Linux 需要 Xvfb、已安装的 VS Code 桌面二进制与锁定依赖）：

```sh
xvfb-run -a node scripts/diagnostics/diagnose-configuration-reuse.mjs \
  --extension .debug/config-reuse/full \
  --vscode /absolute/path/to/VSCode/code \
  --output .debug/config-reuse/new-run --samples 40
```

输出目录必须不存在，避免覆盖证据。`--remote` 使用仓库既有临时 sshd/Remote SSH 夹具；会在独立 extensions/profile 中安装 Remote SSH 扩展并下载匹配 Server，结束后收回该夹具。它只验证本机回环，不模拟跨机器网络。远程副本添加 onStartupFinished 仅用于自动激活；驱动通过该 Host 的配置 API 设置并核对 machine 作用域的测试 CLI，不能用 workspace 设置代替远端机器配置。默认使用既有 `DEV_SESSION_CANVAS_RUNTIME_HOST_BACKEND_OVERRIDE=legacy-detached`，Runtime Persistence 仍开启，实际 native provider、Supervisor、journal、Host、Webview 都参与；不验证 systemd 启动。所有测试 CLI、配置更新和节点重置限于独立测试工作区。

`build-reference.mjs` 从固定提交 `cce236b3ec1a6eb776c494f9f8ce971f408f4f16` 提取原配置构造方法，在活动 manager 的继承对象上执行。其它未改依赖使用当前 checkout；configuration helper 的无参默认语义保持原行为。先预热 10 组，再交替顺序测量 50 组原版/候选 runtime 与 sidebar，逐组比较完整 payload。真实 API 配置更新检查独立进行，最后恢复测试配置。它测完整构造方法，不覆盖侧栏 listener 或异步绘制。

五种场景按固定顺序运行：单节点输出、第二节点静默、仅第二节点输出、双节点输出，以及双输出加测试驱动的 10 Hz 状态发布。最后一项是人工控制的状态压力，使用原 postState；不能当作自然 Agent 触发频率。自然打印未必产生高频状态更新，因此结果必须同时报告实际 state-build 样本数。每个输出进程每 50 ms 写 12 行带 ANSI 颜色的输出；输入间隔 250 ms，实际计数/字节/时间以 trace 为准。

输入由 Playwright 键盘进入真实 xterm textarea，PTY 程序关闭内核 echo，仅在收到输入后输出带单调序号的回复。起点是 Webview keydown，终点是同一 Webview onWriteParsed 时观察到对应 buffer 内容，未包含桌面键盘递送之前或像素呈现之后。从 buffer 尾部反向搜索，找到全部在途回复即停止；不存在任意的行数截断，避免换行或合并大页漏报。存在探针开销；初期本机试跑使用最近 500 行扫描，未见长积压。远程试跑曾采用新增行数扫描，随后为自动折行的正确性收敛为反向搜索；不能把不同探针的细微延迟差异当性能收益。超时或未观察到的输入保留在分母，不能只统计成功样本。每场景保留原始样本、五段/分页/input ACK 聚合、实际尺寸、截图；全部测量后关闭输出并发送额外可见性标记，截图验证当前视口，额外标记不计入延迟样本。

主要输出：`input.json`（身份/范围）、`benchmark.json`、`configuration-check.json`、每场景 JSON/PNG、`visibility.json`、`result.json`、`cli-cleanup.json`，失败时增加错误与诊断事件。`success` 仅表示输入/回复检查通过；环境警告、cleanup 失败和性能是否改善仍需独立审阅。不要从 Healthy、无缺失或 buffer 更新推导像素延迟与用户现场问题已解决。

A/B/C/A 顺序分别使用基线、仅 runtime 复用、runtime+sidebar 复用、返回基线。保持同一 VS Code、配置、负载、尺寸、探针；环境波动以返回基线和同一 Host 原版/候选配对一起判断。输出目录内配置和源码路径用于本机排查，不提交原始证据；正式文档保留统计、输入身份、失败与覆盖限制。


侧栏对照增加 `--sidebar`。A/B/C 分别输入当前配置复用基线、仅复用事件状态、完整侧栏去重产物；五场景为双输出且侧栏从未打开/可见/隐藏/重开（人工 20 Hz 状态压力），以及侧栏可见的自然双输出。使用真实已注册的三个侧栏实例，拦截副本中的配置构造、树刷新和侧栏 postMessage，记录次数/字节；不以未创建的侧栏代替可见侧栏。每场景记录 created/visible 状态。隐藏场景结束后通过实际 Host 方法修改测试节点标题和 include 过滤，重开时检查 Host 期望值、实际最后发布值及 Webview DOM。筛选面板的 files 功能在独立测试配置中启用。统计段外进行显示检查；计数是 Host 调用/提交次数，不冒充像素绘制计数。输入标记与原回显观察器保持相同，sidebar-driver 的 SHA-256 另存于 input.json。
