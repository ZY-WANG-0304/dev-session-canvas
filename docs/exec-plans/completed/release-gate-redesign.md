# 重设计发布门禁的执行与验收契约

本ExecPlan按`docs/PLANS.md`维护；覆盖当前设计任务的输入核对、方案选择、可执行设计模型验证与交付，不代表实现workflow或完成发布。用户授权重新设计，既有审查和smoke迁移输入继续复用，全部关联资料在当前修复范围收口。

## 目标与全局图景


当前门禁将不同验证层串成一条长链，测试包与正式包未绑定，发布汇总缺少结果身份校验。用户应获得一套能直接指导实现的设计：知道每个job验证什么、输入和输出是什么、何时必须运行、失败后哪些工作继续、哪些外部操作停止，以及如何重试原包。流程图和机器可读模型共同核对这些规则，避免只有口头建议。

## 进度


- [x] (2026-10-17) 读取WORKFLOW/DESIGN/PLANS、现有分层审查与smoke设计，fetch确认main仍为6e708c6b，当前输入0abd89e8。
- [x] (2026-10-17) 收口普通PR/发布PR/最终tag/原包恢复与辅助入口；15验证job、六发布job、同批双包和严格回执契约。
- [x] (2026-10-17) 完成70顶层、8Marketplace分支、10补充检查、22smoke入口迁移；44项设计数据控制及DAG核对通过。
- [x] (2026-10-17) 三张SVG完整文字/几何/构图校验通过，复用已有CairoSVG环境导出1800px PNG，逐图视觉查看完成。
- [x] (2026-10-17) 同步索引/原则/技术债与现有研究入口，smoke设计明确已选定未实施。
- [x] (2026-10-17) 归档设计研究，31文档链接与两设计状态/索引/计划核对通过；统一smoke目录/失败策略，实施责任已登记，本地提交收口。

## 意外与发现


此前25源码摘要与8纯逻辑控制已证审查事实，本轮不重跑它们。普通build也要求默认六平台资产，并在同一dist目录清理全部bundle；因此不可把所有Webview/Marketplace测试直接搬到无资产并行job。需要明确纯前端构建的隔离边界，或保留真实的资产依赖。clean checkout当前解出git archive，需要显式保留发布ref和独立native-set输入。

新设计还需处理GitHub needs整体失败：六load/archive齐全但单目标操作失败时，source/package构建可用always的严格load/producer guard继续收集，最终release仍失败；load缺失依然not-run。不能无条件always消费。设计model只核数据前提，未证明真实YAML接线。

图第一次mode参数用了architecture与flowchart输入冲突，改为flowchart后通过。showcase检查要求拆简图01过多弯折并去除无必要失败连接；不放宽构图预算。默认Python缺CairoSVG，复用已有/dev/shm/dsc-release-audit-renderer环境，没有安装项目依赖。

## 决策记录


2026-10-17：本轮按用户要求选定门禁设计，保持产品、实际workflow、仓库保护与发布材料不变。设计状态和实际实施/验收分开，未验证兼容性或渠道内容口径不得写成产品已支持。

2026-10-17：使用fireworks-tech-graph生成本地技术图，沿用白底蓝/绿/红/紫样式；分为验证依赖、包交接、渠道恢复，避免一个巨图掩盖输入边界。不部署、不创建独立文档PR。

2026-10-17：选定基础/功能/产物保守并集分类，未知路径触发产物，版本/契约不一致拒绝。release-pr与release-tag各自全量，channel-retry仅复用可核来源的原包/回执；新发布与选重验目标必须fresh，不复用历史verified覆盖本轮失败。

2026-10-17：保留发布六外层job，将六native与各层验证纳入reusable；development/source与clean production构建分别有目的，前端提取真实配置且独立输出。选有限六目标操作与三x64原样双包安装，最低宿主/arm64安装/真实TUI另列未验，新增范围实际通过后再切正式策略。

## 结果与复盘


设计已收口为已选定、未验证，中文文档/模型/迁移表/三视图交付。44项设计控制、70/8/10/22迁移及DAG、3SVG/PNG检查完成。后续实施和实际校准登记技术债，不由本设计关闭当前生产恢复竞态及PR327最终正式输入完整门禁；本轮未修改workflow/产品/远端设置。

## 上下文与定向


工作区为`/dev/shm/dsc-restricted-ready`，分支smoke-lifecycle-diagnostic-isolation。当前HEAD0abd89e80cc50711ff8a099030399c95d1837dfc，origin/main6e708c6b93ce4b2b343729c422f59099f4fb42ba；主工作区用户docs/WORKFLOW.md改动保持。既有PR327用于发布材料，关联根因/回归/门禁设计继续当前修复范围，不新增诊断/验证/文档PR。

现有`.github/workflows/release-preflight.yml`识别契约变更并调用六平台资产和`release:verify`，后者运行npm test与clean-checkout。`.github/workflows/publish-marketplace-release.yml`在最终tag再次verify，然后重新打包、发布两个渠道并汇总。`scripts/build/build.mjs`默认选六平台asset-set，打包与测试也间接调用它。`scripts/smoke/run-vscode-vsix-smoke.mjs`目前在测试前重打包及改manifest。新设计需明确消费式测试和原样安装两层。

