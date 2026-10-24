# Smoke 之外的发布门禁分层审查证据

正式的审查判断与推荐方案见[发布门禁分层与产物证据审查](../../../design-docs/release-gate-layering-review.md)。本目录是输入与受控核对资料，不是产品或发布结论。

- [inputs.json](inputs.json)：研究 SHA、主线 SHA、25源码摘要、两处主线差异与带时间的 GitHub 保护只读观察。
- [verify.py](verify.py)：只读核对源码，递归跟踪根 npm run 调用，并直接提取现有 finalize inline Node 与 marketplace verifier 做隔离数据验证。
- [verification.json](verification.json)：命令顺序、脚本接线范围、构建路径、提取代码摘要和8项控制结果。

在仓库根执行：

```sh
python3 docs/references/release-gate-flow-audit/layering-review/verify.py
```

只需 Python 标准库及 PATH 上的 Node，不需要 npm install。脚本核对固定25份输入摘要，不一致立即失败；提取现有纯逻辑在10秒上限的 Node 子进程运行，marketplace 查询用明确 stub 替代。没有 import 发布入口，也不调用网络、gh、打包、tag 或渠道操作。临时目录自动删除，输出报告保留于本目录。

预期核对25份输入、70条顶层命令、5项 finalize 案例、3项 verifier 案例。报告的 `releaseComplete=true` 是现有逻辑对样本的结果，不是实际 release 已完成。

| 控制输入 | 现有代码结果 | 能证明的边界 |
| --- | --- | --- |
| 匹配 partial，Open VSX 两包 verified | 完成，VS deferred | 正例，符合当前渠道策略 |
| partial 的 releaseRef 错误 | 完成 | merge 边界不拒绝错 ref |
| partial 的 artifact hash 错误 | 完成 | merge 边界不拒绝错包摘要 |
| 没有 partial，base 保存历史 verified | 完成 | 历史状态足以完成，未区分本轮结果缺失 |
| 没有 partial，也无历史 verified | 失败 | 无成功状态不会凭空完成 |
| previous verified，本轮 query=false | 查询1次，返回成功 | 本轮 false 被历史状态覆盖 |
| previous pending，本轮 query=false | 查询1次，返回失败 | 非历史成功正常失败 |
| previous pending，本轮 query=true | 查询1次，返回成功并 verified | 查询成功的正例 |

限制：这些样本没有执行前面的同 run artifact 下载、ref/包 guard、发布 job 或远端服务，不能证明实际 pipeline 曾混用结果。历史复用可能有合理目的，但需要明确证据身份和复用策略。静态 script 可达性只跟踪根 npm run，不等于函数或代码覆盖；一些未接线脚本在其他 workflow/测试中存在覆盖。构建路径只说明当前重打与选择方式，不证明包 bytes 实际不同，也未测量耗时。
