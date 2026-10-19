# 补齐非真实 Agent TUI 的 smoke 场景

本 ExecPlan 按 `docs/PLANS.md` 持续维护。

## 目标与全局图景

在 PR335 中实现原设计十五个缺口中非真实 Agent TUI 的十一项，让发布门禁实际检查页面重建、真正新 Host 的快照恢复、终态保存、Terminal 退出及重启、原生异常、Stop 升级，以及普通和压力下 resize 与完整输出。四项真实 TUI 继续明确未实现。用户应能单独筛选每项场景，看到本次执行的真实动作、原身份、结果和清理，而不是空目录成功。

## 进度

- [x] (2026-10-20) 核对 PR335 head 4e42951b，创建隔离 worktree `/dev/shm/dsc-pr335-smoke-gap-coverage`，保留其他 worktree 未提交工作。
- [x] (2026-10-20) 完成十一项目标的独立真实夹具与严格断言。
- [x] (2026-10-20) 更新目录、148/4映射、预算和反例，123个旧suite期限无变化。
- [x] (2026-10-20) Linux source十一项通过；末次加强跨Host正文后两项重跑及四Host回执通过；合同118/118，末次源码后定向6/6，owner54/54、history6、runner env及typecheck通过。
- [ ] 冻结同批新双包 packaged 与完整 Actions 验收。
- [ ] 同步设计和证据，将提交安全更新到 PR335；完整 CI 按新输入核验。

## 意外与发现

现有十五项目标均没有实际 destination，验证器明确拒绝将 proposed-gap 宣称已实现。增加覆盖必须同时修改设计状态和真正执行入口。PR335 工作树六份文档未提交，因此实现使用独立分支；不会提交其他人的草稿。

## 决策记录

- 决策：用户明确要求在 PR335 覆盖十一项，因此这些目标成为新增必跑；四项真实 TUI 保持未实现。
  理由：原设计暂缓条款已被本轮明确范围覆盖。不能以原绿色 CI 代证新增验收。
  日期/作者：2026-10-20 / Codex。
- 决策：使用真实 shell/PTY 和公开关闭原画布 tab、双 Host 进程；故障夹具只控制外部执行行为，不替换产品 Stop/resize/保存实现。
  理由：exit17 不证明信号异常，模拟 reload 不证明旧 Host 退出，metadata 尺寸不证明 PTY 实际几何。
  日期/作者：2026-10-20 / Codex。

## 结果与复盘

十一项默认入口已实现并取得Linux source有限证据；新增两个真实Host角色、原shell/provider退出及可见历史严格核验通过。失败保留并修正测试实现，没有修改产品或扩大旧期限。packaged/完整新输入Actions尚待本轮PR更新，不能继承旧输入绿色。

## 上下文与定向

`scripts/smoke/smoke-catalog.mjs` 是实际场景目录，`tests/vscode-smoke/extension-tests.cjs` 持有真实 Host 命令、原 local execution 身份、Webview DOM/probe 和原 reader/保存辅助。`scripts/smoke/run-vscode-smoke.mjs` 与 `run-vscode-vsix-smoke.mjs` 分别消费 source 和原生产双包。`scripts/gates/smoke-implementation.mjs` 检查设计到实际 helper 的映射；`build-smoke-budget.mjs` 根据调用点生成有界外层预算。真正新 Host 的场景须由 runner 先确认旧 PID 和创建身份消失，再启动 verify Host。

## 工作计划

先实现独立 Terminal 完成与重启、真实页面重建和几何/输出夹具，保留原 start、身份、最终保存及 reader 退役断言。再实现不响应中断的受控 provider 和信号异常，业务动作使用产品 Stop，安全清理不能充当业务成功。最后实现双 Host 的快照恢复和已完成终态保留，并将准备和验证角色加入回执合同。更新正式设计、152项目标映射和预算，使148项目标可达、4项 TUI 明确未实现。

## 具体步骤

在隔离 worktree 使用 Node22 与私有 TMPDIR。运行 `node scripts/gates/build-smoke-budget.mjs` 后逐项比较旧预算，运行 `npm run test:ci-gates`、必要类型/构建及原身份回归。按新场景筛选运行 source smoke 和冻结同批双包 packaged smoke，保留首败、实际回执、原 Host 退出与清理记录。

## 验证与验收

每个目标必须有实际 Host 入口和原执行身份。resize 必须比较实际子进程新鲜 TTY 几何、页面 fit 和 Host 尺寸；高输出完整性比较逐行序号及独立内容 hash，不能只看末标记。自然/非零退出不得以 Stop 达成，原生异常使用独立信号模型；Stop 不响应使用确认已忽略中断的外部夹具，验证产品有界升级及原进程退役，未知或失败仍拒绝。新 Host 恢复确认旧 Host 创建身份消失、新身份不同、无自动新执行，用户显式 Start/Resume 后才输入输出。新增 verifier 反例拒绝错身份、过期几何、缺行/乱序、未退出、伪完成和清理失败。

## 幂等性与恢复

每个场景使用私有用户目录、唯一 nonce 和受控执行。只终止本场景已捕获 PID/创建身份；失败保存现场后清理。本分支不会 rebase 或改写主线程 worktree。更新 PR335 前重新核对远端 head；若主线程已有新提交，先在隔离分支保留并整合，不覆盖。

## 证据与备注

基准PR335为4e42951bb571a17ae6f5b779e1045f637b0b5185；本轮日志/源码hash、13份真实Host回执、原退出和首败记录见docs/references/smoke-non-tui-gap-coverage/local-results.json。source-final十一项同批通过，之后只加强双Host可见正文并定向重跑通过；两者输入hash分别保存。旧完整CI不包含新增场景，不代证本轮。

## 接口与依赖

复用现有 Node、VS Code 测试命令、真实 Webview probe、公共 TTY 几何和 xterm/headless；不新增运行时依赖，不修改产品实现以迎合门禁。必要 test-only helper 只控制外部进程或校验实际观察。

修订记录：2026-10-20 按用户要求启动十一项实施；四项真实 TUI 排除于本轮范围。


后续发现与决策：Stop最终失败/unknown不能通过真实SIGKILL抵抗模型随意伪造，使用已有production owner的受控transport故障合同，纳入默认regression；真实PTY另核INT忽略后产品升级、原identity退出、final saved与reader applied。新增回归改变shard后，旧aggregate反例需按实际producer选择sibling，不写死shard。Host正文标记来自原setup实际输出，不能由状态或尚未保存快照推断。完整合同118/118后加强Host正文，仅重跑受影响六合同和两Host场景，未再次重复全部合同。所有首败日志保留。


PR335已更新c679a60f，正式39311924428固定真预合并3da5f41a（base6e708c6b/headc679a60f）；原计划ZIP摘要/producer下载已核，353项中新增11项source和packaged均required，原owner合同在Actions54/54通过。首轮shard-1失败为test-smoke-runtime-retirement实际runner方法的受控VM没注入新增process.execPath；这是本轮遗漏的测试接线，补显式outer Node路径并加prepare/launch传递断言后定向原脚本通过。原CI失败保留，不以重跑抹去；follow-up新head重新触发完整输入验收。
