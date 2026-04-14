# 公开 Preview 支持边界

本文说明公开 `Preview` 阶段的反馈入口、受理边界和提 issue 前应准备的信息。目标不是承诺稳定版支持，而是帮助早期用户将有效反馈送到正确入口。

## 适用对象

本版本更适合以下用户：

- 愿意接受 `Preview` 限制的高级用户
- 能自行准备 `codex` 或 `claude` CLI、shell 与受信任工作区环境的使用者
- 愿意提供复现步骤、日志和环境信息的早期反馈者

## 提 issue 前请先确认

提交 bug 或功能反馈前，请先确认：

1. 使用的是最新公开 `Preview` 版本，或 `main` 分支的最新开发态。
2. 工作区是标准文件系统工作区；`Virtual Workspace` 不在支持范围内。
3. 如涉及执行链路，工作区已受信任，且本机或远端 Extension Host 可解析所需 CLI / shell。
4. 已阅读 [`README.md`](../README.md) 中的支持矩阵和已知限制。

## 提交 bug 时建议包含的信息

为便于复现与分流，bug issue 建议至少包含：

- VS Code 版本
- 操作系统与架构
- 本地工作区或 `Remote SSH` 工作区
- 是否开启 `devSessionCanvas.runtimePersistence.enabled`
- 使用的 `Agent` provider 与命令配置
- 最小复现步骤
- 期望行为与实际行为
- 相关日志、截图或 `.debug/` 产物路径

## 优先受理范围

公开 `Preview` 阶段优先受理以下问题：

- 画布无法打开、恢复明显失败或关键对象状态丢失
- `Remote SSH` 主路径下的运行、恢复或 real-reopen 问题
- `Restricted Mode` 行为与文档声明不一致
- Marketplace 安装、升级或打包产物完整性问题
- 与 README 支持矩阵直接冲突的行为回归

## 不承诺范围

以下内容不作为公开 `Preview` 的支持承诺：

- 历史预览包、历史提交、临时分支或个人派生修改
- `Virtual Workspace`、浏览器形态或仓库未声明支持的宿主环境
- 仅在修改源码、替换依赖或偏离默认配置后才出现的问题
- 缺少复现信息、无法确认入口环境的模糊报告

## 功能请求与产品反馈

提功能请求时，请优先说明：

- 真实使用场景
- 为什么画布、`Agent` 或 `Terminal` 路径不能满足需求
- 期望的行为，而非实现建议

产品当前仍为 `Preview`，功能请求按主路径价值、实现风险和支持成本排序，不承诺都会进入下一轮发布。

## 安全问题

安全问题不要走公开 issue，请使用私密渠道：

- 安全邮箱：`wzy0304@outlook.com`
- 具体规则见 [`docs/SECURITY.md`](./SECURITY.md)
