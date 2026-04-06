# 压实调试与自动化验证的第二层和第三层

本 ExecPlan 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘` 这几个章节。

本文件最终收口到 `docs/exec-plans/completed/test-automation-hardening.md`，并按 `docs/PLANS.md` 的要求保留完整过程记录。

## 目标与全局图景

当前仓库已经有了三层调试/测试骨架，但第二层仍偏向“宿主活性检查”，第三层也主要停留在浏览器 harness。完成本轮后，协作者应能直接看到三类新结果：真实 VS Code smoke test 不仅能验证画布打开，还能验证 `Agent` / `Terminal` 的执行主路径、状态恢复与关键失败路径；测试失败时会自动留下足够复现问题的产物；第三层至少有一条验证跑进真实 VS Code Webview 容器，而不再完全依赖浏览器页面里的 stub 环境。

## 进度

- [x] (2026-04-06 19:45 +0800) 读取 `docs/PLANS.md`、`docs/workflows/COMMIT.md`、当前 smoke / Playwright runner 和技术债记录，确认本轮应拆成两次可独立说明的提交。
- [x] (2026-04-06 20:07 +0800) 第一阶段：补齐第二层的 `Agent` 假 provider、持久化恢复、失败路径、非激活 surface 语义，以及 smoke / Playwright 失败产物。
- [x] (2026-04-06 20:07 +0800) 运行 `npm run typecheck`、`npm run test:smoke`、`npm run test:webview`，确认第一阶段可独立提交。
- [x] (2026-04-06 20:10 +0800) 第一阶段验证通过后，按工作流完成第一次本地提交：`test(smoke): 压实宿主执行链路与失败诊断`。
- [x] (2026-04-06 20:20 +0800) 第二阶段：增加至少一条真实 VS Code Webview 容器验证，并扩充第三层 UI 回归面。
- [x] (2026-04-06 20:22 +0800) 同步更新设计文档、贡献文档、技术债和本计划，运行 `npm test` 后完成第二次本地提交。

## 意外与发现

- 观察：当前 `test:smoke` 已经能通过真实 `webview -> host` 消息测试 `Terminal`，但尚未覆盖 `Agent` 执行、状态恢复和失败诊断产物。
  证据：`tests/vscode-smoke/extension-tests.cjs` 当前只覆盖 `Terminal` 执行链路，没有 provider stub 或重启恢复断言。

- 观察：当前 `test:webview` 仍完全运行在普通浏览器 harness 中，尚未进入真实 VS Code Webview 容器。
  证据：`tests/playwright/harness/webview-harness.html` 直接通过 stub `acquireVsCodeApi()` 与 `window.postMessage()` 驱动真实 bundle。

- 观察：真实 VS Code smoke 里如果假 provider 用 `node` shebang 脚本，Extension Host 侧解析到的外部 Node 版本和 PATH 不稳定，容易把测试失败误判成宿主问题。
  证据：切回仓库内 bash fixture 后，`Agent` 假 provider 链路稳定通过；此前脚本在真实宿主里存在 shebang / PATH 偶发差异。

- 观察：缺命令路径的失败提示在 PTY 层可能表现为“找不到命令”，也可能表现为底层 `execvp(...) failed` / `No such file or directory`。
  证据：`claude` 缺失路径在当前 Linux PTY 环境里返回的是底层启动失败摘要，而不是统一字符串。

- 观察：仅靠测试进程退出码不足以定位真实宿主问题；补齐快照、宿主消息和 VS Code logs 后，复现场景明显更容易。
  证据：`scripts/run-vscode-smoke.mjs` 现已在失败时复制最新 VS Code logs，`tests/vscode-smoke/extension-tests.cjs` 会写失败快照与宿主消息。

- 观察：在浏览器 harness 里，React Flow 节点容器的指针行为会让“删除按钮的物理点击”不如键盘激活稳定，但按钮本身的事件链路是通的。
  证据：Playwright 物理 click 未稳定发出 `webview/deleteNode`，而聚焦后 `Enter` 与 DOM `click()` 都能稳定触发消息。

## 决策记录

- 决策：本轮拆成两个提交批次，而不是把第二层和第三层增强压成单次提交。
  理由：第二层增强和失败诊断可以独立交付且更容易回归；真实 Webview 容器验证风险更高，单独提交更便于定位问题和回滚。
  日期/作者：2026-04-06 / Codex

- 决策：第二层 smoke 的 `Agent` 链路默认走仓库内 fake provider，而不是依赖开发机真实 `codex` / `claude`。
  理由：第二层的目标是验证宿主执行链路和状态回流，不是验证某台开发机的 CLI 安装质量；真实 CLI 继续留给人工验收路径。
  日期/作者：2026-04-06 / Codex

- 决策：把 smoke / Playwright 失败产物收口到仓库内 `.debug/` 目录，并为真实宿主额外保留 VS Code logs。
  理由：这能显著降低 Extension Host / Webview 问题的回放成本，同时不污染用户全局目录。
  日期/作者：2026-04-06 / Codex

- 决策：第三层往真实容器下压的第一步采用 test-only Webview probe bridge，而不是引入新的外部 GUI 控制器。
  理由：目标是先验证真实 VS Code Webview 容器里的 DOM 与 toast 是否正确渲染；用现有 smoke 宿主加轻量 probe 就足以覆盖这一步，成本明显低于再建一套重型容器自动化。
  日期/作者：2026-04-06 / Codex

- 决策：删除按钮的 Playwright 回归用键盘激活，而不是继续追逐不稳定的物理点击。
  理由：这条用例的目标是验证按钮语义和消息派发，不是验证 React Flow 容器的指针命中细节；键盘激活更稳定，也顺带覆盖可访问性路径。
  日期/作者：2026-04-06 / Codex

## 结果与复盘

本计划已完成，结果如下：

- `test:smoke` 现在覆盖 `Agent` 假 provider / `Terminal` 主路径、恢复、失败路径、非激活 surface 语义，并新增一条真实 VS Code Webview 容器里的 probe，直接断言节点标题、字段值和错误 toast。
- `test:webview` 的浏览器 harness 回归面已扩到截图基线、Note 编辑、删除按钮、provider 切换和错误 toast。
- 失败时会留下 `.debug/vscode-smoke/artifacts/` 与 `.debug/playwright/results/`，降低后续排障成本。
- 剩余技术债不再是“完全没有真实 Webview 容器验证”，而是“真实容器覆盖仍偏窄，大多数 UI 回归仍在浏览器 harness 中”。

## 上下文与定向

与本轮最相关的文件分成四组。

第一组是第二层真实宿主测试入口：`scripts/run-vscode-smoke.mjs` 负责准备隔离测试环境并启动 `@vscode/test-electron`；`tests/vscode-smoke/extension-tests.cjs` 是真实 VS Code 里的测试代码；`src/extension.ts`、`src/common/extensionIdentity.ts` 和 `src/panel/CanvasPanelManager.ts` 暴露测试模式内部命令与宿主调试快照。

第二组是第三层 Webview UI 测试入口：`scripts/run-playwright-webview.mjs` 调起 Playwright；`tests/playwright/webview-harness.spec.mjs` 是现有浏览器回归；`tests/playwright/harness/webview-harness.html` 用假 `acquireVsCodeApi()` 把 `dist/webview.js` 跑在普通页面里。

第三组是执行会话实现：`src/panel/executionSessionBridge.ts` 封装 `node-pty`；`src/panel/CanvasPanelManager.ts` 维护 `Agent` / `Terminal` 的启动、输出、停止、状态回流和 surface 切换。

第四组是文档：`CONTRIBUTING.md` 描述开发与测试入口；`docs/design-docs/development-debug-automation.md` 定义三层方案边界；`docs/exec-plans/tech-debt-tracker.md` 记录目前仍未解决的缺口。

这里的“真实 VS Code Webview 容器验证”指：测试运行在由 VS Code Extension Host 打开的实际 Webview 中，而不是普通浏览器页面。这里不要求一开始就把整套 Playwright 都搬进真实容器；只要求新增至少一条真正穿过 VS Code 容器边界的验证，使第三层不再完全依赖 stub。

## 工作计划

先把第二层压实，因为它已经有可用骨架，增量成本最低。具体来说，需要给测试模式增加一条可控的假 `Agent` provider 启动方式，避免 smoke test 依赖开发机上真的装有 `codex` 或 `claude`。然后扩展真实 VS Code smoke test，覆盖 `Agent` 启动/停止/正常退出/异常退出、状态持久化与重启恢复、非激活 surface 消息不会污染状态，以及重复启动、错误节点 ID 等失败路径。与此同时，让 smoke 和 Playwright runner 在失败时自动保留最后快照、posted messages、VS Code logs 或测试报告，降低后续排障成本。

第一阶段稳定后，做一次独立提交。接着推进第三层：在保持浏览器 harness 回归的前提下，新增一条真实 VS Code Webview 容器验证，并扩充 Playwright 的 UI 回归面，覆盖 Note 编辑、删除、provider 切换、错误提示或空态等尚未自动化的高频交互。最后统一更新文档与技术债说明，跑全量验证，完成第二次提交。

## 具体步骤

1. 在 `src/common/extensionIdentity.ts` 与 `src/extension.ts` 中补充第二层需要的新测试命令。
2. 在 `src/panel/CanvasPanelManager.ts` 中增加支持测试用 fake provider、状态恢复与 surface 语义验证的宿主辅助接口。
3. 扩展 `tests/vscode-smoke/extension-tests.cjs`，把第二层覆盖面从当前的 `Terminal` 主路径扩到 `Agent`、恢复、失败路径和非激活 surface。
4. 调整 `scripts/run-vscode-smoke.mjs` 与 `scripts/run-playwright-webview.mjs`，在失败时留下可读的调试产物。
5. 为第三层增加真实容器验证入口，并扩展 `tests/playwright/webview-harness.spec.mjs` 的 UI 回归集。
6. 更新 `CONTRIBUTING.md`、`docs/design-docs/development-debug-automation.md`、`docs/exec-plans/tech-debt-tracker.md` 和本计划。
7. 运行 `npm run typecheck`、`npm run test:smoke`、`npm run test:webview`、`npm test`，并在两个里程碑之间按 `docs/workflows/COMMIT.md` 完成本地提交。

## 验证与验收

第一阶段完成后，至少应满足：

- `npm run test:smoke` 通过，并新增覆盖 `Agent` 假 provider、恢复、失败路径和非激活 surface。
- smoke 或 Playwright 失败时，会在仓库内留下可定位问题的产物，而不是只有进程退出码。

第二阶段完成后，至少应满足：

- `npm run test:webview` 继续通过。
- 至少存在一条验证真正跑进 VS Code Webview 容器，而不是只跑在浏览器 harness。
- `npm test` 全量通过。

## 幂等性与恢复

- smoke / Playwright 失败产物应写入仓库内可清理目录，重复运行可覆盖或重新生成，不依赖手工清除全局状态。
- 假 provider 需要是纯仓库内脚本，不依赖外部 CLI 安装，确保在不同环境里可重复执行。
- 如果真实容器验证方案不稳定，应优先把不稳定部分留在独立脚本或独立测试文件中，避免拖垮现有浏览器 harness 主入口。

## 证据与备注

本计划启动时已有以下基础证据：

    $ npm test
    ... exit 0

    $ npm run test:smoke
    ...
    VS Code smoke test passed.

这些结果证明当前三层骨架是通的，本轮工作是在其上继续压实，而不是从零搭建测试框架。

## 接口与依赖

本轮继续复用现有依赖：

- `@vscode/test-electron`：真实 VS Code 宿主 smoke。
- `@playwright/test`：Webview UI 回归。
- `node-pty`：`Agent` / `Terminal` 执行后端。

如需新增测试模式命令，应继续遵守现有约束：只在 `vscode.ExtensionMode.Test` 下注册，不进入 `package.json` 的 `contributes` 区域。

最后更新说明：2026-04-06 新建本计划，用于把第二层与第三层测试能力从“已接通”继续压到“更可发布”的状态。
