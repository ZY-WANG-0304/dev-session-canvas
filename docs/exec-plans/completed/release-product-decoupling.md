# 分离产品构建验收与原包交付

本 ExecPlan 按 `docs/PLANS.md` 维护。工作目录为 `/tmp/dev-session-canvas-release-decoupling`，分支 `docs-release-product-decoupling`，继续在现有 PR #350 收口设计与实现。

## 目标与全局图景

操作者先从 main 启动构建验收，明确指定已合入 main 的产品 SHA 和版本；完整验收成功后得到带来源证明的固定双 VSIX 批次。随后从 main 启动独立发布，传入该批次与版本。修复发布工具并合入 main 后，以同一批次启动新发布即可继续，不改变产品 SHA、包字节或已有版本 tag。本任务不实际发布新版本、不变更 VSM 暂停策略，也不合并 PR。

## 进度

- [x] (2026-11-01) 核对 main aa18ec56、PR #350 和当前交付/恢复实现，确认首次发布仍绑定产品 tag。
- [x] (2026-11-01) 实现独立构建验收 workflow、固定批次封装与产品 CHANGELOG 来源，保留完整任务图。
- [x] (2026-11-01) 实现 main 上的批次发布与首次中断恢复，保留历史完整 Release 的渠道重试。
- [x] (2026-11-01) 新批次 24 项覆盖及 gate/历史恢复共 142/142、旧交付/完成 38/38 通过；发布 CLI、市场渠道和 workflow 合同通过，四 workflow actionlint 通过（未启用 shellcheck）。
- [x] (2026-11-01) 同步发布手册、设计、工作流与长期来源归档技术债。
- [x] (2026-11-01) PR #350 代码提交 `000757e92fbac6d1a82cc7ea78c623b3e549fb48` 的完整 CI run `41226378995`（attempt 1）277/277 jobs 成功，包括必需检查 `Verify release contract`。
- [x] (2026-11-01) 登记历史临时 tag 状态文案技术债，同步设计和索引，归档实施计划；后续文档提交的检查状态以对应 GitHub head 为准。

## 意外与发现

当前 `release-tag` 计划要求存在 publish tag；独立构建在隔离 checkout 建立指向显式产品 SHA 的本地验证引用，已有冲突则拒绝，不推送该引用。这样可复用旧产品的原任务图而无需先修改产品代码。原 `original-release-context.json` 含运行身份，若每次发布重新生成会改变已上传字节；新流程必须在构建批次内固定它。现有产物与状态来源通过 Actions 实际 job/artifact 校验，不能只信任下载的 JSON。

## 决策记录

2026-11-01：采用用户批准的同仓库两条流水线。新增 `build-release-batch.yml`，产品输入仍在隔离 checkout 中完成原完整 `release-tag` 验收；`publish-marketplace-release.yml` 仅从 main 手动触发，交付不构建产品。首次发布与无状态根的中断续传共用固定批次；已有状态链时仍执行验证后的 channel-retry。历史已完成 Release 无批次输入时保留原包恢复入口。批次通过 run ID、attempt、真实 seal job、artifact ID/digest 和产品身份绑定，拒绝 PR/未完成/失败/过期来源。Actions 工件保留期设为 90 天；长期历史恢复仍受既有来源证据保留限制，过期时明确失败，不重建冒充原包。

## 结果与复盘

两条流水线、来源验证、批次跨工具续传、产品文案冻结及旧验收目录兼容已实现。受控远端回归、原门禁合同及代码提交 `000757e9` 的完整 GitHub PR CI 已通过，实施计划完成。未执行合并后从 main dispatch 的真实构建/市场交付，未发布新版本或变更任何市场资产；该实际首次使用边界不由 PR CI 替代。长期恢复超出 90 天证据保留期的限制、历史临时 tag 状态文案问题均已登记到 `docs/exec-plans/tech-debt-tracker.md`。文档收口后新增提交的必需检查仍按该提交单独核验，不将本次代码 CI 冒充后续 head 的结果。

