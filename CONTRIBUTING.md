# 开发与贡献

本文件是 DevSessionCanvas 的开发与贡献入口。

当前仓库已完成 MVP 验证；后续默认按正式开发和持续迭代推进，不再把交付物当作一次性原型处理。

## 开始前先读

开始交付性工作前，先阅读以下文档：

- `docs/WORKFLOW.md`
- `ARCHITECTURE.md`
- `docs/PRODUCT_SENSE.md`
- `AGENTS.md`

如果任务涉及复杂功能、显著重构、多步研究或需要持续决策记录，先按 `docs/PLANS.md` 创建或更新 `ExecPlan`。

## 本地准备

在仓库根目录执行：

```bash
npm install
npm run build
```

如果要做发布前打包检查，执行：

```bash
npm run package
```

如果只做静态检查，执行：

```bash
npm run typecheck
```

如需生成内部体验版 VSIX，执行：

```bash
npm run package:vsix
```

如果要验证 `Agent` 节点的真实运行链路，还需要满足以下条件：

- `codex` 或 `claude` 至少有一个可从 Extension Host 解析到
- 如果 Extension Host 的 `PATH` 无法直接解析命令，可在 VSCode 设置中配置 `opencove.agent.codexCommand` 或 `opencove.agent.claudeCommand`
- 如果要让主画布默认出现在 VSCode Panel，而不是编辑区，可在设置中配置 `opencove.canvas.defaultSurface = panel`

## 本地调试

`Run Dev Session Canvas` 是仓库自带的 VSCode 调试配置，不是命令面板里的普通命令。

推荐启动方式：

1. 打开 VSCode 的 `Run and Debug` 视图
2. 在顶部调试配置下拉框中选择 `Run Dev Session Canvas`
3. 点击启动按钮，或直接按 `F5`

也可以通过命令面板执行：

1. `Debug: Select and Start Debugging`
2. 选择 `Run Dev Session Canvas`

启动后，VSCode 会打开一个新的 `Extension Development Host` 窗口。后续所有插件交互都在这个新窗口中进行，不是在当前仓库窗口里完成。

## 打开画布

在新的 `Extension Development Host` 窗口中：

1. 打开命令面板
2. 执行以下任一命令：
   - `Dev Session Canvas: 打开画布`
   - `Dev Session Canvas: 在编辑区打开画布`
   - `Dev Session Canvas: 在面板打开画布`

默认情况下，`Dev Session Canvas: 打开画布` 会按 `opencove.canvas.defaultSurface` 的当前设置打开主画布；显式命令可直接覆盖本次打开位置。

## 建议验证路径

当前建议至少验证以下两条主路径：

1. `Terminal` 节点
   - 创建一个 `Terminal` 节点
   - 点击“创建并显示终端”
   - 关闭真实终端后，确认节点状态回流为关闭态
   - 重新打开画布后，点击“尝试连接现有终端”不会错误新建终端

2. `Agent` 节点
   - 创建一个 `Agent` 节点
   - 选择 `Codex` 或 `Claude Code`
   - 输入简短目标并点击“运行 Agent”
   - 观察节点进入运行态，并在完成后回流结果摘要
   - 如需验证中断链路，可在运行中点击“停止 Agent”

## 常见误区

- `Run Dev Session Canvas` 不是命令面板命令，而是调试配置名称。
- `Dev Session Canvas: 打开画布` 会按默认承载面打开主画布；如需直接落在某个宿主区域，请使用显式的编辑区 / 面板打开命令。
- 如果你只在当前仓库窗口里搜索 `Run Dev Session Canvas`，通常找不到正确入口，因为它应从调试配置启动。
- 当前不是稳定版发布仓库状态；当前阶段默认只做内部体验版 VSIX 分发。
- 正式开发阶段不等于公开稳定发布；当前仍以内部 Preview 迭代为主。

## 提交与收口

- 每次有意义的变更，至少应包含文档更新、自动化测试或手动验证说明之一。
- 如果改动触及产品、设计或架构结论，必须同步更新对应正式文档。
- 准备提交前，先确认 `docs/WORKFLOW.md` 中的分支、提交与 MR 约定。
- 不要把未确认内容写成已确认内容。
