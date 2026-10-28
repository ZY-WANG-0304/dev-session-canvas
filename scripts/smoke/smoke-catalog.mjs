// Each target owns its fixture. Causal combinations keep their complete
// execution chain; unrelated lifecycle, links and pressure actions are separate.
const lifecycleSmokeCases = [
  {
    "id": "execution-start/auto-start",
    "title": "创建后原执行 started",
    "prepare": "prepareIndependentPair",
    "entry": "runIndependentAutoStart",
    "fixture": "agent-terminal"
  },
  {
    "id": "execution-start/duplicate",
    "title": "活动 Agent 和 Terminal 拒绝重复 Start",
    "prepare": "prepareIndependentPair",
    "entry": "runIndependentDuplicate",
    "fixture": "agent-terminal"
  },
  {
    "id": "execution-io/agent-line",
    "title": "Agent 输入后返回原执行正文",
    "prepare": "prepareIndependentAgent",
    "entry": "runIndependentAgentLine",
    "fixture": "agent"
  },
  {
    "id": "execution-io/agent-partial",
    "title": "Agent 部分输入保留等待状态",
    "prepare": "prepareIndependentAgentPrompt",
    "entry": "runIndependentAgentPartial",
    "fixture": "agent"
  },
  {
    "id": "execution-io/terminal-line",
    "title": "Terminal 原执行输入输出和 live 快照",
    "prepare": "prepareIndependentTerminal",
    "entry": "runIndependentTerminalLine",
    "fixture": "terminal"
  },
  {
    "id": "execution-io/live-snapshot",
    "title": "活动 Agent 原执行的完整快照包含本次正文",
    "prepare": "prepareIndependentAgent",
    "entry": "runIndependentAgentSnapshot",
    "fixture": "agent"
  },
  {
    "id": "execution-io/bounded-burst",
    "title": "Agent 有限 burst80 末标记",
    "prepare": "prepareIndependentAgent",
    "entry": "runIndependentAgentBurst",
    "fixture": "agent"
  },
  {
    "id": "agent-state-fixture/burst-prompt",
    "title": "受控 burst 输出与 prompt 状态",
    "prepare": "prepareIndependentAgent",
    "entry": "runIndependentAgentPrompt",
    "fixture": "agent"
  },
  {
    "id": "agent-state-fixture/sleep",
    "title": "受控 sleep 处理中与等待状态",
    "prepare": "prepareIndependentAgentPrompt",
    "entry": "runIndependentAgentSleep",
    "fixture": "agent"
  },
  {
    "id": "agent-state-fixture/spinner",
    "title": "受控重绘处理中与等待状态",
    "prepare": "prepareIndependentAgentPrompt",
    "entry": "runIndependentAgentSpinner",
    "fixture": "agent"
  },
  {
    "id": "execution-exit/natural-zero",
    "title": "Agent 自然退出的保存、reader 与单次 exit",
    "prepare": "prepareIndependentAgent",
    "entry": "runIndependentNaturalExit",
    "fixture": "agent"
  },
  {
    "id": "execution-exit/nonzero",
    "title": "Agent exit17 错误终态和原资源退役",
    "prepare": "prepareIndependentAgent",
    "entry": "runIndependentNonzeroExit",
    "fixture": "agent"
  },
  {
    "id": "execution-stop/agent",
    "title": "用户 Stop 原 Agent 且节点保留",
    "prepare": "prepareIndependentAgent",
    "entry": "runIndependentAgentStop",
    "fixture": "agent"
  },
  {
    "id": "execution-stop/terminal",
    "title": "用户 Stop 原 Terminal 且节点保留",
    "prepare": "prepareIndependentTerminal",
    "entry": "runIndependentTerminalStop",
    "fixture": "terminal"
  },
  {
    "id": "execution-stop/codex-queued-exit",
    "title": "Stop 优先于排队退出，单次尾部保存和 reader",
    "prepare": "prepareIndependentStoppedAgent",
    "entry": "runIndependentCodexStopRace",
    "fixture": "agent"
  },
  {
    "id": "execution-stop/claude-graceful",
    "title": "Claude Stop 恢复信号与原资源退役",
    "prepare": "prepareIndependentEmpty",
    "entry": "runIndependentClaudeStop",
    "fixture": "claude-self-created"
  },
  {
    "id": "execution-restart/after-natural",
    "title": "自然退出退役后新 Start 和新正文",
    "prepare": "prepareIndependentAgent",
    "entry": "runIndependentRestartNatural",
    "fixture": "agent"
  },
  {
    "id": "execution-restart/after-error",
    "title": "异常退出退役后新 Start 和新正文",
    "prepare": "prepareIndependentAgent",
    "entry": "runIndependentRestartError",
    "fixture": "agent"
  },
  {
    "id": "execution-restart/after-stop",
    "title": "Stop 退役后新 Start 和新正文",
    "prepare": "prepareIndependentAgent",
    "entry": "runIndependentRestartStop",
    "fixture": "agent"
  },
  {
    "id": "surface-continuity/completed-reflow",
    "title": "已完成 Terminal reflow 保留快照与 hydration 尺寸",
    "prepare": "prepareIndependentCompletedTerminal",
    "entry": "runIndependentCompletedReflow",
    "fixture": "terminal"
  },
  {
    "id": "agent-resume-context/claude-explicit-id",
    "title": "Claude Stop 后保留文件确认的显式 resume 身份",
    "prepare": "prepareIndependentEmpty",
    "entry": "runIndependentClaudeResumeId",
    "fixture": "claude-self-created"
  },
  {
    "id": "terminal-links/file-position",
    "title": "真实页面文件链接打开正确行列",
    "prepare": "prepareIndependentStoppedTerminal",
    "entry": "runIndependentFileLink",
    "fixture": "terminal"
  },
  {
    "id": "terminal-links/image",
    "title": "图片链接打开真实 custom tab",
    "prepare": "prepareIndependentStoppedTerminal",
    "entry": "runIndependentImageLink",
    "fixture": "terminal"
  },
  {
    "id": "terminal-links/cwd-and-multiline",
    "title": "cwd 相对路径和 rg 多行结果链接",
    "prepare": "prepareIndependentStoppedTerminal",
    "entry": "runIndependentCwdLink",
    "fixture": "terminal"
  },
  {
    "id": "terminal-links/missing-fallback",
    "title": "缺失文件链接降级 quickOpen",
    "prepare": "prepareIndependentStoppedTerminal",
    "entry": "runIndependentMissingLink",
    "fixture": "terminal"
  },
  {
    "id": "terminal-links/url-and-osc8",
    "title": "URL 提示、真实浏览器路由和 OSC8",
    "prepare": "prepareIndependentStoppedTerminal",
    "entry": "runIndependentUrlLink",
    "fixture": "terminal"
  },
  {
    "id": "terminal-links/opener-error",
    "title": "链接 opener 拒绝反馈",
    "prepare": "prepareIndependentStoppedTerminal",
    "entry": "runIndependentRejectedLink",
    "fixture": "terminal"
  },
  {
    "id": "terminal-resource-drop/first-resource",
    "title": "拖入含空格路径，只消费第一个资源",
    "prepare": "prepareIndependentStoppedTerminal",
    "entry": "runIndependentResourceDrop",
    "fixture": "terminal"
  },
  {
    "id": "execution-concurrency/agent-terminal",
    "title": "普通并发保持各自原执行输出和快照",
    "prepare": "prepareIndependentStoppedPair",
    "entry": "runIndependentConcurrency",
    "fixture": "agent-terminal"
  },
  {
    "id": "output-pressure/flood-fairness",
    "title": "持续单双流压力中 Note、Agent 与新增节点响应",
    "prepare": "prepareIndependentStoppedBase",
    "entry": "runIndependentFloodFairness",
    "fixture": "agent-terminal-note",
    "group": "pressure"
  },
  {
    "id": "output-pressure/ctrl-c-retains-session",
    "title": "独立双流 Ctrl-C 后原 PTY 仍可输入",
    "prepare": "prepareIndependentDualFlood",
    "entry": "runIndependentFloodCtrlC",
    "fixture": "two-terminals",
    "group": "pressure"
  }
];

