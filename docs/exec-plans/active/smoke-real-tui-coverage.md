# 补齐四项真实 Agent TUI 覆盖

本 ExecPlan 按 `docs/PLANS.md` 持续维护。进度、意外与发现、决策记录和结果与复盘必须随证据更新。

## 目标与全局图景

在真实 Codex 和 Claude Code 的交互终端中，验证处理中输入、回答位于 footer 上方、工具或网络静默、回合完成后重绘四项行为。测试应在 CI 执行并可独立筛选，分别报告准备、业务、清理结果。真实模型回答不固定，使用本回合独立记录与实际页面比较，不以固定整段回答或被测 waiting-input 状态自证完成。

## 进度

- [x] (2026-10-28) 核对 PR340 已合并；从 origin/main 2dc6d173 创建 smoke-real-tui-scenario-coverage，保留三个用户未跟踪文件。
- [x] (2026-10-28) 核对现有真实 CLI / DeepSeek 隔离配置和手动 Actions 入口；四项目标仍 not-implemented。
- [x] (2026-10-28) 里程碑一：验证固定 CLI 的独立会话/回合完成信号及受控等待方法，记录实际样本。
- [x] (2026-10-28) 里程碑二：实现四项独立交互式用例、证据判定和有意义的反例。
- [ ] 里程碑三：接入 CI、共享目录和 source/packaged 路径，完成真实运行及相关回归。
- [ ] 同步设计、映射、技术债和结果，提交并创建 PR。

## 意外与发现

run40692812033（d41e2b20）因 Windows 旧 Node 下载失败而未进入 TUI。独立对照 run40694396583 同一公开文件出现亚秒成功和120秒不完整传输，curl 也失败；证据见 supplier-download-probe.json。持续传输被40秒硬切断的回归先红后绿，缓存命中/损坏/每次重新获取官方checksum的 localhost 测试通过。

现有 `agent-candidate-tests.cjs` 的 natural 分支使用 Codex exec / Claude -p，不能代证交互 TUI。普通 `ci-validation.yml` 尚未注册真实 agent-tui；现有真实 CLI workflow 使用独立 DeepSeek secret。当前本机 Node 为 v25.6.0，与既有真实 CLI runner 一致。

首轮信号探索 Actions 40681385645 在请求之前失败：探针错误使用 CommonJS `@xterm/headless` 的命名导入。修正为默认导入；原轮无 CLI 业务证据，不能计为产品失败或通过。本机无 DeepSeek 环境变量，但已核 repository secret 存在；私有目录安装固定 CLI，不改用户现有版本。

## 决策记录

2026-10-28 / Codex：供应商传输改为每请求120秒总期限、最多三次、40秒无字节进展才恢复，避免截断持续传输。非Linux CI 可缓存已验真的供应商原文件，每次使用仍重新下载官方校验和并复算文件 hash；不复用编译产物或业务回执。独立VM下载对照无法证明 Node 读取方式的因果差异，故不据此切换下载客户端。

2026-10-28 / Codex：沿用已有固定 CLI 与 DeepSeek 配置，先验证独立信号再确定最终接口。理由是四项验收涉及外部 CLI 行为，单纯 fake 输出和目录登记无法证明目标。固定版本当前为 Codex 0.157.1、Claude 2.1.280。

2026-10-28 / Codex：固定 CLI 实跑后选定 UserPromptSubmit / Stop hook；Claude 校验预定 sessionId，Codex 严格核开始/完成 turn_id，缺身份即失败。以受控 MCP 等待作为静默条件，明确不覆盖供应商断网。

2026-10-28 / Codex：模型未产生目标条件时报告 prepare 失败；业务失败、网络错误、证据缺失不通过自动重试刷绿。页面内容与本次实际回答对应，排除 prompt 回显、旧 session 和旧 turn。生产误判如被实证，保留原失败并修复对应逻辑。

## 结果与复盘

四项真实 TUI 已接入默认 source / packaged 门禁并创建 PR341；独立 CLI 信号探索两 provider 通过，完整合同回归 139/139、证据及真实工具/hook 8/8 通过。产品 Host 验收继续执行，尚不能宣布四项通过。探索失败、修复和后续正式输入分别记录于 docs/references/smoke-real-tui-coverage/README.md。

## 上下文与定向

任务开始时 `scripts/smoke/smoke-implementation-map.json` 中四项 agent-tui 的 destinations 为空；现已登记真实入口，152 项均为 implemented-unverified。`scripts/smoke/smoke-catalog.mjs` 是共享场景目录，`scripts/gates/catalog.mjs` 和 `.github/workflows/ci-validation.yml` 冻结并执行门禁。`scripts/smoke/run-vscode-agent-candidate.mjs` 已提供固定 CLI 检查、私有 Host、真实进程观察和报告；`scripts/smoke/agent-candidate-deepseek.mjs` 生成私有 CODEX_HOME / CLAUDE_CONFIG_DIR，并在结束后移除凭据。不得上传私有配置或原始环境。

