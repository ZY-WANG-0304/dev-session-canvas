# 标准 monorepo 与文档知识库落位

本 `ExecPlan` 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘` 这几个章节。

本文位于 `docs/exec-plans/active/standard-monorepo-and-doc-knowledge-base.md`，必须按 `docs/PLANS.md` 的要求持续维护。

## 目标与全局图景

> **⚠️ 重要更新 (2026-05-03)**：本计划现在需要与 [IntelliJ 平台插件开发计划](./intellij-platform-plugin.md) 协调。详见 [跨计划协调文档](./cross-plan-coordination.md)。
> 
> **🎯 优先级决策 (2026-05-03)**：团队决定先完成 notifier 开发，再考虑 IntelliJ 支持。本计划第一阶段聚焦 VSCode 生态，跨平台共享层延后到第二阶段。

这项工作要把当前”单扩展仓库”演进成一个标准 monorepo，同时不让仓库文档因为多包而分裂成多套真相。这里的”标准 monorepo”指的是：仓库根目录只负责 workspace 编排、统一文档和跨包脚本；真正的 VS Code 扩展与共享库分别落在 `extensions/` 和 `packages/` 下，按包边界独立构建、测试和打包。

**分阶段实施 (2026-05-03)**：
- **第一阶段（当前）**：聚焦 VSCode 生态，完成主扩展 + notifier companion 的 monorepo 化
- **第二阶段（延后）**：扩展到 IntelliJ Platform，建立跨平台共享代码层

完成后，新协作者打开仓库根目录时，应能直接看到三件事：第一，代码包拓扑清晰，知道主扩展、UI-side notifier companion 和共享协议各在哪里；第二，正式文档只有一套根目录知识库，不需要在多个子包里寻找相互冲突的结论；第三，存在一张文档知识库体系图，能帮助第一次接触仓库的人知道”README、ARCHITECTURE、WORKFLOW、DESIGN、设计索引、产品规格、ExecPlan”各自负责什么。用户可观察的成功结果包括：在仓库根目录执行统一命令能够编排所有包的构建与测试；正式文档入口仍然集中在根目录；扩展子目录只保留局部 README / CHANGELOG，而不复制一整套架构与设计文档。

## 进度

- [x] (2026-04-30 11:35 +0800) 复核 `docs/WORKFLOW.md`、`docs/PLANS.md`、`ARCHITECTURE.md` 与当前仓库结构，确认本任务属于跨包结构与文档体系设计，适合先以独立 `ExecPlan` 收口。
- [x] (2026-04-30 11:42 +0800) 盘点当前仓库根目录仍是单扩展结构：`package.json` 既承担扩展 manifest，又承担仓库脚本入口；`src/`、`images/`、`tests/` 与 `docs/` 直接并列于根目录。
- [x] (2026-04-30 11:55 +0800) 新建本 `ExecPlan`，记录标准 monorepo 目标结构、文档知识库落位规则、知识库体系图建议位置，以及后续迁移步骤。
- [x] (2026-05-03) 识别与 IntelliJ 插件开发计划的协调需求，创建跨计划协调文档。
- [x] (2026-05-03) **实施策略调整**：决定先在当前结构下验证 notifier 可行性，再做目录迁移。
- [x] (2026-05-03) **实施策略再调整**：notifier 直接在 `extensions/vscode/dev-session-canvas-notifier/` 开发，主扩展暂不迁移。
- [x] (2026-05-03 10:25 +0800) 完成阶段 1.1 的第一批落地：根 `package.json` 已配置 `workspaces`；`extensions/vscode/dev-session-canvas-notifier/` 与 `packages/attention-protocol/` 已创建；主扩展已能优先调用 companion，并通过 `npm run test:notifier-smoke` 验证“发送通知 -> companion 回放点击 -> 聚焦节点并清除 attention”。
- [x] (2026-05-03 17:10 +0800) 完成 notifier 第二批落地：companion 新增“发送测试桌面通知 / 打开通知诊断输出”命令，真实桌面通知人工验收步骤已收口到固定命令与输出面板；共享结果新增 `activationMode`，主扩展 diagnostic event 也会显式记录平台退化路径。
- [x] (2026-05-03 19:05 +0800) 补齐本地 / 远端联调配置：新增 `Run Notifier Only (Local Window)`、`Run Dev Session Canvas + Notifier (Local Window)` 与 `Run Remote Main + Local Notifier (Prompt)`，并把远端联调输入从 4 项收口到 `remoteAuthority` + `localRepoRoot` 两项。
- [x] (2026-05-03) **阶段 1.1 的代码与文档收口已完成**：`extensions/vscode/dev-session-canvas-notifier/`、`packages/attention-protocol/`、主扩展接线、诊断输出、联调配置与正式文档均已落地；当前工作树已经是可提交并切换环境继续调试的状态。
- [x] (2026-05-04) 追加“从本地窗口发起远端主扩展 + 本机 notifier”调试配置：新增 `Run Remote Main + Local Notifier (Prompt from Local Window)`，并同步补齐 `remoteWorkspacePath` 输入、协作文档与人工验收说明，避免把本机 `${workspaceFolder}` 误当成远端路径。
- [x] (2026-05-04) 完成阶段 1.1 尾项（真实桌面通知人工验收）：macOS、Windows、Linux 本机环境与 `Remote Main + Local Notifier` 联调拓扑均已完成人工验收；其中 macOS 先确认过 `macos-osascript + activationMode=none` 退化路径，随后在安装 `terminal-notifier` 后完成 `macos-terminal-notifier + protocol` 主路径验证。
- [ ] **阶段 1.2（可选重构）**：notifier 验证通过后，根据需要决定是否迁移主扩展到 `extensions/vscode/dev-session-canvas/`。
- [ ] 新增文档知识库入口页与体系图资产，补齐根 README、`ARCHITECTURE.md` 与各扩展 README 的职责边界。
- [ ] **里程碑 5（延后到第二阶段）**：建立跨平台共享层（`packages/protocol/` 三层结构、`packages/webview/` 共享前端、JSON Schema 自动生成工具链）。仅在决定启动 IntelliJ 开发时执行。
- [ ] 完成根目录统一构建、测试、打包与最小文档验收，并将遗留技术债登记到 `docs/exec-plans/tech-debt-tracker.md`。

## 意外与发现

- 观察：当前仓库根目录的 `package.json` 同时承担“公开扩展 manifest”和“仓库级脚本入口”两种职责，若直接往根目录再塞第二个扩展，会让根目录语义越来越混乱。
  证据：根目录 `package.json` 目前既声明 `name: dev-session-canvas`、`main: ./dist/extension.js`、`contributes`、`extensionKind`，又维护整个仓库的 `build`、`test`、`package:vsix` 脚本。

- 观察：当前正式文档已经天然集中在根目录，且 `AGENTS.md` 明确要求不要从空白或占位文档脑补方案；如果迁移到 monorepo 后在每个子扩展下复制一整套 `docs/`，未来极易出现双份真相。
  证据：根目录已存在 `ARCHITECTURE.md`、`docs/WORKFLOW.md`、`docs/DESIGN.md`、`docs/product-specs/`、`docs/design-docs/`、`docs/exec-plans/`，并被 `AGENTS.md` 指定为唯一正式入口。

- 观察：当前 `docs/` 目录还没有单独的“知识库入口页”；协作者通常要靠 `README.md`、`docs/WORKFLOW.md`、`ARCHITECTURE.md` 和索引文件之间来回跳转才能建立全局心智图。
  证据：`docs/` 下目前存在 workflow、design-docs、product-specs、exec-plans 和 references，但没有 `docs/README.md` 或等价的仓库文档总览页。

- 观察：`docs/references/` 和未来可能出现的 `docs/generated/` 都不适合作为正式知识库体系图的归宿。
  证据：`AGENTS.md` 明确规定 `docs/references/` 只能作为输入，`docs/generated/` 不能替代人工确认后的正式结论。

- 观察：在 notifier 的第一版里，如果 companion 只调用“普通聚焦节点”命令，attention icon 不会清除，因为当前“聚焦”和“确认提醒”在主扩展里是两条不同语义。
  证据：首版 `test:notifier-smoke` 失败在“回放 focus callback 后 `attentionPending` 仍为 `true`”；新增 `devSessionCanvas.__internal.focusAttentionNode` 后，smoke 通过。

- 观察：真实桌面通知的最大平台差异不是“能否发出通知”，而是“通知发出后是否还能点击回到 VS Code”；如果不把这条差异显式写进结果结构，主扩展与人工验收都会把“posted”误读成“完整能力可用”。
  证据：Linux `notify-send` 在不支持 `--action --wait` 的桌面环境中会退化成只发通知；macOS 也可能从 `terminal-notifier` 回退到 `osascript`，这两条路径都仍然会返回“通知已发出”。

- 观察：在 `Remote SSH` / WSL / Dev Container 窗口里，workspace 主扩展可以直接从远端源码目录启动，但 `extensionKind: ["ui"]` 的 notifier companion 若仍指向远端路径，Development Host 中通常看不到 notifier 命令。
  证据：本轮联调排查里，`Run Notifier Only` 在远端窗口中无法出现 `Dev Session Canvas Notifier` 命令；改为“远端主扩展 + 本机 notifier”双路径注入后，调试链路恢复。

- 观察：现有 `Run Remote Main + Local Notifier (Prompt)` 如果从本地 clone 窗口启动，会把本机 `${workspaceFolder}` 误拼到 `vscode-remote://...` 后面，最终报“Unable to resolve workspace folder”。
  证据：在本地窗口里使用 `remoteAuthority=ssh-remote+gpu-dev042.hogpu.cc`、`localRepoRoot=/Users/wzy/Projects/dev-session-canvas` 启动时，Development Host 直接报 `Unable to resolve nonexistent file 'vscode-remote://ssh-remote+gpu-dev042.hogpu.cc/Users/wzy/Projects/dev-session-canvas'`。