// Additional non-TUI coverage uses independent real process fixtures.
const additionalSmokeCases = [
  ['surface-continuity/live-page-remount', '活动执行下真实页面重建', 'prepareIndependentTerminal', 'runIndependentLivePageRemount'],
  ['execution-exit/terminal-natural', 'Terminal 自然退出、最终保存和原 reader', 'prepareIndependentTerminal', 'runIndependentTerminalNatural'],
  ['execution-exit/terminal-error', 'Terminal 非零退出、最终保存和原 reader', 'prepareIndependentTerminal', 'runIndependentTerminalError'],
  ['execution-restart/terminal-after-exit', 'Terminal 正常及非零退出后显式新 Start', 'prepareIndependentTerminal', 'runIndependentTerminalRestart'],
  ['execution-exit/native-crash', '外部进程信号异常终止与资源退役', 'prepareIndependentAgent', 'runIndependentNativeCrash'],
  ['execution-stop/unresponsive', '忽略首次中断的原进程由产品有界升级停止', 'prepareIndependentAgent', 'runIndependentUnresponsiveStop'],
  ['execution-resize/live-geometry', '活动执行真实 TTY、页面和 Host 几何一致', 'prepareIndependentGeometrySubject', 'runIndependentLiveGeometry'],
  ['output-pressure/resize', '持续输出过程中原 TTY resize', 'prepareIndependentGeometrySubject', 'runIndependentPressureResize', 'pressure'],
  ['output-pressure/full-integrity', '高输出每行顺序、独立 hash 与最终保存一致', 'prepareIndependentGeometrySubject', 'runIndependentOutputIntegrity', 'pressure'],
  ['host-boundary-local/preserve-terminal-state', '真实新 Host 保留自然/Stop 终态', 'prepareIndependentHostBoundary', 'runIndependentHostBoundary'],
  ['host-boundary-local/new-host-manual-recovery', '真正新 Host 的 snapshot-only 手动恢复', 'prepareIndependentHostBoundary', 'runIndependentHostBoundary']
].map(([id, title, prepare, entry, group = 'local-products']) => ({ id, title, prepare, entry, group,
  fixture: prepare.replace('prepareIndependent', ''),
  ...(id.startsWith('host-boundary-local/') ? { hostRoles: ['setup', 'verify'] } : {}) }));

