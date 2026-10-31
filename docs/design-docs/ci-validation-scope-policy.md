---
title: 合并 CI 的必跑任务与省略规则
decision_status: 比较中
validation_status: 验证中
domains: [执行编排域, VSCode 集成域]
architecture_layers: [适配与基础设施层]
related_specs: []
related_plans: [docs/exec-plans/completed/ci-validation-scope-policy.md]
updated_at: 2026-11-01
---

# 合并 CI 的必跑任务与省略规则

## 背景与目标

用户指出 PR #350 在代码 CI 已通过后仅补文档，也再次运行全部 jobs，要求明确必须执行的 runner 和可以省略的情形。本设计将问题落到验证任务：runner 是执行 job 的机器，只有取消不适用或已被有效证据覆盖的 job，才能减少机器分配；更换 runner 标签不能消除重复验证。

目标是让每个新 head 都有自己的明确合并结论，同时避免对相同功能输入重复执行昂贵验证。本轮完成现状核验、任务分级建议与实施验收标准，尚未修改 CI；下文推荐规则需要后续实现和反例验证后才能启用。现行规则仍以 `docs/WORKFLOW.md` 与 `release-gate-redesign.md` 为准。

## 已确认的重复原因与代价

`.github/workflows/release-preflight.yml::resolve-input` 取得最新 base/head 的真实预合并结果；`scripts/gates/resolve-plan.mjs::resolvePlan` 使用 `git diff --name-only --no-renames baseSHA inputSHA`。它检查整个 PR 对 main 的差异，而非最后一次提交。

PR #350 的 base 为 `aa18ec56`，代码 head 为 `000757e9`，文档收口 head 为 `66676236`。后两者之间只有 4 份文档变化（其中计划迁移按新增/删除列出 5 个路径），但新 head 相对 base 仍有 workflow、发布脚本和根 `package.json` 变化，`classifyChanges` 因而仍选择 functional + artifact。这个全 PR 比较必须保留：否则未通过的代码后面追加一次文档，就可能逃过测试。

| 输入 | 当前目录任务数 | 当前展开业务 jobs | 加上 4 个控制 jobs 后的执行量 |
| --- | ---: | ---: | ---: |
| 仅白名单普通文档 | 90 | 8 | 12（模型推导，不含不分配 runner 的 skipped 占位） |
| 普通源码路径 | 238 | 150 | 154（模型推导） |
| PR #350 全差异 / 门禁工具 / README | 362 | 273 | 277（#350 已实跑） |
| release-pr / release-tag 完整范围 | 362 | 273 | 277 是同一 preflight 外层时的模型值；其他 workflow 外层另计 |

普通 pr 全范围的 362 项中 356 项 required、6 项 native-operation 为 calibration；发布完整模式 362 项全部 required。这些是 task 数量，不能和 job 或 runner 数量混用。

`catalog.mjs::taskCatalog` 将 input-contract、3 个 regression 分片、frontend-build、webview-function、webview-visual、marketplace-browser 放入无条件基础层。因此单独文档 PR 虽然不会触发 277 jobs，也仍会执行大量与文案无关的功能和视觉验证。

