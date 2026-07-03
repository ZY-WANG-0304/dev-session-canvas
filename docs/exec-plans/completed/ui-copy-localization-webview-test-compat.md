# 收口 Webview 测试兼容文案

本 `ExecPlan` 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘` 这几个章节。

本计划遵循 `docs/PLANS.md`。当前文件位于 `docs/exec-plans/completed/ui-copy-localization-webview-test-compat.md`，已完成并从 active 目录归档；仍遗留的本地化技术债已同步到 `docs/exec-plans/tech-debt-tracker.md`。

## 目标与全局图景

本批次要收口主 Webview 源码里最后一批硬编码中文：测试 DOM helper 的错误文本，以及旧中文可见 label 到稳定 action id 的兼容映射。完成后，产品 UI 文案迁移不再依赖 `extensions/vscode/dev-session-canvas/src/webview/main.tsx` 中的中文例外；自动化检查可以直接拒绝 `main.tsx` 中新增中文硬编码。测试协议继续使用稳定 `action` id，例如 `delete`、`start`、`reload`，从而避免测试随英文/中文 UI 切换而漂移。

## 进度

- [x] (2026-07-03 15:39+08:00) 已读取 `docs/WORKFLOW.md` 与 `docs/PLANS.md`，确认本批次属于多步本地化收口，需要 ExecPlan。
- [x] (2026-07-03 15:39+08:00) 已扫描 `main.tsx` 剩余中文，确认集中在 test DOM helper 错误、`legacyNodeActionIdFromLabel(...)` 和一处 locale joiner；`locale` 类型中的 `zh-CN` 属于 typed dictionary 边界，不是硬编码中文文案。
- [x] (2026-07-03 15:44+08:00) 已将 test DOM helper 错误改为英文诊断，并移除 `legacyNodeActionIdFromLabel(...)` 的旧中文 label 兼容路径。
- [x] (2026-07-03 15:45+08:00) 已更新协议类型、协议校验和本地化测试，让 `clickNodeActionButton` 只接受稳定 action id，`main.tsx` 不再允许中文例外。
- [x] (2026-07-03 15:47+08:00) 已同步 `docs/design-docs/ui-copy-localization.md`、`docs/design-docs/index.md` 和 `docs/exec-plans/tech-debt-tracker.md`，说明产品 UI 文案迁移已收口，剩余只是真实 VS Code locale smoke/manual 验证。
- [x] (2026-07-03 15:50+08:00) 已运行最终定向测试、typecheck 和 diff check，准备归档计划并提交本批次。

## 意外与发现

- 观察：当前 Playwright 与 VS Code smoke 调用 `clickNodeActionButton` 时已经全部使用 `action` 字段，没有继续发送旧中文 label。
  证据：`rg -n "kind: 'clickNodeActionButton'" tests scripts extensions` 显示测试用例均传入 `action: 'delete'`、`action: 'start'` 或 `action: 'reload'`。
- 观察：`protocol.ts` 中仍把旧中文 label 写进 `WebviewDomAction` 类型和 `isWebviewDomAction(...)` 校验；即使 `main.tsx` 移除兼容函数，协议层仍会留下中文硬编码。
  证据：迁移前 `extensions/vscode/dev-session-canvas/src/common/protocol.ts` 的 `clickNodeActionButton` 分支接受本地化 label，迁移后 `rg -n "[\p{Han}]|zh-CN" extensions/vscode/dev-session-canvas/src/common/protocol.ts` 无输出。
- 观察：`main.tsx` 中唯一非 test-helper 的 `zh-CN` 判断用于选择 pane gallery 状态分隔符。把分隔符纳入 Webview 字典后，`main.tsx` 可以做到零中文/locale 字面量例外。
  证据：新增 `paneGallery.statusSeparator` 英文值 `, ` 和中文值 `，`，`paneGalleryPaneStatusDescription(...)` 通过 `t('paneGallery.statusSeparator')` 拼接片段。

## 决策记录

- 决策：本批次移除旧中文 label 兼容，不再把它隔离为可继续使用的 legacy fallback。
  理由：当前仓库内自动化测试已全部迁移到稳定 `action` id；继续保留中文 label 会让测试协议把本地化后的可见文案重新变成 API，削弱英文/中文 UI 双版本的稳定性。
  日期/作者：2026-07-03 / Codex

## 结果与复盘

本批次已完成 Webview 测试兼容文案收口。`main.tsx` 中不再有中文 test helper 错误、旧中文 label case 或 locale joiner 字面量；`protocol.ts` 的 test DOM action 类型不再接受可见 label；`test:ui-copy-localization` 对 `main.tsx` 执行零例外中文扫描，并把 `protocol.ts` 纳入协议/共享 helper 硬编码中文扫描。剩余缺口是英文/中文真实 VS Code locale smoke/manual 验证。

## 上下文与定向

`extensions/vscode/dev-session-canvas/src/webview/main.tsx` 是主画布 Webview 的 React 源码。前面批次已经把用户可见 UI 文案迁移到 `extensions/vscode/dev-session-canvas/src/webview/i18n/webviewI18n.ts` typed dictionary，Webview 通过 `t(...)` 和 `tCount(...)` 读取英文默认文案或简体中文覆盖文案。

Webview test DOM action 是测试专用协议。`extensions/vscode/dev-session-canvas/src/common/protocol.ts` 定义 `WebviewDomAction`，Host 测试通过 `host/testDomAction` 把动作发给 Webview，`main.tsx` 中的 `performWebviewDomAction(...)` 查询真实 DOM 并触发点击、双击或输入。它不是产品 UI，但仍位于产品源码内；为了防止测试依赖可见文案，按钮点击应该只使用稳定 `WebviewNodeActionId`，也就是不会随 locale 改变的短 id。

迁移前 `extensions/vscode/dev-session-canvas/src/webview/main.tsx` 中的 `webviewI18n.locale === 'zh-CN'` 只用于选择 pane gallery 状态分隔符，不是可见文案本身；本批次把该分隔符也移入 Webview typed dictionary，因此 `main.tsx` 已不需要保留 locale 字面量。`webviewI18n.ts` 中的中文翻译字典不是债务，它是简体中文版本本身。

## 工作计划

第一步修改 `protocol.ts`。把 `WebviewDomAction` 中 `clickNodeActionButton` 的 `label` 字段删除，让该 action 必须携带 `action: WebviewNodeActionId`。同步更新 `isWebviewDomAction(...)`，当 kind 是 `clickNodeActionButton` 时只接受稳定 action id，不再接受中文 label，也不再支持“无效 action 回退到 label”。保留现有测试中“无效 action 加 label 应失败”的断言，必要时把 label 改成英文或任意字符串以避免中文残留。

第二步修改 `main.tsx`。`queryNodeActionButton(...)` 直接读取 `action.action` 并用 `data-node-action-id` 定位按钮；删除 `legacyNodeActionIdFromLabel(...)`。将所有 test helper `throw new Error(...)` 改成英文诊断文本。错误文本可以包含 `nodeId`、`fieldName`、`edgeId`、`filePath`、`lineNumber`、`selector` 等事实参数，但不要使用本地化字典，因为这些错误只返回给测试 harness，不显示给最终用户。

第三步修改 `scripts/test/test-ui-copy-localization.mts`。`findUnexpectedWebviewMainChineseLines(...)` 不再需要允许 test helper 或 legacy label 例外，改成直接扫描 `main.tsx` 中所有汉字；`zh-CN` 字面量只允许 typed locale joiner 这一行，或者用更明确的 allowlist 表达它不是 UI 文案。测试里的中文断言消息如果只存在于测试脚本自身，可以保留；本批次重点是产品源码与协议源码不再承载旧中文 label。

第四步更新文档。`ui-copy-localization.md` 需要把第五批描述中“仍保留 test DOM helper 错误和旧中文 label 兼容映射”改成“已在本批收口”，并把测试协议建议改成强制使用稳定 action id。`docs/design-docs/index.md` 增加本批 completed ExecPlan 引用。`tech-debt-tracker.md` 把 UI 本地化债务从“迁移测试兼容文案”调整为“真实英文/中文 VS Code locale smoke/manual 验证仍缺”。

## 具体步骤

在仓库根目录执行修改与验证。探索命令：

    rg -n "[\\p{Han}]|zh-CN" extensions/vscode/dev-session-canvas/src/webview/main.tsx
    rg -n "删除|启动|停止|新建|重启|恢复|重新加载|复制草稿|覆盖文件|创建空文件并关联" extensions/vscode/dev-session-canvas/src/common/protocol.ts extensions/vscode/dev-session-canvas/src/webview/main.tsx

完成后预期第一条和第二条在目标产品源码中都没有输出。最终验证命令：

    npm run test:ui-copy-localization
    npm run test:protocol-webview-messages
    npm run typecheck
    git diff --check

如果协议类型调整影响测试编译，优先更新测试 payload 为稳定 `action` id，而不是恢复 label fallback。

## 验证与验收

自动验收标准是：`test:ui-copy-localization` 证明 Webview 字典 key 完整、Host runtime zh-cn bundle 完整、`main.tsx` 不再出现未登记中文硬编码；`test:protocol-webview-messages` 证明 `clickNodeActionButton` 只接受稳定 action id 且无效 action 不会通过；`typecheck` 证明协议类型和 Webview helper 调用一致；`git diff --check` 证明没有尾随空白。

用户可观察验收是：英文 VS Code 与简体中文 VS Code 中的产品 UI 文案仍分别来自英文默认和中文覆盖；测试 harness 点击节点按钮不受可见文案语言影响。因为本批不运行真实 VS Code locale 手动 smoke，设计文档仍不能宣称完整真实宿主 locale 验证已完成。

## 幂等性与恢复

本计划只修改源码、测试和文档。所有测试命令可重复运行。如果某个外部旧测试仍发送中文 label，协议会拒绝该 payload；恢复方式不是重新引入中文兼容，而是把调用方改成发送稳定 `action` id。若发现第三方或历史 smoke 仍无法同步更新，应在 `tech-debt-tracker.md` 记录具体调用方和退出条件，再考虑受控兼容层，但当前仓库扫描没有发现这种调用方。

## 证据与备注

最终验证已通过。关键输出摘要如下：

    $ rg -n "[\p{Han}]|zh-CN" extensions/vscode/dev-session-canvas/src/webview/main.tsx extensions/vscode/dev-session-canvas/src/common/protocol.ts
    <no output>

    > dev-session-canvas-workspace@0.21.0 test:ui-copy-localization
    ui copy localization tests passed

    > dev-session-canvas-workspace@0.21.0 test:protocol-webview-messages
    protocol webview message tests passed

    > dev-session-canvas@0.21.0 typecheck
    tsc -p ./tsconfig.json --noEmit

    $ git diff --check
    <no output>

## 接口与依赖

`extensions/vscode/dev-session-canvas/src/common/protocol.ts` 中 `WebviewDomAction` 的 `clickNodeActionButton` 分支必须要求 `action: WebviewNodeActionId`。`WebviewNodeActionId` 是稳定测试协议的一部分，不能使用本地化后的按钮文本作为标识。

`extensions/vscode/dev-session-canvas/src/webview/main.tsx` 中 `queryNodeActionButton(...)` 必须通过 `data-node-action-id` 查找按钮。测试 helper 错误必须是英文诊断，且不得调用 `t(...)`，因为它们不是用户 UI 文案。

修订记录：2026-07-03 创建计划，明确本批次移除旧中文 label 兼容而不是继续隔离。


修订记录：2026-07-03 完成实现和文档同步后更新进度、发现、结果与验证证据，剩余等待最终 diff check 与归档。

修订记录：2026-07-03 最终验证通过后更新完成状态与归档路径。
