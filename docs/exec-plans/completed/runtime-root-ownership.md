# 实现 root 稳定的 Runtime 归属

本 ExecPlan 按 `docs/PLANS.md` 维护。用户于 2026-10-08 认可 `docs/design-docs/runtime-root-ownership.md` 并要求开始实施、不要添加不必要设计。实现分支 `runtime-root-ownership` 从 `origin/main@06e9abcf` 建立，带入尚未合并的设计 PR #297 提交；不擅自合并该 PR。

2026-10-08 有限交付结账：P1 至 P3 和 R1-01 至 R1-08 已按正式设计 §8 的具名证据及层级收口，F-03 已完成。最后同包 Claude Reload 的原始资源与结算回执已独立核对；当前只进入实现 PR 审查，不追加 P4。下文 dated 失败和当时的“尚未/下一步”保留为实施历史，不构成当前待办；已知残余登记于技术债追踪，不能用最终成功倒推旧失败已修复。

## 目标与全局图景

同一 root 在单根与不同多根窗口中创建 Terminal/Agent 时，应进入同一执行环境、用户存储范围、root 身份及 generation 决定的 Supervisor。不同 root 按需使用不同 owner，旧 live 沿原 backend/storage/session/kind 操作。owner 是逻辑归属，不是永久 PID；OS 重启不承诺恢复进程或历史，VS Code/SSH 重连不改变仍在运行环境的身份。

本计划严格采用设计的 P1、P2、P3 三个包，不另建发现服务、通用锁框架、诊断框架、历史 GC 或画板多写者事务。若现有机制足以满足不变量，则直接复用。尾部消费、最终状态、reader/RPC 责任与 unconfirmed 保护不能因改归属放宽。

## 进度

- [x] (2026-10-08) 核对设计授权、最新 main 和干净工作区，建立实现分支，带入设计。
- [x] (2026-10-08) P1 基础代码：纯身份/路径、执行端环境识别、独立 generation 与 owner 握手已实现；默认创建路由未改。
- [x] (2026-10-08) 三平台原生父进程/双子进程身份一致 probe：`6688c21e` / run `37657913544`，Windows 首败保留、相同预算失败项重试通过。
- [x] (2026-10-08) P1 启动记录：私有 intent/started、claim 前匹配与 claim 后发布、单 token 拒绝重复消费；提取原有底层启动命令供准备流程复用。
- [x] (2026-10-08) P1 准备事务实现：短命持锁 launcher、单次提交 IPC、私有 descriptor 发布和 systemd 实际环境探针；受控测试与正常 build 通过，默认路由未改。
- [x] (2026-10-08) P1 原生竞争/中断：macOS、Windows 完整组通过；Linux detached 汇聚、真实 Host helper、intent 前取消、提交后中断及迟到 ready 通过，systemd 单列未完成。
- [x] (2026-10-08) P1 原生协调最终组：`bd4dab3d` / run `37710935919` 三平台通过，Linux 真实 systemd 启动/复用/idle已通过；Remote 与睡眠/OS 调时等未执行身份场景保留于 P3 证据清单。
- [x] (2026-10-08) P2 主接线：两类单根/多根新建显式 root；metadata/原绑定/缓存/设置边界与正常 build、受控回归已接通。
- [x] (2026-10-08) P2 独立审查修复 restore bucket await 期间换绑定竞态，24 个定向组合先红后绿，原失效 owner 拒绝与原 client 退休屏障保留。
- [x] (2026-10-08) P3 首轮正常同版 package 与 Linux/macOS installed Runtime Terminal/Webview 通过；Windows 路径夹具失败及 Linux 双窗未激活失败原样保留。
- [x] (2026-10-08) 修复两项夹具并同包验证Windows；独立审查三项产品缺口修后受控回归、正常build/VSIX和三平台原生协调通过。修后同包三平台安装及三平台真实Codex Reload通过。
- [x] (2026-10-08) Linux真实双窗口四会话/三owner/关闭重开/正常idle及实际Remote-SSH身份和完成重开通过。旧slot A/B与新root C共存及最后reader/RPC退役组合回归补齐，R1-06按受控层级收口。
- [x] (2026-10-08) `97f1df49` / `37720714756` 同包 Terminal 反向创建、设置/resize、C keep/readd/clear 和 A 故障隔离通过；独立原始合同/安装 receipt 复核通过，故障 A 不计正常 EOF。
- [x] (2026-10-08) `32f4990f` / `37721421079` 同包 Codex 双窗口独立创建/四次应答/PaneGallery、原进程保持与当前 reader 结算、空 registry 和正常 idle 通过，归档独立核对完成。
- [x] (2026-10-08) `3771be4d` / `37725028656` 同包 Claude 实际 Reload、原 owner/session/authority/进程保持、最终 reader applied 与精确资源清理通过；artifact `11527536604` 独立核对完成。
- [x] (2026-10-08) P3：受影响真实多窗口、Agent/Webview、现代三平台与安装包验收、有限资源样本及产品差异审查完成，按 R1-01 至 R1-08 结账并归档计划；历史未知与未实测边界单列，不自动扩展前置。

