# 清理旧 detached 的纯历史节点

本 ExecPlan 按 `docs/PLANS.md` 维护。目标仅为第四现场的历史删除缺口，不重开容量、Agent或跨平台矩阵。

## 目标与全局图景

用户包 `2026-10-06T07-54-50-905Z` 的 Agent `6b9de465-3089-464a-b20d-760384cdbdae` 属于旧 `legacy-detached / terminal-stream-v1`，同类节点为 `6397fe41-f010-4f53-b86d-be314005389c`。两者 registry 为 `live:false/lifecycle:stopped`，没有退出码，结构化 `lastExitMessageDescriptor.id=recoveredHistoryOnly`。本轮让经原运行环境确认没有 Supervisor 的这类纯历史对象可以删除、清空或重新启动；不证明旧主体退出，不追踪或恢复孤立进程，不改用户registry或共享数据。

## 进度

- [x] (2026-10-06) 核对第四现场、原registry及旧恢复代码；确认两个native节点已在用户Host清理成功。
- [x] (2026-10-06) 选定独立纯历史解绑资格，明确无退出证明及PID namespace边界。
- [x] (2026-10-06) 实现helper复用和Host按generation路由，legacy helper116项、native39项通过；Host新增旧detached14项及原history/B2合计95项通过，原活跃/最终保存保护36项通过。
- [x] (2026-10-06) 类型检查、普通构建、调试staging及配置检查通过；独立复核未发现确定性blocker。原生socket/claim仍受限，用户原节点未操作，保留环境限制与旧失败。

## 意外与发现

此前systemd依据可靠的服务停止事实，native依据进程级排他所有权；两者不适用于旧detached。旧 `runtimeSupervisorMain.normalizeRecoveredSession()` 会自行把记录降为非live、stopped/closed并设 `process:undefined`，因此不能因缺少退出码永久锁住纯历史，也不能把恢复状态反推为原主体正常退出。

当前工具运行在隔离PID namespace，看不到用户原Extension Host。工具内/proc空匹配不是现场原owner缺席证据；最终检查必须在实际Host相同Linux运行环境内进行。用户dump只证明状态及之前的native清理，不能替代新的系统观察。

## 决策记录

2026-10-06：新增 `detached-recovered-history`，限定已知旧generation、唯一精确target、非live、stopped/closed及结构化恢复标记；前后原socket缺席、同用户任意backend原storage进程缺席、稳定registry。不存在可靠退出记录时允许本地纯历史解绑是显式产品决策，依据Supervisor故障后不恢复进程/历史的既定目标，不伪造进程退出、EOF或远端删除成功。

2026-10-06：抽取上轮已有的Linux只读socket/proc两项检查以复用，不新增扫描器/服务/诊断框架。旧进程不遵守native锁，不借新锁宣称原子保证；未知/活跃/损坏/过期保持保护。同次重启的前置持有资格只限native，旧记录在新client能力校验后逐目标重新检查；不缓存为storage级许可。

## 结果与复盘

有限修复及定向回归完成，F5 Main Only目录已更新。原registry共13条、混合backend，不借兄弟会话的退出码或服务状态授权，不清共享目录。用户原窗口不由工具修改，无需重启旧Supervisor，也不要求重复dump。

原生socket/claim共3个既有用例因sandbox限制明确跳过，不冒称第四现场删除成功。第三现场两个native目标已由本次用户dump确认成功，不能替代旧detached的新观察。本轮未重跑无改动的真实Agent、容量、平台或90,000行全量Host矩阵；上一轮两次15秒大快照超时保留，不追认绿色。Git元数据/工作树外只读，未提交或推送。

## 上下文与定向

`panel/legacyRuntimeHistory.ts` 已负责旧systemd的稳定registry核验，增加旧detached结构化恢复分支；`panel/nativeRuntimeHistory.ts` 的只读endpoint/proc观察提取到 `panel/linuxRuntimeHistoryObservation.ts`。`panel/CanvasPanelManager.ts` 的 `prepareStoppedLegacyHistoryRetirement` 沿原节点身份、未提交/reader/finalization保护接线，`prepareNativeHistoryReplacementPreflight` 明确限定native generation。

