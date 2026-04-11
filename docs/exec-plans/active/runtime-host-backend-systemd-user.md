# 以 Runtime Host Backend 重构运行时持久化主路径

本 `ExecPlan` 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘`。

本文件遵循 `docs/PLANS.md` 的要求持续维护。

## 目标与全局图景

当前仓库已经能在扩展重载、短时断开后恢复 `Agent` / `Terminal` 节点，但 `live-runtime` 仍把“detached supervisor + runtime socket”当成正式主路径。用户已经验证出一个反例：在 `Remote SSH` 长断开后，画布节点还能恢复，但 live session 会退化成历史结果。这说明当前实现最多是 `best-effort`，还不是稳定的“真实运行时持久化”。

本计划要把运行时持久化改成明确的 backend 分层：Linux 本地与 `Remote SSH` 优先使用 `systemd --user` 托管 supervisor，当前 detached launcher 降级为 fallback。完成后，用户至少能在 Linux / `Remote SSH` 场景下看到 runtime backend 与保证等级被显式记录；在 `systemd --user` 可用时，关闭整个 VSCode 或断开 `Remote SSH` 后，真实会话由用户服务层继续持有，而不是依赖 extension host 的 detached child。

## 进度

- [x] 2026-04-10 23:25+08:00 梳理现有 `runtimeSupervisorClient`、`CanvasPanelManager`、路径解析与 smoke 覆盖，确认当前 `live-runtime` 直接绑定 detached launcher。
- [x] 2026-04-10 23:25+08:00 更新设计文档与产品规格，把 `systemd --user` 主路径、legacy fallback 和保证等级写成正式结论。
- [x] 2026-04-10 23:25+08:00 引入 runtime host backend 抽象，并在共享协议中记录 backend / guarantee。
- [x] 2026-04-10 23:25+08:00 实现 Linux `systemd-user` backend，写入 unit 文件并通过 `systemctl --user` 拉起 supervisor。
- [x] 2026-04-10 23:25+08:00 保留 legacy detached backend 作为 fallback，并把它降级为 `best-effort`。
- [x] 2026-04-10 23:25+08:00 更新宿主状态、节点 metadata 与 Webview 展示，使用户能看见当前 backend 和保证等级。
- [x] 2026-04-10 23:25+08:00 补充路径/渲染测试并运行 `npm run typecheck`、`npm run build`、运行时路径测试。
- [x] 2026-04-11 00:40+08:00 补上 `fake-systemd` 本地 reopen smoke 场景与 backend / guarantee 断言，并把真实 Remote SSH 长断开 nightly 化记入技术债追踪。
- [x] 2026-04-11 09:45+08:00 定位并修复本地 smoke 宿主环境污染：`ELECTRON_RUN_AS_NODE=1` 与继承的 `VSCODE_*` 会把下载的 VS Code 测试宿主拉成错误模式；runner 现已在启动 VS Code / CLI 前显式净化这类变量，并补上一条环境净化测试。
- [x] 2026-04-11 10:15+08:00 收口 `systemd-user-real-reopen` 本机 blocker：smoke runtime 现在显式提供短 `XDG_STATE_HOME`，systemd / legacy supervisor 都改为显式 Node exec + `ELECTRON_RUN_AS_NODE=1` 环境，`systemd-user` 启动前会预建 `WorkingDirectory`；`systemd-user-real-reopen` 与 `systemd-fallback-real-reopen` 已在本机跑绿。

## 意外与发现

- 观察：当前 `runtimeSupervisorPaths` 在 Unix 上优先使用 `storageDir`，否则回退到 `XDG_RUNTIME_DIR` 或 `/tmp`；这条路径适合短链路，但不适合承载 `Remote SSH` 长断开的唯一控制端点。
  证据：`src/common/runtimeSupervisorPaths.ts`

- 观察：当前 `runtimePersistence.enabled` 一旦开启，宿主就直接把节点记成 `live-runtime`，没有区分“强保证”与 “best-effort”。
  证据：`src/panel/CanvasPanelManager.ts` 中 `startAgentSessionWithSupervisor`、`startTerminalSessionWithSupervisor` 与 `reconcile*NodesInArray` 路径。

- 观察：`fake-systemd` 覆盖下的 `systemd-user-real-reopen` 回退不是单一问题，而是三层叠加的宿主启动细节：一是 smoke runtime 需要短 `XDG_STATE_HOME` 才能稳定落到短 control socket；二是 extension host 里的 `process.execPath` 实际指向 VS Code `code`，因此 systemd unit / detached fallback 都必须显式改用 Node 可执行文件并带上 `ELECTRON_RUN_AS_NODE=1`；三是 systemd unit 的 `WorkingDirectory` 如果未预建，会在实际启动阶段以 `spawn <node> ENOENT` 形式失败。
  证据：`scripts/vscode-smoke-runner.mjs`、`src/panel/runtimeHostBackend.ts`、`tests/vscode-smoke/fixtures/fake-systemd/systemctl.cjs`，以及 2026-04-11 10:05+08:00 的 `exthost.log`

## 决策记录

- 决策：本轮不再把 detached launcher 当成正式 `live-runtime` 主路径，而是降级为 fallback backend。
  理由：它已经被用户实际验证出在 `Remote SSH` 长断开场景下不稳定；继续把它写成“已验证的 live-runtime”会让文档与事实脱节。
  日期/作者：2026-04-10 / Codex

- 决策：Linux 本地与 `Remote SSH` 的正式主路径收口到 `systemd --user service`，而不是继续把 socket 放在 `XDG_RUNTIME_DIR` 上承载全部语义。
  理由：关闭整个 VSCode 或断开 `Remote SSH` 时，真正需要的是“谁拥有进程”；把进程与控制端点交给用户服务层，比 detached child + runtime dir 更接近强保证。
  日期/作者：2026-04-10 / Codex

- 决策：本轮允许 macOS 继续停留在 legacy detached fallback，不把 `launchd` 一并塞进当前交付。
  理由：用户当前反馈的问题首先出现在 Linux / `Remote SSH`；先把最关键主路径收口，再单独为 macOS 设计 `launchd` backend，能避免本轮同时打开两个平台级实现面。
  日期/作者：2026-04-10 / Codex

## 结果与复盘

本轮已经把 runtime persistence 主路径改成 backend 分层，而不再把 detached supervisor 直接写成正式 `live-runtime` 语义：

- Linux 本地与 `Remote SSH` 的首选 backend 现在是 `systemd-user`；扩展会为每个 workspace 计算稳定的 user unit 与 control socket 路径，并在需要时通过 `systemctl --user daemon-reload/start` 拉起 supervisor。
- 当前 detached launcher 被保留成 `legacy-detached` fallback；当 `systemd --user` 不可用、无法启动或路径解析失败时，宿主会自动回退到它，并把 guarantee 显式标成 `best-effort`。
- 共享协议、supervisor registry/snapshot、节点 metadata 和 Webview 都已经能携带并展示 `runtimeBackend` / `runtimeGuarantee`，用户不再只能靠环境猜测自己拿到的是哪条路径。

当前仍保留两项后续工作：

- 真实 Linux / `Remote SSH` 长断开手工验证还没在本地执行；因此设计文档仍保持 `验证中`，没有把 `systemd-user` 路线提前写成“已验证”。
- macOS 的正式强保证 backend 仍未实现；当前仍停留在 `legacy-detached` fallback，后续需要单独收口 `launchd` 方案。
- 真实 Remote SSH 长断开自动化仍未接入 PR 级 runner；目前已经把这项需求明确登记到 `docs/exec-plans/tech-debt-tracker.md`，计划放到 nightly / self-hosted。

## 上下文与定向

本计划触及四个区域：

1. `docs/`
   - `docs/design-docs/runtime-persistence-and-session-supervisor.md`
   - `docs/product-specs/runtime-persistence-modes.md`
   - `docs/design-docs/index.md`
   这些文档要把“当前 detached 主路径已验证”的结论改成新的 backend 分层口径。

2. `src/common/`
   - `src/common/protocol.ts`
   - `src/common/runtimeSupervisorProtocol.ts`
   - `src/common/runtimeSupervisorPaths.ts`
   这里定义节点 metadata、supervisor snapshot 与路径解析。需要新增 backend / guarantee 字段，并把 `runtimeSupervisorPaths` 从“唯一主路径”改成“legacy path resolver”，再补 systemd user 路径解析。

3. `src/panel/` 与 `src/supervisor/`
   - `src/panel/CanvasPanelManager.ts`
   - `src/panel/runtimeSupervisorClient.ts`
   - 新增 runtime host backend 相关模块
   - `src/supervisor/runtimeSupervisorMain.ts`
   这里要把“如何启动 / 连接 supervisor”的策略抽象出来，并把 backend 信息写入 registry / snapshot。

4. `scripts/` 与测试
   - `scripts/test-runtime-supervisor-paths.mjs`
   - 新增 backend / path 测试脚本
   本轮至少要把新的 systemd 路径与 fallback 解析逻辑测起来，避免再次靠人工猜测。

这里的“runtime host backend”指的是：谁负责在 extension host 生命周期之外创建并保有 supervisor。当前仓库只有一种 backend，即“detached child”。本轮要把它扩展成至少两种：

- `systemd-user`：Linux 用户服务层，作为正式主路径。
- `legacy-detached`：当前 detached launcher，作为 fallback。

“保证等级”指的是产品对跨 host boundary 的承诺强度：

- `strong`：平台级服务托管，目标是关闭 VSCode / 断开 `Remote SSH` 后仍能稳定重连。
- `best-effort`：仍然尝试保活，但不再把它写成稳定承诺。

## 工作计划

第一阶段先修正文档。把 `live-runtime` 从“单一能力”改成“mode + backend + guarantee”三件事：开关仍决定用户是否要求跨 host boundary 保活，但真正决定强度的是 backend。Linux 本地与 `Remote SSH` 的正式 backend 改成 `systemd-user`；legacy detached 继续存在，但只算 `best-effort`。如果文档不先改，后面的代码改动会继续建立在错误口径上。

第二阶段在共享模型里加入 backend / guarantee 字段。`AgentNodeMetadata`、`TerminalNodeMetadata` 和 `RuntimeSupervisorSessionSnapshot` 都必须知道当前会话由哪条 backend 持有，否则重连和历史恢复后无法区分“systemd 主路径上的强保证”与 “legacy fallback 的 best-effort”。这一步同时要保留向后兼容：旧持久化状态读回来时，应默认 `legacy-detached` + `best-effort`。

第三阶段引入 runtime host backend 抽象。`runtimeSupervisorClient` 目前同时承担“连接 socket”和“直接拉起 launcher”两件事，本轮要把“如何启动 supervisor”的部分拆出去。`systemd-user` backend 负责：

- 计算稳定的控制目录与 socket 路径
- 写入用户级 service unit
- `systemctl --user daemon-reload`
- `systemctl --user start <unit>`

`legacy-detached` backend 保留当前 `spawn(... detached: true)` 路径。

第四阶段把 `CanvasPanelManager` 改成消费 backend 描述，而不是直接假定 “runtimePersistence.enabled => detached supervisor => live-runtime”。启动、恢复、关停、失败回退都要沿用 backend 信息，并在节点 metadata 中留下 `runtimeBackend`、`runtimeGuarantee` 与更明确的失败原因。

第五阶段补验证。现有 `runtime supervisor paths` 脚本只覆盖 `XDG_RUNTIME_DIR` 与 `/tmp`，本轮要加 systemd user 控制目录与 unit 路径解析测试，并确保 `typecheck`、`build` 通过。由于当前 CI / 开发环境未必存在可控的 `systemd --user`，本轮自动化先不做真实 service 启停；真实 systemd 行为留给后续 smoke 或人工验收。

## 具体步骤

1. 更新 `docs/design-docs/runtime-persistence-and-session-supervisor.md`、`docs/product-specs/runtime-persistence-modes.md` 和 `docs/design-docs/index.md`，把 detached 路线降级为 fallback，并把 Linux / `Remote SSH` 的正式主路径改成 `systemd-user`。
2. 在 `src/common/protocol.ts` 中新增 backend / guarantee 类型与 metadata 字段；在 `src/common/runtimeSupervisorProtocol.ts` 中把同样的信息加入 snapshot / create params。
3. 保留 `src/common/runtimeSupervisorPaths.ts` 作为 legacy resolver，并新增 systemd user 路径解析函数。
4. 新增 runtime host backend 模块，实现 backend 选择、描述与 `systemd --user` 启动逻辑。
5. 修改 `src/panel/runtimeSupervisorClient.ts`，让它通过 backend 接口启动 supervisor，而不是内建 `spawn detached`。
6. 修改 `src/supervisor/runtimeSupervisorMain.ts`，把 backend / guarantee 写入 registry 与 snapshot，并对旧 registry 兼容默认值。
7. 修改 `src/panel/CanvasPanelManager.ts` 与 `src/webview/main.tsx`，在节点 metadata 和界面上显示当前 backend / guarantee。
8. 更新 `package.nls.json` 中运行时持久化描述，使其不再把所有平台都描述为同一强保证。
9. 扩展脚本测试，运行 `npm run typecheck`、`npm run build`、路径解析测试。

## 验证与验收

本计划至少需要满足以下验收条件：

- 共享协议中可以明确区分 `systemd-user` 与 `legacy-detached`，以及 `strong` 与 `best-effort`。
- Linux / `Remote SSH` 在正常环境下会优先选择 `systemd-user` backend；测试模式仍可保留 legacy backend，避免打断现有 smoke。
- 旧的 persisted state / registry 读回后不会崩溃，并会被归一化成 `legacy-detached` + `best-effort`。
- Webview 节点能看到当前 runtime backend / guarantee，用户不再只能从文案猜测。
- `npm run typecheck`
- `npm run build`
- 运行时路径测试脚本通过。

## 幂等性与恢复

- systemd unit 文件应按内容覆盖写入；重复执行不应产生多份随机命名 unit。
- 如果 `systemd --user` 不可用，backend 选择必须自动回退到 `legacy-detached`，而不是把 `runtimePersistence.enabled` 直接变成启动失败。
- 旧 registry / 旧节点 metadata 缺少 backend 字段时，读取逻辑必须使用兼容默认值。
- 若本轮中途发现 `systemd-user` 路线在当前仓库无法稳定完成，不允许静默撤回；必须把 blocker 回写本计划与设计文档。

## 证据与备注

已完成的自动化验证：

    npm run typecheck
    npm run build
    npm run test:runtime-supervisor-paths
    npm run test:vscode-smoke-runner-env
    DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=systemd-user-real-reopen,systemd-fallback-real-reopen node scripts/run-vscode-smoke.mjs
    DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=real-reopen node scripts/run-vscode-smoke.mjs

结果：

- `npm run typecheck` 通过
- `npm run build` 通过
- `npm run test:runtime-supervisor-paths` 通过，新增覆盖 `systemd-user` control dir / unit path 与长路径 fallback 解析
- `npm run test:vscode-smoke-runner-env` 通过，覆盖 VS Code / Electron 子进程环境净化
- 在沙箱外运行 `DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=real-reopen node scripts/run-vscode-smoke.mjs` 已通过，确认此前 `Cannot find module 'vscode'` 的根因是从当前宿主终端继承了 `ELECTRON_RUN_AS_NODE=1` 与 `VSCODE_*`
- `real-reopen-tests.cjs` 已补 `runtimeBackend` / `runtimeGuarantee` 断言，`run-vscode-smoke.mjs` 也新增了 `systemd-user-real-reopen` 与 `systemd-fallback-real-reopen` 两个 smoke 场景
- 在沙箱外运行 `DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=systemd-user-real-reopen,systemd-fallback-real-reopen node scripts/run-vscode-smoke.mjs` 已通过；本机 blocker 已确认并修复为 `systemd-user` unit 启动前缺少短状态目录、显式 Node/Electron 环境，以及预建 `WorkingDirectory`

备注：

- 当前未在本机跑真实 `systemd --user` smoke，也未做长断开人工回归；这部分留待后续验证。

## 接口与依赖

本轮至少要新增以下概念或接口：

- `RuntimeHostBackendKind`
- `RuntimePersistenceGuarantee`
- runtime host backend 描述对象，至少包含 `kind`、`guarantee`、`label`、`paths`
- systemd user unit 渲染函数
- backend 选择函数：根据平台、测试模式、环境能力决定使用 `systemd-user` 还是 `legacy-detached`

如果某个接口最终没有这些名字，也必须提供等价语义，并在最终复盘中说明替代关系。

本计划创建于 2026-04-10，用于把运行时持久化从“单一路径 + 过强文档口径”收口为“backend 分层 + 明确保证等级”。
