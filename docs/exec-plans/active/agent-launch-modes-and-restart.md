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

- 决策：Claude Code fresh-start 继续在启动时注入候选 `--session-id`，但 stopped 节点是否可恢复必须以后续输出里的 `claude --resume <session-id>` 提示为准；若停止后没有这条提示，则节点 UI 退化为单个 `启动` 按钮，不再显示 disabled 的 split restart。
  理由：用户已经确认 Claude “启动时带 session-id”不等于“该 session-id 一定生效”；只有 CLI 自己在结束时回显 `claude --resume` 才能证明当前节点真的具备恢复入口。UI 也应只在确实可恢复时才暴露 `重启 | ▼`。
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

## 结果与复盘

- 已更新：需求已从临时文件迁入正式 docs；本轮又按新增反馈把创建前 `Resume` 改成 provider 自带 resume 选择入口，并保留“停止后重启 = 恢复当前节点上一条会话”的语义。针对 Codex 停止后重启不稳的问题，当前实现已改回“启动后继续扫文件”，并让停止路径先发 `Ctrl-C`、等待 `Token usage` / `codex resume <session-id>` 输出，再用它补充或校验 session id；Claude 先前则改成停止后必须看到 `claude --resume <session-id>` 才算真正可恢复，否则标题栏直接回退成单个 `启动` 按钮。针对“live 节点 stop 时尾部提示不显示、reload 后才出现”的问题，又补上了 host final snapshot + Webview 顺序化 terminal 写入的组合修复，并新增 Playwright 用例覆盖“尾部输出先于 exit banner”和“final snapshot 先于 exit banner”的回归场景。随后 stop 语义继续收口：已完成的 live-runtime 会话在宿主状态里会降级成 `snapshot-only`，使 reload 后继续显示 `stopped/closed`，而不是误导性的 `history-restored`；resume metadata 发现链路也继续细化成“Codex 在运行态再次回到 `waiting-input` 且仍未拿到 session id 时补扫 `~/.codex/sessions`，Claude 则新增 `~/.claude/projects/.../<session-id>.jsonl` 文件确认”。当前 stop 行为再次回到 provider-specific：Codex 标题栏停止按钮发送单次 `Ctrl-C` 并保留 5 秒 graceful-stop 兜底，Claude 则恢复更早版本的直接终止信号路径，不再发送 `Ctrl-C`。同时，命令面板 / 侧栏 `创建节点` 第二步 Quick Input 的行为也重新和规格对齐：点击 `默认 / Resume / YOLO / 沙盒` 只会改写顶部完整命令输入，必须显式按 Enter 才会真正创建节点；脚本化 QuickPick override 不再把“仅选择预设”误当成创建。当前已经完成 `npm run typecheck`、`npm run build`、`node --check tests/vscode-smoke/extension-tests.cjs`、`bash -n tests/vscode-smoke/fixtures/fake-agent-provider`；更大范围 end-to-end smoke 仍待条件允许时补跑。
- 已更新：需求已从临时文件迁入正式 docs；本轮又按新增反馈把创建前 `Resume` 改成 provider 自带 resume 选择入口，并保留“停止后重启 = 恢复当前节点上一条会话”的语义。针对 Codex 停止后重启不稳的问题，当前实现已改回“启动后继续扫文件”，并让停止路径先发 `Ctrl-C`、等待 `Token usage` / `codex resume <session-id>` 输出，再用它补充或校验 session id；Claude 先前则改成停止后必须看到 `claude --resume <session-id>` 才算真正可恢复，否则标题栏直接回退成单个 `启动` 按钮。针对“live 节点 stop 时尾部提示不显示、reload 后才出现”的问题，又补上了 host final snapshot + Webview 顺序化 terminal 写入的组合修复，并新增 Playwright 用例覆盖“尾部输出先于 exit banner”和“final snapshot 先于 exit banner”的回归场景。随后 stop 语义继续收口：已完成的 live-runtime 会话在宿主状态里会降级成 `snapshot-only`，使 reload 后继续显示 `stopped/closed`，而不是误导性的 `history-restored`；resume metadata 发现链路也继续细化成“Codex 在运行态再次回到 `waiting-input` 且仍未拿到 session id 时补扫 `~/.codex/sessions`，Claude 则新增 `~/.claude/projects/.../<session-id>.jsonl` 文件确认”。当前 stop 行为再次回到 provider-specific：Codex 标题栏停止按钮发送单次 `Ctrl-C` 并保留 5 秒 graceful-stop 兜底，Claude 则恢复更早版本的直接终止信号路径，不再发送 `Ctrl-C`。同时，命令面板 / 侧栏 `创建节点` 第二步 Quick Input 的行为也重新和规格对齐：点击 `默认 / Resume / YOLO / 沙盒` 只会改写顶部完整命令输入，必须显式按 Enter 才会真正创建节点；脚本化 QuickPick override 不再把“仅选择预设”误当成创建。另一个同步收口是：`agent.codexDefaultArgs` / `agent.claudeDefaultArgs` 现在使用 `window` scope，允许在窗口 / 工作区层直接配置与覆盖。最新一轮又把 Agent 节点副标题改成显示当前节点最近一次实际启动指令，并在文本被截断时通过 hover 浮窗暴露完整指令；尚未真正启动过的节点则回退显示按当前 metadata 与设置推导出的下一次 fresh-start 指令。当前已经完成 `npm run typecheck`、`npm run build`、`node --check tests/vscode-smoke/extension-tests.cjs`、`bash -n tests/vscode-smoke/fixtures/fake-agent-provider`；更大范围 end-to-end smoke 仍待条件允许时补跑。
- 已更新：针对 review finding，又补上两层宿主兜底。其一，`agentCustomLaunchCommand` 现在在创建消息落盘前和 fresh-start 真正执行前都会重新按 provider 规则校验，伪造 `agentProvider: "claude"` + `node -e ...` 之类的 payload 会直接被拒绝，不会再走 resolver / spawn。其二，Claude 自定义启动里若已显式写入 `--session-id` / `--resume` / `--continue`，无论采用空格分隔还是 `--flag=value`，宿主都不会再重复追加第二份 session 参数；同时 smoke 里的 `verifyClaudeStopRestoresPreviousSignal` 也已改回与当前 stop 语义一致的断言。
- 已更新：本轮继续补齐 review 收尾。provider 校验已经从“同 basename 也算合法”改成“只认当前设置值本身或标准别名”，避免 `/tmp/evil/claude` 之类的同名二进制绕过。Claude 的显式 session id 也不再只停留在 launch args 里：host 在构建 `resumeContext` 时会直接提取真实 session id，runtime supervisor 在 createSession 时也会用同一逻辑兜底，因此 `claude --session-id=<id>` 这类 fresh-start 能继续通过 provider transcript 文件确认，stop 后保留 `重启 | ▼`。同时，trusted smoke 里的 Claude stop 用例改成使用 PATH 中的 `claude` 标准别名，避免再和 “测试环境默认 command 指向 missing-agent-provider” 的校验规则冲突。

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
5. 在 `tests/playwright/webview-harness.spec.mjs` 与 `tests/vscode-smoke/extension-tests.cjs` 中补回归，至少覆盖 `codex resume` / `claude --resume` 提示 parser，以及“无可信恢复上下文 => 标题栏只显示 `启动`”。
6. 跑 `npm run typecheck`、`npm run test:webview`，再根据时间与稳定性决定是否补 `npm run test:smoke`。

## 验证与验收

- 运行 `npm run typecheck`，预期通过。
- 运行 `npm run test:webview`，预期新增的右键菜单、split restart，以及“不可恢复时退化为启动按钮”用例通过。
- 如果 smoke 可跑，运行 `npm run test:smoke`，至少确认命令面板的 Agent 两步创建链路通过。
- 若 smoke 因既有不稳定项受阻，需要在 `结果与复盘` 与最终交付说明中明确写清阻塞点和已验证范围。

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
- 2026-04-25：本轮新增 `scripts/test-agent-launch-presets.mjs`，覆盖 provider 命令校验与 Claude `--flag=value` 显式 session flag 识别。
- 2026-04-25：本轮把 `scripts/test-agent-launch-presets.mjs` 继续扩展为覆盖“拒绝同 basename 的其他绝对路径”和 Claude 显式 session id 解析；smoke 侧新增基于预写入 transcript 文件的 Claude 显式 session id 保留恢复上下文回归。
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
