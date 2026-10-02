---
title: Runtime 退出收尾的分页读取与读者退役
decision_status: 已选定
validation_status: 验证中
domains:
  - 执行编排域
  - 项目状态域
architecture_layers:
  - 宿主集成层
  - 画布呈现层
  - 共享模型与编排层
  - 适配与基础设施层
related_specs:
  - docs/product-specs/runtime-persistence-modes.md
related_plans:
  - docs/exec-plans/completed/runtime-paged-completion.md
updated_at: 2026-09-18
---

# Runtime 退出收尾的分页读取与读者退役

## 问题与取舍

第四批已取消 completed 历史落盘，但 `runtimeSupervisorMain.ts` 在退出和删除时仍聚合完整 journal，Host relay 临时持有完整 stream。第五批选择延续已有单页消费链路，让末尾来源留在 Supervisor 原 journal，避免新模式的全量终态消息及 Host 临时聚合。不增加独立 server、历史归档、文件格式或跨崩溃恢复保证。

## 正式方案

以下源码相对于 `extensions/vscode/dev-session-canvas/src/`。`common/runtimeSupervisorProtocol.ts` 增加 `terminalPagedCompletionV1` 和显式 `paged-until-exit` 模式；Host/client 在能力存在时选择，否则保留旧 `paged` 或完整协议。旧 Host 连到新 Supervisor 仍收到其预期的完整终态。同服务混合订阅时，仅为需要完整模式的订阅构建该对象，不发给新模式读者。

`supervisor/runtimeSupervisorMain.ts` 在新模式的退出事件、create/attach 和 subscribe 返回轻量状态、authority 与 final revision，不包含完整 stream 或 serialized state。PTY 数据仍通过同一串行 journal 链收敛；不改变 admission 或宣称修复已登记尾部短读。Host 离线完成后重开没有既存读者，只保存轻量退出节点并清理来源。

服务能力不代表每条旧记录都有 journal。`toAttachSnapshot()` 仅在 journal/checkpoint 存在且无 journal 错误时标记可分页；没有 journal 的旧 registry 记录继续返回兼容 snapshot，不能产生缺少 authority 的分页承诺。

`panel/CanvasPanelManager.ts` 保存退出节点成功后，以 `deleteSession({ preserveTerminalReads: true })` 请求退役。该请求仅适用于非 live 会话；Supervisor 立即禁止新 attach/open 和其他普通操作，并从 registry 排除该会话，但保留现有 socket/readId 的分页权限。现有读者关闭、socket 断开后，最后一个读者触发串行物理删除和资源释放。显式普通 delete 仍强制取消所有读者。多窗口的一个清理请求不得截断其他现有读者；不把引用保留当作长期可发现的历史。

`panel/runtimeTerminalReadRelay.ts` 新路径仅保存完成身份、最终 revision 和原 reader，不聚合正文；旧路径保留临时完整兼容。完成可以发生在首个 read 前，或当前 open 尚未响应时：Host 等已发起 open 收敛，在同一 surface generation/frame 重发其 descriptor，然后通知 final revision 与 exit。未发起读取或生命周期变化后不新开历史 reader。保存失败不请求退役；新页面仍只读轻量节点。

读者与 close RPC 未收敛时，旧 generation 客户端不能因节点已结束而断开；全部读者释放后再检查退役。`webview/terminalPagedProjection.ts` 继续逐页应用，最后页写入回调完成后才显示退出和关闭。已结束来源因 socket 失效等原因不可再读时，当前投影明确报告读取中断并释放身份，不自动重启、不伪称已追到 final revision，也不无限重试无效读者。

## 验证与边界

验证自然退出、stop、Agent/Terminal、无读者、未 ACK/在途 open、慢读、多 socket、生命周期替换、保存失败、close/delete 并发及真实文件回收。大输出用逐行内容和 final revision 双重断言；新终态消息不随历史增长，实际 Host 无临时完整来源。保留旧协议和跨 generation 真实宿主回归。

本方案只收口新协议结束时的全量聚合，不宣称 F-04 全部解决。旧协议/混合客户端仍可能需要完整对象；单个大事件、checkpoint 大小、pending/socket 队列、registry/open/compact 扫描、总回放时间与 RSS 不属于已证明预算。Supervisor 断连后的运行中重连边界、root/runtime 归属及极端 PTY 尾部短读仍独立跟踪。

2026-09-18 定向证据：协议验证 Agent/Terminal 各 18000 行在退役后继续读完整尾部；实际 Supervisor 方法禁止完整聚合的故障注入覆盖双 socket、首个 read 前结束、关闭/断连、强制删除和旧订阅混用，journal 文件按最后读者实际删除。Host 方法验证在途 open、保存失败、错误 authority/revision、读者关闭 RPC 之前不退役旧客户端，以及终态页面失败明确关闭。6 项 Playwright 和首轮 5 项 Linux VS Code 场景通过，包含严格 90000 行实际 xterm 和空白重开。约 6.55/13.11/19.66 MB output 的最小诊断终态编码为 405/407/407 字节，不是任意生产消息上限或 RSS。

第二轮真实宿主在第一项失败：实际 xterm 为 89969/90000，最后一页发送记录为 `revision=headRevision=12654`。测试 finally 清空消息正文，不能凭分页 revision 确定缺失发生在 PTY、journal 还是 Webview；本轮不改 exit drain、不加等待绕过断言。补清理前失败目录和首末行诊断后，后续 90000 行逐行校验与空白重开通过，仍不能否定失败。现场 `.debug/runtime-paged-completion-short-read-failure/`，验证命令和完整轮次见执行计划。完整套件、packaged smoke、非 Linux/Remote SSH、长期压力与 RSS 未跑；当时尾部短读未定位，因此保持“验证中”。

2026-09-18 后续独立定位见 `docs/design-docs/runtime-terminal-tail-diagnosis.md`：实际 Supervisor 的自然失败中 raw、bridge、journal 和 page 正文完全一致，raw 已缺尾部；socket EOF 后同一 fd 仍可读出剩余字节，拼接后完整。裸 PTY 的 syscall 对照定位到 Linux Node/libuv 在 HUP/partial read 时过早 EOF，VS Code 内置 Node 22 也有受控复现。旧 89969 样本缺原始 PTY 证据，不能追认全部历史同因；本轮只增加诊断，不改业务代码，不关闭无损验收或把分页视为源完整性的证明。
