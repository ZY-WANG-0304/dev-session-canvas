# Claude Code Agent Fork Implementation Plan

> 2026-06-13 补充：本文记录最初 Claude Code Agent Fork 的实现计划。当前正式产品范围已经在 `docs/design-docs/agent-launch-modes-and-restart.md` 扩展为 Codex / Claude Code provider-native Fork；Codex 使用 `codex fork <session-id>`，不再属于“不可启用 Fork”的 provider；最新用户可见按钮文案为中文 `分叉`，分叉节点标题栏状态也应像普通 Agent 节点一样显示。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a user-visible `Fork` action on Claude Code Agent nodes that creates a new Agent node and immediately starts it with `claude --resume <session-id> --fork-session`.

**Architecture:** The feature follows the existing Webview-to-Host command flow: `src/webview/main.tsx` posts a new protocol message, `src/common/protocol.ts` validates it, and `src/panel/CanvasPanelManager.ts` performs all trusted state checks before creating and launching the branch node. Command construction lives in `src/common/agentLaunchPresets.ts`, reusing the existing resume-target stripping and command formatting rules so the user-visible Fork action cannot be confused with ordinary resume.

**Tech Stack:** TypeScript, VS Code extension host, React Webview, node-pty/runtime supervisor launch path, Playwright Webview harness, VS Code smoke tests, Node script tests.

---

本 `ExecPlan` 是活文档。随着工作推进，必须持续更新 `进度`、`意外与发现`、`决策记录` 和 `结果与复盘` 这几个章节。

当前文档必须按 `docs/PLANS.md` 的要求持续维护。本计划实现已提交设计 `b3ef9cf docs(canvas): define Claude Code Agent Branch semantics` 中的 Claude Code fork-session 方案；当前用户可见术语已按最新决策收口为 `分叉`，内部 protocol 与 helper 继续沿用 `branchAgentSession` / `buildClaudeBranchCommandLine`，相关正式规格在 `docs/product-specs/agent-launch-modes-and-restart.md`，相关设计在 `docs/design-docs/agent-launch-modes-and-restart.md`。

## 目标与全局图景

完成后，用户在 DevSessionCanvas 里看到一个已经持有可信 Claude Code session id 的 Agent 节点时，可以点击标题栏里的 `分叉`。画布会新增一个 Agent 节点，标题弱提示它来自原节点，自动创建一条普通可编辑 `user` 边，并立即启动 Claude Code，启动命令包含原 session id 和 `--fork-session`。原节点不停止、不改 metadata，用户可以继续在原节点或新节点里独立对话。

从代码路径看，Webview 只表达“对 nodeId 执行分叉”的意图；Host 重新读取权威节点 metadata，确认 provider 是 `claude` 且 `resumeStrategy === 'claude-session-id'` 且 `resumeSessionId` 非空。Host 然后构造 fork-session 命令，创建新 Agent 节点，依赖已有 `pendingLaunch: 'start'` 自动启动机制让新节点进入执行路径。

## 文件结构与职责

`src/common/agentLaunchPresets.ts` 负责命令字符串的纯逻辑。新增 `buildClaudeBranchCommandLine(sessionId, defaults)`，它只支持 Claude Code，使用当前 Claude 命令路径、默认参数中仍可保留的非 session-target 参数，以及 `--resume <session-id> --fork-session` 生成完整命令。它必须剥离默认参数里的旧 `--resume`、`--continue`、`--session-id`、`-r`、`-c` 目标，避免同一命令携带两个 resume 目标。

`scripts/test/test-agent-launch-presets.mjs` 是命令层回归测试。新增断言覆盖分叉命令生成、默认参数目标剥离、空 session id 报错、命令格式化保留可用默认参数。

`src/common/protocol.ts` 是 Webview/Host 共享协议。新增 `webview/branchAgentSession` 消息，payload 只有 `{ nodeId: string }`。`parseWebviewMessage()` 必须拒绝缺失或非字符串 nodeId 的消息。

`scripts/test/test-protocol-webview-messages.mts` 是协议解析回归。新增有效 `webview/branchAgentSession` 消息和无效 payload 断言。

`src/webview/main.tsx` 负责 Agent 节点标题栏按钮和 postMessage。新增 `onBranchAgentSession` 回调和 Agent 节点内 `Fork` 按钮。按钮只在 provider 为 `claude` 且 `canResumeAgentFromMetadataForWebview(agentMetadata)` 为真时显示；点击只发送 nodeId，不发送 session id。

`tests/playwright/webview-harness.spec.mjs` 负责 Webview 行为回归。最初新增测试确认 Claude resumable 节点显示 `Fork` 并 post `webview/branchAgentSession`，Claude 不可恢复节点不显示 `Fork`；2026-06-13 起该覆盖已扩展为 Codex / Claude Code 两个 supported provider，Codex resumable 节点同样应显示 `Fork`。

`src/panel/CanvasPanelManager.ts` 负责 Host 权威行为。新增 `branchAgentSession(nodeId)` 和 `buildClaudeBranchCommandLine(sessionId)` 私有方法，在 message switch 中处理 `webview/branchAgentSession`。该方法负责 trust 检查、节点存在检查、provider/session 检查、创建新节点、保留弱标题、聚焦新节点，并让新节点立即启动。

