---
title: 公开平台发布准备
decision_status: 已选定
validation_status: 验证中
domains:
  - VSCode 集成域
  - 项目状态域
architecture_layers:
  - 宿主集成层
  - 适配与基础设施层
related_specs: []
related_plans:
  - docs/exec-plans/completed/public-marketplace-release-readiness-research.md
  - docs/exec-plans/active/publish-tag-release-flow.md
  - docs/exec-plans/completed/github-release-assets-flow.md
updated_at: 2026-07-14
---

# 公开平台发布准备

> 2026-06-07 补充：本文主体保留公开 Marketplace Preview 首发准备与后续双市场同步机制的历史决策背景；上一轮 `0.13.0` 已完成双市场发布并在 `main` 上打 `v0.13.0` tag。当前新版本发布准备目标为 `0.14.0`，发布输入、release notes、安装/升级、回退、验证记录与 tag 命令以 `docs/public-preview-release-playbook.md` 和 `docs/notifier-preview-release-playbook.md` 为准。`0.14.0` 不改变本文已选定的渠道策略、Preview 定位、README 打包入口、双市场同版本同步和最终 `main` ref 发布 / tag 约束。

> 2026-06-07 验证补充：`release-0-14-0-prep` 已完成版本一致性、manifest / publish / VSIX 脚本测试、目标 Webview 回归、构建、双市场 dry-run、主扩展与 notifier 打包、clean checkout 打包、Open VSX token 复核、生产依赖审计和 VSIX smoke 重跑验证。当前主扩展 VSIX 为 `dev-session-canvas-0.14.0.vsix`（114 files，约 3.41 MB），notifier VSIX 为 `dev-session-canvas-notifier-0.14.0.vsix`（10 files，约 143.9 KB），两者 `VSCE README doc ref` 均为 `af066bae2f006a450578309059ffd7792efab7ae`；最终 publish / tag 前仍需在合并后的最终 `main` ref 上复跑同一组 release gate。

> 2026-06-08 补充：上一轮 `0.14.0` 已完成双市场发布并在 `main` 上打 `v0.14.0` tag。当前发布准备目标为 `0.14.1`，输入范围是 `v0.14.0` 之后合入 `main` 的 shared runtime 验证硬化、分组 body 空白区拖动画板、微信群二维码物料，以及 Explorer Markdown 文件右键创建关联 Note / 创建入口 surface 复用。`0.14.1` 不改变本文已选定的渠道策略、Preview 定位、README 打包入口、双市场同版本同步和最终 `main` ref 发布 / tag 约束；发布输入、release notes、安装/升级、回退、验证记录与 tag 命令以 `docs/public-preview-release-playbook.md` 和 `docs/notifier-preview-release-playbook.md` 为准。


> 2026-06-09 补充：上一轮 `0.14.1` 已完成双市场发布并在 `main` 上打 `v0.14.1` tag。当前发布准备目标为 `0.15.0`，输入范围是 `v0.14.1` 之后合入 `main` 的 Claude Code Agent Fork、文件活动自动对象 owner-derived 分组、workspace-root section 标题缩放对齐、Panel Webview lifecycle 诊断闭环，以及 publish tag 发布输入固定流程。`0.15.0` 不改变本文已选定的渠道策略、Preview 定位、README 打包入口、双市场同版本同步和最终 `main` ref 发布 / tag 约束；发布输入、release notes、安装/升级、回退、验证记录与 tag 命令以 `docs/public-preview-release-playbook.md` 和 `docs/notifier-preview-release-playbook.md` 为准。

> 2026-06-10 补充：上一轮 `0.15.0` 已完成双市场发布并在 `main` 上打 `v0.15.0` tag。当前发布准备目标为 `0.15.1`，输入范围是 `v0.15.0` 之后合入 `main` 的分组标题 tooltip、分组双击聚焦、`Add Folder to Workspace` 新增 root 就近放置与聚焦、多根通知标题 root 标识、执行性能诊断插桩与新 worktree 调试自举依赖。`0.15.1` 仍不改变本文已选定的渠道策略、Preview 定位、README 打包入口、双市场同版本同步和最终 `main` ref 发布 / tag 约束；发布输入、release notes、安装/升级、回退、验证记录与 tag 命令以 `docs/public-preview-release-playbook.md` 和 `docs/notifier-preview-release-playbook.md` 为准。

> 2026-06-14 补充：上一轮 `0.15.1` 已在远端存在正式 tag `v0.15.1`，指向 `d33679244aaf4451be61960280168a74d6e35797`；Open VSX 主扩展与 notifier latest 均可公开查询到 `0.15.1`。但 2026-06-14 复核时，Visual Studio Marketplace 公开 item 页面 `devsessioncanvas.dev-session-canvas` 与 `devsessioncanvas.dev-session-canvas-notifier` 仍返回 404，public gallery `extensionquery` 对两个 extension id 均返回 0 个结果；因此当前仍不能把上一轮描述为已完成双市场公开可见发布。当前发布准备目标为 `0.15.2`，输入范围是 `v0.15.1` 之后合入 `main` 的 execution attention signal allow-list、Codex 最终失败文本提醒、Claude Agent `Ctrl-Z` / `fg` 误导状态收口、旧 `suspended` 状态兼容渲染、画布外部链接打开方式配置与本地预览链接转发，以及 GitHub Release assets 镜像 / 复用发布流程。`0.15.2` 仍不改变本文已选定的渠道策略、Preview 定位、README 打包入口、双市场同版本同步和最终 `main` ref 发布 / tag 约束；正式 publish / `v0.15.2` tag 前必须先解决或明确变更 Visual Studio Marketplace 公开可见性门禁，并在第一次真实 `publish/v0.15.2` Actions run 中验证 GitHub Release assets 创建、下载校验、marketplace 发布验证和临时 tag 删除路径。发布输入、release notes、安装/升级、回退、验证记录与 tag 命令以 `docs/public-preview-release-playbook.md` 和 `docs/notifier-preview-release-playbook.md` 为准。

> 2026-06-15 补充：上一轮 `0.15.2` 已在远端存在正式 tag `v0.15.2`，指向 `9f5d1926a88de8a2286291c4ad18ec4dcba246bb`；`v0.15.2` 对应 GitHub Release 已包含主扩展 VSIX、notifier VSIX 与 release manifest assets，Open VSX 主扩展与 notifier latest 均可公开查询到 `0.15.2`。但 2026-06-15 复核时，Visual Studio Marketplace public gallery `extensionquery` 对 `devsessioncanvas.dev-session-canvas` 与 `devsessioncanvas.dev-session-canvas-notifier` 仍返回 0 个结果，且远端 `publish/v0.15.2` 临时 tag 仍保留用于同一 release input 补发 / 重跑排障；因此当前仍不能把上一轮描述为已完成双市场公开可见发布。当前发布准备目标为 `0.16.0`，输入范围是 `v0.15.2` 之后合入 `main` 的 Codex / Claude Code Agent Fork、历史会话分叉、侧栏待处理提醒汇总、multi-root root section 水印、Agent cwd / 启动命令标题拆分、多 Agent 输入响应、执行终端链接 activation fallback、复制诊断，以及 GitHub Release assets / 双市场发布 workflow 解耦。`0.16.0` 不改变 Preview 定位、README 打包入口和最终 `main` ref 发布 / tag 约束；但本轮 release-day 明确把完成门禁调整为 GitHub Release assets 已上传且 Open VSX 主扩展 / notifier 均验证通过。Visual Studio Marketplace 仍应尝试发布与验证，但在当前 public gallery 仍不可见时允许作为 deferred channel 保留在 release manifest / notes 中，不再阻塞 `v0.16.0` 的 GitHub Release assets + Open VSX 兜底完成。发布输入、release notes、安装/升级、回退、验证记录与 tag 命令以 `docs/public-preview-release-playbook.md` 和 `docs/notifier-preview-release-playbook.md` 为准。

> 2026-06-15 发布后验证补充：`0.16.0` 已从最终 `main` ref `542d90cf6f7ce60e832f2ea1dc17fe0b71d2695c` 正式发布。GitHub Actions run `27533849564` 完成 GitHub Release assets 上传、Open VSX 主扩展 / notifier 发布验证、最终 manifest / Release notes 更新，以及 `publish/v0.16.0` 临时 tag 删除；GitHub Release `v0.16.0` 位于 `https://github.com/ZY-WANG-0304/dev-session-canvas/releases/tag/v0.16.0`，包含主扩展 VSIX、notifier VSIX 与 `release-manifest-0.16.0.json` 三个 assets。最终 manifest 状态为 `complete-with-deferred-visual-studio`，`releaseCompletion.requiredTargets = ["github-release-assets", "open-vsx"]`，Open VSX 主扩展与 notifier 均为 `verified`，Visual Studio Marketplace 主扩展与 notifier 均为 `publish-failed` / deferred；同日 public gallery 复核两个 VSM extension id 仍为 `extensions_len=0`、`TotalCount=0`。因此本轮 GitHub Release assets + Open VSX 兜底完成门禁已验证，VSM 可见性仍不得对外宣称为已可用。

> 2026-06-16 补充：上一轮 `0.16.0` 已完成 GitHub Release assets + Open VSX 兜底发布，正式 `v0.16.0` 指向 `542d90cf6f7ce60e832f2ea1dc17fe0b71d2695c`，远端 `publish/v0.16.0` 已删除；Visual Studio Marketplace public gallery 对主扩展与 notifier 仍为 0 个结果，因此 VSM 继续作为 deferred channel，不得对外宣称为已可用。当前发布准备目标为 `0.16.1`，输入范围是 `v0.16.0` 之后合入 `main` 的 #171 multi-root workspace root section 水印可读性优化、#173 执行终端 snapshot restore 期间剪贴板诊断噪音抑制 / 用户输入前刷新恢复诊断抑制，以及 #175 生产依赖 audit 告警收口（`js-yaml` / `markdown-it` 升级）。`0.16.1` 不改变 Preview 定位、README 打包入口、最终 `main` ref 发布 / tag 约束、GitHub Release assets 兜底入口或 VSM deferred 完成门禁；发布输入、release notes、安装/升级、回退、验证记录与 tag 命令以 `docs/public-preview-release-playbook.md` 和 `docs/notifier-preview-release-playbook.md` 为准。

