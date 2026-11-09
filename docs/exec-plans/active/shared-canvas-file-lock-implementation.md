# 实施共享画布内核锁及受控迁移

本 ExecPlan 按 `docs/PLANS.md` 持续维护。设计合同为 `docs/design-docs/shared-canvas-lock-contract.md`，用户于 2026-11-06 授权开始实施。实现、隔离验证、真实产品验收分别记录，不能把基础库通过写成生产故障已修复。

## 目标与全局图景

共享画布目前使用固定 TCP 端口表示互斥所有权，普通客户端连接占据同一端口就能使删除等操作失败。最终目标是用稳定旁路文件上的操作系统排他锁代替三类 TCP 锁，保留差异合并、Runtime 原会话及接管语义。旧数据需要受控停写后在原路径转换外层快照格式；内部画布格式不变。实现期间不转换用户实际存储、不停止用户 Host 或 Supervisor。

## 进度

- [x] (2026-11-07) 实现独立 root 准备生命周期及 19 项阻断/清理/真实旧 store 组合测试；完成首轮组件和冷停机边界审核，补齐自等待保护。
- [x] (2026-11-07) 当前 19 项组件补丁复审收口，无新的确定性 blocker；主线程 Node 25/22 各 19/19、CI 契约 213/213、typecheck、文档及 diff 检查通过。
- [ ] Host 全入口接线与真实冷停机/持续禁旧版本操作链仍未实施；不能据库级验收解除生产门禁。
- [x] (2026-11-07) 主线程独立反例验证：固定旧版真实方法、受控登记屏障及空 map 对照；Node 25 旧版/当前工作树各 9/9，Node 22 旧版 9/9。不触达用户 Runtime；完整 Electron 交错仍未验。
- [x] (2026-11-06) 核对既有设计、工作树及用户授权；保留未提交研究文档。
- [x] (2026-11-06) 分配原生模块实现及冷迁移兼容审核；主线程实现协调器和生命周期测试。
- [x] (2026-11-06) TypeScript 协调器 17 项隔离测试、typecheck、既有 store 21 项及模式切换回归通过；协调器加入 CI 回归清单。
- [x] (2026-11-06) 冷迁移复审发现两个生产接通 P1，已登记合同和技术债；本轮不接通生产。
- [x] (2026-11-06) M1 本机基础层：主线程独立重建 native，Linux Node 25 的 `/tmp` 和工作树 XFS 各 14 项通过；真实后端协调器组合 19/19 通过。
- [x] (2026-11-06) 主线程使用最终测试脚本和同一重建资产，在 Node 22.23.3 再次通过 native 14/14、协调器 19/19。
- [x] (2026-11-06) 协调器复审 P2（空批次绕过取消/期限）修复；原生夹具 PID 身份清理、暂停状态观察及清理失败报告补强。CI 契约完整复跑 213/213。
- [ ] M1 跨平台生命周期门禁：Windows/macOS、fork 未成功 exec、Darwin EINTR 描述符状态等未验；阻止基础层直接作为发行后端启用。
- [ ] M2：资源分发、v2 store/participants、异步 root 准备入口和显式升级确认。
- [ ] M3：受控转换及真实固定旧 Host 兼容、恢复和模式切换回归。
- [ ] M4：支持平台的 source/VSIX/Remote 同存储多窗口验收。

## 意外与发现

本轮初版组件 12 项通过，审核仍定位到 factory 等待自身准备、release 等待自身退出两类 P2。已增加活动 preparation 检查与 release 上下文跟踪；后续 19 项还覆盖失败准备的 context 立即失效、同步 abort 重入及两个真实旧 store 的并发保存。审核发现的是库调用方反向等待风险，不冒充已发生生产故障。

冷停机审核确认现有工具缺少持续禁止旧 Host 重入的能力，离线转换程序也不会自动获得该能力。正式合同收紧为存量 v1 不自动转换、不接受单纯确认转换；外部部署隔离和已提交操作结算未验证前不开放。目录为空不能作为全新根豁免证明。

2026-11-07 准入探针首跑因归档遗漏 attention-protocol 而编译失败，补入同一固定提交依赖后通过。旧 store.ready 和自动恢复拒绝 v2 后，真实 UI attach 方法仍到达隔离 RPC 边界；空 map 的 mutation/restore/模式切换反例及对照均成立。只是调用边界证据，不是实际停止会话或完整 Host 迁移证据。

当前工作树基于 `canvas-responsive-execution-node-size`，已有未提交设计研究。开发者指令禁止未经明确请求创建分支或提交，因此保留当前分支，不执行仓库默认的自动提交/建分支流程。

现有 store 构造和部分 Host 恢复是同步入口；不能只替换锁函数后即开放异步迁移前的运行时副作用。此风险交由第二位审核者重新检查，M1 不接通生产入口。