## 决策记录

- 决策：本次 monorepo 迁移默认继续使用 `npm workspaces`，而不是同时引入 `pnpm`、`yarn` 或 `turbo`。
  理由：当前仓库已经使用 `npm` 与 `package-lock.json`，构建脚本也全部基于 `npm run ...`；先完成结构收口比同时切换包管理器更重要。
  日期/作者：2026-04-30 / Codex

- 决策：正式文档继续以根目录为唯一真相来源；扩展子目录只保留安装、发布和局部开发说明，不复制完整架构/设计文档。
  理由：本项目中的 notifier companion 不是独立产品，而是 DevSessionCanvas 的 companion；它引入的是新的运行位置边界，不是新的产品文档宇宙。
  日期/作者：2026-04-30 / Codex

- 决策：文档知识库体系图的正式入口放在计划中的 `docs/README.md`，而不是直接嵌进某个子扩展 README。
  理由：根 `README.md` 更适合面向外部用户和源码开发者做项目入口；`docs/README.md` 更适合作为仓库内正式文档入口，承载“去哪找哪类结论”的知识图谱。
  日期/作者：2026-04-30 / Codex

- 决策：知识库体系图与仓库拓扑图的图像资产单独存放在 `docs/diagrams/`，并由 Markdown 文档引用；图像本身不承担正式结论，正式结论仍写在 Markdown 正文里。
  理由：这样既能避免把正式图放进 `references/` 或 `generated/`，也能让图和说明文本一起受版本控制；同时保留图源文件（例如 `.mmd`）和导出图（例如 `.svg`）的空间。
  日期/作者：2026-04-30 / Codex