> 2026-06-17 补充：上一轮 `0.16.1` 已完成 GitHub Release assets + Open VSX 兜底发布，正式 `v0.16.1` 指向 `72a7bd3a761abf7a5b4ea47ce54b63bfa9e84251`，远端不存在 `publish/v0.16.1` 临时 tag；GitHub Release `v0.16.1` 已包含主扩展 VSIX、notifier VSIX 与 release manifest assets，Open VSX 主扩展与 notifier latest 均可公开查询到 `0.16.1`。Visual Studio Marketplace public gallery 对主扩展与 notifier 仍为 0 个结果，因此 VSM 继续作为 deferred channel，不得对外宣称为已可用。当前发布准备目标为 `0.17.0`，输入范围是 `v0.16.1` 之后合入 `main` 的 #176 多 Agent 输入响应调度 / Host 输出 scheduler、#178 微信交流群二维码资产更新，以及 #177 侧栏 workspace folder 与 git worktree 操作入口、folder / repository / linked worktree 类型区分和移除边界。`0.17.0` 不改变 Preview 定位、README 打包入口、最终 `main` ref 发布 / tag 约束、GitHub Release assets 兜底入口或 VSM deferred 完成门禁；发布输入、release notes、安装/升级、回退、验证记录与 tag 命令以 `docs/public-preview-release-playbook.md` 和 `docs/notifier-preview-release-playbook.md` 为准。

> 2026-06-19 补充：上一轮 `0.17.0` 已完成 GitHub Release assets + Open VSX 兜底发布，正式 `v0.17.0` 指向 `2259900286708540a18a858ce4f82ed4fd836c40`，远端不存在 `publish/v0.17.0` 临时 tag；GitHub Release `v0.17.0` 已包含主扩展 VSIX、notifier VSIX 与 release manifest assets，Open VSX 主扩展与 notifier `0.17.0` 均可公开查询且 files metadata 齐全。Visual Studio Marketplace public gallery 对主扩展与 notifier 仍为 0 个结果，因此 VSM 继续作为 deferred channel，不得对外宣称为已可用。当前发布准备目标为 `0.18.0`，输入范围是 `v0.17.0` 之后合入 `main` 的 #182 Codex 异常输出尾部状态栏兼容、#181 画布布局整理，以及 #180 multi-root pane gallery 模式。`0.18.0` 不改变 Preview 定位、README 打包入口、最终 `main` ref 发布 / tag 约束、GitHub Release assets 兜底入口或 VSM deferred 完成门禁；发布输入、release notes、安装/升级、回退、验证记录与 tag 命令以 `docs/public-preview-release-playbook.md` 和 `docs/notifier-preview-release-playbook.md` 为准。

> 2026-06-22 补充：上一轮 `0.18.0` 已完成 GitHub Release assets + Open VSX 兜底发布，正式 `v0.18.0` 指向 `85f8bb1a38a048afdcee43c2bcfaeb8f1c604bf5`，远端不存在 `publish/v0.18.0` 临时 tag；GitHub Release `v0.18.0` 已包含主扩展 VSIX、notifier VSIX 与 release manifest assets，release manifest 记录 Open VSX 主扩展与 notifier `0.18.0` 均为 verified。Visual Studio Marketplace 主扩展与 notifier 仍为 `publish-failed` / deferred，不能对外宣称为已可用。当前发布准备目标为 `0.18.1`，输入范围是 `v0.18.0` 之后合入 `main` 的 #184 窗格画廊视口记忆分离、#186 画布布局整理空分组尺寸规范化、#187 侧栏会话历史分组控制与菜单选中态，以及 #190 隐私政策 / manifest `privacyUrl`、`licenseUrl` 元数据；#188 为同轮侧栏菜单视觉确认文档，不进入用户可见 release notes。`0.18.1` 不改变 Preview 定位、README 打包入口、最终 `main` ref 发布 / tag 约束、GitHub Release assets 兜底入口或 VSM deferred 完成门禁；发布输入、release notes、安装/升级、回退、验证记录与 tag 命令以 `docs/public-preview-release-playbook.md` 和 `docs/notifier-preview-release-playbook.md` 为准。

> 2026-06-24 补充：上一轮 `0.18.1` 已完成 GitHub Release assets + Open VSX 兜底发布，正式 `v0.18.1` 指向 `a6a55fe2f40aee1ccac7887cd5bd83730e550676`，远端不存在 `publish/v0.18.1` 临时 tag；GitHub Release `v0.18.1` 已包含主扩展 VSIX、notifier VSIX 与 release manifest assets，release manifest 记录 Open VSX 主扩展与 notifier `0.18.1` 均为 verified，Visual Studio Marketplace 主扩展与 notifier 继续为 `publish-failed` / deferred，不能对外宣称为已可用。`0.18.2` 已完成 GitHub Release assets + Open VSX 兜底发布，正式 `v0.18.2` 指向 `0bba3f82c3de0f4a08ddb674ffbc3eef80a3f54d`，远端 `publish/v0.18.2` 临时 tag 已删除；GitHub Release `v0.18.2` 已包含主扩展 VSIX、notifier VSIX 与 release manifest assets，release manifest 记录 Open VSX 主扩展与 notifier `0.18.2` 均为 verified，Visual Studio Marketplace 主扩展与 notifier 继续为 `publish-failed` / deferred，不能对外宣称为已可用。本轮输入范围是 `v0.18.1` 之后合入 `main` 的 #192 Marketplace README 交流二维码移除、#193 Webview Playwright 回归稳定性修复、#195 分组 resize 残留草稿清理与几何诊断 / 回归测试，以及 #197 窗格画廊缩略图 rail 按 workspace root 顺序稳定排列。`0.18.2` 不改变 Preview 定位、README 打包入口、最终 `main` ref 发布 / tag 约束、GitHub Release assets 兜底入口或 VSM deferred 完成门禁；发布事实、验证记录与后续复核以 `docs/public-preview-release-playbook.md` 和 `docs/notifier-preview-release-playbook.md` 为准。

> 2026-06-26 补充：上一轮 `0.18.2` 已完成 GitHub Release assets + Open VSX 兜底发布，正式 `v0.18.2` 指向 `0bba3f82c3de0f4a08ddb674ffbc3eef80a3f54d`，远端不存在 `publish/v0.18.2` 临时 tag；GitHub Release `v0.18.2` 已包含主扩展 VSIX、notifier VSIX 与 release manifest assets，release manifest 记录 Open VSX 主扩展与 notifier `0.18.2` 均为 verified，Visual Studio Marketplace 主扩展与 notifier 继续为 `publish-failed` / deferred，不能对外宣称为已可用。当前发布准备目标为 `0.19.0`，输入范围是 `v0.18.2` 之后合入 `main` 的 Agent 截图粘贴输入与临时缓存清理、侧栏添加已有 worktree、同仓库 worktree 选择项合并、多根会话历史恢复 cwd 归属、root-qualified 多根文件链接解析、多 Agent 输出公平渲染、paneGallery root 标签状态背景 / fit view 子图边界和 active 画布 Panel 左右 padding 收口，以及依赖审计跟进。`0.19.0` 不改变 Preview 定位、README 打包入口、最终 `main` ref 发布 / tag 约束、GitHub Release assets 兜底入口或 VSM deferred 完成门禁；发布输入、release notes、安装/升级、回退、验证记录与 tag 命令以 `docs/public-preview-release-playbook.md` 和 `docs/notifier-preview-release-playbook.md` 为准。

> 2026-06-29 补充：上一轮 `0.19.0` 已完成 GitHub Release assets + Open VSX 兜底发布，正式 `v0.19.0` 指向 `56b4d0af2dc875ca6bd096d47af964e14238603c`，远端 `publish/v0.19.0` 临时 tag 已由 workflow 删除；GitHub Release `v0.19.0` 包含 `dev-session-canvas-0.19.0.vsix`、`dev-session-canvas-notifier-0.19.0.vsix` 与 `release-manifest-0.19.0.json`，release manifest 记录 Open VSX 主扩展与 notifier `0.19.0` 均为 verified，Visual Studio Marketplace 主扩展与 notifier 仍为 `publish-failed` / deferred，不能对外宣称为已可用。当前发布准备目标为 `0.20.0`，输入范围是 `v0.19.0` 之后合入 `main` 的 #211 侧栏移除 root 原生 modal 与 linked worktree 移除失败保护、#214 paneGallery 左侧滚动预留移除、#216 paneGallery 通知定位缩略图节点修复、#221 模板市场 Phase 1-4、#222 模板市场生产部署 workflow、#223 生产部署 tag 下 main ref 拉取修复、#224 生产部署 E2E 浏览器安装，以及 #225 生产部署 DNS 检查。`0.20.0` 不改变 Preview 定位、README 打包入口、最终 `main` ref 发布 / tag 约束、GitHub Release assets 兜底入口或 VSM deferred 完成门禁；模板市场生产服务部署继续使用独立 `deploy/template-marketplace/prod/*` tag，不能写成插件 SemVer。发布输入、release notes、安装/升级、回退、验证记录与 tag 命令以 `docs/public-preview-release-playbook.md` 和 `docs/notifier-preview-release-playbook.md` 为准。

> 2026-07-02 补充：上一轮 `0.20.0` 已完成 GitHub Release assets + Open VSX 兜底发布，正式 `v0.20.0` 指向 `91a5e862fdc7f8acf87c8ec2e2717c37890c1a8c`，远端 `publish/v0.20.0` 临时 tag 已由 workflow 删除；GitHub Release `v0.20.0` 包含 `dev-session-canvas-0.20.0.vsix`、`dev-session-canvas-notifier-0.20.0.vsix` 与 `release-manifest-0.20.0.json`，release manifest 记录 Open VSX 主扩展与 notifier `0.20.0` 均为 verified，Visual Studio Marketplace 主扩展与 notifier 仍为 `publish-failed` / deferred，不能对外宣称为已可用。当前发布准备目标为 `0.21.0`，输入范围是 `v0.20.0` 之后合入 `main` 的 #227 主扩展子包化 monorepo 布局、#228 执行终端 OSC 52 复制桥接、#229 serialized terminal snapshot 新鲜度修复、#230 paneGallery root attention 闪烁增强、#231 Agent 会话恢复 / 分叉参数边界收紧、#232 多根 root 级模板 reset 与 Markdown 路径解析修复，以及 #234 paneGallery root running 标题栏活性线和扫描提示。`0.21.0` 不改变 Preview 定位、README 打包入口、最终 `main` ref 发布 / tag 约束、GitHub Release assets 兜底入口或 VSM deferred 完成门禁；模板市场生产服务部署继续使用独立 `deploy/template-marketplace/prod/*` tag，不能写成插件 SemVer。发布输入、release notes、安装/升级、回退、验证记录与 tag 命令以 `docs/public-preview-release-playbook.md` 和 `docs/notifier-preview-release-playbook.md` 为准。

