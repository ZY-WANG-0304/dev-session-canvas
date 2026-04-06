---
title: 扩展图标定稿
decision_status: 已选定
validation_status: 验证中
domains:
  - VSCode 集成域
  - 画布交互域
architecture_layers:
  - 宿主集成层
  - 画布呈现层
related_specs:
  - docs/product-specs/canvas-core-collaboration-mvp.md
related_plans: []
updated_at: 2026-04-06
---

# 扩展图标定稿

## 1. 背景

当前仓库曾同时保留多组主扩展 icon 与 activity bar icon 草稿，已经影响资源可追踪性和最终打包资产的唯一性。

## 2. 问题定义

需要锁定一组最终图标资产，并清理历史草稿，避免以下问题继续存在：

- 主扩展 icon 的源文件与打包 PNG 不是同一版本。
- activity bar icon 与主 icon 的语义和结构没有明确收口。
- 多个历史草稿长期保留在仓库里，后续难以判断哪份才是正式版本。

## 3. 目标

- 选定唯一主扩展 icon 源文件。
- 选定唯一 activity bar icon 源文件。
- 保证 `package.json` 中实际打包使用的 `images/icon.png` 与最终主 icon 一致。
- 删除其余 icon 草稿，收口仓库内的正式资产集合。

## 4. 非目标

- 本轮不重做新的视觉方向探索。
- 本轮不扩展到品牌规范、海报或其他营销物料。
- 本轮不清理与 icon 无关的杂项文件。

## 5. 最终资产

### 5.1 主扩展 icon

资源：`images/dev-session-canvas-icon.svg`

- 保留上下两个终端面板的结构，作为主 icon 的最终语义。
- `images/icon.png` 由该 SVG 渲染生成，作为 `package.json` 的正式打包资产。

### 5.2 Activity Bar Icon

资源：`images/dev-session-canvas-activitybar.svg`

- 只保留 terminal 的线条语言，并改成上下叠放结构。
- 与主 icon 保持一致的“双终端面板”语义。

## 6. 风险与取舍

- 主 icon 的最终 PNG 依赖渲染链生成；如果后续 SVG 继续微调，应重新导出 `images/icon.png`。
- 当前已经完成文件级同步与渲染验证，但还没有补充 Marketplace 或 VS Code 实景截图类人工校验。

## 7. 当前结论

当前正式资产收口如下：

- `images/dev-session-canvas-icon.svg` 是主扩展 icon 的唯一源文件。
- `images/dev-session-canvas-activitybar.svg` 是 activity bar icon 的唯一源文件。
- `images/icon.png` 是由最终主 icon 渲染出的正式打包 PNG。
- 其他历史 icon 草稿应从仓库中移除。

## 8. 验证方法

- 已验证 `images/dev-session-canvas-icon.svg` 与 `images/dev-session-canvas-activitybar.svg` 的 SVG XML 语法有效。
- 已使用本地 `ffmpeg` 将 `images/dev-session-canvas-icon.svg` 渲染为正式 `images/icon.png`。
- 已确认 `package.json` 继续引用 `images/icon.png` 与 `images/dev-session-canvas-activitybar.svg`，无需改动接入路径。
- 后续如需进一步保险，可补一轮 VS Code 扩展列表与 Marketplace 的人工视觉复核。
