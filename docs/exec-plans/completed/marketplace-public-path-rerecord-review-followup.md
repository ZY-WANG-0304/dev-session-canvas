# 消除 Marketplace 媒体本机路径并收口一次性检查

本 `ExecPlan` 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘`。本计划遵循仓库根目录 `docs/PLANS.md`，完成后移动到 `docs/exec-plans/completed/`。

## 目标与全局图景

PR #271 当前六份公开 PNG、GIF 和 MP4 能看到维护者 home 下的绝对路径，因为四个录制 root 位于仓库 `.debug` 目录，真实 Codex TUI 又会展示当前工作目录。完成本计划后，正式宣传媒体必须由 `/tmp/dev-session-canvas-marketplace-media/four-root-attention/` 下的中性四 root workspace 重新录制；画面中可以出现业务 root 名，但不能出现用户名、home 路径或当前仓库绝对路径。

同一 review 还指出两份素材专用测试把当前八帧、54 秒时间线、字幕和几何固化成长期仓库契约。本计划会删除 `scripts/media/compose-marketplace-media.test.mjs` 与 `scripts/media/recording-session.test.mjs`，撤销仅服务于历史媒体测试的 fake provider fixture 增量，并把正式文档改为“本次临时检查与人工验收”，不再声明长期 `node --test scripts/media/*.test.mjs` 门禁。

用户可以直接打开 `extensions/vscode/dev-session-canvas/images/marketplace/` 下的六份资产验收；reviewer 可以从 PR diff 确认两份一次性测试已删除，并从本计划、正式设计和 PR 评论追溯本次验证证据。

## 进度

- [x] (2026-07-20 12:35Z) 读取 PR #271 最新 review、录制剧本、录制 Skill、`docs/PLANS.md` 与既有媒体计划，确认两项 blocker 的边界。
- [x] (2026-07-20 12:49Z) 修改正式录制 scenario，使四 root workspace 默认落在不含个人标识的固定中性路径，并同步剧本、设计与录制 Skill；build、typecheck、脚本语法和 diff check 通过。
- [x] (2026-07-20 12:49Z) 删除两份素材专用测试和仅由旧媒体测试使用的 fake provider fixture 增量，清理新增文档中的长期门禁表述。
- [x] (2026-07-20 13:24Z) 从中性 workspace 启动真实 Extension Development Host，使用两个真实 Codex 与两个真实 Claude Code 录制 29 秒 Root Groups 连续源、38 秒 Pane Gallery 连续源和八组 checkpoint pairs，并用 `close` 安全关闭。
- [x] (2026-07-20 13:38Z) 重新生成中英文 MP4、GIF、PNG，完成路径泄露、叙事、尺寸、时长、解码、字体、关键帧、动态唯一帧与 1180/375 预览检查。
- [x] (2026-07-20 13:44Z) 同步正式设计与完成计划；build、typecheck、脚本语法、manifest、report、session metadata、checksum 和 diff 门禁通过，准备提交并更新 PR。

## 意外与发现

- 观察：现有 session 的四个 `workspaceFolders[].path` 都位于 `/home/users/.../dev-session-canvas7/.debug/marketplace-media/scenario/...`，而真实 Codex TUI 在公开 Hero 和视频里显示 cwd。
  证据：`.debug/marketplace-media/recording-session.json` 记录了上述绝对路径，PR 评论明确在六份正式资产中确认可见。

- 观察：正式场景已经使用系统 PATH 中已登录的 Codex 与 Claude Code，当前 blocker 不是 provider 真实性，而是 disposable workspace 的位置。
  证据：session metadata 记录 Codex `0.144.5`、Claude Code `2.1.209`，四节点分工为两个 Codex、两个 Claude，且没有 `provider-bin` PATH 注入。

- 观察：两份素材 test 同时包含当前剧本断言与少量通用录制器检查；review 要求移除整个文件，因此本轮不把其中的 progress parser 用例迁移成另一个媒体命名测试。
  证据：删除后 `rg` 在正式文档中不再找到 `node --test scripts/media/*.test.mjs`，而 recorder/compositor 的 CLI 运行时校验仍保留。

- 观察：第一次把四轮 Root Groups 操作放进一个长坐标序列时，后两个节点未获得焦点，最后一条任务落入 storefront；这条失败 clip 没有进入 manifest。
  证据：诊断 contact sheet 显示 payment/storefront 正确而 design/release 未聚焦。最终改为四个独立 scene，每段都在拼接前生成 contact sheet；最终 29 秒源完整显示四轮动作。

- 观察：第一条成功 Pane Gallery 录屏的操作顺序正确，但真实点击在源片约 20 秒已回到 dynamic，直接合成会让 Release Validation 过早退场。
  证据：2 秒 contact sheet 显示 eye、payments、decision、release、dynamic 均存在但节奏过快。最终只对同一条连续真实视频的三个中间区间调整 PTS，未插入 checkpoint 或冻结帧；重定时源在 22–30 秒持续显示 release result，正式 MP4 的 Pane 主窗 50 个半秒采样帧全部唯一。

## 决策记录

- 决策：正式四 root scenario 默认使用 `/tmp/dev-session-canvas-marketplace-media/four-root-attention`，而录制日志、clips、checkpoint 和 composite 仍保留在仓库 `.debug/marketplace-media/`。
  理由：录制只在 Linux X11 环境运行；固定 `/tmp` 路径不会暴露用户名，同时不改变现有可追溯证据目录和合成器输入协议。
  日期/作者：2026-07-20 / Codex

- 决策：重新录制真实宿主像素，不在后期遮挡、裁切或替换 cwd 文本。
  理由：review 明确要求从中性路径重新录制，且产品状态与 Agent TUI 必须继续来自真实 UI。
  日期/作者：2026-07-20 / Codex

- 决策：保留 compositor 与 recording CLI 本身，但删除当前素材专用测试文件；本次质量检查通过临时命令、机器可读 report 和人工逐帧证据完成。
  理由：工具仍是可重复制作流程的一部分，八帧文案和精确时间线不是产品稳定接口，不应形成长期测试门禁。
  日期/作者：2026-07-20 / Codex

- 决策：Root Groups 使用四个已逐段目检的真实 scene 拼成前 19 秒，再接同一宿主的 10 秒实时比较源；Pane Gallery 对同一连续真实录屏使用分段 PTS 重定时，使 eye、decision、release 与 globe 对齐既定 54 秒成片。
  理由：分 scene 避免长坐标序列的焦点漂移；PTS 重定时保留每一帧真实产品像素和连续动效，同时恢复 reviewer 已接受的叙事节奏，不使用静态 checkpoint 或后期重绘状态。
  日期/作者：2026-07-20 / Codex

## 结果与复盘

PR #271 的两项 blocker 已在本地收口。正式 scenario 的 `workspaceFile` 与四个 `workspaceFolders[].path` 全部位于 `/tmp/dev-session-canvas-marketplace-media/four-root-attention/`；session metadata 记录 Codex `0.144.5`、Claude Code `2.1.209` 均已认证，四节点为两个 Codex 与两个 Claude Code。公开 Hero、GIF 八帧、MP4 关键帧和中英文 1180/375 预览只显示中性 `/tmp` cwd，没有用户名、home 或 worktree 路径。

英文 MP4 / GIF / PNG SHA-256 依次为 `a3280c5ac98d4ac0ff8f894a0979fc1780f34e103b5c2082e497cfd8d95c0361`、`4c38e8d21a3ce2153fef02a9f35a11ddfe64385c2113176c24343fae1ff481af`、`9b6486e1d2c73a208e97bb967456d229adf0e97346a2e3da5a764ad396df252c`；中文依次为 `5a1640ebb50015484fd13f7b9519aaccddaf40d3870ec1005536f934b27d6aa2`、`1cd849ae8a3ae7820446c878625dc6c4107faeb1e6277762a2eb6155d3d9da2e`、`f04d390ee3116ce633a62d2bd548617d5793e8d153bba4d39e9d0efaa1790ddc`。六件套完整解码、两条 MP4 blackdetect 零命中、比较左右各 `12/12` 唯一采样帧、Pane 主窗 `50/50` 唯一采样帧，两份 report 均为 `passed: true`。

两份素材专用 test 文件已经删除，fake provider fixture 回到 `origin/main` 内容，新增文档不再声明长期媒体测试门禁。本轮没有新增残余技术债；旧 `stop` 导出副作用继续由既有技术债条目跟踪。

## 上下文与定向

`scripts/media/recording-session.mjs` 启动隔离的真实 VS Code Extension Development Host。`prepareFourRootScenario()` 当前把 scenario workspace 放在仓库 `.debug` 下；它还为四个 root 写入静态 root-local snapshot，并让真实 Agent 以各 root 为 cwd 启动。修改只应改变 disposable scenario 与 workspace 的位置，不改变用户数据目录、source/checkpoint 输出路径或 provider 配置继承。

`docs/marketplace-media-scenario.md` 是唯一剧本。四个 root 依次为 `payments-api`、`storefront`、`design-system`、`release-tools`，四个节点都是真实 Agent。`docs/skills/recording-marketplace-media/SKILL.md` 规定录制片段内只用原生输入，最终使用 `close` 而不是带旧导出副作用的 `stop`。

`scripts/media/compose-marketplace-media.mjs` 消费 `.debug/marketplace-media/pair-manifest.json`、真实连续视频和 checkpoint，输出英文与中文三件套。它可以继续校验 manifest、staged output、尺寸、时长、字体和来源 hash；删除测试文件不等于删除 compositor 自身的运行时校验。

## 工作计划

第一个里程碑收口代码与文档边界。给正式四 root scenario 一个固定中性根目录，确保 scenario metadata 和 workspace file 都引用 `/tmp`。删除两份 test 文件，撤销 fake provider fixture 的媒体专用分支，并在设计文档、完成计划和 Skill 中删除“当前素材参数是长期自动化契约”的表述。里程碑结束时，脚本语法、build、typecheck 与 `git diff --check` 应通过，`rg` 不再找到被删除测试文件的长期门禁引用。

第二个里程碑完成真实重录。启动正式 scenario 后，先读取 session metadata，必须看到四个 workspace folder 都在中性 `/tmp` 路径；然后按剧本完成 Root Groups 逐节点提交、连续双模式比较来源、Pane Gallery eye/缩略图/Agent/globe 故事和八组 checkpoint。任何登录、信任、升级提示都在录制外处理；若场景失败，只重录对应 scene，不回退 fake provider。

第三个里程碑重新合成并验收。更新 pair manifest 后分别渲染英文与中文，检查六份正式资产都可完整解码、尺寸与时长正确、report 为通过。使用直接帧提取、contact sheet 和可读字符串检查确认没有用户名、`/home/users`、仓库 worktree 路径或其他个人环境标识；该检查只作为本次证据，不新增跟踪脚本。最后更新文档、归档计划、推送 PR head 并回复 blocker 评论。

## 具体步骤

所有命令从仓库根目录执行。代码边界检查使用：

    node --check scripts/media/recording-session.mjs
    node --check scripts/media/compose-marketplace-media.mjs
    npm run build
    npm run typecheck
    git diff --check

真实录制使用现有受限 CLI：

    node scripts/media/recording-session.mjs start --scenario four-root-attention
    node scripts/media/recording-session.mjs state
    node scripts/media/recording-session.mjs record-sequence --take <take> --scene <scene> --actions <json>
    node scripts/media/recording-session.mjs checkpoint <frame-id> --take <take>
    node scripts/media/recording-session.mjs close

合成与输出验证使用：

    node scripts/media/compose-marketplace-media.mjs validate --manifest .debug/marketplace-media/pair-manifest.json
    node scripts/media/compose-marketplace-media.mjs render --manifest .debug/marketplace-media/pair-manifest.json --language en
    node scripts/media/compose-marketplace-media.mjs render --manifest .debug/marketplace-media/pair-manifest.json --language zh-CN
    ffmpeg -v error -i <asset> -f null -

## 验证与验收

录制 session 必须记录四个 root 位于 `/tmp/dev-session-canvas-marketplace-media/four-root-attention/workspace/`，并记录两个 Codex 与两个 Claude Code 的真实版本和认证预检。源画面和最终六件套不能出现维护者用户名、`/home/users`、当前 worktree 绝对路径、fake provider 前缀或 wrapper 路径。

Take A 仍要展示四轮“双击放大、输入、running、fit view”；Take B 仍要连续展示 eye、attention 缩略图聚焦、Agent 认领与回复、release result、globe 和 dynamic 回全览。比较段两侧持续运动，PNG Hero 保持 50/50 与真实 side thumbnails，GIF 维持已确认的三段式叙事。

两条 MP4 必须为 `1920x1200`、约 54 秒；两条 GIF 必须为 `1440x900`、8 帧、10 秒；两张 PNG 必须为 `1920x1200`。两份 validation report 必须为 `passed: true`，中英文 1180px 与 375px 预览不能裁字或重新产生过量底部留白。

## 幂等性与恢复

`start` 会把当前 source、checkpoint、manifest、composite 与 review 证据复制到带时间戳的 `.debug/marketplace-media/archive/` 后再清理活动目录；因此新录制失败时仍可保留旧版对照。正式资产由 compositor staged validation 全部通过后原子替换，不在失败时覆盖。`close` 可重复运行且不导出媒体；不得运行旧 `stop`。

固定 `/tmp` scenario 只保存可再生的 disposable root 和 trigger。重新开始 session 时可以由 `prepareFourRootScenario()` 删除并重建该目录，但不能删除用户真实项目、CLI 配置或认证文件。

## 证据与备注

完成时在此记录简短证据，包括中性 workspace metadata、新六件套 SHA-256、validation report、完整解码和关键帧检查结果。一次性 contact sheet、OCR 或字符串 probe 放在 `.debug/marketplace-media/review/`，不新增到 git。

## 接口与依赖

本计划不新增 npm 或系统依赖。`prepareFourRootScenario(runtime, providerPreflight)` 继续返回 `workspaceFile`、`roots`、`triggerDir`、`providers` 和 `providerPreflight`；唯一接口变化是这些 scenario 路径默认位于固定 `/tmp` 中性根目录。录制 CLI、pair manifest v2、compositor `validate` / `render` 命令和六份正式文件名保持不变。

计划修订说明（2026-07-20 12:35Z）：根据 PR #271 review 新建本 follow-up，明确中性路径真实重录、删除一次性测试与非长期验证边界。

计划修订说明（2026-07-20 12:49Z）：完成中性路径代码、一次性测试删除和文档边界收口，并记录 rebase 后 build/typecheck/语法/diff 结果。

计划修订说明（2026-07-20 13:44Z）：记录真实重录、失败恢复、连续视频重定时、六件套 hash、公开路径审阅与最终工程门禁，计划完成并移入 `completed/`。
