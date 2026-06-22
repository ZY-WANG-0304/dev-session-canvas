# Privacy Policy — Dev Session Canvas

**Extension:** Dev Session Canvas - Multi-Agent Workbench (`devsessioncanvas.dev-session-canvas`)
**Publisher:** devsessioncanvas
**Last Updated:** 2026-06-22

---

## Summary

Dev Session Canvas does not collect or transmit any personal data to us or any remote server. Session recovery data is stored locally on your machine, primarily within VS Code's extension storage. User-initiated diagnostic dumps and exports may be written to workspace folders or user-selected local paths, and are never uploaded by this extension.

---

## Data Collection

**We do not collect or transmit any data to remote servers.** Specifically:

- No personal information is collected or transmitted to us or any remote server by this extension.
- No usage analytics, telemetry, or diagnostics are sent by this extension.
- No session content, terminal output, or agent interactions are transmitted by this extension.

The extension does store the following data **locally on your machine** (within VS Code extension storage) for the purpose of session state recovery:

- Canvas layout and node state (`canvas-state.json`)
- Note content you create within the canvas
- Terminal and agent output summaries (up to 6000 characters per node) and last exit messages
- Runtime metadata for active sessions

---

## Third-Party Services

Dev Session Canvas provides a workbench interface for managing AI coding agent sessions (such as Claude Code or Codex). When you launch a third-party agent from within the extension:

- The agent process is started **locally** on your machine.
- Any network requests (e.g., to AI provider APIs) are made **directly by the agent process**, not by this extension.
- This extension does not participate in, proxy, or intercept any network communication between the agent and its service provider.
- All network activity belongs to the third-party tool you have chosen to launch.

Please refer to the privacy policies of the respective third-party tools you use with this extension.

---

## RuntimePersistence (Optional Feature)

Dev Session Canvas includes an optional **RuntimePersistence** feature. When manually enabled by the user, this feature keeps active coding agent sessions alive when VS Code would otherwise terminate them — equivalent to using `tmux` or similar terminal tools for session persistence.

- This feature is **entirely opt-in** and is never activated without explicit user action.
- It does not transmit any data to remote servers.
- It writes supervisor metadata (including `registry.json` and session output snapshots) to VS Code extension storage.
- On Linux, when using the `systemd-user` backend, it may create or modify user-level systemd unit files and runtime control directories in order to manage session persistence.
- All data written by this feature remains local to your machine and is used solely for session recovery purposes.

---

## Diagnostics / Troubleshooting (User-Initiated)

Dev Session Canvas includes a diagnostic dump command for local troubleshooting:

**Command:** `Dev Session Canvas: 落盘当前宿主诊断` (`devSessionCanvas.dumpHostDiagnostics`)

This command is **only triggered by explicit user action** — it is not automatic telemetry.

**Where diagnostic files are written:**

- When a workspace is open: written to the first workspace folder under `.debug/current-host-diagnostics/<timestamp>/`
- Without a workspace folder: written to the extension's local storage debug directory

**Types of diagnostic files generated** (e.g., `summary.json`, `debug-snapshot.json`, `host-messages.json`, `diagnostic-events.json`, `webview-lifecycle-summary.json`, probe and performance diagnostics):

These files may contain:
- Workspace paths and extension configuration summary
- Canvas and node state, Note metadata or content
- Terminal and agent output snapshots or summaries
- Runtime metadata, local error messages, timing and performance events

**User control:**

- Diagnostic files remain on your machine only.
- This extension never automatically uploads, transmits, or shares diagnostic dumps.
- You decide whether to inspect, delete, redact, or share them with the maintainers for support purposes.

---

## Contact

If you have any questions about this privacy policy, please open an issue at:
https://github.com/ZY-WANG-0304/dev-session-canvas/issues
