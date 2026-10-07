---
title: Live 会话权威当前状态恢复
decision_status: 已选定
validation_status: 验证中
domains:
  - 执行编排域
  - VSCode 集成域
architecture_layers:
  - 共享模型与编排层
  - 宿主集成层
  - 画布呈现层
related_specs:
  - docs/product-specs/runtime-persistence-modes.md
related_plans:
  - docs/exec-plans/active/runtime-live-state-recovery.md
updated_at: 2026-10-07
---

# Live 会话权威当前状态恢复

## 问题与范围

checkpoint + journal 分页已限制消息和在途工作，但 checkpoint 在颜色、链接、parser 中间状态或大状态下不推进时，新 Webview（包括新 Host 打开的页面）仍回放累计历史。这不满足相同当前终端状态与 scrollback 下恢复成本不随累计交互增长的要求。2026-10-06 将本项重新列为本轮未完成交付；容量和退出完整性的已有证据不能替代它。

范围是 Supervisor 仍存活的 Terminal/Agent 新投影恢复，涵盖重开 VS Code、Webview 重建及 PaneGallery 布局/聚焦重建。故障后进程恢复、completed 历史、root 稳定归属、旧 OS 和通用工具增强均不加入。

## 候选方案

提高 ANSI checkpoint 阈值或频率不能修复颜色、OSC8、parser carry 等语义缺口。保留页面实例不能覆盖真实 Host/Webview 重建。替换为 tmux 等引擎会改变平台、输入和呈现契约，本次不扩大此边界。

选择固定 xterm 6 同引擎状态导出/导入：Supervisor 捕获当前有限模型，客户端恢复并从同一 revision 接收增量。状态包含正常/备用 buffer、scrollback、光标、属性/模式、颜色、链接、parser/解码中间状态及 resize 语义；纯文本和仅当前屏幕不是等价状态。私有 API 版本耦合与部分 parser 处理器已做源码核对和有限未来后缀等价验证；实际浏览器服务、真实重开及跨平台恢复仍待验收。

## 不变量

捕获状态与 revision 在原操作队列内一致。传递按固定大小块进行，不能以巨大内联状态代替巨大历史。新读者从当前状态建立起点，已有有效读者不跳过未消费内容。最终应用、真实输出结束、主动取消和失败保持原区分，捕获完成不等于客户端应用完成。

旧 live Supervisor 沿用原能力和绑定，不为新能力重启或迁移；兼容路径不冒充新验收。允许内存模型随用户 scrollback 和尺寸增长，不允许恢复依赖已经被模型淘汰的累计交互。

默认 owned 新会话进入 `terminal-current-state-linux-v1`、`terminal-current-state-macos-v1` 或 `terminal-current-state-windows-v1` generation，沿用现有平台 provider/profile 和 workspace slot。原 `terminal-exit-v1` / 平台变体仍解析为原 profile，已有绑定不改写。否则新代码会继续向尚未退役的旧 Supervisor 新建会话，无法默认取得新恢复能力。显式 stock 对照 generation 不在此次默认启用改动内。

## 验证方法

相同最终状态/scrollback、不同历史长度的成对输入，记录传输大小、捕获前 journal 读取数、导入工作量与实际耗时。相同未来后缀覆盖部分控制序列/字符、颜色、链接、normal/alternate、resize，并验证终态和尾部。浏览器重建、PaneGallery 切换和真实 Host 重开分别验收，模块等价不代证用户体验。

## 正式方案

沿用 xterm 6.0.0，新增 `src/common/terminalCurrentState.ts` 的纯数据 codec。`captureTerminalCurrentState()` 导出当前模型，`restoreTerminalCurrentState()` 在同版目标模型导入；不执行历史 ANSI，不重新触发历史设备回复或剪贴板动作。包括正常/备用 buffer 原始 cell、组合字符、属性、保存光标、模式、charset、链接和 parser/解码续接数据。onColor 以有限覆盖表记录当前 set/reset，不保存历史事件链。异步 paused handler 或未 drain 的 write 不是合法捕获边界，明确拒绝，不静默退回长历史并宣称成功。

