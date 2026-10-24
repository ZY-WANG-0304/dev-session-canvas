# VSCode 下载恢复的本地受控验证

输入：840b06b2，Node22.23.3。以 NODE_OPTIONS 的临时 ESM loader 仅替换单次 worker 的 @vscode/test-electron 导出；实际父进程、worker、异常捕获、结果回执及进程组清理均使用仓库实现。mock 产生未处理的 ECONNRESET rejection 和持续运行的子进程，不访问外部服务。

四组结果：recover 首次断流、清理后第二次成功；reset 持续断流三次后失败；semantic 校验错误一次后失败；unrecorded 无回执退出一次后失败。原失败均保留，所有被观察失败 worker 的 cleanup 为 passed。脚本中 /tmp 路径记录原执行位置；不注册为产品用例，不代表真实网络断流或跨平台验收。

命令：`NODE_OPTIONS=--experimental-loader=/tmp/dsc335-worker-reverify/loader.mjs /tmp/pr335-npm-retry-dh_gey74/node-v22.23.3-linux-x64/bin/node /tmp/dsc335-worker-reverify/probe.mjs`。控制台与逐次回执随本文留存。真实 Actions 和缓存命中由最终 head 单独验收。
