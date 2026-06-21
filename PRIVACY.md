# Privacy Policy — Dev Session Canvas

**Extension:** Dev Session Canvas - Multi-Agent Workbench (`devsessioncanvas.dev-session-canvas`)
**Publisher:** devsessioncanvas
**Last Updated:** 2026-06-22

---

## Summary

Dev Session Canvas does not collect, transmit, or store any personal data. All extension activity runs locally within your VS Code environment.

---

## Data Collection

**We do not collect any data.** Specifically:

- No personal information is collected or transmitted to any remote server by this extension.
- No usage analytics, telemetry, or diagnostics are sent by this extension.
- No session content, terminal output, or agent interactions are transmitted by this extension.

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
- It does not transmit any data.
- It does not access or modify any files outside of the running agent session.

---

## Contact

If you have any questions about this privacy policy, please open an issue at:
https://github.com/ZY-WANG-0304/dev-session-canvas/issues
