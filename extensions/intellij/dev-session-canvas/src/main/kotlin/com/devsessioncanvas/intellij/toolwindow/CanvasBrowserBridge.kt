package com.devsessioncanvas.intellij.toolwindow

import com.devsessioncanvas.intellij.protocol.CanvasHostState
import com.devsessioncanvas.intellij.protocol.CanvasNoteNode
import com.devsessioncanvas.intellij.protocol.CanvasProtocol
import com.devsessioncanvas.intellij.protocol.HostMessageType
import com.devsessioncanvas.intellij.protocol.WebviewMessageType
import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.project.Project
import com.intellij.ui.jcef.JBCefBrowser
import com.intellij.ui.jcef.JBCefBrowserBase
import com.intellij.ui.jcef.JBCefJSQuery

class CanvasBrowserBridge(
    private val project: Project,
    private val browser: JBCefBrowser
) : Disposable {
    private val query = JBCefJSQuery.create(browser as JBCefBrowserBase)
    private val notes = mutableListOf<CanvasNoteNode>()

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
        when (CanvasProtocol.decodeWebviewMessage(request)?.type) {
            WebviewMessageType.Ready -> sendBootstrap()
            WebviewMessageType.CreateNote -> createTestNote()
            null -> Unit
        }
    }

    private fun sendBootstrap() {
        sendToWebview(hostMessage(HostMessageType.Bootstrap))
    }

    private fun createTestNote() {
        val noteNumber = notes.size + 1
        notes += CanvasNoteNode(
            id = "intellij-note-$noteNumber",
            title = "IntelliJ Test Note $noteNumber",
            body = "Created inside ${project.name} through the JCEF bridge.",
            x = 80.0 + (noteNumber - 1) * 260.0,
            y = 80.0
        )
        sendToWebview(hostMessage(HostMessageType.StateUpdated))
    }

    private fun hostMessage(type: HostMessageType): String {
        return CanvasProtocol.encodeHostMessage(type, CanvasHostState(notes.toList()))
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