cell 正文使用 `u32-xor-rle-v1`：按 content/fg/bg 通道保存原始位模式，XOR 差分、变长整数与相同值 run 只减少表示大小，不丢弃空格属性或合并/宽字符数据。导入先校验与解码，再安装到目标自身的 buffer、parser 和 link service；旧 marker 和内存清理任务先释放，新 link marker 的释放回调仍归目标所有。颜色 accumulator 必须由 tracker 从创建起维护并显式传入，headless 缺少此数据时拒绝捕获，不静默假设默认 palette。

Webview 的 `executionTerminalNativeInteractions.ts` 注册了生产 OSC52 handler，因此 tracker 同样注册无副作用的 OSC52 handler，只保存当前未完成的 payload。已完成的历史复制不重放；跨 R 尚未结束的序列导入时也不执行，只有未来结束符到达才由目标既有 handler 按焦点策略处理。payload 沿用 xterm 限制，结束即清空，目标缺少对应 handler 时明确拒绝。源码已确认 Agent/Terminal 均先注册该 handler，再请求初始快照；未增加通用 addon 迁移范围。

`SerializedTerminalStateTracker.captureCurrentState()` 在原队列等待真实 parser 消费，捕获失败仅使本次初始化失败，不污染后续输出。状态只用于 live 初始化，不进入画板 JSON、registry 或 durable journal checkpoint。保留原严格 checkpoint 校验和慢 reader 来源。

Supervisor hello、Host 与 Webview ready 通过 `terminalCurrentStateV1` 协商。`openTerminalRead` 请求 `currentState: 'xterm-current-state-v1'`，在原终端操作队列捕获当前 R（revision）与几何状态。描述符 `currentState` 只含格式和 JSON 字符长度；`checkpoint` 此时仅承载 R/尺寸/scrollback/身份，正文为空，不得当作普通空快照应用。旧端沿旧能力，不重启或迁移执行。

正文通过原 `readTerminalPage` 的 `stateOffset` 逐块请求，返回 `stateChunk`，块上限 8192 UTF-16 字符，使最坏 JSON 转义也在 64 KiB 页预算内。状态块不推进 journal revision、不确认页面应用；Webview 收齐并导入后从 R 请求连续增量。每个 reader 只许一个在途块，Supervisor 保留冻结状态直到首次普通页确认或取消。冻结状态与接收端组装占用 O(当前模型) 内存，不声称常数大小，也不得保留过去 capture 的列表。

为支持 F-04 的实际准入观察，Webview 在完整 current-state 组装前记录一次脱敏 performance diagnostic：状态总 UTF-16 长度、收到的块数、最终 offset，以及 `stateOffset * 2` 的组装峰值估计（`JSON.parse(join(...))` 同时保留分块和合并字符串的保守上界）。Supervisor/Host 已有 `stateLength` 和每页 `stateOffset` 记录。该诊断只用于同一生产入口的资源账，不把估计值当作 RSS 硬预算，也不改变失败、取消或降级语义。

容量边界仍需作为 F-04 的生产准入项单独收口：当前协议只限制单个 `stateChunk`，尚未为完整 current-state JSON 设定总长度或接收端组装预算；Supervisor 会先形成完整字符串，Webview 也会在导入前累积并合并分块。不能把 8192 字符分页误写成总内存上界，也不在缺少实际多会话/大 scrollback 证据时擅自增加硬阈值。验收必须记录状态长度、捕获/组装峰值、并发会话和失败处置；若支持预算不足，应明确拒绝或降级到已有兼容路径，不能静默截断或宣称恢复完成。

新 reader 的 R 不提升 durable checkpoint 或其他 reader。捕获在 admit reader 之后，保留与退出重叠的最终应用责任。导入失败、销毁、读取失败沿原结算；传完不等于应用完成，更不等于 EOF。结束须在真实导入及之后 final revision 全部应用后完成。

