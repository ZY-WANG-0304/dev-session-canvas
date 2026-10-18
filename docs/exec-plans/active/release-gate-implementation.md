# 实现分层 CI 与同批双包发布门禁

本 ExecPlan 是活文档，按 `docs/PLANS.md` 维护。实施依据是已选定的 `docs/design-docs/release-gate-redesign.md`，不是旧 workflow 的字符串断言。

## 目标与全局图景

普通代码 PR 应实际执行基础及功能检查；发布 PR 和最终 tag 应完整检查固定源码与同批主扩展/notifier VSIX。错误输入、缺 case、取消、清理失败和未经内容验真的渠道状态不能显示成功。所有结果绑定任务计划和实际执行来源，发布消费已经验收的文件，不重新打包。用户可以在具名 job 和逐 case 结果中看到失败阶段及保留现场。

本任务不修改版本、不合并 PR、不创建发布 tag、不向渠道发布。保留发布 PR327；实现、回归、根因和文档集中当前关联修复分支 `smoke-lifecycle-diagnostic-isolation`。用户主工作区的 `docs/WORKFLOW.md` 改动保持不动。

## 进度

- [x] (2026-10-17) 核对正式设计、工作流及工作区；实施工作树起点3fbae6a9、远端main6e708c6b；用户主工作区dirty WORKFLOW保持不动。
- [x] (2026-10-18) 实现唯一任务目录、冻结计划、逐task回执、严格聚合及实际GitHub job/ZIP/artifact绑定；普通PR基础必跑，保守追加全部功能/产物，发布两阶段完整范围。
- [x] (2026-10-18) 新增15个reusable job和六发布外层job；共享production浏览器构建、同批clean双包、消费式packaged、三x64公开驱动及原包恢复/父状态链接线完成。四workflow actionlint和配置契约通过，实际Actions尚未运行。
- [x] (2026-10-18) 实际423前端功能、3视觉和Marketplace浏览器通过，未修改baseline。先前浏览器下载超5分钟失败保留，后续本地使用实际核对的Chromium1217缓存，不追认冷下载通过。
- [x] (2026-10-18) 完整登记80项regression同批80 passed/0 failed；此前78/80及codicon服务/runner drain首败保留。合同已增至80项并同批通过；新增有界证据3项专项通过，最终全合同复验83 passed/0 failed/0 skipped；收口后策略摘要及证据路径变更需针对相关模块复验。
- [x] (2026-10-18) 独立目录落实102product-case、13默认因果suite和3focused诊断；source115+3辅助，packaged104，Marketplace Host2。152设计目的地137 implemented-unverified/15 not-implemented，旧22 routes/真实helper注册/AST可达及因果step检查通过，不将静态结果当验收。
- [x] (2026-10-18) source生命周期/链接/压力30项首跑29通过，mounted/actual-fit夹具修正后URL单项通过；trusted独立71项首跑69通过，Note mounted/systemd短路径修正后单项通过。旧产品等待不增加，原断言含义保留，旧dist/native诊断不计新SHA。
- [x] (2026-10-18) 原身份/退役与全目录resize guard精选16项、旧代/多窗口和本地/systemd重开诊断通过；Crashpad残留pipe已用禁用crash reporter单变量验证，Host/进程drain断言保留。
- [x] (2026-10-18) Remote SSH固定官方三依赖包/hash，显式extensionEnvironment、XDG_STATE_HOME短socket及零节点cleanup观察修复。两种原Host退出/保留在第四轮同批2/2实际诊断通过，原Host/Supervisor/离线完成/resize/cleanup齐全。
- [x] (2026-10-18) Marketplace两个Host夹具修复：复用共享私有TMP路径，preview显式zh-cn并stage语言包；第三轮2/2实际诊断通过，原中文/HTTP/页面断言保留。
- [x] (2026-10-18) 工件改为有界必要证据+内容清单，拒截断结构化文件、篡改、超限和超时；活动local checkout拒并发复制/删除。真实SSH现场导出42文件/461626bytes，未包含依赖缓存/私钥；专项3/3通过，workflow契约/actionlint通过。
- [ ] 同步最终文档与验证，提交并fetch/rebase/pinnedlease推PR335；新提交实际Actions的六native/source/clean/packaged/三原样安装和全量来源聚合待运行。
- [ ] 原样安装和跨平台有限操作真实验收，校准固定环境/基础设施上限；渠道只做本地受控测试，不实际发布。
- [ ] 修复与PR327的最新真实预合并临时分支完整门禁；不另PR、不tag、不改版本。既有生产旧代恢复撤销订阅竞态未修，发布仍阻塞。

