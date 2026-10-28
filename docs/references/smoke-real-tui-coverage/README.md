# 四项真实 TUI 验证记录

本记录区分 CLI 信号探索、自动化反例与产品 Host 验收。目录映射的 152 implemented-unverified / 0 not-implemented 只表示实际入口存在。

## 固定输入与判定

分支基于 PR340 merge `2dc6d17351591a86265f1d69d420b43a23b578ee`。Linux、snapshot-only，Codex 0.157.1 / Claude 2.1.280，模型 deepseek-flash；Codex `https://api.deepseek.com/`（Responses）、Claude `https://api.deepseek.com/anthropic`。CI 使用已有 DEEPSEEK_API_KEY，私有配置清理后仅保留白名单事件和页面事实；记录不含凭据。

当前回合由精确 prompt、workspace、session、工具 callId、新生成 receipt 和正常 Stop 关联，Codex 另核 turn_id。比较整段实际回答及其下方的输入区；不要求跨运行回答相同。等待工具尚未返回时观察运行态；此条件不覆盖供应商断网重连。完成后的真实 resize 检查列数改变、正文、状态和通知计数。

## CLI 探索（acceptance=false）

| Actions run | 实际结果与修复 |
| --- | --- |
| 40681385645 | 请求前因 CommonJS xterm 命名导入失败；修正默认导入，无模型业务证据。 |
| 40681635343 | Codex 当前 prompt/Stop 已取得，但工具授权拒绝；Claude 在 Security notes。仅修正私有授权和初始化。 |
| 40682240862 | Codex 通过；Claude 默认 No 导致退出。 |
| 40682790799 | Codex 通过；Claude trust 首次 Down 可回退，未到业务回合。 |
| 40683639714 | 两 provider 全部通过。复用已验证的 End / 两次稳定 Yes / 唯一 Enter；记录工具等待、未提交草稿、Stop 实际回答和 resize。 |

脱敏事件、工具身份、关键页面和原文件 hash 保存在 [CLI 样本](cli-signals.json)。最终探索工件为 `tui-signals-codex`（12813767623）和 `tui-signals-claude`（12814331583）。Claude 实际 session 为 `fae62f6c-bc2e-41ae-aec2-21bcab1e89ee`，Stop 回答为 `The test received receipt receipt_0ea500e2fb374a6f981c1055cbc15d23.`。两个版本均提供正常 Stop 与当前 UserPromptSubmit；这未启动产品 Host，不能代证四项产品通过。探索 workflow 与脚本完成用途后移除。

## 本地回归

- 完整 test:ci-gates 139/139。此前修改目录与测试并行引起 digest 不一致的失败保留，不追认为通过；冻结输入后完整重跑通过。
- test:agent-tui 8/8，覆盖错误/陈旧回合、tool receipt 因果、页面位置、初始化，以及真实 MCP 子进程的精确释放/重复调用拒绝和 hook 白名单事件。
- 原 smoke-runtime-retirement 18/18、typecheck、DeepSeek 私有配置、release-preflight / publish-tag-release 接线、runner 环境过滤通过。
- 本机无 DEEPSEEK_API_KEY，未进行本地模型请求。固定 Claude 在本地不可连通地址、零请求条件下通过初始化检查；该证据仅限启动。

## 产品验收

PR341 的旧输入 run40682891236 在 regression shard-2 暴露 runner VM 仍仅提供 scenarios，而新入口额外读取 selectedSuites；将路由并入既有 scenarios 后原退役回归通过。旧轮失败保留并取消剩余执行，避免阻塞后续输入。

输入 e4f865da 的 Release Preflight run40683646799：四个 source 场景的 Codex 均通过，原执行保存/reader/退役均有证据；Claude 四项在 interactive CLI ready 失败，未提交回合。页面明确停在 `Allow external CLAUDE.md file imports?`，导入目标为仓库根 AGENTS.md。原因是旧夹具 cwd 虽为新建空目录，但位于 checkout 下，Claude 向上继承了仓库 CLAUDE.md。修复将 cwd 放在 checkout 外的私有临时目录并随凭据清理，不确认导入仓库指令；新增配置隔离/清理回归通过，test:agent-tui 现为 8/8。原始结果摘要见 [首轮产品证据](first-product-run.json)。该轮剩余执行取消，packaged 由新输入验收，不能算旧轮通过。

同轮既有 `source-host/systemd-user-real-reopen` 在第二 Host 的 editor ready 45000ms 超时。原执行 identity/barrier 已建立，失败快照为 editor generation=5、ready=false，最后记录 surface/rendered；此项未归因为本次 TUI，原工件 12815266032 保留，后续结果独立记录。

修复后的完整 source / packaged 结果仍待实际 Host 工件确认。所有清理及 Host 退出结果也需通过，不能由上述探索或静态检查代证。

## 第二轮隔离校验与基础设施失败

当前提交 96b95542 的 run40686985978 attempt1 在 Windows x64 / macOS ARM64 编译之后下载旧 Node 运行时超时（120 秒）。尚未执行 TUI；保留原 native-load 失败回执，Windows 工件为 12815512429。整轮 attempt2 对同一提交重新冻结/构建，两个原失败目标均通过，不混用旧轮产物。

attempt2 的四项 source 在创建第一个 Codex 节点时失败；input 工件 12816193916 的 codex-prepare 为 `Timed out: current Agent created`、其余五个 provider step 为 not-run，未发生模型请求。产品 `validateExecutionCwd` 要求 cwd 位于 Host workspace 内，单独移动 CLI cwd 不能成立。修复同时创建仓库外的私有 Host workspace，两个 provider cwd 位于其内；凭据 home 位于 workspace 外，分别清理。增加实际 Host/cwd 包含关系、凭据分离及清理反例。