## 意外与发现

`3771be4d` / `37725028656` 成功不解释历史间歇失败。本轮 setup 树只有一个原 CLI，另两个记录为已退出的 descendant（executable=null、Z），不能据此认定 `37721390485` 的第二条 CLI 来自相同原因；`37722835410` / `37723822196` 的信任选项回退也未定位。失败 catch 仅复用既有身份白名单观察，先存首次错误、观察失败不覆盖它，38 项受控测试通过，没有修改产品输入或放宽原断言。

`19a00607` / `37723822196` 单独 Down 也出现 Yes→No，未发送 Enter、未到原资源断言，因此之前组合输入不是充分根因。Webview→Host 与 client→Supervisor→provider/native 两端只读核查未见显式重复写路径；Down 后真实事件也无新输入或查询应答，但静态核查不等于实际写入次数证明。停止追加延时/重复导航；仅把已有 setup 进程身份白名单用于失败捕获，先保留首错，不扩大字段/接口/矩阵，Claude 根因仍未知。

`cc1b5ec8` / `37722835410` attempt 1 同包 input/安装身份通过，但固定 VS Code 下载发生 HTTPS ETIMEDOUT/ENETUNREACH，未启动 Claude；仅原失败 job 同代码重跑。attempt 2 在 trust 页超时，尚未资源观察：唯一 Down+Enter 写入后 revision 10 选中 Yes，revision 11 在无新输入时回到 No。不能推断 CLI 内部原因；仅将精确 Claude 页改为一次 Down、观察 Yes 选中再一次 Enter，原总预算/未知页拒绝/资源断言保持，不循环自动重按。

最新 main PR #298 仅测试和文档，实施分支无冲突 rebase 至 `b94ba3cb`，产品打包输入与原 `502934e1` 完全相同。后续 `35e159a9` / `37722179566` 在 input 因原包提交不再是 fetch 到的分支祖先而 `bad object` 失败，没有运行 Claude；只补原包 SHA 显式获取及纯 Playwright 验收目录白名单，仍保持原同包比较与内容 hash，不通过重跑产品包回避归档身份。

`32f4990f` / `37721390485` Claude 已通过实际 readiness 和 BEFORE assistant nonce，随后原启动资源断言记录两个 `cli`，未进入 Reload。原归档未保存 observer entries/events，不能判断第二条是历史辅助进程还是重复执行；观察器按可执行文件分类且断言统计完整历史，但代码可能性不等于本次根因。保持数量/身份/退出断言，仅在既有 sample 后、断言前保存现有无 argv/env 的资源观察结果，再同包定向核对，不扩大通用诊断阶段。

后续归档定位：Terminal `37719235540` 的 B resize 已通过，C keep/readd 时 probe 早于新 Webview JS 加载；四次 root 变更增加等待新 frameId/ready/bootstrapAck，原 5 秒 probe 和总预算不变。实际 driver 四阶段回归先红后绿；没有失败瞬间 lifecycle，不能推断更细丢弃位置。Codex `37719440437` 两窗创建与 BEFORE、multi 的 gallery 往返和 AFTER 通过，single 在 AFTER 前 mountedReader 超时；读取历史消息环中快照的脆弱点明确，但本次是否淘汰缺直接证据。Claude `4ea33105` / `37720113628` 已进入带 model 的真实界面，NBSP 提示符不符合夹具正则导致 readiness 超时；只修已确认匹配问题，不将失败计作 root 产品缺陷。

`21bcd483` / `37719142087` 的 Claude 已越过 Security notes，后续实际信任页默认选中 `No, exit`，夹具直接 Enter 导致 exit 1，未进入 Reload。仅对精确固定页面核对选项后 Down+Enter；已选 Yes 则 Enter，未知布局拒绝且等待页面消失。33 项受控测试及原失败页重放通过，产品包不变，仅重试 Claude。`37719235540` Terminal 边界组在 single 原 reader 应用 scrollback/nonce 后发生 Webview probe 超时；`37719440437` Codex 双窗口失败。两项原始结果保留，根因仍在核对，不能计入产品通过或预判产品缺陷。

Linux run `37715894411` 双窗与 Codex 已通过；Claude 首错是 setup 的 `Timed out: claude interactive surface`，真实页面停在固定 CLI v2.1.280 的 `Security notes:` / `Press Enter to continue`。仅补该精确 onboarding 提示的一次 Enter；未知提示不自动确认，确认后仍须真实 model/composer 与 nonce。原失败未进入 Reload，不能判作 root 产品故障。cleanup 已到 nodes/bindings/pending=0，但因 setup 未完成而缺原进程资源回执，原退出证明断言仍失败；不放宽该断言或追认资源已退出。

修后 run `37714907772` 双窗口已激活并创建真实 subject，但首次 REPLY 的终端行前缀断言超时。subject 在 driver 关闭 ONLCR 后仍只输出 LF；用实际 subject stdout 输入仓库 xterm，80/100 列均复现 REPLY 缩进/折行而精确匹配失败。仅将 subject READY/REPLY 改为 CRLF，原 driver 断言不放宽，受控回归先红后绿。原 artifact 没有终端原文，因此不声称已证明该次 REPLY 到达，只确认夹具错误足以产生此症状；完整链路仍需同包重试。

