---
title: 共享画布跨进程锁标准方案调研
decision_status: 比较中
validation_status: 验证中
domains: [协作对象域, 项目状态域, 执行编排域, VSCode 集成域]
architecture_layers: [共享模型与编排层, 宿主集成层, 适配与基础设施层]
related_specs: [docs/product-specs/runtime-persistence-modes.md]
related_plans: [docs/exec-plans/completed/shared-canvas-lock-research.md]
updated_at: 2026-11-06
---

# 共享画布跨进程锁标准方案调研

## 研究结论与边界

2026-11-06 后续：用户同意继续收口迁移与接口后，新增 [迁移与生命周期合同](shared-canvas-lock-contract.md)，选定受控停写、外层格式拒绝和独立 Node-API 适配；新增固定旧 store 的隔离证据，仍未实施。本文保留研究阶段比较及当时未决事项，新设计选择以接续合同为准，不能视作原审核已覆盖该新增方案。

推荐后续采用**稳定旁路文件上的操作系统独占锁**：Linux/macOS 使用 `flock(LOCK_EX | LOCK_NB)`，Windows 使用 `LockFileEx(LOCKFILE_EXCLUSIVE_LOCK | LOCKFILE_FAIL_IMMEDIATELY)`。旁路文件只是固定的锁对象，文件存在不表示正在持锁；是否可进入临界区由内核判断。它不同于“创建 lock 文件、按修改时间判过期、删除后接管”的应用层租约。

这是基于现有约束的工程推荐，尚非已批准实施方案。本次没有修改生产代码，没有选择 npm 依赖，也未改变原 [共享同步设计](runtime-shared-root-canvas-sync.md)。Windows/macOS 原生适配、VS Code 装载、版本迁移和完整故障恢复仍需验证。作用域限定同执行环境、同用户存储范围的协作 Host；不宣称跨机器或任意网络文件系统互斥。

## 故障与代码边界

输入是 0.28.0 的 `2026-11-05T22-54-05-693Z` Host 诊断，`host-messages.json` 记录 22:54:02.244Z 的 `deleteNode → withSharedExecutionMutation → acquireLease` 失败。现场观察到 `127.0.0.1:40730 → 127.0.0.1:2222` 的已建立连接，独立绑定同端口失败。诊断没有保存报错瞬间的连接归属，不能把当前连接身份写成历史已证事实。

仓库输入为 `1dc2c46a`。`extensions/vscode/dev-session-canvas/src/panel/sharedRootCanvasStore.ts` 将 canonical filename 哈希压到 20000–39999 作为 root commit 锁，加入 nodeId 后压到 40000–59999 作为节点操作锁；遇到占用每 10ms 重试，5 秒失败。`extensions/vscode/dev-session-canvas/src/panel/sharedRootCanvasParticipants.ts` 另用 10000–19999 的 admission 锁，等待预算为 90 秒。`mutate` 的顺序是先 flush，再 admission → node → work/flush（包含 commit），最后反向释放；publish 单独取得 commit。不能用一个不可重入锁替换所有层级，否则嵌套保存会自锁。