> 2026-07-02 验证补充：`release-0-21-0-prep` 已完成版本号、CHANGELOG、Marketplace / README 文案、发布手册与 VSIX smoke harness 对齐；repo-local 验证已通过 manifest / publish / VSIX 脚本测试、构建与 typecheck、执行终端剪贴板、serialized terminal state tracker、Agent launch presets、模板、多根、runtime supervisor protocol、webview protocol、notifier source、生产部署 workflow / config、`npm audit --omit=dev`、主扩展 / notifier VSIX 打包和 `npm run test:vsix-smoke`。当前主扩展 VSIX 为 `dev-session-canvas-0.21.0.vsix`（`115` files，约 `3.6 MB`），notifier VSIX 为 `dev-session-canvas-notifier-0.21.0.vsix`（`10` files，约 `145.83 KB`）；主扩展打包日志打印 `VSCE README doc ref: 5b01fdaee13916e2075cf7e26617af909e0746ba`，但因发布准备工作树未 clean，只能作为分支内验证证据。最终 publish / tag 前仍需在合并后的 clean `main` release ref 上重跑 clean-checkout VSIX、主扩展 / notifier 打包、packaged-payload smoke 与 `publish/v0.21.0` dry-run。

> 2026-07-03 补充：上一轮 `0.21.0` 已完成 GitHub Release assets + Open VSX 兜底发布，正式 `v0.21.0` 指向 `64df87fb08cb3940b32f0b3104b8d408d837c940`，远端 `publish/v0.21.0` 临时 tag 已由 workflow 删除；GitHub Release `v0.21.0` 包含 `dev-session-canvas-0.21.0.vsix`、`dev-session-canvas-notifier-0.21.0.vsix` 与 `release-manifest-0.21.0.json`，release manifest 记录 Open VSX 主扩展与 notifier `0.21.0` 均为 verified，Visual Studio Marketplace 主扩展与 notifier 仍为 `publish-failed` / deferred，不能对外宣称为已可用。当前发布准备目标为 `0.21.1`，输入范围是 `v0.21.0` 之后合入 `main` 的 #236 serialized terminal supervisor snapshot 旧 raw tail 降级与可信 tracker 保留、#237 Pane Gallery root running 扫描连续化、#233 多根 root 整理默认限定当前 root、#238 Pane Gallery active root 缩略图占位、#239 侧栏 root 分组按 workspace 顺序排列，以及 #240 当前 Agent 恢复 / 分叉继承启动意图。`0.21.1` 不改变 Preview 定位、README 打包入口、最终 `main` ref 发布 / tag 约束、GitHub Release assets 兜底入口或 VSM deferred 完成门禁；模板市场生产服务部署继续使用独立 `deploy/template-marketplace/prod/*` tag，不能写成插件 SemVer。发布输入、release notes、安装/升级、回退、验证记录与 tag 命令以 `docs/public-preview-release-playbook.md` 和 `docs/notifier-preview-release-playbook.md` 为准。

> 2026-07-03 验证补充：`release-0-21-1-prep` 已完成版本号、CHANGELOG、Marketplace / README 文案、发布手册与设计发布记录同步；repo-local 验证已通过 manifest / publish / VSIX 脚本测试、构建与 typecheck、runtime supervisor protocol、webview protocol、serialized terminal state tracker、Agent launch presets、canvas layout arrangement、sidebar node list、execution output sequence、notifier source、生产部署 workflow / config、`npm audit --omit=dev`、主扩展 / notifier VSIX 打包，以及重跑后的 `npm run test:vsix-smoke`。当前主扩展 VSIX 为 `dev-session-canvas-0.21.1.vsix`（`115` files，约 `3.6 MB`，`sha256=f455252e437f88d60e5712ed1a9b473f47709b44fa56cb7eabc34a0628478adb`），notifier VSIX 为 `dev-session-canvas-notifier-0.21.1.vsix`（`10` files，约 `145.93 KB`，`sha256=8f5c8fe51e6887067c3c2bd0fdd93d4aea7aa08244ebe5cf6fc7cddf078bbf34`）。主扩展打包日志在 dirty 发布准备工作树下打印 `VSCE README doc ref: 231b73254fd6867b10e961d549f922024229f6e8`，只能作为分支内验证证据；最终 publish / tag 前仍需在合并后的 clean `main` release ref 上重跑 clean-checkout VSIX、主扩展 / notifier 打包、packaged-payload smoke 与 `publish/v0.21.1` dry-run。

> 2026-07-05 补充：上一轮 `0.21.1` 已完成 GitHub Release assets + Open VSX 兜底发布，正式 `v0.21.1` 指向 `6cfdb958d1f9bb579ec73c99ee28660864b582c4`，远端 `publish/v0.21.1` 临时 tag 已由 workflow 删除；GitHub Release `v0.21.1` 包含 `dev-session-canvas-0.21.1.vsix`、`dev-session-canvas-notifier-0.21.1.vsix` 与 `release-manifest-0.21.1.json`，release manifest 记录 Open VSX 主扩展与 notifier `0.21.1` 均为 verified，Visual Studio Marketplace 主扩展与 notifier 仍为 `publish-failed` / deferred，不能对外宣称为已可用。当前发布准备目标为 `0.22.0`，输入范围是 `v0.21.1` 之后合入 `main` 的 #242 Codex 赋值形式会话选择参数清理、#243 Pane Gallery running 标题动画重制、#244 UI 文案英中本地化，以及 #245 当前 Agent 节点分叉不再合并当前 Default args。`0.22.0` 不改变 Preview 定位、README 打包入口、最终 `main` ref 发布 / tag 约束、GitHub Release assets 兜底入口或 VSM deferred 完成门禁；模板市场生产服务部署继续使用独立 `deploy/template-marketplace/prod/*` tag，不能写成插件 SemVer。发布输入、release notes、安装/升级、回退、验证记录与 tag 命令以 `docs/public-preview-release-playbook.md` 和 `docs/notifier-preview-release-playbook.md` 为准。

> 2026-07-05 验证补充：`release-0-22-0-prep` 已完成版本号、CHANGELOG、Marketplace / README 文案、发布手册与设计发布记录同步；repo-local 验证已通过 manifest / publish / VSIX 脚本测试、构建与 typecheck、本地化静态测试、真实 VS Code locale smoke 重跑、Agent launch presets、canvas execution context、theme color tokens、Pane Gallery / Agent running Playwright 定向回归、notifier source、生产部署 workflow、`npm audit --omit=dev`、主扩展 / notifier VSIX 打包，以及 `npm run test:vsix-smoke` packaged-payload smoke。验证中发现 active root 占位的简体中文文案实现仍为“正在主画布”，与产品规格和 Playwright 回归中的“正在主画板”不一致，已在 Webview i18n 字典与断言中修正并重跑通过。当前主扩展 VSIX 为 `dev-session-canvas-0.22.0.vsix`（`117` files，`3.66 MB` / `3,832,978 bytes`，`sha256=269479e5f94efa29099d4ccc86529e3d088df118f6ca0e06c7c8122c0dcb88b2`），notifier VSIX 为 `dev-session-canvas-notifier-0.22.0.vsix`（`10` files，`146.01 KB` / `149,515 bytes`，`sha256=7a42ab441442db5b19dd52bed7897dd64157d0e772d20c7f163307607a3ceb9f`）。主扩展打包日志在 dirty 发布准备工作树下打印 `VSCE README doc ref: 2a6f9ba4f38805b23e399e8e56f0ec6f09f9a267`，只能作为分支内验证证据；最终 publish / tag 前仍需在合并后的 clean `main` release ref 上重跑 clean-checkout VSIX、主扩展 / notifier 打包、packaged-payload smoke 与 `publish/v0.22.0` dry-run。


> 2026-07-07 补充：上一轮 `0.22.0` 已完成 GitHub Release assets + Open VSX 兜底发布，正式 `v0.22.0` 指向 `b56fce2c74b2aefe383c1cb03fdfea522079b3cc`，远端 `publish/v0.22.0` 临时 tag 已由 workflow 删除；GitHub Release `v0.22.0` 包含 `dev-session-canvas-0.22.0.vsix`、`dev-session-canvas-notifier-0.22.0.vsix` 与 `release-manifest-0.22.0.json`，release manifest 记录 Open VSX 主扩展与 notifier `0.22.0` 均为 verified，Visual Studio Marketplace 主扩展与 notifier 仍为 `publish-failed` / deferred，不能对外宣称为已可用。当前发布准备目标为 `0.23.0`，输入范围是 `v0.22.0` 之后合入 `main` 的 #247 技术债清理流程规则、#248 live-runtime scrollback smoke 稳定性、#249 外部控制面设计边界，以及 #250 notifier 英文默认 / 简体中文本地化与真实宿主 locale smoke。本轮用户可见 release notes 聚焦 #250 与 smoke 稳定性，docs-only 变化不作为用户功能宣传。`0.23.0` 不改变 Preview 定位、README 打包入口、最终 `main` ref 发布 / tag 约束、GitHub Release assets 兜底入口或 VSM deferred 完成门禁；模板市场生产服务部署继续使用独立 `deploy/template-marketplace/prod/*` tag，不能写成插件 SemVer。发布输入、release notes、安装/升级、回退、验证记录与 tag 命令以 `docs/public-preview-release-playbook.md` 和 `docs/notifier-preview-release-playbook.md` 为准。

