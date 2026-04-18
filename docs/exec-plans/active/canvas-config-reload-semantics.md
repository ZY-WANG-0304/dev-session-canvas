# 画布承载面与运行时持久化配置的 reload 语义收口

本 `ExecPlan` 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘` 这几个章节。

本文位于 `docs/exec-plans/active/canvas-config-reload-semantics.md`，必须按 `docs/PLANS.md` 的要求持续维护。

## 目标与全局图景

这次变更要把两个用户可见的配置收口到一致、可解释的行为。`devSessionCanvas.canvas.defaultSurface` 不再让用户猜“什么时候才会生效”，而是在 Settings UI 里明确写明“需要 Window Reload”，并在修改后给出标准的 reload 提示。`devSessionCanvas.runtimePersistence.enabled` 也改成同样的 reload 生效模型，避免同一张画布里旧节点按旧持久化模式运行、新节点按新模式运行的混乱状态；当用户切换该配置时，还要明确告知“下次 reload 会清空当前画布宿主状态”。

用户还能直接观察到一个额外结果：当默认承载面设为 `editor` 时，Panel 区域不再常驻一个无用的 `Dev Session Canvas` tab；如果调研表明 VS Code 原生支持按 `when` 条件隐藏这类 view，就按原生方式实现，否则保持现状。本计划的最终验收不仅要看代码行为，还要保留调研证据、设计文档同步和自动化验证。

## 进度

- [x] (2026-04-18 17:09 +0800) 读取 `tmp_task.md`、`docs/WORKFLOW.md`、`docs/PLANS.md`、`docs/DESIGN.md` 和相关设计文档，确认这是需要独立 `ExecPlan` 的交付性改动。
- [x] (2026-04-18 17:09 +0800) 检查当前分支与工作树状态，并在不覆盖现有未提交改动的前提下从 `main` 切出主题分支 `canvas-config-reload-semantics`。
- [x] (2026-04-18 17:34 +0800) 调研 VS Code 对“设置需 reload 生效”“按配置隐藏 view”“配置变更提醒”的公开能力与标准做法，并把结论写入 `docs/design-docs/canvas-surface-placement.md`、`docs/design-docs/runtime-persistence-and-session-supervisor.md` 与 `docs/design-docs/index.md`。
- [x] (2026-04-18 17:57 +0800) 修改配置声明、启动配置读取、context key 与配置变更提示逻辑，让 `defaultSurface` / `runtimePersistence.enabled` 统一为“reload 后生效”，并在 `defaultSurface=editor` 时按原生 `when` 隐藏 panel view tab。
- [x] (2026-04-18 18:02 +0800) 为 runtime persistence 切换补“下次 reload 清空宿主状态”的持久化边界：把已应用模式写入快照与 workspaceState，在下次加载发现模式不一致时直接清空画布宿主状态；`tmp_task.md` 因属于用户本地未提交文件，本轮按约束未改动。
- [x] (2026-04-18 18:13 +0800) 补充并运行自动化验证，确认 surface / persistence 在 reload 前后行为正确，panel tab 按配置隐藏；补跑 `build`、trusted smoke、restricted smoke，并记录现存的非本任务 `typecheck` 失败。
- [x] (2026-04-18 18:43 +0800) 用户随后手动验证暴露 `defaultSurface` 的 restart 恢复回旧 panel / secondary side bar；本轮继续补持久化 `defaultSurface`、修正 startup restore 优先级、更新 smoke 覆盖与设计文档状态。
- [x] (2026-04-18 18:59 +0800) 用户完成手动复验，确认 `panel -> editor` 与 `editor -> panel` 的 restart 都已按新的 `defaultSurface` 收口；据此把 `canvas-surface-placement` 文档状态恢复为 `已验证`。
- [x] (2026-04-18 19:42 +0800) 根据 PR review 修复 runtime persistence 模式切换后未丢弃旧 surface 恢复元数据的问题，补充 trusted / restricted smoke 对“回落到当前 `defaultSurface`”的断言，并同步最新验证记录。

## 意外与发现

- 观察：当前代码里没有对 `defaultSurface` 或 `runtimePersistence.enabled` 的 `onDidChangeConfiguration` 热切换监听，真正的问题是这两个设置在多个运行时路径里被即时读取，导致“下一次动作按新配置走”，而不是“整个窗口 reload 后统一切换”。
  证据：`src/panel/CanvasPanelManager.ts` 的配置监听只覆盖 `agent.defaultProvider`、`terminal.integrated.scrollback`、`editor.multiCursorModifier` 和 `terminal.integrated.wordSeparators`；但 `getConfiguredSurface()`、`isRuntimePersistenceEnabled()` 会在 reveal、启动执行会话、host-boundary reload 等路径中反复读取当前设置。
- 观察：VS Code 原生允许对 `contributes.views` 使用 `when` 条件，但如果直接绑定实时配置值，会把“reload 后生效”的语义重新打穿；因此 panel tab 的显隐必须跟随“本次窗口已应用配置”，而不是 Settings 当前值。
  证据：本轮实现通过 `package.json` 中的 `when: "devSessionCanvas.canvas.panelViewVisible"` 配合宿主侧 context key 达成；context key 只在启动配置快照刷新后更新。
- 观察：受限工作区下，带 `live-runtime` 元数据的节点在 reload 后不会保持 `reattaching` 状态，而是被 reconcile 成 `history-restored`，同时保留 `attachmentState=reattaching` 作为“理论上可重连但被策略阻断”的标记。
  证据：`reconcileRuntimeNodesInArray(... allowLiveRuntimeReconnect: false, liveRuntimeReconnectBlockReason: 'workspace-untrusted')` 会返回 `status: 'history-restored'` 与阻断说明；restricted smoke 需要按此真实语义断言。
- 观察：runtime supervisor registry 会保留已停止的历史 session，不能把 `registry.sessions.length` 当作“当前 live runtime 数量”。
  证据：删除与模式切换相关 smoke 在 trusted / restricted 两侧都要改成过滤 `live === true` 的 session 集合，否则会把历史记录误判成未清理完成。
- 观察：仅把 `defaultSurface` 固定成“启动时读取一次”还不够；如果持久化状态只记录旧的 `activeSurface`，restart / reload 时仍会让旧 surface 覆盖新的 startup `defaultSurface`。
  证据：用户在 `panel -> editor` 后重启，画布仍显示在底部 panel / 右侧 secondary side bar；代码上 `loadStoredSurface()` 只读取 `activeSurface`，而 `deserializeWebviewPanel()` / `attachPanelView()` 会继续让旧 surface 参与恢复与抢占。
- 观察：runtime persistence 模式切换导致的整表 reset 也必须覆盖 surface 恢复元数据；否则虽然节点被清空，但旧 `canvasLastSurface` 仍会把窗口带回上次实际工作的 opposite surface。
  证据：review 在 `src/panel/CanvasPanelManager.ts:1328` / `src/panel/CanvasPanelManager.ts:2922` 指出，`loadState()` 已把 `rawState` 置空，但构造函数和 `simulateRuntimeReloadForTest()` 仍会继续读取旧 `canvasLastSurface`。

## 决策记录

- 决策：本轮使用独立 `ExecPlan` 推进，而不是只在 `tmp_task.md` 里留待办。
  理由：任务同时涉及外部调研、正式设计文档更新、配置语义调整、持久化边界修改和自动化验证，已经超过“单点修补”的复杂度。
  日期/作者：2026-04-18 / Codex
- 决策：为 `defaultSurface` 与 `runtimePersistence.enabled` 引入“本次窗口已应用启动配置快照”，并把 reload 提示作为唯一配置变更反馈，不再在运行时即时改写行为。
  理由：只有让 reveal、session start、host-boundary reload 与 sidebar / panel 可见性都读取同一份启动快照，才能兑现“必须 Window Reload 才生效”的用户承诺。
  日期/作者：2026-04-18 / Codex
- 决策：把 `runtimePersistence.enabled` 的已应用值写入持久化快照与 workspaceState；下次加载发现模式不一致时，直接走整张画布宿主状态 reset，而不是尝试局部兼容。
  理由：切换 persistence mode 后继续沿用旧节点会让同一张画布混合旧 runtime supervisor 语义与新节点默认行为，产品上不可解释；整表清空虽然更保守，但语义清晰且与设置文案一致。
  日期/作者：2026-04-18 / Codex
- 决策：Panel view tab 的显隐采用原生 `when` + 自定义 context key，而不是依赖实时配置表达式。
  理由：VS Code 原生 view hiding 能满足“editor 默认承载面时隐藏 panel tab”的目标，但必须绑定“当前窗口已应用配置”，否则 Settings 一改就会热隐藏 view，违背 reload-only 语义。
  日期/作者：2026-04-18 / Codex
- 决策：smoke 测试改成用例自给自足，显式恢复 baseline 或 `testResetState`，并用 live session 口径断言 runtime supervisor。
  理由：restricted 侧新增 reload/reset 语义后，测试顺序耦合会放大误报；把测试隔离做实后，失败才能更直接地映射到产品行为而不是测试残留状态。
  日期/作者：2026-04-18 / Codex
- 决策：surface startup restore 必须同时比较“上次已应用的 `defaultSurface`”与“当前 startup `defaultSurface`”；当两者不一致时，不恢复旧 opposite surface，并在 `deserializeWebviewPanel()` 直接丢弃不该恢复的 editor panel。
  理由：reload-only 语义的真正边界不是“命令默认打开位置”，而是“窗口重启后的首个承载面”；只要旧 surface 还能在恢复链路里抢回主画布，用户就会认为设置没有生效。
  日期/作者：2026-04-18 / Codex
- 决策：runtime persistence 模式切换触发的宿主 reset 必须与对象图一起丢弃旧 surface 恢复元数据，并让启动 surface 直接回落到当前 `defaultSurface`。
  理由：产品文案已经承诺“清空旧画布宿主状态后从空白状态启动”；若模式切换后仍恢复旧 `editor` / `panel`，用户会看到“空白但还在旧工作面”的混合状态，和正式设计不一致。
  日期/作者：2026-04-18 / Codex

## 结果与复盘

本轮先前已经把 `defaultSurface` 与 `runtimePersistence.enabled` 收口成“只在 Window Reload 后生效”，但用户随后手动验证暴露出一个 follow-up regression：`defaultSurface` 虽然不再热切换，却仍会在 restart 时被旧 `activeSurface` 恢复覆盖。针对这个缺口，宿主现在会把“上次已应用的 `defaultSurface`”一起写入快照与 workspaceState；下次启动如果发现配置已经切到相反 surface，就不再恢复旧 opposite surface，而是直接按当前 startup `defaultSurface` 收口。与之配套，旧 editor `WebviewPanel` 的反序列化恢复也会在 surface 不匹配时被主动丢弃，避免 serializer 抢回主画布。

`runtimePersistence.enabled` 的状态边界也已经落地：宿主会把已应用模式写入持久化快照与 workspaceState；下次加载若发现模式与当前窗口启动配置不一致，直接清空画布宿主状态并记录 `state/runtimePersistenceReset`，避免旧节点和新节点混用不同 persistence mode。这个语义同时覆盖 trusted 与 restricted 两个 smoke 场景，restricted 侧额外确认了被策略阻断的 live-runtime reconnect 会以 `history-restored + attachmentState=reattaching` 呈现。

验证结果如下。

- `npm run build` 通过。
- `npm run typecheck` 已通过；`src/webview/main.tsx` 里原有的 `isComposing` 类型报错已收口。
- 本轮重新执行 `DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=trusted node scripts/run-vscode-smoke.mjs`；新增的 surface / runtime persistence 回归断言已进入当前 head，但整套 suite 仍在无关的 `verifyLegacyTaskFiltering` 断言处失败。
- 本轮重新执行 `DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=restricted node scripts/run-vscode-smoke.mjs`；新增的 surface / runtime persistence 回归断言已进入当前 head，但整套 suite 仍在无关的 `verifyRestrictedLiveRuntimeReconnectBlocked` 断言处失败。
- 用户随后完成手动复验，确认 `panel -> editor` / `editor -> panel` 的 restart 行为均符合预期；因此 surface 设计文档现已恢复为 `已验证`，trusted smoke 的遗留阻塞继续作为独立测试债处理。

额外复盘：这次 follow-up 说明“reload-only 配置语义”不能只看命令入口，还必须覆盖 serializer / view restore 这类启动恢复链路。用户本地未提交文件 `.gitignore`、`tmp_task.md`、`core.14` 本轮均未触碰。

## 上下文与定向

这次改动集中在四个区域。

第一处是扩展清单 `package.json` 与 `package.nls.json`。这里定义了配置项、Panel view 注册和 Settings UI 中看到的文案。`defaultSurface` 与 `runtimePersistence.enabled` 都在这里声明，Panel 承载面的 tab 是否出现也由这里的 `contributes.views` / `contributes.viewsContainers` 决定。

第二处是 `src/panel/CanvasPanelManager.ts`。这是宿主侧权威状态管理器，负责画布 surface 的 reveal、持久化状态装载、执行节点启动和 runtime supervisor 协调。改动前 `defaultSurface` 与 `runtimePersistence.enabled` 都通过运行时 helper 即时读取，因此即使没有专门的配置变更监听，设置也会在后续动作中悄悄生效；本轮已经把这两个配置收口到启动快照与显式 reload 边界。

第三处是正式设计文档。`docs/design-docs/canvas-surface-placement.md` 记录 `editor` / `panel` 双承载面的正式边界；`docs/design-docs/runtime-persistence-and-session-supervisor.md` 记录两档运行时持久化模式的正式语义。只要本轮形成新的正式结论，例如“surface 的默认值只在窗口初始化读取”“切换 runtime persistence 会在下次 reload 清空宿主状态”，都必须同步落到这些文档和 `docs/design-docs/index.md`。

第四处是 VS Code smoke 测试 `tests/vscode-smoke/extension-tests.cjs`。仓库已经有测试命令可以更新配置、模拟 runtime reload 和读取宿主 debug snapshot，因此本轮优先补宿主级验证，而不是只靠纯单元测试。

## 工作计划

先完成外部调研并更新设计文档。需要确认三件事：扩展配置是否存在公开的 declarative reload 标记；`contributes.views` 是否能用原生 `when` 条件根据配置隐藏 Panel view；配置变更后给出 reload 提示和破坏性提醒时，公开 API 的最规范路径是什么。调研结论写进相关设计文档和索引，避免把当前直觉直接写成仓库结论。

然后收口设置读取边界。在 `CanvasPanelManager` 里引入“本次宿主启动时生效的配置快照”，让 `defaultSurface` 和 `runtimePersistence.enabled` 在 manager 生命周期内保持稳定，不再因为用户中途改设置就影响后续 reveal / execution start / host-boundary reload。测试辅助的“模拟 runtime reload”需要显式刷新这份配置快照，以便在同一进程里近似真实 Window Reload。

接着处理 runtime persistence 切换的宿主状态重置。需要把“当前持久化模式”连同画布快照一起落盘；当下次启动发现持久化模式与快照来源不一致时，宿主不再尝试沿用旧对象图，而是记录一次配置切换导致的 state reset，并从空白状态启动。这样才能兑现“切换模式会清空之前节点”的产品语义，而不是只停留在警告文案。

最后补提示与验证。`package.json` / `package.nls.json` 要写清 reload 语义；运行时在用户修改设置后给出 reload action 提示，其中 runtime persistence 走 warning 级别并明确写出状态清空影响。测试需要覆盖“改设置后不 reload 不生效”“模拟 reload 后才生效”“surface=editor 时 panel view 被原生隐藏”“runtime persistence 切换后 reload 清空状态”。

## 具体步骤

1. 在仓库根目录更新设计文档与索引：

    - `docs/design-docs/canvas-surface-placement.md`
    - `docs/design-docs/runtime-persistence-and-session-supervisor.md`
    - `docs/design-docs/index.md`

2. 修改扩展清单与配置文案：

    - `package.json`
    - `package.nls.json`

3. 修改宿主配置快照、reload 提示与状态重置逻辑：

    - `src/panel/CanvasPanelManager.ts`
    - 如有必要，`src/common/extensionIdentity.ts` 或相关共享类型也同步更新。

4. 更新任务记录与验证：

    - `tmp_task.md`
    - `tests/vscode-smoke/extension-tests.cjs`

5. 在仓库根目录运行验证命令，并把关键结果写回本计划：

    - `npm run build`
    - `npm run typecheck`
    - `npm run test -- --runInBand tests/vscode-smoke/extension-tests.cjs`

    如果最后一条命令与仓库现有测试入口不匹配，需要改成仓库当前可用的 smoke 执行命令，并在结果里注明。

## 验证与验收

首先验证 `defaultSurface`。把设置从 `panel` 改到 `editor` 后，在不 reload 的同一宿主实例里继续执行 `Dev Session Canvas: 打开画布`，预期默认打开位置仍按旧配置工作；执行测试态 `simulateRuntimeReload` 或真实 Window Reload 后，再次执行同一命令，预期才切到新 surface。若 `when` 方案成立，reload 后 `panel` 承载面 tab 也应随配置同步显示或隐藏。

然后验证 `runtimePersistence.enabled`。先在一种模式下创建节点与执行会话，再把设置切到另一种模式。reload 前继续创建或恢复节点，预期仍按旧模式运行；reload 后宿主应识别到模式切换并清空旧状态，新的节点与执行路径才按新模式工作。

最后验证用户提示与文案。Settings UI 对两个配置都要写明“Changes require window reload to take effect”；runtime persistence 额外写明“Changing this setting clears existing canvas host state on next reload”。在非测试模式下修改设置时，应出现带 `Reload Window` action 的提示，其中 runtime persistence 使用 warning 级别。

## 幂等性与恢复

本计划中的代码和文档改动应可重复执行。配置切换造成的宿主状态清空必须是可解释、可重试的：如果快照元数据表明“本次启动与上次持久化模式不同”，就统一走空白启动，而不是半清空、半保留的中间态。

当前工作树已经有用户自己的未提交改动：`.gitignore` 和 `tmp_task.md` 处于修改/未跟踪状态，还有一个 `core.14` 文件未跟踪。本轮不得回退这些差异；如果需要更新 `tmp_task.md`，只追加与本任务直接相关的调研记录和结果，不覆盖用户原始任务描述。

## 证据与备注

待补本轮调研链接、关键设置行为截图/日志和测试结果摘要。

## 接口与依赖

本轮预期会触达以下接口：

- `package.json`
  - `contributes.configuration.properties`
  - `contributes.views.devSessionCanvasPanel[*].when`

- `src/panel/CanvasPanelManager.ts`
  - 构造函数中的启动配置读取
  - `revealOrCreate()`
  - `getSidebarState()`
  - `loadReconciledState()`
  - `prepareForHostBoundary()`
  - 与配置变更通知相关的 `onDidChangeConfiguration`

- `vscode.workspace.onDidChangeConfiguration`
  - 本轮只用于提示用户 reload / 警告，不用于立即应用 `defaultSurface` 或 `runtimePersistence.enabled`

- `vscode.window.showInformationMessage`
  - 用于 `defaultSurface` 的 reload 提示

- `vscode.window.showWarningMessage`
  - 用于 `runtimePersistence.enabled` 的 reload 与状态清空警告

---

本次创建说明：2026-04-18 新增本计划，用于覆盖 `defaultSurface` 与 `runtimePersistence.enabled` 的 reload 语义、surface panel tab 原生隐藏能力和 runtime persistence 模式切换后的状态重置问题；之所以独立起计划，是因为本轮既包含外部调研，也包含正式设计结论与宿主持久化边界修改。