## 意外与发现

2026-10-18 续跑已收齐完整80项regression同批通过，以及Remote SSH原Host退出/保留两态、两个Marketplace Host的新包装器诊断通过。实跑发现原工件路径复制了node_modules与完整宿主缓存：30个case约33GiB，SSH两态约3.6GiB，必要Host回执与artifacts仅数百KiB。本轮按正式设计补有界证据导出与ZIP内容验真；依赖缓存不当作失败现场，结构化证据不得截断，取证缺失或超限保持失败。本地run-local的finally也必须先确认原执行settle，不能无界fs.cp/fs.rm活动checkout。

旧普通 PR 没有契约时实际跳过验证。旧 clean、packaged、publish 分别打包，最终发布文件没有绑定已测试文件。当前 build 同时清主 dist 并要求六资产，不能作为独立前端 job。旧 finalize 可以用历史 verified 覆盖本轮失败；这些行为必须通过真实程序负例关闭，不能靠放宽测试或设计模型证明。

初版 review 发现需要在接线前关闭的错误：reusable 整体 failure 不能直接代表普通 PR 校准操作失败后的最终验收；aggregate 必须独立完整验真并输出可信 acceptance。构建取 native-load 时不能同时要求无依赖并行 job 已结束。任务 deadline race 不能先开始 cleanup 再等待子进程回收。installed driver 不能读取不存在的 Extension.extensionMode、使用错误的内部命令或将 finally 强制终止冒充正常 Host 退出。

发布初稿审查还发现prepare没有初始可恢复manifest、finalize在notes更新前删tag、末次提交后的查询异常漏写完整回执，以及来源schema未逐项约束。现已补齐真实pending/failed状态、先状态与notes后cleanup、unknown查询和run/attempt/原内容反例。mutable状态文件替换前保存按内容摘要命名的不可变副本；尚需验证原Release恢复与真实Actions流程。本地入口初稿的native工具链/六资产接线和diagnostic筛选不完整，不能按该入口宣称全量验收。

现有 gate-runtime-state 已改为读取真实 registry.sessions；错误 entries[].sessions 结构会失败，不能把未知状态当资源为空。本轮共享浏览器构建及全部 423+3 用例已运行通过。固定浏览器下载曾触发 5 分钟上限并失败，后续仅使用经实际版本核对的既有 Chromium1217 缓存做本地验证，下载失败证据仍保留。VSCode1.142.0 下载成功并核实际 app 版本。Linux native 操作仅用旧资产诊断通过，不作为新 SHA 或六平台验收。Host已有多项当前工作树/旧资产诊断；包、installed和新Actions尚无本轮正式完整运行证据。

URL/OSC8 首次独立失败有真实 CDP 调用证据：页面已稳定为 64×20，旧 helper 却以 92×28 Start；snapshot restore 临时 resize 为 92×28，随后 deferred fit 恢复 64×20。鼠标已进入正确单元，URL provider 与 hover 均实际执行，但第二次 resize 触发 xterm linkLeave，取消尚未显示的 tooltip。修正只在测试夹具：用原 10 秒 probe 等待已 mounted 且 projection 完成的实际 fit 几何，再以该几何 Start。tooltip 文字、清 hover、浏览器路由和 OSC8 断言及原等待全部保留，未改产品行为。`/dev/shm/dsc-ci-url-inspection-7/dom.json` 中的 buffer-resize 调用栈保留取证；复验 17 秒通过。

