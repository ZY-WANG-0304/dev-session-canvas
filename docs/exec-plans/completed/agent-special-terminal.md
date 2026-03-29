# 把 Agent 收敛为预置 CLI 的嵌入式会话窗口

本 ExecPlan 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘` 这几个章节。

本文件位于 `docs/exec-plans/completed/agent-special-terminal.md`，必须按照 `docs/PLANS.md` 的要求持续维护。

## 目标与全局图景

把当前画布里的 `Agent` 从“输入 prompt，宿主执行一次 CLI，再把 stdout 聚合成 transcript”的模型，改成“画布里的特殊终端窗口”。用户创建 `Agent` 节点后，应看到一个真正的嵌入式会话窗口；它会按节点当前 provider 默认启动 `codex` 或 `claude` CLI，后续交互直接在终端内完成，而不是继续依赖节点外的调用模型。

完成后，用户应能亲眼验证以下行为：新建 `Agent` 节点后自动启动对应 CLI；节点内可以像终端一样收发输入输出；停止、重启、切换 provider 都遵循“会话窗口”语义；宿主状态里只保留 provider、最近输出、退出信息和会话摘要，而不再维护独立 transcript 状态机。

## 进度

- [x] (2026-03-29 20:25+08:00) 确认当前问题根源是 `Agent` 仍保留“一次性 run + transcript 聚合”的独立执行模型，和 `Terminal` 的 PTY 会话模型分裂。
- [x] (2026-03-29 20:35+08:00) 更新正式设计文档与产品规格，明确 `Agent = 预置命令的嵌入式会话窗口`。
- [x] (2026-03-29 21:25+08:00) 重构共享协议与宿主状态，把 Agent 会话切到 PTY/terminal 模型。
- [x] (2026-03-29 21:35+08:00) 重构 Webview Agent 节点，使其直接复用嵌入式终端窗口交互。
- [x] (2026-03-29 21:42+08:00) 运行 `npm run build`、`npm run typecheck`，并把结果补回计划和设计文档。
- [x] (2026-03-29 21:55+08:00) 在 VSCode `Extension Development Host` 中完成真实 `codex` / `claude` CLI 人工 smoke test。

## 意外与发现

- 观察：把 Host/Webview 协议统一成 execution session 后，`Agent` 与 `Terminal` 的节点交互代码可以明显收敛，原本最重的差异只剩启动命令和顶部控件。
  证据：`src/common/protocol.ts` 现在只保留一套 execution session 消息；`src/webview/main.tsx` 中 Agent/Terminal 都直接消费同一类事件总线。

- 观察：`Terminal` 节点已经具备 `xterm.js + script PTY bridge` 的最小闭环，这给 `Agent` 作为“特殊终端”提供了现成宿主后端。
  证据：`src/panel/CanvasPanelManager.ts` 已存在 `EmbeddedExecutionSession`、输入输出桥和重新附着逻辑。

## 决策记录

- 决策：本轮不继续优化 transcript 驱动的 Agent 原型，而是直接改成预置 CLI 的嵌入式会话窗口。
  理由：用户指出的核心问题不是样式或局部交互，而是对象定义本身过重；继续保留独立调用模型只会把复杂度继续固化。
  日期/作者：2026-03-29 / Codex

- 决策：`Agent` 与 `Terminal` 在宿主层共享同一类 PTY 会话桥，差别只保留在启动命令和节点元数据上。
  理由：如果两者继续维护两套运行时模型，后续恢复、状态同步和前端事件流都会继续分裂。
  日期/作者：2026-03-29 / Codex

## 结果与复盘

当前已完成文档收敛、协议改造、宿主 PTY 会话迁移和 Webview 节点改造，并通过以下自动化验证：

- `npm run typecheck`
- `npm run build`

当前已完成本计划定义的文档、实现、自动化验证和人工 smoke test，本计划可迁入 `completed`。

## 上下文与定向

本轮相关文件如下：

- `docs/design-docs/agent-runtime-prototype.md`：当前 Agent backend 设计文档，需要改写为“预置 CLI 会话”路线。
- `docs/design-docs/agent-session-surface.md`：当前 Agent 表面设计文档，需要去掉“节点内 transcript + 独立输入框”作为核心结论。
- `docs/design-docs/vscode-canvas-runtime-architecture.md`：顶层架构文档里仍存在较重的 `AgentAdapter` 抽象，需要收敛。
- `docs/product-specs/canvas-core-collaboration-mvp.md`：产品规格需要把 Agent 的验收口径改成“节点内 CLI 会话窗口”。
- `src/common/protocol.ts`：Host/Webview typed message 协议。
- `src/panel/CanvasPanelManager.ts`：宿主权威状态、会话生命周期和 PTY 桥都在这里。
- `src/webview/main.tsx`、`src/webview/styles.css`：节点渲染、xterm 容器和 Agent/Terminal UI。

这里的“特殊终端”指：`Agent` 仍然是独立对象类型，保留 provider 语义和默认启动行为，但它的运行时本质是一个嵌入式 PTY 会话窗口，而不是一套单独的请求/响应协议。

## 工作计划

先更新文档，把“Agent 的正确语义”写成明确结论，再同步改实现。实现层分两段推进。第一段先把共享协议和宿主状态从 `AgentRunSession + transcript` 改成通用执行会话模型，让 `Agent` 和 `Terminal` 都走 PTY。第二段把 Webview Agent 节点改成真正的 xterm 窗口，只保留 provider 选择、启动/停止和节点摘要，不再显示独立 transcript 冒泡与 prompt textarea。

## 具体步骤

1. 更新 `docs/design-docs/agent-runtime-prototype.md`、`docs/design-docs/agent-session-surface.md`、`docs/design-docs/vscode-canvas-runtime-architecture.md` 和 `docs/product-specs/canvas-core-collaboration-mvp.md`。
2. 更新 `docs/design-docs/index.md`，同步设计文档状态和更新时间。
3. 在 `src/common/protocol.ts` 中收敛 Agent 元数据与消息类型，去掉 transcript/run 驱动协议。
4. 在 `src/panel/CanvasPanelManager.ts` 中统一执行会话状态机，让 Agent 启动 `codex`/`claude` CLI 的 PTY 会话。
5. 在 `src/webview/main.tsx` 和 `src/webview/styles.css` 中把 Agent 节点改成嵌入式终端窗口。
6. 运行 `npm run build` 与 `npm run typecheck`。

## 验证与验收

本轮至少满足以下条件才算完成：

- `npm run build` 通过。
- `npm run typecheck` 通过。
- `Agent` 节点不再出现 transcript 冒泡和独立 prompt 输入区，而是显示嵌入式终端窗口。
- `Agent` 节点在未运行时可切换 provider，并可按当前 provider 启动 CLI 会话。
- `Agent` 节点的状态与最近输出摘要由宿主 PTY 会话回流，而不是由一次性 CLI stdout 聚合生成。
- 文档中不再把 Agent 写成“独立调用方案”，而是清楚说明它与 Terminal 共享会话模型。

## 幂等性与恢复

- 文档改写可重复执行，只要索引状态和 frontmatter 保持一致即可。
- 如果 PTY 路线在当前环境下无法启动 provider CLI，必须把失败写成明确错误并保留节点可重启状态，不能静默回退到旧的 transcript 模型。
- 活跃会话仍然只保存在宿主内存中；扩展重载后如无法恢复，应像现有终端实现一样显式标记为 `interrupted`，而不是伪造继续运行。

## 证据与备注

本轮自动化验证结果：

- `npm run typecheck`：通过
- `npm run build`：通过

## 接口与依赖

本轮不新增新的外部依赖。运行时继续使用当前已经接入的 `xterm.js` 和 Linux `script` 命令。共享模型需要收敛为“通用执行会话 + Agent provider 元数据”这条主线，而不是继续保留独立 transcript 协议。
