# 合并 CI 范围的研究证据

本目录记录 2026-11-01 对 `main@ee4d367c8dd7cf310282a253758d4536b9d7051d` 的只读分析，支撑 [任务范围设计](../../design-docs/ci-validation-scope-policy.md)。不表示新分类器或复用门禁已经实现。

- `actions-summary.json`：GitHub REST API 的两轮 run/job 统计。代码 head `000757e9` 的 run `41226378995`，文档 head `66676236` 的 run `41229901129`，均为 attempt 1、277 jobs 成功。按真实 job 名称分组，不把 task 与 job 混用。
- `classification-summary.json`：在研究基线直接调用现有 `buildPlan` / `planJobs` 的结果。`pr350` 使用真实 base 到最终 head 的 Git diff；`docsFollowup` 仅使用两次 head 之间的增量，是对照输入，不是当时 workflow 实际计划；其余单路径输入为范围分类的受控样例。

GitHub 查询为 `GET /repos/ZY-WANG-0304/dev-session-canvas/actions/runs/{run_id}` 和分页 `GET .../actions/runs/{run_id}/jobs?per_page=100`。job 耗时取 `completed_at - started_at`，运行跨度取 run `updated_at - created_at`；后者为 API 观察跨度，前者累计不是账单或关键路径，也不是优化收益承诺。未改变 run 或触发测试重跑。

分类复现入口如下，在仓库根执行；Git 输出以 `--no-renames` 保留迁移前后的两个路径。`version` 仅提供当前模型必需字段，本研究没有伪造正式 plan/run 验收。

    node --input-type=module
    import { buildPlan, planJobs } from './scripts/gates/resolve-plan.mjs';
    import { execFileSync } from 'node:child_process';
    const base = 'aa18ec56c8a8a84ddc7cfd383ce4775cdbb4b020';
    const head = '6667623658c0bbfaa41c7e79476c675912929bc8';
    const changedPaths = execFileSync('git', ['diff', '--name-only', '--no-renames', base, head], { encoding: 'utf8' }).trim().split('\n');
    const plan = buildPlan({ mode: 'pr', inputSHA: head, headSHA: head, baseSHA: base, version: '0.27.0', changedPaths });
    const jobs = planJobs(plan);
    console.log(plan.scope, plan.tasks.length, Object.values(jobs).reduce((sum, job) => sum + job.include.length, 0));

真实结果为 functional=true、artifact=true、release=false，362 tasks、273 业务矩阵 jobs。加上 preflight 外层 resolve-input / verify-release-contract 和 reusable resolve / verify-result 四个控制 jobs，得到实际 277。仅将 changedPaths 换成文档增量时为 90 tasks、8 业务 jobs；因此“原来纯文档就只跑静态检查”并不成立。

另外人工核对了 `scripts/gates/smoke-implementation.mjs`、`scripts/test/test-theme-color-tokens.mjs`、`scripts/test/test-canvas-templates.mjs` 的文档输入，以及 `scripts/build/build-execution-distribution-assets.mjs` 与 `scripts/release/package-vsix.mjs` 对 SHA 的使用。已发现消费者并非完整依赖审计；设计不据此宣称所有 docs 路径都能排除。
