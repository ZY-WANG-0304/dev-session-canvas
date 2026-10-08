---
title: 四项发布验证阻塞定位
decision_status: 已选定
validation_status: 已验证
domains: [执行编排域, VSCode 集成域]
architecture_layers: [宿主集成层, 画布呈现层, 适配与基础设施层]
related_specs: [docs/product-specs/runtime-persistence-modes.md]
related_plans: [docs/exec-plans/completed/release-blockers-investigation.md]
updated_at: 2026-10-09
---

# 四项发布验证阻塞定位

## 背景与范围

用户于 2026-10-09 取消 0.26.1 发布，准备 PR [#308](https://github.com/ZY-WANG-0304/dev-session-canvas/pull/308) 已关闭，release 分支的计划已归档。没有合并、tag 或发布。本次基于 `origin/main@f57b11f970ce27f28c731d81a2ed3228ba27f67d`，只定位四项失败，交付根因、引入过程、复现证据与修复边界；没有修改产品、测试断言、版本或门禁。

原发布验证中，全量 Webview 为 380 passed / 2 failed；完整 verify 先后暴露 notifier 产物缺失和主题源码断言，独立 clean-checkout VSIX smoke 暴露相对 shell 等待超时。它们不属于同一根因，也不因取消发布而自动解决。

## 正式方案：定位结论与后续修复边界

### 1. notifier 文件清单测试新增了构建依赖，npm test 未补前置

直接失败是 `scripts/test/test-package-vsix-file-list.mjs:92` 调用 notifier `stagePackageFiles()`，后者在 `extensions/vscode/dev-session-canvas-notifier/scripts/package-vsix.mjs:143` 无条件复制 `dist`。干净 `npm ci` 不生成它。根 `npm test` 在此前经 Marketplace E2E 构建主扩展，notifier 构建却要到更晚的 `test:smoke`；`.github/workflows/release-preflight.yml` 在 npm ci 后直接 verify，继承同一缺口。

引入提交为 `a781334e641a310008fbbffe6473a584a0612f28`（2026-07-06，notifier 中英文本地化，PR #250；当前主线 merge 为 `4af3d1b4`）。该提交给已有的主扩展清单测试增加 notifier staging/import 和本地化文件断言，却没有调整该测试脚本或 npm test 的构建顺序。不是 notifier 打包入口没有构建：正式 package 命令有自己的构建步骤，失败测试直接调用 staging 函数。原本地化计划也明确要求缺产物时先 `npm run build:notifier`，这说明当时验证依赖手动前置；不能据此声称当时干净 npm test 通过。

在本次主线独立工作树，Node 22.23.3 下运行 `npm ci`、默认六目标资产 `npm run build` 后，原清单测试 exit 1：

    ENOENT: no such file or directory, lstat '.../dev-session-canvas-notifier/dist'

仅执行 `npm run build:notifier` 后重跑同一测试，exit 0，输出 `package-vsix file-list tests passed`。此前主扩展 staging 已成功，故缺失对象确实是 notifier。历史独立工作树先在 `a781334e^` npm ci/build 后运行原测试，exit 0；保持 notifier/dist 缺失，切到 `a781334e`（lockfile 未变）运行原测试，exit 1，同一 ENOENT；仅 build:notifier 后再次 exit 0。引入前后与主线控制结果一致。

修复边界：让正式测试入口显式满足双扩展构建依赖，或把需要真实 build 的清单验证放在保证双扩展产物存在的阶段。必须验证干净 checkout 的实际入口，不能以工作树残留 dist、空目录或删除 notifier 文件断言替代。

### 2. 组件拆分后主题测试仍要求 main.tsx 导入状态色函数

`scripts/test/test-theme-color-tokens.mjs:178–181` 使用正则要求 `main.tsx` 依次包含两个 label descriptor 与 `canvasStatusToneClass as statusToneClass`。`26e945adc7696bb804edaca9fb9eb46dfb4586e5`（2026-07-08，拆分通用节点 chrome）把使用该函数的组件迁入 `extensions/vscode/dev-session-canvas/src/webview/canvasNodeChrome.tsx`，导入随组件迁移；测试没有同步。main 留有前两个 descriptor，已不需要 tone helper。

该变更属于 [PR #253](https://github.com/ZY-WANG-0304/dev-session-canvas/pull/253)，当前主线历史 merge 为 `d944523ebfa81f4a8c5313d462eec751206ed11c`。历史 GitHub PR 元数据还保留另一个 merge SHA，本文以当前 Git ancestry 和可导出的树为准。

已有历史原脚本验证复用如下；脚本只依赖 Node 标准库，逐 ref 导出脚本及其全部 `readText()` 输入，未改断言：

| 历史树 | 原脚本结果 |
| --- | --- |
| `26e945ad^` | exit 0 |
| `26e945ad` | exit 1，缺失 main 的 tone import 断言 |
| `d944523e^` | exit 0 |
| `d944523e` | exit 1，同一断言 |

`canvasNodeChrome.tsx`、`fileNoteNodes.tsx`、`paneGallerySurface.tsx` 仍使用共享状态色映射。本次失败证明的是源码位置断言过时，不是状态色行为丢失。拆分计划 `docs/exec-plans/completed/webview-main-tsx-seventh-node-chrome-split.md` 记录了 typecheck、build、xterm entry、protocol 等定向验证，没有 theme 测试或完整 npm test；类型和打包不会执行源码正则，因此未拦住这处漂移。

修复边界：更新断言到实际承担呈现职责的组件或验证共享映射与呈现行为；不往 main 添加无用导入来满足旧正则。

### 3. 快照恢复后的 fit 暴露硬折行检测器不支持混合折行

失败用例是 `tests/playwright/webview-harness.spec.mjs` 的两项 `styled hard-wrapped code paths keep line and column suffixes`。输入仍为：

    TypeError: Cannot read properties of undefined\r\n
        at renderTerminalLink (\x1b[94msrc/webview/executionTerminalNativeInteractions.\x1b[39m\r\n
          \x1b[94mts:1600:12\x1b[39m)\r\n

测试传入 `cols: 120`，但默认节点实际视口只能显示约 64 列。只读探针在 `activateLinkForTest()` 入口读取真实 xterm buffer，Terminal 结果为 `cols=64, rows=22`：

| buffer 行（0 起） | 文本 | isWrapped |
| --- | --- | --- |
| 1 | `    at renderTerminalLink (src/webview/executionTerminalNativeIn` | false |
| 2 | `teractions.` | true |
| 3 | `      ts:1600:12)` | false |

第一段在 buffer 中被自动折行，再接原输出的 CRLF；因此不是测试名称暗示的纯硬折行。`executionTerminalNativeInteractions.ts` 的 `readHardWrappedLineContext()` 遇到 `line.isWrapped` 就停止，对自动折行行本身也直接拒绝。第一段所在上下文只有一行，不足两行即返回 undefined，未到路径解析、Host resolve 或行列号提取。普通软折行 detector 只拼接软折行，又不会跨后面的硬换行，所以两条路径都无法得到完整字符串。

对照一：主线默认构建运行未经修改的两项原用例，2 failed。对照二：只把这两项的节点宽度从默认值改为 1200，保留 ANSI、文本、120 列输入和全部目标断言；实际 fit 到 152 列，两个原目标断言均通过，准确得到 path、line=1600、column=12、source=hardwrap。只读探针确认宽节点没有中间 isWrapped 行。试验修改已撤回，不构成测试修复。

历史存在两层：`c9f1ba32`（2026-05-19）首次实现硬折行检测时就有停止于 isWrapped 的边界；`4412413e` 同日加入当前 code-path 用例，本次在该提交独立 npm ci/build 后运行原两项用例，2 passed。暴露提交为 `7f1e1887c927efbf0aed179ff012d058d75c5b57`（2026-10-02，随 PR #295 合入）：它为 Agent/Terminal 增加 `beginSnapshotRestore()`，在恢复结束时执行 `scheduleDeferredShrinkFit(0)`，使原先停留在输入 120 列的裸输出快照重新适配节点视口。独立工作树在其父提交 `e03a6527` npm ci/build 后运行原两项测试，2 passed；切到 `7f1e1887`（lockfile 未变）重新 build，原两项为 2 failed，失败文本与主线相同。这证明当前失败由恢复后的尺寸适配触发，潜在的混合折行缺口则更早存在。该提交原定向页面回归主要覆盖 restore/fit/viewport 与本地消费信用，没有覆盖这两项链接用例。进一步在该提交仅移除两处恢复结束的 `scheduleDeferredShrinkFit(0)` 调度，保留其余改动和原测试，两项再次通过；该反事实实验已撤回，不建议以取消 fit 作为修复。

修复边界：分别明确纯硬折行夹具需要的实际视口，以及混合软/硬折行是否作为产品支持范围补齐。如果补齐，应以逻辑行合并与真实 cell 坐标映射处理，继续保留同样式、缩进、prose 拒绝、候选长度/行数上限、Host 文件验证和行列号。单纯加宽测试只能消除输入歧义，不能宣称窄节点产品问题已修复；也不能删除恢复后的 fit 来掩盖它。

### 4. 本地 owned 执行已启动，却没有旧 smoke 所需 started 诊断

`verifyWorkspaceRelativeTerminalShellPathUsesWorkspaceRoot()` 关闭 Runtime Persistence，写入相对可执行 shell，设置单独 cwd，先验证节点 metadata 的绝对 shellPath/cwd，再等待同节点 `execution/started`，随后才 `waitForTerminalLive()`。shell 内容为：

    #!/bin/sh
    printf "relative-shell:%s\n" "$PWD"
    sleep 2

默认构建选择 native owner，经 `executionRuntimeSelection.ts`、`CanvasPanelManager.startTerminalSession()` 的 `nonNativeExecutionOwner` 分支进入 `startNonNativeHostExecution()`。字段名是早期非原生测试接线遗留，当前也承载原生 owned 执行。该方法等待 `operation.first`，要求结果为 `started` 后投影状态/快照并返回，但没有调用 `recordDiagnosticEvent('execution/started', ...)`；外层紧接着 return。旧 bridge 分支（约 18365 行）与 Supervisor 分支（约 16017 行）有该事件，owned local 分支没有。因此延长等待不会生成它。

原安装包 VS Code 1.141.0 现场已能证明 shell 与 cwd 正确，且真正进入过 live。以下均对应同一 Terminal、同一 executionSessionId `8752152c-dd76-451e-bb1e-6b8a2f1f582a`，不是其他会话或 shell 环境探测输出：

| UTC 时间，2026-10-08 | 已交付 Host 消息或诊断 |
| --- | --- |
| 19:30:46.425 | `execution/startRequested`，cwd 为目标 packages/app |
| 19:30:48.583 | 环境探针提示自定义脚本没有返回可解析环境快照 |
| 19:30:48.705 | `host/executionSnapshot`，liveSession=true，64×20 |
| 19:30:48.762 | `host/executionOutput`，sequence=1，正文 `relative-shell:.../.debug/vscode-smoke/relative-shell/packages/app` |
| 19:30:50.713 | `runtime/terminalSourceDisposition`，EOF，lastDataSequence=1 |
| 19:30:50.723 | 最终 `host/executionSnapshot`，liveSession=false，序列化正文 122 字符 |
| 19:30:50.738 | `execution/localFinalPersistence`，saved |
| 19:30:50.785 | reader settled，applied，finalOutputSequence=1 |

原元数据断言已通过，真实输出中的 PWD 也匹配目标目录。环境探针失败因脚本只打印标记并 sleep，不处理登录 shell 的环境输出命令；后续实际启动成功，因此它不是本次 started 超时原因。2 秒退出也不是缺事件的原因，但修诊断后仍需检查后置 live 等待的短进程时间窗口。

受控复核使用现有 `scripts/test/test-host-execution-owner-wiring.mjs` 的 `interactiveHostFixture('terminal')`，加载未改写的真实 CanvasPanelManager 和 ExecutionOwnerLifecycle，provider 边界受控返回 started。捕获到真实 start request 的 file=/controlled/shell、cwd=/controlled、113×39，business 存在；诊断只有 surface/ready 和 execution/startRequested，started 数量为 0。这个探针没有 shell 环境失败或短进程退出，仍缺事件，排除了它们作为必要条件。它属于 Host 方法接线证据，真实 PTY 成功证据来自上述原 VSIX 现场。

引入链：`c1b6bc8b`（2026-09-25）建立 owned 本地分支时未迁移 started 诊断，当时只给非原生测试用；`0f969ceb`（2026-09-30）把显式 native candidate 接入同一路径；`08fa3372`（2026-10-02）让普通 build/package 默认选择六目标 native owner，旧 smoke 才普遍走到缺事件分支。这些变更随 PR #295 于 2026-10-07 进入主线。相对路径 smoke 本身由 `f4f1b23c` 更早引入；#305 处理前序 reset 夹具后只是暴露了后面的失败。

修复边界：明确并补齐 owned local 的启动诊断契约，事件须来自真实 started 结果并携带相同会话、shellPath/cwd；或者将该 smoke 改为等待启动快照与真实 marker 来验证原本的 shell/cwd 行为，并单独覆盖诊断契约。不能跳过用例或靠延长 timeout 解决。短命 shell 应以已经捕获的启动/输出事实验收，不应必须在后续任意轮询时仍存活。

## 验证方法与证据入口

所有本轮 Node 命令使用 Node 22.23.3，浏览器为 Playwright 锁定的 Chromium 147.0.7727.15。历史工作树使用各自 npm ci；相邻提交的 lockfile 没有变化时复用刚安装的依赖。主线默认 build 通过六目标原生资产源码/依赖/hash 校验；历史 Webview 测试按历史默认 build 执行，不代证历史包或跨平台行为。

主线复现（仓库根）：

    npm ci
    DEV_SESSION_CANVAS_EXECUTION_ASSETS_SET=/path/to/validated-assets npm run build
    npm run test:package-vsix-file-list
    npm run build:notifier
    npm run test:package-vsix-file-list
    node scripts/test/test-theme-color-tokens.mjs
    node scripts/test/run-playwright-webview.mjs --grep 'styled hard-wrapped code paths'

Playwright runner 固定使用工作树 `.playwright-browsers`，会覆盖外部同名环境变量；本轮将此目录链接到已有匹配缓存。初次误触发的下载已停止，未把下载中断计为测试失败。历史复查可 `git worktree add --detach /tmp/<short> <ref>`，npm ci/build 后执行上述对应脚本。不要在用户工作树切历史版本。

关键本地日志：`/tmp/dsci-filelist-{before,after}.log`、`/tmp/dsci1-{before,after,after-build}.log`、`/tmp/dsc-theme-introduction/*.log`、`/tmp/dsci-hardwrap-{original,probe,wide}.log`、`/tmp/dscih-hardwrap.log`、`/tmp/dscij-{before,after,counterfactual}-hardwrap.log`、`/tmp/dsci-owned-start.log`。原真实宿主 JSON 位于 `/tmp/dev-session-canvas-clean-checkout-L2msFs/repo/.debug/current-host-diagnostics/2026-10-08T19-31-06-714Z/{host-messages,diagnostic-events}.json`。临时文件不是长期结论来源，上面的输入、输出摘要、提交和方法才是可复查记录。

本次没有重跑完整 npm test、全部 Webview 或全部 VSIX smoke；原完整失败事实保留，定向诊断结果不能外推门禁通过。修复四项后仍需独立按新任务重新验证。


### 受控 Host 事件探针复现

在干净调查 worktree 根目录创建临时脚本（不提交），复用原 wiring fixture 的真实类加载与边界注入。Python 只在测试文件尾部插入观察用例，不改写产品方法：

```python
from pathlib import Path
source = Path('scripts/test/test-host-execution-owner-wiring.mjs').read_text()
marker = 'const testNameFilter ='
probe = """
test('diagnosis owned started event', async () => {
  const f = await interactiveHostFixture('terminal');
  try {
    console.log(JSON.stringify({
      start: f.provider.messages.find(m => m.type === 'start'),
      events: f.diagnostics,
      business: Boolean(f.record.business)
    }, null, 2));
    assert.equal(f.diagnostics.filter(e => e.name === 'execution/started').length, 0);
  } finally { await f.cleanup(); }
});
"""
assert source.count(marker) == 1
Path('scripts/test/.diagnose-owned-start.mjs').write_text(source.replace(marker, probe + marker))
```

    DEV_SESSION_CANVAS_HOST_TEST_FILTER='diagnosis owned started event' node scripts/test/.diagnose-owned-start.mjs

本次结果为 1/1，证明缺事件，不代表正确行为回归通过。读取确认结果后删除临时脚本。

### 浏览器只读观察与宽度控制

在隔离 worktree 的 `executionTerminalNativeInteractions.ts` 中，`activateLinkForTest()` 开头临时记录 `terminal.cols`、`terminal.rows`、每行 `translateToString(true)` / `isWrapped` 与 `readStyledTextSpans(terminal, index)` 到 window 调试字段；测试捕获该字段到日志。该观察不改变检测或激活返回值。宽度对照仅将两项用例中的 bootstrap 改为：

```js
const state = createLiveExecutionNodeState(executionKind);
state.nodes[0].size.width = 1200;
await bootstrap(page, state);
```

保持输出与全部断言原样，运行相同 grep，观察 152 列与 2 passed。历史反事实对照在 `7f1e1887` 仅移除 `executionSessionNodes.tsx` 两处 `if (!terminalDisposed && snapshotRestoresInProgress === 0) scheduleDeferredShrinkFit(0);`，重新 build 后运行原两项，也是 2 passed。两类实验后都恢复原文件；它们分别证明几何条件与调度触发，不构成正式修复。
