---
title: 共享 root 画布同步与模式切换
decision_status: 已选定
validation_status: 已验证
domains: [协作对象域, 项目状态域, 执行编排域, VSCode 集成域]
architecture_layers: [共享模型与编排层, 宿主集成层, 适配与基础设施层]
related_specs: [docs/product-specs/runtime-persistence-modes.md]
related_plans: [docs/exec-plans/completed/runtime-shared-root-canvas-sync.md]
updated_at: 2026-10-11
---

# 共享 root 画布同步与模式切换

## 目标与边界

开启 Runtime Persistence 后，同执行环境、用户 global storage 范围和 root 的画布结构实时共享；关闭时各 Host 持有执行，画布保存归属当前 workspace storage slot。双向切换只在页面关闭/重启边界清理当前模式会话及内容，设置变化当下保留页面。普通未切换关闭遵循原恢复保证，不删除项目文件、用户原始文档或 provider 自身会话文件。多设备、多用户与云同步不在范围内。

调查发现 Supervisor 的直接 delete 会先取消全部 Host 消费信用订阅，导致原窗口收不到后续终态。用户确认共享 delete 应移除各窗口节点，因此本次以结构删除通知收口投影，不要求被删除页面重新显示尾部；stop 仍须保留节点、等待原读者完成自己的终态消费。原受控 8 项诊断脚本保留历史因果，不作为健康产品回归，也不宣称已修改 Supervisor 单独调用 delete 的通知契约。

## 候选方案与取舍

只监听整份快照会覆盖并发编辑。把全部编辑放进 Supervisor 会让 Note/空画布依赖执行进程，并扩大执行协议边界。选用现有 root 文件加短提交互斥与按对象/字段差异合并，各 Host 订阅已提交结果；执行与终端字节权威继续在 Supervisor。

文件锁的过期偷取可能允许两个写者同时提交，故选用操作系统持有的 loopback TCP 独占监听。进程退出时 OS 释放，无 stale 文件锁恢复协议。这个选择增加一个短暂监听和有界端口占用失败，具体边界见后文。

## 正式方案

### 共享结构的提交与观察

`extensions/vscode/dev-session-canvas/src/panel/sharedRootCanvasStore.ts` 的 `SharedRootCanvasStore` 使用 canonical 存储路径标识同 root 文件。`publish` 保存上次本地状态到新状态的差异，在 root 提交锁内读取最新快照、合并差异、写独立临时文件并 atomic rename，生成 `sharedRevision`。待提交差异叠加在新收到的远端结果上，防止尚未落盘的本地编辑被覆盖。自身无远端变化的提交不重建 Host metadata 引用，保护在途执行的身份检查。

节点、分组、边、文件引用及 owner 记录按稳定 ID 合并；不同字段保留，同字段按成功提交顺序决定，位置和尺寸分别整体更新。删除优先于针对旧对象的修改，旧修改不能复活被删节点。冲突的新对象 ID 明确报错。抑制 ID 集合按增减合并，分组计数取最大值，清理悬空边和无效 groupId。没有实现文本字符级协作，同一 Note 正文冲突同样按提交顺序收敛。

共享状态滤除 `pendingLaunch`、终端正文、序号、序列化状态、摘要和本地错误等消费投影；runtime binding 与生命周期仍共享。`fs.watchFile` 以 100ms 间隔观察 revision，避免 rename 更换 inode 导致监听失效。构造后再投影一次已读取快照，覆盖页面读取与订阅建立之间的提交竞态。关闭停止观察，损坏快照拒绝覆盖，提交失败向 Host 报告，后续 publish/flush 保留失败。

root 提交锁端口为 SHA256(canonical filename) 映射到 20000–39999；节点操作锁端口为 SHA256(filename + nodeId) 映射到 40000–59999，两段分离避免节点操作等待内部 root 保存时自锁。监听仅接受并销毁连接，不交换状态，真正数据仍来自受用户存储权限保护的文件。占用每 10ms 重试，5 秒未取得锁明确失败；哈希碰撞保守串行，外部程序长期占用可能导致失败。只承诺 atomic rename 的一致可读快照，不宣称断电后 fsync 持久性或实时延迟硬上限。

### Host 投影与执行身份

`extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts` 的 `writeRootLocalCanvasSnapshot` 在开启模式接入 store；`persistState` 等待共享提交后再保存 workspace 投影，严格保存不把共享失败当成功。`applySharedRootCanvasState` 复用现有 multi-root 分解/组合，保留本地终端瞬态，不通过监听回写制造广播循环；新 live binding 按原 backend/storage/session/kind 重新附着。

