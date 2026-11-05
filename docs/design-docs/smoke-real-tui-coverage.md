---
title: 真实 Agent TUI 的独立回合判定与 CI 覆盖
decision_status: 已选定
validation_status: 验证中
domains: [执行编排域, VSCode 集成域, 画布交互域]
architecture_layers: [宿主集成层, 画布呈现层, 适配与基础设施层]
related_specs: [docs/product-specs/runtime-persistence-modes.md]
related_plans: [docs/exec-plans/completed/smoke-real-tui-coverage.md, docs/exec-plans/active/pr362-ci-failure-repair.md]
updated_at: 2026-11-05
---

# 真实 Agent TUI 的独立回合判定与 CI 覆盖

## 问题与目标

补齐 `agent-tui/input-during-work`、`answer-with-footer`、`tool-network-silence`、`turn-completion-redraw` 四项缺口，在 CI 中真实执行交互式 Codex/Claude。输入区可用、回答可见和回合完成是不同事实；fake prompt、非交互 exec/-p、末行文本或产品 waiting-input 都不能代证真实回合完成。

## 候选与边界

选用私有 UserPromptSubmit / PreToolUse / PostToolUse / Stop hook 记录当前回合与工具接收事实，Claude 另记录 StopFailure/PostToolUseFailure，两个 CLI 均记录 SessionEnd。固定版本历史实跑已确认正常 Stop 提供实际回答且不继续回合；新增工具hook验收另行记录，不回填旧证据。响应流结束只证明一次请求结束，可能还需工具和后续请求，不能单独定义整个回合完成。hook 是测试观察接口，不接入产品状态推断。

沿用固定 Codex 0.157.1、Claude 2.1.280 及 DeepSeek backend 的私有配置，测试的是这些真实 CLI 配合该 backend 的行为。回答比较使用本次实际生成内容，允许终端折行等呈现差异，不要求跨运行相同文本。随机 marker 用于排除旧内容，不能仅凭用户 prompt 中的 marker 宣告回答成功。

## 验证方法

输入场景先确认工具任务未释放，验证未提交输入出现在真实编辑区且回合仍在运行。footer 场景验证真实回答和其下方的输入区/状态栏同时存在。静默场景用外部握手证明待处理工作未完成，再跨过现有静默阈值观察产品状态。完成重绘场景先确认独立完成事件，随后真实 resize 并核正文、状态和通知无重复。条件未发生是 prepare 失败，不是跳过后通过；四项各自隔离并保留清理结果。

## 正式方案

复用 `agent-candidate-deepseek.mjs` 的私有凭据配置；新增真实交互式 Host 用例。既有 natural 用例走 exec / -p，不能替代本次 TUI。模型未建立目标条件、认证失败或业务断言失败均保留失败，不自动重试。


首批默认矩阵为 Linux、snapshot-only、Codex 0.157.1 与 Claude 2.1.280。四项分别注册到 `scripts/smoke/smoke-catalog.mjs`，每项在单 Host 中顺序运行两份互不共享业务状态的私有 provider fixture；source 和 packaged 均通过 `scripts/smoke/agent-tui-suite.mjs` 执行 `tests/vscode-smoke/agent-tui-tests.cjs`。一份 provider 有独立的 240 秒绝对上限，各内部等待仍有自己的较短期限；此上限不是产品 SLA；run40701818847 的模型回合耗时为1977–5995ms，不含Host准备及清理。

