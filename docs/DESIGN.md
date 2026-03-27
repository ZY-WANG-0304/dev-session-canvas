# DESIGN

本文件定义 `docs/design-docs/` 的使用方式，以及设计文档的状态与元数据约定。

## 职责边界

- `ARCHITECTURE.md`：提供顶层架构地图、领域边界和稳定接口。
- `docs/DESIGN.md`：定义设计文档工作流、状态和 frontmatter 约定。
- `docs/design-docs/index.md`：作为具体设计文档的注册表。
- `docs/design-docs/*.md`：记录问题定义、候选方案、取舍、当前结论和验证证据。

## 什么时候写设计文档

当以下任一内容需要被明确时，应新增或更新设计文档：

- 问题定义
- 目标与非目标
- 候选方案比较
- 关键边界划分
- 风险与取舍
- 待验证假设

## 当前约定

- 如果方案尚未确认，文档可以只写问题、约束和候选项。
- 如果结论尚未形成，明确写“待定”即可。
- 不要把倾向、直觉或草案写成已接受结论。
- 每份具体设计文档必须使用 YAML frontmatter。

## Frontmatter 约定

每份具体设计文档都必须包含以下字段：

```yaml
---
title: 文档标题
decision_status: 待探索
validation_status: 未验证
domains: []
architecture_layers: []
related_specs: []
related_plans: []
updated_at: 2026-03-27
---
```

- `title`：文档标题，应与正文标题一致。
- `decision_status`：决策状态，必须使用固定枚举。
- `validation_status`：验证状态，必须使用固定枚举。
- `domains`：关联问题域；应与 `ARCHITECTURE.md` 中的领域划分保持一致。
- `architecture_layers`：关联层或运行时边界；应与 `ARCHITECTURE.md` 保持一致。
- `related_specs`：关联产品规格路径。
- `related_plans`：关联执行计划路径。
- `updated_at`：最后更新时间，使用 `YYYY-MM-DD`。

## 状态枚举

### 决策状态

- `待探索`
- `比较中`
- `已选定`
- `已废弃`

### 验证状态

- `未验证`
- `验证中`
- `已验证`
- `验证失败`

## 索引同步约定

- `docs/design-docs/index.md` 必须登记每份具体设计文档的状态。
- 索引状态应与具体设计文档 frontmatter 保持一致。
- 如果两处不一致，以具体设计文档 frontmatter 为准，并尽快同步索引。

## 推荐结构

1. 背景
2. 问题定义
3. 目标
4. 非目标
5. 候选方案
6. 风险与取舍
7. 当前结论
8. 验证方法
