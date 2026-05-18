# Dev Session Canvas

<!-- dev-session-canvas-marketplace-readme -->

English (default) | [简体中文](README.marketplace.zh-CN.md)

Dev Session Canvas is a multi-agent AI workbench inside VS Code, and the canvas is its primary interaction surface. It lets you place `Agent`, `Terminal`, and `Note` nodes in the same view so you can manage multiple development execution sessions without bouncing between chat panels, terminal tabs, and editors. The extension is currently in public `Preview`.

![Dev Session Canvas Overview](images/marketplace/canvas-overview.png)

<video src="images/marketplace/canvas-overview.mp4" controls muted loop playsinline></video>

## Core Capabilities

- Open the main canvas in either the panel or the editor area
- Create `Agent`, `Terminal`, and `Note` nodes
- Drive `Agent` nodes through the `codex` or `claude` CLI
- Run `Terminal` nodes through the embedded terminal surface
- Let `Agent` and embedded `Terminal` nodes inherit a controlled shell environment, with diagnostics showing the current resolution path
- Write contextual notes with Markdown syntax inside `Note` nodes
- Associate `Note` nodes with `.md` / `.markdown` files in the workspace, including YAML metadata popovers and safe Markdown image previews
- Use built-in and custom templates to restore reusable `Agent` / `Terminal` / `Note` work surfaces, including explicit save modes for associated Markdown Notes
- Keep canvas browsing available in `Restricted Mode` while automatically disabling execution entry points
- Provide stronger persistence guarantees through `runtimePersistence.enabled` when `systemd --user` is available on Linux local or `Remote SSH`, and otherwise fall back automatically to `best-effort`
- View sidebar `Nodes` and `Session History` lists to jump to current canvas nodes and restore a new `Agent` node from history

## Best Fit

- Trusted workspaces on a standard filesystem
- Environments where `codex` or `claude` CLI is already installed
- Developers who want to observe multiple development sessions without switching constantly between terminal tabs
- Users who want a canvas-shaped AI workbench rather than a single chat panel

## Support Scope And Limits

- The `Remote SSH` main path is validated and usable, and it remains the best-validated recommended environment
- Linux and macOS local workspaces now have functional validation for the `Preview` main path
- Windows local workspaces now have functional validation for the `Preview` main path, with one explicit known limitation: when using `Codex`, embedded session history still cannot page upward
- The sidebar `Session History` list only shows records that can be explicitly attributed to the current workspace; older sessions without working-directory metadata are skipped conservatively
- `Restricted Mode` allows the canvas to open, but disables execution entry points such as `Agent` and `Terminal`
- `Virtual Workspace` is not supported yet
- The extension is still in `Preview`, with no stable-release commitment

## Environment Requirements

- VS Code `1.80.0` or later
- A standard filesystem workspace
- `Agent` nodes require `codex` or `claude` CLI to be reachable from the Extension Host
- `Terminal` nodes require a shell available on the workspace side

## 0.10.1 Highlights

The public `0.10.1` release keeps the `0.10.x` Note-to-Markdown milestone focused on polish, safer host boundaries, and release readiness. It tightens associated Markdown Notes across templates, Remote SSH drag-and-drop, metadata preview, image rendering, stopped-Agent restart actions, and Marketplace publishing copy.

- Associated Markdown Notes in templates now use explicit save modes: content snapshot, workspace-relative path only, or workspace-relative path plus file content
- Applying templates handles missing associated files and path-plus-content conflicts inside the Note node instead of silently overwriting workspace files
- Markdown reading mode hides valid YAML front matter, exposes a compact metadata popover, and keeps invalid metadata visible with a warning
- Markdown image preview now supports safe `https:`, `data:image/*;base64`, and workspace / associated-file relative images through Webview-safe URLs
- Remote Markdown drag-and-drop now verifies the current host authority before file operations, canonicalizes same-host resources, and rejects foreign or unknown hosts fail-closed
- Stopped Agent nodes now show separate `New` and `Restart` actions when the node has a trusted resume context, making fresh starts and same-session resumes explicit
- UI and release hardening aligns panel activation, status colors, sidebar list colors, notifier sidebar styling, script layout, publish failure handling, and the Marketplace README now defaults to English

## Installation And Upgrades

- The extension ID is `devsessioncanvas.dev-session-canvas`
- First-time installs and upgrades from `0.10.0` to `0.10.1` should use the public extension registry configured by the current host: official VS Code uses the `Visual Studio Marketplace`, while Open VSX-compatible hosts use `Open VSX`; later `0.10.x` updates follow the corresponding registry upgrade path
- If you previously set `devSessionCanvas.notifications.attentionSignalBridge`, upgrading to `0.10.1` preserves that explicit choice. The default installation path still prefers the `system` bridge and falls back to workbench notifications when needed
- If your `0.2.0` workspace kept an older view-layout cache, the sidebar `Overview` and `Common Actions` views may appear as two separate icons for a while. That does not mean two extensions are installed. Move both views back into the same `Dev Session Canvas` container, or run `View: Reset View Locations`
- During Preview, cross-version workspace-state compatibility is not guaranteed. If a workspace contains important canvas state, back it up or validate in a non-critical environment before upgrading


## Desktop Notification Companion (Auto-Installed)

- Installing `Dev Session Canvas` automatically installs `Dev Session Canvas Notifier` (`devsessioncanvas.dev-session-canvas-notifier`)
- If a user installs from the notifier page first, VS Code also auto-installs the main extension `Dev Session Canvas`
- Execution-node attention signals now prefer the local desktop by default through `devSessionCanvas.notifications.attentionSignalBridge = system`; switch the setting if you want `workbench` or `none` instead
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
- Prefer waiting for a later `0.10.x` fix release rather than trying to downgrade manually
- If you must roll back, reinstall the target version and verify workspace state again. Compatibility between Preview versions is not guaranteed
- For support boundaries, issue reporting, and security guidance, use the links below

## Support And Feedback

- Preview support boundaries: <https://github.com/ZY-WANG-0304/dev-session-canvas/blob/main/docs/support.md>
- Bugs and feature feedback: <https://github.com/ZY-WANG-0304/dev-session-canvas/issues>
- Security issues: `wzy0304@outlook.com`

## Open Source

- License: `Apache-2.0`
- Repository: <https://github.com/ZY-WANG-0304/dev-session-canvas>