远端删除或替换身份只释放本 Host 投影和 reader，不重复 stop/delete 共享执行。stop 后共享轻量节点到达时，现有 reader 保留原绑定直到自身尾部完成；延迟投影保存不能将已清除的 runtime ID 写回共享文件。`withSharedExecutionMutation` 对 start/delete 持有节点操作锁，锁内重新核对原身份，拒绝已删除或替换目标；工作失败也先刷完已排队保存再释放锁。移除 workspace root 时等待旧组合保存后释放该 root 监听；Host 退出在最终保存后释放所有 store。

开启模式使用 global `root-local-canvas/<key>/canvas-state.json`；关闭模式使用当前 slot 的 `private-root-canvases-v1/<key>/canvas-state.json`，不订阅共享文件。关闭模式不重新附着 live Runtime；旧/copied root owner 绑定只在本地解除，保留可解释中断节点，不能停止共享原执行。同一个 storage slot 的历史数据仍属于该 slot，不宣称任意两窗口始终获得不同 slot。

### 模式切换边界

`notifyReloadRequiredConfigurationChanged` 按方向提示用户，继续提供 Reload Window。`cleanupRuntimePersistenceModeSwitch` 比较期望配置与已应用配置，仅在确有差异时建立单一清理 Promise；重启前撤回配置则不清理。清理覆盖当前画布所有 root，包括共享开启模式中的这些 root，并等待原执行严格结算、保存空画布及共享传播。

边界为最后一个活动 editor/panel 页面关闭、模拟 Runtime reload 或 Extension Host deactivation。切换 surface、隐藏页面和普通 Webview 重建不应用设置。关闭后重新打开页面先等待清理、应用新模式并恢复 owner 准入，再读取新模式存储。开启到关闭创建空私有画布；关闭到开启不迁移旧私有内容，但可读取其他窗口仍持有的目标共享 root 数据。某窗口切换关闭时清空的共享 root 会影响其他开启窗口；其他关闭窗口的私有画布不受影响。失败/超时保留失败结果及可诊断责任；最终保存失败恢复本地结算后的画布状态，阻止该次重开继续，不伪报成功。清理不是多 root 全局事务，可能已有部分执行退出或部分 root 提交清空，不能承诺撤销已完成的共享删除。

## 验证与有限结论

Node 22、Linux 与 VS Code 1.141.0 的独立真实双窗口场景通过：第二窗口未注入 owner 画布，创建、移动、卡片 resize、删除传播；双向输入输出、PTY resize、stop、Agent delete 正常；带 live Terminal 切换关闭后 registry 为零，两窗口私有 Note 隔离，再开启不继承私有内容。调试证据分别在 `/tmp/dscshare3`、`/tmp/dscshare4`、`/tmp/dscshare5`，日志 `/tmp/dsc-shared-window-final.log` 和 `/tmp/dsc-shared-window-source-final.log`。订阅竞态补丁和最终配置保护补丁的复验日志 `/tmp/dsc-shared-window-subscription-final.log`、`/tmp/dsc-shared-window-config-final.log` 同样通过，最终窗口工件 `/tmp/dscshare6`。

自动化共享 store 8/8，包括独立子进程并发创建和节点操作串行、删除不复活、几何原子更新、损坏文件保护、工作失败仍提交和初始化竞态。Host 最终 617/617（含最终保存失败及迟到配置保护回归）；类型检查、multi-root helper、存储路径、本地化、smoke runner 环境检查、分页终态、Host 输出信用与 legacy reconnect 通过。初轮 `test:runtime-completed-history` 在未改动 origin/main a39cd8c1 上同样失败：旧测试将新增正常 `execution/deleteBoundary` 诊断当作失去 owner。用户授权修正后，改为精确校验正常请求诊断，并分别验证缺失 owner 的拒绝与正常清理，原完整绑定等断言保持；整套测试通过。历史失败保留，不宣称全量 npm test 通过。

本轮真实共享场景为 Linux 单 root，未新跑 macOS/Windows/Remote SSH 或真实多 root 两窗口；Node 内置 fs/net 路径与既有 multi-root helper 不替代这些产品证据。大画布高频编辑的完整快照读写/比较与每 root 100ms 轮询成本尚未量化。残余范围登记于 `docs/exec-plans/tech-debt-tracker.md`。

修订说明（2026-10-11）：迟到 stop 投影只屏蔽已结束 runtime 身份和生命周期，不覆盖用户新编辑的启动配置；删除/替换节点清除旧投影记录，新增 Host 回归覆盖。
