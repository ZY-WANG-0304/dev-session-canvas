---
title: PR327 发布门禁准备失败与诊断等待边界调查
decision_status: 待探索
validation_status: 验证中
domains: [VSCode 集成域, 执行编排域]
architecture_layers: [宿主集成层, 适配与基础设施层]
related_specs: [docs/product-specs/runtime-persistence-modes.md]
related_plans: [docs/exec-plans/active/release-gate-root-cause.md]
updated_at: 2026-10-13
---

# PR327 发布门禁准备失败与诊断等待边界调查

## 问题与范围

PR328合入后，PR327预合并7e659ce6的GitHub门禁在runtime-checkpoint-refresh基础Agent启动失败；本地相同tree的ec4afba3在local-links-and-stop超时。本文记录分别定位的证据；调查分支不修改发布输入或正式产品行为。

## 当前结论

本地等待helper漏检已确定性复现：原waitForDiagnosticEvents在异步取回结果后，仅在下一轮Date.now小于deadline时检查predicate。读取跨越截止会直接报错，即便末批事件精确匹配。原renderer日志显示首次missing-target.ts搜索耗时9592ms、第二次321ms，QuickOpen在08:35:57.262Z调用，事件在57.295Z到达，57.494Z报错；动作请求ID对应47.328Z。原墙钟没有记录准确helper起点/取回瞬间，不能将事件实际到达时刻自动等同deadline内取回。受控脚本保留原函数和正负场景，不实施修复。

原Host日志进一步记录等待开始附近的getDiagnosticEvents调用47.334Z、末次事件前调用57.241Z，以及后续57.341Z调用；匹配事件在两次调用之间到达。它佐证sleep/读取跨越截止的漏检路径，但仍不是helper入口/返回精确计时。原rg命令使用--no-ignore、--follow，只有.git等默认排除，没有node_modules排除；cmdTime9591ms与renderer耗时一致。可确认搜索扫描范围与时长，不能确认历史文件数量、冷缓存或资源争用的贡献。有限原始摘录和源日志hash见docs/references/release-gate-root-cause/local-search-timeline.json。

CI诊断run38382436173在固定原预合并7e659ce6、原六平台native资产与原预算/断言下再次首败于runtime-checkpoint-refresh。阶段日志确认ensureRuntimeRootSocketDirectory中的assertPrivateStorage抛出“Root runtime owner storage must be private to the current OS user.”，还未进入native-assets。专用catch保留堆栈后仍返回原失败；页面ready、Agent error、没有execution与历史首败一致。末尾磁盘剩余77516996608字节。有限摘要、input/run/job与日志hash见docs/references/release-gate-root-cause/ci-preparation-result-38382436173.json及ci-preparation-summary-38382436173.json。

污染源是PR328新增scripts/test/test-smoke-remote-host.mjs的“Supervisor request has a total deadline even when socket stays silent”：control.runtimePaths把临时storage映射到真实/tmp/dsc-root-<uid>/d-<hash>.sock，测试mkdir父目录未指定mode，且finally仅清理storage，保留共享父目录。npm test先执行该测试再进入test:smoke。干净环境中umask0022使新父目录为0755，后续root准备要求0700而拒绝；本机父目录已为0700，mkdir不改变现存权限，掩盖了问题。原函数受控对照socket-directory-pollution.mjs只将固定socket目录映射到私有夹具：两次原17用例均exit0；absent变0755并被原生产校验拒绝，预置0700保持同inode并通过。最新干净CI直接属主/mode取证待完成，不将未观测的历史inode/mode写成事实。

原模式只请求legacy-detached，禁用D-Bus，排除systemd选择候选。CI原六平台全部构建通过，Linuxmanifest/binary与本机逐字节相同；具体诊断失败早于native-assets，因而资产不是该次首败触发点。原固定输入stock VSCode1.141.0独立checkpoint全场景exit0，不代证CI首败或完整gate通过。

## 验证方法与证据

计划记录docs/exec-plans/active/release-gate-root-cause.md。diagnostic-wait-boundary.mjs在vm中读取并执行原helper；CI诊断run38382436173固定原预合并和原native资产，运行完整gate，仅临时为准备函数加入阶段和catch错误文件记录，原返回、启动责任、预算和断言保留；它是诊断运行，不是正式最新发布门禁。测试结束恢复临时源码，上传固定摘要，不上传原环境/凭据/SSH私钥或全HOME。源码日志变更发生在隔离checkout，正式修复仍需另行确认。

在捕获socket-directory异常后，专用workflow切换为ci-socket-directory-evidence.mjs的有限干净runner对照，固定同原输入，不再重跑全量：必须先确认目录不存在，再执行原17用例、读取实际uid/mode/inode与空目录、调用原生产目录校验；仅对自己新建且身份/内容已确认的空目录chmod0700作因果对照，然后rmdir。该实验变更不是正式修复、不作为最新release gate。若目录事先存在则拒绝实验，不接管未知状态。

## 剩余问题与候选修复范围

等待修复需明确末次观察与原deadline的语义，覆盖首读、末读与负例，不扩大预算。Remote Host静默socket测试应使用自己管理的临时socket目录，requestSession/runtimePaths可通过有限测试依赖注入保持正式调用默认地址；原17用例和总deadline断言保留，测试结束关闭socket并清理独立目录。不要chmod/清理真实共享runtime目录或放宽生产权限校验。生产root准备错误的阶段可观测性与失败工件收集是后续诊断改进，需返回有界、无敏感路径的错误类别，不能把通用catch转ready或提交后换backend。当前PR327仍草稿，正式门禁失败；正式修复、最新main rebase与完整门禁仍待用户确认后推进。
