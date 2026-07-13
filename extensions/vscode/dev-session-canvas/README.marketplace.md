# Dev Session Canvas

<!-- dev-session-canvas-marketplace-readme -->

English (default) | [简体中文](README.marketplace.zh-CN.md)

Dev Session Canvas is a multi-agent AI workbench inside VS Code, and the canvas is its primary interaction surface. It lets you place `Agent`, `Terminal`, and `Note` nodes in the same view so you can manage multiple development execution sessions without bouncing between chat panels, terminal tabs, and editors. The extension is currently in public `Preview`.

![Dev Session Canvas Overview](images/marketplace/canvas-overview.png)

<video src="images/marketplace/canvas-overview.mp4" controls muted loop playsinline></video>

## 0.24.1 Highlights

The public `0.24.1` release is an urgent Preview hotfix for Runtime Supervisor upgrades. It fixes `0.24.0` behavior that made sessions owned by an older Supervisor read-only and delayed new sessions until that process drained. It keeps the `0.24.0` lossless I/O protocol, Agent `Resume`, scoped multi-root clearing, localization, Template Marketplace Preview, notifier relationship, GitHub Release assets plus verified Open VSX completion gate, and Visual Studio Marketplace deferred stance.

- Supervisor generations now use isolated storage namespaces, registries, Unix sockets / Windows named pipes, and systemd user units, so an older runtime can drain without blocking the current runtime
- Sessions keep their persisted `runtimeStoragePath` and continue through the Supervisor that owns their real PTY; new Agent and Terminal sessions start immediately in the current `terminal-stream-v1` generation
- Older sessions remain interactive: output, input, resize, stop, and delete continue to work, and persisted legacy read-only projections are normalized automatically
- PTY ownership is never migrated between generations. An older runtime's raw output tail is not promoted into a current lossless checkpoint or journal, so the recovery authority stays explicit
- Older clients are released after their last session finishes and pending RPC work settles; completed and history nodes clear migration-only projection state instead of keeping stale compatibility UI
- The migration notice no longer blocks the terminal. If an older terminal looks visually stale, resizing the node triggers a real terminal resize and redraw while new nodes continue on the current runtime
- The extension ID, VS Code minimum version, notification behavior, notifier auto-install relationship, Open VSX gate, Visual Studio Marketplace deferred stance, Template Marketplace service version line, and Preview support matrix stay unchanged

## Core Capabilities

- Open the main canvas in either the panel or the editor area
- Create `Agent`, `Terminal`, and `Note` nodes
- Drive `Agent` nodes through the `codex` or `claude` CLI
- Run `Terminal` nodes through the embedded terminal surface
- Let `Agent` and embedded `Terminal` nodes inherit a controlled shell environment, with diagnostics showing the current resolution path
- Paste supported screenshots directly into live `Agent` nodes as temporary image-file references while preserving manual prompt submission
- Create cwd-scoped `Terminal` or `Agent` nodes from workspace folders and files through File Explorer context menus
- Write contextual notes with Markdown syntax inside `Note` nodes
- Associate `Note` nodes with `.md` / `.markdown` files in the workspace, including YAML metadata popovers and safe Markdown image previews
- Use built-in and custom templates to restore reusable `Agent` / `Terminal` / `Note` work surfaces, including explicit save modes for associated Markdown Notes
- Organize related `Agent`, `Terminal`, and `Note` nodes with named canvas groups, nested group frames, group resize, and grouped sidebar browsing
- Fork a Codex or Claude Code Agent with a trusted session id into a new Agent node using provider-native fork semantics
- Compose VS Code multi-root workspaces into one canvas with system workspace-root sections while preserving each root's own canvas state
- Switch multi-root workspaces into an optional Pane Gallery with dynamic / grid overviews and top / side thumbnail modes
- Use fit view and the MiniMap across the full canvas space, including nodes, user groups, and workspace-root sections
- Arrange the canvas layout once from the context menu while preserving group and workspace-root boundaries
- Clear the current ordinary group, workspace root, or entire workspace from the canvas context menu with explicit scope-aware confirmation
- Keep canvas browsing available in `Restricted Mode` while automatically disabling execution entry points
- Provide stronger persistence guarantees through `runtimePersistence.enabled` when `systemd --user` is available on Linux local or `Remote SSH`, and otherwise fall back automatically to `best-effort`
- View sidebar `Nodes` and `Session History` lists to jump to current canvas nodes and restore or fork a new `Agent` node from history
- Manage workspace folders and git worktrees from the sidebar `Nodes` view, including adding existing worktrees and explicit confirmations before removing folders or linked worktrees
- Browse the Template Marketplace, install complete template packages into user or workspace template libraries, and update or roll back installed marketplace templates
- Publish saved local templates or new marketplace template versions when GitHub authentication and the marketplace service are available
- Use English-default UI copy or Simplified Chinese UI copy according to the VS Code locale, without translating user-owned content