`tests/vscode-smoke/agent-candidate-tests.cjs` 通过 Host 测试桥创建真实节点，页面探针提供 terminalVisibleLines，DOM 操作进入 xterm 输入路径。`extensions/vscode/dev-session-canvas/src/common/agentActivityHeuristics.ts` 的状态推断是被测行为（实施前核对实际路径），不能作为完成事实源。session 表示 CLI 会话，turn 表示其中一次用户提交到正常完成的回合；执行身份还需绑定原节点/PTY，CLI 回合完成不等于 CLI 进程退出。

## 工作计划

### 里程碑一：固定版本独立证据

读取官方 Codex hooks 文档和固定 CLI 帮助，核对 Claude 的会话记录与 hook。优先选择只读 CLI 记录；若必须用 hook，限定为本次私有配置，记录其事件边界及是否改变运行行为。建立有限受控等待任务，以外部开始/释放握手确认等待确实存在。完成条件为真实交互式 CLI 有当前会话、当前输入、本次回答和完成事实，并证明旧回合、错误或未完成不能满足判定。探索脚本只服务于此不确定性，验证后整理进正式测试或移除。

### 里程碑二：四项业务与反例

新增 `tests/vscode-smoke/agent-tui-*` 夹具和判定模块。每项自行建立节点、CLI 会话及回合；输入用例在待释放任务期间发送未提交文本并验证编辑区；footer 用例比较本次回答及其下方真实输入区；静默用例在确实未完成的观察窗口内采样产品状态；重绘用例在独立完成后 resize 并检查正文、状态和通知计数。每项保留同一执行与回合身份，准备失败不能跳过关键断言。新增测试针对错身份、旧回答、错误完成、缺失阶段和清理失败，不只测试目录形状。

### 里程碑三：门禁和实跑

在 source 与 packaged 测试中复用用例实现，冻结适用 provider/平台与预算并记录实际耗时。接入 CI 所需 secret，缺凭据不得记为 passed。运行四项定向真实场景及与改动相关的回归，必要时以同输入 Actions 验证；不把本地旧 native 或旧包结果冒充新输入正式验收。CI 范围、回执和缺项检查随设计同步。

## 具体步骤

全部命令在仓库根执行。已有基线命令为 `git status --short --branch`、`node --version`。里程碑一先运行 `codex --version`、`claude --version` 和隔离帮助查询，不打印用户凭据。现有配置回归为 `node scripts/test/test-agent-candidate-deepseek.mjs`，类型检查为 `npm run typecheck`。独立反例命令为 `npm run test:agent-tui`。具备固定 CLI、DeepSeek key 和已构建 source 输入时，可用 `DSC_TUI_CLI_ROOT=/path/to/private-prefix node scripts/smoke/run-vscode-smoke.mjs --scenario agent-tui/input-during-work` 做定向本地运行（同理替换另外三个 ID），本地结果不签发 Actions acceptance。正式 CI 由 `Release Preflight` 冻结预合并输入，source-host 与 packaged-host 各生成四项 job；packaged 只消费同批原 VSIX。不能直接省略其冻结计划和包回执参数。

## 验证与验收

每个 provider 的四项必须具备真实交互页面证据、当前 session/turn、对应业务断言、清理及 Host 退出结果。模型自然语言不固定，归一化只允许显示格式差异，不能删掉缺失正文。不能根据底部输入框可用、最后一行位置或静默自证回合完成。反例必须拒绝错误或陈旧信号。网络/认证错误和目标前提未建立独立报告，后续未执行为 not-run。完整 CI 必须核实际所选范围，不将模型调用次数、case 数、平台数混为一谈。

## 幂等性与恢复

每次运行创建新的私有 workspace、CLI home、证据目录和唯一身份，不读取用户会话。清理只处理本次拥有的进程及文件，清理失败使运行失败。失败先保留脱敏现场，强制回收不改写先前业务结果。三个用户未跟踪文件不修改、不暂存。

## 证据与备注

基线：PR340 merge SHA 为 2dc6d17351591a86265f1d69d420b43a23b578ee。既有模型为 deepseek-flash；Codex base URL 为 https://api.deepseek.com/，Claude 为 https://api.deepseek.com/anthropic；CI secret 名为 DEEPSEEK_API_KEY。仅记录配置来源，不记录 key 值。

## 接口与依赖

沿用现有 Node、真实 CLI、VS Code smoke Host 与进程观察器。独立证据接口应提供当前 provider/session/turn、开始/结束事实、实际回答及错误；页面证据必须另外取得。`prepareAgentTuiSuite({scenario,directory,projectRoot})` 返回两份私有 provider 配置、Host 环境和 dispose；`runAgentTuiSuite` 为 source / packaged 共用启动器。`observeTurn(events,{provider,prompt,workspace,submittedAt,toolStart,toolEnd,expectedSessionId})` 区分未提交、处理中和正常完成；Codex 要求开始/完成 turn_id 相同，Claude 要求预定 sessionId 相同。`answerWithFooter(lines,answer)` 和 `draftInComposer(lines,draft)` 单独检查真实页面。没有新增 npm 运行时依赖，CI 额外安装两份固定 CLI。