> 2026-07-07 验证补充：`release-0-23-0-prep` 已完成版本号、CHANGELOG、Marketplace / README 文案、发布手册与设计发布记录同步；截至当前记录，外部事实复核确认 GitHub Release latest 为 `v0.22.0`，Open VSX 主扩展与 notifier latest 均为 `0.22.0`，`release-manifest-0.22.0.json` 记录 Open VSX 双扩展 verified、Visual Studio Marketplace 双扩展 `publish-failed` / deferred，且 VSM public gallery 对两个 extension id 仍返回空列表。repo-local 验证已通过版本 / 文本一致性检查、manifest / publish / VSIX 脚本测试、构建与 typecheck、notifier source、notifier companion smoke、英文 / 简体中文 notifier locale smoke、`npm audit --omit=dev`、主扩展 / notifier VSIX 打包、`npm run test:vsix-smoke` packaged-payload smoke、`npm run validate:clean-checkout:vsix -- --source working-tree --skip-vsix-smoke` 隔离主扩展打包，以及 `git diff --check`。当前主扩展 VSIX 为 `dev-session-canvas-0.23.0.vsix`（`117` files，`3.66 MB` / `3,833,233 bytes`，`sha256=77ad1a207d259e9f8382701eeb502944ef00b8408f512a8a02a215ef6d84884e`），notifier VSIX 为 `dev-session-canvas-notifier-0.23.0.vsix`（`14` files，`154.97 KB` / `158,689 bytes`，`sha256=5aa861f57d55b81712bfe11da57df2da6e4f54477f96a7e52c64f5e788b633b7`）。主扩展与 notifier 打包日志在 dirty 发布准备工作树下使用 `VSCE README doc ref: b7149132b37c11f6a92912ed0cd24f11924f781f`，只能作为分支内验证证据；最终 publish / tag 前仍需在合并后的 clean `main` release ref 上重跑 clean-checkout VSIX、主扩展 / notifier 打包、packaged-payload smoke 与 `publish/v0.23.0` dry-run。

> 2026-07-12 补充：上一轮 `0.23.0` 已从最终 `main` release ref `c458156943a6576f532734c8a81ace851e8b4b5c` 完成 GitHub Release assets + Open VSX 兜底发布，正式 `v0.23.0` 指向同一 ref，远端 `publish/v0.23.0` 临时 tag 已删除；GitHub Release 包含主扩展 VSIX、notifier VSIX 与 `release-manifest-0.23.0.json`，最终 manifest 状态为 `complete-with-deferred-visual-studio`，Open VSX 双扩展 `0.23.0` 均 verified，Visual Studio Marketplace 双扩展均为 `publish-failed` / deferred。2026-07-12 复核时 VSM public gallery 对两个 extension id 仍为 `count=0` / `TotalCount=0`。当前发布准备目标选择 `0.24.0`：相对 `0.23.0` 的输入只包含已合入 `main` 的 #252 multi-root 清空画板作用域、#253 Webview `main.tsx` 行为保持模块拆分、#254 Agent `Resume / 恢复` 语义和 #255 `Agent` / `Terminal` 无损输入输出与恢复链路重构。选择新的 `0.x.0` 里程碑而不是 `0.23.1`，是因为 #255 改变了执行内容权威、持久化恢复与旧 Supervisor 迁移边界，#252 / #254 同时带来用户可见交互变化；这不是同一里程碑内的纯 bugfix。`0.24.0` 继续保持 Preview 定位、主扩展 / notifier 同版本、最终 `main` ref 发布、GitHub Release assets + Open VSX verified 完成门禁和 VSM deferred 约束；release notes 必须显式保留 local PTY 不跨 Host、journal 暂无长期 retention / compact 或跨版本回退保证、旧 Supervisor session 迁移期间只读、90000 行 PTY 偶发短读未形成稳定根因，以及完整 Webview suite 基线干扰等残余风险。发布输入、安装/升级、回退、验证与 tag 命令以 `docs/public-preview-release-playbook.md` 和 `docs/notifier-preview-release-playbook.md` 为准。

> 2026-07-12 验证补充：`release-0-24-0` 已完成版本号、CHANGELOG、Marketplace / README 文案、发布手册与正式设计发布记录同步。repo-local 验证已通过版本 / 文本一致性、manifest / publish / VSIX 脚本守卫、主扩展与 notifier build / typecheck、runtime supervisor / terminal journal / execution bridge / output scheduler / serialized tracker / Webview lifecycle 与 protocol / multi-root / UI copy / canvas execution context / Agent presets / layout / notifier source / 生产部署等定向回归、Resume / Restart / Ctrl-Z `8 passed`、checkpoint / journal / revision / Unicode / 4000 events `12 passed`、`864,020` 字符 I/O benchmark、完整 `npm run test:smoke`、notifier companion 与英中 locale smoke，以及 0-vulnerability production audit。当前主扩展 VSIX 为 `dev-session-canvas-0.24.0.vsix`（`117` files，`3.73 MB` / `3,908,819 bytes`，当前产物 `sha256=41003900bf5a6ac80f578d4c2d07345dd9d0f03fbad717353aec2986f55259da`），notifier VSIX 为 `dev-session-canvas-notifier-0.24.0.vsix`（`14` files，`155.08 KB` / `158,806 bytes`，`sha256=876ea4294babb8159aa6da3dde4dfe9faa663afeba4a442257199d6be078c551`）；两者 dirty-working-tree 打包日志及 clean-checkout 主扩展打包均使用 `VSCE README doc ref: f6bbd3041d57bc654b70810577406120a8909d09`。带 `--skip-vsix-smoke` 的隔离命令已通过安装、审计、README ref 与打包；最终文案同步后，不带 skip 的 `npm run validate:clean-checkout:vsix -- --source working-tree` 也完成相同隔离守卫，并在真实 VS Code `1.128.0` packaged host 中输出 `VSIX packaged-payload smoke passed`、以 code `0` 结束。
>
> 同轮直接执行的 `npm run test:vsix-smoke` 前两次没有清洁通过：首次在 `verifyCompletedLiveRuntimeRetainsOversizedTerminalStream` 中只观察到 `89960/90000` 行，原样完整复跑则在 `verifyExplorerResourceExecutionNodeCreation` 中因 Terminal 持续 `stopping` 命中统一 timeout；两次宿主测试均以 code `1` 退出。随后隔离 clean-checkout 的同一严格 packaged suite 完整通过，形成一个 clean packaged-payload 样本，但前两次失败仍分别命中已登记的 90000 行间歇性终态短读与统一 timeout 干扰，不能被通过样本抹除。最终 publish / tag 前仍需在发布准备 MR 合入后的 clean `main` release ref 上重跑双 VSIX、clean-checkout、packaged-payload smoke 与 `publish/v0.24.0` dry-run；极端 completed stream 的设计验证状态继续保持“验证中”，直到完成分层诊断与重复压力。

> 2026-07-13 发布后复核：`0.24.0` 已从最终 `main` ref `3361158733f9814660789d02b4493e74e416d829` 通过 Actions run `29199871383` 完成 GitHub Release assets + Open VSX 兜底发布。正式 `v0.24.0` 指向同一 ref，临时 `publish/v0.24.0` 已删除；最终 manifest 为 `complete-with-deferred-visual-studio`，Open VSX 主扩展与 notifier 均 verified，Visual Studio Marketplace 双扩展因 `VSID Concurrency` 记录为 `publish-failed` / deferred，public gallery 仍为 `count=0` / `TotalCount=0`。正式主扩展 / notifier assets 的 SHA-256 分别为 `9110ae5920773d202b56483f9c4a1408bdeb36ed53947eda2e8f8db33ecca602` 与 `b13395fe6081cf91775e34c08e981b636d1deeef75be0fddce4ee049747e4484`；最终 release ref 的 clean-checkout packaged-payload smoke 已以 code `0` 通过，但 90000 行间歇性短读风险仍未关闭。发布后还确认 Release notes 生成器未自动传播 CHANGELOG 的版本特定已知边界；外部 notes 已手工补齐，本次 post-release 收口为后续 release ref 修复生成器并增加回归测试。由于 `v0.24.0` release ref 保持不可变，同版本 VSM 补发后仍必须重新复核外部 notes，不能假设后续主线修复会改变旧 ref 的执行内容。

> 2026-07-13 紧急修复发布准备：当前目标为 `0.24.1`，用户代码输入只包含 `v0.24.0` 之后已合入 `main` 的 #258 Supervisor generation 并行排空修复。该修复解决 `0.24.0` 升级后旧 Supervisor session 被强制只读且新 session 等待旧进程退出的问题：不同 storage generation 隔离 registry、socket / named pipe 与 systemd user unit；旧 session 继续路由到持有真实 PTY 的原 runtime，并支持 output、input、resize、stop 与 delete；新 session 立即进入当前 `terminal-stream-v1` generation。不同 generation 不迁移 PTY 所有权，旧 raw tail 不提升为当前 checkpoint / journal 权威。选择 `0.24.1` 符合 `docs/workflows/VERSION.md` 的同里程碑紧急 bugfix 规则，不改变 Preview 定位、主扩展 / notifier 同版本、最终 `main` ref 发布、GitHub Release assets + Open VSX verified 完成门禁或 VSM deferred 约束。

> `0.24.1` 发布说明必须保留以下验证边界：真实旧二进制迁移 smoke 当前只覆盖 Linux / Unix socket；Windows named pipe 与 systemd generation 隔离只有路径级证据；旧 Supervisor raw tail 仍可能不完整且不会补造；`0.24.0` 的 90000 行 completed terminal 间歇性尾部短读风险未关闭；#258 中 `test:smoke-storage-slot` 被既有中英文 locale fixture 漂移提前阻断。发布准备分支的自动化、双 VSIX 与 packaged-payload 证据见下方验证补充；最终 publish / tag 前仍需在 MR 合入后的 clean `main` ref 上重跑完整 gate 与 `publish/v0.24.1` dry-run。

