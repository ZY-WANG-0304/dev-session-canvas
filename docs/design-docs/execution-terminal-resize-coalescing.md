---
title: 执行终端尺寸合并与重绘边界
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
  - docs/exec-plans/completed/execution-terminal-resize-coalescing.md
updated_at: 2026-07-14
---

# 执行终端尺寸合并与重绘边界

## 1. 背景与问题

Agent 与 Terminal 节点同时存在两种“尺寸”：画布节点的像素外框，以及 PTY/xterm 的字符网格 `cols/rows`。画布 resize 的 pointer move 是 Webview 本地交互草稿；PTY resize 则是 provider 进程可见的运行时事件。两者若逐帧绑定，用户拖动一个外框就会向 Codex 或 Claude Code 连续发送多个真实尺寸变化。

2026-07-14 的现场诊断显示，一个 Claude Agent 在约 50 个 journal revision 内接收了 27 个不同 resize，几乎每个 resize 后都输出由 `ESC[H` 与重复 `ESC[2K` 组成的全屏重绘帧，至少 29 帧。Host output revision 单调、panel attach/render 生命周期正常，因此画面中的重复回答片段不是消息重复投递，也不是 Claude 重复生成回答，而是快速尺寸变化暴露了全屏 TUI 的中间重绘帧。

## 2. 目标与非目标

本设计要让执行节点继续提供实时外框 resize 预览，同时把 provider 可见的 PTY resize 收口到稳定的最终字符尺寸；也要让纯位置拖动只修复本地 renderer 可能出现的陈旧像素，不通知 provider。

本轮不改变 terminal journal 中 resize 作为有序事件的语义，不修改 Host/Supervisor 的 PTY 能力，不阻止 Codex/Claude 在一次真实最终 resize 后正常重排，也不承诺消除 provider 自身输出的所有 ANSI 重绘帧。

## 3. 已选定方案

### 3.1 自定义 resize 手势期间冻结字符网格

`NodeResizeAffordance` 继续逐帧发布 Webview 本地节点位置/尺寸草稿，React Flow 继续实时显示外框变化。Agent/Terminal 在包装后的 `onDraftNodeLayout` / `onResizeNodeEnd` 回调中同步维护 active ref；处于 active 状态时，其 `ResizeObserver` 不运行 `FitAddon.fit()`，也不调用 `onResizeExecution`。现有 xterm 投影保持手势开始前的字符网格；容器变大时会暂时出现留白，变小时由容器裁切，这是刻意接受的短暂预览状态。

pointer-up 或取消为明确的手势结束边界。有效 resize 必须在最终节点草稿收口后触发执行终端 finalize：按最终容器 fit 一次、立即去重提交最终 `cols/rows`，然后安排一次 xterm `refresh(0, rows - 1)`。取消或无变化同样可以 finalize，但尺寸去重保证不会产生无意义的 PTY resize。

### 3.2 非手势布局变化做末值合并

Panel 宽高、sidebar、字体度量或其他非节点手势几何变化没有可靠的 pointer-up 边界。对应 `ResizeObserver` 可以 fit 本地 xterm，但向 Host 的尺寸提交使用 150ms trailing settle：窗口内的新尺寸替换旧 pending 值，只在稳定后提交最后一组。最后已提交的 `cols/rows` 被显式记录，相同尺寸不重复发送。

这个时间窗只是 Webview 的流量整形，不改变 Host/Supervisor 收到后对 resize 的有序处理。明确的节点 resize finalize 不等待 settle window，以免给用户增加松手后的可见延迟。

### 3.3 纯位置拖动只做本地 refresh

节点位置变化不改变 `.terminal-viewport` 的逻辑像素尺寸，因此不应 fit xterm，也不应发送 `webview/resizeExecutionSession`。浏览器仍可能在 React Flow 拖动/选中布局期间发出 `ResizeObserver` 通知，所以普通画布与 Pane Gallery 都在 drag start 通过 terminal registry 显式进入 movement-active，忽略这段时间的 fit/上报；drag stop 下一帧才释放，并对本次移动的 Agent/Terminal（包含多选共同移动节点）安排一次本地 xterm refresh。该动作只重画当前 buffer，用于清理浏览器 canvas/WebGL 合成后可能残留的旧像素，不会触发 PTY `SIGWINCH`，因而不会要求 Codex/Claude 自己重绘。

## 4. 与既有设计的关系

本方案延续 `canvas-node-surface-and-resize.md` 的既有结论：pointer move 中的节点几何只是 Webview 本地草稿，只有最终位置和尺寸进入宿主权威状态。新增约束是：对执行节点而言，PTY 字符网格也不能把本地草稿误当作逐帧权威变化。

本方案也延续 `embedded-terminal-runtime-window.md` 对 destructive fit 与 non-destructive redraw 的区分。`fit()` 只用于真实稳定的容器尺寸变化；纯移动、visibility restore 等不改变字符网格的路径使用 `refresh()`。最终 PTY resize 仍是运行时有序事件，不能在 Host 或 supervisor 中任意丢弃。

## 5. 风险与取舍

- 取舍：resize 手势期间字符网格不会填满每一帧外框。这样牺牲短暂的“内容实时铺满”，换取 provider 不被迫连续全屏重排；外框仍实时响应，松手后内容立即对齐最终尺寸。
- 风险：150ms settle 可能让外部容器 resize 后的 PTY 尺寸短暂落后。缓解方式是本地 xterm 可先适应稳定容器，只有 provider 通知延后；窗口足够短，并且每次只保留末值。
- 风险：React 状态收口与 DOM 尺寸提交可能跨 animation frame。缓解方式是通过明确的 `onResizeNodeEnd` finalize 信号，在最终草稿移除后的 frame 才读取容器并 fit。
- 风险：本地 refresh 只能修复 renderer 陈旧像素，不能修复 provider buffer 本身已经被错误 resize 的内容。核心预防仍是阻止中间 PTY resize，而不是依赖 refresh 掩盖问题。

## 6. 验证口径

Playwright 必须对 Agent 与 Terminal 各执行一次多步 resize：指针移动但未释放期间没有 `webview/resizeExecutionSession`；释放后只有一条最终 resize；等待超过两倍 settle window 后仍只有一条；最终尺寸与起始尺寸不同。纯节点移动必须产生 `webview/moveNode` 且不产生执行会话 resize。

类型检查、构建和 resize 聚焦 Webview 回归必须通过；完整 Webview 回归用于同时识别相关回归与当前主线无关失败，不能用更新无关快照/期待来掩盖失败。可运行时补 trusted VS Code smoke，确认最终尺寸仍能进入 Host/Supervisor。真实宿主人工观察应满足：慢速或来回拖动执行节点外框时，Codex/Claude 不再逐帧重绘；松手后只针对最终宽高重排一次；只移动节点位置时 provider 不重绘。

## 7. 当前验证状态

实现与自动化验证已完成：Agent/Terminal 的连续 resize 与纯移动 4 条回归通过，resize 聚焦套件 15/15 通过，trusted VS Code smoke 通过；完整 Webview 套件 343/353 通过，10 条失败为当前主线既有截图、文案、菜单/default-args 期待漂移或一次就绪超时，本轮新增及后续 terminal journal/restore/zoom 用例全部通过。由于尚未在真实 Codex/Claude 进程上人工观察来回 resize，仍保持 `validation_status: 验证中`，完成记录见 `docs/exec-plans/completed/execution-terminal-resize-coalescing.md`。
