# 定位四项发布验证阻塞

本 ExecPlan 按 `docs/PLANS.md` 持续维护。调查基线为 `origin/main@f57b11f970ce27f28c731d81a2ed3228ba27f67d`，工作树 `/tmp/dsci`。用户已取消 0.26.1 发布；本任务只交付可复查的诊断与后续修复边界。

## 目标与全局图景

用户可以逐项了解四个失败由什么触发、在哪里产生、怎样引入，以及应修产品、测试还是验证编排。调查结论写入 `docs/design-docs/release-blockers-investigation.md`，未修复项登记技术债。本次不改版本、不发布、不提交产品修复。

## 进度

- [x] (2026-10-09) 关闭发布 PR #308，归档 release 分支计划；从最新主线建立独立调查工作树。
- [x] (2026-10-09) 复用第 2 项历史原脚本对照：26e945ad 父提交通过，提交自身失败。
- [x] (2026-10-09) notifier 主线缺/有产物对照完成；历史 a781334e 父提交通过、子提交 ENOENT、build:notifier 后通过。
- [x] (2026-10-09) 捕获 64 列与 isWrapped 中断；加宽两项通过；7f1e1887 父提交 2 过、子提交 2 败，仅撤去恢复后 fit 调度 2 过，实验已撤回。
- [x] (2026-10-09) 原同会话 Host 消息证实 live 与正确 PWD 输出；真实方法受控 started 仍缺诊断，确认 owned local 事件缺口及默认接入历史。
- [x] (2026-10-09) 同步四项正式结论、索引、核心信念和技术债；完成差异与文档一致性检查。

## 意外与发现

此前完整 Webview 380/382 通过；本轮确认硬折行测试传入 120 列不代表实际列数，恢复后 fit 到 64 列触发混合折行缺口。相对 shell 的同会话原消息有 liveSession=true 和正确 PWD，owned 方法成功返回仍没有 execution/started。主题断言与 notifier 构建则分别由 26e945ad、a781334e 引入，父/子原脚本证据成立。

## 决策记录

- 决策：在 `/tmp/dsci` 隔离调查，发布物料留在已关闭的 #308。理由：原工作树有用户未提交内容，取消发布不应丢弃历史证据或把版本升级带入调查。日期/作者：2026-10-09 / Codex。
- 决策：优先复用原失败日志，受控实验只改变单一条件；实验代码不作为产品修复提交。理由：用户要求先定位。日期/作者：2026-10-09 / Codex。

## 结果与复盘

四项定位完成。正式文档分别记录构建依赖、源码断言、混合折行与 owned local 诊断缺口，给出触发输入、引入历史、控制实验和修复边界。发布已终止，无 tag、合并或渠道发布；产品和断言均未修改，四项修复继续开放。完整 npm test/全部 Webview/VSIX smoke 未重跑，不把定向诊断写成绿色门禁。

## 上下文与定向

根 `package.json` 编排测试，`scripts/test/test-package-vsix-file-list.mjs` 调用 notifier 打包器，依赖 notifier/dist。`scripts/test/test-theme-color-tokens.mjs` 读取 main.tsx；实际状态色 helper 已迁往 canvasNodeChrome.tsx。`tests/playwright/webview-harness.spec.mjs` 的 styled hardwrap 将路径跨 CRLF 输出，Webview 终端链接模块应重建路径并携带行列。`tests/vscode-smoke/extension-tests.cjs` 的 `verifyWorkspaceRelativeTerminalShellPathUsesWorkspaceRoot` 通过真实 VS Code 启动相对 shell，等待 CanvasPanelManager 的 execution/started 诊断。

hardwrap 指输出中存在显式换行；softwrap 是终端宽度不足时的视觉折行。owned provider 是由 Host/Supervisor 所持生命周期对象管理的原生 PTY 执行路径，与旧 bridge 路径分别核对。

## 工作计划

里程碑一回收构建与主题两项：读取 npm 编排和 git 历史，以原脚本证明 notifier 缺失/存在时的差异，以既有主题引入前后日志证明位置断言漂移。里程碑二追踪硬折行输入：从 xterm buffer 到候选生成、宿主解析、测试激活，改变路径长度/颜色/缩进中的一个变量，证实最早分歧并寻找引入点。里程碑三追踪 shell：从原 smoke 事件提取同一节点事实，比较 owned 与旧启动分支，在短路径真实宿主或受控加载真实方法中证明超时条件。各里程碑完成即更新正式文档，最后统一注册索引与债务。