此机 `/proc/sys/net/ipv4/ip_local_port_range` 为 32768–60999。Linux 官方说明该范围用于自动分配本地端口，`ip_local_reserved_ports` 可排除自动分配，但不禁止其他程序显式绑定。可见“避开常见服务端口”不等于不存在冲突；预留两万端口也不适合作为扩展默认部署条件。[Linux IP sysctl](https://docs.kernel.org/networking/ip-sysctl.html#ip-variables)

原设计排除“过期偷锁”的理由成立，但不应将其泛化成排除所有文件锁：内核文件锁无需依赖心跳或 PID 文件来判定持有者是否仍活着。

## 标准方案比较

| 方案 | 优点 | 与本仓库相关的限制 | 判断 |
| --- | --- | --- | --- |
| 内核文件锁：Unix flock / Windows LockFileEx | 不占网络端口；持有者暂停时不丢锁；资源关闭/进程退出后由 OS 释放 | 需要原生适配与稳定文件身份；网络文件系统单独验收 | 首选研究方向 |
| Windows named mutex | 标准跨进程互斥；可报告 abandoned | 所有权属于线程；异步等待/释放不能任意换线程；须设计命名作用域、ACL 及 abandoned 后状态检查 | Windows 可行备选，文件 handle 方案更便于统一 |
| mkdir / O_EXCL + 心跳，如 proper-lockfile | 纯 JS 接入方便；部署成本低 | 超时接管不证明旧执行者不会继续写；不偷锁则崩溃后需要恢复协议 | 不满足现有严格互斥要求 |
| Linux abstract Unix socket | 无 TCP 端口；最后引用关闭后自动消失；Node 可直接使用 | Linux 专有，作用域受网络命名空间约束；不能当成 macOS 通用方案 | Linux 专项备选，不是三平台统一方案 |
| 文件路径 Unix socket / Windows named pipe | 标准本机 IPC；Node 原生支持 | Unix 崩溃残留路径要安全回收；Windows pipe 的生命周期并不单独证明“同名 server 唯一” | 适合通信，不直接作为统一锁替换 |
| SQLite 事务 | 成熟的数据库并发、原子提交和恢复机制 | 要迁移权威状态才获完整事务收益；长执行操作不能全塞进写事务 | 未来存储升级候选，本次过重 |
| 独立单写者服务 | 集中序列化，Host 不直接并发写 | 新增服务生命周期、选主、RPC、重连和幂等责任 | 不因一个锁故障扩大架构 |

Unix `flock` 的锁关联打开文件描述，独立 open 的竞争者不能同时获得排他锁；所有相关引用关闭后释放。继承/复制 fd 会延长锁寿命，Linux 上普通 flock 与 POSIX fcntl 锁不可假设互通。Apple 同样提供 flock。这里称“标准方案”指成熟 OS 原语，并非声称 flock 是统一 POSIX 标准。[Linux flock](https://man7.org/linux/man-pages/man2/flock.2.html)、[Apple flock](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/flock.2.html)

Windows 可锁住旁路文件偏移 0 的一个字节，即使文件为空也可锁超出 EOF 的区域；独占锁、立即失败、退出释放均有官方定义，但崩溃后的释放延迟依赖系统资源，不能承诺“零延迟恢复”。正常路径仍应显式解锁并关闭 handle。[LockFileEx](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-lockfileex)

Windows mutex 的重复获取和释放与拥有线程相关，线程异常结束后可返回 `WAIT_ABANDONED`，此时要检查被保护状态，不可视作上一操作完成。对 Node 异步任务而言，这是额外适配责任。[Mutex Objects](https://learn.microsoft.com/en-us/windows/win32/sync/mutex-objects)

`proper-lockfile` 公开采用 mkdir 与 mtime 更新判 stale，也说明配置不一致和手工移除等 compromised 边界。依据该机制推导：Host 调试暂停或长时间无法运行时，心跳过期不等于死亡；另一 Host 接管后，原 Host 恢复可能继续临界区。`onCompromised` 不是存储端拒绝旧写入的原子屏障。要允许这种接管，需要写入端检查单调递增的所有权代次（fencing），并拒绝旧代提交；在当前直接写 JSON/rename 的模型里并未具备该设施。本次未做该库的版本级复现，不将上述推导表述为该库任意用法都有已复现缺陷。[proper-lockfile 官方说明](https://github.com/moxystudio/node-proper-lockfile)

Node 文档明确：普通 Unix socket 在进程崩溃后可留下路径，abstract socket 仅 Linux 可用；Windows pipe 在最后引用关闭后消失。不能直接把 TCP 改成路径 socket 后再用“连接失败就 unlink”回收，否则需重新证明回收与新占用间没有竞态。[Node IPC](https://nodejs.org/api/net.html#ipc-support)

SQLite 的并发和恢复服务于数据库事务；它支持多个读事务但同一时刻只有一个写事务。若继续在事务外保存 JSON、执行 stop/delete RPC，数据库不会自动回滚这些外部副作用。将 SQLite 仅当锁服务器还会引入连接和事务级嵌套问题。[SQLite locking](https://sqlite.org/lockingv3.html)、[SQLite transactions](https://www.sqlite.org/lang_transaction.html)

## Node 与现有原生组件的接入选择

Node 24 的公开 fs API 没有可直接替换此处的 flock/LockFileEx 接口，`fs.open('wx')` 只保证创建时路径不存在，不是内核持有的锁。`worker_threads.locks` 仅协调同一进程内的线程，不能保护两个 VS Code Extension Host。[Node fs](https://nodejs.org/docs/latest-v24.x/api/fs.html)、[Node worker locks](https://nodejs.org/docs/latest-v24.x/api/worker_threads.html#worker_threadslocks)

现成绑定可评估 `fs-ext`，但需准确区分源码能力与发布包验收：本次查阅的 upstream master `fs-ext.cc` 已有 Windows `_win32_flock`，底层调用 LockFileEx/UnlockFileEx，不能笼统说它“不支持 Windows”。其绑定使用 NAN/V8，尚未验证指定发行版本、各架构预编译及 Electron/Remote 的构建装载；不建议仅因接口方便直接加入生产依赖。[fs-ext 源码](https://raw.githubusercontent.com/baudehlo/node-fs-ext/master/fs-ext.cc)

仓库已有 Node-API 原生资产构建与平台校验。尤其 `extensions/vscode/dev-session-canvas/native/macos-execution-owner.h::ClaimNamespace` 已使用独立文件、O_NOFOLLOW/O_CLOEXEC、文件身份核对和非阻塞 flock，是可参考的本仓库模式。但它是执行权威的“一次取得、直到退出”接口，没有 release，不能直接拿来处理频繁提交；Linux 同类接口还是 abstract socket，不能假设已有统一可复用锁模块。

推荐后续比较“成熟绑定的指定版本”与“小型独立 Node-API 锁适配器”，优先后者的可控生命周期与现有构建体系适配，但先做跨平台装载验证再定。Node-API 的 ABI 稳定性只覆盖其 API，不等于一个二进制跨 OS/架构通用，也不能给 NAN/V8 扩展同样保证。不能为拿画布锁而启动 PTY/Supervisor，或复用有执行所有权副作用的初始化入口。[Node-API ABI](https://nodejs.org/docs/latest-v24.x/api/n-api.html#implications-of-abi-stability)

## 推荐实现必须遵守的约束（待实施）

**稳定身份。** 在 canonical root 存储下使用独立固定旁路文件，区分 admission、commit、node 三种 scope，节点名用完整哈希而非压缩到端口范围。锁键不含扩展安装版本，否则两个版本各锁各的。Unix 私有目录/文件及符号链接校验可沿用现有安全原则；Windows 要明确 ACL、共享打开模式、禁止删除替换及非继承 handle。不要直接锁 `canvas-state.json`：当前保存会 rename 更换该路径对应的文件。

**不 unlink、不超时偷取。** 普通释放只解锁/关闭，保留空旁路文件；不得后台 GC 仍可能被打开的锁文件。超时只取消尚未成功的获取，不能释放另一仍在执行的操作，也不能释放本操作仍有在途保存的锁。未知资格仍失败关闭。进程退出释放互斥不代表已完成的 stop/delete 能回滚；继任者继续使用快照校验和既有 journal 结算。

**非阻塞和逻辑所有权。** 将原生 tryAcquire 的竞争结果与权限/损坏/不支持错误区分。用异步有界等待管理竞争，避免在 JS 主线程等待阻塞锁，或以大量阻塞任务占满 libuv pool。获取成功与取消竞态必须关闭未交付的 handle。每次临界区使用独立所有权 token/handle，加进程内队列；不能用同一 fd 的重复 flock 代替不同异步调用间互斥。禁止 fd 被 provider 子进程继承，显式 finally 释放，不能依赖 GC。

**保留现有保护顺序。** 初次替换只更换锁后端，不顺便去掉节点锁或扩大锁保护范围。现有 `held: Set<number>` 和 `admissionPort` 是按端口识别已持有 admission；迁移时需要稳定资源键与原调用上下文的所有权证明，不可保留“按数值端口去重”的假设。加入/离开/接管协议、pending deletion 通知和最后窗口清理要覆盖测试。

**通信端口与互斥分离。** Participants 在 60000–64999 探测可用端口并登记 token，是实际通信 listener，不是固定身份锁。可以另行评估 `listen(0)` 后发布实际端口，但这不应替代 commit/node/admission 的确定性互斥。对锁遇占用后换随机端口或启用端口复用，会使两个进程同时自认持锁，应明确禁止。

**错误可解释。** 至少区分 commit/node/admission 的锁等待超时、权限失败、路径损坏、锁后端不支持与协议不兼容；用户提示只解释失败操作和安全重试条件，详细诊断记录 scope、资源键、等待时长、原始错误与后端。若没有可靠 owner 证据，不应声称“另一个窗口正在操作”。

## 升级迁移是独立门槛

旧 Host 只取 TCP 锁，新 Host 只取文件锁时，两者不会互斥。仅增加协议版本文件也不足以阻止不认识它的旧 Host；仅检查一次当前 peer 列表，不能排除稍后启动的旧 Host。

可比较两条路径：一是受控停写迁移，确保所有可能访问该 storage 的旧 Host 已退出且不能再并发进入，然后统一启用新协议；二是桥接版本同时持有两套锁，固定各层获取顺序，在兼容范围内保持与旧写者互斥，再经明确退役边界去掉 TCP。桥接期仍会受原 TCP 冲突影响，不能作为立即根治。切换/回滚都必须有同样的互斥边界，不允许运行时见错即回退另一套独立锁。

本次未选择迁移策略。后续实施计划必须先确定产品可接受的升级边界；不能以“升级后 Reload 一下”代替跨窗口/旧版本准入证明。

## 隔离实验与验证范围

可复现脚本：`docs/references/shared-canvas-lock-research/probe.py`。仓库根执行 `python3 docs/references/shared-canvas-lock-research/probe.py`，只操作随机 TCP 端口、独占临时目录与自己启动的子进程。Python 仅作为 OS 原语实验工具，不是生产依赖。

2026-11-06 在 Linux 5.19.17、Python 3.10.12、`/tmp` ext4 上得到以下六项断言通过：客户端端口阻止监听；flock 排斥竞争者；SIGSTOP 后仍持锁；SIGKILL 后无需删除文件即可重新获取；正常 close 释放；持有期间 unlink/recreate 会让另一个进程成功锁住不同 inode。这最后一项是负面实验，证明必须禁止删除重建锁文件，不是产品可以安全这样做。

机器 global storage 所在 `/home` 为 xfs，`TMPDIR="$PWD" python3 docs/references/shared-canvas-lock-research/probe.py` 在该文件系统临时目录复验同样六项通过。`git diff --check` 与设计注册/元数据核对通过。它仍不是实际产品 store 的集成验收，也不证明 Windows/macOS/NFS/SMB、VSIX、掉电持久性和历史事故中连接身份。

实施后的最低验收应覆盖：独立 Host 并发提交无丢更改；同节点 start/delete 竞争；独立 root 不被哈希碰撞串行；持锁者退出/暂停/恢复；取消与拿锁交错；嵌套保存与同进程异步竞争；升级混用和回滚；符号链接/权限/损坏路径失败关闭；三平台真实 native + VS Code/Remote 装载。回归入口包括 `npm run test:shared-root-canvas`、`npm run test:runtime-mode-switch-races` 及 Host execution owner 对应用例，之后走正常 CI。当前仅调研，未运行这些产品回归，也未声称故障已修复。

## 不作为默认修复的应急措施

增加等待时间只可能缓解短竞争，不处理长期普通连接占用。移到较低端口仍与其他服务及系统配置冲突；Linux 端口保留只影响自动分配，还需管理员和部署策略。关闭未知连接可能破坏远程会话，不自动执行。单纯创建 PID 锁文件也需要处理 PID 重用、命名空间、权限错误和回收者崩溃，本仓库 journal 已有相关技术债，不宜再复制一套恢复协议。

## 独立设计审核（2026-11-06）

用户要求两位 subagent 独立审核，分别负责原语/生命周期与迁移/验收。审核对象为本研究方案及当前源码，不是尚不存在的产品实现；下列问题不能表述为新实现已经发生的故障，也不代表已获得发布批准。

### 迁移与验收审核：Pasteur

审查支持采用文件锁方向，但认为迁移策略必须先定稿。主代理核对了所引源码，接受以下待实施约束：

**P1，迁移/降级门槛尚未关闭。** 这是已有未决事项的确认，不是新发现的 OS 原语缺陷。参与者记录目前没有锁协议能力，旧 Host 的普通 publish 直接取得旧 commit 锁；旧 Host 暂停后恢复或在迁移后启动，均可绕过新文件锁。必须明确停写边界的执行者、覆盖窗口/Remote/storage 范围和禁止旧版重入的办法，不能只检查当前 peer 列表。不能用“关闭持久化”代替普通升级停写，因为最后窗口可能因此清理共享执行。依据为 `sharedRootCanvasStore.ts::publish/read`、`sharedRootCanvasParticipants.ts::Participant` 和既有模式切换契约。

**P1，双锁桥接需要保留旧资源排序和碰撞去重。** `CanvasPanelManager.ts::leaveSharedCanvasesForModeSwitch` 目前按 admissionPort 排序，并递归持有多个 root 的 admission；`withAdmission` 用 `Set<number>` 避免两个 root 哈希到同一 TCP 端口时重复获取。若桥接时只换成新文件键去重，同一 Host 会重复申请自己持有的旧端口；若按新键排序，与旧 Host 的端口顺序相反，会产生循环等待。桥接必须分别表示旧端口和新文件两类所有权，旧碰撞端口只获取一次，但不同 root 文件锁仍各自获取；全局顺序须兼容旧实现。文中“改为稳定资源键”仅适用于去掉旧 TCP 后的最终后端，不能不加区分地套到桥接层。现有 `scripts/test/test-shared-root-canvas-store.mjs` 已有 admission 端口碰撞回归，需扩展为真实旧/桥接实现组合。

**P2，内核解锁与 store 恢复是两件事。** `sharedRootCanvasStore.ts::publish` 会缓存提交失败，后续 publish/flush 持续失败。因此等待者提交超时后，即使原持有者退出释放锁，该 store 也不会自动恢复。这是既有失败关闭语义；实施时应明确保留该语义并如何安全恢复，或另行设计重建/重新准入，不能直接清空 failure 或把“新进程能取得锁”写成原 store 已恢复。

此外，接管期间 `acquireAdmission(join)` 可通过 `tryJoin` 协商成功而不直接取得 admission，桥接设计不能无条件改成等待两把锁全部释放。Participants 请求和磁盘记录还校验 60000–64999 端口范围，`listen(0)` 不是无协议影响的替换，本次不改。参与者依赖 loopback 可达性，文件锁成功不能扩张为跨网络命名空间协作。

验收补充为：真实旧版暂停/恢复、迟到启动与降级；双锁多 root 碰撞及反向输入顺序；接管四阶段和部分 root 仍被其他窗口使用；提交失败后安全恢复；三平台 packaged Host 与两个窗口连接同一 Remote 执行端。上述 P1 阻止未经补全的实施发布方案，不阻止选择文件锁方向。

### 原语与生命周期审核：Copernicus

审查未发现否定文件锁方向的确定性 blocker/P1，认为旁路文件、禁止 unlink、独立所有权和非阻塞等待等原约束正确；不把这些已写出的约束重复计作新增缺陷。实施设计仍需进一步明确以下细节：

进程内队列按稳定资源键与 scope 区分，不能在持 admission 期间用同一不可重入全局队列阻塞 node/commit。共享异步上下文不等于任意并行任务都获得重入资格。release 必须幂等，过期 token 不能关闭已复用给其他操作的原生描述符。纯文件锁阶段的多 root 获取采用所有 Host 一致的全序，不依赖输入遍历顺序或 locale；桥接阶段另遵守上一节的旧 TCP 顺序兼容约束。

`O_CLOEXEC` 只控制 exec 时关闭，不禁止 fork 阶段复制 fd。审查代理报告四项独立 Linux 临时实验通过：dup 重复锁仍属于同一所有权；同进程独立 open 会竞争；设置 CLOEXEC 后 fork 子进程仍可延长锁寿命；最后继承引用关闭后竞争者才能取得锁。这里保留为审查证据摘要，不等同于仓库 `probe.py` 的六项可复现实验，也不证明真实 provider 存在此泄漏。未来必须验证 Host 持锁时的实际子进程创建、exec 失败/退出路径，不能把“设置 CLOEXEC”当作禁止所有继承的完整证明。[Linux flock](https://man7.org/linux/man-pages/man2/flock.2.html)

Windows 固定锁区间应明确为同一偏移和非零长度，例如偏移 0 长度 1；空文件不代表锁零字节。CreateFile 的共享打开、删除限制、ACL 与非继承规则需要写成具体合同。原生适配器须与执行权威的一次性 namespace claim 分离，正常释放及 environment teardown 都应有明确责任，不能依赖 Node-API ABI 稳定性代替真实装载和生命周期验收。

### 汇总结论

两位审查均支持选择本方向，没有发现必须更换底层原语的确定性问题。迁移/降级策略及双锁桥接的排序去重是实施发布方案的 P1 门槛；句柄生命周期、同进程并发、跨 root 顺序、失败 store 恢复与三平台集成为必须细化和验收的责任。研究继续保持“比较中/验证中”，审核通过的是可继续推进的方向，不是产品修复或发布验收。此次未修改产品实现。
