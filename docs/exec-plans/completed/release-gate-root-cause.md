# 定位 PR327 发布门禁两个首败

本计划按 docs/PLANS.md 持续维护。目标是给出可追溯的根因和修复范围，本轮不实施正式修复、不改 PR327 发布输入。

## 目标与全局图景

维护者需要知道 GitHub runtime-checkpoint-refresh 的 Agent 为什么无法启动，以及本地 local-links-and-stop 为什么在已有匹配事件时仍超时。交付源码锚点、受控复现和证据限制，避免用增加超时或重试代替根因。

## 进度

- [x] (2026-10-13 09:56Z) 从最新 main22803dd8创建独立 docs-release-gate-root-cause 分支，保留 PR327/head42d87b3d及首败日志。
- [x] (2026-10-13 10:27Z) 固定输入完整CI38382436173捕获socket-directory私有权限异常，native-assets未进入。
- [x] (2026-10-13 10:33Z) 原17个Remote Host测试私有目录对照确认absent变0755、预置0700保持且原生产校验分别拒绝/接受。
- [x] (2026-10-13 10:38Z) 干净CI38384582823直接观测不存在→uid1001/mode0755空目录、原校验拒绝→同inode改0700接受；原17用例通过并清理实验目录。
- [x] (2026-10-13 10:10Z) 原helper五个受控正负例确认截止漏检，原renderer核对第一次文件搜索9592ms、第二次321ms。
- [x] (2026-10-13 10:41Z) 同步调查结论、索引和技术债，归档workflow与计划，正式修复待用户确认。

## 意外与发现

CI Canvas 已 ready/bootstrapAck，Agent error 且没有 execution；通用错误来自 runtimeRootPreparation.ts 存储准备完成后的外层catch。该catch未保留异常，CI workflow也未上传失败工件。本地原错误包含精确匹配事件，waitForDiagnosticEvents在每轮开头检查结果，异步取回跨过deadline后直接失败。

首个诊断run38381854008未创建job：job级env不允许引用runner.temp。将路径登记移到step的GITHUB_ENV后，actionlint1.7.12检查通过；该配置错误未产生runtime证据，不属于原发布首败。

run38382436173捕获socket目录拒绝，尚未native-assets，disk剩余77GB。PR328新Remote Host静默socket测试mkdir真实runtime父目录不指定mode，也未清理父目录；原17用例对照在umask0022下确认目录不存在时留下0755，已有0700时保持同inode。第一版诊断脚本误将总数写为19，原17用例实际已通过；校正脚本汇总校验后两组完整通过，不改原测试。

## 决策记录

2026-10-13 / Codex：调查与发布分支分开，受控实验只在私有临时目录运行。原因是用户要求定位根因，PR327完整失败必须保留，不能改head或放宽正式断言取得表面通过。

2026-10-13 10:35Z / Codex：完整CI捕获异常后不盲目重试全量，改为干净runner只运行原17用例与原目录校验，读取实际uid/mode与空目录；自己的新空目录chmod仅用于因果对照。正式修复建议隔离测试socket，保持生产拒绝不安全共享目录。

2026-10-13 10:41Z / Codex：根因调查达到可复核边界，移除临时自动workflow并将其原版本归档；正式修复尚未授权，不创建产品修复PR，不更改PR327。验证状态已验证仅指调查机制，设计状态比较中表示修复待确认。

## 结果与复盘

调查完成：本地等待漏检与文件搜索接近预算已确认。固定输入完整CI再次checkpoint首败，捕获socket-directory权限拒绝；源码、原17用例私有目录正反例与干净CI直接stat确认测试创建/保留0755共享目录。干净CI只改同inode空目录权限为0700即接受，证明权限条件；没有正式修复，也没有用对照通过替换原失败。历史首败底层异常没有原始记录，不能声称恢复了历史stat。正式产品/test未修复，PR327草稿/head42d87b3d不变。剩余修复、最新main rebase和完整release:verify需用户确认后接续。

## 上下文与定向

