---
title: 按展示变化批量同步画布
decision_status: 已选定
validation_status: 验证中
domains: [画布交互域, 执行编排域]
architecture_layers: [宿主集成层, 共享模型与编排层, 画布呈现层]
related_specs: [docs/product-specs/runtime-persistence-modes.md]
related_plans: [docs/exec-plans/active/runtime-journal-input-priority.md]
updated_at: 2026-10-27
---

# 按展示变化批量同步画布

## 背景与边界

配置构造内复用与侧栏优化已完成，用户报告侧栏正常、输入无明显卡顿。前一次现场 27.219 秒有 545 次全量状态广播，6,838,291 字节，是 journal 页消息的约 11.66 倍。这证明存在值得验证的冗余，不证明任何粒度是最优方案，也不证明减少字节必然改善回显。

本阶段由用户明确授权：保持现有发送时机，比较全量、空更新筛选、节点级批量局部更新；不改变输入、journal、输出信用、持久化、频率或调度优先级。继续在 PR337 的主题分支交付，PR327 不合并。

## 正式方案

`panel/CanvasPanelManager.ts:postState` 是统一发布边界。一次调用读取当前权威状态，把自上一发送版本以来多个节点的最终变化放入同一消息；不增加定时器，不跨当前调用合并需逐次执行的事件。节点整项替换，不采用逐字段即时通知。

共享模块 `common/canvasDisplayUpdates.ts` 定义展示投影、版本化差分及纯应用函数。首次打开、Webview 生命周期变化、基线失效、主动恢复使用完整 `host/bootstrap` 或 `host/stateUpdated`。日常使用 `host/stateDelta`，包含 `baseRevision`、`revision`、节点 upserts/removals 和可选节点顺序，以及实际变化的图关联集合和运行上下文组。连线、分组、文件引用和抑制关系作为同一消息里的完整集合替换，与节点增删一次应用，不能先渲染半次删除。

状态投影只排除已确认不作为画布展示输入的根 `updatedAt` 和执行 metadata 的 `outputSequence`，以及原本就剥离的恢复数据；根时间戳可随有意义的更新传递但不单独触发广播。保留 summary、recentOutput、尺寸、cwd、终端标题、session/attachment/lifecycle、attention、退出与恢复信息。recentOutput 虽只在部分 UI 作为存在性使用，本阶段仍保留其文本，不擅自缩减模型语义。未知新增字段保守地参与比较。

运行上下文按终端设置、画布呈现设置、工作区资源及启动能力分组，组内原子替换；缺少的可选字段必须能够清除。无变化组不发送、不触发对应 Webview runtime 操作。不引入跨构造的 VS Code 配置缓存。初期仍构造投影并计入比较成本；是否在高频来源提前筛选，由测量和依赖完整性决定。

每个 editor/panel 的 lifecycle 分别持有上一份传输投影及发送版本。版本只在发送消息时推进，空更新不推进。Webview 只接受以当前版本为 base 的增量；发现缺口进入等待完整快照状态，只发一次恢复请求，不能继续应用不完整增量。Host 递送失败清除对应基线，下一次发送完整快照；旧生命周期的失败回调不能清除新基线。现有 bootstrap 门禁队列最多保留 50 条消息；尚未 ACK 时不把状态放入该队列，而按 surface 保存一个追赶标记，ACK 后发送当前全量状态，避免最后一次增量被其他消息挤掉且无后续变化触发缺口检测。完整快照重置恢复状态；已有 lifecycle 检查先拒绝旧 frame 消息。

`webview/main.tsx` 批量应用增量，未变化的节点、集合和 runtime 保持引用；节点消息不重做终端运行配置。节点布局草稿仅在相关权威几何更新/提交确认或删除后清除，不能由另一节点的标题更新清除。无几何变化的提交也必须得到确认；该交互语义须独立验证，不能以空更新筛选吞掉确认。首次加载和完整同步保持原有恢复行为。

侧栏继续消费 Host 权威状态通知，由已完成的侧栏展示去重决定是否更新；不让画布传输投影改变侧栏数据来源。终端页、标题专用消息、输入 ACK、完成事件仍走原链路。

## 验证与验收

