# Panel 标签切换下的终端状态恢复与保活

本 `ExecPlan` 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘` 这几个章节。

本文位于 `docs/exec-plans/active/runtime-terminal-state-restore.md`，必须按 `docs/PLANS.md` 的要求持续维护。

## 目标与全局图景

这次变更要解决用户在同一个 Panel 区域内，从 `Dev Session Canvas` 标签切到 `Terminal` 标签，再切回画布时，`Agent` / `Terminal` 节点上半部分变空白的问题。完成后，用户在 Panel 标签间切换时，画布中的 `Codex`、`Claude Code` 和普通终端节点都不应因为 Webview 隐藏/恢复而失去可见内容；即使 Webview 被销毁并重建，节点也应基于宿主权威的终端状态恢复出正确画面，而不是只重放尾部日志。

用户可见的验收标准分两层。第一层是同一 VS Code 会话内的标签切换：切走再切回后，原来的终端画面仍在，输入和滚动继续可用。第二层是 Webview 被重建后的恢复：宿主重新发起 bootstrap 和 execution snapshot 后，重建出来的 xterm 仍能恢复当前可见屏幕，而不是只剩底部几行或整块空白。

## 进度

- [x] (2026-04-15 00:31 +0800) 读取 `docs/WORKFLOW.md`、`docs/DESIGN.md`、现有运行时与终端设计文档，确认这是交付性改动且需要独立 `ExecPlan`。
- [x] (2026-04-15 00:33 +0800) 检查当前工作树与分支状态，确认仓库原本停留在 `main`，并已在不覆盖现有未提交改动的前提下切出主题分支 `runtime-terminal-state-restore`。
- [x] (2026-04-15 00:35 +0800) 用真实 `dist/webview.js` + headless Playwright 复现“完整重放可见、tail 重放变空白”，确认现有 `reset() + tail replay` 本身足以制造该问题。
- [x] (2026-04-15 11:09 +0800) 为本轮实现更新正式设计文档与索引，明确 `retainContextWhenHidden` 在 Panel `WebviewView` 路径的角色，以及宿主权威 terminal state 的正式恢复语义。
- [x] (2026-04-15 01:38 +0800) 在扩展注册层为 Panel `WebviewView` 打开 `retainContextWhenHidden`，并补宿主到 Webview 的 visibility 恢复消息，让重新可见时的 xterm 明确执行 `fit + refresh`。
- [x] (2026-04-15 02:04 +0800) 在宿主本地会话与 runtime supervisor 会话中引入可序列化的 terminal state，替换当前只保留 `6000` 字符 raw tail 的恢复语义。
- [x] (2026-04-15 10:48 +0800) 修改 Webview 执行节点恢复逻辑，使其优先从宿主权威 terminal state 恢复，再接续 live output；保留 `recentOutput` 仅作摘要，不再承担画面恢复职责。
- [x] (2026-04-15 10:56 +0800) 补 Playwright harness 与 VS Code smoke 回归，覆盖 Panel 标签切换恢复与 Webview 重建后终端画面仍可见的断言。
- [x] (2026-04-15 11:03 +0800) 运行 `npm run typecheck`、`npm run test:webview` 和针对本问题的 smoke / 额外验证，记录结果。
- [x] (2026-04-15 11:09 +0800) 完成后把仍未收口的风险登记到 `docs/exec-plans/tech-debt-tracker.md`。

## 意外与发现

- 观察：当前工作树已有未提交改动，且正好触达 `src/panel/CanvasPanelManager.ts` 与 `tests/vscode-smoke/extension-tests.cjs`。
  证据：`git status --short` 显示这两个文件已修改；`git diff` 显示它们在做终端输出节流与 “terminal flood 不阻塞 Webview” 的回归，不直接解决本问题。

- 观察：Panel 标签切换问题不需要切换 panel/editor surface，也不需要真实 Codex/Claude 可执行文件；当前仓库的 `reset() + tail replay` 恢复链路本身就能制造空白终端。
  证据：2026-04-15 00:35 +0800 的 headless Playwright 实验中，同一段 ANSI 全屏输出完整重放时可选中 `VISIBLE-LINE-17 7777`，裁成最后 `6000` 字符再重放时选择结果为空字符串。

- 观察：当前 `WebviewView.onDidChangeVisibility` 只记录诊断事件，没有任何“重新显示后 refresh xterm”的显式恢复动作。
  证据：`src/panel/CanvasPanelManager.ts` 仅在 `onDidChangeVisibility` 中调用 `recordDiagnosticEvent('surface/visibilityChanged', ...)` 和 `notifySidebarStateChanged()`。

- 观察：serialized terminal snapshot 在 hydrate 后如果立刻按更小容器尺寸执行 destructive `fit()`，xterm alternate buffer 会裁掉顶部行，看起来像“恢复错位”而不是“恢复失败”。
  证据：2026-04-15 10:35 +0800 的 headless xterm 实验显示，同一份 28 行 alternate-buffer serialized state 写回 22 行终端时，顶行直接从 `SERIALIZED-ROW-01` 变成 `SERIALIZED-ROW-07`；Playwright 回归也先后复现了 agent/terminal 两条同类失败。

- 观察：当前环境下的 Playwright Chromium 无法在 Codex 默认沙箱里稳定启动，但在沙箱外重跑同一套件后通过。
  证据：`npm run test:webview` 在沙箱内以 `sandbox_host_linux.cc:41` 崩溃；2026-04-15 11:03 +0800 使用沙箱外同一命令重跑后，28 条用例全部通过。

## 决策记录

- 决策：本轮同时实现两条修复线，而不是只做 `retainContextWhenHidden` 止血。
  理由：用户已明确要求“完整实现第 1 步和第 2 步”，且更看重 Panel 标签切换手感；只做保活无法给 Webview 被销毁重建的路径提供正式恢复语义。
  日期/作者：2026-04-15 / Codex

- 决策：保留 `retainContextWhenHidden`，把它视为 Panel 标签切换体验优化，而不是唯一正确性前提。
  理由：用户偏好“标签切换手感”；即使第 2 步落地后，保活仍能减少 Webview 重建、降低重新 attach 与 repaint 抖动。
  日期/作者：2026-04-15 / Codex

- 决策：正式恢复语义不再依赖 raw tail，而是由宿主维护可序列化的 terminal state，并让 Webview 从该状态 hydrate xterm。
  理由：Codex、Claude Code 与普通全屏/重绘型 TUI 的当前屏幕是终端状态，不是最后几千字符日志；只有宿主权威 terminal state 才能把“同屏可见内容”恢复成确定行为。
  日期/作者：2026-04-15 / Codex

- 决策：Webview 在 snapshot hydrate 路径上不再立刻执行 destructive `fit()` 或向宿主回写新的 resize；这一步优先保住宿主记录的终端画面。
  理由：xterm alternate buffer 在尺寸缩小时会直接裁掉顶部行，导致 serialized snapshot 即使内容恢复成功也会出现错位；保活路径的 `fit + refresh` 继续由 visibility restore 负责。
  日期/作者：2026-04-15 / Codex

## 结果与复盘

本轮已经交付两条互补修复线：

- Panel `WebviewView` 注册层启用了 `retainContextWhenHidden`，同一 Panel 标签切换不再默认依赖 Webview 销毁重建；Webview 从隐藏恢复到可见时，宿主会额外发送 `visibilityRestored`，前端对现存 xterm 执行 `fit + refresh`。
- local PTY 与 runtime supervisor 会话都改为维护 serialized terminal state，并通过宿主 snapshot 发到 Webview；前端恢复执行节点时优先 hydrate 该状态，而不是 `reset() + tail replay`。

验证结果如下：

- `npm run typecheck` 通过。
- `DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=real-reopen node scripts/run-vscode-smoke.mjs` 通过，说明真实 VS Code 窗口重开下的重新附着 / 历史恢复链路已闭合，且不再出现 `allowProposedApi` 运行时错误。
- `npm run test:webview` 在沙箱外通过 28 条回归；新增的两条 Playwright 用例明确覆盖“Webview 重建后 serialized terminal state 恢复优先于 raw tail replay”。

本轮留下的一项技术债已登记到 `docs/exec-plans/tech-debt-tracker.md`：当 snapshot 记录尺寸与当前容器尺寸漂移时，xterm alternate-buffer hydrate 仍缺更强的无损重绘语义。当前实现优先保证“不要恢复成空白或错画面”，而不是承诺任意尺寸漂移下都能完全无损复原。

## 上下文与定向

这次改动涉及四个区域。

第一类是扩展注册与 Webview 生命周期。`src/extension.ts` 负责注册 Panel `WebviewViewProvider`；`src/panel/CanvasPanelManager.ts` 负责 editor/panel 两类 surface 的 reveal、attach、visibility 事件和宿主消息。当前 Panel 路径使用 `registerWebviewViewProvider(...)`，但没有传 `webviewOptions.retainContextWhenHidden`。这意味着在同一 Panel 中切到 `Terminal` 标签时，`Dev Session Canvas` 对应的 `WebviewView` 可能被 VS Code 回收并在切回时重建。

第二类是终端运行时与恢复边界。`src/panel/CanvasPanelManager.ts` 当前为本地 PTY 会话维护 `ManagedExecutionSession.buffer`，并把 `buffer` 裁到最后 `6000` 字符；`src/supervisor/runtimeSupervisorMain.ts` 对 supervisor 持有的 live runtime 也同样只保留最后 `6000` 字符输出。`postExecutionSnapshot()` 再把这段字符串发给 Webview。这里的“snapshot”实际上是 raw output tail，不是终端帧缓冲状态。

第三类是 Webview 中的 xterm 节点。`src/webview/main.tsx` 为 `AgentSessionNode` 和 `TerminalSessionNode` 创建 `Terminal` 实例，并在收到 `host/executionSnapshot` 时执行 `terminal.reset(); terminal.write(detail.output);`。这套逻辑默认假设 `detail.output` 足以重建终端画面，但对 alternate screen、cursor addressing 和整屏重绘型 CLI 并不成立。

第四类是自动化验证。`tests/playwright/webview-harness.spec.mjs` 当前已能直接加载真实 `dist/webview.js` 并向 Webview 注入 `host/executionSnapshot`；`tests/vscode-smoke/extension-tests.cjs` 当前只断言 `host/executionSnapshot` 是否发出，以及 `recentOutput` / `liveSession` 等宿主元数据，尚未断言“重建后的 xterm 屏幕真实可见”。

本文里“terminal state”指可以重建当前终端可见内容的权威状态，不等于 `recentOutput` 摘要，也不等于最后一段 ANSI 文本 tail。“Panel 标签切换”特指同一个工作台 Panel 中，在 `Terminal` 标签和 `Dev Session Canvas` 标签之间来回切换，而不是 panel/editor surface 切换。

## 工作计划

先补正式文档。`docs/design-docs/embedded-terminal-runtime-window.md` 需要把“活跃会话原始 buffer 当前只保留在宿主内存里”升级成新的正式结论：Panel 标签切换路径保留 `retainContextWhenHidden` 以保证体验；当 Webview 被销毁重建时，宿主应维护可序列化的 terminal state 作为恢复源。`docs/design-docs/runtime-persistence-and-session-supervisor.md` 需要同步记录 supervisor 路径不再只保留 raw tail，而要维持可恢复的 terminal state。`docs/design-docs/index.md` 也要同步更新时间和关联计划。

然后改注册与可见性恢复。`src/extension.ts` 要在 `registerWebviewViewProvider()` 上声明 `webviewOptions.retainContextWhenHidden = true`。`CanvasPanelManager` 需要在 Panel `visible=true` 时向 Webview 发一个显式消息，告诉前端“当前 Webview 从隐藏恢复到可见”；Webview 收到后应对现存 xterm 执行 `fitAddon.fit()` 与 `terminal.refresh(...)`，避免只靠 `ResizeObserver` 等待容器尺寸变化。

接着改宿主权威 terminal state。为避免把这次实现绑定在 Webview 内部状态上，terminal state 要由宿主持有，并同时覆盖 local PTY 与 runtime supervisor 两条链路。最直接的路线是在宿主引入 `@xterm/headless` 和 `@xterm/addon-serialize`，每个执行会话都维护一个 headless xterm；所有 PTY 输出除了继续流向 live Webview，也同步写入 headless xterm。需要持久化或发 snapshot 时，不再发 raw tail，而是发由宿主生成的可恢复 terminal state。对 supervisor 路径，同样要在 `src/supervisor/runtimeSupervisorMain.ts` 中维护并持久化这一状态，而不是只存 `output` 字符串。

随后调整 Webview 恢复协议。`src/common/protocol.ts` 和相关 host/webview 消息要扩展 execution snapshot 的 payload，使之能承载 terminal state。`src/webview/main.tsx` 恢复时应优先使用 terminal state hydrate；只有在旧数据或兼容路径下才 fallback 到 raw output。为了让新旧状态都可共存，协议层需要保留向后兼容策略，直到所有写入路径都稳定切到新的 terminal state。

最后补测试。Playwright harness 要加一条明确回归：给节点注入一段全屏/重绘型 ANSI 输出，模拟 Webview 重建后再次 bootstrap/snapshot，断言恢复后的 xterm 仍可选择出原可见行。VS Code smoke 要补一条 Panel 标签切换场景，至少证明“切到 Terminal 标签再切回 Dev Session Canvas 后，执行节点仍能保持可见内容与 live input”；若 smoke 层直接操作原生 Panel 标签成本过高，则要用最接近真实生命周期的宿主/visibility 测试命令补足这条证据。

## 具体步骤

1. 更新文档：
   在仓库根目录修改 `docs/design-docs/embedded-terminal-runtime-window.md`、`docs/design-docs/runtime-persistence-and-session-supervisor.md`、`docs/design-docs/index.md`，并把本计划加入相关文档 frontmatter 的 `related_plans`。

2. 更新扩展注册与宿主消息：
   在 `src/extension.ts` 为 `registerWebviewViewProvider()` 加 `webviewOptions.retainContextWhenHidden`。
   在 `src/common/protocol.ts` 定义新的宿主可见性恢复消息与 terminal state snapshot 结构。
   在 `src/panel/CanvasPanelManager.ts` 发出 panel visibility restore 消息，并调整 execution snapshot 结构。

3. 更新 terminal state 存储：
   视实现需要修改 `package.json` / `package-lock.json` 引入 xterm 相关依赖。
   修改 `src/panel/CanvasPanelManager.ts`、`src/supervisor/runtimeSupervisorMain.ts` 及必要的共享模块，让 local / supervisor 两条 PTY 路径都生成并保存 terminal state。

4. 更新 Webview 恢复逻辑：
   修改 `src/webview/main.tsx`，让现存 xterm 在 `host/visibilityRestored` 后执行 `fit + refresh`，并在 `host/executionSnapshot` 时优先按 terminal state 恢复。

5. 更新自动化：
   修改 `tests/playwright/webview-harness.spec.mjs` 与 `tests/vscode-smoke/extension-tests.cjs`。

6. 运行验证：
   在仓库根目录执行：

       npm run typecheck
       npm run test:webview
       npm run test:smoke -- --grep <若需要限制场景则记录具体命令>

   如果完整 `test:smoke` 代价过高，至少保留与 Panel 标签切换、Webview 恢复和执行节点相关的命令与结果。

## 验证与验收

需要同时验证两类场景。

第一类是体验层。手动或 smoke 驱动在同一个 Panel 区域中打开 `Dev Session Canvas`，启动至少一个 `Agent` 节点和一个 `Terminal` 节点，切到 `Terminal` 标签再切回 `Dev Session Canvas`。预期节点内终端画面不再变成“上半部分空白、底部只剩尾巴”，输入仍然进入原 live session。

第二类是恢复层。通过 Playwright harness 向 `host/executionSnapshot` 注入一段全屏/重绘型 ANSI 输出，并模拟一次 Webview 重建或重新 bootstrap。预期恢复后的 xterm 仍能通过 probe/selection 读到原可见行；同一断言在旧的 `tail replay` 路径下应失败，在新实现下通过。

自动化验收最低要求：

- `npm run typecheck` 通过。
- `npm run test:webview` 通过，并新增至少一条会在旧实现下失败的新回归。
- 至少一条真实 VS Code smoke 或等价宿主级验证覆盖 Panel 可见性恢复，证明不是只有浏览器 harness 通过。

## 幂等性与恢复

本计划中的代码与文档改动可重复执行。若修改依赖后需要重跑 `npm install`，应在仓库根目录执行，并让 `package-lock.json` 与 `package.json` 保持一致。若部分测试只在新依赖安装后可运行，应在结果中明确写明前提。

由于当前工作树已有他人未提交改动，实施时不得回退现有差异；如果后续发现这些差异与本计划发生真实冲突，应先记录冲突点，再决定如何合并，而不是直接覆盖。

## 证据与备注

本计划启动前已经有一条关键复现证据，后续实现需要继续保留：

    2026-04-15 00:35 +0800 headless Playwright 实验：
    - 完整 ANSI 全屏输出长度：16089
    - 裁成最后 6000 字符后重放：tailLength = 6000
    - 完整重放选择结果：VISIBLE-LINE-17 7777
    - tail 重放选择结果：空字符串

这条证据说明“只重放 tail 会丢失可见终端状态”在当前仓库中可独立复现，不依赖真实 Codex / Claude 可执行文件。

## 接口与依赖

本轮预计至少会触达以下接口与依赖：

- `src/extension.ts`
  - `vscode.window.registerWebviewViewProvider(CanvasPanelManager.panelViewType, panelManager, { webviewOptions: { retainContextWhenHidden: true } })`

- `src/common/protocol.ts`
  - 为 execution snapshot 定义可承载 terminal state 的新 payload。
  - 为宿主到 Webview 的“可见性恢复”消息定义新类型。

- `src/panel/CanvasPanelManager.ts`
  - 扩展 `ManagedExecutionSession`，让会话保存可恢复 terminal state，而不只是 `buffer`。
  - 在 Panel visibility 恢复时向 Webview 发消息。
  - 在 `postExecutionSnapshot()` 中优先发送 terminal state。

- `src/supervisor/runtimeSupervisorMain.ts`
  - supervisor 会话状态需要持久化 terminal state。
  - registry snapshot 需要包含足够恢复画面的数据，而不只是 raw tail。

- `src/webview/main.tsx`
  - 现存终端实例接收 visibility restore 消息后执行 `fit + refresh`。
  - execution snapshot 恢复逻辑优先从 terminal state hydrate。

- 依赖
  - 预计新增 `@xterm/headless`
  - 预计新增 `@xterm/addon-serialize`

如果依赖接入后发现无法稳定承载当前恢复语义，必须在 `意外与发现` 中记录，并在 `决策记录` 中明确是否改回“更有限但可验证”的方案，而不能默默退回到 raw tail replay。

---

本次创建说明：2026-04-15 新增本计划，用于覆盖 Panel 标签切换下的终端空白恢复问题；之所以单独起计划，是因为本轮同时触达 `WebviewView` 生命周期、宿主/监督器状态持久化、协议扩展与自动化验证，属于显著跨模块改动。
