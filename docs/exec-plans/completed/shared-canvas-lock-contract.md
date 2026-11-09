# 明确共享画布锁迁移与生命周期合同

本 ExecPlan 按 `docs/PLANS.md` 持续维护。本阶段承接两位 subagent 的设计审核，只完成迁移决策、接口合同和隔离验证，不修改生产实现，不触碰真实共享存储，不创建分支或提交。

## 目标与全局图景

把“采用内核文件锁”的方向细化为可以实施和验收的设计：说明旧窗口何时必须退出、升级失败如何继续、旧版再次启动会怎样，以及新锁何时获取/释放。用户能根据文档理解升级影响；实现者能据此开发而不自行发明兼容策略。设计完成不等于文件锁已发布。

## 进度

- [x] (2026-11-06) 核对原审核结论、现有 TCP store、参与者和 root 保存入口。
- [x] (2026-11-06) 选定受控停写与原路径外层 v2 格式拒绝，不采用长期双锁桥接。
- [x] (2026-11-06) 固定 v0.28.0 commit 的真实旧 store 隔离实验 8/8 通过，未操作生产文件。
- [x] (2026-11-06) 完成原生/TypeScript 接口、所有权状态机、错误恢复和四组验收门禁，已同步注册与技术债。

## 意外与发现

旧 `SharedRootCanvasStore.read` 在每次 publish/mutate/depart 的实际工作之前检查外层 snapshot.version 必须为 1，未知版本会抛错；因此“不认识的新字段”与“旧版已经拒绝的格式版本”是不同的升级机制。是否足以保护全部 Host 行为仍需核查，不能仅凭该检查宣布热迁移安全。

通用 Host 快照读取并不校验该版本，构造时首次共享 persist 会因 store 校验同步失败；前者是源码事实，后者完整用户体验仍需真实 Host 验收。v0.28.0 与当前 HEAD 的 store/participants Git blob 分别一致，隔离脚本进一步直接提取固定旧 commit 而非依赖可变工作树。

## 决策记录

- 决策：本轮限定设计与隔离验证，不直接替换 acquireLease。
  理由：用户同意先收口迁移与合同；新旧写者及执行副作用尚不能仅靠文件锁本身保证。
  日期/作者：2026-11-06 / Codex。

- 决策：采用受控停写 + 原路径外层 v2，单 root 一次性取得新 admission、旧 admission/commit 和新 commit，正常 v2 不再使用 TCP 互斥。
  理由：长期桥接保留原冲突且引入旧端口排序/碰撞兼容；旧版已有的格式拒绝可以保护 store 写入口，但不替代旧 Host 停写及完整副作用验收。
  日期/作者：2026-11-06 / Codex。

- 决策：选择独立 Node-API 锁适配器，不复用 PTY namespace claim，不自动降级格式或回退锁后端。
  理由：避免执行所有权副作用与多个互不相认的写者，保持句柄与异步工作的结构化生命周期。
  日期/作者：2026-11-06 / Codex。

## 结果与复盘

设计阶段完成，输出 `docs/design-docs/shared-canvas-lock-contract.md` 和 `docs/references/shared-canvas-lock-research/legacy-version-fence.mjs`。8 项固定旧 store 实验通过，脚本语法、diff 与文档链接/元数据检查用于本阶段交付验证。迁移器、原生后端、三平台与完整 Host 升级尚未实现或验收；原研究两位审查不自动覆盖本次新增设计。后续实施范围已明确，不把产品修复计作本阶段完成。

## 上下文与定向

当前产品在 `extensions/vscode/dev-session-canvas/src/panel/sharedRootCanvasStore.ts` 的 publish 内取得 TCP commit 锁，再读最新 JSON、合并、rename；mutate 则在 admission 和 node 锁内核对并执行 start/delete，再 flush。`sharedRootCanvasParticipants.ts` 维护 `.participants` 登记与清理接管；`CanvasPanelManager.ts::leaveSharedCanvasesForModeSwitch` 跨 root 按旧 admissionPort 排序并去重。现有普通关闭/Reload 保留持久执行，关闭持久化则可能主动清理，因此不能混淆。