测试实现 A 为当前全量，B 为相同投影但只跳过空更新、变化仍全量，C 为节点及关联操作批量更新。三者使用相同事件输入、相同发送时机和相同诊断代码，比较总成本，不从发送函数中排除构造和比较成本。基线冻结在 0b684682；所有新证据放当前工作区 `.debug/canvas-display-updates/`。

正确性测试对相同变化序列并行计算全量权威展示状态与增量结果，在每个已发送版本比较；覆盖连续变化、最终值合并、增删重排、关联边和分组删除、配置可选字段清除、空更新、回退到全量、重复/缺口/旧 lifecycle、递送失败、重建、交互草稿、侧栏一致性。浏览器测试必须覆盖真实消息处理及可见内容，不能只测纯差分函数。

性能分两层：确定性回放统计消息数/UTF-8 字节、构造/比较/序列化/应用成本；真实 VS Code/PTY/Webview 对比单节点、双节点另一静默、双节点另一输出、双节点都输出、多节点输出。自然输出与人工状态压力分账。采集回显 P95/P99、最大值、事件循环停顿、后台展示更新等待及浏览器提交/渲染成本；keydown 到 xterm buffer 完成不冒充像素呈现。统计样本量与测量扰动，不以少量样本的 P99 声称稳定尾延迟。

成功要求展示一致、通知不膨胀、整体处理成本下降且交互不退化。若节点级方案只减少字节而成本上升，保留实测结论并调整方案；未验证的指标明确列为缺口。只有数据显示节点级仍有显著冗余才考虑字段级补丁。

实现补充：Host 对每个节点、关联集合与上下文组保存序列化比较值，避免后续原地修改污染基线；不保留重复深拷贝的全量模型。Webview 为节点回调保留稳定入口并在提交后更新回调目标，未变化节点的 React Flow 数据复用，不能只缩小消息却重新分配全部节点数据。

验证发现：仅复用节点数据仍会由父组件带动未变化的节点组件渲染，实际组件计数测试最初失败（未变化兄弟节点 4→5）。在 nodeTypes 边界使用 React.memo，配合稳定数据/回调后同一测试通过；不忽略函数属性，以免保留过期交互闭包。原失败 trace 保存在 `.debug/canvas-display-updates/render-before-memo/`。

## 独立复现命令

在仓库根目录准备依赖、VS Code 1.140 和虚拟显示后运行：

    node scripts/diagnostics/prepare-canvas-display-variants.mjs .debug/display-new
    xvfb-run -a -s '-screen 0 1600x1000x24' node scripts/diagnostics/diagnose-configuration-reuse.mjs --canvas-display --remote --extension .debug/display-new/full --vscode .vscode-test/vscode-linux-x64-1.140.0/code --output .debug/display-new/remote-a --samples 40

然后依次将 extension 换为 skip、delta、full，output 换为未存在的 remote-b2、remote-c、remote-a2。不要同时运行对照组或重负载验证。最后运行 `node scripts/diagnostics/summarize-canvas-display-updates.mjs .debug/display-new`。构建器从固定基线创建临时隔离 checkout，三份包冻结后不再修改；B 仅在诊断副本把 publisher 的非空结果换回全量，没有新增产品配置开关。

定向测试：`npm run test:canvas-display-updates`、`npm run test:execution-flow-diagnostics`、`npm run test:canvas-display-rendering`（真实组件函数计数）、`node scripts/test/run-playwright-webview.mjs --grep 'canvas display delta' --workers=1`。最后一项使用先前 build 的真实 Webview，不能省略构建。现有 `test:execution-flow-diagnostics` 入口包含新纯协议和实际 Host 验证，浏览器组件计数仅修改复制的构建产物。

## 2026-10-27 验证结果与决策

实现与受控验证已完成，选用节点级批量方案；真实 Agent 现场的尾延迟收益继续标为待验证。先前配置/侧栏优化后用户已报告输入无明显卡顿，本阶段不把这份先前反馈归因于新代码。

### 真实 Host 与浏览器对照