本轮独立产品审查确认三处受影响缺口：正常completed严格删除漏传owner，被root校验拒绝；默认false窗口恢复失败后，snapshot-only入口可能绕过原binding启动替身；业务socket仍受XDG/TMP环境改变，稳定owner在另一窗口无法被发现（运行锁仍阻止双启）。这些是产品阻塞，不是通用工具增强。分别补完整owner、Host-owned启动保护及新root固定短端点，沿用原尾部/reader/unknown结算。

P3 run `37711694734` 的 Windows installed 日志直接显示规范化 owner 路径与 realpath 仅大小写不同；严格字符串断言不适用 Windows 路径。修正夹具判定，不改产品词法 root 身份。Linux 双窗口 zip 文件列表没有任何 activated/failure/ready driver 回执，只有 window1；当前安装顺序先建立产品 profile inventory、再直接放入 driver 目录，VS Code 的 inventory 扫描不会自动登记该目录。修复明确加载缺口后仍须真实重试，不能只凭静态定位将失败改绿。

run `37709150155` 的 Linux 原始 stderr 明确为 transient manager 拒绝 `JobTimeoutUSec`，此前缺总线地址的分类没有解释或修复此失败。移除两项 job timeout 属性，改服务 `TimeoutStartSec=10s`，保留运行/停止及调用预算；排队可晚启动的只读 probe 不创建 owner，调用超时保持 unknown。不能把这次参数失败写成环境身份不同或不可用，也不能靠失败后重试弱化参数。

P2 独立审查确认：按原 bucket 等 client 期间节点可能改绑，后续成功/失败必须仍比对 await 前原完整 binding，不能 await 后重新捕获新 metadata 却继续用旧 client。该竞态直接影响 root 绑定正确性，本轮定向修复，不扩展通用并发事务。

设计阶段已经确认 client key 含 backend/storage、已有 namespace claim 与 reader/RPC 屏障可以复用；全局 preferred backend 和窗口默认 storage 才是路由修改入口。环境 API 在 Remote EH 可呈现 file URI/空 authority，因此不能由 URI 或 Webview 决定执行环境。具体平台识别实现及结果在此追加，不预写通过。

当前本地沙箱限制原生子进程与 Unix socket：环境测试受控部分通过，实际双子进程输出为空而 exit 1；既有 protocol 测试在 `listen EPERM` 失败，namespace 首例未取得 claim。保留失败、不跳过原生断言。两个独立工具调用运行在不同 namespace，不能替代同环境双进程验证。

基础自审发现旧 lexical alias 若指向新 root generation，可能绕过 owner 校验进入旧启动路径；已在 canonical root alias 上于任何 claim/cleanup 前拒绝，并补回归。这不是改写旧 binding 或迁移权限。

独立复核又发现保留的 `runtime-roots-v1` 布局中未知或错放的旧 generation 会被当作 legacy。已将保留布局识别与受支持 generation 精确枚举分开，Client/Supervisor 对 lexical 与 canonical alias 均拒绝；新增六个用例确认无 connect/start/claim/cleanup/listen 副作用，旧 registry/journal 不变。

## 决策记录

2026-10-08：以具名有限合同完成 F-03，而非要求 provider × 平台 × 创建顺序全交叉矩阵。最终 VSIX 自 `502934e1` / `37714907772` 起产品输入未变，后续只补受影响夹具和实际格；三平台 installed/Codex、Linux Claude、真实双窗、Remote 和受控旧 slot 组合共同覆盖 R1。原 PTY、当前状态恢复及容量证据复用，不由 owner 相同推导新的尾部或长期内存证明。已知 CLI 间歇首败及 OS 额外边界按触发条件追踪，不自动扩为工具阶段；理由是未发现新的确定性产品阻塞，且所有原身份、unknown、尾部及清理断言保持。

2026-10-08：只修两项可证明的 Agent 夹具问题。Claude composer 支持实际 U+00A0 水平空白，保持 model 与两次就绪确认；pairCapture 使用原 attach API 的唯一 requestId 获取当前 reader 快照，不依赖消息环长期保留旧项，并保持实际页面、原 session/authority/进程及 nonce 断言。同 reader 的 relay 与页面按现有实现复用，不重置终端或创建执行；默认 Reload 路径不改。失败时原有 probe/messages 各保存一次，不新建诊断 API。36 项测试先红后绿，实际 Claude 失败页重放通过；不据此关闭真实两组验收。

2026-10-08：R1-02 复用既有隔离 loopback Remote-SSH runner，仅增加 root-owner 的 live-runtime 选择及真实 EH 环境采样。无产品/无画板的 probe 和后续两 EH 比较同一执行环境 key，再核对安装产品的真实 binding；不把合成 URI 或本机 shell 代作 Remote 证据。schema2 使用已有冻结产品 validator/hash 验证 API，不新增兼容规则。production workflow 的 `root_checks=remote` 只接受 Linux、明确同包 reuse 和已通过安装证据，不安装 Agent CLI/传凭据；归档仅允许具名回执，不上传 SSH 私钥或整个 fixture。Remote 和双窗夹具变化不重打产品包、不重跑未受影响原生矩阵。

