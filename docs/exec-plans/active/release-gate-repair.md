# 修复 PR327 发布门禁的 socket 污染与末次观察漏检

本计划按照docs/PLANS.md持续维护，正式方案在docs/design-docs/release-gate-root-cause.md。执行工作树/tmp/r327fix、主题分支smoke-release-gate-repair，从origin/main22803dd890855ffbe7620538b04940def097171b创建。

## 目标与全局图景

干净机器上Remote Host单测不能创建权限0755的真实runtime socket父目录，后续Agent准备仍遵守0700校验。轮询读取返回精确匹配结果时，等待helper必须检查首读和末读，不因检查顺序直接报超时。修复后分别运行确定性正反例，并用修复加PR327发布内容的明确临时组合输入运行完整0.26.1验证。交付独立修复PR；没有合并、打tag或发布授权。

## 进度

- [x] (2026-10-13) 从最新main创建修复worktree，保留原故障/诊断输入与工件，导入调查文档。
- [x] (2026-10-13) 用户授权修复后登记正式方案、范围与验证语义。
- [x] (2026-10-13) 实现自有socket夹具、默认地址回归和三种初始目录状态回归。
- [x] (2026-10-13) 两份轮询helper修复，36项边界和9项resize严格预算通过。
- [x] (2026-10-13) 新回归在原main私有副本均exit1，修复后通过；typecheck、原生资产build和相关smoke辅助测试通过。
- [ ] 从最新main rebase后提交/push并创建独立修复PR。
- [ ] 创建临时组合输入PR，运行完整Release Preflight并保留真实结果。
- [ ] 同步证据、技术债与PR描述，归档计划。

## 意外与发现

原17项单测在干净目录能全部通过，却遗留/tmp/dsc-root-<uid>0755，随后生产ensureRuntimeRootSocketDirectory拒绝。已有0700环境会掩盖污染。原诊断helper先在while条件检查时钟，再检查已取回结果，因此末批精确execution/linkOpened事件出现在超时错误里。原历史失败和后续固定输入诊断已保存，修复验证必须另记。

本机共享盘仅约1GB可用；source smoke复制单场景依赖约1.1GB。不通过删除原失败工件或未知进程来腾空间，完整门禁使用干净GitHub runner。

## 决策记录

2026-10-13：requestSession只增加可选socketPath，不改变默认runtimePaths地址与attachSession协议；静默server改在自己的mkdtemp内监听，finally销毁连接/关闭server/删除自己目录。理由是让测试脱离生产共享namespace，保留产品权限边界。

2026-10-13：两份通用helper采用先检查观察、再核对剩余预算的顺序。sleep仅使用剩余预算，首/末读跨截止仍检查一次，不匹配后无预算不重试。该helper不是IPC硬截止；resize严格晚到拒绝不变。理由是修复相同漏检机制，不增加预算或掩盖业务搜索慢。

2026-10-13：不修改PR327输入。另建明确禁止合并的临时组合PR，让未改动的Release Preflight在固定组合预合并ref构建六平台资产并全量verify。其通过只能说明组合输入，正式PR327仍需修复合入后rebase重跑。

## 结果与复盘

两处修复与确定性回归已完成，新回归在原main检测出首读漏检和absent目录污染，修复后36项等待/18项Host/三种目录隔离均通过。9项resize、19项reset、14项output、6项history、typecheck和显式原生资产build通过。首次未指定资产的build在入口拒绝，指定既有六平台资产后通过，未放宽构建契约。完整组合CI和正式PR327门禁尚未通过，不能用上述独立通过代替。

## 上下文与定向

scripts/test/test-smoke-remote-host.mjs的Linux静默socket用例调用tests/vscode-smoke/remote-host-control.cjs的requestSession。runtimePaths把任意storage映射到/tmp/dsc-root-<uid>；原测试mkdir默认受umask0022影响为0755，finally没有删除父目录。生产extensions/vscode/dev-session-canvas/src/supervisor/runtimeRootOwner.ts严格要求共享目录属于当前uid且0700。

tests/vscode-smoke/extension-tests.cjs末尾waitForSnapshot/ waitForDiagnosticEvents分别异步读取Host的状态/诊断，默认预算15000/8000ms。读取和sleep可能跨越截止。现有test-smoke-terminal-resize.mjs使用另一helper，专门保证resize总截止，不能改变。