// These cases migrate trusted-only helpers from independent real preparation.
const trustedSmokeCases = [
  ['canvas-entry/first-template', '首次打开使用默认模板', 'prepareIndependentFirstOpen', 'verifyFirstOpenDefaultTemplate'],
  ['canvas-entry/surface-sidebar', 'Panel 和 Editor 入口及侧栏摘要', 'prepareIndependentEmpty', 'runIndependentSurfaceSidebar'],
  ['canvas-entry/trusted-templates', '可信工作区模板导入导出和应用', 'prepareIndependentEmpty', 'verifyCanvasTemplatesTrusted'],
  ['canvas-entry/default-surface-reload', '默认承载面仅在重载后生效', 'prepareIndependentEmpty', 'verifyDefaultSurfaceRequiresReload'],
  ['agent-resume-context/codex-locator', 'Codex 会话身份定位', 'prepareIndependentEmpty', 'verifyCodexSessionIdLocator'],
  ['agent-resume-context/claude-locator', 'Claude 会话身份定位', 'prepareIndependentEmpty', 'verifyClaudeSessionIdLocator'],
  ['agent-resume-context/codex-hint', 'Codex resume 提示解析', 'prepareIndependentEmpty', 'verifyCodexResumeCommandHintParser'],
  ['agent-resume-context/claude-hint', 'Claude resume 提示解析', 'prepareIndependentEmpty', 'verifyClaudeResumeCommandHintParser'],
  ['execution-config/cli-cache', '工作区和 shell 权威缓存隔离', 'prepareIndependentEmpty', 'verifyAgentCliCacheIsolation'],
  ['execution-config/default-provider', '默认 provider 配置更新', 'prepareIndependentEmpty', 'verifyRuntimeContextRefreshesDefaultAgentProvider'],
  ['execution-config/scrollback', 'scrollback 配置推送', 'prepareIndependentEmpty', 'verifyRuntimeContextRefreshesTerminalScrollback'],
  ['execution-config/stopped-shell', '已停止 Terminal 更新 shell 路径', 'prepareIndependentEmpty', 'verifyTerminalShellPathRefreshesStoppedTerminalNode'],
  ['execution-config/detected-shell', '所选 shell 精确路径持久化', 'prepareIndependentEmpty', 'verifySelectTerminalShellCommandPersistsExactDetectedPath'],
  ['execution-config/workspace-shell', 'shell 工作区覆盖', 'prepareIndependentEmpty', 'verifySelectTerminalShellCommandUpdatesWorkspaceOverride'],
  ['execution-config/default-root', '默认执行路径来自工作区 root', 'prepareIndependentEmpty', 'verifyDefaultExecutionNodeMetadataUsesWorkspaceRoot'],
  ['execution-config/relative-shell', '工作区相对 shell 路径', 'prepareIndependentEmpty', 'verifyWorkspaceRelativeTerminalShellPathUsesWorkspaceRoot'],
  ['canvas-nodes/create-quickpick', 'QuickPick 创建和 launch preset', 'prepareIndependentEmpty', 'verifyCreateNodeCommandQuickPick'],
  ['canvas-nodes/explorer-create', 'Explorer 资源创建执行与 Note', 'prepareIndependentEmpty', 'verifyExplorerResourceExecutionNodeCreation'],
  ['canvas-nodes/create-open-surface', '创建使用当前打开承载面', 'prepareIndependentEmpty', 'verifyCreateNodeCommandUsesOpenCanvasSurface'],
  ['canvas-nodes/create-selected-mode', 'QuickPick 保留用户所选模式', 'prepareIndependentEmpty', 'verifyCreateNodeCommandQuickPickKeepsSelectedModeUntilUserEdits'],
  ['canvas-nodes/create-preset-intent', '显式 preset 意图保留', 'prepareIndependentEmpty', 'verifyCreateNodeCommandQuickPickPreservesExplicitPresetIntent'],
  ['canvas-nodes/legacy-filter', '旧 Task 节点过滤', 'prepareIndependentEmpty', 'verifyPersistedStateFiltersLegacyTaskNodes'],
  ['canvas-nodes/empty-group-delete', '空组删除免确认', 'prepareIndependentEmpty', 'verifyEmptyGroupDeletionSkipsConfirmation'],
  ['canvas-nodes/nested-group-delete', '嵌套组递归删除范围确认', 'prepareIndependentEmpty', 'verifyNestedGroupDeletionConfirmationDisclosesRecursiveScope'],
  ['canvas-nodes/layout', '布局安排和持久化', 'prepareIndependentEmpty', 'verifyCanvasLayoutArrangementPersists'],
  ['canvas-nodes/note-host-update', 'Note 标题正文位置消息更新', 'prepareIndependentNote', 'runIndependentNoteHostUpdate'],
  ['canvas-nodes/dom-edit', '真实 DOM 修改各节点文本', 'prepareIndependentStoppedBase', 'runIndependentDomEdit'],
  ['canvas-nodes/saved-size', '节点尺寸页面和保存一致', 'prepareIndependentStoppedBase', 'runIndependentSavedSize'],
  ['canvas-nodes/dom-delete', '真实删除按钮和删除后节点集合', 'prepareIndependentStoppedBase', 'runIndependentDomDelete'],
  ['canvas-nodes/manual-edge', '手工连线生命周期', 'prepareIndependentStoppedPair', 'runIndependentManualEdge'],
  ['canvas-sidebar/node-list', '已完成执行的侧栏节点列表', 'prepareIndependentStoppedBase', 'runIndependentSidebarList'],
  ['canvas-sidebar/node-quickpick', '节点 QuickPick 身份与恢复详情', 'prepareIndependentStoppedBase', 'runIndependentSidebarQuickPick'],
  ['canvas-sidebar/node-ui', '侧栏节点定位和分组交互', 'prepareIndependentStoppedBase', 'runIndependentSidebarUI'],
  ['canvas-protocol/real-probe', '真实 Webview 内容和 ready probe', 'prepareIndependentStoppedBase', 'runIndependentRealProbe'],
  ['canvas-protocol/unknown-message', '未知消息准确提示并消失', 'prepareIndependentEmpty', 'runIndependentUnknownMessage'],
  ['canvas-protocol/standby', 'Standby 页面消息忽略', 'prepareIndependentNoteBody', 'runIndependentStandby'],
  ['canvas-protocol/pending-fault', '页面关闭取消延迟动作和 probe', 'prepareIndependentNoteBody', 'runIndependentPendingFault'],
  ['canvas-protocol/isolated-lifecycle', '隔离的受控 ready 生命周期诊断', 'prepareIndependentEmpty', 'verifyWebviewLifecycleRaceDiagnostics'],
  ['canvas-notes/checklist', '真实 Note 清单切换', 'prepareIndependentNote', 'runIndependentChecklist'],
  ['canvas-notes/file-links', 'Note 工作区文件位置链接', 'prepareIndependentNote', 'runIndependentNoteFileLink'],
  ['canvas-notes/markdown-association', 'Markdown 文件关联与完整正文', 'prepareIndependentEmpty', 'verifyNoteMarkdownFileAssociation'],
  ['execution-notifications/bridge-migration', '旧通知配置迁移', 'prepareIndependentEmpty', 'verifyLegacyAttentionNotificationBridgeMigration'],
  ['execution-notifications/attention', '注意信号通知和节点回跳', 'prepareIndependentStoppedAgentNote', 'runIndependentAttention'],
  ['execution-notifications/abnormal', '异常中断通知及去重', 'prepareIndependentEmpty', 'verifyAgentAbnormalInterruptionNotifications'],
  ['terminal-view/local-scrollback', '本地模式重载保存配置的历史', 'prepareIndependentStoppedTerminal', 'runIndependentLocalScrollback'],
  ['terminal-view/editor-viewport', 'Editor tab 切换保留视口', 'prepareIndependentStoppedTerminal', 'runIndependentEditorViewport'],
  ['terminal-view/panel-viewport', 'Panel tab 切换保留视口', 'prepareIndependentStoppedTerminal', 'runIndependentPanelViewport'],
  ['terminal-view/workbench-theme', '内嵌 Terminal 跟随主题', 'prepareIndependentStoppedPair', 'runIndependentTheme'],
  ['canvas-reconcile/completed-state', '已完成节点重读和真实存储来源', 'prepareIndependentCompletedDomBase', 'runIndependentCompletedState'],
  ['surface-continuity/cutover', '同一原执行跨承载面和画布重读', 'prepareIndependentStoppedTerminal', 'runIndependentCutover'],
  ['host-boundary-local/recent-state-flush', '模拟 Host 边界保存刚输出正文', 'prepareIndependentStoppedPair', 'runIndependentRecentStateFlush'],
  ['runtime-recovery/live-persistence', 'Runtime 重连同一执行和正文', 'prepareIndependentRuntimeLiveBase', 'runIndependentLivePersistence', 'runtime-products'],
  ['terminal-view/runtime-scrollback', 'Runtime 活动执行更新历史容量', 'prepareIndependentRuntimeStoppedBase', 'runIndependentRuntimeScrollback', 'runtime-products'],
  ['runtime-projection/completed-no-history', '完整输出 drain 后丢弃已完成历史', 'prepareIndependentRuntimeStoppedBase', 'runIndependentRuntimeCompleted', 'runtime-products'],
  ['runtime-recovery/binding-failure', '重连失败保留原 binding', 'prepareIndependentRuntimeStoppedBase', 'runIndependentBindingFailure', 'runtime-products'],
  ['runtime-recovery/no-stale-resume', '历史重载不提交陈旧自动 resume', 'prepareIndependentRuntimeStoppedBase', 'runIndependentNoStaleResume', 'runtime-products'],
  ['runtime-recovery/exit-classification', '已恢复执行非零退出分类', 'prepareIndependentRuntimeResumeBase', 'runIndependentRuntimeExit', 'runtime-products'],
  ['runtime-recovery/immediate-boundary', '启动仍在途时模拟 Host 边界', 'prepareIndependentRuntimeStoppedBase', 'runIndependentImmediateBoundary', 'runtime-products'],
  ['runtime-mode/reload-clear', 'Runtime 配置重载生效及关闭清理', 'prepareIndependentEmpty', 'verifyRuntimePersistenceRequiresReloadAndClearsState', 'runtime-products'],
  ['execution-start/missing-cli', '缺失 CLI 的准备失败和一次结算', 'prepareIndependentEmpty', 'runIndependentMissingCLI'],
  ['execution-start/invalid-launch', '拒绝跨 provider 自定义命令', 'prepareIndependentCompletedDomBase', 'runIndependentInvalidLaunch'],
  ['canvas-protocol/missing-node', '缺失节点的准确错误和原状态保留', 'prepareIndependentCompletedDomBase', 'runIndependentMissingNode'],
  ['execution-file-activity/views', '文件活动视图和真实 Editor 打开', 'prepareIndependentEmpty', 'verifyFileActivityViewsAndOpenFiles'],
  ['execution-file-activity/read-exit-drain', '执行结束后的文件活动 drain', 'prepareIndependentEmpty', 'verifyReadExitFileActivityDrain'],
  ['session-history/restore', '侧栏历史恢复', 'prepareIndependentEmpty', 'verifySidebarSessionHistoryRestore'],
  ['session-history/fork-ui', '侧栏历史分叉按钮', 'prepareIndependentEmpty', 'verifySidebarSessionHistoryForkActionUi'],
  ['session-history/codex-branch', 'Codex 当前节点分支', 'prepareIndependentEmpty', 'verifyCodexAgentBranchFromCurrentNode'],
  ['session-history/claude-branch', 'Claude 当前节点分支', 'prepareIndependentEmpty', 'verifyClaudeAgentBranchFromCurrentNode'],
  ['session-history/branch-rejection', '不支持分支的来源拒绝', 'prepareIndependentEmpty', 'verifyAgentBranchRejectsUnsupportedSources'],
  ['session-history/search', '侧栏历史标题搜索', 'prepareIndependentEmpty', 'verifySidebarSessionHistorySearchByTitleUi'],
  ['session-history/doubleclick', '侧栏历史双击恢复', 'prepareIndependentEmpty', 'verifySidebarSessionHistoryDoubleClickUi']
].map(([id, title, prepare, entry, group = 'local-products']) => ({ id, title, prepare, entry, group,
  fixture: prepare.replace('prepareIndependent', '') }));

