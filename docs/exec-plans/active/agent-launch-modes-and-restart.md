# Agent 启动方式与重启交互

本 `ExecPlan` 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘` 这几个章节。

当前文档必须按 `docs/PLANS.md` 的要求持续维护。

## 目标与全局图景

完成后，用户可以在右键菜单或命令面板创建 Agent 时明确选择 provider 与启动方式，必要时输入完整启动命令；停止后的 Agent 也能在“恢复原会话”和“新会话”之间清楚分流。用户能直接在 VSCode 里看到：右键菜单出现三层 Agent 创建、命令面板 Agent 入口变成两步 Quick Input、已停止 Agent 显示 `新建 | 重启` 双按钮。

## 进度

- [x] (2026-04-24 10:40Z) 读取 `tmp_feature_uiux.md`、`docs/WORKFLOW.md`、`docs/DESIGN.md`、`docs/PLANS.md`，确认本任务需要同时更新正式规格、设计与实现。
- [x] (2026-04-24 11:10Z) 新增产品规格与设计文档草案，先把临时需求收口到 repo 内正式文档。
- [x] (2026-04-24 12:15Z) 实现共享的 Agent 启动预设/命令解析逻辑，并把 metadata / runtime context 扩展到宿主与 Webview。
- [x] (2026-04-24 12:45Z) 实现 Webview 右键菜单三层 Agent 创建、自定义输入与停止节点 split restart。
- [x] (2026-04-24 13:05Z) 实现宿主 Quick Input 两步 Agent 创建流程与测试 override。
- [x] (2026-04-24 13:55Z) 根据实现回归继续收口 UI/UX：统一重启 split button 风格、修复自定义输入的 IME Enter 误触发、移除右键菜单冗余取消按钮，并让 Quick Input 第二步列表项在顶部完整命令输入存在时仍可见。
- [x] (2026-04-24 14:20Z) 按新增语义对齐更新 Resume 含义：创建前 Resume 改为进入 CLI 自带 resume 选择入口，停止后的重启继续只恢复当前节点刚停止的会话。
- [x] (2026-04-24 15:05Z) 针对 Codex 停止后重启不稳的问题，调整为“启动后继续扫文件，停止时改发 Ctrl-C 并等待 CLI 输出 `Token usage` / `codex resume <session-id>` 提示，再用于补充或校验 resume session id”。
- [x] (2026-04-24 16:10Z) 按新增反馈补齐 Claude stop-time `claude --resume <session-id>` 校验，并把“停止后不可恢复”的标题栏动作从 disabled split restart 改成单个 `启动` 按钮。
- [x] (2026-04-25 01:20Z) 针对“停止后 live Webview 看不到尾部 `Token usage` / resume 提示，但 reload 后又能恢复”的竞态补丁收口：host 在 `executionExit` 前补发最终 snapshot，Webview 对 output / snapshot / exit banner 做顺序化写入，并补了对应 Playwright 回归。
- [x] (2026-04-25 01:55Z) 修复“点击停止按钮时 Codex 会被过早 force-kill、reload 后 stopped 节点又被展示成历史恢复”：把 Agent graceful-stop 超时从 4.5s 提长到 15s，并让已完成的 live-runtime 会话在落盘时回退为 `snapshot-only`。
- [x] (2026-04-25 03:10Z) 按新增反馈继续细化 resume metadata 发现策略：Codex 在运行态再次回到 `waiting-input` 且仍未拿到 session id 时补扫 `~/.codex/sessions`；Claude 新增基于候选 `session-id` 的 `~/.claude/projects/.../<session-id>.jsonl` 文件确认，并在已有文件确认时保留恢复上下文。
- [x] (2026-04-25 03:40Z) 按新增反馈细化 stop 按钮的 provider 语义：Codex 保持单次 `Ctrl-C`，Claude 改为短间隔连续两次 `Ctrl-C`。
- [x] (2026-04-25 05:32Z) 按最新反馈把 stop 按钮的 graceful-stop force-kill 窗口从 15s 收窄回 5s，保持 provider-specific `Ctrl-C` 次数不变。
- [x] (2026-04-25 06:25Z) 修正 Claude stop 的第二次 `Ctrl-C` 触发条件：不再依赖固定延时，而是等 CLI 输出 `Press Ctrl-C again to exit` 后再补发，并补了 fake-provider/smoke 回归。
- [x] (2026-04-25 06:55Z) 按最新反馈回滚 Claude stop 的双 `Ctrl-C` 方案：标题栏停止按钮重新改回单次 `Ctrl-C`，并同步收口 fake-provider / smoke / 文档。
- [x] (2026-04-25 07:10Z) 按最新澄清继续把 Claude stop 回滚到更早版本：不再走 `Ctrl-C`，而是恢复此前的直接终止信号路径；Codex 仍保留单次 `Ctrl-C` graceful-stop。
- [x] (2026-04-25) 修复命令面板 / 侧栏 `创建节点` 第二步 Quick Input 的误创建回归：点击 `Resume / YOLO / 沙盒` 现在只改写顶部完整命令输入，不再直接创建节点；脚本化 QuickPick override 也同步要求显式 `accept-current` 才创建。
- [x] (2026-04-25) 按最新反馈给命令面板 / 侧栏 `创建节点` 第二步 Quick Input 补回 `默认` 快捷替换项，并同步更新脚本化 override 与 smoke 覆盖。
- [x] (2026-04-25) 按最新反馈把 `agent.codexDefaultArgs` / `agent.claudeDefaultArgs` 的 VSCode 配置 scope 改成 `window`，使其可在窗口 / 工作区层直接配置与覆盖。
- [x] (2026-04-25) 按最新反馈把 Agent 节点副标题改成显示当前节点最近一次实际启动指令，并在副标题文本被截断时通过 hover 浮窗显示完整指令；未实际启动过的节点则回退显示下一次 fresh-start 指令。
- [x] (2026-04-25) 根据 review finding 收口宿主兜底：创建与 fresh-start 都会重新校验自定义命令首个 token 是否仍属于当前 provider，Claude 显式 session flag 识别补齐 `--flag=value`，并同步修正 smoke 断言。
- [x] (2026-04-25) 根据最新 review finding 继续收口：provider 校验改成“仅接受当前设置值本身或标准别名”，Claude 显式 session id 会驱动 host / supervisor 的文件确认链路，右键菜单 Resume 文案也与规格重新对齐。
- [x] (2026-04-26) 根据最新 review finding 继续收口命令行解析与错误呈现：共享 parser 兼容 Windows 反斜杠路径，provider 默认启动参数 parse error 改为显式上抛到 Webview / Quick Input / host，右键菜单自定义启动打开后第一次 `Escape` 也会优先收起输入区。
- [x] (2026-04-26) 针对“不断补丁修 parser”的风险，补做了命令层方案调研并按结果收口：执行路径继续坚持结构化 `file + args[]`；共享 parser 以文档化 Windows quoting 为基线，但 canonical formatter 改为优先输出单引号包裹的稳定文本，仅在必要时才退回双引号 escaping，同时兼容旧版全量双写反斜杠的历史文本与自然输入的 UNC / 尾部反斜杠路径。
- [x] (2026-04-29 03:10Z) 收口“显式预设 vs 默认模式参数”冲突：共享命令层会先剥离 provider-owned mode flags，再回填 `Resume / YOLO / 沙盒`；同时 Quick Input 第二步在显式点击预设且最终命令仍等价时保留该 preset 的 metadata，而不是仅靠字符串反推回落成 `default`。

- [x] (2026-05-18) 按最新交互反馈，把停止后的 Agent 标题栏动作从 `重启 | ▼` 下拉式 split restart 改为并列 `新建 | 重启`；`新建` 复用原“新会话”功能，`重启` 保持恢复当前节点原会话。
- [x] (2026-06-13) 将 Agent `Fork` 的 provider-native 范围从 Claude Code 扩展到 Codex：Codex 节点持有可信 `codex-session-id` 时也显示 `分叉`，Host 用 `codex fork <session-id>` 创建同 provider 新节点并立即启动。
- [x] (2026-06-13) 按最新 UI 决策收口分叉节点标题栏：用户可见按钮文案改为 `分叉`，新分叉节点和普通 Agent 节点一样显示状态胶囊；窄宽度沿用 PR121 的按钮级压缩/内部换行，不再通过隐藏状态腾空间，也不让整组动作区换行打散布局。
- [x] (2026-06-14) 修正右上角动作按钮内部换行触发：节点接近最小宽度时切到 `compact-actions` 密度，让 `启动/停止/新建/重启/分叉/删除` 等动作文案统一在按钮内部两行显示，同时保持 action cluster 不整组换行。
- [x] (2026-06-14) 分叉创建的自动 `user` 边现在默认写入 `fork` 标签，并补充 Host smoke 断言，覆盖宿主状态与 Webview probe 都应看到该标签。
- [x] (2026-06-14) 根据 PR159 review 收口 Codex 分叉参数清理：`buildCodexBranchArgv()` 现在同时清理 `fork` / `resume` 子命令之前与之后的旧选择参数，再追加当前可信 session id。
- [x] (2026-06-14) 根据 PR159 review 将旧 Claude-only 分叉计划从 `docs/exec-plans/active/claude-agent-branch.md` 移入 `docs/exec-plans/completed/claude-agent-branch.md`，当前 active scope 统一指向本计划。
- [x] (2026-07-01) 明确显式 `Resume / Fork` 的冲突与不冲突配置清单，并实现当前节点 `重启` / 历史恢复复用共享 history resume 命令构造，避免丢失 model、sandbox、approval、profile、config、cwd 等非冲突配置。
- [x] (2026-07-02) 针对当前节点 `重启` / `分叉` 补齐启动意图继承：宿主传入 `launchPreset/customLaunchCommand/templateArgv`，历史恢复 / 历史分叉继续只使用历史 session id 与当前 Default args。
- [x] (2026-07-04) 根据真实 fork 失败诊断修正当前节点启动意图边界：当前节点 `重启` / `分叉` 只继承节点最近一次实际启动命令或节点长期启动偏好，不再合并当前 Default args；历史恢复 / 历史分叉继续使用当前 Default args。

## 意外与发现

- 观察：当前仓库已经有“创建前选择 provider”的正式设计，但它把 QuickPick 定义成一步直达创建；如果不显式更新正式文档，就会和新 feature 直接冲突。
  证据：`docs/design-docs/agent-node-creation-provider-selection.md` 当前结论仍写着“顶层 QuickPick 直接创建，不再进入第二层”。

- 观察：Codex 的 `codex resume <session-id>` 提示不是启动后立即可见，而是在 `Ctrl-C` 结束会话时才输出；这意味着文件扫描与退出提示分别覆盖“早期发现”和“权威校验”两个时点。
  证据：2026-04-24 用户补充说明该提示只会在 `Ctrl-C` 结束会话时出现，并提供了对应终端截图。

- 观察：Claude Code fresh-start 时传入的 `--session-id` 只是候选值；如果启动后没有真正交互，CLI 结束时可能不会给出 `claude --resume <session-id>` 提示，说明这次会话并未建立可恢复绑定。
  证据：2026-04-24 用户补充说明 Claude “启动后没有交互时，session-id 不会生效”，并要求在结束时再核验截图中的 resume 提示。

- 观察：本机 `Claude Code` 的 session transcript 会以 `<session-id>.jsonl` 形式落在 `~/.claude/projects/<project>/` 下，因此对 Claude 而言，不需要像 Codex 那样靠时间窗猜测，只要拿着候选 `session-id` 去确认对应文件是否存在即可。
  证据：2026-04-25 本地检查 `~/.claude/projects/-home-users-ziyang01-wang-al-projects-dev-session-canvas/*.jsonl`，文件名即为 `session-id`。

- 观察：用户看到“节点 stop 后没有输出 `Token usage` / `To continue this session`，但 reload 后又出现”，说明权威终态其实已经落进持久化 snapshot，问题出在 live Webview 的尾包写入时序，而不是 CLI 没正常结束。
  证据：2026-04-25 用户补充截图说明 reload 后两行提示可见；当前实现中 reload 依赖 `serializedTerminalState` 恢复终态。

- 观察：手动在 Agent terminal 里按 `Ctrl-C` 与点击标题栏“停止”走的是两条不同的退出约束；前者只写入 `^C`，后者还会启动 4.5 秒 force-kill 兜底。对 Codex 而言，这个超时可能早于 CLI 自己输出 `Token usage` / `codex resume ...` 的时点。
  证据：代码路径中 `writeExecutionSessionInput(... '\u0003')` 不会启动 kill timer，而 `stopExecutionSession -> requestGracefulLocalAgentStop` 与 runtime supervisor 的 `stopSession -> requestGracefulAgentStop` 都会在 4.5 秒后强杀。

- 观察：Node / Execa 生态里的成熟执行路径都强调“直接传 `file + args[]`，不要把整段字符串再交给 shell”；而 POSIX shell quoting 与 Windows `CommandLineToArgvW` 的反斜杠/引号规则并不一致，所以继续维护一个“单一、平台无关、同时兼容自然 Windows 路径”的手写 parser 会持续引入边界 bug。
  证据：2026-04-26 本轮调研了 Node `child_process`、Execa escaping 文档、GNU Bash quoting 与微软 `CommandLineToArgvW` 规则，结论都指向“执行用结构化 argv，字符串 parser 只留在输入边界且必须显式定义语义”。

- 观察：现成 shell parser 并不能直接覆盖本仓库的混合需求。以 `shell-quote` 为例，它对单引号/双引号很成熟，但会把未加引号的 `C:\tools\codex.exe` 中的 `\` 当 escape 处理，也无法把自然输入的 `"C:\Users\me\My Dir\"` 还原成尾部反斜杠路径；因此它更适合作为 canonical quoting 风格参考，而不是直接替换当前 parser。
  证据：2026-04-26 本地对 `shell-quote` 试跑 `C:\tools\codex.exe --yolo` 与 `codex --config "C:\Users\me\My Dir\"`，前者被解析成 `C:toolscodex.exe`，后者则把结尾 `\"` 吃成字面量双引号。

- 观察：当默认启动参数本身已经包含 `--yolo` 或 `--sandbox ...` 这类模式 flag 时，Quick Input 第二步的“显式 YOLO / 沙盒”与“默认”可能生成同一条完整命令；如果创建时只靠最终字符串反推 preset，就会把用户刚刚显式选择的模式误写回 `default`。
  证据：2026-04-29 本地复核 `extensions/vscode/dev-session-canvas/src/extension.ts` 的第二步创建链路，确认它此前只把 QuickPick 选项改写为完整命令字符串，再由 `classifyAgentLaunchPreset(...)` 从字符串反推 metadata；而 `extensions/vscode/dev-session-canvas/src/common/agentLaunchPresets.ts` 在 `default` 与显式 preset 命令相同时会优先命中 `default`。

- 观察：当前本地 Codex CLI `0.137.0` 已提供稳定 `codex fork [SESSION_ID]` 子命令，帮助文本说明它会 fork 之前的 interactive session，并且该子命令支持与 `codex resume` 同类的 runtime flags。
  证据：2026-06-13 运行 `codex --version` 输出 `codex-cli 0.137.0`；运行 `codex fork --help` 输出 usage `codex fork [OPTIONS] [SESSION_ID] [PROMPT]`，并列出 `--model`、`--sandbox`、`--profile`、`--config` 等选项。

- 观察：当前节点停止后点击 `重启` 的宿主路径此前只显示并执行裸 `codex resume <session-id>` / `claude --resume <session-id>`，没有复用 `buildAgentHistoryResumeCommandLine(...)`，因此和历史恢复 / Fork 命令层不一致。
  证据：2026-07-01 复核 `extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts` 的 `buildAgentDisplayLaunchCommandLine(...)` 与 `buildAgentLaunchSpec(...)` 后确认，`launchMode === 'resume'` 时默认忽略 provider 默认参数，只追加裸 resume 参数。

- 观察：与 `Resume / Fork` 冲突的一次性会话目标不适合放入 Default args；如果只在显式恢复 / 分叉时自动清理，用户会在设置层看不到真实失效原因，也会让快速启动、预设展示、自定义启动预填、历史恢复和节点重启对同一段默认参数产生不同解释。
  证据：2026-07-01 用户明确反馈“其中会跟 fork 和 resume 冲突的参数, 也不适合放在 Default args 中”；同日复核 `agent.codexDefaultArgs` / `agent.claudeDefaultArgs` 的调用面，确认它们被右键菜单、Quick Input、fresh-start、history resume 与 branch command line 共用。

- 观察：provider 历史扫描不能可靠拿到历史会话原始启动参数，因此只有“当前节点”的 `重启` / `分叉` 能继承节点启动意图；侧栏历史恢复 / 分叉只能继承当前 Default args。
  证据：2026-07-02 复核 `extensions/vscode/dev-session-canvas/src/common/agentSessionHistory.ts`，Codex 只从 `session_meta` 提取 `id/cwd/timestamp`，Claude 只从 transcript / 文件名提取 `cwd/sessionId`；两者都没有稳定原始 argv / command line 字段。

- 观察：当前节点 `重启` / `分叉` 若继续把节点启动意图与当前 Default args 合并，会让已存在节点在用户修改 Default args 后改变行为；当 fork 节点本身的最近启动命令和 Default args 都包含 `--search` / `-c sandbox_workspace_write.network_access=true` 时，再次 fork 会生成重复 `--search` 并被 Codex CLI 拒绝。
  证据：2026-07-04 宿主诊断 `.debug/current-host-diagnostics/2026-07-04T05-33-09-120Z/persisted-canvas-snapshot.json` 中失败节点命令为 `codex fork -c sandbox_workspace_write.network_access=true --search --yolo -c sandbox_workspace_write.network_access=true --search <session-id>`，输出为 `error: the argument '--search' cannot be used multiple times`。

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

- 决策：Codex 的“恢复当前节点原会话”继续保留启动后的 `~/.codex/sessions` 扫描；当用户点击停止时，停止路径改为先向 CLI 发送 `Ctrl-C`，等待 Codex 输出 `Token usage` / `codex resume <session-id>` 提示，再把这条提示用于补充或校验 session id。
  理由：文件扫描可以尽早让节点进入可恢复状态，但它本质上仍是启发式匹配；退出提示则来自 Codex CLI 自身，适合在停止时作为更权威的补充/校验来源。
  日期/作者：2026-04-24 / Codex

- 决策：Claude Code fresh-start 继续在启动时注入候选 `--session-id`，但 stopped 节点是否可恢复必须以后续输出里的 `claude --resume <session-id>` 提示为准；若停止后没有这条提示，则节点 UI 退化为单个 `启动` 按钮，不再显示 disabled 的重启动作。
  理由：用户已经确认 Claude “启动时带 session-id”不等于“该 session-id 一定生效”；只有 CLI 自己在结束时回显 `claude --resume` 才能证明当前节点真的具备恢复入口。UI 也应只在确实可恢复时才暴露恢复当前节点原会话的 `重启`。
  日期/作者：2026-04-24 / Codex

- 决策：在保留 stop-time hint 校验的前提下，为 Claude 增加基于候选 `session-id` 的 provider 文件确认；同时，Codex 若在首次 discovery miss 后又进入 `waiting-input`，就再触发一轮文件扫描。
  理由：Claude 的 session file 已经带着精确的 session id，不需要继续把“是否生效”完全拖到 stop-time 才知道；Codex 虽然仍只能启发式扫文件，但节点多轮 turn 之间文件落盘时序会继续变化，因此在 `running -> waiting-input` 的边界补扫一轮更稳。
  日期/作者：2026-04-25 / Codex

- 决策：针对 stop 尾包显示竞态，采用“host 先发最终 snapshot，再发 `executionExit`”与“Webview 串行化 terminal output / snapshot restore / exit banner 写入”的组合修复，而不是只补单侧兜底。
  理由：最终 snapshot 负责校正正确性，保证不 reload 也能恢复到权威终态；Webview 串行写入负责改善实时观感，避免尾部输出、snapshot 和退出横幅互相覆盖。
  日期/作者：2026-04-25 / Codex

- 决策：针对 stop 按钮与手动 `Ctrl-C` 的语义偏差，保留“点击停止 = 先发 `^C` 再兜底 kill”的策略；当前兜底超时收口为 5 秒，并让 runtime supervisor 上已经自然结束的会话在宿主状态里降级为 `snapshot-only`，避免 reload 后被误判成 `history-restored`。
  理由：Codex/Claude 的 stop-time 退出摘要可能明显晚于 4.5 秒；只要 CLI 还在正常收尾，就不该被按钮路径提前截断。同时，已经结束的会话不再属于“等待重连的 live runtime”，继续保留 `live-runtime` 持久化语义会让 reload 后的 badge 误导成“历史恢复”。
  日期/作者：2026-04-25 / Codex

- 决策：stop 按钮的 `Ctrl-C` 次数按 provider 区分：Codex 发一次，Claude 连续发两次。
  理由：用户已明确要求对齐真实 CLI 交互语义；Codex 的 stop-time 信息在一次 `Ctrl-C` 后即可收尾，而 Claude 更接近“第一次中断当前执行、第二次退出会话”的交互，需要标题栏 stop 路径主动模拟连续两次 `Ctrl-C`。
  日期/作者：2026-04-25 / Codex

- 决策：Claude stop 路径的第二次 `Ctrl-C` 改成由 CLI 退出确认提示驱动，而不是固定延时盲发。
  理由：用户提供的实际截图表明，Claude 会先打印 `Press Ctrl-C again to exit` 再真正接受第二次中断；若扩展提前把第二次 `Ctrl-C` 发出去，就会被 CLI 吞掉，最终停在确认提示上。用输出提示作为握手条件，比拍脑袋设 120ms / 300ms 更稳。
  日期/作者：2026-04-25 / Codex

- 决策：Claude stop 路径继续回滚到单次 `Ctrl-C`，不再主动模拟第二次中断。
  理由：用户最新确认 Claude Agent 在“不靠双 `Ctrl-C` 停止”的情况下结束状态是正常的；既然双 `Ctrl-C` 方案并非必要，就应优先选择更简单、风险更小的 stop 语义，避免再被 CLI 内部的二次确认提示牵着走。
  日期/作者：2026-04-25 / Codex

- 决策：Claude stop 路径继续回滚到更早版本，直接恢复此前的终止信号实现，不再发送 `Ctrl-C`。
  理由：用户进一步澄清目标并不是“改成像 Codex 那样一次 `Ctrl-C`”，而是“回到更早一版 Claude 自己原来的停止信号”。既然用户已经验证那条旧路径的结束状态正常，就应以该 provider-specific 语义为准，而不是强行和 Codex 对齐。
  日期/作者：2026-04-25 / Codex

- 决策：自定义启动的 provider 归属校验同时放在“创建节点”和“fresh-start 真正执行前”两道宿主关口；Claude 显式 session flag 统一按 `--flag value` 与 `--flag=value` 两种形式识别。
  理由：Webview 校验只能约束正常 UI 流程，不能防止伪造消息或旧 metadata 绕过；而 `--session-id=...` / `--resume=...` 是 Claude 常见写法，若宿主只识别分隔 token，会把自定义命令改坏。
  日期/作者：2026-04-25 / Codex

- 决策：provider 命令校验不再接受“同 basename 的任意绝对路径”；如果设置值是绝对路径脚本，则只允许该精确 token 本身，或 provider 标准别名。与此同时，只要 Claude 启动命令里显式带了 session id，host 与 supervisor 后续都统一以这条真实 session id 做文件确认。
  理由：规格写的是“当前设置值本身，或标准别名”，不是“同名二进制都行”；而显式 session id 若不进入后续确认链路，就会让 `--session-id=<id>` / `--resume=<id>` 这类启动方式在 stop 后错误丢失“恢复原会话”入口。
  日期/作者：2026-04-25 / Codex

- 决策：命令层不再继续朝“模拟 shell”方向打补丁，而是正式收口为“执行始终使用结构化 `file + args[]`；字符串 parser 只服务于 Settings / Quick Input / 右键菜单等文本输入边界，并以 Windows 文档化 quoting 规则为基线，同时让 canonical formatter 优先产出单引号包裹的稳定文本，仅在必要时才退回双引号 escaping”。
  理由：这条边界和 Node / Execa 的成熟实践一致，也能解释为什么我们既要避免 shell 注入，又要继续接受用户自然写的 `C:\...` / `\\server\share\...`。相比继续扩大启发式 escape 规则，采用“结构化执行 + 单引号优先 canonical 字符串 + 窄兼容层”的做法更容易形成可维护的不变量与测试矩阵。
  日期/作者：2026-04-26 / Codex

- 决策：共享命令层按预设类型分别归一化默认参数：对 `YOLO / 沙盒` 只剥离当前 provider 下由执行策略接管的 mode flags，再回填本次选择的执行策略；对显式 `Resume` 预设，则改为剥离已有的 resume/session target 片段，再回填 provider 自己的通用 resume 入口。Quick Input 第二步额外保留“最后一次显式点击的 preset”，只要最终命令仍与该 preset 语义等价，就以这次显式选择持久化 `launchPreset`。
  理由：这样才能同时修掉右键三级菜单里“预设文案/实际启动命令和默认参数冲突”的问题，以及 Quick Input 在“默认命令已含模式 flag”时把显式 `YOLO / 沙盒 / Resume` 错降级成 `default` 的问题；同时又不会误把 `resume --last`、`resume <session-id>`、`--resume <session-id>`、`--continue <session-id>` 这类“恢复哪条会话”的语义当成执行策略冲突去抹掉。这里也刻意只支持仓库已知的一小组冲突 flag，而不是尝试做一套通用 CLI 参数归一化；未知组合统一要求用户改走自定义启动。
  日期/作者：2026-04-29 / Codex

- 决策：停止后可恢复的 Agent 不再使用 `重启 | ▼` 下拉式 split restart，而是直接展示 `新建 | 重启` 两个并列按钮；`新建` 对应原下拉菜单里的“新会话”，`重启` 对应恢复当前节点原会话。
  理由：用户需要把两个高频分流直接暴露出来，减少隐藏在下拉里的新会话入口，同时保持不可恢复时仍回退为单个 `启动`。
  日期/作者：2026-05-18 / Codex

- 决策：Agent `Fork` 继续保持 provider-native 语义，但支持集合扩展为 Codex 与 Claude Code；Codex 生成 `codex fork <source-session-id>`，Claude Code 继续生成 `claude --resume <source-session-id> --fork-session`。
  理由：Codex 已确认有稳定原生 fork 子命令，可以创建新的 thread；普通 `codex resume <session-id>` 仍不能冒充 Fork。Host 仍必须重新校验 provider 与 resumeStrategy 匹配，避免 Webview 伪造 session id。
  日期/作者：2026-06-13 / Codex

- 决策：分叉节点标题栏应和普通 Agent 节点一样显示状态胶囊，用户可见动作文案使用中文 `分叉`。
  理由：PR121 已证明按钮级压缩/内部换行可以在保持标题栏主结构 inline 的前提下保护动作可读性；窄节点下应优先保持 title / status / actions 信息一致，而不是把分叉节点特判成无状态或让整组动作区换行打散布局。中文文案也和同一标题栏内的 `启动`、`停止`、`删除` 保持一致。
  日期/作者：2026-06-13 / Codex

- 决策：右上角动作按钮的内部换行不能只依赖 `min-content` 自然收缩，而应在 Agent 节点接近最小宽度时显式切到按钮内部两行的统一紧凑密度。
  理由：这些动作大多只有两个中文字符，浏览器会用 `min-content` 宽度保护按钮，单纯设置 `white-space: normal` 时，用户把节点拖到最窄也可能仍看不到按钮内部换行。显式的 `compact-actions` 密度让 PR121 语义变成可观察行为，并保证 `启动/停止/新建/重启/分叉/删除` 等右上角动作使用同一格式，同时继续保持 action cluster inline，不回到整组换行。
  日期/作者：2026-06-14 / Codex

- 决策：分叉自动连线继续保持普通可编辑 `user` 边，但默认标签固定为 `fork`。
  理由：用户需要在画布上直接看出这条关系来自分叉动作；只画箭头不足以解释关系语义，而继续使用普通 `user` 边可以保留现有编辑、删除与模板能力，不引入正式 branch lineage。
  日期/作者：2026-06-14 / Codex

- 决策：Codex 分叉命令必须在 leading args 与 `fork` / `resume` 子命令 args 两侧统一剥离选择语义，再把当前节点可信 session id 作为唯一目标追加到末尾。
  理由：用户可能把 `--last`、`--all`、`--include-non-interactive` 或旧 session id 写在 `agent.codexDefaultArgs` 的子命令前缀里；如果只清理子命令之后的参数，`codex fork --last ... <source-session-id>` 会重新引入“最近会话/选择范围”语义，破坏显式从当前节点分叉的安全边界。
  日期/作者：2026-06-14 / Codex

- 决策：最初的 Claude-only 分叉 ExecPlan 不再作为 active 计划维护，而是移动到 completed 历史记录；当前 Codex / Claude Code 分叉事实统一维护在本计划、产品规格与设计文档中。
  理由：该旧计划的目标、职责和验证段落包含当时的 Claude-only 当前态描述，继续留在 active 目录会误导后续协作者；移动到 completed 并标注历史状态，比在两个 active 计划里同时维护分叉事实更可追踪。
  日期/作者：2026-06-14 / Codex

- 决策：显式 `Resume / Fork` 只剥离“目标选择”配置，保留运行配置；当前节点 `重启` 与历史恢复都通过共享 history resume 命令构造生成完整命令，再交给现有 resolver / launch spec。
  理由：用户意图是保持其他不冲突参数，例如 model、sandbox、approval、profile、config、cwd；真正冲突的是旧 session id、最近会话选择、picker 范围和旧 fork 标记。把当前节点 `重启` 也接到共享命令层，可以让节点内 resume、历史 resume 与 Fork 遵循同一份白名单边界。
  日期/作者：2026-07-01 / Codex

- 决策：Default args 本身 fail closed 拒绝会话目标类冲突项，而不是在 `Resume / Fork` 时继续静默清理。`Codex` 默认参数中禁止 `resume`、`fork`、`--last`、`--all`、`--include-non-interactive`、`--` 和裸 positional token；`Claude Code` 默认参数中禁止 `--resume` / `-r`、`--continue` / `-c`、`--session-id` 与 `--fork-session`。
  理由：Default args 是长期配置，只适合承载 model、sandbox、approval、profile、config、cwd 等稳定 runtime/configuration 参数；一次性会话目标应由创建前 `Resume`、当前节点 `重启`、历史恢复、分叉入口或自定义启动命令表达。Codex 的裸 positional token 在 `resume` / `fork` 语境下也会变成目标或 prompt，因此同样不适合作为 Default args。前移校验能避免同一段默认参数在不同入口被隐式改写成不同命令。
  日期/作者：2026-07-01 / Codex

- 决策：当前节点 `重启` / `分叉` 继承节点启动意图，历史恢复 / 历史分叉不继承历史会话原始意图。
  理由：当前节点 metadata 里有 `launchPreset/customLaunchCommand/templateArgv`，可以在剥离 session-target 后安全合并；历史会话记录只提供 provider、session id、cwd、时间和首条用户指令，若宣称继承原始 argv 会把不可确认事实写成能力。
  日期/作者：2026-07-02 / Codex

- 决策：当前节点 `重启` / `分叉` 只使用当前节点启动意图，不再合并当前 Default args；启动意图优先来自 `lastLaunchCommandLine`，缺失时再退回 `launchPreset/customLaunchCommand/templateArgv`。
  理由：画布上的节点已经有自己的启动历史和长期启动偏好，用户修改 Default args 不应改写已有节点的恢复 / 分叉行为；真实诊断也证明“节点意图 + Default args”会把 `--search` / `-c` 等 singleton/runtime 参数重复拼入。历史恢复 / 历史分叉没有节点意图，仍使用当前 Default args 作为历史入口启动基线。
  日期/作者：2026-07-04 / Codex

## 结果与复盘

- 已更新：需求已从临时文件迁入正式 docs；本轮又按新增反馈把创建前 `Resume` 改成 provider 自带 resume 选择入口，并保留“停止后重启 = 恢复当前节点上一条会话”的语义。针对 Codex 停止后重启不稳的问题，当前实现已改回“启动后继续扫文件”，并让停止路径先发 `Ctrl-C`、等待 `Token usage` / `codex resume <session-id>` 输出，再用它补充或校验 session id；Claude 先前则改成停止后必须看到 `claude --resume <session-id>` 才算真正可恢复，否则标题栏直接回退成单个 `启动` 按钮。针对“live 节点 stop 时尾部提示不显示、reload 后才出现”的问题，又补上了 host final snapshot + Webview 顺序化 terminal 写入的组合修复，并新增 Playwright 用例覆盖“尾部输出先于 exit banner”和“final snapshot 先于 exit banner”的回归场景。随后 stop 语义继续收口：已完成的 live-runtime 会话在宿主状态里会降级成 `snapshot-only`，使 reload 后继续显示 `stopped/closed`，而不是误导性的 `history-restored`；resume metadata 发现链路也继续细化成“Codex 在运行态再次回到 `waiting-input` 且仍未拿到 session id 时补扫 `~/.codex/sessions`，Claude 则新增 `~/.claude/projects/.../<session-id>.jsonl` 文件确认”。当前 stop 行为再次回到 provider-specific：Codex 标题栏停止按钮发送单次 `Ctrl-C` 并保留 5 秒 graceful-stop 兜底，Claude 则恢复更早版本的直接终止信号路径，不再发送 `Ctrl-C`。同时，命令面板 / 侧栏 `创建节点` 第二步 Quick Input 的行为也重新和规格对齐：点击 `默认 / Resume / YOLO / 沙盒` 只会改写顶部完整命令输入，必须显式按 Enter 才会真正创建节点；脚本化 QuickPick override 不再把“仅选择预设”误当成创建。当前已经完成 `npm run typecheck`、`npm run build`、`node --check tests/vscode-smoke/extension-tests.cjs`、`bash -n tests/vscode-smoke/fixtures/fake-agent-provider`；更大范围 end-to-end smoke 仍待条件允许时补跑。
- 已更新：需求已从临时文件迁入正式 docs；本轮又按新增反馈把创建前 `Resume` 改成 provider 自带 resume 选择入口，并保留“停止后重启 = 恢复当前节点上一条会话”的语义。针对 Codex 停止后重启不稳的问题，当前实现已改回“启动后继续扫文件”，并让停止路径先发 `Ctrl-C`、等待 `Token usage` / `codex resume <session-id>` 输出，再用它补充或校验 session id；Claude 先前则改成停止后必须看到 `claude --resume <session-id>` 才算真正可恢复，否则标题栏直接回退成单个 `启动` 按钮。针对“live 节点 stop 时尾部提示不显示、reload 后才出现”的问题，又补上了 host final snapshot + Webview 顺序化 terminal 写入的组合修复，并新增 Playwright 用例覆盖“尾部输出先于 exit banner”和“final snapshot 先于 exit banner”的回归场景。随后 stop 语义继续收口：已完成的 live-runtime 会话在宿主状态里会降级成 `snapshot-only`，使 reload 后继续显示 `stopped/closed`，而不是误导性的 `history-restored`；resume metadata 发现链路也继续细化成“Codex 在运行态再次回到 `waiting-input` 且仍未拿到 session id 时补扫 `~/.codex/sessions`，Claude 则新增 `~/.claude/projects/.../<session-id>.jsonl` 文件确认”。当前 stop 行为再次回到 provider-specific：Codex 标题栏停止按钮发送单次 `Ctrl-C` 并保留 5 秒 graceful-stop 兜底，Claude 则恢复更早版本的直接终止信号路径，不再发送 `Ctrl-C`。同时，命令面板 / 侧栏 `创建节点` 第二步 Quick Input 的行为也重新和规格对齐：点击 `默认 / Resume / YOLO / 沙盒` 只会改写顶部完整命令输入，必须显式按 Enter 才会真正创建节点；脚本化 QuickPick override 不再把“仅选择预设”误当成创建。另一个同步收口是：`agent.codexDefaultArgs` / `agent.claudeDefaultArgs` 现在使用 `window` scope，允许在窗口 / 工作区层直接配置与覆盖。最新一轮又把 Agent 节点副标题改成显示当前节点最近一次实际启动指令，并在文本被截断时通过 hover 浮窗暴露完整指令；尚未真正启动过的节点则回退显示按当前 metadata 与设置推导出的下一次 fresh-start 指令。当前已经完成 `npm run typecheck`、`npm run build`、`node --check tests/vscode-smoke/extension-tests.cjs`、`bash -n tests/vscode-smoke/fixtures/fake-agent-provider`；更大范围 end-to-end smoke 仍待条件允许时补跑。
- 已更新：针对 review finding，又补上两层宿主兜底。其一，`agentCustomLaunchCommand` 现在在创建消息落盘前和 fresh-start 真正执行前都会重新按 provider 规则校验，伪造 `agentProvider: "claude"` + `node -e ...` 之类的 payload 会直接被拒绝，不会再走 resolver / spawn。其二，Claude 自定义启动里若已显式写入 `--session-id` / `--resume` / `--continue`，无论采用空格分隔还是 `--flag=value`，宿主都不会再重复追加第二份 session 参数；同时 smoke 里的 `verifyClaudeStopRestoresPreviousSignal` 也已改回与当前 stop 语义一致的断言。
- 已更新：本轮继续补齐 review 收尾。provider 校验已经从“同 basename 也算合法”改成“只认当前设置值本身或标准别名”，避免 `/tmp/evil/claude` 之类的同名二进制绕过。Claude 的显式 session id 也不再只停留在 launch args 里：host 在构建 `resumeContext` 时会直接提取真实 session id，runtime supervisor 在 createSession 时也会用同一逻辑兜底，因此 `claude --session-id=<id>` 这类 fresh-start 能继续通过 provider transcript 文件确认，stop 后保留 `重启 | ▼`。同时，trusted smoke 里的 Claude stop 用例改成使用 PATH 中的 `claude` 标准别名，避免再和 “测试环境默认 command 指向 missing-agent-provider” 的校验规则冲突。
- 已更新：本轮把“命令字符串层”正式收口成更稳定的模型：真正执行仍只走 `node-pty.spawn(file, args)`，共享 formatter 改为优先输出单引号 canonical 文本，避免再主动生成 `"...\\\""` 这类高歧义字符串；parser 则继续接受新 canonical output、旧版“每个 `\` 都双写”的历史文本，以及自然输入的 quoted UNC / 尾部反斜杠 path。这样既修掉了 `\\server\share\...` 被误折叠成 `\server\share\...` 的回归，也收掉了 `--prompt '\\" a' -> build -> validate` 这类“扩展自己生成的命令又被自己误判”的主路径问题。
- 已更新：本轮继续补齐“共享命令层 + Quick Input metadata”之间的最后一处歧义。现在显式 `Resume / YOLO / 沙盒` 会先覆盖默认参数里的同类模式 flag，再生成展示文案与实际 fresh-start 命令，因此右键菜单第三层不再出现 `--sandbox ... --yolo` 这类冲突组合。与此同时，Quick Input 第二步会在显式点击预设且最终命令仍等价时保留该 preset 的 metadata，从而保证“默认命令本身已含 `--yolo`”时，显式点击 `YOLO` 仍会持久化成 `launchPreset: 'yolo'`。本轮对应回归已扩展到 `scripts/test/test-agent-launch-presets.mjs`、Playwright harness 与 VSCode smoke。
- 已更新：Codex Agent 现在和 Claude Code 一样可以从可信 provider session id 执行 `Fork`。共享命令层新增 `buildAgentBranchCommandLine()` 与 Codex fork 参数剥离逻辑；Webview 的 `分叉` 按钮按 provider + resumeStrategy 判断显示，并用 provider 文案设置 aria/title；Host 的 `branchAgentSession()` 创建同 provider custom Agent 节点，并继续只在宿主侧读取可信 session id。自动化新增 Codex 命令层、Webview、Host smoke 覆盖。本轮已通过 `npm run test:agent-launch-presets`、`npm run test:protocol-webview-messages`、`npm run test:canvas-execution-context`、`node --check tests/vscode-smoke/extension-tests.cjs`、`node --check tests/playwright/webview-harness.spec.mjs`、`npm run typecheck`、`git diff --check`，以及 focused `npm run test:webview -- --grep "Agent Fork action|forked Agent"`（3 passed）。完整 trusted smoke 已尝试运行，但在进入新增 Codex Fork helper 前被既有 editor Webview DOM 动作超时阻塞，artifact 位于 `.debug/vscode-smoke/trusted/artifacts`；真实 provider 级新 thread / session id 仍需在安装对应 CLI 的 Development Host 中人工确认。
- 已更新：按最新决策，Webview 不再识别或隐藏 fork launch 节点的标题栏状态胶囊，分叉节点停止态和运行态都会像普通 Agent 一样显示状态；`分叉` 按钮改为像 PR121 的重启动作按钮一样在按钮级别允许压缩/内部换行；标题栏 action cluster 保持 inline，避免整组换行破坏布局，同时也不再用移除状态来解决空间冲突。用户可见按钮、aria/title、Host 错误和自动派生标题同步中文化为 `分叉`，底层命令与技术语义仍保留 provider-native `fork`。
- 已更新：继续修正上一次 UI follow-up 的可观察行为。之前按钮虽然允许 `white-space: normal`，但由于两个中文字符的 `min-content` 宽度很小且按钮本身没有被压到更窄，用户把节点拉到最小宽度仍不会看到两行。现在 Webview 根据 Agent 节点宽度给标题栏动作区设置 `compact-actions` 密度，CSS 对右上角所有动作按钮应用相同内部两行格式，不让整个 action cluster 换行；Playwright 也从“只检查 white-space”升级为检查所有动作按钮的内部 label 高宽比符合两行。
- 已更新：分叉自动连线现在不再只有箭头。`extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts` 的分叉建边 helper 在创建来源 Agent 指向新 Agent 的普通 `user` 边时默认写入 `label: 'fork'`；VSCode smoke 对 Codex / Claude 两条 Host 分叉路径都补充断言：状态里的边标签为 `fork`，editor Webview probe 也应看到该标签。
- 已更新：PR159 review 指出的两个 blocker 已在文档和命令层收口。Codex 分叉命令现在会同时清理默认参数前缀与子命令尾部的旧选择参数，避免 `--last` 等参数覆盖当前可信 source session；旧 Claude-only active 计划已移到 completed 并在文件头标注历史状态，当前分叉范围只由本计划与正式规格/设计承载。
- 已更新：2026-07-01 本轮把“Fork / Resume 会话时保留其他不冲突参数配置”收口为明确清单并落地。共享命令层现在会在 Codex 显式 resume 中同时清理 leading 与子命令尾部的旧目标选择参数，同时继续保留 model、sandbox、approval、profile、config 等运行配置；Claude Code 显式 resume/fork 会清理旧 session-target 与旧 `--fork-session`，保留非 session-target 参数。Host 侧当前节点 `重启` 也复用 history resume 命令构造，并在已有完整 argv 时不再重复追加裸 resume 参数。已通过 `npm run test:agent-launch-presets` 与 `npm run test:canvas-execution-context`。
- 已更新：2026-07-01 继续把 Default args 的配置边界前移。共享命令层现在在解析 `agent.codexDefaultArgs` / `agent.claudeDefaultArgs` 时就拒绝会与 `Resume / Fork` 冲突的一次性会话目标，并把错误传给右键菜单、Quick Input 与宿主 fresh-start / history resume / branch command line；VSCode 设置描述、产品规格、设计文档、侧栏历史恢复文档与命令层测试已同步更新。
- 已更新：2026-07-02 本轮把当前节点 `重启` / `分叉` 从“只用当前 Default args”升级为“节点启动意图”。共享命令层新增 `AgentLaunchIntentOptions`，会从 `YOLO / 沙盒 / 自定义启动 / templateArgv` 中剥离旧 session target；Host 只在当前节点 resume/fork 路径传入该意图，历史恢复 / 历史分叉保持不传。已通过命令层、宿主源检查和 typecheck。
- 已更新：2026-07-04 根据真实 fork 失败诊断继续修正：当前节点 `重启` / `分叉` 不再把当前 Default args 合入节点启动意图，并优先从 `lastLaunchCommandLine` 继承该节点最近一次实际启动参数。命令层新增再次 fork 已 fork Codex 节点的回归，确保不会重复拼入 Default args 中的 `--search` / `-c sandbox_workspace_write.network_access=true`；历史恢复 / 历史分叉仍使用当前 Default args。

## 上下文与定向

当前和本任务直接相关的代码主要在以下位置：

- `extensions/vscode/dev-session-canvas/src/extension.ts`：侧栏/命令面板“创建节点”入口，目前顶层 QuickPick 直接创建，不支持第二步完整命令编辑。
- `extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts`：宿主权威状态、节点创建、Agent fresh-start / resume 执行路径。
- `extensions/vscode/dev-session-canvas/src/common/protocol.ts`：节点 metadata、runtime context 与 Host/Webview 消息协议。
- `extensions/vscode/dev-session-canvas/src/webview/main.tsx`：空白区右键菜单、Agent 节点标题栏动作、执行型节点的 Webview 行为。
- `extensions/vscode/dev-session-canvas/src/webview/styles.css`：右键菜单与标题栏按钮样式。
- `tests/playwright/webview-harness.spec.mjs`：右键菜单、节点按钮等 Webview 回归。
- `tests/vscode-smoke/extension-tests.cjs`：命令入口与宿主行为 smoke。

这里的“launchPreset”指“节点未来启动新会话时默认使用哪种预设”，可选 `default / resume / yolo / sandbox / custom`。其中 `custom` 额外持久化完整命令字符串；`resume` 表示按 provider 自己的 resume 选择入口启动新会话（`codex resume` / `claude --resume`），而不是直接恢复当前节点上一条会话。

## 工作计划

先在共享层引入 Agent 启动预设模型、命令字符串构造/解析/校验逻辑，并扩展 `protocol` 与 runtime context，让宿主、Webview、命令面板都能拿到统一的 provider 默认启动模板。然后在宿主层把节点创建、metadata 持久化和 Agent fresh-start 执行路径改成基于 `launchPreset/customLaunchCommand` 解析。Webview 侧接着扩展右键菜单三层 Agent 创建，并把停止后的单按钮改成 `新建 | 重启` 双按钮。最后再回到 `extensions/vscode/dev-session-canvas/src/extension.ts` 重写 Agent 的 Quick Input 创建链路，并为测试保留脚本化 override。

## 具体步骤

1. 在 `extensions/vscode/dev-session-canvas/src/common/` 中新增 Agent 启动预设模块，并扩展 `extensions/vscode/dev-session-canvas/src/common/protocol.ts` 中的 metadata/runtime/message 类型。
2. 在 `extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts` 中：
   - 扩展 `createNode` / `applyCreateNode` / metadata 正规化，持久化 Agent 启动预设。
   - 为 Agent fresh-start 解析完整命令，再接入现有 resolver 与 spawn 路径。
   - 扩展 runtime context，把 provider 默认启动参数下发到 Webview。
3. 在 `extensions/vscode/dev-session-canvas/src/webview/main.tsx` 与 `extensions/vscode/dev-session-canvas/src/webview/styles.css` 中：
   - 把右键菜单扩成 root/provider/launch-mode 三层。
   - 实现自定义启动输入与校验。
   - 实现停止后 `新建 | 重启` 双按钮。
4. 在 `extensions/vscode/dev-session-canvas/src/extension.ts` 中重写 Agent 创建 Quick Input 第二步，并更新 test override。
5. 在 `tests/playwright/webview-harness.spec.mjs` 与 `tests/vscode-smoke/extension-tests.cjs` 中补回归，至少覆盖 `codex resume` / `claude --resume` 提示 parser，以及“无可信恢复上下文 => 标题栏只显示 `启动`”。
6. 跑 `npm run typecheck`、`npm run test:webview`，再根据时间与稳定性决定是否补 `npm run test:smoke`。
7. Codex Fork follow-up：在 `extensions/vscode/dev-session-canvas/src/common/agentLaunchPresets.ts` 中新增 provider-neutral Fork command builder，Codex 分支生成 `codex fork <session-id>` 并剥离旧 `resume` / `fork` 选择目标；在 `extensions/vscode/dev-session-canvas/src/webview/main.tsx` 中把分叉按钮从 Claude-only 改成 Codex / Claude Code provider-native 判断；在 `extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts` 中让 `branchAgentSession()` 根据来源节点 provider 创建同 provider 新节点；同步补命令层、Playwright 与 VSCode smoke 回归。
8. 分叉 UI follow-up：把用户可见按钮文案、派生标题与错误提示改为 `分叉`；移除 Webview 对 fork launch 节点隐藏标题栏状态的特判；更新 Playwright 覆盖，确认分叉节点在停止 / 运行状态均显示状态胶囊，且 `分叉` 按钮采用 PR121 式按钮级压缩/内部换行，action cluster 不整组换行。实现中应确保右上角所有动作按钮在接近最小宽度时真实呈现为按钮内部两行，而不是只在 CSS 上允许换行。
9. 分叉边标签 follow-up：在 `extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts` 的分叉自动建边路径中默认写入 `label: 'fork'`；更新 VSCode smoke，确认 Codex / Claude 分叉后宿主状态和 Webview probe 都能看到 `fork` 标签；同步更新产品规格、设计文档与本计划。
10. PR159 review follow-up：在 `extensions/vscode/dev-session-canvas/src/common/agentLaunchPresets.ts` 中让 Codex 分叉命令对 leading args 和 subcommand args 使用同一套 fork selection stripping；在 `scripts/test/test-agent-launch-presets.mjs` 中补充 leading `--last`、`--all`、`--include-non-interactive` 与旧 positional target 的回归；将旧 `claude-agent-branch.md` 移入 completed，并在 active 计划中记录当前 Codex / Claude Code 分叉事实。
11. 当前节点启动意图继承 follow-up：在 `extensions/vscode/dev-session-canvas/src/common/agentLaunchPresets.ts` 中让显式 resume/fork builders 接受可选 `AgentLaunchIntentOptions`；在 `extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts` 中仅对当前节点 `重启` / `分叉` 传入 metadata 启动意图；补 `scripts/test/test-agent-launch-presets.mjs` 与 `scripts/test/test-canvas-execution-context.mjs` 回归，确认历史入口不误继承。

## 验证与验收

- 运行 `npm run typecheck`，预期通过。
- 运行 `npm run test:webview`，预期新增的右键菜单、`新建 | 重启` 双按钮，以及“不可恢复时退化为启动按钮”用例通过。
- 如果 smoke 可跑，运行 `npm run test:smoke`，至少确认命令面板的 Agent 两步创建链路通过。
- 若 smoke 因既有不稳定项受阻，需要在 `结果与复盘` 与最终交付说明中明确写清阻塞点和已验证范围。
- Codex Fork follow-up 已运行 `npm run test:agent-launch-presets`、`npm run test:protocol-webview-messages`、`npm run test:canvas-execution-context`、`npm run typecheck`，以及 focused `npm run test:webview -- --grep "Agent Fork action|forked Agent"`；VSCode smoke 已新增 Codex Fork helper 覆盖 Host 创建、user edge 和 `execution/started.launchArgs`，但完整 trusted smoke 当前被既有 editor Webview DOM 动作超时阻塞，未进入该 helper。
- 分叉 UI follow-up 已重新运行 focused Webview / 命令层 / 执行上下文 / typecheck / diff check；结果确认标题栏状态胶囊恢复、`分叉` 文案覆盖和 PR121 式按钮级换行契约通过。2026-06-14 又补跑 focused Webview，确认 `compact-actions` 下右上角所有动作按钮真实两行显示且 action cluster 仍为 `nowrap`。
- 分叉边标签 follow-up 需要通过 `scripts/test/test-canvas-node-groups.mjs` 的 helper 级断言、`tests/vscode-smoke/extension-tests.cjs` 的 Codex / Claude Host 分叉断言、`npm run typecheck` 与 diff whitespace 检查；若完整 smoke 不跑全，必须说明本次只更新了现有 helper 与 smoke 断言，未额外重新跑完整 Development Host。
- PR159 review follow-up 需要通过 `npm run test:agent-launch-presets` 验证新增 leading 参数清理回归，并至少补跑 `npm run test:canvas-execution-context`、`npm run test:canvas-node-groups`、`npm run typecheck`、Playwright / VSCode smoke 语法检查、focused `Agent title action buttons` Webview 回归、conflict marker 搜索与 diff whitespace 检查。
- 当前节点启动意图继承 follow-up 需要通过 `npm run test:agent-launch-presets`、`npm run test:canvas-execution-context`、`npm run typecheck` 与 `git diff --check`；若未跑真实 provider CLI，最终说明中应明确真实 `codex fork` / `claude --fork-session` 的 provider 级效果仍沿用既有人工验证口径。

## 幂等性与恢复

- 新增的共享命令解析逻辑应是纯函数，可重复调用，不写外部状态。
- 若右键菜单或 Quick Input UI 行为调试中断，可通过 Playwright harness / test override 重放，不需要手工重置仓库状态。
- 若 smoke 中断，不要回滚用户已有变更；只记录阻塞点并保留通过的更小验证范围。

## 证据与备注

- 2026-04-24：`npm run build` 通过。
- 2026-04-24：`npm run typecheck` 通过。
- 2026-04-24：`node --check tests/vscode-smoke/extension-tests.cjs` 通过。
- 2026-04-24：`bash -n tests/vscode-smoke/fixtures/fake-agent-provider` 通过。
- 2026-04-24：`npm run test:webview` 通过，当前为 `82 passed`。
- 2026-04-24：`npm run test:webview -- --grep "agent restart"` 通过，当前为 `2 passed`。
- 2026-04-25：`npm run test:webview -- --grep "exit preserves buffered tail output|applies the final snapshot before rendering the exit banner|agent restart action falls back to start button when no resumable session exists"` 通过，当前为 `5 passed`。
- 2026-04-25：`node --check tests/vscode-smoke/extension-tests.cjs` 通过（本轮新增 smoke 断言覆盖“stop 按钮保留 token usage/resume hint”与“completed live-runtime reload 后保持 stopped/closed”）。
- 2026-04-25：本轮新增 `locateClaudeSessionId` 测试命令与 smoke 级 locator 覆盖，用于验证 `~/.claude/projects/.../<session-id>.jsonl` 文件确认路径。
- 2026-04-25：本轮新增命令创建节点 Quick Input 第二步的 smoke 回归：仅选择 `Resume / YOLO / 沙盒` 不会创建节点，只有显式 `accept-current` 才会创建。
- 2026-04-25：本轮把 Quick Input 第二步的 smoke 回归更新为覆盖 `默认` 快捷替换项，确认仅点击该项不会创建节点。
- 2026-04-25：本轮新增 Playwright 回归，覆盖 Agent 副标题显示最近一次实际启动指令，以及超长指令被截断时通过 hover/title 暴露完整文本。
- 2026-04-25：本轮新增 `scripts/test/test-agent-launch-presets.mjs`，覆盖 provider 命令校验与 Claude `--flag=value` 显式 session flag 识别。
- 2026-04-25：本轮把 `scripts/test/test-agent-launch-presets.mjs` 继续扩展为覆盖“拒绝同 basename 的其他绝对路径”和 Claude 显式 session id 解析；smoke 侧新增基于预写入 transcript 文件的 Claude 显式 session id 保留恢复上下文回归。
- 2026-04-24：`npm run test:smoke` 需要在沙箱外运行；提权后 trusted 场景长时间停留在 VS Code 宿主空转状态，因此已中止该轮补跑，待后续单独排查。
- 2026-04-26：已运行 `npm run test:agent-launch-presets`，通过；本轮新增覆盖 Windows 路径解析、默认启动参数 parse error 显式报错，以及 invalid default args 下 custom 命令仍会被持久化为 `custom`。
- 2026-04-26：已运行 `npm run typecheck`、`npm run build`、`node --check tests/playwright/webview-harness.spec.mjs`、`git diff --check`，均通过。
- 2026-04-26：本轮继续把 canonical formatter 改成单引号优先后，已重新运行 `npm run test:agent-launch-presets`，新增覆盖 `--prompt '\\" a'` 的 build+validate 主路径，以及直接输入 `codex --prompt "\\\" a"` 的 parser/validator 回归，均通过。
- 2026-04-26：继续排查 Playwright harness 超时后，已定位根因为共享命令校验逻辑在 Webview bundle 中直接读取 `process.platform`，导致右键菜单渲染 `CanvasContextMenu` 时抛出 `process is not defined`。修复后已重新运行 `npm run test:webview -- --grep "right-click custom agent launch input|validates custom agent launch commands before creating"` 与 `npm run test:webview -- --grep "right-click create menu"`，均通过。
- 2026-04-26：本轮继续补了 `formatCommandLine()` / `parseCommandLine()` 的 Windows 尾部反斜杠 round-trip 回归：`npm run test:agent-launch-presets`、`npm run build` 与 `npm run test:webview -- --grep "right-click create menu|right-click custom agent launch input"` 均通过。
- 2026-04-26：本轮按“结构化 argv + Windows quoting 兼容层”再次完成验证：`npm run test:agent-launch-presets`、`npm run typecheck`、`npm run build`、`npm run test:webview -- --grep "right-click create menu|right-click custom agent launch input"` 与 `git diff --check` 均通过；新增回归覆盖 quoted UNC 与旧 formatter 输出兼容。
- 2026-04-26：本轮继续补了“用户直接输入自然写法”的 Windows 尾部反斜杠回归，确认 `codex --config "C:\\Users\\me\\My Dir\\"` 与默认参数里的同类 quoted path 都能被 parser / validator 接受；`npm run test:agent-launch-presets`、`npm run typecheck`、`npm run build` 与 `npm run test:webview -- --grep "right-click create menu|right-click custom agent launch input"` 均通过。
- 2026-04-26：本轮继续补了单段 relative / drive-relative path 的 Windows 尾部反斜杠回归，确认 `codex --config "My Dir\\"` 与 `codex --config "C:My Dir\\"` 这类自然输入也能被 parser / validator 接受，并能进入默认参数模板构造链路；`npm run test:agent-launch-presets`、`npm run typecheck`、`npm run build` 与 `npm run test:webview -- --grep "right-click create menu|right-click custom agent launch input"` 均通过。
- 2026-04-26：本轮继续补了 quoted UNC 与“旧 formatter 输出兼容”回归，确认 `codex --config "\\\\server\\share\\My Dir\\"`、`"\\\\server\\share\\Codex\\codex.exe" --yolo`，以及历史文本 `"C:\\\\Program Files\\\\Codex\\\\codex.exe" --yolo` 都能被 parser / validator 正确接受；`npm run test:agent-launch-presets` 已通过。
- 2026-04-29：本轮新增“模式 flag 归一化 + 显式 preset 意图保留”回归：`scripts/test/test-agent-launch-presets.mjs` 覆盖 `--sandbox ...` / `--ask-for-approval ...` / `--full-auto` / `--permission-mode ...` 与 `YOLO` / `沙盒` 的互斥归一化，以及“默认命令已含 `--yolo`”时 `default` 与显式 `yolo` 同时等价的判定；`tests/playwright/webview-harness.spec.mjs` 新增右键三级菜单文案断言；`tests/vscode-smoke/extension-tests.cjs` 新增 QuickPick 在冲突默认参数下仍持久化 `launchPreset: 'yolo'` 的 smoke。
- 2026-04-29：补记本轮 follow-up 验证：再次运行 `npm run test:agent-launch-presets`、`npm run typecheck` 与 targeted `npm run test:webview -- --grep "right-click create menu|right-click launch preset descriptions normalize conflicting default launch mode flags"`，均通过；其中新增用例已覆盖 Codex 默认参数里同时存在 `--sandbox ...` 与 `--ask-for-approval ...` 时显式 `YOLO` 不再生成冲突命令。
- 2026-04-29：根据 review follow-up 继续补齐 Codex 归一化边界：命令层保留 `resume --last` / `resume <session-id>` 这类 resume 子命令片段，因为它们与执行策略参数不互斥；同时继续补上 `-s=...` / `-a=...` 的短选项赋值写法归一化。已重新运行 `npm run test:agent-launch-presets`、`npm run typecheck` 与 targeted `npm run test:webview -- --grep "right-click create menu|right-click launch preset descriptions normalize conflicting default launch mode flags"`，均通过。
- 2026-04-29：继续按最新 review 收口 resume 语义边界：`YOLO / 沙盒` 现在会保留 `Codex resume --last/<session-id>` 与 `Claude --resume/--continue/--session-id` 这类会话选择片段，只覆盖执行策略 flag；显式 `Resume` 预设则会反向剥离这些定向目标，统一生成 `codex resume` / `claude --resume`。相关回归已补到 `scripts/test/test-agent-launch-presets.mjs` 与 `tests/playwright/webview-harness.spec.mjs`。
- 2026-04-29：继续按 review 收口 formal spec 文案：正式产品规格、设计文档与右键菜单说明文案已明确改成“只覆盖仓库当前已知的一小组冲突模式参数；更复杂组合请走自定义启动”，避免后续协作者把现状误读成通用参数归一化框架。相关 Playwright 断言已同步覆盖这段用户可见文案。
- 2026-04-29：继续补齐 Resume 归一化的 CLI 边界：Codex 侧把 `--local-provider <value>` 也纳入“会吞掉后一个 token”的已知官方选项集合，避免 `resume --last` 被误留；Claude 侧把 `-r` / `-c` 短别名也纳入 resume target stripping。相关命令层回归已补到 `scripts/test/test-agent-launch-presets.mjs`。
- 2026-04-29：继续修补 Claude 短别名在实际启动链路中的分叉：`extractClaudeCommandSessionFlag()` 现在会把 `-r` / `-c` 及其 `-r=<id>` / `-c=<id>` 形式统一映射回 canonical flag，确保 host 的 resumeContext 推导、launchSpec 拼装和 runtime supervisor 的初始 session id 识别都不会再额外补写一份 `--session-id`。相关提取器回归已补到 `scripts/test/test-agent-launch-presets.mjs`。
- 2026-04-30：按 PR30 最新 review 继续收口 `Resume` / history restore 的命令拼装：Codex 侧不再在遇到 `resume` 后直接截断整个尾部，而是只剥离 `--last` / 旧 session target，并保留 `--sandbox`、`--ask-for-approval`、`--model` 等对 `codex resume` 仍有效的参数。随后又根据产品规格补充更严格的 explicit-session-id 边界：创建前 `Resume` 预设仍可保留 `--all` / `--include-non-interactive` 这类 picker 修饰，但历史会话恢复这类已知目标 `session-id` 的命令会主动剥离它们，避免把“显式恢复某条会话”与“继续影响 picker / --last 选择范围”混在一起。相关回归已补到 `scripts/test/test-agent-launch-presets.mjs`。
- 2026-06-13：Codex Fork follow-up 已完成验证：`npm run test:agent-launch-presets`、`npm run test:protocol-webview-messages`、`npm run test:canvas-execution-context`、`node --check tests/vscode-smoke/extension-tests.cjs`、`node --check tests/playwright/webview-harness.spec.mjs`、`npm run typecheck`、`git diff --check`、focused `npm run test:webview -- --grep "Agent Fork action|forked Agent"`（3 passed）均通过。完整 `DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=trusted npm run test:smoke` 已尝试运行，但在进入新增 Codex Fork helper 前被既有 `等待 editor Webview DOM 动作返回超时（10000ms）` 阻塞，artifact 位于 `.debug/vscode-smoke/trusted/artifacts`。
- 2026-06-13：分叉 UI follow-up 已完成验证：`npm run test:webview -- --grep "Agent Fork action|forked Agent"`（3 passed）、`npm run test:agent-launch-presets`、`npm run test:canvas-execution-context`、`npm run typecheck`、`node --check tests/playwright/webview-harness.spec.mjs`、`node --check tests/vscode-smoke/extension-tests.cjs`、`git diff --check` 均通过。完整 trusted smoke 仍沿用上一条记录中的既有阻塞，不作为本次中文文案与状态显示调整的必跑项。
- 2026-06-14：标题栏动作按钮内部换行修正已运行 `npm run test:webview -- --grep "Agent Fork action|forked Agent|Agent title action buttons"`（4 passed）、`node --check tests/playwright/webview-harness.spec.mjs`、`npm run typecheck`、`npm run test:agent-launch-presets`、`npm run test:canvas-execution-context`、`node --check tests/vscode-smoke/extension-tests.cjs` 与 `git diff --check`，均通过。
- 2026-06-14：分叉边标签 follow-up 已运行 `npm run test:canvas-node-groups`、`npm run test:canvas-execution-context`、`npm run typecheck`、`node --check tests/vscode-smoke/extension-tests.cjs`、`node --check tests/playwright/webview-harness.spec.mjs`、focused `npm run test:webview -- --grep "manual edges can be created, selected, edited, and deleted|edge label text color follows the rendered edge color"` 与 `git diff --check`，均通过。本轮未重新跑完整 `npm run test:smoke`；VSCode smoke 文件已补 Codex / Claude 分叉边标签断言，实际 Development Host 端到端仍沿用既有完整 smoke 阻塞记录。
- 2026-06-14：PR159 review follow-up 已运行 `npm run test:agent-launch-presets`、`npm run test:protocol-webview-messages`、`npm run test:canvas-execution-context`、`npm run test:canvas-node-groups`、`npm run typecheck`、`node --check tests/vscode-smoke/extension-tests.cjs`、`node --check tests/playwright/webview-harness.spec.mjs`、focused `npm run test:webview -- --grep "Agent title action buttons"`、conflict marker 搜索与 diff whitespace 检查，均通过。
- 2026-07-01：Default args 会话目标冲突前置校验已运行 `npm run test:agent-launch-presets`，通过；新增/调整回归覆盖 Codex `resume` / `fork` / `--last` / positional token 与 Claude `--resume` / `--continue` / `--session-id` / `--fork-session` 被默认参数解析拒绝，同时保留 model、sandbox、approval、profile、permission-mode 等非冲突配置。
- 2026-07-02：当前节点启动意图继承已运行 `npm run test:agent-launch-presets`、`npm run test:canvas-execution-context` 与 `npm run typecheck`，均通过；新增回归覆盖 Codex / Claude `YOLO` 当前节点 resume/fork、自定义 Codex 命令覆盖默认 model/mode、模板 argv 清理旧 resume target，以及历史恢复 / 历史分叉不传节点意图的宿主源检查。

## 接口与依赖

本次新增或修改的关键接口应包括：

- `extensions/vscode/dev-session-canvas/src/common/protocol.ts`
  - `AgentNodeMetadata.launchPreset`
  - `AgentNodeMetadata.customLaunchCommand`
  - `CanvasRuntimeContext.agentLaunchDefaults`
  - `webview/createDemoNode` 与 `host/requestCreateNode` 的 Agent 启动参数字段
- `extensions/vscode/dev-session-canvas/src/common/<new module>.ts`
  - 构造 provider 预设命令
  - 解析完整命令字符串
  - 校验输入命令是否属于当前 provider
  - 从输入内容反推预设/自定义
  - 构造 provider-native Fork 命令：Codex 为 `codex fork <session-id>`，Claude Code 为 `claude --resume <session-id> --fork-session`
- `extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts`
  - Agent fresh-start 路径新增“命令字符串 -> resolver -> spawn args”解析
- `extensions/vscode/dev-session-canvas/src/extension.ts`
  - Agent 创建 Quick Input 第二步
- `extensions/vscode/dev-session-canvas/src/webview/main.tsx`
  - 右键菜单 launch-mode drill-in
  - Agent `新建 | 重启` 双按钮

本次更新说明：2026-04-29 补记“显式预设覆盖默认模式参数 + Quick Input 保留显式 preset 意图”的实现收口、决策与验证证据，避免右键三级菜单与 QuickPick 在冲突默认参数下继续漂移。

本次更新说明：2026-05-18 按最新反馈把停止后 Agent 标题栏从下拉式 split restart 改为 `新建 | 重启` 双按钮，并同步更新规格、设计与 Playwright harness 覆盖；已运行 `npm run test:webview -- --grep "agent restart"`（3 passed）与 `npm run typecheck`，均通过。

本次更新说明：2026-06-13 将 Agent `Fork` 的正式支持范围从 Claude Code 扩展到 Codex / Claude Code；Codex 使用当前已确认稳定的 `codex fork <session-id>`，并同步更新产品规格、设计、命令层、Webview、Host smoke 与本计划的活文档记录。

本次验证说明：2026-06-13 已完成 Codex Fork 的命令层、Webview、Host smoke 静态检查、typecheck 与 focused Webview 回归；完整 trusted smoke 仍被既有 editor Webview DOM 动作超时阻塞，未形成新增 Codex Fork helper 的端到端绿灯。

本次更新说明：2026-06-13 按最新决策恢复分叉节点标题栏状态胶囊，并把用户可见动作文案收口为中文 `分叉`；窄节点标题栏依赖按钮级压缩/内部换行，不让 action cluster 整组换行，也不再隐藏状态。

本次验证说明：2026-06-13 已完成分叉 UI follow-up 的 focused Webview、命令层、执行上下文、typecheck、JS 语法检查和 diff whitespace 检查；完整 trusted smoke 未重复运行，继续引用本日 Codex Fork follow-up 中记录的既有 editor Webview DOM 动作超时阻塞。

本次更新说明：2026-06-14 将右上角动作按钮内部换行从“允许换行”收口为“节点接近最小宽度时统一实际两行显示”，避免中文短文案被 `min-content` 宽度保护后始终不触发可见换行。

本次验证说明：2026-06-14 已完成 focused Webview 回归、Playwright / VSCode smoke 语法检查、typecheck、命令层与执行上下文脚本回归、diff whitespace 检查，确认右上角所有动作按钮两行紧凑显示、状态胶囊保留、action cluster 不整组换行。
本次更新说明：2026-06-14 将分叉自动连线从“仅有箭头”收口为“普通 `user` 边 + 默认 `fork` 标签”，让画布关系在视觉上直接表达分叉语义，同时继续不引入正式 branch lineage。
本次验证说明：2026-06-14 已完成分叉边标签 follow-up 的 helper 级回归、执行上下文脚本回归、typecheck、Playwright / VSCode smoke 语法检查、focused Webview 连线标签渲染回归与 diff whitespace 检查；完整 VSCode smoke 未重新运行，继续沿用既有 Development Host 阻塞记录。
本次更新说明：2026-06-14 按 PR159 review 收口 Codex 分叉命令的参数边界，并将旧 Claude-only 分叉 ExecPlan 从 active 移入 completed；当前 Codex / Claude Code 分叉事实只在本 active 计划和正式规格/设计文档中维护。
本次验证说明：2026-06-14 已完成命令层、协议、执行上下文、节点分组、typecheck、Playwright / VSCode smoke 语法检查、focused 标题栏按钮 Webview 回归、conflict marker 搜索与 diff whitespace 检查。

本次更新说明：2026-07-01 明确并实现显式 `Resume / Fork` 的冲突/不冲突配置继承清单，原因是用户要求 fork/resume 会话时保留其他不冲突参数配置。

本次更新说明：2026-07-02 补齐当前节点 `重启` / `分叉` 对节点启动意图的继承，同时明确历史会话记录没有原始 argv，历史恢复 / 分叉仍只使用当前 Default args。

本次更新说明：2026-07-04 根据真实 fork 失败诊断修正当前节点启动意图边界：当前节点 `重启` / `分叉` 只使用节点最近一次实际启动命令或节点长期启动偏好，不再合并当前 Default args；历史恢复 / 分叉仍只使用当前 Default args。

本次验证说明：2026-07-04 已完成 `npm run test:agent-launch-presets`、`npm run typecheck` 与 `git diff --check`，覆盖再次 fork 已 fork Codex 节点时不会重复拼入 Default args 中的 `--search` / `-c`。