研究文档 `docs/design-docs/shared-canvas-lock-research.md` 推荐稳定旁路文件上的 flock/LockFileEx。需要防止新旧锁不互通、桥接排序自锁、fork 引用延长锁寿命及失败 store 被错误当作自动恢复。

## 工作计划与里程碑

第一里程碑核对所有共享快照写入口与旧格式读取失败路径，比较迁移方案的最小安全条件；输出可验证的候选决策。第二里程碑在随机临时目录实例化当前真实 SharedRootCanvasStore，验证未知外层版本是否拒绝迟到 publish、mutate、depart 和新实例，并测试取得旧锁前后发生的保存；该实验不是新 native 后端验收。第三里程碑细化独立 Node-API 锁适配、TypeScript 队列/所有权、原生句柄释放与用户错误恢复合同，将迁移前提和必须通过的门禁写入设计。

## 具体步骤

仓库根执行 `rg -n 'writeRootLocalCanvasSnapshot|loadPersistedCanvasSnapshotFromPath|writePersistedCanvasSnapshotToDisk' extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts`，核对是否有绕过共享 store 的生产写入。隔离脚本使用现有 esbuild 编译当前 store，与 `scripts/test/test-shared-root-canvas-store.mjs` 同样加载真实实现。外部平台语义仅依据官方资料；没有 Windows/macOS 环境时明确不代验。最终运行隔离脚本、`git diff --check` 和文档链接/元数据检查。

实际脚本通过 `git archive e07fd17601b2639456dfd4807c1b83905067c8b1 extensions/vscode/dev-session-canvas/src` 提取固定旧产品源码，在临时目录打包运行。执行 `node docs/references/shared-canvas-lock-research/legacy-version-fence.mjs` 得到 8 项 PASS；`node --check docs/references/shared-canvas-lock-research/legacy-version-fence.mjs` 与 `git diff --check` 通过。依赖本地 Git 对象、tar、Node 和仓库已安装的 esbuild，不下载或安装新依赖。

## 验证与验收

至少明确迁移触发者、作用范围、旧版/新版本共存规则、升级/降级/失败回退、未知资格和在途操作处理；每项结论都标明源码推导、隔离证据或未验证。接口必须能表达资源 key、三种 scope、取消与 deadline、句柄所有权和幂等释放。设计不能把心跳/用户点击当作旧进程已退出的证明，也不能将未知/损坏快照当作空画布重新覆盖。

## 幂等性与恢复

实验仅用自己建立的临时目录、随机身份及本轮创建的 store；finally dispose 后删除临时目录。不关闭现有 Host、不修改网络配置、不转换实际画布格式。文档写入可重复，保留已有研究修改。

## 证据与备注

本轮基线为当前工作树 `1dc2c46a`，已存在的未提交研究文档不属于产品修改。最终证据随设计和隔离脚本记录，状态不得由设计完成外推为产品完成。

实验环境 Linux、Node v25.6.0，旧 store SHA256 `bffb5dac0c92155ac62c1b977e11fa8c83be1dc0da2cc72053b8b65ec7d6c012`。证明范围包括新字段不阻断、保留 graph/runtime 值、新 constructor 和原 publish/mutate/depart 拒绝、排队提交重读、已准入 mutation 排在转换之前；转换本身为夹具，不是生产迁移器。

## 接口与依赖

本阶段不安装或新增生产依赖。拟定接口为 scope/key 对应的 acquire、工作完成后 release，以及独立 native tryAcquire/release；具体类型和状态转移写入设计文档，原生后端不加载 PTY/执行权威入口。

已选合同为 native open/tryAcquire/close 不透明句柄，业务侧 withLock/withAdmissions；close 幂等、资源键与 scope 队列隔离、明确全局排序及取消后的在途清理。新快照外层 version 2、lockProtocol os-file-v1，内部 state.version 1，workspace 私有快照不改；真实落点与四组实施门禁见新设计，不授权直接修改真实存储。

修订记录：2026-11-06 建立设计阶段计划，先验证旧读者的拒绝边界再选定迁移策略。

修订记录：2026-11-06 完成固定旧版的 8 项隔离验证和迁移/接口合同，移入 completed；实现及平台验收留在明确技术债与后续门禁中，未开始产品开发。
