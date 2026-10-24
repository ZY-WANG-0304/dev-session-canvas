# Webview 本地 CJK 字体补齐

## 输入与范围

基础提交 `d6646b38c188a441cbf68eadd61e7e5244c8e002`。Ubuntu22.04.5、Node22.23.3、Playwright1.59.1/Chromium1217，使用当前已有 Webview dist；产品源码未改。此次本地验证不签发正式 CI acceptance，不代证最新提交的全平台门禁。

原字体夹具只在基线截图测试加载，38个字符不足以覆盖中文布局用例。本轮将其扩展到465个字符、149788字节，共用 Linux `openHarness`/主题切换加载。原38个字形的轮廓和advance width逐一相同；最终WOFF摘要为 `493f33ce839f7352c9578abb82eb85ddf48d6af47e8bb4af3d58611c45af9cd4`。生成时保留源字体时间戳，两次独立生成的WOFF和provenance字节完全相同。

## 对照与边界

- `before.log.gz`：旧代码、仅DejaVu/Liberation字体，原三个失败用例中软换行及分组标题两项复现失败，根工作区标题通过。不能声称本机复现了三个原CI首败。
- `after.log.gz`：初版替代字体、同一Latin限制，原三个功能用例全通过；截图因该配置同时改变其他系统字体回退而失败，保留该失败。
- `normal.log.gz`：初版替代字体在原系统配置下，原截图基线严格通过。
- `no-cjk-visual.log.gz`：保留系统默认字体配置，仅排除Noto CJK、WenQuanYi、Unifont和日文字体，`fc-list :lang=zh`为空，原截图基线严格通过。完整回归使用此`no-cjk.conf`。
- `full.log.gz`：中途发现生成工具改写字体时间戳；为保证最终输入可复现，主动中断初版回归，211通过、1中断、222未运行，不作为完整通过。
- `final-contracts.log.gz`：最终字体的加载、主题覆盖后恢复、新文档重新加载及无字体HTTP请求通过；损坏WOFF、字符清单摘要错误、添加未覆盖汉字三个反例均被拒绝。`contracts.mjs`保存原执行脚本和本地路径，仅作本轮诊断，不注册额外产品用例。

最终 `final.log.gz`：完整434项全部通过，零失败、零跳过、零重试，耗时7.6分钟；原三项失败用例和三项视觉测试均通过。原登记434个ID与catalog完全相同。摘要及最终实现文件SHA256见`validation.json`。没有修改PNG基线、业务断言、字体安装workflow或原预算。该修正只覆盖Webview harness；Host notifier-locale下载VSCode时的ECONNRESET不属于本次字体修正。

## 命令与证据

工作目录 `/tmp/dsc335-deps`。令`FONTCONFIG_FILE=/tmp/dsc335-woff-evidence/no-cjk.conf`，使用上述Node运行 `node_modules/playwright/cli.js test --config=playwright.config.mjs --workers=2 --retries=0 --update-snapshots=none --output=/tmp/dsc335-woff-evidence/final`。

对照配置和加载反例脚本随本文保存。控制台日志gzip保留原字节，`logs.json`登记原日志和gzip摘要；截图失败工件在`/tmp/dsc335-woff-evidence`保留。测试只读仓库WOFF，维护时的TTC源文件通过原始SHA256校验，无网络字体下载。
