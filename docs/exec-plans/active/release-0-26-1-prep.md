# 从最新 main 重新准备 0.26.1

本 ExecPlan 按 `docs/PLANS.md` 持续维护。它记录本轮发布输入、验证及尚未解决的限制。

## 目标与全局图景

用户放弃 PR #311 后，重新从最新 main 整理 0.26.1 公开 Preview 的发布材料，涵盖运行时修复、终端链接以及旧协议重连语义。交付包含双扩展同版本包的静态输入、明确的升级说明、完整门禁结果及新的准备 PR；本轮没有合并、打发布 tag 或发布渠道的授权。

## 进度

- [x] (2026-10-09) 按用户要求关闭 PR #311，确认未合并；原用户工作树及旧准备分支保留。
- [x] (2026-10-09) fetch 最新 origin/main，基线为 `78c58c2a2cecd053199c9bada6084868f9255877`；新建 `release-0-26-1-from-main` 分支与 `/tmp/dsc261b` 工作树。
- [x] (2026-10-09) 复核 v0.26.0 之后已合并范围，统一版本与发布文档，补充 #312 用户语义；静态 preflight 通过。
- [ ] 在固定预合并提交执行 preflight、完整 verify 和发布契约补充验证，保留实际结果。
- [ ] 收口验证记录与遗留债务，fetch/rebase 后推送并建立新 PR；失败时保持草稿。

## 意外与发现

上轮基线 f6b65580 之后已合入 #309（共享层依赖边界）与 #312（旧协议重连/客户端退役）。本轮不继承 #311 的验证结论。#312 不重做 root 归属，也不宣称修复全部旧 smoke 阻塞。

此前测试进程 umask 0002 让 globalStorage 成为 0775，触发运行时目录的权限保护。新隔离验证进程使用 umask 0077，符合私有存储要求；不修改产品保护、旧现场或测试断言，也不据此认定后续 Terminal 准入已解决。原失败及一次私有权限对照的后续准入失败仍是历史证据。

## 决策记录

2026-10-09：关闭 #311，直接从最新 main 新建准备分支。旧静态文案仅作可复核输入，旧分支的执行记录和准入结论不复制到本轮。

2026-10-09：使用新的私有测试目录和完整 release:verify，无版本例外。发布准备只整理已合入修复；遇到独立产品失败时记录证据并交付草稿，不在本分支无边界扩修产品。

## 结果与复盘

本轮尚在准备，未获得完整验证通过结论。结果将按实际运行更新，不将旧定向测试外推为当前发布准入。

## 上下文与定向

上一公开版本为 v0.26.0。根 `package.json`/`package-lock.json`、`extensions/vscode/dev-session-canvas/package.json` 与 notifier manifest 必须统一 0.26.1。主扩展与 notifier 的 CHANGELOG、Marketplace README 英中文、根 README 英中文、两份发布手册和 support 需要一致。`docs/release-contracts/v0.26.1.md` 必须包含发布范围、用户 release notes、文档清单、已知限制与验证范围；不写候选 SHA、VSIX hash 或发布后状态。

本版新增持久会话按 root 稳定归属，修复启动拒绝处理、普通请求超时、旧历史清理、snapshot-only 提醒桥接及终端 styled 链接。#312 进一步让普通旧协议重连只连接原端点，失败保留原绑定及错误、取消自动 provider resume；用户显式操作仍受未结责任保护。notifier 包本轮只有内部测试依赖位置整理及同版发布，没有新增用户功能。

## 工作计划与里程碑

第一里程碑整理全部静态输入，并与 `docs/design-docs/runtime-legacy-reconnect-retirement.md` 等正式设计核对：旧 live 不迁移、不隐式重启 Supervisor 或自动转 provider resume；已结束持久会话不恢复正文或自动启动；snapshot-only 与显式 Resume 保持各自边界。#309 属内部依赖整理，不包装为用户新功能。

第二里程碑提交准备输入，在独立短路径工作树从 origin/main 正常 merge 准备 head，得到用于本地验证的预合并提交。准备分支追赶主线使用 rebase。运行完整门禁；若 npm test 提前失败，单独回收 Webview 全套及 HEAD clean-checkout VSIX 结果，不能代替完整门禁。补充 root、Host/reader、旧协议重连及 notifier 联动/locale 验证。

第三里程碑写入实际结果、技术债和新 PR 描述，区分静态材料完成与发布准入。没有完整绿色门禁时不可合并；发布步骤需后续明确授权。

## 具体步骤

工作目录 `/tmp/dsc261b`，Node 22 位于 `/tmp/dsc-release-node22/node_modules/node/bin`；六目标资产为 `/tmp/dsc-release-026-assets`，只在当前源码和依赖 hash 校验通过时复用。VS Code 使用 `/tmp/dsc0261v/.vscode-test/vscode-linux-x64-1.141.0/code`，浏览器缓存 `/tmp/dsc026v/.playwright-browsers`。原生输入未变不重复构建六平台。

    umask 0077
    export PATH=/tmp/dsc-release-node22/node_modules/node/bin:$PATH
    export DEV_SESSION_CANVAS_EXECUTION_ASSETS_SET=/tmp/dsc-release-026-assets
    export DEV_SESSION_CANVAS_VSCODE_EXECUTABLE=/tmp/dsc0261v/.vscode-test/vscode-linux-x64-1.141.0/code
    npm ci
    npm run release:preflight -- --version 0.26.1
    npm run release:verify -- --version 0.26.1

preflight/verify 在固定预合并工作树重复执行，使用独立短 `/tmp` smoke 目录避免 Unix socket 路径过长及旧状态干扰。命令、输入 SHA 和日志在实际运行后记录。额外运行 `test:runtime-root-ownership`、`test:runtime-root-preparation`、`test:runtime-legacy-reconnect`、reader-client/Host wiring、notifier typecheck/source/build、companion/locale smoke，并核对双 VSIX 版本、本地化和安装关系。

## 验证与验收

静态 preflight 应成功，完整 verify 应完成门禁自测、完整 npm test 及干净检出 VSIX smoke。新隔离目录的私有权限是环境前提，不能证明任意 umask 支持；真实市场自动补齐安装、桌面通知与跨平台验收仍按具名范围处理。失败要保留首败现场和准确阶段。

## 幂等性与恢复

原工作树未提交内容不动，旧 #308/#311 分支及证据保留。仅在新工作树编辑；缓存链接在交付前移入忽略目录，不提交工件。重复验证使用新日志及目录，不覆盖上轮现场。推送前 fetch/rebase，主线变化则重新评估验证输入。

## 证据与备注

#311 已关闭且未合并；本轮代码来源仅为 origin/main。旧材料不意味着旧结论有效，所有成功/失败均附本轮运行记录。相关流程为 `docs/WORKFLOW.md`、`docs/workflows/VERSION.md` 与 `docs/workflows/MR_CREATE.md`。

## 接口与依赖

不新增产品接口或依赖。使用现有 `scripts/release/release-preflight.mjs`、`scripts/release/run-clean-checkout-vsix-validation.mjs` 和 npm 脚本，不修改门禁或继承 0.26.0 豁免。

修订记录：2026-10-09，根据用户放弃 #311 并从最新 main 重做的要求建立新计划，明确 #312 范围及私有隔离验证环境。