- 决策：标准 monorepo 的第一阶段只要求主扩展继续留在根目录，同时补齐 `extensions/vscode/dev-session-canvas-notifier/` 与 `packages/attention-protocol/` 这两个新包；`extension pack` 与主扩展迁移都作为后续可选阶段。
  理由：这能先把运行位置边界与文档知识库边界理顺，再决定是否需要额外优化”一键安装”体验。
  日期/作者：2026-04-30 / Codex

- **决策（2026-05-03 更新）**：monorepo 需要同时支持 VSCode 和 IntelliJ 两个平台，扩展目录调整为 `extensions/vscode/` 和 `extensions/intellij/` 两个分支。
  理由：团队计划开发 IntelliJ 插件以支持 Android Studio、PyCharm 等 10+ IDE；统一 monorepo 便于共享代码（协议定义、Webview 前端）和文档。
  日期/作者：2026-05-03 / Claude
  相关文档：[cross-plan-coordination.md](./cross-plan-coordination.md)

- **决策（2026-05-03 新增）**：使用 JSON Schema 作为跨平台协议定义的单一真相来源，自动生成 TypeScript 和 Kotlin 类型定义。
  理由：避免 TypeScript（VSCode）和 Kotlin（IntelliJ）手工同步导致的协议不一致；JSON Schema 可作为平台无关的契约。
  日期/作者：2026-05-03 / Claude
  相关文档：[cross-plan-coordination.md](./cross-plan-coordination.md)

