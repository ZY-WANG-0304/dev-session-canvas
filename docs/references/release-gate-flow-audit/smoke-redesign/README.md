# Smoke 重划设计的可读目录与覆盖映射

原始目录设计输入为 `50e201caefb7c7d20ee2818455318fc33d8a2ba9`；静态报告不构成产品验收。2026-10-20按用户授权在PR335实现十一项非真实TUI默认source/packaged入口，实际映射148/4；当时四项真实TUI仍待覆盖。2026-10-28 PR341 已实现四项默认 source/packaged 入口，映射现为152/0；产品验收仍待实际结果，见[本轮记录](../../smoke-real-tui-coverage/README.md)。运行证据与历史输入分别记录。设计见[场景与子场景边界](../../../design-docs/smoke-scenario-boundaries.md)，原[现状六图](../smoke/README.md)保持。

## 原入口迁移

| 当前入口 | 默认范围 | 拟议目标 | 保留上下文 |
| --- | --- | --- | --- |
| local-execution-flow | 源码默认、packaged默认 | execution-io、agent-state-fixture、execution-exit、execution-restart、execution-start、execution-stop、surface-continuity、canvas-entry | snapshot-only；与trusted重复时先保持自己的独立fixture入口 |
| owned-canvas-reconciliation | 源码默认、packaged默认 | execution-start、canvas-reconcile、host-boundary-local、canvas-entry | snapshot-only；与trusted重复时先保持自己的独立fixture入口 |
| snapshot-only-manual-recovery | 源码默认、packaged默认 | host-boundary-local、agent-resume-context、execution-exit、canvas-entry | snapshot-only；与trusted重复时先保持自己的独立fixture入口 |
| local-surface-cutover | 源码默认、packaged默认 | surface-continuity、canvas-entry | snapshot-only；与trusted重复时先保持自己的独立fixture入口 |
| local-preparation-failure | 源码默认、packaged默认 | execution-start、canvas-entry | snapshot-only；与trusted重复时先保持自己的独立fixture入口 |
| local-links-and-stop | 源码默认、packaged默认 | terminal-resource-drop、terminal-links、execution-stop、agent-resume-context、canvas-entry | snapshot-only；与trusted重复时先保持自己的独立fixture入口 |
| local-pty-robustness | 源码默认、packaged默认 | execution-io、execution-exit、execution-restart、execution-stop、execution-concurrency、output-pressure、canvas-entry | snapshot-only；与trusted重复时先保持自己的独立fixture入口 |
| runtime-checkpoint-refresh | 源码默认 | runtime-projection、canvas-entry | runtime环境；保留原模式/binding/分页状态，等价前不移除专用fixture |
| trusted | 源码默认、packaged默认 | agent-resume-context、agent-state-fixture、canvas-entry、canvas-nodes、canvas-notes、canvas-protocol、canvas-reconcile、canvas-sidebar、execution-concurrency、execution-config、execution-exit、execution-file-activity、execution-io、execution-notifications、execution-restart、execution-start、execution-stop、host-boundary-local、output-pressure、runtime-mode、runtime-projection、runtime-recovery、session-history、surface-continuity、terminal-links、terminal-resource-drop、terminal-view | 拆独有领域与证据消费者；逐项映射，不先删除重复调用 |
| restricted | 源码默认 | restricted-workspace、canvas-protocol、canvas-entry | 受限，无真实执行；独立seed与拒绝契约 |
| legacy-supervisor-upgrade | 源码默认 | supervisor-upgrade | 保留三代上下文及因果步骤；普通Stop/resize不可替代 |
| real-reopen | 源码默认 | runtime-reopen | 保留setup/transition/completed barrier/verify；SSH原Host寿命单独确认 |
| multi-root-real-reopen | 源码默认 | runtime-reopen | 保留setup/transition/completed barrier/verify；SSH原Host寿命单独确认 |
| single-to-multi-root-real-reopen | 源码默认 | runtime-reopen | 保留setup/transition/completed barrier/verify；SSH原Host寿命单独确认 |
| two-window-shared-runtime | 源码默认 | shared-runtime-windows | 保留跨窗口握手；最后空root重开不是原session恢复 |
| systemd-user-real-reopen | 源码默认 | runtime-reopen | 保留setup/transition/completed barrier/verify；SSH原Host寿命单独确认 |
| systemd-fallback-real-reopen | 源码默认 | runtime-reopen | 保留setup/transition/completed barrier/verify；SSH原Host寿命单独确认 |
| remote-ssh-real-reopen-exit | 源码默认 | runtime-reopen | 保留setup/transition/completed barrier/verify；SSH原Host寿命单独确认 |
| remote-ssh-real-reopen-retain | 源码默认 | runtime-reopen | 保留setup/transition/completed barrier/verify；SSH原Host寿命单独确认 |
| runtime-legacy-reconnect | 源码focused-only | runtime-recovery、canvas-entry | runtime环境；保留原模式/binding/分页状态，等价前不移除专用fixture |
| linux-runtime-report-unavailable | 源码focused-only | runtime-compatibility | preActivation独立Host；focused-only |
| runtime-completed-no-history | 源码focused-only | runtime-projection、canvas-entry | runtime环境；保留原模式/binding/分页状态，等价前不移除专用fixture |

## 完整拟议case目录

这些名称是迁移目的地。尚未实施独立fixture的业务helper仍需拆分；`proposed-gap`没有旧业务覆盖，不能计入通过。