冷迁移复审定位到实际入口：旧 Host 的 UI attach 不等待 store.ready；新 Host 如果仅延迟创建 store，则 `withSharedExecutionMutation`、`restoreLiveRuntimeSessions` 和模式切换在空 map 时绕过共享保护。源码已由主线程核对，真实旧 Electron 交错仍待验证。不能以“旧参与者为空”替代冷停机边界。

首次 typecheck 发现项目 ES2020 类型库不包含 Object.hasOwn/AggregateError；已采用 hasOwnProperty 与保留 cause/releaseError 的专用错误类，不修改全局 target。首次 `test:ci-gates` 为 211/213：两个失败均为新增回归任务后固定 368 计数应更新为 369；已更新数量且增加新任务存在断言。修复后 scope 单测 23/23 通过，完整复跑另行记账。

完整 CI 契约复跑最终为 213/213；本地输出在 `.debug/shared-canvas-lock/ci-gates-after-count-update.log`，不是正式发布验收。协调器复审发现空 admissions 批次绕过校验，已修复并新增三项测试。原生测试初版的裸 descendant PID 清理、仅发送 SIGSTOP 即开始检查、忽略 finally close 错误均已补强；最终 Linux 套件确认真实停止态、保存并复核进程身份、清理失败非零退出。非 Linux 无相应身份工具的两项用例显式跳过并列入未验证，不能伪装成完整通过。

## 决策记录

- 决策：独立准备组件先交付测试与 CI，不部分替换 Manager 的同步加载；存量转换保持关闭，等待可验证的外部隔离链。
  理由：当前组件只管理新 Host 内部代次，不能约束旧二进制，也不能在尚未覆盖全部 RPC、模式切换与 tryJoin 时用局部 guard 代表接线完成。
  日期/作者：2026-11-07 / 实施代理及两位审核者的阶段意见。
- 决策：新增可重跑的准入反例探针，不修改生产逻辑；使用真实 Manager/store 方法，替代 VS Code 外壳和 Runtime 外部副作用。
  理由：区分源码审计与可执行证据，先确认缺口存在的条件；探针不冒充真实 Host 或迁移实现。
  日期/作者：2026-11-07 / 验证代理。
- 决策：先交付无生产调用的、独立可测试的锁基础层，再接通迁移和业务。
  理由：新旧互斥域不同，直接替换会产生混写；未验证冷迁移不能默认开启。
  日期/作者：2026-11-06 / 实施代理。
- 决策：使用现有两名审核代理，分别负责原生模块与新冷迁移审计，主线程负责协调器。
  理由：写集合不重叠；旧评审不覆盖后续选定的 v2 方案。
  日期/作者：2026-11-06 / 实施代理。
- 决策：冷迁移两个 P1 未满足前，只交付无生产调用的基础层。
  理由：已确认旧 UI attach 和新空 map 分支的准入遗漏；这是阻止生产接通的安全边界，不以测试基础库通过掩盖。
  日期/作者：2026-11-06 / 实施代理与冷迁移审核者。

## 结果与复盘

本轮增加 root 准备生命周期库：缺失/未准备/失败拒绝，准备单飞，取消同步撤销准入，迟到资源清理，业务排空后才释放，失败释放阻止重登，旧代次不复活，以及自等待检测。新增 CI 任务，总任务数 369→370，同步断言。没有新增生产调用；组件不是完整的 Host 准入修复。首次 12 项、补强后 19 项通过，最终两版本 Node 验证、完整 CI 契约与组件复审均完成；生产 Host/迁移未获验收。

2026-11-07 补充结果：两个生产接通 P1 获得真实方法的可执行反例，未修改生产逻辑，未实施迁移或连接用户 Runtime。9 项通过表示确认反例与对照，不代表缺口已修复；M2–M4 保持未完成。

前轮完成无生产调用的独立锁基础实现及 Linux 本机验收：native 14 项、协调器 17 项 mock 加 2 项真实组合、既有 store 21 项、模式切换及 typecheck 通过。主线程再次编译出的资产与原生实现代理的资产字节一致。尚未实现生产加载器、v2 store/participants、迁移器或 Host 全入口 root 准备接线；本轮新增的准备库仍无生产调用，用户截图中的生产错误未被宣称修复。M1 其余平台及 M2–M4 仍是启用/发布前必需工作。

## 上下文与定向

`extensions/vscode/dev-session-canvas/src/panel/sharedRootCanvasStore.ts` 用 commit/node TCP 锁保护写入及执行变更；`sharedRootCanvasParticipants.ts` 用 admission TCP 锁保护准入和退出，另有真正的通信 listener。`CanvasPanelManager.ts` 管理同步加载、会话恢复和多 root 模式切换。不能把通信端口一起删除，也不能全局替换所有 `version: 1`。

