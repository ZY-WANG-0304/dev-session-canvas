---
title: 标题栏删除期间的终端鼠标输入诊断
decision_status: 已选定
validation_status: 验证中
domains: [execution]
architecture_layers: [webview, extension-host]
related_specs: []
related_plans: [docs/exec-plans/active/terminal-mouse-input-diagnostics.md]
updated_at: 2026-10-11
---
# 标题栏删除期间的终端鼠标输入诊断

## 背景与问题

用户报告鼠标在标题栏删除 Agent 时出现 Runtime session was not found。2026-10-11T03-50-28-140Z dump 中七条可见错误来自 SGR 鼠标移动写入，不能证明原始DOM事件来源或删除时输入排队位置。根因待确认，不以静默错误处理作为修复。

## 正式方案

`webview/executionMouseDiagnostics.ts` 观察 xterm 实际调用的 getMouseReportCoords，记录事件时间、可信性、按钮、目标标签/class摘要、真实屏幕坐标、终端screen矩形、缩放后坐标、转换结果与模式。`executionSessionNodes.tsx` 在Agent和Terminal接入观察，不改返回值；onData仅记录完整匹配SGR鼠标序列的输入，沿用input sequence关联Host。事件关联只在当前任务内有效，微任务清除；标注同任务关联而非声称完整因果证明。

新增专用 `webview/executionMouseDiagnostic` 消息由 `common/protocol.ts` 校验，再由 `CanvasPanelManager.ts` 记录surface/current/lifecycle。Host记录鼠标输入派发、client writeInput派发与runtime删除入口/完成边界。开关为webview localStorage的devSessionCanvas.mouseDiagnostics=1；每实例最多512条，错误处理不变；普通键盘、DOM文本和HTML不采集。具体复现、关闭开关和分析步骤见关联计划。

## 验证与限制

脚本验证开关、容量、关联过期、隐私与释放。类型检查、消息回归和浏览器对照补充验证。原用户Host场景须重新启动调试产物并导出新dump；在此之前不把延迟送达、DOM命中错误或合成事件中的任何一个写成根因。
