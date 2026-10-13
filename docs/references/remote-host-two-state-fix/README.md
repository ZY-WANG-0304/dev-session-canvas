# SSH Host 双状态正式修复验证

这是已批准正式修复的验证输入，结论在 `docs/design-docs/remote-host-exit-investigation.md`；先前调查与研究证据分别保留，不能相互覆盖。只导出身份、控制、业务、清理和日志 hash，不提交 SSH 密钥、完整环境或 VS Code 安装载荷。

## 输入与执行

修复从 main `ea0c9b194fda1f13098cfd7ad4a3e13c4ec5233b` 建立 `smoke-remote-host-two-state-fix`，正式实现提交 `9daf7054`；后续 `dfa7398c`/`b4210dc3` 仅改控制回归。Node22.23.3、Linux localhost、VS Code1.141.0 commit `2a59476c9bfcb90b3ddc372c36762471b7dfad1c`、Remote SSH0.128.0，构建资产 `/tmp/dsc-release-026-assets`。stock workbench SHA256 `631c1d79c4f3af9177ca23a70cfe0cf2586a692678bd897af6c869324160d905`，本轮不修改上游缓存。

在 `/tmp/dscsshdiag` 运行 `npm run test:smoke-remote-host`、`npm run test:smoke-terminal-resize`、主扩展与 notifier 构建，然后运行：

    PATH=/tmp/dsc-release-node22/node_modules/node/bin:$PATH \
    DEV_SESSION_CANVAS_EXECUTION_ASSETS_SET=/tmp/dsc-release-026-assets \
    DEV_SESSION_CANVAS_VSCODE_TEST_CACHE_PATH=/tmp/dsc0261v/.vscode-test \
    DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=remote-ssh-real-reopen \
    DEV_SESSION_CANVAS_SMOKE_DEBUG_ROOT=/tmp/dscsshfix-native-2 \
    node scripts/smoke/run-vscode-smoke.mjs

聚合入口串行跑 exit/retain，各用独立 fixture。正式 runner 保持 setup 未返回，再只终止本次本地客户端，确认旧远端 Host 保留；exit 只结束严核身份的旧 Host，retain 不发送 Host 信号。释放私有完成文件后验收离开期间输出/完成，再启动 verify。

## 已执行结果

控制回归17项通过；既有 resize helper 9项通过；主扩展与 notifier 构建通过。native-1在本地客户端作用域检查误拒绝，因为Electron会重写运行中argv，尚未发送受控信号；错误和清理工件保留。修复使用真实spawnargs、/proc/exe及启动时PID/startTicks，并增加实际argv重写子进程回归。

native-2聚合退出码0，两分支全部通过。exit：Host2078814/startTicks249666082消失，Supervisor2084887/startTicks249666754保留。retain：Host2189996/startTicks249677312在verify-ready和business-complete均为原身份S，Supervisor2194887/startTicks249677811保留。两分支原session/storage恢复、离开期间输出、后续输入、第三终态/snapshot-only/historyDiscarded全部通过，真实尺寸Agent67×21→82×27、Terminal64×20→85×28，最后fixture cleanup.pass=true。

JSON导出保留原字段，并添加 `sourceArtifact`/`sourceSha256`。native-2原业务工件含重复resize样本；保持原证据格式，不把其当最终实现输出格式。成功fixture的重复安装载荷已在确认cleanup后回收，原数据、日志和工件保留；本地清理记录 `/tmp/dscsshfix-success-payload-cleanup.json`。

## 完整发布验证

在独立短路径 `/tmp/sf26` 生成本地临时预合并 `7d33f6648a86990ad240a42488211d04f60e135e`：修复9daf7054 + 发布准备PR327的7b2440d4。runner与业务实现和修复当前head相同，控制回归后续两提交由上述17项独立验证；这不是已合入main的发布输入，不打tag或发布。

静态preflight通过。完整verify曾因依赖复用缺Drizzle、长目录Unix socket EINVAL、移动目录Vite缓存旧路径、Marketplace host临时根过长而提前失败；改为短路径实际npm ci并使用现有host临时根环境覆盖。随后重复Chromium下载过慢，停止该下载，复制已有匹配Chromium v1217/headless v1217/ffmpeg v1011缓存；浏览器二进制SHA256 `696170a79640ec5b50c7518140ace06c69a49cfb295bf527d4a85e26a12b89a7`。环境调整不放宽断言、不过滤场景。第一次失败日志与各次日志hash见 `run-log-receipts.json`。

最终运行日志 `/tmp/dscsshfix-full-verify-cached.log`，debug根 `/tmp/fs27`。完整verify退出码0：全部npm test（含source smoke两条SSH分支和426项Webview）、隔离clean-checkout实际npm ci/生产VSIX打包/安装后八场景smoke均通过，临时checkout按原门禁清理。结果与完整日志SHA见 `full-release-verification.json`。命令：

    PATH=/tmp/dsc-release-node22/node_modules/node/bin:$PATH \
    DEV_SESSION_CANVAS_EXECUTION_ASSETS_SET=/tmp/dsc-release-026-assets \
    DEV_SESSION_CANVAS_VSCODE_TEST_CACHE_PATH=/tmp/dsc0261v/.vscode-test \
    DEV_SESSION_CANVAS_SMOKE_DEBUG_ROOT=/tmp/fs27 \
    DEV_SESSION_CANVAS_TEMPLATE_MARKETPLACE_VSCODE_E2E_HOST_TMP_ROOT=/tmp/sfmpt \
    TMPDIR=/tmp npm run release:verify -- --version 0.26.1

## 结论边界

native-2后补入本地后代退出确认、setup未提前输出断言和ready轮询取消，已在最终source smoke两分支通过。exit旧Host238831/startTicks249892848消失、Supervisor244567/startTicks249893355保留；retain旧Host351737/startTicks249904154在verify-ready为S、business-complete为R，Supervisor357698/startTicks249904671保留；各新Host身份另行记录。两分支原会话、输出/输入、Agent82×27/Terminal85×28与cleanup.pass=true共同成立。最终六份控制/业务/清理工件为 `full-{exit,retain}-remote-host-*.json`。共享单root、多root、root切换、双窗口、systemd/fallback回归全部通过。所有预算保持，原Host保留是明确验证前提。只覆盖本固定版本Linux localhost；具体退出消息丢失层、真实网络与其他平台、原Host复用和显式重复start拒绝仍需独立证据。本次验证的临时预合并输入完整通过；正式修复合入后，PR327仍须基于最新main和发布准备head重建预合并结果，再按发布工作流执行完整门禁。当前通过不授权合并、打tag或发布。

完整日志hash与先前环境失败分别保留；`environment-attempts.json`提供聚焦错误摘录，payload-cleanup记录只包含本轮已通过并结束的fixture重复安装载荷，未删除原首败。stock缓存在最终验证后SHA再次匹配。