`agent-tui-configuration.mjs` 只在私有配置中注册唯一等待工具和只观察的 hook。工具开始与外部释放绑定 callId，返回随机 receipt，不伪造模型输出。`agent-tui-evidence.cjs` 要求一次精确 UserPromptSubmit、同 workspace/session、未继续的 Stop，以及唯一PreToolUse/PostToolUse配对。前后事件须为 `mcp__tui__wait_for_release`、同一非空tool_use_id和空参数；PostToolUse的真实结果须包含与tool-end文件完全相同的唯一receipt。核对提交→PreToolUse→tool-start→tool-end→PostToolUse→Stop，工具端写文件不等价于CLI接收结果；缺失/失败/重复/错身份事件均拒绝，不回退旧回答匹配。Codex还核对所有事件的真实turn_id，Claude通过私有指定session和单次提交区分回合。Stop实际回答只要求非空且不是原prompt，不要求英文或逐字复述receipt；随机receipt仍用在结构化结果链，而非模型措辞。hook返回空JSON，不修改结果、不阻断或继续回合；凭据仍在临时私有home；Host workspace与两个CLI cwd均位于checkout外，两个cwd是Host workspace的子目录，满足产品执行目录约束；凭据home不在该workspace内。避免继承祖先CLAUDE.md/AGENTS.md，结束后删除工作目录与配置。Codex JavaScript入口显式使用控制器Node，防止交互shell的PATH切换到旧Node；Claude原生入口直接执行。工具等待期间不产生新正文，TUI可继续绘制spinner；此受控条件不宣称验证供应商断网重连。

正文先解析文本、行内代码、强调及换行的已知Markdown显示语义，再只归一化空白与终端零宽字符；要求整个本次回答从助手标记行（Codex `•` / Claude `●`）开始且位于真实输入区上方。不再搜索整个屏幕任意位置，防止工具结果/输入回显冒充回答；未知Markdown结构仍拒绝，不通过删词修补。输入用例检查随机草稿在composer行，且没有第二次UserPromptSubmit。完成后改变节点尺寸，检查xterm列数确实变化，再连续采样状态、回答和通知。原executionId/generation全程不变；产品Stop、原持久化/reader退役与Host清理另行记录。清理错误不覆盖先前业务首败。

## PR365 回执复述耦合修复（2026-11-05）

run41952850152 / head da217a50的source input-during-work中，Codex通过；Claude Code2.1.280使用deepseek-flash，工具receipt为 `receipt_db742b96b367456eb1753739466c08d6`，实际回答为 `The test controller returned receipt db742b96b367456eb1753739466c08d6.`。页面与Stop一致省略前缀，29个工作态样本全部running；失败在独立回合校验，尚未完成后续显示/完成态断言。原359通过/1失败保留，不将新规则倒用于旧run验收。

