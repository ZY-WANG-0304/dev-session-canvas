---
title: Root 稳定的 Runtime 归属
decision_status: 已选定
validation_status: 验证中
domains:
  - VSCode 集成域
  - 执行编排域
  - 项目状态域
architecture_layers:
  - 宿主集成层
  - 共享模型与编排层
  - 适配与基础设施层
related_specs:
  - docs/product-specs/canvas-multi-root-workspace-support.md
  - docs/product-specs/runtime-persistence-modes.md
related_plans:
  - docs/exec-plans/active/runtime-root-ownership.md
  - docs/exec-plans/completed/runtime-root-ownership-design.md
updated_at: 2026-10-08
---

# Root 稳定的 Runtime 归属

## 1. 问题与范围

PR #295 已合并，本文以 `origin/main@06e9abcf32828325444e8263233537f25bf042a7` 为调查基线，独立处理审核 F-03 / 有限收尾 R1。画板按 root 保存，但新建 live Terminal/Agent 仍按创建窗口的 workspace storage 派生 Supervisor。同 root 在多个窗口的新会话会分散；不同 root 则可能共享进程，增加发现、诊断、退役复杂度和进程故障影响范围。单会话 stop/delete 并不因此跨 root 生效。

原多根设计 §6.8 和规格第 16、17 项曾明确选定 slot 绑定。这是修订设计决策，不倒写成实现违反当时规格。2026-10-08 用户认可后已实施身份、启动准备与 P2 生产接线，进度见 §8；**正常新建已按 root 选路，三平台原生协调已通过，受影响产品验收仍开放，不宣称整体交付**。环境探针和启动竞争的可行性须取得直接证据，不能由文档审查代证。

目标是多根 workspace 作为各 root 画板的组合视图：同一执行环境、用户存储范围、root 身份、Supervisor generation 确定稳定 owner（托管会话的运行时归属）。单根、多根、PaneGallery 和创建窗口不改变它。稳定指找到同一个逻辑归属，不保证 Supervisor PID 永远不变。

本项不重做 PTY、authority 当前状态恢复、分页、completed 无历史或退出完整性；不实现跨 root live 迁移、自动跟随目录移动、多人协作、通用画板多写者事务或跨机器会话托管。Supervisor/机器故障后无需恢复进程或正文；正常结束节点同样不重开历史。已有尾部消费、最终视口、主动取消与未知状态保护保持。

## 2. 基线事实

下列路径均相对 `extensions/vscode/dev-session-canvas/src/`；事实仅来自代码阅读，不作为本轮测试结果。

| 事实 | 主要落点 | 设计影响 |
| --- | --- | --- |
| 单根/多根共享 global storage 下的 root-local 画板；key 为规范化路径 SHA-256 前 24 位 | `panel/CanvasPanelManager.ts` 的 `getRootLocalCanvasStoragePath()`、`createRootLocalCanvasStorageKey()` | 运行时不应另按显示 ID 或 cwd 合并 root |
| Root 存储采用 `path.resolve`，Windows 转小写，不取 realpath；组合 namespace 另用前 16 位，且其 helper 额外 trim | `panel/CanvasPanelManager.ts`、`common/canvasMultiRootComposition.ts` | 显示 namespace 不是运行时身份；路径规则不等于物理文件系统等价关系 |
| Agent/Terminal 新建均调用无 root 参数的 preferred client；默认 base 来自窗口 storage | `panel/CanvasPanelManager.ts` 的两类 `start*SessionWithSupervisor()`、`getRuntimeHostBaseStoragePath()` | 必须同时修改两类和单根/多根入口 |
| Client key 已含 backend/storage，连接 Promise 在单 client 内合并；Host 有 epoch、reader/RPC 退役屏障 | `panel/CanvasPanelManager.ts`、`panel/runtimeSupervisorClient.ts` | 复用这些边界，只把单个 preferred backend 缓存改为 owner 分桶 |
| 排他 claim 已按 canonical storage 建立，但不同 backend 有不同业务端点；systemd unit 在启动前写入 | `supervisor/runtimeSupervisorNamespace.ts`、`panel/runtimeHostBackend.ts` | Claim 可复用；启动准备也须串行，连接失败不能直接解释为 owner 不存在 |
| hello 没有 root/environment/generation descriptor；profile 由路径推断并在创建时检查 | `common/runtimeSupervisorProtocol.ts`、`common/runtimeSupervisorPaths.ts` | 新归属需要显式握手，不能只有目录 hash |
| 创建请求已有 shell/argv/cwd/env/scrollback；配置变化会修改本 Host attach 的 session scrollback | `common/runtimeSupervisorProtocol.ts`、`panel/CanvasPanelManager.ts` 的 `refreshLiveExecutionSessionScrollback()` | 每会话配置与共享进程配置分别处理 |
| Remote SSH 的真实 EH 曾返回 `file:`、空 authority，`remoteName=ssh-remote` | `docs/design-docs/runtime-exit-integrity-production-integration.md` §44 的 Remote 证据 | URI 或 remoteName 单独不足以区分执行环境；不能依赖 Webview 初始化 |

