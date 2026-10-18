---
title: CI与发布门禁重设计
decision_status: 已选定
validation_status: 验证中
domains: [VSCode 集成域, 执行编排域, 画布交互域]
architecture_layers: [宿主集成层, 画布呈现层, 适配与基础设施层]
related_specs: [docs/product-specs/runtime-persistence-modes.md]
related_plans: [docs/exec-plans/completed/release-gate-redesign.md, docs/exec-plans/active/release-gate-implementation.md]
updated_at: 2026-10-18
---

# CI与发布门禁重设计

## 目标与决策边界

用户要求把[分层审查](release-gate-layering-review.md)和[smoke场景重划](smoke-scenario-boundaries.md)推进为完整设计。本设计选定按验证责任组织job、按不可变输入传递产物、按独立回执判定完成的流程。一个失败应直接说明是输入、构建、产品动作、观察、清理还是交付失败；发布的包必须就是最终输入上验收过的那批文件。

`已选定`表示工程设计已收口，`验证中`表示workflow与程序接口已进入实现和验证，跨平台及最终发布输入验收仍未完成。本文选择工程边界，不宣布最低VSCode、六平台完整产品能力或真实TUI回合识别已通过。设计模型的静态/反例检查只核对方案自洽，不能放行0.26.1。PR327保留发布材料，现有生产恢复竞态和最终正式预合并完整门禁继续按既有要求关闭。

研究输入为`0abd89e80cc50711ff8a099030399c95d1837dfc`，fetch后`origin/main`仍为`6e708c6b93ce4b2b343729c422f59099f4fb42ba`。设计研究时未改workflow与发布脚本；2026-10-18起按本文实施，落点及真实验证边界见[活计划](../exec-plans/active/release-gate-implementation.md)。实现、回归、根因与文档继续集中PR335，不另建诊断、验证或文档PR。

## 正式方案

### 1. 四类正式入口与两类辅助入口

用同一个任务目录计算验证范围，不让每个runner各自解析环境变量。**任务目录**是具名检查/case及其环境、准备、所需产物和预算的清单；**验证计划**是某次输入冻结的必跑任务集合；**回执**是运行后绑定任务与输入身份的结果文件。计划由入口生成，消费者只能执行或报失败，不能自行删减任务。

| 入口/模式 | 输入 | 必跑范围 | 最终用途 |
| --- | --- | --- | --- |
| 普通非草稿PR `pr` | 最新base与head生成的预合并完整SHA | 基础层始终运行；改动分类自动增加功能/产物层，取并集 | 稳定required check，证明本次必跑集合完整通过 |
| 发布PR `release-pr` | 最新base/head预合并SHA、唯一目标版本及契约 | 基础+全部标准功能+双包产物验收+新增有限平台操作/安装层 | review前发布验收；合并后不复用其包发布 |
| 最终tag `release-tag` | 已合入main的`publish/vX.Y.Z`解析为完整SHA | 在最终SHA再次运行与发布PR相同的完整范围 | 产生可发布的双包和完成回执 |
| 渠道恢复 `channel-retry` | 已存在最终Release的原双包、原manifest及原验收回执 | 复核原包/ref/版本/回执来源；仅补尚未完成的交付 | 恢复同批文件，不重打包、不拼接另一SHA的测试 |
| 定向诊断 `diagnostic` | 明确SHA、case/层筛选与原因 | 从所选case的prepare开始；独立结果 | 可定位问题，永不生成完整验收回执 |
| 上游/真实provider观察 `observational` | 明确SHA/包、宿主/provider版本与凭据前提 | 最新宿主、最低宿主验证或真实TUI的登记范围 | 独立证据；只有明确列入发布契约的项才阻塞发布 |

草稿PR可以手动诊断，但转为ready后必须重新生成正式计划。`push main`运行同一普通PR分类范围的合并后回归，属于持续检查，不替代发布PR和最终tag两阶段验收。正式入口拒绝smoke filter、skip-smoke、stock比较构建、非计划覆盖变量及空必跑集合；诊断环境不得进入发布子进程。现有0.26.0/历史tag例外仅按其原tag逻辑保留，不传播到新模式。

普通PR分类是**显式保守规则**，不是动态挑选少数smoke：