export const independentSmokeCases = Object.freeze([...lifecycleSmokeCases, ...trustedSmokeCases, ...additionalSmokeCases].map(entry => Object.freeze({
  ...entry, variant: entry.id.replaceAll('/', '--'), kind: 'product-case', source: true, packaged: true,
  launcher: 'ordinary', disableWorkspaceTrust: true,
  group: entry.group ?? 'local-products',
  packagedGroup: entry.group ?? 'local-products',
  testFile: 'extension-tests.cjs',
  steps: Object.freeze(['fixture', 'business', 'owned-resize-errors']),
  evidence: Object.freeze(['original-execution', 'action-and-assert', 'fixture-retirement', 'original-host-exit'])
})));

// This is the execution catalogue, not the proposed 152-case migration map.
// Finite combinations retain required causal steps and original identities.
const local = ['owned-canvas-reconciliation', 'snapshot-only-manual-recovery', 'restricted'];
const runtime = ['runtime-checkpoint-refresh', 'legacy-supervisor-upgrade'];
const topology = ['real-reopen', 'multi-root-real-reopen', 'single-to-multi-root-real-reopen',
  'two-window-shared-runtime', 'systemd-user-real-reopen', 'systemd-fallback-real-reopen',
  'remote-ssh-real-reopen-exit', 'remote-ssh-real-reopen-retain'];
