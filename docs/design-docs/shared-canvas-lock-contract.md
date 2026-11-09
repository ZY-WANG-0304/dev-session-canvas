---
title: 共享画布内核锁迁移与生命周期合同
decision_status: 已选定
validation_status: 验证中
domains: [协作对象域, 项目状态域, 执行编排域, VSCode 集成域]
architecture_layers: [共享模型与编排层, 宿主集成层, 适配与基础设施层]
related_specs: [docs/product-specs/runtime-persistence-modes.md]
related_plans: [docs/exec-plans/completed/shared-canvas-lock-contract.md, docs/exec-plans/active/shared-canvas-file-lock-implementation.md]
updated_at: 2026-11-07
---

# 共享画布内核锁迁移与生命周期合同

## 状态与交付边界

这是在用户同意继续收口迁移与接口后选定的实施设计。2026-11-06 用户授权开始实施，已新增独立锁基础模块与测试，但尚未接通生产调用；当前生产仍使用 TCP 锁，不转换用户实际存储。原方案比较、平台一手资料及前两位独立审核见 [研究文档](shared-canvas-lock-research.md)。具体推进见 [实施计划](../exec-plans/active/shared-canvas-file-lock-implementation.md)；真实三平台 Host/VSIX 升级验收仍未完成。

## 目标与取舍

目标是消除固定 TCP 端口与普通连接争用，同时保持画布差异合并、Runtime 原绑定、三层保护区和接管语义。选择**受控停写迁移 + 外层快照格式升级 + 原生文件锁**。不选择长期双锁桥接：桥接保留原端口冲突，还需要兼容旧端口碰撞去重与跨 root 顺序，而无法仅靠时间推移证明旧版本已永久退出。

仅新增 lockProtocol 字段不能拒绝旧写者。固定旧版 store 已明确拒绝外层 version 不为 1，故将外层格式升级为 2，用旧代码已有的检查阻止其再次发布；内部 `state.version` 保持 1。这不是用新标记要求旧版“自觉配合”，也不是给业务状态增加写入代次的 fencing token。它只约束执行版本校验的入口，不能自动取消旧 Host 已发出的 Runtime RPC。

## 正式方案

### Root 准备生命周期

`panel/sharedCanvasRootPreparation.ts` 独立于 store map 登记 root，返回不可伪造的代次凭据。登记即处于 unprepared，prepare 同代只执行一次；只有调用方完成严格加载、登记重读、首次保存后返回资源，才转为 ready。缺 root、未开始准备、准备失败和旧凭据均拒绝业务，不把空 map 推断成私有模式。私有模式必须由 Host 显式在此组件外分流。组件不获取跨进程 admission，不改变 participants.tryJoin。

withReady 等待当前准备并在交付业务前重查代次，业务收到 signal/isCurrent 以在异步边界前复查。退出先同步撤销准入并取消准备，再等待迟到资源及已交付业务结算，最后释放资源；不得提前 dispose。移除完成前禁止同 root 重登，清理失败保留失败记录并阻止重登；成功移除后新登记获得新代次，旧回调不能使用新资源。关闭整个实例代表模式/Host 代次终止，新模式必须等待旧实例关闭后创建新实例。组件不承诺强制取消不可中断 I/O，也不追踪调用方未 await 的游离工作。

准备 factory 在返回资源前自行负责部分失败清理；返回后资源清理只由组件执行一次。取消后的迟到成功也必须释放。重复退出复用同一结果；清理失败不能自动重试 dispose 或以无成员资格执行最后窗口清理。factory 递归 prepare/withReady、factory/业务/release 等待自身退出会自锁，因此在活动异步上下文中拒绝该调用；ready 业务的正常嵌套使用仍允许。不同 root 的 factory/业务也不得形成循环等待，本组件不做全局依赖图死锁检测。此组件先单独测试，不能在 Host 所有入口接线前声称空 map 缺口已修复。

2026-11-07 当前组件在 Linux Node 25.6.0/22.23.3 各 19/19，含同进程两个真实旧 TCP store 的并发保存组合；typecheck、CI scope 23/23 与完整 CI 契约 213/213 通过。第二位审核者复跑 19 项，确认 factory 自准备与 release 自退出两项 P2 已修复，在组件范围无新确定性 blocker。Host 接线、Participants 取消迟到登记、tryJoin 及全入口代次检查仍未验收，组件通过不代表这些问题已解决。

