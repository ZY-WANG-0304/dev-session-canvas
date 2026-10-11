# 定位标题栏删除期间的终端鼠标输入

本计划按 `docs/PLANS.md` 持续维护。目标是从原始 DOM 鼠标事件追踪到 xterm 的 `terminal.onData`，再到 Host 的输入请求和 runtime 删除边界，定位用户在标题栏删除 Agent 时出现的 sessionNotFound。此次只增加诊断，不修改输入准入或错误呈现。

## 进度

- [x] 2026-10-11：从最新 origin/main 创建 terminal-mouse-input-diagnostics 分支。
- [x] 检查原 dump，确认七次可见错误对应 SGR 无按键鼠标移动输入。
- [x] 添加坐标、onData 与 Host 派发/删除边界诊断，验证诊断开关、关联过期、隐私和容量限制。
- [x] 类型检查、消息校验回归、真实xterm标题栏边界对照及构建通过；Main Only调试目录已刷新。
- [x] 分析05-11-34-288Z用户复现：确认删除等待期间继续产生并转发新输入，推翻仅删除前排队的解释。
- [x] 修复自动开关在webview归一化时丢失的问题，增加实际归一化函数到采集器的回归测试及启动开关状态记录。
- [ ] 原始事件来源待验证：05-29-39-628Z仍无原始鼠标/onData记录；已修复采集开关传递，需要更新产物后的场景证据。

## 意外与发现

原 dump 的输入接收延迟约 167ms，只能说明 webview 发送到 Host 接收之间的时间差，不能证明鼠标移动发生在删除前，也不能证明这些请求早已进入 supervisor 队列。旧日志缺少事件目标、原始事件时间和删除请求边界。第一次七条错误中的四条对应列66、行1/2/4/5；第二次三条对应列66、行1/2/3。

xterm 的无按键移动监听绑定到 terminal.element；document 全局拖动监听要求 buttons 非零。坐标限制本身不扩大监听范围。当前根因仍未确认。

## 决策记录

使用独立 executionMouseDiagnostic 消息，而不把鼠标诊断混入 clipboard 诊断。由Host的ExtensionMode.Development自动启用（Main Only F5调试），每终端生命周期最多512条，重载重置额度；不采集键盘内容、DOM文本、HTML、元素ID。现有 Host 诊断缓存仍有界。

坐标转换和 onData 的关联标记为 same-task-coordinate-conversion，仅保留到下一个微任务；没有关联时记录 unmatched。不把最近历史事件冒充确切来源。序列号使用原 execution input sequence，使 onData 可与 Host 写入配对。

## 结果与复盘

新增诊断已实现且定向测试通过，实际用户场景的根因仍待验证。此前静默错误的补丁已撤回，不在本分支中。

## 上下文与定向

`extensions/vscode/dev-session-canvas/src/webview/executionSessionNodes.tsx` 已有 xterm getMouseReportCoords 包装用于缩放坐标。在该处接入 `executionMouseDiagnostics.ts`，观察原始事件和换算结果；Agent/Terminal 的 onData 回调记录相同 input sequence。`common/protocol.ts` 定义并校验新增消息。`panel/CanvasPanelManager.ts` 保存新消息与原 surface 生命周期，记录鼠标输入请求的派发及单节点删除边界。

## 工作计划与里程碑

第一里程碑增加有界可关闭诊断并验证不改变鼠标转换返回值、输入数据和错误处理。第二里程碑用浏览器的真实 xterm 验证正常标题栏移动不会上报，随后在 Main Only 调试 Host 重现用户场景并导出新诊断，比较 DOM target、insideScreen、isTrusted、输入sequence与删除边界。

## 具体步骤

在仓库根运行 `node scripts/test/test-execution-mouse-diagnostics.mjs`、`npm run typecheck`、`npm run test:protocol-webview-messages`、`npm run build` 和 `npm run prepare:debug-main-only-extension`。

重新启动 Main Only F5。无需控制台操作，Host自动下发诊断开关。鼠标进入终端，再移向标题栏并删除节点；立即导出 current host diagnostics。生产Host默认不启用此采集。若达到512条额度，重载Canvas重新采集。

## 验证与验收

脚本必须证明关闭时零消息、终端外坐标可识别、普通键盘输入不采集、关联过微任务失效、最多512条和释放后不再采集。Host dump 中应出现 webview/executionMouseDiagnostic，detail.phase 为 mouse-coordinates 或 terminal-onData；配对使用 node、surface生命周期和sequence/eventId，使用traceId区分终端实例，不跨实例比较eventId。Host 的 execution/mouseInputRpcDispatch 表示请求实际交给client；execution/deleteBoundary 的 runtime-delete-requested 只表示开始清理入口，runtime-delete-rpc-dispatch 表示交给client，runtime-delete-completed 表示原runtime删除承诺完成。

