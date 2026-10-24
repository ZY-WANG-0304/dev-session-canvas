---
title: 文件条目 smoke 原生鼠标输入
decision_status: 已选定
validation_status: 已验证
domains: [VSCode 集成域]
architecture_layers: [宿主集成层, 适配与基础设施层]
related_specs: []
related_plans: [docs/exec-plans/completed/file-entry-native-smoke.md]
updated_at: 2026-10-24
---

# 文件条目 smoke 原生鼠标输入

## 背景与证据边界

PR335 run 39977098326 的文件活动 Panel 点击准备超时。最后目标可见可命中，但 documentFocus=false；178 次快速 probe 不支持分析扫描耗尽时间的猜测。相同产品构建本地两次原流程通过；受控编辑器夺焦稳定复现旧 helper 超时，同控制下原生点击及后续断言通过。历史自然夺焦原因仍未证实。此处是普通文件条目左键点击，不是终端链接 Cmd/Ctrl+点击。

## 正式方案

`tests/vscode-smoke/extension-tests.cjs` 保留 clickFileEntry 原期限、surface/节点准备及 100ms 稳定矩形检查，移除先获得文档焦点的输入门槛；由 `native-file-click.cjs` 使用浏览器原生左键点击，以 Playwright 的可见、稳定、启用和跨 iframe 命中检查补充产品 probe。按既有 Webview 身份的 surface/active、节点 ID、文件路径定位唯一可见目标，不允许 force、DOM 合成事件或失败后重复业务点击。连接在创建 Webview 前建立，与扩展激活共用原 20 秒启动预算；原单次点击的 10 秒期限仍覆盖准备、定位、输入和验证，超时断开连接并禁止迟到输入。

`scripts/smoke/vscode-smoke-runner.mjs` 仅为 execution-file-activity/views 开启 loopback 随机 CDP 端口，从独立 profile 的 DevToolsActivePort 读取实际端点。测试加载 runner 已安装的 Playwright 入口；source/packaged 共用接线，不向 VSIX 添加运行时依赖。连接在该场景内复用，场景结束或点击超时后断开，不关闭被测 VSCode。

首次 Panel 点击增加编辑器持焦回归，证明点击前无 Webview 焦点及输入事件 isTrusted=true。原文件打开、焦点契约及后续用例全部保留；不改变 Panel 产品焦点策略、预算和门禁覆盖。

## 候选与取舍

延长超时不能解决一直不满足的焦点前提；去掉焦点要求后继续合成事件不能代表真实输入。改产品焦点策略会扩大范围且缺产品缺陷证据。CDP 只用于测试，复用已有开发依赖和隔离 profile，避免新增服务桥或端口抢占窗口。实现时发现 VSCode 已存在的跨进程 frame 在晚连接后会缺内层内容 frame；在原 10 秒内仅轮询无法恢复，故连接前移到首次 Webview 创建之前，计入既有激活预算。

## 验证

修复后 source 与原双 VSIX packaged 的 execution-file-activity/views 均通过，每个场景的四次点击均为可信左键事件，首次 Panel 点击前 documentFocus=false。实际浏览器负例涵盖遮挡、禁用、重复目标、过期及取消；完整门禁合同 122/122（Node 25.6.0）、Node 22.23.3 定向合同 3/3 通过。134 项预算与任务集合不变。

本地工作副本以 40d78cdc 为测试源码基线，产品来自原 CI 的 9aca2af7 构建；packaged 诊断保留原 plan/receipt 验包，但因测试适配器已变，临时入口不执行旧 frozen-plan 与当前源码一致的声明，允许本地缓存 VSCode 路径；正常 runner 的正式校验不变。此为局部诊断，不能签发完整 CI acceptance。证据目录 `/tmp/dsc-native-fix-dperbt73`；完整 CI 仍需更新后的实际 Actions 结果。

证据摘要与输入、日志 SHA256：[`results.json`](../references/file-entry-native-smoke/results.json)。
