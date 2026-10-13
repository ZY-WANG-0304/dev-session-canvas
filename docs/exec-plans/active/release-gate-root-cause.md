# 定位 PR327 发布门禁两个首败

本计划按 docs/PLANS.md 持续维护。目标是给出可追溯的根因和修复范围，本轮不实施正式修复、不改 PR327 发布输入。

## 目标与全局图景

维护者需要知道 GitHub runtime-checkpoint-refresh 的 Agent 为什么无法启动，以及本地 local-links-and-stop 为什么在已有匹配事件时仍超时。交付源码锚点、受控复现和证据限制，避免用增加超时或重试代替根因。

## 进度

- [x] (2026-10-13 09:56Z) 从最新 main22803dd8创建独立 docs-release-gate-root-cause 分支，保留 PR327/head42d87b3d及首败日志。
- [ ] 核对 runtime 准备链的外层异常来源，复现候选环境差异。
- [x] (2026-10-13 10:10Z) 原helper五个受控正负例确认截止漏检，原renderer核对第一次文件搜索9592ms、第二次321ms。
- [ ] 更新正式调查结论、索引与技术债，检查并提交可复核报告。

## 意外与发现

CI Canvas 已 ready/bootstrapAck，Agent error 且没有 execution；通用错误来自 runtimeRootPreparation.ts 存储准备完成后的外层catch。该catch未保留异常，CI workflow也未上传失败工件。本地原错误包含精确匹配事件，waitForDiagnosticEvents在每轮开头检查结果，异步取回跨过deadline后直接失败。

首个诊断run38381854008未创建job：job级env不允许引用runner.temp。将路径登记移到step的GITHUB_ENV后，actionlint1.7.12检查通过；该配置错误未产生runtime证据，不属于原发布首败。

## 决策记录

2026-10-13 / Codex：调查与发布分支分开，受控实验只在私有临时目录运行。原因是用户要求定位根因，PR327完整失败必须保留，不能改head或放宽正式断言取得表面通过。

## 结果与复盘

本地等待漏检与文件搜索接近预算已确认。CI已排除systemd选择及Linuxmanifest/binary差异，原输入独立checkpoint通过；新增固定输入完整诊断workflow捕获准备阶段和catch异常，原发布门禁不变。调查进行中。尚未把 systemd 配置目录失配、资源问题或等待边界候选升级为完整历史根因。

## 上下文与定向

扩展入口位于 extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts。live-runtime启动调用 panel/runtimeRootSupervisorPreparation.ts，以IPC向短生命周期launcher发送请求；supervisor/runtimeRootPreparation.ts准备私有存储、确认原owner、选择systemd-user或legacy-detached并提交Supervisor。systemd是Linux用户服务管理器，supervisor/runtimeSupervisorStart.ts写出unit文件后请求真实user manager启动。scripts/smoke/vscode-smoke-runner.mjs隔离HOME/XDG/TMP，需核对用户管理器是否搜索写出目录。tests/vscode-smoke/extension-tests.cjs的waitForDiagnosticEvents等待诊断事件，原异步轮询跨过截止后没有检查末批结果。

## 工作计划与里程碑

第一阶段固定历史输入与日志，列出外层catch可能抛错的步骤；检查systemd配置、原生资产及文件权限。第二阶段使用相同产品输入做单场景对照或真实函数受控实验，捕获有限错误信息，保持原超时和断言；每个新运行使用独立路径。第三阶段分别记录确定因果与历史证据缺口，向用户提供可确认修复方案。

## 具体步骤

工作树 /tmp/r327rca，main22803dd8；复用 /tmp/sf26 的精确预合并ec4afba3与 Node22.23.3、stock VSCode1.141.0缓存。新运行用独立debug目录，初始原场景以 DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=runtime-checkpoint-refresh 运行 scripts/smoke/run-vscode-smoke.mjs。该单场景对照不替代完整gate。受控脚本读取实际TypeScript函数，用esbuild编译并保留生产分支，观测关键依赖边界；实验脚本与输出收录docs/references/release-gate-root-cause。资源不足时只回收自己创建且已成功的重复node_modules，不删除原失败数据或未知进程。

## 验证与验收

root候选需给出明确错误/阶段，正反条件下同输入结果的变化及其适用限制。等待候选须让原helper在取回匹配事件跨越截止时稳定失败，并确认predicate对最后事件返回true；不凭一次独立通过判定原失败已解决。结论包括历史输入、命令、exit、日志hash与未验证范围。

## 幂等性与恢复

不修改原工作区、PR327、缓存与原失败工件。实验注入只放私有临时副本且标清与原输入差异。仅结束核验身份的自有实验进程；保留首败，未来正式修复需要新授权和最新主线全量复验。

## 证据与备注

原CI run38369705401，job115205696956，GitHub预合并7e659ce6、treec47ab041与本地ec4afba3相同。原日志 /tmp/pr327-post328-ci-verify-completed.log，SHA2560c1187d55f62a4eee963781c9144ffac7549bd1cf2ad733a233735ead4785fc6。本地原工件 /tmp/g327b/local-links-and-stop/artifacts。

## 接口与依赖

不新增产品API、依赖或设置。使用现有esbuild、Node vm和仓库函数。禁止通过catch改为成功或提交后fallback改变启动责任。

2026-10-13修订：先固定调查范围和证据门槛，再执行受控复现。
