# Fork Agent Auto Edge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a Claude Agent Fork action creates a forked Agent node, automatically create a normal editable edge from the source Agent to the new Agent.

**Architecture:** Keep the behavior in the host authority path, inside `CanvasPanelManager.branchAgentSession()`, because that is where the source node, created node, persistence, and auto-start lifecycle are already coordinated. Reuse the existing `CanvasEdgeSummary` model with `owner: 'user'`, `arrowMode: 'forward'`, and `resolveHorizontalCanvasEdgeAnchors()` so the connection behaves like a manually-created edge rather than introducing branch-lineage semantics.

**Tech Stack:** TypeScript VS Code extension host, existing Canvas prototype state model, VS Code smoke tests in `tests/vscode-smoke/extension-tests.cjs`, existing `npm run build` and smoke runner commands.

---

## File Structure

- Modify `src/panel/CanvasPanelManager.ts`
  - Responsibility: host-authoritative Fork action and state mutation.
  - Add a small helper that creates one ordinary user edge between two known nodes.
  - Call that helper immediately after `applyCreateNode('agent', ...)` succeeds in `branchAgentSession()`.
- Modify `tests/vscode-smoke/extension-tests.cjs`
  - Responsibility: smoke-level host state regression for Fork behavior.
  - Extend `verifyClaudeAgentBranchFromCurrentNode()` to assert a new source-to-fork user edge appears with expected anchors and arrow mode.
- Confirm `docs/design-docs/agent-launch-modes-and-restart.md`
  - Responsibility: official design decision record.
  - It should already state that Fork creates a normal editable `user` edge and does not create machine-readable lineage. If missing, update it.

Do not create a new edge owner/type. Do not add branch tree UI. Do not change webview drag-to-connect behavior.

---

### Task 1: Add failing Fork edge smoke assertion

**Files:**
- Modify: `tests/vscode-smoke/extension-tests.cjs:1411-1447`
- Test: `tests/vscode-smoke/extension-tests.cjs`

- [ ] **Step 1: Keep the first Fork wait scoped to node creation**

In `verifyClaudeAgentBranchFromCurrentNode()`, keep the first `waitForSnapshot()` condition scoped to exactly one matching Fork node:

```js
    const branchedSnapshot = await waitForSnapshot((currentSnapshot) => {
      const branchNodes = currentSnapshot.state.nodes.filter(
        (node) =>
          node.kind === 'agent' &&
          node.id !== sourceNode.id &&
          node.title.includes('Fork') &&
          node.metadata?.agent?.provider === 'claude' &&
          node.metadata.agent.launchPreset === 'custom' &&
          typeof node.metadata.agent.customLaunchCommand === 'string' &&
          node.metadata.agent.customLaunchCommand.includes(`--resume ${sourceSessionId}`) &&
          node.metadata.agent.customLaunchCommand.includes('--fork-session')
      );
      return branchNodes.length === 1;
    }, 10000);
```

This ensures `branchNodeId` can be assigned as soon as the Fork node exists, so cleanup can stop the auto-started Forked Agent even while the new RED edge assertion still fails.

- [ ] **Step 2: Wait separately for the Fork edge after `branchNodeId` is assigned**

Immediately after:

```js
    branchNodeId = branchNode.id;
```

add a second edge-specific wait and use its snapshot for assertions:

```js
    const branchEdgeSnapshot = await waitForSnapshot((currentSnapshot) => {
      return currentSnapshot.state.edges.some(
        (edge) =>
          edge.owner === 'user' &&
          edge.sourceNodeId === sourceNode.id &&
          edge.targetNodeId === branchNode.id &&
          edge.arrowMode === 'forward'
      );
    }, 10000);

    const branchEdge = branchEdgeSnapshot.state.edges.find(
      (edge) =>
        edge.owner === 'user' &&
        edge.sourceNodeId === sourceNode.id &&
        edge.targetNodeId === branchNode.id
    );
    assert.ok(branchEdge, 'Expected Fork to create a user edge from source Agent to Forked Agent.');
    assert.strictEqual(branchEdge.arrowMode, 'forward');
    assert.strictEqual(branchEdge.sourceAnchor, 'right');
    assert.strictEqual(branchEdge.targetAnchor, 'left');
    assert.strictEqual(branchEdge.label, undefined);
```

The expected anchors are `right` → `left` because the Fork node is placed at `sourceNode.position.x + sourceSize.width + 48`, so it should be to the right of the source node and match `resolveHorizontalCanvasEdgeAnchors()`.

- [ ] **Step 3: Run the targeted smoke scenario and verify RED**

Run:

```bash
DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=trusted npm run test:smoke
```

Expected: FAIL in or before `verifyClaudeAgentBranchFromCurrentNode()` because the Fork node is created but no source-to-fork `owner: 'user'` edge exists yet.

If the full trusted smoke is currently blocked by an unrelated later scenario, the RED is still valid when the output shows the new Fork edge assertion fails before moving past this function. Do not change implementation until the new assertion has failed for the expected reason.

---

### Task 2: Implement ordinary user edge creation in the Fork host path

**Files:**
- Modify: `src/panel/CanvasPanelManager.ts:2283-2343`
- Modify: `src/panel/CanvasPanelManager.ts:17243-17280` vicinity, or another helper section near existing edge helpers

- [ ] **Step 1: Add a helper for Fork source-to-target user edges**