- **决策（2026-05-03 新增）**：保持构建工具链隔离但协调，npm 和 Gradle 各自独立，根目录只做编排。
  理由：npm（VSCode）和 Gradle（IntelliJ）各有优势，强制统一会增加复杂度；根目录脚本通过 shell 调用协调两套工具链。
  日期/作者：2026-05-03 / Claude

- **决策（2026-05-03 新增）**：先在当前根目录结构下验证 notifier 可行性，再做 monorepo 目录迁移。
  理由：降低风险，避免在 notifier 价值未验证前就投入大规模目录重构；如果 notifier 不可行，可以停止而不影响主扩展。
  日期/作者：2026-05-03 / Claude
  相关文档：[cross-plan-coordination.md](./cross-plan-coordination.md)

- **决策（2026-05-03 再调整）**：notifier 直接在 `extensions/vscode/dev-session-canvas-notifier/` 开发，主扩展暂不迁移，形成混合结构。
  理由：避免临时目录的中间状态，notifier 一开始就在正确位置；主扩展迁移作为可选的第二步，不强制完整 monorepo 化。
  日期/作者：2026-05-03 / Claude

- 决策：第一版 notifier 采用“companion 优先、工作台通知兜底”的接线方式，而不是与现有 VS Code 工作台通知并行双发。
  理由：并行双发会立刻引入提醒噪音；当前用户更需要的是“本机桌面通知可用，同时原工作台提醒仍可在 companion 缺失时回退”，而不是两种表面同时出现。
  日期/作者：2026-05-03 / Codex

- 决策：第二批 notifier 收口采用“显式暴露退化能力”，而不是在 `activationMode=none` 时偷偷再补发一条 VS Code 工作台通知。
  理由：当前产品更需要真实反映平台差异，并给人工验收与诊断留下证据；如果 companion 已成功发出桌面通知却再补发工作台通知，会把“能力退化”和“重复提醒噪音”混在一起。
  日期/作者：2026-05-03 / Codex

- 决策：保留现有 `Run Remote Main + Local Notifier (Prompt)` 作为“从远端仓库窗口发起”的入口，并额外新增 `Run Remote Main + Local Notifier (Prompt from Local Window)` 作为“从本地 clone 窗口发起”的入口。
  理由：两种入口的差异不在 notifier 路径，而在远端主扩展路径的来源；前者可直接复用当前远端 `${workspaceFolder}`，后者必须显式输入 `remoteWorkspacePath`，否则会把本机路径错误地当成远端 `folder-uri`。
  日期/作者：2026-05-04 / Codex

## 结果与复盘

当前已经从“纯设计阶段”进入“阶段 1.1 的代码、文档与联调链路均已落地”的状态。已确认的产出是：

- 一份明确说明标准 monorepo 目标结构的 `ExecPlan`
- 一套“根目录单一正式文档集 + 子包最小局部文档”的文档治理口径
- 一条对文档知识库体系图的明确放置规则：未来正式入口是 `docs/README.md`，图像资产放在 `docs/diagrams/`
- 一个已落在最终位置的 notifier companion：`extensions/vscode/dev-session-canvas-notifier/`
- 一个最小共享 attention 协议包：`packages/attention-protocol/`
- 一条已打通的主扩展 -> companion -> focus callback 验证链路：`npm run test:notifier-smoke`
- 一套固定的真实桌面通知人工验收入口：companion 测试通知命令、诊断输出与 `activationMode` 结果结构
- 一组可直接切换环境继续使用的调试入口：`Run Dev Session Canvas + Notifier (Local Window)`、`Run Notifier Only (Local Window)`、`Run Remote Main + Local Notifier (Prompt)`、`Run Remote Main + Local Notifier (Prompt from Local Window)`