## 上下文与定向

`.github/workflows/ci-validation.yml` 为完整产品任务图，逐 job checkout 指定 input_sha。`scripts/gates/check-acceptance.mjs` 校验实际验收回执。`scripts/release/release-delivery.mjs` 负责固定资产和恢复；`release-completion.mjs` 定义上下文和身份；`release-state.mjs` 保存因果状态链。新增 `scripts/release/release-batch.mjs` 封装/验证批次及 CLI，避免复制原包校验与上传实现。

## 工作计划与里程碑

里程碑一：实现 main dispatch 产品输入解析与批次封装。只读 Git/Actions，完整验收后在 seal job 保存原双包及回执。验收标准是能独立核对来源且构建不创建 Release/tag 或写渠道。

里程碑二：交付入口接受固定批次，所有交付 job checkout 本次工具 SHA。版本、产品 SHA、原始上下文与双包从批次读取，不从工具工作树包版本推导。新发布、中断续传和既有状态重试分别验证远端状态，使用相同原字节。最终 tag 指向产品 SHA。

里程碑三：受控测试让产品 SHA 与工具 SHA 不同，工具工作树版本不同，连续两次交付跨工具更新与上传中断；篡改包、错误 producer、错误版本、PR 来源和状态冲突必须被拒绝。同步文档并更新现有 PR。

## 具体步骤

在工作目录读写上述文件，先执行 `node --test --test-concurrency=1 scripts/test/test-release-batch.mjs`；再执行相关 release/gate 合同，使用项目可用 Node 与锁定依赖。每轮失败按具体输入定位，保持已有产品断言与预算。提交前执行 `git diff --check`、workflow YAML/actionlint 检查，fetch/rebase origin/main，更新 PR #350 标题和正文为最终实现范围。

## 验证与验收

验证必须证明：构建读取 R 而工具执行 T；B 中双包前后摘要相同；交付 workflow 不调用完整构建；首次失败后 T2 可继续 B；错误批次在写入前拒绝；历史完整 Release 可以按原包补渠道；VSM 无调用。受控远端不等于真实市场发布，PR CI 和实际首次使用的边界如实记录。

## 幂等性与恢复

独立 worktree 保留原工作区未跟踪文件。远端只推送主题分支与更新 PR，不移动产品 tag、不上传 Release 资产。测试使用临时目录与受控远端。已有同名不同字节资产继续拒绝覆盖；可恢复状态从固定 batch 或已验证的原 Release 取得。

## 证据与备注

原发布失败与恢复证据见 `docs/design-docs/release-gate-redesign.md`；新原则见 `docs/design-docs/release-product-decoupling.md`。本轮 Node v25.6.0：`/tmp/dsc-decoupling-contracts.log` 142/142、`/tmp/dsc-decoupling-existing-tests.log` 38/38；`/tmp/dsc-decoupling-marketplace.log`、发布 CLI 和 workflow 合同通过。actionlint v1.7.12 对 build/publish/release-validation/ci-validation 四文件通过；实际本地 Git ref 绑定脚本的成功、幂等及冲突拒绝由 workflow 合同实跑。

## 接口与依赖

复用 GitHub Actions workflow_dispatch、upload-artifact/download-artifact、现有 githubClient 与来源校验。批次由实际成功的 build workflow run/attempt 和 seal artifact 唯一标识；内容至少包含双 VSIX、package receipt、plan/result/provenance/acceptance、release identity 和固定 original release context。不引入工具版本号或新服务。

修订记录：2026-11-01 创建实施计划，落实用户批准的两条流水线并限定原包交付和兼容边界。

修订记录：2026-11-01 完成实现与本地验证，加入产品文案和历史目录边界，待最新 PR CI。

修订记录：2026-11-01 根据独立 review 与已完成的完整 PR CI 收口验证记录，登记非阻塞历史问题并将计划移入 completed；不修改发布实现。