本地真实 Host 启动校验确认节点已创建；首次 Codex 因交互 shell 选到旧系统 Node 而在 npm JavaScript 入口报 `SyntaxError: Unexpected reserved word`。显式以测试控制器 Node 执行 Codex npm 入口，Claude 固定包是原生可执行文件，继续直接启动。本地校验没有提交模型 prompt，不能作为四项业务通过。

判定另拒绝纯 receipt 或仅添加标点的回答，防止用工具回显代证实际回答呈现。新增反例与既有四份 Codex source 工件复核通过；当前 test:agent-tui 8/8。

本地第三次真实 Host 启动校验两 provider 均通过，版本 Node25.6.0 / VS Code1.140.0；模型 prompt 为零，两个实际节点与 cwd 见 [启动结果](local-host-startup.json)。显式 Node 入口同步到私有 Codex 配置，满足产品自定义命令须匹配已配置入口的约束。原失败不改写为通过，后续完整业务仍由 CI 验收。

run40691355132（d1c54b0c）再次在 macOS ARM64 编译后旧 Node16.17.1 下载处超时，工件 12817746527；TUI 未运行。已为供应商 GET 增加原每请求120秒总期限内最多三次传输恢复，每次最多40秒，记录具体URL与阶段；HTTP永久错误及hash不符不重试。localhost真实HTTP反例通过并纳入既有 native-assets 回归。设计与适用边界见 release-gate-redesign 的供应商下载规则，真实业务仍不自动重试。

## 供应商下载对照与恢复

run40692812033（d41e2b20）在 Windows 旧 Node 下载处失败，未执行 TUI。独立 run40694396583 的 [六份公开下载对照](supplier-download-probe.json) 记录 Node buffer、stream 与 curl：有的独立 runner 亚秒完成，有的120秒仅收到部分字节，curl 也失败。不同 VM 的结果不能证明读取方法的因果差异，acceptance=false。

当前传输仍限制每请求120秒、最多三次，将40秒硬切片改为40秒无字节进展窗口。非Linux CI 缓存经官方 hash 核验的供应商原文件，缓存键包含目标和版本；每次使用重新 GET 官方 SHASUMS256.txt 并验证缓存内容。损坏视为miss，重新下载hash不符仍失败；仅成功 native load 后保存缓存，不缓存编译产物或验收回执。持续传输反例先红后绿，缓存首次写入、命中、损坏恢复和每次获取checksum的本地真实HTTP回归通过。

## 第三轮产品与完成时序根因

run40696561957 / 5252b296 的六个native目标通过，八个TUI job实际结果见 [原回执摘要](product-run-40696561957.json)：12次provider场景通过、source footer与packaged silence的Codex在正常Stop后仍running，后续两次Claude未执行；清理和Host退出均通过。不能把各路径的局部结果拼为完整验收。旧multi-root-real-reopen第二Host editor ready超时单独保留，工件12821370557；systemd-user-real-reopen本轮通过。

[只读时间线诊断](completion-state-diagnostic.json) run40700749341复现了约100ms一次的空observable输出更新lastOutput并重排120ms轮询；这些是已过滤的终端标题更新。只让非空observable触发活动及轮询，标题投影与原输出帧仍保留。正确时钟模型的owner回归在原实现失败、修复后通过；完整Host接线648/648、TUI证据9/9、typecheck通过。诊断另一份样本的Claude用行内代码包裹receipt，页面正确渲染而原比较失败，改为解析已知inline显示语义后比较完整正文；字面转义、丢词和丢字符反例保留。

最初诊断40700262735因手动重建漏编译profile/admission define进入stock路径，零模型prompt，未产生业务证据。修正后才得到上述时间线；诊断始终acceptance=false。修复后的正式source/packaged输入仍需重跑。

2026-10-28 修复后的只读诊断run40701447849（21b7554c）三份独立footer样本全部通过，两provider各三次；原五秒状态及完整正文断言不变。此为复用原native、重建观测入口的acceptance=false诊断，最终正式输入仍需完整门禁。

## 最终四项覆盖结果

run40701818847，head97fa646f，预合并输入7c3c412dbe1cde4798112100d17f0443ec51b7c6。八个job、两provider共16次全部通过，详见 [逐项原回执与页面摘要](product-run-40701818847.json)。同一payload的构建输入hash一致，四份packaged回执消费同批原VSIX；所有prepare/action/assert、保存、reader、退役、cleanup及原Host absence均复核通过。模型回合1977–5995ms，不含准备与清理，不作为SLA。

| 场景 | source Codex / Claude | packaged Codex / Claude |
| --- | --- | --- |
| input-during-work | 通过 / 通过 | 通过 / 通过 |
| answer-with-footer | 通过 / 通过 | 通过 / 通过 |
| tool-network-silence | 通过 / 通过 | 通过 / 通过 |
| turn-completion-redraw | 通过 / 通过 | 通过 / 通过 |

整轮存在其他失败：packaged surface-continuity--live-page-remount在Terminal准备阶段等待Host消息超时，尚未进入重挂载动作，工件12822619264；同场景source通过。不声明完整acceptance或可合并，根因未确认，已登记tech-debt-tracker。最终文档提交的CI需按自身输入核验，不复用上述运行签发回执。
