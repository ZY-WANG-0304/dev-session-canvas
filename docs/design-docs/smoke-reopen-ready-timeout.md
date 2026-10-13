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

PR #321 后 fallback 真实窗口重开smoke曾在其显式传入的20秒Canvas ready等待预算内超时，原执行仍存活。PR #324调查确认另一条连续快速重开的机制：VS Code1.141.0 service worker中已关闭页面的资源请求等待30秒结算，占满32个名额后新页面CSS/JS排队；将独立副本容量改为4可在第3次重开触发同样的smoke 20秒超时。原单次首败没有足够证据归为同一原因，继续保留未知。

用户提出延长超时。本变更将等待上游有限结算窗口作为测试预算缓解，不宣称修复资源积压或证明原首败原因。

## 正式方案

`tests/vscode-smoke/real-reopen-tests.cjs`的`openCanvasEditor`将Canvas ready预算从20秒改为具名常量`CANVAS_READY_TIMEOUT_MS = 45000`。覆盖`scripts/smoke/run-vscode-smoke.mjs`中共用此fixture的本地/Remote SSH、systemd/fallback与多root真实窗口重开场景，setup和verify一致。当前默认VSIX runner不调用此fixture。

45秒由已观测上游30秒请求结算窗口加15秒资源加载/脚本/React启动余量组成，是本测试的有限最大等待，并不保证任意积压都在此期限内恢复。ready一旦满足即返回，不增加固定sleep，不自动重试，不更改active/interactive/visible/ready判定，也不增加bootstrapAck要求。45秒仍未ready则失败，保留现有失败snapshot、Supervisor和Host诊断工件。

各时间值的调用范围如下，不能将它们解释为所有用户打开Canvas的启动期限。

| 调用场景 | ready等待预算 | 含义 |
| --- | --- | --- |
| PR #324调查轮的真实重开smoke | 显式20000ms | 历史fixture预算；保留当时实验、失败工件和hash |
| 本PR的真实重开smoke | 显式45000ms | `openCanvasEditor`的新最大等待，ready满足后立即返回 |
| `CanvasPanelManager.waitForCanvasReady` | 未传timeout时15000ms | 方法默认值，只有实际调用该方法才会执行等待 |
| `devSessionCanvas.__test.waitForCanvasReady` | 未传有效正数时15000ms | `extension.ts`中测试命令的默认值；本fixture显式传45000ms |
| 普通打开Canvas命令 | 没有上述ready截止 | 打开调用链不执行限时`waitForCanvasReady`，也不会由这些预算产生启动超时反馈 |

普通命令在[extension.ts](../../extensions/vscode/dev-session-canvas/src/extension.ts)中分别调用`revealOrCreate/revealInEditor/revealInPanel`，经[CanvasPanelManager.ts](../../extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts)的`revealSurface`创建/显示Webview并聚焦。这条调用链不调用限时`waitForCanvasReady`。活动HTML由[getWebviewHtml.ts](../../extensions/vscode/dev-session-canvas/src/panel/getWebviewHtml.ts)提供空的`app`容器，后续内容依赖脚本启动。15秒方法/测试命令默认值及45秒smoke预算均不为普通打开提供ready截止或对应的超时反馈。

选中节点创建分组命令仍显式等待15秒；输入/注意力等实际调用点、其他smoke、Runtime恢复、正文、resize与Supervisor各自预算和原会话身份断言沿用原值。这些调用与普通打开命令分别说明，不改变本次仅调整真实重开smoke预算的范围。

## 风险与边界

真实重开smoke中的异常ready等待每次最多多耗25秒；成功路径无额外等待。延长测试容忍度无法修复VS Code内部请求积压，也不改变普通打开Canvas的用户体验。

普通打开后，资源恢复时页面可继续异步加载；如果脚本持续未启动，空的app容器可能一直呈现空白。当前普通打开路径没有专门的Canvas启动超时提示、重试按钮或由ready超时触发的自动重建。15秒方法默认值不会自动给这条路径提供失败提示，45秒smoke预算也不增加这些能力。这是现有行为限制，已登记到[技术债](../exec-plans/tech-debt-tracker.md)；后续需单独设计启动反馈与恢复方案。

源码回归通过不能代证全部VSIX、Remote与跨平台矩阵，完整发布门禁仍需独立验收。原首败继续保留，下次复现仍需iframe/worker/资源/React/Host分层取证；28.49秒资源排队对照通过不证明原单次首败已定位或已修复。

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

## Review文案修正与验证

2026-10-13，按PR #325的P2意见核对普通命令、`revealSurface`、ready方法/测试命令和初始HTML，区分历史smoke 20秒、新smoke最大45秒、方法/测试命令默认15秒，以及普通打开没有上述ready截止或对应超时反馈。同步修正[PR #324设计的历史预算描述](webview-ready-root-cause.md)、设计索引、核心原则和技术债，并登记普通打开持续空白及缺少启动反馈的限制。

本次仅修正文档与PR描述，fixture、产品源码、20秒历史样本、45秒对照、原失败工件和hash均未修改。复核文档链接/状态、证据字节与hash、diff及实际调用范围；没有重跑原生实验，沿用上方明确基线的定向与rebase复验证据。
