# 0.25.0 发布准备范围与收口计划

本 `ExecPlan` 是活文档，必须按仓库根目录 `docs/PLANS.md` 的要求持续维护。本文记录 0.25.0 发布准备的事实基线、已确认的版本演进决策和需要同步的对外说明；具体回滚范围仍须以代码审计和验证证据为准，不把尚未确认的细节写成最终结论。

## 目标与全局图景

本次工作完成后，维护者能够明确回答：0.25.0 基于哪条代码线发布、相对 0.24.5 有哪些有意回滚和重新实现、用户可以看到哪些变化、哪些能力只是发布素材或内部维护、升级和回退有什么边界，以及正式发布前需要通过哪些验证门禁。

用户可观察的最终结果应包括：

- 两个公开扩展的版本号、CHANGELOG、Marketplace listing、仓库 README 和发布手册都指向同一个 0.25.0 release input。
- release notes 只描述最终 release ref 中真实存在且已确认的用户可见行为，不把未合入代码的历史分支能力包装成当前版本能力。
- 发布页明确保留 Preview 定位、支持矩阵、已知限制、渠道状态和安装/回退说明。
- 发布前验证能够从最终 `main` ref 重现版本一致性、构建、双 VSIX、packaged-payload smoke 和 `publish/v0.25.0` dry-run 证据。

## 进度

- [x] (2026-09-15 22:24 +0800) 检查工作区，确认原 `main` 工作树干净，但落后本地 `origin/main` 七个提交。
- [x] (2026-09-15 22:25 +0800) 获取最新远端 `main` 指针；`origin/main` 更新为 `44c025056f3e63019b53f528951ea1d15ce1539d`。
- [x] (2026-09-15 22:26 +0800) 从最新 `origin/main` 创建并切换到 `release-0-25-0-prep`，工作树保持干净。
- [x] (2026-09-15 22:35 +0800) 完成当前主线与远端 `v0.24.5` release tag 的关系审计，确认两者不在同一条后继链上。
- [x] (2026-09-15 22:45 +0800) 完成当前主线候选变更、版本事实、发布文档和验证入口的初步盘点。
- [x] (2026-09-15 23:00 +0800) 将本轮范围审计和待定决策补充到 `docs/design-docs/public-marketplace-release-readiness.md`。
- [x] (2026-09-16) 根据用户再次更正，将目标版本改为 0.25.0，并将分支重命名为 `release-0-25-0-prep`。
- [x] (2026-09-16) 根据用户确认，确定当前 `origin/main` 是 0.25.0 的 release input；从 0.24.5 到 0.25.0 的差异包含有意回滚，不能把 0.24.5 独有能力自动视为 0.25.0 承诺。
- [x] (2026-09-16) 确认 PTY title 在当前主线上重新实现；当前代码、设计文档和定向自动化测试已形成可审计入口。
- [x] (2026-09-16) 按代码路径枚举 0.24.5 被回滚的具体变更、当前仍保留的行为，以及 PTY title 重新实现的协议和用户可见边界；仍需在发布 gate 中补齐宿主级证据。
- [x] (2026-09-16) 根据已审计范围形成 0.25.0 的功能分组草案，排除只属于 Marketplace 素材、内部依赖维护或未合入代码的内容。
- [x] (2026-09-16) 将 0.25.0 对外说明收口为发布说明矩阵：PTY title 作为主要亮点；Runtime Supervisor 回滚作为行为边界；基础能力作为兼容性说明；Pane Gallery、Marketplace 素材和依赖审计分别归入视觉/资产/维护记录。
- [x] (2026-09-16) 完成版本号、lockfile、双扩展 CHANGELOG、Marketplace listing、根 README、中文版 README、两份发布手册和正式发布设计记录的 0.25.0 口径同步；历史发布复盘章节保持不改。
- [x] (2026-09-16 03:19 +0800) 完成版本同步后的 repo-local 分层验证：主扩展 / notifier typecheck、PTY title parser / protocol / Webview 定向测试、manifest / package / publish workflow 守卫、双扩展 build、notifier source / companion / locale smoke、Playwright PTY title 回归、`npm audit` 与 `npm audit --omit=dev` 均通过；Runtime Supervisor 10-agent 样本仍保持既有通过结果。
- [x] (2026-09-16 03:19 +0800) 完成当前 working tree 快照的隔离 clean-checkout 验证：独立 `npm ci` 安装 639 packages 且报告 0 vulnerabilities，主扩展 117-file VSIX 打包成功，packaged-payload smoke 通过，临时目录已清理。
- [ ] 在最终合入 `main` 的 release ref 上重跑 release gate 和 `publish/v0.25.0` dry-run，准备只包含发布收口内容的 MR。

