# 定位链接检测与停止断言的剩余阻塞

本 ExecPlan 按 `docs/PLANS.md` 维护。本轮仅定位 PR #314 在 `9610f44e` 的两个剩余失败，正式修复另行收口。

## 目标与全局图景

区分终端链接未检测到是页面/路径解析功能缺陷还是测试先于页面输出发起扫描；区分停止用例失败是停止动作异常还是旧文案和旧诊断断言未迁移。交付可复跑证据、准确因果链和修复边界，不以放宽断言换取通过。

## 进度

- [x] (2026-10-10) 核对 `9610f44e`、`origin/main@78c58c2a` 与失败工件，确认工作树干净。
- [x] (2026-10-10) 证实旧摘要/诊断断言来自 legacy 路径；原生退出/保存/页面证据完整，既有 Host 定向 2/2 通过。
- [x] (2026-10-10) 原生 URL 扫描前后无正文、随后新 probe 可见；同 3:1 链接延迟应用对照确认等待页面后正常打开。
- [x] (2026-10-10) 已恢复全部临时源码，保存精简证据与三份复跑 patch，同步设计/技术债并归档。

## 意外与发现

`writeFailureArtifacts` 保存的是最近一次 `lastWebviewProbe`，不是失败瞬间新抓取的页面。链接失败后的 finally 还会重开 editor；因此旧工件内“Session closed”不能证明链接扫描时正在显示旧历史。Host 记录已发出实际链接正文，但发出不代表 xterm 已应用。

## 决策记录

- 决策：使用只读扫描探针与受控页面写入延迟对照，不先改产品链接解析或停止行为。理由：需区分输出到达、页面应用、扫描及 Host 路径解析各环节。日期/作者：2026-10-10 / Codex。
- 决策：核对原执行停止事实，再判断旧摘要/诊断是否属于产品契约。理由：上一轮已观测 stopped/0、SIGINT 与收尾提示；旧字面量失败不能单独证明 Stop 失败。日期/作者：2026-10-10 / Codex。

## 结果与复盘

两条根因已定位：测试把 Host 发正文当成页面就绪；停止断言绑定旧分支文案/私有诊断。正式同步/断言迁移未实施，完整 gate 仍未通过。有界重复中的第三轮 URL tooltip 可见超时另行记录，尚未归类。

## 上下文与定向

工作目录 `/tmp/dscr`，主题分支 `investigate-smoke-reload-autostart`，不触碰原工作区的发布工作。`tests/vscode-smoke/extension-tests.cjs` 中 `verifyExecutionTerminalNativeInteractions` 打印文件链接后通过 Host 输出确认并调用 Webview 的测试扫描；`executionTerminalNativeInteractions.ts` 的 `findInteractionLinkByText` 在当前 xterm buffer 上逐行调用真实链接 provider。输出消息已发出与页面完成写入是两个时刻。

`verifyStopVsQueuedExitRace` 输入 sleep/exit 后在 sleeping 期间发 Stop，期待 stopped、收尾提示、旧摘要与旧诊断。`CanvasPanelManager.ts` 的 `stopExecutionSession` 对 owned 执行直接调用 owner；`persistNonNativeHostFinal` 保存实际退出结果。旧 session 的 Stop 分支另外生成 stopRequested/exited 诊断和固定文案。

## 工作计划

第一里程碑复核原生停止证据及代码来源，以原进程退出、页面最终消息和保存记录验证一次停止的效果，说明旧文案/诊断断言的来源。

第二里程碑复用当前打包 Host 和真实 xterm，在临时测试入口重跑原终端交互流程，失败时记录扫描开始/结束 buffer、各 provider 候选和对应 Host 消息。若无法自然复现，以明确控制页面应用延迟重现扫描早于正文的情况，之后在相同执行上确认正文可见并再激活，严格核对实际文件/行列。受控实验不冒充历史瞬间或完整 gate。

## 具体步骤

在 `/tmp/dscr` 恢复 `.debug/rca` 中停放的 node_modules 和浏览器，使用 Node 22。原证据位于 `.debug/lifecycle-barrier-fix/`，新日志与控制脚本写入 `.debug/link-stop-rca/`。必要时临时修改源码构建探针版，先备份原文件，完成后精确恢复。

    export PATH=/tmp/dsc-release-node22/node_modules/node/bin:$PATH
    node --check tests/vscode-smoke/extension-tests.cjs
    DEV_SESSION_CANVAS_EXECUTION_ASSETS_SET=/tmp/dsc-release-026-assets DEV_SESSION_CANVAS_VSCODE_EXECUTABLE=/tmp/dsc0261v/.vscode-test/vscode-linux-x64-1.141.0/code DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=trusted npm run test:vsix-smoke

优先使用已打包 Host 的独立入口验证，只有需要编译页面探针时重新打包；不为研究重复完整发布 gate。

## 验证与验收

停止侧需证明是否只有一次原执行退出、是否正确保存 Token usage/resume、是否有真实停止故障；明确旧诊断在当前路径是否应出现。链接侧需捕获失败时扫描依据，辨别无文本、无候选、解析失败和打开失败；正向对照必须保持原执行身份、相同链接与实际打开位置。

## 幂等性与恢复

每次原生复跑使用独立 `.debug` 目录，先保存失败工件，临时入口、探针和延迟不得进入正式实现。最后恢复源码和停放依赖。若推送研究结论，先 fetch/rebase 最新 origin/main，不合并或发布。

## 证据与备注

输入证据为 `docs/references/smoke-reload-autostart/lifecycle-barrier-fix-evidence.json`。本轮将记录源码指纹、原生/受控区别与复跑方式；证据不能超出实际观察。

## 接口与依赖

复用 `waitForLocalExecutionStarted`、`waitForOriginalLocalExecutionRetirement`、`captureWebviewProbe`、当前 Webview link providers 与 native PTY。不得新增产品接口或改变生命周期保护。

修订记录：2026-10-10 创建，两条并列根因调查以新现场证据收口。

修订记录：2026-10-10 完成两处 RCA，记录自然扫描证据、同文件3:1受控对照及停止2/2回归；严格区分缓存历史probe、有界重复失败和完整门禁。正式源码指纹与 9610f44e 一致。