| ID | 验证目标 | 保留计划 |
| --- | --- | --- |
| `execution-start/auto-start` | 创建后原执行started | 源码默认、packaged默认 |
| `execution-start/duplicate` | 活动执行拒绝重复Start | 源码默认、packaged默认 |
| `execution-start/missing-cli` | 缺CLI未启动请求结算 | 源码默认、packaged默认 |
| `execution-start/invalid-launch` | 非法命令拒绝且不产生执行 | 源码默认、packaged默认 |
| `execution-io/agent-line` | Agent完整命令与正文 | 源码默认、packaged默认 |
| `execution-io/agent-partial` | Agent分段输入不提前提交 | 源码默认、packaged默认 |
| `execution-io/terminal-line` | Terminal真实printf正文 | 源码默认、packaged默认 |
| `execution-io/live-snapshot` | 活动快照绑定原执行与正文 | 源码默认、packaged默认 |
| `execution-io/bounded-burst` | 有限burst末标记到达 | 源码默认、packaged默认 |
| `agent-state-fixture/burst-prompt` | fake burst与prompt状态 | 源码默认、packaged默认 |
| `agent-state-fixture/sleep` | 受控静默前后状态 | 源码默认、packaged默认 |
| `agent-state-fixture/spinner` | 受控重绘前后状态 | 源码默认、packaged默认 |
| `execution-exit/natural-zero` | Agent自然退出0与终态证据 | 源码默认、packaged默认 |
| `execution-exit/nonzero` | Agent命令退出17与错误分类 | 源码默认、packaged默认 |
| `execution-exit/resumed-nonzero` | 成功resume后退出19分类 | 源码默认、packaged默认 |
| `execution-stop/agent` | Stop原Agent | 源码默认、packaged默认 |
| `execution-stop/terminal` | Stop原Terminal | 源码默认、packaged默认 |
| `execution-stop/codex-queued-exit` | Stop与排队exit9竞态 | 源码默认、packaged默认 |
| `execution-stop/claude-graceful` | Claude单次优雅Stop | 源码默认、packaged默认 |
| `execution-restart/after-natural` | 自然退出后新Start | 源码默认、packaged默认 |
| `execution-restart/after-error` | 错误退出后新Start | 源码默认、packaged默认 |
| `execution-restart/after-stop` | Stop后新Start | 源码默认、packaged默认 |
| `canvas-reconcile/reread` | 画布重读保持原执行 | 源码默认、packaged默认 |
| `canvas-reconcile/root-remap` | root重组保留原执行 | 源码默认、packaged默认 |
| `canvas-reconcile/remove-root` | 移除root只清理所属执行 | 源码默认、packaged默认 |
| `surface-continuity/cutover` | 切面与重读保持原执行正文 | 源码默认、packaged默认 |
| `surface-continuity/completed-reflow` | 结束后重排保护保存尺寸 | 源码默认、packaged默认 |
| `surface-continuity/live-page-remount` | 活动执行下真实页面重建 | 新增源码/packaged默认；实跑结果独立记录 |
| `host-boundary-local/interrupt-and-flush` | 模拟Host边界中断并保存本地执行 | 源码默认、packaged默认 |
| `host-boundary-local/manual-terminal-start` | 边界后Terminal显式新启动 | 源码默认、packaged默认 |
| `host-boundary-local/explicit-new-start` | 边界后Agent/Terminal显式普通新Start | 源码默认、packaged默认 |
| `host-boundary-local/recent-state-flush` | 模拟Host边界flush近期本地状态 | 源码默认、packaged默认 |
| `host-boundary-local/preserve-terminal-state` | 自然或Stop终态经边界仍保持 | 新增源码/packaged默认；实跑结果独立记录 |
| `host-boundary-local/new-host-manual-recovery` | snapshot-only真正新Host恢复 | 新增源码/packaged默认；实跑结果独立记录 |
| `agent-tui/input-during-work` | 真实TUI处理中输入可用 | 新增待验 |
| `agent-tui/answer-with-footer` | 真实回答在footer上方正确呈现 | 新增待验 |
| `agent-tui/tool-network-silence` | 工具网络静默期间原回合仍处理中 | 新增待验 |
| `agent-tui/turn-completion-redraw` | 独立provider完成证据与完成后重绘 | 新增待验 |
| `execution-exit/native-crash` | 原生异常终止独立故障模型 | 新增源码/packaged默认；实跑结果独立记录 |
| `execution-exit/terminal-natural` | Terminal自然退出契约 | 新增源码/packaged默认；实跑结果独立记录 |
| `execution-exit/terminal-error` | Terminal异常退出契约 | 新增源码/packaged默认；实跑结果独立记录 |
| `execution-restart/terminal-after-exit` | Terminal自然异常退出后新Start | 新增源码/packaged默认；实跑结果独立记录 |
| `execution-stop/unresponsive` | 不响应Stop时升级与失败责任 | 新增源码/packaged默认；实跑结果独立记录 |
| `execution-resize/live-geometry` | 普通活动执行的独立几何resize正例 | 新增源码/packaged默认；实跑结果独立记录 |
| `output-pressure/resize` | 高输出中原PTY几何resize | 新增源码/packaged默认；实跑结果独立记录 |
| `output-pressure/full-integrity` | 高输出完整性独立验收 | 新增源码/packaged默认；实跑结果独立记录 |
| `agent-resume-context/manual-resume` | mount不自动继续且用户显式resume | 源码默认、packaged默认 |
| `agent-resume-context/claude-explicit-id` | 文件确认显式Claude ID经Stop保持 | 源码默认、packaged默认 |
| `terminal-links/file-position` | 文件链接打开准确行列 | 源码默认、packaged默认 |
| `terminal-links/image` | 图片链接进入正确tab | 源码默认、packaged默认 |
| `terminal-links/cwd-and-multiline` | cwd相对及多行rg链接 | 源码默认、packaged默认 |
| `terminal-links/missing-fallback` | 缺文件降级quickOpen | 源码默认、packaged默认 |
| `terminal-links/url-and-osc8` | URL提示浏览器路由与OSC8 | 源码默认、packaged默认 |
| `terminal-links/opener-error` | opener失败准确反馈 | 源码默认、packaged默认 |
| `terminal-resource-drop/first-resource` | 拖放只消费第一个含空格资源 | 源码默认、packaged默认 |
| `execution-concurrency/agent-terminal` | 普通Agent和Terminal并发不串流 | 源码默认、packaged默认 |
| `output-pressure/flood-fairness` | 持续输出下选择响应与新增执行公平性 | 源码默认、packaged默认 |
| `output-pressure/ctrl-c-retains-session` | Ctrl-C中断前台命令而原PTY保持 | 源码默认、packaged默认 |
| `runtime-projection/checkpoint-current-state` | 分页current-state与连续修订 | 源码默认 |
| `runtime-projection/completed-no-history` | 完成drain后丢弃history | 源码默认、packaged默认 |
| `runtime-projection/completed-page-reopen` | 已完成无history会话页面重开保持空正文 | 源码默认 |
| `runtime-projection/legacy-completed-migration` | 旧stream已完成数据迁移清除正文与pending意图 | 源码默认 |
| `runtime-recovery/legacy-binding` | 旧binding重连拒绝后保持责任 | 源码focused-only |
| `runtime-recovery/legacy-no-auto-resume` | 恢复旧history不自动resume | 源码focused-only |
| `runtime-compatibility/report-unavailable` | Linux activate前report不可用 | 源码focused-only |
| `canvas-entry/first-template` | 公共入口首次打开默认模板 | 源码默认、packaged默认 |
| `canvas-entry/surface-sidebar` | 可信空画布panel/editor及sidebar摘要 | 源码默认、packaged默认 |
| `canvas-protocol/unknown-message` | unknown消息错误与toast消退 | 源码默认、packaged默认 |
| `canvas-protocol/missing-node` | 未知节点操作反馈与基线保护 | 源码默认、packaged默认 |
| `canvas-protocol/lifecycle-race` | 隔离fake生命周期诊断 | 源码默认、packaged默认 |
| `canvas-nodes/note-host-update` | Host修改Note标题内容与位置 | 源码默认、packaged默认 |
| `canvas-nodes/post-delete-state` | 删除后结构快照断言 | 源码默认、packaged默认 |
| `restricted-workspace/entry` | 受限空画布与sidebar | 源码默认 |
| `restricted-workspace/webview-create` | webview拒Agent/Terminal创建但允许Note | 源码默认 |
| `restricted-workspace/quickpick-terminal` | QuickPick拒Terminal创建 | 源码默认 |
| `restricted-workspace/quickpick-agent` | QuickPick拒Agent创建 | 源码默认 |
| `restricted-workspace/execution-actions` | 禁止Agent/Terminal start/input并显示overlay | 源码默认 |
| `supervisor-upgrade/generation-continuity` | 旧v1/上一代stream/当前代attach-input-resize-stop-delete组合 | 源码默认 |
| `runtime-reopen/local` | 本地两阶段重开 | 源码默认 |
| `runtime-reopen/multi-root` | multi-root两阶段重开 | 源码默认 |
| `runtime-reopen/single-to-multi-root` | single到multi重开 | 源码默认 |
| `runtime-reopen/systemd-user` | systemd shim成功后重开 | 源码默认 |
| `runtime-reopen/systemd-fallback` | 缺bus提交前fallback与零提交 | 源码默认 |
| `runtime-reopen/ssh-host-exit` | SSH断client后原Host退出 | 源码默认 |
| `runtime-reopen/ssh-host-retain` | SSH断client后原Host保留 | 源码默认 |
| `shared-runtime-windows/owner-attacher` | 双窗口结构执行模式与接管组合 | 源码默认 |
| `canvas-entry/trusted-templates` | 可信模板保存导入导出与清理 | 源码默认、packaged默认 |
| `agent-resume-context/codex-locator` | Codex文件身份定位 | 源码默认、packaged默认 |
| `agent-resume-context/claude-locator` | Claude文件身份定位 | 源码默认、packaged默认 |
| `agent-resume-context/codex-hint` | Codex恢复提示解析 | 源码默认、packaged默认 |
| `agent-resume-context/claude-hint` | Claude恢复提示解析 | 源码默认、packaged默认 |
| `execution-config/cli-cache` | CLI缓存隔离 | 源码默认、packaged默认 |
| `execution-config/default-provider` | 默认provider刷新 | 源码默认、packaged默认 |
| `execution-config/scrollback` | scrollback运行上下文刷新 | 源码默认、packaged默认 |
| `execution-config/stopped-shell` | 已停止Terminal shell路径刷新 | 源码默认、packaged默认 |
| `execution-config/detected-shell` | 持久化精确探测shell路径 | 源码默认、packaged默认 |
| `execution-config/workspace-shell` | shell workspace override | 源码默认、packaged默认 |
| `canvas-entry/default-surface-reload` | 默认surface配置经reload生效 | 源码默认、packaged默认 |
| `canvas-nodes/create-quickpick` | QuickPick创建节点 | 源码默认、packaged默认 |
| `execution-config/default-root` | 默认执行metadata采用workspace root | 源码默认、packaged默认 |
| `execution-config/relative-shell` | 相对shell路径依workspace root | 源码默认、packaged默认 |
| `canvas-nodes/explorer-create` | Explorer资源创建执行节点 | 源码默认、packaged默认 |
| `canvas-nodes/create-open-surface` | 创建使用已打开surface | 源码默认、packaged默认 |
| `canvas-nodes/create-selected-mode` | QuickPick保留模式直到用户编辑 | 源码默认、packaged默认 |
| `canvas-nodes/create-preset-intent` | QuickPick保留显式preset意图 | 源码默认、packaged默认 |
| `canvas-nodes/legacy-filter` | 持久化过滤旧Task节点 | 源码默认、packaged默认 |
| `canvas-nodes/empty-group-delete` | 空组删除无确认 | 源码默认、packaged默认 |
| `canvas-nodes/nested-group-delete` | 嵌套组删除展示递归范围 | 源码默认、packaged默认 |
| `canvas-nodes/layout` | 画布布局持久化 | 源码默认、packaged默认 |
| `canvas-sidebar/node-list` | 侧栏节点列表 | 源码默认、packaged默认 |
| `canvas-sidebar/node-quickpick` | 侧栏QuickPick节点与session身份 | 源码默认、packaged默认 |
| `canvas-sidebar/node-ui` | 侧栏节点真实UI | 源码默认、packaged默认 |
| `canvas-protocol/real-probe` | 真实Webview probe | 源码默认、packaged默认 |
| `canvas-nodes/dom-edit` | 真实DOM编辑节点与Note基线 | 源码默认、packaged默认 |
| `canvas-notes/checklist` | Note交互清单 | 源码默认、packaged默认 |
| `canvas-notes/file-links` | Note workspace文件链接 | 源码默认、packaged默认 |
| `canvas-notes/markdown-association` | Note Markdown文件关联 | 源码默认、packaged默认 |
| `canvas-nodes/saved-size` | 节点尺寸持久化 | 源码默认、packaged默认 |
| `execution-notifications/bridge-migration` | 旧注意通知bridge迁移 | 源码默认、packaged默认 |
| `execution-notifications/attention` | 注意信号配置与通知反馈 | 源码默认、packaged默认 |
| `execution-notifications/abnormal` | 异常中断通知 | 源码默认、packaged默认 |
| `terminal-view/local-scrollback` | snapshot-only配置scrollback与边界恢复 | 源码默认、packaged默认 |
| `terminal-view/editor-viewport` | Editor tab切换保留viewport | 源码默认、packaged默认 |
| `terminal-view/panel-viewport` | Panel tab切换保留viewport | 源码默认、packaged默认 |
| `terminal-view/workbench-theme` | Editor/Panel主题跟随workbench | 源码默认、packaged默认 |
| `canvas-reconcile/completed-state` | 已完成节点和Note重读保持 | 源码默认、packaged默认 |
| `canvas-protocol/standby` | standby surface忽略消息 | 源码默认、packaged默认 |
| `canvas-protocol/pending-fault` | pending请求故障与责任保护 | 源码默认、packaged默认 |
| `runtime-recovery/live-persistence` | runtime保持原session及启动停止责任 | 源码默认、packaged默认 |
| `terminal-view/runtime-scrollback` | runtime更新scrollback重建与正文 | 源码默认、packaged默认 |
| `runtime-recovery/binding-failure` | 重连失败保持原binding | 源码默认、packaged默认 |
| `runtime-recovery/no-stale-resume` | 恢复history忽略过时自动resume | 源码默认、packaged默认 |
| `runtime-recovery/exit-classification` | runtime恢复退出分类与摘要 | 源码默认、packaged默认 |
| `runtime-recovery/immediate-boundary` | 启动后立即模拟Host边界 | 源码默认、packaged默认 |
| `canvas-nodes/dom-delete` | 真实删除按钮与移除 | 源码默认、packaged默认 |
| `canvas-nodes/manual-edge` | 手动边生命周期 | 源码默认、packaged默认 |
| `execution-file-activity/views` | 文件活动view与打开 | 源码默认、packaged默认 |
| `execution-file-activity/read-exit-drain` | read-exit末尾文件活动drain | 源码默认、packaged默认 |
| `runtime-mode/reload-clear` | 持久化配置经reload生效与清理 | 源码默认、packaged默认 |
| `session-history/restore` | 侧栏历史restore | 源码默认、packaged默认 |
| `session-history/fork-ui` | 侧栏fork UI | 源码默认、packaged默认 |
| `session-history/codex-branch` | 当前Codex节点branch | 源码默认、packaged默认 |
| `session-history/claude-branch` | 当前Claude节点branch | 源码默认、packaged默认 |
| `session-history/branch-rejection` | 不支持源拒绝branch | 源码默认、packaged默认 |
| `session-history/search` | 侧栏按title搜索历史 | 源码默认、packaged默认 |
| `session-history/doubleclick` | 历史双击UI | 源码默认、packaged默认 |
| `restricted-workspace/templates` | 受限模板行为 | 源码默认 |
| `restricted-workspace/diagnostics` | 受限操作诊断 | 源码默认 |
| `restricted-workspace/reconnect` | 受限runtime reconnect阻止 | 源码默认 |
| `restricted-workspace/history-delete` | 受限history-only删除清理 | 源码默认 |
| `restricted-workspace/mode` | 受限模式配置生效与清理 | 源码默认 |
| `restricted-workspace/history-disabled` | 受限历史restore禁用 | 源码默认 |

