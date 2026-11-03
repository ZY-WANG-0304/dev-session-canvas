# 还需要开启扩展配置

Linger 让账号的服务管理器在退出登录后继续运行；**Runtime Persistence** 让扩展使用独立的运行时宿主。两者缺一不可。

## 选择配置作用域

点击**打开配置项**，在 VS Code 设置中定位 `devSessionCanvas.runtimePersistence.enabled`。按需要选择用户、远程或工作区范围，然后勾选 **Runtime Persistence: Enabled**。工作区配置可能覆盖用户配置。

引导不会自动选择作用域或写入设置。返回此引导，点击**继续检查**，读取当前窗口实际生效的配置值。

勾选只是请求开启。重载前请阅读下一步：切换模式会清空此窗口的画板会话和内容。