## 意外与发现

- 观察：当前 `origin/main` 的 commit `44c0250` 不是远端 `v0.24.5` tag `a9e2787` 的后继，且该差异是当前版本演进策略的一部分，不是需要在发布前自动修复的历史分叉。
  证据：两者的 merge-base 是 `7eb3864b855d85b7c18d0162b99d5896d13af4d6`；`v0.24.5` 侧包含 Runtime Supervisor recovery 变更，而当前 `origin/main` 侧回退了这组变更并继续包含 Pane Gallery / Marketplace media、依赖审计和 PTY title 提交。
- 观察：版本同步前当前 `origin/main` 的根 workspace、主扩展和 notifier manifest 均为 `0.24.3`；现在发布准备分支已统一更新为 `0.25.0`，发布手册与 README 的当前章节也已同步。
  证据：`package.json`、`extensions/vscode/dev-session-canvas/package.json`、`extensions/vscode/dev-session-canvas-notifier/package.json`、`package-lock.json` 和当前发布物料。
- 观察：远端没有发现 `v0.25.0` tag；因此本轮 0.25.0 尚未发布，不能把目标版本当作升级前提。
  证据：`git ls-remote --tags origin 'refs/tags/v0.2[45]*'` 只返回到 `v0.24.5` 的远端 release tag。
- 观察：PTY Terminal Title 功能已经在当前 `origin/main` 中合入，但正式设计文档仍把 Extension Development Host 手工设置/清空、真实 provider spinner、Webview reload 和跨生命周期 reattach 标为未完成宿主级验证。
  证据：`docs/design-docs/execution-terminal-title-display.md` 的“当前验证证据”章节。
- 观察：完整 `git fetch origin main --tags` 因本地已有不同内容的 tag 被拒绝更新若干 tag，但 `origin/main` 的远端分支指针已经成功更新。
  证据：fetch 输出显示 main 成功更新，同时对既有 tag 报 `would clobber existing tag`；随后 `git log -1 origin/main` 为 `44c0250`。
- 观察：当前主线的 PTY title 不是从 `v0.24.5` 直接延续的实现，而是 `7fc63a7e` 新增、由 `e04e295b` 补充断言后合入 `44c02505` 的重新实现。
  证据：当前主线新增 `executionTerminalTitle.ts`、Host / Supervisor 协议接入、Webview context row 展示和对应 parser / protocol / Playwright 测试；`v0.24.5` 的变更清单中没有这组 title 实现。
- 观察：版本同步后的 repo-local release gate 和隔离 packaged-payload smoke 均通过，但 clean-checkout 验证只证明当前工作树快照可打包，不能替代最终合入 `main` 的 release ref。
  证据：`npm run validate:clean-checkout:vsix -- --source working-tree` 在独立目录完成 `npm ci`、117-file 主扩展打包和 VSIX smoke；当前候选 dirty-tree VSIX 为主扩展 `3,933,659` bytes / `sha256=a1c23550467b002c3abfce1672f1586a6e1a195691eedd6a6d0ed2f78de488eb`，notifier `159,279` bytes / `sha256=ac3f8fb59681fa081f52fd25907d8030797029f1578495fa3b8b375b175553d8`，两者均只作分支证据。
- 观察：生产模板市场 workflow 守卫通过，但它与插件发布渠道无关。
  证据：`npm run test:marketplace-production-deploy-workflow` 输出 `template marketplace production deploy workflow tests passed`；该结果只证明服务部署流程没有被本轮版本同步破坏。

## 决策记录

- 决策：发布准备分支命名为 `release-0-25-0-prep`，并直接从最新 `origin/main` 创建。
  理由：符合 `docs/workflows/WORKFLOW.md` 的发布准备流程和 `docs/workflows/BRANCH.md` 的 kebab-case 命名约定；用户明确要求以最新 `origin/main` 为起点。
  日期/作者：2026-09-15 / Codex
- 决策：0.25.0 直接以当前 `origin/main` 的最终 release ref 为 release input，不重新接回远端 `v0.24.5` release line。
  理由：用户已确认从 0.24.5 到 0.25.0 有意回滚了一系列变更；当前主线就是本轮发布的事实输入。发布说明应如实描述当前代码，不应为了形成线性历史而隐式 cherry-pick 已回滚的 Runtime Supervisor recovery。
  日期/作者：2026-09-15 / Codex
- 决策：将 0.24.5 与当前主线的差异拆成“有意回滚”“当前仍保留”“重新实现”三类审计，不把整个分叉简化成“从 0.24.5 升级”。
  理由：该分类能同时解释版本间行为变化和 PTY title 的新实现来源，避免把 0.24.5 独有能力、当前主线功能和发布素材混写。
  日期/作者：2026-09-16 / 用户确认，Codex 执行
