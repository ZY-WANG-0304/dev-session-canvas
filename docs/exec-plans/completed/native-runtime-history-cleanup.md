# 清理已失去原生 Supervisor 的历史绑定

本计划按 `docs/PLANS.md` 持续维护，只修复具名历史节点删除与重启，不追加诊断工具阶段。

## 目标与全局图景

2026-10-06 用户第三份现场包 `2026-10-06T06-47-20-517Z` 确认前轮五个 systemd 历史节点已清理，但 Agent `0a71c75b-7846-4a48-b6ad-55cd2e92f945`、`45a796db-bcc7-41bd-86fd-ac223cc4b983` 仍返回 unconfirmed。它们绑定 Linux `legacy-detached`、`terminal-exit-v1`，Host 无当前执行或 reader，旧 registry 为空。目标是原 Supervisor 确认不在时可以删除、清空或直接重启；未知、活跃及未完成尾部责任仍阻止清理。用户数据与服务不由本计划直接修改。

## 进度

- [x] (2026-10-06) 核对第三现场、上一轮结果和 namespace 历史，确认不能以 generation 或空 registry 单独授权。
- [x] (2026-10-06) 选定 Linux 限定观察和重启前置观察方案，记录正式设计。
- [x] (2026-10-06) 实现有限原生缺席观察、同批共享和重启顺序，首批helper39项、Host79项及原活跃删除/保存保护36项定向通过。
- [x] (2026-10-06) 最终helper39项、Host117/117（选中117/218）通过；旧systemd81项、namespace路由及startup16项、typecheck/build/debug staging通过。独立复核无确定性blocker；1原生claim周期与2旧socket例受sandbox限制，未操作用户原窗口。

## 意外与发现

`4578cd34` 已使用 terminal-exit-v1，但 `runtimeSupervisorMain.start()` 尚无 namespace claim；`43527328` 才同时加入产品新建路由和 claim。前者可以关闭业务 listener 后继续等待资源，所以仅取得新式 claim 不证明旧实验进程已退出。metadata 没有版本凭证，不从日期或错误字符串推断。

本轮两次完整Host回归均在未改的 `terminal large final snapshot survives actual Host reload and tracker restoration` 原15000ms超时，尚未到新增用例。保留 `.debug/native-history-host.log`、`.debug/native-history-host-rerun.log`，不改断言或阈值，不追认完整218项通过。新增可选 `DEV_SESSION_CANVAS_HOST_TEST_FILTER` 仅选择直接受影响用例，默认仍全部执行，零匹配失败；最终定向包含原严格活跃删除、submitted unknown、reader/finalization、生产准入和新历史清理。

Agent/Terminal 新建先取得 preferred client，可能先启动同一存储的新 Supervisor，再检查旧绑定；这会让缺席观察被新 owner 阻挡。必须在可能启动新 owner 前限时完成观察，且仅对本次启动保留身份绑定的已完成事实。

## 决策记录

- 决策：限定 Linux 现代 Node、精确 native generation 和原 detached 路径，短暂取得现有排他 namespace；持锁时只读检查原 endpoint 及 Linux 同用户进程命令行，排除仍以原 `--storage-dir` 运行的无 claim 实验 Supervisor；等待自己的 claim 关闭后才授权。
  理由：该锁跨 backend 且维持到进程退出；额外进程核对直接补历史无锁缺口，不是通用进程托管。权限、内容、数量、超时及释放未知均不放行；不保证恶意改 argv、其他 PID namespace 或并发手动启动旧实验版。
  日期：2026-10-06。
- 决策：区分观察截止与启动身份有效期。20秒内未完成的观察中止且迟到claim仍释放；已在期限内完成的事实可随同一次未提交的start保留至client能力检查，不因新owner启动慢而重新争锁。
  理由：新native Supervisor不恢复原session；正确失效条件是身份、提交、reader/finalization或关闭边界变化，而不是已证明不存在的owner随墙钟复活。正常批量删除仍遵守共享截止，不跨操作保存正向资格。
  日期：2026-10-06。
- 决策：不写共享 registry，不启动旧 Supervisor，不把新观察改成 RPC/EOF 成功；同次删除按原存储共享一次观察，重启在 preferred connect 前观察并在能力检查后使用。
  理由：避免同批互抢临时锁及新 owner 抢先启动；保留原身份、reader、finalization、提交未知与截止保护。
  日期：2026-10-06。

## 结果与复盘

有限实现与定向回归完成，Main Only调试目录已刷新。两个具名native目标不再因为缺少旧systemd退出记录必然被拒绝，而必须在本次操作证明原namespace和已知旧无锁Supervisor缺席。旧 systemd 修复及其测试保留，两个更老 detached terminal-stream-v1 不纳入自动清理；没有证据不得声称所有遗留节点均已解决。

