---
title: PR327 packaged trusted 最终保存 pending 调查
decision_status: 比较中
validation_status: 验证中
domains: [执行编排域, 项目状态域, VSCode 集成域]
architecture_layers: [宿主集成层, 适配与基础设施层]
related_specs: [docs/product-specs/runtime-persistence-modes.md]
related_plans: [docs/exec-plans/active/local-final-snapshot-boundary-investigation.md]
updated_at: 2026-10-15
---

# PR327 packaged trusted 最终保存 pending 调查

## 原失败与证据范围

正式 run38579057915 固定预合并9f602fed（main eee25291、PR327 head20d237c5），Node22、Ubuntu22.04、VS Code1.141.2。最后 trusted 于2026-10-14T14:54:22Z对agent-1-94167e82-7759-4f0b-921b-c1311ad654ce报 `Local final snapshot persistence is pending`。原完整日志19,107,699 bytes，SHA256 a9d2ec25106a259c55e576a955238da9d2b6326172af3e7b7a72f377ec4fee51，位于 `/tmp/pr327-after333-gate/verify-full.log`。workflow未上传该runner失败现场，原具体调用与保存后续结果尚未从现场证实。

## 已确认机制与旧策略

`CanvasPanelManager.ts::closeNonNativeHostExecutions` 等owner settled后，默认立即执行 `assertNonNativeHostPersistenceComplete`。资源结束不涵盖最终保存Promise；提交保存后仍可以未登记saved。原错误没有进入20秒保存等待，故不是等待耗尽。正式设计 `runtime-exit-integrity-production-integration.md` §26.3选择reset/清组/模板pending时拒绝，保存完成后允许新的操作。单节点删除为显式等待例外。`reset-canvas.cjs` 为四个smoke清理入口适配此契约，不涵盖所有直接reset。

## 当前结论与待验证项

真实Host及正式持久化8项受控验证（Agent/Terminal × 即时检查/等待对照 × saved/failed）捕获预期结果：暂扣原workspaceState.update后owner已settled/retired、submitted=true、result未登记；原reset提前拒绝保留节点。释放后saved不续行原reset，显式第二次可清空；failed保留节点。等待对照仅启用既有等待，成功才清空，失败仍拒绝。脚本 `docs/references/local-final-snapshot-boundary/host-investigation.mjs`，日志 `/tmp/persist-rca-host.log`。这证明机制，尚未证明原门禁具名触发点。

本地生产bundle、发布manifest、原suite加观察钩子，以VS Code1.141.0运行trusted整套通过。模板五次reset没有owned records，未复现首败，不能将模板cleanup推测定为根因。本轮重建bundle不声称是原CI VSIX字节。

## 下一受控验证

临时分支无PR，Ubuntu22.04从原发布head重建正常VSIX，复用原run的同输入六资产，执行原trusted。仅为直接reset增加调用位置与原执行/保存观察；失败后有界观察原保存，不重试reset、不改保存检查。实际VS Code版本单独登记。完整失败保持，不追加无界重跑。

## 修复边界

当前未修改产品或保存策略，不创建独立诊断/文档PR，不修改发布PR head。后续授权修复随测试与根因文档集中一个修复PR；是否需改测试或产品必须以具名调用与保存结果确认。
