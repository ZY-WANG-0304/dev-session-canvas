---
# DO NOT TOUCH — Managed by doc writer
ContentId: B32601A8-27ED-4D97-BA83-F1C8C945C635
DateApproved: 4/15/2026

# Summarize the whole topic in less than 300 characters for SEO purpose
MetaDescription: Learn from Visual Studio Code extension guides and code samples
---

# Extension Guides

Once you have learned the basics of Visual Studio Code Extension API in the [Hello World](../get-started/your-first-extension.md) sample, it's time to build some real-world extensions. While the [Extension Capabilities](../extension-capabilities/overview.md) section offers high-level overviews of what an extension **can** do, this section contains a list of detailed code guides and samples that explains **how** to use a specific VS Code API.

In each guide or sample, you can expect to find:

- Thoroughly commented source code.
- A gif or image showing the usage of the sample extension.
- Instructions for running the sample extension.
- Listing of VS Code API being used.
- Listing of Contribution Points being used.
- Real-world extensions resembling the sample.
- Explanation of API concepts.

## Guides & Samples

Here are the guides on the VS Code website, including their usage of the [VS Code API](../references/vscode-api.md) and [Contribution Points](../references/contribution-points.md). Don't forget to refer to the [UX Guidelines](../ux-guidelines/overview.md) to learn the user interface best practices for creating extensions.