`tests/vscode-smoke/extension-tests.cjs` 负责 Host 端集成回归。新增 smoke helper/verify 函数，通过 `dispatchWebviewMessage({ type: 'webview/branchAgentSession', payload: { nodeId } })` 验证 Host 新增一个 Claude Agent 节点，metadata 是 `custom` 启动命令，命令包含 `--resume <id> --fork-session`，原节点 metadata 不变；同时验证 Codex/缺 session id 不会新增节点。

`docs/exec-plans/active/claude-agent-branch.md` 是本活文档。执行时每完成一个任务都更新 `进度`，发现新事实时更新 `意外与发现`，关键取舍更新 `决策记录`，完成后更新 `结果与复盘`。

## 进度

- [x] (2026-06-06) 完成设计规格并提交 `b3ef9cf docs(canvas): define Claude Code Agent Branch semantics`。
- [x] (2026-06-06) 起草本实现计划，覆盖命令层、协议、Host、Webview、测试与验证。
- [x] (2026-06-07) 实现命令层 fork-session builder 与 Node 脚本测试，提交 `8b39342`。
- [x] (2026-06-07) 实现共享协议消息与协议解析测试，提交 `ab243c6`。
- [x] (2026-06-07) 实现 Webview Fork 按钮与 Playwright 测试，提交 `ee15afc`。
- [x] (2026-06-07) 实现 Host Fork 创建/启动路径与 smoke 测试，提交 `13a7977`。
- [x] (2026-06-07) 根据质量审查补齐 Claude Fork fork-session 的新 session 候选处理：Host 会在 `--resume <source> --fork-session` 启动时追加独立 `--session-id <candidate>`，并用 smoke 覆盖最终启动参数。
- [x] (2026-06-08) 运行 targeted 验证、更新文档验证状态，并按 review 将用户可见入口从 `Branch` 收口为 `Fork`；内部 `webview/branchAgentSession` protocol 与 `buildClaudeBranchCommandLine()` helper 保持不改名。
- [ ] (需真实 CLI 环境) 在安装了支持 `--fork-session` 的 Claude Code CLI 的本地 Development Host 中手动验证 provider 真实新 session id；当前自动化已覆盖 Host/Webview 路径与最终 launch args。

## 意外与发现

- 观察：`applyCreateNode('agent', ...)` 已经把新 Agent 节点状态设置为 `starting` 并写入 `pendingLaunch: 'start'`，Webview 后续会根据 `pendingLaunch` 自动调用 start。
  证据：`src/panel/CanvasPanelManager.ts:12966-12984` 设置 Agent `pendingLaunch: 'start'`；`src/webview/main.tsx:4156-4171` 检测 pendingLaunch 并调用 `startAgent(...)`。

- 观察：Webview 侧的可恢复判断已经允许 Claude 只凭 `resumeStrategy === 'claude-session-id'` 与非空 `resumeSessionId` 显示恢复动作，不要求 `resumeStoragePath`。
  证据：`src/webview/main.tsx:11238-11257` 中 `canResumeAgentFromMetadataForWebview()` 对 Claude/Codex 返回 `Boolean(metadata.resumeSessionId?.trim())`。

- 观察：Claude Fork 的启动命令同时包含“源 session”的 `--resume <source>` 和“新 fork”的会话身份需求；如果 Host 只把 `--resume <source>` 当成显式 session flag，新节点会缺少自己的候选 session id。
  证据：质量审查指出 `resolveAgentResumeContext()` 对任意显式 Claude session flag 返回旧 session id；修复后 smoke 会检查最终 `execution/started` launch args 同时包含 `--resume <source>`、`--fork-session` 和一个不同于 source 的 `--session-id <candidate>`。

## 决策记录

- 决策：Fork 消息 payload 只携带 `nodeId`，不携带 provider 或 session id。
  理由：Webview 是非权威 UI，session id 必须从 Host 当前状态重新读取；这样能避免伪造消息用任意 session id 启动 CLI。
  日期/作者：2026-06-06 / Claude

- 决策：Fork 新节点使用 `agentLaunchPreset: 'custom'` 和 `agentCustomLaunchCommand`，复用现有 fresh-start 启动链路。
  理由：Fork 命令是一次明确的 provider-specific 启动命令，现有 custom preset 已经能持久化完整命令并走统一校验、resolver、pendingLaunch 自动启动流程。
  日期/作者：2026-06-06 / Claude

- 决策：Fork 新节点自动创建一条从来源 Agent 指向新 Agent 的普通可编辑 `user` 边，但不写入机器可读 branch lineage metadata。
  理由：用户确认第一版不需要正式分支关系；普通边能表达视觉来源，也保留用户编辑/删除自由，不把它升级成分支树或合并语义。
  日期/作者：2026-06-08 / Claude

- 决策：`--fork-session` 启动时即使命令已经包含源 session 的 `--resume <source>`，Host 仍要生成或保留一个独立的 `--session-id <candidate>` 作为新 fork 节点自己的 Claude session 候选。
  理由：Claude Code 的 `--fork-session` 语义是用源 session 作为上下文，同时创建新的 provider session id；源 session id 不能成为新节点的恢复身份。
  日期/作者：2026-06-07 / Claude

## 结果与复盘

已实现 Claude Code Agent 的用户可见 `Fork` 动作：Webview 标题栏在可信 Claude session 节点上显示 `Fork`，继续通过内部 `webview/branchAgentSession` 消息把 node id 交给 Host；Host 重新校验 provider、workspace trust 与 `claude-session-id`，创建新的 custom Claude Agent 节点，并用 `claude --resume <source-session-id> --fork-session` 启动。

