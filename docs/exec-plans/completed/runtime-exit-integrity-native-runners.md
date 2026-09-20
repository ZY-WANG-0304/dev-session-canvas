# 建立独立原生 PTY 退出基线 Runner

本 ExecPlan 是活文档，按 `docs/PLANS.md` 持续维护进度、意外与发现、决策记录、结果与复盘。设计结论见 `docs/design-docs/runtime-exit-integrity-native-runners.md`，本计划只覆盖验证基础设施，不覆盖生产退出完整性修复。

## 目标与全局图景

让协作者无需提供 macOS/Windows 机器或 Agent 密钥，即可通过 GitHub Actions 运行原生 node-pty 退出基线，取得内容、进程结果、事件轨迹和环境证据。可观察结果是三个平台各有独立工件，并能分辨内容匹配、主动取消、诊断故障及原生行为失败。本计划的成功不等于产品退出完整性验收通过。

## 进度

- [x] (2026-09-20) 用户授权 runner 专用分支、托管 Actions、工件上传及独立 subagent 工作；禁止混入运行时业务改造。
- [x] (2026-09-20) 新增 Linux/macOS/Windows workflow、公共 node-pty 诊断、自校验及证据输出，本地完成 15 项最终 oracle 基线；主代理另以普通 Node 25 和 Electron-as-Node 22 各独立复核 15 项。
- [x] (2026-09-20) 保留原 `f037a514` 备份，runner 增量独立 rebase 至 `origin/main` 的 `fcf47152`，移除未合重构文档的依赖，登记本专项设计和计划。
- [x] (2026-09-20) 主代理复审 `dfd23b22` 未发现确定性 blocker，授权推送和创建 PR。
- [x] (2026-09-20) 重新 fetch/rebase main 后推送，创建 main PR #294，未合并。
- [x] (2026-09-20) 首次 Actions `35491608835` 三平台均产出工件：Ubuntu 通过，macOS large-output oracle 误报，Windows 内容通过但资源 guard 失败；首次证据保留。
- [x] (2026-09-20) 主代理复审 `6e864e25` 后，第二次 Actions `35492043484` 三平台全部 success，各 15 项，显式 fixture 清理与首次失败分别记录。
- [x] (2026-09-20) 核查全部第二轮工件、cleanup 与 guard，完成基础设施范围验收；后续覆盖和自然退出资源缺口留在技术债，本计划归档并同步设计索引。

## 意外与发现

最初 runner commit `f037a514` 基于未合并的运行时重构提交 `7202298c`。若直接向 main 创建 PR，会一并带入 13 个重构提交。runner 只调用 main 已有 node-pty 与 xterm，因此可独立移植；原重构设计和执行计划在 main 不存在，不能把它们作为本 PR 的上下文依赖。

Windows 的 ConPTY 输出是终端控制序列流，不等于 Unix 上写入的原始文本。因此完整场景需要终端回放内容和光标比较，Unix 额外逐字校验；只检查末尾 marker 不足以构成内容 oracle。25 ms 的 onExit 邻近观察不能成为“没有未来输出”的证明。

首次 macOS large-output 三轮 raw 各有 125 处 CRCRLF，完整文本与光标实际匹配；旧 oracle 把多余 CR 当成新行导致误报。规范化仅移除 LF 前连续 CR，独立 CR 仍保留为不匹配，增加额外行、丢字和缺末尾换行负例。首次 Windows 15 项内容/取消通过但进程 guard 失败：node-pty 自然 onExit 未走 worker dispose，公共 kill 才进入该路径。修正仅在内容结算后事后清理 Windows fixture，并把清理与自然退出观察分别记载，不把清理后资源状态当成自然释放证明。

## 决策记录

决策：本轮从 main 独立交付基础设施，运行时分支之后再 rebase main。理由：用户明确要求 runner 先合 PR，且工具不依赖业务重构。日期/作者：2026-09-20 / 用户确认，Codex 记录。

决策：冻结首轮 Node 22、三托管 OS、每平台 5 场景各 3 轮、30 秒软截止和 32 秒硬截止，不以缩小样本或放宽断言隐藏失败。理由：先取得可比的公共接口基线；实际 patch/image/架构必须进入证据。日期/作者：2026-09-20 / Codex。

决策：最小入口不扩展 Linux 私有 fd reader、不要求 Agent 服务凭证、不加入发布 secret。理由：跨平台 baseline 可以独立验证与回滚，候选和完整宿主需另有明确测试矩阵。日期/作者：2026-09-20 / Codex。

决策：保留首次 macOS/Windows 失败，仅修正已证实的诊断换行 oracle 及事后 fixture 生命周期，增加资源快照；不改生产、不延长 2 秒 guard。理由：内容一致不能掩盖清理失败，重复行末回车也不能被误报为缺尾部；新结果必须经原生重跑证实。日期/作者：2026-09-20 / Codex，主代理确认边界。

