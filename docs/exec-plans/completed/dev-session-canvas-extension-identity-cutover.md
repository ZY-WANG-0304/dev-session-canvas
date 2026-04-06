# DevSessionCanvas 扩展身份断点切换

本 ExecPlan 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘` 这几个章节。

本计划位于仓库根目录下的 `docs/PLANS.md` 约束体系内，后续任何继续推进该主题的协作者都必须按 `docs/PLANS.md` 的要求持续维护本文件。

## 目标与全局图景

这项工作要在上一阶段“保留兼容迁移”的基础上，进一步把扩展身份完整切换到 `DevSessionCanvas`。完成后，扩展 `publisher`、view/container/webview panel ID、命令 / 配置 / 状态键的正式入口都统一到当前正式命名；旧 `opencove` 扩展身份与旧命名兼容层不再继续保留。

这次切换不是对旧 `opencove` 预览包的原地升级。用户可见的结果包括：安装包身份变为 `devsessioncanvas.dev-session-canvas`；旧扩展不会被当前 VSIX 覆盖替换；内部分发文档明确要求在旧包已安装时先卸载旧扩展，再安装新包。

## 进度

- [x] (2026-04-06 00:20 +0800) 确认正式开发阶段接受一次显式断点升级，不再继续维持双命名兼容。
- [x] (2026-04-06 00:32 +0800) 将 `publisher`、view/container/webview panel ID、旧命令别名、旧配置兼容读取与旧状态迁移逻辑一并切换到新扩展身份。
- [x] (2026-04-06 00:40 +0800) 更新 README、CONTRIBUTING、设计文档、发布准备文档与设计索引，使当前事实来源不再宣称仍保留旧兼容层。
- [x] (2026-04-06 01:55 +0800) 根据 review 反馈补充分发断点迁移说明，并为上一阶段 completed plan 增加后续阶段指引，避免历史计划被误读为当前仓库事实。
- [x] (2026-04-06 02:00 +0800) 运行 `npm run typecheck` 与 `npm run build`，确认本轮收口未破坏构建。

## 意外与发现

- 观察：在当前内部 VSIX 分发模式下，切换 `name` + `publisher` 后不会覆盖旧 `opencove` 包，而是形成第二个独立扩展。
  证据：VS Code 的扩展安装身份以扩展标识为准；当前新包 manifest 已切换到 `devsessioncanvas.dev-session-canvas`，因此旧包不会被原地替换。

- 观察：上一阶段 completed plan 记录的是当时成立的“兼容迁移阶段”事实，但如果当前设计文档继续只指向它，会误导后来者把那个阶段性结论当成当前仓库事实。
  证据：`docs/exec-plans/completed/dev-session-canvas-namespace-migration.md` 明确写着“保留兼容入口、不迁移 publisher/view ID”，而当前实现已经进一步切换到了新扩展身份。

## 决策记录

- 决策：接受这次扩展身份切换的破坏性后果，不再保留旧命名空间的兼容读取、命令别名和状态迁移。
  理由：正式产品名已经确定，继续维护两套扩展身份只会把文档、实现、分发和后续迭代长期绑在双命名状态上。
  日期/作者：2026-04-06 / Codex

- 决策：不把上一阶段 completed plan 改写成当前结论，而是新增本计划记录后续切换，并在旧计划顶部显式补充后续阶段指引。
  理由：上一阶段计划本身是历史事实；问题在于缺少“后续又继续推进”的正式记录，而不是那份历史记录本身不该存在。
  日期/作者：2026-04-06 / Codex

- 决策：内部 VSIX 分发文档必须显式写清一次性卸载 / 重装步骤，而不是继续使用“覆盖升级”表述。
  理由：这次切换下旧包不会被当前 VSIX 原地替换；如果不写清楚，内部体验用户会同时看到两份扩展和两套入口。
  日期/作者：2026-04-06 / Codex

## 结果与复盘

本轮已经完成以下收口：

- `package.json` 中的 `publisher`、activation events、受限配置声明、view/container/webview panel ID 都切换到新的正式扩展身份。
- `src/common/extensionIdentity.ts`、`src/extension.ts` 与 `src/panel/CanvasPanelManager.ts` 不再保留旧命令别名、旧配置兼容读取和旧状态迁移逻辑。
- README、发布准备文档与设计文档已明确写出：从旧 `opencove` 预览包切到当前 `devsessioncanvas.dev-session-canvas` 包时，必须按一次性断点迁移处理。
- 上一阶段 completed plan 已补充后续阶段指引；当前设计文档和设计索引已把本计划列为当前相关计划来源。

自动化验证结果：

- `npm run typecheck`：通过
- `npm run build`：通过

## 验证与验收

本轮完成的验收标准是：

- 新安装的 VSIX manifest 身份为 `devsessioncanvas.dev-session-canvas`。
- 当前实现中不再注册旧 `opencove.*` 命令，也不再兼容读取旧配置键和旧 workspace 状态键。
- README 与 `docs/publish-readiness.md` 已明确写出内部分发下的“一次性卸载旧扩展，再安装新包”要求。
- 当前设计文档与设计索引能把后来者指向本计划，而不是把上一阶段兼容迁移误读为当前仓库事实。

## 证据与备注

本轮实现后的关键事实如下：

    package.json:
    - publisher 已切换为 devsessioncanvas
    - activationEvents / views / viewsContainers / panel view 标识已切换到 devSessionCanvas.*

    src/common/extensionIdentity.ts:
    - 只保留当前正式命名，不再导出 LEGACY_* 常量

    README.md / docs/publish-readiness.md:
    - 已补充从旧 opencove 预览包迁移到当前包时的卸载 / 重装说明
