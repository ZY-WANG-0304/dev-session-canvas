# 插件与市场依赖安装范围的验证证据

## 输入与结果

原始故障输入为预合并 `9d741c68ca4a90fbba186a7d565132772e9c55c3`（PR335 head `0d29481a`）。本次实施在同 head 的隔离分支进行，Node22.23.3/npm10.9.9。

| 实际运行 | 结果 | 边界 |
| --- | --- | --- |
| 原根全量 npm ci / 全新缓存 | 600秒超时，含清理605秒；workerd-linux-64下载未完成 | 无ECONNRESET；不追认原CI包名 |
| plugin profile / 全新缓存 | 43.469秒、602 packages、exit0 | HTTP日志和安装树均无Wrangler/Miniflare/workerd；安装钩子、esbuild/Rollup/node-pty保留 |
| marketplace profile / 复用plugin缓存 | 13.272秒、639 packages、exit0 | 服务tarball实际下载，workerd/Miniflare/Wrangler均存在；不是全冷安装 |
| 主插件/notifier类型、开发及生产构建、双VSIX打包、主Webview+市场SPA独立生产构建 | 通过 | 六原生资产复用先前PR335本地dist原字节，不是新输入六平台重建 |
| Terminal输入输出、Agent输入输出、真实resize、notifier、市场Host、市场local-preview Host | 六项通过 | 真实VS Code1.142.0；Linux；插件profile安装环境 |
| 市场浏览器E2E | 通过 | 插件profile，真实Chromium1217，API请求使用既有拦截夹具 |
| 市场API/Web/共享及类型 | 99/45/28与类型通过 | marketplace profile；API为Node/Hono+fake D1/R2，不宣称真实Worker服务验收 |
| 市场生产配置、部署workflow合同、preview preflight | 三项通过 | 只验证现有合同，没有部署 |
| 完整CI/发布合同 | 初次121/121 | 此后仅细化matrix按实际task派生profile，最终定向9/9及安装合同3/3通过 |
| 四正式workflow actionlint、两发布workflow脚本合同 | 通过 | 最终新输入完整Actions验收独立记录 |

两次安装耗时是各自现场观察，不作为排除网络差异的性能对照。`validation.json` 记录实现文件摘要、各日志原路径/摘要和验收局限。`task-scope-comparison.json` 按对象逐项比较原目录：基础89项、完整普通PR353项、release353项均一致；无更改任务ID、variant、required、步骤、smoke预算或断言。

## 日志留存

`original-local-attempt/`、`plugin/`、`marketplace/` 保存安装结果、进程回执、控制台及npm debug。日志使用确定性gzip保留原字节；`log-archives.json` 同时列压缩和解压SHA256。可用 `gzip -dc plugin/npm-debug.log.gz` 查看原debug记录。原始目录 `/tmp/pr335-npm-retry-dh_gey74/evidence` 保留不动。

原CI39313391100的source-host安装14秒ECONNRESET没有npm debug/包名；本次修改只能消除无关服务依赖耦合，不能证明已修复其网络根因。

## 可复现命令

在仓库根使用固定Node22.23.3，先新建空cache与证据目录，将npm cache、userconfig/globalconfig设为隔离路径，执行：

```sh
node scripts/gates/run-infrastructure.mjs --kind install --profile plugin --output /tmp/fresh-plugin-evidence -- npm ci --no-audit --no-fund
node scripts/gates/run-infrastructure.mjs --kind install --profile marketplace --output /tmp/fresh-marketplace-evidence -- npm ci --no-audit --no-fund
npm run test:ci-gates
npm run typecheck
npm run typecheck:notifier
npm run typecheck:marketplace
npm run test:marketplace-shared
npm run test:marketplace-api
npm run test:marketplace-web
```

两种安装应使用不同checkout，避免后一次npm ci覆盖插件无服务依赖的观察前提。具体Host及打包调用见 `host-tests.json`、`package-tests.json`；Terminal单项为 `node scripts/smoke/run-vscode-smoke.mjs --scenario execution-io/terminal-line --diagnostic`，浏览器使用 `DEV_SESSION_CANVAS_MARKETPLACE_BROWSER_ASSETS=/tmp/dsc335-browser/marketplace node scripts/test/test-template-marketplace-publish-page.mjs`。
