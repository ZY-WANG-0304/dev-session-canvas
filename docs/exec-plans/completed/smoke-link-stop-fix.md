# 修正链接页面等待与 owned 停止断言

本 ExecPlan 按 `docs/PLANS.md` 维护，承接 PR #314 在 `13ca68c8` 已定位的两项测试问题。

## 目标与全局图景

链接 smoke 在原执行的新正文真正显示后再激活或悬停，停止 smoke 依据当前 owned 执行的真实退出、保存与页面确认判断成功。保留实际文件行列、URL/图片打开、tooltip 和 Codex 收尾提示验证，不依靠固定延时或错误重试放行。

## 进度

- [x] (2026-10-10) 核对当前 PR head、`origin/main@78c58c2a` 和既有定位证据，恢复测试依赖。
- [x] (2026-10-10) 已实现链接新正文标记/页面等待、停止原身份事实断言及直接 owner 回归，新增默认独立阶段。
- [x] (2026-10-10) helper/runner 检查与 Host 停止 2/2 通过；默认 VSIX 前七阶段通过，包括完整 local-links-and-stop。
- [x] (2026-10-10) trusted 链接/Codex Stop 通过；随后在 Claude Stop 的旧 recentOutput 等待失败，已迁移相邻用例并加入独立阶段。
- [x] (2026-10-10) 600ms 页面应用延迟对照完整通过，临时延迟已移除；最终默认七阶段通过，trusted 通过本轮三个原用例，随后遇到独立恢复策略阻塞。
- [x] (2026-10-10) 同步设计、证据和技术债并归档本轮计划；提交与推送由本次 PR314 更新承载。

## 意外与发现

前轮已证明 Host 发正文早于页面 xterm 应用，旧 Stop 文案/诊断来自未执行的 legacy 分支。另一次 URL 已检测但 tooltip 不可见的现象未归类；本轮保持该断言并通过。最终默认执行触达新用例 `verifyClaudeExplicitSessionIdPreservesResumeContext`：显式 ID 存在但恢复策略为 none；这不是运行期 recentOutput 等待，单独登记，不改原断言。

## 决策记录

- 决策：一并迁移相邻 Claude Stop 的运行期输出等待，保留原停止/恢复断言。理由：默认原顺序已触达并证实同类旧字段超时，属于本次停止测试迁移范围。日期/作者：2026-10-10 / Codex。

- 决策：在原链接正文之后打印每次独有的结束标记，等待原执行输出及目标页面中的“正文+标记”，复用既有 probe 并允许终端软换行。理由：避免 Host 发出即视为页面完成，也排除旧历史与命令回显。日期/作者：2026-10-10 / Codex。
- 决策：Stop smoke 检查原身份的 stopped/0、SIGINT 收尾、单次终端退出、saved 与页面 applied，直接 stopRequested/单次 requestStop 在已有 Host 测试层验证。理由：旧 session 私有诊断不属于 owned 路径。日期/作者：2026-10-10 / Codex。
- 决策：新增默认 local-links-and-stop 阶段复用完整链接、Codex Stop 与 Claude Stop 三个原用例，trusted 原顺序仍保留。理由：独立覆盖本次修正，避免前序无关 UI 失败遮蔽验证。日期/作者：2026-10-10 / Codex。

## 结果与复盘

链接等待、owned Stop 事实断言和相邻 Claude Stop 旧字段等待已修正；定向 Host/helper 与 600ms 页面延迟对照均通过。最终默认七阶段及 trusted 原顺序的三个原用例通过，完整 gate 因下一用例 Claude 显式 session ID 的 resumeStrategy=none 失败，该独立问题已登记技术债。未修改正式产品源码、版本号，未合并或发布。

## 上下文与定向

工作目录 `/tmp/dscr`，分支 `investigate-smoke-reload-autostart`。`tests/vscode-smoke/extension-tests.cjs::verifyExecutionTerminalNativeInteractions` 覆盖文件、图片、cwd、多行结果、搜索及 URL；原 helper 只检查 Host 输出。页面 probe 的 terminalVisibleLines 是 xterm 当前可见行，应检查新标记和正文一起出现。