2026-10-08：审查发现产品阻塞后，取消尚未开始的同包Linux run `37713487916`。Windows夹具定向 run `37713396864` 已success，但它只证明既有断言范围，不证明漏测的Supervisor completed记录已删除。接下来产品修复改变bundle，必须重新正常打包，并补受影响安装/Agent/root端点验收；旧成功的尾部事实保留，不把已知缺口藏在Host bindings=0后面。固定端点选用POSIX UID私有短目录，只对新root代生效，复用已有目录校验，不引入端点数据库。

2026-10-08：同包的夹具定向重试使用 production workflow 原有 reuse_package_run、platform、skip_installed 和 installed_evidence_run；仅增加 root_checks 的固定选择。包身份仍要求产品输入无变化，安装证据仍核对平台具名成功步骤及相同 VSIX hash，允许原 run 因后续另一场景失败。这样保留原失败且不重复成功矩阵，不建立新 runner 或通用诊断阶段。

2026-10-08：先做不会改变默认新建路由的基础增量，取得环境/握手直接证据后再接生产。理由是已选定设计要求未知身份不得启用，不能为了快速更换路径绕过它。P1 不引入用户设置或长期 feature flag；现有入口只在 P2 完整接线后切换。

2026-10-08：身份、环境识别与握手分文件并行实现，主代理负责集成与启动/Host 路由。采用现有 node 脚本测试、VS Code smoke 和 GitHub runner，不另建诊断设施。未改原生资产时不触发重建；若必要修改则只补受影响产物。

2026-10-08：启动准备复用短命 launcher 和独立 namespace，不在 EH 持 macOS one-shot native claim、不改 native 资产。采用每 token 唯一提交、持运行锁的主体发布 started 回执、后继正面探运行锁的结算方式，避免引入 PID 追踪。缺回执的 pending 保留 unknown；started 不代替 ready/终态/尾部结算。完整约束见设计 §4.3，实施与真实竞争验证尚未完成。

2026-10-08：systemd 范围验证使用实际 transient launcher probe，不使用 D-Bus PID 对照本地 `/proc` 的推断，避免跨 PID namespace 的坐标混淆。只增加固定的 probe 模式、nonce/摘要核对及有限 job/运行预算，不新增常驻服务。Host 30 秒结算不当作 helper 退出证据；真实测试观察 close 或实际 claim 释放。

## 结果与复盘

P1 身份/握手/准备事务的三平台原生协调已通过，包括 Linux 真实 systemd 与跨 XDG/HOME/TMP 复用；P2 已切换两类默认新建并保留旧 binding，正常 build、受控回归及具名 restore 竞态修复通过。P3 修后同版包的三平台 installed Terminal/Webview、三平台真实 Codex Reload、Linux Claude Reload、双窗与 Remote、Terminal 边界及 Codex 双窗口已通过，F-03 有限交付收口。旧 slot 保障按明确受控层级复用，不扩成新的 OS 矩阵；历史失败和本地沙箱限制原样保留，不追认通过。

最终 Claude `37725028656` / artifact `11527536604`：一次 Reload 将 EH `2910/6595` 换为 `3112/7247`（PID/startTicks），原 Supervisor `3027/6822`、provider `3040/6850`、唯一 CLI `3048/6858` 身份保持。完整 owner/backend/storage/guarantee/session、authority 不变且 reader 更新，BEFORE/AFTER 真实 nonce 通过、noNewExecution=true；独立 pre-stop 仍观察原 provider/CLI 活跃，产品 stop 后二者均消失，最终 reader applied 至 revision 53。bindings/registry/nodes 为空、pending=0、fallback=[]；仅对已空闲的本轮隔离 Supervisor 发 SIGTERM，不将该动作表述为自然 idle 退出。两阶段安装 payload 相同，VSIX 仍为 `a37f0c3e5afeba5132b5f5eb88104bb36d0670887572c44adbc05cd91097203f`。

本交付不宣称睡眠/OS 调时/Fast Startup、Remote live 断网或 Remote systemd 已实测，也不承诺任意 root 数固定 RSS 或画板多写者事务。双窗测试刻意采用具名保存/关闭顺序；三 owner RSS 仅为分进程样本。历史 Claude 两条 CLI 与信任选项回退仍未知，触发条件和证据入口已进入 `docs/exec-plans/tech-debt-tracker.md`。这些边界不减弱原会话尾部、最终状态、reader 与 RPC 结算要求。

Codex 双窗口 `37721421079` / artifact `11526510881`：原 driver hash、两 installed receipt 和实际 topology 断言独立重放通过；两实际 EH、两个独立新session/authority/provider/CLI、一个原Supervisor，四次nonce与gallery往返通过。multi EH先退出，single两次stop必须经过当时reader的同session/readId applied事件断言，随后registry/bindings空、pending=0，六个执行资源及Supervisor正常退出，forcedSignals=[]，60,397ms、UI exit0。artifact未单独保存最终settlement event，不能把成功路径断言或nonce布尔扩写为末页原始回执。

