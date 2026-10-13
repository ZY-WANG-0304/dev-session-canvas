---
title: fake systemd 重开门禁后端不匹配根因调查
decision_status: 比较中
validation_status: 已验证
domains: [VSCode 集成域, 执行编排域]
architecture_layers: [宿主集成层, 适配与基础设施层]
related_specs: [docs/product-specs/runtime-persistence-modes.md]
related_plans: [docs/exec-plans/completed/systemd-smoke-scope-root-cause.md]
updated_at: 2026-10-13
---

# fake systemd 重开门禁后端不匹配根因调查

## 问题与范围

组合PR330固定08f7b0a5的Release Preflight run38387068827/job115263574447，在systemd-user-real-reopen setup断言agent runtime backend失败：实际legacy-detached，预期systemd-user。完整门禁失败，后续fallback/SSH/Webview/VSIX未触达。PR329的links/checkpoint两处修复已通过，不能将后续失败视为旧根因仍未解决。

## 当前结论

根因是旧fake systemd夹具与新增root准备前置条件失配。runSystemdUserRealWindowReopenScenario只替代systemctl提交，但e72d7859加入inspectRuntimeSystemdEnvironment的真实/usr/bin/systemd-run环境探测，夹具没有控制或满足其前提。原场景DBUS_SESSION_BUS_ADDRESS=disabled:、私有XDG_RUNTIME_DIR；同输入干净诊断明确返回unavailable/user-bus-unavailable，生产按契约回退legacy，测试固定systemd-user断言因此失败。

override已进入preferredBackends（systemd-user/legacy-detached），选择前发现absent，排除override失效及存量owner复用。实际probe是code1/Connection refused，无超时或信号，无摘要回执；不是摘要不匹配或正式systemctl提交失败。产品明确不可用后的fallback符合当前契约，这一根因不归为VSCode缺陷。

本轮诊断确认机制；原run38387068827没有probe结果trace，后续重现不冒充补回历史观测。用户本轮只要求定位，正式修复方案尚未选择，decision_status保持比较中；“已验证”指根因与因果对照，不是完整发布验证通过。

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

## 修复边界与剩余状态

后续正式修复应让fake成功场景的测试执行依赖覆盖scope probe，受控子进程仍执行原只读launcher并验证响应身份；生产默认继续调用真实绝对systemd-run。不能简单return available、删除probe、改期望legacy或延长等待。真实bus不可用fallback及unknown不提交的负例继续独立覆盖，fake与真实systemd验证须分别说明。正式方案未实施，PR329保持两处先前修复范围，PR327完整门禁仍失败且SSH/后续Webview/VSIX未触达。

两个诊断workflow版本已归档original-diagnostic.workflow.yml及causal-control.workflow.yml，自动入口调查结束移除。现有40项scope和26项准备受控回归、instrumented TypeScript语法、Node语法及actionlint1.7.12通过。完整历史失败、原trace-only失败与单变量控制通过分别保留，不能互相替代。