现有 namespace 是排他机制，不是通用环境识别或跨机器锁服务。原生实现和既有跨 backend 测试只能承担其原有证明范围。

## 3. 候选与取舍

| 方案 | 收益 | 不选/选择原因 |
| --- | --- | --- |
| 保留 workspace storage，另设 root 到 slot 的索引 | 改动看似小 | 首个窗口成为永久地址来源；索引争用、slot 清理和旧窗口依赖仍在，不选 |
| 把 runtime 放进工程目录 | 单根/多根自然共址 | 污染项目，受只读工程/共享盘/工作副本复制影响，用户和环境隔离困难，不选 |
| 所有 root 共用一个全局 Supervisor | 进程数较少 | 保留跨 root 故障影响和资源共享，不符合本次 root runtime 目标，不选 |
| 执行端用户级存储，按环境、root、generation 分目录，一 root 一 owner | 与 root-local 画板匹配，复用既有 supervisor | **选定**；代价是多 root 的进程基线成本与共享启动协调，按 §7 有限验收 |
| root UUID 或 realpath 自动合并所有别名 | 可支持部分移动/别名 | 改变现有画板身份，还需迁移和冲突仲裁，本轮不选 |

## 4. 正式方案

### 4.1 身份与适用环境

在 `common/runtimeRootOwnership.ts` 定义纯 descriptor/hash/path 规则，在 `panel/runtimeExecutionEnvironment.ts` 取得执行端输入；两个文件已在 P1 基础实现中新增。Host 从所属 root-local 画板解析 root，不接收 Webview 自报的存储目录。Descriptor 使用固定字段顺序、版本化编码，hash 仅用于命名，握手仍比较完整字段。

    RuntimeOwnerDescriptorV1 = {
      schema: 1,
      environmentKey,
      userStorageScopeKey,
      root: { kind: 'folder', pathPolicy: 'canvas-path-v1', normalizedPath },
      generation
    }

`environmentKey` 是 **实际 Extension Host 执行环境的运行实例**，不是 UI 客户端、SSH 别名、`remoteName` 或窗口 ID。同一次 OS/容器运行内，各窗口必须得到相同值；环境重建或机器重启允许产生新值，因为产品不承诺跨此边界保留 live 进程。重连 SSH 或重启 VS Code 不应改变该值。这样无需为已死亡进程维持永久设备身份，也不能借 reboot 改写旧 binding。

选定以平台提供的启动与隔离范围信息生成摘要，不在 `globalState` 随机生成一个会被复制或共享的“机器 ID”。P1 的来源为 Linux `/proc/sys/kernel/random/boot_id` 及 `/proc/self/ns/{pid,mnt,user,net}`，macOS `sysctl kern.bootsessionuuid`，Windows 经小型只读 native probe 读取 `SystemBootEnvironmentInformation.BootIdentifier`；Unix uid、Windows SID 属用户范围。不采用 `kern.boottime`、CIM `LastBootUpTime` 或近似 uptime，因为墙上时钟变化可能导致同一活跃环境换 key。平台适配须使用结构化 API/输出，设有界失败；具体调用、权限与稳定性仍待 P1 同宿主双进程/重连核对，读取不支持则 unknown，**不得带着猜测进入 P2 默认接线**。只增加有限 probe，不建立身份服务；若需更新原生资产，必须补受影响构建/加载验证，不能以“复用旧矩阵”跳过新字节。原始 OS 标识不写遥测、公开工件或节点 metadata，仅保留私有摘要与来源版本。

Linux 的 namespace 必须覆盖实际端点/进程可见范围；若 systemd user manager 与 EH 不处于可证明相同的范围，不跨范围启动，按 §4.3 判断能否使用 detached。Host 与 Supervisor 各自取得环境信息，Supervisor 在 claim、清理 registry/journal 或开放 endpoint 前核对，不能只信 Host 传入的 hash。容器重建视为新环境；容器内身份来源未知则拒绝新建 live，已有 UI/历史仍可打开。共享 HOME 在不同宿主 epoch 下使用不同环境目录，不依赖检测“是否网络盘”；不承诺管理员复制活跃 VM 内存及 OS epoch 后仍识别克隆。不用 `local`、空串或随机每窗口 ID 兜底。虚拟 workspace 不在支持范围，沿用 manifest 限制。

`userStorageScopeKey` 由执行端 OS 用户身份及 canonical `context.globalStorageUri` 共同确定。VS Code 分配相同 global storage 的 profile 可共享，不另用 profile 显示名拆分；不同 user-data-dir、发行渠道或 profile 若具有不同 global storage，则自然隔离。这里不假设所有 VS Code profile 必然分配不同目录。用户级私有存储不可读写或身份不可确定时拒绝新建，不回落 workspace slot 或公共临时目录。Settings Sync/拷贝用户目录不迁移 live owner。