- 决策：PTY title 作为 0.25.0 的主要用户可见能力候选，但 release notes 只承诺代码和验证已覆盖的协议边界。
  理由：当前主线已经包含实现、设计文档和定向测试；真实 Extension Development Host、provider spinner、Webview reload 与跨生命周期 reattach 仍需单独验证，不能过度承诺宿主级完成度。
  日期/作者：2026-09-16 / 用户确认，Codex 执行
- 决策：在用户确认 release input 和发布说明范围后，将版本号、lockfile 与当前发布物料统一 bump 到 `0.25.0`。
  理由：`0.25.0` 直接发布当前 `origin/main`，不重接 `v0.24.5` release line；范围已经收口后，继续保留 `0.24.3` manifest 会让打包和文案失真。
  日期/作者：2026-09-16 / Codex
- 决策：将此前误记的发布准备目标改回 0.25.0。
  理由：用户再次确认 0.25.0 才是本轮目标；后续版本说明应围绕 0.24.5 到 0.25.0 的有意回滚与 PTY title 重新实现展开。
  日期/作者：2026-09-16 / 用户确认，Codex 执行
- 已确认决策：0.25.0 是当前 `origin/main` 的新公开 Preview 里程碑；相对 `v0.24.5` 的有意回滚和 PTY title 重新实现必须在 release notes / 发布设计记录中单独说明。
  剩余工作：枚举具体被回滚的变更与保留行为，并为每项建立代码、测试或手工验证证据。

## 结果与复盘

当前阶段已完成分支创建、版本目标纠正、release input lineage 决策、代码级范围审计、版本同步、当前发布物料同步、分层验证和 clean-checkout packaged-payload smoke。最重要的结果是确认当前主线是有意回滚后的 0.25.0 输入，并在这条主线上重新实现了 PTY title；同时确认 v0.24.5 的 recovery / bounded checkpoint / FIFO input 等承诺不能直接沿用。当前剩余工作不再是 repo-local 构建或包体验证，而是发布准备 MR 合入后的最终 `main` ref 复验、`publish/v0.25.0` dry-run 和 release-day 渠道状态确认；本分支生成的 working-tree 工件仍不能直接当作最终 Release asset。

本阶段的经验是：不能仅按版本号推断当前主线包含哪些发布能力；应同时核对 `origin/main`、远端 release tag、manifest 版本、CHANGELOG 顶部条目和实际代码路径。

## 上下文与定向

当前仓库是一个包含主扩展和 notifier companion 的 VS Code monorepo。主扩展 manifest 位于 `extensions/vscode/dev-session-canvas/package.json`，notifier manifest 位于 `extensions/vscode/dev-session-canvas-notifier/package.json`，根 `package.json` 是 workspace 编排入口。两份扩展必须以同一个版本和同一个最终 release ref 发布。

当前分支基线：

- 分支：`release-0-25-0-prep`
- 基线：`origin/main` / `44c025056f3e63019b53f528951ea1d15ce1539d`
- 当前 manifest 版本：根 workspace、主扩展和 notifier 均为 `0.25.0`
- 当前远端最新 release tag：`v0.24.5`，其提交为 `a9e27873aa01c1d1f1e43b4303ff697ce618c8cf`

当前主线中需要进入候选范围审计的变更分为四类：

1. 用户可见功能：PTY terminal title 展示、TUI title 查询回包、控制序列脱敏、旧 session 消息隔离，以及 Pane Gallery 缩略图标题栏可见性 / 层叠修复。
2. 发布素材：多根 workspace 双形态 Marketplace PNG / MP4 / GIF、英中文素材和品牌落版。它们影响 listing 资产，不等于扩展运行时新增能力。
3. 内部维护：依赖审计告警收口、Vitest / `qs` / Wrangler 类型版本调整和 lockfile 更新。它们应进入验证与维护记录，只有在影响用户兼容性时才进入主 release highlight。
4. 对照但未纳入的历史变更：远端 `v0.24.5` release line 上的 Runtime Supervisor 恢复提交。它们用于解释有意回滚的行为边界，不属于 0.25.0 release input，不能直接进入 0.25.0 用户说明。

## 0.24.5 到 0.25.0 的范围审计初稿

以下内容是基于 commit、当前代码和现有测试入口整理出的内部发布口径，不等同于已经完成的最终 CHANGELOG。最终对外文字仍要以本分支版本同步后的测试和宿主验证为准。

### 有意回滚的能力

