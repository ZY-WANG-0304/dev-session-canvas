---
title: 开发调试与自动化验证
decision_status: 已选定
validation_status: 已验证
domains:
  - VSCode 集成域
  - 画布交互域
  - 项目状态域
architecture_layers:
  - 宿主集成层
  - 画布呈现层
  - 共享模型与编排层
related_specs: []
related_plans:
  - docs/exec-plans/completed/extension-debug-automation.md
  - docs/exec-plans/completed/test-automation-hardening.md
  - docs/exec-plans/completed/debug-automation-next-six.md
  - docs/exec-plans/completed/remote-ssh-runtime-persistence-automation.md
updated_at: 2026-06-08
---

# 开发调试与自动化验证

## 1. 背景

当前仓库的开发体验有两个直接阻塞：

1. 本机一旦安装了当前扩展包，仓库自带的 `Run and Debug` 很容易和已安装版本混在一起，导致开发宿主不再是一个干净、可预测的环境。
2. 仓库只有 `build` / `typecheck` / `package` 一类静态或构建验证，还没有一条“真的启动 VS Code 扩展并验证主路径”的自动化链路，因此每次宿主与 Webview 的联调都要依赖人工点击。

这两个问题叠加后，结果就是调试环境不可重复、自动化验证不足、代理无法独立推进真正的扩展级调试。

## 2. 问题定义

本轮需要同时回答三个问题：

1. 如何让 `Run Dev Session Canvas (Main Only)` 启动的开发宿主与本机用户目录、已安装扩展完全隔离。
2. 如何给扩展补上一条可脚本化的真实 VS Code smoke test，至少覆盖激活、打开画布、Webview ready 和宿主状态流转。
3. 如何在不把整个 VS Code Workbench 一起拉进来的前提下，对 Webview 自身的 UI、交互和截图做自动化回归。

## 3. 目标

- 让 `Run Dev Session Canvas (Main Only)` 默认启动隔离的 Extension Development Host。
- 让仓库具备一条可在命令行中执行的 VS Code 扩展 smoke test。
- 让 Webview UI 可以脱离真实 VS Code 壳子，在浏览器中跑交互与截图自动化。
- 让开发入口、测试入口和文档说明保持一致，减少“知道怎么做”的隐性知识。

## 4. 非目标

- 不在本轮引入覆盖整个 VS Code Workbench 的重型像素级自动化。
- 不在本轮把所有前端状态管理都重构为纯组件测试架构。
- 不把 Playwright 结果写成“完全等价于真实 VS Code 集成验证”；它只覆盖 Webview 侧。

## 5. 候选方案

### 5.1 继续依赖人工调试

优点：

- 不需要新增脚本和测试基础设施。

问题：

- 无法解决本机已安装扩展污染开发宿主的问题。
- 代理仍然无法独立推进真实调试与验证。
- 每次回归都要重复人工点选，成本持续累积。

### 5.2 只补一条真实 VS Code smoke test

优点：

- 能解决宿主级自动化缺失。

问题：

- 不能很好覆盖 Webview 内部 DOM、表单交互和截图回归。
- 后续 UI 回归仍只能靠人工观察。

### 5.3 只补 Playwright

优点：

- 适合 Webview 自身的 UI、交互和截图验证。

问题：

- 不能替代真实 VS Code 扩展集成验证。
- 测不到扩展激活、命令注册、`WebviewPanel` / `WebviewView` 生命周期和宿主消息桥接的真实闭环。

### 5.4 三层方案

