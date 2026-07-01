package com.devsessioncanvas.intellij.toolwindow

import com.devsessioncanvas.intellij.diagnostics.TerminalDiagnosticsRecorder
import com.devsessioncanvas.intellij.execution.ExecutionSessionManager
import com.devsessioncanvas.intellij.execution.ShellCommandResolver
import com.devsessioncanvas.intellij.execution.TerminalSessionListener
import com.devsessioncanvas.intellij.protocol.CanvasProtocol
import com.devsessioncanvas.intellij.protocol.CanvasHostState
import com.devsessioncanvas.intellij.protocol.HostMessageType
import com.devsessioncanvas.intellij.protocol.WebviewMessage
import com.devsessioncanvas.intellij.protocol.WebviewMessageType
import com.devsessioncanvas.intellij.protocol.TerminalExitPayload
import com.devsessioncanvas.intellij.protocol.TerminalOutputPayload
import com.devsessioncanvas.intellij.protocol.TerminalDiagnosticsStatusPayload
import com.devsessioncanvas.intellij.state.CanvasProjectStateService
import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.service
import com.intellij.openapi.project.Project
import com.intellij.ui.jcef.JBCefBrowser
import com.intellij.ui.jcef.JBCefBrowserBase
import com.intellij.ui.jcef.JBCefJSQuery

class CanvasBrowserBridge(
    private val project: Project,
    private val browser: JBCefBrowser
) : Disposable {
    private val query = JBCefJSQuery.create(browser as JBCefBrowserBase)
    private val stateService = project.service<CanvasProjectStateService>()
    private val diagnosticsRecorder = TerminalDiagnosticsRecorder()
    @Volatile private var disposed = false
    private val executionManager = ExecutionSessionManager(
        object : TerminalSessionListener {
            override fun onTerminalStarted(id: String) {
                diagnosticsRecorder.recordHostEvent("terminal.started", id)
                sendStateUpdated(stateService.updateTerminalStatus(id, "running"))
            }

            override fun onTerminalOutput(id: String, text: String) {
                if (!stateService.isTerminalNode(id)) {
                    return
                }
                diagnosticsRecorder.recordHostText("terminal.output", id, text)
                stateService.appendTerminalOutput(id, text)
                sendToWebview(CanvasProtocol.encodeTerminalOutput(TerminalOutputPayload(id = id, text = text)))
            }

            override fun onTerminalExit(id: String, status: String, exitCode: Int?, message: String) {
                if (!stateService.isTerminalNode(id)) {
                    return
                }
                diagnosticsRecorder.recordHostEvent(
                    "terminal.exit",
                    id,
                    mapOf("status" to status, "exitCode" to (exitCode?.toString() ?: ""), "message" to message)
                )
                sendStateUpdated(stateService.updateTerminalStatus(id, status, message))
                sendToWebview(
                    CanvasProtocol.encodeTerminalExit(
                        TerminalExitPayload(id = id, status = status, exitCode = exitCode, message = message)
                    )
                )
            }
        }
    )

    init {
        query.addHandler { request ->
            handleWebviewMessage(request)
            null
        }
    }

    fun postMessageScript(argumentExpression: String): String = query.inject(argumentExpression)

    override fun dispose() {
        disposed = true
        executionManager.dispose()
        diagnosticsRecorder.dispose()
        query.dispose()
    }

    private fun handleWebviewMessage(request: String) {
        when (val message = CanvasProtocol.decodeWebviewMessage(request)) {
            null -> Unit
            else -> handleMessage(message)
        }
    }

    private fun handleMessage(message: WebviewMessage) {
        when (message.type) {
            WebviewMessageType.Ready -> {
                sendBootstrap()
                sendTerminalDiagnosticsStatus(diagnosticsRecorder.status())
            }
            WebviewMessageType.CreateNote -> sendStateUpdated(stateService.createNote(project.name))
            WebviewMessageType.CreateTerminal -> createTerminal()
            WebviewMessageType.UpdateNote -> message.updateNote?.let {
                sendStateUpdated(stateService.updateNote(it))
            }
            WebviewMessageType.UpdateNodePosition -> message.updateNodePosition?.let {
                sendStateUpdated(stateService.updateNodePosition(it))
            }
            WebviewMessageType.UpdateViewport -> message.updateViewport?.let {
                stateService.updateViewport(it)
            }
            WebviewMessageType.DeleteNode -> message.nodeId?.let {
                if (stateService.isTerminalNode(it)) {
                    executionManager.stopTerminal(it)
                }
                sendStateUpdated(stateService.deleteNode(it))
            }
            WebviewMessageType.TerminalInput -> message.terminalInput?.let {
                diagnosticsRecorder.recordHostText("terminal.input.host-received", it.id, it.text)
                executionManager.sendInput(it.id, it.text)
            }
            WebviewMessageType.TerminalResize -> message.terminalResize?.let {
                diagnosticsRecorder.recordHostEvent(
                    "terminal.resize",
                    it.id,
                    mapOf("cols" to it.cols.toString(), "rows" to it.rows.toString())
                )
                stateService.updateTerminalPtySize(it.id, it.cols, it.rows)
                executionManager.resizeTerminal(it.id, it.cols, it.rows)
            }
            WebviewMessageType.UpdateTerminalSize -> message.terminalSize?.let {
                sendStateUpdated(stateService.updateTerminalSize(it))
            }
            WebviewMessageType.StopTerminal -> message.nodeId?.let {
                diagnosticsRecorder.recordHostEvent("terminal.stop-requested", it)
                executionManager.stopTerminal(it)
            }
            WebviewMessageType.SetTerminalDiagnostics -> message.terminalDiagnosticsEnabled?.let {
                sendTerminalDiagnosticsStatus(diagnosticsRecorder.setEnabled(it))
            }
            WebviewMessageType.TerminalDiagnostic -> message.terminalDiagnostic?.let {
                diagnosticsRecorder.recordWebviewEntry(it.id, it.entry)
            }
        }
    }

    private fun createTerminal() {
        val cwd = ShellCommandResolver.defaultWorkingDirectory(project.basePath)
        val shellPath = ShellCommandResolver.defaultShellPath()
        val creation = stateService.createTerminal(cwd = cwd, shellPath = shellPath)
        sendStateUpdated(creation.state)
        executionManager.startTerminal(
            id = creation.terminal.id,
            cwd = creation.terminal.cwd,
            shellPath = creation.terminal.shellPath,
            cols = creation.terminal.lastCols,
            rows = creation.terminal.lastRows
        )
    }

    private fun sendBootstrap() {
        sendToWebview(CanvasProtocol.encodeHostMessage(HostMessageType.Bootstrap, stateService.snapshot()))
    }

    private fun sendStateUpdated(state: CanvasHostState) {
        sendToWebview(CanvasProtocol.encodeHostMessage(HostMessageType.StateUpdated, state))
    }

    private fun sendTerminalDiagnosticsStatus(payload: TerminalDiagnosticsStatusPayload) {
        sendToWebview(CanvasProtocol.encodeTerminalDiagnosticsStatus(payload))
    }

    private fun sendToWebview(json: String) {
        if (disposed) {
            return
        }
        ApplicationManager.getApplication().invokeLater {
            if (disposed) {
                return@invokeLater
            }
            browser.cefBrowser.executeJavaScript(
                "window.devSessionCanvasReceiveHostMessage && window.devSessionCanvasReceiveHostMessage($json);",
                browser.cefBrowser.url,
                0
            )
        }
    }
}
