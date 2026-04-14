# 公开平台发布准备研究

本 ExecPlan 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘` 这几个章节。

本计划位于仓库根目录下的 `docs/PLANS.md` 约束体系内，后续任何继续推进该主题的协作者都必须按 `docs/PLANS.md` 的要求持续维护本文件。

## 目标与全局图景

这项研究要回答的问题是：如果把当前 `DevSessionCanvas` 从内部 Preview VSIX 分发推进到公开平台发布，当前 worktree 还缺哪些工作，哪些是硬 blocker，哪些只是后续渠道动作。

用户可见的结果应当是一份正式、可追踪的研究结论。后来者不需要重新从仓库和平台文档零散拼图，就能知道为什么“先申请 publisher”不是当前第一步，以及应该先收口哪些工程问题。

## 进度

- [x] (2026-04-11 15:43 +0800) 阅读 `docs/WORKFLOW.md`、`docs/PLANS.md`、`README.md`、当时的发布准备总览文档与 `package.json`，确认当前仓库结论仍是“内部 Preview VSIX 分发”。
- [x] (2026-04-11 15:47 +0800) 检查 `.vscodeignore`、打包脚本和现有 VSIX，确认当前包内容仍混入调试与测试产物。
- [x] (2026-04-11 15:50 +0800) 复跑 `npm run package:vsix`，确认当前工作树下打包会因 `.debug` 内的非普通文件路径失败。
- [x] (2026-04-11 15:54 +0800) 查阅 `Visual Studio Code` 官方发布文档与 `Open VSX` 发布文档，收敛当前平台要求。
- [x] (2026-04-11 16:02 +0800) 新增设计文档并同步索引、发布准备文档，正式记录“若转向公开发布”的工作项和渠道取舍。

## 意外与发现

- 观察：当前仓库并不是“只差 publisher / PAT 就能公开发版”，而是首先缺少一个干净的发布包。
  证据：现有 `dev-session-canvas-0.0.1.vsix` 大约 `293 MB`，且解包后包含 `.debug/playwright/`、`.debug/vscode-smoke/` 等调试产物。

- 观察：在当前工作树直接执行 `npm run package:vsix` 会失败，而不是稳定产出一个可上传的包。
  证据：打包过程报错 `Error: not a file: .../.debug/vscode-smoke/systemd-fallback-real-reopen/tm`。

- 观察：当前仓库已具备内部 Preview 所需的基础 manifest 元数据，但公开发布所需的法律与对外资源口径尚未成立。
  证据：`package.json` 仍为 `UNLICENSED`；`LICENSE` 明确只允许内部评估 / 预览分发；`repository`、`homepage`、`bugs` 指向内网 HTTP 地址。

- 观察：官方发布文档当前已经以 `@vscode/vsce` 作为发布工具入口，而仓库仍使用旧 `vsce` 包名。
  证据：`Visual Studio Code` 官方发布文档的安装示例使用 `npm install -g @vscode/vsce`；仓库 `package.json` 当前 devDependency 仍是 `vsce`。

## 决策记录

- 决策：把“发布包治理”定义为公开平台发布的第一 blocker，而不是先做账号申请。
  理由：如果发布包仍会把 `.debug` 等调试产物纳入，或者在当前工作树下直接失败，那么账号与 token 并不能推动实际发布前进。
  日期/作者：2026-04-11 / Codex

- 决策：若后续进入公开发布，首发渠道优先收敛到 `Visual Studio Marketplace`，不把 `Open VSX` 与首发强绑定。
  理由：当前仓库已有 VSIX 与 `vsce` 打包基础，距离 `Visual Studio Marketplace` 最近；`Open VSX` 会引入额外的 namespace / token / 同步成本。
  日期/作者：2026-04-11 / Codex

- 决策：把研究结论写入正式设计文档，而不是只追加到当时的发布准备总览文档。
  理由：这是一次关于发布边界、渠道策略和 blocker 分类的设计性研究，按仓库约定应进入 `docs/design-docs/` 作为正式结论来源。
  日期/作者：2026-04-11 / Codex

## 结果与复盘

本轮研究完成了以下收口：

- 确认当前仓库事实仍是“内部 Preview VSIX 分发”，不是“等待公开发布执行”。
- 确认当前公开发布的首要 blocker 是包治理，而不是账号创建。
- 新增 `docs/design-docs/public-marketplace-release-readiness.md`，正式记录公开发布所需工作项、渠道候选与当前结论。
- 同步更新设计索引与发布准备文档，使后续协作者能从正式文档直接看到研究结论。

当前仍未做的事情：

- 没有修改实际打包配置或 `.vscodeignore`。
- 没有创建 publisher、PAT、Open VSX namespace 或任何外部账号。
- 没有进行真实公开发布演练。

## 上下文与定向

本任务涉及的关键文件如下：

- `package.json`：扩展 manifest、版本号、publisher、打包脚本与依赖定义。
- `.vscodeignore`：决定哪些文件会进入 VSIX，是当前包污染问题的第一检查点。
- `scripts/package-vsix.mjs`：当前仓库的 VSIX 打包入口。
- `README.md`、`CHANGELOG.md`、`LICENSE` 与当时的发布准备总览文档：当前对分发定位、支持口径和许可证策略的事实来源。
- `docs/design-docs/index.md`：新增设计文档后必须同步登记的注册表。

这里的“公开平台发布”特指面向外部用户的公开扩展分发渠道，而不是继续通过内部渠道发送 `.vsix` 文件。

## 工作计划

第一步，确认仓库内的正式结论文档是否仍把当前状态定义为内部 Preview。这样可以避免把仓库当前事实误判为“已经进入公开发布准备执行阶段”。

第二步，检查当前打包脚本和 VSIX 内容，判断公开发布是否已经只差账号配置。如果包内容本身没有收口，就应先把 blocker 定位在工程治理，而不是渠道操作。

第三步，查阅 `Visual Studio Code` 官方发布文档和 `Open VSX` 文档，核对当前外部平台对发布工具、publisher、token 和发布命令的要求。

第四步，把研究结论写入正式设计文档，并同步相关索引与发布准备文档。

## 具体步骤

在仓库根目录执行以下检查：

    sed -n '1,220p' docs/WORKFLOW.md
    sed -n '1,260p' docs/PLANS.md
    sed -n '1,260p' package.json
    sed -n '1,260p' README.md
    sed -n '1,220p' LICENSE
    sed -n '1,240p' .vscodeignore
    du -sh dev-session-canvas-0.0.1.vsix .debug .playwright-browsers dist node_modules
    unzip -l dev-session-canvas-0.0.1.vsix | sed -n '1,220p'
    npm run package:vsix

查阅平台文档：

    https://code.visualstudio.com/api/working-with-extensions/publishing-extension
    https://github.com/eclipse/openvsx/wiki/Publishing-Extensions

## 验证与验收

本研究完成的验收标准是：

- 正式文档明确写出当前不是公开发布 ready。
- 正式文档明确把 blocker 分成发布包治理、公开元数据、渠道账号、支持矩阵和流水线收口。
- 设计索引中能登记并追踪新的公开发布准备设计文档。
- 研究结论中包含本地可复现证据，而不是只转述平台文档。

## 幂等性与恢复

本计划只涉及文档研究和只读验证命令；重复执行不会修改运行时代码或外部平台状态。

唯一需要注意的是 `npm run package:vsix` 会重新触发打包尝试，但在当前工作树下它会失败，并留下失败日志；这不影响仓库代码，可安全重复执行。

## 证据与备注

关键本地证据：

    du -sh dev-session-canvas-0.0.1.vsix .debug .playwright-browsers dist node_modules
    293M  dev-session-canvas-0.0.1.vsix
    1.3G  .debug
    630M  .playwright-browsers
    6.6M  dist
    138M  node_modules

    npm run package:vsix
    ...
    This extension consists of 7051 files...
    Error: not a file: .../.debug/vscode-smoke/systemd-fallback-real-reopen/tm

这些证据足以说明：当前公开发布的第一步不是拿 token，而是先形成最小、稳定、可重复的发布包。

## 接口与依赖

本研究涉及的外部接口只有两类：

- `Visual Studio Marketplace` 发布接口：通过 `@vscode/vsce`、publisher 和 PAT 完成登录与发布。
- `Open VSX` 发布接口：通过 `ovsx publish`、namespace 和 token 完成发布。

本轮不直接调用这些接口，只把它们作为后续实施阶段的依赖前提记录下来。