第一层：隔离式 `Run and Debug` 改为走 VS Code 官方推荐的命名 profile。`Run Dev Session Canvas (Main Only)` 固定使用 `Dev Session Canvas Extension Debug` profile，并在启动前生成一份去掉 `extensionDependencies` / `extensionPack` 的 debug-only 临时主扩展目录，再把这份目录作为唯一 `--extensionDevelopmentPath` 加载。这样可以在保留正式安装真相“主扩展 `extensionPack` 聚合 notifier + notifier 单向 `extensionDependencies` 回补主扩展”不变的前提下，继续在 local / remote 环境单独调主扩展，而不是为了 F5 改写正式 manifest 或把 notifier 的安装期语义混入开发宿主。若要联调真实 notifier，则改用 `Run Dev Session Canvas + Notifier (Local Window)` 或 `Run Dev Session Canvas + Notifier (Remote Window)`；Remote-SSH 等远程能力则由对应 debug profile 预先安装的 `Remote Development` 扩展提供，而不是继续手工改写 `user-data-dir`、`extensions-dir` 或远端工作区身份。

第二层：继续复用 `@vscode/test-electron` 提供的 VS Code 下载与可执行文件解析能力，但 smoke 启动改为自建 launcher，直接启动 VS Code，而不是调用默认 `runTests()`。这样才能真正控制 `--disable-workspace-trust` 参数，覆盖可信 workspace 与真实 Restricted Mode 两种场景。第二层继续承担宿主主路径、`webview -> host` 消息桥接、`Agent` 假 provider / `Terminal` 执行生命周期、状态持久化恢复、关键失败路径、切面 / reload 竞态和非激活 surface 语义，并额外通过 test-only probe 与 test-only DOM action 桥读取真实 Webview 容器里的 DOM 摘要和一条真实交互。当前第二层还新增了一条 `Remote-SSH + Extension Development Host + real-reopen` smoke：runner 会在 Linux 上启动临时用户态 `sshd`，让 `Remote-SSH` 扩展通过真实 SSH 协议连接同机远端，从而把 runtime persistence 的远端重连链路纳入自动化。

第三层：使用 Playwright 直接加载真实 `dist/webview.js` bundle，并通过假 `acquireVsCodeApi()` bridge 驱动 Webview，承担大范围 UI 交互与截图测试；与此同时，保留一条跑进真实 VS Code Webview 容器的轻量 probe 和一条真实 DOM action，补足“完全停留在浏览器 stub 页面里”的缺口。

结论：选择三层方案。这样每一层都只承担自己最擅长的验证范围，不把任何单一工具硬拉成“万能测试框架”。

## 6. 风险与取舍

- 取舍：VS Code smoke test 继续聚焦宿主主路径、消息桥接、执行会话和恢复语义，不追求把所有节点表单细节或视觉断言都搬进真实宿主里。
  原因：真实宿主测试的成本和脆弱性都更高，应该优先验证“扩展活着、消息能通、执行会话能跑、重开后状态不坏”。

- 取舍：Webview UI 测试直接吃现有 bundle，并在浏览器里 stub `acquireVsCodeApi()`。
  原因：这能最大程度复用真实前端代码，同时避免为了测试再造一套平行的假页面实现。

- 风险：大多数 Webview UI 回归仍运行在浏览器 harness 中，而不是真实 VS Code Webview 容器。
  当前缓解：保留 Playwright harness 做大范围交互回归，同时在真实宿主 smoke 中增加 test-only DOM probe，至少覆盖真实容器里的节点渲染与错误提示。

- 风险：`Agent` 真实 CLI 在不同开发机上的命令路径和 PATH 解析不稳定，直接拿本机安装做 smoke test 容易把宿主集成问题和环境偶然性混在一起。
  当前缓解：第二层 smoke 默认使用仓库内 fake provider fixture 验证执行链路，同时单独保留真实 CLI 的人工验收路径。

- 风险：`Remote - SSH` 一类 UI 扩展运行在本机客户端，如果 F5 继续直接操控 `extensions-dir`、`user-data-dir`、本地环境变量或远端工作区标识，就很容易把官方默认的 Remote 行为一起打坏。
  当前缓解：F5 收敛到官方 Profile 模型，只固定 profile 名称和开发态扩展路径；Remote 相关扩展与设置由 profile 自己承载，不再在仓库里手工拼装一套近似环境。