Root 保留现有词法路径语义：使用执行端的绝对 workspace folder 路径，`path.resolve`，Windows 按现有画板策略折叠大小写；不 trim 合法空格，不 realpath，不用 git common dir，不用执行 cwd。真实 root 是 Host 的 workspace folder 与 root-local 归属，显示 namespace 只作查找线索；相互矛盾或存在多个归属时拒绝，不猜第一个 root。单根也必须走同一 resolver。创建前的 cwd 可以帮助用户选定目标 root，选定后的 cwd 变化不改变 owner。

| 输入变化 | Root 身份规则 |
| --- | --- |
| 显示名、folder 顺序、workspace 文件名、单根/多根切换 | 不变 |
| 同名不同路径、nested root、同仓库不同 worktree | 不同 |
| symlink 路径与真实路径、macOS 大小写别名 | 按现有词法规则可能不同，不自动合并 |
| 目录 rename/move | 新 root；不承诺跟随 inode 或迁移旧 live |
| Windows 大小写目录/UNC | 遵循现有画板策略；可识别的大小写敏感冲突应拒绝，不宣称全小写等于物理等价 |
| root 缺失/歧义、虚拟 URI | 不回落其他 root；明确阻止新建 |

完全无 folder 的窗口是独立例外，继续使用明确标记的 `workspace-slot` owner，不与 folder owner 共用目录或冒充 root。此例外只适用于真正零 root，不适用于多根解析失败。后来加入 folder 只影响新会话，已有绑定不变。组合 helper 的 trim 分歧在接线时做具名一致性防护，不扩大成已有画板 key 的批量迁移。

### 4.2 存储、generation 与持久化绑定

新 folder owner 的 base 选为：

    <canonical globalStorageUri>/runtime-roots-v1/
      <environmentKey>/<rootKey>/runtime-supervisor-generations/<generation>/
        owner.json
        runtime-supervisor/

`rootKey` 是版本化 root descriptor 的 SHA-256；user scope 已由 base 限定并在 owner descriptor 中核对。保留现有 `runtime-supervisor-generations/<generation>/runtime-supervisor` 结构，以复用 `common/runtimeSupervisorPaths.ts` 的 endpoint、长 Unix socket 路径处理与平台 provider 选择。`owner.json` 位于 generation base，不混入会清理 registry 的 session 数据目录；它是身份与启动配置描述，不是“进程当前存活”的证明。

为三平台分别分配新的 root-owner generation，与 `terminal-current-state-*-v1` 区分；它包含 owner 握手及当前态能力，不按每个窗口、扩展 patch 版本或启动 UUID 派生。协议/provider 不兼容才换 generation，同一兼容代中的绝对扩展安装路径不参与 owner key。stock 显式对照也必须隔离，不借目录假装当前原生能力。

新 metadata 仍保存完整 `runtimeBackend + runtimeStoragePath + runtimeSessionId + executionKind`，并增加版本化 owner descriptor 或其可校验引用。`runtimeStoragePath` 仍指 generation base，不能混淆为内部 `runtime-supervisor` 目录。Owner 用于新建选路和防串接，完整 binding 用于所有已存在会话的 attach/input/resize/stop/delete，二者不能互相代替。会话 authority、epoch、reader 身份规则不变。

`runtimeOwner` 的归一化结果保留三态：未提供的 `undefined` 仅表示旧格式，合法值为完整 descriptor，提供过但校验失败的输入（含读回的 `null`）归一化为 `null`。后者保留原 backend/storage/session，连接入口明确拒绝，不清绑定伪造终止；有 owner 值或 `null` 而缺路径时，旧 slot 回填与缺地址清理均不适用。只有明确清除原绑定时才同步清除 owner。

旧 live 无 owner 字段时走原协议/原路径，不推导当前 root 新地址；旧缺路径的迁移或历史降级保持原有受控规则。新格式缺失或不匹配 descriptor 时拒绝附着，不降成旧格式绕过握手。远端只连接当前执行端的端点，不引入跨机器 RPC。目录权限保持用户私有，descriptor、registry 和 endpoint 验证不允许任意 metadata 指令创建/清除其他目录；未知/不安全路径失败关闭。

### 4.3 发现、启动竞争与 backend

`getPreferredRuntimeSupervisorClient()` 改为必须接受已解析的 owner；原绑定入口保持显式路径且重连不启动替身。复用 `runtimeSupervisorClients` 的 backend/storage key、client epoch 和单 client connectPromise；preferred backend/fallbackReason 改按 owner key 缓存，失败不能污染其他 root。

每个 owner 的发现顺序固定：先验证 descriptor，探测已知 backend 的现有 endpoint，再考虑冷启动。新 hello 返回 descriptor、实际 backend、generation、provider/profile 及兼容配置指纹；连接成功但身份/能力不符是冲突，不发送业务命令、不杀旧 owner、不静默新建第二个 owner。仅支持旧式 hello、无法返回完整 owner descriptor 的端点不能承接新 owner。

