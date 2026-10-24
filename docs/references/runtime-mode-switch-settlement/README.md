# 模式切换结算修复证据

[result.json](result.json) 保留 ae5414c2 初版修复的输入、代码与测试摘要、同字节生产 bundle、命令退出码、日志 hash 和关键观察。[followup.json](followup.json) 记录初轮等待错误传播反例、后续修复和最终代码验证。`acceptance: false` 表示本地诊断不能替代正式 Actions 或发布回执。

旧输入 `2f219c89` 在“删除返回后必须等待已接纳保存”的首条断言失败，最终 21 项行为回归与真实 socket/PTY 单次、并发恢复后的模式清理通过。固定 VS Code 原模式切换及两窗口场景使用与本地生产构建完全相同的 extension.js，原业务预算不变。

方案与边界见 [正式设计](../../design-docs/runtime-mode-switch-settlement.md)。旧 CI 的 Remote SSH ready 首败单独保留，完整 PR head CI 仍需推送后核对；本地绿色不等于 PR327 可合并或可发布。
