# Enable the extension setting too

Linger keeps the account’s service manager alive. **Runtime Persistence** tells this extension to use an independent runtime host. You need both.

## Choose where the setting applies

Select **Open setting** to find `devSessionCanvas.runtimePersistence.enabled` in VS Code Settings. Choose User, Remote or Workspace as appropriate, then check **Runtime Persistence: Enabled**. Workspace values can override user values.

The guide does not silently choose a scope or write settings. Return to this guide and select **continue** to check the effective value for this window.

Enabling the setting is only a request. Review the next step before reloading: switching modes clears this window’s Canvas sessions and content.