实现过程中补齐了一个关键边界：Fork 启动命令中的 `--resume <source>` 是上下文来源，不是新节点自己的恢复身份；Host 会继续为新 fork 节点生成独立 `--session-id <candidate>`，并用 smoke 断言最终 launch args 同时包含源 `--resume`、`--fork-session` 和不同于源 session 的新候选 session id。

后续 review 又收口了两项：第一，Fork 新节点创建后会自动生成一条从来源 Agent 指向新 Agent 的普通可编辑 `user` 边，但仍不写机器可读 branch lineage；第二，用户可见按钮、aria、错误提示、测试名和产品/设计文档术语从 `Branch` 改为 `Fork`，内部 protocol/helper 名称暂不重命名以避免无必要 churn。

已完成的验证包括：`node scripts/test/test-agent-launch-presets.mjs`、`npm run typecheck`、focused Playwright harness（Fork postMessage、Forked Agent 标题栏布局、Fork 隐藏规则、上游 compact restart 布局）以及 focused VS Code smoke 验证中的 Host 创建/启动/拒绝路径。完整 smoke 曾受非本功能侧栏节点列表动作超时阻塞；真实 Claude Code CLI 的 provider 级新 session id 仍需在安装了支持 `--fork-session` 的本地 Development Host 中人工确认。

## 上下文与定向

当前 Agent 启动/恢复能力已经分三层：共享命令层在 `src/common/agentLaunchPresets.ts`，Webview 消息协议在 `src/common/protocol.ts`，Host 执行编排在 `src/panel/CanvasPanelManager.ts`。已有历史恢复入口 `CanvasPanelManager.restoreAgentSessionFromHistory()` 会调用 `buildHistoryResumeCommandLine()`，然后创建一个 custom Agent 节点；Fork 要复用这个结构，但命令必须是 Claude Code 的 fork 语义。

`AgentNodeMetadata` 在 `src/common/protocol.ts` 中定义，包含 `provider`、`launchPreset`、`customLaunchCommand`、`resumeStrategy`、`resumeSessionId` 等字段。Host 端 `isAgentProviderBranchSupported()` 在 `src/panel/CanvasPanelManager.ts` 文件底部附近，Webview 端 `canForkAgentFromMetadataForWebview()` 在 `src/webview/main.tsx` 文件底部附近。Fork 的当前可信条件是 provider 为 `claude` 且 resume strategy 为 `claude-session-id`，或 provider 为 `codex` 且 resume strategy 为 `codex-session-id`，并且 session id 非空；其他 provider 或 resumeStrategy 不匹配的节点不能启用。

`applyCreateNode()` 在 `src/panel/CanvasPanelManager.ts` 中负责创建节点。创建 Agent 成功后，它会把新节点置为 `starting` 并写 `pendingLaunch: 'start'`。这意味着 Host 的 `branchAgentSession()` 方法只需要创建新节点并 post state；Webview 收到新节点后会自动启动。为了让启动发生，Fork 新节点必须使用有效 custom command，并且 workspace 必须 trusted。

## 工作计划

先做命令层，因为它是最小、最容易 TDD 的单元。然后扩展协议，保证 Webview 能发出明确消息且 parser 能拒绝伪造 payload。之后实现 Webview 按钮，先用 Playwright 证明 UI 消息正确。最后实现 Host 行为和 smoke 测试，证明真实状态变更、新节点 metadata、拒绝场景都正确。

每个任务完成后都提交一次小 commit。提交信息使用仓库风格，例如 `feat(canvas): ...` 或 `test(canvas): ...`，并保留 Claude co-author trailer。

## 具体步骤

### Task 1: Add Claude fork-session command builder

**Files:**
- Modify: `src/common/agentLaunchPresets.ts:50-66`, `src/common/agentLaunchPresets.ts:470-483`, `src/common/agentLaunchPresets.ts:634-664`
- Modify: `scripts/test/test-agent-launch-presets.mjs:24-35`
- Test: `scripts/test/test-agent-launch-presets.mjs`

- [ ] **Step 1: Add failing command builder tests**

  In `scripts/test/test-agent-launch-presets.mjs`, add `buildClaudeBranchCommandLine` to the destructured import next to `buildAgentHistoryResumeCommandLine`:

      const {
        buildAgentPresetCommandLine,
        buildFreshAgentCommandLine,
        buildAgentHistoryResumeCommandLine,
        buildClaudeBranchCommandLine,
        classifyAgentLaunchPreset,
        extractClaudeCommandSessionFlag,
        formatCommandLine,
        hasAnyCommandLineFlag,
        matchesAgentCommandLinePreset,
        parseCommandLine,
        validateAgentCommandLine
      } = require(outfile);

  After the existing `claudeDefaults` declaration near the top of the file, add these assertions:

      assert.equal(
        buildClaudeBranchCommandLine('claude-branch-session-123', claudeDefaults),
        '/tmp/providers/claude-custom --resume claude-branch-session-123 --fork-session'
      );

      assert.equal(
        buildClaudeBranchCommandLine(' claude-branch-session-456 ', {
          command: 'claude',
          defaultArgs: '--model opus --resume old-session --permission-mode plan'
        }),
        'claude --resume claude-branch-session-456 --fork-session --model opus --permission-mode plan'
      );

      assert.equal(
        buildClaudeBranchCommandLine('claude-branch-session-789', {
          command: 'claude',
          defaultArgs: '--session-id old-session --continue older-session --dangerously-skip-permissions'
        }),
        'claude --resume claude-branch-session-789 --fork-session --dangerously-skip-permissions'
      );

      assert.throws(
        () => buildClaudeBranchCommandLine('   ', claudeDefaults),
        /分叉会话标识不能为空。/
      );

