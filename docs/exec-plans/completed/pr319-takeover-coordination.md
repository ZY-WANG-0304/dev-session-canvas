# 协调共享清理期间的新窗口接管

本计划按 `docs/PLANS.md` 维护。评审文档 head 为 `6fd61651`，生产代码为 `e79aa66d`；本轮处理 review 评论 6109671593，保留用户无关 image.png，不合并或发布。

## 目标与全局图景

新开启窗口可在旧窗口清理期间合法接管同 root。旧窗口在没有派发删除时取消共享清理；已派发时先完成不可撤销的结算，再提供最新共享状态。idle 阶段必须由新窗口的有效参与及原 Supervisor hello 共同确认进程接管；确认后旧窗口只完成自身退出，不再等待被接管 PID 消失。关闭已不可取消时等原 PID 消失后正常加入，不冒充原会话延续。

## 进度

- [x] 读取更新评审及四阶段产品规则，核对本地/PR head 和上轮证据。
- [x] 在参与 listener 上实现有界加入/确认交接，自动恢复等待有效参与及最新共享投影。
- [x] 接入 Host 删除边界、逐 root 保留/结算/idle 交接及控制连接释放。
- [x] 新增实际 Host/store 四阶段、失败、迟到保存和 multi-root 回归，验证实际 Supervisor 接管与无接管退出对照。
- [x] 同步正式设计、规格、技术债及输入证据，归档修复与本地验证；后置提交与 PR 回复按仓库工作流执行。

## 意外与发现

当前 root 锁覆盖 45 秒 PID 等待，但构造后自动恢复不等待登记。新窗口提前 attach，现代 reader 移除后仍有 control client，使 Supervisor idle shutdown 无法开始。上轮 store 测试只证明 ready 等待，未证明真实 Host 生命周期；复现输入 /tmp/pr319-rereview-host.mjs 和 /tmp/pr319-rereview-join.log 保留。

## 决策记录

2026-10-11 / Codex：保留 root mutation/提交锁和独立 token listener，扩展同 listener 为加入协商入口。旧窗口持 root 锁期间也可验证新窗口的独立 listener 并登记接管，避免加入与退出相互等待。删除派发前的有效登记取消清理；派发后请求等结算和共享保存完成。idle 阶段先提供原 owner/backend/storage/PID，再由新 Host 使用 allowRestart=false 校验 hello，确认连接后才登记并解除旧 PID 等待。若旧进程已拒绝连接，只有确认 PID 消失才能转正常加入；失败不冒充交接。多 root 的交接独立，锁顺序和碰撞复用保持。

## 结果与复盘

已实现 token listener 协商、分阶段 root 离开、ready 后最新投影与实际自动恢复、经过原 hello 校验的 PID 交接、失败连接释放和现代 reader/control 生命周期。store 20/20、Host 634/634、实际独立 Supervisor 3/3 和 Linux 单 root 真实双窗口复验通过；验证边界已同步，修复工作树和本地验证已收口，按工作流提交到 PR 供 reviewer 复审，不将本轮修复自行解释为 review 已批准。

## 上下文与定向

`extensions/vscode/dev-session-canvas/src/panel/sharedRootCanvasParticipants.ts` 的 token listener 目前只返回身份；`register` 等 root 锁，`depart` 持锁直到 Host callback 完成。新增离开上下文记录 preparing/settling/idle 阶段，listener 接收 join/confirm 请求，探测对端 token 后原子登记。`extensions/vscode/dev-session-canvas/src/panel/sharedRootCanvasStore.ts` 暴露 ready，ready 后重新读最新磁盘再投影；watch 与 Host 自动恢复此前不得使用旧 binding。`CanvasPanelManager.ts` 在实际派发删除 API 前冻结 root 清理集合，已确认接管的 root 只 detach；空画布和旧窗口保存完成后进入 idle 协商，并使用原 hello 收据核对可被接管的 PID。

## 工作计划

第一里程碑实现参与协议及 store ready，受控/独立进程测试验证锁内接管、结算等待和失败不登记。第二里程碑接入 Host 的删除派发和自动恢复，不重新发布过时整图；验证新 Host 的真实调用路径、原 reader/control 生命周期、四阶段和 multi-root。第三里程碑使用真实 Supervisor socket/进程证明合法连接交接能让旧窗口成功退出，同时保留无接管时原 PID 消失的对照；最终真实独立双窗口复验、文档和 PR 同步。

## 具体步骤

