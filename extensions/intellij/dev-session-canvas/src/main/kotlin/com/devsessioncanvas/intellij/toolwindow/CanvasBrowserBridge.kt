package com.devsessioncanvas.intellij.toolwindow

import com.devsessioncanvas.intellij.protocol.CanvasProtocol
import com.devsessioncanvas.intellij.protocol.CanvasHostState
import com.devsessioncanvas.intellij.protocol.HostMessageType
import com.devsessioncanvas.intellij.protocol.WebviewMessage
import com.devsessioncanvas.intellij.protocol.WebviewMessageType
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

    init {
        query.addHandler { request ->
            handleWebviewMessage(request)
            null
        }
    }

    fun postMessageScript(argumentExpression: String): String = query.inject(argumentExpression)

    override fun dispose() {
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
            WebviewMessageType.Ready -> sendBootstrap()
            WebviewMessageType.CreateNote -> sendStateUpdated(stateService.createNote(project.name))
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
                sendStateUpdated(stateService.deleteNode(it))
            }
        }
    }

    private fun sendBootstrap() {
        sendToWebview(CanvasProtocol.encodeHostMessage(HostMessageType.Bootstrap, stateService.snapshot()))
    }

    private fun sendStateUpdated(state: CanvasHostState) {
        sendToWebview(CanvasProtocol.encodeHostMessage(HostMessageType.StateUpdated, state))
    }

    private fun sendToWebview(json: String) {
        ApplicationManager.getApplication().invokeLater {
            browser.cefBrowser.executeJavaScript(
                "window.devSessionCanvasReceiveHostMessage && window.devSessionCanvasReceiveHostMessage($json);",
                browser.cefBrowser.url,
                0
            )
        }
    }
}
