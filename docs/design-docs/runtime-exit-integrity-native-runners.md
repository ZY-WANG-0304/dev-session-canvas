---
title: 原生 PTY 退出基线与托管 Runner
decision_status: 已选定
validation_status: 验证中
domains: [执行编排域, VSCode 集成域]
architecture_layers: [适配与基础设施层]
related_specs: []
related_plans:
  - docs/exec-plans/active/runtime-exit-integrity-native-runners.md
updated_at: 2026-09-20
---

# 原生 PTY 退出基线与托管 Runner

## 背景与范围

Terminal / Agent 的退出完整性需要原生平台证据。仅在 Linux 检查 node-pty 或用 JavaScript 模拟 Windows 行为，不能证明 macOS PTY 或 Windows ConPTY 已正确处理输出尾部。PTY 是类 Unix 系统的伪终端；ConPTY 是 Windows 提供的伪控制台接口。本轮先交付可独立运行的跨平台基线，验证既有 node-pty 公共接口，并保存成功与失败证据，不选择或实现生产 reader。

2026-09-20 用户允许推送专用分支、使用 GitHub-hosted runner 和上传诊断工件，要求工作独立于运行时重构。runner 增量从重构分支拆出，基于 `origin/main` 的 `fcf47152`，只包含 workflow、独立诊断及本专项文档。原分支的运行时改造和相关设计不进入本 PR；本工具只依赖 main 已有的 node-pty 和 `@xterm/headless`。本轮不修改业务、依赖版本、lockfile、发布流程或产品支持范围。

## 正式方案

### 入口与隔离

`.github/workflows/runtime-exit-integrity-native.yml` 提供 `workflow_dispatch`，以及 `runtime-exit-integrity-platform-runners` / `runtime-exit-integrity-platform-runners-agent` 两条显式分支的相关路径 push 触发。首次 branch push 可启动尚未进入默认分支的 workflow；不假定此时 dispatch API 已发现它。合入 main 后可手动执行，不接发布和普通 PR 自动门禁。

任务使用 `ubuntu-latest`、`macos-latest`、`windows-latest`，Node 主版本固定 22，运行 `npm ci --no-audit --no-fund` 使用既有锁定依赖。矩阵 `fail-fast: false`，单任务最长 20 分钟。权限仅 `contents: read`，checkout 不保留凭据，不引用发布 secret。各任务无论成功失败都尝试上传证据，工件名称区分 OS、run id 与 attempt，保留 14 天。失败首次工件不能被重跑替代；重要证据须在到期前另存并登记。

### 原生诊断与判定

`scripts/diagnostics/diagnose-native-pty-exit-integrity.mjs` 直接以当前 Node 为子进程，不经过 shell。在 Linux/macOS 使用原生 Unix PTY；Windows 显式 `useConpty: true`、`useConptyDll: false`，验证 builtin ConPTY，不验证随库分发的 DLL 路径。

首轮参数固定为每平台 5 个场景、每场景 3 轮：自然 exit 0、自然 exit 7、12000 行编号输出后 exit 7、跨 write 的合法 UTF-8 尾部、收到开头后的主动取消。writer 的成功回调另存 receipt，完整内容场景同时要求预期 exit code、写成功和终端渲染结果及光标终点一致。Unix 还要求仅将 LF 前的一个或多个 CR 规范化后逐字一致，独立 CR、额外行、丢字和末尾换行缺失仍拒绝；Windows 比较 ConPTY 生成的 VT 流经现有 `@xterm/headless` 回放后的内容与光标，不能强行要求其原始字节等于 POSIX 字节。

`content-matched` 只表示固定样本的已知内容匹配；`cancelled` 只表示发起取消并观察到退出，不表示排空成功。onExit 后 25 ms 观察窗记录邻近晚到字节，不是生产 drain 预算，也不证明此后不会再来数据。每样本 30 秒发起 kill、32 秒硬截止，整个诊断末尾资源未关闭时在 2 秒 guard 后失败；它们只用于防止诊断挂起。

每轮保存 raw output、xterm 回放结果、子进程脚本、writer receipt、哈希、光标终点及 onData/onExit/socket 事件；总表和 `environment.json` 保存实际 OS release、架构、Node/libuv/node-pty、脚本哈希、GitHub SHA/run/attempt、runner image 信息。Node 22 patch 与 `*-latest` image 会变化，因此每次版本证据必须随样本保存。非 Electron 运行的 `electron` 明确为 null，不能把普通 Node 结果写成 VS Code 结果。

自然退出内容观察完成后，Windows fixture 另用公共 `kill()` 回收其 worker；已主动取消的样本不重复 kill。这是诊断事后清理，不代表自然 onExit 自动释放资源，更不能用于证明排空。每轮 `cleanup` 单独记录观察结束时资源计数、清理请求时间和请求后计数；退出事件补实际 PID。`shutdown-start.json` 记录最终资源，2 秒 guard 失败时额外写 `shutdown-timeout.json`。不调用私有 dispose、不延长 guard、不用强制退出 0 隐藏资源失败。