### 存量迁移启用限制

2026-11-07 冷停机复审后明确：当前禁止存量 v1 自动转换，也不允许仅凭用户勾选确认启动转换。关一个窗口、扫描 PID、空 participants 只是局部或瞬时观测，不能阻止其他窗口、Profile、Remote Host 或之后的旧版本重入。旧代码既有 Runtime RPC 不受新 root 生命周期约束。

存量转换必须先有覆盖受支持入口的外部部署隔离，持续禁止旧版本启动，确认旧 Host 退出与已提交操作结算后，才可运行离线转换；转换后继续维持禁入。离线转换器自身不提供这种隔离。当前未实现或验证该操作链，因此不开放生产转换入口。全新根只有在独立、可确认未被旧 Host 使用的隔离环境下才可另行验收；目录为空不能证明这一前提，本轮也不提供“空目录免检查”的初始化例外。

这是生产启用条件的收紧，不撤销文件锁方向或改变备份/原子替换合同。跨平台原生资产、Host 全入口准备/业务准入、离线隔离链仍各自为必要门禁；不能以新增库级测试通过替代。

### 1. 三种版本与作用域分开

`extensions/vscode/dev-session-canvas/src/panel/sharedRootCanvasStore.ts` 将共享存储 envelope（包住 state 的外层对象）改为 `version: 2`，必需 `lockProtocol: 'os-file-v1'`，内部图仍是 `state.version: 1`。扩展发行版本、存储 envelope 版本、锁协议版本分别管理，锁身份不包含扩展发行号或 Supervisor generation。

`canvas-state.json` 保持原路径；不把新画布挪到旁边另一份路径继续让旧版编辑旧副本。每个 canonical root 存储目录新增 `.canvas-locks-v1/admission.lock`、`commit.lock`、`nodes/<SHA256(localNodeId)>.lock`。规范化根身份沿用当前共享 filename 规则，不能引入与同一实际共享文件不一致的用户/环境别名。完整哈希仅用于稳定合法文件名，不压缩到有限端口段。

旁路文件必须稳定保留，正常释放不 unlink；root 清理、reset、模式切换不能递归删除它们所在目录。root 存储的最终删除/GC 必须另有所有访问者停写的设计，本次不提供自动清理。Unix 拒绝符号链接、异属主、非普通文件或异常多硬链接等不合格对象，持有前后复核实际文件身份；Windows 使用等价的文件身份/reparse point 与访问权限校验。该协议防止协作进程意外分裂锁对象，不声称抵御拥有同用户写权限的任意恶意进程。

### 2. 支持的升级和降级合同

首个文件锁版本不支持旧/新 Host 对同一 root 在线混写。用户升级前应保存修改，让同一执行端访问相关共享存储的旧 Extension Host 正常退出，再统一升级后重开；Remote SSH 指远端 Extension Host，不是只关闭一个本地画布标签。保持 Runtime Persistence 开启，**不通过关闭持久化来迁移**，不停止、重建或替换原 Supervisor/provider。

首次转换已有 v1 root 前，新版展示影响并取得确认：相关窗口需升级，转换后该共享画布不能直接用旧扩展继续编辑，后台会话不因迁移主动停止。确认是用户意图，不是旧进程已退出的证明；还必须经过旧准入/提交锁及旧参与者探测。检测到活动旧参与者、探测未知、锁不可取得或格式异常时阻断该 root，保留原数据，不能凭用户已确认而绕过。

当前隔离兼容证据仅覆盖 v0.28.0 产品源码 `e07fd17601b2639456dfd4807c1b83905067c8b1`。更早历史版本、定制构建或外部编辑者不得默认列入兼容保证，发布前需明确支持矩阵与相应写入口审计。普通升级重开后继续使用原 Runtime binding；不因文件锁原生资产缺失回退 TCP。

拒绝自动降级格式。升级后的旧包可能显示原有“Invalid shared Canvas snapshot”而非新版友好提示，这应在升级说明写明。旧读者的通用 `loadPersistedCanvasSnapshotFromPath` 本身并不校验外层版本，不能宣称旧版所有读取/执行入口都已被格式位阻断；当前 Host 构造在创建 store 的首次 persist 时同步失败属于源码推导，真实完整 Host 启动/历史恢复必须另验。已打开旧 UI 的直接 stop 等副作用不由版本位回滚，故停写前提仍不可取消。

