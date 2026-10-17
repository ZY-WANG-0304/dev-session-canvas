# CI与发布门禁重设计资料

正式方案见[CI与发布门禁重设计](../../design-docs/release-gate-redesign.md)。本目录包含可审阅设计模型、迁移清单及拟议流程图，不是已经部署的CI，也不构成产品或发布通过证据。

| 资料 | 作用 |
| --- | --- |
| [inputs.json](inputs.json) | 0abd89e8/main6e708c6b及固定研究文件摘要 |
| [design-model.json](design-model.json) | 15个验证job的依赖、模式范围、六原生/三安装目标、阶段/身份和恢复规则 |
| [migration-map.json](migration-map.json) | 70顶层命令、8个Marketplace分支、10个补充具名检查、22smoke入口与152拟议case目录 |
| [verify.py](verify.py) / [verification.json](verification.json) | 设计DAG/覆盖/身份/失败与渠道复用控制；不是生产实现的测试 |
| [generate-diagrams.py](generate-diagrams.py) | 三视图JSON布局生成；精确中文字、箭头和拟议/未实施标记 |

| 流程图 | SVG | PNG尺寸 |
| --- | --- | --- |
| 验证依赖与范围 | [validation-flow.svg](validation-flow.svg) | [1800×1460](validation-flow.png) |
| 双包交接与验收 | [package-flow.svg](package-flow.svg) | [1800×1714](package-flow.png) |
| 发布六job与渠道恢复 | [publish-flow.svg](publish-flow.svg) | [1800×1800](publish-flow.png) |

在仓库根运行`python3 docs/references/release-gate-redesign/verify.py`，只需Python标准库。它核固定源码摘要、无环/消费产物依赖、模式层级、70/8/10/22迁移范围及少case、改SHA/包/环境、业务/清理失败、缺job结果、取消、内容未知、历史复用等纯数据反例。checker只实现设计约束的简化模型，不调用Node/npm/gh/网络/产品或渠道；boolean producerTrusted代表外部来源核对前提，不声称已经实现GitHub来源验证。

`build-model.py`用于有意重建设计输入，重建会更新输入摘要，实施或review时不得用它自动接受未知源码变化；默认只运行verify。137现有case目的地与15新增待验是旧覆盖映射，非152已实现用例/Host。迁移清单还需逐条helper断言review。

图使用[fireworks-tech-graph技能](/home/users/ziyang01.wang-al/.codex/skills/fireworks-tech-graph/SKILL.md)。本地生成：

```sh
python3 docs/references/release-gate-redesign/generate-diagrams.py
python3 /home/users/ziyang01.wang-al/.codex/skills/fireworks-tech-graph/scripts/fireworks.py render flowchart docs/references/release-gate-redesign/validation-flow.json docs/references/release-gate-redesign/validation-flow.svg --report docs/references/release-gate-redesign/validation-flow.layout.json
python3 /home/users/ziyang01.wang-al/.codex/skills/fireworks-tech-graph/scripts/fireworks.py check docs/references/release-gate-redesign/validation-flow.svg
PYTHONPATH=/dev/shm/dsc-release-audit-renderer python3 /home/users/ziyang01.wang-al/.codex/skills/fireworks-tech-graph/scripts/fireworks.py export-png docs/references/release-gate-redesign/validation-flow.svg docs/references/release-gate-redesign/validation-flow.png --width 1800
```

另外两图替换basename。PNG复用本机已有CairoSVG环境，无需安装项目依赖；其他环境使用已有CairoSVG/rsvg-convert。SVG文本严格完整、碰撞/箭头/几何/构图检查和PNG尺寸/实际视觉检查见[diagram-validation.json](diagram-validation.json)。基础层和源码/production构建的详细job依赖在正式方案表与model中；图01合并展示同目的阶段，不能解释成共写dist。图02两条消费链独立，installed不依赖packaged成功。

局限：环境组合、deadline校准、原样安装/六目标操作、真实TUI及渠道重签内容口径仍需后续实际验收。当前workflow、required check、PR327、版本和产品没有因本目录改变；旧现状图仍在release-gate-flow-audit目录。