- 基础层包含全部登记的类型、协议/状态/夹具回归、前端功能、固定视觉和Marketplace浏览器fixture，不因没有发布契约而跳过。
- 产品代码、工作区package、lockfile、build/runtime脚本、smoke/test、CI/验证目录改动增加全部标准功能层，包括当前源码19入口的迁移覆盖；不只跑“看起来相关”的case。
- 打包器、扩展manifest/依赖、产物file-list、资源/listing/README/图片、production构建和发布程序改动再增加全部产物层。新路径无法明确归类时默认功能+产物，不能默认为纯文档。
- 只有明确列出的、不进入包的文档路径可保持基础范围；任务目录/分类规则自身变更触发功能+产物。发布版本变动或release-contract变动必须进入release-pr，并要求唯一版本、双包/lock/CHANGELOG/契约一致。删除契约或只改版本不能成功降级成普通PR。

分类和任务目录写到新增`scripts/gates/catalog.mjs`与`scripts/gates/resolve-plan.mjs`；计划文件保存规则版本/摘要、base/head/inputSHA、模式、版本、任务ID+环境及预算。任务目录变更必须展示对base目录的增删差异并review，不能用“新目录少了任务”自动证明覆盖无损。required check在GitHub配置后才有强制性；实际验证红灯、过时base、取消与缺结果的合并阻断，不把文档写成已配置。

### 2. 可复用验证workflow的job与依赖

新增`.github/workflows/ci-validation.yml`作为普通PR、发布PR和最终tag共用的reusable workflow。原`release-preflight.yml`保留触发/解析/稳定聚合入口。下表是job职责，matrix实例的状态分别收集；数量不必为了保持历史六job而压缩。路径为当前实现落点。

| job | 直接输入与执行内容 | 输出 | 必需前置 |
| --- | --- | --- | --- |
| `resolve` | 固定SHA、分类、版本/环境策略，生成计划 | `gate-plan.json`及摘要 | 调用方预合并或tag身份 |
| `input-contract` | 校验计划；release模式执行现有静态preflight；普通PR核manifest/lock及分类一致性 | 输入回执 | resolve；不等原生资产/浏览器 |
| `regression` | 主/notifier/工作区类型、全部登记回归、发布判定/runner/夹具自身负例 | 逐具名检查结果 | resolve、独立npm ci；不依赖生产dist |
| `frontend-build` | 仅构建真实Webview/sidebar/Marketplace浏览器入口及资源，不选择PTY后端、不清主dist | 浏览器bundle和资源清单/摘要 | resolve、独立npm ci |
| `webview-function` | 前端交互、消息、列表/头像/badge等浏览器检查 | 功能回执、失败trace | frontend-build、固定Chromium |
| `webview-visual` | 单独执行固定baseline的ready/内容前提和截图断言 | 视觉回执、diff/截图 | frontend-build、固定OS/字体/Chromium |
| `marketplace-browser` | 共享/API/web回归后的本地HTTP/browser fixture；保留认证/请求/提示断言 | Marketplace浏览器回执 | frontend-build；自己的server/browser环境 |
| `native-assets` 六matrix | 当前六实际架构构建、当前/最小Node load、ABI/摘要检查 | 原archive/load回执+单目标操作回执 | input-contract；操作仅在本目标加载通过后 |
| `source-build` | 同run六archive装配，主/notifier非production源码构建一次 | development bundle、asset-set/文件摘要 | input-contract、六asset构建/load通过 |
| `source-host` 分组matrix | 消费source-build，按目录运行全部源码目标/case与保留的Host组合 | case/step结果、Host工件 | source-build；固定VSCode |
| `marketplace-host` | 消费source-build，运行现有VSCode本地fixture E2E | 认证、HTTP、Webview提示等回执 | source-build；固定VSCode+私有server |
| `package-clean` | git archive固定SHA、隔离依赖、只读native-set；一次production构建主/notifier并各打一个VSIX | 双VSIX、包回执、source/native/lock身份 | input-contract、六asset构建/load通过 |
| `packaged-host` 分组matrix | 消费双包，对测试副本instrument，运行packaged标准覆盖 | case回执、instrumentation清单 | package-clean；固定VSCode |
| `installed-pair` 三matrix | 空extensionsDir原样安装双包，独立driver验证公开入口与PTY | 原样安装回执/日志 | package-clean；Linux/macOS/Windows x64实际runner |
| `verify-result` | always收集全部必跑job/case回执和GitHub实际结果，校验身份/完整性 | `gate-result.json`；全部成功才写可交付回执 | 所有计划内job均结束，包括失败/未运行 |