Terminal 边界 run `37720714756` / artifact `11525926721`：独立运行原 `assertBoundaryCase` 和两窗 installed receipt 均通过，同 VSIX SHA256 `a37f0c3e5afeba5132b5f5eb88104bb36d0670887572c44adbc05cd91097203f`。实际 B 从125x28到109x24，C保留重加仍原会话且nonce成功，clear重加为空；A故障后B原进程/authority与交互保持。54,421ms完成、pending=0、UI exit0，B/C正常idle观察27,917ms。A是明确SIGKILL输入，其4个子资源在清理观察时已退出，仍保留A未知binding/registry，不把全14个原身份最后absent或无额外信号写成A正常EOF。尾部复用既有未改实现证据，不由本次资源退出单独代证。

## 上下文与定向

`extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts` 负责创建、恢复和 Host 生命周期；`common/runtimeSupervisorPaths.ts` 定义 generation/端点派生，`runtimeSupervisorProtocol.ts` 定义握手；`panel/runtimeSupervisorClient.ts` 负责连接/启动，`runtimeHostBackend.ts` 负责 detached/systemd；`supervisor/runtimeSupervisorMain.ts` 持有会话与终端资源，`runtimeSupervisorNamespace.ts` 提供运行期排他。新增纯模块 `common/runtimeRootOwnership.ts` 与执行端 `panel/runtimeExecutionEnvironment.ts` 只承接所需身份逻辑。

## 工作计划

P1 先固化版本化 descriptor、词法 root 和用户存储 hash，再实现有界环境读取，新增独立 generation 而不修改旧路径含义。握手和 Supervisor 启动核对 owner，不能仅相信 Host 传入的 hash。测试必须包含稳定/不同 root、Windows path/UNC、环境未知、旧 hello 拒绝及旧路径兼容。启动准备的排他与运行期 claim 分开，但优先借现有原语，不做可扩展通用协调器。

P2 将两类 start 方法改为传明确 node root，缓存按 owner 分桶；旧绑定 API 保持显式 path，已有 live 重连不启动替身。发现先探现有 backend，不因连接超时生成第二 owner。Host/root 移除只结算本窗口责任，明确 clear/delete 仍按精确绑定。只修接线中可证明的配置/退休问题，不顺手重构整个 Manager。

P3 复用设计 §7 的 R1-01 至 R1-08，按具体改动执行最小受影响集合。真实双窗口需要各自新建而非只 attach；旧 slot 中 A/B 与新 root 并存，隔离夹具故障 A 不影响 B。最终同版 VSIX 跑现代三平台创建/恢复，真实 Codex/Claude 只补路由与重连；未改变 PTY/序列化则复用原证据。三 root/双窗口记录新增进程成本，不压旧 64/128 MiB 观察阈值。

## 具体步骤

所有命令从仓库根执行。P1 用现有 `scripts/test/` 风格新增定向 Node 测试，并运行 `npm run test:runtime-supervisor-paths`、`npm run test:runtime-supervisor-protocol`、`npm run typecheck`；新增测试命令在实现时登记。平台 probe 在临时私有目录/隔离进程中运行，不读取用户节点或修改真实服务。P2 补既有 Host/Supervisor wiring 回归并正常构建；P3 使用已有 smoke/CI 入口，记录确切 ref 与产物，不把受控测试报告成真实页面通过。

## 验证与验收

可观察结果是两个窗口为同一 root 分别新建后 owner/storage 相同、session 各自独立，另一 root owner 不同；关闭窗口后另一窗口仍能输入，重新打开沿原会话和当前终端状态恢复。未知身份/启动结果不能创建替身，旧 live 路径不改、尾部结算不提前释放。P1 平台读取须同环境双进程相等、缺值/权限失败拒绝；CI 没运行的格保持未验证，不用合成平台夹具代证。

## 幂等性与恢复

测试使用本轮私有目录和会话，清理只处理可证明归属的资源；不改用户 registry、旧节点或系统服务。P2 正常新建采用独立 root generation；rootless/显式 stock 及旧 binding 保持原址，未通过的产品格继续开放。版本回退保留实际原绑定，不通过改 metadata 或 kill 旧 owner 恢复工作区。未知启动责任保留并 fresh 观察，不按文件年龄清空。

## 证据与备注

设计 PR #297 当前 OPEN；实现分支包含其已认可文档，不自动 merge。后续将定向命令、结果、原生与受控证明范围写入本节及正式设计，不建立新的证据归档体系。

以下按实施顺序保存当时结果；当前有限验收以“结果与复盘”和正式设计 §8 为准。最终包来源 `502934e1` 在 rebase 后对应 `f5bed327`，最新基线为 `origin/main@b94ba3cb`，原 run SHA 不改写。对原包提交与最终实现的 extensions、packages、manifest/lockfile、build/execution-assets 输入比较无差异；后续不重复打包或未受影响矩阵。