### 验证边界

这是既有公共接口的最小原生基线，不是 source-drain 契约测试或完整产品验收。它尚不覆盖 90000 行压力、候选 reader 对照、后代持有输出、正常 stop 尾部、Windows DLL/worker 全契约、真实 VS Code/Host/Webview、真实 Agent、packaged 和资源预算。Windows 托管 runner 通常是 Windows Server，不能外推到全部 Windows 客户端版本；macOS 架构也以实际工件为准。

失败应保留原始证据，再区分 writer、终端转换、node-pty 读取和诊断判定边界，不因 workflow 失败就直接归因业务 reader。仅基线通过，也不能关闭完整性技术债或宣称重构已修复退出问题。

## 验证与当前证据

在仓库根目录运行：

    node --check scripts/diagnostics/diagnose-native-pty-exit-integrity.mjs
    node scripts/diagnostics/diagnose-native-pty-exit-integrity.mjs --self-test
    node scripts/diagnostics/diagnose-native-pty-exit-integrity.mjs --runs 3 --timeout-ms 30000 --output .debug/native-pty-unique

输出目录必须不存在，避免覆盖首次失败。自校验覆盖预期内容、VT 控制序列回放、UTF-8 和末尾换行丢失引起的光标差异。workflow YAML、设计 frontmatter/索引、引用、`git diff --check` 以及无业务和依赖变更也要校验。

本地开发初版工具在 Linux x64 / Node 25.6.0 / libuv 1.51.0 / node-pty 1.2.0-beta.12 下完成 15 项，12 项 `content-matched`、3 项 `cancelled`，工件 `.debug/native-pty-local-v3/`；开发 v1/v2 工件保留，不把旧 oracle 重复计为最终验收。主代理独立复核同版脚本另 15 项，结果相同，工件 `.debug/native-pty-review-root/`；fixture PID 均已不存在。另在 VS Code 1.117.0 的 Electron 39.8.7 / Node 22.22.1 下以 `ELECTRON_RUN_AS_NODE=1` 完成 15 项同样结果，工件 `.debug/native-pty-review-electron22/`，这不是完整 Host/UI 验收。25 ms 窗内 post-exit 字节为 0 只代表该观察窗。

首次 Actions 为 [run 35491608835 / attempt 1](https://github.com/ZY-WANG-0304/dev-session-canvas/actions/runs/35491608835)，输入 `dfd23b22`、各平台 Node 22.23.2 / libuv 1.51.0 / node-pty 1.2.0-beta.12。Ubuntu job 成功；macOS arm64 / Darwin 25.6.0 / macos26 image 20260907.0351.1 的 3 个 large-output 失败，Windows x64 / Server 2025 build 26100 / win25-vs2026 image 20260907.229.1 的 15 个内容/取消结果通过但最终资源 guard 失败，因此不能把 Windows job 写成通过。

首次 macOS 3 轮均为 raw 276125 字节，比预期多 125 个行末 CR，每轮 125 处 CRCRLF；完整 xterm 内容、光标、writer receipt、exit 7 都匹配。只将 `CR+LF` 转为 LF 后与 12000 行逐字一致且无独立 CR。此前把每个独立 CR 都映射成新行的 oracle 误判了重复回车，这是确定性诊断错误，不是短读证据。修正同时增加独立 CR、额外行、丢字和缺末尾换行负例，原失败工件保持不变。

首次 Windows 资源失败单独保留。node-pty `WindowsPtyAgent._cleanUpProcess()` 只销毁输出 socket，自然 `onExit` 不调用 worker dispose；公共 `kill()` 才走 worker 清理，IPty 没有独立 dispose。新诊断在内容结算后显式清理并记录资源，尚待原生重跑确认；这不修改或证明产品自然退出清理。首次 macOS/Windows 原始证据已分别下载到 `.debug/github-native-35491608835-attempt1-macos/` 与 `.debug/github-native-35491608835-attempt1-windows/`。修正后本地 Node 25 的 15 项再次通过，工件 `.debug/native-pty-oracle-cleanup-v2/`，原生新证据待 review 后执行。

## 后续收口

已创建面向 main 的 [PR #294](https://github.com/ZY-WANG-0304/dev-session-canvas/pull/294)。首轮暴露的诊断 oracle 和 Windows fixture 清理修正须经主代理复审后原生重跑，保留首次失败与后续工件；若仍有原生库失败则登记为诊断发现，不降低内容、光标或退出门槛。完整运行时修复及宿主验收仍由独立工作推进，不在本 PR 中顺带实现；覆盖和生命周期缺口见 `docs/exec-plans/tech-debt-tracker.md`。
