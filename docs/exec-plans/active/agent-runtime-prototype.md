# 建立 Agent 最小真实 backend 原型

本 ExecPlan 是活文档。推进过程中必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘`。

## 目标与全局图景

把当前 React Flow 画布中的 `Agent` 节点从展示型占位节点升级为“可由用户显式触发一次真实 CLI Agent 会话”的最小原型，验证以下主路径：

- 画布中可以创建和选中 `Agent` 节点
- 用户可以为节点输入一个简短目标并启动一次运行
- 宿主会启动一个真实可用的 CLI Agent 会话，而不是本地假数据
- 运行中的状态、最近输出摘要和错误信息会回流到画布
- 运行结束后，节点会留下最小必要的可恢复结果，而不是回到纯占位状态

本阶段要验证的是“Agent 节点与真实 backend 的最小垂直链路”，不是多轮对话、自治规划或完整多 Agent 编排。

## 进度

- [x] 梳理 `Agent` 节点当前仅为占位节点的现状。
- [x] 确认第一版 backend 应是 CLI Agent 代理节点，而不是 VSCode 内置语言模型。
- [x] 新建本 ExecPlan，明确范围、风险和验证口径。
- [x] 更新正式设计文档，记录 Agent backend 初步方案与取舍。
- [x] 扩展共享状态模型，为 `Agent` 节点增加最小运行时元数据。
- [x] 在宿主侧实现最小 `Agent` 运行控制与流式结果回流。
- [x] 在 Webview 中为 `Agent` 节点增加输入、启动和停止动作。
- [x] 完成构建与类型检查。
- [x] 完成手动验证并记录结果。
- [x] 记录结果与复盘，并提交本轮改动。

## 意外与发现

- 观察：`Agent` 节点的产品语义不是“向某个内置模型问一次问题”，而是“代理一个外部编码 Agent 会话”。
  证据：当前目标明确指向 `Codex` 或 `Claude Code` 这类 CLI Agent，而不是 GitHub Copilot 或其他 VSCode 内置 provider。

- 观察：插件不应把用户机器上的 CLI 绝对路径写死在实现里。
  证据：Extension Host 的 `PATH` 与用户交互 shell 可能不一致；同一台机器上 `codex` 甚至可能存在多个入口或版本。

- 观察：当前环境里 `claude` 可直接从 PATH 调起，而 `codex` 可执行版本存在但不在当前 PATH 的标准命令名上。
  证据：本机可直接执行 `claude --version`；`codex` 的可用二进制可通过用户指定路径调用，但默认 PATH 解析不稳定。

## 决策记录

- 决策：第一版 `Agent` backend 使用外部 CLI Agent，会话由宿主侧子进程启动。
  理由：当前产品要求已经明确收敛到 `Codex` 或 `Claude Code`，因此第一版不应再代理 VSCode 内置语言模型。
  日期/作者：2026-03-28 / Codex

- 决策：插件默认只依赖命令名 `codex` / `claude`，并允许通过设置项覆盖命令路径。
  理由：插件不应猜测用户本机目录结构，但必须给 PATH 不一致、nvm 环境或自定义安装路径留出显式配置入口。
  日期/作者：2026-03-28 / Codex

- 决策：运行中的请求允许用户显式停止，但扩展 reload 后不保证自动恢复。
  理由：CLI 子进程在扩展 reload 后无法自然续接；先把“可中断、可解释失败、reload 后不误报仍在运行”闭合，比虚假恢复更重要。
  日期/作者：2026-03-28 / Codex

## 上下文与定向

相关文档：

- 产品规格：`docs/product-specs/canvas-core-collaboration-mvp.md`
- 运行时设计：`docs/design-docs/vscode-canvas-runtime-architecture.md`
- 当前终端原型计划：`docs/exec-plans/active/terminal-proxy-node.md`

关键代码路径：

- 宿主入口：`src/extension.ts`
- 宿主状态与 Webview 协调：`src/panel/CanvasPanelManager.ts`
- 共享消息协议：`src/common/protocol.ts`
- 画布 UI：`src/webview/main.tsx`

本轮不引入新的 provider SDK，也不要求安装本扩展私有 backend。`Agent` 节点通过宿主启动 `codex` 或 `claude` 命令完成最小会话，并对“命令不存在”“PATH 不一致”“CLI 异常退出”等情况做显式退化。

## 工作计划

1. 更新设计文档和产品规格，记录第一版 Agent backend 的 CLI 路线和当前结论。
2. 扩展共享协议和节点元数据，让 `Agent` 节点能表达“最近目标、最近输出、当前运行态、当前 provider、最近 backend”。
3. 在宿主侧实现最小运行控制器：
   - 解析 CLI provider 与命令配置
   - 启动子进程
   - 处理 stdout / stderr
   - 停止运行
   - 回写节点状态
4. 在 Webview 中为 `Agent` 节点增加 provider 选择、输入框和动作按钮。
5. 完成构建、类型检查和手动验证。

## 具体步骤

1. 新增或更新设计文档，明确为什么当前不走 VSCode 内置语言模型，而走 CLI Agent 代理节点。
2. 为 `Agent` 节点增加宿主权威元数据，并保证旧状态可归一化。
3. 为 Webview 增加 `startAgentRun` / `stopAgentRun` 消息，并携带 provider。
4. 在宿主侧维护按节点 ID 索引的运行中子进程。
5. 用 CLI 输出持续更新 `Agent` 节点摘要；完成或失败时持久化最终状态。
6. 在 reload 恢复时，把无法继续的运行态显式收敛为“已中断”而不是假装仍在运行。

## 验证与验收

本轮至少满足以下条件才算完成：

- `Agent` 节点不再只是静态占位卡片。
- 用户能从 Agent 节点输入一个目标并启动一次真实 CLI Agent 会话。
- 运行中状态、成功结果和失败信息会回流到画布。
- 用户可以停止一个正在运行的请求。
- reload 后，不会把实际上已经丢失的运行错误地显示为仍在运行。
- `npm run build` 与 `npm run typecheck` 通过。
- 手动验证至少覆盖：
  - `codex` 或 `claude` 可用时的成功运行
  - 手动停止运行
  - CLI 命令不存在或 PATH 不一致时的错误反馈
  - reload 后的运行态收敛

## 幂等性与恢复

- 共享协议和状态归一化必须可重复执行，旧状态缺少 `Agent` 元数据时不能崩溃。
- 手动验证可重复执行；如果 CLI 启动因命令不存在、未登录或异常退出失败，应保留明确错误提示，允许再次触发。
- 如果扩展 reload 或窗口重开导致运行中请求丢失，节点状态必须回收为非运行态，并保留“上次运行未恢复”的提示。

## 结果与复盘

当前已完成：

- 确认第一版 `Agent` backend 的候选路线与当前收敛方向
- 建立本 ExecPlan，并明确范围、验收和恢复边界
- 已把 Agent backend 方案同步到正式设计文档、设计索引和产品规格
- 已在宿主侧改为启动外部 CLI Agent，并支持最小启动、停止、输出回流与 reload 后中断收敛
- 已在 Webview 中增加 Agent provider 选择、目标输入、运行和停止入口
- 已完成 `npm run build` 与 `npm run typecheck`
- 用户手动验证已通过当前环境下的 Agent 主路径

当前仍待完成：

- 后续可继续补 CLI 会话日志、恢复语义和多 Agent 协调能力

本轮手动验证结果：

- 用户反馈当前 Agent 节点验证通过，没有发现阻塞问题
- 当前原型已完成“选择 provider -> 输入目标 -> 启动 CLI 会话 -> 回流输出”的最小闭环验证
