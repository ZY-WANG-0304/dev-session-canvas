---
title: fake systemd 重开门禁后端不匹配根因调查
decision_status: 已选定
validation_status: 验证中
domains: [VSCode 集成域, 执行编排域]
architecture_layers: [宿主集成层, 适配与基础设施层]
related_specs: [docs/product-specs/runtime-persistence-modes.md]
related_plans: [docs/exec-plans/completed/systemd-smoke-scope-root-cause.md, docs/exec-plans/active/release-gate-consolidated-repair.md]
updated_at: 2026-10-13
---

# fake systemd 重开门禁后端不匹配根因调查

## 问题与范围

组合PR330固定08f7b0a5的Release Preflight run38387068827/job115263574447，在systemd-user-real-reopen setup断言agent runtime backend失败：实际legacy-detached，预期systemd-user。完整门禁失败，后续fallback/SSH/Webview/VSIX未触达。PR329的links/checkpoint两处修复已通过，不能将后续失败视为旧根因仍未解决。

## 已确认根因

根因是旧fake systemd夹具与新增root准备前置条件失配。runSystemdUserRealWindowReopenScenario只替代systemctl提交，但e72d7859加入inspectRuntimeSystemdEnvironment的真实/usr/bin/systemd-run环境探测，夹具没有控制或满足其前提。原场景DBUS_SESSION_BUS_ADDRESS=disabled:、私有XDG_RUNTIME_DIR；同输入干净诊断明确返回unavailable/user-bus-unavailable，生产按契约回退legacy，测试固定systemd-user断言因此失败。

override已进入preferredBackends（systemd-user/legacy-detached），选择前发现absent，排除override失效及存量owner复用。实际probe是code1/Connection refused，无超时或信号，无摘要回执；不是摘要不匹配或正式systemctl提交失败。产品明确不可用后的fallback符合当前契约，这一根因不归为VSCode缺陷。

原run38387068827没有probe结果trace，后续重现不冒充补回历史观测。根因与因果对照已验证；用户随后授权继续修复并集中到PR329，正式修复及完整组合门禁仍在验证中。

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

84项原scope函数受控用例（默认及shim各40项，另4项依赖选择/非法路径）、12项实际launcher/摘要不匹配/非法回执/退出或信号失败/超时及子进程收口/场景作用域、26项原准备流程、runner env、typecheck及指定既有六平台资产build通过。原nonce和摘要校验真实执行，超时归unknown且自有子进程消失。记录见repair-local-checks.json；完整临时组合验证尚未完成，不将本地通过写为完整发布通过。


新增scope回归在原main22803dd8源码私有副本exit1：默认真实命令用例通过后，新增shim命令断言明确拒绝仍执行/usr/bin/systemd-run的旧实现。记录见repair-baseline-regression.json。临时组合输入dc5178ee41bc1dda3d370a24923559d683eac727（修复40364a85加发布42d87b3d）/tree79bd256b，run38412908952进行中；永久修复PR不包含临时自动入口。
