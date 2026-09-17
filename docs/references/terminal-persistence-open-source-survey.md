# 开源终端持久化方案对照

核对日期：2026-09-16。本材料是官方文档与固定源码快照的研究输入，不是本仓库已接受的方案，也不是运行上游产品所得的验收结果。仓库判断与候选比较见 `docs/design-docs/runtime-persistence-storage-reevaluation.md`。

## 1. 先分清四种保证

| 保证 | 对用户意味着什么 | 不能据此推导什么 |
| --- | --- | --- |
| 原进程保活 / reconnect | UI 或连接消失，PTY owner 仍在，回来后附着原进程 | owner 或机器重启后原进程仍能恢复 |
| 终端状态恢复 | 恢复当前屏幕、配置范围内的 scrollback，以及所支持的终端状态 | 原始输出事件永久保存，或全部 parser / TUI 状态可继续执行 |
| 会话重建 / revive | 恢复布局、目录、环境和启动命令，再启动新进程 | 原 PID、shell 内存、前台任务或 Agent 执行仍是原来那一次 |
| 持久历史归档 | owner 退出后仍能按明确保留规则读取历史 | 只保留一个窗口布局或 dead pane 就已经完成磁盘归档 |

下列版本的普通 reconnect 路径都以已解析终端状态为重要基础，而不是要求每个新客户端重放从创建以来的全部原始字节。各项目对状态完整性、滚动历史、服务退出和重建的保证并不相同。

## 2. 来源版本

| 项目 | 固定 commit | 核对范围 |
| --- | --- | --- |
| tmux/tmux | `e880cf63e0a9fe095d7c5d313761520fb1a8653c` | man page、pane 读写与 virtual screen、history 回收、capture / pipe |
| tmux-plugins/tmux-resurrect | `cff343cf9e81983d3da0c8562b01616f12e8d548` | pane contents 文档、save / restore 脚本 |
| microsoft/vscode | `0a4fc0adc2c7ca7dc85fe5a271cf78f2ec36bc25` | PTY service、headless xterm serializer、local terminal backend 存储 |
| microsoft/vscode-docs | `ae2d0832bdad11949dc8ed73a2da65540458721e` | Terminal Advanced 的 persistent sessions 定义 |
| wezterm/wezterm | `2658f629cd7251ce63a1698f238da2585676aa4e` | mux domain 文档、pane / screen 模型、scrollback、远程行读取 |

这些是本轮核对的源码快照，不表示稳定发布版本；后续采用某个实现时应重新选择 release、确认许可证、平台和兼容范围。

## 3. tmux：server 持有进程和终端模型