- [ ] **Step 2: Run test and verify it fails**

  Run from repo root:

      npm run test:agent-launch-presets

  Expected result: FAIL because `buildClaudeBranchCommandLine` is not exported.

- [ ] **Step 3: Implement minimal command builder**

  In `src/common/agentLaunchPresets.ts`, add this exported function immediately after `buildAgentHistoryResumeCommandLine()`:

      export function buildClaudeBranchCommandLine(
        sessionId: string,
        defaults: AgentProviderLaunchDefaults
      ): string {
        const normalizedSessionId = sessionId.trim();
        if (!normalizedSessionId) {
          throw new Error('分叉会话标识不能为空。');
        }

        const command = defaults.command.trim() || 'claude';
        const baseArgs = assertAgentDefaultArgsParsable('claude', defaults);
        return formatCommandLine([
          command,
          ...buildClaudeBranchArgv(baseArgs, normalizedSessionId)
        ]);
      }

  Then add this helper near `buildAgentResumeArgv()`:

      function buildClaudeBranchArgv(baseArgs: readonly string[], explicitSessionId: string): string[] {
        const normalizedArgs = stripClaudeResumeTargetArgs(baseArgs);
        return ['--resume', explicitSessionId, '--fork-session', ...normalizedArgs];
      }

  Do not change `buildAgentResumeArgv()` yet. Fork is a separate user-visible path backed by `--fork-session`, not a new launch preset.

- [ ] **Step 4: Run command builder tests and verify they pass**

  Run:

      npm run test:agent-launch-presets

  Expected result: PASS.

- [ ] **Step 5: Commit Task 1**

  Run:

      git add src/common/agentLaunchPresets.ts scripts/test/test-agent-launch-presets.mjs
      git commit -m "$(cat <<'EOF'
      feat(canvas): build Claude Agent fork command

      Add a dedicated command builder for Claude Code fork-session launches so they cannot be confused with ordinary resume commands.

      Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
      EOF
      )"

### Task 2: Add Webview protocol message

**Files:**
- Modify: `src/common/protocol.ts:706-715`, `src/common/protocol.ts:1413-1445`
- Modify: `scripts/test/test-protocol-webview-messages.mts:109-125`
- Test: `scripts/test/test-protocol-webview-messages.mts`

- [ ] **Step 1: Add failing protocol parser tests**

  In `scripts/test/test-protocol-webview-messages.mts`, after the `hardwrapOpenMessage` assertion, add:

      const branchAgentSessionMessage = {
        type: 'webview/branchAgentSession',
        payload: {
          nodeId: 'agent-branch-source'
        }
      };

      assert.deepEqual(parseWebviewMessage(branchAgentSessionMessage), branchAgentSessionMessage);
      assert.equal(
        parseWebviewMessage({
          type: 'webview/branchAgentSession',
          payload: {
            nodeId: 42
          }
        }),
        null,
        'webview/branchAgentSession.nodeId 必须是字符串。'
      );

- [ ] **Step 2: Run protocol test and verify it fails**

  Run:

      npm run test:protocol-webview-messages

  Expected result: FAIL because `parseWebviewMessage()` returns null for `webview/branchAgentSession`.

- [ ] **Step 3: Extend protocol type**

  In `src/common/protocol.ts`, add this union member immediately after `webview/startExecutionSession`:

      | {
          type: 'webview/branchAgentSession';
          payload: {
            nodeId: string;
          };
        }

- [ ] **Step 4: Extend `parseWebviewMessage()`**

  In `src/common/protocol.ts`, add this block after the existing `webview/startExecutionSession` parse block and before `webview/resizeExecutionSession`:

      if (value.type === 'webview/branchAgentSession') {
        const payload = isRecord(value.payload) ? value.payload : null;
        if (!payload || typeof payload.nodeId !== 'string') {
          return null;
        }

        return {
          type: 'webview/branchAgentSession',
          payload: {
            nodeId: payload.nodeId
          }
        };
      }

- [ ] **Step 5: Run protocol test and typecheck**

  Run:

      npm run test:protocol-webview-messages
      npm run typecheck

  Expected result: both PASS.

- [ ] **Step 6: Commit Task 2**

  Run:

      git add src/common/protocol.ts scripts/test/test-protocol-webview-messages.mts
      git commit -m "$(cat <<'EOF'
      feat(canvas): add Agent Fork webview protocol

      Let Agent nodes request a Fork action while keeping provider and session identity checks on the host side.

      Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
      EOF
      )"

### Task 3: Add Webview Fork button

**Files:**
- Modify: `src/webview/main.tsx:269-333`, `src/webview/main.tsx:2176-2187`, `src/webview/main.tsx:4110-4280`, `src/webview/main.tsx:10482-10515`, `src/webview/main.tsx:10603-10612`
- Modify: `tests/playwright/webview-harness.spec.mjs:2262-2375`, `tests/playwright/webview-harness.spec.mjs:12888-12900`
- Test: `tests/playwright/webview-harness.spec.mjs`