本轮尚未完成的事情：

- 没有移动任何源码目录
- 主扩展仍未迁移到 `extensions/vscode/dev-session-canvas/`
- 没有实际创建 `docs/README.md` 或 `docs/diagrams/`
- 真实桌面通知的跨平台人工验收已经完成；剩余未决事项不再是 notifier 可用性，而是是否继续投入阶段 1.2 结构重构

因此，本计划不再是“完全待执行”的空方案，而是“阶段 1.1 已具备可提交结果、阶段 1.2 仍待决策”的活文档。

## 上下文与定向

当前仓库是一个单扩展仓库。仓库根目录同时包含：

```text
package.json           当前公开扩展 manifest 与仓库脚本入口
src/                   当前主扩展源码
images/                当前主扩展图标与 README 资产
tests/                 测试与 smoke 验证
scripts/               构建、打包、验证脚本
docs/                  正式文档知识库
ARCHITECTURE.md        架构总览
README.md              项目对外入口
```

这里有几个容易混淆的词需要先解释清楚：

- “workspace root”：是 monorepo 的仓库根目录。它负责统一脚本、统一文档与多包编排，但不再直接作为某个扩展的源码根目录。
- “extension package”：一个可以单独构建和发布成 VSIX 的 VS Code 扩展目录，它必须有自己的 `package.json`、入口文件、图标、README 和测试边界。
- “companion extension”：与主扩展协作的辅助扩展。当前语境里是未来运行在 `ui` / `local` 侧、负责系统通知的 notifier。
- “知识库入口页”：不是某个具体设计结论文档，而是帮助协作者定位文档的导航页。它的职责是解释“应该去哪一类文档找答案”，不是替代那些正式结论文档。

本计划要解决的不是“如何立刻实现系统通知”，而是两个更基础的问题：

1. 当仓库同时管理主扩展、notifier 和共享协议时，代码目录怎么摆才算标准 monorepo。
2. 当仓库进入多包结构后，正式文档怎样保持单一入口，不因为多包而复制成多套知识库。

## 工作计划

> **⚠️ 已调整 (2026-05-03)**：分为两个阶段，先验证 notifier，再做 monorepo 重构。

### 阶段 1.1：Notifier companion 落地与环境切换前收口（已完成主体实现）

**目标**：在不迁移主扩展目录的前提下，先把 notifier companion、共享协议、主扩展接线、调试入口和正式文档收口到“可提交、可换环境继续调试”的状态。

**里程碑 1.1.1：技术验证**
- 在 `extensions/vscode/dev-session-canvas-notifier/` 落地 UI-side companion
- 在 `packages/attention-protocol/` 落地共享请求 / 结果协议
- 让主扩展优先调用 companion，并在 companion 缺失或失败时保留原工作台通知回退
- 用 `npm run test:notifier-smoke` 验证“发送通知 -> 回放点击 -> 聚焦节点并清除 attention”整条链路

**里程碑 1.1.2：用户验证**
- 增加“发送测试桌面通知 / 打开通知诊断输出”两个固定人工验收入口
- 补齐本地窗口、notifier-only 与“远端主扩展 + 本机 notifier”三类调试配置
- 明确记录平台差异：真实桌面通知可以退化，但必须通过 `activationMode` 与诊断输出显式暴露
- 真实桌面通知人工验收现已完成；阶段 1.1 后续只剩“是否进入阶段 1.2 结构重构”的决策

**决策点**：notifier 是否有价值？是否继续投入阶段 1.2？

---

### 阶段 1.2：Monorepo 重构（2-3 周，需阶段 1.1 验证通过）

**前置条件**：✅ 阶段 1.1 验证通过，决定继续投入

