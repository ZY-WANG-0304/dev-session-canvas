---
title: fake systemd 重开门禁后端不匹配根因调查
decision_status: 已选定
validation_status: 已验证
domains: [VSCode 集成域, 执行编排域]
architecture_layers: [宿主集成层, 适配与基础设施层]
related_specs: [docs/product-specs/runtime-persistence-modes.md]
related_plans: [docs/exec-plans/completed/systemd-smoke-scope-root-cause.md, docs/exec-plans/completed/release-gate-consolidated-repair.md]
updated_at: 2026-10-14
---

# fake systemd 重开门禁后端不匹配根因调查

## 问题与范围

组合PR330固定08f7b0a5的Release Preflight run38387068827/job115263574447，在systemd-user-real-reopen setup断言agent runtime backend失败：实际legacy-detached，预期systemd-user。完整门禁失败，后续fallback/SSH/Webview/VSIX未触达。PR329的links/checkpoint两处修复已通过，不能将后续失败视为旧根因仍未解决。

## 已确认根因

根因是旧fake systemd夹具与新增root准备前置条件失配。runSystemdUserRealWindowReopenScenario只替代systemctl提交，但e72d7859加入inspectRuntimeSystemdEnvironment的真实/usr/bin/systemd-run环境探测，夹具没有控制或满足其前提。原场景DBUS_SESSION_BUS_ADDRESS=disabled:、私有XDG_RUNTIME_DIR；同输入干净诊断明确返回unavailable/user-bus-unavailable，生产按契约回退legacy，测试固定systemd-user断言因此失败。

override已进入preferredBackends（systemd-user/legacy-detached），选择前发现absent，排除override失效及存量owner复用。实际probe是code1/Connection refused，无超时或信号，无摘要回执；不是摘要不匹配或正式systemctl提交失败。产品明确不可用后的fallback符合当前契约，这一根因不归为VSCode缺陷。

原run38387068827没有probe结果trace，后续重现不冒充补回历史观测。根因与因果对照已验证；用户随后授权继续修复并集中到PR329，正式修复及完整组合门禁已在第四轮通过，详见最终结果。

## 验证方法

docs/exec-plans/completed/systemd-smoke-scope-root-cause.md覆盖源码跟踪、干净runner原场景有限trace、真实函数正反对照和证据归档。诊断固定08f7b0a5及原run同输入六平台native资产；只跑原systemd-user场景，仍保留预算与断言，注入后返回原值。结果另记，不替原完整失败或PR327最新正式发布门禁。

## 固定输入诊断结果

干净GitHub run38401537709/job115310135988以相同08f7b0a5及原run同输入native资产运行原systemd-user-real-reopen。只增加有限观测而不改变返回、选择、超时或断言，再次失败于setup相同backend mismatch。request.preferredBackends为systemd-user/legacy-detached，选择前发现absent，排除override未生效和存量owner复用。

实际probe环境的DBUS分类disabled、XDG_RUNTIME_DIR已设但bus socket不存在、systemctl shim已设。真实systemd-run callback code1、未超时/信号终止、stderr分类Connection refused、没有JSON结果；原函数返回unavailable/user-bus-unavailable，原准备流程遂选择legacy-detached。该路径早于systemctl提交和重开，不是resize或ready超时。

调查证实测试假设与新准备边界失配：旧fake-systemctl场景以提交替代成功当作systemd可用，而e72d7859新增真实scope probe后，fake提交不能覆盖该前置条件。现有40项环境probe与26项准备受控测试通过，并明确available选systemd、unavailable可fallback、unknown不提交；不能为取绿取消生产scope验证或改backend断言。

诊断摘要及source/log hash在docs/references/systemd-smoke-scope-root-cause/diagnostic-scope-38401537709.json与diagnostic-result-38401537709.json。原38387068827没有实际scope trace，不能声称此新run补回历史观测；相同输入源码链、原环境日志和受控重现共同确认机制。

## 候选修复与对照边界

候选是在测试夹具中覆盖新增probe边界：fake成功场景应控制probe在受控子进程执行原只读launcher，并保留nonce/environmentKey/userIdentityKey校验，再进入fake systemctl提交。fallback场景继续验证真实bus不可用且没有systemctl提交，unknown负例保留不提交/不fallback。另一方案是提供真正user manager并记录执行环境一致证据，但普通runner和私有HOME/runtime目录不能自动满足该前提。