- [ ] **Step 1: Add failing Playwright tests**

  In `tests/playwright/webview-harness.spec.mjs`, after `agent restart actions render inline without a dropdown`, add:

      test('Claude Agent Fork action posts a branchAgentSession message', async ({ page }) => {
        await openHarness(page);
        await bootstrap(page, createStoppedAgentNodeState({ provider: 'claude', resumable: true }));
        await clearPostedMessages(page);

        const agentNode = nodeById(page, 'agent-1');
        await expect(agentNode.locator('[data-agent-branch-action="true"]')).toBeVisible();
        await agentNode.locator('[data-agent-branch-action="true"]').click();

        await expect
          .poll(async () => {
            return page.evaluate(() => {
              const message = window.__devSessionCanvasHarness
                .getPostedMessages()
                .find((entry) => entry.type === 'webview/branchAgentSession');

              return message
                ? JSON.stringify({
                    type: message.type,
                    payload: message.payload
                  })
                : null;
            });
          })
          .toBe(
            JSON.stringify({
              type: 'webview/branchAgentSession',
              payload: {
                nodeId: 'agent-1'
              }
            })
          );
      });

      test('Agent Fork action is hidden outside resumable Claude sessions', async ({ page }) => {
        await openHarness(page);
        await bootstrap(page, createStoppedAgentNodeState({ provider: 'codex', resumable: true }));
        await expect(nodeById(page, 'agent-1').locator('[data-agent-branch-action="true"]')).toHaveCount(0);

        await bootstrap(page, createStoppedAgentNodeState({ provider: 'claude', resumable: false }));
        await expect(nodeById(page, 'agent-1').locator('[data-agent-branch-action="true"]')).toHaveCount(0);
      });

- [ ] **Step 2: Run targeted Webview tests and verify failure**

  Run:

      npm run test:webview -- --grep "Agent Fork"

  Expected result: FAIL because no Fork button exists.

- [ ] **Step 3: Add Webview callback type and postMessage**

  In the `CanvasNodeData` interface, add after `onStartExecution`:

      onBranchAgentSession?: (nodeId: string) => void;

  In the object that builds node callbacks near `onStartExecution`, add:

      onBranchAgentSession: (nodeId) =>
        postMessage({
          type: 'webview/branchAgentSession',
          payload: { nodeId }
        }),

  In the parameter type near `onStartExecution`, add:

      onBranchAgentSession: (nodeId: string) => void;

  In `buildCanvasNodeData`, pass it through:

      onBranchAgentSession: params.onBranchAgentSession,

- [ ] **Step 4: Add Agent Fork button rendering**

  In `AgentSessionNode`, add after `deleteAgent` helper:

      const branchAgent = (): void => {
        data.onSelectNode?.(id);
        data.onBranchAgentSession?.(id);
      };

  Add a boolean near `showRestartActions`:

      const showBranchAction = provider === 'claude' && canResumeOriginalSession;

  In the title action bar, after the start/new/resume button block and before `删除`, render:

      {showBranchAction ? (
        <ActionButton
          label="Fork"
          tone="default"
          disabled={actionDisabled}
          className="nodrag nopan compact"
          interactive
          onFocus={() => data.onSelectNode?.(id)}
          onClick={branchAgent}
          buttonProps={{
            title: '分叉当前 Claude Code 会话',
            'aria-label': '分叉当前 Claude Code 会话',
            'data-agent-branch-action': 'true'
          }}
        />
      ) : null}

  If `ActionButton` does not accept `tone="default"`, use the same neutral/no-tone style already used elsewhere in `main.tsx`; do not introduce new CSS unless the existing component requires it.

- [ ] **Step 5: Run targeted Webview tests**

  Run:

      npm run test:webview -- --grep "Agent Fork|agent restart actions"

  Expected result: PASS. The existing `agent restart actions render inline without a dropdown` assertion may now need to scope labels to `.action-button-group .action-button`, which it already does, so it should still expect `['新建', '重启']`.

- [ ] **Step 6: Commit Task 3**

  Run:

      git add src/webview/main.tsx tests/playwright/webview-harness.spec.mjs
      git commit -m "$(cat <<'EOF'
      feat(canvas): show Claude Agent Fork action

      Add the initial Claude Fork button for nodes with a trusted resumable session and route the intent to the host.

      Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
      EOF
      )"

### Task 4: Implement Host Fork behavior

**Files:**
- Modify: `src/panel/CanvasPanelManager.ts:140-146`, `src/panel/CanvasPanelManager.ts:2217-2270`, `src/panel/CanvasPanelManager.ts:8688-8723`, `src/panel/CanvasPanelManager.ts:10895-10927`, `src/panel/CanvasPanelManager.ts:12840-13008`
- Modify: `tests/vscode-smoke/extension-tests.cjs:708-928`, `tests/vscode-smoke/extension-tests.cjs:1277-1354`
- Test: `tests/vscode-smoke/extension-tests.cjs`