## 决策记录

决策：先增严格入口和回执，再接线消费者；第一阶段旧suite作迁移适配器，保留19/8/3入口的完整覆盖输入。当前已按独立fixture迁移至102独立case/13因果suite/3focused，原assertionReview与22 routes映射保持可查。
理由：新场景目的地尚未全部独立验证，不能为了拆 job 删除隐含断言或把计划清单当执行证据。
日期/作者：2026-10-17 / Codex。

决策：环境不可用、产品动作失败或签名内容口径未知保持失败/未验证。
理由：用户明确要求不为适配代码使用错误 CI。固定版本、原样安装和真实几何检查不能退化为 stock、manifest 改写或只看版本。
日期/作者：2026-10-17 / Codex。

决策：第一阶段逐旧suite matrix，后续落实逐独立case/因果suite matrix，保留hostGroup与原断言含义；从真实 helper 等待及有限循环提取并冻结预算，不以任意倍数冒充已评审业务上限。
理由：trusted 组保守等待清单累计约 321 分钟，加基础设施后单 job 接近 347 分钟；逐 suite 可定位失败且不放宽原业务等待。动态循环界限及运行时消耗继续实测核对。
日期/作者：2026-10-18 / Codex。

决策：每case或因果suite私有Host先证明隔离，不共用前一个case业务状态；需要复用Host时再提供成本/隔离证据。trace/probe/控制输入完整导出，依赖/宿主缓存与SSH私钥排除并写明；日志有限区间和原hash显式保留，取证异常使真实producer失败。
理由：本地实跑出现数GiB重复缓存及长socket，错误工件收口本身会阻塞；不能以删原产品断言或延长业务等待解决。local未settle拒并发复制/删除，失败现场保持可恢复。
日期/作者：2026-10-18 / Codex。

## 结果与复盘

严格入口、真实浏览器配置和 reusable 任务图已有初版及部分行为验证，尚无新 CI/产品完整通过。设计模型验证不是实施验证。每一阶段完成后在此写实际命令、结果和剩余边界；最终发布输入完整通过前不宣称 0.26.1 可以发布。2026-10-18 再 fetch 后 origin/main 仍为 6e708c6b93ce4b2b343729c422f59099f4fb42ba，用户主工作区 dirty 文件未动。

## 上下文与定向

工作目录为 `/dev/shm/dsc-restricted-ready`。`.github/workflows/release-preflight.yml` 是 PR 入口，`publish-marketplace-release.yml` 是发布入口；新 `ci-validation.yml` 承担复用任务图。`scripts/build/build.mjs` 负责主扩展/原生 provider/browser，`scripts/release/package-vsix.mjs` 负责 staging 和 VSIX。`scripts/smoke/run-vscode-smoke.mjs` 和 `run-vscode-vsix-smoke.mjs` 是现有 Host suite 入口。`scripts/gates/` 为本轮新增的任务图和执行器目录。回执是实际动作执行后写出的身份与阶段结果；计划只声明必跑集合，不能证明运行成功。

## 工作计划与里程碑

第一阶段新增 `scripts/smoke/smoke-catalog.mjs` 和 `scripts/gates/{catalog,resolve-plan,receipts,verify-result}.mjs`。固定完整源码 SHA、base/head、环境/规则/预算摘要及 run/attempt。普通 PR 保守分类，版本或契约变动强制 release-pr。正式入口拒绝筛选、跳过、stock 和空任务；按计划阶段写真实退出结果。聚合独立核对 GitHub job/artifact 来源、完整 task+variant 和包摘要。反例必须调用生产模块，错 SHA/hash、少 case、重复、未知、取消及 cleanup 失败都不能生成 acceptance。