## Best Fit

- Trusted workspaces on a standard filesystem
- Environments where `codex` or `claude` CLI is already installed
- Developers who want to observe multiple development sessions without switching constantly between terminal tabs
- Users who want a canvas-shaped AI workbench rather than a single chat panel
- Users who are comfortable trying a Preview marketplace whose production catalog may initially be empty until real templates are published

## Support Scope And Limits

- The `Remote SSH` main path is validated and usable, and it remains the best-validated recommended environment
- Linux and macOS local workspaces now have functional validation for the `Preview` main path
- Windows local workspaces now have functional validation for the `Preview` main path, with one explicit known limitation: when using `Codex`, embedded session history still cannot page upward
- Real older-binary upgrade smoke currently covers Linux / Unix sockets. Windows named-pipe and systemd generation isolation have path-level coverage, not a complete cross-platform real-upgrade matrix
- A strict 90,000-line completed-terminal stress case has intermittently stopped short at the final tail even though other full runs pass; final-tail completeness for one extreme output burst remains under validation
- The sidebar `Session History` list only shows records that can be explicitly attributed to the current workspace; older sessions without working-directory metadata are skipped conservatively
- `Restricted Mode` allows the canvas to open, but disables execution entry points such as `Agent` and `Terminal`
- `Virtual Workspace` is not supported yet
- Template Marketplace browsing and installation require network access to the configured marketplace origin; publishing, likes, reports, and admin actions require GitHub authentication and remain Preview workflows
- The extension is still in `Preview`, with no stable-release commitment

## Environment Requirements

- VS Code `1.80.0` or later
- A standard filesystem workspace
- `Agent` nodes require `codex` or `claude` CLI to be reachable from the Extension Host
- `Terminal` nodes require a shell available on the workspace side

## Installation And Upgrades

