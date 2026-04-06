# 技术债追踪

本文件用于记录复杂任务完成后遗留、但当前不阻塞交付的问题。

## 记录字段

- 日期
- 主题
- 背景与触发条件
- 影响范围
- 当前临时处理
- 建议修复时机
- 关联文档或代码路径

## 技术债列表

| 日期 | 主题 | 背景与触发条件 | 影响范围 | 当前临时处理 | 建议修复时机 | 关联文档或代码路径 |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-04-06 | Linux `VSIX` smoke 当前只验证“打包内容完整性”，还不是完整安装态 | 为了先把打包产物是否可启动这条验证链落地，本轮的 `test:vsix-smoke` 采用“生成 VSIX -> 解包 -> 用解包产物跑 trusted smoke”的方式；它验证的是打包文件集是否齐全，而不是 `code --install-extension` 后的完整安装态。 | 发布工件验证的覆盖面，尤其是 VS Code 扩展安装流程、升级覆盖与安装后元数据行为 | 当前明确把它写成 packaged-payload smoke，不把这条验证包装成完整安装矩阵。 | 下一轮如果要在发布前收口真实安装态验证时 | `scripts/run-vscode-vsix-smoke.mjs`、`scripts/package-vsix.mjs`、`CONTRIBUTING.md`、`docs/design-docs/development-debug-automation.md` |
| 2026-04-06 | 自动化验证矩阵当前仍主要停留在 Linux，本轮未跑 macOS / Windows | 用户已明确把三平台矩阵延后到准备开源发布到 GitHub 时再做；本轮优先完成 Linux 上最值钱的 trusted / restricted smoke、Playwright UI 回归和 packaged-payload smoke。 | 发布前的平台可用性声明，尤其是 macOS / Windows 上的 PTY、Webview 容器行为和 VSIX 安装态 | 当前把三平台矩阵留作显式技术债，不把 Linux 验证写成全平台结论。 | 准备公开 GitHub 发布前，或需要做正式三平台发布验收时 | `tests/vscode-smoke/extension-tests.cjs`、`scripts/run-vscode-smoke.mjs`、`scripts/run-vscode-vsix-smoke.mjs`、`docs/design-docs/development-debug-automation.md` |
| 2026-04-06 | Remote-SSH 下的 debug profile 首次仍需本机人工准备 | 按 VS Code 官方设计，Remote 扩展调试应使用预装了 Remote Development 扩展的命名 profile；但当前仓库运行在远端，无法直接替用户修改本机 VS Code profile。 | 新机器或新环境第一次做 F5 调试时的初始化成本 | 当前在 `CONTRIBUTING.md` 中明确提供本机 CLI / GUI 的一次性准备步骤，并把 `Dev Session Canvas` 不应安装到 debug profile 写成显式约束。 | 如果后续找到稳定、官方支持的本机 profile 导入或预配链路时 | `CONTRIBUTING.md`、`.vscode/launch.json`、`docs/design-docs/development-debug-automation.md`、`docs/exec-plans/completed/extension-debug-automation.md` |
| 2026-04-06 | Webview UI 回归仍主要运行在浏览器 harness，真实容器覆盖面偏窄 | 为了把第三层先往真实 VS Code Webview 容器下压一格，本轮已经在 `@vscode/test-electron` smoke 中加入 test-only DOM probe；后续又补了真实容器里的 Note 编辑、provider 切换后重启、删除按钮，以及 pending request / stop 竞态 fault injection，但大多数 UI 回归仍由浏览器 harness 承担，而不是真实容器里的端到端交互。 | Webview UI 对真实容器特性的依赖，例如 CSP、容器级样式差异、真实宿主注入环境、指针命中细节与少量可访问性行为 | 当前用真实宿主 smoke 中的 probe 与 DOM action 覆盖节点渲染、Task/Note 写路径、provider 切换、删除按钮和两条生命周期 fault injection，并让 Playwright harness 继续承担截图基线、更多细粒度 UI 交互和页面级失败诊断；不把这套组合写成“已完全等价于真实容器 UI 自动化”。 | 下一轮如果要覆盖更深的 Webview 容器差异、复杂指针交互或发布前做 UI 风险收口时 | `src/common/protocol.ts`、`src/panel/CanvasPanelManager.ts`、`src/webview/main.tsx`、`tests/playwright/harness/webview-harness.html`、`tests/playwright/webview-harness.spec.mjs`、`tests/vscode-smoke/extension-tests.cjs`、`docs/design-docs/development-debug-automation.md`、`docs/exec-plans/completed/test-automation-hardening.md` |
| 2026-03-30 | 新建节点避碰当前依赖默认窗口尺寸估算 | 为先修复“新增节点初始重叠”的真实反馈，本轮宿主使用 `Agent` / `Terminal` / `Task` / `Note` 的默认窗口尺寸估算做矩形碰撞判断，而不是读取节点渲染后的真实边界。 | 新建节点默认摆放的精确性，尤其在后续调整节点样式、高度或字段密度后 | 当前让 Webview 提供当前视口锚点，宿主再基于统一尺寸估算做避碰；足以解决当前反馈中的初始遮挡，但不把它写成完整自动布局系统。 | 下一轮画布布局或节点尺寸模型收口时 | `src/common/protocol.ts`、`src/panel/CanvasPanelManager.ts`、`src/webview/main.tsx`、`docs/design-docs/canvas-feedback-polish.md`、`docs/exec-plans/completed/canvas-feedback-polish.md` |
| 2026-03-30 | 节点删除当前不支持确认或撤销 | 为先闭合四类节点的最小删除主路径，本轮直接提供节点头部删除按钮和键盘删除，但没有确认弹窗、撤销栈或回收站。 | 误删节点后的恢复体验，尤其影响包含正文的 `Task` / `Note` 和运行中的执行型节点 | 当前通过显式选中态、输入焦点保护、危险态按钮样式和单节点删除范围降低误触风险，不把确认/撤销写成已支持。 | 下一轮画布交互增强或对象历史能力设计时 | `src/webview/main.tsx`、`src/webview/styles.css`、`docs/design-docs/canvas-node-deletion.md` |
| 2026-03-30 | `node-pty` 后端仍缺 macOS / Windows / Remote 场景人工验证 | 为了把执行会话从 Linux 原型收口到统一 PTY 路线，本轮已把宿主切到 `node-pty`，并去掉了 Linux 平台硬拦截。代码路径已接通，但当前只有 Linux 构建与 PTY smoke test 证据。 | macOS、Windows、Remote SSH / Codespaces 下的 `Terminal` / `Agent` 可用性声明 | 当前只把 Linux smoke test 与构建结果写成已完成，其余平台继续标记为“验证中”。 | 下一轮平台验证与发布前人工验收时 | `src/panel/CanvasPanelManager.ts`、`src/panel/executionSessionBridge.ts`、`src/webview/main.tsx`、`docs/design-docs/execution-session-platform-compatibility.md` |
| 2026-03-30 | Windows 下 provider CLI 命令解析仍依赖显式命令路径验证 | `Agent` 节点当前直接以配置项中的命令路径启动 `codex` / `claude`；在 Windows 上，这可能涉及 `.cmd` / `.exe` 包装与 PATH 差异。 | Windows 下 `Agent` 节点的启动成功率与默认配置体验 | 当前继续保留设置项覆盖命令路径，并在缺命令时给出更明确的提示，不把默认 PATH 解析写成已验证。 | 下一轮 Windows 人工 smoke test 或命令解析增强时 | `src/panel/CanvasPanelManager.ts`、`docs/design-docs/execution-session-platform-compatibility.md` |
| 2026-03-30 | VSIX 当前会打入超出运行时必需范围的 `node-pty` 文件 | 为了先保证扩展可打包并带上原生 PTY 运行时，本轮通过 `.vscodeignore` 允许 `node-pty` 进入 VSIX；但当前产物仍包含 `deps/`、`build/` 元数据和部分非运行时文件。 | 扩展包体积、发布工件可审查性，以及后续发布时的冗余依赖面 | 当前优先保证 VSIX 可成功生成和运行时文件可用，把“进一步收紧到最小必需集”留作后续收口。 | 下一轮发布前瘦身或引入专门打包 staging 流程时 | `.vscodeignore`、`package.json`、`scripts/build.mjs`、`docs/exec-plans/completed/execution-session-platform-compatibility.md` |