## 工作计划

里程碑一复用既有观察并补独立资格：测试只修改临时文件与受控系统边界，原systemd/native断言不变。里程碑二修改Host路由，分别验证Agent/Terminal删除、重启、清空、旧unconfirmed后再次操作、同storage不同目标不能共享许可。里程碑三只复验受影响契约并刷新F5目录，保留旧完整矩阵超时及原生环境限制。

## 具体步骤

仓库根运行 `node scripts/test/test-legacy-runtime-history.mjs`、`node scripts/test/test-native-runtime-history.mjs`；Host使用既有 `DEV_SESSION_CANVAS_HOST_TEST_FILTER` 选择旧/新history、B2、S9、production及pending final persistence。然后运行 `npm run typecheck`、`npm run build`、`npm run prepare:debug-main-only-extension` 和 `node scripts/test/test-debug-launch-config.mjs`。通过只说明固定受控用例；原生socket若受限必须明确跳过。

实际Host分两次定向执行：`DEV_SESSION_CANVAS_HOST_TEST_FILTER='^detached |^native |stopped legacy|stopped history|batch history|ended unsubmitted delete|^B2 ' node scripts/test/test-host-execution-owner-wiring.mjs` 为95/95（选中95/232），`DEV_SESSION_CANVAS_HOST_TEST_FILTER='^S9 |^production |^pending final persistence' node scripts/test/test-host-execution-owner-wiring.mjs` 为36/36（选中36/232）。这些不是232项全量运行。

## 验证与验收

精确结构化recoveredHistoryOnly目标可通过本地删除/重启/清空入口，不要求退出码。live:true、error、缺失/文本伪装descriptor、错误backend/kind、缺记录或重复记录、owner/endpoint活跃或未知、文件变化和超时均拒绝。逐目标文件稳定性、Host reader和已提交未知责任不被共享缓存绕过；两个旧节点同storage可独立处理，同registry其他会话字节不变。native旧路径和systemd旧路径回归保持。

## 幂等性与恢复

只观察用户registry/socket/proc，不发停止信号、不启动原Supervisor。资格只用于当次产品操作，失败保持原绑定。Main Only刷新后用户重新F5加载，沿原入口删除；不修改用户数据来制造通过。

## 证据与备注

第四包记录两次 `runtime/legacyHistoryRetired`，native目标 `45a796db` 与 `0a71c75b` 分别在07:53:59和07:54:00取得native-owner-absent。当前目标registry的mtime为2026-08-13，仅作溯源，不是授权。原RPC完整内部reason仍未取得，不能声称所有旧进程或后代均消失。

定向日志为 `.debug/detached-history-helper-final.log`（116通过、2原生skip；初轮115保留于`.debug/detached-history-helper.log`）、`.debug/detached-history-native-regression.log`（39通过、1原生skip）、`.debug/detached-history-host.log`（95/95）、`.debug/detached-history-active-regression.log`（36/36）、`.debug/detached-history-typecheck.log`、`.debug/detached-history-build.log`、`.debug/detached-history-debug-prepare.log`、`.debug/detached-history-debug-config.log`。测试只用临时文件及受控系统边界，没有扫描或修改实际服务来取得成功。

## 接口与依赖

`inspectStoppedLegacyRuntimeSession(backend, session, signal?)` 保持原返回union并增加 `detached-recovered-history`；共享Linux观察只有有界socket/proc函数。Host只有native检查使用storage级promise map，旧恢复记录逐session重新核对。不新增依赖包或跨平台声明。

修订记录：2026-10-06，按第四现场确立旧纯历史清理的有限方案，区别于进程退出与native所有权证据。

收口记录：2026-10-06，完成实现、既定定向回归、调试刷新与独立复核，归档并保留原生/实际窗口验证限制。
