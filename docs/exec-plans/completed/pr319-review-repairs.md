# 修复 PR319 交错保存与最后窗口切换

本计划按 `docs/PLANS.md` 维护。最新评审 head 为 `88a56d51`，运行时代码同 `709c6040`。用户授权处理评审，补充产品规则已在共享画布设计和规格第 11 节登记。

归档边界补充（2026-10-11）：本计划记录 `e79aa66d` 所交付的保存交错修复及最后窗口串行清理，后文“新加入等待最后清理”和“持锁直到原 PID 消失”是当时方案。该 head 复核发现新 Host 自动恢复可提前连接、清空后保留控制连接，使旧 Host 的 45 秒退出检查失败。用户进一步确认新开启窗口可以按清理阶段接管；最新产品与设计定义允许取消未派发的清理、结算已派发动作，并在 Supervisor 仍接受连接时交接责任。此接管协调尚未实现与验收，本计划 completed 及原通过证据不代表接管完成，也不将该实现缺口登记为非阻塞技术债。

## 目标与全局图景

延迟输出保存不能复活 peer 删除或覆盖 peer 编辑；原 reader 收尾期间保留最新共享启动配置。开启窗口切换关闭按 root 判断：有其他开启 Host 时只 detach，最后一个主动切换时才停止/删除当前 root 会话、清空共享画布并确认 Supervisor 进程退出。普通离开不触发清理。新加入、并发离开与执行启动必须和最后窗口判定协调。

## 进度

- [x] (2026-10-11) 读取两条最新评审和产品补充，同步文档 head，保留无关 image.png。
- [x] 在真实 Host + store 回归中锁定 deferred delete/edit 与终态配置交错，修正保存与投影。
- [x] 实现按 root 的开启参与登记、串行切换和新开启协调；加入 process exit 直接证据。
- [x] 验证并发切换、peer 新建、独立进程和 multi-root 分别判定；更新真实双窗口 smoke。
- [x] 同步正式文档和技术债、归档；交付输入收口，按主题分支流程提交并更新 PR319。

## 意外与发现

原 root/node 文件锁只保护提交和单节点操作，没有开启模式参与事实。延迟保存排队时未登记 shared delta，而 reader 收尾直接回放整份旧 metadata。原 smoke 要求第一窗口关闭后 registry=0，与最新产品定义冲突；旧证据保留为历史，不能代证新规则。第一轮新 smoke 已完成最后 peer 的进程退出事实，但在双方重新开启后的并发 reset 发生两条旧 binding 删除未确认；日志和工件保留于 /tmp/pr319-smoke-r1.log、/tmp/dsc319r1。受控回归确认等待原进程退出期间的页面保存可以重建刚清空的 root，已将全部 root 的保存屏蔽前移到 boundary 后、直接清空前。第二轮 /tmp/dsc319r2 和第三轮 /tmp/dsc319r3 的两窗口均完整通过；不把首轮失败隐去。设置在离开期间撤回时，重开必须重新登记，deactivation 必须等原离开结果；这两项另有 Host 回归。

## 决策记录

2026-10-11 / Codex：等待 process exit 时全部 root 的自身共享保存已屏蔽，避免旧页面重建已清空 binding；owner 握手 PID 必须为正的安全整数。设置撤回不能绕过在途离开结果，重开重新建立登记。

2026-10-11 / Codex：开启模式 root 的每个 Host 注册独立参与标识，以存储中的 token 和 OS 持有的专用 listener 核对存活，不使用 Supervisor reader/socket 数判断开启人数。root 参与锁覆盖加入、执行 mutation 与主动离开判定；多 root 按端口再 canonical path 排序取得锁，重复端口复用已持 lease，防止相反顺序死锁。普通退出释放自身参与而不清空画布。最后清理保留参与锁直到原 Supervisor PID 实际消失，使用既有 idle shutdown，而不是强杀 root 或将 registry 空视为进程退出。

2026-10-11 / 用户确认、Codex 记录：接管成功后旧窗口完成自身结算、detach、保存及交接，不再要求被新窗口使用的原 PID 消失。未派发 stop/delete 可取消清理；已派发动作必须结算且不能承诺恢复；仅等待 idle shutdown 时可接管仍接受有效连接的原 Supervisor；不可取消关闭后再正常建立运行时。此决定替代前条关于所有新加入必须等原 PID 消失的约束，具体协调接口待后续实现记录。

