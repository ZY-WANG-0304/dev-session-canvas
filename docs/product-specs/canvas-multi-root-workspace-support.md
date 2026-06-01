---
title: 画布多根 workspace 支持规格
status: 草案
updated_at: 2026-06-01
related_designs:
  - docs/design-docs/canvas-multi-root-workspace-support.md
related_plans:
  - docs/exec-plans/active/canvas-multi-root-workspace-support.md
---

# 画布多根 workspace 支持规格

## 背景

VSCode 支持在一个窗口中打开多个 workspace folder。Dev Session Canvas 当前以“当前 workspace 的一张画布”为主路径；File Explorer 右键创建 `Terminal` / `Agent` 已经可以把执行 cwd 写入节点 metadata。下一步需要让普通画布创建、侧栏、历史会话、文件路径展示和执行语义都能在 multi-root workspace 下保持一致。

## 用户目标

- 用户在一个包含多个 root 的 VSCode workspace 中仍然只打开一张 Dev Session Canvas。
- 用户创建 `Agent` / `Terminal` 时可以明确选择它属于哪个 root。
- 用户在画布和侧栏中可以看出执行节点、文件活动和历史会话来自哪个 root。
- 用户点击文件链接或恢复历史时不会被静默带到另一个同名 root。

## 功能范围

1. 单根 workspace 下，现有创建与展示行为保持不变。
2. 多根 workspace 下，普通创建 `Agent` / `Terminal` 前必须选择 workspace folder；`Note` 创建不需要选择。
3. Explorer 资源右键创建执行节点继续使用资源所在目录或文件父目录作为 cwd，不重复弹 root picker。
4. 执行节点持久化绝对 cwd，并在启动、重启、resume、CLI 解析、shell env 和 runtime supervisor 中持续使用该 cwd。
5. 节点副标题、侧栏节点列表、会话历史和文件活动使用 root-aware path label；多根下带 workspace folder 前缀，重复 root name 自动消歧。
6. workspace folder 被移除后，绑定该 root 的执行节点保留在画布上，但后续启动失败并显示明确原因。
7. 会话历史扫描覆盖当前所有 workspace folders；恢复历史时新 Agent 节点使用历史 entry 的 cwd。
8. 多根 workspace 下，缺少可信 cwd 的历史恢复请求必须失败并给出说明，不能回退到第一个 root。
9. 内部自动创建 Terminal 并执行命令的入口也遵循多根 root 选择规则。

## 非目标

- 不做多画布、root 切换器或独立项目管理器。
- 不做跨 workspace 的状态同步、合并或共享。
- 不把旧节点自动迁移到其他 root。
- 不保证缺少可信 cwd 的 provider 历史会话能被纳入当前 workspace。

## 验收标准

- 在包含 `frontend` 与 `backend` 的 multi-root workspace 中，从命令面板或侧栏创建 `Terminal` / `Agent` 时会要求选择 root；节点 metadata.cwd 等于选择的 root。
- 从画布右键创建 `Terminal` / `Agent` 时，同样会选择 root，并在右键位置附近创建节点。
- 从 Explorer 的 `backend/src` 右键创建 `Terminal` / `Agent` 时，不出现 root picker，节点 cwd 等于 `backend/src`。
- `Agent` 副标题和侧栏节点列表能显示 `backend/src · codex ...` 这类 root-aware 上下文；重复 root name 时前缀不重复。
- 两个 root 下存在同名文件时，执行链接和 Note 链接不会随机打开错误 root 下的文件。
- 移除某个 workspace folder 后，对应执行节点再次启动会失败并说明目录不属于当前 workspace，节点 cwd 不被改写。
- 重载窗口后，节点 cwd、root label 和会话历史展示保持一致。
- 通过安装 Agent CLI 这类自动创建 Terminal 的入口触发执行命令时，多根 workspace 下仍会先选择 root。
- 侧栏历史条目若没有可信 cwd，在 multi-root 下恢复失败并提示原因，不创建落到第一个 root 的 Agent。