| Guide on VS Code Website | API & Contribution |
| --- | --- |
| [Command](command.md) | [commands](../references/vscode-api.md#commands)<br>[contributes.commands](../references/contribution-points.md#contributes.commands) |
| [Color Theme](color-theme.md) | [contributes.themes](../references/contribution-points.md#contributes.themes) |
| [File Icon Theme](file-icon-theme.md) | [contributes.iconThemes](../references/contribution-points.md#contributes.iconThemes) |
| [Product Icon Theme](product-icon-theme.md) | [contributes.productIconThemes](../references/contribution-points.md#contributes.productIconThemes) |
| [Tree View](tree-view.md) | [window.createTreeView](../references/vscode-api.md#window.createTreeView)<br>[window.registerTreeDataProvider](../references/vscode-api.md#window.registerTreeDataProvider)<br>[TreeView](../references/vscode-api.md#TreeView)<br>[TreeDataProvider](../references/vscode-api.md#TreeDataProvider)<br>[contributes.views](../references/contribution-points.md#contributes.views)<br>[contributes.viewsContainers](../references/contribution-points.md#contributes.viewsContainers) |
| [Webview](webview.md) | [window.createWebviewPanel](../references/vscode-api.md#window.createWebviewPanel)<br>[window.registerWebviewPanelSerializer](../references/vscode-api.md#window.registerWebviewPanelSerializer) |
| [Custom Editors](https://code.visualstudio.com/api/extension-guides/custom-editors) | [window.registerCustomEditorProvider](../references/vscode-api.md#window.registerCustomEditorProvider)<br>[CustomTextEditorProvider](../references/vscode-api.md#CustomTextEditorProvider)<br>[contributes.customEditors](../references/contribution-points.md#contributes.customEditors) |
| [Virtual Documents](https://code.visualstudio.com/api/extension-guides/virtual-documents) | [workspace.registerTextDocumentContentProvider](../references/vscode-api.md#workspace.registerTextDocumentContentProvider)<br>[commands.registerCommand](../references/vscode-api.md#commands.registerCommand)<br>[window.showInputBox](../references/vscode-api.md#window.showInputBox) |
| [Virtual Workspaces](virtual-workspaces.md) | [workspace.fs](../references/vscode-api.md#workspace.fs)<br>capabilities.virtualWorkspaces |
| [Workspace Trust](workspace-trust.md) | [workspace.isTrusted](../references/vscode-api.md#workspace.isTrusted)<br>[workspace.onDidGrantWorkspaceTrust](../references/vscode-api.md#workspace.onDidGrantWorkspaceTrust)<br>capabilities.untrustedWorkspaces |
| [Task Provider](https://code.visualstudio.com/api/extension-guides/task-provider) | [tasks.registerTaskProvider](../references/vscode-api.md#tasks.registerTaskProvider)<br>[Task](../references/vscode-api.md#Task)<br>[ShellExecution](../references/vscode-api.md#ShellExecution)<br>[contributes.taskDefinitions](../references/contribution-points.md#contributes.taskDefinitions) |
| [Source Control](https://code.visualstudio.com/api/extension-guides/scm-provider) | [workspace.workspaceFolders](../references/vscode-api.md#workspace.workspaceFolders)<br>[SourceControl](../references/vscode-api.md#SourceControl)<br>[SourceControlResourceGroup](../references/vscode-api.md#SourceControlResourceGroup)<br>[scm.createSourceControl](../references/vscode-api.md#scm.createSourceControl)<br>[TextDocumentContentProvider](../references/vscode-api.md#TextDocumentContentProvider)<br>[contributes.menus](../references/contribution-points.md#contributes.menus) |
| [Debugger Extension](https://code.visualstudio.com/api/extension-guides/debugger-extension) | [contributes.breakpoints](../references/contribution-points.md#contributes.breakpoints)<br>[contributes.debuggers](../references/contribution-points.md#contributes.debuggers)<br>[debug](../references/vscode-api.md#debug) |
| [Markdown Extension](https://code.visualstudio.com/api/extension-guides/markdown-extension) | markdown.previewStyles<br>markdown.markdownItPlugins<br>markdown.previewScripts |
| [Test Extension](testing.md) | [TestController](../references/vscode-api.md#TestController)<br>[TestItem](../references/vscode-api.md#TestItem) |
| [Custom Data Extension](https://code.visualstudio.com/api/extension-guides/custom-data-extension) | contributes.html.customData<br>contributes.css.customData |
<br>

Here is a list of additional samples from the [VS Code Extensions samples repo](https://github.com/microsoft/vscode-extension-samples).

| Sample on GitHub Repo | API & Contribution |
| --- | --- |
| [Webview Sample](https://github.com/microsoft/vscode-extension-samples/tree/main/webview-sample) | [window.createWebviewPanel](../references/vscode-api.md#window.createWebviewPanel)<br>[window.registerWebviewPanelSerializer](../references/vscode-api.md#window.registerWebviewPanelSerializer) |
| [Status Bar Sample](https://github.com/microsoft/vscode-extension-samples/tree/main/statusbar-sample) | [window.createStatusBarItem](../references/vscode-api.md#window.createStatusBarItem)<br>[StatusBarItem](../references/vscode-api.md#StatusBarItem) |
| [Tree View Sample](https://github.com/microsoft/vscode-extension-samples/tree/main/tree-view-sample) | [window.createTreeView](../references/vscode-api.md#window.createTreeView)<br>[window.registerTreeDataProvider](../references/vscode-api.md#window.registerTreeDataProvider)<br>[TreeView](../references/vscode-api.md#TreeView)<br>[TreeDataProvider](../references/vscode-api.md#TreeDataProvider)<br>[contributes.views](../references/contribution-points.md#contributes.views)<br>[contributes.viewsContainers](../references/contribution-points.md#contributes.viewsContainers) |
| [Task Provider Sample](https://github.com/microsoft/vscode-extension-samples/tree/main/task-provider-sample) | [tasks.registerTaskProvider](../references/vscode-api.md#tasks.registerTaskProvider)<br>[Task](../references/vscode-api.md#Task)<br>[ShellExecution](../references/vscode-api.md#ShellExecution)<br>[contributes.taskDefinitions](../references/contribution-points.md#contributes.taskDefinitions) |
| [Multi Root Sample](https://github.com/microsoft/vscode-extension-samples/tree/main/basic-multi-root-sample) | [workspace.getWorkspaceFolder](../references/vscode-api.md#workspace.getWorkspaceFolder)<br>[workspace.onDidChangeWorkspaceFolders](../references/vscode-api.md#workspace.onDidChangeWorkspaceFolders) |
| [Completion Provider Sample](https://github.com/microsoft/vscode-extension-samples/tree/main/completions-sample) | [languages.registerCompletionItemProvider](../references/vscode-api.md#languages.registerCompletionItemProvider)<br>[CompletionItem](../references/vscode-api.md#CompletionItem)<br>[SnippetString](../references/vscode-api.md#SnippetString) |
| [File System Provider Sample](https://github.com/microsoft/vscode-extension-samples/tree/main/fsprovider-sample) | [workspace.registerFileSystemProvider](../references/vscode-api.md#workspace.registerFileSystemProvider) |
| [Editor Decorator Sample](https://github.com/microsoft/vscode-extension-samples/tree/main/decorator-sample) | [TextEditor.setDecorations](../references/vscode-api.md#TextEditor.setDecorations)<br>[DecorationOptions](../references/vscode-api.md#DecorationOptions)<br>[DecorationInstanceRenderOptions](../references/vscode-api.md#DecorationInstanceRenderOptions)<br>[ThemableDecorationInstanceRenderOptions](../references/vscode-api.md#ThemableDecorationInstanceRenderOptions)<br>[window.createTextEditorDecorationType](../references/vscode-api.md#window.createTextEditorDecorationType)<br>[TextEditorDecorationType](../references/vscode-api.md#TextEditorDecorationType)<br>[contributes.colors](../references/contribution-points.md#contributes.colors) |
| [L10N Sample](https://github.com/microsoft/vscode-extension-samples/tree/main/l10n-sample) |  |
| [Terminal Sample](https://github.com/microsoft/vscode-extension-samples/tree/main/terminal-sample) | [window.createTerminal](../references/vscode-api.md#window.createTerminal)<br>[window.onDidChangeActiveTerminal](../references/vscode-api.md#window.onDidChangeActiveTerminal)<br>[window.onDidCloseTerminal](../references/vscode-api.md#window.onDidCloseTerminal)<br>[window.onDidOpenTerminal](../references/vscode-api.md#window.onDidOpenTerminal)<br>[window.Terminal](../references/vscode-api.md#window.Terminal)<br>[window.terminals](../references/vscode-api.md#window.terminals) |
| [Vim Sample](https://github.com/microsoft/vscode-extension-samples/tree/main/vim-sample) | [commands](../references/vscode-api.md#commands)<br>[StatusBarItem](../references/vscode-api.md#StatusBarItem)<br>[window.createStatusBarItem](../references/vscode-api.md#window.createStatusBarItem)<br>[TextEditorCursorStyle](../references/vscode-api.md#TextEditorCursorStyle)<br>[window.activeTextEditor](../references/vscode-api.md#window.activeTextEditor)<br>[Position](../references/vscode-api.md#Position)<br>[Range](../references/vscode-api.md#Range)<br>[Selection](../references/vscode-api.md#Selection)<br>[TextEditor](../references/vscode-api.md#TextEditor)<br>[TextEditorRevealType](../references/vscode-api.md#TextEditorRevealType)<br>[TextDocument](../references/vscode-api.md#TextDocument) |
| [Source Control Sample](https://github.com/microsoft/vscode-extension-samples/tree/main/source-control-sample) | [workspace.workspaceFolders](../references/vscode-api.md#workspace.workspaceFolders)<br>[SourceControl](../references/vscode-api.md#SourceControl)<br>[SourceControlResourceGroup](../references/vscode-api.md#SourceControlResourceGroup)<br>[scm.createSourceControl](../references/vscode-api.md#scm.createSourceControl)<br>[TextDocumentContentProvider](../references/vscode-api.md#TextDocumentContentProvider)<br>[contributes.menus](../references/contribution-points.md#contributes.menus) |
| [Commenting API Sample](https://github.com/microsoft/vscode-extension-samples/tree/main/comment-sample) |  |
| [Document Editing Sample](https://github.com/microsoft/vscode-extension-samples/tree/main/document-editing-sample) | [commands](../references/vscode-api.md#commands)<br>[contributes.commands](../references/contribution-points.md#contributes.commands) |
| [Getting Started Sample](https://github.com/microsoft/vscode-extension-samples/tree/main/getting-started-sample) | [contributes.walkthroughs](../references/contribution-points.md#contributes.walkthroughs) |
| [Test extension](https://github.com/microsoft/vscode-extension-samples/tree/main/test-provider-sample) | [TestController](../references/vscode-api.md#TestController)<br>[TestItem](../references/vscode-api.md#TestItem) |

## Language Extension Samples

These samples are [Language Extensions](https://code.visualstudio.com/api/language-extensions/overview) samples:

| Sample                                                                                                                           | Guide on VS Code Website                                                                                                                          |
| -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Snippet Sample](https://github.com/microsoft/vscode-extension-samples/tree/main/snippet-sample)                               | [/api/language-extensions/snippet-guide](https://code.visualstudio.com/api/language-extensions/snippet-guide)                                     | [contributes.snippets](../references/contribution-points.md#contributes.snippets) |
| [Language Configuration Sample](https://github.com/microsoft/vscode-extension-samples/tree/main/language-configuration-sample) | [/api/language-extensions/language-configuration-guide](https://code.visualstudio.com/api/language-extensions/language-configuration-guide)       | [contributes.languages](../references/contribution-points.md#contributes.languages) |
| [LSP Sample](https://github.com/microsoft/vscode-extension-samples/tree/main/lsp-sample)                                       | [/api/language-extensions/language-server-extension-guide](https://code.visualstudio.com/api/language-extensions/language-server-extension-guide) |  |
| [LSP Log Streaming Sample](https://github.com/microsoft/vscode-extension-samples/tree/main/lsp-log-streaming-sample)           | N/A                                                                                                                                               |  |
| [LSP Multi Root Server Sample](https://github.com/microsoft/vscode-extension-samples/tree/main/lsp-multi-server-sample)        | [https://github.com/microsoft/vscode/wiki/Adopting-Multi-Root-Workspace-APIs#language-client--language-server](https://github.com/microsoft/vscode/wiki/Adopting-Multi-Root-Workspace-APIs#language-client--language-server) (GitHub repo wiki)                                     |  |
| [LSP Web Extension Sample](https://github.com/Microsoft/vscode-extension-samples/tree/main/lsp-web-extension-sample) | [/api/language-extensions/language-server-extension-guide](https://code.visualstudio.com/api/language-extensions/language-server-extension-guide) |  |
