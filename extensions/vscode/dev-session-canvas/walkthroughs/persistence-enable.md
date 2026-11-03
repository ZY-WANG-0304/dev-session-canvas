# A change to this account

Opening this guide checks the host and account automatically. When the environment is ready, this step remains visible and is checked off; the next task opens without another click. If the check fails, review Output and use **check again / view details**. A failed check never grants permission to run a command.

Linger is a **system setting**, not a VS Code preference. Other user services for this account may keep running too.

## You stay in control

- The confirmation shows the exact host, account and command.
- The default command does **not** use sudo.
- If needed, choose **use sudo…** separately. Enter any password only in the dedicated terminal; the extension never collects it.
- Copying the command does not execute it.

Disabling Runtime Persistence or uninstalling the extension does not turn linger off. Linger does not preserve running processes through a host reboot.
