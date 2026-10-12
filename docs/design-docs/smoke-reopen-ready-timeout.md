---
title: 真实窗口重开测试的 Canvas ready 等待预算
decision_status: 已选定
validation_status: 已验证
domains: [VSCode 集成域]
architecture_layers: [宿主集成层, 适配与基础设施层]
related_specs: []
related_plans: []
updated_at: 2026-10-13
---

# 真实窗口重开测试的 Canvas ready 等待预算

## 背景与目标

PR #321 后 fallback 真实窗口重开曾在 editor Canvas ready 20秒超时，原执行仍存活。PR #324调查确认另一条连续快速重开的机制：VS Code1.141.0 service worker中已关闭页面的资源请求等待30秒结算，占满32个名额后新页面CSS/JS排队；将独立副本容量改为4可在第3次重开触发20秒相同症状。原单次首败没有足够证据归为同一原因，继续保留未知。

用户提出延长超时。本变更将等待上游有限结算窗口作为测试预算缓解，不宣称修复资源积压或证明原首败原因。

## 正式方案

`tests/vscode-smoke/real-reopen-tests.cjs`的`openCanvasEditor`将Canvas ready预算从20秒改为具名常量`CANVAS_READY_TIMEOUT_MS = 45000`。覆盖`scripts/smoke/run-vscode-smoke.mjs`中共用此fixture的本地/Remote SSH、systemd/fallback与多root真实窗口重开场景，setup和verify一致。当前默认VSIX runner不调用此fixture。

45秒由已观测上游30秒请求结算窗口加15秒资源加载/脚本/React启动余量组成，是本测试的有限最大等待，并不保证任意积压都在此期限内恢复。ready一旦满足即返回，不增加固定sleep，不自动重试，不更改active/interactive/visible/ready判定，也不增加bootstrapAck要求。45秒仍未ready则失败，保留现有失败snapshot、Supervisor和Host诊断工件。

`CanvasPanelManager.waitForCanvasReady`的产品默认值、选中节点创建分组15秒等待、输入/注意力相关期限和其他smoke用例不变；普通打开Canvas本身没有本fixture的20秒截止。Runtime恢复、输入、正文、resize与Supervisor等待仍沿用各自预算和原会话身份断言。未同步放宽resize预算。

## 风险与边界

异常ready等待每次最多多耗25秒；成功路径无额外等待。延长测试容忍度无法修复用户可见的长时间空白或VS Code内部请求积压。源码回归通过不能代证全部VSIX、Remote与跨平台矩阵，完整发布门禁仍需独立验收。原首败继续保留，下次复现仍需iframe/worker/资源/React/Host分层取证。

## 验证

2026-10-13，在Linux x64 / Xvfb、Node22.23.3、VS Code1.141.0上，以main `a213b89b`加本次fixture改动完成以下定向验证。命令、受控runner、输入hash与原始工件摘录见[验证证据说明](../references/smoke-reopen-ready-timeout/README.md)。

- 干净产品build成功；fixture和对照脚本语法检查、diff检查通过。
- 原版VS Code、未加诊断的fallback原两阶段完整通过；没有向systemctl提交。
- 独立VS Code副本将资源容量从32降为4，仅在staged fixture的verify前插入3次快速重开。第3次ready耗时28493ms，worker快照为active4、requests4、waiters2；旧请求30秒timeout后释放，新CSS/JS恢复。之后原verify中的原session与storage身份、恢复正文、离线完成Terminal内容丢弃、重开后输入及清理断言全部通过。其余ready耗时564–792ms，证明成功立即返回。
- 负对照只把staged bundle中唯一`webview/ready`发送改为未知消息，setup仍用完整bundle。verify在45021ms以`45000ms`错误退出1，保留error、snapshot、Supervisor和Host诊断；active editor generation5仍未ready，原Agent/Terminal session存活，pending操作0。CDP确认CSS/JS收到200且inner app子节点仍为0；不声称React已完成渲染，失败后的身份/正文/输入验收未执行。
- 对照结束后独立副本worker恢复原字节，staged负对照bundle恢复干净build；先留存失败工件与变更前hash，再删除仅本次负对照创建的session并确认其Supervisor退出。

这些结果验证本次有限等待预算，不扩大为上游修复、原单次首败归因或完整发布门禁通过。

## 合并前 rebase 复验

2026-10-13，PR #323/#324合入后，本分支rebase到main `1fb49b4e`。三处公共文档冲突合并保留主线与本PR新增内容；fixture与rebase前逐字节一致，产品源码沿用新主线。重新构建后使用原版VS Code、独立profile运行fallback原两阶段，setup/verify均退出0，原session身份、恢复正文、离线完成清理、输入和最终清理断言全部通过，没有向systemctl提交。命令、日志摘录与输入hash见[rebase验证记录](../references/smoke-reopen-ready-timeout/rebase-validation.json)。该记录的实现commit之后只补充验证文档。

资源排队和永久未ready对照仍为原基线的历史证据，未重复运行；完整发布门禁与其他平台/Remote/VSIX仍需独立验收。