## 原01–07语义覆盖逐项去向

行号范围定位旧helper，语义项是人工核对的业务目标，不是自动生成的测试数。独立case不得丢掉helper其他断言；fixture和清理单独记角色。

| 旧helper | 语义项 | 去向 | 角色与原证据 |
| --- | --- | --- | --- |
| `verifyAgentExecutionFlow:5211` | 原started及初始尺寸 | `execution-start/auto-start` | action-assert；原session/generation、live、正行列 |
| `verifyAgentExecutionFlow:5211` | 有限burst1普通正文 | `execution-io/agent-line` | action-assert；原session burst001与活动快照 |
| `verifyAgentExecutionFlow:5211` | burst状态转换 | `agent-state-fixture/burst-prompt` | action-assert；running→waiting-input；仅fake启发式 |
| `verifyAgentExecutionFlow:5211` | 分段输入 | `execution-io/agent-partial` | action-assert；h未提交、ello后原hello正文 |
| `verifyAgentExecutionFlow:5211` | sleep状态 | `agent-state-fixture/sleep` | action-assert；受控sleep中仍running、woke后waiting-input |
| `verifyAgentExecutionFlow:5211` | slowspin状态 | `agent-state-fixture/spinner` | action-assert；重绘期间running、done后waiting-input |
| `verifyAgentExecutionFlow:5211` | 自然exit0 | `execution-exit/natural-zero` | action-assert；stopped、code0、摘要、无runtimeError、原saved/reader applied、单次exit和final序列 |
| `verifyAgentExecutionFlow:5211` | 自然结束后再次启动 | `execution-restart/after-natural` | action-assert；旧执行退休后新started、新正文；拆分时补明确新身份正例 |
| `verifyAgentExecutionFlow:5211` | 重复Agent Start拒绝 | `execution-start/duplicate` | action-assert；拒绝类别与原identity、started事件不增 |
| `verifyAgentExecutionFlow:5211` | 明确Agent Stop | `execution-stop/agent` | action-assert；stopped/livefalse、原执行退役 |
| `verifyTerminalExecutionFlow:6697` | 原Terminal started | `execution-start/auto-start` | action-assert；原session/generation、live及尺寸 |
| `verifyTerminalExecutionFlow:6697` | 重复Terminal Start拒绝 | `execution-start/duplicate` | action-assert；原identity/started数保持 |
| `verifyTerminalExecutionFlow:6697` | Terminal正文与live快照 | `execution-io/terminal-line`、`execution-io/live-snapshot` | action-assert；拆分printf排回显、原live snapshot正文和行列 |
| `verifyTerminalExecutionFlow:6697` | Terminal Stop | `execution-stop/terminal` | action-assert；closed/livefalse、准确摘要、保存与退役 |
| `verifyTerminalExecutionFlow:6697` | closed后页面resize保护 | `surface-continuity/completed-reflow` | action-assert；保存cols/rows及serializedState不变；不是live几何resize |
| `verifyOwnedCanvasReconciliation:5132` | 画布reload/set无重新启动 | `canvas-reconcile/reread` | action-assert；两原started、原session列表不变 |
| `verifyOwnedCanvasReconciliation:5132` | root映射后输入 | `canvas-reconcile/root-remap` | action-assert；nodeId可变化、原执行及输入正文保持 |
| `verifyOwnedCanvasReconciliation:5132` | 移除root的原责任 | `canvas-reconcile/remove-root` | action-assert；第三执行保存、移除所属node；原两执行保持、无projectionRejected |
| `verifyOwnedCanvasReconciliation:5132` | 模拟Host边界保存 | `host-boundary-local/interrupt-and-flush` | action-assert；localExecutions清空与两原saved |
| `verifyOwnedCanvasReconciliation:5132` | 边界后显式启动 | `host-boundary-local/explicit-new-start` | action-assert；旧原责任完成后显式新Start；这是Host中断后新Start，不能代证用户Stop后重启 |
| `verifyRuntimeReloadRecovery:8894` | 新原执行就绪及fake trap前提 | `host-boundary-local/interrupt-and-flush` | prepare；两原started、burst答复证明fake trap安装 |
| `verifyRuntimeReloadRecovery:8894` | 模拟边界正确恢复状态 | `host-boundary-local/interrupt-and-flush` | action-assert；Agent resume-ready/pending空/livefalse、Terminal interrupted/livefalse |
| `verifyRuntimeReloadRecovery:8894` | 中断后mount不自动resume | `agent-resume-context/manual-resume` | action-assert；close/open后无新增start、无活动Agent record、providerID保持 |
| `verifyRuntimeReloadRecovery:8894` | 用户显式resume | `agent-resume-context/manual-resume` | action-assert；新execution与原providerID、resumed正文、burst输入输出 |
| `verifyRuntimeReloadRecovery:8894` | resume后exit19 | `execution-exit/resumed-nonzero` | action-assert；error/code19与摘要，不能误报resume-failed |
| `verifyRuntimeReloadRecovery:8894` | 边界后Terminal显式Start | `host-boundary-local/manual-terminal-start` | action-assert；显式请求后live；新设计需同身份started |
| `verifyLiveSessionCutoverAndReload:9040` | 切面及重读连续性 | `surface-continuity/cutover` | action-assert；editor/panel原生命周期快照与marker、原identity/generation、真实页面正文 |
| `verifyLiveSessionCutoverAndReload:9040` | 组合结束后四marker保存 | `surface-continuity/cutover` | action-assert；Stop后原保存含四marker并退役；保留为连续性后置断言，不替代独立Stop |
| `verifyMissingAgentCliFailure:9399` | 缺CLI未取得进程 | `execution-start/missing-cli` | action-assert；unique新node、error、pending清、无started、startFailed/startRequested、单次not-required未提交保存、一次Host错误、record释放 |
| `verifyMissingAgentCliFailure:9399` | 删除失败节点 | `execution-start/missing-cli` | cleanup；删除后节点不存在 |
| `verifyExecutionTerminalNativeInteractions:8055` | 私有资源与原Terminal | `terminal-resource-drop/first-resource`、`terminal-links/file-position` | prepare；文件/server/config准备、原started |
| `verifyExecutionTerminalNativeInteractions:8055` | 多资源拖放只首项 | `terminal-resource-drop/first-resource` | action-assert；含空格路径准确引用、原正文只首资源、dropPrepared |
| `verifyExecutionTerminalNativeInteractions:8055` | 文件行列打开 | `terminal-links/file-position` | action-assert；真实页面link、Editor URI/line/character |
| `verifyExecutionTerminalNativeInteractions:8055` | 图片链接 | `terminal-links/image` | action-assert；原页面marker与vscode.open/custom tab |
| `verifyExecutionTerminalNativeInteractions:8055` | opener拒绝 | `terminal-links/opener-error` | action-assert；synthetic拒绝准确diagnostic；不宣称真实opener已失败 |
| `verifyExecutionTerminalNativeInteractions:8055` | cwd及多行rg链接 | `terminal-links/cwd-and-multiline` | action-assert；cwd后相对文件、多行path+line结果、正确URI/行列 |
| `verifyExecutionTerminalNativeInteractions:8055` | 缺文件降级 | `terminal-links/missing-fallback` | action-assert；原页面link与quickOpen openerKind准确 |
| `verifyExecutionTerminalNativeInteractions:8055` | URL提示浏览器和OSC8 | `terminal-links/url-and-osc8` | action-assert；原页面tooltip、localhost simpleBrowser路由、OSC8交互 |
| `verifyExecutionTerminalNativeInteractions:8055` | 原正文排除回显与旧history | `terminal-links/file-position`、`terminal-links/image`、`terminal-links/cwd-and-multiline`、`terminal-links/missing-fallback`、`terminal-links/url-and-osc8` | action-assert；unique分段marker、原identity/真实页面可见内容 |
| `verifyExecutionTerminalNativeInteractions:8055` | 链接清理与取证 | `terminal-links/file-position`、`terminal-links/opener-error` | cleanup；清hover、server close、配置恢复、openEditor；Stop旧fixture是准备而非链接业务 |
| `verifyStopVsQueuedExitRace:9865` | 睡眠和排队exit后Stop | `execution-stop/codex-queued-exit` | action-assert；原started、sleep已输出、Stop压过exit9、单INT、exit0、Token usage/resume尾部、saved/reader/exit各一次及原final序列 |
| `verifyClaudeStopRestoresPreviousSignal:9944` | Claude Stop正确收口 | `execution-stop/claude-graceful` | action-assert；原started与hello、stopped、原退役、无第二Ctrl-C/forcekill、无虚假恢复ID |
| `verifyClaudeStopRestoresPreviousSignal:9944` | 删除Claude fixture | `execution-stop/claude-graceful` | cleanup；删除并确认不存在 |
| `verifyClaudeExplicitSessionIdPreservesResumeContext:10036` | 文件确认原候选身份 | `agent-resume-context/claude-explicit-id` | action-assert；seed transcript、显式sessionID/strategy确认；Stop后保持同值 |
| `verifyClaudeExplicitSessionIdPreservesResumeContext:10036` | 删除节点与transcript | `agent-resume-context/claude-explicit-id` | cleanup；原Stop/退役后delete、私有文件清理 |
| `verifyPtyRobustness:9129` | 有限burst80 | `execution-io/bounded-burst` | action-assert；末marker080、原执行waiting-input；非全80行完整性 |
| `verifyPtyRobustness:9129` | 非零exit17 | `execution-exit/nonzero` | action-assert；error/code17/摘要、原资源退休；不是原生崩溃 |
| `verifyPtyRobustness:9129` | 异常后新启动 | `execution-restart/after-error` | action-assert；第二execution与第一不同且原started |
| `verifyPtyRobustness:9129` | 第二执行显式Stop | `execution-stop/agent` | action-assert；stopped/livefalse与第二原资源退休 |
| `verifyPtyRobustness:9129` | Stop后新启动 | `execution-restart/after-stop` | action-assert；第三execution与第二不同且原started |
| `verifyPtyRobustness:9129` | 普通Agent/Terminal并发 | `execution-concurrency/agent-terminal` | action-assert；两原started、分别回应、两个原live xterm-serialize-v1 snapshot |
| `verifyPtyRobustness:9129` | 并发资源清理 | `execution-concurrency/agent-terminal` | cleanup；两终态及原退休；分离记录清理 |
| `verifyTerminalFloodKeepsCanvasResponsive:9226` | 压力前提 | `output-pressure/flood-fairness` | prepare；各原started、真实DOM发送无限输出、原marker8秒 |
| `verifyTerminalFloodKeepsCanvasResponsive:9226` | 压力中Note和已有Agent | `output-pressure/flood-fairness` | action-assert；Note真实选中8秒、原Agent响应15秒 |
| `verifyTerminalFloodKeepsCanvasResponsive:9226` | 压力中新节点与第二流 | `output-pressure/flood-fairness` | action-assert；新Terminal/Agent created/started、第二无限流8秒与新Agent回应15秒 |
| `verifyTerminalFloodKeepsCanvasResponsive:9226` | Ctrl-C后原PTY输入有效 | `output-pressure/ctrl-c-retains-session` | action-assert；两原Terminal在Ctrl-C后分别printf新marker15秒且live，不停止PTY |
| `verifyTerminalFloodKeepsCanvasResponsive:9226` | 压力资源清理 | `output-pressure/flood-fairness`、`output-pressure/ctrl-c-retains-session` | cleanup；Stop四执行与退役、删除secondary；不是Ctrl-C目标 |
| `verifyFailurePaths:9495` | 其余拒绝及基线保护 | `execution-start/invalid-launch`、`canvas-protocol/missing-node` | action-assert；invalid跨provider/create或seed launch拒绝、missingAgent/Terminal/delete准确反馈、基线标题body/closed保持 |