基础范围选前七项及聚合；功能范围再选六native、source-build、source-host、marketplace-host；产物范围再选package-clean、packaged-host、installed-pair。release完整范围还要求六目标操作回执。普通功能范围原生操作也运行并报告，初期作为新增范围的校准项，正式提升为必跑要更新策略版本；不能将load绿色冒充操作通过。图中native→构建箭头只表示load/可用资产依赖，最终聚合还必须检查计划中的操作结果。

native matrix在load成功后上传对应archive，再执行操作，最后always上传分开的load/操作结果。操作失败但六个load与archive均合法时，source-build/package-clean可以继续收集独立证据：其job须用明确的always前置guard检查input-contract成功、六个load回执的实际producer/摘要与齐全archive，而不能只看reusable job整体红灯就跳过，也不能无条件always消费。任一load失败/缺失依然not-run，最终release聚合仍被操作失败阻断；普通功能范围只有明确的校准操作失败可记nonblocking，必需load和其他阶段失败不能被忽略。

当前`scripts/build/build.mjs`默认要求完整六资产且清主dist，因此frontend-build需要提取/复用其真实浏览器esbuild配置到新增`scripts/build/build-browser-assets.mjs`，输出独立目录；不以mock UI或stock比较构建替代真实前端。提取完成前，可以先保留frontend-build等待source-build，明确较慢，不绕资产准入。regression内有些回归会构建自己的临时bundle/启动进程，保留真实依赖和私有目录；“基础层”不意味着全部纯单元。

source-build和package-clean都消费同run/同SHA的六资产，各在独立checkout构建；development与production构建有不同目的，保留两次。它们不会共写dist。全部消费者checkout计划的完整SHA，browser/VSCode版本固定且与任务环境一致，禁用“已安装就用未知版本”的隐式回退。

独立job失败后其无依赖同级job继续，聚合仍失败；依赖其产物的job记`not-run`，不执行坏输入。同一smoke case内首败停止动作链。fixture可证明已完全清理时，独立case可以继续收集自身结果，整个run保持失败；清理失败或Host状态未知即停止该Host组，剩余case记not-run。两种结果不拼接成完整通过。

### 3. smoke目录、分组与现有覆盖迁移

采纳[smoke场景重划](smoke-scenario-boundaries.md)的按目标case/有限因果组合，链接、拖放、Stop、自然/异常退出、再启动、压力各自准备。reload明确区分页面remount、模拟Host边界、真实旧Host退出/保留；等待输入、回答呈现、真实TUI回合完成分别验收。不会将fake prompt或最末行当作真实provider完成事件。

Host分组是fixture/环境复用方式，不是业务场景目录。目录保留三个逻辑源码组：`local-products`（执行/画布/Note/链接等）、`runtime-products`（checkpoint、准入、模式、旧代）、`host-topology`（真实重开、多窗口/root、systemd/SSH）。组内的特殊二阶段、共享窗口及旧代组合仍为不可拆的case步骤。packaged按相同case ID/环境目录选择其完整八入口迁移范围，当前为每独立case或因果suite单独matrix/私有Host；未来共Host须有成本及隔离证据。每case自身节点、socket、临时文件和provider配置独立，兼容case可共Host，不能读前一case未声明业务状态。

第一阶段曾逐旧suite保留19/8默认与3个focused入口；当前目录已拆出102个独立product-case、13个默认因果suite和3个focused诊断。源码默认115加3辅助，packaged默认102加2notifier辅助；两个Marketplace Host另列。原覆盖映射152个拟议case不是152个Host，也不是已实现用例。迁移逐条核对137现有目的地及helper内断言后才能切新目录/去重；15新增目标独立登记为未验，不悄悄加入已通过清单。source focused不因为诊断成功自动计入默认通过。

新增`scripts/smoke/smoke-catalog.mjs`提供目录，两个现有runner与stage统一消费；`scripts/gates/catalog.mjs`引用冻结的smoke任务集合。每次完整计划记录实际case+variant哈希，suite回执从实际进入/完成的case输出，不能只打印计划数量。exact重复、额外variant、空结果、缺必跑case均失败。

六目标native操作是独立、有限的真实shell契约，必须调用本次目标asset的spawn/input/output/resize/exit/Stop并确认资源释放；resize用子进程实际几何，退出code/signal与cleanup分别验证。load报告继续保留`productValidated=false`，操作报告是另一个证据。原样安装先要求三个x64系统的双包公开入口、基本I/O/resize/Stop和notification路由；arm64仅六原生操作，不外推arm64安装/TUI/旧OS均已验。扩展最低VSCode`^1.80.0`的运行承诺与Node minimum load分账，最低宿主和真实provider范围列为后续受控验收，不能降宣manifest来让门禁通过。