- The extension ID is `devsessioncanvas.dev-session-canvas`
- First-time installs and upgrades from `0.24.0` to `0.24.1` should use the public extension registry configured by the current host. Open VSX should publish and verify the same version for compatible hosts and remains the current marketplace completion gate; the official VS Code `Visual Studio Marketplace` path is announced only after the release-day visibility check confirms both the main extension and notifier are public. If VSM remains deferred for this release, GitHub Release assets are the manual-install fallback
- UI language follows the VS Code locale. This release does not add an extension-specific language setting and does not translate user-owned content, terminal output, provider output, or marketplace template data
- If an older Runtime Supervisor still owns running sessions during upgrade, those sessions continue through their original runtime with output, input, resize, stop, and delete available. New sessions can start immediately on the current generation; older sessions do not migrate PTY ownership and may need a node resize to redraw stale terminal pixels
- Supervisor-backed cross-Host recovery still depends on `runtimePersistence.enabled` and backend availability. Local PTYs do not gain a cross-Host lifetime guarantee, and Preview releases do not promise rollback compatibility for runtime journals
- The production Template Marketplace may start with an empty catalog. Production does not expose code-only seed templates; real templates must be published through the marketplace or a controlled operations flow
- Pane Gallery only changes multi-root presentation. Single-root workspaces keep the normal canvas, and `rootGroups` remains the default multi-root mode and conservative fallback
- Layout arrangement is an explicit one-shot action. It does not offer undo, run continuously, or move nodes across ordinary groups or workspace roots
- If you previously set `devSessionCanvas.runtimePersistence.enabled`, `devSessionCanvas.notifications.attentionSignalBridge`, `devSessionCanvas.notifications.enabledAttentionSignals`, `devSessionCanvas.notifications.strongTerminalAttentionReminder`, `devSessionCanvas.notifications.agentAbnormalOutputTextNotifications`, `devSessionCanvas.canvas.linkOpenMode`, `devSessionCanvas.canvas.workspaceRootWatermarks.enabled`, or `devSessionCanvas.canvas.multiRootPresentationMode`, upgrading to `0.24.1` preserves that explicit choice
- Image paste files are temporary extension-storage attachments, not workspace files. They are retained long enough for Agent context reuse and then cleaned by the background TTL maintenance task
- If your `0.2.0` workspace kept an older view-layout cache, the sidebar `Overview` and `Common Actions` views may appear as two separate icons for a while. That does not mean two extensions are installed. Move both views back into the same `Dev Session Canvas` container, or run `View: Reset View Locations`
- During Preview, cross-version workspace-state compatibility is not guaranteed. If a workspace contains important canvas state, back it up or validate in a non-critical environment before upgrading


## Desktop Notification Companion (Auto-Installed)

- Installing `Dev Session Canvas` automatically installs `Dev Session Canvas Notifier` (`devsessioncanvas.dev-session-canvas-notifier`)
- If a user installs from the notifier page first, VS Code also auto-installs the main extension `Dev Session Canvas`
- Execution-node attention signals now prefer the local desktop by default through `devSessionCanvas.notifications.attentionSignalBridge = system`; switch the setting if you want `workbench` or `none`, or narrow attention sources with `devSessionCanvas.notifications.enabledAttentionSignals`
- In `system` mode, the main extension prefers the local UI-side companion and falls back to VS Code workbench notifications when the companion is missing, unsupported, or delivery fails
- The companion is especially useful in `Remote SSH`, WSL, and Dev Container scenarios where the main extension runs on the workspace side but the notification needs to return to the local desktop


## Usage Tips

### Unable to Create Terminal and Agent Nodes on Windows

**Symptom**: The workspace is trusted, but creating a node still shows only `Note`; `Terminal` and `Agent` node types are unexpectedly missing.

**Troubleshooting**: If this still happens in a trusted workspace, check the Windows PowerShell execution policy first. In some environments, the execution policy may interfere with Node.js-related commands.

**Suggested Fix**:

1. Open PowerShell as Administrator
2. Run the following command to set execution policy to `RemoteSigned`:
   ```powershell
   Set-ExecutionPolicy RemoteSigned
   ```
3. Type `Y` to confirm the change
4. Close and reopen VS Code
5. Try creating a `Terminal` or `Agent` node again to confirm whether the issue is resolved

## Rollback Guidance

- If the current version blocks your workflow, disable or uninstall the extension first
- Prefer waiting for a later `0.24.x` fix release rather than trying to downgrade manually; stop important sessions before changing versions because Supervisor journals do not promise cross-version rollback compatibility
- If you must roll back, reinstall the target version and verify workspace state again. Compatibility between Preview versions is not guaranteed
- For support boundaries, issue reporting, and security guidance, use the links below

## Support And Feedback

- Preview support boundaries: <https://github.com/ZY-WANG-0304/dev-session-canvas/blob/main/docs/support.md>
- Bugs and feature feedback: <https://github.com/ZY-WANG-0304/dev-session-canvas/issues>
- Security issues: `wzy0304@outlook.com`
## Open Source

- License: `Apache-2.0`
- Repository: <https://github.com/ZY-WANG-0304/dev-session-canvas>