## 结果与复盘

实际 Host 新增回归 11/11、完整 628/628、store 独立进程回归 15/15、owner handshake 47 项和 typecheck 通过；真实双窗口第二、三轮及最终 /tmp/dsc319r4 完整通过，最终日志 /tmp/pr319-smoke-final.log exit 0。新增真实产品证据仍以 Linux 单 root 为范围；其他平台延续已有明确边界。

## 上下文与定向

`panel/CanvasPanelManager.ts` 的 `persistState` 分解 root 状态后，deferred 模式到定时器才调用 shared publish；应在排队时登记差异并禁止定时器再次发布旧整图。`applySharedRootCanvasState` 的 reader 保留应以远端 metadata 为基础，只覆盖必要的消费与身份字段。`panel/sharedRootCanvasStore.ts` 持有提交队列、快照观察和节点 mutation；新增 root 参与协调模块只管理开启 Host 及串行判定，不管理终端字节。Supervisor 当前无连接、无 live、无 pending 时 30 秒 idle shutdown；Host 应用独立 process existence 检查，超时明确失败，不发送 kill。

## 工作计划

第一里程碑用 reviewer 的实际 Host fixture 加真实临时磁盘复现两项交错，修复后完整 Host/store 测试通过。第二里程碑实现参与文件与独立 token listener，串行加入/离开；Host 获取各 root 最后资格后仅结算符合资格的 binding，其余 root 只 detach。第三里程碑修改真实双窗口握手：第一窗口私有画布为空、peer 原 runtime 继续输入输出且新建可用，最后 peer 关闭后等待 registry 清理及原 PID 消失。最后同步文档和 PR。

## 具体步骤

在仓库根用 Node 22 运行 `npm run typecheck`、`npm run test:shared-root-canvas`、`node scripts/test/test-host-execution-owner-wiring.mjs`、`npm run test:runtime-completed-history`。真实窗口沿用 Node 22 `/tmp/dsc-release-node22/node_modules/node/bin`、资产 `/tmp/dsc-release-026-assets`、VS Code `/tmp/dsc0261v/.vscode-test/vscode-linux-x64-1.141.0/code`，设置独立 `DEV_SESSION_CANVAS_SMOKE_DEBUG_ROOT` 和 `DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=two-window-shared-runtime` 后运行 `npm run test:smoke`。

## 验证与验收

两类交错必须核对 Host 内存和正式共享文件。参与测试使用独立子进程，验证只会出现一次最后清理、清理失败保留资格、新加入等待最后清理、普通关闭不调用清理及多 root 独立判断。真实场景须核对原 runtimeSessionId、输出、registry 和原 Supervisor PID，不能通过创建替身或固定等待代替直接事实。

## 幂等性与恢复

参与标识由 OS 监听证明；只将明确连接拒绝视为已失效，不把探测超时当作离开。损坏登记拒绝覆盖，最后清理失败保留登记与已产生的可诊断事实。多 root 不提供全局事务；已完成 root 不回滚，但不能清理仍有开启 peer 的 root。临时工作及日志放 /tmp，不修改用户文件或 provider 存储。

## 证据与备注

reviewer 原受控脚本 `/tmp/pr319-review-host.mjs` 可作输入，原第二项旧的“清理新 peer runtime”期望已撤回，必须按最新保留规则编写回归。

## 接口与依赖

仅用 Node fs/net/crypto 和既有 Host/Supervisor 方法。参与对象提供 ready、withAdmission、depart 和 dispose；store depart callback 提供最新 root 状态及最后资格。Host boundary 增加 root 过滤，不修改普通关闭语义。process exit 检查使用原连接握手记录的 PID，无进程强杀。

修订说明：建立最新 review 的实现范围、协调方案及直接验收事实；验证结果随实现更新。


最终证据：`docs/references/shared-root-canvas/pr319-review-repair-evidence.json` 固定四个生产源码、四个验证入口 SHA256 及原运行身份/PID。completed-history、runtime root ownership、startup profile/reader client、localization、multi-root composition 和 diff check 通过。普通 reload 为同 Host 的模拟边界，真实两窗口进程独立；不宣称新增真实新 Host reload 或未执行的其他组合。发布、版本修改、合并不在本计划范围。