这项工作分成四个里程碑推进。

**里程碑 1.2.1：结构定稿**
先把最终目录树、包职责、根工作区脚本边界与文档口径写清楚，避免一边搬家一边改目标。这个阶段要明确：根目录是否变成 `private` workspace；当前主扩展迁入哪个路径；notifier companion 的初始包名和运行位置是什么；哪些共享代码真的值得抽成 `packages/attention-protocol/`，哪些暂时继续留在主扩展中。

**里程碑 1.2.2：仓库根目录与主扩展迁移**
把当前根目录下的扩展内容迁入 `extensions/vscode/dev-session-canvas/`，让根目录 `package.json` 只保留 workspace 编排与统一脚本。这个阶段完成后，协作者应该能在根目录执行一次统一安装，并通过根脚本编排主扩展构建与测试。

**里程碑 1.2.3：Companion 与共享协议落位**
将 `notifier/` 迁移到 `extensions/vscode/dev-session-canvas-notifier/`，新增 `packages/attention-protocol/` 共享包。本阶段要求 notifier 功能完整，monorepo 拓扑成立、跨包引用可工作、目录职责清楚。

**里程碑 1.2.4：文档知识库收口**
新增 `docs/README.md` 作为文档入口页，在其中放置”文档知识库体系图”；同时在 `ARCHITECTURE.md` 中放置”代码包拓扑图”。各扩展目录补自己的 README / CHANGELOG，并明确写出”正式设计与产品结论仍回到根目录 docs/”。这一阶段完成后，仓库应该同时具备”代码知道去哪找”和”文档知道去哪找”的双重导航能力。

## 目标结构

> **⚠️ 已更新 (2026-05-03)**：目录结构已调整以支持 VSCode 和 IntelliJ 两个平台。详见 [跨计划协调文档](./cross-plan-coordination.md)。

本计划当前建议的标准 monorepo 目标结构如下：

```text
/
  package.json                    # private workspace root；统一脚本与多包编排
  package-lock.json
  tsconfig.base.json
  README.md                       # 仓库与产品入口（覆盖两个平台）
  ARCHITECTURE.md                 # 全局架构与代码包拓扑（覆盖两个平台）
  AGENTS.md                       # 全仓规则
  docs/                           # 唯一正式文档知识库
    README.md                     # 文档入口页；放文档知识库体系图（覆盖两个平台）
    diagrams/                     # 图源与导出图，例如 *.mmd / *.svg
    design-docs/
    exec-plans/
    product-specs/
    platforms/                    # 【新增】平台特定文档
      vscode.md
      intellij.md
      comparison.md
    references/
    workflows/
  scripts/                        # 根级编排脚本（协调 npm 和 Gradle）
  tests/                          # 跨包联调、集成与 smoke
  
  # VSCode 生态
  extensions/
    vscode/                       # 【调整】新增 vscode/ 层级
      dev-session-canvas/         # VSCode 主扩展
        package.json
        src/
        images/
        tests/
        README.md
        CHANGELOG.md
      dev-session-canvas-notifier/  # UI-side / local-side notifier companion
        package.json
        src/
        tests/
        README.md
        CHANGELOG.md
  
  # IntelliJ 生态
  extensions/
    intellij/                     # 【新增】IntelliJ 平台
      dev-session-canvas/         # IntelliJ 插件
        build.gradle.kts
        settings.gradle.kts
        src/main/
          kotlin/
          resources/
            META-INF/plugin.xml
        README.md
        CHANGELOG.md
  
  # 共享代码
  packages/
    protocol/                     # 【新增】跨平台协议定义
      schema/                     # JSON Schema（单一真相来源）
        protocol.json
      typescript/                 # TypeScript 版本（VSCode 用）
        protocol.ts
      kotlin/                     # Kotlin 版本（IntelliJ 用）
        Protocol.kt
      package.json
      build.gradle.kts
      README.md
    webview/                      # 【新增】跨平台 Webview 前端
      src/                        # React 源码
        canvas/
        nodes/
        terminal/
      dist/
        vscode/                   # VSCode 构建产物
        intellij/                 # IntelliJ 构建产物
      package.json
      README.md
    attention-protocol/           # VSCode 特定的注意力协议
      package.json
      src/
      README.md
```