VS Code 1.140.0、回环 Remote SSH、独立配置/存储与受控 Python CLI，使用真实 PTY、Supervisor、journal 和 Webview。A 为 0b684682 的完整包；B/C 为同一候选，B 只在诊断副本把非空增量换回全量，C 使用正式节点增量。顺序 A/B/C/A；每轮六场景各 40 次输入，共 **960/960** 次回显。所有阶段最终后台标题与实际 DOM 一致，CLI 退出和私有 SSH 清理通过，终端均为 67×21。原包与候选 Host/Webview hash 在 `render-artifacts.json` 和各轮 `input.json` 中保存。

前五场景为 20 Hz 的 postState 压力，每五次调用才改一个节点标题，输入间隔 250 ms；第六场景仅自然四节点输出。实际 CLI 的自然打印未触发现场的高频全量广播，不能把人工压力叫作自然 Agent 复现。状态调用与采集边界不完全重合，各轮 10 秒左右的窗口有少量计数差异；没有修改产品发送定时器。

双节点均持续输出、加状态压力：

| 指标 | A 全量 | B 只跳空 | C 节点增量 | 返回 A |
| --- | ---: | ---: | ---: | ---: |
| postState 调用数 | 207 | 205 | 203 | 205 |
| 画布状态消息数 | 206 | 49 | 47 | 205 |
| 画布状态 UTF-8 字节 | 3,416,776 | 812,097 | 365,880 | 3,397,128 |
| Host 构造 ms | 209.1 | 187.6 | 221.6 | 159.0 |
| Host 展示比较 ms | 0 | 37.1 | 40.4 | 0 |
| Host 消息提交 ms | 121.9 | 26.0 | 9.8 | 94.8 |
| Host postState 同步总跨度 ms | 585.6 | 429.6 | 487.1 | 448.3 |
| Webview 状态消息应用 ms | 22.2 | 6.4 | 4.6 | 19.2 |
| 浏览器 renderer TaskDuration ms | 5,433.7 | 2,928.2 | 2,253.7 | 4,848.9 |
| 回显 P95 ms | 108.8 | 84.8 | 96.4 | 100.6 |
| 回显 P99/最大 ms | 130.5 | 143.2 | 133.3 | 147.2 |
| 后台标题呈现观察 P95 ms | 32 | 38 | 43 | 34 |

四节点均输出加压力时，画布状态字节为 6,317,001 / 1,641,279 / 423,387 / 6,294,803，renderer TaskDuration 为 6,459 / 4,946 / 4,072 / 6,008 ms。C 相对 B 仍减少约 74% 状态字节，且减少实际浏览器工作；同版本展示等价测试与真实组件计数同时约束正确性。主收益首先来自跳过空更新，节点级增量对多节点继续有收益，因此保留 C；没有数据支持继续细化到字段级补丁。

构造次数本阶段没有减少，不能声称“只构造改变的节点”。新增比较有成本，双节点该窗口约 40 ms；C 的 Host 构造/同步跨度也没有在所有场景优于 B 或返回 A。上表消息提交包含 VS Code 通道提交的同步成本，不能独立当作纯序列化 CPU。独立 `transport-benchmark.json` 单列 JSON 序列化/纯应用成本，说明小模型比较开销可抵消部分收益；它不包含 Host 配置或 React，不能替代上述真实结果。

浏览器 CDP 指标采自承载 Webview 的 renderer target，可能包括父 Webview；TaskDuration、ScriptDuration、LayoutDuration、RecalcStyleDuration 均保留，不能相加重复计算。状态消息应用跨度只覆盖消息处理，React 后续任务另计；布局/样式指标不等于最终屏幕像素绘制。回显使用同一个 Webview 单调时钟，从 keydown 到匹配回复进入 xterm buffer；后台标题用同机 epoch 时间到 rAF 观察实际 input.value，未当作屏幕呈现完成。启用的 flow/计数/DOM 观察存在测量扰动，原始 group 没有截断；各运行带同样观察代码，后续 runner 仅增加失败时保存 Host 状态的取证分支。

### 尾延迟复核

