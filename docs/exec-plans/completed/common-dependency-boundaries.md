# 收口共享层依赖方向

本 `ExecPlan` 是活文档，遵循 `docs/PLANS.md`。本计划只处理 F-02 已确认的共享层依赖漂移，不重新设计 Host、Webview 或 Supervisor 的运行时职责。

## 目标与全局图景

完成后，`extensions/vscode/dev-session-canvas/src/common/` 可以继续作为 Host、Webview 和 Supervisor 共同消费的契约层：纯的执行启动描述不再从 Host 适配器反向导入；依赖 VS Code 运行时的 URI 和测试模式 helper 明确位于 Host 的 `panel/` 目录。新增的静态测试会在普通 `npm test` 中阻止这些依赖再次回流。

## 进度

- [x] (2026-10-09) 从最新 `origin/main` 建立 `common-dependency-boundaries` 分支并完成 F-02 依赖审计。
- [x] (2026-10-09) 将 `ExecutionSessionLaunchSpec` 移到 `src/common/`，更新协议、Host 和 node-pty 适配器的直接导入。
- [x] (2026-10-09) 将主扩展的 `webviewResourceUri` 与 `testHarness` 移到 Host `panel/` 目录，并为独立 notifier extension 保留同语义的本地 Host helper。
- [x] (2026-10-09) 增加 TypeScript AST 共享层依赖守卫，并接入普通测试入口。
- [x] (2026-10-09) 运行类型检查、构建和受影响的协议/Host/执行桥测试，更新设计与技术债记录。

## 意外与发现

- 目前唯一的 `common -> panel` 是 `runtimeSupervisorProtocol.ts` 对启动类型的 type-only 导入；它没有运行时副作用，但仍违反共享契约层的依赖方向。
- `webviewResourceUri.ts` 和主扩展的 `testHarness.ts` 当前只由 Extension Host/sidebar 使用，未进入 Webview 或 Supervisor bundle；notifier 是独立 Host extension，因此在自身 `src/testHarness.ts` 保留同语义实现，避免跨扩展反向依赖。
- `runtimeSupervisorMain.ts` 对 `panel/executionSessionBridge` 的 node-pty 依赖属于现有 Supervisor 适配链，不是本轮 `src/common` 边界问题；本计划不搬迁整个执行后端。

## 决策记录

- 决策：新建 `src/common/executionSessionLaunchSpec.ts` 保存 `ExecutionSessionLaunchSpec`，保留 `env: NodeJS.ProcessEnv` 以维持 node-pty 和现有调用者的类型语义。
  理由：该结构只描述可序列化的启动参数，且协议序列化已经在 `runtimeSupervisorProtocol.ts` 中完成；独立模块避免把 Host 适配器带入共享协议。
  日期/作者：2026-10-09 / Codex。
- 决策：把两个 VS Code 绑定 helper 放到 `src/panel/`，不保留 common 路径兼容 re-export。
  理由：调用者全部是 Host/sidebar，直接导入能让目录契约真实反映运行时依赖，且不增加第二套 API。
  日期/作者：2026-10-09 / Codex。
- 决策：notifier extension 使用 `extensions/vscode/dev-session-canvas-notifier/src/testHarness.ts`，不直接依赖主扩展的 Host 目录。
  理由：两个扩展是独立打包单元；复制 VS Code 绑定判断比建立跨扩展运行时依赖更小、更明确，并保持原测试模式语义。
  日期/作者：2026-10-09 / Codex。
- 决策：静态守卫只检查 `src/common` 内的静态 import/export、`require()`、动态 `import()` 和 `import()` 类型字面量；禁止 VS Code、React、node-pty 以及 common 之外的仓库相对模块。
  理由：覆盖 type-only 和 re-export 等容易漏检的语法，同时避免把动态变量或完整循环依赖分析引入本次小范围任务。
  日期/作者：2026-10-09 / Codex。

## 结果与复盘

已完成最小收口：`ExecutionSessionLaunchSpec` 现在由 `common` 定义，主扩展的 VS Code 绑定 helper 位于 `panel/`，notifier 保持独立 Host helper；所有生产调用者已改为直接导入新位置，没有兼容 re-export。AST 守卫覆盖普通 import、type-only import、re-export、`require()`、`import()`、`import()` 类型和 `import = require()`，当前 38 个 common 源文件无违规。

验证结果：`npm run test:common-dependencies`、主扩展和 notifier typecheck、`npm run build`、`npm run test:runtime-supervisor-protocol`、`npm run test:execution-session-bridge`、`npm run test:notifier-source`、`npm run test:protocol-webview-messages`、`npm run test:ui-copy-localization` 以及 `git diff --check` 均通过。未新增真实 Agent、跨平台或 Runtime 诊断矩阵，因为本次只改变模块位置和静态依赖边界；F-02 技术债待本分支合并后关闭。

## 验证方式

从仓库根目录运行 `npm run test:common-dependencies`、`npm run typecheck`、`npm run typecheck:notifier`、`npm run build`、`npm run test:runtime-supervisor-protocol`、`npm run test:execution-session-bridge`、`npm run test:notifier-source`、`npm run test:ui-copy-localization`，并执行 `git diff --check`。本计划不新增原生 Agent、跨平台或 Runtime 诊断矩阵。