冷启动分两层责任：短期的 **启动准备排他权** 保护 owner descriptor、systemd unit 与启动意图；Supervisor 自己持有现有 **运行期 namespace claim**，保护 registry、PTY 和业务 listener。启动准备排他权采用同类 OS 随进程释放的机制，独立于运行期 claim，不能让 Host 持有运行期 claim 再等待 Supervisor 获取同一锁。取得准备权后重新探测，原子发布完整 descriptor，再写 unit/启动；竞争失败者只有限等待并重新发现赢家。不得用超时删除锁文件、凭 PID kill 或覆盖赢家 unit。Host 消失只释放准备权，不撤销已启动的 owner。

启动意图只保存 launch token、backend、环境/配置指纹及可核对的平台启动身份，不含会话 secret。新准备权持有者先结算前次意图：已 ready 则复用；能证明前次唯一启动已产生并终结其执行主体、且无运行期 owner 时才允许重新启动；spawn 提交与结果之间缺证据则仍 unknown。不能用意图文件年龄、单个 PID 不存在或一次 connect refused 放行。P1/R1-03 必须分别覆盖提交前、提交后/claim 前的 Host 崩溃，并给出可重试或明确未确认的结果；平台证明方法需先定向验证，不以自动清空 pending 达到绿色。

实施采用现有 launcher 的短命准备分支，由持准备锁的进程自己执行上述写入与一次性提交，不把锁交给 Host，也不增加常驻服务。macOS 的 native claim 只有进程级一次取得、没有 release，因此不在长期 EH 中取得准备锁；需要正面检查运行锁时另用短命进程，只探锁、不清理或监听业务。复用现有 native 字节，不为此新增原生 API。

每个 launch token 在所有准备进程合计只能实际提交一次。Supervisor 核对当前 token/backend/owner/指纹，取得运行锁后原子写 `started` 回执；回执不是 ready、进程终态或尾部完成。后继持准备锁时，匹配回执证明该 token 的唯一提交已产生真实主体，成功取得同一运行锁则证明主体已退出，两者共同允许新 token 重试。没有回执，即使锁当时空闲也仍 unknown；仅回执、PID 或 socket refused 均不足。这个判据要求运行锁不提前释放、root unit 使用 `Restart=no` 且不 enable、旧 pending 不重提；不把管理员另行手动启动同 token 纳入自动启动保证。平台与中断用例仍须实测，不能由该证据推论代证 P1 完成。

Linux 优先 systemd 的产品策略保持，但 backend 不是另一个 owner：已有 detached 则复用 detached，已有 systemd 则复用 systemd。fallback 仅用于可证明未创建 owner 且 backend 不支持/不可用的情况；启动请求结果未知、owner claim 被占用、ready 超时或端点不可访问时保留 unknown，不能继续换 backend。systemd unit 的重写同样须持准备权、确认无原 owner/未决启动并核对配置；不能在正常重连时写入另一个窗口的 bundle 路径。冷启动新 owner 只按既有故障后不恢复规则处理自身 session 临时数据，不扫描/清理其他 root 或旧 slot。

具体范围核对采用 `systemd-run --user` 执行短命、只读的 launcher 环境 probe，比较 nonce、执行环境摘要和用户摘要；不从 D-Bus 返回的 PID 推断本地 `/proc` 身份，因为两者可能属于不同 PID namespace。探针使用服务启动 10 秒、运行 10 秒、停止 2 秒预算及 control-group 清理，调用方另有 15 秒/16 KiB 预算；不传入实测 manager 拒绝的 transient job timeout 属性。排队 job 可能在调用方超时后才执行只读 probe，超时继续 unknown，不重试弱化参数、不据此启动会话或 fallback，也不冒充 probe 已退出。明确工具/总线不可用或摘要不符才判为 unavailable，权限、超时和格式错误均保留 unknown。该 probe 不创建会话、不替代 owner 握手，也不证明所有系统排队条件下的后代绝对退出时限。

准备调用的 Host 总预算为 30 秒；结果返回后最多等 helper 资源关闭 1 秒且不超总预算。完成依据是标准 close，或进程 exit、stderr close、IPC disconnect 三个事实均已观察到；父方主动 disconnect 可令 Node 不再发 aggregate close，不能只等该事件，也不能只用 exit。超时或 IPC 断开只表示结果未确认，不代表 helper 已退出、准备权已释放或 Supervisor 已停止。持锁 helper 在取消检查点停止后续动作；intent 已发布而提交未确认时保持 pending，后续不得自动擦除。launcher 与 Supervisor 构建使用相同资源准入常量，避免启动意图和实际兼容指纹不一致。

该调整在 `panel/runtimeHostBackend.ts`、`panel/runtimeSupervisorClient.ts`、`supervisor/runtimeSupervisorNamespace.ts` 与 `runtimeSupervisorMain.ts` 内有限落地，不增加全局发现 server 或数据库。跨 Host 的唯一性必须用真实两个进程证明，单 client Promise 不代证。