本地执行：`node scripts/test/test-runtime-root-ownership.mjs`、`node scripts/test/test-runtime-supervisor-paths.mjs`、`node scripts/test/test-runtime-root-owner-handshake.mjs`（25 受控项，Windows 不含三个 POSIX 权限用例）、`npm run test:runtime-supervisor-startup-profile`（16+31）、`npm run typecheck`、`npm run build` 和 `git diff --check` 通过。`test-runtime-execution-environment.mjs` 先报告 synthetic cases passed，再在双原生子进程无输出断言 exit 1；`test-runtime-supervisor-protocol.mjs` 为 socket EPERM；namespace 首例无 claimant，均不计通过。

新增 `.github/workflows/runtime-root-ownership.yml` 仅在本实现分支相关 push 或手动入口跑三现代平台的基础测试/typecheck，不含 Agent 凭据或旧原生矩阵。`6688c21e` / run `37657913544`：Ubuntu 24.04/Node 22.23.3、macOS 26.6.2 arm64/Node 22.23.2 的真实父子 probe、25 受控握手及 typecheck 首次通过；Windows Server 2025/Node 22.23.3 首次 probe 约 10 秒失败。仅请求 rerun-failed-jobs 后，attempt 2 的 Windows 双子 probe、22 受控握手和 typecheck 通过，其他平台沿用原成功。预算和代码未变，原失败不改，尚不能定位偶发失败的确切原因。

启动记录增量本地验证：`node scripts/test/test-runtime-root-startup.mjs`（私有临时文件与原子失败）、`node scripts/test/test-runtime-root-owner-handshake.mjs`（36 受控项）、`npm run test:runtime-supervisor-startup-profile`（18+31）、typecheck、普通 build 和 diff check 通过。同 token 第二个新 server 即使取得受控 claim，也不消费第二次、不触碰重新写入的 registry/journal 哨兵。新 root systemd storage 显式创建 0700；旧路径 mkdir/命令/环境参数保持原样。

启动记录提交 `d1fe71e7` / run `37661131732` attempt 1 三平台成功：父子身份 probe、真实临时文件记录测试、Linux/macOS 各 36 及 Windows 32 个受控握手/启动用例、typecheck 均通过。未运行真实 startup-preparation 竞争，因为该入口尚未实施；不把该 CI 当作完整 P1 或产品验收。另跑 `test-legacy-runtime-history.mjs` 为 116 项通过，原有 2 个 Unix socket 用例因环境拒绝访问而按现有脚本跳过，不计原生通过。

准备事务本地增量：`test-runtime-root-owner-storage.mjs`（真实私有文件）、`test-runtime-root-preparation-client.mjs`（19 受控项）、`test-runtime-systemd-environment.mjs`（33 受控项）、`test-runtime-root-preparation.mjs`（24 受控项）、原 startup/reader 18+31、typecheck、普通 build 通过。聚合入口为 `npm run test:runtime-root-preparation`。本机 user bus 为 EPERM，不记录 systemd 原生通过。接下来只增加真实 owner 竞争/复用/退役的有限测试，复用 run `37479044769` / 原资产 SHA `2bdfc311a2fcf4911c09a5bbf86c35579dc12522`；资产源码未变，assembler 继续验证来源，不重跑六架构构建。

`test-runtime-root-preparation-native.mjs` 使用正常 build 的 launcher/Main，覆盖同 root 两准备进程收敛、已有 owner 复用、不同 root 隔离、真实运行锁占用、闲置退出后新 token。Linux 先做实际 systemd probe；可用时验证新建/跨偏好复用，明确 unavailable 则单列 not-verified，unknown 失败。清理仅在 helper close、正面运行锁释放和本轮 systemd unit inactive 后处理具名资源，不 kill 未知进程。pending 场景是磁盘夹具，不能代证真实提交中断。本地执行在 launcher 环境预检得到空 stdout 而失败，尚未提交任何 Supervisor；保留这个结果，由三平台 CI 取得实际协调证据。复用资产的原 run 总结果为 failure，六个 native-assets job 与 package 均为 success，只复用这些原生产物，不追认原 run 整体验收。

提交 `d72b90e2` / run `37706950213`：三平台正常装配/build、受控准备与 typecheck 通过，macOS/Windows 的真实协调全组通过；Linux 已通过同 owner 并发/复用，在 systemd probe 返回 `unknown/environment-probe-failed` 后失败，正常闲置清理完成。该日志没有原 stderr，因此不能把根因预写为总线地址缺失。另行本地定向复现了 systemd 的完整 `$DBUS_SESSION_BUS_ADDRESS and $XDG_RUNTIME_DIR not defined` 固定错误行；新增只匹配这行的 unavailable 分类（独立 reason `user-bus-address-missing`），38 受控测试通过，其他权限/超时/附加诊断继续 unknown。

后续仅补 R1-03 已列出的两例真实中断：临时测试 launcher 在明确 barrier 暂停，intent 前断 IPC并等 helper close；detached 已提交、Main 尚未取得运行锁时终止本轮直接跟踪的 helper，核对 pending 不重复提交、迟到 ready 后复用同 token/PID。原磁盘夹具仍独立保留，真实场景不等同完整 EH crash。wrapper 用既有运行锁原语确认退出，没有生产测试 hook 或新诊断框架；本地仍在原预检处失败，两例待 CI，不写成已通过。

