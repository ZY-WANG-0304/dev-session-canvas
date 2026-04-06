# 把调试自动化的下一批 6 个高价值缺口压实

本 ExecPlan 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘` 这几个章节。

本文件已完成，归档于 `docs/exec-plans/completed/debug-automation-next-six.md`；在执行期间它一直按 `docs/PLANS.md` 的要求维护。

## 目标与全局图景

当前仓库已经有了真实 VS Code smoke、浏览器内 Webview 回归和基础失败产物，但还缺几条发布前真正值钱的验证：Restricted Mode、打包产物可启动、真实 Webview 容器里的实际交互、live session 在 surface 切换与 reload 下的稳定性、PTY 边界情况，以及更完整的失败诊断。完成本轮后，协作者应能直接运行自动化命令，看到这些场景已经被脚本化覆盖，而不是继续停留在人工试一下。

## 进度

- [x] (2026-04-06 21:10 +0800) 复读 `docs/WORKFLOW.md`、`docs/PLANS.md`、`docs/workflows/COMMIT.md`，并核对当前 smoke / Playwright / 打包脚手架。
- [x] (2026-04-06 21:18 +0800) 创建本 ExecPlan，并明确 6 条要收口的能力与预期验证入口。
- [x] (2026-04-06 21:24 +0800) 完成真实 VS Code smoke 的双场景结构：可信 workspace 主路径与真实 Restricted Mode 主路径。
- [x] (2026-04-06 21:29 +0800) 增加 Linux 打包产物 smoke，验证 VSIX 解包后的运行时内容可单独启动并通过 trusted smoke。
- [x] (2026-04-06 21:24 +0800) 给真实 VS Code Webview 容器增加一条实际 DOM 交互桥，并在 smoke 中验证 Task 状态更新。
- [x] (2026-04-06 21:24 +0800) 增加 live session 在 editor / panel 切换与 persisted reload 下的竞态回归。
- [x] (2026-04-06 21:24 +0800) 增加 PTY 大输出、显式非零退出、快速 stop/start、并发会话的稳定性回归。
- [x] (2026-04-06 21:26 +0800) 增强失败诊断：保留最后一次真实 Webview probe，以及 Playwright 失败时的 posted messages / persisted state。
- [x] (2026-04-06 21:30 +0800) 更新正式文档、技术债和本计划，并完成验证收口。

## 意外与发现

- 观察：`@vscode/test-electron` 默认会强制追加 `--disable-workspace-trust`，因此当前 smoke 即使没有显式传参，也无法进入真实 Restricted Mode。
  证据：`node_modules/@vscode/test-electron/out/runTest.js` 内部固定追加 `--disable-workspace-trust`；此前 smoke 日志也记录了该参数。

- 观察：当前仓库已有真实 Webview probe，但还没有“在真实 VS Code Webview 容器里触发一次 DOM 交互并让宿主状态变化”的测试桥。
  证据：`tests/vscode-smoke/extension-tests.cjs` 目前只用 `captureWebviewProbe` 做只读验证。

- 观察：restricted smoke 中原有的 `devSessionCanvas.__test.createNode` 仍然走了 trust gate，因此在真实 Restricted Mode 下不能种入 `Agent` / `Terminal` 节点做 overlay 与执行阻断验证。
  证据：初次回归时 `runRestrictedSmoke()` 在 `findNodeByKind(snapshot, 'agent')` 处失败；调用链为 `createNodeForTest()` -> `applyCreateNode()` -> `assertExecutionAllowed()`。

- 观察：`vsce package` 会因为当前仓库 README 中存在相对链接且仓库地址无法被自动识别，而直接拒绝打包。
  证据：首次运行 `npm run test:vsix-smoke` 报错 “Couldn't detect the repository where this extension is published. The link 'CONTRIBUTING.md' will be broken in README.md.”。

- 观察：Playwright harness 中 Note 正文编辑使用 `blur()` 提交在浏览器环境里不稳定，但显式走组件支持的 `Ctrl/Cmd+Enter` 提交流程后稳定通过。
  证据：`tests/playwright/webview-harness.spec.mjs` 首次失败时，失败产物中的 `harness-posted-messages.json` 只保留了旧内容；切换为快捷键提交后 `npm run test:webview` 全通过。

## 决策记录

- 决策：本轮继续复用现有 smoke 框架，但改为自建 VS Code launcher，而不是直接调用 `runTests()`。
  理由：只有这样才能去掉 `@vscode/test-electron` 内置的 `--disable-workspace-trust`，真正覆盖 Restricted Mode。
  日期/作者：2026-04-06 / Codex

- 决策：Linux 的“VSIX 安装态 smoke”先按“使用 VSIX 解包产物作为开发态扩展路径运行 smoke”收口，而不是额外引入一套 helper test extension。
  理由：当前最有价值的是验证打包产物是否带齐运行时文件；真正的安装 UI / helper extension 方案更重，收益暂时低于成本，文档中会明确这不是完整三平台发布矩阵。
  日期/作者：2026-04-06 / Codex

- 决策：restricted smoke 不再新增一条额外的 test-only 注入命令，而是把现有 `devSessionCanvas.__test.createNode` 明确收口为“仅测试模式下可绕过 trust gate 的节点注入入口”。
  理由：这样能复用既有测试命令 ID，缩小 API 面，同时保持真实 `webview/createDemoNode` 路径继续受限。
  日期/作者：2026-04-06 / Codex

- 决策：`scripts/package-vsix.mjs` 显式为 `vsce package` 提供 README base URL，并允许通过环境变量覆盖。
  理由：当前内网 GitLab 风格仓库地址无法被 `vsce` 自动识别；显式传参能让打包稳定成功，也为后续 GitHub 公开发布保留覆盖口。
  日期/作者：2026-04-06 / Codex

## 结果与复盘

本轮 6 条高价值缺口已经全部收口，实际落地产物如下：

1. `test:smoke` 现在通过自建 VS Code launcher 运行 `trusted` / `restricted` 两个真实场景，不再受 `@vscode/test-electron` 默认 `--disable-workspace-trust` 的限制。
2. `tests/vscode-smoke/extension-tests.cjs` 已覆盖真实 Webview DOM 交互、live session 切面 / reload 竞态、PTY 大输出 / 非零退出 / 快速 stop-start / 并发，以及 restricted overlay 与执行阻断。
3. `test:vsix-smoke` 已在 Linux 上打通：先打包 `.vsix`，再解包并用解包产物跑 trusted smoke，证明打包文件集可独立启动扩展。
4. Playwright 失败产物现在会额外保留 `harness-posted-messages.json` 与 `harness-persisted-state.json`，真实宿主 smoke 失败时也会保留最后一次真实 Webview probe。
5. 正式文档、设计结论和技术债都已同步；残余缺口明确保留为“真实安装态验证”和“macOS / Windows 发布矩阵”。

本轮最终验证记录：

    $ npm run typecheck
    ... exit 0

    $ npm run test:smoke
    Trusted workspace smoke passed.
    Restricted workspace smoke passed.
    VS Code smoke test passed.

    $ npm run test:webview
    7 passed
    Playwright webview tests passed.

    $ npm run test:vsix-smoke
    DONE  Packaged: .../dev-session-canvas-0.0.1.vsix
    VSIX packaged-payload smoke passed.

复盘：

- 真实 Restricted Mode 只有在完全控制 VS Code 启动参数时才有意义，因此第二层验证必须直接拥有 launcher 控制权。
- test-only 入口要么显式绕过宿主保护、要么显式复用真实路径，不能语义模糊；否则 smoke 很容易卡在“以为能造状态，实际被产品保护拦下”。
- 打包链路和运行链路要分开验证：`package:vsix` 本身成功并不代表打包产物真的可启动。

## 上下文与定向

本轮会同时改动四类文件。

第一类是 VS Code smoke 启动入口：`scripts/run-vscode-smoke.mjs` 当前负责准备隔离目录并调用 `@vscode/test-electron`；本轮需要让它支持可信 / Restricted 两种场景，并且能作为打包态 smoke 的底层能力复用。预计会新增一个 Linux 打包 smoke 入口，例如 `scripts/run-vscode-vsix-smoke.mjs`。

第二类是真实宿主测试本体：`tests/vscode-smoke/extension-tests.cjs` 当前已经覆盖打开画布、Webview ready、Agent / Terminal 基础执行、恢复、失败路径和 probe；本轮会继续扩到 Restricted Mode、真实 Webview DOM 动作、live session 切面、PTY 边界和失败诊断产物。

第三类是宿主与 Webview 之间的测试桥：`src/common/protocol.ts`、`src/common/extensionIdentity.ts`、`src/extension.ts`、`src/panel/CanvasPanelManager.ts` 和 `src/webview/main.tsx`。这里需要新增少量 test-only 消息或命令，让宿主能请求真实 Webview 执行一个确定的 DOM 动作，并把结果回流到测试。

第四类是正式文档：`CONTRIBUTING.md`、`docs/design-docs/development-debug-automation.md`、`docs/exec-plans/tech-debt-tracker.md`。这些文档必须明确区分日常默认验证、额外的打包 smoke，以及尚未做的跨平台矩阵。

这里的“Restricted Mode”指 VS Code Workspace Trust 关闭后的真实受限工作区，不是单纯通过测试 stub 伪造 `workspaceTrusted=false`。这里的“打包产物 smoke”指用 VSIX 内的实际文件集去启动扩展，而不是继续直接读工作树。

## 工作计划

先改 launcher。具体做法是把 `scripts/run-vscode-smoke.mjs` 从直接调用 `runTests()` 改成自行准备 VS Code 可执行文件与启动参数，这样就能显式控制是否带 `--disable-workspace-trust`，也能为 VSIX 解包 smoke 复用同一套底层逻辑。Restricted 场景需要额外写入用户设置，关闭启动 trust prompt，避免测试被 modal 阻塞。

然后扩展测试模式协议。宿主要新增一条“请求真实 Webview 执行动作”的桥，Webview 在收到测试动作后通过真实 DOM 事件去触发表单更新或按钮行为，再让宿主用现有状态流与消息流断言结果。与此同时，真实 Webview probe 需要在 smoke 失败时落盘。

接着扩展 `tests/vscode-smoke/extension-tests.cjs`。默认可信场景继续覆盖现有主路径，并增加 live session 切面 / reload、PTY 大输出 / 非零退出 / 并发 / 快速 stop-start。Restricted 场景单独断言：只能创建 Task / Note，Agent / Terminal 创建与运行都被阻止，并且真实容器里显示 Restricted Mode 文案。

最后增加 Linux 打包 smoke 脚本：先生成 VSIX，再解包到 `.debug/vscode-vsix-smoke/packaged-extension/`，用那份解包产物跑一遍 smoke，并在文档里明确这是“打包内容完整性验证”，不是未来发布时的三平台矩阵替代品。全部测试通过后，再更新正式文档、技术债、ExecPlan，并按 `docs/workflows/COMMIT.md` 做本地提交。

## 具体步骤

1. 改造 `scripts/run-vscode-smoke.mjs`，让它支持场景参数、用户设置注入和自定义启动参数。
2. 新增或抽取一层共享 launcher / runtime helper，供默认 smoke 与 VSIX smoke 复用。
3. 在协议和测试命令里补齐真实 Webview DOM action 桥。
4. 扩展 `tests/vscode-smoke/fixtures/fake-agent-provider` 与 `tests/vscode-smoke/extension-tests.cjs`。
5. 新增 Linux 打包 smoke 脚本与 `package.json` 入口。
6. 调整 Playwright harness 测试，在失败时写出 posted messages / persisted state。
7. 更新文档和技术债，运行验证，移动完成后的 ExecPlan。

## 验证与验收

完成后至少运行以下命令，并满足对应现象：

- `npm run typecheck`
  预期 TypeScript 无报错。

- `npm run test:smoke`
  预期可信 smoke 与 Restricted smoke 都通过；可信场景覆盖 live session / PTY 边界 / 真实容器交互，Restricted 场景覆盖受限模式行为。

- `npm run test:vsix-smoke`
  预期 Linux 上能成功打包 VSIX、解包并用打包内容跑通 smoke。

- `npm run test:webview`
  预期 Playwright 通过；若失败，`.debug/playwright/results/` 中除了原有截图 / trace，还应包含 posted messages 和 persisted state。

## 幂等性与恢复

- 所有测试运行时目录都应写入仓库内 `.debug/`，重复执行可安全覆盖。
- VSIX smoke 每次运行前应清理自己的 staging / unpack 目录，避免上一轮打包残留污染结果。
- Restricted Mode 如因设置或 prompt 行为失效，应优先让测试明确失败并留下日志，而不是静默回退到 trusted 场景。

## 证据与备注

本计划启动时，仓库已经具备以下基线能力：

    $ npm test
    ... exit 0

    $ npm run test:smoke
    ...
    VS Code smoke test passed.

这说明当前工作不是“从零搭脚手架”，而是在已有三层验证上继续压高质量门槛。

## 接口与依赖

本轮继续依赖以下组件：

- `@vscode/test-electron`：继续复用其 VS Code 下载与可执行文件解析能力，但不再直接使用默认 `runTests()` 的固定启动参数。
- `@playwright/test`：继续承担浏览器内 Webview 回归与失败产物输出。
- `node-pty`：继续承担 Agent / Terminal 执行后端；PTY 边界回归直接验证它在当前宿主里的行为。

新增的测试命令或测试协议必须继续遵守现有约束：只在 `vscode.ExtensionMode.Test` 下注册，不进入 `package.json` 的命令贡献区。

最后更新说明：2026-04-06 完成实现、验证与文档同步后，本计划移入 `completed/` 归档。