回退不是把 version 改回 1：这会重新放行旧写者。若将来需要降级，必须另行提供停写后的显式导出/转换流程，基于当前最新 v2 内容，并处理全部新 Host、在途操作和参与者；本次不实现该流程，也不自动恢复旧备份覆盖最新内容。

### 3. 每个 root 的一次性转换

拟新增 `panel/sharedCanvasStorageProtocol.ts`，作为共享 store 创建、Root-local 读取与参与者登记之前的入口。只读预检看到合法 v2 时，直接进入 v2 参与者登记流程，保留其中竞争期间的 join/接管路径；不能先强制取得 admission 再允许 join，否则会阻塞清理期间的新窗口接管。

看到 v1 或文件不存在时，依次取得**新文件 admission → 旧 TCP admission → 旧 TCP commit → 新文件 commit**，随后重新读取磁盘格式和旧 `.participants`。转换期间每次只处理一个 root，不持有其他 root 的迁移锁；它不是正常多 root 退出流程，也不沿用其递归嵌套。普通 v2 工作绝不再获取旧 TCP 锁，从而不存在反向获取链。两个新版转换者由新 admission 串行，后进入者重新检查到 v2 后结束转换，不能重复覆盖。

转换必须有以下阶段：

1. 在新 Host 恢复会话、发出自动启动/删除等操作之前验证 native 后端及存储能力；失败不转换文件。对已有 v1 等待用户完成升级前置操作，不能边运行旧图上的执行动作边转换。
2. 获取上述锁并重新读取。旧 admission 等待已准入 mutate/depart 的工作及保存结算；旧 commit 排空此前已经取得它的保存。这里没有按 PID 或时间偷锁。若锁端口被外部程序占用，迁移明确失败，不改端口；这个一次性 bootstrap 仍有旧端口依赖，不能宣传升级本身绝不会遇到 EADDRINUSE。
3. 使用独立、只读的旧参与者探测，不为了检测而实例化会自动 register 的旧 Participants。只复用已有严格存活/缺席语义；活动或未知 peer 阻断转换，不能伪造 takeover。旧 Host 可能在转换前已读取 v1、转换后才尝试登记，该窗口的 ready/work 必须在实际读取 v2 后失败；此交错仍需产品级测试。
4. 确认原始内容有效后，以原字节 SHA256 命名创建一次性 v1 备份；备份也先写独占临时文件、同步并关闭后再发布，不能把崩溃留下的半文件当作完成备份。同名已有备份必须核对字节，不能覆盖未知内容。缺少文件仅允许按显式的新 root 初始化规则创建，不能把读取失败当作不存在，也不能把无法读取的既有内容用 workspace 缓存重建覆盖。
5. 将合法原 envelope 中未知扩展字段及整个 state 保留，修改外层 version/lockProtocol，附记 fromVersion/sourceHash；图、Runtime session ID/backend/storage/owner 保持不变。写独占临时文件、完成写入与文件同步、关闭后原子 rename 到**原路径**。同目录 rename 是唯一切换点，避免数据文件和“已迁移”标记分开提交。
6. 重读并校验 v2，按逆序释放锁，之后登记 v2 参与者并开放该 root。失败/取消如果发生在 rename 后，也不自动恢复 v1；重试根据磁盘上的合法 v2 继续。取消不能留下已经取得但未交付的句柄。

备份只用于保留迁移输入，不是回滚按钮。过程崩溃在 rename 前时原 v1 仍是权威；rename 后时 v2 是权威。外层内容损坏或结果不可确认时失败关闭并保留现场，不从临时文件猜测最新数据。本轮不扩张到掉电/文件系统故障后的恢复保证；平台原子替换、同步和崩溃窗口在实现阶段验证，不把现有 JSON rename 宣称为完整数据库事务。

版本拒绝的已证边界是：固定旧版的 constructor、publish、mutate、depart 会拒绝 v2；排队等待 commit 的旧 publish 获锁后重读，不能用早先状态直接覆盖。仍须审计全部共享写者，尤其初始化、reset、workspace root 移除与模式切换；任何不经过这些检查的入口会重新打开兼容缺口。原工作树中共享保存通过 store，关闭模式写入独立 private-root-canvases-v1；通用 workspace slot 快照继续外层 version 1，不在本次全局改版本。

### 4. 参与者与接管协议