## checkpoint额外语义划分

完成后的页面重开与旧stream完成数据迁移是不同契约，分别设case；运行态Host重建与连续分页仍保留同原session因果步骤。

| 来源 | 目标 | case | 原证据 |
| --- | --- | --- | --- |
| `runRuntimeCheckpointRefreshSmoke:310` | 运行态current-state及Host重建 | `runtime-projection/checkpoint-current-state` | 18000行、空Host cached events、paged current-state descriptor、完整连续chunk/codec、post-capture修订、原session及页面正文 |
| `runRuntimeCheckpointRefreshSmoke:310` | 完成后drain与历史丢弃 | `runtime-projection/completed-no-history` | 完成后的当前页面原marker、两节点historyDiscarded、持久化metadata契约 |
| `runRuntimeCheckpointRefreshSmoke:310` | 完成后页面重开无旧正文 | `runtime-projection/completed-page-reopen` | 关闭页面并模拟边界后，snapshot livefalse/output空，无stream/read/serializedState，真实页面无旧marker |
| `runRuntimeCheckpointRefreshSmoke:310` | 旧已完成stream迁移 | `runtime-projection/legacy-completed-migration` | seed旧stream及pending start，重读清除旧正文/summary/pending，无history复活，落盘无OLD_COMPLETED_HISTORY |

## 公共入口前置

首次模板验收从每次通用前置归入独立目标，其余case只执行自己所需activate/ready/reset准备。report不可用case必须另走activate前边界。

| 旧调用与行 | 角色 | 去向 |
| --- | --- | --- |
| `activateVisibleExtension:183` | prepare | `canvas-entry/first-template` |
| `waitForCommand:184` | prepare | `canvas-entry/first-template` |
| `vscode.commands.executeCommand:185` | prepare | `canvas-entry/first-template` |
| `waitForCommand:186` | prepare | `canvas-entry/first-template` |
| `vscode.commands.getCommands:188` | observe-assert | `canvas-entry/first-template` |
| `verifyFirstOpenDefaultTemplate:193` | action-assert | `canvas-entry/first-template` |
| `vscode.commands.executeCommand:194` | prepare | `canvas-entry/first-template` |
| `clearHostMessages:195` | prepare | `canvas-entry/first-template` |
| `clearDiagnosticEvents:196` | prepare | `canvas-entry/first-template` |
| `verifyWebviewLifecycleRaceDiagnostics:300` | action-assert | `canvas-protocol/lifecycle-race` |

## trusted / restricted 全部直接await调用

逐调用标注准备、动作/断言、观察、清理或证据消费者；同一helper出现在不同上下文时保留每个调用，不用一条“保留trusted”代替。ordinal是直接await出现顺序，包含modal内部await。调用后直接assert属于相应观察项；内部断言仍需实施review。

