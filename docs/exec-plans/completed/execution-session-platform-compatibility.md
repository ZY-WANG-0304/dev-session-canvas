# 执行会话平台兼容性收口

本 `ExecPlan` 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘` 这几个章节。

当前文档必须按照仓库根目录下的 `docs/PLANS.md` 持续维护。

## 目标与全局图景

当前用户已经明确要求：优先支持 Linux / macOS；如果复杂度可控，尽量一起支持 Windows；如果缺乏足够证据，则不要把 Windows 伪装成已经稳定支持。完成这次变更后，用户应该能在同一套宿主后端模型上运行画布内的 `Terminal` 与 `Agent` 会话，不再看到“仅 Linux 验证”的硬拦截，并且运行中的节点尺寸变化可以真正同步到 PTY。

用户可见的完成标准是：扩展不再只在 `process.platform === 'linux'` 时允许运行嵌入式会话；宿主改为统一 PTY 抽象；Linux 本地 smoke test 证明新后端仍提供真实 TTY；仓库文档明确写出 Linux / macOS 优先、Windows 待人工验证的边界。

## 进度

- [x] (2026-03-30 09:15Z) 复核工作流、设计文档和现有实现，确认本任务属于显著后端重构，必须先补设计与 `ExecPlan`。
- [x] (2026-03-30 09:32Z) 调研当前 `CanvasPanelManager` 中的 Linux `script` 假设，确认平台判断、启动方式、停止语义和 resize 都写死在同一文件里。
- [x] (2026-03-30 09:48Z) 选择统一 `node-pty` 路线，而不是继续扩展 `script` 的类 Unix 分支。
- [x] (2026-03-30 10:05Z) 新增最小执行会话 bridge，并把 `Agent` / `Terminal` 的宿主启动逻辑切换到统一 PTY 后端。
- [x] (2026-03-30 10:12Z) 让运行中 resize 重新接通，并同步更新 Webview 的尺寸上报逻辑。
- [x] (2026-03-30 10:18Z) 通过 `npm run typecheck`、`npm run build` 和 Linux 本地 `node-pty` TTY smoke test。
- [x] (2026-03-30 10:26Z) 把 macOS / Windows / Remote 人工验证缺口登记为正式技术债，而不是在当前轮次伪装成已完成。
- [x] (2026-03-30 10:41Z) 完成 `npm run package:vsix`，确认 VSIX 可生成，并把 `node-pty` 运行时打包体积偏大的问题登记为残余风险。
- [x] (2026-03-30 15:28Z) 根据 review 修复 `node-pty` 退出事件里 `signal: 0` 被误写成字符串 `"0"` 的确定性回归，避免非零退出码被错误摘要成“因信号 0 退出”。

## 意外与发现

- 观察：当前仓库的扩展构建目标已经是 `node18`，但历史设计文档仍然围绕外部 shell 的 `node v12.22.9` 风险做了保守结论。
  证据：`scripts/build.mjs` 里 `target: 'node18'`；而旧设计文档仍把 `node-pty` 作为高风险候选。

- 观察：`node-pty` 当前包已经自带 macOS / Windows 预编译产物，可以显著降低“先做跨平台支持就必须先搭完整原生编译链”的压力。
  证据：`node_modules/node-pty/prebuilds/` 下存在 `darwin-*` 与 `win32-*` 产物。

- 观察：在当前 Linux 环境里，`node-pty` 路线下子 shell 的 `stdin/stdout` 仍然表现为真实 TTY。
  证据：本计划底部的 smoke test 记录输出 `True True`。

- 观察：`npm run package:vsix` 已能把 `node-pty` 运行时带入 VSIX，但当前打包结果仍包含比运行时必需范围更宽的依赖内容。
  证据：本轮生成的 `opencove-extension-0.0.1.vsix` 可成功产出；检查包内容可见 `node-pty` 的 `deps/`、`build/` 元数据和部分非运行时文件仍被带入。

## 决策记录

- 决策：当前轮次直接切到统一 `node-pty` 后端，而不是给 macOS 再单独补一套 `script` 兼容层。
  理由：用户目标已经从“Linux 原型能跑”升级到“Linux / macOS 优先，Windows 尽量兼容”；继续扩展 `script` 只会制造更多平台分支。
  日期/作者：2026-03-30 / Codex

- 决策：Windows 路径本轮随统一后端一起接通，但文档状态继续保持“验证中”。
  理由：当前没有 Windows 本地人工验证证据；仓库规则要求不能把未确认内容写成已确认。
  日期/作者：2026-03-30 / Codex

- 决策：`Agent` 命令继续保持“一个可执行命令路径”的配置语义，不在本轮把它升级成通用 shell 命令模板。
  理由：当前设置项语义已经是“命令路径覆盖”；如果现在把它放大成 shell 片段，会把 Windows quoting 和安全边界一起复杂化。
  日期/作者：2026-03-30 / Codex

## 结果与复盘

当前已经完成的部分：

- 宿主从 `script + ChildProcess` 切换到 `node-pty` bridge。
- `Agent` / `Terminal` 共用统一的 `spawn / write / resize / kill / onData / onExit` 模型。
- 运行中 resize 已重新接通，不再局限于“启动前首帧 fit”。
- 共享协议和节点持久化元数据默认后端已迁移到 `node-pty`。
- 文档已经补充 Linux / macOS 优先、Windows 待验证的边界。

当前仍然保留的缺口：

- 缺少 macOS 本地人工 smoke test。
- 缺少 Windows 本地人工 smoke test。
- Remote SSH / Codespaces 仍未纳入这轮验证矩阵。
- VSIX 当前已可打包，但 `node-pty` 相关产物仍偏大，后续应继续收紧到运行时必需集。

## 上下文与定向

本任务涉及的关键区域如下：

- `src/panel/CanvasPanelManager.ts`：当前宿主会话编排中心。变更前这里直接 `spawn('script', ...)`，并内联了平台判断、输入输出桥和停止语义。
- `src/panel/executionSessionBridge.ts`：本轮新增的最小 PTY bridge。它负责把 `node-pty` 暴露成仓库内部统一会话接口。
- `src/webview/main.tsx`：执行型节点的 `xterm.js` 前端。本轮需要让它在活跃会话期间也继续上报 resize。
- `src/common/protocol.ts`：节点元数据里的 backend 类型和执行消息协议定义。
- `docs/design-docs/*.md` 与 `docs/product-specs/*.md`：设计结论、产品边界和验证状态的事实来源。

这里的“统一 PTY 后端”指的是：不再让 `CanvasPanelManager` 直接依赖某个平台的具体系统命令，而是通过一个最小 bridge 暴露“创建会话、写入、resize、停止、订阅输出、订阅退出”这些统一动作。

## 工作计划

先补设计文档，把“为什么不继续扩展 `script`”“为什么当前直接切到 `node-pty`”“哪些平台已实现、哪些仍待验证”写清楚。然后在实现层增加一个最小 bridge，把 Linux 特有的 `spawn('script', ...)` 从 `CanvasPanelManager` 里抽出去，再让 `Agent` 与 `Terminal` 都通过统一接口启动。

后续再把 Webview 的尺寸上报逻辑放开到活跃会话，使后端的真实 PTY resize 能够生效。最后运行类型检查、生产构建和 Linux 本地 TTY smoke test，并把剩余的平台验证缺口写回文档与技术债，而不是省略不写。

## 具体步骤

1. 在仓库根目录新增设计文档 `docs/design-docs/execution-session-platform-compatibility.md`，并同步更新设计索引与相关旧文档。
2. 在 `src/panel/` 下新增 `executionSessionBridge.ts`，定义统一 PTY 接口并接入 `node-pty`。
3. 修改 `src/panel/CanvasPanelManager.ts`，移除 Linux 平台硬拦截和 `script` 启动逻辑，改用新 bridge。
4. 修改 `src/webview/main.tsx`，让活跃会话期间的 resize 继续上报到宿主。
5. 运行以下验证命令：

    cd /home/users/ziyang01.wang-al/projects/opencove_extension.worktrees/opencove_extension_publish
    npm run typecheck
    npm run build
    node - <<'EOF'
    const pty = require('node-pty');
    const shell = process.env.SHELL || '/bin/bash';
    const term = pty.spawn(shell, ['-lc', 'python3 -c "import sys; print(sys.stdin.isatty(), sys.stdout.isatty())"'], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: process.cwd(),
      env: process.env,
    });
    let output = '';
    term.onData((chunk) => { output += chunk; });
    term.onExit(({ exitCode }) => {
      process.stdout.write(output.trim() + '\nEXIT=' + exitCode + '\n');
    });
    EOF

## 验证与验收

自动化与脚本验证要求如下：

- `npm run typecheck` 成功通过。
- `npm run build` 成功生成构建产物。
- `npm run package:vsix` 成功生成 VSIX。
- Linux 本地 `node-pty` smoke test 输出 `True True` 且退出码为 `0`。

人工验收要求如下：

- 在 macOS 本地 VSCode 中，新建 `Terminal` 节点后可直接在节点内输入命令并看到实时输出。
- 在 macOS 本地 VSCode 中，新建 `Agent` 节点后可直接启动 `Codex` 或 `Claude Code` CLI 会话。
- 若要对外声称 Windows 可用，还需在 Windows 本地 VSCode 中完成同等级 smoke test。

## 幂等性与恢复

这次变更应支持重复执行。旧工作区状态里若仍保存 `backend: script` 或基于 `script` 原型遗留的字段，归一化逻辑必须把它们迁移到当前默认 `node-pty` 元数据，而不是让旧状态直接失效。

如果执行会话仍在运行，Webview 重新挂载时只能附着到已有会话，不能因为尺寸同步或快照请求重复创建新 PTY。若扩展被真正重载，则仍允许当前活动会话丢失，但必须把节点状态写成明确可解释的终止态。

## 证据与备注

当前已经拿到的关键验证证据如下：

    $ npm run typecheck
    > opencove-extension@0.0.1 typecheck
    > tsc --noEmit

    $ npm run build
    > opencove-extension@0.0.1 build
    > node scripts/build.mjs

    $ node - <<'EOF'
    ... node-pty smoke test ...
    EOF
    True True
    EXIT=0

    $ npm run package:vsix
    > opencove-extension@0.0.1 package:vsix
    > npm run package && node scripts/package-vsix.mjs

## 接口与依赖

本轮新增并依赖以下接口与模块：

- `src/panel/executionSessionBridge.ts`
  - `createExecutionSessionProcess(...)`
  - `ExecutionSessionProcess`
  - `ExecutionSessionLaunchSpec`
- `node-pty`
  - 作为统一 PTY 后端，负责 `spawn / write / resize / kill / onData / onExit`

`CanvasPanelManager` 中的会话对象必须至少保存：

- 运行时进程对象
- 当前列宽 / 行高
- 输出缓冲
- 停止标记
- 输出订阅和退出订阅

本次修订：2026-03-30，新增平台兼容性计划并记录已完成实现；当前剩余缺口只在 macOS / Windows / 远程场景的人工验证。