- `#272` 的 Supervisor 先监听、后台恢复、`recovering / ready` 状态和结构化错误来源没有进入当前 `origin/main`。当前 `runtimeSupervisorMain.ts` 的 `start()` 会先执行 `loadRegistry()`，再监听 socket；当前协议也没有 `recoveryState`、checkpoint 诊断和 transport / readiness / spawn 分层错误详情。因此，0.25.0 不能承诺“历史恢复期间新建会话不受影响”、恢复进度计数或精确区分 Supervisor 连接失败与执行文件缺失，除非发布前重新实现并验证。
- `#272` 中 systemd user unit 对 `WorkingDirectory=` 的专用序列化和对应 Host 测试也被当前主线移除；当前实现重新使用 ExecStart 参数的引号函数生成该 directive。Linux `systemd-user` 路径必须作为单独的发布风险复验，不能只凭已有文档宣称正常。
- `#276` 的死亡 PTY 有界恢复没有进入当前主线。当前 Supervisor 在 `loadRegistry()` / `normalizeRecoveredSession()` 中仍会打开 journal、读取 recovery candidates 并遍历事件恢复终端状态，而不是只读取有界 metadata；因此，0.25.0 不能复用 0.24.5 的“启动时不回放完整 journal、固定内存预算和死亡 PTY 只保留有界历史显示”承诺。
- `#276` 的“死亡 PTY 只有用户点击 Resume 才启动新的 provider 进程”也没有作为当前主线的发布承诺。当前 Host/Webview 仍存在 `pendingLaunch: 'resume'` 自动启动路径；发布说明必须明确当前实际是自动恢复 / resume 语义，或在发布前补测试把它收口为显式动作。
- `#277` 的 VS Code 不可取消进度通知、已完成 / 剩余 session 计数和 Webview recovery banner 移除后的完整协议链没有进入当前主线。0.25.0 不应声称存在恢复进度通知。
- `#278` 的 checkpoint 拒绝诊断、bounded projection checkpoint RPC、健康 live stream 避免周期性完整 projection，以及每节点严格 FIFO / 单在途 input RPC 没有进入当前主线。当前 Host 的 projection refresh 仍会请求完整 session snapshot，`writeExecutionInput()` 仍直接写 local PTY 或发起 Supervisor write RPC；当前 tracker 对颜色控制事件仍采用整体 `color-state` fail-closed 语义。0.25.0 不应复用 0.24.5 的输入响应和 checkpoint 拒绝优化承诺。
- `#274` 的依赖声明版本没有原样保留在当前 manifest，但当前 lockfile 解析出的 `js-yaml`、`linkify-it` 和 `markdown-it` 仍需以最终 `npm ci` 和 audit 结果为准。它属于依赖维护 / 安全门禁，不应包装成用户功能；本地当前 `npm audit` 与 `npm audit --omit=dev` 均为 0 vulnerabilities。

### 当前仍保留、但不应误写成 0.25.0 新增的能力

- 0.24.3 之前已经成立的执行节点生命周期、terminal stream / authority / revision、journal 与 checkpoint 基础机制，以及现有 Agent / Terminal、Fork、媒体链接和 resize 行为仍存在于当前主线；它们需要在版本同步后按发布 gate 复验，但不能因为这次重新打包就全部算作新功能。
- Pane Gallery 底部缩略图标题栏和多根 workspace 宣传素材在 `v0.24.5` 与当前主线都已有对应输入。它们可作为最终 listing 资产和视觉回归记录，但除非当前 ref 相对上一公开版本确有新的用户可见差异，否则不应作为 0.25.0 的主要 runtime 亮点。
- 当前 `#289` 依赖审计收口以及 lockfile / 开发工具版本变化应放入维护与验证记录。发布前要确认生产依赖、开发依赖、主扩展和模板市场的 audit 均通过，且没有因为回滚 `#274` 引入新的安全回归。

### PTY title 的重新实现

- `#290` 在当前主线上重新实现了 PTY title，而不是延续 `v0.24.5` 的恢复实现。共享解析器位于 `extensions/vscode/dev-session-canvas/src/common/executionTerminalTitle.ts`；Local Host 和 Runtime Supervisor 在各自拥有 raw PTY chunk 的边界处理 OSC 0 / OSC 2，并支持精确的 `CSI 21 t` 查询和 `OSC l` 回包。
- Agent / Terminal 标题栏 context row 展示动态 PTY title，并保留用户节点标题、Agent 启动命令副标题、Terminal shell path 副标题和 workspace root。title 控制序列、查询请求和 title payload 不进入终端可见输出、recent output、terminal stream、checkpoint 或 journal；新旧 execution session 的迟到消息也要保持隔离。
- 当前已有 parser、Runtime Supervisor protocol、Webview Playwright 和 `node-pty` fixture 的定向证据，但真实 Extension Development Host 手工设置 / 清空 title、真实 provider spinner、Webview reload 和跨 VS Code 生命周期 live-runtime reattach 仍处于验证中，不能写成完整宿主验收。