- 风险：专用 debug profile 第一次需要在本机 UI 侧完成准备，远端仓库任务无法直接替用户修改本机 profile。
  当前缓解：文档提供一次性的本机 CLI / GUI 准备步骤，并把“当前扩展不要装进 debug profile”写成显式约束。

- 风险：Linux headless 环境启动 VS Code 需要图形后端。
  当前缓解：VS Code smoke runner 在无显示环境下自动走 `xvfb-run`。

- 风险：大多数 Webview UI 回归当前仍不运行在真实 VS Code Webview 容器里。
  当前缓解：保留真实 VS Code smoke test 承担宿主级闭环验证，并新增真实容器 probe 与一条真实 DOM 交互；更深的容器差异继续登记为技术债。

- 风险：当前 Linux `VSIX` smoke 验证的是“VSIX 解包产物能否独立启动并通过 trusted smoke”，不是用户真实安装态或未来 GitHub 开源发布前的三平台矩阵。
  当前缓解：新增 `test:vsix-smoke` 先验证打包内容完整性，并把完整安装矩阵和三平台发布验证继续登记为技术债。

## 7. 正式方案

### 7.1 方案说明

当前正式调试与验证方案分成三层，并分别落在固定入口上：

- `.vscode/launch.json` 与 `.vscode/tasks.json`：只保留三条默认调试路径，即 `Run Dev Session Canvas (Main Only)`、`Run Dev Session Canvas + Notifier (Local Window)`、`Run Dev Session Canvas + Notifier (Remote Window)`；其中主扩展单调与 notifier 联调不再共用模糊入口。
- `scripts/shared/prepare-debug-main-only-extension.mjs`：在 `Run Dev Session Canvas (Main Only)` 启动前生成 `.debug/vscode-extension-main-only/`，把仓库根主扩展复制成一份 debug-only 临时目录，保留运行时需要的 `scripts/runtime/claude-file-event-hook.cjs`，并仅在这份临时 manifest 里移除 `extensionDependencies` / `extensionPack`，从而在保留正式安装真相不变的前提下维持主扩展单调能力。
- `scripts/smoke/run-vscode-smoke.mjs` 与 `tests/vscode-smoke/extension-tests.cjs`：承担真实 VS Code 宿主级自动化，覆盖扩展激活、Webview ready、`webview/*` 消息桥接、执行会话、runtime persistence、Restricted Mode、真实 Webview probe 与 test-only DOM action。
- `scripts/smoke/run-vscode-vsix-smoke.mjs`：先打包 `.vsix`，再解包并用打包产物跑 trusted smoke，用来验证 VSIX 运行时文件集和最小集成链路。
- `scripts/test/run-playwright-webview.mjs`、`tests/playwright/webview-harness.spec.mjs` 与 `tests/playwright/harness/webview-harness.html`：承担 Webview 专项 UI / 截图自动化，覆盖截图基线、Note 编辑、删除按钮、Agent 启动 provider 取自节点 metadata，以及错误 toast。

### 7.2 适用范围与边界

- 本方案定义的是“仓库源码开发态”的 F5 入口、repo-local 自动化验证和打包产物最小闭环，不等同于 Marketplace 正式安装矩阵或发布后用户态运维方案。
- `test:smoke` 覆盖真实 VS Code Development Host 与远端 runtime persistence 主路径；`test:webview` 只覆盖 Webview bundle 自身的交互与截图，不替代宿主级验证。
- `test:vsix-smoke` 验证的是“当前 VSIX 打包产物是否能独立启动并通过 trusted smoke”，不是三平台真实安装、升级、卸载或 Marketplace 分发闭环。
- `Remote - SSH` 下的 F5 仍要求先在本机 UI 侧准备好专用 debug profile；远端 notifier 联调则额外要求提供本机 `localRepoRoot`，用于注入 UI-side notifier 源码目录。

### 7.3 核心规则与不变量