在仓库根将 PATH 设置为 /tmp/dsc-release-node22/node_modules/node/bin，运行 npm run typecheck、npm run test:shared-root-canvas、node scripts/test/test-host-execution-owner-wiring.mjs、npm run test:runtime-root-ownership、npm run test:runtime-supervisor-startup-profile、npm run test:runtime-completed-history、npm run test:ui-copy-localization 和 npm run test:canvas-multi-root-composition。实际窗口使用现有 assets /tmp/dsc-release-026-assets、VS Code /tmp/dsc0261v/.vscode-test/vscode-linux-x64-1.141.0/code，以及独立 DEV_SESSION_CANVAS_SMOKE_DEBUG_ROOT 和 two-window-shared-runtime 场景过滤器。

## 验证与验收

分别暂停旧 Host 的派发前、派发后和 idle 点，创建实际 joining Host/store，检查自动恢复时机、磁盘最新状态、原 identity、control client 和旧切换结果。关闭阶段用原进程拒绝连接及真实 exit 事实，不能靠固定等待伪造关闭。失败请求不登记、不解除退出责任；交接后新执行/Note 不能被旧清空或旧快照复活。multi-root 只有接管 root 解除 PID 等待。无接管仍确认原 PID 消失。

## 幂等性与恢复

协商消息必须有原 listener token、对端独立 token 和具体离开轮次，重复确认不创建第二份参与。只在协商成功后解除责任；请求或 hello 失败关闭本次获得的 control client、保留原失败，普通关闭不恢复已取消清理。未知参与、损坏文件、超时和 PID 复用保守失败，不强杀生产进程。测试只清理其自身子进程。临时日志放 /tmp。

## 证据与备注

本轮开始时 reviewed head 6fd61651744fd21dd274526b77e2e388fe3865c5，main 以 fetch 后的 origin/main 为准。旧 evidence JSON 是上轮输入，不改写其 SHA256 为本轮源码。

## 接口与依赖

仅增加 Node fs/net/crypto 的参与协商，沿用经过 owner/profile 校验的 RuntimeSupervisorClient hello。store 提供 ready 和 departure 上下文；Host 提供接受原进程候选的 callback 和边界删除集合冻结 callback。Supervisor 已进入 shutdownBoundary 时拒绝新 socket，现有 idle 前连接取消 idle timer；无需扩展业务 wire 协议。

修订说明：建立最新四阶段接管修复的过程和验收边界，后续随实现更新。


2026-10-11 / Codex 决策补充：协商采用有界短请求和 50ms 重试，不保留 waiting 响应的长 socket；单次 5 秒、64KiB，90 秒准入期限。准备阶段验证 peer 后再次检查阶段，派发 Host 删除 API 前同步冻结集合；最终 shared/workspace 保存后才发 offer。退出轮询重新核对接受交接的有效参与者，未接管 PID 不放行。候选按 backend/storage slot 保存最新 hello 收据，原 PID 历史仍用于无接管退出对照。确认保留的 client 在 root 移除/Host 边界释放，普通现代读者移除按真实使用责任释放。

新增可重跑验证：先具有本地 build/native assets，在仓库根 Node 22 下运行 DEV_SESSION_CANVAS_TAKEOVER_NATIVE=1 DEV_SESSION_CANVAS_HOST_TEST_FILTER='takeover native' node scripts/test/test-host-execution-owner-wiring.mjs。3 项分别是 idle 原 PID 保留及 native 新 Terminal、不可取消关闭后正常登记、无接管仍等原 PID 消失。完整普通 Host 634 项不会启动 native 被测进程。Linux 单 root 原双窗口场景 /tmp/dsc319takeover3 exit 0；不是新增四阶段 UI 暂停验收。跨平台/Remote SSH/真实多 root 和成本边界继续在技术债中保留。

native 测试夹具首轮遗漏原启动 token，第二轮使用有限准入 fingerprint，与生产 client 期望不符；已按真实启动意图和生产额度构造测试子进程，原 owner/profile 校验保持。新增 native 新执行参数首轮遗漏正式 launchSpec，已按协议提供 launchSpec；未放宽产品握手或 RPC。修订说明：记录实际工程选择、最新验证和夹具修正，继续保持历史失败与验证范围可追溯。


最终并发 store 复验先后暴露 discovery/request 与普通 dispose 之间的 ECONNRESET。request 重置只重试；busy discovery 重置保持未知并重试，不删记录；持锁 probe 的重置只有在独立登记已撤回时才能忽略，否则保守失败。两项确定性 reset 回归新增，连续三次全套 store 20/20，通过后再复验实际 Host/native 与双窗口。