第二阶段新增 `scripts/release/build-release-candidate.mjs`。从 git archive 固定 SHA 创建隔离 checkout，npm ci，按六资产/profile/production admission 构建主/notifier 各一次，固定输出 main.vsix/notifier.vsix/包回执。packaged runner 只消费原双包、在副本 instrument 并列变更清单；独立 installed driver 无产品测试模式，三 x64 系统验证公开入口。统一 `scripts/release/release-completion.mjs`，渠道 absent/present/unknown 与内容 match/mismatch/unknown 分开；未知先查询，不重发，历史复用仅在原包恢复的明确策略允许。

第三阶段从 build 提取共享真实浏览器配置到 `scripts/build/build-browser-assets.mjs`。基础层不等待原生资产，development 与 production 在独立 checkout 构建。复用 workflow 分离输入、regression、frontend、浏览器、六 native、source、package、installed 与 always 聚合。六资产先上传 load 和 archive，再独立真实执行 I/O/resize/exit/Stop/cleanup；load 成功但操作失败可以继续取证，正式 release 仍失败。按唯一 smoke 目录运行具名旧 suite，分组不引入前一 case 的未声明状态。

第四阶段固定 Node22.23.3/VSCode1.142.0/锁定 Chromium 和视觉环境，基础设施与业务预算分账、Host 总期限有界。更新发布六外层 job 为 resolve/verify/prepare/两渠道/finalize，prepare 只消费验收包。普通 PR 与 main 接同任务图；稳定 required check 在实际 GitHub 设置未核实前不写已配置。保留每个失败现场、原始失败和附加清理失败。必要时使用临时 worktree 做发布 PR327 的组合验证，不另建验证 PR。

## 具体步骤

所有命令从上述工作目录运行。先用 `node --test scripts/test/test-gate-contracts.mjs` 等新增行为测试证明严格判定，再运行各现有具名回归及浏览器验证。使用 `npm ci` 安装锁定依赖，下载/缓存优先 `/dev/shm`。workflow 结构用 actionlint（可用时）及行为配置测试核验。原生和安装真实跨平台验收通过 CI 运行，当前 Linux 本地结果不外推其他平台。静态 preflight 可运行 `npm run release:preflight -- --version 0.26.1`，缺契约则只在含 PR327 的临时输入运行。

## 验证与验收

验收包括：普通代码 PR 计划选全部功能；错版本/删除契约不能降级；静态错误不等 native；regression 接全现有非 Host 检查；实际 suite 开始/完成事件形成回执；少跑或取消无 acceptance；只构建一批固定双包且所有消费者前后 hash 一致；packaged notifier 来自 VSIX；installed 主/notifier manifest/main 不变；真实 native 进程观察输入、几何与终止；渠道内容未知不判 complete。新 workflow 必须同时保留旧覆盖，不将新增未验目标记通过。最终发布验证需最新预合并输入完整运行，合并后的最终 tag 再独立运行，本任务不替用户创建 tag。

## 幂等性与恢复

临时目录、扩展目录、runtime socket 和结果按 run/attempt 隔离。失败的固定输出不覆写原 release，重试先验证已有包/回执再继续渠道查询。git archive 不包含工作区 dirty 文件；用户主工作区不 reset。推送前 fetch/rebase 目标分支，固定远端 head 的 force-with-lease；不 force push main。测试进程在期限后终止并保留现场，不能把清理成功改写成业务成功。

## 证据与备注

所有本地结果用固定Node22.23.3；native诊断用官方checksum核对的Node25.6.0。完整regression在/dev/shm/dsc-ci-regression-implementation-3/results.json记80/80通过；test:ci-gates当批80/80。有界证据三个新增正反例在/dev/shm/dsc-ci-evidence-contract-2.log通过；完整合同批/dev/shm/dsc-ci-gate-contract-implementation-6.log为83 passed/0 failed/0 skipped（129.5秒）；最终摘要/引用路径补充按相关项复验。

