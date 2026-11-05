# 修复 PR362 的 Agent 等待误判与重跑提示

本 ExecPlan 按 `docs/PLANS.md` 持续维护；承接 `docs/design-docs/pr362-ci-failure-investigation.md` 的已确认现场与受控机制。

## 目标与全局图景

真实 TUI 当前仍展示工作状态时，不得仅因静默或可编辑 composer 将 Agent 置为等待输入；完成后应仍在原有预算内进入等待。部分重跑不能消费另一轮的工件，需在消费前给出明确的完整重跑提示。保留原始独立 TUI 验收，不延长超时或删断言。

## 进度

- [x] (2026-11-05) 核对远端 main 仍为 `23418301`、PR head 仍为 `545036a3`；继续使用独立调查分支，保留两处既有未提交内容。
- [x] (2026-11-05) 扩展原实际 Host 测试，修前静态 Working 超过3秒被误判 waiting-input，新增断言失败。
- [x] (2026-11-05) 使用现有tracker当前屏幕保护启发式，补 owned Host 状态转换/恢复与容量计数诊断；完成擦除/重绘及原身份回归通过。
- [x] (2026-11-05) 14个计划消费者及最终verifier增加同轮次前置检查；补实际子进程合同与CI文档。
- [x] (2026-11-05) Host定向10、adapter105、Supervisor136、门禁211通过；121个原CI屏幕回放、tracker/attention、类型检查与显式生产资产构建通过。
- [x] (2026-11-05) 全量Host的reset首败已在未修改main相同环境复现，未混入修复；真实CLI前提不足已记录。
- [x] (2026-11-05) 七份文档通过链接/索引/frontmatter检查，`git diff --check`通过；删除临时依赖链接，确认原工作区未被修改。
- [x] (2026-11-05) 独立subagent review未发现新的确定性blocker；三项非阻塞后续事项已写入技术债与设计文档。
- [x] (2026-11-05) 用户明确授权将独立改动提交、推送并创建新PR；目标main，不修改 #362 分支。
- [ ] 独立修复PR完整CI；旧head已取得固定CLI source/packaged真实验收，但计划保留active，不宣称门禁闭环。
- [x] (2026-11-05) #365 attempt 2 取得全部8项source/packaged真实Agent TUI通过；358项通过、唯一legacy resize失败，两个verifier为连带红灯。
- [ ] 在 #365 抽取独立fit补偿与回归，完成本地验证并推送；不改变 #362 节点尺寸、Windows输入或原分支。
- [x] (2026-11-05) 首版既有构建复现84/85列卡点；补丁重新构建后原legacy smoke通过，7项fit回归通过，本地VS Code1.119.0不代替CI固定版本。
- [x] (2026-11-05) fit补充后门禁合同212/212、typecheck、主扩展/notifier构建、七份文档检查和diff检查通过。
- [ ] 等待包含fit补偿的新head完整CI；旧head成功项目不替代新head验收。

## 意外与发现

原状态只观察原始输出时间戳，不观察当前 TUI 工作区域；历史追加 buffer 不能代表擦除重绘后的当前画面。已存在每个执行自己的 headless xterm tracker，可复用其已解析屏幕，不新建另一份终端。原 title-only 回归每 100ms 追加 spinner，不覆盖真正静默。

首次类型检查发现 findLastIndex 超出当前 ES2022 lib，已改普通循环。新 worktree 默认构建缺少六平台生成资产，显式指定既有资产集合后通过，没有用stock降级。全量Host首败为未修改main同样失败的reset同步closing断言，与本次tracker/状态改动无关的基线证据已保存。

## 决策记录

2026-11-05：#365首版明确排除了 #362 的fit修复，现同一发布门禁实际出现旧会话84/85列卡点，补入最小有界fit修复而非盲目重跑或整体引入 #362。新增helper单次最多两次proposal/fit，两次都遵守snapshot shrink guard；在两个Webview入口调用，只上报实际行列。测试加入regression catalog并更新精确任务数359→360；不放宽原legacy smoke断言。新head必须重新取得完整CI。

2026-11-05：不把测试 hook 接到产品，不通过加长静默阈值修补。优先用当前终端明确的工作状态阻止启发式提前完成，当前屏幕尚有解析工作时不据旧屏幕转换；原静默降级仅适用于没有明确工作证据的情况。当前画面检测仍是启发式，不宣称获得供应商权威回合协议。

2026-11-05：局部重跑暂不实现跨 attempt 信任链；在消费者下载前检查原 producer attempt，明确失败并提示完整重跑。保持原工件名称、验真与 acceptance 规则。

2026-11-05：显示检测约束在末尾工作区域与composer相邻行/interrupt footer，排除正文提及与回答隔开的历史工作行；明确此为启发式而非权威回合协议。修复后离线回放原CI样本只计为屏幕回放，不计为模型重跑或发布验收。

2026-11-05：按用户明确指示独立交付修复PR，覆盖通用状态判定与CI重跑边界，不将改动推到 #362。分支从main切出，提交前远端main仍为23418301；推送前继续fetch/rebase，不合并main到主题分支。审查后只补三项后续债务和交付说明，没有改变已审查代码。

## 结果与复盘

#365首版远端attempt 2已通过8项真实Agent TUI场景，仍被唯一legacy resize产品失败阻塞；旧结果不替代包含fit补偿的新head。本轮补丁在本地先复现旧构建的同形失败，再通过相同未改动的legacy smoke，保留独立PR范围。证据为 `/tmp/pr365-fit-repair/before.log`、`after.log` 和 `build.log`，主扩展生产资产与notifier构建通过；本地VS Code1.119.0与正式1.142.0的差异明确保留。

