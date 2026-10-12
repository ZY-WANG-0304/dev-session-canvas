---
title: Canvas ready 超时的页面启动根因调查
decision_status: 比较中
validation_status: 验证中
domains: [VSCode 集成域]
architecture_layers: [宿主集成层, 适配与基础设施层]
related_specs: []
related_plans: [docs/exec-plans/completed/webview-ready-root-cause.md]
updated_at: 2026-10-13
---

# Canvas ready 超时的页面启动根因调查

## 问题与目标

PR #321 后 fallback 真实窗口重开 verify 曾在 editor generation5、active、ready=false、bootstrapAck=false 时等待20秒超时。原Supervisor会话存活，VS Code外层容器已报告ready。PR #322的两次重跑通过不能确认首败原因；PR #323处理的是旧升级resize夹具瞬态取样，不修复本启动问题。本轮实验基于当时的main `a213b89b`，实验输入不包含PR #322/#323。2026-10-13，PR #323合入后，本调查分支rebase到main `a6bb190a`；历史实验输入、工件和结论边界保持，不把rebase视作重新运行实验。

## 本轮确认的机制

在VS Code1.141.0/Linux Native连续快速关闭重开中，页面ready后立即关闭会留下尚未得到响应的字体资源请求。VS Code service worker的`RequestStore`在frame消失后仍等待30秒；`hostResourceResponseBodySemaphore`在请求等待期间占用名额，Electron限额为32。

R3连续40次、R4连续80次重放，分别在第33次、第33/65次出现约16秒停顿。R5在独立VS Code副本仅加入阶段记录后，直接捕获active=32、requests=32、waiters=2。旧字体请求从`host-request`到关闭后没有`host-response`，新CSS/JS的缓存查询毫秒内完成，停在`acquire-start`；旧请求30秒超时后释放名额，新CSS/JS立即获准派发，返回后bundle、React ready和Host接收均正常。`getWebviewHtml.ts`的样式表位于inline身份/诊断script之前，CSS未返回时inline标记也可能不执行，不能把缺inline标记直接解释成HTML未写入。

代码责任在本轮固定VS Code包的`resources/app/out/vs/workbench/contrib/webview/browser/pre/service-worker.js`：`processResourceRequest`先查缓存，再取得信号量，最后建`RequestStore`并请求outer iframe；超时结算释放，frame销毁没有取消这份等待。上游`workbench.desktop.main.js`的Webview `loadResource`还会在disposed后直接返回。已确认的是请求无人应答及名额延迟释放；每个旧请求究竟是在renderer收到前丢失、disposed后跳过，还是转发阶段失效，本轮没有逐个证明。

在更快填满容量时，名额剩余等待可能超过产品20秒期限。C2只把独立副本限额32改为4，同一重放第3次触发20秒Canvas ready超时：generation20 active、ready/ack=false、原Agent/Terminal存活、Supervisor pending=0，CSS/JS两个请求排队。C3将限额提高到128，40次通过、最大等待507ms；结束仍有40个旧请求，队列为空。因此该实验确认排队能造成ready超时，也证明提高限额没有修复积压。不能将4或128改动交付为产品修复。

## 原首败仍未定因

原故障只在一次activation打开、关闭、再打开后发生，没有证据表明已积累32个请求。不能把本轮批量重开的限额耗尽直接认定为原首败根因。

原renderer完整日志没有`Webview.loadLocalResource`读取记录；正常对照有CSS、JS读取记录。该差异将原首败的优先取证收窄到VS Code页面内容启动与资源派发，仍不能区分service worker控制/更新等待、内层iframe未写入、缓存等待或资源请求未送达renderer。原工件缺Host事件、iframe状态、worker计数和脚本阶段，无法追补实际发生过的事件。

`CanvasPanelManager.waitForCanvasReady`检查active、interactive、visible和应用ready，不等待bootstrapAck。原`bootstrapAck=false`不能解释等待失败。VS Code `pre/index.html`在`signalingReady`之后，收到content还需等待`workerReady`、创建fake.html内层frame、写HTML和加载资源；外层ready不表示React执行完成。R3/R4慢例中，React发ready后的Host接收/接受没有异常；C2根本未进入React ready，不能从该负对照评价消息过滤。这些结论不能外推到未记录的原首败。

恢复五份临时源码后重新构建，N1使用原版VS Code、原短workspace `/tmp/dscgate1012`、独立新profile执行原fallback两阶段，完整通过且无systemctl提交。它排除了“短workspace路径本身必然失败”的说法，但新profile不能代证原profile健康。没有证据把原首败归为PTY、systemd fallback或宿主拒收，也没有证据证明它已修复。

## 验证与收口

证据、运行表、输入SHA256、关键worker事件、负对照快照和可复用probe见[取证说明](../references/webview-ready-root-cause/README.md)。R1首次误将构建与启动并行导致缺dist，已保留退出1工件，未计入产品故障；后续构建和启动串行。R4直接通过CDP访问上游模块私有绑定的ReferenceError属于诊断自身，随后改为在独立副本暴露只读引用，不能计为应用异常。重复worker attach的console事件已按run与内容去重。

本轮最终仅提交调查文档、证据和参考诊断patch，不修改产品、resize、等待预算或正式fixture。五份源码按调查前SHA256恢复；原VSCode缓存哈希一致，副本也恢复。N1、build与文档/参考脚本检查完成；未运行完整发布门禁，不构成0.26.1发布豁免。

## 后续决策边界

原首败保持未确认；下次具名复现须同时保存outer性能标记、inner DOM、CSS/JS请求、worker计数、React发送与Host接收，按同一surface/generation/frame关联。优先区分workerReady尚未完成与资源名额排队，再考虑应用执行或Host身份过滤。

连续重开积压是已确认的上游生命周期问题，修复应取消已销毁client的未完成请求或保证其及时结算，再验证缓存/stream/body责任；需在VS Code上游变更中验收，或另行设计扩展可控的资源责任措施。固定sleep、延长20秒、提高限额和无限重试都不作为本轮修复。Linux/指定版本结论不外推其他VS Code版本、macOS、Windows或Remote。
