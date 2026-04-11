# 为运行时持久化补齐 Remote-SSH 自动化验证

本 `ExecPlan` 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘` 这几个章节。

本计划位于仓库根目录下的 `docs/PLANS.md` 约束体系内，后续任何继续推进该主题的协作者都必须按 `docs/PLANS.md` 的要求持续维护本文件。

## 目标与全局图景

这项工作要把“Remote SSH + Extension Development Host 下的 runtime persistence 重连”从人工验证升级为自动化验证。完成后，仓库除了现有的本地 smoke 和真实关窗重开 smoke，还会多一条真正经过 `Remote-SSH` 客户端层的自动化链路，用来证明 `Agent` / `Terminal` 在远端开发宿主里重开后仍能重新附着，而不是错误退化成 `历史恢复`。

用户可直接观察到的结果应包括：

- `npm run test:smoke` 或新的专用入口会自动拉起一条 `Remote-SSH` smoke。
- 这条 smoke 不依赖人工准备真实远端机器，而是在当前 Linux 环境中启动一个临时用户态 `sshd`，让 VS Code 的 `Remote-SSH` 扩展通过真实 SSH 协议连接回来。
- `Remote-SSH` 场景中的开发宿主会跑 runtime persistence 的真实关窗重开验证，证明 launcher 化后的 supervisor 在远端开发宿主里可重新附着。

## 进度

- [x] (2026-04-10 16:15 +0800) 阅读 `docs/WORKFLOW.md`、`docs/PLANS.md`、`docs/design-docs/development-debug-automation.md`、既有调试自动化计划与 `CONTRIBUTING.md`，确认这是“现有技术债转正式实现”的复杂交付，需单独 `ExecPlan`。
- [x] (2026-04-10 16:28 +0800) 审查现有 smoke 与 runtime persistence 测试入口，确认缺口准确位于“Remote-SSH 客户端层未进入自动化”，而不是 runtime persistence 主逻辑缺测试。
- [x] (2026-04-10 16:41 +0800) 完成两项关键原型：一是用隔离 `extensionsDir` 成功安装 `ms-vscode-remote.remote-ssh`；二是用临时用户态 `sshd` + 临时 key 形成可无交互 self-ssh 的真实 SSH 链路。
- [x] (2026-04-10 17:18 +0800) 将上述原型收口为正式的 Remote-SSH smoke runner，并接入仓库脚本入口。
- [x] (2026-04-10 20:44 +0800) 新增 Remote-SSH Extension Development Host 下的 runtime persistence 自动化用例，并跑通 setup/verify 两阶段。
- [x] (2026-04-10 20:52 +0800) 更新设计文档、开发文档与技术债记录，并完成 `npm run test:smoke`、`npm run typecheck` 收口验证。

## 意外与发现

- 观察：当前仓库已有的 `test:smoke` 虽然覆盖了 Development Host、真实关窗重开和 runtime persistence，但它仍然是在“本机 Electron + 直接 extension development path”模式下运行，没有让 `Remote-SSH` 客户端层参与。
  证据：现有 runner [scripts/run-vscode-smoke.mjs](/home/users/ziyang01.wang-al/projects/opencove_extension/scripts/run-vscode-smoke.mjs) 只启动本地 workspace 场景与 real-reopen 场景，不安装 `Remote-SSH` 扩展，也不传 `--remote` authority。

- 观察：当前机器可以通过用户态临时 `sshd` 形成真实 SSH 拓扑，不必依赖宿主机现有 `authorized_keys` 或系统级 `sshd` 配置。
  证据：使用临时 host key、client key、独立 `AuthorizedKeysFile` 和 `StrictModes no` 后，`ssh -F <temp-config> dsc-remote-smoke 'echo SELF_SSHD_OK'` 已成功返回。

- 观察：从 Marketplace 往隔离 `extensionsDir` 安装 `ms-vscode-remote.remote-ssh` 在当前环境可行。
  证据：使用下载下来的 VS Code CLI 和隔离 `user-data-dir` / `extensions-dir` 后，已成功安装 `ms-vscode-remote.remote-ssh`、`remote-ssh-edit` 和 `remote-explorer`。

- 观察：Remote-SSH 场景里，本地 `--extensionTestsEnv` 和本地 machine-scope 设置都不能可靠替代“远端 extension host 自己可见的配置”。
  证据：失败快照中 `Agent` 的 `resumeStrategy` 已是 test 模式的 `fake-provider`，但 `shellPath` 仍然是默认 `codex`；改为在 `real-reopen-tests.cjs` 里显式写入远端 `devSessionCanvas.agent.codexCommand` / `claudeCommand` 后，Remote setup 与 verify 均通过。

- 观察：要让 VS Code 把开发态扩展和测试文件真正放到远端 Extension Development Host 上，`extensionDevelopmentPath` / `extensionTestsPath` 需要使用 `vscode-remote://ssh-remote+<alias>/...` URI，而不是只传本地路径。
  证据：改成 remote URI 后，`pickRunningLocation for devsessioncanvas.dev-session-canvas ... => Remote`，且 `real-reopen-tests.cjs` 开始在远端宿主内执行。

