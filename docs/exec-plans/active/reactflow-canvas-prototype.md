# 建立 React Flow 画布原型

本 ExecPlan 是活文档。推进过程中必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘`。

## 目标与全局图景

在现有 `WebviewPanel + typed message bridge + serializer` 原型基础上，引入第一版真正的画布引擎原型，用于验证以下问题：

- 当前设计选择的 React Flow 是否适合承载四类核心对象
- 多对象是否可以在同一张可平移、缩放的画布中呈现
- 当前 Host / Webview 状态边界是否足以继续承载节点与位置数据

本阶段仍不追求完整终端与 Agent 体验，但要让原型从“普通卡片列表”升级为“真正的空间化画布”。

## 进度

- [x] 决定把当前占位前端升级为画布原型，而不是继续停留在列表式占位页面。
- [x] 确认 React Flow 路线在当前本地工具链中的依赖兼容性。
- [x] 扩展共享状态模型，使其可承载节点位置等画布信息。
- [x] 用 React Flow 重建 Webview 前端，支持基础平移、缩放和节点呈现。
- [x] 完成构建与类型检查，并补充验证说明。
- [x] 提交本轮画布原型改动。
- [ ] 补齐画布交互与恢复链路的手动验证，并据此决定是否迁入 `completed`。

## 意外与发现

- 观察：上一轮原型已经验证了 `WebviewPanel`、消息桥和 serializer 主线，因此本轮可以把风险集中到画布引擎本身。
  证据：`docs/exec-plans/completed/webviewpanel-prototype-bootstrap.md` 已记录自动化与手动验证结果。

- 观察：在当前本地 `node 12` 环境下，`react`、`react-dom` 与 `reactflow@11.11.4` 可以与现有构建链共同工作。
  证据：完成依赖安装后，`npm run build` 与 `npm run typecheck` 都通过。

## 决策记录

- 决策：本轮优先验证 React Flow，而不是继续维持自绘占位前端。
  理由：顶层设计文档已经把 React Flow 作为当前首选画布路线；如果不尽快把它接入原型，就无法验证这条选型是否站得住。
  日期/作者：2026-03-28 / Codex

- 决策：当前先把节点位置纳入宿主权威状态，并通过拖拽停止事件回传位置更新。
  理由：如果位置仍只存在于 Webview，本轮就无法验证“空间化画布 + 宿主权威状态”这条主线是否能成立。
  日期/作者：2026-03-28 / Codex

## 上下文与定向

相关文档：

- 技术路线设计：`docs/design-docs/vscode-canvas-runtime-architecture.md`
- 产品规格：`docs/product-specs/canvas-core-collaboration-mvp.md`
- 上一轮原型计划：`docs/exec-plans/completed/webviewpanel-prototype-bootstrap.md`

本轮要验证的是“画布呈现层是否能从列表占位演进到空间化节点图”，而不是一次性做完所有协作能力。

## 工作计划

1. 确认 React Flow 依赖版本与当前本地 Node/构建工具链兼容。
2. 扩展共享协议，加入节点位置等画布基础字段。
3. 在 Webview 中引入 React Flow，重建节点渲染与基础控制面板。
4. 保留上一轮已验证的消息桥和 serializer 路径。
5. 完成构建校验，并整理下一步未覆盖项。

## 具体步骤

1. 安装 React、React DOM 与 React Flow 依赖。
2. 更新 `tsconfig` 与构建配置，支持 `tsx` 前端入口。
3. 更新共享状态与示例节点生成逻辑。
4. 实现 React Flow 画布、节点组件与控制区。
5. 运行 `build`、`typecheck`，必要时做手动验证。

## 验证与验收

本轮至少满足以下条件才算完成：

- 工程仍可成功构建。
- Webview 打开后显示真正的可平移、缩放画布，而不是普通静态列表。
- 四类节点可以以空间化形式显示在画布中。
- 宿主侧新增节点消息仍能更新画布状态。
- 最终说明中明确 React Flow 当前已验证到什么程度、还有哪些未覆盖项。

## 幂等性与恢复

- 如果 React Flow 路线因依赖或运行时问题不成立，应在本计划中记录失败原因，而不是静默回退。
- 若前端组织方式需要调整，保留共享协议和宿主权威状态主线。
- 所有构建与验证命令应可重复执行。

## 结果与复盘

本轮已完成以下结果：

- 引入 `react`、`react-dom` 与 `reactflow`
- 扩展共享协议，新增节点位置与节点拖拽回传消息
- 将 Webview 前端从静态列表改为真正的 React Flow 画布
- 增加背景、缩放控制、MiniMap、浮层控制面板和自定义节点卡片
- 保持上一轮 `WebviewPanel`、typed message bridge、serializer 与宿主权威状态主线不变

本轮已完成的自动化验证：

- `npm run build`
- `npm run typecheck`

后续终端、Agent、Task 与 Note 迭代已经证明 React Flow 画布可以持续承载真实节点交互与宿主状态回流；本计划当前只剩“画布专属交互与恢复链路”的专项手动验证仍待补齐。

当前仍待手动验证的内容：

- 画布在 `Extension Development Host` 中的平移、缩放与拖拽交互
- 节点拖拽后关闭再打开面板时的位置恢复
- `Reload Window` 后的恢复行为

当前未覆盖的能力：

- 节点间连接线与关系编辑
- 真实终端代理节点
- 真实 Agent backend
- Remote / Restricted Mode 专项验证