const packaged = new Set(local.filter(id => id !== 'restricted'));
const causalSteps = {
  'owned-canvas-reconciliation': ['original-start','reread','root-remap','remove-root','host-boundary','explicit-start'],
  'snapshot-only-manual-recovery': ['fixture','interrupt-and-flush','manual-resume','resumed-nonzero','manual-terminal-start'],
  'runtime-checkpoint-refresh': ['fixture-output','initial-current-state','reload-current-state','completion-drain','completed-page-reopen','legacy-completed-migration'],
  ...Object.fromEntries(topology.filter(id=>id!=='two-window-shared-runtime')
    .map(id=>[id,{ setup: ['fixture-start', 'offline-fixture-and-save'],
      verify: ['original-host-condition', 'reconnect-and-content', 'input-after-reopen', 'resize', 'product-retirement'] }])),
  'legacy-supervisor-upgrade': ['fixture-generations', 'attach-old-generations', 'old-generation-io-resize',
    'current-generation-isolation', 'old-generation-retirement', 'current-after-old-exit'],
  'two-window-shared-runtime': {
    owner: ['fixture-start', 'peer-attach-and-shared-canvas', 'bidirectional-io', 'shared-resize',
      'shared-stop', 'shared-delete', 'non-last-departure', 'private-isolation-and-reenable'],
    attacher: ['fixture-attach', 'shared-canvas', 'bidirectional-io', 'shared-resize',
      'shared-stop', 'shared-delete', 'last-departure', 'private-isolation-and-reenable']
  }
};
export const smokeCatalogVersion = 3;
export const smokeGroups = Object.freeze(['local-products', 'runtime-products', 'host-topology', 'pressure', 'real-tui']);
export const packagedGroups = Object.freeze(['local-products', 'runtime-products', 'pressure', 'real-tui']);
const legacySmokeCatalog = Object.freeze([
  ...local.map(id => ({ id, group: 'local-products' })),
  ...runtime.map(id => ({ id, group: 'runtime-products' })),
  ...topology.map(id => ({ id, group: 'host-topology' })),
  ...['runtime-legacy-reconnect', 'linux-runtime-report-unavailable', 'runtime-completed-no-history']
    .map(id => ({ id, group: 'runtime-products', diagnosticOnly: true }))
].map(entry => Object.freeze({ ...entry, variant: entry.id, kind: 'legacy-suite',
  ...(causalSteps[entry.id]?{steps:causalSteps[entry.id]}:{}),
  launcher: local.includes(entry.id) || entry.diagnosticOnly || entry.id === 'runtime-checkpoint-refresh' ? 'ordinary' : 'topology',
  title: entry.id, disableWorkspaceTrust: entry.id !== 'restricted',
  ...(entry.id === 'restricted' ? { userSettings: { 'security.workspace.trust.enabled': true,
    'security.workspace.trust.startupPrompt': 'never', 'security.workspace.trust.banner': 'never',
    'security.workspace.trust.untrustedFiles': 'open' } } : {}),
  source: true, packaged: packaged.has(entry.id),
  packagedGroup: entry.id === 'snapshot-only-manual-recovery' ? 'runtime-products' : 'local-products',
  // Business waits stay in the original helpers; the Host ceiling is derived
  // from those helpers by smoke-budget.mjs, not used to extend a product wait.
  testFile: entry.id === 'linux-runtime-report-unavailable'
    ? 'runtime-compatibility-tests.cjs' : entry.id === 'legacy-supervisor-upgrade'
      ? 'legacy-supervisor-upgrade-tests.cjs' : entry.id === 'two-window-shared-runtime'
        ? 'two-window-shared-runtime-tests.cjs' : topology.includes(entry.id)
          ? 'real-reopen-tests.cjs' : 'extension-tests.cjs' })));

