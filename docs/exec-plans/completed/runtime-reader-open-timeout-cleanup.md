# 保留 reader open 超时后的迟到清理责任

## 目标与全局图景

处理 PR #306 的 P2 review：openTerminalRead 超时丢弃迟到 descriptor，导致关闭 surface 后远端 reader 与冻结状态未释放。用户等待保持 15 秒有界；迟到资源仍由原请求、原 client 负责关闭，不重发 open、不把未知结果当作已应用。

## 进度

- [x] 2026-10-09：读取最新 head 95965a1c 的 review，核对 client、relay 与 Host 回收条件；选定有界等待与迟到清理分离。
- [x] 2026-10-09：补齐 14 项组合/直接调用回归；旧 head 两项有界对照失败，行为缺口已复现。
- [x] 2026-10-09：实现原请求迟到响应及 relay 责任保留，37/37 请求测试、32/32 reader、333/333 Host、完整协议及类型检查通过。
- [x] 2026-10-09：同步文档与技术债，完成交付准备；提交、rebase 与 PR 关联以 Git 记录为准。

## 意外与发现

原 23 项请求超时测试和 32 项 reader 测试分别通过，但没有覆盖“surface 关闭 + open 超时 + descriptor 迟到”组合。Host 同时参考 hasPendingRequests 与 relay.usesClient 决定回收，因此两处都必须准确保留资源责任。

## 决策记录

2026-10-09：复用原 request ID 与 socket 的 pending，不额外发取消 open 或重连。openTerminalRead 的可选超时回调移交迟到 Promise，relay 保留释放责任直到取得 descriptor 并 close；直接调用由 client 兜底关闭。迟到登记不关闭新 reader 的绑定。保留已有每 key 两个责任上限，不靠定时丢弃未知资源。

## 结果与复盘

review 的确定性资源清理问题已实现修复：调用者超时与清理责任分离，原连接迟到 descriptor 发一次 cancelled close，收到 recorded/duplicate 才确认释放。新 reader 与旧清理互不覆盖，容量保留，未知结果不变成 applied。协议同步 follow-up 仍保持上一轮收口；本轮无新增技术债。

## 上下文与定向

Supervisor 是托管终端的后台进程。openTerminalRead 获取 reader（带 readId 的读取资源），可能持有冻结终端状态；closeTerminalRead 按身份关闭它。extensions/vscode/dev-session-canvas/src/panel/runtimeSupervisorClient.ts 的 requestOnConnectedSocket、handleMessage 目前会丢弃到期 pending。runtimeTerminalReadRelay.ts 的 openBinding/release 共用 opening Promise；该 Promise 被超时拒绝后无法取得迟到 descriptor，释放责任提前消失。

## 工作计划

里程碑一在 scripts/test/test-runtime-supervisor-request-timeout.mjs 的受控时钟/socket 夹具中使用真实 client 和 relay，覆盖 deadline 前后关闭、迟到响应、同 key 替换、连接失效与 close 未确认。修前至少核心案例失败，不能只断言内部字段。

里程碑二在 client 为资源获取请求保留迟到 Promise，调用者到期仍得到 clientRequestTimeout。relay 等待原迟到 descriptor 后关闭；不会恢复已失败的 UI open，也不会重发请求。迟到旧绑定不能影响健康的新 reader。

里程碑三运行请求超时、reader、协议、Host 和类型回归，按实际结果更新正式设计、索引与技术债，再提交、rebase 和更新 PR。

## 具体步骤

在 runtime-rpc-request-timeout worktree 根目录运行 node --test --test-name-pattern='reader open' scripts/test/test-runtime-supervisor-request-timeout.mjs 定向验证，再运行 npm run test:runtime-supervisor-protocol、node scripts/test/test-runtime-supervisor-reader-client.mjs、node scripts/test/test-host-execution-owner-wiring.mjs 和 npm run typecheck。已有 npm ci 依赖；用假的单调时钟触发 15 秒，socket 记录每个实际请求。

## 验证与验收

超时调用者得到结果未知错误，原 socket 保持健康，open 仅发送一次。迟到 descriptor 必须触发一次原身份 cancelled close，recorded/duplicate 才确认释放；迟到错误、断连和未知 close 不能宣称 applied。每 key 超时责任不能无限累积，旧 descriptor 不能关闭替换 reader；deadline 回包竞态与 dispose 不泄漏计时器。既有严格删除迟到 current 补证保持通过。

## 幂等性与恢复

所有测试用独立 client/socket，finally dispose。反向证据通过未修改的实现与新测试取得，不改用户原 dev-session-canvas5 工作树。推送前 fetch/rebase；如需改写分支，用固定已验证远端 head 的 force-with-lease，不改目标分支。

## 证据与备注

Review: https://github.com/ZY-WANG-0304/dev-session-canvas/pull/306#discussion_r4221794111 。审查脚本 /tmp/pr306-reader-late-repro.mjs 在主线 9e6243c9 发送 close 并 recorded，95965a1c 不发送 close 且 unconfirmed。

本轮临时构建从 Git 读取 95965a1c 的 client/relay，执行相同新增测试。日志 /tmp/dsc-pr306-reader-timeout-before-pair.log 中，timer 路径丢失责任、到期响应路径 close 次数为 0，均失败；修后 /tmp/dsc-pr306-reader-protocol.log 为 37/37 及完整协议门禁通过，/tmp/dsc-pr306-reader-client.log 为 32/32，/tmp/dsc-pr306-reader-host-wiring.log 为 333/333，/tmp/dsc-pr306-reader-typecheck.log 通过。语法和 diff 检查通过，未执行多平台真实 VS Code。

初次旧实现组合运行在容量用例悬挂：旧代码没有保留前两次责任，第三次 open 未被容量拒绝；该进程显式终止，给新增用例补 2 秒测试失败上限，再完成上述有限对照。上限只避免坏实现挂住测试，不参与生产阶段判断。曾误用未注册 npm 脚本 test:execution-host-wiring，未执行测试；改用上述实际 Host 脚本后通过，不将命令错误当作产品回归。

## 接口与依赖

复用现有 Node assert/test、esbuild、受控 clock/socket。openTerminalRead 增加可选超时回调以接收原请求迟到 Promise；不新增 wire 消息。relay 的 lateOpening 仅承担释放责任，不能用于 UI 初始化或重试。

2026-10-09：记录 review 根因、选定方案与组合回归验收。

2026-10-09：完成修复、14 项新增回归、修前对照与完整门禁，记录初轮测试夹具悬挂及修正，归档计划。