Near `createUserCanvasEdge()` in `src/panel/CanvasPanelManager.ts`, add this helper:

```ts
function createBranchAgentUserEdge(
  previousState: CanvasPrototypeState,
  sourceNode: Pick<CanvasNodeSummary, 'id' | 'position' | 'size'>,
  targetNode: Pick<CanvasNodeSummary, 'id' | 'position' | 'size'>
): CanvasPrototypeState {
  const anchors = resolveHorizontalCanvasEdgeAnchors(sourceNode, targetNode);
  return createUserCanvasEdge(previousState, {
    id: `edge-${randomUUID()}`,
    sourceNodeId: sourceNode.id,
    targetNodeId: targetNode.id,
    sourceAnchor: anchors.sourceAnchor,
    targetAnchor: anchors.targetAnchor,
    arrowMode: 'forward',
    owner: 'user'
  });
}
```

This helper intentionally returns a state and does not throw. `createUserCanvasEdge()` already refuses duplicate IDs and invalid endpoints, including multi-root boundary violations.

- [ ] **Step 2: Call the helper immediately after Fork node creation succeeds**

In `branchAgentSession()`, immediately after:

```ts
    if (!createdNode) {
      return { branched: false };
    }
```

add:

```ts
    this.state = createBranchAgentUserEdge(this.state, sourceNode, createdNode);
    this.persistState();
    this.postState('host/stateUpdated');
```

Do not move the call before the `createdNode` check. Do not block focus or auto-start if the edge helper returns the same state.

- [ ] **Step 3: Keep focus behavior unchanged**

The next block should remain:

```ts
    try {
      await this.focusNodeInCanvas(createdNode.id);
    } catch {
      void vscode.window.showWarningMessage(`Fork 节点已创建，但暂时无法自动定位到「${createdNode.title}」。`);
    }

    return { branched: true };
```

This preserves the existing user-facing Fork result even if focus fails.

- [ ] **Step 4: Run the Fork smoke assertion and verify GREEN**

Run:

```bash
DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=trusted npm run test:smoke
```

Expected: the Fork section now passes its edge assertions. If a later unrelated smoke section fails, capture the output and confirm the run moved past `verifyClaudeAgentBranchFromCurrentNode()`.

---

### Task 3: Confirm design documentation matches implementation

**Files:**
- Modify if needed: `docs/design-docs/agent-launch-modes-and-restart.md:55-130`

- [ ] **Step 1: Check the non-goal still excludes formal lineage but allows ordinary edges**

Confirm this bullet exists in `## 4. 非目标`:

```md
- 不在本轮维护正式分支树、机器可读 branch lineage 或跨节点合并语义；Fork 后自动生成的连接边只作为普通可编辑画布边。
```

If it does not exist, replace the old non-goal about not maintaining branch lineage with the exact text above.

- [ ] **Step 2: Check the Fork solution describes the auto edge**

Confirm this bullet exists in `### 5.5 用 Claude Code 原生 --fork-session 创建 Fork 新节点`:

```md
- 宿主在 Fork 新节点创建成功后，自动从原 Agent 节点创建一条指向新 Agent 节点的普通 `user` 边，锚点复用现有水平连边规则，箭头方向为原节点到新节点；这条边只是可编辑/可删除的视觉连接，不作为机器可读 branch lineage。
```

If it does not exist, add it after the bullet about the new node title.

- [ ] **Step 3: Run a doc consistency grep**

Run:

```bash
rg -n '普通可编辑画布边|普通 `user` 边|branch lineage|正式分支树' docs/design-docs/agent-launch-modes-and-restart.md
```

Expected: output includes the non-goal and solution bullets, with no remaining sentence that says Fork creates no edge at all.

---

### Task 4: Final verification and handoff

**Files:**
- Verify: `src/panel/CanvasPanelManager.ts`
- Verify: `tests/vscode-smoke/extension-tests.cjs`
- Verify: `docs/design-docs/agent-launch-modes-and-restart.md`

- [ ] **Step 1: Run TypeScript build/typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS with `tsc --noEmit` exit code 0.

- [ ] **Step 2: Run the relevant smoke validation**

Run:

```bash
DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER=trusted npm run test:smoke
```

Expected: PASS, or if this branch already has a known later smoke blocker, the output must show Fork auto-edge assertions passed before the unrelated blocker.

- [ ] **Step 3: Review focused diff**

Run:

```bash
git diff -- src/panel/CanvasPanelManager.ts tests/vscode-smoke/extension-tests.cjs docs/design-docs/agent-launch-modes-and-restart.md docs/superpowers/plans/2026-06-08-branch-agent-auto-edge.md
```

Expected: diff only contains the Fork auto-edge implementation, its smoke assertion, the approved design text, and this plan.

- [ ] **Step 4: Do not commit unless explicitly requested**

Because this working session follows the Claude Code safety rule that commits require explicit user approval, stop after verification and report:

```text
Implemented Fork auto-edge as a normal editable user edge from source Agent to forked Agent. Verification: <commands and observed results>. Not committed.
```

If the user explicitly asks for a commit later, stage only these files:

```bash
git add src/panel/CanvasPanelManager.ts tests/vscode-smoke/extension-tests.cjs docs/design-docs/agent-launch-modes-and-restart.md docs/superpowers/plans/2026-06-08-branch-agent-auto-edge.md
```

Use a concise message such as:

```text
feat(canvas): link branched Agent nodes
```