## 幂等性与恢复

诊断开关不影响Canvas持久化数据。测试只创建自己的浏览器和临时页面，不修改用户运行的session。分支中的image.png是原有未跟踪文件，不提交。

## 证据与备注

当前安装版本的真实 xterm 浏览器对照：开启1003/1006鼠标协议，终端内部移动产生 ESC[<35;4;2M；移动到独立标题栏并继续移动，两次输入均为空。这只验证库的正常事件边界，不代表已复现Canvas场景。持久测试为 `node scripts/test/test-xterm-title-mouse-boundary.cjs`（需要已安装Playwright Chromium）。


    node scripts/test/test-execution-mouse-diagnostics.mjs
    Mouse diagnostics: opt-in, outside-screen coordinates, correlation expiry, privacy and 512-record limit passed.

## 接口与依赖

复用当前 xterm、输入sequence、webview消息校验和Host诊断缓存，不新增运行依赖。不改第三方库。诊断异常不得改变输入行为。

修订记录：2026-10-11 创建计划，记录尚待真实场景验证的根因与已实现诊断范围。

## 2026-10-11 第二次用户复现证据

输入文件为 `/home/users/ziyang01.wang-al/projects/dsc-test-01/.debug/current-host-diagnostics/2026-10-11T05-11-34-288Z`。目标session为d594f190-b5df-4f37-8fa0-ed36a77401d3。Host开始删除05:11:20.752，派发删除RPC05:11:20.756，完成删除并移除Host session均为05:11:25.986，总窗口约5.23秒。25次SGR鼠标写入失败；sequence34的webview发送时间为05:11:20.992，sequence46为05:11:22.982，sequence58为05:11:23.181。均晚于删除派发，且Host写入派发时current=true、stopRequested=false。因此并非仅删除前排队的残留请求，而是删除等待期间继续产生、接收、转发新输入。

代码路径 `terminateExecutionNodeForDeletion` 等待 `deleteRuntimeSupervisorSessionStrict` 后才调用 `disposeExecutionSession`，后者才设置stopRequested并移除session；`writeExecutionInput` 仍能查到该session并发送writeInput。Supervisor的requireSession在目标已移除或retiring时返回sessionNotFound；本dump不能区分返回时这两种状态，也不能精确解释5秒等待发生在哪个最终收口环节。

本dump中webview/executionMouseDiagnostic为0。用户确认未执行开关，所以不存在原始DOM事件和onData关联证据；不能判断标题栏事件是否进入xterm。下一次加载更新后的开发Host，由Host自动启用并采集，再按traceId、eventId、sequence和surface生命周期分析。此前将错误称为已确认的删除前排队竞态是过度推断，已撤回相关结论且未实施错误屏蔽。

修订记录：2026-10-11登记新dump时序，分开记录已确认Host删除窗口与尚未确认鼠标事件来源。

修订记录：2026-10-11取消手动localStorage开关，Main Only开发Host自动启用，保持512条限制。此前dump缺失原始事件的记录保留为历史事实，下一次无需用户执行控制台命令。

## 2026-10-11 第三次用户复现与诊断链路修复

`2026-10-11T05-29-39-628Z`的Host模式为development，但原始鼠标诊断仍为0。发现自动启用实现遗漏了webview的`normalizeRuntimeContext`字段拷贝：Host下发的true被丢弃，采集器始终关闭。此缺失由实现导致，与用户操作无关。现已补齐归一化与React初始runtime字段，回归测试调用实际归一化函数并连接采集器，验证true产生坐标/onData记录，缺省、false及非布尔值不开启。Host消息摘要和webview bootstrap诊断分别记录下发值与实际归一化后的启用值。

本dump中session d8611d57-82ee-4625-94a6-c43a0e08b967于05:29:05.597派发删除，05:29:06.541完成，期间仍有鼠标写入失败；session 39cf3618-a79b-4605-acc7-5bf1f2e09392于05:29:14.835派发删除，05:29:19.903完成，亦有失败输入。该证据支持既有删除窗口结论，仍不能判定原始DOM事件来源。修复后的定向测试、类型检查、构建及Main Only调试产物准备通过；下一次复现仍只需正常重启F5，不需要控制台设置。
