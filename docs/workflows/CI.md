# 合并 CI 与稳定性观察

普通 PR 和 main 使用 `release-preflight.yml`；稳定性观察使用独立的 `ci-observations.yml`，不进入 `Verify release contract` 的等待链。发布准备与最终构建继续完整验收。方案及证据见 [设计](../design-docs/ci-validation-scope-policy.md)。

## 合并门禁

每个新 head 都由控制 job 核对真实 base/head 预合并输入，检查变更文档，再选择以下一种路径：

| 路径 | 行为 |
| --- | --- |
| documentation | 普通内部文档只跑输入/文档检查和最终 verifier，2 个 Linux jobs，不安装 workspace 依赖 |
| reuse | 同 PR、同 base 的文档追加，独立核验原成功 acceptance 和有效输入等价；引用原运行，重新签发当前 head 的合并结论 |
| execute | 运行模块所需任务及其依赖；最终 verifier 独立验证实际 producer/回执 |

分类读取整个 PR diff。只有已审计的普通文本路径可走轻量路径；测试消费的文档、包内物料、未知路径、符号链接和策略变化不能冒充纯文档。文档检查核对链接、设计 frontmatter/索引、related 文档和删除后的引用。同一文档的所有直接消费者都须选中，例如 `docs/UI.md` 同时触发主题颜色与侧栏列表颜色合同。

复用仅引用 24 小时内的原始成功运行，不递归引用复用记录。目标分支、有效文件及模式、测试/依赖/策略、目录/预算/环境摘要或 task 集合变化都使复用失效；原运行失败、取消、缺少/过期/篡改工件时回退 execute。原回执和 VSIX 不改写 SHA，合并复用不等于新 SHA 的发布包已验收。

当前 PR 修改 `scripts/gates/` 或三个合并/观察 workflow 时，首次使用完整执行路径，不能用自己修改的选测或降级策略减项。完整运行已成功、随后仅补普通文档时，可以复用该次完整结果，仍要求相同策略、相同完整任务集合及相同有效输入。新策略合入目标分支后，后续 PR 才采用其模块选测。

## 模块范围

范围由 `scripts/gates/scope-policy.mjs` 定义，任务选择后按 `catalog.mjs::jobDependencies` 补齐依赖。

| 输入 | 当前执行范围 |
| --- | --- |
| 普通内部文档 | 轻量门禁；被合同读取的文档单独运行对应 regression |
| 市场应用源码 | 市场合同、类型、浏览器与两个市场 Host；保留所需 source-build 和六平台 native 输入 |
| 市场共享协议 | 追加插件模板消费者、Webview 与原样安装 |
| notifier 源码 | 通知/协议/本地化及跨模块主题合同、通知 Host、Webview 与原样安装 |
| 插件源码、共享 attention 协议、全局样式 | 插件回归、浏览器、源码/打包 Host 与市场 Host 消费者；市场独立网页浏览器可省略 |
| 包内文案、图片与 listing | 物料合同、同批打包/文件清单、三平台原样安装 |
| 门禁、workflow、锁文件、构建脚本、未知路径 | 完整任务范围 |

全局 CSS 能影响设置、终端和 Runtime 界面，不按用例名字排除它们。源码和 VSIX 构建都要求同批六平台 native 输入，所以选择这些构建时仍保留六个平台；不能只关闭平台 matrix。

## 非阻塞观察

策略表 `scripts/gates/observation-policy.json` 当前登记 3 个具名历史问题：packaged `surface-continuity/live-page-remount` 的 Host 准备、source `multi-root-real-reopen` 与 `systemd-user-real-reopen` 的第二 Host ready。各项保留原始 run、负责人（repository-maintainers）、复核日期及技术债入口；不宣称根因已确认。

观察在相关 PR 更新或每日 main 定时运行，继续使用原测试和断言。单独的 check/report 显示 passed、failed、not-run、未匹配旧特征的 needs-triage，以及最近最多 20 个工作流运行中可获得的首轮样本。重试通过不删除首败；历史不可取时明确显示不完整。原始日志和报告工件保留，报告保留 30 天。

已登记低概率产品缺陷也可按用户决定先合入、后续专门修复；报告仍如实记录未修缺陷。新失败范围须单独归类，不能设置整个共享分片 continue-on-error。观察尚未结束时允许合并，其后发现的问题继续跟踪，不冒称合并前已经验证。

正式 release-pr/release-tag 不排除这三项，观察计划不签发发布 acceptance。普通 PR 的非阻塞归类不会自动改变正式发布要求。

## 验证与维护

使用 `node --test scripts/test/test-ci-scope.mjs` 验证分类、依赖、输入等价、旧来源失效和观察统计；`npm run test:ci-gates` 验证与原门禁/发布回执兼容。修改作用域或观察策略需更新设计、测试和技术债记录。
