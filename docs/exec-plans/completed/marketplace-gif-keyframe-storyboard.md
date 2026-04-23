# Marketplace GIF 关键帧 storyboard

本 `ExecPlan` 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘`。

本文件位于 `docs/exec-plans/completed/marketplace-gif-keyframe-storyboard.md`，并按照 `docs/PLANS.md` 的要求维护过完整实现与验证记录，供后续协作者回溯这次 GIF 收口。

## 目标与全局图景

用户希望仓库 README 里的 `GIF` 像“操作说明图”而不是“缩短版视频”：关键动作前后各有一张截图，中间等待 provider 输出、窗口稳定或焦点切换的长时间空档不要进入 GIF。完成这次变更后，协作者在仓库根目录运行 `npm run generate:marketplace-media`，仍会得到 `images/marketplace/canvas-overview.mp4`、`images/marketplace/canvas-overview.png` 与 `images/marketplace/canvas-overview.gif` 三份资产；其中 `MP4` 继续保留完整真实录屏，`GIF` 则改为由真实录制过程中抓取的关键帧截图序列拼装而成。

## 进度

- [x] (2026-04-23 22:49 +0800) 阅读 `docs/WORKFLOW.md`、`docs/PLANS.md`、`docs/DESIGN.md`、`docs/workflows/BRANCH.md` 与媒体脚本，确认这次 GIF 收口需要单独 `ExecPlan`。
- [x] (2026-04-23 22:49 +0800) 从最新 `origin/main` 切出主题分支 `marketplace-gif-live-capture`。
- [x] (2026-04-23 23:56 +0800) 收到用户反馈，确认上一版“录制期短 clip storyboard”仍不满足目标；用户要的是关键操作前后截图，不是更短的视频。
- [x] (2026-04-24 00:02 +0800) 更新设计文档口径，把 GIF 正式方案从 clip storyboard 收口为 screenshot storyboard。
- [x] (2026-04-24 00:08 +0800) 重构 `scripts/generate-marketplace-media.mjs`：移除 GIF clip 录制，改为在关键 checkpoint 抓取单帧截图并按显式时长拼装 GIF。
- [x] (2026-04-24 00:17 +0800) 完成 `node --check scripts/generate-marketplace-media.mjs`、`npm run build`、`npm run typecheck`、`git diff --check` 与一轮真实 `npm run generate:marketplace-media` 验证。
- [x] (2026-04-24 00:17 +0800) 回填结果、证据与复盘，并将本计划移入 `docs/exec-plans/completed/`。

## 意外与发现

- 观察：即使 GIF 已经从“完整 `MP4` 统一抽帧”前进一步改成“录制期短 clip”，用户仍会把它理解为被裁短的视频，而不是说明性素材。
  证据：用户明确反馈“我想要的 GIF 就是关键操作前后有截图，中间大量等待的时间不需要截图”。

- 观察：现有真实录制脚本已经把主流程拆成了稳定阶段：开场 Note、创建三个节点、概览与重命名、关系连线、写文件、文件节点出现、最终概览。因此无需修改 `src/` 或 smoke harness，只在 `scripts/generate-marketplace-media.mjs` 抓这些 checkpoint 即可。
  证据：`runMarketplaceRecording(...)` 本身已经串起这些阶段，并在每个阶段后等待状态稳定。

- 观察：关键帧方案生成的 `GIF` 明显更轻量。最终产物来自 17 张 storyboard frame，`ffprobe` 显示 `1180x738`、`11.320000s`、`18` 帧（最后一帧重复一次用于 concat duration 语义），最终 `GIF` 约 `576 KB`。
  证据：`.debug/marketplace-media/gif-storyboard/storyboard.json`、`images/marketplace/canvas-overview.gif`、`ffprobe` 输出。

- 观察：Codex 沙箱里直接运行媒体脚本时，`Xvfb` 仍可能因为 `/tmp/.X11-unix` 监听失败而无法启动；这不是 GIF 逻辑 bug，但会影响验证链路。
  证据：此前沙箱内运行 `npm run generate:marketplace-media` 报过 `Xvfb exited before reporting a display number (code 1)`；本轮最终验证通过批准过的 `/bin/bash -lc "npm run generate:marketplace-media >/tmp/marketplace-media.log 2>&1"` 完成。

## 决策记录

- 决策：本轮正式把 GIF 收口为“关键帧 screenshot storyboard”，不再沿用“关键阶段短 clip storyboard”。
  理由：用户要的是关键操作前后截图，中间等待时间完全不应进入 GIF；clip 方案仍然会残留等待段落。
  日期/作者：2026-04-23 / Codex

- 决策：保持完整 `MP4` 录制链路不变，只替换 GIF 生成输入。
  理由：Marketplace README 仍然需要完整 `MP4`；把变更限定在 GIF 链路，可以最大程度降低对既有素材脚本与 smoke harness 的影响。
  日期/作者：2026-04-23 / Codex

- 决策：关键帧在真实录制过程中即时抓取，落盘为 `.debug/marketplace-media/gif-storyboard/frames/*.png`，再通过 concat manifest + `ffmpeg` 拼装最终 `GIF`。
  理由：这样既能保留真实 VS Code 宿主画面的一致性，又能为每张截图单独控制停留时长，并彻底跳过等待期。
  日期/作者：2026-04-23 / Codex

- 决策：关键帧节奏由 `runMarketplaceRecording(...)` 显式控制，而不是让录制器自动按固定频率采样。
  理由：只有录制编排本身知道哪些时刻才是“对用户有解释价值的 checkpoint”；固定采样会重新把等待时间带回来。
  日期/作者：2026-04-24 / Codex

## 结果与复盘

这次交付已经把 GIF 从“短视频片段拼接”彻底收口成“关键截图 storyboard”。当前仓库里：

- `MP4` 仍是同一次真实 VS Code 会话的完整录屏；
- `PNG` 仍从完整录屏尾部稳定概览帧导出；
- `GIF` 则来自录制过程中的 17 张关键帧截图，不再包含等待 provider 输出、焦点稳定或布局收尾的连续视频段。

本轮没有修改 `src/` 产品代码，也没有改动 smoke harness 的正式接口；实现被限制在 `scripts/generate-marketplace-media.mjs` 和相关文档中。这样做的好处是：README 素材口径得以收口，但真实产品行为与测试语义没有被“为了录 GIF”污染。

当前剩余的已知限制不是 GIF 内容本身，而是验证环境：在受限沙箱里，`Xvfb` 仍可能失败，因此真实媒体生成仍需在可用的 X11 环境或已批准的无沙箱命令下执行。这个限制已经如实写入证据，不应被误写成“GIF 逻辑仍未完成”。

## 上下文与定向

本任务主要涉及以下文件：

- `scripts/generate-marketplace-media.mjs`：真实 VS Code 素材导出主入口。本轮只改 GIF 链路，不破坏完整 `MP4` 与尾帧 `PNG`。
- `docs/design-docs/marketplace-readme-media-automation.md`：正式设计文档，记录 GIF 已经从 clip storyboard 收口为 screenshot storyboard。
- `docs/design-docs/index.md`：设计文档索引，需要与设计文档 frontmatter 和计划状态保持一致。
- `tests/vscode-smoke/marketplace-media-tests.cjs`：真实宿主录制的状态镜像与控制命令。本轮复用现有流程，不新增产品侧 GIF 专用逻辑。
- `.debug/marketplace-media/gif-storyboard/`：关键帧中间产物目录，当前应包含 `frames/`、`concat-manifest.txt` 与 `storyboard.json`。

这里的“关键帧 screenshot storyboard”指：在同一次真实 VS Code 自动化录制过程中，只在明确的关键操作前后抓取静态截图，再按固定顺序和停留时长拼成 `GIF`。这里不允许把“等待 provider 输出的几秒钟视频”继续带入 GIF，即使这些视频片段已经比完整录屏短很多。

## 工作计划

第一步先统一正式口径：把 `docs/design-docs/marketplace-readme-media-automation.md` 中的 GIF 方案改写为关键帧截图方案，并同步 `docs/design-docs/index.md` 的验证状态与计划引用，避免文档还停留在 clip storyboard 或“完整 `MP4` 后处理 GIF”的旧描述。

第二步重构脚本：删除 GIF clip recorder，改为在 `runMarketplaceRecording(...)` 的关键阶段抓取“操作前”和“操作后”的截图，典型阶段包括创建 `Code Worker` / `Reviewer` / `Terminal`、概览重命名、关系连线、`Reviewer` 写文件、文件节点出现、`Code Worker` prompt，以及最终概览。抓到的截图统一落入 `.debug/marketplace-media/gif-storyboard/frames/`，并生成带显式 frame duration 的 manifest。

第三步做真实验证：在确保 `node --check`、`npm run build`、`npm run typecheck` 和 `git diff --check` 全部通过后，再跑一轮真实 `npm run generate:marketplace-media`，确认最终 `GIF` 已经只展示关键截图切换，且 `MP4` / `PNG` 仍沿用原有逻辑。

## 具体步骤

在仓库根目录执行以下动作：

    1. 更新 `docs/design-docs/marketplace-readme-media-automation.md` 与 `docs/design-docs/index.md`，把正式 GIF 方案改成关键帧 storyboard，并在验证完成后把状态同步为 `已验证`。
    2. 修改 `scripts/generate-marketplace-media.mjs`，移除 GIF clip 录制，新增关键帧截图抓取、frame manifest 与 GIF 拼装逻辑。
    3. 运行 `node --check scripts/generate-marketplace-media.mjs`。
    4. 运行 `npm run build`。
    5. 运行 `npm run typecheck`。
    6. 运行 `git diff --check`。
    7. 运行 `/bin/bash -lc "npm run generate:marketplace-media >/tmp/marketplace-media.log 2>&1"`，并检查日志尾部是否出现 `Composing GIF from 17 storyboard frames.` 与三份最终产物生成记录。
    8. 检查 `.debug/marketplace-media/gif-storyboard/` 下是否生成 `frames/`、`concat-manifest.txt` 与 `storyboard.json`，再目检最终 `GIF`。

## 验证与验收

本轮验收已经完成，并满足以下可观察标准：

- `scripts/generate-marketplace-media.mjs` 中不再保留 GIF clip 录制作为正式路径；正式路径已改为 `createGifStoryboardRecorder(...)` + `captureGifScene(...)` + `composeGifFromStoryboard(...)`。
- `.debug/marketplace-media/gif-storyboard/` 的中间产物已变成 `frames/*.png`、`concat-manifest.txt` 与 `storyboard.json`。
- 运行媒体脚本后，`images/marketplace/` 仍可产出 `canvas-overview.mp4`、`canvas-overview.png` 和 `canvas-overview.gif`。
- `storyboard.json` 记录了 17 张关键帧，覆盖开场、三个节点创建、重命名与连线、写文件、文件节点、最终概览等阶段。
- `ffprobe` 验证最终 `GIF` 为 `1180x738`、`11.320000s`、`18` 帧；人工口径上它已是关键截图切换，不再包含长等待视频段。

## 幂等性与恢复

- `npm run generate:marketplace-media` 仍可重复执行：每次运行前会清理旧的 storyboard 目录，再覆盖最终 `MP4`、`PNG` 与 `GIF` 资产。
- 如果 GIF 拼装失败，但完整录屏已完成，应优先保留 `.debug/marketplace-media/gif-storyboard/` 下的截图帧、manifest 与 metadata，作为排障证据。
- 如果真实 provider / X11 / VS Code 宿主本身失败，恢复方式仍然是修复环境后整条脚本重跑，不需要手工回滚仓库文件。

## 证据与备注

关键证据如下：

    node --check scripts/generate-marketplace-media.mjs
    npm run build
    npm run typecheck
    git diff --check
    /bin/bash -lc "npm run generate:marketplace-media >/tmp/marketplace-media.log 2>&1"
    Composing GIF from 17 storyboard frames.
    Generated images/marketplace/canvas-overview.png
    Generated images/marketplace/canvas-overview.gif
    Generated images/marketplace/canvas-overview.mp4
    ffprobe => width=1180 height=738 nb_frames=18 duration=11.320000
    du -h => images/marketplace/canvas-overview.gif = 576K

## 接口与依赖

这轮保持不变的外部入口是：

    npm run generate:marketplace-media

这轮实现继续依赖以下工具：

- `ffmpeg`：用于完整窗口 `MP4` 录制、单帧截图抓取与最终 GIF 拼装。
- `Xvfb` / `xwininfo`：用于真实 VS Code 窗口的无头显示与窗口定位。
- `@vscode/test-electron` 与 `tests/vscode-smoke/marketplace-media-tests.cjs`：用于拉起真实宿主和驱动录制脚本。

本轮新增并已经稳定下来的脚本接口约束是：

- GIF 的正式中间产物为 `.debug/marketplace-media/gif-storyboard/frames/*.png`。
- `storyboard.json` 与 `concat-manifest.txt` 共同表达每张关键帧的顺序与展示时长。
- 完整 `MP4` 和尾帧 `PNG` 的链路不因 GIF 改成关键帧 storyboard 而改变。

最后更新说明：2026-04-24 00:17 +0800，本轮已完成代码、文档与真实媒体生成验证，并将本计划从 `active/` 移入 `completed/`。
