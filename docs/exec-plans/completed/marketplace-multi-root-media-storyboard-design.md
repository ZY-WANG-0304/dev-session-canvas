# 收口 Marketplace 四 Root 双形态媒体剧本

本 `ExecPlan` 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘`。本计划遵循仓库根目录的 `docs/PLANS.md`，只负责完成宣传片剧本与媒体约定的设计收口；合成器实现、正式录制和资产替换不属于本计划。

## 目标与全局图景

完成后，后续录制者不再沿用“创建节点、重命名、连线、文件活动、保存模板”的旧功能巡礼，而是围绕一个真实的四 root 工作现场录制约 60 秒宣传片。影片先展示 `rootGroups` 的空间化全局，再把同一状态下分别录制的 `rootGroups` 与 `paneGallery` 两条完整宽屏素材放到同一个后期合成画面中比较，最后在 `paneGallery` 中定位 attention、回复决策并看到测试收口。

本次还要正式取消“PNG 必须复制 GIF 最后一张原始帧”的约束。GIF 改由经审阅的双宽屏合成 storyboard frame 组成；PNG 从其中显式选择一张适合静态传播的 Hero 合成帧。读者可以通过 `docs/marketplace-media-scenario.md` 直接看到完整时间线、字幕、录制状态和静态素材选择规则。

## 进度

- [x] (2026-07-14 21:35+08:00) 清理原工作树，把所有已有未提交内容保存到 stash，并从最新 `origin/main` 创建 `marketplace-media-multi-root-storyboard`。
- [x] (2026-07-14 21:40+08:00) 核对旧剧本、正式媒体设计、录制 Skill、当前 `recording-session.mjs` 导出行为，以及 multi-root 产品规格和设计边界。
- [x] (2026-07-14 21:50+08:00) 重写 `docs/marketplace-media-scenario.md`，收口四 root 状态、两条独立录制源、60 秒主片、双宽屏合成、字幕可读性、GIF storyboard 和 PNG Hero。
- [x] (2026-07-14 21:55+08:00) 同步 `docs/design-docs/marketplace-readme-media-automation.md` 与 `docs/design-docs/index.md`，把新规则写入正式方案，并把验证状态改为与事实一致的“验证中”。
- [x] (2026-07-14 21:58+08:00) 同步 `docs/skills/recording-marketplace-media/SKILL.md`，明确当前 CLI 尚未支持双宽屏合成和独立 Hero PNG，禁止把旧 `stop` 行为误当成新方案已落地。
- [x] (2026-07-14 22:05+08:00) 运行 Markdown/路径检查、`git diff --check` 和独立只读审阅；修正 attention 清除时机、字幕带、Terminal 状态、toast 配置、英文断行和 GIF 阅读时长后，准备把本计划移入 `docs/exec-plans/completed/`。

## 意外与发现

- 观察：当前 `origin/main` 已采用 monorepo 路径，正式媒体位于 `extensions/vscode/dev-session-canvas/images/marketplace/`，不能沿用旧 worktree 中的根目录媒体路径。
  证据：`scripts/media/recording-session.mjs` 的 `outputDir` 指向主扩展子包；三个 README 也引用该子包下的素材。
- 观察：当前 `scripts/media/recording-session.mjs` 在 `cmdStop()` 中仍把按文件名排序后的最后一张 GIF storyboard PNG 直接复制为 `canvas-overview.png`。
  证据：`cmdStop()` 中的注释为 `Copy last GIF frame as PNG`，随后调用 `fs.copyFile(lastFrame, ...)`。
- 观察：产品同一时刻只能渲染一种顶层 multi-root 呈现模式；`rootGroups` 与 `paneGallery` 左右同屏必须明确是两条真实录制素材的后期比较，不能伪装成产品原生双视图。
  证据：multi-root 正式设计将 `devSessionCanvas.canvas.multiRootPresentationMode` 定义为二选一配置，并说明两种模式共享 composed state。
- 观察：`paneGallery` 的真实宿主 Terminal input、复杂跨 pane 拖拽和大量 root 虚拟化仍未完成全部端到端验证。
  证据：`docs/design-docs/canvas-multi-root-workspace-support.md` 的当前验证状态仍为“验证中”。本剧本因此只展示既有 Terminal 输出收口，不在缩略图或多 pane 中录入 Terminal 命令，也不展示跨 pane 拖拽。
- 观察：attention 不是在用户提交回复后清除，而是在第一次左键点击对应 Agent/Terminal 节点时由 `webview/selectNode` 认领并立即清除。
  证据：`CanvasPanelManager.ts` 的 `webview/selectNode` 分支调用 `acknowledgeExecutionAttentionForNode()`；因此剧本必须把“缩略图双击聚焦 root”和“点击 Agent 清除 attention”拆成两个动作。
- 观察：默认 `attentionSignalBridge = system` 在 main-only Extension Host 缺少 companion 时可能回退为 workbench notification，与“画面无 toast”冲突。
  证据：主扩展 manifest 默认值为 `system`。录制 profile 因此固定使用 `attentionSignalBridge = none`，同时保留 `strongTerminalAttentionReminder = both` 的产品内提示。
- 观察：产品 Terminal 状态不存在 `active`；正在运行的 Terminal 应记录为 `live`，再用自然语言说明测试命令正在执行。
  证据：`TerminalNodeStatus` 的运行态枚举包含 `live`，不包含 `active`。

## 决策记录

- 决策：主故事固定使用四个 workspace root：`payments-api`、`storefront`、`design-system` 和 `release-tools`。
  理由：用户明确要求从两个 root 扩展到四个 root，并希望同时看到 Agent running、attention 和正在执行测试的 `live` Terminal 组成的真实工作现场。
  日期/作者：2026-07-14 / 用户与 Codex
- 决策：不展示文件读取、文件写入、文件节点、diff 或跳转编辑器。
  理由：这些能力在此前画面中没有达到足够好的传播效果，也会把叙事拉回功能巡礼。
  日期/作者：2026-07-14 / 用户
- 决策：`rootGroups` 与 `paneGallery` 各录一条 1440x900 完整宽屏源素材，再在静态背景上缩小并左右合成。
  理由：单个 Webview 不会同时渲染两种顶层形态；分开录制既保持产品真实性，也能清楚比较两种工作视角。
  日期/作者：2026-07-14 / 用户与 Codex
- 决策：attention 段的中文字幕固定为“发现需要关注的会话，立即聚焦。”。
  理由：这是用户从候选文案中明确选定的表达，动作和价值都足够直接。
  日期/作者：2026-07-14 / 用户
- 决策：GIF 可以使用双宽屏合成帧；PNG 选择经审阅的 Hero 合成帧，不再复制 GIF 最后一张原始帧。
  理由：GIF 与 PNG 的传播任务不同。GIF 负责展示状态演进，PNG 负责在静态入口中用最强的一帧解释产品，不应被帧顺序机械绑定。
  日期/作者：2026-07-14 / 用户与 Codex
- 决策：本计划只收口设计，不修改 `scripts/media/recording-session.mjs`，也不替换正式媒体资产。
  理由：当前用户确认的是剧本和媒体约定；实现必须另行建立 ExecPlan、补 compositor 验证并完成真实录制后，才能把设计状态重新改为“已验证”。
  日期/作者：2026-07-14 / Codex
- 决策：单宽屏镜头也保留 UI 框外字幕带，不把源录制铺满最终画幅；GIF 只在两个关键 frame 中放完整句子，并分别停留 2.2 秒和 2.4 秒。
  理由：这让“字幕不得覆盖 UI”在开场和 attention 等单宽屏段同样可执行，也避免在 10 秒 GIF 中让四句字幕互相争抢阅读时间。
  日期/作者：2026-07-14 / Codex
- 决策：attention 路径固定为“双击缩略图聚焦 root -> 点击 Agent 认领并清除 attention -> 输入并提交决策后恢复 running”。
  理由：该顺序与产品当前 `webview/selectNode` 语义一致，能够在镜头中分别证明发现、认领和继续执行。
  日期/作者：2026-07-14 / Codex
- 决策：`docs/skills/recording-marketplace-media/SKILL.md` 只负责原始视频与 checkpoint 录制，不承载本剧本新增的剪辑、合成、字幕、GIF 或 PNG Hero 规则。
  理由：录制方法是可跨剧本复用的工具能力，成片编排是当前素材的编辑设计；把两者写进同一 Skill 会扩大职责并造成与剧本、设计文档的重复漂移。
  日期/作者：2026-07-14 / 用户与 Codex

## 结果与复盘

本计划已经完成设计收口。`docs/marketplace-media-scenario.md` 现在是一条 60 秒四 root 因果故事；`docs/design-docs/marketplace-readme-media-automation.md` 与索引正式选定两条真实宽屏源、双宽屏 compositor、八帧 GIF 和独立 Hero PNG，并把验证状态调整为“验证中”；录制 Skill 只保留真实宿主原始视频/checkpoint 捕获方法、既有坐标/状态等录制关键技巧与当前 `stop` 的工具耦合警告，不再承载剪辑规则。

独立只读审阅发现并推动修复了三个会直接阻碍录制的问题：attention 必须在点击 Agent 时清除；单宽屏镜头也必须保留 UI 框外字幕带；默认 system attention bridge 会产生不需要的 toast。审阅还统一了 Terminal `live` 状态、英文固定断行、GIF 两句字幕的 2.2/2.4 秒停留与本计划里程碑。

验证结果为：`git diff --check` 成功；定向一致性脚本确认四个 root 和四句主片文案齐全、GIF 为 8 帧且总时长 10.0 秒、变更全部位于 `docs/`。本计划没有修改 `scripts/`、主扩展源码、README 引用或现有媒体资产。

双宽屏 compositor、两条真实 take、中文资产和人工媒体验收是下一项实现工作的明确范围，而不是本设计任务遗留的实现缺陷；开始该工作时必须另建实现 ExecPlan。当前没有需要登记到技术债追踪器的新增技术债。

## 上下文与定向

`docs/marketplace-media-scenario.md` 是当前素材剧本，包含时间线、画面、字幕、checkpoint 和剪辑规则。`docs/design-docs/marketplace-readme-media-automation.md` 是正式设计结论，负责记录为什么采用真实 Extension Development Host、为什么两种模式分开录制、最终资产如何生成，以及哪些约束尚未实现。`docs/skills/recording-marketplace-media/SKILL.md` 只描述如何得到真实原始视频与 checkpoint；它不解释如何剪成当前宣传片。

产品中的 `rootGroups` 是空间化组合画布：每个 workspace folder 以系统 root 分组留在同一张无限画布上。`paneGallery` 是窗格画廊：`dynamic`/`grid` 提供多个可交互 root 子画板，`topThumbnails`/`sideThumbnails` 提供一个主画板和不可交互缩略图。两者共享同一份 composed state，只改变 Webview 呈现。宣传片里的左右双宽屏是后期合成，不是新增产品行为。

当前导出器位于 `scripts/media/recording-session.mjs`。它可以录制 MP4 clip、捕获 GIF storyboard frame 并在 `stop` 时生成三种资产，但尚无双宽屏 compositor、语言版本或显式 Hero frame 选择。特别是 `cmdStop()` 仍复制最后一张原始 GIF frame 作为 PNG。此次只把新规则写清，不应修改该实现或声称已经验证。

## 里程碑

### 里程碑一：确认产品事实与旧导出边界

完成标准是能够从仓库内指出两种 multi-root 模式的二选一配置、`eye`/`globe` 的局部切换语义、attention 的点击认领时机、Terminal 的 `live` 状态，以及当前 `cmdStop()` 复制最后一帧 PNG 的代码位置。通过 `rg` 与只读源码检查验证，不修改任何产品文件。

### 里程碑二：形成可直接执行的正式剧本

完成标准是 `docs/marketplace-media-scenario.md` 包含四 root 状态表、两条独立宽屏源、60 秒主片、字幕安全区与停留时间、八个 GIF Frame ID、显式 PNG Hero 和明确不拍清单。人工从头阅读时，不需要依赖本次对话就能知道画面、操作、字幕和真实状态如何对应。

### 里程碑三：同步正式结论并完成一致性验收

完成标准是设计文档、索引和剧本对成片规则一致，录制 Skill 则保持原始录制职责并如实披露当前 `stop` 副作用；所有未实现剪辑能力均标记为待实现/验证。`git diff --check` 和定向 `rg` 检查成功，git diff 只包含五份 Markdown 文档。

## 工作计划

先完全重写录制剧本。开场、任务提交、attention 出现、双形态比较、attention 聚焦、决策回复、测试收口和四 pane 结束必须形成一条连续因果链。四个 root 的名称、节点类型和状态转换保持固定，使两条源录制可以在同一 checkpoint 对齐。字幕单独定义安全区、字号、行数和停留时长，避免再次把文案只当成脚本旁注。

再修订正式媒体设计。保留真实 Extension Development Host 和原生输入等仍然成立的架构边界，删除把文件活动、关系连线和模板保存当作当前宣传片必拍内容的口径。新增双源录制、静态背景合成、语言版本、GIF composite storyboard 和显式 PNG Hero 规则。旧流程的历史验证证据可以保留，但必须注明它不构成新合成流程已验证的证据。

最后同步设计索引和录制 Skill。Skill 只说明真实宿主录制命令、原生输入、原始 clip/checkpoint 路径，以及当前 `stop` 会额外触发旧导出的限制；双宽屏、字幕、GIF、Hero PNG 和语言版本继续留在剧本与正式设计。完成后执行轻量文档校验，不运行与本次纯文档变更无关的全量产品测试。

## 具体步骤

在仓库根目录完成以下操作：

1. 使用 `apply_patch` 重写 `docs/marketplace-media-scenario.md`。
2. 使用 `apply_patch` 修订 `docs/design-docs/marketplace-readme-media-automation.md`、`docs/design-docs/index.md` 和 `docs/skills/recording-marketplace-media/SKILL.md`。
3. 用 `rg` 核对旧的“PNG/GIF 最后一帧”、文件活动必拍和旧场景标题是否已从当前正式口径移除。
4. 运行 `git diff --check`，并查看限定在本计划涉及文件内的 diff。
5. 更新本计划的进度、结果与复盘，然后移动到 `docs/exec-plans/completed/`。

预期最终 `git status --short` 只包含五份正式/执行文档，不包含 `scripts/`、`extensions/` 源码或 `images/` 资产修改。

## 验证与验收

设计验收以人可读、可追溯为准：

- 剧本只有一条约 60 秒的四 root 工作故事，没有文件读取、文件写入、文件节点、diff、编辑器跳转、模板保存或节点创建教学。
- 两种 multi-root 顶层模式明确分开录制，左右同屏明确标注为后期合成；四个 root 的名称和 execution 状态在两侧一致。
- 中文字幕均为可完整阅读的句子；“发现需要关注的会话，立即聚焦。”原样出现，并有明确字号、安全区和最短停留时长。
- GIF 的每一帧来自经审阅的双宽屏合成 checkpoint；PNG 使用显式 Hero frame，文档不再要求它等于 GIF 最后一帧。
- 正式设计状态为“验证中”，并明确指出当前代码仍是旧行为、实现与媒体人工验收尚待后续任务。
- `git diff --check` 返回成功，`git status --short` 不包含代码或媒体资产。

## 幂等性与恢复

本计划只修改 Markdown。所有修改可通过重复执行文本检查安全验证。开始前的旧 worktree 内容保存在带说明的 git stash 中，不应在本分支恢复。若文档修订出现问题，只回改本分支中本计划涉及的行，不使用 `git reset --hard` 或 `git checkout --`。

## 证据与备注

当前实现证据：

    scripts/media/recording-session.mjs:748  // Copy last GIF frame as PNG
    scripts/media/recording-session.mjs:752  await fs.copyFile(lastFrame, ...)

当前产品边界证据：

    devSessionCanvas.canvas.multiRootPresentationMode = rootGroups | paneGallery
    paneGallery local layout = dynamic | grid | topThumbnails | sideThumbnails

最终验证证据：

    git diff --check
    consistency: 8 GIF frames, 10.0s, docs-only changes

## 接口与依赖

本设计任务不新增代码接口或依赖。后续 compositor 实现必须继续使用真实 Extension Development Host 录制出的图像作为两个 UI panel 的来源，可以在 `ffmpeg` 侧完成缩放、布局、字幕和静态背景合成；不得在后期重绘 Agent、Terminal、attention 或 running 状态。具体 CLI、manifest 和资产命名由后续实现 ExecPlan 在读取本设计后正式确定。

计划修订说明：2026-07-14 创建本计划，用于把多轮用户反馈收敛为仓库内正式、可执行且不夸大实现状态的媒体设计；同日根据独立审阅补齐真实 attention 认领时机、通知配置、单宽屏字幕带、Terminal 状态、GIF 阅读时长和里程碑；随后根据用户反馈把录制 Skill 收缩为只负责原始素材捕获，剪辑职责继续归剧本、正式设计和未来独立 compositor，同时恢复真实宿主、坐标定位、右键菜单、状态初始化和 modal 等既有录制关键技巧。
