# 同步新建节点对齐的 smoke 验收

本计划按 `docs/PLANS.md` 维护。工作目录是 `/home/users/ziyang01.wang-al/projects/dev-session-canvas.worktrees/canvas-node-creation-alignment`，在已有实现上补充测试，不修改其他 worktree。实现阶段未提交；2026-11-05 用户已授权提交、推送并创建 PR。

## 目标与全局图景

让 CI 正式接纳新增浏览器用例，并让源码和 VSIX 的独立 smoke 验证真实扩展宿主接收 `creationAnchor` 后的对齐、避障、组扩容、root-local 转换和保存恢复。`creationAnchor` 是右键时原始画布位置 P 与缩放值；无该字段的命令入口继续使用首选位置，不能把所有生命周期 fixture 都改成右键语义。

## 进度

- [x] 2026-11-05：复核目标 worktree、设计和 smoke 登记机制；确认浏览器清单缺一项、真实宿主 smoke 未发送 anchor。
- [x] 2026-11-05：更新正式设计并实现独立创建 smoke、执行目录、可追溯清单和等待预算。
- [x] 2026-11-05：同步 423 项浏览器清单，17 项定向浏览器通过；旧 QuickPick、Explorer、整理和尺寸 smoke 通过。
- [x] 2026-11-05：三项新建节点与 saved-size 同轮源码 Host 通过；211 项 CI 回归、typecheck、文档和 diff 检查通过，记录同批 VSIX 未执行边界并归档。
- [ ] 2026-11-05：按用户授权提交变更，rebase 最新 main，复验与默认尺寸/运行时修复的交叉影响并创建 PR。

## 意外与发现

正式浏览器门禁比较完整测试 ID，而非只看退出码。源码/VSIX 共用 `scripts/smoke/smoke-catalog.mjs`，`scripts/smoke/smoke-implementation-map.json` 与设计 coverage-map 必须同步。VSIX runner 还要求冻结计划及同批双包回执；不能拿任意旧包声称当前源码已通过。

新 case 也必须生成 `scripts/smoke/smoke-budget-inventory.json`，否则冻结计划报 `No bounded suite inventory`；默认完整任务数因此从 359 增至 365，相关回归同时更新。生成清单中的旧调用行号随源码移动，但对照去除行号后的结构，136 个旧 suite 的预算和调用证据完全不变。

跨 root 首次 fixture 在单 root 窗口只注入外框，不能用于验证真实多 root 保存。改为真实双 root 后，产品移动再重读仍回退：`flushPersistedCanvasStateForTest()` 漏写 overlay。新增宿主回归先复现 `actual: undefined`，只补测试入口字段后通过。最终三项新 smoke 与旧 saved-size 同轮通过，未删除持久化断言。

## 决策记录

2026-11-05：以独立产品 case 验证创建路径，复用现有真实 Host 消息分发、保存和重读接口，不增加产品专用测试分支。浏览器验证菜单到消息，Host smoke 验证消息到几何和持久化；二者不是实际鼠标右键的完整 VSCode 端到端测试。几何期望独立计算，不调用被测布局算法。

2026-11-05：source 和 VSIX runner 为 creation-root 提供真实双 root workspace，使用产品 root ID 与移动入口建立偏移。保存辅助入口必须保留 `multiRootOverlay`，不能把测试自身丢字段当作算法回归。实际验证用本机 VSCode 1.137.0 与校验过的 Linux 原生资产，只报告本地源码结果，不放宽正式 VSIX 输入要求。

## 上下文与定向

`tests/vscode-smoke/extension-tests.cjs` 的 `independentCaseFunctions` 注册准备和业务函数；每个 case 从空画布独立准备，Agent/Terminal 用 fake provider / 真 shell 启动并显式停止。`scripts/smoke/smoke-catalog.mjs` 注册后同时进入 source 和 packaged 任务。设计输入 `docs/references/release-gate-flow-audit/smoke-redesign/coverage-map.json` 和 implementation-map 只声明覆盖关系，不代表运行通过。`scripts/gates/browser-catalog.json` 使用实际 Playwright list 的 ID。

## 工作计划

第一里程碑补右键三类创建、定向避障和不修改旧节点，以及分组/root 的独立用例；使用 Host 快照断言位置，显式 flush 后重读验证位置和分组保持。第二里程碑同步三份 smoke 清单、浏览器清单和静态登记回归。第三里程碑运行几何/协议/宿主测试、门禁测试、定向浏览器和源码 smoke；若缺原生资产或同批 VSIX，只记录实际缺项，不放宽正式 runner。

## 具体步骤