### 0.25.0 对外说明的组织顺序

正式 release notes 应按以下顺序组织，避免把回滚、用户功能和发布资产混在一起：

1. 先说明 0.25.0 是基于当前 `origin/main` 的公开 `Preview` 里程碑，和 `v0.24.5` 不在同一条后继链；本版本不是把 0.24.5 的恢复改动继续累加，而是有意回滚部分运行时变更后重新实现 PTY title。
2. 再说明 PTY title 的用户收益、支持的控制序列、查询回包、输出脱敏、session 隔离和未完成宿主验证。
3. 单独列出 Runtime Supervisor 的恢复 / 输入 / checkpoint 行为边界，明确哪些 0.24.5 能力不属于 0.25.0 承诺，尤其是死亡 PTY 有界恢复、显式 Resume、恢复进度通知和 FIFO 输入。
4. 再写当前仍保留的基础行为、无新增设置、扩展 ID / notifier 自动安装关系和已配置项沿用；只有通过最终回归的内容才能进入这一段。
5. 最后写 Preview 支持矩阵、Marketplace / Open VSX / GitHub Release assets 渠道状态、已知风险、升级与回退建议，以及本轮实际验证结果。

## 0.25.0 需要说明的内容

### 1. 版本定位与发布基线

需要明确 0.25.0 是新的 `0.x.0` Preview 里程碑，以及为什么从 `0.24.5` 到 `0.25.0` 存在有意回滚与重新实现，而不是把版本号跳跃解释成线性累积。内部记录至少要写清：

- 采用的上一发布基线是哪个最终 release ref，而不是只写一个版本号。
- `v0.24.5` release line 的 Runtime Supervisor 恢复内容哪些被当前主线回滚、哪些基础行为仍然保留；当前发布输入不重新接回该 release line。
- `v0.25.0` 没有在当前远端 tag 中出现，因此不能用“0.25.0 已发布”作为升级前提。
- 0.25.0 仍然是公开 `Preview`，不改变 `docs/workflows/VERSION.md` 的单轨 SemVer 和 `preview: true` 约束。

### 2. 用户可见亮点

若最终 release input 仍以当前 `origin/main` 为基础，主扩展 CHANGELOG、Marketplace listing 和根 README 至少应评估以下内容：

- PTY terminal title：Agent / Terminal 节点 context row 展示 shell、TUI 或 CLI 设置的动态标题，并保留用户节点标题、Agent 启动命令和 Terminal shell path。
- TUI 查询：支持 `CSI 21 t` 查询，并由实际 PTY owner 回写 `OSC l` title report；该行为不应被写成普通用户设置。
- 输出安全：OSC 0 / OSC 2 和查询控制序列不会进入终端可见输出、recent output、terminal stream、checkpoint 或 journal；标题只作为 live session 投影，不保存历史。
- 会话隔离：新 execution session 建立后，旧 session 的迟到 output、title 和终态消息不能覆盖新 session。
- Pane Gallery polish：底部缩略图标题栏可见、层叠和左上角位置得到修正；只有在最终验证确认属于用户可感知的发布范围时才作为独立亮点。

Marketplace 双语媒体和依赖审计应分别放入“发布素材 / 验证证据”段落，不与用户运行时能力混写。

### 3. 行为边界、兼容性与隐私口径

release notes、Marketplace listing 和支持文档必须说明：

- PTY title 不覆盖用户可编辑的 Canvas 节点标题，也不改变 Agent lifecycle、attention、完成或失败判定。
- 只支持已确认的 OSC 0 / OSC 2 和 `CSI 21 t` 处理边界；不把其他窗口控制序列写成支持项。
- title payload 会做控制字符移除、空白折叠和长度限制；malformed / 超长未闭合 payload 采用 fail-closed 脱敏，必要时丢弃到明确终止符。
- title 在 live / reattaching 状态可短暂随状态重连，但不进入终端历史、journal、recent output 或诊断文本；会话结束时清除。
- 缺少 `terminalTitle` 的旧 Host / Supervisor 快照表示“未知”，不是“明确清空”，以便兼容旧数据。
- 当前设计仍有未完成的真实 Extension Development Host、真实 provider spinner、Webview reload 和跨 VS Code 生命周期 reattach 验证，不能写成已完成宿主验收。

### 4. 安装、升级与回退

需要同步说明主扩展和 notifier 的同版本发布、自动安装关系、已有配置沿用规则，以及当前 Preview 的回退边界：