浏览器功能/视觉证据为/dev/shm/dsc-ci-browser-function-3和/dev/shm/dsc-ci-browser-visual。source独立30为/dev/shm/dsc-ci-independent-diagnostic-2，URL修后/dev/shm/dsc-ci-url-fixed-diagnostic-1；trusted71首败在/dev/shm/dsc-ci-trusted-independent-diagnostic-1。resize guard精选/dev/shm/dsc-ci-resize-guard-diagnostic-1；并发原身份/退役修后/dev/shm/dsc-ci-concurrency-remote-diagnostic-1。SSH最终2/2在/dev/shm/dsc-ci-remote-cleanup-diagnostic-4/results.json，两Marketplace在/dev/shm/dsc-ci-marketplace-host-diagnostic-3/results.json。此前每轮失败目录原样保留，不覆盖首败。必要SSH工件导出/dev/shm/dsc-ci-remote-retained-evidence-1已复算42文件/461626bytes。

旧六资产在/dev/shm/dsc-lifecycle-fix-evidence/formal-platform和formal-archives，本地Linux有限操作/dev/shm/dsc-ci-native-diagnostic-2仅诊断；不改inputCommit冒充新SHA。官方Remote SSH三包版本/hash位于scripts/smoke/remote-ssh-extension-inputs.json，实际下载核验完成。渠道/恢复正反例用本地HTTP/内存，不写真实渠道。四workflows actionlint通过。main保护API404 Branch not protected，尚无required配置，不能宣称远端阻断已成立。

docs/references/release-gate-redesign/verify.py是方案模型，mapping/AST是覆盖审查，均不代替实际CI和产品结果。当前真正clean双包/消费式packaged/三原样安装及新提交Actions未运行，生产恢复竞态及PR327最终完整门禁仍阻塞。后续证据集中既有references/实施目录并用实际SHA/run/attempt/hash记录。

## 接口与依赖

使用现有 Node、esbuild、JSZip、Playwright、@vscode/test-electron 和 GitHub Actions；无需新服务。`gate-plan.json` 定义任务和 producer 期望，`package-receipt.json` 定义固定双包，逐任务 JSON 由执行器写出，`verify-result` 仅在身份和所有必需阶段通过时写 `acceptance-receipt.json`。实际 GitHub provenance 由 API/artifact 元数据采集，不能接受未经核实的 JSON 自报。

修订记录：2026-10-17 创建实施计划，明确从正式设计实施并保留旧覆盖及未验证边界。

修订记录：2026-10-18 同步初版实现、实际 27 测试和共享构建验证；登记校准聚合、来源采集、deadline/cleanup 与 installed 接线错误，避免将配置测试通过误写为正式门禁通过。

修订记录：2026-10-18 补记 33 合同测试、423+3 浏览器和 Marketplace 实跑结果；区分下载失败、旧资产诊断与正式验收，修复 Actions 不支持的 job 级 runner.temp 表达式。

修订记录：2026-10-18 续记完整 regression 的实际失败与单项修复、46 项合同测试、独立 case 正在诊断验证和安装/Host 身份边界；保留旧资产不计新 SHA 的证据限制。

修订记录：2026-10-18 收齐 30 项独立诊断，登记 URL 失败的真实 resize/hover 因果证据及夹具修正后的独立复验；旧资产和当前工作树诊断仍不能替代新提交正式验收。

修订记录：2026-10-18 接续80regression同批、SSH两态/两个Marketplace Host及真实工件容量证据；同步102/13/3实际目录与137/15映射边界，补有界证据和local checkout settlement守卫，保留未验正式输入与产品阻塞。

2026-10-18 实际Actions首批run39093713215：head455a494f，真正预合并354e6129（main6e708c6b+PR head）。输入、production前端构建/视觉及Linux/macOS四native构建和有限操作通过。regression缺少sidebar-session-history浏览器预装，部分结果上传因task文件名含冒号被GitHub NTFS通用规则拒绝；已补显式锁定浏览器依赖及可逆唯一文件名编码，taskID和业务断言不变。Windows x64 native-load通过，finite I/O首个正文观察在15秒失败，原cleanup settled；首版回执漏raw输出，当前先补有限实际输出/批次/原身份取证，根因待实际样本，不降低原断言或延长产品等待。首批失败保留，不计完整验收。
