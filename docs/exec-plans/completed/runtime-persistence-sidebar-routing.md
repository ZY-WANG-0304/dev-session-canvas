# 按实际模式路由 Runtime Persistence 侧栏入口

本计划遵循 `docs/PLANS.md`，完成用户确认的“稳定状态反向操作，切换中继续完成请求”。

## 目标与上下文

当前 `CanvasSidebarView.ts` 仅在配置 false/窗口 applied true 时打开关闭引导；实际已开启时仍打开开启引导。状态函数也把未应用但已勾选的情况显示成 Enabled。本轮只改入口路由、状态提示和次要修复入口，不改持久运行准入、清理、linger 或引导步骤。

## 进度

- [x] (2026-11-03) 核对实际模式、配置意图、系统资格与侧栏刷新链。
- [x] (2026-11-03) 记录四组合、异常保障与点击时复核方案。
- [x] (2026-11-03) 修改侧栏描述、点击时路由命令、双语悬浮文案及右键配置/修复入口。
- [x] (2026-11-03) 72 项侧栏状态矩阵及旧快照回归通过；控制器/实际 Manager 回归增至 151 项，包含同一个回调在实际模式变化后的方向复核。
- [x] (2026-11-03) 同步设计、规格、README、索引和验证边界并归档。

## 决策记录

- 请求/应用为 true/true 时进入关闭，false/false 时进入开启，true/false 继续开启，false/true 继续关闭。四组合等价于“applied true 走关闭，否则走开启”；requested 决定是否显示待完成，系统能力决定风险提示，均不替代实际模式。日期：2026-11-03。
- 侧栏使用独立内部路由命令，在点击时从 Manager 读取最新 applied，避免快照刷新前执行旧方向。显式开启/关闭命令继续保持原方向，不把修复入口变成关闭。日期：2026-11-03。
- 实际开启但系统 blocked 显示后台保障异常，unknown 保留无法验证；没有执行中的节点不代表模式关闭。右键保留关闭并增加现有配置后台持久运行入口，用于明确修复系统条件。点击只进入原有自动检查引导，不写配置、不执行命令、不触发清理。日期：2026-11-03。

## 意外与发现

当前四组合的路由无需引入第三种持久运行模式或系统探测阻塞：实际模式已由 Manager 持有。环境检查失败不会停止现存会话，因此异常时仍应能进入关闭引导。未提交工作包含前几轮实现和无关用户文件，本轮保留，不安装、提交或发布。

## 工作计划

在 `runtimePersistenceSetup.ts` 区分实际开启和待开启的描述；`CanvasSidebarView.ts` 用小型状态构造函数提供统一描述、动作标题、风险及次要入口提示。`extensionIdentity.ts`、`extension.ts` 和 manifest 注册隐藏的侧栏路由命令，Manager 在调用时读取当前模式。右键配置入口复用现有公开命令。

验证使用实际侧栏构造函数遍历 requested/applied、eligible/blocked/unknown/checking/unsupported/unchecked 以及零/非零执行数量；使用真实 Manager 方法与控制器复合夹具执行同一个侧栏命令，前后切换实际模式，确认方向不是旧快照或 linger 决定。保留信任检查和自动检查安全边界。同步中英文 UI、README、规格、设计与索引。

## 验证与验收

根目录执行 `node scripts/test/test-sidebar-state-updates.mjs`、`npm run test:runtime-persistence-setup`、`npm run test:extension-manifest`、`npm run test:ui-copy-localization`、`npm run typecheck`、`npm run test:package-vsix-file-list` 和 `git diff --check`。开启/关闭页面未变，不以旧截图冒充本轮侧栏实机验收；真实远程安装仍不在本轮修改范围。

## 幂等性与恢复

重复点击沿用控制器一次动作锁；旧状态只影响刷新前的展示，实际命令重新读取当前模式。未知资格不影响关闭，显式修复不会变成关闭；取消仍按原有设置/重载语义处理，不触碰生产会话或系统配置。

## 结果与复盘

已实现 `CanvasPanelManager.openRuntimePersistenceGuide`，通过隐藏命令 `devSessionCanvas.__internal.openRuntimePersistenceGuide` 在点击时读取实际模式；侧栏快照只决定当前文案，不携带路由方向。`getRuntimePersistenceSummaryItem` 按请求/实际模式区分稳定与待完成，`runtimePersistenceStatusLabel` 区分 pending 和 applied 的资格提示。右键配置入口复用 `devSessionCanvas.configureRuntimePersistence`，测试证明它在 applied=true 时仍打开开启配置引导。系统能力异常与零执行不会改变关闭方向。

以下命令通过，均在仓库根执行：

```text
node scripts/test/test-sidebar-state-updates.mjs
  PASS Runtime Persistence sidebar: 72 mode/capability/session-count cases and legacy snapshots
  PASS actual sidebar consumers: event reuse, view-specific equality, fresh bootstrap/reopen, hidden state, delivery retry, bounded refresh and async order
npm run test:runtime-persistence-setup
  capability: 51 checks passed
  setup: 151 checks passed
  server: 7 admission checks passed
npm run test:extension-manifest
  extension manifest tests passed
npm run test:ui-copy-localization
  ui copy localization tests passed
npm run typecheck
  passed
npm run test:package-vsix-file-list
  main: real staging rules and vsce file list passed
  notifier: real staging rules and vsce file list passed
git diff --check
  passed
```

状态矩阵覆盖四组合 × 九种系统状态（含不存在的旧快照字段）× 零/非零会话；实际 Manager 与控制器组合测试覆盖四组合 × 四种资格，复用点击回调在 applied 翻转后重新选择方向，并核验关闭不 inspect、修复仍为开启、失信不导航、无终端/设置/重载副作用。侧栏事件回归增加模式、请求与资格变更的文案刷新，不增加轮询。

本轮没有安装扩展或改变实际账号的 linger/配置；未重新执行真实宿主侧栏点击/右键菜单 UI 验收，自动测试覆盖生产侧栏构造器、实际 Manager 方法、控制器和 manifest 接线。手动验收应在隔离配置宿主中确认：已应用时点击进入关闭页，未应用时进入开启页，待开启/待关闭继续原路径；模拟系统异常后仍可关闭，右键配置始终进入修复页，点击前后有效配置和会话均不被自动改变。实际 SSH/零登录/跨平台宿主边界仍沿用原技术债，不用旧页面布局截图代证本轮侧栏。

修订：2026-11-03 根据用户批准的侧栏方向方案建立计划。

修订：2026-11-03 完成入口、状态与次要修复入口，记录状态矩阵/实际路由验证结果，归档计划。