- `devsessioncanvas.dev-session-canvas` 和 `devsessioncanvas.dev-session-canvas-notifier` 必须统一为 0.25.0。
- 主扩展继续通过 `extensionPack` 带上 notifier；notifier 单独安装继续通过单向 `extensionDependencies` 补齐主扩展。
- 如果本轮没有新增用户设置，应明确写“无新增设置”；若版本 lineage 纳入 Runtime Supervisor 改动，则必须重写运行会话升级和恢复说明。
- 回退仍建议先停止重要会话，再禁用 / 卸载并重新安装目标版本；不把 Preview journal 或运行时状态写成跨版本可回退保证。

### 5. 支持矩阵与已知限制

本轮不能只写新功能，还要复核既有公开边界是否仍然准确：

- `Remote SSH` 仍是验证最充分的推荐路径；Linux、macOS、Windows 本地主路径继续保持 Preview 口径。
- Windows 下使用 Codex 时执行节点内历史无法向上翻页的限制仍需保留，除非获得新证据。
- `Restricted Mode` 只允许有限画布能力，`Virtual Workspace` 仍不支持。
- 90,000 行 completed terminal 尾部间歇性短读、journal 无固定磁盘上限 / 完整 retention / 跨版本 rollback、Fork 视觉验收和真实 TUI journal 人工复核等既有风险不能因本轮定向测试通过而删除。
- Marketplace 的 Visual Studio Marketplace public visibility、Open VSX verified 状态和 GitHub Release assets 兜底必须以本轮 release-day 实际结果为准，不能沿用旧版本的最终状态。

### 6. 发布工件、渠道和操作

正式发布准备需要明确以下内容的版本同步和最终 ref 绑定：

- `package.json`、主扩展 manifest、notifier manifest、`package-lock.json` 根版本。
- 主扩展与 notifier `CHANGELOG.md`。
- 主扩展英中文 Marketplace README、根英中文 README、必要时 notifier listing。
- `docs/public-preview-release-playbook.md`、`docs/notifier-preview-release-playbook.md` 和 `docs/design-docs/public-marketplace-release-readiness.md`。
- 主扩展 VSIX、notifier VSIX、`release-manifest-0.25.0.json` 的生成、SHA-256、README doc ref、GitHub Release assets 和 marketplace 状态。
- `publish/v0.25.0` 临时 tag、正式 `v0.25.0` tag、同一个最终 release ref，以及失败后复用同一批 assets 的恢复路径。

### 7. 验证证据

版本同步后的 repo-local release gate 已通过：

- `npm run typecheck`
- `npm run typecheck:notifier`
- `npm run test:execution-terminal-title`
- `npm run test:runtime-supervisor-protocol`
- `npm run test:protocol-webview-messages`
- `npm run test:extension-manifest`
- `npm run test:package-vsix-command`
- `npm run test:package-vsix-file-list`
- `npm run test:publish-tag-release`
- `npm run test:publish-marketplaces`
- `npm run test:publish-marketplace-workflow`
- `npm run build`
- `npm run build:notifier`
- `node scripts/test/run-playwright-webview.mjs --grep "PTY terminal titles"`
- `npm audit`
- `npm audit --omit=dev`
- `npm run test:notifier-source`
- `npm run test:notifier-smoke`
- `npm run test:notifier-locale-smoke`
- `npm run test:marketplace-production-deploy-workflow`
- `npm run test:vsix-smoke`
- `git diff --check`

上述命令均通过；PTY title Playwright 定向回归为 `1 passed`，两次 audit 均为 `0 vulnerabilities`，packaged-payload smoke 输出 `VSIX packaged-payload smoke passed`。`npm run validate:clean-checkout:vsix -- --source working-tree` 进一步在隔离目录执行独立 `npm ci`、117-file 主扩展打包和 packaged-payload smoke，并在完成后清理临时目录。当前 working-tree 候选工件为主扩展 `3,933,659` bytes / `sha256=a1c23550467b002c3abfce1672f1586a6e1a195691eedd6a6d0ed2f78de488eb`、notifier `159,279` bytes / `sha256=ac3f8fb59681fa081f52fd25907d8030797029f1578495fa3b8b375b175553d8`；打包日志中的 README doc ref 为 `44c025056f3e63019b53f528951ea1d15ce1539d`。这些工件来自 dirty working tree，不能直接作为最终 Release assets。

尚未执行的发布级步骤：

    npm run release:publish-tag -- --trigger-tag publish/v0.25.0 --dry-run --package-only

原因是当前发布准备分支尚未合入最终 `main` release ref，且按发布流程约束不能提前创建或推送 `publish/v0.25.0`；该命令必须在最终 release commit 上固定临时 tag 后执行。