> 2026-07-13 验证补充：`release-0-24-1-prep` 已完成版本 / 文本一致性、manifest / publish / VSIX 脚本守卫、主扩展与 notifier build / typecheck、notifier source、#258 相关 runtime supervisor paths / execution output sequence / scheduler / session bridge / Webview protocol / UI copy / canvas execution context / storage paths / serialized tracker 定向回归、Webview compatibility notice `4 passed`、真实旧二进制 `5355e6a` Linux / Unix socket 升级 smoke、notifier companion 与英中 locale smoke，以及 `651` packages 的 0-vulnerability audit。当前主扩展 VSIX 为 `dev-session-canvas-0.24.1.vsix`（`117` files，`3,909,885 bytes`，`sha256=3a49226598aa548d7bfa2dc8faab0dfc6cc6a8a0cb09c28bf04b2e00568a20bd`），notifier VSIX 为 `dev-session-canvas-notifier-0.24.1.vsix`（`14` files，`158,899 bytes`，`sha256=f965c1d1b8ffd7e915a50e40ac31b36b09a3787cfe4242b3299cd3c887881231`）；两者包含简体中文 NLS / l10n bundle，dirty-working-tree 打包日志使用 `VSCE README doc ref: 51617b649b7d454af60ed19706a5b613ec5613e1`，只能作为候选分支证据。
>
> 不带 skip 的 `npm run validate:clean-checkout:vsix -- --source working-tree` 已完整通过隔离安装、审计、`117`-file 主扩展打包和 VS Code `1.128.0` packaged-payload smoke。隔离临时 clone 在 Node `22.23.1` 上执行 `publish/v0.24.1` package-only dry-run 也已正确规划两个 VSIX 与 release manifest，并停在 package-only 阶段；临时 commit `b9332bf50e5a00b8d8579f880d1268192a17f2c8` 和本地 tag 不得推送或作为最终 release ref。发布准备时 Runtime Supervisor 协议测试曾在 Node `25.6.0` 连续两次得到 `completeFinalStatePublished: false`，而 Node `22.23.1` 单次通过；发布后的复核确认两版 Node 都会原样通过或失败，真正原因是 3 秒固定观察窗口叠加强制 multi-chunk flush 反复全量 serialize。后续修复已改为强制 drain 落定后单次 serialize，并事件驱动等待 final-state；Node 25 / 22 各连续三次通过。该修复不属于不可变的 `v0.24.1` release ref。`test:smoke-storage-slot` 本轮未重跑，Windows named pipe / systemd generation 隔离仍只有路径级证据，90000 行间歇性短读风险也未关闭。最终 publish / tag 前仍需在发布准备 MR 合入后的 clean `main` ref 上重跑完整 gate 与不带绕过参数的 `publish/v0.24.1` dry-run。

> 2026-07-14 发布后复核与 `0.24.2` 决策：`0.24.1` 已从最终 `main` release ref `51dd07ed95f0e26db184cd4ce14decd5ce2721f7` 完成 GitHub Release assets + Open VSX 兜底发布；正式 `v0.24.1` 指向同一 ref，临时 `publish/v0.24.1` 已删除。最终 manifest 为 `complete-with-deferred-visual-studio`，Open VSX 主扩展与 notifier 均 verified，Visual Studio Marketplace 双扩展记录为 `publish-failed` / deferred，2026-07-14 public gallery 对两个 extension id 仍为 `count=0` / `TotalCount=0`。正式主扩展 / notifier assets 的 SHA-256 分别为 `fcae9ea4a00563d18a022b404597a36c9c0c28cd87791bdfb4a271402f22bcf9` 与 `874488c00ec9eb80f01c1b7b2b69ba78b94fd371a902b67f057159e88aa10a88`。
>
> 本轮发布版本选择 `0.24.2`。相对 `v0.24.1` 的输入只包含已合入 `main` 的 #261 Fork 定向展开与生成节点避碰、#262 Runtime Supervisor 跨 Node 终态门禁收口，以及 #263 无损 journal 安全 compact。选择 `0.24.2` 而不是新的 `0.25.0`，是因为三项变化继续收口 `0.24.x` 已建立的 Agent / Terminal 无损恢复与 Fork 工作流，没有改变扩展身份、稳定支持承诺、provider 命令契约、通知协议或服务 API 主版本；但它们同时包含用户可见能力和持久化机制变化，因此 release notes 必须完整说明，而不能包装成纯打包修复。`0.24.2` 继续保持 Preview 定位、主扩展 / notifier 同版本、最终 `main` ref 发布、GitHub Release assets + Open VSX verified 完成门禁和 VSM deferred 约束。
>
> 本轮 release notes 保留以下验证边界：checkpoint 无法证明安全、超过 256 KiB、producer profile 缺少兼容 fallback 或恢复代不可用时，会停止 compact 并继续增长 journal；当前无固定磁盘上限、完整长期 retention 策略或跨版本回退保证；90000 行 completed stream 已出现 `89861`、`89960`、`89877` 三个间歇性短读样本且未定位，#262 只修复固定等待与重复 serialize，不关闭该风险；Fork 的 panel / editor 人工视觉验收尚未完成，自动 File 节点真实初始宽度仍可能超过 220 x 84 估算；`trusted` / `real-reopen` 各有一次非内容性 smoke harness 时序误报并已登记技术债。发布准备分支与最终 `main` ref 的自动化、双 VSIX、packaged-payload 与 dry-run 证据分别记录如下；最终 publish / tag 已在 MR 合入后的 clean `main` ref 上重跑完整 gate 与 `publish/v0.24.2` package-only dry-run。

> 2026-07-14 验证补充：`release-0-24-2-prep` 已完成版本 / 文本一致性、manifest / publish / VSIX / production deploy 脚本守卫、主扩展与 notifier build / typecheck / source、canvas placement / groups / multi-root / layout / UI copy、serialized tracker / journal / Supervisor protocol / paths / output sequence / Webview protocol、notifier companion 与英中 locale smoke，以及 0-vulnerability production audit。10-Agent Supervisor 样本处理 `828,019` 字符，input response `19.58ms`、echo `30.58ms`。严格 `trusted`（含 90000 行断言）与两阶段 `real-reopen` 一次通过；真实旧二进制 `5355e6a` upgrade smoke 首次等待 resize cols/rows 收敛超时，原样复跑通过。Fork / journal 等 16 项 Webview 目标均获得通过证据，但聚合命令两次在同一 Fork 按钮 stable 等待处超时；隔离该项 `1 passed`、其余 `15 passed`，因此不宣称聚合清洁通过，两类 flaky 已写入技术债。
>
> 发布准备候选主扩展 / notifier VSIX 分别为 `3,925,963` / `159,017` bytes，SHA-256 分别为 `f57db4d29706c123ee8cb59e591c3bdca24a84830cb6f71c3768e05dc54e704c` / `3e9a56d38586195032baf4d9117f0fea0923fe44006d29d375896aab0c609163`，dirty-tree README ref 为 `fc427c6ed38c97c25f183e95216d35b19b1bc311`。不带 skip 的 clean-checkout 已通过隔离 `npm ci`、0-vulnerability audit、`117`-file 主扩展打包与 VS Code `1.128.0` packaged-payload smoke；Node `22.23.1` 隔离临时 ref `3e5dc0417efe12a14cb8cc27bff90a32c07da242` 也通过 `publish/v0.24.2` package-only dry-run。候选工件与临时 ref 没有作为最终 Release assets；最终 `main` release ref 已重新执行完整 gate。