修订：2026-10-28 创建计划，明确非确定性回答、独立信号探索和 CI 交付边界。

修订：2026-10-28 第二轮信号探索 40681635343 已取得 Codex UserPromptSubmit/Stop 的同 session/turn 及实际回答；工具未允许导致工具未运行，Claude 停在首次启动 Security notes。仅修正私有工具授权和初始化步骤，不把这些失败归为产品误判。首批正式范围选定 Linux、snapshot-only、两 provider、四项 source/packaged，CLI 信号实跑仍未通过；相应入口正在接入。

修订：2026-10-28 新增 source/packaged 实际入口、独立判定反例、阶段回执及 CI secret 接线；152 项映射均为 implemented-unverified，映射不签发验收。40682240862 的 Codex 信号探索通过，Claude 菜单默认 No 导致退出，补明确 Yes 和菜单未消失不准入的判定。五组证据/反例通过，真实产品尚待运行。

修订：2026-10-28 完整固定输入合同回归 139/139 通过；原并行改目录的失败不追认。PR341 首轮 CI regression shard-2 暴露旧 VM 只提供 scenarios 而新 runner 额外读取 selectedSuites，已将真实 TUI 路由并入既有 scenarios，原退役回归 18/18 通过。Claude 启动按仓库已验证的 End/两次 Yes 采样规则修正，本地真实固定 CLI、闭合本地无服务地址且零模型请求的启动实验通过；实际观察两次 End 后唯一 Enter。发布接线/环境过滤回归通过，正式业务 CI 继续待验。

修订：2026-10-28 Actions 40683639714 的 Codex 和 Claude 信号探索全部通过。移除临时探索 workflow/脚本，正式测试保留同一私有初始化与观察器。PR341 旧输入 run40682891236 的 regression 失败保留，取消旧轮以解除排队；新输入 e4f865da 的 run40683646799 正式产品验收继续。

修订：2026-10-28 首轮产品四项 Codex source 全通过，Claude 全因 cwd 在 checkout 内向上读取 CLAUDE.md 而停在外部导入菜单。将 cwd 迁到私有凭据根下、明确断言在 checkout 外并随 dispose 删除；8/8 回归通过。首轮 systemd-user-real-reopen 第二 Host ready 超时单独保留，不归因 TUI；后续输入完整验收待执行。

修订：2026-10-28 run40686985978 attempt1 为供应商旧 Node 下载超时，整轮 attempt2 重跑。attempt2 四项 source 未创建 Agent：迁出的 CLI cwd 不属于原 Host workspace，产品正常拒绝。现将 Host workspace 和两个 provider cwd 一并隔离在 checkout 外，凭据 home 独立；本地真实 Host 已确认节点创建，另修正 Codex npm 入口受 shell 旧 Node 影响的问题，显式使用控制器 Node。纯 receipt 回答反例及 8/8 回归通过，完整业务继续待验。

修订：2026-10-28 本地实际产品 Host 的 Codex / Claude 创建及真实 composer 均通过（Node25.6.0、VS Code1.140.0、零模型 prompt），同时同步私有 Codex 已配置入口以满足产品命令一致性规则。原 attempt2 剩余任务取消；新输入继续四项完整 source / packaged 业务验收。

修订：2026-10-28 d1c54b0c 的 run40691355132 再次因 macOS ARM64 编译后旧 Node 下载 120 秒超时而无法进入 TUI。为解除重复的前置阻塞，在原每请求 120 秒总期限内增加最多三次传输恢复（单次最多40秒），HTTP永久错误/hash不符不重试，记录URL和尝试阶段；设计同步 release-gate-redesign，真实localhost传输/期限/hash反例纳入既有 native-assets 回归。模型业务仍不自动重试。

修订：2026-10-28 根据公开下载对照收敛为无进展恢复及校验后缓存，保留120秒总期限；工作流和本地回归已更新，完整TUI业务仍待新输入实跑。

修订：2026-10-28 5252b296 的完整运行40696561957六个native目标全部通过。source的input/silence/redraw均两provider通过；footer的Codex已取得正常Stop和完整页面但5秒内产品仍running，原始工件12820093629保留。临时分支diagnose/tui-completion-state仅增加测试模式output/poll/input-ack观察，复用原source native字节、重建扩展入口，三份独立样本不签发acceptance。packaged结果继续收集。另有multi-root-real-reopen第二Host editor ready超时，独立保留。

修订：2026-10-28 定向40700749341已复现：标题过滤后空输出约100ms刷新活动并取消120ms轮询；修正owned路径忽略空活动、保持标题投影。另发现Claude行内代码Markdown应与渲染文本比较，加入保留完整正文的受限inline解析及反例。首轮诊断因漏编译define进入stock路径，零模型prompt，独立保留。

2026-10-28 修复后的只读诊断run40701447849（21b7554c）三份独立footer样本全部通过，两provider各三次；原五秒状态及完整正文断言不变。此为复用原native、重建观测入口的acceptance=false诊断，最终正式输入仍需完整门禁。
