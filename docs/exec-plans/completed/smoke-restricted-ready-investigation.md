# 定位 restricted Canvas 首次 ready 超时

本 ExecPlan 按 `docs/PLANS.md` 持续维护。当前授权仅定位根因，交付可复核的故障机制、证据和修复建议；不提交产品修复、不改 ready 预算、不创建独立诊断或文档 PR、不修改发布 PR 的输入。

## 目标与全局图景

0.26.1 正式发布门禁在 restricted 工作区初次打开 Canvas 后等待 20 秒失败。调查应区分测试前提、Host 生命周期、前端启动和 VS Code 资源加载，说明真实用户是否也可能受影响。不能把单项成功或人为制造的失败当成原 CI 根因。

## 进度

- [x] 核验原输入与首败：PR327 head8313fc72，base6e708c6b，预合并9198cacb，run38665513172 attempt2。
- [x] 从最新 main 创建独立工作树；主工作区 WORKFLOW.md 未改，PR327 保持 draft。
- [x] 原日志确认 CSS/JS 读取完成，尚不能确定应用 ready 或 Host 接收。
- [x] 核对正式打开、reset、ready 与信任链路：reset及trust事件不直接清ready，等待仍需visible与应用ready。
- [x] 固定输入原单项通过，有限19个profile中取得1次同入口自然失败及完整Host现场。
- [x] 原ready期间投递导致回滚和20秒失败；原ready/ack先完成的完整restricted通过，两个因果job通过。
- [x] 同步根因设计、索引、原则、技术债及精简证据；临时workflow移除，调查归档。

## 意外与发现

原正式 workflow 没上传 restricted failure artifacts。完整日志仍保留 7,123,483 bytes，SHA256 e01c41f82793d13babb50632fe01da57c7508b793a3dfd1b67081258f874a7f6。它在02:20:02.625Z/02:20:02.635Z分别记录 CSS/JS loaded，02:20:23.021Z超时；原历史批量重开信号量耗尽不能直接解释本次。

## 决策记录

调查从 main6e708c6b 的 `smoke-restricted-ready-investigation` 分支推进，临时 CI 固定9198cacb并复用正式同输入资产。理由是保护发布 PR 输入，同时排除版本及产品代码差异。外部限时仅限制诊断资源，不改变内部20秒失败条件；首次采样先不修改产品或测试源码。2026-10-15。

## 结果与复盘

原单项run38676791045在正式9198cacb、同资产、默认npmci及VS Code1.142.0下exit0，完整restricted通过；这只排除必现失败，不追认原门禁。临时只读阶段采样使用Host wait状态/ready接收、HTML身份/前端ready阶段及test reset前后快照，4个runner每个最多6个新profile，首败即停止该runner；内部20秒和原断言不变。自然采样确认真实ready已接受却被诊断finally恢复为false；受控run38678148402 during/before两项分别smoke exit1/exit0，因果断言通过。根因机制已验证，正式修复尚未实施。原门禁failure保留。

## 上下文与定向

`scripts/smoke/run-vscode-smoke.mjs` 创建每场景独立 profile；restricted 开启工作区信任而不强制信任，运行原 `tests/vscode-smoke/extension-tests.cjs`。`runSmoke` 激活扩展、打开 editor、验证默认指南模板、reset 并清日志，再执行fake生命周期竞态诊断，随后 `runRestrictedSmoke` 再次 open 并执行 `testWaitForCanvasReady('editor',20000)`。`extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts:waitForCanvasReady` 等待指定活动面、active 模式、visible 与 `surfaceReady`，不等待 bootstrapAck。失败的应用 ready 消息与 VS Code 外层容器 ready 是两个不同事件。

## 工作计划

先从正式源码和无损日志建立时序，确认 reset 是否清 lifecycle、信任初始化是否重渲染。用临时 workflow 在 Ubuntu22.04/Node22 默认 npm ci 和 VS Code1.142.0 运行原 restricted 单项，保存返回码、failure snapshot、diagnostic events、host messages、上游日志及 staged bundle。若自然失败，分析快照后才选对照；若通过，记录范围并加入最小只读阶段记录与外部页面观察，不把重复绿测视作根因确认。受控负例必须写明人为输入和原现场对应程度。

## 具体步骤

工作树 `/dev/shm/dsc-restricted-ready`，原证据 `/dev/shm/pr327-after334-gate`，新证据 `/dev/shm/restricted-ready-evidence`。临时 workflow 固定正式 SHA9198cacbee91fc170b82578e353c16a27f3574b8，下载 run38665513172 六资产，assemble 校验输入；执行 `DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=restricted timeout --signal=TERM --kill-after=20s 180s npm run test:smoke`，日志重定向到独占目录。成功应报 Restricted workspace smoke passed；失败保存实际第一个错误与现场。阶段run38677150708使用临时commit7f092f3c，4个runner最多6次新profile；causal run38678148402使用7e47fcb7，DSC_READY_TIMING=during/before原消息投递与ready/ack前置对照。精确workflow及probe在docs/references/smoke-restricted-ready-root-cause。临时workflow在59397b38移除；不重跑完整门禁。

## 验证与验收

需给出原调用链与可验证机制，所有实验固定产品/测试/环境并具名区别诊断改动。确认原因需要失败现场或可对应原时序的受控证据；如果原工件缺失导致无法唯一归因，明确最小未确认边界及已有排除证据，不捏造最终原因。不扩大为完整发布验收。

## 幂等性与恢复

根盘已满，任务新文件在 /dev/shm；不删其他工作树、缓存或未知进程。每轮证据独占目录，保留首败；prepareRuntime会清自己指定的profile，所以禁止复用需要保留的证据目录。临时 workflow 完成后移除并归档，不另建 PR。

## 证据与备注

原 failure：runRestrictedSmoke:4766，manager bundled29473；完整 npm test 和后续 SSH/Webview/packaged 未完成。run38668578259的单项 checkpoint成功不参与本次restricted因果证明。

## 接口与依赖

沿用正式 smoke runner、debug snapshot、diagnostic events及Host dump；必要时用仓库已有 Playwright/CDP（Chromium调试接口）在独立 VS Code进程观察页面状态。无新增产品API或生产依赖。

2026-10-15修订：建立设计阶段计划，固定原输入、缺失现场及授权边界。

2026-10-15修订：原restricted单项通过并归档artifact11945644318；新增有限只读阶段采样以确认竞态，保持首败及正式PR输入。

2026-10-15发现：有限sample1第一次自然复现同20秒错误，真实ready在fake panel诊断期间接受，finally回滚editor ready=false。缺口不在资源排队；将以真实ready投递门控和诊断前完成两种时序验证跨await快照恢复因果，门控仅延后原消息，不伪造ready。

2026-10-15收口：自然失败与真实消息时序因果证据已齐，调查机制已验证。方案保持比较中，优先隔离fake诊断状态，未修复/未建PR/未放行发布。计划移completed，本轮只提交可审查的文档与证据。
