---
name: recording-marketplace-media
description: Use when the user asks to record, generate, or update the marketplace preview media (MP4/GIF/PNG) for the Dev Session Canvas VS Code extension. Triggers on words like "录制", "预览图", "marketplace media", "GIF", "录制一遍".
---

# Recording Marketplace Media

## Overview

AI 实时驱动的录制系统。通过 CLI 工具启动 VS Code 录制环境，根据剧本和实时截图动态执行操作，生成 MP4/GIF/PNG 预览媒体。

## 工作流

```
start → [逐场景: record-start → 操作 → gif-frame → record-stop] → stop
```

1. 读剧本 `docs/marketplace-media-scenario.md`
2. `node scripts/recording-session.mjs start` 启动环境
3. 等待 session 文件出现（约 15-30s）
4. 逐场景执行：
   - `record-start` 开始录制视频片段
   - 执行操作（click/key/paste/command/dispatch）
   - `gif-frame <label>` 截取 GIF 帧
   - `record-stop` 停止片段
   - 思考/验证时间不录制（不在 record-start/stop 之间）
5. `stop` 拼接 MP4 + 合成 GIF + 导出 PNG

## 命令参考

| 命令 | 用途 |
|------|------|
| `start` | 启动 Xvfb + VS Code 环境 |
| `screenshot` | 截图查看当前画面 |
| `locate <selector>` | CDP 定位 workbench DOM 元素，返回屏幕坐标 JSON |
| `click <x> <y> [--right] [--double]` | 原生鼠标点击 |
| `key <combo>` | 按键（Return, Escape, Ctrl+A, Shift+Insert） |
| `paste <text>` | 剪贴板粘贴 |
| `command <cmd> [json_args]` | VS Code 命令（通过 recording control） |
| `dispatch <json>` | 发送 webview 消息 |
| `state` | 读取画布节点/边状态 |
| `record-start` | 开始录制视频片段 |
| `record-stop` | 停止当前片段 |
| `gif-frame <label>` | 截取 GIF 帧 |
| `stop` | 停止环境，拼接 MP4 + 合成 GIF + PNG |

所有命令前缀: `node scripts/recording-session.mjs`

## 关键技巧

**Control 文件超时（最重要）：**
- smoke test 的 `waitForCompletion` 有 **60 秒超时**，超时后 control 文件不再被轮询
- 必须在环境启动后 60 秒内完成所有 control 文件写入（`command`、`dispatch` 等）
- 推荐流程：环境就绪 → 通过 UI 操作（click/key）逐场景录制 → 仅在 UI 无法完成时才用 command/dispatch
- 如果超时了，唯一的恢复方式是 `stop` 后重新 `start`

**定位元素坐标：**
- workbench 级元素（侧栏按钮、对话框）: 用 `locate` 命令
- canvas 内部元素（右键菜单项）: 用 `screenshot` 看画面判断坐标
- `locate` 命令需要连接 CDP，耗时约 2-3 秒，右键菜单可能在此期间关闭

**右键菜单坐标计算：**
- canvas iframe 在窗口中的位置通过 CDP 获取（典型值: x=348, y=65）
- 屏幕坐标 = 窗口偏移(140,140) + iframe 偏移(348,65) + iframe 内坐标
- 即 iframe 左上角屏幕坐标 ≈ (488, 205)
- 右键点击位置（屏幕坐标）需在 iframe 范围内，推荐 (800, 500) 附近
- 菜单位置由 `resolveContextMenuPosition` 决定：anchor 相对于 iframe 的坐标，受边界裁剪
- 菜单项偏移（相对于菜单左上角 iframe 坐标）：
  - `create-note`: (124, 60)
  - `create-terminal`: (124, 104)
  - `create-agent-codex`: (124, 148)
  - `create-agent-claude`: (124, 190)
  - `show-claude-launch-modes` ▶: (220, 190)
  - `show-reset-template-picker` ▶: (230, 310)
- 最终屏幕坐标 = iframe 屏幕偏移 + menu 位置 + 菜单项偏移

**状态操作：**
- `setPersistedState` — 仅用于两种场景：(1) 录制开始前初始化画布状态；(2) 剧本明确要求切换到一段新故事线的初始状态。录制过程中的状态变更不应使用它，否则视频中会出现不自然的突变
- UI 操作（click/key/paste）— 录制过程中的首选，产生真实用户交互画面
- `command` 执行 VS Code 命令 — 用于绕过模态对话框（如 `createNode`、`startExecutionSession`）
- `dispatch` 发送 webview 消息 — 用于 fitView 等无 UI 反馈的操作
- `file-list` 类型节点是运行时动态创建的，不能通过 `setPersistedState` 持久化
- webview 消息格式: `{type: "webview/updateNodeTitle", payload: {nodeId, title}}`

**注意事项：**
- 环境启动后需等待 15-30s session 文件才出现
- 模态对话框会阻塞 smoke test，避免触发（用 test 命令绕过）
- `setPersistedState` 不能删除有活跃运行时的节点
- 鼠标滚轮: button 5 = 向下滚动
- `saveCanvasAsTemplate` 命令会弹出 Quick Input，可用 `paste` + `key Return` 输入模板名

## 产物

- `images/marketplace/canvas-overview.mp4` — 片段拼接视频
- `images/marketplace/canvas-overview.gif` — GIF 关键帧动图
- `images/marketplace/canvas-overview.png` — 最终全景截图

## 相关文件

- `docs/marketplace-media-scenario.md` — 录制剧本
- `scripts/recording-session.mjs` — 录制工具
- `scripts/generate-marketplace-media.mjs` — 环境搭建（RECORDING_INTERACTIVE=1 模式）
- `scripts/x11-native-input.py` — X11 原生输入