实际 [代码 CI 41226378995](https://github.com/ZY-WANG-0304/dev-session-canvas/actions/runs/41226378995) 与 [文档 CI 41229901129](https://github.com/ZY-WANG-0304/dev-session-canvas/actions/runs/41229901129) 均为 277/277 成功；API 观察到的运行跨度分别约 26.70、29.18 分钟。后一轮累计 job 时间 320.65 分钟，其中 source-host 157.98、packaged-host 114.53 分钟，合计约 85%。累计 job 时间不是计费值，也不是实施后必然节省的墙钟时间。数据见 [证据说明](../references/ci-validation-scope/README.md)。

## 推荐规则：每次新执行的轻量门禁

保留一个稳定必需检查 `Verify release contract`。即使没有业务矩阵，也必须在最新 head 执行它，不能用 workflow 顶层 `paths-ignore`、`[skip ci]` 或手工绿色状态替代。

建议普通文档路径最终只分配 2～3 个 Linux 控制 jobs，具体合并数量以实施测量为准：

1. 解析最新 base/head/预合并输入，确认无冲突，按完整 PR 差异生成任务计划和排除理由；核验本次增量与候选旧结果的对应关系。
2. 检查变更文档的仓库链接、设计 frontmatter/索引/计划归档一致性；命中被测试读取的文档时，执行相应合同测试。需要复用时验证原 Actions 来源、摘要及等价输入。
3. 最终稳定门禁核对当前 head 的全部必需项，输出哪些新执行、哪些复用、哪些不适用及各自原因。前序失败/取消或证据缺失不能被 skipped 掩盖。

文档检查默认不启动 VS Code、Playwright，不下载原生六平台资产，也不为这些工具安装整套 workspace 依赖。文档合同测试若有依赖，可独立安装其所需范围；未完成依赖拆分前，不能通过省掉合同测试来追求数量目标。

## 推荐任务矩阵与运行平台

以下为目标规则。第一期仅启用普通文档轻量路径与合格的文档追加复用；其余更细分的裁剪依赖显式输入/消费者映射，在映射验收前保留现有范围。

| 变更类别 | 必须新执行或具有有效等价证据的业务任务 | 可不分配的任务 / runner |
| --- | --- | --- |
| 普通内部文档，未参与打包或测试输入 | 上述轻量门禁与文档检查 | regression 全分片、前端构建、浏览器/视觉、Host、打包、native 和安装矩阵均不适用 |
| 已成功验收的普通 PR，随后只追加合格文档 | 轻量门禁、文档检查、原验收的来源与等价性验证 | 满足下节全部条件时，原完整业务任务可复用，无需再次启动；缺少证明则回到该 PR 原范围 |
| 测试直接读取的说明文档 | 文档检查、所有对应的合同/一致性测试及其依赖 | 不受影响的浏览器、Host 与跨平台任务；未登记完整消费者前不得一概省略 |
| 包内 README / CHANGELOG / 图标 / 本地化 / 清单 | 静态物料与版本检查、实际打包、包文件清单与相应安装/展示验证 | 只有已证明运行逻辑及其输入不变时，才可省略不相关源码 Host；此分级在第一期不启用 |
| Webview / UI 代码 | 类型/单测、前端构建、浏览器功能/视觉，以及受影响的消息/宿主交互与包验证 | 纯 UI 且明确未影响 native/平台契约时，可省略不相关原生平台任务；未证明则维持当前范围 |
| 宿主、Runtime、IPC、持久化、共享协议 | 类型/回归、对应源码与打包 Host 场景、生命周期/恢复/退出验证；影响平台行为时增加对应安装与 native 任务 | 仅可省略依赖图证明不受影响的任务，不能按目录名直接裁掉跨域消费者 |
| Native、平台启动、原生依赖与打包链 | 六平台 native 构建/加载，相关源码/打包 Host 与三平台原样安装；发布模式还要求 native-operation | 无证据不能减少支持平台；不因平时主要使用 Linux 而取消 macOS/Windows |
| workflow、分类策略、verifier、测试目录、锁文件、未知路径、广泛共享基础设施 | 当前全范围及门禁反例；更细分范围须另有依赖证据 | 第一阶段不省略。改变选测器的 PR 不能用自己新增的豁免规则给自己减项 |
| release-pr / 最终 build-release-batch | 完整正式验收与精确产品 SHA 上的同批双包证明 | 第一阶段不使用普通 PR 文档复用例外，不缩减发布完整任务图 |

Linux 为轻量检查、浏览器和大部分 Host 的默认平台；native 当前为 Linux x64/arm64、macOS x64/arm64、Windows x64/arm64 六组合；installed-pair 当前为三种 OS 的 x64。平台集合来自 `catalog.mjs::nativeTargets/installedTargets`，不以“六个 runner 等于六个测试”理解。任务必须先明确适用性，再由 `planJobs` 分配机器。

## 文档追加时如何复用旧验证

第一期仅支持同一仓库、同一 PR、同一 base 的普通 `pr` 模式，在完整成功的原运行上直接建立复用证明，不递归引用另一份复用记录，也不拼接多个失败或部分成功的 run。正式发布批次仍使用原有独立精确验收。

必须同时满足：

- 原运行 head 是当前 head 的祖先；原预合并输入有真实 `[base, oldHead]` 双亲，当前输入有真实 `[base, newHead]` 双亲；base SHA 相同。第一期 base 任何变化都使复用失效，重新计算完整 PR 范围。
- 两个预合并 tree 除已审计的普通文档路径外完全相同；比较包括路径、Git object ID、文件模式、类型和符号链接，处理新增、删除、重命名两端。新目录/未知路径默认是有效输入，不能被宽泛 `docs/**` 排除。
- 测试、workflow、门禁规则、依赖/锁文件、配置、测试数据、构建资产和受测试消费的文档均进入有效输入摘要。第一期这些内容任何变化均不复用。新 head 的分类器改动不得自行扩大排除集合；分类依据来自受信任目标分支上的已验证策略。
- policy/catalog/environment/budget 摘要一致，原完整 task 集合和 required 集合仍满足当前规则。runner 平台、工具/依赖版本或外部输入策略变化均使对应证明失效。原运行实际镜像版本必须随证据记录；相同 runner 标签不代表镜像相同。复用接受的是原环境下的有效验证，不声称已在新镜像实跑；已知环境升级、证据撤销或需要验证新环境时强制执行。设置短期复用有效期（初始建议最多 24 小时，不延长原 artifact 寿命），不把历史绿色长期当作当前可用性保证。
- 从 GitHub 实际取得原成功 run/attempt、完整验收 producer、artifact ID/digest、回执及状态；必须有原成功验收。没有上一轮、上一轮失败/取消/尚未完成、证据过期/删除/篡改、找不到合格原输入时都重新执行。原运行后来被重新运行且状态不满足时，不能按工作流名称猜测旧绿灯。
- 新 head 的轻量检查和文档合同全部通过，并产生新的合并验证记录，明确 `executed`、`reused`、`not-applicable`。每个 required task 要有当次成功或独立核验的复用来源；不适用的任务应有规则依据，不能将 `skipped` 视为 `passed`。

候选证明应记录 current/base/previous input SHA、run ID/attempt、effective-input digest、排除的文档路径、policy/catalog/environment/budget digest、原完整验收 artifact ID/hash/producer 和新文档检查结果。`check-acceptance.mjs` 当前强制同 input/run，无法直接接受上述模型；应新增独立的合并复用证明类型和校验路径，保留原执行回执不变，不能简单删除原 SHA/producer 断言。

原生构建会把 `git rev-parse HEAD` 写入来源 summary，`package-vsix.mjs::resolveVsceDocRef` 还使用当前 HEAD 改写 README 链接。**有效源码相同不代表不同 SHA 构建出的 VSIX 字节相同。** 普通合并的复用结论只表示“原功能验证覆盖未改变的功能输入”，不生成或声称已测试新 SHA 的发布包，不改写旧包的源码身份。SHA 敏感行为及包内链接必须有独立审计/校验；若变更触及这些输入或不能证明差异仅为已声明来源身份，回退当前完整验证。后续正式发布仍从显式产品 SHA 完整构建验收。

## 普通文档白名单的实际边界

当前 `classificationRules.documentation` 直接豁免整个 `docs/references/` 等目录，对轻量化目标还不够精确。研究已确认以下输入不能直接排除：

- `docs/references/release-gate-flow-audit/smoke-redesign/coverage-map.json` 被 `scripts/gates/smoke-implementation.mjs` 直接读取，属于门禁目录输入。
- `docs/UI.md` 和 `docs/design-docs/canvas-multi-root-workspace-support.md` 被 `test-theme-color-tokens.mjs` 读取。
- 模板功能的产品规格、设计、active ExecPlan 及市场设计被 `test-canvas-templates.mjs` 直接读取；不能因为文件位于计划目录就省去这部分断言。
- `docs/release-contracts/` 参与发布范围判定；发布手册、支持文档及发布就绪设计还被 `release-preflight.mjs` 检查存在性。包内 README、CHANGELOG 和资源必须保留发布/打包语义。

因此初始白名单采用“已审计的普通文本路径 + 显式排除消费者输入”，不是所有 Markdown。研究识别出的消费者列表不是完整证明，实施阶段必须补齐路径扫描与相应负例；无法分类的文件继续保守执行。

## PR #350 的预期分支变化

    main B = aa18ec56
      └─ PR H1 = 000757e9：代码/workflow 变化 → 完整任务图 → 成功 run R1
          └─ PR H2 = 66676236：仅文档收口
              ├─ 重新核验 B + H2、文档、R1 来源及输入等价
              ├─ 证明成立 → 新 H2 的稳定门禁通过，业务任务引用 R1
              └─ B 已变化 / R1 不成功 / 有效输入不同 / 证明不全 → 重跑所需任务

这不是只看 H1..H2 决定验证范围。完整 PR 的必需任务仍由 B..H2 决定；H1..H2 和两次预合并 tree 仅用于证明这些必需任务能否由 R1 覆盖。本例本地分类证明文档增量符合当前普通文档类，尚未实现新的等价与来源判定，不能事后把 R2 标为可以省略的已验证结果。

合并后 main push 的去重是另一个阶段：merge commit SHA 变化，且现有源信息含 SHA，不能自动复用 PR 包或取消 main 检查。第一期保留现行 main 验证，后续再设计基于真实 merge tree 与成功 PR 输入的专门证明。

## 候选方案与实施顺序

仅改 `paths-ignore` 或只检查最后一个 commit，无法保留新 head 的完整必需证据；不采用。只缓存 npm/构建目录可降低准备成本，但仍然会启动大部分 jobs，也不能证明测试通过；可作为辅助，不解决本例。仅创建独立文档 PR 可以避免混合 PR 的第二次全量，但会增加拆分与审批工作，也没有解决基础层过重。

推荐两步实施：先增加轻量文档计划、新 head 的原验收复用证明和稳定门禁汇总，保持其他现有范围；这一步直接覆盖本次场景。再依据代码/测试/构建依赖建立可审计的模块映射，逐步减少 UI、Host、市场和发布工具之间无关的验证；每个新豁免都必须有包含正反例的测试。

发布工具代码是否能只运行 release 合同测试，需要额外证明它没有改变统一验收、来源校验或产物链。PR #350 实际改了共享 verifier 与 reusable CI，本身第一次执行全量有充分依据，不把它作为“发布工具都只需单测”的例子。

## 后续实现验收标准

1. 独立普通文档 PR 不创建浏览器、Host、native 或打包业务 runner，当前 head 的文档与稳定门禁实际运行；文档合同输入变化仍执行对应断言。
2. 同 base 的已成功代码 PR 追加本例四份文档，只运行轻量检查和来源证明；结果明确引用原 run，不冒称任务在新 SHA 上执行。
3. 首次 PR、前次失败/取消/缺回执、base 更新、源代码/依赖/测试/预算/分类器变化、artifact 篡改/过期、错误 PR 或 producer、未登记路径及重命名为文档等情况都不能借旧绿灯通过。
4. 文档删除造成链接/索引/合同错误时，新 head 必须失败；新的必需任务不能被旧目录覆盖。
5. release-pr 与最终批次仍完整运行，无法把普通 PR 的复用记录封成 release-tag acceptance 或换写原 VSIX 身份。
6. 对照观察至少一个真实普通文档 PR 和一次真实“完整通过后仅补文档”更新，分别记录 job 分配数、运行跨度、回执以及 GitHub 必需检查；未实跑前不承诺具体分钟数收益。

本轮现状验证与设计已完成，CI 行为没有改变。实施缺口和消费者审计要求已登记到技术债跟踪器。
