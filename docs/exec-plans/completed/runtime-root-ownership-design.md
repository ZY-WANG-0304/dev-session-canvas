# 规划 root 稳定的 Runtime 归属

本 ExecPlan 按 `docs/PLANS.md` 持续维护，覆盖设计研究而非业务实现。基线为 PR #295 合并后的 `origin/main@06e9abcf32828325444e8263233537f25bf042a7`，工作分支 `docs-runtime-root-ownership-design`。本轮只修改设计、产品约束和规划记录，不操作用户节点、registry、Supervisor 或原生资源。

## 目标与全局图景

多根 workspace 是各 root 画板的组合视图。同一个 root 在单根窗口和多根 workspace 中新建 Terminal/Agent 时，应归属同一运行环境、同一用户存储范围、同一 root 身份和 Supervisor generation 所确定的运行时，不取决于创建窗口的 workspace storage slot。旧 live 会话继续按持久化 backend/storage/session/kind 连接，不能只重写路径声称完成迁移。

本轮产物是一份可实施的设计：明确 root 身份、存储位置、发现/新建/原绑定路由、并发与错误语义、旧运行时退役以及有限验收。设计确认与运行验证分开记录，不宣称已经实现。

## 进度

- [x] (2026-10-07) fetch并核对PR #295已合并，从origin/main建立独立设计分支。
- [x] (2026-10-07) 核对现有 root 身份、root-local 画板、storage/generation/namespace 与客户端生命周期，两条并行只读调查完成。
- [x] (2026-10-07) 比较并选定用户级 root runtime 方案，明确环境运行实例、词法 root、启动竞争、设置与旧 live 边界；同步原 6.8 节和规格。
- [x] (2026-10-07) 形成有限 P1 至 P3 及 R1-01 至 R1-08 验收；独立只读审查未发现确定性 blocker，补齐启动意图恢复判据和 hello 措辞。
- [x] (2026-10-07) 文档引用/元数据与 whitespace 检查通过，设计计划归档；业务实现不在本计划内。

## 意外与发现

起始事实：现行多根设计保留具体workspace storage slot，故F-03是需要修订的设计决策，不把现有实现倒写成违反既有规格的bug。PR #295的容量、退出完整性与当前状态恢复成果不在本轮重开。

Root-local 画板已经使用 global storage 和路径 hash，而新 runtime 仍使用窗口 slot；显示 namespace 与存储 key 不同，组合 helper 还额外 trim。新路由不能直接使用 display id、cwd 或自行 realpath 合并，否则会更改画板含义。具体 helper 为 `createRootLocalCanvasStorageKey()` 与 `normalizeWorkspaceRootPathForComposition()`。

Remote SSH 实际 EH 曾返回 file URI/空 authority，证据在生产接入设计 §44；remoteName 只是连接类型。现有 namespace claim 也不是环境身份服务。因此新归属选实际执行环境的运行实例，不依赖 Webview 首次显示；平台 probe 尚不存在，其可行性保留为实施 P1 的有限前置。

Client 已按 backend/storage 分桶，退休已有 reader/RPC 屏障，但 preferred backend 和 current path 仍是单个；systemd unit 在启动 claim 前写入。需要补 owner 分桶、握手和启动准备排他，不重造终端管线。

## 决策记录

- 决策：本轮只做root稳定归属规划设计，先核对现有身份和生命周期，不直接修改创建路径。理由：共享运行时改变窗口间所有权和发现边界，必须同时覆盖单根、多根、旧live原绑定以及同环境用户隔离。日期：2026-10-07。
- 决策：采用执行端 global storage 下的环境/root/generation 命名空间，一 root 一 owner，按需启动；不选 workspace 索引、工程目录或全局单 Supervisor。理由：摆脱窗口 slot，并限制进程故障影响，同时显式承担多 root 的进程基线成本。日期：2026-10-07。
- 决策：保留画板词法 root，不自动合并 symlink、worktree 或目录移动；用户范围由 OS 用户与实际 global storage 确定，不按 profile 显示名猜。理由：本项不是画板身份迁移。日期：2026-10-07。
- 决策：环境取 OS/容器运行实例，VS Code/SSH 重连内稳定，OS 重启可换 key；选择 boot UUID 而非墙上时钟启动时间，缺证据 fail closed。理由：无需恢复机器重启后的进程，不引入永久设备登记；具体平台 API 仍须 P1 验证，尤其 systemd 与 EH namespace。日期：2026-10-07。
- 决策：旧 live 原绑定，startup pending 与 runtime claim 分账，未知不 fallback；只补具名受影响验收。理由：稳定路由不放宽删除/尾部/资源责任，也不重开工具工程。日期：2026-10-07。

## 结果与复盘

正式结论已写入 `docs/design-docs/runtime-root-ownership.md`，原多根设计/规格、持久化规格、架构入口、核心原则和 F-03/R1 登记同步。方案状态是已选定/未验证，平台 probe、跨 Host 竞争和真实多窗口创建均未实现或执行。独立审查只证明当前文档未发现确定性矛盾，不代证平台能力。

