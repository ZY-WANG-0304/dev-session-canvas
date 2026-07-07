# Dev Session Canvas

<!-- dev-session-canvas-marketplace-readme -->

English (default) | [简体中文](README.marketplace.zh-CN.md)

Dev Session Canvas is a multi-agent AI workbench inside VS Code, and the canvas is its primary interaction surface. It lets you place `Agent`, `Terminal`, and `Note` nodes in the same view so you can manage multiple development execution sessions without bouncing between chat panels, terminal tabs, and editors. The extension is currently in public `Preview`.

![Dev Session Canvas Overview](images/marketplace/canvas-overview.png)

<video src="images/marketplace/canvas-overview.mp4" controls muted loop playsinline></video>

## 0.23.0 Highlights

The public `0.23.0` release is a Preview milestone for Dev Session Canvas Notifier localization and release-smoke stability. It keeps the `0.22.0` main-canvas localization, Template Marketplace Preview, notifier auto-install relationship, GitHub Release assets plus verified Open VSX completion gate, and Visual Studio Marketplace deferred stance.

- The notifier companion now uses English-default manifest, command, view, setting, sidebar, workbench prompt, manual test-notification, action-label, and callback text, with Simplified Chinese localization included through VS Code locale resources
- Notifier sidebar sections now localize `Overview`, `Notes`, platform guidance, and Agent configuration copy while leaving backend names, paths, configuration snippets, diagnostic facts, and user environment data unchanged
- The notifier Marketplace package now includes `package.nls.json`, `package.nls.zh-cn.json`, `l10n/bundle.l10n.zh-cn.json`, and the repository-only Simplified Chinese listing counterpart
- A real VS Code notifier locale smoke launches English and Simplified Chinese Extension Development Hosts and checks notifier manifest text, opened sidebar HTML, manual test notifications, workbench prompts, action labels, and callback prompts
- Notifier companion smoke now loads the main extension and notifier as two real development extensions, keeping each extension's own `ExtensionContext`, manifest, `package.nls*`, and `l10n` resources intact
- Linux VS Code smoke runs with additional headless stability flags, and terminal viewport restore assertions now compare marker lines instead of incidental terminal padding
- The extension ID, VS Code minimum version, notification protocol, backend selection, click callback semantics, notifier auto-install relationship, Open VSX gate, Visual Studio Marketplace deferred stance, Template Marketplace service version line, and Preview support matrix stay unchanged

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
- First-time installs and upgrades from `0.22.0` to `0.23.0` should use the public extension registry configured by the current host. Open VSX should publish and verify the same version for compatible hosts and remains the current marketplace completion gate; the official VS Code `Visual Studio Marketplace` path is announced only after the release-day visibility check confirms both the main extension and notifier are public. If VSM remains deferred for this release, GitHub Release assets are the manual-install fallback
- UI language follows the VS Code locale. This release does not add an extension-specific language setting and does not translate user-owned content, terminal output, provider output, or marketplace template data
- The production Template Marketplace may start with an empty catalog. Production does not expose code-only seed templates; real templates must be published through the marketplace or a controlled operations flow
- Pane Gallery only changes multi-root presentation. Single-root workspaces keep the normal canvas, and `rootGroups` remains the default multi-root mode and conservative fallback
- Layout arrangement is an explicit one-shot action. It does not offer undo, run continuously, or move nodes across ordinary groups or workspace roots
- If you previously set `devSessionCanvas.notifications.attentionSignalBridge`, `devSessionCanvas.notifications.enabledAttentionSignals`, `devSessionCanvas.notifications.strongTerminalAttentionReminder`, `devSessionCanvas.notifications.agentAbnormalOutputTextNotifications`, `devSessionCanvas.canvas.linkOpenMode`, `devSessionCanvas.canvas.workspaceRootWatermarks.enabled`, or `devSessionCanvas.canvas.multiRootPresentationMode`, upgrading to `0.23.0` preserves that explicit choice
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
- Prefer waiting for a later `0.23.x` fix release rather than trying to downgrade manually
- If you must roll back, reinstall the target version and verify workspace state again. Compatibility between Preview versions is not guaranteed
- For support boundaries, issue reporting, and security guidance, use the links below

## Support And Feedback

- Preview support boundaries: <https://github.com/ZY-WANG-0304/dev-session-canvas/blob/main/docs/support.md>
- Bugs and feature feedback: <https://github.com/ZY-WANG-0304/dev-session-canvas/issues>
- Security issues: `wzy0304@outlook.com`
## Open Source

- License: `Apache-2.0`
- Repository: <https://github.com/ZY-WANG-0304/dev-session-canvas>
