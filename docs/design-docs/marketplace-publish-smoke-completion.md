---
title: Marketplace 发布 smoke 等待实际完成反馈
decision_status: 已选定
validation_status: 已验证
domains: [VSCode 集成域]
architecture_layers: [宿主集成层, 适配与基础设施层]
related_specs: []
related_plans: [docs/exec-plans/completed/marketplace-publish-smoke-completion.md]
updated_at: 2026-10-14
---

# Marketplace 发布 smoke 等待实际完成反馈

## 背景与根因

PR327 正式门禁 run38485499547、预合并217fd693在模板新版本发布的成功提示断言失败。测试只等待 fixture.publishedVersionRequests.length === 1，就立即检查信息提示并恢复拦截器。夹具在写 HTTP 201 响应前登记请求；CanvasTemplateMarketplacePanel.submitTemplatePublish 还须等待客户端响应解析、Webview postMessage，随后才调用 showInformationMessage。收到请求不能证明成功提示已经产生。

等待条件自2026-06-26引入后未变，2026-10-08只改英文提示。相关测试/夹具/Panel/Client四文件与旧完整成功输入32ec277b具有相同blob。既有Linux/VSCode1.141.0对照中，阻塞响应使原断言确定失败；释放响应101ms后原精确提示、请求内容和v3页面全部通过。该机制说明门禁有竞态，不能据此宣称CI具体调度因素、VSCode1.141.1缺陷或生产发布失败已确认。证据见 docs/references/marketplace-publish-smoke-completion/root-cause.json。

## 正式方案

仅修改 tests/vscode-smoke/template-marketplace-tests.cjs 的 verifyMarketplacePanelPublish 与 verifyMarketplacePanelPublishVersion：在原单个20000ms的 waitForCondition 中同时等待唯一请求和原预期成功提示。信息拦截器在两项满足后才退出。首次发布和版本发布采用同一语义，原请求身份/内容、准确提示、认证次数、发布结果与页面断言全部保留。缺失或重复请求、错误模板/版本、无关提示、提示缺失继续失败。

不改产品发布逻辑、HTTP夹具响应、通用等待helper、宿主版本选择、timeout、截图或发布版本。超时诊断包含请求数与捕获的测试信息提示，帮助区分请求未到达和完成反馈未到达。

scripts/test/test-smoke-marketplace-publish.mjs 在隔离VM中执行上述实际场景函数，模拟请求已到但通知滞后，并以虚拟时钟验证原预算内成功及负例按期失败。它验证实际调用处及拦截器恢复，不复制新的判断实现。npm test纳入该回归；实际VSCode宿主E2E另行运行。响应阻塞的临时诊断overlay只用于对照，不成为正式夹具依赖。

## 验证与边界

回归须证明旧调用处在通知滞后时失败，新调用处在原预算内通过；消息缺失/错误及请求数量错误不得通过，超时不增加预算，成功或失败后拦截器均恢复。真实宿主运行原Marketplace E2E，继续核对发布内容与v3 UI。验证结果随此独立修复PR收口；PR327保持发布准备，修复合入后仍需最新预合并完整门禁。

2026-10-14验证：两类旧调用处均在延迟提示正例失败；新场景回归20/20通过，提示缺失/错误、请求缺失/重复、超期提示均在原20000ms失败，拦截器恢复。Node22默认build、相关workflow回归及VSCode1.141.1原Marketplace E2E通过；首次和版本响应各延迟300ms的临时对照仍通过全部原内容/提示/v3 UI断言，正式fixture已恢复原样。证据 repair-verification.json。未运行本分支全量npm test，不代证PR327完整发布门禁或CI具体调度原因。
