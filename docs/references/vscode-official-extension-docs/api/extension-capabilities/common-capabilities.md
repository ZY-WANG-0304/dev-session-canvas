---
# DO NOT TOUCH — Managed by doc writer
ContentId: 9c48dfbf-e49d-4f33-aadc-5ebf06d5dde0
DateApproved: 4/15/2026

# Summarize the whole topic in less than 300 characters for SEO purpose
MetaDescription: Common capabilities that Visual Studio Code extensions (plug-ins) can take advantage of
---

# Common Capabilities

Common Capabilities are important building blocks for your extensions. Almost all extensions use some of these functionalities. Here is how you can take advantage of them.

## Command

Command is central to how VS Code works. You open the Command Palette to execute commands, bind custom keybindings to commands, and right-click to invoke commands in Context Menus.

An extension could:

- Register and execute commands with the [`vscode.commands`](../references/vscode-api.md#commands) API.
- Make commands available in the Command Palette with the [`contributes.commands`](../references/contribution-points.md#contributes.commands) Contribution Point.

Learn more about commands at the [Extension Guides / Command](../extension-guides/command.md) topic.

## Configuration

An extension can contribute extension-specific settings with the [`contributes.configuration`](../references/contribution-points.md#contributes.configuration) Contribution Point and read them using the [`workspace.getConfiguration`](../references/vscode-api.md#workspace.getConfiguration) API.

## Keybinding

An extension can add custom keybindings. Read more in the [`contributes.keybindings`](../references/contribution-points.md#contributes.keybindings) and [Key Bindings](https://code.visualstudio.com/docs/getstarted/keybindings) topics.

## Context Menu

An extension can register custom Context Menu items that will be displayed in different parts of the VS Code UI on right-click. Read more at the [`contributes.menus`](../references/contribution-points.md#contributes.menus) Contribution Point.

## Data Storage

There are five options for storing data:

- [`ExtensionContext.workspaceState`](../references/vscode-api.md#ExtensionContext.workspaceState): A workspace storage where you can write key/value pairs. VS Code manages the storage and will restore it when the same workspace is opened again.
- [`ExtensionContext.globalState`](../references/vscode-api.md#ExtensionContext.globalState): A global storage where you can write key/value pairs. VS Code manages the storage and will restore it for each extension activation. You can selectively synchronize key/value pairs in global storage by setting the keys for sync using `setKeysForSync` method on `globalState`.
- [`ExtensionContext.storageUri`](../references/vscode-api.md#ExtensionContext.storageUri): A workspace specific storage URI pointing to a local directory where your extension has read/write access. This is a good option if you need to store large files that are accessible only from the current workspace.
- [`ExtensionContext.globalStorageUri`](../references/vscode-api.md#ExtensionContext.globalStorageUri): A global storage URI pointing to a local directory where your extension has read/write access. This is a good option if you need to store large files that are accessible from all workspaces.
- [`ExtensionContext.secrets`](../references/vscode-api.md#ExtensionContext.secrets): A global storage for secrets (or any information that is sensitive) that will be encrypted. These are not synced across machines. For VS Code desktop, this leverages Electron's [safeStorage API](https://www.electronjs.org/docs/latest/api/safe-storage). For VS Code for the Web, this uses a Double Key Encryption (DKE) implementation.

The extension context is available to the `activate` function in the [Extension Entry File](../get-started/extension-anatomy.md#extension-entry-file).

### setKeysForSync example

If your extension needs to preserve some user state across different machines then provide the state to [Setting Sync](https://code.visualstudio.com/docs/configure/settings-sync) using `vscode.ExtensionContext.globalState.setKeysForSync`.

You can use the following pattern:

```TypeScript
// on activate
const versionKey = 'shown.version';
context.globalState.setKeysForSync([versionKey]);

// later on show page
const currentVersion = context.extension.packageJSON.version;
const lastVersionShown = context.globalState.get(versionKey);
if (isHigher(currentVersion, lastVersionShown)) {
    context.globalState.update(versionKey, currentVersion);
}
```

Sharing state across machines can help avoid the problem of users seeing multiple instances of a welcome or update page, by sharing dismissed or viewed flags.

## Display Notifications

Almost all extensions need to present information to the user at some point. VS Code offers three APIs for displaying notification messages of different severity:

- [`window.showInformationMessage`](../references/vscode-api.md#window.showInformationMessage)
- [`window.showWarningMessage`](../references/vscode-api.md#window.showWarningMessage)
- [`window.showErrorMessage`](../references/vscode-api.md#window.showErrorMessage)

## Quick Pick

With the [`vscode.QuickPick`](../references/vscode-api.md#QuickPick) API, you can easily collect user input or let the user make a selection from multiple options. The [QuickInput sample](https://github.com/microsoft/vscode-extension-samples/tree/main/quickinput-sample) illustrates the API.

## File Picker

Extensions can use the [`window.showOpenDialog`](../references/vscode-api.md#window.showOpenDialog) API to open the system file picker and select files or folders.

## Output Channel

The Output Panel displays a collection of [`OutputChannel`](../references/vscode-api.md#OutputChannel), which are great for logging purposes. You can easily take advantage of it with the [`window.createOutputChannel`](../references/vscode-api.md#window.createOutputChannel) API.

## Progress API

You can use the [`vscode.Progress`](../references/vscode-api.md#Progress) API for reporting progress updates to the user.

Progress can be shown in different locations using the [`ProgressLocation`](../references/vscode-api.md#ProgressLocation) option:

- In the Notifications area
- In the Source Control view
- General progress in the VS Code window

The [Progress sample](https://github.com/microsoft/vscode-extension-samples/tree/main/progress-sample) illustrates this API.
