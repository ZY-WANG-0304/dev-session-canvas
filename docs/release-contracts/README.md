# 发布契约

从 v0.25.0 之后的下一次公开扩展发布开始，每个发布准备 PR 都必须新增 `vX.Y.Z.md`。该文件和根 `package.json`、主扩展 / notifier manifest、两个 CHANGELOG 以及 Marketplace listing 一起构成不可变发布输入。

发布契约只记录发布前已经确定的范围和检查计划。它不能包含最终 release ref、Actions run、VSIX SHA、实际渠道状态、deferred 原因或“gate 已通过”的结果；这些事实由 release workflow 写入 GitHub Release 的 manifest 和 assets。不要在发布完成后修改对应版本的契约或 CHANGELOG。

文件必须采用如下结构，标题中的版本与文件名、三个 package manifest 和 lockfile 一致：

```md
# vX.Y.Z 发布契约

## 发布范围

说明本版本交付给用户的能力范围，以及不属于本版本的内容。

## 用户 release notes

概述主扩展和 notifier CHANGELOG 的用户可见承诺；不要复制内部执行步骤。

## 文档清单

必须逐项列出以下已复核文件：

- `extensions/vscode/dev-session-canvas/README.marketplace.md`
- `extensions/vscode/dev-session-canvas-notifier/README.marketplace.md`
- `docs/public-preview-release-playbook.md`
- `docs/notifier-preview-release-playbook.md`
- `docs/support.md`
- `docs/design-docs/public-marketplace-release-readiness.md`

主扩展与 notifier 的 CHANGELOG 由 preflight 单独检查，不必在这里重复列出。若本版本还有额外的产品、设计或支持文档，也必须在这一节补充。

## 已知限制

只列出影响安装、升级、回退或产品行为的用户限制。

## 验证范围

说明本版本为什么需要的定向测试；完整命令由 `npm run release:verify -- --version X.Y.Z` 固定执行。
```

在创建或更新发布准备 PR 时运行：

```sh
npm run release:preflight -- --version X.Y.Z
npm run release:verify -- --version X.Y.Z
```

`release:preflight` 适合快速定位版本或文档输入错误；`release:verify` 还会运行完整测试和 clean-checkout VSIX 验证。创建或更新发布准备 PR 时，PR check 针对由最新 PR head 与基准分支生成的预合并结果运行完整验证。PR 合入后，publish workflow 会在相同版本的最终 tag ref 上再次运行 `release:verify`，成功前不会开始打包或对外发布。
