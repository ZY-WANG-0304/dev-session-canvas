# VERSION

这个文件定义版本号命名规则。

## 目的

- 统一公开发布时的版本号表达方式。
- 避免把 `Preview`、`pre-release` 与稳定版语义混写。
- 让 `package.json`、`CHANGELOG.md` 与 Marketplace 发布口径保持一致。

## 当前结论

- 当前仓库对外发布默认使用单轨 `SemVer` 三段式版本号：`major.minor.patch`。
- 当前阶段虽然是公开 `Preview`，但版本号本身不添加 `-preview`、`-beta`、日期或 git hash 后缀。
- 当前 `Preview` 身份通过 `package.json` 中的 `preview: true`、Marketplace 文案与 release notes 表达，而不是通过版本字符串表达。
- 在真正准备做稳定版承诺之前，默认停留在 `0.x.y`。
- 当前默认不启用 Marketplace `pre-release` 双轨发布策略；若未来决定启用，需要单独更新本文件与发布流程文档。

## 命名格式

默认格式：

```text
major.minor.patch
```

要求：

- 只使用三段正整数。
- 不追加 `-preview`、`-beta`、`-rc` 等后缀。
- 不把日期、分支名、提交哈希写进版本号。

## 当前阶段规则

- `0.x.0` 表示一个新的对外里程碑版本。
- `0.x.y` 且 `y > 0` 表示同一里程碑下的 bugfix、兼容性修复、打包修正或文档收口。
- 只有在稳定性、支持矩阵和对外承诺都准备好后，才进入 `1.0.0`。

## 当前发布策略

- 首个公开 Marketplace Preview 版本从 `0.1.0` 开始，不继续使用 `0.0.1` 作为公开首发版本号。
- 后续同一阶段的小修复按 `0.1.1`、`0.1.2` 递增。
- 下一轮较大能力迭代按 `0.2.0`、`0.3.0` 递增。
- 真正切换为稳定公开版时，再进入 `1.0.0`。

## 示例

- `0.1.0`：首个公开 `Preview` 基线版本。
- `0.1.1`：公开首发后的 bugfix 或发布收口修复。
- `0.2.0`：下一轮明确的新能力里程碑。
- `1.0.0`：首个稳定公开版。

## 与发布文案的关系

- `package.json` 中的 `version`、`CHANGELOG.md` 标题与 Marketplace 发布版本号必须一致。
- `Preview` 身份应写在 `README.md`、`CHANGELOG.md`、Marketplace listing 和 release notes 中。
- 如果版本号已经升级到 `1.x.y`，就不要继续把该版本表述为仅供试用的临时预览包。

## 例外处理

- 如果未来决定采用 Marketplace `pre-release` 通道，不沿用本文件的单轨规则，必须先更新本文件并同步发布流程文档。
- 如果用户或项目负责人明确要求采用其他版本策略，以明确决策为准，但必须把新规则补写回本文件。
