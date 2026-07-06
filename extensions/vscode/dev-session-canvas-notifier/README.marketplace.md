# Dev Session Canvas Notifier

`Dev Session Canvas Notifier` is the local UI-side companion extension for `Dev Session Canvas`. It receives structured execution-node attention events from the main extension and delivers best-effort desktop system notifications from the machine that is showing VS Code.

English (default) | [简体中文](README.marketplace.zh-CN.md)

It is not a standalone replacement for the main extension. Canvas state, node execution, and attention detection still belong to `Dev Session Canvas`; the notifier focuses on turning those requests into visible, diagnosable desktop notifications and, where the platform supports it, a click path back into the relevant VS Code window.

## When It Helps

- The main extension runs in `Remote SSH`, WSL, or a Dev Container, but the alert should appear on your local desktop.
- You use a local workspace and still want desktop notifications when VS Code is not in the foreground.
- You want a clear separation between VS Code workbench messages and operating-system desktop notifications.
- You want the notification click path, on supported platforms, to return to the relevant canvas node without clearing the node attention state.

## Current Capabilities

- Chooses a local UI-side backend per platform:
  - macOS: `terminal-notifier`, with `osascript` fallback
  - Linux: `notify-send`
  - Windows: Toast Notification through PowerShell
- Explicitly reports whether the current backend supports click callbacks or only guarantees that the notification appears.
- Provides a dedicated sidebar with `Overview`, `Notes`, platform guidance, and Agent configuration sections.
- Provides command-palette actions:
  - `Dev Session Canvas Notifier: Send Test Desktop Notification`
  - `Dev Session Canvas Notifier: Open Notification Diagnostic Output`
  - `Dev Session Canvas Notifier: Open Settings`
- Follows the VS Code locale for product-owned UI copy: English is the default, with Simplified Chinese localization included.

## Installation And Enablement

1. Install `Dev Session Canvas Notifier`.
2. If `Dev Session Canvas` is not installed yet, VS Code installs the main extension through the notifier dependency.
3. If you install from the main `Dev Session Canvas` page first, VS Code also installs this companion through the main extension pack.
4. The main extension defaults `devSessionCanvas.notifications.attentionSignalBridge` to `system`; switch it to `workbench` or `none` in settings if you prefer a different bridge.
5. To request silent desktop notifications where supported, set `devSessionCanvasNotifier.notifications.playSound` to `false`.

In `system` mode, the main extension sends attention signals to this companion first. If the companion is unavailable, unsupported, or fails to deliver a notification, the main extension falls back to a VS Code workbench message.

If you mainly use the `Codex` provider, confirm that the Codex environment emits attention signals. The common configuration keys used by this repository are `notification_method` and `notification_condition`. Supported values can vary across Codex versions, so check those settings first if no signal is emitted.

## Local Desktop Environment Setup

Whether your workspace or Agent runs locally, in `Remote SSH`, in WSL, or in a Dev Container, `Dev Session Canvas Notifier` and the desktop notification backend should be installed on the local UI side that displays VS Code, not on the remote host.

### macOS

- Install `terminal-notifier` if you need clicking a notification to return to VS Code.
- Common command: `brew install terminal-notifier`
- Without it, the notifier falls back to the built-in `osascript display notification` path. That fallback only guarantees notification display and does not promise click callbacks.

### Linux

- Install `notify-send` before sending desktop notifications.
- Common install commands:
  - Debian / Ubuntu: `sudo apt install libnotify-bin`
  - Fedora: `sudo dnf install libnotify`
  - Arch: `sudo pacman -S libnotify`
- Click callback support depends on whether the desktop environment and notification service support `notify-send --action --wait`.

### Windows

- Usually no extra notification CLI is required.
- Confirm that system notification permissions, Notification Center, and Focus Assist / Do Not Disturb are not blocking VS Code Toasts.
- If a notification does not appear, first check `Windows Settings -> System -> Notifications` and make sure VS Code notifications are allowed.

## Provider / Agent Host Configuration

The companion only delivers notifications to the local desktop. To make each provider emit an attention signal, configure the CLI on the host where the Agent actually runs. If the Agent runs remotely, these provider settings belong on the remote host, not on the local UI machine.

### Codex

Recommended `~/.codex/config.toml` on the Agent host:

```toml
[tui]
notifications = true
notification_method = "osc9"
notification_condition = "always"
```

- If the file already has model, approval, or sandbox settings, only add the `[tui]` keys.
- Agents created from the built-in default template usually include these notification settings already.

### Claude Code

Recommended `~/.claude/settings.json` on the Agent host:

```json
{
  "preferredNotifChannel": "iterm2"
}
```

- If `settings.json` already has other fields, merge `preferredNotifChannel` instead of replacing the file.
- Agents created from the built-in default template usually include this setting already and do not need extra hooks.

## Preview Boundaries

- This is still a `Preview` companion extension, and platform click behavior is intentionally best-effort.
- Without the main extension, this companion does not provide canvas or execution-node capabilities by itself.
- Use it with the matching public `Preview` version of `Dev Session Canvas`; mixing it with older experimental packages is not recommended.
- UI language follows the VS Code locale. User-owned data, file paths, terminal output, provider output, configuration snippets, and diagnostic facts remain unchanged.

## Feedback And Support

- Issues: <https://github.com/ZY-WANG-0304/dev-session-canvas/issues>
- Repository: <https://github.com/ZY-WANG-0304/dev-session-canvas>
- Security: <https://github.com/ZY-WANG-0304/dev-session-canvas/blob/main/docs/SECURITY.md>