本设计阶段已完成。验证结果：11 个改动文件均为 Markdown，5 份 frontmatter/索引状态及日期一致，新增/修改内容涉及的 14 个文档引用存在；`git diff --check` 通过。未运行产品测试、构建、CI 或操作用户 Runtime，因为没有业务变更；未来原生结果不得由本段静态检查代证。

后续实施必须另开 ExecPlan，固定三个包：P1 身份/存储/握手及最小环境/启动意图验证，P2 单根/多根 Agent/Terminal 生产路由与生命周期，P3 受影响真实 Agent/Webview/现代三平台/VSIX 和三 root 资源样本。不得只证明原会话 attach，也不得加无限诊断阶段。永久设备标识、历史 GC、通用画板多写者与跨机器托管不在本项；F-03 保持开放，实施前置与限制已登记技术债。

## 上下文与定向

`extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts`负责节点root归属、创建和恢复入口；`src/common/runtimeSupervisorPaths.ts`定义generation与运行时派生路径，`src/panel/runtimeHostBackend.ts`及`runtimeSupervisorClient.ts`负责发现/连接/启动，`src/supervisor/runtimeSupervisorNamespace.ts`和平台owner负责同存储排他运行。root-local画板的产品与存储语义见 `docs/product-specs/canvas-multi-root-workspace-support.md` 和同名设计，既定F-03/R1边界见有限收尾设计第7节。

## 工作计划

M1只读调查：沿Agent/Terminal新建、持久化恢复、root解析和移除、Host退出到Supervisor路径，记录稳定键与窗口状态的差异。结束条件为能用实际代码说明同root不同窗口和同窗口不同root的现状，不运行新的诊断框架。

M2方案设计：比较project-local、workspace storage与用户级root命名空间。选定身份、路径、发现和竞争规则，明确哪些设置可以共享、哪些必须按会话保存，保留旧绑定、尾部与资源完整性。结束条件为正式方案和规格修订一致，未确认平台事实列为实施前的定向验证。

M3实施规划与审查：拆成有限的身份/存储契约、生产路由与兼容、受影响验收。设计阶段只核对引用、元数据、代码事实和独立审查，不把未来测试写为通过；实现需后续明确启动。

## 具体步骤

在仓库根读取上述模块，并使用 `rg -n 'getPreferredRuntimeSupervisorClient|getRuntimeHostBaseStoragePath|startAgentSessionWithSupervisor|startTerminalSessionWithSupervisor' extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts` 定位新建入口；用root路径和metadata关键词继续追溯。查看原设计6.8及产品规格后编写正式设计，同步索引、核心原则、技术债状态与本计划。所有文件编辑通过apply_patch完成。

## 验证与验收

设计验收要求明确回答：同root单根/多根如何找到同owner；不同root如何隔离；未知root/环境/存储如何拒绝而非回落窗口；旧live如何保持原绑定；同时创建如何避免双owner；窗口关闭或移除root为何不停止其他窗口的执行；重命名、符号链接、Remote与设置冲突按什么边界处理。给出受影响自动化和真实多窗口/三平台场景，但本轮不执行它们。最终运行 `git diff --check` 并校验设计frontmatter、索引和引用。

## 幂等性与恢复

本轮无数据迁移、进程控制、服务重启或用户配置变更。调查不把旧registry当作存活证明，设计不通过改写runtimeStoragePath完成所谓迁移。文档可在同分支继续修订，不改写已冻结实验及历史失败。

## 证据与备注

PR #295 API返回merged=true，merge commit为06e9abcf；工作树起始干净，分支直接从origin/main创建。后续新增事实必须有代码或文档落点，候选不写成已实现能力。

只读协作分别核对 root 身份、Runtime 路由和独立方案审查。独立审查未发现确定性 blocker；建议的 pending 启动恢复判据与旧式 hello 表述均已采纳。YAML 检查使用仓库现有 `yaml` 解析器，引用检查只针对新增/改动内容，不借本次修复历史文档全集。

## 接口与依赖

拟新增 `common/runtimeRootOwnership.ts` 纯 descriptor/hash/path 规则与 `panel/runtimeExecutionEnvironment.ts` 平台输入，均位于主扩展 src 下；创建 API 显式传 owner，原绑定 API 显式传 persisted storage，不复用缺省参数含义。hello 增 owner/generation/兼容指纹，进程级兼容性与 session launchSpec 分开。复用现有 client、reader、namespace、路径长度和 idle 退出机制；准备锁不与运行期 claim 相互等待。不引入新的 server、数据库或通用发现服务，不改变 snapshot-only 的 Host 归属。

修订记录：2026-10-07，按用户要求独立启动 F-03/R1；完成只读事实核对、正式方案与规格修订，补独立审查建议。实现与原生证据不预支。
