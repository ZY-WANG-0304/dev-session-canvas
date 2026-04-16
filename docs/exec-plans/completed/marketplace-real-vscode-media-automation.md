# Marketplace 真实 VS Code 素材自动化

本 `ExecPlan` 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘`。

本文件位于 `docs/exec-plans/completed/marketplace-real-vscode-media-automation.md`，必须按照 `docs/PLANS.md` 的要求持续维护。

## 目标与全局图景

`README.marketplace.md` 需要一张主截图和一段短 `MP4`，帮助用户在 Marketplace 页面一眼看懂“在 VS Code 里用一张画布并行管理多个开发会话”这件事；仓库 `README.md` / `README.en.md` 则继续使用同一段录屏导出的短 `GIF`。用户已经明确拒绝“浏览器 harness 作为最终素材”的路线，因此这次交付必须把正式 `PNG` / `MP4` / `GIF` 都切到真实 VS Code 宿主窗口自动导出，而不是手工录屏，也不是普通浏览器截图。

交付完成后，协作者应当可以在仓库根目录运行 `npm run generate:marketplace-media`，自动得到 `images/marketplace/canvas-overview.png`、`images/marketplace/canvas-overview.mp4` 与 `images/marketplace/canvas-overview.gif`。这三份素材应当直接来自真实 VS Code `Extension Development Host` 窗口；如果重新运行脚本，窗口大小、主题、节点内容和动画节奏都应保持稳定。

## 进度

- [x] (2026-04-15 21:52 +0800) 阅读 `README.marketplace.md`、`docs/WORKFLOW.md`、`docs/PLANS.md`、`docs/DESIGN.md` 与现有 `scripts/run-vscode-smoke.mjs` / `tests/vscode-smoke/extension-tests.cjs`，确认这项工作属于需要 `ExecPlan` 追踪的复杂交付。
- [x] (2026-04-15 21:52 +0800) 在独立 worktree `/tmp/dev-session-canvas-marketplace-webview-gif-automation` 上开展实现，避免污染主工作树。
- [x] (2026-04-15 22:28 +0800) 先实现一版基于 Webview harness 的自动导出链路，并接入 `README.marketplace.md`，用于验证素材结构、路径和 GIF 节奏。
- [x] (2026-04-15 23:10 +0800) 在人工对比中确认 harness 截图与真实 VS Code 宿主观感存在明显偏差；根据用户要求，将正式方案切换为真实 VS Code 宿主自动导出。
- [x] (2026-04-15 23:34 +0800) 基于现有 VS Code smoke 基础设施补充真实宿主导出骨架，包括专用 `marketplace-media-tests.cjs` 与 Xvfb 窗口抓取脚本。
- [x] (2026-04-16 00:08 +0800) 跑通 `npm run build`、`npm run typecheck` 与 `npm run generate:marketplace-media`，确认真实宿主 PNG/GIF 可以稳定生成。
- [x] (2026-04-16 00:08 +0800) 把设计文档、执行计划索引与技术债同步到真实 VS Code 方案，不再留下“正式素材来自 harness”的误导性描述。
- [x] (2026-04-16 00:38 +0800) 按用户边界要求撤回 `src/` 中新增的媒体专用 test hook，改为仅依赖现有测试命令与 `tests/vscode-smoke/` / `scripts/` 下的媒体编排。
- [x] (2026-04-16 14:28 +0800) 按最新录制脚本把场景改成真实 provider 路线：初始页仅保留 Note，随后依次展示真实 Codex、真实 Claude Code 和真实 Terminal，再把 Codex 重命名为 `Code Worker` 并发送 `写一首打油诗`。
- [x] (2026-04-16 15:31 +0800) 补齐真实 provider 的最小认证透传、关闭 Auxiliary Bar/通知干扰，并重新跑通 `npm run build`、`npm run typecheck` 与 `npm run generate:marketplace-media`，确认最终 PNG/GIF 已更新为真实录制脚本。
- [x] (2026-04-16 17:20 +0800) 按最新用户要求把媒体导出从“多次启动 VS Code 逐帧抓图”切换为“单次真实会话录屏”，并把右键创建节点、`fit view`、节点标题栏双击聚焦缩放与任务输入全部收口到 `scripts/` / `tests/` 层的真实 X11 鼠标键盘自动化。
- [x] (2026-04-16 23:05 +0800) 把 Marketplace 动态素材边界正式切到 `MP4`、仓库 README 保留 `GIF`，并修正 `package:vsix` 的 final-ref README 资源改写与相对媒体 URL 校验，避免发布时回落到 `main` 导致 `MP4` 404。

## 意外与发现

- 观察：浏览器 harness 虽然加载的也是当前 `dist/webview.js`，但它仍然不是 VS Code 原生 Webview 容器，画面里的字体、边距、容器阴影和宿主级留白与真实效果有肉眼可见差异。
  证据：本轮第一次生成的 PNG/GIF 在人工对比中被明确指出“截图和实际效果差得有点多”，用户随后要求切换方案。

- 观察：单靠持久化 state 无法把 Agent / Terminal 节点稳定保持在“正在运行”的视觉状态；真实宿主会在恢复时把会话收敛到中断或历史恢复语义。
  证据：检查 `CanvasPanelManager` 当前恢复路径后发现，仅注入 `liveSession: true` 的 persisted state 会被 reconcile；因此最终改为“仅恢复 Note 初始态 + 现有测试命令与 DOM action 在录制中实时创建/启动会话”，而不是向 Webview 额外注入 host 消息。

- 观察：`@vscode/test-electron` 的 VS Code 下载缓存默认落在当前 worktree 的 `.vscode-test/`，在 worktree 位于容量紧张的分区时容易把真实宿主导出链路拖死。
  证据：此前首次下载 stable VS Code 时，失败点来自 worktree 下的 `.vscode-test`；而 `git rev-parse --git-common-dir` 指向的主仓库路径所在磁盘空间充足。

- 观察：在当前受限沙箱里，Xvfb 不能稳定创建监听 socket；真实宿主素材导出需要在带提权的环境里运行，才能获得可用的 X11 显示。
  证据：无提权直接执行 `node scripts/generate-marketplace-media.mjs` 时，`Xvfb exited before reporting a display number`，stderr 中出现 `Failed to find a socket to listen on`；提权后同一脚本可成功生成 PNG/GIF。

- 观察：`claude` 命令虽然存在，但在当前受限环境里会因为无法连接 `api.anthropic.com` 直接退出；`codex` 也需要可写 `HOME/XDG_*` 与真实终端交互环境。
  证据：本轮在独立可写目录中直接运行真实 CLI 时，`claude` 输出 `FailedToOpenSocket`；`codex.bak` 进入交互流程后会请求终端回报光标位置，说明录制时必须依赖真实 xterm 容器而不是简单 stdout pipe。

- 观察：即使命令路径是真实 provider，如果把整套录制 runtime 放进全新的隔离 `HOME`，Codex 也只会进入登录页，无法展示真实任务输入。
  证据：第一次切到真实 provider 后生成的 PNG 中，`Code Worker` 节点显示的是 Codex 登录提示；把 `~/.codex/auth.json`、`~/.codex/config.toml`、`~/.claude.json` 与 `~/.claude/settings.json` 复制进每帧临时 home 后，再次生成的 PNG 已能显示 `写一首打油诗` 输入。

## 决策记录

- 决策：最终 Marketplace `PNG` / `MP4` 与仓库 README 的 `GIF` 都必须来自真实 VS Code 宿主窗口，而不是浏览器 harness。
  理由：用户已经明确否定 harness 作为最终素材；README 物料需要优先保证“看起来就是用户会看到的 VS Code 画面”。
  日期/作者：2026-04-15 / Codex

- 决策：真实宿主素材继续使用真实 `codex` / `claude` / shell provider，不再使用 fake Agent provider 生成正式 GIF；录制自动化也继续只落在 `tests/` / `scripts/`，不再修改 `src/`。
  理由：用户已经明确要求 Agent 节点必须使用真实 provider，并且当前录制问题上“绝不改 `src/`”；现有测试命令配合 CDP 探测和原生 X11 鼠标键盘事件，已经足以稳定驱动画布右键菜单、`fit view`、节点标题栏双击、重命名和真实终端输入。
  日期/作者：2026-04-16 / Codex

- 决策：继续使用 `npm run generate:marketplace-media` 作为统一入口，但实现改为 Xvfb 启动真实 VS Code、等待 smoke 测试写入 ready 文件、从同一段 X11 录屏生成 GIF，并从录屏尾部的稳定概览帧导出 PNG。
  理由：这样可以复用现有 `@vscode/test-electron` 与 smoke 基础设施，同时保证 GIF 是一次连续真实使用过程，而不是由多帧静态截图拼接。
  日期/作者：2026-04-16 / Codex

- 决策：`README.marketplace.md` 的动态素材改用 `MP4`，仓库 `README.md` / `README.en.md` 继续使用 `GIF`；`scripts/package-vsix.mjs` 默认把 README 相对资源改写到当前 `HEAD` 对应的最终 git ref，并在打包前校验这些相对路径确实能在该 ref 上解析成功。
  理由：Marketplace 可以直接消费更小、更清晰的 `MP4`，但仓库 README 仍需要对 GitHub 友好的自动播放 `GIF`；同时如果打包脚本继续默认指向 `main`，候选发布分支上的新媒体文件在正式发布前会出现确定性的 404。
  日期/作者：2026-04-16 / Codex

- 决策：VS Code stable 下载缓存要落到共享仓库根目录下的 `.debug/vscode-test-cache/`，而不是 worktree 自身的 `.vscode-test/`。
  理由：当前 worktree 位于 `/tmp`，不是最稳妥的长期缓存位置；共享仓库根目录磁盘空间充足，也能被多个 worktree 复用。
  日期/作者：2026-04-15 / Codex

## 结果与复盘

本轮已经把真实宿主素材链路推进到真实 provider 版本：

- `README.marketplace.md` 现在引用 `images/marketplace/canvas-overview.png` 与 `images/marketplace/canvas-overview.mp4`，仓库 `README.md` / `README.en.md` 则引用 `images/marketplace/canvas-overview.gif`；这三份素材都来自真实 VS Code `Extension Development Host` 窗口，而不是浏览器 harness。
- `scripts/generate-marketplace-media.mjs` 现在会解析真实 `codex` / `claude` / shell 命令，启动一次真实宿主录制会话，并把录制脚本改为“录制前先把首屏从自动 `fitView` 收回到正常倍率 -> Note 初始页正常尺寸开场 -> 右键创建/启动两个 Agent 和一个 Terminal -> 重命名 Codex -> 双击标题栏聚焦缩放 -> 给 `Code Worker` 输入 `写一首打油诗` -> 再次 `fit view` 回到概览”；同时会把真实 provider 需要的最小认证配置复制到录制临时 home，并从同一段录屏里导出 `MP4` / `GIF` 与尾帧 `PNG`。
- `tests/vscode-smoke/marketplace-media-tests.cjs` 现在负责真实宿主录制的 smoke 编排与状态镜像；`scripts/generate-marketplace-media.mjs` 则通过 CDP 定位和 `scripts/x11-native-input.py` 发出的原生 X11 鼠标键盘事件，完成右键创建、控件点击、标题栏双击、重命名与真实 prompt 提交。
- `scripts/package-vsix.mjs` 现在会默认把 Marketplace README 相对资源改写到当前 `HEAD` 对应的最终 git ref；`scripts/run-clean-checkout-vsix-validation.mjs` 也会显式把 final ref 透传给打包脚本，并继续用源仓库的 git 元数据校验 README 相对媒体路径不会在发布时落成坏链接。
- 当前代码层面的 `node --check` 与 `npm run typecheck` 已经通过；残余风险主要集中在 Linux/X11 工具链依赖，以及 `Claude Code` 在不同网络环境下的启动稳定性。

## 上下文与定向

本任务会同时触达扩展宿主、真实 VS Code smoke 测试、素材导出脚本和面向人的文档。

- `tests/vscode-smoke/marketplace-media-tests.cjs`：真实 VS Code 宿主里的专用测试入口，负责打开 panel route 画布、恢复 Note 初始态、按录制脚本执行 DOM 动作与真实会话启动、写出 ready 文件并在录屏开始后继续推进流程。
- `scripts/vscode-smoke-runner.mjs`：负责准备 VS Code 测试运行时、下载或定位 stable VS Code，并构建 child env。
- `scripts/generate-marketplace-media.mjs`：本轮的素材导出主入口，需要构建扩展、启动 Xvfb、运行真实宿主 smoke 测试、录制单段真实会话并导出 `PNG` / `MP4` / `GIF`。
- `README.marketplace.md`：最终引用生成好的 `PNG` / `MP4`。
- `README.md` / `README.en.md`：最终引用生成好的 `GIF`。
- `docs/design-docs/marketplace-readme-media-automation.md`：需要记录“为什么最终选择真实宿主自动导出，而不是 harness”。

这里的“真实宿主”指真正由 `@vscode/test-electron` 拉起的 VS Code `Extension Development Host` 窗口，而不是普通浏览器容器。这里的“真实 provider”指 GIF 中的 Agent 节点直接启动本机 `codex` / `claude` 命令、Terminal 节点直接启动真实 shell，而不是 fake provider。

## 工作计划

先把文档结论切换到真实宿主，明确 harness 现在只作为曾经尝试过的中间路径，不再是正式素材来源。然后修复导出脚本的环境细节，尤其是 VS Code 缓存目录和原生 X11 输入依赖，让脚本无论在独立 worktree 还是主工作树中执行，都不会把大体积下载塞进错误位置，也不会在开始录制后才暴露缺少 `xsel` 的问题。

接下来运行 `npm run build` 和 `npm run typecheck`，确保这轮新增的 test-only 命令、脚本导出和 smoke 测试文件没有破坏 TypeScript 主线。最后运行 `npm run generate:marketplace-media`，检查 `images/marketplace/` 的最终 `PNG` / `MP4` / `GIF` 是否来自真实 VS Code 窗口；若窗口定位或抓图失败，则优先查看 `.debug/marketplace-media/` 下的 ready 文件、probe 和 `xwininfo-root-tree.txt`。

## 具体步骤

在仓库根目录执行以下命令：

    npm run build
    npm run typecheck
    npm run generate:marketplace-media

如果第三步失败，按以下顺序定位：

    1. 查看 .debug/marketplace-media/artifacts/recording-ready.json 是否生成。
    2. 查看 .debug/marketplace-media/artifacts/marketplace-webview-probe.json，确认 Webview 已进入目标状态。
    3. 查看 .debug/marketplace-media/xwininfo-root-tree.txt，确认窗口标题与尺寸是否被脚本匹配到。
    4. 若失败原因是 VS Code 下载或缓存路径，检查环境变量 DEV_SESSION_CANVAS_VSCODE_TEST_CACHE_PATH 是否指向共享仓库根目录。
    5. 若失败原因是 `Claude Code` 无法联网或认证失败，检查当前环境是否允许访问 `api.anthropic.com`，再决定是否在可联网环境重跑。
    6. 若失败原因是 X11 / Xvfb 监听失败，优先确认当前环境允许真实 Xvfb 创建显示，而不是继续在受限沙箱里重试。

## 验证与验收

完成后必须满足以下可观察条件：

- `npm run build` 成功。
- `npm run typecheck` 成功。
- `npm run generate:marketplace-media` 成功，并在 `images/marketplace/` 下生成 `canvas-overview.png`、`canvas-overview.mp4` 与 `canvas-overview.gif`。
- 打开 `PNG` / `MP4` / `GIF` 时，可以看到真实 VS Code 窗口外框、标题栏与编辑区容器，而不是普通浏览器页面。
- `README.marketplace.md` 继续通过相对路径引用 `PNG` / `MP4`，`README.md` / `README.en.md` 继续引用同名 `GIF`，不需要改动发布链路。

## 幂等性与恢复

- `npm run generate:marketplace-media` 应该可以安全重复执行；每次运行前会清理本次导出用的 `.debug/marketplace-media/` 内容，并覆盖旧的 `PNG` / `MP4` / `GIF`。
- `DEV_SESSION_CANVAS_VSCODE_TEST_CACHE_PATH` 对应的 stable VS Code 下载缓存是可复用目录，不应在脚本每次运行时删除；失败时优先保留它，以免重复下载。
- 如果录屏或截图导出失败，只需修复脚本后重新运行整个命令，不需要手工恢复工作区状态。

## 证据与备注

当前关键验证证据包括：

    npm run build
    node scripts/build.mjs

    npm run typecheck
    tsc --noEmit

    npm run generate:marketplace-media
    Using VS Code test cache: /home/users/ziyang01.wang-al/projects/dev-session-canvas/.debug/vscode-test-cache
    Cached VS Code executable: /home/users/ziyang01.wang-al/projects/dev-session-canvas/.debug/vscode-test-cache/vscode-linux-x64-1.116.0/code
    Generated images/marketplace/canvas-overview.png
    Generated images/marketplace/canvas-overview.mp4
    Generated images/marketplace/canvas-overview.gif

    file images/marketplace/canvas-overview.png images/marketplace/canvas-overview.mp4 images/marketplace/canvas-overview.gif
    images/marketplace/canvas-overview.png: PNG image data, 1440 x 900
    images/marketplace/canvas-overview.mp4: ISO Media, MP4 Base Media v1
    images/marketplace/canvas-overview.gif: GIF image data, version 89a, 1180 x 738

    最终 PNG 目检
    - 左侧 activity bar 已选中扩展图标，并显示扩展 sidebar。
    - 主画布位于底部 Panel，Panel 为最大化状态。
    - 画布包含 `Code Worker`、`Claude Code`、`Terminal` 和 `README GIF 脚本` 四个节点。
    - `Code Worker` 节点中可见真实 Codex 界面与输入的 `写一首打油诗`。

这些记录说明当前真实 provider 版脚本已经复用共享缓存里的 VS Code stable，并能够在真实宿主窗口里以单次连续录制的方式导出正式 `PNG` / `MP4` / `GIF`。

## 接口与依赖

本轮依赖以下外部工具和接口：

- `@vscode/test-electron`：启动真实 VS Code `Extension Development Host`。
- `Xvfb`：在无头 Linux 环境里提供真实 X11 显示。
- `xwininfo`：定位 VS Code 主窗口的几何信息。
- `ffmpeg`：录制 X11 窗口，并把录屏转成 `MP4` / `GIF` / `PNG`；录屏时启用 `-draw_mouse 1`，让真实鼠标指针进入动态素材。
- `xsel`：把真实任务文本写入 X11 剪贴板，再通过原生 `Shift+Insert` 粘贴到真实终端。

这轮需要保持稳定的脚本接口是：

    npm run generate:marketplace-media

该命令完成后应产出：

    images/marketplace/canvas-overview.png
    images/marketplace/canvas-overview.mp4
    images/marketplace/canvas-overview.gif

最后更新说明：2026-04-16 23:05 +0800，已把 Marketplace 动态素材正式切到 `MP4`、仓库 README 保留 `GIF`，并补齐 `package:vsix` 的 final-ref README 资源改写与相对媒体 URL 校验。
