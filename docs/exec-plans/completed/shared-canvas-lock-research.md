# 调研共享画布跨进程锁的标准替代方案

本 ExecPlan 按 `docs/PLANS.md` 持续维护。本次仅交付调研与可复核证据，不实现、不迁移生产锁，不修改系统网络参数。

## 目标与全局图景

解释为何删除节点会与普通 TCP 连接争用端口，并比较不依赖网络端口的跨进程互斥方案。用户应能据此选择实现方向；研究完成不等于产品故障已修复。跨进程互斥指同一时刻只有一个协作 Host 能进入受保护的读写或执行操作。

## 进度

- [x] (2026-11-06) 核对现场诊断及现有 TCP 租约实现。
- [x] (2026-11-06) 核对 Linux/Apple/Microsoft/Node/SQLite 及候选库一手资料。
- [x] (2026-11-06) 在 Linux ext4/xfs 分别完成六项隔离断言，比较七类候选方案。
- [x] (2026-11-06) 同步设计注册表、核心信念及技术债；diff check 和元数据检查通过，研究阶段完成。
- [x] (2026-11-06) 按用户要求由 Copernicus、Pasteur 分别审核原语生命周期与迁移验收，主代理核对迁移源码并记录两份审查结论；未进入实现。

## 意外与发现

当前 Linux 临时端口范围为 32768–60999，与节点锁 40000–59999 完全重叠。现场 127.0.0.1:40730 是到 127.0.0.1:2222 的已建立连接端点，并非监听服务；独立绑定得到 EADDRINUSE。历史诊断未保存当时连接所有者，当前现场不能证明历史连接身份。

仓库 macOS 执行权威已使用 flock，但接口一次获取且不可释放，不能直接当作通用画布锁。upstream fs-ext master 已有 LockFileEx 适配，不能按旧印象说其不支持 Windows；指定发行包与 Electron 兼容仍未验证。实验表明持有期间 unlink/recreate 会允许另一进程锁住新 inode，稳定旁路文件身份是必要约束。

## 决策记录

- 决策：只研究，不改生产实现和已有正式方案。
  理由：用户要求调研标准方案，迁移锁会改变跨 Host 协作协议，需要独立实施与验收。
  日期/作者：2026-11-06 / Codex。

- 决策：推荐内核文件锁作为下一阶段首选，但设计保持“比较中/验证中”。
  理由：Linux 原语实验和官方语义支持此方向，Windows/macOS 装载与新旧版本迁移尚无验收，不将研究推荐升级为生产结论。
  日期/作者：2026-11-06 / Codex。

## 结果与复盘

研究完成。产出 `docs/design-docs/shared-canvas-lock-research.md`、可复现 Linux 原语实验及注册/技术债记录。推荐 OS 持有的旁路文件锁，而非基于 mtime 过期偷取的文件租约。没有生产修复或依赖变更，后续需独立确定原生绑定与版本迁移方案，并通过真实三平台 Host/VSIX/Remote 验收。

两位独立审查均支持方向。迁移策略未定和不完整双锁桥接的排序/碰撞去重构成实施发布门槛；同时补充 CLOEXEC 不消除 fork 引用、同异步上下文不等于并行重入授权、锁释放不使已失败 store 自动恢复等责任。代理临时实验仅保留摘要，不冒充已纳入 probe.py 的回归。

## 上下文与定向

`extensions/vscode/dev-session-canvas/src/panel/sharedRootCanvasStore.ts` 在 publish 中锁住读取、合并、临时文件与 rename，在 mutate 中锁住节点操作及最后的 flush。`extensions/vscode/dev-session-canvas/src/panel/sharedRootCanvasParticipants.ts` 另有 root admission 锁，保护加入、退出与执行准入。三者当前分别使用 TCP 端口范围 20000–39999、40000–59999、10000–19999。现有 `docs/design-docs/runtime-shared-root-canvas-sync.md` 要求操作系统在进程退出后释放互斥，不能因心跳过期让两个写者同时工作。数据保持 JSON 快照，不因本研究迁到数据库。

## 工作计划

先查明各锁嵌套、现有原生组件和测试入口，再读取 Node、操作系统及候选库的一手文档。比较内核文件锁、Windows mutex、目录锁心跳、Unix socket/named pipe、SQLite 与集中单写者。只在临时目录或临时 socket 上做可终止实验，分别说明已验证平台与未验证平台。最后登记设计草案和原锁缺陷，研究计划移入 completed。

## 具体步骤

在仓库根执行 `rg -n 'acquireLease|withAdmission|acquireAdmission' extensions/vscode/dev-session-canvas/src/panel/sharedRootCanvas*.ts` 定位保护边界；检查 `extensions/vscode/dev-session-canvas/native/` 的平台组件。用搜索工具查阅官方文档并保留直达链接。隔离验证使用 Node/Python 标准库，仅操作临时资源；命令与关键结果汇总至设计文档。

实际运行 `python3 docs/references/shared-canvas-lock-research/probe.py`（/tmp ext4）及 `TMPDIR="$PWD" python3 docs/references/shared-canvas-lock-research/probe.py`（/home xfs）；两次均输出六项 true。`findmnt -T /tmp -no FSTYPE,TARGET` 与 `findmnt -T /home/users/ziyang01.wang-al/.vscode-server/data/User/globalStorage -no FSTYPE,TARGET` 确认文件系统。`git diff --check` 与设计 frontmatter/注册表检查通过。

## 验证与验收

研究必须给出候选方案的互斥、崩溃释放、暂停恢复、跨平台、Node 集成、旧新版本混用约束，并明确推荐及其前提。隔离实验至少验证客户端临时端口可阻止监听，以及一种内核锁在竞争/持有进程退出后的行为。最终运行 `git diff --check` 并核对文档注册及链接；没有产品改动，不把文档检查视作产品回归。

## 幂等性与恢复

不占用用户的实际锁文件、不终止现有 TCP 连接、不清理参与者目录。临时实验自行关闭进程和 socket 并删除其独占临时目录。失败不通过更改内核配置或放宽互斥条件继续。

## 证据与备注

现场输入：`/home/users/ziyang01.wang-al/projects/dev-session-canvas/.debug/current-host-diagnostics/2026-11-05T22-54-05-693Z/host-messages.json`，错误时间 2026-11-05T22:54:02.244Z，生产版本 0.28.0，调用链 deleteNode → withSharedExecutionMutation → acquireLease。

实验环境 Linux 5.19.17、Python 3.10.12；六项结果为 tcp_client_port_blocks_listener、flock_excludes_competitor、paused_holder_keeps_lock、sigkill_releases_without_unlink、normal_close_releases、unlink_recreate_breaks_shared_lock_identity。最后一项是负面用例，不能解释成允许删除锁文件。Windows/macOS、NFS/SMB、产品集成与掉电持久性均不在此次验证范围。

## 接口与依赖

本阶段不增加运行时依赖，不承诺尚未验证的原生 API 接口。未来实现需保留 publish/mutate/admission 的保护区语义、明确取消及资源释放规则；推荐方案在设计文档内细化。

修订记录：2026-11-06 创建研究计划，限定只读诊断、隔离验证与设计记录的范围。

修订记录：2026-11-06 完成官方资料、两种本地文件系统隔离验证及设计记录，移至 completed；待实施风险已登记，不表示产品缺陷关闭。

修订记录：2026-11-06 按用户要求完成两位 subagent 设计审核，追加可行动的迁移与生命周期约束；不改变方案待实施、跨平台待验的状态。
