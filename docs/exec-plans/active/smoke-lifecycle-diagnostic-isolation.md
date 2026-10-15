# 隔离生命周期 smoke 诊断并恢复 0.26.1 门禁

## 目的与上下文


PR327 的发布输入 9198cacbee91fc170b82578e353c16a27f3574b8 在源码 restricted 首开 editor 等待 ready 20000ms 失败。已确认测试命令 `CanvasPanelManager.runWebviewLifecycleRaceDiagnosticsForTest()` 的 fake panel 与真实 editor 交错：诊断把活动面改为 panel，真实 editor 唯一 ready 被接受但没有 bootstrap，finally 又恢复旧快照将 ready/frameId 清除。再次打开复用同 HTML，不再发送 ready。普通安装不注册这个测试命令。本计划隔离诊断，使真实页面在诊断前、期间和结束后收到 ready 都能完成 bootstrap 与确认，保持旧帧拒绝和原 20 秒门槛。

实现目录是 `extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts`；smoke 入口位于 `tests/vscode-smoke/extension-tests.cjs`。新增 `scripts/test/test-smoke-lifecycle-isolation.mjs` 直接加载真实类，替换 VS Code 外部边界，调度原协议方法；加入 `package.json` 默认测试链。根因、设计、回归和本次证据随一个修复 PR 交付，保留发布 PR327，不创建诊断或文档 PR。

## 进度


- [x] (2026-10-15) 从最新 origin/main 6e708c6b 核对既有调查提交，创建 smoke-lifecycle-diagnostic-isolation。
- [x] (2026-10-15) 核对 ready、bootstrap、目录发布、焦点重放和读者清理依赖，选择独立诊断对象。
- [x] (2026-10-15) 两真实面三时序及异常/成功责任保护共10项通过；旧 during 稳定缺少真实 bootstrap。
- [x] (2026-10-15) 隔离与异常清理、10项回归、协议/CLI、类型检查及六资产本地构建通过。
- [x] (2026-10-15) 组合f8d9ad53六资产、真实原ready三时序及none20秒负例完成；原样完整release:verify已运行并保留首次failure。
- [ ] 获取首次packaged错误与工件，闭环剩余完整门禁阻塞。
- [ ] 同步证据与技术债，归档计划，创建单一修复 PR 并核对 CI。

## 正式实现与里程碑


第一里程碑先在真实类回归中保留全部 fake 竞争检查，覆盖真实 editor 和 panel 的 ready 在诊断前、期间和结束后到达。测试用外部边界提供 bootstrap 内容，调度原生命周期与消息筛选方法；在 fake 等待处暂停而不是依赖随机延迟。验证真实 frame/generation、ready/ack、消息路由、焦点、诊断数组以及待处理请求和读者责任。旧版本至少在 during 时序失败，作为负对照。

第二里程碑把公开方法作为测试模式守卫与独立对象入口。独立对象以真实类 prototype 创建，显式初始化生命周期、消息目标、队列、请求、日志、焦点、可见性和终端读者容器；不能复制 this 或借用其 Map、队列、事件、读者、scheduler 和 context。bootstrap 使用独立空 Canvas 状态及调用前同步复制的 runtime 展示配置，模板目录为空诊断目录。仅替换序列化和外部数据边界，实际 ready/promote/filter、bootstrap、ack 排队、焦点及请求匹配方法保持。独立对象不运行生产构造器，避免磁盘写入、Host 监听器和监控定时器；finally 只清理自己拥有的请求、队列与 fake 引用，异常也不回滚真实对象。移除旧快照恢复及其专属 helper。

在修复 worktree 根执行 Node22 的 `npm run test:smoke-lifecycle-isolation`、`npm run typecheck`、`npm run build`，保存日志到 `/dev/shm/dsc-lifecycle-fix-evidence`。本地依赖先复制任务外已有 npmci 目录到 `/dev/shm/dsc-lifecycle-fix-evidence/node_modules`，修复 workspace 链接并运行 pinned serializer 构建后使用临时链接，只作为定向验证，不称为默认 npmci 发布门禁。主工作区用户的 docs/WORKFLOW.md 改动保持不动。