单变量诊断控制run38402006541/job115311728708已成功：只将probe执行者从systemd-run换成当前launcher子进程，真实原launcher生成合法nonce/environment/user摘要并经原校验通过，scope变available，选择systemd-user；原setup和verify都exit0，Fake systemd-user real window reopen smoke passed。DBUS仍disabled、私有runtime无bus、原fake systemctl与重开断言/预算未改。结果见control-scope-38402006541.json、control-result-38402006541.json。该对照支持夹具缺scope替代的因果判断，不证明真实user manager或正式修复通过。

## 正式方案与验证边界

`runtimeSystemdEnvironment.ts`增加显式测试依赖 `DEV_SESSION_CANVAS_TEST_SYSTEMD_RUN_SHIM`，仅在fake成功重开场景设置，按既有systemctl夹具约定使用 `DEV_SESSION_CANVAS_TEST_NODE_PATH` 或当前进程执行Node脚本。shim必须是绝对路径且无NUL，否则返回unknown，不提交或fallback。默认仍调用绝对 `/usr/bin/systemd-run`，原参数、15秒预算、16KiB上限、locale以及nonce/schema/environment/user响应校验保持不变。

`tests/vscode-smoke/fixtures/fake-systemd/systemd-run.cjs`接受原完整参数，仅转发其中受限的原只读launcher probe到子进程，不自行生成摘要或return available；设置原Electron Node模式变量，继承受控执行环境，转发退出状态和终止信号；内部12秒watchdog收口自有子进程，位于原15秒外层预算内。`runSystemdUserRealWindowReopenScenario`显式提供此依赖，backend/guarantee、原进程身份、setup/verify和重开断言不变。fallback场景显式清空该依赖，继续用真实bus不可用probe并断言零systemctl提交；unknown仍不得提交或fallback。

本次修复、先前两个修复、原因果证据、回归和WORKFLOW约定集中于PR329；PR331内容保留后关闭，PR327继续独立。临时组合分支重用PR327发布提交，按不可变输入重建六平台原生资产并运行原完整release:preflight/release:verify，不新建验证PR。fake通过不代表真实user manager执行环境已验证；临时组合通过也不替代修复合入后PR327最新预合并正式门禁。

两个诊断workflow版本已归档original-diagnostic.workflow.yml及causal-control.workflow.yml，自动入口调查结束移除。现有40项scope和26项准备受控回归、instrumented TypeScript语法、Node语法及actionlint1.7.12通过。完整历史失败、原trace-only失败与单变量控制通过分别保留，不能互相替代。


## 正式修复本地结果

84项原scope函数受控用例（默认及shim各40项，另4项依赖选择/非法路径）、12项实际launcher/摘要不匹配/非法回执/退出或信号失败/超时及子进程收口/场景作用域、26项原准备流程、runner env、typecheck及指定既有六平台资产build通过。原nonce和摘要校验真实执行，超时归unknown且自有子进程消失。记录见repair-local-checks.json；本地结果不替代完整门禁；第四轮完整结果见下文。


新增scope回归在原main22803dd8源码私有副本exit1：默认真实命令用例通过后，新增shim命令断言明确拒绝仍执行/usr/bin/systemd-run的旧实现。记录见repair-baseline-regression.json。临时组合输入dc5178ee41bc1dda3d370a24923559d683eac727（修复40364a85加发布42d87b3d）/tree79bd256b，run38412908952失败于后续fallback短路径夹具，原fake已通过；永久修复PR不包含临时自动入口。


## 完整门禁发现的 fallback 路径夹具缺陷与补齐

首轮正式组合run38412908952的fake systemd原setup/verify均exit0，14:45:33Z原成功记录确认probe依赖修复越过原阻塞。后续fallback在VSCode main启动前失败：清空XDG_RUNTIME_DIR使VSCode的mainIPCHandle退回userDataPath/version-main.sock；CI仓库路径下socket共129字节，日志警告超过107并listen EINVAL，进程exit1。不是scope分类、root准备、resize或Webview ready失败。固定VSCode1.141.0的mainImpl.js中mainIPCHandle调用KE，KE在无XDG_RUNTIME_DIR时取userDataPath，直接证实路径选择机制。原失败和未触达项目见full-gate-first-result-38412908952.json。

正式夹具补齐：runSystemdFallbackRealWindowReopenScenario单独设置userDataInRuntimeDir；vscode-smoke-runner.mjs的prepareRuntime将其user-data放到既有短临时runtimeDir中（约83字节socket），先清理runtimeDir再创建user-data/settings，其他目录和默认布局保持。真实DBUS_SESSION_BUS_ADDRESS/XDG_RUNTIME_DIR仍为空、probe依赖仍清空、后端legacy和零systemctl提交断言不变。回归在长debugRoot核对短user-data、settings不被后续清理丢失、空bus变量及实际Unix socket可监听；该测试不替代原VSCode完整场景。