tmux 的 [man page](https://github.com/tmux/tmux/blob/e880cf63e0a9fe095d7c5d313761520fb1a8653c/tmux.1#L35) 明确分开 server 与 client。detach 或 SSH 连接意外断开不结束 server 管理的会话；回来可以 attach 同一 session。它依赖 server 存活，不是把进程内存序列化到磁盘后恢复。

关键不只是“多一个后台进程”。[window.c](https://github.com/tmux/tmux/blob/e880cf63e0a9fe095d7c5d313761520fb1a8653c/window.c#L40) 说明每个 pane 有 virtual screen，重新 attach 时重新显示该状态；[PTY read callback](https://github.com/tmux/tmux/blob/e880cf63e0a9fe095d7c5d313761520fb1a8653c/window.c#L1579) 把输出交给 server 内的终端 parser。UI 断开期间，server 继续维护终端模型，不必依赖消失的客户端来证明恢复状态。

[history-limit](https://github.com/tmux/tmux/blob/e880cf63e0a9fe095d7c5d313761520fb1a8653c/options-table.c#L845) 默认是每 pane 2000 行，修改默认值只影响新 pane；[grid_collect_history()](https://github.com/tmux/tmux/blob/e880cf63e0a9fe095d7c5d313761520fb1a8653c/grid.c#L449) 按限制回收最旧行。因此交互历史不是永久 append-only 原始事件档案。行数限制也不能直接当作固定字节数或总 RSS 的保证。

导出与保活是分开的功能：[capture-pane](https://github.com/tmux/tmux/blob/e880cf63e0a9fe095d7c5d313761520fb1a8653c/tmux.1#L2792) 导出当时保留的屏幕/历史，按选项可带样式转义；[pipe-pane](https://github.com/tmux/tmux/blob/e880cf63e0a9fe095d7c5d313761520fb1a8653c/tmux.1#L3753) 把程序后续输出接到外部命令，可用于日志。后者不是自动提供容量、fsync、恢复切点和归档回收的存储协议。

[remain-on-exit](https://github.com/tmux/tmux/blob/e880cf63e0a9fe095d7c5d313761520fb1a8653c/tmux.1#L6339) 可以在程序退出后保留 pane，仍是 server 生命周期中的对象；[kill-server](https://github.com/tmux/tmux/blob/e880cf63e0a9fe095d7c5d313761520fb1a8653c/tmux.1#L1206) 会销毁所有 session，不能把 dead pane 当作跨 server 退出的历史归档。

可借鉴的是“进程 owner + 权威终端模型 + 有限交互历史 + 独立导出”。不能直接照搬的部分包括 Unix/跨平台部署、嵌入 Webview 的交互协议、同 pane 多窗口尺寸竞争及完整历史要求。tmux 默认 server/socket 也不自动具有本产品的 root 归属语义；F-03 仍需单独设计。

## 4. tmux-resurrect：重建工作面，不恢复原进程

[pane contents 文档](https://github.com/tmux-plugins/tmux-resurrect/blob/cff343cf9e81983d3da0c8562b01616f12e8d548/docs/restoring_pane_contents.md) 要求显式启用 `@resurrect-capture-pane-contents`。[save.sh](https://github.com/tmux-plugins/tmux-resurrect/blob/cff343cf9e81983d3da0c8562b01616f12e8d548/scripts/save.sh#L134) 使用 `tmux capture-pane -epJ -S ...` 将当前保留的 pane 内容存入文件，不是保存完整原始事件流或进程内存。

[restore.sh](https://github.com/tmux-plugins/tmux-resurrect/blob/cff343cf9e81983d3da0c8562b01616f12e8d548/scripts/restore.sh#L122) 创建新 session/window/pane；有历史文件时先 `cat` 内容，再 `exec` 默认命令。[program restore 策略](https://github.com/tmux-plugins/tmux-resurrect/blob/cff343cf9e81983d3da0c8562b01616f12e8d548/docs/restoring_programs.md) 决定哪些程序如何重新启动。

这是一种布局、命令与可读历史的恢复，不保证原任务继续执行，也不保证恢复完整 parser/TUI 状态。对 Agent 而言，重新执行启动命令不等于 provider 显式 session resume；未经确认重跑任务还可能重复副作用。它适合作为历史态或显式重建的参考，不能作为 live-runtime 保活的替代品。

## 5. VS Code：reconnection 与 revive 显式分开

官方 [Terminal Advanced](https://github.com/microsoft/vscode-docs/blob/ae2d0832bdad11949dc8ed73a2da65540458721e/docs/terminal/advanced.md#L10) 定义：reload window 是 reconnect 先前进程，重启 VS Code 则恢复内容并 relaunch 进程；恢复 scrollback 由 `terminal.integrated.persistentSessionScrollback` 控制。

实现上，[PersistentTerminalProcess](https://github.com/microsoft/vscode/blob/0a4fc0adc2c7ca7dc85fe5a271cf78f2ec36bc25/src/vs/platform/terminal/node/ptyService.ts#L780) 使用 headless xterm 消费输出，同时维护断连 grace timer。detach 并不自动意味着任意长时间保留原进程；符合持久化条件时会等待重连，否则或超时后会关闭进程。

[XtermSerializer](https://github.com/microsoft/vscode/blob/0a4fc0adc2c7ca7dc85fe5a271cf78f2ec36bc25/src/vs/platform/terminal/node/ptyService.ts#L1032) 的 replay 来自配置了 scrollback 的终端 buffer。[serializeTerminalState()](https://github.com/microsoft/vscode/blob/0a4fc0adc2c7ca7dc85fe5a271cf78f2ec36bc25/src/vs/platform/terminal/node/ptyService.ts#L230) 保存启动信息和 normal-buffer replay；这个磁盘 revive 路径使用 `excludeAltBuffer`、`excludeModes`，不能等同于完整 live TUI/parser checkpoint。[revive 路径](https://github.com/microsoft/vscode/blob/0a4fc0adc2c7ca7dc85fe5a271cf78f2ec36bc25/src/vs/platform/terminal/node/ptyService.ts#L264) 调用 `createProcess()` 获得新 ID，并加入 `History restored` 标记。

这里也有反例约束：[local backend](https://github.com/microsoft/vscode/blob/0a4fc0adc2c7ca7dc85fe5a271cf78f2ec36bc25/src/vs/workbench/contrib/terminal/electron-browser/localTerminalBackend.ts#L183) 确实把终端恢复 JSON 存在 workspace storage 的 `TerminalBufferState` 中，并非所有成熟项目都使用独立归档服务或仅存引用。不过其内容是受 scrollback 语义约束的状态快照，而非 checkpoint 失效后无限增长的完整事件后缀；[布局](https://github.com/microsoft/vscode/blob/0a4fc0adc2c7ca7dc85fe5a271cf78f2ec36bc25/src/vs/workbench/contrib/terminal/electron-browser/localTerminalBackend.ts#L313) 另存 `TerminalLayoutInfo`，不要求每次改布局都重写同一恢复对象。

可借鉴的是明确的恢复承诺、PTY owner 与 UI 分离、有限终端状态以及布局/内容分开。不能借其 serializer 的使用就认定本项目的 eligibility 门禁多余；本项目承诺的 live 无损恢复更强，必须证明同一状态在未来输入输出下仍等价。

## 6. WezTerm：权威终端模型与按需行同步

官方 [multiplexing 文档](https://github.com/wezterm/wezterm/blob/2658f629cd7251ce63a1698f238da2585676aa4e/docs/multiplexing.md) 区分默认 local domain 与额外配置的 mux domain；连接独立 mux server 的 GUI 可以与进程 owner 分离。SSH mux domain 需要远端安装兼容 WezTerm，不能把普通 SSH 连接或默认 GUI 模式一概视为持久 daemon。

[LocalPane](https://github.com/wezterm/wezterm/blob/2658f629cd7251ce63a1698f238da2585676aa4e/mux/src/localpane.rs#L124) 持有 Terminal、子进程与 PTY；[Screen](https://github.com/wezterm/wezterm/blob/2658f629cd7251ce63a1698f238da2585676aa4e/term/src/screen.rs#L16) 使用行队列表示屏幕和 scrollback。默认 [scrollback_lines](https://github.com/wezterm/wezterm/blob/2658f629cd7251ce63a1698f238da2585676aa4e/docs/config/lua/config/scrollback_lines.md) 是 3500；[scroll 操作](https://github.com/wezterm/wezterm/blob/2658f629cd7251ce63a1698f238da2585676aa4e/term/src/screen.rs#L675) 按屏幕行数加 scrollback 限制回收旧行，alternate screen 不保留 scrollback。

客户端的 [renderable 状态更新](https://github.com/wezterm/wezterm/blob/2658f629cd7251ce63a1698f238da2585676aa4e/wezterm-client/src/pane/renderable.rs#L376) 根据变化标识请求当前区域的行，其他区域标记 stale，后续按需读；[schedule_fetch_lines()](https://github.com/wezterm/wezterm/blob/2658f629cd7251ce63a1698f238da2585676aa4e/wezterm-client/src/pane/renderable.rs#L495) 使用带 pane ID 和行范围的 `GetLines`。这是状态/行同步的参考，不是必须回放全历史字节才能显示当前画面的模型。

不能从使用 LRU 就声称整个客户端严格有界：[构造函数](https://github.com/wezterm/wezterm/blob/2658f629cd7251ce63a1698f238da2585676aa4e/wezterm-client/src/pane/renderable.rs#L108) 虽指定容量，但 [make_all_stale()](https://github.com/wezterm/wezterm/blob/2658f629cd7251ce63a1698f238da2585676aa4e/wezterm-client/src/pane/renderable.rs#L425) 会用 `LruCache::unbounded()` 替换缓存。本轮只采纳“按需行读取”的协议参考，不借此证明其全部内存/消息都有预算。

本轮核对的 mux 路径说明 server 生命周期内的连续性，没有建立 daemon 崩溃后从磁盘恢复完整会话的证据；程序退出后保留 pane 也不等于永久历史归档。直接借用行模型还要求客户端能渲染同一终端语义，不能把行文本直接喂入当前 xterm 就声称得到完整等价状态。

## 7. 对本轮比较的输入

| 观察 | 对候选比较的约束 |
| --- | --- |
| tmux/WezTerm 的长期状态主要是已解析终端模型，VS Code replay 也来自 buffer | 除了分页 journal，还应比较权威终端状态同步；不能默认全事件重放是唯一方式。 |
| scrollback 限制普遍存在 | 不丢未消费输出、保持终端语义、永久保存原始事件是三种保证，必须分别决定；不能以开源先例直接修改本产品承诺。 |
| VS Code 也使用 workspace JSON | 存储介质不是核心判断，是否有容量边界以及布局是否耦合历史重写才是。 |
| tmux-resurrect / VS Code revive 重新创建进程 | 恢复画面、重建命令、Agent provider resume 与原进程重连必须分别标识。 |
| 保留 pane 不等于磁盘归档 | 若选择保留正常退役后的 completed 历史，仍需验证其存储/读取，不能只换 mux backend 就宣称解决；归档不是进程保活的必备机制。 |

2026-09-17 产品边界更新：用户确认 Supervisor 崩溃或机器重启后可以不恢复进程及终端历史，因此本轮未建立上游 crash recovery 证据不再是采用候选的缺口。仍需核对正常运行期的重连、内容和容量，正常 completed 的保留形式/期限另行决定；源码核对日期和上游事实不变，具体结论见重评设计第 6.3 节。

未执行上游 detach/attach、daemon crash、Windows、Remote SSH 或 Agent provider 测试，也未建立这些项目的性能排名。本文只提供可追溯的文档/源码事实；采用方案前仍需受控对照与真实平台验证。
