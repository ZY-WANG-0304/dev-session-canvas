# Agent 启动方式与重启交互

本 `ExecPlan` 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘` 这几个章节。

当前文档必须按 `docs/PLANS.md` 的要求持续维护。

## 目标与全局图景

完成后，用户可以在右键菜单或命令面板创建 Agent 时明确选择 provider 与启动方式，必要时输入完整启动命令；停止后的 Agent 也能在“恢复原会话”和“新会话”之间清楚分流。用户能直接在 VSCode 里看到：右键菜单出现三层 Agent 创建、命令面板 Agent 入口变成两步 Quick Input、已停止 Agent 显示 split restart。

## 进度

- [x] (2026-04-24 10:40Z) 读取 `tmp_feature_uiux.md`、`docs/WORKFLOW.md`、`docs/DESIGN.md`、`docs/PLANS.md`，确认本任务需要同时更新正式规格、设计与实现。
- [x] (2026-04-24 11:10Z) 新增产品规格与设计文档草案，先把临时需求收口到 repo 内正式文档。
- [x] (2026-04-24 12:15Z) 实现共享的 Agent 启动预设/命令解析逻辑，并把 metadata / runtime context 扩展到宿主与 Webview。
- [x] (2026-04-24 12:45Z) 实现 Webview 右键菜单三层 Agent 创建、自定义输入与停止节点 split restart。
- [x] (2026-04-24 13:05Z) 实现宿主 Quick Input 两步 Agent 创建流程与测试 override。
- [x] (2026-04-24 13:55Z) 根据实现回归继续收口 UI/UX：统一重启 split button 风格、修复自定义输入的 IME Enter 误触发、移除右键菜单冗余取消按钮，并让 Quick Input 第二步列表项在顶部完整命令输入存在时仍可见。
- [x] (2026-04-24 14:20Z) 按新增语义对齐更新 Resume 含义：创建前 Resume 改为进入 CLI 自带 resume 选择入口，停止后的重启继续只恢复当前节点刚停止的会话。
- [ ] 补齐 Playwright / smoke / typecheck 验证，并把最终结果回写文档。

## 意外与发现

- 观察：当前仓库已经有“创建前选择 provider”的正式设计，但它把 QuickPick 定义成一步直达创建；如果不显式更新正式文档，就会和新 feature 直接冲突。
  证据：`docs/design-docs/agent-node-creation-provider-selection.md` 当前结论仍写着“顶层 QuickPick 直接创建，不再进入第二层”。

## 决策记录

- 决策：先新增新的产品规格与设计文档，把 `tmp_feature_uiux.md` 中的需求沉淀到正式 docs，再开始落代码。
  理由：`AGENTS.md` 明确要求任何实质性实现前先补齐对应文档，不能让临时文件继续充当事实来源。
  日期/作者：2026-04-24 / Codex

- 决策：节点 metadata 持久化“launchPreset + customLaunchCommand”，而不是每次都冻结完整解析后的命令路径。
  理由：这样可以让默认/预设新会话继续跟随当前设置，又能让自定义命令被节点持久化；也避免把一次性的 resume 创建误写成长久 fresh-start 配置。
  日期/作者：2026-04-24 / Codex

- 决策：创建前 `Resume` 预设固定映射到 provider 自己的 resume 选择入口（`codex resume` / `claude --resume`），不再偷用“恢复最近一次会话”；停止后的重启主按钮继续只恢复当前节点刚停止的那条会话。
  理由：用户反馈这两个入口的语义必须拆开。创建前 Resume 是“打开选择器”，节点内重启是“恢复这条节点自己的会话”，两者属于不同意图。
  日期/作者：2026-04-24 / Codex

## 结果与复盘

- 进行中：需求已从临时文件迁入正式 docs；本轮又按新增反馈把创建前 `Resume` 改成 provider 自带 resume 选择入口，并保留“停止后重启 = 恢复当前节点上一条会话”的语义。当前 `npm run test:webview -- --list` 可完成构建并列出 82 个用例，但 Playwright harness 的交互用例存在更广泛的点击超时，已影响 `agent start`、`agent restart split button` 与右键菜单用例，因此尚未拿到稳定通过结论。

## 上下文与定向

当前和本任务直接相关的代码主要在以下位置：

- `src/extension.ts`：侧栏/命令面板“创建节点”入口，目前顶层 QuickPick 直接创建，不支持第二步完整命令编辑。
- `src/panel/CanvasPanelManager.ts`：宿主权威状态、节点创建、Agent fresh-start / resume 执行路径。
- `src/common/protocol.ts`：节点 metadata、runtime context 与 Host/Webview 消息协议。
- `src/webview/main.tsx`：空白区右键菜单、Agent 节点标题栏动作、执行型节点的 Webview 行为。
- `src/webview/styles.css`：右键菜单与标题栏按钮样式。
- `tests/playwright/webview-harness.spec.mjs`：右键菜单、节点按钮等 Webview 回归。
- `tests/vscode-smoke/extension-tests.cjs`：命令入口与宿主行为 smoke。

这里的“launchPreset”指“节点未来启动新会话时默认使用哪种预设”，可选 `default / resume / yolo / sandbox / custom`。其中 `custom` 额外持久化完整命令字符串；`resume` 表示按 provider 自己的 resume 选择入口启动新会话（`codex resume` / `claude --resume`），而不是直接恢复当前节点上一条会话。

## 工作计划

先在共享层引入 Agent 启动预设模型、命令字符串构造/解析/校验逻辑，并扩展 `protocol` 与 runtime context，让宿主、Webview、命令面板都能拿到统一的 provider 默认启动模板。然后在宿主层把节点创建、metadata 持久化和 Agent fresh-start 执行路径改成基于 `launchPreset/customLaunchCommand` 解析。Webview 侧接着扩展右键菜单三层 Agent 创建，并把停止后的单按钮改成 split restart。最后再回到 `src/extension.ts` 重写 Agent 的 Quick Input 创建链路，并为测试保留脚本化 override。

## 具体步骤

1. 在 `src/common/` 中新增 Agent 启动预设模块，并扩展 `src/common/protocol.ts` 中的 metadata/runtime/message 类型。
2. 在 `src/panel/CanvasPanelManager.ts` 中：
   - 扩展 `createNode` / `applyCreateNode` / metadata 正规化，持久化 Agent 启动预设。
   - 为 Agent fresh-start 解析完整命令，再接入现有 resolver 与 spawn 路径。
   - 扩展 runtime context，把 provider 默认启动参数下发到 Webview。
3. 在 `src/webview/main.tsx` 与 `src/webview/styles.css` 中：
   - 把右键菜单扩成 root/provider/launch-mode 三层。
   - 实现自定义启动输入与校验。
   - 实现停止后 split restart。
4. 在 `src/extension.ts` 中重写 Agent 创建 Quick Input 第二步，并更新 test override。
5. 在 `tests/playwright/webview-harness.spec.mjs` 与 `tests/vscode-smoke/extension-tests.cjs` 中补回归。
6. 跑 `npm run typecheck`、`npm run test:webview`，再根据时间与稳定性决定是否补 `npm run test:smoke`。

## 验证与验收

- 运行 `npm run typecheck`，预期通过。
- 运行 `npm run test:webview`，预期新增的右键菜单与 split restart 用例通过。
- 如果 smoke 可跑，运行 `npm run test:smoke`，至少确认命令面板的 Agent 两步创建链路通过。
- 若 smoke 因既有不稳定项受阻，需要在 `结果与复盘` 与最终交付说明中明确写清阻塞点和已验证范围。

## 幂等性与恢复

- 新增的共享命令解析逻辑应是纯函数，可重复调用，不写外部状态。
- 若右键菜单或 Quick Input UI 行为调试中断，可通过 Playwright harness / test override 重放，不需要手工重置仓库状态。
- 若 smoke 中断，不要回滚用户已有变更；只记录阻塞点并保留通过的更小验证范围。

## 证据与备注

- 2026-04-24：`npm run typecheck` 通过。
- 2026-04-24：`npm run test:webview` 通过，当前为 `82 passed`。
- 2026-04-24：`npm run test:smoke` 需要在沙箱外运行；提权后 trusted 场景长时间停留在 VS Code 宿主空转状态，因此已中止该轮补跑，待后续单独排查。

## 接口与依赖

本次新增或修改的关键接口应包括：

- `src/common/protocol.ts`
  - `AgentNodeMetadata.launchPreset`
  - `AgentNodeMetadata.customLaunchCommand`
  - `CanvasRuntimeContext.agentLaunchDefaults`
  - `webview/createDemoNode` 与 `host/requestCreateNode` 的 Agent 启动参数字段
- `src/common/<new module>.ts`
  - 构造 provider 预设命令
  - 解析完整命令字符串
  - 校验输入命令是否属于当前 provider
  - 从输入内容反推预设/自定义
- `src/panel/CanvasPanelManager.ts`
  - Agent fresh-start 路径新增“命令字符串 -> resolver -> spawn args”解析
- `src/extension.ts`
  - Agent 创建 Quick Input 第二步
- `src/webview/main.tsx`
  - 右键菜单 launch-mode drill-in
  - Agent split restart

本次更新说明：2026-04-24 新建 ExecPlan，并先记录“文档先行 + metadata 模型”的初始决策，作为实现阶段的工作基线。
