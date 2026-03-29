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
updated_at: 2026-03-29
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
- 不在本轮把 Windows、macOS 和 Linux 的宿主后端一次性收敛到统一完备方案，如果没有验证证据，就不能写成已支持。

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

当前不选原因：

- 当前仓库环境里的默认 Node 是 `v12.22.9`，而 `node-pty` 会引入原生模块编译和 VSCode/Electron ABI 对齐问题。
- 在没有先把产品主路径闭合前，先把实现绑到高风险原生模块上，会让任务规模失控。

### 5.3 `xterm.js + script PTY bridge`

特点：

- Webview 里仍用 `xterm.js` 渲染真正的终端前端。
- 宿主侧不再依赖原生 Node 模块，而是通过系统自带的 `script` 命令为 shell 分配 PTY。

优点：

- 当前 Linux 环境已经验证 `script` 存在，并且子 shell 中 `stdin/stdout` 都被识别为 TTY。
- 可以显著降低本轮依赖和 ABI 风险，把注意力集中到“终端是否真的进入画布”。

风险：

- 这条路线天然更偏类 Unix 环境，跨平台一致性不足。
- 它更适合当前原型和 Linux 开发环境，不代表长期终态后端已经最终定型。

## 6. 当前结论

当前收敛结论如下：

- `Terminal` 节点的正确产品定义是“画布中的终端会话窗口”。
- 主交互必须留在节点内部，而不是继续依赖 VSCode 原生终端。
- 当前实现路线选择 `xterm.js + script PTY bridge`：
  - Webview 使用 `xterm.js` 渲染终端前端；
  - 宿主用 `script -qfc <shell> /dev/null` 启动真实 shell，并通过消息桥传递输入输出。

同时必须明确记录两个边界：

- 活跃会话的原始 buffer 当前只保留在宿主内存里；持久化状态只记录摘要、最近输出、cwd、shell 路径和退出信息。
- Webview 隐藏或重新显示时应能重新附着到同一活跃会话；但扩展重载后的完整活动会话恢复当前不承诺。

## 7. 风险与取舍

- 取舍：当前先把“真正嵌入式终端”做通，但后端选 `script` 而不是 `node-pty`。
  原因：用户要验证的是产品语义是否成立，不是本轮就把宿主后端一次性做到跨平台完备。

- 风险：如果终端输出只在内存中保留，扩展重载后用户看不到完整历史 buffer。
  当前缓解：把最近输出和退出信息写入宿主权威状态，并明确告诉用户当前未实现完整活动会话恢复。

- 风险：`script` 路线的跨平台能力不足。
  当前缓解：只把已经验证的平台写成已支持；对缺失平台和缺失依赖给出明确退化错误，而不是静默失败。

## 8. 验证方法

至少需要完成以下验证：

1. 在宿主 shell 里验证 `script` 确实给子 shell 分配了真实 TTY。
2. `npm run build` 和 `npm run typecheck` 通过。
3. 在 `Extension Development Host` 中，新建 `Terminal` 节点后可直接在节点内输入并看到实时输出。
4. Webview 隐藏再显示后，仍能附着回已有会话，而不是每次都新开一个 shell。
5. 未信任 workspace 时，终端创建与输入路径被正确禁用。

## 9. 当前验证状态

- 已完成宿主 smoke test，确认当前 Linux 环境存在 util-linux `script`，且子 shell 具备真实 TTY 语义。
- 已完成代码级实现，并通过 `npm run build` 与 `npm run typecheck`。
- 当前 shell 环境没有可直接启动 `Extension Development Host` 的 `code`/`cursor`/`codium` CLI，因此“节点内真实交互路径”的最后一跳仍待本地 VSCode 人工确认；文档状态继续保持为“验证中”。
