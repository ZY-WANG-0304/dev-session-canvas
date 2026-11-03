---
title: Supervisor 按发行版本隔离新会话
decision_status: 已选定
validation_status: 验证中
domains: [执行编排域, 项目状态域]
architecture_layers: [宿主集成层, 共享模型与编排层, 适配与基础设施层]
related_specs: [docs/product-specs/runtime-persistence-modes.md]
related_plans: [docs/exec-plans/active/runtime-supervisor-release-isolation.md]
updated_at: 2026-11-03
---

# Supervisor 按发行版本隔离新会话

## 问题与证据

实现基线为 fetch 后的 `origin/main@da207a9f36fbefb7a318c90d67f6d75b6b77b094`，包含 #360，不以 0.28.0 发布 tag 或原 worktree 的旧功能分支为基线。

2026-11-03 的现场诊断 `2026-11-03T06-27-23-179Z` 显示 Host 为 0.28.0，feature-ldap 的 Supervisor PID 1933928 仍从 0.26.1 安装目录启动。VS Code remoteagent 日志记录 11:38:13 删除旧目录。新会话向旧 Supervisor 创建 provider 时，`linuxExecutionOwnerFactory.ts` 再次解析旧 dist 目录，产生 ENOENT。上述路径与 PID 仅作为该次证据，不硬编码进产品。#356 已删除 Claude 文件活动 hook，它不是当前版本的依赖。

## 正式方案

### 新建身份与旧绑定

新建的 folder-root、原生 `live-runtime` 会话按扩展发行版本分配 Supervisor。同环境、同用户、同 root、同发行版本共享一个实例；不同发行版本即使协议兼容也不共享新建目标。版本从主扩展 package.json 随 Host、launcher 和 Supervisor 打包进代码，不在运行期通过 argv/env 或调用方请求冒认自身版本。

`common/runtimeRootOwnership.ts` 保留 schema 1 descriptor 和原 generation 的解释。在同层 generation 目录名增加 `-release-<SHA-256(version)>` 后缀作为发行实例身份，前缀仍代表协议代际。不增加目录层级或全局发现服务；哈希避免平台大小写、路径字符和长度影响。严格解析原格式与发行格式，不接受任意前缀或路径。已发布无后缀 generation 保持原样，可附着但不再是新版 Host 的新建目标。

`panel/runtimeRelease.ts` 保存打包的当前版本，提供新建 generation 和启动身份断言。该模块读取扩展 manifest，属于集成层，不能放入纯 common。`CanvasPanelManager.resolveRuntimeCreationTarget()` 仅为新会话选用当前发行 generation。已有会话的 attach/input/resize/stop/delete、reader 和重连沿原 backend/storage/session/kind/owner 绑定，不按新版本重新推导。停止后 Start、需要启动新进程的 Resume/Fork 走新建入口；恢复存活连接不是创建新进程。

`runtimeRootSupervisorPreparation.ts`、`runtimeSupervisorClient.ts`、`runtimeRootPreparation.ts` 核对 generation 对应 profile，不再只比较无后缀常量。launcher 和 Supervisor 在存储写入、namespace claim 或 registry 清理前，核对版本化 generation 是否属于自身编译版本；Client 附着历史版本不执行当前发行限制。完整 owner、能力、配置指纹、路径权限及启动意图检查保持。

存储派生的启动锁、运行锁、socket、systemd unit 随版本隔离。新版准备失败或结果未知时不得回退旧 generation、重复提交或覆盖旧 unit。保留 #360 的资格检查与 systemd 策略。只在需要新执行时按需启动，不为显示 root 或恢复旧会话预热。

### 退役与范围

新版 Host 不再给旧实例分配新执行，但不能远程改变旧二进制或旧 Host 的行为。旧会话、reader、最后输出和未决 RPC 按原规则结算，客户端释放后由旧进程自行空闲退出；混版窗口不得误杀对方或把未知绑定写成完成。

这里保证的是新版 Host 管理兼容旧会话，不承诺未升级的 Host 能解释新的发行 generation，或旧、新 Host 同时写共享画布的全部兼容性。升级应让窗口加载新版 Host；不能用新规则反推旧窗口也会自动分流。

本项不新增旧运行时包缓存、不恢复 hook、不重建已死亡 PTY、不增加历史目录 GC、不改 Node/CLI 生命周期、不修改发布版本号。相同版本号不同开发构建的热替换不属于发行升级保证。rootless workspace-slot 和显式 stock 对照维持原规则。

需要保留的原运行资源是仍在执行的 Supervisor/provider/PTY 进程、已加载代码和 native 模块、打开的管道/终端、原 owner namespace、socket、registry/journal 与读者结算状态。持久文件原本就在扩展安装树之外；本次不额外复制整个旧安装目录。此次 ENOENT 对应的是旧 Supervisor **再次创建 provider** 时重新读取旧 dist/native 资源，而不是已运行 PTY 每次输入都要加载该目录。删除临时旧安装树后的 Linux 实测支持这一界限，但不能推广为所有平台、所有未来惰性加载代码都无需磁盘资源。

## 验证方法

纯函数覆盖三平台同版复用、跨版/无版本隔离、非法输入拒绝、路径反解、端点与 unit 区分。Host 测试覆盖两类创建、旧绑定保留、失败无旧版回退及同版双窗。launcher/server 测试核对版本不匹配时没有 namespace/清理/执行副作用。