A/B/C/A 的回显 P95 没有一致改善，C 在单节点和第二节点静默场景曾偏高。因此另用同一个 Host、同一批存活会话，按 B/C/C/B 顺序分别验证单节点与双节点另一静默；每阶段 80 次输入，间隔轮换 181/223/277/319 ms，以覆盖不同轮询相位。该追加验证共 **640/640** 次回显；它改变了验证中的输入相位覆盖，不改变产品频率，不能将与前一组的差异唯一归因于环境或轮询相位。

| 同 Host 合并样本 | B P95/P99 ms | C P95/P99 ms | 每模式样本 |
| --- | ---: | ---: | ---: |
| 单节点 | 118.7 / 136.7 | 122.3 / 141.7 | 160 |
| 双节点、另一静默 | 109.7 / 138.4 | 109.7 / 143.7 | 160 |

交替阶段没有稳定同方向的回显退化，原先较大的偏高没有稳定复现，但也不能据此宣称降低了回显尾延迟。本次32个采集窗口的 Long Tasks 观察记录 0 次，rAF 间隔最大约 16.8 ms，后台标题观察最大 82 ms；这些是虚拟显示与有限窗口内的观测，不覆盖启动阶段或历史长停顿。40/80 样本阶段的 nearest-rank P99 就是最大值，合并 160 样本 P99 为第二大值；不外推生产 P99。追加验证可使用构建器生成的 paired 包和 `--canvas-paired --remote --samples 80`，然后同一汇总脚本生成 combined 数据。

### 正确性、失败记录与剩余边界

`test:execution-flow-diagnostics` 包含实际 Host 发布方法的空更新筛选、80 次 bootstrap 前更新只保留一次追赶责任、侧栏通知不受画布筛选影响、显式全量重同步，并覆盖新的 state-diff 与 stateDelta 秒级聚合。纯协议验证 1,000 次连续变化、节点/边/分组原子更新、排序、原地修改不污染基线、可选配置清除及旧生命周期失败回调。真实浏览器验证版本缺口只请求一次恢复、过时快照拒绝、重建、关联删除、resize 草稿等待正确确认，以及节点信息更新不改变终端 buffer。

组件函数计数由 test-only 构建注入，不依赖 DOM 没变化来推断没有渲染；先失败、补 React.memo 后通过。正式浏览器目录保留原 434 项，只增加三项至 437，不通过 skipped 测试充数；专用组件计数仅在其独立命令启用。既有侧栏、协议、分页控制器（Webview 51/51、Host batch 10/10）、typecheck/build 和 F5 包准备均通过。完整 Actions 与跨平台安装门禁不在这份局部验证中冒充完成。

失败证据保留：pilot-c 因无显示服务未启动；pilot-c2 因 frame 共用 CDP session 取证失败，改为记录实际父 target 后重跑。remote-b 在负载开始前出现 `Root runtime was submitted but readiness is unconfirmed`，没有启动 CLI、没有进入性能样本；root readiness 原因未确认，remote-b2 成功不能抹掉该失败。先前约 17 秒 Host 停顿和旧 B 隐藏场景约 1.7 秒异常仍未归因。

当前结论：已确认相同显示语义下通信和浏览器处理成本下降，受控场景无输入或最终标题缺失，且未观察到稳定的交互退化；真实 Agent 服务、跨机器网络、systemd、像素完成及生产尾延迟仍有验证边界。全部新证据保存在当前目录 `.debug/canvas-display-updates/`，汇总脚本和可重新构建 A/B/C/paired 的脚本随代码提交。

收尾验证：冻结构建器已实际运行，A/B/C 可从固定基线与当前源码重新生成；首次隔离构建缺少原生 assets，已修正为两边显式使用同一资产集，重跑通过。门禁合同测试90/90通过。当前 F5 包 Host SHA256 为 e85d441f6da8b1ca3a7338c8f285ea42889bfcf4e2350f85e3cc4e569abd73b8，Webview 为 f25a886e6782860b9dcececec74752570e5ae4c2642ffe048b4418a7fcdab0c2，与被测 C 完全一致。

隔离 checkout 的 A 因 esbuild 生成的 node_modules 模块路径及 workspace package 注释路径前缀而与原冻结包 hash 不同；统一该生成路径前缀后 Host/Webview 内容一致。重新构建 B/C 与被测包原字节一致；没有用重新构建的 A 冒充本轮实际运行的冻结 A。