真实socket权限受sandbox限制，当前不能宣称在原用户Host删除成功。重新启动F5加载新bundle后由原产品入口执行检查，不要求重启旧Supervisor或修改registry，也无需重复生成整套dump。工作树外/Git元数据只读、网络受限，本轮未提交或推送。不重复未受影响Agent/容量/平台矩阵；既有大快照超时单独保留，不变成新工具阶段。

## 上下文与定向

`panel/CanvasPanelManager.ts` 的 prepareStoppedLegacyHistoryRetirement 和严格删除入口决定本地历史资格；新增 `panel/nativeRuntimeHistory.ts` 复用 `supervisor/runtimeSupervisorNamespace.ts`，不调用会删除 socket 的准备函数或无释放接口的 native claim。命名空间是由当前 UID 和规范 storage 路径派生的进程级排他 socket。新的证据仅表示原执行 authority 缺席，不代表正常退出或所有后代消失。

## 工作计划

里程碑一实现独立 helper 和边界测试，证明已释放claim及原进程观察才能返回缺席，未知保持拒绝。里程碑二将证据接入现有 Host 资格函数：Agent/Terminal 同时在 preferred client 前保存本次观察，旧活跃删除仍等待目标 client 能力验证；单次批量共享 namespace 观察，但每个节点独立重验元数据、绑定和责任。里程碑三只运行受影响回归并刷新 Main Only 调试目录，以定向结果与明确限制交付。

## 具体步骤

在仓库根运行 `node scripts/test/test-native-runtime-history.mjs`、`node scripts/test/test-host-execution-owner-wiring.mjs`、`node scripts/test/test-runtime-supervisor-linux-native-namespace.mjs`、`node scripts/test/test-legacy-runtime-history.mjs`、`npm run typecheck`、`npm run build`、`npm run prepare:debug-main-only-extension`。所有受控测试应通过；环境禁止 socket 时真实案例明确跳过，不能伪写实测成功。

本轮最终Host定向命令是 `DEV_SESSION_CANVAS_HOST_TEST_FILTER='^native |stopped legacy|stopped history|batch history|ended unsubmitted delete|^B2 |^S9 |^production |^pending final persistence' node scripts/test/test-host-execution-owner-wiring.mjs`，117/117通过（总218）。新增native部分28项，覆盖超时abort/晚到以及独立用户操作不缓存资格；过滤器没有更改用例内容或期限。

## 验证与验收

覆盖同存储两个历史节点、Agent/Terminal 删除/重启/清空、先前未提交 unconfirmed 后重试；锁被占用而 listener 已关、早期无锁 Supervisor、权限未知、过期晚到与关闭未完成继续保护。批量等待及 preferred connect 后身份/责任改变不得使用旧资格。目标共享数据不变、无新 Supervisor/信号。正常尾部回归沿原用例，不重复 Agent/容量/跨平台矩阵。

## 幂等性与恢复

观察只读用户文件，只释放自己创建的临时 socket；失败保持原绑定。新观察不跨用户操作缓存，不覆盖旧失败。不做用户数据补丁或存储迁移；重新加载调试扩展后由现有产品入口处理目标节点。

## 证据与备注

原始包在用户项目 `.debug/current-host-diagnostics/2026-10-06T06-47-20-517Z`。该包确认 systemd 清理通过，但不包含新的 native 缺席观察；本轮 socket/systemd 受 sandbox 限制，不进行用户服务操作。

最终日志为 `.debug/native-history-inspection-final.log`（39通过、1原生skip）、`.debug/native-history-host-final-regression.log`（117/117）、`.debug/native-history-legacy-regression.log`（81通过、2原生skip）、`.debug/native-history-namespace.log`、`.debug/native-history-startup-profile.log`、`.debug/native-history-typecheck-final.log`、`.debug/native-history-build-final.log`、`.debug/native-history-debug-prepare-final.log`、`.debug/native-history-debug-config.log`。此前的79/216、36/216、28/218各自为局部运行，不相加冒充完整矩阵。

## 接口与依赖

`inspectRetiredNativeRuntimeNamespace(backend, signal?)` 返回 `native-owner-absent | undefined`，依赖现有 Node fs/net 与 namespace API，不增加包。Host 用操作内 promise map 合并同 namespace 观察，retirement 携带原 binding key 与身份复查函数。批量使用原截止；重启只传递已限时完成的观察，不因preferred startup耗时跨操作保存资格。

修订记录：2026-10-06，依据第三现场及历史无锁例外建立有限修复，不扩大旧 detached 或跨平台范围。

收口记录：2026-10-06，补观察截止/同次启动身份区别、最终定向验证与两次旧用例超时，归档为有限实现完成；原窗口和真实socket验证限制继续显式保留。
