# 把 Terminal 升级为嵌入式会话窗口

本 `ExecPlan` 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘` 这几个章节。

当前文档必须按照仓库根目录下的 `docs/PLANS.md` 持续维护。

## 目标与全局图景

当前画布里的 `Terminal` 仍然是“宿主终端代理节点”：节点本体只展示摘要和按钮，真正的 shell 会话仍然跑在 VSCode 原生终端里。完成这次变更后，用户应该能直接在画布中的 `Terminal` 节点里输入命令、看到真实输出、滚动历史，并把它当作一级 runtime window 使用，而不是再跳去外部终端。

用户可见的完成标准是：打开画布后，新建一个 `Terminal` 节点，点击启动，节点内部出现真正可交互的终端；输入 `pwd`、`ls` 或 `python3 -c "import sys; print(sys.stdin.isatty(), sys.stdout.isatty())"` 能返回真实输出；关闭或重启会话后，节点状态与摘要同步变化；Webview 隐藏或重新显示后，仍能重新附着到活跃终端。

## 进度

- [x] (2026-03-29 10:29Z) 复核仓库工作流、产品规格、架构与当前终端实现，确认这次工作属于显著设计变更，必须先补 `ExecPlan` 和设计文档。
- [x] (2026-03-29 10:29Z) 验证当前 Linux 环境存在 `/usr/bin/script`，并确认它可以为子 shell 分配真实 PTY，`stdin/stdout` 在子进程内表现为 TTY。
- [x] (2026-03-29 10:29Z) 新增并登记 Terminal 嵌入式会话窗口设计文档，同时同步更新产品规格与架构文档中的终端结论。
- [x] (2026-03-29 10:29Z) 扩展共享协议和终端节点元数据，移除“宿主原生终端代理”心智，改为“嵌入式终端会话”心智。
- [x] (2026-03-29 10:29Z) 在宿主侧实现基于 `script` 的 PTY 会话管理、输出缓冲、附着、输入、停止和状态回流。
- [x] (2026-03-29 10:29Z) 在 Webview 中引入 `xterm.js`，把 Terminal 节点改为真正的嵌入式终端窗口。
- [x] (2026-03-29 10:29Z) 完成构建、类型检查与 PTY smoke test，并记录仍需人工确认的 VSCode UI 手动验证项。

## 意外与发现

- 观察：当前 shell 默认是 `node v12.22.9`，如果直接引入 `node-pty`，很容易同时踩到“本地 Node 版本”和“VSCode/Electron ABI”两层原生模块兼容问题。
  证据：`node -v` 输出 `v12.22.9`；当前环境没有 `code` CLI 可直接拿到本机 VSCode/Electron 版本。

- 观察：当前 Linux 环境内置了 util-linux 的 `script`，它能在宿主侧为子 shell 分配真实 PTY，而不需要额外原生 Node 模块。
  证据：`which script && script --version` 输出 `/usr/bin/script` 和 `script from util-linux 2.37.2`。

- 观察：`script -qfc /bin/bash /dev/null` 路线下，子 shell 中 `sys.stdin.isatty()` 与 `sys.stdout.isatty()` 都是 `True`，说明这不是普通 pipe 包装，而是真实终端语义。
  证据：`printf 'python3 -c "import sys; print(sys.stdin.isatty(), sys.stdout.isatty())"\nexit\n' | script -qfc /bin/bash /dev/null` 输出 `True True`。

- 观察：如果把终端增量输出直接塞回 React 状态，会把整张画布拖进高频重渲染；当前实现必须把实时终端流从主 React 状态同步中拆开。
  证据：实现最终采用独立终端事件总线，Host 通过 `host/terminalSnapshot`、`host/terminalOutput`、`host/terminalExit` 推送数据，节点内 `xterm.js` 实例直接消费这些事件。

## 决策记录

- 决策：本轮优先采用 `xterm.js + script PTY bridge`，而不是 `xterm.js + node-pty`。
  理由：用户目标是“真正可交互的嵌入式终端”，但当前仓库环境下 `node-pty` 会额外引入原生模块、Electron ABI 和本地 Node 版本的高风险前置条件；`script` 已在当前 Linux 环境验证能提供真实 PTY，更适合先把产品主路径做通。
  日期/作者：2026-03-29 / Codex

- 决策：当前终端 buffer 只保留在宿主内存里，不把完整原始输出直接持久化到 `workspaceState`。
  理由：原始终端流可能很大，且包含 ANSI 控制序列；本轮先持久化摘要、最近输出和退出信息，保证重开画布时仍有上下文，但不承诺跨扩展重载恢复完整活动会话。
  日期/作者：2026-03-29 / Codex

- 决策：当前实现优先覆盖 Linux/类 Unix 的 `script` 后端；不把 Windows 平台兼容性伪装成已完成能力。
  理由：当前可验证证据来自 Linux 环境；如果没有对应后端，就必须显式退化，而不是把未验证平台写成已支持。
  日期/作者：2026-03-29 / Codex

- 决策：实时终端输出通过独立事件通道直接写入节点内 `xterm.js`，而不是经由 React `hostState` 每次重渲染整张画布。
  理由：终端输出是高频流式数据；如果继续沿用宿主状态全量投影，画布层会承受不必要的重渲染压力，并影响多节点并行体验。
  日期/作者：2026-03-29 / Codex

## 结果与复盘

本轮已完成以下结果：

- 新增 `Terminal` 嵌入式会话窗口设计文档，并同步更新产品规格、设计索引和运行时架构文档。
- 扩展共享协议，把终端消息从“创建/显示宿主终端”改为“启动/附着/输入/停止嵌入式终端会话”。
- 在宿主侧用 `script -qfc <shell> /dev/null` 建立真实 PTY 会话，并维护节点级输出缓冲、退出信息和状态回流。
- 在 Webview 中接入 `xterm.js` 与 fit addon，把 `Terminal` 节点升级为真正的节点内终端窗口。
- 保留了 Webview 隐藏或重新显示后的重新附着能力，同时明确记录“扩展重载后不恢复完整活动会话”这一边界。

本轮已完成的自动化/脚本验证：

- `npm run build`
- `npm run typecheck`
- `printf 'python3 -c "import sys; print(sys.stdin.isatty(), sys.stdout.isatty())"\nexit\n' | script -qfc /bin/bash /dev/null`

当前仍未完成的验证：

- 无法在当前 shell 环境直接启动 `Extension Development Host`，因为环境里没有 `code`/`cursor`/`codium` 等 CLI；因此“节点内真实交互路径”的最后一跳仍需在本地 VSCode 中人工确认。

## 上下文与定向

本任务会同时修改以下几个区域：

- `docs/product-specs/canvas-core-collaboration-mvp.md`：当前还把“嵌入式全功能终端”列在范围外，需要同步规格边界。
- `docs/design-docs/vscode-canvas-runtime-architecture.md`：当前仍把“原生终端代理节点”写成第一阶段首选，需要改成与本轮结论一致。
- `src/common/protocol.ts`：定义 Host 和 Webview 之间的终端消息协议。
- `src/panel/CanvasPanelManager.ts`：当前只管理 VSCode 原生 `Terminal` 对象，需要改为管理嵌入式终端会话。
- `src/webview/main.tsx`：当前 `TerminalSessionNode` 只显示摘要卡片，需要升级为真正的终端窗口组件。
- `src/webview/styles.css`：需要给 `xterm.js` 容器、工具栏、状态条和空态做样式。
- `package.json`：需要新增 Webview 终端前端依赖。

这里的“嵌入式终端”指的是：终端前端渲染在画布节点内部，用户的主要输入、输出与滚动行为都发生在节点里；宿主只负责创建 shell 会话、传递字节流、维护状态与恢复边界。

这里的“PTY”指 pseudo terminal，也就是真正给 shell 提供终端语义的宿主对象。普通 `spawn(..., stdio: 'pipe')` 不等于 PTY，因为很多 shell 和交互程序会把它当成非终端输入输出；本轮通过 `script` 这个系统程序来分配 PTY。

## 工作计划

先收敛文档，再改实现。先新增一份专门的 Terminal 设计文档，把“为什么不再使用宿主终端代理节点”“为什么当前选 `script` 后端”“活动会话如何恢复或退化”写清楚。然后同步产品规格和运行时架构文档，避免仓库里同时存在两套互相冲突的终端结论。

实现阶段分三段。第一段改共享协议和终端元数据，把终端节点从“terminalName + revealMode”迁移到“shell 路径、cwd、最近输出、退出信息、是否有活跃嵌入式会话”这些与嵌入式终端直接相关的字段。第二段在 `CanvasPanelManager` 里维护会话表：创建 `script` 子进程、缓冲输出、接收输入、向 Webview 推送增量数据，并在退出时更新节点状态。第三段在 Webview 中引入 `xterm.js` 和 fit addon，把终端节点改造成真正的运行时窗口，同时保留明确的空态、启动、停止和重启动作。

完成代码后，运行构建与类型检查，并补一条 PTY smoke test，证明后端确实提供了真实 TTY。最后把仍需 `Extension Development Host` 人工确认的内容写进文档，而不是略过不写。

## 具体步骤

1. 在仓库根目录下编写设计文档和本计划，并同步更新产品规格、设计索引与架构文档。
2. 修改 `src/common/protocol.ts`，为嵌入式终端增加：
   - 终端节点元数据字段；
   - Webview 到 Host 的创建、附着、输入与停止消息；
   - Host 到 Webview 的快照、增量输出与退出消息。
3. 修改 `src/panel/CanvasPanelManager.ts`：
   - 定义嵌入式终端会话结构；
   - 解析 shell 路径、cwd 和受信任状态；
   - 用 `script -qfc <shell> /dev/null` 启动子 shell；
   - 维护按节点 ID 索引的会话表和有限长度的原始输出缓冲；
   - 把 ANSI 清洗后的最近输出、退出码和状态摘要写回宿主权威状态。
4. 修改 `src/webview/main.tsx`：
   - 引入 `xterm.js` 与 fit addon；
   - 给每个 `Terminal` 节点创建独立的终端前端实例；
   - 在节点挂载后向宿主请求快照并附着；
   - 把用户输入回传宿主，并在首次启动时按节点当前尺寸计算会话列数和行数；
   - 保持事件不冒泡到 React Flow 画布。
5. 修改 `src/webview/styles.css` 与 `package.json`，接入样式和依赖。
6. 运行验证命令，并把结果写回本计划与设计文档。

## 验证与验收

自动化与脚本验证至少包括：

- 在仓库根目录运行 `npm run build`，预期成功生成 `dist/extension.js`、`dist/webview.js` 和 `dist/webview.css`。
- 在仓库根目录运行 `npm run typecheck`，预期 TypeScript 检查通过。
- 运行 PTY smoke test，预期子 shell 内 `stdin/stdout` 都被识别为 TTY。

人工验证至少需要覆盖以下场景：

- 在 `Extension Development Host` 中新建 `Terminal` 节点并启动嵌入式终端；
- 在节点内输入 `pwd`、`ls` 等命令并看到实时输出；
- 关闭或停止会话后，节点状态和摘要回流；
- 隐藏再显示 Webview 后，仍能附着回同一活跃终端；
- 未信任 workspace 时，终端会话创建与输入被正确禁用。

如果当前 shell 环境无法直接启动 `Extension Development Host`，必须在最终说明和本计划中明确标注“已完成的自动化验证”和“仍待人工确认的 UI 场景”。

## 幂等性与恢复

本计划中的文档修改与代码修改都应支持重复执行。终端节点旧状态里若仍带有 `terminalName`、`revealMode` 等旧字段，归一化逻辑必须把它们迁移到新的嵌入式终端元数据上，而不是让旧工作区状态直接失效。

如果终端会话在 Webview 隐藏或面板重新创建时仍存在，重新附着操作应只重发缓冲快照，不重复创建新 shell。只有显式点击“启动终端”时，才创建新会话。

如果扩展本身被重载，当前活动会话可能中断；这种情况下必须把节点状态更新成明确可理解的退出或中断态，而不是伪装成仍在线。

## 证据与备注

当前已记录的可行性证据如下：

    $ which script && script --version
    /usr/bin/script
    script from util-linux 2.37.2

    $ printf 'python3 -c "import sys; print(sys.stdin.isatty(), sys.stdout.isatty())"\nexit\n' | script -qfc /bin/bash /dev/null
    ...
    True True

当前已补充的实现后验证据如下：

    $ npm run build
    > opencove-extension@0.0.1 build
    > node scripts/build.mjs

    $ npm run typecheck
    > opencove-extension@0.0.1 typecheck
    > tsc --noEmit

## 接口与依赖

Webview 终端前端使用 `xterm.js` 与 fit addon。宿主后端优先使用系统自带的 `script` 命令分配 PTY。当前里程碑结束时，以下接口必须存在：

- `src/common/protocol.ts` 中的终端元数据类型，至少要能表达 shell 路径、cwd、活跃态、最近输出与退出信息。
- `src/common/protocol.ts` 中的终端消息类型，至少覆盖创建、附着、输入、停止、输出推送和退出通知。
- `src/panel/CanvasPanelManager.ts` 中的嵌入式终端会话表与对应处理函数。
- `src/webview/main.tsx` 中的节点内终端组件，能够完成附着、输出写入和用户输入回传。

本次修订：2026-03-29，补全实现结果、自动化验证和待人工确认项；当前代码与文档已完成同步，因此将本计划归档到 `completed/`，剩余验证缺口仅限本地 VSCode 交互场景。