- [ ] **Step 1: Add failing smoke test helper**

  In `tests/vscode-smoke/extension-tests.cjs`, add a new verify function after `verifySidebarSessionHistoryRestore()`:

      async function verifyClaudeAgentBranchFromCurrentNode() {
        const baselineSnapshot = await getDebugSnapshot();
        const sourceTitle = 'Claude Fork Source';
        const sourceSessionId = 'claude-branch-source-session-123';

        try {
          await createNodeForTest('agent', undefined, {
            agentProvider: 'claude',
            agentLaunchPreset: 'custom',
            agentCustomLaunchCommand: `claude --resume ${sourceSessionId}`,
            titleOverride: sourceTitle
          });

          const withSourceSnapshot = await waitForSnapshot((currentSnapshot) => {
            return currentSnapshot.state.nodes.some(
              (node) => node.kind === 'agent' && node.title === sourceTitle
            );
          }, 10000);
          const sourceNode = withSourceSnapshot.state.nodes.find(
            (node) => node.kind === 'agent' && node.title === sourceTitle
          );
          assert.ok(sourceNode, 'Expected test-created Claude source node to exist.');

          await setPersistedState({
            ...withSourceSnapshot.state,
            nodes: withSourceSnapshot.state.nodes.map((node) => {
              if (node.id !== sourceNode.id || node.kind !== 'agent') {
                return node;
              }

              return {
                ...node,
                status: 'stopped',
                summary: '检测到可分叉的 Claude Code 会话。',
                metadata: {
                  ...node.metadata,
                  agent: {
                    ...node.metadata.agent,
                    lifecycle: 'stopped',
                    provider: 'claude',
                    resumeSupported: true,
                    resumeStrategy: 'claude-session-id',
                    resumeSessionId: sourceSessionId,
                    liveSession: false,
                    pendingLaunch: undefined
                  }
                }
              };
            })
          });

          const beforeBranchSnapshot = await getDebugSnapshot();
          await dispatchWebviewMessage({
            type: 'webview/branchAgentSession',
            payload: {
              nodeId: sourceNode.id
            }
          });

          const branchedSnapshot = await waitForSnapshot((currentSnapshot) => {
            return currentSnapshot.state.nodes.some(
              (node) =>
                node.kind === 'agent' &&
                node.id !== sourceNode.id &&
                node.title.includes('分叉') &&
                node.metadata?.agent?.provider === 'claude' &&
                node.metadata.agent.launchPreset === 'custom' &&
                typeof node.metadata.agent.customLaunchCommand === 'string' &&
                node.metadata.agent.customLaunchCommand.includes(`--resume ${sourceSessionId}`) &&
                node.metadata.agent.customLaunchCommand.includes('--fork-session')
            );
          }, 10000);

          assert.strictEqual(
            branchedSnapshot.state.nodes.length,
            beforeBranchSnapshot.state.nodes.length + 1,
            'Expected Fork to create exactly one additional Agent node.'
          );

          const originalAfterBranch = branchedSnapshot.state.nodes.find((node) => node.id === sourceNode.id);
          assert.strictEqual(
            originalAfterBranch.metadata.agent.resumeSessionId,
            sourceSessionId,
            'Expected Fork to leave the source node resume session id unchanged.'
          );

          const branchNode = branchedSnapshot.state.nodes.find(
            (node) =>
              node.kind === 'agent' &&
              node.id !== sourceNode.id &&
              node.metadata?.agent?.customLaunchCommand?.includes('--fork-session')
          );
          assert.ok(branchNode, 'Expected Fork to create a Claude Agent node with fork-session command.');
          assert.strictEqual(branchNode.metadata.agent.pendingLaunch, 'start');
        } finally {
          await setPersistedState(baselineSnapshot.state);
        }
      }

  Add this call in `runTrustedSmoke()` after `verifySidebarSessionHistoryRestore();`:

      await verifyClaudeAgentBranchFromCurrentNode();

- [ ] **Step 2: Add failing rejection smoke test**

  In the same file, add after `verifyClaudeAgentBranchFromCurrentNode()`:

      async function verifyAgentBranchRejectsUnsupportedSources() {
        const baselineSnapshot = await getDebugSnapshot();

        try {
          await createNodeForTest('agent', undefined, {
            agentProvider: 'codex',
            titleOverride: 'Codex 分叉 Rejection Source'
          });
          const codexSnapshot = await waitForSnapshot((currentSnapshot) => {
            return currentSnapshot.state.nodes.some(
              (node) => node.kind === 'agent' && node.title === 'Codex 分叉 Rejection Source'
            );
          }, 10000);
          const codexNode = codexSnapshot.state.nodes.find(
            (node) => node.kind === 'agent' && node.title === 'Codex 分叉 Rejection Source'
          );
          assert.ok(codexNode, 'Expected Codex rejection source node to exist.');

          await dispatchWebviewMessage({
            type: 'webview/branchAgentSession',
            payload: { nodeId: codexNode.id }
          });
          await sleep(200);

          const afterRejectedBranch = await getDebugSnapshot();
          assert.strictEqual(
            afterRejectedBranch.state.nodes.length,
            codexSnapshot.state.nodes.length,
            'Expected Codex Fork request to be rejected without creating a node.'
          );
        } finally {
          await setPersistedState(baselineSnapshot.state);
        }
      }

  Add this call in `runTrustedSmoke()` after `verifyClaudeAgentBranchFromCurrentNode();`:

      await verifyAgentBranchRejectsUnsupportedSources();

- [ ] **Step 3: Run smoke test and verify failure**

  Run:

      npm run test:smoke

  Expected result: FAIL because Host does not handle `webview/branchAgentSession`. If the whole smoke suite is slow, it is acceptable at this step to stop after confirming the new failure appears in logs.

- [ ] **Step 4: Import command builder**

  In `src/panel/CanvasPanelManager.ts`, extend the existing import from `../common/agentLaunchPresets` to include:

      buildClaudeBranchCommandLine,

- [ ] **Step 5: Add Host message handling**

  In the `handleWebviewMessage` switch, after `webview/startExecutionSession`, add:

      case 'webview/branchAgentSession':
        void this.branchAgentSession(parsedMessage.payload.nodeId);
        return;