本轮开始时，`verifyStopVsQueuedExitRace` 已按原 executionId/generation 等待 sleeping 并及时 Stop，但仍检查旧摘要/私有诊断；现已迁移到原执行的实际终态。原执行退休表示进程/资源、终端输出、保存和页面责任均已完成。`scripts/test/test-host-execution-owner-wiring.mjs` 已有两项 stop 单次请求、尾部持续消费和完整结算测试，可直接检查原 owner。

## 工作计划

第一里程碑在 smoke 本地收敛打印/页面等待，覆盖全部链接输出及重开页面后复用的链接；修改停止用例的原身份断言，保留输出和一次退出要求。在既有 Host 用例补充 stopRequested 断言，并把独立阶段接入 `scripts/smoke/run-vscode-vsix-smoke.mjs`。完成后语法和定向检查通过。

第二里程碑运行默认 VSIX smoke，验证独立新阶段和 trusted 原顺序。必要时保存失败现场并单独复验；任何新未知项都写入技术债，不把局部通过或临时控制入口当作完整 gate 通过。

## 具体步骤

在 `/tmp/dscr` 使用 Node 22，依赖停放于 `.debug/rca`，使用前恢复。执行：

    export PATH=/tmp/dsc-release-node22/node_modules/node/bin:$PATH
    node --check tests/vscode-smoke/extension-tests.cjs
    npm run test:smoke-execution-output
    npm run test:smoke-reset-fixture
    npm run test:vscode-smoke-runner-env
    DEV_SESSION_CANVAS_HOST_TEST_FILTER='stop waits for facts while tail consumption continues' node scripts/test/test-host-execution-owner-wiring.mjs
    DEV_SESSION_CANVAS_EXECUTION_ASSETS_SET=/tmp/dsc-release-026-assets DEV_SESSION_CANVAS_VSCODE_EXECUTABLE=/tmp/dsc0261v/.vscode-test/vscode-linux-x64-1.141.0/code npm run test:vsix-smoke > .debug/link-stop-fix/vsix.log 2>&1

## 验证与验收

独立阶段须完成全部文件/行列、图片、搜索、URL/tooltip 断言，并确认 Stop 的原执行 saved/applied、单次退出和 SIGINT 收尾，不能只通过打印标记。默认全 gate 另行判断；Host 定向预期 2/2、正文 helper 14/14、reset fixture 19/19。本轮 600ms 页面应用延迟对照已证明新等待覆盖异步队列；在临时 checkout 应用 `docs/references/smoke-reload-autostart/link-page-wait-validation.patch`，以 `DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=local-links-and-stop` 运行上述 VSIX 命令可复跑。延迟仅用于验证，已移除，不能进入正式产品源码。

## 幂等性与恢复

每次打印标记唯一，失败即失败，不自动重启或换执行。重跑前保留 `.debug/vscode-vsix-smoke` 的失败 artifacts 到本轮目录。临时控制与探针恢复后检查源码 diff；结束时依赖移回 `.debug/rca`，推送前 fetch/rebase 最新 origin/main。

## 证据与备注

根因证据为 `docs/references/smoke-reload-autostart/link-stop-investigation-evidence.json`。本轮日志放 `.debug/link-stop-fix/`；精简验证记录为 `docs/references/smoke-reload-autostart/link-stop-fix-evidence.json`。最终日志 `vsix-final.log` 的 exit 1 对应下一用例恢复策略超时，不能宣称全 gate 通过。

## 接口与依赖

仅复用既有原执行输出/退休 helper、页面 probe 和诊断，无新产品接口。需要 Linux native PTY、VS Code 1.141.0、Node 22 及 fake Agent。

修订记录：2026-10-10 创建，正式落实已确认的链接同步和停止断言迁移。

修订记录：2026-10-10 完成实现及延迟/默认原生验证，记录相邻 Claude Stop 修正与新的独立恢复策略阻塞后归档；完整 gate 的失败边界单独保留。
