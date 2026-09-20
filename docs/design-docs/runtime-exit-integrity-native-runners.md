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

首轮参数固定为每平台 5 个场景、每场景 3 轮：自然 exit 0、自然 exit 7、12000 行编号输出后 exit 7、跨 write 的合法 UTF-8 尾部、收到开头后的主动取消。writer 的成功回调另存 receipt，完整内容场景同时要求预期 exit code、写成功和终端渲染结果及光标终点一致。Unix 还要求规范化 CRLF 后逐字一致；Windows 比较 ConPTY 生成的 VT 流经现有 `@xterm/headless` 回放后的内容与光标，不能强行要求其原始字节等于 POSIX 字节。

`content-matched` 只表示固定样本的已知内容匹配；`cancelled` 只表示发起取消并观察到退出，不表示排空成功。onExit 后 25 ms 观察窗记录邻近晚到字节，不是生产 drain 预算，也不证明此后不会再来数据。每样本 30 秒发起 kill、32 秒硬截止，整个诊断末尾资源未关闭时在 2 秒 guard 后失败；它们只用于防止诊断挂起。

每轮保存 raw output、xterm 回放结果、子进程脚本、writer receipt、哈希、光标终点及 onData/onExit/socket 事件；总表和 `environment.json` 保存实际 OS release、架构、Node/libuv/node-pty、脚本哈希、GitHub SHA/run/attempt、runner image 信息。Node 22 patch 与 `*-latest` image 会变化，因此每次版本证据必须随样本保存。非 Electron 运行的 `electron` 明确为 null，不能把普通 Node 结果写成 VS Code 结果。

### 验证边界

这是既有公共接口的最小原生基线，不是 source-drain 契约测试或完整产品验收。它尚不覆盖 90000 行压力、候选 reader 对照、后代持有输出、正常 stop 尾部、Windows DLL/worker 全契约、真实 VS Code/Host/Webview、真实 Agent、packaged 和资源预算。Windows 托管 runner 通常是 Windows Server，不能外推到全部 Windows 客户端版本；macOS 架构也以实际工件为准。

失败应保留原始证据，再区分 writer、终端转换、node-pty 读取和诊断判定边界，不因 workflow 失败就直接归因业务 reader。仅基线通过，也不能关闭完整性技术债或宣称重构已修复退出问题。

## 验证与当前证据

在仓库根目录运行：

    node --check scripts/diagnostics/diagnose-native-pty-exit-integrity.mjs
    node scripts/diagnostics/diagnose-native-pty-exit-integrity.mjs --self-test
    node scripts/diagnostics/diagnose-native-pty-exit-integrity.mjs --runs 3 --timeout-ms 30000 --output .debug/native-pty-unique

输出目录必须不存在，避免覆盖首次失败。自校验覆盖预期内容、VT 控制序列回放、UTF-8 和末尾换行丢失引起的光标差异。workflow YAML、设计 frontmatter/索引、引用、`git diff --check` 以及无业务和依赖变更也要校验。

本地开发最终工具在 Linux x64 / Node 25.6.0 / libuv 1.51.0 / node-pty 1.2.0-beta.12 下完成 15 项，12 项 `content-matched`、3 项 `cancelled`，工件 `.debug/native-pty-local-v3/`；开发 v1/v2 工件保留，不把旧 oracle 重复计为最终验收。主代理独立复核同版脚本另 15 项，结果相同，工件 `.debug/native-pty-review-root/`；fixture PID 均已不存在。另在 VS Code 1.117.0 的 Electron 39.8.7 / Node 22.22.1 下以 `ELECTRON_RUN_AS_NODE=1` 完成 15 项同样结果，工件 `.debug/native-pty-review-electron22/`，这不是完整 Host/UI 验收。25 ms 窗内 post-exit 字节为 0 只代表该观察窗。GitHub Actions、托管普通 Node 22、macOS/Windows 原生结果尚未取得，本设计保持验证中。

## 后续收口

主代理复审独立增量后，由 runner worker 推送并创建面向 main 的 PR，收集首次三平台工件并如实记录结果。若有 runner 或诊断错误则修正后保留首次失败与新 attempt；若发现原生库失败则登记为诊断发现，不降低 oracle 使其变绿。完整运行时修复及宿主验收仍由独立工作推进，不在本 PR 中顺带实现。
