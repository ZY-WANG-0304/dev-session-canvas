# 修复 Runtime root 存储准备与失败状态

本计划按 `docs/PLANS.md` 维护。基于 PR314 的 `900da95a`，工作目录 `/tmp/dscr`。不改版本、不合并或发布。

## 目标与全局图景

在 umask 0002 下正常创建画布后，开启 RuntimePersistence 不再因插件自己创建的 0775 存储目录而失败。已有同用户普通目录经过限定的权限收紧后可继续使用。无法安全准备目录时给出原因，节点结束待启动表现，原历史和未知运行责任保持。

## 进度

- [x] (2026-10-10) 复核定位证据、共享存储创建入口和 Runtime 启动记录。
- [x] (2026-10-10) 实现私有目录创建和旧 0775/0770 的描述符收紧、身份复核及安全拒绝。
- [x] (2026-10-10) 实现安全阶段反馈、未提交新会话 error/resume-failed；保留原 Runtime 历史绑定与关闭/替换保护。
- [x] (2026-10-10) 目录 21 项、准备链路 26 项、完整 Host 529/529、模板、本地化及 typecheck 通过。
- [x] (2026-10-10) 最终代码默认 VSIX 七阶段通过，trusted 越过目录准备，后续 Agent 资源拒绝单列；旧 0775 和不安全 0777 独立原生均通过。
- [x] (2026-10-10) 保存精简证据、同步设计和技术债并归档；由本次 PR314 更新承载提交。

## 意外与发现

普通画布 `writePersistedCanvasSnapshotToDisk` 与 CanvasTemplateStore 的递归 mkdir 不指定 mode；Runtime 稍后 mkdir 0700 无法改变已存在目录。root helper 第一项权限检查失败被外层 catch 吞掉具体原因。`withExecutionCandidateStart` 只投影已提交且明确未获取资源的失败，遗漏根准备阶段未提交的失败。

## 决策记录

- 决策：普通画布/模板创建内部目录指定 0700；Runtime 在 Host 侧只对当前用户的普通 0770/0775 globalStorage 移除组写权限，使用打开目录的文件描述符并验证前后 inode/dev、类型、归属、真实路径。
  理由：兼容插件历史默认 mkdir；不递归 chmod 内容、不放宽 root 私有目录检查、不接管世界可写、特殊位、符号链接或异主目录。
  日期/作者：2026-10-10 / Codex。
- 决策：准备阶段错误使用受控消息，不转发原异常堆栈或环境；仅原未提交 createSession 记录和当前 metadata 仍绑定时投影失败。
  理由：结束错误的 starting 表现，但不把 Supervisor 提交未知转成会话资源已结算，不覆盖替换节点或原历史。
  日期/作者：2026-10-10 / Codex。

## 结果与复盘

正式修复和相关自动化回归完成。最终默认 VSIX 七阶段通过，trusted 在 0700 下成功启动 root/Terminal，Agent 后续 rejected-before-acquire 仍未归因。旧 0775 单目录升级及两节点启动、不安全 0777 拒绝及两节点失败状态的原生验证均通过。本修复不改变准入配额，完整 gate 未通过。

## 上下文与定向

`extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts` 的 root-local 保存、resolveRuntimeCreationTarget 与 withExecutionCandidateStart 分别负责普通文件、root 身份路径及会话创建记录。`CanvasTemplateStore.ts` 管理同一 globalStorage 下模板目录。新增 `panel/runtimeGlobalStorage.ts` 负责 Runtime 所使用的扩展目录安全准备；root helper 仍通过 `supervisor/runtimeRootOwner.ts` 验证每层私有目录与身份。

## 工作计划

第一里程碑统一新目录 mode 并实现针对旧扩展目录的有界收紧，实际文件测试证明 0775/0770 成功、0755 保持、异主/链接/特殊位/世界可写及身份替换拒绝。第二里程碑将 helper 目录准备错误表述为固定的阶段信息，补上未提交会话失败的状态收口；Host 回归覆盖 Agent/Terminal、恢复、历史保留、替换和已提交未知保护。第三里程碑运行相关完整测试及原生 umask 0002 smoke，保存实际剩余阻塞，更新正式文档与 PR。