这棵目录树里最重要的约束是：

- 根目录 `docs/` 继续是正式知识库唯一入口。
- `extensions/*/README.md` 只解释该扩展自己的安装、使用、发布与局部开发，不重新定义产品、架构和设计结论。
- `packages/*/README.md` 只解释这个共享包导出了什么、被谁依赖，不承担项目级文档职责。

## 文档知识库与体系图放置规则

未来落地时，文档体系建议明确分成三层：

第一层是仓库入口：

- `README.md`
  - 面向项目外部读者和源码开发者
  - 解释产品是什么、仓库大体有什么、如何开始开发

第二层是正式知识库入口：

- `docs/README.md`
  - 面向已经进入仓库、需要找正式结论的协作者
  - 解释“应该去哪里找哪类文档”
  - 放文档知识库体系图

第三层是具体结论文档：

- `ARCHITECTURE.md`
- `docs/WORKFLOW.md`
- `docs/DESIGN.md`
- `docs/product-specs/index.md`
- `docs/design-docs/index.md`
- `docs/exec-plans/active/`
- `docs/exec-plans/completed/`

当前计划中的两张图建议这样放：

1. 仓库代码包拓扑图
   - 正文宿主：`ARCHITECTURE.md`
   - 图像资产：`docs/diagrams/monorepo-topology.svg`
   - 可选图源：`docs/diagrams/monorepo-topology.mmd`

2. 文档知识库体系图
   - 正文宿主：`docs/README.md`
   - 图像资产：`docs/diagrams/documentation-knowledge-base.svg`
   - 可选图源：`docs/diagrams/documentation-knowledge-base.mmd`

正式规则是：图像只做导航和理解增强，真正的规则、边界和结论必须继续写在 Markdown 正文里；任何图像都不能替代正式结论文档。

## 具体步骤

1. 在仓库根目录先补 monorepo 设计与文档入口设计，不移动代码：

       sed -n '1,260p' package.json
       sed -n '1,240p' ARCHITECTURE.md
       sed -n '1,240p' README.md
       find docs -maxdepth 2 -type d | sort

2. 新建根工作区骨架并保留当前根目录可回退：

       mkdir -p extensions/dev-session-canvas
       mkdir -p extensions/dev-session-canvas-notifier/src
       mkdir -p packages/attention-protocol/src

3. 迁移当前主扩展并重接根脚本：

       mv src images extensions/dev-session-canvas/
       mv tests extensions/dev-session-canvas/
       mv package.nls.json extensions/dev-session-canvas/
       # 根 package.json 改成 private workspace root
       # 主扩展 package.json 改放到 extensions/dev-session-canvas/

4. 新增文档入口与图资产目录：

       mkdir -p docs/diagrams
       touch docs/README.md

5. 从根目录执行统一验证：

       npm install
       npm run build
       npm run typecheck
       npm run test
       npm run -w extensions/dev-session-canvas package:vsix
       npm run -w extensions/dev-session-canvas-notifier build

这些命令只是目标落地时的建议步骤；在真正实施前，应先根据根工作区脚本是否已存在做相应调整。

## 验证与验收

只有满足以下可观察结果，这项迁移才算完成：

第一，仓库根目录的 `package.json` 已经不再是主扩展 manifest，而是 `private` workspace root；主扩展 manifest 明确位于 `extensions/dev-session-canvas/package.json`。

第二，根目录执行一次统一安装和构建后，至少能成功编排主扩展与 notifier companion 的最小构建链路；如果 notifier 还未实现功能，也至少应能成功完成空壳构建。

第三，正式文档仍集中在根目录，且已经存在 `docs/README.md` 作为知识库入口页；它能清楚链接到 `ARCHITECTURE.md`、`docs/WORKFLOW.md`、`docs/DESIGN.md`、产品规格索引、设计索引与 ExecPlan 目录。

第四，仓库代码包拓扑图已嵌入 `ARCHITECTURE.md`，文档知识库体系图已嵌入 `docs/README.md`；两张图都对应 `docs/diagrams/` 中的受版本控制资产。