### 4.4 创建、设置与资源边界

`CanvasPanelManager.ts` 的 Agent、Terminal 两条创建入口在准备 replacement 后，使用节点所属 root 调用 owner resolver。模板物化、Explorer cwd、命令面板和 PaneGallery 只影响目标 root 选择，不分叉运行时策略；模板不复制 live metadata。等待 owner 期间仍重新验证原节点/操作身份，保留 create 结果未知时不得重复启动的既有屏障。

每个 create 请求继续携带已由当前 Host 解析的 shell、argv、cwd、env 和初始 scrollback，不能让第一个窗口的 Supervisor inherited env 充当后来会话的配置。进程级 provider、协议和资源准入策略由 generation/兼容配置指纹确定；不兼容时拒绝新建，不覆盖运行中 owner，不另开同 owner 的进程。不把每会话 cwd、凭据或主题纳入进程指纹，也不在 descriptor 保存 secret。

已有 session 的有效 scrollback 和终端状态以 Supervisor 为权威；附着、窗口打开和 root 重排不重新套用该窗口默认值。用户显式改设置时，沿用当前作用于本 Host 已附着 session 的热更新语义，按 Supervisor 实际接受顺序 last-writer-wins，并向所有消费者传播实际值；不自动反向重发本窗口偏好。输入和 stop/delete 仍是共享 session 控制，resize 保持既有 last-writer-wins。新建其他 session 可以使用另一组配置，不扩成全仓库设置同步。

持久化模式按 session 的实际归属处理。新窗口的默认开关不能把已附着 live session 悄悄转为 Host-owned；原 root binding 可在窗口默认 false 时重连，但不能绕过 workspace trust。默认 false 的普通关闭/模拟 reload 保留 root 原绑定并只释放本 Host 责任；用户明确 true→false 仍严格清理本画板精确绑定，失败保留原绑定，不提前 dispose，绝不按 root 直接 kill Supervisor。旧 slot 保持原有设置契约；不为本项增加设置 receipt 或改写 loadState 重置规则。移除保留画板的 root 同样只释放本 Host 的订阅、reader 和 client。

一 root 一进程会增加多 root 的固定开销。只在首次新建需要时启动，不为显示空 root 或历史节点预热 Supervisor；保留已交付的每 owner 资源准入、当前态恢复和空闲退出机制。不能把原单 Supervisor 十会话证据当成十 root 十进程预算；P3 增补具名三 root/双窗口样本，记录实际进程数、内存、reader 与交互，不恢复旧 64/128 MiB 硬门槛，不承诺任意 root 数固定总 RSS。

本项不声称解决同一节点跨 Host 同时点击启动或 root-local 整图并发保存的通用事务问题；现有操作身份/结果未知保护不得回退，实际阻塞本项有限场景的具名缺陷才进入本计划，其他问题按原技术债边界保留。

### 4.5 旧绑定、关闭与退役

原绑定永远优先于当前新建选择。一个 root 在过渡期可以同时有新 root owner 会话和多个旧 workspace owner 会话；一个旧 owner 也可能仍含多个 root。恢复、重新启动前的旧执行清理与删除按各自精确 binding 进行，不批量改写 metadata，不要求先关旧 owner 才允许另一个节点新建。

`retireLegacyRuntimeSupervisorClientIfUnused()` 不再以“唯一 current path”区分新旧：当前 owner 集合按 root 维护，退休判断按实际 client 上的 live/reattaching session、reader、未决 RPC 和回调责任。Host 释放 client 不等于命令 Supervisor 退出；后者仍在所有连接、会话和未结责任均收敛后自行闲置退出。移除 root、关闭最后一个本地视图或 profile 改变，均不能推断其他窗口不存在。

明确的 root/group clear、模板 reset 或节点 delete 只处理选定集合的完整绑定，允许正常共享 session 在其他窗口同步结束，不终止未选会话。保持旧历史清理的 fresh 原 owner 观察、目标级证据和 `unconfirmed` 保护；`history-restored` 或 registry 旧终态不能单独放宽新旧 owner 的安全边界。不清空整个旧 registry、不顺带退役其他 root。当前页面尾部、最终状态应用、读者取消与资源释放仍分别结算。

不为本项新增历史目录自动 GC：旧记录可保留待现有精确清理或后续独立整理，不能把无引用猜测当作删除资格。版本回退不改新地址或强停新 live；旧扩展无法证明新 owner 能力时明确显示不兼容，旧数据备份仍可用于诊断，不承诺无损降级操控新协议。

## 5. 有限实施顺序与完成定义

