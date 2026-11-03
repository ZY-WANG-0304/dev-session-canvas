# Apply the turn-off request

Finish tasks or save your work before selecting **Review and reload…**. The existing warning explains how this window leaves the shared Canvas and when shared sessions are cleared.

## Cancelling is not reverting

Cancelling reload keeps this window in its current mode. It **does not restore the checkbox**: closing the last Canvas page, closing the window or restarting still reaches the mode-switch boundary. Recheck the setting to cancel a pending turn-off request before reaching that boundary.

If the setting changes during confirmation, review the new state again. If cleanup cannot be confirmed, the extension reports failure instead of forcing reload or claiming shutdown succeeded. Some cleanup may already have occurred; use the existing retry flow rather than killing services manually.

System linger is unchanged throughout this process.
