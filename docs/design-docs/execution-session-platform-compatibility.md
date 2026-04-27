---
title: 执行会话平台兼容性设计
decision_status: 已选定
validation_status: 验证中
domains:
  - VSCode 集成域
  - 执行编排域
  - 协作对象域
architecture_layers:
  - 宿主集成层
  - 共享模型与编排层
  - 适配与基础设施层
related_specs:
  - docs/product-specs/canvas-core-collaboration-mvp.md
related_plans:
  - docs/exec-plans/completed/execution-session-platform-compatibility.md
updated_at: 2026-04-28
---

# 执行会话平台兼容性设计

## 1. 背景

当前仓库已经把 `Terminal` 与 `Agent` 收敛为画布内的嵌入式会话窗口，但现有宿主后端最初是围绕 Linux `script` 原型闭合主路径的。这条路线帮助原型快速落地，却把平台能力和运行中 resize 一起锁死在 Linux / 类 Unix 语义上。

现在的用户目标已经明确收敛为：

- Linux、macOS、Windows 本地都能直接启动嵌入式 `Terminal` / `Agent`，并进入同一条后端主线。
- 桌面三平台的可用性结论必须和验证证据一起升级，而不是继续停留在“代码路径已接通”。
- 即使 Windows 当前轮次已经拿到主路径验证证据，剩余已知限制也必须单独写清楚，不能把它包装成“已经没有差异”。

## 2. 问题定义

本轮需要回答的问题是：

1. 当前执行会话后端应该继续围绕 `script` 分平台扩展，还是直接收敛到统一 PTY 抽象。
2. 在优先支持 Linux / macOS 的前提下，怎样同时为 Windows 预留尽量一致的主路径，而不是继续堆平台特判。
3. 哪些平台结论已经有实现和验证证据，哪些可以升级为“已验证可用”，剩余已知限制应如何记录。
4. 当 Extension Host 的 `PATH` 与用户交互 shell 不一致时，怎样更稳健地定位本地编程 CLI，而不是把命令发现完全外包给手填设置。

## 3. 目标

- 让 `Terminal` 与 `Agent` 的宿主会话后端共享统一抽象，而不是把平台判断散落在 `CanvasPanelManager` 中。
- 让 Linux 与 macOS 进入同一条已实现的嵌入式 PTY 主路径。
- 在不额外分叉运行时模型的前提下，让 Windows 也尽量复用同一后端能力。
- 让运行中 resize 成为后端原生能力，而不是继续依赖“仅首帧 fit”这种临时退化。
- 让 `Agent` 的本地编程 CLI 定位不再只依赖当前 Extension Host 进程 PATH。

## 4. 非目标

- 不在本轮承诺所有远程宿主都已经完成人工验证；`Remote SSH` 可作为已验证主路径，但 Codespaces 等更深远程场景仍不在当前承诺内。
- 不在本轮把 Windows 写成“完全没有已知限制”的稳定支持。
- 不在本轮为不同平台分别维护多套长期共存的后端实现。
- 不在本轮追求浏览器形态或 `vscode.dev` 兼容。

## 5. 候选方案

### 5.1 继续围绕 `script` 扩展类 Unix 路线

特点：

- Linux 继续使用当前 util-linux `script`。
- macOS 再单独适配 BSD `script` 参数差异。
- Windows 仍需要额外引入 ConPTY / winpty 路线。

不选原因：

- 这条路线无法真正收敛平台复杂度，只是把“一个 Linux 原型”变成“两套类 Unix 分支 + 一套 Windows 分支”。
- `Agent` / `Terminal` 的生命周期、resize、kill 和错误处理最终仍会继续堆平台特判。

### 5.2 统一切到 `node-pty`

特点：

- 宿主统一通过 `node-pty` 建立真实 PTY。
- `Terminal` 直接启动 shell；`Agent` 直接启动 provider CLI。
- Webview 继续使用 `xterm.js`，只替换宿主后端。

优点：

- Linux、macOS、Windows 都可复用同一套 `spawn / write / resize / kill / onData / onExit` 模型。
- 运行中 resize 可以直接交给 PTY 后端，而不再污染前台程序输入流。
- `CanvasPanelManager` 可以收敛为状态编排者，把平台细节下沉到单独 bridge。

风险：

