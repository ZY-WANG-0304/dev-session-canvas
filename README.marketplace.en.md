# Dev Session Canvas

<!-- dev-session-canvas-marketplace-readme -->

[Chinese (default)](README.marketplace.md) | English

Dev Session Canvas is a multi-agent AI workbench inside VS Code, and the canvas is its primary interaction surface. It lets you place `Agent`, `Terminal`, and `Note` nodes in the same view so you can manage multiple development execution sessions without bouncing between chat panels, terminal tabs, and editors. The extension is currently in public `Preview`.

![Dev Session Canvas Overview](images/marketplace/canvas-overview.png)

<video src="images/marketplace/canvas-overview.mp4" controls muted loop playsinline></video>

## Product Positioning

- It should be described first as an `AI workbench with canvas`, not as a visualization tool with a thin AI layer
- `Visualization` is the interaction surface: the canvas carries execution objects and their global relationships
- `AI` is the primary usage context: multi-agent development workflows rather than a chat-first single-thread experience
- `Other` captures the workbench aspect: the product is designed to work with VS Code's native editors, terminals, and extension ecosystem

## Core Capabilities

- Open the main canvas in either the panel or the editor area
- Create `Agent`, `Terminal`, and `Note` nodes
- Drive `Agent` nodes through the `codex` or `claude` CLI
- Run `Terminal` nodes through the embedded terminal surface
- Keep canvas browsing available in `Restricted Mode` while automatically disabling execution entry points
- Provide stronger persistence guarantees through `runtimePersistence.enabled` when `systemd --user` is available on Linux local or `Remote SSH`, and otherwise fall back automatically to `best-effort`

## Best Fit

- Trusted workspaces on a standard filesystem
- Environments where `codex` or `claude` CLI is already installed
- Developers who want to observe multiple development sessions without switching constantly between terminal tabs
- Users who want a canvas-shaped AI workbench rather than a single chat panel

## Support Scope And Limits

- `Remote SSH` is the best-validated recommended environment
- Linux, macOS, and Windows local workspaces can be tried, but they have not been strictly validated yet
- `Restricted Mode` allows the canvas to open, but disables execution entry points such as `Agent` and `Terminal`
- `Virtual Workspace` is not supported yet
- The extension is still in `Preview`, with no stable-release commitment

## Environment Requirements

- VS Code `1.85.0` or later
- A standard filesystem workspace
- `Agent` nodes require `codex` or `claude` CLI to be reachable from the Extension Host
- `Terminal` nodes require a shell available on the workspace side

## 0.2.0 Highlights

`0.2.0` moves the canvas from “multiple execution nodes in one place” toward a more complete collaboration surface with relationships and file flow:

- Add manual relationship edges so the canvas can express task splits, dependencies, and handoffs between nodes
- Project agent file activity into file nodes or file lists, with filtering, path display, and direct file opening from the canvas
- Surface execution attention through node chrome, the minimap, and the sidebar overview so important sessions are easier to find
- Tighten sidebar overview, file filtering, and file-activity interactions so the main path feels more complete than `0.1.2`

## Installation And Upgrades

- The extension ID is `devsessioncanvas.dev-session-canvas`
- First-time installs and upgrades from `0.1.2` to `0.2.0` both go through the `Visual Studio Marketplace`; later `0.2.x` updates will also be delivered through Marketplace upgrades
- During Preview, cross-version workspace-state compatibility is not guaranteed. If a workspace contains important canvas state, back it up or validate in a non-critical environment before upgrading

## Rollback Guidance

- If the current version blocks your workflow, disable or uninstall the extension first
- Prefer waiting for the next `0.2.x` fix release rather than trying to downgrade manually
- If you must roll back, reinstall the target version and verify workspace state again. Compatibility between Preview versions is not guaranteed
- For support boundaries, issue reporting, and security guidance, use the links below

## Support And Feedback

- Preview support boundaries: <https://github.com/ZY-WANG-0304/dev-session-canvas/blob/main/docs/support.md>
- Bugs and feature feedback: <https://github.com/ZY-WANG-0304/dev-session-canvas/issues>
- Security issues: `wzy0304@outlook.com`

## Open Source

- License: `Apache-2.0`
- Repository: <https://github.com/ZY-WANG-0304/dev-session-canvas>