临时workflow修正失败时exit标记收集：显式关闭bash errexit，保留pipefail并立即保存PIPESTATUS[0]，最后按原非零退出。原run marker null保留，以Actions job/log的实际exit1解释，不补造历史marker。


第二轮run38414258709也通过fake systemd原两阶段，14:52:49Z复现相同fallback IPC路径警告/EINVAL，证据full-gate-second-result-38414258709.json；新长路径回归对原main源函数exit1，见fallback-path-baseline-regression.json。第三轮44282298/run38417836576包含全部probe/路径修复，systemd/fallback/no-submit及SSH退出/保留通过，Webview425/426，首败为基线截图4319像素差异，clean-checkout未触达；源码hash与workflow见repair-combined-input.json和full-combined-gate.workflow.yml。


## 截图字体依赖定位及正式夹具方案

同一44282298输入，干净CI的原截图断言在38423640011和38424281988稳定复现4319像素差异，本地原断言通过。实际diff集中于中文文字，节点几何、边框和英文保持；CI Ubuntu24.04仅WenQuanYi/Unifont中文字体，无Noto CJK。本地基线环境使用Noto Sans CJK（fonts-noto-cjk 20220127）。38424638753只补装CI的fonts-noto-cjk，差异降为24像素，仍失败；不能将此对照写成通过或直接放宽容差。

正式夹具选择在Linux基线截图用例加载随仓库固定的Noto Sans CJK简体中文Regular字符子集，保留SIL OFL许可、原文件hash和生成方式。仅声明该场景实际中文字符的unicode-range，英文仍使用原Segoe UI/sans-serif；只在该截图用例注入且明确等待Regular字体加载。其他截图/交互、生产CSS和字体注入均不改变。相比依赖ubuntu-latest系统字体或放宽容差，固定原基线字体可维持截图断言意义；子集避免引入完整约19MiB字体。原PNG、timeout5000及像素容差不改，必须先验证本地原基线和干净CI。若对照未通过，继续定位，不追认修复成功。

本地固定Regular/Bold曾产生186像素差异，集中于600字重中文；只保留原Regular及浏览器合成字重后，原PNG严格断言通过。该结果限定本地，干净CI继续验证，不将实际Bold字体误当作基线600字重的回退行为。

固定字体CI38425793707仍24像素失败；同源码输入71b6bbcd、同Chromium147.0.7727.15/1217、只将runner换为Ubuntu22.04的38426201759，原严格截图通过。确认既有PNG的基线环境依赖Ubuntu22.04及Noto Regular回退，ubuntu-latest24.04并非等价渲染环境；未断言FreeType或某个系统库是24像素差异的具体实现原因。正式将release-preflight的verify-release-contract和publish-marketplace-release的prepare固定ubuntu-22.04，与固定字符字体共同保障前置验证及tag验证同环境。六平台native构建及其他jobs不改。升级视觉基线OS应作为显式迁移复核，不能隐式跟随latest。

第四轮完整组合32ec277b（修复605ec4ac及发布42d87b3d）/run38426726365重建同输入六平台native资产，原unfiltered release:preflight/release:verify已通过。源文件hash、先前三轮及最终结果见repair-combined-input.json与下文。


## 最终完整组合结果（2026-10-14，北京时间）

第四轮run38426726365/job115401326337已成功，输入32ec277b/tree8a68e171，修复605ec4ac加发布42d87b3d。六平台资产均由同输入重建；静态preflight与原unfiltered release:verify exit0。源码smoke、fake systemd两阶段、真实不可用fallback及零提交、SSH退出和保留全部通过；Webview426/426保留原PNG严格断言；隔离clean-checkout npm ci、5.72MB生产VSIX及原八个packaged-payload smoke场景通过，日志明确“发布完整验证通过：v0.26.1”。最终回执/log hash见full-gate-fourth-result-38426726365.json，原三轮失败和所有单变量对照仍分别保留。临时自动workflow已在验证结束移除，未创建新PR。

此次已验证状态只覆盖正式夹具和该固定组合输入，不扩展为真实user manager或三平台桌面集成测试；native六平台构建与Linux完整集成分别陈述。当前修复PR与组合输入的scripts/tests/workflows逐字节一致，后续仅证据/文档变化。修复尚未合入，PR327保留draft和原head；其最新预合并正式门禁须在修复合入、rebase之后运行，本次不合并、打tag或发布。