完整 `npm test` 如果受当前 worktree 深路径 Unix socket 或既有 fixture 漂移阻断，必须保留准确失败原因，并以分层测试和独立 clean-checkout 证据替代，不能写成完整清洁通过。

## 工作计划

第一阶段已收口 release lineage。下一步对比当前 `origin/main`、远端 `v0.24.5` tag 和相关代码路径，列出 0.25.0 的“有意回滚 / 当前保留 / PTY title 重新实现”清单；若发现确有需要恢复的代码，必须另开独立实现计划，不能在发布文案阶段隐式补功能。

第二阶段按最终输入整理“用户功能 / 发布素材 / 内部维护 / 未纳入能力”四类清单，并把已确认的 release notes 口径写入 `docs/design-docs/public-marketplace-release-readiness.md`、主扩展设计文档和相关正式文档。所有未完成验证继续标记为“验证中”。

第三阶段在发布准备分支同步版本号和对外物料。主扩展和 notifier 必须保持同版本；Marketplace listing 默认使用英文文件，中文文件作为仓库内对应版本；根 README 继续保持英文主文件和中文对应文件。

第四阶段执行分层测试、打包和 clean-checkout 验证。候选 working tree 工件只作为分支证据，不能直接当成最终 Release assets；最终工件必须在发布准备 MR 合入后的 clean `main` ref 上重新生成或验证。

第五阶段按 `docs/exec-plans/active/publish-tag-release-flow.md` 与发布手册执行 package-only dry-run，确认 `publish/v0.25.0`、正式 tag、Release assets、Open VSX、Visual Studio Marketplace deferred / verified 状态和临时 tag 删除条件。

## 具体步骤

在仓库根目录 `/home/users/ziyang01.wang-al/projects/dev-session-canvas` 执行：

    git status --short --branch
    git log -1 --format='%H %s' origin/main
    git show-ref --tags | rg 'v0\.(24|25|26)'
    git diff --name-status origin/main refs/tmp/origin-tag-v0.24.5

在正式范围确认后，版本和文案修改前先执行：

    rg -n '0\.24\.3|0\.24\.5|v0\.24\.5|0\.25\.0|0\.26\.0' README.md README.zh-CN.md docs extensions/vscode package.json package-lock.json .github scripts

版本同步和文案收口已完成，分层验证和当前 working-tree 的 clean-checkout / packaged-payload 验证也已完成；每条命令的实际结果和未覆盖路径已写回本计划和对应正式发布文档。`publish/v0.25.0` 的 dry-run 仍必须等发布准备 MR 合入最终 `main` ref 后执行，因此当前仍不要创建或推送该临时 tag。

## 验证与验收

范围阶段的验收标准：

- 明确写出 0.25.0 的最终 release ref、上一有效发布基线，以及 0.24.5 release line 的哪些变更被有意回滚 / 保留 / 重新实现。
- CHANGELOG 的每一项用户可见能力都能在最终 release ref 找到对应实现和测试。
- Marketplace listing、根 README、支持文档、发布手册和 release notes 对版本、安装、渠道状态和已知限制没有互相矛盾。
- 未完成的真实宿主验证、跨平台矩阵或历史风险仍明确标记为“验证中 / 已知限制”。

发布阶段的验收标准：

- 根 workspace、主扩展、notifier、lockfile 和双 CHANGELOG 版本一致为 0.25.0。
- 主扩展与 notifier VSIX 都能从最终 ref 打包，内容守卫、版本、publisher、README doc ref 和 SHA-256 校验通过。
- clean-checkout packaged-payload smoke 通过；若失败，记录具体失败层级和是否阻断发布。
- `publish/v0.25.0` dry-run 只规划最终 ref，真实 workflow 重跑时复用同一批 VSIX / manifest。
- 发布完成后，GitHub Release assets、Open VSX verified、Visual Studio Marketplace verified 或 deferred、最终 manifest 和临时 tag 状态彼此一致。

## 幂等性与恢复

分支、计划和范围审计可以重复执行。若本地 tag 与远端 tag 冲突，不覆盖或强制更新用户已有 tag；使用临时 refs 读取远端 tag，仅把远端 tag 的 commit 作为审计输入。

在发布准备 MR 合入最终 `main` ref、发布验证和 release-day 复核完成前不要创建正式 tag 或推送临时 publish tag。若后续发现需要重新纳入 `v0.24.5` release line 的代码，应先在独立主题变更中合入真实代码，再重新生成 release notes 和验证计划。

发布失败时保留同一 `publish/v0.25.0` 作为重试输入，复用并校验既有 GitHub Release assets；不要重新打包覆盖已有同版本工件，也不要在 Open VSX 或 Release assets 未满足删除条件前删除临时 tag。

