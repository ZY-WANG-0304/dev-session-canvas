# 公开 Marketplace Preview 发布包收口

本 `ExecPlan` 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘`。

本文件遵循 `docs/PLANS.md` 的要求持续维护。

## 目标与全局图景

当前仓库已经把对外分发路径收敛到 `Visual Studio Marketplace`。本计划聚焦的主题是发布包治理：把当前工作树从“能打出一个 VSIX”推进到“能稳定产出适合作为 Marketplace 上传输入的最小 Preview 工件”，并把过程中确认的边界正式写回仓库文档。

本计划要把“当前 worktree 能打一个 VSIX”推进到“当前仓库能稳定产出适合 Marketplace 上传的最小发布工件”。完成后，协作者应能在仓库内直接看到：打包入口使用官方当前工具名、发布包排除了明显无关内容、文档不再把 `.vsix` 当成外部分发方式，并且验证记录能说明还剩哪些 blocker。

## 进度

- [x] (2026-04-11 22:40 +0800) 复核当前 README、发布准备文档、`.vscodeignore`、打包脚本与 `CONTRIBUTING.md`，确认支持矩阵已补齐，但发布包治理和开发文档口径仍未收口。
- [x] (2026-04-11 22:44 +0800) 新建本计划，记录本轮实现范围、验证目标与剩余 blocker。
- [x] (2026-04-11 22:45 +0800) 收紧 `.vscodeignore`，排除 `.debug/`、`.playwright-browsers/`、`tests/`、截图草稿、core dump 等非发布内容。
- [x] (2026-04-11 22:48 +0800) 把打包工具链从旧 `vsce` 包名迁移到 `@vscode/vsce`，并同步 `scripts/package-vsix.mjs` 中的错误提示与本地 fallback 路径。
- [x] (2026-04-11 22:52 +0800) 更新 `CONTRIBUTING.md`、发布准备总览文档与相关正式文档，反映“Marketplace Preview + VSIX 仅作发布工件”的当前事实，并记录本轮已完成与未完成项。
- [x] (2026-04-11 22:48 +0800) 运行 `npm run package:vsix`，确认当前工作树已可稳定产出约 `7.07 MB`、`82 files` 的 VSIX。
- [x] (2026-04-11 22:48 +0800) 运行 `npm run test:vsix-smoke`，确认收口后的 packaged payload 仍可独立启动并跑通 trusted smoke。
- [x] (2026-04-11 23:02 +0800) 补上 `validate:clean-checkout:vsix` 隔离验证入口和文档说明，为后续 clean-checkout 验证做准备，不直接扰动当前工作树。
- [x] (2026-04-14 00:57 +0800) 修复隔离 clean-checkout 验证脚本中的缓存目录与 VS Code 下载路径问题，并基于 `--source working-tree` 成功跑通 `npm run validate:clean-checkout:vsix -- --source working-tree`，确认当前本地待发布工作树可在隔离目录中完成 `npm ci`、VSIX 打包与 packaged-payload smoke。
- [x] (2026-04-14 02:39 +0800) 基于版本已切到 `0.1.0` 的 release head `346c4bf` 再次执行 `npm run validate:clean-checkout:vsix -- --ref HEAD`，确认隔离目录内可稳定产出 `dev-session-canvas-0.1.0.vsix` 并通过 packaged-payload smoke。
- [x] (2026-04-14 02:44 +0800) 将当时最新的 MR head 同步到公开 GitHub 仓库 `main`，让 manifest 链接与 README 中的相对文档链接落到真实内容；该公开仓库同步 SHA 与 release 验证 SHA 分别记录，不再混写成同一个值。
- [x] (2026-04-14 04:12 +0800) 复核现有 `dev-session-canvas-0.1.0.vsix` 后确认：`.vscodeignore` 中的 `!node_modules/node-pty/` 会把整个依赖重新放回 VSIX，导致前面写下的局部排除规则失效。
- [x] (2026-04-14 04:34 +0800) 将 `.vscodeignore` 改成真正的运行时白名单，并把 `test:vsix-smoke` 扩展为内容守卫；当前 worktree 的 VSIX 已从 `82 files` / `7.09 MB` 收敛到 `46 files` / `1.90 MB`，且 `node-pty` 不再携带 `binding.gyp`、`scripts/`、`src/`、`third_party/`、`typings/`、嵌套 `node_modules/` 或 `.pdb`。
- [x] (2026-04-14 04:34 +0800) 补齐 GitHub issue 模板与 `docs/support.md`，把普通 bug、功能请求、安全问题和 Preview 支持边界分流到固定入口。
- [x] (2026-04-14 04:36 +0800) 同步发布准备文档与设计文档，记录 `remote-ssh-real-reopen` blocker 已修复、当前人工验收无新增问题，以及“发布流水线本轮暂不建设”的当前决策。
- [x] (2026-04-14 04:40 +0800) 发现新增的 `.github/ISSUE_TEMPLATE` 也被一起打进 VSIX；随后把 `.github/**` 加入排除并扩展 packaged-payload 守卫，最终 worktree 工件收敛到 `43 files` / `1.90 MB`。
- [x] (2026-04-14 04:45 +0800) 基于当前 `working tree` 快照再次执行 `npm run validate:clean-checkout:vsix -- --source working-tree`，确认隔离目录内也能稳定产出 `43 files` / `1.90 MB` 的 VSIX，并通过 packaged-payload smoke。
- [x] (2026-04-14 07:56 +0800) 基于当时最新的候选 release head 再次执行 `npm run validate:clean-checkout:vsix -- --ref HEAD`，确认 `1.90 MB` / `43 files` 版本的最小 Preview 工件已经固定到可追溯提交，并再次通过 packaged-payload smoke。
- [x] (2026-04-14 10:48 +0800) 处理 review blocker：storage fallback 改为搜索同一 canonical workspace id 下的 sibling slots，不再只回退到无后缀槽位；同时修复 `CONTRIBUTING.md` 中两处编码回归，并补齐 `extensionStoragePaths` 的 sibling-slot 回归测试。
- [x] (2026-04-14 11:40 +0800) 新增 `README.marketplace.md` 与 `docs/public-preview-release-playbook.md`，把 Marketplace listing 草案、release notes 使用口径、升级说明、回滚口径和手工发布步骤收口成正式仓库文档。
- [x] (2026-04-14 11:40 +0800) 明确 Linux/macOS/Windows 本地路径继续保留为“可尝试，但未严格验证”的 `Preview` 边界，相关严格人工验收继续留在技术债跟踪，不再阻塞当前发布包治理收口。
- [x] (2026-04-14 11:40 +0800) 将最终 git ref 的隔离验证与 `vsce publish` 执行收口到 release-day checklist；本计划范围内已无剩余 blocker，可迁入 `docs/exec-plans/completed/`。

## 意外与发现

- 观察：本轮开始前，`.vscodeignore` 虽然已经排除了 `docs/`、`src/`、`scripts/`，但没有排除 `.debug/`、`.playwright-browsers/` 和 `tests/`，因此发布包会继续混入本地调试状态。
  证据：研究阶段记录的打包失败现象与本轮改动前的 `.vscodeignore` 内容一致。

- 观察：本轮开始前，`CONTRIBUTING.md` 仍保留“内部体验版 VSIX 分发”这类旧表述，和当前 README / 发布准备文档已经形成冲突。
  证据：本轮已把这些段落改成“Marketplace 发布工件 / packaged-payload 检查”与“VSIX 不是普通用户安装路径”的新口径。

- 观察：在当前环境中，`@vscode/vsce` 已成功安装，但 `npm` 没有写出 `node_modules/.bin/vsce` 链接；直接依赖 `.bin` 路径会让 `package:vsix` 误报缺少二进制。
  证据：`node_modules/@vscode/vsce/vsce` 存在，但 `ls node_modules/.bin` 中没有 `vsce`；首次复跑 `npm run package:vsix` 直接命中“未找到本地 vsce 可执行文件”。

- 观察：第一轮收口后，当前工作树的 VSIX 已从早先研究阶段记录的 `293 MB` 污染包，收敛到约 `7.07 MB`、`82 files`，且 packaged-payload smoke 仍通过。
  证据：`npm run package:vsix` 输出 `Packaged ... (82 files, 7.07 MB)`；`npm run test:vsix-smoke` 输出 `VSIX packaged-payload smoke passed.`。

- 观察：当前 VSIX 中最值得继续审视的冗余主要集中在 `node-pty` 依赖级 payload，而不是仓库根目录自己的调试垃圾。
  证据：最新 `vsce` tree 输出已经不再包含 `.debug/`、`.playwright-browsers/`、`tests/`、`playwright.config.mjs` 或 `test-results/`；剩余较宽内容集中在 `node_modules/node-pty/{binding.gyp,scripts,src,third_party,typings}`。

- 观察：当前用户还在同步修其他 bug，不适合直接把 clean-checkout 验证跑在共享工作树上；先提供隔离验证脚本能降低互相干扰。
  证据：本轮新增 `scripts/run-clean-checkout-vsix-validation.mjs`，默认在 `/tmp` 下导出 `git archive HEAD` 并执行独立验证。

- 观察：隔离 clean-checkout 验证若不重定向 `HOME`、`XDG_CACHE_HOME` 与 `npm` 用户配置，`keytar` / `node-gyp` 会继续尝试写入主目录缓存，从而在当前受限环境中失败。
  证据：首次执行 `npm run validate:clean-checkout:vsix` 时，`npm ci` 报 `EROFS: read-only file system, access '/home/users/ziyang01.wang-al/.npm'` 与 `ENOENT: mkdir '/home/users/ziyang01.wang-al/.cache/node-gyp'`；修复后，同一路径的 `npm ci` 已通过。

- 观察：`@vscode/test-electron` 的 `downloadAndUnzipVSCode()` 返回的是 `vscodeExecutablePath`，不是安装目录；只有在 clean-checkout 首次下载 VS Code 时，这个差异才会暴露。
  证据：依赖自带 README 与 `out/download.d.ts` 都把返回值标成 `vscodeExecutablePath`；在旧实现下，clean-checkout smoke 首次下载后会报 `spawn ENOTDIR`，修复兼容逻辑后已能正常启动 VS Code 并完成 smoke。

- 观察：若验证目标是“当前本地待发布状态”，必须用 `--source working-tree`；默认的 `git ref HEAD` 只验证已提交内容，无法覆盖尚未提交的本地修复。
  证据：修复脚本后继续跑默认 `npm run validate:clean-checkout:vsix` 仍会命中旧 `HEAD` 逻辑；改为 `npm run validate:clean-checkout:vsix -- --source working-tree` 后，隔离验证完整通过。

- 观察：`@vscode/vsce` 对 `.vscodeignore` 的处理不是“按顺序覆盖”，而是“任一忽略命中即排除、任一 negate 命中即放行”；因此 `!node_modules/node-pty/` 这种整目录放行会让后续子路径排除全部失效。
  证据：阅读 `node_modules/@vscode/vsce/out/package.js` 中 `collectFiles()` 的 ignore / negate 归并逻辑，并对照当时 VSIX 中同时出现 `!node_modules/node-pty/` 与 `node_modules/node-pty/src/**` 的规则，确认 `src/`、`scripts/`、`third_party/` 仍被带入包内。

- 观察：把 `node-pty` 改成显式运行时白名单后，VSIX 立刻从 `82 files` / `7.09 MB` 收敛到 `46 files` / `1.90 MB`，而 packaged-payload smoke 仍通过。
  证据：`npm run package:vsix` 输出 `Packaged ... (46 files, 1.9 MB)`；`unzip -l dev-session-canvas-0.1.0.vsix` 中已不再出现 `binding.gyp`、`src/`、`scripts/`、`third_party/`、`typings/`、`.pdb` 与 `node_modules/node-pty/node_modules`；`npm run test:vsix-smoke` 最终输出 `VSIX packaged-payload smoke passed.`。

- 观察：新增的 GitHub issue 模板如果不显式排除，也会被 `vsce` 当成普通仓库文件打进 VSIX；把 `.github/**` 排除后，工件又从 `46 files` 收到 `43 files`，而 smoke 仍通过。
  证据：第一次第二轮打包的 tree 中仍出现 `extension/.github/ISSUE_TEMPLATE/*`；补上 `.github/**` 后，`npm run package:vsix` 输出 `Packaged ... (43 files, 1.9 MB)`，`unzip -l` 不再出现 `.github/`，且 `npm run test:vsix-smoke` 继续输出 `VSIX packaged-payload smoke passed.`。

- 观察：当前 `working tree` 的隔离 clean-checkout 也已经更新到 `43 files` / `1.90 MB`，说明这轮包体收口不是只在共享工作树里偶然成立。
  证据：`npm run validate:clean-checkout:vsix -- --source working-tree` 输出 `DONE  Packaged: ... (43 files, 1.9 MB)`，随后同一命令在隔离目录内再次输出 `VSIX packaged-payload smoke passed.`。

## 决策记录

- 决策：本轮先做“最小可发布工件收口”，不把 publisher、PAT 或 Marketplace 上架演练塞进同一轮。
  理由：没有干净发布包时，渠道账号准备不能降低当前主 blocker。
  日期/作者：2026-04-11 / Codex

- 决策：优先用 `.vscodeignore` 收口当前包内容，而不是先引入更重的 staging 目录或定制复制脚本。
  理由：当前 blocker 主要是明显的调试产物和文档口径不一致；先通过最小改动恢复稳定打包，更符合当前节奏。
  日期/作者：2026-04-11 / Codex

- 决策：`scripts/package-vsix.mjs` 需要同时支持 `node_modules/.bin/vsce` 和 `node_modules/@vscode/vsce/vsce` 两条入口。
  理由：新工具包在当前环境没有生成 `.bin/vsce`，但包内 CLI 脚本本身可用；仓库打包入口不应把这种安装细节变成误报 blocker。
  日期/作者：2026-04-11 / Codex

- 决策：下一步 clean-checkout 验证先通过独立脚本在 `/tmp` 下执行，而不是直接在当前仓库根目录做额外复制、清理或 worktree 切换。
  理由：当前用户仍在同一工作树修 bug；隔离目录更适合并行推进发布验证准备。
  日期/作者：2026-04-11 / Codex

- 决策：第二轮 `node-pty` 瘦身不再用“整目录放行 + 局部排除”，而改成精确列出运行时白名单。
  理由：`@vscode/vsce` 的 ignore / negate 逻辑会让整目录 negate 覆盖后续子路径排除；只有精确白名单才能稳定挡住源码、脚本和 PDB 回流。
  日期/作者：2026-04-14 / Codex

- 决策：当前轮次补齐 issue 模板与 `docs/support.md`，不再把“公开反馈入口缺失”留到真正发布当天才处理。
  理由：这是公开 Preview 的直接缺口，而且属于低风险、可立即完成的对外准备项。
  日期/作者：2026-04-14 / Codex

- 决策：发布流水线本轮暂不建设，继续以 clean-checkout 验证 + packaged-payload smoke 作为最小手工 gate。
  理由：用户已明确要求当前先不建发布流水线；现阶段优先把包体、支持边界和最终发布说明收口，比先搭 CI 更直接降低当前发布风险。
  日期/作者：2026-04-14 / Codex

- 决策：Marketplace 发布页不再直接复用仓库根目录 `README.md`，而使用独立的 `README.marketplace.md`。
  理由：仓库 `README.md` 仍需保留“当前仓库处于公开 Preview 收口期”的开发者语境；Marketplace 页面需要一份对外已发布语气的独立文案，避免出现发布后立即失真的措辞。
  日期/作者：2026-04-14 / Codex

- 决策：首个公开 `Preview` 不以额外截图为 blocker；若发布当天来不及补截图，可直接使用当前 icon、gallery banner 与 listing 文案完成首发。
  理由：Marketplace 截图属于加分项，不是当前发布包治理的必要前置条件；继续把截图资产当成 blocker 只会让计划范围从“发布包治理”滑向“发布运营素材制作”。
  日期/作者：2026-04-14 / Codex

- 决策：Linux、macOS、Windows 本地路径的严格人工验收继续保留为技术债，不再阻塞当前公开 `Preview` 首发。
  理由：当前对外支持矩阵已经明确把 `Remote SSH` 收口为主推荐路径，并把本地路径写成“可尝试，但未严格验证”；只要不把这些路径误写成正式支持承诺，它们就不再构成本计划的 blocker。
  日期/作者：2026-04-14 / Codex

## 结果与复盘

本轮已经完成以下收口：

- `.vscodeignore` 已能挡住 `.debug/`、`.playwright-browsers/`、`tests/`、`test-results/`、截图草稿与未使用图标变体。
- 发布工具链已切换到 `@vscode/vsce`，并修复了当前环境下 `.bin/vsce` 缺失导致的误报。
- `CONTRIBUTING.md`、发布准备总览文档与设计文档已同步成“Marketplace Preview + VSIX 仅作发布工件”的当前口径。
- 当前工作树 `npm run package:vsix` 与 `npm run test:vsix-smoke` 均已通过，说明这轮收口没有破坏 packaged payload 主路径。
- 已补上 `validate:clean-checkout:vsix` 隔离验证入口，后续可在不打扰当前工作树的前提下继续推进 clean-checkout 验证。
- 当前本地 `working tree` 快照、版本已切到 `0.1.0` 的 release head `346c4bf`，以及当前候选 release head 都已经通过隔离 `clean checkout` 打包与 packaged-payload smoke，说明“当前待发布工作树”“上一轮公开基线 ref”和“当前候选发布提交”三层验证都已建立。
- `.vscodeignore` 已完成第二轮 `node-pty` 依赖级瘦身，当前 VSIX 进一步缩到 `46 files` / `1.90 MB`，且 packaged-payload smoke 现在会显式阻止 `binding.gyp`、`scripts/`、`src/`、`third_party/`、`typings/`、嵌套 `node_modules/` 与 `.pdb` 回流。
- `.vscodeignore` 已继续排除 `.github/**`，当前 VSIX 最终收敛到 `43 files` / `1.90 MB`，且 packaged-payload smoke 也会阻止 `.github/` 重新回流。
- GitHub issue 模板与 `docs/support.md` 已补齐，公开 Preview 的普通反馈、安全问题和支持边界说明不再缺入口。
- 发布准备文档已同步记录：`remote-ssh-real-reopen` blocker 已修复为同 canonical workspace id 下的 sibling-slot 搜索、当前人工验收无新增问题，以及“发布流水线本轮暂不建设”的当前决策。
- 已新增 `README.marketplace.md` 与 `docs/public-preview-release-playbook.md`，把 Marketplace listing 草案、release notes 使用口径、升级说明、回滚口径和手工发布步骤收口为正式仓库资产。

本计划范围内已无剩余 blocker。

真正点击发布当天仍需执行的动作，现已全部收口到 `docs/public-preview-release-playbook.md`：

- 若最终发布输入不再是当前候选 release head，则在最终 git ref 上再跑一轮隔离 `clean checkout` 验证。
- 按 playbook 复核最终版本号、截图策略、`README.marketplace.md` 与 `CHANGELOG.md`。
- 使用本地已登录的 `@vscode/vsce` 执行发布，并完成发布后验证。

## 上下文与定向

本计划触及以下文件和模块：

- `.vscodeignore`：决定 VSIX 会排除哪些文件，是当前发布包治理的第一落点。
- `package.json` 与 `package-lock.json`：记录 `@vscode/vsce` 依赖与发布脚本元数据。
- `scripts/package-vsix.mjs`：仓库的 VSIX 打包入口，需要继续兼容本地 `vsce` 可执行文件，但应把工具来源表述更新为 `@vscode/vsce`。
- `CONTRIBUTING.md`：开发者入口，当前还保留旧的内部 VSIX 表述。
- `docs/public-preview-release-playbook.md` 与 `docs/design-docs/public-marketplace-release-readiness.md`：当前正式记录 release-day 执行口径与 blocker 分类，后续继续发布时需要同步新的验证结论。

这里的“发布包收口”特指：让 VSIX 只包含扩展实际运行需要的文件集，并让文档明确 `.vsix` 是 Marketplace 上传工件，不是普通用户安装路径。

## 工作计划

第一阶段先做约束最强、收益最大的包内容收口。`.vscodeignore` 目前漏掉了最容易污染发布包的目录；本轮先把这些路径显式排除，并补上 `tests/` 和明显的截图 / dump 草稿，确保打包不再依赖“本机目录恰好干净”。

第二阶段迁移打包工具链命名。`@vscode/vsce` 仍然通过 `vsce` 命令行工作，但仓库依赖和提示文案不应继续依赖已弃用包名。这里要同步 `package.json`、`package-lock.json` 和 `scripts/package-vsix.mjs` 中的提示。

第三阶段修正文档。开发者文档仍有旧的“内部体验版 VSIX”话术，会误导后来者继续沿着过时分发模型推进。本轮应把它改成“源码编译 / Development Host / VSIX 仅作发布工件输入”的口径。

第四阶段做一轮打包验证，记录当前包体是否仍偏大、是否还有额外噪音文件，并把剩余问题显式写回正式文档和本计划。若发现 `.vscodeignore` 规则并未按预期生效，优先检查是否误用了“整目录放行”式 negate。

## 具体步骤

在仓库根目录执行：

    sed -n '1,260p' .vscodeignore
    sed -n '1,260p' package.json
    sed -n '1,260p' scripts/package-vsix.mjs
    sed -n '1,260p' CONTRIBUTING.md
    rg -n "vsce|VSIX|Marketplace|内部体验" CONTRIBUTING.md README.md docs package.json scripts

完成配置与文档修改后，执行：

    npm install
    npm run package:vsix
    npm run test:vsix-smoke
    unzip -l <生成出的 .vsix> | sed -n '1,220p'

如果需要进一步看包体尺寸，再执行：

    du -sh <生成出的 .vsix>

## 验证与验收

本轮至少满足以下验收条件：

- `npm run package:vsix` 能在当前工作树成功执行，不再因为 `.debug/` 中的非普通文件路径失败。
- 新生成的 VSIX 不再包含 `.debug/`、`.playwright-browsers/`、`tests/`、截图草稿、core dump，以及 `node-pty` 的源码 / 脚本 / PDB 冗余。
- 仓库依赖不再使用已弃用的 `vsce` 包名，而改为 `@vscode/vsce`。
- `CONTRIBUTING.md` 与发布准备文档不再把 `.vsix` 表述成普通用户分发渠道。
- 若仍存在新的体积或内容问题，必须显式记录为剩余 blocker，而不是默认视为完成。

## 幂等性与恢复

- `.vscodeignore` 和文档修改都是幂等的；重复执行不会破坏运行时代码。
- `npm install` 只应用于当前仓库依赖升级；如果安装失败，应保留错误信息并回写本计划，而不是回退到旧包名。
- `npm run package:vsix` 会在仓库根目录生成新的 `.vsix`；重复执行前可直接覆盖旧产物，不需要清理用户代码。

## 证据与备注

当前已确认的本地事实：

    npm run validate:clean-checkout:vsix -- --ref HEAD
    DONE  Packaged: /tmp/dev-session-canvas-clean-checkout-BYhne1/repo/dev-session-canvas-0.1.0.vsix (82 files, 7.09 MB)
    Exit code:   0
    VSIX packaged-payload smoke passed.
    clean checkout 验证完成。临时目录已清理。

    2026-04-14 02:44 同步公开 GitHub 仓库后，可用以下命令核对当时公开仓库 HEAD：
    git ls-remote https://github.com/ZY-WANG-0304/dev-session-canvas.git HEAD refs/heads/main
    该返回值用于确认公开仓库不再为空，并与当时同步到 GitHub 的 MR head 一致；它会随后续 MR head 更新而变化，因此不作为固定 release 验证 SHA 记录。

    隔离验证脚本在 clean checkout 中实际执行了 npm ci、npm run package:vsix 和 npm run test:vsix-smoke。

    最新 VSIX tree 已不再包含 .debug/、.playwright-browsers/、tests/、playwright.config.mjs、test-results/

    npm run package:vsix
    DONE  Packaged: /home/users/ziyang01.wang-al/projects/dev-session-canvas/dev-session-canvas-0.1.0.vsix (43 files, 1.9 MB)

    npm run test:vsix-smoke
    Exit code:   0
    VSIX packaged-payload smoke passed.

    npm run validate:clean-checkout:vsix -- --source working-tree
    DONE  Packaged: /tmp/dev-session-canvas-clean-checkout-nKExCF/repo/dev-session-canvas-0.1.0.vsix (43 files, 1.9 MB)
    Exit code:   0
    VSIX packaged-payload smoke passed.

    npm run validate:clean-checkout:vsix -- --ref HEAD
    DONE  Packaged: /tmp/dev-session-canvas-clean-checkout-gQgexd/repo/dev-session-canvas-0.1.0.vsix (43 files, 1.9 MB)
    Exit code:   0
    VSIX packaged-payload smoke passed.

## 接口与依赖

本轮依赖的外部工具和接口很少：

- `@vscode/vsce`：本地生成 Marketplace 上传所需的 VSIX。
- `unzip`：检查 VSIX 文件内容。
- `npm`：安装与锁定依赖。

本计划创建于 2026-04-11，用于把公开 Marketplace Preview 的讨论收口为实际可验证的发布包治理动作；2026-04-14 已在发布资产收口后移入 `completed/`，剩余事项全部改为 release-day checklist 执行。