`docs/design-docs/release-gate-layering-review.md`记录八环节问题，`docs/design-docs/smoke-scenario-boundaries.md`记录按目标分case与原19/8/3入口迁移，不重复诊断。机器可读输入将保存到`docs/references/release-gate-redesign/`；正式方案写`docs/design-docs/release-gate-redesign.md`，设计模型本身不接入CI。

## 工作计划与里程碑


第一里程碑完成真实依赖与方案：普通PR/发布PR/最终tag/原包恢复及诊断/观察辅助模式，15验证job和六发布job，各自输入/输出/范围/失败规则。70顶层命令及8Marketplace分支、10补充检查/22smoke入口有迁移目的地；逐条helper内部断言review留实施阶段，不由映射宣称已无损迁移。

第二里程碑完成Python标准库模型核对，44数据控制确认DAG/产物依赖、迁移范围、改SHA/包/范围/缺case失败、五阶段失败、历史回执复用边界和未知提交只查询。producerTrusted等值是假设已核外部来源的前提，不代表实现了GitHub来源查询。模型不是生产实现测试，不把正例称CI通过。

第三里程碑三独立视图已用技能render/check/export-png及实际查看完成，图01合并展示构建/Host阶段以控制弯折，详细job仍在设计表和model。索引/原则/技术债已同步，最终检查归档提交。实施任务仍需后续ExecPlan，旧完整门禁不删除。

## 具体步骤


在本工作区核对根package scripts、build选择、原生matrix和既有smoke coverage-map后，写入design-model.json、迁移清单及verify.py。运行`python3 docs/references/release-gate-redesign/verify.py`检查模型和文档；技术图JSON由本目录generate-diagrams.py生成，fireworks脚本绝对路径为`/home/users/ziyang01.wang-al/.codex/skills/fireworks-tech-graph/scripts/fireworks.py`。生成SVG和PNG后逐图查看，保存报告与输入hash。

已运行设计checker，输出jobs15/publishJobs6/mappings70/smokeRoutes22/controls44。三图check通过，PNG宽1800、高1460/1714/1800；diagram-validation.json保存hash、构图、尺寸和视觉查看。PNG命令在python前使用PYTHONPATH=/dev/shm/dsc-release-audit-renderer复用已有渲染器。此路径不是项目依赖或生产CI配置。

## 验证与验收


设计必须解释普通PR如何获得基础回归、发布PR和最终tag如何分别完整验证、同一tag如何发布验过的同批包、已有Release如何原包恢复、缺失/失败/错身份结果如何阻断。冻结smoke范围和两个版本的输入，不为并行或加缓存删掉既有保证。跨平台新增能力、最低VSCode和真实TUI完成证据必须标明未实测。

产物交付包括自包含设计、job/模式表、包及回执schema规则、迁移计划、三个可缩放流程图和静态/控制报告。脚本不触发真实CI、打包、网络渠道或产品测试；验收局限必须写入文档和最终答复。

## 幂等性与恢复


只新增或同步本轮设计资料。生成/校验可重复运行；输入变化时失败或明确更新研究输入，不篡改历史报告。用户主工作区dirty内容、PR327、版本、tag和远端设置不触及。已有release资产及历史gate保持。

## 证据与备注


本轮fetch完成main未变；初始HEAD完整SHA见上下文。此前layering-review保存25固定源码摘要，避免重复根因调查。最后补设计模型/迁移输入摘要、纯模型案例结果、图像检查与文档链接结果。

本轮inputs.json固定12源码/设计输入，verification.json与diagram-validation.json保存模型44项和三图检查。不运行产品、npm依赖安装或完整发布门禁；实际infra预算、固定版本组合、六PTY/三安装和渠道content身份仍未验证。

文档最终核对31链接、两设计frontmatter/索引/计划一致；scripts/gates与ci-validation.yml均未创建，主工作区仍只有用户WORKFLOW改动。smoke正式方案统一smoke-catalog.mjs与case首败/独立组继续策略，避免两设计接口分叉。切CI时再同步WORKFLOW，不能提前把新流程写成已实施。

## 接口与依赖


不新增产品依赖；Python/Node标准工具用于设计输入与控制，fireworks技能用于SVG/PNG。本轮未来接口用拟议路径显式登记，只有设计资料会实际创建；实现后的程序行为与发布验收另行验证。

本次建立（2026-10-17）：用户要求由审查推进为完整重设计，因此补自包含设计阶段计划及有界控制/图像验收，避免未落实job/回执细节直接开始修改CI。

本次更新（2026-10-17）：收口选定方案、完整迁移输入与44项控制，记录图校验/渲染前提，补整体job红灯与可用asset依赖区别；设计完成和实现未验证分开。

归档说明（2026-10-17）：本轮完整设计范围完成。下一阶段按正式方案四阶段建立实施ExecPlan，不由本研究归档宣布CI或产品已通过。
