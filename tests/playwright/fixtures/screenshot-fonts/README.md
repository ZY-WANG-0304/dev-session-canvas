# Linux 截图 CJK 字体夹具

只供 `webview bundle emits ready and matches the baseline screenshot` 使用，不进入扩展产物。原 Linux PNG 使用 Noto Sans CJK 2.004 Regular 回退，600 字重由浏览器合成；英文继续沿用原 Segoe UI / sans-serif。夹具只含 `characters.txt` 中的中文及标点，并通过 `unicode-range` 限定。

`cjk-regular.woff` 从 Debian/Ubuntu `fonts-noto-cjk 1:20220127+repack1-1` 的 `NotoSansCJK-Regular.ttc` 第 2 个字体生成。原文件及夹具 SHA256 见 `provenance.json`，许可见 `OFL.txt`。派生字体已改名 `DSC Screenshot CJK`。

生成使用 Python fonttools 4.61.1：用 `TTFont(source, fontNumber=2)` 读取；`subset.Options()` 设置 `flavor='woff'`、`recalc_timestamp=False`；`Subsetter.populate(text=characters)` 和 `subset(font)` 保留字形。将 name 表的 1/16 改为 `DSC Screenshot CJK`，3/4/6 及 CFF fontNames 改为 `DSCScreenshotCJK-Regular`，CFF FamilyName/FullName 同步；设置 `font.flavor='woff'` 后保存。生成工具不作为测试机依赖。

中文文案变化时先检查字符覆盖及实际差异，再调整字符子集。基线 PNG 和截图断言不因环境缺字体而更新或放宽。原 CI 4319 像素差异、系统 Noto 控制仍剩 24 像素及固定字体对照，随 #329 的根因记录收口。