- [ ] **Step 6: Add Host Fork method**

  Add this public/private method near `restoreAgentSessionFromHistory()`:

      private async branchAgentSession(nodeId: string): Promise<{ branched: boolean; errorMessage?: string }> {
        if (!this.assertExecutionAllowed('当前 workspace 未受信任，已禁止分叉 Agent 会话。')) {
          return {
            branched: false,
            errorMessage: '当前 workspace 未受信任，不能分叉 Agent 会话。'
          };
        }

        const sourceNode = this.state.nodes.find((candidate) => candidate.id === nodeId && candidate.kind === 'agent');
        if (!sourceNode) {
          const message = '未找到可分叉的 Agent 节点。';
          this.postMessage({ type: 'host/error', payload: { message } });
          return { branched: false, errorMessage: message };
        }

        const metadata = ensureAgentMetadata(sourceNode);
        if (metadata.provider !== 'claude' || metadata.resumeStrategy !== 'claude-session-id') {
          const message = '只有持有可信会话的 Claude Code Agent 才能分叉。';
          this.postMessage({ type: 'host/error', payload: { message } });
          return { branched: false, errorMessage: message };
        }

        const sessionId = metadata.resumeSessionId?.trim();
        if (!sessionId) {
          const message = '当前 Claude Code Agent 尚未确认可分叉的会话标识。';
          this.postMessage({ type: 'host/error', payload: { message } });
          return { branched: false, errorMessage: message };
        }

        let branchCommandLine: string;
        try {
          branchCommandLine = this.buildClaudeBranchCommandLine(sessionId);
        } catch (error) {
          const message = error instanceof Error ? error.message : '无法解析 Claude Code 分叉启动命令。';
          this.postMessage({ type: 'host/error', payload: { message } });
          return { branched: false, errorMessage: message };
        }

        const sourceSize = sourceNode.size ?? estimatedCanvasNodeFootprint('agent');
        const preferredPosition = {
          x: sourceNode.position.x + sourceSize.width + 48,
          y: sourceNode.position.y
        };
        const createdNode = this.applyCreateNode('agent', preferredPosition, {
          agentProvider: 'claude',
          agentLaunchPreset: 'custom',
          agentCustomLaunchCommand: branchCommandLine,
          titleOverride: `${sourceNode.title} 分叉`,
          cwdOverride: metadata.cwd
        });
        if (!createdNode) {
          return { branched: false };
        }

        try {
          await this.focusNodeInCanvas(createdNode.id);
        } catch {
          void vscode.window.showWarningMessage(`分叉节点已创建，但暂时无法自动定位到「${createdNode.title}」。`);
        }

        return { branched: true };
      }

  If TypeScript reports that `estimatedCanvasNodeFootprint` is already imported, use the existing import. If `cwdOverride: metadata.cwd` causes multi-root placement problems because the source node has a namespaced/root-local cwd, remove `cwdOverride` and rely on preferred position; record the decision in this ExecPlan.

- [ ] **Step 7: Add Host fork-session command builder wrapper**

  Near `buildHistoryResumeCommandLine()`, add:

      private buildClaudeBranchCommandLine(sessionId: string): string {
        return buildClaudeBranchCommandLine(
          sessionId,
          this.getAgentLaunchDefaults('claude')
        );
      }

- [ ] **Step 8: Run targeted validation**

  Run:

      npm run typecheck
      npm run test:agent-launch-presets
      npm run test:protocol-webview-messages

  Expected result: all PASS.

- [ ] **Step 9: Run smoke test**

  Run:

      npm run test:smoke

  Expected result: PASS. If this command cannot complete in the environment, capture the failure reason in `结果与复盘` and run the narrower available smoke command if one exists.

- [ ] **Step 10: Commit Task 4**

  Run:

      git add src/panel/CanvasPanelManager.ts tests/vscode-smoke/extension-tests.cjs
      git commit -m "$(cat <<'EOF'
      feat(canvas): branch Claude Agent sessions from current node

      Create a new Claude Agent node from the current node's trusted session id and launch it with fork-session semantics.

      Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
      EOF
      )"

### Task 5: Update docs, run full verification, and prepare PR state

**Files:**
- Modify: `docs/design-docs/agent-launch-modes-and-restart.md:319-352`
- Modify: `docs/exec-plans/active/claude-agent-branch.md`
- Test: package scripts listed below

- [ ] **Step 1: Update design validation status section**

  In `docs/design-docs/agent-launch-modes-and-restart.md`, append a new line in `## 9. 当前验证状态` after the 2026-06-06 design note:

      - 2026-06-06：已实现 Claude Code Agent `Fork`：Webview 只发送当前 node id，Host 重新校验 Claude provider 与可信 session id 后创建 custom Agent 节点，并用 `--resume <session-id> --fork-session` 启动；已补充命令层、协议、Webview 与 Host smoke 回归。

- [ ] **Step 2: Run full targeted test set**

  Run from repo root:

      npm run test:agent-launch-presets
      npm run test:protocol-webview-messages
      npm run test:webview -- --grep "Agent Fork|agent restart actions"
      npm run typecheck
      npm run build

  Expected result: all PASS.

- [ ] **Step 3: Run broader tests**

  Run:

      npm run test:webview
      npm run test:smoke

  Expected result: PASS. If `test:smoke` requires a sandbox-external VS Code host and cannot complete here, record the exact reason and output summary in this plan and in the final user response.

