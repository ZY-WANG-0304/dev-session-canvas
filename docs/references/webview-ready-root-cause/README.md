# Canvas ready 分层取证（2026-10-13）

正式判断见 `../../design-docs/webview-ready-root-cause.md`。这里保存可复核输入、关键事件与诊断 patch。产品源码、测试夹具和原 VS Code 已恢复；patch 不是正式修复。原首败仍未确认原因。

## 运行结果

| 运行 | 输入与操作 | 完整退出 | 关键结果 |
| --- | --- | --- | --- |
| R1 | 构建和首次启动误并行，staged extension 缺 dist | 1，环境准备失败 | 未进入 Canvas，不计产品失败；改为构建完成后启动 |
| R2 | main a213b89b，应用/Host 阶段标记，原 fallback 两阶段 | 0 | setup/verify generation 5 ready 被接受；CSS、JS 200 |
| R3 | 原版 VS Code；verify 在原操作后连续 40 次 open→close→open→ready→close | 0 | 40 次与最终原场景通过；第 33 次 ready 15,862ms，CSS 等待 15,466ms |
| R4 | 原版 VS Code；同样连续 80 次 | 0 | 第 33/65 次 ready 16,602/16,469ms，CSS 等待 16,192/16,080ms |
| R5 | VS Code 独立副本，只加 service worker 日志/计数；连续 40 次 | 0 | 第 32 次 ready 15,554ms；active=32、waiters=2、requests=32；旧请求30秒超时释放名额 |
| C1 | 日志副本，40 次 open→等待80ms→close，然后原 ready 等待 | 0 | 最后 ready 1,903ms；此调度未留下积压，不是正式规避方案 |
| C2 | 日志副本限额从32降到4；最多8次同 R5 操作 | 1 | 第3次在20秒超时；generation20 active、ready/ack=false，原执行存活，Supervisor pending=0；active=4、waiters=2 |
| C3 | 日志副本限额从4提高到128；40次同 R5 操作 | 0 | 40次和最终原场景通过，最大 ready 507ms；仍留下40个未完成请求，waiters=0，不是积压修复 |
| N1 | 五份源码按 inputs.json 恢复，重新构建；原版 VS Code；原短 workspace /tmp/dscgate1012，两阶段 | 0 | 原20秒条件通过，无systemctl提交；短路径不能单独解释原首败 |

R3/R4 是原版 VS Code 的自然操作重放，仅扩展含阶段日志；R5 加上游只读记录。C1/C2/C3 是改变操作节奏或上游容量的控制实验，不能当成原操作复现。所有 ready 等待为20秒；通过的完整回归均继续验证原 Agent/Terminal 身份、正文和重开后输入。C2 在 ready 前失败，因此后续正文/输入检查没有执行。

原 renderer 在第一次容器ready后5ms关闭、隔41ms第二次容器ready，20秒后应用等待超时；整个日志没有 `Webview.loadLocalResource` 记录。正常页面对应CSS、JS读取日志均出现。这个缺口可将首败的优先取证放在workerReady、内层frame与资源派发，但不能从缺失日志推断具体请求或限额数。

## 文件说明

- `inputs.json`：main五份源码的SHA256；`all-diagnostics.patch`：最后的完整临时probe及可选重放控制。应用标记位于inline identity、bundle入口、React ready effect、post调用前后；Host记录接收和接受。默认产品未更改。参考patch仅去掉空白context行的行尾空格，仍通过git apply --check；原始patch另保存在external hash清单对应路径。
- `cdp-observe.mjs`：Node22 WebSocket直连本地Chrome DevTools Protocol；不暂停页面。记录iframe资源、异常、销毁、阶段console和500ms DOM/性能标记快照。上游计数只在应用了worker诊断patch的独立VSCode副本可用。
- `vscode-service-worker-diagnostics.patch`：固定VSCode1.141.0的只读计数/阶段probe。模块绑定不能从Runtime.evaluate直接访问，故通过`globalThis.__DSC_SW_DIAG__`暴露；此前R4的直接访问产生的是probe自己的ReferenceError，无应用exceptionThrown，不计产品异常。
- `native-r{3,4,5}-readiness.json` / `control-c3-readiness.json`：每个等待起止与匹配lifecycle。`r4-slow-resources.json`：原版资源慢响应。
- `r5-worker-stages.json`：R5已去重worker事件。`c3-worker-stages.json`：128名额对照已去重事件。原CDP可能对同worker重复attach，事件按run与JSON去重，不能用原行数计请求数。
- `c2-causal-timeline.json` / `c2-failure-*`：4名额负对照关键事件与首次失败工件。负对照标签必须保留。
- `original-renderer-boundary.log`：原首败renderer边界摘录；原完整日志与所有本轮原日志路径、字节数、SHA256见`external-artifact-hashes.json`。外部日志仍保存在本机，不将摘录当作完整日志。
- `run-original-workspace.mjs`：恢复源码后使用原短workspace的两阶段runner，复用正式fixture，不修改workspace；原workspace的git状态复核仍干净。

## 复核方法

所有命令在仓库根运行，固定Node22：

```bash
export PATH=/tmp/dsc-release-node22/node_modules/node/bin:$PATH
DEV_SESSION_CANVAS_EXECUTION_ASSETS_SET=/tmp/dsc-release-026-assets npm run build
node docs/references/webview-ready-root-cause/cdp-observe.mjs /tmp/dsc-ready-investigation/cdp-new 38991
```

observer保持运行时，另一个shell在固定a213b89b、核验inputs.json后应用`all-diagnostics.patch`，再串行构建并执行：

```bash
DEV_SESSION_CANVAS_EXECUTION_ASSETS_SET=/tmp/dsc-release-026-assets npm run build
DEV_SESSION_CANVAS_VSCODE_TEST_CACHE_PATH=/tmp/dsc0261v/.vscode-test \
DEV_SESSION_CANVAS_SMOKE_DEBUG_ROOT=/tmp/dwr-r3 \
DEV_SESSION_CANVAS_READY_DIAG_PORT=38991 \
DEV_SESSION_CANVAS_READY_DIAG_REPEATS=40 \
DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=systemd-fallback-real-reopen \
node scripts/smoke/run-vscode-smoke.mjs
```

重放使用新的独立debug目录，避免覆盖已有工件。R4的REPEATS=80；R5的cache指向`/tmp/dsc-ready-vscode/.vscode-test`（原VSCode完整副本，仅worker有diagnostic patch）。C1设置BURST=40、不设置REPEATS；80ms是控制fixture里的显式调度。C2/C3只在副本worker中修改`maxActiveHostResourceResponseBodies`为4/128；其余输入不变。保留首败，不在原缓存中修改源码。完成后停止自身observer，保存patch并按inputs.json恢复源码与副本worker。

N1使用恢复源码与原版cache，执行：

```bash
xvfb-run -a node docs/references/webview-ready-root-cause/run-original-workspace.mjs
```

此runner路径记录本轮真实环境；后续换机器须显式重设路径，不能把参考工件里的旧路径当作通用配置。观察端口仅绑定127.0.0.1，使用前确认空闲。诊断会改变运行时序，原样通过不能证明原失败消失。