native操作driver通过当前平台provider消费本次addon，Stop在这层指按provider终止同一原进程并核退出/资源，不假设所有addon导出同名Stop函数；用户UI Stop及Host/save/reader结算仍由source/installed层承担。minimum Node仍只做load，不外推minimum Node全套行为验收。`scripts/smoke/native-terminal-observer.mjs`用锁定xterm parser消费原有序输出并验完整逻辑正文行；ConPTY OSC窗口标题、光标序列和自动换行不能使原命令回显成为回应。终态flush核sealed序号，resize仍要求子进程真实输出精确几何，不能从观察器自行resize或provider ACK推定。

### 4. 同批双包、回执与消费式验证

`package-clean`替代当前“clean打包→packaged内部重打→prepare再打”的路径。在隔离的git archive SHA、HOME/config/npm cache与新node_modules下npm ci，然后按正式六资产/profile/admission进行主production构建和notifier production构建，各打包一次。postinstall补丁/打包器file-list/README-ref/本地化资源检查保留。来源目录不含用户dirty文件，native-set在dist之外只读使用；浏览器/宿主缓存可复用已核版本文件，不复用node_modules、dist、runtime socket或旧包。

输出固定为`release-candidate/main.vsix`、`release-candidate/notifier.vsix`、`package-receipt.json`；扩展name/version记录在回执，不依赖mtime或根目录glob猜包。新增`scripts/release/build-release-candidate.mjs`调用/提取现有package器，必须确认vsce/npm生命周期不会触发额外构建。clean-checkout入口变为构建服务，两个VSIX路径显式传入消费式runner。现有文件清单回归检查staging规则与生产包实际ZIP双层，不能只看developmentComparison的list就称production包正确。

`packaged-host`只复制/解包两个输入包到测试副本，记录删除依赖声明、wrapper、测试命令与测试模式的变更清单；notifier也从输入VSIX stage，禁止偷用源码dist。记录原VSIX摘要和测试副本摘要/变更规则，原包前后摘要必须相同。它证明实际production payload的instrumented集成，不称原样安装。

`installed-pair`在空extensionsDir用原VSIX安装；driver作为单独扩展/外部自动化，使用公开命令/UI并读取外部可见证据，被测包无测试main、manifest改写或smoke模式。安装前后原包摘要相同，记录扩展ID/版本、依赖、activation、打开画布、Terminal响应/几何/Stop、主与notifier路由、回跳和locale。操作系统通知可用平台适配的测试接收者证明路由，系统桌面实际呈现另标manual/observational，不能以本地双包安装代证Marketplace自动下载companion。

`verify-result`绑定package回执与全部必跑结果，通过后写`acceptance-receipt.json`。PR候选包只供PR证据；最终tag重新在最终SHA建并验自己的双包。发布prepare下载最终tag这一批文件并校验，不再package。所有边界重新计算摘要，传输损坏/路径替换/错版本/ref/profile直接失败。

新增`scripts/gates/receipts.mjs`与`scripts/gates/verify-result.mjs`统一格式，至少约束以下字段；设计model中的样本只用于验证判定规则：

| 文件 | 必需字段/约束 |
| --- | --- |
| `gate-plan.json` | schemaVersion、mode、inputSHA/baseSHA/headSHA、version、policy/catalog/budget/environment摘要、run/attempt、非空tasks；taskID+variant唯一 |
| `package-receipt.json` | inputSHA、lock/source/native-set摘要、profile=`platform`、production admission、主/notifier ID/版本/path/size/sha256、README ref、构建环境及producer run/job |
| 层/case回执 | plan摘要、inputSHA、taskID+variant、消费artifact摘要、环境摘要、producer run/attempt/job、prepare/action/assert/cleanup/host-exit结果、开始/完成/原deadline、证据路径及摘要 |
| `gate-result.json` | 必跑/实跑/失败/未跑清单、首败、附加cleanup失败、输入/包身份、实际job结果；不在失败时伪造acceptance |
| `acceptance-receipt.json` | final/PR mode、inputSHA、plan/包回执/每层结果摘要、完整任务集合、实际producer来源；只能由正式全量聚合成功产生 |