## 证据与备注

当前已确认的基线证据：

    branch: release-0-25-0-prep
    origin/main: 44c025056f3e63019b53f528951ea1d15ce1539d
    origin/main subject: Merge pull request #290 from ZY-WANG-0304/execution-terminal-title-support
    remote v0.24.5 tag: a9e27873aa01c1d1f1e43b4303ff697ce618c8cf
    root/main/notifier manifest version: 0.25.0
    remote v0.25.0 tag: not found

版本同步后的 repo-local release gate 已通过：

    npm run typecheck
    npm run typecheck:notifier
    npm run test:execution-terminal-title
    npm run test:runtime-supervisor-protocol
    npm run test:protocol-webview-messages
    npm run test:extension-manifest
    npm run test:package-vsix-command
    npm run test:package-vsix-file-list
    npm run test:publish-tag-release
    npm run test:publish-marketplaces
    npm run test:publish-marketplace-workflow
    npm run build
    npm run build:notifier
    node scripts/test/run-playwright-webview.mjs --grep "PTY terminal titles"
    npm audit
    npm audit --omit=dev
    npm run test:notifier-source
    npm run test:notifier-smoke
    npm run test:notifier-locale-smoke
    npm run test:marketplace-production-deploy-workflow
    npm run test:vsix-smoke
    git diff --check

上述命令均通过；PTY title Playwright 定向回归为 `1 passed`，两次 audit 均为 `0 vulnerabilities`，packaged-payload smoke 输出 `VSIX packaged-payload smoke passed`。`npm run validate:clean-checkout:vsix -- --source working-tree` 进一步在隔离目录执行独立 `npm ci`、117-file 主扩展打包和 packaged-payload smoke，并在完成后清理临时目录。当前 working-tree 候选工件为主扩展 `3,933,659` bytes / `sha256=a1c23550467b002c3abfce1672f1586a6e1a195691eedd6a6d0ed2f78de488eb`、notifier `159,279` bytes / `sha256=ac3f8fb59681fa081f52fd25907d8030797029f1578495fa3b8b375b175553d8`；打包日志中的 README doc ref 为 `44c025056f3e63019b53f528951ea1d15ce1539d`。这些工件来自 dirty working tree，不能直接作为最终 Release assets。

尚未执行的发布级步骤：

    npm run release:publish-tag -- --trigger-tag publish/v0.25.0 --dry-run --package-only

原因是当前发布准备分支尚未合入最终 `main` release ref，且按发布流程约束不能提前创建或推送 `publish/v0.25.0`；该命令必须在最终 release commit 上固定临时 tag 后执行。

## 接口与依赖

本计划不新增运行时接口。发布收口需要继续使用：

- 主扩展 `devsessioncanvas.dev-session-canvas` 和 notifier `devsessioncanvas.dev-session-canvas-notifier` 的现有 manifest / VSIX 接口。
- `scripts/release/package-vsix.mjs`、notifier 子包 `scripts/package-vsix.mjs` 和 `scripts/release/publish-tag-release.mjs`。
- `publish/vX.Y.Z` 临时 tag、正式 `vX.Y.Z` tag 和 `release-artifacts/release-manifest-X.Y.Z.json` 的既有约定。
- `extensions/vscode/dev-session-canvas/src/common/executionTerminalTitle.ts` 的 PTY title 解析、查询回包和输出脱敏行为。
- `docs/public-preview-release-playbook.md`、`docs/notifier-preview-release-playbook.md` 和 `docs/design-docs/public-marketplace-release-readiness.md` 作为发布操作和渠道口径的正式来源。

计划更新记录：2026-09-15，创建发布准备分支并记录当前主线与远端 v0.24.5 release line 的分叉事实；在 release lineage 确认前暂不 bump 版本或创建发布 tag。
计划更新记录：2026-09-16，用户确认目标版本恢复为 0.25.0，并确认从 0.24.5 到 0.25.0 的差异包含有意回滚，且 PTY title 在当前主线上重新实现；计划改为审计“回滚 / 保留 / 重新实现”范围，不再把 release lineage 作为待定事项。
计划更新记录：2026-09-16，完成 0.25.0 版本号、双 changelog、Marketplace listing、英中文 README、两份发布手册和正式发布设计记录的当前章节同步；历史 0.24.x 发布后复盘保留原样，下一步转入版本同步后的验证。
计划更新记录：2026-09-16，完成版本同步后的 repo-local release gate、working-tree 双 VSIX 复核和隔离 clean-checkout / packaged-payload smoke；保留 dirty-tree 工件仅作分支证据，并将最终 `main` ref / `publish/v0.25.0` dry-run 留到发布准备 MR 合入后。