提交 `a11020a5` / run `37707854830` 三平台在新增中断验证失败（Linux/macOS 明确为取消后的 aggregate close 等待超时；Windows 原失败待核对日志）。最小真实 fork 复现及 Node 实现核对表明父方主动 disconnect 后，进程 exit、stderr close、IPC disconnect 均可发生而 aggregate close 不再触发。此问题也影响 Host `prepareRootRuntimeSupervisor()` 的成功结算，不只是测试：本轮修为接受标准 close，或明确观察上述三事实全齐，仍按原 30 秒总预算和 1 秒退出预算。少任一事实仍 unconfirmed，不增加时限、不把 exit 单独当释放。新增两项受控测试（总 21），正常 native 测试同时调用真实 Host helper API覆盖此路径，后续 CI 待验证；不追认原失败。

最新增量本地：Host wiring 250 项（含两类18项 root 创建/跨 await/stale/unknown 回归）、Canvas context、Host deactivation、completed 无历史、typecheck、普通 build 通过。默认 false 的新窗口恢复 root live 不触发转换；显式关闭持久化仍严格清理，失败不 dispose。已有 loadState 实测受控路径足够，无新增配置 receipt。未把这些回归计作真实多窗口/Agent/Webview 通过。

原生 `37708504120` 因测试 bundle 未导出 Host helper API失败，修复夹具后 `37708720165` 与 `37709150155` macOS/Windows通过；Linux已走过真实中断组但 systemd 失败。`37709150155` 捕获 manager 拒绝 JobTimeoutUSec 的直接原因，40项受控系统探针和24项协调用例修后通过，仍需新 CI。上述失败独立保留，不追认绿色。

`4be42817` / run `37709897962` Linux scope probe 返回 code 0 并判 available，修复了属性拒绝；随后 systemd owner 启动返回 preparation/submission unconfirmed，未得到具体底层错误。测试保留原私有目录与 unit，没有强制清理未知 Supervisor。下一步只定位该已触发的 startup 错误，不把 probe 成功记作 systemd owner 已通过。

随后本机 systemd 249 `systemd-analyze verify` 对照确认共享 unit renderer 的独立语法错误：`WorkingDirectory="/tmp"` 与带空格的 quoted 路径均 exit 1/fatal，未加引号的 scalar 路径均 exit 0。已窄修该字段，保留 ExecStart 引号及 `%` 转义，CR/LF/NUL 在写 unit/调用 systemctl 前拒绝；参数29项和协调24项回归通过。新原生失败分支仅记录本轮具名 unit 的 LoadError 等状态，不改原断言，尚不把此本机结论冒充旧 CI 根因已最终确认。

P2 提交 `2d3d4f82` 已 rebase 到 `origin/main@357266ad`（0.26.0 发布），无冲突；正常 typecheck、build 与 `npm run package:vsix` 通过。P3 增量仍在准备，当前包不计安装或真实 Agent 验收通过。

`bd4dab3d` / run `37710935919` 三平台原生最终组全绿，Linux日志明确记录 native systemd startup passed、detached preference reused existing systemd owner，以及闲置退出和正面claim释放后替换；不含PTY。此前两次systemd失败保持原结论，不删除或改绿。

P3 第一组固定执行：`gh workflow run runtime-production-acceptance.yml --ref runtime-root-ownership -f reuse_native_run=37479044769 -f platform=all -f installed_mode=live-runtime -f root_ownership=true`。工作流重新产出同版VSIX，不复用旧产品；三平台仅跑已装Runtime Terminal/Webview，Linux跑新双窗口三root及真实Codex/Claude创建重连。`run-vscode-root-owner-candidate.mjs` 六分钟上限、独立安装测试扩展、同一user-data/profile和实际两EH；未选择故障注入、旧slot、设置差异、remove/readd，不将这些遗漏计作通过。每CLI两轮真实nonce、无工具、无自动重试，不重跑八场矩阵。完成后按R1-01至08核对剩余，不自动加新阶段。

P3 本地受控：Agent reload 21项、安装包输入/收据18项、新双窗口合同39个拒绝场景及staging/真实stdin subject通过；不计实际VS Code。双窗口关闭旧EH后由存续multi保存完整画板再重开，避免把原有跨窗口整图覆盖问题混作本次运行时归属；此顺序显式记入输入/回执，不声称并发保存仲裁已解决。工作流测试的真实Bash子进程在本地沙箱挂起，主动终止exit130；仅以受控stub核对workflow选择/凭据/产物契约通过，不将stub当Bash语法验证，CI package中运行原完整测试。

P3 首轮 `7741de5d` / run `37711694734` package 成功，Linux/macOS installed Runtime Terminal/Webview 成功，Windows路径断言失败、Linux双窗driver未激活失败，真实Agent未运行。本机 VS Code 1.117 的隔离CLI对照确认旧install→stage顺序的profile只登记产品，新stage→install顺序同时登记driver和产品；修正顺序并在原input保存具名driver登记结果，不改变业务扩展或注入metadata。对照目录为 `/tmp/root-owner-profile-old-order-kxBhDO` 和 `/tmp/root-owner-profile-order-EtWHDq`，这是scanner证据而非完整产品验收。