- 正式 `package.json` 继续作为发布态单一真相；任何去掉 `extensionDependencies` / `extensionPack` 的动作都只能发生在 `.debug/vscode-extension-main-only/` 或 staged 测试副本，不能反向污染仓库根 manifest。
- 默认调试入口固定收口为三条 launch 配置；其中 `Run Dev Session Canvas (Main Only)` 必须保持零 notifier 输入，`Run Dev Session Canvas + Notifier (Remote Window)` 必须只额外要求 `localRepoRoot` 这一项输入。
- 真实宿主 smoke 与 Playwright harness 分工固定：前者负责集成闭环与运行时语义，后者负责 Webview UI / 截图回归；两者互补，不能互相宣称覆盖对方的验证范围。
- 宿主侧 test-only 能力只在 `ExtensionMode.Test` 或约定测试 harness 下暴露，用于读取状态、等待 ready、派发消息和采集 probe；发布态与日常 F5 不应把这些命令当成产品接口。
- smoke / Playwright 失败时必须留下可追溯调试产物，包括真实 Webview probe、宿主消息、宿主诊断时间线、VS Code logs、截图与 trace；Remote-SSH real-reopen 产物需继续独立落到 `.debug/vscode-smoke/remote-ssh-real-reopen/artifacts/`，避免与本地场景混淆。
- trusted / restricted smoke 中的子流程如果显式打开、切换或销毁主画布 surface，必须在返回前恢复调用方期望的 surface，或让后续 probe / DOM action 显式传入当前 surface；不能依赖测试顺序里的隐式 active surface。默认无参的真实 Webview probe 只表示 editor surface，因此新增场景若可能把主画布切到 panel，必须调用 `ensureEditorCanvasReady()` 复位或改用 `waitForWebviewProbeOnSurface(surface, ...)`。

## 8. 验证方法

完成后至少要满足以下验证：

1. `npm run build`
2. `npm run test:smoke`
3. `npm run test:webview`
4. `npm run test:vsix-smoke`
5. 在本机预先准备好 `Dev Session Canvas Extension Debug` profile，并在 `Remote - SSH` 打开的仓库窗口中按 `F5` 启动 `Run Dev Session Canvas (Main Only)`，确认 Development Host 能正常打开远程窗口并打开画布

验收口径：

- `Run Dev Session Canvas (Main Only)` 的启动参数明确固定 profile 名称，不再通过重写 `user-data-dir`、`extensions-dir`、隔离整个本地 SSH 环境或复用原始远端工作区锁来破坏调试。
- notifier companion 落地后的调试入口收敛为三类：本地 / 远端只调主扩展统一走 `Run Dev Session Canvas (Main Only)`，本地联调走 `Run Dev Session Canvas + Notifier (Local Window)`，远端联调走 `Run Dev Session Canvas + Notifier (Remote Window)`。
- VS Code smoke test 能自动完成扩展激活、打开画布、等待 Webview ready、`webview -> host` 创建/更新/移动/删除/reset 消息，以及 `Agent` 假 provider / `Terminal` 的启动、输入、resize、停止、失败路径、持久化恢复、live session 切面 / reload、非激活 surface 语义、真实 Restricted Mode 行为、多条真实 Webview 容器交互和至少两类生命周期 fault injection。
- `test:vsix-smoke` 能成功打包 VSIX、解包并用打包内容跑通 trusted smoke。
- Playwright 能加载 Webview harness，并覆盖至少一张基线截图、Note 编辑、删除按钮、Agent 启动 provider 取自节点 metadata，以及错误 toast。
- smoke 或 Playwright 失败时，仓库内会留下可回放的调试产物，而不是只有进程退出码。
- `Remote - SSH` 下的 F5 调试配置继续保留一条人工验收，并明确把“一次性准备本机 debug profile”当作前置条件写入文档；但远端 runtime persistence 主路径本身已经进入 `test:smoke` 自动化。
