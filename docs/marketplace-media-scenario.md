# Marketplace 预览媒体录制剧本

录制方法参考: `docs/skills/recording-marketplace-media/SKILL.md`

## 环境配置

- 显示尺寸: 1720×1180 (Xvfb)
- VS Code 主题: Default Dark Modern
- 文件活动功能: 启用
- Peacock 颜色: 录制时自动移除
- Panel 位置: bottom, 默认最大化

## 场景流程

### 场景 1: 开场 — 使用说明模板

应用默认模板"使用说明"，展示 Note 节点的 Markdown 预览能力（标题、列表、checklist、代码块）。

**GIF 帧:** 使用说明 Note 的 Markdown 预览全貌

---

### 场景 2: 重置为示例模板

在画布空白区域右键，通过菜单中的"重置为模板 ▶"展开模板选择器，选择"示例模板"，确认重置。画布变为 3 个节点（Note "工作说明" + Agent "AI Assistant" + Terminal）和一条带标签的连线。

**GIF 帧:**
- 右键菜单打开（显示"重置为模板"选项）
- 模板选择器展开（显示"示例模板"选项）
- 重置完成后的画布

---

### 场景 3: 创建 Claude YOLO Agent

在画布空白区域右键，点击 Claude Code 旁的 ▶ 展开启动模式，选择"YOLO 模式"创建 Agent。

**GIF 帧:**
- 右键菜单打开
- 启动模式列表展开
- Agent 创建完成后的画布

---

### 场景 4: 重命名 + 整理视图

将新创建的 Claude Agent 重命名为"Reviewer"。

**GIF 帧:** 重命名完成、布局整齐的画布

---

### 场景 5: 创建带样式连线

fit view 让所有节点可见，在 AI Assistant 和 Reviewer 之间创建一条带箭头、颜色和标签"review"的连线。在 Reviewer 和 Terminal 之间创建一条带箭头、颜色和标签"deploy"的连线。

**GIF 帧:** 两条彩色标签连线可见的画布

---

### 场景 6: Agent 执行 + 文件活动

向 Reviewer 发送一个写文件的任务，等待执行完成后文件活动列表节点出现。

**GIF 帧:** 文件活动节点出现后的画布

---

### 场景 7: 保存为模板

通过侧栏的保存模板功能，将当前画布保存为用户模板"我的协作模板"。滑动侧栏的模板列表区域，使新建的 “我的写作模板” 可见。

**GIF 帧:**
- 保存模板表单打开
- 侧栏显示新保存的模板

---

### 场景 8: 最终全景

最大化 panel 区域，fit view 显示完整画布全貌。

**GIF 帧:** 完整工作区全景（作为 PNG 截图和 GIF 最后一帧）

---

## 右键菜单布局参考

根菜单项从上到下:
1. 笔记 (Note)
2. 终端 (Terminal)
3. Codex（默认）— 左侧主按钮 + 右侧 ▶
4. Claude Code — 左侧主按钮 + 右侧 ▶
5. ─── 分隔线
6. 应用模板 — 左侧主按钮 + 右侧 ▶
7. 重置为模板 — 左侧主按钮 + 右侧 ▶
8. 保存为模板

启动模式子菜单:
1. 快速启动
2. Resume 模式
3. YOLO 模式
4. 沙盒模式

## 画布控件位置

- Fit view 按钮: 画布左下角，react-flow controls 区域最下方的按钮
- Zoom in/out: fit view 按钮上方

## 侧栏布局

- Activity bar: 最左侧 ~48px
- 侧栏面板: 紧邻 activity bar，宽约 300px
- 侧栏视图从上到下: 概览、常用操作、节点、会话历史、模板
- 模板视图工具栏按钮（从左到右）: 刷新、导入、保存