schema、类型、版本和必需字段严格检查，未知状态不默认成功。artifact及回执的GitHub producer run/job/attempt还要由调用方的下载来源/实际job结果独立核验，不能相信JSON自报“成功”；签名不是当前必要的新平台依赖。`scripts/gates/github-provenance.mjs`直接读取有界HTTP原始日志/ZIP字节，原上传ID仍须绑定实际已结束job；重定向共享绝对采集期限，跨origin删除Authorization，拒TLS降级、超限或部分bytes，不经gh终端渲染。重跑某job时使用该attempt的结果，不混用上一attempt失败前的文件；明确允许复用的包/历史渠道证据保留原producer，同时本轮消费者写新的校验回执。

任务目录还定义每类任务的必需阶段：Host任务含五阶段，纯构建/静态检查不要求host-exit，cleanup只在任务创建私有资源时适用。计划记录适用性及原因，不能在运行后把失败阶段改成“不适用”。`not-run`表示应该运行而未运行，永远不作为成功；无此阶段的构建任务不编造Host退出。设计checker用统一五阶段样本检查拒绝规则，未实现完整按任务适用性schema。

### 5. 期限、环境与失败证据

固定环境策略初始取当前可追溯的Node`22.23.3`、VSCode`1.142.0`、视觉Ubuntu22.04与既有CJK字体；这是启动校准输入，不称完整组合已验。六native的Node`25.6.0`/最低`16.17.1`及Windows ARM64最低Electron`22.3.14`继续原约束。Playwright/Chromium由当前lock的精确版本/revision确定，job回执记录真实值；Actions OS标签还记录image版本，不将标签当digest。版本不可下载/runner缺失要报环境失败，不浮动fallback。宿主版本升级作为独立变更，用固定旧/新对照，保留最新观察线发现上游变化。

业务预算按每条原等待与case继承，不整体延长。计划冻结budgetGroup及毫秒数，一个动作的多helper共享绝对deadline，重试/末次观察不重置它。现有8/10/15/20/30秒的产品等待与特殊组合原期限逐项映射；无法抽出有界预算的case在迁移完成前不能进入新正式目录。

基础设施默认上限选npm ci10分钟、单次浏览器/VSCode获取5分钟、Host启动/测试驱动握手3分钟、Host退出30秒、私有资源cleanup60秒、失败取证30秒。它们是拟议的首轮工程预算，须真实CI校准，不写成产品SLA。普通Host整场上限由计划计算为启动预算+所有case不重叠budgetGroup之和+cleanup/退出/取证储备；job timeout覆盖其所有Host计划总上限再加5分钟收口，不能只写一个90分钟大上限。保留原asset20分钟、渠道45分钟/finalize20分钟外层保险，拆层后有观测数据再调整。

启动完成、产品Stop、尾部保存、reader消费、原session退役、Host退出、Supervisor退出是独立对象结果。持续Supervisor在活跃模式下允许存在，不强制全部case结束后它必退出；测试私有Supervisor到组收口时应按夹具所有权有界回收并记录。旧Host退出/保留场景用原PID/startTicks或平台等价身份确定前提，不能只sleep3秒假设已退出。为了cleanup执行kill不会把之前业务超时改为成功。

每job在固定`gate-artifacts/<job>/<variant>/`写结果/环境/有限stdout-stderr/阶段及原身份。失败先保存最后有效snapshot、实际页面probe及其新鲜度、process/session/owner/frame/readId、等待predicate/deadline，再清理；敏感环境和凭据不采集。clean构建/smoke的临时目录在退出前把必要现场复制到固定工件根，不只打印/tmp路径。trace/截图、包/原生摘要和case日志always上传，成功保留回执与必要摘要。首次失败与后续取证/cleanup失败均保留。

工件导出是独立、有界的取证动作。正式输出保留任务/Host回执、环境、原身份、实际步骤、probe/快照、截图/trace、生成的工作区与控制输入、SSH配置和sshd日志；原包、源码构建与native archive由各自不可变transfer工件保留。依赖副本、宿主/浏览器缓存、SSH私钥和完整HOME不进入结果工件。每个结果工件带内容清单，记录实际保留路径、长度、摘要及明确排除的目录类别；聚合从实际下载ZIP复算清单，缺失/改动不能通过。日志超2MiB时保留头64KiB及尾部，其原长度和保留区间显式记录；结构化回执、probe、trace或失败输入不能截断。首轮取证容量上限为每工件256MiB、单非日志文件64MiB及10000个文件，超限或取证超时使job失败并保留已收集证据，不能静默丢弃。预算与容量属于待Actions校准的基础设施输入，不扩展产品等待。

本地隔离验证同样先确认执行进程及其清理已settle，再在取证30秒/清理60秒储备内导出必要证据和回收checkout；不对仍活动的checkout并发复制或删除。未settle、取证失败或清理失败保留私有目录位置并使本地结果失败。源工作区和其他任务目录不在此回收范围。

