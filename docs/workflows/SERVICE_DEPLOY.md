# SERVICE_DEPLOY

这个文件定义模板市场生产服务部署流程。它只覆盖 `apps/template-marketplace/` 的 Cloudflare Worker API、浏览器 SPA、D1/R2 访问逻辑和生产部署验证；VSCode 插件对外发布仍按 `docs/workflows/VERSION.md` 与公开发布手册执行。

## 核心原则

- 生产服务部署版本与插件版本分离。插件使用 SemVer，例如 `0.19.0`；生产服务使用独立不可变 deploy tag，例如 `deploy/template-marketplace/prod/2026-06-27.1`。
- deploy tag 固定一次生产部署的源码输入，不等同于线上已经成功运行。线上真实版本必须结合 git sha、Cloudflare deployment id、deployment manifest、`/api/v1/meta` 和 production smoke 判断。
- API 兼容性由 `/api/v1`、capability、`minSupportedExtensionVersion` 与 `recommendedExtensionVersion` 管理，不随每次服务部署改变。
- 模板内容版本由 `template_versions` 管理，README / 标签 / 截图等展示变更由 `listing_revisions` 管理；普通内容治理或用户发布不创建服务 deploy tag。
- deploy tag 不使用 `prod`、`latest`、`stable` 等可变名称，也不复用插件 `vX.Y.Z` tag。

## Tag 命名

生产服务部署 tag 使用：

```text
deploy/template-marketplace/prod/YYYY-MM-DD.N
```

示例：

```text
deploy/template-marketplace/prod/2026-06-27.1
deploy/template-marketplace/prod/2026-06-27.2
```

如果后续需要 staging / preview 的同类部署触发，可使用相同结构：

```text
deploy/template-marketplace/preview/YYYY-MM-DD.N
deploy/template-marketplace/staging/YYYY-MM-DD.N
```

## 何时部署服务

只改生产服务时，打服务 deploy tag，不提升插件版本：

- Worker API bugfix、鉴权修复、治理后台修复、统计修正。
- 浏览器市场 SPA 调整。
- 向后兼容的 API 字段或 endpoint 新增。
- 生产配置、Cloudflare route、D1 migration 或 R2 访问逻辑调整。

只改插件时，走插件发布流程，不打服务 deploy tag：

- Extension Host 安装、更新、回滚或 sidecar 写入逻辑变化。
- 插件内 Webview UI、命令、配置、manifest 或依赖变化。
- 新插件 capability 的声明或本地行为变化。

服务和插件共同参与的新能力默认顺序是：先部署向后兼容的服务，再发布声明 capability 的插件，最后由服务按插件版本 / capability 放量。破坏性 API 变化不得直接改坏 `/api/v1`，必须新增 `/api/v2` 或显式提升最低支持插件版本，并保留旧插件的可解释降级路径。

## 部署前检查

在创建生产 deploy tag 前，确认目标 commit 已合入 `main`，并至少完成：

```bash
npm ci
npm run test:marketplace
npm run test:marketplace-production-config
```

如果本次包含 D1 migration，应确认 migration 是向后兼容的 expand / migrate / contract 路线：先加字段、表或索引，再部署兼容代码，最后在旧服务和旧插件退出支持窗口后才删除旧字段或旧路径。

## 部署执行

从最新 `main` 选择目标 commit 后创建并推送 deploy tag：

```bash
git tag deploy/template-marketplace/prod/YYYY-MM-DD.N <sha>
git push origin deploy/template-marketplace/prod/YYYY-MM-DD.N
```

生产部署 workflow 或人工 runbook 应执行：

1. checkout deploy tag 对应 commit。
2. 安装依赖并运行市场测试与 production config 检查。
3. 必要时执行 production D1 migration。
4. 执行 `npm run deploy:marketplace:production`。
5. 执行 production smoke。
6. 生成 deployment manifest。

## Deployment Manifest

每次生产部署都应记录 deployment manifest，至少包含：

```json
{
  "service": "template-marketplace",
  "environment": "production",
  "deployTag": "deploy/template-marketplace/prod/2026-06-27.1",
  "gitSha": "abcdef123",
  "cloudflareDeploymentId": "deployment-id",
  "apiVersion": "v1",
  "minSupportedExtensionVersion": "0.18.0",
  "recommendedExtensionVersion": "0.19.0",
  "migrations": ["0001_marketplace_core.sql"],
  "smoke": "passed",
  "rollbackTarget": "deploy/template-marketplace/prod/2026-06-26.1"
}
```

不要把 manifest 中的 secret、OAuth client secret、session secret、token secret 或管理员 bootstrap secret 写入仓库。

## Production Smoke

生产 smoke 至少覆盖：

- `GET /api/v1/meta` 返回当前 `serviceBuild`、`gitSha`、`apiVersion`、最低支持插件版本和推荐插件版本。
- `GET /api/v1/templates` 返回生产 D1/R2 事实；无生产数据时应是空目录，不回退到代码内 seed。
- 模板详情、缩略图和完整包下载路径正常。
- 浏览器 SPA 的 `/templates` 与 `/templates/:slug` route 正常。
- 登录、发布、举报和治理入口在有测试账号 / 管理员条件时按权限返回。

如果 smoke 失败，应保留 deploy tag 和失败记录，并按 manifest 中的 rollback target 或 Cloudflare 平台能力回滚；不要通过移动 tag 隐藏失败历史。

## 与插件发布的关系

插件发布继续按 `docs/workflows/VERSION.md`、`docs/public-preview-release-playbook.md` 和现有 Marketplace / Open VSX 流程执行。服务 deploy tag 不更新 `package.json`、`package-lock.json`、`CHANGELOG.md` 或 Marketplace listing；插件发布 tag 不自动部署生产服务。

当服务要求更高插件版本时，必须先通过 `/api/v1/meta`、release notes 或产品文档说明 `minSupportedExtensionVersion` / `recommendedExtensionVersion` 变化，并确保旧插件有明确降级提示，而不是在旧插件中表现为未知错误。
