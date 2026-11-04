---
title: PR362 CI 失败分层与 Agent 工具等待误判调查
decision_status: 已选定
validation_status: 验证中
domains: [执行编排域, VSCode 集成域]
architecture_layers: [宿主集成层, 共享模型与编排层, 适配与基础设施层]
related_specs: [docs/product-specs/runtime-persistence-modes.md]
related_plans: [docs/exec-plans/completed/pr362-ci-failure-investigation.md, docs/exec-plans/active/pr362-ci-failure-repair.md]
updated_at: 2026-11-05
---

# PR362 CI 失败分层与 Agent 工具等待误判调查

## 范围与输入

2026-11-04 的调查只定位，不修改产品或 workflow；2026-11-05 用户授权后进入下述修复。两阶段均未推送或合并。调查分支 `ci-pr362-failure-investigation` 从 `origin/main` 的 `23418301f4e7496b9db5e4a89e34984b2ddd4b89` 创建，使用独立 worktree，原工作区未提交的调查记录不作事实来源。

核对 [PR #362](https://github.com/ZY-WANG-0304/dev-session-canvas/pull/362) head 为 `545036a38fa9468943bbde037a6d0e1a23536f99`。运行 `41775499320` 最新为 attempt 3；实际验证输入是预合并 SHA `0cc921f200fa2c9463dc795b300a9d6a041667f4`。下载的 attempt 1/3 packaged-host 工件 `evidence-manifest.json` 均记载此输入，不能把 PR head 与验证输入混为一谈。

## 各轮失败不是同一个问题

### Attempt 3：一个产品状态失败，两个下游红灯

[packaged-host 失败 job 126620955453](https://github.com/ZY-WANG-0304/dev-session-canvas/actions/runs/41775499320/job/126620955453) 在 `tests/vscode-smoke/agent-tui-tests.cjs:84` 断言失败：工具回合仍在执行，预期 `running`，产品为 `waiting-input`。这是 Codex 阶段的 action 失败，Claude 阶段尚未开始；不是终端尺寸断言，也不是安装、下载或清理失败。

[verify-result job 126630009454](https://github.com/ZY-WANG-0304/dev-session-canvas/actions/runs/41775499320/job/126630009454) 明确报告 `passed:361`、唯一 failed 为 `packaged-host/agent-tui--tool-network-silence/smoke/agent-tui/tool-network-silence`、`notRun:[]`、`errors:[]`。[最终检查 job 126631580135](https://github.com/ZY-WANG-0304/dev-session-canvas/actions/runs/41775499320/job/126631580135) 因 `Verifier failure cannot be hidden by an uploaded file` 拒绝验收，这是正确的失败传播，不是第三个产品问题。

同轮 source-host 同场景、source-host `legacy-supervisor-upgrade`、Windows `installed-pair/win32-x64` 成功。相同验证输入的 attempt 1 packaged-host 同场景也成功；不能据此称缺陷已修，也不能说扩大节点必然导致失败。

### Attempt 2：跨重试轮次的工件身份断裂

[source-host job 126453246292](https://github.com/ZY-WANG-0304/dev-session-canvas/actions/runs/41775499320/job/126453246292) 与 [verify-result job 126453553833](https://github.com/ZY-WANG-0304/dev-session-canvas/actions/runs/41775499320/job/126453553833) 在下载 `gate-transfer-plan-41775499320-2` 时报告工件不存在。[最终检查 job 126453675424](https://github.com/ZY-WANG-0304/dev-session-canvas/actions/runs/41775499320/job/126453675424) 同样找不到 `merge-control-41775499320-2`。随后 plan 文件 ENOENT 是连带错误，不是产品 smoke 的结果。

`.github/workflows/ci-validation.yml:120` 上传计划，`:156` 等消费者下载计划；`.github/workflows/release-preflight.yml:89` 上传控制文件，`:129` 下载控制文件。两者都用当前 `github.run_attempt` 命名。仅重跑失败 jobs 时，成功 producer 没有重新生产当前轮次的文件，而失败消费者改为请求 `-2`，故失败。完整重跑 attempt 3 重建 `-3` 输入后已越过此问题。此处已定位 workflow 兼容性缺口，但本轮不实现跨 attempt 复用；不能简单删除 attempt 后缀、取任意最新工件或回退旧 acceptance，破坏来源绑定。

### Attempt 1：remount 前的 snapshot 请求超时

[source-host job 126397677765](https://github.com/ZY-WANG-0304/dev-session-canvas/actions/runs/41775499320/job/126397677765) 的栈为 `runIndependentLivePageRemount:722 → verifyTerminalLineAndSnapshot:6276 → waitForHostMessages:12472`，错误为 `Timed out while waiting for host messages. Last messages: []`。对应精确 PR 源码，此时尚未进入页面重建，不能归因为 remount 破坏会话。该历史失败的消息丢失位置尚未确认；attempt 3 的通过不是根因修复证据。本轮不扩大为另一项 Host 消息调查。

## 最新失败的原始时间线

失败工件为 [13330985493](https://github.com/ZY-WANG-0304/dev-session-canvas/actions/runs/41775499320/artifacts/13330985493)，查看其中 `tui-fixture/codex/result.json`、`events.jsonl`、`tool-start.json`、`tool-end.json`。以下均为 UTC。

| 时间 | 已确认事实 |
| --- | --- |
| 14:06:52.104 | 原 execution 启动，终端 125×40 |
| 14:06:52.188 | `execution/inputRejected`，`owned-write-failed`，interaction capacity exhausted |
| 14:06:55.551 | 独立 CLI hook 收到当前 `UserPromptSubmit` |
| 14:06:57.013 | 当前工具调用开始，callId `2259d8b0-0706-424b-95a6-35ddfa6911c6` |
| 14:06:57.102 | 首个采样已为 `waiting-input`，页面仍显示工具调用及 Working，原 liveSession 为 true |
| 14:06:57.117 | 失败后 finally 释放工具，工具才产生 completedAt |

**不是观察 3 秒后才失败，而是工具开始约 89ms 的第一个样本已失败。** `OBSERVE_MS=3000` 是计划观察窗口，不代表本次实际观察足了 3 秒。最终工件存在 `tool-end.json` 不代表断言前工具已完成：`agent-tui-tests.cjs` 的 finally 会释放工具以安全清理。节点快照与页面 probe 是顺序采样，不是原子快照，但夹具在这两者之间没有释放工具，独立未完成前提仍成立。

输入拒绝早于 UserPromptSubmit 3363ms。`executionSessionAdapter.ts::interact` 对 pending 操作数（4）和输入字节（32768）统一报 capacity exhausted，现场没有计数、输入类型/大小或 interaction 身份，不能确定是哪一项耗尽，更不能把此错误直接写成后续状态误判的原因。

## 已确认的代码机制与归因局限

`extensions/vscode/dev-session-canvas/src/common/agentActivityHeuristics.ts::evaluateAgentWaitingInputTransition` 不读取真实工具或回合完成事实，只读取终端启发式时间戳：prompt 静默达到 220ms 即可转换，**该分支不检查 spinner**；notification/bell 静默达到 260ms 且近期无 spinner 可转换；无近期 spinner 且输出静默达到 1600ms 时 hard fallback 转换，spinner 保护窗口为 900ms。

`extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts::scheduleNonNativeAgentActivity` 每 120ms 评估，转换时直接投影 `waiting-input`，未记录 `result.reason`。`consumeNonNativeHostBusinessOutput` 会继续记录 Working/spinner，但没有据此把等待态恢复为运行态；`writeNonNativeHostInput` 在确认带换行输入已写入后才设置 `running`。因此一次短暂误判可以在后续 Working 输出出现时继续保留。

本轮用**实际 CanvasPanelManager、实际 owner adapter、受控 provider 与时钟**复现两条充分条件：已确认输入后，Working 输出静默 1700ms 会提前等待；Working 与裸 prompt 共存时，静默 240ms 即提前等待。两者随后继续输出 spinner，节点仍等待、liveSession 仍为 true。这证明产品机制存在误判路径，不是仅推测常量。

但 CI 未保存转换 reason、转换时状态、逐 chunk PTY 时间戳或输入确认时序，**不能确定原 CI 是 fallback、prompt、notification，还是某个输入确认交错触发**。尤其首个样本已失败，不能凭 1600ms 常量反推“工具静默超过 1.6 秒导致本次失败”。

上述 heuristic、CanvasPanelManager、真实 TUI 测试和两个 workflow 在 PR head 与本轮 main 中内容一致；heuristic blob 为 `1ae51511616b911fb54554c9fd920e67c4220c00`，Manager blob 为 `4b759c320d225f6a60d6f7255405410c6731caa2`。这是既有机制缺口，尚无证据证明 PR 的尺寸、fit 或 Windows unknown-write 修改是其引入点；间接时序影响仍不能排除。

## 受控验证与复现方法

本地依赖只临时链接原 worktree 的 `node_modules`，两边 `package-lock.json` 一致，不安装或替换全局 CLI。基于现有 `scripts/test/test-host-execution-owner-wiring.mjs` 的 fixture，在文件末尾的 `parseArgs` 前临时插入以下两个诊断用例，运行后删除。断言是**确认现有错误行为**，通过不等于产品修复。

```js
for (const scenario of ['silence', 'prompt-with-spinner']) {
  test(`PR362 diagnostic ${scenario} prematurely waits and later spinner does not recover running`, async () => {
    const fixture = await interactiveHostFixture('agent', 'codex');
    const output = async (sequence, text) => {
      fixture.provider.output(sequence, text);
      await until(fixture.clock, () => fixture.record.execution.snapshot().adapter.consumedThrough === sequence,
        'diagnostic output consumed');
    };
    try {
      const writing = fixture.host.writeExecutionInput('agent', 'agent-1', 'work\r');
      await until(fixture.clock, () => fixture.requests.length === 1, 'diagnostic input sent');
      fixture.reply(fixture.requests[0], { kind: 'written', writtenBytes: 5 });
      assert.equal(await completed(fixture.clock, writing, 'diagnostic input acknowledged'), true);
      assert.equal(fixture.record.business.lifecycleStatus, 'running');
      await output(1, scenario === 'silence' ? '\r⠋ Working' : '\r⠋ Working\r\n› ');
      fixture.clock.advance(fixture.clock.now() + (scenario === 'silence' ? 1700 : 240));
      assert.equal(fixture.record.business.lifecycleStatus, 'waiting-input');
      await output(2, '\r⠙ Working');
      assert.equal(fixture.record.business.lifecycleStatus, 'waiting-input');
      assert.equal(fixture.host.state.nodes.find(node => node.id === 'agent-1').status, 'waiting-input');
      assert.equal(fixture.host.state.nodes.find(node => node.id === 'agent-1').metadata.agent.liveSession, true);
    } finally { await fixture.cleanup(); }
  });
}
```

执行 `node scripts/test/test-host-execution-owner-wiring.mjs --name-pattern 'PR362 diagnostic|owned Agent title-only|S10 Host Agent input commits'`：5/5 通过，包括两个诊断、两个 title-only 基线和一个输入确认基线。既有 pending title-only 用例每 100ms 主动补 Working/spinner，因此不覆盖真正的无输出等待窗口。没有本地真实 CLI/VS Code 全链路复现，受控测试不能代证 CI 自然触发链。

原始日志、3 个对照工件、临时 patch 和本地输出保留在 `/tmp/pr362-ci-investigation/`，不是长期归档；关键结论与完整最小测试已写入本文。GitHub 工件有保留期限。

## 候选修复顺序与验收边界

2026-11-05 用户授权进入修复，执行过程见 [修复计划](../exec-plans/active/pr362-ci-failure-repair.md)。当前选定方案与本地验证见后续章节；仍未取得修复后的真实 TUI 验收。

优先在原状态转换点记录 execution 身份、旧/新状态、reason、quiet/spinner/prompt 时间差及输入确认；容量拒绝记录 pending 操作分类、计数与字节，不记录敏感正文。再用固定 CLI、同 VSIX 输入取得失败时序，选择回合完成权威证据与启发式降级策略。只增大超时、删除断言或把整个分片设非阻塞，都不能证明工具等待状态正确。

修复需要同时验证：无输出的工具等待、可编辑 composer 与活跃 spinner 共存、完成后的标题/重绘、输入写入确认与失败、原执行身份保留。测试 hook 当前只承担独立验收，不能未经产品兼容设计就直接接入产品。

调查阶段比较了“显式要求完整重跑”与“独立核验原 producer 后绑定跨 attempt 工件”，修复阶段选定前者，详细规则见正式方案。历史 snapshot 首败与最新状态误判均登记后续，不因重跑通过删除首败。

## 正式方案

### 当前工作画面优先于静默与 composer

`serializedTerminalState.ts::SerializedTerminalStateTracker.getVisibleLines()` 读取现有 headless xterm 的活动缓冲区，以 `baseY` 而非用户滚动位置为起点，只读取当前屏幕，不序列化 scrollback。待写正文、未完成解析/resize 队列、错误或已 dispose 时返回 `undefined`；队列通过独立 pending 计数保证不能把已取走但尚未解析的输入误认成空闲。

`agentActivityHeuristics.ts::evaluateAgentWaitingInputTransition` 新增可选的当前屏幕参数：`null` 表示暂不可读，继续观察而不转换；省略参数保留兼容的原始输出推断，但近期 spinner 同样阻止 prompt 提前完成。实际 Host、owned Host、Supervisor 三个轮询入口均提供 tracker 当前屏幕。

`hasAgentWorkingIndicator` 只检查末尾八个非空显示行：Codex composer 前紧邻的 `• … (… esc to interrupt)` 工作行、紧邻 composer 或末行的已知 Working spinner，以及 Claude 末行的 interrupt footer。普通正文/Tip 中提及该短语不算工作，已被回答隔开的历史 Working 行也不算。明确工作画面阻止 prompt、notification 和静默 fallback 转换，保持等待下一次真实输出，不用常驻定时轮询维持工作。当前画面擦除后不保留旧工作锁，完成后的 prompt 或原有降级判定仍可收敛；原生控制序列重绘不等于新回合。

owned Host 若已为 waiting-input 而当前画面明确仍工作，则在原执行身份、未 stop/final 的保护下恢复 running，并记录 `agent/workingIndicatorObserved`。进入 waiting-input 时记录 `agent/waitingInputHeuristicMatched` 的原身份、旧状态、reason 与输出/spinner/prompt 时间差，不保存正文。`executionSessionAdapter.ts::interact` 的容量错误补充 pending 输入/resize 数量、输入字节及本次请求种类/字节，保留原准入上限，不记录输入内容。

这是有边界的显示启发式修复，不是供应商权威回合协议。CLI 改版、未知文案、截断或尚未显示的工作状态仍可能回到原降级路径；不宣称所有静默工具情形已得到权威判定。原测试 hook 保持独立观察，未接入产品。原 CI 缺失的准确触发分支仍不能倒推。

### 同轮次前置拒绝

`resolve-plan.mjs` 输出冻结 plan 的 `producer_attempt`；`ci-validation.yml` 的 resolve job 暴露该值，全部 14 个计划消费者在下载前经 `setup-environment.mjs` 调用 `assert-workflow-attempt.mjs`。`release-preflight.yml` 的 resolve-input 输出自身 attempt，最终 verifier 在安装依赖/下载控制文件前执行同一检查。

producer 与当前 attempt 必须是相等的正整数文本；空值、异常值或旧轮次一律失败，提示 **Re-run all jobs**，不消费任意旧工件。工件名、验真、任务集合和 acceptance 语义保持不变。这是明确不支持局部重跑的操作边界修复，不是跨轮次复用实现，也不令产品失败自动变绿。

## 修复验证（2026-11-05）

修前扩展原 `owned Agent title-only` 测试：静态 Working 超过 3 秒后实际为 waiting-input，新增断言失败。修后同一实际 Host/owner/tracker 测试保持 running；带 composer 的工作静默、完成擦除、完成重绘、误等待恢复及身份绑定诊断均通过，没有删除独立 TUI 断言或放宽预算。

`test-execution-attention-signals.mjs` 与 `test-serialized-terminal-state-tracker.mjs` 通过，覆盖工作/完成/正文误匹配、60 秒模拟静默、未解析屏幕、擦除和排除 scrollback。Host 定向 10/10、adapter 105 cases、Supervisor 136/136、`npm run test:ci-gates` 211/211、`npm run typecheck` 均通过；同轮次合同实际运行 setup 子进程，错误 attempt 不写环境文件，正确 attempt 继续。首次类型检查发现 ES2022 不支持 findLastIndex，已改为普通索引循环后通过。

离线回放前述三个 CI 工件中的 Codex/Claude 121 个样本，工作样本全部识别为工作，完成样本全部不识别为工作；包含原首败样本。此为原始屏幕回放，不是重新执行真实 CLI。`npm run build -- --execution-assets-set ../dev-session-canvas4/generated/execution-assets` 使用既有六平台资产集合构建通过；默认 build 因新 worktree 未生成该目录先明确失败，未使用 stock 降级冒充生产构建。

全量 Host 测试在 `single-root real reset preserves state and owner when preparation cleanup is unknown` 的第 536 行失败；`git archive HEAD` 导出的未修改 `23418301` 基线、相同依赖与 Node 25.6.0 单独运行该用例同样失败。本轮未改 reset，也未通过跳过后声称全量成功。该基线限制与本轮定向通过分别记录。

当前环境没有 `DEEPSEEK_API_KEY`，系统 CLI 为 Codex 0.166.0 / Claude 2.1.295，不是验收固定的 0.157.1 / 2.1.280；未改动用户全局 CLI，未执行真实 TUI 全链路或远端 CI。修复后的 source/packaged、固定版本、正式合并验收仍需后续运行；本地通过不表示 PR #362 已绿色。实现、测试及边界日志在 `/tmp/pr362-ci-repair/`。

## 独立审查与交付边界（2026-11-05）

Hubble subagent 对相对 `23418301` 的全部本地修复及新增文件完成独立审查，未发现新的确定性 blocker；实际执行 Host10、adapter105、Supervisor136、门禁211、类型/文档检查和按独立tool-end时间判定的121个屏幕回放。审查未修改目标树，代码保持同一输入；后续仅补当前交付记录与技术债。

审查确认三项非阻塞后续项：正文恰与工作行重合会反向卡在running（受控新增边界，真实CLI未复现）；Supervisor进入waiting-input后不随新Working恢复（基线同现，legacy Host也没有新恢复能力）；末尾八行可能漏掉长composer上方的工作提示（函数级边界，实际CLI布局待验）。它们已登记到 [技术债](../exec-plans/tech-debt-tracker.md)，不能将本次修复描述为所有误判均已解决。精确代码与临时复现保存在 `/tmp/pr362-review/worktree/scripts/test/`，结果位于 `/tmp/pr362-review/tests.log` 和 `probes.log`。

用户明确要求独立改动提交PR：交付分支为 `ci-pr362-failure-investigation`，目标为main，只包含状态/CI修复、对应测试和证据文档，不包含 #362 的节点尺寸、fit及Windows输入修复。两者没有必须先合并 #362 的代码依赖；本修复合入main后，#362需重新rebase并取得自身的新CI，不能以本修复PR的成功替代 #362 验收。原评论虽然回贴 #362，但仅针对未提交补丁；独立PR承担后续修复审查和验收，不操作原分支或改写其未提交内容。
