# 收口开发调试隔离与自动化验证

本 ExecPlan 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘` 这几个章节。

本文件位于 `docs/exec-plans/completed/extension-debug-automation.md`，必须按照 `docs/PLANS.md` 的要求持续维护。

## 目标与全局图景

把当前仓库的开发验证收口成三层：第一层让 `Run Dev Session Canvas` 总是启动到干净、隔离的开发宿主；第二层提供一条真实 VS Code 扩展 smoke test，让代理可以自动验证扩展激活、打开画布和宿主状态回流；第三层提供一条 Playwright Webview UI 测试，让画布前端自身可以做交互和截图回归。

完成后，协作者应能亲眼看到以下结果：即使本机已经安装当前扩展，F5 仍会启动隔离的 Extension Development Host；执行 `npm run test:smoke` 会自动启动 VS Code 并通过主路径验证；执行 `npm run test:webview` 会自动加载 Webview harness、完成交互断言并比对截图。

## 进度

- [x] (2026-04-06 12:56 +0800) 读取 `docs/WORKFLOW.md`、`docs/PLANS.md`、`ARCHITECTURE.md`、`docs/DESIGN.md` 和当前工程配置，确认这是一次需要 `ExecPlan` 的复杂交付。
- [x] (2026-04-06 13:24 +0800) 验证 `lark-cli` 可用，并接通 bot 身份的飞书通知链路，满足后续关键节点前给用户发消息的约束。
- [x] (2026-04-06 13:26 +0800) 新增设计文档与索引登记，明确三层调试自动化方案。
- [x] (2026-04-06 13:31 +0800) 实现隔离式 `Run and Debug`、调试目录准备脚本与相关任务配置。
- [x] (2026-04-06 14:16 +0800) 根据真实 F5 反馈确认 `--extensions-dir` 在 `Remote - SSH` 场景下会丢失本机 UI 扩展，最终把调试隔离收敛为“保留默认扩展目录，只禁用当前扩展 id”。
- [x] (2026-04-06 14:52 +0800) 根据第二轮真实 F5 反馈确认继续隔离 `HOME` / `XDG_*` / `TMPDIR` 会让 Remote-SSH 卡在 `LocalLockTimeout`，最终把交互式 F5 收敛为“只隔离 `user-data-dir`，并在 debug profile 中关闭 `remote.SSH.useLocalServer`”。
- [x] (2026-04-06 15:45 +0800) 对照 VS Code 官方文档重新审视交互式 F5，确认 Remote 场景下官方推荐的是命名 profile，而不是继续手工拼 `user-data-dir` / `extensions-dir` / 远端 workspace 规避；据此把第一层切换为 Profile 版。
- [x] (2026-04-06 13:33 +0800) 为测试模式补充内部命令，并新增真实 VS Code smoke test runner。
- [x] (2026-04-06 13:42 +0800) 新增 Playwright Webview harness、交互测试与截图基线。
- [x] (2026-04-06 13:46 +0800) 运行 `npm run build`、`npm run typecheck`、`npm run test:smoke` 和 `npm run test:webview`，同步更新本计划、设计文档和技术债记录。
- [x] (2026-04-06 18:26 +0800) 在第二层新增合成 `webview/*` 消息派发入口，并把真实 VS Code smoke test 下压到宿主消息桥接与 `Terminal` 执行链路。
- [x] (2026-04-06 20:07 +0800) 在第二层补齐 `Agent` 假 provider、恢复、失败路径、非激活 surface 语义与失败诊断产物，作为后续继续下压第三层前的压实步骤。

## 意外与发现

- 观察：`lark-cli` 在当前沙箱中默认写入 `~/.local/share/lark-cli` 会失败，因为该路径只读。
  证据：执行 `lark-cli contact +get-user --as user` 返回 `read-only file system`。

- 观察：尽管 user token 已失效，但当前环境里仍能用 bot 身份向用户 `open_id` 发送 IM 消息。
  证据：`lark-cli im +messages-send --as bot --user-id ou_6ee972d2fedf7c5a3fa0e421b20148b4` 成功返回 `message_id`。

- 观察：真实 VS Code smoke test 在当前沙箱里如果直接继承默认 `HOME` / `XDG_*`，VS Code 自身会因为只读用户目录和运行时目录而启动失败。
  证据：首次运行 `npm run test:smoke` 时，VS Code 报错 `EROFS` 于 `~/.vscode/argv.json`、字体缓存目录和 `/run/user/.../vscode-*.sock`；把这些目录显式切到仓库内可写路径后测试通过。

- 观察：React Flow 节点容器本身带 `role="button"`，Playwright 如果直接按 `getByRole('button', { name: '启动' })` 选择会同时命中节点容器和内部操作按钮。
  证据：首次运行 `npm run test:webview` 时，agent 启动用例触发 strict mode violation；把选择器收窄到 `.agent-session-node` 内部后恢复稳定。

- 观察：在 `Remote - SSH` 场景下，不仅 `--disable-extensions` 会打坏调试窗口，重写 `--extensions-dir` 也会导致本机 UI 侧的 `Remote - SSH` 扩展缺失。
  证据：改成 debug 专用 `extensions-dir` 后，Development Host 窗口继续提示“Extension 'Remote - SSH' is required to open the remote window”。

- 观察：即使保留了默认扩展目录，只要继续在交互式 F5 里隔离 `HOME`、`XDG_*` 和 `TMPDIR`，Development Host 中的 Remote-SSH 仍会卡在 `LocalLockTimeout`，日志表现为“Starting to look for password prompt from another window”后超时。
  证据：第二轮 F5 截图中，Remote-SSH 最终报错 “Timed out while waiting for the local startup lock”。

- 观察：VS Code 官方从 1.72 起已经把“干净的扩展调试环境”抽象为 Profile；对 Remote 场景，官方明确建议使用命名 profile，并提醒不要在新开的 Development Host 中重新打开扩展源码目录本身。
  证据：官方更新说明与 Remote Extensions 文档分别指出本地可用 `--profile-temp` / `--profile=<name>`，但 Remote 需要预装 Remote Development 扩展的命名 profile；Remote 调试窗口里“不能再打开扩展源码目录本身，只能打开子目录或别处”。

## 决策记录

- 决策：本轮不把“真实扩展 smoke test”和“Webview UI 回归”混成一条测试链，而是分成两层独立入口。
  理由：真实 VS Code 集成验证和浏览器内 UI / 截图回归的稳定性、成本和适用范围完全不同，混在一起只会增加脆弱性。
  日期/作者：2026-04-06 / Codex

- 决策：Playwright 直接加载真实 `dist/webview.js` bundle，并通过 stub `acquireVsCodeApi()` 驱动。
  理由：这样可以最大程度复用线上前端代码，同时不必为了测试额外维护一份平行的演示页面实现。
  日期/作者：2026-04-06 / Codex

- 决策：宿主测试辅助命令只在 `vscode.ExtensionMode.Test` 下注册，不写入 `package.json` 的 contributes 区域。
  理由：这些命令只服务自动化验证，不应进入普通用户界面，也不应成为对外承诺的扩展接口。
  日期/作者：2026-04-06 / Codex

- 决策：F5 调试不再改写 `--extensions-dir`，而是保留默认扩展目录并使用 `--disable-extension=devsessioncanvas.dev-session-canvas`。
  理由：用户真正要解决的是“已安装的当前扩展”和开发态扩展冲突，而不是隔离所有扩展；`Remote - SSH` 这类本机 UI 扩展不在远端文件系统里，远端脚本无法可靠镜像它们。
  日期/作者：2026-04-06 / Codex

- 决策：交互式 F5 不再隔离 `HOME`、`XDG_*` 和 `TMPDIR`，改为只隔离 `user-data-dir`，并在隔离 profile 中写入 `remote.SSH.useLocalServer=false` 与 `remote.SSH.showLoginTerminal=true`。
  理由：Remote-SSH 需要复用本机真实 SSH 环境；Development Host 又是从一个已经连接远程主机的窗口里拉起，继续使用 `useLocalServer=true` 容易卡在跨窗口本地启动锁。
  日期/作者：2026-04-06 / Codex

- 决策：第一层 F5 方案最终切换为 VS Code 官方 Profile 模式：固定使用 `Dev Session Canvas Extension Debug` profile，只保留 `--extensionDevelopmentPath`，不再手工改写 `user-data-dir`、`extensions-dir`、本地环境变量，也不再在仓库内生成专用远端 workspace。
  理由：前述手工隔离虽然逐步规避了部分冲突，但持续撞上 Remote-SSH 与远端 `workspaceStorage` 语义边界；官方文档已经给出更稳定的抽象层，应该直接回到 Profile 机制。
  日期/作者：2026-04-06 / Codex

## 结果与复盘

本计划定义的三层交付已全部完成：

- 第一层：`Run Dev Session Canvas` 现在固定使用命名 profile `Dev Session Canvas Extension Debug` 启动 Development Host，并只通过 `--extensionDevelopmentPath` 加载当前仓库里的开发态扩展；旧的 `user-data-dir` / `extensions-dir` / 远端 workspace 规避脚本已回收。
- 第二层：仓库新增真实 VS Code smoke test，代理可以在命令行里完成扩展激活、打开画布、等待 Webview ready、`webview -> host` 创建/更新/移动/删除/reset 消息，以及 `Agent` 假 provider / `Terminal` 的启动、输入、resize、停止、失败路径、持久化恢复和非激活 surface 语义的自动验证。
- 第三层：仓库新增 Playwright Webview harness，可直接加载真实 bundle，完成交互断言和截图回归。

本轮剩余技术债主要有两项：Playwright harness 仍然运行在浏览器页面而不是真实 VS Code Webview 容器里；以及 Remote-SSH 下的 debug profile 第一次仍需要用户在本机完成一次准备。两者都已登记到技术债追踪或文档前置条件中。继续把第三层往真实容器下压的工作由 `docs/exec-plans/active/test-automation-hardening.md` 继续推进。

## 上下文与定向

本轮修改的主要区域如下：

- `.vscode/launch.json`、`.vscode/tasks.json`：开发调试入口与 Profile 版 F5。
- `package.json`、`.gitignore`：自动化验证入口和本地产物忽略规则。
- `src/extension.ts`、`src/common/extensionIdentity.ts`、`src/panel/CanvasPanelManager.ts`：测试模式命令与宿主测试辅助能力。
- `scripts/`：VS Code smoke runner、Playwright runner。
- `tests/`：真实 VS Code smoke test、Webview harness、Playwright 交互测试与截图基线。
- `docs/`：设计文档、执行计划、开发说明、技术债。

这里的“真实 VS Code smoke test”指：真的启动一个 VS Code Electron 实例，把当前扩展加载进去，再用测试代码调用 VS Code 命令和内部测试命令完成验证。

这里的“Webview harness”指：在普通浏览器页面里加载真实 `dist/webview.js`，并提供一个假 `acquireVsCodeApi()` 实现，让 Webview 代码认为自己运行在 VS Code 容器里。

## 工作计划

先写文档，把本轮方案边界与验收口径固定下来。然后从最不侵入的第一层开始，先尝试目录级隔离并收集真实 F5 反馈；在确认这条路和 Remote-SSH 的官方语义持续冲突后，改为 VS Code 官方的命名 Profile 方案。接着实现第二层，在扩展里补仅测试模式可用的内部命令，并新增 `@vscode/test-electron` smoke runner。最后实现第三层的 Playwright harness 和截图测试，确保 Webview 自身也进入可回归状态。全部完成后，再统一执行构建与两条自动化测试，并把结果回写到本计划、设计文档和技术债记录。

## 具体步骤

1. 新增 `docs/design-docs/development-debug-automation.md`，并更新 `docs/design-docs/index.md`。
2. 调整 `.vscode/launch.json` 和 `.vscode/tasks.json`，把 F5 收敛到 `--profile=Dev Session Canvas Extension Debug` 和 `--extensionDevelopmentPath`。
3. 在 `src/common/extensionIdentity.ts` 中新增测试命令 ID。
4. 在 `src/panel/CanvasPanelManager.ts` 中新增测试辅助 API，例如状态快照、等待 Webview ready、无交互创建节点。
5. 在 `src/extension.ts` 中仅在 `ExtensionMode.Test` 下注册内部测试命令。
6. 新增 `scripts/run-vscode-smoke.mjs` 与 `tests/vscode-smoke/extension-tests.cjs`。
7. 新增 Playwright 配置、runner、Webview harness 和至少一张截图基线。
8. 运行 `npm run build`、`npm run typecheck`、`npm run test:smoke`、`npm run test:webview`。

## 验证与验收

本轮已满足以下条件：

- `Run Dev Session Canvas` 的启动参数已经固定为官方 Profile 方案。
- `npm run build` 通过。
- `npm run typecheck` 通过。
- `npm run test:smoke` 通过，并覆盖扩展激活、打开画布、等待 ready、`webview -> host` 创建/更新/移动/删除/reset 消息，以及 `Agent` 假 provider / `Terminal` 的启动、输入、resize、停止、失败路径、恢复和非激活 surface 语义。
- `npm run test:webview` 通过，并覆盖一条截图基线和两条 UI 消息断言。
- 文档明确区分真实扩展 smoke test 与 Webview Playwright 测试各自的边界。
- smoke 与 Playwright runner 失败时，仓库内会留下可定位问题的调试产物。

## 幂等性与恢复

- VS Code smoke test 和 Playwright 测试都使用仓库内可清理目录保存缓存与产物，失败后重新执行不需要手工清理隐藏状态。
- 首次执行 `test:smoke` 与 `test:webview` 会下载 VS Code 和 Chromium；下载完成后后续运行会复用本地缓存。

## 证据与备注

本轮关键验证记录如下：

    $ npm run build
    ... exit 0

    $ npm run typecheck
    ... exit 0

    $ npm run test:smoke
    ...
    VS Code smoke test passed.

    $ npm run test:webview
    ...
    3 passed (4.0s)
    Playwright webview tests passed.

## 接口与依赖

本轮新增的开发依赖如下：

- `@vscode/test-electron`：启动真实 VS Code Electron 实例并加载扩展。
- `@playwright/test`：执行 Webview 浏览器交互与截图测试。

测试模式内部命令如下：

    devSessionCanvas.__test.getDebugState
    devSessionCanvas.__test.getHostMessages
    devSessionCanvas.__test.clearHostMessages
    devSessionCanvas.__test.waitForCanvasReady
    devSessionCanvas.__test.reloadPersistedState
    devSessionCanvas.__test.dispatchWebviewMessage
    devSessionCanvas.__test.createNode
    devSessionCanvas.__test.resetState

这些命令只在 `vscode.ExtensionMode.Test` 下注册，不暴露给普通用户界面。

最后更新说明：2026-04-06 先完成三层实现与自动化验证，随后依据 VS Code 官方 Profile / Remote Extensions 文档，把交互式 F5 从手工目录隔离切换为 Profile 版，并同步更新文档与技术债说明。