reader 的 `currentStateCheckpoint` 标记在释放冻结字符串后仍保留，直到被真实 durable checkpoint 提升替换；legacy completed attach 不得选择这种空正文载体作为回放起点。状态块发完后发生退出，也必须等导入后的普通页确认及 final revision 实际应用，不能提前以 applied 释放来源。

已核实新 Host 行上下文从 attach snapshot head 加摘要开始订阅，不回放旧 checkpoint；同 Host 断线才从自身已消费位置继续。保持该路径，不增加另一套 Host 全态恢复。`CanvasPanelManager.postPagedExecutionSnapshot()` 协商，`runtimeTerminalReadRelay.ts` 转发，`TerminalPagedProjection` 组装并调用 Webview 导入。PaneGallery 卸载重建使用同一 fresh reader，不另建终端缓存。当前状态导入完成后，Webview controller 还必须登记该 reader 的 authority、revision、已应用快照标记和 projected execution session；后续分页回调携带实际 page revision，不能只更新 projection 内部游标。否则下一条直接终端事件会把已恢复页面误判为未 attach，并触发重复 attach recovery。该接续已在 controller 回归中覆盖。

固定版本私有 API 的成本是升级时必须重新核对两端模型与 codec；当前安装已固定校验 headless/browser 6.0.0，不能以版本字符串或局部单测代证完整通过。格式与接线正在验证，B4 未完成；不将收益外推到旧 Supervisor。

## 已得证据与剩余验收

2026-10-06 受控验证中，codec 的 1/200/1200 次重绘等状态样本均为 2632 JSON 字符；实际 Supervisor、Client、Host、Projection 与 headless xterm 组合（仅 provider/socket/OS 边界受控）的 1/400 次重绘样本均为 4329 字符，捕获前 journal 读取为零。组合测试还验证颜色与 partial CSI、R 后增量、最终光标 `(6,2)`，以及 write callback 完成前不能结算和退休资源。该结果证明所测路径的恢复工作取决于当前状态，不证明真实 UI 耗时或任意规模资源上限。

固定 80 列、24 行、1000 scrollback 的普通文本样本保留 81920 cells，原 u32 JSON 的 1383643 bytes 降为 143227 bytes；导入 ANSI write 次数为零。它只是编码体积观察，不将本次数值设为新产品预算。

2026-10-07 复用冻结生产 VSIX 的真实 Linux VS Code Reload Window 通过：保留原 Supervisor/执行主体，重建 Host/frame/reader 后正确导入 current-state、处理新输入回复并完成原 reader 的最终应用和清理。此次状态为 4825 字符、1 块，估计组装峰值 9650 字符；只是小状态单次实测，不替代大 scrollback 与多会话准入。此前 run `37501128715` 的失败确认是 fixture 将 CRLF 写成字面量导致 nonce 回复连行，业务 projection 已确认 revision 7；修正 fixture 而不放宽断言，保留旧失败。真实跨平台、Agent 和容量边界仍按 ExecPlan 开放。

类型检查、正常默认平台构建、codec 15 项/tracker、Supervisor 104 项、Client 31 项、Host reader 27 项、Webview controller 50 项与 Host batch 10 项及分页/路径定向验证通过。F5 main-only staging 已更新，并比对 Host/Supervisor/Webview 与 execution selection 四文件和构建输入逐字节一致。当前代码还重新通过了结算 wiring 27 项、VSIX 打包和三项实际 Playwright 恢复场景（Agent、Terminal 页面重建和 PaneGallery remount，3/3）；这些场景包含 controller 全局 authority/revision 接续回归。早期真实 Electron candidate 和 socket protocol 的 EPERM 失败保留，后续原生环境已可运行真实 Linux 重开入口，不再把历史权限限制写作当前阻塞。

