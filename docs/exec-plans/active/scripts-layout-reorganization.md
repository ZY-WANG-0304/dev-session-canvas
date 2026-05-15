# scripts 目录按职责重组

本 `ExecPlan` 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘` 这几个章节。

本文位于 `docs/exec-plans/active/scripts-layout-reorganization.md`，必须按 `docs/PLANS.md` 的要求持续维护。执行者应假设自己只知道当前工作树和本文内容，不依赖之前的对话记忆。

## 目标与全局图景

重组前，仓库的 `scripts/` 目录已经积累了大量职责混杂的入口：构建、发布、Open VSX、smoke、测试、媒体录制、调试辅助和共享运行器都平铺在同一层。维护者如果想找某条发布链路或某个 smoke 入口，必须先扫描一长串文件名，脚本之间的复用关系也不明显。

这次变更要把 `scripts/` 按职责重组为更清晰的目录结构，同时保持现有 npm 命令可用。完成后，维护者可以通过目录名直接判断脚本用途，例如构建与发布脚本集中在一个子目录、smoke 脚本集中在一个子目录、测试脚本集中在一个子目录，真正复用的运行器脚本则单独放在共享层。外部用户看到的 `npm run ...` 命令名应尽量保持不变，只是实现文件的位置更清楚。

用户可以亲眼验证的结果是：`npm run publish:marketplaces -- --dry-run`、`npm run test:smoke`、`npm run test:webview`、`npm run generate:marketplace-media` 等入口仍然可用；`scripts/` 下的实现文件按职责分层后，后续协作者不需要再在一个平铺目录里猜测脚本归属。

## 进度

- [x] (2026-05-15 08:56 +0800) 读取 `docs/WORKFLOW.md`、`docs/PLANS.md` 与当前 `scripts/` 目录清单，确认这是需要正式 `ExecPlan` 的跨文件重组工作。
- [x] (2026-05-15 08:56 +0800) 记录现有脚本平铺状态、npm 入口与直接文件引用，作为重组前基线。
- [x] (2026-05-15 11:10 +0800) 落地新的物理目录：`build/`、`release/`、`media/`、`runtime/`、`smoke/`、`test/`、`shared/`，并新增 `scripts/README.md` 说明目录边界。
- [x] (2026-05-15 11:24 +0800) 更新 `package.json`、脚本间相对 import、notifier 打包脚本、`.vscodeignore`、运行时 hook 路径和发布/录制/设计文档引用。
- [x] (2026-05-15 11:57 +0800) 完成脚本语法、关键轻量测试、构建、类型检查、发布 dry-run、媒体 wrapper 与 VSIX 打包验证。

## 意外与发现

- 观察：迁移前的平铺脚本中既有纯命令入口，也有被其他脚本复用的共享模块，平铺结构已经开始影响可读性。
  证据：迁移基线里的 `scripts/recording-session.mjs`、`scripts/run-vscode-smoke.mjs`、`scripts/test-package-vsix-command.mjs` 等脚本之间存在明显的复用关系，但都位于同一层。

- 观察：并不是所有脚本都只被 npm 入口调用；有些脚本还被其他脚本 `import`。
  证据：`scripts/media/recording-session.mjs` 和多条 smoke 脚本都依赖 `scripts/smoke/vscode-smoke-runner.mjs`、`scripts/shared/prepare-debug-main-only-extension.mjs`、`scripts/shared/playwright-environment.mjs` 等共享模块，因此迁移时不能只做机械搬家。

- 观察：运行时 Claude 文件事件 hook 不能和普通 shared helper 混放。
  证据：`.vscodeignore` 如果为了放行 `scripts/shared/claude-file-event-hook.cjs` 而 unignore `scripts/shared/`，VSIX 会把多个 shared helper 一并打入；最终改为只把运行时 hook 放到 `scripts/runtime/`，其余 helper 继续留在 `scripts/shared/`。

- 观察：当前 Codex/VS Code 终端环境会让沙箱内的 Node 子进程带出 `ELECTRON_RUN_AS_NODE` / `VSCODE_*` 污染，且 `spawnSync("git", ...)` 可能出现 `status=0` 同时带 `EPERM`。
  证据：沙箱内首次 `npm run package:vsix` 命中 README 缺失误报；脚本已补 CLI env 清理和 `status=0` 优先判断，最终在沙箱外复跑 `npm run package:vsix` 通过。

## 决策记录

- 决策：这次重组采用“按职责分层 + 保留 npm 命令名”的方式，而不是直接修改维护者面对的命令名称。
  理由：维护者最常记的是 `npm run ...`，而不是脚本文件物理路径；保留命令名可以降低迁移风险，同时让实现文件位置更清楚。
  日期/作者：2026-05-15 / Codex

- 决策：先把 `scripts/release/`、`scripts/smoke/`、`scripts/test/`、`scripts/shared/` 作为主要分层方向，再根据现有脚本实际依赖关系微调。
  理由：发布链路、宿主 smoke、纯测试脚本和可复用 helper 的关注点不同，这四类最能立刻提升导航效率。
  日期/作者：2026-05-15 / Codex

- 决策：最终目录增加 `scripts/build/`、`scripts/media/` 和 `scripts/runtime/`，不把所有非测试脚本都塞进 `release/` 或 `shared/`。
  理由：构建入口、Marketplace 媒体录制和随 VSIX 打包的运行时 hook 各自有清晰生命周期；单独分层可以避免发布脚本、录制脚本和运行时资产互相污染。
  日期/作者：2026-05-15 / Codex

## 结果与复盘

已完成目录重组。`package.json` 的 npm 命令名保持稳定，物理实现路径迁移到 `scripts/build/`、`scripts/release/`、`scripts/media/`、`scripts/runtime/`、`scripts/smoke/`、`scripts/test/` 和 `scripts/shared/`。发布手册、Marketplace 媒体技能、设计文档与活跃计划中的可复制脚本路径已更新；历史 completed ExecPlan 中的旧路径保留为历史执行记录。

本轮额外修正了两处迁移中暴露的可靠性问题：`prepare-debug-main-only-extension.mjs` 会把运行时 hook 一起复制到 main-only debug extension；`package-vsix.mjs` / `publish-marketplaces.mjs` 会清理 VS Code/Electron 子进程环境，避免 `vsce` 的 npm 依赖扫描在 VS Code 终端中被污染。

## 上下文与定向

重组前仓库根目录下的 `scripts/` 目录包含以下几类内容：构建入口、发布入口、Open VSX 辅助、smoke 运行器、媒体录制入口、测试脚本、Windows / Linux / X11 的专用辅助脚本，以及若干被其他脚本复用的共享模块。本轮目标不是改变这些脚本的功能，而是重排它们的物理位置，让职责边界从文件路径上就能看出来。

当前已经存在的 npm 入口包括：

    npm run build
    npm run package:vsix
    npm run publish:marketplaces
    npm run generate:marketplace-media
    npm run test:smoke
    npm run test:webview
    npm run test:vsix-smoke

本次重组必须保证这些入口继续可用，且新旧路径切换不会把 `README`、发布手册或设计文档里的关键命令示例弄坏。

## 工作计划

第一步，先把脚本按职责分组并制定明确的目标目录。最终分组是：`scripts/build/` 放构建入口；`scripts/release/` 放打包、发布和 clean-checkout 校验；`scripts/media/` 放 Marketplace 媒体录制；`scripts/runtime/` 放随 VSIX 打包的运行时脚本；`scripts/smoke/` 放真实宿主和 VSIX smoke；`scripts/test/` 放所有 `test-*` 脚本与测试 runner；`scripts/shared/` 放不随 VSIX 打包、但被多个入口复用的辅助模块。

第二步，移动文件并同步所有内部 import。需要特别留意 `scripts/media/recording-session.mjs`、`scripts/test/run-playwright-node.mjs`、`scripts/test/run-playwright-webview.mjs`、`scripts/smoke/run-vscode-smoke.mjs`、`scripts/smoke/run-vscode-vsix-smoke.mjs`、`scripts/test/test-package-vsix-command.mjs`、`scripts/test/test-debug-launch-config.mjs` 等脚本之间的相对导入路径。

第三步，更新 `package.json` 中所有 npm script 指向的新物理路径，并检查 `extensions/vscode/dev-session-canvas-notifier/package.json` 中的相关脚本是否还在引用旧路径。

第四步，更新文档中直接引用脚本路径的地方，至少覆盖发布手册、`docs/design-docs/public-marketplace-release-readiness.md`、技能文档中提到的路径，以及任何会在发布或录制时被人复制执行的命令示例。

## 具体步骤

本次重组建议在仓库根目录完成，使用可重复执行的文件移动和文本替换操作。

建议先执行：

    rg --files scripts | sort

确认当前脚本清单；然后根据最终目录方案创建新目录并移动文件。完成后，再执行：

    rg -n "scripts/[A-Za-z0-9_.-]+\\.(mjs|py|cjs|mts)" README.md README.zh-CN.md README.marketplace.md README.marketplace.en.md docs package.json extensions src tests -S

检查还残留哪些旧路径；最后运行 npm 帮助命令和关键测试入口，确认路径更新后仍能执行。

## 验证与验收

重组完成后，至少应通过以下验证：

    npm run publish:marketplaces -- --dry-run
    npm run test:vscode-smoke-runner-env
    npm run test:webview -- --help
    npm run test:vsix-smoke -- --help
    npm run generate:marketplace-media

如果某些命令本身没有 `--help` 支持，也可以改为运行一次最小 dry-run 或仅打印帮助的入口，并确认没有因路径错误而直接失败。

验收标准是：所有现有 npm script 仍能找到对应实现；`scripts/` 下的职责分组清晰可读；发布与 smoke 文档中的示例命令要么已更新到新路径，要么由兼容层明确保留。

## 幂等性与恢复

如果某一步移动文件后出现导入错误，可以把文件移动回原路径并重新跑验证；在没有完成所有引用更新之前，不要一次性删除兼容入口。

如果需要保留过渡期兼容，允许先加薄 wrapper 再删旧实现，但最终收口前必须确认仓库里没有不必要的重复入口。

## 证据与备注

- `find scripts -name '*.mjs' -print0 | xargs -0 -n1 node --check`：通过。
- `python3 -m py_compile scripts/release/openvsx-api.py scripts/media/x11-native-input.py`：通过。
- `npm run test:package-vsix-command`、`npm run test:debug-launch-config`、`npm run test:vscode-smoke-runner-env`、`npm run test:sidebar-codicon-bundle`：通过。
- `npm run build`、`npm run typecheck`、所有迁移到 `scripts/test/` 的 `.mts` 轻量测试：通过。
- `npm run publish:marketplaces -- --dry-run`：通过，Open VSX helper 已指向 `scripts/release/openvsx-api.py`。
- `npm run package:vsix`：沙箱外复跑通过，最终 VSIX 为 `114 files, 3.27 MB`，且只包含 `extension/scripts/runtime/claude-file-event-hook.cjs` 这一条 scripts 运行时文件。

## 接口与依赖

这次重组不引入新的运行时依赖，仍然使用现有的 Node.js、Python 和 VS Code 测试工具链。需要保持稳定的脚本接口主要是 npm 入口名，例如 `build`、`package:vsix`、`publish:marketplaces`、`test:smoke`、`test:webview`、`test:vsix-smoke`、`generate:marketplace-media`。这些命令名应继续可用，即使其对应的物理脚本路径发生变化。