## 结果与复盘

runner 增量已与重构隔离并创建 PR #294，未合并。首次 macOS 诊断 oracle 误报与 Windows 资源 guard 失败已分类保留；经主代理复审的 `6e864e25` 在第二次三平台 Actions 全部 success，各 12 个内容匹配和 3 个取消结果。包含显式 Windows fixture 事后清理的最小诊断基础设施已验证，本计划归档。剩余 source-drain、Host/Webview、真实 Agent、packaged、平台矩阵及自然退出资源生命周期均在设计与技术债中保留，不能以本次归档宣称完整运行时交付完成。

## 上下文与定向

PTY 是类 Unix 伪终端，ConPTY 是 Windows 伪控制台。仓库 main 的现有 node-pty 提供原生 spawn/onData/onExit，`@xterm/headless` 用于解释输出控制序列。新增 `scripts/diagnostics/diagnose-native-pty-exit-integrity.mjs` 只启动当前 Node 编写的全新 fixture 子进程，不连接已有 Agent、Terminal 或 Supervisor。

`.github/workflows/runtime-exit-integrity-native.yml` 为普通 Node 22 配置 `ubuntu-latest`、`macos-latest`、`windows-latest`。它只允许手动执行和两条专用分支相关路径 push，无发布路径，权限 `contents: read`。Windows 显式使用 builtin ConPTY，不涉及 DLL。项目依赖由根目录现有 `package-lock.json` 安装，不新增或升级。

## 工作计划与里程碑

### 里程碑一：隔离入口和本地验证

保留旧 runner 分支备份，仅把 workflow 和诊断增量移至最新 main；独立新增本设计与计划，注册设计索引。运行语法、自校验和 Linux 三轮五场景，检查总表、每轮 raw/receipt/事件及 fixture 清理。检查与 main 的差异不包含 `extensions/`、`package.json` 或 `package-lock.json`。该里程碑完成不允许宣称其它平台通过。

### 里程碑二：PR 与托管证据

主代理 review 最新本地 HEAD 无确定性 blocker 后，worker 重新 fetch/rebase main，推送 `runtime-exit-integrity-platform-runners-agent`，并按 `docs/workflows/MR_CREATE.md` 创建 main PR，不合并。首次 push 可触发新 workflow；默认分支尚无该文件时不要依赖 dispatch API 的发现能力。查看三矩阵 job，下载包含 run/attempt 的工件，保存首次失败。诊断失败和安装/runner 故障应分别记载，不将后者误写成原生库 bug。

### 里程碑三：基础设施收口

逐个平台核查实际 OS、架构、Node/libuv/node-pty、脚本 SHA 和各样本结果。确认无覆盖首次失败、无取消伪装排空、无假阳性 oracle，再更新 PR 与本设计。已知缺口记入 `docs/exec-plans/tech-debt-tracker.md`；基础设施自身可用后归档本计划，source-drain 完整性修复不在本计划中完成。

## 具体步骤

命令均从 runner 独立 worktree 根目录执行。安装前提是 Node 可用且能访问锁定依赖；本地当前 Node 25 的结果与远端 Node 22 分开记录。

    npm ci --no-audit --no-fund
    node --check scripts/diagnostics/diagnose-native-pty-exit-integrity.mjs
    node scripts/diagnostics/diagnose-native-pty-exit-integrity.mjs --self-test
    node scripts/diagnostics/diagnose-native-pty-exit-integrity.mjs --runs 3 --timeout-ms 30000 --output .debug/native-pty-unique
    git diff --check
    git diff origin/main -- extensions package.json package-lock.json

最后一条预期为空。证据目录须不存在；换新目录重试，不能清空失败工件。获准后执行 `git fetch origin main`、`git rebase origin/main`、`git push -u origin runtime-exit-integrity-platform-runners-agent`，再用 `gh pr create --base main --head runtime-exit-integrity-platform-runners-agent` 提供中文背景、改动、验证和残余风险。当前 gh 2.4 不支持 `run list --branch`，改用 `gh api 'repos/ZY-WANG-0304/dev-session-canvas/actions/runs?branch=runtime-exit-integrity-platform-runners-agent&per_page=10'` 查看运行；下载时以实际 run id 创建独立目录，例如 `gh run download 35491608835 --name runtime-exit-native-macos-latest-35491608835-1 --dir .debug/github-native-35491608835-attempt1-macos`。

## 验证与验收

每平台固定自然 exit 0、自然 exit 7、12000 行编号输出、分片 UTF-8、收到开头后主动取消各三轮，共 15 个结果。完整场景须 writer receipt 成功、exit code 正确、xterm 内容与光标终点一致，Unix 还须仅 `CR+LF` 规范化后逐字相同；取消仅记录取消和退出，不能归入完整。进程返回非零时也应保存可复查工件。事件记录的 socket close 或 onExit 不单独证明源已排空。Windows 公共 kill 只能发生在内容观察结算后，记录自然观察后的资源、清理请求及最终资源，guard 继续 2 秒；不能把事后清理当成自然退出已释放资源。

