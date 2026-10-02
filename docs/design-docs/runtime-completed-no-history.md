---
title: Runtime 已结束会话不保留重开历史
decision_status: 已选定
validation_status: 验证中
domains:
  - 执行编排域
  - 项目状态域
architecture_layers:
  - 宿主集成层
  - 画布呈现层
  - 共享模型与编排层
related_specs:
  - docs/product-specs/runtime-persistence-modes.md
related_plans:
  - docs/exec-plans/completed/runtime-completed-no-history.md
updated_at: 2026-09-18
---

# Runtime 已结束会话不保留重开历史

## 需求与决策

2026-09-17 用户明确：正常结束的节点重新打开时也不需要恢复进程、不需要保留历史。这修订了此前正常 completed 必须持久化完整终端数据的决策，不是对旧规格下实现 bug 的追认。F-05 不再以独立归档为默认解法。

这里的结束是 Supervisor 已确认 PTY 退出，包括自然退出和用户停止；进程仍活着的 Agent 等待输入不算结束。退出错误仍保留退出诊断，但不建立终端历史归档。Supervisor 崩溃/机器重启不保证恢复的既有边界不变。

## 正式方案

以下源码路径均相对于 `extensions/vscode/dev-session-canvas/src/`。

`panel/CanvasPanelManager.ts` 的 `applyCompletedRuntimeSupervisorSnapshot()` 只将节点、布局、启动配置、最后生命周期和退出结果交给画板持久化。清除 runtime 绑定、自动启动意图、`terminalStream`、`serializedTerminalState`、`recentOutput` 与输出派生标题；用 `terminalHistoryDiscarded` 标记已结束且无恢复内容。重开节点保持退出状态，不 attach、自动 start 或 provider resume。用户显式重新启动或 resume 仍是新执行，不删除 provider 自己的会话文件。

当前已打开页面仍应收齐最后输出，不能以不保存历史为由截断已进入 journal 的内容。第五批 `runtime-paged-completion.md` 已将新能力路径改为轻量 final revision 与原 Supervisor 分页来源；Host 不再聚合完整终态，已有且尚未 ACK 的读者和在途 open 也可在原生命周期收尾。旧能力仍由 `panel/runtimeTerminalReadRelay.ts` 临时引用完整终态，为已确认读者供页，未确认时向当前页面发送一次完整快照。这些来源不进入节点 metadata 或画板保存，不允许新页面重新打开；读完、关闭、生命周期失效或 Host dispose 即释放。`webview/terminalPagedProjection.ts` 在最后页应用和 exit 顺序收敛后关闭读取身份，xterm 当前画面无需立即清空。

先持久化轻量已结束状态，再退役 Supervisor 会话，避免成功保存仍标记 live 的悬挂绑定。新协议先封闭新读者，既存 socket/readId 结束后再物理删除；旧协议收到完整来源后删除。保存失败保留原状态与来源；这不再是历史归档 handoff。Host 在此期间退出后不要求恢复已结束内容。后台结束、没有当前视图时无需终端收尾投影。

保存时旧 session map 暂未释放，但 `postExecutionSnapshot()`、在途分页 open、延迟 live-state flush 和节点 reconcile 都不能因为旧 session 仍在就重新打开历史或覆盖退出状态。原同步 timer 取消；新页面只读取轻量 metadata，最终完整响应受原 surface generation/frame 限制。

旧数据只对能明确识别为 Supervisor completed 的记录迁移：非 live、`snapshot-only`、退出生命周期且包含权威 `terminalStream`，或已有 `terminalHistoryDiscarded` 标记。加载时清除终端 payload 和自动启动意图，后续普通保存写入轻量记录。不能仅凭 `liveSession: false` 删除仍待重连的运行中会话；旧 serialized-only 数据无法证明来源时保留兼容，`snapshot-only` 直接执行模式不在本轮改变。

## 验证与边界

验证 Agent/Terminal 正常结束与停止后：当前视图最终 marker 和退出顺序完整；画板快照没有终端正文；移动节点保存不随结束前输出大小增长；Webview/Host 重开无原输出、无自动 start/resume。覆盖慢读者、首个 page 请求之前结束、取消、保存失败、旧 completed 迁移和运行中绑定保护。真实 Linux VS Code、协议、状态机、Playwright 与容量样本记录在 ExecPlan。

本增量消除新 completed 的画板内联持久化；后续第五批消除新模式完整终态消息与 Host 临时聚合。旧协议/混合订阅、Supervisor registry/journal、全量扫描、队列与总 RSS 仍属于 F-04；不新增归档服务，也不修改 root/runtime 归属。以下验证为第四批当时的证据。

2026-09-18 收口证据：实际 Host completion + writer fixture 的 Terminal/Agent 分别为 781/812 字节，小输出与约 3.8 MB stream 相同；旧 20509666 字节最小内联诊断容器经迁移后为 505 字节。协议、生命周期、4 项 Playwright 和最终 5 项 Linux VS Code 定向场景通过，包括实际 xterm 逐行 90000 行及空白重开。首次压力样本曾在 final revision 到达后只到第 89850 行，继续保留既有间歇性短读债务；不以两轮严格通过否认失败，不把定向 Linux 证据写成全平台、长期压力或 RSS 验证。因此验证状态保持“验证中”，具体日志与未跑范围见完成计划。
