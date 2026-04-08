# 收口运行时持久化与会话监督器设计

本 ExecPlan 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘` 这几个章节。

本计划位于仓库根目录下的 `docs/PLANS.md` 约束体系内，后续任何继续推进该主题的协作者都必须按 `docs/PLANS.md` 的要求持续维护本文件。

## 目标与全局图景

这项工作要把“关闭画布甚至关闭 VSCode 后，`Agent` / `Terminal` 仍可继续存在或恢复”的产品诉求，收口成正式文档链路。完成后，仓库中会存在一份专项产品规格和一份专项设计文档，明确区分两种模式：一种是只恢复快照与上下文，另一种是让真实进程在 VSCode 退出后继续存活并在下次打开时重新附着。

本轮只做设计，不做实现。交付结果应让下一位协作者可以直接回答三个问题：当前代码为什么达不到目标、为什么需要独立的会话监督器、以及开关打开/关闭时用户到底会看到什么行为。

## 进度

- [x] (2026-04-08 15:18 +0800) 读取 `docs/WORKFLOW.md`、`docs/PLANS.md`、`docs/DESIGN.md`、`ARCHITECTURE.md`、`docs/product-specs/index.md`、`docs/design-docs/index.md`、`功能体验.md` 与当前执行会话相关设计文档，确认这是一次需要正式文档链路支持的架构级设计任务。
- [x] (2026-04-08 15:18 +0800) 审查当前实现，确认 `CanvasPanelManager` 只把对象图、摘要、最近输出和 best-effort resume 元数据持久化到 `workspaceState`，还没有“真实进程跨 VSCode 生命周期继续存在”的所有权模型。
- [x] (2026-04-08 15:18 +0800) 新增本计划，记录本轮设计目标、候选路线、关键约束与后续验证入口。
- [x] (2026-04-08 15:18 +0800) 新增专项产品规格 `docs/product-specs/runtime-persistence-modes.md`，定义两档运行时持久化模式的用户语义、范围与验收标准。
- [x] (2026-04-08 15:18 +0800) 新增专项设计文档 `docs/design-docs/runtime-persistence-and-session-supervisor.md`，比较“继续由 extension host 持有进程”“依赖 provider/shell 自身恢复”“独立会话监督器”三条路线，并收口当前推荐方案。
- [x] (2026-04-08 15:18 +0800) 同步更新 `docs/product-specs/index.md`、`docs/design-docs/index.md`、`docs/design-docs/core-beliefs.md`，并给当前执行生命周期文档补充边界引用。

## 意外与发现

- 观察：当前仓库已经有“对象模型恢复”和“Agent best-effort resume”，但它们都还停留在 extension host 权威状态这一层。
  证据：`src/panel/CanvasPanelManager.ts` 当前通过 `workspaceState` 持久化 `state`、`canvasLastSurface`、`recentOutput`、`pendingLaunch` 和 `resumeSessionId` 等字段，没有独立的长期进程持有者。

- 观察：用户口中的“持久化”实际混合了两种不同承诺，即“真实进程继续活着”和“重开后看起来回到了之前的状态”。
  证据：`功能体验.md` 第 4 条先要求页面退出后 `AGENT` 仍在后台执行，又允许在做不到时退化到 provider resume。

- 观察：如果不显式区分这两种承诺，产品文案、状态机和恢复边界就会互相打架。
  证据：当前 `execution-lifecycle-and-recovery.md` 已明确把真实恢复写成 best-effort；若直接把这条文档当成“真实 runtime persistence”就会造成误解。

## 决策记录

- 决策：把本主题拆成独立产品规格和独立设计文档，而不是继续把内容堆进 `canvas-core-collaboration-mvp.md`。
  理由：这里讨论的是“跨 VSCode 生命周期的运行时所有权、重连与配置语义”，已经超过当前 MVP 文档里“关键上下文恢复”的粒度。
  日期/作者：2026-04-08 / Codex

- 决策：正式把“持久化”拆成两档语义：`snapshot-only` 与 `live-runtime`。
  理由：前者解决“重开后还能看见之前状态”，后者解决“真实进程在 VSCode 关闭后仍继续运行”；两者的实现复杂度、风险和用户预期完全不同，不应再混写成一个词。
  日期/作者：2026-04-08 / Codex

- 决策：将 `live-runtime` 模式的当前推荐路线收口为独立会话监督器（session supervisor，也就是一个独立于 VSCode 扩展宿主、部署位置跟随 workspace 所在侧的辅助进程），而不是继续让 extension host 直接拥有所有长期进程。
  理由：只要真实进程需要跨 VSCode 退出继续存活，就必须让进程所有权离开 extension host；否则 VSCode 退出时进程天然跟着一起结束。
  日期/作者：2026-04-08 / Codex

- 决策：当前设计范围把 Remote SSH 视为 `live-runtime` 的正式目标，而不是后续可选增强。
  理由：在 Remote SSH 下，workspace、extension host 和真实运行时本来就在远端主机上；如果 `live-runtime` 连这条路径都不覆盖，产品关于“关闭本地 VSCode 后会话继续存在”的承诺就不完整。
  日期/作者：2026-04-08 / Codex

## 结果与复盘

本轮已经完成：

- 为运行时持久化主题建立了正式文档链路。
- 明确写清了两档模式各自的用户语义和边界。
- 记录了为什么当前实现不足、为什么需要会话监督器、以及当前不打算采用的替代路线。

本轮刻意没有完成：

- 没有实现 daemon、IPC、日志持久化或重连协议。
- 没有把真实 runtime persistence 写成“已验证能力”。
- 没有把 Dev Container / Codespaces 的支持误写成已承诺范围。

如果下一位协作者接手，应基于本计划与新设计文档再开一份实现型 ExecPlan，而不是跳过设计直接写 daemon。

## 上下文与定向

这里的“会话监督器”（session supervisor，也可称为 daemon）指一个独立于 VSCode 扩展宿主、部署位置跟随 workspace 所在侧的辅助进程。它的职责不是画 UI，而是长期持有 `Agent` / `Terminal` 子进程、保存可重连的会话登记和必要日志，并在 VSCode 重新打开后让扩展重新附着。

与当前任务直接相关的文件有：

- `功能体验.md`：用户新增的体验目标，其中第 4 条直接要求“页面退出后，`Agent` 仍在后台执行不受影响”。
- `docs/product-specs/canvas-core-collaboration-mvp.md`：当前主规格，只收口到“关键上下文恢复”，还没有把两档运行时持久化模式写成专项规格。
- `docs/design-docs/execution-lifecycle-and-recovery.md`：当前已选定设计，说明了现有 best-effort resume 边界，但还没有回答“真实进程跨 VSCode 生命周期如何存在”。
- `src/panel/CanvasPanelManager.ts`：当前宿主权威状态实现，负责 `workspaceState` 持久化、会话创建、摘要生成和 current-process 内的恢复逻辑。

这里还要记住两条关键边界：

1. “对象图恢复”不等于“真实进程继续存在”。
2. 如果产品要承诺“关闭 VSCode 后会话仍继续”，就必须先定义谁拥有进程、谁负责日志、谁负责清理孤儿会话。

## 工作计划

第一步，先把当前代码与用户目标之间的差距写清楚。当前代码已经能恢复节点、尺寸、标题、最近输出和 `Agent` 的 best-effort resume 元数据，但这些都还只是“重开后能继续理解上下文”，不是“真实进程仍在后台继续跑”。

第二步，产出专项产品规格，明确用户能切换什么配置，以及配置打开/关闭时系统分别承诺什么、不承诺什么。产品规格的任务不是选技术，而是把用户能观察到的行为写清楚。

第三步，产出专项设计文档，对比至少三条路线：继续让 extension host 自己持有进程、主要依赖 provider/shell 自带恢复、以及独立会话监督器。设计文档必须写出为什么推荐第三条，以及它新增的复杂度到底是什么。

第四步，同步更新索引和通用信念，让后续协作者能直接从注册表找到新文档，也让“先定义进程所有权，再承诺长期运行时”变成可复用的仓库原则。

## 具体步骤

在仓库根目录执行并记录结果：

1. 阅读设计、工作流、规格索引、现有运行时设计和当前代码。
2. 新增以下文档：
   - `docs/exec-plans/completed/runtime-persistence-and-supervisor-design.md`
   - `docs/product-specs/runtime-persistence-modes.md`
   - `docs/design-docs/runtime-persistence-and-session-supervisor.md`
3. 更新以下索引或关联文档：
   - `docs/product-specs/index.md`
   - `docs/design-docs/index.md`
   - `docs/design-docs/core-beliefs.md`
   - `docs/design-docs/execution-lifecycle-and-recovery.md`
4. 自检文档间的状态、引用路径和边界表述，确认没有把“当前未实现”误写成“当前已支持”。

## 验证与验收

本轮设计完成的标准是：

- 新增一份专项产品规格，且其中清楚定义了开关打开/关闭时的用户可见语义。
- 新增一份专项设计文档，且文档比较了候选路线并明确写出推荐方案与不选原因。
- `docs/product-specs/index.md` 与 `docs/design-docs/index.md` 已登记新文档，状态与正文一致。
- 当前实现文档没有被误改成“已经支持真实进程跨 VSCode 生命周期存活”。

本轮不要求自动化测试，因为没有实现代码路径；本轮的主要验证是文档链路完整、边界表述一致、未确认内容没有被误写成结论。

## 幂等性与恢复

- 本轮所有文档编辑都可重复执行；如果后续改变推荐路线，应直接修改正式规格和设计文档，而不是在聊天或临时备忘录里留下第二套事实来源。
- 如果实现阶段证明会话监督器方案在某个环境不成立，应在设计文档中下调验证状态或改写候选方案，而不是继续把“真实 runtime persistence”写成已确定能力。

## 证据与备注

本轮最关键的现状证据如下：

    当前宿主持久化入口：
    src/panel/CanvasPanelManager.ts
    - loadState() 通过 workspaceState 读取 STORAGE_KEYS.canvasState
    - persistState() 把 this.state 写回 workspaceState
    - loadStoredSurface() / persistActiveSurface() 记录最后活跃 surface

    当前恢复边界：
    docs/design-docs/execution-lifecycle-and-recovery.md
    - Agent: 扩展重载后 best-effort resume
    - Terminal: 扩展重载后仅标记 interrupted

    当前用户目标：
    功能体验.md 第 4 条
    “持久化 Agent和Terminal (即页面退出, AGENT仍在后台执行不受影响)...”

## 接口与依赖

本轮设计文档会正式提出以下未来接口边界，但当前仓库里它们还不存在：

- 配置开关：`devSessionCanvas.runtimePersistence.enabled`
- 独立会话监督器进程：负责拥有长期 `Agent` / `Terminal` 子进程
- 扩展到监督器之间的本地 IPC 通道：用于创建、附着、分离、停止、查询和回放会话
- 独立于 `workspaceState` 的会话日志与注册表存储：用于在 VSCode 关闭后仍保存长期运行时所需数据

本次修订说明：2026-04-08 15:18 +0800 新增设计阶段计划，正式收口运行时持久化与会话监督器主题，并同步专项规格与设计文档。
