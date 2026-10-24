# Linux Webview CJK 字体夹具

Linux 的 Webview Playwright 测试统一消费仓库内 `cjk-regular.woff`，不需要下载或安装 `fonts-noto-cjk`。字体仅用于测试，不进入扩展产物。`load.mjs` 在公共 `openHarness` 中注入内嵌 `@font-face`，等待 `document.fonts.load` 成功后才继续；`applyWorkbenchTheme` 结束后重新设置字体顺序，避免主题覆盖。UI 和编辑器保留各自原 Latin 回退，非 Linux 行为不变。重复打开页面会重新加载新文档中的字体。

原 Linux PNG 使用 Noto Sans CJK 2.004 Regular 回退，600 字重由浏览器合成；英文继续使用原字体。早期夹具仅有38个截图字符，无法支撑其他中文布局测试。本轮把同源子集扩展到465个字符，覆盖 `provenance.json` 的 `source_roots` 中 Webview 用例及呈现层源文件的汉字、假名、CJK/全角标点。通过 `unicode-range` 限制覆盖范围，保留原截图用字的字形和度量。原 PNG 不更新，断言不放宽。

`load.mjs` 核对 WOFF 和字符清单 SHA256、生成时登记的字符映射，以及当前源文件中的 CJK 字符覆盖。新增未覆盖字符会明确失败，不默默依赖 runner 字体。此子集不等于完整中文字体，不为真实 VSCode Host 或模板市场页面注入字体。

## 来源与维护

`cjk-regular.woff` 从 Debian/Ubuntu `fonts-noto-cjk 1:20220127+repack1-1` 的 `NotoSansCJK-Regular.ttc` 第2个字体生成。上游版本为2.004，原文件与子集 SHA256 见 `provenance.json`，许可见 `OFL.txt`。保留原派生字体名称 `DSC Screenshot CJK`，避免无必要地更换截图字体身份。

生成环境使用 Python fonttools4.61.1；在仓库根执行 `python3 tests/playwright/fixtures/screenshot-fonts/generate.py /path/to/NotoSansCJK-Regular.ttc`。脚本先检查本地源文件摘要和工具版本，不下载任何资源。测试机只需读取已提交的 WOFF，不需要 TTC、fonttools 或系统 CJK 包。

中文文案变化后重新生成并核对覆盖与原基线。原截图问题的4319像素差异、系统Noto控制仍剩24像素及固定字体对照保留在 #329 的历史根因记录中。本轮无系统CJK字体的验证见 `docs/references/webview-local-cjk-font/README.md`。