## 具体步骤

主线命令在 `/tmp/dsci` 根目录执行，Node 22 可用时设置 `PATH=/tmp/dsc-release-node22/node_modules/node/bin:$PATH`。先 `npm ci`；默认构建设置 `DEV_SESSION_CANVAS_EXECUTION_ASSETS_SET=/tmp/dsc-release-026-assets`，只复用通过源码与依赖校验的六平台原生资产。

    npm run build
    npm run test:package-vsix-file-list
    npm run build:notifier
    npm run test:package-vsix-file-list
    node scripts/test/test-theme-color-tokens.mjs
    node scripts/test/run-playwright-webview.mjs --grep 'styled hard-wrapped code paths'

前一次 file-list 预期缺少 notifier/dist，后一次应通过；主题预期原断言失败。浏览器缓存使用工作树 `.playwright-browsers` 指向 `/tmp/dsc026v/.playwright-browsers` 的软链接；runner 会覆盖同名环境变量。真实 VS Code 可复用 `/tmp/dsc0261v/.vscode-test/vscode-linux-x64-1.141.0/code`，通过 `DEV_SESSION_CANVAS_VSCODE_EXECUTABLE` 指定；调试目录使用短 `/tmp` 路径，避免 Unix socket 路径上限。完整 smoke 入口是 `npm run test:vsix-smoke`；定向探针的命令与边界随实验补入结论文档。

## 验证与验收

四项均有具体触发输入、最早失败位置、机制与历史证据或明确的历史不确定范围。区分实际产品行为、诊断事件和测试前提。保留失败原文与对照结果，不以改基准、跳过测试、添加无用导入取得绿色。文档状态、路径和 `git diff --check` 均通过后创建 PR，失败测试属于被调查对象，不声称全门禁通过。

## 幂等性与恢复

探针和临时修改仅位于隔离工作树或忽略目录，重复运行使用独立调试目录。不得 reset、stash 或覆盖原工作树。历史日志只读；依赖构建产物可重建。取消的发布不会自动恢复。

## 证据与备注

原日志 `/tmp/dsc0261-verify-short.log`、`/tmp/dsc0261-final-head-verify.log`、`/tmp/dsc0261-webview.log`、`/tmp/dsc0261-clean-vsix.log`；主题历史证据 `/tmp/dsc-theme-introduction`；完整记录也在 release 工作树 `.debug/release-0-26-1/`。临时路径不是长期事实来源，关键输入、命令和结果必须写进正式文档。

## 接口与依赖

不新增正式接口或依赖。使用既有 Node、Git、Playwright、VS Code 测试入口与真实生产方法。诊断脚本若需保存，应独立标明实验用途和运行前提，不能成为放宽原断言的门禁。

修订记录：2026-10-09，取消发布后建立诊断计划，保留历史证据并明确只定位的范围。


## 最终证据回收

notifier 历史工作树 `/tmp/dscih`：a781334e^ 原清单 exit 0，a781334e 原清单 exit 1（ENOENT notifier/dist），只 build:notifier 后 exit 0。主题沿用 `/tmp/dsc-theme-introduction` 四树原脚本结果：父过/子败，merge 父过/merge 败。

hardwrap：主线原用例 2 failed，加宽输入 2 passed；最初引入用例的 4412413e 原 build/tests 为 2 passed；`/tmp/dscij` 的 e03a6527（7f1e1887 父）2 passed，7f1e1887 2 failed；仅撤去恢复后 fit 调度 2 passed。运行命令均为 npm ci（lockfile 未变时复用）、npm run build、node scripts/test/run-playwright-webview.mjs --grep 'styled hard-wrapped code paths'。原测试目标与文本不变，临时观察/反事实修改均已撤回。

相对 shell 使用原 VSIX 的 host-messages.json 与 diagnostic-events.json，按完整 executionSessionId 串联 live、输出、EOF/saved；受控 Host 探针 1/1 确认成功返回仍缺 execution/started。探针生成方法与准确输入/结果写入正式文档，未重新跑完整安装包 smoke。

修订记录：2026-10-09，完成四项归因与引入历史，补齐正反对照和复现命令；将所有修复作为后续工作，不借诊断修改产品或放宽门禁。