## 决策记录

- 决策：Remote-SSH 自动化不去驱动“现有仓库窗口里按 F5 的 UI 手势”，而是直接启动一条远程 Extension Development Host 场景。
  理由：真正需要自动化保证的是“Remote-SSH 客户端层 + 开发宿主 + runtime persistence”三者组合后的行为，而不是 F5 按键本身。直接启动远程开发宿主更稳定，也更适合 CI/沙箱环境。
  日期/作者：2026-04-10 / Codex

- 决策：Remote-SSH 自动化使用“同机 self-ssh”而不是依赖外部远端主机。
  理由：这样能把测试做成仓库自给自足的 smoke，避免外部机器、密钥分发和环境漂移。
  日期/作者：2026-04-10 / Codex

- 决策：第一版复用现有 runtime persistence 的 real-reopen 测试文件，而不是重写第二套完全独立的断言。
  理由：缺口在传输层和宿主拓扑，不在业务断言；复用现有断言可以减少重复和分叉。
  日期/作者：2026-04-10 / Codex

- 决策：Remote-SSH smoke 中的开发态扩展路径和测试路径统一改用 remote URI。
  理由：这样 VS Code 才会把开发态扩展和测试入口放进远端 Extension Development Host，而不是只在本地 UI 宿主里解析。
  日期/作者：2026-04-10 / Codex

- 决策：test agent CLI 的覆盖命令由 `real-reopen-tests.cjs` 在远端运行时显式写入 remote machine settings，不再依赖本地透传环境变量。
  理由：Remote-SSH 场景下，本地 `extensionTestsEnv` 并不能稳定成为远端 extension host 的运行时环境；把覆盖路径写进远端可见配置更稳妥。
  日期/作者：2026-04-10 / Codex

## 结果与复盘

已完成的结果：

- `scripts/vscode-smoke-runner.mjs` 支持 `folderUri`、remote authority、remote URI 形式的 `extensionDevelopmentPath` / `extensionTestsPath`，并保留隔离 user data / extensions dir 与 artifact 收集。
- `scripts/run-vscode-smoke.mjs` 现已把 `Remote-SSH + Extension Development Host + runtime persistence real-reopen` 作为 `test:smoke` 的正式场景之一；该场景会先安装 `Remote-SSH` 扩展，再通过同机 self-ssh 拉起远端宿主。
- `scripts/vscode-remote-ssh-fixture.mjs` 负责临时用户态 `sshd`、host/client key、`ssh_config`、远端 agent 目录与清理逻辑。
- `tests/vscode-smoke/real-reopen-tests.cjs` 现在会在 setup 阶段主动写入 test CLI 路径，避免 Remote-SSH 场景退回默认 `codex` 命令。

剩余事项：

- 没有新的 runtime persistence 自动化缺口；剩余人工验收只针对 `Run Dev Session Canvas` 这条调试配置本身的 F5 入口，而不是产品能力或 Remote-SSH runtime persistence 主路径。

## 上下文与定向

本任务跨三块内容：

- `scripts/vscode-smoke-runner.mjs` 与 `scripts/run-vscode-smoke.mjs`
  当前本地 smoke 的下载、启动、目录准备和 real-reopen 编排都在这里。Remote-SSH smoke 最适合在这一层补一个平行场景，而不是另起一套完全独立的 VS Code 启动脚本。
- `tests/vscode-smoke/real-reopen-tests.cjs`
  当前最值钱的 runtime persistence 断言已经在这里：setup 阶段启动 live-runtime 并 flush 快照，verify 阶段重开后确认 sessionId 不变、离线输出可见、状态不掉到 `history-restored`。
- 调试与文档体系
  `docs/design-docs/development-debug-automation.md`、`CONTRIBUTING.md` 和 `docs/exec-plans/tech-debt-tracker.md` 当前都还把 Remote-SSH 自动化视为缺口；实现后必须同步收口。

这里的“同机 self-ssh”指：在当前 Linux 环境里临时启动一个只监听 `127.0.0.1:<high-port>` 的用户态 `sshd`，并为它生成临时 host key、client key 和 `ssh_config`。随后由 VS Code 的 `Remote-SSH` 扩展通过这个 `ssh_config` 去连 `ssh-remote+dsc-remote-smoke`，从而进入真正的 Remote-SSH 路径。

## 工作计划