- [ ] **Step 4: Manual verification in Extension Development Host**

  Start the extension development host using the repository's normal VS Code debug configuration or ask the user to run it if this session cannot launch the UI. Verify:

      1. Create or use a Claude Code Agent node that has a confirmed `claude-session-id`.
      2. Confirm a `Fork` button appears in the Agent title bar.
      3. Click `Fork`.
      4. Confirm a new Agent node appears near the source node with a `Fork` title suffix.
      5. Confirm the new node launches Claude Code with a command equivalent to `claude --resume <source-session-id> --fork-session`.
      6. Confirm the source node remains present and unchanged.

  Record what was verified and any limitations in `结果与复盘`.

- [ ] **Step 5: Update this ExecPlan final sections**

  Update:

      - `进度`: mark all completed steps with date/time.
      - `意外与发现`: add any unexpected findings, including test failures or CLI version issues.
      - `决策记录`: add any implementation-time decisions not already recorded.
      - `结果与复盘`: summarize shipped behavior, tests run, manual verification status, and remaining risk.

- [ ] **Step 6: Commit Task 5**

  Run:

      git add docs/design-docs/agent-launch-modes-and-restart.md docs/exec-plans/active/claude-agent-branch.md
      git commit -m "$(cat <<'EOF'
      docs(canvas): record Claude Agent Fork verification

      Capture the implemented Fork behavior, verification commands, and remaining manual validation notes.

      Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
      EOF
      )"

## 验证与验收

Acceptance criteria:

1. `buildClaudeBranchCommandLine('session-123', { command: 'claude', defaultArgs: '--model opus --resume old' })` returns a command containing one explicit resume target, `--fork-session`, and no old resume target.
2. `parseWebviewMessage({ type: 'webview/branchAgentSession', payload: { nodeId: 'agent-1' } })` returns the parsed message; non-string node id returns null.
3. A resumable Claude Agent node renders `Fork`; a Codex node or non-resumable Claude node does not.
4. Clicking `Fork` posts only `{ nodeId }` to Host.
5. Host Fork from a trusted Claude node with `resumeStrategy: 'claude-session-id'` and a non-empty `resumeSessionId` creates exactly one new Claude Agent node with custom launch command containing `--resume <source id> --fork-session`.
6. Host rejects Fork for Codex, missing node, missing trusted Claude session id, or untrusted workspace without creating a node.
7. Source node is unchanged after Fork.
8. New node starts automatically through existing `pendingLaunch: 'start'` flow.

Required commands:

    npm run test:agent-launch-presets
    npm run test:protocol-webview-messages
    npm run test:webview -- --grep "Agent Fork|agent restart actions"
    npm run typecheck
    npm run build

Broader commands before PR:

    npm run test:webview
    npm run test:smoke

Manual verification is required for the real Claude CLI session-id behavior, because automated tests can prove the command includes `--fork-session` but cannot prove the installed Claude Code creates a new provider session id without running a real interactive CLI.

## 幂等性与恢复

All source changes are local git changes on branch `feature/claude-agent-branch`. If a task fails, inspect `git diff` for that task and fix forward; do not use destructive git commands. Test-created state in smoke tests must restore `baselineSnapshot.state` in `finally` blocks. If `npm run test:smoke` leaves VS Code processes running, use the repository's smoke runner cleanup output first; only kill processes after confirming they belong to the test run.

`applyCreateNode()` validates workspace trust and command validity. Fork Host code must keep these existing checks rather than bypassing them. Do not add a feature flag or fallback ordinary resume path; if `--fork-session` is unsupported by a user's Claude CLI, the launch should fail through the existing spawn/runtime error path until a later version-gated UX is designed.

## 证据与备注

Design/spec commit already exists:

    b3ef9cf docs(canvas): define Claude Code Agent Branch semantics

Relevant existing code anchors:

    src/common/agentLaunchPresets.ts:50 buildAgentHistoryResumeCommandLine
    src/common/agentLaunchPresets.ts:634 stripClaudeResumeTargetArgs
    src/common/protocol.ts:706 webview/startExecutionSession message shape
    src/common/protocol.ts:1413 parse startExecutionSession
    src/webview/main.tsx:4134 startAgent helper
    src/webview/main.tsx:4216 Agent node title actions
    src/panel/CanvasPanelManager.ts:2217 restoreAgentSessionFromHistory
    src/panel/CanvasPanelManager.ts:8699 webview/startExecutionSession switch case
    src/panel/CanvasPanelManager.ts:12966 applyCreateNode pendingLaunch setup
    src/panel/CanvasPanelManager.ts:19851 canResumeAgentFromMetadata

## 接口与依赖

Add this public function in `src/common/agentLaunchPresets.ts`:

    export function buildClaudeBranchCommandLine(
      sessionId: string,
      defaults: AgentProviderLaunchDefaults
    ): string

Add this Webview message in `src/common/protocol.ts`:

    {
      type: 'webview/branchAgentSession';
      payload: {
        nodeId: string;
      };
    }

Add this Webview callback to `CanvasNodeData` and `buildCanvasNodeData` in `src/webview/main.tsx`:

    onBranchAgentSession?: (nodeId: string) => void;

Add this Host method in `src/panel/CanvasPanelManager.ts`:

    private async branchAgentSession(nodeId: string): Promise<{ branched: boolean; errorMessage?: string }>

No new npm dependencies are required. No settings schema changes are required. No package manifest command is required for the first version, because the entry point is the node title bar button rather than a command palette action.