本计划验证基础设施的可执行性与结果诚实性，不要求以消除底层真实缺陷换取全绿。首轮原生失败保留并说明后可作为基线发现；安装失败、工具崩溃、工件缺失或 oracle 错误必须先修正。GitHub-hosted Windows 通常为 Server，结果不能自动推广客户端；普通 Node 和 Linux 结果也不能替代 Electron、macOS 或 Windows。

## 幂等性与恢复

首次旧分支在 `backup/runtime-exit-integrity-platform-runners-agent-f037a514` 保留。rebase 冲突仅处理本专项文件，不改变主 worktree 或历史业务。任何失败按新输出目录/新 attempt 重试，工件保留 14 天，重要首次失败提前下载保存。诊断只操作自己的 fixture，停止和清理不得按全局进程名杀已有用户会话。

## 证据与备注

本地最终开发样本位于 `.debug/native-pty-local-v3/`：Linux x64、Node 25.6.0、libuv 1.51.0、node-pty 1.2.0-beta.12，12 `content-matched`、3 `cancelled`。主代理独立复核 `.debug/native-pty-review-root/` 同样 15 项，postExit 观察字节均为 0，fixture PID 全部消失。开发 v1/v2 保留，不能将旧 oracle 算作最终验收。

主代理另用 VS Code 1.117.0 的 Electron 39.8.7 / Node 22.22.1，以 `ELECTRON_RUN_AS_NODE=1` 执行同样 15 项，12 `content-matched`、3 `cancelled`，工件 `.debug/native-pty-review-electron22/`。该结果验证同版脚本可在本地 Electron-as-Node 运行，不是完整 Extension Host/Webview 或托管普通 Node 22 证据。

首轮托管 run `35491608835` / attempt 1，输入 `dfd23b22`，三个平台均 Node 22.23.2 / libuv 1.51.0 / node-pty 1.2.0-beta.12。macOS arm64/Darwin25.6.0，Windows x64/Server2025 build26100 的首次证据保留于 `.debug/github-native-35491608835-attempt1-macos/` 和 `.debug/github-native-35491608835-attempt1-windows/`。macOS 3 个 large-output raw 各多 125 个 CR，只有行末 CRCRLF，xterm 内容/光标与 receipt/exit 都匹配；Windows 15 项内容/取消通过但最终 2 秒 guard 失败。详情和环境 image 见设计。修正后本地 `.debug/native-pty-oracle-cleanup-v2/` 15 项通过，才进入第二次原生执行。

第二次 run `35492043484` / attempt 1、输入 `6e864e25` 的 3 job 全部 success，共 45 项。Ubuntu x64/Linux6.17.0-1022-azure/image20260907.300.1、macOS arm64/Darwin25.6.0/image20260907.0351.1、Windows x64/Server2025 build26100/image20260907.229.1，均 Node22.23.2/libuv1.51.0/node-pty1.2.0-beta.12。工件 `.debug/github-native-35492043484-attempt1-{ubuntu,macos,windows}/` 均无 cleanup error 或 shutdown-timeout。Windows 12 个自然样本事后公共 kill，3 个取消不重复 kill；其第一个自然观察结束仍有 MessagePort，shutdown-start 有 17 PipeWrap、4 MessagePort、7 Timeout 在途，之后在原 2 秒 guard 内自然退出 0。不能把这解释为自然退出自动清理或资源计数为零。

收口提交只更新文档；诊断和 workflow 与已跑的 `6e864e25` 保持相同 blob，不重复声称在最终文档 HEAD 重新跑过原生矩阵。首次失败和第二次成功的 run/attempt 均保留，工件已另行下载，不只依赖 14 天远端保留。

## 接口与依赖

CLI 提供 `--self-test`，或 `--runs N --timeout-ms N --output DIR`。结果输出 `environment.json`、汇总 `summary.json`、`shutdown-start.json`、guard 失败时的 `shutdown-timeout.json`，以及每场景每轮目录中的 `output.txt`、`rendered.txt`、`child-script.js`、`writer-receipt.json`（完整写场景）与含独立 cleanup 的 `summary.json`。不增加业务接口、协议或 package scripts；依赖保持 main 原样。

修订记录：2026-09-20 将 runner 基础设施从未合运行时重构中抽离，登记自包含 main 增量和真实验证边界；等待最新 HEAD 复审、推送及托管首轮证据。

修订记录：2026-09-20 创建 PR #294 并记录首次三平台工件；修正已确认的 macOS oracle 误报和诊断 Windows 事后清理，保持首轮失败与资源问题单独可追溯，待复审原生重跑。

修订记录：2026-09-20 第二次三平台原生入口与工件验证完成，仅将独立 runner 专项归档；保留首次失败、显式清理边界和完整运行时验收缺口，不混入生产修复。