| suite / 顺序 | 旧调用与行 | 角色 | 拟议case | 迁移要求 |
| --- | --- | --- | --- | --- |
| runTrustedSmoke / 1 | `vscode.commands.executeCommand:1274` | prepare | `canvas-entry/surface-sidebar` | 打开panel/editor与ready，清空观测消息；不启动执行 |
| runTrustedSmoke / 2 | `vscode.commands.executeCommand:1275` | prepare | `canvas-entry/surface-sidebar` | 打开panel/editor与ready，清空观测消息；不启动执行 |
| runTrustedSmoke / 3 | `clearHostMessages:1276` | prepare | `canvas-entry/surface-sidebar` | 打开panel/editor与ready，清空观测消息；不启动执行 |
| runTrustedSmoke / 4 | `getDebugSnapshot:1278` | observe-assert | `canvas-entry/surface-sidebar` | 快照和sidebar摘要后的直接assert必须迁移 |
| runTrustedSmoke / 5 | `vscode.commands.executeCommand:1285` | prepare | `canvas-entry/surface-sidebar` | 打开panel/editor与ready，清空观测消息；不启动执行 |
| runTrustedSmoke / 6 | `vscode.commands.executeCommand:1286` | prepare | `canvas-entry/surface-sidebar` | 打开panel/editor与ready，清空观测消息；不启动执行 |
| runTrustedSmoke / 7 | `clearHostMessages:1287` | prepare | `canvas-entry/surface-sidebar` | 打开panel/editor与ready，清空观测消息；不启动执行 |
| runTrustedSmoke / 8 | `getDebugSnapshot:1289` | observe-assert | `canvas-entry/surface-sidebar` | 快照和sidebar摘要后的直接assert必须迁移 |
| runTrustedSmoke / 9 | `getSidebarSummaryItems:1298` | observe-assert | `canvas-entry/surface-sidebar` | 快照和sidebar摘要后的直接assert必须迁移 |
| runTrustedSmoke / 10 | `verifyCanvasTemplatesTrusted:1333` | action-assert | `canvas-entry/trusted-templates` | 迁移该helper全部业务断言；内部fixture/清理需拆分并逐条review |
| runTrustedSmoke / 11 | `ensureEditorCanvasReady:1334` | prepare | `agent-resume-context/codex-locator`、`execution-config/cli-cache`、`canvas-protocol/unknown-message` | 模板完成后恢复editor与清观测缓存；新case各自准备 |
| runTrustedSmoke / 12 | `clearHostMessages:1335` | prepare | `agent-resume-context/codex-locator`、`execution-config/cli-cache`、`canvas-protocol/unknown-message` | 模板完成后恢复editor与清观测缓存；新case各自准备 |
| runTrustedSmoke / 13 | `clearDiagnosticEvents:1336` | prepare | `agent-resume-context/codex-locator`、`execution-config/cli-cache`、`canvas-protocol/unknown-message` | 模板完成后恢复editor与清观测缓存；新case各自准备 |
| runTrustedSmoke / 14 | `verifyCodexSessionIdLocator:1338` | action-assert | `agent-resume-context/codex-locator` | 迁移该helper全部业务断言；内部fixture/清理需拆分并逐条review |
| runTrustedSmoke / 15 | `verifyClaudeSessionIdLocator:1339` | action-assert | `agent-resume-context/claude-locator` | 迁移该helper全部业务断言；内部fixture/清理需拆分并逐条review |
| runTrustedSmoke / 16 | `verifyCodexResumeCommandHintParser:1340` | action-assert | `agent-resume-context/codex-hint` | 迁移该helper全部业务断言；内部fixture/清理需拆分并逐条review |
| runTrustedSmoke / 17 | `verifyClaudeResumeCommandHintParser:1341` | action-assert | `agent-resume-context/claude-hint` | 迁移该helper全部业务断言；内部fixture/清理需拆分并逐条review |
| runTrustedSmoke / 18 | `verifyAgentCliCacheIsolation:1342` | action-assert | `execution-config/cli-cache` | 迁移该helper全部业务断言；内部fixture/清理需拆分并逐条review |
| runTrustedSmoke / 19 | `dispatchWebviewMessage:1344` | action | `canvas-protocol/unknown-message` | 发unknown消息 |
| runTrustedSmoke / 20 | `getHostMessages:1345` | observe-assert | `canvas-protocol/unknown-message` | Host错误、toast出现及消退、空画布断言 |
| runTrustedSmoke / 21 | `waitForWebviewProbeOnSurface:1353` | observe-assert | `canvas-protocol/unknown-message` | Host错误、toast出现及消退、空画布断言 |
| runTrustedSmoke / 22 | `waitForWebviewProbeOnSurface:1359` | observe-assert | `canvas-protocol/unknown-message` | Host错误、toast出现及消退、空画布断言 |
| runTrustedSmoke / 23 | `getDebugSnapshot:1361` | observe-assert | `canvas-protocol/unknown-message` | Host错误、toast出现及消退、空画布断言 |
| runTrustedSmoke / 24 | `verifyRuntimeContextRefreshesDefaultAgentProvider:1364` | action-assert | `execution-config/default-provider` | 迁移该helper全部业务断言；内部fixture/清理需拆分并逐条review |
| runTrustedSmoke / 25 | `verifyRuntimeContextRefreshesTerminalScrollback:1365` | action-assert | `execution-config/scrollback` | 迁移该helper全部业务断言；内部fixture/清理需拆分并逐条review |
| runTrustedSmoke / 26 | `verifyTerminalShellPathRefreshesStoppedTerminalNode:1366` | action-assert | `execution-config/stopped-shell` | 迁移该helper全部业务断言；内部fixture/清理需拆分并逐条review |
| runTrustedSmoke / 27 | `verifySelectTerminalShellCommandPersistsExactDetectedPath:1367` | action-assert | `execution-config/detected-shell` | 迁移该helper全部业务断言；内部fixture/清理需拆分并逐条review |
| runTrustedSmoke / 28 | `verifySelectTerminalShellCommandUpdatesWorkspaceOverride:1368` | action-assert | `execution-config/workspace-shell` | 迁移该helper全部业务断言；内部fixture/清理需拆分并逐条review |
| runTrustedSmoke / 29 | `verifyDefaultSurfaceRequiresReload:1369` | action-assert | `canvas-entry/default-surface-reload` | 迁移该helper全部业务断言；内部fixture/清理需拆分并逐条review |
| runTrustedSmoke / 30 | `verifyCreateNodeCommandQuickPick:1370` | action-assert | `canvas-nodes/create-quickpick` | 迁移该helper全部业务断言；内部fixture/清理需拆分并逐条review |
| runTrustedSmoke / 31 | `verifyDefaultExecutionNodeMetadataUsesWorkspaceRoot:1371` | action-assert | `execution-config/default-root` | 迁移该helper全部业务断言；内部fixture/清理需拆分并逐条review |
| runTrustedSmoke / 32 | `verifyWorkspaceRelativeTerminalShellPathUsesWorkspaceRoot:1372` | action-assert | `execution-config/relative-shell` | 迁移该helper全部业务断言；内部fixture/清理需拆分并逐条review |
| runTrustedSmoke / 33 | `verifyExplorerResourceExecutionNodeCreation:1373` | action-assert | `canvas-nodes/explorer-create` | 迁移该helper全部业务断言；内部fixture/清理需拆分并逐条review |
| runTrustedSmoke / 34 | `verifyCreateNodeCommandUsesOpenCanvasSurface:1374` | action-assert | `canvas-nodes/create-open-surface` | 迁移该helper全部业务断言；内部fixture/清理需拆分并逐条review |
| runTrustedSmoke / 35 | `verifyCreateNodeCommandQuickPickKeepsSelectedModeUntilUserEdits:1375` | action-assert | `canvas-nodes/create-selected-mode` | 迁移该helper全部业务断言；内部fixture/清理需拆分并逐条review |
| runTrustedSmoke / 36 | `verifyCreateNodeCommandQuickPickPreservesExplicitPresetIntent:1376` | action-assert | `canvas-nodes/create-preset-intent` | 迁移该helper全部业务断言；内部fixture/清理需拆分并逐条review |
| runTrustedSmoke / 37 | `verifyPersistedStateFiltersLegacyTaskNodes:1377` | action-assert | `canvas-nodes/legacy-filter` | 迁移该helper全部业务断言；内部fixture/清理需拆分并逐条review |
| runTrustedSmoke / 38 | `clearHostMessages:1378` | prepare-observe | `canvas-nodes/legacy-filter`、`canvas-nodes/empty-group-delete` | 创建相关helper完成后确认空画布并重置观测 |
| runTrustedSmoke / 39 | `clearDiagnosticEvents:1379` | prepare-observe | `canvas-nodes/legacy-filter`、`canvas-nodes/empty-group-delete` | 创建相关helper完成后确认空画布并重置观测 |
| runTrustedSmoke / 40 | `getDebugSnapshot:1380` | prepare-observe | `canvas-nodes/legacy-filter`、`canvas-nodes/empty-group-delete` | 创建相关helper完成后确认空画布并重置观测 |
| runTrustedSmoke / 41 | `verifyEmptyGroupDeletionSkipsConfirmation:1383` | action-assert | `canvas-nodes/empty-group-delete` | 迁移该helper全部业务断言；内部fixture/清理需拆分并逐条review |
| runTrustedSmoke / 42 | `verifyNestedGroupDeletionConfirmationDisclosesRecursiveScope:1384` | action-assert | `canvas-nodes/nested-group-delete` | 迁移该helper全部业务断言；内部fixture/清理需拆分并逐条review |
| runTrustedSmoke / 43 | `verifyCanvasLayoutArrangementPersists:1385` | action-assert | `canvas-nodes/layout` | 迁移该helper全部业务断言；内部fixture/清理需拆分并逐条review |
| runTrustedSmoke / 44 | `clearHostMessages:1386` | prepare | `canvas-nodes/note-host-update` | 清消息 |
| runTrustedSmoke / 45 | `createBaseNodes:1387` | prepare | `canvas-nodes/note-host-update`、`execution-start/auto-start` | 旧fixture自动启动三种节点；新Note fixture不要隐含启动无关执行 |
| runTrustedSmoke / 46 | `getDebugSnapshot:1388` | observe-assert | `canvas-nodes/note-host-update` | 节点kind集合与后续Note/Agent/Terminal引用 |
| runTrustedSmoke / 47 | `dispatchWebviewMessage:1397` | action | `canvas-nodes/note-host-update` | 修改Note title/body/position |
| runTrustedSmoke / 48 | `dispatchWebviewMessage:1404` | action | `canvas-nodes/note-host-update` | 修改Note title/body/position |
| runTrustedSmoke / 49 | `dispatchWebviewMessage:1411` | action | `canvas-nodes/note-host-update` | 修改Note title/body/position |
| runTrustedSmoke / 50 | `getDebugSnapshot:1422` | observe-assert | `canvas-nodes/note-host-update` | 直接验证Note变更 |
| runTrustedSmoke / 51 | `verifyAutoStartOnCreate:1429` | action-assert | `execution-start/auto-start` | 迁移该helper全部业务断言；内部fixture/清理需拆分并逐条review |
| runTrustedSmoke / 52 | `stopOwnedFixtureExecutions:1430` | prepare | `canvas-sidebar/node-list`、`canvas-nodes/dom-edit` | 为历史/侧栏准备已退休基线；Stop不是本段业务目标 |
| runTrustedSmoke / 53 | `verifySidebarNodeList:1431` | action-assert | `canvas-sidebar/node-list` | 迁移该helper全部业务断言；内部fixture/清理需拆分并逐条review |
| runTrustedSmoke / 54 | `verifySidebarNodeListQuickPick:1432` | action-assert | `canvas-sidebar/node-quickpick` | 迁移该helper全部业务断言；内部fixture/清理需拆分并逐条review |
| runTrustedSmoke / 55 | `verifySidebarNodeListWebviewUi:1435` | action-assert | `canvas-sidebar/node-ui` | 迁移该helper全部业务断言；内部fixture/清理需拆分并逐条review |
| runTrustedSmoke / 56 | `verifyRealWebviewProbe:1437` | action-assert | `canvas-protocol/real-probe` | 迁移该helper全部业务断言；内部fixture/清理需拆分并逐条review |
| runTrustedSmoke / 57 | `verifyRealWebviewDomInteractions:1438` | action-assert | `canvas-nodes/dom-edit` | 迁移该helper全部业务断言；内部fixture/清理需拆分并逐条review |
| runTrustedSmoke / 58 | `verifyInteractiveNoteChecklist:1439` | action-assert | `canvas-notes/checklist` | 迁移该helper全部业务断言；内部fixture/清理需拆分并逐条review |
| runTrustedSmoke / 59 | `verifyNoteWorkspaceFileLinks:1440` | action-assert | `canvas-notes/file-links` | 迁移该helper全部业务断言；内部fixture/清理需拆分并逐条review |
| runTrustedSmoke / 60 | `verifyNoteMarkdownFileAssociation:1441` | action-assert | `canvas-notes/markdown-association` | 迁移该helper全部业务断言；内部fixture/清理需拆分并逐条review |
| runTrustedSmoke / 61 | `verifyNodeResizePersistence:1442` | action-assert | `canvas-nodes/saved-size` | 迁移该helper全部业务断言；内部fixture/清理需拆分并逐条review |
| runTrustedSmoke / 62 | `startFixtureExecutions:1443` | prepare | `execution-io/agent-line`、`execution-io/terminal-line` | 新case自己的原started屏障；不能沿用另一case的执行 |
| runTrustedSmoke / 63 | `verifyAgentExecutionFlow:1444` | action-assert | `execution-io/agent-line`、`execution-io/agent-partial`、`execution-io/live-snapshot`、`agent-state-fixture/burst-prompt`、`agent-state-fixture/sleep`、`agent-state-fixture/spinner`、`execution-exit/natural-zero`、`execution-restart/after-natural`、`execution-start/duplicate`、`execution-stop/agent` | 迁移该helper全部业务断言；内部fixture/清理需拆分并逐条review |
| runTrustedSmoke / 64 | `verifySidebarNodeListQuickPick:1445` | action-assert | `canvas-sidebar/node-quickpick` | 迁移该helper全部业务断言；内部fixture/清理需拆分并逐条review |
| runTrustedSmoke / 65 | `verifyTerminalExecutionFlow:1448` | action-assert | `execution-start/duplicate`、`execution-io/terminal-line`、`execution-io/live-snapshot`、`execution-stop/terminal`、`surface-continuity/completed-reflow` | 迁移该helper全部业务断言；内部fixture/清理需拆分并逐条review |
| runTrustedSmoke / 66 | `verifyLegacyAttentionNotificationBridgeMigration:1449` | action-assert | `execution-notifications/bridge-migration` | 迁移该helper全部业务断言；内部fixture/清理需拆分并逐条review |
| runTrustedSmoke / 67 | `verifyExecutionAttentionNotificationBridge:1450` | action-assert | `execution-notifications/attention` | 迁移该helper全部业务断言；内部fixture/清理需拆分并逐条review |
| runTrustedSmoke / 68 | `verifyAgentAbnormalInterruptionNotifications:1451` | action-assert | `execution-notifications/abnormal` | 迁移该helper全部业务断言；内部fixture/清理需拆分并逐条review |
| runTrustedSmoke / 69 | `verifyExecutionTerminalNativeInteractions:1452` | action-assert | `terminal-resource-drop/first-resource`、`terminal-links/file-position`、`terminal-links/image`、`terminal-links/cwd-and-multiline`、`terminal-links/missing-fallback`、`terminal-links/url-and-osc8`、`terminal-links/opener-error` | 迁移该helper全部业务断言；内部fixture/清理需拆分并逐条review |
| runTrustedSmoke / 70 | `verifyRuntimeReloadPreservesConfiguredTerminalScrollbackHistory:1453` | action-assert | `terminal-view/local-scrollback` | 迁移该helper全部业务断言；内部fixture/清理需拆分并逐条review |
| runTrustedSmoke / 71 | `verifyEditorTerminalTabSwitchPreservesViewport:1454` | action-assert | `terminal-view/editor-viewport` | 迁移该helper全部业务断言；内部fixture/清理需拆分并逐条review |
| runTrustedSmoke / 72 | `verifyPanelTerminalTabSwitchPreservesViewport:1455` | action-assert | `terminal-view/panel-viewport` | 迁移该helper全部业务断言；内部fixture/清理需拆分并逐条review |
| runTrustedSmoke / 73 | `verifyEmbeddedTerminalThemeFollowWorkbench:1456` | action-assert | `terminal-view/workbench-theme` | 迁移该helper全部业务断言；内部fixture/清理需拆分并逐条review |
| runTrustedSmoke / 74 | `verifyRuntimeReloadRecovery:1457` | action-assert | `host-boundary-local/interrupt-and-flush`、`agent-resume-context/manual-resume`、`execution-exit/resumed-nonzero`、`host-boundary-local/manual-terminal-start`、`canvas-entry/first-template` | 迁移该helper全部业务断言；内部fixture/清理需拆分并逐条review |
| runTrustedSmoke / 75 | `verifyLiveSessionCutoverAndReload:1458` | action-assert | `surface-continuity/cutover`、`canvas-entry/first-template` | 迁移该helper全部业务断言；内部fixture/清理需拆分并逐条review |
| runTrustedSmoke / 76 | `verifyPtyRobustness:1459` | action-assert | `execution-io/bounded-burst`、`execution-exit/nonzero`、`execution-restart/after-error`、`execution-stop/agent`、`execution-restart/after-stop`、`execution-concurrency/agent-terminal` | 迁移该helper全部业务断言；内部fixture/清理需拆分并逐条review |
| runTrustedSmoke / 77 | `verifyTerminalFloodKeepsCanvasResponsive:1460` | action-assert | `output-pressure/flood-fairness`、`output-pressure/ctrl-c-retains-session` | 迁移该helper全部业务断言；内部fixture/清理需拆分并逐条review |
| runTrustedSmoke / 78 | `verifyFailurePaths:1461` | action-assert | `execution-start/missing-cli`、`execution-start/invalid-launch`、`canvas-protocol/missing-node` | 迁移该helper全部业务断言；内部fixture/清理需拆分并逐条review |
| runTrustedSmoke / 79 | `verifyPersistenceAndRecovery:1462` | action-assert | `canvas-reconcile/completed-state` | 迁移该helper全部业务断言；内部fixture/清理需拆分并逐条review |
| runTrustedSmoke / 80 | `verifyStandbySurfaceIgnoresMessages:1463` | action-assert | `canvas-protocol/standby` | 迁移该helper全部业务断言；内部fixture/清理需拆分并逐条review |
| runTrustedSmoke / 81 | `verifyPendingWebviewRequestFaultInjection:1464` | action-assert | `canvas-protocol/pending-fault` | 迁移该helper全部业务断言；内部fixture/清理需拆分并逐条review |
| runTrustedSmoke / 82 | `verifyStopVsQueuedExitRace:1465` | action-assert | `execution-stop/codex-queued-exit` | 迁移该helper全部业务断言；内部fixture/清理需拆分并逐条review |
| runTrustedSmoke / 83 | `verifyClaudeStopRestoresPreviousSignal:1466` | action-assert | `execution-stop/claude-graceful` | 迁移该helper全部业务断言；内部fixture/清理需拆分并逐条review |
| runTrustedSmoke / 84 | `verifyClaudeExplicitSessionIdPreservesResumeContext:1467` | action-assert | `agent-resume-context/claude-explicit-id` | 迁移该helper全部业务断言；内部fixture/清理需拆分并逐条review |
| runTrustedSmoke / 85 | `prepareTrustedBaseNodesForAppliedRuntimePersistenceMode:1468` | prepare | `runtime-recovery/live-persistence`、`runtime-recovery/binding-failure`、`runtime-recovery/no-stale-resume`、`runtime-recovery/exit-classification`、`runtime-recovery/immediate-boundary`、`terminal-view/runtime-scrollback`、`runtime-projection/completed-no-history` | 旧runtime=true共享fixture需按目标重建；不丢每种binding状态 |
| runTrustedSmoke / 86 | `verifyLiveRuntimePersistence:1469` | action-assert | `runtime-recovery/live-persistence` | 迁移该helper全部业务断言；内部fixture/清理需拆分并逐条review |
| runTrustedSmoke / 87 | `verifyLiveRuntimeReloadPreservesUpdatedTerminalScrollbackHistory:1470` | action-assert | `terminal-view/runtime-scrollback` | 迁移该helper全部业务断言；内部fixture/清理需拆分并逐条review |
| runTrustedSmoke / 88 | `verifyCompletedLiveRuntimeDiscardsHistoryAfterDrain:1471` | action-assert | `runtime-projection/completed-no-history` | 迁移该helper全部业务断言；内部fixture/清理需拆分并逐条review |
| runTrustedSmoke / 89 | `verifyLiveRuntimeReconnectFailurePreservesBinding:1472` | action-assert | `runtime-recovery/binding-failure` | 迁移该helper全部业务断言；内部fixture/清理需拆分并逐条review |
| runTrustedSmoke / 90 | `verifyHistoryRestoredIgnoresStaleAutomaticResume:1476` | action-assert | `runtime-recovery/no-stale-resume` | 迁移该helper全部业务断言；内部fixture/清理需拆分并逐条review |
| runTrustedSmoke / 91 | `verifyLiveRuntimeResumeExitClassification:1480` | action-assert | `runtime-recovery/exit-classification` | 迁移该helper全部业务断言；内部fixture/清理需拆分并逐条review |
| runTrustedSmoke / 92 | `verifyImmediateReloadAfterLiveRuntimeLaunch:1481` | action-assert | `runtime-recovery/immediate-boundary` | 迁移该helper全部业务断言；内部fixture/清理需拆分并逐条review |
| runTrustedSmoke / 93 | `prepareTrustedBaseNodesForAppliedRuntimePersistenceMode:1486` | prepare | `host-boundary-local/recent-state-flush`、`canvas-nodes/dom-delete`、`canvas-nodes/manual-edge` | runtime=false新fixture；原执行与Note基线显式 |
| runTrustedSmoke / 94 | `verifyHostBoundaryFlushesRecentLocalState:1487` | action-assert | `host-boundary-local/recent-state-flush` | 迁移该helper全部业务断言；内部fixture/清理需拆分并逐条review |
| runTrustedSmoke / 95 | `verifyTrustedDiagnostics:1491` | evidence-consumer | `execution-exit/natural-zero`、`execution-io/terminal-line`、`execution-io/live-snapshot`、`execution-stop/terminal`、`execution-start/missing-cli` | 现有汇总检查返回证据，迁入证据产生case；缺项拒绝不能删除 |
| runTrustedSmoke / 96 | `verifyRealDeleteButton:1492` | action-assert | `canvas-nodes/dom-delete` | 迁移该helper全部业务断言；内部fixture/清理需拆分并逐条review |
| runTrustedSmoke / 97 | `getDebugSnapshot:1494` | observe-assert | `canvas-nodes/post-delete-state` | 删除Note后节点数与身份断言 |
| runTrustedSmoke / 98 | `verifyManualEdgeLifecycle:1498` | action-assert | `canvas-nodes/manual-edge` | 迁移该helper全部业务断言；内部fixture/清理需拆分并逐条review |
| runTrustedSmoke / 99 | `verifyFileActivityViewsAndOpenFiles:1499` | action-assert | `execution-file-activity/views` | 迁移该helper全部业务断言；内部fixture/清理需拆分并逐条review |
| runTrustedSmoke / 100 | `verifyReadExitFileActivityDrain:1500` | action-assert | `execution-file-activity/read-exit-drain` | 迁移该helper全部业务断言；内部fixture/清理需拆分并逐条review |
| runTrustedSmoke / 101 | `verifyRuntimePersistenceRequiresReloadAndClearsState:1501` | action-assert | `runtime-mode/reload-clear` | 迁移该helper全部业务断言；内部fixture/清理需拆分并逐条review |
| runTrustedSmoke / 102 | `verifySidebarSessionHistoryRestore:1502` | action-assert | `session-history/restore` | 迁移该helper全部业务断言；内部fixture/清理需拆分并逐条review |
| runTrustedSmoke / 103 | `verifySidebarSessionHistoryForkActionUi:1503` | action-assert | `session-history/fork-ui` | 迁移该helper全部业务断言；内部fixture/清理需拆分并逐条review |
| runTrustedSmoke / 104 | `verifyCodexAgentBranchFromCurrentNode:1504` | action-assert | `session-history/codex-branch` | 迁移该helper全部业务断言；内部fixture/清理需拆分并逐条review |
| runTrustedSmoke / 105 | `verifyClaudeAgentBranchFromCurrentNode:1505` | action-assert | `session-history/claude-branch` | 迁移该helper全部业务断言；内部fixture/清理需拆分并逐条review |
| runTrustedSmoke / 106 | `verifyAgentBranchRejectsUnsupportedSources:1506` | action-assert | `session-history/branch-rejection` | 迁移该helper全部业务断言；内部fixture/清理需拆分并逐条review |
| runTrustedSmoke / 107 | `verifySidebarSessionHistorySearchByTitleUi:1507` | action-assert | `session-history/search` | 迁移该helper全部业务断言；内部fixture/清理需拆分并逐条review |
| runTrustedSmoke / 108 | `verifySidebarSessionHistoryDoubleClickUi:1508` | action-assert | `session-history/doubleclick` | 迁移该helper全部业务断言；内部fixture/清理需拆分并逐条review |
| runTrustedSmoke / 109 | `vscode.commands.executeCommand:1510` | cleanup | `session-history/doubleclick`、`session-history/fork-ui`、`session-history/restore`、`session-history/search` | 关闭editor；记录清理结果不能当业务通过 |
| runRestrictedSmoke / 1 | `vscode.commands.executeCommand:4766` | prepare | `restricted-workspace/entry` | 受限环境editor ready，不启动执行 |
| runRestrictedSmoke / 2 | `vscode.commands.executeCommand:4767` | prepare | `restricted-workspace/entry` | 受限环境editor ready，不启动执行 |
| runRestrictedSmoke / 3 | `clearHostMessages:4768` | prepare | `restricted-workspace/entry` | 受限环境editor ready，不启动执行 |
| runRestrictedSmoke / 4 | `getDebugSnapshot:4770` | observe-assert | `restricted-workspace/entry` | trust、creatableKinds、surface与空节点断言 |
| runRestrictedSmoke / 5 | `verifyCanvasTemplatesRestricted:4778` | action-assert | `restricted-workspace/templates` | 迁移该helper全部业务断言；内部fixture/清理需拆分并逐条review |
| runRestrictedSmoke / 6 | `ensureEditorCanvasReady:4779` | prepare | `restricted-workspace/webview-create` | 模板完成后恢复页面与观测 |
| runRestrictedSmoke / 7 | `clearHostMessages:4780` | prepare | `restricted-workspace/webview-create` | 模板完成后恢复页面与观测 |
| runRestrictedSmoke / 8 | `dispatchWebviewMessage:4782` | action | `restricted-workspace/webview-create` | 用户webview创建Agent/Terminal/Note |
| runRestrictedSmoke / 9 | `dispatchWebviewMessage:4789` | action | `restricted-workspace/webview-create` | 用户webview创建Agent/Terminal/Note |
| runRestrictedSmoke / 10 | `dispatchWebviewMessage:4796` | action | `restricted-workspace/webview-create` | 用户webview创建Agent/Terminal/Note |
| runRestrictedSmoke / 11 | `getDebugSnapshot:4804` | observe-assert | `restricted-workspace/webview-create` | 只创建Note及准确拒绝反馈 |
| runRestrictedSmoke / 12 | `getHostMessages:4810` | observe-assert | `restricted-workspace/webview-create` | 只创建Note及准确拒绝反馈 |
| runRestrictedSmoke / 13 | `withInterceptedWarningMessages:4819` | action-assert | `restricted-workspace/quickpick-terminal` | 拦截modal内含真实QuickPick动作与准确警告断言 |
| runRestrictedSmoke / 14 | `setQuickPickSelections:4820` | prepare | `restricted-workspace/quickpick-terminal` | QuickPick选择 |
| runRestrictedSmoke / 15 | `vscode.commands.executeCommand:4821` | action | `restricted-workspace/quickpick-terminal` | createNode命令 |
| runRestrictedSmoke / 16 | `getDebugSnapshot:4831` | observe-assert | `restricted-workspace/quickpick-terminal` | 原Note集合不变 |
| runRestrictedSmoke / 17 | `withInterceptedWarningMessages:4837` | action-assert | `restricted-workspace/quickpick-agent` | 拦截modal内含真实QuickPick动作与准确警告断言 |
| runRestrictedSmoke / 18 | `setQuickPickSelections:4838` | prepare | `restricted-workspace/quickpick-agent` | QuickPick选择 |
| runRestrictedSmoke / 19 | `vscode.commands.executeCommand:4839` | action | `restricted-workspace/quickpick-agent` | createNode命令 |
| runRestrictedSmoke / 20 | `getDebugSnapshot:4849` | observe-assert | `restricted-workspace/quickpick-agent` | 原Note集合不变 |
| runRestrictedSmoke / 21 | `vscode.commands.executeCommand:4855` | prepare | `restricted-workspace/execution-actions` | test seed执行节点并清消息；不得auto-start |
| runRestrictedSmoke / 22 | `vscode.commands.executeCommand:4856` | prepare | `restricted-workspace/execution-actions` | test seed执行节点并清消息；不得auto-start |
| runRestrictedSmoke / 23 | `getDebugSnapshot:4857` | prepare | `restricted-workspace/execution-actions` | test seed执行节点并清消息；不得auto-start |
| runRestrictedSmoke / 24 | `clearHostMessages:4862` | prepare | `restricted-workspace/execution-actions` | test seed执行节点并清消息；不得auto-start |
| runRestrictedSmoke / 25 | `dispatchWebviewMessage:4863` | action | `restricted-workspace/execution-actions` | 分别请求Agent/Terminal start/input |
| runRestrictedSmoke / 26 | `dispatchWebviewMessage:4873` | action | `restricted-workspace/execution-actions` | 分别请求Agent/Terminal start/input |
| runRestrictedSmoke / 27 | `dispatchWebviewMessage:4882` | action | `restricted-workspace/execution-actions` | 分别请求Agent/Terminal start/input |
| runRestrictedSmoke / 28 | `dispatchWebviewMessage:4890` | action | `restricted-workspace/execution-actions` | 分别请求Agent/Terminal start/input |
| runRestrictedSmoke / 29 | `getHostMessages:4899` | observe-assert | `restricted-workspace/execution-actions` | 四种准确错误、live=false与真实受限overlay |
| runRestrictedSmoke / 30 | `getDebugSnapshot:4929` | observe-assert | `restricted-workspace/execution-actions` | 四种准确错误、live=false与真实受限overlay |
| runRestrictedSmoke / 31 | `waitForWebviewProbe:4933` | observe-assert | `restricted-workspace/execution-actions` | 四种准确错误、live=false与真实受限overlay |
| runRestrictedSmoke / 32 | `verifyRestrictedDiagnostics:4953` | action-assert | `restricted-workspace/diagnostics` | 迁移该helper全部业务断言；内部fixture/清理需拆分并逐条review |
| runRestrictedSmoke / 33 | `verifyRestrictedLiveRuntimeReconnectBlocked:4954` | action-assert | `restricted-workspace/reconnect` | 迁移该helper全部业务断言；内部fixture/清理需拆分并逐条review |
| runRestrictedSmoke / 34 | `prepareRestrictedBaseNodesForAppliedRuntimePersistenceMode:4955` | prepare | `restricted-workspace/history-delete` | history-only runtime节点，无真实执行 |
| runRestrictedSmoke / 35 | `verifyRestrictedDeleteCleansHistoryOnlyLiveRuntime:4956` | action-assert | `restricted-workspace/history-delete` | 迁移该helper全部业务断言；内部fixture/清理需拆分并逐条review |
| runRestrictedSmoke / 36 | `verifyRestrictedRuntimePersistenceRequiresReloadAndClearsState:4960` | action-assert | `restricted-workspace/mode` | 迁移该helper全部业务断言；内部fixture/清理需拆分并逐条review |
| runRestrictedSmoke / 37 | `verifyRestrictedSessionHistoryRestoreIsDisabled:4961` | action-assert | `restricted-workspace/history-disabled` | 迁移该helper全部业务断言；内部fixture/清理需拆分并逐条review |
| runRestrictedSmoke / 38 | `vscode.commands.executeCommand:4963` | cleanup | `restricted-workspace/history-disabled` | 关闭editor |

