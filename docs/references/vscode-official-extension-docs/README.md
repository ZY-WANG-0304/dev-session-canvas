# VS Code 官方扩展文档本地副本

## 定位

- 这是面向 `dev-session-canvas` 当前需求裁剪后的 VS Code 官方扩展文档本地参考，不是官方全量镜像。
- 本目录内容属于外部参考，不代表本仓库已确认的产品、设计或实现结论。

## 来源

- 文档仓库：`https://github.com/microsoft/vscode-docs`
- 本地抓取时间：`2026-04-21`
- 文档仓库提交：`de6a056035610a829c88809354c1928ba2b0b62c`

## 当前本地保留主题

- 入门与扩展基础：`get-started`、`extension-capabilities`
- 当前插件直接相关的扩展能力：`command`、`tree-view`、`webview`
- 运行环境与限制：`extension-host`、`remote-extensions`、`virtual-workspaces`、`workspace-trust`
- 扩展元数据与能力声明：`activation-events`、`commands`、`contribution-points`、`extension-manifest`、`when-clause-contexts`
- 扩展 API 入口：`vscode-api.md`、`vscode-api.template`、`generated/vscode.d.ts`
- UX 规范：`activity-bar`、`sidebars`、`panel`、`status-bar`、`views`、`command-palette`、`context-menus`、`notifications`、`settings`、`webviews`
- 工程化与发布：`testing`、`testing-extension`、`bundling-extension`、`continuous-integration`、`publishing-extension`
- Marketplace 与运行时安全：`extension-marketplace.md`、`extension-runtime-security.md`
- 主题与图标：`theming`、`color-theme`、`file-icon-theme`、`product-icon-theme`、`theme-color`、`icons-in-labels`

## 裁剪规则

- 与当前插件明显无关的章节默认不落本地。
- 其他文档如果引用到未保留章节，链接改为官方 `https://code.visualstudio.com/...` 外链。
- 本地保留正文、必要的 `template` / `d.ts`、以及仍有阅读价值的静态图片。
- `.gif`、`.mp4` 等高体积动画和视频默认不保留，文档中改为简短说明文本。

## 更新原则

- 如果插件开始实际使用新的 VS Code 能力，再按需把对应官方章节补回本地。
- 如果只是偶尔参考、且与主路径无强关系，优先保持外链，不扩大本地副本范围。
