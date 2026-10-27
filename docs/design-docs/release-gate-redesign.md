---
title: CI与发布门禁重设计
decision_status: 已选定
validation_status: 验证中
domains: [VSCode 集成域, 执行编排域, 画布交互域]
architecture_layers: [宿主集成层, 画布呈现层, 适配与基础设施层]
related_specs: [docs/product-specs/runtime-persistence-modes.md]
related_plans: [docs/exec-plans/completed/release-gate-redesign.md, docs/exec-plans/completed/release-gate-implementation.md]
updated_at: 2026-10-27
---

# CI与发布门禁重设计

## 目标与决策边界

用户要求把[分层审查](release-gate-layering-review.md)和[smoke场景重划](smoke-scenario-boundaries.md)推进为完整设计。本设计选定按验证责任组织job、按不可变输入传递产物、按独立回执判定完成的流程。一个失败应直接说明是输入、构建、产品动作、观察、清理还是交付失败；发布的包必须就是最终输入上验收过的那批文件。

`已选定`表示工程设计已收口。现有覆盖迁移与分层CI已在PR335 ed9257bd及其与未改PR327的真实临时组合上完成完整验收；`验证中`仍保留最终发布输入、真实渠道和补充覆盖的验证边界。本文不宣布最低VSCode、六平台完整产品能力或真实TUI回合识别已通过。设计模型的静态/反例检查只核对方案自洽，不能放行0.26.1。PR327保留发布材料，两项生产竞态修复落地及最终正式预合并完整门禁继续按既有要求关闭。

研究输入为`0abd89e80cc50711ff8a099030399c95d1837dfc`，fetch后`origin/main`仍为`6e708c6b93ce4b2b343729c422f59099f4fb42ba`。设计研究时未改workflow与发布脚本；2026-10-18起按本文实施，落点及真实验证边界见[已完成实施计划](../exec-plans/completed/release-gate-implementation.md)。实现、回归、根因与文档继续集中PR335，不另建诊断、验证或文档PR。

## 正式方案

### GitHub Release 类别（2026-10-24 review 修正）

按用户确认延续历史 `prerelease: false` 策略。`scripts/release/release-github.mjs` 的 `githubClient.createRelease` 创建普通非草稿 Release，初始正文如实标记渠道交付进行中；`release-delivery.mjs` 的 `finalizeRelease` 在发布与 `channel-retry` 两种模式下继续通过 `updateNotes` 仅更新正文，不改变发布类别。创建响应丢失时查询同 tag/SHA 的原 Release，不重复创建。此次不改历史远端 Release，不强制设置 GitHub Latest，也不改变产品 Preview 或 Marketplace 通道策略。

请求合同使用实际 `githubClient`，仅替换 HTTP transport，覆盖正常创建、创建响应丢失后的查询恢复，以及 `release-tag` / `channel-retry` 完成时的 PATCH；与现有验包、状态链和清理测试共用实际 prepare/finalize 编排。测试不执行真实外部发布。Node22.23.3下，修复前新增四项合同全部失败；修复后发布完成/恢复合同33/33通过，publish-tag-release准备回归通过。原日志摘要见[验证结果](../references/github-release-classification/results.json)，新head完整CI另行验收。

### Linux 字体准备范围（2026-10-23）

用户确认取消 CI 对完整 `fonts-noto-cjk` 系统包的网络下载与安装。`.github/workflows/ci-validation.yml` 的七类 Linux 浏览器/Host 准备步骤只安装 `xvfb libgtk-3-0 libnss3 libasound2`，保留 APT 更新和原五分钟期限。

`tests/playwright/webview-harness.spec.mjs` 的基线截图用例在 Linux 上直接读取仓库内 `tests/playwright/fixtures/screenshot-fonts/cjk-regular.woff`，以内嵌 `@font-face` 注入并校验加载成功；CI 和本地共用这条路径。在 d6646b38 时，该子集只覆盖指定截图字符，其他场景沿用 runner 自带字体；当时只删除安装项，未修改字体夹具。这一替代不完整，后续 Webview 范围按下一节补齐，Host 与市场页面不因此获得完整 CJK 字体。