本地实现、回归与文档已完成，正式方案见 `docs/design-docs/pr362-ci-failure-investigation.md`。原 CI 的具体转换分支缺失仍是历史事实；本次修复阻止已识别当前工作画面被静默/prompt覆盖，并补后续取证。实际CLI版本不符且缺少DEEPSEEK_API_KEY，尚未完成真实source/packaged与远端完整验收，不能称PR已绿色。用户已授权独立提交/推送；新PR需基于自己的准确输入完整运行，而非只重跑失败jobs。

## 上下文与定向

`extensions/vscode/dev-session-canvas/src/common/serializedTerminalState.ts` 持有实际 headless xterm。`agentActivityHeuristics.ts` 解释 prompt、spinner、静默；`CanvasPanelManager.ts` 和 `runtimeSupervisorMain.ts` 决定节点生命周期。`.github/workflows/ci-validation.yml` 的 resolve job 生产冻结计划，后续任务下载带 run/attempt 的工件；`release-preflight.yml` 生产并核验合并控制文件。

## 工作计划

第一里程碑增加原始 CI 形状的当前终端工作/完成对照、长静默和 prompt/spinner 回归，记录修前失败。第二里程碑在现有 tracker 提供有界当前屏幕读取，在原判定边界使用明确工作状态并记录不含正文的转换原因；验证结束重绘不误恢复运行。第三里程碑补 producer attempt 前置拒绝及合同，然后运行相关测试、类型检查、构建与文档验证。

## 具体步骤

fit补充在本工作区运行 `npm run test:terminal-fit-convergence`、`npm run test:ci-gates`、`npm run typecheck`、`npm run build -- --execution-assets-set ../dev-session-canvas4/generated/execution-assets`，再以 `DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=legacy-supervisor-upgrade npm run test:smoke` 执行旧Supervisor真实场景。可显式使用本机缓存VS Code，记录实际版本，不冒充CI固定版本。原始CI证据在 `/tmp/pr365-attempt2/`，新本地证据单独存放，推送前fetch/rebase最新main。

工作目录为相邻 `ci-pr362-failure-investigation`。使用原 workspace 锁文件一致的依赖，避免改变全局 CLI。优先运行 `node scripts/test/test-host-execution-owner-wiring.mjs --name-pattern 'Agent|agent'` 的更窄相关子集、`node scripts/test/test-execution-attention-signals.mjs`、`node scripts/test/test-serialized-terminal-state-tracker.mjs`；workflow 使用 `npm run test:ci-gates`。具体结果随推进补记。

实际执行Host子集为 `node scripts/test/test-host-execution-owner-wiring.mjs --name-pattern 'owned Agent title-only|S10 Host Agent input commits|owned attention'`，10/10。另执行 `node scripts/test/test-execution-session-adapter.mjs`（105 cases）、`node scripts/test/test-supervisor-execution-owner-wiring.mjs`（136/136）、`npm run test:ci-gates`（211/211）、`npm run typecheck` 和 `npm run build -- --execution-assets-set ../dev-session-canvas4/generated/execution-assets`（通过）。新门禁合同包含正/负轮次和真实setup子进程。

全量Host失败后，用 `git archive HEAD` 导出干净 `23418301` 至 `/tmp/pr362-ci-repair/baseline`，相同依赖下运行 `node scripts/test/test-host-execution-owner-wiring.mjs --name-pattern 'single-root real reset preserves state'`，同在536行失败，保留原测试而不改无关reset。

## 验证与验收

静默至少 3 秒且当前 TUI 显示工作，节点应保持 running；带 prompt 的工作画面不得提前等待。工作画面擦除、真实回答和 composer 重绘后应收敛等待，标题更新不干扰。当前屏幕尚未解析、退出、替换、停止不能产生旧身份投影。错误 attempt 在下载前失败，正确 attempt 继续既有核验。完整 CI 未运行时不宣称 PR 绿色。

## 幂等性与恢复

不变更原工作区，不全局安装 CLI；调查/修复阶段原先不提交或推送，现仅按用户授权提交独立分支并创建PR，不合并或更新 #362。临时证据留在 `/tmp/pr362-ci-repair/`；可重复运行定向测试。生产错误不通过重跑吞掉；不关闭安全或来源检查。

## 证据与备注

首败与两条原始受控误判见调查文档。`/tmp/pr362-ci-repair/before.log` 保存修前静态工作误等待，`final-targeted.log`、`targeted.log`、`supervisor.log`、`gates.log`、`build.log` 保存本地结果，`host-baseline.log` 保存干净main同现的reset失败。原CI三份工件中的121个Codex/Claude屏幕，工作/完成识别均符合独立证据。

    before: A static working indicator is not completion (waiting-input != running)
    after: Host execution owner wiring: 10/10 passed
    adapter: 105 cases passed
    Supervisor: 136/136 pure cases passed
    CI gates: 211 passed, 0 failed

当前仅检查前提，未启动真实CLI：DEEPSEEK_API_KEY不存在；系统Codex0.166.0/Claude2.1.295，验收固定0.157.1/2.1.280。未全局安装或更改用户凭据。

## 接口与依赖

复用现有 xterm 与测试 fixture，不新增依赖。屏幕读取必须有界、不序列化整个 scrollback；日志仅记身份、原因和时间差，不保存终端正文。

更新记录：2026-11-05 从调查进入修复，明确当前屏幕判定与同轮次拒绝策略，保留真实验收边界。

2026-11-05 更新：完成本地实现与先红后绿回归，补121个原始屏幕回放、完整门禁回归及干净main的Host基线失败；同步正式设计与技术债。仍待固定CLI及远端CI，保留active。

2026-11-05 交付更新：独立审查后登记文本碰撞、Supervisor恢复与长composer窗口边界；按用户授权单独创建修复PR，明确与 #362 的范围和验收分离。
