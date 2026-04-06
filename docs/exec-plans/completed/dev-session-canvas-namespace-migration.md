# 收口 DevSessionCanvas 命名空间并保留兼容迁移

> 说明：本文件记录的是 2026-04-05 完成的“兼容迁移阶段”。2026-04-06 又继续推进了破坏性的扩展身份切换；当前仓库事实请同时参见 `docs/exec-plans/completed/dev-session-canvas-extension-identity-cutover.md` 与对应设计文档。

本 ExecPlan 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘` 这几个章节。

本计划位于仓库根目录下的 `docs/PLANS.md` 约束体系内，后续任何继续推进该主题的协作者都必须按 `docs/PLANS.md` 的要求持续维护本文件。

## 目标与全局图景

这项工作要把当前仓库中仍然以 `opencove` 作为运行时命名空间的部分，正式收口到 `DevSessionCanvas` 的新命名上，同时不破坏已有用户配置、命令脚本和已保存的画布状态。完成后，用户在命令、设置项、文档和新写入的持久化键上看到的都应是 `devSessionCanvas.*`；如果用户之前已经在设置里写了 `opencove.*`，或 workspace 中已经保存了旧状态键，升级后仍然可以继续使用。

用户可以亲眼验证的结果有三类：命令面板里只出现 `Dev Session Canvas` 对应的新命令 ID；文档和设置说明都改成新配置键；原先使用旧键名保存的配置和状态在升级后仍然生效，且自动化检查通过。

## 进度

- [x] (2026-04-05 15:15 +0800) 盘点仓库内剩余 `opencove` 出现位置，并按“低风险残留”“可兼容迁移”“不应本轮改动”三层分类。
- [x] (2026-04-05 15:15 +0800) 确认本任务属于多文件、带兼容边界的正式收口工作，需要新增 ExecPlan 和设计文档。
- [x] (2026-04-05 15:23 +0800) 新增本计划，并写明本轮迁移边界、验证方式和非目标。
- [x] (2026-04-05 15:47 +0800) 完成第一层低风险清理：活动栏图标文件名、内部执行事件名、README / CONTRIBUTING 当前接口说明、package localization key 与相关活文档已收口到新命名。
- [x] (2026-04-05 15:47 +0800) 完成第二层兼容迁移：正式命令 ID、正式配置键与正式 workspace 状态键迁移到 `devSessionCanvas.*`，旧 `opencove.*` 命令、配置键与状态键保留兼容入口。
- [x] (2026-04-05 15:51 +0800) 运行 `npm run typecheck` 与 `npm run build` 通过，并同步更新设计文档、README、CONTRIBUTING、相关活文档和技术债登记。
- [x] (2026-04-05 15:55 +0800) 将本计划迁入 `docs/exec-plans/completed/`，并把仍未迁移的扩展身份位登记为技术债。

## 意外与发现

- 观察：当前仓库里的 `opencove` 并不都属于同一风险等级。命令 ID、配置键和 workspace 状态键已经和用户脚本、设置与恢复链路直接绑定，不能简单全局替换。
  证据：`package.json` 中的 `opencove.openCanvas`、`opencove.canvas.defaultSurface` 与 `src/panel/CanvasPanelManager.ts` 中的 `opencove.canvas.prototypeState` 都已经作为运行时接口在使用。

- 观察：VS Code 的 view/container/webview panel 标识难以像命令一样做“新旧并存而不重复展示”的兼容迁移。
  证据：`package.json` 的 `viewsContainers` / `views` 贡献如果同时保留旧 ID 和新 ID，会直接创建重复容器或重复视图，而不是像命令注册那样只作为别名存在。

- 观察：共享常量文件一旦直接依赖 `vscode`，会立刻污染 Webview bundle，导致前端构建失败。
  证据：首次实现时把配置兼容读取辅助函数和 `EXECUTION_EVENT_NAME` 放在同一文件，`npm run build` 报错 `Could not resolve "vscode"`；拆出宿主专用的 `src/panel/configurationCompatibility.ts` 后恢复通过。

## 决策记录

- 决策：本轮只迁移命令 ID、配置键和 workspace 状态键，不迁移 view/container/publisher 这类扩展身份位。
  理由：前者可以通过“新主键 + 旧别名/旧读取”的方式做兼容迁移；后者在 VS Code 中缺少无感别名机制，贸然切换会影响视图恢复、布局状态和扩展身份。
  日期/作者：2026-04-05 / Codex

- 决策：配置迁移采取“新键为主、旧键兼容读取”的策略，而不是在本轮自动删除用户设置中的旧键。
  理由：自动改写用户 `settings.json` 风险更高，也更难保证所有 target scope 都被正确处理；兼容读取可以先保证升级无损，再为后续清理预留空间。
  日期/作者：2026-04-05 / Codex

- 决策：历史归档文档中的 `OpenCove` / `opencove` 不做回写，只更新 README、CONTRIBUTING、活跃计划和仍作为当前事实来源的设计文档。
  理由：归档文档记录的是当时的事实与证据，不能为了当前命名统一而改写历史。
  日期/作者：2026-04-05 / Codex

## 结果与复盘

本轮已经完成以下收口：

- 正式命令贡献从 `opencove.*` 迁移到 `devSessionCanvas.*`，同时在运行时继续注册旧命令别名。
- 正式配置键从 `opencove.*` 迁移到 `devSessionCanvas.*`，运行时继续兼容读取旧键。
- workspace 状态新写入改为 `devSessionCanvas.canvas.state` 与 `devSessionCanvas.canvas.lastSurface`，读取时继续回退旧键。
- README、CONTRIBUTING、相关设计文档和活计划已切到新键名；活动栏图标文件名、localization key 和内部执行事件名也完成低风险清理。

本轮明确没有继续推进的内容：

- `publisher`
- Activity Bar container ID / view ID / webview panel ID
- 依赖这些内部标识的 VS Code 恢复与扩展身份边界

这些内容已经登记为技术债，而不是留作隐性残留。

自动化验证结果：

- `npm run typecheck`：通过
- `npm run build`：通过

如果后续要继续推进剩余内部标识迁移，必须先为“VS Code 视图恢复与扩展身份迁移”单独建设计文档和执行计划，而不是沿用本计划继续追加。

## 上下文与定向

这个任务讨论的是“运行时命名空间”，不是单纯的显示名称。这里的“运行时命名空间”包括：

- 命令 ID，例如 `opencove.openCanvas`
- 配置键，例如 `opencove.canvas.defaultSurface`
- workspace 持久化键，例如 `opencove.canvas.prototypeState`

这些键分别出现在以下位置：

- `package.json`：定义命令贡献、激活事件、配置项和视图贡献。
- `src/extension.ts`：真正注册命令。
- `src/sidebar/CanvasSidebarView.ts` 与 `src/panel/getWebviewHtml.ts`：用命令 ID 拼出侧栏操作和 command URI。
- `src/panel/CanvasPanelManager.ts`：读取配置、读写 workspace 状态键、注册 webview panel / panel view 的宿主接口。
- `README.md` 与 `CONTRIBUTING.md`：对外说明命令名和配置键。

本轮必须同时记住三个非目标：

1. 不把 OpenCove 作为灵感来源的 README 说明删掉。
2. 不改写 `docs/exec-plans/completed/` 这类历史归档文档。
3. 不把 `publisher`、view ID、panel view ID 或 activity bar container ID 误当成“可安全批量替换”的普通字符串。

## 工作计划

第一步，新增一份设计文档，把“为什么本轮只迁移三类键、为什么 view/container/publisher 暂不迁移”写成可追踪的正式结论。这样后续协作者不会再把剩余 `opencove` 误判为漏改。

第二步，做低风险清理。这一层不改变兼容边界，只清掉不会影响用户已有状态的残留，例如资源文件名、内部执行事件名、本轮应更新的说明文案和 localization key。

第三步，做兼容迁移。命令层面采用“新命令作为正式命令，旧命令作为兼容别名并继续注册”的方式；配置层面采用“只贡献新配置键，但运行时继续兼容读取旧键”的方式；workspace 状态层面采用“新键写入、旧键读取回退”的方式。

第四步，更新所有仍作为当前事实来源的文档。README 与 CONTRIBUTING 必须改成新键名；当前仍处于活跃状态或仍描述当前接口的设计文档，也要同步更新。历史归档文档不在本轮修改范围。

第五步，运行 `npm run typecheck` 与 `npm run build`，再把遗留但当前不应继续推进的部分登记为技术债。若全部完成，则把本计划归档到 `completed/`。

## 具体步骤

在仓库根目录执行并记录结果：

1. 新建本计划与对应设计文档。
2. 新增运行时标识常量文件，集中定义新旧命令 ID、配置键、存储键和暂时保留的 view/container ID。
3. 修改 `package.json`、`package.nls.json`、`src/extension.ts`、`src/sidebar/CanvasSidebarView.ts`、`src/panel/getWebviewHtml.ts`、`src/panel/CanvasPanelManager.ts`、`src/webview/main.tsx` 和相关文档。
4. 运行 `npm run typecheck`。
5. 运行 `npm run build`。
6. 更新计划、设计文档和技术债追踪。

## 验证与验收

本轮完成的验收标准是：

- 命令面板中由扩展贡献的正式命令改为 `devSessionCanvas.*` 对应的命令。
- README、CONTRIBUTING 和当前设计文档中的配置示例改为 `devSessionCanvas.*`。
- 旧 `opencove.*` 命令仍被注册，可作为兼容别名继续工作。
- 当 workspace 状态里只有旧键时，扩展仍能恢复状态；新的持久化写入落到 `devSessionCanvas.*` 键名。
- `npm run typecheck` 与 `npm run build` 通过。

## 幂等性与恢复

- 本轮文档和代码改动都应可重复执行；如果中途失败，应优先保留“新键写入 + 旧键兼容”的安全状态，而不是回到只认旧键。
- 如果某个兼容读取实现导致类型不安全或验证失败，应先保留旧键支持，再缩小本轮迁移范围；不要为了“清理干净”破坏已有用户状态。
- 如果后续要继续推进 view/container/publisher 迁移，必须先补新的设计文档和验证方案，而不是在本计划上直接追加破坏性修改。

## 证据与备注

本轮实现前的关键现状如下：

    package.json:
    - activationEvents 使用 opencove.openCanvas 等旧命令 ID
    - configuration.properties 使用 opencove.canvas.defaultSurface 等旧配置键

    src/panel/CanvasPanelManager.ts:
    - workspaceState 使用 opencove.canvas.prototypeState 与 opencove.canvas.lastSurface

    README.md / CONTRIBUTING.md:
    - 当前仍向开发者暴露 opencove.* 命令和配置键

## 接口与依赖

本轮实现必须围绕以下接口展开：

- `vscode.commands.registerCommand(...)`：注册新旧两套命令 ID。
- `vscode.workspace.getConfiguration()` 与 `inspect(...)`：在新旧配置键间做兼容读取。
- `ExtensionContext.workspaceState`：从旧状态键回退读取，并把新写入统一收口到新键。
- `package.json` 的 `contributes.commands`、`activationEvents` 与 `contributes.configuration`：分别定义正式命令、旧命令激活入口和新配置键。

本次修订说明：2026-04-05 15:55 +0800 完成本轮实现与自动化验证，补充构建期发现、结果复盘与技术债边界，并准备将本计划归档到 `completed/`。