PR327的release-0-26-1-refresh head42d87b3d59d3147199a3fef9f2ee0b40de4534cf仅含0.26.1发布准备，仍草稿。原GitHub预合并7e659ce6树c47ab041，完整门禁首败已保留；新组合验证需要单独标识，不能声称正式PR327通过。

## 工作计划

先修改requestSession增加options.socketPath，并将静默server放入短mkdtemp路径。新增默认地址测试通过拦截net.createConnection记录原参数，再连接实际私有server，检查请求和返回。独立目录测试通过Node preload只映射helper内真实目录到自己的三种夹具，运行完整测试，确认不存在保持不存在、0700/0755预置目录保留同inode/权限/哨兵内容。

随后只修改两个wait函数循环的检查顺序和sleep参数。在scripts/test/test-smoke-wait-boundary.mjs读取原函数放进vm，控制时间和读取，测试初次成功、正常成功、截止相等/跨越末读、初次跨越、负例、错误传播和默认预算。两个回归接入npm test；package-lock不变。

验证后显式暂存任务文件，提交，从最新origin/main rebase并push创建bugfix PR。临时组合分支从修复head cherry-pick PR327五个发布提交，若冲突只解决相关文档，并保持发布数据和门禁代码不变；新PR明确验证用途且禁止合并。记录准确SHA/tree和CI输入输出。

## 具体步骤

在/tmp/r327fix使用Node22（PATH前缀/tmp/dsc-release-node22/node_modules/node/bin），依赖node_modules链接到同lockfile的/tmp/sf26/node_modules，不npm ci或修改共享依赖。运行npm run test:smoke-remote-host、npm run test:smoke-wait-boundary、npm run test:smoke-remote-host-isolation和npm run test:smoke-terminal-resize，预期全通过；在私有原main夹具执行新增回归应失败且不触及真实目录。然后运行相关smoke辅助测试、typecheck及build。

GitHub命令使用gh api和gh pr create --body-file；推送前git fetch origin再git rebase origin/main。临时组合PR通过现有Release Preflight获取同run六平台native资产，并在干净runner执行npm run release:verify -- --version 0.26.1。轮询CI时及时报告实际阶段/失败，不执行合并或publish动作。

## 验证与验收

隔离回归必须核对三种真实目录初始状态的模式、身份和内容不变；原baseline至少在absent对照失败，修复全部通过。边界回归必须让原helper在末读/首读跨deadline匹配时失败，修复成功；无匹配仍按预算失败且错误包含最后观察，不能多读重试。resize九例包括晚到成功拒绝继续通过。

完整组合gate使用同预合并SHA六平台资产，全量npm test、source smoke、生产VSIX与安装后smoke等由release:verify定义的检查，退出0才称组合门禁通过；退出非0记录首败。修复PR与发布PR分离，PR327最新正式预合并仅在修复合入后可验证。

## 幂等性与恢复

回归只使用自己创建的临时目录，server关闭后清理；映射目录不是真实runtime目录，原失败工件不动。每次临时输入提交与CI输入固定记录SHA，重跑注明新run。临时组合PR不得合并，结果记录后关闭或转草稿。所有未确认业务延迟与后续可观测性改进登记技术债，不扩本修复。

## 证据与备注

原诊断证据在docs/references/release-gate-root-cause/，含helper/测试源码hash、固定输入CI异常和干净目录因果对照。修复新增结果另记，不改写原baseline的预期。完成后附新run、input、关键结果和日志hash。

## 接口与依赖

requestSession(storageDir, sessionId, timeoutMs=5000, options={})支持options.socketPath；缺省连接runtimePaths(storageDir).socketPath。协议/超时保持现有实现。waitForSnapshot与waitForDiagnosticEvents仍是原签名和返回值；只使用现有Node vm、fs、net和assert测试能力，不新增依赖或通用抽象层。

修订记录：2026-10-13创建修复计划，承接已完成根因调查与用户授权，明确最终观察语义、隔离回归和组合验证与正式发布边界。

修订记录：2026-10-13完成源代码和回归，本地验证结果及原基线失败hash另存repair-local-checks.json、repair-baseline-regression-result.json，完整门禁仍待组合CI。
