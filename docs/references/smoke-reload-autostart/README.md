# 画布重读调查的复现材料

这里保存的是调查输入。正式结论见 `../../design-docs/smoke-reload-autostart-investigation.md`。`diagnostic.patch` 在 main `78c58c2a` 的隔离工作树使用过，包含只读 Host 探针、临时 smoke 分支和工作区路径覆盖；它不修改执行身份保护。实验通过表示观测符合该实验的预期，其中 seed/reload/workspace-add 的预期就是复现缺陷，不表示 release gate 通过。

## 环境

Linux x64、Node 22.23.3、VS Code 1.141.0、当前代码匹配的 execution assets、Playwright Chromium。测试使用 fake-agent-provider 和真实 bash。原调查 checkout 为 `/tmp/dscr`，patch 的观测文件与新增工作区 root 分别固定到 `/tmp/dscr/.debug/rca`、`/tmp/dscr-added-root`；重放前使用新的隔离工作树，若路径已占用则统一改写 patch 的这两处前缀，不覆盖现有工作。

原环境可复用 `/tmp/dsc-release-node22/node_modules/node/bin`、`/tmp/dsc-release-026-assets`、`/tmp/dsc0261v/.vscode-test/vscode-linux-x64-1.141.0/code`、`/tmp/dsc026v/.playwright-browsers`。其他机器需替换为对应安装位置。不要使用超长 workspace/storage 路径，目录权限为 0700。

## 操作

在新建的 `/tmp/dscr` 调查树执行；先把本目录复制到树外，便于回到基线后使用：

    git switch --detach 78c58c2a2cecd053199c9bada6084868f9255877
    git apply /path/to/diagnostic.patch
    umask 0077
    export PATH=/tmp/dsc-release-node22/node_modules/node/bin:$PATH
    export DEV_SESSION_CANVAS_EXECUTION_ASSETS_SET=/tmp/dsc-release-026-assets
    export DEV_SESSION_CANVAS_VSCODE_EXECUTABLE=/tmp/dsc0261v/.vscode-test/vscode-linux-x64-1.141.0/code
    export DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=trusted
    npm ci
    npm run build
    mkdir -p .debug/rca
    ln -s /tmp/dsc026v/.playwright-browsers .playwright-browsers
    DSC_RELOAD_RCA=control node scripts/smoke/run-vscode-smoke.mjs > .debug/rca/control.log 2>&1
    DSC_RELOAD_RCA=seed node scripts/smoke/run-vscode-smoke.mjs > .debug/rca/seed.log 2>&1
    DSC_RELOAD_RCA=reload node scripts/smoke/run-vscode-smoke.mjs > .debug/rca/reload.log 2>&1
    DSC_RELOAD_RCA=original node scripts/smoke/run-vscode-smoke.mjs > .debug/rca/original.log 2>&1

`control` 的两条执行应持续 live 且 `metadataMatches=true`。`seed` / `reload` 的 immediate/after JSON 应显示同两条 running 执行仍在、节点 live=false、metadataMatches=false；events 可见 `investigation/startRejected`。`original` 运行正式 trusted 前缀，在第一个 sidebar 测试后提前返回，保留 seed 前后的同身份快照。默认变量为空时仍运行原测试流程，不应在调查树用其结果冒充未经探针的 release gate。

真实产品路径需要打开已保存 workspace，然后等待文件夹变更事件：

    python3 -c 'import json; open(".debug/rca/rca.code-workspace", "w").write(json.dumps({"folders":[{"path":"/tmp/dscr"}]}))'
    DSC_RCA_WORKSPACE=/tmp/dscr/.debug/rca/rca.code-workspace DSC_RELOAD_RCA=workspace-add node scripts/smoke/run-vscode-smoke.mjs > .debug/rca/workspace-add.log 2>&1

核对 before/after 的 `pid` 相同、workspaceFolders 从一项到两项、旧 node ID 与执行记录脱节、最终三条 running 记录，其中新 Agent 的 resume session ID 与原 Agent 相同。未收到 workspace event 的尝试不是有效样本。普通 folder 窗口到 workspace 的转换可能等待 VS Code 交互，因此不能用固定睡眠代替事件证据。

结算路径对照：

    DSC_RELOAD_RCA=boundary node scripts/smoke/run-vscode-smoke.mjs > .debug/rca/boundary.log 2>&1

该临时实验明确捕获首次模拟 reload 的 pending-save 错误，保留 `boundary-first-rejection`；仅等待原记录清空后才显式再次调用，再显式启动两节点。查看 `boundary-final-saved` 与 `boundary-immediate` 的 owner pending=0、records=[]，以及 after 中两个新执行绑定正确。它不验证单次模拟 reload 自动等待保存，也不是整个窗口重启测试。

现有定向 Host 对照在移除探针后运行：

    DEV_SESSION_CANVAS_HOST_TEST_FILTER='simulated reload|large final snapshot survives actual Host reload|final persistence follows the original' node scripts/test/test-host-execution-owner-wiring.mjs

本轮为 7/7。`evidence.json` 从实际快照挑选执行状态、身份、保存结果和相关事件，省略画布正文与大量 UI 信息；完整本地快照仍在调查树 `.debug/rca`。调查完成后反向应用 patch 或移除整个专用实验树；不要把该临时测试分支应用到发布分支。

## PR #314 修复验收

`repair-evidence.json` 记录修复后的具名回归、源码摘要与完整 VSIX smoke 的后续失败。它与上面的基线调查分开：不要将 `diagnostic.patch` 套用到修复后的源码。最终 VSIX 的 `owned-canvas-reconciliation` 从活动 Agent/Terminal 直接模拟 reload，一次完成原保存、重新开放准入并成功启动。

在修复分支上，沿用上面的匹配环境，可运行：

    node scripts/test/test-host-execution-owner-wiring.mjs
    DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=owned-canvas-reconciliation npm run test:vsix-smoke

不设置过滤时，默认 VSIX 先运行新增场景，再运行完整 trusted。完整命令在后续 `verifyAgentExecutionFlow` 的 burst metadata 正文断言失败；同身份终端快照已含 marker 的精简观测保存在 `repair-evidence.json`，后续修复入口见正式设计及技术债。过滤场景通过不能代替发布门禁。

## 2026-10-10 当前执行正文断言

`output-assertion-evidence.json` 记录后续正文断言、重复启动窄修、最终快照尺寸检查和完整 VSIX 的新失败。`repair-evidence.json` 继续保留前一轮历史结果，不改判原 burst 失败。

    node scripts/test/test-smoke-execution-output.mjs
    DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=local-execution-flow npm run test:vsix-smoke

不设过滤的默认 VSIX 会运行 owned reconciliation、local execution flow、trusted 三个阶段。最终完整运行前两阶段通过，trusted 因页面残留原生 resize 准入错误失败；详情和后续定位入口见正式设计与技术债。
