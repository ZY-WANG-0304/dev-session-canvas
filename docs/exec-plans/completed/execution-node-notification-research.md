# 执行节点通知与注意力信号研究

本 `ExecPlan` 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘` 这几个章节。

本计划位于仓库根目录下的 `docs/PLANS.md` 约束体系内，后续任何继续推进该主题的协作者都必须按 `docs/PLANS.md` 的要求持续维护本文件。

## 目标与全局图景

这项研究要回答三个直接影响执行节点体验的问题：

1. VSCode 扩展当前到底提供哪些正式通知 API，它们属于工作台内通知还是系统级通知。
2. Ghostty 等终端里，`Claude Code` 与 `Codex` 这类 Agent CLI 如何把“任务完成”“请求用户确认”之类事件转换成系统提醒。
3. 当前仓库里已经存在的 `OSC 9`、`OSC 777`、bell 启发式，应该被视为“通知发送链路”还是“生命周期推断线索”。

用户可见的结果应当是一份正式、可追踪的研究结论。后来者不需要重新翻 VSCode 文档、Ghostty 文档、`Claude Code` 文档和 `Codex` 源码，就能知道当前有哪些可用机制、哪些只是兼容性 best-effort，以及本仓库后续设计应如何分层。

## 进度

- [x] (2026-04-21 19:36 +0800) 阅读 `AGENTS.md`、`docs/WORKFLOW.md`、`docs/PLANS.md`、`docs/DESIGN.md` 与 `ARCHITECTURE.md`，确认这类多步设计研究需要先落 `ExecPlan`，再写正式设计文档。
- [x] (2026-04-21 19:42 +0800) 盘点 `docs/design-docs/`、`docs/exec-plans/` 与现有设计索引，确认仓库内尚无专门覆盖“执行节点通知与注意力信号”的正式设计文档。
- [x] (2026-04-21 19:55 +0800) 检查仓库现状，确认当前工作树已在主题分支且无本地未提交改动，可安全新增研究文档。
- [x] (2026-04-21 20:03 +0800) 复核本地代码锚点，确认当前仓库对 VSCode 通知 API 的使用主要集中在 `src/extension.ts` 与 `src/panel/CanvasPanelManager.ts`，并确认 `src/common/agentActivityHeuristics.ts` 已把 `OSC 9`、`OSC 777` 和 `BEL` 作为 Agent `waiting-input` 的启发式信号。
- [x] (2026-04-21 20:11 +0800) 查阅一手资料，覆盖 VSCode 官方 API 与 UX 指南、Ghostty/kitty/iTerm2 官方文档、Anthropic 官方 `Claude Code` 文档，以及 `openai/codex` 官方仓库当前源码与 `app-server` README。
- [x] (2026-04-21 20:19 +0800) 新增正式设计文档 `docs/design-docs/execution-node-notification-and-attention-signals.md`，写清问题、候选方案、当前判断、风险与验证方法。
- [x] (2026-04-21 20:19 +0800) 更新 `docs/design-docs/index.md`，登记该设计文档，状态保持为 `比较中 / 未验证`，避免把研究结果误写成已定实现方案。

## 意外与发现

- 观察：VSCode 扩展 API 当前公开的是工作台内通知与进度能力，而不是“跨平台原生系统通知”抽象。
  证据：官方文档公开的是 `window.showInformationMessage`、`showWarningMessage`、`showErrorMessage` 与 `window.withProgress`；本轮未找到等价的“系统通知”扩展 API。

- 观察：当前仓库已经把终端通知协议当成“生命周期推断线索”使用，但还没有把“注意力事件”与“通知 surface”做正式分层。
  证据：`src/common/agentActivityHeuristics.ts` 会把 `OSC 9`、`OSC 777` 与 `BEL` 解析成 `notificationCount` / `bellCount`，随后只用于 `running -> waiting-input` 的启发式回退。

- 观察：`Codex` 当前并不是“没有通知能力”，而是已经在 TUI 内建了消息分类、焦点条件和协议后端选择。
  证据：`openai/codex` 当前源码中，`Notification` 已覆盖 `AgentTurnComplete`、`ExecApprovalRequested`、`EditApprovalRequested`、`ElicitationRequested` 与 `PlanModePrompt`，并在 `OSC 9` 与 `BEL` 后端之间自动切换。

- 观察：Ghostty 当前公开文档已经把“命令完成通知”和“桌面通知 escape sequence”都定义成正式能力。
  证据：Ghostty 官方文档有 `notify-on-command-finish`、`desktop-notifications`、`bell-features` 和 VT 参考里的 `OSC 9` / `OSC 9 ; 4` 条目。

- 观察：`Claude Code` 的官方通知路径不是只靠终端 escape sequence；它明确区分了“终端 bell 通知”和“hooks 驱动的通知脚本”两类方案。
  证据：Anthropic 官方文档分别提供了 `Terminal Bell Notifications` 页面与 `hooks` 文档中的 `Notification` 事件。

## 决策记录

- 决策：本轮新增独立设计文档，而不是把内容分别塞进 `agent-running-state-detection` 或 `execution-node-terminal-native-interactions`。
  理由：这次调研同时覆盖 VSCode 工作台通知、系统级终端通知、结构化 attention event，以及当前仓库对通知信号的启发式使用；它已经超出单一“状态判定”或“终端原生交互”文档的边界。
  日期/作者：2026-04-21 / Codex

- 决策：正式设计文档状态先保持 `比较中`，验证状态保持 `未验证`。
  理由：本轮完成的是研究与设计收口，不是已人工验证过的实现方案；如果把它写成 `已选定`，会把“当前推荐分层”误写成“已落地且已验证的正式方案”。
  日期/作者：2026-04-21 / Codex

- 决策：把“VSCode 没有系统通知扩展 API”写成基于官方文档范围的实现判断，而不是伪装成官方明示限制。
  理由：当前能确认的是“官方公开 API 没有提供这类接口”；不能把“我没查到”写成“官方明确禁止”。
  日期/作者：2026-04-21 / Codex

## 结果与复盘

本轮研究完成了以下收口：

- 确认 VSCode 官方通知 API 的正式边界是工作台通知与通知型进度，而不是可移植的 OS 原生通知抽象。
- 确认终端侧系统提醒的主路径是终端自己解释 `BEL`、`OSC 9`、`OSC 777`、kitty `OSC 99` 之类协议，或由 `hooks` / 外部命令补通知。
- 确认 `Claude Code` 与 `Codex` 都已经存在“事件 -> 通知”的官方能力面，但两者实现路径不同：`Claude Code` 更强调 bell + hooks，`Codex` 当前 TUI 更强调内建事件分类 + `OSC 9` / `BEL` 后端。
- 新增正式设计文档与设计索引登记，使后续协作者可以直接基于 repo-local 文档继续推进实现或补验证。

本轮未做的事情：

- 没有修改任何运行时代码。
- 没有在真实 Ghostty / kitty / iTerm2 / tmux 组合上做人工协议验证。
- 没有把当前建议落成最终产品方案或用户设置项。

## 上下文与定向

本任务涉及的关键仓库文件如下：

- `src/extension.ts`：当前少量直接使用 `vscode.window.showWarningMessage` 与 `showInformationMessage` 的命令入口。
- `src/panel/CanvasPanelManager.ts`：当前宿主运行时里与 reload 提示、panel 打开提示等相关的 VSCode 通知调用点。
- `src/common/agentActivityHeuristics.ts`：当前把终端 attention signal 解析为 `waiting-input` 启发式的共享模块。
- `docs/design-docs/agent-running-state-detection.md`：当前已经明确“provider 原生结构化事件优先于 PTY 启发式”，本轮研究需要与它保持一致，而不是把通知协议反向提升成权威状态源。
- `docs/design-docs/execution-node-terminal-native-interactions.md`：当前已记录终端原生交互与 `OSC 8` 链接路线，本轮需要补上“通知与注意力信号”的另一个协议面。
- `docs/design-docs/index.md`：新增正式设计文档后必须同步更新的注册表。

这里的“注意力信号”是一个刻意与“通知 UI”区分开的词，指那些能够说明“需要用户注意”的底层事件或协议，例如：

- provider 结构化事件里的 turn 完成、审批请求、`request_user_input`
- 终端输出中的 `BEL`
- 终端输出中的 `OSC 9`、`OSC 777`
- 终端/CLI 的 hook 回调

这些信号未必都应该直接显示成用户通知；设计文档必须先把“事件语义”和“呈现 surface”拆开。

## 工作计划

第一步，核对仓库工作流与现有设计文档，确认本轮研究应该新增独立主题，而不是把结论零散补丁到现有文档里。

第二步，复核仓库当前代码里哪些地方已经在使用 VSCode 通知 API，哪些地方已经在消费终端通知协议，避免新文档脱离现状。

第三步，查阅 VSCode 官方 API 与 UX 指南，明确工作台通知的正式能力、最佳实践和不应做的事情。

第四步，查阅 Ghostty、kitty、iTerm2、`Claude Code` 与 `Codex` 的官方文档或源码，回答“终端侧系统通知到底怎么发”。

第五步，把结论写入正式设计文档，并同步设计索引。

## 具体步骤

在仓库根目录执行的本地检查：

    sed -n '1,220p' AGENTS.md
    sed -n '1,260p' docs/WORKFLOW.md
    sed -n '1,260p' docs/PLANS.md
    sed -n '1,260p' docs/DESIGN.md
    sed -n '1,240p' docs/design-docs/index.md
    rg -n "通知|notification|showInformationMessage|showWarningMessage|showErrorMessage|OSC 9|OSC 777|waiting-input" src docs tests
    sed -n '1,320p' src/common/agentActivityHeuristics.ts
    sed -n '70,110p' src/extension.ts
    sed -n '1700,1735p' src/panel/CanvasPanelManager.ts

本轮使用的一手外部资料入口：

    https://code.visualstudio.com/api/references/vscode-api
    https://code.visualstudio.com/api/extension-capabilities/common-capabilities
    https://code.visualstudio.com/api/ux-guidelines/notifications
    https://code.visualstudio.com/docs/terminal/appearance
    https://code.visualstudio.com/docs/terminal/shell-integration
    https://ghostty.org/docs/config/reference
    https://ghostty.org/docs/vt/reference
    https://ghostty.org/docs/vt/control/bel
    https://ghostty.org/docs/install/release-notes/1-3-0
    https://sw.kovidgoyal.net/kitty/desktop-notifications/
    https://iterm2.com/3.3/documentation-escape-codes.html
    https://code.claude.com/docs/en/terminal-config
    https://docs.anthropic.com/en/docs/claude-code/hooks
    https://raw.githubusercontent.com/openai/codex/main/codex-rs/app-server/README.md
    https://raw.githubusercontent.com/openai/codex/main/codex-rs/tui/src/chatwidget.rs
    https://raw.githubusercontent.com/openai/codex/main/codex-rs/tui/src/tui.rs
    https://raw.githubusercontent.com/openai/codex/main/codex-rs/tui/src/notifications/mod.rs
    https://raw.githubusercontent.com/openai/codex/main/codex-rs/tui/src/notifications/osc9.rs
    https://raw.githubusercontent.com/openai/codex/main/codex-rs/tui/src/notifications/bel.rs
    https://raw.githubusercontent.com/openai/codex/main/codex-rs/config/src/types.rs

## 验证与验收

本轮研究至少满足以下条件才算完成：

- 仓库中存在当前主题的 `ExecPlan`，并且研究收口后已移入 `docs/exec-plans/completed/` 以供后续追溯。
- `docs/design-docs/` 中新增一份正式设计文档，覆盖 VSCode 通知 API、工作台通知 vs 系统通知、Terminal 协议与当前仓库判断。
- `docs/design-docs/index.md` 已登记该设计文档，并与 frontmatter 状态一致。
- 文档明确区分“已确认事实”“当前判断”“仍未验证项”。
- 文档给出至少一套后续人工验证路径，而不是只停留在资料转述。

## 幂等性与恢复

本计划只涉及文档研究、只读代码检查与外部资料阅读；重复执行不会修改运行时代码或外部系统状态。

如果后续终端或 CLI 官方能力发生变化，不回滚本轮文档，而是在 `意外与发现`、正式设计文档的 `当前判断` 和设计索引中补充更新日期与新结论。

## 证据与备注

关键本地证据：

    src/common/agentActivityHeuristics.ts
    - parseAttentionSignals() 当前把 OSC 9、OSC 777 与 BEL 记作 notification/bell signal。
    - evaluateAgentWaitingInputTransition() 会在 prompt、notification/bell 或 hard fallback 命中后，把 Agent 回退到 waiting-input。

    src/extension.ts
    - resetCanvasState 使用 showWarningMessage(..., { modal: true }, ...)
    - ensureFilesFeatureEnabled 使用 showInformationMessage(...)

    src/panel/CanvasPanelManager.ts
    - 配置 reload 提示使用 showWarningMessage / showInformationMessage
    - panel 打开失败时使用 showInformationMessage 提示用户从 Panel 打开视图

这些证据足以说明：仓库已经同时接触“VSCode 工作台通知”和“终端 attention signal”两条路径，但还没有正式定义它们之间的边界。

## 接口与依赖

本研究涉及的外部接口有三类：

- VSCode 扩展 API：`showInformationMessage`、`showWarningMessage`、`showErrorMessage`、`withProgress` 以及相关 UX 指南。
- 终端通知协议：`BEL`、`OSC 9`、`OSC 777`、kitty `OSC 99` 等。
- provider/CLI 事件面：`Claude Code` hooks 与 `Codex app-server` / `Codex TUI` 的结构化通知事件。

本轮不直接调用这些接口，只把它们作为后续设计和实现阶段必须显式选型的依赖前提记录下来。

更新记录：2026-04-21 20:19 +0800，新建本计划并补齐 VSCode/Terminal 通知研究、正式设计文档与设计索引；2026-04-21 20:19 +0800 将计划移入 `docs/exec-plans/completed/`，因为本轮调研与文档收口已经完成。