| 包 | 交付 | 结束条件 |
| --- | --- | --- |
| P1 身份/存储/握手 | 纯 resolver、平台环境输入、descriptor、独立 generation、兼容协商与启动准备排他原语 | §7 的身份表和双进程最小探针有证据；无法证明环境则明确失败；旧地址解释不变。探针只解决本包输入，不建通用诊断框架 |
| P2 生产接线 | 两类创建显式 root、backend 发现和启动串行、缓存分桶、旧绑定路由、设置与 client 退役 | 受控 Host/Supervisor 回归覆盖正反路径，实际路径不存在隐式窗口 fallback；构建/typecheck 通过。不得只改 multi-root |
| P3 受影响产品验收 | 正常构建/VSIX、多窗口单根/多根创建与恢复、平台端点、旧 live 共存、跨 root 故障和有限资源样本 | §7 各具名场景有明确结果、复用证据与残余风险，随后整体审查；没有自动 P4 工具阶段 |

本设计阶段只完成调查、选择、规格修订与文档审查。实施启动时按本表另建执行 ExecPlan；不把 P1 至 P3 写成此次已完成。实现完成定义是用户在单根和不同多根窗口分别新建 Terminal/Agent 后看见同 root 同 owner、不同 root 隔离，旧 live 仍可操作且最后责任正确结算。只有 attach 已有 session 成功不满足新建归属验收。

## 6. 失败语义与边界

| 情况 | 必须行为 |
| --- | --- |
| root/环境/用户存储未知或不安全 | 拒绝新建，诊断指出哪层未确认；不影响健康其他 root |
| owner descriptor/hello/profile 冲突 | 不发送创建或清理；保留原会话，明确兼容冲突 |
| 已有 owner 未 ready、连接超时、启动结果未知 | 有界返回等待/未知；后续 fresh 观察，不能新建第二 owner 或永久缓存失败为事实 |
| 无 owner 且 backend 确认不支持 | 在同一 owner 身份下按策略选择可用 backend，成功后保存实际 binding |
| reboot/容器重建后的旧 binding | 不改地址、不恢复进程或历史；按照既有失败/历史清理契约处理，不能宣称完整 EOF |
| A root Supervisor 异常 | B 的新 owner、会话和客户端不被关闭；不承诺隔离 OS 全局 OOM 或共享磁盘故障 |

## 7. 验收计划与证据复用

以下是有限验收清单；具体已执行层级见 §8 与实施计划，不由受控回归代证真实产品场景，也不改变 PR #295 或旧 slot 验证结果。

| ID | 有限输入 | 判定与层级 |
| --- | --- | --- |
| R1-01 | 同 path 不同窗口 slot/顺序/显示名；同名不同 path；nested/worktree；空格、大小写、UNC、symlink；rootless 转 folder | 纯函数与 Host 回归：相同/不同 owner 符合 §4.1，不从 cwd 或 display id 猜测，不迁移旧 binding |
| R1-02 | 两 EH 进程、重新打开窗口、Remote SSH `file:`/空 authority 且无 Webview；不同用户/存储/执行环境；睡眠/调时/Windows Fast Startup | 平台 probe 与一个真实 Remote 路径：活跃环境不误换 key，重建后隔离；核对 EH/systemd namespace；未知来源 fail closed，不以合成 authority 代证真实 Remote |
| R1-03 | 双 Host 同时为同 root 分别创建；不同 backend 偏好、winner 延迟 ready、prepare 崩溃、配置冲突 | 受控失败注入加真实双进程：只有一个 owner，loser 不删数据或覆写 unit；未知不 fallback；后续 fresh 重试不被缓存锁死 |
| R1-04 | 窗口 A 单根、B 含相同 root 的多根，交换先后，分别新建 Terminal 与真实 Agent | 同 root 的新会话实际 backend/storage/owner 相同，不只测试 attach；重开仍原 session/authority；PaneGallery 切换不改 owner，不重演长历史 |
| R1-05 | 三 root/双窗口，A owner 在隔离夹具内故障；关闭 B 的一个窗口、移除/重加 root、root-scoped clear | 其他 root 输入/输出继续；keep 仅 detach，clear 仅明确 session；记录三 owner 基线资源和空闲退役，不压旧合并预算 |
| R1-06 | 原 workspace slot 的旧 live 与新 root owner 并存；旧 slot 含 A/B；旧 unconfirmed 后 fresh 观察 | 原 backend/path/session/kind 不改；旧 client 等最后 reader/RPC 收敛；删除 A 不处理 B；丢路径不接管。沿用既有历史清理夹具 |
| R1-07 | 两窗口默认 shell/env/scrollback 不同，显式 scrollback/resize 更新；一侧关闭或切模式 | 每会话参数独立；attach 不覆盖有效值，明确修改按已确认顺序传播；模式不由新窗口偏好偷偷改写；尾部/最终视口/未知结算不回退 |
| R1-08 | 最终同版 VSIX，现代 Linux/macOS/Windows | 各平台验证 root 新建/双客户端发现/关闭后恢复与端点隔离；Linux 补 systemd/detached 竞争。真实 Codex/Claude 的既有启动和尾部证据复用，每种 CLI 补受影响 root 路由/重连；仅修改平台启动链时补对应 CLI 原生用例，不默认三平台全组合 |

