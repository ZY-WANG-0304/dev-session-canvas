# 定位 smoke 重读画布后自启动超时

本 ExecPlan 按 `docs/PLANS.md` 持续维护。

## 目标与全局图景

解释 PR #313 的 VSIX smoke 为什么在 `verifyAutoStartOnCreate` 等不到 Agent live，区分测试夹具状态替换、真实扩展宿主生命周期和版本兼容。交付可复查的因果证据与修复范围建议；本轮不实施产品修复，不推进发布。

## 进度

- [x] (2026-10-09) 固定 main `78c58c2a` 和 PR #313 `aaeb73a0`，创建隔离工作树 `/tmp/dscr`。
- [x] 确认失败前的 `reloadPersistedStateForTest` 是同一个 manager 中替换状态，不是真实窗口 reload。
- [x] (2026-10-09) 原 trusted 前缀探针定位首次 sidebar seed：同一 running 执行 metadata 匹配 true→false。
- [x] (2026-10-09) 同版本原生 control、seed、reload、workspace-add 和结算后重读对照完成；产品 root 重映射出现额外 Agent。
- [x] (2026-10-09) 收口正式归因、遗留修复、实际探针 patch 与结构化证据；产品/正式测试源码恢复原样，定向 Host 7/7。
- [x] (2026-10-09) 调查材料形成独立文档变更，按仓库流程提交并交付审查；不合并或发布。

## 意外与发现

smoke 在节点尺寸持久化测试之前已通过 `setPersistedState` 反复替换整张画布，最早的污染可能早于最后一次重读。错误字符串本身不能证明最终保存未完成或旧版本兼容故障。原生 probe 显示同 ID 恢复被拒绝时 owner closing=false、原记录仍 running，保存尚未 submitted。真实添加 workspace root 会改变 node ID，使另一条 Agent 恢复绕过旧 key；试验 PID 2646744 前后未变。首次普通 folder 添加未收到事件，排除为无效输入，改用已保存 workspace 并等待事件后复现。模拟 reload 的首次 pending-save 拒绝被保留，等待真实保存后显式重试通过，不能将其写成单次成功。

## 决策记录

使用最新 main 调查：PR #313 仅有发布静态材料，产品和测试代码与该 main 相同。保留原工作树未提交改动。探针和对照可临时放在隔离树，结论必须区分真实原生运行与 fake transport 验证。最终保留临时 patch 作为复现输入，不把断言已知故障的实验并入正式测试。产品修复需另行设计身份迁移/结算规则，不能删除身份保护来使 smoke 通过。

## 结果与复盘

已证明原 smoke 在首次 sidebar seed 就失配，尺寸 reload 不是最早破坏点。真实 workspace root 变更在同 PID 下也失去旧执行绑定并创建额外 Agent，因此同时存在 smoke 隔离缺口与产品生命周期缺陷。当前单版本即可复现；没有完整升级矩阵结论。修复另行进行并已登记技术债；本轮没有通过或豁免 release gate。

## 上下文与定向

`tests/vscode-smoke/extension-tests.cjs` 的 `runTrustedSmoke` 先创建 Agent/Terminal，再运行 sidebar、Note、resize 用例，最后才检查自启动。`extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts` 持有画布 `state` 和 `nonNativeHostExecutions` 执行记录。执行记录内的 persistence 保存 metadata 对象引用，业务投影要求仍与当前节点引用相同。`reloadPersistedStateForTest` 与 `setPersistedStateForTest` 替换 state；另一个 `simulateRuntimeReloadForTest` 才调用宿主退出边界。`scripts/test/test-host-execution-owner-wiring.mjs` 可以加载真实 manager 和受控执行传输。

失败现场在 `/tmp/dev-session-canvas-clean-checkout-akdQNG/repo/.debug/vscode-vsix-smoke/smoke-runtime/artifacts`，完整日志 `/tmp/dsc261b-vsix.log`。原现场为全新 profile、单版本 0.26.1，Linux x64、VS Code 1.141.0、Electron 43.7.7。Node 22 工具在 `/tmp/dsc-release-node22/node_modules/node/bin`，原生资产在 `/tmp/dsc-release-026-assets`。执行实验使用短临时目录和 `umask 0077`，避免目录权限和 socket 路径引入其他失败。

## 工作计划与里程碑

第一里程碑读取现场并关联首次失配。第二里程碑在真实 manager 上比较不替换、活动期间整图替换、正式宿主边界；必要时用最小 VS Code 场景验证原生运行，保留输入和结构化输出。第三里程碑记录已证实根因、未覆盖范围和后续修复验收。正式结论写入 `docs/design-docs/smoke-reload-autostart-investigation.md` 并同步 index/core-beliefs；遗留修复记入 tech-debt。

## 具体步骤

在 `/tmp/dscr` 读取 `CanvasPanelManager.ts` 的 start、project、settle、retire 和测试状态入口，以及调用这些入口的 smoke 用例。复用现有 Host harness，以 `DEV_SESSION_CANVAS_HOST_TEST_FILTER` 选择受控实验；记录执行 key、metadata 引用匹配、保存状态、owner retirement 和错误。只在足够定位后运行最小原生 smoke，避免重跑整套发布门禁。

## 验证与验收

必须有实际失败链与至少一个反向对照，明确是测试入口还是用户可达路径。不能仅通过延长等待认定修复，不能以新 profile 验证宣称所有升级场景兼容。现有 Host 校验用于确保调查探针没有改变业务行为；调查产物本身不表示 release gate 通过。

## 幂等性与恢复

实验限定隔离 worktree 和私有临时数据；可以重复运行。保留失败日志，移除临时源代码探针后检查 git diff，不修改原工作树和 PR #313。

## 产物与备注

正式结论见 `docs/design-docs/smoke-reload-autostart-investigation.md`；可复现命令、实际探针和精简观测在 `docs/references/smoke-reload-autostart/`。原生日志在 `/tmp/dscr/.debug/rca`，定向无探针 Host 输出 `host-clean-focused.log` 为 7/7。完成实验后已恢复所有源码并保留原工作树。

## 接口与依赖

不新增正式产品接口；依赖现有 Host test harness、VS Code smoke runner 和本地诊断日志。若实验变动不适合正式测试，保留可审查的诊断脚本或精确 patch 与复现说明。