本次补证：安装包夹具19项、双窗口原39个拒绝项及6项登记/顺序拒绝、Canvas context与纯root ownership通过。R1-01新增两类节点共12组root顺序/显示名变化，及两类rootless→folder仍attach旧slot的完整binding断言；均为受控Host，不代证Remote或真实EH。workflow选择/凭据门控受控断言通过，20个生产Bash步骤用直接 `/bin/bash` 原生语法检查通过；原完整Node测试仍在spawnSync Bash处超时124，未记通过。产品输入不变，后续复用首轮原VSIX只重试失败/缺失格。

随后独立审查的产品修复已通过：completed-history两类×新旧binding 4项实际经过生产strict-delete校验，缺owner先红后绿；Host本地入口14项先红后绿，总wiring264项通过；Canvas context、deactivation与typecheck通过。端点paths、握手46项、preparation25项、storage、startup29项、reader/client31项与preparation-client21项通过；握手覆盖只读连接/strict-delete在不安全UID目录无副作用拒绝，Main在socket清理前拒绝。独立复核无新增确定blocker，正常build与package:vsix通过。安装夹具20项加入目标registry删除检查，真实POSIX跨XDG/HOME/TMP helper复用写入已有native脚本，均待修后CI。未更改native资产，禁止将旧包结果当作新字节已验证。

## 接口与依赖

2026-10-08 有限补证入口已实现但尚未原生执行：Terminal `--boundaries` 从multi先行，分别冻结两EH的shell/环境sentinel/scrollback，验证显式scrollback经原reader到实际nonce，resize必须实际改变尺寸且页面与authority一致；C keep/readd与精确clear，最后故障注入已确认身份的A并保持B交互。A故障及其已知资源fixture清理单列，不计正常EOF；B/C仍自然退役。Codex `--root-window-pair` 固定Linux x64、四次model turn，复用原Agent隔离和observer，不新增provider矩阵；两窗独立创建、PaneGallery往返、当前reader applied与原资源退出、registry清空及正常idle分别核对。受控Agent32项、Terminal原39+新增11拒绝项和真实stdin渲染、安装receipt20项通过。工作流三个固定选择必须Linux+同包reuse+明确已通过installed证据；`all`不扩大，Terminal不得获取Agent凭据。原Node workflow test的spawnSync Bash仍受本地沙箱限制，独立直接Bash的24段语法与5组provider选择通过，不把受控stub冒充完整原生测试。

同日整体只读审查覆盖`789888d3`相对`origin/main@357266ad`的17个产品src文件，未发现新的确定性blocker；descriptor/namespace拒绝、准备事务/unknown、hello与strict delete、原binding恢复和默认false保护均与设计一致。补跑握手46、准备25、helper21、Canvas context与startup记录通过。后续待合入的仅验收/文档修改，不改本次同包产品字节。OS睡眠、调时与Fast Startup未实测保留残余，不用合成结果代证；按仓库review规则，未证明影响主路径的额外系统行为不自动变成新的硬件/工具前置。

`common/runtimeRootOwnership.ts` 的 `createRuntimeOwnerDescriptor()` 构造固定 schema/environmentKey/userStorageScopeKey/root/generation，`createRuntimeUserStorageScopeKey()` 和 `resolveRuntimeRootOwnerBaseStoragePath()` 接受 canonical global storage 与已解析 root，不接受 Webview 自报 path。`panel/runtimeExecutionEnvironment.ts` 的 `readRuntimeExecutionEnvironment(): Promise<RuntimeExecutionEnvironment>` 返回摘要及本机用户身份，失败抛出明确错误；Windows 通过系统 PowerShell 调用只读 native API，未修改 PTY 资产。hello owner 字段对旧 binding 可缺省，对新 root generation 必须校验。

修订记录：2026-10-08，按用户认可方案开始实施，固定三包与最小改动约束。

修订记录：2026-10-08，基础实施独立复核补保留目录拒绝规则；记录 25 项受控结果，原生身份、启动准备与产品验收仍开放。

修订记录：2026-10-08，登记三平台基础 CI 与 Windows 原失败；推进启动 token/receipt，不将文件与受控 Main 验证冒充真实启动排他已交付。

修订记录：2026-10-08，切换 P2 创建与原绑定接线，记录异步 restore 修复；有限 P3 复用安装包和真实 Agent runner，新增同一存储范围双窗口场景。systemd 保留未确认结果与直接定位待办。

修订记录：2026-10-08，登记P3首轮部分成功与两项夹具失败，修复profile加载/Windows路径断言，补R1-01缺项及同包定向入口；不重新打包、不扩大通用工具验收。

修订记录：2026-10-08，最后 Claude 同包 Reload 与原始资源结算独立复核通过，P3/F-03 按有限 R1 合同收口并归档；同步设计、规格与技术债，保留全部历史失败及未实测边界，进入实现 PR 而不新增阶段。