现代安装入口的受影响回归已取得 macOS installed product/Agent 8 场景，以及同包 Windows 定向 run `37507579337` 的 installed live-runtime/Agent live 4 场景证据。Windows 90000 行与尾部最终光标、reader applied、completed 无历史及资源释放通过；Agent 仅所选四场景通过，不冒称完整矩阵。先前 Windows run `37494231281` 的 Host 停滞原因仍未确认，归档缺失清空前的启动批次，因此保留间歇性风险，不将重跑绿色等同业务修复。上述生命周期/安装结果也不代证真实 live Agent 跨 Host 重开。

剩余只补实际 Webview/PaneGallery、VS Code 重开、真实 Terminal/Codex/Claude 的恢复后交互与退出，以及现代三平台最终包中的对应路径；并在同一受影响链路上完成 current-state 总长度/组装峰值与多会话准入记录。provider/native 未改，不重跑无影响的六架构资产矩阵，不重开 snapshot-only 历史归档或 root 归属。具体命令、失败和恢复方法保留在活动 ExecPlan，B4 在这些受影响验收和 F-04 资源边界完成前仍开放。

2026-10-07 F-04 资源台账接线：现有 Linux capacity workload 在 setup 收尾阶段优先、必要时在最终收尾从 Host diagnostics 读取 `runtime/terminalPagedReadOpened` 的 current-state descriptor（诊断事件仍在 ring 中时作为 Supervisor 侧观察），并强制要求每个受影响会话存在 Webview `terminal-current-state-assembled` 完整样本。归档包含状态长度、最终 offset、chunk 数、保守组装峰值及跨会话聚合字符量；缺失完整组装事实会使该受影响 workload 失败并保留独立错误证据，原 workload 失败不会被取证错误覆盖。该接线不引入总长度或 RSS 产品阈值，也不把 8192 字符页大小当作总资源上限；历史 capacity 结果尚未包含该台账，待下一次 Linux 原生重跑后再评估准入。

同日 Linux 原生 capacity 结果：显式 candidate admission `10:1` 的 10-session workload 在保留完整 10/10 current-state 台账后，于既有 1500ms 交互观察边界以 1500.2ms 失败；独立重跑在第二个会话启动超时。显式 `2:1` 的 attach/compact workload 保留 2/2 台账并完成 checkpoint promotion、manifest current/previous candidate 校验，但 compacted projection 最终断言超时；失败现场同时存在 nonce 回复和 144x38 的 checkpoint 几何，而动态 resize 早先观察为 143x38，故不能把它简化为资源台账失败或以放宽断言追认通过。工件分别保留在 `.debug/f04-capacity-current-state-20261007/`、`.debug/f04-capacity-current-state-20261007-rerun/` 和 `.debug/f04-capacity-attach-compact-current-state-20261007/`。F-04 资源准入和 attach/compact 产品 workload 仍未完成。

随后仅修正受 current-state 恢复影响的验收口径：compacted projection 使用最终 Supervisor checkpoint 的几何，而不使用先前 ResizeObserver 的中间样本。`2:1` attach/compact 重跑通过，2/2 会话状态台账完整（最大 3950 字符、跨会话保守组装峰值 15800），current/previous checkpoint 和 reader identity 保持，交互回执与 cleanup 均通过。143x38 到 144x38 的变化被记录为恢复时序中的最终几何接管，不是放宽尾部或资源判定；10-session workload 仍未形成通过证据，F-04 不关闭。

同日新增独立真实 Agent 重开验收入口：`scripts/smoke/run-vscode-agent-runtime-reload-candidate.mjs` 使用 `tests/vscode-smoke/agent-runtime-reload-driver.cjs`，限定 Linux x64、安装 candidate VSIX、DeepSeek 中转服务和真实 Codex CLI。setup 保存 runtime backend/storage/session、Supervisor/provider/wrapper/CLI、Host 与 reader 身份，执行真实 `workbench.action.reloadWindow`；verify 核对同一 binding/Supervisor/authority、新 reader、无新执行、重开后输入、stop 结算和资源退出。它不改变固定八场 Agent 矩阵，也不把 fake provider 或 Terminal reload 结果扩写为 Agent 通过；目前仅完成静态检查，实际 runner 结果仍待补齐。