在本计划工作目录执行 `npm run test:canvas-node-placement`、`npm run test:protocol-webview-messages`、`node scripts/test/test-canvas-node-groups.mjs`、`node scripts/test/test-canvas-execution-context.mjs`、`npm run test:ci-gates`。浏览器先构建当前资源，使用 `DEV_SESSION_CANVAS_BROWSER_ASSETS` 指向输出，运行 `node node_modules/playwright/cli.js test --config=playwright.config.mjs --grep 'right-click|canvas group body context menu|manually created nodes'`。源码构建后运行 `node scripts/smoke/run-vscode-smoke.mjs --scenario <新登记的case>`。Node、VSCode 和原生资产采用本机可用且明确记录的输入；正式发布验收要求另行满足冻结计划。

## 验证与验收

新增浏览器测试必须在实际发现清单中与登记 ID 一致。真实 Host 用例应证明三类新建节点按 P 对齐、障碍使节点沿同方向外移、无 P 空位不再额外偏移、旧节点的自由位置不变、组扩容及多 root 不误移其他节点，保存重读保持最终几何。测试失败要保留原失败原因和修正记录，不能用超时放宽或删除断言换取通过。

## 幂等性与恢复

保留用户已有未提交内容；新增用例使用独立 runner 用户数据和画布状态，停止本用例启动的执行后退出。临时构建与日志放 `.debug/`，不覆盖用户工作目录，不用旧构建冒充当前输入。

## 证据与备注

开始时提交基线为 `23418301`，原功能仍是工作树改动。最终 Playwright 清单 423 对 423；定向浏览器 17 passed，源码新建对齐/分组/多 root 与 saved-size 四项同轮通过。QuickPick、Explorer、布局安排在此前定向批次通过。`npm run test:ci-gates` 最终 211 passed / 0 failed，`typecheck`、几何、协议、分组、执行上下文、runner 环境、reset fixture、文档检查与 `git diff --check` 均通过。

真实 Host 使用 Node v25.6.0、VSCode 1.137.0；构建命令为 `node scripts/build/build.mjs --execution-profile=linux-owner-v1-candidate --execution-assets=../dev-session-canvas4/generated/execution-assets/linux-x64-glibc`，复用资产通过当前 owner/shared-owner/patch 哈希校验。`DEV_SESSION_CANVAS_VSCODE_EXECUTABLE` 指向相邻 dev-session-canvas7 的 1.137.0 缓存，`DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER` 最终取 `canvas-nodes/creation-alignment,canvas-nodes/creation-group,canvas-nodes/creation-root,canvas-nodes/saved-size`；调用 `node scripts/smoke/run-vscode-smoke.mjs`，`DEV_SESSION_CANVAS_SMOKE_DEBUG_ROOT` 指向本 worktree `.debug/alignment-smoke-final`。

关键日志为 `.debug/alignment-source-final.log`、`.debug/alignment-browser-tests.log`、`.debug/alignment-ci-gates-final.log` 和 `.debug/alignment-flush-before.log`。前者保留三个新增 case 与尺寸回归，最后一份记录测试 flush 漏 overlay 的先红证据；新增宿主回归修复后通过。正式 VSIX 要求固定 1.142.0、冻结计划和同批双包，本轮没有这些输入，未执行也未声称通过。

## 接口与依赖

不增加 npm 依赖，不修改产品算法。复用 `dispatchWebviewMessage`、`getDebugSnapshot`、`setPersistedState`、`reloadPersistedState`、现有执行停止屏障和 smoke catalog；测试专用 `flushPersistedCanvasStateForTest()` 补传 `multiRootOverlay`。

## 结果与复盘

同步工作已完成，未提交或推送。新增 case 的 source/packaged 目录、映射、预算、完整任务数和浏览器清单一致；三项新源码 smoke 已实际通过。测试接口丢 overlay 已通过先红后绿回归修复，无已知未修实现问题。仍待后续正式同批 VSIX、跨平台和真实鼠标手感验收，这些属于明确未执行的验证范围，不伪装为本轮通过。

2026-11-05：根据用户要求创建同步计划，明确补测范围及真实 Host 与完整发布门禁的边界。

2026-11-05 收口：补齐等待预算和六项新增 source/packaged 任务，修正真实双 root fixture 与测试 flush，记录全部本地验证和未执行范围，移入 completed。

2026-11-05 PR 准备：最新 `origin/main` 为 `72275f0c`，包含默认执行节点尺寸扩大和运行时修复。原测试结果属于 rebase 前输入，需在同步 main 后重新验证交叉路径，不直接外推原 211 项结果。