export const realTuiSmokeCases = Object.freeze([
  ['input-during-work', '真实 TUI 处理中输入可用'],
  ['answer-with-footer', '本回合实际回答在真实 footer 上方'],
  ['tool-network-silence', '工具等待静默期间原回合仍处理中'],
  ['turn-completion-redraw', '独立回合完成后的真实重绘']
].map(([name, title]) => Object.freeze({ id: `agent-tui/${name}`, title,
  variant: `agent-tui--${name}`, kind: 'real-tui', launcher: 'real-tui',
  group: 'real-tui', packagedGroup: 'real-tui', source: true, packaged: true,
  testFile: 'agent-tui-tests.cjs', providers: ['codex', 'claude'], platform: 'linux', mode: 'snapshot-only',
  steps: ['codex-prepare', 'codex-action', 'codex-assert', 'claude-prepare', 'claude-action', 'claude-assert'] })));
export const smokeCatalog = Object.freeze([...independentSmokeCases, ...legacySmokeCatalog, ...realTuiSmokeCases]);

// These contracts describe actual Host invocations, including causal phases.
// A receipt from another case/file/role cannot satisfy a planned invocation.
export function smokeHostContract(caseID) {
  const entry = smokeCatalog.find(item => item.id === caseID);
  if (entry) return { caseID, subjects: [{ testFile: entry.testFile,
    roles: entry.hostRoles ?? (entry.id === 'two-window-shared-runtime' ? ['owner', 'attacher']
      : entry.testFile === 'real-reopen-tests.cjs' ? ['setup', 'verify'] : ['main']) }] };
  const auxiliary = {
    'notifier-companion': [{ testFile: 'notifier-companion-tests.cjs', roles: ['main'] }],
    'notifier-locale': [{ testFile: 'notifier-locale-tests.cjs', roles: ['en', 'zh-cn'] }],
    'ui-copy-locale': [{ testFile: 'ui-copy-locale-tests.cjs', roles: ['en', 'zh-cn'] }],
    'marketplace-host': [{ testFile: 'template-marketplace-tests.cjs', roles: ['main'] }],
    'marketplace-preview': [{ testFile: 'template-marketplace-preview-tests.cjs', roles: ['main'] }]
  };
  if (!auxiliary[caseID]) throw new Error(`Unknown planned Host contract: ${caseID}`);
  return { caseID, subjects: auxiliary[caseID] };
}

export function selectSmokeSuites({ payload = 'source', group, scenario, diagnostic = false } = {}) {
  if (!['source', 'packaged'].includes(payload)) throw new Error('Unknown smoke payload');
  if (group && !(payload === 'source' ? smokeGroups : packagedGroups).includes(group)) {
    throw new Error(`Unknown ${payload} smoke group: ${group}`);
  }
  const selected = smokeCatalog.filter(item => item[payload]
    && (diagnostic || !item.diagnosticOnly) && (!group || (payload === 'packaged' ? item.packagedGroup : item.group) === group)
    && (!scenario || item.id === scenario));
  if (!selected.length) throw new Error('Smoke selection is empty or outside its declared scope');
  return selected;
}