`panel/sharedRootCanvasParticipants.ts` 的文件锁版使用独立 `${canonicalSnapshotPath}.participants-v2` 登记目录，避免迟到的旧登记被新协议误当可接管的活动成员；记录与握手显式包含协议标识。不能复用任意旧记录授权新协议动作，也不能删除未知旧记录来取得“最后窗口”资格。转换前仍检查旧 `${canonicalSnapshotPath}.participants`，转换后对旧版意外运行的完整行为依赖上一节兼容验收，不能用换目录掩盖。

实际通信 listener 仍保留 60000–64999 和现有 token 校验，本次不改 listen(0)。有端口的通信不等于用端口做互斥。登记获取 admission 时保留 `tryJoin` 协商路径：结果要区分“取得物理锁”和“现有清理拥有者按协议接纳加入”。后者只是登记/接管许可，不能伪造成 file lease 授权普通 mutate/commit/depart。既有四阶段交接、pending deletion 订阅与最后窗口清理语义不变；scope v2 并非扩大到跨容器或跨网络命名空间协作。

### 5. 原生锁适配器合同

选择独立 Node-API 模块，源码在 `extensions/vscode/dev-session-canvas/native/shared-canvas-lock.cc`，接口在 `src/panel/sharedCanvasNativeLock.ts`，隔离构建工具在 `scripts/build/build-shared-canvas-lock.mjs`。当前 TypeScript 文件仅声明接口，生产加载器及资产分发仍待实现；最终须复用平台资产分发与完整性校验机制，不加载 PTY/执行权威模块，无隐式启动子进程或 Supervisor，不在用户机器临时编译。隔离测试的开发机编译不等于已完成发行资产构建。

```ts
interface NativeLockHandle {
  readonly opaque: unique symbol;
}

interface SharedCanvasNativeLock {
  open(path: string): Promise<NativeLockHandle>;
  tryAcquire(handle: NativeLockHandle): Promise<'acquired' | 'busy'>;
  close(handle: NativeLockHandle): Promise<void>;
}
```

原生 handle 是绑定当前 Node environment 的不透明对象，不向 JS 暴露可重用的整数 fd；伪造、跨 environment 或已关闭对象不能再次取得资源。open 为本次独立所有权建立独立打开描述，tryAcquire 的 busy 只表示已知锁竞争；路径/权限/能力错误必须单独拒绝。close 结算取得的锁并关闭句柄，对同一对象幂等，共享第一次完成或错误结果，不能重试操作已经被 OS 重用的 fd。显式解锁失败仍要尝试结算本句柄并记录两个结果；不能以吞掉 close 错误宣称成功。