复用 `test-runtime-supervisor-namespace.mjs` 的运行期 claim 基础场景、既有 `two-window-shared-runtime`/storage-slot smoke、生产接入 §53.1、有限收尾 §13/§14、当前态恢复及历史清理证据；复用不等于这些测试已证明新的 root owner。不会重复未改 PTY/reader/序列化/六资产构建矩阵。若实现改变了这些边界，必须记录具体影响并补对应原测试，不能为减少工作弱化尾部完整性。

设计阶段验证仅为代码事实复核、独立文档审查、元数据/引用检查和 `git diff --check`。平台来源与并发原语是直接实施前置；永久设备标识、全局资源调度、跨机器共享盘发现、通用多写者事务和历史 GC 是可延期增强，不自动排入下一阶段。历史失败保留在原记录，不转抄为当前待办。

## 8. 实施进度

P3 首轮 `7741de5d` / run `37711694734` 已实际执行：正常 package 成功，Linux/macOS 已安装 Runtime Terminal/Webview 通过；这一步的重开是 completed 空节点，不代证 live 恢复。Windows 在 owner 路径断言失败，日志中实际与预期仅盘符及 User/globalStorage 大小写不同，属于夹具错误；改用平台 path.relative 判定路径等价，并保留不同路径和 POSIX 大小写拒绝的受控测试。Linux 双窗口在五分钟观察期内没有 driver 激活或最终回执，原归档只有一个窗口；已定位先安装产品生成 profile inventory、后仅写入测试扩展目录的加载缺口。上述失败保留，真实 Agent 步骤未执行，不记录为产品通过或产品缺陷。

后续仅修改验收入口时复用 run `37711694734` 的原 VSIX，使用既有包 hash 和具名 installed 成功步骤核对，不重新 build 或重复 Linux/macOS installed。`root_checks=installed/window-pair/agents` 分别选择失败安装项、Linux 双窗口及真实 CLI Reload；跳过安装必须提供该平台同包已通过的 installed 证据。macOS/Windows 各补 Codex root-owner Reload，Linux 补 Codex/Claude，不重跑旧八场矩阵。身份、设置、旧 slot 共存及故障隔离的剩余具名产品输入仍保持开放，未通过工具修改自动销账。

`bd4dab3d` / run `37710935919` 三平台全部通过：Linux 除 detached 及中断组外，实际 systemd 环境 probe、owner 启动、detached 偏好复用 systemd owner 和正常 idle 退役均通过。macOS/Windows 同 root 汇聚、真实 Host helper、中断、未知不重提和正面 claim 释放后重启通过。该脚本没有 PTY，不代证 Terminal/Agent/Webview 产品体验。旧 run 的失败仍保留。

P3 固定入口为 production workflow 的显式 `root_ownership=true`，复用未变六资产重新正常打包一次。新同版包跑三平台已装 Runtime Terminal/Webview，Linux 同 profile 的真实单 A / 多根 A,B,C 两窗口各自新建、关闭/重开、3-owner RSS 单样本与正常退役，以及 Codex/Claude 各一次两轮 nonce 的真实创建/Reload。旧八场 Agent 默认选择保持，不对本轮选择宣称全矩阵通过。双窗口使用实际安装产品和独立测试扩展，不注入节点 metadata；同名 root 不同用户目录不算汇聚。该具名场景不覆盖 owner 故障、设置差异、legacy slot、移除重加或资源增长曲线，剩余 §7 各格仍需按实际证据单列。

当前状态：P2 已将 Agent/Terminal 单根、多根新建切至显式 root target；已有 attach/input/resize/stop/delete 沿原 owner 与完整 binding。受控 wiring 250 项、Canvas context、Host deactivation、completed 无历史回归、typecheck 与正常 build 通过。root 在环境解析、旧绑定清理、owner 获取和 create 返回期间变化会拒绝过时结果；未知 create 保留原责任。真实产品验收已开始但尚未完成。以下段落保留分阶段证据，所述“默认路由不变”仅指当时提交。

P2 独立审查修复恢复 bucket 等连接期间换绑定的竞态：在 await 前捕获原完整 binding，成功 attach 和失败降级均需核对；24 个受控组合先红后绿。`4be42817` / run `37709897962` Linux 的 systemd 范围 probe 修后已 available，但实际 owner 提交仍 unconfirmed，原目录/unit保留，不将范围通过代证启动成功。

本机 systemd 249 另直接确认共享 renderer 将 WorkingDirectory 当作 ExecStart 参数加引号会令 unit fatal；已改 scalar path，保留指令自身转义，启动参数29项与协调24项通过。仍待原生 manager 新结果，不追认旧 run 通过。P2 已同步 main 的0.26.0发布；正常 build/VSIX 打包通过，不代证安装验收。