## 具体步骤

在 `/tmp/dscr` 使用 `export PATH=/tmp/dsc-release-node22/node_modules/node/bin:$PATH`。依赖 symlink 从 `.debug/rca` 恢复。新增目录测试接入 `test:runtime-root-preparation`，执行该命令、完整 Host wiring、模板存储测试、typecheck。原生用 `DEV_SESSION_CANVAS_EXECUTION_ASSETS_SET=/tmp/dsc-release-026-assets DEV_SESSION_CANVAS_VSCODE_EXECUTABLE=/tmp/dsc0261v/.vscode-test/vscode-linux-x64-1.141.0/code npm run test:vsix-smoke`；根据具名结果保存 artifacts，避免覆盖前轮证据。

实际自动化命令为 `npm run test:runtime-root-preparation`、`node scripts/test/test-host-execution-owner-wiring.mjs`、`npm run test:canvas-templates`、`npm run test:ui-copy-localization`、`npm run typecheck`。最终 VSIX 日志为 `.debug/runtime-root-fix/vsix-final.log`；原始失败另存 `first-trusted-artifacts`，最终失败为 `final-trusted-artifacts`。独立原生在上述 Node/VS Code 环境下依次执行 `xvfb-run -a node docs/references/smoke-reload-autostart/runtime-root-storage-verification.mjs legacy` 和同命令的 `unsafe` 参数，分别 exit 0；程序只复制 VSIX 载荷并替换测试入口，不修改产品载荷。

## 验证与验收

新目录在 0002 下仍 0700；旧 0775/0770 经实际生产函数只去组写位，原内容保留；安全目录不改权限。拒绝案例不得 chmod 错误对象。原 root 检查和提交不确定性测试保持通过。准备错误原绑定节点 error/resume-failed、pendingLaunch 清空，历史和恢复 ID 保留且允许后续明确重试；迟到/未知创建不得错误释放。原生须至少越过原权限失败点；后续不同错误单列，不能宣称整个 gate 通过。

## 幂等性与恢复

只在隔离目录验证 chmod，原失败工件目录不修改。生产只更改由 ExtensionContext 明确指定的 globalStorage 单个目录；已有安全目录不修改。目录收紧即使后续失败也不回放宽权限。保存原生证据后清理本次隔离会话，收尾停放依赖。推送前 fetch/rebase origin/main。

## 证据与备注

基线定位证据为 `docs/references/smoke-reload-autostart/runtime-root-preparation-evidence.json`，本轮日志在 `.debug/runtime-root-fix`。日志已包括 root-tests、host-focused、host-full、templates、localization、typecheck。修前 Host 普通保存新用例在原产品代码上失败，mode 为 0775 而非 0700。

本轮证据为 `docs/references/smoke-reload-autostart/runtime-root-storage-fix-evidence.json`，含 source/VSIX hashes、测试结果、两个原生正反例和完整命令的剩余失败。专项副本的三个产品 bundle 与最终 VSIX 完全相同。legacy 的 0775 变 0755、原 marker 不变、两节点 live；unsafe 的 0777 不变、两节点 error/pendingLaunch 清空。专项自行停止活动节点；默认失败后的隔离 Terminal 经禁止重启的原 client 正常 stop，确认本轮测试 Supervisor 均已退出。

## 接口与依赖

复用 Node fs 文件描述符 API，不引入新依赖。Windows 保留 OS ACL 语义，不用 POSIX mode 推断 ACL。不新增用户配置，不改变 Runtime owner key、namespace 或 Supervisor 协议。

修订：2026-10-10 创建修复计划，明确受限旧目录处理和原启动绑定保护。

修订：2026-10-10 完成代码与自动化回归。完整 Host 发现旧 Runtime 历史资格依赖原状态，故明确跳过已有 runtimeSessionId 的失败投影；此前失败记录保持。最终原生验收进行中。

修订：2026-10-10 完成最终默认 VSIX 与两个独立原生对照、清理测试会话、保存证据后归档。后续 Agent 资源准入拒绝保留为独立待定位门禁。