第五，各扩展目录的 README 已明确声明“正式设计与产品结论在根目录 docs/”，从而避免子扩展 README 与正式知识库冲突。

第六，跨包结构迁移后，现有核心命令至少有一轮自动化验证通过，证明主扩展 smoke/test 入口仍可从根目录调用。

## 幂等性与恢复

这项迁移必须按“先增加、再搬迁、最后清理”的方式执行，避免一次性大挪动让工作树难以回退。

推荐的幂等策略是：

- 先创建 `extensions/`、`packages/`、`docs/README.md`、`docs/diagrams/` 等新骨架，再移动现有文件。
- 在主扩展能从新目录构建成功前，不删除根目录脚本的旧兼容入口。
- 根目录编排脚本优先写成“可重复执行”的同步脚本，不依赖一次性手工状态。
- 图像资源先提交可读版本，再逐步补图源导出链路；如果图源工具未定，不阻塞文档入口页先落地。

如果中途迁移失败，恢复路径应尽量局部：

- 代码目录迁移失败时，优先把根工作区脚本恢复成单扩展入口，再逐个包补迁移。
- notifier companion 若未准备好，不应阻塞主扩展先完成 monorepo 化；最坏情况可以先保留空壳 companion 包和空 README。
- 知识库体系图若暂时无法导出最终 SVG，可先在 `docs/README.md` 用缩进文本图或 Mermaid 源图占位，但必须保留正文解释，不能只留图片链接。

## 证据与备注

当前已确认的本地证据：

    根目录 package.json 当前同时承担扩展 manifest 与仓库脚本入口。
    根目录 docs/ 下已经有 design-docs / exec-plans / product-specs / workflows，
    但缺少 docs/README.md 这一类文档总入口。
    根目录 README.md 当前已经承载产品入口，不适合继续膨胀为完整知识库目录。

这意味着：monorepo 迁移不只是“多建几个目录”，还必须同时补上“仓库入口”和“正式知识库入口”的分工。

## 接口与依赖

本计划将触达以下关键接口与文件：

- 根工作区编排
  - `/package.json`
  - `/package-lock.json`
  - `/tsconfig.base.json`（若新增）
  - `/scripts/`

- 主扩展包
  - `extensions/dev-session-canvas/package.json`
  - `extensions/dev-session-canvas/src/`
  - `extensions/dev-session-canvas/images/`
  - `extensions/dev-session-canvas/tests/`

- notifier companion 包
  - `extensions/dev-session-canvas-notifier/package.json`
  - `extensions/dev-session-canvas-notifier/src/`

- 共享协议包
  - `packages/attention-protocol/package.json`
  - `packages/attention-protocol/src/`

- 正式文档入口与图资产
  - `README.md`
  - `ARCHITECTURE.md`
  - `docs/README.md`
  - `docs/diagrams/`

后续若引入 `extension pack`，它将作为额外扩展包落在 `extensions/dev-session-canvas-pack/`；但这不是本计划第一阶段的前置条件。

---

本次创建说明：2026-04-30 新增本计划，用于覆盖标准 monorepo 目标结构、主扩展与 notifier companion 的代码落位，以及“正式文档单一知识库 + docs/README 知识图谱入口 + docs/diagrams 图资产目录”的文档治理方案。之所以先写计划，是因为这项工作同时影响目录结构、构建脚本、测试入口、README 体系和正式文档导航，必须先把边界讲清楚再动手迁移。

本次更新说明：2026-05-03 按当前 notifier 实现状态收口计划，补记“阶段 1.1 主体已完成、真实桌面通知人工验收仍需切换本机环境继续”的边界，并把阶段 1.1 的工作描述改成与当前仓库实际目录和调试入口一致。

本次更新说明：2026-05-04 进一步同步用户在 macOS、Windows、Linux 本机环境以及 `Remote Main + Local Notifier` 联调拓扑上的通过结果，关闭阶段 1.1 的真实桌面通知人工验收尾项，并把 notifier 可用性的剩余问题收口为“是否启动阶段 1.2 重构”的后续决策。
