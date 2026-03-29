# 重新建立 VSCode 画布架构研究与初步设计基线

本 ExecPlan 是活文档。推进过程中必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘`。

## 目标与全局图景

针对前一轮文档骨架迁移中“架构设计与方案选型过于草率”的问题，重新建立一套可继续推进实现的设计基线。当前阶段的目标不是直接锁定所有实现细节，而是完成以下产出：

- 一份有明确问题定义、候选方案比较、风险与待验证项的具体设计文档。
- 对 `ARCHITECTURE.md` 中过早下结论或表达模糊的部分进行收口。
- 一份可继续推进到产品规格、原型或代码实现阶段的研究记录。

用户可见结果是：后续协作者能够仅凭仓库中的正式文档，理解为什么项目应运行在怎样的 VSCode 扩展边界内、优先采用什么技术路线、哪些地方仍待实验验证。

## 进度

- [x] 阅读当前工作流、架构、设计和产品文档，确认本任务必须先建立 ExecPlan。
- [x] 盘点仓库现状，确认当前仍处于文档与设计定义阶段，尚无实现代码约束。
- [x] 补充外部一手资料调研，覆盖 VSCode 宿主边界、Webview/Terminal 能力和无限画布技术路线。
- [x] 形成具体设计文档，写清问题、候选方案、初步结论、风险与验证方式。
- [x] 视情况更新 `ARCHITECTURE.md` 和 `docs/design-docs/index.md`。
- [x] 完成本轮研究的结果与复盘，给出下一阶段建议入口。

## 意外与发现

- 观察：本轮任务启动时，仓库只有文档骨架，没有具体设计文档，也没有实现代码。
  证据：初始盘点时 `docs/design-docs/index.md` 注册表为空；仓库文件列表中不存在 `src/`、`package.json` 等实现骨架。

- 观察：当前 `ARCHITECTURE.md` 已经给出了领域划分与四层边界，但没有引用验证证据，也没有候选方案比较。
  证据：`ARCHITECTURE.md` 已定义“宿主集成层 / 画布呈现层 / 共享模型与编排层 / 适配与基础设施层”，但未说明这些边界如何从 VSCode 能力约束中推导出来。

- 观察：VSCode 官方能力边界决定了“原生终端直接嵌入 Webview”不能被当作默认成立前提。
  证据：官方 Webview/Terminal API 没有提供把原生终端嵌进 Webview 的能力；若要实现嵌入式终端，必须额外引入 `xterm.js + pty` 路线。

- 观察：远程工作区场景天然把宿主和 Webview 分成远端/本地两侧，这会直接影响状态权威来源与消息协议设计。
  证据：VSCode Remote 文档明确说明 Workspace Extension 可运行在远端，而 Webview 始终运行在本机或浏览器侧。

- 观察：当前四类核心对象更接近“高交互节点图”，而不是开放式白板。
  证据：产品文档当前聚焦 Agent、终端、任务、笔记四类对象的协作组织；React Flow、tldraw、PixiJS 的官方文档比较后，节点图路线更贴合第一阶段主路径。

## 决策记录

- 决策：本轮先聚焦“运行时边界 + 技术路线 + 待验证项”的初步设计，不同时扩写完整产品规格。
  理由：当前仓库缺的不是功能范围罗列，而是可以约束后续实现的技术与边界基线。若先写详细规格，会把未澄清的实现假设误当成产品承诺。
  日期/作者：2026-03-28 / Codex

- 决策：外部调研优先使用一手资料，包括 VSCode 官方文档和候选技术路线的官方文档。
  理由：本任务直接影响后续实现路径与投入，必须尽量减少二手解读导致的偏差。
  日期/作者：2026-03-28 / Codex

- 决策：第一阶段主画布以 `WebviewPanel` 承载，而不是 `WebviewView` 或 `CustomEditor`。
  理由：当前对象是 workspace 级协作画布，不是单文件的替代编辑器；同时主画布需要足够空间，侧边栏视图不适合作为主工作面。
  日期/作者：2026-03-28 / Codex

- 决策：第一阶段以 `Node.js workspace extension + 宿主权威状态 + React Flow + 原生终端代理节点` 作为初步收敛方案。
  理由：这条路线最符合当前产品范围和 VSCode 官方能力边界，同时把嵌入式终端、高自由白板和浏览器形态留给后续验证与演进。
  日期/作者：2026-03-28 / Codex

## 上下文与定向

当前相关文档与边界如下：

- 顶层目标与边界：`ARCHITECTURE.md`
- 产品定位：`docs/PRODUCT_SENSE.md`
- 设计文档规范：`docs/DESIGN.md`
- 前端界面设计关注点：`docs/FRONTEND.md`
- 可靠性约束：`docs/RELIABILITY.md`
- 漏洞报告与安全响应流程：`docs/SECURITY.md`
- 系统安全与隐私边界：`ARCHITECTURE.md` 与相关设计文档

当前核心问题不是“如何立刻实现全部能力”，而是“在 VSCode 插件约束下，什么样的运行时拆分、画布技术路线和状态边界最适合先闭合核心协作体验主路径”。

## 工作计划

1. 调研 VSCode 扩展宿主可用能力，尤其是 `WebviewPanel`、消息通信、状态恢复和 `Terminal`/`Pseudoterminal` 相关边界。
2. 比较至少两到三条无限画布技术路线，重点关注：
   - 是否适合节点化协作对象
   - 对复杂自定义节点和局部高交互内容的支持
   - 是否容易与 VSCode Webview 集成
   - 后续从 MVP 演进到更自由空间布局时的风险
3. 明确哪些状态由 Extension Host 持有，哪些状态只保留在 Webview，哪些需要持久化到 workspace。
4. 输出设计文档，并把顶层架构文件中仍然过粗或过早的表述收紧到“已确认边界”。

## 具体步骤

1. 查阅仓库现有正式文档，整理当前已确认与待确认边界。
2. 查阅 VSCode 官方文档：
   - Webview 与 WebviewPanel 生命周期
   - Webview 状态保存与恢复
   - Extension Host 与 Webview 消息通信
   - Terminal API 与 Pseudoterminal 能力
3. 查阅候选画布技术官方文档，形成比较表。
4. 产出 `docs/design-docs/` 下的具体设计文档，并同步更新索引。
5. 如有必要，更新 `ARCHITECTURE.md` 中的顶层边界表述。

## 验证与验收

本轮任务至少满足以下条件才算完成：

- `docs/exec-plans/active/` 中存在持续更新的研究型 `ExecPlan`。
- `docs/design-docs/` 中新增一份具体设计文档，包含问题定义、候选方案、风险与验证方法。
- `docs/design-docs/index.md` 已登记该设计文档，并与 frontmatter 状态一致。
- 若 `ARCHITECTURE.md` 有初步结论与设计文档不一致，已显式同步。
- 最终说明中明确哪些结论已经选定，哪些仍是待验证假设。

## 幂等性与恢复

- 文档调研与分析步骤可重复执行；如外部资料变化，应在设计文档中更新引用与结论日期。
- 若某条候选技术路线被推翻，不回滚整份文档，而是在“候选方案”“决策记录”和“结果与复盘”中追加说明。
- 若本轮未能形成稳定结论，至少应保留可继续接手的研究脉络、证据链接和待验证实验列表。

## 结果与复盘

本轮已完成以下结果：

- 新建研究型 `ExecPlan`：`docs/exec-plans/completed/canvas-architecture-research.md`
- 新增具体设计文档：`docs/design-docs/vscode-canvas-runtime-architecture.md`
- 更新设计索引：`docs/design-docs/index.md`
- 在 `ARCHITECTURE.md` 中补充“具体技术路线应以下游设计文档为准”的指向
- 同步更新 `docs/PRODUCT_SENSE.md`、`docs/RELIABILITY.md`、`docs/FRONTEND.md`，使产品、质量文档与当前架构边界保持一致
- 按 `SECURITY写作指南.md.md` 重写 `docs/SECURITY.md`，把其职责收口为漏洞报告与安全响应流程

本轮形成的初步设计结论如下：

- 第一阶段以 `Node.js workspace extension` 为唯一必须落地的宿主形态。
- 主画布放在 Editor Group 中的 `WebviewPanel`。
- 画布引擎优先采用 React Flow，但通过自有抽象隔离具体库。
- 对象模型与持久化由宿主持有，Webview 主要负责投影与局部 UI 状态。
- 终端先以“原生终端代理节点”闭合主路径，嵌入式终端改为独立验证路线。
- Agent 先定义适配边界，不在文档层提前绑定某一类 AI 扩展能力。

下一阶段建议入口：

1. 先做 `WebviewPanel + typed message bridge + panel serializer` 原型。
2. 再做 React Flow 版四类节点最小画布原型，验证交互密度和性能。
3. 用一个最小 terminal backend 验证“代理节点”是否足够支撑核心体验。
4. 如需继续追求参考产品的终端沉浸感，再单开一轮 `xterm.js + pty` 设计与原型。
