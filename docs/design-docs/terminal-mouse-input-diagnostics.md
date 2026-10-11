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

新增专用 `webview/executionMouseDiagnostic` 消息由 `common/protocol.ts` 校验，再由 `CanvasPanelManager.ts` 记录surface/current/lifecycle。Host记录鼠标输入派发、client writeInput派发与runtime删除入口/完成边界。开关由Host runtime字段executionMouseDiagnosticsEnabled下发；ExtensionMode.Development自动开启，Production默认关闭；每实例最多512条，错误处理不变；普通键盘、DOM文本和HTML不采集。具体复现和分析步骤见关联计划。

## 验证与限制

脚本验证开关、容量、关联过期、隐私与释放。类型检查、消息回归和浏览器对照补充验证。原用户Host场景须重新启动调试产物并导出新dump；在此之前不把延迟送达、DOM命中错误或合成事件中的任何一个写成根因。

## 已确认的删除窗口与待确认来源

05-11-34-288Z复现中删除RPC派发后仍有新webview输入：删除派发05:11:20.756；sequence34/46/58发送于05:11:20.992、05:11:22.982、05:11:23.181；Host均以current=true、stopRequested=false转发。删除承诺和Host移除直到05:11:25.986完成，期间25次写入失败。因此Host删除期间的输入准入尚未关闭是确定的时序缺口，并非仅删除前排队请求。原始DOM事件来源仍待定；用户确认未执行开关，本次webview鼠标诊断为0。最终修复方案须明确删除开始时的输入准入、已派发输入收口、失败/未知删除后的状态责任，并保留真实故障呈现，不以隐藏sessionNotFound替代修复。

修订记录：2026-10-11取消手动localStorage开关，Main Only开发Host自动启用，保持512条限制。此前dump缺失原始事件的记录保留为历史事实，下一次无需用户执行控制台命令。

05-29-39-628Z仍无原始鼠标记录，原因是自动启用字段被webview的`normalizeRuntimeContext`丢弃，属于诊断实现缺陷。现已补齐归一化和初始runtime字段，并增加实际归一化函数到采集器的回归验证。Host消息摘要记录下发开关，webview bootstrap记录实际启用值，以便区分配置传递失败与没有采集事件。此次复现仍支持删除期间转发输入的时序缺口，不能据此确认DOM来源；更新后的开发Host无需用户执行控制台命令。

## 原始事件验证结果

05-34-59-965Z采集到207条鼠标诊断。两组共19次sessionNotFound写入失败，通过Host sequence和webview traceId/eventId关联，全部来自真实mousemove（isTrusted=true、buttons=0），目标均为xterm-screen且位于terminal内部。18次坐标在screen矩形内；另一次在上边缘外约0.58px，row被限制到0。没有证据表明标题栏事件被转发，或坐标限制使终端持续监听区域外移动；标题栏本身的事件未采集，不能完全还原此前用户描述的停留场景。

两组失败输入均在runtime删除RPC派发之后产生，Host以current=true、stopRequested=false发送writeInput。sequence45在05:34:20.411产生ESC[<35;61;4M，Host于20.635派发并于20.639失败，而删除到25.462才完成。此次报错链路已确认：runtime删除期间，Host仍开放输入准入并转发新鼠标输入，runtime以sessionNotFound拒绝；该错误可表示session不存在或已retiring。约224ms发送延迟意味着错误显示时鼠标位置不能用于判断原始事件位置。详细证据见关联ExecPlan；修复须处理删除入口的准入关闭、待派发写入及失败状态，不能通过静默错误替代状态协调。