> 2026-07-14 `0.24.2` 发布后验证补充：Actions run [`29309330723`](https://github.com/ZY-WANG-0304/dev-session-canvas/actions/runs/29309330723) 已从最终 `main` release ref `c1e13b754d6a1f7be85d14b5d908967d464e1c6a` 成功完成发布。正式 `v0.24.2` 指向同一 ref，临时 `publish/v0.24.2` 已删除；最终 manifest 为 `complete-with-deferred-visual-studio`，两个 artifact 条目的 `packagingDocRef` / `readmeDocRef` 均为最终 release ref。Open VSX 主扩展与 notifier 均为 `version=0.24.2`、`verified=true`；Visual Studio Marketplace 双扩展记录为 `publish-failed` / deferred，public gallery 对两个 extension id 的独立查询仍为 `count=0` / `TotalCount=0`。
>
> 正式主扩展 / notifier / manifest assets 分别为 `3,925,962` / `159,016` / `3,104` bytes，SHA-256 分别为 `8e5c125987b51eb815ac80bd138583f178100528653f8558ece0919b51673ac5`、`304f1917ffd17f4096b7391f62a3f02508de50c26315ff573e785b5fa5ba7bba` 与 `3b05f15c8a8dbb3923cc28bb8386324c66d7b338836adb5aabfcc208caec3c75`。最终 `main` 上 `npm ci` 安装 `651` packages 且报告 0 vulnerabilities；发布 / manifest / VSIX / 双市场 / production deploy workflow 守卫、主扩展与 notifier build / typecheck / source、Fork / placement / groups / multi-root / layout / UI copy、journal / serialized tracker / Supervisor protocol / paths / output 回归均通过。10-Agent 样本处理 `828,019` 字符，input response `10.67ms`、echo `20.9ms`；最终 ref 的 package-only dry-run 在推送临时 tag 前通过，`validate:clean-checkout:vsix -- --ref c1e13b7` 也完成独立 `npm ci`、`117`-file VSIX 与 VS Code `1.128.0` packaged-payload smoke，并以 code `0` 结束。
>
> 同一成功 run 对仍以 Node.js 20 为目标的 `actions/checkout@v4`、`actions/setup-node@v4`、`actions/upload-artifact@v4` 与 `actions/download-artifact@v4` 发出被强制运行在 Node.js 24 的 deprecation annotation。该警告不改变本次发布已成功的结论；action 版本升级与 publish workflow 回归作为独立非阻塞技术债继续跟踪。


> 2026-06-08 流程更新：后续发布输入改为由临时 tag `publish/vX.Y.Z` 固定。该 tag 只表示 publish intent，发布成功并验证双市场主扩展 / notifier 四个目标后，由发布脚本创建正式 `vX.Y.Z` tag 并删除临时 `publish/` tag。release manifest 记录 VSIX sha256、README doc ref、marketplace 验证结果和 tag 状态，但不写回代码库，只作为 GitHub Actions artifact / GitHub Release asset 保存。

> 2026-06-13 流程更新：当前自动化发布路线在继续执行 Visual Studio Marketplace / Open VSX 发布与验证的基础上，增加 GitHub Release assets 镜像。`publish/vX.Y.Z` 仍固定 release input；workflow 在 Release 不存在时先打包主扩展与 notifier VSIX、生成 release manifest、创建或确认正式 `vX.Y.Z` tag，并把两个 VSIX 与 manifest 上传到该 tag 对应的 GitHub Release assets；同版本重跑时如果 Release 已有完整 assets，则下载并校验既有 manifest / VSIX，不重新打包或覆盖 VSIX，若 Release assets 不完整则 fail closed。GitHub 不支持裸 tag assets，因此对外口径必须写成“`vX.Y.Z` 对应 GitHub Release 的 Assets”。随后 workflow 复用同一批 VSIX 发布并验证 Visual Studio Marketplace / Open VSX；只有这些 marketplace 目标成功后才删除临时 `publish/` tag。由于 Release assets 需要先绑定正式 tag，单看 `vX.Y.Z` 存在不再足以判断整轮发布完成，完整完成条件还包括 marketplace 验证成功、最终 manifest 更新和临时 tag 删除。

> 2026-06-14 流程更新：`0.15.2` 真实发布中 Visual Studio Marketplace 出现 `VSID Concurrency` 限流，证明两个 marketplace 的失败域不能串行绑定。后续 workflow 改为先准备 / 上传 GitHub Release assets，再并行执行 Open VSX 与 Visual Studio Marketplace 两个发布 job；两个 job 均使用同一批 VSIX 和 `--no-create-final-tag`，任一失败都不阻断另一方。finalize job 在两个 marketplace job 成功、失败或缺 secret 后都会合并可用 manifest、覆盖 GitHub Release manifest，并用 `CHANGELOG.md` 当前版本段落与 manifest 重新生成 GitHub Release notes；Release notes 必须包含版本亮点、渠道状态、残余风险和发布证据。自 2026-06-15 起，`0.16.0` release-day 完成门禁调整为 GitHub Release assets 已上传且 Open VSX 主扩展 / notifier 均 verified；Visual Studio Marketplace 仍会尝试发布和验证，但其 public gallery 不可见状态被记录为 deferred channel，不阻塞本轮完成。达到当前完成门禁后 workflow 可删除 `publish/vX.Y.Z`；若 Open VSX 失败则保留临时 tag 供同一 release input 重跑。失败的 Open VSX job 会在上传自身 result manifest 后标红，使 GitHub Actions 的 Re-run failed jobs 能实际重试失败渠道，而不是只重跑 finalize。

## 1. 背景

当前仓库已经具备基于 VSIX 工件的打包基线，但这次 `Preview` 的对外分发目标已经明确切到公开 `Marketplace` 发布，不再把 `.vsix` 作为普通用户分发方式。

这意味着“能在本地打一个 VSIX 工件”与“已经适合通过 Marketplace 对外公开发布”不是一回事。若要把当前扩展发布到公开平台，必须先明确哪些是工程 blocker，哪些是渠道账号问题，哪些是产品与支持承诺。

## 2. 问题定义

需要回答的问题不是“如何执行一次 `vsce publish`”，而是“把当前 Preview 仓库转成一个可对外公开安装、可追踪支持、可重复发布的扩展，需要补齐哪些工作”。

本次研究以 2026-04-11 的仓库状态为准，重点覆盖以下范围：

- 当前发布包是否已经收口到公开分发可接受的最小运行集。
- 当前 manifest、README、许可证和链接是否已经适合公开渠道。
- 若选择公开平台，先发 `Visual Studio Marketplace` 还是同时发 `Open VSX`。
- 后续应如何把这项工作拆成可执行的工程与发布步骤。

## 3. 目标

- 明确当前仓库距离公开平台发布还缺哪些工作。
- 区分硬 blocker、推荐补齐项和可后移项。
- 给出一个保守、可执行的渠道策略，而不是同时承诺多个公开平台。
- 把研究结论落成正式文档，避免后续协作者只凭零散讨论推进发布。

## 4. 非目标

- 本轮不直接把扩展发布到任何公开平台。
- 本轮不把“是否要公开发布”写成已确认产品结论。
- 本轮不承诺已经具备面对外部用户的稳定性、支持 SLA 或兼容矩阵。

## 5. 候选发布渠道

### 5.1 `Visual Studio Marketplace`

这是当前已选定的首发渠道。原因有三点：

- 当前产品是标准 VS Code workspace extension，主宿主和目标用户路径都围绕 VS Code 本体。
- 官方发布文档直接覆盖 publisher 创建、PAT 登录、`@vscode/vsce` 打包与发布链路。
- 当前仓库已有可复用的打包脚本与 VSIX smoke，离该渠道最近。

### 5.2 `Open VSX`

`Open VSX` 已从延后决策更新为后续公开发布的补充同步渠道。它不取代 `Visual Studio Marketplace` 作为官方 VS Code 用户的主安装路径，也不自动扩大当前兼容宿主支持矩阵；它的定位是让 VSCodium、Theia、code-server、Gitpod 等使用 Open VSX 的 VS Code 兼容宿主能够获取同版本 VSIX。

截至 2026-05-15，`devsessioncanvas` namespace 已创建并完成 owner/verified 认领。后续 release-day 默认应把主扩展与 notifier companion 的同一组最终 VSIX 同步发布到 `Visual Studio Marketplace` 与 `Open VSX`。

## 6. 当前现状

截至 2026-05-05（以当前 `0.5.0` 候选 release 输入快照对应的工作树为准），仓库里已经成立的事实如下；2026-06-29 之后的当前仓库事实是主扩展 manifest、Marketplace README 与 CHANGELOG 已迁入 `extensions/vscode/dev-session-canvas/`，仓库根 `package.json` 只是 private workspace root。

- `extensions/vscode/dev-session-canvas/package.json` 具备基础扩展元数据，且仍标记为 `preview: true`；根 `package.json` 不再是 VS Code extension manifest。
- 主扩展当前通过 `extensionPack` 聚合 notifier companion，而 notifier companion 继续单向依赖主扩展；用户从主扩展页面安装时会自动带上 notifier，从 notifier 页面安装时也会自动补齐主扩展。
- `README.md` 已明确写成“产品已处于公开 Preview 阶段”；发布执行与对外口径已收口到 `docs/public-preview-release-playbook.md`。
- notifier companion 的独立发布手册已收口到 `docs/notifier-preview-release-playbook.md`。
- 许可证已选定为 `Apache-2.0`。
- `repository`、`homepage` 和 `bugs` 已切换到公开 GitHub 地址。
- 发布工具链已迁移到 `@vscode/vsce`，`scripts/release/package-vsix.mjs` 也已兼容 `.bin/vsce` 与包内 CLI 脚本两条本地入口。
- `scripts/release/package-vsix.mjs` 当前会 staging `extensions/vscode/dev-session-canvas/` 主扩展子包，并在打包阶段显式传入 `--readme-path README.marketplace.md`，确保后续 `publish --packagePath` 上传的现成 VSIX 已内嵌 Marketplace 专用 README，而不是依赖发布时重新替换。
- `scripts/release/package-vsix.mjs` 默认会把 `extensions/vscode/dev-session-canvas/README.marketplace.md` 的相对资源按主扩展子包 base 改写到当前 `HEAD` 对应的最终 git ref；若在不含 `.git` 元数据的 clean checkout 或导出目录中打包，则必须显式传入 `DEV_SESSION_CANVAS_VSCE_DOC_BRANCH=<final-ref>`，并在打包前校验这些相对资源能在该 ref 上解析成功。
- 当前工作树已能稳定执行 `npm run package:vsix`，生成 `dev-session-canvas-0.5.0.vsix`（约 `2.17 MB`、`49 files`），并再次通过 `npm run test:vsix-smoke`。
- 当前 `working tree` 快照已再次通过隔离 `clean checkout` 打包验证，可在干净目录内稳定产出 `dev-session-canvas-0.5.0.vsix`（约 `2.17 MB`、`49 files`）；packaged-payload smoke 继续通过单独执行 `npm run test:vsix-smoke` 复核。
- 当前候选 release 输入快照也已再次通过隔离 `clean checkout` 验证，说明这轮瘦身后的最小 Preview 工件已经固定到可追溯提交。
- 仓库已补上 `validate:clean-checkout:vsix` 隔离验证入口，可在 `/tmp` 下准备 clean checkout 验证，不必直接扰动当前工作树。
- 当前对外分发主路径已确定为 `Visual Studio Marketplace Preview`，而不是手动分发 `.vsix`；`Open VSX` 已完成 namespace 认领，后续作为补充公开渠道与官方市场保持同版本发布。
- `node-pty` 依赖包已完成第二轮收口，VSIX 当前只保留运行时 `lib/*.js`、所需 `prebuilds` 原生文件，以及运行时仍会解析的 `package.json` / `LICENSE`。
- `scripts/smoke/run-vscode-vsix-smoke.mjs` 现会在 packaged-payload smoke 前显式校验：VSIX 不再携带 `.github/`，也不再携带 `node-pty` 的 `binding.gyp`、`scripts/`、`src/`、`third_party/`、`typings/`、嵌套 `node_modules/` 或 `.pdb`。
- `remote-ssh-real-reopen` 的 storage 恢复链路已进一步修复多 slot 场景：当前实现会扫描同一 canonical workspace id 下的 sibling slots，按 snapshot 时间戳选择最新 source；若 source 不等于 current slot，只迁回 `canvas-state.json` 并由 current slot 继续写主快照，而 live-runtime 继续绑定 source slot 的 `runtimeStoragePath`。仓库已补 `scripts/test/test-extension-storage-paths.mjs` 与 `npm run test:smoke-storage-slot` 作为自动化回归，验证 slot 选择、主快照写回以及 `stateHash` 一致性。
- 当前首发主路径已完成一轮人工验收，用户反馈为“人工验收没发现问题”。
- 已补齐 GitHub issue 模板与 `docs/support.md`，普通反馈、安全问题和 Preview 支持边界已有固定入口。

## 7. 剩余 release-day 动作与后续跟踪

### 7.1 发布包治理已收口到当前候选 release head，但最终发布引用仍需复核

当前仓库已经完成第二轮发布包治理。当前本地工作树与当前候选 release 输入快照的发布包都已显著收紧，并完成了 clean-checkout 复核；剩余问题只在于最终对外发布若不直接使用当前已验证的 git ref，仍需对最终发布引用补最后一轮复核。

本地证据：

- 第一轮收口前，仓库内曾出现约 `293 MB` 的 VSIX，并把 `.debug/playwright/`、`.debug/vscode-smoke/` 等调试缓存一起打入包内。
- 当前工作树在第二轮收紧 `.vscodeignore` 后，`npm run package:vsix` 已可稳定产出 `dev-session-canvas-0.5.0.vsix`（约 `2.17 MB`、`49 files`）。
- 当前 `npm run test:vsix-smoke` 已再次通过，说明第二轮收口后的 packaged payload 仍能独立启动并跑通 trusted smoke。
- 当前 packaged-payload smoke 还会在解包阶段显式校验 VSIX 不再携带 `.github/`，以及 `node-pty` 的 `binding.gyp`、`scripts/`、`src/`、`third_party/`、`typings/`、嵌套 `node_modules/` 与 `.pdb` 等冗余内容。
- 基于当前 `working tree` 快照的 clean-checkout 证据已经更新到 `2.17 MB`、`49 files`；由于当前工作树与候选 release head 已一致，这轮候选发布输入也应以同一组最小工件证据为准。
- 截至 `2026-04-28`，Linux、macOS、Windows 本地 workspace 的 `Agent` / `Terminal` / `Note` 主路径已补齐当前轮功能可用性验证；Windows 下使用 `Codex` 时执行节点内历史仍有无法向上翻页的已知问题。

因此，当前只需保持以下约束与 release-day 动作：

- 保持当前 `.debug/`、`.playwright-browsers/`、测试 artifacts、core dump、截图草稿等路径继续留在发布包外，不让后续改动把它们重新带回工件。
- 若真正对外发布使用的是后续 merge commit、tag 或其他最终 release ref，发布前再对该 git ref 重跑一次 `validate:clean-checkout:vsix`，并确保 `package:vsix` 的 README 改写 ref 也锁定到同一个 final ref，避免把当前候选 release 输入快照的证据直接等同于最终发布输入。
- 保持 packaged-payload smoke 的内容守卫，确保 `node-pty` 的源码、脚本、PDB 与重复依赖不会重新随着后续改动回流到 VSIX。

### 7.2 公开元数据与法律口径已收口，当前只需一致性复核

当前仓库的公开元数据和对外发布口径已经完成当前轮次收口：

- README、CHANGELOG、SECURITY、issue 模板与 `docs/support.md` 已完成第一轮公开 Preview 收口，普通反馈、安全问题和 Preview 支持边界已有固定入口。
- 当前已补齐 `extensions/vscode/dev-session-canvas/README.marketplace.md` 与 `docs/public-preview-release-playbook.md`，把 Marketplace listing 草案、release notes 使用口径、升级说明和回滚口径收口成正式仓库文档；自 `0.10.1` 发布准备起，主扩展子包内 `README.marketplace.md` 是默认英文 listing，`README.marketplace.zh-CN.md` 仅作为仓库内中文对应版保留。

真正执行发布前，仍需完成以下复核：

- 继续按 `extensions/vscode/dev-session-canvas/README.marketplace.md`、`extensions/vscode/dev-session-canvas/CHANGELOG.md` 与 `docs/public-preview-release-playbook.md` 复核商店页面与仓库文档的一致性。
- 继续复核 README、CHANGELOG、SECURITY、issue 模板和支持边界说明，确保它们与最终发布事实一致。

### 7.3 渠道账号与凭证已就绪，发布前只需确认可用性

当前与 `Visual Studio Marketplace` 相关的发布账号链路已经打通：

- `devsessioncanvas` publisher 已创建并确认可用。
- Azure DevOps organization 与 Personal Access Token 已完成准备。
- 本地 `vsce login devsessioncanvas` 已完成，当前只需在真正发布前确认登录仍然有效。

`Open VSX` 的 namespace 与凭证链路已经从“待准备”更新为“可发布前复核”：

- `devsessioncanvas` namespace 已创建并完成 owner/verified 认领。
- 发布 token 应保存在 `OVSX_PAT` 或本地 `~/.ovsx` file store 的 `devsessioncanvas` entry 中，不写入仓库。
- 当前默认发布入口是 `npm run publish:marketplaces -- --yes`；它会使用 `@vscode/vsce` 发布到 `Visual Studio Marketplace`，并使用 `scripts/release/openvsx-api.py` 发布到 `Open VSX`。该 Python API helper 是对本地 headless Linux 环境中 `npx ovsx` 出现 secret-service / TLS reset 问题的工程绕行，不改变最终调用的 Open VSX Registry API。
- 两个市场必须保持同版本同步发布；若某个市场发布失败，后续补发必须用同一个最终 git ref 和同一组 VSIX，并在发布记录中说明临时偏差。

因此，当前 release-day 不再把账号创建视为 blocker；真正需要做的是在发布前再次确认这些凭证仍可用。

### 7.4 平台支持矩阵已升级为“四条主路径已验证 + Remote SSH 继续为主推荐路径”

当前验证证据最强的路径仍集中在 `Remote SSH` 开发路径、`Restricted Mode` 和 VSIX smoke；截至 `2026-04-28`，`Remote SSH` 主路径以及 Linux、macOS、Windows 本地 workspace 的 `Agent` / `Terminal` / `Note` 主路径都已补齐当前轮功能可用性验证。当前公开 `Preview` 的支持矩阵因此不再是“本地可尝试但未严格验证”，而是“`Remote SSH` 与桌面三平台主路径都已验证可用，其中 `Remote SSH` 仍是最推荐环境，Windows 仍保留一条显式已知限制”：

- Linux、macOS 本地路径可以按 `Preview` 主路径写成“已验证可用”，但仍不升级成稳定版承诺。
- Windows 本地路径可以写成“已验证可用”，同时必须显式保留“使用 `Codex` 时执行节点内历史当前无法向上翻页”的已知限制。
- `Restricted Mode`、`Virtual Workspace`、CLI 依赖和 runtime guarantee 边界继续保持原有口径，不因为这轮桌面三平台可用性验证而被误写成全量稳定支持。
- 后续技术债不再是“本地三平台是否可用”，而是“Windows 下 `Codex` 历史翻页问题是否收口”“跨平台自动化矩阵是否补齐”以及“更强 runtime guarantee 是否在非 Linux backend 上闭合”。

当前对外口径已经收敛为以下矩阵：

| 场景 / 能力 | 当前状态 | 对外口径 |
| --- | --- | --- |
| `Remote SSH` workspace | `Preview`，主路径已验证且验证最充分 | 当前最强验证证据所在路径，可作为公开 Preview 的主推荐场景 |
| Linux 本地 workspace | `Preview`，主路径已验证 | 当前轮功能可用性验证已完成，但仍维持 `Preview` 口径 |
| macOS 本地 workspace | `Preview`，主路径已验证 | 当前轮功能可用性验证已完成，但仍维持 `Preview` 口径 |
| Windows 本地 workspace | `Preview`，主路径已验证（含已知限制） | 当前轮功能可用性验证已完成；使用 `Codex` 时执行节点内历史仍无法向上翻页 |
| `Restricted Mode` | 有限支持 | 允许打开画布，但禁用执行型入口 |
| `Virtual Workspace` | 不支持 | 不在当前公开 Preview 范围内 |
| `Agent` 节点 | 依赖外部 CLI | 需要 `codex` 或 `claude` CLI 可被 Extension Host 解析 |
| `Terminal` 节点 | 依赖工作区侧 shell | 需要当前工作区侧可用 shell |
| `runtimePersistence.enabled = false` | 基线支持 | 不承诺真实进程跨 VS Code 生命周期持续存在 |
| `runtimePersistence.enabled = true` | `Preview` 能力，已具备较多验证证据 | 已有 `Remote SSH` real-reopen 自动化、相关 smoke 与人工验证证据；当前用户可见 guarantee 仍取决于 backend 与平台组合。Linux 本地与 `Remote SSH` 在 `systemd --user` 可用时优先尝试更强 guarantee，否则回退到 `best-effort` |

补充说明：截至 `2026-04-28`，`Remote SSH` 主路径与 Linux、macOS、Windows 本地路径的当前轮功能可用性验证都已补齐；其中 `Remote SSH` 仍是当前最强验证证据所在路径。仍需显式保留的剩余限制是 Windows 下 `Codex` 历史无法向上翻页，以及三平台自动化矩阵尚未完全补齐。

### 7.5 发布流水线最小 CI 化

当前仓库已经有本地打包脚本、VSIX smoke 与 clean-checkout 验证入口；自 2026-06-08 起，release-day 的发布动作迁入最小 GitHub Actions wrapper：`publish/vX.Y.Z` tag 固定发布输入，workflow 负责 checkout、`npm ci`、调用本地 `release:publish-tag` 和上传发布产物。自 2026-06-13 起，workflow 在 Visual Studio Marketplace / Open VSX 发布与验证之外增加 GitHub Release assets：首次运行时用 `--package-only` 打包并生成 manifest，创建或确认正式 tag，创建 / 更新对应 GitHub Release 并上传两个 VSIX 与 manifest；同版本重跑时若 Release 已有完整 assets，则下载并用 `--skip-package --package-only` 校验既有 manifest / VSIX，不重新打包或覆盖 VSIX。自 2026-06-14 起，Open VSX 与 Visual Studio Marketplace 在 workflow 中拆成两个独立目标步骤：任一 marketplace 发布或验证失败都不阻断另一 marketplace 尝试发布和验证；两个目标都跑完后，workflow 根据最终 manifest 上传 release manifest 并重新生成 GitHub Release notes。GitHub Release 创建、assets 上传、最终 manifest / Release notes 覆盖和临时 tag 删除由 workflow 负责；当前完成门禁是 GitHub Release assets 已上传且 Open VSX 主扩展 / notifier 均发布验证成功；`0.24.2` 沿用该门禁。Visual Studio Marketplace 仍会尝试发布 / 验证并写入 manifest，但当前允许延期补发，不阻塞临时 tag 删除；Open VSX 失败时保留 `publish/vX.Y.Z` 供同一 release input 重跑。失败的 Open VSX job 会在上传自身结果 manifest 后标红，使 GitHub Actions 的 Re-run failed jobs 能实际重试失败渠道，而不是只重跑 finalize。workflow 触发范围必须保持收窄：只响应 `publish/v*` tag push 与手动 `workflow_dispatch`，不响应普通分支、普通 tag 或 release 分支创建，避免 Actions 列表出现 skipped publish run 并干扰发布判断。

当前轮次仍需保留的最小手工 gate 是：

- 在干净环境中执行 `npm ci`、按最终 git ref 锁定 README 改写目标后的 `npm run package:vsix`、VSIX 内容校验和发布前 smoke；GitHub Actions 发布路径会重新打包并上传 Release assets，但不替代发布准备 MR 阶段的人工 gate。
- 让 `@vscode/vsce` 成为唯一受支持的打包入口，并把当前脚本 fallback 行为纳入发布前检查。
- 在真正触发发布前，使用 `npm run release:publish-tag -- --trigger-tag publish/vX.Y.Z --dry-run --package-only` 预览 release ref、VSIX 计划与 manifest，避免临场操作漂移。

当前不在本轮把完整 PR 测试矩阵或 VSIX smoke 全量迁入 CI；若后续要继续降低人为发布风险，再把版本号、预发布标记、release note 检查、Release notes 生成和双渠道发布继续自动化。

## 8. 风险与取舍

- GitHub Release assets 是 marketplace 同批 VSIX 的镜像与兜底下载入口；`0.16.0` 起的当前完成门禁允许在 Visual Studio Marketplace public gallery 仍不可见时，仅以 GitHub Release assets + Open VSX verified 作为可完成状态；`0.24.2` 沿用该门禁。因为 workflow 会先创建正式 tag 以绑定 Release assets，单看 `vX.Y.Z` 存在不再足以证明整轮发布完成；必须结合最终 manifest、Open VSX verified 状态、Visual Studio Marketplace 是否 deferred，以及 `publish/vX.Y.Z` 是否已删除判断。同版本重跑必须复用并校验既有 Release assets，不能重新打包覆盖 VSIX，因为当前 VSIX 打包不承诺 byte-for-byte 可复现。Release notes 也必须随最终 manifest 更新，显式展示版本亮点、渠道状态、残余风险和发布证据，不能只保留通用安装模板。
- 若后续版本在许可证、公开链接和支持口径失配时贸然上架，商店页面会把仓库内部事实包装成外部承诺，后续回收成本更高。
- 若只解决 publisher / PAT 而不先治理发布包，公开发布过程会被包体污染、内容漂移和不可重复打包持续阻断。

## 9. 正式方案

### 9.1 方案说明

- `0.5.0` 的公开 `Marketplace Preview` 正式发布输入固定为当前候选 release 输入快照（即当前 `release-v0-5-0-prep` 最新 head 对应、且已通过 clean-checkout 复核的工作树内容）验证通过的最小 VSIX 工件：`dev-session-canvas-0.5.0.vsix`。当前仓库内证据为 `49 files`、约 `2.17 MB`，生成入口是 `scripts/release/package-vsix.mjs`，隔离复核入口是 `npm run validate:clean-checkout:vsix -- --source working-tree`。
- 首发渠道正式收敛为 `Visual Studio Marketplace`；该历史决策仍适用于 `0.5.0` 首发复盘。自 2026-05-15 起，后续公开发布默认将 `Open VSX` 作为补充渠道同步发布同版本 VSIX；自 2026-06-13 起，当前自动化发布在继续分发并验证 Visual Studio Marketplace / Open VSX 的同时，把同一批 VSIX 作为 GitHub Release assets 归档，供 marketplace 访问、审核或同步暂时不可用时手动安装。自 2026-06-15 的 `0.16.0` release-day 起，当 Visual Studio Marketplace public gallery 持续不可见且 Open VSX 可验证时，允许把 Visual Studio Marketplace 作为 deferred channel 补发，不再阻塞本轮 GitHub Release assets + Open VSX 兜底完成；`0.24.2` 继续沿用该完成门禁，除非 VSM 可见性恢复。
- 对外发布口径以 `README.md`、`extensions/vscode/dev-session-canvas/README.marketplace.md`、`extensions/vscode/dev-session-canvas/CHANGELOG.md`、`docs/public-preview-release-playbook.md`、`docs/notifier-preview-release-playbook.md` 与 `docs/support.md` 为唯一仓库内正式来源。主扩展子包内 `README.marketplace.md` 是 Marketplace 打包入口和默认英文 listing，中文对应文案只保留在 `extensions/vscode/dev-session-canvas/README.marketplace.zh-CN.md`。`0.5.0` 对外内容聚焦 `Dev Session Canvas Notifier` companion 的公开发布与自动安装关系、attention signal 的 `system` 桥接路径，以及嵌入式 `Terminal` shell 的动态探测 / 精确路径持久化 / workspace 级覆盖能力，同时继续保留“`Remote SSH` 与桌面三平台主路径已验证”以及“Windows 下 `Codex` 无法向上翻页”的已知限制。

### 9.2 适用范围与边界

- 本方案原始部分覆盖 `0.5.0` 公开 `Marketplace Preview` 的仓库内准备与 release-day 执行；2026-05-15 的更新只确认后续 release-day 的双市场同步发布机制，不把“已经具备稳定版 SLA”或“所有 Open VSX 兼容宿主均完整支持”写成既成事实。
- 适用的发布输入必须与上述正式文档保持一致；若真正发布使用的不是当前候选 head，而是后续 merge commit、tag 或其他最终 git ref，则必须基于最终 ref 重新执行 clean-checkout 打包验证，并复核 `extensions/vscode/dev-session-canvas/README.marketplace.md` 的资源改写 ref。
- 支持矩阵继续以 `Remote SSH` 与桌面三平台主路径已验证为基础，但不把 `Restricted Mode`、`Virtual Workspace`、CLI 依赖边界或更强 runtime guarantee 误写成全量稳定支持。

### 9.3 核心规则与不变量

- `scripts/release/package-vsix.mjs` 必须继续从 `extensions/vscode/dev-session-canvas/` staging 主扩展发布包，并显式传入 `--readme-path README.marketplace.md`；README 资源改写 ref 必须与最终发布 ref 一致，不允许依赖发布时临时替换文案来修正文档内容。
- `scripts/release/publish-marketplaces.mjs` 仍是 Marketplace / Open VSX 的底层发布入口；当前 GitHub Actions 首次运行通过 `scripts/release/publish-tag-release.mjs --package-only` 先打包并准备 GitHub Release assets，同版本重跑先下载并校验既有 Release assets，再通过 `--skip-package` 复用同一批 VSIX 调用 marketplace 发布与验证逻辑。
- `npm run validate:clean-checkout:vsix` 与 `npm run test:vsix-smoke` 是发布前必须保留的最小证据链；只要工件大小、文件数或 packaged payload 内容发生变化，就必须同步刷新本设计文档与相关发布文档中的证据。
- 正式安装真相必须继续保持为“主扩展 `extensionPack` 聚合 notifier + notifier 单向 `extensionDependencies` 回补主扩展”，且两侧都保持 `"api": "none"`；这样才能继续兼顾主扩展安装时自动带上 companion、notifier 单独安装时自动补齐主扩展，以及跨 host 场景下只靠 commands 完成协作。
- `.debug/`、`.playwright-browsers/`、`.github/`、`node-pty` 的源码/脚本/PDB/重复依赖等冗余内容必须继续留在 VSIX 之外，避免包体回涨或引入不可追溯内容；相关内容守卫继续由 `scripts/smoke/run-vscode-vsix-smoke.mjs` 负责。
- 发布账号、PAT、Marketplace listing 草案、GitHub Release notes 口径、Release assets 清单与支持入口只要发生变化，都必须回写到仓库正式文档，而不是只停留在外部聊天或 MR 评论。

### 9.4 Publish tag 发布输入固定规则

自 2026-06-08 起，后续公开 Preview 发布的正式流程从“在最终 `main` ref 上手工 publish 后补 tag”升级为“临时 publish tag 固定输入，脚本成功后创建正式 tag”。维护者仍必须先完成 release prep MR 并合入 `main`，但真正触发发布时不再从当前 shell 的 `HEAD` 推断 release ref，而是在最终 release commit 上创建 `publish/vX.Y.Z`。这个 tag 的 peeled commit 是本次 release input，`scripts/release/publish-tag-release.mjs` 和 `.github/workflows/publish-marketplace-release.yml` 都必须围绕该 commit 进行校验、打包、Release assets 上传和 tag 收口。

核心不变量如下：

- `publish/vX.Y.Z` 只表示发布意图和固定输入，可以在发布失败时保留并重跑；它不是正式 release tag。若 GitHub Release 已有完整 assets，重跑必须复用并校验这批 assets；若 Release assets 不完整，workflow 必须失败并等待人工修复。
- `vX.Y.Z` 是正式 lightweight release tag，也是 GitHub Release 绑定的 tag；workflow 会在首次打包后、marketplace 发布验证前创建或确认它，以便先上传 Release assets；后续同版本重跑会复用并校验该 Release 上的既有 VSIX / manifest。单看该 tag 存在不再足以证明整轮发布完成；当前完成条件是 Release assets 已上传、Open VSX 已发布并验证、Visual Studio Marketplace 状态已明确记录为 verified 或 deferred、最终 manifest 已更新，且 `publish/vX.Y.Z` 已删除；`0.24.2` 继续沿用该条件。
- `release-artifacts/release-manifest-X.Y.Z.json` 由发布脚本生成，记录 `version`、`releaseRef`、`triggerTag`、`finalTag`、VSIX sha256、README doc ref、GitHub Release assets 状态、marketplace 发布 / 验证状态和 tag 状态；它必须作为 GitHub Release asset 保存，不提交回仓库。
- 打包时必须显式把 `DEV_SESSION_CANVAS_VSCE_DOC_BRANCH` 和 `DEV_SESSION_CANVAS_EXPECTED_RELEASE_REF` 绑定到 `publish/vX.Y.Z` 指向的 commit；`--skip-package` 恢复发布必须验证已有 manifest 与 VSIX sha256 匹配，避免复用旧包。
- 发布成功后，workflow 可以删除远端和本地 `publish/vX.Y.Z`，前提是正式 `vX.Y.Z` 已存在且指向同一 release ref、GitHub Release assets 已上传成功、Open VSX 发布与验证均已成功，且 Visual Studio Marketplace 已写入 verified 或 deferred 状态。

## 10. 验证方法

本研究依赖以下证据来源：

- 仓库内根 `package.json`、`extensions/vscode/dev-session-canvas/package.json`、`README.md`、`extensions/vscode/dev-session-canvas/CHANGELOG.md`、`docs/public-preview-release-playbook.md`、`docs/support.md`、`LICENSE` 与打包脚本现状。
- 本地执行 `npm run package:vsix`、`npm run validate:clean-checkout:vsix -- --source working-tree --skip-vsix-smoke` 与 `npm run test:vsix-smoke` 的实际结果，确认当前工作树（也即当前候选 release 输入快照）已能稳定产出 `dev-session-canvas-0.5.0.vsix`（约 `2.17 MB` / `49 files`），且收口后的 packaged payload 仍可启动。
- `Visual Studio Code` 官方发布文档：<https://code.visualstudio.com/api/working-with-extensions/publishing-extension>
- `Open VSX` 发布文档：<https://github.com/eclipse/openvsx/wiki/Publishing-Extensions>

后续若真的进入公开发布实施阶段，应以“在干净 checkout 中成功产出最小 VSIX，并完成首发平台安装验收”作为新的验证门槛。