新模块 `native/shared-canvas-lock.cc` 只提供异步 open/tryAcquire/close，不加载 PTY；Unix 使用 flock，Windows 使用 LockFileEx。`src/panel/sharedCanvasNativeLock.ts` 声明不透明句柄和加载边界，`sharedCanvasLock.ts` 管理有界排队、单调截止时间、取消结算和多 root 排序。旁路文件常驻，释放只关闭句柄，不删除文件。

## 工作计划

### M1：验证互斥和所有权

先增加独立 native 构建脚本及真实多进程测试，再用注入后端测试 TypeScript 状态机。必须证明同资源互斥、不同资源不阻塞、暂停不偷锁、崩溃释放、取消后迟到的句柄被结算、业务结束前不解锁、重复释放安全。每次获取有自己的打开描述；用资源队列而不是全局串行锁。按 UTF-8 字节顺序获取多 root 准入，拒绝递归锁和反向锁顺序。测试只操作临时路径。

### M2：安全接入与包装

先实现 `sharedCanvasRootPreparation.ts`：root 预登记、不可伪造代次、准备单飞、失败关闭、业务计数、取消后迟到资源清理、退出结算和同 root 重登限制。定向 `test:shared-canvas-root-preparation` 覆盖缺失/未准备/失败均不调用 work，ready 后才调用、移除前不释放进行中资源、旧代次不能复活、清理失败阻止重登以及重复关闭。组件不直接接通生产迁移，Host 全入口接线单独评估。

在原生支持与资源校验就绪后，为 root 创建显式异步 prepare，先于自动恢复/启动/删除。合法 v2 直接登记 v2 participants 以保留 tryJoin；v1 需用户确认和旧参与者严格探测。资源构建及 CI 必须包含支持平台的原生资产，缺失失败关闭，不在用户机器编译、不回退 TCP。所有共享读取/诊断路径认识外层 v2，private/workspace 格式不变。

### M3：原路径受控转换

单 root 按新 admission、旧 TCP admission、旧 TCP commit、新 commit 顺序获取。原始字节校验后发布 SHA256 备份，再把保留全部 state/未知字段的 v2 envelope 原子替换到原路径。rename 前失败保留 v1，rename 后重试保留 v2，永不自动降级。活跃或未知旧参与者、端口占用、不可读/损坏文件均阻断。用固定 v0.28.0 真源码和真实 Host 验证晚登记、历史恢复、reset、模式切换及 deactivation 不破坏新状态或活跃会话。

### M4：产品验收

在支持平台的 source、打包 VSIX 和 Remote 执行端验证共享同一 canonical 路径的两个窗口；原 session/PID、输入输出和 resize 保持，删除/保存及最后窗口接管正确。记录源码 SHA、包 hash、平台、首个失败与修复，不用重跑绿色覆盖失败。

## 具体步骤

所有命令从仓库根执行。M1 使用 `npm run test:shared-canvas-native-lock`、`npm run test:shared-canvas-lock`，预期退出 0 且逐项报告通过。前者默认从 `~/.cache/node-gyp/<当前Node版本>/include/node` 读取 headers 并在临时目录构建，也可传 `-- --headers <headers目录>` 或 `-- --binary <已有模块>`。协调器的真实组合测试用 `npm run test:shared-canvas-lock -- --binary <模块绝对路径>`，未传 binary 时只运行 mock 后端测试。

单独保留构建资产时运行 `node scripts/build/build-shared-canvas-lock.mjs --output <新临时目录> --headers <匹配运行Node的headers目录>`；不覆盖已有模块。Windows 编译另需显式 `--node-lib` 与 `--delay-load-hook`，当前平台无运行证据。实现后运行 `npm run typecheck`、`npm run test:shared-root-canvas`、`npm run test:runtime-mode-switch-races` 及 `git diff --check`。构建脚本如需本机编译器或 Node headers，缺失必须报告而非跳过为成功。

## 验证与验收

M1 测试使用 IPC/显式屏障控制时序，超时仅作失败上限，不靠 sleep 猜测顺序；mock 测试证明协调器责任，原生进程测试证明内核互斥，二者不可互相替代。既有 legacy-version-fence 隔离脚本只证明旧 store 版本拒绝，不证明完整 Host 安全。最终发布必须通过设计合同四组门禁；当前 Linux 环境不能签发 macOS/Windows/Remote 验收。

## 幂等性与恢复

构建和测试可重跑，只创建临时夹具或忽略的构建输出，不改用户 globalStorage。不得清理持锁文件。生产接入前，新增基础模块没有调用点，不改变当前协议。迁移启用后的恢复依据磁盘 envelope，不能回写旧备份掩盖已发生的切换。

## 证据与备注

