# BRANCH

这个文件只定义主题分支命名规则。

## 目的

- 让分支名能直接表达当前工作的范围和目标，便于 MR、review 和追溯。
- 保持仓库中的主题分支命名风格一致。

## 命名原则

- 一个分支名只表达一个明确目标。
- 命名优先覆盖业务域、模块或文档域，再写主题和交付目标。
- 名称应足够具体，让人只看分支名就知道在做什么。

## 命名格式

默认使用英文小写的 kebab-case：

```text
area-topic-goal
```

要求：

- 只使用英文小写字母、数字和 `-`
- 不使用空格、下划线、中文或无语义缩写

## 命名建议

- 功能分支：先写受影响模块，再写功能主题和目标。
- 文档分支：优先使用 `docs-...` 开头。
- 工作流规则分支：优先使用 `workflow-...` 开头。

## 示例

- `canvas-agent-node-prototype`
- `docs-product-sense-bootstrap`
- `workflow-execplan-rules`

## 反例

- `test`
- `update`
- `fix_it`
- `修一下`