Unix 用 open(O_RDWR|O_CREAT|O_NOFOLLOW|O_CLOEXEC, 0600) 和 flock(LOCK_EX|LOCK_NB)，不 truncate 文件。CLOEXEC 只覆盖成功 exec 关闭，必须验证 fork 子进程在失败/等待路径不保留引用；不能只依赖标志宣称父 Host 退出必然立即解锁。[Linux open](https://man7.org/linux/man-pages/man2/open.2.html)

Windows 用 CreateFileW 的 OPEN_ALWAYS、GENERIC_READ|GENERIC_WRITE、FILE_SHARE_READ|FILE_SHARE_WRITE，不给 FILE_SHARE_DELETE，不继承 handle，并核对目录 ACL 与文件身份。用 LockFileEx(EXCLUSIVE|FAIL_IMMEDIATELY) 固定锁偏移 0、长度 1；零长度文件不表示零长度锁。仅明确锁竞争可归一化 busy；共享打开/权限失败不能一律重试成“其他窗口持锁”。[CreateFileW](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-createfilew)、[LockFileEx](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-lockfileex)

文件打开、身份核查及原生请求用有界异步工作执行，不能在 JS 主线程等待阻塞锁，也不把无期限锁等待放进 libuv pool。非阻塞 flock 只意味着不等待锁，不证明文件系统调用永不迟滞；取消/超时后的在途 native 工作仍必须结算并关闭迟到 handle。排队任务数和每 operation 的在途 native 请求数有界，不能每次重试再积累 worker。

当前基础实现使用独立工作线程和 Node-API 8 完成通道，普通请求上限 256、打开 handle 上限 512，释放保留容量；超限明确拒绝，不转成无限等待。Unix 的锁目录要求当前用户拥有且 mode 0700，文件要求 mode 0600、普通空文件、单硬链接，并在取得锁前后检查 inode/目录身份。Windows 分支检查 owner/DACL、reparse point 和文件身份，但尚无本轮实机证据。错误保留 `nativeCode/syscall/cleanupErrors/release`；close 不重试可能已被复用的 fd，Darwin `EINTR` 后描述符是否仍打开是未收口的平台门禁。

### 6. TypeScript 协调器和所有权

已新增但未接通生产的 `panel/sharedCanvasLock.ts`，内部管理每个规范资源键的队列、deadline 和强引用，业务代码只用结构化的 withLock，不直接关闭原生句柄。当前不接受外部 lease 作为重入许可；模式切换所需的内部显式持有集合接线仍待 M2 实现。

```ts
type SharedCanvasLockScope = 'admission' | 'node' | 'commit';

interface SharedCanvasLockResource {
  readonly canonicalSnapshotPath: string;
  readonly scope: SharedCanvasLockScope;
  readonly nodeId?: string;
}

interface SharedCanvasLockOptions {
  readonly deadlineMs: number;
  readonly signal?: AbortSignal;
}

interface SharedCanvasLockLease {
  readonly resourceKey: string;
  readonly operationId: string;
}

interface SharedCanvasLocks {
  withLock<T>(resource: SharedCanvasLockResource, options: SharedCanvasLockOptions,
    work: (lease: SharedCanvasLockLease) => Promise<T>): Promise<T>;
  withAdmissions<T>(canonicalSnapshotPaths: readonly string[], options: SharedCanvasLockOptions,
    work: (leases: ReadonlyMap<string, SharedCanvasLockLease>) => Promise<T>): Promise<T>;
}
```

deadlineMs 使用同进程单调时钟的绝对截止时间，不通过 RPC 传递。初次替换不扩大现有预算：commit/node 5 秒，admission 90 秒；预算包含本地队列等待，重试不重置。FIFO 本地排队不承诺跨进程公平。已开始 work 后获取截止时间不成为强制释放的 TTL；锁需覆盖 work 及对应 finally flush，长持有记录诊断而不是偷取。

状态转移为 queued → opening → acquiring → owned → releasing → closed。queued/opening/acquiring 可被取消；原生请求已在途时，调用保持清理责任，迟到成功不交付 work，而是关闭后拒绝。owned 后 signal 只作为业务取消意图，不能直接关闭锁；等待原 work 和 flush 实际结算后才释放。release 出错保留为操作失败，若同时有业务错误则保留首个业务原因及附加清理错误。

队列按 root/scope/node 的稳定身份区分。不同逻辑调用不能因为共用 AsyncLocalStorage 上下文、同一 fd 或同一线程就重入；lease 对象由协调器内部登记校验，不依赖可伪造的 resourceKey/operationId 字符串。相同资源不支持任意递归获取，明确抛出 reentrant-use 错误；已有模式切换需要的复用只能经内部显式持有集合传递，且仍需唯一的结构化执行链，不能把许可借给并行任务。

M1 协调器以实际旁路文件路径为队列键，每实例最多 256 个在途及等待调用，超限明确拒绝；不同实例仍由 native 独立 open 后竞争内核锁。AsyncLocalStorage 只用于拒绝递归/反向获取，不授予免锁资格；子任务并行请求相同 node 仍排队。业务错误与关闭错误通过 `SharedCanvasLockCleanupError.cause/releaseError` 同时保留，以兼容项目 ES2020 类型基线。获取期限包括本地排队及 native 调用，迟到结果先关闭再拒绝；这不保证文件系统卡死时能在获取截止点完成清理。

调用前，root 存储目录必须由上层明确初始化，传入父目录已经 realpath 规范化的绝对快照路径；协调器只创建私有旁路锁目录，不读取、创建或迁移 `canvas-state.json`。此前提不能被 M2 解释为“读取失败就允许初始化覆盖”。

调用方必须 await 所有嵌套锁任务及对应 flush；协调器只等待 work 返回的 Promise，不自动收拢 fire-and-forget 子任务。空 `withAdmissions` 批次不打开文件，但仍验证有限 deadline、取消及过期，再执行一次 work。该空批次语义是本轮协调器复审的 P2 修复，已补正常、取消、过期/非法三项测试。

正常顺序保持 flush 既有保存 → admission → node → work/commit → flush → 逆序释放。commit 持有者不能反向请求 node/admission。多 root 的 `withAdmissions` 先按规范键的 UTF-8 字节序排序、去重，再获取全部资源；所有 Host 使用同一排序，不用 localeCompare 或调用方输入顺序。`CanvasPanelManager.ts::leaveSharedCanvasesForModeSwitch` 改为此接口；纯文件锁不再保留端口碰撞去重。一次性转换单 root 执行，不与该多 root 退出链混合。

### 7. 正常关闭、异常退出与失败 store

store 必须先停止接受新请求，结算已接纳 work/flush，再释放其持有资源，最后 dispose 参与者；不能把当前同步 dispose 扩写成“直接关闭所有锁”。Extension Host 退出的 native cleanup 只处理该 environment 拥有的资源，在途 native 请求先结算，不访问已经销毁的 JS 对象。正常路径显式 close，GC 仅为兜底，活动 lease 保持强引用。

锁获取超时、取消、原生不支持、权限/路径损坏、存储协议不兼容、旧参与者仍活动、释放失败均为不同诊断类别，包含 scope、资源摘要、operationId、等待时长和原始平台错误。没有 owner 证据不展示“另一个窗口正在操作”的确定性判断；UI 不直接贴内部堆栈。

本轮保留现有 store 的提交失败后持续拒绝语义，不新增“清除 failure 后继续”的恢复。用户应看到保存未完成、后续修改未获共享落盘保证；如需重载，先按现有保存模板/导出或 Note 保存能力保留可保存的本地内容。这些入口不是包含 Runtime 责任和全部 pending delta 的完整恢复备份，不能承诺重载自动找回全部修改；新增无损 pending 导出/重放需另行设计。原失败 store 的安全重建/重放是独立工作；内核释放锁与恢复原 store 不是一回事。mutate 的获锁失败尚未进入 work，与已经提交 RPC 后保存失败也必须分别说明。

## 验证证据与实施门禁

### 基础实现验收（2026-11-06，未接通生产）

`scripts/test/test-shared-canvas-lock.mjs` 的 17 项隔离测试覆盖排队、取消/期限、迟到打开/取得、业务 finally、释放双错误、递归/顺序、并行 sibling、多 root、容量及不合格目录。传入 `--binary` 后另验证真实 native 下的独立协调器互斥和迟到 handle 关闭，共 19 项；这两项是同进程组合，不冒充跨进程 Host 测试。第二位审核者复核协调器未发现正确 await 用法下的新 P1，发现空批次 P2，已修复并补三项用例。

原生测试 `npm run test:shared-canvas-native-lock` 默认带 `--expose-gc`，包含真实多进程争用、四进程累加、暂停/强杀、正常 environment 退出、worker 销毁、排队/未交付 open 清理、成功 exec 继承、错误关闭及 GC 兜底。Linux 暂停须观测到实际停止态后再检查争用；detached 测试后代在捕获父子关系和启动标识后按身份清理，不按裸 PID 猜测。业务首错与清理错误分别保留，清理失败不输出成功汇总。非 Linux 尚无对应暂停/exec 身份观测工具，这两项明确跳过并列为未验证，不能算全平台通过。

原生实现代理在 Linux x64 的 Node 25.6.0 与 22.23.3 使用同一资产各通过 14 项。主线程独立重建资产字节相同：native 源码 SHA256 `2b44c7185da8aaf6a9a5a8b0bdbbbabd0d80765f4066d5cd5e85803f96b936d1`，资产 SHA256 `af0076668ae76361ecb240a15bc7229e018a3ae93cdf91eb302bec9895c8e69f`。构建脚本输出 `productValidated: false`；不把本机产物视为已签发的发行资产。

主线程使用独立重建资产，在 Node 25 的 `/tmp` 与工作树 XFS 临时目录分别通过最终 14 项 native 测试，后者另通过 19 项协调器测试；路径均为隔离夹具，不操作用户实际 globalStorage。最低 Node/Extension Host 版本及三平台装载不在这些证据范围内。

测试清理补强后，主线程又用 `$HOME/.nvm/versions/node/v22.23.3/bin/node` 对同一重建资产复跑，native 14/14、协调器 19/19 通过；不是复用补强前 Node 22 的测试记录。

现有 store 回归 21/21、模式切换回归（含真实 socket/PTY 结算）、typecheck 和文档链接/元数据校验通过。新增协调器已加入回归目录；CI 契约测试首次因任务数 368→369 的两个固定断言失败（211/213），更新断言且核对新任务存在后，完整复跑 213/213。没有运行完整产品 `ci:verify`、真实旧新 Host 升级或跨平台 VSIX/Remote，不能据此宣布截图故障已修复。

### 旧 store 证据及发布门禁

`docs/references/shared-canvas-lock-research/legacy-version-fence.mjs` 从固定 v0.28.0 commit 用 git archive 提取原源码，esbuild 打包真实 store，不修改其版本读取或锁算法。转换函数为受控夹具，未实现完整迁移器或文件锁后端。执行 `node docs/references/shared-canvas-lock-research/legacy-version-fence.mjs`。

已验证范围是 Linux/Node 25 的旧 store：未知新字段仍允许旧 publish；v2 拒绝新 constructor、既有 publish/mutate/depart 且不覆盖；等待 commit 的旧 publish 在转换后重读并拒绝；已有 mutation 的保存完成后转换才能取得 admission。另检查夹具改变 envelope 时保留 state 和 Runtime binding 值。store 源码 SHA256 为 `bffb5dac0c92155ac62c1b977e11fa8c83be1dc0da2cc72053b8b65ec7d6c012`；前轮 Linux ext4/xfs 的原语实验仍只证明相应 OS 行为。

实施必须依次通过四组门禁：

1. 原生适配：支持矩阵上的 native/Extension Host 装载；同进程独立 open、跨进程竞争、暂停/强杀、fork/exec、错误 close、环境销毁、取消迟到成功、损坏路径均有确定性测试。原生不可用时 v1 文件未被转换。
2. 协议转换：v1 活动/未知 peer 阻断；真实旧 Host 退出后升级；已读 v1 但登记延迟；迁移前后崩溃/取消；备份不匹配与重试；外部占用旧 bootstrap 端口时原文件保持；多 root 部分已转换时只继续未完成 root，不回滚成功 root。
3. 功能语义：旧 Host 迟到启动、历史恢复、reset、模式切换、deactivation 不得绕过新版图写入保护或意外停止仍在使用的会话。v2 接管四阶段、pending deletion、同节点 start/delete、不同 root 并发及相反 root 输入顺序必须通过真实 Host/store 回归。仅能证明 store 拒绝不能替代这一组。
4. 产品安装：三平台 source/packaged 及真实同一 Remote 执行端多窗口；保存图和 Runtime 原 session/PID 保持，恢复原读者/输入；外层版本拒绝提示和升级说明一致，不能静默空画布或重启会话。原有 `test:shared-root-canvas`、`test:runtime-mode-switch-races` 及 Host execution owner 回归之后进入正常 CI。

完整实现前还需将新版共享 envelope 的读取、诊断导出、测试夹具和所有恢复入口统一更新，不能全局替换项目里的 version: 1。本阶段未运行这些产品门禁，未证实旧 Host 完整启动、Windows/macOS、VSIX、掉电或任意网络文件系统；格式拒绝证据也不适用于任意历史版本。

## 对审核意见的处理

### 实施前冷迁移复审（2026-11-06）

第二位审核者重新审查本合同而非旧双锁桥接方案，发现两项阻止生产接通的 P1；主线程核对了当前源码。基础模块可继续隔离实现，但不能据此开放迁移：

1. **旧 Host 未登记不等于无执行能力。** `sharedRootCanvasStore.ts` 先读取，再异步登记；已读 v1 但延迟登记的旧 Host 可能在迁移后使 `ready` 失败。`CanvasPanelManager.ts::restoreLiveRuntimeSessions` 等待 `ready`，但 UI attach 的独立分支（约 20937 行）可从内存原绑定进入 `attachPersistedRuntimeSession`；`isRuntimeSessionRestoreAdmitted`（约 12890 行）没有 store.ready/协议状态检查。固定 v0.28.0 有同一入口；这是源码审计结论，尚未做真实 Electron 交错复现，也未证明后续 stop 已成功。发布前必须落实能排除未登记旧进程、且迁移期间不允许其再次启动的真实冷停机边界；参与者为空、v2 拒绝和用户确认不能单独充当证明。
2. **异步 prepare 不能以空 store map 表示。** `withSharedExecutionMutation`（约 17947 行）在 map 为空或缺 root store 时直接 `work()`；自动恢复对空列表的 `Promise.all` 立即通过；模式切换（约 4092 行）在空 map 时进入普通清理。这些现有分支不能复用作“共享 root 正在准备”。M2 须有独立的 `unprepared/preparing/ready/failed` root 状态，绑定模式/root 代次；准备失败或未完成时禁止业务，不能降级为私有模式。

生产接线须采用 prepare → 严格加载 → 登记并重读 → 首次保存 → 开放业务的顺序，覆盖 trust、editor restore、root 增删、history/reset/template、模式切换以及 UI attach/start/delete/stop/input。退出时取消并结算 prepare，未准入 root 不承担最后窗口清理，rename 后不自动回滚。尚未实现上述状态机或旧 Host 停机控制；原合同第 3 节的迁移准备前提不能只靠更换 store constructor 落实。

### 主线程独立反例验证（2026-11-07）

按用户要求新增 [Host 准入反例探针](../references/shared-canvas-lock-research/host-admission-counterexamples.mjs)。从仓库根运行 `node docs/references/shared-canvas-lock-research/host-admission-counterexamples.mjs`，默认归档固定 v0.28.0 提交及其 attention-protocol 依赖并编译真实 Manager、store、participants；加 `--current` 则测试当前工作树。不复制或重新实现待测准入分支。Manager 使用无构造器的隔离夹具，VS Code API、Runtime 客户端取得与 attach RPC 边界被替代；禁止创建 PTY/子进程，不运行真实 Host 生命周期。

第一项反例在真实 participants.register 前插入显式屏障，旧 store 已同步读到 v1、尚无参与记录时，由夹具将同路径快照原子替换为 v2；释放屏障后执行原 register。实际观察到 store.ready 拒绝，自动恢复也拒绝、没有取得客户端；同一内存节点经真实 attachExecutionSession → attachPersistedRuntimeSession 及其真实准入判断，仍到达隔离 attach RPC 边界。旧 store.mutate 则拒绝且 work 未执行，磁盘 v2 原字节不变。关闭 Host event admission 的对照组完全不进入 attach。这里证明的是绕过 store 准入后可以尝试 Runtime RPC，不是已成功连上、停止或破坏真实会话。

第二项反例在 runtimePersistenceEnabled=true 且存在执行节点时，观察空 map 和非空但缺目标 root 的 map 均直接执行 mutation work；目标 store 存在并拒绝时，work 不执行。空 map 下真实自动恢复可到达 attach RPC 边界；存在 pending ready 时先等待，释放后才到达边界。模式切换的真实分流在空 map 时选择 preserveLiveRuntime=false / preserveRootRuntimeBindings=false 的普通边界，在非空 map 时选择共享离开；夹具在边界立即抛出哨兵，不执行清理。此项证明“仅延迟创建 store”的迁移接法不安全，不代表尚未实现的 prepare 状态机已发生线上事故。

Linux Node 25.6.0 的固定旧版与当前工作树各 9/9，Node 22.23.3 的固定旧版 9/9；通过数表示反例及对照断言成立，不是修复通过。固定旧 Manager SHA256 为 `14f9564514500de00ddfae5519704b096ef8c8cb05f685684e6191be14ad78eb`，当前 Manager 为 `6c85a6ed19e4da9843193f1f29c496d003e905c89e5341201e285d068942e868`；store 与前轮固定旧版证据一致。首跑归档遗漏 attention-protocol，编译失败，补入同一提交依赖后才完成验证；保留首轮日志。打包器对被替代的 node-pty require.resolve 发出提示，相关代码未执行，未加载原生 PTY。

证据从“源码推断”提升为“真实方法的隔离交错反例”，仍不等同 Electron/VSIX 双窗口、真实 RPC、冷停机或生产迁移验收。转换是夹具，不含生产迁移器或内核锁。两个 P1 继续阻止生产接通。

### 前轮审核的处理

迁移 P1 的设计选择收口为受控停写及原路径格式拒绝；它仍需真实 Host 证据，不能仅凭 8 项 store 实验标记验证完成。双锁桥接 P1 通过不采用长期桥接避免进入该路径，bootstrap 只在单 root 持有旧两把锁，完成后完全移除旧锁依赖。生命周期与 store 恢复 P2 分别进入接口合同、故障分类及实施门禁。原研究和当前 TCP 正式实现文档保留，不把待实现设计回写成已经生效。
