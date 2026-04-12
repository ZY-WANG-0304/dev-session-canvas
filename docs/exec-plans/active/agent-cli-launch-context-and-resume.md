# 重写 Agent CLI 启动上下文与恢复身份设计

本 `ExecPlan` 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘`。

本文件遵循 `docs/PLANS.md` 的要求持续维护。

## 目标与全局图景

当前插件已经能在画布中自动启动 `Agent`，但真实体验和用户预期发生了偏差：用户在 repo 里创建 `Agent`，本意是让 `Codex`、`Claude Code` 或其他编程 CLI 在这个 repo 里工作，并继续沿用自己已经配好的 CLI 配置、认证和项目级规则。当前实现却把 `Codex` 强行切到扩展私有的 `CODEX_HOME`，再用 `resume --last` 猜“最近一次会话”，结果既破坏了用户配置，也把“当前节点恢复的是哪个会话”变成了不可靠的推断。

本计划要把这部分重新收口成正式设计：`Agent` 必须在 repo/workspace 目录启动；设置项只负责选择 CLI 可执行文件，不负责重写 provider 的用户配置根；自动恢复只能建立在 provider 原生的显式 session identity 之上，而不能建立在“最近一次会话”这种环境敏感推断之上。完成后，下一位实现者应能据此把当前 `codex-home + resume --last` 路线替换为“repo cwd + 继承用户配置 + 显式 session resume”的正式主路径。

## 进度

- [x] 2026-04-12 20:25+08:00 读取 `docs/WORKFLOW.md`、`docs/PLANS.md` 与 `docs/DESIGN.md`，确认这是需要正式设计文档和设计阶段 `ExecPlan` 的复杂设计工作。
- [x] 2026-04-12 20:25+08:00 梳理当前实现、现有设计文档与产品规格，确认当前 `Agent` 恢复设计把 `Codex` 绑定到了扩展私有 `CODEX_HOME`，并使用 `resume --last`。
- [x] 2026-04-12 20:25+08:00 核对真实 CLI 事实：本机 `claude --help` 已确认 `--session-id` 与 `--resume [value]`；OpenAI 官方 Codex CLI 文档已确认 `codex resume [SESSION_ID]` / `--last` 与 `~/.codex/config.toml`、`<repo>/.codex/config.toml` 两层正式配置。
- [x] 2026-04-12 20:25+08:00 新建设计文档并修订相关规格，把“repo cwd 启动、继承用户 CLI 配置、显式 session resume”写成正式结论。
- [x] 2026-04-12 20:45+08:00 把“更健壮的宿主侧编程 CLI 定位”补入正式设计，明确命令发现优先级、宿主归属和失败诊断边界。
- [x] 2026-04-12 21:06+08:00 依照本计划修改实现：引入宿主侧 CLI resolver，移除 `resumeStoragePath -> CODEX_HOME` 的正式产品语义，把 `resume-ready` 改为显式 session identity 驱动，并将 `Codex` 默认恢复能力收口为“仅在显式 session id 已知时才支持自动 resume”。
- [x] 2026-04-12 21:08+08:00 依照本计划补验证：通过 `npm run typecheck`、`npm run build`、`DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=trusted node scripts/run-vscode-smoke.mjs` 与 `DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=real-reopen node scripts/run-vscode-smoke.mjs`。
- [x] 2026-04-12 21:24+08:00 补充 session identity 获取约束：如果后续临时参考 OpenCove 那类启动后反查 session id 的路线，必须明确登记为“provider 缺少标准接口下的技术债务 fallback”，不能伪装成正式自动恢复能力。
- [x] 2026-04-12 15:32+08:00 为 `Codex` 实现最小化技术债务 fallback：按 OpenCove 类思路扫描 `~/.codex/sessions/.../rollout-*.jsonl`，仅在 `cwd + 启动时间窗 + 候选唯一` 同时满足时回填 session id，并同步补齐 local/supervisor 两条运行链路与 smoke 自动化覆盖。

## 意外与发现

- 观察：当前代码并没有忽略 `devSessionCanvas.agent.codexCommand`；真正破坏用户已有 `Codex` 配置的是启动阶段无条件改写了 `CODEX_HOME`。
  证据：`src/panel/CanvasPanelManager.ts` 当前会先读取 `agentCodexCommand` 作为命令路径，再在 `buildAgentLaunchSpec()` 中把 `env.CODEX_HOME` 指向扩展私有目录。

- 观察：当前 `Agent` 的工作目录本来就是 repo/workspace 根目录，问题不在 `cwd`，而在 provider 配置根被切到了扩展私有目录。
  证据：`src/panel/CanvasPanelManager.ts` 里的 `getTerminalWorkingDirectory()` 返回 workspace root，`buildAgentLaunchSpec()` 会沿用这个 `cwd`。

- 观察：`Claude Code` 的显式 session identity 入口已经足够明确，本机 `claude --help` 同时暴露了 `--session-id <uuid>` 和 `--resume [value]`。
  证据：2026-04-12 在仓库根目录执行 `claude --help`，输出中包含 `--session-id <uuid>` 与 `-r, --resume [value]`。

- 观察：OpenAI 官方 Codex CLI 文档已经把“按显式 session id 恢复”和“恢复最近一次会话”区分成两个不同入口，因此 `resume --last` 不能再被当成节点级自动恢复的正式语义。
  证据：2026-04-12 查阅 OpenAI 官方 `Codex CLI command line options` 页面，确认存在 `codex resume [SESSION_ID]` 与 `resume --last` 两条不同入口；同日查阅 `Codex CLI configuration basics` 页面，确认 `~/.codex/config.toml` 与 `<repo>/.codex/config.toml` 是正式配置层。

- 观察：某个 shell 环境里 `codex` 命令名能否被直接解析，只说明命令发现方式，不说明 provider 配置所有权应该归扩展。
  证据：扩展已经有 `devSessionCanvas.agent.codexCommand` 设置项，可以通过显式命令路径启动 CLI；这和是否应改写 `CODEX_HOME` 是两条独立问题。

- 观察：当前实现实际上没有正式的宿主侧 CLI resolver，而是把配置项里的命令 token 原样交给会话启动逻辑。
  证据：`src/panel/CanvasPanelManager.ts` 只把 `agentCodexCommand` / `agentClaudeCommand` 填进 `cliSpec.command`，随后由 `buildAgentLaunchSpec()` 和 PTY 启动逻辑直接使用。

- 观察：像 OpenCove 那样通过 provider 私有文件、数据库或会话列表按 `cwd + 时间窗` 反查 session id，本质上仍然是启发式推断，不是 provider 正式提供的稳定读取接口。
  证据：2026-04-12 对 `DeadWaveWave/opencove` 的调研显示，其 `claude` / `codex` / `gemini` / `opencode` 都存在启动后再从私有状态源反查并回填 `resumeSessionId` 的路径；其中多条路径依赖目录扫描、mtime、时间窗或候选唯一性。

## 决策记录

- 决策：`Agent` 的正式启动目录继续收口为 repo/workspace 工作目录，而不是任何扩展私有目录。
  理由：用户在 repo 中创建 `Agent` 的目的，是让编程 CLI 在该 repo 的代码上下文、项目配置和权限边界下工作；扩展私有目录不属于用户的开发上下文。
  日期/作者：2026-04-12 / Codex

- 决策：插件设置只负责解析 CLI 可执行文件路径，不负责替换 provider 的用户配置根目录。
  理由：`agent.codexCommand` / `agent.claudeCommand` 的职责是“启动哪个二进制”，不是“发明一套新的 provider home 语义”；后者会直接破坏用户已经登录和调好的 CLI。
  日期/作者：2026-04-12 / Codex

- 决策：自动恢复只能依赖 provider 原生的显式 session identity；`resume --last`、交互式 picker 或“最近会话推断”都不属于正式产品路径。
  理由：它们绑定的是环境里的“最近一次会话”，不是画布节点自己的身份，无法稳定回答“这个节点恢复的是不是它自己之前的那条会话”。
  日期/作者：2026-04-12 / Codex

- 决策：对每个 provider 都必须单独记录“能否在 fresh start 前注入 session identity”和“能否在启动后可靠捕获 session identity”，而不是默认两者都成立。
  理由：`Claude Code` 已明确支持 `--session-id`，但当前公开证据下 `Codex` 只确认了显式 `resume` 入口，尚未确认 fresh start 的显式 session id 注入方式；如果把这两者混成一个抽象，只会再次把未验证能力写成已确认结论。
  日期/作者：2026-04-12 / Codex

- 决策：如果后续为了兼容某个 provider，临时采用启动后反查 session id 的路线，这条路线只能作为显式登记的技术债务，而不是正式恢复能力。
  理由：这种路线成立的前提恰恰是“provider 没有标准接口返回或注入 session id”；因此必须把问题写成外部接口缺口，而不是在产品层假装自己已经拿到了可靠能力。
  日期/作者：2026-04-12 / Codex

- 决策：本轮设计同时引入宿主侧 CLI resolver，命令定位不再只依赖当前进程 PATH。
  理由：用户真实问题不是“会不会手填绝对路径”，而是“本机或远端宿主已经安装好的 CLI，插件能不能尽量自动找到”；如果没有这层 resolver，repo cwd 与显式 session resume 设计落地后仍会在命令发现阶段频繁退化。
  日期/作者：2026-04-12 / Codex

## 结果与复盘

本轮已经完成设计收口、实现改造与关键回归验证：

- `Agent` 继续在 repo/workspace 目录启动，但插件不再默认改写 `HOME`、`CODEX_HOME` 或 provider 配置根目录环境变量，正式行为改为继承用户现有 CLI 配置与认证上下文。
- `CanvasPanelManager` 已引入宿主侧 CLI resolver：优先读取显式设置，再读最近成功解析缓存、宿主 `PATH`、POSIX 登录 shell 与 Windows 原生命令发现，并把解析来源记录到诊断事件里。
- `Codex` 的正式恢复路径已改成 `codex resume <session-id>`；没有显式 session id 时，节点不会再伪装成 `resume-ready`，而是退化为 `interrupted` 或保持 start-only。
- `Codex` 当前额外带有一条明确登记为技术债务的 fallback：由于 provider 暂无标准 machine-readable session-id 接口，fresh start 后会短时间扫描 `~/.codex/sessions/.../rollout-*.jsonl`，仅在 `cwd + 启动时间窗` 命中且候选唯一时回填 session id；只要 miss 或歧义就默认 fail closed。
- `Claude Code` 继续使用显式 session identity 路径：fresh start 通过 `--session-id` 注入，恢复通过 `--resume <session-id>`。
- 测试用 fake provider 已同步切到“显式 session id + 专用测试存储目录”语义，不再借用 `CODEX_HOME` 或“最近一次会话”推断；本轮还新增了 test-only locator 命令和 smoke 用例，覆盖唯一命中、`cwd` 不匹配与候选歧义三种结果。

剩余风险仍是 `Codex` fresh start 后缺少正式 session identity 接口。当前实现虽然补上了启发式 fallback，但它的语义仍然是“因为 provider 没有标准接口才不得不接受的技术债务”，不是正式 capability；后续一旦 provider 暴露标准接口，这段反查逻辑应被移除。

## 上下文与定向

本计划涉及四类文件：

1. 设计与规格文档
   - `docs/design-docs/execution-lifecycle-and-recovery.md`
   - 新增 `docs/design-docs/agent-cli-launch-context-and-resume.md`
   - `docs/product-specs/canvas-core-collaboration-mvp.md`
   - `docs/product-specs/runtime-persistence-modes.md`
   - `docs/design-docs/index.md`

2. 当前实现中的问题点
   - `src/panel/CanvasPanelManager.ts`
   当前 `resolveAgentResumeContext()` 为 `Codex` 生成扩展私有目录，并在 `buildAgentLaunchSpec()` 中写入 `CODEX_HOME`；恢复时再走 `codex resume --last`。

3. 共享协议与状态模型
   - `src/common/protocol.ts`
   - `src/common/runtimeSupervisorProtocol.ts`
   当前模型里仍带有 `resumeStoragePath` / `codex-home` 这类与错误设计绑定的概念，后续实现要把它们收口成 provider 显式 session identity。

4. 验证入口
   - 本机 `claude --help`
   - OpenAI 官方 Codex CLI 文档
   后续还需要真实 `Codex` / `Claude Code` smoke 验证。

这里的“显式 session identity”指的是：provider 自己承认并能用于恢复某一条确定会话的标识，例如 session id。它和“最近一次会话”“当前目录下最近一次会话”“某个私有状态目录里的最后一条记录”不是一回事。

## 工作计划

第一阶段先修正文档，把错误结论从正式事实源里移除。当前仓库有多份文档会影响后续实现，如果只改代码不改文档，下一位协作者仍会继续沿着旧结论加代码。

第二阶段把 provider 启动上下文和恢复身份从生命周期文档里拆成一份独立设计文档。原因不是追求文档数量，而是这个问题已经从“状态机”升级为“provider 边界与配置所有权”，它需要自己的问题定义、候选方案和验证口径。

第三阶段在实现上引入宿主侧 CLI resolver。它至少要覆盖：显式设置、最近成功解析缓存、当前宿主 PATH、平台原生命令发现和失败诊断。只有把命令发现独立出来，才能避免“CLI 明明装了，但扩展还是要求手填绝对路径”。

第四阶段再把 provider capability contract 接上实现。最少要能区分五件事：启动命令、repo cwd、命令定位能力、显式 resume 入口、session identity 的产生/捕获方式。只有 capability 明确，才能避免再次把 `Claude` 和 `Codex` 的差异硬压成同一路径。

第五阶段才是代码改动。届时需要移除 `resumeStoragePath -> CODEX_HOME` 的正式语义，把 `resume-ready` 的条件改成“持有 provider 显式 session identity”，并为旧节点 metadata 设计兼容降级：旧数据一律不再自动 resume，而是改成 `interrupted` 或保留历史态。

## 具体步骤

1. 新建 `docs/design-docs/agent-cli-launch-context-and-resume.md`，写清问题、候选方案、当前结论、风险和验证口径。
2. 更新 `docs/design-docs/execution-lifecycle-and-recovery.md`，移除“每节点独立 `CODEX_HOME` + 最近会话恢复”的正式结论，并改为引用新文档。
3. 更新 `docs/product-specs/canvas-core-collaboration-mvp.md` 与 `docs/product-specs/runtime-persistence-modes.md`，把 repo cwd、配置继承和显式 session resume 补到产品规格里。
4. 更新 `docs/design-docs/index.md`，登记新文档并同步已有文档的更新时间。
5. 后续实现时，先新增宿主侧 CLI resolver，再修改 `src/common/protocol.ts`、`src/common/runtimeSupervisorProtocol.ts`、`src/panel/CanvasPanelManager.ts` 及对应 smoke tests。

## 验证与验收

本设计阶段的验收标准：

- 仓库内存在正式设计文档，明确禁止把 provider 私有 home 目录隔离方案写成默认产品语义。
- 产品规格已明确：`Agent` 在 repo/workspace 目录启动，插件默认继承用户现有 CLI 配置和认证上下文。
- 产品规格已明确：CLI 命令发现发生在执行宿主侧，且需要比“当前 PATH + 手填绝对路径”更健壮。
- 产品规格已明确：自动恢复只能使用 provider 原生显式 session identity；如果没有该 identity，就不能展示 `resume-ready`。
- 设计索引与具体设计文档状态一致。

后续实现阶段的验收标准：

- 新建 `Agent` 节点时，CLI 仍在 repo/workspace 目录启动。
- 当 CLI 已安装但不在当前进程 PATH 直达位置时，宿主侧 resolver 仍能尽量自动定位它。
- 用户已有 `Codex` / `Claude Code` 配置不会因扩展默认行为而被重置到扩展私有目录。
- `Claude Code` 能通过显式 session id 自动恢复。
- `Codex` 只有在真实 session id 已通过可信来源取得时才进入自动恢复；否则节点必须退化为 `interrupted`，而不是走 `resume --last` 或启发式反查。

## 幂等性与恢复

- 文档更新可重复执行，不会改变仓库运行状态。
- 后续代码迁移时，旧的 `resumeStoragePath` 数据不能被静默继续当成自动恢复凭据；需要显式降级，避免恢复到错误会话。
- 如果真实 `Codex` session identity 获取在实现中缺少标准接口，应继续保留“start-only、无自动恢复”的退化路径；如不得不临时使用反查，必须把它作为技术债务写明，而不是重新引入伪正式能力。

## 证据与备注

本轮设计收口依赖的关键事实：

    本机 claude --help 显示：
    - --session-id <uuid>
    - -r, --resume [value]

    OpenAI 官方 Codex CLI 文档显示：
    - codex resume [SESSION_ID]
    - codex resume --last
    - ~/.codex/config.toml
    - <repo>/.codex/config.toml

这几条事实共同说明：`Agent` 自动恢复应建立在 provider 自己承认的会话身份上，而不是把扩展私有目录伪装成 provider 的默认用户主目录。

## 接口与依赖

后续实现至少要落出下面这些等价语义：

- provider capability 描述：
  - `command`
  - `startsInWorkspaceCwd`
  - `commandResolution`
  - `resumeByExplicitId`
  - `canInjectSessionIdOnStart`
  - `hasStandardSessionIdReadInterface`
  - `requiresHeuristicSessionIdDiscoveryDebt`

- 节点 metadata 至少要能表达：
  - 当前 provider
  - 启动 cwd
  - provider 显式 session identity
  - 该 identity 的绑定来源是否可信
  - 最近一次恢复失败原因

如果最终代码不沿用这些确切名字，也必须保留这些语义，并在实现完成后回写本计划。

本计划创建于 2026-04-12，用于把 `Agent` 的 provider 启动上下文与恢复身份从“环境敏感推断”收口为“repo cwd + 继承用户配置 + 显式 session identity”。