取消/超时缺回执视为非成功。聚合使用always及计划内所有job的实际状态；同名required check若整个workflow取消显示cancelled，不用另一成功skip覆盖。发布workflow使用同版本互斥且不自动取消正在交付的attempt；PR旧输入可取消但不可复用为新SHA通过。

### 6. 发布workflow仍保留六个外层job

`.github/workflows/publish-marketplace-release.yml`重划为以下六job。现有native资产job移到reusable完整验证内部，不丢六matrix。所有checkout固定resolve输出SHA，不能在后续重新解析可移动tag作为唯一代码身份。

| 外层job | 执行与验证 | 失败规则 |
| --- | --- | --- |
| `resolve-release` | tag格式/版本；解析完整SHA；核main归属、已有最终tag；区分新发布与合法原包恢复，冻结requiredTargets | 错ref/版本、不能确认Release不存在或输入冲突即失败，不走重打 |
| `verify-release` | 新发布调用reusable `release-tag`完整范围；恢复则核原acceptance/双包来源及所选交付范围 | 任一必跑结果非通过/错身份拒绝prepare；历史tag无新schema按原tag路径，不伪造新回执 |
| `prepare-release` | 仅消费已验双包；复算摘要/ref/版本；创建正式v tag/Release并上传同bytes，读取远端asset核摘要，写GitHub交付回执 | 未验证不得对外；已有资产不完整/不匹配不自动clobber重打；保留恢复证据 |
| `publish-open-vsx` | 消费原包及prepare回执；逐主/notifier查询/提交/验真 | 提交未知先查询，不盲重发；必需内容未验则失败 |
| `publish-visual-studio` | 同上，独立执行；保留既定deferred策略 | 失败/deferred有回执，不阻断当前requiredTargets但如实记录 |
| `finalize-release` | prepare成功后always运行；严格校验两partial和job事实、GitHub回执及requiredTargets；更新manifest/notes | 必需结果缺失/未知/错身份失败，保留publish tag；完成后才删除，删除失败单列 |

requiredTargets保持`github-release-assets`和`open-vsx`，每个目标都含主包与notifier。VS Marketplace并行且允许deferred。先上传GitHub再发布渠道有恢复价值，保持；外部发布不原子，不以重设计承诺全渠道同时成功。最终manifest/notes/GitHub assets是发布后事实，不回写同版本CHANGELOG或仓库契约。

现有`publish-tag-release.mjs`提取共享判定到新增`scripts/release/release-completion.mjs`和渠道回执生成；workflow调用此模块，不再内嵌另一套字符串merge。`publish-marketplaces.mjs`只接受已验路径，channels严禁打包。GitHub artifact/Release的回执具名下载，无find/glob/mtime选对象。

### 7. 渠道状态、内容身份与恢复

将发布动作和验真分开记录，不让单个`verified`字符串承担全部含义：

| 维度 | 状态 | 后续动作 |
| --- | --- | --- |
| 版本观察 | `absent / present / unknown` | 确认absent才可首次提交；unknown只查询重试，不能当缺失 |
| 提交 | `not-submitted / submitted / rejected / unknown` | submitted或unknown查询结果；拒绝时记录响应，不无限提交 |
| 内容验真 | `match / mismatch / unknown` | match才可完成；mismatch明确冲突；unknown有界等待后未完成 |
| 证据使用 | `fresh / reused` | fresh绑定本轮查询；reused绑定原包/原成功回执并记录本轮观察，不隐去失败 |

查询版本存在后核扩展ID、版本与内容身份；新发布不把`already-published`当成成功，必须证明远端同版本对应同payload。Open VSX优先下载VSIX/checksum核一致；Marketplace若存在重签，采用版本化的payload内容清单口径。具体允许变化文件必须由受控实际上传/下载对照证明并白名单化，不能忽略整个manifest或任意“签名文件”。源包/raw hash、远端包raw hash与canonical payload hash同时记。口径未选定或服务无法提供可验证内容时保持unknown，不能默默降级为只看版本/metadata。

GitHub assets可按原VSIX整包摘要直接核远端bytes，main/notifier和manifest对应版本/ref。prepare成功的交付回执可供finalize消费；回执绑定本轮真实上传/下载验证结果，不由finalize无查询直接补`assets-uploaded`。每次恢复重新核GitHub原资产，禁止根据旧标签成功推断当前资产齐全。