本轮定向入口 `npm run test:shared-canvas-root-preparation`，19 项包含 18 项库级行为与 1 项真实 TCP store 组合。组合使用同一临时 v1 快照和两个独立准备器/旧 store，并发 mutation 后 nextGroupSequence=3，格式仍为 v1；它不是跨进程 Host/tryJoin/迁移验收。初版 12 项与中间 16、17 项均通过；19 项结果在 `.debug/shared-canvas-lock/root-preparation-reviewed.log`。typecheck、CI scope 23/23、文档检查通过。最终 Node 22 复跑与完整 CI 契约结果另行补记，不把中间代码的结果写成最终代码证据。

最终补记：Node 22.23.3 的当前 19 项通过，日志 `.debug/shared-canvas-lock/root-preparation-node22-reviewed.log`；Node 25.6.0 同补丁 19/19。`npm run test:ci-gates` 完整 213/213，日志 `.debug/shared-canvas-lock/root-preparation-ci-gates.log`，不是完整 ci:verify 或发布验收。组件审核者复跑当前 19/19，确认两项自等待 P2 已修复，在指定组件/测试范围未发现新确定性 blocker；未批准生产接线。冷停机审核者确认持续禁旧版本门禁，不以此批准迁移。

2026-11-07 定向命令：`node docs/references/shared-canvas-lock-research/host-admission-counterexamples.mjs`（固定旧版），同命令加 `--current`（工作树），以及 `$HOME/.nvm/versions/node/v22.23.3/bin/node` 运行固定旧版。各 9 项；详细替代边界、源码 hash 和局限已同步生命周期合同。日志位于 `.debug/shared-canvas-lock/host-admission-legacy.log`（首次编译失败）、`host-admission-legacy-rerun.log`、`host-admission-current.log` 和 `host-admission-node22.log`。探针只用于研究，确认存在缺口时返回成功，不加入正常修复回归门禁。

既有证据：Linux TCP/flock 六项原语试验和固定旧 store 八项格式拒绝试验通过；这些不是本次实现测试。本轮新增命令的实际输出记录如下。

最终本机证据：`npm run test:shared-canvas-native-lock -- --binary /tmp/shared-canvas-lock-integration.5OS2PO/shared-canvas-lock.node` 为 14 项；把 TMPDIR 指向工作树 `.debug/shared-canvas-lock/tmp` 后在 XFS 上仍为 14 项。该 TMPDIR 下协调器 `--binary` 测试为 19/19。输出保存在 `.debug/shared-canvas-lock/native-final.log`、`native-workspace-filesystem.log` 和 `coordinator-final.log`，这些是本地临时证据，不提交原生资产或假装为 CI producer。

native 源码 SHA256 为 `2b44c7185da8aaf6a9a5a8b0bdbbbabd0d80765f4066d5cd5e85803f96b936d1`，主线程独立重建资产 SHA256 为 `af0076668ae76361ecb240a15bc7229e018a3ae93cdf91eb302bec9895c8e69f`。构建及 native 测试均输出 `productValidated: false`。源工作树未提交，不以当前 HEAD 冒充这批新增源码已入库。

最终测试脚本在 `$HOME/.nvm/versions/node/v22.23.3/bin/node` 上也通过 native 14/14 和协调器 19/19，日志为 `.debug/shared-canvas-lock/native-node22-final.log` 与 `coordinator-node22-final.log`。Node 22 同样加载上述 Node 25 构建的原字节，不重新构建替换资产。

## 接口与依赖

Node-API 后端必须导出 `open(path): Promise<NativeLockHandle>`、`tryAcquire(handle): Promise<'acquired' | 'busy'>`、`close(handle): Promise<void>`。协调器公开 `withLock(resource, options, work)` 和 `withAdmissions(paths, options, work)`；options.deadlineMs 为 performance.now() 同源绝对值，signal 在交付 work 前取消，开始 work 后只能由业务主动处理，不能提前解锁。业务错误与关闭错误同时出现时保留两个原因。

修订记录：2026-11-06 创建实施计划；将基础实现与生产迁移、跨平台验收分开，避免未验证版本默认生效。

修订记录：2026-11-06 记录协调器实跑、两项 typecheck 修正和首次 CI 固定计数失败；根据冷迁移复审明确本轮交付边界，保留 M2–M4 未完成状态。

修订记录：2026-11-06 收口本机基础实现、二次复审修复和独立重建证据；保留跨平台与生产接通未完成项，不将活跃计划移入 completed。

修订记录：2026-11-07 应用户要求补充主线程独立准入反例和对照验证，明确真实方法、被替代边界及首次失败，不把隔离验证升格为生产修复。

修订记录：2026-11-07 继续实现准备生命周期组件，登记两项审核 P2 与补强，并收紧存量迁移启用条件；Host 接线及跨平台/真实隔离仍未完成。
