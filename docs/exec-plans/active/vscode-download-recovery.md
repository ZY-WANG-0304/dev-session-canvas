# 收口固定 VSCode 下载尝试的异常与清理

按docs/PLANS.md维护。用户授权第四项，不更改已提交的缓存方案或主会话字体工作。

## 目标与全局图景

下载流发生ECONNRESET时，失败有结构化记录；原尝试进程树退出并清理后，最多在原五分钟期限内重试三次。校验、权限、未知崩溃和清理失败不能被网络重试掩盖。

## 进度

- [x] (2026-10-23) 核对原未处理拒绝日志、库校验Promise时序和现有三次循环。
- [x] (2026-10-23) 记录独立worker方案、分类边界及不延长原期限。
- [x] (2026-10-23) 实现单次worker的结构化退出和父进程清理后重试，原期限及三次上限保留。
- [x] (2026-10-23) 静态审查和Node语法检查通过，独立暂存本轮文件，保留主会话字体工作。
- [ ] 真实断流恢复与新head完整CI验收。

## 意外与发现

依赖库创建校验Promise后先await解压，导致流异常存在尚未监听拒绝的窗口；仅在外围函数catch不能捕获进程级未处理拒绝。直接在原进程吞掉所有未处理错误会使活动请求和解压进程进入未知状态，因此选用失败即退出的单次进程边界。

## 决策记录

2026-10-23：保留downloadFixedVSCode的注入式接口和原三次循环，默认download实现委托单次worker。worker不重试；父进程只有在获得结构化网络错误及已完成清理证据时重试。路径/记录故障、超期和未知退出均非网络错误，不扩大分类。

## 上下文与定向

工作区/tmp/dsc335-deps。scripts/smoke/download-vscode.mjs目前直接调用@vscode/test-electron，ensureVSCodeExecutable已有原绝对deadline和外层runProcess。新worker在scripts/smoke/download-vscode-attempt.mjs，复用scripts/gates/process.mjs的进程组清理，不修改共享process.mjs。下载结果临时文件在cache下随机目录，父进程读取后删除；每次失败的结构化错误及进程观察写入原下载回执。

## 工作计划与里程碑

先实现worker记录和失败即退出，再让父进程恢复异常类型并进入原循环，最后确认deadline、三次上限、版本和未知错误拒绝规则没有放宽。文档随实现更新。本轮不新增或执行测试，只做语法及差异检查；后续需用真实worker的同步异常、未处理拒绝、重复网络故障和校验反例验收。

## 验证与验收

静态检查使用node --check和git diff --check。后续真实验证应覆盖：首个ECONNRESET后成功、三次持续网络失败、非网络错误只尝试一次、混合AggregateError拒绝、超期不再启动、失败worker子进程完成清理、无结构化回执不可重试。所有尝试共享原deadline，记录首败且不代签产品回执。

## 幂等性与恢复

每次尝试使用唯一目录，结果文件wx写入，清理只删除自己的临时目录。撤销本轮两个下载脚本改动可恢复直接库调用；缓存修复和字体工作独立。

## 结果与复盘

实现及静态审查完成，两个脚本node --check及git diff --check通过。未新增或运行测试，真实worker断流恢复/清理与新head完整CI仍待验收；原CI根因边界保持。父进程级容错不等于外部下载服务可靠性已改善。

## 接口与依赖

downloadFixedVSCode保留原参数和注入式download/now/sleep。新增downloadVSCodeAttempt接收version/cachePath/timeout/deadline；worker直接调用锁定的@vscode/test-electron，依赖库内部重试被reporter拒绝。不新增npm包。

修订记录：2026-10-23完成单次worker、取消传播、原期限看门狗、结构化错误及清理后重试接线，验证边界保持。

补充进展：用户要求验证完整CI，840b06b2四组真实worker受控验证通过，证据见docs/references/vscode-download-recovery/README.md；与字体修正共同推送PR335，完整Actions待终态。