新release-tag验真需要fresh结果。channel-retry可以复用未选重试目标的历史成功，条件是同最终SHA/版本/包/policy内容身份、来自可核producer的原成功回执，且当前没有明确mismatch；未知观察记录为unknown，显示“复用历史验真”及时间，不能写“本轮验证成功”。目标被选重验时必须fresh，不能让历史verified覆盖false。原acceptance只能为原包证明；格式旧/缺失不能走新快恢复，沿历史tag明确的兼容路径处理。

partial包含schemaVersion、releaseSHA/version、extensionID、target、sourcePackageHash/contentPolicyHash、remote观察与内容摘要、producer run/attempt/job、验真时间与证据来源。finalize先验证对象/目标/包/来源，再按冻结requiredTargets计算；不匹配partial使最终汇总失败，即使它只有deferred VS目标也不能污染manifest。目标缺结果则标unknown/deferred，Open VSX/GitHub缺结果失败。producer job失败但已有原包可复用证据只有channel-retry的显式策略允许，不能在普通新发布忽略实际job红灯。

重试应区分“构建/业务失败”和“渠道部分完成”：前者新attempt重跑必要前置，最终仍要求一次完整对应输入的回执；后者下载原双包，复验身份，保留已完成渠道，不重复上传已存在版本，不重打包。传输重试有界，提交超时未知先查询。原Release不完整保留现场并拒绝自动覆盖，由明确修复路径处理。删临时tag时复查trigger/final tag均对应releaseSHA，且需要可信required-target完成回执；删除失败记录`cleanup-failed`，既有发布成功事实不被抹去，workflow失败供幂等重试。


状态恢复实施采用显式父状态摘要及阶段链：首次 prepare 的 pending 状态是根，finalize 与 tag cleanup 各产生后继。每个状态绑定本轮实际 job/run/attempt；不可变状态快照的文件名核原 bytes 摘要，内容须能从对应 prepared 或 finalize Actions 工件独立核对。恢复选择唯一连通链的末端，canonical 文件可落后于已上传后继；缺父状态、分叉、错身份或无法核 producer 时失败。不以 mtime、历史绿色或 JSON 自报选择状态；原 acceptance 与原双包依然必须独立验真。

### 8. 程序入口与迁移顺序

程序入口为`ci:verify -- --mode pr|release-pr|release-tag --plan <path>`与`ci:diagnose -- --case <id> --ref <sha>`。本地正式验证从冻结源码及隔离环境运行同一任务图，输出相同回执；`npm test`继续作为本地全量方便入口，不能有独立的第二套场景目录。`release:preflight`保留纯静态能力，`release:verify`转为正式完整任务图入口，版本参数仍要求契约一致。消费式packaged参数至少为`--main-vsix --notifier-vsix --package-receipt --plan`，不隐式构建；独立便捷“build-and-smoke”可以调用构建再测试，但名称与回执必须区别。

实现按四个可验阶段推进，继续一个关联修复PR，组合发布材料在临时worktree验证；不另建诊断/文档PR：

1. 增加任务目录/计划/回执与严格完成判定、范围守卫/always现场/阶段期限，旧suite adapter继续完整运行；先用已有确定反例验证错ref/hash、历史verified覆盖、filter/空集合及cleanup失败不能通过。
2. 交付一次clean双包构建、消费式packaged与原样安装；绑定最终tag验收与发布同bytes；迁移notifier类型/回跳/locale及门禁自身回归到明确层。实现渠道内容身份的受控对照，未知口径不放行新渠道完成。
3. 抽取纯浏览器build，按真实依赖拆job，source/Marketplace Host消费统一development bundle；迁移独立smoke case并逐条核对旧断言，证明单case独立性和清理；完成六原生操作和三x64原样安装的真实验收后升级目录版本。
4. 固定正式环境及required check，负例验证实际GitHub阻断；对新旧同输入门禁做覆盖等价，去旧串行重复接线；PR327 rebase后最新正式预合并完整验证、最终tag独立完整验证仍必须执行。

切换实际workflow时同步`docs/WORKFLOW.md`和相关细分协作入口，明确“验证阶段构建候选双包”和“验证通过后的对外交付”。本轮不修改用户主工作区现有WORKFLOW改动；本工作树的实施文档保留并结合既有集中收口规则，不用新文档直接覆盖它。旧0.26.0/历史tag入口继续原兼容策略。