## 有限组合流程的具名步骤

这些步骤保留因果上下文，不能从中间直接过滤执行。定向某个步骤必须重建对应原前提；错误归属具体步骤。

| case | 步骤顺序 |
| --- | --- |
| `supervisor-upgrade/generation-continuity` | prepare-generations（准备v1/上一代stream进程与原session；当前代另建） → attach-and-output（恢复旧两代原binding，输入输出和快照） → resize（原Host/DOM/RPC/PTY几何与session/storage一致） → stop-old（Stop旧执行，分别确认PTY/Supervisor终态与Host消费） → delete-and-retire（删除旧绑定并确认旧客户端/责任退休） → new-generation-isolation（当前generation继续有效且不受旧清理影响） → cleanup（结束本次私有原进程与目录） |
| `shared-runtime-windows/owner-attacher` | owner-setup（owner窗口创建原共享root与执行） → attacher-setup（attacher握手并确认共享原session） → structure（共享Note/节点结构修改双向可见） → io-resize（两窗口原输入输出与resize） → stop-delete（共享Stop保留读者终态，Delete移除两方投影） → mode-takeover（配置边界、关闭隔离和最后窗口接管/清理） → empty-root-reopen（关闭两方后重开空共享root） → cleanup（窗口和私有资源结束） |
| `runtime-reopen/local` | setup（原runtime session started、活动及离线完成夹具准备、保存原身份） → transition（原client退出；SSH明确原Host exit/retain，Supervisor继续） → completed-barrier（拟议统一原Terminal完成屏障；现有本地固定3秒后在verify确认、SSH独立轮询） → verify（新窗口接回原session/root/storage与活动正文，完成会话准确终态） → resize（原PTY几何与页面目标/Host/RPC共同一致） → cleanup（结束本次私有责任） |
| `runtime-reopen/multi-root` | setup（原runtime session started、活动及离线完成夹具准备、保存原身份） → transition（原client退出；SSH明确原Host exit/retain，Supervisor继续） → completed-barrier（拟议统一原Terminal完成屏障；现有本地固定3秒后在verify确认、SSH独立轮询） → verify（新窗口接回原session/root/storage与活动正文，完成会话准确终态） → resize（原PTY几何与页面目标/Host/RPC共同一致） → cleanup（结束本次私有责任） |
| `runtime-reopen/single-to-multi-root` | setup（原runtime session started、活动及离线完成夹具准备、保存原身份） → transition（原client退出；SSH明确原Host exit/retain，Supervisor继续） → completed-barrier（拟议统一原Terminal完成屏障；现有本地固定3秒后在verify确认、SSH独立轮询） → verify（新窗口接回原session/root/storage与活动正文，完成会话准确终态） → resize（原PTY几何与页面目标/Host/RPC共同一致） → cleanup（结束本次私有责任） |
| `runtime-reopen/systemd-user` | setup（原runtime session started、活动及离线完成夹具准备、保存原身份） → transition（原client退出；SSH明确原Host exit/retain，Supervisor继续） → completed-barrier（拟议统一原Terminal完成屏障；现有本地固定3秒后在verify确认、SSH独立轮询） → verify（新窗口接回原session/root/storage与活动正文，完成会话准确终态） → resize（原PTY几何与页面目标/Host/RPC共同一致） → cleanup（结束本次私有责任） |
| `runtime-reopen/systemd-fallback` | setup（原runtime session started、活动及离线完成夹具准备、保存原身份） → transition（原client退出；SSH明确原Host exit/retain，Supervisor继续） → completed-barrier（拟议统一原Terminal完成屏障；现有本地固定3秒后在verify确认、SSH独立轮询） → verify（新窗口接回原session/root/storage与活动正文，完成会话准确终态） → resize（原PTY几何与页面目标/Host/RPC共同一致） → cleanup（结束本次私有责任） |
| `runtime-reopen/ssh-host-exit` | setup（原runtime session started、活动及离线完成夹具准备、保存原身份） → transition（原client退出；SSH明确原Host exit/retain，Supervisor继续） → completed-barrier（拟议统一原Terminal完成屏障；现有本地固定3秒后在verify确认、SSH独立轮询） → verify（新窗口接回原session/root/storage与活动正文，完成会话准确终态） → resize（原PTY几何与页面目标/Host/RPC共同一致） → cleanup（结束本次私有责任） |
| `runtime-reopen/ssh-host-retain` | setup（原runtime session started、活动及离线完成夹具准备、保存原身份） → transition（原client退出；SSH明确原Host exit/retain，Supervisor继续） → completed-barrier（拟议统一原Terminal完成屏障；现有本地固定3秒后在verify确认、SSH独立轮询） → verify（新窗口接回原session/root/storage与活动正文，完成会话准确终态） → resize（原PTY几何与页面目标/Host/RPC共同一致） → cleanup（结束本次私有责任） |

## 静态核对

在仓库根执行 `python3 docs/references/release-gate-flow-audit/smoke-redesign/verify.py`。它直接重读当前runner和suite，检查输入HEAD中的源码hash、19/8/3入口顺序、109/38调用及所有迁移引用；不导入VS Code，不将stub成功当业务通过。可复核结果见[verification.json](verification.json)，机器清单见[coverage-map.json](coverage-map.json)。

此检查不证明fixture独立、断言等价、Host预算稳定或实际产品通过。后续实施须按设计的迁移顺序补真实与受控验证，并重新核对变动源码。