独立临时目录执行真实 native Supervisor/provider/PTY：旧实例创建会话，移除该旧安装树，新版本启动，旧会话继续输入输出/resize/重连，新会话进入另一实例，最后严格停止和空闲退出。修前保留新建失败反例，修后覆盖连续两个发行身份，不能仅验证一次目录换名。绝不使用用户活动 runtime 作为测试夹具。

自动化、Linux 原生、安装 VSIX/真实 Agent 与 macOS/Windows 产品结果分开记账。没有实际运行不得记为通过；实际结果和剩余限制同步本文及 ExecPlan。

### Review 跟进的门禁约束

原生夹具为旧、当前、下一发行分别保存 Supervisor/provider/PTY 的原始 PID、启动 ticks 与可执行路径；删除会话和父进程空闲退出后，必须逐项观察原身份消失，不能靠父进程退出或新的子树遍历推断。僵尸仍算未退役，无法读取身份或 PID 已复用时拒绝确认；错误清理仅对再次核对原身份的进程发信号，强制清理不能修饰为业务通过。最终 cleanup 再核对同一份清单。

上述异常清理采用 `/proc` 身份复核后向数字 PID 发信号，不是 pidfd 原子发送。Luna 复审未发现确定性 blocker，但指出检查和发送之间的理论性 PID 复用竞态；已观察到的复用会拒绝操作，极短窗口的复用尚未消除。此风险只涉及夹具错误清理，正常成功路径不发信号，登记为后续测试基础设施风险，不宣称原子性保证。

正式 `runtime-release-upgrade` 固定修前源码提交 `da207a9f36fbefb7a318c90d67f6d75b6b77b094`，在私有临时目录导出未修改源码并构建旧 Supervisor、launcher、provider；依赖为当前 lockfile 工具链，native 输入为当前任务同批已校验资产。证据保存提交、构建工具版本、输入与产物摘要；固定提交缺失、导出/构建失败不得回退当前源码。当前代码换历史 namespace 或来源不明的外部目录只可用于本地诊断，正式门禁拒绝。此项证明修前源码与修后实现的升级行为，不是历史原始 VSIX 字节回放，也不是产品旧资源缓存。

## 本轮实现与证据（2026-11-03）

产品实现已完成。构建、类型检查、common 依赖边界、发行 owner/握手、准备客户端与 launcher、路径、Host 上下文、共享 root、生命周期及协议回归通过。发行 namespace 的唯一性测试在实现前失败（5 个输入仅 1 个 namespace），实现后通过。新增启动版本不匹配用例验证未 spawn、未 claim、未写 owner/清理 registry；附着兼容旧版本不受该启动限制。

最初的 schema 1 原生证据仅观察 Supervisor 退出，正式入口还使用当前二进制的历史 namespace。Luna review 指出这两项缺口后，新增 `runtime-release-processes.mjs` 与 `runtime-release-baseline.mjs`，不把旧证据升级为更强结论。加强后的 `test-runtime-release-native.mjs` 在 Linux x64、Node 22.23.3 和 25.6.0 分别从固定修前源码构建旧 Supervisor/launcher/provider，均完成四个具名场景：删旧安装树后旧端新建失败、三个代际并存与原会话身份/交互/reader 不变、旧实例退出不伤新执行、全部实例自然退役。两次 schema 2 报告均记录 3 个 Supervisor、4 个 provider、4 个真实 PTY 的原始身份，并在退役和最终清理中逐项确认消失；`forcedCleanup: []`、`cleanupErrors: []`。旧源码导出目录也在删除旧安装树时删除，不能成为隐形备用运行资源。使用的是 Node 回显程序而非真实 Agent CLI，不冒称 Codex/Claude 产品回合验收。

`test-runtime-root-preparation-native.mjs` 已在当前发行 generation 下通过真实并发准备、同版复用、pre-intent 断连、post-submit 中断无重复提交、native claim 排他、空闲退役，以及本机真实 systemd 启动/复用。这个准备测试不创建 PTY；它与上述升级 PTY 测试互补，不代证零登录存活。

升级回归已作为 `source-build/default/runtime-release-upgrade` 接入正式任务目录，在同批 native assets 构建后运行，显式要求固定修前 SHA 并核对当前 bundle/lockfile 摘要与 Node 版本。具名场景、完整原进程清单、业务截止时间、清理结果和强制清理分别断言；清理成功不能把失败业务改判为通过。7 项定向契约覆盖缺失/错误旧端来源、当前二进制伪对照、原子进程残留/僵尸、复用 PID 不误杀、未知观察以及截止时间和取消。受影响 Host 新建、Resume、停止后换版及失败不回退用例通过 `test:runtime-root-ownership` 的显式过滤入口进入基础回归，不替代整个 Host wiring 文件的验证。

本机结果为 Host 定向用例 19/19、握手用例 49 项、准备客户端 23 项、准备 worker 28 项；Review 增强后 Node 22 的完整 CI 契约 210/210（209.9 秒，此前为 204 项），通过文档索引/链接及 diff 空白检查。这里的 CI 契约测试不是远端完整流水线结果。

尚未执行实际 VSIX 安装升级、真实 Agent 会话（包括实际 Fork CLI）、macOS/Windows 原生升级及完整远端 CI。完整 Host wiring 在原始主线也存在 reset 用例失败，不能宣称整个文件通过；本轮只修订与换版相关的旧重启夹具（其清理必须先于 create，而非先于无副作用的 target 解析）。详细命令、失败对照及后续验收见关联 ExecPlan。