仅允许省略receipt_仍依赖模型精确复制随机串，因此不选。选定结构化工具接收证据与实际回答分离；[Codex hooks文档](https://developers.openai.com/codex/hooks)及固定0.157.1源码确认PreToolUse/PostToolUse和调用/结果字段，[Claude hooks文档](https://code.claude.com/docs/en/hooks)说明工具专属结果由PostToolUse提供。两者只观察，不通过hook生成、重写回答或要求重试。新接口仍需固定CLI真实CI验收，历史覆盖不代表本轮新合同已通过。

固定接口核对：Codex `rust-v0.157.1` 的 `hooks/src/events/post_tool_use.rs`、`core/src/tools/handlers/mcp.rs`及其测试确认规范工具名、tool_use_id、解析后的tool_input和带content的MCP结果对象。临时下载官方npm `@anthropic-ai/claude-code-linux-x64@2.1.280` 并确认版本，随包代码中MCP工具返回 `data: result.content`，PostToolUse接收该data，因此Claude结果为content数组。校验器按provider选择这两种固定封装，不把结果JSON任意转字符串搜索receipt；CLI版本不改，全局安装不改。hook只保存本测试工具的input/response，不保存其他工具正文；额外工具名/调用仍触发拒绝。

本地新增用例先在旧实现得到3项失败（不同措辞被拒、缺失接收仍被接受、正文可从非助手行误匹配），新实现 `test:agent-tui` 13/13通过。包含真实Node hook进程和真实stdio MCP工具的受控往返、结果字节比对、中文/不同措辞/不带receipt回答、缺失/重复/错session/错turn/错调用/错回执/错误顺序/工具失败等反例；它们不是实际CLI模型调用。`test:ci-gates` 212/212、`test:smoke-lifecycle-isolation`、typecheck、语法及八份文档检查通过。预算清单只更新driver源hash（提前保存toolEnd便于首败取证），未改变等待、provider上限、任务数量或required规则。日志在 `/tmp/pr365-tui-receipt/`，本地DEEPSEEK_API_KEY缺失，新head固定CLI source/packaged完整CI仍待执行；旧run缺失Pre/Post事件，不能补造后倒签新验收。

CI 在 `ci-validation.yml` 的四项 source/packaged job 安装固定 CLI，只有这些 job 的执行步骤获得 `DEEPSEEK_API_KEY`。调用链从 release-preflight / publish release-validation 显式传递该 secret；缺失、认证失败、目标前提未发生都不能被当作通过。初步回合接口探索仅提供 acceptance=false 的 CLI 证据，不能替代产品 Host 验收；完成探索后移除临时 workflow 和脚本。

## 当前验证证据

run40701818847 的 head97fa646f、预合并输入7c3c412dbe1cde4798112100d17f0443ec51b7c6：四项source/packaged两provider共16次全部通过，正常Stop、完整正文、状态/草稿/重绘、原执行保存/reader/退役和Host退出均已复核；packaged四项消费同批原VSIX。完整合同139/139、Host接线648/648、证据9/9及typecheck通过。验证结论只覆盖固定Linux/snapshot-only/CLI版本和DeepSeek配置。

该轮另有packaged surface-continuity--live-page-remount在Terminal准备阶段等待Host消息超时，故整轮不能签发完整acceptance，PR未获得可合并结论。历史探索、失败、根因与实际回执见 [验证记录](../references/smoke-real-tui-coverage/README.md)；其他平台、真实供应商断网及旧Host间歇问题仍分别保留。

## 完成状态与正文渲染的实跑修正

run40696561957 的 source footer / packaged silence 在 Codex 正常 Stop 后仍为 running。定向 run40700749341 记录到约100ms一次、标题过滤后长度为0的输出；`consumeNonNativeHostBusinessOutput` 仍刷新lastOutput并重排120ms轮询，使轮询长期无法执行。修正规则为：标题继续更新与投影，但空的可观察输出不记录Agent活动、不取消已有轮询；真实正文、控制序列和spinner仍保留原行为。以真实owner接线回归确认持续标题更新不延后完成，处理中真实spinner不提前完成。

同轮诊断Claude在正常回答里用行内代码包裹receipt，页面去掉反引号，而hook保留Markdown。证据比较使用现有markdown-it解析本次完整回答，仅允许文本、行内代码、强调和换行的已知显示语义；未知结构拒绝，转为显示文字后仍只归一空白和零宽字符，不能删除缺失词句、receipt字符或字面反引号。原prompt/turn/tool因果检查不变，不要求模型遵循固定文案或格式。

## 主题提示与 Codex readiness 误判

2026-11-02 的 `Release Preflight` run `41340087830` 在 packaged `agent-tui--input-during-work` 的 Codex prepare 阶段失败，尚未提交模型 prompt。失败页面已显示 Codex composer 和 DeepSeek model/context 行；其普通 `Tip: Use /theme to choose a syntax highlighting theme.` 被宽泛主题菜单匹配器反复识别为首次主题选择，夹具因此持续发送 Enter 并最终超时。该失败是测试启动判定缺陷，不能作为产品 Agent 场景通过或失败的证据；同轮其他结果不覆盖原失败。

修复将主题提示匹配集中到 `agent-startup-prompts.cjs`，先排除普通 `Tip:` 行，再保留已有主题菜单文案识别；agent TUI、候选验证和 Runtime reload driver 共用该判断。`test:agent-tui` 增加原失败页面提示与有效主题菜单的对照。正式 release acceptance 仍需对新的固定输入重跑完整任务图；原 run 的红灯和工件保持历史事实。

PR #358 review 进一步发现 Runtime reload 的 composer 二次确认仍假设所有启动提示都是 RegExp，且源码抽取测试没有注入新增 helper。修复让初次与二次 readiness 检查共用支持函数和 RegExp 的 matcher，并在测试编译上下文提供 helper；新增 Codex 普通 `/theme` help tip composer 确认回归。修复 head 的 `test-agent-runtime-reload-driver.mjs` 为46/46、`test:agent-tui` 为10/10、`test:ci-gates` 为203/203，语法检查及 `git diff --check` 通过。此前 PR head 的 Release Preflight 不覆盖本次更新，完整发布验收仍需在更新后的固定输入上重跑。