第三里程碑提交修复到临时组合分支，在固定修复 SHA 上应用 PR327 发布材料，再提交仅临时 workflow。workflow 从不可变组合 SHA checkout，Ubuntu22.04/Node22 默认 npmci，调用现有 runtime-execution-assets reusable workflow 构建同 ref/run 六资产，原样无过滤运行 `npm run release:verify -- --version 0.26.1`。附加真实 Host 的 ready 前/期间/后三时序与不发送 ready 的负例用暂存原消息控制，不降低业务断言。完整门禁失败时保存首败并在同修复范围判断，不把单项成功拼成完整通过。

最后同步设计状态、索引、技术债与证据，移除活动临时 workflow、依赖链接，fetch/rebase 最新 main 后推送并创建修复 PR。PR327 保持原 head/draft；修复合并后再 rebase PR327 跑最终正式预合并门禁。当前没有合并、tag 或发布授权。

## 决策记录


2026-10-15 选择独立 prototype 诊断对象，显式提供所有触达的私有状态。真正构造第二 manager 会初始化持久化、监听器和后台维护任务；浅复制 manager 会继续共享 mutable 状态；等真实 ready 再诊断只消除当前窗口。独立对象复用正式协议方法，payload 与目录数据仅是外部边界，保留生产协议规则。任何未初始化依赖应在测试显式失败，不得 fallback 到真实 manager。

## 意外与发现


`beginSurfaceRender` 和 `markSurfaceReady` 除了 ready 字段还取消本地读者、关闭终端分页责任、清理通知与待处理请求；旧诊断 finally 没有恢复这些责任。因此验收必须检查两个真实面的请求和读者，不只断言 editor ready。目录在 bootstrapAck 后异步发布，独立数据源保证其晚到回调仍只触达诊断对象。

## 可重试步骤与证据


工作分支基于 main6e708c6b，已有调查提交1522579e。每次推送前 fetch/rebase；已推送分支重写使用固定 force-with-lease。临时 CI 证据保存 run/input SHA、六资产 manifest 与第一次失败日志。根磁盘无空余，所有构建、日志和临时 worktree 放 devshm，不清理他人文件。根因原自然时序和前/期间消息对照位于 docs/references/smoke-restricted-ready-root-cause/，旧证据保留历史语义。

## 结果与复盘


隔离实现、旧源码负对照、10项实际类回归、Host owner wiring 全套、协议/CLI、类型检查及本地六资产构建通过。组合 f8d9ad53 的 run38681093813 正在构建同 ref/run 六资产后运行原样完整 release:verify，并附加真实原 ready 前/期间/后和缺失20秒负例。六资产同ref/run已完成并本地assemble核验；真实before/during/after均完整restricted exit0、实际bootstrapAck通过；none原20秒exit1且预期失败断言通过。完整release:verify尚在运行，需完成组合结果、证据与单一 PR 交付才能收口本计划。最终正式发布门禁仍须在修复合入后 PR327 的最新预合并输入重新验证。

2026-10-15 环境记录：根分区 ENOSPC 使首次构建写共享 serializer 入口失败，已从原 pinned 源码在任务依赖副本重建，恢复共享入口为短 symlink。此后所有依赖写入及 TMPDIR 指向 devshm，借用安装的验证不冒充 default npmci。

2026-10-15 完整组合结果更新：run38681093813 的完整命令04:30:27–04:54:17Z以failure结束，源码trusted/restricted、所有本地重开、systemd、SSHexit/retain、426项Webview已通过；latest日志位于clean-checkout packaged trusted。具体首败待工件上传，不能猜测。另run38683788069两份fallback限时阶段均exit0，此前API日志静默属于取数滞后。完整发布门禁保持阻塞，关联问题继续同修复范围审计。

修复交付状态：实现与根因回归完成，可以独立创建修复PR；本计划保留active，因为packaged首次失败及最终PR327门禁尚未收口。发布验证待办登记技术债，不把单项通过写成完整通过。