先把现有 smoke runner 做小幅扩展，而不是另造第二套启动框架。需要补三类能力：

第一类是 Remote-SSH 基础设施准备。新增一个 helper，负责生成临时 host key / client key、写 `sshd_config` 与 `ssh_config`、起停用户态 `sshd`，并把连接 authority、remote path 与 config file 返回给 caller。

第二类是 Remote-SSH 场景启动。runner 需要支持：

- 不再强制 `--disable-extensions`
- 允许在隔离 `extensionsDir` 里提前安装 `ms-vscode-remote.remote-ssh`
- 允许向 VS Code 传递 `--remote ssh-remote+<alias>` 和远端路径
- 在隔离 `user-data-dir` 里写入 `remote.SSH.configFile`、`remote.SSH.useLocalServer=false` 等设置

第三类是测试用例复用与编排。Remote-SSH 场景第一版直接复用 [real-reopen-tests.cjs](/home/users/ziyang01.wang-al/projects/opencove_extension/tests/vscode-smoke/real-reopen-tests.cjs)，分别跑 `setup` 与 `verify` 两个阶段。这样能直接证明：

- Remote-SSH 连接已经成功
- 远端开发宿主中的 runtime persistence 能完成真实重开后的重新附着
- launcher 化后的 supervisor 不会再因为开发宿主重开而丢失 live runtime

## 具体步骤

1. 新增本计划，并在实现过程中持续回写进度。
2. 扩展 `scripts/vscode-smoke-runner.mjs`：
   - 允许控制 `--disable-extensions`
   - 支持 `--remote` authority 场景
   - 提供安装 marketplace 扩展的辅助函数
3. 新增一个 Remote-SSH smoke helper，负责：
   - 准备临时 `sshd`
   - 准备临时 `ssh_config`
   - 安装 `Remote-SSH` 扩展
   - 写入 Remote-SSH 所需的 user settings
4. 扩展 `scripts/run-vscode-smoke.mjs`，在现有 local smoke 和 real-reopen 之后增加 Remote-SSH real-reopen 场景。
5. 如有必要，新增专用 `tests/vscode-smoke/remote-*.cjs`；若不需要，直接复用 `real-reopen-tests.cjs`。
6. 更新 `docs/design-docs/development-debug-automation.md`、`CONTRIBUTING.md` 和 `docs/exec-plans/tech-debt-tracker.md`。
7. 运行至少以下验证：
   - `npm run typecheck`
   - `npm run test:smoke`

## 验证与验收

完成后至少应能观察到：

- `test:smoke` 新增一段明确的 Remote-SSH 场景日志。
- 该场景会先启动 setup phase，再启动 verify phase。
- verify phase 中 `Agent` / `Terminal` 不是 `history-restored`，并且能读到关闭期间输出。
- 失败时能留下 Remote-SSH 场景自己的 artifacts，而不是和本地 smoke 混在一起。

## 幂等性与恢复

- 临时 `sshd`、host key、client key、known_hosts、extensionsDir 和 user-data-dir 都应落在 `.debug/` 或 `/tmp` 下，允许重复执行时整体清理重建。
- Remote-SSH smoke 结束后必须停止临时 `sshd`；即使测试失败，也要在 `finally` 中清理。
- 如果 Marketplace 扩展安装失败，测试应直接失败并留下清晰日志，不得静默跳过。

## 证据与备注

当前已经确认的实现前证据：

    $ .vscode-test/.../bin/code --install-extension ms-vscode-remote.remote-ssh
    Extension 'ms-vscode-remote.remote-ssh' v0.122.0 was successfully installed.

    $ ssh -F .debug/remote-ssh-probe/sshd/ssh_config dsc-remote-smoke 'echo SELF_SSHD_OK'
    SELF_SSHD_OK

实现完成后的关键证据：

    $ npm run test:smoke
    Real window reopen smoke passed.
    Remote SSH real window reopen smoke passed.
    VS Code smoke test passed.

    $ npm run typecheck
    > tsc --noEmit

## 接口与依赖

预计新增或调整的关键接口：

- `scripts/vscode-smoke-runner.mjs`
  - 支持 remote authority 与可选的 `disableExtensions`
  - 提供扩展安装 helper
- 新的 Remote-SSH smoke helper
  - 返回 authority、remotePath、sshConfigPath、清理函数
- `scripts/run-vscode-smoke.mjs`
  - 增加 Remote-SSH real-reopen 场景编排

本次修订说明：2026-04-10 16:41 +0800 新建 `ExecPlan`，把 Remote-SSH runtime persistence 自动化从技术债推进为正式交付。
本次修订说明：2026-04-10 20:52 +0800 记录 Remote-SSH smoke runner、远端 Development Host real-reopen 自动化与最终验证结果，并准备将本计划移入 completed。