- 会引入原生 Node 模块，需要处理扩展打包与运行时加载。
- Windows 下 provider CLI 的 PATH、`.cmd` / `.exe` 解析与剩余交互限制仍需持续补齐证据。

## 6. 当前结论

当前收敛结论如下：

- 执行会话后端从 Linux `script` 原型迁移到统一 `node-pty` 路线。
- Linux、macOS、Windows 本地 workspace 现在都走统一 `node-pty` 主路径，并已完成功能可用性验证。
- Windows 仍保留一条显式已知限制：使用 `Codex` 时，执行节点内历史当前无法向上翻页；这条差异必须继续写在对外文案与技术债中。
- `Terminal` 与 `Agent` 共用同一个宿主会话 bridge；差别只在于启动命令和节点语义。
- `Agent` provider CLI 的命令发现采用宿主侧 resolver，而不是把裸命令名直接交给 PTY：
  - 显式设置优先
  - 最近成功解析的绝对路径缓存次之
  - 当前宿主 `PATH` 再次之
  - POSIX 登录 shell 探测、Windows `where.exe` / `Get-Command` 与常见包装后缀作为最后自动回退
- 宿主当前通过最小 PTY bridge 暴露：
  - 创建会话
  - 写入输入
  - 运行中 resize
  - 停止会话
  - 订阅输出
  - 订阅退出事件

## 7. 风险与取舍

- 取舍：接受原生 PTY 依赖，换取平台收敛和真实 resize。
  原因：用户已经不再满足于“Linux 原型可跑”，而是明确要求 Linux / macOS 为主、Windows 尽量兼容。

- 风险：Windows 下 `codex` / `claude` 这类命令若通过 npm 全局安装，常见入口可能是 `.cmd` / `.exe` 包装；同时，Windows 上使用 `Codex` 时执行节点内历史仍存在无法向上翻页的已知限制。macOS / Linux 从 GUI 启动 VSCode 时，Extension Host 的 PATH 也可能和交互 shell 不一致。
  当前缓解：把命令定位升级为宿主侧 resolver，显式覆盖 Windows 包装后缀、POSIX 登录 shell 探测和成功路径缓存；设置项仍保留为最高优先级兜底。同时把 Windows `Codex` 历史翻页问题明确登记为技术债，不把它写成已收口。

- 风险：Remote SSH / Codespaces 的 Extension Host 与 Webview 仍然跨端运行，平台兼容并不自动等于所有远程宿主都已收口。
  当前缓解：`Remote SSH` 主路径已按当前轮支持口径升级为“已验证可用”；但 Codespaces 与其他更深远程场景仍继续保留为待补验证，不把它们误写成已完成。

## 8. 验证方法

至少需要完成以下验证：

1. `npm run typecheck` 与 `npm run build` 通过。
2. 在当前 Linux 环境中，用 `node-pty` 启动 shell 后，子进程 `stdin/stdout` 都表现为 TTY。
3. 在本地 VSCode 中，Linux / macOS 至少各完成一次 `Terminal` 与 `Agent` 节点人工 smoke test。
4. Windows 本地至少完成一次真实 `Agent` / `Terminal` 人工 smoke test，并把剩余已知限制显式记录到发布文案与技术债。
5. Webview 尺寸变化后，活跃会话行列能够同步更新，而不是只在启动前生效。
6. 至少完成一次“CLI 已安装但当前 Extension Host PATH 不直达”的命令发现验证，确认宿主侧 resolver 能定位到目标 CLI。

## 9. 当前验证状态

- 已完成 `npm run typecheck` 与 `npm run build`。
- 已完成 Linux 本地 `node-pty` TTY smoke test，确认子进程具备真实 PTY 语义。
- 截至 `2026-04-28`，Linux、macOS、Windows 本地 workspace 的 `Agent` / `Terminal` 主路径已补齐当前轮功能可用性验证。
- Windows 下使用 `Codex` 时，执行节点内历史当前仍有无法向上翻页的已知限制；文档状态继续保持为“验证中”，直到这条剩余差异与更深的远程场景验证也完成收口。
- 截至 `2026-04-28`，`Remote SSH` 主路径已补齐当前轮功能可用性验证。
- Codespaces 与其他更深远程场景的人工验证证据仍需继续补齐，因此这些场景保持为“验证中”。