前一输入 `1806300f` 的完整 run [39824883742](https://github.com/ZY-WANG-0304/dev-session-canvas/actions/runs/39824883742) 中，265 次 locked npm 安装成功；系统依赖步骤178成功、72失败、2跳过，聚合281项通过、72项未运行。三个失败样本（visual119986121223、source119989078925、packaged119989393078）最后记录为 Azure Ubuntu 镜像的61.2 MB字体下载，随后达到五分钟上限。同轮 packaged cutover119989392780 从同镜像下载相同版本成功，不能据此确定底层网络根因。本次消除这项外部字体下载依赖，不宣称修复 APT 或此前 npm ECONNRESET 的网络根因。

历史验证说明：d6646b38 仅静态核对七处安装命令及截图字体的 Linux 加载路径，当时未运行本地测试。后续修正的验证见下一节；完整 CI 仍须按最终 head 独立验收。

### Webview 本地字体补齐（2026-10-23）

后续 run39920907930 的 Linux Webview 功能测试出现中文软换行及两项标题截断失败，截图用例仍通过。原 WOFF 仅在截图测试注入，移除系统字体安装并未为其他功能用例提供替代字体。

本轮将同源 WOFF 扩展为覆盖 Webview 测试及呈现层中文字符的子集，在公共 `openHarness` 和主题切换完成后加载并设置 UI/编辑器字体；保留原 Latin 回退、原截图及业务断言。字体源 SHA256 固定，生成工具只在维护夹具时使用，测试直接消费仓库文件。独立 fontconfig 限制为 Latin 字体，在原三项失败中本机复现软换行与分组标题两项，根工作区标题本机原通过；补齐字体后三项均通过。最终保留默认Latin字体并排除系统CJK字体的完整434项全部通过，零重试、PNG基线不变；字体/字符清单损坏与未覆盖字符三个反例被拒，原38个字形轮廓和字宽不变，字体重复生成字节一致。证据见[本地验证记录](../references/webview-local-cjk-font/README.md)，复用既有Webview dist，不代证新head完整CI。该替代范围限于 Webview harness，不为 VSCode Host 注入测试字体，notifier-locale 的 VSCode 下载 ECONNRESET 另行处理。

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

第三轮实际Actions已证明隔离双包构建及checkout清理成功，随后文件清单回归错误地依赖外层checkout的dist。选定修正为：候选模式先核同批包回执与原VSIX摘要，再把原包dist解到测试私有目录并核构建文件摘要；真实主/notifier stager通过显式dist输入运行原staging规则和`vsce ls`，主包仍使用production准入。生产ZIP独立检查必需资源、禁止源码/debug目录及六native目标，检查后复算原包摘要。默认本地stager路径不变；不在外层补build，不借source-build输出，也不在candidate模式跳过staging断言。失败producer的原包仅供诊断，不能因单项复验通过补发正式transfer或拼接验收。

旧原生资产回归对打包器`cpSync`固定源码字符串的检查不能证明复制行为；显式dist接口改造后改为实际调用production stager，逐文件检查原fixture dist与六资产复制字节，以及源缺失时失败。正常打包默认输入仍为主扩展dist；原worker构建接线检查保留，结构fixture不加载原生机器码，不外推平台验收。

`packaged-host`只复制/解包两个输入包到测试副本，记录删除依赖声明、wrapper、测试命令与测试模式的变更清单；notifier也从输入VSIX stage，禁止偷用源码dist。记录原VSIX摘要和测试副本摘要/变更规则，原包前后摘要必须相同。它证明实际production payload的instrumented集成，不称原样安装。

`installed-pair`在空extensionsDir用原VSIX安装；driver作为单独扩展/外部自动化，使用公开命令/UI并读取外部可见证据，被测包无测试main、manifest改写或smoke模式。安装前后原包摘要相同，记录扩展ID/版本、依赖、activation、打开画布、Terminal响应/几何/Stop、主与notifier路由、回跳和locale。操作系统通知可用平台适配的测试接收者证明路由，系统桌面实际呈现另标manual/observational，不能以本地双包安装代证Marketplace自动下载companion。

中文 locale 重开后，新 Terminal 的身份基线必须来自上一场景关闭前实际观察并冻结的 Terminal ID 集合。`.canvas-shell` 只证明页面外壳存在；`main.tsx` 的 `hostState` 初始为 null，收到 bootstrap/stateUpdated 后才渲染旧节点。因此不得把重开后首次可能为空的 DOM 集合当作完整基线，也不得以若干次相同采样或固定 sleep 认定恢复完成。`run-installed-pair.mjs` 在英文场景的原节点 Stop 后、公开关闭前读取并记录全集，核包含两项原场景节点；`prepareInstalledLocalizedStop` 在原20秒绝对期限内只读等待该精确集合，再发一次公开创建、只接受一个新增 ID，并在创建后继续核原集合未丢失。未知额外/重复 ID、旧节点未恢复、多个新增节点、超期及原动作不可用均失败，不取 `.last()`、重试创建或刷新基线。基线未就绪和新增歧义的原采样须在断言前保留，一次公开创建的请求/完成时间分别记账。同原 production bundle 的受控测试已复现：外壳存在时基线为空，一次创建后的首个 bootstrap 渲染两旧一新，旧夹具立即误报多新增。新真实前端回归等原精确集合后一次创建通过，同时真实两新增仍失败；这证明夹具存在该窗口，第十轮 Windows 原报告缺创建前 ID 样本，不能把受控样本冒充原 CI 时序。

同一原样安装入口的英文首次创建和通知场景也使用 `findUniqueInstalledTerminalCreation` 核精确身份差集：私有空画布首个创建只能得到一个 Terminal，通知创建保留原 ID 且恰好新增一个，中文重开前集合必须正好是这两个已验证节点。读到多节点不取最后一项，也不将多创建混入恢复基线；所有原采样在拒绝前登记。此项补齐CI身份验收缺口，没有证据声称产品曾在英文场景重复创建。

独立driver先验证原样安装/activation并完成控制握手，外部观察器连接固定Host的CDP后，才由公开命令创建画布/Terminal。实际Linux诊断证明晚连接可漏掉已经创建的内层webview frame；连接后创建的单变量对照读到真实正文及PTY子进程尺寸。准备顺序不改变被测包、CSP或产品等待。resize使用实际公开角把手并发送完整指针动作，不使用不存在的`se`标识；读取当前frame视口与把手位置选取画布内的有限增长路径。原bottom-right固定向外拖动在已fit的狭窄画布中越界，仅pointerdown进入产品页面，pointerup缺失；top-left画布内对照收齐事件，完整公开流程诊断中的真实原子进程由64×20变105×34。正式检查保留实际UI变化与原PTY子进程几何，不派内部消息或以观察器几何代证PTY；en/zh-cn重开均从自己的公开准备动作开始。

第五轮实际macOS入口已成功安装原双包，但`--user-data-dir`位于长证据路径，VSCode主IPC在激活前报超过103字节及`listen EINVAL`。`prepareRuntime`按Unix平台实际socket限制检查runtime、user-data和TMPDIR的完整控制路径；优先私有系统临时目录，仍超限时选择短私有`/tmp`路径，再超限直接在准备阶段失败。原样安装显式将user-data放在私有runtime内；Unix TMPDIR也放入已核短runtime，避免内置agenthost再生成超长socket。settings与Host日志先导出到证据目录，确认原Host/进程退出后再回收短目录。双窗口有意共享的runtime身份不改，不能用公共可写目录、改bus环境或禁止真实IPC规避失败。

第五轮Windows公开resize后Node `process.stdout.columns/rows`仍为初始70×22。固定Node源码证明这些属性和`getWindowSize()`读取缓存，尚不能从缓存推定ConPTY几何。选定原子进程在公开Terminal输入收到唯一`geometry:<nonce>`后，以公开`tty.WriteStream(1)`构造器从同一原fd查询当前OS尺寸，同时记录缓存尺寸、原PID/PPID、nonce与采样时间。driver只发送请求，不传目标尺寸；前后原PID与请求身份必须匹配，真实几何未改变仍失败。不会靠SIGWINCH、provider ACK、新进程重挂或观察器自行resize代证。先用真实PTY且不发送SIGWINCH的回归证明缓存未变时仍能读到内核变化；Windows最终判断须由实际runner验证。

固定VSCode冷下载的版本列表请求位于锁定库archive重试之外，第五轮两源码case在metadata连接`ETIMEDOUT/ENETUNREACH`时未启动Host。下载准备只对结构化、已识别的传输错误有限重试（最多三次、同版本与cache），全部消耗原五分钟基础设施绝对deadline，逐次失败保留。不重试非法版本、错误归档或校验/解压/本地权限错误；不回退stable或其他缓存版本，不重跑产品case来抹去产品失败。固定产品版本仍在下载后独立复算，产品动作等待不增加。

文件视图的测试清理必须按原目标身份关闭文件。第五轮在首文件成功后的清理点记录editor generation5被dispose、generation8重建；公开VSCode1.142.0及原production双包的受控焦点对照证明，旧`closeVisibleEditor`在`showTextDocument`与`workbench.action.closeActiveEditor`之间收到画布refocus时实际关闭原画布，保留目标文件。选定按原URI和原ViewColumn解析唯一`TabInputText`，调用公开`vscode.window.tabGroups.close(originalTab,true)`并要求确认成功；不依赖当前active editor，不关闭或重建画布。split创建/复用、原mounted页面及reader结算断言保留；受控对照只确认关闭竞态，不把第五轮后续点击的其他未知因素写成已排除。

原包外部DOM取证还证明窄editor frame宽313时shared文件按钮中心x402在视口外，旧合成click仍能派发成功。这是确定的输入前提缺口，不以产品打开成功追认为真实用户能点击。选定只在测试probe增加文件按钮的实际矩形、disabled和中心命中观察；文件点击前通过现有节点focus入口把目标放入当前画布，并在原10秒动作预算中确认目标可见且中心命中。合成文件输入补齐同一primary pointer的down/up和鼠标事件，点击时再次核实际hit test，拒视口外、被遮挡或disabled按钮。正式file打开、split和reader验收仍由原Host断言承担，probe仅证明测试前提，不生成产品通过结论。

当前production的真实Host首跑证明focus命令返回不表示页面已经完成缩放：probe采样后按钮矩形从x493/y243变为x432/y216，点击时仍不可命中，检查按预期失败。准备必须观察页面有焦点、原目标可命中及连续矩形采样稳定，再在同一原期限内发送一次点击；不能重试已经失败的点击或移除hit test。外部DOM取证显示focus后新目标已居中且可命中，但多选集合仍可保留之前的节点；selection不能代证动画完成，也不是点击目标的前提，不在文件打开case中附加selection约束。短路径迁移后，写入用户设置的夹具显式接收原user-data路径，不再从artifacts位置猜测；多次重开的日志按原session目录保留，最终导出不能用最后一次日志覆盖setup证据。

第六轮源码file/views在panel点击前失败，原probe证明目标矩形已经可命中，而`document.hasFocus()`为false。产品的`host/focusNode`负责视口居中，`scheduleCanvasShellFocusRestore`明确仅为editor恢复根元素焦点；不能把panel reveal/居中当作面板文档focus已完成。当前production及旧原生资产的真实Host受控对照，仅在panel文件点击准备中增加公开`devSessionCanvas.canvasPanel.focus`，完整file/views随后通过。选定将此动作纳入原10秒准备期限，继续等待文档焦点和稳定hit target，不要求产品新增panel自动焦点、不取消focus条件，不重试已经派发的点击。

`runtime-mode/reload-clear` 继续从运行中的原会话进行模式切换，不增加静默期、回调重试或产品保存等待来迁就实现。第六轮实际删除期间收到先前发出的空输出批次，触发状态回调及保存；非永久边界在删除后立即检查并拒绝。受控原生产方法对照同时复现模拟 reload 和生产 deactivation 的 shared/non-shared 路径：模式清理发生在永久事件准入关闭之前，首轮 callback 集合排空不阻止删除期间的新回调；回调完成后原 `modeSwitchCleanup` 失败仍保留。同输入有通过轮次不能解除这项责任。正式边界、实证范围和未修复状态见 [runtime-shared-root-canvas-sync.md](runtime-shared-root-canvas-sync.md#ci-改造时发现的模式切换回调边界2026-10-18)。既有 reset 等立即拒绝、单节点删除有界保存及 preserving reload drain 的范围分别保持，不全局扩大 drain。

原样安装resize的新UI box观测、唯一geometry请求和原子进程当前OS尺寸检查共享动作开始时冻结的原20秒期限。观测增加不能在前一步等待结束后重置20秒。短路径settings和日志须导出到原证据根；跨窗口共用runtime不会使两个独立profile互相覆盖，跨阶段真实重开也不得因退役短目录而失去原状态。

source/packaged/Marketplace正式Host把每个私有路径登记到同nonce的Host证据目录。设置在prepare时导出、每次Host退出后再次导出设置和日志；只有外层任务已独立核完全部预期Host退出及fixture清理，才按登记的原路径回收runtime和外移profile。登记必须核nonce、原scene范围及按同系统临时根重新计算的路径，禁止删除任意输入目录；真实重开与双窗口共用目录只在完整因果suite结束后回收。清理失败保持producer红灯，不能先删除证据目录或活动Host的状态。

通知夹具的 receiver 是外部操作系统后端替身，不改主/notifier包。实际输入记录证明原Node CLI收到`notify`并发出OSC9、真实节点attention=true；独立driver只读观察证明Linux的VSCode登录shell解析覆盖了launch PATH，receiver目录丢失。installed启动显式`--force-disable-user-env`，保留冻结的私有receiver环境；不在产品activate后改process.env，不改变system桥接配置，也不把fallback工作台消息当系统路由通过。driver只记录所需receiver路径是否生效，不导出完整环境。新Terminal先等待真实mounted终端出现可见首批输出，再输入，准备和实际动作仍在原等待期限内；前置握手、正文、原子进程/几何/Stop等已观察事实逐阶段保留，后续失败不抹掉它们。

第六轮的macOS/Windows原样安装均已通过activation、真实I/O/resize、原shell和子进程Stop及OS receiver投递。随后`vscode.open`回调等待超时，两平台原截图均为VSCode询问“Allow 'Dev Session Canvas Notifier' extension to open this URI?”。固定宿主的`ExtensionUrlHandler.handleURL`等待用户确认后才转发原URI，因此不能在等待公开命令返回后才处理UI。选定由外部观察器并行等待该命令和真实workbench确认框，核Notifier显示名及完整原callback URI后点击一次Open，保留复选框默认不记忆；命令、确认UI和回调居中观察共用既有20秒绝对期限。不配置trusted extension、不修改UriHandler、不调用测试回放命令、不绕过确认。确认缺失、错误扩展/URI、取消或命令失败仍失败。第六轮macOS失败收口又出现kill EPERM，记录为独立清理失败，未定因不豁免；新输入需三平台正式完整验收。

真实固定宿主的受控URI对照证明，确认框只有URI元素的`title`，没有对应`aria-label`，且显示的是`vscode.Uri.parse(original).toString()`编码结果（例如query中的`=`与`&`被编码）。独立driver先用公开`vscode.Uri`只读返回原字符串及该宿主的序列化结果，外部观察器据此精确核对完整title；不自行猜编码、不匹配截断文字、不增加宿主不存在的属性前提。此只读准备、真正公开open及UI交互仍共享原20秒；该受控对照使用未知token只证明真实确认流程，不能代证原通知token的产品回跳。

系统通知回跳遵守`canvas-node-notifications.md`：回调只居中目标、保持原selection和attention，不自动输入/focus或确认。接收前用原Stop节点建立不同selection，通过公开fit-all把目标移离视口中心；点击receiver或打开其原protocol URI后核真实目标在视口中心、selection未变且attention仍为true。最后由用户UI左键点击目标，才要求attention=false。真实桌面呈现继续标observational；不得改产品令回跳自动确认来适配错误旧断言，也不得仅以attention仍true代证回调执行。

原样安装的locale重开不验证状态恢复，英文Terminal全部Stop并核原进程退役后，用公开`closeAllEditors`关闭画布，再请求公开的应用退出并分别核原应用正常关闭与原Extension Host消失；中文Host由自己的CDP连接与公开创建动作开始。Windows/Linux使用`workbench.action.closeWindow`，macOS使用`workbench.action.quit`。固定VSCode1.142.0的commit为`6d62b1d5dace93a33b3a6d3eca1317bd5e15bcb1`，其`LifecycleMainService.registerListeners`明确macOS关闭最后窗口不会退出应用；`desktop.contribution.ts`的公开Quit调用nativeHostService.quit。driver只能在真正派发该公开命令前记录请求，不能将请求回执当退出事实；两种locale各自在原30秒内观察child关闭及同原PID/startTime的Host消失，清理kill不计入此前验收。第八轮macOS原Host确实exit0，应用仍保留而触发旧close断言；追加的signal0/kill EPERM仍是独立未定因清理失败，不因更换Quit追认原轮成功。

原Stop按钮通过可见文本提供可访问名称，没有单独aria-label；中文断言通过真实button角色/精确名称“停止”核对并实际点击，不新增产品属性来适配错误夹具。第八轮Windows中文页已显示“活动”，但画布处于正式概览模式，产品按设计隐藏并禁用操作按钮。创建前记录原节点集合，创建后要求唯一新增Terminal并固定nodeID；原20秒准备内通过用户可执行的标题栏双击聚焦该节点，再观察概览退出、原节点仍存在及精确名称按钮可见可用。准备与一次Stop点击共享绝对期限，不关闭overview配置、不强点隐藏按钮、不使用内部focus命令；导航或实际Stop失败不重试。

Windows进程身份查询只需要原PID、创建时间和存活状态。第八轮win32-x64原生操作已经started，尚未派发I/O时，旧PowerShell+CIM查询在原5秒内超时；另一个完整组合批次同逻辑通过，历史CIM阻塞的具体服务机制仍未知。选定`scripts/smoke/windows-process-identity.ps1`直接用`.NET Diagnostics.Process.GetProcessById`，在一次观察内持有SafeHandle、读取StartTime并核HasExited，finally释放；不导入CIM、不扫描全系统、不以空输出或权限错误当消失。只有明确不存在或已退出可返回absent，访问拒绝和不一致结果继续失败。`processIdentity`及`waitForHostAbsence`每次查询的5秒上限与轮询都夹到调用者原剩余deadline，逾期结果不能签发原身份消失。跨平台真实存活/退出及unknown、错PID、空响应、迟到响应反例需验证，原生有限操作的实际I/O/resize/exit17/Stop及资源退役完整保留。

第四轮packaged文件打开失败保留原producer：实际生产bundle的d3-drag在夹具合成mousedown的`event.view=null`处访问document失败，随后click路由未生效。原bundle原行/列与锁定d3-drag源码一致。选定修正为测试DOM动作给MouseEvent传所属document.defaultView及真实目标中心、buttons等浏览器字段；不绕过产品onClick/Host.openCanvasFile，也不给生产drag加null容错去支持不完整测试输入。原包浏览器回归在minimal/card均先复现同一异常，修后私有production build两个行为回归通过，保连续打开和后续真实拖动；原可见文件/split group/画布保持mounted断言仍由Host用例验收，不能以浏览器消息替代。真实Actions新输入才能验收。

固定VSCode下载仍只使用计划的1.142.0；macOS官方包的`Info.plist/CFBundleExecutable`声明入口为`Contents/MacOS/Code`，锁定test-electron返回旧`Electron`路径。解析实际同包plist并要求声明文件存在，再核同包app/package.json版本；不可将不存在的旧路径再次当作安装目录，也不回退其他版本/系统宿主。官方ZIP入口、plist与SHA保留作诊断输入，真正macOS安装与运行仍由实际runner验证。

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

deadline 的合同测试使用受控时钟，分别验证调用时传入的原剩余预算和观察完成后的超期拒绝。不能把调用前计算的 timeout 与测试桩稍后重新读取的真实时钟直接比较：第九轮39119709105的中文 Stop 合同在这两个读时钟点之间跨过毫秒边界而误报。修正测试的时间模型，保持动作/观察的超期反例及一次调用限制；不增加实际驱动的预算、不对业务失败重试。Windows 身份合同的同类断言一并用受控时间验证。

前端输出去重的计数必须在原 session 的投影写入完成后读取。第九轮同输入原 trace 中，local output 的 DOM 曾出现 marker，但随后覆盖快照重建缓冲区；即时 probe 的 `terminalProjectionPending=true`、原 session 已绑定、缓冲区为空。DOM 暂时可见不能证明覆盖快照已应用，也不能把尚在重建的空缓冲区当成丢失正文。该 case 在原40秒内共用绝对期限，先验证可见正文，再只读等待原 session 的 `terminalProjectionPending=false`，最后保留一次/两次完整正文的原严格计数。用同一 production bundle 的真实 xterm parser 暂停/释放验证观察不能提前完成，未释放与迟到结果仍失败；不修改产品投影、baseline 或 payload，不以固定 sleep 代替完成条件。

预算清单同时冻结真实helper源码摘要；源码改动后先显式执行 `scripts/gates/build-smoke-budget.mjs`，审查每个场景的期限、等待表达式、倍数和有限循环，再提交清单。正式入口和本地门禁合同都核对当前源码，不在CI内自动重生成以跳过审查。第七轮39112933251在计划解析正确拒绝遗漏更新的 `extension-tests.cjs` 摘要，后续业务任务未执行；本次重新生成的123场景与旧版全部期限和取值相同，仅源码摘要和证据行号变化。完整新输入仍需另次运行，不能追认被拒绝的原轮。

基础设施默认上限选npm ci10分钟、单次浏览器/VSCode获取5分钟、Host启动/测试驱动握手3分钟、Host退出30秒、私有资源cleanup60秒、失败取证30秒。它们是拟议的首轮工程预算，须真实CI校准，不写成产品SLA。普通Host整场上限由计划计算为启动预算+所有case不重叠budgetGroup之和+cleanup/退出/取证储备；job timeout覆盖其所有Host计划总上限再加5分钟收口，不能只写一个90分钟大上限。保留原asset20分钟、渠道45分钟/finalize20分钟外层保险，拆层后有观测数据再调整。

启动完成、产品Stop、尾部保存、reader消费、原session退役、Host退出、Supervisor退出是独立对象结果。持续Supervisor在活跃模式下允许存在，不强制全部case结束后它必退出；测试私有Supervisor到组收口时应按夹具所有权有界回收并记录。旧Host退出/保留场景用原PID/startTicks或平台等价身份确定前提，不能只sleep3秒假设已退出。为了cleanup执行kill不会把之前业务超时改为成功。

安装夹具的清理逐阶段记录 CDP 断开、原私有进程组回收、原 Host 身份消失、子进程 close、双包摘要复算、日志完成与私有目录退役。信号失败保留 `code/syscall/stack` 及原 group PID、实际 target 和 signal；只把 ESRCH 解释为已不存在，EPERM 等继续失败。第六轮 macOS 两份原报告只有 `kill EPERM`，不能据后续成功断定其具体 syscall 或根因已修复；新增取证服务于下一次原失败归因，不改变原清理期限及后置断言。

每job在固定`gate-artifacts/<job>/<variant>/`写结果/环境/有限stdout-stderr/阶段及原身份。失败先保存最后有效snapshot、实际页面probe及其新鲜度、process/session/owner/frame/readId、等待predicate/deadline，再清理；敏感环境和凭据不采集。clean构建/smoke的临时目录在退出前把必要现场复制到固定工件根，不只打印/tmp路径。trace/截图、包/原生摘要和case日志always上传，成功保留回执与必要摘要。首次失败与后续取证/cleanup失败均保留。

工件导出是独立、有界的取证动作。正式输出保留任务/Host回执、环境、原身份、实际步骤、probe/快照、截图/trace、生成的工作区与控制输入、SSH配置和sshd日志；原包、源码构建与native archive由各自不可变transfer工件保留。依赖副本、宿主/浏览器缓存、SSH私钥和完整HOME不进入结果工件。每个结果工件带内容清单，记录实际保留路径、长度、摘要及明确排除的目录类别；聚合从实际下载ZIP复算清单，缺失/改动不能通过。日志超2MiB时保留头64KiB及尾部，其原长度和保留区间显式记录；结构化回执、probe、trace或失败输入不能截断。首轮取证容量上限为每工件256MiB、单非日志文件64MiB及10000个文件，超限或取证超时使job失败并保留已收集证据，不能静默丢弃。预算与容量属于待Actions校准的基础设施输入，不扩展产品等待。

任务回执与工件清单中的相对路径统一在producer写入时序列化为`/`，Windows本地文件访问仍使用系统路径。第三轮真实Windows回执使用反斜杠而清单使用`/`，聚合按原不安全路径规则正确拒绝；修正producer，不在下载后重写原回执或放宽验证端路径规则。历史Windows工件只可做明确标注的序列化对照，不能借修正后的内存对象追认原轮验收。

聚合失败摘要优先指出实际失败task及其原阶段证据，再指出来源/结构错误和未运行项。第四轮regression分片中的native-assets回归失败使整个producer红灯，其他已成功执行的task也不能满足正式验收，但不得把这些连带拒绝的typecheck写成根因。`firstFailure`表示冻结目录顺序下优先选出的原task失败，不声称是不同并行job的墙钟最早失败；producer红灯仍使整批失败，不放宽来源、上传或取消检查。

本地隔离验证同样先确认执行进程及其清理已settle，再在取证30秒/清理60秒储备内导出必要证据和回收checkout；不对仍活动的checkout并发复制或删除。未settle、取证失败或清理失败保留私有目录位置并使本地结果失败。源工作区和其他任务目录不在此回收范围。

本地预合并在私有clone从冻结base执行真实`git merge --no-ff --no-commit`，由实际index生成tree并核merge commit的两个parents；不依赖Git2.34.1尚未支持的`merge-tree --write-tree`。合并冲突在创建任何候选commit前失败，记录冲突路径；原head/target refs不移动，不选择ours/theirs代替用户源代码。正常合并须实查base与head两侧独有内容，已有预合并只在parents精确匹配时复用。

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

当前已验代码为PR335 **ed9257bdec3a78110fec0eb6c30a2bb587ecb7ff**。正式完整 [39128423778](https://github.com/ZY-WANG-0304/dev-session-canvas/actions/runs/39128423778) 的真预合并为 **1d9bb54b1256f63277ba0ecc29792c4addb1d833**，精确parents为main6e708c6b与该head。247 jobs全部成功，330 actual/passed、324 required/requiredPassed，另外六项为普通PR原生操作校准项且均通过。原aggregate artifact12138480651/producer117684261922/ZIP59e38150、acceptance摘要18540443及原candidate12137068102/producer117679779394/ZIPe6703151均独立验真；同批0.26.0主包d5b8d102/notifier7503971e原bytes与包回执472d023f一致。118源码Host、104packaged Host、六native、两个Marketplace Host及三x64原样安装均在本轮通过。

同已验head与未改PR327 **8313fc725c18c28c51c04cc5f4aa5bd9121f290a** 的最新临时0.26.1组合 [39128957644](https://github.com/ZY-WANG-0304/dev-session-canvas/actions/runs/39128957644) 也已247 jobs全部成功，**330 required/actual/passed/requiredPassed**。真实输入 **63b168e2baadaab4becfd52bb280fc789760d508** 的精确parents为main6e708c6b与组合949432c3，双PR ancestry已核。原aggregate12138705324/producer117687946856/ZIP342e7fa3、acceptance摘要6feb2ffa与原candidate12137876850/producer117683586127/ZIP4e07b3b0独立验真；原0.26.1双包65af3977/e4c0f723与包回执c984a32a一致。结果仅属于该临时输入，不能替代修复合入后PR327的最终正式预合并或release-tag验收。

两批各三份原样安装报告均独立核实际producer、upload ID、ZIP和evidence manifest：productTestMode=false、产品manifest/main未改、测试命令不存在；精确旧Terminal全集恢复后一次公开创建，原PID/父PID同fd fresh几何、Stop后原shell/子进程absence、通知原token确认/居中/selection保留/用户ack、中英文及两个原Host公开退出和全部八步cleanup通过。PR335原浏览器报告还按冻结434目录独立核 **431功能+3视觉全通过、retry0**。原Actions聚合已完整运行；本地没有重新下载全部task再聚合，二者不混账。完整SHA、原工件来源、包bytes、安装几何和验证日志见[实施证据](../references/release-gate-redesign/implementation/local-results.json)。

临时远端分支`ci-0261-premerge-redesign-temp`已在两run终态后按原head pinned lease删除，本地历史及失败证据保留，临时入口未进入PR335。后续只同步验收文档，最终文档head须由自己的稳定CI检查验收，不能套用ed9257bd回执。两项确定产品竞态（旧代恢复迟到撤销当前订阅；生产Runtime mode-switch删除期间接纳callback并缓存失败）未修，仍阻塞0.26.1。15个新增未实施目标、真实TUI、最低宿主/arm64安装/真实systemd与渠道，以及未配置main合并保护分别保持原边界；历史ready45秒、panel焦点10秒、CIM机制及macOS原EPERM仍未定因。

以下保留各历史输入的首次失败、受控修正与当时待验状态，不表示当前ed9257bd仍待完整验收。

第十轮 [39124063678](https://github.com/ZY-WANG-0304/dev-session-canvas/actions/runs/39124063678) 的 head0d02a8b0、真预合并b511d9bf精确main/head parents已核。247 jobs为244成功/3失败，330 actual、324 required、323 required passed、329 total passed（含六校准）；唯一业务首败是Windows中文创建前身份基线歧义，取证/cleanup通过，两个聚合入口正确失败。原aggregate artifact12136700189/producer117671239737/ZIP9e91e19b与原candidate12134839128/producer117666644922/ZIPc992e167及规范包回执5707f95a均独立验真，不签发acceptance。

同head与未改PR3278313fc72的最新真实组合 [39124249017](https://github.com/ZY-WANG-0304/dev-session-canvas/actions/runs/39124249017) 已247 jobs全部成功、330 required/actual/passed。输入65b53ad2的精确parents为main6e708c6b与组合1ced1789，双PR ancestry已核。原aggregate12136247599/producer117673887800/ZIPa6c27486、原acceptance摘要037d8cbb与完整任务/输入/原来源已独立核；原candidate12135812518/producer117667098480/ZIP8afa6e39和规范包回执b63e5081、主66addaf7/notifieraedfc41c原bytes均独立验真。首次本地candidate单range60秒超期保留，原五分钟内较小非重叠range验真不追認前次成功；未执行该轮全task本地再下载/再聚合。

本轮精确locale恢复基线修正已通过115完整门禁/发布恢复合同、431production功能和3视觉，retry0、baseline不变、冻结目录434全部匹配；原432的ID/title/条目均保留，仅新增恢复前提与真多新增拒绝两个真实前端回归。同原bundle先红，新相关3/3绿；原第十轮双包Linux原样安装完整公开流程、原Host退出与cleanup通过，acceptance=false。推送后新head/最新PR327组合完整验收仍须各自重跑，历史绿灯不豁免两项确定产品竞态。

第九轮 [39119709105](https://github.com/ZY-WANG-0304/dev-session-canvas/actions/runs/39119709105) 的 PR335 head 为1a4c5ff8，真正预合并为6f802d43；API核对精确parents为main6e708c6b与该head。247 jobs为243成功/4失败，原aggregate记录330 actual、324 required、293 required passed、299 total passed，31项被拒中27项属于失败regression producer、4项属于失败webview-function producer。真正首败只有中文Stop的二次时钟合同和local output覆盖快照未完成时的正文计数；兄弟task因producer红灯被拒不能另列为产品首败。118 source、104 packaged、六native操作、两个Marketplace Host和三x64原样安装同批通过，errors/notRun空，整轮无acceptance。

同head与未改PR3278313fc72的临时组合 [39119845747](https://github.com/ZY-WANG-0304/dev-session-canvas/actions/runs/39119845747) 已247 jobs全成功、330 required/actual/passed。真实输入c2ef2a8c的精确parents为main6e708c6b和组合e1cfb59f，双PR ancestry已核；原aggregate artifact12135230836/ZIP80741221及acceptance摘要7578d4c9独立绑定真实producer，固定原head验证器核完整原验收回执通过。这个结果只属于该临时输入：不能追认上一轮成功、代证本轮尚未提交的修正，或解除已确定复现的两项生产竞态。

本轮只修观察契约。受控时钟与原session投影完成观察的完整门禁/发布/恢复合同114/114通过、0失败/0跳过。浏览器登记430→432，原430条目及ID/title完整保留，只增Agent/Terminal真实parser暂停/释放反例；同production输入429功能和3视觉全部通过、retry0、baseline不变，原功能3600000ms/视觉600000ms任务预算及进程组退役核对通过。production webview.js与第九轮原bundle字节SHA相同；旧即时计数在同bundle受控暂停下先红，新观察及原计数4/4绿。原40秒业务期限覆盖首输出、快照完成和两次同正文输出，只读pending观察不以正文数量作为通过条件。新增修正后的正式PR输入及最新发布组合仍须完整执行。

三x64安装原工件已逐个独立核producer、ZIP和内容清单；原真实I/O/resize、原进程Stop、通知原token公开确认/居中/selection保持/用户ack、独立中英文、应用与Host退出及cleanup全部通过，productTestMode=false。macOS公开Quit和Windows唯一新增节点的概览导航已有真实平台结果。历史CIM阻塞机制、macOS原EPERM及第八轮ready/panel-focus间歇首败仍未定因，当前通过不抹去原失败。完整原输入、摘要、取消/下载失败尝试和取证局限见[实施证据](../references/release-gate-redesign/implementation/local-results.json)。

第八轮 [39113768051](https://github.com/ZY-WANG-0304/dev-session-canvas/actions/runs/39113768051) 与未改 PR327 的组合 [39113960317](https://github.com/ZY-WANG-0304/dev-session-canvas/actions/runs/39113960317) 均已终态失败。PR335 head03930c18 的真正预合并e4331d26精确parents为main6e708c6b与该head，247 jobs为241成功/6失败；330 actual、324 required、321 required passed，326 total passed包含5个校准操作。组合真正预合并4dd88eaa精确parents为main6e708c6b与组合6109a027，PR33503930c18和PR3278313fc72 ancestry均已核；247 jobs为242成功/5失败，330项全部required、327通过。两轮各source117/118、packaged104/104、Linux原样安装通过，errors/notRun为空，均无acceptance；required首败分别为real-reopen或file/views，加macOS及Windows安装。PR335另有win32-x64校准操作身份观察失败，不能把326 total passed误写为required通过。

原工件已独立核实际producer、上传ID与ZIP摘要，原双包各有同批回执；第八轮candidate artifact12131187990/ZIP1e0e1498、规范回执1b86af7b，组合candidate12131977938/ZIPb8089216、规范回执b19f6505。两次本地全量逐task下载均在原300000ms终止，部分原现场保留，独立全量再聚合未完成；Actions正式aggregate的完整330任务结果与此分别登记，不加时或拼接追认。完整摘要和原地址见[实施证据](../references/release-gate-redesign/implementation/local-results.json)。

三个平台观察修正已经实现，当前113项门禁/发布/恢复合同同批113通过、0失败/0跳过；四workflow actionlint正确路径exit0，此前误指不存在workflow的调用明确失败、不作通过证据。真实Playwright注册429→430，原429全部保留，只增概览中文Stop准备回归；同production输入427功能与3视觉全通过、retry0、baseline不变。原第八轮生产bundle的真实标题栏双击→退出概览→原ID一次可见Stop回归通过。新driver消费第八轮原样Linux双包，真实I/O/resize/Stop、原通知token公开确认、回跳居中/selection保持/用户ack、独立中英文和两个应用/Host正常退出/清理全通过；其中文初始概览为false，不能外推Windows概览和macOS Quit，所有局部诊断acceptance=false。

两处原source失败保持未定因：第八轮real-reopen已通过setup保存、原Host退出和离线屏障，verify期间activateExtension的公开open→closeAllEditors→open后generation5没有ready/bootstrapAck，原45秒断言失败。组合file/views已ready/bootstrapAck且目标稳定可命中，但一次公开panel focus后document.hasFocus=false，在原10秒准备失败。当前原测试动作/产品bundle完全不改、仅外部CDP网络和Runtime只读观察的两个Host诊断均通过并核原退出/退役；这只证明并非每次必现，不能说明历史根因已消除，也不能据此删除focus/ready前提、加sleep或自动重开。新head跨平台完整验收与两项生产竞态仍未收口。

当前实现包括15个reusable job、六发布外层job、保守PR分类、固定输入与阶段回执、共享production浏览器构建、同批双包/消费式packaged/三x64原样安装及原包恢复模块。真实旧覆盖迁移由`scripts/smoke/smoke-implementation-map.json`绑定152个设计目的地，其中137项为implemented-unverified、15项not-implemented；静态AST可达/实际step审查不产生产品验收。旧入口与具体断言的迁移替换理由保留在同一映射，未把未实现缺口记成通过。

已实跑：本地423前端功能、3固定视觉、Marketplace浏览器；完整登记80项regression同批80通过；source独立case及SSH退出/保留、旧代/多窗口/重开和两个Marketplace Host的本地诊断。诊断用旧dist/旧native资产，只证明夹具与新观察接线，不能代证新提交SHA。当前有界证据正反例已通过，SSH实际导出42文件/461626bytes；SSH依赖包固定官方版本/摘要、显式extensionEnvironment、真实短socket路径、零节点cleanup观察与Marketplace中文locale夹具已修，产品等待和断言含义保持。

真实Actions首轮39093713215（预合并354e6129/head455a494f）取消，第二轮39094300198（预合并040883c8/head4c3fa9bf）失败；各轮独立记账。第三轮39095480885以真实预合并612a891c/head924cae96运行，parents独立核为最新main6e708c6b与该head。同轮三regression分片、输入、production浏览器构建、423功能/3视觉、Marketplace浏览器、六load及六原生有限操作、source-build、118源码Host和两个Marketplace Host均通过。原production双包各构建一次且隔离checkout退役通过，后续文件清单测试错读外层dist使package-clean失败；无正式candidate transfer，104packaged和三原样安装not-run。聚合另按原路径规则拒绝Windows回执反斜杠证据引用；稳定检查失败，未签发acceptance。

candidate模式现消费该轮原包dist并运行真实production stager/vsce ls及原ZIP检查，在外层两dist均不存在的私有源码夹具诊断通过；原包摘要不变，没有新增构建。篡改/源码debug混入/缺本地化/不安全ZIP路径和helper权限反例通过。Windows证据引用改在producer序列化为`/`，原历史工件不重写不追认；真实原回执反斜杠经诊断转换可对应清单原hash。第三轮通过只属于其固定输入；第四轮下述结果验证了这两项修正，三安装/剩余packaged及PR327最终输入和已确认生产恢复竞态仍未闭环。

第四轮[39097246318](https://github.com/ZY-WANG-0304/dev-session-canvas/actions/runs/39097246318)在真正预合并aa969012/headcdf40738完成，parents核为main6e708c6b及该head。247 jobs为240成功/7失败，六load/六有限操作、118源码Host、2 Marketplace Host、423功能/3视觉、source-build及package-clean同批通过；双包各build一次且正式candidate artifact12125466855已上传。packaged103/104通过，余项为文件视图点击；regression一分片固定源码字符串、三安装的官方入口/CDP观察失败。全量330task回执和来源实际收齐，Windows原回执无需修改即验真，errors/notRun为空；299task满足聚合、31被拒包含失败分片producer连带拒绝，整体失败/无acceptance。上一轮修复已生效，但不能据部分通过签发完整验收。

当前native stager行为、macOS同包入口、安装的CDP/resize/receiver/回跳/locale前提和合成MouseEvent缺view均有明确证据与回归。Linux第四轮原双包完整公开流程诊断exit0、两个Host公开退出0，原shell/子进程Stop后absence；通知真实居中/selection保留/attention不自动清除、用户点击ack、中英文实际交互通过。原包前后SHA一致，acceptance=false。合成点击minimal/card在原包均先红，修后两个行为回归绿且后续真实drag正常；原426浏览器注册未删改，新目录428项，完整production425功能与3视觉通过，实际执行集合匹配冻结目录，baseline不变。93门禁/发布恢复合同、typecheck、native-assets完整链、vscode-runner环境、四workflow actionlint/结构合同已过；新增首败摘要及严格验收/校准25项针对复验通过，完整425功能与3视觉也通过，执行集合精确匹配冻结目录；正式104packaged/三安装及PR327组合仍须新head实跑。

第五轮[39101493143](https://github.com/ZY-WANG-0304/dev-session-canvas/actions/runs/39101493143)在真实预合并7375f4a1/head2c4a16af结束：247 jobs为239成功/8失败，330 actual、324 required、318 required passed，324 total passed包含6校准操作，不称required全通过。六native、三regression分片、425功能/3视觉、两个Marketplace Host及Linux原样安装同批通过；source115/118与packaged103/104，三固定宿主metadata网络失败、源码文件清理、macOS长IPC和Windowscached geometry失败。errors/notRun为空，严格聚合不签发acceptance。

PR3352c4a16af+PR3278313fc72临时0.26.1组合[39101774719](https://github.com/ZY-WANG-0304/dev-session-canvas/actions/runs/39101774719)在真实预合并a450a724结束，parents独立核为main6e708c6b及组合head56d54377。247 jobs为243成功/4失败，330全部required/328通过，仅macOS和Windows原样安装失败；source118/packaged104、六native、基础及候选同批通过。该轮和第五轮独立保留，不用互补结果签发验收。

当前关联修正：私有短runtime/user-data/TMPDIR及安全登记退役；settings路径显式传给原夹具，日志按每次重开session保留；原子进程由唯一公开输入nonce触发fresh同fd的OS几何查询；下载只在同原五分钟期限最多三次已识别transport恢复，拒semantic重试；本地Git2.34使用真实index merge核精确parents/拒冲突。原包文件tab焦点受控先红后绿；新fileEntries probe、稳定命中准备和完整primary pointer保持原file/split/mounted/reader断言。当前production完整文件视图Host诊断通过，原Host退出及短目录退役通过，仍是旧native诊断acceptance=false。最终105门禁/发布恢复合同、typecheck、vscode环境、四workflow actionlint/结构合同通过；真实浏览器428→429仅增一项，原428完整保留，production426功能和3视觉全通过/基线不变。123 suite timeout逐项与上一head相同，installed新观测共用原20秒。新head正式跨平台/完整来源与更新后的0.26.1组合仍须运行。

`main`保护API返回404 Branch not protected，尚未配置required check，不能声称已有强制合并阻断。生产旧代恢复撤销订阅竞态依然是独立发布阻塞；即使CI改造通过也不由此宣称0.26.1可发布。渠道模块只在本地HTTP/内存受控输入验证过，未进行真实发布/上传重签对照，未知内容继续拒绝完成。

## 依赖安装范围（2026-10-23）

正式任务图的安装范围现按实际调用派生：插件、notifier、共享包及根工具使用plugin，含市场workspace类型/API/web的regression使用marketplace；候选双包独立checkout也用plugin。市场Host的Node HTTP夹具及市场浏览器API拦截不启动Worker。完整任务、预算和验收规则不变，细节与本地证据见[依赖安装边界](smoke-dependency-install-scope.md)。本轮移除根Wrangler/workers-types重复声明，保留app所有权和原锁版本；原CI ECONNRESET仍缺包名证据，不声称已修复网络根因。


## 正式方案：producer 终态观察等待（PR337 门禁 review）

run 40516969808 的 source-build/package-clean 在核验 native-load artifact 时，从 jobs API 读到 producer in_progress 后立即失败。当前实现只读取一次 jobs，不能处理实际 job 结束与 API 终态可见之间的时间窗口。选定改法：仅对本 scope 已选 artifact 的、已唯一绑定到当前 attempt 的 producer，在原 300 秒绝对采集期限内每秒重新查询；未完成状态不会直接当成成功。每轮重验 run/head/attempt，保持 producer job ID 不变。未知状态、缺失/重复 producer、身份变化立即失败；持续未完成在原 deadline 失败，不重置期限或一般性重试其他校验错误。获取日志/下载 ZIP 仍在 producer completed 后执行，结论、upload ID、digest 和回执核验维持原约束。无关运行中 job 不参与等待。不把最终完成本身视为产物验收。

证据：最终 jobs 记录中六个 native producer 全部成功，最晚 win32-arm64 于 14:06:36Z 完成；package-clean 在 14:07:01Z 开始来源核验、14:07:03.085Z 抛出 in_progress，source-build 于 14:07:06Z 开始同样失败。说明终态查询与最终 job 记录不一致，但旧日志未打印具体 producer ID，不能进一步指定是哪一个 job 或断言具体缓存层。原始记录位于 `.debug/review337-gate-jobs.json`、`.debug/review337-package-job.log`。新等待日志会保留首次未完成的 job ID/状态以及观察次数。定向 provenance 测试 14/14 通过，覆盖迟后完成、无关运行中 job、run/head/attempt/job ID 变化、缺失/重复/未知 job、超时、上传 ID/ZIP digest 以及 HTTP 原期限与重定向凭据隔离。完整 `node --test scripts/test/test-gate-contracts.mjs` 101/101 通过（约 186 秒），lifecycle 10 项、execution-flow-diagnostics、typecheck/build 和 F5 目录准备通过；日志 `.debug/review337-gate-contracts.log`、`.debug/review337-lifecycle-{before,after}.log`、`.debug/review337-gate-{flow,typecheck,build,prepare}.log`。新 head 正式 CI 待验。
