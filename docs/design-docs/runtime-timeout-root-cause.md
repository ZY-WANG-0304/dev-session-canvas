---
title: 旧升级 resize 与 fallback 页面就绪超时定位
decision_status: 已选定
validation_status: 已验证
domains: [执行编排域, VSCode 集成域]
architecture_layers: [宿主集成层, 画布呈现层, 适配与基础设施层]
related_specs: [docs/product-specs/runtime-persistence-modes.md]
related_plans: [docs/exec-plans/completed/runtime-timeout-root-cause.md]
updated_at: 2026-10-12
---

# 旧升级 resize 与 fallback 页面就绪超时定位

## 问题与范围

PR #321 合入主线 `a213b89b8c1dcaaec291e896042acc8627a05668` 后，完整 npm test 的旧升级 Agent resize 超时、fallback 首次 editor ready 超时仍未定位。本轮以因果调查为交付范围，保留产品源码、原20秒等待和原尺寸/内容/身份断言，不发布版本、不将局部通过拼接成完整门禁。

## 正式方案

### resize：固定瞬时页面尺寸的测试前提存在缺口

`tests/vscode-smoke/legacy-supervisor-upgrade-tests.cjs` 首先通过正文 marker 获取修改前的页面 probe；这个判据不要求首次快照恢复与容器 fit 已完成。随后更新 Agent/Terminal 卡片尺寸，等待两终端 cols/rows 不同于修改前，立即把一次 probe 的值固定下来。最后分别等原 Supervisor session 与固定值一致。

`extensions/vscode/dev-session-canvas/src/webview/main.tsx:restoreExecutionTerminalSnapshot` 为保持恢复语义，先将 xterm resize 到源快照尺寸，再完成真实 parser write。`executionSessionNodes.tsx` 在恢复屏障释放后按当前容器 fit，150ms settle 后报告尺寸。probe 直接读取 xterm 当前 cols/rows；它没有表示“此尺寸已稳定、已报告并且对应最新卡片”。所以正常的首次 fit、旧快照恢复、卡片重新 fit 均能满足“不同于修改前”，而满足条件的瞬态值可能从未作为最终 resize 目标发送。

本轮三次无业务改动的原生定向基线均完整通过，并实际观察到页面先 fit `67×21`、旧快照恢复 `92×28`、卡片 fit `82×27` 的交错。Host 对最终 `82×27` 的请求发送和完成有完整时间线，Supervisor 也正确应用。没有观察到本轮最终 resize 被 Host 漏发或 Supervisor 丢弃。

在原 Linux 原生场景的受控时序对照 C8 中，仅延迟 Agent 初始/卡片 fit 各400ms、Host 测试派发前500ms及第一次 session 观察700ms（仍计入原20秒截止），未改消息尺寸、产品底层 resize、原 probe 判据或一致性断言。修改前 probe 为 `92×28`，原谓词随后把 `67×21` 固定为期望；真正卡片 fit 后 Agent 页面与原 Supervisor session 均为 `82×27`。189次 session 观察没有一次等于固定期望，其中每次都与最新页面相等；原断言仍在20秒截止超时。这证明“固定过渡尺寸”足以造成同类超时，不需要假设产品漏发。

浏览器确定性对照暂停真实 xterm parser，直接观察恢复期间的过渡尺寸，再释放原 parser，验证页面回到容器尺寸且没有过渡值 resize 请求。Agent 和 Terminal 共2项在有探针及移除全部产品探针后的构建上分别通过。此结果独立证明 probe 的 cols/rows 不能代证最终布局或发送目标；浏览器不代证原生进程控制。

后续测试修复应先建立修改前恢复与 fit 的有效前提，再在原总截止内核对最新卡片、页面最终目标及同一原 session 的实际尺寸，保留内容和身份断言。不能仅增加固定 sleep、无限追赶变化值、延长20秒或忽略 resize。若要固定目标，应有证据表明目标对应当前容器及已结算 resize，而不是“第一次不同”的观察值。本轮仅定位，未实施该测试修复。

### 历史 resize 的证据限制

PR #321 的完整命令首败没有保存期望 probe，只记录原 Agent 最后 `82×27`。本轮确认的是同一测试的实际前提缺口和受控同类失败；不能追认该次历史首败的具体过渡值，也不能宣称所有旧 Agent/Terminal resize 失败都是这个原因。旧 commit lease 端口占用是独立问题。C6/C7 在更早的“页面尺寸已变化”等待失败，也分别保留，不冒充 session 一致性首败。

### fallback：定位到页面 ready 前，具体原因仍未知

原 `/tmp/dga12/fallback/.../renderer.log` 显示新 editor 容器于 `02:00:00.685` 更新内容、`02:00:00.706` 报 VS Code 自己的 `webview ready`；到 `02:00:20.708` 插件仍超时。原 snapshot 是 editor generation5、ready/ack=false、无 frameId，原 Agent/Terminal 仍存活。VS Code 容器 ready 与 React 页面发送的 `webview/ready` 不是同一事件；`CanvasPanelManager.waitForCanvasReady` 实际等待 active/visible surface 的 ready，不等待 bootstrapAck。因此原首败卡在插件 ready 前，不能称为单纯 bootstrapAck 超时或 systemd 启动失败。

原工件没有保存 Host lifecycle events、iframe 网络资源结果或 JS 执行状态；VS Code renderer/network 日志也不包含 webview.js 的实际加载结果。无法在资源加载、脚本启动/React effect 和生命周期消息过滤三个候选之间作出确认归因。既有 migration/Copilot warning 与当前成功运行共存，没有因果对照，不能列为根因。

本轮 F1 在原两阶段过程上记录 Host lifecycle，F2 移除产品探针后只在测试 ready 返回时保存原 Host 事件。两轮都完整通过且无 systemctl 提交。F1 verify 的 generation5 在 render 后343ms ready，再10ms收到同 frame bootstrapAck。generation2 在页面实际 ready 前被测试的 closeAllEditors 正常销毁，随后新 generation5 正常握手；该顺序说明 close/open 交错确实存在，但不是足以造成超时的证据。F2 verify 的事件采集发生在 ready 返回时、ack 尚未到达，符合 waitForCanvasReady 的真实条件，不写成缺 ack 的失败。

后续若再次出现具名 ready 失败，应在关闭前保存 Host lifecycle 和 iframe 的加载/错误/ready发送记录，核对实际 frame 与 generation。两轮通过不关闭首败，不能以后续重新打开页面绕过失败，也不据此修改产品生命周期。

## 验证与证据

固定输入、受控 patch、精简页面/Host/session 时间线及原日志 hash 位于 `docs/references/runtime-timeout-root-cause/`。原 PR #321 工件保持不变，新日志位于 `/tmp/dsc-timeout-investigation`。受控失败属于调查成功证据，不是产品修复或门禁通过；中间未复现/更早失败与环境失败均保留。

Linux x64、Node22.23.3、VS Code1.141.0、fake Agent；build 使用既有六目标原生资产。移除产品探针后的最终旧升级R-final2完整通过；其前一轮R-final在reset时因共享commit lease端口36758占用失败，该次失败和后来查询无listener的事实分别保留，不判定原占用者或终止未知主体。未执行完整 npm test、VSIX安装矩阵、真实 provider/systemd、其他平台或远端长断开。产品源码和正式测试等待预算不变。调查结束后临时探针和调查测试均从源码移除，仅保留可复跑 reference patches。`validation_status: 已验证`仅表示本轮有限因果调查成立，不表示fallback根因已确认、测试已修复或发布门禁已通过。