扩展入口位于 extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts。live-runtime启动调用 panel/runtimeRootSupervisorPreparation.ts，以IPC向短生命周期launcher发送请求；supervisor/runtimeRootPreparation.ts准备私有存储、确认原owner、选择后端并提交Supervisor。本测试模式只请求legacy-detached，不选择Linux用户服务管理器systemd。supervisor/runtimeRootOwner.ts的ensureRuntimeRootSocketDirectory验证固定/tmp/dsc-root-<uid>属主和0700权限；scripts/test/test-smoke-remote-host.mjs先创建该目录但无mode/父目录清理，是污染候选。tests/vscode-smoke/extension-tests.cjs的waitForDiagnosticEvents等待诊断事件，原异步轮询跨过截止后没有检查末批结果。

## 工作计划与里程碑

第一阶段固定历史输入与日志，列出外层catch可能抛错的步骤；检查systemd配置、原生资产及文件权限。第二阶段使用相同产品输入做单场景对照或真实函数受控实验，捕获有限错误信息，保持原超时和断言；每个新运行使用独立路径。第三阶段分别记录确定因果与历史证据缺口，向用户提供可确认修复方案。

## 具体步骤

工作树 /tmp/r327rca，main22803dd8；复用 /tmp/sf26 的精确预合并ec4afba3与 Node22.23.3、stock VSCode1.141.0缓存。新运行用独立debug目录，初始原场景以 DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=runtime-checkpoint-refresh 运行 scripts/smoke/run-vscode-smoke.mjs。该单场景对照不替代完整gate。受控脚本读取实际TypeScript函数，用esbuild编译并保留生产分支，观测关键依赖边界；实验脚本与输出收录docs/references/release-gate-root-cause。资源不足时只回收自己创建且已成功的重复node_modules，不删除原失败数据或未知进程。

可重复的本地证据命令在精确输入/tmp/sf26执行：PATH=/tmp/dsc-release-node22/node_modules/node/bin:$PATH node /tmp/r327rca/docs/references/release-gate-root-cause/diagnostic-wait-boundary.mjs，预期五例判定通过；同目录执行node /tmp/r327rca/docs/references/release-gate-root-cause/socket-directory-pollution.mjs，预期原17用例两组通过、目录0755拒绝/0700接受。脚本只映射固定socket目录，不影响真实/tmp/dsc-root-<uid>。CI方案两个workflow原版本在references中归档；重跑需新的独立诊断分支且保留固定输入和新run证据。

## 验证与验收

root候选需给出明确错误/阶段，正反条件下同输入结果的变化及其适用限制。等待候选须让原helper在取回匹配事件跨越截止时稳定失败，并确认predicate对最后事件返回true；不凭一次独立通过判定原失败已解决。结论包括历史输入、命令、exit、日志hash与未验证范围。

## 幂等性与恢复

不修改原工作区、PR327、缓存与原失败工件。实验注入只放私有临时副本且标清与原输入差异。仅结束核验身份的自有实验进程；保留首败，未来正式修复需要新授权和最新主线全量复验。

## 证据与备注

原CI run38369705401，job115205696956，GitHub预合并7e659ce6、treec47ab041与本地ec4afba3相同。原日志 /tmp/pr327-post328-ci-verify-completed.log，SHA2560c1187d55f62a4eee963781c9144ffac7549bd1cf2ad733a233735ead4785fc6。本地原工件 /tmp/g327b/local-links-and-stop/artifacts。

CI诊断38382436173/job115245907927完整运行exit1，原相同checkpoint首败，有限异常摘要及日志hash见ci-preparation-result-38382436173.json。干净CI38384582823/job115253085935的原17用例与权限因果对照exit0，见ci-socket-result-38384582823.json和ci-socket-evidence-38384582823.json；不是完整发布gate。原renderer/Host搜索与轮询摘录含源hash见local-search-timeline.json。

## 接口与依赖

不新增产品API、依赖或设置。使用现有esbuild、Node vm和仓库函数。禁止通过catch改为成功或提交后fallback改变启动责任。

2026-10-13修订：固定首败证据后，用完整CI阶段异常和原测试干净目录正反例收敛根因；调查完成归档，正式修复等待用户确认。