不先删除旧完整门禁再补新报告。两体系短期对照可复用同输入构建资产，但不可拿一套部分绿灯填另一套缺结果。提高缓存/并发前记录job/Host耗时和资源；容量/产品准入保持生产值，不为测试同时启动很多case而改admission。旧代/平台特殊fixture有私有资源且必须覆盖其新增probe依赖。

## 验证方法与仍需实测的边界

设计模型位于[release-gate-redesign](../references/release-gate-redesign/README.md)，核对job DAG、模式范围、70顶层命令/嵌套Marketplace/22smoke入口迁移，及改SHA/包/plan/缺回执/业务与cleanup失败/渠道未知与历史复用反例。它模拟完成判定，不执行真实workflow或产物行为，不是未来生产测试的替代。

实施后验收必须证明：静态错误不等六资产才报；普通代码PR确实运行功能层；每层失败有always现场；原样安装无产品smoke模式；消费者前后原双包摘要与最终GitHub/渠道身份对应；错输入/少case/取消/未知结果不能绿色；渠道提交未知不重发、原包恢复幂等；每个平台实际spawn/resize/exit/Stop/cleanup观察成立。真实TUI必须有独立于被测waiting-input启发式的回合完成证据，现有fake检查只验受控输入。

固定环境组合、infra首轮预算、跨平台操作/三x64安装以及各渠道签名/content口径尚需真实受控验证。支持最低VSCode、arm64原样安装、真实systemd manager、Marketplace自动下载和真实桌面通知另有范围，不被本轮新图暗示已验。源码既有竞态仍需产品修复，重设计CI不会自动解决它。

## 设计流程图

三张图描述正式方案；实际执行状态须查Actions及逐任务回执，不能由图推定通过。第一张将独立基础层与资产依赖层分开，第二张说明包与回执交接，第三张展示六外层job与渠道恢复规则。完整job输入/输出和失败规则以本文正式方案为准。

| 视图 | 可缩放SVG | PNG |
| --- | --- | --- |
| 验证依赖与范围 | [validation-flow.svg](../references/release-gate-redesign/validation-flow.svg) | [PNG](../references/release-gate-redesign/validation-flow.png) |
| 双包交接与验收 | [package-flow.svg](../references/release-gate-redesign/package-flow.svg) | [PNG](../references/release-gate-redesign/package-flow.png) |
| 发布六job与恢复 | [publish-flow.svg](../references/release-gate-redesign/publish-flow.svg) | [PNG](../references/release-gate-redesign/publish-flow.png) |

## 实施状态（2026-10-18）

当前实现包括15个reusable job、六发布外层job、保守PR分类、固定输入与阶段回执、共享production浏览器构建、同批双包/消费式packaged/三x64原样安装及原包恢复模块。真实旧覆盖迁移由`scripts/smoke/smoke-implementation-map.json`绑定152个设计目的地，其中137项为implemented-unverified、15项not-implemented；静态AST可达/实际step审查不产生产品验收。旧入口与具体断言的迁移替换理由保留在同一映射，未把未实现缺口记成通过。

已实跑：本地423前端功能、3固定视觉、Marketplace浏览器；完整登记80项regression同批80通过；source独立case及SSH退出/保留、旧代/多窗口/重开和两个Marketplace Host的本地诊断。诊断用旧dist/旧native资产，只证明夹具与新观察接线，不能代证新提交SHA。当前有界证据正反例已通过，SSH实际导出42文件/461626bytes；SSH依赖包固定官方版本/摘要、显式extensionEnvironment、真实短socket路径、零节点cleanup观察与Marketplace中文locale夹具已修，产品等待和断言含义保持。

真实Actions首轮39093713215（预合并354e6129/head455a494f）取消，第二轮39094300198（预合并040883c8/head4c3fa9bf）失败；各轮独立记账。第二轮三个regression分片、输入、production浏览器构建/视觉、Marketplace浏览器和Linux/macOS四native操作通过，六native-load均通过；Windows两架构OSC正文漏判、gh原日志保护及production CSS变量文本拼写错误已有原始证据和针对修复。前端数值变量按完整Number转换精确比较0.82，不把production改回development或改截图基线。真正clean双包、packaged同批消费及三原样安装未触达，完整来源聚合与PR327最终输入仍待验。

`main`保护API返回404 Branch not protected，尚未配置required check，不能声称已有强制合并阻断。生产旧代恢复撤销订阅竞态依然是独立发布阻塞；即使CI改造通过也不由此宣称0.26.1可发布。渠道模块只在本地HTTP/内存受控输入验证过，未进行真实发布/上传重签对照，未知内容继续拒绝完成。