原生协调 run `37709150155` / `a5f68f17` 的 macOS、Windows 全组通过，Linux 的同 owner 汇聚、真实 Host helper、intent 前取消与提交后崩溃/迟到 ready 已通过，systemd probe 失败并明确报 `Cannot set property JobTimeoutUSec, or unknown property`。因此只移除不支持的 job 属性，保留服务阶段与调用预算，40 项受控 systemd 判定通过，原生修后结果仍待验证。早先 run `37707854830` 的 IPC close 失败和 run `37708504120` 的测试导出缺失原结果保留；后者为夹具缺陷，不扩写为产品缺陷。

2026-10-08 开始 P1 身份/环境/握手基础接入，实施计划见 `docs/exec-plans/active/runtime-root-ownership.md`。仅增加明确的新 root generation，原 current-state generation 与 Manager 默认创建路由不变。原绑定不读新 owner 记录、不被静默升级；新 generation 必须核对完整身份，基础阶段只允许连接，不借旧的自动启动流程绕过尚未接入的启动准备排他。

Windows 只读 boot UUID/SID probe 优先由系统自带 PowerShell 调用固定 native API，不修改 PTY addon、ConPTY 或执行资产格式；其有界失败仍为 unknown，不回退墙上时钟或窗口随机 ID。这是具体调用方式的最小化，不改变环境身份契约。三平台定向 workflow 只运行基础测试与 typecheck，不获取 Agent 凭据、不启动整套旧 PTY 矩阵。实际命令和结果在实施计划中登记；尚未执行的平台不计通过。

本地 pure owner/paths、受控握手 25 项及原 startup/reader 16+31 项通过，typecheck、普通 build 与 diff 检查通过。独立复核补齐保留 root 布局中的未知/错放旧 generation 及 canonical alias 拒绝规则；拒绝不触发 connect/start/claim/cleanup/listen，能力识别仍按精确 generation 枚举。环境受控校验通过，但真实双子进程因沙箱无输出而失败；旧 protocol 在 socket `EPERM` 失败，namespace 未取得 claimant。均不跳过或追认通过，也不将不同工具调用的 namespace 差异当作同环境稳定证据。启动准备排他、三平台原生来源与 P2/P3 仍待完成；现阶段新 root client 显式拒绝未经协调的自动启动。

基础提交 `6688c21e` 的 GitHub run `37657913544` 已取得 Ubuntu 24.04/Node 22.23.3、macOS 26.6.2 arm64/Node 22.23.2、Windows Server 2025/Node 22.23.3 的真实父进程与双子进程身份一致结果；受控握手为 Linux/macOS 各 25、Windows 22，三平台 typecheck 通过。Windows attempt 1 在约 10 秒处原生 probe 返回 unknown，保留 failure；仅重跑失败 job 的 attempt 2 用相同代码/10 秒预算通过，Linux/macOS 沿用首次成功。不将偶发失败归因为已确认系统问题，也不把本次 probe 代证睡眠/OS 调时/重启、实际 SSH 或启动竞争。

后续增量已实现 `supervisor/runtimeRootStartup.ts` 的私有启动 intent/started 原子记录与 Main 校验：缺失或冲突 token 在 claim 前拒绝，回执在 claim 后、任何 runtime 清理前发布，同 token 不得再次消费。`runtimeSupervisorStart.ts` 从 Host 提取现有启动命令，供未来短命准备流程复用；本轮未接通准备排他事务，也未改变 Manager 默认路由。新文件测试是记录语义及真实临时文件验证，Main 测试仍用受控 namespace；它们不证明跨进程启动已完成。

该增量的本地记录测试、36 受控握手/启动、18 启动参数与 31 reader/client、typecheck、普通 build 通过。独立复核修复新 root systemd storage 默认创建为 0755 导致 Main 私有校验拒绝的问题，仅新代创建 0700，旧路径不改；新增参数用例核对这一差异。现有正常 live 尾部/状态/释放机制未改，不重复旧 Agent 或容量矩阵。

提交 `d1fe71e7` / run `37661131732` attempt 1 三平台基础 CI 成功，实际父子身份与临时文件记录测试通过，受控握手/启动 Linux/macOS 各 36、Windows 32，typecheck 通过。旧历史清理本地回归 116 项通过、2 个 socket 用例按既有脚本跳过。启动准备排他事务、systemd manager 范围及真实中断/竞争仍开放，随后才接 P2 生产路由；不宣称 root 稳定归属已交付。

后续实现已接通短命 launcher 准备事务及 Host IPC 调用：私有路径逐级验证，持准备权后重新发现两类 endpoint，已有 owner 不重写 descriptor，pending 不重提，正面运行锁 probe 后才写新 intent/提交。受控测试覆盖私有文件、19 项 Host 生命周期、33 项 systemd 环境判定和 24 项协调/取消边界；原启动参数 18 项、reader/client 31 项、typecheck 和普通 build 通过。实际双进程竞争待新的正常 bundle 验证，默认 Manager 路由仍不变。CI 复用 run `37479044769` 的已验证六架构资产并核对原 SHA/当前原生源码，不重建未变资产。
