---
title: Terminal 节点嵌入式会话窗口设计
decision_status: 已选定
validation_status: 验证中
domains:
  - VSCode 集成域
  - 画布交互域
  - 协作对象域
  - 执行编排域
architecture_layers:
  - 宿主集成层
  - 画布呈现层
  - 共享模型与编排层
related_specs:
  - docs/product-specs/canvas-core-collaboration-mvp.md
related_plans:
  - docs/exec-plans/completed/embedded-terminal-runtime-window.md
  - docs/exec-plans/completed/execution-session-platform-compatibility.md
updated_at: 2026-03-30
---

# Terminal 节点嵌入式会话窗口设计

## 1. 背景

当前仓库已经实现了 `Terminal` 节点的第一版“宿主终端代理节点”原型：节点能创建、显示和重连 VSCode 原生终端，但真实终端并不在画布内，节点本体只是状态与跳转入口。

这条路线验证了宿主状态回流，却没有对齐 OpenCove 的核心产品语义。用户要的不是“在画布里放一个跳转器”，而是“把终端窗口本身放回画布里”。

## 2. 问题定义

本轮需要回答的问题是：

1. `Terminal` 节点的正确产品定义到底是什么。
2. 真正可交互的嵌入式终端，当前应该走哪条宿主后端路线，才能在实现风险和产品目标之间取得平衡。
3. 哪些状态必须留在宿主侧，哪些只需要作为 Webview 内的运行时表现，不应被误写成可永久恢复能力。

## 3. 目标

- 把 `Terminal` 节点重新定义为画布中的终端会话窗口，而不是 VSCode 原生终端的代理卡片。
- 让主要输入、输出、滚动和聚焦行为都在节点内部完成。
- 保持宿主权威状态、节点摘要和恢复边界清晰，不把短期内做不到的恢复能力伪装成已完成。

## 4. 非目标

- 不在本轮像素级复刻参考产品的全部终端视觉细节。
- 不在本轮承诺跨扩展重载恢复完整活动终端 buffer。
- 不在本轮把 Windows 写成“已经完成人工验证”；Linux / macOS 优先闭合，Windows 只在拿到验证证据后才升级结论。

## 5. 候选方案

### 5.1 继续使用 VSCode 原生终端代理节点

特点：

- 真实 shell 仍跑在 VSCode 原生终端。
- 节点只显示摘要、状态和跳转动作。

不选原因：

- 这条路线的产品语义已经偏了。它验证了“能不能打开终端”，却没有验证“终端是否真正属于画布”。
- 用户的主要操作仍发生在画布外，不符合当前明确目标。

### 5.2 `xterm.js + node-pty`

特点：

- Webview 里用 `xterm.js` 渲染终端。
- 宿主侧用 `node-pty` 创建真实 PTY。

优点：

- 是最常见、最标准的嵌入式终端组合。
- 后续跨平台能力理论上更完整。

当前选择原因：

- 现在用户已经明确要求 Linux / macOS 优先，同时希望 Windows 尽量兼容；继续围绕 `script` 扩展只会放大平台分叉。
- 当前扩展构建目标已经是 `node18`，而 `node-pty` 也提供了多平台预编译产物，足以支撑这轮统一 PTY 收口。

### 5.3 `xterm.js + script PTY bridge`

特点：

- Webview 里仍用 `xterm.js` 渲染真正的终端前端。
- 宿主侧不再依赖原生 Node 模块，而是通过系统自带的 `script` 命令为 shell 分配 PTY。

当前不继续沿用的原因：

- 它适合作为 Linux 原型，但不适合作为 Linux / macOS / Windows 的统一长期主线。
- 运行中 resize、停止语义和平台错误处理都会被迫继续分叉。

## 6. 当前结论

当前收敛结论如下：

- `Terminal` 节点的正确产品定义是“画布中的终端会话窗口”。
- 主交互必须留在节点内部，而不是继续依赖 VSCode 原生终端。
- 当前实现路线选择 `xterm.js + node-pty`：
  - Webview 使用 `xterm.js` 渲染终端前端；
  - 宿主用统一 PTY bridge 启动真实 shell，并通过消息桥传递输入输出。
  - Linux / macOS 作为当前主支持平台；Windows 代码路径已接通，但仍待人工验证。

同时必须明确记录两个边界：

- 活跃会话的原始 buffer 当前只保留在宿主内存里；持久化状态只记录摘要、最近输出、cwd、shell 路径和退出信息。
- Webview 隐藏或重新显示时应能重新附着到同一活跃会话；但扩展重载后的完整活动会话恢复当前不承诺。
- 运行中 resize 现在通过 PTY 后端原生能力处理，不再通过 stdin 注入 `stty`。

## 7. 风险与取舍

- 取舍：当前接受原生 PTY 依赖，换取 Linux / macOS 主路径收口，并让 Windows 进入同一后端模型。
  原因：平台兼容性已经成为当前用户目标的一部分，继续保留 `script` 只会让平台能力和运行时模型一起分叉。

- 风险：如果终端输出只在内存中保留，扩展重载后用户看不到完整历史 buffer。
  当前缓解：把最近输出和退出信息写入宿主权威状态，并明确告诉用户当前未实现完整活动会话恢复。

- 风险：`node-pty` 路线会引入原生模块与扩展打包约束。
  当前缓解：构建脚本已把 `node-pty` 设为 external，并依赖其预编译产物；当前先以 `build` / `typecheck` / Linux smoke test 证明基本可行。

- 风险：Windows 与远程场景仍缺少人工验证证据。
  当前缓解：文档状态继续保持“验证中”，不把未确认平台写成已支持。

## 8. 验证方法

至少需要完成以下验证：

1. 在宿主 shell 里验证 `node-pty` 确实给子 shell 分配了真实 TTY。
2. `npm run build` 和 `npm run typecheck` 通过。
3. 在 Linux / macOS 的 `Extension Development Host` 中，新建 `Terminal` 节点后可直接在节点内输入并看到实时输出。
4. Webview 隐藏再显示后，仍能附着回已有会话，而不是每次都新开一个 shell。
5. 活跃会话期间调整节点尺寸后，终端行列同步生效。
6. 未信任 workspace 时，终端创建与输入路径被正确禁用。

## 9. 当前验证状态

- 已完成宿主 smoke test，确认当前 Linux 环境下 `node-pty` 启动的子 shell 具备真实 TTY 语义。
- 已完成代码级实现，并通过 `npm run build` 与 `npm run typecheck`。
- 当前 shell 环境没有可直接启动 `Extension Development Host` 的 `code`/`cursor`/`codium` CLI，也没有 macOS / Windows 本地人工验证证据；文档状态继续保持为“验证中”。
