---
name: recording-marketplace-media
description: Use when the user asks to record, generate, or update the marketplace preview media (MP4/GIF/PNG) for the Dev Session Canvas VS Code extension. Triggers on words like "录制", "预览图", "marketplace media", "GIF", "录制一遍".
---

# Recording Marketplace Media

## Overview

AI 实时驱动的录制系统。通过 CLI 工具启动真实 VS Code Extension Development Host，根据剧本和实时截图动态执行操作，生成 MP4/GIF/PNG 预览媒体。

## 工作流

```
start → [逐场景: record-start → 操作 → gif-frame → record-stop] → stop
```

1. 读剧本 `docs/marketplace-media-scenario.md`
2. `node scripts/recording-session.mjs start` 启动环境（也可用兼容入口 `npm run generate:marketplace-media -- start`）
3. 等待 session 文件出现（约 15-30s）
4. 逐场景执行：
   - `record-start` 开始录制视频片段
   - 执行操作（录制片段内只用 click/key/paste 模拟用户鼠标/键盘）
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
| `command <cmd> [json_args]` | 仅限旧测试宿主/场景初始化；真实录制环境不支持 |
| `dispatch <json>` | 仅限旧测试宿主/场景初始化；真实录制环境不支持 |
| `state` | 读取画布节点/边状态 |
| `record-start` | 开始录制视频片段 |
| `record-stop` | 停止当前片段 |
| `gif-frame <label>` | 截取 GIF 帧 |
| `stop` | 停止环境，拼接 MP4 + 合成 GIF + PNG |

所有命令前缀: `node scripts/recording-session.mjs`；兼容 npm 入口为 `npm run generate:marketplace-media -- <command>`。不带子命令运行 `npm run generate:marketplace-media` 时只输出交互式录制流程，不会一次性无头生成完整素材。

## 关键技巧

**真实环境优先（最重要）：**
- `start` 启动的是非测试模式的 VS Code Extension Development Host，尽量保持与真实用户环境一致
- 除场景初始化外，录制过程不要用 `command` / `dispatch` / 直接改状态来绕过 UI
- VS Code 原生确认框、Quick Input、右键菜单都应作为真实交互录入视频；用 `click` / `key` / `paste` 完成
- `locate`、`screenshot`、`state` 只用于观察和定位，不应替代用户操作
- 当前正式录制默认用录制专用 `claude` wrapper 稳定 Claude provider 输出；这是媒体录制边界，必须在 PR/验证说明中显式标注，不能写成真实 Claude CLI 输出。

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
- `command` / `dispatch` — 不用于真实录制片段；如必须用于场景初始化，应在 `record-start` 之前完成并在剧本中说明
- `file-list` 类型节点是运行时动态创建的，不能通过 `setPersistedState` 持久化
- webview 消息格式: `{type: "webview/updateNodeTitle", payload: {nodeId, title}}`

**注意事项：**
- 环境启动后需等待 15-30s session 文件才出现
- 模态对话框是录制内容的一部分；重置模板时用真实鼠标/键盘点击 VS Code 原生确认框，不要绕过
- `setPersistedState` 不能删除有活跃运行时的节点
- 鼠标滚轮: button 5 = 向下滚动
- `saveCanvasAsTemplate` 命令会弹出 Quick Input，可用 `paste` + `key Return` 输入模板名
- 抓最终全景前必须等待或关闭 VS Code notification，确保 PNG、GIF 最后一帧和 MP4 尾帧没有 toast 遮挡画布/小地图。

## 产物

- `images/marketplace/canvas-overview.mp4` — 片段拼接视频
- `images/marketplace/canvas-overview.gif` — GIF 关键帧动图
- `images/marketplace/canvas-overview.png` — 最终全景截图

## 相关文件

- `docs/marketplace-media-scenario.md` — 录制剧本
- `scripts/generate-marketplace-media.mjs` — 历史 npm 入口兼容 wrapper
- `scripts/recording-session.mjs` — 录制工具
- `scripts/x11-native-input.py` — X11 原生输入
